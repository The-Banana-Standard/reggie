import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { buildState, checkBuild, packageRoot } from "./build-state.js";

const dirs: string[] = [];
function fixture(): string {
  const root = mkdtempSync(path.join(os.tmpdir(), "reggie-build-"));
  dirs.push(root);
  mkdirSync(path.join(root, "src"), { recursive: true });
  mkdirSync(path.join(root, "dist"), { recursive: true });
  return root;
}
afterAll(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })));

/** Write a file and stamp its mtime, in seconds from the epoch. */
function at(file: string, seconds: number): void {
  writeFileSync(file, "x\n", "utf8");
  utimesSync(file, seconds, seconds);
}

/** The URL a module loaded from `<root>/<rel>` would see as import.meta.url. */
function moduleIn(root: string, rel: string): string {
  return pathToFileURL(path.join(root, rel)).href;
}

/** A fixture whose source is ten minutes ahead of its build. */
function staleFixture(): string {
  const root = fixture();
  at(path.join(root, "dist", "cli.js"), 1_000_000);
  at(path.join(root, "src", "cli.ts"), 1_000_600);
  return root;
}

describe("buildState", () => {
  it("is not stale when the build is newer than the source", () => {
    const root = fixture();
    at(path.join(root, "src", "a.ts"), 1_000_000);
    at(path.join(root, "dist", "a.js"), 1_000_060);
    expect(buildState(root).stale).toBe(false);
  });

  it("is stale when a source file is newer than every built file", () => {
    const root = fixture();
    at(path.join(root, "dist", "a.js"), 1_000_000);
    at(path.join(root, "src", "a.ts"), 1_000_600);
    const state = buildState(root);
    expect(state.stale).toBe(true);
    expect(state.built).toBe(true);
    expect(state.newestSource).toBe(path.join("src", "a.ts"));
    expect(state.aheadMs).toBe(600_000);
  });

  it("finds the newest source at any depth, and ignores what is not TypeScript", () => {
    const root = fixture();
    at(path.join(root, "dist", "a.js"), 1_000_000);
    at(path.join(root, "src", "a.ts"), 999_000);
    at(path.join(root, "src", "notes.md"), 2_000_000);
    expect(buildState(root).stale).toBe(false);
    mkdirSync(path.join(root, "src", "deep", "deeper"), { recursive: true });
    at(path.join(root, "src", "deep", "deeper", "b.ts"), 1_000_500);
    expect(buildState(root).newestSource).toBe(path.join("src", "deep", "deeper", "b.ts"));
    expect(buildState(root).stale).toBe(true);
  });

  it("stays quiet in an installed package, which has no src/ to compare", () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "reggie-installed-"));
    dirs.push(root);
    mkdirSync(path.join(root, "dist"), { recursive: true });
    at(path.join(root, "dist", "a.js"), 1_000_000);
    expect(buildState(root)).toMatchObject({ stale: false, built: true, newestSource: null, aheadMs: 0 });
  });

  it("forgives a build that finished in the same second as the edit", () => {
    const root = fixture();
    at(path.join(root, "dist", "a.js"), 1_000_000);
    at(path.join(root, "src", "a.ts"), 1_000_000.5);
    expect(buildState(root).stale).toBe(false);
  });

  it("says an empty dist was never built, instead of inventing an age against the epoch", () => {
    const root = fixture();
    at(path.join(root, "src", "a.ts"), 1_000_000);
    expect(buildState(root)).toMatchObject({ stale: true, built: false, aheadMs: 0 });
  });

  it("ignores test files, whose edits change nothing a command does", () => {
    const root = fixture();
    at(path.join(root, "dist", "a.js"), 1_000_000);
    at(path.join(root, "src", "a.ts"), 999_000);
    at(path.join(root, "src", "a.test.ts"), 9_000_000);
    expect(buildState(root).stale).toBe(false);
  });

  it("does not walk into node_modules, which is full of newer .ts files", () => {
    const root = fixture();
    at(path.join(root, "dist", "a.js"), 1_000_000);
    at(path.join(root, "src", "a.ts"), 999_000);
    mkdirSync(path.join(root, "src", "node_modules", "pkg"), { recursive: true });
    at(path.join(root, "src", "node_modules", "pkg", "index.ts"), 9_000_000);
    expect(buildState(root).stale).toBe(false);
  });

  it("compares against the build a process loaded, and notices a rebuild since", () => {
    const root = fixture();
    at(path.join(root, "src", "a.ts"), 1_000_300);
    at(path.join(root, "dist", "a.js"), 1_000_600);
    expect(buildState(root).stale).toBe(false);
    const state = buildState(root, { builtAt: 1_000_000_000 });
    expect(state).toMatchObject({ stale: true, rebuilt: true, aheadMs: 300_000 });
  });
});

