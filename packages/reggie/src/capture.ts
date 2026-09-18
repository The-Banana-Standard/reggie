import { existsSync, realpathSync, statSync } from "node:fs";
import path from "node:path";
import { listRepoFiles } from "./git.js";
import { INTAKE_HEADER } from "./layout.js";
import type { RepoPaths } from "./paths.js";
import type { Person } from "./people.js";
import { knownSlugs, parseIntake } from "./tasks.js";
import { appendText, isSafeSlug, readText, slugify, today, writeText } from "./util.js";

/** Where an idea struck: the page it was captured from, as an entity of the repo. */
export type CaptureOriginKind = "file" | "folder" | "symbol" | "task";

export interface CaptureOrigin {
  kind: CaptureOriginKind;
  /** The repo-relative path, tidied: no leading `./`, no trailing slash. Absent for a task. */
  path?: string;
  /** A symbol name inside `path`; only with a file. */
  symbol?: string;
  /** The slug of the task whose page the idea came from; never together with a path. */
  task?: string;
}

/** What a door hands the resolver: whatever the body, the option or the tool argument carried. */
export interface RawCaptureOrigin {
  path?: string | null;
  symbol?: string | null;
  task?: string | null;
}

export interface ResolveOriginOptions {
  /** The slugs a task origin may name; `knownSlugs` when absent. The server passes its task list. */
  knownTasks?: ReadonlySet<string>;
}

/** A symbol as the code map names one: an identifier, at most 200 characters. */
export const CAPTURE_SYMBOL_RE = /^[A-Za-z_$][A-Za-z0-9_$]{0,199}$/;

/**
 * The four characters a detail line's two renderers give meaning to. The board's `inline` gives
 * backticks priority and the story's `linkifyWith` gives `[[route|label]]` priority, so no one
 * escaping serves both; a path holding one of these is refused rather than written.
 */
const MARKUP_CHARS = /[`[\]|]/;
/**
 * Characters that would sit invisibly inside the backticks of a detail line or the single-quoted
 * prompt: the C0 and C1 controls (NEL among them), the line and paragraph separators, and the
 * zero-width and byte-order marks. Checked on the value as given, before it is trimmed, so a path
 * that ends in a newline or a tab is refused rather than tidied.
 */
export const INVISIBLE_CHARS = /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028\u2029\u2060\ufeff]/;

/** How much of a refused path a sentence repeats: enough to recognise it, never the whole request. */
const ECHO_CHARS = 200;

/** A path as a refusal sentence names it: in backticks, cut at ECHO_CHARS with an ellipsis. */
function echo(value: string): string {
  return `\`${value.length > ECHO_CHARS ? `${value.slice(0, ECHO_CHARS)}…` : value}\``;
}

/**
 * The only place a page path is accepted. Every door (the capture route, both launch routes, the
 * CLI options, the MCP tool) calls this before anything is written or built, and each refusal is a
 * sentence of Reggie's own that names no absolute path. A path is an entity of the repo when it is
 * in the same `git ls-files` listing the code map is built from — a file or a tracked symlink as an
 * exact entry, a folder as a prefix of one — which is what keeps `.git/`, ignored files, globs,
 * pathspec magic and a file deleted from disk out before any of them could reach `git log`.
 */
export function resolveCaptureOrigin(paths: RepoPaths, raw: RawCaptureOrigin, opts: ResolveOriginOptions = {}): CaptureOrigin {
  const hasPath = raw.path !== undefined && raw.path !== null;
  const hasSymbol = raw.symbol !== undefined && raw.symbol !== null;
  const hasTask = raw.task !== undefined && raw.task !== null;
  if (hasTask) {
    if (hasPath || hasSymbol) throw new Error("an idea comes from one page: name the task or the path, not both.");
    const task = String(raw.task).trim();
    if (!isSafeSlug(task)) throw new Error("that is not a task slug. Use lowercase letters, digits, and hyphens.");
    const known = opts.knownTasks ?? knownSlugs(paths);
    if (!known.has(task)) throw new Error(`\`${task}\` is not a task in this repo.`);
    return { kind: "task", task };
  }
  if (hasSymbol && !hasPath) throw new Error("a symbol needs the file that holds it; give the path too.");
  if (!hasPath) throw new Error("an origin needs a path or a task.");
  const resolved = resolvePath(paths.root, String(raw.path));
  if (!hasSymbol) return resolved;
  if (resolved.kind !== "file") throw new Error("a symbol belongs to a file, not a folder.");
  const symbol = String(raw.symbol).trim();
  if (!CAPTURE_SYMBOL_RE.test(symbol)) throw new Error("that is not a symbol name: letters, digits, underscores and dollar signs only, up to 200 of them.");
  return { kind: "symbol", path: resolved.path, symbol };
}

