import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { changedFiles, currentBranch, defaultBranch, diffStat, fileAtRef } from "./git.js";
import { evidenceDir, packetFile, packetRelPath, planFile, type RepoPaths } from "./paths.js";
import type { ReggieConfig } from "./people.js";
import { parsePlan } from "./plan.js";
import { readText, relPosix, splitFrontMatter, today, upsertFrontMatter, writeText } from "./util.js";

export type Verdict = "pending" | "approved" | "needs-work";

export interface PacketInput {
  slug: string;
  author: string;
  /** Overwrite an existing packet. Without it, an existing packet is left untouched. */
  force?: boolean;
}

/** Scaffold packet.md from the plan: criteria become a checklist, changes come from git, evidence is listed. */
export function scaffoldPacket(paths: RepoPaths, config: ReggieConfig, input: PacketInput): { file: string; created: boolean; skipped: boolean } {
  const file = packetFile(paths, input.slug);
  if (existsSync(file) && !input.force) return { file, created: false, skipped: true };
  const plan = readText(planFile(paths, input.slug));
  if (!plan) throw new Error(`No plan for ${input.slug}. Write one with \`reggie plan new ${input.slug}\` first.`);
  const parsed = parsePlan(plan);
  const base = defaultBranch(paths.root, config.defaultBranch);
  const branch = currentBranch(paths.root);
  const stat = diffStat(paths.root, base);
  const files = changedFiles(paths.root, base);
  const evidence = listEvidence(paths, input.slug);

  const criteria = parsed.criteria.length > 0
    ? parsed.criteria.map((c, i) => `- [ ] ${c}\n  evidence: (${evidenceHint(evidence, i)})`).join("\n")
    : "- [ ] (the plan had no criteria; state what was verified)";

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
    criteria,
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
    "- (unrelated problems found on the way; each should also be captured with `reggie capture`)",
    "",
    "## Open risks",
    "- (what could still be wrong and how someone would notice)",
    "",
  ].join("\n");

  const created = !existsSync(file);
  writeText(file, content);
  return { file, created, skipped: false };
}

function evidenceHint(evidence: string[], index: number): string {
  const hit = evidence[index];
  return hit ?? "path to the file that proves this";
}

export function listEvidence(paths: RepoPaths, slug: string): string[] {
  const dir = evidenceDir(paths, slug);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((n) => !n.startsWith("."))
    .sort()
    .map((n) => relPosix(paths.root, path.join(dir, n)));
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
