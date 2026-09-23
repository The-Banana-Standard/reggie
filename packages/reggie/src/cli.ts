#!/usr/bin/env node
import { existsSync } from "node:fs";
import path from "node:path";
import { Command } from "commander";
import { lintBrief, parseBrief, PRIORITIES, SIZES, type Priority, type Size } from "./brief.js";
import { buildState, checkBuild, packageRoot } from "./build-state.js";
import { capture, removeFromIntake, resolveCaptureOrigin, resolvePackPaths } from "./capture.js";
import { CheckError, evidencePath, readChecks, recordCheck } from "./checks.js";
import { claimTask, releaseTask } from "./claim.js";
import { pendingSetup, type DepsOutcome } from "./deps.js";
import { buildContext } from "./context.js";
import { checkComposedFile, checkGeneratedBlock, composeAgentsMd, curatedSections, renderGeneratedBlock } from "./docs.js";
import { DeriveError, deriveJournal, realRewriteRunner, type DeriveInput } from "./derive.js";
import { collectFacts } from "./facts.js";
import { detectFlows, MAX_FLOW_HOPS, traceFlow } from "./flows.js";
import { flowTraceLines } from "./flow-output.js";
import { buildGraph, type RepoGraph } from "./graph.js";
import { createIssue, createPullRequest, ghAvailable } from "./gh.js";
import { currentBranch, defaultBranch, git, resolveCommit } from "./git.js";
import { appendJournal, detectTool, readJournal, renderJournalEntry, sessionName } from "./journal.js";
import { buildKnowledgeInventory, buildRepositorySemanticIndex, createKnowledgeJob, listKnowledgeJobs, previewKnowledgeJob, readKnowledgeJob, runKnowledgeJob, type KnowledgePreview } from "./knowledge-jobs.js";
import { readKnowledge, renderKnowledgeRecord, setKnowledgeRetired, type KnowledgeActor } from "./knowledge.js";
import { contextFileRel, isLaunchMode, isLaunchTool, LAUNCH_MODES, LAUNCH_TOOLS, launchCommand, launchSession, MAX_LAUNCH_PATHS, mintSession, recordLaunch, resolveGoal, writeContextPacks, type LaunchGoal, type LaunchInput, type LaunchTask } from "./launch.js";
import { startMcpServer } from "./mcp.js";
import { startServer } from "./serve.js";
import { detectServices, type ServiceNode } from "./services.js";
import { addNote, findNotes, NOTE_TYPES, notesForPath, renderNoteFile, staleEntries, type Confidence, type NoteType } from "./notes.js";
import { onboard, refreshDocs, repositoryKnowledgeForDocs } from "./onboard.js";
import { defaultClaudeHome } from "./transcript.js";
import { landTask, type LandResult } from "./land.js";
import { assertTaskCheckout, decidePacket, evidenceGate, lintPacket, PacketError, renderChecklist, scaffoldPacket, type PacketResult } from "./packet.js";
import { briefFile, checksFile, findRepoRoot, packetFile, planFile, repoPaths, type RepoPaths } from "./paths.js";
import { evaluateCompletion, formatReport } from "./policy.js";
import { currentPerson, loadConfig, loadPeople, type Person, type ReggieConfig } from "./people.js";
import { lintPlan, parsePlan, planCriteria, renderPlanTemplate, riskFromFiles, RISKS, setPlanRisk, type Risk } from "./plan.js";
import { getTask, listTasks, readIntake, renderTaskLine, STATE_MACHINE, stateDefinition, type TaskInfo, type TaskState } from "./tasks.js";
import { isPriority, isSize, scaffoldBrief, type TriageInput } from "./triage.js";
import { isSafeSlug, parseIntOption, readText, slugify, uniq, writeIfMissing, writeText } from "./util.js";
import { autoDetectWorkspace, discoverWorkspace, type Workspace } from "./workspace.js";

const VERSION = "3.0.0-alpha.1";

interface Ctx {
  root: string;
  paths: RepoPaths;
  config: ReggieConfig;
  person: Person;
}

function ctx(rootOpt?: string): Ctx {
  const root = findRepoRoot(rootOpt ? path.resolve(rootOpt) : process.cwd());
  const paths = repoPaths(root);
  const config = loadConfig(paths);
  const person = currentPerson(root, loadPeople(paths));
  return { root, paths, config, person };
}

/** Commander collector for repeatable, comma-separated list options. */
function collectList(value: string, previous: string[]): string[] {
  return previous.concat(value.split(",").map((v) => v.trim()).filter(Boolean));
}

function requireSlug(slug: string): string {
  const s = slug.trim();
  if (!isSafeSlug(s)) throw new Error(`"${slug}" is not a valid slug. Use lowercase letters, digits, and hyphens.`);
  return s;
}

function out(line: string): void {
  process.stdout.write(`${line}\n`);
}

function fail(message: string): never {
  process.stderr.write(`reggie: ${message}\n`);
  process.exit(1);
}

function knowledgeActor(): KnowledgeActor {
  const tool = detectTool();
  return tool === "claude" || tool === "codex" ? tool : "human";
}

function printKnowledgePreview(preview: KnowledgePreview): void {
  out(`Agent: ${preview.agent}`);
  out(`Scope: ${preview.entities} entities (${preview.newEntities} new, ${preview.staleEntities} stale), ${preview.files} files, ${preview.symbols} symbols, ${preview.expectedChunks} chunks.`);
  out(`Commit: ${preview.commitBehavior}.`);
  for (const entity of preview.entityIds) out(`- ${entity}`);
}

const program = new Command();
program
  .name("reggie")
  .description("Reggie: a repo manager for Claude Code and Codex. Tasks, plans, notes, and journals live in the repo; state is read from git.")
  .version(VERSION)
  .option("-C, --root <dir>", "run as if started in <dir>");

/*
 * Refuse to run when `dist/` is behind `src/`. A linked development checkout otherwise runs the
 * previous build in silence, and the symptom — a verb that records less, an endpoint that 404s —
 * reads as a broken feature rather than as an unbuilt one. Every command is gated, reads included,
 * because a stale read is untrustworthy evidence too. `--help` and `--version` exit before this.
 * The MCP server is the exception: it starts and refuses per tool call, where an agent will see it.
 */
program.hook("preAction", (_program, action) => {
  if (action.name() === "mcp" && action.parent === program) return;
  const check = checkBuild(import.meta.url, process.env);
  if (check.verdict === "current") return;
  process.stderr.write(`${check.message}\n\n`);
  if (check.verdict === "stale") process.exit(1);
});

program
  .command("onboard [dir]")
  .alias("init")
  .description("Create .reggie/, generate the CLAUDE.md and AGENTS.md blocks, install project commands, and write the onboarding brief")
  .action((dir?: string) => {
    const rootOpt = program.opts<{ root?: string }>().root;
    const start = dir ? path.resolve(dir) : rootOpt ? path.resolve(rootOpt) : process.cwd();
    const root = findRepoRoot(start);
    const r = onboard(root);
    out(`Onboarded ${r.facts.name} (${r.config.mode} mode) as ${r.person.handle}.`);
    if (r.layout.created.length > 0) out(`Created: ${r.layout.created.join(", ")}`);
    for (const d of r.docs) out(`${d.action}: ${path.relative(root, d.file)}`);
    if (r.commandsInstalled.length > 0) out(`Installed commands: ${r.commandsInstalled.join(", ")}`);
    if (r.mcpConfigured) out("Configured the reggie MCP server in .mcp.json (Claude Code). For Codex: codex mcp add reggie -- reggie mcp");
    if (r.layout.gitignoreUpdated) out("Updated .gitignore (derived caches only).");
    if (r.layout.gitattributesUpdated) out("Updated .gitattributes (journal files union-merge).");
    out("");
    out(`Next: read ${path.relative(root, r.briefFile)} or run /reggie-onboard in Claude Code to write the first real notes.`);
  });

