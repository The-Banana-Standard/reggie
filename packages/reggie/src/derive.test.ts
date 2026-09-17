import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { fullPlan, makeTempRepo, type TempRepo } from "../test/helpers.js";
import { appendRecords, makeClaudeHome, records, SECRET_SHAPES, sessionId, writeTranscript, type ClaudeHome } from "../test/transcript-fixture.js";
import { claimTask } from "./claim.js";
import {
  DeriveError,
  deriveJournal,
  MAX_REWRITE_CHARS,
  realRewriteRunner,
  REWRITE_ARGV,
  REWRITE_INSTRUCTION,
  SENTENCE_CODEX_UNREAD,
  SENTENCE_ENDED_ON_TOOLS,
  SENTENCE_NO_CLOSING_WORDS,
  SENTENCE_NO_SESSION,
  SENTENCE_NO_TRANSCRIPT,
  SENTENCE_OTHER_MACHINE,
  SENTENCE_OUTSIDE_SESSIONS,
  withheldSentence,
  type DeriveInput,
  type DeriveResult,
  type RewriteReply,
  type RewriteRequest,
} from "./derive.js";
import { git } from "./git.js";
import { clearHistoryCache } from "./history.js";
import { appendJournal, parseJournalFile } from "./journal.js";
import { landTask } from "./land.js";
import { recordLaunch, type LaunchGoal } from "./launch.js";
import { ensureLayout } from "./layout.js";
import { scaffoldPacket } from "./packet.js";
import { claimFile, packetRelPath, planFile, repoPaths, type RepoPaths } from "./paths.js";
import { currentPerson, loadConfig, loadPeople, type Person, type ReggieConfig } from "./people.js";
import { MAX_QUOTE_CHARS, WITHHELD } from "./redact.js";
import { clock, today, writeText } from "./util.js";

const SLUG = "cap-retries";
const BRANCH = `task/${SLUG}`;
const CLI = path.resolve("src/cli.ts");
const TSX = path.resolve("node_modules/.bin/tsx");
const ID1 = sessionId(1);
const ID2 = sessionId(2);
const ID3 = sessionId(3);
const ID4 = sessionId(4);

/** An instant on the fixture's day, given in local time, so the suite reads the same in any time zone. */
const at = (hour: number, minute: number, day = 15): string => new Date(2026, 8, day, hour, minute).toISOString();
const DAY = today(new Date(2026, 8, 15));

interface Setup {
  repo: TempRepo;
  root: string;
  paths: RepoPaths;
  config: ReggieConfig;
  person: Person;
  home: ClaudeHome;
}

/** Every journal file a derive case wrote, kept past the repo's cleanup for the last test in this file. */
const written: { root: string; home: string; shas: string[]; files: Map<string, string> }[] = [];
const cleanups: (() => void)[] = [];
afterEach(() => {
  clearHistoryCache();
  while (cleanups.length > 0) cleanups.pop()?.();
});

function journalFiles(root: string): Map<string, string> {
  const out = new Map<string, string>();
  const dir = path.join(root, ".reggie", "journal");
  const walk = (d: string): void => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, e.name);
      if (e.isDirectory()) walk(full);
      else if (e.name.endsWith(".md")) out.set(path.relative(root, full), readFileSync(full, "utf8"));
    }
  };
  if (existsSync(dir)) walk(dir);
  return out;
}

/** A repo with a plan on main, and an empty Claude home in a temp directory. No test passes any other home. */
function setup(): Setup {
  const repo = makeTempRepo("reggie-derive-");
  // The resolved spelling, which is what the CLI gets from git and so what a record's cwd is compared with:
  // macOS keeps its temp directories behind a link.
  const root = realpathSync(repo.root);
  const paths = repoPaths(root);
  ensureLayout(paths);
  appendFileSync(path.join(root, ".gitignore"), ".worktree/\n");
  writeText(planFile(paths, SLUG), fullPlan(SLUG));
  repo.commitAll("plan");
  const home = makeClaudeHome();
  cleanups.push(() => {
    const shas = git(["log", "--all", "--format=%H"], { cwd: root, allowFailure: true }).stdout.split("\n").filter(Boolean);
    written.push({ root, home: home.home, shas, files: journalFiles(root) });
    repo.cleanup();
    home.cleanup();
  });
  return { repo, root, paths, config: loadConfig(paths), person: currentPerson(root, loadPeople(paths)), home };
}

function onBranch(s: Setup): void {
  git(["switch", "-q", "-c", BRANCH], { cwd: s.root });
}

let fileCounter = 0;
/** One commit with a chosen author date, a `Task:` line, and one file of its own. Returns the full id. */
function commitAt(cwd: string, subject: string, iso: string): string {
  fileCounter += 1;
  const rel = `src/file-${fileCounter}.ts`;
  mkdirSync(path.join(cwd, "src"), { recursive: true });
  writeFileSync(path.join(cwd, rel), `export const n = ${fileCounter};\n`, "utf8");
  git(["add", "--", rel], { cwd });
  git(["commit", "-q", "--date", iso, "-m", subject, "-m", `Task: ${SLUG}`], { cwd });
  return git(["rev-parse", "HEAD"], { cwd }).stdout.trim();
}

function launch(s: Setup, goal: LaunchGoal, session: string | null, tool: "claude" | "codex" = "claude"): void {
  recordLaunch(s.root, { slug: SLUG, tool, goal, session, resume: null, cwd: s.root });
}

function derive(s: Setup, extra: Partial<DeriveInput> = {}, paths: RepoPaths = s.paths): DeriveResult {
  return deriveJournal(paths, s.config, { slug: SLUG, claudeHome: s.home.home, person: s.person, host: "this-host", env: {}, ...extra });
}

