/**
 * Single source of truth for workflow session label classification.
 *
 * Both `CodeWorkflowTab.tsx` and `RepoTaskRow.tsx` use these helpers to
 * partition session labels by domain (code / reggie-system / debug).
 *
 * Label prefixes are produced by `commandForMode` in `CodeWorkflowTab.tsx`:
 *   "code --" / "reggie-sys --" / "debug --"
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
