import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { fullPlan, makeTempRepo, type TempRepo } from "../test/helpers.js";
import { capture } from "./capture.js";
import { claimTask } from "./claim.js";
import { fileAtRef, git, gitCommonDir, run } from "./git.js";
import { clearHistoryCache, taskLanding } from "./history.js";
import { LAND_LOCK_STALE_MS, LandError, landLockFile, landTask } from "./land.js";
import { ensureLayout } from "./layout.js";
import { parsePacketVerdict, scaffoldPacket } from "./packet.js";
import { packetFile, packetRelPath, planFile, repoPaths, type RepoPaths } from "./paths.js";
import { currentPerson, loadConfig, loadPeople, type Person, type ReggieConfig } from "./people.js";
import { evaluateCompletion } from "./policy.js";
import { getTask, parseIntake } from "./tasks.js";
import { readText, writeText } from "./util.js";

const SLUG = "cap-retries";
const BRANCH = `task/${SLUG}`;
const CLI = path.resolve("src/cli.ts");
const TSX = path.resolve("node_modules/.bin/tsx");

interface Setup {
  repo: TempRepo;
  paths: RepoPaths;
  config: ReggieConfig;
  person: Person;
  worktree: string;
  remote: string;
}

const cleanups: (() => void)[] = [];
afterEach(() => {
  clearHistoryCache();
  while (cleanups.length > 0) cleanups.pop()?.();
});

function out(cwd: string, args: string[]): string {
  return git(args, { cwd }).stdout.trim();
}

function commitIn(cwd: string, message: string[], files: string[]): void {
  git(["add", "--", ...files], { cwd });
  git(["commit", "-q", ...message.flatMap((m) => ["-m", m])], { cwd });
}

/**
 * A repo with a bare origin, a plan on main, and the task claimed in a worktree with one commit
 * and a committed packet: exactly what an approval meets in solo mode.
 */
function setup(): Setup {
  const repo = makeTempRepo("reggie-land-");
  const paths = repoPaths(repo.root);
  ensureLayout(paths);
  appendFileSync(path.join(repo.root, ".gitignore"), ".worktree/\n");
  writeText(planFile(paths, SLUG), fullPlan(SLUG));
  repo.commitAll("plan");
  const remote = mkdtempSync(path.join(os.tmpdir(), "reggie-land-origin-"));
  git(["init", "-q", "--bare", remote], { cwd: remote });
  git(["remote", "add", "origin", remote], { cwd: repo.root });
  git(["push", "-q", "origin", "main"], { cwd: repo.root });
  git(["fetch", "-q", "origin"], { cwd: repo.root });
  cleanups.push(() => {
    repo.cleanup();
    rmSync(remote, { recursive: true, force: true });
  });

  const config = loadConfig(paths);
  const person = currentPerson(repo.root, loadPeople(paths));
  const worktree = claimTask(paths, config, SLUG, { worktree: true, person }).worktree ?? "";
  mkdirSync(path.join(worktree, "src/auth"), { recursive: true });
  writeFileSync(path.join(worktree, "src/auth/login.ts"), "export const retries = 3;\n", "utf8");
  commitIn(worktree, ["feat: cap retries", `Task: ${SLUG}`], ["src/auth/login.ts"]);
  scaffoldPacket(repoPaths(worktree), config, { slug: SLUG, author: person.handle });
  commitIn(worktree, [`packet: ${SLUG}`, `Task: ${SLUG}`], [packetRelPath(SLUG)]);
  return { repo, paths, config, person, worktree, remote };
}

/** Everything an aborted or refused landing must leave exactly as it was. */
function snapshot(s: Setup): Record<string, unknown> {
  const root = s.repo.root;
  const verdictAt = (ref: string) => {
    const content = fileAtRef(root, ref, packetRelPath(SLUG));
    return content === null ? null : parsePacketVerdict(content);
  };
  // The branch is gone in some cases, and a snapshot must still describe the state rather than throw.
  const rev = (ref: string) => git(["rev-parse", ref], { cwd: root, allowFailure: true }).stdout.trim() || "gone";
  return {
    main: out(root, ["rev-parse", "main"]),
    branch: rev(BRANCH),
    status: out(root, ["status", "--porcelain"]),
    worktreeStatus: existsSync(s.worktree) ? out(s.worktree, ["status", "--porcelain"]) : "gone",
    verdictMain: verdictAt("main"),
    verdictBranch: verdictAt(BRANCH),
    packetOnDisk: existsSync(packetFile(s.paths, SLUG)),
    merging: existsSync(path.join(root, ".git", "MERGE_HEAD")),
  };
}