const docs = program.command("docs").description("Generated blocks in CLAUDE.md and AGENTS.md");
docs
  .command("refresh")
  .description("Regenerate the facts block in CLAUDE.md and AGENTS.md")
  .action(() => {
    const c = ctx(program.opts<{ root?: string }>().root);
    const r = refreshDocs(c.root);
    for (const d of r.results) out(`${d.action}: ${path.relative(c.root, d.file)}`);
  });
docs
  .command("check")
  .description("Exit 1 when a generated block is missing or stale (for CI)")
  .action(() => {
    const c = ctx(program.opts<{ root?: string }>().root);
    const facts = collectFacts(c.root);
    // AGENTS.md is composed whole from CLAUDE.md's curated half, so checking only its generated
    // block would miss the drift that matters most: rules Codex never gets to read.
    const curated = curatedSections(readText(c.paths.claudeMd) ?? "");
    const knowledge = repositoryKnowledgeForDocs(c.paths);
    const results = [
      checkGeneratedBlock(c.paths.claudeMd, renderGeneratedBlock(facts, c.config, "claude", knowledge)),
      checkComposedFile(c.paths.agentsMd, composeAgentsMd(facts.name, curated, renderGeneratedBlock(facts, c.config, "codex", knowledge))),
    ];
    let bad = false;
    for (const r of results) {
      out(`${r.status}: ${path.relative(c.root, r.file)}`);
      if (r.status !== "fresh") bad = true;
    }
    if (bad) fail("generated blocks are stale or missing; run `reggie docs refresh`");
  });

program
  .command("capture <text...>")
  .description("Add a raw item to .reggie/intake.md")
  .option("--detail <text>", "extra detail lines")
  .option("--slug <slug>", "choose the slug instead of deriving it")
  .option("--path <path>", "the file or folder the idea came from, written under the item as its last detail line")
  .option("--issue", "also open a GitHub issue with gh")
  .action((words: string[], opts: { detail?: string; slug?: string; path?: string; issue?: boolean }) => {
    const c = ctx(program.opts<{ root?: string }>().root);
    const input: Parameters<typeof capture>[1] = { text: words.join(" "), person: c.person, source: "cli" };
    if (opts.detail) input.detail = opts.detail;
    if (opts.slug) input.slug = opts.slug;
    // `--path ""` is a path too: the resolver refuses it with a sentence rather than the option being dropped.
    if (opts.path !== undefined) {
      try {
        input.origin = resolveCaptureOrigin(c.paths, { path: opts.path });
      } catch (err) {
        return fail(err instanceof Error ? err.message : "bad path");
      }
    }
    const r = capture(c.paths, input);
    out(`Captured ${r.slug}`);
    if (opts.issue) {
      if (!ghAvailable()) fail("gh is not installed or not authenticated");
      const url = createIssue(c.root, words.join(" "), `Captured by reggie as \`${r.slug}\`.\n\n${opts.detail ?? ""}`);
      out(`Issue: ${url}`);
    }
  });

program
  .command("triage [slug]")
  .description("Shape a captured item into a brief: scaffold .reggie/tasks/<slug>/brief.md from the intake line and remove the line, leaving the task ungroomed until the scaffold is filled in")
  .option("--all", "shape every ungroomed task, one brief each")
  .option("--title <title>", "override the intake line as the title")
  .option("--area <dir>", "repo-relative directory the work probably touches")
  .option("--size <size>", `one of ${SIZES.join(", ")}`)
  .option("--priority <priority>", `one of ${PRIORITIES.join(", ")}`)
  .option("--force", "rewrite a brief that already exists, discarding what it says")
  .action((slug: string | undefined, opts: { all?: boolean; title?: string; area?: string; size?: string; priority?: string; force?: boolean }) => {
    const c = ctx(program.opts<{ root?: string }>().root);
    if (opts.all && slug) fail("pass a slug or --all, not both");
    if (!opts.all && !slug) fail("triage needs a slug, or --all to shape every ungroomed task");
    if (opts.all && (opts.title || opts.area)) fail("--title and --area shape one task; drop them, or name a single slug");
    if (opts.size !== undefined && !isSize(opts.size)) fail(`--size must be one of ${SIZES.join(", ")}`);
    if (opts.priority !== undefined && !isPriority(opts.priority)) fail(`--priority must be one of ${PRIORITIES.join(", ")}`);

    // An ungroomed task can already have a brief now — an unfilled scaffold keeps it in this
    // column — and scaffolding over it would only print "already exists" forever. Those need a
    // session, not another template, so they are named at the end instead of retried.
    const ungroomedTasks = opts.all ? listTasks(c.paths, c.config).filter((t) => t.state === "ungroomed") : [];
    const drafts = ungroomedTasks.filter((t) => t.brief?.exists).map((t) => t.slug);
    const slugs = opts.all ? ungroomedTasks.filter((t) => !t.brief?.exists).map((t) => t.slug) : [requireSlug(slug ?? "")];
    if (slugs.length === 0 && drafts.length === 0) return out("Nothing is ungroomed. Capture something first: reggie capture \"...\"");

    let written = 0;
    let taken = 0;
    for (const s of slugs) {
      const input: TriageInput = { slug: s, author: c.person.handle };
      if (opts.title !== undefined) input.title = opts.title;
      if (opts.area !== undefined) input.area = opts.area;
      if (opts.size !== undefined) input.size = opts.size as Size;
      if (opts.priority !== undefined) input.priority = opts.priority as Priority;
      if (opts.force) input.force = true;
      const r = scaffoldBrief(c.paths, input);
      const rel = path.relative(c.root, r.file);
      if (r.skipped) out(`${rel} already exists; pass --force to rewrite it`);
      else {
        written += 1;
        taken += r.intakeRemoved;
        out(`${r.created ? "Created" : "Rewrote"} ${rel}${r.intakeRemoved ? ` and took ${r.intakeRemoved === 1 ? "its intake line" : `its ${r.intakeRemoved} intake lines`}` : ""}`);
      }
    }
    if (written === 0 && drafts.length === 0) return;
    out("");
    if (written > 0) {
      if (taken > 0) out(`The brief is the record now: ${taken === 1 ? "that line is" : "those lines are"} out of intake, and the task stays ungroomed until the scaffold is filled in.`);
      out(`Fill every section, then: reggie brief lint ${slugs.length === 1 ? slugs[0] : "<slug>"}`);
    }
    const toShape = [...slugs, ...drafts];
    if (drafts.length > 0) {
      out(`${drafts.length === 1 ? "One brief is" : `${drafts.length} briefs are`} already scaffolded and still unfilled, so ${drafts.length === 1 ? "it needs" : "they need"} a session rather than another template: ${drafts.join(" ")}`);
    }
    out(`Shape ${toShape.length === 1 ? "it" : "them"} in a session: reggie launch ${toShape.join(" ")} --run`);
  });

/** The board order the tasks page reads in: what is moving first, what has not started last. */
const BOARD_ORDER: TaskState[] = ["awaiting-decision", "in-process", "planned", "groomed", "ungroomed", "done"];

function stateLabel(state: TaskState): string {
  return STATE_MACHINE.states.find((s) => s.id === state)?.label ?? state;
}

/** The brief's shaping decisions, as a chip group; empty until triage has made them. */
function shapeChips(t: TaskInfo): string {
  const bits: string[] = [];
  if (t.brief && t.brief.priority !== "unset") bits.push(t.brief.priority);
  if (t.brief && t.brief.size !== "unset") bits.push(t.brief.size);
  if (t.risk !== "unset") bits.push(`${t.risk} risk`);
  if (t.brief?.area) bits.push(t.brief.area);
  return bits.length > 0 ? ` [${bits.join(" · ")}]` : "";
}

