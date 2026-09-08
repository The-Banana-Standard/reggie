import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { makeTempRepo, type TempRepo } from "../test/helpers.js";
import { buildGraph } from "./graph.js";
import { addNote } from "./notes.js";
import { repoPaths } from "./paths.js";
import {
  createdTables,
  detectServices,
  looksLikeSecret,
  maskComments,
  parseJsonc,
  parseSql,
  parseToml,
  type ServiceEdge,
  type ServiceIndex,
  type ServiceNode,
} from "./services.js";

/**
 * A comment block the length of a real wrangler.toml's, planted between tables. It names
 * bindings, tables and hosts that must never become services.
 */
const LONG_COMMENT = [
  "# ------------------------------------------------------------------------",
  "# This block exists to prove the reader strips comments rather than guessing",
  "# from line shapes. Everything named below is a decoy.",
  "#",
  "# A previous revision had:",
  "#   [[kv_namespaces]]",
  '#   binding = "GHOST_KV"',
  '#   id = "deadbeef"',
  "#",
  "# ...and a second database:",
  "#   [[d1_databases]]",
  '#   binding = "GHOST_DB"',
  '#   database_name = "ghost-db"',
  "#",
  "# The worker also used to read env.GHOST_FROM_COMMENT and fetch",
  '# "https://ghost.example.com/v1/nope" on every request. It no longer does,',
  "# and none of that should show up as a service. The block runs on for a while",
  "# because real wrangler files carry page-long rationales between tables and a",
  "# reader that stops at the first blank line inside a comment gets this wrong.",
  "#",
  "# ------------------------------------------------------------------------",
].join("\n");

const WRANGLER = `name = "fixture-worker"
compatibility_date = "2026-01-01"
main = "./src/worker.ts"

${LONG_COMMENT}

[vars]
FEATURE_FLAG = "true"
GREETING = "hello # not a comment"

[assets]
directory = "./public"
binding = "ASSETS"

${LONG_COMMENT}

[[d1_databases]]
binding = "CHAT_LOGS"
database_name = "fixture-logs"
database_id = "0000-1111"

${LONG_COMMENT}

[[kv_namespaces]]
binding = "CACHE"
id = "aaaa"

[[kv_namespaces]]
binding = "RATE_LIMIT"
id = "bbbb"

${LONG_COMMENT}

[[r2_buckets]]
binding = "UPLOADS"
bucket_name = "fixture-uploads"
`;

/** Uses CACHE (read + write), CHAT_LOGS (via an alias and directly), UPLOADS, and a secret. */
const WORKER = `export async function onRequestPost(context) {
  const { env } = context;
  if (env.FEATURE_FLAG !== "true") return new Response("off", { status: 503 });
  const cached = await env.CACHE.get("answer");
  await env.CACHE.put("answer", "42");
  const db = env.CHAT_LOGS;
  const rows = await db.prepare("SELECT id, note FROM conversations WHERE id = ?").bind(1).all();
  await env.CHAT_LOGS.prepare("INSERT INTO feedback (id, verdict) VALUES (?, ?)").bind(1, "up").run();
  const key = env.SOME_SECRET;
  const reply = await fetch("https://api.openai.com/v1/responses", {
    headers: { Authorization: \`Bearer \${key}\` },
  });
  await env.UPLOADS.put("transcript.json", "{}");
  return new Response(JSON.stringify({ cached, rows, reply: reply.status }));
}
`;

/**
 * Every trap in one file: a binding named in a `//` comment, a URL fetched inside a `/* *​/`
 * block, and plain local variables that merely share a name with a declared binding.
 */
const DECOY = `// The old worker read env.GHOST_FROM_COMMENT and called
// fetch("https://ghost-line-comment.example.com/v1/x") on every request.
/*
 * It also had a second store:
 *   const stale = await env.GHOST_KV.get("k");
 *   await fetch("https://ghost-block-comment.example.com/v1/x");
 */
const RATE_LIMIT = 30;
const CACHE = new Map();
const UPLOADS = ["a.txt"];

export function overBudget(count) {
  CACHE.set("n", count);
  return count > RATE_LIMIT && UPLOADS.length > 0;
}
`;

