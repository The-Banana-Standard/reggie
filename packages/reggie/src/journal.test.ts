import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { makeTempRepo, type TempRepo } from "../test/helpers.js";
import { appendJournal, detectTool, readJournal } from "./journal.js";
import { ensureLayout } from "./layout.js";
import { repoPaths } from "./paths.js";

describe("journal", () => {
  let repo: TempRepo;
  beforeEach(() => {
    repo = makeTempRepo();
    ensureLayout(repoPaths(repo.root));
  });
  afterEach(() => repo.cleanup());

  it("appends and reads entries newest first, filtered by slug", () => {
    const paths = repoPaths(repo.root);
    const t1 = new Date(2026, 8, 6, 9, 5);
    const t2 = new Date(2026, 8, 6, 10, 15);
    appendJournal(paths, { person: "jacob", tool: "claude", slug: "demo", stage: "plan", text: "Wrote the plan.", session: "s1", now: t1 });
    appendJournal(paths, { person: "jacob", tool: "codex", slug: "other", stage: "execute", text: "Did other work.", evidence: ["e.txt"], session: "s1", now: t2 });
    const all = readJournal(paths, { days: 4000 });
    expect(all).toHaveLength(2);
    expect(all[0]?.slug).toBe("other");
    expect(all[0]?.evidence).toEqual(["e.txt"]);
    const demo = readJournal(paths, { days: 4000, slug: "demo" });
    expect(demo).toHaveLength(1);
    expect(demo[0]?.text).toBe("Wrote the plan.");
    expect(demo[0]?.tool).toBe("claude");
  });

  it("detects the tool from the environment", () => {
    expect(detectTool({})).toBe("human");
    expect(detectTool({ CLAUDECODE: "1" })).toBe("claude");
    expect(detectTool({ CODEX_SANDBOX: "1" })).toBe("codex");
    expect(detectTool({ REGGIE_TOOL: "custom" })).toBe("custom");
  });
});
