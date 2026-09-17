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
type TaskState = 'ungroomed'|'groomed'|'planned'|'in-process'|'awaiting-decision'|'done';
type TaskPhase = 'capture'|'shape'|'plan'|'build'|'review'|'done';   // the coarser grouping the tasks page columns by
type LaunchTool = 'claude'|'codex';
type LaunchMode = 'chat'|'triage'|'plan'|'implement';

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
No params (compatibility): `{ nodes: GraphNode[] /* kind file|task only */, edges: GraphEdge[], dirs: string[], unresolved: number, generatedAt: string, languages: string[], totalCodeFiles: number, included: number, truncated: boolean }`. This route's `unresolved` and `languages` are the compatibility shape and the UI does not read them — the client only ever fetches the levelled routes below, and `counts` is where it reads coverage from. `languages` here includes the synthetic `task` language and is not a list of languages the graph read; `skipped` is deliberately absent, because the counts block is its published home.

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
  counts: { totalCodeFiles: number;                          // repo-wide: code files the graph opened and read
            shown: number; folded: number; hiddenTests: number;
            skipped: { language: string; files: number }[];  // repo-wide: code files the graph never read, largest first
            unresolved: number;                              // repo-wide: distinct (file, RELATIVE specifier) pairs that resolved to nothing
            up?: number[]; down?: number[] };
  center?: string; centers?: string[]; // impact only
  generatedAt: string;
}
```
`counts.skipped` and `counts.unresolved` describe the repo, not the view. They are lifted unchanged from one `RepoGraph` at all three levels (container, dir, impact), so within a payload the three cannot disagree and neither can the story built from the same graph — but a client must not read them as being about the scope on screen, and two *separate* requests can still skew, because the story and the level payloads are cached independently and neither carries the commit they were built from.

`skipped` is the array rather than a total — the sum is the number of code files the graph never read, and the entries name the languages, largest first (ties by language name). A file counts as skipped code when it is in a language a person authors as part of how the product behaves or looks (programming languages, shell, SQL, HTML, CSS, SCSS) and the graph's own extension table does not read it; Markdown, JSON, YAML and TOML are never counted.

`totalCodeFiles` is the number of code files the graph **opened and read**, not the number whose extension it recognises: a file listed by git but missing from the worktree is in neither `totalCodeFiles` nor `skipped`, so `totalCodeFiles` plus the sum of `skipped` is the repo's code-file total less any file that could not be opened. It is also the `M` the dir footer's "Showing N of M files" compares against, which is a count of read files and not of everything under the folder — the name predates this and is misleading.

`unresolved` counts distinct (importing file, **relative** specifier) pairs: one bad path written twice in one file is one and the same bad path imported from two files is two. Only specifiers starting with `.` are counted. An unresolvable `@/` or `~/` alias, and any bare package specifier, is dropped with no edge and no count, so a zero here means "no path-style import failed" and not "every import was followed".

`?level=dir&root=<path>&tests=0|1&all=0|1` → `ViewGraph` with `nodes` = sub-areas + loose files (+ one `fold:` node unless `all=1`) + ghosts (`ghost:up:<dirId>` / `ghost:down:<dirId>` ids, `ghost: true`, `side`, `label` "src/types · 3 files used", `aggregates` of the ghost's underlying dir), `edges` = intra file edges + child→ghost aggregated edges. 404 when `root` is not a known dir.

## GET /api/impact?id=<file|file::symbol>&depth=1|2|3&direction=both|up|down&tests=0|1
`ViewGraph` with `level: 'impact'`, `center`, nodes carrying `side`, `hop` (0 for the centre), `fold:` nodes with `foldCount`/`foldIds` when a hop exceeds 40 per side, `counts.up`/`counts.down` = nodes per hop, edges with `names`. Symbol ids ⧗ (Core returns the file's impact when a `::name` id is given).

`?slug=<a>&slug=<b>` (task blast radius) → same shape with `centers` (planned ∪ actual files), each centre node carrying `planned: boolean, actual: boolean, task: string`; nodes reached from more than one task carry `collision: string[]`. `planned` and `actual` always describe the single slug in `task` (the first requested slug that owns the file) — never the union of the requested slugs, so the flags on a colliding file match what `?slug=<task>` alone returns; `collision` is the field that names the other tasks.

## GET /api/story?scope=repo|area|file|task|workspace|services|flow&id=<path|slug|flowId>&lens=<Lens>&days=14|60
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
Section ids by scope — repo: `needs-you, what, made-of, starts, talks, flight, recent, gaps, run, add-note`; area: `read-first, inside, uses, used-by, tests, people, tasks, recent, add-note`; file: `read-first, exports, used-by, uses, tests, tasks, history, add-note`; task with a plan: `state, owner, problem, approach, files, criteria, verification, assumptions, scope, bail, risk, packet, journal`; task with a brief and no plan: `state, ask, why-now, area, questions, not-this, next, journal`; task with only an intake line: `state, written, lives, known, resembles, unclear, next, journal`; workspace: `needs-you, repos, connect`; services: `needs-attention, talks-to, secrets, not-wired`; flow: `steps, not-derivable`. `lens=knowledge` adds `gaps` to area and file scopes.

`scope=services` narrates the Services page and takes no `id`. `scope=flow` needs `id` (a flow id or an entry node id) and accepts the same `depth` as `/api/flow`; 400 without an id, 404 when no entry point has it. In the `flow` scope every paragraph's `refs` are its own step's node ids, so reading the story walks the map. The repo scope's `talks` section links both pages when they have anything on them.

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

## GET /api/changes?slug=<slug>
What a task changed, as a list. One range of two full commit ids stands for the change: a task that is not done and whose branch is ahead of the integration branch is read from the merge base to the branch tip (what a merge would land, and still right when the branch merged the base back in); otherwise the merge that landed it, against that merge's first parent (`taskLanding`); otherwise a branch that still resolves, from its merge base.
```ts
interface TaskChanges {
  slug: string;
  available: boolean;            // false: there is no range to read, or git could not read it
  reason: string | null;         // when !available: a sentence of Reggie's own, never git's output
  range: ChangeRange | null;
  files: ChangedFile[];          // everything outside .reggie/, in path order
  records: ChangedFile[];        // Reggie's own records under .reggie/: listed and readable, never counted
  totals: { files: number; added: number; deleted: number };   // `files` only
}
interface ChangeRange {
  kind: 'branch' | 'merge';      // branch: merge base → tip. merge: the landing merge's first parent → the merge
  base: string; ref: string;     // full 40-hex commit ids
  baseName: string;              // the integration branch
  refName: string;               // 'task/<slug>', 'origin/task/<slug>', or the merge's subject
  commits: number;               // ahead of the base (branch), or brought in by the merge (merge)
}
interface ChangedFile {
  path: string;                  // byte for byte as committed; the new path of a rename
  status: 'added'|'deleted'|'modified'|'renamed'|'copied'|'typechange';
  from?: string; similarity?: number;   // a rename or copy: the old path, and 0–100
  oldMode: string | null;        // null for an added file
  newMode: string | null;        // null for a deleted file; '120000' is a symlink
  binary: boolean;               // counts are 0 and 0 when true
  added: number; deleted: number;
}
```
The list is read from `git diff --raw -z` and `--numstat -z`, never from a text form, so a name holding a space, a quote, a tab, non-ASCII letters, a leading dash, ` => ` or pathspec magic arrives exactly as committed and a file named `a => b` is never taken for a rename. A rename is one entry, under its new path. For a done task with a landing merge, `totals` equals `completion.diff.filesChanged`, `added` and `deleted` from `/api/task/<slug>`.

Always 200 for a known task: a branch with no commits past the base, and one whose commits cancel out, answer `available: true` with empty lists (`range.commits` tells the two apart); a task with no task branch and no landing, a done task that landed without a merge commit (whether its branch is gone or was kept and now holds nothing past the base), a branch that shares no history with the base, and a git read that failed or timed out (10 s) answer `available: false` with the `reason`. A failed read is never flattened to an empty list. 400 `{error:"bad slug"}` for an unsafe slug; 404 for a slug nothing in the repo names. Nothing in the request ever becomes a git revision: only commit ids Reggie resolved from the safe slug reach git, after `--end-of-options`, with colour, external diff programs, textconv filters, the rename setting, the algorithm and quoting all pinned so a user's own git config changes nothing. Names are resolved by their full ref (`refs/heads/task/<slug>`, `refs/remotes/origin/task/<slug>`, `refs/heads/<base>`), so a tag that carries a branch's name cannot stand in for it. The integration branch's name comes from `.reggie/config.yaml`, a tracked file, and is treated as hostile: only the commit id it resolves to is handed on, to the landing lookup too, and a name that begins with a dash answers 200 `available: false` (404 on `/api/filediff`) for any safe slug before the task list is consulted or git is run.

## GET /api/filediff?slug=<slug>&path=<file>&offset=<n>
One file of that change, as the rows the reader draws. `path` must name a member of the task's change list (`files` or `records`). It is compared with the listed names exactly as it was sent, which is what finds a committed name that begins or ends with a space, and then as tidied (surrounding whitespace trimmed, one leading `./` dropped); nothing else is forgiven, so case, a trailing slash, a glob and pathspec magic all name nothing.
```ts
type FileDiff = ChangedFile & {
  slug: string; range: ChangeRange;
  card: { kind: 'binary'|'mode'|'renamed'|'empty'|'symlink'|'deleted'|'unreadable'; text: string; oldSize?: number|null; newSize?: number|null } | null;
  rows: DiffRow[];               // at most 2,000, starting at `offset`
  offset: number; totalRows: number; truncated: boolean;   // truncated: rows remain past the ones returned
  changedSince: boolean | null;  // merge ranges only: the file at HEAD is no longer the one that landed
  mapped: boolean;               // false exactly when /api/story?scope=file, /api/impact and /api/explain answer this path 404
  editorUrl: string | null;
};
type DiffRow =
  | { kind: 'ctx'; old: number; new: number; text: string; noeol?: true; cut?: true }
  | { kind: 'add'; new: number; text: string; noeol?: true; cut?: true }
  | { kind: 'del'; old: number; text: string; noeol?: true; cut?: true }
  | { kind: 'gap'; count: number; new: number };   // unchanged lines not shown: how many, and the new-side number of the first
