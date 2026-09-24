import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { makeTempRepo, type TempRepo } from "../test/helpers.js";
import { buildGraph, type RepoGraph } from "./graph.js";
import { repoPaths, type RepoPaths } from "./paths.js";
import { clearHistoryCache } from "./history.js";
import type { ServiceNode } from "./services.js";
import { ensureLayout } from "./layout.js";
import {
  MAX_FLOW_HOPS,
  MAX_FLOW_STEPS,
  cloudflareRoute,
  hopBudget,
  detectEntries,
  detectFlows,
  matchDelim,
  nextRoute,
  objectLiteralKeys,
  readStringLiteral,
  splitArgs,
  traceFlow,
  type DetectFlowsOptions,
  type Flow,
  type FlowStep,
  type TraceOptions,
} from "./flows.js";
import { buildSemanticIndex, type SemanticIndex } from "./semantic-index.js";

function stepTo(flow: Flow, to: string): FlowStep | undefined {
  return flow.steps.find((s) => s.to === to);
}

function labels(flow: Flow): string[] {
  return flow.steps.map((s) => s.label);
}

// ---------------------------------------------------------------------------
// Scanners
// ---------------------------------------------------------------------------

describe("brace and literal scanners", () => {
  it("matches nested delimiters and splits top-level arguments", () => {
    const src = "f(a, { b: [1, 2], c: g(3, 4) }, d)";
    const open = src.indexOf("(");
    const close = matchDelim(src, open);
    expect(close).toBe(src.length - 1);
    const args = splitArgs(src, open + 1, close).map(([s, e]) => src.slice(s, e).trim());
    expect(args).toEqual(["a", "{ b: [1, 2], c: g(3, 4) }", "d"]);
  });

  it("reads string literals and refuses an interpolated template", () => {
    expect(readStringLiteral('  "/api/chat"', 0)).toBe("/api/chat");
    expect(readStringLiteral("'x'", 0)).toBe("x");
    expect(readStringLiteral("`https://a.test/v1`", 0)).toBe("https://a.test/v1");
    expect(readStringLiteral("`https://${host}/v1`", 0)).toBeNull();
    expect(readStringLiteral("notAString", 0)).toBeNull();
  });

  it("reads object literal keys, including quoted ones, and flags a spread", () => {
    const src = '{ a, b: 1, "c-d": 2, ...rest, [k]: 3 }';
    const keys = objectLiteralKeys(src, src, 0, src.length);
    expect(keys?.keys).toEqual(["a", "b", "c-d"]);
    expect(keys?.spread).toBe(true);
  });
});

describe("routes derived from file paths", () => {
  it("maps Cloudflare Pages Functions paths", () => {
    expect(cloudflareRoute("functions/api/chat.js")).toBe("/api/chat");
    expect(cloudflareRoute("functions/api/chat/index.js")).toBe("/api/chat");
    expect(cloudflareRoute("functions/api/[id].js")).toBe("/api/:id");
    expect(cloudflareRoute("functions/[[path]].js")).toBe("/*");
    expect(cloudflareRoute("src/lib/util.ts")).toBeNull();
  });

  it("maps Next app and pages routes", () => {
    expect(nextRoute("app/api/chat/route.ts")).toBe("/api/chat");
    expect(nextRoute("src/app/(marketing)/about/page.tsx")).toBe("/about");
    expect(nextRoute("app/blog/[slug]/page.tsx")).toBe("/blog/:slug");
    expect(nextRoute("pages/api/hello.ts")).toBe("/api/hello");
    expect(nextRoute("pages/index.tsx")).toBe("/");
  });
});

// ---------------------------------------------------------------------------
// The Cloudflare chain — the shape the spec is written against
// ---------------------------------------------------------------------------