function cli(root: string, args: string[]): { ok: boolean; stdout: string; stderr: string } {
  return run(TSX, [CLI, "--root", root, ...args], { allowFailure: true, cwd: root });
}

describe("landTask", () => {
  it("merges an approved task with the verdict inside the merge commit, releases it, and pushes nothing", () => {
    const s = setup();
    const root = s.repo.root;
    const originBefore = out(root, ["rev-parse", "origin/main"]);
    const r = landTask(s.paths, s.config, SLUG, { person: s.person, comment: "criteria met" });

    expect(r.alreadyLanded).toBe(false);
    expect(r.merge).toMatch(/^[0-9a-f]{40}$/);
    expect(r.releaseError).toBeNull();
    expect(out(root, ["cat-file", "-p", "HEAD"]).match(/^parent /gm)).toHaveLength(2);
    const message = out(root, ["log", "-1", "--format=%B"]);
    expect(message.split("\n")[0]).toBe(`merge: ${BRANCH} — Cap login retries on web`);
    expect(message).toContain("criteria met");
    expect(message).toContain(`Task: ${SLUG}`);
    expect(message).toContain(`Decided-by: ${s.person.handle}`);
    expect(out(root, ["show", `HEAD:${packetRelPath(SLUG)}`])).toMatch(/^verdict: approved$/m);
    expect(out(root, ["show", "--stat", "--format=", "HEAD", "--", ".reggie/journal"])).not.toBe("");

    expect(out(root, ["branch", "--list", BRANCH])).toBe("");
    expect(existsSync(s.worktree)).toBe(false);
    expect(out(root, ["status", "--porcelain", "--untracked-files=no"])).toBe("");
    git(["fetch", "-q", "origin"], { cwd: root });
    expect(out(root, ["rev-parse", "origin/main"])).toBe(originBefore);
    expect(out(s.remote, ["branch", "--list"])).not.toContain(BRANCH);
    expect(getTask(s.paths, s.config, SLUG).state).toBe("done");

    const landing = taskLanding(root, SLUG);
    expect(landing.merge?.sha).toBe(r.merge);
    expect(landing.commits.map((c) => c.subject)).toContain("feat: cap retries");
    expect(landing.merge?.files.map((f) => f.path)).toContain("src/auth/login.ts");
  });

  it("aborts a conflicting merge and leaves both branches, the tree and the verdicts as they were", () => {
    const s = setup();
    const root = s.repo.root;
    mkdirSync(path.join(root, "src/auth"), { recursive: true });
    writeFileSync(path.join(root, "src/auth/login.ts"), "export const retries = 5;\n", "utf8");
    commitIn(root, ["main caps retries differently"], ["src/auth/login.ts"]);
    const before = snapshot(s);

    const r = cli(root, ["decide", SLUG, "approved"]);
    expect(r.ok).toBe(false);
    expect(r.stderr).toContain("conflicts in src/auth/login.ts");
    expect(r.stderr).toContain("aborted");
    expect(snapshot(s)).toEqual(before);
    expect(() => landTask(s.paths, s.config, SLUG, { person: s.person })).toThrow(LandError);
    expect(snapshot(s)).toEqual(before);
  });

  it("refuses from a checkout that is not on the base branch", () => {
    const s = setup();
    git(["switch", "-q", "-c", "elsewhere"], { cwd: s.repo.root });
    const before = snapshot(s);
    expect(() => landTask(s.paths, s.config, SLUG, { person: s.person })).toThrow(/on elsewhere, not main/);
    expect(snapshot(s)).toEqual(before);
  });

  it("refuses while tracked files on the base branch are modified", () => {
    const s = setup();
    writeFileSync(path.join(s.repo.root, "README.md"), "# edited, not committed\n", "utf8");
    const before = snapshot(s);
    expect(() => landTask(s.paths, s.config, SLUG, { person: s.person })).toThrow(/uncommitted changes \(README\.md\)/);
    expect(snapshot(s)).toEqual(before);
  });

  it("refuses while the task worktree holds uncommitted work", () => {
    const s = setup();
    writeFileSync(path.join(s.worktree, "src/auth/login.ts"), "export const retries = 4;\n", "utf8");
    const before = snapshot(s);
    expect(() => landTask(s.paths, s.config, SLUG, { person: s.person })).toThrow(/its worktree has uncommitted changes/);
    expect(snapshot(s)).toEqual(before);
    expect(existsSync(s.worktree)).toBe(true);
  });

  it("refuses when the base holds untracked files the merge would overwrite, naming them", () => {
    const s = setup();
    // The branch adds src/auth/login.ts; the same path sits untracked on the base, as today's journal
    // file does when the serving checkout wrote an entry and the claim committed one on the branch.
    mkdirSync(path.join(s.repo.root, "src/auth"), { recursive: true });
    writeFileSync(path.join(s.repo.root, "src/auth/login.ts"), "export const retries = 9;\n", "utf8");
    const before = snapshot(s);
    expect(() => landTask(s.paths, s.config, SLUG, { person: s.person })).toThrow(/untracked files that the merge would overwrite \(src\/auth\/login\.ts\)/);
    expect(snapshot(s)).toEqual(before);
    expect(existsSync(path.join(s.repo.root, ".git", "MERGE_HEAD"))).toBe(false);
  });

  it("approves a task whose branch was merged and released before anyone decided", () => {
    const s = setup();
    const root = s.repo.root;
    git(["merge", "-q", "--no-ff", "-m", `merge: ${BRANCH} — by hand`, "-m", `Task: ${SLUG}`, BRANCH], { cwd: root });
    const handMerge = out(root, ["rev-parse", "HEAD"]);
    git(["worktree", "remove", "--force", s.worktree], { cwd: root });
    git(["branch", "-D", BRANCH], { cwd: root });
    expect(parsePacketVerdict(fileAtRef(root, "main", packetRelPath(SLUG)) ?? "")).toBe("pending");

    const r = landTask(s.paths, s.config, SLUG, { person: s.person });
    expect(r.alreadyLanded).toBe(true);
    expect(r.merge).toBeNull();
    expect(r.existingMerge).toBe(handMerge);
    expect(out(root, ["rev-parse", "HEAD^"])).toBe(handMerge);
    expect(out(root, ["log", "-1", "--format=%B"])).toContain(`Task: ${SLUG}`);
    expect(out(root, ["show", `HEAD:${packetRelPath(SLUG)}`])).toMatch(/^verdict: approved$/m);
    expect(getTask(s.paths, s.config, SLUG).state).toBe("done");
  });

  it("refuses when there is neither a branch nor a merge that landed the task", () => {
    const s = setup();
    git(["worktree", "remove", "--force", s.worktree], { cwd: s.repo.root });
    git(["branch", "-D", BRANCH], { cwd: s.repo.root });
    const before = snapshot(s);
    expect(() => landTask(s.paths, s.config, SLUG, { person: s.person })).toThrow(/no local branch by that name, and no merge on main that landed it/);
    expect(snapshot(s)).toEqual(before);
  });

  it("records the verdict without a second merge when the branch has already landed, and says so", () => {
    const s = setup();
    const root = s.repo.root;
    git(["merge", "-q", "--no-ff", "-m", `merge: ${BRANCH} — by hand`, "-m", `Task: ${SLUG}`, BRANCH], { cwd: root });
    const handMerge = out(root, ["rev-parse", "HEAD"]);
    git(["worktree", "remove", "--force", s.worktree], { cwd: root });

    const r = cli(root, ["decide", SLUG, "approved"]);
    expect(r.ok, r.stderr).toBe(true);
    expect(r.stdout).toContain("already landed");
    expect(r.stdout).toContain(handMerge.slice(0, 7));
    expect(out(root, ["rev-parse", "HEAD^"])).toBe(handMerge);
    expect(out(root, ["cat-file", "-p", "HEAD"]).match(/^parent /gm)).toHaveLength(1);
    const message = out(root, ["log", "-1", "--format=%B"]);
    expect(message.split("\n")[0]).toBe(`decide: ${SLUG} approved`);
    expect(message).toContain(`Task: ${SLUG}`);
    expect(out(root, ["show", `HEAD:${packetRelPath(SLUG)}`])).toMatch(/^verdict: approved$/m);
    expect(out(root, ["branch", "--list", BRANCH])).toBe("");
    expect(getTask(s.paths, s.config, SLUG).state).toBe("done");
  });

  it("leaves needs-work as a verdict written into the packet, with no commit", () => {
    const s = setup();
    const headBefore = out(s.worktree, ["rev-parse", "HEAD"]);
    const mainBefore = out(s.repo.root, ["rev-parse", "main"]);
    const r = cli(s.worktree, ["decide", SLUG, "needs-work", "--comment", "the offline message is missing"]);
    expect(r.ok, r.stderr).toBe(true);
    expect(out(s.worktree, ["rev-parse", "HEAD"])).toBe(headBefore);
    expect(out(s.repo.root, ["rev-parse", "main"])).toBe(mainBefore);
    expect(out(s.worktree, ["status", "--porcelain", "--untracked-files=no"])).toContain(packetRelPath(SLUG));
    expect(parsePacketVerdict(git(["show", `:${packetRelPath(SLUG)}`], { cwd: s.worktree }).stdout)).toBe("pending");
    expect(out(s.repo.root, ["branch", "--list", BRANCH])).not.toBe("");
  });
});

