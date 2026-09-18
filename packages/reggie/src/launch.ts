import { randomUUID } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { INVISIBLE_CHARS } from "./capture.js";
import { buildContext, type ContextRequest } from "./context.js";
import { run } from "./git.js";
import type { RepoPaths } from "./paths.js";
import type { InstallEntry, ReggieConfig } from "./people.js";
import type { TaskState } from "./tasks.js";
import { isSafeSlug, nowIso } from "./util.js";

/** The tools a session can be started in. Exported so callers can validate input against it. */
export const LAUNCH_TOOLS = ["claude", "codex"] as const;
export type LaunchTool = (typeof LAUNCH_TOOLS)[number];

/**
 * Two verbs. Discuss opens the tool in its own plan mode with a prompt that frames a
 * conversation; what the conversation is *for* follows from the task's state (shape a brief,
 * write a plan, or just talk it through). Build claims the task, then opens the tool in the
 * task's worktree with the plan. No mode fires a Reggie slash command: the prompt is the whole
 * instruction, and it is the same text for both tools.
 */
export const LAUNCH_MODES = ["discuss", "build"] as const;
export type LaunchMode = (typeof LAUNCH_MODES)[number];

/** What a session is opened to do, derived from the mode and the task's state. */
export const LAUNCH_GOALS = ["shape", "plan", "discuss", "build"] as const;
export type LaunchGoal = (typeof LAUNCH_GOALS)[number];

export function isLaunchTool(value: string): value is LaunchTool {
  return (LAUNCH_TOOLS as readonly string[]).includes(value);
}

export function isLaunchMode(value: string): value is LaunchMode {
  return (LAUNCH_MODES as readonly string[]).includes(value);
}

/** A task as the launcher needs to see it: the slug and where it stands. */
export interface LaunchTask {
  slug: string;
  state: TaskState;
}

export interface LaunchInput {
  /** The directory the session runs in: the repository, or the task's worktree for a build. */
  repo: string;
  tool: LaunchTool;
  mode: LaunchMode;
  /** One task, except shaping, which takes several ungroomed ones in one conversation. */
  tasks: LaunchTask[];
  /** The user's own words, appended verbatim to the prompt. */
  note?: string;
  /** A session id minted by the caller, so the chat can be found and resumed later. Claude only. */
  session?: string;
  /** Repo-relative paths of context packs written for the session, one per task, in task order. */
  contextFiles?: string[];
  /** The task branch a build session is on, when the caller has claimed it. */
  branch?: string;
  /**
   * Dependency directories the claim did not make ready, because the caller deferred the install
   * or it failed. The build prompt names each one as the session's first command.
   */
  setup?: InstallEntry[];
  /**
   * Repo-relative paths the context pack was built around (the page an idea was captured from).
   * Validated for existence by the caller through `resolveCaptureOrigin`; here only for what can
   * reach a command line. The prompt names each one so the session knows where to start reading.
   */
  paths?: string[];
}

export interface LaunchPlan {
  /** The single-line form, for showing in a tooltip and for pasting into a shell. */
  command: string;
  cwd: string;
  /** One line saying what this session will do, for a button label or a toast. */
  description: string;
  /** What actually gets executed: the program, then its arguments. Never a shell string. */
  argv: string[];
  goal: LaunchGoal;
  /** The session id the tool was told to use, when the tool takes one. */
  session: string | null;
  /** How to reopen the same chat later, when that is knowable up front. */
  resume: string | null;
}

export interface LaunchResult {
  launched: boolean;
  command: string;
  cwd: string;
  goal: LaunchGoal;
  session: string | null;
  resume: string | null;
  /** Why nothing was started. Present only when launched is false. */
  reason?: string;
}

/** The longest note a launch accepts; a prompt is an argument, not a document. */
export const MAX_NOTE_CHARS = 4000;

/** How many pack paths one launch names, and how long each may be: a prompt names a place, not a listing. */
export const MAX_LAUNCH_PATHS = 8;
export const MAX_PATH_CHARS = 512;

