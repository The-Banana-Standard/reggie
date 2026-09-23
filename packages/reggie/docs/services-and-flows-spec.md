# Services and Data flow

Two new pages, and the derivation behind them. Addendum to `ui-spec.md` and `ui-api-contract.md`; where they disagree, this wins.

Everything here is **derived from the repo**, never hand-written. Notes annotate what is found; they never invent a node. Every fact carries a `source` (file and line) and a `confidence` of `exact` (read from a manifest or a literal in the code) or `heuristic` (inferred from a name or a shape). The UI must show which is which, because a confident wrong answer about where data goes is worse than no answer.

Ground truth used while writing this, from `~/Desktop/Projects/personal_website`: `wrangler.toml` declares one D1 database (`CHAT_LOGS` → `jacob-chat-logs`), three KV namespaces (`RATE_LIMIT`, `CACHE`, `COST_TRACKER`), an assets binding (`ASSETS`), and two plain vars (`USE_EMBEDDING_RETRIEVAL`, `OPENAI_MODEL`). The code reads `env.OPENAI_API_KEY` 47 times but the file never declares it — it is a dashboard secret. `api.openai.com` is fetched from two places. `scripts/` reads `process.env.LASTFM_API_KEY`. That undeclared-secret case is the single most valuable thing these pages can surface, so it is a first-class output, not an afterthought.

## 1. `src/services.ts` — what the repo talks to

`detectServices(paths, graph): ServiceIndex`.

### Declared bindings and config

Parse, when present, with the declaring file and line on every result:

- `wrangler.toml` / `wrangler.jsonc`: `[[d1_databases]]` → kind `database`; `[[kv_namespaces]]` → `kv`; `[[r2_buckets]]` → `bucket`; `[[queues.producers]]` / `consumers` → `queue`; `[[durable_objects.bindings]]` → `durable-object`; `[assets]` → `assets`; `[vars]` → `var`; `[[services]]`, `[[hyperdrive]]`, `[ai]`, `[[vectorize]]`, `[[analytics_engine_datasets]]` → their own kinds. Record the binding name, the human name (`database_name`, `bucket_name`), and any id.
- `firebase.json` / `.firebaserc`: project id, and which of firestore, storage, functions, hosting are configured.
- `package.json` dependencies matched against a small catalogue of SDKs that imply an external service (`stripe`, `openai`, `@anthropic-ai/sdk`, `@aws-sdk/client-s3`, `firebase`, `firebase-admin`, `@supabase/supabase-js`, `pg`, `mysql2`, `redis`, `ioredis`, `@planetscale/database`, `mongodb`, `@sendgrid/mail`, `resend`, `twilio`, `@slack/web-api`, `googleapis`). Extend by data, not by code: keep the catalogue as one exported table so a repo can add to it.
- `.env.example`, `.dev.vars.example`, `migrations/*.sql` (table names → `table` entities under the database that owns them).

### Usage in code

Over the graph's code files, with `roleOf` excluding tests from the primary counts (keep them, flagged `viaTest`):

- Cloudflare binding use: `env.<BINDING>` and `context.env.<BINDING>` / destructured `const { BINDING } = env`. Match against declared bindings; an `env.X` in SCREAMING_CASE with no declaration becomes an **undeclared** entity of kind `secret` (or `var`) with `declared: false`.
- Node config: `process.env.<NAME>`.
- Operation classification per binding use, from the method called on it: for KV `get`/`getWithMetadata`/`list` → read, `put`/`delete` → write; for D1 `prepare` with a leading `SELECT` → read, with `INSERT`/`UPDATE`/`DELETE`/`CREATE` → write, `batch`/`exec` → write; for R2 `get`/`head`/`list` → read, `put`/`delete`/`createMultipartUpload` → write. Unknown method → `touch`. Extract the SQL's table name when it parses, and attach the operation to that table entity as well as the database.
- Outbound HTTP: `fetch("https://host/...")` and template literals whose prefix is a literal host. Group by hostname → kind `api`. Resolve a hostname to a known service when the catalogue names it (`api.openai.com` → OpenAI).
- SDK client construction: `new S3Client(...)`, `new OpenAI(...)`, `initializeApp(...)`, `createClient(...)` from a catalogued package → tie the service to that file.