// ---------------------------------------------------------------------------
// The evidence gate, the landing lock and the captures inside the merge commit.
// Everything above this line is as it was before them, and passes unedited.
// ---------------------------------------------------------------------------

/** Rewrite one `## ` section of the packet in the task worktree and commit it on the branch. */
function rewriteSection(s: Setup, heading: string, body: string): void {
  const file = packetFile(repoPaths(s.worktree), SLUG);
  const next = (readText(file) ?? "").replace(new RegExp(`## ${heading}\\n[\\s\\S]*?(?=\\n## |$)`), `## ${heading}\n${body}\n`);
  writeText(file, next);
  commitIn(s.worktree, [`packet: ${heading.toLowerCase()}`, `Task: ${SLUG}`], [packetRelPath(SLUG)]);
}

function lockBody(fields: { pid: number; slug?: string; at?: string }): string {
  return `${JSON.stringify({ pid: fields.pid, slug: fields.slug ?? "another-task", at: fields.at ?? new Date().toISOString(), token: "someone-elses" })}\n`;
}

describe("the evidence gate on the human door", () => {
  it("refuses a packet that cites a file nobody committed, naming each path and its reason, and merges once the file is on the branch", () => {
    const s = setup();
    const root = s.repo.root;
    rewriteSection(s, "Evidence", "- evidence/tests.txt — the run\n- .reggie/tasks/cap-retries/evidence/shot.png, evidence/../../../etc/passwd");
    const before = snapshot(s);

    const refused = cli(root, ["decide", SLUG, "approved"]);
    expect(refused.ok).toBe(false);
    expect(refused.stderr).toMatch(/refusing to merge task\/cap-retries: its packet cites evidence that does not resolve on task\/cap-retries \([0-9a-f]{12}\)/);
    expect(refused.stderr).toMatch(/evidence\/tests\.txt is not on the commit [0-9a-f]{12}/);
    expect(refused.stderr).toMatch(/\.reggie\/tasks\/cap-retries\/evidence\/shot\.png is not on the commit/);
    expect(refused.stderr).toContain("evidence/../../../etc/passwd holds a `..` segment");
    expect(refused.stderr).toContain("nothing was recorded");
    expect(snapshot(s)).toEqual(before);
    expect(() => landTask(s.paths, s.config, SLUG, { person: s.person })).toThrow(LandError);
    expect(snapshot(s)).toEqual(before);
    expect(existsSync(landLockFile(root))).toBe(false);

    // Saved but not committed is still a refusal, for the worktree's own reason; committed, it lands.
    rewriteSection(s, "Evidence", "- evidence/tests.txt — the run");
    const evidence = path.join(s.worktree, ".reggie/tasks", SLUG, "evidence");
    mkdirSync(evidence, { recursive: true });
    writeFileSync(path.join(evidence, "tests.txt"), "3 passed\nexit 0\n", "utf8");
    expect(() => landTask(s.paths, s.config, SLUG, { person: s.person })).toThrow(/its worktree has uncommitted changes/);
    commitIn(s.worktree, ["evidence: the run", `Task: ${SLUG}`], [`.reggie/tasks/${SLUG}/evidence/tests.txt`]);
    const landed = cli(root, ["decide", SLUG, "approved"]);
    expect(landed.ok, landed.stderr).toBe(true);
    expect(landed.stdout).toMatch(/^Approved cap-retries: merged task\/cap-retries into main as [0-9a-f]{7}\./);
    expect(out(root, ["show", `HEAD:${packetRelPath(SLUG)}`])).toMatch(new RegExp(`^decided_by: ${s.person.handle}$`, "m"));
  });

  it("refuses an empty evidence file and a symbolic link, and judges the base for a task that has already landed", () => {
    const s = setup();
    const root = s.repo.root;
    const dir = `.reggie/tasks/${SLUG}/evidence`;
    mkdirSync(path.join(s.worktree, dir), { recursive: true });
    writeFileSync(path.join(s.worktree, dir, "empty.txt"), "", "utf8");
    rewriteSection(s, "Evidence", "- evidence/empty.txt");
    commitIn(s.worktree, ["evidence: an empty file", `Task: ${SLUG}`], [`${dir}/empty.txt`]);
    const before = snapshot(s);
    expect(() => landTask(s.paths, s.config, SLUG, { person: s.person })).toThrow(/evidence\/empty\.txt is empty; an empty file cannot be told from a redirect that failed/);
    expect(snapshot(s)).toEqual(before);

    // Landed by hand with the bad citation in it: the approval is still refused, against the base this time.
    git(["merge", "-q", "--no-ff", "-m", `merge: ${BRANCH} — by hand`, "-m", `Task: ${SLUG}`, BRANCH], { cwd: root });
    git(["worktree", "remove", "--force", s.worktree], { cwd: root });
    git(["branch", "-D", BRANCH], { cwd: root });
    const landedBefore = snapshot(s);
    expect(() => landTask(s.paths, s.config, SLUG, { person: s.person })).toThrow(/does not resolve on main \([0-9a-f]{12}\): evidence\/empty\.txt is empty/);
    expect(snapshot(s)).toEqual(landedBefore);
  });

  it("still merges, by hand, a task the policy report refuses for its risk class and for having no checks", () => {
    const s = setup();
    const report = evaluateCompletion(s.repo.root, SLUG);
    expect(report.verdict).toBe("refused");
    const failed = report.gates.filter((g) => g.status === "fail").map((g) => g.id);
    expect(failed).toEqual(expect.arrayContaining(["risk", "criteria"]));
    expect(report.risk?.effective).toBe("high");
    const r = cli(s.repo.root, ["decide", SLUG, "approved"]);
    expect(r.ok, r.stderr).toBe(true);
    expect(getTask(s.paths, s.config, SLUG).state).toBe("done");
    expect(out(s.repo.root, ["show", `HEAD:${packetRelPath(SLUG)}`])).toMatch(new RegExp(`^decided_by: ${s.person.handle}$`, "m"));
  });
});

