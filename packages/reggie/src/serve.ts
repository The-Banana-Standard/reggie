import { randomBytes, timingSafeEqual } from "node:crypto";
import { createReadStream, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import YAML from "yaml";
import { addIntakeDetail, capture, resolveCaptureOrigin, resolvePackPaths, type CaptureOrigin } from "./capture.js";
import { changesPayload, DiffRowCache, fileDiff, listChanges, taskRange, type ChangeEntry, type RangeResult, type TaskChanges } from "./changes.js";
import { buildContext } from "./context.js";
import { collectFacts, type RepoFacts } from "./facts.js";
import { listEpisodes, makeEpisode, readEpisode, renderFeed } from "./episode.js";
import { detectFlows, MAX_FLOW_HOPS, traceFlow, type Flow, type FlowIndex } from "./flows.js";
import { currentBranch, defaultBranch, fileAtRef, git } from "./git.js";
import { buildGraph, flatGraph, jsImports, type GraphEdge, type GraphNode, type RepoGraph } from "./graph.js";
import { commitsPerDayFor, historyFor, historyLogArgs, parseNumstatLog, recentFor, repoHistory, taskLanding, type CommitInfo, type HistoryIndex, type LogCommit, type TaskLanding } from "./history.js";
import { appendJournal, readJournal, type JournalEntry } from "./journal.js";
import { claimTask } from "./claim.js";
import { pendingSetup } from "./deps.js";
import { LandError, landTask } from "./land.js";
import { isLaunchMode, isLaunchTool, LAUNCH_MODES, LAUNCH_TOOLS, launchCommand, launchSession, MAX_LAUNCH_PATHS, MAX_NOTE_CHARS, mintSession, recordLaunch, resolveGoal, writeContextPacks, type LaunchMode, type LaunchTask, type LaunchTool } from "./launch.js";
import { narrate } from "./narrate.js";
import { addNote, allNoteFiles, NOTE_TYPES, notesForPath, notesIndex, readNoteFile, staleEntriesFor, type Confidence as NoteConfidence, type NoteEntry, type NoteFile, type NoteType, type StaleEntry } from "./notes.js";
import { decidePacket, locatePacket, materializePacket } from "./packet.js";
import { evidenceDir, packetRelPath, type RepoPaths } from "./paths.js";
import { evaluateCompletion, type PolicyReport } from "./policy.js";
import { currentPerson, handleFor, inferMode, loadPeople, type PeopleFile, type Person, type ReggieConfig } from "./people.js";
import { roleOf } from "./roles.js";
import { detectServices, type ServiceIndex, type ServiceNode } from "./services.js";
import { buildSemanticIndex, type SemanticIndex } from "./semantic-index.js";
import { areaStory, buildStoryContext, explain, fileStory, flowStory, repoStory, routeFor, servicesStory, taskStory, workspaceStory, type Lens, type Story, type StoryContext } from "./story.js";
import { extractSymbols, fileSymbols, SYMBOL_ENGINE, symbolLang } from "./symbols.js";
import { getTaskDetail, knownSlugs, listTasks, STATE_MACHINE, TASK_STATES, type PacketCriterion, type TaskDetail, type TaskInfo, type TaskState } from "./tasks.js";
import { scaffoldBrief } from "./triage.js";
import { isSafeSlug, readText, slugify, uniq } from "./util.js";
import { containerView, dirView, impactView, level1, type ViewGraph } from "./views.js";
import { RepoCtx, RepoRegistry, workspaceSummary, type Workspace } from "./workspace.js";

/** The static UI directory: packages/reggie/ui, resolved from dist/serve.js or src/serve.ts alike. */
export const UI_DIR = path.resolve(fileURLToPath(import.meta.url), "../../ui");
const PACKAGE_DIR = path.resolve(UI_DIR, "..");

/** Files served under /vendor/<name>, relative to this package's node_modules. */
export const VENDOR_FILES: Record<string, string> = {
  "cytoscape.min.js": "cytoscape/dist/cytoscape.min.js",
  "dagre.min.js": "dagre/dist/dagre.min.js",
  "cytoscape-dagre.js": "cytoscape-dagre/cytoscape-dagre.js",
  "d3.min.js": "d3/dist/d3.min.js",
};

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".md": "text/markdown; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
};

/**
 * Evidence is written by agents, and `.html` and `.svg` are active content. Served plainly they
 * would run with same-origin access to this server — which has POST routes that write files into
 * the repo and start sessions. `sandbox` with no allow-tokens puts the response in a unique opaque
 * origin: no scripts, no forms, no same-origin reads. `nosniff` stops a mislabelled file being
 * re-interpreted as one of them. A test report still renders; it just cannot reach back in here.
 */
export function evidenceHeaders(type: string): Record<string, string> {
  return {
    "content-type": type,
    "cache-control": "no-store",
    "content-security-policy": "sandbox",
    "x-content-type-options": "nosniff",
    "referrer-policy": "no-referrer",
  };
}

/** Content types for `/api/evidence`; anything else is served as a download. */
const EVIDENCE_TYPES: Record<string, string> = {
  ".txt": "text/plain; charset=utf-8",
  ".log": "text/plain; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".csv": "text/csv; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
};

/** Extensions whose evidence can be recovered from the task branch when it is not in the working tree. */
const TEXTUAL_EVIDENCE = new Set([".txt", ".log", ".md", ".csv", ".json", ".html", ".svg"]);

/** Source text returned by `/api/file`, in characters. */
export const MAX_FILE_CHARS = 20_000;
/** POST bodies larger than this are refused with 413 (spec §8). */
export const MAX_BODY_BYTES = 64 * 1024;
/** State that changes without a commit (tasks, notes, journal, intake) is cached this long. */
const STATE_TTL_MS = 10_000;
/** Default editor scheme for `editorUrl`; `.reggie/config.yaml` may override it. */
export const DEFAULT_EDITOR_SCHEME = "vscode://file";

// ---------------------------------------------------------------------------
// Responses
// ---------------------------------------------------------------------------

function json(res: ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body);
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "content-length": Buffer.byteLength(text) });
  res.end(text);
}

function sendFile(res: ServerResponse, file: string, cacheControl: string): void {
  const type = CONTENT_TYPES[path.extname(file).toLowerCase()] ?? "application/octet-stream";
  const body = readFileSync(file);
  res.writeHead(200, { "content-type": type, "cache-control": cacheControl, "content-length": body.length });
  res.end(body);
}

/** Resolve a request path under a base directory; null when it escapes, is absolute, or is not a regular file. */
export function safeStaticPath(baseDir: string, rel: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(rel);
  } catch {
    return null;
  }
  if (!decoded || decoded.includes("\0") || decoded.includes("\\")) return null;
  if (path.isAbsolute(decoded) || decoded.startsWith("/") || decoded.split("/").some((seg) => seg === "..")) return null;
  const full = path.resolve(baseDir, decoded);
  const base = path.resolve(baseDir);
  if (full !== base && !full.startsWith(`${base}${path.sep}`)) return null;
  if (!existsSync(full) || !statSync(full).isFile()) return null;
  return full;
}

