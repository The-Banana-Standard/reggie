import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { makeTempRepo, type TempRepo } from "../test/helpers.js";
import type { DataConcept } from "./data-concepts.js";
import { git } from "./git.js";
import { validateGeneratedKnowledge, type GeneratedKnowledge, type KnowledgeAgent, type KnowledgePromptEntity } from "./knowledge-agents.js";
import {
  buildKnowledgeInventory,
  buildRepositorySemanticIndex,
  createKnowledgeJob,
  knowledgeJobPath,
  previewKnowledgeJob,
  readKnowledgeJob,
  readLastKnowledgeAgent,
  runKnowledgeJob,
  type KnowledgeGenerator,
} from "./knowledge-jobs.js";
import { readKnowledge, saveKnowledge } from "./knowledge.js";
import { ensureLayout } from "./layout.js";
import { resolveNoteTarget } from "./notes.js";
import { repoPaths, type RepoPaths } from "./paths.js";
import { parseConfig, type ReggieConfig } from "./people.js";
import type { CallSite, SemanticIndex } from "./semantic-index.js";

function generated(entities: KnowledgePromptEntity[]): GeneratedKnowledge[] {
  return entities.map((entity) => ({
    entity: entity.entity,
    fingerprint: entity.fingerprint,
    current: {
      summary: `Explains ${entity.entity} in one sentence.`,
      parameters: entity.expected.parameters.map((item) => ({ ...item, description: `Explains ${item.id}.` })),
      fields: entity.expected.fields.map((item) => ({ ...item, description: `Explains ${item.id}.` })),
      returns: entity.expected.returns.map((item) => ({ ...item, description: `Explains ${item.id}.` })),
      callSites: entity.expected.callSites.map((item) => ({ ...item, description: `Explains ${item.id}.` })),
    },
  }));
}

