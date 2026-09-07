import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { git } from "./git.js";
import { repoPaths } from "./paths.js";
import { handleFor, loadPeople, type PeopleFile } from "./people.js";
import { isSafeSlug, nowIso, today } from "./util.js";

/*
 * Git history, read once per HEAD sha.
 *
 * One `git log --numstat` over the last year is parsed into per-path churn and ownership
 * (files, every ancestor directory, and the repo as a whole), the last eight commits per
 * path, commits per day, and a lastTouched map that lets notes.ts decide staleness without
 * one git call per note. The parsed log is cached in memory and on disk under
 * `.reggie/.cache/history-<sha>.json`; the derived numbers are recomputed from it whenever
 * the day, the people file, or the reference instant changes, so a long-running server
 * does not report a stale "last 30 days".
 *
 * Keys in the index: files by repo-relative path (`src/a.ts`), directories with a trailing
 * slash (`src/`), the repo root as `./`. `historyFor` accepts any spelling.
 */

export interface Author {
  handle: string;
  name: string;
  email: string;
  lines: number;
  commits: number;
  /** Share of lines changed (0..1); share of commits when no lines were counted. */
  share: number;
}

export interface History {
  /**
   * Commits in the window. A number for anything git has seen; `null` only on the `noHistory()`
   * marker a view attaches to a node with no git history at all, so a client can draw "unknown"
   * apart from "cold" (0 commits in the window but commits before it).
   */
  commits30: number | null;
  commits90: number | null;
  commits365: number | null;
  linesChanged: number;
  /** ISO author date of the newest commit touching the path, or null. */
  lastTouched: string | null;
  authors: Author[];
  /** Authors holding at least 20% of the lines changed; at least 1 when anyone touched the path, 0 when nobody did. */
  busFactor: number;
}

export interface CommitInfo {
  sha: string;
  author: string;
  handle: string;
  date: string;
  subject: string;
  /** Task slug from the `Task:` trailer, else from a `task/<slug>` branch name in the subject. */
  task: string | null;
}

/** One file line of a commit's numstat block. Binary files count as 0/0. */
export interface LogFile {
  path: string;
  added: number;
  deleted: number;
  /** Previous path when the commit renamed the file; stats attribute to `path`. */
  from?: string;
}

/** One parsed commit; the unit the disk cache stores. Newest first in every list. */
export interface LogCommit {
  sha: string;
  author: string;
  email: string;
  date: string;
  subject: string;
  task: string | null;
  files: LogFile[];
}

export interface HistoryIndex {
  /** HEAD sha the log was read at; "" for a repo without commits. */
  sha: string;
  /** The `--since` value the log was read with. */
  since: string;
  /** When the log was read from git. */
  generatedAt: string;
  /** The instant the day windows (30/90/365) were computed against. */
  asOf: string;
  totalCommits: number;
  /** Every commit in the window, newest first. */
  commits: CommitInfo[];
  /**
   * The same commits with their file lists, index-aligned with `commits`. This is the input
   * `historyForFiles` needs: an arbitrary file set is not a path in `byPath`, so a roll-up over
   * one has to see which commits touched which files to count each commit once.
   */
  log: LogCommit[];
  /** Files by path, directories as `<path>/`, the repo as `./`. */
  byPath: Map<string, History>;
  /** Last eight commits per key, newest first. */
  commitsByPath: Map<string, CommitInfo[]>;
  /** Per key: `YYYY-MM-DD` (author-local) → distinct commits that day. */
  commitsPerDay: Map<string, Map<string, number>>;
  /** Per key: ISO author date of the newest commit; feeds `staleEntriesFor`. */
  lastTouched: Map<string, string>;
}

export interface HistoryOptions {
  /** Passed to `git log --since`; default `365.days`. */
  since?: string;
  /** Reference instant for the day windows; default now. */
  now?: Date;
  /** HEAD sha when the caller already resolved it (saves a git call). */
  sha?: string;
  /** People file when already loaded; default `loadPeople`. */
  people?: PeopleFile;
  /** Read and write `.reggie/.cache/history-<sha>.json`; default true. */
  diskCache?: boolean;
}