/** A repo-relative path that stays inside the repo: no absolute paths, no `..`, no backslashes. */
export function safeRepoPath(raw: string): string | null {
  const value = String(raw ?? "").trim();
  if (!value || value.includes("\0") || value.includes("\\")) return null;
  const clean = value.replace(/^\.\//, "");
  if (path.posix.isAbsolute(clean) || path.isAbsolute(clean)) return null;
  if (clean.split("/").some((seg) => seg === "..")) return null;
  return clean;
}

// ---------------------------------------------------------------------------
// Per-repo derived state, cached by HEAD sha (code) or a short TTL (working state)
// ---------------------------------------------------------------------------

/** `.reggie/config.yaml` keys the typed `ReggieConfig` does not carry yet. */
interface ConfigExtras {
  editorScheme: string;
  /** `areas: [paths]` pins Level-1 area selection (spec §6.2 step 4). */
  areas: string[];
}

function extrasOf(c: RepoCtx): ConfigExtras {
  return c.cached<ConfigExtras>(
    "configExtras",
    () => {
      const out: ConfigExtras = { editorScheme: DEFAULT_EDITOR_SCHEME, areas: [] };
      const raw = readText(c.paths.config);
      if (!raw) return out;
      let parsed: unknown = null;
      try {
        parsed = YAML.parse(raw);
      } catch {
        return out;
      }
      if (!parsed || typeof parsed !== "object") return out;
      const rec = parsed as Record<string, unknown>;
      if (typeof rec.editorScheme === "string" && rec.editorScheme) out.editorScheme = rec.editorScheme;
      if (Array.isArray(rec.areas)) out.areas = rec.areas.filter((x): x is string => typeof x === "string");
      return out;
    },
    { ttlMs: STATE_TTL_MS },
  );
}

function peopleOf(c: RepoCtx): PeopleFile {
  return c.cached("people", () => loadPeople(c.paths), { ttlMs: STATE_TTL_MS });
}

function factsOf(c: RepoCtx): RepoFacts {
  return c.cached("facts", () => collectFacts(c.root));
}

function historyOf(c: RepoCtx): HistoryIndex {
  return c.cached("history", () => repoHistory(c.root, { sha: c.headSha(), people: peopleOf(c) }));
}

function notesOf(c: RepoCtx): NoteFile[] {
  return c.cached("notes", () => allNoteFiles(c.paths), { ttlMs: STATE_TTL_MS });
}

function notesIndexOf(c: RepoCtx): Map<string, NoteFile> {
  return c.cached("notesIndex", () => notesIndex(c.paths), { ttlMs: STATE_TTL_MS });
}

function tasksOf(c: RepoCtx): TaskInfo[] {
  return c.cached(
    "tasks",
    () => {
      try {
        return listTasks(c.paths, c.config, { includeDone: true });
      } catch {
        return [] as TaskInfo[];
      }
    },
    { ttlMs: STATE_TTL_MS },
  );
}

function staleOf(c: RepoCtx): StaleEntry[] {
  return c.cached("stale", () => staleEntriesFor(c.paths, notesOf(c), historyOf(c).lastTouched), { ttlMs: STATE_TTL_MS });
}

function journalOf(c: RepoCtx): JournalEntry[] {
  return c.cached("journal", () => readJournal(c.paths, { days: 365, limit: 500 }), { ttlMs: STATE_TTL_MS });
}

function graphOf(c: RepoCtx): RepoGraph {
  return c.cached("graph", () =>
    buildGraph(c.paths, { history: historyOf(c), facts: factsOf(c), config: c.config, notes: notesIndexOf(c), tasks: tasksOf(c) }),
  );
}

function nodeIndexOf(c: RepoCtx): Map<string, GraphNode> {
  return c.cached("nodeIndex", () => new Map(graphOf(c).nodes.map((n) => [n.id, n])));
}

interface EdgeIndex {
  bySource: Map<string, GraphEdge[]>;
  byTarget: Map<string, GraphEdge[]>;
}

function edgeIndexOf(c: RepoCtx): EdgeIndex {
  return c.cached("edgeIndex", () => {
    const bySource = new Map<string, GraphEdge[]>();
    const byTarget = new Map<string, GraphEdge[]>();
    for (const e of graphOf(c).edges) {
      const s = bySource.get(e.source);
      if (s) s.push(e);
      else bySource.set(e.source, [e]);
      const t = byTarget.get(e.target);
      if (t) t.push(e);
      else byTarget.set(e.target, [e]);
    }
    return { bySource, byTarget };
  });
}

/**
 * Source files carrying a note **of their own**, per directory id.
 *
 * `aggregates.documented` counts own *or inherited* notes, so a single `_repo` note makes every area
 * 100% documented and the Knowledge lens flat (spec §2 lens table, acceptance criteria 2 and 12 need
 * "src/components ... none with a note"). `documentedOwn` is additive: nothing else reads it.
 */
function ownDocumentedOf(c: RepoCtx): Map<string, number> {
  return c.cached("ownDocumented", () => {
    const g = graphOf(c);
    const byId = new Map(g.nodes.map((n) => [n.id, n]));
    const counts = new Map<string, number>();
    for (const n of g.nodes) {
      if (n.kind !== "file" || n.role !== "source" || (n.knowledge?.own ?? 0) <= 0) continue;
      let parent: string | null = n.parent;
      const seen = new Set<string>();
      while (parent && !seen.has(parent)) {
        seen.add(parent);
        counts.set(parent, (counts.get(parent) ?? 0) + 1);
        parent = byId.get(parent)?.parent ?? null;
      }
    }
    return counts;
  });
}

/** Decorate a view's directory nodes with `aggregates.documentedOwn` (clones, never mutates shared aggregates). */
function withOwnDocumented<T extends ViewGraph>(c: RepoCtx, view: T): T {
  const counts = ownDocumentedOf(c);
  for (const n of view.nodes) {
    if (!n.aggregates) continue;
    const id = n.id.replace(/^ghost:(?:up|down):/, "");
    n.aggregates = { ...n.aggregates, documentedOwn: counts.get(id) ?? 0 } as typeof n.aggregates;
  }
  return view;
}

function containerOf(c: RepoCtx): ViewGraph {
  return c.cached("view:container", () => withOwnDocumented(c, containerView(graphOf(c), viewOpts(c))));
}

function areaOpts(c: RepoCtx): { areas?: readonly string[] } {
  const areas = extrasOf(c).areas;
  return areas.length > 0 ? { areas } : {};
}

/**
 * `areaOpts` plus the history index, for the two views that draw nodes the Heat lens colours.
 * Without it a residual or config-pinned area — a file set, not a directory — has no entry in
 * `byPath` and so reaches the client with no `commits30` at all, which the lens reads as 0 and
 * buckets with the genuinely cold areas.
 */
function viewOpts(c: RepoCtx): { areas?: readonly string[]; history: HistoryIndex } {
  return { ...areaOpts(c), history: historyOf(c) };
}

interface SymbolHit {
  name: string;
  kind: string;
  file: string;
  line: number;
}

/** Exported symbols across the repo, for `/api/search`. Built at most once per HEAD sha. */
function symbolIndexOf(c: RepoCtx): SymbolHit[] {
  return c.cached("symbolIndex", () => {
    const semantic = semanticIndexOf(c);
    const generated = new Set(semantic.files.filter((file) => file.role === "generated").map((file) => file.file));
    const out: SymbolHit[] = semantic.symbols
      .filter((symbol) => symbol.exported && !generated.has(symbol.file))
      .map((symbol) => ({ name: symbol.qualifiedName, kind: symbol.kind, file: symbol.file, line: symbol.declaration.startLine }));
    for (const n of graphOf(c).nodes) {
      if (n.kind !== "file" || n.role === "generated" || symbolLang(n.path) !== "rust") continue;
      const content = readText(path.join(c.root, n.path));
      if (content === null) continue;
      for (const s of extractSymbols(n.path, content)) {
        if (s.exported) out.push({ name: s.name, kind: s.kind, file: n.path, line: s.line });
      }
    }
    return out;
  });
}

// ---------------------------------------------------------------------------
// Services and data flow (services-and-flows-spec.md §1–§3)
// ---------------------------------------------------------------------------

/**
 * What the repo talks to. A pure function of the tree — manifests plus one pass over the
 * code files the graph already found — so HEAD sha is the whole cache key.
 */
function servicesOf(c: RepoCtx): ServiceIndex {
  return c.cached("services", () => detectServices(c.paths, graphOf(c), { notes: notesIndexOf(c) }));
}

/** One compiler program and semantic model per repository revision, shared by every reader. */
function semanticIndexOf(c: RepoCtx): SemanticIndex {
  return c.cached("semanticIndex", () => buildSemanticIndex(c.paths, graphOf(c)));
}

/**
 * Every entry point, each traced once. The declared services go in so a binding resolves to
 * the kind `wrangler.toml` gives it instead of the one its method suggests.
 */
function flowsOf(c: RepoCtx): FlowIndex {
  return c.cached("flows", () => detectFlows(c.paths, graphOf(c), { services: servicesOf(c).services, semanticIndex: semanticIndexOf(c) }));
}

/**
 * One flow at one depth, or null when nothing is entered there. The id is checked against the
 * index *before* the cache is touched, so an unknown id cannot mint cache keys.
 */
function flowOf(c: RepoCtx, id: string, depth: number): Flow | null {
  const entry = flowsOf(c).entries.find((e) => e.id === id || e.node === id);
  if (!entry) return null;
  return c.cached(`flow:${depth}:${entry.id}`, () => traceFlow(c.paths, graphOf(c), entry.id, { depth, services: servicesOf(c).services, semanticIndex: semanticIndexOf(c) }));
}

/** The files on each side of a service, from the §1 edges (contract: `/api/services`). */
interface ServiceFiles {
  files: string[];
  readers: string[];
  writers: string[];
}

const NO_SERVICE_FILES: ServiceFiles = { files: [], readers: [], writers: [] };

function serviceFilesOf(c: RepoCtx): Map<string, ServiceFiles> {
  return c.cached("serviceFiles", () => {
    const out = new Map<string, ServiceFiles>();
    for (const e of servicesOf(c).edges) {
      let hit = out.get(e.service);
      if (!hit) {
        hit = { files: [], readers: [], writers: [] };
        out.set(e.service, hit);
      }
      if (!hit.files.includes(e.file)) hit.files.push(e.file);
      const side = e.op === "read" ? hit.readers : e.op === "write" ? hit.writers : null;
      if (side && !side.includes(e.file)) side.push(e.file);
    }
    for (const hit of out.values()) {
      hit.files.sort();
      hit.readers.sort();
      hit.writers.sort();
    }
    return out;
  });
}

/** A service node with the files that touch it attached (contract: `/api/services`). */
function decorateService(c: RepoCtx, node: ServiceNode): ServiceNode & ServiceFiles {
  return { ...node, ...(serviceFilesOf(c).get(node.id) ?? NO_SERVICE_FILES) };
}

/**
 * Entity notes about one service. `services.ts` counts them; this returns the note files
 * themselves, matched the same way — by the slug of the binding or the human name, so
 * `service:CACHE`, `env:OPENAI_API_KEY` and `store:jacob-chat-logs` all find their node.
 */
function serviceNotesOf(c: RepoCtx, node: ServiceNode): NoteFile[] {
  const wanted = new Set([node.binding, node.name].filter((v): v is string => Boolean(v)).map((v) => slugify(v, 80)));
  const out: NoteFile[] = [];
  for (const note of notesIndexOf(c).values()) {
    if (note.kind !== "entity") continue;
    const name = note.entity.slice(note.entity.indexOf(":") + 1);
    if (wanted.has(slugify(name, 80))) out.push(note);
  }
  return withStaleFlags(out, staleOf(c));
}

function storyContextOf(c: RepoCtx, repoName: string, lens: Lens, days: number): StoryContext {
  return c.cached(
    `story:${lens}:${days}`,
    () =>
      buildStoryContext(c.paths, c.config, graphOf(c), historyOf(c), {
        repo: repoName,
        facts: factsOf(c),
        people: peopleOf(c),
        tasks: tasksOf(c),
        notes: notesOf(c),
        stale: staleOf(c),
        journal: journalOf(c),
        lens,
        days,
        readFile: (file: string) => {
          const rel = safeRepoPath(file);
          return rel === null ? null : readText(path.join(c.root, rel));
        },
      }),
    { ttlMs: STATE_TTL_MS },
  );
}

// ---------------------------------------------------------------------------
// Small shared derivations
// ---------------------------------------------------------------------------

function staleKey(entity: string, entry: { date: string; type: string; text: string }): string {
  return `${entity}|${entry.date}|${entry.type}|${entry.text}`;
}

/** Note files with `stale` and `codeChanged` set on the entries the staleness pass flagged. */
function withStaleFlags(notes: readonly NoteFile[], stale: readonly StaleEntry[]): NoteFile[] {
  const changed = new Map<string, string>();
  for (const s of stale) changed.set(staleKey(s.entity, s.entry), s.codeChanged);
  return notes.map((note) => ({
    ...note,
    entries: note.entries.map((entry) => {
      const when = changed.get(staleKey(note.entity, entry));
      return when === undefined ? entry : ({ ...entry, stale: true, codeChanged: when } as NoteEntry & { codeChanged: string });
    }),
  }));
}

/** A cited source (`src/a.ts:12`) without its line suffix. */
function citedEntity(source: string): string {
  return source.replace(/:\d+(?:-\d+)?$/, "").trim();
}

/** `entity → note entities whose sources cite it` (contract `/api/notes`). */
function citedByOf(notes: readonly NoteFile[]): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const note of notes) {
    for (const entry of note.entries) {
      for (const raw of entry.sources) {
        const target = citedEntity(raw);
        if (!target || target === note.entity) continue;
        const list = (out[target] ??= []);
        if (!list.includes(note.entity)) list.push(note.entity);
      }
    }
  }
  return out;
}

/** The graph node id a plan or evidence path refers to: a folder entry becomes its `dir:` node. */
function nodeIdForPath(index: Map<string, GraphNode>, raw: string): string | null {
  const clean = safeRepoPath(raw);
  if (clean === null) return null;
  const bare = clean.replace(/\/+$/, "");
  if (clean.endsWith("/")) return index.has(`dir:${bare}/`) ? `dir:${bare}/` : null;
  if (index.has(bare)) return bare;
  return index.has(`dir:${bare}/`) ? `dir:${bare}/` : null;
}

/** Node ids a journal entry points at: its evidence paths plus the plan files of its slug. */
function journalNodeIds(entry: JournalEntry, index: Map<string, GraphNode>, planFiles: Map<string, string[]>): string[] {
  const out: string[] = [];
  const push = (id: string | null): void => {
    if (id && !out.includes(id)) out.push(id);
  };
  for (const e of entry.evidence) push(nodeIdForPath(index, e));
  if (entry.slug) for (const f of planFiles.get(entry.slug) ?? []) push(nodeIdForPath(index, f));
  return out;
}

function underPath(nodeId: string, prefix: string): boolean {
  const p = prefix.replace(/\/+$/, "");
  const id = nodeId.startsWith("dir:") ? nodeId.slice(4).replace(/\/+$/, "") : nodeId;
  return id === p || id.startsWith(`${p}/`);
}

function editorUrlFor(scheme: string, root: string, rel: string): string {
  return `${scheme}${encodeURI(path.join(root, rel))}`;
}

// ---------------------------------------------------------------------------
// Query helpers
// ---------------------------------------------------------------------------

/**
 * A query value that cannot be honoured. Thrown from the query helpers and turned into a 400 by
 * `handleGet`, so a route reads its parameters in one line without a guard clause each.
 */
class BadQuery extends Error {}

/**
 * A bounded integer query parameter. Missing or empty falls back; anything else must be a plain
 * base-10 integer inside `[min, max]` or the request is refused.
 *
 * Every numeric parameter goes through here because an unbounded one is an allocation the caller
 * controls: `commitsPerDayFor` builds one object per day in the window, so `/api/history?days=
 * 100000000` asked the server for a ~1.3 GB array before it could answer. Refusing (rather than
 * silently clamping) keeps a typo visible instead of answering a question nobody asked; the
 * ranges below are all wider than anything the UI sends.
 */
function qInt(url: URL, name: string, fallback: number, min: number, max: number): number {
  const raw = url.searchParams.get(name);
  if (raw === null || raw === "") return fallback;
  if (!/^[+-]?\d{1,9}$/.test(raw.trim())) throw new BadQuery(`${name} must be an integer between ${min} and ${max}`);
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n < min || n > max) throw new BadQuery(`${name} must be an integer between ${min} and ${max}`);
  return n;
}

/** Widest `days` any route accepts: two years, well past the 365-day log the history index holds. */
const MAX_DAYS = 730;
/** `/api/journal` reads a file, not a per-day array, and "show me everything" is a real query there. */
const MAX_JOURNAL_DAYS = 36_500;
/** Import hops on `/api/impact`; the contract and both clients only ever ask for 1, 2 or 3. */
const MAX_IMPACT_DEPTH = 3;
/** Rows `/api/search` will return. */
const MAX_SEARCH_LIMIT = 100;
/** Widest `depth` `/api/flow` accepts before clamping; anything past `MAX_FLOW_HOPS` traces the same flow. */
const MAX_QUERY_DEPTH = 99;

function qBool(url: URL, name: string): boolean {
  const raw = url.searchParams.get(name);
  return raw === "1" || raw === "true";
}

const LENSES: readonly Lens[] = ["structure", "knowledge", "tests", "heat", "owners", "tasks"];

function qLens(url: URL): Lens {
  const raw = url.searchParams.get("lens");
  return LENSES.includes(raw as Lens) ? (raw as Lens) : "structure";
}

// ---------------------------------------------------------------------------
// POST guards (spec §8)
// ---------------------------------------------------------------------------

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);

export function isLoopbackAddress(address: string | undefined): boolean {
  if (!address) return false;
  const a = address.replace(/^::ffff:/, "");
  return a === "127.0.0.1" || a === "::1" || a.startsWith("127.");
}

/** A bare IPv4/IPv6 literal. A literal cannot be re-pointed by DNS, so it is safe to trust. */
function isIpLiteral(hostname: string): boolean {
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(hostname)) return true;
  return hostname.startsWith("[") && hostname.endsWith("]");
}

/** Loopback by name (`localhost`, `foo.localhost` — RFC 6761 reserves these to 127.0.0.1). */
function isLoopbackName(hostname: string): boolean {
  return LOOPBACK_HOSTS.has(hostname) || hostname === "localhost" || hostname.endsWith(".localhost");
}

/** A bind address that keeps the server on this machine. `0.0.0.0` and `::` are not. */
export function isLoopbackHost(host: string): boolean {
  const h = host.trim().replace(/^\[|\]$/g, "");
  return h === "" || isLoopbackName(h) || h === "127.0.0.1" || h.startsWith("127.") || h === "::1";
}

// ---------------------------------------------------------------------------
// The serve key: what a phone on the same Wi-Fi or tailnet has to present
// ---------------------------------------------------------------------------

/**
 * A networked serve (any non-loopback bind) requires a capability key on every `/api` request that
 * arrives over a non-loopback socket. Loopback traffic is unchanged. The key is what a rebound page
 * or a LAN neighbour cannot forge, which is why an Origin equal to the request's own Host is
 * acceptable once the key has been presented. It lives under the ignored cache, one per repo per
 * machine, so the phone's bookmark keeps working across restarts; delete the file to rotate it.
 */
export function serveKeyFile(root: string): string {
  return path.join(root, ".reggie", ".cache", "serve-key");
}

export function readOrMintServeKey(root: string): string {
  const file = serveKeyFile(root);
  const existing = (readText(file) ?? "").trim();
  if (existing) return existing;
  const key = randomBytes(18).toString("base64url");
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `${key}\n`, "utf8");
  return key;
}

/** The key a request carries: the header first, else the query string (an audio element or a podcast app cannot set headers). */
export function keyOf(req: IncomingMessage, url: URL): string | null {
  const raw = req.headers["x-reggie-key"];
  const header = Array.isArray(raw) ? raw[0] : raw;
  if (header && header.trim()) return header.trim();
  const q = url.searchParams.get("key");
  return q && q.trim() ? q.trim() : null;
}

