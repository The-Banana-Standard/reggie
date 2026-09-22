import { realpathSync } from "node:fs";
import path from "node:path";
import { cleanLine, latestRecords, readChecks, type BadCheckLine, type CheckOutcome, type CheckRecord } from "./checks.js";
import {
  blobAt,
  blobSize,
  blobText,
  changedPathsNoRenames,
  defaultBranch,
  fileAtCommit,
  isAncestor,
  isWorkBranch,
  listWorktrees,
  mergeBase,
  mergeTreeCheck,
  resolveCommit,
  type GitRunner,
} from "./git.js";
import { lintPacket, packetCitations, parsePacketVerdict, renderChecklist, resolveEvidence, type EvidenceFault } from "./packet.js";
import { checksRelPath, packetRelPath, planRelPath, REGGIE_DIR, repoPaths, taskRelDir, TASKS_REL_DIR } from "./paths.js";
import { loadConfig, parseConfig, type Mode, type PolicyClass, type PolicyKeySource, type ReggieConfig } from "./people.js";
import { lintPlan, parsePlan, planCriteria, riskFromFiles, type ParsedPlan, type PlanCriterion, type Risk } from "./plan.js";
import { splitFrontMatter } from "./util.js";

/*
 * The policy's verdict on a finished task, as a report. Nothing here decides, merges or writes: in
 * this version a person decides every task, and this says what the policy would have said.
 *
 * The evaluation is a function of two commits, each resolved once to a full id and never named
 * again: the tip of the integration branch and the tip of `task/<slug>`. It reads no working tree,
 * so it answers the same from the integration checkout and from the task's own worktree, whatever
 * is uncommitted in either.
 *
 *   From the base commit: `.reggie/config.yaml` (the mode, the `policy` block, the risk rules) and
 *   the task's `plan.md` (the criteria, the `risk` line, the file list). These are what the task is
 *   judged by, so they are read from the one copy the branch could not have edited.
 *
 *   From the branch tip: `packet.md`, `checks.jsonl`, the evidence files and the list of changed
 *   files. These are the session's claims, believed no further than they can be verified.
 *
 * The one thing taken from a disk is the integration branch's name, from the integration checkout's
 * config and never from a task worktree's, because a name has to come from somewhere before there
 * is a commit to read.
 */

export type PolicyVerdict = "would-pass" | "refused" | "not-evaluated";
export type GateId = "policy" | "plan" | "controls" | "packet" | "criteria" | "evidence" | "risk" | "merge";
export type GateStatus = "pass" | "fail" | "not-checked";
export type CriterionStatus = "pass" | "fail" | "missing" | "stale" | "no-evidence";

export interface PolicyGate {
  id: GateId;
  /** What the gate asks, in a few words. */
  title: string;
  status: GateStatus;
  /** Why it failed or was not checked, one sentence each; for a pass, what was found. */
  reasons: string[];
}

/** A check record as the report shows it: every value cleaned to one line, because a record is a file anyone on the branch can write. */
export interface ReportRecord {
  outcome: CheckOutcome;
  person: string;
  tool: string;
  session: string;
  at: string;
  head: string;
  evidence: string[];
  note: string;
}

export interface ReportCriterion {
  n: number;
  key: string;
  text: string;
  status: CriterionStatus;
  /** Why the status is not `pass`; null when it is. */
  why: string | null;
  record: ReportRecord | null;
}

export interface ReportReview {
  name: string;
  key: string;
  outcome: CheckOutcome;
  record: ReportRecord;
}

export interface ReportCommit {
  branch: string;
  /** The full id this evaluation read. */
  commit: string;
}

export interface ReportPolicy {
  mode: Mode;
  plans: PolicyClass;
  completions: PolicyClass;
  /** Per key: `base-commit` when the base commit's `policy` block set it, `mode-default` when it did not, `unreadable` when the block's value could not be read and the default stood in. */
  source: { plans: PolicySource; completions: PolicySource };
}
export type PolicySource = "base-commit" | "mode-default" | "unreadable";

