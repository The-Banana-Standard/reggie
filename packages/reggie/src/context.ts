import { existsSync } from "node:fs";
import path from "node:path";
import { parseBrief, type ParsedBrief } from "./brief.js";
import { collectFacts, summarizeFacts } from "./facts.js";
import { recentCommits } from "./git.js";
import { readJournal, renderJournalEntry } from "./journal.js";
import { buildKnowledgeInventory, buildRepositorySemanticIndex } from "./knowledge-jobs.js";
import { readKnowledge, renderKnowledgeRecord } from "./knowledge.js";
import { notesForPath, readNoteFile, staleEntriesFor, type NoteFile } from "./notes.js";
import { briefFile, planFile, type RepoPaths } from "./paths.js";
import type { ReggieConfig } from "./people.js";
import { parsePlan } from "./plan.js";
import { listTasks } from "./tasks.js";
import { readText, truncateLines, uniq } from "./util.js";

export interface ContextRequest {
  slug?: string;
  paths?: string[];
  maxLines?: number;
}

/**
 * The context pack: everything an agent should read before touching an area.
 * Assembled from notes, the plan, related tasks, recent commits, journal, and active work.
 */
export function buildContext(paths: RepoPaths, config: ReggieConfig, req: ContextRequest): string {
  const root = paths.root;
  const out: string[] = [];
  const facts = collectFacts(root);
  out.push(`# Context pack${req.slug ? ` for ${req.slug}` : ""}`, "", `Repo: ${summarizeFacts(facts)}`, "");

  let files: string[] = (req.paths ?? []).map((p) => p.replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/+$/, ""));
  let planTitle = "";
  let brief: ParsedBrief | null = null;
  if (req.slug) {
    // The brief is what the user said they want, decided before anyone planned how. It goes
    // above the plan so a planner reads the intent before the mechanics, and an executor can
    // tell a deviation from the plan apart from a deviation from the ask.
    const briefText = readText(briefFile(paths, req.slug));
    if (briefText) {
      brief = parseBrief(briefText);
      files = uniq([...files, ...briefAreaPaths(root, brief)]);
      out.push(...renderBriefBlock(brief));
    }
    const plan = readText(planFile(paths, req.slug));
    if (plan) {
      const parsed = parsePlan(plan);
      planTitle = parsed.meta.title;
      files = uniq([...files, ...parsed.files]);
      out.push(`## Plan: ${parsed.meta.title || req.slug} (risk ${parsed.meta.risk})`);
      out.push(truncateLines(parsed.sections.get("Problem") ?? "", 12));
      if (parsed.criteria.length > 0) {
        out.push("", "Acceptance criteria:", ...parsed.criteria.map((c) => `- ${c}`));
      }
      out.push("");
    } else {
      out.push(`## Plan: none yet for ${req.slug}`, "Write one with `reggie plan new " + req.slug + "` or in plan mode against the contract.", "");
    }
  }

  const shown: NoteFile[] = [];
  const seen = new Set<string>();
  const repoNote = readNoteFile(paths, "_repo");
  if (repoNote && !repoNote.retired) {
    shown.push(repoNote);
    seen.add(repoNote.file);
  }
  for (const f of files) {
    for (const note of notesForPath(paths, f)) {
      if (seen.has(note.file)) continue;
      seen.add(note.file);
      shown.push(note);
    }
  }
  const stale = new Set(staleEntriesFor(paths, shown).map((s) => `${s.entity}|${s.entry.date}|${s.entry.type}`));
  const basicKnowledge = new Map(shown.map((note) => [note.entity, readKnowledge(paths, note.entity)]));
  let fingerprints = new Map<string, string>();
  if ([...basicKnowledge.values()].some((record) => record?.current)) {
    try {
      fingerprints = new Map(buildKnowledgeInventory(paths, buildRepositorySemanticIndex(paths)).map((item) => [item.entity, item.fingerprint]));
    } catch {
      // Context must remain available when a repository cannot be semantically indexed. The
      // stored current text still renders; only its fingerprint comparison is unavailable.
    }
  }

  out.push("## Notes to read first");
  for (const note of shown) {
    const record = readKnowledge(paths, note.entity, fingerprints.get(note.entity) ?? null);
    if (record && !record.retired) out.push(renderKnowledgeRecord(record, { markStale: stale }));
  }
  if (shown.length === 0) out.push("(no notes yet; this area is undocumented. Write the first `why` and `how` notes as you learn it.)");
  out.push("");

  if (files.length > 0) {
    out.push("## Files in scope");
    for (const f of files) {
      const exists = existsSync(path.join(root, f));
      out.push(`- ${f}${exists ? "" : " (does not exist yet)"}`);
    }
    out.push("");
    const commits = recentCommits(root, files.filter((f) => existsSync(path.join(root, f))), 10);
    if (commits.length > 0) {
      out.push("## Recent commits touching these files");
      for (const c of commits) out.push(`- ${c.date} ${c.sha} ${c.author}: ${c.subject}`);
      out.push("");
    }
  }

  const tasks = listTasks(paths, config);
  const related = tasks.filter((t) => t.slug !== req.slug && t.planExists && overlaps(paths, t.slug, files));
  const active = tasks.filter((t) => t.slug !== req.slug && (t.state === "in-process" || t.state === "awaiting-decision"));
  if (related.length > 0) {
    out.push("## Related tasks touching the same files");
    for (const t of related) out.push(`- ${t.slug} (${t.state}${t.owner ? `, ${t.owner}` : ""}): ${t.title}`);
    out.push("");
  }
  if (active.length > 0) {
    out.push("## Active work elsewhere in the repo");
    for (const t of active) out.push(`- ${t.slug} (${t.state}${t.owner ? `, ${t.owner}` : ""}${t.branch ? `, ${t.branch}` : ""})`);
    out.push("");
  }

  const journal = readJournal(paths, req.slug ? { slug: req.slug, days: 30, limit: 12 } : { days: 7, limit: 8 });
  if (journal.length > 0) {
    out.push(req.slug ? `## Journal for ${req.slug}` : "## Recent journal");
    for (const e of journal) out.push(renderJournalEntry(e));
    out.push("");
  }

  out.push("## Working agreement");
  out.push("- Read the notes above before editing. After changing a file, add or correct its note.");
  // The entry is still asked for: derive fills in what git and a launched session's transcript hold, and nothing else.
  out.push(
    `- Write one plain-English journal entry after each step; \`reggie journal derive ${req.slug ?? "<slug>"}\` adds the commits and a launched session's closing words, not the reasons. Capture unrelated problems; do not fix them here.`,
  );
  if (planTitle) out.push("- Deviating from the plan is allowed; record the deviation and why in the completion packet.");
  if (brief && brief.questions.length > 0) out.push("- Answer the open questions above with the user before planning; if the user is not available, answer them yourself under Assumptions and say so.");

  const text = out.join("\n");
  return req.maxLines ? truncateLines(text, req.maxLines) : text;
}