function sameKey(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/**
 * Null when the request may proceed. `{ status, error }` when a non-loopback socket has no key to
 * check against (403: the server was not started for the network) or presented the wrong one (401).
 */
export function checkKey(req: IncomingMessage, url: URL, key: string | null): { status: number; error: string } | null {
  if (isLoopbackAddress(req.socket?.remoteAddress ?? undefined)) return null;
  if (!key) return { status: 403, error: "this server accepts connections from this machine only; start it with `reggie serve --host 0.0.0.0` to reach it from a phone" };
  const given = keyOf(req, url);
  if (given && sameKey(given, key)) return null;
  return { status: 401, error: "key required: open the address `reggie serve` printed, which carries ?key=, or paste the key from .reggie/.cache/serve-key" };
}

/** The addresses a phone can reach a networked serve on: every non-internal IPv4 when bound to all interfaces, else the bound one. */
export function lanAddresses(host: string): string[] {
  if (isLoopbackHost(host)) return [];
  const h = host.trim();
  if (h !== "0.0.0.0" && h !== "::" && h !== "[::]") return [h];
  const out: string[] = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const ni of list ?? []) {
      if (ni.internal) continue;
      if (String(ni.family) !== "IPv4") continue;
      out.push(ni.address);
    }
  }
  return out;
}

/**
 * DNS-rebinding guard (spec §8), applied to every method. A page on a domain the attacker owns
 * whose DNS is rebound to 127.0.0.1 reaches this server over a genuinely loopback socket and can
 * set `Origin` to match its own `Host`, so neither the socket check nor an `Origin`/`Host`
 * comparison sees anything wrong. What it cannot do is arrive with a `Host` that is not the name
 * it controls, so the name is what we check: a loopback name or a bare IP literal, never an
 * arbitrary DNS name. GET is guarded too — a rebound page reading `/api/file` exfiltrates source
 * just as surely as a rebound POST writes into `.reggie/`.
 */
export function checkHostHeader(req: IncomingMessage): string | null {
  const raw = req.headers.host;
  const host = Array.isArray(raw) ? raw[0] : raw;
  if (!host) return null; // No `Host` at all (HTTP/1.0): there is no name being rebound.
  let hostname: string;
  try {
    hostname = new URL(`http://${host}`).hostname;
  } catch {
    return "bad host header";
  }
  if (!hostname) return "bad host header";
  if (isLoopbackName(hostname) || isIpLiteral(hostname)) return null;
  return "host header does not name this server";
}

/**
 * `Sec-Fetch-Site` must be absent, `same-origin` or `none`. On a loopback socket a present `Origin`
 * must be this server's own loopback origin, deliberately *not* compared against the `Host` header:
 * `Host` is attacker-controlled, so `origin === "http://" + host` is trivially satisfiable and would
 * let a rebound page through (`checkHostHeader` is the other half of that defence). On a network
 * socket the request has already presented the serve key (`keyed`), which a rebound page cannot, so
 * the origin is not checked further.
 */
export function checkPostOrigin(req: IncomingMessage, port: number, opts: { keyed?: boolean } = {}): string | null {
  const site = req.headers["sec-fetch-site"];
  const siteValue = Array.isArray(site) ? site[0] : site;
  if (siteValue && siteValue !== "same-origin" && siteValue !== "none") return "cross-site request refused";
  const originHeader = req.headers.origin;
  const origin = Array.isArray(originHeader) ? originHeader[0] : originHeader;
  if (!origin || origin === "null") return null;
  let parsed: URL;
  try {
    parsed = new URL(origin);
  } catch {
    return "bad origin";
  }
  const sameHost = LOOPBACK_HOSTS.has(parsed.hostname);
  const samePort = parsed.port === String(port) || (parsed.port === "" && port === 80);
  if (parsed.protocol === "http:" && sameHost && samePort) return null;
  // Over the network the key is the defence, not the origin: a rebound or cross-site page cannot
  // present it, and Sec-Fetch-Site above already refuses a cross-site request outright. So a keyed
  // request may carry whatever Origin its address (or a proxy in front) gave it.
  if (opts.keyed) return null;
  return "origin does not match this server";
}

interface BodyOk {
  ok: true;
  value: Record<string, unknown>;
}
interface BodyErr {
  ok: false;
  status: number;
  error: string;
}

function readJsonBody(req: IncomingMessage): Promise<BodyOk | BodyErr> {
  return new Promise((resolve) => {
    const declared = Number.parseInt(String(req.headers["content-length"] ?? ""), 10);
    if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
      resolve({ ok: false, status: 413, error: "body too large" });
      req.resume();
      return;
    }
    const chunks: Buffer[] = [];
    let size = 0;
    let done = false;
    const finish = (result: BodyOk | BodyErr): void => {
      if (done) return;
      done = true;
      resolve(result);
    };
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        // Drain rather than destroy, so the 413 still reaches the client.
        finish({ ok: false, status: 413, error: "body too large" });
        chunks.length = 0;
        req.resume();
        return;
      }
      chunks.push(chunk);
    });
    req.on("error", () => finish({ ok: false, status: 400, error: "could not read the request body" }));
    req.on("end", () => {
      const text = Buffer.concat(chunks).toString("utf8").trim();
      if (!text) return finish({ ok: true, value: {} });
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        return finish({ ok: false, status: 400, error: "body is not valid JSON" });
      }
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        return finish({ ok: false, status: 400, error: "body must be a JSON object" });
      }
      finish({ ok: true, value: parsed as Record<string, unknown> });
    });
  });
}

function str(body: Record<string, unknown>, key: string): string | null {
  const value = body[key];
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

function strList(body: Record<string, unknown>, key: string): string[] {
  const value = body[key];
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

/**
 * The origin fields of a capture body as the resolver wants them: every one of `path`, `symbol`
 * and `task` that is a string, untrimmed and even when empty, so an empty path is refused by the
 * resolver rather than silently dropped; null when the body names no origin at all.
 */
function originFields(body: Record<string, unknown>): { path?: string; symbol?: string; task?: string } | null {
  const out: { path?: string; symbol?: string; task?: string } = {};
  for (const key of ["path", "symbol", "task"] as const) {
    const value = body[key];
    if (typeof value === "string") out[key] = value;
  }
  return Object.keys(out).length > 0 ? out : null;
}

// ---------------------------------------------------------------------------
// Server
// ---------------------------------------------------------------------------

export interface ServeOptions {
  port: number;
  host: string;
  /** Serve every repo of this workspace; absent or null means single-repo mode on `paths.root`. */
  workspace?: Workspace | null;
  /** The key a networked serve requires; read or minted from `.reggie/.cache/serve-key` when absent and the bind is not loopback. */
  key?: string | null;
}

export interface ServerHandle {
  url: string;
  port: number;
  /** Repo names served, in registry order. */
  repos: string[];
  /** The key non-loopback clients must present; null when the server is loopback only. */
  key: string | null;
  /** Addresses a phone can open, without the key; empty when loopback only. */
  addresses: string[];
  close: () => Promise<void>;
}

/**
 * The local guidebook server: the static UI from `packages/reggie/ui` plus the JSON API of
 * `docs/ui-api-contract.md` over the state layer. Read-only except for the six POST routes,
 * which write through `capture`, `addNote`, `decidePacket`, `appendJournal` and `scaffoldBrief`
 * — and `POST /api/launch`, the one route that starts a process rather than writing a file.
 */
export function startServer(paths: RepoPaths, config: ReggieConfig, opts: ServeOptions): Promise<ServerHandle> {
  const registry = opts.workspace ? RepoRegistry.fromWorkspace(opts.workspace) : RepoRegistry.single(paths.root);
  // The caller already loaded the config for `paths.root`; every other repo loads its own.
  const primary = { root: path.resolve(paths.root), config };
  let boundPort = opts.port;
  // The key exists exactly when the bind is not loopback: a key on a loopback-only server would
  // never be checked, and a handle saying "key" would lie about being reachable.
  const key = isLoopbackHost(opts.host) ? null : (opts.key ?? readOrMintServeKey(paths.root));

  const handler = (req: IncomingMessage, res: ServerResponse): void => {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? opts.host}`);
    const method = req.method ?? "GET";
    try {
      const hostProblem = checkHostHeader(req);
      if (hostProblem) return json(res, 403, { error: hostProblem });
      // The static shell is free to load so the page can ask for the key; everything under /api
      // needs it over the network.
      if (handleStatic(url, method, res)) return;
      if (url.pathname.startsWith("/api/")) {
        const keyProblem = checkKey(req, url, key);
        if (keyProblem) return json(res, keyProblem.status, { error: keyProblem.error });
        const keyed = !isLoopbackAddress(req.socket.remoteAddress ?? undefined);
        if (method === "POST") {
          void handlePost(req, res, url, registry, boundPort, keyed).catch((err: unknown) => sendError(res, err));
          return;
        }
        if (method !== "GET" && method !== "HEAD") return json(res, 405, { error: "method not allowed" });
        return handleGet(req, res, url, registry, primary, boundPort);
      }
      return json(res, 404, { error: "not found" });
    } catch (err) {
      return sendError(res, err);
    }
  };

  return new Promise((resolve, reject) => {
    const server: Server = createServer(handler);
    server.on("error", reject);
    server.listen(opts.port, opts.host, () => {
      const address = server.address();
      boundPort = typeof address === "object" && address ? address.port : opts.port;
      resolve({
        key,
        addresses: lanAddresses(opts.host),
        url: `http://${opts.host}:${boundPort}/`,
        port: boundPort,
        repos: registry.names(),
        close: () =>
          new Promise<void>((done) => {
            server.closeAllConnections?.();
            server.close(() => done());
          }),
      });
    });
  });
}

function sendError(res: ServerResponse, err: unknown): void {
  if (res.headersSent) {
    res.end();
    return;
  }
  json(res, 500, { error: err instanceof Error ? err.message : String(err) });
}

