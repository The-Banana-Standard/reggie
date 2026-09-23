import { createHash } from "node:crypto";
import { lstatSync } from "node:fs";
import path from "node:path";
import type { AppliedConceptOverrides } from "./concept-overrides.js";
import type { DataConcept } from "./data-concepts.js";
import type { FlowSummary } from "./flows.js";
import { currentKnowledge, readKnowledge, type KnowledgeCurrent, type KnowledgeRecord } from "./knowledge.js";
import type { KnowledgeInventoryEntry } from "./knowledge-jobs.js";
import type { RepoPaths } from "./paths.js";
import type {
  CallFinding,
  CallSite,
  RouteRecord,
  SemanticIndex,
  SourceSpan,
  SymbolRecord,
  ValidationRule,
  ValueShape,
} from "./semantic-index.js";
import { assertInside, readText } from "./util.js";

export interface SourcePage {
  path: string;
  startLine: number;
  endLine: number;
  totalLines: number;
  text: string;
  revision: string;
  hasBefore: boolean;
  hasAfter: boolean;
}

export class SourceRevisionConflict extends Error {}

export interface EntityKnowledgeView {
  entity: string;
  /** Current source-backed fingerprint used by optimistic saves. */
  fingerprint: string;
  /** Fingerprint attached to the saved prose, when it exists. */
  storedFingerprint: string | null;
  currentFingerprint: string | null;
  revision: string;
  stale: boolean;
  retired: boolean;
  supersededBy: string | null;
  historyCount: number;
  notes: KnowledgeRecord["notes"];
  current: KnowledgeCurrent;
  exists: boolean;
}

export interface CallGraphNode {
  id: string;
  file: string;
  name: string;
  qualifiedName: string;
  kind: SymbolRecord["kind"];
  selected: boolean;
  side: "caller" | "selected" | "callee";
  depth: number;
  label: string;
}

export interface CallGraphEdge {
  id: string;
  source: string;
  target: string;
  callSiteIds: string[];
  kind: "calls";
}

export interface SymbolCallGraph {
  center: string;
  direction: "up" | "down" | "both";
  depth: number;
  nodes: CallGraphNode[];
  edges: CallGraphEdge[];
}

export interface SymbolEntityPage {
  symbol: SymbolRecord;
  parentFile: string;
  source: SourcePage;
  parameters: SymbolRecord["parameters"];
  validations: ValidationRule[];
  returns: SymbolRecord["returnVariants"];
  callers: Array<{ symbol: SymbolRecord; callSites: CallSite[] }>;
  callees: Array<{ symbol: SymbolRecord; callSites: CallSite[] }>;
  unresolved: Array<{ finding: CallFinding; callSite: CallSite | null }>;
  graph: SymbolCallGraph;
  knowledge: EntityKnowledgeView;
}

export interface RouteEntityPage {
  route: RouteRecord;
  handler: SymbolRecord | null;
  middleware: SymbolRecord[];
  clients: Array<{ call: RouteRecord["clientCalls"][number]; caller: SymbolRecord | null }>;
  requestShape: ValueShape | null;
  responses: RouteRecord["responseVariants"];
  validations: ValidationRule[];
  concepts: DataConcept[];
  flows: FlowSummary[];
  services: string[];
  knowledge: EntityKnowledgeView;
}

export interface ConceptEntityPage {
  requestedId: string;
  redirectedFrom: string | null;
  concept: DataConcept;
  validations: ValidationRule[];
  routes: RouteRecord[];
  flows: FlowSummary[];
  symbols: SymbolRecord[];
  knowledge: EntityKnowledgeView;
  override: {
    revision: string;
    redirectFrom: string[];
    mergedFrom: string[];
    splitFrom: string | null;
    splitInto: string[];
    history: AppliedConceptOverrides["history"];
  };
}

function sourceLines(content: string): string[] {
  if (!content) return [];
  const lines = content.replace(/\r\n/g, "\n").split("\n");
  if (lines.at(-1) === "") lines.pop();
  return lines;
}