function resolvePath(root: string, raw: string): { kind: "file" | "folder"; path: string } {
  if (INVISIBLE_CHARS.test(raw)) throw new Error("a path may not hold a control character.");
  const value = raw.trim();
  if (value.includes("\\")) throw new Error("a path uses forward slashes; a backslash is not allowed.");
  const stripped = value.replace(/^\.\//, "");
  if (path.posix.isAbsolute(stripped) || path.isAbsolute(stripped)) throw new Error("a path is relative to the repo, never absolute.");
  if (stripped.split("/").some((seg) => seg === "..")) throw new Error("a path may not step outside the repo with `..`.");
  const clean = stripped.replace(/\/+$/, "");
  if (clean === "" || clean === ".") throw new Error("the repo itself is not an origin; leave the path out for a repo-wide idea.");
  if (MARKUP_CHARS.test(clean)) throw new Error("a path may not hold a backtick, a square bracket or a pipe: those would forge markup in the intake line.");
  const listed = listRepoFiles(root);
  const exact = listed.includes(clean);
  const folder = !exact && listed.some((f) => f.startsWith(`${clean}/`));
  if (!exact && !folder) throw new Error(`${echo(clean)} is not a file or folder in this repo (git does not list it, or it is ignored).`);
  const full = path.join(root, clean);
  const gone = new Error(`${echo(clean)} is listed by git but is not on disk.`);
  if (!existsSync(full)) throw gone;
  // `realpathSync` follows every link: a tracked symlink whose target is outside the repo is not an
  // entity of the repo, and nothing downstream should be handed a path that reads through it. The
  // two calls are guarded because an entry that vanishes between the listing and here would
  // otherwise answer with Node's own message, which carries the absolute path.
  let real: string;
  let isDir: boolean;
  try {
    real = realpathSync(full);
    isDir = statSync(full).isDirectory();
  } catch {
    throw gone;
  }
  const rootReal = realpathSync(root);
  if (real !== rootReal && !real.startsWith(`${rootReal}${path.sep}`)) throw new Error(`${echo(clean)} points outside the repo.`);
  return { kind: folder || isDir ? "folder" : "file", path: clean };
}

/**
 * The pack paths a launch names, each resolved to the file or folder it is, deduplicated by what it
 * resolved to, and bounded at `MAX_LAUNCH_PATHS` after resolution so that nine spellings of two
 * paths are two. The first refusal is the answer, in the resolver's words; `POST /api/launch`,
 * `GET /api/launch` and `reggie launch --path` all come through here so the three cannot drift.
 */
export function resolvePackPaths(paths: RepoPaths, raw: readonly string[], max: number): string[] {
  const out: string[] = [];
  for (const p of raw) {
    const origin = resolveCaptureOrigin(paths, { path: p });
    if (origin.path && !out.includes(origin.path)) out.push(origin.path);
    if (out.length > max) throw new Error(`a launch names at most ${max} paths.`);
  }
  return out;
}

/** The one detail line an origin becomes, in the shape every reader of the intake already takes. */
export function originLine(origin: CaptureOrigin): string {
  switch (origin.kind) {
    case "file":
      return `Captured from the file \`${origin.path}\``;
    case "folder":
      return `Captured from the folder \`${origin.path}\``;
    case "symbol":
      return `Captured from \`${origin.symbol}\` in the file \`${origin.path}\``;
    case "task":
      return `Captured from the task \`${origin.task}\``;
  }
}

export interface CaptureInput {
  text: string;
  person: Person;
  source: string;
  detail?: string;
  slug?: string;
  /** The page the idea came from, already resolved; written as the last detail line under the item. */
  origin?: CaptureOrigin;
}

export interface CaptureResult {
  slug: string;
  line: string;
}

/** Append one raw item to intake.md. Slugs are derived from the text and made unique. */
export function capture(paths: RepoPaths, input: CaptureInput): CaptureResult {
  if (!readText(paths.intake)) writeText(paths.intake, INTAKE_HEADER);
  const existing = knownSlugs(paths);
  let slug = input.slug ? slugify(input.slug) : slugify(input.text, 48);
  if (existing.has(slug)) {
    let n = 2;
    while (existing.has(`${slug}-${n}`)) n += 1;
    slug = `${slug}-${n}`;
  }
  const text = input.text.replace(/\s+/g, " ").trim();
  const line = `- ${slug}: ${text} (${input.person.handle}, ${input.source}, ${today()})`;
  const lines = [line];
  if (input.detail && input.detail.trim()) {
    for (const d of input.detail.trim().split("\n")) lines.push(`  > ${d.trim()}`);
  }
  // The origin goes last so the person's own words read first, and as a plain detail line so the
  // parser, the remover, triage's prefill and both renderers take it without learning anything.
  if (input.origin) lines.push(`  > ${originLine(input.origin)}`);
  appendText(paths.intake, `${lines.join("\n")}\n`);
  return { slug, line };
}

/**
 * Remove a slug's intake lines, and the detail under each, once a brief has replaced them.
 *
 * Which lines those are is decided by `parseIntake` and not by a second pattern here. That is the
 * whole point: the intake header invites hand-written lines, and the parser accepts far more than
 * `- slug:` — any of `-`, `*`, `+`, a checkbox, up to three spaces of indent, a raw prefix it
 * slugifies (`Login_Retry:` becomes `login-retry`), and a bullet with no prefix at all whose slug
 * comes from its text. A shape the parser counts as an item but the remover misses would outlive
 * its own brief and sit in the queue for work the board already reports as shaped, with no verb
 * able to sweep it. Duplicated slugs are all removed, which is why triage reads every one of them
 * before this runs.
 */
export function removeFromIntake(paths: RepoPaths, slug: string): boolean {
  const content = readText(paths.intake);
  if (!content) return false;
  const starts = new Set(parseIntake(content).filter((i) => i.slug === slug).map((i) => i.line));
  if (starts.size === 0) return false;
  const out: string[] = [];
  let skipping = false;
  // `parseIntake` normalises CRLF before splitting, which changes no line count, so its 1-based
  // line numbers index this split too.
  content.split("\n").forEach((line, idx) => {
    if (starts.has(idx + 1)) {
      skipping = true;
      return;
    }
    if (skipping && /^\s+>/.test(line)) return;
    skipping = false;
    out.push(line);
  });
  writeText(paths.intake, out.join("\n"));
  return true;
}

export interface IntakeDetailInput {
  slug: string;
  /** One or more lines to add under the item, each becoming a `> ` detail line. */
  text: string;
  person: Person;
  source: string;
  /** The item's title, used only when the slug has no intake line yet (a backlog item, say). */
  title?: string;
}

export interface IntakeDetailResult {
  slug: string;
  /** The detail lines as they were written, without the `> ` prefix. */
  added: string[];
  /** True when no intake line existed for the slug and one was written to hold the detail. */
  createdLine: boolean;
}

/**
 * Add detail under an intake item: the user's answer to "what did you mean". It goes into the
 * same `> ` lines `capture --detail` writes, so every reader of the intake (the board, the
 * context pack, the shaping session) sees it without learning a new shape. An item that has no
 * intake line, because it came from the repo's own backlog, gets one so the detail has a home.
 */
export function addIntakeDetail(paths: RepoPaths, input: IntakeDetailInput): IntakeDetailResult {
  const lines = input.text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length === 0) throw new Error("nothing to add: the detail is empty.");
  const content = readText(paths.intake) ?? INTAKE_HEADER;
  const rows = content.replace(/\r\n/g, "\n").split("\n");
  const itemRe = new RegExp(`^ {0,3}[-*+]\\s+(?:\\[[ xX]\\]\\s+)?${input.slug.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}:\\s`);
  const at = rows.findIndex((row) => itemRe.test(row));
  const stamp = `(${input.person.handle}, ${input.source}, ${today()})`;
  const detail = lines.map((l, i) => `  > ${l}${i === lines.length - 1 ? ` ${stamp}` : ""}`);
  if (at === -1) {
    const title = (input.title ?? input.slug).replace(/\s+/g, " ").trim();
    const block = [`- ${input.slug}: ${title} ${stamp}`, ...detail].join("\n");
    const base = content.endsWith("\n") ? content : `${content}\n`;
    writeText(paths.intake, `${base}${block}\n`);
    return { slug: input.slug, added: lines, createdLine: true };
  }
  // Insert after the item's existing detail lines, so answers read in the order they were given.
  let end = at + 1;
  while (end < rows.length && /^\s+>/.test(rows[end] ?? "")) end += 1;
  rows.splice(end, 0, ...detail);
  writeText(paths.intake, rows.join("\n"));
  return { slug: input.slug, added: lines, createdLine: false };
}
