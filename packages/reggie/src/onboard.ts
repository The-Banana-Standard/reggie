import { existsSync } from "node:fs";
import path from "node:path";
import { agentsMdTemplate, applyGeneratedBlock, claudeMdTemplate, END_MARKER, renderGeneratedBlock, START_MARKER, type ApplyResult } from "./docs.js";
import { collectFacts, detectName, type RepoFacts } from "./facts.js";
import { isRepo } from "./git.js";
import { ensureLayout, type LayoutResult } from "./layout.js";
import { addNote, readNoteFile } from "./notes.js";
import { repoPaths, type RepoPaths } from "./paths.js";
import { ensureConfig, ensureCurrentPerson, inferMode, loadPeople, type Person, type ReggieConfig } from "./people.js";
import { readText, today, writeIfMissing, writeText } from "./util.js";

export interface OnboardResult {
  paths: RepoPaths;
  facts: RepoFacts;
  config: ReggieConfig;
  person: Person;
  layout: LayoutResult;
  docs: ApplyResult[];
  commandsInstalled: string[];
  mcpConfigured: boolean;
  briefFile: string;
}

/**
 * Onboard a repository: create .reggie/, generate the CLAUDE.md and AGENTS.md blocks,
 * register the person, install the thin project commands, and write the brief an agent
 * session follows to fill in the narrative.
 */
export function onboard(root: string): OnboardResult {
  if (!isRepo(root)) throw new Error(`${root} is not a git repository. Run \`git init\` first.`);
  const paths = repoPaths(root);
  const layout = ensureLayout(paths);
  const { person } = ensureCurrentPerson(paths);
  const people = loadPeople(paths);
  const { config } = ensureConfig(paths, inferMode(people));

  // Write every file Reggie owns before collecting facts, so the generated block
  // describes the repo as it will look once onboarding is committed.
  const commandsInstalled = installProjectCommands(paths);
  const mcpConfigured = ensureMcpConfig(paths, config);
  const provisional = `${START_MARKER}\n${END_MARKER}`;
  const preName = detectName(root);
  const createdClaude = writeIfMissing(paths.claudeMd, claudeMdTemplate(preName)(provisional));
  const createdAgents = writeIfMissing(paths.agentsMd, agentsMdTemplate(preName)(provisional));

  const facts = collectFacts(root);
  const docs: ApplyResult[] = [
    applyGeneratedBlock(paths.claudeMd, renderGeneratedBlock(facts, config, "claude"), claudeMdTemplate(facts.name)),
    applyGeneratedBlock(paths.agentsMd, renderGeneratedBlock(facts, config, "codex"), agentsMdTemplate(facts.name)),
  ];
  if (createdClaude && docs[0]) docs[0].action = "created";
  if (createdAgents && docs[1]) docs[1].action = "created";

  if (!readNoteFile(paths, "_repo")) {
    addNote(paths, "_repo", {
      type: "how",
      author: "reggie",
      confidence: "high",
      text: `Onboarded on ${today()}. Facts are generated into CLAUDE.md and AGENTS.md; this file holds what a person or agent learned that the facts cannot say. Replace this entry with the first real overview.`,
      sources: ["CLAUDE.md"],
    });
  }

  const briefFile = paths.onboarding;
  writeText(briefFile, renderOnboardingBrief(paths, facts, config));

  return { paths, facts, config, person, layout, docs, commandsInstalled, mcpConfigured, briefFile };
}

/** Refresh the generated blocks only. */
export function refreshDocs(root: string): { results: ApplyResult[]; facts: RepoFacts } {
  const paths = repoPaths(root);
  const people = loadPeople(paths);
  const { config } = ensureConfig(paths, inferMode(people));
  const facts = collectFacts(root);
  const results = [
    applyGeneratedBlock(paths.claudeMd, renderGeneratedBlock(facts, config, "claude"), claudeMdTemplate(facts.name)),
    applyGeneratedBlock(paths.agentsMd, renderGeneratedBlock(facts, config, "codex"), agentsMdTemplate(facts.name)),
  ];
  return { results, facts };
}

function ensureMcpConfig(paths: RepoPaths, config: ReggieConfig): boolean {
  const existing = readText(paths.mcpJson);
  let data: Record<string, unknown> = {};
  if (existing) {
    try {
      const parsed: unknown = JSON.parse(existing);
      if (parsed && typeof parsed === "object") data = parsed as Record<string, unknown>;
    } catch {
      return false;
    }
  }
  const servers = (data.mcpServers && typeof data.mcpServers === "object" ? data.mcpServers : {}) as Record<string, unknown>;
  if (servers[config.mcpServerName]) return false;
  servers[config.mcpServerName] = { command: "reggie", args: ["mcp"] };
  data.mcpServers = servers;
  writeText(paths.mcpJson, `${JSON.stringify(data, null, 2)}\n`);
  return true;
}

