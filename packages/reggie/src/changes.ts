import { blobAt, blobSize, blobText, commitCount, diffRawRange, isFullSha, mergeBase, numstatRange, patchFor, resolveCommit } from "./git.js";
import { emptyHistoryIndex, taskLanding } from "./history.js";
import { REGGIE_DIR } from "./paths.js";
import { isSafeSlug } from "./util.js";

/*
 * What a task changed, line by line. A task's change is one range of two full commit ids: a live
 * branch is read from the point it left the base, a landed task from the merge that landed it against
 * that merge's first parent. The list of files comes from git's null-separated output, because the
 * text forms quote odd names and cannot tell a file named `a => b` from a rename; one file's patch is
 * fetched at a time, by the paths the list already knows, and its hunks are read by the counts in
 * their `@@` headers, so a deleted line that looks like a file header is still the deletion it is.
 * The rows the reader draws are built here, where they can be tested, and the reader only draws them.
 */

/** Rows returned by one `/api/filediff` answer; the rest are reached with `offset`. */
export const DIFF_PAGE_ROWS = 2000;
/** Characters of one row's text that are sent; a longer line is cut and flagged. */
export const DIFF_ROW_CHARS = 2000;
/**
 * Rows built for one file, context and gap rows included. Every row is an object held in memory
 * before a page is cut from it, and a cap on changed lines alone does not bound them: a million-line
 * file with every eighth line changed is 250,000 changed lines and 1,125,000 rows, measured at half a
 * second and 466 MB of heap for one request. The cap is applied three times, each cheaper than the
 * work it prevents: on git's own added-plus-deleted count before the patch is asked for, on the hunk
 * lines as they are parsed, so parsing stops rather than finishing, and on the rows once gaps are in.
 * 100,000 rows is fifty pages, past anything a person reads row by row; the largest real change in
 * this repo's history is under 600.
 */
export const DIFF_MAX_ROWS = 100_000;
/** Bytes of one file's patch that are read; git is stopped past this rather than allowed the default 64 MB. */
export const DIFF_MAX_PATCH_BYTES = 16 * 1024 * 1024;

export interface DiffLimits {
  maxRows: number;
  maxPatchBytes: number;
}

const DEFAULT_LIMITS: DiffLimits = { maxRows: DIFF_MAX_ROWS, maxPatchBytes: DIFF_MAX_PATCH_BYTES };

// ---------------------------------------------------------------------------
// The range
// ---------------------------------------------------------------------------

export interface ChangeRange {
  /** `branch`: from the merge base to the branch tip. `merge`: from the landing merge's first parent to the merge. */
  kind: "branch" | "merge";
  /** Full commit id the diff starts from. */
  base: string;
  /** Full commit id the diff ends at. */
  ref: string;
  /** The integration branch the change is measured against. */
  baseName: string;
  /** What `ref` is: `task/<slug>`, `origin/task/<slug>`, or the merge's subject. */
  refName: string;
  /** Commits the change is made of: ahead of the base for a branch, brought in by the merge for a landing. */
  commits: number;
}

export type RangeResult = { ok: true; range: ChangeRange } | { ok: false; reason: string };

/** The three facts about a task the range is derived from; `TaskInfo` satisfies it. */
export interface RangeTask {
  slug: string;
  state: string;
  branchRef: string | null;
}

/**
 * The range a task's change is read over, in this order: a task that is not done and whose branch is
 * ahead of the base reads from the merge base to the tip, which is what a merge would land and stays
 * right when the branch merged the base back in; otherwise the merge that landed it, against its first
 * parent; otherwise a branch that still resolves, from its merge base.
 *
 * Every name is resolved once to a full commit id here, by its full ref name, and nothing but those
 * ids goes on to git: not to the diff readers, and not to the landing lookup either. The integration
 * branch's name comes from a config file a clone carries, so it is as hostile as the repo is: handed
 * to `git log` as a bare argument, a name like `--output=<file>` that also exists as a ref made git
 * write that file. A short name would also let a tag called `task/<slug>` stand in for the branch.
 */
