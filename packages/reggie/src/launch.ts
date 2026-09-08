import { existsSync, statSync } from "node:fs";
import path from "node:path";
import { run } from "./git.js";
import { isSafeSlug } from "./util.js";

/** The tools a session can be started in. Exported so callers can validate input against it. */
export const LAUNCH_TOOLS = ["claude", "codex"] as const;
export type LaunchTool = (typeof LAUNCH_TOOLS)[number];

/** What the session is being started to do. Exported for the same reason. */
export const LAUNCH_MODES = ["chat", "triage", "plan", "implement"] as const;
export type LaunchMode = (typeof LAUNCH_MODES)[number];

export function isLaunchTool(value: string): value is LaunchTool {
  return (LAUNCH_TOOLS as readonly string[]).includes(value);
}

export function isLaunchMode(value: string): value is LaunchMode {
  return (LAUNCH_MODES as readonly string[]).includes(value);
}

export interface LaunchInput {
  /** The repository the session runs in. */
  repo: string;
  tool: LaunchTool;
  mode: LaunchMode;
  /** One slug, except in triage mode, which shapes several tasks in one pass. */
  slugs: string[];
}

export interface LaunchPlan {
  /** The single-line form, for showing in a tooltip and for pasting into a shell. */
  command: string;
  cwd: string;
  /** One line saying what this session will do, for a button label or a toast. */
  description: string;
  /** What actually gets executed: the program, then its arguments. Never a shell string. */
  argv: string[];
}

export interface LaunchResult {
  launched: boolean;
  command: string;
  /** Why nothing was started. Present only when launched is false. */
  reason?: string;
}

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
function assertSlugs(mode: LaunchMode, slugs: readonly string[]): [string, ...string[]] {
  const [first, ...rest] = slugs;
  if (first === undefined) throw new Error(`launching ${mode} needs at least one slug.`);
  if (mode !== "triage" && rest.length > 0) {
    throw new Error(`${mode} takes one slug, got ${slugs.length} (${slugs.join(", ")}). Only triage runs over several tasks at once.`);
  }
  for (const slug of [first, ...rest]) {
    if (!isSafeSlug(slug)) throw new Error(`"${slug}" is not a valid slug. Use lowercase letters, digits, and hyphens.`);
  }
  return [first, ...rest];
}

const TOOL_LABEL: Record<LaunchTool, string> = { claude: "Claude Code", codex: "Codex" };

/**
 * The discussion prompt, used by both tools: chat has no slash command because the point
 * is the instruction itself, and it has to forbid editing in words the model cannot miss.
 */
function chatPrompt(slug: string): string {
  return [
    `Discuss the Reggie task \`${slug}\` with me.`,
    `Run \`reggie context ${slug}\` first and read all of it.`,
    "This is a discussion only: do not edit any file, do not write or update a plan, and do not start the work.",
    "Answer my questions, lay out the options with their trade-offs, and say plainly what you are unsure about.",
    "If we settle something worth keeping, offer to capture it with `reggie capture` or to add a note, and do it only if I say yes.",
  ].join(" ");
}

/** The Codex form of /reggie-triage: shaping, not planning, over one or more slugs. */
function triagePrompt(slugs: readonly string[]): string {
  const list = slugs.join(", ");
  return [
    `Shape these Reggie tasks into briefs: ${list}.`,
    "For each one, run `reggie context <slug>` and read it, then `reggie triage <slug>` to scaffold `.reggie/tasks/<slug>/brief.md`.",
    "Work from the intake line, the notes, and the graph rather than reading much code; a brief is cheap on purpose.",
    "Fill every section (Problem, Why now, Suspected area, Open questions, Not this) and set area, size, and priority in the front matter.",
    "Keep it short and in plain English. This is shaping, not planning: no implementation approach and no file-by-file design.",
    "Anything you cannot answer becomes an Open question.",
    "Run `reggie brief lint <slug>` and fix every error.",
    "When you are done, write one journal entry with `reggie journal add --stage triage` and say which ones you were least sure about.",
  ].join(" ");
}

/** The Codex form of /reggie-plan. Same contract, same CLI verbs, no slash command. */
function planPrompt(slug: string): string {
  return [
    `Plan the Reggie task \`${slug}\`.`,
    `Run \`reggie context ${slug}\` and read all of it, then \`reggie plan new ${slug}\` if no plan exists yet.`,
    "Explore the code read-only. Ask me every question whose answer would change the approach; if I am not available, answer it yourself and record it under Assumptions.",
    `Write the plan into \`.reggie/tasks/${slug}/plan.md\`, filling every section.`,
    "Each acceptance criterion must be a statement a reviewer can check without asking, and each needs a line in Verification strategy naming the evidence that will prove it.",
    `Run \`reggie plan risk ${slug}\`, then \`reggie plan lint ${slug}\`, and fix every error.`,
    "Do not start the implementation.",
    `Finish with one journal entry: \`reggie journal add --slug ${slug} --stage plan\`.`,
  ].join(" ");
}

