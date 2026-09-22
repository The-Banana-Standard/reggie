import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { makeTempRepo, type TempRepo } from "../test/helpers.js";
import { git } from "./git.js";
import { ensureGitattributes, ensureLayout, GITATTRIBUTES_LINES, REGGIE_README } from "./layout.js";
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

describe("the README every onboarded repo gets", () => {
  it("names the checks file beside the packet and the evidence folder, and says what it is for", () => {
    const repo = makeTempRepo();
    try {
      const paths = repoPaths(repo.root);
      ensureLayout(paths);
      const written = readFileSync(paths.readme, "utf8");
      expect(written).toBe(REGGIE_README);
      expect(written).toContain("- `tasks/<slug>/checks.jsonl` — what was verified, as data: one line per check");
      expect(written).toContain("written by `reggie check`. The packet's checklist");
      expect(written).toMatch(/A packet that cites a file which is not committed\s+here is refused when someone approves it\./);
      const order = ["tasks/<slug>/packet.md", "tasks/<slug>/checks.jsonl", "tasks/<slug>/evidence/"].map((name) => written.indexOf(name));
      expect(order.every((i) => i > 0) && order[0]! < order[1]! && order[1]! < order[2]!).toBe(true);
    } finally {
      repo.cleanup();
    }
  });
});
