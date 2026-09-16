/**
 * Views (ui-spec §6.2 and §6.3): pure projections of a `RepoGraph` into the `ViewGraph`
 * payloads the map draws (ui-api-contract.md, "Shared types" and `GET /api/graph?level=…`).
 *
 * Nothing here reads the disk, mutates the graph, or knows about HTTP: every function takes a
 * `RepoGraph` and returns fresh node and edge objects, so `serve.ts` can cache a graph per HEAD
 * sha and project it as often as it likes. Node clones carry a recomputed `area` (the id of the
 * Level-1 area that contains them, which is *not* the same as `graph.ts`'s cheap `node.area`
 * heuristic once a level-1 candidate has been split), so the client can colour by area without
 * re-deriving anything.
 *
 * The one hard rule these views exist to keep: at most `maxNodes` (40) drawable nodes on any
 * canvas. Ghosts and `fold:` nodes are context, not drawables, and do not count.
 */

import type { LanguageCount } from "./facts.js";
import { ROOT_DIR_ID, emptyKnowledge, findCycles, type Aggregates, type EdgeKind, type GraphEdge, type GraphNode, type RepoGraph } from "./graph.js";
import { historyForFiles, noHistory, type HistoryIndex } from "./history.js";
import { isTestLike } from "./roles.js";

// ---------------------------------------------------------------------------
// Contract types
// ---------------------------------------------------------------------------

/** A Level-1 area as the legend and the lens colours see it. */
export interface AreaRef {
  id: string;
  label: string;
  /** 1…`AREA_HUE_COUNT` for the largest areas by source count; 0 ("other") for everything else. */
  hue: number;
  source: number;
  files: number;
}

export interface ViewCounts {
  totalCodeFiles: number;
  /** Drawable nodes: areas, files, centres. Ghosts and folds excluded. */
  shown: number;
  /** Nodes hidden inside `fold:` nodes. */
  folded: number;
  /** Test and fixture files hidden because `tests` is off. */
  hiddenTests: number;
  /**
   * Repo-wide, not view-wide: code files the graph never read, by language (`RepoGraph.skipped`).
   * Lifted verbatim at every level so the three cannot disagree; the footer sums it, the made-of
   * sentence names it, and neither recomputes it.
   *
   * Read-only because every builder assigns the graph's own array by reference: one in-place sort in
   * a footer or a handler would silently reorder `RepoGraph.skipped` and every surface with it.
   */
  skipped: readonly LanguageCount[];
  /** Repo-wide, not view-wide: distinct import lines that pointed at no file (`RepoGraph.unresolved`). */
  unresolved: number;
  /** Impact only: nodes discovered per hop, index 0 = hop 1. */
  up?: number[];
  down?: number[];
}

/**
 * A view node is a graph node clone plus the view-only fields of the contract. `collision` is
 * additive to `GraphNode`: it lists the centres a node was reached from when more than one
 * centre reaches it (the task blast radius turns those ids into slugs).
 */
export interface ViewNode extends GraphNode {
  collision?: string[];
}

/** Where most of an aggregated edge's traffic lands, in the same unit as `weight`. */
export interface EdgeTop {
  /** Repo-relative path of the single most-imported file behind the edge. */
  path: string;
  /** Distinct importing files on the source side that reach it (never more than `weight`). */
  files: number;
}

/**
 * A view edge is a graph edge plus the dominant-pair summary, computed here once so the map
 * tooltip and the story sentence cannot disagree about it (they used to count different things
 * over a `via` list that had already been truncated).
 *
 * The same value ships under two names. `top` is what `serve.ts` has always sent and what the map
 * reads; `mostly` is the name the tooltip sentence uses ("mostly terminal.ts (17)") and the one a
 * client that has not been updated probes for. Both are the *whole* aggregate's answer, counted
 * before `via` is cut to five pairs — never derive the number from `via`.
 */
export interface ViewEdge extends GraphEdge {
  top?: EdgeTop;
  /** Alias of `top`, byte for byte. See above; both are sent, neither is authoritative over the other. */
  mostly?: EdgeTop;
}

