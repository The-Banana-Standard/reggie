import { parseBrief, PRIORITIES, renderBriefTemplate, SIZES, type BriefTemplateInput, type Priority, type Size } from "./brief.js";
import { removeFromIntake } from "./capture.js";
import { briefFile, type RepoPaths } from "./paths.js";
import { RISKS, type Risk } from "./plan.js";
import { readIntake, type IntakeItem } from "./tasks.js";
import { isSafeSlug, readText, writeText } from "./util.js";

/**
 * Triage: the step that turns a raw intake line into the scaffold of
 * `.reggie/tasks/<slug>/brief.md`, and takes the line as it does — the brief is the better record
 * of the same item from that moment on, and two records of one item drift apart. It leaves the
 * thinking to whoever fills the scaffold in, and until they do the task is still reported
 * `ungroomed`, so nothing leaves the queue here; it only moves from a file to a card. Shared by
 * `reggie triage` and POST /api/triage so the CLI and the page produce byte-identical briefs.
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
  /** How many intake lines carrying this slug the write took with it; 0 when it wrote nothing. */
  intakeRemoved: number;
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
 * Scaffold `.reggie/tasks/<slug>/brief.md`, prefilled from the intake lines the way
 * `reggie plan new` prefills a plan, then take those lines. Never overwrites without `force`:
 * a brief holds thinking that no template can reproduce.
 *
 * Two orderings here are load-bearing. The removal happens after the write and only when the
 * write happened, so a throw above leaves the line where it was rather than destroying both
 * records at once. And every line carrying the slug is read, not just the first, because
 * removal takes them all: reading one and deleting two loses the second wording silently.
 */
export function scaffoldBrief(paths: RepoPaths, input: TriageInput): TriageResult {
  if (!isSafeSlug(input.slug)) {
    throw new Error(`"${input.slug}" is not a valid slug. Use lowercase letters, digits, and hyphens.`);
  }
  const file = briefFile(paths, input.slug);
  const existing = readText(file);
  if (existing !== null && !input.force) return { slug: input.slug, file, created: false, skipped: true, intakeRemoved: 0 };

  const items = readIntake(paths).filter((i) => i.slug === input.slug);
  // Under `--force` the line is usually long gone, and the brief is then the only place the
  // captured words still live: fall back to it rather than overwriting them with the hint.
  const previous = existing !== null ? parseBrief(existing) : null;
  const priorProblem = previous?.problem ? (previous.sections.get("Problem") ?? "").trim() : "";
  const title = oneLine(input.title ?? items[0]?.text ?? previous?.meta.title ?? input.slug) || input.slug;
  const template: BriefTemplateInput = { slug: input.slug, title, author: input.author };
  if (input.area !== undefined) template.area = input.area;
  if (input.size !== undefined) template.size = input.size;
  if (input.risk !== undefined) template.risk = input.risk;
  if (input.priority !== undefined) template.priority = input.priority;
  const problem = items.length ? items.map(problemFrom).filter(Boolean).join("\n\n") : priorProblem;
  if (problem) template.problem = problem;

  writeText(file, renderBriefTemplate(template));
  const intakeRemoved = items.length > 0 && removeFromIntake(paths, input.slug) ? items.length : 0;
  return { slug: input.slug, file, created: existing === null, skipped: false, intakeRemoved };
}
