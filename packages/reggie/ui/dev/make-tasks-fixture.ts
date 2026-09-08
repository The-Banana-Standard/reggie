/**
 * ui/dev/make-tasks-fixture.ts — a fixture repo carrying a task in every one of the six states,
 * which is what the tasks page needs to be looked at. `makeFixtureRepo()` (test/fixtures.ts) gives
 * ungroomed / in-process / awaiting-decision; this script adds the three the board would otherwise
 * draw empty: `groomed` (a brief and no plan), `planned` (a plan that passes the contract on the
 * default branch) and `done` (a packet with `verdict: approved` merged back onto it). It also
 * captures two more raw lines, so "Shape these" has three cards to select.
 *
 *   npx tsx ui/dev/make-tasks-fixture.ts            # prints the root and what is in it
 *   npx tsx ui/dev/make-tasks-fixture.ts --quiet    # prints only the root
 *   npx tsx ui/dev/make-tasks-fixture.ts --empty    # an onboarded repo with no tasks at all
 *
 * Serve it by cd-ing into the printed root — `reggie serve` reads the repo from the working
 * directory. The repo lives under the OS temp directory and is never deleted here, because the
 * server has to outlive this process.
 */
import { appendJournal } from "../../src/journal.js";
import { capture } from "../../src/capture.js";
import { claimTask } from "../../src/claim.js";
import { decidePacket, scaffoldPacket } from "../../src/packet.js";
import { git } from "../../src/git.js";
import { onboard } from "../../src/onboard.js";
import { briefFile, planFile, repoPaths } from "../../src/paths.js";
import { currentPerson, loadConfig } from "../../src/people.js";
import { scaffoldBrief } from "../../src/triage.js";
import { readText, writeText } from "../../src/util.js";
import { makeFixtureRepo } from "../../test/fixtures.js";
import { makeTempRepo } from "../../test/helpers.js";

const quiet = process.argv.includes("--quiet");
const empty = process.argv.includes("--empty");

function plan(slug: string, title: string, files: string[], risk: "low" | "medium" | "high"): string {
  return [
    "---",
    `slug: ${slug}`,
    `title: ${title}`,
    `risk: ${risk}`,
    "deciders: []",
    "author: Test Person",
    "created: 2026-09-02",
    "---",
    `# ${title}`,
    "",
    "## Problem",
    "The tiny area computes its total by walking the chain twice, once to count and once to sum, so a caller pays for the walk twice on every render.",
    "",
    "## Approach",
    "Walk once and carry both numbers in the accumulator. Rejected: memoising the count on the module, because the chain is rebuilt per call and the memo would go stale silently.",
    "",
    "## Files to touch",
    ...files.map((f) => `- ${f} (MOD)`),
    "",
    "## Acceptance criteria",
    "- [ ] The tiny area walks the chain once per call",
    "- [ ] A unit test covers a chain of length zero",
    "",
    "## Verification strategy",
    "- Run the tiny area tests and save the output to evidence/tests.txt",
    "- Count the walks with a counter in the test and save it to evidence/walks.txt",
    "",
    "## Assumptions",
    "- The chain is never mutated while it is being walked; the alternative was a snapshot copy, rejected as more allocation",
    "",
    "## Out of scope",
    "- The big area, which walks a different chain",
    "",
    "## Bail conditions",
    "- If the count and the sum need different traversal orders, stop and re-plan",
    "",
  ].join("\n");
}

function commitPaths(root: string, files: string[], message: string): void {
  git(["add", "--", ...files], { cwd: root });
  git(["-c", "commit.gpgsign=false", "commit", "-q", "-m", message, "--", ...files], { cwd: root });
}

