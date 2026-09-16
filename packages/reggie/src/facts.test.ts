import { afterEach, describe, expect, it } from "vitest";
import { codeLanguageOf, collectFacts, NON_CODE_LANGUAGES } from "./facts.js";
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

// ---------------------------------------------------------------------------
// codeLanguageOf: the one line between code and not-code
// ---------------------------------------------------------------------------

describe("codeLanguageOf", () => {
  // One file per language the table knows, with the answer this repo's coverage claims depend on.
  // A file is code when a person authored it as part of how the product behaves or looks, and is
  // not code when it describes or configures the product.
  const CASES: [file: string, language: string | null][] = [
    ["src/index.ts", "TypeScript"],
    ["src/App.tsx", "TypeScript"],
    ["src/a.mts", "TypeScript"],
    ["src/a.cts", "TypeScript"],
    ["ui/app.js", "JavaScript"],
    ["ui/App.jsx", "JavaScript"],
    ["ui/a.mjs", "JavaScript"],
    ["ui/a.cjs", "JavaScript"],
    ["src/main.rs", "Rust"],
    ["cmd/main.go", "Go"],
    ["App/App.swift", "Swift"],
    ["app/Main.kt", "Kotlin"],
    ["app/Main.kts", "Kotlin"],
    ["src/Main.java", "Java"],
    ["tools/run.py", "Python"],
    ["lib/thing.rb", "Ruby"],
    ["src/Program.cs", "C#"],
    ["src/main.c", "C"],
    ["src/main.h", "C"],
    ["src/main.cc", "C++"],
    ["src/main.cpp", "C++"],
    ["src/main.hpp", "C++"],
    ["src/View.m", "Objective-C"],
    ["src/View.mm", "Objective-C"],
    // Shell, SQL, markup and stylesheets are code: a person writes them and the product runs them.
    ["scripts/build.sh", "Shell"],
    ["scripts/build.bash", "Shell"],
    ["scripts/build.zsh", "Shell"],
    ["scripts/build.ps1", "PowerShell"],
    ["db/schema.sql", "SQL"],
    ["ui/index.html", "HTML"],
    ["ui/styles.css", "CSS"],
    ["ui/styles.scss", "CSS"],
    // Documentation, configuration and data describe the product; counting them as skipped code
    // would report 96 Markdown files on this repo and teach the reader to ignore the disclaimer.
    ["README.md", null],
    ["docs/spec.mdx", null],
    ["package.json", null],
    ["config.yaml", null],
    ["config.yml", null],
    ["Cargo.toml", null],
    // An extension the table does not know at all is not code either.
    ["reggie-logo.png", null],
    ["LICENSE", null],
  ];

  it.each(CASES)("%s → %s", (file, language) => {
    expect(codeLanguageOf(file)).toBe(language);
  });

  it("names exactly the four languages that describe rather than behave", () => {
    expect([...NON_CODE_LANGUAGES].sort()).toEqual(["JSON", "Markdown", "TOML", "YAML"]);
  });

  it("does not care about case or about the rest of the path", () => {
    expect(codeLanguageOf("A/B/C/Thing.TS")).toBe("TypeScript");
    expect(codeLanguageOf("A/B/C/Thing.MD")).toBeNull();
  });
});
