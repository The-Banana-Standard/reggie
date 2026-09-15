import { existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { makeTempRepo, type TempRepo } from "../test/helpers.js";
import { claimTask, releaseTask } from "./claim.js";
import { lockfilesMatch, pendingSetup, prepareDeps, unlinkDeps } from "./deps.js";
import { git } from "./git.js";
import { onboard } from "./onboard.js";
import { repoPaths, type RepoPaths } from "./paths.js";
import { currentPerson, loadConfig, type InstallEntry, type Person, type ReggieConfig } from "./people.js";
import { writeText } from "./util.js";

/** The one installed directory every fixture uses; the point is that it is not the repo root. */
const DIR = "pkg";
const INSTALL = "node install.js";
const LOCK = '{"lockfileVersion": 3}\n';

/** Written by the install command, so a test can tell a real install from a link. */
const INSTALL_SCRIPT = ['const fs = require("node:fs");', 'fs.mkdirSync("node_modules", { recursive: true });', 'fs.writeFileSync("node_modules/installed", "yes");', ""].join("\n");

interface Fixture {
  repo: TempRepo;
  paths: RepoPaths;
  config: ReggieConfig;
  person: Person;
  /** The serving checkout's real dependency folder, the thing a link must never damage. */
  serveDeps: string;
  /** Tear down with retries; these fixtures hold git worktrees, which a single rmdir pass races. */
  cleanup(): void;
}

interface FixtureOptions {
  /** Install the serving checkout's dependencies, so there is something to link. Default true. */
  served?: boolean;
  /** The configured command. Default `node install.js`. */
  command?: string;
  /** Leave `install` out of the config entirely. */
  unconfigured?: boolean;
  /** Configure a directory that the checkout does not have. */
  dir?: string;
}

function fixture(opts: FixtureOptions = {}): Fixture {
  const repo = makeTempRepo("reggie-deps-");
  onboard(repo.root);
  // node_modules bare (so it also covers a symlink) and .worktree, exactly as this repo ignores them.
  repo.write(".gitignore", "node_modules\nnode_modules/\n.worktree/\n");
  repo.write(`${DIR}/package-lock.json`, LOCK);
  repo.write(`${DIR}/install.js`, INSTALL_SCRIPT);
  repo.write(`${DIR}/fail.js`, 'console.error("no registry, sorry");\nprocess.exit(3);\n');
  repo.write(`${DIR}/slow.js`, "setTimeout(() => {}, 60000);\n");
  repo.commitAll("fixture");

  const paths = repoPaths(repo.root);
  const config = loadConfig(paths);
  if (!opts.unconfigured) config.install = [{ dir: opts.dir ?? DIR, command: opts.command ?? INSTALL }];

  const serveDeps = path.join(repo.root, DIR, "node_modules");
  if (opts.served !== false) {
    mkdirSync(serveDeps, { recursive: true });
    writeFileSync(path.join(serveDeps, "marker"), "serving", "utf8");
  }
  // rmSync unlinks a symlink rather than following it, so a fixture's links cannot reach outside
  // its own temp root. The retries are for git, which is still finishing with .git/objects.
  const cleanup = () => rmSync(repo.root, { recursive: true, force: true, maxRetries: 20, retryDelay: 50 });
  return { repo, paths, config, person: currentPerson(repo.root), serveDeps, cleanup };
}

/** Commit a changed lockfile on the task branch, so the worktree and the checkout disagree. */
function bumpLockOnBranch(root: string, slug: string): void {
  git(["switch", "-c", `task/${slug}`], { cwd: root });
  writeFileSync(path.join(root, DIR, "package-lock.json"), '{"lockfileVersion": 3, "bumped": true}\n', "utf8");
  git(["add", "--", `${DIR}/package-lock.json`], { cwd: root });
  git(["commit", "-q", "-m", "bump the lockfile"], { cwd: root });
  git(["switch", "main"], { cwd: root });
}

const depsOf = (worktree: string, dir = DIR) => path.join(worktree, dir, "node_modules");

describe("the install config key", () => {
  let repo: TempRepo;
  afterEach(() => repo.cleanup());

  it("reads dir and command, defaults a missing dir, and drops what it cannot safely run", () => {
    repo = makeTempRepo("reggie-deps-config-");
    const paths = repoPaths(repo.root);
    writeText(
      paths.config,
      [
        "mode: solo",
        "install:",
        "  - dir: packages/reggie",
        "    command: npm ci --legacy-peer-deps",
        "  - command: npm install",
        "  - dir: /etc",
        "    command: npm ci",
        "  - dir: ../sibling",
        "    command: npm ci",
        "  - dir: deep/../../out",
        "    command: npm ci",
        "  - dir: fine",
        '    command: "   "',
        "  - dir: alsofine",
        "  - just-a-string",
        "",
      ].join("\n"),
    );
    expect(loadConfig(paths).install).toEqual([
      { dir: "packages/reggie", command: "npm ci --legacy-peer-deps" },
      { dir: ".", command: "npm install" },
    ]);
  });

  it("leaves install undefined when the key is absent", () => {
    repo = makeTempRepo("reggie-deps-nokey-");
    const paths = repoPaths(repo.root);
    writeText(paths.config, "mode: solo\nmcpServerName: reggie\n");
    expect(loadConfig(paths).install).toBeUndefined();
  });
});

describe("lockfilesMatch", () => {
  let repo: TempRepo;
  afterEach(() => repo.cleanup());

  it("needs at least one lockfile, the same set on both sides, byte for byte", () => {
    repo = makeTempRepo("reggie-deps-lock-");
    const a = path.join(repo.root, "a");
    const b = path.join(repo.root, "b");
    mkdirSync(a, { recursive: true });
    mkdirSync(b, { recursive: true });
    expect(lockfilesMatch(a, b)).toBe(false);

    writeFileSync(path.join(a, "package-lock.json"), LOCK, "utf8");
    expect(lockfilesMatch(a, b)).toBe(false);
    writeFileSync(path.join(b, "package-lock.json"), LOCK, "utf8");
    expect(lockfilesMatch(a, b)).toBe(true);

    writeFileSync(path.join(b, "package-lock.json"), `${LOCK} `, "utf8");
    expect(lockfilesMatch(a, b)).toBe(false);

    writeFileSync(path.join(b, "package-lock.json"), LOCK, "utf8");
    writeFileSync(path.join(b, "pnpm-lock.yaml"), "lockfileVersion: 9\n", "utf8");
    expect(lockfilesMatch(a, b)).toBe(false);
  });
});

describe("a claimed worktree's dependencies", () => {
  let f: Fixture;
  afterEach(() => f.cleanup());

  it("links the serving checkout's folder when the lockfiles are byte-identical, and runs nothing", () => {
    f = fixture();
    const claim = claimTask(f.paths, f.config, "link-me", { person: f.person, worktree: true });
    expect(claim.deps).toEqual([{ dir: DIR, command: INSTALL, status: "linked" }]);

    const link = depsOf(claim.worktree!);
    expect(lstatSync(link).isSymbolicLink()).toBe(true);
    expect(realpathSync(link)).toBe(realpathSync(f.serveDeps));
    expect(readFileSync(path.join(link, "marker"), "utf8")).toBe("serving");
    // The install script writes this; through the link its absence proves no command ran.
    expect(existsSync(path.join(link, "installed"))).toBe(false);
    // The link must stay invisible to git, or every task commit would carry it.
    expect(git(["status", "--porcelain"], { cwd: claim.worktree! }).stdout.trim()).toBe("");
  });

  it("installs instead of linking when the branch changed the lockfile", () => {
    f = fixture();
    bumpLockOnBranch(f.repo.root, "bumped");
    const claim = claimTask(f.paths, f.config, "bumped", { person: f.person, worktree: true });
    expect(claim.deps).toEqual([{ dir: DIR, command: INSTALL, status: "installed" }]);

    const deps = depsOf(claim.worktree!);
    expect(lstatSync(deps).isSymbolicLink()).toBe(false);
    expect(existsSync(path.join(deps, "installed"))).toBe(true);
    // Nothing landed in the shared tree, which is the whole reason a link is not always safe.
    expect(existsSync(path.join(f.serveDeps, "installed"))).toBe(false);
  });

  it("installs when the serving checkout has nothing to link", () => {
    f = fixture({ served: false });
    const claim = claimTask(f.paths, f.config, "empty", { person: f.person, worktree: true });
    expect(claim.deps).toEqual([{ dir: DIR, command: INSTALL, status: "installed" }]);
    expect(existsSync(path.join(depsOf(claim.worktree!), "installed"))).toBe(true);
  });

  it("keeps the claim and the worktree when the install fails, and names the command to run", () => {
    f = fixture({ served: false, command: "node fail.js" });
    const claim = claimTask(f.paths, f.config, "broken", { person: f.person, worktree: true });
    expect(claim.deps[0]).toEqual({ dir: DIR, command: "node fail.js", status: "failed", reason: "exit 3: no registry, sorry", pending: true });
    expect(pendingSetup(claim.deps)).toEqual([{ dir: DIR, command: "node fail.js" }]);
    expect(existsSync(claim.worktree!)).toBe(true);
    expect(git(["log", "--format=%s", "task/broken"], { cwd: f.repo.root }).stdout).toContain("meta: claim broken");
    expect(existsSync(path.join(f.repo.root, ".reggie", "tasks", "broken"))).toBe(false);
  });

  it("bounds an install that hangs", () => {
    f = fixture({ served: false, command: "node slow.js" });
    const claim = claimTask(f.paths, f.config, "hangs", { person: f.person, worktree: true, depsTimeoutMs: 200 });
    expect(claim.deps[0]).toMatchObject({ dir: DIR, command: "node slow.js", status: "failed" });
    expect(claim.deps[0]?.reason).toMatch(/timed out after 200ms/);
    expect(existsSync(claim.worktree!)).toBe(true);
  });

  it("says so when the configured directory is not in the worktree", () => {
    f = fixture({ dir: "not-here" });
    const claim = claimTask(f.paths, f.config, "missing-dir", { person: f.person, worktree: true });
    expect(claim.deps[0]).toEqual({ dir: "not-here", command: INSTALL, status: "failed", reason: "no not-here directory in the worktree" });
    // Telling a session to install into a directory that is not there is worse than saying nothing.
    expect(pendingSetup(claim.deps)).toEqual([]);
  });

  it("does nothing at all when the repo has no install key", () => {
    f = fixture({ unconfigured: true });
    const claim = claimTask(f.paths, f.config, "plain", { person: f.person, worktree: true });
    expect(claim.deps).toEqual([]);
    expect(existsSync(depsOf(claim.worktree!))).toBe(false);
  });

  it("returns no outcomes for an in-place claim, which has no worktree to prepare", () => {
    f = fixture();
    const claim = claimTask(f.paths, f.config, "in-place", { person: f.person });
    expect(claim.worktree).toBeNull();
    expect(claim.deps).toEqual([]);
  });

  it("replaces a link gone stale on resume, and installs instead", () => {
    f = fixture();
    const first = claimTask(f.paths, f.config, "resumed", { person: f.person, worktree: true });
    expect(first.deps[0]?.status).toBe("linked");
    const worktree = first.worktree!;

    writeFileSync(path.join(worktree, DIR, "package-lock.json"), '{"lockfileVersion": 3, "bumped": true}\n', "utf8");
    git(["add", "--", `${DIR}/package-lock.json`], { cwd: worktree });
    git(["commit", "-q", "-m", "add a dependency"], { cwd: worktree });

    const again = claimTask(f.paths, f.config, "resumed", { person: f.person, worktree: true });
    expect(again.alreadyExisted).toBe(true);
    expect(again.deps).toEqual([{ dir: DIR, command: INSTALL, status: "installed" }]);
    expect(lstatSync(depsOf(worktree)).isSymbolicLink()).toBe(false);
    expect(existsSync(path.join(depsOf(worktree), "installed"))).toBe(true);
    // Unlinked, never deleted through: the serving checkout still has everything it had.
    expect(readFileSync(path.join(f.serveDeps, "marker"), "utf8")).toBe("serving");
    expect(existsSync(path.join(f.serveDeps, "installed"))).toBe(false);
  });

  it("leaves a link alone on resume while the lockfiles still agree", () => {
    f = fixture();
    const first = claimTask(f.paths, f.config, "steady", { person: f.person, worktree: true });
    const again = claimTask(f.paths, f.config, "steady", { person: f.person, worktree: true });
    expect(again.deps).toEqual([{ dir: DIR, command: INSTALL, status: "linked" }]);
    expect(realpathSync(depsOf(first.worktree!))).toBe(realpathSync(f.serveDeps));
  });

  it("never touches a real node_modules directory the worktree already holds", () => {
    f = fixture();
    const worktree = path.join(f.repo.root, ".worktree", "own");
    git(["worktree", "add", "-b", "task/own", worktree, "main"], { cwd: f.repo.root });
    mkdirSync(depsOf(worktree), { recursive: true });
    writeFileSync(path.join(depsOf(worktree), "mine"), "hand-installed", "utf8");

    const claim = claimTask(f.paths, f.config, "own", { person: f.person, worktree: true });
    expect(claim.deps).toEqual([{ dir: DIR, command: INSTALL, status: "present" }]);
    expect(lstatSync(depsOf(worktree)).isSymbolicLink()).toBe(false);
    expect(readFileSync(path.join(depsOf(worktree), "mine"), "utf8")).toBe("hand-installed");
  });
});

describe("deferring the install", () => {
  let f: Fixture;
  afterEach(() => f.cleanup());

  it("runs no command and hands every pending entry back", () => {
    f = fixture({ served: false });
    const claim = claimTask(f.paths, f.config, "later", { person: f.person, worktree: true, deps: "defer" });
    expect(claim.deps).toEqual([{ dir: DIR, command: INSTALL, status: "deferred", pending: true }]);
    expect(existsSync(depsOf(claim.worktree!))).toBe(false);
    expect(pendingSetup(claim.deps)).toEqual([{ dir: DIR, command: INSTALL }]);
  });

  it("still links what it can link, because linking costs nothing", () => {
    f = fixture();
    const claim = claimTask(f.paths, f.config, "linkable", { person: f.person, worktree: true, deps: "defer" });
    expect(claim.deps).toEqual([{ dir: DIR, command: INSTALL, status: "linked" }]);
    expect(pendingSetup(claim.deps)).toEqual([]);
  });

  it("counts a failed entry as pending too, so the session is told to run it", () => {
    const outcomes = [
      { dir: "a", command: "npm ci", status: "failed" as const, reason: "exit 1", pending: true as const },
      { dir: "b", command: "npm ci", status: "linked" as const },
      { dir: "c", command: "npm ci", status: "present" as const },
      { dir: "d", command: "npm ci", status: "failed" as const, reason: "no d directory in the worktree" },
    ];
    expect(pendingSetup(outcomes)).toEqual([{ dir: "a", command: "npm ci" }]);
  });
});

describe("releasing a worktree that holds a link", () => {
  let f: Fixture;
  afterEach(() => f.cleanup());

  it("unlinks first, so a forced release cannot empty the serving checkout", () => {
    f = fixture();
    const claim = claimTask(f.paths, f.config, "release-me", { person: f.person, worktree: true });
    expect(lstatSync(depsOf(claim.worktree!)).isSymbolicLink()).toBe(true);

    const actions = releaseTask(f.paths, f.config, "release-me", f.person, { force: true });
    expect(actions.some((a) => a.startsWith("unlinked "))).toBe(true);
    expect(actions.indexOf(actions.find((a) => a.startsWith("unlinked "))!)).toBeLessThan(actions.indexOf(actions.find((a) => a.startsWith("removed worktree"))!));
    expect(existsSync(claim.worktree!)).toBe(false);
    expect(existsSync(f.serveDeps)).toBe(true);
    expect(readFileSync(path.join(f.serveDeps, "marker"), "utf8")).toBe("serving");
  });

  it("removes links and nothing else", () => {
    f = fixture();
    const worktree = path.join(f.repo.root, ".worktree", "solo");
    mkdirSync(path.join(worktree, DIR), { recursive: true });
    const real = depsOf(worktree);
    mkdirSync(real, { recursive: true });
    writeFileSync(path.join(real, "keep"), "real", "utf8");

    expect(unlinkDeps(worktree, f.config.install)).toEqual([]);
    expect(existsSync(path.join(real, "keep"))).toBe(true);
    expect(unlinkDeps(worktree, undefined)).toEqual([]);
  });
});

describe("the ways a link or a folder can be wrong", () => {
  let f: Fixture;
  afterEach(() => f.cleanup());

  it("replaces a link whose target has been deleted, rather than calling it ready", () => {
    f = fixture();
    const first = claimTask(f.paths, f.config, "dangling", { person: f.person, worktree: true });
    expect(first.deps[0]?.status).toBe("linked");
    // The serving checkout's folder goes away; the link survives it and still lstats fine.
    rmSync(f.serveDeps, { recursive: true, force: true });
    expect(lstatSync(depsOf(first.worktree!)).isSymbolicLink()).toBe(true);

    const again = claimTask(f.paths, f.config, "dangling", { person: f.person, worktree: true });
    expect(again.deps).toEqual([{ dir: DIR, command: INSTALL, status: "installed" }]);
    expect(lstatSync(depsOf(first.worktree!)).isSymbolicLink()).toBe(false);
    expect(existsSync(path.join(depsOf(first.worktree!), "installed"))).toBe(true);
  });

  it("links from a serving folder that is itself a link, which is every nested worktree", () => {
    f = fixture();
    // Stand the serving checkout's node_modules up as a link, exactly as a worktree inside a
    // worktree has it. lstat would call this "not a directory" and install instead of linking.
    const real = path.join(f.repo.root, "shared-node-modules");
    mkdirSync(real, { recursive: true });
    writeFileSync(path.join(real, "marker"), "serving", "utf8");
    rmSync(f.serveDeps, { recursive: true, force: true });
    symlinkSync(real, f.serveDeps, "dir");

    const claim = claimTask(f.paths, f.config, "nested", { person: f.person, worktree: true });
    expect(claim.deps).toEqual([{ dir: DIR, command: INSTALL, status: "linked" }]);
    expect(realpathSync(depsOf(claim.worktree!))).toBe(realpathSync(real));
  });

  it("says a real folder is out of date rather than letting the branch look ready", () => {
    f = fixture();
    bumpLockOnBranch(f.repo.root, "moved-on");
    const worktree = path.join(f.repo.root, ".worktree", "moved-on");
    git(["worktree", "add", "-q", worktree, "task/moved-on"], { cwd: f.repo.root });
    mkdirSync(depsOf(worktree), { recursive: true });
    writeFileSync(path.join(depsOf(worktree), "old"), "installed before the bump", "utf8");

    const claim = claimTask(f.paths, f.config, "moved-on", { person: f.person, worktree: true });
    expect(claim.deps).toEqual([{ dir: DIR, command: INSTALL, status: "present", reason: `${DIR}/node_modules does not match this branch's lockfile`, pending: true }]);
    // Still untouched: Reggie never deletes a real install, it only says the truth about it.
    expect(readFileSync(path.join(depsOf(worktree), "old"), "utf8")).toBe("installed before the bump");
    expect(pendingSetup(claim.deps)).toEqual([{ dir: DIR, command: INSTALL }]);
  });

  it("turns a filesystem error into a failed outcome instead of a failed claim", () => {
    f = fixture();
    const worktree = path.join(f.repo.root, ".worktree", "blocked");
    git(["worktree", "add", "-q", worktree, "-b", "task/blocked", "main"], { cwd: f.repo.root });
    // A plain file where the folder belongs: nothing can be linked or installed over it.
    writeFileSync(depsOf(worktree), "not a folder", "utf8");

    const claim = claimTask(f.paths, f.config, "blocked", { person: f.person, worktree: true });
    expect(claim.deps).toEqual([{ dir: DIR, command: INSTALL, status: "failed", reason: `${DIR}/node_modules is not a directory` }]);
    // The claim itself went through: the branch, the worktree and the claim commit are all there.
    expect(claim.branch).toBe("task/blocked");
    expect(git(["log", "--format=%s", "task/blocked", "-1"], { cwd: f.repo.root }).stdout.trim()).toBe("meta: claim blocked");
  });
});

describe("prepareDeps on its own", () => {
  let f: Fixture;
  afterEach(() => f.cleanup());

  it("returns nothing for an empty or absent entry list", () => {
    f = fixture();
    expect(prepareDeps(f.repo.root, f.repo.root, undefined)).toEqual([]);
    expect(prepareDeps(f.repo.root, f.repo.root, [])).toEqual([]);
  });

  it("replaces a link that points somewhere else once the lockfiles disagree", () => {
    f = fixture();
    const worktree = path.join(f.repo.root, "elsewhere");
    mkdirSync(path.join(worktree, DIR), { recursive: true });
    writeFileSync(path.join(worktree, DIR, "package-lock.json"), '{"lockfileVersion": 3, "other": true}\n', "utf8");
    writeFileSync(path.join(worktree, DIR, "install.js"), INSTALL_SCRIPT, "utf8");
    symlinkSync(f.serveDeps, depsOf(worktree), "dir");

    const entries: InstallEntry[] = [{ dir: DIR, command: INSTALL }];
    expect(prepareDeps(f.repo.root, worktree, entries)).toEqual([{ dir: DIR, command: INSTALL, status: "installed" }]);
    expect(lstatSync(depsOf(worktree)).isSymbolicLink()).toBe(false);
    expect(existsSync(path.join(f.serveDeps, "installed"))).toBe(false);
  });
});