/** The verb itself, with the Claude home pointed at the fixture so the real one is never the default. */
function cli(s: Setup, args: string[]): { status: number | null; stdout: string; stderr: string } {
  const r = spawnSync(TSX, [CLI, "--root", s.root, ...args], { cwd: s.root, encoding: "utf8", env: { ...process.env, CLAUDE_CONFIG_DIR: s.home.home } });
  return { status: r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

/** A build session that made two commits and closed with one message: the ordinary case most tests start from. */
function ordinary(s: Setup, branch = true): { file: string; shas: string[] } {
  // Without a branch the commits sit on main and are found by their Task line, which is all most cases
  // need; a live branch also costs every derive a pull request lookup.
  if (branch) onBranch(s);
  const shas = [commitAt(s.root, "feat: cap the retries at three", at(10, 10)), commitAt(s.root, "test: cover the cap", at(10, 40))];
  launch(s, "build", ID1);
  const r = records(ID1);
  const file = writeTranscript(s.home, ID1, "/started/somewhere/else", [
    r.user("please cap the retries", { at: at(10, 0), cwd: s.root }),
    r.interim("Looking at the login client first.", { at: at(10, 5), cwd: s.root }),
    r.toolUse("npm test", { at: at(10, 45), cwd: s.root }),
    r.closing("Capped the retries at three and the tests pass.", { at: at(10, 50), cwd: s.root }),
  ]);
  return { file, shas };
}

const entryFile = (s: Setup, rel: string): string => readFileSync(path.join(s.root, rel), "utf8");

describe("session sources", () => {
  const BAD_IDS = ["../x", "session", "", `${ID1}/`];

  /** A transcript at every place a path built from a bad id would land, each holding words that must never surface. */
  function trap(s: Setup): void {
    const r = records(ID1);
    const line = `${JSON.stringify(r.closing("TRAPPEDWORDS must never be read.", { at: at(10, 50), cwd: s.root }))}\n`;
    const folder = path.join(s.home.projects, "-trap");
    mkdirSync(path.join(folder, ID1), { recursive: true });
    writeFileSync(path.join(s.home.projects, "x.jsonl"), line);
    writeFileSync(path.join(folder, "session.jsonl"), line);
    writeFileSync(path.join(folder, ".jsonl"), line);
    writeFileSync(path.join(folder, ID1, ".jsonl"), line);
  }

  it.each(BAD_IDS)("a launch record whose session is %j contributes no session and builds no path", (bad) => {
    const s = setup();
    commitAt(s.root, "feat: a commit", at(10, 10));
    trap(s);
    launch(s, "build", bad);
    const r = derive(s);
    expect(r.sessions).toEqual([]);
    expect(r.summary).toContain("records 0;");
    expect(r.entries).toHaveLength(1);
    expect(r.entries[0]?.text).toContain(SENTENCE_NO_SESSION);
    expect(JSON.stringify(r)).not.toContain("TRAPPEDWORDS");
  });

  it.each(BAD_IDS)("a claim whose session is %j contributes no session and builds no path", (bad) => {
    const s = setup();
    writeText(claimFile(s.paths, SLUG), ["---", "person: Casey", "handle: casey", "email: casey@example.com", "machine: this-host", "tool: claude", `session: ${bad}`, "date: 2026-09-15T09:00:00.000Z", "---", ""].join("\n"));
    commitAt(s.root, "feat: a commit", at(10, 10));
    trap(s);
    const r = derive(s);
    expect(r.sessions).toEqual([]);
    expect(r.entries[0]?.text).toContain(SENTENCE_NO_SESSION);
    expect(JSON.stringify(r)).not.toContain("TRAPPEDWORDS");
  });

  // A file name cannot hold a slash, so the two ids that need one cannot arise from this source at all.
  it.each(["session", "", `${ID1}x`, ID1.slice(0, 35)])("a journal file named <person>-%s.md contributes no session and builds no path", (bad) => {
    const s = setup();
    commitAt(s.root, "feat: a commit", at(10, 10));
    trap(s);
    appendJournal(s.paths, { person: "test", tool: "claude", slug: SLUG, stage: "execute", text: "A hand entry.", session: bad, now: new Date(at(9, 0)) });
    const r = derive(s);
    expect(r.sessions).toEqual([]);
    expect(JSON.stringify(r)).not.toContain("TRAPPEDWORDS");
  });

  it.each(BAD_IDS)("--session %j is refused before anything is read, and nothing is written", (bad) => {
    const s = setup();
    onBranch(s);
    commitAt(s.root, "feat: a commit", at(10, 10));
    trap(s);
    const before = journalFiles(s.root);
    expect(() => derive(s, { session: bad })).toThrow(DeriveError);
    expect(() => derive(s, { session: bad })).toThrow(/UUID/);
    expect(journalFiles(s.root)).toEqual(before);
  });

  it("takes the union of the launch log, the claim, the journal's file names and the flag, each id once", () => {
    const s = setup();
    writeText(claimFile(s.paths, SLUG), ["---", "person: Test Person", "handle: test", "email: test@example.com", "machine: this-host", "tool: claude", `session: ${ID2}`, "date: 2026-09-15T09:00:00.000Z", "---", ""].join("\n"));
    launch(s, "plan", ID1);
    // The same id again from a second source, and one that only the journal knows.
    for (const id of [ID1, ID3]) appendJournal(s.paths, { person: "test", tool: "claude", slug: SLUG, stage: "execute", text: "A hand entry from inside the session.", session: id, now: new Date(at(8, 0)) });
    // A day file named by a session that never wrote about this task is not one of its sessions.
    appendJournal(s.paths, { person: "test", tool: "claude", slug: "another-task", text: "Elsewhere.", session: sessionId(9), now: new Date(at(8, 0)) });
    [ID1, ID2, ID3, ID4, sessionId(9)].forEach((id, i) => writeTranscript(s.home, id, s.root, [records(id).closing(`Session ${i + 1} closed its invented turn.`, { at: at(11 + i, 0), cwd: s.root })]));

    const r = derive(s, { session: ID4 });
    expect(r.sessions.map((x) => x.id)).toEqual([ID1, ID2, ID3, ID4]);
    expect(r.sessions.map((x) => x.sources)).toEqual([["launch", "journal"], ["claim"], ["journal"], ["flag"]]);
    expect(r.sessions.every((x) => x.status === "read")).toBe(true);
    expect(r.entries.map((e) => e.session)).toEqual([ID1, ID2, ID3, ID4]);
  });

  it("a claim whose session is the word session contributes none", () => {
    const s = setup();
    const worktree = claimTask(s.paths, s.config, SLUG, { person: s.person, worktree: true }).worktree ?? "";
    expect(readFileSync(path.join(worktree, ".reggie/tasks", SLUG, "claim.md"), "utf8")).toContain("session: session");
    commitAt(worktree, "feat: a commit", at(10, 10));
    const r = derive(s);
    expect(r.sessions).toEqual([]);
    expect(r.entries[0]?.mark.session).toBeNull();
  });

  it("reports a Codex launch as unread, says so in the entry, and guesses no session by directory or time", () => {
    const s = setup();
    commitAt(s.root, "feat: built in codex", at(10, 10));
    launch(s, "build", null, "codex");
    // A rollout whose directory and time would both match, where a guesser would look for it.
    const rollouts = path.join(s.home.home, "..", path.basename(s.home.home), "codex", "sessions", "2026", "09", "15");
    mkdirSync(rollouts, { recursive: true });
    writeFileSync(path.join(rollouts, `rollout-2026-09-15T10-00-00-${ID2}.jsonl`), `${JSON.stringify({ type: "session_meta", payload: { id: ID2, cwd: s.root, text: "CODEXWORDS" } })}\n`);

    const r = derive(s);
    expect(r.codexUnread).toBe(1);
    expect(r.sessions).toEqual([]);
    expect(r.entries).toHaveLength(1);
    expect(r.entries[0]?.kind).toBe("commits");
    expect(r.entries[0]?.text).toContain(SENTENCE_CODEX_UNREAD);
    expect(r.entries[0]?.text).not.toContain(SENTENCE_NO_SESSION);
    expect(JSON.stringify(r)).not.toContain("CODEXWORDS");
    expect(r.summary).toContain("1 codex unread");
    expect(cli(s, ["journal", "derive", SLUG, "--dry-run"]).stdout).toMatch(/Nothing new[\s\S]*One Codex session was launched for this task and not read/);
  });

  it("says the session ran elsewhere when the claim names another machine and the recorded transcript is missing", () => {
    const s = setup();
    writeText(claimFile(s.paths, SLUG), ["---", "person: Casey", "handle: casey", "email: casey@example.com", "machine: another-box", "tool: claude", `session: ${ID1}`, "date: 2026-09-15T09:00:00.000Z", "---", ""].join("\n"));
    commitAt(s.root, "feat: built on the other machine", at(10, 10));
    const r = derive(s);
    expect(r.sessions).toMatchObject([{ id: ID1, status: "not-found", sources: ["claim"] }]);
    expect(r.entries[0]?.text).toContain(SENTENCE_OTHER_MACHINE);
    expect(r.entries[0]).toMatchObject({ kind: "commits", person: "casey" });
  });

  it("says no transcript was found when a recorded id has none on this machine", () => {
    const s = setup();
    commitAt(s.root, "feat: a commit", at(10, 10));
    launch(s, "build", ID1);
    const r = derive(s);
    expect(r.sessions).toMatchObject([{ id: ID1, status: "not-found" }]);
    expect(r.entries[0]?.text).toContain(SENTENCE_NO_TRANSCRIPT);
    expect(r.entries[0]?.text).not.toContain(SENTENCE_OTHER_MACHINE);
    expect(r.summary).toContain("sessions 0 read, 1 not found");
  });
});

describe("eligibility", () => {
  it("quotes the closing message of a turn and none of the eleven other kinds of text a transcript holds", () => {
    const s = setup();
    launch(s, "plan", ID1);
    const r = records(ID1);
    const o = { at: at(10, 0), cwd: s.root };
    writeTranscript(s.home, ID1, s.root, [
      r.user("MARKPROMPT the owner's words", o),
      r.toolUse("MARKTOOLINPUT --flag", o),
      r.toolResult("MARKTOOLRESULT output", o),
      r.thinking("MARKTHINKING reasoning", o),
      r.attachment("MARKATTACHMENT file contents", o),
      r.queueOperation("MARKQUEUE queued prompt", at(10, 1)),
      r.lastPrompt("MARKLASTPROMPT"),
      r.customTitle("MARKTITLE"),
      r.aiTitle("MARKTITLE again"),
      r.bridge(),
      r.compactBoundary({ at: at(10, 2), cwd: s.root }),
      r.compactSummary("MARKSUMMARY a paraphrase of everything said", { at: at(10, 3), cwd: s.root }),
      r.closing("MARKSIDECHAIN from a subagent", { at: at(10, 4), cwd: s.root, sidechain: true }),
      r.interim("MARKINTERIM between tool calls", { at: at(10, 5), cwd: s.root }),
      r.closing("MARKCLOSING the plan is written.", { at: at(10, 6), cwd: s.root }),
    ]);
    const result = derive(s);
    expect(result.entries).toHaveLength(1);
    const file = entryFile(s, result.entries[0]?.file ?? "");
    expect(file).toContain("MARKCLOSING the plan is written.");
    for (const marker of ["MARKPROMPT", "MARKTOOLINPUT", "MARKTOOLRESULT", "MARKTHINKING", "MARKATTACHMENT", "MARKQUEUE", "MARKLASTPROMPT", "MARKTITLE", "MARKSUMMARY", "MARKSIDECHAIN", "MARKINTERIM", "fixture-account", "quiet-otter"]) {
      expect(file).not.toContain(marker);
      expect(JSON.stringify(result)).not.toContain(marker);
    }
  });

  it("quotes only the record inside the slug's own worktree when the session also worked elsewhere", () => {
    const s = setup();
    launch(s, "build", ID1);
    const r = records(ID1);
    // Newest first in time is the one outside, so any rule that only took the newest would get this wrong.
    writeTranscript(s.home, ID1, "/elsewhere", [
      r.closing("MINE closed in the task's own worktree.", { at: at(10, 0), cwd: path.join(s.root, ".worktree", SLUG, "packages") }),
      r.closing("OTHERTASK closed in another task's worktree.", { at: at(11, 0), cwd: path.join(s.root, ".worktree", "another-task") }),
      r.closing("INREPO closed at the repository root.", { at: at(11, 30), cwd: s.root }),
      r.closing("OUTSIDE closed in an unrelated directory.", { at: at(12, 0), cwd: "/elsewhere/entirely" }),
    ]);
    const text = derive(s).entries[0]?.text ?? "";
    expect(text).toContain("MINE closed");
    for (const other of ["OTHERTASK", "INREPO", "OUTSIDE"]) expect(text).not.toContain(other);
  });

  it("refuses a --session that never worked inside the repository: exit 1, nothing written", () => {
    const s = setup();
    onBranch(s);
    commitAt(s.root, "feat: a commit", at(10, 10));
    writeTranscript(s.home, ID1, "/elsewhere", [records(ID1).closing("UNRELATED conversation about something else.", { at: at(10, 30), cwd: "/elsewhere/entirely" })]);
    const before = journalFiles(s.root);
    const r = cli(s, ["journal", "derive", SLUG, "--session", ID1]);
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/never worked inside this repository/);
    expect(r.stdout).not.toContain("UNRELATED");
    // The summary still comes out, last, and it holds counts only.
    expect(r.stdout.trim().split("\n").pop()).toMatch(/^derive cap-retries: sessions 1 read.*records 1;/);
    expect(journalFiles(s.root)).toEqual(before);
    expect(git(["status", "--porcelain"], { cwd: s.root }).stdout).toBe("");
  });

  it("refuses a --session whose transcript is not on this machine", () => {
    const s = setup();
    expect(() => derive(s, { session: ID1 })).toThrow(/no transcript by that session id/);
  });
});

describe("streaming", () => {
  it("derives from a transcript of more than 8 MB that holds one 3 MB line, without reading it whole", () => {
    const s = setup();
    const { file } = ordinary(s);
    const r = records(ID1);
    // Invented filler in the shape of a long session: interim commentary, and one tool result too big for any line.
    const filler = `${JSON.stringify(r.interim("filler ".repeat(140), { at: at(10, 20), cwd: s.root }))}\n`;
    for (let i = 0; i < 6; i += 1) appendFileSync(file, filler.repeat(1000));
    appendFileSync(file, `${JSON.stringify(r.toolResult("R".repeat(3 * 1024 * 1024), { at: at(10, 21), cwd: s.root }))}\n`);
    expect(statSync(file).size).toBeGreaterThan(8 * 1024 * 1024);

    const started = Date.now();
    const result = derive(s);
    expect(Date.now() - started).toBeLessThan(10_000);
    expect(result.sessions[0]?.stats).toMatchObject({ oversized: 1, unparseable: 0, records: 6004 });
    expect(result.summary).toContain("lines skipped 1 oversized, 0 unparseable");
    expect(result.entries).toHaveLength(1);
    expect(entryFile(s, result.entries[0]?.file ?? "")).toContain("Capped the retries at three and the tests pass.");
  });
});

describe("degenerate input", () => {
  it("derives from the lines before a cut-off last line, and quotes that line on a later run once it is whole", () => {
    const s = setup();
    const { file } = ordinary(s);
    const late = `${JSON.stringify(records(ID1).closing("LATERWORDS the packet is written too.", { at: at(11, 30), cwd: s.root }))}\n`;
    const cutAt = Math.floor(late.length / 2);
    appendFileSync(file, late.slice(0, cutAt));

    const first = derive(s);
    expect(first.sessions[0]?.stats).toMatchObject({ unparseable: 1 });
    expect(first.entries).toHaveLength(1);
    expect(first.entries[0]?.text).toContain("Capped the retries");
    expect(first.entries[0]?.text).not.toContain("LATERWORDS");
    expect(Date.parse(first.entries[0]?.mark.through ?? "")).toBe(Date.parse(at(10, 50)));

    appendFileSync(file, late.slice(cutAt));
    const second = derive(s);
    expect(second.sessions[0]?.stats).toMatchObject({ unparseable: 0 });
    expect(second.entries).toHaveLength(1);
    expect(second.entries[0]?.text).toContain("LATERWORDS the packet is written too.");
    expect(second.entries[0]?.text).not.toContain("Capped the retries");
    expect(second.entries[0]?.mark).toMatchObject({ commits: [], through: at(11, 30) });
    const parsed = parseJournalFile("f", DAY, entryFile(s, second.entries[0]?.file ?? ""));
    expect(parsed.map((e) => e.derived?.through)).toEqual([at(10, 50), at(11, 30)]);
  });

  it("writes valid UTF-8 with no NUL, no other control character and no bidirectional control, whatever the transcript holds", () => {
    const s = setup();
    launch(s, "discuss", ID1);
    const r = records(ID1);
    const nul = String.fromCharCode(0);
    const rlo = String.fromCharCode(0x202e);
    const bell = String.fromCharCode(7);
    const rawNulLine = Buffer.concat([Buffer.from('{"type":"assistant","timestamp":"2026-09-15T09:00:00.000Z","note":"'), Buffer.from([0]), Buffer.from('"}\n')]);
    const badUtf8Line = Buffer.concat([
      Buffer.from(`{"type":"assistant","isSidechain":false,"timestamp":"${at(9, 30)}","cwd":${JSON.stringify(s.root)},"message":{"stop_reason":"end_turn","content":[{"type":"text","text":"DAMAGED `),
      Buffer.from([0xff, 0xfe, 0xc3]),
      Buffer.from(' bytes."}]}}\n'),
    ]);
    // JSON.stringify writes the NUL as an escape, which is how a well-formed transcript would carry one.
    const hostile = `${JSON.stringify(r.closing(`HOSTILE${nul} text ${rlo}reversed${bell} here.`, { at: at(10, 0), cwd: s.root }))}\n`;
    expect(hostile).toContain("\\u0000");
    const file = path.join(s.home.projects, "-fixture", `${ID1}.jsonl`);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, Buffer.concat([rawNulLine, badUtf8Line, Buffer.from(hostile)]));

    const result = derive(s);
    expect(result.sessions[0]?.stats).toMatchObject({ unparseable: 1, records: 2 });
    expect(result.entries[0]?.text).toContain("HOSTILE text reversed here.");
    const bytes = readFileSync(path.join(s.root, result.entries[0]?.file ?? ""));
    expect(Buffer.from(bytes.toString("utf8"), "utf8").equals(bytes)).toBe(true);
    expect(bytes.toString("utf8")).not.toContain(String.fromCharCode(0xfffd));
    for (const byte of bytes) expect(byte === 10 || byte >= 32).toBe(true);
    expect(bytes.toString("utf8")).not.toMatch(new RegExp(`[${String.fromCharCode(0x202a)}-${String.fromCharCode(0x202e)}${String.fromCharCode(0x2066)}-${String.fromCharCode(0x2069)}${String.fromCharCode(0x200e)}${String.fromCharCode(0x200f)}]`));
  });

  it("quotes the message after a compaction boundary and nothing from the summary, across two tool versions", () => {
    const s = setup();
    launch(s, "discuss", ID1);
    const r = records(ID1);
    writeTranscript(s.home, ID1, s.root, [
      r.user("first prompt", { at: at(9, 0), cwd: s.root, version: "2.1.200" }),
      r.closing("BEFOREBOUNDARY an early answer.", { at: at(9, 10), cwd: s.root, version: "2.1.200" }),
      r.compactBoundary({ at: at(9, 20), cwd: s.root, version: "2.1.261" }),
      r.compactSummary("SUMMARYWORDS the owner asked for many things and the assistant did them.", { at: at(9, 21), cwd: s.root, version: "2.1.261" }),
      r.closing("AFTERBOUNDARY the discussion is settled.", { at: at(9, 40), cwd: s.root, version: "2.1.261" }),
    ]);
    const text = derive(s).entries[0]?.text ?? "";
    expect(text).toContain("AFTERBOUNDARY the discussion is settled.");
    expect(text).not.toContain("SUMMARYWORDS");
    expect(text).not.toContain("BEFOREBOUNDARY");
    expect(text).toContain("the last of two closing messages");
  });

  it("with no closing record at all: an entry with the sentence for it when there are commits, and nothing without them", () => {
    const quiet = (s: Setup): void => {
      launch(s, "build", ID1);
      const r = records(ID1);
      writeTranscript(s.home, ID1, s.root, [r.user("do the work", { at: at(10, 0), cwd: s.root }), r.toolResult("output", { at: at(11, 0), cwd: s.root })]);
    };
    const withCommits = setup();
    commitAt(withCommits.root, "feat: silent work", at(10, 30));
    quiet(withCommits);
    const r = derive(withCommits);
    expect(r.entries).toHaveLength(1);
    expect(r.entries[0]).toMatchObject({ kind: "session", quotedChars: 0 });
    expect(r.entries[0]?.text).toContain(SENTENCE_NO_CLOSING_WORDS);
    expect(r.entries[0]?.text).not.toContain("closed by saying");

    const without = setup();
    quiet(without);
    const none = derive(without);
    expect(none.entries).toEqual([]);
    expect(journalFiles(without.root).size).toBe(0);
  });

  it("with a newest turn that ends on tool calls: an entry with the sentence for it when there are commits, and nothing without them", () => {
    const toolsOnly = (s: Setup): void => {
      launch(s, "build", ID1);
      const r = records(ID1);
      writeTranscript(s.home, ID1, s.root, [
        r.user("do the work", { at: at(10, 0), cwd: s.root }),
        r.interim("INTERIMWORDS starting on it now.", { at: at(10, 5), cwd: s.root }),
        r.toolUse("npm test", { at: at(10, 50), cwd: s.root }),
        r.toolResult("output", { at: at(11, 0), cwd: s.root }),
      ]);
    };
    const withCommits = setup();
    commitAt(withCommits.root, "feat: work that was never summed up", at(10, 30));
    toolsOnly(withCommits);
    const r = derive(withCommits);
    expect(r.entries).toHaveLength(1);
    expect(r.entries[0]?.text).toContain(SENTENCE_ENDED_ON_TOOLS);
    expect(r.entries[0]?.text).not.toContain("INTERIMWORDS");
    expect(r.entries[0]?.quotedChars).toBe(0);

    const without = setup();
    toolsOnly(without);
    expect(derive(without).entries).toEqual([]);
    expect(journalFiles(without.root).size).toBe(0);
  });

  it("does not count a turn that ends on a stop sequence as closing words", () => {
    const s = setup();
    commitAt(s.root, "feat: a commit", at(10, 30));
    launch(s, "build", ID1);
    const r = records(ID1);
    writeTranscript(s.home, ID1, s.root, [r.user("go", { at: at(10, 0), cwd: s.root }), r.textWithStop("STOPSEQUENCEWORDS cut short", "stop_sequence", { at: at(11, 0), cwd: s.root })]);
    const text = derive(s).entries[0]?.text ?? "";
    expect(text).toContain(SENTENCE_NO_CLOSING_WORDS);
    expect(text).not.toContain("STOPSEQUENCEWORDS");
  });
});

