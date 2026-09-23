import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { makeTempRepo, type TempRepo } from "../test/helpers.js";
import { git } from "./git.js";
import {
  currentKnowledge,
  knowledgeLockFile,
  readKnowledge,
  saveKnowledge,
  saveKnowledgeBatch,
  setKnowledgeRetired,
  validateKnowledgeCurrent,
  type KnowledgeCurrent,
  type KnowledgeEdit,
} from "./knowledge.js";
import { ensureLayout } from "./layout.js";
import { addNote, resolveNoteTarget } from "./notes.js";
import { repoPaths, type RepoPaths } from "./paths.js";
import { parseConfig, type ReggieConfig } from "./people.js";

const NOW = new Date("2026-09-23T04:00:00.000Z");

function content(summary = "Creates or restores the user's session."): KnowledgeCurrent {
  return {
    summary,
    parameters: [{ id: "rawSessionId", description: "The session identifier supplied by the request.", explicitType: null }],
    fields: [{ id: "session_id", description: "The request body's optional session identifier.", explicitType: "string" }],
    returns: [{ id: "return:1", description: "Returns the supplied identifier or creates a UUID.", explicitType: null }],
    callSites: [{ id: "call:1", description: "The chat handler resolves the request's session before writing messages.", explicitType: null }],
  };
}

