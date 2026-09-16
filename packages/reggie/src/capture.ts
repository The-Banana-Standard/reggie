import { INTAKE_HEADER } from "./layout.js";
import type { RepoPaths } from "./paths.js";
import type { Person } from "./people.js";
import { knownSlugs } from "./tasks.js";
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
 * Every bullet shape `parseIntake` accepts as an item is matched, because the intake header
 * invites hand-written lines: a line the parser counts and this does not would survive its own
 * brief and sit in the queue for work the board already reports as shaped. Duplicated slugs are
 * all removed, which is why triage reads every one of them before this runs.
 */
export function removeFromIntake(paths: RepoPaths, slug: string): boolean {
  const content = readText(paths.intake);
  if (!content) return false;
  const lines = content.split("\n");
  const itemRe = new RegExp(`^ {0,3}[-*+]\\s+(?:\\[[ xX]\\]\\s+)?${slug.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}:\\s`);
  const out: string[] = [];
  let skipping = false;
  let removed = false;
  for (const line of lines) {
    if (itemRe.test(line)) {
      skipping = true;
      removed = true;
      continue;
    }
    if (skipping && /^\s+>/.test(line)) continue;
    skipping = false;
    out.push(line);
  }
  if (removed) writeText(paths.intake, out.join("\n"));
  return removed;
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
