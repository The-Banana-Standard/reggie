/**
 * Services: what the repo talks to (services-and-flows-spec.md §1).
 *
 * `detectServices` reads the manifests that *declare* infrastructure (wrangler.toml /
 * wrangler.jsonc, firebase.json, .firebaserc, package.json, migrations/*.sql, .env.example)
 * and then makes ONE pass over the code files the graph already found, looking for the places
 * that *use* it: `env.X`, `context.env.X`, `const { X } = env`, `process.env.X`, the method
 * called on a binding, the SQL handed to `.prepare()`, literal `fetch()` hosts, and SDK client
 * construction. Nothing is invented: every node and every edge carries the file and line it was
 * read from, and a `confidence` of `exact` (a literal in a manifest or in the code) or
 * `heuristic` (resolved through a name).
 *
 * The headline output is `undeclared` — a SCREAMING_CASE name the code reads that no manifest
 * declares, i.e. a dashboard secret. `unused` is its mirror: declared and never touched.
 *
 * Rules that keep it honest (spec §5.5 — no false positives):
 *  - Comments are masked before matching, so a binding named in a comment is not a service.
 *  - Test and fixture files (`roleOf`) never *discover* a service; they only add `viaTest`
 *    edges to services something else already established. A fixture's `env.FAKE_KEY` is not
 *    a secret.
 *  - `.env.example` / `.dev.vars.example` document names, they do not provision them: they fill
 *    in `declaredAt` and the kind hint but leave `declared: false`, and they never create a node
 *    on their own. `OPENAI_API_KEY` in an example file is still an undeclared secret.
 *  - `AMBIENT_ENV` names (NODE_ENV, HOME, CI, …) are runtime furniture, not services.
 *
 * Cost: one read per manifest, one read per code file, no git. Files over `MAX_SCAN_BYTES`
 * (generated bundles) are skipped.
 *
 * Additive to the spec's types: `ServiceNode.uses` and `ServiceEdge.count` carry the call-site
 * totals that `sources` loses to its cap of `MAX_SOURCES`, and `ServiceNode.resourceId` carries
 * the provider-side id (`database_id`) the spec asks to record but gives no field for.
 */

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { passedBindingUses } from "./flows.js";
import type { RepoGraph } from "./graph.js";
import { notesIndex, type NoteFile } from "./notes.js";
import type { RepoPaths } from "./paths.js";
import { isTestLike } from "./roles.js";
import type { Confidence } from "./symbols.js";
import { nowIso, readText, slugify } from "./util.js";

export type { Confidence };

// ---------------------------------------------------------------------------
// Contract types (services-and-flows-spec.md §1)
// ---------------------------------------------------------------------------

export type ServiceKind =
  | "database"
  | "table"
  | "kv"
  | "bucket"
  | "queue"
  | "durable-object"
  | "assets"
  | "api"
  | "var"
  | "secret"
  | "vectorize"
  | "ai"
  | "hyperdrive"
  | "analytics";

export type ServiceOp = "read" | "write" | "touch";

/** A file and the 1-based line a fact was read from. */
export interface SourceRef {
  file: string;
  line: number;
}

export interface ServiceNode {
  /** `svc:kv:CACHE`, `svc:api:api.openai.com`, `svc:table:chat_logs`. */
  id: string;
  kind: ServiceKind;
  binding: string | null;
  /** Human name: `jacob-chat-logs`, `api.openai.com`. */
  name: string;
  provider: string | null;
  /** false = used in code, declared nowhere. */
  declared: boolean;
  /**
   * Where it is declared — or, when `declared` is false, where it is *documented*
   * (`.env.example`), which is not the same thing.
   */
  declaredAt: SourceRef | null;
  /** A table's database. */
  parent: string | null;
  /** Entity-note entries about it. */
  notes: number;
  /** Additive: call sites outside tests. */
  uses: number;
  /** Additive: the provider-side id (`database_id`, a KV namespace `id`), when a manifest gives one. */
  resourceId: string | null;
}

export interface ServiceEdge {
  file: string;
  service: string;
  op: ServiceOp;
  confidence: Confidence;
  viaTest: boolean;
  /** Every call site, capped at `MAX_SOURCES`. */
  sources: SourceRef[];
  /** Additive: call sites before the cap. */
  count: number;
}

export interface ServiceIndex {
  services: ServiceNode[];
  edges: ServiceEdge[];
  /** Used in code, never declared — the headline. */
  undeclared: ServiceNode[];
  /** Declared, never used in code. */
  unused: ServiceNode[];
  generatedAt: string;
}

export interface DetectServicesOptions {
  /** Shared notes index (from `notesIndex`); read here when absent. */
  notes?: Map<string, NoteFile>;
  /** Repo-relative file reader; defaults to reading from `paths.root`. */
  readFile?: (file: string) => string | null;
}

// ---------------------------------------------------------------------------
// Catalogues — extend by data, not by code
// ---------------------------------------------------------------------------

/** One wrangler binding table. `array` distinguishes `[[d1_databases]]` from `[assets]`. */
export interface WranglerSpec {
  /** TOML table path and the equivalent dotted JSON key: `d1_databases`, `queues.producers`. */
  table: string;
  kind: ServiceKind;
  array: boolean;
  /** Key holding the binding name; `null` means every key in the table is a binding (`[vars]`). */
  bindingKey: string | null;
  /** Keys that may hold the human name, first match wins. */
  nameKeys: readonly string[];
  /** Keys that may hold the provider-side id, first match wins. */
  idKeys: readonly string[];
}

export const WRANGLER_BINDINGS: readonly WranglerSpec[] = [
  { table: "d1_databases", kind: "database", array: true, bindingKey: "binding", nameKeys: ["database_name"], idKeys: ["database_id"] },
  { table: "kv_namespaces", kind: "kv", array: true, bindingKey: "binding", nameKeys: [], idKeys: ["id"] },
  { table: "r2_buckets", kind: "bucket", array: true, bindingKey: "binding", nameKeys: ["bucket_name"], idKeys: [] },
  { table: "queues.producers", kind: "queue", array: true, bindingKey: "binding", nameKeys: ["queue"], idKeys: [] },
  { table: "queues.consumers", kind: "queue", array: true, bindingKey: "binding", nameKeys: ["queue"], idKeys: [] },
  { table: "durable_objects.bindings", kind: "durable-object", array: true, bindingKey: "name", nameKeys: ["class_name"], idKeys: [] },
  { table: "services", kind: "api", array: true, bindingKey: "binding", nameKeys: ["service"], idKeys: [] },
  { table: "hyperdrive", kind: "hyperdrive", array: true, bindingKey: "binding", nameKeys: [], idKeys: ["id"] },
  { table: "vectorize", kind: "vectorize", array: true, bindingKey: "binding", nameKeys: ["index_name"], idKeys: [] },
  { table: "analytics_engine_datasets", kind: "analytics", array: true, bindingKey: "binding", nameKeys: ["dataset"], idKeys: [] },
  { table: "assets", kind: "assets", array: false, bindingKey: "binding", nameKeys: ["directory"], idKeys: [] },
  { table: "ai", kind: "ai", array: false, bindingKey: "binding", nameKeys: [], idKeys: [] },
  { table: "vars", kind: "var", array: false, bindingKey: null, nameKeys: [], idKeys: [] },
];

