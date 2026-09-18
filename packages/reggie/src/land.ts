import { randomBytes } from "node:crypto";
import { existsSync, linkSync, readFileSync, renameSync, rmSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { captureDiscoveredIssues, type CaptureResult, type DiscoveredCaptureInput } from "./capture.js";
import { releaseTask } from "./claim.js";
import { currentBranch, defaultBranch, fileAtRef, git, gitCommonDir, gitPath, resolveCommit } from "./git.js";
import { taskLanding } from "./history.js";
import { appendJournal, detectTool, journalFile, sessionName } from "./journal.js";
import { decidePacket, evidenceGate, materializePacket } from "./packet.js";
import { packetFile, packetRelPath, planFile, planRelPath, type RepoPaths } from "./paths.js";
import type { Person, ReggieConfig } from "./people.js";
import { parsePlan } from "./plan.js";
import { readText, relPosix, today } from "./util.js";

/*
 * Landing an approved task in solo mode: the no-fast-forward merge that makes the merge commit the
 * durable record of what a task changed. The verdict, the decide entry and the discovered issues the
 * approval captures are written inside the merge commit, so a task reads done exactly when it has
 * landed and the three cannot disagree. Every refusal happens before anything is written, and a merge
 * that stops is aborted with both branches as they were. Nothing is pushed.
 *
 * One landing at a time. Two approvals started together used to corrupt the integration checkout:
 * when the second call's `git merge` failed because the first call's merge was in progress, it ran
 * `git merge --abort`, which aborted the first call's merge and removed its packet from disk. So a
 * landing holds a lock from before its first check to after its last write, refuses while another
 * merge is in progress, and aborts only a merge it started itself.
 */

export interface LandInput {
  person: Person;
  comment?: string;
  /** The tool the journal entry is attributed to; default detected. */
  tool?: string;
  /** Captures the packet's discovered issues; default `captureDiscoveredIssues`. A test passes one that throws. */
  captureIssues?: (paths: RepoPaths, input: DiscoveredCaptureInput) => CaptureResult[];
}

export interface LandResult {
  base: string;
  /** The commit that records the approval: the merge, or a verdict commit when the branch had already landed. */
  commit: string;
  /** The merge this call made; null when the branch had already landed. */
  merge: string | null;
  alreadyLanded: boolean;
  /** When the branch had already landed, the merge that landed it, if one exists. */
  existingMerge: string | null;
  /** The packet file the verdict was written to. */
  packet: string;
  released: string[];
  /** Why the branch or worktree was not released. The landing stands either way. */
  releaseError: string | null;
  /** Slugs of the intake items this approval captured out of the packet's Discovered issues, inside the same commit. */
  captured: string[];
}

/** A refusal or an aborted merge. Nothing was recorded. */
export class LandError extends Error {}

export function landTask(paths: RepoPaths, config: ReggieConfig, slug: string, input: LandInput): LandResult {
  // Taken before the first check and dropped whatever happens: a refusal, a conflict and a throw all release it.
  const lock = acquireLandLock(paths.root, slug);
  try {
    return landLocked(paths, config, slug, input);
  } finally {
    lock.release();
  }
}

function landLocked(paths: RepoPaths, config: ReggieConfig, slug: string, input: LandInput): LandResult {
  const root = paths.root;
  const branch = `task/${slug}`;
  const base = defaultBranch(root, config.defaultBranch);
  const refuse = (why: string): never => {
    throw new LandError(`refusing to merge ${branch}: ${why}`);
  };

  const on = currentBranch(root);
  if (on !== base) refuse(`this checkout is on ${on}, not ${base}. Run it from the checkout that has ${base} checked out.`);
  // Before the dirty check, which a half-finished merge would also trip: the sentence has to say which it is.
  if (existsSync(gitPath(root, "MERGE_HEAD"))) refuse(`a merge is already in progress in this checkout. Finish it or run \`git merge --abort\` yourself; Reggie does not abort a merge it did not start.`);
  const dirty = porcelain(root, ["--untracked-files=no"]);
  if (dirty.length > 0) refuse(`${base} has uncommitted changes (${dirty.join(", ")}). Commit or stash them first; an aborted merge cannot promise to restore them.`);

  // A task can be approved after its branch is gone, as long as a merge on the base landed it.
  const hasBranch = git(["show-ref", "--verify", "--quiet", `refs/heads/${branch}`], { cwd: root, allowFailure: true }).ok;
  const landedBy = taskLanding(root, slug, { base }).merge?.sha ?? null;
  if (!hasBranch && !landedBy) refuse(`there is no local branch by that name, and no merge on ${base} that landed it.`);
  if (hasBranch) {
    const overwritten = untrackedAlsoOnBranch(root, branch);
    if (overwritten.length > 0) {
      refuse(`${base} has untracked files that the merge would overwrite (${overwritten.join(", ")}). Commit or remove them first; git refuses such a merge outright.`);
    }
    const worktree = path.join(root, ".worktree", slug);
    if (existsSync(worktree)) {
      const wip = porcelain(worktree, []);
      if (wip.length > 0) refuse(`its worktree has uncommitted changes (${wip.join(", ")}). Commit them on the branch or discard them first.`);
    }
  }
  const at = (ref: string | null, file: string): string | null => (ref === null ? null : fileAtRef(root, ref, file));
  const branchRef = hasBranch ? branch : null;
  const packetSource = at(branchRef, packetRelPath(slug)) ?? at(base, packetRelPath(slug)) ?? readText(packetFile(paths, slug));
  if (packetSource === null) return refuse(`it has no packet. Write one with \`reggie packet ${slug}\` and commit it on the branch.`);

  // The evidence gate, on both doors and with no override: a packet that cites a file nobody
  // committed never passes, by policy or by hand. Citations are judged on the commit the merge
  // would bring in (the base, for a task that has already landed), never on a disk. A packet that
  // cites nothing merges exactly as it always has.
  const tip = resolveCommit(root, `refs/heads/${hasBranch ? branch : base}`);
  if (tip === null) return refuse(`${hasBranch ? branch : base} names no commit.`);
  const unresolved = evidenceGate(root, tip, slug, packetSource);
  if (unresolved.length > 0) {
    refuse(`its packet cites evidence that does not resolve on ${hasBranch ? branch : base} (${tip.slice(0, 12)}): ${unresolved.map((f) => `${f.path} ${f.why}`).join("; ")}. Fix the citation or commit the file on the branch, then decide again; nothing was recorded.`);
  }

  const title = parsePlan(at(branchRef, planRelPath(slug)) ?? at(base, planRelPath(slug)) ?? readText(planFile(paths, slug)) ?? "").meta.title || slug;
  const comment = input.comment?.trim() ?? "";
  const alreadyLanded = !hasBranch || git(["merge-base", "--is-ancestor", branch, base], { cwd: root, allowFailure: true }).ok;
  let existingMerge: string | null = null;
  let recorded: { packet: string; captured: string[] };

  if (alreadyLanded) {
    existingMerge = landedBy;
    if (!existsSync(packetFile(paths, slug))) materializePacket(paths, slug, packetSource);
    // No merge to abort here; `recordApproval` puts back whatever it wrote if it throws.
    recorded = recordApproval(paths, slug, input, `decide: ${slug} approved`, `Decision: approved. The task branch had already landed on ${base}.`);
  } else {
    const started = git(["-c", "commit.gpgsign=false", "merge", "--no-ff", "--no-commit", branch], { cwd: root, allowFailure: true });
    if (!started.ok) {
      const conflicted = lines(git(["diff", "--name-only", "--diff-filter=U"], { cwd: root, allowFailure: true }).stdout);
      abortOwnMerge(root, tip);
      throw new LandError(
        conflicted.length > 0
          ? `merging ${branch} into ${base} conflicts in ${conflicted.join(", ")}. The merge was aborted and nothing was recorded; merge ${base} into the branch, resolve it there, then decide again.`
          : `merging ${branch} into ${base} failed and was aborted; nothing was recorded: ${(started.stderr || started.stdout).trim()}`,
      );
    }
    try {
      recorded = recordApproval(paths, slug, input, `merge: ${branch} — ${title}`, `Decision: approved. Merged the task branch into ${base}.`);
    } catch (err) {
      abortOwnMerge(root, tip);
      throw err;
    }
  }

  const commit = git(["rev-parse", "HEAD"], { cwd: root }).stdout.trim();
  let released: string[] = [];
  let releaseError: string | null = null;
  try {
    released = releaseTask(paths, config, slug, input.person, { journal: false });
  } catch (err) {
    releaseError = err instanceof Error ? err.message : String(err);
  }
  return { base, commit, merge: alreadyLanded ? null : commit, alreadyLanded, existingMerge, packet: recorded.packet, released, releaseError, captured: recorded.captured };

  /**
   * Verdict, journal entry and captured issues, staged together and committed as one commit (the
   * merge, when one is in progress). The packet is read from the tree the commit will hold, so the
   * issues are compared with the intake as merged.
   *
   * It undoes its own writes when anything throws. `git merge --abort` alone is not enough: it keeps
   * a file's unstaged changes, and refuses outright when such a file is also part of the merge,
   * which the intake is on most branches. So each of the three files is put back, on disk and in
   * the index, exactly as it was when this began, and only then does the caller abort the merge.
   */
  function recordApproval(p: RepoPaths, s: string, i: LandInput, subject: string, entry: string): { packet: string; captured: string[] } {
    const now = new Date();
    const journalPath = journalFile(p, today(now), i.person.handle, sessionName());
    const touched = [p.intake, packetFile(p, s), journalPath].map((file) => ({
      file,
      rel: relPosix(root, file),
      before: existsSync(file) ? readFileSync(file) : null,
      inIndex: git(["ls-files", "--error-unmatch", "--", relPosix(root, file)], { cwd: root, allowFailure: true }).ok,
    }));
    try {
      const captured = (i.captureIssues ?? captureDiscoveredIssues)(p, { slug: s, packet: readText(packetFile(p, s)) ?? "", decider: i.person });
      const file = decidePacket(p, s, "approved", i.person.handle, comment || undefined);
      const journal = appendJournal(p, { person: i.person.handle, tool: i.tool ?? detectTool(), slug: s, stage: "decide", text: comment ? `${entry} ${comment}` : entry, now });
      const staged = [relPosix(root, file), relPosix(root, journal.file), ...(captured.length > 0 ? [relPosix(root, p.intake)] : [])];
      git(["add", "--", ...staged], { cwd: root });
      const message = ["-m", subject, ...(comment ? ["-m", comment] : []), "-m", `Task: ${s}\nDecided-by: ${i.person.handle}`];
      git(["-c", "commit.gpgsign=false", "commit", "-q", ...message], { cwd: root });
      return { packet: file, captured: captured.map((c) => c.slug) };
    } catch (err) {
      for (const t of touched.reverse()) {
        try {
          if (t.before === null) rmSync(t.file, { force: true });
          else writeFileSync(t.file, t.before);
        } catch {
          // Whatever can be put back is put back; the error that brought us here is the one to report.
        }
        git(t.inIndex ? ["add", "--", t.rel] : ["rm", "--cached", "-q", "--ignore-unmatch", "--", t.rel], { cwd: root, allowFailure: true });
      }
      throw err;
    }
  }
}

// ---------------------------------------------------------------------------
// The landing lock
// ---------------------------------------------------------------------------

/** A lock older than this is replaced even when its pid is alive: a pid can be reused, and no landing takes ten minutes. */
export const LAND_LOCK_STALE_MS = 10 * 60 * 1000;

interface LockBody {
  pid: number;
  slug: string;
  /** ISO instant the landing started. */
  at: string;
  /** Random, so a holder recognises its own lock and never removes another's. */
  token: string;
}

/** Where the lock lives: under the git directory every worktree shares, so a call through a worktree's paths meets the same lock. */
export function landLockFile(root: string): string {
  return path.join(gitCommonDir(root), "reggie-land.lock");
}

function readLock(file: string): LockBody | null {
  try {
    const v: unknown = JSON.parse(readFileSync(file, "utf8"));
    if (v === null || typeof v !== "object") return null;
    const o = v as Record<string, unknown>;
    if (typeof o.pid !== "number" || typeof o.slug !== "string" || typeof o.at !== "string" || typeof o.token !== "string") return null;
    return { pid: o.pid, slug: o.slug, at: o.at, token: o.token };
  } catch {
    return null;
  }
}

function pidAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // EPERM: the process exists and belongs to someone else. Only ESRCH says there is none.
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
}

