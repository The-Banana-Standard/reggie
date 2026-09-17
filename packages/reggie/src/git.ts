import { spawnSync, type SpawnSyncOptionsWithStringEncoding } from "node:child_process";

export interface ExecResult {
  ok: boolean;
  stdout: string;
  stderr: string;
  status: number | null;
  /** True when `timeoutMs` elapsed and the child was killed. */
  timedOut?: boolean;
}

export interface ExecOptions {
  cwd?: string;
  allowFailure?: boolean;
  input?: string;
  /**
   * Milliseconds to wait before giving up. Unset means wait forever, which is right for git but
   * wrong for anything that can block on a user (an OS consent dialog, an editor, a pager).
   */
  timeoutMs?: number;
  /**
   * Bytes of output to accept before the child is killed and the call reported as failed. Unset is
   * the 64 MB default, which is right for a listing and far too much to parse into objects on a
   * request: a caller that turns output into rows says how much it is prepared to read.
   */
  maxBufferBytes?: number;
}

/** Run a command synchronously. Throws on non-zero exit unless allowFailure is set. */
export function run(cmd: string, args: string[], opts: ExecOptions = {}): ExecResult {
  const spawnOpts: SpawnSyncOptionsWithStringEncoding = {
    encoding: "utf8",
    env: process.env,
    maxBuffer: opts.maxBufferBytes ?? 64 * 1024 * 1024,
  };
  if (opts.cwd) spawnOpts.cwd = opts.cwd;
  if (opts.input !== undefined) spawnOpts.input = opts.input;
  if (opts.timeoutMs !== undefined) spawnOpts.timeout = opts.timeoutMs;
  const res = spawnSync(cmd, args, spawnOpts);
  const stdout = res.stdout ?? "";
  const stderr = res.stderr ?? "";
  // A timeout kills the child and reports status null with an ETIMEDOUT error.
  const timedOut = res.error !== undefined && (res.error as NodeJS.ErrnoException).code === "ETIMEDOUT";
  // Output past `maxBuffer` is an ENOBUFS error, and when the child had already exited the status
  // beside it is still 0 (measured: five runs in six for a small patch), so a status of 0 alone would
  // pass truncated or over-limit output off as a clean read. Any spawn error is a failure.
  const ok = res.status === 0 && res.error === undefined;
  if (!ok && !opts.allowFailure) {
    const detail = timedOut ? `timed out after ${opts.timeoutMs}ms` : (stderr || stdout).trim();
    throw new Error(`${cmd} ${args.join(" ")} failed (exit ${res.status ?? "?"})${detail ? `: ${detail}` : ""}`);
  }
  return { ok, stdout, stderr, status: res.status, timedOut };
}

export function git(args: string[], opts: ExecOptions = {}): ExecResult {
  return run("git", args, opts);
}

export function commandExists(cmd: string): boolean {
  const probe = process.platform === "win32" ? "where" : "which";
  return run(probe, [cmd], { allowFailure: true }).ok;
}

export function currentBranch(root: string): string {
  const r = git(["branch", "--show-current"], { cwd: root, allowFailure: true });
  return r.stdout.trim() || "HEAD";
}

/** Task and plan branches are work branches; they can never be the integration branch. */
export function isWorkBranch(name: string): boolean {
  return name.startsWith("task/") || name.startsWith("plan/");
}

export function listLocalBranchNames(root: string): string[] {
  const r = git(["for-each-ref", "--format=%(refname:short)", "refs/heads"], { cwd: root, allowFailure: true });
  return r.stdout.split("\n").map((l) => l.trim()).filter(Boolean);
}

/**
 * The integration branch: the config override, then origin/HEAD, then main, then master,
 * then the current branch if it is not a work branch, then the only non-work local branch.
 * Throws rather than guessing a task branch, because every state derivation depends on it.
 */