export interface ViewGraph {
  level: "container" | "dir" | "impact" | "workspace";
  root: string;
  nodes: ViewNode[];
  edges: ViewEdge[];
  areas: AreaRef[];
  cycles: string[][];
  counts: ViewCounts;
  center?: string;
  centers?: string[];
  generatedAt: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Drawable-node cap for every view (spec §5.5, §6.2). */
export const MAX_VIEW_NODES = 40;
/** A directory with fewer source files than this is not worth its own node (spec §6.2 step 3). */
export const MIN_AREA_FILES = 3;
/** File pairs kept behind an aggregated edge. */
const MAX_VIA = 5;
/** Named imports kept on an aggregated edge. */
const MAX_EDGE_NAMES = 8;
/** Distinct area hues the palette carries; areas ranked below this share hue 0 ("other"). */
export const AREA_HUE_COUNT = 8;
/** Edge kinds that carry structure; `tests` joins them only when the tests toggle is on. */
const STRUCTURE_KINDS: ReadonlySet<EdgeKind> = new Set<EdgeKind>(["import", "mod", "ipc"]);

export interface ChooseAreasOptions {
  /** Drawable cap; also the "too big, split it" threshold in source files. Default 40. */
  maxNodes?: number;
  /** Smallest area worth drawing, in source files. Default 3. */
  minFiles?: number;
  /**
   * `config.yaml` `areas: [paths]`. Honoured for `dir:./` only (spec §6.2 step 4): each listed
   * path becomes an area and everything else folds into one residual "(other)" area.
   */
  areas?: readonly string[];
  /**
   * The repo's history index. Supplied, every drawable node carries `aggregates.history` — the
   * residual and config-pinned areas included, whose file sets are not directories and so have no
   * entry in `byPath` (that gap is what left the Heat lens with two occupied buckets). Omitted,
   * views still work; nodes simply keep whatever history `graph.ts` already put on them.
   */
  history?: HistoryIndex;
}

export interface AreaChoice {
  /** Area nodes, ready to draw. Residual areas carry `residual: true` and a "(other)" label. */
  areas: ViewNode[];
  /** Code files that belong to the root itself: its own files plus the files of folded candidates. */
  loose: string[];
  /** Area id → the code files it stands for (a split residual holds only part of its subtree). */
  files: Map<string, string[]>;
}

// ---------------------------------------------------------------------------
// Ids and small helpers
// ---------------------------------------------------------------------------

/** `dir:src/types/` → `src/types`; `dir:./` → `.`; a file id is returned unchanged. */
export function dirPathOf(id: string): string {
  const raw = id.startsWith("dir:") ? id.slice(4) : id;
  if (raw === "./" || raw === "." || raw === "") return ".";
  return raw.replace(/\/+$/, "");
}

/** `src/types`, `src/types/`, `dir:src/types/`, `.`, `./`, `""` → a canonical dir node id. */
export function dirIdOf(pathOrId: string): string {
  let p = pathOrId.trim();
  if (p.startsWith("dir:")) p = p.slice(4);
  p = p.replace(/\\/g, "/");
  while (p.startsWith("./")) p = p.slice(2);
  p = p.replace(/^\/+/, "").replace(/\/+$/, "");
  if (p === "" || p === ".") return ROOT_DIR_ID;
  return `dir:${p}/`;
}

/** The dir id of a known directory, or null when the graph has no such directory. */
export function resolveDirId(g: RepoGraph, pathOrId: string): string | null {
  const id = dirIdOf(pathOrId);
  const node = indexOf(g).nodes.get(id);
  return node && (node.kind === "dir" || node.kind === "repo") ? id : null;
}

function isUnder(fileOrDirPath: string, dirPath: string): boolean {
  if (dirPath === ".") return true;
  return fileOrDirPath === dirPath || fileOrDirPath.startsWith(`${dirPath}/`);
}

function cloneKnowledge(n: GraphNode): GraphNode["knowledge"] {
  return { ...n.knowledge, byType: { ...n.knowledge.byType } };
}

function cloneAggregates(a: Aggregates): Aggregates {
  const copy: Aggregates = { ...a, tasks: [...a.tasks] };
  if (a.history) copy.history = a.history;
  return copy;
}

/** A defensive copy: views never hand the caller a node the graph still owns. */
function cloneNode(n: GraphNode): ViewNode {
  const copy: ViewNode = {
    ...n,
    knowledge: cloneKnowledge(n),
    tasks: [...n.tasks],
    testedBy: [...n.testedBy],
    entryKinds: n.entryKinds.map((e) => ({ ...e })),
  };
  if (n.aggregates) copy.aggregates = cloneAggregates(n.aggregates);
  return copy;
}

// ---------------------------------------------------------------------------
// Graph index (built once per RepoGraph, reused by every view)
// ---------------------------------------------------------------------------

interface GraphIndex {
  nodes: Map<string, GraphNode>;
  /** Directory id → child directory ids, shallowest first. */
  dirChildren: Map<string, string[]>;
  /** Directory id → the code files sitting directly in it. */
  ownFiles: Map<string, string[]>;
  /** Directory id → every code file in its subtree. */
  filesUnder: Map<string, string[]>;
  /** Test and fixture files in the whole repo. */
  testFiles: string[];
}

const INDEX = new WeakMap<RepoGraph, GraphIndex>();

function indexOf(g: RepoGraph): GraphIndex {
  const cached = INDEX.get(g);
  if (cached) return cached;
  const nodes = new Map<string, GraphNode>();
  for (const n of g.nodes) nodes.set(n.id, n);
  const dirChildren = new Map<string, string[]>();
  const ownFiles = new Map<string, string[]>();
  const dirIds: string[] = [];
  const testFiles: string[] = [];
  for (const n of g.nodes) {
    if (n.kind === "dir") dirIds.push(n.id);
    const parent = n.parent;
    if (!parent) continue;
    if (n.kind === "dir") {
      const list = dirChildren.get(parent) ?? [];
      list.push(n.id);
      dirChildren.set(parent, list);
    } else if (n.kind === "file") {
      const list = ownFiles.get(parent) ?? [];
      list.push(n.id);
      ownFiles.set(parent, list);
      if (isTestLike(n.role)) testFiles.push(n.id);
    }
  }
  // Deepest first, so a directory's subtree is complete before its parent asks for it.
  const deepestFirst = [...dirIds].sort((a, b) => dirPathOf(b).split("/").length - dirPathOf(a).split("/").length || b.localeCompare(a));
  const filesUnder = new Map<string, string[]>();
  for (const id of deepestFirst) {
    const files = [...(ownFiles.get(id) ?? [])];
    for (const child of dirChildren.get(id) ?? []) files.push(...(filesUnder.get(child) ?? []));
    files.sort();
    filesUnder.set(id, files);
  }
  const idx: GraphIndex = { nodes, dirChildren, ownFiles, filesUnder, testFiles };
  INDEX.set(g, idx);
  return idx;
}

function filesUnderDir(idx: GraphIndex, dirId: string): string[] {
  return idx.filesUnder.get(dirId) ?? [];
}

function sourceCount(idx: GraphIndex, files: readonly string[]): number {
  let n = 0;
  for (const id of files) if (idx.nodes.get(id)?.role === "source") n += 1;
  return n;
}

/**
 * Aggregates over an arbitrary file set (a split residual is not a whole subtree).
 *
 * `hist`, when given, adds the git roll-up for exactly these files: `historyForFiles` counts each
 * commit once across the set rather than once per file, so a residual area's `commits30` is
 * comparable with a real directory's. A set git has never seen gets the `noHistory()` marker
 * (null counts) rather than zeros, which is a different fact and draws differently.
 */
function aggregateFiles(idx: GraphIndex, files: readonly string[], own?: GraphNode, hist?: HistoryIndex): Aggregates {
  const agg: Aggregates = { files: 0, source: 0, tests: 0, config: 0, lines: 0, documented: 0, stale: 0, testedSource: 0, tasks: [] };
  const tasks = new Set<string>();
  for (const id of files) {
    const n = idx.nodes.get(id);
    if (!n) continue;
    agg.files += 1;
    if (n.role === "source") agg.source += 1;
    if (isTestLike(n.role)) agg.tests += 1;
    if (n.role === "config") agg.config += 1;
    agg.lines += n.lines;
    if (n.role === "source" && (n.knowledge.own > 0 || n.knowledge.inherited > 0)) agg.documented += 1;
    if (n.role === "source" && n.testedBy.length > 0) agg.testedSource += 1;
    agg.stale += n.knowledge.stale;
    for (const slug of n.tasks) tasks.add(slug);
  }
  if (own) {
    agg.stale += own.knowledge.stale;
    for (const slug of own.tasks) tasks.add(slug);
  }
  agg.tasks = [...tasks].sort();
  if (hist) agg.history = historyForFiles(hist, files) ?? noHistory();
  return agg;
}

/** Give a node's aggregates a history when nothing upstream did, so the Heat lens always has a number. */
function ensureHistory(node: ViewNode, hist: HistoryIndex | undefined, files?: readonly string[]): void {
  if (!hist || !node.aggregates || node.aggregates.history) return;
  node.aggregates = { ...node.aggregates, history: (files ? historyForFiles(hist, files) : null) ?? noHistory() };
}

// ---------------------------------------------------------------------------
// §6.2 chooseAreas
// ---------------------------------------------------------------------------

interface Candidate {
  node: GraphNode;
  files: string[];
  /** The candidate holds a manifest (`package.json` / `Cargo.toml`) and was promoted. */
  manifest: boolean;
  /** The candidate stands for part of its directory only. */
  residual: boolean;
}

/**
 * The manifest directories that sit *at or under* `dirId`, topmost first and never nested inside
 * one another. Spec §6.2 step 1 promotes manifest-holding children; on a repo whose packages live
 * one level down (`packages/reggie/package.json`) the manifest, not its container, is the area, so
 * the promotion follows the manifest down the tree exactly like `graph.ts`'s `areaFor`.
 */
function topManifestDirs(idx: GraphIndex, dirId: string): string[] {
  const node = idx.nodes.get(dirId);
  if (!node) return [];
  if (node.manifest) return [dirId];
  const out: string[] = [];
  for (const child of idx.dirChildren.get(dirId) ?? []) out.push(...topManifestDirs(idx, child));
  return out;
}

function makeCandidate(idx: GraphIndex, node: GraphNode, files: string[], residual: boolean): Candidate {
  return { node, files, manifest: Boolean(node.manifest), residual };
}

/** A candidate becomes an area node: the directory itself, or a "(other)" residual of it. */
function areaNode(idx: GraphIndex, c: Candidate, hist?: HistoryIndex): ViewNode {
  const node = cloneNode(c.node);
  node.area = node.id;
  if (c.residual) {
    const path = dirPathOf(c.node.id);
    node.residual = true;
    // The repo root has no useful path to name, so the residual borrows the repo's own label.
    node.label = `${path === "." ? c.node.label : path} (other)`;
    node.aggregates = aggregateFiles(idx, c.files, c.node, hist);
    node.lines = node.aggregates.lines;
  } else if (!node.aggregates) {
    node.aggregates = aggregateFiles(idx, c.files, c.node, hist);
  }
  // A whole-directory candidate keeps `graph.ts`'s own roll-up; only a directory git has never
  // seen (and a config pin resolving to one) arrives here without one.
  ensureHistory(node, hist, c.files);
  return node;
}

/**
 * Adaptive area selection (spec §6.2). Counts are source files only.
 *
 * 1. Candidates are the root's child directories; a directory holding a manifest is promoted
 *    (following the manifest down the tree, so `packages/reggie` beats `packages`).
 * 2. A candidate with more than `maxNodes` source files splits one level deeper when the split
 *    yields at least two grandchildren with `minFiles` or more; the rest (small grandchildren plus
 *    the candidate's own files) stays as the candidate, flagged `residual` and labelled "x (other)".
 * 3. A candidate under `minFiles` source files folds: its files join the root's `loose` set.
 * 4. `opts.areas` (`config.yaml`) pins the result for `dir:./`.
 */
export function chooseAreas(g: RepoGraph, rootId: string = ROOT_DIR_ID, opts: ChooseAreasOptions = {}): AreaChoice {
  const idx = indexOf(g);
  const maxNodes = opts.maxNodes ?? MAX_VIEW_NODES;
  const minFiles = opts.minFiles ?? MIN_AREA_FILES;
  const id = dirIdOf(rootId);
  const root = idx.nodes.get(id);
  const empty: AreaChoice = { areas: [], loose: [], files: new Map() };
  if (!root || (root.kind !== "dir" && root.kind !== "repo")) return empty;

  const loose = new Set<string>(idx.ownFiles.get(id) ?? []);

  // --- step 4: config pins ---------------------------------------------------
  if (id === ROOT_DIR_ID && opts.areas && opts.areas.length > 0) {
    const pinned: Candidate[] = [];
    const claimed = new Set<string>();
    for (const raw of opts.areas) {
      const pinId = dirIdOf(raw);
      const node = idx.nodes.get(pinId);
      if (!node || node.kind !== "dir" || pinId === ROOT_DIR_ID) continue;
      const files = filesUnderDir(idx, pinId);
      for (const f of files) claimed.add(f);
      pinned.push(makeCandidate(idx, node, files, false));
    }
    const rest = filesUnderDir(idx, id).filter((f) => !claimed.has(f));
    if (rest.length > 0 && sourceCount(idx, rest) > 0) pinned.push(makeCandidate(idx, root, rest, true));
    else for (const f of rest) loose.add(f);
    return assemble(idx, pinned, loose, opts.history);
  }

  // --- step 1: candidates ----------------------------------------------------
  let candidates: Candidate[] = [];
  for (const childId of idx.dirChildren.get(id) ?? []) {
    const child = idx.nodes.get(childId);
    if (!child) continue;
    const manifests = topManifestDirs(idx, childId);
    if (manifests.length === 0 || (manifests.length === 1 && manifests[0] === childId)) {
      candidates.push(makeCandidate(idx, child, filesUnderDir(idx, childId), false));
      continue;
    }
    const claimed = new Set<string>();
    for (const mId of manifests) {
      const m = idx.nodes.get(mId);
      if (!m) continue;
      const files = filesUnderDir(idx, mId);
      for (const f of files) claimed.add(f);
      candidates.push(makeCandidate(idx, m, files, false));
    }
    const rest = filesUnderDir(idx, childId).filter((f) => !claimed.has(f));
    if (rest.length > 0) candidates.push(makeCandidate(idx, child, rest, true));
  }

  // --- step 2: split one level deeper ----------------------------------------
  const split: Candidate[] = [];
  for (const c of candidates) {
    if (sourceCount(idx, c.files) <= maxNodes) {
      split.push(c);
      continue;
    }
    const own = new Set(c.files);
    const grandchildren: Candidate[] = [];
    for (const gcId of idx.dirChildren.get(c.node.id) ?? []) {
      const gc = idx.nodes.get(gcId);
      if (!gc) continue;
      const files = filesUnderDir(idx, gcId).filter((f) => own.has(f));
      if (files.length === 0) continue;
      grandchildren.push(makeCandidate(idx, gc, files, false));
    }
    const qualifying = grandchildren.filter((gc) => sourceCount(idx, gc.files) >= minFiles);
    if (qualifying.length < 2) {
      split.push(c);
      continue;
    }
    const taken = new Set<string>();
    for (const gc of qualifying) {
      for (const f of gc.files) taken.add(f);
      split.push(gc);
    }
    const rest = c.files.filter((f) => !taken.has(f));
    if (rest.length > 0) split.push(makeCandidate(idx, c.node, rest, true));
  }
  candidates = split;

  // --- step 3: fold the small ones -------------------------------------------
  const kept: Candidate[] = [];
  for (const c of candidates) {
    if (sourceCount(idx, c.files) < minFiles) {
      for (const f of c.files) loose.add(f);
      continue;
    }
    kept.push(c);
  }
  return assemble(idx, kept, loose, opts.history);
}

/** Order (manifests, then plain, then residuals; each by path) and materialise the choice. */
function assemble(idx: GraphIndex, candidates: Candidate[], loose: Set<string>, hist?: HistoryIndex): AreaChoice {
  const rank = (c: Candidate): number => (c.manifest && !c.residual ? 0 : c.residual ? 2 : 1);
  const ordered = [...candidates].sort((a, b) => rank(a) - rank(b) || dirPathOf(a.node.id).localeCompare(dirPathOf(b.node.id)));
  const files = new Map<string, string[]>();
  const areas: ViewNode[] = [];
  for (const c of ordered) {
    areas.push(areaNode(idx, c, hist));
    files.set(c.node.id, [...c.files].sort());
  }
  return { areas, loose: [...loose].sort(), files };
}

// ---------------------------------------------------------------------------
// Level-1 areas: refs, hues, and the file → area map every view needs
// ---------------------------------------------------------------------------

/**
 * Distinct hues for the `AREA_HUE_COUNT` largest areas by source count, 0 ("other") for the rest
 * (spec §6.3, §5.2). The ramp is wider than the palette's original five because `chooseAreas`
 * routinely returns six or seven areas, and every one of them gets a legend row: with a five-hue
 * ramp two visible rows shared the "other" grey and could not be told apart on the canvas.
 */
export function areaRefs(areas: readonly ViewNode[]): AreaRef[] {
  const bySize = [...areas].sort((a, b) => (b.aggregates?.source ?? 0) - (a.aggregates?.source ?? 0) || (b.aggregates?.files ?? 0) - (a.aggregates?.files ?? 0) || a.id.localeCompare(b.id));
  const hue = new Map<string, number>();
  bySize.forEach((n, i) => hue.set(n.id, i < AREA_HUE_COUNT ? i + 1 : 0));
  return areas.map((n) => ({
    id: n.id,
    label: n.residual ? n.label : dirPathOf(n.id),
    hue: hue.get(n.id) ?? 0,
    source: n.aggregates?.source ?? 0,
    files: n.aggregates?.files ?? 0,
  }));
}

export interface Level1 {
  areas: ViewNode[];
  refs: AreaRef[];
  loose: string[];
  /** Level-1 area id for any node id (file, dir or ghost target); null when nothing contains it. */
  areaOf(id: string): string | null;
}

/** The Level-1 area set: `chooseAreas(dir:./)` plus the lookup every other view colours by. */
export function level1(g: RepoGraph, opts: ChooseAreasOptions = {}): Level1 {
  const choice = chooseAreas(g, ROOT_DIR_ID, opts);
  const member = new Map<string, string>();
  for (const [areaId, files] of choice.files) for (const f of files) member.set(f, areaId);
  const paths = choice.areas.map((a) => ({ id: a.id, path: dirPathOf(a.id) })).sort((a, b) => b.path.length - a.path.length);
  const areaOf = (id: string): string | null => {
    const direct = member.get(id);
    if (direct) return direct;
    const p = id.startsWith("dir:") ? dirPathOf(id) : id;
    for (const a of paths) if (isUnder(p, a.path)) return a.id;
    return null;
  };
  return { areas: choice.areas, refs: areaRefs(choice.areas), loose: choice.loose, areaOf };
}

// ---------------------------------------------------------------------------
// Edge aggregation
// ---------------------------------------------------------------------------

interface Bucket {
  source: string;
  target: string;
  kind: EdgeKind;
  weight: number;
  names: Set<string>;
  via: { source: string; target: string; names: string[] }[];
  /** Target file → the distinct source files that import it, for `top` (counted before `via` is cut). */
  perTarget: Map<string, Set<string>>;
  confidence?: "exact" | "heuristic";
  /** Distinct outside files behind a ghost edge, for the "N files used" label. */
  outside: Set<string>;
}

/**
 * `mod` draws as `import`; `ipc` keeps its own channel (spec §6.3). `tests` keeps its own channel
 * only while test files are drawn: with tests hidden, a test file's import is still an import of
 * the target area, so it counts into the aggregated `import` weight rather than disappearing
 * (acceptance 2 wants no test *edge* drawn, 3 and 7 want the weight that includes them).
 */
function viewKind(kind: EdgeKind, foldTests = false): EdgeKind {
  if (kind === "mod") return "import";
  if (kind === "tests" && foldTests) return "import";
  return kind;
}

/** The most-imported file behind an aggregate, counted in distinct importing files (spec §6.3). */
function topTarget(b: Bucket): EdgeTop | null {
  let best: EdgeTop | null = null;
  for (const [path, importers] of b.perTarget) {
    const files = importers.size;
    if (!best || files > best.files || (files === best.files && path.localeCompare(best.path) < 0)) best = { path, files };
  }
  return best;
}

class EdgeAggregator {
  private readonly buckets = new Map<string, Bucket>();
  /** Count `tests` edges into the `import` bucket instead of giving them their own. */
  private readonly foldTests: boolean;