const MIGRATION = `CREATE TABLE conversations (
  id TEXT PRIMARY KEY,
  note TEXT NOT NULL
);
CREATE INDEX idx_conversations_id ON conversations(id);

-- CREATE TABLE ghost_from_sql_comment (id TEXT PRIMARY KEY);
/* CREATE TABLE ghost_from_sql_block (id TEXT PRIMARY KEY); */

CREATE TABLE feedback (
  id TEXT PRIMARY KEY,
  verdict TEXT NOT NULL
);
`;

/** Role `test`: its bindings are real, its secrets and hosts are props. */
const WORKER_TEST = `import { onRequestPost } from "../src/worker.js";

const env = { CACHE: new Map(), TEST_ONLY_SECRET: "sk-fake" };

it("answers", async () => {
  await env.CACHE.get("answer");
  const token = env.TEST_ONLY_SECRET;
  await fetch("https://test-only-host.example.com/v1/x", { headers: { token } });
  await onRequestPost({ env });
});
`;

/** Role `fixture`: nothing here may establish a service. */
const FIXTURE = `export const sample = {
  env: { FIXTURE_ONLY_SECRET: "sk-fixture" },
};

export async function primeFixture(env) {
  const key = env.FIXTURE_ONLY_SECRET;
  await fetch("https://fixture-only.example.com/v1/x", { headers: { key } });
}
`;

function buildIndex(repo: TempRepo): ServiceIndex {
  const paths = repoPaths(repo.root);
  return detectServices(paths, buildGraph(paths));
}

const node = (index: ServiceIndex, id: string): ServiceNode | undefined => index.services.find((s) => s.id === id);
const edgesFor = (index: ServiceIndex, id: string): ServiceEdge[] => index.edges.filter((e) => e.service === id);
const opsFor = (index: ServiceIndex, id: string): string[] => [...new Set(edgesFor(index, id).map((e) => e.op))].sort();

