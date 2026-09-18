import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { makePolicyFixture, type PolicyFixture } from "../test/policy-fixture.js";
import { CheckError, cleanLine, evidencePath, latestRecords, MAX_CHECK_LINE_BYTES, readChecks, recordCheck, selectCriterion, type CheckInput } from "./checks.js";
import { git, run, type ExecResult } from "./git.js";
import { checksFile, evidenceRelDir, planFile, planRelPath } from "./paths.js";
import { parsePlan, planCriteria } from "./plan.js";
import { readText } from "./util.js";

const CLI = path.resolve("src/cli.ts");
const TSX = path.resolve("node_modules/.bin/tsx");

function cli(root: string, args: string[]): ExecResult {
  return run(TSX, [CLI, "--root", root, ...args], { allowFailure: true, cwd: root });
}

/** The checks file's bytes, hashed; "absent" when there is none. A refusal must leave this as it was. */
function fileHash(fx: PolicyFixture): string {
  const file = checksFile(fx.wtPaths, fx.slug);
  return existsSync(file) ? createHash("sha256").update(readFileSync(file)).digest("hex") : "absent";
}

function lines(fx: PolicyFixture): string[] {
  return (readText(checksFile(fx.wtPaths, fx.slug)) ?? "").split("\n").filter((l) => l !== "");
}

const who = { person: "test", tool: "vitest", session: "s1" };

