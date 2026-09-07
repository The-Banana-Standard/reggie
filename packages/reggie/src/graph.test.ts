import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { fullPlan, makeTempRepo, type TempRepo } from "../test/helpers.js";
import { BOUNDARY_DETECTORS, buildGraph, dirKey, expandUseTree, findCycles, flatGraph, jsImports, tarjan, type RepoGraph } from "./graph.js";
import { clearHistoryCache, repoHistory } from "./history.js";
import { ensureLayout } from "./layout.js";
import { addNote, notesIndex } from "./notes.js";
import { planFile, repoPaths } from "./paths.js";
import { writeText } from "./util.js";

describe("repo graph", () => {
  let repo: TempRepo;
  beforeEach(() => {
    repo = makeTempRepo();
    repo.write("src/index.ts", 'import { login } from "./auth/login.js";\nimport util from "@/lib/util";\nexport { login, util };\n');
    repo.write("src/auth/login.ts", 'import { retry } from "../lib/util";\nexport const login = () => retry();\n');
    repo.write("src/lib/util.ts", "export const retry = () => 1;\nexport default retry;\n");
    repo.write("src/lib/index.ts", 'export * from "./util";\n');
    repo.write("src/orphan.ts", 'import "./missing";\n');
    repo.write("Cargo.toml", "[package]\nname = \"x\"\n");
    repo.write("src/main.rs", "mod commands;\nuse crate::commands::git::run;\nfn main() { run(); }\n");
    repo.write("src/commands/mod.rs", "pub mod git;\n");
    repo.write("src/commands/git.rs", "pub fn run() {}\n");
    repo.commitAll("code");
    const paths = repoPaths(repo.root);
    ensureLayout(paths);
    addNote(paths, "src/auth/login.ts", { type: "gotcha", text: "Client-side cap.", author: "test" });
    addNote(paths, "src/lib/", { type: "how", text: "Shared helpers.", author: "test" });
    writeText(planFile(paths, "cap-retries"), fullPlan("cap-retries", ["src/auth/login.ts", "src/lib/util.ts"]));
  });
  afterEach(() => repo.cleanup());

  it("resolves TypeScript and Rust edges and overlays notes and tasks", () => {
    const g = buildGraph(repoPaths(repo.root));
    const edge = (s: string, t: string) => g.edges.some((e) => e.source === s && e.target === t);
    expect(edge("src/index.ts", "src/auth/login.ts")).toBe(true);
    expect(edge("src/index.ts", "src/lib/util.ts")).toBe(true);
    expect(edge("src/auth/login.ts", "src/lib/util.ts")).toBe(true);
    expect(edge("src/lib/index.ts", "src/lib/util.ts")).toBe(true);
    expect(edge("src/main.rs", "src/commands/mod.rs")).toBe(true);
    expect(edge("src/commands/mod.rs", "src/commands/git.rs")).toBe(true);
    expect(edge("src/main.rs", "src/commands/git.rs")).toBe(true);
    expect(g.unresolved).toBe(1);

    const login = g.nodes.find((n) => n.id === "src/auth/login.ts");
    expect(login?.noteCount).toBe(1);
    expect(login?.tasks).toEqual(["cap-retries"]);
    const util = g.nodes.find((n) => n.id === "src/lib/util.ts");
    expect(util?.dirNoteCount).toBe(1);
    expect(util?.inDegree).toBe(4);
    expect(g.nodes.some((n) => n.id === "task:cap-retries" && n.kind === "task")).toBe(true);
    expect(edge("task:cap-retries", "src/lib/util.ts")).toBe(true);
    expect(dirKey("src/auth/login.ts")).toBe("src/auth/");
    expect(dirKey("main.rs")).toBe("(root)");
  });
});