/** `/`, `/ui/*` and `/vendor/*`; returns true when the request was handled. */
function handleStatic(url: URL, method: string, res: ServerResponse): boolean {
  if (url.pathname === "/" || url.pathname === "/index.html") {
    if (method !== "GET" && method !== "HEAD") {
      json(res, 405, { error: "method not allowed" });
      return true;
    }
    const index = path.join(UI_DIR, "index.html");
    if (!existsSync(index)) json(res, 404, { error: "ui/index.html is missing" });
    else sendFile(res, index, "no-store");
    return true;
  }
  if (url.pathname.startsWith("/ui/")) {
    if (method !== "GET" && method !== "HEAD") {
      json(res, 405, { error: "method not allowed" });
      return true;
    }
    const rel = url.pathname.slice("/ui/".length);
    if (rel.startsWith("/") || rel.split("/").some((seg) => seg === "..")) json(res, 400, { error: "bad path" });
    else {
      const file = safeStaticPath(UI_DIR, rel);
      if (!file) json(res, 404, { error: "not found" });
      else sendFile(res, file, "no-store");
    }
    return true;
  }
  if (url.pathname.startsWith("/vendor/")) {
    if (method !== "GET" && method !== "HEAD") {
      json(res, 405, { error: "method not allowed" });
      return true;
    }
    const name = url.pathname.slice("/vendor/".length);
    const rel = VENDOR_FILES[name];
    if (!rel) json(res, 404, { error: "not found" });
    else {
      const file = path.join(PACKAGE_DIR, "node_modules", rel);
      if (!existsSync(file)) json(res, 404, { error: `${name} is not installed; the page falls back to the CDN` });
      else sendFile(res, file, "public, max-age=31536000, immutable");
    }
    return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// GET routes
// ---------------------------------------------------------------------------

function handleGet(req: IncomingMessage, res: ServerResponse, url: URL, registry: RepoRegistry, primary: { root: string; config: ReggieConfig }, port: number): void {
  // A rejected query parameter is bad input, not a server fault: 400, not the outer handler's 500.
  try {
    return route(req, res, url, registry, primary, port);
  } catch (err) {
    if (err instanceof BadQuery) return json(res, 400, { error: err.message });
    throw err;
  }
}

function route(req: IncomingMessage, res: ServerResponse, url: URL, registry: RepoRegistry, primary: { root: string; config: ReggieConfig }, port: number): void {
  const requested = url.searchParams.get("repo");
  const c = registry.resolve(requested);
  if (!c) return json(res, 404, { error: `unknown repo: ${requested ?? ""}` });

  const p = url.pathname;
  if (p.startsWith("/api/task/")) return taskRoute(res, c, decodeURIComponent(p.slice("/api/task/".length)));

  switch (p) {
    case "/api/facts":
      return factsRoute(res, c, registry, primary);
    case "/api/status":
      return statusRoute(res, c);
    case "/api/graph":
      return graphRoute(res, c, url);
    case "/api/impact":
      return impactRoute(res, c, url);
    case "/api/story":
      return storyRoute(res, c, registry, url);
    case "/api/narration":
      return narrationRoute(res, c, registry, url);
    case "/api/episode":
      return episodeRoute(req, res, c, url);
    case "/api/feed.xml":
      return feedRoute(req, res, c, url, port);
    case "/api/explain":
      return explainRoute(res, c, url);
    case "/api/file":
      return fileRoute(res, c, url);
    case "/api/changes":
      return changesRoute(res, c, url);
    case "/api/filediff":
      return fileDiffRoute(res, c, url);
    case "/api/symbols":
      return symbolsRoute(res, c, url);
    case "/api/tasks":
      return json(res, 200, tasksList(c, qBool(url, "all")));
    case "/api/state-machine":
      return stateMachineRoute(res, c);
    case "/api/launch":
      return launchRoute(res, c, url);
    case "/api/evidence":
      return evidenceRoute(res, c, url);
    case "/api/history":
      return historyRoute(res, c, url);
    case "/api/notes":
      return notesRoute(res, c);
    case "/api/note":
      return noteRoute(res, c, url);
    case "/api/journal":
      return journalRoute(res, c, url);
    case "/api/people":
      return peopleRoute(res, c);
    case "/api/search":
      return searchRoute(res, c, url);
    case "/api/services":
      return servicesRoute(res, c);
    case "/api/service":
      return serviceRoute(res, c, url);
    case "/api/flows":
      return flowsRoute(res, c);
    case "/api/flow":
      return flowRoute(res, c, url);
    case "/api/workspace":
      return json(res, 200, workspaceSummary(registry));
    case "/api/context":
      return contextRoute(res, c, url);
    default:
      return json(res, 404, { error: "not found" });
  }
}

function factsRoute(res: ServerResponse, c: RepoCtx, registry: RepoRegistry, primary: { root: string; config: ReggieConfig }): void {
  return json(res, 200, {
    facts: factsOf(c),
    config: c.root === primary.root ? primary.config : c.config,
    people: peopleOf(c),
    branch: currentBranch(c.root),
    headSha: c.headSha(),
    root: c.root,
    workspace: registry.info(),
    editorScheme: extrasOf(c).editorScheme,
  });
}

interface WarmupSteps {
  files: boolean;
  imports: boolean;
  notes: boolean;
  history: boolean;
  tasks: boolean;
}

interface Warmup {
  steps: WarmupSteps;
  /** Every stage has been attempted (a stage that threw leaves its tick off). */
  done: boolean;
}

/**
 * First-load work, one stage per tick on the "Reading the repo" card. Each stage populates the
 * caches the data routes read, so nothing is built twice; `cacheKeys` lets a warm server report a
 * tick that is already true instead of claiming it has not started.
 */
const WARMUP_STAGES: { step: keyof WarmupSteps; cacheKeys: string[]; build: (c: RepoCtx) => void }[] = [
  { step: "files", cacheKeys: ["facts"], build: (c) => void factsOf(c) },
  {
    step: "notes",
    cacheKeys: ["notes", "notesIndex"],
    build: (c) => {
      notesOf(c);
      notesIndexOf(c);
    },
  },
  { step: "history", cacheKeys: ["history"], build: (c) => void historyOf(c) },
  { step: "tasks", cacheKeys: ["tasks"], build: (c) => void tasksOf(c) },
  { step: "imports", cacheKeys: ["graph"], build: (c) => void graphOf(c) },
];

const warmups = new WeakMap<RepoCtx, Warmup>();

/**
 * The per-repo warm-up record, started on the first `/api/status` hit. The stages run one per
 * event-loop turn so `/api/status` answers immediately with partial ticks: without this the first
 * response only arrives once everything is built, and the card can never be shown (spec §3.1).
 */
function warmupOf(c: RepoCtx): Warmup {
  const existing = warmups.get(c);
  if (existing) return existing;
  const warmup: Warmup = { steps: { files: false, imports: false, notes: false, history: false, tasks: false }, done: false };
  for (const stage of WARMUP_STAGES) {
    if (stage.cacheKeys.every((k) => c.isCached(k))) warmup.steps[stage.step] = true;
  }
  warmups.set(c, warmup);

  const pending = WARMUP_STAGES.filter((stage) => !warmup.steps[stage.step]);
  if (pending.length === 0) {
    warmup.done = true;
    return warmup;
  }
  const run = (i: number): void => {
    const stage = pending[i];
    if (!stage) {
      warmup.done = true;
      return;
    }
    try {
      stage.build(c);
      warmup.steps[stage.step] = true;
    } catch {
      // The data route for this source reports the failure; the tick stays off.
    }
    later(() => run(i + 1));
  };
  later(() => run(0));
  return warmup;
}

/** Next event-loop turn, without holding the process open. */
function later(fn: () => void): void {
  const timer = setTimeout(fn, 0);
  timer.unref?.();
}

function statusRoute(res: ServerResponse, c: RepoCtx): void {
  const warmup = warmupOf(c);
  return json(res, 200, { ready: warmup.done, steps: { ...warmup.steps }, headSha: c.headSha() });
}

function graphRoute(res: ServerResponse, c: RepoCtx, url: URL): void {
  const level = url.searchParams.get("level");
  if (!level) return json(res, 200, flatGraph(graphOf(c)));
  if (level === "container") return json(res, 200, containerOf(c));
  if (level === "dir") {
    const root = url.searchParams.get("root");
    if (!root) return json(res, 400, { error: "root is required for level=dir" });
    const clean = safeRepoPath(root) ?? (root === "." || root === "./" ? "." : null);
    if (clean === null) return json(res, 400, { error: "bad root" });
    const view = dirView(graphOf(c), clean, { ...viewOpts(c), tests: qBool(url, "tests"), all: qBool(url, "all") });
    if (!view) return json(res, 404, { error: `unknown directory: ${root}` });
    return json(res, 200, withOwnDocumented(c, view));
  }
  return json(res, 400, { error: `unknown level: ${level}` });
}

function impactOptionsOf(c: RepoCtx, url: URL): { depth: number; direction: "both" | "up" | "down"; tests: boolean; areas?: readonly string[] } {
  const raw = url.searchParams.get("direction");
  const direction = raw === "up" || raw === "down" ? raw : "both";
  return { ...areaOpts(c), depth: qInt(url, "depth", 1, 1, MAX_IMPACT_DEPTH), direction, tests: qBool(url, "tests") };
}

function impactRoute(res: ServerResponse, c: RepoCtx, url: URL): void {
  const g = graphOf(c);
  const slugs = url.searchParams.getAll("slug").filter((s) => s !== "");
  const opts = impactOptionsOf(c, url);

  if (slugs.length > 0) {
    for (const slug of slugs) if (!isSafeSlug(slug)) return json(res, 400, { error: `bad slug: ${slug}` });
    const index = nodeIndexOf(c);
    // Centre file per slug, split into planned and actual so the blast radius can ring them.
    const planned = new Map<string, Set<string>>();
    const actual = new Map<string, Set<string>>();
    const owners = new Map<string, string[]>();
    for (const slug of slugs) {
      const detail = getTaskDetail(c.paths, c.config, slug);
      if (!detail) return json(res, 404, { error: `unknown task: ${slug}` });
      for (const [key, list] of [
        ["planned", detail.impact.planned],
        ["actual", detail.impact.actual],
      ] as const) {
        for (const raw of list) {
          const id = nodeIdForPath(index, raw);
          if (!id || index.get(id)?.kind !== "file") continue;
          const bucket = key === "planned" ? planned : actual;
          const set = bucket.get(id) ?? new Set<string>();
          set.add(slug);
          bucket.set(id, set);
          const own = owners.get(id) ?? [];
          if (!own.includes(slug)) own.push(slug);
          owners.set(id, own);
        }
      }
    }
    const centres = Array.from(owners.keys());
    const view = impactView(g, centres, opts);
    const nodes = view.nodes.map((n) => {
      const own = owners.get(n.id);
      const reached = new Set<string>(own ?? []);
      for (const centre of n.collision ?? []) for (const s of owners.get(centre) ?? []) reached.add(s);
      const collision = Array.from(reached).sort();
      const base: Record<string, unknown> = { ...n };
      if (own) {
        // `task` names one slug, so `planned`/`actual` must describe that slug alone. Reading them
        // off the merged maps let a file planned by task A and touched by task B come back as
        // {task: 'A', planned: true, actual: true}, which is how the task page ended up painting a
        // file "Changed on branch" while its own files-to-touch list said "not changed yet".
        const owner = own[0] ?? slugs[0] ?? "";
        base.task = owner;
        base.planned = planned.get(n.id)?.has(owner) ?? false;
        base.actual = actual.get(n.id)?.has(owner) ?? false;
      }
      if (collision.length > 1) base.collision = collision;
      else delete base.collision;
      return base;
    });
    return json(res, 200, { ...view, nodes, centers: centres });
  }

  const rawId = url.searchParams.get("id");
  if (!rawId) return json(res, 400, { error: "id or slug is required" });
  // `file::symbol` ids are a stretch route; Core answers with the file's impact (contract §impact).
  const fileId = rawId.includes("::") ? (rawId.split("::")[0] ?? rawId) : rawId;
  const clean = safeRepoPath(fileId);
  if (clean === null) return json(res, 400, { error: "bad id" });
  if (nodeIndexOf(c).get(clean)?.kind !== "file") return json(res, 404, { error: `unknown file: ${fileId}` });
  return json(res, 200, impactView(g, [clean], opts));
}

/** The story a scope and id name, or the status and error the route should answer with. */
function buildStory(c: RepoCtx, registry: RepoRegistry, url: URL): { ok: true; story: Story } | { ok: false; status: number; error: string } {
  const scope = url.searchParams.get("scope") ?? "repo";
  if (scope === "workspace") return { ok: true, story: workspaceStory(workspaceSummary(registry)) };
  const lens = qLens(url);
  const days = qInt(url, "days", 14, 1, MAX_DAYS);
  const ctx = storyContextOf(c, c.name, lens, days);
  const id = url.searchParams.get("id") ?? "";
  if (scope === "repo") return { ok: true, story: repoStory(ctx, { services: servicesOf(c), flows: flowsOf(c).flows }) };
  if (scope === "services") return { ok: true, story: servicesStory(ctx, servicesOf(c)) };
  if (scope === "flow") {
    if (!id) return { ok: false, status: 400, error: "id is required for scope=flow" };
    if (badId(id)) return { ok: false, status: 400, error: "bad id" };
    const depth = Math.min(qInt(url, "depth", MAX_FLOW_HOPS, 1, MAX_QUERY_DEPTH), MAX_FLOW_HOPS);
    const flow = flowOf(c, id, depth);
    return flow ? { ok: true, story: flowStory(ctx, flow, { services: servicesOf(c).services }) } : { ok: false, status: 404, error: `unknown flow: ${id}` };
  }
  if (scope === "area") {
    if (!id) return { ok: false, status: 400, error: "id is required for scope=area" };
    if (safeRepoPath(id) === null && id !== ".") return { ok: false, status: 400, error: "bad id" };
    const story = areaStory(ctx, id);
    return story ? { ok: true, story } : { ok: false, status: 404, error: `unknown area: ${id}` };
  }
  if (scope === "file") {
    const clean = safeRepoPath(id);
    if (clean === null) return { ok: false, status: 400, error: "bad id" };
    const story = fileStory(ctx, clean);
    return story ? { ok: true, story } : { ok: false, status: 404, error: `unknown file: ${id}` };
  }
  if (scope === "task") {
    if (!isSafeSlug(id)) return { ok: false, status: 400, error: "bad slug" };
    const story = taskStory(ctx, id);
    return story ? { ok: true, story } : { ok: false, status: 404, error: `unknown task: ${id}` };
  }
  return { ok: false, status: 400, error: `unknown scope: ${scope}` };
}

function storyRoute(res: ServerResponse, c: RepoCtx, registry: RepoRegistry, url: URL): void {
  const r = buildStory(c, registry, url);
  return r.ok ? json(res, 200, r.story) : json(res, r.status, { error: r.error });
}

/** The same story, spoken: what the Listen button reads and what an episode is made from. */
function narrationRoute(res: ServerResponse, c: RepoCtx, registry: RepoRegistry, url: URL): void {
  const r = buildStory(c, registry, url);
  if (!r.ok) return json(res, r.status, { error: r.error });
  const scope = url.searchParams.get("scope") ?? "repo";
  const id = url.searchParams.get("id") ?? "";
  const episode = readEpisode(c.root, scope, id);
  return json(res, 200, { ...narrate(r.story, { repo: c.name }), scope, id, episode: episode ? episodeSummary(episode, scope, id) : null });
}

function episodeSummary(e: { bytes: number; seconds: number; madeAt: string; voice: string }, scope: string, id: string): { route: string; bytes: number; seconds: number; madeAt: string; voice: string } {
  return { route: `/api/episode?scope=${encodeURIComponent(scope)}&id=${encodeURIComponent(id)}`, bytes: e.bytes, seconds: e.seconds, madeAt: e.madeAt, voice: e.voice };
}

/** The audio for an episode already made, with byte ranges so `<audio>` can seek and podcast apps can resume. */
function episodeRoute(req: IncomingMessage, res: ServerResponse, c: RepoCtx, url: URL): void {
  const scope = url.searchParams.get("scope") ?? "";
  const id = url.searchParams.get("id") ?? "";
  if (!scope) return json(res, 400, { error: "scope is required" });
  const episode = readEpisode(c.root, scope, id);
  if (!episode) return json(res, 404, { error: "no episode has been made for this yet; POST /api/episode to make one" });
  const size = statSync(episode.file).size;
  const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? "");
  const headers: Record<string, string | number> = {
    "content-type": "audio/mp4",
    "accept-ranges": "bytes",
    "cache-control": "no-store",
    "content-disposition": `inline; filename="${episode.key}.m4a"`,
  };
  if (range) {
    const start = range[1] ? Number.parseInt(range[1], 10) : 0;
    const end = range[2] ? Math.min(Number.parseInt(range[2], 10), size - 1) : size - 1;
    if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || start >= size) {
      res.writeHead(416, { "content-range": `bytes */${size}` });
      res.end();
      return;
    }
    res.writeHead(206, { ...headers, "content-range": `bytes ${start}-${end}/${size}`, "content-length": end - start + 1 });
    return void createReadStream(episode.file, { start, end }).pipe(res);
  }
  res.writeHead(200, { ...headers, "content-length": size });
  createReadStream(episode.file).pipe(res);
}

/** The feed names its episodes at the address it was asked on, so a podcast app on a phone can play what it lists. */
function feedRoute(req: IncomingMessage, res: ServerResponse, c: RepoCtx, url: URL, port: number): void {
  const rawHost = req.headers.host;
  const hostHeader = (Array.isArray(rawHost) ? rawHost[0] : rawHost) ?? "";
  const base = `http://${hostHeader || `127.0.0.1:${port}`}`;
  const repo = url.searchParams.get("repo");
  const key = keyOf(req, url);
  const suffix = `${repo ? `&repo=${encodeURIComponent(repo)}` : ""}${key ? `&key=${encodeURIComponent(key)}` : ""}`;
  const body = renderFeed(c.root, c.name, base, suffix);
  res.writeHead(200, { "content-type": "application/rss+xml; charset=utf-8", "cache-control": "no-store", "content-length": Buffer.byteLength(body) });
  res.end(body);
}