/**
 * POSIX single-quote quoting, and the only shell quoting in this module. Inside single
 * quotes every byte is literal, so the sole case to handle is the quote itself: close,
 * escape one, reopen. Words that need no quoting are left bare so commands stay readable.
 */
export function shellQuote(value: string): string {
  if (value.length > 0 && /^[A-Za-z0-9_@%+=:,./-]+$/.test(value)) return value;
  return `'${value.replace(/'/g, "'\\''")}'`;
}

/**
 * An AppleScript string literal. A different layer from shellQuote, not a second copy of
 * it: AppleScript uses double quotes with backslash escapes, so shell quoting would be
 * wrong here. The shell line is built with shellQuote first, then wrapped with this.
 */
export function appleScriptLiteral(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function assertTool(tool: string): LaunchTool {
  if (!isLaunchTool(tool)) throw new Error(`"${tool}" is not a tool Reggie can launch. Use one of: ${LAUNCH_TOOLS.join(", ")}.`);
  return tool;
}

function assertMode(mode: string): LaunchMode {
  if (!isLaunchMode(mode)) throw new Error(`"${mode}" is not a launch mode. Use one of: ${LAUNCH_MODES.join(", ")}.`);
  return mode;
}

/** Slugs are the only caller input that reaches a command string; validate every one. */
function assertTasks(tasks: readonly LaunchTask[]): [LaunchTask, ...LaunchTask[]] {
  const [first, ...rest] = tasks;
  if (first === undefined) throw new Error("launching needs at least one task.");
  for (const t of [first, ...rest]) {
    if (!isSafeSlug(t.slug)) throw new Error(`"${t.slug}" is not a valid slug. Use lowercase letters, digits, and hyphens.`);
  }
  return [first, ...rest];
}

/**
 * The pack paths are the other caller input that reaches a command string, inside the single-quoted
 * prompt the way the note does. Whether each one is a file or folder of the repo is the caller's
 * check (`resolveCaptureOrigin`); this one refuses what no prompt should carry: nothing, a control
 * character, a listing rather than a place, or a path too long to be one.
 */
function assertPaths(paths: readonly string[] | undefined): string[] {
  const list = paths ?? [];
  if (list.length > MAX_LAUNCH_PATHS) throw new Error(`a launch names at most ${MAX_LAUNCH_PATHS} paths, got ${list.length}.`);
  for (const p of list) {
    if (typeof p !== "string" || p.trim() === "") throw new Error("a pack path cannot be empty.");
    if (INVISIBLE_CHARS.test(p)) throw new Error("a pack path cannot hold a control character.");
    if (p.length > MAX_PATH_CHARS) throw new Error(`a pack path is longer than ${MAX_PATH_CHARS} characters.`);
  }
  return [...list];
}

/**
 * The goal follows from the state, so a button never has to know which prompt to send and
 * cannot send the wrong one: an ungroomed task is shaped, a groomed one is planned, anything
 * else is discussed. Build needs a plan that passed the contract, or a branch already in
 * progress to resume.
 */
export function resolveGoal(mode: LaunchMode, tasks: readonly LaunchTask[]): LaunchGoal {
  const list = assertTasks(tasks);
  if (mode === "build") {
    if (list.length > 1) throw new Error(`build takes one task, got ${list.length} (${list.map((t) => t.slug).join(", ")}).`);
    const t = list[0];
    if (t.state === "planned" || t.state === "in-process") return "build";
    if (t.state === "groomed") throw new Error(`${t.slug} has no plan that passes the contract yet. Plan it first (Discuss), or run \`reggie plan lint ${t.slug}\`.`);
    if (t.state === "ungroomed") throw new Error(`${t.slug} has not been shaped or planned yet. Discuss it first.`);
    throw new Error(`${t.slug} is ${t.state.replace("-", " ")}; there is nothing left to build.`);
  }
  if (list.every((t) => t.state === "ungroomed")) return "shape";
  if (list.length > 1) throw new Error(`discuss takes one task unless every task is ungroomed; got ${list.map((t) => `${t.slug} (${t.state})`).join(", ")}.`);
  return list[0].state === "groomed" ? "plan" : "discuss";
}

const TOOL_LABEL: Record<LaunchTool, string> = { claude: "Claude Code", codex: "Codex" };

/** Where the pack is: the file the launcher wrote, else the verb that prints it. */
function contextClause(slug: string, file: string | undefined): string {
  return file ? `Read \`${file}\` first and all of it; it is the context pack for \`${slug}\` (what \`reggie context ${slug}\` prints).` : `Run \`reggie context ${slug}\` first and read all of it.`;
}

function noteClause(note: string | undefined): string[] {
  const text = (note ?? "").trim();
  return text ? [`The user adds, in their own words: "${text}"`] : [];
}

/**
 * Where the pack was built from, when an idea came from a page: the session is told the place so
 * it starts reading there instead of at the repo note. One sentence after the context clause in
 * every goal, build included, because a pack whose scope is unexplained is worse than a sentence.
 */
function pathsClause(paths: readonly string[]): string[] {
  if (paths.length === 0) return [];
  const named = paths.map((p) => `\`${p}\``);
  const list = named.length === 1 ? named[0] : `${named.slice(0, -1).join(", ")} and ${named[named.length - 1]}`;
  const one = named.length === 1;
  return [`The pack was also built around ${list}: ${one ? "its" : "their"} notes, ${one ? "its" : "their"} recent commits and the tasks that touch ${one ? "it" : "them"} are in there, so start reading at ${one ? "that place" : "those places"}.`];
}

/** Shape one or more ungroomed items into briefs, together, before anyone plans them. */
function shapePrompt(tasks: readonly LaunchTask[], files: readonly string[], note: string | undefined, paths: readonly string[]): string {
  const many = tasks.length > 1;
  const list = tasks.map((t) => `\`${t.slug}\``).join(", ");
  const reads = tasks.map((t, i) => contextClause(t.slug, files[i])).join(" ");
  return [
    many ? `We are going to shape these captured items into briefs together, before anyone plans them: ${list}.` : `We are going to shape ${list} into a brief together, before anyone plans it.`,
    reads,
    ...pathsClause(paths),
    "Work from the intake line (or, once triage has taken it, the Problem section of the scaffolded brief that holds the same words), the notes and the graph rather than reading much code; a brief is cheap on purpose.",
    "Ask me the questions whose answers would change the shape of the work, one at a time, and tell me what you think the item is about and where in the code it probably lives.",
    many
      ? "When we agree on one, run `reggie triage <slug>` to scaffold `.reggie/tasks/<slug>/brief.md` (which also removes the item's intake line, so the brief becomes the record) and fill every section: Problem, Why now, Suspected area, Open questions, Not this; set area, size and priority in the front matter. A task whose brief already exists is already scaffolded: fill that one in instead, and do not pass --force."
      : `When we agree, run \`reggie triage ${tasks[0]?.slug}\` to scaffold \`.reggie/tasks/${tasks[0]?.slug}/brief.md\` (which also removes the item's intake line, so the brief becomes the record) and fill every section: Problem, Why now, Suspected area, Open questions, Not this; set area, size and priority in the front matter. If the brief is already there, it is already scaffolded: fill that one in instead, and do not pass --force.`,
    "Anything we could not settle becomes an Open question. This is shaping, not planning: no implementation approach and no file-by-file design, and do not start the work.",
    "Run `reggie brief lint <slug>` and fix every error; until every placeholder is written over the task stays ungroomed. Then write one journal entry with `reggie journal add --stage triage`.",
    ...noteClause(note),
  ].join(" ");
}

/** Plan one groomed task in the tool's plan mode, ending in a plan that passes the contract. */
function planPrompt(slug: string, file: string | undefined, note: string | undefined, paths: readonly string[]): string {
  return [
    `We are going to plan \`${slug}\` together before anything is built.`,
    contextClause(slug, file),
    ...pathsClause(paths),
    "Stay in plan mode and read-only while we talk: explore the code, but change nothing.",
    "Start from the brief's Problem and its open questions. Ask me every question whose answer would change the approach, one at a time, before you propose one; if I am not available, answer it yourself and record it under Assumptions.",
    `When we agree, write \`.reggie/tasks/${slug}/plan.md\` (\`reggie plan new ${slug}\` scaffolds it) with every section filled: Problem, Approach, Files to touch, Acceptance criteria, Verification strategy, Assumptions, Out of scope, Bail conditions.`,
    "Each acceptance criterion must be a statement a reviewer can check without asking, and each needs a line in Verification strategy naming the evidence that will prove it.",
    `Then run \`reggie plan risk ${slug}\` and \`reggie plan lint ${slug}\`, fix every error, commit the plan, and stop. Do not start the implementation.`,
    `Finish with one journal entry: \`reggie journal add --slug ${slug} --stage plan\`.`,
    ...noteClause(note),
  ].join(" ");
}

/** Talk a task through without touching anything; offer to record what gets settled. */
function discussPrompt(slug: string, file: string | undefined, note: string | undefined, paths: readonly string[]): string {
  return [
    `Let us discuss \`${slug}\` together.`,
    contextClause(slug, file),
    ...pathsClause(paths),
    "This is a discussion: do not edit any file, do not write or update a plan, and do not start the work.",
    "Answer my questions, lay out the options with their trade-offs, and say plainly what you are unsure about.",
    "If we settle something worth keeping, offer to record it: a note with `reggie note add`, a captured item with `reggie capture`, or a change to the brief or plan. Do it only if I say yes.",
    ...noteClause(note),
  ].join(" ");
}

/** Review commands differ per tool; everything else in the build prompt is the same text. */
const REVIEW: Record<LaunchTool, { code: string; security: string; simplify: string }> = {
  claude: { code: "`/code-review`", security: "`/security-review`", simplify: "`/simplify`" },
  codex: { code: "`codex review` (or a fresh read of the diff against the plan)", security: "a security review pass over the diff", simplify: "a simplification pass" },
};

/**
 * The install a claim deferred or could not finish, as the session's first command. Worth its own
 * sentence because the alternative is the session's first act being a command that fails through
 * no fault of its own.
 */
function setupClause(setup: readonly InstallEntry[] | undefined): string[] {
  const list = setup ?? [];
  if (list.length === 0) return [];
  const each = list.map((s) => `\`${s.command}\` in \`${s.dir}\``).join(", then ");
  return [`This worktree's dependencies are not installed yet, so nothing here runs until they are: your first command is ${each}.`];
}

/**
 * The one thing a session can do that reaches outside its own worktree. `node_modules` may be a
 * link into the checkout Reggie serves from, so installing through it would change every other
 * worktree, and deleting through it would empty them.
 */
const UNLINK_CLAUSE =
  "Before you add or change any dependency, check whether `node_modules` here is a symlink: if it is, it points into the checkout Reggie serves from, so remove the link with `unlink` and run the install command first, because installing through it would change every other worktree and `rm -r` through it would delete their dependencies.";

/** Implement one planned task from its worktree, already claimed, through to a completion packet. */
function buildPrompt(tool: LaunchTool, slug: string, file: string | undefined, branch: string | undefined, note: string | undefined, setup: readonly InstallEntry[] | undefined, paths: readonly string[]): string {
  const r = REVIEW[tool];
  return [
    `Implement \`${slug}\`.`,
    branch ? `You are in the task's worktree on branch \`${branch}\`, which Reggie has already claimed for you; work here and commit here.` : `Run \`reggie claim ${slug} --worktree\` first and work in the worktree it creates.`,
    ...setupClause(setup),
    UNLINK_CLAUSE,
    contextClause(slug, file),
    ...pathsClause(paths),
    "Execute the plan. You may deviate, but record every deviation and its reason for the packet.",
    `Produce the evidence named under Verification strategy and save it under \`.reggie/tasks/${slug}/evidence/\`; never claim a test passed without its output saved.`,
    `Reviews by risk class, from the plan's front matter: low, run the repo's own checks; medium, also run ${r.code}; high, also run ${r.security} and have a second pass execute the tests. Run ${r.simplify} when the diff is large. Resolve findings before continuing.`,
    "After each file change, add or correct the note for that file. After each step, write one journal entry with `--stage execute`. Capture unrelated problems with `reggie capture` instead of fixing them.",
    `Finish with \`reggie packet ${slug}\`, fill every section honestly, and commit with a line \`Task: ${slug}\` in the commit message body. Then ask me to decide (\`reggie decide ${slug}\`) or open a PR whose body is the packet (\`reggie pr ${slug}\`).`,
    ...noteClause(note),
  ].join(" ");
}

function promptFor(tool: LaunchTool, goal: LaunchGoal, tasks: readonly LaunchTask[], input: LaunchInput, paths: readonly string[]): string {
  const files = input.contextFiles ?? [];
  const first = tasks[0]?.slug ?? "";
  switch (goal) {
    case "shape":
      return shapePrompt(tasks, files, input.note, paths);
    case "plan":
      return planPrompt(first, files[0], input.note, paths);
    case "discuss":
      return discussPrompt(first, files[0], input.note, paths);
    case "build":
      return buildPrompt(tool, first, files[0], input.branch, input.note, input.setup, paths);
  }
}

/**
 * The argument vector per tool. Discussion goals open Claude Code in its plan mode and Codex in
 * a read-only sandbox, so "change nothing" is enforced by the tool and not only asked for by
 * the prompt. A build gets the tool's normal editing mode.
 */
function argvFor(tool: LaunchTool, goal: LaunchGoal, session: string | undefined, prompt: string): string[] {
  const readOnly = goal !== "build";
  if (tool === "claude") {
    const args = ["claude"];
    if (readOnly) args.push("--permission-mode", "plan");
    if (session) args.push("--session-id", session);
    args.push(prompt);
    return args;
  }
  return ["codex", "-s", readOnly ? "read-only" : "workspace-write", prompt];
}

function describe(tool: LaunchTool, goal: LaunchGoal, tasks: readonly LaunchTask[]): string {
  const label = TOOL_LABEL[tool];
  const slug = tasks[0]?.slug ?? "";
  switch (goal) {
    case "shape":
      return tasks.length === 1 ? `Shape ${slug} into a brief with ${label}, in plan mode` : `Shape ${tasks.length} tasks into briefs with ${label}, in plan mode: ${tasks.map((t) => t.slug).join(", ")}`;
    case "plan":
      return `Plan ${slug} with ${label} in plan mode, against the plan contract`;
    case "discuss":
      return `Discuss ${slug} in ${label}, read-only: no edits, no plan, no work`;
    case "build":
      return `Build ${slug} in ${label}, from its plan to a completion packet`;
  }
}

/** A session id for the tools that take one at launch, so the chat is findable before it starts. */
export function mintSession(tool: LaunchTool): string | null {
  return tool === "claude" ? randomUUID() : null;
}

function resumeFor(tool: LaunchTool, session: string | null): string | null {
  if (tool === "claude") return session ? `claude --resume ${session}` : null;
  return "codex resume --last";
}

/**
 * The command for a session, with no side effects, so a page can show it, copy it, or
 * hand it to launchSession. Throws on any tool, mode, or slug it does not recognise:
 * nothing unvalidated is allowed into a command string.
 */
export function launchCommand(input: LaunchInput): LaunchPlan {
  const tool = assertTool(input.tool);
  const mode = assertMode(input.mode);
  const tasks = assertTasks(input.tasks);
  const goal = resolveGoal(mode, tasks);
  if (typeof input.repo !== "string" || input.repo.trim() === "") throw new Error("launch needs the repository directory.");
  if ((input.note ?? "").length > MAX_NOTE_CHARS) throw new Error(`the note is longer than ${MAX_NOTE_CHARS} characters; put the rest in the brief.`);
  const paths = assertPaths(input.paths);
  const session = tool === "claude" ? (input.session ?? null) : null;
  const prompt = promptFor(tool, goal, tasks, input, paths);
  const argv = argvFor(tool, goal, session ?? undefined, prompt);
  return {
    command: argv.map(shellQuote).join(" "),
    cwd: path.resolve(input.repo),
    description: describe(tool, goal, tasks),
    argv,
    goal,
    session,
    resume: resumeFor(tool, session),
  };
}

/** Where a launch writes the context pack for a task, relative to the session's directory. */
export function contextFileRel(slug: string): string {
  if (!isSafeSlug(slug)) throw new Error(`"${slug}" is not a valid slug.`);
  return `.reggie/.cache/context/${slug}.md`;
}

/**
 * Write the pack where the session will look for it. Under `.reggie/.cache/`, which is derived
 * state and never committed; a file read survives a read-only sandbox and a `reggie` binary
 * that is not on PATH, which a "run this verb" instruction does not.
 */
export function writeContextFile(cwd: string, slug: string, text: string): string {
  const rel = contextFileRel(slug);
  const full = path.join(cwd, rel);
  mkdirSync(path.dirname(full), { recursive: true });
  writeFileSync(full, text.endsWith("\n") ? text : `${text}\n`, "utf8");
  return rel;
}

/**
 * The packs a launch writes, one per task, each built around the same pack paths, returned as the
 * relative files the prompt names. `POST /api/launch` and `reggie launch --run` both go through here
 * so the two callers cannot disagree about what a session is handed to read first. The paths are
 * the caller's, already resolved; `buildContext` does the rest (the note chain, the files in scope,
 * their commits and the tasks whose plans overlap them).
 */
export function writeContextPacks(paths: RepoPaths, config: ReggieConfig, cwd: string, tasks: readonly LaunchTask[], packPaths: readonly string[] = []): string[] {
  return tasks.map((t) => {
    const req: ContextRequest = { slug: t.slug };
    if (packPaths.length > 0) req.paths = [...packPaths];
    return writeContextFile(cwd, t.slug, buildContext(paths, config, req));
  });
}

/**
 * What a launch left behind: enough to find the chat again and to say a session is in flight. It names
 * no person, and a Codex launch has no id, so `reggie journal derive` can only report that one as unread.
 */
export interface LaunchRecord {
  slug: string;
  tool: LaunchTool;
  goal: LaunchGoal;
  session: string | null;
  resume: string | null;
  cwd: string;
  at: string;
}

/** `.reggie/.cache/launches/<slug>.json` in the repository the server runs against. */
export function launchRecordFile(root: string, slug: string): string {
  if (!isSafeSlug(slug)) throw new Error(`"${slug}" is not a valid slug.`);
  return path.join(root, ".reggie", ".cache", "launches", `${slug}.json`);
}

/**
 * `.reggie/.cache/launches/<slug>.log`: every launch for the slug, one JSON object per line, oldest
 * first. The `.json` beside it keeps only the latest, so a plan launch followed by a build launch
 * would otherwise lose the planning session's id, and with it the only join to that transcript.
 */
export function launchLogFile(root: string, slug: string): string {
  if (!isSafeSlug(slug)) throw new Error(`"${slug}" is not a valid slug.`);
  return path.join(root, ".reggie", ".cache", "launches", `${slug}.log`);
}

export function recordLaunch(root: string, record: Omit<LaunchRecord, "at">): LaunchRecord {
  const full = { ...record, at: nowIso() };
  const file = launchRecordFile(root, record.slug);
  const log = launchLogFile(root, record.slug);
  mkdirSync(path.dirname(file), { recursive: true });
  // A record written before the log existed is about to be overwritten; it goes into the log first.
  const before = !existsSync(log) && existsSync(file) ? parseLaunch(readFileSync(file, "utf8"), record.slug) : null;
  if (before) appendFileSync(log, `${JSON.stringify(before)}\n`, "utf8");
  writeFileSync(file, `${JSON.stringify(full, null, 2)}\n`, "utf8");
  appendFileSync(log, `${JSON.stringify(full)}\n`, "utf8");
  return full;
}

/** A record as it was written, or null for anything else: the cache is a file anyone can edit. */
function asLaunchRecord(value: unknown, slug: string): LaunchRecord | null {
  if (!value || typeof value !== "object") return null;
  const r = value as Record<string, unknown>;
  if (r.slug !== slug || typeof r.tool !== "string" || !isLaunchTool(r.tool)) return null;
  if (typeof r.goal !== "string" || !(LAUNCH_GOALS as readonly string[]).includes(r.goal)) return null;
  if (typeof r.at !== "string" || typeof r.cwd !== "string") return null;
  return {
    slug,
    tool: r.tool,
    goal: r.goal as LaunchGoal,
    session: typeof r.session === "string" ? r.session : null,
    resume: typeof r.resume === "string" ? r.resume : null,
    cwd: r.cwd,
    at: r.at,
  };
}

function parseLaunch(text: string, slug: string): LaunchRecord | null {
  try {
    return asLaunchRecord(JSON.parse(text), slug);
  } catch {
    return null;
  }
}

/**
 * Every launch recorded for a slug, oldest first. Lines that do not parse are skipped. The single
 * `.json` record is read too, because a launch made before the log existed is only there; it is left
 * out when the log already holds the same launch.
 */
export function readLaunches(root: string, slug: string): LaunchRecord[] {
  const log = launchLogFile(root, slug);
  const out: LaunchRecord[] = [];
  if (existsSync(log)) {
    for (const line of readFileSync(log, "utf8").split("\n")) {
      const rec = line.trim() ? parseLaunch(line, slug) : null;
      if (rec) out.push(rec);
    }
  }
  const single = launchRecordFile(root, slug);
  const latest = existsSync(single) ? parseLaunch(readFileSync(single, "utf8"), slug) : null;
  if (latest && !out.some((r) => r.at === latest.at && r.session === latest.session)) out.push(latest);
  return out.sort((a, b) => a.at.localeCompare(b.at));
}

/** How long to wait for Terminal before giving up and handing the command back to the caller. */
export const LAUNCH_TIMEOUT_MS = 8000;

/**
 * Start the session in a new terminal window. macOS only: elsewhere the command comes
 * back unlaunched with the reason, so the caller can show it to copy. osascript is spawned
 * with an argument vector, never a shell string, and the script it runs is built from
 * validated slugs and a quoted repo path.
 */
export function launchSession(input: LaunchInput): LaunchResult {
  const plan = launchCommand(input);
  if (!existsSync(plan.cwd) || !statSync(plan.cwd).isDirectory()) {
    throw new Error(`${plan.cwd} is not a directory; there is nowhere to start the session.`);
  }
  const base = { command: plan.command, cwd: plan.cwd, goal: plan.goal, session: plan.session, resume: plan.resume };
  if (process.platform !== "darwin") {
    return { ...base, launched: false, reason: `Reggie can only open a terminal window on macOS, and this is ${process.platform}. Run the command yourself in ${plan.cwd}.` };
  }
  const line = `cd ${shellQuote(plan.cwd)} && ${plan.command}`;
  const script = `tell application "Terminal" to do script ${appleScriptLiteral(line)}`;
  // macOS gates Terminal automation behind a consent dialog. Unanswered, osascript waits forever,
  // and because the server is single-threaded that would block every other request too. Bound it.
  const r = run("osascript", ["-e", script, "-e", 'tell application "Terminal" to activate'], {
    allowFailure: true,
    timeoutMs: LAUNCH_TIMEOUT_MS,
  });
  if (r.timedOut) {
    return {
      ...base,
      launched: false,
      reason: `Terminal did not respond within ${Math.round(LAUNCH_TIMEOUT_MS / 1000)} seconds. macOS may be waiting for you to allow Reggie to control Terminal (System Settings, Privacy & Security, Automation). Run the command yourself in ${plan.cwd}.`,
    };
  }
  if (!r.ok) {
    const detail = (r.stderr || r.stdout).trim();
    return { ...base, launched: false, reason: `Terminal did not start the session${detail ? `: ${detail}` : "."}` };
  }
  return { ...base, launched: true };
}
