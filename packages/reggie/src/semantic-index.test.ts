import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { makeTempRepo, type TempRepo } from "../test/helpers.js";
import { buildGraph } from "./graph.js";
import { clearHistoryCache } from "./history.js";
import { ensureLayout } from "./layout.js";
import { repoPaths, type RepoPaths } from "./paths.js";
import { analyzeSemanticSource, buildSemanticIndex, semanticSymbolId, type SemanticIndex, type ValueShape } from "./semantic-index.js";

function fieldNames(shape: ValueShape | null): string[] {
  return shape?.fields.map((field) => field.name) ?? [];
}

describe("semantic code index", () => {
  let repo: TempRepo;
  let paths: RepoPaths;
  let index: SemanticIndex;

  beforeAll(() => {
    clearHistoryCache();
    repo = makeTempRepo("reggie-semantic-");
    repo.write(".gitignore", "dist/\nnode_modules/\n");
    repo.write("dist/ignored.js", "export function ignored() {}\n");
    repo.write(
      "functions/lib/session.ts",
      [
        "export interface SessionPayload {",
        "  session_id: string;",
        "  profile: { name: string; flags: { active: boolean } };",
        "}",
        "export class SessionStore {",
        "  constructor(private prefix: string) {}",
        "  save(value: SessionPayload): string { return this.prefix + value.session_id; }",
        "}",
        "export function resolveSessionId(rawSessionId) {",
        "  if (rawSessionId) return rawSessionId;",
        "  return crypto.randomUUID();",
        "}",
        "export const normalize = (value: string): string => value.trim();",
        "export function sameName(value: string) { return value; }",
      ].join("\n"),
    );
    repo.write(
      "functions/api/chat.tsx",
      [
        "import { resolveSessionId as resolve, SessionStore } from '../lib/session';",
        "export async function onRequestPost({ request }) {",
        "  const payload = await request.json();",
        "  if (!payload.message) return Response.json({ error: 'missing' }, { status: 400 });",
        "  const sessionId = resolve(payload.session_id);",
        "  const store = new SessionStore('chat:');",
        "  store.save({",
        "    session_id: sessionId,",
        "    profile: { name: payload.name, flags: { active: payload.active } },",
        "  });",
        "  const { message, history, model, temperature, max_tokens } = payload;",
        "  return Response.json({ reply: message, sessionId, history, model, temperature, max_tokens });",
        "}",
      ].join("\n"),
    );
    repo.write("functions/api/status.js", "export function onRequest({ request }) { return Response.json({ method: request.method }); }\n");
    repo.write(
      "src/ChatClient.jsx",
      [
        "import { chatData } from './chatData';",
        "export function ChatClient() {",
        "  const send = () => fetch(chatData.apiEndpoint, {",
        "    method: 'POST',",
        "    body: JSON.stringify({ message: 'hi', history: [], session_id: 's', model: 'm', temperature: 1, max_tokens: 20 }),",
        "  });",
        "  return <button onClick={send}>Send</button>;",
        "}",
      ].join("\n"),
    );
    repo.write("src/chatData.js", "export const chatData = { apiEndpoint: '/api/chat' };\n");
    repo.write(
      "src/DynamicClient.ts",
      [
        "let runtimeEndpoint = '/api/chat';",
        "const cycleA = cycleB;",
        "const cycleB = cycleA;",
        "export const sendRuntime = () => fetch(runtimeEndpoint, { method: 'POST' });",
        "export const sendCycle = () => fetch(cycleA, { method: 'POST' });",
      ].join("\n"),
    );
    repo.write("app/api/health/route.ts", "export function GET(): Response { return Response.json({ ok: true }); }\n");
    repo.write(
      "src/server.ts",
      [
        "import { Hono } from 'hono';",
        "const app = new Hono();",
        "function auth(c) { return c.get('user'); }",
        "function create(c) { return c.json({ created: true }); }",
        "app.post('/items', auth, create);",
      ].join("\n"),
    );
    repo.write("test/chat.test.ts", "import { onRequestPost } from '../functions/api/chat';\nexport function fixtureCase() { return onRequestPost; }\ntest('chat', () => fixtureCase());\n");
    repo.write("scripts/reindex.mts", "import { resolveSessionId } from '../functions/lib/session';\nresolveSessionId('script');\n");
    repo.write("migrations/001_seed.cts", "export function up(db) { return db.insert({ id: 1 }); }\n");
    repo.write("src/schema.gen.ts", "// @generated\nexport const generated = () => 1;\n");
    repo.write("src/legacy.cjs", "module.exports.run = function run() { return 1; };\n");
    repo.write("src/module.mjs", "export const load = () => 1;\n");
    repo.write("src/unreferenced.ts", "export function sameName(value: string) { return value; }\n");
    repo.write("src/validation.ts", "export function validate(payload) { schema.safeParse(payload); assert(payload.token); return payload; }\n");
    repo.commitAll("semantic fixture");
    paths = repoPaths(repo.root);
    ensureLayout(paths);
    index = buildSemanticIndex(paths, buildGraph(paths), { now: new Date("2026-09-22T00:00:00Z") });
  });

  afterAll(() => repo.cleanup());

  it("catalogs every tracked JavaScript/TypeScript extension and code role", () => {
    expect(index.staticConcepts).toEqual(index.concepts);
    expect(index.files.map((file) => file.file)).toEqual([
      "app/api/health/route.ts",
      "functions/api/chat.tsx",
      "functions/api/status.js",
      "functions/lib/session.ts",
      "migrations/001_seed.cts",
      "scripts/reindex.mts",
      "src/ChatClient.jsx",
      "src/chatData.js",
      "src/DynamicClient.ts",
      "src/legacy.cjs",
      "src/module.mjs",
      "src/schema.gen.ts",
      "src/server.ts",
      "src/unreferenced.ts",
      "src/validation.ts",
      "test/chat.test.ts",
    ]);
    expect(index.files.some((file) => file.file.includes("dist/") || file.file.includes("node_modules/"))).toBe(false);
    expect(Object.fromEntries(index.files.map((file) => [file.file, file.codeRole]))).toMatchObject({
      "functions/api/chat.tsx": "production",
      "test/chat.test.ts": "test",
      "scripts/reindex.mts": "script",
      "migrations/001_seed.cts": "migration",
      "src/schema.gen.ts": "generated",
    });
    expect(index.symbols.map((symbol) => symbol.id)).toEqual(expect.arrayContaining(["sym:src/legacy.cjs::run", "sym:src/module.mjs::load"]));
  });

  it("uses stable qualified ids for classes, constructors, methods, arrows, JSX, and TSX", () => {
    const ids = new Set(index.symbols.map((symbol) => symbol.id));
    expect(ids).toContain(semanticSymbolId("functions/lib/session.ts", "SessionStore"));
    expect(ids).toContain(semanticSymbolId("functions/lib/session.ts", "SessionStore.constructor"));
    expect(ids).toContain(semanticSymbolId("functions/lib/session.ts", "SessionStore.save"));
    expect(ids).toContain(semanticSymbolId("functions/lib/session.ts", "normalize"));
    expect(ids).toContain(semanticSymbolId("src/ChatClient.jsx", "ChatClient.send"));
    expect([...ids].every((id) => !id.includes("#"))).toBe(true);
  });

  it("resolves imported aliases, constructors, and methods while separating findings", () => {
    const handler = semanticSymbolId("functions/api/chat.tsx", "onRequestPost");
    const calls = index.calls.filter((call) => call.callerId === handler);
    expect(calls.find((call) => call.calleeExpression === "resolve")?.calleeId).toBe(semanticSymbolId("functions/lib/session.ts", "resolveSessionId"));
    expect(calls.find((call) => call.calleeExpression === "SessionStore")?.calleeId).toBe(semanticSymbolId("functions/lib/session.ts", "SessionStore.constructor"));
    expect(calls.find((call) => call.calleeExpression === "store.save")?.calleeId).toBe(semanticSymbolId("functions/lib/session.ts", "SessionStore.save"));
    expect(index.findings.some((finding) => finding.kind === "external-call" && finding.expression.includes("Response.json"))).toBe(true);
    expect(index.findings.some((finding) => finding.kind === "unresolved-callback")).toBe(true);
  });

  it("keeps positional expressions and complete recursive object shapes", () => {
    const call = index.calls.find((item) => item.calleeId === semanticSymbolId("functions/lib/session.ts", "resolveSessionId"));
    expect(call?.arguments).toHaveLength(1);
    expect(call?.arguments[0]).toMatchObject({ index: 0, parameterName: "rawSessionId", expression: "payload.session_id", category: "argument" });
    const save = index.calls.find((item) => item.calleeId === semanticSymbolId("functions/lib/session.ts", "SessionStore.save"));
    expect(fieldNames(save?.arguments[0]?.shape ?? null)).toEqual(["session_id", "profile"]);
    expect(fieldNames(save?.arguments[0]?.shape?.fields.find((field) => field.name === "profile")?.shape ?? null)).toEqual(["name", "flags"]);
    expect(fieldNames(save?.arguments[0]?.shape?.fields.find((field) => field.name === "profile")?.shape?.fields.find((field) => field.name === "flags")?.shape ?? null)).toEqual(["active"]);
    const saveSymbol = index.symbols.find((symbol) => symbol.id === semanticSymbolId("functions/lib/session.ts", "SessionStore.save"));
    expect(saveSymbol?.parameters[0]?.shape?.fields.find((field) => field.name === "session_id")?.explicitType).toMatchObject({ text: "string", source: "referenced" });
  });

  it("records all return variants and never presents inferred types as declared", () => {
    const resolve = index.symbols.find((symbol) => symbol.id === semanticSymbolId("functions/lib/session.ts", "resolveSessionId"));
    expect(resolve?.explicitReturnType).toBeNull();
    expect(resolve?.returnVariants.map((variant) => variant.expression)).toEqual(["rawSessionId", "crypto.randomUUID()"]);
    expect(resolve?.returnVariants.every((variant) => variant.explicitType === null)).toBe(true);
    const normalize = index.symbols.find((symbol) => symbol.id === semanticSymbolId("functions/lib/session.ts", "normalize"));
    expect(normalize?.parameters[0]?.explicitType?.text).toBe("string");
    expect(normalize?.explicitReturnType?.text).toBe("string");
  });

  it("keeps runtime checks as validation facts", () => {
    const handler = semanticSymbolId("functions/api/chat.tsx", "onRequestPost");
    expect(index.validations).toContainEqual(expect.objectContaining({ symbolId: handler, kind: "guard", expression: "!payload.message" }));
    expect(index.symbols.find((symbol) => symbol.id === handler)?.explicitReturnType).toBeNull();
    const validate = semanticSymbolId("src/validation.ts", "validate");
    expect(index.symbols.find((symbol) => symbol.id === validate)?.parameters[0]?.explicitType).toBeNull();
    expect(index.validations).toContainEqual(expect.objectContaining({ symbolId: validate, kind: "schema", expression: "schema.safeParse(payload)" }));
    expect(index.validations).toContainEqual(expect.objectContaining({ symbolId: validate, kind: "assertion", expression: "assert(payload.token)" }));
  });

  it("connects the route, handler, static client, full request tree, and response variants", () => {
    const route = index.routes.find((item) => item.id === "route:POST:/api/chat");
    expect(route?.handlerSymbolId).toBe(semanticSymbolId("functions/api/chat.tsx", "onRequestPost"));
    expect(route?.clientCalls).toHaveLength(1);
    expect(route?.clientCalls[0]?.callerId).toBe(semanticSymbolId("src/ChatClient.jsx", "ChatClient.send"));
    expect(route?.clientCalls[0]?.path).toBe("/api/chat");
    expect(fieldNames(route?.requestShape ?? null)).toEqual(["message", "session_id", "name", "active", "history", "model", "temperature", "max_tokens"]);
    expect(route?.responseVariants.map((variant) => variant.status)).toEqual(["400", null]);
    expect(index.routes.find((item) => item.id === "route:GET:/api/health")).toMatchObject({ kind: "next", handlerSymbolId: "sym:app/api/health/route.ts::GET" });
    expect(index.routes.find((item) => item.id === "route:ANY:/api/status")).toMatchObject({ kind: "cloudflare", handlerSymbolId: "sym:functions/api/status.js::onRequest" });
    expect(index.routes.find((item) => item.id === "route:POST:/items")).toMatchObject({
      kind: "hono",
      handlerSymbolId: "sym:src/server.ts::create",
      middlewareSymbolIds: ["sym:src/server.ts::auth"],
    });
  });

  it("builds concepts only across proof-bearing links", () => {
    const session = index.concepts.find((concept) => concept.aliases.includes("session_id") && concept.aliases.includes("rawSessionId"));
    expect(session?.links.some((link) => link.kind === "argument-parameter")).toBe(true);
    const unrelated = index.concepts.find((concept) => concept.occurrences.some((item) => item.source.file === "src/unreferenced.ts") && concept.occurrences.some((item) => item.source.file === "functions/lib/session.ts"));
    expect(unrelated).toBeUndefined();
    const saveValue = index.concepts.find((concept) => concept.symbolIds.includes(semanticSymbolId("functions/lib/session.ts", "SessionStore.save")) && concept.aliases.includes("value"));
    expect(saveValue?.links).toContainEqual(expect.objectContaining({ kind: "argument-parameter" }));
  });

  it("separates role reachability from no-reference evidence and carries limitations", () => {
    expect(index.reachability.byRole.test.roots).toContain("test/chat.test.ts");
    expect(index.reachability.byRole.script.roots).toContain("scripts/reindex.mts");
    expect(index.reachability.byRole.migration.roots).toContain("migrations/001_seed.cts");
    expect(index.reachability.byRole.migration.roots).toContain(semanticSymbolId("migrations/001_seed.cts", "up"));
    expect(index.reachability.byRole.test.roots).toContain(semanticSymbolId("test/chat.test.ts", "fixtureCase"));
    expect(index.reachability.noReferences.files).toContain("src/unreferenced.ts");
    expect(index.reachability.limitations.join(" ")).toContain("does not mean");
    expect(index.reachability.deletionClaim).toBeNull();
  });
});