function explainRoute(res: ServerResponse, c: RepoCtx, url: URL): void {
  const id = url.searchParams.get("id");
  if (!id) return json(res, 400, { error: "id is required" });
  const ctx = storyContextOf(c, c.name, qLens(url), qInt(url, "days", 14, 1, MAX_DAYS));
  const value = explain(ctx, id);
  return value ? json(res, 200, value) : json(res, 404, { error: `unknown id: ${id}` });
}

function fileRoute(res: ServerResponse, c: RepoCtx, url: URL): void {
  const raw = url.searchParams.get("path") ?? "";
  const rel = safeRepoPath(raw);
  if (rel === null) return json(res, 400, { error: "bad path" });
  const full = path.join(c.root, rel);
  if (!full.startsWith(path.resolve(c.root) + path.sep)) return json(res, 400, { error: "bad path" });
  const content = readText(full);
  if (content === null) return json(res, 404, { error: `no such file: ${rel}` });

  const g = graphOf(c);
  const node = nodeIndexOf(c).get(rel);
  const edges = edgeIndexOf(c);
  const index = nodeIndexOf(c);
  const areaOf = (id: string): string | null => index.get(id)?.area ?? null;

  const importers = (edges.byTarget.get(rel) ?? [])
    .filter((e) => e.source !== rel && index.get(e.source)?.kind === "file")
    .map((e) => ({ id: e.source, area: areaOf(e.source) ?? "", names: e.names ?? [], role: index.get(e.source)?.role ?? "source" }))
    .sort((a, b) => a.id.localeCompare(b.id));

  const resolved = (edges.bySource.get(rel) ?? []).filter((e) => e.target !== rel && index.get(e.target)?.kind === "file");
  const imports: { id: string; area: string | null; names: string[]; external?: string }[] = resolved
    .map((e) => ({ id: e.target, area: areaOf(e.target), names: e.names ?? [] }))
    .sort((a, b) => a.id.localeCompare(b.id));
  if (symbolLang(rel) === "js") {
    for (const ref of jsImports(content)) {
      if (ref.spec.startsWith(".") || ref.spec.startsWith("/")) continue;
      if (imports.some((i) => i.external === ref.spec)) continue;
      imports.push({ id: ref.spec, area: null, names: ref.names, external: ref.spec });
    }
  }

  const stale = staleOf(c);
  const notes = withStaleFlags(notesForPath(c.paths, rel), stale);
  const tasksBySlug = new Map(tasksOf(c).map((t) => [t.slug, t] as const));
  const tasks = (node?.tasks ?? []).map((slug) => ({ slug, state: tasksBySlug.get(slug)?.state ?? ("ungroomed" as TaskState) }));
  const hist = historyOf(c);
  const own = historyFor(hist, rel);
  const lines = content.split("\n").length;

  return json(res, 200, {
    path: rel,
    text: content.slice(0, MAX_FILE_CHARS),
    truncated: content.length > MAX_FILE_CHARS,
    totalChars: content.length,
    totalLines: lines,
    lang: path.extname(rel).replace(/^\./, ""),
    role: node?.role ?? roleOf(rel, content.split("\n", 1)[0] ?? ""),
    area: node?.area ?? null,
    symbols: fileSymbols(g, rel, content),
    notes,
    importers,
    imports,
    testedBy: node?.testedBy ?? [],
    tasks,
    history: own ? { ...own, recent: recentFor(hist, rel) } : null,
    editorUrl: editorUrlFor(extrasOf(c).editorScheme, c.root, rel),
  });
}

// ---------------------------------------------------------------------------
// What a task changed: the list, and one file's rows
// ---------------------------------------------------------------------------

/** Widest `offset` `/api/filediff` accepts; a patch with more rows than this does not fit the buffer it is read into. */
const MAX_DIFF_OFFSET = 99_999_999;

interface ResolvedChanges {
  range: RangeResult;
  /** Null when git could not list the range; empty when the range is not available. */
  entries: ChangeEntry[] | null;
}

/**
 * The integration branch's name, or why it cannot be used. The name comes from `.reggie/config.yaml`,
 * a tracked file a clone carries, so it is as hostile as the repo is, and a name that begins with a
 * dash is an option to every git command it is handed to bare. No branch can have such a name, so
 * these routes stop here for one: before the task list, which hands the name to git, is ever built.
 */
function changeBase(c: RepoCtx): { ok: true; name: string } | { ok: false; reason: string } {
  let name: string;
  try {
    name = defaultBranch(c.root, c.config.defaultBranch);
  } catch {
    return { ok: false, reason: "This repo has no integration branch Reggie can name, so there is nothing to measure a change against. Set defaultBranch in .reggie/config.yaml." };
  }
  if (name.startsWith("-")) {
    return { ok: false, reason: "This repo's config names an integration branch that begins with a dash, which git would read as an option, so Reggie will not read a change against it. Correct defaultBranch in .reggie/config.yaml." };
  }
  return { ok: true, name };
}

/**
 * A task's range and its change list. The range is resolved on every request, because a branch tip
 * moves without this checkout's HEAD moving; the list between two commit ids can never change, so
 * it is kept per slug for as long as the ids stay the same. The history index is never built here:
 * the range needs the landing merge's two parents and nothing the index holds.
 */
function changesOf(c: RepoCtx, task: TaskInfo, baseName: string): ResolvedChanges {
  const range = taskRange(c.root, task, baseName);
  if (!range.ok) return { range, entries: [] };
  const slot = c.cached<{ key: string; entries: ChangeEntry[] | null }>(`changes:${task.slug}`, () => ({ key: "", entries: null }), { sha: false });
  const key = `${range.range.base}..${range.range.ref}`;
  if (slot.key !== key || slot.entries === null) {
    slot.entries = listChanges(c.root, range.range);
    slot.key = key;
  }
  return { range, entries: slot.entries };
}

/** Rows already built for this repo's files, so a later page of the same file is a slice and not a second parse. */
function diffRowsOf(c: RepoCtx): DiffRowCache {
  return c.cached("diffRows", () => new DiffRowCache(), { sha: false });
}

/** The task a change route names: 400 for a slug that is not one, 404 for one nothing in the repo names. */
function changeTask(res: ServerResponse, c: RepoCtx, url: URL): TaskInfo | null {
  const slug = url.searchParams.get("slug") ?? "";
  if (!isSafeSlug(slug)) {
    json(res, 400, { error: "bad slug" });
    return null;
  }
  const task = tasksOf(c).find((t) => t.slug === slug) ?? null;
  if (!task) json(res, 404, { error: `unknown task: ${slug}` });
  return task;
}

function changesRoute(res: ServerResponse, c: RepoCtx, url: URL): void {
  const slug = url.searchParams.get("slug") ?? "";
  if (!isSafeSlug(slug)) return json(res, 400, { error: "bad slug" });
  const base = changeBase(c);
  if (!base.ok) return json(res, 200, changesPayload(slug, { ok: false, reason: base.reason }, []));
  const task = changeTask(res, c, url);
  if (!task) return;
  const { range, entries } = changesOf(c, task, base.name);
  const payload: TaskChanges = changesPayload(task.slug, range, entries);
  return json(res, 200, payload);
}

/**
 * Where "Open in editor" should go for a row that is on screen: the task worktree's copy while the
 * branch is live, this checkout's copy when it has the branch checked out or the task has landed,
 * and nowhere otherwise, since the unchanged file at the branch's line numbers would mislead.
 */
function diffEditorUrl(c: RepoCtx, slug: string, kind: "branch" | "merge", rel: string): string | null {
  const scheme = extrasOf(c).editorScheme;
  const isFile = (full: string): boolean => existsSync(full) && statSync(full).isFile();
  if (kind === "merge") return isFile(path.join(c.root, rel)) ? editorUrlFor(scheme, c.root, rel) : null;
  const worktree = path.join(c.root, ".worktree", slug);
  if (isFile(path.join(worktree, rel))) return editorUrlFor(scheme, worktree, rel);
  if (currentBranch(c.root) === `task/${slug}` && isFile(path.join(c.root, rel))) return editorUrlFor(scheme, c.root, rel);
  return null;
}

/**
 * One file of a task's change, as rows. The path is checked twice: a path that could not be a repo
 * path is bad input (400), and a well-formed path that is not a member of the task's own change list
 * never reaches git at all (404). What reaches git is the list entry's own path, after `--`.
 */
function fileDiffRoute(res: ServerResponse, c: RepoCtx, url: URL): void {
  const rel = safeRepoPath(url.searchParams.get("path") ?? "");
  if (rel === null) return json(res, 400, { error: "bad path" });
  const offset = qInt(url, "offset", 0, 0, MAX_DIFF_OFFSET);
  if (!isSafeSlug(url.searchParams.get("slug") ?? "")) return json(res, 400, { error: "bad slug" });
  const base = changeBase(c);
  if (!base.ok) return json(res, 404, { error: base.reason });
  const task = changeTask(res, c, url);
  if (!task) return;
  const { range, entries } = changesOf(c, task, base.name);
  if (!range.ok || entries === null) return json(res, 404, { error: changesPayload(task.slug, range, entries).reason ?? "no change to read" });
  // Membership is by the name exactly as it was asked for, then as `safeRepoPath` tidied it: the
  // first finds a committed name that begins or ends with a space, the second forgives a `./`.
  const asked = url.searchParams.get("path") ?? "";
  const entry = entries.find((e) => e.path === asked) ?? entries.find((e) => e.path === rel) ?? null;
  if (!entry) return json(res, 404, { error: `that path is not part of what ${task.slug} changed` });
  const diff = fileDiff(c.root, task.slug, range.range, entry, offset, diffRowsOf(c));
  // `mapped` is exactly the condition under which the story, impact and explain routes answer this
  // path with a 404, so a file page in diff mode can skip asking them instead of logging three failures.
  const mapped = nodeIndexOf(c).get(entry.path)?.kind === "file";
  return json(res, 200, { ...diff, mapped, editorUrl: diffEditorUrl(c, task.slug, range.range.kind, entry.path) });
}

function symbolsRoute(res: ServerResponse, c: RepoCtx, url: URL): void {
  const rel = safeRepoPath(url.searchParams.get("path") ?? "");
  if (rel === null) return json(res, 400, { error: "bad path" });
  const content = readText(path.join(c.root, rel));
  if (content === null) return json(res, 404, { error: `no such file: ${rel}` });
  return json(res, 200, { path: rel, symbols: fileSymbols(graphOf(c), rel, content), engine: SYMBOL_ENGINE });
}

/**
 * Every task, `brief` and `phase` included: `TaskInfo` is serialised whole, so the two fields
 * the tasks page columns by travel with every card and never need a second request.
 */
function tasksList(c: RepoCtx, includeDone: boolean): TaskInfo[] {
  const all = tasksOf(c);
  return includeDone ? all : all.filter((t) => t.state !== "done");
}

// ---------------------------------------------------------------------------
// Completion: what a finished task actually did (spec §6)
// ---------------------------------------------------------------------------

interface CompletionEvidence {
  /** The path exactly as the packet wrote it. */
  path: string;
  /** `/api/evidence?slug=…&file=…`, or null when the reference is not a file under evidence/. */
  route: string | null;
  /** Whether that file is really there, on disk or on the task branch. */
  exists: boolean;
}

interface CompletionCriterion {
  text: string;
  pass: boolean | null;
  evidence: CompletionEvidence[];
}

interface CompletionDiff {
  files: { path: string; added: number; deleted: number }[];
  filesChanged: number;
  added: number;
  deleted: number;
  commits: number;
}

interface Completion {
  verdict: string | null;
  decidedBy: string | null;
  decidedAt: string | null;
  criteria: CompletionCriterion[];
  diff: CompletionDiff;
  /** The merge that landed the task, when one did. */
  merge: CommitInfo | null;
  /** The branch commits the merge brought in; without a merge, the commits attributed to the task. */
  commits: CommitInfo[];
  journal: JournalEntry[];
}

/**
 * The commits behind a finished task: from the merge that landed it, which needs no branch; else the
 * commits the index attributes to the slug; else, while `task/<slug>` still exists unmerged, the branch
 * itself, read with the same arguments and parser (the index is read from HEAD and cannot see it).
 */
function completionLanding(c: RepoCtx, task: TaskInfo): TaskLanding {
  let base = "HEAD";
  try {
    base = defaultBranch(c.root, c.config.defaultBranch);
  } catch {
    // No integration branch to name; HEAD is what the index was read from anyway.
  }
  const landing = taskLanding(c.root, task.slug, { base, index: historyOf(c) });
  if (landing.merge || landing.commits.length > 0 || !task.branch) return landing;
  const r = git(historyLogArgs([`${base}..${task.branch}`]), { cwd: c.root, allowFailure: true });
  return { merge: null, commits: r.ok ? parseNumstatLog(r.stdout) : [] };
}

/** Email → handle from people.yaml, falling back to the same derivation history.ts uses. */
function handleResolver(c: RepoCtx): (name: string, email: string) => string {
  const byEmail = new Map<string, string>();
  for (const p of peopleOf(c).people) if (p.email) byEmail.set(p.email.toLowerCase(), p.handle);
  return (name, email) => byEmail.get(email.toLowerCase()) ?? handleFor(name, email);
}

/**
 * Lines added and removed per file. With a merge, its first-parent files are exactly what landed and
 * are used alone; adding the branch commits beside them would count every line twice. Without one, the
 * commits are summed. Reggie's own records are left out.
 */
function completionDiff(landing: TaskLanding): CompletionDiff {
  const byFile = new Map<string, { path: string; added: number; deleted: number }>();
  let added = 0;
  let deleted = 0;
  const commits = landing.merge ? [landing.merge] : landing.commits;
  for (const commit of commits) {
    for (const f of commit.files) {
      if (f.path.startsWith(".reggie/")) continue;
      const row = byFile.get(f.path) ?? { path: f.path, added: 0, deleted: 0 };
      row.added += f.added;
      row.deleted += f.deleted;
      byFile.set(f.path, row);
      added += f.added;
      deleted += f.deleted;
    }
  }
  const files = Array.from(byFile.values()).sort((a, b) => b.added + b.deleted - (a.added + a.deleted) || a.path.localeCompare(b.path));
  return { files, filesChanged: files.length, added, deleted, commits: landing.commits.length };
}

