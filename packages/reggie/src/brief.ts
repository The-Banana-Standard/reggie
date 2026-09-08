import { RISKS, type LintResult, type Risk } from "./plan.js";
import { splitFrontMatter, today } from "./util.js";

export type { LintResult };

export type Size = "small" | "medium" | "large";
export const SIZES: Size[] = ["small", "medium", "large"];

export type Priority = "P1" | "P2" | "P3";
export const PRIORITIES: Priority[] = ["P1", "P2", "P3"];

export const BRIEF_SECTIONS = ["Problem", "Why now", "Suspected area", "Open questions", "Not this"] as const;
export type BriefSection = (typeof BRIEF_SECTIONS)[number];

export interface BriefMeta {
  slug: string;
  title: string;
  /** A repo-relative directory the work probably touches, or "" when triage could not name one. */
  area: string;
  size: Size | "unset";
  risk: Risk | "unset";
  priority: Priority | "unset";
  author: string;
  created: string;
}

export interface ParsedBrief {
  meta: BriefMeta;
  sections: Map<string, string>;
  /** The first paragraph of ## Problem, trimmed; the one line a card shows. */
  problem: string;
  /** Bullets under ## Suspected area, without their leading dash; placeholders dropped. */
  areas: string[];
  /** Bullets under ## Open questions, without their leading dash; placeholders dropped. */
  questions: string[];
}

export interface BriefTemplateInput {
  slug: string;
  title: string;
  author: string;
  area?: string;
  size?: Size;
  risk?: Risk;
  priority?: Priority;
  problem?: string;
}

/**
 * A fresh brief.md. Every placeholder line is wrapped in parentheses, exactly as the plan template
 * does, so a scaffolded brief fails `lintBrief` until triage has actually filled it in.
 */
export function renderBriefTemplate(input: BriefTemplateInput): string {
  return [
    "---",
    `slug: ${input.slug}`,
    `title: ${input.title}`,
    `area: ${input.area ?? ""}`,
    `size: ${input.size ?? "unset"}`,
    `risk: ${input.risk ?? "unset"}`,
    `priority: ${input.priority ?? "unset"}`,
    `author: ${input.author}`,
    `created: ${today()}`,
    "---",
    `# ${input.title}`,
    "",
    "## Problem",
    input.problem?.trim() || "(what is wrong or missing, in plain English: who feels it and what they cannot do today)",
    "",
    "## Why now",
    "(what makes this worth shaping ahead of the rest of the backlog, or what gets worse while it waits)",
    "",
    "## Suspected area",
    "- (one bullet per file or directory the work probably touches, with a short reason; guessing from the graph and the notes is fine)",
    "",
    "## Open questions",
    "- (each question whose answer would change the shape of the work; write \"none\" if there are none)",
    "",
    "## Not this",
    "- (the nearby work a reader might confuse this with, and why it is a separate task)",
    "",
  ].join("\n");
}

/** A line that is still the scaffold's parenthesised hint rather than real content. */
function isPlaceholder(line: string): boolean {
  const t = line.replace(/^-\s+(\[[ xX]\]\s+)?/, "").trim();
  return /^\(.*\)$/.test(t);
}

/** The bullets of a section, minus their dashes and minus any placeholder hint. */
function bullets(section: string | undefined): string[] {
  return (section ?? "")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => /^-\s+\S/.test(l) && !isPlaceholder(l))
    .map((l) => l.replace(/^-\s+/, "").trim())
    .filter(Boolean);
}

/** The first paragraph of a section: everything up to the first blank line. */
function firstParagraph(section: string | undefined): string {
  const text = (section ?? "").trim();
  if (!text) return "";
  const para = text.split(/\n\s*\n/)[0] ?? "";
  return para.split("\n").map((l) => l.trim()).filter(Boolean).join(" ").trim();
}

