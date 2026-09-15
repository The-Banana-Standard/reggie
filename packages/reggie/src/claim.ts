import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { aheadCount, currentBranch, defaultBranch, fileAtRef, git, listBranches, type BranchInfo } from "./git.js";
import { appendJournal, detectTool, sessionName, type ToolName } from "./journal.js";
import { claimRelPath, repoPaths, type RepoPaths } from "./paths.js";
import type { Person, ReggieConfig } from "./people.js";
import { parseClaim, type ClaimInfo } from "./tasks.js";
import { nowIso, relPosix, writeText } from "./util.js";

export interface ClaimOptions {
  worktree?: boolean;
  person: Person;
  /** The tool the session runs in, when the claim is made by a launcher rather than from inside a session. */
  tool?: ToolName;
  /** The session id the launcher minted, so the claim record points back at the chat. */
  session?: string;
}

export interface ClaimResult {
  branch: string;
  worktree: string | null;
  alreadyExisted: boolean;
  owner: string | null;
}

function refFor(branch: BranchInfo): string {
  return branch.remote ? `origin/${branch.name}` : branch.name;
}

/** Who holds a task branch: the committed claim record when present, else the tip commit's author. */
export function branchOwner(root: string, branch: BranchInfo, slug: string): { person: string; email: string; source: "claim" | "tip" } {
  const content = fileAtRef(root, refFor(branch), claimRelPath(slug));
  if (content) {
    const c: ClaimInfo = parseClaim(content);
    if (c.person || c.email) return { person: c.person, email: c.email, source: "claim" };
  }
  return { person: branch.author, email: branch.email, source: "tip" };
}

function samePerson(owner: { person: string; email: string }, me: Person): boolean {
  if (owner.email && me.email) return owner.email.toLowerCase() === me.email.toLowerCase();
  const a = (owner.person || "").trim().toLowerCase();
  const b = (me.name || me.handle).trim().toLowerCase();
  return a !== "" && (a === b || a === me.handle.toLowerCase());
}

/**
 * Claim a task: create the task/<slug> branch from the integration branch and commit a claim record
 * on it, so ownership is explicit from the first commit. Refuses a branch someone else holds.
 */
export function claimTask(paths: RepoPaths, config: ReggieConfig, slug: string, opts: ClaimOptions): ClaimResult {
  const root = paths.root;
  const branch = `task/${slug}`;
  const base = defaultBranch(root, config.defaultBranch);
  const existing = listBranches(root, branch).find((b) => b.name === branch) ?? null;

  if (existing) {
    const owner = branchOwner(root, existing, slug);
    if (!samePerson(owner, opts.person)) {
      throw new Error(
        `${branch} is held by ${owner.person || owner.email || "someone else"} (last activity ${existing.date.slice(0, 10)}). Ask them to \`reggie release ${slug}\`, or pick another task.`,
      );
    }
  }

  let workdir = root;
  let worktree: string | null = null;
  if (opts.worktree) {
    worktree = path.join(root, ".worktree", slug);
    workdir = worktree;
    if (!existsSync(worktree)) {
      const args = existing ? ["worktree", "add", worktree, existing.remote ? `origin/${branch}` : branch] : ["worktree", "add", "-b", branch, worktree, base];
      git(args, { cwd: root });
      if (existing?.remote) git(["switch", "-c", branch, `origin/${branch}`], { cwd: worktree, allowFailure: true });
    }
  } else if (!existing) {
    git(["switch", "-c", branch, base], { cwd: root });
  } else if (currentBranch(root) !== branch) {
    const local = git(["switch", branch], { cwd: root, allowFailure: true });
    if (!local.ok) git(["switch", "-c", branch, `origin/${branch}`], { cwd: root });
  }

  // A worktree claim writes its entry in the worktree, never through the serving checkout's paths: an entry
  // left uncommitted there makes git refuse to merge this branch back into it.
  const journalPaths = worktree ? repoPaths(workdir) : paths;
  const entry = {
    person: opts.person.handle,
    tool: opts.tool ?? detectTool(),
    slug,
    stage: "claim",
    text: existing ? "Resumed work on the task branch." : `Claimed the task and started a branch from ${base}${worktree ? " in a separate worktree" : ""}.`,
  };

  const hasClaim = existing ? fileAtRef(root, refFor(existing), claimRelPath(slug)) !== null : false;
  const commitsEntry = worktree !== null && !hasClaim;
  if (!hasClaim) {
    const rel = claimRelPath(slug);
    writeText(path.join(workdir, rel), renderClaim(opts.person, opts));
    const files = commitsEntry ? [rel, relPosix(workdir, appendJournal(journalPaths, entry).file)] : [rel];
    git(["add", "--", ...files], { cwd: workdir });
    // The Task trailer is how history attributes commits to a task once the branch is gone.
    git(["-c", "commit.gpgsign=false", "commit", "-q", "-m", `meta: claim ${slug}`, "-m", `Task: ${slug}`, "--", ...files], { cwd: workdir });
  }
  // Resumes and in-place claims commit nothing. releaseTask counts every commit beyond the claim as unmerged
  // work, and an in-place release must switch away from a branch whose day file would otherwise be tracked
  // and dirty, which git refuses.
  if (!commitsEntry) appendJournal(journalPaths, entry);

  return { branch, worktree, alreadyExisted: Boolean(existing), owner: existing ? branchOwner(root, existing, slug).person : opts.person.name };
}