export interface ReportRisk {
  /** The `risk:` line of the plan on the base commit. */
  plan: Risk | "unset";
  /** `riskFromFiles` over the base plan's file list. */
  planFiles: Risk;
  /** `riskFromFiles` over every path the branch changed since its merge base, outside its own task folder and the journal. */
  changed: Risk;
  /** The highest of the three, under the base commit's rules. */
  effective: Risk;
  /** How many paths `changed` was computed from. */
  changedCount: number;
  /** Changed paths the plan never named. */
  unplanned: string[];
}

export interface PolicyReport {
  slug: string;
  verdict: PolicyVerdict;
  /** One sentence: why the task was not evaluated, or what the verdict rests on. */
  summary: string;
  base: ReportCommit | null;
  task: ReportCommit | null;
  policy: ReportPolicy | null;
  risk: ReportRisk | null;
  criteria: ReportCriterion[];
  reviews: ReportReview[];
  /** Lines of the checks file that are not records. */
  badLines: BadCheckLine[];
  gates: PolicyGate[];
}

export interface EvaluateOptions {
  /** How git is run for the reads this module adds; a test passes its own to watch or fail a call. */
  runner?: GitRunner;
}

/** How many evaluations this process has run. The task list must never add to it; a test reads it to prove that. */
export const evaluationStats = { calls: 0 };

/** A checks file larger than this is not read: what is parsed on a request is bounded where it is read. */
const MAX_CHECKS_BYTES = 8 * 1024 * 1024;
const RISK_RANK: Record<Risk | "unset" | "none", number> = { none: -1, low: 0, medium: 1, high: 2, unset: 2 };
const RISK_BY_RANK: Risk[] = ["low", "medium", "high"];

/**
 * Files Reggie or the next session obeys. A branch that changes one is refused whatever else holds,
 * because reading the policy from the base protects this merge and not the next one: a person
 * decides those. The list is fixed here and takes no configuration; it is not a finer policy knob.
 */
export function controlFileReason(slug: string, file: string): string | null {
  const f = file.toLowerCase();
  const own = taskRelDir(slug).toLowerCase();
  if (f === `${own}plan.md`) return "its own plan, which is what it is judged by";
  if (f === `${REGGIE_DIR}/config.yaml`) return "the config, which holds the mode, the policy and the risk rules";
  if (f === `${REGGIE_DIR}/people.yaml`) return "the people file, which says who may decide";
  if (f.startsWith(`${TASKS_REL_DIR}/`) && !f.startsWith(own)) return "another task's folder";
  if (f === ".mcp.json") return "the MCP server settings the next session loads";
  if (f === ".gitattributes") return "the merge and diff rules git applies to this repository";
  if (f === ".claude" || f.startsWith(".claude/")) return "the session tool settings under .claude/";
  return null;
}

/**
 * The integration checkout, found by structure and not by config: a Reggie worktree is always
 * `<X>/.worktree/<slug>`, so `X` is its parent's parent, confirmed by `git worktree list` naming `X`
 * on a branch that is not a task or plan branch. Anywhere else the root is its own integration
 * checkout.
 */
export function integrationRoot(root: string): string {
  const parent = path.dirname(root);
  if (path.basename(parent) !== ".worktree") return root;
  const candidate = path.dirname(parent);
  const real = (p: string): string => {
    try {
      return realpathSync(p);
    } catch {
      return path.resolve(p);
    }
  };
  const want = real(candidate);
  const listed = listWorktrees(root).find((w) => real(w.path) === want);
  return listed && listed.branch !== null && !isWorkBranch(listed.branch) ? candidate : root;
}

function notEvaluated(slug: string, summary: string, base: ReportCommit | null = null, task: ReportCommit | null = null, policy: ReportPolicy | null = null): PolicyReport {
  return { slug, verdict: "not-evaluated", summary, base, task, policy, risk: null, criteria: [], reviews: [], badLines: [], gates: [] };
}

