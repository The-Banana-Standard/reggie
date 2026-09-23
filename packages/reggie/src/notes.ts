import { createHash } from "node:crypto";
import { existsSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { lastCommitDate } from "./git.js";
import type { RepoPaths } from "./paths.js";
import { appendText, assertInside, escapeBodyLine, readText, relPosix, slugify, splitFrontMatter, today, writeText } from "./util.js";

export const NOTE_TYPES = ["why", "how", "gotcha", "verify", "data-source", "decision"] as const;
export type NoteType = (typeof NOTE_TYPES)[number];
export type Confidence = "high" | "medium" | "low";
export type NoteKind = "file" | "dir" | "repo" | "symbol" | "entity";

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
  retired: boolean;
  supersededBy: string | null;
}

export interface NoteTarget {
  entity: string;
  kind: NoteKind;
  file: string;
}

export const ENTITY_KINDS = ["store", "route", "service", "env", "environment", "concept"] as const;

function isNoteType(value: string): value is NoteType {
  return (NOTE_TYPES as readonly string[]).includes(value);
}

/**
 * Resolve where the note for an entity lives.
 *  - "." / "_repo" / "repo"  -> notes/_repo.md
 *  - "sym:src/a.ts::run"       -> notes/_symbols/src/a.ts/run.md
 *  - "store:users" etc.       -> notes/_entities/store/users.md
 *  - "src/auth/" or a dir     -> notes/src/auth/_dir.md
 *  - "src/auth/login.ts"      -> notes/src/auth/login.ts.md
 */
export function resolveNoteTarget(paths: RepoPaths, rawEntity: string): NoteTarget {
  const entity = rawEntity.trim().replace(/\\/g, "/").replace(/^\.\//, "");
  if (/[\u0000-\u001f\u007f]/.test(entity)) throw new Error("A note entity may not contain control characters.");
  if (entity === "" || entity === "." || entity === "_repo" || entity === "repo") {
    return { entity: "_repo", kind: "repo", file: path.join(paths.notes, "_repo.md") };
  }
  const symbol = /^sym:([^:]+)::(.+)$/.exec(entity);
  if (symbol) {
    const sourcePath = cleanRepoPath(symbol[1] ?? "", rawEntity);
    const qualifiedName = (symbol[2] ?? "").trim();
    if (!qualifiedName || qualifiedName.includes("\0")) throw new Error(`"${rawEntity}" is not a valid symbol ID.`);
    const file = path.join(paths.notes, "_symbols", sourcePath, `${symbolFileName(qualifiedName)}.md`);
    return { entity: `sym:${sourcePath}::${qualifiedName}`, kind: "symbol", file: assertInside(paths.notes, file, "symbol note path") };
  }
  if (entity.startsWith("sym:")) throw new Error(`"${rawEntity}" is not a valid symbol ID. Use sym:<repo-path>::<qualified-name>.`);
  const kindMatch = /^([a-z-]+):(.+)$/.exec(entity);
  if (kindMatch && (ENTITY_KINDS as readonly string[]).includes(kindMatch[1] ?? "")) {
    const kind = kindMatch[1] ?? "concept";
    const name = kindMatch[2] ?? "";
    const canonicalEntity = `${kind}:${name}`;
    // Keep exact legacy files readable, but give every new free-form entity a digest-backed path.
    // Slug-only names such as "GET /a-b" and "GET /a/b" otherwise alias one note file.
    const legacy = path.join(paths.notes, "_entities", kind, `${slugify(name, 80)}.md`);
    const legacyContent = readText(legacy);
    const file = legacyContent !== null && parseNoteFile(legacy, legacyContent, { entity: canonicalEntity, kind: "entity" }).entity === canonicalEntity
      ? legacy
      : path.join(paths.notes, "_entities", kind, `${entityFileName(name)}.md`);
    return { entity: canonicalEntity, kind: "entity", file: assertInside(paths.notes, file, "note path") };
  }
  const clean = entity.replace(/\/+$/, "");
  if (clean === "" || path.isAbsolute(clean) || clean.split("/").some((seg) => seg === "..")) {
    throw new Error(`"${rawEntity}" is not a repo-relative path. Use a path inside the repo, "_repo", or "<kind>:<name>".`);
  }
  const fileNote = path.join(paths.notes, `${clean}.md`);
  const dirNote = path.join(paths.notes, clean, "_dir.md");
  let isDir: boolean;
  if (entity.endsWith("/")) isDir = true;
  else if (existsSync(dirNote) && !existsSync(fileNote)) isDir = true;
  else if (existsSync(fileNote)) isDir = false;
  else {
    const absolute = path.join(paths.root, clean);
    isDir = existsSync(absolute) && statSync(absolute).isDirectory();
  }
  if (isDir) {
    return { entity: `${clean}/`, kind: "dir", file: assertInside(paths.notes, dirNote, "note path") };
  }
  return { entity: clean, kind: "file", file: assertInside(paths.notes, fileNote, "note path") };
}

function cleanRepoPath(value: string, original: string): string {
  const clean = value.replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/+$/, "");
  if (!clean || path.isAbsolute(clean) || clean.split("/").some((segment) => segment === "" || segment === "." || segment === "..")) {
    throw new Error(`"${original}" is not a repo-relative symbol ID.`);
  }
  return clean;
}

/** A reversible filename for ordinary qualified names, bounded for filesystem safety. */
function symbolFileName(qualifiedName: string): string {
  const encoded = encodeURIComponent(qualifiedName).replace(/%/g, "~");
  if (encoded.length <= 160) return encoded;
  const digest = createHash("sha256").update(qualifiedName).digest("hex").slice(0, 16);
  return `${encoded.slice(0, 140)}-${digest}`;
}