const REGGIE_TASKS_PREFIX = ".reggie/tasks/";

/**
 * A packet's evidence reference as something the page can open. The evidence route serves one
 * file out of `.reggie/tasks/<slug>/evidence/`, so only a reference that lands there gets a
 * route; anything else is reported as written, with `exists: false`, rather than silently dropped.
 */
function evidenceLink(slug: string, ref: string, present: readonly string[]): CompletionEvidence {
  const clean = ref.replace(/^\.\/+/, "");
  const prefix = `${REGGIE_TASKS_PREFIX}${slug}/evidence/`;
  const name = clean.startsWith(prefix) ? clean.slice(prefix.length) : clean.startsWith("evidence/") ? clean.slice("evidence/".length) : clean;
  const isFile = name !== "" && !name.includes("/") && !name.includes("..");
  const full = `${prefix}${name}`;
  return {
    path: ref,
    route: isFile ? `/api/evidence?slug=${encodeURIComponent(slug)}&file=${encodeURIComponent(name)}` : null,
    exists: isFile && present.some((p) => p === full || p.endsWith(`/evidence/${name}`)),
  };
}

function completionCriteria(slug: string, criteria: readonly PacketCriterion[], present: readonly string[]): CompletionCriterion[] {
  return criteria.map((k) => ({ text: k.text, pass: k.pass, evidence: k.evidence.map((e) => evidenceLink(slug, e, present)) }));
}

/**
 * "How do I know it was done": the verdict and who gave it, each criterion with its proof, what
 * the work changed, and the record it left. Null for anything not finished — the page asks the
 * question only of the Completed view.
 */
function completionOf(c: RepoCtx, detail: TaskDetail): Completion | null {
  if (detail.task.state !== "done") return null;
  const packet = detail.packet;
  const present = packet?.evidence ?? [];
  const landing = completionLanding(c, detail.task);
  const handles = handleResolver(c);
  const info = (k: LogCommit): CommitInfo => ({ sha: k.sha, author: k.author, handle: handles(k.author, k.email), date: k.date, subject: k.subject, task: k.task });
  return {
    verdict: packet?.verdict ?? null,
    decidedBy: packet?.decidedBy ?? null,
    decidedAt: packet?.decidedAt ?? null,
    criteria: completionCriteria(detail.task.slug, packet?.criteria ?? [], present),
    diff: completionDiff(landing),
    merge: landing.merge ? info(landing.merge) : null,
    commits: landing.commits.map(info),
    journal: detail.journal,
  };
}

function taskRoute(res: ServerResponse, c: RepoCtx, slug: string): void {
  if (!isSafeSlug(slug)) return json(res, 400, { error: "bad slug" });
  const detail = getTaskDetail(c.paths, c.config, slug);
  if (!detail) return json(res, 404, { error: `unknown task: ${slug}` });
  const index = nodeIndexOf(c);
  const centres: string[] = [];
  for (const raw of [...detail.impact.planned, ...detail.impact.actual]) {
    const id = nodeIdForPath(index, raw);
    if (id && index.get(id)?.kind === "file" && !centres.includes(id)) centres.push(id);
  }
  const downstream =
    centres.length > 0
      ? impactView(graphOf(c), centres, { ...areaOpts(c), depth: 2, direction: "up" }).nodes
          .filter((n) => n.side === "up" && n.kind === "file" && typeof n.hop === "number")
          .map((n) => ({ id: n.id, hop: n.hop ?? 1 }))
      : [];
  return json(res, 200, { ...detail, impact: { ...detail.impact, downstream }, completion: completionOf(c, detail), policy: policyOf(c, detail) });
}

/**
 * What the policy would say about this task: the object `reggie check <slug> --json` prints, for a
 * task with a live branch and a packet on it, and null otherwise. It is computed per request for
 * this one page and never stored, because it is a function of two commits and both move; the task
 * list never computes it. It is a report: the decide form below it is still how a task is decided.
 */
function policyOf(c: RepoCtx, detail: TaskDetail): PolicyReport | null {
  const ref = detail.task.branchRef;
  if (ref === null || fileAtRef(c.root, ref, packetRelPath(detail.task.slug)) === null) return null;
  return evaluateCompletion(c.root, detail.task.slug);
}

// ---------------------------------------------------------------------------
// Launch: describing a session, and starting one (spec §6)
// ---------------------------------------------------------------------------

interface LaunchRequest {
  tool: LaunchTool;
  mode: LaunchMode;
  slugs: string[];
  note?: string;
  /** Pack paths as the request spelled them; resolved against the repo by `launchPaths` before use. */
  paths: string[];
}

/**
 * Shared by GET and POST: the tool, the mode, the slugs, the note and the pack paths, validated
 * before anything is looked up. Which prompt runs follows from the tasks' states, resolved in
 * `launchTasks`; whether each path is a file or folder of the repo is resolved in `launchPaths`.
 */
function parseLaunch(rawSlugs: readonly string[], rawTool: string | null, rawMode: string | null, rawNote: string | null, rawPaths: readonly string[] = []): { ok: true; value: LaunchRequest } | { ok: false; error: string } {
  const tool = (rawTool ?? "").trim();
  if (!isLaunchTool(tool)) return { ok: false, error: `tool must be one of ${LAUNCH_TOOLS.join(", ")}` };
  const mode = (rawMode ?? "").trim();
  if (!isLaunchMode(mode)) return { ok: false, error: `mode must be one of ${LAUNCH_MODES.join(", ")}` };
  const slugs = uniq(rawSlugs.map((s) => s.trim()).filter((s) => s !== ""));
  if (slugs.length === 0) return { ok: false, error: "at least one slug is required" };
  if (slugs.some((s) => !isSafeSlug(s))) return { ok: false, error: "bad slug" };
  const note = (rawNote ?? "").trim();
  if (note.length > MAX_NOTE_CHARS) return { ok: false, error: `note is longer than ${MAX_NOTE_CHARS} characters` };
  // Kept as spelled, empties included: the resolver refuses a blank the way the capture route does,
  // and the cap is counted after resolution so that nine spellings of two paths are two.
  const paths = uniq(rawPaths);
  const value: LaunchRequest = { tool, mode, slugs, paths };
  if (note) value.note = note;
  return { ok: true, value };
}

/** The tasks a launch names, with their states; null for any slug this repo has never heard of. */
function launchTasks(c: RepoCtx, slugs: readonly string[]): { ok: true; tasks: LaunchTask[] } | { ok: false; missing: string[] } {
  const byS = new Map(tasksOf(c).map((t) => [t.slug, t]));
  const missing = slugs.filter((s) => !byS.has(s));
  if (missing.length > 0) return { ok: false, missing };
  return { ok: true, tasks: slugs.map((s) => ({ slug: s, state: byS.get(s)!.state })) };
}

/**
 * The pack paths a launch names, resolved through the same function the CLI uses. The first
 * refusal is the answer, in the resolver's words; nothing has been written, minted or recorded by then.
 */
function launchPaths(c: RepoCtx, paths: readonly string[]): { ok: true; paths: string[] } | { ok: false; error: string } {
  try {
    return { ok: true, paths: resolvePackPaths(c.paths, paths, MAX_LAUNCH_PATHS) };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "bad path" };
  }
}

/**
 * The pack paths of a launch body as spelled: `paths` (a list of strings) and the singular `path`.
 * A field of the wrong shape is a refusal rather than a silent drop, so a client that sent a path
 * and got a pack without it is never left guessing.
 */
function launchPathFields(body: Record<string, unknown>): { ok: true; paths: string[] } | { ok: false; error: string } {
  const out: string[] = [];
  if ("path" in body && body.path !== null && body.path !== undefined) {
    if (typeof body.path !== "string") return { ok: false, error: "path must be a string" };
    out.push(body.path);
  }
  if ("paths" in body && body.paths !== null && body.paths !== undefined) {
    if (!Array.isArray(body.paths) || body.paths.some((p) => typeof p !== "string")) return { ok: false, error: "paths must be a list of strings" };
    out.push(...(body.paths as string[]));
  }
  return { ok: true, paths: out };
}

function launchRoute(res: ServerResponse, c: RepoCtx, url: URL): void {
  const parsed = parseLaunch(url.searchParams.getAll("slug"), url.searchParams.get("tool"), url.searchParams.get("mode"), url.searchParams.get("note"), url.searchParams.getAll("path"));
  if (!parsed.ok) return json(res, 400, { error: parsed.error });
  const found = launchTasks(c, parsed.value.slugs);
  if (!found.ok) return json(res, 404, { error: `unknown task: ${found.missing.join(", ")}` });
  const resolved = launchPaths(c, parsed.value.paths);
  if (!resolved.ok) return json(res, 400, { error: resolved.error });
  const { tool, mode, note } = parsed.value;
  try {
    // Described, not started: no session id, no claim, no context file. The command shows where
    // the pack will be read from, since that is what the launched command will say too.
    const input = { repo: c.root, tool, mode, tasks: found.tasks, contextFiles: found.tasks.map((t) => `.reggie/.cache/context/${t.slug}.md`), ...(note ? { note } : {}), ...(resolved.paths.length > 0 ? { paths: resolved.paths } : {}) };
    const { command, cwd, description, goal } = launchCommand(input);
    return json(res, 200, { command, cwd, description, goal });
  } catch (err) {
    return json(res, 400, { error: err instanceof Error ? err.message : "cannot launch" });
  }
}

function stateMachineRoute(res: ServerResponse, c: RepoCtx): void {
  const counts = Object.fromEntries(TASK_STATES.map((s) => [s, 0])) as Record<TaskState, number>;
  for (const t of tasksOf(c)) counts[t.state] += 1;
  return json(res, 200, { states: STATE_MACHINE.states, transitions: STATE_MACHINE.transitions, counts, mode: inferMode(peopleOf(c)) });
}

function evidenceRoute(res: ServerResponse, c: RepoCtx, url: URL): void {
  const slug = url.searchParams.get("slug") ?? "";
  const file = url.searchParams.get("file") ?? "";
  if (!isSafeSlug(slug)) return json(res, 400, { error: "bad slug" });
  if (!file || file.includes("/") || file.includes("\\") || file.includes("..") || file.includes("\0")) return json(res, 400, { error: "bad file" });
  const dir = evidenceDir(c.paths, slug);
  const full = path.join(dir, file);
  if (!full.startsWith(path.resolve(dir) + path.sep)) return json(res, 400, { error: "bad file" });
  const ext = path.extname(file).toLowerCase();
  const type = EVIDENCE_TYPES[ext] ?? "application/octet-stream";
  if (existsSync(full) && statSync(full).isFile()) {
    res.writeHead(200, { ...evidenceHeaders(type), "content-length": statSync(full).size });
    createReadStream(full).pipe(res);
    return;
  }
  // Evidence is often committed on the task branch and never lands in the working tree.
  if (TEXTUAL_EVIDENCE.has(ext)) {
    const onBranch = fileAtRef(c.root, `task/${slug}`, `.reggie/tasks/${slug}/evidence/${file}`);
    if (onBranch !== null) {
      const body = Buffer.from(onBranch, "utf8");
      res.writeHead(200, { ...evidenceHeaders(type), "content-length": body.length });
      res.end(body);
      return;
    }
  }
  return json(res, 404, { error: "not found" });
}

function historyRoute(res: ServerResponse, c: RepoCtx, url: URL): void {
  const raw = url.searchParams.get("path");
  let key = "";
  if (raw !== null && raw !== "" && raw !== ".") {
    const clean = safeRepoPath(raw);
    if (clean === null) return json(res, 400, { error: "bad path" });
    key = clean;
  }
  const hist = historyOf(c);
  const days = qInt(url, "days", 30, 1, MAX_DAYS);
  const own = historyFor(hist, key);
  return json(res, 200, {
    path: key,
    history: own ?? { commits30: 0, commits90: 0, commits365: 0, linesChanged: 0, lastTouched: null, authors: [], busFactor: 0 },
    recent: recentFor(hist, key),
    commitsPerDay: commitsPerDayFor(hist, key, days),
  });
}

function notesRoute(res: ServerResponse, c: RepoCtx): void {
  const notes = notesOf(c);
  const stale = staleOf(c);
  return json(res, 200, {
    notes: withStaleFlags(notes, stale),
    stale: stale.map((s) => `${s.entity}|${s.entry.date}|${s.entry.type}`),
    citedBy: citedByOf(notes),
  });
}

function noteRoute(res: ServerResponse, c: RepoCtx, url: URL): void {
  const entity = (url.searchParams.get("path") ?? "").trim();
  if (!entity) return json(res, 200, { chain: [] });
  const stale = staleOf(c);
  try {
    if (entity.includes(":") || entity === "_repo" || entity === "repo" || entity === ".") {
      const note = readNoteFile(c.paths, entity);
      return json(res, 200, { chain: note ? withStaleFlags([note], stale) : [] });
    }
    const clean = safeRepoPath(entity);
    if (clean === null) return json(res, 400, { error: "bad path" });
    return json(res, 200, { chain: withStaleFlags(notesForPath(c.paths, clean), stale) });
  } catch (err) {
    return json(res, 400, { error: err instanceof Error ? err.message : "bad entity" });
  }
}

function planFilesBySlug(c: RepoCtx): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const t of tasksOf(c)) out.set(t.slug, [...t.planFiles, ...t.changedFiles]);
  return out;
}

