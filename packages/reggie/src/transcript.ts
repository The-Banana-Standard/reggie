import { closeSync, openSync, readdirSync, readSync, realpathSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";

/*
 * Reading a Claude Code transcript, and every rule about what may be taken from one.
 *
 * A transcript is somebody's private conversation: the owner's prompts, every tool result, file
 * contents, reasoning, account ids. This module exists so that exactly one place decides what Reggie
 * understands of it, and the answer is seven fields: a record's `type`, `isSidechain`, `timestamp`
 * and `cwd`, its `message.stop_reason`, and the `type` and `text` of each block in `message.content`.
 * Text is copied out of one kind of record only, the assistant's closing message of a turn
 * (`type: assistant`, not a sidechain, `stop_reason: end_turn`, `text` blocks). Nothing in a `user`
 * record (prompts, tool results, the compaction summary), no `thinking` or `tool_use` block, no
 * interim text, and no `attachment`, `queue-operation`, `last-prompt`, title or `bridge-session`
 * record is ever read into a value that leaves this file. Subagent files and the `tool-results`
 * folder beside a transcript are never opened.
 *
 * The file is found by its session id and never by encoding the start directory: the folder name is a
 * lossy encoding (a slash, a space and a dot all become a dash), while the id names the file exactly.
 * It is read in bounded chunks with a ceiling per line, because the largest real line measured was
 * 13 MB of tool result and none that held closing text was over 74 KB.
 */

const SESSION_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** The one stop reason that marks the closing message of a turn. */
export const CLOSING_STOP_REASON = "end_turn";

export const DEFAULT_CHUNK_BYTES = 64 * 1024;
/** A line longer than this is dropped without being assembled. */
export const MAX_LINE_BYTES = 1024 * 1024;
/** How far ahead of the clock a timestamp may sit and still be trusted: a little, for clock skew. */
export const FUTURE_SKEW_MS = 25 * 60 * 60 * 1000;

/**
 * A session id in the only shape Reggie will build a path from, lowercased; null for anything else.
 * `session`, an empty string, `../x` and a UUID with a trailing slash are all null, so a placeholder or
 * a hostile value in a claim, a launch record, a file name or a flag never reaches the filesystem.
 */
export function sessionIdOf(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const id = value.toLowerCase();
  return SESSION_ID_RE.test(id) ? id : null;
}

/**
 * Where Claude Code keeps its state: `CLAUDE_CONFIG_DIR` when set, else `.claude` under the home
 * directory. Only the CLI calls this. The library functions take the directory as a required argument,
 * so no test can reach a real home without naming it.
 */
export function defaultClaudeHome(env: NodeJS.ProcessEnv = process.env): string {
  const configured = env.CLAUDE_CONFIG_DIR?.trim();
  return configured ? path.resolve(configured) : path.join(os.homedir(), ".claude");
}

/**
 * The transcript for a session id: the file `<id>.jsonl` in whichever folder under `projects/` holds
 * it, or null. A `<id>/` folder (the `workflows`, `subagents` and `tool-results` side data a session
 * leaves behind) is not a transcript and is never entered. Throws for an id that is not a session id.
 */
export function findTranscript(claudeHome: string, sessionId: string): string | null {
  const id = sessionIdOf(sessionId);
  if (id === null) throw new Error("that is not a session id; a session id is a UUID");
  const projects = path.join(claudeHome, "projects");
  let folders: string[];
  try {
    folders = readdirSync(projects, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
      .sort();
  } catch {
    return null;
  }
  for (const folder of folders) {
    const file = path.join(projects, folder, `${id}.jsonl`);
    try {
      if (statSync(file).isFile()) return file;
    } catch {
      /* not in this folder */
    }
  }
  return null;
}

export interface LineReadOptions {
  chunkBytes?: number;
  maxLineBytes?: number;
}

export interface LineReadStats {
  bytes: number;
  /** Lines seen, oversized ones included. A last line with no newline after it counts. */
  lines: number;
  /** Lines longer than the ceiling. They were never assembled and never handed to the callback. */
  oversized: number;
}

/**
 * Call `onLine` with each line of a file as the bytes it holds, newline excluded, reading a fixed-size
 * chunk at a time and never the whole file. A line is assembled from its chunks before it is decoded,
 * so a multi-byte character that straddles a chunk boundary arrives intact. Synchronous on purpose:
 * every caller is a CLI verb, and the measured cost on a 39 MB transcript was about a tenth of a second.
 */
export function readLines(file: string, onLine: (line: Buffer) => void, opts: LineReadOptions = {}): LineReadStats {
  const chunkBytes = Math.max(1, opts.chunkBytes ?? DEFAULT_CHUNK_BYTES);
  const maxLineBytes = Math.max(1, opts.maxLineBytes ?? MAX_LINE_BYTES);
  const stats: LineReadStats = { bytes: 0, lines: 0, oversized: 0 };
  const buf = Buffer.allocUnsafe(chunkBytes);
  let parts: Buffer[] = [];
  let length = 0;
  let over = false;
  let pending = false;

  const take = (from: number, to: number): void => {
    if (to <= from) return;
    pending = true;
    if (over) return;
    length += to - from;
    if (length > maxLineBytes) {
      over = true;
      parts = [];
      return;
    }
    // A copy, because the chunk buffer is overwritten by the next read.
    parts.push(Buffer.from(buf.subarray(from, to)));
  };
  const flush = (): void => {
    stats.lines += 1;
    if (over) stats.oversized += 1;
    else onLine(parts.length === 1 && parts[0] ? parts[0] : Buffer.concat(parts, length));
    parts = [];
    length = 0;
    over = false;
    pending = false;
  };

  const fd = openSync(file, "r");
  try {
    for (;;) {
      const n = readSync(fd, buf, 0, chunkBytes, null);
      if (n <= 0) break;
      stats.bytes += n;
      let start = 0;
      for (let i = 0; i < n; i += 1) {
        if (buf[i] !== 10) continue;
        take(start, i);
        flush();
        start = i + 1;
      }
      take(start, n);
    }
    if (pending) flush();
  } finally {
    closeSync(fd);
  }
  return stats;
}

/** One transcript line, reduced to the fields Reggie understands. Nothing else of the line is kept. */
export interface TranscriptRecord {
  type: string;
  sidechain: boolean;
  /** The record's timestamp as epoch milliseconds; null when it has none that parses. */
  at: number | null;
  cwd: string | null;
  /** `message.stop_reason`, read on assistant records only. */
  stopReason: string | null;
  /**
   * The text blocks of a closing message, joined. Set only when the record is an assistant record,
   * not a sidechain, with `stop_reason: end_turn` and at least one non-empty text block; null on every
   * other record, whatever text that record holds.
   */
  closing: string | null;
}

function str(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

/** Null for a line that is not a JSON object with a string `type`. */
export function parseRecord(line: string): TranscriptRecord | null {
  let data: unknown;
  try {
    data = JSON.parse(line);
  } catch {
    return null;
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  const d = data as Record<string, unknown>;
  const type = str(d.type);
  if (type === null) return null;
  // Anything but a plain false or absent flag counts as a sidechain, so "true", 1 or a present object
  // is never mistaken for the main conversation and read as eligible.
  const sidechain = d.isSidechain !== undefined && d.isSidechain !== null && d.isSidechain !== false && d.isSidechain !== 0 && d.isSidechain !== "false";
  const ms = Date.parse(str(d.timestamp) ?? "");
  // A timestamp far in the future is a wrong clock, not a real instant; drop it so one such record
  // cannot set a watermark past every later message or file an entry under a year that has not come.
  const at = Number.isFinite(ms) && ms <= Date.now() + FUTURE_SKEW_MS ? ms : null;
  const record: TranscriptRecord = { type, sidechain, at, cwd: str(d.cwd), stopReason: null, closing: null };
  // The message is opened for one kind of record only. A user record's message is the owner's prompt
  // or a tool result, and is not looked at, not even to be discarded.
  if (type !== "assistant" || sidechain) return record;
  const message = d.message;
  if (!message || typeof message !== "object") return record;
  const m = message as Record<string, unknown>;
  record.stopReason = str(m.stop_reason);
  if (record.stopReason !== CLOSING_STOP_REASON || !Array.isArray(m.content)) return record;
  const texts: string[] = [];
  for (const block of m.content) {
    if (!block || typeof block !== "object") continue;
    const b = block as Record<string, unknown>;
    if (b.type === "text" && typeof b.text === "string" && b.text.trim() !== "") texts.push(b.text);
  }
  if (texts.length > 0) record.closing = texts.join("\n\n");
  return record;
}

export interface TranscriptStats extends LineReadStats {
  /** Lines that were read and are not a record: damaged, cut off mid-object, or not an object. */
  unparseable: number;
  records: number;
}

export interface Transcript {
  records: TranscriptRecord[];
  stats: TranscriptStats;
}

/**
 * Every record of a transcript file, in file order, which is not time order: compare `at`, never
 * position. Each line is decoded as UTF-8 with replacement, so damaged bytes cost one character and
 * not the line. A line that is oversized or does not parse is counted and skipped; an unfinished last
 * line is simply one more that does not parse, and is read properly on a later run.
 */
export function readTranscript(file: string, opts: LineReadOptions = {}): Transcript {
  const records: TranscriptRecord[] = [];
  let unparseable = 0;
  const lineStats = readLines(
    file,
    (line) => {
      const text = line.toString("utf8");
      if (text.trim() === "") return;
      const record = parseRecord(text);
      if (record) records.push(record);
      else unparseable += 1;
    },
    opts,
  );
  return { records, stats: { ...lineStats, unparseable, records: records.length } };
}

/**
 * `dir` itself or anything under it, compared as text so a directory that no longer exists still
 * matches. An empty or relative candidate is never inside: it would otherwise resolve against the
 * process's own directory and a record with `cwd: ""` or `"."` would be read as inside the repository.
 */
export function isInsideDir(dir: string, candidate: string): boolean {
  if (!path.isAbsolute(candidate)) return false;
  const base = path.resolve(dir);
  const target = path.resolve(candidate);
  return target === base || target.startsWith(base + path.sep);
}

/** A directory and, when it resolves to something else (macOS keeps temp directories behind a link), that too. */
export function dirSpellings(dir: string): string[] {
  const resolved = path.resolve(dir);
  try {
    const real = realpathSync(resolved);
    return real === resolved ? [resolved] : [resolved, real];
  } catch {
    return [resolved];
  }
}

export interface LocationRule {
  /** The repository the entry is for, task worktrees under `.worktree/` included. */
  repoDirs: string[];
  /** The slug's own worktree, whether or not it still exists. */
  worktreeDirs: string[];
}

export interface RecordSelection {
  /** The main-conversation records that count for this task. */
  counted: TranscriptRecord[];
  /** Whether any record of the session was inside the repository at all. */
  insideRepo: boolean;
  /** True when the session worked in the slug's own worktree, so only those records count. */
  narrowed: boolean;
}

/**
 * Which records count for a task. A record counts only when its `cwd` is inside the repository and not
 * inside another task's worktree under `.worktree/`; and once any record of the session is inside the
 * slug's own worktree, only records inside that worktree count. One session often works in several
 * task worktrees (a session that shaped this slug at the root can then go and build a different task),
 * and another task's closing words are not this task's story.
 */
export function selectRecords(records: readonly TranscriptRecord[], rule: LocationRule): RecordSelection {
  const within = (dirs: readonly string[], r: TranscriptRecord): boolean => r.cwd !== null && dirs.some((d) => isInsideDir(d, r.cwd ?? ""));
  const worktreeRoots = rule.repoDirs.map((d) => path.join(d, ".worktree"));
  const inMine = (r: TranscriptRecord): boolean => within(rule.worktreeDirs, r);
  // A record inside some `.worktree/` but not the slug's own belongs to another task.
  const inOtherWorktree = (r: TranscriptRecord): boolean => r.cwd !== null && worktreeRoots.some((wr) => isInsideDir(wr, r.cwd ?? "")) && !inMine(r);
  const eligible = records.filter((r) => !r.sidechain && within(rule.repoDirs, r) && !inOtherWorktree(r));
  const inWorktree = eligible.filter(inMine);
  const narrowed = inWorktree.length > 0;
  return { counted: narrowed ? inWorktree : eligible, insideRepo: eligible.length > 0, narrowed };
}

/** Closing messages later than `afterMs`, oldest first. A record with no readable timestamp cannot be placed and is left out. */
export function closingMessages(counted: readonly TranscriptRecord[], afterMs: number | null): TranscriptRecord[] {
  return counted
    .filter((r) => r.closing !== null && r.at !== null && (afterMs === null || r.at > afterMs))
    .sort((a, b) => (a.at ?? 0) - (b.at ?? 0));
}

/** First and last timestamp of the main conversation, wherever it was working; null when no record is dated. */
export function sessionSpan(records: readonly TranscriptRecord[]): { start: number; end: number } | null {
  let start = Infinity;
  let end = -Infinity;
  for (const r of records) {
    if (r.sidechain || r.at === null) continue;
    if (r.at < start) start = r.at;
    if (r.at > end) end = r.at;
  }
  return Number.isFinite(start) ? { start, end } : null;
}
