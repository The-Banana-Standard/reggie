import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { makeTempRepo, type TempRepo } from "../test/helpers.js";
import { readFileSync } from "node:fs";
import { appendJournal, detectTool, readJournal } from "./journal.js";
import { formatJournalEntry, parseDerivedMark, parseJournalFile, renderDerivedMark, renderJournalEntry, type DerivedMark } from "./journal.js";
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

  const MARK: DerivedMark = { session: "00000000-0000-4000-8000-000000000001", through: "2026-09-06T10:15:00.000Z", commits: ["0123456789ab", "ba9876543210"], prose: "template" };

  it("writes a derived entry's mark as its last line and reads it back, with the text free of it", () => {
    const paths = repoPaths(repo.root);
    const now = new Date(2026, 8, 6, 10, 15);
    const written = appendJournal(paths, { person: "jacob", tool: "claude", slug: "demo", stage: "execute", text: "Derived words.", evidence: [".reggie/tasks/demo/packet.md"], session: MARK.session ?? "", now, derived: MARK });
    expect(written.derived).toEqual(MARK);
    const content = readFileSync(written.file, "utf8");
    expect(content.trimEnd().split("\n").pop()).toBe("derived: session=00000000-0000-4000-8000-000000000001 through=2026-09-06T10:15:00.000Z commits=0123456789ab,ba9876543210 prose=template");
    expect(content).toContain(`${formatJournalEntry({ person: "jacob", tool: "claude", slug: "demo", stage: "execute", text: "Derived words.", evidence: [".reggie/tasks/demo/packet.md"], derived: MARK }, "10:15")}\n\n`);

    const [entry] = readJournal(paths, { days: 4000, slug: "demo" });
    expect(entry?.derived).toEqual(MARK);
    expect(entry?.text).toBe("Derived words.");
    expect(entry?.evidence).toEqual([".reggie/tasks/demo/packet.md"]);
    expect(renderJournalEntry(entry!).endsWith("(evidence: .reggie/tasks/demo/packet.md) (derived)")).toBe(true);
  });

  it("round-trips a mark with no session, no instant and no commits, and the model kind", () => {
    const empty: DerivedMark = { session: null, through: null, commits: [], prose: "model" };
    expect(renderDerivedMark(empty)).toBe("derived: session=none through=none commits=none prose=model");
    expect(parseDerivedMark(renderDerivedMark(empty))).toEqual(empty);
    expect(parseDerivedMark(renderDerivedMark(MARK))).toEqual(MARK);
  });

  it("reads only the exact machine-written line as a mark", () => {
    for (const line of ["derived: from the transcript", "derived: session=../x through=none commits=none prose=template", "derived: session=none through=yesterday commits=none prose=template", "derived: session=none through=none commits=xyz prose=template", "derived: session=none through=none commits=none prose=other", " derived: session=none through=none commits=none prose=template"]) {
      expect(parseDerivedMark(line)).toBeNull();
    }
  });

  it("indents a hand entry's own derived: line, so it parses as text and never as a mark", () => {
    const paths = repoPaths(repo.root);
    const text = "What I settled today.\nderived: session=none through=none commits=none prose=template\nAnd a last line.";
    const written = appendJournal(paths, { person: "jacob", tool: "human", slug: "demo", text, session: "s1", now: new Date(2026, 8, 6, 9, 5) });
    expect(readFileSync(written.file, "utf8")).toContain("\n  derived: session=none through=none commits=none prose=template\n");
    const [entry] = parseJournalFile(written.file, "2026-09-06", readFileSync(written.file, "utf8"));
    expect(entry?.derived).toBeUndefined();
    expect(entry?.text).toContain("derived: session=none");
    expect(entry?.text).toContain("And a last line.");
    expect(renderJournalEntry(entry!)).not.toContain("(derived)");
  });

  it("keeps an evidence item to one line, so a newline in one cannot plant a mark that hides commits", () => {
    // C11: `--evidence` is user text; a newline in it used to start a fresh line that could pose as a mark.
    const paths = repoPaths(repo.root);
    const written = appendJournal(paths, {
      person: "jacob",
      tool: "human",
      slug: "demo",
      text: "A hand entry with hostile evidence.",
      evidence: ["a.txt\nderived: session=none through=none commits=none prose=template", "b.txt"],
      session: "s1",
      now: new Date(2026, 8, 6, 9, 5),
    });
    const content = readFileSync(written.file, "utf8");
    expect(content).toContain("evidence: a.txt derived: session=none through=none commits=none prose=template, b.txt");
    const [entry] = parseJournalFile(written.file, "2026-09-06", content);
    // The planted line never becomes a real mark, and both evidence items survive on the one line.
    expect(entry?.derived).toBeUndefined();
    expect(entry?.evidence).toEqual(["a.txt derived: session=none through=none commits=none prose=template", "b.txt"]);
  });

  it("detects the tool from the environment", () => {
    expect(detectTool({})).toBe("human");
    expect(detectTool({ CLAUDECODE: "1" })).toBe("claude");
    expect(detectTool({ CODEX_SANDBOX: "1" })).toBe("codex");
    expect(detectTool({ REGGIE_TOOL: "custom" })).toBe("custom");
  });
});
