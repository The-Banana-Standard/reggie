import { existsSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { aheadCount, currentBranch, defaultBranch, fileAtRef, git, lastCommitDate, listBranches, treePaths, type BranchInfo } from "./git.js";
import { pullRequestForBranch, type PullRequest } from "./gh.js";
import { readJournal, type JournalEntry } from "./journal.js";
import { briefDraft, parseBrief, type BriefMeta } from "./brief.js";
import { listEvidence, parsePacketVerdict, type Verdict } from "./packet.js";
import { readLegacy, type LegacyBacklog, type LegacyItem } from "./legacy.js";
import { briefFile, briefRelPath, claimRelPath, packetFile, packetRelPath, planFile, planRelPath, REGGIE_DIR, TASKS_REL_DIR, type RepoPaths } from "./paths.js";
import type { Mode, ReggieConfig, RiskRules } from "./people.js";
import { lintPlan, parsePlan, type PlanMeta, type Risk } from "./plan.js";
import { isSafeSlug, readText, slugify, splitFrontMatter, uniq } from "./util.js";

export type TaskState = "ungroomed" | "groomed" | "planned" | "in-process" | "awaiting-decision" | "done";
export const TASK_STATES: TaskState[] = ["ungroomed", "groomed", "planned", "in-process", "awaiting-decision", "done"];

/** The coarse grouping the tasks page columns by: capture it, shape it, plan it, build it. */
export type TaskPhase = "capture" | "shape" | "plan" | "build" | "review" | "done";

const PHASE_BY_STATE: Record<TaskState, TaskPhase> = {
  ungroomed: "capture",
  groomed: "shape",
  planned: "plan",
  "in-process": "build",
  "awaiting-decision": "review",
  done: "done",
};

export function taskPhase(state: TaskState): TaskPhase {
  return PHASE_BY_STATE[state];
}

export interface StateInfo {
  id: TaskState;
  /** Board column header. */
  label: string;
  /** One plain-English line for the column header and the state chip. */
  definition: string;
  /** How resolveTask decides the state, in git terms; the tooltip on the state-machine strip. */
  rule: string;
}

export interface StateTransition {
  from: TaskState;
  to: TaskState;
  /** What has to happen in the repo for the state to move. */
  trigger: string;
  /** Who usually makes it happen. */
  who: string;
}

export interface StateMachine {
  states: StateInfo[];
  transitions: StateTransition[];
}

/**
 * The task lifecycle as data. It mirrors resolveTask below: every state and every arrow here
 * corresponds to a branch of that derivation, so the board can draw the machine and explain
 * each column without a second source of truth.
 */
export const STATE_MACHINE: StateMachine = {
  states: [
    {
      id: "ungroomed",
      label: "Ungroomed",
      definition: "Captured but not yet shaped: nothing says what it is beyond the line someone wrote, or the scaffold triage left behind.",
      rule: "an intake item or a .reggie/tasks/<slug>/ folder exists, with no plan and no task/<slug> branch, and either no brief.md on disk or on the default branch or one that is still triage's unfilled scaffold",
    },
    {
      id: "groomed",
      label: "Groomed",
      definition: "Shaped by a session: somebody has written into the brief, so the item says what it is. No plan that passes the contract yet.",
      rule: "brief.md exists on disk or on the default branch with its Problem and its placeholder hints written over, and no plan passes the contract; a plan draft that fails the contract, or a plan/<slug> branch, also lands here",
    },
    {
      id: "planned",
      label: "Planned",
      definition: "Fully groomed: a plan that passes the contract, written against the code. Ready to build.",
      rule: ".reggie/tasks/<slug>/plan.md passes the plan contract and is on the default branch; in solo mode a passing plan on disk counts",
    },
    {
      id: "in-process",
      label: "In process",
      definition: "Someone holds a task/<slug> branch and is committing work on it.",
      rule: "a task/<slug> branch exists with no packet and no open pull request; or the packet on the branch carries a needs-work verdict",
    },
    {
      id: "awaiting-decision",
      label: "Awaiting decision",
      definition: "A pull request is open or a completion packet sits on the branch, waiting for a verdict.",
      rule: "a pull request for task/<slug> is open; or packet.md exists on the task branch (or on disk) without a needs-work verdict",
    },
    {
      id: "done",
      label: "Done",
      definition: "The pull request was merged, or the packet was approved on the default branch.",
      rule: "the pull request for task/<slug> is merged; or .reggie/tasks/<slug>/packet.md has verdict: approved on the default branch \u2014 committed there, or in the working tree while that branch is checked out",
    },
  ],
  transitions: [
    {
      from: "ungroomed",
      to: "groomed",
      trigger: "somebody fills in .reggie/tasks/<slug>/brief.md: why now, the suspected area, the open questions and what this is not. `reggie triage <slug>` only scaffolds it, and takes the intake line as it does, so the card stays here until the scaffold is written over",
      who: "a shaping session; triage scaffolds a whole column at once, but each brief still has to be written",
    },
    {
      from: "groomed",
      to: "planned",
      trigger: "a plan.md that passes the plan contract lands on the default branch (reggie plan new <slug>, then reggie plan lint <slug>); in solo mode a passing plan on disk is enough",
      who: "the planner, after reading the code the brief points at",
    },
    {
      from: "planned",
      to: "in-process",
      trigger: "reggie claim <slug> creates the task/<slug> branch with a claim record",
      who: "the person taking the task",
    },
    {
      from: "in-process",
      to: "awaiting-decision",
      trigger: "reggie packet <slug> commits packet.md on the branch, or a pull request is opened for it",
      who: "the task owner",
    },
    {
      from: "awaiting-decision",
      to: "done",
      trigger: "the pull request is merged, or reggie decide <slug> approved lands on the default branch",
      who: "a decider: any maintainer in team mode, the author in solo mode",
    },
    {
      from: "awaiting-decision",
      to: "in-process",
      trigger: "reggie decide <slug> needs-work records the verdict in the packet; the owner goes back to the branch",
      who: "a decider",
    },
  ],
};

/** The one-line definition of a state, for column headers and state chips. */
export function stateDefinition(state: TaskState): string {
  return STATE_MACHINE.states.find((s) => s.id === state)?.definition ?? "";
}

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
  /** The session id the launcher minted, or the name the session gave itself; "" in older claims. */
  session: string;
  tool: string;
  date: string;
}

