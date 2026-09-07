import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { capture } from "./capture.js";
import { buildContext } from "./context.js";
import { appendJournal, detectTool } from "./journal.js";
import { addNote, findNotes, NOTE_TYPES, renderNoteFile, staleEntries } from "./notes.js";
import { planFile, repoPaths, type RepoPaths } from "./paths.js";
import { currentPerson, loadConfig, loadPeople, type Person, type ReggieConfig } from "./people.js";
import { lintPlan, renderPlanTemplate, RISKS } from "./plan.js";
import { getTask, listTasks, renderTaskLine } from "./tasks.js";
import { readText, writeIfMissing } from "./util.js";

const VERSION = "3.0.0-alpha.1";

interface Ctx {
  paths: RepoPaths;
  config: ReggieConfig;
  person: Person;
  author: string;
}

function ctx(root: string): Ctx {
  const paths = repoPaths(root);
  const config = loadConfig(paths);
  const person = currentPerson(root, loadPeople(paths));
  const tool = detectTool();
  const label = tool === "claude" ? "Claude" : tool === "codex" ? "Codex" : "agent";
  return { paths, config, person, author: `${label} via ${person.handle}` };
}

function text(value: string) {
  return { content: [{ type: "text" as const, text: value }] };
}

/** Start the Reggie MCP server on stdio. Never write to stdout here except through the transport. */
export async function startMcpServer(root: string): Promise<void> {
  const server = new McpServer({ name: "reggie", version: VERSION });
  const c = ctx(root);

  server.registerTool(
    "reggie_tasks",
    {
      title: "List tasks",
      description: "Every task in this repo with its state derived from git: ungroomed, grooming, groomed, in-process, awaiting-decision, done. Call this before picking work.",
      inputSchema: { includeDone: z.boolean().optional().describe("Include finished tasks") },
    },
    async ({ includeDone }) => {
      const tasks = listTasks(c.paths, c.config, { includeDone: includeDone ?? false });
      if (tasks.length === 0) return text("No tasks. Capture one with reggie_capture.");
      return text(tasks.map(renderTaskLine).join("\n"));
    },
  );

  server.registerTool(
    "reggie_task",
    {
      title: "Show one task",
      description: "State, owner, branch, PR, and the full plan for a task slug.",
      inputSchema: { slug: z.string().describe("Task slug") },
    },
    async ({ slug }) => {
      const task = getTask(c.paths, c.config, slug);
      const plan = readText(planFile(c.paths, slug));
      const head = [renderTaskLine(task), `branch: ${task.branch ?? "-"}`, `pr: ${task.pr ? `#${task.pr.number} ${task.pr.state} ${task.pr.url}` : "-"}`, `plan lint: ${task.planLintOk === null ? "no plan" : task.planLintOk ? "passes" : "fails"}`];
      return text(`${head.join("\n")}\n\n${plan ?? "(no plan.md yet)"}`);
    },
  );

  server.registerTool(
    "reggie_context",
    {
      title: "Context pack",
      description: "Everything to read before working on a task or an area: notes (repo, folders, files), plan, related tasks, recent commits, active work, journal. Call this first.",
      inputSchema: {
        slug: z.string().optional().describe("Task slug"),
        paths: z.array(z.string()).optional().describe("Repo-relative files or folders in scope"),
        maxLines: z.number().int().positive().optional(),
      },
    },
    async ({ slug, paths, maxLines }) => {
      const req: { slug?: string; paths?: string[]; maxLines?: number } = {};
      if (slug) req.slug = slug;
      if (paths) req.paths = paths;
      if (maxLines) req.maxLines = maxLines;
      return text(buildContext(c.paths, c.config, req));
    },
  );

  server.registerTool(
    "reggie_find_notes",
    {
      title: "Find notes",
      description: "Search the entity-keyed notes by path, folder, or entity name (for example 'src/auth', 'store:users', 'env:'). Empty query lists everything.",
      inputSchema: { query: z.string().describe("Substring of an entity name") },
    },
    async ({ query }) => {
      const notes = findNotes(c.paths, query);
      if (notes.length === 0) return text(`No notes match "${query}". This area is undocumented; write the first note with reggie_add_note.`);
      const stale = new Set(staleEntries(c.paths).map((s) => `${s.entity}|${s.entry.date}|${s.entry.type}`));
      return text(notes.map((n) => renderNoteFile(n, { markStale: stale })).join("\n\n"));
    },
  );

  server.registerTool(
    "reggie_add_note",
    {
      title: "Add a note",
      description: "Record knowledge about a file, folder, or entity so the next session finds it. Entity forms: 'src/auth/login.ts', 'src/auth/', '_repo', 'store:users', 'service:firebase', 'env:API_KEY', 'route:/api/login'. Cite sources.",
      inputSchema: {
        entity: z.string(),
        type: z.enum(NOTE_TYPES),
        text: z.string().min(10),
        confidence: z.enum(["high", "medium", "low"]).optional(),
        sources: z.array(z.string()).optional().describe("file:line references or task slugs"),
      },
    },
    async ({ entity, type, text: body, confidence, sources }) => {
      const input: { type: typeof type; text: string; author: string; confidence?: "high" | "medium" | "low"; sources?: string[] } = { type, text: body, author: c.author };
      if (confidence) input.confidence = confidence;
      if (sources) input.sources = sources;
      const r = addNote(c.paths, entity, input);
      return text(`Added ${r.entry.type} note for ${r.target.entity} in ${r.target.file}${r.created ? " (new note file)" : ""}.`);
    },
  );

  server.registerTool(
    "reggie_journal",
    {
      title: "Write a journal entry",
      description: "Append a plain-English record of what just happened, for people to read or hear later. No file paths in the prose; list evidence files separately. Two to six sentences.",
      inputSchema: {
        text: z.string().min(10),
        slug: z.string().optional(),
        stage: z.string().optional().describe("plan, execute, review, packet, onboard, ..."),
        evidence: z.array(z.string()).optional(),
      },
    },
    async ({ text: body, slug, stage, evidence }) => {
      const tool = detectTool();
      const e = appendJournal(c.paths, {
        person: c.person.handle,
        tool: tool === "human" ? "agent" : tool,
        text: body,
        slug: slug ?? null,
        stage: stage ?? null,
        evidence: evidence ?? [],
      });
      return text(`Journaled at ${e.date} ${e.time} in ${e.file}.`);
    },
  );

  server.registerTool(
    "reggie_capture",
    {
      title: "Capture to intake",
      description: "Add a raw idea, bug, or discovered issue to .reggie/intake.md without planning or fixing it.",
      inputSchema: { text: z.string().min(5), detail: z.string().optional() },
    },
    async ({ text: body, detail }) => {
      const input: { text: string; person: Person; source: string; detail?: string } = { text: body, person: c.person, source: "mcp" };
      if (detail) input.detail = detail;
      const r = capture(c.paths, input);
      return text(`Captured as ${r.slug}.`);
    },
  );

  server.registerTool(
    "reggie_plan_new",
    {
      title: "Scaffold a plan",
      description: "Create .reggie/tasks/<slug>/plan.md from the plan contract template if it does not exist. Fill it in plan mode afterwards.",
      inputSchema: {
        slug: z.string(),
        title: z.string().optional(),
        problem: z.string().optional(),
        files: z.array(z.string()).optional(),
        risk: z.enum(RISKS).optional(),
      },
    },
    async ({ slug, title, problem, files, risk }) => {
      const file = planFile(c.paths, slug);
      const input: Parameters<typeof renderPlanTemplate>[0] = { slug, title: title ?? slug, author: c.author };
      if (problem) input.problem = problem;
      if (files) input.files = files;
      if (risk) input.risk = risk;
      const created = writeIfMissing(file, renderPlanTemplate(input));
      return text(created ? `Created ${file}. Fill every section, then run reggie_lint_plan.` : `${file} already exists.`);
    },
  );

  server.registerTool(
    "reggie_lint_plan",
    {
      title: "Lint a plan against the contract",
      description: "Check that a plan has every section, checkable acceptance criteria, a verification strategy, a risk class, and no placeholders.",
      inputSchema: { slug: z.string() },
    },
    async ({ slug }) => {
      const plan = readText(planFile(c.paths, slug));
      if (!plan) return text(`No plan for ${slug}.`);
      const r = lintPlan(plan);
      const lines = [r.ok ? "PASS: plan satisfies the contract." : "FAIL: plan does not satisfy the contract."];
      for (const e of r.errors) lines.push(`error: ${e}`);
      for (const w of r.warnings) lines.push(`warning: ${w}`);
      return text(lines.join("\n"));
    },
  );

  server.registerTool(
    "reggie_people",
    {
      title: "People and mode",
      description: "Who works in this repo, their roles, and whether Reggie runs in solo or team mode.",
      inputSchema: {},
    },
    async () => {
      const people = loadPeople(c.paths);
      const lines = [`mode: ${c.config.mode}`, `you: ${c.person.name} <${c.person.email}> (${c.person.handle})`];
      for (const p of people.people) lines.push(`- ${p.handle}: ${p.name} <${p.email}> ${p.role}`);
      return text(lines.join("\n"));
    },
  );

  server.registerResource(
    "reggie-readme",
    "reggie://readme",
    { title: "How Reggie structures this repo", description: "The .reggie/README.md that explains the layout and the working habit.", mimeType: "text/markdown" },
    async (uri) => ({ contents: [{ uri: uri.href, text: readText(c.paths.readme) ?? "Not onboarded. Run `reggie onboard`.", mimeType: "text/markdown" }] }),
  );

  server.registerResource(
    "reggie-intake",
    "reggie://intake",
    { title: "Intake", description: "Raw items waiting for triage.", mimeType: "text/markdown" },
    async (uri) => ({ contents: [{ uri: uri.href, text: readText(c.paths.intake) ?? "", mimeType: "text/markdown" }] }),
  );

  server.registerResource(
    "reggie-onboarding",
    "reggie://onboarding",
    { title: "Onboarding brief", description: "What an agent should write to make this repo easy to understand.", mimeType: "text/markdown" },
    async (uri) => ({ contents: [{ uri: uri.href, text: readText(c.paths.onboarding) ?? "No brief. Run `reggie onboard`.", mimeType: "text/markdown" }] }),
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stderr.write(`reggie mcp server ${VERSION} ready for ${root}\n`);
}