/** Which firebase.json keys imply which service. */
export const FIREBASE_SERVICES: readonly { key: string; kind: ServiceKind; name: string }[] = [
  { key: "firestore", kind: "database", name: "firestore" },
  { key: "database", kind: "database", name: "realtime-database" },
  { key: "storage", kind: "bucket", name: "firebase-storage" },
  { key: "functions", kind: "api", name: "cloud-functions" },
  { key: "hosting", kind: "assets", name: "firebase-hosting" },
];

/**
 * Dependencies that imply an external service. ONE table, so a repo can extend it with data.
 * `service` is the canonical name that forms the node id, which is why the `openai` dependency
 * and a `fetch("https://api.openai.com/…")` land on the same node.
 */
export interface SdkEntry {
  pkg: string;
  service: string;
  kind: ServiceKind;
  provider: string | null;
  /** Hostnames that resolve to this service. */
  hosts: readonly string[];
  /** Constructor / factory names that tie a file to the service. */
  clients: readonly string[];
}

export const SDK_CATALOGUE: readonly SdkEntry[] = [
  { pkg: "stripe", service: "api.stripe.com", kind: "api", provider: "stripe", hosts: ["api.stripe.com"], clients: ["Stripe"] },
  { pkg: "openai", service: "api.openai.com", kind: "api", provider: "openai", hosts: ["api.openai.com"], clients: ["OpenAI", "AzureOpenAI"] },
  { pkg: "@anthropic-ai/sdk", service: "api.anthropic.com", kind: "api", provider: "anthropic", hosts: ["api.anthropic.com"], clients: ["Anthropic", "AnthropicBedrock", "AnthropicVertex"] },
  { pkg: "@aws-sdk/client-s3", service: "s3", kind: "bucket", provider: "aws", hosts: [], clients: ["S3Client", "S3"] },
  { pkg: "firebase", service: "firebase", kind: "api", provider: "firebase", hosts: ["firestore.googleapis.com", "firebaseio.com"], clients: ["initializeApp"] },
  { pkg: "firebase-admin", service: "firebase", kind: "api", provider: "firebase", hosts: ["firestore.googleapis.com", "firebaseio.com"], clients: ["initializeApp"] },
  { pkg: "@supabase/supabase-js", service: "supabase", kind: "api", provider: "supabase", hosts: ["supabase.co"], clients: ["createClient"] },
  { pkg: "pg", service: "postgres", kind: "database", provider: "postgres", hosts: [], clients: ["Pool", "Client"] },
  { pkg: "mysql2", service: "mysql", kind: "database", provider: "mysql", hosts: [], clients: ["createPool", "createConnection"] },
  { pkg: "redis", service: "redis", kind: "kv", provider: "redis", hosts: [], clients: ["createClient"] },
  { pkg: "ioredis", service: "redis", kind: "kv", provider: "redis", hosts: [], clients: ["Redis"] },
  { pkg: "@planetscale/database", service: "planetscale", kind: "database", provider: "planetscale", hosts: [], clients: ["connect", "Client"] },
  { pkg: "mongodb", service: "mongodb", kind: "database", provider: "mongodb", hosts: [], clients: ["MongoClient"] },
  { pkg: "@sendgrid/mail", service: "api.sendgrid.com", kind: "api", provider: "sendgrid", hosts: ["api.sendgrid.com"], clients: [] },
  { pkg: "resend", service: "api.resend.com", kind: "api", provider: "resend", hosts: ["api.resend.com"], clients: ["Resend"] },
  { pkg: "twilio", service: "api.twilio.com", kind: "api", provider: "twilio", hosts: ["api.twilio.com"], clients: ["Twilio"] },
  { pkg: "@slack/web-api", service: "slack.com", kind: "api", provider: "slack", hosts: ["slack.com", "hooks.slack.com"], clients: ["WebClient"] },
  { pkg: "googleapis", service: "googleapis.com", kind: "api", provider: "google", hosts: ["googleapis.com", "www.googleapis.com"], clients: [] },
];

/** Method → operation, per binding kind (spec §1, "Operation classification"). */
export const KV_OPS: Readonly<Record<string, ServiceOp>> = { get: "read", getWithMetadata: "read", list: "read", put: "write", delete: "write" };
export const D1_OPS: Readonly<Record<string, ServiceOp>> = { batch: "write", exec: "write", dump: "read", withSession: "touch" };
export const R2_OPS: Readonly<Record<string, ServiceOp>> = { get: "read", head: "read", list: "read", put: "write", delete: "write", createMultipartUpload: "write", resumeMultipartUpload: "write" };
export const QUEUE_OPS: Readonly<Record<string, ServiceOp>> = { send: "write", sendBatch: "write" };
export const DO_OPS: Readonly<Record<string, ServiceOp>> = { idFromName: "touch", idFromString: "touch", newUniqueId: "touch", get: "touch", getByName: "touch" };
export const ASSETS_OPS: Readonly<Record<string, ServiceOp>> = { fetch: "read" };

const OPS_BY_KIND: Partial<Record<ServiceKind, Readonly<Record<string, ServiceOp>>>> = {
  kv: KV_OPS,
  database: D1_OPS,
  bucket: R2_OPS,
  queue: QUEUE_OPS,
  "durable-object": DO_OPS,
  assets: ASSETS_OPS,
};

/** Fallback for a binding whose kind is unknown: the three tables never disagree. */
const ANY_OPS: Readonly<Record<string, ServiceOp>> = { ...KV_OPS, ...R2_OPS, ...QUEUE_OPS, ...D1_OPS };

/**
 * Runtime furniture, not services. Present in every Node process, declared by nobody, and
 * listing them as undeclared secrets would bury the one that matters.
 */
export const AMBIENT_ENV: ReadonlySet<string> = new Set([
  "NODE_ENV", "NODE_OPTIONS", "NODE_PATH", "NODE_DEBUG", "NODE_NO_WARNINGS", "NODE_TLS_REJECT_UNAUTHORIZED",
  "CI", "HOME", "PATH", "PWD", "OLDPWD", "USER", "USERNAME", "LOGNAME", "SHELL", "SHLVL", "TERM", "TERM_PROGRAM",
  "TMPDIR", "TEMP", "TMP", "TZ", "LANG", "LC_ALL", "EDITOR", "VISUAL", "PAGER", "COLUMNS", "LINES",
  "DEBUG", "FORCE_COLOR", "NO_COLOR", "COLORTERM", "VITEST", "VITEST_WORKER_ID", "JEST_WORKER_ID",
  "APPDATA", "LOCALAPPDATA", "PROGRAMFILES", "SYSTEMROOT", "COMSPEC", "HOSTNAME", "GITHUB_ACTIONS",
]);

