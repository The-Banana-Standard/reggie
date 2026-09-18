import { createHash } from "node:crypto";
import type { RiskRules } from "./people.js";
import { splitFrontMatter, today } from "./util.js";

export type Risk = "low" | "medium" | "high";
export const RISKS: Risk[] = ["low", "medium", "high"];

export const PLAN_SECTIONS = [
  "Problem",
  "Approach",
  "Files to touch",
  "Acceptance criteria",
  "Verification strategy",
  "Assumptions",
  "Out of scope",
  "Bail conditions",
] as const;
export type PlanSection = (typeof PLAN_SECTIONS)[number];

export interface PlanMeta {
  slug: string;
  title: string;
  risk: Risk | "unset";
  deciders: string[];
  author: string;
  created: string;
}

export interface ParsedPlan {
  meta: PlanMeta;
  sections: Map<string, string>;
  criteria: string[];
  files: string[];
}

export interface PlanTemplateInput {
  slug: string;
  title: string;
  author: string;
  risk?: Risk;
  problem?: string;
  files?: string[];
  deciders?: string[];
}

/** A fresh plan.md. Placeholder lines are wrapped in parentheses; the linter refuses a plan that still has them. */
export function renderPlanTemplate(input: PlanTemplateInput): string {
  const files = input.files && input.files.length > 0 ? input.files.map((f) => `- ${f} (MOD)`).join("\n") : "- (list each file as path (NEW|MOD|DEL); Reggie computes blast radius from this list)";
  const deciders = input.deciders && input.deciders.length > 0 ? input.deciders.join(", ") : "";
  return [
    "---",
    `slug: ${input.slug}`,
    `title: ${input.title}`,
    `risk: ${input.risk ?? "unset"}`,
    `deciders: [${deciders}]`,
    `author: ${input.author}`,
    `created: ${today()}`,
    "---",
    `# ${input.title}`,
    "",
    "## Problem",
    input.problem?.trim() || "(what is wrong or missing, who feels it, and how you know)",
    "",
    "## Approach",
    "(the shape of the change in plain words; name the alternative you rejected and why)",
    "",
    "## Files to touch",
    files,
    "",
    "## Acceptance criteria",
    "- [ ] (one checkable statement per line; a reviewer must be able to say yes or no without asking)",
    "",
    "## Verification strategy",
    "- (for each criterion above: the command, test name, or observation that proves it, and where the evidence file will live)",
    "",
    "## Assumptions",
    "- (every question you would have asked, with the answer you chose and the alternative; write \"none\" if there are none)",
    "",
    "## Out of scope",
    "- (what this task deliberately does not do)",
    "",
    "## Bail conditions",
    "- (what discovery would mean this plan is wrong and the task should go back to its brief, groomed but unplanned)",
    "",
  ].join("\n");
}