export function taskRange(root: string, task: RangeTask, baseName: string): RangeResult {
  if (!isSafeSlug(task.slug)) return { ok: false, reason: "That is not a task slug." };
  const base = resolveCommit(root, `refs/heads/${baseName}`) ?? resolveCommit(root, `refs/remotes/origin/${baseName}`);
  if (!base) return { ok: false, reason: "The integration branch this repo names does not resolve to a branch in this clone, so there is nothing to measure a change against." };

  // Only the two names tasks.ts builds from a safe slug are ever resolved; anything else is no branch.
  const branchRef = task.branchRef === `task/${task.slug}` || task.branchRef === `origin/task/${task.slug}` ? task.branchRef : null;
  const tip = branchRef ? resolveCommit(root, branchRef.startsWith("origin/") ? `refs/remotes/${branchRef}` : `refs/heads/${branchRef}`) : null;
  const fork = tip ? mergeBase(root, base, tip) : null;
  const ahead = tip ? (commitCount(root, base, tip) ?? 0) : 0;
  const live: ChangeRange | null = tip && fork ? { kind: "branch", base: fork, ref: tip, baseName, refName: branchRef ?? "", commits: ahead } : null;

  if (task.state !== "done" && live && ahead > 0) return { ok: true, range: live };

  // The lookup uses its base only as a revision, so it is handed the commit id, never the name. It
  // wants an index only for a fallback this does not read, so it is given an empty one and the full
  // history index is never built for a request that asks what a task changed.
  const landing = taskLanding(root, task.slug, { base, index: emptyHistoryIndex() });
  const [first, second] = landing.merge?.parents ?? [];
  if (landing.merge && first && second && isFullSha(first) && isFullSha(landing.merge.sha)) {
    return { ok: true, range: { kind: "merge", base: first, ref: landing.merge.sha, baseName, refName: landing.merge.subject, commits: landing.commits.length } };
  }

  const done = task.state === "done";
  // A done task whose kept branch has nothing past the base was fast-forwarded: "no commits yet" would be false.
  if (live && !(done && ahead === 0)) return { ok: true, range: live };
  if (tip && !fork) return { ok: false, reason: `${branchRef} shares no history with ${baseName}, so there is no point to measure its change from.` };
  if (done && tip) {
    return {
      ok: false,
      reason: `This task is done, but no merge commit on ${baseName} landed it: ${branchRef} was fast-forwarded, so it holds nothing ${baseName} does not, and its commits cannot be told apart from the rest.`,
    };
  }
  if (done) {
    return {
      ok: false,
      reason: `This task is done, but no merge commit on ${baseName} landed it and its branch is gone, so its commits cannot be told apart from the rest. It was probably fast-forwarded or squashed.`,
    };
  }
  return { ok: false, reason: `There is no task branch yet: nothing named task/${task.slug} exists in this clone, so there is no change to read.` };
}

// ---------------------------------------------------------------------------
// The list
// ---------------------------------------------------------------------------

export type ChangeStatus = "added" | "deleted" | "modified" | "renamed" | "copied" | "typechange";

export interface ChangedFile {
  /** The path as it was committed, byte for byte; the new path of a rename. */
  path: string;
  status: ChangeStatus;
  /** The old path of a rename or a copy. */
  from?: string;
  /** How alike the two sides of a rename are, 0 to 100. */
  similarity?: number;
  /** Null for a file the change added. */
  oldMode: string | null;
  /** Null for a file the change deleted. */
  newMode: string | null;
  binary: boolean;
  added: number;
  deleted: number;
}

/** A listed file with the two blob ids the list read, which sizes and the HEAD comparison are asked by. */
export interface ChangeEntry extends ChangedFile {
  oldBlob: string | null;
  newBlob: string | null;
}

