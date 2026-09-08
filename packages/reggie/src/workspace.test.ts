import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { makeTempRepo } from "../test/helpers.js";
import { git } from "./git.js";
import { appendJournal } from "./journal.js";
import { addNote, allNoteFiles } from "./notes.js";
import { repoPaths } from "./paths.js";
import type { TaskInfo } from "./tasks.js";
import {
  autoDetectWorkspace,
  codeInventory,
  discoverWorkspace,
  knowledgeCoverage,
  manifestInfo,
  parseCargoToml,
  parseRemoteUrl,
  parseWorkspaceDoc,
  RepoRegistry,
  taskAge,
  workspaceEdges,
  workspaceSummary,
} from "./workspace.js";

function write(root: string, file: string, content: string): void {
  const full = path.join(root, file);
  mkdirSync(path.dirname(full), { recursive: true });
  writeFileSync(full, content, "utf8");
}

/** A git repo at a fixed location (inside the workspace dir), unlike makeTempRepo which picks its own path. */
function initRepo(root: string, remote: string | null): void {
  mkdirSync(root, { recursive: true });
  git(["init", "-q", "-b", "main"], { cwd: root });
  git(["config", "user.name", "Test Person"], { cwd: root });
  git(["config", "user.email", "test@example.com"], { cwd: root });
  git(["config", "commit.gpgsign", "false"], { cwd: root });
  if (remote) git(["remote", "add", "origin", remote], { cwd: root });
}

function commitAll(root: string, message: string): void {
  git(["add", "-A"], { cwd: root });
  git(["commit", "-q", "--allow-empty", "-m", message], { cwd: root });
}

const CLAUDE_MD = [
  "# Acme Workspace",
  "",
  "## Overview",
  "Two shipped repos and one that is not cloned yet.",
  "",
  "```md",
  "# Not the title",
  "## Repos",
  "### fenced",
  "- **Path**: ./fenced",
  "```",
  "",
  "## Repos",
  "",
  "### alpha",
  "- **Path**: ./alpha",
  "- **Purpose**: Shared library used by beta.",
  "- **Tech Stack**: TypeScript",
  "- **Domain**: Library code",
  "",
  "### beta",
  "- **Path**: `./beta`",
  "",
  "### gamma",
  "- **Path**: ./gamma",
  "- **Purpose**: Not cloned yet.",
  "",
  "### delta",
  "- **Path**: ./delta",
  "",
  "### epsilon",
  "- **Purpose**: Listed without a path.",
  "",
  "## Domain Boundaries",
  "",
  "### not-a-repo",
  "- **Path**: ./alpha",
  "",
].join("\n");

describe("parseWorkspaceDoc", () => {
  it("reads the title and every ### block inside ## Repos, ignoring fences and later sections", () => {
    const doc = parseWorkspaceDoc(CLAUDE_MD);
    expect(doc.name).toBe("Acme Workspace");
    expect(doc.hasReposSection).toBe(true);
    expect(doc.repos.map((r) => r.name)).toEqual(["alpha", "beta", "gamma", "delta", "epsilon"]);
    expect(doc.repos[0]).toEqual({ name: "alpha", rel: "./alpha", description: "Shared library used by beta.", techStack: "TypeScript" });
    expect(doc.repos[1]?.rel).toBe("./beta");
    expect(doc.repos[4]?.rel).toBeNull();
  });

  it("reports a document without a ## Repos section", () => {
    const doc = parseWorkspaceDoc("# Solo\n\n## Overview\nNothing here.\n\n### alpha\n- **Path**: ./alpha\n");
    expect(doc.name).toBe("Solo");
    expect(doc.hasReposSection).toBe(false);
    expect(doc.repos).toEqual([]);
  });
});

