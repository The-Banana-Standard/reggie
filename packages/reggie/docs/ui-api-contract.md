# Reggie web API contract (v1)

All endpoints are served by `packages/reggie/src/serve.ts` over `node:http`, bound to `127.0.0.1:4310` by default. Every `/api/*` endpoint accepts `?repo=<name>` (default: the only or first repo). All responses are `application/json; charset=utf-8` with `cache-control: no-store`. Errors: `{ "error": string }` with 400 (bad input), 404 (missing entity), 405 (method), 403 (POST origin check), 413 (body too large), 500. Paths in ids are repo-relative POSIX. `?` marks optional fields; `⧗` marks stretch endpoints (route reserved, may return 501 `{error:"not implemented"}` in Core).

## Shared types

```ts
type NodeKind = 'repo'|'dir'|'file'|'symbol'|'task'|'person'|'entity'|'fold';
type Role = 'source'|'test'|'fixture'|'config'|'generated';
type EdgeKind = 'import'|'mod'|'tests'|'ipc'|'touches'|'annotates'|'uses'|'calls'|'depends-on'|'same-org'|'shares-service';
type Lens = 'structure'|'knowledge'|'tests'|'heat'|'owners'|'tasks';
type Confidence = 'exact'|'heuristic';
type NoteType = 'why'|'how'|'gotcha'|'verify'|'data-source'|'decision';
type TaskState = 'ungroomed'|'grooming'|'groomed'|'in-process'|'awaiting-decision'|'done';

interface Knowledge { own: number; inherited: number; stale: number; byType: Record<NoteType, number>; lastNoteDate: string|null; lowestConfidence: 'high'|'medium'|'low'|null }
interface Author { handle: string; name: string; email: string; lines: number; commits: number; share: number /* 0..1 */ }
interface History { commits30: number|null; commits90: number|null; commits365: number|null; linesChanged: number; lastTouched: string|null /* ISO */; authors: Author[]; busFactor: number }
// The three counts are `null` on one payload only: a graph/impact node whose files have no git history
// at all. `null` is "unknown", `0` is "cold" (no commit in that window, but commits before it) — the Heat
// lens draws them differently, so never coerce one to the other. Every other route sends numbers.
interface Aggregates { files: number; source: number; tests: number; config: number; lines: number; documented: number /* source files with own or inherited note */; stale: number; testedSource: number; tasks: string[]; history?: History }
interface EntryKind { kind: 'main'|'cli'|'mcp'|'http'|'ipc-server'; count: number }
interface CommitInfo { sha: string; author: string; handle: string; date: string; subject: string; task: string|null }

interface GraphNode {
  id: string; kind: NodeKind; label: string; path: string; parent: string|null;
  lang: string; lines: number; role: Role;
  area: string|null;                 // id of the Level-1 area containing this node (null for repo)
  knowledge: Knowledge; tasks: string[];
  // file-only
  inDegree: number; outDegree: number; testedBy: string[]; entry: boolean; entryKinds: EntryKind[]; history?: History;
  // dir/repo-only
  aggregates?: Aggregates; manifest?: 'package.json'|'Cargo.toml'|null; residual?: boolean;
  // view-only (present only in /api/graph?level=… and /api/impact responses)
  ghost?: boolean; side?: 'up'|'down'|'both'; hop?: number; foldCount?: number; foldIds?: string[]; center?: boolean;
  // task-only
  state?: TaskState; risk?: 'low'|'medium'|'high'|'unset'; owner?: string|null; age?: number|null;
  // compatibility (flat graph)
  dir: string; noteCount: number; dirNoteCount: number;
}
interface GraphEdge {
  source: string; target: string; kind: EdgeKind;
  weight?: number;                   // aggregated count (container/ghost edges); absent = 1
  names?: string[];                  // named imports / IPC command names / symbol names carried
  confidence?: Confidence;           // absent = exact
  via?: { source: string; target: string; names: string[] }[];  // aggregated edges only: a *sample* of the
                                          // file pairs behind the edge — at most 5, ordered by named-import
                                          // count then source path. A sample, so never sum it to get a total.
  top?: { path: string; files: number };  // aggregated edges only: the file most of the traffic lands on,
                                          // counted in distinct importing files (≤ weight). Computed over the
                                          // whole aggregate, before `via` is cut to 5 — render this field, never
                                          // a count derived from `via`, or the map and the story disagree.
  mostly?: { path: string; files: number };  // byte-for-byte the same object as `top`, under the name the
                                          // tooltip sentence uses ("mostly terminal.ts (17)"). Both are always
                                          // sent together, or neither is; read whichever you prefer.
  cycle?: boolean;
}
interface AreaRef { id: string; label: string; hue: number /* 1..8 by source-count rank, or 0 = other */; source: number; files: number }
```

