import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { capture } from "./capture.js";
import { buildContext } from "./context.js";
import { briefFile } from "./paths.js";
import { currentPerson } from "./people.js";
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
    // A symbol page is the file level with the file that holds the symbol as the path.
    const file = buildContext(fx.paths, fx.config, { slug: fresh, paths: ["src/types/shape.ts"] });
    const symbol = buildContext(fx.paths, fx.config, { slug: fresh, paths: ["src/types/shape.ts"] });
    expect(symbol).toBe(file);
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
