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

/** Parse a simple YAML-ish front matter block. Returns body and raw front matter text. */
export function splitFrontMatter(content: string): { front: string | null; body: string } {
  if (!content.startsWith("---")) return { front: null, body: content };
  const end = content.indexOf("\n---", 3);
  if (end === -1) return { front: null, body: content };
  const front = content.slice(4, end);
  let body = content.slice(end + 4);
  if (body.startsWith("\n")) body = body.slice(1);
  return { front, body };
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
