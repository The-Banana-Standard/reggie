/**
 * The repo as a graph (ui-spec §6.1): the single extractor every view projects.
 *
 * `buildGraph` returns every node kind at once — `repo:<name>` above `dir:./`, a `dir:` node
 * for every directory on the path of every code file, file nodes with roles, `entity:` nodes
 * from `_entities` notes and `task:` nodes from `listTasks` — joined with notes, git history
 * and tasks. Edges: `import`/`mod` (retyped to `tests` when the importer is a test or fixture),
 * `ipc` from `invoke("x")` to the file defining `#[tauri::command] fn x`, `touches` from tasks,
 * `annotates` from entity notes to the files and folders they cite.
 *
 * Cost: one `git ls-files`, one read per code file, one notes walk, one history pass (shared
 * through `opts.history` when the server already has it) and whatever `listTasks` needs.
 * Nothing runs git per file.
 *
 * Compatibility: the flat fields (`dir`, `noteCount`, `dirNoteCount`, `inDegree`, `outDegree`)
 * and the top-level `dirs`, `unresolved`, `languages` are kept; `flatGraph` produces the
 * no-parameter `GET /api/graph` payload (file and task nodes only, capped at `MAX_NODES`).
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { collectFacts, detectName, isIgnoredPath, type RepoFacts } from "./facts.js";
import { listRepoFiles } from "./git.js";
import { historyFor, repoHistory, type History, type HistoryIndex } from "./history.js";
import { NOTE_TYPES, notesIndex, staleEntriesFor, type Confidence as NoteConfidence, type NoteEntry, type NoteFile, type NoteType } from "./notes.js";
import { packetFile, type RepoPaths } from "./paths.js";
import { loadConfig, type ReggieConfig } from "./people.js";
import { isTestLike, roleOf, type Role } from "./roles.js";
import { parseNamedImports, type Confidence } from "./symbols.js";
import { listTasks, type TaskInfo, type TaskState } from "./tasks.js";
import { nowIso, readText, splitFrontMatter, uniq } from "./util.js";

// ---------------------------------------------------------------------------
// Contract types (ui-api-contract.md, shared types)
// ---------------------------------------------------------------------------

export type NodeKind = "repo" | "dir" | "file" | "symbol" | "task" | "person" | "entity" | "fold";
export type EdgeKind = "import" | "mod" | "tests" | "ipc" | "touches" | "annotates" | "uses" | "calls" | "depends-on" | "same-org" | "shares-service";
export type EntryKindName = "main" | "cli" | "mcp" | "http" | "ipc-server";
export type Manifest = "package.json" | "Cargo.toml";
export type TaskRisk = "low" | "medium" | "high" | "unset";

export interface EntryKind {
  kind: EntryKindName;
  count: number;
}

/**
 * Notes joined to a node. `own` counts the entries on the node's own note; `inherited` counts
 * entries on ancestor folder notes and the repo note. `stale`, `byType`, `lastNoteDate` and
 * `lowestConfidence` describe the node's own entries only.
 */
export interface Knowledge {
  own: number;
  inherited: number;
  stale: number;
  byType: Record<NoteType, number>;
  lastNoteDate: string | null;
  lowestConfidence: NoteConfidence | null;
}

export interface Aggregates {
  /** Code files in the subtree. */
  files: number;
  source: number;
  /** Files with role test or fixture. */
  tests: number;
  config: number;
  lines: number;
  /** Source files with an own or inherited note. */
  documented: number;
  /** Stale note entries on the directory itself and everything under it. */
  stale: number;
  /** Source files with at least one test importer. */
  testedSource: number;
  /** Every task touching the directory or anything under it. */
  tasks: string[];
  history?: History;
}

export interface GraphNode {
  id: string;
  kind: NodeKind;
  label: string;
  path: string;
  parent: string | null;
  lang: string;
  lines: number;
  role: Role;
  /** Id of the Level-1 area containing this node (null for the repo, the root dir, tasks and entities). */
  area: string | null;
  knowledge: Knowledge;
  tasks: string[];
  // file-only (zero / empty on other kinds)
  inDegree: number;
  outDegree: number;
  testedBy: string[];
  entry: boolean;
  entryKinds: EntryKind[];
  history?: History;
  // dir/repo-only
  aggregates?: Aggregates;
  manifest?: Manifest | null;
  residual?: boolean;
  // view-only (never set here; views.ts fills them)
  ghost?: boolean;
  side?: "up" | "down" | "both";
  hop?: number;
  foldCount?: number;
  foldIds?: string[];
  center?: boolean;
  // task-only
  state?: TaskState;
  risk?: TaskRisk;
  owner?: string | null;
  age?: number | null;
  // compatibility (flat graph)
  dir: string;
  noteCount: number;
  dirNoteCount: number;
}

export interface GraphEdge {
  source: string;
  target: string;
  kind: EdgeKind;
  /** Aggregated count (container/ghost edges); absent = 1. */
  weight?: number;
  /** Named imports, IPC command names, or symbol names carried. */
  names?: string[];
  /** Absent = exact. */
  confidence?: Confidence;
  via?: { source: string; target: string; names: string[] }[];
  cycle?: boolean;
  /** Additive to the contract: every import statement behind this edge was `import type`. Present only when true. */
  isType?: boolean;
}

export interface RepoGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
  /** File-level strongly connected components of size ≥ 2 over import, mod and ipc edges. */
  cycles: string[][];
  /** Compatibility: `dirKey` groups of the file nodes plus `(tasks)`. */
  dirs: string[];
  /** Relative import specifiers that resolved to no file. */
  unresolved: number;
  generatedAt: string;
  languages: string[];
  totalCodeFiles: number;
  /** File nodes in this payload. */
  included: number;
  truncated: boolean;
}

/** The no-parameter `GET /api/graph` payload: file and task nodes only, capped at `MAX_NODES` files. */
export interface FlatGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
  dirs: string[];
  unresolved: number;
  generatedAt: string;
  languages: string[];
  totalCodeFiles: number;
  included: number;
  truncated: boolean;
}

