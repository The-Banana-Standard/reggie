import { existsSync, lstatSync, readFileSync, statSync, symlinkSync, unlinkSync } from "node:fs";
import path from "node:path";
import { run } from "./git.js";
import type { InstallEntry } from "./people.js";

/** The one dependency folder Reggie links. Other ecosystems' folders wait until a repo needs them. */
export const DEPS_DIR = "node_modules";

/**
 * The lockfiles a link is judged by. A link is only safe when the branch has not changed a
 * dependency, and a lockfile is the only file in the tree that says so.
 */
export const LOCKFILES = ["package-lock.json", "npm-shrinkwrap.json", "yarn.lock", "pnpm-lock.yaml", "bun.lock"] as const;

/** Long enough for a cold `npm ci` on a big tree, short enough that a hung install still ends. */
export const DEFAULT_INSTALL_TIMEOUT_MS = 10 * 60 * 1000;

/**
 * What happened to one entry's dependencies:
 * - `linked`: the worktree's folder is a symlink into the serving checkout, and the lockfiles agree.
 * - `installed`: the command ran there and succeeded.
 * - `present`: a real folder was already there and was left alone.
 * - `deferred`: an install was needed but nothing was run, because the caller asked to defer.
 * - `failed`: the command exited non-zero, timed out, or had nowhere to run.
 */
export type DepsStatus = "linked" | "installed" | "present" | "deferred" | "failed";

export interface DepsOutcome {
  /** The entry's directory, relative to the repo root. */
  dir: string;
  command: string;
  status: DepsStatus;
  /** Why this outcome, in one phrase, when the status alone does not say. */
  reason?: string;
  /**
   * The session still has to run this command itself. Set when nothing was run and something
   * needs to be, and left off when running the command would not help — a directory that is not
   * there does not get installed into by telling someone to try again.
   */
  pending?: true;
}

export interface PrepareDepsOptions {
  /**
   * `run` installs when a link is unsafe; `defer` runs nothing and returns those entries as
   * `deferred` for the caller to pass on. The launchers defer: the server answers one request
   * at a time, and a cold install would hold every other request for minutes.
   */
  mode?: "run" | "defer";
  /** Overrides DEFAULT_INSTALL_TIMEOUT_MS. */
  timeoutMs?: number;
}

/** `lstat` without the throw: null when nothing is there. Never follows a link. */
function lstatOrNull(target: string): ReturnType<typeof lstatSync> | null {
  try {
    return lstatSync(target);
  } catch {
    return null;
  }
}

/**
 * Is there a usable dependency folder here, following links? The serving checkout's own
 * `node_modules` is itself a link whenever Reggie runs from inside a worktree, so probing with
 * `lstat` would refuse to link in exactly the nested case this feature creates.
 */