```
Rows are built on the server from a one-file patch whose hunks are read by the counts in their `@@` headers, so a deleted line reading `-- a/old.ts` is one `del` row and an added line reading `@@ -9,9 +9,9 @@` is one `add` row. `old` and `new` are real line numbers on each side. Three lines of context surround each change; every other unchanged stretch, before, between and after the hunks, is one `gap` row, so a change at line 1,500 is as reachable as one at line 5. `\ No newline at end of file` is never a row: the row before it carries `noeol: true`. A trailing carriage return is dropped from `text`. A row's `text` is cut at 2,000 characters with `cut: true`.

`card` says what rows cannot: `binary` (both byte sizes; `null` on a side that does not exist) and no rows; `mode` for a mode change; `renamed` for a rename or copy, with no rows when nothing inside changed; `empty` for an empty file that was added; `symlink` above the one row holding its target; `deleted` above the removed lines; `unreadable`, with no rows rather than wrong or unaffordable ones, when the change would draw more than 100,000 rows, context and gap rows included (checked on git's own added-plus-deleted count before the patch is asked for, again as hunk lines are parsed, so parsing stops, and again on the built rows), when git failed or timed out or the patch is larger than the 16 MB that is read, when a hunk did not add up to its own header, or when the rows disagree with the counts `--numstat` gave. A rename is asked of git by both its paths, so an edited rename answers its edited lines and not the whole file as added.

Paging: `offset` is the index of the first row wanted, `gap` rows included; the page size is fixed at 2,000. `offset` equal to or past `totalRows` answers no rows. A file's rows are built once and kept in a small bounded cache keyed by slug, the two commit ids and the path (at most 8 files, 200,000 rows and 32 MB of row text, least recently read out first), so a later page is a slice and not a second patch read; a read that failed is never kept. Every page carries `range`: a client that pages must compare it with the first page's and start again when the branch has moved, never append. `editorUrl` follows the text on screen: the copy under `.worktree/<slug>/` while the branch is live, this checkout's copy when it has `task/<slug>` checked out or the range is a merge and the file still exists, and `null` otherwise.

400 `{error:"bad slug"}`; 400 `{error:"bad path"}` for an empty path, a NUL, a backslash, an absolute path or a `..` segment; 400 for an `offset` that is not an integer in 0–99999999; 404 for an unknown task; 404 carrying the `reason` when the task has no readable change; 404 `{error:"that path is not part of what <slug> changed"}` for a well-formed path that is not in the list, which is also what `--output=/tmp/x` and `:(exclude)src` get, since a path that is not a member never reaches git. Neither route puts git's stderr or an absolute path into an error body or an `available: false` answer. A 200 from `/api/filediff` does carry one, in `editorUrl`, exactly as `/api/file` does: that is the link's purpose, and it is `null` whenever there is no honest file to open.

## GET /api/symbols?path=<file>
`{ path: string; symbols: Symbol[]; engine: 'regex'|'typescript'|'tree-sitter' }`.

## GET /api/tasks?all=0|1
`TaskInfo[]` as today plus per task `stateDefinition: string`, `age: number|null` (days), `planFiles: string[]`, `changedFiles: string[]`, `branchRef: string|null` (the ref the task branch is read from: `task/<slug>` when it is local, `origin/task/<slug>` when only the remote-tracking ref exists, `null` with no task branch; never a `plan/` branch, which `branch` may name), and the two fields the tasks page columns by:
```ts
brief: { exists: boolean; area: string; size: 'small'|'medium'|'large'|'unset'; priority: 'P1'|'P2'|'P3'|'unset'; problem: string } | null;
phase: TaskPhase;   // ungroomed→capture, groomed→shape, planned→plan, in-process→build, awaiting-decision→review, done→done
```
`brief` is `null` until triage writes `.reggie/tasks/<slug>/brief.md`; `problem` is `""` while the scaffold's placeholder is still in it. A brief that is still that scaffold — any section holding its parenthesised hint, or a missing or empty `## Problem` — keeps `state: 'ungroomed'`, with `reason` naming the draft; a brief someone has written into but left on `size: unset` is `groomed`. `age` falls back to the brief's `created` when there is no branch activity and no intake line. Intake items are included as `state: 'ungroomed'` with `intake` set, and a triaged task is `state: 'ungroomed'` with `intake: null` and `brief.exists: true`.

