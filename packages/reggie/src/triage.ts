import { PRIORITIES, renderBriefTemplate, SIZES, type BriefTemplateInput, type Priority, type Size } from "./brief.js";
import { briefFile, type RepoPaths } from "./paths.js";
import { RISKS, type Risk } from "./plan.js";
import { readIntake, type IntakeItem } from "./tasks.js";
import { isSafeSlug, readText, writeText } from "./util.js";

/**
 * Triage: the shaping step between `ungroomed` and `groomed`. It writes the scaffold of
 * `.reggie/tasks/<slug>/brief.md` from what the repo already knows — the intake line — and
 * leaves the thinking to whoever fills it in. Shared by `reggie triage` and POST /api/triage
 * so the CLI and the page produce byte-identical briefs.
 */

export interface TriageInput {
  slug: string;
  /** Goes into the brief's `author` front matter. */
  author: string;
  /** Overrides the intake line as the title. */
  title?: string;
  /** A repo-relative directory the work probably touches. */
  area?: string;
  size?: Size;
  risk?: Risk;
  priority?: Priority;
  /** Rewrite a brief that is already there, discarding what triage wrote before. */
  force?: boolean;
}

export interface TriageResult {
  slug: string;
  file: string;
  /** A brief was written where there was none. */
  created: boolean;
  /** A brief was already there and `force` was not set; nothing was written. */
  skipped: boolean;
}

export function isSize(value: string): value is Size {
  return (SIZES as readonly string[]).includes(value);
}

export function isPriority(value: string): value is Priority {
  return (PRIORITIES as readonly string[]).includes(value);
}

export function isRisk(value: string): value is Risk {
  return (RISKS as readonly string[]).includes(value);
}

/** Front matter is line-oriented, so a title can never carry a newline into it. */
function oneLine(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/** The intake line plus its detail lines: the one paragraph triage starts the Problem from. */
function problemFrom(item: IntakeItem): string {
  return [item.text, ...item.detail].map((l) => l.trim()).filter(Boolean).join("\n");
}

/**
 * Scaffold `.reggie/tasks/<slug>/brief.md`, prefilled from the intake line the way
 * `reggie plan new` prefills a plan. Never overwrites without `force`: a brief holds
 * thinking that no template can reproduce.
 */
export function scaffoldBrief(paths: RepoPaths, input: TriageInput): TriageResult {
  if (!isSafeSlug(input.slug)) {
    throw new Error(`"${input.slug}" is not a valid slug. Use lowercase letters, digits, and hyphens.`);
  }
  const file = briefFile(paths, input.slug);
  const existing = readText(file);
  if (existing !== null && !input.force) return { slug: input.slug, file, created: false, skipped: true };

  const item = readIntake(paths).find((i) => i.slug === input.slug) ?? null;
  const title = oneLine(input.title ?? item?.text ?? input.slug) || input.slug;
  const template: BriefTemplateInput = { slug: input.slug, title, author: input.author };
  if (input.area !== undefined) template.area = input.area;
  if (input.size !== undefined) template.size = input.size;
  if (input.risk !== undefined) template.risk = input.risk;
  if (input.priority !== undefined) template.priority = input.priority;
  const problem = item ? problemFrom(item) : "";
  if (problem) template.problem = problem;

  writeText(file, renderBriefTemplate(template));
  return { slug: input.slug, file, created: existing === null, skipped: false };
}
