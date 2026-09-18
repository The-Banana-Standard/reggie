import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { fillPacket, makePolicyFixture, type PolicyFixture } from "../test/policy-fixture.js";
import { readChecks, recordCheck } from "./checks.js";
import { git, run, type ExecResult } from "./git.js";
import { CHECKS_END, CHECKS_START, evidenceRefs, extractChecklist, isCitation, lintPacket, packetCitations, packetEvidenceRefs, PACKET_SECTIONS, PacketError, renderChecklist, scaffoldPacket } from "./packet.js";
import { checksFile, evidenceRelDir, packetFile, packetRelPath, planFile, taskDir } from "./paths.js";
import { parsePlan, planCriteria } from "./plan.js";
import { parsePacketCriteria } from "./tasks.js";
import { readText, splitFrontMatter, writeText } from "./util.js";

const CLI = path.resolve("src/cli.ts");
const TSX = path.resolve("node_modules/.bin/tsx");
const NOTHING_DECIDED = "Nothing was decided: in this version the policy's verdict is a report (`reggie check <slug>`), and a person decides with `reggie decide`.";

function cli(root: string, args: string[]): ExecResult {
  return run(TSX, [CLI, "--root", root, ...args], { allowFailure: true, cwd: root });
}

function packetText(fx: PolicyFixture): string {
  return readText(packetFile(fx.wtPaths, fx.slug)) ?? "";
}

/** The packet with its checklist cut out, so two versions can be compared outside the markers. */
function outside(content: string): string {
  const block = extractChecklist(content) ?? "";
  return content.replace(block, "<checklist>");
}

function ids(fx: PolicyFixture): string {
  return git(["rev-parse", "main", fx.branch], { cwd: fx.root }).stdout.trim();
}

const who = { person: "pat", tool: "claude", session: "s1" };

