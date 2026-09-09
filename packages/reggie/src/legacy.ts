import { existsSync, readdirSync, realpathSync, statSync } from "node:fs";
import path from "node:path";
import { isSafeSlug, readText, slugify } from "./util.js";
import type { RepoPaths } from "./paths.js";

/*
 * The backlog a repo already had.
 *
 * Reggie's own state lives in `.reggie/`, but almost every repo that adopts it arrives with a
 * hand-written backlog: a `TASKS.md` of open items and a `HISTORY.md` of finished ones, and
 * often a folder of per-slug plan documents from whatever ran before. Ignoring those files
 * makes the tasks page lie by omission — it shows four captured items while the repo's real
 * backlog is two hundred lines long in a file the author edits every week.
 *
 * So this module reads them as a task source, in place. Nothing here writes: the Markdown file
 * stays the author's, editable by hand, and Reggie derives from it the same way it derives from
 * git. Every item carries the file and line it came from, so the UI can always answer "says who".
 *
 * The format is the one those files converge on, and it is matched conservatively — a bracket
 * group only becomes a tag when it is one of the words below, so a Markdown link or a bracketed
 * aside in the prose survives into the title instead of being eaten as metadata.
 *
 *     ### Section
 *     - [ ] slug: description [P2] [moderate] [code] [planned] [depends: other-slug]
 *       files: src/a.js (MOD), src/b.js (NEW)
 *
 * Legacy items never override git. They supply "this task exists" plus the author's own shaping;
 * a branch, a packet or a pull request still decides the state, in tasks.ts.
 */

export type LegacySource = "tasks" | "history";

/** Sizes the old files use, mapped onto the brief contract's small | medium | large. */
const SIZE_WORDS: Record<string, string> = {
  trivial: "small",
  simple: "small",
  small: "small",
  moderate: "medium",
  medium: "medium",
  complex: "large",
  large: "large",
};

/** Bracket words that mean "what kind of work is this", kept verbatim for display. */
const KIND_WORDS = new Set(["code", "manual", "content", "docs", "design", "research", "decision", "vars", "discovered", "universe", "infra", "ops"]);

const PRIORITY_RE = /^P[0-9]$/;

export interface LegacyFileRef {
  path: string;
  /** NEW | MOD | DEL when the entry named one. `(MOD?)` and `(MOD x4)` both read as MOD. */
  op: "NEW" | "MOD" | "DEL" | null;
  /** The entry was written with a `?`, i.e. the author was unsure it would be touched. */
  tentative: boolean;
}

export interface LegacyItem {
  slug: string;
  /** First sentence of the description, for a card. */
  title: string;
  /** The whole description, tags removed. */
  description: string;
  done: boolean;
  /** Heading trail above the line, outermost first, e.g. ["Backlog", "Chatbot — Core Experience"]. */
  section: string[];
  /** The line sat under a heading called Ungroomed (or Unsorted / Inbox / Triage). */
  ungroomed: boolean;
  /** P1 | P2 | P3 as written, else "unset". */
  priority: string;
  /** small | medium | large, else "unset". */
  size: string;
  /** The size word as the file wrote it, when it differs from the mapped size. */
  sizeWord: string | null;
  kinds: string[];
  /** The author tagged it [planned]: a plan for it is supposed to exist. */
  planned: boolean;
  /** The author tagged it [parked]: deliberately not being worked on. */
  parked: boolean;
  depends: string[];
  conflicts: string[];
  /** The `[tier: opus:medium]` value, when present. */
  tier: string | null;
  files: LegacyFileRef[];
  /** YYYY-MM-DD from a trailing `-- date` or a `**DONE date**`, when the item is finished. */
  completedAt: string | null;
  source: LegacySource;
  /** Repo-relative path of the file the line came from. */
  file: string;
  /** 1-based line number of the item's first line. */
  line: number;
  /** The `>` note introducing this item's section, when it had one. */
  initiative: string | null;
}

/** One legacy file Reggie read, for the "where this came from" line in the UI. */
export interface LegacySourceFile {
  /** Repo-relative path. */
  file: string;
  kind: LegacySource;
  items: number;
}

export interface LegacyPlan {
  slug: string;
  /** Repo-relative path of the plan document. */
  file: string;
  content: string;
  /** The plan folder is not in git, so only this machine has it. */
  untracked: boolean;
}

export interface LegacyBacklog {
  items: Map<string, LegacyItem>;
  sources: LegacySourceFile[];
  /** Per-slug plan documents from the old pipeline folder. */
  plans: Map<string, LegacyPlan>;
  /** Repo-relative path of the plan folder, when one was found. */
  planDir: string | null;
  /** The plan folder exists but git ignores it. */
  planDirUntracked: boolean;
}