function reportRecord(r: CheckRecord): ReportRecord {
  return {
    outcome: r.outcome,
    person: cleanLine(r.person, 60),
    tool: cleanLine(r.tool, 40),
    session: cleanLine(r.session, 80),
    at: cleanLine(r.at, 40),
    head: r.head,
    evidence: r.evidence.map((e) => cleanLine(e, 300)),
    note: cleanLine(r.note, 500),
  };
}

function frontField(content: string, key: string): string | null {
  const { front } = splitFrontMatter(content);
  if (front === null) return null;
  const value = new RegExp(`^${key}:[ \\t]*(.*)$`, "m").exec(front)?.[1]?.trim() ?? "";
  return value === "" ? null : cleanLine(value, 80);
}

/** Whether a plan entry (a file, or a folder with a trailing slash) covers a path. */
function covers(entry: string, file: string): boolean {
  return entry === file || (entry.endsWith("/") && file.startsWith(entry));
}

/** What a branch did to its own plan, field by field, as sentences for the controls gate. Everything the report prints is still the base's. */
function planEdits(base: ParsedPlan, baseCriteria: readonly PlanCriterion[], branchText: string | null, baseName: string): string[] {
  if (branchText === null) return [`the plan is deleted on the branch; the report reads the one on ${baseName}.`];
  const branch = parsePlan(branchText);
  const out: string[] = [];
  if (branch.meta.risk !== base.meta.risk) out.push(`the plan's risk line reads ${branch.meta.risk} on the branch and ${base.meta.risk} on ${baseName}; the report uses ${base.meta.risk}.`);
  const kept = new Set(planCriteria(branch.sections.get("Acceptance criteria") ?? "").map((c) => c.key));
  const gone = baseCriteria.filter((c) => !kept.has(c.key)).map((c) => String(c.n));
  if (gone.length > 0) out.push(`criterion ${gone.join(", ")} of the plan on ${baseName} is deleted or reworded on the branch; the report judges the ${baseCriteria.length} on ${baseName}.`);
  if (kept.size > baseCriteria.length - gone.length) out.push(`the branch's plan holds criteria that are not on ${baseName}; checks recorded against them count for nothing.`);
  if (branch.files.join("\n") !== base.files.join("\n")) out.push(`the plan's file list differs on the branch; the report computes the class from the list on ${baseName}.`);
  return out;
}

/**
 * What the policy would say about a finished task. `root` is any checkout of the repository: the
 * answer does not depend on which. Never throws for anything a repository can hold; a state that
 * cannot be judged comes back as `not-evaluated` with its sentence.
 */
export function evaluateCompletion(root: string, slug: string, opts: EvaluateOptions = {}): PolicyReport {
  evaluationStats.calls += 1;
  try {
    return evaluate(root, slug, opts);
  } catch (err) {
    // The task page asks for this on every load, so a failure nobody foresaw is a sentence on the page
    // and never a page that cannot be drawn. The checkout's own path is taken out of the message.
    const message = cleanLine((err instanceof Error ? err.message : String(err)).split(root).join("."), 200);
    return notEvaluated(slug, `not evaluated: the evaluation itself failed (${message}). Nothing was decided and nothing was written.`);
  }
}