export const HISTORY_LOG_FORMAT = "%H|%an|%ae|%aI|%s|%(trailers:key=Task,valueonly,separator=;)";
export const HISTORY_DEFAULT_SINCE = "365.days";
export const HISTORY_RECENT_LIMIT = 8;
export const HISTORY_CACHE_DIR = path.join(".reggie", ".cache");
const CACHE_VERSION = 1;
const DAY_MS = 86_400_000;

interface CacheFile {
  version: number;
  sha: string;
  since: string;
  generatedAt: string;
  commits: LogCommit[];
}

interface MemoryEntry {
  logKey: string;
  generatedAt: string;
  commits: LogCommit[];
  deriveKey: string;
  index: HistoryIndex;
}

const memory = new Map<string, MemoryEntry>();

/** Drop the in-memory cache for one root, or for every root. Disk files are left alone. */
export function clearHistoryCache(root?: string): void {
  if (root === undefined) memory.clear();
  else memory.delete(path.resolve(root));
}

export function emptyHistory(): History {
  return { commits30: 0, commits90: 0, commits365: 0, linesChanged: 0, lastTouched: null, authors: [], busFactor: 0 };
}

export function emptyHistoryIndex(since = HISTORY_DEFAULT_SINCE, now: Date = new Date()): HistoryIndex {
  return {
    sha: "",
    since,
    generatedAt: now.toISOString(),
    asOf: now.toISOString(),
    totalCommits: 0,
    commits: [],
    log: [],
    byPath: new Map(),
    commitsByPath: new Map(),
    commitsPerDay: new Map(),
    lastTouched: new Map(),
  };
}

/**
 * The history index for a repo, built once per HEAD sha. Returns an empty index when the
 * repo has no commits or git fails; never throws for a missing history.
 */
export function repoHistory(root: string, opts: HistoryOptions = {}): HistoryIndex {
  const absRoot = path.resolve(root);
  const since = opts.since ?? HISTORY_DEFAULT_SINCE;
  const now = opts.now ?? new Date();
  const sha = opts.sha ?? headSha(absRoot);
  if (!sha) return emptyHistoryIndex(since, now);
  const people = opts.people ?? loadPeople(repoPaths(absRoot));
  const useDisk = opts.diskCache ?? true;
  const logKey = `${sha}|${since}`;
  const deriveKey = `${today(now)}|${opts.now ? now.toISOString() : ""}|${peopleFingerprint(people)}`;

  const mem = memory.get(absRoot);
  if (mem && mem.logKey === logKey) {
    if (mem.deriveKey === deriveKey) return mem.index;
    const index = deriveHistory(mem.commits, { sha, since, now, people, generatedAt: mem.generatedAt });
    memory.set(absRoot, { ...mem, deriveKey, index });
    return index;
  }

  const cached = useDisk ? readDiskCache(absRoot, sha, since) : null;
  let commits: LogCommit[];
  let generatedAt: string;
  if (cached) {
    commits = cached.commits;
    generatedAt = cached.generatedAt;
  } else {
    commits = readGitLog(absRoot, since);
    generatedAt = nowIso();
    if (useDisk) writeDiskCache(absRoot, { version: CACHE_VERSION, sha, since, generatedAt, commits });
  }
  const index = deriveHistory(commits, { sha, since, now, people, generatedAt });
  memory.set(absRoot, { logKey, generatedAt, commits, deriveKey, index });
  return index;
}

/** Run the one git log and parse it. Empty when git fails (no commits, not a repo). */
export function readGitLog(root: string, since: string = HISTORY_DEFAULT_SINCE): LogCommit[] {
  const r = git(
    ["-c", "core.quotePath=false", "log", "--numstat", "-M", `--format=${HISTORY_LOG_FORMAT}`, `--since=${since}`, "HEAD"],
    { cwd: root, allowFailure: true },
  );
  if (!r.ok) return [];
  return parseNumstatLog(r.stdout);
}

