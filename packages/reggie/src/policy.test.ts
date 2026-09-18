import { createHash } from "node:crypto";
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { makePolicyFixture, policySnapshot, type PolicyFixture } from "../test/policy-fixture.js";
import { recordCheck, type CheckRecord } from "./checks.js";
import { git, run, type ExecOptions, type ExecResult } from "./git.js";
import { landTask } from "./land.js";
import { resolveEvidence } from "./packet.js";
import { checksFile, checksRelPath, evidenceRelDir, packetFile, packetRelPath, planFile, planRelPath } from "./paths.js";
import { controlFileReason, evaluateCompletion, formatReport, integrationRoot, REPORT_PREAMBLE, type GateId, type PolicyReport } from "./policy.js";
import { readText, writeText } from "./util.js";

const CLI = path.resolve("src/cli.ts");
const TSX = path.resolve("node_modules/.bin/tsx");

function cli(root: string, args: string[]): ExecResult {
  return run(TSX, [CLI, "--root", root, ...args], { allowFailure: true, cwd: root });
}

function gate(report: PolicyReport, id: GateId) {
  const found = report.gates.find((g) => g.id === id);
  if (!found) throw new Error(`no ${id} gate in a ${report.verdict} report: ${report.summary}`);
  return found;
}

function failing(report: PolicyReport): GateId[] {
  return report.gates.filter((g) => g.status === "fail").map((g) => g.id);
}

/** Put both checkouts back on the commits they were on, with nothing uncommitted, so one fixture serves many tamperings. */
function restorer(fx: PolicyFixture): () => void {
  const tip = git(["rev-parse", "HEAD"], { cwd: fx.worktree }).stdout.trim();
  const base = git(["rev-parse", "HEAD"], { cwd: fx.root }).stdout.trim();
  return () => {
    for (const [dir, sha] of [[fx.worktree, tip], [fx.root, base]] as const) {
      git(["reset", "-q", "--hard", sha], { cwd: dir });
      git(["clean", "-fdq"], { cwd: dir });
    }
  };
}

/** A check record written by hand, as anyone who can commit on the branch could write one. */
function handRecord(fx: PolicyFixture, fields: Partial<CheckRecord>): void {
  const head = git(["rev-parse", "HEAD"], { cwd: fx.worktree }).stdout.trim();
  const record = { v: 1, kind: "criterion", key: "c:000000000000", n: 1, text: "by hand", outcome: "pass", evidence: [], note: "", person: "hand", tool: "editor", session: "none", at: "2026-09-18T00:00:00.000Z", head, ...fields };
  appendFileSync(checksFile(fx.wtPaths, fx.slug), `${JSON.stringify(record)}\n`, "utf8");
}

