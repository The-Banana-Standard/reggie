import { INTAKE_HEADER } from "./layout.js";
import type { RepoPaths } from "./paths.js";
import type { Person } from "./people.js";
import { readIntake } from "./tasks.js";
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
  const existing = new Set(readIntake(paths).map((i) => i.slug));
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

/** Remove an intake line (and its detail lines) once a plan exists. */
export function removeFromIntake(paths: RepoPaths, slug: string): boolean {
  const content = readText(paths.intake);
  if (!content) return false;
  const lines = content.split("\n");
  const out: string[] = [];
  let skipping = false;
  let removed = false;
  for (const line of lines) {
    if (new RegExp(`^- ${slug}:\\s`).test(line)) {
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