const STATUS_BY_LETTER: Record<string, ChangeStatus> = { A: "added", D: "deleted", M: "modified", R: "renamed", C: "copied", T: "typechange" };
const NO_MODE = "000000";
const SYMLINK_MODE = "120000";

function blobOrNull(sha: string): string | null {
  return isFullSha(sha) && !/^0+$/.test(sha) ? sha : null;
}

/**
 * Parse `git diff --raw -z --no-abbrev`. Each entry is `:<old mode> <new mode> <old blob> <new blob>
 * <status>` then a NUL and the path, or two paths for a rename or a copy. Paths are taken by position,
 * so a name that itself starts with a colon is never read as the next entry. Counts are left at zero
 * for `joinNumstat`. Pure.
 */
export function parseRawZ(text: string): ChangeEntry[] {
  const tokens = text.split("\0");
  const out: ChangeEntry[] = [];
  let i = 0;
  while (i < tokens.length) {
    const head = tokens[i] ?? "";
    i += 1;
    if (!head.startsWith(":")) continue;
    const [oldMode = "", newMode = "", oldBlob = "", newBlob = "", statusField = ""] = head.slice(1).split(" ");
    const letter = statusField.charAt(0);
    const twoPaths = letter === "R" || letter === "C";
    const first = tokens[i] ?? "";
    const second = twoPaths ? (tokens[i + 1] ?? "") : "";
    i += twoPaths ? 2 : 1;
    const filePath = twoPaths ? second : first;
    if (!filePath) continue;
    const entry: ChangeEntry = {
      path: filePath,
      status: STATUS_BY_LETTER[letter] ?? "modified",
      oldMode: oldMode === NO_MODE ? null : oldMode,
      newMode: newMode === NO_MODE ? null : newMode,
      binary: false,
      added: 0,
      deleted: 0,
      oldBlob: blobOrNull(oldBlob),
      newBlob: blobOrNull(newBlob),
    };
    if (twoPaths) {
      entry.from = first;
      const score = Number.parseInt(statusField.slice(1), 10);
      if (Number.isFinite(score)) entry.similarity = score;
    }
    out.push(entry);
  }
  return out;
}

export interface NumstatEntry {
  path: string;
  added: number;
  deleted: number;
  binary: boolean;
}

/**
 * Parse `git diff --numstat -z`: `<added>\t<deleted>\t<path>` and a NUL, or for a rename an empty path
 * followed by the old and the new path as two more fields. `-` for both counts marks a binary file.
 * Only the first two tabs are separators, so a name holding a tab stays whole. Pure.
 */
export function parseNumstatZ(text: string): NumstatEntry[] {
  const tokens = text.split("\0");
  const out: NumstatEntry[] = [];
  let i = 0;
  while (i < tokens.length) {
    const token = tokens[i] ?? "";
    i += 1;
    const t1 = token.indexOf("\t");
    const t2 = t1 < 0 ? -1 : token.indexOf("\t", t1 + 1);
    if (t2 < 0) continue;
    const a = token.slice(0, t1);
    const d = token.slice(t1 + 1, t2);
    if (!/^(\d+|-)$/.test(a) || !/^(\d+|-)$/.test(d)) continue;
    let filePath = token.slice(t2 + 1);
    if (filePath === "") {
      filePath = tokens[i + 1] ?? "";
      i += 2;
    }
    if (!filePath) continue;
    const binary = a === "-" && d === "-";
    out.push({ path: filePath, added: a === "-" ? 0 : Number.parseInt(a, 10), deleted: d === "-" ? 0 : Number.parseInt(d, 10), binary });
  }
  return out;
}