  constructor(foldTests = false) {
    this.foldTests = foldTests;
  }

  add(source: string, target: string, edge: GraphEdge, outsideFile?: string): void {
    if (source === target) return;
    const kind = viewKind(edge.kind, this.foldTests);
    const key = `${source}>${target}>${kind}`;
    let b = this.buckets.get(key);
    if (!b) {
      b = { source, target, kind, weight: 0, names: new Set(), via: [], perTarget: new Map(), outside: new Set() };
      if (edge.confidence) b.confidence = edge.confidence;
      this.buckets.set(key, b);
    }
    b.weight += 1;
    for (const n of edge.names ?? []) b.names.add(n);
    b.via.push({ source: edge.source, target: edge.target, names: [...(edge.names ?? [])] });
    const importers = b.perTarget.get(edge.target) ?? new Set<string>();
    importers.add(edge.source);
    b.perTarget.set(edge.target, importers);
    if (outsideFile) b.outside.add(outsideFile);
  }

  /** `namesOn`: which kinds keep a `names` list on the aggregated edge. */
  edges(opts: { namesOn?: (b: Bucket) => boolean; maxNames?: number } = {}): ViewEdge[] {
    const maxNames = opts.maxNames ?? MAX_EDGE_NAMES;
    const out: ViewEdge[] = [];
    for (const b of this.buckets.values()) {
      const edge: ViewEdge = { source: b.source, target: b.target, kind: b.kind };
      if (b.weight > 1) edge.weight = b.weight;
      const wantNames = opts.namesOn ? opts.namesOn(b) : true;
      if (wantNames && b.names.size > 0) {
        const names = [...b.names];
        edge.names = b.weight > 1 ? names.slice(0, maxNames) : names;
      }
      if (b.weight > 1) {
        edge.via = [...b.via].sort((x, y) => y.names.length - x.names.length || x.source.localeCompare(y.source)).slice(0, MAX_VIA);
        const top = topTarget(b);
        if (top) {
          edge.top = top;
          edge.mostly = { ...top };
        }
      }
      if (b.confidence) edge.confidence = b.confidence;
      out.push(edge);
    }
    out.sort((a, b) => a.source.localeCompare(b.source) || a.target.localeCompare(b.target) || a.kind.localeCompare(b.kind));
    return out;
  }