/** Final segments that make a name a credential. */
const CREDENTIAL_TAIL: ReadonlySet<string> = new Set(["KEY", "SECRET", "TOKEN", "PASSWORD", "PASSWD", "PAT", "CREDENTIAL", "CREDENTIALS", "DSN", "SALT", "SIGNATURE"]);
/** Credential shapes that do not end in a credential word. */
const CREDENTIAL_PHRASE = /(?:^|_)(?:API_KEY|SECRET_KEY|PRIVATE_KEY|ACCESS_TOKEN|AUTH_TOKEN|WEBHOOK_URL|CONNECTION_STRING|SERVICE_ACCOUNT|DATABASE_URL)(?:_|$)/;
/**
 * Quantities that merely *mention* a credential word. `CHAT_MAX_OUTPUT_TOKENS` is a token budget,
 * not a token; calling it a secret would put noise at the top of the Needs-attention list.
 */
const QUANTITY_NAME = /(?:^|_)(?:MAX|MIN|LIMIT|COUNT|SIZE|PRICE|BUDGET|CAP|TTL|MS|USD|THRESHOLD|PER|INTERVAL|TIMEOUT)(?:_|$)/;

/** A name that reads like a credential becomes a `secret`; everything else is a `var`. */
export function looksLikeSecret(name: string): boolean {
  if (QUANTITY_NAME.test(name)) return false;
  const segments = name.split("_");
  return CREDENTIAL_TAIL.has(segments[segments.length - 1] ?? "") || CREDENTIAL_PHRASE.test(name);
}

/** Call sites kept per edge (spec: "capped at 20"). */
export const MAX_SOURCES = 20;
/** Generated bundles are not worth a regex pass. */
export const MAX_SCAN_BYTES = 2_000_000;

const KIND_ORDER: readonly ServiceKind[] = [
  "database", "table", "kv", "bucket", "queue", "durable-object", "vectorize", "ai", "hyperdrive", "analytics", "assets", "api", "secret", "var",
];

// ---------------------------------------------------------------------------
// A very small TOML reader
// ---------------------------------------------------------------------------

export interface TomlKey {
  key: string;
  value: string;
  /** 1-based. */
  line: number;
}

export interface TomlSection {
  /** Dotted table path; `""` for the implicit root table. */
  path: string;
  /** True for `[[array tables]]`. */
  array: boolean;
  /** The `[env.<name>]` this section belongs to, when any. */
  env: string | null;
  line: number;
  keys: TomlKey[];
}

/**
 * Enough TOML for a wrangler file: top-level tables, `[[array tables]]`, `key = "value"` pairs,
 * and `#` comments — which real wrangler files use in page-long blocks between tables, so the
 * comment stripping has to be exact rather than line-shaped. Values are kept as raw text with
 * one layer of quotes removed; arrays and inline tables survive as their source text.
 */
export function parseToml(text: string): TomlSection[] {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const root: TomlSection = { path: "", array: false, env: null, line: 1, keys: [] };
  const sections: TomlSection[] = [root];
  let current = root;

  for (let i = 0; i < lines.length; i += 1) {
    const raw = lines[i] ?? "";
    const line = stripTomlComment(raw).trim();
    if (line === "") continue;

    const header = /^\[\[?\s*([^\]]+?)\s*\]\]?$/.exec(line);
    if (header && line.startsWith("[")) {
      const array = line.startsWith("[[");
      const rawPath = (header[1] ?? "").split(".").map(unquote).join(".");
      const envMatch = /^env\.([^.]+)\.?(.*)$/.exec(rawPath);
      const env = envMatch ? (envMatch[1] ?? null) : null;
      const tablePath = envMatch ? (envMatch[2] ?? "") : rawPath;
      current = { path: tablePath, array, env, line: i + 1, keys: [] };
      sections.push(current);
      continue;
    }

    const eq = splitTomlPair(line);
    if (!eq) continue;
    // The key is reported on the line it opens on, even when its value spans several.
    const keyLine = i + 1;
    let value = eq.value;
    let depth = bracketDepth(value);
    while (depth > 0 && i + 1 < lines.length) {
      i += 1;
      const more = stripTomlComment(lines[i] ?? "").trim();
      value += ` ${more}`;
      depth += bracketDepth(more);
    }
    current.keys.push({ key: eq.key, value: unquote(value.trim()), line: keyLine });
  }
  return sections;
}

/** Remove a `#` comment, respecting `"` and `'` strings. */
function stripTomlComment(line: string): string {
  let quote = "";
  for (let i = 0; i < line.length; i += 1) {
    const c = line[i];
    if (quote) {
      if (c === "\\" && quote === '"') i += 1;
      else if (c === quote) quote = "";
      continue;
    }
    if (c === '"' || c === "'") quote = c;
    else if (c === "#") return line.slice(0, i);
  }
  return line;
}

function splitTomlPair(line: string): { key: string; value: string } | null {
  let quote = "";
  for (let i = 0; i < line.length; i += 1) {
    const c = line[i];
    if (quote) {
      if (c === "\\" && quote === '"') i += 1;
      else if (c === quote) quote = "";
      continue;
    }
    if (c === '"' || c === "'") quote = c;
    else if (c === "=") {
      const key = unquote(line.slice(0, i).trim());
      if (!key) return null;
      return { key, value: line.slice(i + 1).trim() };
    }
  }
  return null;
}

function bracketDepth(text: string): number {
  let depth = 0;
  let quote = "";
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (quote) {
      if (c === "\\" && quote === '"') i += 1;
      else if (c === quote) quote = "";
      continue;
    }
    if (c === '"' || c === "'") quote = c;
    else if (c === "[" || c === "{") depth += 1;
    else if (c === "]" || c === "}") depth -= 1;
  }
  return depth;
}

function unquote(text: string): string {
  const t = text.trim();
  if (t.length >= 2 && ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'")))) {
    return t.slice(1, -1);
  }
  return t;
}

// ---------------------------------------------------------------------------
// JSONC
// ---------------------------------------------------------------------------

/** Strip `//` and `/* *​/` comments and trailing commas, then parse. Returns null on failure. */
export function parseJsonc(text: string): unknown {
  let out = "";
  let i = 0;
  const n = text.length;
  while (i < n) {
    const c = text[i];
    if (c === '"') {
      const start = i;
      i += 1;
      while (i < n) {
        if (text[i] === "\\") i += 2;
        else if (text[i] === '"') { i += 1; break; }
        else i += 1;
      }
      out += text.slice(start, i);
      continue;
    }
    if (c === "/" && text[i + 1] === "/") {
      while (i < n && text[i] !== "\n") i += 1;
      continue;
    }
    if (c === "/" && text[i + 1] === "*") {
      i += 2;
      while (i < n && !(text[i] === "*" && text[i + 1] === "/")) i += 1;
      i = Math.min(n, i + 2);
      continue;
    }
    out += c;
    i += 1;
  }
  try {
    return JSON.parse(out.replace(/,(\s*[}\]])/g, "$1")) as unknown;
  } catch {
    return null;
  }
}

/**
 * First line each quoted literal appears on. JSON.parse loses positions, so this is how a
 * jsonc-declared binding still gets a line: binding names and var keys are quoted literals.
 */
function literalLines(text: string): Map<string, number> {
  const out = new Map<string, number>();
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i += 1) {
    for (const m of (lines[i] ?? "").matchAll(/"((?:[^"\\]|\\.)*)"/g)) {
      const value = m[1];
      if (value !== undefined && !out.has(value)) out.set(value, i + 1);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Comment masking and line lookup
