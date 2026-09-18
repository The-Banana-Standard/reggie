import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildContext } from "./context.js";
import { briefFile } from "./paths.js";
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
