import { existsSync } from "node:fs";
import path from "node:path";
import { collectFacts, summarizeFacts } from "./facts.js";
import { recentCommits } from "./git.js";
import { readJournal, renderJournalEntry } from "./journal.js";
import { notesForPath, readNoteFile, renderNoteFile, staleEntries } from "./notes.js";
import { planFile, type RepoPaths } from "./paths.js";
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
  if (req.slug) {
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

  const stale = new Set(staleEntries(paths).map((s) => `${s.entity}|${s.entry.date}|${s.entry.type}`));

  out.push("## Notes to read first");
  const repoNote = readNoteFile(paths, "_repo");
  const seen = new Set<string>();
  if (repoNote) {
    out.push(renderNoteFile(repoNote, { markStale: stale }));
    seen.add(repoNote.file);
  }
  for (const f of files) {
    for (const note of notesForPath(paths, f)) {
      if (seen.has(note.file)) continue;
      seen.add(note.file);
      out.push(renderNoteFile(note, { markStale: stale }));
    }
  }
  if (seen.size === 0) out.push("(no notes yet; this area is undocumented. Write the first `why` and `how` notes as you learn it.)");
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
  out.push("- Write one plain-English journal entry after each step. Capture unrelated problems; do not fix them here.");
  if (planTitle) out.push("- Deviating from the plan is allowed; record the deviation and why in the completion packet.");

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