describe("which commits are told", () => {
  it("narrates exactly the branch's own commits, without merges or the claim, when the branch merged the base back in", () => {
    const s = setup();
    onBranch(s);
    git(["commit", "-q", "--allow-empty", "-m", `meta: claim ${SLUG}`, "-m", `Task: ${SLUG}`], { cwd: s.root });
    const one = commitAt(s.root, "feat: first half", at(10, 0));
    git(["switch", "-q", "main"], { cwd: s.root });
    s.repo.write("elsewhere.txt", "base moved on\n");
    s.repo.commitAll("chore: BASECOMMIT something unrelated on main");
    git(["switch", "-q", BRANCH], { cwd: s.root });
    git(["merge", "-q", "--no-ff", "-m", "Merge branch 'main' into task/cap-retries MERGECOMMIT", "main"], { cwd: s.root });
    const two = commitAt(s.root, "feat: second half", at(11, 0));

    const r = derive(s);
    expect(r.entries).toHaveLength(1);
    expect(r.entries[0]?.mark.commits).toEqual([one.slice(0, 12), two.slice(0, 12)]);
    const text = r.entries[0]?.text ?? "";
    expect(text).toContain("two commits changed two files: “feat: first half”, “feat: second half”.");
    for (const not of ["BASECOMMIT", "MERGECOMMIT", "meta: claim"]) expect(text).not.toContain(not);
  });

  it("narrates the branch side of the landing merge once the branch is gone, and not the merge, the claim or the decision", () => {
    const s = setup();
    const worktree = claimTask(s.paths, s.config, SLUG, { person: s.person, worktree: true }).worktree ?? "";
    const work = commitAt(worktree, "feat: cap the retries", at(10, 0));
    scaffoldPacket(repoPaths(worktree), s.config, { slug: SLUG, author: s.person.handle });
    git(["add", "--", packetRelPath(SLUG)], { cwd: worktree });
    git(["commit", "-q", "--date", at(10, 30), "-m", `packet: ${SLUG}`, "-m", `Task: ${SLUG}`], { cwd: worktree });
    const packet = git(["rev-parse", "HEAD"], { cwd: worktree }).stdout.trim();
    landTask(s.paths, s.config, SLUG, { person: s.person });
    expect(git(["branch", "--list", BRANCH], { cwd: s.root }).stdout.trim()).toBe("");

    const r = derive(s);
    expect(r.entries).toHaveLength(1);
    expect(r.entries[0]?.mark.commits).toEqual([work.slice(0, 12), packet.slice(0, 12)]);
    expect(r.entries[0]?.text).toContain("“feat: cap the retries”, “packet: cap-retries”.");
    for (const not of ["merge:", "meta: claim", "decide", "Decision"]) expect(r.entries[0]?.text).not.toContain(not);
    // The packet the commits touched is what the entry links, by a path inside the task's own folder.
    expect(r.entries[0]?.evidence).toEqual([packetRelPath(SLUG)]);
    // A commits-only entry goes wherever a hand entry would, and no file is named by the slug.
    expect(r.entries[0]?.file).toBe(`.reggie/journal/${today(new Date(at(10, 30)))}/test-session.md`);
    expect(Array.from(journalFiles(s.root).keys()).some((f) => path.basename(f).includes(SLUG))).toBe(false);
    expect(derive(s).entries).toEqual([]);
  });

  it("narrates the indexed commits that name the slug when the task landed by fast-forward", () => {
    const s = setup();
    onBranch(s);
    git(["commit", "-q", "--allow-empty", "-m", `meta: claim ${SLUG}`, "-m", `Task: ${SLUG}`], { cwd: s.root });
    const one = commitAt(s.root, "feat: landed without a merge", at(10, 0));
    git(["switch", "-q", "main"], { cwd: s.root });
    git(["merge", "-q", "--ff-only", BRANCH], { cwd: s.root });
    git(["branch", "-q", "-D", BRANCH], { cwd: s.root });
    s.repo.write("later.txt", "unrelated\n");
    s.repo.commitAll("chore: UNRELATED later work with no task line");

    const r = derive(s);
    expect(r.entries).toHaveLength(1);
    expect(r.entries[0]?.mark.commits).toEqual([one.slice(0, 12)]);
    expect(r.entries[0]?.text).toContain("“feat: landed without a merge”");
    expect(r.entries[0]?.text).not.toContain("UNRELATED");
    expect(r.entries[0]?.text).not.toContain("meta: claim");
  });

  it("appends nothing for a shaped task nobody launched, says so, and exits 0", () => {
    const s = setup();
    const r = derive(s);
    expect(r.entries).toEqual([]);
    expect(r.message).toMatch(/nothing to derive for cap-retries/);
    const run = cli(s, ["journal", "derive", SLUG]);
    expect(run.status).toBe(0);
    expect(run.stdout).toMatch(/There is nothing to derive for cap-retries/);
    expect(journalFiles(s.root).size).toBe(0);
  });

  it("derives a planning session that made no commits from its transcript and the plan's state, as a plan entry", () => {
    const s = setup();
    launch(s, "plan", ID1);
    writeTranscript(s.home, ID1, s.root, [records(ID1).closing("The plan is written and passes the contract.", { at: at(9, 30), cwd: s.root })]);
    const r = derive(s);
    expect(r.entries).toHaveLength(1);
    expect(r.entries[0]).toMatchObject({ kind: "session", stage: "plan", tool: "claude", evidence: [`.reggie/tasks/${SLUG}/plan.md`] });
    expect(r.entries[0]?.text).toContain("the session made no new commits");
    expect(r.entries[0]?.text).toContain("A plan that passes the contract is in place.");
    expect(r.entries[0]?.text).toContain("“The plan is written and passes the contract.”");
    expect(r.entries[0]?.mark).toEqual({ session: ID1, through: at(9, 30), commits: [], prose: "template" });
  });

  it("quotes up to five subjects and counts the rest", () => {
    const s = setup();
    for (let i = 1; i <= 7; i += 1) commitAt(s.root, `feat: step ${i}`, at(10, i));
    const text = derive(s).entries[0]?.text ?? "";
    expect(text).toContain("seven commits changed seven files: “feat: step 1”, “feat: step 2”, “feat: step 3”, “feat: step 4”, “feat: step 5”, and two more.");
  });
});

