import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { makeTempRepo, type TempRepo } from "../test/helpers.js";
import { checkGeneratedBlock, END_MARKER, renderGeneratedBlock, replaceBlock, START_MARKER } from "./docs.js";
import { collectFacts } from "./facts.js";
import { onboard, refreshDocs } from "./onboard.js";
import { repoPaths } from "./paths.js";
import { loadConfig } from "./people.js";
import { readText, writeText } from "./util.js";

describe("generated blocks", () => {
  let repo: TempRepo;
  beforeEach(() => {
    repo = makeTempRepo();
    repo.write("package.json", JSON.stringify({ name: "fixture-app", scripts: { test: "vitest run", build: "tsc" }, main: "src/index.ts" }));
    repo.write("src/index.ts", "export {};\n");
    repo.write("src/index.test.ts", "test('x', () => {});\n");
    repo.write(".github/workflows/ci.yml", "name: ci\n");
    repo.commitAll("fixture");
  });
  afterEach(() => repo.cleanup());

  it("appends when no markers exist and replaces when they do", () => {
    const first = replaceBlock("# Title\n\nCurated.\n", `${START_MARKER}\nA\n${END_MARKER}`);
    expect(first).toContain("Curated.");
    expect(first).toContain("\nA\n");
    const second = replaceBlock(first, `${START_MARKER}\nB\n${END_MARKER}`);
    expect(second).toContain("\nB\n");
    expect(second).not.toContain("\nA\n");
    expect(second.indexOf("Curated.")).toBeLessThan(second.indexOf(START_MARKER));
  });

  it("collects facts and renders both blocks", () => {
    const facts = collectFacts(repo.root);
    expect(facts.name).toBe("fixture-app");
    expect(facts.languages[0]?.language).toBe("TypeScript");
    expect(facts.commands.map((c) => c.command)).toContain("npm run test");
    expect(facts.entryPoints).toContain("src/index.ts");
    expect(facts.tests.count).toBe(1);
    expect(facts.ci).toEqual(["ci.yml"]);
    const paths = repoPaths(repo.root);
    const claude = renderGeneratedBlock(facts, loadConfig(paths), "claude");
    const codex = renderGeneratedBlock(facts, loadConfig(paths), "codex");
    expect(claude).toContain(".mcp.json");
    expect(codex).toContain("codex mcp add");
  });

  it("onboard creates files; check reports fresh, then stale after code changes", () => {
    const r = onboard(repo.root);
    const paths = repoPaths(repo.root);
    expect(r.docs.map((d) => d.action)).toEqual(["created", "created"]);
    expect(readText(paths.claudeMd)).toContain(START_MARKER);
    expect(readText(paths.mcpJson)).toContain("\"reggie\"");
    expect(readText(paths.readme)).toContain("what this folder is");
    const fresh = checkGeneratedBlock(paths.claudeMd, renderGeneratedBlock(collectFacts(repo.root), loadConfig(paths), "claude"));
    expect(fresh.status).toBe("fresh");

    repo.write("src/other.rs", "fn main() {}\n");
    repo.commitAll("add rust");
    const stale = checkGeneratedBlock(paths.claudeMd, renderGeneratedBlock(collectFacts(repo.root), loadConfig(paths), "claude"));
    expect(stale.status).toBe("stale");

    const refreshed = refreshDocs(repo.root);
    expect(refreshed.results[0]?.action).toBe("updated");
    const again = checkGeneratedBlock(paths.claudeMd, renderGeneratedBlock(collectFacts(repo.root), loadConfig(paths), "claude"));
    expect(again.status).toBe("fresh");

    writeText(paths.claudeMd, (readText(paths.claudeMd) ?? "").replace("## Conventions", "## Conventions\n- keep functions small"));
    expect(readText(paths.claudeMd)).toContain("keep functions small");
    refreshDocs(repo.root);
    expect(readText(paths.claudeMd)).toContain("keep functions small");
  });
});