describe("workspace on disk", () => {
  let ws: string;
  let alpha: string;
  let beta: string;

  beforeAll(() => {
    ws = mkdtempSync(path.join(os.tmpdir(), "reggie-ws-"));
    alpha = path.join(ws, "alpha");
    beta = path.join(ws, "beta");
    write(ws, "CLAUDE.md", CLAUDE_MD);

    initRepo(alpha, "git@github.com:Acme/alpha.git");
    write(alpha, "package.json", JSON.stringify({ name: "@acme/alpha", version: "1.0.0", description: "Alpha from package.json", main: "dist/index.js" }));
    write(alpha, "src/index.ts", "export const one = 1;\n");
    write(alpha, "src/util.ts", "export const two = 2;\n");
    write(alpha, "src/old.ts", "export const three = 3;\n");
    write(alpha, "src/index.test.ts", "import { one } from './index.js';\n");
    write(alpha, "README.md", "# alpha\n");
    write(alpha, ".reggie/intake.md", "# Intake\n\n- fix-thing: Fix the thing (tester, cli, 2026-09-01)\n");
    const alphaPaths = repoPaths(alpha);
    addNote(alphaPaths, "src/index.ts", { type: "how", text: "Exports one.", author: "tester" });
    addNote(alphaPaths, "src/", { type: "why", text: "All the code lives here.", author: "tester" });
    // A hand-written note dated long before the file's last commit, so it reads as stale.
    write(alpha, ".reggie/notes/src/old.ts.md", "---\nentity: src/old.ts\nkind: file\n---\n\n## gotcha · 2020-01-01 · tester · high\nThis note predates the code.\n\n");
    appendJournal(alphaPaths, { person: "tester", tool: "human", text: "Shipped the parser. Next up: the summary." });
    commitAll(alpha, "alpha initial");

    initRepo(beta, "https://github.com/acme/beta.git");
    write(beta, "package.json", JSON.stringify({ name: "beta", version: "1.0.0", description: "The beta app", dependencies: { "@acme/alpha": "^1.0.0" }, devDependencies: { vitest: "^4" } }));
    write(beta, "src/main.ts", "import { one } from '@acme/alpha';\n");
    write(beta, "src/main.rs", "fn main() {}\n");
    write(beta, "docs/guide.md", "# guide\n");
    commitAll(beta, "beta initial");

    // delta exists but is not a git repository; gamma does not exist at all.
    mkdirSync(path.join(ws, "delta"), { recursive: true });
  });

  afterAll(() => {
    rmSync(ws, { recursive: true, force: true });
  });

  it("discoverWorkspace keeps existing git repos and reports the rest", () => {
    const found = discoverWorkspace(ws);
    expect(found).not.toBeNull();
    if (!found) return;
    expect(found.name).toBe("Acme Workspace");
    expect(found.root).toBe(path.resolve(ws));
    expect(found.file).toBe(path.join(path.resolve(ws), "CLAUDE.md"));
    expect(found.repos.map((r) => r.name)).toEqual(["alpha", "beta"]);
    expect(found.repos[0]).toEqual({ name: "alpha", path: path.resolve(alpha), rel: "./alpha", description: "Shared library used by beta.", techStack: "TypeScript" });
    expect(found.repos[1]).toEqual({ name: "beta", path: path.resolve(beta), rel: "./beta", description: "", techStack: "" });
    expect(found.skipped.map((s) => [s.name, s.reason])).toEqual([
      ["gamma", "path does not exist"],
      ["delta", "not a git repository"],
      ["epsilon", "no **Path** line"],
    ]);
  });

  it("discoverWorkspace returns null without a CLAUDE.md or without a ## Repos section", () => {
    const empty = mkdtempSync(path.join(os.tmpdir(), "reggie-ws-empty-"));
    try {
      expect(discoverWorkspace(empty)).toBeNull();
      write(empty, "CLAUDE.md", "# Just a repo\n\n## Overview\nNo repos section.\n");
      expect(discoverWorkspace(empty)).toBeNull();
    } finally {
      rmSync(empty, { recursive: true, force: true });
    }
  });

  it("autoDetectWorkspace finds the parent workspace that names the repo, and nothing otherwise", () => {
    const detected = autoDetectWorkspace(alpha);
    expect(detected?.name).toBe("Acme Workspace");
    expect(detected?.repos.map((r) => r.name)).toEqual(["alpha", "beta"]);
    // delta is listed but skipped (not a git repo), so it is not part of the workspace.
    expect(autoDetectWorkspace(path.join(ws, "delta"))).toBeNull();

    const lone = makeTempRepo("reggie-lone-");
    try {
      expect(autoDetectWorkspace(lone.root)).toBeNull();
    } finally {
      lone.cleanup();
    }
    const stranger = mkdtempSync(path.join(os.tmpdir(), "reggie-ws-stranger-"));
    try {
      write(stranger, "CLAUDE.md", "# Other\n\n## Repos\n\n### something-else\n- **Path**: ./something-else\n");
      initRepo(path.join(stranger, "orphan"), null);
      expect(autoDetectWorkspace(path.join(stranger, "orphan"))).toBeNull();
    } finally {
      rmSync(stranger, { recursive: true, force: true });
    }
  });

  it("RepoRegistry resolves repos by name and describes the workspace", () => {
    const found = discoverWorkspace(ws);
    expect(found).not.toBeNull();
    if (!found) return;
    const registry = RepoRegistry.fromWorkspace(found);
    expect(registry.single).toBe(false);
    expect(registry.names()).toEqual(["alpha", "beta"]);
    expect(registry.first().name).toBe("alpha");
    expect(registry.resolve(undefined)?.name).toBe("alpha");
    expect(registry.resolve("")?.name).toBe("alpha");
    expect(registry.resolve("beta")?.root).toBe(path.resolve(beta));
    expect(registry.resolve("nope")).toBeUndefined();
    expect(registry.get("alpha")?.paths.root).toBe(path.resolve(alpha));
    expect(registry.get("alpha")?.config.mode).toBe("solo");
    expect(registry.get("alpha")?.description).toBe("Shared library used by beta.");
    expect(registry.info()).toEqual({ name: "Acme Workspace", repos: ["alpha", "beta"] });

    const single = RepoRegistry.single(alpha);
    expect(single.single).toBe(true);
    expect(single.names()).toEqual(["@acme/alpha"]);
    expect(single.info()).toBeNull();
  });

  it("cached values are rebuilt when HEAD moves or the TTL expires", () => {
    const scratch = makeTempRepo("reggie-cache-");
    try {
      const registry = RepoRegistry.single(scratch.root, { shaTtlMs: 0 });
      const ctx = registry.first();
      let builds = 0;
      const build = () => {
        builds += 1;
        return { n: builds };
      };
      expect(ctx.cached("thing", build)).toEqual({ n: 1 });
      expect(ctx.cached("thing", build)).toEqual({ n: 1 });
      expect(builds).toBe(1);

      scratch.write("a.txt", "a\n");
      scratch.commitAll("move HEAD");
      expect(ctx.cached("thing", build)).toEqual({ n: 2 });
      expect(builds).toBe(2);

      // A TTL of zero always expires; sha:false ignores commits.
      expect(ctx.cached("thing", build, { ttlMs: 0 })).toEqual({ n: 3 });
      expect(ctx.cached("thing", build, { ttlMs: 60_000 })).toEqual({ n: 3 });
      expect(ctx.cached("other", build, { sha: false })).toEqual({ n: 4 });
      scratch.write("b.txt", "b\n");
      scratch.commitAll("move HEAD again");
      expect(ctx.cached("other", build, { sha: false })).toEqual({ n: 4 });
      expect(ctx.cached("thing", build)).toEqual({ n: 5 });

      ctx.invalidate("thing");
      expect(ctx.cached("thing", build)).toEqual({ n: 6 });
      ctx.invalidate();
      expect(ctx.cached("other", build, { sha: false })).toEqual({ n: 7 });
      expect(ctx.headSha()).toMatch(/^[0-9a-f]{40}$/);
    } finally {
      scratch.cleanup();
    }
  });

  it("codeInventory counts programming-language files only and flags tests", () => {
    const inv = codeInventory(alpha);
    expect(inv.files.map((f) => f.path).sort()).toEqual(["src/index.test.ts", "src/index.ts", "src/old.ts", "src/util.ts"]);
    expect(inv.files.find((f) => f.path === "src/index.test.ts")?.test).toBe(true);
    expect(inv.files.find((f) => f.path === "src/index.ts")?.test).toBe(false);
    expect(inv.languages).toEqual([{ language: "TypeScript", files: 4 }]);
    const betaInv = codeInventory(beta);
    expect(betaInv.languages).toEqual([
      { language: "Rust", files: 1 },
      { language: "TypeScript", files: 1 },
    ]);
  });

  it("knowledgeCoverage counts own, inherited and stale notes over source files", () => {
    const paths = repoPaths(alpha);
    const notes = allNoteFiles(paths);
    const inv = codeInventory(alpha);
    expect(knowledgeCoverage(paths, inv.files, notes)).toEqual({ source: 3, noted: 2, inherited: 1, stale: 1 });

    // A repo note only counts as inherited coverage when asked for.
    addNote(paths, "_repo", { type: "how", text: "The whole repo.", author: "tester" });
    const withRepo = allNoteFiles(paths);
    write(alpha, "lib/extra.ts", "export const four = 4;\n");
    const files = codeInventory(alpha).files;
    expect(knowledgeCoverage(paths, files, withRepo)).toMatchObject({ source: 4, noted: 2, inherited: 1 });
    expect(knowledgeCoverage(paths, files, withRepo, { repoNoteInherits: true })).toMatchObject({ source: 4, noted: 2, inherited: 2 });
    rmSync(path.join(alpha, "lib"), { recursive: true, force: true });
    rmSync(path.join(alpha, ".reggie/notes/_repo.md"), { force: true });
  });

  it("workspaceSummary matches the /api/workspace contract", () => {
    const found = discoverWorkspace(ws);
    expect(found).not.toBeNull();
    if (!found) return;
    const registry = RepoRegistry.fromWorkspace(found, { shaTtlMs: 0 });
    const summary = workspaceSummary(registry);

    expect(summary.name).toBe("Acme Workspace");
    expect(summary.root).toBe(path.resolve(ws));
    expect(summary.single).toBe(false);
    expect(summary.repos.map((r) => r.name)).toEqual(["alpha", "beta"]);

    const a = summary.repos[0];
    expect(a).toBeDefined();
    if (!a) return;
    expect(a.path).toBe(path.resolve(alpha));
    expect(a.description).toBe("Shared library used by beta.");
    expect(a.primaryLanguage).toBe("TypeScript");
    expect(a.codeFiles).toBe(4);
    expect(a.branch).toBe("main");
    expect(a.taskCounts).toEqual({ ungroomed: 1, groomed: 0, planned: 0, "in-process": 0, "awaiting-decision": 0, done: 0 });
    expect(a.knowledge).toEqual({ source: 3, noted: 2, inherited: 1, stale: 1 });
    expect(a.lastJournal?.text).toBe("Shipped the parser. Next up: the summary.");
    expect(a.lastJournal?.person).toBe("tester");
    expect(a.entryPoints).toEqual(expect.arrayContaining(["dist/index.js", "src/index.ts"]));
    expect(a.needsYou).toEqual([]);

    const b = summary.repos[1];
    expect(b).toBeDefined();
    if (!b) return;
    expect(b.description).toBe("The beta app");
    expect(b.primaryLanguage).toBe("Rust");
    expect(b.codeFiles).toBe(2);
    expect(b.taskCounts.ungroomed).toBe(0);
    expect(b.knowledge).toEqual({ source: 2, noted: 0, inherited: 0, stale: 0 });
    expect(b.lastJournal).toBeNull();

    expect(summary.edges).toEqual([
      { source: "beta", target: "alpha", kind: "depends-on", via: "@acme/alpha" },
      { source: "alpha", target: "beta", kind: "same-org", via: "Acme" },
    ]);

    // The summary is served from the caches on the second call.
    const again = workspaceSummary(registry);
    expect(again.repos[0]?.knowledge).toBe(a.knowledge);
  });

  it("single-repo mode has one repo and no edges", () => {
    const summary = workspaceSummary(RepoRegistry.single(beta));
    expect(summary.single).toBe(true);
    expect(summary.name).toBe("beta");
    expect(summary.root).toBe(path.resolve(beta));
    expect(summary.repos).toHaveLength(1);
    expect(summary.edges).toEqual([]);
    expect(workspaceEdges(RepoRegistry.single(beta))).toEqual([]);
  });

  it("an empty registry summarizes to nothing", () => {
    const summary = workspaceSummary(new RepoRegistry([]));
    expect(summary).toEqual({ name: "", root: "", single: true, repos: [], edges: [] });
  });
});