describe("two sessions", () => {
  it("writes one day file per session, and gives each commit to the one entry whose span holds it", () => {
    const s = setup();
    const morning = commitAt(s.root, "feat: morning work", at(9, 30));
    const afternoon = commitAt(s.root, "feat: afternoon work", at(13, 30));
    const evening = commitAt(s.root, "fix: by hand in the evening", at(16, 0));
    launch(s, "plan", ID1);
    launch(s, "build", ID2);
    writeTranscript(s.home, ID1, s.root, [records(ID1).user("start", { at: at(9, 0), cwd: s.root }), records(ID1).closing("MORNING session closed.", { at: at(10, 0), cwd: s.root })]);
    writeTranscript(s.home, ID2, s.root, [records(ID2).user("start", { at: at(13, 0), cwd: s.root }), records(ID2).closing("AFTERNOON session closed.", { at: at(14, 0), cwd: s.root })]);

    const r = derive(s);
    expect(r.entries.map((e) => [e.kind, e.file, e.mark.commits])).toEqual([
      ["session", `.reggie/journal/${DAY}/test-${ID1}.md`, [morning.slice(0, 12)]],
      ["session", `.reggie/journal/${DAY}/test-${ID2}.md`, [afternoon.slice(0, 12)]],
      ["commits", `.reggie/journal/${DAY}/test-session.md`, [evening.slice(0, 12)]],
    ]);
    expect(r.entries[0]?.text).toContain("MORNING");
    expect(r.entries[1]?.text).toContain("AFTERNOON");
    expect(r.entries[2]?.text).toContain(SENTENCE_OUTSIDE_SESSIONS);
    expect(r.entries.map((e) => e.stage)).toEqual(["plan", "execute", "commits"]);

    const files = journalFiles(s.root);
    expect(Array.from(files.keys()).sort()).toEqual([`.reggie/journal/${DAY}/test-${ID1}.md`, `.reggie/journal/${DAY}/test-${ID2}.md`, `.reggie/journal/${DAY}/test-session.md`].sort());
    for (const [rel, content] of files) {
      expect(parseJournalFile(rel, DAY, content)).toHaveLength(1);
      expect(path.basename(rel)).not.toContain(SLUG);
    }
  });

  it("files a session that ran past midnight under the day it ended, timed at its end, and names both days", () => {
    const s = setup();
    launch(s, "discuss", ID1);
    const start = new Date(2026, 8, 15, 23, 40);
    const end = new Date(2026, 8, 16, 0, 20);
    writeTranscript(s.home, ID1, s.root, [records(ID1).user("a late question", { at: start.toISOString(), cwd: s.root }), records(ID1).closing("Settled it after midnight.", { at: end.toISOString(), cwd: s.root })]);
    const r = derive(s);
    expect(r.entries).toHaveLength(1);
    expect(r.entries[0]).toMatchObject({ date: today(end), time: "00:20", file: `.reggie/journal/${today(end)}/test-${ID1}.md` });
    expect(clock(end)).toBe("00:20");
    expect(r.entries[0]?.text).toContain("ran from Tuesday 15 September into Wednesday 16 September");
    expect(existsSync(path.join(s.root, ".reggie/journal", today(start)))).toBe(false);
  });
});

