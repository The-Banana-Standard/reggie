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
 * So a command refuses to run a stale build and says the one sentence that fixes it, and
 * REGGIE_ALLOW_STALE=1 runs it anyway for someone who means to. Code run from `src/` through tsx is
 * the source by definition, and an installed package has no `src/`, so this is inert everywhere
 * except a linked development checkout running its compiled bin.
 */

export const ALLOW_STALE_ENV = "REGGIE_ALLOW_STALE";

export interface BuildState {
  stale: boolean;
  /** False when dist/ holds no compiled JavaScript at all. */
  built: boolean;
  /** Newest source file, relative to the package root. Null when there is no src/ to compare. */
  newestSource: string | null;
  /** How far the newest source is ahead of the build being compared against; 0 when nothing is built. */
  aheadMs: number;
  /** Newest mtime under dist/, in ms; 0 when nothing is built. */
  builtAt: number;
  /** True when dist/ on disk is newer than the build a long-running process loaded. */
  rebuilt: boolean;
}

export type BuildVerdict = "current" | "stale" | "allowed";

export interface BuildCheck {
  verdict: BuildVerdict;
  /** What to print: null when current. */
  message: string | null;
}

const SKIP_DIRS = new Set(["node_modules", ".git", "dist", "coverage", ".cache"]);
const GRACE_MS = 1000;

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
 * Compare the newest `.ts` under `src/` with the newest `.js` under `dist/`, or with `builtAt` when
 * a long-running process passes the build time it loaded. A one-second grace covers a build that
 * finished in the same second as the last edit.
 */
export function buildState(root: string, opts: { builtAt?: number } = {}): BuildState {
  // Test files are excluded on purpose. Editing one changes nothing a command or an endpoint
  // does, so refusing over it would train the reader to reach for the escape hatch.
  const src = newest(path.join(root, "src"), /(?<!\.test)\.ts$/);
  const dist = newest(path.join(root, "dist"), /\.js$/);
  const built = dist.file !== null;
  if (!src.file) return { stale: false, built, newestSource: null, aheadMs: 0, builtAt: dist.at, rebuilt: false };
  const newestSource = path.relative(root, src.file);
  if (!built) return { stale: true, built, newestSource, aheadMs: 0, builtAt: 0, rebuilt: false };
  const loaded = opts.builtAt ?? dist.at;
  const aheadMs = src.at - loaded;
  return { stale: aheadMs > GRACE_MS, built, newestSource, aheadMs, builtAt: dist.at, rebuilt: dist.at > loaded + GRACE_MS };
}

function age(ms: number): string {
  const mins = Math.round(ms / 60_000);
  if (mins < 1) return "under a minute";
  if (mins < 60) return `${mins} minute${mins === 1 ? "" : "s"}`;
  const hours = Math.round(mins / 60);
  return `${hours} hour${hours === 1 ? "" : "s"}`;
}

/** Is `file` inside `dir`? */
function inside(file: string, dir: string): boolean {
  const rel = path.relative(dir, file);
  return rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel);
}

/**
 * Decide whether the module at `moduleUrl` may run. `current` unless it was loaded from the
 * package's `dist/` and the source is ahead; then `stale`, or `allowed` when the environment sets
 * REGGIE_ALLOW_STALE to exactly "1".
 */
export function checkBuild(moduleUrl: string, env: NodeJS.ProcessEnv, opts: { builtAt?: number } = {}): BuildCheck {
  const root = packageRoot(moduleUrl);
  if (!inside(fileURLToPath(moduleUrl), path.join(root, "dist"))) return { verdict: "current", message: null };
  const state = buildState(root, opts);
  if (!state.stale) return { verdict: "current", message: null };

  const allowed = env[ALLOW_STALE_ENV] === "1";
  const detail = !state.built
    ? [`Reggie at ${root} has not been built yet: dist/ holds no compiled JavaScript.`, `Fix it:  (cd ${root} && npm run build)`]
    : state.rebuilt
      ? [
          `This process loaded a build from before ${state.newestSource} changed, and dist/ has been rebuilt since it started.`,
          `Fix it:  restart the MCP server (or the command) to load the new build.`,
        ]
      : [
          `${state.newestSource} changed ${age(state.aheadMs)} after dist/ was last compiled, so this would run the code from before that edit.`,
          `Fix it:  (cd ${root} && npm run build)`,
        ];
  if (allowed) return { verdict: "allowed", message: [`Running the stale build because ${ALLOW_STALE_ENV}=1.`, ...detail].join("\n") };
  return {
    verdict: "stale",
    message: ["Refusing to run a stale build of Reggie.", ...detail, `To run the old build anyway, set ${ALLOW_STALE_ENV}=1.`].join("\n"),
  };
}
