import { appendFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

/*
 * A synthetic Claude home for tests.
 *
 * Nothing here is copied from a real transcript, and no transcript file is kept in the repository:
 * every record is built in code, one at a time, from text invented for the test that asks for it.
 * Only the shape follows what was measured on a real machine: a flat `<session id>.jsonl` under a
 * project folder named by the directory the session started in (every character that is not a letter
 * or a digit turned into a dash), one JSON object per line, one content block per assistant record
 * with the API's `stop_reason` beside it, `cwd`, `timestamp` and `isSidechain` on the conversation
 * records, the rarer record types that hold the owner's words, and the `<session id>/workflows/`
 * folder a session leaves in the project folder of any directory it later changed into.
 */

export interface ClaudeHome {
  /** The directory a test passes as the Claude home. Always under the OS temp directory. */
  home: string;
  projects: string;
  cleanup(): void;
}

export function makeClaudeHome(prefix = "reggie-claude-home-"): ClaudeHome {
  const home = mkdtempSync(path.join(os.tmpdir(), prefix));
  const projects = path.join(home, "projects");
  mkdirSync(projects, { recursive: true });
  return { home, projects, cleanup: () => rmSync(home, { recursive: true, force: true }) };
}

/** The project folder name for a start directory. Lossy on purpose, like the real one. */
export function projectFolder(startDir: string): string {
  return startDir.replace(/[^A-Za-z0-9]/g, "-");
}

/** A deterministic, well-formed session id: `sessionId(1)` is `00000000-0000-4000-8000-000000000001`. */
export function sessionId(n: number): string {
  return `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
}

export interface RecordOptions {
  /** ISO timestamp. */
  at: string;
  cwd?: string;
  sidechain?: boolean;
  version?: string;
}

type Json = Record<string, unknown>;

let counter = 0;
function envelope(type: string, session: string, o: RecordOptions): Json {
  counter += 1;
  return {
    type,
    uuid: `10000000-0000-4000-8000-${String(counter).padStart(12, "0")}`,
    parentUuid: null,
    sessionId: session,
    isSidechain: o.sidechain ?? false,
    timestamp: o.at,
    cwd: o.cwd ?? "/nowhere",
    version: o.version ?? "9.9.9",
    // The tool's own nickname for the session. It is not a Reggie task slug and must never be read as one.
    slug: "quiet-otter-fixture",
  };
}

function assistant(session: string, o: RecordOptions, block: Json, stopReason: string | null): Json {
  return { ...envelope("assistant", session, o), message: { role: "assistant", model: "fixture-model", content: [block], stop_reason: stopReason } };
}

/** Builders for one record each. `session` is the id the file is named by. */
export function records(session: string) {
  return {
    /** The owner's prompt. */
    user: (text: string, o: RecordOptions): Json => ({ ...envelope("user", session, o), message: { role: "user", content: text } }),
    /** A tool result, which the real tool also files as a `user` record. */
    toolResult: (text: string, o: RecordOptions): Json => ({
      ...envelope("user", session, o),
      message: { role: "user", content: [{ type: "tool_result", tool_use_id: "toolu_fixture", content: text }] },
      toolUseResult: { stdout: text },
    }),
    /** The closing message of a turn: the one eligible kind. */
    closing: (text: string, o: RecordOptions): Json => assistant(session, o, { type: "text", text }, "end_turn"),
    /** Commentary between tool calls. */
    interim: (text: string, o: RecordOptions): Json => assistant(session, o, { type: "text", text }, "tool_use"),
    /** Assistant text with any other stop reason, or none. */
    textWithStop: (text: string, stop: string | null, o: RecordOptions): Json => assistant(session, o, { type: "text", text }, stop),
    thinking: (text: string, o: RecordOptions): Json => assistant(session, o, { type: "thinking", thinking: text, signature: "fixture" }, "tool_use"),
    toolUse: (inputText: string, o: RecordOptions): Json => assistant(session, o, { type: "tool_use", id: "toolu_fixture", name: "Bash", input: { command: inputText } }, "tool_use"),
    attachment: (text: string, o: RecordOptions): Json => ({ ...envelope("attachment", session, o), attachment: { type: "file", content: text } }),
    system: (text: string, o: RecordOptions): Json => ({ ...envelope("system", session, o), subtype: "informational", content: text }),
    compactBoundary: (o: RecordOptions): Json => ({ ...envelope("system", session, o), subtype: "compact_boundary", content: "Conversation compacted" }),
    /** The tool's paraphrase of the whole conversation, the owner's side included. A `user` record. */
    compactSummary: (text: string, o: RecordOptions): Json => ({ ...envelope("user", session, o), isCompactSummary: true, message: { role: "user", content: text } }),
    // The record types below carry no cwd and no sidechain flag in the real format.
    queueOperation: (text: string, at: string): Json => ({ type: "queue-operation", operation: "enqueue", timestamp: at, sessionId: session, content: text }),
    lastPrompt: (text: string): Json => ({ type: "last-prompt", sessionId: session, lastPrompt: text }),
    customTitle: (text: string): Json => ({ type: "custom-title", sessionId: session, customTitle: text }),
    aiTitle: (text: string): Json => ({ type: "ai-title", sessionId: session, aiTitle: text }),
    bridge: (): Json => ({ type: "bridge-session", sessionId: session, accountUuid: "fixture-account", organizationUuid: "fixture-organisation" }),
  };
}

/** Write `<home>/projects/<encoded start dir>/<session>.jsonl`, one record per line. Returns the file. */
export function writeTranscript(home: ClaudeHome, session: string, startDir: string, lines: readonly Json[]): string {
  const dir = path.join(home.projects, projectFolder(startDir));
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${session}.jsonl`);
  writeFileSync(file, lines.map((l) => `${JSON.stringify(l)}\n`).join(""), "utf8");
  return file;
}

