import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { cleanLine, evidencePath, latestRecords, readChecks, type CheckRecord } from "./checks.js";
import { branchExists, changedFiles, currentBranch, defaultBranch, diffStat, fileAtRef, listTreeLong, listWorktrees, type GitRunner } from "./git.js";
import { checksFile, evidenceDir, evidenceRelDir, packetFile, packetRelPath, planFile, type RepoPaths } from "./paths.js";
import type { ReggieConfig } from "./people.js";
import { parsePlan, planCriteria, type PlanCriterion } from "./plan.js";
import { readText, relPosix, splitFrontMatter, today, upsertFrontMatter, writeText } from "./util.js";

export type Verdict = "pending" | "approved" | "needs-work";
export const VERDICTS: Verdict[] = ["pending", "approved", "needs-work"];

/** The acceptance checklist sits between these two lines and is rebuilt from the check records, never edited. */
export const CHECKS_START = "<!-- reggie:checks:start -->";
export const CHECKS_END = "<!-- reggie:checks:end -->";

/** The sections a packet must hold, in the order the scaffold writes them. */
export const PACKET_SECTIONS = ["Acceptance criteria", "Evidence", "Changes", "Reviews", "Deviations from plan", "Discovered issues", "Open risks"] as const;

/** A refusal of `reggie packet`. Nothing was written. */
export class PacketError extends Error {}

export interface PacketInput {
  slug: string;
  author: string;
  /** Overwrite an existing packet. Without it, an existing packet keeps everything outside its generated checklist. */
  force?: boolean;
}

/**
 * What a run of `reggie packet` did: `created` a packet, `rewrote` one whole under `--force`,
 * `refreshed` the generated checklist of an existing one, found it `current`, or found a packet with
 * no markers, which `predates` check records and is left byte-identical.
 */
export type PacketStatus = "created" | "rewrote" | "refreshed" | "current" | "predates";

export interface PacketResult {
  file: string;
  status: PacketStatus;
  /** True when the file did not exist before this run. */
  created: boolean;
  /** True when an existing packet was kept: everything outside its checklist is as it was. */
  skipped: boolean;
}

/**
 * Scaffold packet.md from the plan, or refresh the generated checklist of the one that exists. The
 * checklist is built from the check records and nothing else; changes come from git and the evidence
 * folder is listed. It writes a file and does nothing more: it never evaluates the policy, never
 * records a verdict and never merges.
 */
export function scaffoldPacket(paths: RepoPaths, config: ReggieConfig, input: PacketInput): PacketResult {
  const file = packetFile(paths, input.slug);
  assertTaskCheckout(paths.root, input.slug);
  const plan = readText(planFile(paths, input.slug));
  const existing = readText(file);
  if (existing !== null && !input.force) {
    // With no plan in this checkout there is nothing to derive a checklist from; the packet is kept as it is.
    const next = plan === null ? existing : replaceChecklist(existing, currentChecklist(paths, input.slug, plan));
    if (next === null) return { file, status: "predates", created: false, skipped: true };
    if (next === existing) return { file, status: "current", created: false, skipped: true };
    writeText(file, next);
    return { file, status: "refreshed", created: false, skipped: true };
  }
  if (!plan) throw new Error(`No plan for ${input.slug}. Write one with \`reggie plan new ${input.slug}\` first.`);
  const parsed = parsePlan(plan);
  const base = defaultBranch(paths.root, config.defaultBranch);
  const branch = currentBranch(paths.root);
  const stat = diffStat(paths.root, base);
  const files = changedFiles(paths.root, base);
  const evidence = listEvidence(paths, input.slug);

  const content = [
    "---",
    `slug: ${input.slug}`,
    `title: ${parsed.meta.title || input.slug}`,
    `risk: ${parsed.meta.risk}`,
    `author: ${input.author}`,
    `date: ${today()}`,
    `branch: ${branch}`,
    `base: ${base}`,
    "verdict: pending",
    "decided_by:",
    "decided_at:",
    "---",
    `# Completion: ${parsed.meta.title || input.slug}`,
    "",
    "Read this top to bottom to decide whether the work is done. Every claim should point at evidence.",
    "",
    "## Acceptance criteria",
    currentChecklist(paths, input.slug, plan),
    "",
    "## Evidence",
    evidence.length > 0 ? evidence.map((e) => `- ${e}`).join("\n") : `- (none yet; put test output, screenshots, and command output under ${relPosix(paths.root, evidenceDir(paths, input.slug))}/)`,
    "",
    "## Changes",
    files.length > 0 ? `${files.length} files changed against ${base}:\n\n\`\`\`\n${stat}\n\`\`\`` : `(no commits ahead of ${base} yet)`,
    "",
    "## Reviews",
    "- (which review commands ran, what they found, and how each finding was resolved)",
    "",
    "## Deviations from plan",
    "- (what was done differently from plan.md and why; write \"none\" if none)",
    "",
    "## Discovered issues",
    "- (unrelated problems found on the way, one bullet each, or \"none\"; an approval captures every bullet that is not in intake yet)",
    "",
    "## Open risks",
    "- (what could still be wrong and how someone would notice)",
    "",
  ].join("\n");

  writeText(file, content);
  return { file, status: existing === null ? "created" : "rewrote", created: existing === null, skipped: false };
}