// ---------------------------------------------------------------------------

const REGEX_PREV = new Set(["(", ",", "=", ":", "[", "!", "&", "|", "?", "{", "}", ";", "+", "-", "*", "%", "~", "^", "<", ">", "\n", ""]);
const REGEX_KEYWORDS = new Set(["return", "typeof", "instanceof", "in", "of", "case", "do", "else", "yield", "await", "void", "delete", "new", "throw"]);

/**
 * Blank out comments, keeping every other character at its original offset so line numbers and
 * match positions stay true. Strings survive — `fetch("https://…")` and `prepare("SELECT …")`
 * are the point — but a `//` or `/* *​/` block never contributes a service.
 */
export function maskComments(text: string, rust = false): string {
  const spans: [number, number][] = [];
  let i = 0;
  const n = text.length;
  let prev = "";
  while (i < n) {
    const c = text[i] ?? "";
    if (c === "/" && text[i + 1] === "/") {
      const start = i;
      while (i < n && text[i] !== "\n") i += 1;
      spans.push([start, i]);
      continue;
    }
    if (c === "/" && text[i + 1] === "*") {
      const start = i;
      i += 2;
      while (i < n && !(text[i] === "*" && text[i + 1] === "/")) i += 1;
      i = Math.min(n, i + 2);
      spans.push([start, i]);
      continue;
    }
    if (c === '"' || (c === "'" && !rust) || (c === "`" && !rust)) {
      i = skipString(text, i, c);
      prev = c;
      continue;
    }
    if (c === "/" && !rust && startsRegex(text, i, prev)) {
      i = skipRegex(text, i);
      prev = "/";
      continue;
    }
    if (c.trim() !== "") prev = c;
    i += 1;
  }
  if (spans.length === 0) return text;
  const parts: string[] = [];
  let last = 0;
  for (const [start, end] of spans) {
    parts.push(text.slice(last, start), text.slice(start, end).replace(/[^\n]/g, " "));
    last = end;
  }
  parts.push(text.slice(last));
  return parts.join("");
}

function skipString(text: string, start: number, quote: string): number {
  let i = start + 1;
  const n = text.length;
  while (i < n) {
    const c = text[i];
    if (c === "\\") { i += 2; continue; }
    if (c === quote) return i + 1;
    if (c === "\n" && quote !== "`") return i; // an unterminated quote should not eat the file
    if (c === "$" && quote === "`" && text[i + 1] === "{") {
      i += 2;
      let depth = 1;
      while (i < n && depth > 0) {
        const d = text[i];
        if (d === "{") depth += 1;
        else if (d === "}") depth -= 1;
        else if (d === '"' || d === "'" || d === "`") { i = skipString(text, i, d); continue; }
        i += 1;
      }
      continue;
    }
    i += 1;
  }
  return n;
}

function skipRegex(text: string, start: number): number {
  let i = start + 1;
  const n = text.length;
  let inClass = false;
  while (i < n) {
    const c = text[i];
    if (c === "\\") { i += 2; continue; }
    if (c === "\n") return i;
    if (c === "[") inClass = true;
    else if (c === "]") inClass = false;
    else if (c === "/" && !inClass) return i + 1;
    i += 1;
  }
  return n;
}

function startsRegex(text: string, at: number, prev: string): boolean {
  if (REGEX_PREV.has(prev)) return true;
  if (!/[A-Za-z0-9_$]/.test(prev)) return false;
  let j = at - 1;
  while (j >= 0 && /\s/.test(text[j] ?? "")) j -= 1;
  let end = j + 1;
  while (j >= 0 && /[A-Za-z0-9_$]/.test(text[j] ?? "")) j -= 1;
  return REGEX_KEYWORDS.has(text.slice(j + 1, end));
}

function lineStarts(text: string): number[] {
  const starts = [0];
  for (let i = 0; i < text.length; i += 1) if (text.charCodeAt(i) === 10) starts.push(i + 1);
  return starts;
}

function lineAt(starts: readonly number[], offset: number): number {
  let lo = 0;
  let hi = starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if ((starts[mid] ?? 0) <= offset) lo = mid;
    else hi = mid - 1;
  }
  return lo + 1;
}

/** 1-based line of the first occurrence of `needle`, or `fallback`. */
function lineOf(text: string, needle: string, fallback = 1): number {
  const idx = text.indexOf(needle);
  if (idx < 0) return fallback;
  let line = 1;
  for (let i = 0; i < idx; i += 1) if (text.charCodeAt(i) === 10) line += 1;
  return line;
}

// ---------------------------------------------------------------------------
// SQL
// ---------------------------------------------------------------------------