/** Create the lock with its content in one step, so no reader ever sees it empty. False when it already exists. */
function createLock(file: string, body: LockBody): boolean {
  const tmp = `${file}.${body.pid}.${body.token}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(body)}\n`, "utf8");
  try {
    linkSync(tmp, file);
    return true;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "EEXIST") return false;
    // A filesystem without hard links: fall back to an exclusive create, which is atomic but briefly empty.
    try {
      writeFileSync(file, `${JSON.stringify(body)}\n`, { encoding: "utf8", flag: "wx" });
      return true;
    } catch (inner) {
      if ((inner as NodeJS.ErrnoException).code === "EEXIST") return false;
      throw inner;
    }
  } finally {
    try {
      unlinkSync(tmp);
    } catch {
      // Nothing to clean up.
    }
  }
}

/**
 * Take the landing lock or throw a `LandError` naming the landing that holds it. There is no
 * waiting and no polling: the server answers one request at a time, so an approval that waited
 * would hang every other request. A lock whose pid is dead, or that is older than ten minutes, is
 * left behind by a crash and is replaced, once: it is moved aside by an atomic rename, checked to
 * be the stale lock that was read and not a fresh one that took its place in between, and only then
 * is a new one created. If a fresh one was moved, it is put back and this call refuses.
 */