const COMMANDS: Record<string, string> = {
  "reggie-onboard.md": `---
description: Onboard this repo to Reggie, then write the first real notes so agents can find good information.
---

Run \`reggie onboard\` in the repo root and read \`.reggie/ONBOARDING.md\`. It lists exactly which notes to write.

Then, working from the code itself, not from memory:

1. Replace the placeholder entry in \`.reggie/notes/_repo.md\` with a **how** entry: what this repo is, how it is run, how it is tested, in plain English.
2. For each top-level source folder listed in the brief, write a \`_dir.md\` **how** entry (what lives there, what depends on it) and a **gotcha** entry if you find one.
3. For every database, collection, external service, and environment variable you can find in the code, add a \`store:\`, \`service:\`, or \`env:\` note under \`.reggie/notes/_entities/\` with a **data-source** entry.
4. Fill the curated sections of CLAUDE.md (Conventions, Decisions, Gotchas). Do not edit inside the generated block.
5. Write one journal entry: \`reggie journal add --stage onboard "..."\`.

Use \`reggie note add <path> --type <type> "text" --source <file:line>\` for each note, or the \`reggie\` MCP tools. Cite a source for every note. When unsure, say so with \`--confidence low\`.
`,
  "reggie-triage.md": `---
description: Shape one or more ungroomed intake items into briefs. Usage: /reggie-triage <slug> [slug...]
---

Slugs: $ARGUMENTS

1. For each slug, run \`reggie context <slug>\` and read it. Work from the intake line, the notes, and the graph; do not go reading much code. A brief is cheap on purpose, and cheap is the point.
2. Run \`reggie triage <slug>\` to scaffold \`.reggie/tasks/<slug>/brief.md\`, then fill every section: Problem, Why now, Suspected area, Open questions, Not this. Set \`area\`, \`size\`, and \`priority\` in the front matter.
3. Keep it short and in plain English. This is shaping, not planning: say what the problem is and where it probably lives, not how you would build it. No implementation approach, no file-by-file design.
4. Anything you cannot answer from what you have becomes an Open question. Do not guess to fill a section.
5. Run \`reggie brief lint <slug>\` and fix every error before moving on.
6. Given several slugs, shape them all in one pass. Then write one journal entry with \`--stage triage\` saying what you shaped and which ones you were least sure about.
`,
  "reggie-plan.md": `---
description: Plan a task in plan mode against Reggie's plan contract. Usage: /reggie-plan <slug> [one-line problem]
---

Slug: $ARGUMENTS

1. Run \`reggie context $ARGUMENTS\` and read all of it. Then run \`reggie plan new $ARGUMENTS\` if no plan exists yet.
2. Enter plan mode. Explore the code read-only. Ask the user every question whose answer would change the approach; if the user is not available, answer it yourself and record it under Assumptions.
3. Write the plan into \`.reggie/tasks/$ARGUMENTS/plan.md\`, filling every section. Each acceptance criterion must be a statement a reviewer can check without asking. Each criterion needs a line in Verification strategy naming the evidence that will prove it.
4. Run \`reggie plan risk $ARGUMENTS\` to set the risk class from the files, then \`reggie plan lint $ARGUMENTS\` and fix every error.
5. Solo mode: commit the plan to the default branch. Team mode: commit on a \`plan/$ARGUMENTS\` branch and open a draft PR so others can comment on the plan lines.
6. Write one journal entry with \`--stage plan\`.
`,
  "reggie-execute.md": `---
description: Execute an approved plan, produce its evidence, run the review policy, and submit a completion packet. Usage: /reggie-execute <slug>
---

Slug: $ARGUMENTS

1. \`reggie context $ARGUMENTS\`; read the plan and the notes it points at. Then \`reggie claim $ARGUMENTS\` (add \`--worktree\` when other work is active in this checkout).
2. Execute the plan. You may deviate; record every deviation and its reason for the packet.
3. Produce the evidence the plan's Verification strategy names. Save outputs under \`.reggie/tasks/$ARGUMENTS/evidence/\` (test logs, command output, screenshots). Never claim a test passed without its output saved.
4. Reviews by risk class (from the plan's front matter): low, run the repo's own checks; medium, also run \`/code-review\`; high, also run \`/security-review\` and have a second pass execute the tests. Run \`/simplify\` when the diff is large. Resolve findings before continuing.
5. After each file change, add or correct its note in \`.reggie/notes/\`. After each step, one journal entry with \`--stage execute\`. Unrelated problems: \`reggie capture "..."\`, do not fix them.
6. \`reggie packet $ARGUMENTS\` creates \`packet.md\` from the plan, the diff, and the evidence folder (it never overwrites an existing packet; edit that in place). Fill every section honestly. Commit. Open a PR whose body is the packet (\`reggie pr $ARGUMENTS\`), or in solo mode ask the user to decide with \`reggie decide\`.
`,
  "reggie-capture.md": `---
description: Capture an idea, bug, or discovered issue into Reggie's intake without structuring it. Usage: /reggie-capture <text>
---

Run \`reggie capture "$ARGUMENTS"\`. If the user gave detail, pass it with \`--detail\`. Confirm the slug that was created. Do not plan or fix anything.
`,
  "reggie-chat.md": `---
description: Discuss a task without touching anything: no edits, no plan, no work. Usage: /reggie-chat <slug>
---

Slug: $ARGUMENTS

Run \`reggie context $ARGUMENTS\` and read all of it. Then think it through with the user: answer their questions, lay out the options with their trade-offs, and say plainly what you are unsure about.

Do not edit any file, do not write or update a plan, and do not start the work. If the conversation settles something worth keeping, offer to capture it with \`reggie capture "..."\` or to add a note with \`reggie note add\`, and do it only when the user says yes.
`,
};