describe("a Cloudflare handler traced to its sinks", () => {
  let repo: TempRepo;
  let paths: RepoPaths;
  let graph: RepoGraph;
  let semanticIndex: SemanticIndex;

  beforeAll(() => {
    clearHistoryCache();
    repo = makeTempRepo("reggie-flows-");
    repo.write(
      "functions/api/chat.js",
      [
        "import { checkRateLimit } from '../chat/rateLimit';",
        "import { logConversation } from '../chat/logging';",
        "import { ping } from '../chat/ping';",
        "import { withCallback } from '../chat/nested';",
        "",
        "export async function onRequestPost(context) {",
        "    const { request, env } = context;",
        "    const { message, history, sessionId } = await request.json();",
        "",
        "    if (!(await checkRateLimit(env, sessionId, 20, 600000))) {",
        "        return Response.json({ error: 'Rate limited.' }, { status: 429 });",
        "    }",
        "    ping();",
        "    withCallback(history);",
        "    await logConversation(env, { sessionId, question: message, history });",
        "    return Response.json({ reply: 'ok', sessionId });",
        "}",
        "",
      ].join("\n"),
    );
    repo.write(
      "functions/chat/rateLimit.js",
      [
        "export async function checkRateLimit(env, identifier, limit, windowMs) {",
        "    const existing = await env.RATE_LIMIT.get(`rl:${identifier}`, { type: 'json' });",
        "    if (!existing) {",
        "        await env.RATE_LIMIT.put(`rl:${identifier}`, JSON.stringify({ count: 1 }));",
        "        return true;",
        "    }",
        "    return existing.count < limit;",
        "}",
        "",
      ].join("\n"),
    );
    repo.write(
      "functions/chat/logging.js",
      [
        "export async function logConversation(env, row) {",
        "    await env.CHAT_LOGS.prepare('INSERT INTO conversations (id, q) VALUES (?, ?)').bind(row.sessionId, row.question).run();",
        "    return Response.json({ logged: true });",
        "}",
        "",
      ].join("\n"),
    );
    repo.write("functions/chat/ping.js", "export function ping() {\n    return 1;\n}\n");
    repo.write(
      "functions/chat/nested.js",
      [
        "export function withCallback(items) {",
        "    const mapped = items.map((item) => {",
        "        return { id: item.id, label: item.label };",
        "    });",
        "    return mapped;",
        "}",
        "",
      ].join("\n"),
    );
    repo.write("src/Chat.jsx", "export function Chat() { function submit() { return fetch('/api/chat', {method: 'POST'}); } return <form onSubmit={submit} />; }");
    repo.write("functions/api/admin.js", "export function onRequestGet() { return Response.json({ok:true}); }");
    repo.commitAll("cloudflare chain");
    paths = repoPaths(repo.root);
    ensureLayout(paths);
    graph = buildGraph(paths);
    semanticIndex = buildSemanticIndex(paths, graph);
  });
  afterAll(() => repo.cleanup());

  function detect(options: DetectFlowsOptions = {}) {
    return detectFlows(paths, graph, { ...options, semanticIndex });
  }

  function trace(entryId: string, options: TraceOptions = {}) {
    return traceFlow(paths, graph, entryId, { ...options, semanticIndex });
  }

  it("publishes compact source-backed origins without dropping unmatched endpoints", () => {
    const index = detect();
    const chat = index.flows.find((flow) => flow.route === "/api/chat");
    expect(chat?.clients).toEqual([expect.objectContaining({kind:"client event", file:"src/Chat.jsx",label:expect.stringContaining("Submit")})]);
    expect(chat?.clientOrigins).toBe(1);
    expect(chat?.clientsTruncated).toBe(false);
    const admin = index.flows.find((flow) => flow.route === "/api/admin");
    expect(admin).toMatchObject({clients:[],clientOrigins:0,clientsTruncated:false});
  });

  it("finds the entry with its route and method", () => {
    const index = detect();
    const entry = index.entries.find((e) => e.file === "functions/api/chat.js");
    expect(entry).toBeDefined();
    expect(entry?.kind).toBe("cloudflare");
    expect(entry?.method).toBe("POST");
    expect(entry?.route).toBe("/api/chat");
    expect(entry?.symbol).toBe("onRequestPost");
    expect(entry?.title).toBe("POST /api/chat");
    expect(entry?.source).toEqual({ file: "functions/api/chat.js", line: 6 });
    const summary = index.flows.find((f) => f.id === entry?.id);
    expect(summary?.route).toBe("/api/chat");
    expect(summary?.steps).toBeGreaterThan(4);
  });

  it("walks the whole chain, in order, without truncating", () => {
    const index = detect({ trace: false });
    const entry = index.entries.find((e) => e.symbol === "onRequestPost");
    const flow = trace(entry?.id ?? "");
    expect(flow.truncated).toBe(false);
    expect(flow.title).toBe("POST /api/chat");

    // The handler is reached first, then everything it calls, then the sinks below those.
    expect(flow.steps[0]?.from).toBe("route:POST:/api/chat");
    expect(flow.steps[0]?.to).toBe("sym:functions/api/chat.js::onRequestPost");
    expect(flow.entryNode).toBe("route:POST:/api/chat");
    expect(flow.nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "route:POST:/api/chat", kind: "endpoint", label: "POST /api/chat" }),
      expect.objectContaining({ id: "sym:functions/api/chat.js::onRequestPost", kind: "function", path: "functions/api/chat.js" }),
      expect.objectContaining({ kind: "service" }),
      expect.objectContaining({ kind: "response" }),
    ]));
    expect(labels(flow).slice(0, 6)).toEqual([
      "POST /api/chat",
      "checkRateLimit",
      "Response.json",
      "ping",
      "withCallback",
      "logConversation",
    ]);
    // Depth-ordered: a callee's own steps come after every step of the entry symbol.
    const hop1End = labels(flow).lastIndexOf("logConversation");
    expect(labels(flow).indexOf("RATE_LIMIT.get")).toBeGreaterThan(hop1End);
    expect(flow.depth).toBe(2);
  });

  it("keeps the request body as an uncapped semantic request payload", () => {
    const flow = trace("sym:functions/api/chat.js::onRequestPost");
    const first = flow.steps[0];
    expect(first?.requestPayload?.fields.map((field) => field.name)).toEqual(["message", "history", "sessionId"]);
    expect(first?.arguments).toEqual([]);
  });

  it("keeps actual positional expressions and the object argument's recursive shape", () => {
    const flow = trace("sym:functions/api/chat.js::onRequestPost");
    const step = stepTo(flow, "sym:functions/chat/logging.js::logConversation");
    expect(step?.arguments.map((argument) => argument.expression)).toEqual(["env", "{ sessionId, question: message, history }"]);
    expect(step?.arguments[1]?.shape?.fields.map((field) => field.name)).toEqual(["sessionId", "question", "history"]);
    expect(step?.arguments[1]?.source.startLine).toBe(15);
  });

  it("does not turn parameter names into a fake object for positional calls", () => {
    const flow = trace("sym:functions/api/chat.js::onRequestPost");
    const step = stepTo(flow, "sym:functions/chat/rateLimit.js::checkRateLimit");
    expect(step?.arguments.map((argument) => argument.expression)).toEqual(["env", "sessionId", "20", "600000"]);
    expect(step?.arguments.map((argument) => argument.parameterName)).toEqual(["env", "identifier", "limit", "windowMs"]);
    expect(step?.arguments.every((argument) => argument.shape?.kind !== "object")).toBe(true);
  });

  it("keeps a zero-argument call empty instead of inventing values", () => {
    const flow = trace("sym:functions/api/chat.js::onRequestPost");
    const step = stepTo(flow, "sym:functions/chat/ping.js::ping");
    expect(step).toBeDefined();
    expect(step?.arguments).toEqual([]);
  });

  it("captures source-backed return variants and the binding writes", () => {
    const flow = trace("sym:functions/api/chat.js::onRequestPost");
    const nested = stepTo(flow, "sym:functions/chat/nested.js::withCallback");
    expect(nested?.returns.map((variant) => variant.expression)).toEqual(expect.arrayContaining(["{ id: item.id, label: item.label }", "mapped"]));

    const respond = flow.steps.find((s) => s.kind === "respond");
    expect(respond?.returns[0]?.shape?.fields.map((field) => field.name)).toEqual(["error"]);
    expect(flow.steps[0]?.returns.map((variant) => variant.shape?.fields.map((field) => field.name))).toEqual(expect.arrayContaining([["error"], ["reply", "sessionId"]]));

    const kvRead = flow.steps.find((s) => s.label === "RATE_LIMIT.get");
    const kvWrite = flow.steps.find((s) => s.label === "RATE_LIMIT.put");
    expect(kvRead?.kind).toBe("read");
    expect(kvWrite?.kind).toBe("write");
    const d1 = flow.steps.find((s) => s.label === "CHAT_LOGS.prepare");
    expect(d1?.kind).toBe("write"); // INSERT
    expect(flow.services).toContain("svc:kv:RATE_LIMIT");
    expect(flow.services).toContain("svc:database:CHAT_LOGS");
    // A bare `env.CHAT_LOGS` elsewhere must not become a second, kindless service.
    expect(flow.services.filter((id) => id.endsWith(":CHAT_LOGS"))).toEqual(["svc:database:CHAT_LOGS"]);
  });

  it("accepts §1's own ServiceNode shape for the declared-service join", () => {
    const declared: ServiceNode[] = [
      {
        id: "svc:kv:RATE_LIMIT",
        kind: "kv",
        binding: "RATE_LIMIT",
        name: "rl-namespace",
        provider: "cloudflare",
        declared: true,
        declaredAt: { file: "wrangler.toml", line: 12 },
        parent: null,
        notes: 0,
        uses: 0,
        resourceId: null,
      },
    ];
    const flow = trace("sym:functions/api/chat.js::onRequestPost", { services: declared });
    expect(flow.services).toContain("svc:kv:RATE_LIMIT");
  });

  it("uses a declared service kind over the guess when §1 supplies one", () => {
    const flow = trace("sym:functions/api/chat.js::onRequestPost", {
      services: [{ id: "svc:bucket:RATE_LIMIT", kind: "bucket", binding: "RATE_LIMIT", name: "my-bucket" }],
    });
    expect(flow.services).toContain("svc:bucket:RATE_LIMIT");
    expect(flow.services).not.toContain("svc:kv:RATE_LIMIT");
  });

  it("every step carries a source file and line", () => {
    const flow = trace("sym:functions/api/chat.js::onRequestPost");
    for (const step of flow.steps) {
      expect(step.source.file).toMatch(/\.js$/);
      expect(step.source.line).toBeGreaterThan(0);
      for (const argument of step.arguments) expect(argument.source.startLine).toBeGreaterThan(0);
      for (const variant of step.returns) expect(variant.source.startLine).toBeGreaterThan(0);
    }
  });
});