/** One task under its state heading, so the state is named once per group instead of per line. */
function boardLine(t: TaskInfo): string {
  const who = t.owner ? ` · ${t.owner}` : "";
  const when = t.lastActivity ? ` · ${t.lastActivity.slice(0, 10)}` : "";
  return `  ${t.slug}${shapeChips(t)}${who}${when}\n    ${t.title || t.slug}${t.reason ? ` (${t.reason})` : ""}`;
}

program
  .command("tasks")
  .description("List tasks by state, each state derived from git")
  .option("--all", "include done tasks")
  .option("--json", "machine-readable output")
  .action((opts: { all?: boolean; json?: boolean }) => {
    const c = ctx(program.opts<{ root?: string }>().root);
    const tasks = listTasks(c.paths, c.config, { includeDone: Boolean(opts.all) });
    if (opts.json) return out(JSON.stringify(tasks, null, 2));
    if (tasks.length === 0) return out("No tasks. Capture one: reggie capture \"...\"");
    let first = true;
    for (const state of BOARD_ORDER) {
      const group = tasks.filter((t) => t.state === state);
      if (group.length === 0) continue;
      if (!first) out("");
      first = false;
      out(`${stateLabel(state)} (${group.length}) — ${stateDefinition(state)}`);
      for (const t of group) out(boardLine(t));
    }
    // The Ungroomed column now holds two different kinds of work, and they need different verbs:
    // a raw line wants a scaffold, a scaffold nobody has filled in wants a session. Both lines
    // print when both exist, and the two counts add up to the column header above.
    const ungroomedTasks = tasks.filter((t) => t.state === "ungroomed");
    const raw = ungroomedTasks.filter((t) => !t.brief?.exists);
    const drafts = ungroomedTasks.filter((t) => t.brief?.exists);
    const groomed = tasks.filter((t) => t.state === "groomed").length;
    out("");
    if (raw.length > 0) out(`${raw.length} ungroomed with no brief yet. Scaffold ${raw.length === 1 ? "it" : "them"}: reggie triage --all`);
    if (drafts.length > 0)
      out(
        `${drafts.length} ungroomed with a brief nobody has filled in. Shape ${drafts.length === 1 ? "it" : "them"} in a session: reggie launch ${drafts.map((t) => t.slug).join(" ")} --run`,
      );
    if (ungroomedTasks.length > 0) return;
    if (groomed > 0) out(`${groomed} groomed and unplanned. Plan one: reggie launch <slug> --run`);
    else out("Nothing is waiting to be shaped.");
  });