describe("checkBuild", () => {
  it("says not built yet, with no age, when dist holds nothing", () => {
    const root = fixture();
    at(path.join(root, "src", "a.ts"), 1_000_000);
    const check = checkBuild(moduleIn(root, "dist/cli.js"), {});
    expect(check.verdict).toBe("stale");
    expect(check.message).toContain("not been built");
    expect(check.message).not.toMatch(/\bhours?\b|\bminutes?\b/);
  });

  it("is current for code run from src/, however far behind the build is", () => {
    const stale = staleFixture();
    expect(checkBuild(moduleIn(stale, "src/cli.ts"), {})).toEqual({ verdict: "current", message: null });
    const unbuilt = mkdtempSync(path.join(os.tmpdir(), "reggie-nodist-"));
    dirs.push(unbuilt);
    mkdirSync(path.join(unbuilt, "src"), { recursive: true });
    at(path.join(unbuilt, "src", "cli.ts"), 1_000_000);
    expect(checkBuild(moduleIn(unbuilt, "src/cli.ts"), {})).toEqual({ verdict: "current", message: null });
  });

  it("refuses a stale dist and names the file, the fix, and the escape hatch", () => {
    const root = staleFixture();
    const check = checkBuild(moduleIn(root, "dist/cli.js"), {});
    expect(check.verdict).toBe("stale");
    expect(check.message).toContain(path.join("src", "cli.ts"));
    expect(check.message).toContain("10 minutes");
    expect(check.message).toContain("npm run build");
    expect(check.message).toContain("REGGIE_ALLOW_STALE=1");
  });

  it("allows a stale dist only when REGGIE_ALLOW_STALE is exactly 1", () => {
    const root = staleFixture();
    const url = moduleIn(root, "dist/cli.js");
    const allowed = checkBuild(url, { REGGIE_ALLOW_STALE: "1" });
    expect(allowed.verdict).toBe("allowed");
    expect(allowed.message).toMatch(/^Running the stale build because REGGIE_ALLOW_STALE=1/);
    expect(checkBuild(url, { REGGIE_ALLOW_STALE: "0" }).verdict).toBe("stale");
    expect(checkBuild(url, {}).verdict).toBe("stale");
  });

  it("is current for a dist build newer than its source", () => {
    const root = fixture();
    at(path.join(root, "src", "cli.ts"), 1_000_000);
    at(path.join(root, "dist", "cli.js"), 1_000_060);
    expect(checkBuild(moduleIn(root, "dist/cli.js"), {}).verdict).toBe("current");
  });

  it("tells a process running an older build than dist holds to restart", () => {
    const root = fixture();
    at(path.join(root, "src", "cli.ts"), 1_000_300);
    at(path.join(root, "dist", "cli.js"), 1_000_600);
    const check = checkBuild(moduleIn(root, "dist/cli.js"), {}, { builtAt: 1_000_000_000 });
    expect(check.verdict).toBe("stale");
    expect(check.message).toMatch(/restart the MCP server/);
  });

  it("resolves the package root from a module inside dist/ or src/", () => {
    const root = packageRoot(import.meta.url);
    expect(path.basename(root)).toBe("reggie");
  });
});
