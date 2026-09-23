import { createHash } from "node:crypto";
import type { DataConcept, ConceptLink, ConceptOccurrence } from "./data-concepts.js";
import { commitKnowledgeArtifacts } from "./knowledge.js";
import type { RepoPaths } from "./paths.js";
import type { ReggieConfig } from "./people.js";
import { readText } from "./util.js";

export interface ConceptMergeOverride {
  targetId: string;
  sourceIds: string[];
  canonicalName: string;
  at: string;
  by: string;
  reason: string;
}

export interface ConceptSplitOverride {
  sourceId: string;
  targetId: string;
  canonicalName: string;
  occurrenceIds: string[];
  at: string;
  by: string;
  reason: string;
}

export interface ConceptOverrideHistory {
  action: "merge" | "split";
  at: string;
  by: string;
  reason: string;
  priorRevision: string;
  revision: string;
  targetId: string;
  sourceIds: string[];
  occurrenceIds: string[];
}

export interface ConceptOverrideFile {
  version: 1;
  revision: string;
  merges: ConceptMergeOverride[];
  splits: ConceptSplitOverride[];
  history: ConceptOverrideHistory[];
}

export interface AppliedConceptOverrides {
  concepts: DataConcept[];
  redirects: Record<string, string>;
  mergedFrom: Record<string, string[]>;
  splitFrom: Record<string, string>;
  splitInto: Record<string, string[]>;
  revision: string;
  history: ConceptOverrideHistory[];
}

export interface ConceptOverrideActor {
  expectedRevision: string;
  by: string;
  reason: string;
}

export interface MergeConceptInput extends ConceptOverrideActor {
  targetId: string;
  sourceIds: string[];
  canonicalName?: string;
}

export interface SplitConceptInput extends ConceptOverrideActor {
  sourceId: string;
  targetId: string;
  canonicalName: string;
  occurrenceIds: string[];
}

export interface ConceptOverrideCommitResult {
  commit: string;
  file: ConceptOverrideFile;
  applied: AppliedConceptOverrides;
}

const EMPTY: ConceptOverrideFile = { version: 1, revision: "missing", merges: [], splits: [], history: [] };
const CONCEPT_ID = /^concept:[a-z0-9][a-z0-9-]{0,119}$/;
const MAX_ITEMS = 10_000;
const MAX_TEXT = 1_000;

function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object.`);
  return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, allowed: readonly string[], label: string): void {
  const extra = Object.keys(value).filter((key) => !allowed.includes(key));
  if (extra.length) throw new Error(`${label} has unsupported fields: ${extra.join(", ")}`);
}

function text(value: unknown, label: string, max = MAX_TEXT): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} must be non-empty text.`);
  const out = value.trim();
  if (out.length > max) throw new Error(`${label} exceeds ${max} characters.`);
  if (/[\u0000-\u001f\u007f]/.test(out)) throw new Error(`${label} contains control characters.`);
  return out;
}

function conceptId(value: unknown, label: string): string {
  const id = text(value, label, 128);
  if (!CONCEPT_ID.test(id)) throw new Error(`${label} must be a canonical concept:<slug> ID.`);
  return id;
}

function textList(value: unknown, label: string, item: (value: unknown, label: string) => string): string[] {
  if (!Array.isArray(value)) throw new Error(`${label} must be a list.`);
  if (value.length > MAX_ITEMS) throw new Error(`${label} exceeds ${MAX_ITEMS} items.`);
  const out = value.map((entry, index) => item(entry, `${label}[${index}]`));
  if (new Set(out).size !== out.length) throw new Error(`${label} contains duplicates.`);
  return out;
}

function recordList<T>(value: unknown, label: string, parse: (value: unknown, index: number) => T): T[] {
  if (!Array.isArray(value)) throw new Error(`${label} must be a list.`);
  if (value.length > MAX_ITEMS) throw new Error(`${label} exceeds ${MAX_ITEMS} items.`);
  return value.map((entry, index) => parse(entry, index));
}

