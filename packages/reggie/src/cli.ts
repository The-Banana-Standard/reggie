#!/usr/bin/env node
import { existsSync } from "node:fs";
import path from "node:path";
import { Command } from "commander";
import { lintBrief, parseBrief, PRIORITIES, SIZES, type Priority, type Size } from "./brief.js";
import { buildState, checkBuild, packageRoot } from "./build-state.js";
import { capture, removeFromIntake } from "./capture.js";
import { claimTask, releaseTask } from "./claim.js";
import { buildContext } from "./context.js";
import { checkComposedFile, checkGeneratedBlock, composeAgentsMd, curatedSections, renderGeneratedBlock } from "./docs.js";
import { collectFacts } from "./facts.js";
import { detectFlows, MAX_FLOW_HOPS, traceFlow, type Payload } from "./flows.js";
import { buildGraph, type RepoGraph } from "./graph.js";
import { createIssue, createPullRequest, ghAvailable } from "./gh.js";
import { currentBranch, defaultBranch, git } from "./git.js";
import { appendJournal, detectTool, readJournal, renderJournalEntry } from "./journal.js";
import { contextFileRel, isLaunchMode, isLaunchTool, LAUNCH_MODES, LAUNCH_TOOLS, launchCommand, launchSession, mintSession, recordLaunch, resolveGoal, writeContextFile, type LaunchGoal, type LaunchInput, type LaunchTask } from "./launch.js";
import { startMcpServer } from "./mcp.js";
import { startServer } from "./serve.js";
import { detectServices, type ServiceNode } from "./services.js";
import { addNote, findNotes, NOTE_TYPES, notesForPath, renderNoteFile, staleEntries, type Confidence, type NoteType } from "./notes.js";
import { onboard, refreshDocs } from "./onboard.js";
import { landTask, type LandResult } from "./land.js";
import { decidePacket, scaffoldPacket } from "./packet.js";
import { briefFile, findRepoRoot, packetFile, planFile, repoPaths, type RepoPaths } from "./paths.js";
import { currentPerson, loadConfig, loadPeople, type Person, type ReggieConfig } from "./people.js";
import { lintPlan, parsePlan, renderPlanTemplate, riskFromFiles, RISKS, setPlanRisk, type Risk } from "./plan.js";
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
    const results = [
      checkGeneratedBlock(c.paths.claudeMd, renderGeneratedBlock(facts, c.config, "claude")),
      checkComposedFile(c.paths.agentsMd, composeAgentsMd(facts.name, curated, renderGeneratedBlock(facts, c.config, "codex"))),
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
  .option("--issue", "also open a GitHub issue with gh")
  .action((words: string[], opts: { detail?: string; slug?: string; issue?: boolean }) => {
    const c = ctx(program.opts<{ root?: string }>().root);
    const input: Parameters<typeof capture>[1] = { text: words.join(" "), person: c.person, source: "cli" };
    if (opts.detail) input.detail = opts.detail;
    if (opts.slug) input.slug = opts.slug;
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
  .description("Shape a captured item into a brief: scaffold .reggie/tasks/<slug>/brief.md from the intake line (ungroomed → groomed)")
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

    const slugs = opts.all
      ? listTasks(c.paths, c.config).filter((t) => t.state === "ungroomed").map((t) => t.slug)
      : [requireSlug(slug ?? "")];
    if (slugs.length === 0) return out("Nothing is ungroomed. Capture something first: reggie capture \"...\"");

    let written = 0;
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
        out(`${r.created ? "Created" : "Rewrote"} ${rel}`);
      }
    }
    if (written === 0) return;
    out("");
    out(`Fill every section, then: reggie brief lint ${slugs.length === 1 ? slugs[0] : "<slug>"}`);
    out(`Or shape them in a session: reggie launch ${slugs.join(" ")} --run`);
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
    const ungroomed = tasks.filter((t) => t.state === "ungroomed").length;
    const groomed = tasks.filter((t) => t.state === "groomed").length;
    out("");
    if (ungroomed > 0) out(`${ungroomed} ungroomed. Shape ${ungroomed === 1 ? "it into a brief" : "them into briefs"}: reggie triage --all`);
    else if (groomed > 0) out(`${groomed} groomed and unplanned. Plan one: reggie launch <slug> --run`);
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
  .description("Remove the intake line once the plan is written and committed")
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
  .option("--run", "start the session instead of only printing it")
  .action((slugs: string[], opts: { tool: string; mode: string; note?: string; run?: boolean }) => {
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
    const base: LaunchInput = { repo: c.root, tool: opts.tool, mode: opts.mode, tasks };
    if (opts.note) base.note = opts.note;
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
      const claimed = claimTask(c.paths, c.config, slug, { person: currentPerson(c.root), worktree: true, tool: opts.tool, ...(session ? { session } : {}) });
      cwd = claimed.worktree ?? c.root;
      base.branch = claimed.branch;
    }
    base.repo = cwd;
    base.contextFiles = tasks.map((t) => writeContextFile(cwd, t.slug, buildContext(c.paths, c.config, { slug: t.slug })));
    if (session) base.session = session;
    const r = launchSession(base);
    out(r.command);
    for (const t of tasks) recordLaunch(c.root, { slug: t.slug, tool: opts.tool, goal, session: r.session, resume: r.resume, cwd: r.cwd });
    if (!r.launched) fail(r.reason ?? "the session did not start");
    out(`Started in a new Terminal window, in ${cwd}${r.resume ? `. Reopen it later with: ${r.resume}` : ""}`);
  });

