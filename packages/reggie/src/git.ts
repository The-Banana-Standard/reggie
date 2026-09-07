import { spawnSync, type SpawnSyncOptionsWithStringEncoding } from "node:child_process";

export interface ExecResult {
  ok: boolean;
  stdout: string;
  stderr: string;
  status: number | null;
}

export interface ExecOptions {
  cwd?: string;
  allowFailure?: boolean;
  input?: string;
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
  const res = spawnSync(cmd, args, spawnOpts);
  const stdout = res.stdout ?? "";
  const stderr = res.stderr ?? "";
  const ok = res.status === 0;
  if (!ok && !opts.allowFailure) {
    const detail = (stderr || stdout).trim();
    throw new Error(`${cmd} ${args.join(" ")} failed (exit ${res.status ?? "?"})${detail ? `: ${detail}` : ""}`);
  }
  return { ok, stdout, stderr, status: res.status };
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

/** Best guess at the integration branch: origin/HEAD, then main, then master, then the current branch. */
export function defaultBranch(root: string, override?: string): string {
  if (override) return override;
  const sym = git(["symbolic-ref", "--quiet", "--short", "refs/remotes/origin/HEAD"], { cwd: root, allowFailure: true });
  if (sym.ok) {
    const name = sym.stdout.trim().replace(/^origin\//, "");
    if (name) return name;
  }
  for (const candidate of ["main", "master"]) {
    if (branchExists(root, candidate)) return candidate;
  }
  return currentBranch(root);
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