export function acquireLandLock(root: string, slug: string, now: () => number = Date.now): { file: string; release: () => void } {
  const file = landLockFile(root);
  const body: LockBody = { pid: process.pid, slug, at: new Date(now()).toISOString(), token: randomBytes(8).toString("hex") };
  const held = (by: LockBody | null): LandError =>
    new LandError(
      by
        ? `another landing is in progress: task/${by.slug} (pid ${by.pid}, started ${by.at}). One task lands at a time; decide again when it has finished. Nothing was recorded.`
        : "another landing holds the lock and its record cannot be read yet. Decide again in a moment. Nothing was recorded.",
    );
  const release = (): void => {
    if (readLock(file)?.token === body.token) {
      try {
        unlinkSync(file);
      } catch {
        // Already gone.
      }
    }
  };
  if (createLock(file, body)) return { file, release };

  const seen = readLock(file);
  let stale: boolean;
  if (seen) stale = !pidAlive(seen.pid) || !(now() - Date.parse(seen.at) < LAND_LOCK_STALE_MS);
  else {
    // Unreadable: stale only when the file itself is old. A missing file means the holder just finished.
    try {
      stale = now() - statSync(file).mtimeMs >= LAND_LOCK_STALE_MS;
    } catch {
      stale = true;
    }
  }
  if (!stale) throw held(seen);

  const aside = `${file}.stale.${body.token}`;
  try {
    renameSync(file, aside);
    const moved = readLock(aside);
    if (moved && moved.token !== seen?.token) {
      // Not the lock that was judged stale: a live landing replaced it in between. Put it back.
      try {
        linkSync(aside, file);
      } catch {
        // Another lock is already in its place; that landing is refused by its own checks, not by this one.
      }
      throw held(moved);
    }
  } catch (err) {
    if (err instanceof LandError) throw err;
    // ENOENT: someone else moved or released it first. The create below decides.
  } finally {
    try {
      unlinkSync(aside);
    } catch {
      // Nothing was moved aside.
    }
  }
  if (createLock(file, body)) return { file, release };
  throw held(readLock(file));
}