function installProjectCommands(paths: RepoPaths): string[] {
  const installed: string[] = [];
  for (const [name, content] of Object.entries(COMMANDS)) {
    const file = path.join(paths.claudeCommands, name);
    if (writeIfMissing(file, content)) installed.push(path.relative(paths.root, file));
  }
  return installed;
}

function renderOnboardingBrief(paths: RepoPaths, facts: RepoFacts, config: ReggieConfig): string {
  const sourceDirs = facts.topLevel
    .filter((d) => d.dir !== "(root)" && !/^(docs|\.github|public|assets|resources|scripts)\//.test(d.dir) && d.files >= 3)
    .slice(0, 8)
    .map((d) => `- \`${d.dir}\` (${d.files} files) → \`.reggie/notes/${d.dir}_dir.md\``);
  const entities = ["- Databases, collections, tables, buckets → `store:<name>`", "- External services and APIs → `service:<name>`", "- Environment variables and secrets (names only, never values) → `env:<NAME>`", "- Routes, screens, CLI commands → `route:<name>`"];
  return [
    "# Onboarding brief",
    "",
    `Generated by \`reggie onboard\` for **${facts.name}** in **${config.mode}** mode. This file tells an agent session what to write so the repo becomes easy to understand. Delete it when done, or keep it as a checklist.`,
    "",
    "## What Reggie already did",
    "- Created `.reggie/` with its README, intake, notes, journal, and discussions folders.",
    "- Generated the facts block in `CLAUDE.md` and `AGENTS.md` (languages, structure, commands, entry points, tests, CI). Refresh it any time with `reggie docs refresh`; check it in CI with `reggie docs check`.",
    "- Registered you in `.reggie/people.yaml` and wrote `.reggie/config.yaml`.",
    "- Installed thin project commands under `.claude/commands/` and the `reggie` MCP server in `.mcp.json`.",
    "",
    "## What only an agent or a person can write",
    "",
    "### 1. The repo overview (`.reggie/notes/_repo.md`)",
    "Replace the placeholder entry with a `how` entry: what this repo is for, how to run it, how to test it, how it is deployed. Plain English, no paths in the prose, sources cited.",
    "",
    "### 2. Folder notes for the main source areas",
    ...(sourceDirs.length > 0 ? sourceDirs : ["- (no source folders detected; write notes for whatever holds the code)"]),
    "Each gets a `how` entry (what lives here, what depends on it) and a `gotcha` entry when you find one.",
    "",
    "### 3. Data and service notes (`.reggie/notes/_entities/`)",
    ...entities,
    "Each gets a `data-source` entry: where the data comes from, which code reads and writes it, and how to verify it is healthy.",
    "",
    "### 4. Curated sections of CLAUDE.md",
    "Fill Conventions, Decisions, and Gotchas above the generated block. Keep AGENTS.md in step, or symlink one to the other.",
    "",
    "### 5. Seed the intake",
    "Anything already known to be broken or wanted goes in with `reggie capture \"...\"`.",
    "",
    "## Commands",
    "```",
    "reggie note add <path|store:name|service:name|env:NAME> --type <why|how|gotcha|verify|data-source|decision> \"text\" --source <file:line>",
    "reggie note find <query>        # what do we know about this?",
    "reggie note stale               # which notes describe code that changed since?",
    "reggie context <slug|path...>   # the pack to read before working",
    "reggie journal add --stage onboard \"what you did and what surprised you\"",
    "```",
    "",
    `Notes directory: \`${path.relative(paths.root, paths.notes)}/\`. Existing notes: ${existsSync(paths.notes) ? "see `reggie note find \"\"`" : "none"}.`,
    "",
  ].join("\n");
}