/** The raw entries with their counts, in path order so a user's `diff.orderFile` cannot reorder them. */
export function joinNumstat(entries: readonly ChangeEntry[], stats: readonly NumstatEntry[]): ChangeEntry[] {
  const byPath = new Map(stats.map((s) => [s.path, s] as const));
  return entries
    .map((e) => {
      const s = byPath.get(e.path);
      return s ? { ...e, added: s.added, deleted: s.deleted, binary: s.binary } : e;
    })
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

/** Every file a range changed; null when git could not be read, which is never the same as nothing changed. */
export function listChanges(root: string, range: ChangeRange): ChangeEntry[] | null {
  const raw = diffRawRange(root, range.base, range.ref);
  if (raw === null) return null;
  const numstat = numstatRange(root, range.base, range.ref);
  if (numstat === null) return null;
  return joinNumstat(parseRawZ(raw), parseNumstatZ(numstat));
}

export function isRecordPath(filePath: string): boolean {
  return filePath.startsWith(`${REGGIE_DIR}/`);
}

export interface ChangeTotals {
  files: number;
  added: number;
  deleted: number;
}

export interface TaskChanges {
  slug: string;
  /** False when there is no range to read, or git could not read it; `reason` then says why. */
  available: boolean;
  reason: string | null;
  range: ChangeRange | null;
  /** Everything outside `.reggie/`. */
  files: ChangedFile[];
  /** Reggie's own records under `.reggie/`: listed and readable, never counted. */
  records: ChangedFile[];
  /** `files` only, by the owner's ruling: records stay out of every count. */
  totals: ChangeTotals;
}

const NO_TOTALS: ChangeTotals = { files: 0, added: 0, deleted: 0 };

function publicFile(entry: ChangeEntry): ChangedFile {
  const { oldBlob: _old, newBlob: _new, ...file } = entry;
  return file;
}

/** The payload of `GET /api/changes` from a resolved range and its entries. */
export function changesPayload(slug: string, range: RangeResult, entries: readonly ChangeEntry[] | null): TaskChanges {
  if (!range.ok) return { slug, available: false, reason: range.reason, range: null, files: [], records: [], totals: NO_TOTALS };
  if (entries === null) {
    return { slug, available: false, reason: "Git could not list this change. The two commits resolve, but the diff between them failed or timed out.", range: range.range, files: [], records: [], totals: NO_TOTALS };
  }
  const files = entries.filter((e) => !isRecordPath(e.path)).map(publicFile);
  const records = entries.filter((e) => isRecordPath(e.path)).map(publicFile);
  const totals = files.reduce<ChangeTotals>((t, f) => ({ files: t.files + 1, added: t.added + f.added, deleted: t.deleted + f.deleted }), NO_TOTALS);
  return { slug, available: true, reason: null, range: range.range, files, records, totals };
}

/** A task's change list in one call: the range, the list, the payload. */
export function taskChanges(root: string, task: RangeTask, baseName: string): TaskChanges {
  const range = taskRange(root, task, baseName);
  return changesPayload(task.slug, range, range.ok ? listChanges(root, range.range) : []);
}

// ---------------------------------------------------------------------------
// One file's patch
// ---------------------------------------------------------------------------

export interface PatchLine {
  kind: "ctx" | "add" | "del";
  /** The line without its sign and without a trailing carriage return. */
  text: string;
  /** Set by a `\ No newline at end of file` marker that followed this line. */
  noeol?: true;
}

export interface PatchHunk {
  oldStart: number;
  oldCount: number;
  newStart: number;
  newCount: number;
  lines: PatchLine[];
}

export interface ParsedPatch {
  hunks: PatchHunk[];
  /** A hunk ended before its header's counts were met, or a line carried no sign: the patch cannot be trusted. */
  malformed: boolean;
  /** Parsing stopped because the hunk lines passed `maxLines`; what was read so far is not the whole patch. */
  overflow?: true;
}

const HUNK_HEADER = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

/**
 * Read the hunks of one file's patch. Paths in the header are ignored, since the list already knows
 * them and the header forms are quoted, tab-suffixed and prefix-dependent. Inside a hunk the `@@`
 * header's counts say how many old and new lines follow, and only the first character of a line is
 * its sign: `--- a/old.ts` there is a deleted line reading `-- a/old.ts`, and `+@@ -9,9 +9,9 @@` is
 * an added line. `\ No newline at end of file` flags the line before it and is never a line itself.
 * A type change prints two sections for one path; both sets of hunks are read.
 *
 * The text is walked with a cursor rather than split, and `maxLines` stops the walk once that many
 * hunk lines have been read, so a patch of millions of lines costs what the cap allows and no more. Pure.
 */
export function parsePatch(text: string, maxLines = Number.POSITIVE_INFINITY): ParsedPatch {
  const hunks: PatchHunk[] = [];
  let malformed = false;
  let read = 0;
  let pos = 0;
  /** The line at the cursor, whether a newline ended it, and the cursor after it. Past the end: null. */
  const peek = (): { raw: string; terminated: boolean; next: number } | null => {
    if (pos > text.length) return null;
    const end = text.indexOf("\n", pos);
    return end < 0 ? { raw: text.slice(pos), terminated: false, next: text.length + 1 } : { raw: text.slice(pos, end), terminated: true, next: end + 1 };
  };
  for (let line = peek(); line !== null; line = peek()) {
    pos = line.next;
    const m = HUNK_HEADER.exec(line.raw);
    if (!m) continue;
    const hunk: PatchHunk = {
      oldStart: Number.parseInt(m[1] ?? "0", 10),
      oldCount: m[2] === undefined ? 1 : Number.parseInt(m[2], 10),
      newStart: Number.parseInt(m[3] ?? "0", 10),
      newCount: m[4] === undefined ? 1 : Number.parseInt(m[4], 10),
      lines: [],
    };
    let oldLeft = hunk.oldCount;
    let newLeft = hunk.newCount;
    for (let body = peek(); body !== null; body = peek()) {
      const raw = body.raw;
      const sign = raw.charAt(0);
      if (sign === "\\") {
        const last = hunk.lines[hunk.lines.length - 1];
        if (last) last.noeol = true;
        pos = body.next;
        continue;
      }
      if (oldLeft === 0 && newLeft === 0) break;
      if (read >= maxLines) return { hunks, malformed: false, overflow: true };
      // An empty line a newline ended is an empty context line under `diff.suppressBlankEmpty`; the one after the last newline is the end of the text.
      const kind = sign === "+" ? "add" : sign === "-" ? "del" : sign === " " || (raw === "" && body.terminated) ? "ctx" : null;
      if (kind === null || (kind !== "add" && oldLeft === 0) || (kind !== "del" && newLeft === 0)) {
        malformed = true;
        break;
      }
      const text1 = raw.slice(1);
      hunk.lines.push({ kind, text: text1.endsWith("\r") ? text1.slice(0, -1) : text1 });
      if (kind !== "add") oldLeft -= 1;
      if (kind !== "del") newLeft -= 1;
      read += 1;
      pos = body.next;
    }
    if (oldLeft !== 0 || newLeft !== 0) malformed = true;
    hunks.push(hunk);
    if (malformed) break;
  }
  return { hunks, malformed };
}

// ---------------------------------------------------------------------------
// Rows
// ---------------------------------------------------------------------------

export type DiffRow =
  | { kind: "ctx"; old: number; new: number; text: string; noeol?: true; cut?: true }
  | { kind: "add"; new: number; text: string; noeol?: true; cut?: true }
  | { kind: "del"; old: number; text: string; noeol?: true; cut?: true }
  /** Unchanged lines that are not shown: how many, and the new-side number of the first. */
  | { kind: "gap"; count: number; new: number };

/** New-side lines that sit before a hunk. A count of zero makes the start the line before, not the first line. */
function newLinesBefore(h: PatchHunk): number {
  return h.newCount === 0 ? h.newStart : Math.max(0, h.newStart - 1);
}

/**
 * The rows the reader draws: every hunk line with its old and new numbers, and a gap row wherever
 * unchanged lines are folded away — before the first hunk, between hunks, and after the last when the
 * new side's line count is known. A change at line 1,500 is as reachable as one at line 5. Pure.
 */
export function diffRows(hunks: readonly PatchHunk[], newLineCount: number | null): DiffRow[] {
  const rows: DiffRow[] = [];
  let shown = 0; // new-side lines accounted for so far
  const gap = (upTo: number): void => {
    if (upTo > shown) rows.push({ kind: "gap", count: upTo - shown, new: shown + 1 });
  };
  for (const h of hunks) {
    gap(newLinesBefore(h));
    let o = h.oldStart;
    let n = h.newStart;
    for (const line of h.lines) {
      const cut = line.text.length > DIFF_ROW_CHARS;
      const extra = { text: cut ? cutText(line.text) : line.text, ...(line.noeol ? { noeol: true as const } : {}), ...(cut ? { cut: true as const } : {}) };
      if (line.kind === "ctx") rows.push({ kind: "ctx", old: o++, new: n++, ...extra });
      else if (line.kind === "add") rows.push({ kind: "add", new: n++, ...extra });
      else rows.push({ kind: "del", old: o++, ...extra });
    }
    shown = newLinesBefore(h) + h.newCount;
  }
  if (hunks.length > 0 && newLineCount !== null) gap(newLineCount);
  return rows;
}

/**
 * The first `DIFF_ROW_CHARS` of a long line, never ending on half a character: a cut that lands
 * between the two halves of a surrogate pair gives the first half back too. The result is copied out
 * of the line, because a slice of a 5 MB line keeps all 5 MB alive for as long as the row is kept.
 */
function cutText(text: string): string {
  const last = text.charCodeAt(DIFF_ROW_CHARS - 1);
  const end = last >= 0xd800 && last <= 0xdbff ? DIFF_ROW_CHARS - 1 : DIFF_ROW_CHARS;
  return Buffer.from(text.slice(0, end), "utf8").toString("utf8");
}

/** Lines in a text the way git counts them: a last line with no newline still counts. */
export function countLines(text: string): number {
  if (text === "") return 0;
  let n = 0;
  for (let i = text.indexOf("\n"); i >= 0; i = text.indexOf("\n", i + 1)) n += 1;
  return text.endsWith("\n") ? n : n + 1;
}

// ---------------------------------------------------------------------------
// One file's answer
// ---------------------------------------------------------------------------

export type DiffCardKind = "binary" | "mode" | "renamed" | "empty" | "symlink" | "deleted" | "unreadable";

/** What the reader says when there is nothing to draw, or above the rows when the rows need a word of explanation. */
export interface DiffCard {
  kind: DiffCardKind;
  /** A sentence of Reggie's own; never git's output. */
  text: string;
  /** `binary` only: bytes before and after; null on the side that does not exist. */
  oldSize?: number | null;
  newSize?: number | null;
}

export interface FileDiff extends ChangedFile {
  slug: string;
  range: ChangeRange;
  card: DiffCard | null;
  rows: DiffRow[];
  /** Index of the first row returned. */
  offset: number;
  /** Rows the whole change has, gap rows included. */
  totalRows: number;
  /** Rows remain past the ones returned. */
  truncated: boolean;
  /** A landed task only: the file at HEAD is no longer the one that landed, so these numbers are the landing's. Null for a live branch. */
  changedSince: boolean | null;
}

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;
}