/** Parse the output of `git log --numstat --format=HISTORY_LOG_FORMAT`. Pure. */
export function parseNumstatLog(text: string): LogCommit[] {
  const out: LogCommit[] = [];
  let current: LogCommit | null = null;
  for (const rawLine of text.split("\n")) {
    const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;
    if (line === "") continue;
    const header = parseHeaderLine(line);
    if (header) {
      current = header;
      out.push(current);
      continue;
    }
    if (!current) continue;
    const stat = /^(\d+|-)\t(\d+|-)\t(.+)$/.exec(line);
    if (!stat) continue;
    const added = stat[1] === "-" ? 0 : Number.parseInt(stat[1] ?? "0", 10);
    const deleted = stat[2] === "-" ? 0 : Number.parseInt(stat[2] ?? "0", 10);
    const { path: filePath, from } = parseNumstatPath(stat[3] ?? "");
    if (!filePath) continue;
    const file: LogFile = { path: filePath, added, deleted };
    if (from !== undefined && from !== filePath) file.from = from;
    current.files.push(file);
  }
  return out;
}

function parseHeaderLine(line: string): LogCommit | null {
  if (!/^[0-9a-f]{40}\|/.test(line)) return null;
  const parts = line.split("|");
  if (parts.length < 6) return null;
  const sha = parts[0] ?? "";
  const author = parts[1] ?? "";
  const email = parts[2] ?? "";
  const date = parts[3] ?? "";
  // The subject may itself contain "|"; the trailer field is always last.
  const trailers = parts[parts.length - 1] ?? "";
  const subject = parts.slice(4, -1).join("|");
  return { sha, author, email, date, subject, task: taskFromTrailers(trailers) ?? taskFromSubject(subject), files: [] };
}

/** First valid slug among `Task:` trailer values (git joins several with `;`). */
export function taskFromTrailers(value: string): string | null {
  for (const piece of value.split(";")) {
    const slug = piece.trim().toLowerCase();
    if (slug && isSafeSlug(slug)) return slug;
  }
  return null;
}

/** `Merge branch 'task/foo'`, `Merge pull request #5 from org/task/foo`, `task/foo: …` → `foo`. */
export function taskFromSubject(subject: string): string | null {
  const m = /(?:^|[^a-z0-9])task\/([a-z0-9][a-z0-9-]{0,79})/i.exec(subject);
  const slug = m?.[1]?.toLowerCase() ?? "";
  return slug && isSafeSlug(slug) ? slug : null;
}

/** Resolve a numstat path, handling `a => b`, `src/{a => b}/x.ts`, `src/{ => new}/x.ts`, and C-quoted names. */
export function parseNumstatPath(raw: string): { path: string; from?: string } {
  if (raw.includes(" => ")) {
    const brace = /^(.*)\{(.*) => (.*)\}(.*)$/.exec(raw);
    if (brace) {
      const pre = brace[1] ?? "";
      const oldMid = brace[2] ?? "";
      const newMid = brace[3] ?? "";
      const post = brace[4] ?? "";
      return { path: collapse(`${pre}${newMid}${post}`), from: collapse(`${pre}${oldMid}${post}`) };
    }
    const idx = raw.indexOf(" => ");
    return { path: unquotePath(raw.slice(idx + 4)), from: unquotePath(raw.slice(0, idx)) };
  }
  return { path: unquotePath(raw) };
}