### Bindings that travel as parameters (addendum, implemented)

A binding is not always used where it is read. `logConversation({ db: env.CHAT_LOGS })` in
`functions/api/chat.js` and `db.prepare(…)` in `functions/chat/logging.js` are one D1 write, and
the rule above sees neither half of it: the call site performs no operation, and the callee never
names `env`. On the ground-truth repo that left the file that actually writes the database with no
edge at all, and the Services page reported a database nothing writes to.

So: when a call site passes `env.<BINDING>` into a callee — directly, or as the value of a key in
an object literal — the callee's matching parameter is bound to that service for the length of
that function, and the operations performed on it are recorded against the callee's file with
confidence `heuristic`. One call site is not proof that every caller passes the same binding.

Resolution is one hop and deliberately narrow: the callee is resolved through a real import edge;
only a positional parameter (`f(env.CACHE)` → the parameter at that position) and a destructured
key of the same name (`f({ db: env.CHAT_LOGS })` → `{ db }`) are read; a renamed destructure binds
nothing rather than the wrong name; only kinds with an operation table qualify, so passing
`env.OPENAI_API_KEY` as `apiKey` does not put a read on every helper it reaches; and a test file
never establishes anything. `flows.ts` exports `passedBindingUses` and `services.ts` calls it, so
both pages tell the same story about the same write.

### Output

```ts
type ServiceKind = "database" | "table" | "kv" | "bucket" | "queue" | "durable-object"
  | "assets" | "api" | "var" | "secret" | "vectorize" | "ai" | "hyperdrive" | "analytics";

interface ServiceNode {
  id: string;              // "svc:kv:CACHE", "svc:api:api.openai.com", "svc:table:chat_logs"
  kind: ServiceKind;
  binding: string | null;  // CACHE
  name: string;            // human name: jacob-chat-logs, api.openai.com
  provider: string | null; // cloudflare | openai | firebase | aws | null
  declared: boolean;       // false = used in code, declared nowhere
  declaredAt: SourceRef | null;
  parent: string | null;   // a table's database
  notes: number;           // entity-note entries about it
}
interface ServiceEdge {
  file: string; service: string;
  op: "read" | "write" | "touch";
  confidence: Confidence; viaTest: boolean;
  sources: SourceRef[];    // every call site, capped at 20
}
interface ServiceIndex {
  services: ServiceNode[]; edges: ServiceEdge[];
  undeclared: ServiceNode[];      // used in code, never declared — the headline
  unused: ServiceNode[];          // declared, never used in code
  generatedAt: string;
}
```

## 2. `src/flows.ts` — how data moves, with payloads

`detectFlows(paths, graph): FlowIndex` and `traceFlow(paths, graph, entryId, opts): Flow`.

An entry point is where data enters: a Cloudflare handler (`onRequest`, `onRequestPost`, `export default { fetch }`), an Express or Hono route, a Next route handler or page, a CLI command, an MCP tool registration, or an exported UI event handler. Reuse the entry markers `graph.ts` already computes and add the handler detectors.

A flow is the chain from one entry to the sinks it reaches: a directed path over call and import edges, ending at a service edge from §1, a `Response`, or a leaf.

### Values — the hard part, and the honest part

The TypeScript compiler analyzes every tracked first-party JS, JSX, TS, and TSX file. A
call step records its real positional argument expressions in source order. For example,
`resolveSessionId(payload.session_id)` records one Argument whose expression is
`payload.session_id`; it does not invent an object named `{ rawSessionId }` from the
callee's parameter.

Object literals, arrays, tuples, referenced declared types, request bodies, and service
messages become recursive `ValueShape` trees. There is no field-count cutoff. A type is
shown only when it is explicitly declared in TypeScript, JSDoc, or a referenced declared
type; compiler inference is used to resolve code but is not presented as a declaration.
Runtime guards, assertions, and schema checks are separate `ValidationRule` facts.

Every source-backed return branch is retained as a `ReturnVariant`, including its
condition and HTTP status when present. A function with no declared return annotation
still has `explicitReturnType: null`, even when its returned expressions are visible.