describe("idempotence", () => {
  const hashes = (root: string): Record<string, string> => Object.fromEntries(Array.from(journalFiles(root)).map(([rel, content]) => [rel, createHash("sha256").update(content).digest("hex")]));

  it("leaves every journal file byte-identical on a second run with nothing new, and says so", () => {
    const s = setup();
    ordinary(s);
    expect(derive(s).entries).toHaveLength(1);
    const before = hashes(s.root);
    const again = derive(s);
    expect(again.entries).toEqual([]);
    expect(again.message).toMatch(/^Nothing new for cap-retries/);
    expect(hashes(s.root)).toEqual(before);
    expect(cli(s, ["journal", "derive", SLUG]).stdout).toMatch(/Nothing new for cap-retries/);
    expect(hashes(s.root)).toEqual(before);
  });

  it("appends only what is new: two further commits and one further closing message make one entry that holds just those", () => {
    const s = setup();
    const { file, shas } = ordinary(s);
    const first = derive(s);
    expect(first.entries[0]?.mark.commits).toEqual(shas.map((x) => x.slice(0, 12)));

    const three = commitAt(s.root, "fix: count the first attempt too", at(11, 10));
    const four = commitAt(s.root, "docs: say what the cap is", at(11, 20));
    appendRecords(file, [records(ID1).closing("SECONDWORDS fixed the off-by-one and wrote it down.", { at: at(11, 30), cwd: s.root })]);
    const second = derive(s);
    expect(second.entries).toHaveLength(1);
    expect(second.entries[0]?.mark).toEqual({ session: ID1, through: at(11, 30), commits: [three.slice(0, 12), four.slice(0, 12)], prose: "template" });
    const text = second.entries[0]?.text ?? "";
    expect(text).toContain("two commits changed two files: “fix: count the first attempt too”, “docs: say what the cap is”.");
    expect(text).toContain("SECONDWORDS");
    for (const old of ["cap the retries at three", "cover the cap", "Capped the retries"]) expect(text).not.toContain(old);
    expect(parseJournalFile("f", DAY, entryFile(s, second.entries[0]?.file ?? ""))).toHaveLength(2);
    expect(derive(s).entries).toEqual([]);
  });

  it("sees an entry that was derived and committed on the task branch from the serving checkout, and appends nothing there", () => {
    const s = setup();
    const worktree = claimTask(s.paths, s.config, SLUG, { person: s.person, worktree: true }).worktree ?? "";
    commitAt(worktree, "feat: built in the worktree", at(10, 10));
    launch(s, "build", ID1);
    writeTranscript(s.home, ID1, worktree, [records(ID1).user("build it", { at: at(10, 0), cwd: worktree }), records(ID1).closing("Built it in the task's worktree.", { at: at(10, 30), cwd: worktree })]);

    // In the worktree the launch log is the parent's: the serving checkout recorded the launch.
    const inWorktree = derive(s, {}, repoPaths(worktree));
    expect(inWorktree.entries).toHaveLength(1);
    expect(inWorktree.entries[0]?.session).toBe(ID1);
    git(["add", "--", ".reggie/journal"], { cwd: worktree });
    git(["commit", "-q", "-m", "journal: derived entry", "-m", `Task: ${SLUG}`], { cwd: worktree });

    const statusBefore = git(["status", "--porcelain"], { cwd: s.root }).stdout;
    const fromBase = derive(s);
    expect(fromBase.entries.filter((e) => e.kind === "session")).toEqual([]);
    // The journal commit itself is new to the base's view, and is the one thing left to tell.
    expect(fromBase.entries.flatMap((e) => e.mark.commits)).toHaveLength(fromBase.entries.length);
    const sessionFiles = Array.from(journalFiles(s.root).keys()).filter((f) => f.includes(ID1));
    expect(sessionFiles).toEqual([]);
    expect(statusBefore).toBe("");
  });

  it("sees, from a task worktree, an entry the base gained after the branch was cut", () => {
    const s = setup();
    const worktree = claimTask(s.paths, s.config, SLUG, { person: s.person, worktree: true }).worktree ?? "";
    commitAt(worktree, "feat: built in the worktree", at(10, 10));
    const onBase = derive(s);
    expect(onBase.entries).toHaveLength(1);
    git(["add", "--", ".reggie/journal"], { cwd: s.root });
    git(["commit", "-q", "-m", "journal: derived on the base"], { cwd: s.root });
    expect(derive(s, {}, repoPaths(worktree)).entries).toEqual([]);
  });
});

