import { capture } from "../src/capture.js";
import { claimTask } from "../src/claim.js";
import { git } from "../src/git.js";
import { appendJournal } from "../src/journal.js";
import { addNote } from "../src/notes.js";
import { onboard } from "../src/onboard.js";
import { scaffoldPacket } from "../src/packet.js";
import { planFile, repoPaths, type RepoPaths } from "../src/paths.js";
import { currentPerson, loadConfig, type ReggieConfig } from "../src/people.js";
import { writeText } from "../src/util.js";
import { makeTempRepo, type TempRepo } from "./helpers.js";

export interface FixtureRepo {
  repo: TempRepo;
  paths: RepoPaths;
  config: ReggieConfig;
  slugs: { inProcess: string; awaiting: string; ungroomed: string };
}

/** Number of chained source files under src/big/ (a01 … a45). */
export const BIG_FILES = 45;
/** Number of test files under src/big/__tests__/. */
export const BIG_TESTS = 6;
/** How many of the big files import src/types/shape.ts. */
export const SHAPE_IMPORTERS = 20;

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/** A plan that satisfies the contract, for a fixture task. */
function fixturePlan(slug: string, title: string, files: string[], risk: "low" | "medium" | "high" = "low"): string {
  return [
    "---",
    `slug: ${slug}`,
    `title: ${title}`,
    `risk: ${risk}`,
    "deciders: []",
    "author: Test Person",
    "created: 2026-09-01",
    "---",
    `# ${title}`,
    "",
    "## Problem",
    "The chain in the big area recomputes its shape on every call, which makes the first render slow.",
    "",
    "## Approach",
    "Cache the shape on the module and invalidate it when the input changes. Rejected: a global registry, because it hides the dependency.",
    "",
    "## Files to touch",
    ...files.map((f) => `- ${f} (MOD)`),
    "",
    "## Acceptance criteria",
    "- [ ] The first render of the chain runs in under 50 ms on the fixture data",
    "- [ ] A unit test covers the cache invalidation",
    "",
    "## Verification strategy",
    "- Run the big area tests and save the output to evidence/tests.txt",
    "- Time the first render and save the numbers to evidence/timing.txt",
    "",
    "## Assumptions",
    "- The shape is immutable once computed; the alternative was copy-on-write, rejected as more code",
    "",
    "## Out of scope",
    "- Rewriting the chain as a graph",
    "",
    "## Bail conditions",
    "- If the cache needs to live in the tiny area too, stop and re-plan with its owner",
    "",
  ].join("\n");
}

function commitPaths(root: string, files: string[], message: string): void {
  git(["add", "--", ...files], { cwd: root });
  git(["-c", "commit.gpgsign=false", "commit", "-q", "-m", message, "--", ...files], { cwd: root });
}

/**
 * A throwaway repo with two TypeScript areas (45-file chain + 2-file dir), a shared types file,
 * tests, a Rust crate with a Tauri command and a TS invoke, a stylesheet and a shell script in code
 * languages the graph does not read, notes (one stale), journal entries,
 * and tasks in three states: ungroomed (intake), in-process (task branch with a commit),
 * awaiting-decision (task branch with a committed packet).
 *
 * Everything is committed on main except the task-branch work; the working tree ends on main.
 */
