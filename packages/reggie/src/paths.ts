import { existsSync } from "node:fs";
import path from "node:path";
import { git } from "./git.js";

export const REGGIE_DIR = ".reggie";

export interface RepoPaths {
  root: string;
  reggie: string;
  readme: string;
  config: string;
  people: string;
  intake: string;
  tasks: string;
  notes: string;
  cache: string;
  knowledgeJobs: string;
  knowledgeAgent: string;
  journal: string;
  discussions: string;
  onboarding: string;
  claudeMd: string;
  agentsMd: string;
  claudeCommands: string;
  mcpJson: string;
}

/** Locate the repository root for a starting directory. Works inside git worktrees. */
export function findRepoRoot(start: string = process.cwd()): string {
  const r = git(["rev-parse", "--show-toplevel"], { cwd: start, allowFailure: true });
  const top = r.stdout.trim();
  if (r.ok && top) return top;
  let dir = path.resolve(start);
  for (;;) {
    if (existsSync(path.join(dir, ".git"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error(`Not inside a git repository: ${start}`);
}

export function repoPaths(root: string): RepoPaths {
  const reggie = path.join(root, REGGIE_DIR);
  return {
    root,
    reggie,
    readme: path.join(reggie, "README.md"),
    config: path.join(reggie, "config.yaml"),
    people: path.join(reggie, "people.yaml"),
    intake: path.join(reggie, "intake.md"),
    tasks: path.join(reggie, "tasks"),
    notes: path.join(reggie, "notes"),
    cache: path.join(reggie, ".cache"),
    knowledgeJobs: path.join(reggie, ".cache", "knowledge-jobs"),
    knowledgeAgent: path.join(reggie, ".cache", "knowledge-agent"),
    journal: path.join(reggie, "journal"),
    discussions: path.join(reggie, "discussions"),
    onboarding: path.join(reggie, "ONBOARDING.md"),
    claudeMd: path.join(root, "CLAUDE.md"),
    agentsMd: path.join(root, "AGENTS.md"),
    claudeCommands: path.join(root, ".claude", "commands"),
    mcpJson: path.join(root, ".mcp.json"),
  };
}

/** Slugs are the only user input that becomes a path segment; validate every time. */
export function assertSlug(slug: string): string {
  if (!/^[a-z0-9][a-z0-9-]{0,79}$/.test(slug)) {
    throw new Error(`"${slug}" is not a valid slug. Use lowercase letters, digits, and hyphens.`);
  }
  return slug;
}

export function taskDir(paths: RepoPaths, slug: string): string {
  return path.join(paths.tasks, assertSlug(slug));
}

export function claimFile(paths: RepoPaths, slug: string): string {
  return path.join(taskDir(paths, slug), "claim.md");
}

export function claimRelPath(slug: string): string {
  return `${REGGIE_DIR}/tasks/${assertSlug(slug)}/claim.md`;
}

export function briefFile(paths: RepoPaths, slug: string): string {
  return path.join(taskDir(paths, slug), "brief.md");
}

export function planFile(paths: RepoPaths, slug: string): string {
  return path.join(taskDir(paths, slug), "plan.md");
}

export function packetFile(paths: RepoPaths, slug: string): string {
  return path.join(taskDir(paths, slug), "packet.md");
}

export function evidenceDir(paths: RepoPaths, slug: string): string {
  return path.join(taskDir(paths, slug), "evidence");
}

/** The check records of a task: one JSON object per line, appended on the task branch only. */
export function checksFile(paths: RepoPaths, slug: string): string {
  return path.join(taskDir(paths, slug), "checks.jsonl");
}

/** Repo-relative path of a task's brief, for git lookups. */
export function briefRelPath(slug: string): string {
  return `${REGGIE_DIR}/tasks/${assertSlug(slug)}/brief.md`;
}

/** Repo-relative path of a task's plan file, for git lookups. */
export function planRelPath(slug: string): string {
  return `${REGGIE_DIR}/tasks/${assertSlug(slug)}/plan.md`;
}

export function packetRelPath(slug: string): string {
  return `${REGGIE_DIR}/tasks/${assertSlug(slug)}/packet.md`;
}

/** Repo-relative path of a task's check records, for git lookups. */
export function checksRelPath(slug: string): string {
  return `${REGGIE_DIR}/tasks/${assertSlug(slug)}/checks.jsonl`;
}

/** Repo-relative path of a task's own folder, with the trailing slash a prefix test needs. */
export function taskRelDir(slug: string): string {
  return `${REGGIE_DIR}/tasks/${assertSlug(slug)}/`;
}

/** Repo-relative path of a task's evidence folder, with the trailing slash. The only folder a citation may name. */
export function evidenceRelDir(slug: string): string {
  return `${taskRelDir(slug)}evidence/`;
}

export const TASKS_REL_DIR = `${REGGIE_DIR}/tasks`;