## GET /api/task/<slug>
```ts
{ task: TaskInfo & { stateDefinition: string; age: number|null; brief: …|null; phase: TaskPhase };
  brief: { meta: BriefMeta; sections: Record<string, string>; areas: string[]; questions: string[] } | null;
  plan: { meta: PlanMeta; sections: Record<string, string>; criteria: string[]; files: { path: string; op: 'NEW'|'MOD'|'DEL'|null; exists: boolean; nodeId: string }[] } | null;
  packet: { verdict: 'pending'|'approved'|'needs-work'|null; decidedBy: string|null; decidedAt: string|null; criteria: { text: string; pass: boolean|null; evidence: string[] }[]; sections: Record<string, string>; evidence: string[] } | null;
  completion: Completion | null;
  claim: ClaimInfo | null; journal: JournalEntry[];
  impact: { planned: string[]; actual: string[]; plannedButUntouched: string[]; touchedButUnplanned: string[]; downstream: { id: string; hop: number }[]; collisions: { file: string; slug: string; owner: string|null }[]; riskRules: { level: 'high'|'medium'; pattern: string; file: string }[] };
  contextRoute: string /* /api/context?slug=… */ }

// The Completed view's "how do I know it was done". Non-null only when task.state is 'done'.
interface Completion {
  verdict: string|null; decidedBy: string|null; decidedAt: string|null;   // from the packet front matter
  criteria: { text: string; pass: boolean|null; evidence: { path: string; route: string|null; exists: boolean }[] }[];
  diff: { files: { path: string; added: number; deleted: number }[]; filesChanged: number; added: number; deleted: number; commits: number };
  merge: CommitInfo | null;   // the merge that landed the task, when one did; the page opens each changed file's diff only when it is set
  commits: CommitInfo[];      // the slug's commits: the `Task:` trailer in the history index, else `<base>..task/<slug>`
  journal: JournalEntry[];    // every entry ever written for the slug (same list as `journal` above)
}
```
`brief` parses the brief the same way `plan` parses the plan, so the page renders sections rather than raw markdown. In a `Completion`, `evidence[].route` is the `/api/evidence` URL for a reference that names a file under `.reggie/tasks/<slug>/evidence/` and `null` otherwise; `exists` says whether that file is really there (working tree or task branch), so a criterion claiming proof that was never saved is visible as such. `diff` sums the numstat of the task's own commits and leaves `.reggie/` records out, the way `changedFiles` does.

