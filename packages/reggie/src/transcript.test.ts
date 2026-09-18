import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { makeClaudeHome, records, sessionId, writeDecoy, writeTranscript, type ClaudeHome } from "../test/transcript-fixture.js";
import { closingMessages, defaultClaudeHome, findTranscript, isInsideDir, parseRecord, readLines, readTranscript, selectRecords, sessionIdOf, sessionSpan } from "./transcript.js";

const cleanups: (() => void)[] = [];
afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()?.();
});

function home(): ClaudeHome {
  const h = makeClaudeHome();
  cleanups.push(h.cleanup);
  return h;
}

function tempFile(content: Buffer | string): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), "reggie-lines-"));
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, "lines.jsonl");
  writeFileSync(file, content);
  return file;
}

const ID = sessionId(1);
const AT = "2026-09-15T10:00:00.000Z";

describe("session ids", () => {
  it("accepts a UUID and lowercases it", () => {
    expect(sessionIdOf(ID)).toBe(ID);
    expect(sessionIdOf(ID.toUpperCase())).toBe(ID);
  });

  it.each([["../x"], ["session"], [""], [`${ID}/`], [` ${ID}`], [`${ID}.jsonl`], [undefined], [null], [7]])("refuses %j", (value) => {
    expect(sessionIdOf(value)).toBeNull();
  });

  it("findTranscript throws for anything that is not an id, before it looks anywhere", () => {
    const h = home();
    for (const bad of ["../x", "session", "", `${ID}/`]) expect(() => findTranscript(h.home, bad)).toThrow(/not a session id/);
  });
});

describe("finding a transcript", () => {
  it("finds <id>.jsonl in whichever project folder holds it, whatever the records' cwd says", () => {
    const h = home();
    const r = records(ID);
    const file = writeTranscript(h, ID, "/somewhere/the session started", [r.closing("Finished the invented work.", { at: AT, cwd: "/a/directory/that/does/not/exist" })]);
    expect(findTranscript(h.home, ID)).toBe(file);
  });

  it("does not take a folder that holds only <id>/workflows/ for a transcript", () => {
    const h = home();
    // The decoy's project folder sorts before the real one, so a careless match would meet it first.
    writeDecoy(h, ID, "/aaa/first");
    expect(findTranscript(h.home, ID)).toBeNull();
    const file = writeTranscript(h, ID, "/zzz/last", [records(ID).closing("Invented closing words.", { at: AT })]);
    expect(findTranscript(h.home, ID)).toBe(file);
  });

  it("answers null for a home with no projects folder, and for an id nothing is named by", () => {
    const h = home();
    expect(findTranscript(path.join(h.home, "missing"), ID)).toBeNull();
    expect(findTranscript(h.home, sessionId(2))).toBeNull();
  });

  it("takes the home from CLAUDE_CONFIG_DIR when it is set", () => {
    expect(defaultClaudeHome({ CLAUDE_CONFIG_DIR: "/tmp/elsewhere" })).toBe(path.resolve("/tmp/elsewhere"));
    expect(defaultClaudeHome({})).toBe(path.join(os.homedir(), ".claude"));
  });
});