function overlaps(paths: RepoPaths, slug: string, files: string[]): boolean {
  if (files.length === 0) return false;
  const plan = readText(planFile(paths, slug));
  if (!plan) return false;
  const planFiles = parsePlan(plan).files;
  return planFiles.some((pf) => files.some((f) => pf === f || pf.startsWith(`${f}/`) || f.startsWith(`${pf}/`)));
}

/** The brief as the head of the pack: the ask, why it matters now, what it is not, and what is still open. */
function renderBriefBlock(brief: ParsedBrief): string[] {
  const out: string[] = [];
  const shaping = [brief.meta.priority, brief.meta.size, brief.meta.risk === "unset" ? "" : `${brief.meta.risk} risk`, brief.meta.area].filter((v) => v && v !== "unset");
  out.push(`## What the user is asking for${brief.meta.title ? `: ${brief.meta.title}` : ""}`);
  if (shaping.length > 0) out.push(`(${shaping.join(" · ")})`);
  const problem = sectionText(brief, "Problem");
  out.push(problem || "(the brief's Problem section is empty)");
  const why = sectionText(brief, "Why now");
  if (why) out.push("", "Why now: " + why);
  const not = sectionText(brief, "Not this");
  if (not) out.push("", "Not this: " + not);
  if (brief.areas.length > 0) out.push("", "Suspected area:", ...brief.areas.map((a) => `- ${a}`));
  out.push("");
  if (brief.questions.length > 0) {
    out.push("## Open questions still open", ...brief.questions.map((q) => `- ${q}`), "");
  }
  return out;
}

/** A brief section as one block of prose, placeholders dropped; empty when nothing real is there. */
function sectionText(brief: ParsedBrief, name: string): string {
  const raw = (brief.sections.get(name) ?? "").trim();
  if (!raw) return "";
  const lines = raw.split("\n").map((l) => l.trim()).filter((l) => l && !/^\(.*\)$/.test(l));
  return lines.join("\n");
}

/** Paths the brief's Suspected area bullets name, when they exist: the planner starts reading there. */
function briefAreaPaths(root: string, brief: ParsedBrief): string[] {
  const found: string[] = [];
  for (const bullet of brief.areas) {
    const first = bullet.trim().split(/\s+/)[0] ?? "";
    const clean = first.replace(/^[`"']+|[`"',:;]+$/g, "").replace(/\/+$/, "");
    if (!clean || clean.startsWith("(") || clean.includes("..")) continue;
    if (existsSync(path.join(root, clean))) found.push(clean);
  }
  return found;
}
