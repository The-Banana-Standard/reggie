import { symlinkSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { makeTempRepo, type TempRepo } from "../test/helpers.js";
import { applyConceptOverrides, type ConceptOverrideFile } from "./concept-overrides.js";
import {
  buildConceptEntityPage,
  buildRouteEntityPage,
  buildSymbolCallGraph,
  buildSymbolEntityPage,
  entityKnowledge,
  readSourcePage,
  SourceRevisionConflict,
} from "./entity-pages.js";
import { buildGraph } from "./graph.js";
import { buildKnowledgeInventory } from "./knowledge-jobs.js";
import { saveKnowledge, setKnowledgeRetired } from "./knowledge.js";
import { ensureLayout } from "./layout.js";
import { repoPaths, type RepoPaths } from "./paths.js";
import { parseConfig } from "./people.js";
import { buildSemanticIndex, type SemanticIndex } from "./semantic-index.js";

const EMPTY_OVERRIDES: ConceptOverrideFile = { version: 1, revision: "missing", merges: [], splits: [], history: [] };

describe("code entity page projections", () => {
  let repo: TempRepo;
  let paths: RepoPaths;
  let index: SemanticIndex;
  let entries: ReturnType<typeof buildKnowledgeInventory>;

  beforeAll(() => {
    repo = makeTempRepo("reggie-entities-");
    repo.write("functions/lib/session.ts", [
      "/** Selects an existing session or creates one. */",
      "export function resolveSessionId(rawSessionId) {",
      "  if (rawSessionId) return rawSessionId;",
      "  return crypto.randomUUID();",
      "}",
      "function sealed(value) { return value; }",
      "/** Stores resolved sessions. */",
      "@sealed",
      "export class SessionStore {",
      "  constructor(private prefix: string) {}",
      "  save(value: { session_id: string }) { return this.prefix + value.session_id; }",
      "}",
    ].join("\n"));
    repo.write("functions/api/chat.ts", [
      "import { resolveSessionId, SessionStore } from '../lib/session';",
      "export async function onRequestPost({ request }) {",
      "  const payload = await request.json();",
      "  if (!payload.message) return Response.json({ error: 'missing' }, { status: 400 });",
      "  const id = resolveSessionId(payload.session_id);",
      "  const store = new SessionStore('chat:');",
      "  store.save({ session_id: id });",
      "  return Response.json({ reply: payload.message, session_id: id });",
      "}",
    ].join("\n"));
    repo.write("src/chatConfig.ts", "export const chatConfig = { endpoint: '/api/chat' } as const;\n");
    repo.write("src/client.ts", [
      "import { chatConfig } from './chatConfig';",
      "export function sendChat() {",
      "  return fetch(chatConfig.endpoint, { method: 'POST', body: JSON.stringify({",
      "    message: 'hi', session_id: 's', history: [], model: 'm', temperature: 1, max_tokens: 20,",
      "    profile: { name: 'Ada', flags: { active: true } },",
      "  }) });",
      "}",
    ].join("\n"));
    repo.write("src/unresolved.ts", "export function run(callback) { return callback(); }\n");
    repo.write("src/long.ts", Array.from({ length: 1_205 }, (_, index) => `export const line${index + 1} = ${index + 1};`).join("\n"));
    repo.commitAll("entity fixture");
    paths = repoPaths(repo.root);
    ensureLayout(paths);
    index = buildSemanticIndex(paths, buildGraph(paths));
    entries = buildKnowledgeInventory(paths, index);
  });

  afterAll(() => repo.cleanup());

  const inventory = (entity: string) => {
    const found = entries.find((item) => item.entity === entity);
    if (!found) throw new Error(`Missing inventory entry ${entity}`);
    return found;
  };

  it("projects one exact documented symbol with callers, callees, and source-backed knowledge", () => {
    const id = "sym:functions/lib/session.ts::resolveSessionId";
    const page = buildSymbolEntityPage(paths, index, inventory(id), id);
    expect(page.parentFile).toBe("functions/lib/session.ts");
    expect(page.source.text).toContain("/** Selects an existing session or creates one. */");
    expect(page.source.text).toContain("export function resolveSessionId");
    expect(page.callers.map((item) => item.symbol.qualifiedName)).toContain("onRequestPost");
    expect(page.returns).toHaveLength(2);
    expect(page.knowledge).toMatchObject({ entity: id, revision: "missing", exists: false, stale: false });
    expect(page.graph.nodes.find((node) => node.selected)).toMatchObject({ id, side: "selected", depth: 0 });
  });

  it("requires canonical exact IDs and never guesses legacy symbols", () => {
    expect(() => buildSymbolEntityPage(paths, index, inventory("sym:functions/lib/session.ts::resolveSessionId"), "functions/lib/session.ts::resolveSessionId")).toThrow(/must use sym:/);
    expect(() => buildSymbolEntityPage(paths, index, inventory("sym:functions/lib/session.ts::resolveSessionId"), "sym:functions/lib/session.ts::missing")).toThrow(/Unknown symbol/);
    expect(() => buildSymbolEntityPage(paths, index, inventory("sym:functions/lib/session.ts::resolveSessionId"), "sym:../secret::read")).toThrow(/Unknown symbol/);
  });

  it("returns complete class, constructor, and method declaration spans", () => {
    const expectations = [
      ["sym:functions/lib/session.ts::SessionStore", "/** Stores resolved sessions. */\n@sealed\nexport class SessionStore"],
      ["sym:functions/lib/session.ts::SessionStore.constructor", "constructor(private prefix: string) {}"],
      ["sym:functions/lib/session.ts::SessionStore.save", "save(value: { session_id: string })"],
    ];
    for (const [id, source] of expectations) {
      const page = buildSymbolEntityPage(paths, index, inventory(id), id);
      expect(page.source.text).toContain(source);
      expect(page.source.text.split("\n").length).toBe(page.source.endLine - page.source.startLine + 1);
    }
  });

  it("bounds call graphs by direction and depth while excluding unresolved calls", () => {
    const id = "sym:functions/api/chat.ts::onRequestPost";
    const down = buildSymbolCallGraph(index, id, { direction: "down", depth: 1 });
    expect(down.nodes.some((node) => node.side === "caller")).toBe(false);
    expect(down.nodes.some((node) => node.id.endsWith("::resolveSessionId"))).toBe(true);
    expect(down.edges.every((edge) => index.calls.some((call) => call.resolution === "exact" && call.id === edge.callSiteIds[0]))).toBe(true);
    expect(buildSymbolCallGraph(index, id, { direction: "up", depth: 99 }).depth).toBe(3);
  });

  it("projects route clients, recursive request facts, responses, concepts, flows, and services", () => {
    const id = "route:POST:/api/chat";
    const flows = [{ id: "flow:chat", title: "Chat", entry: "sym:functions/api/chat.ts::onRequestPost", route: "/api/chat", method: "POST", services: ["service:openai"] }] as never[];
    const page = buildRouteEntityPage(paths, index, inventory(id), id, flows);
    expect(page.handler?.id).toBe("sym:functions/api/chat.ts::onRequestPost");
    expect(page.clients[0]?.caller.id).toBe("sym:src/client.ts::sendChat");
    expect(page.requestShape?.fields.map((field) => field.name)).toEqual(expect.arrayContaining(["message", "session_id", "profile"]));
    expect(page.requestShape?.fields.find((field) => field.name === "profile")?.shape?.fields.find((field) => field.name === "flags")?.shape?.fields[0]?.name).toBe("active");
    expect(page.responses.length).toBeGreaterThanOrEqual(2);
    expect(page.services).toEqual(["service:openai"]);
    expect(page.flows).toHaveLength(1);
  });

  it("projects every concept occurrence and preserves redirects and override history", () => {
    const source = index.staticConcepts.find((concept) => concept.occurrences.length > 1);
    expect(source).toBeTruthy();
    if (!source) return;
    const moved = source.occurrences[0]!;
    const revision = "concepts-test";
    const file: ConceptOverrideFile = {
      version: 1,
      revision,
      merges: [],
      splits: [{ sourceId: source.id, targetId: "concept:manual-child", canonicalName: "Manual child", occurrenceIds: [moved.id], at: "2026-09-23T00:00:00Z", by: "Test", reason: "Separate meanings." }],
      history: [{ action: "split", at: "2026-09-23T00:00:00Z", by: "Test", reason: "Separate meanings.", priorRevision: "missing", revision, targetId: "concept:manual-child", sourceIds: [source.id], occurrenceIds: [moved.id] }],
    };
    const overrides = applyConceptOverrides(index.staticConcepts, file);
    const effective = { ...index, concepts: overrides.concepts };
    const child = overrides.concepts.find((concept) => concept.id === "concept:manual-child")!;
    const entry = { ...inventory(source.id), entity: child.id, fingerprint: "child", facts: child };
    const page = buildConceptEntityPage(paths, effective, entry, child.id, overrides);
    expect(page.concept.occurrences).toHaveLength(1);
    expect(page.concept.occurrences[0]?.explicitType).toBe(moved.explicitType);
    expect(page.override).toMatchObject({ revision, splitFrom: source.id });
    expect(page.override.history).toHaveLength(1);
  });

  it("keeps retired text out of the normal entity-page narration", () => {
    const entry = inventory("sym:src/unresolved.ts::run");
    const current = {
      summary: "Invokes a supplied callback.",
      parameters: entry.expected.parameters.map((item) => ({ ...item, description: `Description for ${item.id}.` })),
      fields: entry.expected.fields.map((item) => ({ ...item, description: `Description for ${item.id}.` })),
      returns: entry.expected.returns.map((item) => ({ ...item, description: `Description for ${item.id}.` })),
      callSites: entry.expected.callSites.map((item) => ({ ...item, description: `Description for ${item.id}.` })),
    };
    const config = parseConfig("mode: solo\ndefaultBranch: main\n");
    const saved = saveKnowledge(paths, config, { entity: entry.entity, expectedRevision: "missing", fingerprint: entry.fingerprint, current, actor: "human", by: "Test", codeRevision: "fixture", reason: "Document the fixture." });
    setKnowledgeRetired(paths, config, { entity: entry.entity, expectedRevision: saved.records[0]!.revision, fingerprint: entry.fingerprint, retired: true, actor: "human", by: "Test", codeRevision: "fixture", reason: "Retire the fixture text." });

    expect(entityKnowledge(paths, entry)).toMatchObject({ retired: true, exists: true, current: { summary: "" } });
  });

  it("pages full source by stable line coordinates and rejects revision mixing", () => {
    const first = readSourcePage(paths, "src/long.ts", { startLine: 1, lineCount: 500 });
    const second = readSourcePage(paths, "src/long.ts", { startLine: first.endLine + 1, lineCount: 500, expectedRevision: first.revision });
    const third = readSourcePage(paths, "src/long.ts", { startLine: second.endLine + 1, lineCount: 500, expectedRevision: first.revision });
    expect([first, second, third].map((page) => page.text.split("\n").length)).toEqual([500, 500, 205]);
    expect(third).toMatchObject({ startLine: 1001, endLine: 1205, totalLines: 1205, hasAfter: false });
    expect(() => readSourcePage(paths, "../README.md")).toThrow(/repository-relative/);
    expect(() => readSourcePage(paths, "src/long.ts", { startLine: 0 })).toThrow(/outside/);
    expect(() => readSourcePage(paths, "src/long.ts", { expectedRevision: "old" })).toThrow(SourceRevisionConflict);
    symlinkSync("long.ts", `${repo.root}/src/linked.ts`);
    expect(() => readSourcePage(paths, "src/linked.ts")).toThrow(/not a regular file/);
  });
});