export function parsePlan(content: string): ParsedPlan {
  const { front, body } = splitFrontMatter(content);
  const meta: PlanMeta = { slug: "", title: "", risk: "unset", deciders: [], author: "", created: "" };
  if (front) {
    for (const raw of front.split("\n")) {
      const m = /^(\w+):\s*(.*)$/.exec(raw.trim());
      if (!m) continue;
      const key = m[1] ?? "";
      const value = (m[2] ?? "").trim();
      if (key === "slug") meta.slug = value;
      if (key === "title") meta.title = value.replace(/^["']|["']$/g, "");
      if (key === "risk") meta.risk = (RISKS as string[]).includes(value) ? (value as Risk) : "unset";
      if (key === "author") meta.author = value;
      if (key === "created") meta.created = value;
      if (key === "deciders") {
        meta.deciders = value
          .replace(/^\[|\]$/g, "")
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean);
      }
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
  const criteria = planCriteria(sections.get("Acceptance criteria") ?? "").map((c) => c.text);
  const files = (sections.get("Files to touch") ?? "")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => /^-\s+\S/.test(l) && !isPlaceholder(l))
    .map((l) => l.replace(/^-\s+/, "").replace(/\s*\((NEW|MOD|DEL)\)\s*$/i, "").replace(/^`|`$/g, "").trim())
    .filter(Boolean);
  return { meta, sections, criteria, files };
}

export interface PlanCriterion {
  /** 1-based position in the section. For people; a check is never keyed by it, because renumbering would move a pass onto other words. */
  n: number;
  /** The criterion's first line without its checkbox: what `parsePlan` has always returned. */
  text: string;
  /** `c:` and twelve hex characters of the SHA-256 of the whole bullet; the second of two identical bullets gets `#2`. */
  key: string;
}

const CRITERION_RE = /^- \[[ xX]\]\s+/;

/**
 * The acceptance criteria of a plan, walked once: each `- [ ]` line is a criterion, and the indented
 * lines under it belong to it. The key is a hash of the whole bullet with whitespace collapsed, so
 * reordering or renumbering changes nothing, one changed word on any of its lines makes a new key,
 * and a check recorded against the old words cannot count for the new ones. Identical bullets are
 * told apart by `#2`, `#3` in the order they appear.
 */
export function planCriteria(section: string): PlanCriterion[] {
  const bullets: { text: string; rest: string[] }[] = [];
  let current: { text: string; rest: string[] } | null = null;
  for (const raw of section.split("\n")) {
    const line = raw.trim();
    if (CRITERION_RE.test(line)) {
      current = { text: line.replace(CRITERION_RE, "").trim(), rest: [] };
      bullets.push(current);
    } else if (line === "") {
      // A blank line inside a bullet does not end it; the next line decides.
    } else if (current && /^\s/.test(raw)) {
      current.rest.push(line);
    } else {
      current = null;
    }
  }
  const seen = new Map<string, number>();
  return bullets.map((b, i) => {
    const whole = [b.text, ...b.rest].join(" ").replace(/\s+/g, " ").trim();
    const base = `c:${createHash("sha256").update(whole, "utf8").digest("hex").slice(0, 12)}`;
    const count = (seen.get(base) ?? 0) + 1;
    seen.set(base, count);
    return { n: i + 1, text: b.text, key: count === 1 ? base : `${base}#${count}` };
  });
}

export interface LintResult {
  ok: boolean;
  errors: string[];
  warnings: string[];
}

function isPlaceholder(line: string): boolean {
  const t = line.replace(/^-\s+(\[[ xX]\]\s+)?/, "").trim();
  return /^\(.*\)$/.test(t);
}

const VAGUE = /\b(works|is good|is better|looks fine|handles it|should work|as expected)\b/i;

/** The plan contract. Errors block; warnings are advice. */
export function lintPlan(content: string): LintResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const plan = parsePlan(content);

  if (!plan.meta.slug) errors.push("front matter: missing slug");
  if (!plan.meta.title) errors.push("front matter: missing title");
  if (plan.meta.risk === "unset") errors.push("front matter: risk must be low, medium, or high (run `reggie plan risk <slug>` to compute it)");

  for (const section of PLAN_SECTIONS) {
    const text = plan.sections.get(section);
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

  if (plan.sections.has("Acceptance criteria")) {
    if (plan.criteria.length === 0) errors.push("Acceptance criteria: need at least one `- [ ]` item");
    for (const c of plan.criteria) {
      if (c.length < 15) errors.push(`Acceptance criteria: too short to be checkable: "${c}"`);
      if (VAGUE.test(c)) warnings.push(`Acceptance criteria: vague wording, say what a reviewer would observe: "${c}"`);
    }
  }

  if (plan.sections.has("Verification strategy")) {
    const bullets = (plan.sections.get("Verification strategy") ?? "").split("\n").filter((l) => /^\s*-\s+\S/.test(l));
    if (bullets.length === 0) errors.push("Verification strategy: need at least one bullet");
    else if (plan.criteria.length > 0 && bullets.length < plan.criteria.length) {
      warnings.push(`Verification strategy: ${bullets.length} bullets for ${plan.criteria.length} criteria; each criterion should name its evidence`);
    }
  }

  if (plan.sections.has("Files to touch") && plan.files.length === 0) errors.push("Files to touch: list at least one file");
  if (plan.sections.has("Bail conditions")) {
    const bullets = (plan.sections.get("Bail conditions") ?? "").split("\n").filter((l) => /^\s*-\s+\S/.test(l));
    if (bullets.length === 0) errors.push("Bail conditions: need at least one bullet");
  }

  return { ok: errors.length === 0, errors, warnings };
}

/** Risk class from the files a plan touches. Patterns are case-insensitive substrings of the path. */
export function riskFromFiles(files: string[], rules: RiskRules): Risk {
  const lower = files.map((f) => f.toLowerCase());
  const hit = (patterns: string[]) => patterns.some((p) => lower.some((f) => f.includes(p.toLowerCase())));
  if (hit(rules.high)) return "high";
  if (hit(rules.medium)) return "medium";
  if (files.length > 12) return "medium";
  return "low";
}

/** Rewrite the risk line in a plan's front matter. */
export function setPlanRisk(content: string, risk: Risk): string {
  if (/^risk:\s*.*$/m.test(content.split("\n---")[0] ?? "")) {
    return content.replace(/^risk:\s*.*$/m, `risk: ${risk}`);
  }
  return content.replace(/^---\n/, `---\nrisk: ${risk}\n`);
}
