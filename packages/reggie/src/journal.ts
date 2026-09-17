import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import type { RepoPaths } from "./paths.js";
import { appendText, clock, escapeBodyLine, readText, today, writeText } from "./util.js";

export type ToolName = "claude" | "codex" | "human" | string;

/**
 * What a machine-written entry covers, kept as the entry's last line so a second run of
 * `reggie journal derive` can tell what an earlier one already said. It lives in the entry because
 * that is the only place that travels with git: it survives a merge, a released branch and a cleared
 * cache, and it is never a file two writers share.
 */
export interface DerivedMark {
  /** The session whose transcript the entry quoted; null for an entry drawn from commits alone. */
  session: string | null;
  /** ISO instant of the newest transcript record the entry covers; null when it covers none. */
  through: string | null;
  /** Twelve-character ids of the commits the entry narrates. They appear here and nowhere else in the file. */
  commits: string[];
  /** Whether Reggie's template wrote the prose or the opt-in model call did. */
  prose: "template" | "model";
}

export interface JournalEntry {
  date: string;
  time: string;
  person: string;
  tool: ToolName;
  slug: string | null;
  stage: string | null;
  text: string;
  evidence: string[];
  file: string;
  /** Present only on an entry `reggie journal derive` wrote. A hand entry never has it. */
  derived?: DerivedMark;
}

/** Which agent is writing, from the environment. Falls back to "human". */
export function detectTool(env: NodeJS.ProcessEnv = process.env): ToolName {
  if (env.REGGIE_TOOL) return env.REGGIE_TOOL;
  if (env.CLAUDECODE || env.CLAUDE_CODE_ENTRYPOINT || env.CLAUDE_CODE) return "claude";
  if (env.CODEX_SANDBOX || env.CODEX_CI || env.CODEX_HOME || env.CODEX_SESSION) return "codex";
  return "human";
}

export function sessionName(env: NodeJS.ProcessEnv = process.env): string {
  return env.REGGIE_SESSION || "session";
}

export function journalFile(paths: RepoPaths, date: string, person: string, session: string): string {
  return path.join(paths.journal, date, `${person}-${session}.md`);
}

export interface AppendJournalInput {
  person: string;
  tool: ToolName;
  text: string;
  slug?: string | null;
  stage?: string | null;
  evidence?: string[];
  session?: string;
  now?: Date;
  /** Set only by `reggie journal derive`: written as the entry's last line and read back by `parseJournalFile`. */
  derived?: DerivedMark;
}

/** The mark as its one line. Every field is always present, so the line parses by position and not by guesswork. */
export function renderDerivedMark(mark: DerivedMark): string {
  const commits = mark.commits.length > 0 ? mark.commits.join(",") : "none";
  return `derived: session=${mark.session ?? "none"} through=${mark.through ?? "none"} commits=${commits} prose=${mark.prose}`;
}

const DERIVED_RE =
  /^derived: session=(none|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}) through=(none|\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z) commits=(none|[0-9a-f]{12}(?:,[0-9a-f]{12})*) prose=(template|model)\s*$/;

/** Null for anything that is not exactly the line `renderDerivedMark` writes; such a line stays body text. */
export function parseDerivedMark(line: string): DerivedMark | null {
  const m = DERIVED_RE.exec(line);
  if (!m) return null;
  const [, session = "none", through = "none", commits = "none", prose = "template"] = m;
  return {
    session: session === "none" ? null : session,
    through: through === "none" ? null : through,
    commits: commits === "none" ? [] : commits.split(",").filter(Boolean),
    prose: prose === "model" ? "model" : "template",
  };
}

/** The header, body, evidence line and mark of one entry, exactly as they are appended, without the blank line after. */
export function formatJournalEntry(input: AppendJournalInput, time: string): string {
  const header = ["###", time, "·", input.person, "·", input.tool, "·", input.slug ?? "-", "·", input.stage ?? "-"].join(" ");
  const lines = [header, input.text.trim().split("\n").map(escapeBodyLine).join("\n")];
  const evidence = input.evidence ?? [];
  if (evidence.length > 0) lines.push(`evidence: ${evidence.join(", ")}`);
  if (input.derived) lines.push(renderDerivedMark(input.derived));
  return lines.join("\n");
}