describe("the policy report on a passing task", () => {
  let fx: PolicyFixture;
  let restore: () => void;
  beforeAll(() => {
    fx = makePolicyFixture();
    restore = restorer(fx);
  });
  afterEach(() => restore());
  afterAll(() => fx.cleanup());

  it("would pass, with every gate holding, and reads the same from both checkouts", () => {
    const fromBase = evaluateCompletion(fx.root, fx.slug);
    expect(fromBase.verdict, JSON.stringify(fromBase.gates, null, 1)).toBe("would-pass");
    expect(fromBase.gates.map((g) => g.id)).toEqual(["policy", "plan", "controls", "packet", "criteria", "evidence", "risk", "merge"]);
    expect(fromBase.gates.every((g) => g.status === "pass")).toBe(true);
    expect(fromBase.base).toEqual({ branch: "main", commit: git(["rev-parse", "main"], { cwd: fx.root }).stdout.trim() });
    expect(fromBase.task).toEqual({ branch: fx.branch, commit: git(["rev-parse", fx.branch], { cwd: fx.root }).stdout.trim() });
    expect(fromBase.policy).toEqual({ mode: "solo", plans: "high", completions: "low", source: { plans: "base-commit", completions: "base-commit" } });
    // Only the one code file counts: the task's own folder and the journal are left out.
    expect(fromBase.risk).toEqual({ plan: "low", planFiles: "low", changed: "low", effective: "low", changedCount: 1, unplanned: [] });
    expect(fromBase.criteria.map((c) => [c.n, c.status, c.record?.person, c.record?.tool])).toEqual([[1, "pass", fx.person.handle, "fixture"], [2, "pass", fx.person.handle, "fixture"]]);
    expect(fromBase.criteria[0]?.record?.at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(JSON.stringify(evaluateCompletion(fx.worktree, fx.slug))).toBe(JSON.stringify(fromBase));
  });

  it("prints, in order, that it is a report, the two commits, the policy, the risk, the criteria, the gates and the verdict; --json is byte-identical from both checkouts; exit 0 only for would pass", () => {
    const text = cli(fx.root, ["check", fx.slug]);
    expect(text.ok, text.stderr).toBe(true);
    const lines = text.stdout.split("\n");
    expect(lines[0]).toBe(REPORT_PREAMBLE);
    expect(lines[0]).toMatch(/report, not a decision.*a person decides/);
    const at = (needle: RegExp) => lines.findIndex((l) => needle.test(l));
    const order = [/^base: main @ [0-9a-f]{12}$/, /^branch: task\/two-not-one @ [0-9a-f]{12}$/, /^policy \(solo mode\): completions low \(from the base commit's policy block\)/, /^risk: .*effective low$/, /^criteria:$/, /^ +1\. pass +AC1 .* — pass by .* \(fixture\) at \d{4}-/, /^gates:$/, /^ +pass +policy:/, /^ +pass +merge:/, /^verdict: would pass/].map(at);
    expect(order.every((i) => i >= 0), text.stdout).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);

    const a = cli(fx.root, ["check", fx.slug, "--json"]);
    const b = cli(fx.worktree, ["check", fx.slug, "--json"]);
    expect(a.ok && b.ok).toBe(true);
    expect(a.stdout).toBe(b.stdout);
    expect(JSON.parse(a.stdout).verdict).toBe("would-pass");
    expect(formatReport(JSON.parse(a.stdout))).toBe(text.stdout.trimEnd());
  });

  it("reads commits only: uncommitted edits in either checkout change nothing in the --json output", () => {
    const before = createHash("sha256").update(JSON.stringify(evaluateCompletion(fx.root, fx.slug))).digest("hex");
    const snap = policySnapshot(fx);
    fx.wt(planRelPath(fx.slug), (readText(planFile(fx.wtPaths, fx.slug)) ?? "").replace("risk: low", "risk: high").replace(/^- \[ \] AC2.*$/m, ""));
    fx.wt(".reggie/config.yaml", "mode: team\npolicy:\n  completions: high\ndefaultBranch: elsewhere\n");
    handRecord(fx, { outcome: "fail" });
    fx.wt(packetRelPath(fx.slug), (readText(packetFile(fx.wtPaths, fx.slug)) ?? "").replace("verdict: pending", "verdict: approved"));
    fx.wt(`${evidenceRelDir(fx.slug)}tests.txt`, "");
    fx.base(".reggie/config.yaml", (readText(fx.paths.config) ?? "").replace("completions: low", "completions: high"));
    for (const root of [fx.root, fx.worktree]) {
      expect(createHash("sha256").update(JSON.stringify(evaluateCompletion(root, fx.slug))).digest("hex")).toBe(before);
    }
    // The worktree's own config named another default branch and team mode; the report still read main, in solo mode.
    expect(evaluateCompletion(fx.worktree, fx.slug).base?.branch).toBe("main");
    expect(policySnapshot(fx).refs).toBe(snap.refs);
  });

  it("finds the integration checkout by structure, and only when git agrees it is one", () => {
    expect(integrationRoot(fx.worktree)).toBe(fx.root);
    expect(integrationRoot(fx.root)).toBe(fx.root);
    // A directory that merely looks like a Reggie worktree, inside a checkout git does not list that way, is its own root.
    expect(integrationRoot(path.join(fx.root, ".worktree", "no-such-task"))).toBe(path.join(fx.root, ".worktree", "no-such-task"));
  });

  it("evaluates and formats without moving a ref, the index, a tracked file or MERGE_HEAD in either checkout", () => {
    const before = policySnapshot(fx);
    evaluateCompletion(fx.root, fx.slug);
    evaluateCompletion(fx.worktree, fx.slug);
    cli(fx.worktree, ["check", fx.slug]);
    expect(policySnapshot(fx)).toEqual(before);
  });

  it("shows a passing review without requiring one, and refuses when a review's latest record fails", () => {
    recordCheck(fx.wtPaths, { slug: fx.slug, review: "code-review", outcome: "pass", person: "rev", tool: "claude", session: "s" });
    fx.writePacket();
    fx.commitWt("review passed");
    const passed = evaluateCompletion(fx.root, fx.slug);
    expect(passed.verdict, JSON.stringify(passed.gates, null, 1)).toBe("would-pass");
    expect(passed.reviews.map((r) => [r.name, r.key, r.outcome, r.record.person])).toEqual([["code-review", "r:code-review", "pass", "rev"]]);

    recordCheck(fx.wtPaths, { slug: fx.slug, review: "code-review", outcome: "fail", note: "a finding is open", person: "rev", tool: "claude", session: "s" });
    fx.commitWt("review failed");
    const refused = evaluateCompletion(fx.root, fx.slug);
    expect(refused.verdict).toBe("refused");
    expect(gate(refused, "criteria").reasons.join(" ")).toContain("the review code-review failed its latest check");
  });

  it("never throws: a failure nobody foresaw comes back as not evaluated, without the checkout's path in it", () => {
    const runner = (args: string[], opts?: ExecOptions): ExecResult => {
      if (args.includes("ls-tree")) throw new Error(`spawn git ENOENT in ${fx.root}/.git`);
      return git(args, opts);
    };
    const report = evaluateCompletion(fx.root, fx.slug, { runner });
    expect(report.verdict).toBe("not-evaluated");
    expect(report.summary).toMatch(/^not evaluated: the evaluation itself failed \(spawn git ENOENT in \.\/\.git\)\. Nothing was decided/);
    expect(report.summary).not.toContain(fx.root);
    expect(report.gates).toEqual([]);
  });

  it("refuses naming the lines of a checks file that are not records", () => {
    appendFileSync(checksFile(fx.wtPaths, fx.slug), "not json at all\n[1,2,3]\n", "utf8");
    fx.commitWt("two bad lines");
    const report = evaluateCompletion(fx.root, fx.slug);
    expect(report.verdict).toBe("refused");
    expect(report.badLines.map((b) => [b.line, b.why])).toEqual([[3, "not JSON"], [4, "not a JSON object"]]);
    const reasons = gate(report, "criteria").reasons.join(" ");
    expect(reasons).toContain("line 3 of checks.jsonl is not a record");
    expect(reasons).toContain("line 4 of checks.jsonl is not a record");
  });
});

describe("what the branch may not change (AC20)", () => {
  let fx: PolicyFixture;
  let restore: () => void;
  beforeAll(() => {
    // A medium plan under a medium policy, so that lowering the plan's risk on the branch is a real tampering.
    fx = makePolicyFixture({ files: ["src/shared/util.ts"], policy: { plans: "high", completions: "medium" } });
    restore = restorer(fx);
  });
  afterEach(() => restore());
  afterAll(() => fx.cleanup());

  it("starts from a task that would pass", () => {
    const report = evaluateCompletion(fx.root, fx.slug);
    expect(report.verdict, JSON.stringify(report.gates, null, 1)).toBe("would-pass");
    expect(report.risk?.effective).toBe("medium");
  });

  const plan = (f: PolicyFixture): string => readText(planFile(f.wtPaths, f.slug)) ?? "";
  const packet = (f: PolicyFixture): string => readText(packetFile(f.wtPaths, f.slug)) ?? "";
  const rows: { name: string; tamper: (f: PolicyFixture) => void; gate: GateId; names: RegExp; baseValues?: boolean }[] = [
    { name: "its own plan's risk lowered", tamper: (f) => f.wt(planRelPath(f.slug), plan(f).replace("risk: medium", "risk: low")), gate: "controls", names: /\.reggie\/tasks\/two-not-one\/plan\.md: its own plan.*the plan's risk line reads low on the branch and medium on main; the report uses medium/, baseValues: true },
    { name: "a criterion deleted from its own plan", tamper: (f) => f.wt(planRelPath(f.slug), plan(f).replace(/^- \[ \] AC2.*\n/m, "")), gate: "controls", names: /plan\.md: its own plan.*criterion 2 of the plan on main is deleted or reworded on the branch; the report judges the 2 on main/, baseValues: true },
    { name: "a criterion reworded in its own plan", tamper: (f) => f.wt(planRelPath(f.slug), plan(f).replace("equals two", "equals three")), gate: "controls", names: /plan\.md: its own plan.*criterion 1 of the plan on main is deleted or reworded.*holds criteria that are not on main/, baseValues: true },
    { name: "the config widened to completions: high", tamper: (f) => f.wt(".reggie/config.yaml", (readText(f.wtPaths.config) ?? "").replace("completions: medium", "completions: high")), gate: "controls", names: /\.reggie\/config\.yaml: the config/, baseValues: true },
    { name: "the people file changed", tamper: (f) => appendFileSync(f.wtPaths.people, "  - name: Mallory\n    email: m@example.com\n    handle: mallory\n    role: maintainer\n"), gate: "controls", names: /\.reggie\/people\.yaml: the people file/ },
    { name: "another task's plan changed", tamper: (f) => f.wt(".reggie/tasks/other-task/plan.md", "# someone else's plan\n"), gate: "controls", names: /\.reggie\/tasks\/other-task\/plan\.md: another task's folder/ },
    { name: ".mcp.json changed", tamper: (f) => f.wt(".mcp.json", '{"mcpServers":{"evil":{"command":"sh"}}}\n'), gate: "controls", names: /\.mcp\.json: the MCP server settings/ },
    { name: ".gitattributes changed", tamper: (f) => appendFileSync(path.join(f.worktree, ".gitattributes"), "*.ts merge=ours\n"), gate: "controls", names: /\.gitattributes: the merge and diff rules/ },
    { name: "a file under .claude/ added", tamper: (f) => f.wt(".claude/settings.json", "{}\n"), gate: "controls", names: /\.claude\/settings\.json: the session tool settings/ },
    { name: "a packet that already says approved", tamper: (f) => f.wt(packetRelPath(f.slug), packet(f).replace("verdict: pending", "verdict: approved")), gate: "packet", names: /already says approved/ },
    { name: "a packet that says needs-work", tamper: (f) => f.wt(packetRelPath(f.slug), packet(f).replace("verdict: pending", "verdict: needs-work")), gate: "packet", names: /says needs-work/ },
    { name: "a packet whose slug names another task", tamper: (f) => f.wt(packetRelPath(f.slug), packet(f).replace(`slug: ${f.slug}`, "slug: other-task")), gate: "packet", names: /slug is other-task, not two-not-one/ },
  ];
  it.each(rows)("refuses $name, naming it", ({ tamper, gate: id, names, baseValues }) => {
    tamper(fx);
    fx.commitWt("tamper");
    const report = evaluateCompletion(fx.root, fx.slug);
    expect(report.verdict).toBe("refused");
    expect(gate(report, id).status).toBe("fail");
    expect(gate(report, id).reasons.join(" ")).toMatch(names);
    if (baseValues) {
      // What the report prints is the base commit's: two criteria in their original words, a medium plan, a medium policy.
      expect(report.criteria.map((c) => c.text)).toEqual(["AC1 The constant exported from the file equals two after the change", "AC2 A saved command output shows the new value printed by node"]);
      expect(report.risk?.plan).toBe("medium");
      expect(report.policy?.completions).toBe("medium");
    }
  });

  it("names every control file, in any letter case, and nothing else", () => {
    for (const file of [".reggie/tasks/two-not-one/plan.md", ".reggie/config.yaml", ".reggie/people.yaml", ".reggie/tasks/other/brief.md", ".mcp.json", ".gitattributes", ".claude/commands/x.md", ".MCP.json", ".Claude/settings.json"]) {
      expect(controlFileReason("two-not-one", file), file).not.toBeNull();
    }
    for (const file of [".reggie/tasks/two-not-one/packet.md", ".reggie/tasks/two-not-one/checks.jsonl", ".reggie/tasks/two-not-one/evidence/a.txt", ".reggie/intake.md", ".reggie/journal/2026-09-18/x.md", "src/a.ts", "CLAUDE.md", "docs/.claude.md"]) {
      expect(controlFileReason("two-not-one", file), file).toBeNull();
    }
  });
});

describe("where the policy comes from (AC21)", () => {
  const made: PolicyFixture[] = [];
  const make = (opts: Parameters<typeof makePolicyFixture>[0]): PolicyFixture => {
    const fx = makePolicyFixture(opts);
    made.push(fx);
    return fx;
  };
  afterAll(() => made.forEach((fx) => fx.cleanup()));

  it("refuses a base whose policy says completions: none, as not allowed on that branch", () => {
    const fx = make({ policy: { plans: "high", completions: "none" } });
    const report = evaluateCompletion(fx.root, fx.slug);
    expect(report.verdict).toBe("refused");
    expect(gate(report, "policy").reasons.join(" ")).toMatch(/completions: none .*no completion passes without a person on main/);
  });

  it("reports the solo defaults, and says they are defaults, for a base config with no policy block", () => {
    const fx = make({ policy: null });
    const report = evaluateCompletion(fx.root, fx.slug);
    expect(report.verdict, JSON.stringify(report.gates, null, 1)).toBe("would-pass");
    expect(report.policy).toEqual({ mode: "solo", plans: "high", completions: "low", source: { plans: "mode-default", completions: "mode-default" } });
    expect(formatReport(report)).toContain("completions low (the mode's default)");
  });

  it("does not evaluate a base in team mode, or one whose config does not parse, and says why without throwing", () => {
    const team = make({ configText: "mode: team\nmcpServerName: reggie\n" });
    const teamReport = evaluateCompletion(team.worktree, team.slug);
    expect(teamReport.verdict).toBe("not-evaluated");
    expect(teamReport.summary).toMatch(/main is in team mode/);
    expect(teamReport.gates).toEqual([]);

    const broken = make({ stage: "built" });
    broken.base(".reggie/config.yaml", "mode: solo\npolicy: [unclosed\n  completions: : low\n");
    broken.commitBase("a config that is not YAML");
    // The integration checkout's own copy is the broken one too, so the base cannot even be named from it.
    const fromDisk = evaluateCompletion(broken.root, broken.slug);
    expect(fromDisk.verdict).toBe("not-evaluated");
    expect(fromDisk.summary).toMatch(/does not parse/);
    // With the disk copy repaired and the commit still broken, it is the base commit's copy that stops it.
    writeText(broken.paths.config, "mode: solo\n");
    const fromCommit = evaluateCompletion(broken.root, broken.slug);
    expect(fromCommit.verdict).toBe("not-evaluated");
    expect(fromCommit.summary).toMatch(/\.reggie\/config\.yaml on main does not parse/);
    expect(cli(broken.root, ["check", broken.slug]).status).toBe(1);
  });

  it("refuses an integration branch name that begins with a dash before it reaches git", () => {
    const fx = make({ stage: "built" });
    writeText(fx.paths.config, "mode: solo\ndefaultBranch: --output=/tmp/owned\n");
    const report = evaluateCompletion(fx.root, fx.slug);
    expect(report.verdict).toBe("not-evaluated");
    expect(report.summary).toMatch(/not one Reggie will hand to git/);
    expect(report.summary).not.toContain("--output");
  });
});

describe("the plan must be on the base (AC22)", () => {
  const made: PolicyFixture[] = [];
  afterAll(() => made.forEach((fx) => fx.cleanup()));

  it("refuses a task whose plan exists only on the task branch", () => {
    const fx = makePolicyFixture({ planOnBase: false });
    made.push(fx);
    const report = evaluateCompletion(fx.root, fx.slug);
    expect(report.verdict).toBe("refused");
    expect(gate(report, "plan").reasons.join(" ")).toMatch(/the plan is not committed on main, so there is no copy the branch could not have edited/);
    expect(report.criteria).toEqual([]);
  });

  it("refuses a plan on the base that fails the plan contract", () => {
    const fx = makePolicyFixture();
    made.push(fx);
    fx.base(planRelPath(fx.slug), (readText(planFile(fx.paths, fx.slug)) ?? "").replace(/## Bail conditions[\s\S]*$/, ""));
    fx.commitBase("a plan with a section missing");
    const report = evaluateCompletion(fx.root, fx.slug);
    expect(report.verdict).toBe("refused");
    expect(gate(report, "plan").reasons.join(" ")).toMatch(/does not pass the plan contract: missing section: ## Bail conditions/);
  });

  it("refuses a plan with no criteria in words that say so, never as passing", () => {
    const fx = makePolicyFixture({ criteria: [] });
    made.push(fx);
    const report = evaluateCompletion(fx.root, fx.slug);
    expect(report.verdict).toBe("refused");
    expect(gate(report, "plan").reasons.join(" ")).toMatch(/has no acceptance criteria, so there is nothing a check could prove; a plan with no criteria never passes/);
    expect(gate(report, "criteria").status).toBe("fail");
  });
});

describe("the criteria gate (AC23)", () => {
  const made: PolicyFixture[] = [];
  afterAll(() => made.forEach((fx) => fx.cleanup()));
  const build = (): PolicyFixture => {
    const fx = makePolicyFixture({ stage: "built" });
    made.push(fx);
    fx.wt(`${evidenceRelDir(fx.slug)}tests.txt`, "2 passed\n");
    return fx;
  };
  const finish = (fx: PolicyFixture): PolicyReport => {
    fx.writePacket();
    fx.commitWt("packet");
    return evaluateCompletion(fx.root, fx.slug);
  };
  const pass = (fx: PolicyFixture, criterion: string) => recordCheck(fx.wtPaths, { slug: fx.slug, criterion, outcome: "pass", evidence: ["tests.txt"], person: "t", tool: "t", session: "t" });

  it("refuses with the sentence that a packet with no checks never passes when there is no checks file", () => {
    const report = finish(build());
    expect(report.verdict).toBe("refused");
    expect(gate(report, "criteria").reasons[0]).toMatch(/^a packet with no checks never passes: there is no checks\.jsonl on task\/two-not-one/);
    expect(report.criteria.map((c) => c.status)).toEqual(["missing", "missing"]);
  });

  it("names by number a criterion with no record, one whose latest record fails, and one whose only pass cites no evidence", () => {
    const fx = build();
    pass(fx, "1");
    expect(gate(finish(fx), "criteria").reasons.join(" ")).toContain("no check is recorded for criterion 2.");

    recordCheck(fx.wtPaths, { slug: fx.slug, criterion: "2", outcome: "fail", person: "t", tool: "t", session: "t" });
    const failed = finish(fx);
    expect(failed.criteria.map((c) => c.status)).toEqual(["pass", "fail"]);
    expect(gate(failed, "criteria").reasons.join(" ")).toContain("the latest check failed for criterion 2.");

    // The verb refuses a pass with no evidence, so this one is written by hand; the reader does not count it.
    handRecord(fx, { key: failed.criteria[1]?.key ?? "", n: 2, evidence: [] });
    const bare = finish(fx);
    expect(bare.criteria.map((c) => c.status)).toEqual(["pass", "no-evidence"]);
    expect(gate(bare, "criteria").reasons.join(" ")).toContain("the pass for criterion 2 has no evidence that resolves.");
  });

  it("does not count a pass recorded against a rewording that exists only on the branch, and refuses a failing record whose key is in no plan", () => {
    const fx = build();
    pass(fx, "1");
    fx.wt(planRelPath(fx.slug), (readText(planFile(fx.wtPaths, fx.slug)) ?? "").replace("shows the new value printed by node", "shows any value at all"));
    pass(fx, "2");
    const reworded = finish(fx);
    expect(reworded.criteria.map((c) => [c.n, c.status])).toEqual([[1, "pass"], [2, "missing"]]);
    expect(reworded.criteria[1]?.text).toContain("printed by node");
    expect(gate(reworded, "criteria").reasons.join(" ")).toContain("no check is recorded for criterion 2.");

    recordCheck(fx.wtPaths, { slug: fx.slug, criterion: "2", outcome: "fail", person: "t", tool: "t", session: "t" });
    const stray = finish(fx);
    expect(gate(stray, "criteria").reasons.join(" ")).toMatch(/a failing check is recorded for c:[0-9a-f]{12} \(criterion 2, "AC2 A saved command output shows any value at all"\), which is in no plan on main/);
  });

  it("lets a later pass supersede a fail and a later fail a pass, by position and not by clock", () => {
    const fx = build();
    pass(fx, "1");
    recordCheck(fx.wtPaths, { slug: fx.slug, criterion: "2", outcome: "fail", person: "t", tool: "t", session: "t", now: new Date("2030-01-01T00:00:00Z") });
    recordCheck(fx.wtPaths, { slug: fx.slug, criterion: "2", outcome: "pass", evidence: ["tests.txt"], person: "t", tool: "t", session: "t", now: new Date("2020-01-01T00:00:00Z") });
    const passed = finish(fx);
    expect(passed.verdict, JSON.stringify(passed.gates, null, 1)).toBe("would-pass");
    expect(passed.criteria[1]?.record?.at).toBe("2020-01-01T00:00:00.000Z");

    recordCheck(fx.wtPaths, { slug: fx.slug, criterion: "2", outcome: "fail", person: "t", tool: "t", session: "t", now: new Date("2010-01-01T00:00:00Z") });
    expect(finish(fx).criteria[1]?.status).toBe("fail");
  });
});

describe("stale checks (AC24)", () => {
  const made: PolicyFixture[] = [];
  afterAll(() => made.forEach((fx) => fx.cleanup()));

  it("keeps a pass counting through a later commit that touches only .reggie/, and makes it stale once code changes after it", () => {
    const fx = makePolicyFixture();
    made.push(fx);
    fx.wt(`.reggie/notes/src/a.ts.md`, "# src/a.ts\n\n- a note written after the checks\n");
    fx.commitWt("docs: a note, records only");
    expect(evaluateCompletion(fx.root, fx.slug).verdict).toBe("would-pass");

    fx.wt("src/b.ts", "export const b = 3;\n");
    fx.commitWt("feat: one more line of code after the checks");
    const report = evaluateCompletion(fx.root, fx.slug);
    expect(report.criteria.map((c) => c.status)).toEqual(["stale", "stale"]);
    expect(report.criteria[0]?.why).toMatch(/1 file outside \.reggie\/ changed after it was recorded \(src\/b\.ts\)/);
    expect(gate(report, "criteria").reasons.join(" ")).toContain("the pass for criterion 1, 2 is stale");
  });

  it("makes a pass stale when its head is no longer part of the branch, as after a rebase", () => {
    const fx = makePolicyFixture();
    made.push(fx);
    fx.base("README.md", "# fixture, edited on main\n");
    fx.commitBase("docs: main moves on");
    git(["rebase", "-q", "main"], { cwd: fx.worktree });
    const report = evaluateCompletion(fx.root, fx.slug);
    expect(report.criteria.map((c) => c.status)).toEqual(["stale", "stale"]);
    expect(report.criteria[0]?.why).toMatch(/which is not part of task\/two-not-one as it stands/);
  });
});

describe("the risk gate (AC25)", () => {
  const made: PolicyFixture[] = [];
  afterAll(() => made.forEach((fx) => fx.cleanup()));
  const evaluate = (fx: PolicyFixture): PolicyReport => {
    fx.checkAll();
    fx.writePacket();
    fx.commitWt("packet");
    return evaluateCompletion(fx.root, fx.slug);
  };
  const built = (opts: Parameters<typeof makePolicyFixture>[0] = {}): PolicyFixture => {
    const fx = makePolicyFixture({ ...opts, stage: "built" });
    made.push(fx);
    fx.wt(`${evidenceRelDir(fx.slug)}tests.txt`, "2 passed\n");
    return fx;
  };

  it("refuses as high a branch whose plan names one low file and which also changes src/auth/token.ts, listing it as unplanned", () => {
    const fx = built();
    fx.wt("src/auth/token.ts", "export const token = 1;\n");
    fx.commitWt("feat: and a token file the plan never named");
    const report = evaluate(fx);
    expect(report.risk).toMatchObject({ plan: "low", planFiles: "low", changed: "high", effective: "high", unplanned: ["src/auth/token.ts"] });
    expect(failing(report)).toEqual(["risk"]);
    expect(gate(report, "risk").reasons[0]).toMatch(/the effective risk class is high, and the policy on main lets a completion pass without a person only up to low/);
  });

  it("computes medium for a branch that changes thirteen low files", () => {
    const fx = built();
    for (let i = 1; i <= 12; i += 1) fx.wt(`docs/page-${i}.md`, `# page ${i}\n`);
    fx.commitWt("docs: twelve more files");
    const report = evaluate(fx);
    expect(report.risk).toMatchObject({ changed: "medium", effective: "medium", changedCount: 13 });
    expect(failing(report)).toEqual(["risk"]);
  });

  it("counts a file moved out of src/auth/ under its old name, so the move is high", () => {
    const fx = built({ baseFiles: { "src/auth/x.ts": "export const x = 1;\n// a second line so git would call the move a rename\n" } });
    git(["mv", "src/auth/x.ts", "src/y.ts"], { cwd: fx.worktree });
    fx.commitWt("refactor: move x out of auth");
    const report = evaluate(fx);
    expect(report.risk?.changed).toBe("high");
    expect(report.risk?.unplanned).toEqual(expect.arrayContaining(["src/auth/x.ts", "src/y.ts"]));
  });

  it("lists a changed file whose name holds a space, a quote and a non-ASCII letter exactly", () => {
    const fx = built();
    const odd = `src/it's ${String.fromCharCode(233)} file.ts`;
    writeFileSync(path.join(fx.worktree, Buffer.from(odd, "utf8").toString("utf8")), "export const odd = 1;\n");
    fx.commitWt("feat: an oddly named file");
    expect(evaluate(fx).risk?.unplanned).toEqual([odd]);
  });
});

describe("the merges-cleanly gate (AC27)", () => {
  const made: PolicyFixture[] = [];
  afterAll(() => made.forEach((fx) => fx.cleanup()));

  it("refuses naming the intake file when the base and the branch each appended a line, and touches neither checkout", () => {
    const fx = makePolicyFixture();
    made.push(fx);
    appendFileSync(fx.paths.intake, "- from-main: captured on main (test, cli, 2026-09-18)\n");
    fx.commitBase("capture: on main");
    appendFileSync(fx.wtPaths.intake, "- from-branch: captured on the branch (test, cli, 2026-09-18)\n");
    fx.commitWt("capture: on the branch");
    const before = policySnapshot(fx);
    const report = evaluateCompletion(fx.root, fx.slug);
    expect(failing(report)).toEqual(["merge"]);
    expect(gate(report, "merge").reasons[0]).toMatch(/would conflict in \.reggie\/intake\.md/);
    expect(policySnapshot(fx)).toEqual(before);
  });

  it("reads not checked, and leaves the verdict alone, when this git does not know merge-tree --write-tree", () => {
    const fx = makePolicyFixture();
    made.push(fx);
    const seen: string[][] = [];
    const runner = (args: string[], opts?: ExecOptions): ExecResult => {
      seen.push(args);
      if (args[0] === "merge-tree") return { ok: false, status: 129, stdout: "", stderr: "error: unknown option `write-tree'\nusage: git merge-tree ..." };
      return git(args, opts);
    };
    const report = evaluateCompletion(fx.root, fx.slug, { runner });
    expect(seen.some((a) => a[0] === "merge-tree")).toBe(true);
    expect(gate(report, "merge").status).toBe("not-checked");
    expect(gate(report, "merge").reasons[0]).toMatch(/^not checked: this git cannot merge in memory/);
    expect(report.verdict).toBe("would-pass");
  });
});

describe("not evaluated (AC28)", () => {
  const made: PolicyFixture[] = [];
  afterAll(() => made.forEach((fx) => fx.cleanup()));

  it("says so, each in its own sentence and with exit 1, for no branch, no packet, and a task already approved on the base", () => {
    const planned = makePolicyFixture({ stage: "planned" });
    const built = makePolicyFixture({ stage: "built" });
    const landed = makePolicyFixture();
    made.push(planned, built, landed);

    const noBranch = evaluateCompletion(planned.root, planned.slug);
    expect(noBranch.verdict).toBe("not-evaluated");
    expect(noBranch.summary).toBe("not evaluated: there is no task/two-not-one branch, so there is no finished work to judge.");
    expect(cli(planned.root, ["check", planned.slug]).status).toBe(1);

    const noPacket = evaluateCompletion(built.worktree, built.slug);
    expect(noPacket.verdict).toBe("not-evaluated");
    expect(noPacket.summary).toMatch(/^not evaluated: task\/two-not-one has no packet yet\./);
    const printed = cli(built.root, ["check", built.slug]);
    expect(printed.status).toBe(1);
    expect(printed.stdout.split("\n")[0]).toBe(REPORT_PREAMBLE);
    expect(printed.stdout).toContain("verdict: not evaluated: task/two-not-one has no packet yet.");

    landTask(landed.paths, landed.config, landed.slug, { person: landed.person });
    const decided = evaluateCompletion(landed.root, landed.slug);
    expect(decided.verdict).toBe("not-evaluated");
    expect(decided.summary).toMatch(new RegExp(`^not evaluated: two-not-one is already approved on main, by ${landed.person.handle} at \\d{4}-\\d{2}-\\d{2}T`));
    expect(cli(landed.root, ["check", landed.slug, "--json"]).status).toBe(1);
  });
});

describe("the evidence resolver (AC15)", () => {
  let fx: PolicyFixture;
  let commit: string;
  const calls: string[][] = [];
  const runner = (args: string[], opts?: ExecOptions): ExecResult => {
    calls.push(args);
    return git(args, opts);
  };
  beforeAll(() => {
    fx = makePolicyFixture({ stage: "built" });
    const dir = evidenceRelDir(fx.slug);
    fx.wt(`${dir}good.txt`, "12 passed\nexit 0\n");
    fx.wt(`${dir}empty.txt`, "");
    fx.wt(`${dir}sub/inner.txt`, "in a subfolder\n");
    mkdirSync(path.join(fx.worktree, dir), { recursive: true });
    git(["add", "-A"], { cwd: fx.worktree });
    // A symbolic link and a gitlink, written straight into the index: no file of either kind has to exist on disk.
    const blob = git(["hash-object", "-w", "--stdin"], { cwd: fx.worktree, input: "good.txt" }).stdout.trim();
    git(["update-index", "--add", "--cacheinfo", `120000,${blob},${dir}link.txt`], { cwd: fx.worktree });
    const head = git(["rev-parse", "HEAD"], { cwd: fx.worktree }).stdout.trim();
    git(["update-index", "--add", "--cacheinfo", `160000,${head},${dir}module`], { cwd: fx.worktree });
    git(["commit", "-q", "-m", "evidence of every kind"], { cwd: fx.worktree });
    commit = git(["rev-parse", "HEAD"], { cwd: fx.worktree }).stdout.trim();
  });
  afterAll(() => fx.cleanup());

  it("passes a regular non-empty file and refuses everything else, each in its own words, listing the folder once", () => {
    const dir = evidenceRelDir(fx.slug);
    const cited = ["good.txt", "evidence/good.txt", `${dir}good.txt`, "missing.txt", "empty.txt", "link.txt", "sub", "module", "evidence/sub/inner.txt", "evidence/../plan.md", "/etc/hosts", "-rf.txt", ":(exclude)good.txt", "two\nlines.txt", "back\\slash.txt"];
    calls.length = 0;
    const faults = resolveEvidence(fx.root, commit, fx.slug, cited, runner);
    const why = Object.fromEntries(faults.map((f) => [f.path, f.why]));
    expect(Object.keys(why).sort()).toEqual(["-rf.txt", "/etc/hosts", ":(exclude)good.txt", "back\\slash.txt", "empty.txt", "evidence/../plan.md", "evidence/sub/inner.txt", "link.txt", "missing.txt", "module", "sub", "two lines.txt"].sort());
    expect(why["missing.txt"]).toMatch(/^is not on the commit [0-9a-f]{12}/);
    expect(why["empty.txt"]).toMatch(/^is empty; an empty file cannot be told from a redirect that failed/);
    expect(why["link.txt"]).toBe("is a symbolic link; evidence is a regular file");
    expect(why["sub"]).toBe("is a folder; evidence is a regular file");
    expect(why["module"]).toBe("is a gitlink to another repository; evidence is a regular file");
    expect(why["evidence/sub/inner.txt"]).toMatch(/^lies in a subfolder of the evidence folder/);
    expect(why["evidence/../plan.md"]).toBe("holds a `..` segment");
    expect(why["/etc/hosts"]).toMatch(/^is an absolute path/);
    expect(why["-rf.txt"]).toMatch(/^has a name beginning with a dash/);
    expect(why[":(exclude)good.txt"]).toMatch(/^has a name beginning with a colon, which git reads as pathspec magic/);
    expect(why["two lines.txt"]).toBe("holds a control character or a line break");
    expect(why["back\\slash.txt"]).toMatch(/^holds a backslash/);
    expect(new Set(Object.values(why)).size).toBe(Object.keys(why).length);

    // Git was asked once, for Reggie's own folder on a full commit id, under literal pathspecs; no citation reached it.
    expect(calls).toEqual([["--literal-pathspecs", "ls-tree", "-r", "-z", "-l", "--end-of-options", commit, "--", dir.replace(/\/$/, "")]]);
    expect(() => resolveEvidence(fx.root, "main", fx.slug, ["good.txt"], runner)).toThrow(/full 40-character commit id/);
  });

  it("reads no working tree: a file saved and never committed is missing, and a committed file deleted from disk still resolves", () => {
    fx.wt(`${evidenceRelDir(fx.slug)}later.txt`, "saved, not committed\n");
    git(["rm", "-q", "--cached", "-r", "--", `${evidenceRelDir(fx.slug)}good.txt`], { cwd: fx.worktree });
    writeFileSync(path.join(fx.worktree, evidenceRelDir(fx.slug), "good.txt"), "");
    const faults = resolveEvidence(fx.worktree, commit, fx.slug, ["later.txt", "good.txt"]);
    expect(faults.map((f) => [f.path, f.missing ?? false])).toEqual([["later.txt", true]]);
    git(["reset", "-q", "--hard", commit], { cwd: fx.worktree });
  });

  it("says of a cited file that is in the task worktree and not in HEAD that it is on disk but not committed", () => {
    fx.wt(`${evidenceRelDir(fx.slug)}tests.txt`, "2 passed\n");
    fx.checkAll();
    fx.writePacket();
    // The packet and the records are committed; the evidence they cite is not.
    git(["add", "--", packetRelPath(fx.slug), checksRelPath(fx.slug)], { cwd: fx.worktree });
    git(["commit", "-q", "-m", "packet, without its evidence"], { cwd: fx.worktree });
    const r = cli(fx.worktree, ["packet", fx.slug, "--lint"]);
    expect(r.status).toBe(1);
    expect(r.stdout).toContain(`error: ${evidenceRelDir(fx.slug)}tests.txt is on disk but not committed; commit it on the task branch`);
    expect(readFileSync(packetFile(fx.wtPaths, fx.slug), "utf8")).toContain("verdict: pending");
  });
});