describe("one landing at a time", () => {
  it("keeps its lock under the git directory every worktree shares", () => {
    const s = setup();
    expect(landLockFile(s.worktree)).toBe(landLockFile(s.repo.root));
    expect(landLockFile(s.repo.root)).toBe(path.join(gitCommonDir(s.repo.root), "reggie-land.lock"));
    expect(gitCommonDir(s.worktree)).toBe(gitCommonDir(s.repo.root));
  });

  it("refuses while a lock names a live pid, naming the other slug, the pid and the start, and changes nothing", () => {
    const s = setup();
    const lock = landLockFile(s.repo.root);
    const at = new Date().toISOString();
    writeFileSync(lock, lockBody({ pid: process.pid, at }), "utf8");
    const before = snapshot(s);
    const held = readFileSync(lock, "utf8");
    expect(() => landTask(s.paths, s.config, SLUG, { person: s.person })).toThrow(new RegExp(`another landing is in progress: task/another-task \\(pid ${process.pid}, started ${at.replace(/[.]/g, "\\.")}\\)`));
    expect(snapshot(s)).toEqual(before);
    // The lock is someone else's, so it is still there, byte for byte.
    expect(readFileSync(lock, "utf8")).toBe(held);
    const viaCli = cli(s.repo.root, ["decide", SLUG, "approved"]);
    expect(viaCli.ok).toBe(false);
    expect(viaCli.stderr).toContain("One task lands at a time");
    expect(snapshot(s)).toEqual(before);
    rmSync(lock);
  });

  it("replaces a lock whose pid is dead, and one older than ten minutes, and lands", () => {
    for (const stale of ["dead", "old"] as const) {
      const s = setup();
      const lock = landLockFile(s.repo.root);
      const gone = spawnSync(process.execPath, ["-e", ""]).pid ?? 0;
      expect(gone).toBeGreaterThan(0);
      writeFileSync(lock, stale === "dead" ? lockBody({ pid: gone }) : lockBody({ pid: process.pid, at: new Date(Date.now() - LAND_LOCK_STALE_MS - 1000).toISOString() }), "utf8");
      const r = landTask(s.paths, s.config, SLUG, { person: s.person });
      expect(r.merge, stale).toMatch(/^[0-9a-f]{40}$/);
      expect(existsSync(lock), stale).toBe(false);
    }
  });

  it("leaves no lock behind after a landing, a refusal, a conflict, and a throw while the approval is being recorded", () => {
    const landed = setup();
    landTask(landed.paths, landed.config, SLUG, { person: landed.person });
    expect(existsSync(landLockFile(landed.repo.root))).toBe(false);

    const refused = setup();
    writeFileSync(path.join(refused.repo.root, "README.md"), "# dirty\n", "utf8");
    expect(() => landTask(refused.paths, refused.config, SLUG, { person: refused.person })).toThrow(LandError);
    expect(existsSync(landLockFile(refused.repo.root))).toBe(false);

    const conflicted = setup();
    mkdirSync(path.join(conflicted.repo.root, "src/auth"), { recursive: true });
    writeFileSync(path.join(conflicted.repo.root, "src/auth/login.ts"), "export const retries = 5;\n", "utf8");
    commitIn(conflicted.repo.root, ["main caps retries differently"], ["src/auth/login.ts"]);
    expect(() => landTask(conflicted.paths, conflicted.config, SLUG, { person: conflicted.person })).toThrow(/conflicts in src\/auth\/login\.ts/);
    expect(existsSync(landLockFile(conflicted.repo.root))).toBe(false);

    const thrown = setup();
    const before = snapshot(thrown);
    expect(() =>
      landTask(thrown.paths, thrown.config, SLUG, {
        person: thrown.person,
        captureIssues: () => {
          throw new Error("the disk is full");
        },
      }),
    ).toThrow("the disk is full");
    expect(existsSync(landLockFile(thrown.repo.root))).toBe(false);
    // And the merge it had started is gone: both ids, the tree and the verdict are what they were.
    expect(snapshot(thrown)).toEqual(before);
  });

  it("refuses before running git merge when a merge is already in progress, and leaves that merge exactly as it was", () => {
    const s = setup();
    const root = s.repo.root;
    git(["switch", "-q", "-c", "side"], { cwd: root });
    writeFileSync(path.join(root, "side.txt"), "from the side branch\n", "utf8");
    commitIn(root, ["side work"], ["side.txt"]);
    git(["switch", "-q", "main"], { cwd: root });
    git(["merge", "--no-ff", "--no-commit", "side"], { cwd: root });
    const state = () => ({
      mergeHead: readFileSync(path.join(root, ".git", "MERGE_HEAD"), "utf8"),
      index: out(root, ["ls-files", "-s"]),
      status: out(root, ["status", "--porcelain"]),
      main: out(root, ["rev-parse", "main"]),
      branch: out(root, ["rev-parse", BRANCH]),
      side: readFileSync(path.join(root, "side.txt"), "utf8"),
    });
    const before = state();
    expect(() => landTask(s.paths, s.config, SLUG, { person: s.person })).toThrow(/a merge is already in progress in this checkout.*Reggie does not abort a merge it did not start/);
    expect(state()).toEqual(before);
    expect(existsSync(landLockFile(root))).toBe(false);
    git(["merge", "--abort"], { cwd: root });
  });
});