export function appendJournal(paths: RepoPaths, input: AppendJournalInput): JournalEntry {
  const now = input.now ?? new Date();
  const date = today(now);
  const time = clock(now);
  const session = input.session ?? sessionName();
  const file = journalFile(paths, date, input.person, session);
  if (!existsSync(file)) {
    writeText(file, `# Journal · ${date} · ${input.person} · ${session}\n\nPlain-English record of what happened, written as it happened. No file paths in the prose; link evidence instead.\n\n`);
  }
  appendText(file, `${formatJournalEntry(input, time)}\n\n`);
  const entry: JournalEntry = { date, time, person: input.person, tool: input.tool, slug: input.slug ?? null, stage: input.stage ?? null, text: input.text.trim(), evidence: input.evidence ?? [], file };
  if (input.derived) entry.derived = input.derived;
  return entry;
}

const HEADER_RE = /^### (\d{2}:\d{2}) · (.+?) · (.+?) · (.+?) · (.+?)\s*$/;

export function parseJournalFile(file: string, date: string, content: string): JournalEntry[] {
  const entries: JournalEntry[] = [];
  let current: JournalEntry | null = null;
  const flush = () => {
    if (current) {
      current.text = current.text.trim();
      entries.push(current);
    }
    current = null;
  };
  for (const line of content.split("\n")) {
    const m = HEADER_RE.exec(line);
    if (m) {
      flush();
      current = {
        date,
        time: m[1] ?? "",
        person: m[2] ?? "",
        tool: m[3] ?? "",
        slug: m[4] && m[4] !== "-" ? m[4] : null,
        stage: m[5] && m[5] !== "-" ? m[5] : null,
        text: "",
        evidence: [],
        file,
      };
      continue;
    }
    if (!current) continue;
    if (/^evidence:\s*/i.test(line)) {
      current.evidence = line
        .replace(/^evidence:\s*/i, "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      continue;
    }
    // Only the exact machine-written line is a mark. A hand entry's own `derived:` line was indented on
    // the way in, and anything else that merely starts with the word stays part of the text.
    const mark = parseDerivedMark(line);
    if (mark) {
      current.derived = mark;
      continue;
    }
    current.text += `${line}\n`;
  }
  flush();
  return entries;
}

export interface JournalQuery {
  days?: number;
  slug?: string;
  person?: string;
  limit?: number;
}

/** Entries from the last N days (default 7), newest first. */
export function readJournal(paths: RepoPaths, query: JournalQuery = {}): JournalEntry[] {
  if (!existsSync(paths.journal)) return [];
  const days = query.days ?? 7;
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  const cutoffDay = today(cutoff);
  const out: JournalEntry[] = [];
  for (const dateDir of readdirSync(paths.journal)) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateDir) || dateDir < cutoffDay) continue;
    const dir = path.join(paths.journal, dateDir);
    for (const name of readdirSync(dir)) {
      if (!name.endsWith(".md")) continue;
      const file = path.join(dir, name);
      const content = readText(file) ?? "";
      for (const entry of parseJournalFile(file, dateDir, content)) {
        if (query.slug && entry.slug !== query.slug) continue;
        if (query.person && entry.person !== query.person) continue;
        out.push(entry);
      }
    }
  }
  out.sort((a, b) => `${b.date} ${b.time}`.localeCompare(`${a.date} ${a.time}`));
  return query.limit ? out.slice(0, query.limit) : out;
}

export function renderJournalEntry(e: JournalEntry): string {
  const where = [e.slug, e.stage].filter(Boolean).join(" / ");
  const head = `- ${e.date} ${e.time} · ${e.person} · ${e.tool}${where ? ` · ${where}` : ""}`;
  const body = e.text.replace(/\s+/g, " ").trim();
  const ev = e.evidence.length > 0 ? ` (evidence: ${e.evidence.join(", ")})` : "";
  return `${head}: ${body}${ev}${e.derived ? " (derived)" : ""}`;
}