404 for unknown slug; 400 for unsafe slug.

## GET /api/state-machine
`{ states: { id: TaskState; label: string; definition: string; rule: string }[]; transitions: { from: TaskState; to: TaskState; trigger: string; who: string }[]; counts: Record<TaskState, number>; mode: 'solo'|'team' }`. Six states in lifecycle order (`ungroomed, groomed, planned, in-process, awaiting-decision, done`), including the two shaping transitions: somebody fills the brief in (`ungroomed → groomed`; triage only scaffolds it) and a passing plan lands (`groomed → planned`).

## GET /api/launch?slug=&tool=&mode=&note=
`{ command: string; cwd: string; description: string; goal: 'shape'|'plan'|'discuss'|'build' }` — the exact command a session would run, built but **not** started, so the page can put it in a tooltip or a copy field. `slug` is repeatable; `tool` and `mode` are required and have no defaults. `mode` is `discuss` or `build`; `goal` is derived on the server from each task's state (ungroomed → shape, groomed → plan, anything else → discuss; build needs `planned` or `in-process`), so a button never chooses a prompt. `note` (≤ 4000 chars) is the user's own words, appended verbatim to the prompt. 400 `{error}` for an unknown tool or mode, no slug, an unsafe slug, a note too long, several slugs unless every one is ungroomed (only shaping takes several), or a build on a task with no plan; 404 for a slug no task carries. No Reggie slash command is ever emitted: the prompt is the whole instruction for both tools, and discussion goals open Claude Code with `--permission-mode plan` and Codex with `-s read-only`.

