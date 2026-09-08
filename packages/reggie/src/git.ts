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
}

/** Run a command synchronously. Throws on non-zero exit unless allowFailure is set. */
export function run(cmd: string, args: string[], opts: ExecOptions = {}): ExecResult {
  const spawnOpts: SpawnSyncOptionsWithStringEncoding = {
    encoding: "utf8",
    env: process.env,
    maxBuffer: 64 * 1024 * 1024,
  };
  if (opts.cwd) spawnOpts.cwd = opts.cwd;
  if (opts.input !== undefined) spawnOpts.input = opts.input;
  if (opts.timeoutMs !== undefined) spawnOpts.timeout = opts.timeoutMs;
  const res = spawnSync(cmd, args, spawnOpts);
  const stdout = res.stdout ?? "";
  const stderr = res.stderr ?? "";
  // A timeout kills the child and reports status null with an ETIMEDOUT error.
  const timedOut = res.error !== undefined && (res.error as NodeJS.ErrnoException).code === "ETIMEDOUT";
  const ok = res.status === 0 && !timedOut;
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
