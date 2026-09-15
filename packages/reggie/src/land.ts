import { existsSync } from "node:fs";
import path from "node:path";
import { releaseTask } from "./claim.js";
import { currentBranch, defaultBranch, fileAtRef, git } from "./git.js";
import { taskLanding } from "./history.js";
import { appendJournal, detectTool } from "./journal.js";
import { decidePacket, materializePacket } from "./packet.js";
import { packetFile, packetRelPath, planFile, planRelPath, type RepoPaths } from "./paths.js";
import type { Person, ReggieConfig } from "./people.js";
import { parsePlan } from "./plan.js";
import { readText, relPosix } from "./util.js";

/*
 * Landing an approved task in solo mode: the no-fast-forward merge that makes the merge commit the
 * durable record of what a task changed. The verdict and the decide entry are written inside the merge
 * commit, so a task reads done exactly when it has landed. Every refusal happens before anything is
 * written, and a merge that stops is aborted with both branches as they were. Nothing is pushed.
 */

export interface LandInput {
  person: Person;
  comment?: string;
  /** The tool the journal entry is attributed to; default detected. */
  tool?: string;
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
}

/** A refusal or an aborted merge. Nothing was recorded. */
export class LandError extends Error {}

export function landTask(paths: RepoPaths, config: ReggieConfig, slug: string, input: LandInput): LandResult {
  const root = paths.root;
  const branch = `task/${slug}`;
  const base = defaultBranch(root, config.defaultBranch);
  const refuse = (why: string): never => {
    throw new LandError(`refusing to merge ${branch}: ${why}`);
  };

  const on = currentBranch(root);
  if (on !== base) refuse(`this checkout is on ${on}, not ${base}. Run it from the checkout that has ${base} checked out.`);
  const dirty = porcelain(root, ["--untracked-files=no"]);
  if (dirty.length > 0) refuse(`${base} has uncommitted changes (${dirty.join(", ")}). Commit or stash them first; an aborted merge cannot promise to restore them.`);
  if (!git(["show-ref", "--verify", "--quiet", `refs/heads/${branch}`], { cwd: root, allowFailure: true }).ok) refuse("there is no local branch by that name.");
  const worktree = path.join(root, ".worktree", slug);
  if (existsSync(worktree)) {
    const wip = porcelain(worktree, []);
    if (wip.length > 0) refuse(`its worktree has uncommitted changes (${wip.join(", ")}). Commit them on the branch or discard them first.`);
  }
  const packetOnBranch = fileAtRef(root, branch, packetRelPath(slug));
  if (packetOnBranch === null) return refuse(`it has no packet. Write one with \`reggie packet ${slug}\` and commit it on the branch.`);

  const title = parsePlan(fileAtRef(root, branch, planRelPath(slug)) ?? readText(planFile(paths, slug)) ?? "").meta.title || slug;
  const comment = input.comment?.trim() ?? "";
  const alreadyLanded = git(["merge-base", "--is-ancestor", branch, base], { cwd: root, allowFailure: true }).ok;
  let existingMerge: string | null = null;
  let packet: string;

  if (alreadyLanded) {
    existingMerge = taskLanding(root, slug, { base }).merge?.sha ?? null;
    if (!existsSync(packetFile(paths, slug))) materializePacket(paths, slug, packetOnBranch);
    packet = recordApproval(paths, slug, input, `decide: ${slug} approved`, `Decision: approved. The task branch had already landed on ${base}.`);
  } else {
    const started = git(["-c", "commit.gpgsign=false", "merge", "--no-ff", "--no-commit", branch], { cwd: root, allowFailure: true });
    if (!started.ok) {
      const conflicted = lines(git(["diff", "--name-only", "--diff-filter=U"], { cwd: root, allowFailure: true }).stdout);
      abortMerge(root);
      throw new LandError(
        conflicted.length > 0
          ? `merging ${branch} into ${base} conflicts in ${conflicted.join(", ")}. The merge was aborted and nothing was recorded; merge ${base} into the branch, resolve it there, then decide again.`
          : `merging ${branch} into ${base} failed and was aborted; nothing was recorded: ${(started.stderr || started.stdout).trim()}`,
      );
    }
    try {
      packet = recordApproval(paths, slug, input, `merge: ${branch} — ${title}`, `Decision: approved. Merged the task branch into ${base}.`);
    } catch (err) {
      abortMerge(root);
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
  return { base, commit, merge: alreadyLanded ? null : commit, alreadyLanded, existingMerge, packet, released, releaseError };

  /** Verdict and journal entry, staged together and committed as one commit (the merge, when one is in progress). */
  function recordApproval(p: RepoPaths, s: string, i: LandInput, subject: string, entry: string): string {
    const file = decidePacket(p, s, "approved", i.person.handle, comment || undefined);
    const journal = appendJournal(p, { person: i.person.handle, tool: i.tool ?? detectTool(), slug: s, stage: "decide", text: comment ? `${entry} ${comment}` : entry });
    git(["add", "--", relPosix(root, file), relPosix(root, journal.file)], { cwd: root });
    const message = ["-m", subject, ...(comment ? ["-m", comment] : []), "-m", `Task: ${s}\nDecided-by: ${i.person.handle}`];
    git(["-c", "commit.gpgsign=false", "commit", "-q", ...message], { cwd: root });
    return file;
  }
}

function porcelain(cwd: string, extra: string[]): string[] {
  const r = git(["status", "--porcelain", ...extra], { cwd, allowFailure: true });
  return lines(r.stdout).map((l) => l.slice(3));
}

function lines(text: string): string[] {
  return text.split("\n").filter((l) => l.trim() !== "");
}

/** Undo a merge in progress. Harmless when git refused to start one. */
function abortMerge(root: string): void {
  git(["merge", "--abort"], { cwd: root, allowFailure: true });
}