export function sourceRevision(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

export function normalizeSourcePath(rel: string): string {
  const normalized = rel.replace(/\\/g, "/").replace(/^\.\//, "");
  if (!normalized || path.isAbsolute(normalized) || normalized.split("/").some((part) => part === "" || part === "." || part === "..") || /[\u0000-\u001f\u007f]/.test(normalized)) {
    throw new Error("Source path must be a repository-relative file path.");
  }
  return normalized;
}

function readRegularSource(root: string, rel: string, label: string): string {
  const full = assertInside(root, path.join(root, rel), `${label} path`);
  let stat;
  try {
    stat = lstatSync(full);
  } catch {
    throw new Error(`No such ${label}: ${rel}.`);
  }
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`${label} is not a regular file: ${rel}.`);
  const content = readText(full);
  if (content === null) throw new Error(`No such ${label}: ${rel}.`);
  return content;
}

export function readSourcePage(paths: Pick<RepoPaths, "root">, rel: string, options: { startLine?: number; lineCount?: number; expectedRevision?: string | null } = {}): SourcePage {
  const normalized = normalizeSourcePath(rel);
  const content = readRegularSource(paths.root, normalized, "source file");
  const revision = sourceRevision(content);
  if (options.expectedRevision && options.expectedRevision !== revision) throw new SourceRevisionConflict(`Source changed from ${options.expectedRevision} to ${revision}. Reload before appending another page.`);
  const lines = sourceLines(content);
  const startLine = options.startLine ?? 1;
  const lineCount = options.lineCount ?? 300;
  if (!Number.isInteger(startLine) || startLine < 1 || startLine > Math.max(1, lines.length)) throw new Error("startLine is outside the source file.");
  if (!Number.isInteger(lineCount) || lineCount < 1 || lineCount > 1_000) throw new Error("lineCount must be an integer from 1 to 1000.");
  const startIndex = startLine - 1;
  const selected = lines.slice(startIndex, startIndex + lineCount);
  const endLine = selected.length ? startLine + selected.length - 1 : startLine - 1;
  return {
    path: normalized,
    startLine,
    endLine,
    totalLines: lines.length,
    text: selected.join("\n"),
    revision,
    hasBefore: startLine > 1,
    hasAfter: endLine < lines.length,
  };
}

function sourceForSpan(paths: Pick<RepoPaths, "root">, span: SourceSpan): SourcePage {
  const content = readRegularSource(paths.root, span.file, "symbol source file");
  const text = content.slice(span.startOffset, span.endOffset);
  return {
    path: span.file,
    startLine: span.startLine,
    endLine: span.endLine,
    totalLines: sourceLines(content).length,
    text,
    revision: sourceRevision(content),
    hasBefore: span.startLine > 1,
    hasAfter: span.endLine < sourceLines(content).length,
  };
}

function blankCurrent(entry: KnowledgeInventoryEntry): KnowledgeCurrent {
  return {
    summary: "",
    parameters: entry.expected.parameters.map((item) => ({ ...item })),
    fields: entry.expected.fields.map((item) => ({ ...item })),
    returns: entry.expected.returns.map((item) => ({ ...item })),
    callSites: entry.expected.callSites.map((item) => ({ ...item })),
  };
}

export function entityKnowledge(paths: RepoPaths, entry: KnowledgeInventoryEntry): EntityKnowledgeView {
  const record = readKnowledge(paths, entry.entity, entry.fingerprint);
  return {
    entity: entry.entity,
    fingerprint: entry.fingerprint,
    storedFingerprint: record?.fingerprint ?? null,
    currentFingerprint: record?.currentFingerprint ?? entry.fingerprint,
    revision: record?.revision ?? "missing",
    stale: record?.stale ?? false,
    retired: record?.retired ?? false,
    supersededBy: record?.supersededBy ?? null,
    historyCount: record?.history.length ?? 0,
    notes: record?.notes ?? [],
    current: currentKnowledge(record) ?? blankCurrent(entry),
    exists: Boolean(record?.current),
  };
}

function symbolMap(index: SemanticIndex): Map<string, SymbolRecord> {
  return new Map(index.symbols.map((symbol) => [symbol.id, symbol]));
}

function exactCalls(index: SemanticIndex): CallSite[] {
  return index.calls.filter((call) => call.resolution === "exact" && call.calleeId !== null);
}

export function buildSymbolCallGraph(index: SemanticIndex, centerId: string, options: { depth?: number; direction?: "up" | "down" | "both" } = {}): SymbolCallGraph {
  const symbols = symbolMap(index);
  if (!symbols.has(centerId)) throw new Error(`Unknown symbol ${centerId}.`);
  const depth = Math.max(1, Math.min(3, options.depth ?? 1));
  const direction = options.direction ?? "both";
  const calls = exactCalls(index);
  const seen = new Map<string, { side: CallGraphNode["side"]; depth: number }>([[centerId, { side: "selected", depth: 0 }]]);
  const edges = new Map<string, CallGraphEdge>();
  const walk = (side: "caller" | "callee"): void => {
    if ((side === "caller" && direction === "down") || (side === "callee" && direction === "up")) return;
    let frontier = [centerId];
    for (let hop = 1; hop <= depth; hop += 1) {
      const next: string[] = [];
      for (const current of frontier) {
        const sites = calls.filter((call) => side === "caller" ? call.calleeId === current : call.callerId === current);
        for (const site of sites) {
          const other = side === "caller" ? site.callerId : site.calleeId as string;
          if (!symbols.has(other)) continue;
          const key = `${site.callerId}->${site.calleeId}`;
          const existing = edges.get(key);
          if (existing) existing.callSiteIds.push(site.id);
          else edges.set(key, { id: key, source: site.callerId, target: site.calleeId as string, callSiteIds: [site.id], kind: "calls" });
          if (!seen.has(other)) {
            seen.set(other, { side, depth: hop });
            next.push(other);
          }
        }
      }
      frontier = next;
    }
  };
  walk("caller");
  walk("callee");
  return {
    center: centerId,
    direction,
    depth,
    nodes: [...seen].map(([id, placement]) => {
      const symbol = symbols.get(id)!;
      return { id, file: symbol.file, name: symbol.name, qualifiedName: symbol.qualifiedName, kind: symbol.kind, selected: id === centerId, side: placement.side, depth: placement.depth, label: `${symbol.qualifiedName}\n${path.basename(symbol.file)}` };
    }).sort((a, b) => a.depth - b.depth || a.id.localeCompare(b.id)),
    edges: [...edges.values()].map((edge) => ({ ...edge, callSiteIds: [...new Set(edge.callSiteIds)].sort() })).sort((a, b) => a.id.localeCompare(b.id)),
  };
}

function groupedCalls(index: SemanticIndex, centerId: string, direction: "caller" | "callee"): Array<{ symbol: SymbolRecord; callSites: CallSite[] }> {
  const symbols = symbolMap(index);
  const grouped = new Map<string, CallSite[]>();
  for (const call of exactCalls(index)) {
    if (direction === "caller" && call.calleeId !== centerId) continue;
    if (direction === "callee" && call.callerId !== centerId) continue;
    const id = direction === "caller" ? call.callerId : call.calleeId as string;
    const list = grouped.get(id) ?? [];
    list.push(call);
    grouped.set(id, list);
  }
  return [...grouped].flatMap(([id, callSites]) => {
    const symbol = symbols.get(id);
    return symbol ? [{ symbol, callSites: callSites.sort((a, b) => a.id.localeCompare(b.id)) }] : [];
  }).sort((a, b) => a.symbol.id.localeCompare(b.symbol.id));
}

export function buildSymbolEntityPage(paths: RepoPaths, index: SemanticIndex, entry: KnowledgeInventoryEntry, id: string, options: { depth?: number; direction?: "up" | "down" | "both" } = {}): SymbolEntityPage {
  if (!id.startsWith("sym:") || !id.includes("::")) throw new Error("Symbol ID must use sym:<path>::<qualified-name>.");
  const symbol = index.symbols.find((item) => item.id === id);
  if (!symbol) throw new Error(`Unknown symbol ${id}.`);
  const callsById = new Map(index.calls.map((call) => [call.id, call]));
  const relatedFindings = index.findings.filter((finding) => callsById.get(finding.callSiteId)?.callerId === id);
  return {
    symbol,
    parentFile: symbol.file,
    source: sourceForSpan(paths, symbol.documentedDeclaration),
    parameters: symbol.parameters,
    validations: index.validations.filter((validation) => validation.symbolId === id),
    returns: symbol.returnVariants,
    callers: groupedCalls(index, id, "caller"),
    callees: groupedCalls(index, id, "callee"),
    unresolved: relatedFindings.map((finding) => ({ finding, callSite: callsById.get(finding.callSiteId) ?? null })),
    graph: buildSymbolCallGraph(index, id, options),
    knowledge: entityKnowledge(paths, entry),
  };
}

function matchingFlows(route: RouteRecord, flows: readonly FlowSummary[]): FlowSummary[] {
  return flows.filter((flow) => flow.route === route.path && (flow.method === route.method || flow.method === null || route.method === "ANY"));
}

function combinedRequestShape(route: RouteRecord): ValueShape | null {
  const candidates = [route.requestShape, ...route.clientCalls.map((call) => call.requestShape)].filter((shape): shape is ValueShape => shape !== null);
  if (!candidates.length) return null;
  const merged = structuredClone(candidates[0]!);
  const merge = (target: ValueShape, source: ValueShape): void => {
    for (const field of source.fields) {
      const existing = target.fields.find((item) => item.name === field.name);
      if (!existing) target.fields.push(structuredClone(field));
      else if (existing.shape && field.shape) merge(existing.shape, field.shape);
      else if (!existing.shape && field.shape) existing.shape = structuredClone(field.shape);
      if (existing && !existing.explicitType && field.explicitType) existing.explicitType = structuredClone(field.explicitType);
    }
    for (const element of source.elements) target.elements.push(structuredClone(element));
    for (const variant of source.variants) target.variants.push(structuredClone(variant));
  };
  for (const candidate of candidates.slice(1)) merge(merged, candidate);
  return merged;
}

export function buildRouteEntityPage(paths: RepoPaths, index: SemanticIndex, entry: KnowledgeInventoryEntry, id: string, flows: readonly FlowSummary[] = []): RouteEntityPage {
  if (!id.startsWith("route:")) throw new Error("Route ID must use route:<METHOD>:<path>.");
  const route = index.routes.find((item) => item.id === id);
  if (!route) throw new Error(`Unknown route ${id}.`);
  const symbols = symbolMap(index);
  const routeFlows = matchingFlows(route, flows);
  const symbolIds = new Set([route.handlerSymbolId, ...route.middlewareSymbolIds, ...route.clientCalls.map((call) => call.callerId)].filter((item): item is string => Boolean(item)));
  return {
    route,
    handler: route.handlerSymbolId ? symbols.get(route.handlerSymbolId) ?? null : null,
    middleware: route.middlewareSymbolIds.map((symbolId) => symbols.get(symbolId)).filter((item): item is SymbolRecord => Boolean(item)),
    clients: route.clientCalls.map((call) => ({ call, caller: symbols.get(call.callerId) ?? null })),
    requestShape: combinedRequestShape(route),
    responses: route.responseVariants,
    validations: index.validations.filter((validation) => symbolIds.has(validation.symbolId)),
    concepts: index.concepts.filter((concept) => concept.routeIds.includes(id) || concept.symbolIds.some((symbolId) => symbolIds.has(symbolId))),
    flows: routeFlows,
    services: [...new Set(routeFlows.flatMap((flow) => flow.services))].sort(),
    knowledge: entityKnowledge(paths, entry),
  };
}

export function resolveConceptId(id: string, overrides: AppliedConceptOverrides): { id: string; redirectedFrom: string | null } {
  const target = overrides.redirects[id];
  return target ? { id: target, redirectedFrom: id } : { id, redirectedFrom: null };
}

export function buildConceptEntityPage(paths: RepoPaths, index: SemanticIndex, entry: KnowledgeInventoryEntry, requestedId: string, overrides: AppliedConceptOverrides, flows: readonly FlowSummary[] = []): ConceptEntityPage {
  if (!requestedId.startsWith("concept:")) throw new Error("Concept ID must use concept:<slug>.");
  const resolved = resolveConceptId(requestedId, overrides);
  const concept = index.concepts.find((item) => item.id === resolved.id) ?? overrides.concepts.find((item) => item.id === resolved.id);
  if (!concept) throw new Error(`Unknown concept ${requestedId}.`);
  const symbolIds = new Set(concept.symbolIds);
  const routeIds = new Set(concept.routeIds);
  const redirectFrom = Object.entries(overrides.redirects).filter(([, target]) => target === concept.id).map(([source]) => source).sort();
  return {
    requestedId,
    redirectedFrom: resolved.redirectedFrom,
    concept,
    validations: index.validations.filter((validation) => concept.validationIds.includes(validation.id)),
    routes: index.routes.filter((route) => routeIds.has(route.id)),
    flows: flows.filter((flow) => symbolIds.has(flow.entry) || flow.route && index.routes.some((route) => routeIds.has(route.id) && route.path === flow.route)),
    symbols: index.symbols.filter((symbol) => symbolIds.has(symbol.id)),
    knowledge: entityKnowledge(paths, entry),
    override: {
      revision: overrides.revision,
      redirectFrom,
      mergedFrom: overrides.mergedFrom[concept.id] ?? [],
      splitFrom: overrides.splitFrom[concept.id] ?? null,
      splitInto: overrides.splitInto[concept.id] ?? [],
      history: overrides.history.filter((item) => item.targetId === concept.id || item.sourceIds.includes(concept.id)),
    },
  };
}