function entityFileName(name: string): string {
  const digest = createHash("sha256").update(name).digest("hex").slice(0, 16);
  return `${slugify(name, 60)}-${digest}`;
}

function qualifiedNameFromFileName(name: string): string {
  try {
    return decodeURIComponent(name.replace(/~/g, "%"));
  } catch {
    return name;
  }
}

function renderHeader(entry: NoteEntry): string {
  return `## ${entry.type} · ${entry.date} · ${entry.author} · ${entry.confidence}`;
}

export function renderEntry(entry: NoteEntry): string {
  const body = entry.text.trim().split("\n").map(escapeBodyLine).join("\n");
  const lines = [renderHeader(entry), body];
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
  let retired = false;
  let supersededBy: string | null = null;
  if (front) {
    for (const line of front.split("\n")) {
      const m = /^([a-z][a-z-]*):\s*(.*)$/.exec(line.trim());
      if (!m) continue;
      if (m[1] === "entity" && m[2]) entity = m[2].trim();
      if (m[1] === "kind" && m[2] && ["file", "dir", "repo", "symbol", "entity"].includes(m[2].trim())) kind = m[2].trim() as NoteKind;
      if (m[1] === "retired" && m[2]) retired = m[2].trim() === "true";
      if (m[1] === "superseded-by" && m[2]?.trim()) supersededBy = m[2].trim();
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
    // Knowledge updates are immutable machine history beside the human-readable entries. They
    // may follow an entry at EOF, but never become part of that entry's prose.
    if (/^<!-- reggie:knowledge:update:[A-Za-z0-9_-]+ -->$/.test(line.trim())) continue;
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
  return { entity, kind, file, entries, retired, supersededBy };
}

export function readNoteFile(paths: RepoPaths, rawEntity: string): NoteFile | null {
  const target = resolveNoteTarget(paths, rawEntity);
  const content = readText(target.file);
  if (content === null) return null;
  return parseNoteFile(target.file, content, { entity: target.entity, kind: target.kind });
}

/** Every note file under .reggie/notes, excluding README.md. */
export function allNoteFiles(paths: RepoPaths, options: { includeRetired?: boolean } = {}): NoteFile[] {
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
      const note = parseNoteFile(full, content, guess);
      if (options.includeRetired || !note.retired) out.push(note);
    }
  };
  walk(paths.notes);
  return out;
}

function guessEntityFromRel(rel: string): { entity: string; kind: NoteKind } {
  if (rel === "_repo.md") return { entity: "_repo", kind: "repo" };
  if (rel.startsWith("_symbols/")) {
    const parts = rel.slice("_symbols/".length).split("/");
    const qualified = qualifiedNameFromFileName((parts.pop() ?? "symbol.md").replace(/\.md$/, ""));
    return { entity: `sym:${parts.join("/")}::${qualified}`, kind: "symbol" };
  }
  if (rel.startsWith("_entities/")) {
    const parts = rel.split("/");
    return { entity: `${parts[1] ?? "concept"}:${(parts[2] ?? "").replace(/\.md$/, "")}`, kind: "entity" };
  }
  if (rel.endsWith("/_dir.md")) return { entity: rel.replace(/_dir\.md$/, ""), kind: "dir" };
  return { entity: rel.replace(/\.md$/, ""), kind: "file" };
}

/** Every note file keyed by entity (`_repo`, `src/auth/`, `src/auth/login.ts`, `store:users`), read once for the graph join. */
export function notesIndex(paths: RepoPaths): Map<string, NoteFile> {
  const out = new Map<string, NoteFile>();
  for (const note of allNoteFiles(paths)) {
    if (!out.has(note.entity)) out.set(note.entity, note);
  }
  return out;
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
  if (repo && !repo.retired) chain.push(repo);
  const segments = clean.split("/").filter(Boolean);
  for (let i = 1; i < segments.length; i += 1) {
    const dir = `${segments.slice(0, i).join("/")}/`;
    const note = readNoteFile(paths, dir);
    if (note && !note.retired) chain.push(note);
  }
  const seen = new Set(chain.map((n) => n.file));
  for (const candidate of [readNoteFile(paths, `${clean}/`), readNoteFile(paths, clean)]) {
    if (candidate && !candidate.retired && !seen.has(candidate.file)) {
      chain.push(candidate);
      seen.add(candidate.file);
    }
  }
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
  return staleEntriesFor(paths, allNoteFiles(paths));
}

/**
 * Same check restricted to the given notes. With `lastTouched` (entity → ISO date of its newest
 * commit, from history.ts: files as `src/a.ts`, folders as `src/`) staleness costs no git calls;
 * an entity missing from the map falls back to one `git log -1` so a file untouched for longer
 * than the history window is still judged correctly. Without the map: one git call per note.
 */
export function staleEntriesFor(paths: RepoPaths, notes: NoteFile[], lastTouched?: Map<string, string>): StaleEntry[] {
  const out: StaleEntry[] = [];
  for (const note of notes) {
    if (note.kind !== "file" && note.kind !== "dir") continue;
    const target = note.entity.replace(/\/$/, "");
    if (!existsSync(path.join(paths.root, target))) continue;
    const changed = lastTouched?.get(note.entity) ?? lastTouched?.get(note.kind === "dir" ? `${target}/` : target) ?? lastCommitDate(paths.root, target);
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
