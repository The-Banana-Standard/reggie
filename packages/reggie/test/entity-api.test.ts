import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { onboard } from "../src/onboard.js";
import { repoPaths } from "../src/paths.js";
import { loadConfig } from "../src/people.js";
import { startServer, type ServerHandle } from "../src/serve.js";
import { makeTempRepo, type TempRepo } from "./helpers.js";

describe("code entity HTTP API", () => {
  let repo: TempRepo;
  let server: ServerHandle;
  let base: string;

  async function request(route: string, init?: RequestInit): Promise<{ status: number; body: any }> {
    const response = await fetch(base + route, init);
    const text = await response.text();
    return { status: response.status, body: text ? JSON.parse(text) : null };
  }

  async function post(route: string, body: unknown, headers: Record<string, string> = {}): Promise<{ status: number; body: any }> {
    return request(route, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
  }

  beforeAll(async () => {
    repo = makeTempRepo("reggie-entity-api-");
    repo.write("functions/lib/session.ts", [
      "/** Selects an existing session or creates one. */",
      "export function resolveSessionId(rawSessionId) {",
      "  if (rawSessionId) return rawSessionId;",
      "  return crypto.randomUUID();",
      "}",
    ].join("\n"));
    repo.write("functions/api/chat.ts", [
      "import { resolveSessionId } from '../lib/session';",
      "export async function onRequestPost({ request }) {",
      "  const payload = await request.json();",
      "  if (!payload.message) return Response.json({ error: 'missing' }, { status: 400 });",
      "  const sessionId = resolveSessionId(payload.session_id);",
      "  return Response.json({ reply: payload.message, session_id: sessionId });",
      "}",
    ].join("\n"));
    repo.write("src/client.ts", "export function send() { return fetch('/api/chat', { method: 'POST', body: JSON.stringify({ message: 'hi', session_id: 's', history: [], model: 'm', temperature: 1, max_tokens: 20, profile: { name: 'Ada', flags: { active: true } } }) }); }\n");
    repo.write("src/large.ts", Array.from({ length: 1_205 }, (_, index) => `export const line${index + 1} = ${index + 1};`).join("\n"));
    onboard(repo.root);
    repo.commitAll("onboard entity API fixture");
    const paths = repoPaths(repo.root);
    server = await startServer(paths, loadConfig(paths), { port: 0, host: "127.0.0.1", workspace: null });
    base = `http://127.0.0.1:${server.port}`;
  }, 120_000);

  afterAll(async () => {
    await server?.close();
    repo?.cleanup();
  });

  it("serves one canonical symbol declaration with exact calls and bounded graph controls", async () => {
    const id = "sym:functions/lib/session.ts::resolveSessionId";
    const result = await request(`/api/symbol?id=${encodeURIComponent(id)}&depth=2&direction=both`);
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({
      symbol: { id, explicitReturnType: null },
      parentFile: "functions/lib/session.ts",
      source: { startLine: 1, hasAfter: false },
      knowledge: { entity: id, revision: "missing", exists: false },
      graph: { center: id, direction: "both", depth: 2 },
    });
    expect(result.body.source.text).toContain("/** Selects an existing session or creates one. */");
    expect(result.body.callers[0].symbol.id).toBe("sym:functions/api/chat.ts::onRequestPost");
    expect(result.body.returns.map((variant: any) => variant.expression)).toEqual(["rawSessionId", "crypto.randomUUID()"]);
    expect((await request(`/api/symbol?id=${encodeURIComponent("functions/lib/session.ts::resolveSessionId")}`)).status).toBe(400);
    expect((await request(`/api/symbol?id=${encodeURIComponent("sym:../secret::read")}`)).status).toBe(404);
    expect((await request(`/api/symbol?id=${encodeURIComponent(id)}&direction=sideways`)).status).toBe(400);
  });

  it("serves route clients, complete nested request evidence, variants, flows, and knowledge", async () => {
    const id = "route:POST:/api/chat";
    const result = await request(`/api/route?id=${encodeURIComponent(id)}`);
    expect(result.status).toBe(200);
    expect(result.body.handler.id).toBe("sym:functions/api/chat.ts::onRequestPost");
    expect(result.body.clients[0].caller.id).toBe("sym:src/client.ts::send");
    expect(result.body.requestShape.fields.map((field: any) => field.name)).toEqual(expect.arrayContaining(["message", "session_id", "history", "model", "temperature", "max_tokens", "profile"]));
    const profile = result.body.requestShape.fields.find((field: any) => field.name === "profile");
    expect(profile.shape.fields.find((field: any) => field.name === "flags").shape.fields[0].name).toBe("active");
    expect(result.body.responses.length).toBeGreaterThanOrEqual(2);
    expect(result.body.knowledge.entity).toBe(id);
    expect((await request(`/api/route?id=${encodeURIComponent("route:POST:/missing")}`)).status).toBe(404);
  });

  it("pages every source line and refuses traversal, bad bounds, and mixed revisions", async () => {
    const first = await request("/api/source?path=src%2Flarge.ts&startLine=1&lineCount=500");
    const second = await request(`/api/source?path=src%2Flarge.ts&startLine=501&lineCount=500&revision=${first.body.revision}`);
    const third = await request(`/api/source?path=src%2Flarge.ts&startLine=1001&lineCount=500&revision=${first.body.revision}`);
    expect([first.body.startLine, second.body.startLine, third.body.startLine]).toEqual([1, 501, 1001]);
    expect([first.body.endLine, second.body.endLine, third.body.endLine]).toEqual([500, 1000, 1205]);
    expect(third.body).toMatchObject({ totalLines: 1205, hasAfter: false });
    expect((await request("/api/source?path=..%2FREADME.md")).status).toBe(400);
    expect((await request("/api/source?path=.git%2Fconfig")).status).toBe(404);
    expect((await request("/api/source?path=src%2Flarge.ts&startLine=0")).status).toBe(400);
    expect((await request("/api/source?path=src%2Flarge.ts&revision=stale")).status).toBe(409);
  });

  it("exposes role-aware reachability without a safe-deletion claim", async () => {
    const result = await request("/api/reachability");
    expect(result.status).toBe(200);
    expect(result.body.byRole).toEqual(expect.objectContaining({
      production: expect.objectContaining({ roots: expect.any(Array), notReachableFiles: expect.any(Array), notReachableSymbols: expect.any(Array) }),
      test: expect.objectContaining({ roots: expect.any(Array) }),
      script: expect.objectContaining({ roots: expect.any(Array) }),
      migration: expect.objectContaining({ roots: expect.any(Array) }),
      generated: expect.objectContaining({ roots: expect.any(Array) }),
    }));
    expect(result.body).toEqual(expect.objectContaining({ noReferences: { files: expect.any(Array), symbols: expect.any(Array) }, limitations: expect.any(Array), deletionClaim: null }));
  });

  it("serves concepts and guards manual split writes with origin and revision", async () => {
    const inventory = (await request("/api/knowledge")).body.entities as Array<{ entity: string }>;
    const conceptIds = inventory.map((item) => item.entity).filter((entity) => entity.startsWith("concept:"));
    const pages = await Promise.all(conceptIds.map((id) => request(`/api/concept?id=${encodeURIComponent(id)}`)));
    const splittable = pages.find((page) => page.status === 200 && page.body.concept.occurrences.length > 1);
    expect(splittable).toBeTruthy();
    if (!splittable) return;
    const source = splittable.body.concept;
    expect(source.occurrences.every((occurrence: any) => "explicitType" in occurrence)).toBe(true);
    const write = {
      expectedRevision: splittable.body.override.revision,
      sourceId: source.id,
      targetId: "concept:manual-api-split",
      canonicalName: "Manual API split",
      occurrenceIds: [source.occurrences[0].id],
      reason: "Separate the request occurrence from its resolved value.",
    };
    expect((await post("/api/concept-split", write, { origin: "https://attacker.example" })).status).toBe(403);
    const saved = await post("/api/concept-split", write);
    expect(saved.status).toBe(200);
    expect(saved.body.commit).toMatch(/^[0-9a-f]{40}$/);
    const child = await request(`/api/concept?id=${encodeURIComponent(write.targetId)}`);
    expect(child).toMatchObject({ status: 200, body: { requestedId: write.targetId, redirectedFrom: null, override: { splitFrom: source.id } } });
    expect((await post("/api/concept-split", write)).status).toBe(409);

    const described = structuredClone(child.body.knowledge.current);
    described.summary = "The request-side session identifier before canonical resolution.";
    for (const group of ["parameters", "fields", "returns", "callSites"]) for (const item of described[group]) item.description = `Description for ${item.id}.`;
    expect((await post("/api/knowledge", { entity: write.targetId, expectedRevision: child.body.knowledge.revision, fingerprint: child.body.knowledge.fingerprint, current: described, reason: "Keep the split concept's explicit history." })).status).toBe(200);
    const merged = await post("/api/concept-merge", { expectedRevision: saved.body.file.revision, targetId: source.id, sourceIds: [write.targetId], reason: "Treat the manually split evidence as one concept again." });
    expect(merged.status).toBe(200);
    const redirected = await request(`/api/concept?id=${encodeURIComponent(write.targetId)}`);
    expect(redirected).toMatchObject({ status: 200, body: { requestedId: write.targetId, redirectedFrom: write.targetId, concept: { id: source.id } } });
    const retained = await request(`/api/knowledge?entity=${encodeURIComponent(write.targetId)}&history=1`);
    expect(retained).toMatchObject({ status: 200, body: { record: { entity: write.targetId, current: { summary: described.summary }, history: [expect.any(Object)] } } });
    expect((await request(`/api/concept?id=${encodeURIComponent("concept:missing")}`)).status).toBe(404);
  });
});