function journalRoute(res: ServerResponse, c: RepoCtx, url: URL): void {
  const days = qInt(url, "days", 30, 1, MAX_JOURNAL_DAYS);
  const slug = url.searchParams.get("slug");
  const person = url.searchParams.get("person");
  const pathFilter = url.searchParams.get("path");
  if (slug && !isSafeSlug(slug)) return json(res, 400, { error: "bad slug" });
  const query: { days: number; limit: number; slug?: string; person?: string } = { days, limit: 500 };
  if (slug) query.slug = slug;
  if (person) query.person = person;
  const entries = readJournal(c.paths, query);
  const index = nodeIndexOf(c);
  const plans = planFilesBySlug(c);
  const slugs = knownSlugs(c.paths);
  let out = entries.map((e) => ({ ...e, taskExists: e.slug !== null && slugs.has(e.slug), nodeIds: journalNodeIds(e, index, plans) }));
  if (pathFilter) {
    const clean = safeRepoPath(pathFilter);
    if (clean === null) return json(res, 400, { error: "bad path" });
    out = out.filter((e) => e.nodeIds.some((id) => underPath(id, clean)));
  }
  return json(res, 200, out);
}

function peopleRoute(res: ServerResponse, c: RepoCtx): void {
  const people = peopleOf(c);
  const hist = historyOf(c);
  const tasks = tasksOf(c);
  const journal = journalOf(c);
  const areas = level1(graphOf(c), areaOpts(c)).areas;
  const repoHist = historyFor(hist, "");

  interface Row {
    handle: string;
    name: string;
    email: string;
    role: "maintainer" | "contributor";
    fromGit: boolean;
    commits365: number;
    areas: { id: string; share: number }[];
    activeClaims: { slug: string; since: string }[];
    lastJournal: JournalEntry | null;
    busFactorAreas: string[];
  }

  const rows = new Map<string, Row>();
  const blank = (handle: string, name: string, email: string, role: "maintainer" | "contributor", fromGit: boolean): Row => ({
    handle,
    name,
    email,
    role,
    fromGit,
    commits365: 0,
    areas: [],
    activeClaims: [],
    lastJournal: null,
    busFactorAreas: [],
  });

  for (const p of people.people) rows.set(p.handle, blank(p.handle, p.name, p.email, p.role, false));
  for (const a of repoHist?.authors ?? []) {
    const row = rows.get(a.handle);
    if (row) row.commits365 = a.commits;
    else {
      const fresh = blank(a.handle, a.name, a.email, "contributor", true);
      fresh.commits365 = a.commits;
      rows.set(a.handle, fresh);
    }
  }

  for (const area of areas) {
    const h = area.aggregates?.history;
    if (!h) continue;
    for (const a of h.authors) {
      const row = rows.get(a.handle) ?? blank(a.handle, a.name, a.email, "contributor", true);
      rows.set(a.handle, row);
      if (a.share > 0) row.areas.push({ id: area.id, share: a.share });
      if (h.busFactor <= 1 && a.share >= 0.2) row.busFactorAreas.push(area.id);
    }
  }

  // A task's owner is a display name or an email as git recorded it; map it back to a handle.
  const byIdentity = new Map<string, string>();
  for (const row of rows.values()) {
    byIdentity.set(row.handle.toLowerCase(), row.handle);
    if (row.name) byIdentity.set(row.name.toLowerCase(), row.handle);
    if (row.email) byIdentity.set(row.email.toLowerCase(), row.handle);
  }
  for (const t of tasks) {
    if (!t.owner) continue;
    if (t.state !== "in-process" && t.state !== "awaiting-decision") continue;
    const handle = byIdentity.get(t.owner.toLowerCase()) ?? (t.ownerEmail ? byIdentity.get(t.ownerEmail.toLowerCase()) : undefined);
    const row = handle ? rows.get(handle) : undefined;
    if (row) row.activeClaims.push({ slug: t.slug, since: t.lastActivity ?? "" });
  }

  for (const e of journal) {
    const row = rows.get(e.person);
    if (!row) continue;
    const current = row.lastJournal;
    if (!current || `${e.date} ${e.time}` > `${current.date} ${current.time}`) row.lastJournal = e;
  }

  let current = "";
  try {
    current = currentPerson(c.root, people).handle;
  } catch {
    current = people.people[0]?.handle ?? "";
  }
  const list = Array.from(rows.values()).sort((a, b) => b.commits365 - a.commits365 || a.handle.localeCompare(b.handle));
  for (const row of list) row.areas.sort((a, b) => b.share - a.share);
  return json(res, 200, { people: list, mode: inferMode(people), current });
}

interface SearchResult {
  kind: "area" | "file" | "symbol" | "task" | "person" | "note" | "journal";
  id: string;
  label: string;
  route: string;
  snippet: string;
  score: number;
  /** Ordering only; not part of the contract payload. */
  fanIn?: number;
  exact?: boolean;
}

function snippetAround(text: string, needle: string, width = 120): string {
  const flat = text.replace(/\s+/g, " ").trim();
  const at = flat.toLowerCase().indexOf(needle.toLowerCase());
  if (at < 0) return flat.slice(0, width);
  const start = Math.max(0, at - Math.floor(width / 3));
  return `${start > 0 ? "…" : ""}${flat.slice(start, start + width)}${start + width < flat.length ? "…" : ""}`;
}

function searchRoute(res: ServerResponse, c: RepoCtx, url: URL): void {
  const q = (url.searchParams.get("q") ?? "").trim();
  const limit = qInt(url, "limit", 20, 1, MAX_SEARCH_LIMIT);
  if (!q) return json(res, 200, { results: [] });
  const needle = q.toLowerCase();
  const g = graphOf(c);
  const repo = c.name;
  const out: SearchResult[] = [];

  for (const n of g.nodes) {
    if (n.kind === "file") {
      const base = n.label.toLowerCase();
      const stem = base.replace(/\.[^.]+$/, "");
      const exact = base === needle || stem === needle;
      if (exact || n.path.toLowerCase().includes(needle)) {
        out.push({
          kind: "file",
          id: n.id,
          label: n.label,
          route: routeFor(repo, n.id),
          snippet: n.path,
          score: exact ? 100 : 60,
          fanIn: n.inDegree,
          exact,
        });
      }
    } else if (n.kind === "dir" && n.id !== "dir:./") {
      if (n.label.toLowerCase().includes(needle) || n.path.toLowerCase().includes(needle)) {
        out.push({
          kind: "area",
          id: n.id,
          label: n.label,
          route: routeFor(repo, n.id),
          snippet: `${n.aggregates?.source ?? 0} source files in ${n.path}`,
          score: 60,
          fanIn: n.aggregates?.files ?? 0,
          exact: n.label.toLowerCase() === needle,
        });
      }
    }
  }

  for (const s of symbolIndexOf(c)) {
    const name = s.name.toLowerCase();
    if (!name.includes(needle)) continue;
    out.push({
      kind: "symbol",
      id: `${s.file}::${s.name}`,
      label: s.name,
      route: routeFor(repo, s.file),
      snippet: `${s.kind} in ${s.file}:${s.line}`,
      score: 55,
      fanIn: 0,
      exact: name === needle,
    });
  }

  for (const t of tasksOf(c)) {
    if (!t.title.toLowerCase().includes(needle) && !t.slug.toLowerCase().includes(needle)) continue;
    out.push({
      kind: "task",
      id: `task:${t.slug}`,
      label: t.title || t.slug,
      route: routeFor(repo, `task:${t.slug}`),
      snippet: `${t.state} · ${t.reason}`,
      score: 50,
      fanIn: 0,
      exact: t.slug.toLowerCase() === needle,
    });
  }

  for (const p of peopleOf(c).people) {
    if (!p.handle.toLowerCase().includes(needle) && !p.name.toLowerCase().includes(needle)) continue;
    out.push({
      kind: "person",
      id: `person:${p.handle}`,
      label: p.name || p.handle,
      route: routeFor(repo, `person:${p.handle}`),
      snippet: `${p.role} · ${p.handle}`,
      score: 45,
      fanIn: 0,
      exact: p.handle.toLowerCase() === needle,
    });
  }

  for (const note of notesOf(c)) {
    for (const entry of note.entries) {
      if (!entry.text.toLowerCase().includes(needle)) continue;
      out.push({
        kind: "note",
        id: note.entity,
        label: `${entry.type} note on ${note.entity}`,
        route: routeFor(repo, note.kind === "dir" ? `dir:${note.entity.replace(/\/*$/, "/")}` : note.entity),
        snippet: snippetAround(entry.text, q),
        score: 30,
        fanIn: 0,
      });
      break;
    }
  }

  for (const e of journalOf(c)) {
    if (!e.text.toLowerCase().includes(needle)) continue;
    out.push({
      kind: "journal",
      id: `${e.date} ${e.time} ${e.person}`,
      label: `${e.date} · ${e.person}`,
      route: e.slug ? routeFor(repo, `task:${e.slug}`) : routeFor(repo, ""),
      snippet: snippetAround(e.text, q),
      score: 20,
      fanIn: 0,
    });
  }

  out.sort((a, b) => b.score - a.score || Number(b.exact ?? false) - Number(a.exact ?? false) || (b.fanIn ?? 0) - (a.fanIn ?? 0) || a.label.localeCompare(b.label));
  const results = out.slice(0, limit).map(({ fanIn: _fanIn, exact: _exact, ...rest }) => rest);
  return json(res, 200, { results });
}

// ---------------------------------------------------------------------------
// Services and data flow routes (services-and-flows-spec.md §3)
// ---------------------------------------------------------------------------

/** Longest service id accepted; the longest one this repo can generate is far shorter. */
const MAX_ID_CHARS = 200;

function badId(raw: string): boolean {
  return raw.length > MAX_ID_CHARS || /[\u0000-\u001f]/.test(raw);
}

/** `ServiceIndex` with the files that touch each service attached to its node. */
function servicesRoute(res: ServerResponse, c: RepoCtx): void {
  const index = servicesOf(c);
  return json(res, 200, {
    services: index.services.map((s) => decorateService(c, s)),
    edges: index.edges,
    undeclared: index.undeclared.map((s) => decorateService(c, s)),
    unused: index.unused.map((s) => decorateService(c, s)),
    generatedAt: index.generatedAt,
  });
}

/** One service: every call site, its notes, the tasks whose plans touch its files, the flows that reach it. */
function serviceRoute(res: ServerResponse, c: RepoCtx, url: URL): void {
  const id = url.searchParams.get("id") ?? "";
  if (!id) return json(res, 400, { error: "id is required" });
  if (badId(id)) return json(res, 400, { error: "bad id" });
  const index = servicesOf(c);
  const node = index.services.find((s) => s.id === id);
  if (!node) return json(res, 404, { error: `unknown service: ${id}` });

  const callSites = index.edges.filter((e) => e.service === id);
  const decorated = decorateService(c, node);
  const nodes = nodeIndexOf(c);
  const tasksBySlug = new Map(tasksOf(c).map((t) => [t.slug, t] as const));
  const slugs = uniq(decorated.files.flatMap((f) => nodes.get(f)?.tasks ?? [])).sort();
  const tasks = slugs.map((slug) => ({
    slug,
    state: tasksBySlug.get(slug)?.state ?? ("ungroomed" as TaskState),
    title: tasksBySlug.get(slug)?.title ?? slug,
  }));

  return json(res, 200, {
    service: decorated,
    callSites,
    notes: serviceNotesOf(c, node),
    tasks,
    flows: flowsOf(c).flows.filter((f) => f.services.includes(id)),
    // A database's tables, so the page can show what lives in it without a second request.
    children: index.services.filter((s) => s.parent === id).map((s) => decorateService(c, s)),
    parent: node.parent ? index.services.find((s) => s.id === node.parent) ?? null : null,
    editorUrl: decorated.declaredAt ? editorUrlFor(extrasOf(c).editorScheme, c.root, decorated.declaredAt.file) : null,
  });
}

/** One summary per entry point (spec §3). */
function flowsRoute(res: ServerResponse, c: RepoCtx): void {
  const index = flowsOf(c);
  return json(res, 200, { flows: index.flows, generatedAt: index.generatedAt });
}

/**
 * One traced flow. `depth` is validated like every other numeric parameter and then clamped to
 * `MAX_FLOW_HOPS`: asking for more hops than the tracer will ever walk is a wish, not an error.
 */
function flowRoute(res: ServerResponse, c: RepoCtx, url: URL): void {
  const id = url.searchParams.get("id") ?? "";
  if (!id) return json(res, 400, { error: "id is required" });
  if (badId(id)) return json(res, 400, { error: "bad id" });
  const depth = Math.min(qInt(url, "depth", MAX_FLOW_HOPS, 1, MAX_QUERY_DEPTH), MAX_FLOW_HOPS);
  const flow = flowOf(c, id, depth);
  return flow ? json(res, 200, flow) : json(res, 404, { error: `unknown flow: ${id}` });
}

function contextRoute(res: ServerResponse, c: RepoCtx, url: URL): void {
  const slug = url.searchParams.get("slug");
  const paths = url.searchParams.getAll("path");
  const req: { slug?: string; paths?: string[]; maxLines?: number } = { maxLines: 400 };
  if (slug && isSafeSlug(slug)) req.slug = slug;
  if (paths.length > 0) req.paths = paths;
  return json(res, 200, { text: buildContext(c.paths, c.config, req) });
}

// ---------------------------------------------------------------------------
// POST routes
// ---------------------------------------------------------------------------