function evaluate(root: string, slug: string, opts: EvaluateOptions): PolicyReport {
  const runner = opts.runner;
  const branchName = `task/${slug}`;

  // The base branch's name, from the integration checkout's config on disk. Nothing else is read from a disk.
  const home = integrationRoot(root);
  let named: ReggieConfig;
  try {
    named = loadConfig(repoPaths(home));
  } catch {
    return notEvaluated(slug, "not evaluated: the config in the integration checkout does not parse, so the integration branch cannot be named.");
  }
  let baseName: string;
  try {
    baseName = defaultBranch(home, named.defaultBranch);
  } catch {
    return notEvaluated(slug, "not evaluated: the integration branch cannot be named. Set `defaultBranch:` in the integration checkout's .reggie/config.yaml.");
  }
  // A name that begins with a dash is an option to git; one holding anything but these characters is not a branch Reggie reads.
  if (baseName.startsWith("-") || !/^[A-Za-z0-9._/-]+$/.test(baseName) || baseName.includes("..")) {
    return notEvaluated(slug, "not evaluated: the integration branch's name is not one Reggie will hand to git.");
  }
  const baseCommit = resolveCommit(root, `refs/heads/${baseName}`) ?? resolveCommit(root, `refs/remotes/origin/${baseName}`);
  if (baseCommit === null) return notEvaluated(slug, `not evaluated: the integration branch ${baseName} names no commit in this repository.`);
  const base: ReportCommit = { branch: baseName, commit: baseCommit };

  // The mode, the policy and the risk rules: the base commit's copy, parsed by the same code as the file on disk.
  let config: ReggieConfig;
  try {
    config = parseConfig(fileAtCommit(root, baseCommit, `${REGGIE_DIR}/config.yaml`));
  } catch {
    return notEvaluated(slug, `not evaluated: .reggie/config.yaml on ${baseName} does not parse, so there is no policy to read.`, base);
  }
  const sourceOf = (s: PolicyKeySource): PolicySource => (s === "file" ? "base-commit" : s === "unreadable" ? "unreadable" : "mode-default");
  const policy: ReportPolicy = {
    mode: config.mode,
    plans: config.policy.plans,
    completions: config.policy.completions,
    source: { plans: sourceOf(config.policySource.plans), completions: sourceOf(config.policySource.completions) },
  };
  if (config.mode === "team") return notEvaluated(slug, `not evaluated: ${baseName} is in team mode, where approval belongs to the deciders and the pull request. The policy is for solo mode.`, base, null, policy);

  const decided = fileAtCommit(root, baseCommit, packetRelPath(slug));
  if (decided !== null && parsePacketVerdict(decided) === "approved") {
    const who = frontField(decided, "decided_by") ?? "someone";
    const when = frontField(decided, "decided_at") ?? "an unrecorded time";
    return notEvaluated(slug, `not evaluated: ${slug} is already approved on ${baseName}, by ${who} at ${when}.`, base, null, policy);
  }

  const local = resolveCommit(root, `refs/heads/${branchName}`);
  const tipCommit = local ?? resolveCommit(root, `refs/remotes/origin/${branchName}`);
  if (tipCommit === null) return notEvaluated(slug, `not evaluated: there is no ${branchName} branch, so there is no finished work to judge.`, base, null, policy);
  const task: ReportCommit = { branch: local !== null ? branchName : `origin/${branchName}`, commit: tipCommit };
  const packet = fileAtCommit(root, tipCommit, packetRelPath(slug));
  if (packet === null) return notEvaluated(slug, `not evaluated: ${task.branch} has no packet yet. The session writes one with \`reggie packet ${slug}\` and commits it.`, base, task, policy);

  // --- The plan, from the base commit ---------------------------------------------------------
  const planText = fileAtCommit(root, baseCommit, planRelPath(slug));
  const plan = planText === null ? null : parsePlan(planText);
  const criteriaOfPlan = plan === null ? [] : planCriteria(plan.sections.get("Acceptance criteria") ?? "");
  const planGate: PolicyGate = { id: "plan", title: "the plan is committed on the base and passes its contract", status: "pass", reasons: [] };
  if (planText === null) {
    planGate.status = "fail";
    planGate.reasons.push(`the plan is not committed on ${baseName}, so there is no copy the branch could not have edited.`);
  } else {
    const lint = lintPlan(planText);
    if (criteriaOfPlan.length === 0) planGate.reasons.push(`the plan on ${baseName} has no acceptance criteria, so there is nothing a check could prove; a plan with no criteria never passes.`);
    if (!lint.ok) planGate.reasons.push(`the plan on ${baseName} does not pass the plan contract: ${lint.errors.slice(0, 5).map((e) => cleanLine(e, 160)).join("; ")}.`);
    if (planGate.reasons.length > 0) planGate.status = "fail";
    else planGate.reasons.push(`${criteriaOfPlan.length} ${criteriaOfPlan.length === 1 ? "criterion" : "criteria"} read from the plan on ${baseName}.`);
  }

  // --- What the branch changed, since its merge base, with rename detection off ---------------
  const fork = mergeBase(root, baseCommit, tipCommit);
  const changedAll = fork === null ? null : changedPathsNoRenames(root, fork, tipCommit, runner);
  const controls: PolicyGate = { id: "controls", title: "the branch changes no file Reggie or the next session obeys", status: "pass", reasons: [] };
  const riskGate: PolicyGate = { id: "risk", title: "the risk class is within the policy", status: "pass", reasons: [] };
  let risk: ReportRisk | null = null;
  if (changedAll === null) {
    const why = fork === null ? `${task.branch} shares no history with ${baseName}.` : "git could not list what the branch changed.";
    controls.status = "fail";
    controls.reasons.push(why);
    riskGate.status = "fail";
    riskGate.reasons.push(why);
  } else {
    for (const file of changedAll) {
      const why = controlFileReason(slug, file);
      if (why !== null) controls.reasons.push(`the branch changes ${cleanLine(file, 200)}: ${why}. A person decides that.`);
    }
    // For its own plan, say which field moved: that is the difference between a typo fixed and a task that lowered its own bar.
    if (plan !== null && changedAll.includes(planRelPath(slug))) controls.reasons.push(...planEdits(plan, criteriaOfPlan, fileAtCommit(root, tipCommit, planRelPath(slug)), baseName));
    if (controls.reasons.length > 0) controls.status = "fail";
    else controls.reasons.push("none of the control files is among the files the branch changed.");

    const own = taskRelDir(slug);
    const counted = changedAll.filter((f) => !f.startsWith(own) && !f.startsWith(`${REGGIE_DIR}/journal/`));
    const planned = (plan?.files ?? []).map((f) => f.replace(/\\/g, "/").replace(/^\.\/+/, "").trim()).filter(Boolean);
    const planLine: Risk | "unset" = plan?.meta.risk ?? "unset";
    const planFiles = riskFromFiles(planned, config.risk);
    const changed = riskFromFiles(counted, config.risk);
    const effective = RISK_BY_RANK[Math.max(RISK_RANK[planLine], RISK_RANK[planFiles], RISK_RANK[changed])] ?? "high";
    risk = { plan: planLine, planFiles, changed, effective, changedCount: counted.length, unplanned: counted.filter((f) => !planned.some((p) => covers(p, f))) };
    if (RISK_RANK[effective] > RISK_RANK[config.policy.completions]) {
      riskGate.status = "fail";
      riskGate.reasons.push(
        `the effective risk class is ${effective}, and the policy on ${baseName} lets a completion pass without a person only up to ${config.policy.completions} (the plan's line says ${planLine}, its file list computes ${planFiles}, the ${counted.length} file${counted.length === 1 ? "" : "s"} the branch changed compute${counted.length === 1 ? "s" : ""} ${changed}).`,
      );
    } else riskGate.reasons.push(`the effective risk class is ${effective}, within a completions policy of ${config.policy.completions}.`);
  }

  // --- The policy itself -------------------------------------------------------------------------
  const policyGate: PolicyGate = { id: "policy", title: "the policy lets a completion pass without a person", status: "pass", reasons: [] };
  const from = policy.source.completions === "base-commit" ? `the policy block on ${baseName}` : policy.source.completions === "unreadable" ? `the solo default, because the value on ${baseName} could not be read` : "the solo default, because the config names none";
  if (config.policy.completions === "none") {
    policyGate.status = "fail";
    policyGate.reasons.push(`completions: none (${from}): no completion passes without a person on ${baseName}.`);
  } else policyGate.reasons.push(`completions: ${config.policy.completions} (${from}).`);

  // --- The records, from the branch tip --------------------------------------------------------
  const checksBlob = blobAt(root, tipCommit, checksRelPath(slug));
  const checksSize = checksBlob === null ? null : blobSize(root, checksBlob);
  const tooLarge = checksSize !== null && checksSize > MAX_CHECKS_BYTES;
  const checksText = checksBlob === null || tooLarge ? null : blobText(root, checksBlob);
  const read = readChecks(checksText ?? "");
  const latest = latestRecords(read.records);

  // Everything cited, by the packet and by the passes that count, judged in one listing of the folder.
  const passesByKey = Array.from(latest.values()).filter((r) => r.outcome === "pass");
  const cited = Array.from(new Set([...packetCitations(slug, packet), ...passesByKey.flatMap((r) => r.evidence)]));
  const faults = resolveEvidence(root, tipCommit, slug, cited, runner);
  const faultOf = new Map<string, EvidenceFault>(faults.map((f) => [f.path, f]));
  const evidenceGate: PolicyGate = { id: "evidence", title: "every cited evidence file resolves on the branch tip", status: "pass", reasons: [] };
  for (const f of faults) evidenceGate.reasons.push(`${f.path} ${f.why}.`);
  if (faults.length > 0) evidenceGate.status = "fail";
  else evidenceGate.reasons.push(cited.length === 0 ? "nothing is cited." : `${cited.length} cited file${cited.length === 1 ? "" : "s"} resolved on ${tipCommit.slice(0, 12)}.`);

  // A pass is stale once it no longer describes the code that would be merged.
  const staleness = new Map<string, string | null>();
  const staleWhy = (head: string): string | null => {
    const known = staleness.get(head);
    if (known !== undefined) return known;
    let why: string | null = null;
    if (!isAncestor(root, head, tipCommit, runner)) why = `it was recorded on ${head.slice(0, 12)}, which is not part of ${task.branch} as it stands (the branch was rebuilt since)`;
    else {
      const since = head === tipCommit ? [] : changedPathsNoRenames(root, head, tipCommit, runner);
      const code = since === null ? null : since.filter((f) => !f.startsWith(`${REGGIE_DIR}/`));
      if (code === null) why = "git could not list what changed since it was recorded";
      else if (code.length > 0) why = `${code.length} file${code.length === 1 ? "" : "s"} outside .reggie/ changed after it was recorded (${code.slice(0, 3).map((f) => cleanLine(f, 120)).join(", ")}${code.length > 3 ? ", …" : ""}); record it again on the code as it stands`;
    }
    staleness.set(head, why);
    return why;
  };

  const criteria: ReportCriterion[] = criteriaOfPlan.map((c) => {
    const r = latest.get(c.key);
    const row: ReportCriterion = { n: c.n, key: c.key, text: cleanLine(c.text, 300), status: "missing", why: "no check is recorded for it", record: r ? reportRecord(r) : null };
    if (!r || r.kind !== "criterion") return row;
    if (r.outcome === "fail") return { ...row, status: "fail", why: "its latest check failed" };
    if (r.evidence.length === 0) return { ...row, status: "no-evidence", why: "its pass cites no evidence" };
    const broken = r.evidence.map((e) => faultOf.get(cleanLine(e, 200))).find((f) => f !== undefined);
    if (broken) return { ...row, status: "no-evidence", why: `its evidence does not resolve: ${broken.path} ${broken.why}` };
    const stale = staleWhy(r.head);
    if (stale !== null) return { ...row, status: "stale", why: stale };
    return { ...row, status: "pass", why: null };
  });
  const reviews: ReportReview[] = Array.from(latest.values())
    .filter((r) => r.kind === "review")
    .map((r) => ({ name: r.key.slice(2), key: r.key, outcome: r.outcome, record: reportRecord(r) }))
    .sort((a, b) => a.key.localeCompare(b.key));

  const criteriaGate: PolicyGate = { id: "criteria", title: "every criterion has a passing check and no check fails", status: "pass", reasons: [] };
  if (checksBlob === null) criteriaGate.reasons.push(`a packet with no checks never passes: there is no checks.jsonl on ${task.branch}. Record each criterion with \`reggie check\`.`);
  else if (tooLarge) criteriaGate.reasons.push(`the checks file on ${task.branch} is larger than ${MAX_CHECKS_BYTES / (1024 * 1024)} MB and was not read.`);
  else if (checksText === null) criteriaGate.reasons.push(`the checks file on ${task.branch} could not be read.`);
  else if (read.records.length === 0) criteriaGate.reasons.push(`a packet with no checks never passes: checks.jsonl on ${task.branch} holds no record.`);
  for (const b of read.bad) criteriaGate.reasons.push(`line ${b.line} of checks.jsonl is not a record (${b.why}); a file that cannot be read in full proves nothing.`);
  const numbers = (status: CriterionStatus): string => criteria.filter((c) => c.status === status).map((c) => String(c.n)).join(", ");
  if (checksBlob !== null && numbers("missing")) criteriaGate.reasons.push(`no check is recorded for criterion ${numbers("missing")}.`);
  if (numbers("fail")) criteriaGate.reasons.push(`the latest check failed for criterion ${numbers("fail")}.`);
  if (numbers("no-evidence")) criteriaGate.reasons.push(`the pass for criterion ${numbers("no-evidence")} has no evidence that resolves.`);
  if (numbers("stale")) criteriaGate.reasons.push(`the pass for criterion ${numbers("stale")} is stale: code changed after it was recorded.`);
  for (const r of reviews) if (r.outcome === "fail") criteriaGate.reasons.push(`the review ${r.name} failed its latest check.`);
  const inPlan = new Set(criteriaOfPlan.map((c) => c.key));
  for (const r of latest.values()) {
    if (r.kind === "criterion" && r.outcome === "fail" && !inPlan.has(r.key)) {
      criteriaGate.reasons.push(`a failing check is recorded for ${r.key} (criterion ${r.n}, "${cleanLine(r.text, 80)}"), which is in no plan on ${baseName}; supersede it by naming that key.`);
    }
  }
  if (criteriaGate.reasons.length > 0 || criteriaOfPlan.length === 0) {
    criteriaGate.status = "fail";
    if (criteriaGate.reasons.length === 0) criteriaGate.reasons.push("there are no criteria to pass.");
  } else criteriaGate.reasons.push(`${criteria.length} of ${criteria.length} criteria passed, and no check of any kind fails.`);

  // --- The packet, under its contract ------------------------------------------------------------
  const packetGate: PolicyGate = { id: "packet", title: "the packet is pending and satisfies the packet contract", status: "pass", reasons: [] };
  const verdict = parsePacketVerdict(packet);
  if (verdict === "approved") packetGate.reasons.push(`the packet on ${task.branch} already says approved. A verdict is written by a decision, never by the branch.`);
  if (verdict === "needs-work") packetGate.reasons.push(`the packet on ${task.branch} says needs-work: it went back to its session and has not been reset.`);
  for (const e of lintPacket(packet, { slug, checklist: plan === null ? null : renderChecklist(criteriaOfPlan, read.records) }).errors) packetGate.reasons.push(`${cleanLine(e, 300)}.`);
  if (packetGate.reasons.length > 0) packetGate.status = "fail";
  else packetGate.reasons.push("pending, every section filled, and the checklist is what the records render.");

  // --- Would it merge ----------------------------------------------------------------------------
  const mergeGate: PolicyGate = { id: "merge", title: "the branch merges into the base without a conflict", status: "pass", reasons: [] };
  const merged = mergeTreeCheck(root, baseCommit, tipCommit, runner);
  if (merged.status === "conflict") {
    mergeGate.status = "fail";
    mergeGate.reasons.push(`merging ${task.branch} into ${baseName} would conflict in ${merged.conflicts.map((f) => cleanLine(f, 200)).join(", ")}. Merge ${baseName} into the branch and resolve it there.`);
  } else if (merged.status === "unknown") {
    mergeGate.status = "not-checked";
    mergeGate.reasons.push("not checked: this git cannot merge in memory (`git merge-tree --write-tree` arrived in git 2.38). The real merge still aborts safely on a conflict.");
  } else mergeGate.reasons.push("merged in memory with no conflict; no checkout was touched.");

  const gates = [policyGate, planGate, controls, packetGate, criteriaGate, evidenceGate, riskGate, mergeGate];
  const failing = gates.filter((g) => g.status === "fail");
  const wouldPass = failing.length === 0;
  return {
    slug,
    verdict: wouldPass ? "would-pass" : "refused",
    summary: wouldPass
      ? `would pass: every gate holds for ${task.branch} at ${tipCommit.slice(0, 12)} against ${baseName} at ${baseCommit.slice(0, 12)}.`
      : `refused: ${failing.length} gate${failing.length === 1 ? "" : "s"} failed (${failing.map((g) => g.id).join(", ")}).`,
    base,
    task,
    policy,
    risk,
    criteria,
    reviews,
    badLines: read.bad,
    gates,
  };
}

