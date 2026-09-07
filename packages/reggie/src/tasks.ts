import { existsSync, readdirSync, statSync } from "node:fs";
import { aheadCount, defaultBranch, fileAtRef, lastCommitDate, listBranches, treePaths, type BranchInfo } from "./git.js";
import { pullRequestForBranch, type PullRequest } from "./gh.js";
import { claimRelPath, packetFile, packetRelPath, planFile, planRelPath, TASKS_REL_DIR, type RepoPaths } from "./paths.js";
import type { Mode, ReggieConfig } from "./people.js";
import { lintPlan, parsePlan, type Risk } from "./plan.js";
import { isSafeSlug, readText, slugify } from "./util.js";
import { parsePacketVerdict } from "./packet.js";

export type TaskState = "ungroomed" | "grooming" | "groomed" | "in-process" | "awaiting-decision" | "done";
export const TASK_STATES: TaskState[] = ["ungroomed", "grooming", "groomed", "in-process", "awaiting-decision", "done"];

export interface IntakeItem {
  slug: string;
  /** The slug as written, when the line had one. */
  rawSlug: string | null;
  text: string;
  /** The trailing "(person, source, date)" group, when present. */
  meta: string | null;
  detail: string[];
  line: number;
}

export interface ClaimInfo {
  person: string;
  email: string;
  machine: string;
  tool: string;
  date: string;
}