function collapse(p: string): string {
  return unquotePath(p).replace(/\/{2,}/g, "/").replace(/^\.\//, "").replace(/^\/+/, "");
}

/** Undo git's C-style quoting (`"src/caf\303\251.ts"`) when present. */
export function unquotePath(raw: string): string {
  const s = raw.trim();
  if (s.length < 2 || !s.startsWith('"') || !s.endsWith('"')) return s;
  const inner = s.slice(1, -1);
  const bytes: number[] = [];
  const simple: Record<string, number> = { a: 7, b: 8, t: 9, n: 10, v: 11, f: 12, r: 13, '"': 34, "\\": 92 };
  for (let i = 0; i < inner.length; i += 1) {
    const ch = inner[i] ?? "";
    if (ch !== "\\") {
      bytes.push(...Buffer.from(ch, "utf8"));
      continue;
    }
    const next = inner[i + 1] ?? "";
    if (/[0-7]/.test(next)) {
      const oct = /^[0-7]{1,3}/.exec(inner.slice(i + 1))?.[0] ?? next;
      bytes.push(Number.parseInt(oct, 8) & 0xff);
      i += oct.length;
      continue;
    }
    const code = simple[next];
    if (code !== undefined) {
      bytes.push(code);
      i += 1;
      continue;
    }
    bytes.push(...Buffer.from(next, "utf8"));
    i += 1;
  }
  return Buffer.from(bytes).toString("utf8");
}

interface DeriveOptions {
  sha: string;
  since: string;
  now: Date;
  people: PeopleFile;
  generatedAt: string;
}

interface Acc {
  commits30: number;
  commits90: number;
  commits365: number;
  lines: number;
  lastMs: number;
  lastIso: string | null;
  authors: Map<string, { name: string; email: string; lines: number; commits: number }>;
  recent: CommitInfo[];
  perDay: Map<string, number>;
}

function newAcc(): Acc {
  return { commits30: 0, commits90: 0, commits365: 0, lines: 0, lastMs: -Infinity, lastIso: null, authors: new Map(), recent: [], perDay: new Map() };
}

/**
 * Turn parsed commits into the index. One streaming pass: every commit is attributed once to
 * each file it touched, once to each ancestor directory of those files, and once to the repo
 * (`./`, which also receives merge and empty commits), so directory counts never double count
 * a commit that touched several files. Pure apart from the clock passed in.
 */
export function deriveHistory(commits: LogCommit[], opts: DeriveOptions): HistoryIndex {
  const nowMs = opts.now.getTime();
  const sinceMs = sinceToMs(opts.since, nowMs);
  const handles = handleResolver(opts.people);
  const accs = new Map<string, Acc>();
  const all: CommitInfo[] = [];
  const log: LogCommit[] = [];

  for (const c of commits) {
    const ms = Date.parse(c.date);
    const dateMs = Number.isFinite(ms) ? ms : nowMs;
    if (sinceMs !== null && dateMs < sinceMs) continue;
    const info: CommitInfo = { sha: c.sha, author: c.author, handle: handles(c.author, c.email), date: c.date, subject: c.subject, task: c.task };
    all.push(info);
    log.push(c);

    const touched = new Map<string, number>();
    for (const f of c.files) {
      const lines = f.added + f.deleted;
      bump(touched, f.path, lines);
      for (const dir of ancestorKeys(f.path)) bump(touched, dir, lines);
    }
    if (!touched.has("./")) touched.set("./", 0);

    for (const [key, lines] of touched) {
      let acc = accs.get(key);
      if (!acc) {
        acc = newAcc();
        accs.set(key, acc);
      }
      record(acc, info, c, dateMs, lines, nowMs);
    }
  }

  const index = emptyHistoryIndex(opts.since, opts.now);
  index.sha = opts.sha;
  index.generatedAt = opts.generatedAt;
  index.totalCommits = all.length;
  index.commits = all;
  index.log = log;
  for (const [key, acc] of accs) {
    index.byPath.set(key, finalize(acc, handles));
    index.commitsByPath.set(key, acc.recent);
    index.commitsPerDay.set(key, acc.perDay);
    if (acc.lastIso) index.lastTouched.set(key, acc.lastIso);
  }
  return index;
}

function bump(map: Map<string, number>, key: string, lines: number): void {
  map.set(key, (map.get(key) ?? 0) + lines);
}

/** `src/lib/a.ts` → `src/lib/`, `src/`, `./`. */
export function ancestorKeys(filePath: string): string[] {
  const parts = filePath.split("/").filter(Boolean);
  const out: string[] = [];
  for (let i = parts.length - 1; i >= 1; i -= 1) out.push(`${parts.slice(0, i).join("/")}/`);
  out.push("./");
  return out;
}

function record(acc: Acc, info: CommitInfo, c: LogCommit, dateMs: number, lines: number, nowMs: number): void {
  const age = nowMs - dateMs;
  if (age <= 365 * DAY_MS) acc.commits365 += 1;
  if (age <= 90 * DAY_MS) acc.commits90 += 1;
  if (age <= 30 * DAY_MS) acc.commits30 += 1;
  acc.lines += lines;
  if (dateMs > acc.lastMs) {
    acc.lastMs = dateMs;
    acc.lastIso = c.date;
  }
  const authorKey = (c.email || c.author).toLowerCase();
  const author = acc.authors.get(authorKey);
  if (author) {
    author.lines += lines;
    author.commits += 1;
  } else {
    acc.authors.set(authorKey, { name: c.author, email: c.email, lines, commits: 1 });
  }
  if (acc.recent.length < HISTORY_RECENT_LIMIT) acc.recent.push(info);
  const day = c.date.slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(day)) acc.perDay.set(day, (acc.perDay.get(day) ?? 0) + 1);
}

