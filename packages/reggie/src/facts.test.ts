import { afterEach, describe, expect, it } from "vitest";
import { collectFacts } from "./facts.js";
import { makeTempRepo, type TempRepo } from "../test/helpers.js";

let repo: TempRepo | null = null;

afterEach(() => {
  repo?.cleanup();
  repo = null;
});

describe("collectFacts entry points", () => {
  it("finds an entry point inside a monorepo package, not just at the repo root", () => {
    repo = makeTempRepo("reggie-facts-mono-");
    repo.write("package.json", JSON.stringify({ name: "thing", private: true }));
    repo.write("packages/tool/package.json", JSON.stringify({ name: "tool", bin: { tool: "dist/cli.js" } }));
    repo.write("packages/tool/src/cli.ts", "export const run = () => 0;\n");
    repo.write("packages/tool/src/util.ts", "export const x = 1;\n");
    repo.commitAll("monorepo");

    const facts = collectFacts(repo.root);

    // The package root is `packages/tool`, so `src/cli.ts` under it is an entry point.
    expect(facts.entryPoints).toContain("packages/tool/src/cli.ts");
    // A sibling that matches no pattern stays out.
    expect(facts.entryPoints).not.toContain("packages/tool/src/util.ts");
  });

  it("still finds a root entry point when there is no nested package", () => {
    repo = makeTempRepo("reggie-facts-flat-");
    repo.write("package.json", JSON.stringify({ name: "flat", private: true }));
    repo.write("src/main.ts", "export const main = () => 0;\n");
    repo.commitAll("flat");

    expect(collectFacts(repo.root).entryPoints).toContain("src/main.ts");
  });

  it("does not treat a path as an entry point just because a parent directory is named like one", () => {
    repo = makeTempRepo("reggie-facts-neg-");
    repo.write("package.json", JSON.stringify({ name: "neg", private: true }));
    // No manifest under `vendor/`, so `vendor/` is not a package root and this must not match.
    repo.write("vendor/src/cli.ts", "export const run = () => 0;\n");
    repo.commitAll("vendored");

    expect(collectFacts(repo.root).entryPoints).not.toContain("vendor/src/cli.ts");
  });

  it("reads the repo name and description from the root manifest", () => {
    repo = makeTempRepo("reggie-facts-name-");
    repo.write("package.json", JSON.stringify({ name: "reggie", description: "a repo manager", private: true }));
    repo.commitAll("named");

    const facts = collectFacts(repo.root);
    expect(facts.name).toBe("reggie");
    expect(facts.description).toBe("a repo manager");
  });
});