export function makeFixtureRepo(): FixtureRepo {
  const repo = makeTempRepo("reggie-fixture-");
  const root = repo.root;

  // --- code -----------------------------------------------------------------
  repo.write("package.json", '{\n  "name": "fixture",\n  "version": "1.0.0",\n  "type": "module",\n  "scripts": { "test": "vitest run", "build": "tsc -p tsconfig.json" }\n}\n');
  repo.write("tsconfig.json", '{ "compilerOptions": { "strict": true, "module": "NodeNext" } }\n');
  repo.write("src/types/shape.ts", "export interface Shape {\n  id: string;\n  points: number[];\n}\n\nexport function emptyShape(id: string): Shape {\n  return { id, points: [] };\n}\n");

  for (let i = 1; i <= BIG_FILES; i += 1) {
    const name = `a${pad(i)}`;
    const lines: string[] = [];
    if (i < BIG_FILES) lines.push(`import { ${`a${pad(i + 1)}`} } from "./a${pad(i + 1)}.js";`);
    const usesShape = i <= SHAPE_IMPORTERS;
    if (usesShape) lines.push('import { emptyShape, type Shape } from "../types/shape.js";');
    lines.push("");
    if (usesShape) {
      lines.push(`export function ${name}(): Shape {`);
      lines.push(`  const s = emptyShape("${name}");`);
      lines.push(i < BIG_FILES ? `  s.points.push(${`a${pad(i + 1)}`}());` : `  s.points.push(${i});`);
      lines.push("  return s;");
      lines.push("}");
    } else {
      lines.push(`export function ${name}(): number {`);
      lines.push(i < BIG_FILES ? `  return ${i} + ${`a${pad(i + 1)}`}();` : `  return ${i};`);
      lines.push("}");
    }
    lines.push("");
    repo.write(`src/big/${name}.ts`, lines.join("\n"));
  }
  for (let t = 1; t <= BIG_TESTS; t += 1) {
    const target = `a${pad(t)}`;
    repo.write(
      `src/big/__tests__/${target}.test.ts`,
      `import { describe, expect, it } from "vitest";\nimport { ${target} } from "../${target}.js";\n\ndescribe("${target}", () => {\n  it("runs", () => {\n    expect(${target}()).toBeTruthy();\n  });\n});\n`,
    );
  }
  repo.write("src/big/ipc.ts", 'import { invoke } from "@tauri-apps/api/core";\n\nexport async function listWidgets(): Promise<string[]> {\n  return invoke("list_widgets");\n}\n');

  repo.write("src/tiny/one.ts", 'import { two } from "./two.js";\n\nexport function one(): number {\n  return two() + 1;\n}\n');
  repo.write("src/tiny/two.ts", "export function two(): number {\n  return 2;\n}\n");

  repo.write("native/Cargo.toml", '[package]\nname = "native_lib"\nversion = "0.1.0"\nedition = "2021"\n\n[lib]\nname = "native_lib"\npath = "src/lib.rs"\n\n[dependencies]\n');
  repo.write("native/src/main.rs", "mod commands;\nuse native_lib::run;\n\nfn main() {\n    run();\n}\n");
  repo.write("native/src/lib.rs", "pub mod commands;\n\npub fn run() {\n    println!(\"running\");\n}\n");
  repo.write("native/src/commands/mod.rs", "pub mod widgets;\n");
  repo.write("native/src/commands/widgets.rs", "#[tauri::command]\npub fn list_widgets() -> Vec<String> {\n    vec![\"a\".into(), \"b\".into()]\n}\n");

  // Two files in code languages the graph does not read, so `skipped` is non-zero here and every
  // assertion about it is not an assertion about zero. Neither extension is in `CODE_EXT`, so they
  // get no node and no edge: `totalCodeFiles`, `included` and every count pinned to them are unmoved.
  repo.write("src/big/chain.css", ".chain {\n  display: flex;\n  gap: 4px;\n}\n");
  repo.write("native/build.sh", "#!/bin/sh\nset -e\ncargo build --release\n");
  repo.commitAll("code: big chain, tiny area, shared types, native crate");

  // --- onboard --------------------------------------------------------------
  onboard(root);
  repo.commitAll("onboard");
  const paths = repoPaths(root);
  const config = loadConfig(paths);
  const person = currentPerson(root);

  // --- notes ----------------------------------------------------------------
  addNote(paths, "_repo", {
    type: "why",
    author: "Test Person",
    confidence: "high",
    text: "A fixture repo that exists so the tests have a small codebase with a long import chain, a tiny area, and a native crate to read.",
    sources: ["package.json"],
  });
  addNote(paths, "_repo", {
    type: "how",
    author: "Test Person",
    confidence: "high",
    text: "A fixture repo: a long import chain under the big area, a tiny area, and a native crate reached over Tauri IPC. Run the tests with npm test.",
    sources: ["package.json"],
  });
  // Dated before the code commits, so it reads as stale.
  addNote(paths, "src/big/", {
    type: "gotcha",
    author: "Test Person",
    confidence: "medium",
    text: "The chain must stay in order; a01 is the entry and a45 the leaf.",
    sources: ["src/big/a01.ts"],
    date: "2020-01-01",
  });
  addNote(paths, "src/types/shape.ts", {
    type: "why",
    author: "Test Person",
    confidence: "high",
    text: "Shape is the one shared type so the big area does not depend on itself for data.",
    sources: ["src/types/shape.ts:1"],
  });

  // --- journal --------------------------------------------------------------
  appendJournal(paths, { person: person.handle, tool: "human", stage: "onboard", text: "Onboarded the fixture repo and wrote the first three notes.", session: "fixture" });
  appendJournal(paths, { person: person.handle, tool: "claude", stage: "plan", slug: "cache-chain-shape", text: "Planned the chain cache; the big area is the only place it is needed.", session: "fixture" });
  repo.commitAll("notes and journal");

  // --- tasks ----------------------------------------------------------------
  const ungroomed = capture(paths, { text: "Split the big area into two packages", person, source: "fixture" }).slug;

  const inProcess = "cache-chain-shape";
  writeText(planFile(paths, inProcess), fixturePlan(inProcess, "Cache the chain shape", ["src/big/a01.ts", "src/big/a02.ts"]));
  const awaiting = "share-shape-helpers";
  writeText(planFile(paths, awaiting), fixturePlan(awaiting, "Share the shape helpers", ["src/big/a01.ts", "src/types/shape.ts"], "medium"));
  repo.commitAll("intake and plans");

  // In process: branch + one commit changing src/big/a01.ts.
  claimTask(paths, config, inProcess, { person });
  repo.write("src/big/a01.ts", 'import { a02 } from "./a02.js";\nimport { emptyShape, type Shape } from "../types/shape.js";\n\nlet cached: Shape | null = null;\n\nexport function a01(): Shape {\n  if (cached) return cached;\n  const s = emptyShape("a01");\n  s.points.push(a02());\n  cached = s;\n  return s;\n}\n');
  commitPaths(root, ["src/big/a01.ts"], `feat: cache the chain shape\n\nTask: ${inProcess}`);
  git(["switch", "-q", "main"], { cwd: root });

  // Awaiting decision: branch + a commit + a scaffolded packet committed on the branch.
  claimTask(paths, config, awaiting, { person });
  repo.write("src/types/shape.ts", "export interface Shape {\n  id: string;\n  points: number[];\n}\n\nexport function emptyShape(id: string): Shape {\n  return { id, points: [] };\n}\n\nexport function sizeOf(s: Shape): number {\n  return s.points.length;\n}\n");
  commitPaths(root, ["src/types/shape.ts"], `feat: add sizeOf helper\n\nTask: ${awaiting}`);
  repo.write(`.reggie/tasks/${awaiting}/evidence/tests.txt`, "6 passed, 0 failed\n");
  scaffoldPacket(paths, config, { slug: awaiting, author: person.handle });
  commitPaths(root, [`.reggie/tasks/${awaiting}/packet.md`, `.reggie/tasks/${awaiting}/evidence/tests.txt`], `packet: ${awaiting}`);
  git(["switch", "-q", "main"], { cwd: root });

  // The claim journal entries were written to the working tree; keep them on main.
  repo.commitAll("journal: claims");

  return { repo, paths, config, slugs: { inProcess, awaiting, ungroomed } };
}
