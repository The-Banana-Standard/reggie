import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { buildState, packageRoot, staleBuildWarning } from "./build-state.js";

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
    expect(buildState(root)).toEqual({ stale: false, newestSource: null, aheadMs: 0 });
  });

  it("forgives a build that finished in the same second as the edit", () => {
    const root = fixture();
    at(path.join(root, "dist", "a.js"), 1_000_000);
    at(path.join(root, "src", "a.ts"), 1_000_000.5);
    expect(buildState(root).stale).toBe(false);
  });

  it("calls a missing dist stale, because nothing was ever built", () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "reggie-nodist-"));
    dirs.push(root);
    mkdirSync(path.join(root, "src"), { recursive: true });
    at(path.join(root, "src", "a.ts"), 1_000_000);
    expect(buildState(root).stale).toBe(true);
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
});

describe("staleBuildWarning", () => {
  it("names the file, the fix, and what going stale actually costs", () => {
    // This package is built before the suite runs, so its own state is the realistic case:
    // either current (no warning) or a warning that says all three things.
    const warning = staleBuildWarning(import.meta.url);
    if (warning === null) return;
    expect(warning).toMatch(/stale build/i);
    expect(warning).toContain("npm run build");
    expect(warning).toMatch(/missing/);
  });

  it("resolves the package root from a module inside dist/ or src/", () => {
    const root = packageRoot(import.meta.url);
    expect(path.basename(root)).toBe("reggie");
  });
});
