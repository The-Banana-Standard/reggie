import { existsSync, readdirSync, statSync } from "node:fs";
import { aheadCount, defaultBranch, fileAtRef, lastCommitDate, listBranches, type BranchInfo } from "./git.js";
import { pullRequestForBranch, type PullRequest } from "./gh.js";
import { packetRelPath, planFile, planRelPath, type RepoPaths } from "./paths.js";
import type { ReggieConfig } from "./people.js";
import { lintPlan, parsePlan, type Risk } from "./plan.js";
import { isSafeSlug, readText } from "./util.js";
import { parsePacketVerdict } from "./packet.js";

export type TaskState = "ungroomed" | "grooming" | "groomed" | "in-process" | "awaiting-decision" | "done";
export const TASK_STATES: TaskState[] = ["ungroomed", "grooming", "groomed", "in-process", "awaiting-decision", "done"];

export interface IntakeItem {
  slug: string;
  text: string;
  /** The trailing "(person, source, date)" group, when present. */
  meta: string | null;
  detail: string[];
  line: number;
}

export interface TaskInfo {
  slug: string;
  title: string;
  state: TaskState;
  risk: Risk | "unset";
  owner: string | null;
  lastActivity: string | null;
  branch: string | null;
  pr: PullRequest | null;
  planExists: boolean;
  planOnDefault: boolean;
  planLintOk: boolean | null;
  packetExists: boolean;
  intake: IntakeItem | null;
  reason: string;
}

/** Parse `- slug: text` lines (and their `  > detail` lines) from intake.md. */
export function parseIntake(content: string): IntakeItem[] {
  const items: IntakeItem[] = [];
  const lines = content.split("\n");
  let current: IntakeItem | null = null;
  lines.forEach((line, idx) => {
    const m = /^- ([a-z0-9][a-z0-9-]*):\s+(.+?)(?:\s+\(([^()]*)\))?\s*$/.exec(line);
    if (m) {
      current = { slug: m[1] ?? "", text: (m[2] ?? "").trim(), meta: m[3] ?? null, detail: [], line: idx + 1 };
      items.push(current);
      return;
    }
    if (current && /^\s+>\s?/.test(line)) {
      current.detail.push(line.replace(/^\s+>\s?/, "").trim());
      return;
    }
    if (line.trim() === "") return;
    if (!/^\s/.test(line)) current = null;
  });
  return items;
}

export function readIntake(paths: RepoPaths): IntakeItem[] {
  const content = readText(paths.intake);
  return content ? parseIntake(content) : [];
}

function taskDirs(paths: RepoPaths): string[] {
  if (!existsSync(paths.tasks)) return [];
  return readdirSync(paths.tasks).filter((name) => isSafeSlug(name) && statSync(`${paths.tasks}/${name}`).isDirectory());
}

export interface TaskListOptions {
  includeDone?: boolean;
}

/** Derive every task and its state from intake, task directories, branches, and pull requests. */
export function listTasks(paths: RepoPaths, config: ReggieConfig, opts: TaskListOptions = {}): TaskInfo[] {
  const root = paths.root;
  const base = defaultBranch(root, config.defaultBranch);
  const intake = readIntake(paths);
  const taskBranches = listBranches(root, "task/");
  const planBranches = listBranches(root, "plan/");
  const slugs = new Set<string>();
  for (const i of intake) slugs.add(i.slug);
  for (const d of taskDirs(paths)) slugs.add(d);
  for (const b of taskBranches) slugs.add(b.name.slice("task/".length));
  for (const b of planBranches) slugs.add(b.name.slice("plan/".length));

  const tasks: TaskInfo[] = [];
  for (const slug of Array.from(slugs).sort()) {
    const info = deriveTask(paths, slug, {
      base,
      intake: intake.find((i) => i.slug === slug) ?? null,
      branch: taskBranches.find((b) => b.name === `task/${slug}`) ?? null,
      planBranch: planBranches.find((b) => b.name === `plan/${slug}`) ?? null,
    });
    if (!opts.includeDone && info.state === "done") continue;
    tasks.push(info);
  }
  const order: Record<TaskState, number> = { "awaiting-decision": 0, "in-process": 1, groomed: 2, grooming: 3, ungroomed: 4, done: 5 };
  tasks.sort((a, b) => order[a.state] - order[b.state] || a.slug.localeCompare(b.slug));
  return tasks;
}

