/**
 * Single source of truth for workflow session label classification.
 *
 * Both `CodeWorkflowTab.tsx` and `RepoTaskRow.tsx` use these helpers to
 * partition session labels by domain (code / reggie-system / debug).
 *
 * Label prefixes are produced by `commandForMode` in `CodeWorkflowTab.tsx`:
 *   "code --" / "reggie-sys --" / "debug --"
 *
 * Full label format is `"<domain> -- <repo>/<slug>"` (see CodeWorkflowTab
 * dispatch sites). `slugFromLabel` extracts the trailing slug.
 */

/** Map a session label prefix to the dispatch domain, or `null` for non-workflow labels. */
export function domainForLabel(label: string): "code" | "reggieSystem" | "debug" | null {
  if (label.startsWith("code --")) return "code";
  if (label.startsWith("reggie-sys --")) return "reggieSystem";
  if (label.startsWith("debug --")) return "debug";
  return null;
}

/**
 * Whether a session label belongs to one of the dispatched workflows
 * (code, reggie-system, or debug). Used to filter sessions per-repo.
 */
export function isWorkflowLabel(label: string): boolean {
  return domainForLabel(label) !== null;
}

/**
 * Extract the slug from a workflow session label.
 *
 * Labels are formatted as `"<domain> -- <repo>/<slug>"`. The slug is the
 * substring after the final `/`. Returns `null` for non-workflow labels
 * or malformed labels (no `/` after the domain prefix).
 */
export function slugFromLabel(label: string): string | null {
  if (!isWorkflowLabel(label)) return null;
  const slashIdx = label.lastIndexOf("/");
  if (slashIdx === -1) return null;
  const slug = label.slice(slashIdx + 1).trim();
  return slug.length > 0 ? slug : null;
}