program
  .command("claim <slug>")
  .description("Start work: create or switch to the task/<slug> branch")
  .option("--worktree", "use a separate worktree under .worktree/<slug>")
  .action((slug: string, opts: { worktree?: boolean }) => {
    const c = ctx(program.opts<{ root?: string }>().root);
    const r = claimTask(c.paths, c.config, requireSlug(slug), { person: c.person, ...(opts.worktree ? { worktree: true } : {}) });
    out(`${r.alreadyExisted ? "Resumed" : "Claimed"} ${slug} on ${r.branch}${r.worktree ? ` in ${r.worktree}` : ""}`);
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
    out(notes.map((n) => renderNoteFile(n, { markStale: stale })).join("\n\n"));
  });
note
  .command("path <file>")
  .description("The chain to read before editing a file: repo note, folder notes, file note")
  .action((file: string) => {
    const c = ctx(program.opts<{ root?: string }>().root);
    const chain = notesForPath(c.paths, file);
    if (chain.length === 0) return out(`No notes on the way to ${file}. Write the first one: reggie note add ${file} --type how "..."`);
    out(chain.map((n) => renderNoteFile(n)).join("\n\n"));
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

program
  .command("packet <slug>")
  .description("Scaffold the completion packet from the plan, the diff, and the evidence folder (never overwrites without --force)")
  .option("--force", "overwrite an existing packet, discarding its contents and verdict")
  .action((slug: string, opts: { force?: boolean }) => {
    const c = ctx(program.opts<{ root?: string }>().root);
    const r = scaffoldPacket(c.paths, c.config, { slug: requireSlug(slug), author: c.person.handle, force: Boolean(opts.force) });
    if (r.skipped) return out(`${path.relative(c.root, r.file)} already exists; edit it in place, or pass --force to regenerate it from scratch.`);
    out(`${r.created ? "Created" : "Rewrote"} ${path.relative(c.root, r.file)}. Fill every section honestly, commit, then open a PR with: reggie pr ${slug}`);
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

function payloadText(p: Payload | null): string {
  if (!p || p.fields.length === 0) return "not derivable";
  return `{ ${p.fields.join(", ")} }${p.confidence === "heuristic" ? ` (${p.shape ?? "inferred"}, heuristic)` : ""}`;
}

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
    out(`${flow.title}   ${flow.entry}`);
    out(`${flow.steps.length} step${flow.steps.length === 1 ? "" : "s"}, ${flow.depth} hop${flow.depth === 1 ? "" : "s"}${flow.truncated ? "" : ", complete"}`);
    out("");
    flow.steps.forEach((s, i) => {
      const via = s.via ? ` via ${s.via}` : "";
      out(`${String(i + 1).padStart(3)}. ${s.kind.padEnd(8)} ${s.label}${via}   ${s.source.file}:${s.source.line}${s.confidence === "heuristic" ? "  [heuristic]" : ""}`);
      out(`     in:  ${payloadText(s.input)}`);
      out(`     out: ${payloadText(s.output)}`);
    });
    if (flow.services.length > 0) {
      out("");
      out(`Reaches: ${flow.services.join(", ")}`);
    }
    if (flow.truncated) {
      out("");
      for (const d of flow.dropped) {
        out(d.reason === "depth" ? `Not followed: ${d.count} call${d.count === 1 ? "" : "s"} at hop ${d.hop} (the walk stops at ${d.hop - 1} hops)` : `Dropped: ${d.count} step${d.count === 1 ? "" : "s"} at hop ${d.hop} (${d.reason})`);
      }
    }
  });

program.parseAsync(process.argv).catch((err: unknown) => {
  fail(err instanceof Error ? err.message : String(err));
});

export { slugify };