export function defaultBranch(root: string, override?: string): string {
  if (override) return override;
  const sym = git(["symbolic-ref", "--quiet", "--short", "refs/remotes/origin/HEAD"], { cwd: root, allowFailure: true });
  if (sym.ok) {
    const name = sym.stdout.trim().replace(/^origin\//, "");
    if (name && !isWorkBranch(name)) return name;
  }
  for (const candidate of ["main", "master"]) {
    if (branchExists(root, candidate)) return candidate;
  }
  const locals = listLocalBranchNames(root).filter((n) => !isWorkBranch(n));
  const current = currentBranch(root);
  if (current !== "HEAD" && !isWorkBranch(current) && locals.includes(current)) return current;
  if (locals.length === 1 && locals[0]) return locals[0];
  throw new Error(
    "Cannot determine the integration branch: no origin/HEAD, no main or master, and the current branch is a task or plan branch (or HEAD is detached). Set `defaultBranch:` in .reggie/config.yaml.",
  );
}

/** Paths present under a directory at a ref, relative to the repo root. One git call. */
export function treePaths(root: string, ref: string, dir: string): Set<string> {
  const r = git(["ls-tree", "-r", "--name-only", ref, "--", dir], { cwd: root, allowFailure: true });
  return new Set(r.stdout.split("\n").map((l) => l.trim()).filter(Boolean));
}

export function branchExists(root: string, name: string): boolean {
  const local = git(["show-ref", "--verify", "--quiet", `refs/heads/${name}`], { cwd: root, allowFailure: true });
  if (local.ok) return true;
  const remote = git(["show-ref", "--verify", "--quiet", `refs/remotes/origin/${name}`], { cwd: root, allowFailure: true });
  return remote.ok;
}

export interface BranchInfo {
  name: string;
  remote: boolean;
  author: string;
  email: string;
  date: string;
  sha: string;
}

/** List local and origin branches whose short name starts with prefix. Deduped by short name (local wins). */
export function listBranches(root: string, prefix: string): BranchInfo[] {
  const format = "%(refname:short)|%(authorname)|%(authoremail)|%(committerdate:iso-strict)|%(objectname:short)";
  const r = git(
    ["for-each-ref", `--format=${format}`, `refs/heads/${prefix}`, `refs/remotes/origin/${prefix}`],
    { cwd: root, allowFailure: true },
  );
  const seen = new Map<string, BranchInfo>();
  for (const line of r.stdout.split("\n")) {
    if (!line.trim()) continue;
    const [refname = "", author = "", email = "", date = "", sha = ""] = line.split("|");
    const remote = refname.startsWith("origin/");
    const name = remote ? refname.slice("origin/".length) : refname;
    if (!name.startsWith(prefix)) continue;
    const existing = seen.get(name);
    if (existing && !existing.remote) continue;
    seen.set(name, { name, remote, author, email: email.replace(/^<|>$/g, ""), date, sha });
  }
  return Array.from(seen.values());
}

/** Contents of a file at a ref, or null when it does not exist there. */
export function fileAtRef(root: string, ref: string, file: string): string | null {
  const r = git(["show", `${ref}:${file}`], { cwd: root, allowFailure: true });
  return r.ok ? r.stdout : null;
}

export function lastCommitDate(root: string, file: string): string | null {
  const r = git(["log", "-1", "--format=%cI", "--", file], { cwd: root, allowFailure: true });
  const out = r.stdout.trim();
  return out || null;
}

export interface CommitInfo {
  sha: string;
  author: string;
  date: string;
  subject: string;
}

export function recentCommits(root: string, files: string[], limit = 10): CommitInfo[] {
  const args = ["log", `-n${limit}`, "--format=%h|%an|%as|%s"];
  if (files.length > 0) args.push("--", ...files);
  const r = git(args, { cwd: root, allowFailure: true });
  return r.stdout
    .split("\n")
    .filter((l) => l.trim())
    .map((line) => {
      const [sha = "", author = "", date = "", ...rest] = line.split("|");
      return { sha, author, date, subject: rest.join("|") };
    });
}

export function aheadCount(root: string, branch: string, base: string): number {
  const r = git(["rev-list", "--count", `${base}..${branch}`], { cwd: root, allowFailure: true });
  const n = Number.parseInt(r.stdout.trim(), 10);
  return Number.isFinite(n) ? n : 0;
}

export function diffStat(root: string, base: string): string {
  const r = git(["diff", "--stat", `${base}...HEAD`], { cwd: root, allowFailure: true });
  return r.stdout.trim();
}

export function changedFiles(root: string, base: string): string[] {
  const r = git(["diff", "--name-only", `${base}...HEAD`], { cwd: root, allowFailure: true });
  return r.stdout.split("\n").filter((l) => l.trim());
}

// ---------------------------------------------------------------------------
// Reading a change: two commits, a list, one file's patch
// ---------------------------------------------------------------------------

const FULL_SHA = /^[0-9a-f]{40}$/;

/** A diff read that takes longer than this is reported as failed rather than holding the server. */
export const DIFF_TIMEOUT_MS = 10_000;

export function isFullSha(value: string): boolean {
  return FULL_SHA.test(value);
}

/** A name resolved once to the full sha of the commit it points at; null when it names no commit. */
export function resolveCommit(root: string, name: string): string | null {
  const r = git(["rev-parse", "--verify", "--quiet", "--end-of-options", `${name}^{commit}`], { cwd: root, allowFailure: true });
  const sha = r.stdout.trim();
  return r.ok && FULL_SHA.test(sha) ? sha : null;
}

/** The best common ancestor of two commits; null when they share no history (git exits 1) or git fails. */
export function mergeBase(root: string, a: string, b: string): string | null {
  assertFullSha(a);
  assertFullSha(b);
  const r = git(["merge-base", "--end-of-options", a, b], { cwd: root, allowFailure: true, timeoutMs: DIFF_TIMEOUT_MS });
  const sha = r.stdout.trim().split("\n")[0] ?? "";
  return r.ok && FULL_SHA.test(sha) ? sha : null;
}

/** Commits reachable from `ref` and not from `base`; null when git fails. */
export function commitCount(root: string, base: string, ref: string): number | null {
  assertFullSha(base);
  assertFullSha(ref);
  const r = git(["rev-list", "--count", "--end-of-options", `${base}..${ref}`], { cwd: root, allowFailure: true, timeoutMs: DIFF_TIMEOUT_MS });
  const n = Number.parseInt(r.stdout.trim(), 10);
  return r.ok && Number.isFinite(n) ? n : null;
}

function assertFullSha(rev: string): void {
  if (!FULL_SHA.test(rev)) throw new Error("a diff revision must be a full 40-character commit id");
}

export type DiffShape = "raw" | "numstat" | "patch";

const DIFF_SHAPE_ARGS: Record<DiffShape, string[]> = {
  raw: ["--raw", "-z", "--no-abbrev"],
  numstat: ["--numstat", "-z"],
  // What a user's config could change about a patch is said out loud: three lines of context, no
  // merging of nearby hunks, and the a/ and b/ prefixes.
  patch: ["--patch", "--unified=3", "--inter-hunk-context=0", "--src-prefix=a/", "--dst-prefix=b/"],
};

/**
 * The arguments of every diff read, exported so a test can see exactly what git is handed.
 *
 * Revisions must be full commit ids Reggie resolved itself: anything else throws here, before git is
 * spawned, because a revision beginning with a dash is an option (`--output=<file>` makes git write
 * that file). They go after `--end-of-options` and paths after `--`, under `--literal-pathspecs`,
 * so `:(exclude)src` and `*.bin` name files rather than match them. `--no-ext-diff` and
 * `--no-textconv` keep a GET from running a program the repo's config names; `--no-color`, `-M`, the
 * algorithm and the patch flags pin what `color.ui`, `diff.renames`, `diff.algorithm`, `diff.context`
 * and `diff.noprefix` would otherwise change. The algorithm is pinned for all three shapes, so the
 * counts of the list and the rows of a patch always come from the same diff.
 */
export function diffRangeArgs(shape: DiffShape, base: string, ref: string, paths: readonly string[] = []): string[] {
  assertFullSha(base);
  assertFullSha(ref);
  return [
    "--literal-pathspecs",
    "-c",
    "core.quotePath=false",
    "-c",
    "diff.suppressBlankEmpty=false",
    "diff",
    "--no-color",
    "--no-ext-diff",
    "--no-textconv",
    "-M",
    "--diff-algorithm=myers",
    ...DIFF_SHAPE_ARGS[shape],
    "--end-of-options",
    base,
    ref,
    "--",
    ...paths,
  ];
}

/** Null when git failed, timed out or outgrew the buffer; "" when nothing changed. Never confused. */
function readDiff(root: string, args: string[], maxBufferBytes?: number): string | null {
  const r = git(args, { cwd: root, allowFailure: true, timeoutMs: DIFF_TIMEOUT_MS, ...(maxBufferBytes !== undefined ? { maxBufferBytes } : {}) });
  return r.ok ? r.stdout : null;
}

/** `git diff --raw -z --no-abbrev` between two commits: status, modes, blob ids and both paths of a rename. */
export function diffRawRange(root: string, base: string, ref: string): string | null {
  return readDiff(root, diffRangeArgs("raw", base, ref));
}

/** `git diff --numstat -z` between two commits: added and deleted counts, `-` for a binary file. */
export function numstatRange(root: string, base: string, ref: string): string | null {
  return readDiff(root, diffRangeArgs("numstat", base, ref));
}

/**
 * One file's patch between two commits. A rename is asked for by both of its paths, old first:
 * asked for by its new path alone, git reports the same file as wholly added. `maxBytes` bounds what
 * is read: a patch larger than that is answered as null, the same as a failed read, and git is
 * stopped rather than allowed to fill the default buffer.
 */
export function patchFor(root: string, base: string, ref: string, paths: readonly string[], maxBytes?: number): string | null {
  if (paths.length === 0) throw new Error("patchFor needs at least one path");
  return readDiff(root, diffRangeArgs("patch", base, ref, paths), maxBytes);
}

/** Size of a blob in bytes, by blob id; null when there is no such object. */
export function blobSize(root: string, blob: string): number | null {
  if (!FULL_SHA.test(blob)) return null;
  const r = git(["cat-file", "-s", blob], { cwd: root, allowFailure: true, timeoutMs: DIFF_TIMEOUT_MS });
  const n = Number.parseInt(r.stdout.trim(), 10);
  return r.ok && Number.isFinite(n) ? n : null;
}

/** A blob's text, by blob id; null when it cannot be read. */
export function blobText(root: string, blob: string): string | null {
  if (!FULL_SHA.test(blob)) return null;
  const r = git(["cat-file", "blob", blob], { cwd: root, allowFailure: true, timeoutMs: DIFF_TIMEOUT_MS });
  return r.ok ? r.stdout : null;
}

/** The blob id a path holds at a commit; null when the path is not a file there. The path never touches the revision. */
export function blobAt(root: string, commit: string, file: string): string | null {
  assertFullSha(commit);
  const r = git(["--literal-pathspecs", "ls-tree", "-z", "--end-of-options", commit, "--", file], { cwd: root, allowFailure: true, timeoutMs: DIFF_TIMEOUT_MS });
  if (!r.ok) return null;
  for (const entry of r.stdout.split("\0")) {
    const tab = entry.indexOf("\t");
    if (tab < 0 || entry.slice(tab + 1) !== file) continue;
    const [, type = "", sha = ""] = entry.slice(0, tab).split(" ");
    return type === "blob" && FULL_SHA.test(sha) ? sha : null;
  }
  return null;
}

export function gitUser(root: string): { name: string; email: string } {
  const name = git(["config", "user.name"], { cwd: root, allowFailure: true }).stdout.trim();
  const email = git(["config", "user.email"], { cwd: root, allowFailure: true }).stdout.trim();
  return { name, email };
}

/** Tracked plus untracked-but-not-ignored files, relative to root with forward slashes. */
export function listRepoFiles(root: string): string[] {
  const r = git(["ls-files", "--cached", "--others", "--exclude-standard", "-z"], { cwd: root, allowFailure: true });
  if (!r.ok) return [];
  return r.stdout.split("\0").filter((f) => f.length > 0);
}

export function isRepo(dir: string): boolean {
  return git(["rev-parse", "--is-inside-work-tree"], { cwd: dir, allowFailure: true }).ok;
}