function sizeText(n: number | null): string {
  return n === null ? "nothing" : plural(n, "byte");
}

function cardFor(entry: ChangeEntry, sizes: { oldSize: number | null; newSize: number | null } | null, hunks: number, unreadable: string | null): DiffCard | null {
  if (unreadable) return { kind: "unreadable", text: unreadable };
  if (entry.binary && sizes) {
    return { kind: "binary", text: `A binary file, so there are no lines to show: ${sizeText(sizes.oldSize)} before, ${sizeText(sizes.newSize)} after.`, ...sizes };
  }
  if (entry.status === "deleted") {
    return { kind: "deleted", text: hunks > 0 ? `This file was deleted. The ${plural(entry.deleted, "line")} below ${entry.deleted === 1 ? "is" : "are"} what was removed.` : "This file was deleted. It was empty, so there are no lines to show." };
  }
  if (entry.newMode === SYMLINK_MODE) return { kind: "symlink", text: "A symbolic link. Its one line is the path it points at." };
  if (entry.status === "renamed" || entry.status === "copied") {
    const verb = entry.status === "renamed" ? "Renamed" : "Copied";
    const tail = hunks > 0 ? `${entry.similarity ?? 0}% alike; the rows below are what changed on the way.` : "Nothing inside it changed, so there are no lines to show.";
    return { kind: "renamed", text: `${verb} from ${entry.from ?? "another path"}. ${tail}` };
  }
  if (entry.oldMode !== null && entry.newMode !== null && entry.oldMode !== entry.newMode) {
    return { kind: "mode", text: `The file's mode changed from ${entry.oldMode} to ${entry.newMode}.${hunks > 0 ? "" : " Nothing inside it changed, so there are no lines to show."}` };
  }
  if (hunks === 0) return { kind: "empty", text: entry.status === "added" ? "An empty file was added: there are no lines to show." : "Nothing inside this file changed, so there are no lines to show." };
  return null;
}