function finalize(acc: Acc, handles: (name: string, email: string) => string): History {
  const totalLines = Array.from(acc.authors.values()).reduce((n, a) => n + a.lines, 0);
  const totalCommits = Array.from(acc.authors.values()).reduce((n, a) => n + a.commits, 0);
  const authors: Author[] = Array.from(acc.authors.values())
    .map((a) => ({
      handle: handles(a.name, a.email),
      name: a.name,
      email: a.email,
      lines: a.lines,
      commits: a.commits,
      share: totalLines > 0 ? a.lines / totalLines : totalCommits > 0 ? a.commits / totalCommits : 0,
    }))
    .sort((x, y) => y.lines - x.lines || y.commits - x.commits || x.name.localeCompare(y.name));
  const holders = authors.filter((a) => a.share >= 0.2).length;
  return {
    commits30: acc.commits30,
    commits90: acc.commits90,
    commits365: acc.commits365,
    linesChanged: acc.lines,
    lastTouched: acc.lastIso,
    authors,
    busFactor: authors.length === 0 ? 0 : Math.max(1, holders),
  };
}

/** Email → handle from people.yaml; unknown authors get `handleFor(name, email)`. */
function handleResolver(people: PeopleFile): (name: string, email: string) => string {
  const byEmail = new Map<string, string>();
  for (const p of people.people) {
    if (p.email) byEmail.set(p.email.toLowerCase(), p.handle);
  }
  const memo = new Map<string, string>();
  return (name, email) => {
    const key = `${name}\0${email}`;
    const hit = memo.get(key);
    if (hit !== undefined) return hit;
    const handle = byEmail.get(email.toLowerCase()) ?? handleFor(name, email);
    memo.set(key, handle);
    return handle;
  };
}

function peopleFingerprint(people: PeopleFile): string {
  return people.people.map((p) => `${p.email.toLowerCase()}=${p.handle}`).sort().join(",");
}

/** `365.days` / `90 days` → an epoch cutoff; ISO dates likewise; unknown forms → null (git already filtered). */
export function sinceToMs(since: string, nowMs: number): number | null {
  const days = /^(\d+)\s*\.?\s*days?$/i.exec(since.trim());
  if (days) return nowMs - Number.parseInt(days[1] ?? "0", 10) * DAY_MS;
  const parsed = Date.parse(since);
  return Number.isFinite(parsed) ? parsed : null;
}