function renderClaim(person: Person, opts: { tool?: ToolName; session?: string } = {}): string {
  return [
    "---",
    `person: ${person.name || person.handle}`,
    `handle: ${person.handle}`,
    `email: ${person.email}`,
    `machine: ${os.hostname()}`,
    `tool: ${opts.tool ?? detectTool()}`,
    `session: ${opts.session ?? sessionName()}`,
    `date: ${nowIso()}`,
    "---",
    "Claim record. Reggie reads this from the task branch to know who holds the task; the branch's last commit is the heartbeat.",
    "",
  ].join("\n");
}

export interface ReleaseOptions {
  force?: boolean;
}

/**
 * Release a claim by deleting the local task branch and worktree. Refuses someone else's branch and
 * refuses to drop unmerged commits unless forced. Never touches the remote.
 */
export function releaseTask(paths: RepoPaths, config: ReggieConfig, slug: string, person: Person, opts: ReleaseOptions = {}): string[] {
  const root = paths.root;
  const branch = `task/${slug}`;
  const base = defaultBranch(root, config.defaultBranch);
  const existing = listBranches(root, branch).find((b) => b.name === branch) ?? null;
  if (!existing || existing.remote) return [`no local ${branch} to release`];

  const owner = branchOwner(root, existing, slug);
  if (!samePerson(owner, person) && !opts.force) {
    throw new Error(`${branch} is held by ${owner.person || owner.email}. Pass --force to release it anyway.`);
  }
  const ahead = aheadCount(root, branch, base);
  const meaningful = Math.max(0, ahead - (owner.source === "claim" ? 1 : 0));
  if (meaningful > 0 && !opts.force) {
    throw new Error(`${branch} has ${meaningful} unmerged commit${meaningful === 1 ? "" : "s"} beyond the claim record. Merge or push first, or pass --force to discard them.`);
  }

  const actions: string[] = [];
  const worktree = path.join(root, ".worktree", slug);
  if (existsSync(worktree)) {
    git(["worktree", "remove", "--force", worktree], { cwd: root, allowFailure: true });
    actions.push(`removed worktree ${worktree}`);
  }
  if (currentBranch(root) === branch) {
    git(["switch", base], { cwd: root });
    actions.push(`switched to ${base}`);
  }
  const del = git(["branch", "-D", branch], { cwd: root, allowFailure: true });
  if (del.ok) actions.push(`deleted local ${branch}`);
  appendJournal(paths, { person: person.handle, tool: detectTool(), slug, stage: "release", text: "Released the claim on this task." });
  return actions;
}