async function handlePost(req: IncomingMessage, res: ServerResponse, url: URL, registry: RepoRegistry, port: number, keyed = false): Promise<void> {
  const routes = new Set(["/api/capture", "/api/intake", "/api/note", "/api/decide", "/api/journal", "/api/triage", "/api/launch", "/api/episode"]);
  if (!routes.has(url.pathname)) {
    const readOnly = new Set([
      "/api/facts",
      "/api/status",
      "/api/graph",
      "/api/impact",
      "/api/story",
      "/api/narration",
      "/api/feed.xml",
      "/api/explain",
      "/api/file",
      "/api/changes",
      "/api/filediff",
      "/api/symbols",
      "/api/tasks",
      "/api/state-machine",
      "/api/evidence",
      "/api/history",
      "/api/notes",
      "/api/note",
      "/api/journal",
      "/api/people",
      "/api/search",
      "/api/workspace",
      "/api/context",
      "/api/services",
      "/api/service",
      "/api/flows",
      "/api/flow",
    ]);
    return json(res, readOnly.has(url.pathname) ? 405 : 404, { error: readOnly.has(url.pathname) ? "method not allowed" : "not found" });
  }
  // `keyed` says the dispatcher already checked the serve key on a network socket; loopback
  // sockets arrive with it false and are trusted as before.
  const originProblem = checkPostOrigin(req, port, { keyed });
  if (originProblem) return json(res, 403, { error: originProblem });

  const c = registry.resolve(url.searchParams.get("repo"));
  if (!c) return json(res, 404, { error: "unknown repo" });

  const body = await readJsonBody(req);
  if (!body.ok) return json(res, body.status, { error: body.error });

  let person: Person;
  try {
    person = currentPerson(c.root, peopleOf(c));
  } catch (err) {
    return json(res, 500, { error: err instanceof Error ? err.message : "no current person" });
  }
  // A write over the network is attributed to whoever runs `reggie serve`, because the key carries
  // no identity. Alone that is the same person; in a team it would be a silent takeover, so it is
  // refused until the key can name a person.
  if (keyed && c.config.mode === "team") {
    return json(res, 403, { error: "writes over the network are attributed to the machine's owner, so in team mode they are refused; write from the machine running reggie serve, or switch to solo mode" });
  }

  switch (url.pathname) {
    case "/api/capture": {
      const text = str(body.value, "text");
      if (!text) return json(res, 400, { error: "text is required" });
      const input: { text: string; person: Person; source: string; detail?: string; slug?: string; origin?: CaptureOrigin } = { text, person, source: "web" };
      const detail = str(body.value, "detail");
      if (detail) input.detail = detail;
      const slug = str(body.value, "slug");
      if (slug) {
        if (!isSafeSlug(slug)) return json(res, 400, { error: "bad slug" });
        input.slug = slug;
      }
      // The page the idea came from. Resolved before the file is touched, so a refused origin
      // writes nothing; the detail line is then built from the resolver's output, never the body.
      // The task list is built only for a task origin: after the previous capture's invalidate it
      // is a full listTasks, which a path origin has no use for.
      const rawOrigin = originFields(body.value);
      if (rawOrigin) {
        try {
          const opts = typeof rawOrigin.task === "string" ? { knownTasks: new Set(tasksOf(c).map((t) => t.slug)) } : {};
          input.origin = resolveCaptureOrigin(c.paths, rawOrigin, opts);
        } catch (err) {
          return json(res, 400, { error: err instanceof Error ? err.message : "bad origin" });
        }
      }
      const result = capture(c.paths, input);
      c.invalidate();
      return json(res, 200, { ...result, origin: input.origin ?? null });
    }
    case "/api/intake": {
      // The user's answer to "what did you mean": detail lines under the intake item, in the
      // same shape `capture --detail` writes, so the board, the pack and the shaping session all
      // read it without learning anything new.
      const slug = str(body.value, "slug");
      const text = str(body.value, "text");
      if (!slug || !isSafeSlug(slug)) return json(res, 400, { error: "bad slug" });
      if (!text || !text.trim()) return json(res, 400, { error: "text is required" });
      const task = tasksOf(c).find((t) => t.slug === slug);
      if (!task) return json(res, 404, { error: `unknown task: ${slug}` });
      // Triage takes the line and the brief becomes the record. `addIntakeDetail` writes a fresh
      // line for a slug that has none, so answering here would rebuild the very line triage
      // removed — and pull the card's age back with it. Refuse, and say where the answer belongs.
      if (task.brief?.exists) {
        return json(res, 409, { error: `${slug} has a brief; answers belong in .reggie/tasks/${slug}/brief.md, not back in intake` });
      }
      const input: { slug: string; text: string; person: Person; source: string; title?: string } = { slug, text, person, source: "web" };
      if (!task.intake) input.title = task.title;
      try {
        const result = addIntakeDetail(c.paths, input);
        c.invalidate();
        return json(res, 200, result);
      } catch (err) {
        return json(res, 400, { error: err instanceof Error ? err.message : "could not add the detail" });
      }
    }
    case "/api/episode": {
      // Make (or remake) the audio for a story. The script is the same narration the page reads
      // aloud, so what you hear in a podcast app is what you would have read on the page.
      const scope = str(body.value, "scope") ?? "repo";
      const id = str(body.value, "id") ?? "";
      const lookup = new URL(`http://x/api/story?scope=${encodeURIComponent(scope)}&id=${encodeURIComponent(id)}`);
      const story = buildStory(c, registry, lookup);
      if (!story.ok) return json(res, story.status, { error: story.error });
      const narration = narrate(story.story, { repo: c.name });
      try {
        const voice = str(body.value, "voice");
        const episode = await makeEpisode(c.root, voice && /^[A-Za-z][A-Za-z ()-]{0,40}$/.test(voice) ? { scope, id, narration, voice } : { scope, id, narration });
        return json(res, 200, { ...episodeSummary(episode, scope, id), title: episode.title, words: episode.words });
      } catch (err) {
        return json(res, 501, { error: err instanceof Error ? err.message : "could not make the episode" });
      }
    }
    case "/api/note": {
      const entity = str(body.value, "entity");
      const text = str(body.value, "text");
      const type = str(body.value, "type");
      if (!entity) return json(res, 400, { error: "entity is required" });
      if (!text) return json(res, 400, { error: "text is required" });
      if (!type || !(NOTE_TYPES as readonly string[]).includes(type)) return json(res, 400, { error: `type must be one of ${NOTE_TYPES.join(", ")}` });
      const rawConfidence = str(body.value, "confidence");
      const confidence: NoteConfidence | null = rawConfidence === "high" || rawConfidence === "medium" || rawConfidence === "low" ? rawConfidence : null;
      const input: { type: NoteType; text: string; author: string; confidence?: NoteConfidence; sources?: string[] } = {
        type: type as NoteType,
        text,
        author: `${person.handle} (web)`,
      };
      if (confidence) input.confidence = confidence;
      const sources = strList(body.value, "sources");
      if (sources.length > 0) input.sources = sources;
      try {
        const { target, entry, created } = addNote(c.paths, entity, input);
        c.invalidate();
        return json(res, 200, { entity: target.entity, kind: target.kind, created, entry });
      } catch (err) {
        return json(res, 400, { error: err instanceof Error ? err.message : "bad entity" });
      }
    }
    case "/api/decide": {
      const slug = str(body.value, "slug");
      const verdict = str(body.value, "verdict");
      if (!slug || !isSafeSlug(slug)) return json(res, 400, { error: "bad slug" });
      if (verdict !== "approved" && verdict !== "needs-work") return json(res, 400, { error: "verdict must be approved or needs-work" });
      if (c.config.mode === "team" && person.role !== "maintainer") return json(res, 403, { error: "only a maintainer can decide in team mode" });
      // The awaiting-decision packet usually sits on task/<slug> while the server runs from the
      // integration branch, so the decision reads past the working tree and copies it in first.
      const located = locatePacket(c.paths, c.config, slug);
      if (!located) return json(res, 409, { error: `no packet for ${slug} in the working tree, on task/${slug}, or on the integration branch` });
      const comment = str(body.value, "comment");
      // Solo approval lands the branch, the same path as `reggie decide`: a done task always has its merge.
      if (verdict === "approved" && c.config.mode !== "team") {
        try {
          const r = landTask(c.paths, c.config, slug, { person, tool: "human", ...(comment ? { comment } : {}) });
          c.invalidate();
          return json(res, 200, {
            slug,
            verdict,
            file: r.packet,
            merge: r.merge,
            commit: r.commit,
            alreadyLanded: r.alreadyLanded,
            existingMerge: r.existingMerge,
            released: r.released,
            releaseError: r.releaseError,
            // Slugs of the intake items the approval captured out of the packet's Discovered issues, inside the same commit.
            captured: r.captured,
          });
        } catch (err) {
          c.invalidate();
          if (err instanceof LandError) return json(res, 409, { error: err.message });
          throw err;
        }
      }
      if (located.ref) materializePacket(c.paths, slug, located.content);
      const file = decidePacket(c.paths, slug, verdict, person.handle, comment ?? undefined);
      c.invalidate();
      const payload: { slug: string; verdict: string; file: string; materializedFrom?: string } = { slug, verdict, file };
      if (located.ref) payload.materializedFrom = located.ref;
      return json(res, 200, payload);
    }
    case "/api/journal": {
      const text = str(body.value, "text");
      if (!text) return json(res, 400, { error: "text is required" });
      const input: { person: string; tool: string; text: string; session: string; slug?: string; stage?: string; evidence?: string[] } = {
        person: person.handle,
        tool: "human",
        text,
        session: "web",
      };
      const slug = str(body.value, "slug");
      if (slug) {
        if (!isSafeSlug(slug)) return json(res, 400, { error: "bad slug" });
        input.slug = slug;
      }
      const stage = str(body.value, "stage");
      if (stage) input.stage = stage;
      const evidence = strList(body.value, "evidence");
      if (evidence.length > 0) input.evidence = evidence;
      const entry = appendJournal(c.paths, input);
      c.invalidate();
      return json(res, 200, entry);
    }
    case "/api/triage": {
      // `{ slug }` shapes one card; `{ slugs: [...] }` is the column's "Shape these" button.
      const one = str(body.value, "slug");
      const slugs = uniq([...(one ? [one] : []), ...strList(body.value, "slugs").map((s) => s.trim()).filter((s) => s !== "")]);
      if (slugs.length === 0) return json(res, 400, { error: "slug or slugs is required" });
      if (slugs.some((s) => !isSafeSlug(s))) return json(res, 400, { error: "bad slug" });
      const known = new Set(tasksOf(c).map((t) => t.slug));
      const created: string[] = [];
      const skipped: { slug: string; reason: string }[] = [];
      // The client clears each card's intake line optimistically, so it has to be told which
      // lines the scaffold actually took rather than assuming every created brief took one.
      const takenFromIntake: string[] = [];
      for (const slug of slugs) {
        if (!known.has(slug)) {
          skipped.push({ slug, reason: "nothing in this repo names that task" });
          continue;
        }
        // No `force` over HTTP: a brief holds thinking, and a button must not be able to erase it.
        const r = scaffoldBrief(c.paths, { slug, author: person.handle });
        if (r.skipped) skipped.push({ slug, reason: "a brief already exists" });
        else created.push(slug);
        if (r.intakeRemoved) takenFromIntake.push(slug);
      }
      if (created.length > 0) c.invalidate();
      return json(res, 200, { created, skipped, takenFromIntake });
    }
    case "/api/launch": {
      // The one route that starts a process. Everything is validated before it is; the command
      // is built as an argument vector by launch.ts and never interpolated into a shell.
      const raw = strList(body.value, "slugs");
      const single = str(body.value, "slug");
      const pathFields = launchPathFields(body.value);
      if (!pathFields.ok) return json(res, 400, { error: pathFields.error });
      const parsed = parseLaunch(single ? [single, ...raw] : raw, str(body.value, "tool"), str(body.value, "mode"), str(body.value, "note"), pathFields.paths);
      if (!parsed.ok) return json(res, 400, { error: parsed.error });
      const found = launchTasks(c, parsed.value.slugs);
      if (!found.ok) return json(res, 404, { error: `unknown task: ${found.missing.join(", ")}` });
      // A refused path answers before any pack is written, any session minted or any launch recorded.
      const resolved = launchPaths(c, parsed.value.paths);
      if (!resolved.ok) return json(res, 400, { error: resolved.error });
      const { tool, mode, note } = parsed.value;
      let goal: ReturnType<typeof resolveGoal>;
      try {
        goal = resolveGoal(mode, found.tasks);
      } catch (err) {
        return json(res, 400, { error: err instanceof Error ? err.message : "cannot launch" });
      }
      // A build is claimed here, by Reggie, before the session opens: claim is state, and state
      // is Reggie's. The session then starts in the task's worktree on its branch, so it never
      // has to find its way there and can never edit the checkout the server is reading.
      let cwd = c.root;
      let branch: string | undefined;
      let setup: ReturnType<typeof pendingSetup> = [];
      const session = mintSession(tool);
      if (goal === "build") {
        const slug = found.tasks[0]!.slug;
        try {
          // `defer`: the claim links dependencies when that is safe, but never runs an install here.
          // This server handles one request at a time, so a cold install would hold every other one
          // for minutes. What is left goes into the session's prompt as its first command.
          const claimed = claimTask(c.paths, c.config, slug, { person, worktree: true, tool, deps: "defer", ...(session ? { session } : {}) });
          cwd = claimed.worktree ?? c.root;
          branch = claimed.branch;
          setup = pendingSetup(claimed.deps);
        } catch (err) {
          return json(res, 409, { error: err instanceof Error ? err.message : "could not claim the task" });
        }
      }
      const contextFiles = writeContextPacks(c.paths, c.config, cwd, found.tasks, resolved.paths);
      const input = { repo: cwd, tool, mode, tasks: found.tasks, contextFiles, ...(note ? { note } : {}), ...(session ? { session } : {}), ...(branch ? { branch } : {}), ...(setup.length > 0 ? { setup } : {}), ...(resolved.paths.length > 0 ? { paths: resolved.paths } : {}) };
      const result = launchSession(input);
      for (const t of found.tasks) recordLaunch(c.root, { slug: t.slug, tool, goal, session: result.session, resume: result.resume, cwd: result.cwd });
      c.invalidate();
      return json(res, 200, result);
    }
    default:
      return json(res, 404, { error: "not found" });
  }
}