/** What a card shows from the brief. Null on TaskInfo when no brief has been written for the slug. */
export interface TaskBriefInfo {
  /** The brief is on disk or on the default branch, the two places that count towards `groomed`. */
  exists: boolean;
  /** The `area` front matter field: a repo-relative directory, or "" when triage named none. */
  area: string;
  /** small | medium | large, or "unset". */
  size: string;
  /** P1 | P2 | P3, or "unset". */
  priority: string;
  /** The first paragraph of ## Problem, trimmed; "" while the scaffold placeholder is still there. */
  problem: string;
}

/** What a card shows for a task that came from the repo's own TASKS.md or HISTORY.md. */
export interface TaskLegacyInfo {
  /** Which file the line is in, repo-relative, and the line number, so the UI can cite it. */
  file: string;
  line: number;
  source: "tasks" | "history";
  /** Heading trail above the line, outermost first. */
  section: string[];
  /** The `>` note introducing that section, when it had one. */
  initiative: string | null;
  /** The author tagged it [parked]: shaped, but deliberately not being worked on. */
  parked: boolean;
  /** [code], [manual], [content] and friends. */
  kinds: string[];
  depends: string[];
  conflicts: string[];
  tier: string | null;
  /** The whole description, tags removed. */
  description: string;
  /** A plan document from the old pipeline folder, when one exists for this slug. */
  planFile: string | null;
  /** That plan folder is not in git, so only this machine has it. */
  planUntracked: boolean;
  completedAt: string | null;
}

export interface TaskInfo {
  slug: string;
  title: string;
  state: TaskState;
  /** One-line definition of the state, from STATE_MACHINE. */
  stateDefinition: string;
  /** The coarse grouping of the state, for the tasks page columns. */
  phase: TaskPhase;
  risk: Risk | "unset";
  owner: string | null;
  ownerEmail: string | null;
  lastActivity: string | null;
  /** Whole days since lastActivity, else since the intake line's date, else since the brief's `created`; null when none is known. */
  age: number | null;
  branch: string | null;
  pr: PullRequest | null;
  /** The brief triage wrote, when there is one. */
  brief: TaskBriefInfo | null;
  planExists: boolean;
  planOnDefault: boolean;
  planLintOk: boolean | null;
  packetExists: boolean;
  intake: IntakeItem | null;
  /** Set when the task came from the repo's own backlog file rather than from `.reggie/`. */
  legacy: TaskLegacyInfo | null;
  reason: string;
  /** Paths from the plan's "Files to touch"; folder entries keep their trailing slash. */
  planFiles: string[];
  /** Files changed on the task branch against the integration branch. Reggie's own .reggie/ records are excluded. */
  changedFiles: string[];
}

const DAY_MS = 86_400_000;

/** Whole days between an ISO date (or YYYY-MM-DD) and now; never negative; null when unparseable. */
export function ageInDays(from: string | null | undefined, now: Date = new Date()): number | null {
  if (!from) return null;
  const t = Date.parse(from);
  if (!Number.isFinite(t)) return null;
  return Math.max(0, Math.floor((now.getTime() - t) / DAY_MS));
}

/** The YYYY-MM-DD inside an intake item's "(person, source, date)" group, when present. */
export function intakeDate(item: IntakeItem | null): string | null {
  const m = item?.meta ? /\b(\d{4}-\d{2}-\d{2})\b/.exec(item.meta) : null;
  return m?.[1] ?? null;
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
  return { person: get("person"), email: get("email"), machine: get("machine"), tool: get("tool"), session: get("session"), date: get("date") };
}

