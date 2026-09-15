import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { makeTempRepo, type TempRepo } from "../test/helpers.js";
import { git } from "./git.js";
import { ensureGitattributes, ensureLayout, GITATTRIBUTES_LINES } from "./layout.js";
import { repoPaths } from "./paths.js";

describe(".gitattributes for journal files", () => {
  let repo: TempRepo;
  beforeEach(() => {
    repo = makeTempRepo();
  });
  afterEach(() => repo.cleanup());
  const file = () => path.join(repo.root, ".gitattributes");
  const mergeAttr = (rel: string) => git(["check-attr", "merge", "--", rel], { cwd: repo.root }).stdout.trim();

  it("creates .gitattributes with the journal union line", () => {
    const r = ensureLayout(repoPaths(repo.root));
    expect(r.gitattributesUpdated).toBe(true);
    expect(readFileSync(file(), "utf8").split("\n")).toContain(".reggie/journal/**/*.md merge=union");
    expect(mergeAttr(".reggie/journal/2026-09-15/someone-session.md")).toBe(".reggie/journal/2026-09-15/someone-session.md: merge: union");
    expect(mergeAttr(".reggie/notes/_repo.md")).toBe(".reggie/notes/_repo.md: merge: unspecified");
  });

  it("appends to an existing .gitattributes without a trailing newline", () => {
    const original = "*.png binary\ndocs/*.md text eol=lf";
    writeFileSync(file(), original, "utf8");
    expect(ensureGitattributes(repo.root)).toBe(true);
    const content = readFileSync(file(), "utf8");
    expect(content.startsWith(`${original}\n`)).toBe(true);
    expect(content.split("\n")).toContain(GITATTRIBUTES_LINES[0]);
    expect(content.endsWith("\n")).toBe(true);
    expect(mergeAttr("docs/a.md")).toBe("docs/a.md: merge: unspecified");
  });

  it("is idempotent", () => {
    ensureLayout(repoPaths(repo.root));
    const before = readFileSync(file(), "utf8");
    expect(ensureLayout(repoPaths(repo.root)).gitattributesUpdated).toBe(false);
    expect(ensureGitattributes(repo.root)).toBe(false);
    expect(readFileSync(file(), "utf8")).toBe(before);
  });
});
