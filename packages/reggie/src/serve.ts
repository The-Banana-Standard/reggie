import { createReadStream, existsSync, readFileSync, statSync } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import YAML from "yaml";
import { capture } from "./capture.js";
import { buildContext } from "./context.js";
import { collectFacts, type RepoFacts } from "./facts.js";
import { detectFlows, MAX_FLOW_HOPS, traceFlow, type Flow, type FlowIndex } from "./flows.js";
import { currentBranch, defaultBranch, fileAtRef, git } from "./git.js";
import { buildGraph, flatGraph, jsImports, type GraphEdge, type GraphNode, type RepoGraph } from "./graph.js";
import { commitsPerDayFor, historyFor, HISTORY_LOG_FORMAT, parseNumstatLog, recentFor, repoHistory, type CommitInfo, type HistoryIndex, type LogCommit } from "./history.js";
import { appendJournal, readJournal, type JournalEntry } from "./journal.js";
import { isLaunchMode, isLaunchTool, LAUNCH_MODES, LAUNCH_TOOLS, launchCommand, launchSession, type LaunchMode, type LaunchTool } from "./launch.js";
import { addNote, allNoteFiles, NOTE_TYPES, notesForPath, notesIndex, readNoteFile, staleEntriesFor, type Confidence as NoteConfidence, type NoteEntry, type NoteFile, type NoteType, type StaleEntry } from "./notes.js";
import { decidePacket, locatePacket, materializePacket } from "./packet.js";
import { evidenceDir, type RepoPaths } from "./paths.js";
import { currentPerson, handleFor, inferMode, loadPeople, type PeopleFile, type Person, type ReggieConfig } from "./people.js";
import { roleOf } from "./roles.js";
import { detectServices, type ServiceIndex, type ServiceNode } from "./services.js";
import { areaStory, buildStoryContext, explain, fileStory, flowStory, repoStory, routeFor, servicesStory, taskStory, workspaceStory, type Lens, type StoryContext } from "./story.js";
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
  ".md": "text/markdown; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
};

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
    const out: SymbolHit[] = [];
    for (const n of graphOf(c).nodes) {
      if (n.kind !== "file" || n.role === "generated" || !symbolLang(n.path)) continue;
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

/**
 * Every entry point, each traced once. The declared services go in so a binding resolves to
 * the kind `wrangler.toml` gives it instead of the one its method suggests.
 */
function flowsOf(c: RepoCtx): FlowIndex {
  return c.cached("flows", () => detectFlows(c.paths, graphOf(c), { services: servicesOf(c).services }));
}

/**
 * One flow at one depth, or null when nothing is entered there. The id is checked against the
 * index *before* the cache is touched, so an unknown id cannot mint cache keys.
 */
function flowOf(c: RepoCtx, id: string, depth: number): Flow | null {
  const entry = flowsOf(c).entries.find((e) => e.id === id || e.node === id);
  if (!entry) return null;
  return c.cached(`flow:${depth}:${entry.id}`, () => traceFlow(c.paths, graphOf(c), entry.id, { depth, services: servicesOf(c).services }));
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
 * `Sec-Fetch-Site` must be absent, `same-origin` or `none`; a present `Origin` must be this
 * server's own loopback origin. Deliberately *not* compared against the `Host` header: `Host` is
 * attacker-controlled, so `origin === "http://" + host` is trivially satisfiable and would let a
 * rebound page through (`checkHostHeader` is the other half of that defence).
 */
export function checkPostOrigin(req: IncomingMessage, port: number): string | null {
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

// ---------------------------------------------------------------------------
// Server
// ---------------------------------------------------------------------------

export interface ServeOptions {
  port: number;
  host: string;
  /** Serve every repo of this workspace; absent or null means single-repo mode on `paths.root`. */
  workspace?: Workspace | null;
}

export interface ServerHandle {
  url: string;
  port: number;
  /** Repo names served, in registry order. */
  repos: string[];
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

  const handler = (req: IncomingMessage, res: ServerResponse): void => {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? opts.host}`);
    const method = req.method ?? "GET";
    try {
      const hostProblem = checkHostHeader(req);
      if (hostProblem) return json(res, 403, { error: hostProblem });
      if (handleStatic(url, method, res)) return;
      if (url.pathname.startsWith("/api/")) {
        if (method === "POST") {
          void handlePost(req, res, url, registry, boundPort).catch((err: unknown) => sendError(res, err));
          return;
        }
        if (method !== "GET" && method !== "HEAD") return json(res, 405, { error: "method not allowed" });
        return handleGet(res, url, registry, primary);
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

function handleGet(res: ServerResponse, url: URL, registry: RepoRegistry, primary: { root: string; config: ReggieConfig }): void {
  // A rejected query parameter is bad input, not a server fault: 400, not the outer handler's 500.
  try {
    return route(res, url, registry, primary);
  } catch (err) {
    if (err instanceof BadQuery) return json(res, 400, { error: err.message });
    throw err;
  }
}

function route(res: ServerResponse, url: URL, registry: RepoRegistry, primary: { root: string; config: ReggieConfig }): void {
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
    case "/api/explain":
      return explainRoute(res, c, url);
    case "/api/file":
      return fileRoute(res, c, url);
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
    case "/api/treemap":
    case "/api/timeline":
    case "/api/export":
      return json(res, 501, { error: "not implemented" });
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

function storyRoute(res: ServerResponse, c: RepoCtx, registry: RepoRegistry, url: URL): void {
  const scope = url.searchParams.get("scope") ?? "repo";
  if (scope === "workspace") return json(res, 200, workspaceStory(workspaceSummary(registry)));
  const lens = qLens(url);
  const days = qInt(url, "days", 14, 1, MAX_DAYS);
  const ctx = storyContextOf(c, c.name, lens, days);
  const id = url.searchParams.get("id") ?? "";
  if (scope === "repo") return json(res, 200, repoStory(ctx, { services: servicesOf(c), flows: flowsOf(c).flows }));
  if (scope === "services") return json(res, 200, servicesStory(ctx, servicesOf(c)));
  if (scope === "flow") {
    if (!id) return json(res, 400, { error: "id is required for scope=flow" });
    if (badId(id)) return json(res, 400, { error: "bad id" });
    const depth = Math.min(qInt(url, "depth", MAX_FLOW_HOPS, 1, MAX_QUERY_DEPTH), MAX_FLOW_HOPS);
    const flow = flowOf(c, id, depth);
    return flow ? json(res, 200, flowStory(ctx, flow, { services: servicesOf(c).services })) : json(res, 404, { error: `unknown flow: ${id}` });
  }
  if (scope === "area") {
    if (!id) return json(res, 400, { error: "id is required for scope=area" });
    if (safeRepoPath(id) === null && id !== ".") return json(res, 400, { error: "bad id" });
    const story = areaStory(ctx, id);
    return story ? json(res, 200, story) : json(res, 404, { error: `unknown area: ${id}` });
  }
  if (scope === "file") {
    const clean = safeRepoPath(id);
    if (clean === null) return json(res, 400, { error: "bad id" });
    const story = fileStory(ctx, clean);
    return story ? json(res, 200, story) : json(res, 404, { error: `unknown file: ${id}` });
  }
  if (scope === "task") {
    if (!isSafeSlug(id)) return json(res, 400, { error: "bad slug" });
    const story = taskStory(ctx, id);
    return story ? json(res, 200, story) : json(res, 404, { error: `unknown task: ${id}` });
  }
  return json(res, 400, { error: `unknown scope: ${scope}` });
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
  commits: CommitInfo[];
  journal: JournalEntry[];
}

/**
 * The commits behind a finished task. Merged work is in the history index already (matched by
 * the `Task:` trailer); work still sitting on `task/<slug>` is not, because the index is read
 * from HEAD, so the branch is read directly in that case with the same format and parser.
 */
function completionCommits(c: RepoCtx, task: TaskInfo): LogCommit[] {
  const merged = historyOf(c).log.filter((k) => k.task === task.slug);
  if (merged.length > 0 || !task.branch) return merged;
  const base = defaultBranch(c.root, c.config.defaultBranch);
  const r = git(["-c", "core.quotePath=false", "log", "--numstat", "-M", `--format=${HISTORY_LOG_FORMAT}`, `${base}..${task.branch}`], {
    cwd: c.root,
    allowFailure: true,
  });
  return r.ok ? parseNumstatLog(r.stdout) : [];
}

/** Email → handle from people.yaml, falling back to the same derivation history.ts uses. */
function handleResolver(c: RepoCtx): (name: string, email: string) => string {
  const byEmail = new Map<string, string>();
  for (const p of peopleOf(c).people) if (p.email) byEmail.set(p.email.toLowerCase(), p.handle);
  return (name, email) => byEmail.get(email.toLowerCase()) ?? handleFor(name, email);
}

/** Lines added and removed per file, summed across the task's commits. Reggie's own records are left out. */
function completionDiff(commits: readonly LogCommit[]): CompletionDiff {
  const byFile = new Map<string, { path: string; added: number; deleted: number }>();
  let added = 0;
  let deleted = 0;
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
  return { files, filesChanged: files.length, added, deleted, commits: commits.length };
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
  const commits = completionCommits(c, detail.task);
  const handles = handleResolver(c);
  return {
    verdict: packet?.verdict ?? null,
    decidedBy: packet?.decidedBy ?? null,
    decidedAt: packet?.decidedAt ?? null,
    criteria: completionCriteria(detail.task.slug, packet?.criteria ?? [], present),
    diff: completionDiff(commits),
    commits: commits.map((k) => ({ sha: k.sha, author: k.author, handle: handles(k.author, k.email), date: k.date, subject: k.subject, task: k.task })),
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
  return json(res, 200, { ...detail, impact: { ...detail.impact, downstream }, completion: completionOf(c, detail) });
}

// ---------------------------------------------------------------------------
// Launch: describing a session, and starting one (spec §6)
// ---------------------------------------------------------------------------

interface LaunchRequest {
  tool: LaunchTool;
  mode: LaunchMode;
  slugs: string[];
}

/**
 * The one gate every launch input passes through, whether it arrives as a query string or a
 * JSON body. Nothing unvalidated may reach a command line: the tool and the mode must be
 * members of their closed sets, every slug must be a safe slug, and only triage may name more
 * than one. `launchCommand` re-checks all of it — this exists so the failure is a 400 with a
 * sentence, rather than a thrown error.
 */
function parseLaunch(rawSlugs: readonly string[], rawTool: string | null, rawMode: string | null): { ok: true; value: LaunchRequest } | { ok: false; error: string } {
  const tool = (rawTool ?? "").trim();
  if (!isLaunchTool(tool)) return { ok: false, error: `tool must be one of ${LAUNCH_TOOLS.join(", ")}` };
  const mode = (rawMode ?? "").trim();
  if (!isLaunchMode(mode)) return { ok: false, error: `mode must be one of ${LAUNCH_MODES.join(", ")}` };
  const slugs = uniq(rawSlugs.map((s) => s.trim()).filter((s) => s !== ""));
  if (slugs.length === 0) return { ok: false, error: "at least one slug is required" };
  if (slugs.some((s) => !isSafeSlug(s))) return { ok: false, error: "bad slug" };
  if (mode !== "triage" && slugs.length > 1) return { ok: false, error: `${mode} takes exactly one slug; only triage runs over several tasks at once` };
  return { ok: true, value: { tool, mode, slugs } };
}

/** Slugs that name nothing in this repo, so a session is never opened on an invented task. */
function unknownSlugs(c: RepoCtx, slugs: readonly string[]): string[] {
  const known = new Set(tasksOf(c).map((t) => t.slug));
  return slugs.filter((s) => !known.has(s));
}

function launchRoute(res: ServerResponse, c: RepoCtx, url: URL): void {
  const parsed = parseLaunch(url.searchParams.getAll("slug"), url.searchParams.get("tool"), url.searchParams.get("mode"));
  if (!parsed.ok) return json(res, 400, { error: parsed.error });
  const { command, cwd, description } = launchCommand({ repo: c.root, ...parsed.value });
  return json(res, 200, { command, cwd, description });
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
    res.writeHead(200, { "content-type": type, "cache-control": "no-store", "content-length": statSync(full).size });
    createReadStream(full).pipe(res);
    return;
  }
  // Evidence is often committed on the task branch and never lands in the working tree.
  if (TEXTUAL_EVIDENCE.has(ext)) {
    const onBranch = fileAtRef(c.root, `task/${slug}`, `.reggie/tasks/${slug}/evidence/${file}`);
    if (onBranch !== null) {
      const body = Buffer.from(onBranch, "utf8");
      res.writeHead(200, { "content-type": type, "cache-control": "no-store", "content-length": body.length });
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

async function handlePost(req: IncomingMessage, res: ServerResponse, url: URL, registry: RepoRegistry, port: number): Promise<void> {
  const routes = new Set(["/api/capture", "/api/note", "/api/decide", "/api/journal", "/api/triage", "/api/launch"]);
  if (!routes.has(url.pathname)) {
    const readOnly = new Set([
      "/api/facts",
      "/api/status",
      "/api/graph",
      "/api/impact",
      "/api/story",
      "/api/explain",
      "/api/file",
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
  if (!isLoopbackAddress(req.socket.remoteAddress ?? undefined)) return json(res, 403, { error: "writes are accepted from this machine only" });
  const originProblem = checkPostOrigin(req, port);
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

  switch (url.pathname) {
    case "/api/capture": {
      const text = str(body.value, "text");
      if (!text) return json(res, 400, { error: "text is required" });
      const input: { text: string; person: Person; source: string; detail?: string; slug?: string } = { text, person, source: "web" };
      const detail = str(body.value, "detail");
      if (detail) input.detail = detail;
      const slug = str(body.value, "slug");
      if (slug) {
        if (!isSafeSlug(slug)) return json(res, 400, { error: "bad slug" });
        input.slug = slug;
      }
      const result = capture(c.paths, input);
      c.invalidate();
      return json(res, 200, result);
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
      if (located.ref) materializePacket(c.paths, slug, located.content);
      const comment = str(body.value, "comment");
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
      for (const slug of slugs) {
        if (!known.has(slug)) {
          skipped.push({ slug, reason: "nothing in this repo names that task" });
          continue;
        }
        // No `force` over HTTP: a brief holds thinking, and a button must not be able to erase it.
        const r = scaffoldBrief(c.paths, { slug, author: person.handle });
        if (r.skipped) skipped.push({ slug, reason: "a brief already exists" });
        else created.push(slug);
      }
      if (created.length > 0) c.invalidate();
      return json(res, 200, { created, skipped });
    }
    case "/api/launch": {
      // The one route that starts a process. Everything is validated before it is; the command
      // is built as an argument vector by launch.ts and never interpolated into a shell.
      const raw = strList(body.value, "slugs");
      const single = str(body.value, "slug");
      const parsed = parseLaunch(single ? [single, ...raw] : raw, str(body.value, "tool"), str(body.value, "mode"));
      if (!parsed.ok) return json(res, 400, { error: parsed.error });
      const missing = unknownSlugs(c, parsed.value.slugs);
      if (missing.length > 0) return json(res, 404, { error: `unknown task: ${missing.join(", ")}` });
      return json(res, 200, launchSession({ repo: c.root, ...parsed.value }));
    }
    default:
      return json(res, 404, { error: "not found" });
  }
}