/** The part of a file's answer that two commit ids and a path fix for ever: its rows and its card. */
export interface BuiltDiff {
  rows: DiffRow[];
  card: DiffCard | null;
  /** Git failed or timed out: the next request should ask again, so this answer is never kept. */
  transient?: true;
}

/**
 * One listed file's change as rows. The entry must come from `listChanges` for the same range: the
 * paths handed to git are the entry's own, never a caller's string. A failed or oversized patch, a
 * change with more rows than the cap, a patch whose hunks do not add up, and a patch that disagrees
 * with the counts git itself reported are all answered with an `unreadable` card rather than with
 * rows that might be wrong or that the server cannot afford.
 */
export function buildFileDiff(root: string, range: ChangeRange, entry: ChangeEntry, limits: DiffLimits = DEFAULT_LIMITS): BuiltDiff {
  if (entry.binary) {
    return { rows: [], card: cardFor(entry, { oldSize: entry.oldBlob ? blobSize(root, entry.oldBlob) : null, newSize: entry.newBlob ? blobSize(root, entry.newBlob) : null }, 0, null) };
  }
  const tooMany = (what: string): BuiltDiff => ({
    rows: [],
    card: cardFor(entry, null, 0, `${what} more rows than Reggie draws (${limits.maxRows.toLocaleString("en-US")}). Read it in a terminal instead.`),
  });
  const withContext = "This file's change, with the unchanged lines shown around it, comes to";
  // Git's own count, known from the list before the patch is asked for.
  if (entry.added + entry.deleted > limits.maxRows) return tooMany(`This file changed ${plural(entry.added + entry.deleted, "line")}, which is`);

  const patch = patchFor(root, range.base, range.ref, entry.from ? [entry.from, entry.path] : [entry.path], limits.maxPatchBytes);
  if (patch === null) {
    return { rows: [], transient: true, card: cardFor(entry, null, 0, "Git could not produce this file's patch: it failed, timed out, or the patch is larger than Reggie reads. Read it in a terminal instead.") };
  }
  const parsed = parsePatch(patch, limits.maxRows);
  if (parsed.overflow) return tooMany(withContext);
  let unreadable: string | null = null;
  if (parsed.malformed) unreadable = "This file's patch did not add up to the line counts in its own headers, so it is not shown rather than shown wrong.";
  else {
    let added = 0;
    let deleted = 0;
    for (const h of parsed.hunks) for (const l of h.lines) if (l.kind === "add") added += 1; else if (l.kind === "del") deleted += 1;
    if (added !== entry.added || deleted !== entry.deleted) unreadable = "This file's patch disagrees with the counts git reported for it, so it is not shown rather than shown wrong.";
  }
  if (unreadable) return { rows: [], card: cardFor(entry, null, 0, unreadable) };

  const newText = parsed.hunks.length > 0 && entry.newBlob ? blobText(root, entry.newBlob) : null;
  const rows = diffRows(parsed.hunks, newText === null ? (entry.newBlob ? null : 0) : countLines(newText));
  if (rows.length > limits.maxRows) return tooMany(withContext);
  return { rows, card: cardFor(entry, null, parsed.hunks.length, null) };
}