/**
 * Untracked files in the base checkout that the branch also carries. git refuses a merge that would
 * overwrite one, so they are reported as a refusal rather than as a merge that failed for its own reasons.
 * The common pair is today's journal file, written in the serving checkout and committed on the branch.
 */
function untrackedAlsoOnBranch(root: string, branch: string): string[] {
  const status = git(["status", "--porcelain", "-z", "--untracked-files=all"], { cwd: root, allowFailure: true });
  const candidates = status.stdout.split("\0").filter((entry) => entry.startsWith("?? ")).map((entry) => entry.slice(3));
  if (candidates.length === 0) return [];
  const onBranch = git(["ls-tree", "-r", "--name-only", "-z", branch, "--", ...candidates], { cwd: root, allowFailure: true });
  return onBranch.stdout.split("\0").filter(Boolean);
}

function porcelain(cwd: string, extra: string[]): string[] {
  const r = git(["status", "--porcelain", ...extra], { cwd, allowFailure: true });
  return lines(r.stdout).map((l) => l.slice(3));
}

function lines(text: string): string[] {
  return text.split("\n").filter((l) => l.trim() !== "");
}

/**
 * Undo the merge this call started, and only that one: `MERGE_HEAD` must name the very commit this
 * call asked git to merge. When git refused to start a merge there is nothing to undo, and when the
 * merge in progress is someone else's, aborting it would destroy their work.
 */
function abortOwnMerge(root: string, merging: string): void {
  const head = readText(gitPath(root, "MERGE_HEAD"))?.trim() ?? "";
  if (head !== merging) return;
  git(["merge", "--abort"], { cwd: root, allowFailure: true });
}