export interface TaskListOptions {
  includeDone?: boolean;
}

interface Snapshot {
  base: string;
  /** The branch the working tree is on, so an uncommitted decision can be read as "on base". */
  checkedOut: string;
  mode: Mode;
  now: Date;
  onBase: Set<string>;
  intake: IntakeItem[];
  taskBranches: BranchInfo[];
  planBranches: BranchInfo[];
  /** The backlog the repo already kept, in TASKS.md / HISTORY.md and an old plan folder. */
  legacy: LegacyBacklog;
}

function snapshot(paths: RepoPaths, config: ReggieConfig): Snapshot {
  const base = defaultBranch(paths.root, config.defaultBranch);
  const legacy = markUntrackedPlans(paths.root, readLegacy(paths, config.legacy));
  return {
    base,
    checkedOut: currentBranch(paths.root),
    mode: config.mode,
    now: new Date(),
    onBase: treePaths(paths.root, base, TASKS_REL_DIR),
    intake: readIntake(paths),
    taskBranches: listBranches(paths.root, "task/"),
    planBranches: listBranches(paths.root, "plan/"),
    legacy,
  };
}

/**
 * Which of the old pipeline's plan documents git actually has.
 *
 * This is not `git check-ignore` on the folder: a folder holding one tracked `.gitkeep` is not
 * ignored, while every plan inside it still is. It is per file, from one `ls-files` over the
 * folder, because the claim the UI makes with it — "your teammates can read this plan" — is only
 * true of a file git is carrying.
 */
function markUntrackedPlans(root: string, legacy: LegacyBacklog): LegacyBacklog {
  if (!legacy.planDir || legacy.plans.size === 0) return legacy;
  const r = git(["ls-files", "-z", "--", legacy.planDir], { cwd: root, allowFailure: true });
  const tracked = new Set(r.stdout.split("\0").filter(Boolean));
  let anyUntracked = false;
  for (const plan of legacy.plans.values()) {
    plan.untracked = !tracked.has(plan.file);
    if (plan.untracked) anyUntracked = true;
  }
  return { ...legacy, planDirUntracked: anyUntracked };
}

function allSlugs(paths: RepoPaths, snap: Snapshot): string[] {
  const slugs = new Set<string>();
  for (const i of snap.intake) slugs.add(i.slug);
  for (const d of taskDirs(paths)) slugs.add(d);
  for (const b of snap.taskBranches) slugs.add(b.name.slice("task/".length));
  for (const b of snap.planBranches) slugs.add(b.name.slice("plan/".length));
  for (const p of snap.onBase) {
    const m = /^\.reggie\/tasks\/([a-z0-9][a-z0-9-]*)\//.exec(p);
    if (m?.[1]) slugs.add(m[1]);
  }
  for (const slug of snap.legacy.items.keys()) slugs.add(slug);
  return Array.from(slugs).sort();
}

const STATE_ORDER: Record<TaskState, number> = { "awaiting-decision": 0, "in-process": 1, planned: 2, groomed: 3, ungroomed: 4, done: 5 };

function collectTasks(paths: RepoPaths, snap: Snapshot, opts: TaskListOptions): TaskInfo[] {
  const tasks: TaskInfo[] = [];
  for (const slug of allSlugs(paths, snap)) {
    const info = resolveTask(paths, slug, snap).info;
    if (!opts.includeDone && info.state === "done") continue;
    tasks.push(info);
  }
  tasks.sort((a, b) => STATE_ORDER[a.state] - STATE_ORDER[b.state] || a.slug.localeCompare(b.slug));
  return tasks;
}

/** Derive every task and its state from intake, task directories, branches, and pull requests. */
export function listTasks(paths: RepoPaths, config: ReggieConfig, opts: TaskListOptions = {}): TaskInfo[] {
  return collectTasks(paths, snapshot(paths, config), opts);
}

export function getTask(paths: RepoPaths, config: ReggieConfig, slug: string): TaskInfo {
  if (!isSafeSlug(slug)) throw new Error(`"${slug}" is not a valid slug.`);
  return resolveTask(paths, slug, snapshot(paths, config)).info;
}

function refFor(branch: BranchInfo): string {
  return branch.remote ? `origin/${branch.name}` : branch.name;
}

/** The first branch, in order, that has the file. */
function firstAtRef(root: string, branches: (BranchInfo | null)[], file: string): string | null {
  for (const b of branches) {
    if (!b) continue;
    const content = fileAtRef(root, refFor(b), file);
    if (content !== null) return content;
  }
  return null;
}

/** Files changed on a work branch against the integration branch, without Reggie's own records. */
function branchChangedFiles(root: string, base: string, ref: string): string[] {
  const r = git(["diff", "--name-only", `${base}...${ref}`], { cwd: root, allowFailure: true });
  return r.stdout
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l !== "" && !l.startsWith(`${REGGIE_DIR}/`));
}

function normalizePlanPath(p: string): string {
  return p.replace(/\\/g, "/").replace(/^\.\/+/, "").trim();
}