if (empty) {
  const repo = makeTempRepo("reggie-empty-");
  repo.write("package.json", '{\n  "name": "empty-fixture",\n  "version": "1.0.0",\n  "type": "module"\n}\n');
  repo.write("src/index.ts", 'export function hello(): string {\n  return "hello";\n}\n');
  repo.commitAll("code");
  onboard(repo.root);
  repo.commitAll("onboard");
  process.stdout.write(quiet ? `${repo.root}\n` : `root:  ${repo.root}\ntasks: none (the empty-state fixture)\n\n`);
} else {
  const fixture = makeFixtureRepo();
  const root = fixture.repo.root;
  const paths = repoPaths(root);
  const config = loadConfig(paths);
  const person = currentPerson(root);

  // Two more raw intake lines, so the Ungroomed column can be triaged three at a time.
  const ungroomed2 = capture(paths, { text: "Warn when a note cites a file that has since moved", person, source: "fixture" }).slug;
  const ungroomed3 = capture(paths, { text: "Cache the symbol scan between requests", person, source: "fixture", detail: "The scan re-parses every file on each /api/symbols hit." }).slug;

  /** Replace the scaffold's parenthesised hints with real prose, the way triage would. */
  function fillBrief(slug: string, filled: Record<string, string>): void {
    const file = briefFile(paths, slug);
    let text = readText(file) ?? "";
    for (const [heading, body] of Object.entries(filled)) {
      const re = new RegExp(`(## ${heading}\\n)(?:-?\\s*\\([^)]*\\)\\n)`, "s");
      text = text.replace(re, `$1${body}\n`);
    }
    writeText(file, text);
  }

  // groomed: a brief and no plan.
  const groomed = capture(paths, { text: "Show the last ten commits on the file page", person, source: "fixture" }).slug;
  scaffoldBrief(paths, {
    slug: groomed,
    title: "Show the last ten commits on the file page",
    area: "src/big/",
    size: "small",
    priority: "P2",
    risk: "low",
    author: person.handle,
  });
  fillBrief(groomed, {
    Problem: "The file page says who touched a file and when, but not what they did, so a reader has to leave for a terminal to find out.",
    "Why now": "The history index already carries the commit subjects, so nothing new has to be built to show them.",
    "Suspected area": "- src/history.ts — the index already parses subjects; this reads them\n- ui/reader.js — where the panel would draw",
    "Open questions": "- Ten commits, or ten days? Ten days reads better on a file nobody touches.",
    "Not this": "- Not a blame view: this lists commits, not who owns each line.",
  });

  // planned: a plan that passes the contract, on the default branch, no branch claimed.
  const planned = capture(paths, { text: "Walk the tiny chain once per call", person, source: "fixture" }).slug;
  scaffoldBrief(paths, { slug: planned, title: "Walk the tiny chain once per call", area: "src/tiny/", size: "medium", priority: "P1", risk: "medium", author: person.handle });
  fillBrief(planned, {
    Problem: "The tiny area walks its chain twice on every call, once to count and once to sum, so a caller pays for the traversal twice.",
    "Why now": "The chain is about to grow; the second walk gets more expensive the longer it gets.",
    "Suspected area": "- src/tiny/one.ts — the caller that walks twice\n- src/tiny/two.ts — the leaf it walks to",
    "Open questions": "- none",
    "Not this": "- Not the big area, which walks a different chain for a different reason.",
  });
  writeText(planFile(paths, planned), plan(planned, "Walk the tiny chain once per call", ["src/tiny/one.ts", "src/tiny/two.ts"], "medium"));

  fixture.repo.commitAll("intake, briefs and the tiny-chain plan");

  // done: plan on main, work on a branch, packet approved, merged back.
  const done = capture(paths, { text: "Name the shared types file in the repo note", person, source: "fixture" }).slug;
  scaffoldBrief(paths, { slug: done, title: "Name the shared types file in the repo note", area: "src/types/", size: "small", priority: "P3", risk: "low", author: person.handle });
  fillBrief(done, {
    Problem: "The repo note describes the areas but never names the one file both of them share, so a newcomer finds it by accident.",
    "Why now": "Two tasks in a row have collided on it; naming it in the note is cheaper than explaining it again.",
    "Suspected area": "- src/types/shape.ts — the shared file itself",
    "Open questions": "- none",
    "Not this": "- Not documenting every type: one sentence about the one shared file.",
  });
  writeText(planFile(paths, done), plan(done, "Name the shared types file in the repo note", ["src/types/shape.ts"], "low"));
  fixture.repo.commitAll(`plan: ${done}`);

  claimTask(paths, config, done, { person });
  fixture.repo.write(
    "src/types/shape.ts",
    "export interface Shape {\n  id: string;\n  points: number[];\n}\n\nexport function emptyShape(id: string): Shape {\n  return { id, points: [] };\n}\n\n/** The one shared type: everything that draws a shape reads it from here. */\nexport function isShape(v: unknown): v is Shape {\n  return typeof v === \"object\" && v !== null && \"points\" in v;\n}\n",
  );
  commitPaths(root, ["src/types/shape.ts"], `feat: name the shared types file\n\nTask: ${done}`);
  fixture.repo.write("src/tiny/one.ts", 'import { two } from "./two.js";\n\nexport function one(): number {\n  return two() + 1;\n}\n\nexport function onePlus(n: number): number {\n  return one() + n;\n}\n');
  commitPaths(root, ["src/tiny/one.ts"], `test: cover the empty chain\n\nTask: ${done}`);
  fixture.repo.write(`.reggie/tasks/${done}/evidence/tests.txt`, "12 passed, 0 failed\n\nsrc/types/shape.test.ts  4 passed\nsrc/tiny/one.test.ts     8 passed\n");
  fixture.repo.write(`.reggie/tasks/${done}/evidence/walks.txt`, "walks per call: 1 (was 2)\n");
  scaffoldPacket(paths, config, { slug: done, author: person.handle });
  // Mark both criteria passed and point each at the evidence that was actually saved.
  const packetPath = `${root}/.reggie/tasks/${done}/packet.md`;
  const packet = readText(packetPath) ?? "";
  writeText(
    packetPath,
    packet
      .replace(/- \[ \] (The tiny area walks the chain once per call)\n  evidence: \(.*?\)/, "- [x] $1\n  evidence: evidence/walks.txt")
      .replace(/- \[ \] (A unit test covers a chain of length zero)\n  evidence: \(.*?\)/, "- [x] $1\n  evidence: evidence/tests.txt"),
  );
  decidePacket(paths, done, "approved", person.handle, "Read the diff and ran the tests; the walk count is in the evidence.");
  appendJournal(paths, { person: person.handle, tool: "claude", stage: "implement", slug: done, text: "Walked the chain once and kept the count in the accumulator; the tests are in evidence/tests.txt.", session: "fixture", evidence: [`.reggie/tasks/${done}/evidence/tests.txt`] });
  appendJournal(paths, { person: person.handle, tool: "human", stage: "review", slug: done, text: "Approved: both criteria pass and the evidence is saved.", session: "fixture" });
  commitPaths(root, [`.reggie/tasks/${done}`, ".reggie/journal"], `packet: ${done} approved`);
  git(["switch", "-q", "main"], { cwd: root });
  git(["-c", "commit.gpgsign=false", "merge", "-q", "--no-ff", "-m", `merge: ${done}`, `task/${done}`], { cwd: root });

  fixture.repo.commitAll("journal");

  if (quiet) {
    process.stdout.write(`${root}\n`);
  } else {
    process.stdout.write(
      [
        `root:               ${root}`,
        `ungroomed:          ${fixture.slugs.ungroomed}, ${ungroomed2}, ${ungroomed3}`,
        `groomed:            ${groomed}`,
        `planned:            ${planned}`,
        `in-process:         ${fixture.slugs.inProcess}`,
        `awaiting-decision:  ${fixture.slugs.awaiting}`,
        `done:               ${done}`,
        "",
      ].join("\n"),
    );
  }
}
