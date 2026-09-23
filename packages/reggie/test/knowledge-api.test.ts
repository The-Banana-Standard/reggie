import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { onboard } from "../src/onboard.js";
import { readKnowledge } from "../src/knowledge.js";
import { repoPaths } from "../src/paths.js";
import { loadConfig } from "../src/people.js";
import { startServer, type ServerHandle } from "../src/serve.js";
import { makeTempRepo, type TempRepo } from "./helpers.js";

describe("knowledge HTTP API", () => {
  let repo: TempRepo;
  let server: ServerHandle;
  let base: string;

  async function request(route: string, init?: RequestInit): Promise<{ status: number; body: any }> {
    const response = await fetch(base + route, init);
    const text = await response.text();
    return { status: response.status, body: text ? JSON.parse(text) : null };
  }

  async function post(route: string, body: unknown, headers: Record<string, string> = {}): Promise<{ status: number; body: any }> {
    return request(route, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: typeof body === "string" ? body : JSON.stringify(body) });
  }

  beforeAll(async () => {
    repo = makeTempRepo("reggie-knowledge-api-");
    repo.write("src/session.ts", "export function resolveSessionId(value) { return value || crypto.randomUUID(); }\n");
    onboard(repo.root);
    repo.commitAll("onboard with source");
    const paths = repoPaths(repo.root);
    server = await startServer(paths, loadConfig(paths), { port: 0, host: "127.0.0.1", workspace: null });
    base = `http://127.0.0.1:${server.port}`;
  }, 120_000);

  afterAll(async () => {
    await server?.close();
    repo?.cleanup();
  });

  it("reads inventory and previews an explicit source-backed batch", async () => {
    const inventory = await request("/api/knowledge");
    expect(inventory.status).toBe(200);
    expect(inventory.body.entities).toEqual(expect.arrayContaining([
      expect.objectContaining({ entity: "src/session.ts", kind: "file", state: "new" }),
      expect.objectContaining({ entity: "sym:src/session.ts::resolveSessionId", kind: "symbol", state: "new" }),
    ]));
    const preview = await request("/api/knowledge-preview?agent=codex&entity=sym%3Asrc%2Fsession.ts%3A%3AresolveSessionId");
    expect(preview).toMatchObject({ status: 200, body: { agent: "codex", entities: 1, newEntities: 1, expectedChunks: 1, commitBehavior: "one knowledge-only commit after every chunk validates" } });
  });

  it("guards an inline save with revision, schema, origin, path, and knowledge-only commit rules", async () => {
    const inventory = (await request("/api/knowledge")).body.entities as Array<{ entity: string; fingerprint: string; revision: string }>;
    const target = inventory.find((item) => item.entity === "sym:src/session.ts::resolveSessionId")!;
    const body = {
      entity: target.entity,
      expectedRevision: target.revision,
      fingerprint: target.fingerprint,
      reason: "Explain the symbol for reviewers.",
      current: {
        summary: "Returns an existing session identifier or creates a UUID.",
        parameters: [{ id: "parameter:0:value", description: "The optional identifier supplied by the caller.", explicitType: null }],
        fields: [],
        returns: [{ id: "return:1", description: "A stable session identifier.", explicitType: null }],
        callSites: [],
      },
    };
    const badOrigin = await post("/api/knowledge", body, { origin: "https://attacker.example" });
    expect(badOrigin.status).toBe(403);
    const traversal = await post("/api/knowledge", { ...body, entity: "../outside" });
    expect(traversal.status).toBe(400);
    const invalid = await post("/api/knowledge", { ...body, current: { ...body.current, extra: "hostile" } });
    expect(invalid.status).toBe(400);

    const saved = await post("/api/knowledge", body);
    expect(saved.status).toBe(200);
    expect(saved.body.commit).toMatch(/^[0-9a-f]{40}$/);
    const record = await request(`/api/knowledge?entity=${encodeURIComponent(target.entity)}&history=1`);
    expect(record).toMatchObject({ status: 200, body: { current: { summary: body.current.summary }, record: { stale: false, retired: false } } });
    expect(record.body.record.history[0]).toMatchObject({ actor: "human", changedFields: ["summary", "parameters", "fields", "returns", "callSites"] });

    const conflict = await post("/api/knowledge", body);
    expect(conflict.status).toBe(409);
    expect(conflict.body.error).toContain("revision conflict");
    expect(readKnowledge(repoPaths(repo.root), target.entity)?.current?.summary).toBe(body.current.summary);
  });

  it("creates a confirmed-once generation job, exposes status, and refuses execution before confirmation", async () => {
    const created = await post("/api/knowledge-generate", { agent: "claude", entities: ["src/session.ts"] });
    expect(created).toMatchObject({ status: 201, body: { status: "awaiting-confirmation", agent: "claude", preview: { entities: 1, expectedChunks: 1 } } });
    const id = created.body.id as string;
    expect((await request(`/api/knowledge-job?id=${id}`)).body.status).toBe("awaiting-confirmation");
    expect((await request("/api/knowledge-jobs")).body.jobs.map((job: any) => job.id)).toContain(id);
    const refused = await post("/api/knowledge-run", { id });
    expect(refused.status).toBe(409);
    expect(refused.body.error).toContain("explicit confirmation");
  });

  it("retires current text from ordinary API narration while preserving it in the record history", async () => {
    const entity = "sym:src/session.ts::resolveSessionId";
    const before = (await request(`/api/knowledge?entity=${encodeURIComponent(entity)}`)).body.record;
    const retired = await post("/api/knowledge-retire", { entity, expectedRevision: before.revision, reason: "Superseded by the route-level explanation.", supersededBy: "route:POST:/api/chat" });
    expect(retired.status).toBe(200);
    const after = await request(`/api/knowledge?entity=${encodeURIComponent(entity)}&history=1`);
    expect(after.body.current).toBeNull();
    expect(after.body.record).toMatchObject({ retired: true, supersededBy: "route:POST:/api/chat", current: { summary: expect.any(String) } });
    expect(after.body.record.history).toHaveLength(2);
  });

  it("applies the shared request-size guard to knowledge writes", async () => {
    const tooLarge = JSON.stringify({ entity: "src/session.ts", padding: "x".repeat(70_000) });
    expect((await post("/api/knowledge", tooLarge)).status).toBe(413);
  });
});