/**
 * `reggie packet` belongs in the task's own checkout: the packet, the records and the evidence ride
 * the branch. Typed anywhere else while `task/<slug>` exists it would scaffold a second, empty packet
 * as an untracked file, which then blocks the landing; so it refuses and says where the branch is.
 * With no such branch there is nothing to confuse it with, and it runs as it always has.
 */
export function assertTaskCheckout(root: string, slug: string): void {
  const branch = `task/${slug}`;
  const on = currentBranch(root);
  if (on === branch || !branchExists(root, branch)) return;
  const where = listWorktrees(root).find((w) => w.branch === branch);
  throw new PacketError(
    `this checkout is on ${on}, not ${branch}. ${where ? `That branch is checked out in ${where.path}; run \`reggie packet ${slug}\` there.` : `Switch to ${branch} first; the packet rides the task branch.`}`,
  );
}

/** The checklist as the records on disk render it against the plan given. */
function currentChecklist(paths: RepoPaths, slug: string, plan: string): string {
  const criteria = planCriteria(parsePlan(plan).sections.get("Acceptance criteria") ?? "");
  return renderChecklist(criteria, readChecks(readText(checksFile(paths, slug)) ?? "").records);
}

/**
 * The generated checklist, markers included: per criterion of the plan a box that is ticked only
 * when the latest record for its key passes, an `evidence:` line holding that record's paths and
 * nothing else, and a `check:` line saying what was recorded, by whom, with what, when, and the key.
 * No evidence file is ever paired with a criterion that no record names. Every value that came out
 * of a record is cleaned to one line first: a record is a file anyone on the branch can write, and a
 * line break in a name must not be able to forge a ticked box.
 */
export function renderChecklist(criteria: readonly PlanCriterion[], records: readonly CheckRecord[]): string {
  const latest = latestRecords(records);
  const lines = [CHECKS_START, "<!-- Generated by `reggie packet` from checks.jsonl. Do not edit between these markers: record a check with `reggie check`, then run `reggie packet` again. -->"];
  if (criteria.length === 0) lines.push("- [ ] (the plan had no criteria; state what was verified)");
  for (const c of criteria) {
    const r = latest.get(c.key);
    lines.push(`- [${r?.outcome === "pass" ? "x" : " "}] ${c.text}`);
    lines.push(`  evidence: ${r && r.evidence.length > 0 ? r.evidence.map((e) => cleanLine(e, 300)).join(", ") : "(none)"}`);
    lines.push(`  check: ${r ? `${r.outcome} by ${cleanLine(r.person, 60) || "unknown"} (${cleanLine(r.tool, 40) || "unknown"}) at ${cleanLine(r.at, 40)}` : "none recorded"} · ${c.key}`);
  }
  lines.push(CHECKS_END);
  return lines.join("\n");
}

/** The text between the markers, markers included; null when the packet has no well-formed pair. */
export function extractChecklist(content: string): string | null {
  const start = content.indexOf(CHECKS_START);
  const end = content.indexOf(CHECKS_END);
  if (start < 0 || end < start) return null;
  return content.slice(start, end + CHECKS_END.length);
}

/** The packet with its checklist replaced and every other byte kept; null when it has no markers. */
function replaceChecklist(content: string, block: string): string | null {
  const old = extractChecklist(content);
  if (old === null) return null;
  const start = content.indexOf(CHECKS_START);
  return content.slice(0, start) + block + content.slice(start + old.length);
}

export function listEvidence(paths: RepoPaths, slug: string): string[] {
  const dir = evidenceDir(paths, slug);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((n) => !n.startsWith("."))
    .sort()
    .map((n) => relPosix(paths.root, path.join(dir, n)));
}

// ---------------------------------------------------------------------------
// Evidence references, citations, and the gate
// ---------------------------------------------------------------------------

/** What a path looks like: it holds a slash, or it ends in an extension. `none` and `1052` are words, not paths. */
function pathShaped(token: string): boolean {
  return token.includes("/") || /\.\w+$/.test(token);
}

/** The reader this replaced, kept whole so that nothing it linked stops linking: comma-separated pieces with no space in them. */
function wholePieceRefs(value: string): string[] {
  return value
    .trim()
    .replace(/^\((.*)\)$/, "$1")
    .split(",")
    .map((s) => s.trim().replace(/^`|`$/g, ""))
    .filter((s) => s !== "" && !/\s/.test(s) && pathShaped(s));
}

/**
 * The evidence references on one `evidence:` line or one `## Evidence` bullet. This is the only
 * reader of them: the task page, the packet contract and the evidence gate all come through here.
 *
 * A reference is the leading token of each comma- or semicolon-separated piece, with backticks,
 * brackets and parentheses stripped, when it is shaped like a path; so `evidence/tests.txt (the 12
 * cases), evidence/run.txt` names two files, where the older reader dropped any piece that held a
 * space. What that older reader returned is still returned, after these.
 */
export function evidenceRefs(value: string): string[] {
  const out: string[] = [];
  for (const piece of value.split(/[,;]/)) {
    const lead = /^[^\s`()[\],;]+/.exec(piece.trim().replace(/^[(`[\s]+/, ""))?.[0] ?? "";
    // `evidence/tests.txt:` and `evidence/tests.txt.` end a clause; the colon and the full stop are not the name.
    const token = lead.replace(/[:.]+$/, "");
    if (token !== "" && pathShaped(token)) out.push(token);
  }
  // The older reader's answer, except a spelling that is only a token above with its clause's colon
  // or full stop still on: that names no file, and as a citation it would refuse an honest packet.
  for (const ref of wholePieceRefs(value)) if (!out.includes(ref.replace(/[:.]+$/, ""))) out.push(ref);
  return Array.from(new Set(out));
}