interface ResolvedTask {
  info: TaskInfo;
  branch: BranchInfo | null;
  /** The brief text: disk, else the default branch. */
  briefContent: string | null;
  /** The plan text: disk, else the default branch, else the task or plan branch. */
  planContent: string | null;
  /** The packet text: disk, else the task branch, else the default branch. */
  packetContent: string | null;
  claim: ClaimInfo | null;
  /** Whether anything on disk or in git names this slug. */
  known: boolean;
}

/** The directory a legacy item's files agree on, deepest common prefix, "" when they do not. */
function legacyArea(files: { path: string }[]): string {
  const dirs = uniq(files.map((f) => f.path.replace(/\/[^/]*$/, "")).filter((d) => d && !d.includes("*")));
  if (dirs.length === 0) return "";
  const parts = dirs.map((d) => d.split("/"));
  const first = parts[0] ?? [];
  const common: string[] = [];
  for (let i = 0; i < first.length; i += 1) {
    const seg = first[i];
    if (seg === undefined || !parts.every((p) => p[i] === seg)) break;
    common.push(seg);
  }
  return common.length ? `${common.join("/")}/` : "";
}

function resolveTask(paths: RepoPaths, slug: string, snap: Snapshot): ResolvedTask {
  const root = paths.root;
  const intake = snap.intake.find((i) => i.slug === slug) ?? null;
  const legacyItem = snap.legacy.items.get(slug) ?? null;
  const legacyPlan = snap.legacy.plans.get(slug) ?? null;
  const branch = snap.taskBranches.find((b) => b.name === `task/${slug}`) ?? null;
  const planBranch = snap.planBranches.find((b) => b.name === `plan/${slug}`) ?? null;

  // The brief only counts where the spec says it counts: on disk, or on the default branch. Its
  // presence there is already in snap.onBase, from the ls-tree pass that finds plans and packets,
  // so a task without a brief costs no git call at all.
  const briefLocal = readText(briefFile(paths, slug));
  const briefOnDefault = snap.onBase.has(briefRelPath(slug));
  const briefDefault = briefLocal === null && briefOnDefault ? fileAtRef(root, snap.base, briefRelPath(slug)) : null;
  const briefContent = briefLocal ?? briefDefault;
  const parsedBrief = briefContent ? parseBrief(briefContent) : null;
  const hasBrief = briefLocal !== null || briefOnDefault;

  const planLocal = readText(planFile(paths, slug));
  const planOnDefault = snap.onBase.has(planRelPath(slug));
  const planDefault = planLocal === null && planOnDefault ? fileAtRef(root, snap.base, planRelPath(slug)) : null;
  const planOnWork = planLocal === null && planDefault === null ? firstAtRef(root, [branch, planBranch], planRelPath(slug)) : null;
  const packetDefault = snap.onBase.has(packetRelPath(slug)) ? fileAtRef(root, snap.base, packetRelPath(slug)) : null;
  const packetLocal = readText(packetFile(paths, slug));
  const packetOnBranch = branch && !packetLocal ? fileAtRef(root, refFor(branch), packetRelPath(slug)) : null;
  const claimContent = branch ? fileAtRef(root, refFor(branch), claimRelPath(slug)) : null;
  const claim = claimContent ? parseClaim(claimContent) : null;
  const pr = branch ? pullRequestForBranch(root, branch.name) : null;

  const planContent = planLocal ?? planDefault ?? planOnWork;
  const parsed = planContent ? parsePlan(planContent) : null;
  const title = parsed?.meta.title || parsedBrief?.meta.title || intake?.text || legacyItem?.title || slug;
  // The plan settles the risk; until there is one, the brief's guess is what a card can show.
  const risk: Risk | "unset" = parsed?.meta.risk ?? parsedBrief?.meta.risk ?? "unset";
  const planLintOk = planContent ? lintPlan(planContent).ok : null;

  let state: TaskState;
  let reason: string;
  const verdictDefault = packetDefault ? parsePacketVerdict(packetDefault) : null;
  const packetBranch = packetLocal ?? packetOnBranch;
  const verdictBranch = packetBranch ? parsePacketVerdict(packetBranch) : null;
  if (pr?.state === "MERGED") {
    state = "done";
    reason = `PR #${pr.number} merged`;
  } else if (verdictDefault === "approved") {
    state = "done";
    reason = `packet approved on ${snap.base}`;
  } else if (pr?.state === "OPEN") {
    state = "awaiting-decision";
    reason = `PR #${pr.number} open`;
  } else if (snap.checkedOut === snap.base && packetLocal && parsePacketVerdict(packetLocal) === "approved") {
    // The working tree *is* the integration branch here, so an approval recorded there (the web
    // UI's Approve button) counts even before it is committed.
    state = "done";
    reason = `packet approved on ${snap.base} (not committed yet)`;
  } else if (branch && packetBranch && verdictBranch === "needs-work") {
    state = "in-process";
    reason = `packet on ${branch.name} marked needs-work; back with the owner`;
  } else if (branch && packetBranch) {
    state = "awaiting-decision";
    reason = `packet exists on ${branch.name}`;
  } else if (branch) {
    const ahead = aheadCount(root, refFor(branch), snap.base);
    state = "in-process";
    reason = `${branch.name} has ${ahead} commit${ahead === 1 ? "" : "s"} ahead of ${snap.base}`;
  } else if (legacyItem?.done) {
    // The author ticked it off in the repo's own backlog. Nothing in git contradicts that here —
    // every branch, packet and pull request check above has already had its turn.
    state = "done";
    reason = legacyItem.completedAt
      ? `ticked off in ${legacyItem.file} on ${legacyItem.completedAt}`
      : `ticked off in ${legacyItem.file}:${legacyItem.line}`;
  } else if (planOnDefault && planLintOk) {
    state = "planned";
    reason = `plan on ${snap.base} passes the contract`;
  } else if (planOnDefault) {
    state = "groomed";
    reason = `plan draft on ${snap.base} does not pass the contract yet; a plan is in progress`;
  } else if (planBranch) {
    state = "groomed";
    reason = `${planBranch.name} exists; a plan is in progress`;
  } else if (planLocal) {
    if (planLintOk && snap.mode === "solo") {
      state = "planned";
      reason = "plan on disk passes the contract; solo mode counts it as planned until committed";
    } else {
      state = "groomed";
      reason = planLintOk
        ? "plan draft on disk passes the contract; team mode needs it merged or on a plan/ branch, so a plan is still in progress"
        : "plan draft on disk does not pass the contract yet; a plan is in progress";
    }
  } else if (hasBrief) {
    // A brief and nothing else: triage has shaped it, planning has not started — unless nobody has
    // written into the scaffold triage left, in which case the item is still as unshaped as the
    // intake line it replaced, and says so rather than counting as work that is done.
    const draft = briefDraft(briefContent ?? "");
    const where = briefLocal !== null ? "disk" : snap.base;
    state = draft.draft ? "ungroomed" : "groomed";
    reason = draft.draft ? `brief on ${where} is ${draft.reason}` : `brief on ${where}; no plan yet`;
  } else if (legacyItem && legacyItem.planned && legacyPlan) {
    // The backlog says planned *and* the plan document is really there. The tag alone is not
    // enough: a folder of plans can outlive the decision to build any of them.
    state = "planned";
    reason = `${legacyItem.file} marks it planned and ${legacyPlan.file} exists`;
  } else if (legacyItem && !legacyItem.ungroomed) {
    // Shaped by hand: it sits under a real heading with a priority, a size, or a file list.
    state = "groomed";
    const shaped = [legacyItem.priority !== "unset" ? "a priority" : null, legacyItem.size !== "unset" ? "a size" : null, legacyItem.files.length ? "a file list" : null].filter(
      Boolean,
    );
    const where = legacyItem.section.length ? ` under ${legacyItem.section[legacyItem.section.length - 1]}` : "";
    reason = shaped.length ? `${legacyItem.file} gives it ${shaped.join(" and ")}${where}` : `listed in ${legacyItem.file}${where}`;
  } else if (legacyItem) {
    state = "ungroomed";
    reason = `${legacyItem.file}:${legacyItem.line}, still under ${legacyItem.section[legacyItem.section.length - 1] ?? "Ungroomed"}`;
  } else {
    state = "ungroomed";
    reason = intake ? "intake item with no brief" : "task directory with no brief";
  }

  const owner = claim?.person || branch?.author || planBranch?.author || parsed?.meta.author || parsedBrief?.meta.author || null;
  const ownerEmail = claim?.email || branch?.email || planBranch?.email || null;
  const lastActivity = branch?.date || planBranch?.date || (planLocal ? lastCommitDate(root, planRelPath(slug)) : null) || legacyItem?.completedAt || null;
  // Once triage takes the intake line, the brief's own `created` is the only date a card with no
  // branch has left; without it a whole column would read "no recorded activity".
  const age = ageInDays(lastActivity, snap.now) ?? ageInDays(intakeDate(intake), snap.now) ?? ageInDays(parsedBrief?.meta.created, snap.now);
  const planFiles = parsed ? uniq(parsed.files.map(normalizePlanPath).filter(Boolean)) : [];
  const changedFiles = branch ? branchChangedFiles(root, snap.base, refFor(branch)) : [];

  // A legacy line carries the same three facts a brief does — priority, size, roughly where —
  // so it fills the same shape and the card renders identically. `exists` stays false: there is
  // no brief.md, and the "brief" badge must keep meaning that a brief was written.
  const brief: TaskBriefInfo | null = parsedBrief
    ? {
        exists: hasBrief,
        area: parsedBrief.meta.area,
        size: parsedBrief.meta.size,
        priority: parsedBrief.meta.priority,
        problem: parsedBrief.problem,
      }
    : legacyItem
      ? {
          exists: false,
          area: legacyArea(legacyItem.files),
          size: legacyItem.size,
          priority: legacyItem.priority,
          problem: legacyItem.description,
        }
      : null;

  const legacy: TaskLegacyInfo | null = legacyItem
    ? {
        file: legacyItem.file,
        line: legacyItem.line,
        source: legacyItem.source,
        section: legacyItem.section,
        initiative: legacyItem.initiative,
        parked: legacyItem.parked,
        kinds: legacyItem.kinds,
        depends: legacyItem.depends,
        conflicts: legacyItem.conflicts,
        tier: legacyItem.tier,
        description: legacyItem.description,
        planFile: legacyPlan?.file ?? null,
        planUntracked: legacyPlan?.untracked ?? false,
        completedAt: legacyItem.completedAt,
      }
    : null;

  const info: TaskInfo = {
    slug,
    title,
    state,
    stateDefinition: stateDefinition(state),
    phase: taskPhase(state),
    risk,
    owner,
    ownerEmail,
    lastActivity,
    age,
    branch: branch?.name ?? planBranch?.name ?? null,
    pr,
    brief,
    planExists: Boolean(planLocal || planOnDefault),
    planOnDefault,
    planLintOk,
    packetExists: Boolean(packetLocal || packetOnBranch || packetDefault),
    intake,
    legacy,
    reason,
    planFiles: planFiles.length ? planFiles : uniq(legacyItem?.files.map((f) => f.path) ?? []),
    changedFiles,
  };

  const onBasePrefix = `${TASKS_REL_DIR}/${slug}/`;
  const known =
    intake !== null ||
    branch !== null ||
    planBranch !== null ||
    legacyItem !== null ||
    existsSync(path.join(paths.tasks, slug)) ||
    Array.from(snap.onBase).some((p) => p.startsWith(onBasePrefix));

  return {
    info,
    branch,
    briefContent,
    // With no plan of its own, a legacy task can still show the plan the old pipeline wrote.
    planContent: planContent ?? legacyPlan?.content ?? null,
    packetContent: packetLocal ?? packetOnBranch ?? packetDefault,
    claim,
    known,
  };
}