export interface Detector {
  id: string;
  filePattern: RegExp;
  /** Global regex; group 1 is the name that is counted (distinct names per file). */
  regex: RegExp;
  kind: EntryKindName;
}

export interface BuildGraphOptions {
  /** Shared history index (from `repoHistory`); built here when absent. */
  history?: HistoryIndex;
  /** Shared facts (for `entryPoints`); collected here when absent. */
  facts?: RepoFacts;
  /** Repo config for `listTasks`; loaded from `.reggie/config.yaml` when absent. */
  config?: ReggieConfig;
  /** Shared notes index; read here when absent. */
  notes?: Map<string, NoteFile>;
  /** Shared task list (`listTasks(paths, config, { includeDone: true })`); derived here when absent. */
  tasks?: TaskInfo[];
  /** Entry-point detectors; default `BOUNDARY_DETECTORS`. */
  detectors?: readonly Detector[];
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const ROOT_DIR_ID = "dir:./";
/** Cap on file nodes in the flat compatibility payload only; the full graph holds every code file. */
export const MAX_NODES = 4000;

const CODE_EXT: Record<string, string> = {
  ts: "TypeScript",
  tsx: "TypeScript",
  mts: "TypeScript",
  cts: "TypeScript",
  js: "JavaScript",
  jsx: "JavaScript",
  mjs: "JavaScript",
  cjs: "JavaScript",
  rs: "Rust",
};

const JS_EXTS = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".d.ts"];
const JS_FILE = /\.[cm]?[jt]sx?$/;
const RUST_FILE = /\.rs$/;

