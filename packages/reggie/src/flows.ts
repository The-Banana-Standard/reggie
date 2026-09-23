/**
 * Data flow detection (services-and-flows-spec.md §2).
 *
 * `detectFlows` finds every entry point where data enters the repo — a Cloudflare
 * handler, an Express/Hono route, a Next route handler or page, a CLI command, an
 * MCP tool — and `traceFlow` walks one of them through call and import edges to its
 * sinks, extracting **what is actually passed at every step**.
 *
 * The TypeScript compiler supplies symbols, direct call bindings, actual argument
 * expressions, return variants, and recursive value shapes across JS/JSX/TS/TSX.
 * The original `Payload` fields remain as a temporary reader compatibility layer;
 * new consumers should use `arguments`, `requestPayload`, `servicePayload`, and
 * `returns`, which never turn parameter names into invented object payloads.
 *
 * The small masked-code scanners remain only for service binding detection and the
 * legacy payload fields while those older readers migrate to the semantic records.
 */

import path from "node:path";
import { readFileSync } from "node:fs";
import type { RepoGraph } from "./graph.js";
import type { RepoPaths } from "./paths.js";
import { extractSymbols, maskCode, symbolLang, type CodeSymbol, type Confidence } from "./symbols.js";
import { isTestLike } from "./roles.js";
import type { ServiceNode, SourceRef } from "./services.js";
import {
  buildSemanticIndex,
  semanticSymbolId,
  type ArgumentValue,
  type CallSite as SemanticCallSite,
  type ReturnVariant,
  type SemanticIndex,
  type SymbolRecord,
  type ValueShape,
} from "./semantic-index.js";
import { nowIso } from "./util.js";

// ---------------------------------------------------------------------------
// Contract types (spec §2)
// ---------------------------------------------------------------------------

/** A file and 1-based line. Owned by services.ts (§1); re-exported so callers need one import. */
export type { SourceRef };

/**
 * What moves along one step. `fields` are the names actually found; `shape` names the
 * construct they came from (`request.json()`, `object literal`, `interface ChatInput`,
 * `parameters`), so the UI can explain itself. A `null` payload means not derivable —
 * never a guess.
 */
export interface Payload {
  fields: string[];
  shape: string | null;
  confidence: Confidence;
  source: SourceRef | null;
}

export type FlowStepKind = "call" | "import" | "read" | "write" | "respond";

export interface FlowStep {
  from: string;
  to: string;
  kind: FlowStepKind;
  label: string;
  input: Payload | null;
  output: Payload | null;
  /** Actual positional arguments and expressions from the call site. */
  arguments: ArgumentValue[];
  /** Boundary request body shape, separate from ordinary function arguments. */
  requestPayload: ValueShape | null;
  /** Boundary/service message shape, separate from ordinary function arguments. */
  servicePayload: ValueShape | null;
  /** Every source-backed return branch on the called symbol or response step. */
  returns: ReturnVariant[];
  source: SourceRef;
  /**
   * Additive to the spec: how sure the *step* is, which `Payload.confidence` does not say.
   * `heuristic` when the service was resolved through a name rather than a declaration —
   * a method-guessed binding, or a binding that arrived as a parameter (`via`).
   */
  confidence: Confidence;
  /**
   * Additive: the local name the service arrived under when it was passed in as a parameter
   * (`db` for a call site that passed `env.CHAT_LOGS`). `null` for every other step.
   */
  via: string | null;
}

/**
 * Additive to the spec: what a cap actually cost, so `truncated` can say *what* is missing
 * instead of only that something is. One entry per (hop, reason).
 *
 * `hop` is the distance from the entry: the entry's own calls are hop 1. `count` is steps
 * dropped, except for `depth`, where it counts calls that were never expanded.
 */
export interface FlowDrop {
  hop: number;
  count: number;
  reason: "hop-budget" | "step-cap" | "depth";
}

export interface Flow {
  id: string;
  entry: string;
  title: string;
  method: string | null;
  route: string | null;
  steps: FlowStep[];
  /** Services the returned steps actually reach. Never includes one a cap hid. */
  services: string[];
  /**
   * Services the walk saw but no returned step reaches, because a cap dropped the step that
   * would have shown them. Empty when nothing was dropped. Kept separate so the page can say
   * "this flow also reaches X, beyond what is drawn" instead of implying X is on the picture.
   */
  servicesBeyondCap: string[];
  depth: number;
  truncated: boolean;
  /** Additive: what `truncated` is about. Empty exactly when `truncated` is false. */
  dropped: FlowDrop[];
}

/** Where an entry point came from, so the index can group them (spec §4). */
export type FlowEntryKind = "cloudflare" | "http-route" | "next-route" | "next-page" | "cli" | "mcp" | "main";

export interface FlowEntry {
  /** URL-safe id, also the id of the flow traced from it. */
  id: string;
  /** Node id of the handler symbol: `sym:<file>::<qualified-name>`. */
  node: string;
  file: string;
  symbol: string;
  kind: FlowEntryKind;
  title: string;
  method: string | null;
  route: string | null;
  /** How the route and method were derived: `exact` from a literal, `heuristic` from a path or a name. */
  confidence: Confidence;
  source: SourceRef;
}

export interface FlowSummary {
  id: string;
  entry: string;
  title: string;
  kind: FlowEntryKind;
  method: string | null;
  route: string | null;
  steps: number;
  services: string[];
  depth: number;
  truncated: boolean;
  /** Additive: what `truncated` is about, same shape as on `Flow`. */
  dropped: FlowDrop[];
  source: SourceRef;
}

export interface FlowIndex {
  entries: FlowEntry[];
  flows: FlowSummary[];
  generatedAt: string;
}

/**
 * What tracing needs of a §1 service: enough to resolve `env.X` to a declared id and
 * kind. `ServiceNode` from services.ts satisfies it, so `detectServices(...).services`
 * can be passed straight through; a bare literal works in a test.
 */
export interface ServiceRef {
  id: string;
  kind: string;
  binding: string | null;
  name: string;
}

export interface TraceOptions {
  /** Hop cap; default and hard ceiling `MAX_FLOW_HOPS`. */
  depth?: number;
  /** Step cap; default and hard ceiling `MAX_FLOW_STEPS`. */
  maxSteps?: number;
  /** Declared services from §1 (`detectServices(...).services`). When present, a binding resolves to its declared id and kind instead of being guessed from the method. */
  services?: readonly ServiceRef[] | readonly ServiceNode[];
  /** Pre-read file contents, repo-relative → text. Saves re-reading when the caller already has them. */
  contents?: ReadonlyMap<string, string>;
  /** Repository-wide compiler model supplied by a host cache. */
  semanticIndex?: SemanticIndex;
}

export interface DetectFlowsOptions extends TraceOptions {
  /** Trace every entry to fill in step counts and reached services. Default true. */
  trace?: boolean;
}

// ---------------------------------------------------------------------------
// Caps (spec §2, revised — see the deviation note in services-and-flows-spec.md §2)
// ---------------------------------------------------------------------------

/**
 * Total steps in one flow. The spec's 60 was a *flat* cap, and a flat cap is spent by the
 * widest hop: the ground-truth `onRequestPost` makes 43 distinct calls, so hop 1 alone ate
 * the budget and hop 2 could never be reached — the flow was confidently shallow, which is
 * the failure mode the spec's own preamble warns about. The total is generous now and the
 * real limit is per hop (`hopBudget`), so depth is never starved by breadth.
 */
export const MAX_FLOW_STEPS = 200;
export const MAX_FLOW_HOPS = 6;
/** Steps every hop within the depth limit can always draw, however small the total budget is. */
export const MIN_HOP_STEPS = 6;

/**
 * Steps allowed at each hop: the total shared out over the hops, never below `MIN_HOP_STEPS`.
 * The entry step is outside the share, so hop 1 keeps its whole slice.
 *
 * With the defaults that is 33 steps a hop over six hops — wide enough to draw a fat handler,
 * narrow enough that the handler cannot eat hop 2. The total still applies on top, so a caller
 * asking for `maxSteps: 3` gets three steps, not `MIN_HOP_STEPS` per hop.
 */
export function hopBudget(maxSteps: number, maxHops: number): number {
  return Math.max(MIN_HOP_STEPS, Math.floor(Math.max(0, maxSteps - 1) / Math.max(1, maxHops)));
}

// ---------------------------------------------------------------------------
// Small scanners over masked code
// ---------------------------------------------------------------------------

const IDENT_RE = /[A-Za-z_$][\w$]*/y;

/** Offsets where each line starts, so an offset maps to a 1-based line. */
function lineStarts(text: string): number[] {
  const starts = [0];
  for (let i = 0; i < text.length; i += 1) if (text.charCodeAt(i) === 10) starts.push(i + 1);
  return starts;
}

function lineAt(starts: readonly number[], offset: number): number {
  let lo = 0;
  let hi = starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if ((starts[mid] ?? 0) <= offset) lo = mid;
    else hi = mid - 1;
  }
  return lo + 1;
}

const CLOSERS: Record<string, string> = { "(": ")", "[": "]", "{": "}" };

/**
 * Index of the delimiter closing the one at `open` in masked text, or -1. Masked input
 * is required: a brace inside a string or comment would otherwise unbalance the count.
 */
export function matchDelim(masked: string, open: number): number {
  const close = CLOSERS[masked.charAt(open)];
  if (!close) return -1;
  const openCh = masked.charAt(open);
  let depth = 0;
  for (let i = open; i < masked.length; i += 1) {
    const ch = masked.charAt(i);
    if (ch === openCh) depth += 1;
    else if (ch === close) {
      depth -= 1;
      if (depth === 0) return i;
    } else if (ch === "(" || ch === "[" || ch === "{") {
      const skip = matchDelim(masked, i);
      if (skip === -1) return -1;
      i = skip;
    }
  }
  return -1;
}

/**
 * Top-level comma-separated spans in `masked[from, to)`, as `[start, end)` offsets.
 *
 * Every span is returned, including ones that are blank in masked text: a string
 * argument is blanked by `maskCode` but is still an argument, so dropping it here would
 * shift every later index. Callers skip what they cannot use.
 */
