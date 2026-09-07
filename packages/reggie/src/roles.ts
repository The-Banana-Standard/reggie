/**
 * File roles (ui-spec §6.1).
 *
 * A role says what a path is *for*, so the graph can hide tests at Levels 1–2,
 * count only real source, retype imports from tests as `tests` edges and keep
 * generated files out of the way. Pure: no I/O, no Node imports, cheap per file.
 *
 * Precedence, most specific first:
 *   1. generated — a machine wrote it; never source, test or config, whatever its name says.
 *   2. fixture   — fixture directories sit inside test trees (`test/helpers.ts` also matches
 *                  the `test/` hint), so they are checked before `test`.
 *   3. test      — `TEST_HINTS` or a `/__tests__/` segment.
 *   4. config    — after `test` so `app.config.test.ts` stays a test and gets a `tests` edge;
 *                  the only casualty is a config file inside a test directory
 *                  (`tests/tsconfig.json`), which is hidden at Levels 1–2 either way.
 *   5. source    — everything else.
 */

/** Contract `Role` (ui-api-contract.md, shared types). */
export type Role = "source" | "test" | "fixture" | "config" | "generated";

/** Every role, in display order (legends, validation). */
export const ROLES: readonly Role[] = ["source", "test", "fixture", "config", "generated"];

/**
 * Path patterns that mark a file as a test. `facts.ts` uses these verbatim for
 * its test count, so edit with care. None may carry the `g` flag: a global
 * regex keeps `lastIndex` between `test()` calls and starts skipping matches.
 */
export const TEST_HINTS: readonly RegExp[] = [
  /(^|\/)__tests__\//,
  /(^|\/)tests?\//,
  /\.test\.[cm]?[jt]sx?$/,
  /\.spec\.[cm]?[jt]sx?$/,
  /_test\.go$/,
  /Tests?\.swift$/,
  /Test\.kt$/,
  /test_.*\.py$/,
  /_test\.py$/,
];

/** Test support code: mocks, fixtures, shared helpers. Matched against the whole path. */
const FIXTURE_HINTS: readonly RegExp[] = [
  /(^|\/)__test-utils__\//,
  /(^|\/)__mocks__\//,
  /(^|\/)fixtures\//,
  // test/helpers.ts, tests/helpers.py — exactly one extension, so test/helpers.test.ts stays a test.
  /(^|\/)(?:tests?|__tests__)\/helpers\.[^./]+$/,
];

/** Build and tool configuration. Matched against the basename only. */
const CONFIG_HINTS: readonly RegExp[] = [
  /\.config\./, // vite.config.ts, tailwind.config.js, eslint.config.mjs
  /^tsconfig.*\.json$/, // tsconfig.json, tsconfig.node.json
  /^build\.rs$/,
  /\.d\.[cm]?ts$/, // declaration files, vite-env.d.ts included
];

/** Build output directories. Matched against the whole path. */
const GENERATED_PATHS: readonly RegExp[] = [/(^|\/)dist\//];
/** Codegen naming convention (routeTree.gen.ts, schema.gen.go). Basename only. */
const GENERATED_BASENAME = /\.gen\./;
/** Conventional first-line markers left by generators. */
const GENERATED_MARKER = /@generated|do not edit/i;

/**
 * Classify a repo-relative path. `firstLine` is optional and only its first
 * line is examined, so callers may hand over the first few hundred characters
 * of the file without splitting. Backslashes and a leading `./` are tolerated.
 */
export function roleOf(path: string, firstLine?: string): Role {
  const p = normalize(path);
  const base = p.slice(p.lastIndexOf("/") + 1);
  if (GENERATED_PATHS.some((re) => re.test(p)) || GENERATED_BASENAME.test(base) || hasGeneratedMarker(firstLine)) return "generated";
  if (FIXTURE_HINTS.some((re) => re.test(p))) return "fixture";
  // `/__tests__/` is already the first hint; kept explicit so the rule survives edits to TEST_HINTS.
  if (TEST_HINTS.some((re) => re.test(p)) || p.includes("/__tests__/")) return "test";
  if (CONFIG_HINTS.some((re) => re.test(base))) return "config";
  return "source";
}

/**
 * Roles whose files are test support: their imports become `tests` edges, they
 * feed `testedBy`, and they hide at Levels 1–2 behind "Show tests" (spec §6.1, §5.5).
 */
export function isTestLike(role: Role): boolean {
  return role === "test" || role === "fixture";
}

function normalize(path: string): string {
  let p = path.replace(/\\/g, "/");
  while (p.startsWith("./")) p = p.slice(2);
  return p;
}

function hasGeneratedMarker(firstLine: string | undefined): boolean {
  if (!firstLine) return false;
  const nl = firstLine.indexOf("\n");
  const line = nl === -1 ? firstLine : firstLine.slice(0, nl);
  return GENERATED_MARKER.test(line);
}