/** Normalise any spelling of a path to an index key: `""`/`.`/`./` → `./`; `src/` stays a dir; files unchanged. */
export function historyKey(rawPath: string): string {
  const clean = rawPath.trim().replace(/\\/g, "/").replace(/^\.\//, "").replace(/^\/+/, "");
  if (clean === "" || clean === ".") return "./";
  return clean.replace(/\/{2,}/g, "/");
}

function lookupKey<T>(map: Map<string, T>, rawPath: string): T | undefined {
  const key = historyKey(rawPath);
  const direct = map.get(key);
  if (direct !== undefined) return direct;
  if (key.endsWith("/")) return undefined;
  return map.get(`${key}/`);
}

/** History for a file, a directory (with or without the trailing slash), or the repo (`""`, `.`). Null when nothing touched it. */
export function historyFor(index: HistoryIndex, rawPath = ""): History | null {
  return lookupKey(index.byPath, rawPath) ?? null;
}

/** Last eight commits for a path, newest first. */
export function recentFor(index: HistoryIndex, rawPath = ""): CommitInfo[] {
  return lookupKey(index.commitsByPath, rawPath) ?? [];
}

/**
 * A dense day series for the last `days` days ending today, oldest first.
 *
 * The series is dense, so its length is the caller's `days`: an unchecked `days` here is an
 * allocation the caller controls (`?days=100000000` was ~1.3 GB of objects before `serve.ts`
 * bounded the query). `MAX_DAY_SPAN` is the backstop for every caller; the HTTP layer rejects
 * anything past its own, much smaller, documented range before reaching this.
 */
export const MAX_DAY_SPAN = 3660;

export function commitsPerDayFor(index: HistoryIndex, rawPath = "", days = 30, now: Date = new Date()): { date: string; count: number }[] {
  const perDay = lookupKey(index.commitsPerDay, rawPath) ?? new Map<string, number>();
  const span = Math.min(MAX_DAY_SPAN, Math.max(1, Math.floor(Number.isFinite(days) ? days : 30)));
  const out: { date: string; count: number }[] = [];
  for (let i = span - 1; i >= 0; i -= 1) {
    const date = today(new Date(now.getTime() - i * DAY_MS));
    out.push({ date, count: perDay.get(date) ?? 0 });
  }
  return out;
}

/**
 * The marker for a node git has never seen. Distinct from `emptyHistory()` (all zeros, "cold"):
 * the counts are `null` so a client can draw "no history" apart from "no commits in the window".
 * A fresh object each call — callers hand these to JSON serialisers that may decorate them.
 */
export function noHistory(): History {
  return { commits30: null, commits90: null, commits365: null, linesChanged: 0, lastTouched: null, authors: [], busFactor: 0 };
}

/**
 * History rolled up over an *arbitrary* set of files — the case `byPath` cannot answer, because a
 * split residual area ("src (other)") is a slice of a subtree, not a directory.
 *
 * Lines are summed per file; commits are counted once each (a commit touching three of the files
 * is one commit, not three), which is exactly what `byPath` does for a real directory and what a
 * naive sum of the per-file `History` records would get wrong. Authors, `lastTouched` and the bus
 * factor come out of the same accumulator the per-path pass uses, so an area's numbers are
 * comparable with a directory's. Returns null when no commit in the window touched any of them.
 */
export function historyForFiles(index: HistoryIndex, paths: Iterable<string>): History | null {
  const want = new Set<string>();
  for (const p of paths) {
    const key = historyKey(p);
    if (key !== "./" && !key.endsWith("/")) want.add(key);
  }
  if (want.size === 0) return null;
  const parsedAsOf = Date.parse(index.asOf);
  const nowMs = Number.isFinite(parsedAsOf) ? parsedAsOf : Date.now();
  const acc = newAcc();
  const handleByKey = new Map<string, string>();
  let touched = false;

  for (let i = 0; i < index.log.length; i += 1) {
    const c = index.log[i];
    if (!c) continue;
    let lines = 0;
    let hit = false;
    for (const f of c.files) {
      if (!want.has(f.path)) continue;
      hit = true;
      lines += f.added + f.deleted;
    }
    if (!hit) continue;
    touched = true;
    const info = index.commits[i] ?? { sha: c.sha, author: c.author, handle: handleFor(c.author, c.email), date: c.date, subject: c.subject, task: c.task };
    handleByKey.set(`${c.author}\0${c.email}`, info.handle);
    const ms = Date.parse(c.date);
    record(acc, info, c, Number.isFinite(ms) ? ms : nowMs, lines, nowMs);
  }
  if (!touched) return null;
  return finalize(acc, (name, email) => handleByKey.get(`${name}\0${email}`) ?? handleFor(name, email));
}

/** ISO author date of the newest commit for a path, if any. */
export function lastTouchedFor(index: HistoryIndex, rawPath = ""): string | null {
  return lookupKey(index.lastTouched, rawPath) ?? null;
}

/** Full HEAD sha, or "" when there is no commit yet (git prints the literal "HEAD" and fails there). */
function headSha(root: string): string {
  const r = git(["rev-parse", "HEAD"], { cwd: root, allowFailure: true });
  const sha = r.stdout.trim();
  return r.ok && /^[0-9a-f]{40}$/.test(sha) ? sha : "";
}

export function historyCacheFile(root: string, sha: string): string {
  return path.join(root, HISTORY_CACHE_DIR, `history-${sha}.json`);
}

function readDiskCache(root: string, sha: string, since: string): { commits: LogCommit[]; generatedAt: string } | null {
  const file = historyCacheFile(root, sha);
  if (!existsSync(file)) return null;
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8")) as Partial<CacheFile>;
    if (parsed.version !== CACHE_VERSION || parsed.sha !== sha || parsed.since !== since || !Array.isArray(parsed.commits)) return null;
    const generatedAt = typeof parsed.generatedAt === "string" ? parsed.generatedAt : nowIso();
    const commits: LogCommit[] = [];
    for (const c of parsed.commits) {
      if (!c || typeof c !== "object" || typeof c.sha !== "string" || !Array.isArray(c.files)) return null;
      commits.push({
        sha: c.sha,
        author: typeof c.author === "string" ? c.author : "",
        email: typeof c.email === "string" ? c.email : "",
        date: typeof c.date === "string" ? c.date : "",
        subject: typeof c.subject === "string" ? c.subject : "",
        task: typeof c.task === "string" ? c.task : null,
        files: c.files
          .filter((f): f is LogFile => Boolean(f) && typeof f === "object" && typeof (f as LogFile).path === "string")
          .map((f) => {
            const file: LogFile = { path: f.path, added: Number(f.added) || 0, deleted: Number(f.deleted) || 0 };
            if (typeof f.from === "string") file.from = f.from;
            return file;
          }),
      });
    }
    return { commits, generatedAt };
  } catch {
    return null;
  }
}

/**
 * Write the cache atomically and drop older `history-*.json` files. Only for onboarded repos
 * (a `.reggie/` directory exists), so serving an untouched repo never litters it. Failures
 * are swallowed: the cache is derivable.
 */
function writeDiskCache(root: string, data: CacheFile): void {
  try {
    if (!existsSync(path.join(root, ".reggie"))) return;
    const dir = path.join(root, HISTORY_CACHE_DIR);
    mkdirSync(dir, { recursive: true });
    const file = historyCacheFile(root, data.sha);
    const tmp = `${file}.tmp`;
    writeFileSync(tmp, JSON.stringify(data), "utf8");
    renameSync(tmp, file);
    for (const name of readdirSync(dir)) {
      if (/^history-[0-9a-f]{40}\.json$/.test(name) && name !== path.basename(file)) {
        try {
          unlinkSync(path.join(dir, name));
        } catch {
          /* another process may have removed it */
        }
      }
    }
  } catch {
    /* read-only checkout or race; the in-memory cache still works */
  }
}