describe("recordCheck and reggie check", () => {
  let fx: PolicyFixture;
  beforeAll(() => {
    fx = makePolicyFixture({
      stage: "built",
      criteria: ["AC1 The constant equals two after the change", "AC12 A saved command output shows the new value", "AC13 The same label start, AC1, must not choose this one", "Shared label one of two", "Shared label two of two"],
    });
    fx.wt(`${evidenceRelDir(fx.slug)}tests.txt`, "2 passed\nexit 0\n");
    fx.wt(`${evidenceRelDir(fx.slug)}run.txt`, "two\nexit 0\n");
  });
  afterAll(() => fx.cleanup());

  it("appends exactly one line holding every field, with full evidence paths however the file was spelled, and creates no commit and stages nothing", () => {
    const head = git(["rev-parse", "HEAD"], { cwd: fx.worktree }).stdout.trim();
    const dir = evidenceRelDir(fx.slug);
    const r = cli(fx.worktree, ["check", fx.slug, "1", "pass", "--evidence", "tests.txt", "--evidence", "evidence/run.txt", "--evidence", `${dir}tests.txt`, "--note", "ran by hand"]);
    expect(r.ok, r.stderr).toBe(true);
    expect(r.stdout).toMatch(/^Recorded pass for criterion 1 \(c:[0-9a-f]{12}\) in \.reggie\/tasks\/two-not-one\/checks\.jsonl\. It is not committed/);
    expect(lines(fx)).toHaveLength(1);
    const record = JSON.parse(lines(fx)[0] ?? "");
    expect(Object.keys(record)).toEqual(["v", "kind", "key", "n", "text", "outcome", "evidence", "note", "person", "tool", "session", "at", "head"]);
    expect(record).toMatchObject({ v: 1, kind: "criterion", n: 1, text: "AC1 The constant equals two after the change", outcome: "pass", note: "ran by hand", head });
    expect(record.key).toMatch(/^c:[0-9a-f]{12}$/);
    expect(record.evidence).toEqual([`${dir}tests.txt`, `${dir}run.txt`]);
    expect(record.head).toMatch(/^[0-9a-f]{40}$/);
    expect(Number.isFinite(Date.parse(record.at))).toBe(true);
    expect(git(["rev-parse", "HEAD"], { cwd: fx.worktree }).stdout.trim()).toBe(head);
    expect(git(["diff", "--cached", "--name-only"], { cwd: fx.worktree }).stdout.trim()).toBe("");
  });

  it("chooses a criterion by its number, its key, or a label that ends where the selector does", () => {
    const criteria = planCriteria(parsePlan(readText(planFile(fx.wtPaths, fx.slug)) ?? "").sections.get("Acceptance criteria") ?? "");
    expect(selectCriterion(criteria, "2").n).toBe(2);
    expect(selectCriterion(criteria, criteria[2]?.key ?? "").n).toBe(3);
    expect(selectCriterion(criteria, "AC1").n).toBe(1);
    expect(selectCriterion(criteria, "AC12").n).toBe(2);
    expect(() => selectCriterion(criteria, "Shared label")).toThrow(/matches 2 criteria/);
  });

  const refusals: { name: string; args: string[]; says: RegExp; lists?: boolean; setup?: () => void; undo?: () => void; root?: () => string }[] = [
    { name: "a number past the last criterion", args: ["9", "pass", "--evidence", "tests.txt"], says: /`9` matches no criterion/, lists: true },
    { name: "an unknown key", args: ["c:ffffffffffff", "pass", "--evidence", "tests.txt"], says: /`c:ffffffffffff` matches no criterion/, lists: true },
    { name: "a label two criteria share", args: ["Shared label", "pass", "--evidence", "tests.txt"], says: /`Shared label` matches 2 criteria/, lists: true },
    { name: "an outcome that is neither pass nor fail", args: ["1", "maybe"], says: /the outcome must be pass or fail, not `maybe`/ },
    { name: "a criterion pass with no evidence", args: ["1", "pass"], says: /a criterion passes only with evidence/ },
    { name: "a checkout that is not on the task branch", args: ["1", "pass", "--evidence", "tests.txt"], says: /this checkout is on main, not task\/two-not-one\. Check records ride the task branch/, root: () => fx.root },
    {
      name: "a pass while a tracked file outside .reggie/ is modified",
      args: ["1", "pass", "--evidence", "tests.txt"],
      says: /a pass proves committed code, and this checkout has uncommitted changes outside \.reggie\/ \(`src\/b\.ts`\)/,
      setup: () => fx.wt("src/b.ts", "export const b = 99;\n"),
      undo: () => void git(["checkout", "--", "src/b.ts"], { cwd: fx.worktree }),
    },
  ];
  it.each(refusals)("exits 1 with a sentence and leaves the checks file byte-identical for $name", ({ args, says, lists, setup, undo, root }) => {
    setup?.();
    try {
      const before = fileHash(fx);
      const r = cli(root ? root() : fx.worktree, ["check", fx.slug, ...args]);
      expect(r.status).toBe(1);
      expect(r.stderr).toMatch(says);
      if (lists) {
        expect(r.stderr).toMatch(/The criteria of this plan:\n\s+1\. c:[0-9a-f]{12}  AC1 The constant equals two/);
        expect(r.stderr).toMatch(/5\. c:[0-9a-f]{12}  Shared label two of two/);
      }
      expect(fileHash(fx)).toBe(before);
    } finally {
      undo?.();
    }
  });

  it("refuses a slug with no plan", () => {
    const r = cli(fx.worktree, ["check", "no-such-task", "1", "fail"]);
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/there is no plan for no-such-task in this checkout/);
    expect(existsSync(path.join(fx.worktree, ".reggie/tasks/no-such-task"))).toBe(false);
  });

  it("records a fail with no evidence, even while a tracked file is modified", () => {
    fx.wt("src/b.ts", "export const b = 98;\n");
    try {
      const r = recordCheck(fx.wtPaths, { slug: fx.slug, criterion: "2", outcome: "fail", note: "the output is missing", ...who });
      expect(r.record).toMatchObject({ kind: "criterion", n: 2, outcome: "fail", evidence: [] });
    } finally {
      git(["checkout", "--", "src/b.ts"], { cwd: fx.worktree });
    }
  });

  it("refuses every bad evidence path, appending nothing, each with a sentence that says which", () => {
    const dir = path.join(fx.worktree, evidenceRelDir(fx.slug));
    writeFileSync(path.join(dir, "empty.txt"), "");
    mkdirSync(path.join(dir, "folder"), { recursive: true });
    writeFileSync(path.join(dir, "folder", "inner.txt"), "inner\n");
    symlinkSync("tests.txt", path.join(dir, "link.txt"));
    const bad: [string, RegExp][] = [
      ["/etc/hosts", /is an absolute path/],
      ["evidence/../plan.md", /holds a `\.\.` segment/],
      ["evidence\\tests.txt", /holds a backslash/],
      [`tests${String.fromCharCode(7)}.txt`, /holds a control character or a line break/],
      ["src/a.ts", /lies outside the task's evidence folder/],
      ["evidence/folder/inner.txt", /lies in a subfolder of the evidence folder/],
      ["nope.txt", /does not exist/],
      ["empty.txt", /is empty\. An empty file cannot be told from a redirect that failed/],
      ["folder", /is a directory/],
      ["link.txt", /is a symbolic link/],
    ];
    const seen = new Set<string>();
    for (const [file, says] of bad) {
      const before = fileHash(fx);
      let message = "";
      try {
        recordCheck(fx.wtPaths, { slug: fx.slug, criterion: "1", outcome: "pass", evidence: [file], ...who });
      } catch (err) {
        expect(err).toBeInstanceOf(CheckError);
        message = (err as Error).message;
      }
      expect(message, file).toMatch(says);
      expect(fileHash(fx), file).toBe(before);
      seen.add(message.replace(/`[^`]*`/, ""));
    }
    expect(seen.size).toBe(bad.length);
  });

  it("records a review under r:<name>, and refuses a name with an uppercase letter, a space or a slash", () => {
    const r = cli(fx.worktree, ["check", fx.slug, "--review", "code-review", "fail", "--note", "two findings open"]);
    expect(r.ok, r.stderr).toBe(true);
    expect(JSON.parse(lines(fx).at(-1) ?? "")).toMatchObject({ kind: "review", key: "r:code-review", n: 0, text: "code-review", outcome: "fail", evidence: [] });
    for (const name of ["Code-Review", "code review", "code/review"]) {
      const before = fileHash(fx);
      expect(() => recordCheck(fx.wtPaths, { slug: fx.slug, review: name, outcome: "pass", ...who })).toThrow(/is not a review name/);
      expect(fileHash(fx)).toBe(before);
    }
    expect(() => recordCheck(fx.wtPaths, { slug: fx.slug, criterion: "1", review: "code-review", outcome: "pass", ...who } as CheckInput)).toThrow(/name one thing to record/);
  });

  it("lets a key that is in the file and no longer in the plan be superseded by naming it", () => {
    const original = readText(planFile(fx.wtPaths, fx.slug)) ?? "";
    const old = recordCheck(fx.wtPaths, { slug: fx.slug, criterion: "4", outcome: "fail", ...who }).record;
    fx.wt(planRelPath(fx.slug), original.replace("Shared label one of two", "Shared label one of two, reworded"));
    try {
      expect(() => recordCheck(fx.wtPaths, { slug: fx.slug, criterion: "c:ffffffffffff", outcome: "fail", ...who })).toThrow(/matches no criterion/);
      const again = recordCheck(fx.wtPaths, { slug: fx.slug, criterion: old.key, outcome: "pass", evidence: ["tests.txt"], ...who }).record;
      expect(again).toMatchObject({ key: old.key, n: 4, text: "Shared label one of two", outcome: "pass" });
      expect(latestRecords(readChecks(readText(checksFile(fx.wtPaths, fx.slug)) ?? "").records).get(old.key)?.outcome).toBe("pass");
    } finally {
      fx.wt(planRelPath(fx.slug), original);
    }
  });
});

describe("hostile text in and out of a checks file (AC7)", () => {
  let fx: PolicyFixture;
  const RLO = String.fromCharCode(0x202e);
  const hostile = `line one\nline "two" \\ back [[task/x|y]] </script> ${RLO}evil${String.fromCharCode(0)}${String.fromCharCode(0x200b)}`;
  beforeAll(() => {
    fx = makePolicyFixture({ stage: "built", criteria: [`AC1 Holds a "quote", a \\ backslash, [[task/x|y]], </script> and ${RLO}an override`, "AC2 An ordinary criterion for the second row"] });
    fx.wt(`${evidenceRelDir(fx.slug)}tests.txt`, "2 passed\n");
  });
  afterAll(() => fx.cleanup());

  it("writes a hostile note and criterion as one line that JSON.parse reads back, with control and bidirectional characters gone", () => {
    const before = lines(fx).length;
    recordCheck(fx.wtPaths, { slug: fx.slug, criterion: "1", outcome: "pass", evidence: ["tests.txt"], note: hostile, ...who });
    const added = lines(fx).slice(before);
    expect(added).toHaveLength(1);
    const record = JSON.parse(added[0] ?? "");
    expect(record.note).toBe('line one line "two" \\ back [[task/x|y]] </script> evil');
    expect(record.text).toBe('AC1 Holds a "quote", a \\ backslash, [[task/x|y]], </script> and an override');
    for (const value of [record.note, record.text]) expect(/[\x00-\x1f\x7f]/.test(value) || value.includes(RLO)).toBe(false);
    expect(cleanLine(`a${String.fromCharCode(0x2066)}b${String.fromCharCode(0x2069)}c\td`, 100)).toBe("abc d");
  });

  it("yields the valid records of a file that also holds lines that are not records, counts those by line number, and leaves Object.prototype alone", () => {
    const good = lines(fx)[0] ?? "";
    const parsed = JSON.parse(good);
    const bad = [
      "this is not json",
      "[1, 2, 3]",
      JSON.stringify({ ...parsed, note: "x".repeat(MAX_CHECK_LINE_BYTES) }),
      `{"__proto__": {"polluted": true}, ${good.slice(1)}`,
      JSON.stringify({ ...parsed, evidence: "tests.txt" }),
      JSON.stringify({ ...parsed, v: 2 }),
      JSON.stringify({ ...parsed, head: "HEAD" }),
      "null",
    ];
    const content = Buffer.from([good, ...bad, "", good].join("\n"), "utf8").toString("utf8");
    const read = readChecks(content);
    expect(read.records).toHaveLength(2);
    expect(read.bad.map((b) => b.line)).toEqual([2, 3, 4, 5, 6, 7, 8, 9]);
    expect(read.bad.map((b) => b.why)).toEqual(["not JSON", "not a JSON object", "longer than 16 KB", "holds a field that is not part of a record (__proto__)", "evidence is not a list of paths", "not a version 1 record", "head is not a 40-character commit id", "not a JSON object"]);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(Object.prototype.hasOwnProperty.call(Object.prototype, "polluted")).toBe(false);
    for (const r of read.records) expect(Object.getPrototypeOf(r)).toBe(Object.prototype);
    expect(readChecks("").records).toEqual([]);
  });

  it("judges an evidence path by its words alone, accepting the three spellings of one file", () => {
    const dir = evidenceRelDir(fx.slug);
    for (const spelled of ["tests.txt", "evidence/tests.txt", `${dir}tests.txt`, `./${dir}tests.txt`]) expect(evidencePath(fx.slug, spelled)).toEqual({ ok: true, path: `${dir}tests.txt`, name: "tests.txt" });
    expect(evidencePath(fx.slug, ".reggie/tasks/other-task/evidence/tests.txt")).toMatchObject({ ok: false, why: expect.stringContaining("lies outside the task's evidence folder") });
    expect(evidencePath(fx.slug, "")).toMatchObject({ ok: false });
  });
});