// ---------------------------------------------------------------------------
// The body bound to a name, which is what the ground-truth repo writes
// ---------------------------------------------------------------------------

describe("a request body bound to a name", () => {
  let repo: TempRepo;
  afterEach(() => repo.cleanup());

  it("reads request fields through an aliased body binding", () => {
    clearHistoryCache();
    repo = makeTempRepo("reggie-flows-alias-");
    repo.write(
      "functions/api/feedback.js",
      [
        "export async function onRequestPost(context) {",
        "    const { request } = context;",
        "    let payload;",
        "    try {",
        "        payload = await request.json();",
        "    } catch (error) {",
        "        return Response.json({ error: 'Invalid JSON body.' }, { status: 400 });",
        "    }",
        "    const conversationId = payload.conversation_id;",
        "    const verdict = payload.verdict;",
        "    const note = payload.note.trim();",
        "    return Response.json({ conversationId, verdict, note });",
        "}",
        "",
      ].join("\n"),
    );
    repo.commitAll("aliased body");
    const paths = repoPaths(repo.root);
    ensureLayout(paths);
    const flow = traceFlow(paths, graphOf(paths), "sym:functions/api/feedback.js::onRequestPost");
    expect(flow.method).toBe("POST");
    // `note` is read as `payload.note.trim()` — the property is still a field, the method is not.
    expect(flow.steps[0]?.requestPayload?.fields.map((field) => field.name)).toEqual(["conversation_id", "verdict", "note"]);
  });
});