export function renderTaskLine(t: TaskInfo): string {
  const who = t.owner ? ` · ${t.owner}` : "";
  const when = t.lastActivity ? ` · ${t.lastActivity.slice(0, 10)}` : "";
  const risk = t.risk !== "unset" ? ` [${t.risk}]` : "";
  return `${t.state.padEnd(17)} ${t.slug}${risk}${who}${when}  — ${t.title}${t.reason ? ` (${t.reason})` : ""}`;
}

// ---------------------------------------------------------------------------
// Task detail (GET /api/task/<slug>)
// ---------------------------------------------------------------------------

export type PlanFileOp = "NEW" | "MOD" | "DEL";

export interface PlanFileRef {
  path: string;
  /** From the "(NEW)" / "(MOD)" / "(DEL)" suffix on the plan line; null when the line had none. */
  op: PlanFileOp | null;
  /** Present in the working tree, or on the task branch when the tree does not have it. */
  exists: boolean;
  /** Graph node id: the path for files, `dir:<path>/` for folder entries. */
  nodeId: string;
}

export interface TaskBriefDetail {
  meta: BriefMeta;
  /** Every `## ` section of the brief body, by heading. */
  sections: Record<string, string>;
  /** The ## Suspected area bullets. */
  areas: string[];
  /** The ## Open questions bullets. */
  questions: string[];
}