export function getTask(paths: RepoPaths, config: ReggieConfig, slug: string): TaskInfo {
  const base = defaultBranch(paths.root, config.defaultBranch);
  const intake = readIntake(paths).find((i) => i.slug === slug) ?? null;
  const branch = listBranches(paths.root, `task/${slug}`).find((b) => b.name === `task/${slug}`) ?? null;
  const planBranch = listBranches(paths.root, `plan/${slug}`).find((b) => b.name === `plan/${slug}`) ?? null;
  return deriveTask(paths, slug, { base, intake, branch, planBranch });
}

interface DeriveInput {
  base: string;
  intake: IntakeItem | null;
  branch: BranchInfo | null;
  planBranch: BranchInfo | null;
}

function deriveTask(paths: RepoPaths, slug: string, input: DeriveInput): TaskInfo {
  const root = paths.root;
  const planPath = planFile(paths, slug);
  const planLocal = readText(planPath);
  const planDefault = fileAtRef(root, input.base, planRelPath(slug));
  const packetDefault = fileAtRef(root, input.base, packetRelPath(slug));
  const packetOnBranch = input.branch ? fileAtRef(root, input.branch.remote ? `origin/${input.branch.name}` : input.branch.name, packetRelPath(slug)) : null;
  const packetLocal = readText(`${paths.tasks}/${slug}/packet.md`);
  const pr = input.branch ? pullRequestForBranch(root, input.branch.name) : null;

  const planContent = planLocal ?? planDefault;
  const parsed = planContent ? parsePlan(planContent) : null;
  const title = parsed?.meta.title || input.intake?.text || slug;
  const risk: Risk | "unset" = parsed?.meta.risk ?? "unset";
  const planLintOk = planContent ? lintPlan(planContent).ok : null;

  let state: TaskState;
  let reason: string;
  const verdictDefault = packetDefault ? parsePacketVerdict(packetDefault) : null;
  if (pr?.state === "MERGED") {
    state = "done";
    reason = `PR #${pr.number} merged`;
  } else if (verdictDefault === "approved") {
    state = "done";
    reason = `packet approved on ${input.base}`;
  } else if (pr?.state === "OPEN") {
    state = "awaiting-decision";
    reason = `PR #${pr.number} open`;
  } else if (input.branch && (packetOnBranch || packetLocal)) {
    state = "awaiting-decision";
    reason = `packet exists on ${input.branch.name}`;
  } else if (input.branch) {
    const ahead = aheadCount(root, input.branch.remote ? `origin/${input.branch.name}` : input.branch.name, input.base);
    state = "in-process";
    reason = `${input.branch.name} has ${ahead} commit${ahead === 1 ? "" : "s"} ahead of ${input.base}`;
  } else if (planDefault) {
    state = "groomed";
    reason = `plan merged to ${input.base}`;
  } else if (input.planBranch) {
    state = "grooming";
    reason = `${input.planBranch.name} exists`;
  } else if (planLocal) {
    state = planLintOk ? "groomed" : "grooming";
    reason = planLintOk ? "plan on disk passes the contract (solo mode counts this as groomed until committed)" : "plan on disk does not pass the contract yet";
  } else {
    state = "ungroomed";
    reason = input.intake ? "intake item with no plan" : "task directory without a plan";
  }

  const owner = input.branch?.author || input.planBranch?.author || parsed?.meta.author || null;
  const lastActivity = input.branch?.date || input.planBranch?.date || (planLocal ? lastCommitDate(root, planRelPath(slug)) : null);

  return {
    slug,
    title,
    state,
    risk,
    owner,
    lastActivity,
    branch: input.branch?.name ?? input.planBranch?.name ?? null,
    pr,
    planExists: Boolean(planLocal || planDefault),
    planOnDefault: Boolean(planDefault),
    planLintOk,
    packetExists: Boolean(packetLocal || packetOnBranch || packetDefault),
    intake: input.intake,
    reason,
  };
}

export function renderTaskLine(t: TaskInfo): string {
  const who = t.owner ? ` · ${t.owner}` : "";
  const when = t.lastActivity ? ` · ${t.lastActivity.slice(0, 10)}` : "";
  const risk = t.risk !== "unset" ? ` [${t.risk}]` : "";
  return `${t.state.padEnd(17)} ${t.slug}${risk}${who}${when}  — ${t.title}${t.reason ? ` (${t.reason})` : ""}`;
}