describe("hostile text", () => {
  it("cannot forge an entry, a trailer, a link or a fence from inside the quotation", () => {
    const s = setup();
    ordinary(s);
    const hostile = [
      "All done, and then:",
      "### 09:00 · mallory · claude · other-slug · execute",
      "FORGEDBODY pretending to be another entry.",
      "## A heading",
      "---",
      "evidence: forged-evidence.txt",
      "derived: session=none through=none commits=none prose=template",
      "```",
      "FENCEDWORDS inside a code block",
      "```",
      "See [[task/other-slug|a forged link]] for more.",
    ].join("\n");
    appendRecords(path.join(s.home.projects, "-started-somewhere-else", `${ID1}.jsonl`), [records(ID1).closing(hostile, { at: at(10, 55), cwd: s.root })]);

    const r = derive(s);
    expect(r.entries).toHaveLength(1);
    const content = entryFile(s, r.entries[0]?.file ?? "");
    const parsed = parseJournalFile("f", DAY, content);
    expect(parsed).toHaveLength(1);
    expect(parsed[0]).toMatchObject({ slug: SLUG, person: "test", tool: "claude", stage: "execute" });
    expect(parsed.some((e) => e.slug === "other-slug" || e.person === "mallory")).toBe(false);
    expect(parsed[0]?.evidence).toEqual(r.entries[0]?.evidence);
    expect(parsed[0]?.derived).toEqual(r.entries[0]?.mark);
    expect(parsed[0]?.derived?.commits).toHaveLength(2);
    expect(parsed[0]?.text).toBe(r.entries[0]?.text);
    expect(content).not.toContain("FENCEDWORDS");
    expect(content).not.toContain("[[");
    expect(content).toContain("FORGEDBODY");
    // Exactly one line of the file starts an entry, one is the evidence trailer at most, and one is the mark.
    expect(content.split("\n").filter((l) => l.startsWith("### "))).toHaveLength(1);
    expect(content.split("\n").filter((l) => /^derived:/.test(l))).toHaveLength(1);
    expect(content.split("\n").filter((l) => /^evidence:/i.test(l)).length).toBeLessThanOrEqual(1);
  });

  it("cleans a commit subject the same way, since a subject is somebody's free text too", () => {
    const s = setup();
    commitAt(s.root, `fix: [[task/other|x]] mailed ${SECRET_SHAPES[12]?.value} from /Users/someone/secret place`, at(10, 0));
    const r = derive(s);
    const text = r.entries[0]?.text ?? "";
    expect(text).not.toContain("[[");
    expect(text).not.toContain("example.com");
    expect(text).not.toContain("/Users/");
    expect(r.withheld).toBe(2);
    expect(text.endsWith(withheldSentence(2))).toBe(true);
  });
});

