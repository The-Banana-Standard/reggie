import { INTAKE_HEADER } from "./layout.js";
import type { RepoPaths } from "./paths.js";
import type { Person } from "./people.js";
import { knownSlugs, parseIntake } from "./tasks.js";
import { appendText, readText, slugify, today, writeText } from "./util.js";

export interface CaptureInput {
  text: string;
  person: Person;
  source: string;
  detail?: string;
  slug?: string;
}

export interface CaptureResult {
  slug: string;
  line: string;
}

/** Append one raw item to intake.md. Slugs are derived from the text and made unique. */
export function capture(paths: RepoPaths, input: CaptureInput): CaptureResult {
  if (!readText(paths.intake)) writeText(paths.intake, INTAKE_HEADER);
  const existing = knownSlugs(paths);
  let slug = input.slug ? slugify(input.slug) : slugify(input.text, 48);
  if (existing.has(slug)) {
    let n = 2;
    while (existing.has(`${slug}-${n}`)) n += 1;
    slug = `${slug}-${n}`;
  }
  const text = input.text.replace(/\s+/g, " ").trim();
  const line = `- ${slug}: ${text} (${input.person.handle}, ${input.source}, ${today()})`;
  const lines = [line];
  if (input.detail && input.detail.trim()) {
    for (const d of input.detail.trim().split("\n")) lines.push(`  > ${d.trim()}`);
  }
  appendText(paths.intake, `${lines.join("\n")}\n`);
  return { slug, line };
}

/**
 * Remove a slug's intake lines, and the detail under each, once a brief has replaced them.
 *
 * Which lines those are is decided by `parseIntake` and not by a second pattern here. That is the
 * whole point: the intake header invites hand-written lines, and the parser accepts far more than
 * `- slug:` — any of `-`, `*`, `+`, a checkbox, up to three spaces of indent, a raw prefix it
 * slugifies (`Login_Retry:` becomes `login-retry`), and a bullet with no prefix at all whose slug
 * comes from its text. A shape the parser counts as an item but the remover misses would outlive
 * its own brief and sit in the queue for work the board already reports as shaped, with no verb
 * able to sweep it. Duplicated slugs are all removed, which is why triage reads every one of them
 * before this runs.
 */
export function removeFromIntake(paths: RepoPaths, slug: string): boolean {
  const content = readText(paths.intake);
  if (!content) return false;
  const starts = new Set(parseIntake(content).filter((i) => i.slug === slug).map((i) => i.line));
  if (starts.size === 0) return false;
  const out: string[] = [];
  let skipping = false;
  // `parseIntake` normalises CRLF before splitting, which changes no line count, so its 1-based
  // line numbers index this split too.
  content.split("\n").forEach((line, idx) => {
    if (starts.has(idx + 1)) {
      skipping = true;
      return;
    }
    if (skipping && /^\s+>/.test(line)) return;
    skipping = false;
    out.push(line);
  });
  writeText(paths.intake, out.join("\n"));
  return true;
}

export interface IntakeDetailInput {
  slug: string;
  /** One or more lines to add under the item, each becoming a `> ` detail line. */
  text: string;
  person: Person;
  source: string;
  /** The item's title, used only when the slug has no intake line yet (a backlog item, say). */
  title?: string;
}

export interface IntakeDetailResult {
  slug: string;
  /** The detail lines as they were written, without the `> ` prefix. */
  added: string[];
  /** True when no intake line existed for the slug and one was written to hold the detail. */
  createdLine: boolean;
}

/**
 * Add detail under an intake item: the user's answer to "what did you mean". It goes into the
 * same `> ` lines `capture --detail` writes, so every reader of the intake (the board, the
 * context pack, the shaping session) sees it without learning a new shape. An item that has no
 * intake line, because it came from the repo's own backlog, gets one so the detail has a home.
 */
export function addIntakeDetail(paths: RepoPaths, input: IntakeDetailInput): IntakeDetailResult {
  const lines = input.text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length === 0) throw new Error("nothing to add: the detail is empty.");
  const content = readText(paths.intake) ?? INTAKE_HEADER;
  const rows = content.replace(/\r\n/g, "\n").split("\n");
  const itemRe = new RegExp(`^ {0,3}[-*+]\\s+(?:\\[[ xX]\\]\\s+)?${input.slug.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}:\\s`);
  const at = rows.findIndex((row) => itemRe.test(row));
  const stamp = `(${input.person.handle}, ${input.source}, ${today()})`;
  const detail = lines.map((l, i) => `  > ${l}${i === lines.length - 1 ? ` ${stamp}` : ""}`);
  if (at === -1) {
    const title = (input.title ?? input.slug).replace(/\s+/g, " ").trim();
    const block = [`- ${input.slug}: ${title} ${stamp}`, ...detail].join("\n");
    const base = content.endsWith("\n") ? content : `${content}\n`;
    writeText(paths.intake, `${base}${block}\n`);
    return { slug: input.slug, added: lines, createdLine: true };
  }
  // Insert after the item's existing detail lines, so answers read in the order they were given.
  let end = at + 1;
  while (end < rows.length && /^\s+>/.test(rows[end] ?? "")) end += 1;
  rows.splice(end, 0, ...detail);
  writeText(paths.intake, rows.join("\n"));
  return { slug: input.slug, added: lines, createdLine: false };
}