/** `#[tauri::command] fn x` (attributes between the two, `pub(crate)`, `async` and `unsafe` tolerated). */
export const TAURI_COMMAND_RE = /#\[tauri::command(?:\([^)]*\))?\]\s*(?:#\[[^\]]*\]\s*)*(?:pub(?:\([^)]*\))?\s+)?(?:async\s+)?(?:unsafe\s+)?fn\s+([A-Za-z_][A-Za-z0-9_]*)/g;
/** `invoke("x")`, `invoke<T>("x")`, `invoke('x')`. */
export const INVOKE_RE = /\binvoke(?:<[^>]*>)?\(\s*['"`]([a-z_][a-z0-9_]*)['"`]/g;

/**
 * Entry-point detectors (spec §6.1c). Each contributes `{kind, count}` to a file's `entryKinds`
 * when its regex matches; `count` is the number of distinct names captured by group 1.
 * Files with role `test` or `fixture` are never entry points: their fixture strings would
 * otherwise register as commands or routes. `config.yaml` `boundaries:` may replace this
 * list later (⧗); `opts.detectors` does so now.
 */
export const BOUNDARY_DETECTORS: readonly Detector[] = [
  { id: "commander", filePattern: JS_FILE, regex: /\.command\(\s*['"]([^'"\n]+)['"]/g, kind: "cli" },
  { id: "mcp-tool", filePattern: JS_FILE, regex: /\bregisterTool\(\s*['"]([^'"\n]+)['"]/g, kind: "mcp" },
  { id: "http-route", filePattern: JS_FILE, regex: /\bcase\s+['"](\/api\/[^'"\n]+)['"]/g, kind: "http" },
  { id: "tauri-command", filePattern: RUST_FILE, regex: TAURI_COMMAND_RE, kind: "ipc-server" },
];

const CONFIDENCE_RANK: Record<NoteConfidence, number> = { high: 0, medium: 1, low: 2 };
const NON_DEGREE_KINDS: ReadonlySet<EdgeKind> = new Set<EdgeKind>(["annotates"]);
const CYCLE_KINDS: ReadonlySet<EdgeKind> = new Set<EdgeKind>(["import", "mod", "ipc"]);

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

function extOf(file: string): string {
  return path.posix.extname(file).slice(1).toLowerCase();
}

/** Group by the first two path segments so a large repo clusters sensibly (flat payload). */
export function dirKey(file: string): string {
  const parts = file.split("/");
  if (parts.length <= 1) return "(root)";
  return `${parts.slice(0, Math.min(2, parts.length - 1)).join("/")}/`;
}

function countLines(content: string): number {
  return content.length === 0 ? 0 : content.split("\n").length;
}

/** `src/auth/login.ts` → `dir:src/auth/`; a root file → `dir:./`. */
export function parentDirId(file: string): string {
  const i = file.lastIndexOf("/");
  return i === -1 ? ROOT_DIR_ID : `dir:${file.slice(0, i)}/`;
}

/** Directory paths with trailing slash, shallow to deep, for a file: `src/auth/login.ts` → `['src/', 'src/auth/']`. */
function dirChain(file: string): string[] {
  const parts = file.split("/");
  const out: string[] = [];
  for (let i = 1; i < parts.length; i += 1) out.push(`${parts.slice(0, i).join("/")}/`);
  return out;
}

/** `src/auth/` → `src/`; `src/` → `./`. */
function parentDirPath(dirPath: string): string {
  const bare = dirPath.replace(/\/$/, "");
  const i = bare.lastIndexOf("/");
  return i === -1 ? "./" : `${bare.slice(0, i)}/`;
}

function emptyByType(): Record<NoteType, number> {
  const out = {} as Record<NoteType, number>;
  for (const t of NOTE_TYPES) out[t] = 0;
  return out;
}

export function emptyKnowledge(): Knowledge {
  return { own: 0, inherited: 0, stale: 0, byType: emptyByType(), lastNoteDate: null, lowestConfidence: null };
}

function emptyAggregates(): Aggregates {
  return { files: 0, source: 0, tests: 0, config: 0, lines: 0, documented: 0, stale: 0, testedSource: 0, tasks: [] };
}

function normalizeRepoPath(p: string): string {
  return p.trim().replace(/\\/g, "/").replace(/^\.\/+/, "").replace(/\/{2,}/g, "/");
}

// ---------------------------------------------------------------------------
// JavaScript / TypeScript imports
// ---------------------------------------------------------------------------

export interface ImportRef {
  spec: string;
  /** Local binding names (`{ a, b as c }` → `a, c`; default → `default`; namespace → `*`); empty for side-effect, dynamic and bare `require` imports. */
  names: string[];
  isType: boolean;
}

const ES_IMPORT_RE = /(?:^|\n)\s*(?:import|export)\s+((?:[^'";]*?)\s+from\s+)?['"]([^'"\n]+)['"]/g;
const DYNAMIC_IMPORT_RE = /\bimport\(\s*['"]([^'"\n]+)['"]\s*\)/g;
const REQUIRE_BIND_RE = /(?:const|let|var)\s+(\{[^}]*\}|[A-Za-z_$][\w$]*)\s*=\s*require\(\s*['"]([^'"\n]+)['"]\s*\)/g;
const REQUIRE_RE = /\brequire\(\s*['"]([^'"\n]+)['"]\s*\)/g;

/** Every import in a JS/TS file with the names it binds. Pure. */
export function jsImports(content: string): ImportRef[] {
  const out: ImportRef[] = [];
  for (const m of content.matchAll(ES_IMPORT_RE)) {
    const spec = m[2];
    if (!spec) continue;
    const clause = (m[1] ?? "").replace(/\s+from\s+$/, "");
    const parsed = clause ? parseNamedImports(clause) : { names: [], isType: false };
    out.push({ spec, names: parsed.names, isType: parsed.isType });
  }
  for (const m of content.matchAll(DYNAMIC_IMPORT_RE)) if (m[1]) out.push({ spec: m[1], names: [], isType: false });
  for (const m of content.matchAll(REQUIRE_BIND_RE)) {
    const spec = m[2];
    if (!spec) continue;
    out.push({ spec, names: parseNamedImports(m[1] ?? "").names, isType: false });
  }
  for (const m of content.matchAll(REQUIRE_RE)) {
    if (m[1]) out.push({ spec: m[1], names: [], isType: false });
  }
  return out;
}

function resolveJsImport(fromFile: string, spec: string, files: Set<string>): string | null {
  let target: string;
  if (spec.startsWith("./") || spec.startsWith("../")) {
    target = path.posix.normalize(path.posix.join(path.posix.dirname(fromFile), spec));
  } else if (spec.startsWith("@/") || spec.startsWith("~/")) {
    target = `src/${spec.slice(2)}`;
  } else {
    return null;
  }
  const candidates: string[] = [target];
  const stripped = target.replace(/\.(js|jsx|mjs|cjs)$/, "");
  if (stripped !== target) candidates.push(`${stripped}.ts`, `${stripped}.tsx`, `${stripped}.mts`);
  for (const ext of JS_EXTS) candidates.push(`${target}${ext}`);
  for (const ext of JS_EXTS) candidates.push(`${target}/index${ext}`);
  for (const c of candidates) if (files.has(c)) return c;
  return null;
}

// ---------------------------------------------------------------------------
// Rust modules, `use crate::`, and lib crates
// ---------------------------------------------------------------------------

interface RustRef {
  target: string;
  kind: "mod" | "import";
  names: string[];
}

/** Nearest ancestor `src/` directory that sits beside a Cargo.toml, or the file's own dir. */
function crateRoot(file: string, files: Set<string>): string {
  const parts = file.split("/");
  for (let i = parts.length - 1; i >= 0; i -= 1) {
    if (parts[i] === "src") {
      const above = parts.slice(0, i).join("/");
      const cargo = above ? `${above}/Cargo.toml` : "Cargo.toml";
      if (files.has(cargo)) return parts.slice(0, i + 1).join("/");
    }
  }
  return path.posix.dirname(file);
}

/**
 * Expand a Rust use tree into flat segment paths:
 * `a::b::{c, d::{e, f}, self}` → `[[a,b,c],[a,b,d,e],[a,b,d,f],[a,b,self]]`. `as` aliases are dropped. Pure.
 */
export function expandUseTree(text: string): string[][] {
  const out: string[][] = [];
  const walk = (raw: string, prefix: string[]) => {
    const s = raw.trim();
    if (!s) return;
    const brace = s.indexOf("{");
    if (brace === -1) {
      const segs = s
        .split("::")
        .map((t) => t.trim().replace(/\s+as\s+.*$/, ""))
        .filter(Boolean);
      if (segs.length > 0) out.push([...prefix, ...segs]);
      return;
    }
    const head = s
      .slice(0, brace)
      .split("::")
      .map((t) => t.trim())
      .filter(Boolean);
    let depth = 0;
    let close = -1;
    for (let i = brace; i < s.length; i += 1) {
      const ch = s[i];
      if (ch === "{") depth += 1;
      else if (ch === "}") {
        depth -= 1;
        if (depth === 0) {
          close = i;
          break;
        }
      }
    }
    const inner = s.slice(brace + 1, close === -1 ? s.length : close);
    let level = 0;
    let start = 0;
    const parts: string[] = [];
    for (let i = 0; i < inner.length; i += 1) {
      const ch = inner[i];
      if (ch === "{") level += 1;
      else if (ch === "}") level -= 1;
      else if (ch === "," && level === 0) {
        parts.push(inner.slice(start, i));
        start = i + 1;
      }
    }
    parts.push(inner.slice(start));
    for (const part of parts) walk(part, [...prefix, ...head]);
  };
  walk(text, []);
  return out;
}

/** Crate names (`[package]` and `[lib]`, `-` → `_`) mapped to the crate's `lib.rs`, for every Cargo.toml in the repo. */
function cargoCrates(root: string, files: Set<string>): Map<string, string> {
  const out = new Map<string, string>();
  for (const cargo of files) {
    if (path.posix.basename(cargo) !== "Cargo.toml") continue;
    const content = readText(path.join(root, cargo));
    if (!content) continue;
    const dir = path.posix.dirname(cargo);
    const prefix = dir === "." ? "" : `${dir}/`;
    let section = "";
    let pkgName = "";
    let libName = "";
    let libPath = "src/lib.rs";
    for (const raw of content.split("\n")) {
      const line = raw.trim();
      const sec = /^\[([^\]]+)\]/.exec(line);
      if (sec) {
        section = (sec[1] ?? "").trim();
        continue;
      }
      const kv = /^([A-Za-z_-]+)\s*=\s*"([^"]*)"/.exec(line);
      if (!kv) continue;
      const key = kv[1] ?? "";
      const value = kv[2] ?? "";
      if (section === "package" && key === "name") pkgName = value;
      if (section === "lib" && key === "name") libName = value;
      if (section === "lib" && key === "path") libPath = value;
    }
    const lib = path.posix.normalize(`${prefix}${libPath}`);
    if (!files.has(lib)) continue;
    for (const name of [pkgName, libName]) {
      const crate = name.replace(/-/g, "_");
      if (crate && !out.has(crate)) out.set(crate, lib);
    }
  }
  return out;
}

const RUST_MOD_RE = /(?:^|\n)\s*(?:pub(?:\([^)]*\))?\s+)?mod\s+([A-Za-z_][A-Za-z0-9_]*)\s*;/g;
const RUST_USE_CRATE_RE = /(?:^|\n)\s*(?:pub(?:\([^)]*\))?\s+)?use\s+crate::([^;]+);/g;