describe("redaction in an entry", () => {
  it("leaves none of the listed shapes in the journal file, ends the entry with the count, and prints the same count", () => {
    const s = setup();
    launch(s, "build", ID1);
    const url = `https://${["user", "pw123456"].join(":")}@example.org/page?key=${"k".repeat(16)}`;
    const message = `Finished. ${SECRET_SHAPES.map((x) => `Then ${x.value} appeared.`).join(" ")} Also ${url} was used.`;
    writeTranscript(s.home, ID1, s.root, [records(ID1).closing(message, { at: at(10, 0), cwd: s.root })]);

    const run = cli(s, ["journal", "derive", SLUG]);
    expect(run.status).toBe(0);
    const files = journalFiles(s.root);
    expect(files.size).toBe(1);
    const content = Array.from(files.values())[0] ?? "";
    for (const shape of SECRET_SHAPES) {
      for (const piece of shape.value.split(/[\s=:/@.-]+/).filter((p) => p.length >= 8)) expect(content).not.toContain(piece);
    }
    for (const piece of ["pw123456", "kkkkkkkk", "someone@", "/Users/", "~/notes", "hunter2"]) expect(content).not.toContain(piece);
    expect(run.stdout).not.toContain("hunter2");

    const entry = parseJournalFile("f", DAY, content)[0];
    const counted = /^Withheld (\d+) passages? that looked like/m.exec(run.stdout)?.[1];
    const n = Number(counted);
    expect(n).toBeGreaterThanOrEqual(SECRET_SHAPES.length + 1);
    expect(entry?.text.endsWith(withheldSentence(n))).toBe(true);
    expect(run.stdout.trim().split("\n").pop()).toContain(`withheld ${n};`);
    expect(content).toContain(WITHHELD);
  });

  it("does not withhold a 40-character hex string or the bare word token", () => {
    const s = setup();
    launch(s, "discuss", ID1);
    const sha = "0123456789abcdef0123456789abcdef01234567";
    writeTranscript(s.home, ID1, s.root, [records(ID1).closing(`The token is refreshed by commit ${sha} and nothing else.`, { at: at(10, 0), cwd: s.root })]);
    const r = derive(s);
    expect(r.withheld).toBe(0);
    expect(r.entries[0]?.text).toContain(`The token is refreshed by commit ${sha} and nothing else.`);
    expect(r.entries[0]?.text).not.toContain("withheld");
  });

  it("quotes at most 800 characters ending on a sentence, says the message was cut, and counts the closing messages it did not quote", () => {
    const s = setup();
    launch(s, "discuss", ID1);
    const r = records(ID1);
    const long = `${"A sentence of invented words that goes on for a while. ".repeat(40)}LASTWORDS never reached.`;
    writeTranscript(s.home, ID1, s.root, [r.closing("FIRSTEARLIER message.", { at: at(9, 0), cwd: s.root }), r.closing("SECONDEARLIER message.", { at: at(9, 30), cwd: s.root }), r.closing(long, { at: at(10, 0), cwd: s.root })]);
    const result = derive(s);
    const text = result.entries[0]?.text ?? "";
    const quote = /closed by saying: “([^”]*)”/.exec(text)?.[1] ?? "";
    expect(Array.from(quote).length).toBeLessThanOrEqual(MAX_QUOTE_CHARS);
    expect(Array.from(quote).length).toBeGreaterThan(700);
    expect(quote.endsWith("for a while.")).toBe(true);
    expect(result.entries[0]?.quotedChars).toBe(Array.from(quote).length);
    expect(text).toContain("The message ran longer than this and is cut here.");
    expect(text).toContain("It was the last of three closing messages in this stretch; the other two are not quoted.");
    for (const not of ["LASTWORDS", "FIRSTEARLIER", "SECONDEARLIER"]) expect(text).not.toContain(not);
  });
});

describe("attribution", () => {
  it.each([
    ["shape", "triage"],
    ["plan", "plan"],
    ["discuss", "discuss"],
    ["build", "execute"],
  ] as const)("a session launched to %s is a %s entry, by the tool claude", (goal, stage) => {
    const s = setup();
    launch(s, goal, ID1);
    writeTranscript(s.home, ID1, s.root, [records(ID1).closing("Closed the invented turn.", { at: at(10, 0), cwd: s.root })]);
    const r = derive(s);
    expect(r.entries[0]).toMatchObject({ stage, tool: "claude", person: "test" });
    expect(parseJournalFile("f", DAY, entryFile(s, r.entries[0]?.file ?? ""))[0]).toMatchObject({ stage, tool: "claude", person: "test" });
  });

  it("a session named only by the flag is a session entry", () => {
    const s = setup();
    writeTranscript(s.home, ID1, s.root, [records(ID1).closing("Closed the invented turn.", { at: at(10, 0), cwd: s.root })]);
    expect(derive(s, { session: ID1 }).entries[0]).toMatchObject({ stage: "session", tool: "claude", evidence: [] });
  });

  it("goes to the claim's handle when the task has a claim, in the file name too, and to whoever runs the verb otherwise", () => {
    const s = setup();
    writeText(claimFile(s.paths, SLUG), ["---", "person: Casey Example", "handle: casey", "email: casey@example.com", "machine: this-host", "tool: claude", `session: ${ID1}`, "date: 2026-09-15T09:00:00.000Z", "---", ""].join("\n"));
    commitAt(s.root, "fix: by hand afterwards", at(15, 0));
    writeTranscript(s.home, ID1, s.root, [records(ID1).closing("Closed the invented turn.", { at: at(10, 0), cwd: s.root })]);
    const r = derive(s);
    expect(r.entries.map((e) => [e.kind, e.person, e.tool, e.stage, e.file])).toEqual([
      ["session", "casey", "claude", "execute", `.reggie/journal/${DAY}/casey-${ID1}.md`],
      ["commits", "casey", "reggie", "commits", `.reggie/journal/${DAY}/casey-session.md`],
    ]);
  });

  it("does not let a claim's handle become a path or a header field", () => {
    const s = setup();
    writeText(claimFile(s.paths, SLUG), ["---", "person: Mallory", "handle: ../../mallory · claude", "email: m@example.com", "machine: this-host", "tool: claude", "session: session", "date: 2026-09-15T09:00:00.000Z", "---", ""].join("\n"));
    commitAt(s.root, "feat: a commit", at(10, 0));
    const r = derive(s);
    expect(r.entries[0]?.person).toBe("mallory");
    expect(r.entries[0]?.file).toBe(`.reggie/journal/${DAY}/mallory-session.md`);
  });
});

describe("never commits", () => {
  const state = (root: string): { head: string; staged: string; status: string } => ({
    head: git(["rev-parse", "HEAD"], { cwd: root }).stdout.trim(),
    staged: git(["diff", "--cached", "--name-only"], { cwd: root }).stdout,
    status: git(["status", "--porcelain"], { cwd: root }).stdout,
  });

  it("a dry run prints the same entry and summary and leaves the repository exactly as it was", () => {
    const s = setup();
    ordinary(s);
    const before = state(s.root);
    const dry = derive(s, { dryRun: true });
    expect(state(s.root)).toEqual(before);
    expect(journalFiles(s.root).size).toBe(0);
    expect(dry.entries[0]?.written).toBe(false);

    const real = derive(s);
    expect(real.entries.map((e) => [e.block, e.file])).toEqual(dry.entries.map((e) => [e.block, e.file]));
    expect(real.summary.replace(/; \d+ ms$/, "").replace(" (dry run)", "")).toBe(dry.summary.replace(/; \d+ ms$/, "").replace(" (dry run)", ""));
    expect(entryFile(s, real.entries[0]?.file ?? "")).toContain(`${real.entries[0]?.block}\n`);
  });

  it("a real run moves no commit and stages nothing, and the output names the file as uncommitted", () => {
    const s = setup();
    ordinary(s);
    const before = state(s.root);
    const run = cli(s, ["journal", "derive", SLUG]);
    expect(run.status).toBe(0);
    const after = state(s.root);
    expect(after.head).toBe(before.head);
    expect(after.staged).toBe("");
    expect(after.status).toBe(`?? .reggie/journal/${DAY}/\n`);
    expect(run.stdout).toContain(`Appended to .reggie/journal/${DAY}/test-${ID1}.md, which is uncommitted`);
    expect(run.stdout).toContain("### ");
    expect(run.stdout).toContain("“Capped the retries at three and the tests pass.”");
    expect(run.stdout).toMatch(/derived: session=.* prose=template/);

    const dry = cli(s, ["journal", "derive", SLUG, "--dry-run"]);
    expect(state(s.root)).toEqual(after);
    expect(dry.stdout).toMatch(/Nothing new/);
  });
});