export interface DiffRowCacheOptions {
  maxEntries?: number;
  /** Rows held across every entry. */
  maxRows?: number;
  /** Characters of row text held across every entry. */
  maxChars?: number;
}

/**
 * Built rows, kept so that paging slices an array instead of asking git for the patch and parsing
 * it again on every page. What two commit ids and a path produce can never change, so an entry is
 * never stale; the only question is how much to hold, and the answer is small: a handful of files,
 * bounded by entries, by rows and by the text those rows carry, least recently read out first.
 */
export class DiffRowCache {
  private readonly entries = new Map<string, { built: BuiltDiff; chars: number }>();
  private readonly maxEntries: number;
  private readonly maxRows: number;
  private readonly maxChars: number;
  private rows = 0;
  private chars = 0;

  constructor(opts: DiffRowCacheOptions = {}) {
    this.maxEntries = opts.maxEntries ?? 8;
    this.maxRows = opts.maxRows ?? 2 * DIFF_MAX_ROWS;
    this.maxChars = opts.maxChars ?? 32 * 1024 * 1024;
  }

  static key(slug: string, range: ChangeRange, entry: ChangeEntry): string {
    return [slug, range.base, range.ref, entry.from ?? "", entry.path].join("\0");
  }

  get(key: string): BuiltDiff | undefined {
    const hit = this.entries.get(key);
    if (!hit) return undefined;
    this.entries.delete(key);
    this.entries.set(key, hit);
    return hit.built;
  }