export function splitArgs(masked: string, from: number, to: number): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  let start = from;
  let depth = 0;
  for (let i = from; i < to; i += 1) {
    const ch = masked.charAt(i);
    if (ch === "(" || ch === "[" || ch === "{") depth += 1;
    else if (ch === ")" || ch === "]" || ch === "}") depth -= 1;
    else if (ch === "," && depth === 0) {
      out.push([start, i]);
      start = i + 1;
    }
  }
  if (start < to) out.push([start, to]);
  return out;
}

/** First non-space offset at or after `at`, capped at the text length. */
function skipSpace(masked: string, at: number): number {
  let i = at;
  while (i < masked.length && /\s/.test(masked.charAt(i))) i += 1;
  return i;
}

/**
 * The string literal starting at or after `at` in the ORIGINAL text, or null. Callers
 * locate the position structurally in masked text (where the literal is blanked) and
 * read the value here, so a literal inside a comment can never be picked up.
 */
export function readStringLiteral(src: string, at: number): string | null {
  let i = at;
  while (i < src.length && /\s/.test(src.charAt(i))) i += 1;
  const q = src.charAt(i);
  if (q !== '"' && q !== "'" && q !== "`") return null;
  let out = "";
  for (let j = i + 1; j < src.length; j += 1) {
    const ch = src.charAt(j);
    if (ch === "\\") {
      out += src.charAt(j + 1);
      j += 1;
      continue;
    }
    if (ch === q) return out;
    if (ch === "\n" && q !== "`") return null;
    // A template with an interpolation is not a literal route or host prefix.
    if (q === "`" && ch === "$" && src.charAt(j + 1) === "{") return null;
    out += ch;
  }
  return null;
}

const IDENT_ONLY = /^[A-Za-z_$][\w$]*$/;

/** First non-whitespace offset of `src[from, to)`, or -1. Uses the original, not masked. */
function firstNonSpace(src: string, from: number, to: number): number {
  for (let i = from; i < to; i += 1) if (!/\s/.test(src.charAt(i))) return i;
  return -1;
}

/**
 * Field names of an object literal spanning `[from, to)`. Structure is read from masked
 * text; quoted keys are recovered from the original. Spreads are reported through
 * `spread` rather than invented as fields, and computed keys are dropped.
 */
export function objectLiteralKeys(masked: string, src: string, from: number, to: number): { keys: string[]; spread: boolean } | null {
  const open = skipSpace(masked, from);
  if (masked.charAt(open) !== "{") return null;
  const close = matchDelim(masked, open);
  if (close === -1 || close > to) return null;
  const keys: string[] = [];
  let spread = false;
  for (const [s, e] of splitArgs(masked, open + 1, close)) {
    const at = firstNonSpace(src, s, e);
    if (at === -1) continue; // whitespace only in the original: a trailing comma
    const entry = masked.slice(s, e).trim();
    if (entry.startsWith("...")) {
      spread = true;
      continue;
    }
    if (entry.startsWith("[")) continue; // a computed key names nothing
    const head = entry.split(/[:(=]/)[0]?.trim() ?? "";
    const name = head.replace(/^(?:async\s+|get\s+|set\s+|\*\s*)+/, "").trim();
    if (IDENT_ONLY.test(name)) {
      keys.push(name);
      continue;
    }
    // Not an identifier: a quoted key, blank in masked but present in the original.
    const lit = readStringLiteral(src, at);
    if (lit) keys.push(lit);
  }
  return { keys: Array.from(new Set(keys)), spread };
}

// ---------------------------------------------------------------------------
// Per-file scan
// ---------------------------------------------------------------------------

/** Internal: one file's text, its masked twin, its symbols and its import bindings. */
export interface FileInfo {
  file: string;
  src: string;
  masked: string;
  starts: number[];
  symbols: CodeSymbol[];
  /** Local binding name → repo-relative file it was imported from. */
  imports: Map<string, string>;
  /** Symbol offsets, so a symbol's declaration can be re-read. */
  declOffset: Map<string, number>;
}

/** Does the root `package.json` depend on Next? `pages/` means nothing without it. */
function hasNextDependency(root: string): boolean {
  let raw = "";
  try {
    raw = readFileSync(path.join(root, "package.json"), "utf8");
  } catch {
    return false;
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return false;
    const pkg = parsed as { dependencies?: Record<string, unknown>; devDependencies?: Record<string, unknown> };
    return Boolean(pkg.dependencies?.["next"] ?? pkg.devDependencies?.["next"]);
  } catch {
    return false;
  }
}

/** Repo-relative path with backslashes and a leading `./` normalized away. */
function normalizePath(p: string): string {
  let out = p.replace(/\\/g, "/");
  while (out.startsWith("./")) out = out.slice(2);
  return out;
}

/**
 * Internal: lazily-read, cached view of the repo's JavaScript and TypeScript files.
 * Exported so `services.ts` and the API layer can reuse the scan rather than repeat it.
 */
export class Repo {
  /** Resolved type declarations, per repo instance so two fixtures cannot share a key. */
  readonly typeCache = new Map<string, { fields: string[]; source: SourceRef } | null>();
  /** Next.js conventions apply only when Next is actually a dependency. */
  readonly isNext: boolean;
  private readonly cache = new Map<string, FileInfo | null>();
  private readonly importsByFile = new Map<string, Map<string, string>>();
  private semanticCache: SemanticIndex | null;

  constructor(
    readonly root: string,
    readonly graph: RepoGraph,
    private readonly provided: ReadonlyMap<string, string> | undefined,
    semanticIndex?: SemanticIndex,
  ) {
    this.semanticCache = semanticIndex ?? null;
    for (const e of graph.edges) {
      if (e.kind !== "import" && e.kind !== "tests") continue;
      const names = e.names ?? [];
      if (names.length === 0) continue;
      let map = this.importsByFile.get(e.source);
      if (!map) {
        map = new Map();
        this.importsByFile.set(e.source, map);
      }
      for (const n of names) if (!map.has(n)) map.set(n, e.target);
    }
    this.isNext = hasNextDependency(root);
  }

  /** Code files the graph knows about, tests and generated files excluded. */
  sourceFiles(): string[] {
    return this.graph.nodes
      .filter((n) => n.kind === "file" && !isTestLike(n.role) && n.role !== "generated" && symbolLang(n.path) === "js")
      .map((n) => n.path)
      .sort();
  }

  info(file: string): FileInfo | null {
    const key = normalizePath(file);
    const hit = this.cache.get(key);
    if (hit !== undefined) return hit;
    let src = this.provided?.get(key);
    if (src === undefined) {
      try {
        src = readFileSync(path.join(this.root, key), "utf8");
      } catch {
        this.cache.set(key, null);
        return null;
      }
    }
    if (symbolLang(key) !== "js") {
      this.cache.set(key, null);
      return null;
    }
    const masked = maskCode(src, "js");
    const starts = lineStarts(masked);
    const symbols = extractSymbols(key, src);
    const declOffset = new Map<string, number>();
    for (const s of symbols) declOffset.set(s.name, starts[s.line - 1] ?? 0);
    const info: FileInfo = {
      file: key,
      src,
      masked,
      starts,
      symbols,
      imports: this.importsByFile.get(key) ?? new Map(),
      declOffset,
    };
    this.cache.set(key, info);
    return info;
  }

  semantic(): SemanticIndex {
    if (!this.semanticCache) this.semanticCache = buildSemanticIndex({ root: this.root }, this.graph, this.provided ? { contents: this.provided } : {});
    return this.semanticCache;
  }

  semanticSymbol(id: string): SymbolRecord | null {
    return this.semantic().symbols.find((symbol) => symbol.id === id) ?? null;
  }

  callsFrom(symbol: string): SemanticCallSite[] {
    return this.semantic().calls.filter((call) => call.callerId === symbol && call.resolution === "exact" && call.calleeId !== null);
  }

  callAt(file: string, offset: number): SemanticCallSite | null {
    return this.semantic().calls.find((call) => call.source.file === file && call.source.startOffset === offset) ?? null;
  }
}

// ---------------------------------------------------------------------------
// Node ids
// ---------------------------------------------------------------------------

export function symbolId(file: string, name: string): string {
  return semanticSymbolId(file, name);
}

/** URL-safe id for a flow, from its file and handler. Stable across runs. */
export function flowId(file: string, symbol: string): string {
  return `${file}#${symbol}`.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-+|-+$/g, "").toLowerCase();
}

// ---------------------------------------------------------------------------
// Routes derived from file paths
// ---------------------------------------------------------------------------

/** `[[rest]]` → `*`, `[...rest]` → `*`, `[id]` → `:id`, `(group)` → dropped. */
function routeSegment(seg: string): string | null {
  if (/^\(.*\)$/.test(seg)) return null;
  if (/^\[\[.*\]\]$/.test(seg)) return "*";
  const dyn = /^\[(\.\.\.)?(.+)\]$/.exec(seg);
  if (dyn) return dyn[1] ? "*" : `:${dyn[2] ?? ""}`;
  return seg;
}

function joinRoute(segs: readonly string[]): string {
  const kept = segs.map(routeSegment).filter((s): s is string => s !== null && s !== "");
  return kept.length === 0 ? "/" : `/${kept.join("/")}`;
}

/** `functions/api/chat.js` → `/api/chat`. Any directory ending in `functions/` is the root. */
export function cloudflareRoute(file: string): string | null {
  const p = normalizePath(file);
  const m = /(?:^|\/)functions\/(.*)$/.exec(p);
  if (!m) return null;
  const rest = (m[1] ?? "").replace(/\.[cm]?[jt]sx?$/, "");
  const segs = rest.split("/").filter(Boolean);
  if (segs[segs.length - 1] === "index" || segs[segs.length - 1] === "_middleware") segs.pop();
  return joinRoute(segs);
}

/** `app/api/chat/route.ts` → `/api/chat`; `app/blog/[slug]/page.tsx` → `/blog/:slug`. */
export function nextRoute(file: string): string | null {
  const p = normalizePath(file);
  const app = /(?:^|\/)app\/(.*)$/.exec(p);
  if (app) {
    const segs = (app[1] ?? "").split("/").filter(Boolean);
    const last = segs[segs.length - 1] ?? "";
    if (!/^(route|page)\.[cm]?[jt]sx?$/.test(last)) return null;
    segs.pop();
    return joinRoute(segs);
  }
  const pages = /(?:^|\/)pages\/(.*)$/.exec(p);
  if (pages) {
    const rest = (pages[1] ?? "").replace(/\.[cm]?[jt]sx?$/, "");
    const segs = rest.split("/").filter(Boolean);
    if (segs[segs.length - 1] === "index") segs.pop();
    return joinRoute(segs);
  }
  return null;
}