/** The first line of every report, in every form: what this is and who decides. */
export const REPORT_PREAMBLE = "This is a report, not a decision: it says what the policy would say, and a person decides with `reggie decide`.";

/** The report as the CLI and the MCP tool print it. */
export function formatReport(report: PolicyReport): string {
  const lines: string[] = [REPORT_PREAMBLE, `task: ${report.slug}`];
  const id = (c: ReportCommit | null): string => (c ? `${c.branch} @ ${c.commit.slice(0, 12)}` : "not read");
  lines.push(`base: ${id(report.base)}`);
  lines.push(`branch: ${id(report.task)}`);
  if (report.policy) {
    const said = (s: PolicySource): string => (s === "base-commit" ? "from the base commit's policy block" : s === "unreadable" ? "the mode's default, because the base commit's value could not be read" : "the mode's default");
    lines.push(`policy (${report.policy.mode} mode): completions ${report.policy.completions} (${said(report.policy.source.completions)}); plans ${report.policy.plans} (${said(report.policy.source.plans)}; nothing reads it in this version)`);
  }
  if (report.risk) {
    lines.push(`risk: the plan's line ${report.risk.plan} · the plan's file list ${report.risk.planFiles} · the ${report.risk.changedCount} changed file${report.risk.changedCount === 1 ? "" : "s"} ${report.risk.changed} → effective ${report.risk.effective}`);
    if (report.risk.unplanned.length > 0) lines.push(`  changed but never named by the plan: ${report.risk.unplanned.map((f) => cleanLine(f, 200)).join(", ")}`);
  }
  if (report.criteria.length > 0) lines.push("criteria:");
  for (const c of report.criteria) {
    const who = c.record ? ` — ${c.record.outcome} by ${c.record.person || "unknown"} (${c.record.tool || "unknown"}) at ${c.record.at}` : "";
    lines.push(`  ${String(c.n).padStart(2)}. ${c.status.padEnd(11)} ${c.text}${who}${c.why ? ` [${c.why}]` : ""}`);
  }
  if (report.reviews.length > 0) lines.push("reviews:");
  for (const r of report.reviews) lines.push(`  ${r.name}: ${r.outcome} by ${r.record.person || "unknown"} (${r.record.tool || "unknown"}) at ${r.record.at}`);
  if (report.gates.length > 0) lines.push("gates:");
  for (const g of report.gates) lines.push(`  ${g.status.padEnd(11)} ${g.id}: ${g.title}\n${g.reasons.map((r) => `               ${r}`).join("\n")}`);
  lines.push(`verdict: ${report.summary}`);
  return lines.join("\n");
}