export function parseBrief(content: string): ParsedBrief {
  const { front, body } = splitFrontMatter(content);
  const meta: BriefMeta = { slug: "", title: "", area: "", size: "unset", risk: "unset", priority: "unset", author: "", created: "" };
  if (front) {
    for (const raw of front.split("\n")) {
      const m = /^(\w+):\s*(.*)$/.exec(raw.trim());
      if (!m) continue;
      const key = m[1] ?? "";
      const value = (m[2] ?? "").trim();
      if (key === "slug") meta.slug = value;
      if (key === "title") meta.title = value.replace(/^["']|["']$/g, "");
      if (key === "area") meta.area = value.replace(/^["']|["']$/g, "");
      if (key === "size") meta.size = (SIZES as string[]).includes(value) ? (value as Size) : "unset";
      if (key === "risk") meta.risk = (RISKS as string[]).includes(value) ? (value as Risk) : "unset";
      if (key === "priority") meta.priority = (PRIORITIES as string[]).includes(value) ? (value as Priority) : "unset";
      if (key === "author") meta.author = value;
      if (key === "created") meta.created = value;
    }
  }
  const sections = new Map<string, string>();
  let current: string | null = null;
  const buffer: string[] = [];
  const flush = () => {
    if (current !== null) sections.set(current, buffer.join("\n").trim());
    buffer.length = 0;
  };
  for (const line of body.split("\n")) {
    const h = /^##\s+(.+?)\s*$/.exec(line);
    if (h) {
      flush();
      current = (h[1] ?? "").trim();
      continue;
    }
    if (/^#\s+/.test(line) && current === null) {
      if (!meta.title) meta.title = line.replace(/^#\s+/, "").trim();
      continue;
    }
    if (current !== null) buffer.push(line);
  }
  flush();
  const problemText = sections.get("Problem");
  const problem = isPlaceholder(problemText ?? "") ? "" : firstParagraph(problemText);
  return { meta, sections, problem, areas: bullets(sections.get("Suspected area")), questions: bullets(sections.get("Open questions")) };
}

/**
 * The brief contract, mirroring `lintPlan`: every section present and non-empty, no scaffold
 * placeholder left behind, nothing unresolved, and a size and a priority chosen. Errors block;
 * warnings are advice. A brief is written from the intake line, the graph and the notes, so it
 * asks far less than a plan does.
 */
export function lintBrief(content: string): LintResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const brief = parseBrief(content);

  if (!brief.meta.slug) errors.push("front matter: missing slug");
  if (!brief.meta.title) errors.push("front matter: missing title");
  if (brief.meta.size === "unset") errors.push("front matter: size must be small, medium, or large");
  if (brief.meta.priority === "unset") errors.push("front matter: priority must be P1, P2, or P3");
  if (brief.meta.risk === "unset") warnings.push("front matter: risk is unset; the plan will settle it, but a guess helps triage order the work");
  if (!brief.meta.area) warnings.push("front matter: area is empty; name the directory the work probably lands in");

  for (const section of BRIEF_SECTIONS) {
    const text = brief.sections.get(section);
    if (text === undefined) {
      errors.push(`missing section: ## ${section}`);
      continue;
    }
    const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
    if (lines.length === 0) {
      errors.push(`empty section: ## ${section}`);
      continue;
    }
    if (lines.some(isPlaceholder)) errors.push(`placeholder text still present in ## ${section}`);
    if (/\b(TBD|TODO|\?\?\?)\b/.test(text)) errors.push(`unresolved TBD/TODO in ## ${section}`);
  }

  if (brief.sections.has("Problem") && brief.problem && brief.problem.length < 30) {
    warnings.push(`Problem: too short to shape the work from: "${brief.problem}"`);
  }
  if (brief.sections.has("Suspected area") && brief.areas.length === 0) {
    warnings.push("Suspected area: name at least one file or directory as a bullet, so the plan knows where to start reading");
  }

  return { ok: errors.length === 0, errors, warnings };
}
