import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync } from "node:fs";
import path from "node:path";

/** Turn free text into a safe kebab-case slug (lowercase letters, digits, hyphens). */
export function slugify(input: string, maxLength = 60): string {
  const slug = input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, maxLength)
    .replace(/-+$/g, "");
  return slug || "item";
}

export function isSafeSlug(slug: string): boolean {
  return /^[a-z0-9][a-z0-9-]{0,79}$/.test(slug);
}

export function nowIso(): string {
  return new Date().toISOString();
}

/** YYYY-MM-DD in local time. */
export function today(d: Date = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** HH:MM in local time. */
export function clock(d: Date = new Date()): string {
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

export function ensureDir(dir: string): void {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

export function readText(file: string): string | null {
  if (!existsSync(file)) return null;
  return readFileSync(file, "utf8");
}

export function writeText(file: string, content: string): void {
  ensureDir(path.dirname(file));
  writeFileSync(file, content, "utf8");
}

export function appendText(file: string, content: string): void {
  ensureDir(path.dirname(file));
  appendFileSync(file, content, "utf8");
}

/** Write only if the file does not exist. Returns true when written. */
export function writeIfMissing(file: string, content: string): boolean {
  if (existsSync(file)) return false;
  writeText(file, content);
  return true;
}

/** Path relative to root, always with forward slashes. */
export function relPosix(root: string, file: string): string {
  return path.relative(root, file).split(path.sep).join("/");
}

export function uniq<T>(items: Iterable<T>): T[] {
  return Array.from(new Set(items));
}

/**
 * Split a front matter block from its body. The block opens with a line that is exactly `---`
 * and closes with the next such line. CRLF input is normalized. Returns front=null when absent.
 */
export function splitFrontMatter(content: string): { front: string | null; body: string } {
  const text = content.replace(/\r\n/g, "\n");
  const lines = text.split("\n");
  if (!/^---\s*$/.test(lines[0] ?? "")) return { front: null, body: text };
  for (let i = 1; i < lines.length; i += 1) {
    if (/^---\s*$/.test(lines[i] ?? "")) {
      return { front: lines.slice(1, i).join("\n"), body: lines.slice(i + 1).join("\n") };
    }
  }
  return { front: null, body: text };
}

/** Set or add simple `key: value` fields in a front matter block, creating the block when missing. */
export function upsertFrontMatter(content: string, fields: Record<string, string>): string {
  const { front, body } = splitFrontMatter(content);
  const lines = front === null ? [] : front.split("\n");
  for (const [key, value] of Object.entries(fields)) {
    const idx = lines.findIndex((l) => l.startsWith(`${key}:`));
    if (idx >= 0) lines[idx] = `${key}: ${value}`;
    else lines.push(`${key}: ${value}`);
  }
  return `---\n${lines.join("\n")}\n---\n${body}`;
}

/** Resolve target and refuse anything that escapes baseDir. Returns the resolved path. */
export function assertInside(baseDir: string, target: string, what: string): string {
  const base = path.resolve(baseDir);
  const resolved = path.resolve(target);
  if (resolved !== base && !resolved.startsWith(base + path.sep)) {
    throw new Error(`${what} resolves outside ${base}: ${target}`);
  }
  return resolved;
}

/** Body lines that would be mistaken for an entry header or a trailer are indented so parsers ignore them. */
export function escapeBodyLine(line: string): string {
  return /^(##\s|###\s|sources:|evidence:)/i.test(line) ? `  ${line}` : line;
}

export function parseIntOption(value: string, name: string): number {
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n) || n < 0 || String(n) !== value.trim()) throw new Error(`${name} must be a non-negative integer, got "${value}"`);
  return n;
}

export function truncateLines(text: string, maxLines: number): string {
  const lines = text.split("\n");
  if (lines.length <= maxLines) return text;
  return [...lines.slice(0, maxLines), `... (${lines.length - maxLines} more lines)`].join("\n");
}

export function shortId(length = 6): string {
  const alphabet = "abcdefghjkmnpqrstuvwxyz23456789";
  let out = "";
  for (let i = 0; i < length; i += 1) {
    out += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return out;
}