describe("the generated checklist", () => {
  let fx: PolicyFixture;
  beforeAll(() => {
    fx = makePolicyFixture({ stage: "built", criteria: ["AC1 The constant equals two", "AC2 A saved output shows the new value", "AC3 Nobody has checked this one"] });
    const dir = evidenceRelDir(fx.slug);
    // Three evidence files in name order, so a by-position pairing would hand one to each criterion.
    fx.wt(`${dir}a-first.txt`, "first\n");
    fx.wt(`${dir}b-second.txt`, "second\n");
    fx.wt(`${dir}c-third.txt`, "third\n");
  });
  afterAll(() => fx.cleanup());

  it("ticks a criterion only when its latest record passes, cites that record's paths and nothing else, and pairs no file with a criterion no record names", () => {
    const dir = evidenceRelDir(fx.slug);
    recordCheck(fx.wtPaths, { slug: fx.slug, criterion: "1", outcome: "pass", evidence: ["c-third.txt", "a-first.txt"], now: new Date("2026-09-18T10:00:00Z"), ...who });
    recordCheck(fx.wtPaths, { slug: fx.slug, criterion: "2", outcome: "pass", evidence: ["b-second.txt"], ...who });
    recordCheck(fx.wtPaths, { slug: fx.slug, criterion: "2", outcome: "fail", note: "the value was three", ...who, now: new Date("2026-09-18T11:00:00Z") });
    const r = scaffoldPacket(fx.wtPaths, fx.config, { slug: fx.slug, author: "pat" });
    expect(r).toMatchObject({ status: "created", created: true, skipped: false });

    const block = (extractChecklist(packetText(fx)) ?? "").split("\n");
    expect(block[0]).toBe(CHECKS_START);
    expect(block.at(-1)).toBe(CHECKS_END);
    const keys = planCriteria(parsePlan(readText(planFile(fx.wtPaths, fx.slug)) ?? "").sections.get("Acceptance criteria") ?? "").map((c) => c.key);
    expect(block.slice(2, -1)).toEqual([
      "- [x] AC1 The constant equals two",
      `  evidence: ${dir}c-third.txt, ${dir}a-first.txt`,
      `  check: pass by pat (claude) at 2026-09-18T10:00:00.000Z · ${keys[0]}`,
      "- [ ] AC2 A saved output shows the new value",
      "  evidence: (none)",
      `  check: fail by pat (claude) at 2026-09-18T11:00:00.000Z · ${keys[1]}`,
      "- [ ] AC3 Nobody has checked this one",
      "  evidence: (none)",
      `  check: none recorded · ${keys[2]}`,
    ]);

    // The task page reads the block back through the one reader: one entry per criterion, with those paths.
    const section = splitFrontMatter(packetText(fx)).body.split("## Acceptance criteria")[1]?.split("\n## ")[0] ?? "";
    expect(parsePacketCriteria(section)).toEqual([
      { text: "AC1 The constant equals two", pass: true, evidence: [`${dir}c-third.txt`, `${dir}a-first.txt`] },
      { text: "AC2 A saved output shows the new value", pass: false, evidence: [] },
      { text: "AC3 Nobody has checked this one", pass: false, evidence: [] },
    ]);
  });

  it("changes only the bytes between the markers after one more record, says current when nothing is new, and still rewrites the whole packet under --force", () => {
    writeText(packetFile(fx.wtPaths, fx.slug), fillPacket(packetText(fx), "- none").replace("## Open risks", "A sentence a person wrote by hand.\n\n## Open risks"));
    const before = packetText(fx);
    recordCheck(fx.wtPaths, { slug: fx.slug, criterion: "3", outcome: "pass", evidence: ["b-second.txt"], ...who });

    const refreshed = cli(fx.worktree, ["packet", fx.slug]);
    expect(refreshed.ok, refreshed.stderr).toBe(true);
    expect(refreshed.stdout).toMatch(/^Refreshed the checklist in \.reggie\/tasks\/two-not-one\/packet\.md from the check records; every byte outside the markers is as it was\./);
    const after = packetText(fx);
    expect(after).not.toBe(before);
    expect(outside(after)).toBe(outside(before));
    expect(extractChecklist(after)).toContain("- [x] AC3 Nobody has checked this one");

    const again = cli(fx.worktree, ["packet", fx.slug]);
    expect(again.stdout).toMatch(/^The checklist in .* is current; nothing was written\./);
    expect(packetText(fx)).toBe(after);
    expect(scaffoldPacket(fx.wtPaths, fx.config, { slug: fx.slug, author: "pat" })).toMatchObject({ status: "current", created: false, skipped: true });

    const forced = cli(fx.worktree, ["packet", fx.slug, "--force"]);
    expect(forced.stdout).toMatch(/^Rewrote /);
    expect(packetText(fx)).not.toContain("A sentence a person wrote by hand.");
    expect(extractChecklist(packetText(fx))).toBe(extractChecklist(after));
  });

  it("leaves a packet with no markers byte-identical and says it predates check records", () => {
    // A landed packet's shape: hand-ticked boxes and free-text evidence lines, no markers.
    const legacy = ["---", `slug: ${fx.slug}`, "title: legacy", "risk: low", "verdict: pending", "decided_by:", "decided_at:", "---", "# Completion", "", "## Acceptance criteria", "- [x] AC1 The constant equals two", "  evidence: evidence/a-first.txt (the run)", "", "## Evidence", "- evidence/a-first.txt", ""].join("\n");
    const kept = packetText(fx);
    writeText(packetFile(fx.wtPaths, fx.slug), legacy);
    try {
      const r = cli(fx.worktree, ["packet", fx.slug]);
      expect(r.ok, r.stderr).toBe(true);
      expect(r.stdout).toMatch(/has no generated checklist: it predates check records and was left exactly as it is/);
      expect(readFileSync(packetFile(fx.wtPaths, fx.slug), "utf8")).toBe(legacy);
      expect(lintPacket(legacy, { slug: fx.slug, checklist: "x" }).errors.join("\n")).toMatch(/no generated checklist; this packet predates check records/);
    } finally {
      writeText(packetFile(fx.wtPaths, fx.slug), kept);
    }
  });

  it("never decides: after a scaffolding, a refreshing, a --force and a --lint run both branch ids and the verdict are what they were, and the last line says so", () => {
    const fresh = makePolicyFixture({ stage: "checked" });
    try {
      const before = ids(fresh);
      const runs: string[][] = [["packet", fresh.slug]];
      const lastLines: string[] = [];
      const step = (args: string[]) => {
        const r = cli(fresh.worktree, args);
        lastLines.push(r.stdout.trimEnd().split("\n").at(-1) ?? "");
        expect(ids(fresh)).toBe(before);
        expect(readText(packetFile(fresh.wtPaths, fresh.slug))).toMatch(/^verdict: pending$/m);
        expect(readText(packetFile(fresh.wtPaths, fresh.slug))).toMatch(/^decided_by:$/m);
        expect(git(["log", "--oneline", "-1", "--format=%H"], { cwd: fresh.root }).stdout.trim()).toBe(before.split("\n")[0]);
      };
      step(runs[0] ?? []);
      recordCheck(fresh.wtPaths, { slug: fresh.slug, review: "code-review", outcome: "pass", ...who });
      recordCheck(fresh.wtPaths, { slug: fresh.slug, criterion: "1", outcome: "fail", ...who });
      step(["packet", fresh.slug]);
      step(["packet", fresh.slug, "--force"]);
      step(["packet", fresh.slug, "--lint"]);
      expect(lastLines).toEqual([NOTHING_DECIDED, NOTHING_DECIDED, NOTHING_DECIDED, NOTHING_DECIDED]);
    } finally {
      fresh.cleanup();
    }
  });

  it("refuses in a checkout that is not on the task branch while that branch exists, names the worktree, and writes no file", () => {
    const folder = taskDir(fx.paths, fx.slug);
    const listing = () => readdirSync(folder).sort();
    const before = listing();
    for (const args of [["packet", fx.slug], ["packet", fx.slug, "--force"], ["packet", fx.slug, "--lint"]]) {
      const r = cli(fx.root, args);
      expect(r.status).toBe(1);
      expect(r.stderr).toContain(`this checkout is on main, not ${fx.branch}. That branch is checked out in ${fx.worktree}; run \`reggie packet ${fx.slug}\` there.`);
    }
    expect(listing()).toEqual(before);
    expect(existsSync(packetFile(fx.paths, fx.slug))).toBe(false);
    expect(git(["status", "--porcelain"], { cwd: fx.root }).stdout).toBe("");
    expect(() => scaffoldPacket(fx.paths, fx.config, { slug: fx.slug, author: "pat" })).toThrow(PacketError);
  });
});