function parseMerge(value: unknown, index: number): ConceptMergeOverride {
  const row = object(value, `merges[${index}]`);
  exactKeys(row, ["targetId", "sourceIds", "canonicalName", "at", "by", "reason"], `merges[${index}]`);
  return {
    targetId: conceptId(row.targetId, `merges[${index}].targetId`),
    sourceIds: textList(row.sourceIds, `merges[${index}].sourceIds`, conceptId),
    canonicalName: text(row.canonicalName, `merges[${index}].canonicalName`),
    at: text(row.at, `merges[${index}].at`),
    by: text(row.by, `merges[${index}].by`),
    reason: text(row.reason, `merges[${index}].reason`),
  };
}

function parseSplit(value: unknown, index: number): ConceptSplitOverride {
  const row = object(value, `splits[${index}]`);
  exactKeys(row, ["sourceId", "targetId", "canonicalName", "occurrenceIds", "at", "by", "reason"], `splits[${index}]`);
  return {
    sourceId: conceptId(row.sourceId, `splits[${index}].sourceId`),
    targetId: conceptId(row.targetId, `splits[${index}].targetId`),
    canonicalName: text(row.canonicalName, `splits[${index}].canonicalName`),
    occurrenceIds: textList(row.occurrenceIds, `splits[${index}].occurrenceIds`, (entry, label) => text(entry, label, 500)),
    at: text(row.at, `splits[${index}].at`),
    by: text(row.by, `splits[${index}].by`),
    reason: text(row.reason, `splits[${index}].reason`),
  };
}

function parseHistory(value: unknown, index: number): ConceptOverrideHistory {
  const row = object(value, `history[${index}]`);
  exactKeys(row, ["action", "at", "by", "reason", "priorRevision", "revision", "targetId", "sourceIds", "occurrenceIds"], `history[${index}]`);
  if (row.action !== "merge" && row.action !== "split") throw new Error(`history[${index}].action must be merge or split.`);
  return {
    action: row.action,
    at: text(row.at, `history[${index}].at`),
    by: text(row.by, `history[${index}].by`),
    reason: text(row.reason, `history[${index}].reason`),
    priorRevision: text(row.priorRevision, `history[${index}].priorRevision`),
    revision: text(row.revision, `history[${index}].revision`),
    targetId: conceptId(row.targetId, `history[${index}].targetId`),
    sourceIds: textList(row.sourceIds, `history[${index}].sourceIds`, conceptId),
    occurrenceIds: textList(row.occurrenceIds, `history[${index}].occurrenceIds`, (entry, label) => text(entry, label, 500)),
  };
}

export function validateConceptOverrides(value: unknown): ConceptOverrideFile {
  const root = object(value, "Concept overrides");
  exactKeys(root, ["version", "revision", "merges", "splits", "history"], "Concept overrides");
  if (root.version !== 1) throw new Error("Concept overrides version must be 1.");
  const merges = recordList(root.merges, "merges", parseMerge);
  const splits = recordList(root.splits, "splits", parseSplit);
  const history = recordList(root.history, "history", parseHistory);
  return { version: 1, revision: text(root.revision, "revision"), merges, splits, history };
}