function rustEdges(file: string, content: string, files: Set<string>, crates: Map<string, string>): RustRef[] {
  const merged = new Map<string, RustRef>();
  const add = (target: string, kind: "mod" | "import", name: string | null) => {
    if (target === file) return;
    const key = `${kind}>${target}`;
    let ref = merged.get(key);
    if (!ref) {
      ref = { target, kind, names: [] };
      merged.set(key, ref);
    }
    if (name && !ref.names.includes(name)) ref.names.push(name);
  };

  const dir = path.posix.dirname(file);
  const base = path.posix.basename(file, ".rs");
  const ownDir = base === "mod" || base === "main" || base === "lib" ? dir : `${dir}/${base}`;
  for (const m of content.matchAll(RUST_MOD_RE)) {
    const name = m[1] ?? "";
    for (const c of [`${ownDir}/${name}.rs`, `${ownDir}/${name}/mod.rs`, `${dir}/${name}.rs`, `${dir}/${name}/mod.rs`]) {
      if (files.has(c)) {
        add(c, "mod", name);
        break;
      }
    }
  }

  const root = crateRoot(file, files);
  for (const m of content.matchAll(RUST_USE_CRATE_RE)) {
    for (const segs of expandUseTree(m[1] ?? "")) {
      for (let n = segs.length; n >= 1; n -= 1) {
        const rel = segs.slice(0, n).join("/");
        const hit = [`${root}/${rel}.rs`, `${root}/${rel}/mod.rs`].find((c) => files.has(c));
        if (!hit) continue;
        const rest = segs[n] ?? segs[n - 1] ?? "";
        add(hit, "import", rest === "self" ? (segs[n - 1] ?? "") : rest);
        break;
      }
    }
  }

  for (const [crate, lib] of crates) {
    if (lib === file) continue;
    const useRe = new RegExp(`(?:^|\\n)\\s*(?:pub(?:\\([^)]*\\))?\\s+)?use\\s+${crate}::([^;]+);`, "g");
    for (const m of content.matchAll(useRe)) {
      for (const segs of expandUseTree(m[1] ?? "")) {
        const last = segs[segs.length - 1] ?? "";
        add(lib, "import", last === "self" ? crate : last);
      }
    }
    const callRe = new RegExp(`\\b${crate}::([A-Za-z0-9_:]+)\\s*\\(`, "g");
    for (const m of content.matchAll(callRe)) {
      const segs = (m[1] ?? "").split("::").filter(Boolean);
      add(lib, "import", segs[segs.length - 1] ?? null);
    }
  }
  return Array.from(merged.values());
}

// ---------------------------------------------------------------------------
// Notes join
// ---------------------------------------------------------------------------

function knowledgeFor(entries: NoteEntry[], inherited: number, stale: number): Knowledge {
  const k = emptyKnowledge();
  k.own = entries.length;
  k.inherited = inherited;
  k.stale = stale;
  for (const e of entries) {
    k.byType[e.type] += 1;
    if (e.date && (k.lastNoteDate === null || e.date > k.lastNoteDate)) k.lastNoteDate = e.date;
    if (k.lowestConfidence === null || CONFIDENCE_RANK[e.confidence] > CONFIDENCE_RANK[k.lowestConfidence]) k.lowestConfidence = e.confidence;
  }
  return k;
}

/** A note source (`src/a.ts`, `src/a.ts:12`, `src/auth/`) → the node id it cites, if any. */
function citedNodeId(source: string, nodes: Map<string, GraphNode>): string | null {
  const clean = normalizeRepoPath(source).replace(/:\d+(?:-\d+)?$/, "");
  if (!clean) return null;
  if (clean === "." || clean === "./" || clean === "_repo") return ROOT_DIR_ID;
  if (nodes.has(clean)) return clean;
  const dirId = `dir:${clean.replace(/\/$/, "")}/`;
  return nodes.has(dirId) ? dirId : null;
}

// ---------------------------------------------------------------------------
// Tasks
// ---------------------------------------------------------------------------