  outsideCount(source: string, target: string, kind: EdgeKind): number {
    return this.buckets.get(`${source}>${target}>${viewKind(kind, this.foldTests)}`)?.outside.size ?? 0;
  }
}

/** SCCs of size ≥ 2 among the view's own nodes, with `cycle: true` written onto the edges in one. */
function markCycles(nodeIds: readonly string[], edges: GraphEdge[]): string[][] {
  const structural = edges.filter((e) => STRUCTURE_KINDS.has(e.kind));
  const cycles = findCycles(nodeIds, structural);
  const sccOf = new Map<string, number>();
  cycles.forEach((c, i) => c.forEach((id) => sccOf.set(id, i)));
  for (const e of structural) {
    const a = sccOf.get(e.source);
    if (a !== undefined && a === sccOf.get(e.target)) e.cycle = true;
  }
  return cycles;
}

const ALL_KINDS: ReadonlySet<EdgeKind> = new Set<EdgeKind>(["import", "mod", "ipc", "tests"]);

/**
 * Which edge kinds a view walks. `tests` is always walked at aggregating levels — with the toggle
 * off it folds into `import` weight rather than being dropped — but the explorer keeps excluding
 * it, because there the test file itself would have to be drawn as a node.
 */
function allowedKinds(tests: boolean): ReadonlySet<EdgeKind> {
  return tests ? ALL_KINDS : STRUCTURE_KINDS;
}

// ---------------------------------------------------------------------------
// §6.3 containerView
// ---------------------------------------------------------------------------

/** Level 1: the areas of the repo and the traffic between them. */
export function containerView(g: RepoGraph, opts: ChooseAreasOptions = {}): ViewGraph {
  const idx = indexOf(g);
  const l1 = level1(g, opts);
  const nodes = l1.areas.map((a) => {
    const n = cloneNode(a);
    n.parent = n.id === ROOT_DIR_ID ? null : ROOT_DIR_ID;
    n.area = n.id;
    return n;
  });
  const drawable = new Set(nodes.map((n) => n.id));

  // Tests fold into the import weight: the container level never draws a test node or a test edge.
  const agg = new EdgeAggregator(true);
  for (const e of g.edges) {
    if (!ALL_KINDS.has(e.kind)) continue;
    if (idx.nodes.get(e.source)?.kind !== "file" || idx.nodes.get(e.target)?.kind !== "file") continue;
    const a = l1.areaOf(e.source);
    const b = l1.areaOf(e.target);
    if (!a || !b || a === b || !drawable.has(a) || !drawable.has(b)) continue;
    agg.add(a, b, e);
  }
  // Only IPC keeps its names: the client labels those edges "IPC · <distinct commands>".
  const edges = agg.edges({ namesOn: (b) => b.kind === "ipc", maxNames: Number.MAX_SAFE_INTEGER });
  const cycles = markCycles([...drawable], edges);

  return {
    level: "container",
    root: ROOT_DIR_ID,
    nodes,
    edges,
    areas: l1.refs,
    cycles,
    counts: { totalCodeFiles: g.totalCodeFiles, shown: nodes.length, folded: 0, hiddenTests: idx.testFiles.length, skipped: g.skipped, unresolved: g.unresolved },
    generatedAt: g.generatedAt,
  };
}

// ---------------------------------------------------------------------------
// §6.3 dirView
// ---------------------------------------------------------------------------

export interface DirViewOptions extends ChooseAreasOptions {
  /** Draw test and fixture files and their `tests` edges. Default false. */
  tests?: boolean;
  /** Skip the `fold:` node and draw every child, however many there are. Default false. */
  all?: boolean;
}

/**
 * Level 2: one directory as a compound of its sub-areas and loose files, with ghost nodes
 * standing in for the areas outside it (spec §6.3). Returns null when `root` is not a directory
 * in this graph, which `serve.ts` turns into a 404.
 */
export function dirView(g: RepoGraph, root: string, opts: DirViewOptions = {}): ViewGraph | null {
  const idx = indexOf(g);
  const rootId = resolveDirId(g, root);
  if (!rootId) return null;
  const rootNode = idx.nodes.get(rootId);
  if (!rootNode) return null;
  const maxNodes = opts.maxNodes ?? MAX_VIEW_NODES;
  const tests = opts.tests === true;
  const l1 = level1(g, opts);
  const choice = chooseAreas(g, rootId, opts);

  // --- children: sub-areas plus loose files ----------------------------------
  const subAreas = choice.areas.map((a) => {
    const n = cloneNode(a);
    n.parent = rootId;
    n.area = l1.areaOf(a.id) ?? a.area;
    return n;
  });
  const subtree = filesUnderDir(idx, rootId);
  const inside = new Set(subtree);
  const hiddenTests = tests ? 0 : subtree.filter((f) => isTestLike(idx.nodes.get(f)?.role ?? "source")).length;

  const looseAll = choice.loose.filter((f) => tests || !isTestLike(idx.nodes.get(f)?.role ?? "source"));
  const byFanIn = [...looseAll].sort((a, b) => {
    const x = idx.nodes.get(a);
    const y = idx.nodes.get(b);
    return (y?.inDegree ?? 0) - (x?.inDegree ?? 0) || (y?.outDegree ?? 0) - (x?.outDegree ?? 0) || a.localeCompare(b);
  });
  const room = Math.max(0, maxNodes - subAreas.length);
  const keepLoose = opts.all === true ? byFanIn : byFanIn.slice(0, room);
  const foldedIds = opts.all === true ? [] : byFanIn.slice(room);

  const nodes: ViewNode[] = [...subAreas];
  for (const f of keepLoose) {
    const n = idx.nodes.get(f);
    if (!n) continue;
    const c = cloneNode(n);
    c.area = l1.areaOf(f) ?? c.area;
    // A drawable file the Heat lens can read: `graph.ts` leaves `history` off a file git has never
    // seen, and an absent field is indistinguishable from a cold one on the wire.
    if (opts.history && !c.history) c.history = noHistory();
    nodes.push(c);
  }
  const foldId = `fold:${rootId}:loose`;
  if (foldedIds.length > 0) {
    const fold = foldNode(foldId, `+${foldedIds.length} more`, dirPathOf(rootId), foldedIds, rootId, l1.areaOf(rootId));
    fold.parent = rootId;
    nodes.push(fold);
  }

  // --- where does a file draw? ------------------------------------------------
  const drawableOf = new Map<string, string>();
  for (const a of subAreas) for (const f of choice.files.get(a.id) ?? []) drawableOf.set(f, a.id);
  for (const f of keepLoose) drawableOf.set(f, f);
  for (const f of foldedIds) drawableOf.set(f, foldId);

  // With tests hidden their edges still count towards the aggregated import weights (see viewKind).
  const kinds = ALL_KINDS;
  const intra = new EdgeAggregator(!tests);
  const ghostEdges = new EdgeAggregator(!tests);
  const ghostSides = new Map<string, { base: string; side: "up" | "down"; files: Set<string> }>();
  const ghostBase = ghostResolver(g, idx, l1, rootId, opts);

  for (const e of g.edges) {
    if (!kinds.has(e.kind)) continue;
    const s = idx.nodes.get(e.source);
    const t = idx.nodes.get(e.target);
    if (s?.kind !== "file" || t?.kind !== "file") continue;
    const sIn = inside.has(e.source);
    const tIn = inside.has(e.target);
    if (sIn && tIn) {
      const a = drawableOf.get(e.source);
      const b = drawableOf.get(e.target);
      if (!a || !b) continue;
      intra.add(a, b, e);
      continue;
    }
    if (!sIn && !tIn) continue;
    const outsideFile = sIn ? e.target : e.source;
    if (!tests && isTestLike(idx.nodes.get(outsideFile)?.role ?? "source")) continue;
    const insideDrawable = drawableOf.get(sIn ? e.source : e.target);
    if (!insideDrawable) continue;
    const base = ghostBase(outsideFile);
    if (!base) continue;
    // `sIn` means a child imports the outside file: the ghost is downstream, drawn below.
    const side: "up" | "down" = sIn ? "down" : "up";
    const ghostId = `ghost:${side}:${base}`;
    const rec = ghostSides.get(ghostId) ?? { base, side, files: new Set<string>() };
    rec.files.add(outsideFile);
    ghostSides.set(ghostId, rec);
    if (side === "down") ghostEdges.add(insideDrawable, ghostId, e, outsideFile);
    else ghostEdges.add(ghostId, insideDrawable, e, outsideFile);
  }

  const refLabel = new Map(l1.refs.map((r) => [r.id, r.label]));
  for (const [ghostId, rec] of [...ghostSides].sort((a, b) => a[0].localeCompare(b[0]))) {
    const baseNode = idx.nodes.get(rec.base);
    const path = dirPathOf(rec.base);
    const shownName = refLabel.get(rec.base) ?? path;
    const ghost: ViewNode = baseNode
      ? cloneNode(baseNode)
      : {
          id: ghostId,
          kind: "dir",
          label: path,
          path,
          parent: null,
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
          dir: path,
          noteCount: 0,
          dirNoteCount: 0,
        };
    ghost.id = ghostId;
    ghost.ghost = true;
    ghost.side = rec.side;
    ghost.parent = null;
    ghost.path = path;
    ghost.area = l1.areaOf(rec.base) ?? rec.base;
    ghost.label = `${shownName} · ${rec.files.size} ${rec.files.size === 1 ? "file" : "files"} used`;
    ensureHistory(ghost, opts.history, [...rec.files]);
    nodes.push(ghost);
  }

  const edges = [...intra.edges(), ...ghostEdges.edges()];
  const drawableIds = [...subAreas.map((n) => n.id), ...keepLoose];
  const cycles = markCycles(drawableIds, edges);

  return {
    level: "dir",
    root: rootId,
    nodes,
    edges,
    areas: l1.refs,
    cycles,
    counts: { totalCodeFiles: g.totalCodeFiles, shown: drawableIds.length, folded: foldedIds.length, hiddenTests, skipped: g.skipped, unresolved: g.unresolved },
    generatedAt: g.generatedAt,
  };
}

/**
 * The ghost rule (spec §6.3): a neighbour file outside `root` is represented by the Level-1 area
 * that holds it when that differs from the Level-1 area holding `root`; otherwise by the sibling
 * of `root` (per `chooseAreas(root.parent)`) that holds it, or by `root.parent` itself when the
 * file is loose there.
 */
function ghostResolver(g: RepoGraph, idx: GraphIndex, l1: Level1, rootId: string, opts: ChooseAreasOptions): (fileId: string) => string | null {
  const rootArea = l1.areaOf(rootId);
  const rootNode = idx.nodes.get(rootId);
  const parentId = rootNode?.parent && rootNode.parent.startsWith("dir:") ? rootNode.parent : null;
  let siblings: AreaChoice | null = null;
  const cache = new Map<string, string | null>();
  return (fileId: string): string | null => {
    const hit = cache.get(fileId);
    if (hit !== undefined) return hit;
    let base: string | null = null;
    const area = l1.areaOf(fileId);
    if (area && area !== rootArea) base = area;
    else if (parentId) {
      if (!siblings) siblings = chooseAreas(g, parentId, opts);
      for (const [areaId, files] of siblings.files) {
        if (areaId !== rootId && files.includes(fileId)) {
          base = areaId;
          break;
        }
      }
      if (!base && siblings.loose.includes(fileId)) base = parentId;
      if (!base) base = area ?? parentId;
    } else base = area;
    if (base === rootId) base = parentId ?? area;
    cache.set(fileId, base);
    return base;
  };
}

function foldNode(id: string, label: string, path: string, ids: string[], parent: string | null, area: string | null): ViewNode {
  return {
    id,
    kind: "fold",
    label,
    path,
    parent,
    lang: "",
    lines: 0,
    role: "source",
    area,
    knowledge: emptyKnowledge(),
    tasks: [],
    inDegree: 0,
    outDegree: 0,
    testedBy: [],
    entry: false,
    entryKinds: [],
    foldCount: ids.length,
    foldIds: [...ids],
    dir: path,
    noteCount: 0,
    dirNoteCount: 0,
  };
}

// ---------------------------------------------------------------------------
// §6.3 impactView
// ---------------------------------------------------------------------------

export interface ImpactOptions extends ChooseAreasOptions {
  /** 1–3 hops (contract). Out-of-range values are clamped. */
  depth?: number;
  direction?: "both" | "up" | "down";
  tests?: boolean;
}

type Side = "up" | "down";

/**
 * Level 3: what one file (or a task's file set) reaches and is reached by. A single BFS per centre
 * over `import|mod|ipc` (plus `tests` when the toggle is on); nodes carry `side` and `hop`, hops
 * past the drawable budget fold by Level-1 area, and a node reached from more than one centre
 * carries `collision`.
 */
export function impactView(g: RepoGraph, ids: readonly string[], opts: ImpactOptions = {}): ViewGraph {
  const idx = indexOf(g);
  const maxNodes = opts.maxNodes ?? MAX_VIEW_NODES;
  const depth = Math.max(1, Math.min(3, Math.round(opts.depth ?? 1)));
  const direction = opts.direction ?? "both";
  const tests = opts.tests === true;
  const l1 = level1(g, opts);

  const centers: string[] = [];
  for (const raw of ids) {
    const id = raw.includes("::") ? (raw.split("::")[0] ?? raw) : raw;
    const n = idx.nodes.get(id);
    if (n?.kind === "file" && !centers.includes(id)) centers.push(id);
  }

  const kinds = allowedKinds(tests);
  const visible = (id: string): boolean => {
    const n = idx.nodes.get(id);
    if (!n || n.kind !== "file") return false;
    return tests || !isTestLike(n.role);
  };
  const succ = new Map<string, string[]>();
  const pred = new Map<string, string[]>();
  const traversable: GraphEdge[] = [];
  for (const e of g.edges) {
    if (!kinds.has(e.kind)) continue;
    if (!visible(e.source) || !visible(e.target) || e.source === e.target) continue;
    traversable.push(e);
    const out = succ.get(e.source) ?? [];
    out.push(e.target);
    succ.set(e.source, out);
    const into = pred.get(e.target) ?? [];
    into.push(e.source);
    pred.set(e.target, into);
  }

  const centerSet = new Set(centers);
  const hops: Record<Side, Map<string, number>> = { up: new Map(), down: new Map() };
  const origins = new Map<string, Set<string>>();
  const wantUp = direction === "both" || direction === "up";
  const wantDown = direction === "both" || direction === "down";

  const walk = (start: string, side: Side): void => {
    const adj = side === "up" ? pred : succ;
    const seen = new Set<string>([start]);
    let frontier = [start];
    for (let hop = 1; hop <= depth; hop += 1) {
      const next: string[] = [];
      for (const id of frontier) {
        for (const n of adj.get(id) ?? []) {
          if (seen.has(n)) continue;
          seen.add(n);
          next.push(n);
          if (centerSet.has(n)) continue;
          const prev = hops[side].get(n);
          if (prev === undefined || hop < prev) hops[side].set(n, hop);
          const o = origins.get(n) ?? new Set<string>();
          o.add(start);
          origins.set(n, o);
        }
      }
      frontier = next;
      if (frontier.length === 0) break;
    }
  };
  for (const c of centers) {
    if (wantUp) walk(c, "up");
    if (wantDown) walk(c, "down");
  }

  const countsUp: number[] = [];
  const countsDown: number[] = [];
  for (let hop = 1; hop <= depth; hop += 1) {
    countsUp.push([...hops.up.values()].filter((h) => h === hop).length);
    countsDown.push([...hops.down.values()].filter((h) => h === hop).length);
  }

  // --- pick what fits, fold the rest by area ---------------------------------
  const degree = (id: string): number => {
    const n = idx.nodes.get(id);
    return (n?.inDegree ?? 0) + (n?.outDegree ?? 0);
  };
  const assigned = new Map<string, { side: Side; hop: number }>();
  for (const side of ["up", "down"] as Side[]) {
    for (const [id, hop] of hops[side]) {
      const prev = assigned.get(id);
      if (!prev || hop < prev.hop) assigned.set(id, { side, hop });
    }
  }
  const shown: string[] = [];
  const foldGroups = new Map<string, { side: Side; hop: number; area: string | null; ids: string[] }>();
  let budget = Math.max(0, maxNodes - centers.length);
  for (let hop = 1; hop <= depth; hop += 1) {
    for (const side of ["up", "down"] as Side[]) {
      const list = [...assigned].filter(([, a]) => a.side === side && a.hop === hop).map(([id]) => id);
      list.sort((a, b) => degree(b) - degree(a) || a.localeCompare(b));
      const cap = Math.min(maxNodes, budget);
      for (const id of list.slice(0, cap)) shown.push(id);
      budget = Math.max(0, budget - Math.min(cap, list.length));
      for (const id of list.slice(cap)) {
        const area = l1.areaOf(id);
        const key = `${side}:${area ?? "other"}`;
        const grp = foldGroups.get(key) ?? { side, hop, area, ids: [] };
        grp.hop = Math.min(grp.hop, hop);
        grp.ids.push(id);
        foldGroups.set(key, grp);
      }
    }
  }

  const nodes: ViewNode[] = [];
  const placeOf = new Map<string, string>();
  for (const id of centers) {
    const n = idx.nodes.get(id);
    if (!n) continue;
    const c = cloneNode(n);
    c.center = true;
    c.hop = 0;
    c.area = l1.areaOf(id) ?? c.area;
    nodes.push(c);
    placeOf.set(id, id);
  }
  for (const id of shown) {
    const n = idx.nodes.get(id);
    if (!n) continue;
    const c = cloneNode(n);
    const up = hops.up.get(id);
    const down = hops.down.get(id);
    c.side = up !== undefined && down !== undefined ? "both" : up !== undefined ? "up" : "down";
    c.hop = Math.min(up ?? Number.MAX_SAFE_INTEGER, down ?? Number.MAX_SAFE_INTEGER);
    c.area = l1.areaOf(id) ?? c.area;
    const from = origins.get(id);
    if (from && from.size > 1) c.collision = [...from].sort();
    nodes.push(c);
    placeOf.set(id, id);
  }
  for (const [, grp] of [...foldGroups].sort((a, b) => a[0].localeCompare(b[0]))) {
    const label = grp.area ? `+${grp.ids.length} more in ${dirPathOf(grp.area)}` : `+${grp.ids.length} more`;
    const id = `fold:${grp.side}:${grp.area ?? "other"}`;
    const fold = foldNode(id, label, grp.area ? dirPathOf(grp.area) : "", grp.ids, null, grp.area);
    fold.side = grp.side;
    fold.hop = grp.hop;
    nodes.push(fold);
    for (const member of grp.ids) placeOf.set(member, id);
  }

  const agg = new EdgeAggregator();
  for (const e of traversable) {
    const s = placeOf.get(e.source);
    const t = placeOf.get(e.target);
    if (!s || !t || s === t) continue;
    agg.add(s, t, e);
  }
  const edges = agg.edges();
  const drawableIds = [...centers, ...shown];
  const cycles = markCycles(drawableIds, edges);

  let hiddenTests = 0;
  if (!tests) {
    const drawn = new Set(drawableIds);
    const seen = new Set<string>();
    for (const e of g.edges) {
      if (e.kind !== "tests" && !STRUCTURE_KINDS.has(e.kind)) continue;
      for (const [a, b] of [
        [e.source, e.target],
        [e.target, e.source],
      ] as const) {
        if (!drawn.has(b) || seen.has(a)) continue;
        const n = idx.nodes.get(a);
        if (n?.kind === "file" && isTestLike(n.role) && !drawn.has(a)) {
          seen.add(a);
          hiddenTests += 1;
        }
      }
    }
  }

  const counts: ViewCounts = {
    totalCodeFiles: g.totalCodeFiles,
    shown: drawableIds.length,
    folded: [...foldGroups.values()].reduce((s, grp) => s + grp.ids.length, 0),
    hiddenTests,
    skipped: g.skipped,
    unresolved: g.unresolved,
  };
  if (wantUp) counts.up = countsUp;
  if (wantDown) counts.down = countsDown;

  const view: ViewGraph = {
    level: "impact",
    root: centers[0] ?? "",
    nodes,
    edges,
    areas: l1.refs,
    cycles,
    counts,
    generatedAt: g.generatedAt,
  };
  if (centers.length === 1 && centers[0]) view.center = centers[0];
  else if (centers.length > 1) view.centers = [...centers];
  return view;
}
