import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { makeTempRepo, type TempRepo } from "../test/helpers.js";
import { checkComposedFile, checkGeneratedBlock, composeAgentsMd, curatedSections, END_MARKER, renderGeneratedBlock, replaceBlock, START_MARKER } from "./docs.js";
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

  it("still asks for a hand entry per step, and says what the derive verb adds and what it cannot", () => {
    const paths = repoPaths(repo.root);
    for (const tool of ["claude", "codex"] as const) {
      const line = renderGeneratedBlock(collectFacts(repo.root), loadConfig(paths), tool).split("\n").find((l) => l.includes("journal entry")) ?? "";
      expect(line).toContain("After each step of work, write one plain-English journal entry: `reggie journal add --slug <slug> --stage <stage>");
      expect(line).toContain("`reggie journal derive <slug>` adds the commits and a launched session's closing words, not the reasons");
    }
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

  it("mirrors CLAUDE.md's curated sections into AGENTS.md, because Codex never reads CLAUDE.md", () => {
    onboard(repo.root);
    const paths = repoPaths(repo.root);

    writeText(
      paths.claudeMd,
      (readText(paths.claudeMd) ?? "").replace("## Conventions", "## Conventions\n- never check this branch out in the main clone"),
    );
    refreshDocs(repo.root);

    const agents = readText(paths.agentsMd) ?? "";
    expect(agents).toContain("never check this branch out in the main clone");
    // The rule reaches Codex above the generated block, where a session will actually read it.
    expect(agents.indexOf("never check this branch out")).toBeLessThan(agents.indexOf(START_MARKER));
    // And it no longer merely points at a file Codex does not load.
    expect(agents).not.toContain("Same as CLAUDE.md");
  });

  it("curatedSections takes everything from the first heading to the block, and nothing after", () => {
    const claude = ["# repo", "", "Intro line that is not a rule.", "", "## Gotchas", "- it bites", "", `${START_MARKER}`, "generated", `${END_MARKER}`, ""].join("\n");
    const curated = curatedSections(claude);
    expect(curated).toBe("## Gotchas\n- it bites");
    expect(curated).not.toContain("Intro line");
    expect(curated).not.toContain("generated");
  });

  it("curatedSections returns nothing when CLAUDE.md has no curated headings yet", () => {
    expect(curatedSections(`# repo\n\nIntro.\n\n${START_MARKER}\ngenerated\n${END_MARKER}\n`)).toBe("");
  });

  it("docs check sees AGENTS.md drift even when its generated block is current", () => {
    onboard(repo.root);
    const paths = repoPaths(repo.root);
    const facts = collectFacts(repo.root);
    const config = loadConfig(paths);
    const block = renderGeneratedBlock(facts, config, "codex");
    const expected = composeAgentsMd(facts.name, curatedSections(readText(paths.claudeMd) ?? ""), block);
    expect(checkComposedFile(paths.agentsMd, expected).status).toBe("fresh");

    // Hand-edit the curated half only; the generated block is untouched and still fresh.
    writeText(paths.agentsMd, (readText(paths.agentsMd) ?? "").replace("## Conventions", "## Conventions\n- a rule only Codex was told"));
    expect(checkGeneratedBlock(paths.agentsMd, block).status).toBe("fresh");
    expect(checkComposedFile(paths.agentsMd, expected).status).toBe("stale");
  });
});