/** Paths named in a packet's `## Changes` section (a `git diff --stat` block or bullets), read from disk. */
function packetChanges(paths: RepoPaths, slug: string): string[] {
  const content = readText(packetFile(paths, slug));
  if (!content) return [];
  const { body } = splitFrontMatter(content);
  const out: string[] = [];
  let inChanges = false;
  for (const raw of body.split("\n")) {
    const line = raw.trim();
    if (/^##\s+/.test(line)) {
      inChanges = /^##\s+Changes\s*$/.test(line);
      continue;
    }
    if (!inChanges) continue;
    const stat = /^([^\s|]+)\s*\|\s*(?:\d+|Bin)\b/.exec(line);
    const bullet = /^-\s+`?([^\s`]+)`?\s*(?:\((?:NEW|MOD|DEL)\))?$/.exec(line);
    const p = stat?.[1] ?? bullet?.[1] ?? "";
    if (p && !p.includes("...") && !p.includes("=>")) out.push(p);
  }
  return out;
}

/** The node a task entry touches: files by id, folders (trailing slash or a known directory) by `dir:` id, never a child. */
function touchTarget(raw: string, nodes: Map<string, GraphNode>): string | null {
  const p = normalizeRepoPath(raw);
  if (!p || p === "." || p === "./") return ROOT_DIR_ID;
  if (p.endsWith("/")) {
    const id = `dir:${p}`;
    return nodes.has(id) ? id : null;
  }
  if (nodes.has(p)) return p;
  const dirId = `dir:${p}/`;
  return nodes.has(dirId) ? dirId : null;
}

// ---------------------------------------------------------------------------
// Tarjan
// ---------------------------------------------------------------------------

/**
 * Strongly connected components (iterative Tarjan, so a 4000-file chain cannot overflow the
 * stack). Every component is returned, singletons included, members in discovery order; edges
 * whose endpoints are not in `nodes` and self-loops are ignored. Shared with views.ts.
 */
export function tarjan(nodes: Iterable<string>, edges: ReadonlyArray<{ source: string; target: string }>): string[][] {
  const ids = Array.from(new Set(nodes));
  const adj = new Map<string, string[]>();
  for (const id of ids) adj.set(id, []);
  for (const e of edges) {
    if (e.source === e.target) continue;
    const list = adj.get(e.source);
    if (list && adj.has(e.target)) list.push(e.target);
  }
  let counter = 0;
  const index = new Map<string, number>();
  const low = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  const out: string[][] = [];

  for (const start of ids) {
    if (index.has(start)) continue;
    const visit = (v: string) => {
      index.set(v, counter);
      low.set(v, counter);
      counter += 1;
      stack.push(v);
      onStack.add(v);
    };
    visit(start);
    const work: { node: string; next: number }[] = [{ node: start, next: 0 }];
    while (work.length > 0) {
      const frame = work[work.length - 1];
      if (!frame) break;
      const succ = adj.get(frame.node) ?? [];
      if (frame.next < succ.length) {
        const w = succ[frame.next] ?? "";
        frame.next += 1;
        if (!index.has(w)) {
          visit(w);
          work.push({ node: w, next: 0 });
        } else if (onStack.has(w)) {
          low.set(frame.node, Math.min(low.get(frame.node) ?? 0, index.get(w) ?? 0));
        }
        continue;
      }
      work.pop();
      const parent = work[work.length - 1];
      if (parent) low.set(parent.node, Math.min(low.get(parent.node) ?? 0, low.get(frame.node) ?? 0));
      if (low.get(frame.node) === index.get(frame.node)) {
        const scc: string[] = [];
        for (;;) {
          const w = stack.pop();
          if (w === undefined) break;
          onStack.delete(w);
          scc.push(w);
          if (w === frame.node) break;
        }
        out.push(scc);
      }
    }
  }
  return out;
}

/** Components of size ≥ 2, each sorted, ordered by first member. */
export function findCycles(nodes: Iterable<string>, edges: ReadonlyArray<{ source: string; target: string }>): string[][] {
  return tarjan(nodes, edges)
    .filter((c) => c.length >= 2)
    .map((c) => [...c].sort())
    .sort((a, b) => (a[0] ?? "").localeCompare(b[0] ?? ""));
}

// ---------------------------------------------------------------------------
// buildGraph
// ---------------------------------------------------------------------------

interface FileScan {
  file: string;
  role: Role;
  lang: string;
  lines: number;
  imports: ImportRef[];
  rust: RustRef[];
  invokes: string[];
  /** `#[tauri::command]` names this file defines, in order. */
  commands: string[];
  entryKinds: EntryKind[];
}

function scanFile(file: string, content: string, fileSet: Set<string>, crates: Map<string, string>, detectors: readonly Detector[]): FileScan {
  const ext = extOf(file);
  const scan: FileScan = {
    file,
    role: roleOf(file, content.slice(0, 400)),
    lang: CODE_EXT[ext] ?? "Other",
    lines: countLines(content),
    imports: [],
    rust: [],
    invokes: [],
    commands: [],
    entryKinds: [],
  };
  if (ext === "rs") {
    scan.rust = rustEdges(file, content, fileSet, crates);
    for (const m of content.matchAll(TAURI_COMMAND_RE)) if (m[1] && !scan.commands.includes(m[1])) scan.commands.push(m[1]);
  } else {
    scan.imports = jsImports(content);
  }
  if (JS_FILE.test(file)) {
    const names = new Set<string>();
    for (const m of content.matchAll(INVOKE_RE)) if (m[1]) names.add(m[1]);
    scan.invokes = Array.from(names).sort();
  }
  for (const d of detectors) {
    if (isTestLike(scan.role) || !d.filePattern.test(file)) continue;
    const names = new Set<string>();
    for (const m of content.matchAll(d.regex)) names.add(m[1] ?? `${m.index ?? 0}`);
    if (names.size > 0) scan.entryKinds.push({ kind: d.kind, count: names.size });
  }
  return scan;
}

function baseNode(id: string, kind: NodeKind, label: string, nodePath: string, parent: string | null): GraphNode {
  return {
    id,
    kind,
    label,
    path: nodePath,
    parent,
    lang: "",
    lines: 0,
    role: "source",
    area: null,
    knowledge: emptyKnowledge(),
    tasks: [],
    inDegree: 0,
    outDegree: 0,
    testedBy: [],
    entry: false,
    entryKinds: [],
    dir: "",
    noteCount: 0,
    dirNoteCount: 0,
  };
}

