import { readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/*
 * Is the JavaScript being run older than the TypeScript it was compiled from?
 *
 * `npm link` puts a symlink to this package on the PATH, so `reggie` in any repo runs whatever
 * `dist/` last held. Edit `src/`, forget `npm run build`, and every command keeps working — with
 * the code from before the edit. That failure is silent and it does not look like a stale build:
 * a page whose endpoint only exists in the new code renders an error card, or a tab renders
 * nothing at all, and the obvious reading is "the feature is broken".
 *
 * So commands that would be confusing to run stale check first and say the one sentence that
 * fixes it. There is no `src/` in an installed package, so this is inert everywhere except the
 * development checkout that has the problem.
 */

export interface BuildState {
  stale: boolean;
  /** Newest source file, and how far ahead of the build it is. Null when there is no src/ to compare. */
  newestSource: string | null;
  aheadMs: number;
}

const SKIP_DIRS = new Set(["node_modules", ".git", "dist", "coverage", ".cache"]);

/** Newest mtime under a directory, in ms, with the file that carries it. */
function newest(dir: string, match: RegExp, depth = 0): { at: number; file: string | null } {
  let best = { at: 0, file: null as string | null };
  if (depth > 6) return best;
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return best;
  }
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = path.join(dir, entry);
    let st;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      const inner = newest(full, match, depth + 1);
      if (inner.at > best.at) best = inner;
      continue;
    }
    if (!match.test(entry)) continue;
    if (st.mtimeMs > best.at) best = { at: st.mtimeMs, file: full };
  }
  return best;
}

/** The package root: the parent of the dist/ (or src/) directory this module was loaded from. */
export function packageRoot(moduleUrl: string): string {
  return path.resolve(path.dirname(fileURLToPath(moduleUrl)), "..");
}

/**
 * Compare the newest `.ts` under `src/` with the newest `.js` under `dist/`. A one-second grace
 * covers a build that finished in the same second as the last edit.
 */
export function buildState(root: string): BuildState {
  // Test files are excluded on purpose. Editing one changes nothing a command or an endpoint
  // does, so warning about it would train the reader to ignore the warning that matters.
  const src = newest(path.join(root, "src"), /(?<!\.test)\.ts$/);
  if (!src.file) return { stale: false, newestSource: null, aheadMs: 0 };
  const dist = newest(path.join(root, "dist"), /\.js$/);
  const aheadMs = src.at - dist.at;
  return { stale: aheadMs > 1000, newestSource: path.relative(root, src.file), aheadMs };
}

/** The warning to print, or null when the build is current. */
export function staleBuildWarning(moduleUrl: string): string | null {
  const root = packageRoot(moduleUrl);
  const state = buildState(root);
  if (!state.stale) return null;
  const mins = Math.round(state.aheadMs / 60_000);
  const age = mins < 1 ? "just now" : mins < 60 ? `${mins} minutes ago` : `${Math.round(mins / 60)} hours ago`;
  return [
    `Warning: this is a stale build. src/${state.newestSource?.replace(/^src\//, "") ?? ""} changed ${age}, after dist/ was last compiled,`,
    `so you are running the code from before that edit — commands and endpoints added since will be missing.`,
    `Fix it:  (cd ${root} && npm run build)`,
  ].join("\n");
}