```ts
interface Payload { fields: string[]; shape: string | null; confidence: Confidence; source: SourceRef | null }
interface FlowStep {
  from: string; to: string;            // node ids: file, symbol, or service
  kind: "call" | "import" | "read" | "write" | "respond";
  label: string;                       // the function or operation
  input: Payload | null; output: Payload | null;
  arguments: ArgumentValue[];           // actual call-site expressions, in order
  requestPayload: ValueShape | null;    // only an HTTP/request boundary
  servicePayload: ValueShape | null;    // only an external-service boundary
  returns: ReturnVariant[];              // all source-backed branches
  source: SourceRef;
  confidence: Confidence;              // the step itself, not its payload
  via: string | null;                  // parameter name a binding arrived under
}
interface FlowDrop { hop: number; count: number; reason: "hop-budget" | "step-cap" | "depth" }
interface Flow {
  id: string; entry: string; title: string;      // "POST /api/chat"
  method: string | null; route: string | null;
  steps: FlowStep[]; services: string[];         // services this flow reaches
  depth: number; truncated: boolean;
  dropped: FlowDrop[];                           // what the caps cost, per hop
}
```

`Payload`, `input`, and `output` are a temporary migration contract for existing readers.
They are not authoritative and may still contain the old signature-derived field list.
New UI and CLI work consumes the structured fields above; the legacy fields are removed
after every reader has migrated.

Cap a flow at 6 hops of depth; say so with `truncated` rather than silently cutting. Cycles are visited once.

**Deviation from the flat 60-step cap (implemented).** A flat cap is spent by the widest hop.
`onRequestPost` in the ground-truth repo makes 43 distinct calls, so hop 1 alone exhausted 60
steps and hop 2 could never be reached: the flow was confidently shallow, which is exactly the
failure the preamble of this document warns about. The cap is now:

- `MAX_FLOW_STEPS = 200` in total (was 60), `MAX_FLOW_HOPS = 6` unchanged;
- a **per-hop budget** of `max(MIN_HOP_STEPS, floor((maxSteps - 1) / maxHops))` — 33 steps a hop at
  the defaults, never fewer than `MIN_HOP_STEPS = 6` — so every hop within the depth limit is
  always reachable however wide the hops above it are. The walk is breadth-first, so the budgets
  are spent in hop order;
- `truncated` stays a boolean and is joined by `dropped: FlowDrop[]`, which says **what** was
  dropped: `{ hop, count, reason: 'hop-budget' | 'step-cap' | 'depth' }`, one entry per (hop,
  reason). `dropped` is empty exactly when `truncated` is false.

On the ground-truth chat handler this takes the flow from 60 steps at depth 2 to 112 steps at
depth 5, reaching the D1 database and two KV namespaces it could not see before, and it says
plainly that nine steps at hop one and nine at hop two went past what one hop may draw.

Two fields are additive to `FlowStep`: `confidence`, which says whether the *step* (not its
payload) was resolved through a declaration or a name, and `via`, the local parameter name a
binding arrived under (`db`) when §1's parameter rule found the operation.

## 3. API

- `GET /api/services` → `ServiceIndex` plus, per service, the files that touch it.
- `GET /api/service?id=` → one service with every call site, the notes about it, the tasks whose plans touch its files, and the flows that reach it.
- `GET /api/flows` → `{ flows: FlowSummary[] }` — one per entry point, with title, method, route, step count, and the services reached.
- `GET /api/flow?id=&depth=` → one `Flow`.
- `GET /api/story?scope=services|flow&id=` → narration for both pages.

All five are implemented in `src/serve.ts`, following that file's existing patterns: both
detectors are `cached()` by HEAD sha (they are pure functions of the tree), errors use the same
`{ error }` shapes, and bad input is 400. Shapes are written out in `ui-api-contract.md`; the
deviations from the list above are:

- `/api/services` attaches `files`, `readers` and `writers` to every service node (the spec asks
  for "the files that touch it" but gives no field), including inside `undeclared` and `unused`.
