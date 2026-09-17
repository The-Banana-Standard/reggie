import { existsSync, readdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { commandExists, currentBranch, defaultBranch, fileAtRef, git, run } from "./git.js";
import { historyLogArgs, isMerge, parseNumstatLog, taskLanding, type LogCommit } from "./history.js";
import { appendJournal, formatJournalEntry, journalFile, parseJournalFile, readJournal, sessionName, type AppendJournalInput, type DerivedMark } from "./journal.js";
import { readLaunches, type LaunchGoal } from "./launch.js";
import { briefRelPath, claimFile, claimRelPath, planRelPath, REGGIE_DIR, TASKS_REL_DIR, type RepoPaths } from "./paths.js";
import { handleFor, type Person, type ReggieConfig } from "./people.js";
import { cleanText, MAX_QUOTE_CHARS } from "./redact.js";
import { getTask, knownSlugs, parseClaim, type ClaimInfo, type TaskInfo } from "./tasks.js";
import { closingMessages, dirSpellings, findTranscript, readTranscript, selectRecords, sessionIdOf, sessionSpan, type TranscriptRecord, type TranscriptStats } from "./transcript.js";
import { clock, isSafeSlug, readText, relPosix, slugify, today, uniq } from "./util.js";

/*
 * `reggie journal derive <slug>`: a journal entry written from what is already on disk.
 *
 * Two inputs. The task's commits, from the live branch or, once that is gone, from the merge that
 * landed it. And the closing words of each Claude session Reggie can tie to the task by a recorded
 * session id: the launch log, a UUID in the claim, a day file named by a session, or `--session`.
 * No session is ever guessed by directory or time, and a Codex launch is named as unread.
 *
 * One entry per session that has something new, plus one entry for commits no session's span holds.
 * What "new" means is read back from the entries themselves: each ends in a `derived:` line naming
 * its session, the instant it read through and the commits it told, so a second run with nothing new
 * writes nothing, from any checkout that can see the first run's entry.
 *
 * The verb appends and reports. It never commits and never pushes; the uncommitted file and the
 * printed text are the review point for words that came out of a private conversation. Everything
 * about what may be read from a transcript lives in transcript.ts, and everything about what may be
 * written from it in redact.ts.
 */

/** A refusal: the verb exits 1 and nothing was written. */
export class DeriveError extends Error {
  /** The content-free summary of what was read before the refusal, when anything was. */
  summary: string | null = null;
}

// The sentences an entry carries when there is nothing of the session's own to quote. Exported so a
// test, and a reviewer, can check the exact words.
export const SENTENCE_NO_SESSION = "No session was recorded for this task, so this entry is drawn from the commits alone.";
export const SENTENCE_NO_TRANSCRIPT = "A session was recorded for this task, but its transcript was not found on this machine, so this entry is drawn from the commits alone.";
export const SENTENCE_OTHER_MACHINE = "A session was recorded for this task, but the claim was made on a machine by another name and the transcript is not on this one, so the session ran elsewhere and this entry is drawn from the commits alone.";
export const SENTENCE_CODEX_UNREAD = "A Codex session was launched for this task; Reggie does not read Codex transcripts yet, so nothing from it is here.";
export const SENTENCE_OUTSIDE_SESSIONS = "These commits fall outside every session found for the task, so nothing is quoted with them.";
export const SENTENCE_NO_CLOSING_WORDS = "The session left no closing message in this stretch, so there is nothing of its own to quote.";
export const SENTENCE_ENDED_ON_TOOLS = "The session's latest turn ended on tool calls with no closing words, so there is nothing of its own to quote.";

/** The fixed instruction the opt-in rewrite sends, followed by the template body and nothing else. */
export const REWRITE_INSTRUCTION =
  "Rewrite the journal entry below as two to five plain sentences that a person could listen to. Keep every fact, every number and every quoted phrase exactly as it is, add nothing that is not in it, and use no Markdown, no lists, no headings and no file paths. Reply with the rewritten entry and nothing else.";
/** The session's own tool, with nothing to act with: no tools, no saved session, no MCP servers. Read from `claude --help` on 2.1.261. */
export const REWRITE_ARGV: readonly string[] = ["claude", "-p", "--tools", "", "--no-session-persistence", "--strict-mcp-config"];
export const REWRITE_TIMEOUT_MS = 120_000;
/** A reply longer than this is treated as a failure rather than cut: it is not a rewrite of one entry. */
export const MAX_REPLY_CHARS = 20_000;
/** The longest body a rewrite may leave behind. */
export const MAX_REWRITE_CHARS = 2_000;
const MAX_SUBJECT_CHARS = 140;
const MAX_SUBJECTS = 5;
const MAX_EVIDENCE_FILES = 8;
/** Far enough back to mean every entry ever written. */
const ALL_DAYS = 36_500;

export interface RewriteRequest {
  argv: string[];
  /** Standard input: the instruction, a blank line, the template body. */
  input: string;
  cwd: string;
  timeoutMs: number;
}

export type RewriteReply = { ok: true; text: string } | { ok: false; reason: string };
export type RewriteRunner = (req: RewriteRequest) => RewriteReply;

/**
 * The runner that really starts the tool. Only the CLI builds it; `deriveJournal` has no default. It
 * refuses to run under vitest, so no test can make the call by accident, and it has never been run by
 * a build session either: headless `claude -p` is denied there. Unverified until the owner runs it.
 */
export function realRewriteRunner(): RewriteRunner {
  return (req) => {
    if (process.env.VITEST) throw new Error("the real rewrite runner must never run inside the test suite");
    const [cmd = "", ...args] = req.argv;
    if (!commandExists(cmd)) return { ok: false, reason: `${cmd} is not installed or not on PATH` };
    const r = run(cmd, args, { cwd: req.cwd, input: req.input, timeoutMs: req.timeoutMs, allowFailure: true, maxBufferBytes: 256 * 1024 });
    if (r.timedOut) return { ok: false, reason: `${cmd} did not answer within ${Math.round(req.timeoutMs / 1000)} seconds` };
    if (!r.ok) return { ok: false, reason: `${cmd} exited with ${r.status ?? "no status"}` };
    return { ok: true, text: r.stdout };
  };
}

export interface DeriveInput {
  slug: string;
  /** Where Claude Code keeps its state. Required: the CLI supplies the default, a test supplies a temp directory. */
  claudeHome: string;
  /** Whoever is running the verb; the entry is theirs when the task has no claim. */
  person: Person;
  /** `--session`: one more session id to read, which must have worked inside this repository. */
  session?: string;
  dryRun?: boolean;
  rewrite?: boolean;
  runner?: RewriteRunner;
  /** This machine's name, compared with the claim's; default `os.hostname()`. */
  host?: string;
  env?: NodeJS.ProcessEnv;
}

export type SessionSource = "launch" | "claim" | "journal" | "flag";
export type DerivedStage = "triage" | "plan" | "discuss" | "execute" | "session" | "commits";

export interface SessionReport {
  id: string;
  sources: SessionSource[];
  goal: LaunchGoal | null;
  status: "read" | "not-found";
  stats: TranscriptStats | null;
  /** Closing messages newer than the last entry for this session. */
  eligible: number;
}

export interface DerivedEntry {
  kind: "session" | "commits";
  session: string | null;
  /** Repo-relative path of the day file. */
  file: string;
  /** Header, body, evidence line and mark, exactly as appended. */
  block: string;
  text: string;
  person: string;
  tool: "claude" | "reggie";
  stage: DerivedStage;
  date: string;
  time: string;
  evidence: string[];
  mark: DerivedMark;
  quotedChars: number;
  withheld: number;
  written: boolean;
}

export interface DeriveResult {
  slug: string;
  dryRun: boolean;
  entries: DerivedEntry[];
  sessions: SessionReport[];
  /** Codex launches recorded for the task. They have no id, so they are reported and never read. */
  codexUnread: number;
  /** What the verb says instead of an entry, when it wrote none. */
  message: string | null;
  /** Why a rewrite that was asked for did not happen, one line per entry. */
  notes: string[];
  withheld: number;
  /** One line with counts and nothing from any conversation; the verb's last line of output. */
  summary: string;
}

interface SessionRef {
  id: string;
  sources: SessionSource[];
  goal: LaunchGoal | null;
}

interface SessionRead extends SessionRef {
  span: { start: number; end: number };
  counted: TranscriptRecord[];
  /** The instant the last entry for this session read through; null when there is none. */
  through: number | null;
  closing: TranscriptRecord[];
  commits: LogCommit[];
}

interface Draft {
  kind: "session" | "commits";
  session: string | null;
  stage: DerivedStage;
  endMs: number;
  body: string;
  evidence: string[];
  mark: DerivedMark;
  quotedChars: number;
  withheld: number;
}

const NUMBER_WORDS = ["no", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve"];
const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

function countWord(n: number): string {
  return NUMBER_WORDS[n] ?? String(n);
}

function plural(n: number, one: string, many: string = `${one}s`): string {
  return `${countWord(n)} ${n === 1 ? one : many}`;
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** "Tuesday 15 September", in local time like every other journal date. */
function dayName(d: Date): string {
  return `${DAY_NAMES[d.getDay()] ?? ""} ${d.getDate()} ${MONTH_NAMES[d.getMonth()] ?? ""}`.trim();
}

/** The entry's closing sentence when anything was withheld. Exported so the verb's count and the entry's can be compared. */
export function withheldSentence(n: number): string {
  return `${capitalize(plural(n, "passage"))} ${n === 1 ? "was" : "were"} withheld because ${n === 1 ? "it" : "they"} looked like a secret, an address or a local path.`;
}

const STAGE_BY_GOAL: Record<LaunchGoal, DerivedStage> = { shape: "triage", plan: "plan", discuss: "discuss", build: "execute" };

/** Commits that already have an entry of their own (claim, decide) are never told a second time. */
function isBookkeeping(c: LogCommit): boolean {
  return isMerge(c) || /^meta: claim /.test(c.subject) || /^decide: /.test(c.subject);
}

const sha12 = (c: LogCommit): string => c.sha.slice(0, 12);

// Loops, not `Math.max(...list)`: a long transcript has more records than a call may have arguments.
const latestOf = (values: number[]): number => values.reduce((a, b) => (b > a ? b : a), -Infinity);
const earliestOf = (values: number[]): number => values.reduce((a, b) => (b < a ? b : a), Infinity);

function commitMs(c: LogCommit): number {
  const ms = Date.parse(c.date);
  return Number.isFinite(ms) ? ms : 0;
}

/**
 * Where the repository is, for deciding which transcript records count. Run from a task worktree
 * Reggie made (`<parent>/.worktree/<slug>`), the repository is the parent: launches are recorded there,
 * and a planning session for the same task worked there.
 */
function repoHome(root: string, slug: string): { repoDir: string; cacheRoots: string[] } {
  const inTaskWorktree = path.basename(root) === slug && path.basename(path.dirname(root)) === ".worktree";
  const parent = inTaskWorktree ? path.dirname(path.dirname(root)) : null;
  const repoDir = parent && existsSync(path.join(parent, REGGIE_DIR)) ? parent : root;
  return { repoDir, cacheRoots: uniq([root, repoDir]) };
}

/** The claim from the working tree, else from the task branch. A landed task's claim arrived with the merge. */
function readClaim(paths: RepoPaths, slug: string, branchRef: string | null): ClaimInfo | null {
  const content = readText(claimFile(paths, slug)) ?? (branchRef ? fileAtRef(paths.root, branchRef, claimRelPath(slug)) : null);
  return content ? parseClaim(content) : null;
}

/** A handle that is safe as part of a file name and of an entry header, whatever a claim on a fetched branch says. */
function entryPerson(claim: ClaimInfo | null, runner: Person): string {
  if (!claim) return runner.handle;
  if (/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(claim.handle) && !claim.handle.includes("..")) return claim.handle;
  return claim.person || claim.email ? handleFor(claim.person, claim.email) : slugify(claim.handle || runner.handle, 40);
}

/** Marks of every derived entry for the slug in the named journal files at a ref. */
function marksAtRef(root: string, slug: string, from: string, to: string): DerivedMark[] {
  const changed = git(["diff", "--name-only", `${from}...${to}`, "--", `${REGGIE_DIR}/journal`], { cwd: root, allowFailure: true });
  if (!changed.ok) return [];
  const marks: DerivedMark[] = [];
  for (const file of changed.stdout.split("\n").map((l) => l.trim()).filter((l) => l.endsWith(".md"))) {
    const content = fileAtRef(root, to, file);
    if (content === null) continue;
    for (const e of parseJournalFile(file, path.basename(path.dirname(file)), content)) if (e.slug === slug && e.derived) marks.push(e.derived);
  }
  return marks;
}

/**
 * What earlier runs already said: the working tree's entries, the journal files the task branch
 * changed, and, from a checkout that is not on the base, the ones the base gained since. The last is
 * what stops a session in a task worktree repeating an entry the owner derived in the serving checkout.
 */
function collectMarks(paths: RepoPaths, slug: string, base: string, branchRef: string | null): DerivedMark[] {
  const marks = readJournal(paths, { slug, days: ALL_DAYS }).flatMap((e) => (e.derived ? [e.derived] : []));
  if (branchRef) marks.push(...marksAtRef(paths.root, slug, base, branchRef));
  if (currentBranch(paths.root) !== base) marks.push(...marksAtRef(paths.root, slug, "HEAD", base));
  return marks;
}

/** Session ids named by journal day files (`<person>-<uuid>.md`) that hold an entry for the slug. */
function sessionsFromJournal(paths: RepoPaths, slug: string): string[] {
  if (!existsSync(paths.journal)) return [];
  const ids: string[] = [];
  for (const day of readdirSync(paths.journal).sort()) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) continue;
    for (const name of readdirSync(path.join(paths.journal, day)).sort()) {
      const id = sessionIdOf(/-([0-9a-fA-F-]{36})\.md$/.exec(name)?.[1]);
      if (id === null) continue;
      const file = path.join(paths.journal, day, name);
      if (parseJournalFile(file, day, readText(file) ?? "").some((e) => e.slug === slug)) ids.push(id);
    }
  }
  return ids;
}

/**
 * The sessions for a slug, without duplicates, from the four places an id can be recorded, in order:
 * the launch log, the claim, the journal's file names, the flag. Anything that is not a session id
 * (the word `session`, an empty field, a path) is dropped here, before a path is ever built from it.
 */
function collectSessions(paths: RepoPaths, slug: string, cacheRoots: string[], claim: ClaimInfo | null, flag: string | null): { refs: SessionRef[]; codexUnread: number } {
  const refs = new Map<string, SessionRef>();
  const add = (value: unknown, source: SessionSource, goal: LaunchGoal | null): void => {
    const id = sessionIdOf(value);
    if (id === null) return;
    const seen = refs.get(id);
    if (!seen) refs.set(id, { id, sources: [source], goal });
    else if (!seen.sources.includes(source)) seen.sources.push(source);
  };
  let codexUnread = 0;
  for (const root of cacheRoots) {
    for (const launch of readLaunches(root, slug)) {
      if (launch.tool === "codex") codexUnread += 1;
      else add(launch.session, "launch", launch.goal);
    }
  }
  // A claim is only ever made to build.
  add(claim?.session, "claim", "build");
  for (const id of sessionsFromJournal(paths, slug)) add(id, "journal", null);
  add(flag, "flag", null);
  return { refs: Array.from(refs.values()), codexUnread };
}

/** The commits derive narrates, oldest first: the live branch against the base, else what the landing lookup finds. */
function taskCommits(root: string, slug: string, base: string, task: TaskInfo): LogCommit[] {
  let commits: LogCommit[];
  if (task.branchRef) {
    const r = git(historyLogArgs([`${base}..${task.branchRef}`]), { cwd: root, allowFailure: true });
    commits = r.ok ? parseNumstatLog(r.stdout) : [];
  } else {
    commits = taskLanding(root, slug, { base }).commits;
  }
  return commits.filter((c) => !isBookkeeping(c)).sort((a, b) => commitMs(a) - commitMs(b));
}

function timeSpan(startMs: number, endMs: number): string {
  const start = new Date(startMs);
  const end = new Date(endMs);
  if (today(start) !== today(end)) return `Between ${clock(start)} on ${dayName(start)} and ${clock(end)} on ${dayName(end)}`;
  if (clock(start) === clock(end)) return `At ${clock(start)} on ${dayName(start)}`;
  return `Between ${clock(start)} and ${clock(end)} on ${dayName(start)}`;
}

/** How many commits over which stretch changed how many files, with up to five subjects quoted. No commit id, no path. */
function commitsSentence(commits: LogCommit[]): { text: string; withheld: number } {
  const first = commits[0];
  const last = commits[commits.length - 1];
  if (!first || !last) return { text: "", withheld: 0 };
  const files = new Set(commits.flatMap((c) => c.files.map((f) => f.path))).size;
  let withheld = 0;
  const subjects = commits.slice(0, MAX_SUBJECTS).map((c) => {
    const clean = cleanText(c.subject, MAX_SUBJECT_CHARS);
    withheld += clean.withheld;
    return `“${clean.text}”`;
  });
  const more = commits.length - subjects.length;
  const list = `${subjects.join(", ")}${more > 0 ? `, and ${countWord(more)} more` : ""}`;
  return { text: `${timeSpan(commitMs(first), commitMs(last))}, ${plural(commits.length, "commit")} changed ${plural(files, "file")}: ${list}.`, withheld };
}

/** The one transition a session's goal produces, read from the task's state now and not from the conversation. */
function transitionSentence(goal: LaunchGoal | null, task: TaskInfo): string {
  switch (goal) {
    case "shape":
      return task.brief?.exists && task.state !== "ungroomed" ? "The brief is written, so the task reads as groomed." : "The brief is not filled in yet, so the task still reads as ungroomed.";
    case "plan":
      if (task.planLintOk) return "A plan that passes the contract is in place.";
      return task.planExists ? "A plan draft exists and does not pass the contract yet." : "No plan has been written yet.";
    case "build":
      return task.packetExists ? "The completion packet is written." : "No completion packet has been written yet.";
    default:
      return "";
  }
}

/** Repo-relative files under the task's own folder that the commits touched: the packet first, then up to eight evidence files. */
function evidenceFor(slug: string, commits: LogCommit[]): string[] {
  const prefix = `${TASKS_REL_DIR}/${slug}/`;
  const touched = uniq(commits.flatMap((c) => c.files.map((f) => f.path))).filter((p) => p.startsWith(prefix) && /^[A-Za-z0-9._/-]+$/.test(p) && !p.includes(".."));
  const packet = touched.filter((p) => p === `${prefix}packet.md`);
  const evidence = touched.filter((p) => p.startsWith(`${prefix}evidence/`)).sort();
  return [...packet, ...evidence.slice(0, MAX_EVIDENCE_FILES)];
}

function sessionDraft(slug: string, s: SessionRead, task: TaskInfo, root: string): Draft {
  const parts: string[] = [];
  let withheld = 0;
  let quotedChars = 0;
  const newest = s.closing[s.closing.length - 1] ?? null;
  parts.push(
    s.commits.length > 0
      ? "Reggie wrote this entry from the task's commits and the closing words of the Claude session that worked on it."
      : "Reggie wrote this entry from the closing words of a Claude session that worked on the task; the session made no new commits.",
  );

  const told = commitsSentence(s.commits);
  if (told.text) parts.push(told.text);
  withheld += told.withheld;

  // What the entry covers: from the first thing the session did after the last entry, to the last
  // closing message or commit. It is dated at the end, and says so when that is another day.
  const after = s.through;
  const moments = [...s.closing.map((r) => r.at ?? 0), ...s.commits.map(commitMs)];
  const endMs = latestOf(moments);
  const startMs = Math.min(endMs, earliestOf(moments), earliestOf(s.counted.flatMap((r) => (r.at !== null && (after === null || r.at > after) ? [r.at] : []))));
  const firstCommit = s.commits[0];
  const lastCommit = s.commits[s.commits.length - 1];
  const commitsCrossDays = firstCommit !== undefined && lastCommit !== undefined && today(new Date(commitMs(firstCommit))) !== today(new Date(commitMs(lastCommit)));
  if (today(new Date(startMs)) !== today(new Date(endMs)) && !commitsCrossDays) parts.push(`The stretch this entry covers ran from ${dayName(new Date(startMs))} into ${dayName(new Date(endMs))}.`);

  const transition = transitionSentence(s.goal, task);
  if (transition) parts.push(transition);

  if (newest?.closing) {
    const quote = cleanText(newest.closing, MAX_QUOTE_CHARS);
    withheld += quote.withheld;
    if (quote.text) {
      quotedChars = Array.from(quote.text).length;
      parts.push(`The session closed by saying: “${quote.text}”`);
      if (quote.cut) parts.push("The message ran longer than this and is cut here.");
    } else {
      parts.push(SENTENCE_NO_CLOSING_WORDS);
    }
    const others = s.closing.length - 1;
    if (others > 0) parts.push(`It was the last of ${plural(s.closing.length, "closing message")} in this stretch; the other ${others === 1 ? "one is" : `${countWord(others)} are`} not quoted.`);
  } else {
    const assistants = s.counted.filter((r) => r.type === "assistant" && r.at !== null && (after === null || r.at > after));
    const latest = assistants.reduce<TranscriptRecord | null>((a, b) => (a === null || (b.at ?? 0) > (a.at ?? 0) ? b : a), null);
    parts.push(latest?.stopReason === "tool_use" ? SENTENCE_ENDED_ON_TOOLS : SENTENCE_NO_CLOSING_WORDS);
  }
  if (withheld > 0) parts.push(withheldSentence(withheld));

  const throughMs = Math.max(s.through ?? -Infinity, latestOf(closingMessages(s.counted, null).map((r) => r.at ?? -Infinity)));
  let evidence = evidenceFor(slug, s.commits);
  if (s.commits.length === 0) {
    const doc = s.goal === "shape" ? briefRelPath(slug) : s.goal === "plan" ? planRelPath(slug) : null;
    evidence = doc && existsSync(path.join(root, doc)) ? [doc] : [];
  }
  return {
    kind: "session",
    session: s.id,
    stage: s.goal ? STAGE_BY_GOAL[s.goal] : "session",
    endMs,
    body: parts.join(" "),
    evidence,
    mark: { session: s.id, through: Number.isFinite(throughMs) ? new Date(throughMs).toISOString() : null, commits: s.commits.map(sha12), prose: "template" },
    quotedChars,
    withheld,
  };
}

function commitsDraft(slug: string, commits: LogCommit[], reasons: string[]): Draft {
  const told = commitsSentence(commits);
  const parts = ["Reggie wrote this entry from the task's commits alone.", told.text, ...reasons];
  if (told.withheld > 0) parts.push(withheldSentence(told.withheld));
  return {
    kind: "commits",
    session: null,
    stage: "commits",
    endMs: latestOf(commits.map(commitMs)),
    body: parts.filter(Boolean).join(" "),
    evidence: evidenceFor(slug, commits),
    mark: { session: null, through: null, commits: commits.map(sha12), prose: "template" },
    quotedChars: 0,
    withheld: told.withheld,
  };
}

/**
 * One headless call over a draft, when asked. What is sent is the fixed instruction and exactly the
 * body that would otherwise have been written, already flattened, redacted and cut: the call sees
 * nothing that was not already bound for git. The reply goes through the same passes. Any failure
 * keeps the template and says why.
 */
function rewriteDraft(draft: Draft, runner: RewriteRunner | undefined, notes: string[]): Draft {
  const keep = (why: string): Draft => {
    notes.push(`rewrite skipped, template written: ${why}`);
    return draft;
  };
  if (!runner) return keep("no runner was given to make the call");
  let reply: RewriteReply;
  try {
    reply = runner({ argv: [...REWRITE_ARGV], input: `${REWRITE_INSTRUCTION}\n\n${draft.body}`, cwd: os.tmpdir(), timeoutMs: REWRITE_TIMEOUT_MS });
  } catch (err) {
    return keep(err instanceof Error ? err.message : String(err));
  }
  if (!reply.ok) return keep(reply.reason);
  if (reply.text.trim() === "") return keep("the reply was empty");
  if (reply.text.length > MAX_REPLY_CHARS) return keep(`the reply was longer than ${MAX_REPLY_CHARS} characters`);
  const clean = cleanText(reply.text, MAX_REWRITE_CHARS);
  if (clean.text === "") return keep("nothing of the reply was left after cleaning");
  const body = clean.withheld > 0 ? `${clean.text} ${withheldSentence(clean.withheld)}` : clean.text;
  return { ...draft, body, withheld: draft.withheld + clean.withheld, mark: { ...draft.mark, prose: "model" } };
}

/**
 * Derive what is new for a task and append it to the journal. Throws `DeriveError` for a refusal
 * (an unknown slug, a `--session` that is not an id, has no transcript here, or never worked inside
 * this repository); in every refusal nothing has been written.
 */
export function deriveJournal(paths: RepoPaths, config: ReggieConfig, input: DeriveInput): DeriveResult {
  const startedAt = process.hrtime.bigint();
  const root = paths.root;
  const slug = input.slug;
  if (!isSafeSlug(slug)) throw new DeriveError(`"${slug}" is not a valid slug. Use lowercase letters, digits, and hyphens.`);
  if (!knownSlugs(paths).has(slug)) throw new DeriveError(`unknown task: ${slug}. Nothing in this repository names it.`);
  const flag = input.session === undefined ? null : sessionIdOf(input.session);
  if (input.session !== undefined && flag === null) throw new DeriveError("--session takes a Claude session id, which is a UUID. Nothing was read and nothing was written.");
  const base = defaultBranch(root, config.defaultBranch);
  if (base.startsWith("-")) throw new DeriveError("the integration branch's name begins with a dash, so it cannot be handed to git.");

  const task = getTask(paths, config, slug);
  const claim = readClaim(paths, slug, task.branchRef);
  const person = entryPerson(claim, input.person);
  const home = repoHome(root, slug);
  const rule = { repoDirs: dirSpellings(home.repoDir), worktreeDirs: dirSpellings(home.repoDir).map((d) => path.join(d, ".worktree", slug)) };
  const marks = collectMarks(paths, slug, base, task.branchRef);
  const toldCommits = new Set(marks.flatMap((m) => m.commits));
  const { refs, codexUnread } = collectSessions(paths, slug, home.cacheRoots, claim, flag);

  const totals = { records: 0, oversized: 0, unparseable: 0, eligible: 0 };
  const reports: SessionReport[] = [];
  const reads: SessionRead[] = [];
  const summarize = (entries: DerivedEntry[], withheld: number): string => {
    const ms = Number((process.hrtime.bigint() - startedAt) / 1_000_000n);
    const found = reports.filter((r) => r.status === "read").length;
    return [
      `derive ${slug}: sessions ${found} read, ${reports.length - found} not found, ${codexUnread} codex unread`,
      `records ${totals.records}`,
      `lines skipped ${totals.oversized} oversized, ${totals.unparseable} unparseable`,
      `closing messages ${totals.eligible}`,
      `quoted ${entries.reduce((n, e) => n + e.quotedChars, 0)} chars`,
      `withheld ${withheld}`,
      `commits ${entries.reduce((n, e) => n + e.mark.commits.length, 0)}`,
      `entries ${entries.length}${input.dryRun ? " (dry run)" : ""}`,
      `${ms} ms`,
    ].join("; ");
  };
  const refuse = (message: string): never => {
    const err = new DeriveError(message);
    err.summary = summarize([], 0);
    throw err;
  };

  for (const ref of refs) {
    const flagged = ref.sources.includes("flag");
    const file = findTranscript(input.claudeHome, ref.id);
    if (file === null) {
      reports.push({ id: ref.id, sources: ref.sources, goal: ref.goal, status: "not-found", stats: null, eligible: 0 });
      if (flagged) refuse("no transcript by that session id was found under the Claude home on this machine. Nothing was written.");
      continue;
    }
    const transcript = readTranscript(file);
    const selection = selectRecords(transcript.records, rule);
    totals.records += transcript.stats.records;
    totals.oversized += transcript.stats.oversized;
    totals.unparseable += transcript.stats.unparseable;
    const through = marks.reduce<number | null>((latest, m) => {
      const ms = m.session === ref.id && m.through ? Date.parse(m.through) : NaN;
      return Number.isFinite(ms) && (latest === null || ms > latest) ? ms : latest;
    }, null);
    const closing = closingMessages(selection.counted, through);
    totals.eligible += closing.length;
    reports.push({ id: ref.id, sources: ref.sources, goal: ref.goal, status: "read", stats: transcript.stats, eligible: closing.length });
    // The flag is the one source a person can point anywhere, so it is the one that is checked: a
    // session that never worked inside this repository is somebody's unrelated conversation.
    if (flagged && !selection.insideRepo) refuse("that session never worked inside this repository, so it is not read for this task. Nothing was written.");
    const span = sessionSpan(transcript.records);
    if (span) reads.push({ ...ref, span, counted: selection.counted, through, closing, commits: [] });
  }

  // Each new commit goes to the session whose span holds its author date, the latest-started when
  // several do, and otherwise to the one entry that is drawn from commits alone.
  const allCommits = taskCommits(root, slug, base, task);
  const loose: LogCommit[] = [];
  for (const c of allCommits.filter((c) => !toldCommits.has(sha12(c)))) {
    const at = commitMs(c);
    const owner = reads.filter((s) => s.span.start <= at && at <= s.span.end).sort((a, b) => b.span.start - a.span.start)[0];
    if (owner) owner.commits.push(c);
    else loose.push(c);
  }

  let drafts: Draft[] = reads.filter((s) => s.closing.length > 0 || s.commits.length > 0).map((s) => sessionDraft(slug, s, task, root));
  if (loose.length > 0) {
    const reasons: string[] = [];
    const missing = reports.some((r) => r.status === "not-found");
    const host = input.host ?? os.hostname();
    // The machine only explains a transcript that is known to be missing. With no id recorded there is
    // no session to place anywhere, and a machine's name is not steady enough to say more: the same
    // laptop signs claims under whatever name its network gave it that day.
    if (reads.length > 0) reasons.push(SENTENCE_OUTSIDE_SESSIONS);
    else if (missing) reasons.push(claim?.machine && claim.machine !== host ? SENTENCE_OTHER_MACHINE : SENTENCE_NO_TRANSCRIPT);
    else if (codexUnread === 0) reasons.push(SENTENCE_NO_SESSION);
    if (codexUnread > 0) reasons.push(SENTENCE_CODEX_UNREAD);
    drafts.push(commitsDraft(slug, loose, reasons));
  }
  drafts.sort((a, b) => (a.kind === b.kind ? a.endMs - b.endMs : a.kind === "session" ? -1 : 1));

  const notes: string[] = [];
  if (input.rewrite) drafts = drafts.map((d) => (d.kind === "session" ? rewriteDraft(d, input.runner, notes) : d));

  const entries: DerivedEntry[] = drafts.map((d) => {
    const now = new Date(d.endMs);
    const entryInput: AppendJournalInput = {
      person,
      tool: d.kind === "session" ? "claude" : "reggie",
      slug,
      stage: d.stage,
      text: d.body,
      evidence: d.evidence,
      session: d.session ?? sessionName(input.env ?? process.env),
      now,
      derived: d.mark,
    };
    const file = input.dryRun ? journalFile(paths, today(now), person, entryInput.session ?? "session") : appendJournal(paths, entryInput).file;
    return {
      kind: d.kind,
      session: d.session,
      file: relPosix(root, file),
      block: formatJournalEntry(entryInput, clock(now)),
      text: d.body,
      person,
      tool: d.kind === "session" ? "claude" : "reggie",
      stage: d.stage,
      date: today(now),
      time: clock(now),
      evidence: d.evidence,
      mark: d.mark,
      quotedChars: d.quotedChars,
      withheld: d.withheld,
      written: !input.dryRun,
    };
  });

  const withheld = entries.reduce((n, e) => n + e.withheld, 0);
  let message: string | null = null;
  if (entries.length === 0) {
    const anythingAtAll = allCommits.length > 0 || marks.length > 0 || reads.some((s) => closingMessages(s.counted, null).length > 0);
    message = anythingAtAll
      ? `Nothing new for ${slug}: every commit and every closing message Reggie can read is already in a derived entry.`
      : `There is nothing to derive for ${slug}: it has no commits of its own and no session whose transcript Reggie can read.`;
  }
  return { slug, dryRun: Boolean(input.dryRun), entries, sessions: reports, codexUnread, message, notes, withheld, summary: summarize(entries, withheld) };
}