describe("detectServices §1: a Cloudflare worker repo", () => {
  let repo: TempRepo;
  let index: ServiceIndex;

  beforeEach(() => {
    repo = makeTempRepo("reggie-services-");
    repo.write("wrangler.toml", WRANGLER);
    repo.write("src/worker.ts", WORKER);
    repo.write("src/decoy.ts", DECOY);
    repo.write("migrations/0001_init.sql", MIGRATION);
    repo.write("test/worker.test.ts", WORKER_TEST);
    repo.write("test/fixtures/sample.ts", FIXTURE);
    repo.commitAll("fixture worker");
    index = buildIndex(repo);
  });
  afterEach(() => repo.cleanup());

  it("reads every wrangler binding with the line that declares it", () => {
    const wrangler = repo.root;
    expect(wrangler).toBeTruthy();
    const db = node(index, "svc:database:CHAT_LOGS");
    expect(db?.kind).toBe("database");
    expect(db?.name).toBe("fixture-logs");
    expect(db?.provider).toBe("cloudflare");
    expect(db?.declared).toBe(true);
    expect(db?.declaredAt?.file).toBe("wrangler.toml");
    expect(db?.resourceId).toBe("0000-1111");
    expect(node(index, "svc:kv:CACHE")?.resourceId).toBe("aaaa");
    expect(node(index, "svc:bucket:UPLOADS")?.resourceId).toBeNull();

    const kinds = index.services.filter((s) => s.declared).map((s) => `${s.kind}:${s.binding ?? s.name}`);
    expect(kinds).toEqual(
      expect.arrayContaining([
        "database:CHAT_LOGS",
        "kv:CACHE",
        "kv:RATE_LIMIT",
        "bucket:UPLOADS",
        "assets:ASSETS",
        "var:FEATURE_FLAG",
        "var:GREETING",
      ]),
    );
    // Every declaration cites a real line of the file that declares it.
    const lines = WRANGLER.split("\n");
    const misfiled = index.services
      .filter((s) => s.declared && s.declaredAt?.file === "wrangler.toml")
      .filter((s) => {
        const text = lines[(s.declaredAt?.line ?? 0) - 1] ?? "";
        return !text.includes(s.binding ?? s.name) && !text.includes(s.name);
      })
      .map((s) => `${s.id} → line ${s.declaredAt?.line}`);
    expect(misfiled).toEqual([]);
  });

  it("keeps a # inside a quoted value out of the comment stripper", () => {
    expect(node(index, "svc:var:GREETING")?.declared).toBe(true);
  });

  it("classifies KV, D1 and R2 operations from the method called", () => {
    expect(opsFor(index, "svc:kv:CACHE")).toEqual(["read", "write"]);
    expect(opsFor(index, "svc:bucket:UPLOADS")).toEqual(["write"]);
    expect(opsFor(index, "svc:database:CHAT_LOGS")).toEqual(expect.arrayContaining(["read", "write"]));

    const read = edgesFor(index, "svc:kv:CACHE").find((e) => e.op === "read");
    expect(read?.file).toBe("src/worker.ts");
    expect(read?.confidence).toBe("exact");
    expect(read?.viaTest).toBe(false);
    // The cited line really is the `.get` call.
    expect(WORKER.split("\n")[(read?.sources[0]?.line ?? 0) - 1]).toContain("env.CACHE.get");
  });

  it("attaches SQL operations to the table the statement names", () => {
    expect(opsFor(index, "svc:table:conversations")).toEqual(["read"]);
    expect(opsFor(index, "svc:table:feedback")).toEqual(["write"]);
    expect(node(index, "svc:table:conversations")?.parent).toBe("svc:database:CHAT_LOGS");
  });

  it("makes tables from migrations, and never from a SQL comment", () => {
    const tables = index.services.filter((s) => s.kind === "table");
    expect(tables.map((t) => t.name).sort()).toEqual(["conversations", "feedback"]);
    expect(tables.every((t) => t.declared && t.declaredAt?.file === "migrations/0001_init.sql")).toBe(true);
    expect(createdTables(MIGRATION).map((t) => t.name)).toEqual(["conversations", "feedback"]);
  });

  it("reports a used-but-undeclared secret as the headline, distinct from a declared var", () => {
    const secret = node(index, "svc:secret:SOME_SECRET");
    expect(secret?.kind).toBe("secret");
    expect(secret?.declared).toBe(false);
    expect(secret?.declaredAt).toBeNull();
    expect(secret?.uses).toBe(1);
    expect(index.undeclared.map((s) => s.id)).toContain("svc:secret:SOME_SECRET");

    // …and a declared var read the same way is not swept in with it.
    expect(node(index, "svc:var:FEATURE_FLAG")?.declared).toBe(true);
    expect(node(index, "svc:var:FEATURE_FLAG")?.uses).toBe(1);
    expect(opsFor(index, "svc:var:FEATURE_FLAG")).toEqual(["read"]);
    expect(index.undeclared.map((s) => s.id)).not.toContain("svc:var:FEATURE_FLAG");
    expect(index.undeclared.every((s) => !s.declared)).toBe(true);
  });

  it("groups an outbound fetch by hostname", () => {
    const api = node(index, "svc:api:api.openai.com");
    expect(api?.kind).toBe("api");
    expect(api?.provider).toBe("openai");
    const edge = edgesFor(index, "svc:api:api.openai.com")[0];
    expect(edge?.file).toBe("src/worker.ts");
    expect(WORKER.split("\n")[(edge?.sources[0]?.line ?? 0) - 1]).toContain("api.openai.com");
  });

  it("lists a declared binding nothing touches under unused", () => {
    const unused = index.unused.map((s) => s.binding ?? s.name).sort();
    expect(unused).toEqual(["ASSETS", "GREETING", "RATE_LIMIT"]);
    expect(index.unused.every((s) => s.declared)).toBe(true);
    expect(unused).not.toContain("CACHE");
  });

  it("gives every node and edge a source and a confidence", () => {
    for (const s of index.services) {
      if (s.declared) expect(s.declaredAt).not.toBeNull();
      expect(s.id.startsWith("svc:")).toBe(true);
    }
    for (const e of index.edges) {
      expect(["exact", "heuristic"]).toContain(e.confidence);
      expect(e.sources.length).toBeGreaterThan(0);
      expect(e.sources.length).toBeLessThanOrEqual(20);
      expect(e.count).toBeGreaterThanOrEqual(e.sources.length);
      for (const ref of e.sources) expect(ref.line).toBeGreaterThan(0);
    }
  });

  it("keeps test files as viaTest edges and out of the primary counts", () => {
    const cache = edgesFor(index, "svc:kv:CACHE");
    const test = cache.find((e) => e.file === "test/worker.test.ts");
    expect(test?.viaTest).toBe(true);
    expect(cache.some((e) => e.file === "src/worker.ts" && !e.viaTest)).toBe(true);
    // `uses` counts the two real call sites, not the test's.
    expect(node(index, "svc:kv:CACHE")?.uses).toBe(2);
  });

  it("invents nothing from a comment, a fixture, or a look-alike variable", () => {
    const names = index.services.map((s) => `${s.binding ?? ""}|${s.name}`).join(" ");
    for (const ghost of ["GHOST_FROM_COMMENT", "GHOST_KV", "GHOST_DB", "ghost-db", "ghost_from_sql_comment", "ghost_from_sql_block"]) {
      expect(names).not.toContain(ghost);
    }
    for (const host of ["ghost.example.com", "ghost-line-comment.example.com", "ghost-block-comment.example.com"]) {
      expect(index.services.some((s) => s.name === host)).toBe(false);
    }
    // A test's prop secret and a fixture's are not secrets.
    expect(index.services.some((s) => s.name === "TEST_ONLY_SECRET")).toBe(false);
    expect(index.services.some((s) => s.name === "FIXTURE_ONLY_SECRET")).toBe(false);
    expect(index.services.some((s) => s.name === "test-only-host.example.com")).toBe(false);
    expect(index.services.some((s) => s.name === "fixture-only.example.com")).toBe(false);
    // `const RATE_LIMIT = 30` in decoy.ts is a number, not the KV namespace.
    expect(index.edges.some((e) => e.file === "src/decoy.ts")).toBe(false);
  });

  it("counts entity notes about a service", () => {
    const paths = repoPaths(repo.root);
    addNote(paths, "service:CACHE", { type: "why", text: "Chat answers are cached for a day.", author: "test" });
    addNote(paths, "env:SOME_SECRET", { type: "gotcha", text: "Dashboard secret; absent locally.", author: "test" });
    const fresh = detectServices(paths, buildGraph(paths));
    expect(node(fresh, "svc:kv:CACHE")?.notes).toBe(1);
    expect(node(fresh, "svc:secret:SOME_SECRET")?.notes).toBe(1);
    expect(node(fresh, "svc:bucket:UPLOADS")?.notes).toBe(0);
  });
});