export function readConceptOverrides(paths: Pick<RepoPaths, "concepts">): ConceptOverrideFile {
  const raw = readText(paths.concepts);
  if (raw === null || !raw.trim()) return structuredClone(EMPTY);
  try {
    return validateConceptOverrides(JSON.parse(raw));
  } catch (error) {
    throw new Error(`Invalid ${paths.concepts}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function unique(values: Iterable<string>): string[] {
  return [...new Set(values)].sort((a, b) => a.localeCompare(b));
}

function rebuildConcept(id: string, canonicalName: string, occurrences: ConceptOccurrence[], links: ConceptLink[], aliases: string[] = []): DataConcept {
  const members = new Set(occurrences.map((item) => item.id));
  const keptLinks = links.filter((link) => members.has(link.from) && members.has(link.to));
  return {
    id,
    canonicalName,
    aliases: unique([...aliases, canonicalName, ...occurrences.flatMap((item) => [item.name, item.path.at(-1) ?? ""]).filter(Boolean)]),
    occurrences: [...occurrences].sort((a, b) => a.source.file.localeCompare(b.source.file) || a.source.line - b.source.line || a.id.localeCompare(b.id)),
    links: keptLinks,
    explicitTypes: occurrences.filter((item): item is ConceptOccurrence & { explicitType: string } => item.explicitType !== null).map((item) => ({ occurrenceId: item.id, type: item.explicitType })),
    validationIds: unique(occurrences.flatMap((item) => item.validationIds)),
    transformations: unique(keptLinks.map((link) => link.transformation).filter((item): item is string => item !== null)),
    routeIds: unique(occurrences.flatMap((item) => item.routeIds)),
    symbolIds: unique(occurrences.map((item) => item.symbolId).filter((item): item is string => item !== null)),
  };
}

function resolveRedirect(id: string, redirects: Record<string, string>): string {
  const seen = new Set<string>();
  let current = id;
  while (redirects[current] && !seen.has(current)) {
    seen.add(current);
    current = redirects[current] as string;
  }
  return current;
}

/** Apply explicit splits first, then merges; old merged IDs remain as redirects and history. */
export function applyConceptOverrides(staticConcepts: readonly DataConcept[], file: ConceptOverrideFile): AppliedConceptOverrides {
  const concepts = new Map(staticConcepts.map((concept) => [concept.id, structuredClone(concept)]));
  const redirects: Record<string, string> = {};
  const mergedFrom: Record<string, string[]> = {};
  const splitFrom: Record<string, string> = {};
  const splitInto: Record<string, string[]> = {};

  for (const split of file.splits) {
    const sourceId = resolveRedirect(split.sourceId, redirects);
    const source = concepts.get(sourceId);
    if (!source || concepts.has(split.targetId)) continue;
    const selected = new Set(split.occurrenceIds);
    const moved = source.occurrences.filter((item) => selected.has(item.id));
    const remaining = source.occurrences.filter((item) => !selected.has(item.id));
    if (!moved.length || !remaining.length || moved.length !== selected.size) continue;
    concepts.set(sourceId, rebuildConcept(source.id, source.canonicalName, remaining, source.links, source.aliases));
    concepts.set(split.targetId, rebuildConcept(split.targetId, split.canonicalName, moved, source.links));
    splitFrom[split.targetId] = sourceId;
    splitInto[sourceId] = unique([...(splitInto[sourceId] ?? []), split.targetId]);
  }

  for (const merge of file.merges) {
    const targetId = resolveRedirect(merge.targetId, redirects);
    const sourceIds = unique(merge.sourceIds.map((id) => resolveRedirect(id, redirects)).filter((id) => id !== targetId));
    const members = [targetId, ...sourceIds].map((id) => concepts.get(id)).filter((item): item is DataConcept => Boolean(item));
    if (members.length < 2) continue;
    const combined = rebuildConcept(
      targetId,
      merge.canonicalName,
      members.flatMap((item) => item.occurrences),
      members.flatMap((item) => item.links),
      members.flatMap((item) => item.aliases),
    );
    concepts.set(targetId, combined);
    for (const sourceId of sourceIds) {
      concepts.delete(sourceId);
      redirects[sourceId] = targetId;
    }
    mergedFrom[targetId] = unique([...(mergedFrom[targetId] ?? []), ...sourceIds]);
  }

  for (const id of Object.keys(redirects)) redirects[id] = resolveRedirect(redirects[id] as string, redirects);
  return {
    concepts: [...concepts.values()].sort((a, b) => a.canonicalName.localeCompare(b.canonicalName) || a.id.localeCompare(b.id)),
    redirects,
    mergedFrom,
    splitFrom,
    splitInto,
    revision: file.revision,
    history: [...file.history],
  };
}

function revisionFor(prior: string, action: unknown, at: string): string {
  return `concepts-${createHash("sha256").update(JSON.stringify({ prior, action, at })).digest("hex").slice(0, 24)}`;
}

function assertExpected(file: ConceptOverrideFile, expected: string): void {
  if (file.revision !== expected) throw new Error(`Concept override revision conflict: expected ${expected}, current ${file.revision}.`);
}

function writeOverrides(paths: RepoPaths, config: ReggieConfig, next: ConceptOverrideFile, action: string): { commit: string; file: ConceptOverrideFile } {
  const content = `${JSON.stringify(next, null, 2)}\n`;
  const result = commitKnowledgeArtifacts(paths, config, [{ file: paths.concepts, content, label: "data concept overrides" }], `knowledge: ${action}`);
  return { commit: result.commit, file: readConceptOverrides(paths) };
}

export function mergeConcepts(paths: RepoPaths, config: ReggieConfig, staticConcepts: readonly DataConcept[], input: MergeConceptInput, options: { now?: Date } = {}): ConceptOverrideCommitResult {
  const file = readConceptOverrides(paths);
  assertExpected(file, input.expectedRevision);
  const applied = applyConceptOverrides(staticConcepts, file);
  const targetId = conceptId(input.targetId, "targetId");
  const sourceIds = textList(input.sourceIds, "sourceIds", conceptId).filter((id) => id !== targetId);
  if (!applied.concepts.some((item) => item.id === targetId)) throw new Error(`Unknown target concept ${targetId}.`);
  if (!sourceIds.length) throw new Error("A concept merge needs at least one source distinct from its target.");
  for (const id of sourceIds) if (!applied.concepts.some((item) => item.id === id)) throw new Error(`Unknown source concept ${id}.`);
  const target = applied.concepts.find((item) => item.id === targetId)!;
  const at = (options.now ?? new Date()).toISOString();
  const merge: ConceptMergeOverride = {
    targetId,
    sourceIds,
    canonicalName: input.canonicalName ? text(input.canonicalName, "canonicalName") : target.canonicalName,
    at,
    by: text(input.by, "by"),
    reason: text(input.reason, "reason"),
  };
  const revision = revisionFor(file.revision, merge, at);
  const history: ConceptOverrideHistory = { action: "merge", at, by: merge.by, reason: merge.reason, priorRevision: file.revision, revision, targetId, sourceIds, occurrenceIds: [] };
  const written = writeOverrides(paths, config, { ...file, revision, merges: [...file.merges, merge], history: [...file.history, history] }, `merge concepts into ${targetId}`);
  return { ...written, applied: applyConceptOverrides(staticConcepts, written.file) };
}

export function splitConcept(paths: RepoPaths, config: ReggieConfig, staticConcepts: readonly DataConcept[], input: SplitConceptInput, options: { now?: Date } = {}): ConceptOverrideCommitResult {
  const file = readConceptOverrides(paths);
  assertExpected(file, input.expectedRevision);
  const applied = applyConceptOverrides(staticConcepts, file);
  const sourceId = conceptId(input.sourceId, "sourceId");
  const targetId = conceptId(input.targetId, "targetId");
  if (applied.concepts.some((item) => item.id === targetId) || applied.redirects[targetId]) throw new Error(`Concept ${targetId} already exists.`);
  const source = applied.concepts.find((item) => item.id === sourceId);
  if (!source) throw new Error(`Unknown source concept ${sourceId}.`);
  const occurrenceIds = textList(input.occurrenceIds, "occurrenceIds", (entry, label) => text(entry, label, 500));
  const members = new Set(source.occurrences.map((item) => item.id));
  for (const id of occurrenceIds) if (!members.has(id)) throw new Error(`Occurrence ${id} does not belong to ${sourceId}.`);
  if (!occurrenceIds.length || occurrenceIds.length >= source.occurrences.length) throw new Error("A split must move at least one occurrence and leave at least one on the source concept.");
  const at = (options.now ?? new Date()).toISOString();
  const split: ConceptSplitOverride = {
    sourceId,
    targetId,
    canonicalName: text(input.canonicalName, "canonicalName"),
    occurrenceIds,
    at,
    by: text(input.by, "by"),
    reason: text(input.reason, "reason"),
  };
  const revision = revisionFor(file.revision, split, at);
  const history: ConceptOverrideHistory = { action: "split", at, by: split.by, reason: split.reason, priorRevision: file.revision, revision, targetId, sourceIds: [sourceId], occurrenceIds };
  const next = { ...file, revision, splits: [...file.splits, split], history: [...file.history, history] };
  const preview = applyConceptOverrides(staticConcepts, next).concepts.find((concept) => concept.id === targetId);
  if (!preview || preview.occurrences.length !== occurrenceIds.length || !occurrenceIds.every((id) => preview.occurrences.some((occurrence) => occurrence.id === id))) {
    throw new Error("This split cannot be applied before the existing merges. Split the original source concept or undo its merge first.");
  }
  const written = writeOverrides(paths, config, next, `split ${targetId} from ${sourceId}`);
  return { ...written, applied: applyConceptOverrides(staticConcepts, written.file) };
}
