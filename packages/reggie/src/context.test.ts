import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { makeTempRepo } from "../test/helpers.js";
import { capture, resolveCaptureOrigin } from "./capture.js";
import { buildContext } from "./context.js";
import { git } from "./git.js";
import { readKnowledge, saveKnowledge, setKnowledgeRetired } from "./knowledge.js";
import { ensureLayout } from "./layout.js";
import { addNote } from "./notes.js";
import { briefFile, repoPaths } from "./paths.js";
import { currentPerson, parseConfig } from "./people.js";
import { writeText } from "./util.js";
import { makeFixtureRepo, type FixtureRepo } from "../test/fixtures.js";

let fx: FixtureRepo;

beforeAll(() => {
  fx = makeFixtureRepo();
});
afterAll(() => fx.repo.cleanup());

function brief(slug: string): string {
  return [
    "---",
    `slug: ${slug}`,
    "title: Split the big area into two packages",
    "area: src/big",
    "size: medium",
    "risk: low",
    "priority: P2",
    "author: test",
    "created: 2026-09-13",
    "---",
    "# Split the big area into two packages",
    "",
    "## Problem",
    "The big area is one forty-five file chain and nobody can tell where a change lands.",
    "",
    "## Why now",
    "Two agents collided in it last week.",
    "",
    "## Suspected area",
    "- src/big/ because the chain lives there",
    "- src/types/shape.ts because both halves would share it",
    "",
    "## Open questions",
    "- Should the split follow the chain order or the shape importers?",
    "",
    "## Not this",
    "- Renaming the files; that is a separate task.",
    "",
  ].join("\n");
}

describe("buildContext", () => {
  it("puts the brief above the plan block and lists its open questions", () => {
    const slug = fx.slugs.ungroomed;
    writeText(briefFile(fx.paths, slug), brief(slug));
    const pack = buildContext(fx.paths, fx.config, { slug });
    const askAt = pack.indexOf("## What the user is asking for");
    const questionsAt = pack.indexOf("## Open questions still open");
    const planAt = pack.indexOf("## Plan:");
    expect(askAt).toBeGreaterThan(-1);
    expect(questionsAt).toBeGreaterThan(askAt);
    expect(planAt).toBeGreaterThan(questionsAt);
    expect(pack).toContain("nobody can tell where a change lands");
    expect(pack).toContain("Why now: Two agents collided");
    expect(pack).toContain("- Should the split follow the chain order");
    expect(pack).toContain("(P2 · medium · low risk · src/big)");
    expect(pack).toContain("answer them yourself under Assumptions");
  });

  it("reads the brief's suspected paths into the files in scope", () => {
    const pack = buildContext(fx.paths, fx.config, { slug: fx.slugs.ungroomed });
    expect(pack).toContain("## Files in scope");
    expect(pack).toContain("- src/big");
    expect(pack).toContain("- src/types/shape.ts");
  });

  it("still asks for a journal entry after each step, and names the derive verb with what it adds and what it does not", () => {
    const slug = fx.slugs.inProcess;
    const line = buildContext(fx.paths, fx.config, { slug }).split("\n").find((l) => l.includes("journal entry after each step")) ?? "";
    expect(line).toContain("Write one plain-English journal entry after each step");
    expect(line).toContain(`\`reggie journal derive ${slug}\` adds the commits and a launched session's closing words, not the reasons`);
    expect(line).toContain("Capture unrelated problems; do not fix them here.");
    // A pack for paths has no slug to name.
    expect(buildContext(fx.paths, fx.config, { paths: ["src"] })).toContain("`reggie journal derive <slug>`");
  });

  it("says nothing about a brief when there is none", () => {
    const pack = buildContext(fx.paths, fx.config, { slug: fx.slugs.inProcess });
    expect(pack).not.toContain("What the user is asking for");
    expect(pack).toContain("## Plan:");
  });

  it("uses active current understanding and excludes retired text from ordinary context", () => {
    const repo = makeTempRepo("reggie-context-knowledge-");
    try {
      const paths = repoPaths(repo.root);
      ensureLayout(paths);
      repo.write("src/session.ts", "export function session(value) { return value; }\n");
      addNote(paths, "src/session.ts", { type: "how", text: "Legacy session note.", author: "test" });
      repo.commitAll("knowledge context fixture");
      const config = parseConfig("mode: solo\ndefaultBranch: main\n");
      const revision = readKnowledge(paths, "src/session.ts")!.revision;
      const saved = saveKnowledge(paths, config, {
        entity: "src/session.ts",
        expectedRevision: revision,
        current: { summary: "Returns the supplied session value.", parameters: [], fields: [], returns: [], callSites: [] },
        fingerprint: "source-v1",
        actor: "human",
        by: "Test Person",
        codeRevision: git(["rev-parse", "HEAD"], { cwd: repo.root }).stdout.trim(),
        reason: "Add current context.",
      });
      const active = buildContext(paths, config, { paths: ["src/session.ts"] });
      expect(active).toContain("**current understanding**");
      expect(active).toContain("Returns the supplied session value.");
      expect(active).toContain("Legacy session note.");

      setKnowledgeRetired(paths, config, {
        entity: "src/session.ts",
        expectedRevision: saved.records[0]!.revision,
        retired: true,
        supersededBy: null,
        actor: "human",
        by: "Test Person",
        codeRevision: git(["rev-parse", "HEAD"], { cwd: repo.root }).stdout.trim(),
        reason: "The file is no longer part of normal guidance.",
      });
      const retired = buildContext(paths, config, { paths: ["src/session.ts"] });
      expect(retired).not.toContain("Returns the supplied session value.");
      expect(retired).not.toContain("Legacy session note.");
    } finally {
      repo.cleanup();
    }
  });
});