describe("the packet contract", () => {
  let fx: PolicyFixture;
  let good: string;
  let checklist: string;
  beforeAll(() => {
    fx = makePolicyFixture();
    good = packetText(fx);
    checklist = renderChecklist(planCriteria(parsePlan(readText(planFile(fx.wtPaths, fx.slug)) ?? "").sections.get("Acceptance criteria") ?? ""), readChecks(readText(checksFile(fx.wtPaths, fx.slug)) ?? "").records);
  });
  afterAll(() => fx.cleanup());

  it("passes the packet of the passing fixture, from the function and from the CLI", () => {
    expect(lintPacket(good, { slug: fx.slug, checklist })).toEqual({ ok: true, errors: [] });
    const r = cli(fx.worktree, ["packet", fx.slug, "--lint"]);
    expect(r.status, r.stdout + r.stderr).toBe(0);
    expect(r.stdout.split("\n")[0]).toBe(`PASS: ${packetRelPath(fx.slug)} satisfies the packet contract, and every citation resolves on HEAD.`);
  });

  const section = (name: string): RegExp => new RegExp(`## ${name}\\n[\\s\\S]*?(?=\\n## |$)`);
  const faults: { name: string; edit: (p: string) => string; says: RegExp }[] = [
    { name: "a missing slug", edit: (p) => p.replace(/^slug: .*\n/m, ""), says: /^front matter: missing slug$/ },
    { name: "a different slug", edit: (p) => p.replace(/^slug: .*$/m, "slug: other-task"), says: /^front matter: slug is other-task, not two-not-one$/ },
    { name: "a verdict outside the three", edit: (p) => p.replace("verdict: pending", "verdict: shipped"), says: /^front matter: verdict must be pending, approved or needs-work$/ },
    ...PACKET_SECTIONS.map((name) => ({ name: `## ${name} missing`, edit: (p: string) => p.replace(section(name), ""), says: new RegExp(`^missing section: ## ${name}$`) })),
    ...PACKET_SECTIONS.map((name) => ({ name: `## ${name} empty`, edit: (p: string) => p.replace(section(name), `## ${name}\n`), says: new RegExp(`^empty section: ## ${name}$`) })),
    ...PACKET_SECTIONS.map((name) => ({ name: `## ${name} still holding a stand-in`, edit: (p: string) => p.replace(section(name), `## ${name}\n- (whatever the scaffold put here)\n`), says: new RegExp(`^placeholder text still present in ## ${name}$`) })),
    { name: "no generated checklist", edit: (p) => p.replace(CHECKS_START, "").replace(CHECKS_END, ""), says: /^Acceptance criteria: no generated checklist/ },
    { name: "a checklist that differs from what the records render", edit: (p) => p.replace("- [x] AC2", "- [ ] AC2"), says: /^Acceptance criteria: the checklist differs from what the check records render/ },
    { name: "a box ticked by hand", edit: (p) => p.replace(/check: pass by [^\n]*AC1|$^/, "$&").replace(/(- \[x\] AC1[^\n]*\n  evidence: )[^\n]*/, "$1evidence/other.txt"), says: /^Acceptance criteria: the checklist differs/ },
    { name: "a malformed citation", edit: (p) => p.replace("## Evidence\n", "## Evidence\n- evidence/../../../etc/passwd (looks like evidence)\n- evidence/sub/deep.txt\n"), says: /^malformed citation: evidence\/\.\.\/\.\.\/\.\.\/etc\/passwd holds a `\.\.` segment$/ },
  ];
  it.each(faults)("names $name", ({ edit, says }) => {
    const edited = edit(good);
    expect(edited).not.toBe(good);
    const r = lintPacket(edited, { slug: fx.slug, checklist });
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => says.test(e)), r.errors.join("\n")).toBe(true);
  });

  it("exits 1 from the CLI naming each fault, and writes nothing", () => {
    const broken = good.replace("verdict: pending", "verdict: shipped").replace(section("Reviews"), "## Reviews\n- (which review commands ran)\n");
    writeText(packetFile(fx.wtPaths, fx.slug), broken);
    try {
      const r = cli(fx.worktree, ["packet", fx.slug, "--lint"]);
      expect(r.status).toBe(1);
      expect(r.stdout).toContain("FAIL: ");
      expect(r.stdout).toContain("error: front matter: verdict must be pending, approved or needs-work");
      expect(r.stdout).toContain("error: placeholder text still present in ## Reviews");
      expect(packetText(fx)).toBe(broken);
    } finally {
      writeText(packetFile(fx.wtPaths, fx.slug), good);
    }
  });
});