// ---------------------------------------------------------------------------
// TypeScript: the parameter-type rung
// ---------------------------------------------------------------------------

describe("TypeScript signatures", () => {
  let repo: TempRepo;
  afterEach(() => repo.cleanup());

  it("resolves a parameter type one level into an interface, and an annotated return type", () => {
    clearHistoryCache();
    repo = makeTempRepo("reggie-flows-ts-");
    // Next conventions only apply when Next is a dependency, so a plain React app's
    // `src/pages/Thing/Thing.js` is never mistaken for a route.
    repo.write("package.json", JSON.stringify({ name: "fixture", dependencies: { next: "15.0.0" } }, null, 2));
    repo.write(
      "src/types.ts",
      [
        "export interface ChatInput {",
        "  message: string;",
        "  history: string[];",
        "  sessionId?: string;",
        "}",
        "export interface ChatResult {",
        "  reply: string;",
        "  usedDocs: number;",
        "}",
        "",
      ].join("\n"),
    );
    repo.write(
      "src/answer.ts",
      [
        "import type { ChatInput, ChatResult } from './types.js';",
        "export function answer(input: ChatInput): ChatResult {",
        "  const out = { reply: input.message, usedDocs: input.history.length };",
        "  return out;",
        "}",
        "",
      ].join("\n"),
    );
    repo.write(
      "app/api/chat/route.ts",
      [
        "import { answer } from '../../../src/answer.js';",
        "export async function POST(request: Request) {",
        "  const { message, history, sessionId } = await request.json();",
        "  const input = { message, history, sessionId };",
        "  return Response.json(answer(input));",
        "}",
        "",
      ].join("\n"),
    );
    repo.commitAll("ts chain");
    const paths = repoPaths(repo.root);
    ensureLayout(paths);
    const graph = graphOf(paths);
    const index = detectFlows(paths, graph, { trace: false });

    const post = index.entries.find((e) => e.symbol === "POST");
    expect(post?.kind).toBe("next-route");
    expect(post?.method).toBe("POST");
    expect(post?.route).toBe("/api/chat");

    const flow = traceFlow(paths, graph, "sym:app/api/chat/route.ts::POST");
    expect(flow.steps[0]?.requestPayload?.fields.map((field) => field.name)).toEqual(["message", "history", "sessionId"]);
    const step = stepTo(flow, "sym:src/answer.ts::answer");
    expect(step?.arguments.map((argument) => argument.expression)).toEqual(["input"]);
    const answer = buildSemanticIndex(paths, graph).symbols.find((symbol) => symbol.id === "sym:src/answer.ts::answer");
    expect(answer?.parameters[0]?.explicitType?.text).toBe("ChatInput");
    expect(answer?.parameters[0]?.shape?.fields.map((field) => field.name)).toEqual(["message", "history", "sessionId"]);
    expect(answer?.explicitReturnType?.text).toBe("ChatResult");
    expect(answer?.returnVariants[0]?.shape?.fields.map((field) => field.name)).toEqual(["reply", "usedDocs"]);
  });

  it("keeps JSDoc as a declaration while preserving the actual caller expression", () => {
    clearHistoryCache();
    repo = makeTempRepo("reggie-flows-jsdoc-");
    repo.write(
      "functions/api/x.js",
      ["import { save } from '../lib/save.js';", "export async function onRequestPut(context) {", "  return save(context.data);", "}", ""].join("\n"),
    );
    repo.write(
      "functions/lib/save.js",
      [
        "/**",
        " * Persist one row.",
        " * @param {Object} row",
        " * @param {string} row.id",
        " * @param {number} row.at",
        " */",
        "export function save(row) {",
        "  return row;",
        "}",
        "",
      ].join("\n"),
    );
    repo.commitAll("jsdoc");
    const paths = repoPaths(repo.root);
    ensureLayout(paths);
    const graph = graphOf(paths);
    const semantic = buildSemanticIndex(paths, graph);
    const flow = traceFlow(paths, graph, "sym:functions/api/x.js::onRequestPut", { semanticIndex: semantic });
    expect(flow.method).toBe("PUT");
    const step = stepTo(flow, "sym:functions/lib/save.js::save");
    expect(step?.arguments.map((argument) => argument.expression)).toEqual(["context.data"]);
    const save = semantic.symbols.find((symbol) => symbol.id === "sym:functions/lib/save.js::save");
    expect(save?.parameters[0]?.explicitType?.text).toBe("Object");
  });
});