/** `## ` sections of a Markdown body, by heading. */
function packetSections(content: string): Map<string, string[]> {
  const sections = new Map<string, string[]>();
  let current: string[] | null = null;
  for (const line of splitFrontMatter(content).body.split("\n")) {
    const h = /^##\s+(.+?)\s*$/.exec(line);
    if (h) {
      current = [];
      sections.set((h[1] ?? "").trim(), current);
    } else if (current) current.push(line);
  }
  return sections;
}

/** Every evidence reference a packet makes on its structured lines: `evidence:` lines under criteria, and `## Evidence` bullets. Paths in prose are not read. */
export function packetEvidenceRefs(content: string): string[] {
  const sections = packetSections(content);
  const out: string[] = [];
  for (const line of sections.get("Acceptance criteria") ?? []) {
    const m = /^\s*evidence:\s*(.*)$/i.exec(line);
    if (m) out.push(...evidenceRefs(m[1] ?? ""));
  }
  for (const line of sections.get("Evidence") ?? []) {
    const m = /^\s*[-*+]\s+(.*)$/.exec(line);
    if (m) out.push(...evidenceRefs(m[1] ?? ""));
  }
  return Array.from(new Set(out));
}

/**
 * Whether a reference is a citation: it names this task's own evidence folder, by its full path
 * (wherever in the reference that path starts, so an absolute spelling is judged and refused rather
 * than read as prose) or as `evidence/<name>`. Other path-shaped words on those lines are prose,
 * which is what keeps `src/c.ts` inside a sentence from being judged as evidence.
 */
export function isCitation(slug: string, ref: string): boolean {
  const clean = ref.replace(/^(?:\.\/)+/, "");
  return clean.startsWith("evidence/") || clean.includes(evidenceRelDir(slug));
}