// ---------------------------------------------------------------------------
// Entry detection
// ---------------------------------------------------------------------------

const HTTP_METHODS = ["GET", "POST", "PUT", "DELETE", "PATCH", "HEAD", "OPTIONS"] as const;
const METHOD_SET = new Set<string>(HTTP_METHODS);
/** `use` and `all` are excluded: neither names a single method. */
const ROUTER_VERBS = new Set(["get", "post", "put", "delete", "patch", "head", "options"]);

/** `onRequestPost` → POST; bare `onRequest` → null (every method). */
const CF_HANDLER = /^onRequest(Get|Post|Put|Delete|Patch|Head|Options)?$/;

interface DetectedEntry extends FlowEntry {
  /** 1-based inclusive span of the handler body, for the tracer. */
  startLine: number;
  endLine: number;
}

function entryOf(
  file: string,
  symbol: string,
  kind: FlowEntryKind,
  method: string | null,
  route: string | null,
  confidence: Confidence,
  line: number,
  endLine: number,
): DetectedEntry {
  const title = route ? `${method ?? "ANY"} ${route}` : `${symbol} (${file})`;
  return {
    id: flowId(file, symbol),
    node: symbolId(file, symbol),
    file,
    symbol,
    kind,
    title,
    method,
    route,
    confidence,
    source: { file, line },
    startLine: line,
    endLine,
  };
}

/**
 * The span of a function value starting at or after `at` (an inline callback), or the
 * span of the symbol a bare identifier names. Returns null when neither applies.
 */