export interface TaskInfo {
  slug: string;
  title: string;
  state: TaskState;
  risk: Risk | "unset";
  owner: string | null;
  ownerEmail: string | null;
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

/**
 * Parse intake items. Any bullet (`-`, `*`, `+`) indented at most three spaces is an item,
 * with an optional checkbox and an optional `slug:` prefix. Lines indented four or more spaces
 * are Markdown code and ignored. A trailing "(a, b, c)" with at least two commas is metadata.
 */
export function parseIntake(content: string): IntakeItem[] {
  const items: IntakeItem[] = [];
  const lines = content.replace(/\r\n/g, "\n").split("\n");
  let current: IntakeItem | null = null;
  const itemRe = /^ {0,3}[-*+]\s+(?:\[[ xX]\]\s+)?(?:([A-Za-z0-9][A-Za-z0-9_-]*):\s+)?(.+?)(?:\s+\(([^()]*,[^()]*,[^()]*)\))?\s*$/;
  lines.forEach((line, idx) => {
    const m = itemRe.exec(line);
    if (m) {
      const rawSlug = m[1] ?? null;
      const text = (m[2] ?? "").trim();
      if (!text) return;
      const slug = rawSlug ? slugify(rawSlug, 80) : slugify(text, 48);
      if (!isSafeSlug(slug)) return;
      current = { slug, rawSlug, text, meta: m[3] ?? null, detail: [], line: idx + 1 };
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

export function taskDirs(paths: RepoPaths): string[] {
  if (!existsSync(paths.tasks)) return [];
  return readdirSync(paths.tasks).filter((name) => isSafeSlug(name) && statSync(`${paths.tasks}/${name}`).isDirectory());
}

/** Every slug Reggie knows about: intake, task directories, and task or plan branches. */
export function knownSlugs(paths: RepoPaths): Set<string> {
  const slugs = new Set<string>();
  for (const i of readIntake(paths)) slugs.add(i.slug);
  for (const d of taskDirs(paths)) slugs.add(d);
  for (const b of listBranches(paths.root, "task/")) slugs.add(b.name.slice("task/".length));
  for (const b of listBranches(paths.root, "plan/")) slugs.add(b.name.slice("plan/".length));
  return slugs;
}

export function parseClaim(content: string): ClaimInfo {
  const get = (key: string) => new RegExp(`^${key}:\\s*(.*)$`, "m").exec(content)?.[1]?.trim() ?? "";
  return { person: get("person"), email: get("email"), machine: get("machine"), tool: get("tool"), date: get("date") };
}

export interface TaskListOptions {
  includeDone?: boolean;
}

interface Snapshot {
  base: string;
  mode: Mode;
  onBase: Set<string>;
  intake: IntakeItem[];
  taskBranches: BranchInfo[];
  planBranches: BranchInfo[];
}

function snapshot(paths: RepoPaths, config: ReggieConfig): Snapshot {
  const base = defaultBranch(paths.root, config.defaultBranch);
  return {
    base,
    mode: config.mode,
    onBase: treePaths(paths.root, base, TASKS_REL_DIR),
    intake: readIntake(paths),
    taskBranches: listBranches(paths.root, "task/"),
    planBranches: listBranches(paths.root, "plan/"),
  };
}

/** Derive every task and its state from intake, task directories, branches, and pull requests. */
export function listTasks(paths: RepoPaths, config: ReggieConfig, opts: TaskListOptions = {}): TaskInfo[] {
  const snap = snapshot(paths, config);
  const slugs = new Set<string>();
  for (const i of snap.intake) slugs.add(i.slug);
  for (const d of taskDirs(paths)) slugs.add(d);
  for (const b of snap.taskBranches) slugs.add(b.name.slice("task/".length));
  for (const b of snap.planBranches) slugs.add(b.name.slice("plan/".length));
  for (const p of snap.onBase) {
    const m = /^\.reggie\/tasks\/([a-z0-9][a-z0-9-]*)\//.exec(p);
    if (m?.[1]) slugs.add(m[1]);
  }

  const tasks: TaskInfo[] = [];
  for (const slug of Array.from(slugs).sort()) {
    const info = deriveTask(paths, slug, snap);
    if (!opts.includeDone && info.state === "done") continue;
    tasks.push(info);
  }
  const order: Record<TaskState, number> = { "awaiting-decision": 0, "in-process": 1, groomed: 2, grooming: 3, ungroomed: 4, done: 5 };
  tasks.sort((a, b) => order[a.state] - order[b.state] || a.slug.localeCompare(b.slug));
  return tasks;
}

export function getTask(paths: RepoPaths, config: ReggieConfig, slug: string): TaskInfo {
  if (!isSafeSlug(slug)) throw new Error(`"${slug}" is not a valid slug.`);
  return deriveTask(paths, slug, snapshot(paths, config));
}

function refFor(branch: BranchInfo): string {
  return branch.remote ? `origin/${branch.name}` : branch.name;
}

function deriveTask(paths: RepoPaths, slug: string, snap: Snapshot): TaskInfo {
  const root = paths.root;
  const intake = snap.intake.find((i) => i.slug === slug) ?? null;
  const branch = snap.taskBranches.find((b) => b.name === `task/${slug}`) ?? null;
  const planBranch = snap.planBranches.find((b) => b.name === `plan/${slug}`) ?? null;

  const planLocal = readText(planFile(paths, slug));
  const planOnDefault = snap.onBase.has(planRelPath(slug));
  const planDefault = planLocal === null && planOnDefault ? fileAtRef(root, snap.base, planRelPath(slug)) : null;
  const packetDefault = snap.onBase.has(packetRelPath(slug)) ? fileAtRef(root, snap.base, packetRelPath(slug)) : null;
  const packetLocal = readText(packetFile(paths, slug));
  const packetOnBranch = branch && !packetLocal ? fileAtRef(root, refFor(branch), packetRelPath(slug)) : null;
  const claimContent = branch ? fileAtRef(root, refFor(branch), claimRelPath(slug)) : null;
  const claim = claimContent ? parseClaim(claimContent) : null;
  const pr = branch ? pullRequestForBranch(root, branch.name) : null;

  const planContent = planLocal ?? planDefault;
  const parsed = planContent ? parsePlan(planContent) : null;
  const title = parsed?.meta.title || intake?.text || slug;
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
    reason = `packet approved on ${snap.base}`;
  } else if (pr?.state === "OPEN") {
    state = "awaiting-decision";
    reason = `PR #${pr.number} open`;
  } else if (branch && (packetOnBranch || packetLocal)) {
    state = "awaiting-decision";
    reason = `packet exists on ${branch.name}`;
  } else if (branch) {
    const ahead = aheadCount(root, refFor(branch), snap.base);
    state = "in-process";
    reason = `${branch.name} has ${ahead} commit${ahead === 1 ? "" : "s"} ahead of ${snap.base}`;
  } else if (planOnDefault) {
    state = "groomed";
    reason = `plan merged to ${snap.base}`;
  } else if (planBranch) {
    state = "grooming";
    reason = `${planBranch.name} exists`;
  } else if (planLocal) {
    if (planLintOk && snap.mode === "solo") {
      state = "groomed";
      reason = "plan on disk passes the contract; solo mode counts it as groomed until committed";
    } else {
      state = "grooming";
      reason = planLintOk ? "plan on disk passes the contract; team mode needs it merged or on a plan/ branch" : "plan on disk does not pass the contract yet";
    }
  } else {
    state = "ungroomed";
    reason = intake ? "intake item with no plan" : "task directory without a plan";
  }

  const owner = claim?.person || branch?.author || planBranch?.author || parsed?.meta.author || null;
  const ownerEmail = claim?.email || branch?.email || planBranch?.email || null;
  const lastActivity = branch?.date || planBranch?.date || (planLocal ? lastCommitDate(root, planRelPath(slug)) : null);

  return {
    slug,
    title,
    state,
    risk,
    owner,
    ownerEmail,
    lastActivity,
    branch: branch?.name ?? planBranch?.name ?? null,
    pr,
    planExists: Boolean(planLocal || planOnDefault),
    planOnDefault,
    planLintOk,
    packetExists: Boolean(packetLocal || packetOnBranch || packetDefault),
    intake,
    reason,
  };
}

export function renderTaskLine(t: TaskInfo): string {
  const who = t.owner ? ` · ${t.owner}` : "";
  const when = t.lastActivity ? ` · ${t.lastActivity.slice(0, 10)}` : "";
  const risk = t.risk !== "unset" ? ` [${t.risk}]` : "";
  return `${t.state.padEnd(17)} ${t.slug}${risk}${who}${when}  — ${t.title}${t.reason ? ` (${t.reason})` : ""}`;
}
