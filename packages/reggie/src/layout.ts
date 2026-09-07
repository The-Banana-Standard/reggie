import { existsSync } from "node:fs";
import path from "node:path";
import type { RepoPaths } from "./paths.js";
import { appendText, ensureDir, readText, relPosix, writeIfMissing } from "./util.js";

export const REGGIE_README = `# .reggie — what this folder is

Reggie keeps everything a team and its coding agents need to know about this
repo in one place, next to the code, under version control. Nothing here is a
cache. If a file exists, it is meant to be read and committed.

## The layout

- \`intake.md\` — raw ideas, bugs, and requests. One line each. No structure needed.
- \`tasks/<slug>/plan.md\` — the plan for one piece of work. Written in plan mode,
  checked against a contract, approved before anyone codes.
- \`tasks/<slug>/packet.md\` — the completion packet: what was done, how it was
  verified, what changed, what was found. This is what a reviewer reads.
- \`tasks/<slug>/evidence/\` — test output, screenshots, command output that
  proves the packet's claims.
- \`notes/\` — knowledge about the code, arranged as a mirror of the code tree.
  Information about \`src/auth/login.ts\` lives at \`notes/src/auth/login.ts.md\`.
  Information about the \`src/auth/\` folder lives at \`notes/src/auth/_dir.md\`.
  Repo-wide knowledge lives at \`notes/_repo.md\`. Things that are not files, such
  as databases, routes, and external services, live under \`notes/_entities/\`.
- \`journal/YYYY-MM-DD/<person>-<session>.md\` — a plain-English record of what
  each person and each agent did, written as the work happens.
- \`discussions/\` — conversations bigger than one task, such as direction or
  architecture, that can turn into tasks.
- \`people.yaml\` — who works here and their roles. \`config.yaml\` — solo or team
  mode, risk rules, the default branch.

## How state works

Reggie does not keep a separate status database. It reads git:

- An intake line with no plan is **ungroomed**.
- A plan merged to the default branch is **groomed**.
- A \`task/<slug>\` branch with commits is **in process**. Its last commit says who and when.
- An open pull request for that branch is **awaiting decision**.
- A merged pull request is **done**.

## The habit that makes this work

Before you change a file, read its note. After you change it, update the note.
Before you start a task, run \`reggie context <slug>\`. When you finish a step,
write one journal entry in plain English. That is the whole discipline.
`;

export const INTAKE_HEADER = `# Intake

Raw items waiting for triage. Anyone can add a line here, by hand, by voice
note, or by asking Claude or Codex to capture it. No structure is required.

Format Reggie writes (angle brackets are placeholders):

    - <slug>: <one-line description> (<person>, <source>, <date>)
      > <optional detail>

Reggie turns items into plans under \`tasks/<slug>/plan.md\`. Once a plan is
merged, the intake line is removed.

`;

export const NOTES_README = `# notes — knowledge arranged like the code

Find information about a path by opening the same path here:

- \`notes/src/auth/login.ts.md\` describes \`src/auth/login.ts\`
- \`notes/src/auth/_dir.md\` describes the \`src/auth/\` folder
- \`notes/_repo.md\` describes the whole repo
- \`notes/_entities/<kind>/<name>.md\` describes things that are not files:
  \`store/\` for databases and collections, \`route/\` for endpoints and screens,
  \`service/\` for external services, \`env/\` for environment variables.

Each note file holds dated entries. Each entry has a type, an author, a
confidence, and the sources it came from. Types:

- **why** — why this exists or is shaped this way
- **how** — how it works, in plain words
- **gotcha** — what will bite you
- **verify** — how to prove it works
- **data-source** — where its data comes from and goes
- **decision** — a choice that was made, and the alternative that was not

An entry is stale when the code it describes changed after the entry was written.
\`reggie note stale\` lists those. Correct or confirm them; do not delete history.

Add an entry with \`reggie note add <path> --type gotcha "text"\` or ask your agent to.
`;

export interface LayoutResult {
  created: string[];
  gitignoreUpdated: boolean;
}

/** Create the .reggie/ tree and its explanatory files if missing. Idempotent. */
export function ensureLayout(paths: RepoPaths): LayoutResult {
  const created: string[] = [];
  const dirs = [paths.reggie, paths.tasks, paths.notes, paths.journal, paths.discussions, path.join(paths.notes, "_entities")];
  for (const dir of dirs) {
    if (!existsSync(dir)) {
      ensureDir(dir);
      created.push(`${relPosix(paths.root, dir)}/`);
    }
  }
  const files: Array<[string, string]> = [
    [paths.readme, REGGIE_README],
    [paths.intake, INTAKE_HEADER],
    [path.join(paths.notes, "README.md"), NOTES_README],
  ];
  for (const [file, content] of files) {
    if (writeIfMissing(file, content)) created.push(relPosix(paths.root, file));
  }
  for (const dir of [paths.tasks, paths.journal, paths.discussions, path.join(paths.notes, "_entities")]) {
    writeIfMissing(path.join(dir, ".gitkeep"), "");
  }
  const gitignoreUpdated = ensureGitignore(paths.root);
  return { created, gitignoreUpdated };
}

/** The derived-cache paths onboard ignores. `.reggie/.cache/` holds history.ts's `history-<sha>.json`. */
export const GITIGNORE_LINES = [".reggie/graph/", ".reggie/.cache/", ".reggie/**/*.tmp"] as const;

/**
 * Ignore only derived caches. Everything else under .reggie/ is meant to be committed.
 * Lines already present are kept as they are; only the missing ones are appended, so a repo
 * onboarded before a cache directory existed picks it up on the next onboard.
 */
export function ensureGitignore(root: string): boolean {
  const file = path.join(root, ".gitignore");
  const existing = readText(file) ?? "";
  const present = new Set(existing.split(/\r?\n/).map((l) => l.trim()));
  const missing = GITIGNORE_LINES.filter((l) => !present.has(l));
  if (missing.length === 0) return false;
  const header = present.has(".reggie/graph/") ? [] : ["# Reggie: derived caches only. Everything else in .reggie/ is committed."];
  const block = [...header, ...missing, ""];
  const prefix = existing === "" || existing.endsWith("\n") ? "" : "\n";
  appendText(file, `${prefix}${existing === "" || header.length === 0 ? "" : "\n"}${block.join("\n")}`);
  return true;
}