## GET /api/facts
Unchanged shape: `{ facts: RepoFacts, config: ReggieConfig, people: PeopleFile }` plus `branch: string`, `headSha: string`, `root: string`, `workspace: { name: string; repos: string[] } | null`, `editorScheme: string` (default `vscode://file`).

## GET /api/status
`{ ready: boolean; steps: { files: boolean; imports: boolean; notes: boolean; history: boolean; tasks: boolean }; headSha: string }` — first-load card ticks. The route never blocks: the first hit starts the warm-up in the background and answers immediately with the ticks so far (so the very first poll of a cold server reports `ready:false`), and each later poll reports more. `ready` flips true once every source has been attempted; a source that failed to build keeps its tick off.

## GET /api/graph
No params (compatibility): `{ nodes: GraphNode[] /* kind file|task only */, edges: GraphEdge[], dirs: string[], unresolved: number, generatedAt: string, languages: string[], totalCodeFiles: number, included: number, truncated: boolean }`.

Every **drawable** node of `?level=container` and `?level=dir` (that is, every node that is not a ghost or a `fold:`) carries git history: a file node on `history`, an area node on `aggregates.history`. Areas that are not whole directories — a split residual ("src (other)") and the residual left by a `config.yaml` `areas:` pin — are rolled up over their own file set, summing per-file lines and counting each commit once across the set, so their `commits30` is comparable with a real directory's rather than absent. A node whose files have no git history at all is sent with the `null` counts described under `History`, never with zeros and never with the field missing.