function handlerSpan(repo: Repo, info: FileInfo, at: number): { file: string; symbol: string; start: number; end: number } | null {
  const i = skipSpace(info.masked, at);
  const rest = info.masked.slice(i, i + 400);
  const isFn = /^(?:async\s*)?(?:function\b|\()/.test(rest) || /^(?:async\s+)?[A-Za-z_$][\w$]*\s*=>/.test(rest);
  if (isFn) {
    const brace = info.masked.indexOf("{", i);
    const arrowBody = info.masked.indexOf("=>", i);
    if (brace !== -1) {
      const end = matchDelim(info.masked, brace);
      if (end !== -1) return { file: info.file, symbol: "handler", start: lineAt(info.starts, i), end: lineAt(info.starts, end) };
    }
    if (arrowBody !== -1) {
      const eol = info.masked.indexOf("\n", arrowBody);
      return { file: info.file, symbol: "handler", start: lineAt(info.starts, i), end: lineAt(info.starts, eol === -1 ? info.masked.length : eol) };
    }
    return null;
  }
  IDENT_RE.lastIndex = i;
  const m = IDENT_RE.exec(info.masked);
  if (!m || m.index !== i) return null;
  const name = m[0];
  const local = info.symbols.find((s) => s.name === name);
  if (local) return { file: info.file, symbol: name, start: local.line, end: local.endLine };
  const target = info.imports.get(name);
  if (!target) return null;
  const other = repo.info(target);
  const sym = other?.symbols.find((s) => s.name === name && s.exported);
  if (!other || !sym) return null;
  return { file: other.file, symbol: sym.name, start: sym.line, end: sym.endLine };
}

/** `\bregisterTool(` and `.command(` style literal-first-argument detectors. */
function literalCallEntries(
  repo: Repo,
  info: FileInfo,
  re: RegExp,
  kind: FlowEntryKind,
  argIndexForHandler: number,
  chained?: string,
): DetectedEntry[] {
  const out: DetectedEntry[] = [];
  re.lastIndex = 0;
  for (const m of info.masked.matchAll(re)) {
    const at = (m.index ?? 0) + m[0].length;
    const open = info.masked.indexOf("(", (m.index ?? 0));
    if (open === -1) continue;
    const close = matchDelim(info.masked, open);
    if (close === -1) continue;
    const name = readStringLiteral(info.src, at);
    if (!name) continue;
    let args = splitArgs(info.masked, open + 1, close);
    let handlerIndex = argIndexForHandler;
    if (chained) {
      // commander puts the body on `.action(fn)` further along the same chain.
      const tail = info.masked.slice(close, Math.min(close + 2000, info.masked.length));
      const hit = new RegExp(`^[\\s\\S]*?\\.\\s*${chained}\\s*\\(`).exec(tail);
      if (hit) {
        const chainOpen = close + hit[0].length - 1;
        const chainClose = matchDelim(info.masked, chainOpen);
        if (chainClose !== -1) {
          args = splitArgs(info.masked, chainOpen + 1, chainClose);
          handlerIndex = 0;
        }
      }
    }
    const handlerArg = args[handlerIndex];
    const span = handlerArg ? handlerSpan(repo, info, handlerArg[0]) : null;
    const line = lineAt(info.starts, m.index ?? 0);
    const symbol = span?.symbol && span.symbol !== "handler" ? span.symbol : `${kind}:${name}`;
    const entry = entryOf(span?.file ?? info.file, symbol, kind, null, name, "exact", span?.start ?? line, span?.end ?? line);
    entry.id = flowId(info.file, `${kind}:${name}`);
    entry.title = kind === "cli" ? `command ${name}` : `tool ${name}`;
    entry.source = { file: info.file, line };
    out.push(entry);
  }
  return out;
}

/** Every entry point in one file. Test and generated files are never entries. */
function fileEntries(repo: Repo, file: string): DetectedEntry[] {
  const info = repo.info(file);
  if (!info) return [];
  const out: DetectedEntry[] = [];

  // --- Cloudflare Pages Functions: export [async] function onRequest*(context) ---
  const cfRoute = cloudflareRoute(file);
  for (const s of info.symbols) {
    const m = CF_HANDLER.exec(s.name);
    if (!m || !s.exported || s.kind !== "function") continue;
    const method = m[1] ? m[1].toUpperCase() : null;
    out.push(entryOf(file, s.name, "cloudflare", method, cfRoute, cfRoute ? "exact" : "heuristic", s.line, s.endLine));
  }

  // --- Cloudflare Worker: export default { fetch } ---
  const def = /export\s+default\s*\{/.exec(info.masked);
  if (def) {
    const open = info.masked.indexOf("{", def.index);
    const close = matchDelim(info.masked, open);
    if (close !== -1) {
      const body = info.masked.slice(open, close + 1);
      const fetchAt = /(^|[{,\s])(?:async\s+)?fetch\s*[(:,}]/.exec(body);
      if (fetchAt) {
        const at = open + (fetchAt.index ?? 0);
        out.push(entryOf(file, "fetch", "cloudflare", null, cfRoute, "heuristic", lineAt(info.starts, at), lineAt(info.starts, close)));
      }
    }
  }

  // --- Express / Hono: app.get("/x", …), router.post("/y", …) ---
  for (const m of info.masked.matchAll(/\b([A-Za-z_$][\w$]*)\s*\.\s*([a-z]+)\s*\(/g)) {
    const verb = m[2] ?? "";
    if (!ROUTER_VERBS.has(verb)) continue;
    const open = (m.index ?? 0) + m[0].length - 1;
    const close = matchDelim(info.masked, open);
    if (close === -1) continue;
    const route = readStringLiteral(info.src, open + 1);
    // The leading-slash guard is what keeps `map.get("key")` and `env.CACHE.get(k)` out.
    if (!route || !route.startsWith("/")) continue;
    const args = splitArgs(info.masked, open + 1, close);
    const span = args.length > 1 ? handlerSpan(repo, info, (args[args.length - 1] ?? [0, 0])[0]) : null;
    const line = lineAt(info.starts, m.index ?? 0);
    const method = verb.toUpperCase();
    const symbol = span?.symbol && span.symbol !== "handler" ? span.symbol : `${verb}:${route}`;
    const entry = entryOf(span?.file ?? file, symbol, "http-route", method, route, "exact", span?.start ?? line, span?.end ?? line);
    entry.id = flowId(file, `${verb}:${route}`);
    entry.title = `${method} ${route}`;
    entry.source = { file, line };
    out.push(entry);
  }

  // --- Next.js route handlers and pages ---
  const nRoute = repo.isNext ? nextRoute(file) : null;
  if (nRoute !== null) {
    const isRoute = /(?:^|\/)route\.[cm]?[jt]sx?$/.test(file);
    if (isRoute) {
      for (const s of info.symbols) {
        if (!s.exported || !METHOD_SET.has(s.name)) continue;
        out.push(entryOf(file, s.name, "next-route", s.name, nRoute, "exact", s.line, s.endLine));
      }
    } else {
      const page = info.symbols.find((s) => s.isDefault) ?? info.symbols.find((s) => s.exported && s.kind === "function");
      if (page) {
        const e = entryOf(file, page.name, "next-page", null, nRoute, "exact", page.line, page.endLine);
        e.title = `page ${nRoute}`;
        out.push(e);
      }
    }
  }

  // --- CLI commands and MCP tools (the shapes graph.ts already counts) ---
  out.push(...literalCallEntries(repo, info, /\.\s*command\s*\(/g, "cli", 1, "action"));
  out.push(...literalCallEntries(repo, info, /\bregisterTool\s*\(/g, "mcp", 2));

  const seen = new Set<string>();
  return out.filter((e) => (seen.has(e.id) ? false : (seen.add(e.id), true)));
}

/** Entry markers `graph.ts` already computed (`entryKinds` containing `main`). */
function mainEntries(repo: Repo): DetectedEntry[] {
  const out: DetectedEntry[] = [];
  for (const n of repo.graph.nodes) {
    if (n.kind !== "file" || !n.entry) continue;
    if (!n.entryKinds.some((k) => k.kind === "main")) continue;
    const info = repo.info(n.path);
    if (!info) continue;
    const lines = info.src.split("\n").length;
    const e = entryOf(n.path, "(module)", "main", null, null, "exact", 1, lines);
    e.title = `main ${n.path}`;
    out.push(e);
  }
  return out;
}

function detectEntriesInternal(repo: Repo): DetectedEntry[] {
  const out: DetectedEntry[] = [];
  for (const f of repo.sourceFiles()) out.push(...fileEntries(repo, f));
  const seen = new Set(out.map((e) => e.id));
  for (const e of mainEntries(repo)) {
    // A file that is already an entry through a handler does not need a module entry too.
    if (seen.has(e.id) || out.some((x) => x.file === e.file)) continue;
    seen.add(e.id);
    out.push(e);
  }
  out.sort((a, b) => a.file.localeCompare(b.file) || a.source.line - b.source.line || a.id.localeCompare(b.id));
  return out;
}

/** Every entry point in the repo, sorted by file then line. */
export function detectEntries(paths: RepoPaths, graph: RepoGraph, opts: TraceOptions = {}): FlowEntry[] {
  const repo = new Repo(paths.root, graph, opts.contents, opts.semanticIndex);
  return detectEntriesInternal(repo).map(publicEntry);
}

function publicEntry(e: DetectedEntry): FlowEntry {
  const { startLine: _s, endLine: _e, ...rest } = e;
  return rest;
}

// ---------------------------------------------------------------------------
// Signatures
// ---------------------------------------------------------------------------

interface ParamInfo {
  /** `null` for a destructured or rest parameter. */
  name: string | null;
  /** Field names of a destructured parameter. */
  fields: string[];
  /** Text of the type annotation, `null` in JavaScript. */
  type: string | null;
}

interface Signature {
  params: ParamInfo[];
  returnType: string | null;
  /** Offset just past the `)` of the parameter list. */
  after: number;
}

const FN_KEYWORDS = new Set([
  "if", "for", "while", "switch", "catch", "return", "typeof", "function", "new", "await", "do",
  "else", "try", "in", "of", "case", "delete", "void", "yield", "instanceof", "throw", "with", "super",
]);

/**
 * The callee's parameter list and return type. Only declarations that actually look like
 * functions are read: a `const x = compute(a, b)` would otherwise report `compute`'s
 * arguments as its own parameters.
 */
export function signatureOf(info: FileInfo, sym: CodeSymbol): Signature | null {
  const from = info.starts[sym.line - 1] ?? 0;
  const to = info.starts[sym.endLine] ?? info.masked.length;
  const head = info.masked.slice(from, to);
  const nameAt = head.indexOf(sym.name);
  const searchFrom = from + (nameAt === -1 ? 0 : nameAt + sym.name.length);
  let open = -1;
  for (let i = searchFrom; i < to; i += 1) {
    const ch = info.masked.charAt(i);
    if (ch === "(") {
      open = i;
      break;
    }
    if (ch === "{" || ch === ";") break;
  }
  if (open === -1) return null;
  const close = matchDelim(info.masked, open);
  if (close === -1) return null;
  const before = info.masked.slice(from, open);
  const after = info.masked.slice(close + 1, Math.min(close + 200, to));
  const isFunction = /\bfunction\b/.test(before) || /^\s*(?::[^=]*)?=>/.test(after) || sym.kind === "function";
  if (!isFunction) return null;

  const params: ParamInfo[] = [];
  for (const [s, e] of splitArgs(info.masked, open + 1, close)) {
    const raw = info.masked.slice(s, e);
    const text = raw.trim();
    if (!text || text.startsWith("...")) continue; // blank in masked = a blanked default, not a name
    const eq = topLevelIndex(raw, "=");
    const body = eq === -1 ? raw : raw.slice(0, eq);
    const colon = topLevelIndex(body, ":");
    const decl = (colon === -1 ? body : body.slice(0, colon)).trim();
    const type = colon === -1 ? null : body.slice(colon + 1).trim() || null;
    if (decl.startsWith("{")) {
      const keys = objectLiteralKeys(info.masked, info.src, s + (raw.length - raw.trimStart().length), e);
      params.push({ name: null, fields: keys?.keys ?? [], type });
    } else {
      params.push({ name: IDENT_ONLY.test(decl) ? decl : null, fields: [], type });
    }
  }
  const retMatch = /^\s*:\s*([^=;{]+?)\s*(?:=>|\{|$)/.exec(after);
  return { params, returnType: retMatch?.[1]?.trim() || null, after: close + 1 };
}

/** Index of `ch` at nesting depth zero in `text`, or -1. `=>` is not an `=`. */
function topLevelIndex(text: string, ch: string): number {
  let depth = 0;
  for (let i = 0; i < text.length; i += 1) {
    const c = text.charAt(i);
    if (c === "(" || c === "[" || c === "{" || c === "<") depth += 1;
    else if (c === ")" || c === "]" || c === "}" || c === ">") depth -= 1;
    else if (c === ch && depth === 0) {
      if (ch === "=" && (text.charAt(i + 1) === ">" || text.charAt(i + 1) === "=" || text.charAt(i - 1) === "=")) continue;
      return i;
    }
  }
  return -1;
}

// ---------------------------------------------------------------------------
// Payload rule 1 — the destructured request body
// ---------------------------------------------------------------------------

const BODY_CALL = /\bawait\s+((?:[A-Za-z_$][\w$]*\s*\??\s*\.\s*)*[A-Za-z_$][\w$]*)\s*\??\s*\.\s*json\s*\(\s*\)/g;
const REQUEST_RECEIVER = /(^|\.)(request|req)$/;

/**
 * Rule 1: `const { a, b } = await request.json()` → `[a, b]`, `exact`.
 *
 * Also covers the same body bound to a name and read by property — `payload = await
 * request.json()` then `payload.message` — which is the shape the ground-truth repo
 * actually uses. Both are field names read from literals in the code, so both are
 * `exact`; `shape` says which spelling was found.
 */
export function requestPayload(info: FileInfo, startLine: number, endLine: number): Payload | null {
  const from = info.starts[startLine - 1] ?? 0;
  const to = info.starts[endLine] ?? info.masked.length;
  const region = info.masked.slice(from, to);
  BODY_CALL.lastIndex = 0;
  for (const m of region.matchAll(BODY_CALL)) {
    const receiver = (m[1] ?? "").replace(/[\s?]/g, "");
    if (!REQUEST_RECEIVER.test(receiver)) continue;
    const at = from + (m.index ?? 0);
    const line = lineAt(info.starts, at);
    // Walk back over `const { … } = ` / `x = ` to the statement head.
    const head = info.masked.slice(Math.max(from, at - 400), at);
    const destructured = /(?:const|let|var)\s*(\{[^}]*\})\s*=\s*$/.exec(head);
    if (destructured) {
      const open = info.masked.lastIndexOf("{", at);
      const close = open === -1 ? -1 : matchDelim(info.masked, open);
      const keys = open !== -1 && close !== -1 ? objectLiteralKeys(info.masked, info.src, open, close + 1) : null;
      if (keys && keys.keys.length > 0) {
        return { fields: keys.keys, shape: `${receiver}.json()`, confidence: "exact", source: { file: info.file, line } };
      }
    }
    const alias = /(?:(?:const|let|var)\s+)?([A-Za-z_$][\w$]*)\s*=\s*$/.exec(head);
    const name = alias?.[1];
    if (!name) continue;
    const fields = propertyReads(info.masked, name, from, to);
    if (fields.length > 0) {
      return { fields, shape: `${receiver}.json() via ${name}`, confidence: "exact", source: { file: info.file, line } };
    }
  }
  return null;
}

/** Property names read off `name` in `[from, to)`, in source order; method calls excluded. */
function propertyReads(masked: string, name: string, from: number, to: number): string[] {
  const re = new RegExp(`\\b${name}\\s*\\??\\s*\\.\\s*([A-Za-z_$][\\w$]*)`, "g");
  const region = masked.slice(from, to);
  const out: string[] = [];
  const seen = new Set<string>();
  for (const m of region.matchAll(re)) {
    const prop = m[1] ?? "";
    const after = region.slice((m.index ?? 0) + m[0].length);
    if (/^\s*\(/.test(after)) continue; // a method call, not a field
    if (seen.has(prop)) continue;
    seen.add(prop);
    out.push(prop);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Payload rules 2–5
// ---------------------------------------------------------------------------

/** Rule 2: the first object literal among the call's arguments → its keys, `exact`. */
export function callSitePayload(info: FileInfo, argsFrom: number, argsTo: number): Payload | null {
  for (const [s, e] of splitArgs(info.masked, argsFrom, argsTo)) {
    const keys = objectLiteralKeys(info.masked, info.src, s, e);
    if (!keys || keys.keys.length === 0) continue;
    return {
      fields: keys.keys,
      shape: keys.spread ? "object literal (+ spread)" : "object literal",
      confidence: "exact",
      source: { file: info.file, line: lineAt(info.starts, s) },
    };
  }
  return null;
}

/**
 * Field names of `interface X { … }` or `type X = { … }`, resolved one level only: a
 * `type X = Y` alias returns null rather than chasing `Y`. Looks in `info` first, then
 * in the file `X` was imported from.
 */
export function typeFields(repo: Repo, info: FileInfo, typeName: string): { fields: string[]; source: SourceRef } | null {
  const name = typeName.replace(/\[\]$/, "").trim();
  if (!IDENT_ONLY.test(name)) return null;
  const key = `${info.file}|${name}`;
  const cached = repo.typeCache.get(key);
  if (cached !== undefined) return cached;
  const search = (target: FileInfo): { fields: string[]; source: SourceRef } | null => {
    const re = new RegExp(`\\b(?:interface\\s+${name}\\b[^{]*|type\\s+${name}\\s*=\\s*)`, "g");
    for (const m of target.masked.matchAll(re)) {
      const at = (m.index ?? 0) + m[0].length;
      const open = skipSpace(target.masked, at);
      if (target.masked.charAt(open) !== "{") continue;
      const close = matchDelim(target.masked, open);
      if (close === -1) continue;
      const fields = typeMemberNames(target.masked, target.src, open, close);
      if (fields.length === 0) continue;
      return { fields, source: { file: target.file, line: lineAt(target.starts, m.index ?? 0) } };
    }
    return null;
  };
  let found = search(info);
  if (!found) {
    const from = info.imports.get(name);
    const other = from ? repo.info(from) : null;
    if (other) found = search(other);
  }
  repo.typeCache.set(key, found);
  return found;
}

/** Members of a type body: `a: string; b?: number` → `[a, b]`. Nested objects contribute their own key only. */
function typeMemberNames(masked: string, src: string, open: number, close: number): string[] {
  const out: string[] = [];
  let depth = 0;
  let start = open + 1;
  const flush = (end: number): void => {
    const from = start;
    start = end + 1;
    const at = firstNonSpace(src, from, end);
    if (at === -1) return;
    const head = masked.slice(from, end).trim().split(/[?:(<]/)[0]?.trim() ?? "";
    if (IDENT_ONLY.test(head)) out.push(head);
    else if (masked.charAt(at) === " ") {
      const lit = readStringLiteral(src, at);
      if (lit) out.push(lit);
    }
  };
  for (let i = open + 1; i < close; i += 1) {
    const ch = masked.charAt(i);
    if (ch === "{" || ch === "(" || ch === "[" || ch === "<") depth += 1;
    else if (ch === "}" || ch === ")" || ch === "]" || ch === ">") depth -= 1;
    else if ((ch === ";" || ch === "," || ch === "\n") && depth === 0) flush(i);
  }
  flush(close);
  return Array.from(new Set(out));
}

/** Rule 4: the JSDoc block immediately above the declaration. `@param {T} opts.a` wins over `@param {T} opts`. */
export function jsdocPayload(info: FileInfo, sym: CodeSymbol): Payload | null {
  const declStart = info.starts[sym.line - 1] ?? 0;
  const before = info.src.slice(0, declStart);
  const closeAt = before.lastIndexOf("*/");
  if (closeAt === -1) return null;
  // Only a block that is directly above the declaration, whitespace apart.
  if (before.slice(closeAt + 2).trim() !== "") return null;
  const openAt = before.lastIndexOf("/**", closeAt);
  if (openAt === -1) return null;
  const block = before.slice(openAt, closeAt);
  const dotted: string[] = [];
  const plain: string[] = [];
  for (const m of block.matchAll(/@param\s*(?:\{([^}]*)\})?\s*\[?([A-Za-z_$][\w$.]*)/g)) {
    const braceType = m[1] ?? "";
    const nameRaw = m[2] ?? "";
    if (nameRaw.includes(".")) dotted.push(nameRaw.slice(nameRaw.indexOf(".") + 1));
    else plain.push(nameRaw);
    // `@param {{a: string, b: number}} input` — an inline object type carries the fields.
    if (dotted.length === 0 && /^\s*\{/.test(braceType)) {
      const inline = braceType.replace(/^\s*\{/, "").replace(/\}\s*$/, "");
      for (const part of inline.split(",")) {
        const head = part.split(":")[0]?.trim() ?? "";
        if (IDENT_ONLY.test(head)) dotted.push(head);
      }
    }
  }
  const fields = dotted.length > 0 ? Array.from(new Set(dotted)) : Array.from(new Set(plain));
  if (fields.length === 0) return null;
  return {
    fields,
    shape: "JSDoc @param",
    confidence: "exact",
    source: { file: info.file, line: lineAt(info.starts, openAt) },
  };
}

/**
 * Rules 3–5 over the callee's signature: an annotated parameter type resolved one level
 * (`exact`), then JSDoc (`exact`), then the parameter names themselves (`heuristic`).
 * Returns null when the signature gives nothing — an empty parameter list, or a callee
 * whose declaration could not be read.
 */
export function signaturePayload(repo: Repo, info: FileInfo, sym: CodeSymbol): Payload | null {
  const sig = signatureOf(info, sym);
  const declLine = sym.line;

  // Rule 3 — a type annotation, resolved one level into an interface or type alias.
  for (const p of sig?.params ?? []) {
    if (!p.type) continue;
    if (p.type.startsWith("{")) {
      const open = info.masked.indexOf("{", info.starts[declLine - 1] ?? 0);
      const close = open === -1 ? -1 : matchDelim(info.masked, open);
      const fields = open !== -1 && close !== -1 ? typeMemberNames(info.masked, info.src, open, close) : [];
      if (fields.length > 0) {
        return { fields, shape: "inline object type", confidence: "exact", source: { file: info.file, line: declLine } };
      }
      continue;
    }
    const resolved = typeFields(repo, info, p.type);
    if (resolved) {
      return { fields: resolved.fields, shape: `type ${p.type}`, confidence: "exact", source: resolved.source };
    }
  }

  // Rule 4 — JSDoc.
  const doc = jsdocPayload(info, sym);
  if (doc) return doc;

  // Rule 5 — parameter names. A destructured parameter contributes its field names.
  if (sig) {
    const destructured = sig.params.find((p) => p.name === null && p.fields.length > 0);
    if (destructured) {
      return { fields: destructured.fields, shape: "destructured parameter", confidence: "heuristic", source: { file: info.file, line: declLine } };
    }
    const names = sig.params.map((p) => p.name).filter((n): n is string => n !== null);
    if (names.length > 0) {
      return { fields: names, shape: "parameter names", confidence: "heuristic", source: { file: info.file, line: declLine } };
    }
  }
  // Rule 6 — nothing derivable.
  return null;
}

// ---------------------------------------------------------------------------
// Outputs
// ---------------------------------------------------------------------------

const CLOSE_CACHE = new WeakMap<FileInfo, Map<number, number>>();

/** Closer offset → its opener, derived from the pair table. */
function openerOf(info: FileInfo): Map<number, number> {
  const hit = CLOSE_CACHE.get(info);
  if (hit) return hit;
  const out = new Map<number, number>();
  for (const [open, close] of delimiterPairs(info)) out.set(close, open);
  CLOSE_CACHE.set(info, out);
  return out;
}

/**
 * Does the `{` at `open` start a function body? True for `=> {` and for `function …(…) {`;
 * false for `if (…) {`, `for (…) {` and friends, because the word before the parenthesis
 * is a keyword rather than `function`.
 */
function isFunctionBodyBrace(info: FileInfo, open: number): boolean {
  const m = info.masked;
  let i = open - 1;
  while (i >= 0 && /\s/.test(m.charAt(i))) i -= 1;
  if (i >= 1 && m.charAt(i) === ">" && m.charAt(i - 1) === "=") return true;
  if (m.charAt(i) !== ")") return false;
  const paren = openerOf(info).get(i);
  if (paren === undefined) return false;
  let j = paren - 1;
  while (j >= 0 && /\s/.test(m.charAt(j))) j -= 1;
  let end = j;
  while (j >= 0 && /[\w$]/.test(m.charAt(j))) j -= 1;
  const word = m.slice(j + 1, end + 1);
  if (word === "function") return true;
  if (!IDENT_ONLY.test(word)) return false;
  // `function foo(…) {` — the name sits between `function` and the parameters.
  while (j >= 0 && /\s/.test(m.charAt(j))) j -= 1;
  end = j;
  while (j >= 0 && /[\w$]/.test(m.charAt(j))) j -= 1;
  return m.slice(j + 1, end + 1) === "function";
}

/**
 * Bodies of functions nested inside `[from, to)`, excluding the enclosing function's own
 * body at `bodyOpen`. A `return { … }` inside one of these belongs to the callback, not to
 * the symbol being described — the ground-truth chat handler has a `makeTrace` arrow whose
 * literal was otherwise reported as the handler's own response.
 */
function nestedFunctionBodies(info: FileInfo, from: number, to: number, bodyOpen: number): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (const [open, close] of delimiterPairs(info)) {
    if (open <= from || open >= to || open === bodyOpen) continue;
    if (info.masked.charAt(open) !== "{") continue;
    if (isFunctionBodyBrace(info, open)) out.push([open, close]);
  }
  return out;
}

const RESPONSE_JSON = /\bResponse\s*\.\s*json\s*\(/g;
const RESPONSE_STRINGIFY = /\bnew\s+Response\s*\(\s*JSON\s*\.\s*stringify\s*\(/g;
const RETURN_OBJECT = /\breturn\s*(?=\{)/g;

/**
 * What comes back, in the spec's order: `Response.json({…})`, `return {…}`, an annotated
 * return type, else null.
 *
 * `new Response(JSON.stringify({…}))` is read as the same construct as `Response.json`:
 * it is the older spelling of one literal object, and it is what the ground-truth repo
 * writes. Both stay `exact`; `shape` records which was found.
 */
export function outputPayload(repo: Repo, info: FileInfo, sym: CodeSymbol): Payload | null {
  const from = info.starts[sym.line - 1] ?? 0;
  const to = info.starts[sym.endLine] ?? info.masked.length;
  const candidates: Array<{ at: number; args: number; shape: string }> = [];
  const collect = (re: RegExp, shape: string): void => {
    re.lastIndex = 0;
    for (const m of info.masked.slice(from, to).matchAll(re)) {
      const at = from + (m.index ?? 0);
      candidates.push({ at, args: at + (m[0]?.length ?? 0), shape });
    }
  };
  collect(RESPONSE_JSON, "Response.json");
  collect(RESPONSE_STRINGIFY, "new Response(JSON.stringify(…))");
  collect(RETURN_OBJECT, "return object literal");
  candidates.sort((a, b) => a.at - b.at);

  // A plain `return { … }` only counts when it is this function's own return.
  const sigForBody = signatureOf(info, sym);
  const bodyOpen = info.masked.indexOf("{", sigForBody?.after ?? from);
  const nested = nestedFunctionBodies(info, from, to, bodyOpen);
  const inNested = (at: number): boolean => nested.some(([o, c]) => at > o && at < c);

  for (const c of candidates) {
    if (c.shape === "return object literal" && inNested(c.at)) continue;
    const open = skipSpace(info.masked, c.args);
    if (info.masked.charAt(open) !== "{") continue;
    const close = matchDelim(info.masked, open);
    if (close === -1) continue;
    const keys = objectLiteralKeys(info.masked, info.src, open, close + 1);
    if (!keys || keys.keys.length === 0) continue;
    return {
      fields: keys.keys,
      shape: keys.spread ? `${c.shape} (+ spread)` : c.shape,
      confidence: "exact",
      source: { file: info.file, line: lineAt(info.starts, c.at) },
    };
  }
  const sig = signatureOf(info, sym);
  const ret = sig?.returnType?.replace(/^Promise\s*<\s*/, "").replace(/\s*>\s*$/, "").trim();
  if (ret) {
    const resolved = typeFields(repo, info, ret);
    if (resolved) return { fields: resolved.fields, shape: `returns ${ret}`, confidence: "exact", source: resolved.source };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Call sites
// ---------------------------------------------------------------------------

const PAIR_CACHE = new WeakMap<FileInfo, Map<number, number>>();

/** Every `(`/`[`/`{` in the file mapped to its closer, in one linear pass over masked text. */
function delimiterPairs(info: FileInfo): Map<number, number> {
  const hit = PAIR_CACHE.get(info);
  if (hit) return hit;
  const pairs = new Map<number, number>();
  const stack: number[] = [];
  for (let i = 0; i < info.masked.length; i += 1) {
    const ch = info.masked.charAt(i);
    if (ch === "(" || ch === "[" || ch === "{") stack.push(i);
    else if (ch === ")" || ch === "]" || ch === "}") {
      const open = stack.pop();
      if (open !== undefined && CLOSERS[info.masked.charAt(open)] === ch) pairs.set(open, i);
    }
  }
  PAIR_CACHE.set(info, pairs);
  return pairs;
}

interface CallSite {
  /** Callee identifier, or the method for a member call. */
  name: string;
  /** Receiver chain for a member call (`env.CACHE`), null for a plain call. */
  receiver: string | null;
  line: number;
  at: number;
  argsFrom: number;
  argsTo: number;
}

/**
 * Every `f(` and `a.b(` inside `[startLine, endLine]`, read from masked text so a call
 * written inside a string or a comment is never seen. Resolution is the caller's job.
 */
export function callSites(info: FileInfo, startLine: number, endLine: number): CallSite[] {
  const from = info.starts[startLine - 1] ?? 0;
  const to = info.starts[endLine] ?? info.masked.length;
  const out: CallSite[] = [];
  const m = info.masked;
  const pairs = delimiterPairs(info);
  for (let i = from; i < to; i += 1) {
    if (m.charAt(i) !== "(") continue;
    // Identifier immediately before the paren.
    let j = i - 1;
    while (j >= from && /\s/.test(m.charAt(j))) j -= 1;
    if (j < from || !/[\w$]/.test(m.charAt(j))) continue;
    let k = j;
    while (k >= 0 && /[\w$]/.test(m.charAt(k))) k -= 1;
    const name = m.slice(k + 1, j + 1);
    if (!IDENT_ONLY.test(name) || FN_KEYWORDS.has(name)) continue;
    // Receiver chain, tolerating newlines and optional chaining.
    let r = k;
    while (r >= 0 && /\s/.test(m.charAt(r))) r -= 1;
    let receiver: string | null = null;
    if (m.charAt(r) === ".") {
      const parts: string[] = [];
      let p = r;
      for (;;) {
        p -= 1;
        while (p >= 0 && /[\s?]/.test(m.charAt(p))) p -= 1;
        if (p < 0 || !/[\w$]/.test(m.charAt(p))) break;
        let q = p;
        while (q >= 0 && /[\w$]/.test(m.charAt(q))) q -= 1;
        parts.unshift(m.slice(q + 1, p + 1));
        p = q;
        while (p >= 0 && /\s/.test(m.charAt(p))) p -= 1;
        if (m.charAt(p) !== ".") break;
      }
      if (parts.length === 0) continue;
      receiver = parts.join(".");
    }
    const close = pairs.get(i);
    if (close === undefined) continue;
    // Deliberately no skip past `close`: a call nested in these arguments is a real step.
    out.push({ name, receiver, line: lineAt(info.starts, k + 1), at: k + 1, argsFrom: i + 1, argsTo: close });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Service operations
// ---------------------------------------------------------------------------

type ServiceOp = "read" | "write" | "touch";

const KV_READ = new Set(["get", "getWithMetadata", "list"]);
const KV_WRITE = new Set(["put", "delete"]);
const R2_READ = new Set(["head"]);
const R2_WRITE = new Set(["createMultipartUpload"]);
const D1_WRITE = new Set(["batch", "exec"]);
const BINDING_NAME = /^[A-Z][A-Z0-9_]*$/;

/** Kind guessed from the method alone. Only used when §1 has not declared the binding. */
function guessKind(method: string): string {
  if (method === "prepare" || D1_WRITE.has(method)) return "database";
  if (method === "getWithMetadata") return "kv";
  if (R2_READ.has(method) || R2_WRITE.has(method)) return "bucket";
  if (method === "send" || method === "sendBatch") return "queue";
  return "kv";
}

/** Operation classification (spec §1): SQL verb for D1, method name otherwise. */
function classifyOp(method: string, sql: string | null): ServiceOp {
  if (method === "prepare") {
    const verb = /^\s*(\w+)/.exec(sql ?? "")?.[1]?.toUpperCase() ?? "";
    if (verb === "SELECT") return "read";
    if (["INSERT", "UPDATE", "DELETE", "CREATE", "DROP", "ALTER", "REPLACE"].includes(verb)) return "write";
    return "touch";
  }
  if (D1_WRITE.has(method) || KV_WRITE.has(method) || R2_WRITE.has(method) || method === "send" || method === "sendBatch") return "write";
  if (KV_READ.has(method) || R2_READ.has(method)) return "read";
  return "touch";
}

const DESTRUCTURED_CACHE = new WeakMap<FileInfo, Set<string>>();

/** Bindings destructured out of `env` in this file: `const { CACHE, RATE_LIMIT } = env`. */
function destructuredBindings(info: FileInfo): Set<string> {
  const cached = DESTRUCTURED_CACHE.get(info);
  if (cached) return cached;
  const out = destructuredBindingsUncached(info);
  DESTRUCTURED_CACHE.set(info, out);
  return out;
}

function destructuredBindingsUncached(info: FileInfo): Set<string> {
  const out = new Set<string>();
  for (const m of info.masked.matchAll(/(?:const|let|var)\s*\{([^}]*)\}\s*=\s*(?:context\s*\.\s*)?env\b/g)) {
    for (const part of (m[1] ?? "").split(",")) {
      const name = part.split(":").pop()?.trim() ?? "";
      if (BINDING_NAME.test(name)) out.add(name);
    }
  }
  return out;
}

interface ServiceHit {
  id: string;
  kind: string;
  name: string;
  binding: string | null;
  op: ServiceOp;
  /** Method called on the binding, or `fetch`. */
  method: string;
  label: string;
  line: number;
  at: number;
  argsFrom: number;
  argsTo: number;
  confidence: Confidence;
  /** Local parameter name the binding arrived under, or null when it was read off `env`. */
  via: string | null;
}

const EMPTY_BOUND: ReadonlyMap<string, string> = new Map();

/**
 * Cloudflare binding operations and outbound `fetch` calls inside a span.
 *
 * Only a binding an operation is performed ON counts. A binding merely named —
 * `Number(env.CHAT_DOC_LIMIT || 4)` — is a §1 concern (it is how the Services page finds
 * an undeclared secret) and is not an operation here: it cannot be labelled read, write
 * or touch, and in the ground-truth chat handler seventeen such config reads competed
 * for the step budget with forty-three real calls.
 *
 * Kinds are guessed from the method when `services` (from §1) does not declare the
 * binding, and such a hit is marked `heuristic` — `CACHE.get` alone cannot tell KV from
 * R2. Anything declared in `wrangler.toml` resolves `exact`.
 */
function serviceHits(
  info: FileInfo,
  sites: readonly CallSite[],
  services: readonly ServiceRef[] | readonly ServiceNode[] | undefined,
  bound: ReadonlyMap<string, string> = EMPTY_BOUND,
): ServiceHit[] {
  const declared = new Map<string, ServiceRef>();
  for (const s of services ?? []) if (s.binding) declared.set(s.binding, s);
  const local = destructuredBindings(info);
  const out: ServiceHit[] = [];
  for (const site of sites) {
    if (site.receiver) {
      const parts = site.receiver.split(".");
      const last = parts[parts.length - 1] ?? "";
      const prev = parts[parts.length - 2] ?? "";
      // A parameter this frame received a binding through: `db.prepare(…)` after a caller
      // passed `env.CHAT_LOGS`. Resolved through one call site, so never `exact`.
      const viaParam = parts.length === 1 ? bound.get(last) ?? null : null;
      const viaEnv = prev === "env" || (parts.length === 1 && local.has(last));
      if (!viaEnv && viaParam === null) continue;
      const binding = viaParam ?? last;
      if (viaParam === null && !BINDING_NAME.test(binding)) continue;
      const sql = site.name === "prepare" ? readStringLiteral(info.src, site.argsFrom) : null;
      const op = classifyOp(site.name, sql);
      const decl = declared.get(binding);
      const kind = decl?.kind ?? guessKind(site.name);
      out.push({
        id: decl?.id ?? `svc:${kind}:${binding}`,
        kind,
        name: decl?.name ?? binding,
        binding,
        op,
        method: site.name,
        // Named for the service, not the local: `CHAT_LOGS.prepare`, with `via` carrying `db`.
        label: `${binding}.${site.name}`,
        line: site.line,
        at: site.at,
        argsFrom: site.argsFrom,
        argsTo: site.argsTo,
        confidence: decl && viaParam === null ? "exact" : "heuristic",
        via: viaParam === null ? null : last,
      });
      continue;
    }
    if (site.name !== "fetch") continue;
    const url = readStringLiteral(info.src, site.argsFrom);
    const host = url ? /^https?:\/\/([^/?#]+)/.exec(url)?.[1] : null;
    if (!host) continue;
    out.push({
      id: `svc:api:${host}`,
      kind: "api",
      name: host,
      binding: null,
      op: "touch",
      method: "fetch",
      label: `fetch ${host}`,
      line: site.line,
      at: site.at,
      argsFrom: site.argsFrom,
      argsTo: site.argsTo,
      confidence: "exact",
      via: null,
    });
  }

  return out;
}

// ---------------------------------------------------------------------------
// Bindings passed as parameters (spec §2, addendum)
// ---------------------------------------------------------------------------

/** `env.CHAT_LOGS` / `context.env.CHAT_LOGS` as a whole expression → the binding name. */
const ENV_EXPR = /^(?:[A-Za-z_$][\w$]*\s*\.\s*)?env\s*\.\s*([A-Z][A-Z0-9_]*)$/;

/** One binding handed to a callee: positionally (`key: null`) or as an object-literal value. */
interface PassedBinding {
  index: number;
  key: string | null;
  binding: string;
}

/**
 * Bindings written into one call's arguments: `f(env.CACHE)` and `f({ db: env.CHAT_LOGS })`,
 * plus the destructured spelling (`const { CACHE } = env` then `f({ db: CACHE })`).
 *
 * Only literal spellings count. An expression that merely *contains* a binding
 * (`f(env.CACHE.get(k))`) is a value read here, not the binding travelling on.
 */
function passedBindings(info: FileInfo, argsFrom: number, argsTo: number, local: ReadonlySet<string>): PassedBinding[] {
  const out: PassedBinding[] = [];
  const args = splitArgs(info.masked, argsFrom, argsTo);
  args.forEach(([s, e], index) => {
    const text = info.masked.slice(s, e).trim();
    const direct = ENV_EXPR.exec(text)?.[1] ?? (local.has(text) ? text : null);
    if (direct) {
      out.push({ index, key: null, binding: direct });
      return;
    }
    if (!text.startsWith("{")) return;
    const open = skipSpace(info.masked, s);
    const close = matchDelim(info.masked, open);
    if (close === -1 || close > e) return;
    for (const [ps, pe] of splitArgs(info.masked, open + 1, close)) {
      const pair = info.masked.slice(ps, pe).trim();
      const colon = topLevelIndex(pair, ":");
      // `{ CACHE }` is shorthand for `{ CACHE: CACHE }`, which is a binding under its own name.
      const key = (colon === -1 ? pair : pair.slice(0, colon)).trim();
      const value = colon === -1 ? pair : pair.slice(colon + 1).trim();
      if (!IDENT_ONLY.test(key)) continue;
      const binding = ENV_EXPR.exec(value)?.[1] ?? (local.has(value) ? value : null);
      if (binding) out.push({ index, key, binding });
    }
  });
  return out;
}

/**
 * The callee's local names for the bindings this call site handed it: one hop of resolution,
 * so `logConversation({ db: env.CHAT_LOGS })` makes `db.prepare(…)` inside `logConversation`
 * a D1 write instead of an anonymous method call.
 *
 * Only the two spellings that can be read without types: a positional parameter takes the
 * argument's binding, and a destructured parameter takes the object-literal key of the same
 * name. A renamed destructure (`{ db: handle }`) binds nothing rather than the wrong name.
 * Every operation found this way is `heuristic` — one call site is not proof that every caller
 * passes the same binding.
 */
function boundParams(info: FileInfo, site: { argsFrom: number; argsTo: number }, callee: Callee, local: ReadonlySet<string>): Map<string, string> {
  const out = new Map<string, string>();
  if (!callee.symbol) return out;
  const passed = passedBindings(info, site.argsFrom, site.argsTo, local);
  if (passed.length === 0) return out;
  const sig = signatureOf(callee.info, callee.symbol);
  if (!sig) return out;
  for (const p of passed) {
    const param = sig.params[p.index];
    if (!param) continue;
    if (p.key === null) {
      if (param.name) out.set(param.name, p.binding);
    } else if (param.name === null && param.fields.includes(p.key)) {
      out.set(p.key, p.binding);
    }
  }
  return out;
}

/** One operation performed on a binding that arrived as a parameter. */
export interface ParamBindingUse {
  /** The file that performs the operation — the callee's, not the caller's. */
  file: string;
  binding: string;
  /** Method called on it: `prepare`, `get`, `put`, … */
  method: string;
  /** Local name the binding arrived under. */
  via: string;
  line: number;
  /** Text from the call's `(` onwards, so a caller can read `prepare("SELECT …")`. */
  after: string;
  /** Where the caller handed the binding over. */
  from: SourceRef;
}

/** Text kept after a resolved call, enough for the SQL of a `prepare`. */
const AFTER_CHARS = 400;

/**
 * Every operation on a binding that reached a function as a parameter, resolved one hop
 * across the repo: `logConversation({ db: env.CHAT_LOGS })` in one file makes the
 * `db.prepare(…)` in another a D1 write, attributed to the file that performs it.
 *
 * This is `services.ts`'s share of the same fix the flow trace applies per step. Only
 * source files are walked — a test fixture cannot establish a service — and every use it
 * returns is name-resolved, so `services.ts` records them as `heuristic`.
 */
export function passedBindingUses(paths: RepoPaths, graph: RepoGraph, opts: { contents?: ReadonlyMap<string, string> } = {}): ParamBindingUse[] {
  const repo = new Repo(paths.root, graph, opts.contents);
  const out: ParamBindingUse[] = [];
  const seen = new Set<string>();
  for (const file of repo.sourceFiles()) {
    const info = repo.info(file);
    if (!info || !info.masked.includes("env")) continue;
    const local = destructuredBindings(info);
    for (const site of callSites(info, 1, info.starts.length)) {
      if (site.receiver !== null) continue;
      if (passedBindings(info, site.argsFrom, site.argsTo, local).length === 0) continue;
      const callee = resolveCallee(repo, info, site.name);
      if (!callee?.symbol) continue;
      const bound = boundParams(info, site, callee, local);
      if (bound.size === 0) continue;
      const inner = callSites(callee.info, callee.symbol.line, callee.symbol.endLine);
      for (const hit of serviceHits(callee.info, inner, undefined, bound)) {
        if (hit.via === null) continue; // the callee's own `env.X` is not this pass's business
        const key = `${callee.file}|${hit.binding}|${hit.method}|${hit.line}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({
          file: callee.file,
          binding: hit.binding ?? "",
          method: hit.method,
          via: hit.via,
          line: hit.line,
          after: callee.info.src.slice(hit.argsFrom - 1, hit.argsFrom + AFTER_CHARS),
          from: { file: info.file, line: site.line },
        });
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Responses
// ---------------------------------------------------------------------------

interface ResponseHit {
  at: number;
  line: number;
  label: string;
  payload: Payload | null;
}

/** `Response.json({…})`, `new Response(…)` and `Response.redirect(…)` inside a span. */
function responseHits(info: FileInfo, startLine: number, endLine: number): ResponseHit[] {
  const from = info.starts[startLine - 1] ?? 0;
  const to = info.starts[endLine] ?? info.masked.length;
  const region = info.masked.slice(from, to);
  const out: ResponseHit[] = [];
  for (const m of region.matchAll(/\b(?:new\s+Response|Response\s*\.\s*(json|redirect))\s*\(/g)) {
    const at = from + (m.index ?? 0);
    const argsFrom = at + (m[0]?.length ?? 0);
    const close = matchDelim(info.masked, argsFrom - 1);
    const label = m[1] ? `Response.${m[1]}` : "new Response";
    let payload: Payload | null = null;
    if (close !== -1) {
      const stringify = /^\s*JSON\s*\.\s*stringify\s*\(/.exec(info.masked.slice(argsFrom, Math.min(argsFrom + 60, close)));
      const bodyFrom = stringify ? argsFrom + stringify[0].length : argsFrom;
      const keys = objectLiteralKeys(info.masked, info.src, bodyFrom, close);
      if (keys && keys.keys.length > 0) {
        payload = {
          fields: keys.keys,
          shape: keys.spread ? `${label} (+ spread)` : label,
          confidence: "exact",
          source: { file: info.file, line: lineAt(info.starts, at) },
        };
      }
    }
    out.push({ at, line: lineAt(info.starts, at), label, payload });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Callee resolution
// ---------------------------------------------------------------------------

interface Callee {
  file: string;
  /** null when the import resolved to a file but no symbol of that name was found. */
  symbol: CodeSymbol | null;
  info: FileInfo;
}

const CALLABLE_KINDS = new Set(["function", "class", "const", "let", "var", "default"]);

/** A plain call resolved to a same-file declaration, or one level through an import edge. */
function resolveCallee(repo: Repo, info: FileInfo, name: string): Callee | null {
  const local = info.symbols.find((s) => s.name === name && CALLABLE_KINDS.has(s.kind));
  if (local) return { file: info.file, symbol: local, info };
  const target = info.imports.get(name);
  if (!target) return null;
  const other = repo.info(target);
  if (!other) return null;
  const wanted = name === "default" ? other.symbols.find((s) => s.isDefault) : other.symbols.find((s) => s.name === name && s.exported);
  return { file: other.file, symbol: wanted ?? null, info: other };
}

// ---------------------------------------------------------------------------
// Tracing
// ---------------------------------------------------------------------------

interface Frame {
  node: string;
  file: string;
  symbol: string;
  start: number;
  end: number;
  hop: number;
  /** Local name → binding, for bindings this frame's caller passed in (one hop only). */
  bound: ReadonlyMap<string, string>;
}

/** Running tally of what the caps cost, collapsed to one entry per (hop, reason). */
class Drops {
  private readonly byKey = new Map<string, FlowDrop>();

  add(hop: number, reason: FlowDrop["reason"], count = 1): void {
    const key = `${hop}|${reason}`;
    const hit = this.byKey.get(key);
    if (hit) hit.count += count;
    else this.byKey.set(key, { hop, count, reason });
  }

  get empty(): boolean {
    return this.byKey.size === 0;
  }

  list(): FlowDrop[] {
    return [...this.byKey.values()].sort((a, b) => a.hop - b.hop || a.reason.localeCompare(b.reason));
  }
}

function clamp(value: number | undefined, fallback: number): number {
  if (value === undefined || !Number.isFinite(value)) return fallback;
  return Math.max(1, Math.min(fallback, Math.floor(value)));
}

/**
 * The payload ladder for one step (spec §2), applied uniformly:
 * request body → object literal at the call site → parameter type → JSDoc → parameter
 * names → null. Rule 2 is skipped for the entry step, which has no call site.
 */
function stepInput(repo: Repo, callee: Callee | null, site: { info: FileInfo; from: number; to: number } | null): Payload | null {
  if (callee?.symbol) {
    const body = requestPayload(callee.info, callee.symbol.line, callee.symbol.endLine);
    if (body) return body;
  }
  if (site) {
    const literal = callSitePayload(site.info, site.from, site.to);
    if (literal) return literal;
  }
  if (callee?.symbol) return signaturePayload(repo, callee.info, callee.symbol);
  return null;
}

function semanticCallee(repo: Repo, record: SymbolRecord): Callee | null {
  const info = repo.info(record.file);
  if (!info) return null;
  const symbol = info.symbols.find((item) => item.id === record.id || item.name === record.qualifiedName) ?? null;
  return { file: record.file, symbol, info };
}

function semanticReturns(repo: Repo, symbolIdValue: string): ReturnVariant[] {
  return repo.semanticSymbol(symbolIdValue)?.returnVariants ?? [];
}

function traceFrom(repo: Repo, entry: DetectedEntry, opts: TraceOptions): Flow {
  const maxSteps = clamp(opts.maxSteps, MAX_FLOW_STEPS);
  const maxHops = clamp(opts.depth, MAX_FLOW_HOPS);
  const perHop = hopBudget(maxSteps, maxHops);
  const respondTo = `resp:${entry.id}`;
  const steps: FlowStep[] = [];
  const services = new Set<string>();
  const drops = new Drops();
  /** Steps drawn at each hop, so one wide hop cannot spend another hop's share. */
  const usedAtHop = new Map<number, number>();
  let depth = 0;

  const entryInfo = repo.info(entry.file);
  if (!entryInfo) {
    return { id: entry.id, entry: entry.node, title: entry.title, method: entry.method, route: entry.route, steps, services: [], servicesBeyondCap: [], depth: 0, truncated: false, dropped: [] };
  }
  const entrySym = entryInfo.symbols.find((s) => s.name === entry.symbol) ?? null;
  const entryRecord = repo.semanticSymbol(entry.node);
  const entryRoute = repo.semantic().routes.find((route) => route.handlerSymbolId === entry.node) ?? null;

  // Step 0: the request arriving at the handler.
  const entryCallee: Callee | null = entrySym ? { file: entry.file, symbol: entrySym, info: entryInfo } : null;
  steps.push({
    from: entry.file,
    to: entry.node,
    kind: "call",
    label: entry.title,
    input: stepInput(repo, entryCallee, null),
    output: entrySym ? outputPayload(repo, entryInfo, entrySym) : null,
    arguments: [],
    requestPayload: entryRoute?.requestShape ?? null,
    servicePayload: null,
    returns: entryRecord?.returnVariants ?? [],
    source: entry.source,
    confidence: "exact",
    via: null,
  });

  const visited = new Set<string>([entry.node]);
  const queue: Frame[] = [{ node: entry.node, file: entry.file, symbol: entry.symbol, start: entry.startLine, end: entry.endLine, hop: 0, bound: EMPTY_BOUND }];

  while (queue.length > 0) {
    const frame = queue.shift();
    if (!frame) break;
    const info = repo.info(frame.file);
    if (!info) continue;
    // The steps this frame draws sit one hop further out than the frame itself.
    const hop = frame.hop + 1;
    const sites = callSites(info, frame.start, frame.end);
    const hits = serviceHits(info, sites, opts.services, frame.bound);
    const serviceAt = new Set(hits.map((h) => h.at));
    const local = destructuredBindings(info);

    interface Event {
      at: number;
      step: FlowStep;
      next?: Frame;
    }
    const events: Event[] = [];

    for (const hit of hits) {
      services.add(hit.id);
      const semanticCall = repo.callAt(info.file, hit.at);
      events.push({
        at: hit.at,
        step: {
          from: frame.node,
          to: hit.id,
          // `touch` has no step kind of its own; it stays a call to the service.
          kind: hit.op === "read" ? "read" : hit.op === "write" ? "write" : "call",
          label: hit.label,
          input: callSitePayload(info, hit.argsFrom, hit.argsTo),
          output: null,
          arguments: semanticCall?.arguments.map((argument) => ({ ...argument, category: "service-payload" })) ?? [],
          requestPayload: null,
          servicePayload: semanticCall?.arguments.find((argument) => argument.shape !== null)?.shape ?? null,
          returns: [],
          source: { file: info.file, line: hit.line },
          confidence: hit.confidence,
          via: hit.via,
        },
      });
    }

    for (const r of responseHits(info, frame.start, frame.end)) {
      const responseVariants = semanticReturns(repo, frame.node).filter((variant) => variant.kind === "http-response" && variant.source.startLine === r.line);
      events.push({
        at: r.at,
        step: {
          from: frame.node,
          to: respondTo,
          kind: "respond",
          label: r.label,
          input: null,
          output: r.payload,
          arguments: [],
          requestPayload: null,
          servicePayload: null,
          returns: responseVariants,
          source: { file: info.file, line: r.line },
          confidence: "exact",
          via: null,
        },
      });
    }

    for (const semanticCall of repo.callsFrom(frame.node)) {
      if (!semanticCall.calleeId || serviceAt.has(semanticCall.source.startOffset)) continue;
      const target = repo.semanticSymbol(semanticCall.calleeId);
      if (!target) continue;
      const callee = semanticCallee(repo, target);
      if (!callee) continue;
      const to = target.id;
      if (to === frame.node) continue;
      const site = sites.find((candidate) => candidate.at === semanticCall.source.startOffset) ?? null;
      const step: FlowStep = {
        from: frame.node,
        to,
        kind: "call",
        label: semanticCall.calleeExpression,
        input: stepInput(repo, callee, site ? { info, from: site.argsFrom, to: site.argsTo } : null),
        output: callee.symbol ? outputPayload(repo, callee.info, callee.symbol) : null,
        arguments: semanticCall.arguments,
        requestPayload: null,
        servicePayload: null,
        returns: target.returnVariants,
        source: { file: info.file, line: semanticCall.source.startLine },
        confidence: "exact",
        via: null,
      };
      const next: Frame = {
            node: to,
            file: callee.file,
            symbol: target.qualifiedName,
            start: target.declaration.startLine,
            end: target.declaration.endLine,
            hop: frame.hop + 1,
            bound: site ? boundParams(info, site, callee, local) : EMPTY_BOUND,
          };
      events.push({ at: semanticCall.source.startOffset, step, next });
    }

    events.sort((a, b) => a.at - b.at);
    const seen = new Set<string>();
    for (const ev of events) {
      // One drawn edge per (kind, target, label): repeated call sites collapse.
      const key = `${ev.step.kind}|${ev.step.to}|${ev.step.label}`;
      if (seen.has(key)) continue;
      seen.add(key);
      // Two budgets, counted separately so the reader is told which one bit. A frame whose
      // step is not drawn is not walked either: an edge into a subtree whose own edge is
      // missing would draw a path the code does not have.
      if (steps.length >= maxSteps) {
        drops.add(hop, "step-cap");
        continue;
      }
      const used = usedAtHop.get(hop) ?? 0;
      if (used >= perHop) {
        drops.add(hop, "hop-budget");
        continue;
      }
      steps.push(ev.step);
      usedAtHop.set(hop, used + 1);
      depth = Math.max(depth, hop);
      if (!ev.next) continue;
      if (visited.has(ev.next.node)) continue; // a cycle is walked once, and that is not truncation
      if (ev.next.hop >= maxHops) {
        // Not expanded, so we cannot say the walk is complete — even if it happens to be.
        drops.add(ev.next.hop + 1, "depth");
        continue;
      }
      visited.add(ev.next.node);
      queue.push(ev.next);
    }
  }

  // `services` was filled when each event was created, but the hop budget can drop an event
  // before it becomes a step. Reporting a service no returned step reaches is a confident lie
  // about where data goes, so the list is rebuilt from the steps that actually survived, and
  // anything the walk saw beyond the caps is reported separately rather than silently merged.
  const reached = new Set<string>();
  for (const step of steps) {
    if (step.to.startsWith("svc:")) reached.add(step.to);
    if (step.from.startsWith("svc:")) reached.add(step.from);
  }
  const beyondCap = Array.from(services).filter((id) => !reached.has(id)).sort();

  return {
    id: entry.id,
    entry: entry.node,
    title: entry.title,
    method: entry.method,
    route: entry.route,
    steps,
    services: Array.from(reached).sort(),
    servicesBeyondCap: beyondCap,
    depth,
    truncated: !drops.empty,
    dropped: drops.list(),
  };
}

/**
 * The flow reachable from one entry point: a directed walk over call and import edges
 * from `entryId` to its sinks — a service operation, a `Response`, or a leaf.
 *
 * `entryId` accepts either the flow id or the entry node id. Capped at
 * `MAX_FLOW_STEPS` steps and `MAX_FLOW_HOPS` hops; `truncated` says when a cap bit
 * rather than the walk being silently cut. Each symbol is expanded once, so a cycle
 * contributes its edge and terminates.
 */
export function traceFlow(paths: RepoPaths, graph: RepoGraph, entryId: string, opts: TraceOptions = {}): Flow {
  const repo = new Repo(paths.root, graph, opts.contents, opts.semanticIndex);
  const entries = detectEntriesInternal(repo);
  const entry = entries.find((e) => e.id === entryId || e.node === entryId);
  if (!entry) throw new Error(`No entry point "${entryId}". Run detectFlows to list them.`);
  return traceFrom(repo, entry, opts);
}

/**
 * Every entry point in the repo, each traced to a summary (spec §2, §3). Pass
 * `trace: false` for the entry list alone when step counts are not needed.
 */
export function detectFlows(paths: RepoPaths, graph: RepoGraph, opts: DetectFlowsOptions = {}): FlowIndex {
  const repo = new Repo(paths.root, graph, opts.contents, opts.semanticIndex);
  const entries = detectEntriesInternal(repo);
  const flows: FlowSummary[] = [];
  if (opts.trace !== false) {
    for (const e of entries) {
      const flow = traceFrom(repo, e, opts);
      flows.push({
        id: flow.id,
        entry: flow.entry,
        title: flow.title,
        kind: e.kind,
        method: flow.method,
        route: flow.route,
        steps: flow.steps.length,
        services: flow.services,
        depth: flow.depth,
        truncated: flow.truncated,
        dropped: flow.dropped,
        source: e.source,
      });
    }
  }
  return { entries: entries.map(publicEntry), flows, generatedAt: nowIso() };
}