const EMPTY: LegacyBacklog = { items: new Map(), sources: [], plans: new Map(), planDir: null, planDirUntracked: false };

const ITEM_RE = /^ {0,3}[-*]\s+\[([ xX])\]\s+(.*)$/;
/** `slug: the description` — the form a backlog file uses while the task is still open. */
const SLUG_COLON_RE = /^([A-Za-z0-9][A-Za-z0-9_-]*):\s*(.*)$/s;
/**
 * `slug the description`, with no colon. History files drift into this once the line is a record
 * rather than a to-do. A bare first word would be ambiguous with ordinary prose, so the token has
 * to be hyphenated and lowercase — which every real slug is, and a sentence's first word is not.
 */
const SLUG_BARE_RE = /^([a-z0-9]+(?:-[a-z0-9]+)+)\s+(\S.*)$/s;

/** The slug and the rest of the line, however the file spells the separator. */
function splitSlug(body: string): { slug: string; rest: string } | null {
  const colon = SLUG_COLON_RE.exec(body);
  if (colon?.[1]) return { slug: colon[1].toLowerCase(), rest: colon[2] ?? "" };
  const bare = SLUG_BARE_RE.exec(body);
  if (bare?.[1]) return { slug: bare[1], rest: bare[2] ?? "" };
  // No slug at all: derive one from the text, the way intake lines do.
  const text = body.trim();
  if (!text) return null;
  const slug = slugify(text, 48);
  return isSafeSlug(slug) ? { slug, rest: text } : null;
}
const HEADING_RE = /^(#{1,6})\s+(.*)$/;
const FILES_RE = /^\s+files:\s*(.*)$/i;
const UNGROOMED_RE = /^(ungroomed|unsorted|inbox|triage|uncategori[sz]ed|raw)\b/i;

/** `[tag]` groups, but only the ones that are really tags. Everything else stays in the prose. */
function readTag(body: string, item: LegacyItem): boolean {
  const lower = body.toLowerCase().trim();
  if (PRIORITY_RE.test(body.trim())) {
    item.priority = body.trim().toUpperCase();
    return true;
  }
  if (SIZE_WORDS[lower]) {
    item.size = SIZE_WORDS[lower];
    item.sizeWord = lower;
    return true;
  }
  if (KIND_WORDS.has(lower)) {
    item.kinds.push(lower);
    return true;
  }
  if (lower === "planned") {
    item.planned = true;
    return true;
  }
  if (lower === "parked" || lower === "on hold" || lower === "blocked") {
    item.parked = true;
    return true;
  }
  const keyed = /^(tier|depends|conflicts|after|blocks):\s*(.*)$/is.exec(body.trim());
  if (keyed) {
    const key = (keyed[1] ?? "").toLowerCase();
    const value = (keyed[2] ?? "").trim();
    if (key === "tier") item.tier = value;
    else if (key === "conflicts" || key === "blocks") item.conflicts.push(...splitList(value));
    else item.depends.push(...splitList(value));
    return true;
  }
  return false;
}

function splitList(value: string): string[] {
  return value
    .split(/[,;]/)
    .map((s) => s.trim())
    .filter((s) => isSafeSlug(s));
}

/**
 * Ranges covered by a Markdown code span, so a `[planned]` being *discussed* is not mistaken for a
 * `[planned]` being *applied*. Backlogs about tooling are full of the former: the reason a task
 * exists is often the tag itself.
 */
function codeSpans(text: string): Array<[number, number]> {
  const spans: Array<[number, number]> = [];
  const re = /(`+)(?:[\s\S]*?)\1/g;
  for (let m = re.exec(text); m; m = re.exec(text)) spans.push([m.index, m.index + m[0].length]);
  return spans;
}

/**
 * Pull the recognised `[tag]` groups out of a description and return the prose without them.
 * Unrecognised groups are left alone: `[see the note](url)`, "the [P1] convention" and a
 * backticked `[planned]` are all prose.
 */
export function extractTags(text: string, item: LegacyItem): string {
  const spans = codeSpans(text);
  const inCode = (at: number) => spans.some(([a, b]) => at >= a && at < b);
  let out = "";
  let i = 0;
  while (i < text.length) {
    const open = text.indexOf("[", i);
    if (open === -1) {
      out += text.slice(i);
      break;
    }
    const close = text.indexOf("]", open + 1);
    // A Markdown link — `[label](href)` — is prose whatever the label says.
    const isLink = close !== -1 && text[close + 1] === "(";
    if (close === -1 || isLink || inCode(open) || !readTag(text.slice(open + 1, close), item)) {
      out += text.slice(i, close === -1 ? text.length : close + 1);
      i = close === -1 ? text.length : close + 1;
      continue;
    }
    out += text.slice(i, open);
    i = close + 1;
  }
  // Tags at the head of a line leave the separator that introduced the prose behind them
  // (`[content] -- Umbrella doc…`), so a title would otherwise open on a dash.
  return out
    .replace(/\s{2,}/g, " ")
    .replace(/\s+([.,;:])/g, "$1")
    .replace(/^[\s\-–—;:,.]+/, "")
    .trim();
}

/** `src/a.js (MOD), content/*.md (MOD x4), b.js (MOD?)` */
export function parseFileList(value: string): LegacyFileRef[] {
  const refs: LegacyFileRef[] = [];
  for (const raw of value.split(",")) {
    const entry = raw.trim();
    if (!entry) continue;
    const m = /^(.*?)\s*\((NEW|MOD|DEL|CREATE|REWRITE|READ)\s*(\?)?\s*(?:x\s*\d+)?\)\s*$/i.exec(entry);
    const p = (m ? (m[1] ?? "") : entry).trim();
    if (!p) continue;
    const word = m?.[2]?.toUpperCase() ?? null;
    const op = word === "CREATE" ? "NEW" : word === "REWRITE" ? "MOD" : word === "READ" ? null : (word as LegacyFileRef["op"]);
    refs.push({ path: p.replace(/\\/g, "/").replace(/^\.\/+/, ""), op: op ?? null, tentative: Boolean(m?.[3]) });
  }
  return refs;
}

/** The completion date: a trailing `-- 2026-09-05`, else a `**DONE 2026-09-05**` anywhere. */
function completionDate(text: string): string | null {
  const trailing = /(?:--|—|·)\s*(\d{4}-\d{2}-\d{2})\s*$/.exec(text.trim());
  if (trailing?.[1]) return trailing[1];
  const done = /\*\*\s*(?:DONE|SHIPPED|COMPLETE[D]?)\b[^*]*?(\d{4}-\d{2}-\d{2})/i.exec(text);
  if (done?.[1]) return done[1];
  return /^\s*(?:DONE|SHIPPED)\b[^.]*?(\d{4}-\d{2}-\d{2})/i.exec(text)?.[1] ?? null;
}

/**
 * A leading `**...**` is sometimes a status marker the line was stamped with (`**DONE 2026-09-05**`)
 * and sometimes the headline itself. Only the marker is dropped: stripping a bold headline leaves
 * the card titled with the middle of a sentence.
 */
const STATUS_BOLD_RE = /^\*\*\s*(?:DONE|SHIPPED|COMPLETED?|LANDED|MERGED|BLOCKED|SUPERSEDED|WONTFIX|CLOSED|\d{4}-\d{2}-\d{2})\b[^*]*\*\*\s*/i;

/** Skip a `(...)` starting at `i`, counting nested pairs. Returns `i` when there is none. */
function skipParenthetical(text: string, i: number): number {
  if (text[i] !== "(") return i;
  let depth = 0;
  for (let j = i; j < text.length; j += 1) {
    if (text[j] === "(") depth += 1;
    else if (text[j] === ")") {
      depth -= 1;
      if (depth === 0) return j + 1;
    }
  }
  return i;
}

function stripStatusPrefix(text: string): string {
  const withoutBold = text.replace(STATUS_BOLD_RE, "");
  if (withoutBold === text) return text;
  // A status marker is usually followed by its own parenthetical — the commit, the suite counts —
  // which is not the title either. It nests, so it needs a scan rather than a regex.
  let rest = withoutBold.trimStart();
  rest = rest.slice(skipParenthetical(rest, 0));
  const cleaned = rest.replace(/^[\s\-–—;:,.]+/, "");
  // A line that is nothing but its marker keeps the marker rather than becoming an empty title.
  return cleaned.trim() ? cleaned : text;
}

/** The trailing `-- 2026-05-29` a history line signs off with; it is already read as completedAt. */
function stripTrailingDate(text: string): string {
  return text.replace(/\s*(?:--|—|·)\s*\d{4}-\d{2}-\d{2}\s*$/, "").trimEnd();
}

function firstSentence(text: string, max = 180): string {
  const flat = text.replace(/\s+/g, " ").trim();
  if (!flat) return "";
  const stop = /[.!?](?:\s|$)/.exec(flat.slice(0, max + 40));
  const cut = stop && stop.index > 20 ? flat.slice(0, stop.index) : flat;
  return cut.length > max ? `${cut.slice(0, max - 1).trimEnd()}…` : cut;
}

/**
 * Parse one backlog file. `source` decides the default for items with no checkbox state:
 * everything in a history file is finished whether or not the box is ticked.
 */
export function parseLegacyBacklog(content: string, file: string, source: LegacySource): LegacyItem[] {
  const items: LegacyItem[] = [];
  const lines = content.replace(/\r\n/g, "\n").split("\n");
  const heading: string[] = [];
  let initiative: string | null = null;
  let current: LegacyItem | null = null;
  let pendingNote: string[] = [];

  const flushNote = () => {
    if (pendingNote.length) initiative = pendingNote.join(" ").trim() || null;
    pendingNote = [];
  };

  lines.forEach((line, idx) => {
    const h = HEADING_RE.exec(line);
    if (h) {
      const depth = (h[1] ?? "#").length;
      heading.length = Math.max(0, depth - 1);
      heading[depth - 1] = (h[2] ?? "").trim();
      initiative = null;
      pendingNote = [];
      current = null;
      return;
    }

    // A `>` block under a heading introduces the whole group; keep the most recent one.
    if (/^\s*>\s?/.test(line)) {
      if (!current) pendingNote.push(line.replace(/^\s*>\s?/, "").trim());
      return;
    }
    if (pendingNote.length && line.trim() === "") flushNote();

    const m = ITEM_RE.exec(line);
    if (m) {
      flushNote();
      const split = splitSlug(m[2] ?? "");
      if (!split || !isSafeSlug(split.slug)) return;
      const slug = split.slug;
      const sectionTrail = heading.filter(Boolean).slice(1);
      const item: LegacyItem = {
        slug,
        title: "",
        description: "",
        done: (m[1] ?? "").toLowerCase() === "x" || source === "history",
        section: sectionTrail,
        ungroomed: sectionTrail.some((s) => UNGROOMED_RE.test(s)),
        priority: "unset",
        size: "unset",
        sizeWord: null,
        kinds: [],
        planned: false,
        parked: false,
        depends: [],
        conflicts: [],
        tier: null,
        files: [],
        completedAt: null,
        source,
        file,
        line: idx + 1,
        initiative,
      };
      const raw = split.rest;
      const prose = extractTags(raw, item);
      item.description = prose;
      item.title = firstSentence(stripTrailingDate(stripStatusPrefix(prose)).replace(/\*\*/g, "")) || slug;
      if (item.done) item.completedAt = completionDate(raw);
      items.push(item);
      current = item;
      return;
    }

    if (!current) return;
    const f = FILES_RE.exec(line);
    if (f) {
      current.files.push(...parseFileList(f[1] ?? ""));
      return;
    }
    // A continuation line: indented, not a new bullet, not blank.
    if (/^\s+\S/.test(line) && !/^\s*[-*]\s/.test(line)) {
      current.description = `${current.description} ${extractTags(line.trim(), current)}`.trim();
      return;
    }
    if (line.trim() === "") return;
    current = null;
  });

  return items;
}

/** Merge a later item into an earlier one, keeping whichever field is actually filled in. */
function mergeItem(base: LegacyItem, extra: LegacyItem): LegacyItem {
  return {
    ...base,
    done: base.done || extra.done,
    completedAt: base.completedAt ?? extra.completedAt,
    description: base.description.length >= extra.description.length ? base.description : extra.description,
    title: base.title.length >= extra.title.length ? base.title : extra.title,
    priority: base.priority !== "unset" ? base.priority : extra.priority,
    size: base.size !== "unset" ? base.size : extra.size,
    sizeWord: base.sizeWord ?? extra.sizeWord,
    kinds: base.kinds.length ? base.kinds : extra.kinds,
    files: base.files.length ? base.files : extra.files,
    depends: base.depends.length ? base.depends : extra.depends,
    conflicts: base.conflicts.length ? base.conflicts : extra.conflicts,
    initiative: base.initiative ?? extra.initiative,
  };
}

/** Candidate file names, most conventional first. Case is handled by the directory listing. */
const TASK_FILE_NAMES = ["tasks.md", "backlog.md", "todo.md"];
const HISTORY_FILE_NAMES = ["history.md", "done.md", "completed.md"];
const PLAN_DIR_NAMES = [".pipeline", ".tasks", "tasks"];

export interface LegacyConfig {
  /** Repo-relative paths. `false` anywhere turns the whole feature off. */
  tasks?: string | false;
  history?: string | false;
  plans?: string | false;
  enabled?: boolean;
}

/**
 * Find the repo's own backlog files. Names are matched case-insensitively against the real
 * directory listing, and each match is resolved to its real path before use: on a
 * case-insensitive filesystem `TASKS.md` and `tasks.md` are one file, and reading both would
 * double every task on the page.
 */
function findFile(root: string, names: string[], configured: string | false | undefined): string | null {
  if (configured === false) return null;
  if (configured) {
    const p = path.resolve(root, configured);
    return existsSync(p) && statSync(p).isFile() ? p : null;
  }
  let entries: string[];
  try {
    entries = readdirSync(root);
  } catch {
    return null;
  }
  const byLower = new Map<string, string>();
  for (const e of entries) {
    const lower = e.toLowerCase();
    if (!byLower.has(lower)) byLower.set(lower, e);
  }
  for (const name of names) {
    const actual = byLower.get(name);
    if (!actual) continue;
    const p = path.join(root, actual);
    try {
      if (statSync(p).isFile()) return p;
    } catch {
      /* raced or unreadable */
    }
  }
  return null;
}

function samePath(a: string | null, b: string | null): boolean {
  if (!a || !b) return false;
  const real = (p: string) => {
    try {
      return realpathSync.native(p);
    } catch {
      return path.resolve(p);
    }
  };
  return real(a) === real(b);
}

function rel(root: string, p: string): string {
  return path.relative(root, p).split(path.sep).join("/");
}

/** Per-slug plan documents left by an older pipeline: `<dir>/<slug>/task.md` or `<dir>/<slug>.md`. */
function findPlans(root: string, configured: string | false | undefined): { dir: string | null; plans: Map<string, LegacyPlan> } {
  const plans = new Map<string, LegacyPlan>();
  let dir: string | null = null;
  if (configured === false) return { dir: null, plans };
  const candidates = configured ? [configured] : PLAN_DIR_NAMES;
  for (const name of candidates) {
    const p = path.resolve(root, name);
    if (existsSync(p) && statSync(p).isDirectory()) {
      dir = p;
      break;
    }
  }
  if (!dir) return { dir: null, plans };
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return { dir: null, plans };
  }
  for (const entry of entries) {
    const slug = entry.replace(/\.md$/i, "").toLowerCase();
    if (!isSafeSlug(slug)) continue;
    const full = path.join(dir, entry);
    let file: string | null = null;
    try {
      if (statSync(full).isDirectory()) {
        for (const inner of ["task.md", "plan.md", "PLAN.md", "TASK.md"]) {
          const candidate = path.join(full, inner);
          if (existsSync(candidate)) {
            file = candidate;
            break;
          }
        }
      } else if (/\.md$/i.test(entry)) {
        file = full;
      }
    } catch {
      continue;
    }
    if (!file) continue;
    const content = readText(file);
    if (content === null) continue;
    plans.set(slug, { slug, file: rel(root, file), content, untracked: false });
  }
  return { dir, plans };
}

/**
 * Read whatever backlog the repo already keeps. Returns an empty backlog when there is none,
 * so every caller can treat this as "extra tasks, maybe zero".
 */
export function readLegacy(paths: RepoPaths, config: LegacyConfig | undefined, opts: { untrackedPlans?: boolean } = {}): LegacyBacklog {
  if (config?.enabled === false) return EMPTY;
  const root = paths.root;
  const tasksFile = findFile(root, TASK_FILE_NAMES, config?.tasks);
  const historyFileRaw = findFile(root, HISTORY_FILE_NAMES, config?.history);
  // Case-insensitive filesystems hand back the same inode for TASKS.md and tasks.md.
  const historyFile = samePath(tasksFile, historyFileRaw) ? null : historyFileRaw;

  const items = new Map<string, LegacyItem>();
  const sources: LegacySourceFile[] = [];
  const read = (file: string | null, kind: LegacySource) => {
    if (!file) return;
    const content = readText(file);
    if (content === null) return;
    const parsed = parseLegacyBacklog(content, rel(root, file), kind);
    let added = 0;
    for (const item of parsed) {
      const existing = items.get(item.slug);
      items.set(item.slug, existing ? mergeItem(existing, item) : item);
      if (!existing) added += 1;
    }
    sources.push({ file: rel(root, file), kind, items: parsed.length });
    void added;
  };
  read(tasksFile, "tasks");
  read(historyFile, "history");

  const { dir, plans } = findPlans(root, config?.plans);
  const untracked = Boolean(opts.untrackedPlans);
  if (untracked) for (const plan of plans.values()) plan.untracked = true;

  if (items.size === 0 && plans.size === 0) return EMPTY;
  return { items, sources, plans, planDir: dir ? rel(root, dir) : null, planDirUntracked: untracked };
}