describe("knowledge inventory and jobs", () => {
  let repo: TempRepo;
  let paths: RepoPaths;
  let config: ReggieConfig;
  let index: SemanticIndex;

  beforeEach(() => {
    repo = makeTempRepo("reggie-knowledge-job-");
    paths = repoPaths(repo.root);
    ensureLayout(paths);
    repo.write("functions/lib/session.ts", [
      "export function resolveSessionId(rawSessionId) {",
      "  if (rawSessionId) return rawSessionId;",
      "  return crypto.randomUUID();",
      "}",
      "export function one() { return 1; }",
      "export function two() { return 2; }",
      "export function three() { return 3; }",
      "export function four() { return 4; }",
      "export function five() { return 5; }",
      "export function six() { return 6; }",
    ].join("\n"));
    repo.write("functions/api/chat.js", [
      "import { resolveSessionId } from '../lib/session';",
      "export async function onRequestPost({ request }) {",
      "  const payload = await request.json();",
      "  const { message, history, model, temperature, nested } = payload;",
      "  const sessionId = resolveSessionId(payload.session_id);",
      "  return Response.json({ sessionId, message, history, model, temperature, nested });",
      "}",
    ].join("\n"));
    repo.write("src/client.jsx", "export function send() { return fetch('/api/chat', { method: 'POST', body: JSON.stringify({ message: 'hi', history: [], session_id: 's', model: 'm', temperature: 1, nested: { active: true } }) }); }\n");
    repo.write("test/chat.test.ts", "import { resolveSessionId } from '../functions/lib/session'; test('session', () => resolveSessionId('s'));\n");
    repo.write("scripts/reindex.mts", "import { resolveSessionId } from '../functions/lib/session'; resolveSessionId('script');\n");
    repo.write("migrations/001.cts", "export function up(db) { return db.insert({ id: 1 }); }\n");
    repo.write("src/schema.gen.ts", "// @generated\nexport const schema = { id: 1 };\n");
    repo.commitAll("knowledge fixture");
    config = parseConfig("mode: solo\ndefaultBranch: main\n");
    index = buildRepositorySemanticIndex(paths);
  });

  afterEach(() => repo.cleanup());

  it("inventories every code role with source-backed symbols, fields, returns, calls, routes, and concepts", () => {
    const inventory = buildKnowledgeInventory(paths, index);
    expect(new Set(inventory.filter((item) => item.kind === "file").map((item) => item.role))).toEqual(new Set(["production", "test", "script", "migration", "generated"]));
    const symbol = inventory.find((item) => item.entity === "sym:functions/lib/session.ts::resolveSessionId");
    expect(symbol).toMatchObject({ kind: "symbol", state: "new", role: "production", revision: "missing" });
    expect(symbol?.expected.parameters[0]).toMatchObject({ id: "parameter:0:rawSessionId", explicitType: null });
    expect(symbol?.expected.returns).toHaveLength(2);
    expect(symbol?.expected.callSites.length).toBeGreaterThanOrEqual(3);
    const route = inventory.find((item) => item.entity === "route:POST:/api/chat");
    expect(route?.expected.fields.map((field) => field.id)).toEqual(expect.arrayContaining([
      "request:message",
      "request:history",
      "request:session_id",
      "request:model",
      "request:temperature",
      "request:nested",
      "request:nested.active",
    ]));
    expect(route?.source).toContain("onRequestPost");
    expect(inventory.some((item) => item.kind === "concept")).toBe(true);
  });

  it("bounds high-cardinality prompt evidence without dropping any required descriptions", () => {
    const symbolId = "sym:functions/lib/session.ts::resolveSessionId";
    const baseCall = index.calls.find((call) => call.calleeId === symbolId)!;
    const calls: CallSite[] = Array.from({ length: 480 }, (_, itemIndex) => ({
      ...baseCall,
      id: `call:file:test/high-cardinality-${itemIndex}.ts:${itemIndex}`,
      callerId: `file:test/high-cardinality-${itemIndex}.ts`,
      calleeId: symbolId,
      source: { ...baseCall.source, file: `test/high-cardinality-${itemIndex}.ts`, startLine: itemIndex + 1, endLine: itemIndex + 1 },
    }));
    const occurrences = Array.from({ length: 480 }, (_, itemIndex) => ({
      id: `occ:field:test/high-cardinality-${itemIndex}.ts:${itemIndex}:value`,
      name: "value",
      path: ["value"],
      kind: "field" as const,
      source: { file: `test/high-cardinality-${itemIndex}.ts`, line: itemIndex + 1 },
      symbolId,
      explicitType: null,
      validationIds: [],
      routeIds: [],
    }));
    const concept: DataConcept = {
      id: "concept:high-cardinality",
      canonicalName: "value",
      aliases: ["value"],
      occurrences,
      links: occurrences.slice(1).map((occurrence, itemIndex) => ({
        from: occurrences[itemIndex]!.id,
        to: occurrence.id,
        kind: "assignment",
        source: occurrence.source,
        transformation: null,
      })),
      explicitTypes: [],
      validationIds: [],
      transformations: [],
      routeIds: [],
      symbolIds: [symbolId],
    };
    const crowded: SemanticIndex = { ...index, calls: [...index.calls, ...calls], concepts: [...index.concepts, concept] };

    const scope = previewKnowledgeJob(paths, crowded, { force: true, agent: "codex" });
    const inventory = scope.entries.flat();
    const symbol = inventory.find((item) => item.entity === symbolId)!;
    const conceptEntry = inventory.find((item) => item.entity === concept.id)!;
    expect(symbol.expected.callSites).toHaveLength(calls.length + index.calls.filter((call) => call.callerId === symbolId || call.calleeId === symbolId).length);
    expect(conceptEntry.expected.fields).toHaveLength(occurrences.length);
    expect((symbol.facts as { callEvidence: { included: number; omitted: number } }).callEvidence).toMatchObject({ included: 24, omitted: expect.any(Number) });
    expect((conceptEntry.facts as { occurrenceEvidence: { included: number; omitted: number } }).occurrenceEvidence).toMatchObject({ included: 24, omitted: 456 });
    expect(validateGeneratedKnowledge({ records: generated([symbol]) }, [symbol])[0]!.current.callSites).toHaveLength(symbol.expected.callSites.length);
    expect(validateGeneratedKnowledge({ records: generated([conceptEntry]) }, [conceptEntry])[0]!.current.fields).toHaveLength(occurrences.length);
  });

  it("previews scope and requires exactly one confirmation before a one-commit batch", () => {
    const scope = previewKnowledgeJob(paths, index, { agent: "claude" });
    expect(scope.preview).toMatchObject({ agent: "claude", newEntities: scope.preview.entities, staleEntities: 0, commitBehavior: "one knowledge-only commit after every chunk validates" });
    expect(scope.preview.files).toBeGreaterThanOrEqual(7);
    expect(scope.preview.symbols).toBeGreaterThanOrEqual(10);
    expect(scope.preview.expectedChunks).toBeGreaterThan(1);

    const job = createKnowledgeJob(paths, index, { agent: "claude", now: new Date("2026-09-23T05:00:00Z") });
    expect(job.status).toBe("awaiting-confirmation");
    expect(() => runKnowledgeJob(paths, config, index, job.id, { generate: (_agent, entities) => generated(entities) })).toThrow(/explicit confirmation/);
    const countBefore = Number(git(["rev-list", "--count", "HEAD"], { cwd: repo.root }).stdout.trim());
    const completed = runKnowledgeJob(paths, config, index, job.id, { confirm: true, generate: (_agent, entities) => generated(entities), now: new Date("2026-09-23T05:01:00Z") });
    expect(completed).toMatchObject({ status: "completed", resumable: false, completedChunks: job.preview.expectedChunks, failures: [] });
    expect(completed.commit).toMatch(/^[0-9a-f]{40}$/);
    expect(Number(git(["rev-list", "--count", "HEAD"], { cwd: repo.root }).stdout.trim()) - countBefore).toBe(1);
    expect(readLastKnowledgeAgent(paths)).toBe("claude");
    expect(git(["status", "--short", "--", ".reggie/.cache"], { cwd: repo.root }).stdout).toBe("");
  });

  it("keeps completed chunks locally, publishes nothing on failure, and resumes without regenerating them", () => {
    const ids = buildKnowledgeInventory(paths, index).filter((item) => item.kind === "symbol").slice(0, 10).map((item) => item.entity);
    const job = createKnowledgeJob(paths, index, { agent: "codex", entities: ids });
    let calls = 0;
    const failsSecond: KnowledgeGenerator = (_agent: KnowledgeAgent, entities: KnowledgePromptEntity[]) => {
      calls += 1;
      if (calls === 2) throw new Error("temporary adapter failure");
      return generated(entities);
    };
    const failed = runKnowledgeJob(paths, config, index, job.id, { confirm: true, generate: failsSecond });
    expect(failed).toMatchObject({ status: "failed", completedChunks: 1, resumable: true, commit: null });
    expect(failed.failures[0]).toContain("temporary adapter failure");
    expect(ids.every((id) => !existsSync(resolveNoteTarget(paths, id).file))).toBe(true);

    let resumedCalls = 0;
    const completed = runKnowledgeJob(paths, config, index, job.id, { generate: (_agent, entities) => {
      resumedCalls += 1;
      return generated(entities);
    } });
    expect(completed.status).toBe("completed");
    expect(resumedCalls).toBe(1);
    expect(completed.completedChunks).toBe(2);
    expect(readKnowledgeJob(paths, job.id)?.commit).toBe(completed.commit);
  });

  it("rejects generation outside the configured integration checkout before invoking an agent", () => {
    const job = createKnowledgeJob(paths, index, { entities: ["sym:functions/lib/session.ts::resolveSessionId"] });
    git(["switch", "-q", "-c", "task/other"], { cwd: repo.root });
    let calls = 0;
    expect(() => runKnowledgeJob(paths, config, index, job.id, { confirm: true, generate: (_agent, entities) => {
      calls += 1;
      return generated(entities);
    } })).toThrow(/configured integration checkout/);
    expect(calls).toBe(0);
  });

  it("revalidates cached completed chunks before a resumed job can publish", () => {
    const ids = buildKnowledgeInventory(paths, index).filter((item) => item.kind === "symbol").slice(0, 10).map((item) => item.entity);
    const job = createKnowledgeJob(paths, index, { entities: ids });
    let calls = 0;
    const failed = runKnowledgeJob(paths, config, index, job.id, { confirm: true, generate: (_agent, entities) => {
      calls += 1;
      if (calls === 2) throw new Error("pause before publish");
      return generated(entities);
    } });
    expect(failed.status).toBe("failed");
    const file = `${repo.root}/${knowledgeJobPath(paths, job.id)}`;
    const tampered = JSON.parse(readFileSync(file, "utf8")) as { chunks: Array<{ records: Array<{ fingerprint: string }> }> };
    tampered.chunks[0]!.records[0]!.fingerprint = "tampered";
    writeFileSync(file, `${JSON.stringify(tampered, null, 2)}\n`, "utf8");
    const resumed = runKnowledgeJob(paths, config, index, job.id, { generate: (_agent, entities) => generated(entities) });
    expect(resumed.status).toBe("failed");
    expect(resumed.failures.join(" ")).toContain("changed the fingerprint");
    expect(ids.every((id) => !existsSync(resolveNoteTarget(paths, id).file))).toBe(true);
  });

  it("reports stale versus fresh records and includes fresh entities only for explicit refresh", () => {
    const target = buildKnowledgeInventory(paths, index).find((item) => item.entity === "sym:functions/lib/session.ts::resolveSessionId")!;
    const saved = saveKnowledge(paths, config, {
      entity: target.entity,
      expectedRevision: "missing",
      current: generated([target])[0]!.current,
      fingerprint: "older-fingerprint",
      actor: "human",
      by: "Test Person",
      codeRevision: git(["rev-parse", "HEAD"], { cwd: repo.root }).stdout.trim(),
      reason: "Seed stale knowledge.",
    });
    index = buildRepositorySemanticIndex(paths);
    const stale = previewKnowledgeJob(paths, index);
    expect(stale.preview.staleEntities).toBeGreaterThanOrEqual(1);
    expect(stale.preview.entityIds).toContain(target.entity);

    const freshFingerprint = buildKnowledgeInventory(paths, index).find((item) => item.entity === target.entity)!.fingerprint;
    saveKnowledge(paths, config, {
      entity: target.entity,
      expectedRevision: saved.records[0]!.revision,
      current: generated([target])[0]!.current,
      fingerprint: freshFingerprint,
      actor: "human",
      by: "Test Person",
      codeRevision: git(["rev-parse", "HEAD"], { cwd: repo.root }).stdout.trim(),
      reason: "Refresh knowledge.",
    });
    index = buildRepositorySemanticIndex(paths);
    expect(previewKnowledgeJob(paths, index).preview.entityIds).not.toContain(target.entity);
    expect(previewKnowledgeJob(paths, index, { entities: [target.entity] }).preview.entityIds).toEqual([target.entity]);
    expect(readKnowledge(paths, target.entity, freshFingerprint)?.stale).toBe(false);
  });
});