export function appendRecords(file: string, lines: readonly Json[]): void {
  appendFileSync(file, lines.map((l) => `${JSON.stringify(l)}\n`).join(""), "utf8");
}

/** The side folder a session leaves where it changed directory: `<session>/workflows/`, and no transcript. */
export function writeDecoy(home: ClaudeHome, session: string, dir: string): string {
  const folder = path.join(home.projects, projectFolder(dir), session, "workflows");
  mkdirSync(folder, { recursive: true });
  writeFileSync(path.join(folder, "state.json"), "{}\n", "utf8");
  return folder;
}

/*
 * One invented example of each shape the redactor withholds. Every value is assembled at run time
 * from invented parts, so no string in this file is, or looks to a scanner like, a real credential.
 */
const join = (...parts: string[]): string => parts.join("");
const letters = "abcdefghijklmnopqrstuvwxyz";
const mixed = "Ab3dEf6hIj9lMn2pQr5tUv8xYz1bCd4fGh7jKl0mNo4pQr6s";

export const SECRET_SHAPES: { name: string; value: string }[] = [
  { name: "an sk- key", value: join("sk-", "ant-api03-", letters, "0123456789") },
  { name: "a ghp_ token", value: join("ghp_", letters, "0123456789") },
  { name: "a github_pat_ token", value: join("github_pat_", "11ABCDEFG0", letters) },
  { name: "an xox token", value: join("xoxb-", "1234567890-", "abcdefghijkl") },
  { name: "an AKIA key id", value: join("AKIA", "ABCDEFGHIJKLMNOP") },
  { name: "an AIza key", value: join("AIza", "SyA1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q") },
  { name: "a PEM block", value: join("-----BEGIN RSA PRIVATE KEY-----\n", "MIIEinventedinventedinvented\n", "morelinesofinventedkey\n", "-----END RSA PRIVATE KEY-----") },
  { name: "a JWT-shaped triple", value: join("eyJ", "hbGciOiJIUzI1NiJ9", ".", "eyJzdWIiOiJpbnZlbnRlZCJ9", ".", "c2lnbmF0dXJlLWludmVudGVk") },
  { name: "a Bearer value", value: join("Bearer ", "abc123def456ghi789") },
  { name: "an API_KEY assignment", value: join("API_KEY=", "inventedvalue123") },
  { name: "a password field", value: join("password: ", "hunter2invented") },
  { name: "a 48-character mixed run", value: mixed },
  { name: "an email address", value: join("someone", "@", "example.com") },
  { name: "a /Users path", value: "/Users/someone/Desktop/My Projects/repo/.worktree/thing" },
  { name: "a home-relative path", value: "~/notes/private/plan.md" },
];
