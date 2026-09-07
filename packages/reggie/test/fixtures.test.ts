import { existsSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { currentBranch } from "../src/git.js";
import { allNoteFiles, staleEntriesFor } from "../src/notes.js";
import { listTasks } from "../src/tasks.js";
import { makeFixtureRepo, type FixtureRepo } from "./fixtures.js";

describe("fixture repo", () => {
  let fx: FixtureRepo;
  beforeAll(() => {
    fx = makeFixtureRepo();
  });
  afterAll(() => fx?.repo.cleanup());

  it("reports tasks in the three states", () => {
    const tasks = listTasks(fx.paths, fx.config);
    const byState = (slug: string) => tasks.find((t) => t.slug === slug)?.state;
    expect(byState(fx.slugs.ungroomed)).toBe("ungroomed");
    expect(byState(fx.slugs.inProcess)).toBe("in-process");
    expect(byState(fx.slugs.awaiting)).toBe("awaiting-decision");
    expect(tasks.find((t) => t.slug === fx.slugs.inProcess)?.branch).toBe(`task/${fx.slugs.inProcess}`);
    expect(tasks.find((t) => t.slug === fx.slugs.awaiting)?.packetExists).toBe(true);
  });

  it("leaves the working tree on main with the code and notes in place", () => {
    expect(currentBranch(fx.repo.root)).toBe("main");
    expect(existsSync(path.join(fx.repo.root, "src/big/a45.ts"))).toBe(true);
    expect(existsSync(path.join(fx.repo.root, "src/big/__tests__/a06.test.ts"))).toBe(true);
    expect(existsSync(path.join(fx.repo.root, "native/src/commands/widgets.rs"))).toBe(true);
    expect(existsSync(path.join(fx.repo.root, `.reggie/tasks/${fx.slugs.awaiting}/packet.md`))).toBe(false);
  });

  it("has a stale folder note on src/big/", () => {
    const notes = allNoteFiles(fx.paths);
    const stale = staleEntriesFor(fx.paths, notes);
    expect(stale.some((s) => s.entity === "src/big/")).toBe(true);
    expect(notes.some((n) => n.entity === "src/types/shape.ts")).toBe(true);
  });
});