describe("detectServices §1: wrangler.jsonc, firebase and the SDK catalogue", () => {
  let repo: TempRepo;
  afterEach(() => repo.cleanup());

  it("reads the same bindings out of wrangler.jsonc, comments and all", () => {
    repo = makeTempRepo("reggie-services-jsonc-");
    repo.write(
      "wrangler.jsonc",
      `{
  // The name of the worker. A comment mentioning "GHOST_KV" proves nothing.
  "name": "jsonc-worker",
  "compatibility_date": "2026-01-01",
  /* A block comment with a decoy binding: { "binding": "GHOST_BLOCK" } */
  "vars": { "FEATURE_FLAG": "true" },
  "kv_namespaces": [{ "binding": "CACHE", "id": "aaaa" }],
  "d1_databases": [{ "binding": "CHAT_LOGS", "database_name": "jsonc-logs", "database_id": "1" }],
  "r2_buckets": [{ "binding": "UPLOADS", "bucket_name": "jsonc-uploads" }],
  "queues": { "producers": [{ "binding": "JOBS", "queue": "jsonc-jobs" }] },
  "durable_objects": { "bindings": [{ "name": "ROOMS", "class_name": "Room" }] },
}`,
    );
    repo.write("src/worker.ts", 'export default { async fetch(req, env) { return env.CACHE.get("k"); } };\n');
    repo.commitAll("jsonc worker");
    const index = buildIndex(repo);
    const ids = index.services.map((s) => s.id);
    expect(ids).toEqual(
      expect.arrayContaining([
        "svc:kv:CACHE",
        "svc:database:CHAT_LOGS",
        "svc:bucket:UPLOADS",
        "svc:queue:jsonc-jobs",
        "svc:durable-object:ROOMS",
        "svc:var:FEATURE_FLAG",
      ]),
    );
    expect(ids.some((id) => id.includes("GHOST"))).toBe(false);
    expect(node(index, "svc:database:CHAT_LOGS")?.name).toBe("jsonc-logs");
    for (const s of index.services.filter((s) => s.declared)) expect(s.declaredAt?.file).toBe("wrangler.jsonc");
    expect(opsFor(index, "svc:kv:CACHE")).toEqual(["read"]);
  });

  it("declares a service from a catalogued dependency and ties it to the file that constructs it", () => {
    repo = makeTempRepo("reggie-services-sdk-");
    repo.write("package.json", JSON.stringify({ name: "sdk-app", dependencies: { openai: "^4.0.0", stripe: "^16.0.0", lodash: "^4.0.0" } }, null, 2));
    repo.write("src/ai.ts", 'import OpenAI from "openai";\n\nexport const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });\n');
    repo.write("src/util.ts", 'export class OpenAI {}\nexport const decoy = new OpenAI();\n');
    repo.commitAll("sdk app");
    const index = buildIndex(repo);

    const openai = node(index, "svc:api:api.openai.com");
    expect(openai?.declared).toBe(true);
    expect(openai?.provider).toBe("openai");
    expect(openai?.declaredAt?.file).toBe("package.json");
    expect(edgesFor(index, "svc:api:api.openai.com").map((e) => e.file)).toEqual(["src/ai.ts"]);
    // stripe is declared but nothing constructs it.
    expect(index.unused.map((s) => s.name)).toContain("api.stripe.com");
    // lodash is not a service.
    expect(index.services.some((s) => s.name.includes("lodash"))).toBe(false);
    // The secret the SDK is given is still undeclared.
    expect(index.undeclared.map((s) => s.name)).toContain("OPENAI_API_KEY");
  });

  it("reads firebase.json and .firebaserc", () => {
    repo = makeTempRepo("reggie-services-fb-");
    repo.write(".firebaserc", '{ "projects": { "default": "fixture-project" } }');
    repo.write("firebase.json", '{\n  "firestore": { "rules": "firestore.rules" },\n  "hosting": { "public": "dist" }\n}');
    repo.write("src/app.ts", "export const app = 1;\n");
    repo.commitAll("firebase app");
    const index = buildIndex(repo);
    const names = index.services.map((s) => s.name);
    expect(names).toContain("firestore (fixture-project)");
    expect(names).toContain("firebase-hosting (fixture-project)");
    expect(names.some((n) => n.startsWith("firebase-storage"))).toBe(false);
    expect(index.services.every((s) => s.declaredAt?.file === "firebase.json")).toBe(true);
  });

  it("treats .env.example as documentation, not as a declaration", () => {
    repo = makeTempRepo("reggie-services-env-");
    repo.write(".env.example", "# a comment\nAPP_SECRET=replace-me\nUNUSED_IN_CODE=1\n");
    repo.write("src/app.ts", "export const key = process.env.APP_SECRET;\n");
    repo.commitAll("env app");
    const index = buildIndex(repo);
    const secret = node(index, "svc:secret:APP_SECRET");
    expect(secret?.declared).toBe(false);
    expect(secret?.declaredAt).toEqual({ file: ".env.example", line: 2 });
    expect(index.undeclared.map((s) => s.name)).toContain("APP_SECRET");
    // A name only an example file mentions is not a service at all.
    expect(index.services.some((s) => s.name === "UNUSED_IN_CODE")).toBe(false);
  });

  it("ignores ambient environment names", () => {
    repo = makeTempRepo("reggie-services-ambient-");
    repo.write("src/app.ts", 'export const dev = process.env.NODE_ENV !== "production" && !process.env.CI && process.env.HOME;\n');
    repo.commitAll("ambient app");
    const index = buildIndex(repo);
    expect(index.services).toEqual([]);
  });
});