describe("graph §6.1: hierarchy, roles, boundaries, knowledge, tasks, cycles", () => {
  let repo: TempRepo;
  let g: RepoGraph;
  const slug = "cap-retries";
  const node = (id: string) => {
    const n = g.nodes.find((x) => x.id === id);
    if (!n) throw new Error(`missing node ${id}: ${g.nodes.map((x) => x.id).join(", ")}`);
    return n;
  };
  const edge = (s: string, t: string) => g.edges.find((e) => e.source === s && e.target === t);

  beforeEach(() => {
    clearHistoryCache();
    repo = makeTempRepo();
    repo.write("package.json", '{ "name": "fixture", "version": "1.0.0", "type": "module" }\n');
    repo.write("src/index.ts", 'import { login } from "./auth/login.js";\nimport type { Session } from "./auth/session.js";\nexport { login };\nexport type { Session };\n');
    repo.write("src/auth/login.ts", 'import { retry } from "../lib/util.js";\nimport type { Session } from "./session.js";\nimport { Session as S } from "./session.js";\nexport const login = (): Session => S(retry());\n');
    repo.write("src/auth/session.ts", "export interface Session { id: number }\nexport const Session = (id: number): Session => ({ id });\n");
    repo.write("src/lib/util.ts", "export const retry = () => 1;\n");
    repo.write("src/lib/util.test.ts", 'import { retry } from "./util.js";\nimport { helper } from "../../test/helpers.js";\nretry(); helper();\nconst fake = { command: (_n: string) => fake };\nfake.command("not-an-entry");\nswitch ("/api/x") { case "/api/fixture": break; }\n');
    repo.write("test/helpers.ts", 'import { retry } from "../src/lib/util.js";\nexport const helper = () => retry();\n');
    repo.write("src/ipc.ts", 'import { invoke } from "@tauri-apps/api/core";\nexport const widgets = () => invoke<string[]>("list_widgets");\nexport const missing = () => invoke("no_such_command");\n');
    repo.write("src/cli.ts", 'const program = { command: (_n: string) => program, registerTool: (_n: string) => program };\nprogram.command("onboard").command("serve").command("onboard");\nprogram.registerTool(\n  "reggie_status",\n);\nexport function route(p: string) {\n  switch (p) {\n    case "/api/graph":\n      return 1;\n    case "/api/tasks":\n      return 2;\n  }\n  return 0;\n}\n');
    repo.write("src/cyc/a.ts", 'import { b } from "./b.js";\nexport const a = () => b();\n');
    repo.write("src/cyc/b.ts", 'import { a } from "./a.js";\nexport const b = () => a();\n');
    repo.write("native/Cargo.toml", '[package]\nname = "native-lib"\nversion = "0.1.0"\n\n[lib]\nname = "native_lib"\npath = "src/lib.rs"\n');
    repo.write("native/src/main.rs", "mod commands;\nuse native_lib::run;\n\nfn main() {\n    run();\n    native_lib::shutdown();\n}\n");
    repo.write("native/src/lib.rs", "pub mod commands;\npub fn run() {}\npub fn shutdown() {}\n");
    repo.write("native/src/commands/mod.rs", "pub mod widgets;\npub mod other;\n");
    repo.write("native/src/commands/widgets.rs", "use crate::commands::other::{Widget, count as n};\n\n#[tauri::command]\npub fn list_widgets() -> Vec<Widget> {\n    vec![]\n}\n\n#[tauri::command(rename_all = \"snake_case\")]\n#[allow(dead_code)]\nasync fn count_widgets() -> usize { n() }\n");
    repo.write("native/src/commands/other.rs", "pub struct Widget;\npub fn count() -> usize { 0 }\n");
    repo.commitAll("code");

    const paths = repoPaths(repo.root);
    ensureLayout(paths);
    addNote(paths, "_repo", { type: "how", text: "Run npm test.", author: "test", confidence: "high" });
    addNote(paths, "src/auth/login.ts", { type: "gotcha", text: "Client-side cap.", author: "test", confidence: "low" });
    addNote(paths, "src/auth/login.ts", { type: "why", text: "Server floods otherwise.", author: "test", confidence: "high", date: "2026-01-02" });
    // Dated before the code commit, so it reads as stale.
    addNote(paths, "src/lib/", { type: "how", text: "Shared helpers.", author: "test", date: "2020-01-01" });
    addNote(paths, "store:widgets", { type: "data-source", text: "Widgets come over IPC.", author: "test", sources: ["src/ipc.ts", "src/lib/", "src/auth/login.ts:1", "docs/nothing.md"] });
    writeText(planFile(paths, slug), fullPlan(slug, ["src/auth/login.ts", "src/lib/", "README.md"]));
    g = buildGraph(paths);
  });
  afterEach(() => repo.cleanup());

  it("builds repo and dir nodes for every directory on a code path, with parent links, manifests and labels", () => {
    const repoNode = node("repo:fixture");
    expect(repoNode.kind).toBe("repo");
    expect(repoNode.parent).toBeNull();
    expect(repoNode.manifest).toBe("package.json");
    const rootDir = node("dir:./");
    expect(rootDir.parent).toBe("repo:fixture");
    expect(rootDir.label).toBe("fixture");
    expect(rootDir.manifest).toBe("package.json");
    expect(node("dir:src/").parent).toBe("dir:./");
    expect(node("dir:src/auth/").parent).toBe("dir:src/");
    expect(node("dir:src/auth/").label).toBe("auth");
    expect(node("dir:native/src/commands/").parent).toBe("dir:native/src/");
    const native = node("dir:native/");
    expect(native.manifest).toBe("Cargo.toml");
    expect(native.label).toBe("native_lib");
    expect(node("dir:src/").manifest).toBeNull();
    expect(node("src/auth/login.ts").parent).toBe("dir:src/auth/");
    expect(node("src/auth/login.ts").path).toBe("src/auth/login.ts");
    expect(node("dir:src/auth/").path).toBe("src/auth/");
    expect(g.nodes.some((n) => n.id === "dir:docs/")).toBe(false);
  });

  it("assigns areas: nearest manifest directory, else the top-level directory", () => {
    expect(node("src/auth/login.ts").area).toBe("dir:src/");
    expect(node("dir:src/auth/").area).toBe("dir:src/");
    expect(node("native/src/commands/widgets.rs").area).toBe("dir:native/");
    expect(node("dir:native/src/").area).toBe("dir:native/");
    expect(node("dir:./").area).toBeNull();
    expect(node("repo:fixture").area).toBeNull();
  });

  it("classifies roles and retypes imports from tests and fixtures as tests edges with testedBy", () => {
    expect(node("src/index.ts").role).toBe("source");
    expect(node("src/lib/util.test.ts").role).toBe("test");
    expect(node("test/helpers.ts").role).toBe("fixture");
    expect(edge("src/lib/util.test.ts", "src/lib/util.ts")?.kind).toBe("tests");
    expect(edge("test/helpers.ts", "src/lib/util.ts")?.kind).toBe("tests");
    expect(edge("src/lib/util.test.ts", "test/helpers.ts")?.kind).toBe("tests");
    expect(edge("src/auth/login.ts", "src/lib/util.ts")?.kind).toBe("import");
    expect(node("src/lib/util.ts").testedBy).toEqual(["src/lib/util.test.ts"]);
    expect(node("src/auth/login.ts").testedBy).toEqual([]);
  });

  it("carries named imports on edges and marks type-only edges", () => {
    const toLogin = edge("src/index.ts", "src/auth/login.ts");
    expect(toLogin?.names).toEqual(["login"]);
    expect(toLogin?.isType).toBeUndefined();
    const typeOnly = edge("src/index.ts", "src/auth/session.ts");
    expect(typeOnly?.names).toEqual(["Session"]);
    expect(typeOnly?.isType).toBe(true);
    // Two statements, one of them `import type`: merged names, not type-only.
    const mixed = edge("src/auth/login.ts", "src/auth/session.ts");
    expect(mixed?.names?.sort()).toEqual(["S", "Session"]);
    expect(mixed?.isType).toBeUndefined();
    expect(edge("native/src/commands/widgets.rs", "native/src/commands/other.rs")?.names?.sort()).toEqual(["Widget", "count"]);
    expect(edge("native/src/lib.rs", "native/src/commands/mod.rs")?.names).toEqual(["commands"]);
  });

  it("links invoke(\"x\") to the file defining #[tauri::command] fn x and resolves the lib crate", () => {
    const ipc = edge("src/ipc.ts", "native/src/commands/widgets.rs");
    expect(ipc?.kind).toBe("ipc");
    expect(ipc?.names).toEqual(["list_widgets"]);
    expect(ipc?.confidence).toBe("exact");
    expect(g.edges.filter((e) => e.source === "src/ipc.ts" && e.kind === "ipc")).toHaveLength(1);
    const lib = edge("native/src/main.rs", "native/src/lib.rs");
    expect(lib?.kind).toBe("import");
    expect(lib?.names?.sort()).toEqual(["run", "shutdown"]);
    expect(node("native/src/main.rs").outDegree).toBe(2);
  });

  it("marks entry points from facts and the boundary detectors", () => {
    const index = node("src/index.ts");
    expect(index.entry).toBe(true);
    expect(index.entryKinds).toEqual([{ kind: "main", count: 1 }]);
    const cli = node("src/cli.ts");
    expect(cli.entry).toBe(true);
    expect(cli.entryKinds).toContainEqual({ kind: "main", count: 1 });
    expect(cli.entryKinds).toContainEqual({ kind: "cli", count: 2 });
    expect(cli.entryKinds).toContainEqual({ kind: "mcp", count: 1 });
    expect(cli.entryKinds).toContainEqual({ kind: "http", count: 2 });
    expect(node("native/src/commands/widgets.rs").entryKinds).toEqual([{ kind: "ipc-server", count: 2 }]);
    expect(node("src/lib/util.ts").entry).toBe(false);
    expect(node("src/lib/util.ts").entryKinds).toEqual([]);
    // Fixture strings inside a test file are not commands or routes.
    expect(node("src/lib/util.test.ts").entry).toBe(false);
    expect(node("src/lib/util.test.ts").entryKinds).toEqual([]);
    // Route detection is `case "/api/x"` only, not any string comparison.
    expect(BOUNDARY_DETECTORS.find((d) => d.id === "http-route")?.regex.test('if (url === "/api/graph") {}')).toBe(false);
  });

  it("joins notes: own, inherited, stale, byType, dates and confidence", () => {
    const login = node("src/auth/login.ts");
    expect(login.knowledge.own).toBe(2);
    expect(login.knowledge.inherited).toBe(1);
    // The entry dated 2026-01-02 predates the commit that wrote the file; today's entry does not.
    expect(login.knowledge.stale).toBe(1);
    expect(login.knowledge.byType.gotcha).toBe(1);
    expect(login.knowledge.byType.why).toBe(1);
    expect(login.knowledge.byType.how).toBe(0);
    expect(login.knowledge.lowestConfidence).toBe("low");
    expect(login.knowledge.lastNoteDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(login.knowledge.lastNoteDate! > "2026-01-02").toBe(true);
    expect(login.noteCount).toBe(2);

    const util = node("src/lib/util.ts");
    expect(util.knowledge.own).toBe(0);
    expect(util.knowledge.inherited).toBe(2);
    expect(util.knowledge.lastNoteDate).toBeNull();
    expect(util.knowledge.lowestConfidence).toBeNull();
    expect(util.dirNoteCount).toBe(1);

    const lib = node("dir:src/lib/");
    expect(lib.knowledge.own).toBe(1);
    expect(lib.knowledge.inherited).toBe(1);
    expect(lib.knowledge.stale).toBe(1);
    expect(lib.knowledge.lastNoteDate).toBe("2020-01-01");

    const rootDir = node("dir:./");
    expect(rootDir.knowledge.own).toBe(1);
    expect(rootDir.knowledge.inherited).toBe(0);
    expect(node("repo:fixture").knowledge.own).toBe(1);
    expect(node("src/cyc/a.ts").knowledge).toMatchObject({ own: 0, inherited: 1, stale: 0 });
    expect(node("src/auth/session.ts").knowledge.stale).toBe(0);
  });

  it("turns entity notes into nodes with annotates edges to the files and folders they cite", () => {
    const entity = node("entity:store:widgets");
    expect(entity.kind).toBe("entity");
    expect(entity.label).toBe("widgets");
    expect(entity.knowledge.own).toBe(1);
    expect(entity.knowledge.byType["data-source"]).toBe(1);
    const targets = g.edges.filter((e) => e.source === entity.id && e.kind === "annotates").map((e) => e.target).sort();
    expect(targets).toEqual(["dir:src/lib/", "src/auth/login.ts", "src/ipc.ts"]);
    // Annotations do not count towards fan-in.
    expect(node("src/ipc.ts").inDegree).toBe(0);
  });

  it("builds task nodes with state, risk, owner and age, and touches edges that target dir nodes for folders", () => {
    const task = node(`task:${slug}`);
    expect(task.kind).toBe("task");
    expect(task.label).toBe("Cap login retries on web");
    expect(task.state).toBe("groomed");
    expect(task.risk).toBe("low");
    expect(task.owner).toBe("test");
    expect(typeof task.age === "number" || task.age === null).toBe(true);
    expect(edge(task.id, "src/auth/login.ts")?.kind).toBe("touches");
    expect(edge(task.id, "dir:src/lib/")?.kind).toBe("touches");
    expect(edge(task.id, "src/lib/util.ts")).toBeUndefined();
    expect(edge(task.id, "README.md")).toBeUndefined();
    expect(node("dir:src/lib/").tasks).toEqual([slug]);
    expect(node("src/lib/util.ts").tasks).toEqual([]);
    expect(node("src/auth/login.ts").tasks).toEqual([slug]);
    expect(node("dir:src/").aggregates?.tasks).toEqual([slug]);
    expect(node("dir:src/auth/").aggregates?.tasks).toEqual([slug]);
    expect(node("dir:native/").aggregates?.tasks).toEqual([]);
    expect(node("repo:fixture").aggregates?.tasks).toEqual([slug]);
  });

  it("aggregates directories in one post-order pass", () => {
    const lib = node("dir:src/lib/").aggregates;
    expect(lib).toMatchObject({ files: 2, source: 1, tests: 1, config: 0, documented: 1, testedSource: 1, stale: 1 });
    expect(lib?.lines).toBe(node("src/lib/util.ts").lines + node("src/lib/util.test.ts").lines);
    const src = node("dir:src/").aggregates;
    expect(src?.files).toBe(9);
    expect(src?.tests).toBe(1);
    expect(src?.source).toBe(8);
    expect(src?.documented).toBe(8);
    // One stale entry on the src/lib/ folder note, one on the login.ts file note.
    expect(src?.stale).toBe(2);
    expect(node("dir:src/auth/").aggregates?.stale).toBe(1);
    expect(node("dir:src/").lang).toBe("TypeScript");
    expect(node("dir:native/").lang).toBe("Rust");
    const root = node("dir:./").aggregates;
    expect(root?.files).toBe(15);
    expect(root?.tests).toBe(2);
    expect(root?.stale).toBe(2);
    expect(node("test/helpers.ts").role).toBe("fixture");
    expect(node("repo:fixture").aggregates).toEqual(root);
    expect(node("repo:fixture").lines).toBe(root?.lines);
    expect(node("dir:native/").aggregates?.documented).toBe(5);
  });

  it("attaches git history to files and directory aggregates", () => {
    expect(node("src/index.ts").history?.commits365).toBe(1);
    expect(node("src/index.ts").history?.authors[0]?.name).toBe("Test Person");
    expect(node("dir:src/").aggregates?.history?.commits365).toBe(1);
    expect(node("dir:./").aggregates?.history?.commits365).toBeGreaterThanOrEqual(2);
    expect(node("repo:fixture").aggregates?.history?.commits365).toBeGreaterThanOrEqual(2);
    expect(node("entity:store:widgets").history).toBeUndefined();
  });

  it("reports file-level cycles and flags the edges in them", () => {
    expect(g.cycles).toEqual([["src/cyc/a.ts", "src/cyc/b.ts"]]);
    expect(edge("src/cyc/a.ts", "src/cyc/b.ts")?.cycle).toBe(true);
    expect(edge("src/cyc/b.ts", "src/cyc/a.ts")?.cycle).toBe(true);
    expect(edge("src/index.ts", "src/auth/login.ts")?.cycle).toBeUndefined();
  });

  it("keeps the flat compatibility payload", () => {
    expect(g.totalCodeFiles).toBe(15);
    expect(g.included).toBe(15);
    expect(g.truncated).toBe(false);
    expect(g.languages).toEqual(["Rust", "TypeScript", "task"]);
    expect(g.dirs).toContain("src/auth/");
    expect(g.dirs).toContain("(tasks)");
    const flat = flatGraph(g);
    expect(flat.nodes.every((n) => n.kind === "file" || n.kind === "task")).toBe(true);
    expect(flat.nodes).toHaveLength(16);
    expect(flat.edges.every((e) => !e.source.startsWith("dir:") && !e.target.startsWith("dir:") && !e.source.startsWith("entity:"))).toBe(true);
    expect(flat.edges.some((e) => e.kind === "touches")).toBe(true);
    expect(flat).toMatchObject({ totalCodeFiles: 15, included: 15, truncated: false, unresolved: 0 });
    const ids = new Set(flat.nodes.map((n) => n.id));
    expect(flat.edges.every((e) => ids.has(e.source) && ids.has(e.target))).toBe(true);
  });

  it("reuses a shared history index, notes index and task list when given", () => {
    const paths = repoPaths(repo.root);
    const again = buildGraph(paths, { history: repoHistory(paths.root), notes: notesIndex(paths) });
    expect(again.nodes.map((n) => n.id)).toEqual(g.nodes.map((n) => n.id));
    expect(again.edges.length).toBe(g.edges.length);
    expect(again.nodes.find((n) => n.id === "dir:src/lib/")?.knowledge.stale).toBe(1);
    const noTasks = buildGraph(paths, { tasks: [] });
    expect(noTasks.nodes.some((n) => n.kind === "task")).toBe(false);
    expect(noTasks.edges.some((e) => e.kind === "touches")).toBe(false);
  });
});

describe("tarjan", () => {
  it("finds strongly connected components, singletons included", () => {
    const sccs = tarjan(
      ["a", "b", "c", "d", "e"],
      [
        { source: "a", target: "b" },
        { source: "b", target: "c" },
        { source: "c", target: "a" },
        { source: "c", target: "d" },
        { source: "d", target: "e" },
        { source: "e", target: "d" },
        { source: "e", target: "zzz-not-a-node" },
        { source: "a", target: "a" },
      ],
    );
    const sorted = sccs.map((c) => [...c].sort()).sort((x, y) => (x[0] ?? "").localeCompare(y[0] ?? ""));
    expect(sorted).toEqual([["a", "b", "c"], ["d", "e"]]);
    expect(findCycles(["a", "b", "c", "d", "e"], [{ source: "a", target: "b" }])).toEqual([]);
    expect(findCycles(["x", "y"], [{ source: "x", target: "y" }, { source: "y", target: "x" }])).toEqual([["x", "y"]]);
  });

  it("does not overflow on a long chain", () => {
    const ids = Array.from({ length: 20_000 }, (_, i) => `n${i}`);
    const edges = ids.slice(1).map((id, i) => ({ source: `n${i}`, target: id }));
    edges.push({ source: "n19999", target: "n0" });
    const cycles = findCycles(ids, edges);
    expect(cycles).toHaveLength(1);
    expect(cycles[0]).toHaveLength(20_000);
  });
});

describe("import parsing", () => {
  it("reads named, default, namespace, type-only, dynamic and require imports", () => {
    const refs = jsImports(
      [
        'import a, { b, c as d } from "./x.js";',
        'import type { T } from "./t.js";',
        'import * as ns from "../ns";',
        'import "./side-effect";',
        'export * from "./all";',
        'export { e } from "./e";',
        'const p = import("./dyn");',
        'const { f, g: h } = require("./cjs");',
        'const s = "not an import from here";',
      ].join("\n"),
    );
    const by = (spec: string) => refs.find((r) => r.spec === spec);
    expect(by("./x.js")?.names.sort()).toEqual(["b", "d", "default"]);
    expect(by("./t.js")).toEqual({ spec: "./t.js", names: ["T"], isType: true });
    expect(by("../ns")?.names).toEqual(["*"]);
    expect(by("./side-effect")).toEqual({ spec: "./side-effect", names: [], isType: false });
    expect(by("./all")?.names).toEqual(["*"]);
    expect(by("./e")?.names).toEqual(["e"]);
    expect(by("./dyn")?.names).toEqual([]);
    expect(by("./cjs")?.names.sort()).toEqual(["f", "h"]);
    expect(refs.some((r) => r.spec.includes("not an import"))).toBe(false);
  });

  it("expands Rust use trees", () => {
    expect(expandUseTree("a::b::{c, d::{e, f as g}, self}")).toEqual([
      ["a", "b", "c"],
      ["a", "b", "d", "e"],
      ["a", "b", "d", "f"],
      ["a", "b", "self"],
    ]);
    expect(expandUseTree("commands::git::run")).toEqual([["commands", "git", "run"]]);
    expect(expandUseTree("x::*")).toEqual([["x", "*"]]);
  });
});