describe("discovered issues, captured inside the merge commit", () => {
  const CONTROL = String.fromCharCode(7);
  const BULLETS = [
    "- (unrelated problems found on the way, one bullet each, or \"none\"; an approval captures every bullet that is not in intake yet)",
    "- None worth a task beyond the ones below.",
    "- The board mislabels every conflict; already in the queue as `board-mislabels-conflicts`",
    "- The toast hides the reason a landing was refused, captured as toast-hides-the-reason",
    "- Landing twice writes two verdict commits",
    "- The evidence route serves flat names only, so a folder of screenshots cannot be linked",
    `- **Onboard** does not ignore \`.worktree/\`, so [[x|y]] ${CONTROL}a fresh repo`,
    "  records the task worktree as an embedded repository,",
    "    - measured twice in a freshly onboarded fixture",
  ].join("\n");

  /** A task whose packet lists all seven kinds of bullet, with three of them already known to the base's intake. */
  function setupWithIssues(): Setup {
    const s = setup();
    for (const [slug, text] of [["board-mislabels-conflicts", "The board says no packet for every 409"], ["toast-hides-the-reason", "The toast drops the server's sentence"], ["landing-twice-writes-two-verdict-commits", "A second approval of a landed task commits again"]] as const) {
      capture(s.paths, { text, slug, person: s.person, source: "cli" });
    }
    commitIn(s.repo.root, ["capture: three known issues"], [".reggie/intake.md"]);
    rewriteSection(s, "Discovered issues", BULLETS);
    return s;
  }

  it("captures exactly the two fresh bullets, in the one merge commit, attributed to the session that found them", () => {
    const s = setupWithIssues();
    const root = s.repo.root;
    const itemsBefore = parseIntake(readText(s.paths.intake) ?? "").length;
    const r = landTask(s.paths, s.config, SLUG, { person: s.person });
    expect(r.captured).toEqual(["the-evidence-route-serves-flat-names-only-so-a-f", "onboard-does-not-ignore-worktree-so-x-y-a-fresh"]);

    const merged = parseIntake(out(root, ["show", `${r.merge}:.reggie/intake.md`]));
    expect(merged).toHaveLength(itemsBefore + 2);
    const [flat, onboard] = r.captured.map((slug) => merged.find((i) => i.slug === slug));
    expect(flat).toMatchObject({ text: "The evidence route serves flat names only, so a folder of screenshots cannot be linked", detail: ["Captured from the task `cap-retries`"] });
    expect(flat?.meta).toMatch(new RegExp(`^${s.person.handle}, packet, \\d{4}-\\d{2}-\\d{2}$`));
    expect(onboard?.text).toBe("**Onboard** does not ignore `.worktree/`, so [[x|y]] a fresh repo");
    expect(onboard?.detail).toEqual(["records the task worktree as an embedded repository,", "- measured twice in a freshly onboarded fixture", "Captured from the task `cap-retries`"]);
    expect(onboard?.meta).toMatch(/, packet, /);
    expect(out(root, ["show", `${r.merge}:.reggie/intake.md`])).not.toContain(CONTROL);

    // One commit holds the landing, the verdict, the journal line and the captures.
    const stat = out(root, ["show", "--stat", "--format=", "-m", "--first-parent", r.merge ?? ""]);
    expect(stat).toContain(packetRelPath(SLUG));
    expect(stat).toContain(".reggie/journal/");
    expect(stat).toContain(".reggie/intake.md");
    expect(out(root, ["rev-list", "--count", `${r.merge}^1..${r.merge}`, "--first-parent"])).toBe("1");
    expect(out(root, ["status", "--porcelain", "--untracked-files=no"])).toBe("");
  });

  it("prints the captured slugs from the CLI", () => {
    const s = setupWithIssues();
    const r = cli(s.repo.root, ["decide", SLUG, "approved"]);
    expect(r.ok, r.stderr).toBe(true);
    expect(r.stdout).toContain("captured from the packet's discovered issues, in the same commit: the-evidence-route-serves-flat-names-only-so-a-f, onboard-does-not-ignore-worktree-so-x-y-a-fresh");
  });

  it("aborts the merge and records nothing when capturing throws", () => {
    const s = setupWithIssues();
    const before = snapshot(s);
    const intake = readFileSync(s.paths.intake, "utf8");
    expect(() =>
      landTask(s.paths, s.config, SLUG, {
        person: s.person,
        captureIssues: (p, input) => {
          // Half the work done, then the failure: the abort has to take the written line back out.
          capture(p, { text: "written before the throw", person: input.decider, source: "packet" });
          throw new Error("intake could not be written");
        },
      }),
    ).toThrow("intake could not be written");
    expect(snapshot(s)).toEqual(before);
    expect(readFileSync(s.paths.intake, "utf8")).toBe(intake);
    expect(existsSync(path.join(s.repo.root, ".git", "MERGE_HEAD"))).toBe(false);
  });

  it("puts the intake back even when the branch changed it too, where a bare merge --abort would be refused", () => {
    const s = setup();
    // Only the branch touches the intake, so the merge stages it; a line written on top of that and
    // left unstaged is exactly what `git merge --abort` refuses to discard.
    capture(repoPaths(s.worktree), { text: "Captured on the branch by the session", person: s.person, source: "cli" });
    commitIn(s.worktree, ["capture: on the branch", `Task: ${SLUG}`], [".reggie/intake.md"]);
    rewriteSection(s, "Discovered issues", "- A fresh issue nobody captured, long enough to count");
    const before = snapshot(s);
    const intake = readFileSync(s.paths.intake, "utf8");
    for (const when of ["before the verdict", "after the verdict"] as const) {
      expect(() =>
        landTask(s.paths, s.config, SLUG, {
          person: s.person,
          captureIssues: (p, input) => {
            capture(p, { text: `written ${when}, then the throw`, person: input.decider, source: "packet" });
            throw new Error(`failed ${when}`);
          },
        }),
      ).toThrow(`failed ${when}`);
      expect(snapshot(s), when).toEqual(before);
      expect(readFileSync(s.paths.intake, "utf8"), when).toBe(intake);
      expect(out(s.repo.root, ["status", "--porcelain"]), when).toBe("");
    }
    // And with nothing thrown, the same task lands with both the branch's line and the captured one.
    const r = landTask(s.paths, s.config, SLUG, { person: s.person });
    const slugs = parseIntake(out(s.repo.root, ["show", `${r.merge}:.reggie/intake.md`])).map((i) => i.slug);
    expect(slugs).toEqual(expect.arrayContaining(["captured-on-the-branch-by-the-session", ...r.captured]));
    expect(r.captured).toHaveLength(1);
  });

  it("writes the captures of a task that had already landed into its verdict commit, and captures nothing the second time", () => {
    const s = setupWithIssues();
    const root = s.repo.root;
    git(["merge", "-q", "--no-ff", "-m", `merge: ${BRANCH} — by hand`, "-m", `Task: ${SLUG}`, BRANCH], { cwd: root });
    git(["worktree", "remove", "--force", s.worktree], { cwd: root });
    const first = landTask(s.paths, s.config, SLUG, { person: s.person });
    expect(first.alreadyLanded).toBe(true);
    expect(first.captured).toHaveLength(2);
    expect(out(root, ["show", "--stat", "--format=", first.commit])).toContain(".reggie/intake.md");
    expect(out(root, ["show", "--format=%s", "--no-patch", first.commit])).toBe(`decide: ${SLUG} approved`);

    const intake = readFileSync(s.paths.intake, "utf8");
    const second = landTask(s.paths, s.config, SLUG, { person: s.person });
    expect(second.captured).toEqual([]);
    expect(readFileSync(s.paths.intake, "utf8")).toBe(intake);
    expect(out(root, ["show", "--stat", "--format=", second.commit])).not.toContain(".reggie/intake.md");
  });

  it("captures nothing on needs-work or on a team-mode approval, which write exactly the files they wrote before", () => {
    const hash = (file: string) => createHash("sha256").update(readFileSync(file)).digest("hex");
    for (const door of ["needs-work", "team"] as const) {
      const s = setupWithIssues();
      const wtPaths = repoPaths(s.worktree);
      const before = { base: hash(s.paths.intake), worktree: hash(wtPaths.intake), main: out(s.repo.root, ["rev-parse", "main"]), branch: out(s.repo.root, ["rev-parse", BRANCH]) };
      if (door === "team") writeText(wtPaths.config, "mode: team\n");
      const r = cli(s.worktree, ["decide", SLUG, door === "team" ? "approved" : "needs-work"]);
      expect(r.ok, r.stderr).toBe(true);
      expect({ base: hash(s.paths.intake), worktree: hash(wtPaths.intake), main: out(s.repo.root, ["rev-parse", "main"]), branch: out(s.repo.root, ["rev-parse", BRANCH]) }).toEqual(before);
      const touched = git(["status", "--porcelain"], { cwd: s.worktree }).stdout.split("\n").filter(Boolean).map((l) => l.slice(3)).filter((f) => f !== ".reggie/config.yaml");
      expect(touched.sort()).toEqual([expect.stringMatching(/^\.reggie\/journal\/\d{4}-\d{2}-\d{2}\/.*\.md$/), packetRelPath(SLUG)]);
      expect(out(s.repo.root, ["status", "--porcelain"])).toBe("");
    }
  });
});