export interface TaskPlanDetail {
  meta: PlanMeta;
  /** Every `## ` section of the plan body, by heading. */
  sections: Record<string, string>;
  criteria: string[];
  files: PlanFileRef[];
}

export interface PacketCriterion {
  text: string;
  /** true when the packet checkbox is ticked, false when it is empty, null when the line has no checkbox. */
  pass: boolean | null;
  /** Repo-relative evidence paths named on the `evidence:` line under the criterion. */
  evidence: string[];
}

export interface TaskPacketDetail {
  verdict: Verdict | null;
  decidedBy: string | null;
  decidedAt: string | null;
  criteria: PacketCriterion[];
  /** Every `## ` section of the packet body, by heading. */
  sections: Record<string, string>;
  /** Files under .reggie/tasks/<slug>/evidence/, on disk or on the task branch. */
  evidence: string[];
}

export interface TaskCollision {
  file: string;
  slug: string;
  owner: string | null;
}

export interface RiskRuleHit {
  level: "high" | "medium";
  pattern: string;
  file: string;
}

export interface TaskImpact {
  /** Files the plan names. */
  planned: string[];
  /** Files changed on the task branch against the integration branch. */
  actual: string[];
  plannedButUntouched: string[];
  touchedButUnplanned: string[];
  /** Importers reached from planned ∪ actual; filled by the views layer, empty here. */
  downstream: { id: string; hop: number }[];
  /** Other active tasks whose planned or changed files overlap this task's. */
  collisions: TaskCollision[];
  /** Which config.risk patterns matched which planned or changed file. */
  riskRules: RiskRuleHit[];
}

