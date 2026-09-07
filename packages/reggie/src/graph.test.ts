import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { fullPlan, makeTempRepo, type TempRepo } from "../test/helpers.js";
import { buildGraph, dirKey } from "./graph.js";
import { ensureLayout } from "./layout.js";
import { addNote } from "./notes.js";
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