describe("the line reader", () => {
  it("returns every line byte for byte at a 16 byte chunk, including a four-byte character across a chunk boundary", () => {
    const clef = String.fromCodePoint(0x1d11e);
    // Thirteen ASCII bytes, then the four-byte character: its bytes are 13..16, so it straddles the first boundary.
    const lines = [`0123456789abc${clef} after`, "", "short", `${clef}${clef}${clef}${clef}${clef}`, "last line with no newline"];
    const content = Buffer.from(lines.join("\n"), "utf8");
    expect(content.subarray(13, 17).toString("utf8")).toBe(clef);
    const seen: Buffer[] = [];
    const stats = readLines(tempFile(content), (line) => seen.push(line), { chunkBytes: 16 });
    expect(seen.map((b) => b.toString("utf8"))).toEqual(lines);
    expect(Buffer.concat(seen.flatMap((b, i) => (i === 0 ? [b] : [Buffer.from("\n"), b]))).equals(content)).toBe(true);
    expect(stats).toEqual({ bytes: content.length, lines: lines.length, oversized: 0 });
  });

  it("reports a line longer than the ceiling as oversized without returning it", () => {
    const long = "x".repeat(500);
    const seen: string[] = [];
    const stats = readLines(tempFile(`before\n${long}\nafter\n`), (line) => seen.push(line.toString("utf8")), { chunkBytes: 16, maxLineBytes: 100 });
    expect(seen).toEqual(["before", "after"]);
    expect(stats.oversized).toBe(1);
    expect(stats.lines).toBe(3);
  });

  it("counts an oversized last line that has no newline after it", () => {
    const seen: string[] = [];
    const stats = readLines(tempFile(`ok\n${"y".repeat(300)}`), (line) => seen.push(line.toString("utf8")), { chunkBytes: 16, maxLineBytes: 100 });
    expect(seen).toEqual(["ok"]);
    expect(stats).toMatchObject({ lines: 2, oversized: 1 });
  });

  it("reads an empty file as no lines", () => {
    expect(readLines(tempFile(""), () => expect.unreachable())).toEqual({ bytes: 0, lines: 0, oversized: 0 });
  });
});

describe("what a record is reduced to", () => {
  const r = records(ID);

  it("keeps closing text only from an assistant record that ends a turn", () => {
    const closing = parseRecord(JSON.stringify(r.closing("Invented closing words.", { at: AT, cwd: "/repo" })));
    expect(closing).toEqual({ type: "assistant", sidechain: false, at: Date.parse(AT), cwd: "/repo", stopReason: "end_turn", closing: "Invented closing words." });
    expect(parseRecord(JSON.stringify(r.interim("between tool calls", { at: AT })))?.closing).toBeNull();
    expect(parseRecord(JSON.stringify(r.textWithStop("cut by a stop sequence", "stop_sequence", { at: AT })))?.closing).toBeNull();
    expect(parseRecord(JSON.stringify(r.textWithStop("no reason given", null, { at: AT })))?.closing).toBeNull();
    expect(parseRecord(JSON.stringify(r.closing("from a subagent", { at: AT, sidechain: true })))?.closing).toBeNull();
    expect(parseRecord(JSON.stringify(r.thinking("private reasoning", { at: AT })))?.closing).toBeNull();
    expect(parseRecord(JSON.stringify(r.toolUse("a command", { at: AT })))?.closing).toBeNull();
  });

  it("never opens the message of a user record, a summary, or any other record type", () => {
    const words = "ownerwords";
    const others = [r.user(words, { at: AT }), r.toolResult(words, { at: AT }), r.compactSummary(words, { at: AT }), r.attachment(words, { at: AT }), r.system(words, { at: AT }), r.queueOperation(words, AT), r.lastPrompt(words), r.customTitle(words), r.aiTitle(words), r.bridge()];
    for (const record of others) {
      const parsed = parseRecord(JSON.stringify(record));
      expect(parsed?.closing).toBeNull();
      expect(parsed?.stopReason).toBeNull();
      expect(JSON.stringify(parsed)).not.toMatch(/ownerwords|fixture-account|fixture-organisation/);
    }
  });

  it("takes only the text blocks of a closing record that holds several blocks", () => {
    const record = r.closing("first part", { at: AT });
    (record.message as { content: unknown[] }).content = [{ type: "thinking", thinking: "reasoning" }, { type: "text", text: "first part" }, { type: "tool_use", input: { command: "secret" } }, { type: "text", text: "second part" }];
    expect(parseRecord(JSON.stringify(record))?.closing).toBe("first part\n\nsecond part");
  });

  it("answers null for a line that is not a record", () => {
    for (const line of ["{", "[]", "null", '"text"', "{}", '{"type": 7}']) expect(parseRecord(line)).toBeNull();
  });

  it("reads a record with no timestamp as undated", () => {
    expect(parseRecord(JSON.stringify(r.lastPrompt("x")))?.at).toBeNull();
  });

  it("treats any truthy isSidechain as a sidechain, so a string or a number is never read as the main conversation", () => {
    const base = { type: "assistant", timestamp: AT, cwd: "/repo", message: { stop_reason: "end_turn", content: [{ type: "text", text: "words" }] } };
    for (const flag of [true, "true", 1, "1", {}]) expect(parseRecord(JSON.stringify({ ...base, isSidechain: flag }))?.sidechain).toBe(true);
    for (const flag of [false, "false", 0, null, undefined]) expect(parseRecord(JSON.stringify({ ...base, isSidechain: flag }))).toMatchObject({ sidechain: false, closing: "words" });
  });

  it("drops a timestamp far in the future as unusable, so a wrong clock cannot poison the ordering", () => {
    const future = new Date(Date.now() + 400 * 24 * 60 * 60 * 1000).toISOString();
    expect(parseRecord(JSON.stringify(r.closing("from 2027", { at: future, cwd: "/repo" })))?.at).toBeNull();
    const soon = new Date(Date.now() + 60 * 1000).toISOString();
    expect(parseRecord(JSON.stringify(r.closing("clock skew", { at: soon, cwd: "/repo" })))?.at).toBe(Date.parse(soon));
  });
});