/** The citations of a packet: the references the evidence gate judges. */
export function packetCitations(slug: string, content: string): string[] {
  return packetEvidenceRefs(content).filter((ref) => isCitation(slug, ref));
}

export interface EvidenceFault {
  /** The citation as it was written. */
  path: string;
  /** Why it does not count, in words that finish the sentence "<path> ...". */
  why: string;
  /** True when the only thing wrong is that the file is not on the commit. `reggie packet --lint` looks at the disk for these. */
  missing?: boolean;
}

/**
 * Judge citations against one commit. A citation resolves only to a regular, non-empty file directly
 * inside `.reggie/tasks/<slug>/evidence/` on that commit: mode 100644 or 100755 in one
 * `git ls-tree -r -z -l` of the folder, however many citations there are. Git is handed a
 * 40-character commit id and Reggie's own folder name, never a citation, and no working tree is
 * read, so the answer is the same wherever it is asked. An empty file fails although an honest one
 * can exist: with no reader, it cannot be told from a redirect that failed.
 */
export function resolveEvidence(root: string, commit: string, slug: string, cited: readonly string[], runner?: GitRunner): EvidenceFault[] {
  const faults: EvidenceFault[] = [];
  const wanted: { raw: string; full: string }[] = [];
  for (const raw of Array.from(new Set(cited))) {
    const parsed = evidencePath(slug, raw);
    if (parsed.ok) wanted.push({ raw, full: parsed.path });
    else faults.push({ path: cleanLine(raw, 200), why: parsed.why });
  }
  if (wanted.length === 0) return faults;
  const entries = listTreeLong(root, commit, evidenceRelDir(slug).replace(/\/$/, ""), runner);
  for (const { raw, full } of wanted) {
    const shown = cleanLine(raw, 200);
    if (entries === null) {
      faults.push({ path: shown, why: "could not be checked: git could not list the evidence folder on that commit" });
      continue;
    }
    const entry = entries.find((e) => e.path === full);
    if (!entry) {
      if (entries.some((e) => e.path.startsWith(`${full}/`))) faults.push({ path: shown, why: "is a folder; evidence is a regular file" });
      else faults.push({ path: shown, why: `is not on the commit ${commit.slice(0, 12)}; save it and commit it on the task branch`, missing: true });
    } else if (entry.mode === "120000") faults.push({ path: shown, why: "is a symbolic link; evidence is a regular file" });
    else if (entry.mode === "160000" || entry.type === "commit") faults.push({ path: shown, why: "is a gitlink to another repository; evidence is a regular file" });
    else if (entry.type !== "blob" || (entry.mode !== "100644" && entry.mode !== "100755")) faults.push({ path: shown, why: "is not a regular file" });
    else if (entry.size === 0) faults.push({ path: shown, why: "is empty; an empty file cannot be told from a redirect that failed, so save the command and its exit status into it" });
  }
  return faults;
}

/** The evidence gate: every citation of the packet, judged on the commit the packet was read from. An empty list passes; so does a packet that cites nothing. */
export function evidenceGate(root: string, commit: string, slug: string, packetContent: string, runner?: GitRunner): EvidenceFault[] {
  return resolveEvidence(root, commit, slug, packetCitations(slug, packetContent), runner);
}

// ---------------------------------------------------------------------------
// The packet contract
// ---------------------------------------------------------------------------

export interface PacketLintInput {
  slug: string;
  /** The checklist as the records render it against the plan; null when there is no plan to render from. */
  checklist: string | null;
}

export interface PacketLintResult {
  ok: boolean;
  errors: string[];
}

function isStandIn(line: string): boolean {
  return /^\(.*\)$/.test(line.replace(/^[-*+]\s+(\[[ xX]\]\s+)?/, "").trim());
}

/**
 * The packet contract, beside the brief and plan contracts: front matter naming this task and one of
 * the three verdicts; the seven sections present, not empty, and none still holding the scaffold's
 * parenthesised stand-in; a generated checklist equal to what the records render; and every citation
 * well formed. Whether a citation resolves is the gate's question, not this one's. A hand approval
 * does not run the contract; the policy report does.
 */
