import { appendFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { fullPlan, makeTempRepo, type TempRepo } from "../test/helpers.js";
import { claimTask } from "./claim.js";
import { fileAtRef, git, run } from "./git.js";
import { clearHistoryCache, taskLanding } from "./history.js";
import { LandError, landTask } from "./land.js";
import { ensureLayout } from "./layout.js";
import { parsePacketVerdict, scaffoldPacket } from "./packet.js";
import { packetFile, packetRelPath, planFile, repoPaths, type RepoPaths } from "./paths.js";
import { currentPerson, loadConfig, loadPeople, type Person, type ReggieConfig } from "./people.js";
import { getTask } from "./tasks.js";
import { writeText } from "./util.js";

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