## GET /api/narration?scope=&id=&lens=&days=
The story at `scope`/`id` (same parameters and errors as `/api/story`), spoken: `{ title; script; sections: { id; heading; text }[]; words; seconds; scope; id; episode: { route; bytes; seconds; madeAt; voice } | null }`. Links flatten to their labels, lists read as a sequence, notes and journal entries say who wrote them, empty sections say why they are empty, paths are said as paths. `episode` names the audio already made for it, when there is one.

## GET /api/episode?scope=&id=
The audio for an episode made by `POST /api/episode`: `audio/mp4`, with byte ranges (`206`, `Accept-Ranges: bytes`). 404 until one is made.

## GET /api/feed.xml
A private RSS feed of every episode on disk for this repo, newest first, with `audio/mp4` enclosures pointing at `/api/episode`. Loopback only, like everything else here; a podcast app on this machine can subscribe to it.

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

A `JournalEntry` may carry one optional field, here and on `GET /api/task/<slug>`: `derived?: { session: string|null; through: string|null; commits: string[]; prose: 'template'|'model' }`. It is present only on an entry `reggie journal derive` wrote, and absent (not null) on every hand entry. `session` is the Claude session id whose closing words the entry quotes, null for an entry drawn from commits alone; `through` is the ISO instant of the newest transcript record the entry covers; `commits` are twelve-character commit ids, which appear nowhere else in the entry; `prose` says whether Reggie's template or the opt-in model rewrite wrote the text. The field is read from the entry's last line in the day file (`derived: session=… through=… commits=… prose=…`), and that line is never part of `text`. A derived entry's `text` is always one line, and its `evidence` holds only repo-relative paths under `.reggie/tasks/<slug>/`. `ClaimInfo` likewise carries `handle: string`, the people-file handle the claim was made under, `""` in a claim written before the field existed.

## GET /api/people
`{ people: { handle: string; name: string; email: string; role: 'maintainer'|'contributor'; fromGit: boolean; commits365: number; areas: { id: string; share: number }[]; activeClaims: { slug: string; since: string }[]; lastJournal: JournalEntry|null; busFactorAreas: string[] }[]; mode: 'solo'|'team'; current: string /* handle */ }`.

## GET /api/search?q=<text>&limit=20
`{ results: { kind: 'area'|'file'|'symbol'|'task'|'person'|'note'|'journal'; id: string; label: string; route: string; snippet: string; score: number }[] }`. Ranking: exact basename 100, path substring 60, symbol name 55, task title/slug 50, person 45, note text 30, journal text 20; ties by fan-in.