describe("rewrite seam", () => {
  const fake = (reply: RewriteReply | (() => never)): { calls: RewriteRequest[]; runner: (req: RewriteRequest) => RewriteReply } => {
    const calls: RewriteRequest[] = [];
    return {
      calls,
      runner: (req) => {
        calls.push(req);
        return typeof reply === "function" ? reply() : reply;
      },
    };
  };

  it("never calls the runner without the flag, even when one is given", () => {
    const s = setup();
    ordinary(s, false);
    const f = fake({ ok: true, text: "A rewrite nobody asked for." });
    const r = derive(s, { runner: f.runner });
    expect(f.calls).toHaveLength(0);
    expect(r.entries[0]?.mark.prose).toBe("template");
  });

  it("writes the template and says why when the flag is set and no runner is given", () => {
    const s = setup();
    ordinary(s, false);
    const r = derive(s, { rewrite: true });
    expect(r.entries[0]?.mark.prose).toBe("template");
    expect(r.entries[0]?.text).toContain("Capped the retries");
    expect(r.notes).toEqual(["rewrite skipped, template written: no runner was given to make the call"]);
  });

  it("calls the runner once per session entry with the fixed instruction and exactly the template body, and never for commits alone", () => {
    const s = setup();
    ordinary(s, false);
    commitAt(s.root, "fix: by hand, outside the session", at(16, 0));
    const f = fake({ ok: true, text: "The session capped the retries at three, and the tests pass." });
    const dry = derive(s, { rewrite: true, runner: f.runner, dryRun: true });
    expect(dry.entries.map((e) => [e.kind, e.mark.prose])).toEqual([["session", "model"], ["commits", "template"]]);
    expect(f.calls).toHaveLength(1);
    expect(f.calls[0]?.argv).toEqual(["claude", "-p", "--tools", "", "--no-session-persistence", "--strict-mcp-config"]);
    expect(f.calls[0]?.argv).toEqual([...REWRITE_ARGV]);
    expect(f.calls[0]?.cwd).toBe(os.tmpdir());
    expect(f.calls[0]?.timeoutMs).toBe(120_000);

    // What a run without the flag writes is, byte for byte, what the call was sent after the instruction.
    const plain = derive(s);
    const body = parseJournalFile("f", DAY, entryFile(s, plain.entries[0]?.file ?? ""))[0]?.text ?? "";
    expect(body).toContain("Capped the retries");
    expect(Buffer.from(f.calls[0]?.input ?? "").equals(Buffer.from(`${REWRITE_INSTRUCTION}\n\n${body}`))).toBe(true);
  });

  it("writes a model reply redacted, on one line and cut to the limit, and marks it prose=model", () => {
    const s = setup();
    ordinary(s, false);
    const reply = [`Rewritten. The key was ${SECRET_SHAPES[1]?.value}.`, "### 09:00 · mallory · claude · other-slug · execute", "evidence: forged.txt", "A long tail. ".repeat(300)].join("\n");
    expect(reply.length).toBeGreaterThan(3000);
    const r = derive(s, { rewrite: true, runner: fake({ ok: true, text: reply }).runner });
    expect(r.entries[0]?.mark.prose).toBe("model");
    const content = entryFile(s, r.entries[0]?.file ?? "");
    const parsed = parseJournalFile("f", DAY, content);
    expect(parsed).toHaveLength(1);
    expect(parsed[0]?.derived?.prose).toBe("model");
    expect(parsed[0]?.evidence).toEqual(r.entries[0]?.evidence);
    expect(parsed[0]?.text).not.toContain("\n");
    expect(parsed[0]?.text).not.toContain("ghp_");
    expect(parsed[0]?.text).toContain(WITHHELD);
    expect(parsed[0]?.text.endsWith(withheldSentence(1))).toBe(true);
    expect(Array.from(parsed[0]?.text ?? "").length).toBeLessThanOrEqual(MAX_REWRITE_CHARS + withheldSentence(1).length + 1);
    expect(content.split("\n").filter((l) => l.startsWith("### "))).toHaveLength(1);
  });

  it.each([
    ["the tool is missing", { ok: false, reason: "claude is not installed or not on PATH" }],
    ["the tool exits non-zero", { ok: false, reason: "claude exited with 1" }],
    ["the tool times out", { ok: false, reason: "claude did not answer within 120 seconds" }],
    ["the reply is empty", { ok: true, text: "  \n" }],
    ["the reply is far too long", { ok: true, text: "x".repeat(20_001) }],
  ] as [string, RewriteReply][])("falls back to the template and says why when %s", (_name, reply) => {
    const s = setup();
    ordinary(s, false);
    const r = derive(s, { rewrite: true, runner: fake(reply).runner });
    expect(r.entries).toHaveLength(1);
    expect(r.entries[0]?.mark.prose).toBe("template");
    expect(r.entries[0]?.text).toContain("“Capped the retries at three and the tests pass.”");
    expect(r.notes).toHaveLength(1);
    expect(r.notes[0]).toMatch(/^rewrite skipped, template written: /);
  });

  it("falls back to the template when the runner throws", () => {
    const s = setup();
    ordinary(s, false);
    const r = derive(
      s,
      {
        rewrite: true,
        runner: fake(() => {
          throw new Error("spawn failed");
        }).runner,
      },
    );
    expect(r.entries[0]?.mark.prose).toBe("template");
    expect(r.notes).toEqual(["rewrite skipped, template written: spawn failed"]);
  });

  it("has a real runner that refuses to run under vitest", () => {
    expect(process.env.VITEST).toBeTruthy();
    expect(() => realRewriteRunner()({ argv: [...REWRITE_ARGV], input: "x", cwd: os.tmpdir(), timeoutMs: 1000 })).toThrow(/never run inside the test suite/);
  });
});

describe("the verb", () => {
  it("lists its three options, with --rewrite described as off by default and as sending the entry text to the session's own tool", () => {
    const s = setup();
    const help = cli(s, ["journal", "derive", "--help"]).stdout.replace(/\s+/g, " ");
    for (const option of ["--session <uuid>", "--dry-run", "--rewrite"]) expect(help).toContain(option);
    expect(help).toMatch(/--rewrite off by default: send the entry's text, and nothing else, to the session's own tool/);
  });

  it("exits 1 with a sentence for an unknown slug and for a slug that is not a slug", () => {
    const s = setup();
    const unknown = cli(s, ["journal", "derive", "no-such-task"]);
    expect(unknown.status).toBe(1);
    expect(unknown.stderr).toMatch(/unknown task: no-such-task/);
    const unsafe = cli(s, ["journal", "derive", "../etc"]);
    expect(unsafe.status).toBe(1);
    expect(unsafe.stderr).toMatch(/not a valid slug/);
    expect(() => derive(s, { slug: "Not A Slug" })).toThrow(DeriveError);
  });
});

describe("what reaches the journal", () => {
  it("holds no absolute path, no Claude home, no transcript file name, and no commit id outside the derived line", () => {
    const s = setup();
    const { shas } = ordinary(s);
    commitAt(s.root, "fix: by hand, outside the session", at(16, 0));
    const r = derive(s);
    expect(r.entries).toHaveLength(2);
    for (const e of r.entries) for (const ev of e.evidence) expect(ev.startsWith(`.reggie/tasks/${SLUG}/`)).toBe(true);
    const mine = { root: s.root, home: s.home.home, shas, files: journalFiles(s.root) };

    let scanned = 0;
    for (const repo of [...written, mine]) {
      for (const [rel, content] of repo.files) {
        if (!content.includes("\nderived: ")) continue;
        scanned += 1;
        expect(content, rel).not.toContain(repo.home);
        expect(content, rel).not.toContain(repo.root);
        expect(content, rel).not.toContain(".jsonl");
        expect(content, rel).not.toContain(os.tmpdir());
        expect(content, rel).not.toMatch(/(?:^|[\s“"(])\/(?:Users|home|var|private|tmp)\//m);
        const outsideMarks = content.split("\n").filter((l) => !l.startsWith("derived: ")).join("\n");
        for (const sha of repo.shas) expect(outsideMarks, rel).not.toContain(sha.slice(0, 7));
        for (const entry of parseJournalFile(rel, DAY, content)) {
          for (const ev of entry.evidence) expect(ev, rel).toMatch(/^\.reggie\/tasks\/[a-z0-9-]+\//);
        }
      }
    }
    expect(scanned).toBeGreaterThanOrEqual(2);
  });
});