function isUsableDir(target: string): boolean {
  try {
    return statSync(target).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Do two directories declare the same dependencies? True only when the same lockfile names exist
 * on both sides, at least one exists, and every pair is byte-identical. A missing lockfile on
 * either side, or one the other does not have, is a difference: linking is the risky option, so
 * anything short of proof falls through to an install.
 */
export function lockfilesMatch(serveDir: string, workDir: string): boolean {
  let compared = 0;
  for (const name of LOCKFILES) {
    const a = path.join(serveDir, name);
    const b = path.join(workDir, name);
    const hasA = existsSync(a);
    const hasB = existsSync(b);
    if (hasA !== hasB) return false;
    if (!hasA) continue;
    if (!readFileSync(a).equals(readFileSync(b))) return false;
    compared += 1;
  }
  return compared > 0;
}

/** A command string from config, as an argument vector. Split on whitespace; never a shell. */
function argvOf(command: string): string[] {
  return command.trim().split(/\s+/).filter(Boolean);
}

/** The first line of a command's complaint, short enough to sit on a claim's output line. */
function firstLine(text: string, max = 120): string {
  const line = text.split("\n").map((l) => l.trim()).find((l) => l !== "") ?? "";
  return line.length > max ? `${line.slice(0, max - 1)}\u2026` : line;
}

function install(entry: InstallEntry, workDir: string, timeoutMs: number): DepsOutcome {
  const [cmd, ...args] = argvOf(entry.command);
  if (!cmd) return { dir: entry.dir, command: entry.command, status: "failed", reason: "the command is empty" };
  const r = run(cmd, args, { cwd: workDir, allowFailure: true, timeoutMs });
  if (r.ok) return { dir: entry.dir, command: entry.command, status: "installed" };
  // `spawnSync` reports a command it could not start as a null status, which reads as an exit code
  // of nothing at all; say which it was, and carry the command's own first complaint either way.
  const what = r.timedOut
    ? `timed out after ${timeoutMs >= 1000 ? `${Math.round(timeoutMs / 1000)}s` : `${timeoutMs}ms`}`
    : r.status === null
      ? `could not run ${cmd}`
      : `exit ${r.status}`;
  const detail = r.timedOut ? "" : firstLine(r.stderr || r.stdout);
  return { dir: entry.dir, command: entry.command, status: "failed", reason: detail ? `${what}: ${detail}` : what, pending: true };
}

/**
 * Make each configured directory of a fresh or resumed worktree runnable, by linking the serving
 * checkout's installed folder when that is provably safe and installing when it is not.
 *
 * Linking is instant but wrong the moment the branch changes a dependency, because the install
 * would land in the shared tree that every other worktree reads. So the lockfiles decide, and a
 * link left over from before a lockfile change is replaced rather than trusted.
 */
export function prepareDeps(root: string, worktree: string, entries: readonly InstallEntry[] | undefined, opts: PrepareDepsOptions = {}): DepsOutcome[] {
  if (!entries || entries.length === 0) return [];
  const timeoutMs = opts.timeoutMs ?? DEFAULT_INSTALL_TIMEOUT_MS;
  const defer = opts.mode === "defer";
  const outcomes: DepsOutcome[] = [];

  for (const entry of entries) {
    const base = { dir: entry.dir, command: entry.command };
    try {
      outcomes.push(prepareOne(root, worktree, entry, defer, timeoutMs));
    } catch (err) {
      // A claim must never fail on its dependencies. Every caller treats a throw from claimTask as
      // "someone else holds this branch", and the worktree and branch already exist by now.
      outcomes.push({ ...base, status: "failed", reason: firstLine(err instanceof Error ? err.message : String(err)), pending: true });
    }
  }
  return outcomes;
}

function prepareOne(root: string, worktree: string, entry: InstallEntry, defer: boolean, timeoutMs: number): DepsOutcome {
  const serveDir = path.join(root, entry.dir);
  const workDir = path.join(worktree, entry.dir);
  const base = { dir: entry.dir, command: entry.command };
  // Not pending: running an install command in a directory that is not there cannot help.
  if (!existsSync(workDir)) return { ...base, status: "failed", reason: `no ${entry.dir} directory in the worktree` };

  const target = path.join(workDir, DEPS_DIR);
  const source = path.join(serveDir, DEPS_DIR);
  const matched = lockfilesMatch(serveDir, workDir);
  const here = lstatOrNull(target);

  if (here && !here.isSymbolicLink()) {
    // Not pending: a file sitting where the folder belongs is for a person to look at, not a re-run.
    if (!here.isDirectory()) return { ...base, status: "failed", reason: `${entry.dir}/${DEPS_DIR} is not a directory` };
    // Someone installed here for real. Never touch it: it may be exactly what the branch needs.
    // Say so when it cannot be, though, or a worktree whose branch moved on looks ready and is not.
    return matched ? { ...base, status: "present" } : { ...base, status: "present", reason: `${entry.dir}/${DEPS_DIR} does not match this branch's lockfile`, pending: true };
  }
  if (here) {
    // A link whose target has since been deleted still lstats fine; only following it says so.
    if (matched && isUsableDir(target)) return { ...base, status: "linked" };
    // Stale or dangling. Drop the link, never the directory behind it, and install here instead.
    unlinkSync(target);
  }

  if (matched && isUsableDir(source)) {
    symlinkSync(path.resolve(source), target, "dir");
    return { ...base, status: "linked" };
  }
  return defer ? { ...base, status: "deferred", pending: true } : install(entry, workDir, timeoutMs);
}

/**
 * Remove the links a worktree holds, before anything deletes that worktree. Only symlinks are
 * removed, and only the link itself: deleting through one would take the serving checkout's
 * installed dependencies with it, which is the one way this feature could destroy something.
 * Git does not follow the link today; this keeps the guarantee from resting on that.
 */
export function unlinkDeps(worktree: string, entries: readonly InstallEntry[] | undefined): string[] {
  if (!entries || entries.length === 0) return [];
  const removed: string[] = [];
  for (const entry of entries) {
    const target = path.join(worktree, entry.dir, DEPS_DIR);
    if (!lstatOrNull(target)?.isSymbolicLink()) continue;
    // A link that will not come off must not stop a release; git then removes the worktree, and
    // git does not follow the link either. Better a warning than a claim nobody can let go of.
    try {
      unlinkSync(target);
      removed.push(target);
    } catch (err) {
      removed.push(`${target} could not be unlinked: ${firstLine(err instanceof Error ? err.message : String(err))}`);
    }
  }
  return removed;
}

/** The entries a session still has to install itself: what a deferring caller passes to the prompt. */
export function pendingSetup(outcomes: readonly DepsOutcome[]): InstallEntry[] {
  return outcomes.filter((o) => o.pending === true).map((o) => ({ dir: o.dir, command: o.command }));
}