## GET /api/services
Everything the repo talks to (`services-and-flows-spec.md` §1). Cached per HEAD sha.

```ts
type ServiceKind = 'database'|'table'|'kv'|'bucket'|'queue'|'durable-object'|'assets'|'api'|'var'|'secret'|'vectorize'|'ai'|'hyperdrive'|'analytics';
type ServiceOp = 'read'|'write'|'touch';
interface SourceRef { file: string; line: number }

interface ServiceNode {
  id: string;                  // 'svc:kv:CACHE', 'svc:api:api.openai.com', 'svc:table:chat_logs'
  kind: ServiceKind;
  binding: string|null;        // CACHE
  name: string;                // human name: jacob-chat-logs, api.openai.com
  provider: string|null;       // cloudflare | openai | firebase | aws | null
  declared: boolean;           // false = used in code, declared nowhere
  declaredAt: SourceRef|null;  // where declared — or, when declared is false, where merely *documented* (.env.example)
  parent: string|null;         // a table's database
  notes: number;               // entity-note entries about it
  uses: number;                // call sites outside tests
  resourceId: string|null;     // database_id / KV namespace id, when a manifest gives one
  // added by this route, not by the detector:
  files: string[];             // every file that touches it (tests included)
  readers: string[]; writers: string[];   // the same files split by operation
}
interface ServiceEdge {
  file: string; service: string; op: ServiceOp;
  confidence: Confidence;      // heuristic = resolved through a name (an alias, or a binding passed as a parameter)
  viaTest: boolean;
  sources: SourceRef[];        // every call site, capped at 20
  count: number;               // call sites before the cap
}
{ services: ServiceNode[]; edges: ServiceEdge[]; undeclared: ServiceNode[]; unused: ServiceNode[]; generatedAt: string }
```
`undeclared` (used in code, declared by no manifest) is the headline; `unused` is its mirror. Both carry the same decorated nodes as `services`.

## GET /api/service?id=<serviceId>
One service with everything that touches it. 400 when `id` is missing or malformed, 404 when no service has that id.
```ts
{ service: ServiceNode;                       // decorated, as above
  callSites: ServiceEdge[];                   // every edge into this service, tests included
  notes: NoteFile[];                          // entity notes about it, entries carrying stale?/codeChanged?
  tasks: { slug: string; state: TaskState; title: string }[];   // tasks whose plans touch its files
  flows: FlowSummary[];                       // flows that reach it
  children: ServiceNode[];                    // a database's tables
  parent: ServiceNode|null;
  editorUrl: string|null }                    // opens the declaring manifest
```

## GET /api/flows
One summary per entry point (`services-and-flows-spec.md` §2). Cached per HEAD sha; every entry is traced once at the default depth.
```ts
type FlowEntryKind = 'cloudflare'|'http-route'|'next-route'|'next-page'|'cli'|'mcp'|'main';
interface FlowDrop { hop: number; count: number; reason: 'hop-budget'|'step-cap'|'depth' }
interface FlowSummary {
  id: string;                  // url-safe, also the id of the traced flow
  entry: string;               // node id of the handler symbol: 'sym:<file>#<name>'
  title: string;               // 'POST /api/chat'
  kind: FlowEntryKind; method: string|null; route: string|null;
  steps: number; services: string[]; depth: number;
  truncated: boolean; dropped: FlowDrop[];    // dropped is empty exactly when truncated is false
  source: SourceRef }
{ flows: FlowSummary[]; generatedAt: string }
```

## GET /api/flow?id=<flowId|entryNodeId>&depth=1..6
One traced flow. `depth` is validated like every numeric parameter (400 outside 1–99) and then clamped to 6 hops, which is as far as the tracer ever walks. 404 when no entry point has that id.
```ts
interface Payload { fields: string[]; shape: string|null; confidence: Confidence; source: SourceRef|null }
interface FlowStep {
  from: string; to: string;    // node ids: a file, 'sym:<file>#<name>', a service id, or 'resp:<flowId>'
  kind: 'call'|'import'|'read'|'write'|'respond';
  label: string;               // the function or the operation ('CHAT_LOGS.prepare')
  input: Payload|null; output: Payload|null;   // null = not derivable; never a guess
  source: SourceRef;
  confidence: Confidence;      // heuristic = the service was resolved through a name, not a declaration
  via: string|null }           // the local parameter name a binding arrived under ('db'), else null
{ id: string; entry: string; title: string; method: string|null; route: string|null;
  steps: FlowStep[]; services: string[]; depth: number; truncated: boolean; dropped: FlowDrop[] }
```
A `Payload` with `confidence: 'heuristic'` carries field names read from the callee's signature, not from the data — the UI must say so rather than presenting them as the payload.