describe("services parsers", () => {
  it("parses tables, array tables and quoted values, ignoring long comment blocks", () => {
    const sections = parseToml(WRANGLER);
    const kv = sections.filter((s) => s.path === "kv_namespaces");
    expect(kv.length).toBe(2);
    expect(kv.map((s) => s.keys.find((k) => k.key === "binding")?.value)).toEqual(["CACHE", "RATE_LIMIT"]);
    expect(sections.filter((s) => s.path === "d1_databases").length).toBe(1);
    const vars = sections.find((s) => s.path === "vars");
    expect(vars?.keys.map((k) => k.key)).toEqual(["FEATURE_FLAG", "GREETING"]);
    expect(vars?.keys.find((k) => k.key === "GREETING")?.value).toBe("hello # not a comment");
    // The declaring line is the key's own line.
    const cacheLine = kv[0]?.keys.find((k) => k.key === "binding")?.line ?? 0;
    expect(WRANGLER.split("\n")[cacheLine - 1]).toBe('binding = "CACHE"');
  });

  it("handles environment overrides and multi-line arrays", () => {
    const sections = parseToml(
      ['run_worker_first = [', '  "/api/*",', ']', "", "[[env.production.kv_namespaces]]", 'binding = "PROD_CACHE"', 'id = "x"'].join("\n"),
    );
    const prod = sections.find((s) => s.path === "kv_namespaces");
    expect(prod?.env).toBe("production");
    expect(prod?.keys.find((k) => k.key === "binding")?.value).toBe("PROD_CACHE");
    expect(sections[0]?.keys.find((k) => k.key === "run_worker_first")?.line).toBe(1);
  });

  it("masks comments without moving any other character", () => {
    const src = 'const a = 1; // env.GHOST\nconst re = /(^|\\/)x\\//; const b = env.REAL;\n/* env.ALSO_GHOST */\n';
    const masked = maskComments(src);
    expect(masked.length).toBe(src.length);
    expect(masked.split("\n").length).toBe(src.split("\n").length);
    expect(masked).not.toContain("GHOST");
    expect(masked).toContain("env.REAL");
    // A regex literal containing an escaped slash does not swallow the rest of the line.
    expect(masked).toContain("const b = env.REAL");
  });

  it("keeps strings, because fetch URLs and SQL live in them", () => {
    const masked = maskComments('const u = "https://api.openai.com/v1"; // "https://ghost.example.com"\n');
    expect(masked).toContain("api.openai.com");
    expect(masked).not.toContain("ghost.example.com");
  });

  it("reads the leading verb and the table out of a SQL string", () => {
    expect(parseSql("SELECT id FROM conversations WHERE id = ?")).toEqual({ op: "read", table: "conversations" });
    expect(parseSql("INSERT INTO feedback (id) VALUES (?)")).toEqual({ op: "write", table: "feedback" });
    expect(parseSql("UPDATE conversations SET note = ?")).toEqual({ op: "write", table: "conversations" });
    expect(parseSql("DELETE FROM feedback WHERE id = ?")).toEqual({ op: "write", table: "feedback" });
    expect(parseSql("  -- a note\n  SELECT COUNT(*) AS n FROM conversations")).toEqual({ op: "read", table: "conversations" });
    expect(parseSql("not sql at all")).toBeNull();
  });

  it("strips jsonc comments and trailing commas", () => {
    expect(parseJsonc('{ /* x */ "a": 1, "b": [2,], }')).toEqual({ a: 1, b: [2] });
    expect(parseJsonc('{ "url": "https://x/y" } // tail')).toEqual({ url: "https://x/y" });
    expect(parseJsonc("{ nope }")).toBeNull();
  });

  it("tells a credential from a quantity that merely mentions one", () => {
    expect(looksLikeSecret("OPENAI_API_KEY")).toBe(true);
    expect(looksLikeSecret("ADMIN_STATS_TOKEN")).toBe(true);
    expect(looksLikeSecret("SLACK_WEBHOOK_URL")).toBe(true);
    expect(looksLikeSecret("CHAT_MAX_OUTPUT_TOKENS")).toBe(false);
    expect(looksLikeSecret("CHAT_INPUT_TOKEN_PRICE_USD_PER_M")).toBe(false);
    expect(looksLikeSecret("OPENAI_MODEL")).toBe(false);
  });
});