describe("the pack for a fresh slug, by the origin it was captured from", () => {
  let fresh: string;
  beforeAll(() => {
    fresh = capture(fx.paths, { text: "A fresh idea with no brief and no plan", person: currentPerson(fx.repo.root), source: "web" }).slug;
  });

  it("holds the file's own note and the repo note for a file origin", () => {
    const pack = buildContext(fx.paths, fx.config, { slug: fresh, paths: ["src/types/shape.ts"] });
    expect(pack).toContain(`# Context pack for ${fresh}`);
    expect(pack).toContain(`## Plan: none yet for ${fresh}`);
    expect(pack).toContain("A fixture repo that exists so the tests have a small codebase");
    expect(pack).toContain("Shape is the one shared type");
    expect(pack).toContain("## Files in scope\n- src/types/shape.ts\n");
    expect(pack).toContain("## Recent commits touching these files");
    expect(pack).toContain("## Working agreement");
  });

  it("holds the folder's own note for a folder origin, and the same pack for a symbol as for its file", () => {
    const folder = buildContext(fx.paths, fx.config, { slug: fresh, paths: ["src/big"] });
    expect(folder).toContain("The chain must stay in order; a01 is the entry and a45 the leaf.");
    expect(folder).toContain("## Files in scope\n- src/big\n");
    // The tasks whose plans overlap the folder: both fixture plans touch src/big/a01.ts.
    expect(folder).toContain("## Related tasks touching the same files");
    expect(folder).toContain(`- ${fx.slugs.inProcess}`);
    // A symbol page is the file level with the file that holds the symbol as the path: the pack is
    // built from the origin's path field, which a symbol origin carries beside its name.
    const origin = resolveCaptureOrigin(fx.paths, { path: "./src/types/shape.ts", symbol: "emptyShape" });
    expect(origin).toEqual({ kind: "symbol", path: "src/types/shape.ts", symbol: "emptyShape" });
    const file = buildContext(fx.paths, fx.config, { slug: fresh, paths: ["src/types/shape.ts"] });
    const symbol = buildContext(fx.paths, fx.config, { slug: fresh, paths: [origin.path ?? ""] });
    expect(symbol).toBe(file);
    expect(symbol).not.toContain("emptyShape");
  });

  it("holds the repo note and the working agreement and no files in scope for a task origin or none", () => {
    const pack = buildContext(fx.paths, fx.config, { slug: fresh });
    expect(pack).toContain("A fixture repo that exists so the tests have a small codebase");
    expect(pack).toContain("## Working agreement");
    expect(pack).not.toContain("## Files in scope");
    expect(pack).not.toContain("## Recent commits touching these files");
    expect(pack).not.toContain("Shape is the one shared type");
  });

  it("still builds the pack, with that file's commits, for a symbol origin whose file the code map never read", () => {
    const pack = buildContext(fx.paths, fx.config, { slug: fresh, paths: [".reggie/intake.md"] });
    expect(pack).toContain("## Files in scope\n- .reggie/intake.md\n");
    expect(pack).toContain("## Recent commits touching these files");
    expect(pack).toMatch(/- \d{4}-\d{2}-\d{2} [0-9a-f]+ Test Person: intake and plans/);
    expect(pack).not.toMatch(/Test Person: code: big chain/);
  });
});
