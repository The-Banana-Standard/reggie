import { existsSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { lastCommitDate } from "./git.js";
import type { RepoPaths } from "./paths.js";
import { appendText, readText, relPosix, slugify, splitFrontMatter, today, writeText } from "./util.js";

export const NOTE_TYPES = ["why", "how", "gotcha", "verify", "data-source", "decision"] as const;
export type NoteType = (typeof NOTE_TYPES)[number];
export type Confidence = "high" | "medium" | "low";
export type NoteKind = "file" | "dir" | "repo" | "entity";

export interface NoteEntry {
  type: NoteType;
  date: string;
  author: string;
  confidence: Confidence;
  text: string;
  sources: string[];
  stale?: boolean;
}

export interface NoteFile {
  entity: string;
  kind: NoteKind;
  file: string;
  entries: NoteEntry[];
}

export interface NoteTarget {
  entity: string;
  kind: NoteKind;
  file: string;
}

const ENTITY_KINDS = ["store", "route", "service", "env", "concept"] as const;

function isNoteType(value: string): value is NoteType {
  return (NOTE_TYPES as readonly string[]).includes(value);
}

/**
 * Resolve where the note for an entity lives.
 *  - "." / "_repo" / "repo"  -> notes/_repo.md
 *  - "store:users" etc.       -> notes/_entities/store/users.md
 *  - "src/auth/" or a dir     -> notes/src/auth/_dir.md
 *  - "src/auth/login.ts"      -> notes/src/auth/login.ts.md
 */
export function resolveNoteTarget(paths: RepoPaths, rawEntity: string): NoteTarget {
  const entity = rawEntity.trim().replace(/\\/g, "/").replace(/^\.\//, "");
  if (entity === "" || entity === "." || entity === "_repo" || entity === "repo") {
    return { entity: "_repo", kind: "repo", file: path.join(paths.notes, "_repo.md") };
  }
  const kindMatch = /^([a-z-]+):(.+)$/.exec(entity);
  if (kindMatch && (ENTITY_KINDS as readonly string[]).includes(kindMatch[1] ?? "")) {
    const kind = kindMatch[1] ?? "concept";
    const name = kindMatch[2] ?? "";
    return { entity: `${kind}:${name}`, kind: "entity", file: path.join(paths.notes, "_entities", kind, `${slugify(name, 80)}.md`) };
  }
  const clean = entity.replace(/\/+$/, "");
  const absolute = path.join(paths.root, clean);
  const isDir = entity.endsWith("/") || (existsSync(absolute) && statSync(absolute).isDirectory());
  if (isDir) {
    return { entity: `${clean}/`, kind: "dir", file: path.join(paths.notes, clean, "_dir.md") };
  }
  return { entity: clean, kind: "file", file: path.join(paths.notes, `${clean}.md`) };
}

function renderHeader(entry: NoteEntry): string {
  return `## ${entry.type} · ${entry.date} · ${entry.author} · ${entry.confidence}`;
}

export function renderEntry(entry: NoteEntry): string {
  const lines = [renderHeader(entry), entry.text.trim()];
  if (entry.sources.length > 0) lines.push(`sources: ${entry.sources.join(", ")}`);
  return `${lines.join("\n")}\n\n`;
}

export interface AddNoteInput {
  type: NoteType;
  text: string;
  author: string;
  confidence?: Confidence;
  sources?: string[];
  date?: string;
}

/** Append a dated entry to the entity's note file, creating the file with front matter when needed. */
export function addNote(paths: RepoPaths, rawEntity: string, input: AddNoteInput): { target: NoteTarget; entry: NoteEntry; created: boolean } {
  const target = resolveNoteTarget(paths, rawEntity);
  const entry: NoteEntry = {
    type: input.type,
    date: input.date ?? today(),
    author: input.author,
    confidence: input.confidence ?? "medium",
    text: input.text.trim(),
    sources: input.sources ?? [],
  };
  const created = !existsSync(target.file);
  if (created) {
    writeText(target.file, `---\nentity: ${target.entity}\nkind: ${target.kind}\n---\n\n`);
  }
  appendText(target.file, renderEntry(entry));
  return { target, entry, created };
}

export function parseNoteFile(file: string, content: string, fallback: { entity: string; kind: NoteKind }): NoteFile {
  const { front, body } = splitFrontMatter(content);
  let entity = fallback.entity;
  let kind: NoteKind = fallback.kind;
  if (front) {
    for (const line of front.split("\n")) {
      const m = /^(\w+):\s*(.+)$/.exec(line.trim());
      if (!m) continue;
      if (m[1] === "entity" && m[2]) entity = m[2].trim();
      if (m[1] === "kind" && m[2] && ["file", "dir", "repo", "entity"].includes(m[2].trim())) kind = m[2].trim() as NoteKind;
    }
  }
  const entries: NoteEntry[] = [];
  const headerRe = /^## ([a-z-]+) · (\d{4}-\d{2}-\d{2}) · (.+?) · (high|medium|low)\s*$/;
  let current: NoteEntry | null = null;
  const flush = () => {
    if (!current) return;
    current.text = current.text.trim();
    entries.push(current);
    current = null;
  };
  for (const line of body.split("\n")) {
    const m = headerRe.exec(line);
    if (m) {
      flush();
      const type = m[1] ?? "how";
      current = {
        type: isNoteType(type) ? type : "how",
        date: m[2] ?? "",
        author: (m[3] ?? "").trim(),
        confidence: (m[4] as Confidence | undefined) ?? "medium",
        text: "",
        sources: [],
      };
      continue;
    }
    if (!current) continue;
    if (/^sources:\s*/i.test(line)) {
      current.sources = line
        .replace(/^sources:\s*/i, "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      continue;
    }
    current.text += `${line}\n`;
  }
  flush();
  return { entity, kind, file, entries };
}

export function readNoteFile(paths: RepoPaths, rawEntity: string): NoteFile | null {
  const target = resolveNoteTarget(paths, rawEntity);
  const content = readText(target.file);
  if (content === null) return null;
  return parseNoteFile(target.file, content, { entity: target.entity, kind: target.kind });
}

/** Every note file under .reggie/notes, excluding README.md. */
export function allNoteFiles(paths: RepoPaths): NoteFile[] {
  const out: NoteFile[] = [];
  const walk = (dir: string) => {
    if (!existsSync(dir)) return;
    for (const name of readdirSync(dir)) {
      const full = path.join(dir, name);
      const st = statSync(full);
      if (st.isDirectory()) {
        walk(full);
        continue;
      }
      if (!name.endsWith(".md") || name === "README.md") continue;
      const content = readText(full) ?? "";
      const rel = relPosix(paths.notes, full);
      const guess = guessEntityFromRel(rel);
      out.push(parseNoteFile(full, content, guess));
    }
  };
  walk(paths.notes);
  return out;
}

function guessEntityFromRel(rel: string): { entity: string; kind: NoteKind } {
  if (rel === "_repo.md") return { entity: "_repo", kind: "repo" };
  if (rel.startsWith("_entities/")) {
    const parts = rel.split("/");
    return { entity: `${parts[1] ?? "concept"}:${(parts[2] ?? "").replace(/\.md$/, "")}`, kind: "entity" };
  }
  if (rel.endsWith("/_dir.md")) return { entity: rel.replace(/_dir\.md$/, ""), kind: "dir" };
  return { entity: rel.replace(/\.md$/, ""), kind: "file" };
}

/** Case-insensitive substring search over entity names. */
export function findNotes(paths: RepoPaths, query: string): NoteFile[] {
  const q = query.trim().toLowerCase().replace(/^\.\//, "");
  if (!q) return allNoteFiles(paths);
  return allNoteFiles(paths).filter((n) => n.entity.toLowerCase().includes(q));
}

/** The chain an agent should read before editing a path: repo note, each ancestor folder note, then the file note. */
export function notesForPath(paths: RepoPaths, filePath: string): NoteFile[] {
  const clean = filePath.replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/+$/, "");
  const chain: NoteFile[] = [];
  const repo = readNoteFile(paths, "_repo");
  if (repo) chain.push(repo);
  const segments = clean.split("/").filter(Boolean);
  for (let i = 1; i < segments.length; i += 1) {
    const dir = `${segments.slice(0, i).join("/")}/`;
    const note = readNoteFile(paths, dir);
    if (note) chain.push(note);
  }
  const leafAsDir = readNoteFile(paths, `${clean}/`);
  if (leafAsDir && !chain.includes(leafAsDir)) chain.push(leafAsDir);
  const leaf = readNoteFile(paths, clean);
  if (leaf) chain.push(leaf);
  return chain;
}

export interface StaleEntry {
  entity: string;
  file: string;
  entry: NoteEntry;
  codeChanged: string;
}

/** Entries whose entity changed in git after the entry was written. Only files and folders can go stale this way. */
export function staleEntries(paths: RepoPaths): StaleEntry[] {
  const out: StaleEntry[] = [];
  for (const note of allNoteFiles(paths)) {
    if (note.kind !== "file" && note.kind !== "dir") continue;
    const target = note.entity.replace(/\/$/, "");
    if (!existsSync(path.join(paths.root, target))) continue;
    const changed = lastCommitDate(paths.root, target);
    if (!changed) continue;
    const changedDay = changed.slice(0, 10);
    for (const entry of note.entries) {
      if (entry.date && changedDay > entry.date) {
        out.push({ entity: note.entity, file: note.file, entry: { ...entry, stale: true }, codeChanged: changedDay });
      }
    }
  }
  return out;
}

export function renderNoteFile(note: NoteFile, opts: { markStale?: Set<string> } = {}): string {
  const lines = [`### ${note.entity} (${note.kind})`];
  if (note.entries.length === 0) lines.push("(no entries)");
  for (const e of note.entries) {
    const stale = opts.markStale?.has(`${note.entity}|${e.date}|${e.type}`) ? " · STALE" : "";
    lines.push(`- **${e.type}** ${e.date} ${e.author} (${e.confidence}${stale}): ${e.text.replace(/\s+/g, " ").trim()}`);
    if (e.sources.length > 0) lines.push(`  sources: ${e.sources.join(", ")}`);
  }
  return lines.join("\n");
}