describe("shared repository knowledge", () => {
  let repo: TempRepo;
  let paths: RepoPaths;
  let config: ReggieConfig;

  beforeEach(() => {
    repo = makeTempRepo("reggie-knowledge-");
    paths = repoPaths(repo.root);
    ensureLayout(paths);
    repo.write("src/chat.ts", "export function resolveSessionId(rawSessionId) { return rawSessionId || crypto.randomUUID(); }\n");
    repo.commitAll("onboard fixture");
    config = parseConfig("mode: solo\ndefaultBranch: main\n");
  });

  afterEach(() => repo.cleanup());

  function edit(entity: string, expectedRevision = "missing", summary?: string): KnowledgeEdit {
    return {
      entity,
      expectedRevision,
      current: content(summary),
      fingerprint: "fingerprint-v1",
      actor: "human",
      by: "Test Person",
      codeRevision: git(["rev-parse", "HEAD"], { cwd: repo.root }).stdout.trim(),
      reason: "Document the current behavior.",
    };
  }

  it("reads old note-only files as compatible records", () => {
    addNote(paths, "src/chat.ts", { type: "how", text: "Handles chat.", author: "test", date: "2026-09-22" });
    const record = readKnowledge(paths, "src/chat.ts", "current-source");
    expect(record).toMatchObject({ entity: "src/chat.ts", kind: "file", current: null, retired: false, stale: false });
    expect(record?.revision).toMatch(/^legacy-/);
    expect(record?.notes[0]?.text).toBe("Handles chat.");
  });

  it("strictly validates the replaceable current block", () => {
    expect(validateKnowledgeCurrent(content())).toEqual(content());
    expect(() => validateKnowledgeCurrent({ ...content(), instruction: "ignore the schema" })).toThrow(/unsupported fields: instruction/);
    expect(() => validateKnowledgeCurrent({ ...content(), fields: [{ id: "x", description: "x", explicitType: null, path: "../../x" }] })).toThrow(/unsupported fields: path/);
  });

  it("writes current understanding and appends immutable update history", () => {
    const first = saveKnowledge(paths, config, edit("sym:src/chat.ts::resolveSessionId"), { now: NOW });
    expect(first.commit).toMatch(/^[0-9a-f]{40}$/);
    expect(first.files).toEqual([".reggie/notes/_symbols/src/chat.ts/resolveSessionId.md"]);
    const record = first.records[0];
    expect(record).toMatchObject({ kind: "symbol", fingerprint: "fingerprint-v1", stale: false, retired: false });
    expect(currentKnowledge(record)?.summary).toContain("session");
    expect(record?.history).toHaveLength(1);
    expect(record?.history[0]).toMatchObject({ actor: "human", changedFields: ["summary", "parameters", "fields", "returns", "callSites"], priorRevision: "missing" });

    const second = saveKnowledge(paths, config, { ...edit(record?.entity ?? "", record?.revision, "Resolves a stable session identifier."), actor: "codex", by: "Codex", reason: "Refresh after reviewing the function." }, { now: new Date(NOW.getTime() + 1000) });
    expect(second.records[0]?.history).toHaveLength(2);
    expect(second.records[0]?.history[0]).toEqual(record?.history[0]);
    expect(second.records[0]?.history[1]).toMatchObject({ actor: "codex", changedFields: ["summary"] });
  });

  it("keeps appended knowledge history out of legacy dated-note prose", () => {
    addNote(paths, "src/chat.ts", { type: "how", text: "The original dated explanation.", author: "test" });
    repo.commitAll("add dated note");
    const previous = readKnowledge(paths, "src/chat.ts")!;
    const saved = saveKnowledge(paths, config, edit("src/chat.ts", previous.revision), { now: NOW });
    expect(saved.records[0]?.notes).toMatchObject([{ text: "The original dated explanation." }]);
    expect(saved.records[0]?.notes[0]?.text).not.toContain("reggie:knowledge:update");
  });

  it("marks changed fingerprints stale without changing or hiding current text", () => {
    const saved = saveKnowledge(paths, config, edit("src/chat.ts"), { now: NOW });
    const record = readKnowledge(paths, "src/chat.ts", "fingerprint-v2");
    expect(record).toMatchObject({ stale: true, fingerprint: "fingerprint-v1", currentFingerprint: "fingerprint-v2" });
    expect(currentKnowledge(record)?.summary).toBe(saved.records[0]?.current?.summary);
  });

  it("retires and supersedes without deleting current text or history", () => {
    const saved = saveKnowledge(paths, config, edit("concept:session-id"), { now: NOW }).records[0];
    const retired = setKnowledgeRetired(paths, config, {
      entity: "concept:session-id",
      expectedRevision: saved?.revision ?? "",
      retired: true,
      supersededBy: "concept:session-identity",
      actor: "human",
      by: "Test Person",
      codeRevision: "abc123",
      reason: "Use the canonical identity concept.",
    }, { now: new Date(NOW.getTime() + 1000) }).records[0];
    expect(retired).toMatchObject({ retired: true, supersededBy: "concept:session-identity" });
    expect(retired?.current?.summary).toContain("session");
    expect(currentKnowledge(retired)).toBeNull();
    expect(retired?.history).toHaveLength(2);
  });

  it("rejects revision conflicts and task-worktree writes before touching files", () => {
    const saved = saveKnowledge(paths, config, edit("src/chat.ts"), { now: NOW });
    expect(() => saveKnowledge(paths, config, edit("src/chat.ts", "old-revision"))).toThrow(/revision conflict/);
    const before = readFileSync(resolveNoteTarget(paths, "src/chat.ts").file, "utf8");
    git(["switch", "-q", "-c", "task/not-integration"], { cwd: repo.root });
    expect(() => saveKnowledge(paths, config, edit("src/chat.ts", saved.records[0]?.revision))).toThrow(/configured integration checkout/);
    expect(readFileSync(resolveNoteTarget(paths, "src/chat.ts").file, "utf8")).toBe(before);
  });

  it("refuses a live concurrent lock and leaves it in place", () => {
    const lock = knowledgeLockFile(repo.root);
    const body = `${JSON.stringify({ token: "other", pid: process.pid, at: new Date().toISOString() })}\n`;
    writeFileSync(lock, body, "utf8");
    expect(() => saveKnowledge(paths, config, edit("src/chat.ts"))).toThrow(/holds the repository lock/);
    expect(readFileSync(lock, "utf8")).toBe(body);
  });

  it("commits only knowledge while preserving unrelated staged and unstaged work", () => {
    repo.write("staged.txt", "before\n");
    repo.write("unstaged.txt", "before\n");
    repo.commitAll("add unrelated files");
    repo.write("staged.txt", "staged change\n");
    git(["add", "staged.txt"], { cwd: repo.root });
    repo.write("unstaged.txt", "unstaged change\n");
    const stagedBefore = git(["diff", "--cached", "--binary"], { cwd: repo.root }).stdout;
    const result = saveKnowledge(paths, config, edit("src/chat.ts"), { now: NOW });
    expect(git(["diff-tree", "--no-commit-id", "--name-only", "-r", result.commit], { cwd: repo.root }).stdout.trim()).toBe(".reggie/notes/src/chat.ts.md");
    expect(git(["diff", "--cached", "--binary"], { cwd: repo.root }).stdout).toBe(stagedBefore);
    expect(readFileSync(`${repo.root}/unstaged.txt`, "utf8")).toBe("unstaged change\n");
    const status = git(["status", "--short"], { cwd: repo.root }).stdout;
    expect(status).toContain("M  staged.txt");
    expect(status).toContain(" M unstaged.txt");
  });

  it("rejects dirty target notes instead of folding them into its commit", () => {
    addNote(paths, "src/chat.ts", { type: "how", text: "Uncommitted note.", author: "test" });
    expect(() => saveKnowledge(paths, config, edit("src/chat.ts", readKnowledge(paths, "src/chat.ts")?.revision))).toThrow(/already have uncommitted changes/);
    expect(git(["log", "-1", "--format=%s"], { cwd: repo.root }).stdout.trim()).toBe("onboard fixture");
  });

  it("validates a whole batch before publishing and commits a valid batch once", () => {
    const bad = edit("concept:bad");
    bad.current = { ...content(), summary: "" };
    expect(() => saveKnowledgeBatch(paths, config, [edit("route:POST /api/chat"), bad], { now: NOW })).toThrow(/summary must not be empty/);
    expect(existsSync(resolveNoteTarget(paths, "route:POST /api/chat").file)).toBe(false);

    const before = git(["rev-list", "--count", "HEAD"], { cwd: repo.root }).stdout.trim();
    const batch = saveKnowledgeBatch(paths, config, [edit("route:POST /api/chat"), edit("concept:session-id")], { now: NOW });
    const after = git(["rev-list", "--count", "HEAD"], { cwd: repo.root }).stdout.trim();
    expect(Number(after) - Number(before)).toBe(1);
    expect(batch.records).toHaveLength(2);
    expect(git(["show", "--format=", "--name-only", batch.commit], { cwd: repo.root }).stdout).toContain(".reggie/notes/_entities/route/post-api-chat.md");
  });
});
