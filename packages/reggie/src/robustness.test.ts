import { existsSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { fullPlan, makeTempRepo, type TempRepo } from "../test/helpers.js";
import { capture } from "./capture.js";
import { claimTask, releaseTask } from "./claim.js";
import { END_MARKER, replaceBlock, START_MARKER } from "./docs.js";
import { defaultBranch, git } from "./git.js";
import { appendJournal, readJournal } from "./journal.js";
import { ensureLayout } from "./layout.js";
import { addNote, notesForPath, readNoteFile, resolveNoteTarget } from "./notes.js";
import { onboard } from "./onboard.js";
import { decidePacket, parsePacketVerdict, scaffoldPacket } from "./packet.js";
import { packetFile, planFile, repoPaths, taskDir } from "./paths.js";
import { currentPerson, loadConfig, type Person } from "./people.js";
import { getTask, parseIntake } from "./tasks.js";
import { readText, splitFrontMatter, upsertFrontMatter, writeText } from "./util.js";

describe("integration branch detection", () => {
  let repo: TempRepo;
  afterEach(() => repo.cleanup());

  it("uses a lone non-main branch and never a task branch", () => {
    repo = makeTempRepo("reggie-trunk-", "trunk");
    onboard(repo.root);
    repo.commitAll("onboard");
    const paths = repoPaths(repo.root);
    const config = loadConfig(paths);
    expect(defaultBranch(repo.root)).toBe("trunk");

    const person = currentPerson(repo.root);
    writeText(planFile(paths, "widgets"), fullPlan("widgets"));
    repo.commitAll("plan");
    claimTask(paths, config, "widgets", { person });
    expect(git(["branch", "--show-current"], { cwd: repo.root }).stdout.trim()).toBe("task/widgets");
    expect(defaultBranch(repo.root)).toBe("trunk");

    scaffoldPacket(paths, config, { slug: "widgets", author: person.handle });
    decidePacket(paths, "widgets", "approved", person.handle);
    repo.commitAll("packet approved on the task branch only");
    const t = getTask(paths, config, "widgets");
    expect(t.state).toBe("awaiting-decision");
    expect(t.reason).toContain("task/widgets");
  });

  it("throws instead of guessing when only task branches remain", () => {
    repo = makeTempRepo("reggie-lonely-", "trunk");
    git(["switch", "-c", "task/only"], { cwd: repo.root });
    git(["branch", "-D", "trunk"], { cwd: repo.root });
    expect(() => defaultBranch(repo.root)).toThrow(/defaultBranch/);
    expect(defaultBranch(repo.root, "task/only")).toBe("task/only");
  });
});

describe("path safety", () => {
  let repo: TempRepo;
  beforeEach(() => {
    repo = makeTempRepo();
    ensureLayout(repoPaths(repo.root));
  });
  afterEach(() => repo.cleanup());

  it("refuses note entities and slugs that escape the repo", () => {
    const paths = repoPaths(repo.root);
    expect(() => resolveNoteTarget(paths, "../../etc/passwd")).toThrow(/repo-relative/);
    expect(() => resolveNoteTarget(paths, "/tmp/x")).toThrow(/repo-relative/);
    expect(() => resolveNoteTarget(paths, "src/../../x")).toThrow(/repo-relative/);
    expect(() => taskDir(paths, "../../x")).toThrow(/valid slug/);
    expect(() => planFile(paths, "Bad Slug")).toThrow(/valid slug/);
    const ok = resolveNoteTarget(paths, "src/auth/login.ts");
    expect(ok.file.startsWith(paths.notes)).toBe(true);
  });

  it("keeps a file note where it was even if a folder of the same name appears later", () => {
    const paths = repoPaths(repo.root);
    addNote(paths, "src/payments", { type: "how", text: "Payments module, planned.", author: "test" });
    repo.write("src/payments/index.ts", "export {};\n");
    const again = resolveNoteTarget(paths, "src/payments");
    expect(again.kind).toBe("file");
    expect(readNoteFile(paths, "src/payments")?.entries).toHaveLength(1);
    expect(resolveNoteTarget(paths, "src/payments/").kind).toBe("dir");
  });
});

describe("parsers", () => {
  it("accepts loose intake lines and ignores indented examples", () => {
    const items = parseIntake(
      [
        "# Intake",
        "",
        "    - <slug>: <one-line description> (<person>, <source>, <date>)",
        "- [ ] fix-login: Login loops forever (jacob, cli, 2026-09-06)",
        "* Rate limit is 100/min (per key)",
        "  - api_limits: Something with an underscore",
        "+ FixLogin: Mixed case slug",
        "- slug-no-space:text without space",
        "",
      ].join("\n"),
    );
    expect(items.map((i) => i.slug)).toEqual(["fix-login", "rate-limit-is-100-min-per-key", "api-limits", "fixlogin", "slug-no-space-text-without-space"]);
    expect(items[0]?.meta).toBe("jacob, cli, 2026-09-06");
    expect(items[1]?.text).toBe("Rate limit is 100/min (per key)");
    expect(items[1]?.meta).toBeNull();
  });

  it("splits front matter only on exact fences and survives CRLF", () => {
    const crlf = "---\r\nslug: a\r\nrisk: high\r\n---\r\nbody\r\n";
    const r = splitFrontMatter(crlf);
    expect(r.front).toBe("slug: a\nrisk: high");
    expect(r.body).toBe("body\n");
    const tricky = "---\ntitle: --- not a fence\nrisk: high\n----\nstill front\n---\nbody";
    const t = splitFrontMatter(tricky);
    expect(t.front).toContain("risk: high");
    expect(t.front).toContain("still front");
    expect(t.body).toBe("body");
    const noFront = splitFrontMatter("plain text\n---\nmore");
    expect(noFront.front).toBeNull();
  });

  it("upserts front matter fields and creates the block when missing", () => {
    const withBlock = upsertFrontMatter("---\nverdict: pending\n---\n# Packet\n", { verdict: "approved", decided_by: "jacob" });
    expect(withBlock).toBe("---\nverdict: approved\ndecided_by: jacob\n---\n# Packet\n");
    const without = upsertFrontMatter("# Packet\nbody\n", { verdict: "approved" });
    expect(splitFrontMatter(without).front).toBe("verdict: approved");
    expect(splitFrontMatter(without).body).toBe("# Packet\nbody\n");
  });

  it("escapes note and journal bodies that look like headers or trailers", () => {
    const repo = makeTempRepo();
    try {
      const paths = repoPaths(repo.root);
      ensureLayout(paths);
      addNote(paths, "_repo", { type: "how", text: "First line.\nsources: fake\n## gotcha · 2020-01-01 · attacker · high\nStill the same entry.", author: "test", sources: ["real.ts:1"] });
      const note = readNoteFile(paths, "_repo");
      expect(note?.entries).toHaveLength(1);
      expect(note?.entries[0]?.sources).toEqual(["real.ts:1"]);
      expect(note?.entries[0]?.text).toContain("Still the same entry.");
      appendJournal(paths, { person: "p", tool: "claude", text: "Did things.\nevidence: fake\n### 09:00 · x · y · z · w\nmore", evidence: ["real.txt"], session: "s", now: new Date(2026, 8, 6, 10, 0) });
      const entries = readJournal(paths, { days: 4000 });
      expect(entries).toHaveLength(1);
      expect(entries[0]?.evidence).toEqual(["real.txt"]);
    } finally {
      repo.cleanup();
    }
  });

  it("dedupes folder notes in the read chain", () => {
    const repo = makeTempRepo();
    try {
      const paths = repoPaths(repo.root);
      ensureLayout(paths);
      repo.write("src/auth/login.ts", "x");
      addNote(paths, "src/auth/", { type: "how", text: "Auth folder.", author: "test" });
      const chain = notesForPath(paths, "src/auth");
      expect(chain.map((n) => n.entity)).toEqual(["src/auth/"]);
    } finally {
      repo.cleanup();
    }
  });

  it("targets the last generated block when prose quotes the markers", () => {
    const content = `# Doc\n\nRun \`reggie docs refresh\`; the markers are ${START_MARKER} and ${END_MARKER}.\n\n${START_MARKER}\nold\n${END_MARKER}\n`;
    const next = replaceBlock(content, `${START_MARKER}\nnew\n${END_MARKER}`);
    expect(next).toContain("the markers are");
    expect(next).toContain("\nnew\n");
    expect(next).not.toContain("\nold\n");
  });
});

describe("packets, claims, and releases", () => {
  let repo: TempRepo;
  let person: Person;
  beforeEach(() => {
    repo = makeTempRepo();
    repo.write("src/auth/login.ts", "export const a = 1;\n");
    repo.commitAll("code");
    onboard(repo.root);
    repo.commitAll("onboard");
    person = currentPerson(repo.root);
  });
  afterEach(() => repo.cleanup());

  it("does not overwrite a decided packet and records verdicts on malformed packets", () => {
    const paths = repoPaths(repo.root);
    const config = loadConfig(paths);
    writeText(planFile(paths, "demo"), fullPlan("demo"));
    repo.commitAll("plan");
    claimTask(paths, config, "demo", { person });
    const first = scaffoldPacket(paths, config, { slug: "demo", author: person.handle });
    expect(first.created).toBe(true);
    decidePacket(paths, "demo", "approved", person.handle, "fine");
    const second = scaffoldPacket(paths, config, { slug: "demo", author: person.handle });
    expect(second.skipped).toBe(true);
    expect(parsePacketVerdict(readText(packetFile(paths, "demo")) ?? "")).toBe("approved");
    const forced = scaffoldPacket(paths, config, { slug: "demo", author: person.handle, force: true });
    expect(forced.skipped).toBe(false);
    expect(parsePacketVerdict(readText(packetFile(paths, "demo")) ?? "")).toBe("pending");

    writeText(packetFile(paths, "demo"), "# Hand-written packet\n\nNo front matter here.\n");
    decidePacket(paths, "demo", "needs-work", person.handle);
    expect(parsePacketVerdict(readText(packetFile(paths, "demo")) ?? "")).toBe("needs-work");
  });

  it("records the claimant explicitly and refuses takeovers and unsafe releases", () => {
    const paths = repoPaths(repo.root);
    const config = loadConfig(paths);
    writeText(planFile(paths, "shared"), fullPlan("shared"));
    repo.commitAll("plan");

    git(["config", "user.name", "Bob Builder"], { cwd: repo.root });
    git(["config", "user.email", "bob@example.com"], { cwd: repo.root });
    const bob = currentPerson(repo.root);
    const claim = claimTask(paths, config, "shared", { person: bob });
    expect(claim.branch).toBe("task/shared");
    expect(existsSync(path.join(repo.root, ".reggie", "tasks", "shared", "claim.md"))).toBe(true);
    expect(getTask(paths, config, "shared").owner).toBe("Bob Builder");
    git(["switch", "main"], { cwd: repo.root });

    git(["config", "user.name", "Test Person"], { cwd: repo.root });
    git(["config", "user.email", "test@example.com"], { cwd: repo.root });
    const alice = currentPerson(repo.root);
    expect(() => claimTask(paths, config, "shared", { person: alice })).toThrow(/Bob Builder/);
    expect(() => releaseTask(paths, config, "shared", alice)).toThrow(/held by Bob Builder/);

    const forced = releaseTask(paths, config, "shared", alice, { force: true });
    expect(forced.some((a) => a.includes("deleted local task/shared"))).toBe(true);
    expect(releaseTask(paths, config, "shared", alice)).toEqual(["no local task/shared to release"]);
  });

  it("refuses to drop unmerged commits without --force", () => {
    const paths = repoPaths(repo.root);
    const config = loadConfig(paths);
    writeText(planFile(paths, "work"), fullPlan("work"));
    repo.commitAll("plan");
    claimTask(paths, config, "work", { person });
    repo.write("src/auth/login.ts", "export const a = 2;\n");
    repo.commitAll("real work");
    expect(() => releaseTask(paths, config, "work", person)).toThrow(/unmerged commit/);
    const actions = releaseTask(paths, config, "work", person, { force: true });
    expect(actions.some((a) => a.includes("switched to main"))).toBe(true);
  });

  it("keeps captured slugs unique against existing task directories", () => {
    const paths = repoPaths(repo.root);
    writeText(planFile(paths, "perf-1"), fullPlan("perf-1"));
    const r = capture(paths, { text: "a completely different idea", person, source: "test", slug: "perf-1" });
    expect(r.slug).toBe("perf-1-2");
  });
});