describe("the one reader of evidence references", () => {
  it("takes the leading token of each comma- or semicolon-separated piece, and still returns what the older reader returned", () => {
    expect(evidenceRefs("evidence/tests.txt (the 12 cases), evidence/run.txt; `evidence/shot.png` at 390 wide")).toEqual(["evidence/tests.txt", "evidence/run.txt", "evidence/shot.png"]);
    expect(evidenceRefs("(evidence/tests.txt, evidence/run.txt)")).toEqual(["evidence/tests.txt", "evidence/run.txt"]);
    expect(evidenceRefs("[evidence/tests.txt]: the run, see also src/c.ts")).toEqual(["evidence/tests.txt"]);
    expect(evidenceRefs("evidence/tests.txt.")).toEqual(["evidence/tests.txt"]);
    expect(evidenceRefs("tests.txt")).toEqual(["tests.txt"]);
    // Words, numbers and the scaffold's stand-ins are not references.
    expect(evidenceRefs("(none)")).toEqual([]);
    expect(evidenceRefs("(path to the file that proves this)")).toEqual([]);
    expect(evidenceRefs("none yet, 1052 passed; see the run")).toEqual([]);
    // Returned verbatim, as the older reader did; whether one may be followed is the citation rule's and the resolver's business.
    expect(evidenceRefs("../../../etc/passwd, /etc/hosts")).toEqual(["../../../etc/passwd", "/etc/hosts"]);
  });

  it("reads structured lines only, and calls a reference a citation only when it names the task's own evidence folder", () => {
    const packet = [
      "---",
      "slug: demo",
      "---",
      "# Completion",
      "Prose that mentions evidence/prose.txt is not read.",
      "## Acceptance criteria",
      "- [x] AC1 evidence/in-a-criterion.txt is not read either",
      "  evidence: evidence/one.txt (src/c.ts changed), .reggie/tasks/demo/evidence/two.txt",
      "  check: pass by pat (claude) at now · c:000000000000",
      "## Evidence",
      "- evidence/three.txt — the run",
      "- .reggie/tasks/other/evidence/theirs.txt belongs to another task",
      "- src/c.ts is a source file",
      "- /abs/repo/.reggie/tasks/demo/evidence/abs.txt",
      "## Changes",
      "- evidence/not-here.txt",
    ].join("\n");
    expect(packetEvidenceRefs(packet)).toEqual(["evidence/one.txt", ".reggie/tasks/demo/evidence/two.txt", "evidence/three.txt", ".reggie/tasks/other/evidence/theirs.txt", "src/c.ts", "/abs/repo/.reggie/tasks/demo/evidence/abs.txt"]);
    expect(packetCitations("demo", packet)).toEqual(["evidence/one.txt", ".reggie/tasks/demo/evidence/two.txt", "evidence/three.txt", "/abs/repo/.reggie/tasks/demo/evidence/abs.txt"]);
    expect(isCitation("demo", "./evidence/x.txt")).toBe(true);
    expect(isCitation("demo", "src/evidence/x.txt")).toBe(false);
    expect(isCitation("demo", "../../../etc/passwd")).toBe(false);
  });
});