describe("standalone compiler analysis", () => {
  it("indexes JS methods and reports dynamic callback calls separately", () => {
    const analysis = analyzeSemanticSource("src/example.js", "export class Box { run(cb) { return cb(this.value); } }\n");
    expect(analysis.symbols.map((symbol) => symbol.qualifiedName)).toEqual(["Box", "Box.run"]);
    expect(analysis.calls[0]).toMatchObject({ callerId: "sym:src/example.js::Box.run", resolution: "dynamic" });
    expect(analysis.findings[0]?.kind).toBe("dynamic-dispatch");
  });

  it("keeps JSDoc declarations explicit and checker inference private", () => {
    const analysis = analyzeSemanticSource(
      "src/jsdoc.js",
      "/** @param {{ token: string, nested: { active: boolean } }} input @returns {string} */\nexport function read(input) { const inferred = input.token; return inferred; }\n",
    );
    const read = analysis.symbols.find((symbol) => symbol.qualifiedName === "read");
    expect(read?.parameters[0]?.explicitType).toMatchObject({ source: "jsdoc" });
    expect(read?.parameters[0]?.shape?.fields.map((field) => field.name)).toEqual(["token", "nested"]);
    expect(read?.explicitReturnType).toMatchObject({ text: "string", source: "jsdoc" });
    expect(analysis.symbols.some((symbol) => symbol.qualifiedName.endsWith("inferred"))).toBe(false);
  });

  it("keeps unresolved internal calls out of the exact edge set", () => {
    const analysis = analyzeSemanticSource("src/missing.ts", "export function run() { return missingWork(1); }\n");
    expect(analysis.calls[0]).toMatchObject({ calleeExpression: "missingWork", calleeId: null, resolution: "unresolved" });
    expect(analysis.findings[0]?.kind).toBe("unresolved-call");
  });

  it("resolves same-file calls and preserves spread, array, and wide nested arguments", () => {
    const analysis = analyzeSemanticSource(
      "src/values.ts",
      [
        "function receive(items, options) { return options.nested.done; }",
        "export function run(items) {",
        "  return receive(...items, { a: 1, b: 2, c: 3, d: 4, e: 5, f: 6, nested: { done: true } });",
        "}",
        "export function list() { return receive([1, { ok: true }], { nested: { done: true } }); }",
      ].join("\n"),
    );
    const call = analysis.calls.find((item) => item.callerId === "sym:src/values.ts::run" && item.calleeId === "sym:src/values.ts::receive");
    expect(call?.arguments[0]).toMatchObject({ expression: "items", spread: true });
    expect(call?.arguments[1]?.shape?.fields.map((field) => field.name)).toEqual(["a", "b", "c", "d", "e", "f", "nested"]);
    expect(call?.arguments[1]?.shape?.fields.find((field) => field.name === "nested")?.shape?.fields.map((field) => field.name)).toEqual(["done"]);
    const listCall = analysis.calls.find((item) => item.callerId === "sym:src/values.ts::list");
    expect(listCall?.arguments[0]?.shape).toMatchObject({ kind: "array" });
    expect(listCall?.arguments[0]?.shape?.elements).toHaveLength(2);
  });

  it("keeps nested-function returns with their owner and records new Response variants", () => {
    const analysis = analyzeSemanticSource(
      "src/returns.ts",
      [
        "export function outer(ok) {",
        "  function nested() { return { hidden: true }; }",
        "  if (ok) return new Response(JSON.stringify({ accepted: true }), { status: 201 });",
        "  return nested();",
        "}",
      ].join("\n"),
    );
    const outer = analysis.symbols.find((symbol) => symbol.id === "sym:src/returns.ts::outer");
    const nested = analysis.symbols.find((symbol) => symbol.id === "sym:src/returns.ts::outer.nested");
    expect(outer?.returnVariants.map((variant) => variant.expression)).toEqual([
      "new Response(JSON.stringify({ accepted: true }), { status: 201 })",
      "nested()",
    ]);
    expect(outer?.returnVariants[0]).toMatchObject({ kind: "http-response", condition: "ok", status: "201" });
    expect(nested?.returnVariants.map((variant) => variant.expression)).toEqual(["{ hidden: true }"]);
  });
});