program
  .command("task <slug>")
  .description("Show one task with its plan")
  .option("--json", "machine-readable output")
  .action((slug: string, opts: { json?: boolean }) => {
    const c = ctx(program.opts<{ root?: string }>().root);
    const t = getTask(c.paths, c.config, requireSlug(slug));
    if (opts.json) return out(JSON.stringify(t, null, 2));
    out(renderTaskLine(t));
    out(`branch: ${t.branch ?? "-"}   pr: ${t.pr ? `#${t.pr.number} ${t.pr.state} ${t.pr.url}` : "-"}   plan lint: ${t.planLintOk === null ? "no plan" : t.planLintOk ? "passes" : "fails"}`);
    const plan = readText(planFile(c.paths, t.slug));
    if (plan) out(`\n${plan}`);
  });

program
  .command("status")
  .description("Who is working on what right now")
  .action(() => {
    const c = ctx(program.opts<{ root?: string }>().root);
    const tasks = listTasks(c.paths, c.config).filter((t) => t.state === "in-process" || t.state === "awaiting-decision" || t.state === "planned" || t.state === "groomed");
    if (tasks.length === 0) return out("Nobody has an active claim.");
    for (const t of tasks) out(`${t.owner ?? "?"}  ${t.state.padEnd(17)} ${t.slug}  ${t.branch ?? ""}  ${t.lastActivity ? `last activity ${t.lastActivity.slice(0, 16)}` : ""}`);
  });

const plan = program.command("plan").description("Plans and the plan contract");
plan
  .command("new <slug>")
  .description("Scaffold .reggie/tasks/<slug>/plan.md from the contract template")
  .option("--title <title>")
  .option("--problem <text>")
  .option("--files <list>", "comma-separated files to touch")
  .option("--risk <risk>", "low, medium, or high")
  .action((slug: string, opts: { title?: string; problem?: string; files?: string; risk?: string }) => {
    const c = ctx(program.opts<{ root?: string }>().root);
    const s = requireSlug(slug);
    const file = planFile(c.paths, s);
    const intakeItem = readIntake(c.paths).find((i) => i.slug === s);
    const input: Parameters<typeof renderPlanTemplate>[0] = { slug: s, title: opts.title ?? intakeItem?.text ?? s, author: c.person.handle };
    if (opts.problem) input.problem = opts.problem;
    else if (intakeItem) input.problem = [intakeItem.text, ...intakeItem.detail].join("\n");
    if (opts.files) input.files = opts.files.split(",").map((f) => f.trim()).filter(Boolean);
    if (opts.risk) {
      if (!(RISKS as string[]).includes(opts.risk)) fail("risk must be low, medium, or high");
      input.risk = opts.risk as Risk;
    }
    if (!writeIfMissing(file, renderPlanTemplate(input))) return out(`${path.relative(c.root, file)} already exists`);
    out(`Created ${path.relative(c.root, file)}. Fill it in plan mode, then: reggie plan risk ${s} && reggie plan lint ${s}`);
  });
plan
  .command("lint <slug>")
  .description("Check a plan against the contract; exit 1 on errors")
  .action((slug: string) => {
    const c = ctx(program.opts<{ root?: string }>().root);
    const content = readText(planFile(c.paths, requireSlug(slug)));
    if (!content) fail(`no plan for ${slug}`);
    const r = lintPlan(content);
    for (const e of r.errors) out(`error: ${e}`);
    for (const w of r.warnings) out(`warning: ${w}`);
    out(r.ok ? "PASS" : "FAIL");
    if (!r.ok) process.exit(1);
  });
plan
  .command("risk <slug>")
  .description("Compute the risk class from the files the plan touches and write it into the plan")
  .action((slug: string) => {
    const c = ctx(program.opts<{ root?: string }>().root);
    const file = planFile(c.paths, requireSlug(slug));
    const content = readText(file);
    if (!content) fail(`no plan for ${slug}`);
    const parsed = parsePlan(content);
    const risk = riskFromFiles(parsed.files, c.config.risk);
    writeText(file, setPlanRisk(content, risk));
    out(`${slug}: risk ${risk} (${parsed.files.length} files)`);
  });
plan
  .command("prompt <slug>")
  .description("Print the planning prompt and the exact commands to run it in Claude Code or Codex, interactively or headless")
  .action((slug: string) => {
    const c = ctx(program.opts<{ root?: string }>().root);
    const s = requireSlug(slug);
    const prompt = planningPrompt(c, s);
    out(prompt);
    out("");
    out("Interactive (Claude Code):  /reggie-plan " + s);
    out("Interactive (Codex):        codex, then paste the prompt above and stay read-only until the plan is written");
    out(`Headless (Claude Code):     claude -p --permission-mode plan "$(reggie plan prompt ${s} | sed -n '1,/^---END PROMPT---$/p')" > .reggie/tasks/${s}/plan.md`);
    out(`Headless (Codex):           codex exec -s read-only --output-last-message .reggie/tasks/${s}/plan.md "$(reggie plan prompt ${s} | sed -n '1,/^---END PROMPT---$/p')"`);
    out(`Then:                       reggie plan risk ${s} && reggie plan lint ${s}`);
  });
plan
  .command("done <slug>")
  .description("Sweep an intake line that outlived its brief; triage removes the line itself now")
  .action((slug: string) => {
    const c = ctx(program.opts<{ root?: string }>().root);
    out(removeFromIntake(c.paths, requireSlug(slug)) ? `Removed ${slug} from intake` : `${slug} was not in intake`);
  });

const brief = program.command("brief").description("Briefs: what a task is, decided before how to do it");
brief
  .command("lint <slug>")
  .description("Check a brief against its contract; exit 1 on errors")
  .action((slug: string) => {
    const c = ctx(program.opts<{ root?: string }>().root);
    const s = requireSlug(slug);
    const content = readText(briefFile(c.paths, s));
    if (!content) fail(`no brief for ${s}; write one: reggie triage ${s}`);
    const r = lintBrief(content);
    for (const e of r.errors) out(`error: ${e}`);
    for (const w of r.warnings) out(`warning: ${w}`);
    out(r.ok ? "PASS" : "FAIL");
    if (!r.ok) process.exit(1);
  });
brief
  .command("show <slug>")
  .description("Print a task's brief")
  .action((slug: string) => {
    const c = ctx(program.opts<{ root?: string }>().root);
    const s = requireSlug(slug);
    const content = readText(briefFile(c.paths, s));
    if (!content) fail(`no brief for ${s}; write one: reggie triage ${s}`);
    out(content.trimEnd());
  });

program
  .command("launch <slug...>")
  .description("Start a session on a task: discuss (shape, plan or talk it through, in plan mode) or build (claim it, then implement from its worktree). Prints the command; --run opens it in a new terminal window")
  .option("--tool <tool>", `one of ${LAUNCH_TOOLS.join(", ")}`, "claude")
  .option("--mode <mode>", `one of ${LAUNCH_MODES.join(", ")}`, "discuss")
  .option("--note <text>", "a sentence of your own, appended to the prompt")
  .option("--path <paths...>", "files or folders to build the context pack around; the prompt names them")
  .option("--run", "start the session instead of only printing it")
  .action((slugs: string[], opts: { tool: string; mode: string; note?: string; path?: string[]; run?: boolean }) => {
    const c = ctx(program.opts<{ root?: string }>().root);
    if (!isLaunchTool(opts.tool)) fail(`--tool must be one of ${LAUNCH_TOOLS.join(", ")}`);
    if (!isLaunchMode(opts.mode)) fail(`--mode must be one of ${LAUNCH_MODES.join(", ")}`);
    const known = new Map(listTasks(c.paths, c.config).map((t) => [t.slug, t]));
    const tasks: LaunchTask[] = slugs.map(requireSlug).map((slug) => {
      const t = known.get(slug);
      if (!t) fail(`unknown task: ${slug}`);
      return { slug, state: t.state };
    });
    let goal: LaunchGoal;
    try {
      goal = resolveGoal(opts.mode, tasks);
    } catch (err) {
      return fail(err instanceof Error ? err.message : "cannot launch");
    }
    // Each path is resolved to the file or folder it is before a command is printed or a pack built.
    let packPaths: string[] = [];
    try {
      packPaths = resolvePackPaths(c.paths, opts.path ?? [], MAX_LAUNCH_PATHS);
    } catch (err) {
      return fail(err instanceof Error ? err.message : "bad path");
    }
    const base: LaunchInput = { repo: c.root, tool: opts.tool, mode: opts.mode, tasks };
    if (opts.note) base.note = opts.note;
    if (packPaths.length > 0) base.paths = packPaths;
    if (!opts.run) {
      const session = launchCommand({ ...base, contextFiles: tasks.map((t) => contextFileRel(t.slug)) });
      out(session.description);
      out(`cd ${session.cwd}`);
      out(session.command);
      out(`(the context pack for each task is written to .reggie/.cache/context/<slug>.md when the session is started with --run)`);
      return;
    }
    const session = mintSession(opts.tool);
    let cwd = c.root;
    if (goal === "build") {
      const slug = tasks[0]!.slug;
      // Defer, never install here: a cold `npm ci` is minutes, and the session is meant to open now.
      // The commands it still owes come back in the prompt as its first step.
      const claimed = claimTask(c.paths, c.config, slug, { person: currentPerson(c.root), worktree: true, tool: opts.tool, deps: "defer", ...(session ? { session } : {}) });
      cwd = claimed.worktree ?? c.root;
      base.branch = claimed.branch;
      const setup = pendingSetup(claimed.deps);
      if (setup.length > 0) base.setup = setup;
    }
    base.repo = cwd;
    base.contextFiles = writeContextPacks(c.paths, c.config, cwd, tasks, packPaths);
    if (session) base.session = session;
    const r = launchSession(base);
    out(r.command);
    for (const t of tasks) recordLaunch(c.root, { slug: t.slug, tool: opts.tool, goal, session: r.session, resume: r.resume, cwd: r.cwd });
    if (!r.launched) fail(r.reason ?? "the session did not start");
    out(`Started in a new Terminal window, in ${cwd}${r.resume ? `. Reopen it later with: ${r.resume}` : ""}`);
  });

/**
 * What claim says about one dependency directory. Anything the session still owes ends with the
 * command and the directory to run it in, so a failed claim still leaves a known first step.
 */
function depsLine(o: DepsOutcome): string {
  const run = `run \`${o.command}\` in ${o.dir}`;
  switch (o.status) {
    case "linked":
      return `linked ${o.dir}/node_modules to this checkout`;
    case "installed":
      return `installed dependencies in ${o.dir}`;
    case "present":
      return o.pending ? `${o.reason ?? `${o.dir}/node_modules is out of date`}; left it alone: ${run}` : `${o.dir}/node_modules was already there; left it alone`;
    case "deferred":
      return `dependencies not ready: ${run}`;
    case "failed":
      return o.pending ? `could not install${o.reason ? ` (${o.reason})` : ""}: ${run}` : `cannot install in ${o.dir}${o.reason ? `: ${o.reason}` : ""}`;
  }
}

program
  .command("claim <slug>")
  .description("Start work: create or switch to the task/<slug> branch")
  .option("--worktree", "use a separate worktree under .worktree/<slug>")
  .action((slug: string, opts: { worktree?: boolean }) => {
    const c = ctx(program.opts<{ root?: string }>().root);
    const r = claimTask(c.paths, c.config, requireSlug(slug), { person: c.person, ...(opts.worktree ? { worktree: true } : {}) });
    out(`${r.alreadyExisted ? "Resumed" : "Claimed"} ${slug} on ${r.branch}${r.worktree ? ` in ${r.worktree}` : ""}`);
    for (const o of r.deps) out(depsLine(o));
  });

program
  .command("release <slug>")
  .description("Drop your local claim: delete the local task branch and worktree (refuses others' branches and unmerged work unless --force)")
  .option("--force", "release someone else's branch or discard unmerged commits")
  .action((slug: string, opts: { force?: boolean }) => {
    const c = ctx(program.opts<{ root?: string }>().root);
    for (const a of releaseTask(c.paths, c.config, requireSlug(slug), c.person, { force: Boolean(opts.force) })) out(a);
  });

program
  .command("context [slug]")
  .description("The pack to read before working: notes, plan, related tasks, recent commits, active work, journal")
  .option("-p, --path <paths...>", "files or folders in scope")
  .option("--max-lines <n>", "truncate output", (v) => parseIntOption(v, "--max-lines"))
  .action((slug: string | undefined, opts: { path?: string[]; maxLines?: number }) => {
    const c = ctx(program.opts<{ root?: string }>().root);
    const req: Parameters<typeof buildContext>[2] = {};
    if (slug) {
      if (isSafeSlug(slug) && (existsSync(planFile(c.paths, slug)) || !existsSync(path.join(c.root, slug)))) req.slug = slug;
      else req.paths = [slug];
    }
    if (opts.path) req.paths = [...(req.paths ?? []), ...opts.path];
    if (opts.maxLines) req.maxLines = opts.maxLines;
    out(buildContext(c.paths, c.config, req));
  });

const note = program.command("note").description("Entity-keyed notes: knowledge arranged like the code");
note
  .command("add <entity> <text...>")
  .description("Add a dated entry for a file, folder, '_repo', or 'store:name' / 'service:name' / 'env:NAME' / 'route:name'")
  .requiredOption("-t, --type <type>", `one of ${NOTE_TYPES.join(", ")}`)
  .option("-c, --confidence <level>", "high, medium, or low", "medium")
  .option("-s, --source <refs>", "comma-separated file:line references or task slugs; repeatable", collectList, [] as string[])
  .action((entity: string, words: string[], opts: { type: string; confidence: string; source: string[] }) => {
    const c = ctx(program.opts<{ root?: string }>().root);
    if (!(NOTE_TYPES as readonly string[]).includes(opts.type)) fail(`type must be one of ${NOTE_TYPES.join(", ")}`);
    if (!["high", "medium", "low"].includes(opts.confidence)) fail("confidence must be high, medium, or low");
    const tool = detectTool();
    const author = tool === "human" ? c.person.handle : `${tool === "claude" ? "Claude" : tool === "codex" ? "Codex" : tool} via ${c.person.handle}`;
    const r = addNote(c.paths, entity, { type: opts.type as NoteType, text: words.join(" "), author, confidence: opts.confidence as Confidence, sources: opts.source });
    out(`${r.created ? "Created" : "Updated"} ${path.relative(c.root, r.target.file)} (${r.entry.type})`);
  });
note
  .command("find [query]")
  .description("Find notes whose entity contains the query; no query lists all")
  .action((query?: string) => {
    const c = ctx(program.opts<{ root?: string }>().root);
    const notes = findNotes(c.paths, query ?? "");
    if (notes.length === 0) return out("No notes yet.");
    const stale = new Set(staleEntries(c.paths).map((s) => `${s.entity}|${s.entry.date}|${s.entry.type}`));
    out(notes.map((n) => {
      const record = readKnowledge(c.paths, n.entity);
      return record ? renderKnowledgeRecord(record, { markStale: stale }) : renderNoteFile(n, { markStale: stale });
    }).join("\n\n"));
  });
note
  .command("path <file>")
  .description("The chain to read before editing a file: repo note, folder notes, file note")
  .action((file: string) => {
    const c = ctx(program.opts<{ root?: string }>().root);
    const chain = notesForPath(c.paths, file);
    if (chain.length === 0) return out(`No notes on the way to ${file}. Write the first one: reggie note add ${file} --type how "..."`);
    out(chain.map((n) => {
      const record = readKnowledge(c.paths, n.entity);
      return record ? renderKnowledgeRecord(record) : renderNoteFile(n);
    }).join("\n\n"));
  });
note
  .command("stale")
  .description("Entries whose code changed after the entry was written")
  .action(() => {
    const c = ctx(program.opts<{ root?: string }>().root);
    const stale = staleEntries(c.paths);
    if (stale.length === 0) return out("No stale notes.");
    for (const s of stale) out(`${s.entity}: ${s.entry.type} from ${s.entry.date} by ${s.entry.author}; code changed ${s.codeChanged}`);
  });
note
  .command("retire <entity>")
  .description("Retire a note from ordinary narration while retaining its current text and history")
  .requiredOption("--revision <token>", "the revision returned by knowledge show")
  .requiredOption("--reason <text>", "why this note is retired")
  .option("--superseded-by <entity>", "the entity that replaces it")
  .action((entity: string, opts: { revision: string; reason: string; supersededBy?: string }) => {
    const c = ctx(program.opts<{ root?: string }>().root);
    const result = setKnowledgeRetired(c.paths, c.config, {
      entity,
      expectedRevision: opts.revision,
      retired: true,
      supersededBy: opts.supersededBy ?? null,
      actor: knowledgeActor(),
      by: c.person.handle,
      codeRevision: git(["rev-parse", "HEAD"], { cwd: c.root }).stdout.trim(),
      reason: opts.reason,
    });
    out(`Retired ${result.records[0]?.entity ?? entity} in knowledge-only commit ${result.commit}.`);
  });

const knowledge = program.command("knowledge").description("Shared current understanding and guarded local-agent generation");
knowledge
  .command("show <entity>")
  .description("Show current understanding, dated notes, revision, staleness metadata, and optional update history")
  .option("--history", "include immutable update history")
  .option("--json", "print the record as JSON")
  .action((entity: string, opts: { history?: boolean; json?: boolean }) => {
    const c = ctx(program.opts<{ root?: string }>().root);
    const index = buildRepositorySemanticIndex(c.paths);
    const inventory = buildKnowledgeInventory(c.paths, index).find((item) => item.entity === entity);
    const record = readKnowledge(c.paths, entity, inventory?.fingerprint ?? null);
    if (!record) return out(`No knowledge exists for ${entity}.`);
    out(opts.json ? JSON.stringify(record, null, 2) : renderKnowledgeRecord(record, opts.history ? { includeHistory: true } : {}));
  });
knowledge
  .command("preview [entities...]")
  .description("Show generation scope without creating or running a job")
  .option("--agent <agent>", "codex or claude")
  .option("--all", "include fresh entities as well as new and stale ones")
  .action((entities: string[], opts: { agent?: string; all?: boolean }) => {
    const c = ctx(program.opts<{ root?: string }>().root);
    if (opts.agent && opts.agent !== "codex" && opts.agent !== "claude") fail("agent must be codex or claude");
    const scoped = previewKnowledgeJob(c.paths, buildRepositorySemanticIndex(c.paths), {
      ...(opts.agent ? { agent: opts.agent as "codex" | "claude" } : {}),
      ...(entities.length > 0 ? { entities } : {}),
      ...(opts.all ? { force: true } : {}),
    });
    printKnowledgePreview(scoped.preview);
  });

function createKnowledgeFromCli(entities: string[], opts: { agent?: string; all?: boolean }): void {
  const c = ctx(program.opts<{ root?: string }>().root);
  if (opts.agent && opts.agent !== "codex" && opts.agent !== "claude") fail("agent must be codex or claude");
  const job = createKnowledgeJob(c.paths, buildRepositorySemanticIndex(c.paths), {
    ...(opts.agent ? { agent: opts.agent as "codex" | "claude" } : {}),
    ...(entities.length > 0 ? { entities } : {}),
    ...(opts.all ? { force: true } : {}),
  });
  printKnowledgePreview(job.preview);
  out(`Job ${job.id} is waiting for confirmation. Review the scope above, then run: reggie knowledge run ${job.id} --confirm`);
}

knowledge
  .command("generate [entities...]")
  .description("Create a batch job and show its scope; a separate confirmation runs it")
  .option("--agent <agent>", "codex or claude")
  .option("--all", "include fresh entities as well as new and stale ones")
  .action(createKnowledgeFromCli);
knowledge
  .command("refresh <entities...>")
  .description("Create an incremental refresh job for explicit entities")
  .option("--agent <agent>", "codex or claude")
  .action((entities: string[], opts: { agent?: string }) => createKnowledgeFromCli(entities, opts));
knowledge
  .command("run <job>")
  .description("Confirm and run a previewed job, or resume one that was already confirmed")
  .option("--confirm", "confirm the previewed scope once")
  .action((id: string, opts: { confirm?: boolean }) => {
    const c = ctx(program.opts<{ root?: string }>().root);
    const result = runKnowledgeJob(c.paths, c.config, buildRepositorySemanticIndex(c.paths), id, { ...(opts.confirm ? { confirm: true } : {}) });
    out(`Job ${id}: ${result.status}; ${result.completedChunks}/${result.chunks.length} chunks; ${result.failures.length} failures.`);
    if (result.commit) out(`Knowledge-only commit: ${result.commit}`);
    if (result.status === "failed") fail(result.failures.join("; ") || "knowledge generation failed");
  });
knowledge
  .command("status [job]")
  .description("Show one job or list recent local jobs")
  .option("--json", "print JSON")
  .action((id: string | undefined, opts: { json?: boolean }) => {
    const c = ctx(program.opts<{ root?: string }>().root);
    const jobs = id ? [readKnowledgeJob(c.paths, id)].filter((job): job is NonNullable<typeof job> => job !== null) : listKnowledgeJobs(c.paths);
    if (opts.json) return out(JSON.stringify(id ? (jobs[0] ?? null) : jobs, null, 2));
    if (jobs.length === 0) return out("No local knowledge jobs.");
    for (const job of jobs) out(`${job.id}: ${job.status}; ${job.completedChunks}/${job.chunks.length} chunks; ${job.agent}; ${job.commit ?? "no commit"}`);
  });

const journal = program.command("journal").description("Plain-English record of what happened");
journal
  .command("add <text...>")
  .description("Append an entry to today's journal for you (or the agent acting for you)")
  .option("--slug <slug>")
  .option("--stage <stage>", "plan, execute, review, packet, onboard, ...")
  .option("--evidence <files>", "comma-separated evidence files; repeatable", collectList, [] as string[])
  .option("--session <name>", "journal file suffix; defaults to $REGGIE_SESSION or 'session'")
  .action((words: string[], opts: { slug?: string; stage?: string; evidence: string[]; session?: string }) => {
    const c = ctx(program.opts<{ root?: string }>().root);
    const input: Parameters<typeof appendJournal>[1] = { person: c.person.handle, tool: detectTool(), text: words.join(" ") };
    if (opts.slug) input.slug = opts.slug;
    if (opts.stage) input.stage = opts.stage;
    if (opts.evidence.length > 0) input.evidence = opts.evidence;
    if (opts.session) input.session = opts.session;
    const e = appendJournal(c.paths, input);
    out(`Journaled ${e.date} ${e.time} → ${path.relative(c.root, e.file)}`);
  });
journal
  .command("derive <slug>")
  .description("Write a journal entry from a task's commits and the closing words of its launched Claude sessions; appends what is new, prints all of it, and never commits")
  .option("--session <uuid>", "also read this Claude session's transcript; it must have worked inside this repository")
  .option("--dry-run", "print the entry and the summary, write nothing")
  .option("--rewrite", "off by default: send the entry's text, and nothing else, to the session's own tool (claude -p) for one rewrite per entry; any failure keeps the template")
  .action((slug: string, opts: { session?: string; dryRun?: boolean; rewrite?: boolean }) => {
    const c = ctx(program.opts<{ root?: string }>().root);
    const input: DeriveInput = { slug: requireSlug(slug), claudeHome: defaultClaudeHome(), person: c.person };
    if (opts.session !== undefined) input.session = opts.session;
    if (opts.dryRun) input.dryRun = true;
    if (opts.rewrite) {
      input.rewrite = true;
      input.runner = realRewriteRunner();
    }
    let r: ReturnType<typeof deriveJournal>;
    try {
      r = deriveJournal(c.paths, c.config, input);
    } catch (err) {
      // The summary holds counts only, and it is the last line of output either way.
      if (err instanceof DeriveError && err.summary) out(err.summary);
      return fail(err instanceof Error ? err.message : String(err));
    }
    for (const e of r.entries) {
      out(e.block);
      out("");
      out(
        e.written
          ? `Appended to ${e.file}, which is uncommitted: read it, then commit it. A journal file already tracked on this branch will block the next \`reggie decide\` in this checkout until it is committed, as any hand entry does; a brand-new day file will not, so commit it before you land the task.`
          : `Dry run: this would be appended to ${e.file}. Nothing was written.`,
      );
      out("");
    }
    if (r.message) out(r.message);
    if (r.codexUnread > 0) out(`${r.codexUnread === 1 ? "One Codex session was" : `${r.codexUnread} Codex sessions were`} launched for this task and not read: Reggie does not read Codex transcripts yet.`);
    for (const s of r.sessions) if (s.status === "not-found") out(`Session ${s.id} is recorded for this task, but its transcript is not on this machine.`);
    for (const note of r.notes) out(note);
    if (r.withheld > 0) out(`Withheld ${r.withheld} passage${r.withheld === 1 ? "" : "s"} that looked like a secret, an address or a local path.`);
    out(r.summary);
  });
journal
  .command("show")
  .description("Recent entries, newest first")
  .option("--days <n>", "how far back", (v) => parseIntOption(v, "--days"), 7)
  .option("--slug <slug>")
  .option("--person <handle>")
  .action((opts: { days: number; slug?: string; person?: string }) => {
    const c = ctx(program.opts<{ root?: string }>().root);
    const q: Parameters<typeof readJournal>[1] = { days: opts.days };
    if (opts.slug) q.slug = opts.slug;
    if (opts.person) q.person = opts.person;
    const entries = readJournal(c.paths, q);
    if (entries.length === 0) return out("No journal entries in range.");
    for (const e of entries) out(renderJournalEntry(e));
  });

/** The last line of every `reggie packet` run: in this version the verb writes a file and nothing else. */
const PACKET_DECIDES_NOTHING = "Nothing was decided: in this version the policy's verdict is a report (`reggie check <slug>`), and a person decides with `reggie decide`.";

program
  .command("packet <slug>")
  .description("Scaffold the completion packet, or refresh its checklist from the check records; --lint checks it against the packet contract and the evidence gate. It never decides and never merges")
  .option("--force", "overwrite an existing packet, discarding its contents and verdict")
  .option("--lint", "check the packet against the packet contract and resolve its citations on HEAD; writes nothing")
  .action((slug: string, opts: { force?: boolean; lint?: boolean }) => {
    const c = ctx(program.opts<{ root?: string }>().root);
    const s = requireSlug(slug);
    const rel = path.relative(c.root, packetFile(c.paths, s));
    if (opts.lint) {
      try {
        assertTaskCheckout(c.root, s);
      } catch (err) {
        return fail(err instanceof Error ? err.message : String(err));
      }
      const content = readText(packetFile(c.paths, s));
      if (content === null) fail(`no packet for ${s}; run reggie packet ${s} first`);
      const plan = readText(planFile(c.paths, s));
      const checklist = plan === null ? null : renderChecklist(planCriteria(parsePlan(plan).sections.get("Acceptance criteria") ?? ""), readChecks(readText(checksFile(c.paths, s)) ?? "").records);
      const errors = lintPacket(content, { slug: s, checklist }).errors.map((e) => `error: ${e}`);
      // Citations resolve on a commit, never on a disk. This verb stands in the task's checkout, so it
      // can add the one thing the resolver cannot know: the file is here and was never committed.
      const head = resolveCommit(c.root, "HEAD");
      if (head === null) errors.push("error: this checkout has no commit to resolve citations on");
      else {
        for (const f of evidenceGate(c.root, head, s, content)) {
          const cited = evidencePath(s, f.path);
          const onDisk = f.missing === true && cited.ok && existsSync(path.join(c.root, cited.path));
          errors.push(`error: ${f.path} ${onDisk ? "is on disk but not committed; commit it on the task branch" : f.why}`);
        }
      }
      out(errors.length === 0 ? `PASS: ${rel} satisfies the packet contract, and every citation resolves on HEAD.` : `FAIL: ${rel} does not satisfy the packet contract.`);
      for (const e of errors) out(e);
      out(PACKET_DECIDES_NOTHING);
      if (errors.length > 0) process.exit(1);
      return;
    }
    let r: PacketResult;
    try {
      r = scaffoldPacket(c.paths, c.config, { slug: s, author: c.person.handle, force: Boolean(opts.force) });
    } catch (err) {
      if (err instanceof PacketError) return fail(err.message);
      throw err;
    }
    const said: Record<PacketResult["status"], string> = {
      created: `Created ${rel}. Its checklist is built from the check records: record each criterion with \`reggie check ${s} <criterion> pass --evidence <file>\`, run this again, fill every other section honestly, and commit.`,
      rewrote: `Rewrote ${rel} from scratch.`,
      refreshed: `Refreshed the checklist in ${rel} from the check records; every byte outside the markers is as it was.`,
      current: `The checklist in ${rel} is current; nothing was written.`,
      predates: `${rel} has no generated checklist: it predates check records and was left exactly as it is. Pass --force to regenerate it from scratch.`,
    };
    out(said[r.status]);
    out(PACKET_DECIDES_NOTHING);
  });

program
  .command("check <slug> [args...]")
  .description("Record a verified criterion or review as data, or with no outcome print what the policy would say about the task (a report; a person decides)")
  .option("--review <name>", "record a review (code-review, security-review, ...) instead of a criterion")
  .option("--evidence <files>", "evidence files under the task's evidence folder; comma-separated, repeatable", collectList, [] as string[])
  .option("--note <text>", "one line of context kept with the record")
  .option("--json", "with no outcome: print the report as one JSON object")
  .action((slug: string, args: string[], opts: { review?: string; evidence: string[]; note?: string; json?: boolean }) => {
    const c = ctx(program.opts<{ root?: string }>().root);
    const s = requireSlug(slug);
    if (args.length === 0 && opts.review === undefined) {
      const report = evaluateCompletion(c.root, s);
      out(opts.json ? JSON.stringify(report, null, 2) : formatReport(report));
      if (report.verdict !== "would-pass") process.exit(1);
      return;
    }
    // `check <slug> <criterion> <outcome>`, or `check <slug> --review <name> <outcome>`.
    const [criterion, outcome] = opts.review !== undefined ? [undefined, args[0]] : [args[0], args[1]];
    if (args.length > (opts.review !== undefined ? 1 : 2)) fail("too many arguments: reggie check <slug> <criterion> <pass|fail>, or reggie check <slug> --review <name> <pass|fail>");
    if (outcome === undefined) fail("give the outcome: pass or fail. With no criterion and no outcome, `reggie check <slug>` prints the policy report.");
    try {
      const r = recordCheck(c.paths, {
        slug: s,
        outcome,
        evidence: opts.evidence,
        person: c.person.handle,
        tool: detectTool(),
        session: sessionName(),
        ...(criterion !== undefined ? { criterion } : {}),
        ...(opts.review !== undefined ? { review: opts.review } : {}),
        ...(opts.note !== undefined ? { note: opts.note } : {}),
      });
      const what = r.record.kind === "review" ? `review ${r.record.text}` : `criterion ${r.record.n}`;
      out(`Recorded ${r.record.outcome} for ${what} (${r.record.key}) in ${path.relative(c.root, r.file)}. It is not committed; run \`reggie packet ${s}\` to refresh the checklist, then commit both.`);
    } catch (err) {
      if (err instanceof CheckError) return fail(err.message);
      throw err;
    }
  });

program
  .command("decide <slug> <verdict>")
  .description("Record approved or needs-work on a packet; in solo mode an approval merges task/<slug> (--no-ff) and releases it, never pushing")
  .option("--comment <text>")
  .action((slug: string, verdict: string, opts: { comment?: string }) => {
    const c = ctx(program.opts<{ root?: string }>().root);
    if (verdict !== "approved" && verdict !== "needs-work") fail("verdict must be approved or needs-work");
    const s = requireSlug(slug);
    if (verdict === "approved" && c.config.mode !== "team") {
      let r: LandResult;
      try {
        r = landTask(c.paths, c.config, s, { person: c.person, ...(opts.comment ? { comment: opts.comment } : {}) });
      } catch (err) {
        fail(err instanceof Error ? err.message : String(err));
      }
      out(
        r.merge
          ? `Approved ${s}: merged task/${s} into ${r.base} as ${r.merge.slice(0, 7)}.`
          : `Approved ${s}: task/${s} had already landed${r.existingMerge ? ` in ${r.existingMerge.slice(0, 7)}` : ""}; recorded the verdict as ${r.commit.slice(0, 7)}.`,
      );
      for (const action of r.released) out(`  ${action}`);
      if (r.releaseError) out(`  not released: ${r.releaseError}`);
      if (r.captured.length > 0) out(`  captured from the packet's discovered issues, in the same commit: ${r.captured.join(", ")}`);
      return;
    }
    const file = decidePacket(c.paths, s, verdict, c.person.handle, opts.comment);
    appendJournal(c.paths, { person: c.person.handle, tool: detectTool(), slug, stage: "decide", text: `Decision: ${verdict}.${opts.comment ? ` ${opts.comment}` : ""}` });
    out(`Recorded ${verdict} in ${path.relative(c.root, file)}. Commit it${verdict === "approved" ? " and merge the task branch" : " and send the task back to execute"}.`);
  });

program
  .command("pr <slug>")
  .description("Open a pull request whose body is the completion packet (needs gh)")
  .option("--draft")
  .action((slug: string, opts: { draft?: boolean }) => {
    const c = ctx(program.opts<{ root?: string }>().root);
    const s = requireSlug(slug);
    if (!ghAvailable()) fail("gh is not installed or not authenticated");
    const packet = packetFile(c.paths, s);
    if (!existsSync(packet)) fail(`no packet for ${s}; run reggie packet ${s} first`);
    const base = defaultBranch(c.root, c.config.defaultBranch);
    const head = currentBranch(c.root);
    if (head !== `task/${s}`) fail(`you are on ${head}, not task/${s}`);
    git(["push", "-u", "origin", head], { cwd: c.root });
    const title = parsePlan(readText(planFile(c.paths, s)) ?? "").meta.title || s;
    const url = createPullRequest(c.root, { title: `${s}: ${title}`, bodyFile: packet, base, head, ...(opts.draft ? { draft: true } : {}) });
    out(url);
  });

program
  .command("people")
  .description("Who works here and which mode Reggie is in")
  .action(() => {
    const c = ctx(program.opts<{ root?: string }>().root);
    const people = loadPeople(c.paths);
    out(`mode: ${c.config.mode}`);
    const from = (key: "plans" | "completions"): string => {
      const source = c.config.policySource[key];
      return source === "file" ? "from .reggie/config.yaml" : source === "unreadable" ? `the ${c.config.mode} default; the value in .reggie/config.yaml could not be read` : `the ${c.config.mode} default`;
    };
    out(`policy: plans ${c.config.policy.plans} (${from("plans")}), completions ${c.config.policy.completions} (${from("completions")}). This checkout's copy; the policy report reads the integration branch's committed copy.`);
    for (const p of people.people) out(`- ${p.handle}: ${p.name} <${p.email}> ${p.role}`);
    if (people.people.length === 0) out("(nobody registered yet; run reggie onboard)");
  });

program
  .command("mcp")
  .description("Start the MCP server on stdio (used by Claude Code and Codex)")
  .action(async () => {
    const c = ctx(program.opts<{ root?: string }>().root);
    // The build this process loaded, so an edit or a rebuild during a long session is still caught.
    const builtAt = buildState(packageRoot(import.meta.url)).builtAt;
    await startMcpServer(c.root, { buildCheck: () => checkBuild(import.meta.url, process.env, { builtAt }) });
  });

program
  .command("serve")
  .description("Start a local read-only web view: the repo guidebook, its map, the task board, notes and journal")
  .option("--port <n>", "port to listen on (default: $PORT, else 4310)", (v) => parseIntOption(v, "--port"), process.env.PORT ? parseIntOption(process.env.PORT, "PORT") : 4310)
  .option("--host <host>", "interface to bind; 0.0.0.0 reaches your phone on the same Wi-Fi or tailnet, behind a key", "127.0.0.1")
  .option("--key <key>", "the key a phone must present when --host is not loopback (default: read or minted at .reggie/.cache/serve-key); ignored on a loopback bind")
  .option("--workspace <dir>", "serve every repo listed in the CLAUDE.md of this workspace directory")
  .option("--no-workspace", "serve only this repo, even when a workspace CLAUDE.md names it")
  .action(async (opts: { port: number; host: string; key?: string; workspace?: string | boolean }) => {
    const c = ctx(program.opts<{ root?: string }>().root);
    let workspace: Workspace | null = null;
    if (typeof opts.workspace === "string") {
      const dir = path.resolve(opts.workspace);
      workspace = discoverWorkspace(dir);
      if (!workspace) fail(`No workspace found at ${dir}. Expected a CLAUDE.md there with a "## Repos" section.`);
    } else if (opts.workspace !== false) {
      workspace = autoDetectWorkspace(c.root);
    }
    const server = await startServer(c.paths, c.config, { port: opts.port, host: opts.host, workspace, key: opts.key ?? null });
    if (workspace) {
      out(`Reggie is serving the ${workspace.name} workspace from ${workspace.root}`);
      for (const name of server.repos) out(`  ${name}`);
      for (const s of workspace.skipped) out(`  (skipped ${s.name}: ${s.reason})`);
    } else {
      out(`Reggie is serving ${c.root}`);
      for (const name of server.repos) out(`  ${name}`);
    }
    if (server.key) {
      out(`On this machine: http://127.0.0.1:${server.port}/`);
      for (const a of server.addresses) out(`On your phone (same Wi-Fi or tailnet): http://${a}:${server.port}/?key=${server.key}`);
      if (server.addresses.length === 0) out(`No network address was found to print; the key is ${server.key}`);
      out(opts.key ? "The key came from --key. Open the address once and the page remembers it." : "The key is in .reggie/.cache/serve-key; delete the file to rotate it. Open the address once and the page remembers it.");
      if (c.config.mode === "team") out("Team mode: the page reads from a phone, but writes are refused over the network because the key names no person.");
    } else {
      out(`Open ${server.url}`);
    }
    out("Press Ctrl+C to stop.");
  });

function planningPrompt(c: Ctx, slug: string): string {
  const item = readIntake(c.paths).find((i) => i.slug === slug);
  const briefText = readText(briefFile(c.paths, slug));
  const brief = briefText ? parseBrief(briefText) : null;
  // The brief is the shaped ask; the intake line is only what someone typed before shaping.
  const ask = brief?.problem || (item ? [item.text, ...item.detail].join(" ") : "(no intake line; the user will describe the task)");
  const questions = brief?.questions.length ? ["Open questions the brief left for you to settle with the user:", ...brief.questions.map((q) => `- ${q}`)] : [];
  return [
    `You are planning the task "${slug}" for the repository at ${c.root}.`,
    `${brief ? "The ask, from the brief" : "Intake"}: ${ask}`,
    ...questions,
    "",
    "Work read-only. Explore the code. Then write a plan that satisfies Reggie's plan contract exactly:",
    "front matter with slug, title, risk (low|medium|high), deciders, author, created; then these sections in order:",
    "## Problem, ## Approach, ## Files to touch, ## Acceptance criteria, ## Verification strategy, ## Assumptions, ## Out of scope, ## Bail conditions.",
    "Acceptance criteria are `- [ ]` lines a reviewer can check without asking. Verification strategy names the evidence for each criterion.",
    "Every question you would have asked goes under Assumptions with the answer you chose and the alternative.",
    `Read the context pack first: run \`reggie context ${slug}\` or call the reggie_context MCP tool.`,
    "Output only the plan file content, nothing else.",
    "---END PROMPT---",
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Services and data flow (services-and-flows-spec.md §1–§2)
// ---------------------------------------------------------------------------

/** The graph both detectors read, built once per command. */
function repoGraph(c: Ctx): RepoGraph {
  return buildGraph(c.paths);
}

function serviceLine(node: ServiceNode, files: readonly string[]): string {
  const name = node.binding ?? node.name;
  const named = node.name && node.name !== name ? ` (${node.name})` : "";
  const where = node.declared ? `declared ${node.declaredAt ? `${node.declaredAt.file}:${node.declaredAt.line}` : "somewhere"}` : "UNDECLARED";
  return `  ${name.padEnd(28)} ${node.kind.padEnd(15)} ${where}${named}\n    ${files.length > 0 ? `${files.length} file${files.length === 1 ? "" : "s"}: ${files.slice(0, 4).join(", ")}${files.length > 4 ? ` +${files.length - 4}` : ""}` : "no call site outside tests"}`;
}

program
  .command("services")
  .description("What this repo talks to: bindings, stores and APIs, undeclared ones first")
  .option("--json", "machine-readable output")
  .action((opts: { json?: boolean }) => {
    const c = ctx(program.opts<{ root?: string }>().root);
    const index = detectServices(c.paths, repoGraph(c));
    if (opts.json) return out(JSON.stringify(index, null, 2));
    const files = new Map<string, string[]>();
    for (const e of index.edges) {
      if (e.viaTest) continue;
      const list = files.get(e.service) ?? [];
      if (!list.includes(e.file)) list.push(e.file);
      files.set(e.service, list);
    }
    if (index.services.length === 0) return out("No service found. Reggie reads wrangler.toml, firebase.json, package.json dependencies, env reads and literal fetch hosts.");

    const secrets = index.undeclared.filter((s) => s.kind === "secret");
    if (secrets.length > 0) {
      out(`Undeclared secrets (${secrets.length}) — read in code, declared by no manifest`);
      for (const s of secrets) out(`${serviceLine(s, files.get(s.id) ?? [])}`);
      out("");
    }
    const rest = index.services.filter((s) => !secrets.includes(s));
    out(`Services (${rest.length})`);
    for (const s of rest) out(serviceLine(s, files.get(s.id) ?? []));
    if (index.unused.length > 0) {
      out("");
      out(`Declared and never used (${index.unused.length}): ${index.unused.map((s) => s.binding ?? s.name).join(", ")}`);
    }
    out("");
    out(`${index.services.length} services, ${index.undeclared.length} undeclared, ${index.edges.length} edges. Detail: reggie services --json`);
  });

program
  .command("flows [id]")
  .description("Where data enters and where it goes; with an id, one flow traced step by step")
  .option("--depth <n>", "hops to walk (1-6)", (v) => parseIntOption(v, "--depth"), MAX_FLOW_HOPS)
  .option("--json", "machine-readable output")
  .action((id: string | undefined, opts: { depth: number; json?: boolean }) => {
    const c = ctx(program.opts<{ root?: string }>().root);
    const graph = repoGraph(c);
    const services = detectServices(c.paths, graph).services;
    const depth = Math.max(1, Math.min(MAX_FLOW_HOPS, opts.depth));

    if (!id) {
      const index = detectFlows(c.paths, graph, { services });
      if (opts.json) return out(JSON.stringify(index, null, 2));
      if (index.flows.length === 0) return out("No entry point found. Reggie looks for Cloudflare handlers, Express/Hono routes, Next routes, CLI mains and MCP tools.");
      for (const kind of uniq(index.flows.map((f) => f.kind))) {
        out(`${kind} (${index.flows.filter((f) => f.kind === kind).length})`);
        for (const f of index.flows.filter((f) => f.kind === kind)) {
          const steps = `${f.steps} step${f.steps === 1 ? "" : "s"}`;
          const hops = `${f.depth} hop${f.depth === 1 ? "" : "s"}`;
          out(`  ${f.id}\n    ${f.title} · ${steps} · ${hops}${f.truncated ? " · truncated" : ""} · ${f.services.length > 0 ? f.services.join(", ") : "no service"}`);
        }
      }
      out("");
      return out(`${index.flows.length} entry points. Trace one: reggie flows <id>`);
    }

    const flow = traceFlow(c.paths, graph, id, { depth, services });
    if (opts.json) return out(JSON.stringify(flow, null, 2));
    for (const line of flowTraceLines(flow)) out(line);
  });

program.parseAsync(process.argv).catch((err: unknown) => {
  fail(err instanceof Error ? err.message : String(err));
});

export { slugify };