/** The Codex form of /reggie-execute. */
function implementPrompt(slug: string): string {
  return [
    `Implement the Reggie task \`${slug}\`.`,
    `Run \`reggie context ${slug}\` and read the plan and the notes it points at, then \`reggie claim ${slug}\` to start the task branch.`,
    "Execute the plan. You may deviate, but record every deviation and its reason for the packet.",
    `Produce the evidence named in the plan under Verification strategy and save it under \`.reggie/tasks/${slug}/evidence/\`; never claim a test passed without its output saved.`,
    "After each file change, add or correct the note for that file. After each step, write one journal entry with `--stage execute`.",
    "Capture unrelated problems with `reggie capture` instead of fixing them.",
    `Finish with \`reggie packet ${slug}\`, fill every section honestly, and commit.`,
  ].join(" ");
}

/** Claude Code drives these through the project commands `onboard` installs. */
function claudeArgument(mode: LaunchMode, slugs: [string, ...string[]]): string {
  switch (mode) {
    case "chat":
      return chatPrompt(slugs[0]);
    case "triage":
      return `/reggie-triage ${slugs.join(" ")}`;
    case "plan":
      return `/reggie-plan ${slugs[0]}`;
    case "implement":
      return `/reggie-execute ${slugs[0]}`;
  }
}

/** Codex has no slash commands, so the same work is spelled out inline. */
function codexArgument(mode: LaunchMode, slugs: [string, ...string[]]): string {
  switch (mode) {
    case "chat":
      return chatPrompt(slugs[0]);
    case "triage":
      return triagePrompt(slugs);
    case "plan":
      return planPrompt(slugs[0]);
    case "implement":
      return implementPrompt(slugs[0]);
  }
}

function describe(tool: LaunchTool, mode: LaunchMode, slugs: [string, ...string[]]): string {
  const label = TOOL_LABEL[tool];
  switch (mode) {
    case "chat":
      return `Discuss ${slugs[0]} in ${label}, read-only: no edits, no plan, no work`;
    case "triage":
      return slugs.length === 1
        ? `Shape ${slugs[0]} into a brief in ${label}`
        : `Shape ${slugs.length} tasks into briefs in ${label}: ${slugs.join(", ")}`;
    case "plan":
      return `Plan ${slugs[0]} in ${label}, against the plan contract`;
    case "implement":
      return `Implement ${slugs[0]} in ${label}, from its plan to a completion packet`;
  }
}

/**
 * The command for a session, with no side effects, so a page can show it, copy it, or
 * hand it to launchSession. Throws on any tool, mode, or slug it does not recognise:
 * nothing unvalidated is allowed into a command string.
 */
export function launchCommand(input: LaunchInput): LaunchPlan {
  const tool = assertTool(input.tool);
  const mode = assertMode(input.mode);
  const slugs = assertSlugs(mode, input.slugs);
  if (typeof input.repo !== "string" || input.repo.trim() === "") throw new Error("launch needs the repository directory.");
  const argv = [tool, tool === "claude" ? claudeArgument(mode, slugs) : codexArgument(mode, slugs)];
  return {
    command: argv.map(shellQuote).join(" "),
    cwd: path.resolve(input.repo),
    description: describe(tool, mode, slugs),
    argv,
  };
}

/**
 * Start the session in a new terminal window. macOS only: elsewhere the command comes
 * back unlaunched with the reason, so the caller can show it to copy. osascript is spawned
 * with an argument vector, never a shell string, and the script it runs is built from
 * validated slugs and a quoted repo path.
 */
/** How long to wait for Terminal before giving up and handing the command back to the caller. */
export const LAUNCH_TIMEOUT_MS = 8000;

export function launchSession(input: LaunchInput): LaunchResult {
  const plan = launchCommand(input);
  if (!existsSync(plan.cwd) || !statSync(plan.cwd).isDirectory()) {
    throw new Error(`${plan.cwd} is not a directory; there is nowhere to start the session.`);
  }
  if (process.platform !== "darwin") {
    return {
      launched: false,
      command: plan.command,
      reason: `Reggie can only open a terminal window on macOS, and this is ${process.platform}. Run the command yourself in ${plan.cwd}.`,
    };
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
      launched: false,
      command: plan.command,
      reason: `Terminal did not respond within ${Math.round(LAUNCH_TIMEOUT_MS / 1000)} seconds. macOS may be waiting for you to allow Reggie to control Terminal (System Settings, Privacy & Security, Automation). Run the command yourself in ${plan.cwd}.`,
    };
  }
  if (!r.ok) {
    const detail = (r.stderr || r.stdout).trim();
    return { launched: false, command: plan.command, reason: `Terminal did not start the session${detail ? `: ${detail}` : "."}` };
  }
  return { launched: true, command: plan.command };
}