export interface TaskDetail {
  task: TaskInfo;
  brief: TaskBriefDetail | null;
  plan: TaskPlanDetail | null;
  /**
   * Which kind of document `plan` was parsed from. "legacy" means a plan the old pipeline wrote:
   * readable, but never written against the plan contract, so its front matter is empty and its
   * headings are whatever that pipeline used. The UI has to say so rather than show it as a plan
   * that passed a lint it was never given.
   */
  planSource: "reggie" | "legacy" | null;
  packet: TaskPacketDetail | null;
  claim: ClaimInfo | null;
  journal: JournalEntry[];
  impact: TaskImpact;
  /** Where the context pack for this task can be fetched. */
  contextRoute: string;
}

/** The journal is read this far back for a task page: every entry ever written for the slug. */
const JOURNAL_WINDOW_DAYS = 3650;

const FILE_OP_RE = /\s*\((NEW|MOD|DEL)\)\s*$/i;

function isPlaceholderText(text: string): boolean {
  return /^\(.*\)$/.test(text.trim());
}

/** The "Files to touch" bullets with their NEW/MOD/DEL operation; the same lines parsePlan keeps as `files`. */
export function parsePlanFileEntries(section: string): { path: string; op: PlanFileOp | null }[] {
  const out: { path: string; op: PlanFileOp | null }[] = [];
  for (const raw of section.split("\n")) {
    const line = raw.trim();
    if (!/^-\s+\S/.test(line)) continue;
    const body = line.replace(/^-\s+(\[[ xX]\]\s+)?/, "").trim();
    if (isPlaceholderText(body)) continue;
    const m = FILE_OP_RE.exec(body);
    const op = m?.[1] ? (m[1].toUpperCase() as PlanFileOp) : null;
    const p = normalizePlanPath(body.replace(FILE_OP_RE, "").replace(/^`|`$/g, "").trim());
    if (!p) continue;
    out.push({ path: p, op });
  }
  return out;
}

/** A path that stays inside the repo: relative, no `..` segments. */
function isInsideRepo(p: string): boolean {
  return !path.isAbsolute(p) && !p.split("/").includes("..");
}

function planFileRef(root: string, entry: { path: string; op: PlanFileOp | null }, branch: BranchInfo | null): PlanFileRef {
  const p = entry.path;
  const safe = isInsideRepo(p);
  const full = path.join(root, p);
  const onDisk = safe && existsSync(full);
  const isDir = p.endsWith("/") || (onDisk && statSync(full).isDirectory());
  const bare = p.replace(/\/+$/, "");
  const nodeId = isDir ? (bare === "" || bare === "." ? "dir:./" : `dir:${bare}/`) : p;
  let exists = onDisk;
  if (!exists && safe && branch) {
    exists = isDir ? treePaths(root, refFor(branch), bare).size > 0 : fileAtRef(root, refFor(branch), p) !== null;
  }
  return { path: p, op: entry.op, exists, nodeId };
}

function briefDetail(content: string): TaskBriefDetail {
  const parsed = parseBrief(content);
  return { meta: parsed.meta, sections: Object.fromEntries(parsed.sections), areas: parsed.areas, questions: parsed.questions };
}

function planDetail(root: string, content: string, branch: BranchInfo | null): TaskPlanDetail {
  const parsed = parsePlan(content);
  const entries = parsePlanFileEntries(parsed.sections.get("Files to touch") ?? "");
  return {
    meta: parsed.meta,
    sections: Object.fromEntries(parsed.sections),
    criteria: parsed.criteria,
    files: entries.map((e) => planFileRef(root, e, branch)),
  };
}

/** `## ` sections of a Markdown body, by heading, in order. */
function parseSections(body: string): Record<string, string> {
  const out: Record<string, string> = {};
  let current: string | null = null;
  const buffer: string[] = [];
  const flush = () => {
    if (current !== null) out[current] = buffer.join("\n").trim();
    buffer.length = 0;
  };
  for (const line of body.split("\n")) {
    const h = /^##\s+(.+?)\s*$/.exec(line);
    if (h) {
      flush();
      current = (h[1] ?? "").trim();
      continue;
    }
    if (current !== null) buffer.push(line);
  }
  flush();
  return out;
}

/** Paths named on an `evidence:` line; the scaffold's "(path to the file that proves this)" hint is not a path. */
function parseEvidenceRefs(value: string): string[] {
  return value
    .trim()
    .replace(/^\((.*)\)$/, "$1")
    .split(",")
    .map((s) => s.trim().replace(/^`|`$/g, ""))
    .filter((s) => s !== "" && !/\s/.test(s) && (s.includes("/") || /\.\w+$/.test(s)));
}

