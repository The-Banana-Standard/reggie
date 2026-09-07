#!/usr/bin/env node
import { existsSync } from "node:fs";
import path from "node:path";
import { Command } from "commander";
import { capture, removeFromIntake } from "./capture.js";
import { claimTask, releaseTask } from "./claim.js";
import { buildContext } from "./context.js";
import { checkGeneratedBlock, renderGeneratedBlock } from "./docs.js";
import { collectFacts } from "./facts.js";
import { createIssue, createPullRequest, ghAvailable } from "./gh.js";
import { currentBranch, defaultBranch, git } from "./git.js";
import { appendJournal, detectTool, readJournal, renderJournalEntry } from "./journal.js";
import { startMcpServer } from "./mcp.js";
import { addNote, findNotes, NOTE_TYPES, notesForPath, renderNoteFile, staleEntries, type Confidence, type NoteType } from "./notes.js";
import { onboard, refreshDocs } from "./onboard.js";
import { decidePacket, scaffoldPacket } from "./packet.js";
import { findRepoRoot, packetFile, planFile, repoPaths, type RepoPaths } from "./paths.js";
import { currentPerson, ensureCurrentPerson, loadConfig, loadPeople, type Person, type ReggieConfig } from "./people.js";
import { lintPlan, parsePlan, renderPlanTemplate, riskFromFiles, RISKS, setPlanRisk, type Risk } from "./plan.js";
import { getTask, listTasks, renderTaskLine } from "./tasks.js";
import { isSafeSlug, readText, slugify, writeIfMissing, writeText } from "./util.js";

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

program
  .command("onboard [dir]")
  .alias("init")
  .description("Create .reggie/, generate the CLAUDE.md and AGENTS.md blocks, install project commands, and write the onboarding brief")
  .action((dir?: string) => {
    const start = dir ? path.resolve(dir) : process.cwd();
    const root = findRepoRoot(start);
    const r = onboard(root);
    out(`Onboarded ${r.facts.name} (${r.config.mode} mode) as ${r.person.handle}.`);
    if (r.layout.created.length > 0) out(`Created: ${r.layout.created.join(", ")}`);
    for (const d of r.docs) out(`${d.action}: ${path.relative(root, d.file)}`);
    if (r.commandsInstalled.length > 0) out(`Installed commands: ${r.commandsInstalled.join(", ")}`);
    if (r.mcpConfigured) out("Configured the reggie MCP server in .mcp.json (Claude Code). For Codex: codex mcp add reggie -- reggie mcp");
    if (r.layout.gitignoreUpdated) out("Updated .gitignore (derived caches only).");
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
    const results = [
      checkGeneratedBlock(c.paths.claudeMd, renderGeneratedBlock(facts, c.config, "claude")),
      checkGeneratedBlock(c.paths.agentsMd, renderGeneratedBlock(facts, c.config, "codex")),
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
  .command("tasks")
  .description("List tasks with their state derived from git")
  .option("--all", "include done tasks")
  .option("--json", "machine-readable output")
  .action((opts: { all?: boolean; json?: boolean }) => {
    const c = ctx(program.opts<{ root?: string }>().root);
    const tasks = listTasks(c.paths, c.config, { includeDone: Boolean(opts.all) });
    if (opts.json) return out(JSON.stringify(tasks, null, 2));
    if (tasks.length === 0) return out("No tasks. Capture one: reggie capture \"...\"");
    for (const t of tasks) out(renderTaskLine(t));
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
    const tasks = listTasks(c.paths, c.config).filter((t) => t.state === "in-process" || t.state === "awaiting-decision" || t.state === "grooming");
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
    const intake = readText(c.paths.intake) ?? "";
    const intakeLine = new RegExp(`^- ${s}:\\s+(.+?)(\\s\\(.*\\))?$`, "m").exec(intake);
    const input: Parameters<typeof renderPlanTemplate>[0] = { slug: s, title: opts.title ?? intakeLine?.[1] ?? s, author: c.person.handle };
    if (opts.problem) input.problem = opts.problem;
    else if (intakeLine?.[1]) input.problem = intakeLine[1];
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

program
  .command("claim <slug>")
  .description("Start work: create or switch to the task/<slug> branch")
  .option("--worktree", "use a separate worktree under .worktree/<slug>")
  .action((slug: string, opts: { worktree?: boolean }) => {
    const c = ctx(program.opts<{ root?: string }>().root);
    ensureCurrentPerson(c.paths);
    const r = claimTask(c.paths, c.config, requireSlug(slug), { person: c.person, ...(opts.worktree ? { worktree: true } : {}) });
    out(`${r.alreadyExisted ? "Resumed" : "Claimed"} ${slug} on ${r.branch}${r.worktree ? ` in ${r.worktree}` : ""}`);
  });

program
  .command("release <slug>")
  .description("Drop your local claim: delete the local task branch and worktree")
  .action((slug: string) => {
    const c = ctx(program.opts<{ root?: string }>().root);
    for (const a of releaseTask(c.paths, c.config, requireSlug(slug), c.person)) out(a);
  });

program
  .command("context [slug]")
  .description("The pack to read before working: notes, plan, related tasks, recent commits, active work, journal")
  .option("-p, --path <paths...>", "files or folders in scope")
  .option("--max-lines <n>", "truncate output", (v) => Number.parseInt(v, 10))
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
  .option("--days <n>", "how far back", (v) => Number.parseInt(v, 10), 7)
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
  .description("Scaffold the completion packet from the plan, the diff, and the evidence folder")
  .action((slug: string) => {
    const c = ctx(program.opts<{ root?: string }>().root);
    const r = scaffoldPacket(c.paths, c.config, { slug: requireSlug(slug), author: c.person.handle });
    out(`${r.created ? "Created" : "Rewrote"} ${path.relative(c.root, r.file)}. Fill every section honestly, commit, then open a PR with: reggie pr ${slug}`);
  });

program
  .command("decide <slug> <verdict>")
  .description("Record approved or needs-work on a packet (solo mode, or when not using PR review)")
  .option("--comment <text>")
  .action((slug: string, verdict: string, opts: { comment?: string }) => {
    const c = ctx(program.opts<{ root?: string }>().root);
    if (verdict !== "approved" && verdict !== "needs-work") fail("verdict must be approved or needs-work");
    const file = decidePacket(c.paths, requireSlug(slug), verdict, c.person.handle, opts.comment);
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
    await startMcpServer(c.root);
  });

function planningPrompt(c: Ctx, slug: string): string {
  const intake = readText(c.paths.intake) ?? "";
  const line = new RegExp(`^- ${slug}:\\s+(.+)$`, "m").exec(intake)?.[1] ?? "(no intake line; the user will describe the task)";
  return [
    `You are planning the task "${slug}" for the repository at ${c.root}.`,
    `Intake: ${line}`,
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

program.parseAsync(process.argv).catch((err: unknown) => {
  fail(err instanceof Error ? err.message : String(err));
});

export { slugify };