describe("reading a transcript file", () => {
  it("counts lines that do not parse, skips blank ones, and survives bytes that are not UTF-8", () => {
    const r = records(ID);
    const good = `${JSON.stringify(r.closing("Invented closing words.", { at: AT, cwd: "/repo" }))}\n`;
    const damaged = Buffer.concat([Buffer.from('{"type":"assistant","timestamp":"2026-09-15T10:01:00.000Z","cwd":"/repo","message":{"stop_reason":"end_turn","content":[{"type":"text","text":"bytes '), Buffer.from([0xff, 0xfe]), Buffer.from(' here"}]}}\n')]);
    const file = tempFile(Buffer.concat([Buffer.from(good), Buffer.from("\n   \n"), damaged, Buffer.from("not json\n"), Buffer.from('{"type":"assistant","cut off')]));
    const t = readTranscript(file);
    expect(t.stats).toMatchObject({ records: 2, unparseable: 2, oversized: 0 });
    expect(t.records[1]?.closing).toContain("bytes");
  });
});

describe("which records count", () => {
  const r = records(ID);
  const repo = "/work/repo";
  const parse = (j: Record<string, unknown>) => parseRecord(JSON.stringify(j));
  const rule = { repoDirs: [repo], worktreeDirs: [`${repo}/.worktree/mine`] };

  it("compares directories as text, so a directory that is gone still matches and a sibling does not", () => {
    expect(isInsideDir(repo, repo)).toBe(true);
    expect(isInsideDir(repo, `${repo}/packages/x`)).toBe(true);
    expect(isInsideDir(repo, `${repo}-other`)).toBe(false);
    expect(isInsideDir(repo, "/work")).toBe(false);
  });

  it("counts records at the repo root but never another task's worktree, and narrows to the slug's own worktree once the session has been there", () => {
    const inRepo = parse(r.closing("in the repository", { at: "2026-09-15T10:00:00.000Z", cwd: repo }));
    const other = parse(r.closing("another task", { at: "2026-09-15T10:05:00.000Z", cwd: `${repo}/.worktree/other` }));
    const outside = parse(r.closing("somewhere else", { at: "2026-09-15T10:10:00.000Z", cwd: "/work/elsewhere" }));
    const mine = parse(r.closing("this task", { at: "2026-09-15T09:00:00.000Z", cwd: `${repo}/.worktree/mine/packages` }));
    const side = parse(r.closing("a subagent", { at: "2026-09-15T10:20:00.000Z", cwd: `${repo}/.worktree/mine`, sidechain: true }));
    const all = [inRepo, other, outside, mine, side].flatMap((x) => (x ? [x] : []));

    // A session that shaped this slug at the root and then built another task in .worktree/other: the
    // other task's closing words are never counted for this task, only the root record is.
    const wide = selectRecords(all.filter((x) => x !== mine), rule);
    expect(wide).toMatchObject({ insideRepo: true, narrowed: false });
    expect(wide.counted.map((x) => x.closing)).toEqual(["in the repository"]);

    const narrow = selectRecords(all, rule);
    expect(narrow.narrowed).toBe(true);
    expect(narrow.counted.map((x) => x.closing)).toEqual(["this task"]);

    // A session that only ever worked in another task's worktree is not inside this task at all.
    expect(selectRecords(other ? [other] : [], rule)).toMatchObject({ insideRepo: false, counted: [] });
    expect(selectRecords(outside ? [outside] : [], rule)).toMatchObject({ insideRepo: false, counted: [] });
  });

  it("treats an empty or relative cwd as outside, so a record with cwd \"\" or \".\" is never counted", () => {
    const empty = parse(r.closing("no cwd", { at: "2026-09-15T10:00:00.000Z", cwd: "" }));
    const dot = parse(r.closing("dot cwd", { at: "2026-09-15T10:00:00.000Z", cwd: "." }));
    const rel = parse(r.closing("relative", { at: "2026-09-15T10:00:00.000Z", cwd: "repo/packages" }));
    const all = [empty, dot, rel].flatMap((x) => (x ? [x] : []));
    expect(selectRecords(all, rule)).toMatchObject({ insideRepo: false, counted: [] });
    expect(isInsideDir(repo, "")).toBe(false);
    expect(isInsideDir(repo, ".")).toBe(false);
  });

  it("orders closing messages by their timestamps and not by their place in the file, and honours the watermark", () => {
    const late = parse(r.closing("late", { at: "2026-09-15T12:00:00.000Z", cwd: repo }));
    const early = parse(r.closing("early", { at: "2026-09-15T08:00:00.000Z", cwd: repo }));
    const undated = parse({ ...r.closing("undated", { at: "not a date", cwd: repo }) });
    const counted = [late, early, undated].flatMap((x) => (x ? [x] : []));
    expect(closingMessages(counted, null).map((x) => x.closing)).toEqual(["early", "late"]);
    expect(closingMessages(counted, Date.parse("2026-09-15T08:00:00.000Z")).map((x) => x.closing)).toEqual(["late"]);
  });

  it("spans the main conversation from its first dated record to its last, wherever it was working", () => {
    const records_ = [parse(r.user("p", { at: "2026-09-15T07:00:00.000Z", cwd: "/work/elsewhere" })), parse(r.closing("c", { at: "2026-09-15T09:00:00.000Z", cwd: repo })), parse(r.closing("s", { at: "2026-09-15T23:00:00.000Z", sidechain: true }))].flatMap((x) => (x ? [x] : []));
    expect(sessionSpan(records_)).toEqual({ start: Date.parse("2026-09-15T07:00:00.000Z"), end: Date.parse("2026-09-15T09:00:00.000Z") });
    expect(sessionSpan([])).toBeNull();
  });
});

describe("the module's own rules", () => {
  const source = readFileSync(path.resolve("src/transcript.ts"), "utf8");

  it("never reads a file whole", () => {
    expect(source).not.toMatch(/readFileSync|readText|readFile\b/);
  });

  it("names the home directory only in the function the CLI calls for the default", () => {
    const lines = source.split("\n").filter((l) => l.includes("homedir"));
    expect(lines).toHaveLength(1);
    const fn = source.slice(source.indexOf("export function defaultClaudeHome"), source.indexOf("export function findTranscript"));
    expect(fn).toContain("homedir");
    expect(readFileSync(path.resolve("src/derive.ts"), "utf8")).not.toContain("homedir");
  });

  it("has a fixture builder that says where its text comes from, and no transcript file sits beside the tests", () => {
    expect(readFileSync(path.resolve("test/transcript-fixture.ts"), "utf8")).toContain("Nothing here is copied from a real transcript");
    const found: string[] = [];
    const walk = (dir: string): void => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        if (e.isDirectory()) walk(path.join(dir, e.name));
        else if (e.name.endsWith(".jsonl")) found.push(path.join(dir, e.name));
      }
    };
    walk(path.resolve("src"));
    walk(path.resolve("test"));
    expect(found).toEqual([]);
  });
});