/** Name from a manifest for a directory label: package.json `name`, Cargo `[lib] name` else `[package] name`. */
function manifestLabel(root: string, dirPath: string, manifest: Manifest): string | null {
  const prefix = dirPath === "./" ? "" : dirPath;
  const content = readText(path.join(root, `${prefix}${manifest}`));
  if (!content) return null;
  if (manifest === "package.json") {
    try {
      const parsed: unknown = JSON.parse(content);
      const name = parsed && typeof parsed === "object" ? (parsed as { name?: unknown }).name : undefined;
      return typeof name === "string" && name ? name : null;
    } catch {
      return null;
    }
  }
  let section = "";
  let pkg = "";
  let lib = "";
  for (const raw of content.split("\n")) {
    const line = raw.trim();
    const sec = /^\[([^\]]+)\]/.exec(line);
    if (sec) {
      section = (sec[1] ?? "").trim();
      continue;
    }
    const kv = /^name\s*=\s*"([^"]*)"/.exec(line);
    if (!kv) continue;
    if (section === "package") pkg = kv[1] ?? "";
    if (section === "lib") lib = kv[1] ?? "";
  }
  return lib || pkg || null;
}

/**
 * The repo as a graph: every node kind, joined with notes, history and tasks (spec §6.1).
 * TypeScript, JavaScript and Rust are resolved; other languages get no file nodes.
 */