`?level=container` → `ViewGraph`:
```ts
interface ViewGraph {
  level: 'container'|'dir'|'impact'|'workspace';
  root: string;                        // 'dir:./' for container; the dir id for dir; file id for impact
  nodes: GraphNode[];                  // ≤ 40 drawable nodes plus ghosts/folds
  edges: GraphEdge[];                  // aggregated; tests edges only when tests=1
  areas: AreaRef[];                    // Level-1 areas with hue assignment (always the full L1 set)
  cycles: string[][];                  // SCCs of size ≥ 2 among the returned nodes
  counts: { totalCodeFiles: number; shown: number; folded: number; hiddenTests: number; up?: number[]; down?: number[] };
  center?: string; centers?: string[]; // impact only
  generatedAt: string;
}
```
`?level=dir&root=<path>&tests=0|1&all=0|1` → `ViewGraph` with `nodes` = sub-areas + loose files (+ one `fold:` node unless `all=1`) + ghosts (`ghost:up:<dirId>` / `ghost:down:<dirId>` ids, `ghost: true`, `side`, `label` "src/types · 3 files used", `aggregates` of the ghost's underlying dir), `edges` = intra file edges + child→ghost aggregated edges. 404 when `root` is not a known dir.

## GET /api/impact?id=<file|file::symbol>&depth=1|2|3&direction=both|up|down&tests=0|1
`ViewGraph` with `level: 'impact'`, `center`, nodes carrying `side`, `hop` (0 for the centre), `fold:` nodes with `foldCount`/`foldIds` when a hop exceeds 40 per side, `counts.up`/`counts.down` = nodes per hop, edges with `names`. Symbol ids ⧗ (Core returns the file's impact when a `::name` id is given).

`?slug=<a>&slug=<b>` (task blast radius) → same shape with `centers` (planned ∪ actual files), each centre node carrying `planned: boolean, actual: boolean, task: string`; nodes reached from more than one task carry `collision: string[]`. `planned` and `actual` always describe the single slug in `task` (the first requested slug that owns the file) — never the union of the requested slugs, so the flags on a colliding file match what `?slug=<task>` alone returns; `collision` is the field that names the other tasks.

## GET /api/story?scope=repo|area|file|task|workspace&id=<path|slug>&lens=<Lens>&days=14|60
```ts
interface Story {
  scope: string; id: string; title: string; subtitle: string|null;
  crumbs: { label: string; route: string }[];
  sections: StorySection[];
  next: { label: string; route: string }[];
}
interface StorySection { id: string; heading: string; paragraphs: Paragraph[]; empty?: { text: string; action?: { label: string; route?: string; command?: string; form?: 'capture'|'note'|'journal' } } }
interface Paragraph {
  id: string; kind: 'fact'|'note'|'journal'|'gap'|'commit'|'decision'|'list';
  text: string;                       // plain text with [[route|label]] inline links; kind list: items separated by \n
  refs: string[];                     // graph node ids to highlight
  chips?: { label: string; value: string; tone?: 'ok'|'warn'|'bad'|'info'|'muted'; tip?: string }[];
  source?: { entity?: string; file?: string; date?: string; author?: string; confidence?: string; type?: NoteType; stale?: boolean; codeChanged?: string; person?: string; tool?: string; stage?: string; slug?: string; sha?: string };
  decision?: { slug: string; canDecide: boolean; deciders: string[] };
}
```
Section ids by scope — repo: `needs-you, what, made-of, starts, talks, flight, recent, gaps, run`; area: `read-first, inside, uses, used-by, tests, people, tasks, recent`; file: `read-first, exports, used-by, uses, tests, tasks, history, add-note`; task: `state, owner, problem, approach, files, criteria, verification, assumptions, scope, bail, risk, packet, journal`; workspace: `needs-you, repos, connect`. `lens=knowledge` adds `gaps` to area and file scopes.

## GET /api/explain?id=<nodeId>
```ts
{ id: string; title: string; kind: NodeKind; crumbs: {label: string; route: string}[]; route: string;
  sentences: { text: string; refs: string[] }[];   // exactly four
  actions: { label: string; route: string }[] }     // Go deeper, Show what breaks, Add a note
```

## GET /api/file?path=<file>
```ts
{ path: string; text: string; truncated: boolean; totalChars: number; totalLines: number; lang: string; role: Role; area: string|null;
  symbols: Symbol[]; notes: NoteFile[] /* chain, entries carry stale?: boolean, codeChanged?: string */;
  importers: { id: string; area: string; names: string[]; role: Role }[]; imports: { id: string; area: string|null; names: string[]; external?: string }[];
  testedBy: string[]; tasks: { slug: string; state: TaskState }[]; history: History & { recent: CommitInfo[] } | null; editorUrl: string }
interface Symbol { name: string; kind: 'function'|'class'|'const'|'let'|'var'|'type'|'interface'|'enum'|'struct'|'trait'|'mod'|'static'|'reexport'|'default'; line: number; endLine: number; exported: boolean; tauriCommand?: boolean; usedBy: { file: string; line?: number }[]; confidence: Confidence }
```
400 for `..`/absolute paths; 404 when missing.

## GET /api/symbols?path=<file>
`{ path: string; symbols: Symbol[]; engine: 'regex'|'typescript'|'tree-sitter' }`.

## GET /api/tasks?all=0|1
`TaskInfo[]` as today plus per task `stateDefinition: string`, `age: number|null` (days), `planFiles: string[]`, `changedFiles: string[]`. Intake items are already included as `state: 'ungroomed'` with `intake` set.

## GET /api/task/<slug>
```ts
{ task: TaskInfo & { stateDefinition: string; age: number|null };
  plan: { meta: PlanMeta; sections: Record<string, string>; criteria: string[]; files: { path: string; op: 'NEW'|'MOD'|'DEL'|null; exists: boolean; nodeId: string }[] } | null;
  packet: { verdict: 'pending'|'approved'|'needs-work'|null; decidedBy: string|null; decidedAt: string|null; criteria: { text: string; pass: boolean|null; evidence: string[] }[]; sections: Record<string, string>; evidence: string[] } | null;
  claim: ClaimInfo | null; journal: JournalEntry[];
  impact: { planned: string[]; actual: string[]; plannedButUntouched: string[]; touchedButUnplanned: string[]; downstream: { id: string; hop: number }[]; collisions: { file: string; slug: string; owner: string|null }[]; riskRules: { level: 'high'|'medium'; pattern: string; file: string }[] };
  contextRoute: string /* /api/context?slug=… */ }
```
404 for unknown slug; 400 for unsafe slug.

## GET /api/state-machine
`{ states: { id: TaskState; label: string; definition: string; rule: string }[]; transitions: { from: TaskState; to: TaskState; trigger: string; who: string }[]; counts: Record<TaskState, number>; mode: 'solo'|'team' }`.

## GET /api/evidence?slug=<slug>&file=<name>
Streams `.reggie/tasks/<slug>/evidence/<name>` with a content type by extension (text/*, image/*, application/json); 404 otherwise; refuses `/` and `..` in `file`.

## GET /api/history?path=<file|dir>&days=30|90|365
`{ path: string; history: History; recent: CommitInfo[] /* last 8 */; commitsPerDay: { date: string; count: number }[] }`; `path` omitted = whole repo. `commitsPerDay` is dense — one entry per day — so `days` is bounded (see below).

## GET /api/notes
`{ notes: NoteFile[] /* entries carry stale?: boolean, codeChanged?: string */; stale: string[] /* "entity|date|type" keys, kept for compatibility */; citedBy: Record<string, string[]> /* entity → note entities whose sources cite it */ }`.

## GET /api/note?path=<entity>
`{ chain: NoteFile[] }` with per-entry `stale` and `codeChanged` (batched from history.ts).

## GET /api/journal?days=<n>&slug=&person=&path=
`JournalEntry[]` plus per entry `taskExists: boolean`, `nodeIds: string[]` (resolved from evidence paths and the slug's plan files). `path` filters to entries whose `nodeIds` fall under the prefix.

## GET /api/people
`{ people: { handle: string; name: string; email: string; role: 'maintainer'|'contributor'; fromGit: boolean; commits365: number; areas: { id: string; share: number }[]; activeClaims: { slug: string; since: string }[]; lastJournal: JournalEntry|null; busFactorAreas: string[] }[]; mode: 'solo'|'team'; current: string /* handle */ }`.

## GET /api/search?q=<text>&limit=20
`{ results: { kind: 'area'|'file'|'symbol'|'task'|'person'|'note'|'journal'; id: string; label: string; route: string; snippet: string; score: number }[] }`. Ranking: exact basename 100, path substring 60, symbol name 55, task title/slug 50, person 45, note text 30, journal text 20; ties by fan-in.

## GET /api/workspace
```ts
{ name: string; root: string; single: boolean;
  repos: { name: string; path: string; description: string; primaryLanguage: string; codeFiles: number; branch: string;
           taskCounts: Record<TaskState, number>; knowledge: { source: number; noted: number; inherited: number; stale: number };
           lastJournal: JournalEntry|null; entryPoints: string[]; needsYou: { slug: string; title: string; owner: string|null; age: number|null }[] }[];
  edges: { source: string; target: string; kind: 'depends-on'|'same-org'|'shares-service'; via: string }[] }
```
In single-repo mode returns `single: true` with one repo and no edges.

## GET /api/context?slug=&path=
Unchanged (`{ text }`).

## GET /api/treemap?root=<path> ⧗
`{ name, path, kind, value /* lines */, files, source, tests, documented, stale, commits30, lastTouched, owner: {handle, share}|null, busFactor, tasks: string[], children: [...] }` d3-hierarchy ready.

## GET /api/timeline?from=<YYYY-MM-DD>&to=<YYYY-MM-DD> ⧗
`{ events: { at: string; kind: 'journal'|'commit'|'branch'|'pr'|'note'|'state'; person: string; slug: string|null; nodeIds: string[]; text: string; taskExists?: boolean }[] }`.

## GET /api/export?view=container|area|impact&id=&format=mermaid|svg ⧗

## Static
`GET /` → `ui/index.html`. `GET /ui/<file>` → `packages/reggie/ui/<file>` (html, js, css, svg; `..` refused). `GET /vendor/<file>` → whitelisted `node_modules` files (`cytoscape.min.js`, `dagre.min.js`, `cytoscape-dagre.js`, `d3.min.js`), `cache-control: public, max-age=31536000, immutable`; 404 when the module is not installed.

## Numeric query parameters
Every numeric parameter is validated, not clamped: a value that is not a plain base-10 integer inside its range is refused with 400 `{error:"<name> must be an integer between <min> and <max>"}`. Missing or empty falls back to the default. The ranges are `days` 1–730 on `/api/history`, `/api/story` and `/api/explain`; `days` 1–36500 on `/api/journal` (it filters a file rather than sizing an array); `depth` 1–3 on `/api/impact`; `limit` 1–100 on `/api/search`. `/api/context`'s `maxLines` is fixed at 400 by the server and is not a query parameter. The bound matters because `commitsPerDay` allocates one object per day in the window, so an unbounded `days` let a single request size the response.

Every request, GET and POST alike, must carry a `Host` header naming a loopback host (`localhost`, `*.localhost`) or a bare IP literal; any other DNS name is 403 `{error:"host header does not name this server"}`. That is the DNS-rebinding guard: a rebound page reaches the server over a real loopback socket and controls both its own `Host` and `Origin`, so `Origin` is checked against the server's own loopback origin and never against `Host`.

## POST endpoints (JSON bodies ≤ 64 KB; loopback socket only; `Sec-Fetch-Site` must be `same-origin` or `none`; `Origin`, when present, must equal the server origin; otherwise 403)
- `POST /api/capture` `{ text: string; detail?: string; slug?: string }` → `{ slug: string; line: string }` (calls `capture()` with `currentPerson`, source `web`).
- `POST /api/note` `{ entity: string; type: NoteType; text: string; confidence?: 'high'|'medium'|'low'; sources?: string[] }` → `{ entity: string; kind: string; created: boolean; entry: NoteEntry }` (calls `addNote`, author `"<handle> (web)"`).
- `POST /api/decide` `{ slug: string; verdict: 'approved'|'needs-work'; comment?: string }` → `{ slug: string; verdict: string; file: string; materializedFrom?: string }` (resolves the packet the way `/api/task` does — working tree, then `task/<slug>`, then the integration branch — copying it into the working tree first and reporting the ref it came from in `materializedFrom`; then calls `decidePacket` as `currentPerson`; 409 only when no packet exists anywhere; in team mode 403 unless the current person is a maintainer).
- `POST /api/journal` `{ text: string; slug?: string; stage?: string; evidence?: string[] }` → `JournalEntry` (tool `human`).