const CREATE_TABLE_RE = /\bCREATE\s+(?:TEMP(?:ORARY)?\s+)?TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?["`[]?([A-Za-z_][A-Za-z0-9_$]*)["`\]]?/gi;

/** Blank `--` and `/* *​/` SQL comments, offsets preserved. */
export function maskSqlComments(text: string): string {
  return text
    .replace(/--[^\n]*/g, (m) => " ".repeat(m.length))
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "));
}

/** Table names created by a migration, in file order. */
export function createdTables(sql: string): { name: string; line: number }[] {
  const masked = maskSqlComments(sql);
  const starts = lineStarts(masked);
  const out: { name: string; line: number }[] = [];
  const seen = new Set<string>();
  for (const m of masked.matchAll(CREATE_TABLE_RE)) {
    const name = m[1];
    if (!name || seen.has(name)) continue;
    seen.add(name);
    out.push({ name, line: lineAt(starts, m.index ?? 0) });
  }
  return out;
}

const SQL_TABLE_PATTERNS: readonly RegExp[] = [
  /\bFROM\s+["`[]?([A-Za-z_][A-Za-z0-9_$]*)["`\]]?/i,
  /\bINSERT\s+(?:OR\s+\w+\s+)?INTO\s+["`[]?([A-Za-z_][A-Za-z0-9_$]*)["`\]]?/i,
  /\bREPLACE\s+INTO\s+["`[]?([A-Za-z_][A-Za-z0-9_$]*)["`\]]?/i,
  /\bUPDATE\s+["`[]?([A-Za-z_][A-Za-z0-9_$]*)["`\]]?/i,
  /\bCREATE\s+(?:TEMP(?:ORARY)?\s+)?TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?["`[]?([A-Za-z_][A-Za-z0-9_$]*)["`\]]?/i,
  /\bALTER\s+TABLE\s+["`[]?([A-Za-z_][A-Za-z0-9_$]*)["`\]]?/i,
];

const SQL_WRITE_VERBS = new Set(["INSERT", "UPDATE", "DELETE", "CREATE", "REPLACE", "ALTER", "DROP", "TRUNCATE", "UPSERT"]);
const SQL_READ_VERBS = new Set(["SELECT", "WITH", "PRAGMA", "EXPLAIN"]);

/** Leading verb and, when it is a literal, the table a statement touches. */
export function parseSql(sql: string): { op: ServiceOp; table: string | null } | null {
  const text = maskSqlComments(sql).trim();
  const verbMatch = /^([A-Za-z]+)/.exec(text);
  const verb = (verbMatch?.[1] ?? "").toUpperCase();
  if (!verb) return null;
  const op: ServiceOp = SQL_WRITE_VERBS.has(verb) ? "write" : SQL_READ_VERBS.has(verb) ? "read" : "touch";
  if (op === "touch" && !SQL_READ_VERBS.has(verb) && !SQL_WRITE_VERBS.has(verb)) return null;
  let table: string | null = null;
  for (const re of SQL_TABLE_PATTERNS) {
    const m = re.exec(text);
    if (m?.[1]) { table = m[1]; break; }
  }
  return { op, table };
}

// ---------------------------------------------------------------------------
// Code-scan patterns
// ---------------------------------------------------------------------------

/** `env.NAME`, `context.env.NAME`, `process.env.NAME`, `c.env.NAME`. Group 1 = prefix, 2 = name. */
const ENV_MEMBER_RE = /(?:\b([A-Za-z_$][\w$]*)\s*\.\s*)?\benv\s*\.\s*([A-Z][A-Z0-9_]+)\b/g;
/** `env["NAME"]`, `process.env['NAME']`. */
const ENV_INDEX_RE = /(?:\b([A-Za-z_$][\w$]*)\s*\.\s*)?\benv\s*\[\s*['"]([A-Z][A-Z0-9_]+)['"]\s*\]/g;
/** `const { A, B } = env` / `= context.env`. */
const ENV_DESTRUCTURE_RE = /(?:const|let|var)\s*\{([^{}]*)\}\s*=\s*(?:[A-Za-z_$][\w$]*\s*\.\s*)?env\b/g;
/** `const db = env.CHAT_LOGS`. Group 1 = local name, 2 = binding. */
const ENV_ALIAS_RE = /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:[A-Za-z_$][\w$]*\s*\.\s*)?env\s*\.\s*([A-Z][A-Z0-9_]+)\s*(?:[;,)\]}]|$)/gm;
/** `receiver.method(`. Group 1 = receiver, 2 = method. */
const MEMBER_CALL_RE = /(?:^|[^.\w$])([A-Za-z_$][\w$]*)\s*\.\s*([A-Za-z_$][\w$]*)\s*\(/g;
/** `.method(` immediately after a binding reference. */
const METHOD_AFTER_RE = /^\s*\.\s*([A-Za-z_$][\w$]*)\s*\(/;
/** A literal URL as the first argument of a call. Group 1 = callee, 3 = url prefix. */
const URL_CALL_RE = /\b([A-Za-z_$][\w$.]*)\s*\(\s*(['"`])(https?:\/\/[^'"`\s${]+)/g;
/** `const NAME = "https://…"`. */
const URL_CONST_RE = /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*['"`](https?:\/\/[^'"`\s${]+)/g;
/** A call whose only leading argument is a bare identifier. Group 1 = callee, 2 = identifier. */
const IDENT_CALL_RE = /\b([A-Za-z_$][\w$.]*)\s*\(\s*([A-Za-z_$][\w$]*)\s*[,)]/g;
/** `new Client(`, `initializeApp(`, `createClient(`. */
const CONSTRUCT_RE = /(?:\bnew\s+([A-Za-z_$][\w$]*)|\b([A-Za-z_$][\w$]*))\s*\(/g;
/** Non-relative import and require specifiers. */
const PKG_IMPORT_RE = /(?:from\s*|\bimport\s*\(\s*|\brequire\s*\(\s*)['"]([^'".][^'"]*)['"]/g;
/** Pre-filter: no catalogued package name in the text, no SDK pass. */
const SDK_PKG_RE = new RegExp(SDK_CATALOGUE.map((e) => e.pkg.replace(/[.*+?^${}()|[\]\\/-]/g, "\\$&")).join("|"));

function isFetchLike(callee: string): boolean {
  const tail = callee.slice(callee.lastIndexOf(".") + 1);
  return tail.toLowerCase().includes("fetch");
}

function hostOf(url: string): string | null {
  const m = /^https?:\/\/([^/?#:]+)/i.exec(url);
  const host = m?.[1]?.toLowerCase() ?? "";
  if (!host || !host.includes(".") || host.endsWith(".")) return null;
  return host;
}

function packageOf(spec: string): string {
  const parts = spec.split("/");
  if (spec.startsWith("@")) return parts.slice(0, 2).join("/");
  return parts[0] ?? spec;
}

// ---------------------------------------------------------------------------
// detectServices
// ---------------------------------------------------------------------------

interface Builder {
  nodes: Map<string, ServiceNode>;
  /** Cloudflare binding name → node id. */
  byBinding: Map<string, string>;
  /** Hostname → node id, from the SDK catalogue. */
  byHost: Map<string, string>;
  /** Package name → node id. */
  byPkg: Map<string, string>;
  edges: Map<string, ServiceEdge>;
  /** Example-file mentions: name → where it is documented. */
  examples: Map<string, SourceRef>;
}

function addNode(b: Builder, node: ServiceNode): ServiceNode {
  const existing = b.nodes.get(node.id);
  if (existing) {
    if (!existing.declared && node.declared) {
      existing.declared = true;
      existing.declaredAt = node.declaredAt;
      existing.kind = node.kind;
    }
    if (existing.provider === null && node.provider !== null) existing.provider = node.provider;
    if (existing.binding === null && node.binding !== null) existing.binding = node.binding;
    if (existing.parent === null && node.parent !== null) existing.parent = node.parent;
    if (existing.resourceId === null && node.resourceId !== null) existing.resourceId = node.resourceId;
    return existing;
  }
  b.nodes.set(node.id, node);
  return node;
}

function makeNode(kind: ServiceKind, binding: string | null, name: string, extra: Partial<ServiceNode> = {}): ServiceNode {
  const key = kind === "queue" || kind === "api" || kind === "table" ? (name || binding || "") : (binding ?? name);
  return {
    id: `svc:${kind}:${key}`,
    kind,
    binding,
    name: name || binding || "",
    provider: extra.provider ?? null,
    declared: extra.declared ?? false,
    declaredAt: extra.declaredAt ?? null,
    parent: extra.parent ?? null,
    notes: 0,
    uses: 0,
    resourceId: extra.resourceId ?? null,
  };
}

function addEdge(b: Builder, file: string, service: string, op: ServiceOp, confidence: Confidence, viaTest: boolean, ref: SourceRef): void {
  const key = `${file}|${service}|${op}`;
  const existing = b.edges.get(key);
  if (!existing) {
    b.edges.set(key, { file, service, op, confidence, viaTest, sources: [ref], count: 1 });
    return;
  }
  existing.count += 1;
  if (existing.sources.length < MAX_SOURCES && !existing.sources.some((s) => s.line === ref.line && s.file === ref.file)) existing.sources.push(ref);
  if (confidence === "exact") existing.confidence = "exact";
  if (!viaTest) existing.viaTest = false;
}

export function detectServices(paths: RepoPaths, graph: RepoGraph, opts: DetectServicesOptions = {}): ServiceIndex {
  const root = paths.root;
  const readFile =
    opts.readFile ??
    ((file: string): string | null => {
      try {
        return readFileSync(path.join(root, file), "utf8");
      } catch {
        return null;
      }
    });

  const b: Builder = { nodes: new Map(), byBinding: new Map(), byHost: new Map(), byPkg: new Map(), edges: new Map(), examples: new Map() };

  readWrangler(b, root);
  readFirebase(b, root);
  readPackageJson(b, root);
  readExampleEnv(b, root);
  const databaseId = readMigrations(b, root);

  // --- one pass over the graph's code files ---------------------------------
  const files = graph.nodes.filter((n) => n.kind === "file");
  for (const node of files) {
    if (node.lang === "Other") continue;
    const content = readFile(node.path);
    if (content === null || content.length > MAX_SCAN_BYTES) continue;
    scanCode(b, node.path, content, node.lang === "Rust", isTestLike(node.role), databaseId);
  }

  // --- bindings that travel as parameters ------------------------------------
  // One hop of resolution, after the per-file pass so the binding's node already exists:
  // `logConversation({ db: env.CHAT_LOGS })` here, `db.prepare(…)` there. Without it the
  // file that actually writes the database has no edge at all, and the Services page
  // reports a database nothing writes to.
  resolvePassedBindings(b, paths, graph, databaseId);

  // --- notes, counts, lists --------------------------------------------------
  joinNotes(b, opts.notes ?? safeNotes(paths));
  for (const edge of b.edges.values()) {
    if (edge.viaTest) continue;
    const node = b.nodes.get(edge.service);
    if (node) node.uses += edge.count;
  }
  const touched = new Set<string>();
  for (const edge of b.edges.values()) if (!edge.viaTest) touched.add(edge.service);

  const services = Array.from(b.nodes.values()).sort(compareNodes);
  const edges = Array.from(b.edges.values()).sort((x, y) => x.file.localeCompare(y.file) || x.service.localeCompare(y.service) || x.op.localeCompare(y.op));
  return {
    services,
    edges,
    undeclared: services.filter((s) => !s.declared),
    unused: services.filter((s) => s.declared && !touched.has(s.id)),
    generatedAt: nowIso(),
  };
}

/**
 * Attribute an operation to the file that performs it when the binding arrived as a
 * parameter (spec §1 addendum; `passedBindingUses` in flows.ts does the resolution).
 *
 * Deliberately narrow: only a binding this pass already declared, only kinds with an
 * operation table — aliasing a secret says nothing new, and `apiKey: env.OPENAI_API_KEY`
 * would otherwise put a "read" on every helper it is handed to — and always `heuristic`,
 * because one call site is not proof that every caller passes the same binding.
 */
function resolvePassedBindings(b: Builder, paths: RepoPaths, graph: RepoGraph, databaseId: string | null): void {
  let uses: ReturnType<typeof passedBindingUses> = [];
  try {
    uses = passedBindingUses(paths, graph);
  } catch {
    return; // a scan failure must not cost the whole index
  }
  for (const use of uses) {
    const id = b.byBinding.get(use.binding);
    const kind = id ? b.nodes.get(id)?.kind : undefined;
    if (!kind || !OPS_BY_KIND[kind]) continue;
    useBinding(b, use.file, use.binding, use.method, use.after, { file: use.file, line: use.line }, false, databaseId, "heuristic");
  }
}

function compareNodes(x: ServiceNode, y: ServiceNode): number {
  const rank = KIND_ORDER.indexOf(x.kind) - KIND_ORDER.indexOf(y.kind);
  return rank !== 0 ? rank : x.name.localeCompare(y.name) || x.id.localeCompare(y.id);
}

function safeNotes(paths: RepoPaths): Map<string, NoteFile> {
  try {
    return notesIndex(paths);
  } catch {
    return new Map();
  }
}

// ---------------------------------------------------------------------------
// Declarations
// ---------------------------------------------------------------------------

function readWrangler(b: Builder, root: string): void {
  for (const file of ["wrangler.toml", "wrangler.jsonc", "wrangler.json"]) {
    const text = readText(path.join(root, file));
    if (text === null) continue;
    if (file.endsWith(".toml")) readWranglerToml(b, file, text);
    else readWranglerJson(b, file, text);
  }
}

function readWranglerToml(b: Builder, file: string, text: string): void {
  const sections = parseToml(text);
  for (const spec of WRANGLER_BINDINGS) {
    for (const section of sections) {
      if (section.path !== spec.table) continue;
      if (spec.bindingKey === null) {
        for (const key of section.keys) declareBinding(b, spec, key.key, new Map(), { file, line: key.line });
        continue;
      }
      const keys = new Map(section.keys.map((k) => [k.key, k]));
      const binding = keys.get(spec.bindingKey);
      const nameKey = spec.nameKeys.map((k) => keys.get(k)).find((k) => k !== undefined);
      if (!binding && !nameKey) continue;
      const at = { file, line: (binding ?? nameKey)?.line ?? section.line };
      declareBinding(b, spec, binding?.value ?? null, keys, at);
    }
  }
}

function readWranglerJson(b: Builder, file: string, text: string): void {
  const parsed = parseJsonc(text);
  if (!parsed || typeof parsed !== "object") return;
  const lines = literalLines(text);
  const roots: Record<string, unknown>[] = [parsed as Record<string, unknown>];
  const envs = (parsed as { env?: unknown }).env;
  if (envs && typeof envs === "object") {
    for (const value of Object.values(envs as Record<string, unknown>)) {
      if (value && typeof value === "object") roots.push(value as Record<string, unknown>);
    }
  }
  for (const spec of WRANGLER_BINDINGS) {
    for (const scope of roots) {
      const found = dig(scope, spec.table.split("."));
      if (found === undefined || found === null) continue;
      const entries = spec.array ? (Array.isArray(found) ? found : []) : [found];
      for (const entry of entries) {
        if (!entry || typeof entry !== "object") continue;
        const record = entry as Record<string, unknown>;
        if (spec.bindingKey === null) {
          for (const key of Object.keys(record)) declareBinding(b, spec, key, new Map(), { file, line: lines.get(key) ?? 1 });
          continue;
        }
        const keys = new Map<string, TomlKey>();
        for (const [k, v] of Object.entries(record)) {
          if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") keys.set(k, { key: k, value: String(v), line: lines.get(String(v)) ?? lines.get(k) ?? 1 });
        }
        const binding = keys.get(spec.bindingKey);
        const nameKey = spec.nameKeys.map((k) => keys.get(k)).find((k) => k !== undefined);
        if (!binding && !nameKey) continue;
        declareBinding(b, spec, binding?.value ?? null, keys, { file, line: (binding ?? nameKey)?.line ?? 1 });
      }
    }
  }
}

function dig(obj: Record<string, unknown>, segments: readonly string[]): unknown {
  let cursor: unknown = obj;
  for (const seg of segments) {
    if (!cursor || typeof cursor !== "object") return undefined;
    cursor = (cursor as Record<string, unknown>)[seg];
  }
  return cursor;
}

function declareBinding(b: Builder, spec: WranglerSpec, binding: string | null, keys: Map<string, TomlKey>, at: SourceRef): void {
  const humanName = spec.nameKeys.map((k) => keys.get(k)?.value).find((v) => v) ?? "";
  const name = humanName || binding || "";
  if (!binding && !name) return;
  const resourceId = spec.idKeys.map((k) => keys.get(k)?.value).find((v) => v) ?? null;
  const node = makeNode(spec.kind, binding, name, { provider: "cloudflare", declared: true, declaredAt: at, resourceId });
  const added = addNode(b, node);
  added.declared = true;
  added.declaredAt = added.declaredAt ?? at;
  if (binding) b.byBinding.set(binding, added.id);
}

function readFirebase(b: Builder, root: string): void {
  const rcText = readText(path.join(root, ".firebaserc"));
  let projectId: string | null = null;
  if (rcText !== null) {
    const parsed = parseJsonc(rcText);
    const projects = parsed && typeof parsed === "object" ? (parsed as { projects?: unknown }).projects : undefined;
    if (projects && typeof projects === "object") {
      const values = Object.values(projects as Record<string, unknown>).filter((v): v is string => typeof v === "string");
      projectId = values[0] ?? null;
    }
  }
  const text = readText(path.join(root, "firebase.json"));
  if (text === null) return;
  const parsed = parseJsonc(text);
  if (!parsed || typeof parsed !== "object") return;
  const record = parsed as Record<string, unknown>;
  for (const entry of FIREBASE_SERVICES) {
    if (!(entry.key in record)) continue;
    const name = projectId ? `${entry.name} (${projectId})` : entry.name;
    addNode(b, makeNode(entry.kind, null, name, { provider: "firebase", declared: true, declaredAt: { file: "firebase.json", line: lineOf(text, `"${entry.key}"`) } }));
  }
}

function readPackageJson(b: Builder, root: string): void {
  const text = readText(path.join(root, "package.json"));
  if (text === null) return;
  const parsed = parseJsonc(text);
  if (!parsed || typeof parsed !== "object") return;
  const record = parsed as Record<string, unknown>;
  const deps = new Set<string>();
  for (const field of ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"]) {
    const value = record[field];
    if (value && typeof value === "object") for (const key of Object.keys(value as Record<string, unknown>)) deps.add(key);
  }
  for (const entry of SDK_CATALOGUE) {
    if (!deps.has(entry.pkg)) continue;
    const node = addNode(b, makeNode(entry.kind, null, entry.service, { provider: entry.provider, declared: true, declaredAt: { file: "package.json", line: lineOf(text, `"${entry.pkg}"`) } }));
    b.byPkg.set(entry.pkg, node.id);
    for (const host of entry.hosts) b.byHost.set(host, node.id);
  }
}

const EXAMPLE_ENV_FILES = [".env.example", ".env.sample", ".env.template", ".dev.vars.example", ".dev.vars.sample", "env.example"];

/**
 * Example files document names; they do not provision them. Recorded as a `declaredAt` hint on a
 * node something else establishes, never as a declaration and never as a node of their own.
 */
function readExampleEnv(b: Builder, root: string): void {
  for (const file of EXAMPLE_ENV_FILES) {
    const text = readText(path.join(root, file));
    if (text === null) continue;
    const lines = text.split("\n");
    for (let i = 0; i < lines.length; i += 1) {
      const line = (lines[i] ?? "").trim();
      if (line === "" || line.startsWith("#")) continue;
      const m = /^(?:export\s+)?([A-Z][A-Z0-9_]+)\s*=/.exec(line);
      const name = m?.[1];
      if (name && !b.examples.has(name)) b.examples.set(name, { file, line: i + 1 });
    }
  }
}

const MIGRATION_DIRS = ["migrations", "db/migrations", "database/migrations", "sql/migrations", "supabase/migrations", "drizzle", "prisma/migrations"];

/** Returns the id of the database that owns the tables, when exactly one is identifiable. */
function readMigrations(b: Builder, root: string): string | null {
  const databases = Array.from(b.nodes.values()).filter((n) => n.kind === "database");
  const owner = databases.length === 1 ? (databases[0]?.id ?? null) : null;
  for (const dir of MIGRATION_DIRS) {
    let names: string[];
    try {
      names = readdirSafe(path.join(root, dir));
    } catch {
      continue;
    }
    for (const name of names) {
      if (!name.toLowerCase().endsWith(".sql")) continue;
      const rel = `${dir}/${name}`;
      const sql = readText(path.join(root, rel));
      if (sql === null) continue;
      for (const table of createdTables(sql)) {
        const node = makeNode("table", null, table.name, { provider: owner ? "cloudflare" : null, declared: true, declaredAt: { file: rel, line: table.line } });
        if (owner) node.parent = owner;
        addNode(b, node);
      }
    }
  }
  return owner;
}

function readdirSafe(dir: string): string[] {
  return readdirSync(dir);
}

// ---------------------------------------------------------------------------
// Code scan
// ---------------------------------------------------------------------------

function scanCode(b: Builder, file: string, raw: string, rust: boolean, viaTest: boolean, databaseId: string | null): void {
  const text = maskComments(raw, rust);
  const starts = lineStarts(text);
  const at = (offset: number): SourceRef => ({ file, line: lineAt(starts, offset) });

  // Each block below is gated on a literal its patterns all require. Most files in a repo
  // contain none of them, and a substring test is far cheaper than a regex sweep.
  if (text.includes("env")) scanEnv(b, file, text, at, viaTest, databaseId);
  if (text.includes("://")) scanHttp(b, file, text, at, viaTest);
  if (SDK_PKG_RE.test(text)) scanSdk(b, file, text, at, viaTest);
}

/** `env.X`, `process.env.X`, `const { X } = env`, and locals aliased from a binding. */
function scanEnv(b: Builder, file: string, text: string, at: (offset: number) => SourceRef, viaTest: boolean, databaseId: string | null): void {
  // 1. env.NAME / process.env.NAME, with the method called on it.
  for (const m of text.matchAll(ENV_MEMBER_RE)) {
    const name = m[2];
    if (!name) continue;
    const after = text.slice((m.index ?? 0) + m[0].length);
    const method = METHOD_AFTER_RE.exec(after)?.[1] ?? null;
    useBinding(b, file, name, method, after, at(m.index ?? 0), viaTest, databaseId);
  }
  for (const m of text.matchAll(ENV_INDEX_RE)) {
    const name = m[2];
    if (name) useBinding(b, file, name, null, "", at(m.index ?? 0), viaTest, databaseId);
  }
  // 2. const { NAME } = env
  const aliases = new Map<string, string>();
  for (const m of text.matchAll(ENV_DESTRUCTURE_RE)) {
    for (const part of (m[1] ?? "").split(",")) {
      const bound = /^\s*([A-Z][A-Z0-9_]+)\s*(?::\s*([A-Za-z_$][\w$]*))?\s*(?:=|$)/.exec(part);
      const name = bound?.[1];
      if (!name) continue;
      useBinding(b, file, name, null, "", at(m.index ?? 0), viaTest, databaseId);
      aliases.set(bound[2] ?? name, name);
    }
  }
  // 3. `const db = env.CHAT_LOGS` — the standard Cloudflare idiom, so `db.prepare(…)` is not
  //    invisible. Name-resolved within one file and never scope-aware, hence `heuristic`, and
  //    only for bindings with an operation table: aliasing a secret says nothing new.
  for (const m of text.matchAll(ENV_ALIAS_RE)) {
    if (m[1] && m[2]) aliases.set(m[1], m[2]);
  }
  const resolvable = new Map<string, string>();
  for (const [alias, binding] of aliases) {
    const id = b.byBinding.get(binding);
    const kind = id ? b.nodes.get(id)?.kind : undefined;
    if (kind && OPS_BY_KIND[kind]) resolvable.set(alias, binding);
  }
  if (resolvable.size > 0) {
    for (const m of text.matchAll(MEMBER_CALL_RE)) {
      const binding = resolvable.get(m[1] ?? "");
      if (!binding || m[1] === "env") continue;
      const callOpen = (m.index ?? 0) + m[0].length - 1;
      useBinding(b, file, binding, m[2] ?? null, text.slice(callOpen), at(m.index ?? 0), viaTest, databaseId, "heuristic");
    }
  }
}

/** Outbound HTTP with a literal host, directly or through a URL constant in the same file. */
function scanHttp(b: Builder, file: string, text: string, at: (offset: number) => SourceRef, viaTest: boolean): void {
  const urlConsts = new Map<string, string>();
  for (const m of text.matchAll(URL_CONST_RE)) {
    const ident = m[1];
    const url = m[2];
    if (ident && url && !urlConsts.has(ident)) urlConsts.set(ident, url);
  }
  for (const m of text.matchAll(URL_CALL_RE)) {
    if (!isFetchLike(m[1] ?? "")) continue;
    const host = hostOf(m[3] ?? "");
    if (host) useHost(b, file, host, at(m.index ?? 0), "exact", viaTest);
  }
  if (urlConsts.size > 0) {
    for (const m of text.matchAll(IDENT_CALL_RE)) {
      if (!isFetchLike(m[1] ?? "")) continue;
      const url = urlConsts.get(m[2] ?? "");
      const host = url ? hostOf(url) : null;
      if (host) useHost(b, file, host, at(m.index ?? 0), "heuristic", viaTest);
    }
  }
}

/** SDK client construction, only for packages this file actually imports. */
function scanSdk(b: Builder, file: string, text: string, at: (offset: number) => SourceRef, viaTest: boolean): void {
  const imported = new Set<string>();
  for (const m of text.matchAll(PKG_IMPORT_RE)) if (m[1]) imported.add(packageOf(m[1]));
  const wanted = SDK_CATALOGUE.filter((e) => imported.has(e.pkg) && e.clients.length > 0);
  if (wanted.length > 0) {
    for (const m of text.matchAll(CONSTRUCT_RE)) {
      const name = m[1] ?? m[2];
      if (!name) continue;
      const entry = wanted.find((e) => e.clients.includes(name));
      if (!entry) continue;
      const id = b.byPkg.get(entry.pkg);
      if (id) addEdge(b, file, id, "touch", "exact", viaTest, at(m.index ?? 0));
    }
  }
}

/** A binding, a var, a secret — or a name nothing declares, which is the interesting case. */
function useBinding(
  b: Builder,
  file: string,
  name: string,
  method: string | null,
  after: string,
  ref: SourceRef,
  viaTest: boolean,
  databaseId: string | null,
  confidence: Confidence = "exact",
): void {
  if (AMBIENT_ENV.has(name)) return;
  let id = b.byBinding.get(name);
  if (!id) {
    // A test file never establishes a service — a fixture's fake key is not a secret.
    if (viaTest) return;
    const kind: ServiceKind = looksLikeSecret(name) ? "secret" : "var";
    const example = b.examples.get(name) ?? null;
    const node = addNode(b, makeNode(kind, name, name, { declared: false, declaredAt: example }));
    id = node.id;
    b.byBinding.set(name, id);
  }
  const node = b.nodes.get(id);
  if (!node) return;
  const op = opFor(node.kind, method);
  addEdge(b, file, id, op, confidence, viaTest, ref);

  if (node.kind === "database" && method === "prepare") {
    const sql = firstStringArg(after);
    const parsed = sql === null ? null : parseSql(sql);
    if (parsed) {
      addEdge(b, file, id, parsed.op, confidence, viaTest, ref);
      if (parsed.table) {
        const tableId = `svc:table:${parsed.table}`;
        if (!b.nodes.has(tableId)) {
          const created = makeNode("table", null, parsed.table, { declared: false });
          created.parent = databaseId ?? node.id;
          addNode(b, created);
        }
        addEdge(b, file, tableId, parsed.op, confidence, viaTest, ref);
      }
    }
  }
}

function opFor(kind: ServiceKind, method: string | null): ServiceOp {
  if (kind === "var" || kind === "secret") return "read";
  if (!method) return "touch";
  const table = OPS_BY_KIND[kind] ?? ANY_OPS;
  return table[method] ?? ANY_OPS[method] ?? "touch";
}

/** The first string literal argument of `…(` text, up to the first `${` of a template. */
function firstStringArg(after: string): string | null {
  const open = after.indexOf("(");
  if (open < 0) return null;
  const m = /^\s*(['"`])((?:[^\\]|\\.)*?)(?:\1|\$\{)/.exec(after.slice(open + 1));
  return m?.[2] ?? null;
}

function useHost(b: Builder, file: string, host: string, ref: SourceRef, confidence: Confidence, viaTest: boolean): void {
  let id = b.byHost.get(host);
  if (!id) {
    const known = SDK_CATALOGUE.find((e) => e.hosts.some((h) => host === h || host.endsWith(`.${h}`)));
    // A catalogued host is still a *discovery* when only a test names it: this module's own
    // test file fetches api.openai.com, and that must not make OpenAI a service of Reggie
    // (spec §5.5). A test may only add its `viaTest` edge to a service already established
    // by a dependency or by real code.
    const established = known ? `svc:${known.kind}:${known.service}` : null;
    if (established !== null && b.nodes.has(established)) {
      id = established;
    } else if (viaTest) {
      return;
    } else if (known) {
      id = addNode(b, makeNode(known.kind, null, known.service, { provider: known.provider })).id;
    } else {
      id = addNode(b, makeNode("api", null, host, { provider: null })).id;
    }
    b.byHost.set(host, id);
  }
  addEdge(b, file, id, "touch", confidence, viaTest, ref);
}

// ---------------------------------------------------------------------------
// Notes
// ---------------------------------------------------------------------------

/** Entity notes (`service:CACHE`, `store:jacob-chat-logs`, `env:OPENAI_API_KEY`) joined by name. */
function joinNotes(b: Builder, notes: Map<string, NoteFile>): void {
  const byKey = new Map<string, number>();
  for (const note of notes.values()) {
    if (note.kind !== "entity") continue;
    const name = note.entity.slice(note.entity.indexOf(":") + 1);
    const key = slugify(name, 80);
    byKey.set(key, (byKey.get(key) ?? 0) + note.entries.length);
  }
  if (byKey.size === 0) return;
  for (const node of b.nodes.values()) {
    let total = 0;
    for (const candidate of new Set([node.binding, node.name].filter((v): v is string => Boolean(v)))) {
      total += byKey.get(slugify(candidate, 80)) ?? 0;
    }
    node.notes = total;
  }
}