export function buildGraph(paths: RepoPaths, opts: BuildGraphOptions = {}): RepoGraph {
  const root = paths.root;
  const repoName = detectName(root);
  const repoId = `repo:${repoName}`;
  const all = listRepoFiles(root).filter((f) => !isIgnoredPath(f));
  const fileSet = new Set(all);
  const code = all.filter((f) => CODE_EXT[extOf(f)] !== undefined);
  const crates = cargoCrates(root, fileSet);
  const detectors = opts.detectors ?? BOUNDARY_DETECTORS;

  const nodes = new Map<string, GraphNode>();
  const edges: GraphEdge[] = [];
  const edgeIndex = new Map<string, GraphEdge>();
  const addEdge = (source: string, target: string, kind: EdgeKind, names: string[], extra: { isType?: boolean; confidence?: Confidence } = {}): GraphEdge => {
    const key = `${source}>${target}>${kind}`;
    let edge = edgeIndex.get(key);
    if (!edge) {
      edge = { source, target, kind };
      if (extra.confidence) edge.confidence = extra.confidence;
      if (extra.isType) edge.isType = true;
      edgeIndex.set(key, edge);
      edges.push(edge);
    } else if (edge.isType && !extra.isType) {
      delete edge.isType;
    }
    if (names.length > 0) {
      const merged = new Set(edge.names ?? []);
      for (const n of names) merged.add(n);
      edge.names = Array.from(merged);
    }
    return edge;
  };

  // --- 1. scan code files ---------------------------------------------------
  const scans: FileScan[] = [];
  for (const file of code) {
    let content = "";
    try {
      content = readFileSync(path.join(root, file), "utf8");
    } catch {
      continue;
    }
    scans.push(scanFile(file, content, fileSet, crates, detectors));
  }

  // --- 2. hierarchy: repo, dirs, files ----------------------------------------
  const repoNode = baseNode(repoId, "repo", repoName, "", null);
  repoNode.dir = "(root)";
  nodes.set(repoId, repoNode);
  const rootDir = baseNode(ROOT_DIR_ID, "dir", repoName, "./", repoId);
  rootDir.dir = "(root)";
  nodes.set(ROOT_DIR_ID, rootDir);

  const dirPaths = new Set<string>();
  for (const s of scans) for (const d of dirChain(s.file)) dirPaths.add(d);
  const dirsShallowFirst = Array.from(dirPaths).sort((a, b) => a.split("/").length - b.split("/").length || a.localeCompare(b));
  for (const d of dirsShallowFirst) {
    const bare = d.replace(/\/$/, "");
    const node = baseNode(`dir:${d}`, "dir", path.posix.basename(bare), d, `dir:${parentDirPath(d)}`.replace("dir:./", ROOT_DIR_ID));
    node.dir = d;
    nodes.set(node.id, node);
  }
  const manifestDirs = new Set<string>();
  for (const d of ["./", ...dirsShallowFirst]) {
    const node = nodes.get(d === "./" ? ROOT_DIR_ID : `dir:${d}`);
    if (!node) continue;
    const prefix = d === "./" ? "" : d;
    const manifest: Manifest | null = fileSet.has(`${prefix}package.json`) ? "package.json" : fileSet.has(`${prefix}Cargo.toml`) ? "Cargo.toml" : null;
    node.manifest = manifest;
    if (manifest) {
      if (d !== "./") manifestDirs.add(d);
      const label = manifestLabel(root, d, manifest);
      if (label) node.label = label;
    }
  }
  if (rootDir.manifest) repoNode.manifest = rootDir.manifest;
  const areaFor = (dirPath: string): string | null => {
    if (dirPath === "./") return null;
    const segs = dirPath.replace(/\/$/, "").split("/");
    for (let n = segs.length; n >= 1; n -= 1) {
      const p = `${segs.slice(0, n).join("/")}/`;
      if (manifestDirs.has(p)) return `dir:${p}`;
    }
    return `dir:${segs[0] ?? ""}/`;
  };
  for (const d of dirsShallowFirst) {
    const node = nodes.get(`dir:${d}`);
    if (node) node.area = areaFor(d);
  }

  for (const s of scans) {
    const parent = parentDirId(s.file);
    const node = baseNode(s.file, "file", path.posix.basename(s.file), s.file, parent);
    node.lang = s.lang;
    node.lines = s.lines;
    node.role = s.role;
    node.area = parent === ROOT_DIR_ID ? null : areaFor(parent.slice("dir:".length));
    node.dir = dirKey(s.file);
    if (s.entryKinds.length > 0) node.entryKinds.push(...s.entryKinds);
    nodes.set(s.file, node);
  }

  // --- 3. code edges ------------------------------------------------------------
  let unresolved = 0;
  // Command name → defining file (first definer in file order wins).
  const commandDefiners = new Map<string, string>();
  for (const s of scans) for (const name of s.commands) if (!commandDefiners.has(name)) commandDefiners.set(name, s.file);

  for (const s of scans) {
    const kindFor = (base: "import" | "mod"): EdgeKind => (isTestLike(s.role) ? "tests" : base);
    for (const r of s.rust) addEdge(s.file, r.target, kindFor(r.kind), r.names);
    for (const ref of s.imports) {
      const target = resolveJsImport(s.file, ref.spec, fileSet);
      if (!target) {
        if (ref.spec.startsWith(".")) unresolved += 1;
        continue;
      }
      if (target === s.file) continue;
      addEdge(s.file, target, kindFor("import"), ref.names, { isType: ref.isType });
    }
    if (s.invokes.length > 0) {
      const byFile = new Map<string, string[]>();
      for (const name of s.invokes) {
        const def = commandDefiners.get(name);
        if (!def || def === s.file) continue;
        const list = byFile.get(def) ?? [];
        list.push(name);
        byFile.set(def, list);
      }
      for (const [def, names] of byFile) addEdge(s.file, def, "ipc", names, { confidence: "exact" });
    }
  }
  for (const e of edges) {
    if (e.kind !== "tests") continue;
    const source = nodes.get(e.source);
    const target = nodes.get(e.target);
    if (source?.role === "test" && target && !target.testedBy.includes(e.source)) target.testedBy.push(e.source);
  }

  // --- 4. notes join --------------------------------------------------------------
  const notes = opts.notes ?? notesIndex(paths);
  const history = opts.history ?? repoHistory(root);
  const staleCount = new Map<string, number>();
  for (const s of staleEntriesFor(paths, Array.from(notes.values()), history.lastTouched)) {
    staleCount.set(s.entity, (staleCount.get(s.entity) ?? 0) + 1);
  }
  const entriesOf = (entity: string): NoteEntry[] => notes.get(entity)?.entries ?? [];
  const inheritedOf = new Map<string, number>();
  repoNode.knowledge = knowledgeFor(entriesOf("_repo"), 0, staleCount.get("_repo") ?? 0);
  rootDir.knowledge = knowledgeFor(entriesOf("_repo"), 0, staleCount.get("_repo") ?? 0);
  inheritedOf.set(ROOT_DIR_ID, 0);
  for (const d of dirsShallowFirst) {
    const node = nodes.get(`dir:${d}`);
    if (!node) continue;
    const parent = nodes.get(node.parent ?? "");
    const inherited = (inheritedOf.get(parent?.id ?? "") ?? 0) + (parent?.knowledge.own ?? 0);
    inheritedOf.set(node.id, inherited);
    node.knowledge = knowledgeFor(entriesOf(d), inherited, staleCount.get(d) ?? 0);
  }
  for (const s of scans) {
    const node = nodes.get(s.file);
    if (!node) continue;
    const parent = nodes.get(node.parent ?? "");
    const inherited = (inheritedOf.get(parent?.id ?? "") ?? 0) + (parent?.knowledge.own ?? 0);
    node.knowledge = knowledgeFor(entriesOf(s.file), inherited, staleCount.get(s.file) ?? 0);
  }
  for (const node of nodes.values()) {
    node.noteCount = node.knowledge.own;
    // Compatibility: entries on the immediate parent folder's note; 0 for root files (as before).
    const parent = node.parent && node.parent !== ROOT_DIR_ID ? nodes.get(node.parent) : undefined;
    node.dirNoteCount = parent && parent.kind === "dir" ? parent.knowledge.own : 0;
  }
  for (const note of notes.values()) {
    if (note.kind !== "entity") continue;
    const id = `entity:${note.entity}`;
    const name = note.entity.slice(note.entity.indexOf(":") + 1);
    const node = baseNode(id, "entity", name, "", null);
    node.lang = "entity";
    node.dir = "(entities)";
    node.knowledge = knowledgeFor(note.entries, 0, 0);
    node.noteCount = node.knowledge.own;
    nodes.set(id, node);
    for (const entry of note.entries) {
      for (const source of entry.sources) {
        const target = citedNodeId(source, nodes);
        if (target) addEdge(id, target, "annotates", []);
      }
    }
  }

  // --- 5. entry markers -------------------------------------------------------------
  const facts = opts.facts ?? collectFacts(root);
  for (const entryPath of facts.entryPoints) {
    const node = nodes.get(normalizeRepoPath(entryPath));
    if (!node || node.kind !== "file") continue;
    if (!node.entryKinds.some((k) => k.kind === "main")) node.entryKinds.unshift({ kind: "main", count: 1 });
  }
  for (const node of nodes.values()) node.entry = node.entryKinds.length > 0;

  // --- 6. tasks -----------------------------------------------------------------------
  let tasks: TaskInfo[] = [];
  if (opts.tasks) tasks = opts.tasks;
  else {
    try {
      tasks = listTasks(paths, opts.config ?? loadConfig(paths), { includeDone: true });
    } catch {
      tasks = [];
    }
  }
  for (const t of tasks) {
    const id = `task:${t.slug}`;
    const node = baseNode(id, "task", t.title || t.slug, "", null);
    node.lang = "task";
    node.dir = "(tasks)";
    node.state = t.state;
    node.risk = t.risk;
    node.owner = t.owner;
    node.age = t.age;
    nodes.set(id, node);
    for (const raw of uniq([...t.planFiles, ...t.changedFiles, ...packetChanges(paths, t.slug)])) {
      const target = touchTarget(raw, nodes);
      if (!target) continue;
      addEdge(id, target, "touches", []);
      const touched = nodes.get(target);
      if (touched && !touched.tasks.includes(t.slug)) touched.tasks.push(t.slug);
    }
  }

  // --- 7. history ---------------------------------------------------------------------
  for (const s of scans) {
    const h = historyFor(history, s.file);
    const node = nodes.get(s.file);
    if (h && node) node.history = h;
  }

  // --- 8. degrees, aggregates, cycles ---------------------------------------------------
  const kept = edges.filter((e) => nodes.has(e.source) && nodes.has(e.target));
  for (const e of kept) {
    if (NON_DEGREE_KINDS.has(e.kind)) continue;
    const s = nodes.get(e.source);
    const t = nodes.get(e.target);
    if (s) s.outDegree += 1;
    if (t) t.inDegree += 1;
  }

  const aggs = new Map<string, Aggregates>();
  const taskSets = new Map<string, Set<string>>();
  const langCounts = new Map<string, Map<string, number>>();
  const aggOf = (id: string) => {
    let a = aggs.get(id);
    if (!a) {
      a = emptyAggregates();
      aggs.set(id, a);
      taskSets.set(id, new Set());
      langCounts.set(id, new Map());
    }
    return a;
  };
  for (const s of scans) {
    const node = nodes.get(s.file);
    if (!node) continue;
    const a = aggOf(node.parent ?? ROOT_DIR_ID);
    a.files += 1;
    if (node.role === "source") a.source += 1;
    if (isTestLike(node.role)) a.tests += 1;
    if (node.role === "config") a.config += 1;
    a.lines += node.lines;
    if (node.role === "source" && (node.knowledge.own > 0 || node.knowledge.inherited > 0)) a.documented += 1;
    if (node.role === "source" && node.testedBy.length > 0) a.testedSource += 1;
    a.stale += node.knowledge.stale;
    const ts = taskSets.get(node.parent ?? ROOT_DIR_ID);
    for (const slug of node.tasks) ts?.add(slug);
    const lc = langCounts.get(node.parent ?? ROOT_DIR_ID);
    lc?.set(node.lang, (lc.get(node.lang) ?? 0) + 1);
  }
  const fold = (from: string, into: string) => {
    const a = aggOf(from);
    const b = aggOf(into);
    b.files += a.files;
    b.source += a.source;
    b.tests += a.tests;
    b.config += a.config;
    b.lines += a.lines;
    b.documented += a.documented;
    b.stale += a.stale;
    b.testedSource += a.testedSource;
    const ts = taskSets.get(into);
    for (const slug of taskSets.get(from) ?? []) ts?.add(slug);
    const lc = langCounts.get(into);
    for (const [lang, n] of langCounts.get(from) ?? []) lc?.set(lang, (lc.get(lang) ?? 0) + n);
  };
  const finish = (node: GraphNode) => {
    const a = aggOf(node.id);
    a.stale += node.knowledge.stale;
    const ts = taskSets.get(node.id);
    for (const slug of node.tasks) ts?.add(slug);
    a.tasks = Array.from(ts ?? []).sort();
    const h = historyFor(history, node.path === "" ? "./" : node.path);
    if (h) a.history = h;
    node.aggregates = a;
    node.lines = a.lines;
    const langs = Array.from(langCounts.get(node.id) ?? []).sort((x, y) => y[1] - x[1] || x[0].localeCompare(y[0]));
    node.lang = langs[0]?.[0] ?? "";
  };
  for (const d of [...dirsShallowFirst].reverse()) {
    const node = nodes.get(`dir:${d}`);
    if (!node) continue;
    finish(node);
    fold(node.id, node.parent ?? ROOT_DIR_ID);
  }
  finish(rootDir);
  fold(ROOT_DIR_ID, repoId);
  finish(repoNode);
  repoNode.knowledge = { ...rootDir.knowledge, byType: { ...rootDir.knowledge.byType } };

  const fileIds = scans.map((s) => s.file);
  const cycleEdges = kept.filter((e) => CYCLE_KINDS.has(e.kind) && nodes.get(e.source)?.kind === "file" && nodes.get(e.target)?.kind === "file");
  const cycles = findCycles(fileIds, cycleEdges);
  const sccOf = new Map<string, number>();
  cycles.forEach((c, i) => c.forEach((id) => sccOf.set(id, i)));
  for (const e of cycleEdges) {
    const a = sccOf.get(e.source);
    if (a !== undefined && a === sccOf.get(e.target)) e.cycle = true;
  }

  // --- 9. assemble ------------------------------------------------------------------------
  const ordered: GraphNode[] = [repoNode, rootDir];
  for (const d of dirsShallowFirst) {
    const n = nodes.get(`dir:${d}`);
    if (n) ordered.push(n);
  }
  for (const s of scans) {
    const n = nodes.get(s.file);
    if (n) ordered.push(n);
  }
  for (const n of nodes.values()) if (n.kind === "entity") ordered.push(n);
  for (const n of nodes.values()) if (n.kind === "task") ordered.push(n);

  const flatNodes = ordered.filter((n) => n.kind === "file" || n.kind === "task");
  const dirs = Array.from(new Set(flatNodes.map((n) => n.dir))).sort();
  const languages = Array.from(new Set(flatNodes.map((n) => n.lang))).sort();
  return {
    nodes: ordered,
    edges: kept,
    cycles,
    dirs,
    unresolved,
    generatedAt: nowIso(),
    languages,
    totalCodeFiles: code.length,
    included: scans.length,
    truncated: false,
  };
}

/** The compatibility payload for `GET /api/graph` without parameters: file and task nodes, edges among them, `MAX_NODES` files at most. */
export function flatGraph(g: RepoGraph): FlatGraph {
  const files = g.nodes.filter((n) => n.kind === "file");
  const keptFiles = files.slice(0, MAX_NODES);
  const tasks = g.nodes.filter((n) => n.kind === "task");
  const nodes = [...keptFiles, ...tasks];
  const ids = new Set(nodes.map((n) => n.id));
  return {
    nodes,
    edges: g.edges.filter((e) => ids.has(e.source) && ids.has(e.target)),
    dirs: g.dirs,
    unresolved: g.unresolved,
    generatedAt: g.generatedAt,
    languages: g.languages,
    totalCodeFiles: g.totalCodeFiles,
    included: keptFiles.length,
    truncated: files.length > MAX_NODES,
  };
}
