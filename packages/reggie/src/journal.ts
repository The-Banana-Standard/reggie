import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import type { RepoPaths } from "./paths.js";
import { appendText, clock, readText, today, writeText } from "./util.js";

export type ToolName = "claude" | "codex" | "human" | string;

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
  const slug = input.slug ?? null;
  const stage = input.stage ?? null;
  const header = ["###", time, "·", input.person, "·", input.tool, "·", slug ?? "-", "·", stage ?? "-"].join(" ");
  const lines = [header, input.text.trim()];
  const evidence = input.evidence ?? [];
  if (evidence.length > 0) lines.push(`evidence: ${evidence.join(", ")}`);
  appendText(file, `${lines.join("\n")}\n\n`);
  return { date, time, person: input.person, tool: input.tool, slug, stage, text: input.text.trim(), evidence, file };
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
  return `${head}: ${body}${ev}`;
}