export function lintPacket(content: string, input: PacketLintInput): PacketLintResult {
  const errors: string[] = [];
  const { front } = splitFrontMatter(content);
  const field = (key: string) => (front === null ? null : new RegExp(`^${key}:[ \\t]*(.*)$`, "m").exec(front)?.[1]?.trim() ?? null);
  if (front === null) errors.push("front matter: missing");
  const slug = field("slug");
  if (!slug) errors.push("front matter: missing slug");
  else if (slug !== input.slug) errors.push(`front matter: slug is ${cleanLine(slug, 80)}, not ${input.slug}`);
  const verdict = field("verdict");
  if (!verdict || !(VERDICTS as string[]).includes(verdict)) errors.push("front matter: verdict must be pending, approved or needs-work");

  const sections = packetSections(content);
  for (const name of PACKET_SECTIONS) {
    const lines = sections.get(name);
    if (lines === undefined) {
      errors.push(`missing section: ## ${name}`);
      continue;
    }
    const kept = lines.map((l) => l.trim()).filter((l) => l !== "" && !l.startsWith("<!--"));
    if (kept.length === 0) errors.push(`empty section: ## ${name}`);
    else if (kept.some(isStandIn)) errors.push(`placeholder text still present in ## ${name}`);
  }

  const block = extractChecklist(content);
  if (block === null) errors.push("Acceptance criteria: no generated checklist; this packet predates check records (regenerate it with `reggie packet --force`)");
  else if (input.checklist === null) errors.push("Acceptance criteria: there is no plan to render the checklist from");
  else if (block !== input.checklist) errors.push("Acceptance criteria: the checklist differs from what the check records render; run `reggie packet` again, and do not edit between the markers");

  for (const ref of packetCitations(input.slug, content)) {
    const parsed = evidencePath(input.slug, ref);
    if (!parsed.ok) errors.push(`malformed citation: ${cleanLine(ref, 200)} ${parsed.why}`);
  }
  return { ok: errors.length === 0, errors };
}

export function parsePacketVerdict(content: string): Verdict | null {
  const { front } = splitFrontMatter(content);
  if (!front) return null;
  const m = /^verdict:\s*(pending|approved|needs-work)\s*$/m.exec(front);
  return (m?.[1] as Verdict | undefined) ?? null;
}

export interface PacketSource {
  /** Where the packet lives, or would live, in the working tree. */
  file: string;
  content: string;
  /** The ref the content was read from; null when it came from the working tree. */
  ref: string | null;
}

/**
 * Where the packet for a slug can be read: the working tree, then `task/<slug>` (local, then
 * origin), then the integration branch. In solo mode the awaiting-decision state is defined by a
 * packet on the task branch while the server runs from the integration branch, so a decision has
 * to reach past the working tree to find it.
 */
export function locatePacket(paths: RepoPaths, config: ReggieConfig, slug: string): PacketSource | null {
  const root = paths.root;
  const file = packetFile(paths, slug);
  const local = readText(file);
  if (local !== null) return { file, content: local, ref: null };
  const rel = packetRelPath(slug);
  const refs = [`task/${slug}`, `origin/task/${slug}`];
  try {
    refs.push(defaultBranch(root, config.defaultBranch));
  } catch {
    // No integration branch to fall back on; the task branch is the only place left to look.
  }
  for (const ref of refs) {
    const content = fileAtRef(root, ref, rel);
    if (content !== null) return { file, content, ref };
  }
  return null;
}

/**
 * Copy a packet read from a ref into the working tree so a decision can be recorded on it.
 * Returns the file written.
 */
export function materializePacket(paths: RepoPaths, slug: string, content: string): string {
  const file = packetFile(paths, slug);
  writeText(file, content);
  return file;
}

/** Record a decision in the packet front matter. */
export function decidePacket(paths: RepoPaths, slug: string, verdict: Exclude<Verdict, "pending">, decidedBy: string, comment?: string): string {
  const file = packetFile(paths, slug);
  const content = readText(file);
  if (!content) throw new Error(`No packet for ${slug}. Create one with \`reggie packet ${slug}\`.`);
  let next = upsertFrontMatter(content, { verdict, decided_by: decidedBy, decided_at: new Date().toISOString() });
  if (parsePacketVerdict(next) !== verdict) throw new Error(`Could not record the verdict in ${file}; its front matter is malformed.`);
  if (comment && comment.trim()) {
    next += `\n## Decision\n- ${verdict} by ${decidedBy} on ${today()}: ${comment.trim()}\n`;
  }
  writeText(file, next);
  return file;
}
