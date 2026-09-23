import { randomUUID } from "node:crypto";
import { existsSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { buildGraph } from "./graph.js";
import { currentBranch, git } from "./git.js";
import { generateKnowledge, validateGeneratedKnowledge, type GeneratedKnowledge, type KnowledgeAgent, type KnowledgePromptEntity } from "./knowledge-agents.js";
import {
  assertKnowledgeIntegrationCheckout,
  evidenceFingerprint,
  readKnowledge,
  saveKnowledgeBatch,
  type KnowledgeCurrent,
  type KnowledgeDescription,
  type KnowledgeRecord,
} from "./knowledge.js";
import { allNoteFiles } from "./notes.js";
import type { RepoPaths } from "./paths.js";
import type { ReggieConfig } from "./people.js";
import { buildSemanticIndex, type CallSite, type SemanticIndex, type SymbolRecord, type ValueShape } from "./semantic-index.js";
import { ensureDir, readText, relPosix } from "./util.js";

const MAX_ENTITY_SOURCE = 60_000;
const MAX_CHUNK_ENTITIES = 8;
const MAX_CHUNK_BYTES = 180_000;

export type KnowledgeState = "new" | "fresh" | "stale" | "retired";

export interface KnowledgeInventoryEntry extends KnowledgePromptEntity {
  sourceFiles: string[];
  symbolIds: string[];
  revision: string;
  state: KnowledgeState;
}

export interface KnowledgePreview {
  agent: KnowledgeAgent;
  entities: number;
  newEntities: number;
  staleEntities: number;
  files: number;
  symbols: number;
  expectedChunks: number;
  commitBehavior: "one knowledge-only commit after every chunk validates";
  entityIds: string[];
}

export type KnowledgeJobStatus = "awaiting-confirmation" | "running" | "failed" | "completed";
export type KnowledgeChunkStatus = "pending" | "completed" | "failed";

export interface KnowledgeJobChunk {
  index: number;
  entityIds: string[];
  status: KnowledgeChunkStatus;
  records: GeneratedKnowledge[];
  error: string | null;
}

export interface KnowledgeJob {
  id: string;
  status: KnowledgeJobStatus;
  agent: KnowledgeAgent;
  createdAt: string;
  confirmedAt: string | null;
  updatedAt: string;
  codeRevision: string;
  branch: string;
  preview: KnowledgePreview;
  targets: Array<{ entity: string; fingerprint: string; revision: string }>;
  chunks: KnowledgeJobChunk[];
  completedChunks: number;
  failures: string[];
  resumable: boolean;
  commit: string | null;
}

export type KnowledgeGenerator = (agent: KnowledgeAgent, entities: KnowledgePromptEntity[]) => GeneratedKnowledge[];

export interface InventoryOptions {
  /** Selected entities for an incremental refresh. Fresh records are included when explicitly selected. */
  entities?: string[];
  /** Include every record, not only new and stale records. */
  force?: boolean;
}

function truncateSource(text: string): string {
  if (text.length <= MAX_ENTITY_SOURCE) return text;
  const half = Math.floor(MAX_ENTITY_SOURCE / 2);
  return `${text.slice(0, half)}\n\n/* Reggie omitted ${text.length - MAX_ENTITY_SOURCE} middle characters for this bounded knowledge prompt. */\n\n${text.slice(-half)}`;
}

function sourceSlice(paths: RepoPaths, file: string, start?: number, end?: number): string {
  const text = readText(path.join(paths.root, file)) ?? "";
  return truncateSource(start === undefined ? text : text.slice(start, end));
}

function shapeDescriptions(shape: ValueShape | null, prefix: string): KnowledgeDescription[] {
  if (!shape) return [];
  const out: KnowledgeDescription[] = [];
  const visit = (value: ValueShape, pathParts: string[]) => {
    for (const field of value.fields) {
      const next = [...pathParts, field.name];
      out.push({ id: `${prefix}:${next.join(".")}`, description: "", explicitType: field.explicitType?.text ?? null });
      if (field.shape) visit(field.shape, next);
    }
    value.elements.forEach((element, index) => visit(element, [...pathParts, `[${index}]`]));
    value.variants.forEach((variant, index) => visit(variant, [...pathParts, `variant-${index + 1}`]));
  };
  visit(shape, []);
  return out;
}

function uniqueDescriptions(items: KnowledgeDescription[]): KnowledgeDescription[] {
  const out = new Map<string, KnowledgeDescription>();
  for (const item of items) {
    const previous = out.get(item.id);
    if (!previous || (previous.explicitType === null && item.explicitType !== null)) out.set(item.id, item);
  }
  return [...out.values()];
}

function expectedForSymbol(symbol: SymbolRecord, calls: CallSite[]): KnowledgePromptEntity["expected"] {
  const parameters = symbol.parameters.map((parameter) => ({
    id: `parameter:${parameter.index}:${parameter.name ?? (parameter.bindingPaths.map((parts) => parts.join(".")).join("|") || "anonymous")}`,
    description: "",
    explicitType: parameter.explicitType?.text ?? null,
  }));
  const fields = symbol.parameters.flatMap((parameter) => shapeDescriptions(parameter.shape, `parameter:${parameter.index}`));
  const returns = symbol.returnVariants.map((variant) => ({ id: variant.id, description: "", explicitType: variant.explicitType?.text ?? symbol.explicitReturnType?.text ?? null }));
  const callSites = calls
    .filter((call) => call.callerId === symbol.id || call.calleeId === symbol.id)
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((call) => ({ id: call.id, description: "", explicitType: null }));
  return { parameters, fields, returns, callSites };
}

function emptyExpected(): KnowledgePromptEntity["expected"] {
  return { parameters: [], fields: [], returns: [], callSites: [] };
}

function entryState(record: KnowledgeRecord | null): KnowledgeState {
  if (record?.retired) return "retired";
  if (!record?.current) return "new";
  return record.stale ? "stale" : "fresh";
}

function entry(base: Omit<KnowledgeInventoryEntry, "revision" | "state">, paths: RepoPaths): KnowledgeInventoryEntry {
  const record = readKnowledge(paths, base.entity, base.fingerprint);
  return { ...base, revision: record?.revision ?? "missing", state: entryState(record) };
}

function directoryNames(files: readonly string[]): string[] {
  const dirs = new Set<string>();
  for (const file of files) {
    const parts = file.split("/");
    for (let i = 1; i < parts.length; i += 1) dirs.add(`${parts.slice(0, i).join("/")}/`);
  }
  return [...dirs].sort();
}

/** Build source-backed knowledge targets for every tracked first-party JS/TS role and existing non-code note entity. */
export function buildKnowledgeInventory(paths: RepoPaths, index: SemanticIndex): KnowledgeInventoryEntry[] {
  const out: KnowledgeInventoryEntry[] = [];
  const fileByName = new Map(index.files.map((file) => [file.file, file]));
  const allFileProof = index.files.map((file) => ({ file: file.file, fingerprint: file.fingerprint, role: file.codeRole }));
  const repoFingerprint = evidenceFingerprint(allFileProof);
  out.push(entry({
    entity: "_repo",
    kind: "repo",
    fingerprint: repoFingerprint,
    role: null,
    source: "",
    facts: { files: allFileProof, routes: index.routes.map((route) => route.id), concepts: index.concepts.map((concept) => concept.id) },
    expected: emptyExpected(),
    sourceFiles: index.files.map((file) => file.file),
    symbolIds: index.symbols.map((symbol) => symbol.id),
  }, paths));

  for (const directory of directoryNames(index.files.map((file) => file.file))) {
    const files = index.files.filter((file) => file.file.startsWith(directory));
    out.push(entry({
      entity: directory,
      kind: "folder",
      fingerprint: evidenceFingerprint(files.map((file) => ({ file: file.file, fingerprint: file.fingerprint }))),
      role: null,
      source: "",
      facts: { files: files.map((file) => ({ file: file.file, role: file.codeRole })) },
      expected: emptyExpected(),
      sourceFiles: files.map((file) => file.file),
      symbolIds: index.symbols.filter((symbol) => symbol.file.startsWith(directory)).map((symbol) => symbol.id),
    }, paths));
  }

  for (const file of index.files) {
    const symbols = index.symbols.filter((symbol) => symbol.file === file.file);
    out.push(entry({
      entity: file.file,
      kind: "file",
      fingerprint: file.fingerprint,
      role: file.codeRole,
      source: sourceSlice(paths, file.file),
      facts: { symbols: symbols.map((symbol) => ({ id: symbol.id, kind: symbol.kind, exported: symbol.exported })) },
      expected: emptyExpected(),
      sourceFiles: [file.file],
      symbolIds: symbols.map((symbol) => symbol.id),
    }, paths));
  }

  for (const symbol of index.symbols) {
    const calls = index.calls.filter((call) => call.callerId === symbol.id || call.calleeId === symbol.id);
    out.push(entry({
      entity: symbol.id,
      kind: "symbol",
      fingerprint: symbol.fingerprint,
      role: fileByName.get(symbol.file)?.codeRole ?? null,
      source: sourceSlice(paths, symbol.file, symbol.documentedDeclaration.startOffset, symbol.documentedDeclaration.endOffset),
      facts: {
        symbol,
        calls,
        validations: index.validations.filter((validation) => validation.symbolId === symbol.id),
      },
      expected: expectedForSymbol(symbol, calls),
      sourceFiles: [symbol.file],
      symbolIds: [symbol.id],
    }, paths));
  }

  for (const route of index.routes) {
    const handler = route.handlerSymbolId ? index.symbols.find((symbol) => symbol.id === route.handlerSymbolId) : null;
    out.push(entry({
      entity: route.id,
      kind: "route",
      fingerprint: evidenceFingerprint(route),
      role: "production",
      source: handler ? sourceSlice(paths, handler.file, handler.documentedDeclaration.startOffset, handler.documentedDeclaration.endOffset) : "",
      facts: route,
      expected: {
        parameters: [],
        fields: uniqueDescriptions([
          ...shapeDescriptions(route.requestShape, "request"),
          ...route.clientCalls.flatMap((call) => shapeDescriptions(call.requestShape, "request")),
        ]),
        returns: route.responseVariants.map((variant) => ({ id: variant.id, description: "", explicitType: variant.explicitType?.text ?? null })),
        callSites: route.clientCalls.map((call) => ({ id: call.callSiteId, description: "", explicitType: null })),
      },
      sourceFiles: [...new Set([route.source.file, ...route.clientCalls.map((call) => call.source.file)])],
      symbolIds: [route.handlerSymbolId, ...route.middlewareSymbolIds, ...route.clientCalls.map((call) => call.callerId)].filter((value): value is string => Boolean(value)),
    }, paths));
  }

  for (const concept of index.concepts) {
    out.push(entry({
      entity: concept.id,
      kind: "concept",
      fingerprint: evidenceFingerprint(concept),
      role: null,
      source: "",
      facts: concept,
      expected: {
        parameters: [],
        fields: concept.occurrences.map((occurrence) => ({ id: occurrence.id, description: "", explicitType: occurrence.explicitType })),
        returns: [],
        callSites: [],
      },
      sourceFiles: [...new Set(concept.occurrences.map((occurrence) => occurrence.source.file))],
      symbolIds: concept.symbolIds,
    }, paths));
  }

  const seen = new Set(out.map((item) => item.entity));
  for (const note of allNoteFiles(paths)) {
    if (seen.has(note.entity)) continue;
    const prefix = note.entity.split(":", 1)[0] ?? "";
    if (!["service", "store", "env", "environment"].includes(prefix)) continue;
    const sourceFiles = [...new Set(note.entries.flatMap((item) => item.sources).map((source) => source.split(":", 1)[0] ?? "").filter((file) => fileByName.has(file)))];
    const fingerprint = evidenceFingerprint({ entity: note.entity, sources: sourceFiles.map((file) => ({ file, fingerprint: fileByName.get(file)?.fingerprint })) });
    out.push(entry({
      entity: note.entity,
      kind: prefix === "env" ? "environment" : prefix,
      fingerprint,
      role: null,
      source: sourceFiles.map((file) => `// ${file}\n${sourceSlice(paths, file)}`).join("\n\n"),
      facts: { notes: note.entries },
      expected: emptyExpected(),
      sourceFiles,
      symbolIds: [],
    }, paths));
  }
  return out.sort((a, b) => a.entity.localeCompare(b.entity));
}

export function buildRepositorySemanticIndex(paths: RepoPaths): SemanticIndex {
  return buildSemanticIndex(paths, buildGraph(paths));
}

function selectedInventory(all: KnowledgeInventoryEntry[], options: InventoryOptions): KnowledgeInventoryEntry[] {
  const selected = options.entities ? new Set(options.entities) : null;
  if (selected) {
    const found = all.filter((item) => selected.has(item.entity) && item.state !== "retired");
    const missing = [...selected].filter((entity) => !all.some((item) => item.entity === entity));
    if (missing.length > 0) throw new Error(`Unknown knowledge entities: ${missing.join(", ")}`);
    return found;
  }
  return all.filter((item) => item.state !== "retired" && (options.force || item.state === "new" || item.state === "stale"));
}

function chunkEntries(entries: KnowledgeInventoryEntry[]): KnowledgeInventoryEntry[][] {
  const chunks: KnowledgeInventoryEntry[][] = [];
  let current: KnowledgeInventoryEntry[] = [];
  let bytes = 0;
  for (const entry of entries) {
    const size = Buffer.byteLength(JSON.stringify(entry));
    if (size > MAX_CHUNK_BYTES) throw new Error(`${entry.entity} exceeds the bounded knowledge chunk size.`);
    if (current.length > 0 && (current.length >= MAX_CHUNK_ENTITIES || bytes + size > MAX_CHUNK_BYTES)) {
      chunks.push(current);
      current = [];
      bytes = 0;
    }
    current.push(entry);
    bytes += size;
  }
  if (current.length > 0) chunks.push(current);
  return chunks;
}

export function readLastKnowledgeAgent(paths: RepoPaths): KnowledgeAgent {
  const value = readText(paths.knowledgeAgent)?.trim();
  return value === "claude" ? "claude" : "codex";
}

function writeLastKnowledgeAgent(paths: RepoPaths, agent: KnowledgeAgent): void {
  ensureDir(path.dirname(paths.knowledgeAgent));
  writeFileSync(paths.knowledgeAgent, `${agent}\n`, "utf8");
}

export function previewKnowledgeJob(paths: RepoPaths, index: SemanticIndex, options: InventoryOptions & { agent?: KnowledgeAgent } = {}): { preview: KnowledgePreview; entries: KnowledgeInventoryEntry[][] } {
  const agent = options.agent ?? readLastKnowledgeAgent(paths);
  const entries = selectedInventory(buildKnowledgeInventory(paths, index), options);
  const chunks = chunkEntries(entries);
  return {
    preview: {
      agent,
      entities: entries.length,
      newEntities: entries.filter((item) => item.state === "new").length,
      staleEntities: entries.filter((item) => item.state === "stale").length,
      files: new Set(entries.flatMap((item) => item.sourceFiles)).size,
      symbols: new Set(entries.flatMap((item) => item.symbolIds)).size,
      expectedChunks: chunks.length,
      commitBehavior: "one knowledge-only commit after every chunk validates",
      entityIds: entries.map((item) => item.entity),
    },
    entries: chunks,
  };
}

function jobFile(paths: RepoPaths, id: string): string {
  if (!/^[0-9a-f-]{36}$/.test(id)) throw new Error("Knowledge job ID is invalid.");
  return path.join(paths.knowledgeJobs, `${id}.json`);
}

function writeJob(paths: RepoPaths, job: KnowledgeJob): void {
  ensureDir(paths.knowledgeJobs);
  const file = jobFile(paths, job.id);
  const temp = `${file}.${randomUUID()}.tmp`;
  writeFileSync(temp, `${JSON.stringify(job, null, 2)}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" });
  renameSync(temp, file);
}

export function readKnowledgeJob(paths: RepoPaths, id: string): KnowledgeJob | null {
  const content = readText(jobFile(paths, id));
  if (!content) return null;
  try {
    return JSON.parse(content) as KnowledgeJob;
  } catch {
    throw new Error(`Knowledge job ${id} is not valid JSON.`);
  }
}

export function listKnowledgeJobs(paths: RepoPaths): KnowledgeJob[] {
  if (!existsSync(paths.knowledgeJobs)) return [];
  return readdirSync(paths.knowledgeJobs)
    .filter((name) => name.endsWith(".json"))
    .map((name) => readKnowledgeJob(paths, name.slice(0, -5)))
    .filter((job): job is KnowledgeJob => job !== null)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function createKnowledgeJob(paths: RepoPaths, index: SemanticIndex, options: InventoryOptions & { agent?: KnowledgeAgent; now?: Date } = {}): KnowledgeJob {
  const { preview, entries } = previewKnowledgeJob(paths, index, options);
  if (preview.entities === 0) throw new Error("No new or stale knowledge entities need generation.");
  const now = (options.now ?? new Date()).toISOString();
  const id = randomUUID();
  const inventory = entries.flat();
  const job: KnowledgeJob = {
    id,
    status: "awaiting-confirmation",
    agent: preview.agent,
    createdAt: now,
    confirmedAt: null,
    updatedAt: now,
    codeRevision: git(["rev-parse", "HEAD"], { cwd: paths.root }).stdout.trim(),
    branch: currentBranch(paths.root),
    preview,
    targets: inventory.map((item) => ({ entity: item.entity, fingerprint: item.fingerprint, revision: item.revision })),
    chunks: entries.map((chunk, index) => ({ index, entityIds: chunk.map((item) => item.entity), status: "pending", records: [], error: null })),
    completedChunks: 0,
    failures: [],
    resumable: true,
    commit: null,
  };
  writeJob(paths, job);
  return job;
}

function updateProgress(job: KnowledgeJob, now: Date): void {
  job.completedChunks = job.chunks.filter((chunk) => chunk.status === "completed").length;
  job.updatedAt = now.toISOString();
  job.resumable = job.status !== "completed";
}

/** Confirm once, run or resume missing chunks, validate the whole result, then publish one batch commit. */
export function runKnowledgeJob(
  paths: RepoPaths,
  config: ReggieConfig,
  index: SemanticIndex,
  id: string,
  options: { confirm?: boolean; now?: Date; generate?: KnowledgeGenerator } = {},
): KnowledgeJob {
  const job = readKnowledgeJob(paths, id);
  if (!job) throw new Error(`Knowledge job ${id} does not exist.`);
  if (job.status === "completed") return job;
  if (!job.confirmedAt && !options.confirm) throw new Error("Knowledge generation requires one explicit confirmation after reviewing its preview.");
  assertKnowledgeIntegrationCheckout(paths.root, config);
  const head = git(["rev-parse", "HEAD"], { cwd: paths.root }).stdout.trim();
  if (head !== job.codeRevision) throw new Error(`Knowledge job ${id} was previewed at ${job.codeRevision.slice(0, 12)}, but HEAD is now ${head.slice(0, 12)}. Create a new preview.`);

  const now = options.now ?? new Date();
  if (!job.confirmedAt) job.confirmedAt = now.toISOString();
  job.status = "running";
  job.failures = [];
  updateProgress(job, now);
  writeLastKnowledgeAgent(paths, job.agent);
  writeJob(paths, job);

  const all = new Map(buildKnowledgeInventory(paths, index).map((item) => [item.entity, item]));
  const generate = options.generate ?? generateKnowledge;
  for (const chunk of job.chunks) {
    if (chunk.status === "completed") continue;
    const entities = chunk.entityIds.map((entity) => {
      const item = all.get(entity);
      if (!item) throw new Error(`Knowledge entity ${entity} disappeared after preview.`);
      const target = job.targets.find((candidate) => candidate.entity === entity);
      if (!target || target.fingerprint !== item.fingerprint || target.revision !== item.revision) throw new Error(`Knowledge entity ${entity} changed after preview. Create a new preview.`);
      return item;
    });
    try {
      chunk.records = generate(job.agent, entities);
      chunk.status = "completed";
      chunk.error = null;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      chunk.status = "failed";
      chunk.error = message;
      job.status = "failed";
      job.failures.push(`Chunk ${chunk.index + 1}: ${message}`);
      updateProgress(job, now);
      writeJob(paths, job);
      return job;
    }
    updateProgress(job, now);
    writeJob(paths, job);
  }

  try {
    // Revalidate cached completed chunks before publication. A failed job is resumable and its
    // ignored JSON is user-writable; cached output never bypasses the same hostile-output checks as
    // a fresh agent response.
    const generated = job.chunks.flatMap((chunk) => {
      const entities = chunk.entityIds.map((entity) => {
        const item = all.get(entity);
        if (!item) throw new Error(`Knowledge entity ${entity} disappeared after preview.`);
        return item;
      });
      return validateGeneratedKnowledge({ records: chunk.records }, entities);
    });
    const codeRevision = job.codeRevision;
    const result = saveKnowledgeBatch(paths, config, generated.map((record) => {
      const target = job.targets.find((candidate) => candidate.entity === record.entity);
      if (!target) throw new Error(`Generated result contains unrequested entity ${record.entity}.`);
      return {
        entity: record.entity,
        expectedRevision: target.revision,
        current: record.current,
        fingerprint: record.fingerprint,
        actor: job.agent,
        by: job.agent === "codex" ? "Codex" : "Claude",
        codeRevision,
        reason: "Explicit repository knowledge generation.",
      };
    }), { now, message: `knowledge: generate ${generated.length} entities with ${job.agent}` });
    job.commit = result.commit;
    job.status = "completed";
    job.resumable = false;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    job.status = "failed";
    job.failures.push(`Publish: ${message}`);
  }
  updateProgress(job, now);
  writeJob(paths, job);
  return job;
}

/** Local job data is disposable; repository knowledge and its commit are the durable result. */
export function deleteKnowledgeJob(paths: RepoPaths, id: string): void {
  rmSync(jobFile(paths, id), { force: true });
}

export function knowledgeJobPath(paths: RepoPaths, id: string): string {
  return relPosix(paths.root, jobFile(paths, id));
}