// ---------------------------------------------------------------------------
// Other entry shapes
// ---------------------------------------------------------------------------

describe("other entry kinds", () => {
  let repo: TempRepo;
  afterEach(() => repo.cleanup());

  it("finds Express and Hono routes, a Worker default export, a CLI command and an MCP tool", () => {
    clearHistoryCache();
    repo = makeTempRepo("reggie-flows-kinds-");
    repo.write(
      "src/server.js",
      [
        "const app = express();",
        "app.get('/health', (req, res) => res.send('ok'));",
        "router.post('/users/:id', handleUser);",
        "function handleUser(req, res) { return res.json({ ok: true }); }",
        "const cache = new Map();",
        "cache.get('not-a-route');",
        "",
      ].join("\n"),
    );
    repo.write("src/worker.js", "export default {\n  async fetch(request, env) {\n    return new Response('hi');\n  },\n};\n");
    repo.write("src/cli.js", "program.command('build').action(runBuild);\nfunction runBuild(opts) { return opts; }\n");
    repo.write("src/mcp.js", "server.registerTool('list_tasks', { title: 'x' }, async ({ slug }) => ({ slug }));\n");
    repo.commitAll("entry kinds");
    const paths = repoPaths(repo.root);
    ensureLayout(paths);
    const index = detectFlows(paths, graphOf(paths), { trace: false });
    const byTitle = new Map(index.entries.map((e) => [e.title, e]));

    expect(byTitle.get("GET /health")?.kind).toBe("http-route");
    expect(byTitle.get("POST /users/:id")?.kind).toBe("http-route");
    expect(byTitle.get("POST /users/:id")?.symbol).toBe("handleUser");
    // `cache.get('not-a-route')` has no leading slash, so it is not a route.
    expect(index.entries.some((e) => e.route === "not-a-route")).toBe(false);

    expect(index.entries.some((e) => e.file === "src/worker.js" && e.symbol === "fetch" && e.kind === "cloudflare")).toBe(true);
    expect(byTitle.get("command build")?.kind).toBe("cli");
    expect(byTitle.get("command build")?.route).toBe("build");
    expect(byTitle.get("tool list_tasks")?.kind).toBe("mcp");

    const routeFlow = traceFlow(paths, graphOf(paths), byTitle.get("POST /users/:id")!.id);
    expect(routeFlow.entryNode).toBe("route:POST:/users/:id");
    expect(routeFlow.nodes[0]).toMatchObject({ kind: "endpoint", label: "POST /users/:id" });
    const cliFlow = traceFlow(paths, graphOf(paths), byTitle.get("command build")!.id);
    expect(cliFlow.entryNode).toBe("src/cli.js");
    expect(cliFlow.nodes[0]).toMatchObject({ kind: "file", path: "src/cli.js" });
  });

  it("does not invent a Next route from a plain React app's pages directory", () => {
    clearHistoryCache();
    repo = makeTempRepo("reggie-flows-react-");
    repo.write("package.json", JSON.stringify({ name: "react-app", dependencies: { react: "19.0.0" } }));
    repo.write("src/pages/Main/Main.js", "export default function Main() {\n  return null;\n}\n");
    repo.commitAll("react pages");
    const paths = repoPaths(repo.root);
    ensureLayout(paths);
    const index = detectFlows(paths, graphOf(paths), { trace: false });
    expect(index.entries.some((e) => e.kind === "next-page")).toBe(false);
    expect(index.entries.some((e) => e.route === "/Main/Main")).toBe(false);
  });

  it("never treats a test fixture string as an entry point", () => {
    clearHistoryCache();
    repo = makeTempRepo("reggie-flows-tests-");
    repo.write("src/app.test.js", "app.get('/should-not-appear', () => {});\nexport async function onRequestGet() { return 1; }\n");
    repo.commitAll("test file");
    const paths = repoPaths(repo.root);
    ensureLayout(paths);
    const index = detectFlows(paths, graphOf(paths), { trace: false });
    expect(index.entries).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Caps
// ---------------------------------------------------------------------------

describe("caps", () => {
  let repo: TempRepo;
  afterEach(() => repo.cleanup());

  it("walks a cycle once and terminates", () => {
    clearHistoryCache();
    repo = makeTempRepo("reggie-flows-cycle-");
    repo.write(
      "functions/api/loop.js",
      ["import { b } from '../lib/b.js';", "export async function onRequestGet(context) {", "  return b(context);", "}", ""].join("\n"),
    );
    repo.write("functions/lib/b.js", "import { c } from './c.js';\nexport function b(x) { return c(x); }\n");
    repo.write("functions/lib/c.js", "import { b } from './b.js';\nexport function c(x) { return b(x); }\n");
    repo.commitAll("cycle");
    const paths = repoPaths(repo.root);
    ensureLayout(paths);
    const flow = traceFlow(paths, graphOf(paths), "sym:functions/api/loop.js::onRequestGet");
    expect(flow.truncated).toBe(false);
    // b → c and c → b both appear as edges; neither symbol is expanded twice.
    expect(labels(flow)).toEqual(["GET /api/loop", "b", "c", "b"]);
    expect(flow.steps.filter((s) => s.from === "sym:functions/lib/b.js::b")).toHaveLength(1);
    expect(flow.depth).toBe(3);
  });

  it("sets truncated when the hop cap bites, rather than cutting silently", () => {
    clearHistoryCache();
    repo = makeTempRepo("reggie-flows-deep-");
    const names = ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j"];
    repo.write(
      "functions/api/deep.js",
      ["import { a } from '../lib/a.js';", "export async function onRequestGet(context) {", "  return a(context);", "}", ""].join("\n"),
    );
    names.forEach((name, i) => {
      const next = names[i + 1];
      repo.write(
        `functions/lib/${name}.js`,
        next ? `import { ${next} } from './${next}.js';\nexport function ${name}(x) { return ${next}(x); }\n` : `export function ${name}(x) { return x; }\n`,
      );
    });
    repo.commitAll("deep chain");
    const paths = repoPaths(repo.root);
    ensureLayout(paths);
    const graph = graphOf(paths);

    const full = traceFlow(paths, graph, "sym:functions/api/deep.js::onRequestGet");
    expect(full.truncated).toBe(true);
    expect(full.depth).toBe(MAX_FLOW_HOPS);
    expect(full.steps).toHaveLength(MAX_FLOW_HOPS + 1);

    const shallow = traceFlow(paths, graph, "sym:functions/api/deep.js::onRequestGet", { depth: 2 });
    expect(shallow.truncated).toBe(true);
    expect(shallow.depth).toBe(2);
    expect(labels(shallow)).toEqual(["GET /api/deep", "a", "b"]);

    // The step cap trips independently of the hop cap.
    const capped = traceFlow(paths, graph, "sym:functions/api/deep.js::onRequestGet", { maxSteps: 3 });
    expect(capped.truncated).toBe(true);
    expect(capped.steps).toHaveLength(3);
  });

  it("still reaches the deepest hop when the entry is very wide, and says what it dropped", () => {
    clearHistoryCache();
    repo = makeTempRepo("reggie-flows-wide-");
    const WIDE = 60;
    const chain = ["a", "b", "c", "d", "e", "f"];
    const wide = Array.from({ length: WIDE }, (_, i) => `w${i}`);
    repo.write(
      "functions/api/wide.js",
      [
        "import { a } from '../lib/a.js';",
        `import { ${wide.join(", ")} } from '../lib/wide.js';`,
        "export async function onRequestGet(context) {",
        "  a(context);",
        ...wide.map((n) => `  ${n}();`),
        "}",
        "",
      ].join("\n"),
    );
    repo.write("functions/lib/wide.js", `${wide.map((n, i) => `export function ${n}() { return ${i}; }`).join("\n")}\n`);
    chain.forEach((name, i) => {
      const next = chain[i + 1];
      repo.write(
        `functions/lib/${name}.js`,
        next ? `import { ${next} } from './${next}.js';\nexport function ${name}(x) { return ${next}(x); }\n` : `export function ${name}(x) { return x; }\n`,
      );
    });
    repo.commitAll("wide entry over a deep chain");
    const paths = repoPaths(repo.root);
    ensureLayout(paths);

    const flow = traceFlow(paths, graphOf(paths), "sym:functions/api/wide.js::onRequestGet");
    // A flat step cap spends itself on the 61 calls of hop 1 and never reaches hop 2; the
    // per-hop budget keeps every hop of the chain drawable.
    expect(labels(flow)).toContain("f");
    expect(flow.depth).toBe(chain.length);
    const perHop = hopBudget(MAX_FLOW_STEPS, MAX_FLOW_HOPS);
    expect(flow.steps.filter((s) => s.from === "sym:functions/api/wide.js::onRequestGet")).toHaveLength(perHop);
    // Truncation names what went missing and where, rather than only that something did.
    expect(flow.truncated).toBe(true);
    expect(flow.dropped).toContainEqual({ hop: 1, count: WIDE + 1 - perHop, reason: "hop-budget" });
    // Nothing beyond hop 1 was starved: every later hop drew everything it had, and the
    // only other note is the last link of the chain sitting at the depth limit.
    expect(flow.dropped.filter((d) => d.reason !== "depth" && d.hop > 1)).toEqual([]);
    expect(flow.dropped.filter((d) => d.reason === "depth")).toEqual([{ hop: MAX_FLOW_HOPS + 1, count: 1, reason: "depth" }]);
  });

  it("rejects an unknown entry id with a message naming the fix", () => {
    clearHistoryCache();
    repo = makeTempRepo("reggie-flows-missing-");
    repo.write("src/index.js", "export const x = 1;\n");
    repo.commitAll("nothing to enter");
    const paths = repoPaths(repo.root);
    ensureLayout(paths);
    expect(() => traceFlow(paths, graphOf(paths), "sym:nope.js::nope")).toThrow(/detectFlows/);
  });
});

describe("structured call values", () => {
  it("keeps the actual positional expression and every untyped return variant", () => {
    const repo = makeTempRepo("reggie-flow-values-");
    try {
      repo.write(
        "functions/api/chat.js",
        [
          "function resolveSessionId(rawSessionId) {",
          "  if (rawSessionId) return rawSessionId;",
          "  return crypto.randomUUID();",
          "}",
          "export async function onRequestPost({ request }) {",
          "  const payload = await request.json();",
          "  const sessionId = resolveSessionId(payload.session_id);",
          "  return Response.json({ sessionId });",
          "}",
        ].join("\n"),
      );
      repo.commitAll("structured values");
      const paths = repoPaths(repo.root);
      ensureLayout(paths);
      const flow = traceFlow(paths, graphOf(paths), "sym:functions/api/chat.js::onRequestPost");
      const step = stepTo(flow, "sym:functions/api/chat.js::resolveSessionId");
      expect(step?.arguments).toHaveLength(1);
      expect(step?.arguments[0]).toMatchObject({ expression: "payload.session_id", parameterName: "rawSessionId", category: "argument" });
      expect(step?.returns.map((variant) => variant.expression)).toEqual(["rawSessionId", "crypto.randomUUID()"]);
      expect(step?.returns.every((variant) => variant.explicitType === null)).toBe(true);
    } finally {
      repo.cleanup();
    }
  });
});

function graphOf(paths: RepoPaths): RepoGraph {
  return buildGraph(paths);
}

describe("a capped flow never claims a service it does not reach", () => {
  it("moves a service hidden by the hop budget into servicesBeyondCap", () => {
    // A wide entry plus a tiny budget guarantees the cap drops steps. Whatever survives is what
    // `services` may claim; anything the walk saw but dropped belongs in servicesBeyondCap.
    const repo = makeTempRepo();
    try {
      const calls = Array.from({ length: 40 }, (_, i) => `  h${i}(env.CACHE);`).join("\n");
      const helpers = Array.from({ length: 40 }, (_, i) => `export function h${i}(kv) { return kv.get("k${i}"); }`).join("\n");
      repo.write("functions/api/wide.js", `import { ${Array.from({ length: 40 }, (_, i) => `h${i}`).join(", ")} } from "../lib/h.js";\nexport async function onRequestPost({ env }) {\n${calls}\n  await env.RATE_LIMIT.put("x", "1");\n  return new Response("ok");\n}\n`);
      repo.write("functions/lib/h.js", helpers);
      repo.commitAll("wide handler");

      const paths = repoPaths(repo.root);
      const graph = buildGraph(paths);
      const entries = detectEntries(paths, graph);
      const entry = entries.find((e) => e.file === "functions/api/wide.js");
      expect(entry).toBeDefined();

      const flow = traceFlow(paths, graph, entry!.id, { maxSteps: 12, maxHops: 2 });
      expect(flow.truncated).toBe(true);

      const reached = new Set<string>();
      for (const s of flow.steps) {
        if (s.to.startsWith("svc:")) reached.add(s.to);
        if (s.from.startsWith("svc:")) reached.add(s.from);
      }
      // The invariant: every claimed service is on a returned step, and the two lists are disjoint.
      for (const id of flow.services) expect(reached.has(id)).toBe(true);
      for (const id of flow.servicesBeyondCap) expect(reached.has(id)).toBe(false);
      expect(flow.services.filter((id) => flow.servicesBeyondCap.includes(id))).toEqual([]);
    } finally {
      repo.cleanup();
    }
  });
});