- `/api/service` adds `children` (a database's tables), `parent` and `editorUrl` beside the call
  sites, notes, tasks and flows the spec asks for.
- `/api/flows` answers `{ flows, generatedAt }`; `FlowEntry` adds nothing `FlowSummary` lacks, so
  the entry list is not sent twice.
- `/api/flow?depth=` validates like every other numeric parameter (400 outside 1–99) and then
  clamps to `MAX_FLOW_HOPS`, rather than refusing a number the tracer would simply not use.
- `/api/story?scope=flow` takes the same `depth`.

### Story sections

`servicesStory(ctx, index)` emits `needs-attention`, `talks-to`, `secrets`, `not-wired`;
`flowStory(ctx, flow, { services })` emits `steps` and `not-derivable`. Two deviations, both in
service of a page a person can read: plain `var` services are collapsed into one list paragraph
inside `talks-to` rather than taking a paragraph each (the ground-truth repo has 29 of them, and
29 paragraphs of "read in one place" would bury the four services that matter), and `talks-to`
writes at most 24 service paragraphs before summarising the rest. Every service still appears —
in a list, in `secrets`, or on the map — and the `needs-attention` order is exactly the spec's:
undeclared secrets, then declared-but-unused, then a service written from more than one area.

## 4. The pages

### Services (`#/repo/<name>/services`)

Map: a bipartite layout, services on the right ranked by fan-in, the files that touch them on the left, grouped into their level-1 areas; edges coloured by operation (read `--up` cyan, write `--down` orange, touch muted) and labelled with the call-site count. Node shape by kind, with the provider named on the node. Undeclared services get a `--bad` border. A service with no code edge gets a dashed border and appears in the Unused list.

Story, in this order: **Needs attention** (undeclared secrets first, then declared-but-unused, then a service written from more than one area), **What this repo talks to** (a paragraph per service: what it is, where it is declared, who reads it, who writes it, and any note about it), **Where the secrets come from**, **What is not wired up**.

Clicking a service pins a Spotlight and filters the map to it. Clicking a file goes to its file page.

### Data flow (`#/repo/<name>/flows`, one flow at `#/repo/<name>/flow/<id>`)

The index lists the entry points grouped by kind, each with its route, its step count and the services it reaches. Choosing one opens the flow.

A flow draws left to right, dagre `rankdir: LR`: the entry, then each function, then the services and the response. Edge labels stay compact, while the step detail exposes actual Arguments and recursive Request or Service payload shapes. The compatibility payload fields remain visible to older clients during migration. Service nodes use the same shapes as the Services page.

Story: a numbered narration of the flow in plain English, one paragraph per step, naming what arrives, what the step does with it, and what leaves. Each paragraph's refs highlight its step, so reading the story walks the flow. A final paragraph lists what could not be derived and why.

Both pages join the existing lens control where it makes sense (Knowledge shows note coverage on the service and step nodes) and are reachable from the repo level: the "How the pieces talk" section gains links to both.

## 4b. CLI

`reggie services` prints the undeclared secrets first, then every service with its declaring line
and the files that touch it, then the declared-and-unused list. `reggie flows` lists the entry
points grouped by kind with their step counts and the services they reach; `reggie flows <id>`
traces one, printing each step with its payloads in and out, which payloads are heuristic, and
what the caps dropped. Both take `--json`.

## 5. Acceptance

1. On personal_website, Services lists the D1 database, its tables from `migrations/`, the three KV namespaces, the assets binding, both plain vars, and `api.openai.com`, each with the wrangler line that declares it.
2. `OPENAI_API_KEY` appears under Needs attention as used in code and declared nowhere, with a count of its call sites, and it is not confused with a declared var.
3. Every service edge is labelled read, write or touch, and one is verifiable by opening the cited file and line.
4. A declared binding that no code touches appears under What is not wired up.
5. On the Reggie repo itself, Services finds no false positives: it must not invent a service from a comment or a test fixture.
6. Flows lists the Cloudflare handlers in `functions/api/` with their routes.
7. Opening the chat flow shows the complete request shape and real call expressions; the `resolveSessionId` step shows `payload.session_id`, both return branches, and no declared return type.
8. Runtime validation is shown separately from explicit types, and undeclared types remain visibly undeclared.
9. Both pages: no element outside the canvas at 1600, 1280 and 1000 px, zero console messages.
10. Typecheck clean and the whole suite green, with unit tests for both detectors over a fixture repo carrying a wrangler.toml, an undeclared secret, a fetch host, and a two-hop handler chain.