describe("manifests and remotes", () => {
  it("parseCargoToml reads names, dependencies (with renames and tables) and workspace members", () => {
    const info = parseCargoToml([
      "[package]",
      'name = "forge-reggie"',
      'version = "0.1.0" # trailing comment',
      "",
      "[lib]",
      'name = "reggie_lib"',
      "",
      "[workspace]",
      "members = [",
      '  "crates/core",',
      '  "crates/cli",',
      "]",
      "",
      "[dependencies]",
      'serde = "1"',
      'tokio = { version = "1", features = ["full"] }',
      'pty = { package = "portable-pty", version = "0.8" }',
      "",
      "[dependencies.reggie-core]",
      'path = "../reggie-core"',
      "",
      "[dependencies.alias]",
      'package = "real-crate"',
      "",
      "[dev-dependencies]",
      'tempfile = "3"',
    ].join("\n"));
    expect(info.packageName).toBe("forge-reggie");
    expect(info.libName).toBe("reggie_lib");
    expect(info.members).toEqual(["crates/core", "crates/cli"]);
    expect(info.dependencies.sort()).toEqual(["portable-pty", "real-crate", "reggie-core", "serde", "tokio"]);
  });

  it("manifestInfo joins the root manifests with one level of workspace members", () => {
    const mono = mkdtempSync(path.join(os.tmpdir(), "reggie-mono-"));
    try {
      write(mono, "package.json", JSON.stringify({ name: "mono-root", workspaces: ["packages/*"], devDependencies: { typescript: "^5" } }));
      write(mono, "packages/a/package.json", JSON.stringify({ name: "@mono/a", dependencies: { "@acme/alpha": "^1" } }));
      write(mono, "packages/b/package.json", "{ not json");
      write(mono, "Cargo.toml", '[workspace]\nmembers = ["crates/core"]\n');
      write(mono, "crates/core/Cargo.toml", '[package]\nname = "mono-core"\n\n[dependencies]\nserde = "1"\n');
      const info = manifestInfo(mono);
      expect(info.provides.sort()).toEqual(["@mono/a", "mono-core", "mono-root"]);
      expect(info.dependsOn.sort()).toEqual(["@acme/alpha", "serde", "typescript"]);
    } finally {
      rmSync(mono, { recursive: true, force: true });
    }
  });

  it("parseRemoteUrl handles scp, ssh and https forms", () => {
    expect(parseRemoteUrl("git@github.com:The-Banana-Standard/reggie.git")).toEqual({ host: "github.com", org: "The-Banana-Standard", repo: "reggie" });
    expect(parseRemoteUrl("ssh://git@github.com/acme/beta.git")).toEqual({ host: "github.com", org: "acme", repo: "beta" });
    expect(parseRemoteUrl("https://github.com/acme/beta.git\n")).toEqual({ host: "github.com", org: "acme", repo: "beta" });
    expect(parseRemoteUrl("https://user@GitHub.com/acme/beta/")).toEqual({ host: "github.com", org: "acme", repo: "beta" });
    expect(parseRemoteUrl("https://gitlab.com/group/sub/project.git")).toEqual({ host: "gitlab.com", org: "sub", repo: "project" });
    expect(parseRemoteUrl("")).toBeNull();
    expect(parseRemoteUrl("https://github.com/only-one")).toBeNull();
    expect(parseRemoteUrl("/local/path/repo.git")).toBeNull();
    expect(parseRemoteUrl("C:\\repos\\thing")).toBeNull();
  });
});

describe("taskAge", () => {
  const base: TaskInfo = {
    slug: "x",
    title: "X",
    state: "ungroomed",
    risk: "unset",
    owner: null,
    ownerEmail: null,
    lastActivity: null,
    branch: null,
    pr: null,
    planExists: false,
    planOnDefault: false,
    planLintOk: null,
    packetExists: false,
    intake: null,
    reason: "",
  };
  const now = Date.parse("2026-09-07T12:00:00Z");

  it("uses lastActivity, then the intake date, else null", () => {
    expect(taskAge({ ...base, lastActivity: "2026-09-04T09:00:00+00:00" }, now)).toBe(3);
    expect(taskAge({ ...base, lastActivity: "2026-09-07T11:00:00Z" }, now)).toBe(0);
    expect(taskAge({ ...base, intake: { slug: "x", rawSlug: "x", text: "X", meta: "tester, cli, 2026-09-01", detail: [], line: 3 } }, now)).toBe(6);
    expect(taskAge(base, now)).toBeNull();
    expect(taskAge({ ...base, lastActivity: "not a date" }, now)).toBeNull();
  });
});