Caps: 200 steps in total, 6 hops, and a per-hop budget of `floor(199 / hops)` steps (33 at the default depth) so a wide entry point cannot spend the budget the deeper hops need. `dropped` says which hop lost how many steps and why.

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

## Reaching the server from a phone (the serve key)
`reggie serve --host 0.0.0.0` (any non-loopback bind) reads or mints a key at `.reggie/.cache/serve-key` and prints each network address with `?key=<key>` appended. Every `/api` request that arrives over a **non-loopback socket** must present that key, as the `X-Reggie-Key` header or a `key` query parameter; without it the answer is 401 `{error:"key required…"}`, and when the server was not started for the network at all it is 403. Loopback sockets never need the key, whatever the bind. The static shell (`/`, `/ui/*`, `/vendor/*`) is served without the key so the page can ask for it (a 401 on any API call shows a paste-the-key card). A keyed POST is not origin-checked beyond the `Sec-Fetch-Site` rule: the key is what a rebound or cross-site page cannot present, so the `Origin` a proxy or a network address gives the page is accepted; the loopback origin rule is unchanged for loopback sockets. Writes over the network are attributed to the person running `reggie serve` (the key names nobody), so in **team** mode every keyed POST is refused with 403 until the key can carry an identity. An explicit `--key` is ignored on a loopback bind: the key exists exactly when the server is reachable from the network. The Host header must still be a loopback name or a bare IP literal, so a LAN or tailnet address works and a DNS name does not. `/api/feed.xml` builds its enclosure URLs from the request's `Host`, appending the key when the request carried one, so a podcast app on the phone can play what it lists.

## Static
`GET /` → `ui/index.html`. `GET /ui/<file>` → `packages/reggie/ui/<file>` (html, js, css, svg; `..` refused). `GET /vendor/<file>` → whitelisted `node_modules` files (`cytoscape.min.js`, `dagre.min.js`, `cytoscape-dagre.js`, `d3.min.js`), `cache-control: public, max-age=31536000, immutable`; 404 when the module is not installed.

## Numeric query parameters
Every numeric parameter is validated, not clamped: a value that is not a plain base-10 integer inside its range is refused with 400 `{error:"<name> must be an integer between <min> and <max>"}`. Missing or empty falls back to the default. The ranges are `days` 1–730 on `/api/history`, `/api/story` and `/api/explain`; `days` 1–36500 on `/api/journal` (it filters a file rather than sizing an array); `depth` 1–3 on `/api/impact`; `depth` 1–99 on `/api/flow` and `/api/story?scope=flow`, then clamped to the tracer's 6 hops; `limit` 1–100 on `/api/search`; `offset` 0–99999999 on `/api/filediff`. `/api/context`'s `maxLines` is fixed at 400 by the server and is not a query parameter. The bound matters because `commitsPerDay` allocates one object per day in the window, so an unbounded `days` let a single request size the response.

Every request, GET and POST alike, must carry a `Host` header naming a loopback host (`localhost`, `*.localhost`) or a bare IP literal; any other DNS name is 403 `{error:"host header does not name this server"}`. That is the DNS-rebinding guard: a rebound page reaches the server over a real loopback socket and controls both its own `Host` and `Origin`, so `Origin` is checked against the server's own loopback origin and never against `Host`.

