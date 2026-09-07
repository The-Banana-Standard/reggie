import { existsSync } from "node:fs";
import path from "node:path";
import { branchExists, currentBranch, defaultBranch, git, listBranches } from "./git.js";
import { appendJournal, detectTool } from "./journal.js";
import type { RepoPaths } from "./paths.js";
import type { Person, ReggieConfig } from "./people.js";

export interface ClaimOptions {
  worktree?: boolean;
  person: Person;
}

export interface ClaimResult {
  branch: string;
  worktree: string | null;
  alreadyExisted: boolean;
  owner: string | null;
}

/**
 * Claim a task by creating (or switching to) its task/<slug> branch. A branch that exists with
 * another author is someone else's claim; we report it instead of taking it over silently.
 */
export function claimTask(paths: RepoPaths, config: ReggieConfig, slug: string, opts: ClaimOptions): ClaimResult {
  const root = paths.root;
  const branch = `task/${slug}`;
  const base = defaultBranch(root, config.defaultBranch);
  const existing = listBranches(root, branch).find((b) => b.name === branch) ?? null;

  if (existing && existing.email && opts.person.email && existing.email !== opts.person.email) {
    throw new Error(`${branch} already exists and its last commit is by ${existing.author} (${existing.date.slice(0, 10)}). That is their claim. Use \`reggie release ${slug}\` with them, or pick another task.`);
  }

  let worktree: string | null = null;
  if (opts.worktree) {
    worktree = path.join(root, ".worktree", slug);
    if (!existsSync(worktree)) {
      const args = existing ? ["worktree", "add", worktree, branch] : ["worktree", "add", "-b", branch, worktree, base];
      git(args, { cwd: root });
    }
  } else if (!existing) {
    git(["switch", "-c", branch, base], { cwd: root });
  } else if (currentBranch(root) !== branch) {
    if (branchExists(root, branch)) git(["switch", branch], { cwd: root });
    else git(["switch", "-c", branch, `origin/${branch}`], { cwd: root });
  }

  appendJournal(paths, {
    person: opts.person.handle,
    tool: detectTool(),
    slug,
    stage: "claim",
    text: existing ? `Resumed work on the task branch.` : `Claimed the task and started a branch from ${base}${worktree ? " in a separate worktree" : ""}.`,
  });

  return { branch, worktree, alreadyExisted: Boolean(existing), owner: existing?.author ?? null };
}

/** Release a claim by deleting the local task branch (and worktree). Never touches the remote. */
export function releaseTask(paths: RepoPaths, config: ReggieConfig, slug: string, person: Person): string[] {
  const root = paths.root;
  const branch = `task/${slug}`;
  const base = defaultBranch(root, config.defaultBranch);
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