/** The packet's acceptance checklist: ticked → pass, empty box → fail, plain bullet → unknown. */
export function parsePacketCriteria(section: string): PacketCriterion[] {
  const out: PacketCriterion[] = [];
  for (const raw of section.split("\n")) {
    const line = raw.trim();
    const box = /^-\s+\[([ xX])\]\s+(.+)$/.exec(line);
    if (box) {
      const text = (box[2] ?? "").trim();
      if (!isPlaceholderText(text)) out.push({ text, pass: box[1] !== " ", evidence: [] });
      continue;
    }
    const bullet = /^-\s+(\S.*)$/.exec(line);
    if (bullet) {
      const text = (bullet[1] ?? "").trim();
      if (!isPlaceholderText(text)) out.push({ text, pass: null, evidence: [] });
      continue;
    }
    const ev = /^evidence:\s*(.*)$/i.exec(line);
    const last = out[out.length - 1];
    if (ev && last) last.evidence.push(...parseEvidenceRefs(ev[1] ?? ""));
  }
  return out;
}

function frontMatterField(front: string | null, key: string): string | null {
  if (!front) return null;
  // Horizontal whitespace only: an empty "decided_by:" line must not swallow the next line.
  const m = new RegExp(`^${key}:[ \\t]*(.*)$`, "m").exec(front);
  const value = m?.[1]?.trim() ?? "";
  return value || null;
}

function packetDetail(paths: RepoPaths, slug: string, content: string, branch: BranchInfo | null): TaskPacketDetail {
  const { front, body } = splitFrontMatter(content);
  const sections = parseSections(body);
  const onBranch = branch ? Array.from(treePaths(paths.root, refFor(branch), `${TASKS_REL_DIR}/${slug}/evidence`)) : [];
  const evidence = uniq([...listEvidence(paths, slug), ...onBranch]).sort();
  return {
    verdict: parsePacketVerdict(content),
    decidedBy: frontMatterField(front, "decided_by"),
    decidedAt: frontMatterField(front, "decided_at"),
    criteria: parsePacketCriteria(sections["Acceptance criteria"] ?? ""),
    sections,
    evidence,
  };
}

/** Whether a plan entry (file or folder with a trailing slash) covers a path. */
function covers(entry: string, file: string): boolean {
  return entry === file || (entry.endsWith("/") && file.startsWith(entry));
}

function computeImpact(info: TaskInfo, others: TaskInfo[], rules: RiskRules): TaskImpact {
  const planned = uniq(info.planFiles);
  const actual = uniq(info.changedFiles);
  const plannedButUntouched = planned.filter((p) => !actual.some((a) => covers(p, a)));
  const touchedButUnplanned = actual.filter((a) => !planned.some((p) => covers(p, a)));
  const mine = uniq([...planned, ...actual]);

  const collisions: TaskCollision[] = [];
  for (const other of others) {
    const theirs = uniq([...other.planFiles, ...other.changedFiles]);
    for (const file of mine) {
      if (theirs.some((t) => covers(t, file) || covers(file, t))) collisions.push({ file, slug: other.slug, owner: other.owner });
    }
  }

  const riskRules: RiskRuleHit[] = [];
  for (const level of ["high", "medium"] as const) {
    for (const pattern of rules[level]) {
      const needle = pattern.toLowerCase();
      if (!needle) continue;
      for (const file of mine) {
        if (file.toLowerCase().includes(needle)) riskRules.push({ level, pattern, file });
      }
    }
  }

  return { planned, actual, plannedButUntouched, touchedButUnplanned, downstream: [], collisions, riskRules };
}

/**
 * Everything the task page shows: the derived task, the parsed plan and packet, the claim on the
 * branch, the journal for the slug, and the blast-radius inputs. Returns null when nothing in the
 * repo names the slug (a 404); throws on an unsafe slug (a 400).
 */
export function getTaskDetail(paths: RepoPaths, config: ReggieConfig, slug: string): TaskDetail | null {
  if (!isSafeSlug(slug)) throw new Error(`"${slug}" is not a valid slug.`);
  const snap = snapshot(paths, config);
  const resolved = resolveTask(paths, slug, snap);
  if (!resolved.known) return null;

  const brief = resolved.briefContent ? briefDetail(resolved.briefContent) : null;
  const plan = resolved.planContent ? planDetail(paths.root, resolved.planContent, resolved.branch) : null;
  const packet = resolved.packetContent ? packetDetail(paths, slug, resolved.packetContent, resolved.branch) : null;
  const journal = readJournal(paths, { slug, days: JOURNAL_WINDOW_DAYS });
  const others = collectTasks(paths, snap, {}).filter((t) => t.slug !== slug);
  const impact = computeImpact(resolved.info, others, config.risk);

  return {
    task: resolved.info,
    brief,
    plan,
    planSource: plan ? (resolved.info.planExists || resolved.info.planOnDefault || resolved.info.planLintOk !== null ? "reggie" : "legacy") : null,
    packet,
    claim: resolved.claim,
    journal,
    impact,
    contextRoute: `/api/context?slug=${encodeURIComponent(slug)}`,
  };
}