## POST endpoints (JSON bodies ≤ 64 KB; loopback socket only; `Sec-Fetch-Site` must be `same-origin` or `none`; `Origin`, when present, must equal the server origin; otherwise 403)
- `POST /api/capture` `{ text: string; detail?: string; slug?: string }` → `{ slug: string; line: string }` (calls `capture()` with `currentPerson`, source `web`).
- `POST /api/note` `{ entity: string; type: NoteType; text: string; confidence?: 'high'|'medium'|'low'; sources?: string[] }` → `{ entity: string; kind: string; created: boolean; entry: NoteEntry }` (calls `addNote`, author `"<handle> (web)"`).
- `POST /api/decide` `{ slug: string; verdict: 'approved'|'needs-work'; comment?: string }` → `{ slug: string; verdict: string; file: string; materializedFrom?: string }` (resolves the packet the way `/api/task` does — working tree, then `task/<slug>`, then the integration branch — copying it into the working tree first and reporting the ref it came from in `materializedFrom`; then calls `decidePacket` as `currentPerson`; 409 only when no packet exists anywhere; in team mode 403 unless the current person is a maintainer).
- `POST /api/triage` `{ slug: string }` or `{ slugs: string[] }` (both may be sent; the union is used, de-duplicated) → `{ created: string[]; skipped: { slug: string; reason: string }[] }`. Scaffolds `.reggie/tasks/<slug>/brief.md` from every intake line carrying the slug, as `currentPerson`, and removes those lines after the write succeeds; the reply's `takenFromIntake` names the slugs whose line was taken. The card **stays** `ungroomed` — the scaffold is not yet a shaped item — with a reason naming the draft, and moves to `groomed` when somebody writes into it. There is no `force` over HTTP: a slug whose brief already exists is skipped with `"a brief already exists"`, and a slug no task in this repo carries is skipped with `"nothing in this repo names that task"` — a button must not be able to erase thinking or invent a task. 400 when neither field is given, or any slug is unsafe.
- `POST /api/intake` `{ slug: string; text: string }` → `{ slug: string; added: string[]; createdLine: boolean }`. Adds the text as `> ` detail lines under the item's intake line (each line of `text` one detail line, the last stamped `(handle, web, date)`), so the board, the context pack and the shaping session all read the user's answer without learning a new shape. A slug with no intake line (a backlog item) gets one, titled from the task. 400 for a bad slug or empty text; 404 for an unknown task; **409** when the task has a brief, naming it — triage took that line, and writing here would rebuild it; the answer belongs in the brief. The task page offers the form only while there is no brief.
- `POST /api/launch` `{ slugs: string[]; tool: LaunchTool; mode: 'discuss'|'build'; note?: string }` (`slug` accepted as a singular alias) → `{ launched: boolean; command: string; cwd: string; goal: LaunchGoal; session: string|null; resume: string|null; reason?: string }`. The only route that starts a process. Validated exactly as `GET /api/launch`. Before spawning it writes the context pack for each task to `<cwd>/.reggie/.cache/context/<slug>.md` (the prompt says to read it first, so a read-only sandbox and a missing `reggie` binary do not matter), mints a session id for Claude Code (`--session-id`, echoed as `session`, with `resume` the command that reopens the chat), and for a build **claims the task first** (`claimTask` with a worktree, as `currentPerson`) so the session opens in `.worktree/<slug>` on `task/<slug>` with the claim already committed; 409 when someone else holds the branch. The claim also makes that worktree runnable: for each `install` entry in `.reggie/config.yaml` it links the serving checkout's `node_modules` when the lockfiles there are byte-identical, and **defers** any install rather than running it (this server answers one request at a time, and a cold install is minutes), naming the deferred command and directory in the session's prompt as its first step. A launch record lands at `.reggie/.cache/launches/<slug>.json`, which holds the latest launch only, and the same object is appended as one line to `.reggie/.cache/launches/<slug>.log`, which keeps every launch for the slug, oldest first; `reggie journal derive` reads the log to find a task's sessions. Both are uncommitted cache, neither names a person, and a Codex launch has no session id in either. The command is built as an argument vector by `src/launch.ts` and is never interpolated into a shell. `launched:false` is a normal answer, not an error — outside macOS nothing can be spawned, so `reason` says why and the page falls back to showing `command` to copy.
- `POST /api/episode` `{ scope: string; id: string; voice?: string }` → `{ route; bytes; seconds; madeAt; voice; title; words }`. Renders the narration of that story to `.reggie/.cache/episodes/<scope>--<id>.m4a` with macOS `say` and `afconvert` (a `REGGIE_VOICE` env or `voice` picks the voice), replacing any earlier episode. 501 off macOS; the page then reads the script aloud with the browser's own voice instead.
- `POST /api/journal` `{ text: string; slug?: string; stage?: string; evidence?: string[] }` → `JournalEntry` (tool `human`).