  set(key: string, built: BuiltDiff): void {
    this.drop(key);
    let chars = 0;
    for (const r of built.rows) if (r.kind !== "gap") chars += r.text.length;
    if (built.rows.length > this.maxRows || chars > this.maxChars) return;
    this.entries.set(key, { built, chars });
    this.rows += built.rows.length;
    this.chars += chars;
    for (const oldest of this.entries.keys()) {
      if (this.entries.size <= this.maxEntries && this.rows <= this.maxRows && this.chars <= this.maxChars) break;
      this.drop(oldest);
    }
  }

  private drop(key: string): void {
    const gone = this.entries.get(key);
    if (!gone) return;
    this.entries.delete(key);
    this.rows -= gone.built.rows.length;
    this.chars -= gone.chars;
  }
}

/**
 * One page of one listed file's answer. The rows come from `cache` when it has them; what depends
 * on this checkout's HEAD, `changedSince`, is asked every time and never kept.
 */
export function fileDiff(root: string, slug: string, range: ChangeRange, entry: ChangeEntry, offset = 0, cache?: DiffRowCache): FileDiff {
  const key = DiffRowCache.key(slug, range, entry);
  let built = cache?.get(key);
  if (!built) {
    built = buildFileDiff(root, range, entry);
    if (!built.transient) cache?.set(key, built);
  }

  let changedSince: boolean | null = null;
  if (range.kind === "merge") {
    const head = resolveCommit(root, "HEAD");
    const now = head ? blobAt(root, head, entry.path) : null;
    changedSince = now !== entry.newBlob;
  }

  const start = Number.isFinite(offset) ? Math.max(0, Math.floor(offset)) : 0;
  const page = built.rows.slice(start, start + DIFF_PAGE_ROWS);
  return { ...publicFile(entry), slug, range, card: built.card, rows: page, offset: start, totalRows: built.rows.length, truncated: start + page.length < built.rows.length, changedSince };
}
