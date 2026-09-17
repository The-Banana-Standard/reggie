import { blobAt, blobSize, blobText, commitCount, diffRawRange, isFullSha, mergeBase, numstatRange, patchFor, resolveCommit } from "./git.js";
import { emptyHistoryIndex, taskLanding, type HistoryIndex } from "./history.js";
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

export interface RangeOptions {
  /** An index already read, handed to `taskLanding` so it reads nothing twice. */
  index?: HistoryIndex;
}

/**
 * The range a task's change is read over, in this order: a task that is not done and whose branch is
 * ahead of the base reads from the merge base to the tip, which is what a merge would land and stays
 * right when the branch merged the base back in; otherwise the merge that landed it, against its first
 * parent; otherwise a branch that still resolves, from its merge base. Every name is resolved once to
 * a full commit id here, and nothing but those ids goes on to the diff readers.
 */
export function taskRange(root: string, task: RangeTask, baseName: string, opts: RangeOptions = {}): RangeResult {
  if (!isSafeSlug(task.slug)) return { ok: false, reason: "That is not a task slug." };
  const base = resolveCommit(root, baseName) ?? resolveCommit(root, `origin/${baseName}`);
  if (!base) return { ok: false, reason: `The integration branch ${baseName} does not resolve to a commit in this clone, so there is nothing to measure a change against.` };

  // Only the two names tasks.ts builds from a safe slug are ever resolved; anything else is no branch.
  const branchRef = task.branchRef === `task/${task.slug}` || task.branchRef === `origin/task/${task.slug}` ? task.branchRef : null;
  const tip = branchRef ? resolveCommit(root, branchRef) : null;
  const fork = tip ? mergeBase(root, base, tip) : null;
  const ahead = tip ? (commitCount(root, base, tip) ?? 0) : 0;
  const live: ChangeRange | null = tip && fork ? { kind: "branch", base: fork, ref: tip, baseName, refName: branchRef ?? "", commits: ahead } : null;

  if (task.state !== "done" && live && ahead > 0) return { ok: true, range: live };

  const landing = taskLanding(root, task.slug, { base: baseName, index: opts.index ?? emptyHistoryIndex() });
  const [first, second] = landing.merge?.parents ?? [];
  if (landing.merge && first && second && isFullSha(first) && isFullSha(landing.merge.sha)) {
    return { ok: true, range: { kind: "merge", base: first, ref: landing.merge.sha, baseName, refName: landing.merge.subject, commits: landing.commits.length } };
  }

  if (live) return { ok: true, range: live };
  if (tip) return { ok: false, reason: `${branchRef} shares no history with ${baseName}, so there is no point to measure its change from.` };
  if (task.state === "done") {
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
export function taskChanges(root: string, task: RangeTask, baseName: string, opts: RangeOptions = {}): TaskChanges {
  const range = taskRange(root, task, baseName, opts);
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
}

const HUNK_HEADER = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

/**
 * Read the hunks of one file's patch. Paths in the header are ignored, since the list already knows
 * them and the header forms are quoted, tab-suffixed and prefix-dependent. Inside a hunk the `@@`
 * header's counts say how many old and new lines follow, and only the first character of a line is
 * its sign: `--- a/old.ts` there is a deleted line reading `-- a/old.ts`, and `+@@ -9,9 +9,9 @@` is
 * an added line. `\ No newline at end of file` flags the line before it and is never a line itself.
 * A type change prints two sections for one path; both sets of hunks are read. Pure.
 */
export function parsePatch(text: string): ParsedPatch {
  const lines = text.split("\n");
  const hunks: PatchHunk[] = [];
  let malformed = false;
  let i = 0;
  while (i < lines.length) {
    const m = HUNK_HEADER.exec(lines[i] ?? "");
    i += 1;
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
    while (i < lines.length) {
      const raw = lines[i] ?? "";
      const sign = raw.charAt(0);
      if (sign === "\\") {
        const last = hunk.lines[hunk.lines.length - 1];
        if (last) last.noeol = true;
        i += 1;
        continue;
      }
      if (oldLeft === 0 && newLeft === 0) break;
      // An empty line is an empty context line under `diff.suppressBlankEmpty`; the last one is the end of the text.
      const kind = sign === "+" ? "add" : sign === "-" ? "del" : sign === " " || (raw === "" && i < lines.length - 1) ? "ctx" : null;
      if (kind === null || (kind !== "add" && oldLeft === 0) || (kind !== "del" && newLeft === 0)) {
        malformed = true;
        break;
      }
      const body = raw.slice(1);
      hunk.lines.push({ kind, text: body.endsWith("\r") ? body.slice(0, -1) : body });
      if (kind !== "add") oldLeft -= 1;
      if (kind !== "del") newLeft -= 1;
      i += 1;
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
      const extra = { text: cut ? line.text.slice(0, DIFF_ROW_CHARS) : line.text, ...(line.noeol ? { noeol: true as const } : {}), ...(cut ? { cut: true as const } : {}) };
      if (line.kind === "ctx") rows.push({ kind: "ctx", old: o++, new: n++, ...extra });
      else if (line.kind === "add") rows.push({ kind: "add", new: n++, ...extra });
      else rows.push({ kind: "del", old: o++, ...extra });
    }
    shown = newLinesBefore(h) + h.newCount;
  }
  if (hunks.length > 0 && newLineCount !== null) gap(newLineCount);
  return rows;
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

/**
 * One listed file's change as rows. The entry must come from `listChanges` for the same range: the
 * paths handed to git are the entry's own, never a caller's string. A failed or oversized patch, a
 * patch whose hunks do not add up, and a patch that disagrees with the counts git itself reported are
 * all answered with an `unreadable` card rather than with rows that might be wrong.
 */
export function fileDiff(root: string, slug: string, range: ChangeRange, entry: ChangeEntry, offset = 0): FileDiff {
  let rows: DiffRow[] = [];
  let card: DiffCard | null;
  if (entry.binary) {
    card = cardFor(entry, { oldSize: entry.oldBlob ? blobSize(root, entry.oldBlob) : null, newSize: entry.newBlob ? blobSize(root, entry.newBlob) : null }, 0, null);
  } else {
    const patch = patchFor(root, range.base, range.ref, entry.from ? [entry.from, entry.path] : [entry.path]);
    const parsed = patch === null ? null : parsePatch(patch);
    let unreadable: string | null = null;
    if (parsed === null) unreadable = "Git could not produce this file's patch: it failed, timed out, or the patch is larger than Reggie reads. Read it in a terminal instead.";
    else if (parsed.malformed) unreadable = "This file's patch did not add up to the line counts in its own headers, so it is not shown rather than shown wrong.";
    else {
      const all = parsed.hunks.flatMap((h) => h.lines);
      const added = all.filter((l) => l.kind === "add").length;
      const deleted = all.filter((l) => l.kind === "del").length;
      if (added !== entry.added || deleted !== entry.deleted) unreadable = "This file's patch disagrees with the counts git reported for it, so it is not shown rather than shown wrong.";
    }
    if (parsed && !unreadable) {
      const newText = parsed.hunks.length > 0 && entry.newBlob ? blobText(root, entry.newBlob) : null;
      rows = diffRows(parsed.hunks, newText === null ? (entry.newBlob ? null : 0) : countLines(newText));
    }
    card = cardFor(entry, null, unreadable ? 0 : (parsed?.hunks.length ?? 0), unreadable);
  }

  let changedSince: boolean | null = null;
  if (range.kind === "merge") {
    const head = resolveCommit(root, "HEAD");
    const now = head ? blobAt(root, head, entry.path) : null;
    changedSince = now !== entry.newBlob;
  }

  const start = Math.max(0, Math.floor(offset));
  const page = rows.slice(start, start + DIFF_PAGE_ROWS);
  return { ...publicFile(entry), slug, range, card, rows: page, offset: start, totalRows: rows.length, truncated: start + page.length < rows.length, changedSince };
}
