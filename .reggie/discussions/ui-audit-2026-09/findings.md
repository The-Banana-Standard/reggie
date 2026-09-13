# Audit findings — Reggie UI, `repo-manager` branch

90 findings from a nine-dimension audit run 2026-09-09. Each was produced by one agent and then
re-checked by a second agent sent to refute it against the cited code; none were refuted, which is
an unusually clean rate — treat minors as leads rather than settled fact. Severities are as corrected
by the verifier. Evidence is quoted as the auditor cited it; line numbers are from commit `0630543`
and drift as the code moves.


---

## server-api

10 findings (2 blocker). The server is one file (`src/serve.ts`, 1967 lines) exposing 25 working GET routes, 3 stubbed GETs (501), and 6 POST routes, over a per-repo cache (`RepoCtx.cached`, workspace.ts:270) keyed on HEAD sha for code-derived data and a 10 s TTL for `.reggie/` state. The API surface is coherent, well-guarded (Host-header rebinding check on every method, loopback-socket + Sec-Fetch-Site + Origin on POST, every numeric parameter bounded via `qInt`, every path through `safeRepoPath`/`safeStaticPath`), matches `docs/ui-api-contract.md` closely, and is covered by 93 tests in `test/serve.test.ts`. What it serves is a *static reading of committed history*: structure (graph, views, impact), narrative (story, explain), knowledge (notes, journal), tasks/packets, services and data flows. What it does not serve is anything about work in flight. There is no diff endpoint anywhere; no `git …


**[blocker] No endpoint anywhere returns a diff**  
`G2-understand-changes` · `absent`

> `grep -rn "diffStat|changedFiles|git diff" src/*.ts` → git.ts:175 diffStat and git.ts:180 changedFiles are called only from packet.ts:27-28; serve.ts never calls either. The richest change data any route returns is CompletionDiff at serve.ts:1215-1221 — {path, added, deleted} per file, i.e. numstat totals with no …

The server can tell you *which* files a task touched and how many lines moved, and never *what* changed. `completionDiff` (serve.ts:1276-1293) sums numstat across the task's commits; `historyOf(c).log` (history.ts:98) already holds every commit in the 365-day window with its per-file numstat, in memory, and no route returns it as a commit feed either. There is no `/api/diff`, no per-commit route, no patch text. The client confirms it: ui/board.js renders `c.diff.files` as a list of paths with +/- counts and has no diff viewer.

*Why it matters:* G2 is 'help the user understand the changes that are being made'. Reviewing what Claude Code or Codex just wrote means reading the patch. Today the UI can only say '7 files, +214/-31' and hand you a `vscode://` link (serve.ts:1163 editorUrl) to go read it somewhere else. The single most-needed screen for G2 has no …


**[blocker] There is no write path for a plan, a brief, or acceptance criteria**  
`G3-direct-agents` · `absent`

> The POST allowlist is exactly six routes: serve.ts:1804 `new Set(["/api/capture", "/api/note", "/api/decide", "/api/journal", "/api/triage", "/api/launch"])`. Plan authoring lives in plan.ts (renderPlanTemplate, lintPlan, setPlanRisk) and reaches only the CLI (cli.ts:271-342) and MCP (`reggie_plan_new`, mcp.ts:163).

Through the web UI a user can write: a one-line intake item with an optional detail paragraph (POST /api/capture), a note against an entity, a journal line, an empty brief scaffold, and approved/needs-work with a comment. They cannot write or edit `plan.md`, cannot edit `brief.md` after scaffolding, cannot add or reword a single acceptance criterion, cannot set a risk class, cannot answer an open question the brief records. `POST /api/triage` deliberately refuses to overwrite (serve.ts:1943 'No force over HTTP'), so the scaffold is write-once and thereafter read-only from the web.

*Why it matters:* G3 is 'help the user give direction to the agents so the agents understand exactly what the user is imagining.' The plan contract is the artefact that carries that imagining — the vision calls plan quality 'the lever'. The UI can display a plan and approve it; it cannot help the user shape one. Every act of direction …


**[major] The server has no concept of the working tree, and its caches are keyed on HEAD**  
`G2-understand-changes` · `absent`

> `grep -rn "porcelain|status --|stash" src/*.ts` returns nothing outside claim.ts's `git worktree` calls. tasks.ts:417 derives changed files with `git diff --name-only base...ref` — refs only. RepoCtx.cached (workspace.ts:270-281) rebuilds only when `headSha()` changes; graphOf, factsOf, servicesOf, flowsOf, …

Two consequences compound. (1) Uncommitted work is invisible: an agent that has edited fifteen files but not committed produces no change anywhere in the API — the task stays at whatever state its branch commits imply (tasks.ts:575 lastActivity = branch commit date). (2) The derived layer goes stale silently: because HEAD has not moved, the graph, symbol index, services and flows keep serving the pre-edit repo. A new file an agent just wrote does not appear on the map until someone commits. Only `.reggie/` state (tasks, notes, journal, config) has a 10 s TTL.

*Why it matters:* While an agent is working — the exact window where the user wants to watch — the UI shows a snapshot of the last commit. The map, the impact view, and the task card all lie by omission. G2 is unserveable without a working-tree tier.


**[major] No live-update channel: no watcher, no SSE, no WebSocket, no polling of anything but /api/status**  
`G2-understand-changes` · `absent`

> `grep -rn "fs.watch|watchFile|chokidar|EventSource|text/event-stream|WebSocket" src/*.ts ui/*.js` returns zero matches in any server or client file. The only repeated fetch is the first-load warm-up loop at ui/app.js:895 (`api('/api/status', {fresh:true})`), which stops once ready.

The vision (docs/repo-manager-vision.md, 'Shape') describes 'reggie daemon (TypeScript): serves the UI, exposes the MCP server, watches files, builds graphs'. The watcher half does not exist. Client caching is a 10 s in-memory map keyed by URL (ui/app.js:404-433); it is invalidated only by the user's own POSTs (`invalidate('/api/')` at app.js:605) or by navigation. Nothing an agent does in another process ever reaches an open page.

*Why it matters:* To follow along with an agent you must manually reload. Combined with the HEAD-keyed cache above, even a reload shows nothing new until a commit lands.


**[major] A launched session carries no words from the user — only (tool, mode, slug)**  
`G3-direct-agents` · `absent`

> POST /api/launch reads only `slugs`, `slug`, `tool`, `mode` (serve.ts:1953-1962). The prompt is a constant selected by mode: launch.ts:154-165 claudeArgument returns `/reggie-plan <slug>` etc.; launch.ts:167-179 codexArgument returns the fixed paragraphs at launch.ts:96-146. Nothing in LaunchInput (launch.ts:22-29) …

`chatPrompt`, `triagePrompt`, `planPrompt`, `implementPrompt` are hard-coded strings parameterised only by the slug. The user's intent reaches the agent only through whatever `reggie context <slug>` happens to contain — which is the intake line, notes, and the plan, i.e. only what was already written elsewhere. There is no 'and here is what I actually mean' field on any launch control in ui/board.js (launchAction at board.js:679 builds a tool picker and nothing else).

*Why it matters:* The one moment where the user hands work to Claude Code or Codex is the moment G3 is decided, and the API gives it a four-value payload. A `prompt`/`intent` string appended to the canned prompt would be a small change to launch.ts and would close most of the gap.


**[major] Reading and finding code are both crippled: /api/file caps at 20 000 characters with no range, and /api/search never looks inside files**  
`G1-understand-codebase` · `friction`

> serve.ts:75 `MAX_FILE_CHARS = 20_000`; serve.ts:1156 `text: content.slice(0, MAX_FILE_CHARS)`. `fileRoute` accepts only `?path=` — no offset, no line range. This repo's own `ui/map.js` is 221 825 bytes, so the reader can show 9% of it; ui/reader.js:535 renders 'Line N is past the 20,000 characters shown here.' …

The two primitives for 'understand this codebase' are read a file and find a string. Neither works at scale. Symbol search is limited to *exported* symbols (serve.ts:296-310 `if (s.exported)`), so a private helper is unfindable; no route resolves a symbol's references or callers, and /api/impact explicitly downgrades a `file::symbol` id to the file (serve.ts:1063).

*Why it matters:* G1 collapses to the map and the story prose. Any question that requires actually reading past line ~500 of a large file, or grepping for a string, sends the user back to their editor — which is where the tool was supposed to save them a trip.


**[major] The MCP surface omits the entire derived layer — graph, impact, services, flows, search, story**  
`G3-direct-agents` · `absent`

> src/mcp.ts registers exactly ten tools (asserted in test/mcp.test.ts:31): reggie_tasks, reggie_task, reggie_context, reggie_find_notes, reggie_add_note, reggie_journal, reggie_capture, reggie_plan_new, reggie_lint_plan, reggie_people. mcp.ts imports no graph.js, views.ts, services.ts, flows.ts, symbols.ts or …

Everything the HTTP side computes to make the UI understandable — the import graph, blast radius, the service inventory, traced data flows, the symbol index, repo history aggregates — is unavailable to Claude Code and Codex. The gap runs the other way too: the launch prompts tell agents to run CLI verbs that have no MCP tool (`reggie claim`, `reggie packet`, `reggie triage`, `reggie plan risk`, `reggie brief lint` — launch.ts:126-146), while claim.ts and the packet scaffold are imported by neither serve.ts nor mcp.ts. So there are three partly disjoint interfaces (HTTP 31 routes, MCP 10 tools, CLI ~35 commands) and the agent-facing one is the thinnest.

*Why it matters:* The vision makes blast radius central to the plan contract ('Blast radius is computed from the named files and risk class is set from it') and makes graph context central to triage. An agent asked to plan cannot query any of it. A `reggie_impact` tool wrapping the existing `impactView` would be roughly thirty lines …


**[major] Plan and brief lint results are computed and thrown away before they reach HTTP**  
`G3-direct-agents` · `broken`

> tasks.ts:491 `const planLintOk = planContent ? lintPlan(planContent).ok : null;` — `.errors` and `.warnings` are discarded. `lintBrief` (brief.ts:160) is called only from cli.ts:353. No serve.ts route returns a LintResult.

`lintPlan` returns `{ok, errors[], warnings[]}` (plan.ts:159) and the CLI prints all of it (cli.ts:302-308), as does MCP's reggie_lint_plan (mcp.ts:205-211). The web API keeps only the boolean, which surfaces in TaskInfo.planLintOk. A user looking at a card that says the plan fails the contract has no way, inside the UI, to learn which of 'every acceptance criterion is checkable', 'verification strategy names evidence', 'risk class is set', 'no placeholders' is missing. Brief lint is worse: it exists only in the CLI, so a brief scaffolded by POST /api/triage can never be checked from the page that created it.

*Why it matters:* The plan contract is the thing the vision says guarantees direction quality. The UI shows a red flag with no message. Passing the LintResult through `/api/task` is a one-field change and turns the gate into guidance.


**[major] POST /api/triage does none of the triage the vision specifies, despite having every input in scope**  
`G3-direct-agents` · `spec-drift`

> scaffoldBrief (triage.ts:66-86) reads only the intake line and writes renderBriefTemplate. serve.ts:1931-1951 calls it with `{slug, author}` and nothing else, in a handler where graphOf(c), notesIndexOf(c), historyOf(c) and symbolIndexOf(c) are all one function call away.

docs/repo-manager-vision.md, 'Grooming, step by step / Triage', specifies four steps: dedupe against open tasks and history; attach graph context (the files, symbols and stores the item likely refers to, found by searching the graph and notes); guess size and risk from that neighbourhood; suggest a priority from hotspot and dependency data. The implementation does step zero: it copies the intake text into a template with `area`, `size`, `priority` left empty. Relatedly, `riskFromFiles` (plan.ts:209) is case-insensitive substring matching over the plan's file list — not the graph-derived blast radius the vision describes — and serve.ts never calls it at all.

*Why it matters:* Triage is the first place the user's rough idea becomes something an agent can act on, and it is the cheapest place to inject repo understanding into direction. The server already knows which files a phrase probably refers to (that is what /api/search does); the triage endpoint just does not ask.


**[major] Agent-written evidence HTML and SVG are served as active content on the app's own origin**  
`foundation` · `risk`

> serve.ts:57-68 EVIDENCE_TYPES maps `.html` → `text/html; charset=utf-8` and `.svg` → `image/svg+xml`. evidenceRoute (serve.ts:1394-1398) streams the file with that type and no other headers. `grep -rn "Content-Security|nosniff|content-disposition" src/*.ts ui/index.html` returns nothing. ui/board.js:1787 renders the …

Evidence is whatever an agent saved under `.reggie/tasks/<slug>/evidence/` — a Playwright report, a coverage page, an SVG — and it can also be recovered from a task branch that a teammate pushed (serve.ts:1400-1408). Opening one puts attacker-controllable HTML on `http://127.0.0.1:<port>`, the same origin as the guidebook, where `Sec-Fetch-Site: same-origin` and a matching `Origin` are exactly what checkPostOrigin (serve.ts:597-612) requires. Such a page can POST to /api/note, /api/journal, /api/capture and /api/decide. docs/ui-spec.md §8 lists the traversal and loopback defences and does not mention this path.

*Why it matters:* The whole point of the evidence store is that a model writes into it and a human clicks it. A `Content-Disposition: attachment` (or a sandboxed iframe, or a CSP on the route) is a two-line fix, and without it the safest surface in the design — 'the server never writes source files' — has a same-origin write hole …


---

## client-ui

10 findings (1 blocker). The client is ~14,000 lines of hand-written vanilla ES modules with no bundler and no tests: app.js (2,304 lines: hash router, fetch cache with a 10s TTL, DOM helper, chips/links, toasts, palette, keyboard, per-level orchestration), map.js (4,944 lines: one Cytoscape wrapper whose `createMap` closure alone is 2,075 lines, plus a second services/flows model builder bolted on after line 4,047), board.js (2,982 lines: tasks board, task page, blast-radius controls, session launcher), story.js (1,162 lines: the seven paragraph kinds, four inline forms, Spotlight), reader.js (741 lines: the source drawer). The hash router reaches 14 levels; 11 of them render real content, 3 (people, person, time) render a "not in this release" card while being linked from story prose, task pages, the board and search results. The information architecture as built is: header (brand, breadcrumb, 4-item nav, …


**[blocker] There is no diff view anywhere in the client**  
`G2-understand-changes` · `absent`

> `grep -rn "diff" packages/reggie/ui/*.js` returns only board.js:1826-1856 (numstat totals) and unrelated prose; `grep -rn "git diff" packages/reggie/src/*.ts` finds only git.ts:176/181 (`--stat`, `--name-only`) and tasks.ts:417

The strongest change surface the UI has is board.js:1827-1854 in the Completed view: a list of changed file paths with `+N −M` per file and a sentence of totals. The task page shows the same information as chips ("changed on branch" at board.js:1641). The story column shows commit subjects with author and date (story.js:506 commitPara). /api/file (reader.js:32) serves only the current contents of a file. Nothing in the client — and nothing in serve.ts — ever produces or renders a hunk, a before/after, or a per-commit file view.

*Why it matters:* G2 is "help the user understand the changes that are being made". The user's agents write code; the only way this UI lets them see what changed is a filename and two integers. Reviewing an agent's work still means leaving the UI for `git diff` or an editor, which is exactly the hop the product is meant to remove.


**[major] The UI never updates itself — it is a snapshot per navigation**  
`G2-understand-changes` · `absent`

> `grep -rn "EventSource|WebSocket|text/event-stream|setInterval" packages/reggie/ui/*.js packages/reggie/src/serve.ts` returns nothing; app.js:2296 `window.addEventListener("hashchange", ...)` is the only re-render trigger besides afterWrite (app.js:1287)

/api/status is polled exactly once at boot, in a bounded 60-iteration loop that stops the moment `ready` is true (app.js:880-908). After that, `api()` caches every GET for 10 seconds (app.js:410) and nothing invalidates it except a POST from this page (app.js:605). The board's `reconcile()` (board.js:2145) only fires after a local write. While a Claude Code or Codex session is committing to `task/<slug>`, writing journal entries, or landing a packet, an open Reggie page shows the state from whenever you last navigated.

*Why it matters:* The vision (docs/repo-manager-vision.md, "Shape") describes a daemon that "watches files" and renders live state, and G2 is about watching changes land. A page that silently goes stale while agents work is worse than no page: the board can show "In process" for a task that merged an hour ago, and the user has no …


**[major] Person, People and Timeline are placeholders, yet the whole app links to them**  
`G1-understand-codebase` · `broken`

> packages/reggie/ui/app.js:1995-2008 renderStretchLevel; linked from packages/reggie/src/story.ts:319, 910, 1307, 1538, 1664, 1821 and packages/reggie/ui/board.js:2269, 2608; search returns `kind: "person"` rows at packages/reggie/src/serve.ts:1670

`renderStretchLevel` renders one card: "Person pages are not in this release. Ownership is on every area page under 'Who works here'..." (app.js:2003). Meanwhile story.ts emits `person:<handle>` links in the repo "What it is made of" paragraphs (line 910), the area "Who works here" section (1307), file history (1538), task owner (1664) and the workspace Needs-you list (1821) — every one of which app.js:318 routes to that placeholder. board.js:2608 (task owner) and board.js:2269 ("X owns every claimed task here") do the same, and a ⌘K search for a teammate's handle offers a row that lands there too. The parent crumb for a person is `people`, which is also a placeholder (app.js:390).

*Why it matters:* Ownership is the answer to "who do I ask about this code", one of the core G1 questions the vision's visualization catalog names ("Ownership and bus factor"). Right now every route to that answer is a dead end that also teaches the user that links in this UI cannot be trusted.


**[major] The Data flow maps have no node cap, and reggie's own repo already exceeds it**  
`G1-understand-codebase` · `broken`

> packages/reggie/ui/map.js:4640 buildFlowsModel and map.js:4481 buildFlowModel add one node per entry/step with no cap; packages/reggie/docs/ui-spec.md:19 "The server never returns more than 40 drawable nodes for a canvas"; `grep -c '\.command(' packages/reggie/src/cli.ts` = 38 and `grep -c registerTool …

buildFlowsModel (map.js:4640) iterates `flows` and pushes a node for each, wrapping into columns of 12 (`const ROWS = 12`, map.js:4653); buildFlowModel (map.js:4481) pushes a node for every distinct step endpoint, and flows.ts:188 caps a walk at MAX_FLOW_STEPS = 200. Neither builder has the fold machinery that buildServiceModel has (map.js:4262-4412, MAX_SERVICE_NODES = 18 plus a "Show all (N more)" button). The story column mirrors this: app.js:1821-1828 renders one `.card--flow` per flow with no cap or pagination. On this repo, `/api/flows` will report roughly 48 entry points (38 commander commands + 10 MCP tools), so the Data flow page draws ~48 entry nodes plus every service they reach, …

*Why it matters:* "No hairball, ever" is the load-bearing promise that makes these maps readable; the aggregation contract is what separates this from a graphviz dump. Two of the five map levels sit outside it, and the level that breaks first is the one meant to answer "how does a request travel through the code".


**[major] Folded nodes on the explorer and blast-radius maps can never be opened**  
`G1-understand-codebase` · `spec-drift`

> packages/reggie/ui/app.js:1104-1107 (fold tap → toast); app.js:1248-1253 mapUrlFor builds `/api/impact?...` with no `all` parameter; packages/reggie/src/serve.ts:997-1001 impactOptionsOf reads only depth/direction/tests; packages/reggie/docs/ui-spec.md:73 "More than 40 nodes on a side: fold by area into `+N more in …

On the area level a fold tap works: `if (route.level === "area") return setQuery({ all: "1" })` (app.js:1105), and graphRoute honours `all` (serve.ts:990). On the file/symbol explorer and on the task blast radius the same tap falls through to `toast("<N> files are folded into this node; raise the depth or open the area to see them.")` (app.js:1106) — but raising the depth adds nodes, which makes the fold larger, and /api/impact has no `all` switch to ask for the rest. The fold exists precisely because a hop exceeded 40 nodes (views.ts:1019-1024), so the advice the toast gives cannot work.

*Why it matters:* "What breaks if I change this" is the explorer's whole purpose and the blast radius is what a user checks before turning an agent loose on a file. When the answer is "23 files folded into a node you cannot open", the user has to fall back to grep — and the map has quietly hidden the part of the answer most likely to …


**[major] Controls that are wired to nothing, or that act on levels where they are hidden**  
`G1-understand-codebase` · `broken`

> packages/reggie/ui/app.js:1377-1383 vs packages/reggie/ui/map.js:3696; packages/reggie/src/serve.ts:984 ignores `tests` for `level=container`; packages/reggie/ui/map.js:1524; app.js:1354-1375 vs app.js:2252-2258; app.js:792

Four concrete cases. (1) `syncTestsButton` hides #tb-tests on the repo overview (app.js:1382), but map.js:3696 runs later inside `map.show` and sets `testsBtn.hidden = level === "workspace" || "flow" || "flows"` — so on the repo overview the button reappears reading "Show tests (49)"; clicking it writes `?tests=1`, and mapUrlFor returns `/api/graph?level=container` with no tests param (app.js:1246), which serve.ts:984 ignores. Nothing changes, ever. (2) map.js:1524 computes `hiddenText` as "49 tests hidden" whenever the lens is not `tests`, including `level === "container"`, so the repo footer claims a hidden set that cannot be unhidden — the code comment three lines above says it does the …

*Why it matters:* Every one of these teaches the user that a control in this UI may or may not do something. The repo overview is the first screen anyone sees, and its most prominent map control is inert while its footer makes a claim about hidden tests that the control cannot act on.


**[major] Story↔map lockstep is one-way on the three levels that own their own DOM**  
`G2-understand-changes` · `spec-drift`

> packages/reggie/ui/story.js:930 `wireMapHover(d)` is called only from `renderStory`; packages/reggie/ui/board.js:2344-2363 `hookStoryHover` wires only story→map; packages/reggie/ui/app.js:1843 renderFlowsLevel mounts its own nodes without renderStory; packages/reggie/ui/story.js:422 tintForNode selects …

The spec's two-way sync is: hover a paragraph → `map.highlight`; scroll a paragraph past the top third → `map.softHighlight`; hover a map node → tint the paragraphs that reference it (`tintForNode`, story.js:415). `renderStory` wires all three (story.js:930-931). The tasks board, the task page and the Data flow index never call `renderStory`: board.js:2322/2739 call `hookStoryHover`, which registers `mouseover`/`mouseout` on `[data-refs]` and nothing else, and app.js:1889 `wireRowRefs` does the same for flow rows. So on the task page — the one screen where the map is a blast radius and the column beside it is the plan — hovering a node on the map highlights nothing in the plan. Even if a …

*Why it matters:* The blast-radius map is the UI's answer to "what will this change affect", and the plan beside it is what the agent was told to do. Being able to point at a node and see which acceptance criterion or file line mentions it is the whole reason the two columns sit side by side; on this level the connection only runs one …


**[major] On the workspace map, three of the five lenses are live and say something false**  
`G1-understand-codebase` · `broken`

> packages/reggie/ui/map.js:372-397 workspaceToView; map.js:1119-1127 testsFill/testsClass; packages/reggie/ui/app.js:1350-1353 (workspace is in neither GRAPHLESS_LEVELS nor SERVICE_LEVELS)

`workspaceToView` builds repo nodes with no `history` field, no `author`, and `aggregates.testedSource` hard-coded to 0 (map.js:392). `syncGraphChrome` only disables lenses for `services`/`flows`/`flow` (app.js:1363), so all five stay enabled on `#/ws`. Under Heat, `hasHistory` is false for every node so `heatFill` returns HEAT_NO_HISTORY for all of them (map.js:1139) — a uniform grey. Under Owners, `ownerOf` returns null for every node (map.js:1143). Under Tests, `testsFill` takes the `kind === "repo"` branch and computes `share = 0 / max(1, source)` → below 0.2 → `COLORS.knowNone` and class `untested` (map.js:1121-1124, 1130-1133) for every repo, including repos with full test suites.

*Why it matters:* This is the one screen in the product that shows more than one repo, and it will confidently paint a well-tested repo as untested. The vision is explicit that "a partial picture presented as a whole one is exactly the confident wrong answer this page exists against" — the flow page has a card for that case; the …


**[major] There is no way to write a note on a repo or an area once notes exist**  
`G3-direct-agents` · `broken`

> packages/reggie/src/story.ts:1549 (`add-note` section is emitted for the file scope only); packages/reggie/ui/story.js:890 (`if (sec.id === "add-note" ...)`); packages/reggie/ui/story.js:811-812 (forms only appear inside an `empty` block); packages/reggie/ui/app.js:1167-1169

The note form is reachable two ways. Either a section is empty and its `empty.action.form === "note"` (story.js:812) — which for an area is the "Read these first" section (src/story.ts:1224) and for a repo is "What this is" (src/story.ts:858) — or the section id is `add-note`, which src/story.ts:1549 emits only for the file scope. So the moment a repo or an area has even one note, the form disappears. The Spotlight's third action then calls `onAddNote`, which does `if (!focusNoteForm()) toast("Open a file or an area to add a note there.", { tone: "warn" })` (app.js:1168) — advice that is wrong, because the user is already on an area and there is no form there. The reader drawer's "Add a …

*Why it matters:* Notes are the mechanism the vision names for "how human knowledge flows back into the graph", and the generated CLAUDE.md tells every agent to read `.reggie/notes/<path>.md` before editing. G3 is about the user telling agents what they mean; correcting or enriching a note is the cheapest, most durable way to do that, …


**[major] 14,000 lines of client code with zero tests, one 4,944-line module, and dead exports**  
`foundation` · `risk`

> packages/reggie/vitest.config.ts `include: ["src/**/*.test.ts", "test/**/*.test.ts"]`, `environment: "node"`; `wc -l packages/reggie/ui/*.js` = 12,133 across five modules; packages/reggie/ui/map.js:98 `const MAX_DRAWABLE = 40;` (the only occurrence in the repo)

No test file matches any file under ui/, and the vitest environment is `node` with no DOM — the 23 `.test.ts` files all cover src/. Verification of the client is manual, via the six harnesses and ~250KB of sample JSON in ui/dev/, which serve.ts:772 happily serves to any browser and package.json ships (`"files": [... "ui" ...]`). map.js is 4,944 lines, of which `createMap` (map.js:1973-4047) is a single 2,075-line closure holding ~60 inner functions including a 192-line `fit()`; the services/flows model builders are appended after line 4,047 as a second, parallel system with its own paint, legend, footer and tooltip functions. Dead code confirmed by grep across ui/*.js and ui/dev/*.html: …

*Why it matters:* Every finding above is the kind a test would have caught, and the code is now at the size where a change to map.js cannot be made confidently by a human or an agent. This directly undercuts G3: the user's agents will be asked to extend this UI, and there is no executable specification for them to work against — only …


---

## spec-drift

10 findings (0 blocker). Six specs govern this branch: `docs/ui-spec.md` (262 lines, the original Core/⧗STRETCH split), `docs/ui-api-contract.md` (315 lines, shapes), `docs/ui-implementation-plan.md` (155 lines, file plan + 27 acceptance criteria), `docs/tasks-page-spec.md` and `docs/services-and-flows-spec.md` (two addenda that declare themselves winners over the first two), and `ui/DOM-CONTRACT.md` (271 lines, ids/classes/module interfaces). Core is close to fully built: I mechanically checked every shell id and icon in DOM-CONTRACT §1 against `ui/index.html` (zero missing), every module export in §4 against the five UI modules (zero missing), every class name in §2 against the five stylesheets (three unstyled, all cosmetic), and every route in `ui-api-contract.md` against `src/serve.ts:823-880` (all present; `/api/treemap`, `/api/timeline`, `/api/export` correctly 501). Every story section id in the …


**[major] getting-started.md still documents the pre-Guidebook server that shipped in 1fb7aa2**  
`G1-understand-codebase` · `spec-drift`

> docs/getting-started.md:196 "the repo drawn as a graph: files as nodes sized by length… The other tabs list tasks by state, every note, and the journal"; docs/getting-started.md:200 "no call graph, data flow, cross-repo map, or ownership overlays yet"

This is the only user-facing document for `reggie serve`. It describes the single flat file-graph page from commit 1fb7aa2 (677 insertions) — nodes sized by length, green/amber note rings, "other tabs". Everything in d2d8ffb, 0cf9d62, 58f1408 and 0630543 is invisible to a reader: the story column, Levels 0-3, the Spotlight, five lenses, the reader drawer, the tasks page with launch, the Services and Data flow pages. Line 200's "what this version does not do yet" list is now false in three of its four clauses — `#/repo/<n>/flows` traces data flow (src/flows.ts), `#/ws` is a cross-repo map (src/workspace.ts), and the Owners lens is an ownership overlay (ui/map.js:1153).

*Why it matters:* A user who reads the docs will not know the pages exist, and an agent pointed at docs/ will describe the old UI back to them. It is also why the stale server on :4310 is confusing rather than obviously outdated.


**[major] ui-spec.md was never updated as tasks-page-spec explicitly instructed, and still teaches the removed `grooming` state**  
`G3-direct-agents` · `spec-drift`

> docs/tasks-page-spec.md:4 "update those two as you implement"; docs/ui-spec.md:134 ("six-column board (ungroomed | grooming | groomed | …)"), :164 ("grooming `#8b93a7`", no `planned` colour), :243 (old STATE_MACHINE); vs src/tasks.ts:15 and ui/board.js:49

ui-api-contract.md was updated for the new model; ui-spec.md was not. It still specifies a six-column board including `grooming` and `done` (the shipped Open view is five columns, `done` is a separate Completed view — ui/board.js:49 OPEN_STATES), still gives `grooming` a palette slot and omits `planned` (styles.css:77 has `--state-planned: #bb9af7`), and §6.8 still narrates the pre-brief state machine. docs/how-reggie-structures-a-repo.md:88 repeats the error to users: "A `plan/<slug>` branch exists, or a plan is on disk but fails the contract | grooming". Only src/tasks.test.ts:192 guards the code (`expect(JSON.stringify(STATE_MACHINE)).not.toContain("grooming")`); no guard exists for the …

*Why it matters:* These files are what an agent reads to know how the system works — they are loaded into planning sessions. An agent told the states are ungroomed→grooming→groomed will write plans, briefs and UI against a state that no longer exists, and the user's direction (G3) will be laundered through a wrong model before it …


**[minor] The story and the map compute different Level-1 area sets when config.yaml pins `areas:`**  
`G1-understand-codebase` · `spec-drift`

> src/serve.ts:272 `containerView(graphOf(c), viewOpts(c))` vs src/story.ts:485-493 `containerView(graph)` / `level1(graph)` / `dirView(graph, key)` — no opts; src/serve.ts:395-414 storyContextOf passes no `areas`

ui-spec §6.2 rule 4 is Core, not stretch: "`config.yaml` `areas: [paths]` pins the result for `dir:./` (each listed path becomes an area; unlisted code folds into `(other)`)". serve.ts honours it for the map through `viewOpts(c)` → `areaOpts(c)` → `extrasOf(c).areas` (src/serve.ts:275-288). story.ts builds its own views with bare calls and `buildStoryContext` is never handed the pin, so "What it is made of", the area ghost sections and every `refs` id would name a different area set than the canvas draws. That breaks ui-spec §1 principle 1 ("Story + Map in lockstep… Both routes to any entity land on the same URL") in the one configuration the spec provides for tuning the map. It is latent …

*Why it matters:* The `areas:` pin is the only lever a user has to make the repo map match how they actually think about their codebase — the direct G1 control. The moment they use it the two columns disagree, and the disagreement is silent: a story paragraph would highlight nothing on hover because its refs name nodes the canvas does …


**[minor] The 40-node cap, the spec's loudest rule, is not enforced on the Services or Data flow maps**  
`G1-understand-codebase` · `broken`

> ui/map.js:4632 `fitWhole: nodes.length > 36` with no fold node; ui/map.js:4274 `const fileIds = Array.from(new Set(edges.map((e) => e.file))).sort();`; src/flows.ts:188 `export const MAX_FLOW_STEPS = 200;`

ui-spec §1 principle 3: "No hairball, ever. The server never returns more than 40 drawable nodes for a canvas (overflow folds into `+N more` nodes)", restated as acceptance 15. views.ts enforces it (MAX_VIEW_NODES = 40, src/views.ts:98) and views.test.ts asserts it three times. The two maps added in 58f1408 inherit none of it. The flow builder (ui/map.js:4560-4636) emits one node per distinct step endpoint with no `fold:` node at all, and services-and-flows-spec §2 records that the ground-truth chat handler traces to 112 steps at depth 5. The services builder caps *services* at MAX_SERVICE_NODES = 18 and folds the tail into `fold:services` (ui/map.js:4406), but the left-hand file column is …

*Why it matters:* These are the two pages that answer "where does my data go", the highest-value G1 question the tool can answer. A 100-node LR dagre graph at a zoom where `fitWhole` admits "no label is drawn either way" (ui/map.js:4630) is the hairball the whole design exists to prevent, and it is the newest, least-defended surface.


**[minor] ui-spec.md never gained the Services / Data flow routes or the header nav, so three docs now describe three different shells**  
`G3-direct-agents` · `spec-drift`

> docs/ui-spec.md:27 route list has no `/services`, `/flows`, `/flow`; docs/ui-spec.md:100 header description has no nav; vs ui/DOM-CONTRACT.md:14 (`#nav`) and ui/app.js:803 renderNav; ui/app.js:236-241 parses all three levels

services-and-flows-spec.md:3 claims precedence over ui-spec, and DOM-CONTRACT documents both the `#nav` control and the services/flows entries in its route→data table (lines 250-252). But ui-spec §2 remains the only place the *whole* route grammar is written down, and it lists eight routes, three of which (`/people`, `/person`, `/time`) are stubs while three that actually work are absent. §3.1's shell description likewise predates the nav and the brand mark added in 0630543 (ui/index.html:92). A reader has to diff three documents to learn what pages exist.

*Why it matters:* There is no single document that answers "what pages does this app have". That is the first question a user or an agent asks, and answering it wrong is how the Services page ends up rebuilt or the nav ends up dropped in the next change.


**[minor] AreaRef.hue is contracted 1..8 but the palette has only five real hues, so acceptance 2 cannot be met on this repo**  
`G1-understand-codebase` · `spec-drift`

> docs/ui-api-contract.md:62 `hue: number /* 1..8 by source-count rank, or 0 = other */`; src/views.ts:106 `export const AREA_HUE_COUNT = 8;`; ui/map.js:71 `AREA_HUES = ["#6b7280","#5d7bd6","#bb9af7","#f06fb1","#73daca","#d9a066"]`

The server ranks and hues the top eight areas. ui-spec §5.1 defines only `--area-1`…`--area-5` plus `--area-other` for "sixth and beyond", and map.js honours the spec: areaHueResolver (ui/map.js:459-478) re-seats hues into the six-slot ramp and comments "ramp exhausted: fall back to 'other' grey" (line 474). ui-spec §6.2 and acceptance 2 both state this repo's Level 1 yields seven areas, so two of them are drawn in the same grey — yet acceptance 2 requires "the legend lists one swatch per visible area". Three of the eight hue values the contract promises are unrenderable.

*Why it matters:* Area colour is the default hue channel and the main way the repo map is read at a glance. Two areas sharing the 'other' grey means the reader cannot tell them apart on the canvas or in the legend, on the exact repo the spec was written against.


**[minor] aggregates.documentedOwn — the field the Knowledge lens depends on — is documented only in DOM-CONTRACT, not in the API contract**  
`G1-understand-codebase` · `spec-drift`

> docs/ui-api-contract.md:25 `interface Aggregates { files; source; tests; config; lines; documented; stale; testedSource; tasks; history? }` — no documentedOwn; ui/DOM-CONTRACT.md:271 documents it; src/serve.ts:260-266 adds it; ui/map.js:197 `const own = agg.documentedOwn ?? agg.documented ?? 0;`

DOM-CONTRACT §5 explains why the field exists: `documented` counts inherited notes, so "with one `_repo` note every area reads as 100% documented and the Knowledge lens goes flat". The container node label, the Knowledge fill and the node tooltip all read `documentedOwn`. ui-api-contract.md is the document that owns response shapes and never mentions it, so anyone implementing a second client, a test fixture or a CLI renderer against the contract gets the flat-lens bug back. The same file (line 259-269) records that exact failure mode already happening once with `edge.top` vs `edge.mostly`.

*Why it matters:* Knowledge coverage is the G1 answer to "what does nobody understand here". A field this load-bearing being absent from the shape contract is how the lens silently goes flat again.


**[minor] The Heat window became adaptive; ui-spec still pins it to commits30**  
`G2-understand-changes` · `spec-drift`

> docs/ui-spec.md:90 "heat | 5-step quantile on `commits30`"; docs/ui-implementation-plan.md:142 acceptance 14; vs ui/map.js:209-215 HEAT_WINDOWS (30 → 90 → 365) and ui/map.js:216 HEAT_MIN_BUCKETS = 3

map.js walks 30, 90 then 365 days and stops at the first window whose ramp is occupied by at least three distinct steps, naming the chosen window in the legend title, the node sub-label and the tooltip. DOM-CONTRACT lines 175-178 explicitly sanctions this ("The Heat window is map.js's own choice, not a constant this contract pins"). ui-spec was not updated, so its lens table and acceptance 14 ("packages/reggie the hottest (most commits in 30 days)") now describe behaviour the code deliberately does not have.

*Why it matters:* Heat is the map's only answer to "what has been changing" (G2). Two specs giving two rules for the same channel means the next change to it has a 50% chance of reverting an intentional improvement.


**[minor] Four spec'd config.yaml keys are undiscoverable — the generated config names only mode and risk**  
`G3-direct-agents` · `friction`

> src/people.ts:137-147 saveConfig writes header lines about mode and risk only, body = {mode, mcpServerName, risk, defaultBranch?}; src/people.ts:37-43 ReggieConfig has no `areas` or `editorScheme`; src/serve.ts:138-158 extrasOf re-parses the YAML out of band

ui-spec §6.2 rule 4 specifies `areas:`, §2 Level 3 specifies `editorScheme`, tasks-page-spec §9 specifies `legacy:` (with `enabled: false` to switch the backlog reader off), and §6.1 reserves `boundaries:` (⧗). Only `legacy` reached the ReggieConfig type; `areas` and `editorScheme` are read by a second, private parser in serve.ts because the type does not carry them. `.reggie/config.yaml` as written by onboard carries a two-line header naming mode and risk and nothing else, so a user has no way to learn any of the four exist short of reading docs/ui-spec.md §6.

*Why it matters:* `areas:` is the one control that makes the repo map match a user's own mental model of their codebase, and `legacy:` decides whether their real backlog is read. Both are the user directing the tool (G3), and both are invisible in the file they would edit.


**[minor] Two id schemes for one entity kind: `sym:<file>::<name>` and `sym:<file>#<name>`**  
`G3-direct-agents` · `spec-drift`

> docs/ui-spec.md:27 `sym:<file>::<name>`; docs/ui-api-contract.md:253 `entry: string; // node id of the handler symbol: 'sym:<file>#<name>'`; src/flows.ts:477 `return \`sym:${file}#${name}\`;` vs src/story.ts:370 `id.slice(id.lastIndexOf("::") + 2)`

ui-spec §2 declares one id scheme for the whole system ("One entity model, one id scheme, one route per entity", §1 principle 2). flows.ts chose `#`. story.ts carries a comment reconciling them at line 321 ("A flow step names a symbol as `sym:<file>#<name>`; the graph names one as `sym:<file>::<name>`") and app.js splits on `#` at ui/app.js:1119 and on `::` at ui/app.js:948. Neither spec acknowledges that both exist; the code papers over it in three places.

*Why it matters:* §1 principle 2 exists so every ref resolves and every entity has one route. Two schemes means `data-refs` from a flow step and from the graph can name the same symbol without matching, so story↔map highlighting fails silently on exactly the page where reading the story is meant to walk the map.


---

## g1-understanding-codebase

10 findings (1 blocker). Opening this UI on a TypeScript/JavaScript/Rust repo genuinely answers a real set of questions: what the top-level areas are and how big each is, which area leans on which and how hard, where the process starts (main/CLI/MCP/HTTP/Tauri entry detectors), what one file exports and who imports it, what has no note and which notes went stale after the code changed, who committed to an area in the last year, what external services the code touches and where each one is declared, and how data walks from an entry point to a store with the payload named or honestly marked not-derivable. The prose is not template mush — it is specific, hedged, and links every entity: "src/components leans on src/types 41 times, mostly for terminal.ts (21)", "It stands alone: nothing else in the repo imports it", "field names taken from the signature, not from the data". The honesty discipline is the best thing …


**[blocker] The graph exists only for TypeScript, JavaScript and Rust — every other language gets no node, no map, no story**  
`G1-understand-codebase` · `absent`

> packages/reggie/src/graph.ts:200 `const CODE_EXT: Record<string,string> = { ts, tsx, mts, cts, js, jsx, mjs, cjs, rs }`; :791 `const code = all.filter((f) => CODE_EXT[extOf(f)] !== undefined)`; :783-784 doc comment "TypeScript, JavaScript and Rust are resolved; other languages get no file nodes." Also …

Only files whose extension is in CODE_EXT become scans, and only scans become file nodes. Everything downstream is derived from those nodes: `chooseAreas`, the container map, `aggregates.source/tests/documented`, `inDegree`, `testedBy`, the Gaps sections, the Tests lens, `nodesUnder`, and every story sentence that counts files. A Swift, Kotlin, Go, Python, C#, Ruby, PHP, SQL, HTML or CSS file is invisible. `facts.ts` is broader — it counts those languages (facts.ts:163) and even emits `swift build`, `go build ./...`, `./gradlew build` and `pytest` commands (facts.ts:188-196) — so the header will say "Swift 240 files" while `madeOfSection` falls through to story.ts:931 and prints "<repo> has …

*Why it matters:* The user's own workspaces are Swift (Color Lock iOS, speech-therapy-app), Kotlin (color-lock-android), Go (RetroFantasy) and Python-adjacent pipelines. For the majority of the repos they build software in, this UI answers none of G1's questions at all — and does so silently, which is worse than refusing.


**[major] There is no call graph and no symbol level: `calls()` is a stub, so "what calls this / what breaks if I change this function" is unanswerable**  
`G1-understand-codebase` · `absent`

> packages/reggie/src/symbols.ts:911 `export function calls(_file, _content, _symbol): CallRef[] { return []; }` under the header `// Calls ⧗ STRETCH` at :899 and the comment "Until then every symbol calls nothing." `grep -rn '"calls"' src/` returns only the EdgeKind union at graph.ts:38 — no code anywhere constructs a …

What exists instead is `usedBy` (symbols.ts:755): the set of files whose *import statement* lists the symbol's name. That answers "which files import this name", not "who calls it", and it misses every call through a namespace import (`import * as g`, which binds the name `*`), a default import used as an object, a re-export, or a same-file call. Clicking a symbol row in "What it exports" navigates to `#/repo/<r>/symbol/<file>::<name>`, which renders the whole file's story again and scrolls the reader to the declaration. The blast radius that does exist (views.ts:928 `impactView`) is file-granular import reachability, depth clamped to 1–3 at views.ts:931 and capped at 40 drawable nodes at …

*Why it matters:* This is the single question a person most needs answered before letting an agent edit a function, and the one the vision names explicitly ("Symbol call graph explorer | What calls this, what breaks if I change it"). Without it the user cannot bound a change, and cannot give an agent a precise "these are the callers …


**[major] README, ARCHITECTURE and the repo's own CLAUDE.md are never read; "What this is" comes from package.json `description` alone, and on this branch it prints a false sentence**  
`G1-understand-codebase` · `absent`

> packages/reggie/src/facts.ts:178 `const description = typeof pkg?.description === "string" ? pkg.description : "";` — the only assignment. facts.ts:225 collects `docs` (README, ARCHITECTURE, CONTRIBUTING, docs/*.md) and `grep -rn "facts.docs" src/story.ts src/serve.ts` returns nothing. `grep -rni readme src/*.ts` …

On the `repo-manager` branch, where the Tauri desktop app is explicitly decommissioned (worktree CLAUDE.md, Decisions, 2026-09-06), the landing page's first sentence and the page subtitle (story.ts:799-801) both assert the repo is a desktop workspace app. The correct answer is sitting in `packages/reggie/package.json` ("Reggie: a repo manager for Claude Code and Codex…"), in `docs/repo-manager-vision.md`, and in the worktree CLAUDE.md's Conventions/Decisions/Gotchas — none of which the UI reads. The only escape hatch is for a human to hand-write `.reggie/notes/_repo.md`; the fixture at ui/dev/sample-story.json shows exactly that being the source of the one good sentence ("Reggie is a …

*Why it matters:* "What is this repo for" is G1 question #1, and the answer already exists in files the user maintains. Ignoring them and printing a stale manifest string makes the page actively misleading on the branch it was built to describe.


**[major] "(54 with tests)" renders a total-file count as a tests claim — a false sentence in the most-read paragraph on the landing page**  
`G1-understand-codebase` · `broken`

> packages/reggie/src/story.ts:907 `if (files > source) parts.push(" (" + linkRoute(routeFor(ctx.repo, ref.id, { lens: "tests" }), numberWord(files) + " with tests") + ")")` where `files = agg?.files` (all code files: source + test + fixture + config, graph.ts:1047-1048) and `source = agg?.source`. Same construction in …

29 source files plus 25 test/fixture/config files is 54 total. The sentence reads as "54 of them have tests", which is not only wrong, it is impossible — 54 exceeds the 29 source files it is qualifying. The number even links to `?lens=tests`, reinforcing the misreading. The correct number for "how much is tested" is `aggregates.testedSource`, which the code already computes (graph.ts:1053) and uses correctly one section over. The ambiguity originates in the spec (docs/ui-spec.md:49 carries the same phrasing), so it will not be caught as drift.

*Why it matters:* It is the third clause of the first paragraph a person reads about each area, and it makes the repo look far better tested than it is — the opposite of the "what is untested" question G1 needs answered.


**[major] The UI publishes no measure of how complete its own graph is: `unresolved` and `SYMBOL_ENGINE` are computed and discarded**  
`G1-understand-codebase` · `absent`

> `unresolved` is produced at packages/reggie/src/graph.ts:899 and shipped on RepoGraph/FlatGraph (:1130, :1151); `grep -rn "unresolved" ui/*.js src/story.ts src/serve.ts` returns nothing — no client or story code reads it. `SYMBOL_ENGINE` ("regex", symbols.ts:51) is put on the /api/symbols payload at serve.ts:1179 and …

Three separate blind spots compound. (1) Bare-specifier imports that resolve inside the repo — a monorepo workspace package, a tsconfig `paths` alias — are dropped as "external" and not even counted as unresolved; there is no tsconfig/jsconfig reading anywhere (`grep -rn "tsconfig|baseUrl|compilerOptions" src/` hits only a role regex at roles.ts:54). (2) `@/` and `~/` are hard-coded to `src/` at graph.ts:339-340, which is simply wrong for a Next.js repo aliasing `@/` to the project root. (3) Even the misses that are counted are never shown. The map's footer reports "7 areas · 12 edges · 49 tests hidden" (spec §3.1) but never "and 84 imports could not be resolved".

*Why it matters:* Everything in this UI is a claim about the code, and the user's stated goal is to trust it enough to direct agents from it. A map with 30% of its edges silently missing looks exactly like a map with none missing, so a person cannot calibrate how much to believe the "nothing imports this file" and blast-radius answers.


**[major] No source-content search: you can find a file by name but not the code that does a thing**  
`G1-understand-codebase` · `absent`

> packages/reggie/src/serve.ts `searchRoute` — read in full. It iterates graph nodes matching `n.label`/`n.path` (files), `n.label`/`n.path` (dirs), `symbolIndexOf(c)` names, task slugs/titles, `peopleOf(c)` handles/names, `note.entries[].text`, and `journalOf(c)` entry text. No branch reads file contents.

The palette placeholder (ui/index.html) advertises "Search areas, files, symbols, tasks, people, notes" — it is accurate. But the way a person actually enters an unfamiliar codebase is by searching for a string they saw: an error message, a UI label, an env var, a SQL table name, a route path. None of those are findable unless they happen to be a filename or a top-level declaration name. The one exception is by accident: services.ts already scans every code file for `env.X`, literal fetch hosts and SQL, so those specific strings are reachable via the Services page.

*Why it matters:* "Where do I start reading" is a G1 question, and for a person who has just seen a bug the entry point is a string, not a symbol name. Today they have to leave the UI and grep, which breaks the loop the tool is trying to own.


**[major] Cross-repo connection is manifest dependencies and GitHub org only; `shares-service` — the way the user's repos actually connect — is not produced**  
`G1-understand-codebase` · `absent`

> packages/reggie/src/workspace.ts:777-780 doc comment: "`depends-on` when a repo declares a dependency whose name a sibling provides …, `same-org` when two repos' origin remotes share a host and org …. `shares-service` is not produced yet." Implementation at :781-806 emits exactly those two kinds. docs/ui-spec.md:239 …

story.ts:1850-1858 renders whatever edges exist as "A depends on B (package `x`)" or "A and B share the GitHub org X". For a workspace where every repo is under one org (The-Banana-Standard), `same-org` produces a complete graph — an edge between every pair — which is noise, not information. Meanwhile the real coupling in Color Lock is a shared Firebase backend and a shared puzzle schema across iOS/Android/web/Reddit clients; `detectServices` already parses `.firebaserc` and `firebase.json` per repo (services.ts header, FIREBASE_SERVICES at :163), so the join key exists and is simply not joined across repos. There is also no cross-repo file- or symbol-level edge of any kind: each repo's …

*Why it matters:* "How do the repos connect" is a G1 question the vision lists ("Cross-repo map"), and the answer the UI gives for this user's workspaces is either empty or an all-pairs org edge — worse than silence, because it looks like an answer.


**[major] Authorship is the git author only: Co-Authored-By is not parsed, so the UI cannot distinguish agent-written code from human-written code**  
`G1-understand-codebase` · `absent`

> packages/reggie/src/history.ts:121 `export const HISTORY_LOG_FORMAT = "%H|%an|%ae|%aI|%s|%(trailers:key=Task,valueonly,separator=;)"` — only `%an`/`%ae` feed the author map (parsed at :259), and the only trailer requested is `Task`. `grep -rn "Co-Authored" src/history.ts src/git.ts` returns nothing. The Owners lens …

The repo's own convention (worktree AGENTS.md/CLAUDE.md attribution rules, and this session's instructions) puts the model in a `Co-Authored-By:` trailer while the git author stays the human. So in a solo repo built with Claude Code and Codex, the Owners lens paints every file one colour, `busFactor` is 1 everywhere, and "mostly by jacobpress" is true of code the user has never read. The `Task:` trailer *is* parsed (history.ts:262), which shows the machinery for trailer-derived attribution already exists.

*Why it matters:* For this user the interesting ownership question is not "which teammate wrote this" but "which of this did I write, which did an agent write, and how long ago" — that is the map of what they do and do not personally understand. Today that distinction cannot be drawn from any surface in the UI.


**[minor] `isType` is computed on every import edge and never read, so type-only imports inflate blast radius, fan-in and the "leans on N times" sentences**  
`G1-understand-codebase` · `broken`

> Producer: packages/reggie/src/graph.ts:903 `addEdge(s.file, target, kindFor("import"), ref.names, { isType: ref.isType })`, stored at :804. Consumers: `grep -rn "isType" src/*.ts ui/*.js | grep -v test` returns hits only in graph.ts, symbols.ts (where it is produced) — zero in views.ts, story.ts, serve.ts, map.js or …

`views.ts:928 impactView` builds its reachability sets from `allowedKinds(tests)` = {import, mod, ipc} with no `isType` filter, and `graph.ts:1022-1028` increments `inDegree`/`outDegree` for every non-`annotates` edge regardless of `isType`. So `import type { RepoGraph } from "./graph.js"` — which cannot break at runtime and compiles away — counts identically to a real dependency. This directly distorts the sentences a person reads: story.ts:1240 "X is the most relied-on file here: N other files use it", story.ts:1023 "A leans on B 41 times", and every node size on the map (spec §5.5: node size = fan-in). In this codebase most cross-module edges from story.ts and views.ts to graph.ts are …

*Why it matters:* The one number a person uses to decide whether a change is scary — how many things depend on this — is systematically overstated, and the fix is a filter over a field that is already on the wire.


**[minor] "Tested" means "a test file imports it", but the area sentence says "cover", and no test-run result is ever shown**  
`G1-understand-codebase` · `broken`

> Definition: packages/reggie/src/graph.ts:917-922 — `testedBy` is filled only when an edge of kind `tests` runs from a node with `role === "test"`. Honest wording at story.ts:1514: "graph.test.ts imports this file." Overstated wording at story.ts:1290: `${countPhrase(tests, "test file")} ${tests === 1 ? "covers" : …

Import-reachability is a reasonable proxy, but it counts a file as tested if any test imports it for any reason (a type, a constant, a helper) and counts it as untested if it is exercised only through an integration test, an end-to-end run, or a test that imports its barrel. Nothing anywhere reads a coverage report, a JUnit/lcov artifact or a test-run exit status: `grep` for coverage/lcov/junit across src/ finds nothing, and `.reggie/tasks/<slug>/evidence/` is surfaced only on the task page (story.ts:1795), never joined back to the file or area it proves. The Tests lens therefore colours a file by "is imported by a test", under a legend and a sentence that both say "cover".

*Why it matters:* "What is untested" is a G1 question, and the current answer conflates import edges with verification. A person deciding where an agent may safely refactor will read "two test files cover three of eight source files" as a coverage statement it is not.


---

## g2-understanding-changes

10 findings (2 blocker). Reggie's UI can tell you a change is happening, and it can tell you what a finished change touched, but it cannot show you the change itself. There is no diff surface anywhere in the product — not an endpoint, not a CLI verb, not a pixel: the only `git diff` calls in the codebase are `--name-only` (tasks.ts:417, git.ts:181) and one `--stat` that is pasted into a markdown file (packet.ts:27). The only awareness of "changed" is committed-on-a-task-branch: `branchChangedFiles` diffs `base...ref` (tasks.ts:416-422), and no code anywhere runs `git status`, so an agent editing files right now is completely invisible. What does exist and works well is the plan-versus-actual comparison for a *committed* branch — planned files badged "changed on branch" / "not changed yet", unplanned files called out, cross-task collisions named (board.js:2636-2668, story.ts:1708) — plus a genuinely good …


**[blocker] There is no diff, anywhere, at any granularity**  
`G2-understand-changes` · `absent`

> `grep -rn diff packages/reggie/src/*.ts` (non-test) returns only git.ts:175 diffStat, git.ts:181 changedFiles, tasks.ts:417 branchChangedFiles, packet.ts:27, serve.ts:1223/1311 (numstat sums). The route table at serve.ts:826-881 has no diff endpoint; `grep -n diff` over ui/*.js finds no diff renderer.

Nothing in the product can show a single changed line. The richest change data the API emits is CompletionDiff (serve.ts:1210-1216) — per-file added/deleted counts — and it is only emitted for tasks already in state 'done' (serve.ts:1301). `git diff --stat` is called exactly once, in packet.ts:27, and its output is embedded as a fenced code block inside packet.md, so it reaches the UI only as prose in the packet's `## Changes` section (board.js:128 PACKET_SECTIONS).

*Why it matters:* G2 is 'help the user understand the changes being made'. Reviewing what Claude Code or Codex actually wrote is the single most common thing a person does after an agent runs, and the UI cannot do it at all. Every review drops to the terminal or an external tool.


**[blocker] Uncommitted work — the entire window in which an agent is actually working — is invisible**  
`G2-understand-changes` · `absent`

> branchChangedFiles runs `git diff --name-only base...ref` (tasks.ts:416-422); resolveTask sets `changedFiles` only when a task branch exists (tasks.ts:578). No `git status`/`--porcelain` call exists in src/*.ts. The only occurrence of 'working tree' in src is a comment at tasks.ts:316.

`base...ref` is a merge-base diff of committed history. An agent that has been editing for forty minutes without committing produces zero changed files, zero blast radius, an unchanged risk-rule list, and a task page whose 'Files to touch' still says 'not changed yet' for every entry. The state machine has the same blind spot: `in-process` is reported as '<branch> has N commits ahead of <base>' (tasks.ts:521), which reads N=0 for a freshly claimed task whose worktree is full of edits.

*Why it matters:* The whole value of watching an agent is catching it in the act. Reggie's model of 'what changed' only turns on after the agent commits, which is exactly when it is too late to redirect cheaply.


**[major] The UI never refreshes itself — an open page is a snapshot from page load**  
`G2-understand-changes` · `broken`

> `grep -n 'setInterval|EventSource|visibilitychange|poll' ui/app.js ui/board.js ui/story.js ui/map.js ui/reader.js` returns exactly one hit: app.js:856, a Retry button calling `location.reload()` inside an error card. The client GET cache is 10 s (app.js:404-410) but is only consulted when something calls `api()`; the …

There is no timer, no server-sent events, no websocket, no focus/visibility listener, and no 'refresh' control in the chrome. Data is fetched on route change and after the user's own writes. So the staleness of a running agent's work is unbounded: leave a task page open and it will show the same thing an hour later. Combined with the two findings above, the real chain is: agent edits (invisible) → agent commits (invisible until the 10 s server task cache expires AND the user navigates) → user must manually re-navigate to see anything.

*Why it matters:* 'Understand the changes being made' is a present-tense verb. A page that cannot update cannot answer it, and worse, it answers confidently with old data — the user has no way to tell a stale page from a quiet repo.


**[major] Graph, history and facts are cached by the checkout's HEAD sha with no TTL, so they never see task-branch or uncommitted work**  
`G2-understand-changes` · `broken`

> RepoCtx.cached defaults to sha-keyed with no expiry (workspace.ts:270-281); graphOf (serve.ts:204), historyOf (serve.ts:170) and factsOf (serve.ts:166) pass no ttlMs. repoHistory runs `git log --numstat -M --since=… HEAD` (history.ts:214). buildGraph reads files from disk via listRepoFiles (graph.ts:789).

The graph is built from the working tree but cached against HEAD, so edits made without a commit never rebuild it — the map, symbol index, services, flows and hotspots keep describing the code as it was when the server first warmed. The history index is HEAD-only, so a `task/<slug>` branch's commits are absent from 'What happened recently' (story.ts:1107), from per-file history (serve.ts:1412), from hotspot/heat lenses, and from the Owners lens. completionCommits (serve.ts:1233-1242) knows this and shells out to `git log base..branch` directly as a special case — which is an admission that the rest of the system cannot see branch work.

*Why it matters:* The map is the user's mental model of the codebase (G1) and their sense of what a change touches (G2). If it silently describes a pre-agent snapshot, it is worse than no map: it will show a file as unimported or untested when the agent just changed that.


**[major] Journal and image evidence written inside a task worktree never reach the server**  
`G2-understand-changes` · `broken`

> readJournal walks `paths.journal` with readdirSync and never touches git (journal.ts:118-141). claimTask --worktree puts the agent in `path.join(root, '.worktree', slug)` (claim.ts:66) and appendJournal writes to that checkout's own `.reggie/journal` (paths.ts:51). evidenceRoute falls back to the task branch only when …

Reggie's own generated instructions tell the executor to `reggie claim <slug> --worktree` when other work is active (onboard.ts:150) and to save screenshots under evidence/ (onboard.ts:152). Both then land where the server cannot read them: the journal in a sibling checkout's directory tree, the screenshot on a branch whose binary fallback does not exist. The task page will render 'Nobody has recorded anything for this task yet' and 'never saved' (board.js:1785) for work that was in fact recorded and saved.

*Why it matters:* The journal is the only narrative Reggie has of what an agent did, and screenshots are the only evidence type that proves a UI change works. Both silently vanish under the exact workflow the product recommends.


**[major] Test results and review findings are not data — the evidence chain ends in a hand-ticked checkbox**  
`G2-understand-changes` · `absent`

> `grep -rn -i finding packages/reggie/src/*.ts packages/reggie/ui/*.js` (non-test) returns one hit: packet.ts:62, the literal placeholder '- (which review commands ran, what they found, and how each finding was resolved)'. `grep -i 'test result|testsPassed|junit|coverage'` over serve.ts and tasks.ts returns nothing.

parsePacketCriteria (tasks.ts:867-888) reads `- [x]` as pass and `- [ ]` as fail, with an `evidence:` line naming files. Nothing parses those files, checks that a named test log contains a pass, or relates a criterion to a suite. The packet's Reviews / Deviations / Discovered issues / Open risks sections are rendered as undifferentiated prose (board.js:128, board.js:1775 sectionsOf). The vision's promise — 'Quality is guaranteed by evidence, not by Reggie's judge scores' (docs/repo-manager-vision.md:145) — is currently a checkbox an agent ticks about its own work.

*Why it matters:* When the user asks 'did the tests pass', the honest answer the UI can give is 'an agent ticked a box and named a file'. That is not evidence, and it is the load-bearing claim of the whole Decide step.


**[major] Change attribution for merged tasks depends on a `Task:` commit trailer that nothing writes or asks for**  
`G2-understand-changes` · `risk`

> HISTORY_LOG_FORMAT reads `%(trailers:key=Task,valueonly)` (history.ts:121); completionCommits filters `historyOf(c).log` by `k.task === task.slug` (serve.ts:1234). `grep -rn 'Task: '` over src (non-test) finds no writer. claimTask commits `meta: claim ${slug}` with no trailer (claim.ts:85). The generated …

The only fallback is taskFromSubject (history.ts:271), which matches `task/<slug>` inside a commit subject — true for a merge commit, false for every hand-written subject. completionCommits does re-read `base..branch` directly, but only while the branch still exists (serve.ts:1235); after a normal merge-and-prune the Completed view falls back to 'Git has no commits carrying this task's trailer, so no diff can be attributed to it' (board.js:1856). The repo's own six branch commits carry no trailer, so this failure mode is the default, not the edge case.

*Why it matters:* The Completed view is the strongest change-understanding surface in the product, and its per-file +/- list will be empty for most real tasks. The fix is one line in the execute instructions plus a `-c trailer` on the packet commit; without it the surface silently degrades to nothing.


**[major] No activity feed: nothing answers 'what did the agents do while I was away'**  
`G2-understand-changes` · `absent`

> /api/timeline returns 501 (serve.ts:876-878). The Timeline route level renders 'Timeline pages are not in this release' (app.js:1994-2007). The only cross-task surface is recentSection: 5 journal entries plus 3 HEAD commits (story.ts:1104-1113). No 'last seen' / 'since you last looked' state exists anywhere (grep for …

The vision lists 'Timeline of work — what happened while I was away, who worked on what' as a catalog view (docs/repo-manager-vision.md:277). It is unbuilt. What stands in for it depends on hand-written journal entries: in this repo, `.reggie/journal/*/jacobpress-session.md` holds four files of 8-10 lines each — one entry per day, and today's entry has slug '-' (no task), so it would not appear on any task page.

*Why it matters:* Overnight and parallel agent work is the premise of the async pipeline (vision §Core loop). Without a merged, time-ordered feed of commits + journal + state transitions, coming back to the repo means reading git log in a terminal.


**[major] The in-process card offers nothing to inspect the change — only a clipboard escape to the terminal**  
`G2-understand-changes` · `friction`

> actionsFor, board.js:1423-1424: `case 'in-process': return [readButton(t,'plan','Read the plan'), branchButton(t), launchFor(t,'chat','Discuss')]`. branchButton copies the string `git switch task/<slug>` to the clipboard (board.js:1461). LAUNCH_MODES = chat|triage|plan|implement (launch.ts:11) — no review mode.

'Open the branch' is named as if it opens something; it copies a shell command. For the one state where a change is actively being made, there is no 'see what changed', no 'run the review', no 'stop this', and no way to open a session pointed at the diff. The detail panel kinds available (board.js:1568-1667) are intake, brief, plan, packet, completion and legacy — none of them describe in-flight work.

*Why it matters:* This is the exact moment the user wants to intervene. The UI's answer is a clipboard string, which means the Tasks page is a launcher and a status list rather than a place you can supervise from.


**[major] No way to comment on or push back on a plan — the only decision verb fires after the code is written**  
`G3-direct-agents` · `spec-drift`

> `.reggie/discussions/` is created by layout.ts:100 and named at paths.ts:52; `grep -rn discussion` over src/*.ts and ui/*.js finds no reader, writer, route or component. The only write verbs over HTTP are capture, note, decide, journal, triage, launch (serve.ts:1804). /api/decide accepts only 'approved' | 'needs-work' …

docs/repo-manager-vision.md:243-246 specifies anchored, attributed, append-only comments on plans and packets, with unresolved comments surfacing in the decision queue, and §Modes says solo still keeps comments as notes to self. None of it exists. The plan is readable (board.js:2632-2693 renders Problem, Approach, Files, Criteria, Verification, Assumptions, Out of scope, Bail conditions) but read-only: a user who disagrees with an approach must go re-plan it in a terminal session. There is no plan-level approve/reject at all — `planned` is derived from lint passing (tasks.ts:529-547), not from a human saying yes.

*Why it matters:* This is the answer to 'can they stop a change they disagree with early enough'. Today: they can read the plan, and then their only lever is a terminal. The cheapest possible intervention point — one comment on one plan section before any code is written — is the thing that is missing.


---

## g3-directing-agents

10 findings (1 blocker). The UI accepts free text in exactly six places, all of them short and none of them a specification of work: capture (one line + optional detail), a note (type/confidence/textarea, entity-keyed), a journal entry, a decision comment on a finished packet, the search palette, and a read-only field holding a command to copy. There is no way to write, edit, or even correct a brief or a plan from the UI: `handlePost` accepts exactly six routes (serve.ts:1804) and `ui-spec.md:247` states the design intent plainly — "writes only through `capture`, `addNote`, `decidePacket`, `appendJournal`". Briefs and plans render as read-only prose in a drawer (board.js:1629, board.js:1645). Launches carry zero user text: `POST /api/launch` takes only `{slugs, tool, mode}` (serve.ts:1956-1958) and the prompts are fixed string literals (launch.ts:96-146), so the moment a user has something specific in mind they …


**[blocker] A launch carries no user text at all**  
`G3-direct-agents` · `absent`

> serve.ts:1956-1958 reads only `slugs`, `slug`, `tool`, `mode` from the body. launch.ts:96-146: `chatPrompt`, `triagePrompt`, `planPrompt`, `implementPrompt` are fixed string literals built from slugs alone. board.js:1381-1396 `launchFor(t, mode, label)` passes `{slugs:[t.slug], mode, label}`.

Every button that starts an agent — Discuss, Plan it, Start, Shape these — produces a prompt that is a pure function of (slug, mode, tool). There is no textarea, no 'anything else the agent should know?', no way to attach an example, a reference file, a screenshot, or a constraint. The user clicks 'Plan it', a Terminal window appears, and the first chance to say what they actually want is typing into that terminal — at which point the UI has contributed nothing but a slug.

*Why it matters:* This is the moment of maximum leverage for G3 and the system spends it. A single free-text field appended to the prompt would carry more intent than the whole rest of the write surface combined, and the plumbing (argv-vector construction, launch.ts:202) would need one extra element.


**[major] The brief is never delivered to any agent — shaping is a dead end**  
`G3-direct-agents` · `broken`

> `grep -rn "briefFile|brief.md" packages/reggie/src/*.ts` (excluding tests) → read only at cli.ts:351 (`brief lint`), cli.ts:365 (`brief show`), triage.ts:69 (existence check) and tasks.ts:468 (state derivation). context.ts:32 reads `planFile` only. cli.ts:602-603 seeds the planner with the intake line.

Triage exists to shape intent before planning: Problem, Why now, Suspected area, Open questions, Not this (brief.ts:12). Every downstream consumer skips it. `buildContext` — the pack whose own docstring says 'everything an agent should read before touching an area' (context.ts:19-22) — assembles the plan, notes, related tasks, commits and journal, and never opens brief.md. `planningPrompt` (cli.ts:601-617) tells the model `Intake: <the raw one-line intake text>`. launch.ts:125 and the installed `/reggie-plan` command (onboard.ts:139-140) both instruct only 'run `reggie context <slug>` and read all of it'. `reggie_task` over MCP returns `renderTaskLine` + plan.md (mcp.ts:67-69). So a task …

*Why it matters:* This is the exact failure G3 names. The user does the work of saying what they are imagining, the system stores it in a contract-checked file, and then hands the agent the unshaped one-liner instead. Every planning session re-derives intent the repo already recorded, and the agent's 'Assumptions' section fills with …


**[major] The UI cannot write or edit a brief or a plan — by design**  
`G3-direct-agents` · `absent`

> serve.ts:1804 `const routes = new Set(["/api/capture", "/api/note", "/api/decide", "/api/journal", "/api/triage", "/api/launch"]);` — the complete POST allowlist. docs/ui-spec.md:247: 'writes only through `capture`, `addNote`, `decidePacket`, `appendJournal`… the server never writes source files.' board.js:1629 and …

There is no PUT/PATCH, no plan endpoint, no brief endpoint. `getTaskDetail` serves the full parsed brief and plan (tasks.ts:753-770) so the data is already on the client, but it is display-only. The task page (board.js:2524-2730) has State, Owner, Problem, plan sections, Risk, Blast radius, Packet and Journal — and its only interactive elements are 'Copy context pack', the blast-radius depth slider, evidence links, and the decide form. There is no note form and no capture form on the task page; the note form lives only in the story column of file and area pages (story.js:703). So on the single screen dedicated to one piece of work, the user can type nothing except a verdict comment after …

*Why it matters:* 'Give direction the agents understand exactly' means the user has to be able to put words into the artifact the agent reads. Today the artifacts the agent reads (brief.md, plan.md) are the two files the UI refuses to touch, and the artifacts the UI can write (intake line, note, journal) are the ones with the least …


**[major] 'Shape it' moves a card to Groomed on a brief that is entirely placeholders**  
`G3-direct-agents` · `broken`

> serve.ts:1946 `const r = scaffoldBrief(c.paths, { slug, author: person.handle });` — no title/area/size/risk/priority. brief.ts:53-83: every section but Problem renders a parenthesised hint; front matter is `size: unset`, `risk: unset`, `priority: unset`. board.js:69 defines Groomed as 'Shaped by triage: a problem …

State is derived from `brief.md` existing (tasks.ts:74), so scaffolding one flips the state. The scaffold fails `lintBrief` on at least four errors, but `lintBrief` is called from exactly one place in the codebase — cli.ts:353 — so nothing on the board knows. Plans get a `plan ✓ / plan ✗` badge from `planLintOk` (board.js:1272-1273); briefs get no equivalent. The mitigation that exists is one grey chip reading 'brief not filled in' (board.js:1340), shown only when both priority and size are unset. Meanwhile the CLI's `reggie triage` accepts `--title --area --size --priority` (cli.ts:156-159) and the UI exposes none of them.

*Why it matters:* The one-click path advertises that shaping happened when nothing was decided. A user who trusts the board will hand a planner a task marked Groomed whose brief contains five parenthesised hints — worse than no brief, because the state machine now says the thinking is done.


**[major] Open questions are parsed, shipped to the client, and never surfaced as answerable**  
`G3-direct-agents` · `absent`

> brief.ts:35 and 151 parse `## Open questions` into `questions[]`; tasks.ts:696 and 820 put it on `TaskBriefDetail`; serve.ts taskRoute ships it. `grep -n "questions" packages/reggie/ui/*.js` → only board.js:1613, the BRIEF_ORDER string array. Nothing reads `.questions`.

The brief contract makes Open questions a first-class section — 'each question whose answer would change the shape of the work' (brief.ts:77) — and the triage prompt instructs the agent that 'Anything you cannot answer becomes an Open question' (launch.ts:116, onboard.ts:128). The structured array reaches the browser and is thrown away; the questions render as an anonymous prose block among four others. There is no answer control, no badge counting unanswered questions, no filter for 'tasks blocked on me', and no endpoint that could record an answer if one existed. The user's only route is to open brief.md in an editor or start a Discuss session and hope the agent writes it down.

*Why it matters:* An agent asking a question is the highest-signal direction request in the whole system — it is the agent saying exactly where its model of the user's intent has a hole. The system generates these, stores them, transmits them, and drops them on the floor.


**[major] The vision's entire discussion model is absent — no comment can be anchored to anything**  
`G3-direct-agents` · `absent`

> docs/repo-manager-vision.md:243-247 ('Every plan and packet carries a discussion thread… anchored to a plan section, an acceptance criterion, a file in the blast radius… Plans have versions. A revision keeps the thread'), and decision line 30. No matching endpoint in serve.ts:1804, no data type in src/*.ts, no UI. …

There is no way to comment on a plan section, on an acceptance criterion, on a file in the blast radius, or on a node in the map. The nearest thing is the entity-keyed note, which anchors to a file or a line but not to a plan, a criterion, or a task; and the packet decision comment, which anchors to a whole finished packet. Plan versioning does not exist either — `plan.md` is a single file with no thread, so 'correct a wrong assumption mid-flight' has no mechanism at all. `.reggie/discussions/` was created for exactly this and has been empty since onboard.

*Why it matters:* Anchored comment threads are the standard mechanism for 'the agent understood X, I meant Y, here on line 3'. Without them, every correction is a fresh terminal session with fresh context, and the correction is not recorded anywhere the next agent will read.


**[major] The generated instruction block both agents auto-load describes the decommissioned Tauri app**  
`G3-direct-agents` · `broken`

> AGENTS.md:11 'a desktop workspace and agent system that turns messy notes into shipped code'; AGENTS.md:15 'Entry points: `src-tauri/src/main.rs`, `src/main.tsx`'; AGENTS.md:19-23 dev/build/test/preview/tauri. Generated 2026-09-09. Contradicted by CLAUDE.md's own curated Decisions line: '2026-09-06: Reggie becomes a …

`collectFacts` reads the root package.json and the whole tree, so the block advertises the v2.2.0 Tauri product. `reggie serve`, the CLI, the MCP server and the entire UI live under packages/reggie and are named nowhere in the generated block. An agent starting cold in this repo is told the entry points are a Rust main.rs and a React main.tsx and that `npm run dev` starts vite. The `## Where information lives` and `## Working here` sections (AGENTS.md:25-36) are correct and useful — the repo facts around them are not. AGENTS.md also carries no Conventions, Decisions, or Gotchas of its own: line 6 says 'Same as CLAUDE.md. Read its Conventions, Decisions, and Gotchas sections', which Codex …

*Why it matters:* This is the only channel that reaches an agent before the user types anything, and on this branch it is wrong about what the repo is. Every Codex session in particular starts with a false model of the codebase and none of the four Conventions or three Gotchas the human author wrote down.


**[minor] The plan contract has no place for the user's questions — it converts them to agent assumptions**  
`G3-direct-agents` · `spec-drift`

> plan.ts:7-16 PLAN_SECTIONS = Problem, Approach, Files to touch, Acceptance criteria, Verification strategy, Assumptions, Out of scope, Bail conditions — no 'Open questions'. plan.ts:76: '(every question you would have asked, with the answer you chose and the alternative)'. cli.ts:612 repeats it. …

The contract is well built for its actual job — making execution mechanical — and every check reflects that: criteria must be ≥15 chars and checkable (plan.ts:186), vague wording warns (plan.ts:156, 187), verification must name evidence per criterion (plan.ts:194). None of it checks that the user was consulted. `deciders` exists in front matter and in `PlanMeta` (plan.ts:23, 101-107) and is never linted, never computed, and never populated by anything (`grep -rn deciders src/` shows no writer; story.ts:810-815 derives an unrelated display value). So the plan captures what an agent needs to execute, records the questions it declined to ask as choices it made unilaterally, and passes the …

*Why it matters:* G3 is about the agent understanding what the user is imagining. A contract that instructs the model to answer the user's questions on the user's behalf and file them under 'Assumptions' is a contract that structurally routes around the user.


**[minor] `/reggie-plan <slug> [one-line problem]` is documented but corrupts every path it touches**  
`G3-direct-agents` · `broken`

> onboard.ts:135 `description: Plan a task in plan mode against Reggie's plan contract. Usage: /reggie-plan <slug> [one-line problem]`, then onboard.ts:139-142 use `reggie context $ARGUMENTS`, `reggie plan new $ARGUMENTS`, and `` `.reggie/tasks/$ARGUMENTS/plan.md` ``.

`$ARGUMENTS` expands to the entire argument string. Following the documented usage — `/reggie-plan fix-login the modal should not close on outside click` — yields `reggie context fix-login the modal should not close on outside click` (extra positional args), `reggie plan new 'fix-login the modal…'` (fails `requireSlug`), and a write target of `.reggie/tasks/fix-login the modal should not close on outside click/plan.md`. The same file installs `/reggie-triage` correctly with `Slugs: $ARGUMENTS` for a slug list; only the plan command invents an optional prose argument its body cannot handle. Note this is the single documented mechanism anywhere in the product for handing a planner a sentence …

*Why it matters:* The one advertised way to attach freeform intent to a planning run is broken, and it fails by writing to a garbage path rather than erroring cleanly — so the user's sentence disappears and no plan appears where anyone will look for it.


**[minor] MCP exposes no brief tool and no brief linter**  
`G3-direct-agents` · `absent`

> mcp.ts:44-227 registers reggie_tasks, reggie_task, reggie_context, reggie_find_notes, reggie_add_note, reggie_journal, reggie_capture, reggie_plan_new, reggie_lint_plan, reggie_people. mcp.ts:67 `const plan = readText(planFile(c.paths, slug));` — reggie_task reads the plan only. Resources are reggie://readme, …

`.mcp.json` wires this server into every Claude Code session in the repo, and AGENTS.md:36 tells Codex to register it. An agent that follows the generated instruction 'Prefer its tools over re-deriving state' can list tasks, read a plan, scaffold a plan, lint a plan, read the intake, read notes and write notes — and has no tool that returns a brief. `reggie triage` and `reggie brief lint` have no MCP equivalent either, so the shape step is CLI-only for agents as well as for the UI.

*Why it matters:* MCP is the stated 'seamless switching' mechanism between Claude Code and Codex (vision:52). A tool surface that omits the shaping artifact guarantees both tools plan from the intake line, which is exactly the blocker above reproduced at a second layer.


---

## liveness-loop

10 findings (2 blocker). The Reggie UI is a snapshot viewer, not a live view. There is no file watcher, no SSE, no WebSocket, and no post-boot polling anywhere in the server or the client — I grepped `src/` and `ui/` for `EventSource|WebSocket|setInterval|fs.watch|chokidar|watchFile|text/event-stream` and the only hit is `ui/dev/reader-harness.html:175`, a dev harness. Freshness comes entirely from two caches: `RepoCtx.cached()` (workspace.ts:270-281) keyed on `git rev-parse HEAD` (re-read at most once per second, workspace.ts:260-267), and a 10 s TTL (`STATE_TTL_MS`, serve.ts:79) layered on the sha for state that changes without a commit — tasks, notes, journal, people, story context. Everything expensive and everything visual — `graph` (serve.ts:204), `history` (170), `symbolIndex` (299), `services` (322), `flows` (330), `facts` (165), all the view payloads — is sha-only, so uncommitted working-tree edits …


**[blocker] An agent's uncommitted work is invisible to the UI forever**  
`G2-understand-changes` · `absent`

> packages/reggie/src/workspace.ts:270-281 (cache key = headSha); serve.ts:204-206 `c.cached("graph", …)` with no ttlMs; serve.ts:165,170,299,322,330 same for facts/history/symbolIndex/services/flows

Every visual and structural payload is keyed on the committed HEAD sha. An agent editing files in the working tree does not move HEAD, so `graphOf`, `symbolIndexOf`, `servicesOf`, `flowsOf`, `factsOf` and every view built from them return the build from server start, indefinitely. I confirmed there is no second key: `cached()` compares `slot.sha === sha` and an optional `now - slot.at < opts.ttlMs`, and the sha-only callers pass no ttlMs. The server also never reads uncommitted state at all — enumerating the git subcommands in src/ gives log, ls-files, ls-tree, diff (only ever as `base...ref`, git.ts:176,181 and tasks.ts:417), rev-parse, rev-list, show, show-ref, for-each-ref, symbolic-ref. …

*Why it matters:* G2 is 'help the user understand the changes that are being made'. The single most common state of an agent-driven repo — a session mid-flight with edits on disk and nothing committed — produces exactly zero change in the UI. The map, the story, the symbol search and the services pages all describe a repo that no …


**[blocker] No file watching, no SSE, no WebSocket, no post-boot polling**  
`G2-understand-changes` · `absent`

> `grep -rn "EventSource|WebSocket|setInterval|fs.watch|chokidar|watchFile|text/event-stream" packages/reggie/src packages/reggie/ui` → one hit, ui/dev/reader-harness.html:175. ui/app.js:2296-2298 is the entire post-boot event surface.

After `boot()` runs `await waitForStatus(); await render(currentRoute())` (ui/app.js:2297-2298), the only thing that causes another fetch is a `hashchange` — i.e. the user clicking a link. I checked board.js, story.js, map.js and reader.js for timers: every `setTimeout` found is animation, resize-settling or scroll-guard (map.js:2025,2056,2082,2363,2974,3096,3542; reader.js:293,573,605; story.js:1084; board.js:760). There is no `visibilitychange` or `focus` revalidation either. A user who leaves the Repo page open while an agent works sees a frozen page until they navigate or reload.

*Why it matters:* The feedback loop the user is asking for — watch the agent work, see what it touched — does not exist as a loop. The page is a report generated once at page load.


**[major] No refresh control and no freshness indicator anywhere in the UI**  
`G2-understand-changes` · `absent`

> ui/index.html:91-115 (the whole header: brand, crumbs, nav, Search, lens radiogroup, Dense, repo-switcher — no refresh, no branch, no sha, no timestamp). `grep -rn "Refresh|Reload|location.reload" ui/*.js` → only ui/app.js:856, a 'Retry' button inside the error card.

`/api/facts` returns `branch` and `headSha` (serve.ts:886-887) and `/api/status` returns `headSha` (serve.ts:978), but no UI file renders either — `grep -rn "\.branch\b|headSha" ui/*.js` returns only board.js:1451,2574, which are *task* branches. `waitForStatus()` receives the status object and discards it (ui/app.js:901, 2297). The only branch text a reader ever sees is the Repo-level subtitle (story.ts:800-801) and the workspace tile chip (story.ts:1846). So the page cannot say what it is a picture of, and the user has no way to ask for a new picture short of Cmd-R.

*Why it matters:* Combined with the two findings above, a stale page is indistinguishable from a fresh one. For G1 and G2 both, the user has no way to know whether the map they are reasoning from reflects the repo as it is now.


**[major] After the first commit, the warm-up card never returns and the server hard-blocks on the rebuild**  
`G2-understand-changes` · `broken`

> serve.ts:936-941 `const existing = warmups.get(c); if (existing) return existing;`; serve.ts:976-979 statusRoute returns `warmup.done`; git.ts:33 `spawnSync`; launch.ts:234-236 comment: "because the server is single-threaded that would block every other request too"

`warmupOf` stores the Warmup in a WeakMap keyed by RepoCtx and short-circuits on any later call. `c.invalidate()` (workspace.ts:291-297) clears the data cache but does not touch `warmups`, and neither does a HEAD move. So once `warmup.done` is true it is true forever: `/api/status` keeps answering `ready:true` while every cache is actually cold. The staged, one-per-tick build that exists specifically so the 'Reading the repo' card can be shown (serve.ts:930-935) only ever runs once, at first boot. Every subsequent cold rebuild happens inside whatever data route is unlucky enough to be first, synchronously — `spawnSync` for git and `readFileSync` for every code file — with no card, no …

*Why it matters:* On a repo where the history pass costs seconds, every commit an agent makes turns the next click into a silent multi-second freeze of the entire UI, with no explanation. The mechanism to explain it was built and then made unreachable.


**[major] Cold history build is superlinear and was calibrated on a 356-commit repo**  
`G1-understand-codebase` · `risk`

> Measured: `git -c core.quotePath=false log --numstat -M --format=… --since=365.days HEAD` = 0.168 s in this repo (356 commits/372 tracked files) and 3.093 s in ~/Desktop/Projects/RetroFantasy (1268 commits/633 files, 6553 lines / 330 KB output). Spec ground truth: packages/reggie/docs/ui-spec.md:5 records "`git log …

0.48 ms/commit at 356 commits becomes 2.4 ms/commit at 1268 commits — 3.6x the commits cost 18x the time, because numstat cost tracks tree size as well as commit count. history.ts:212-219 runs this as one blocking `spawnSync` per HEAD sha, and the disk cache at `.reggie/.cache/history-<sha>.json` is keyed by that same sha (history.ts:184,616), so it never survives a commit — only a server restart. `deriveHistory` then walks every commit × every changed file × every ancestor directory. Neither ui-spec.md nor ui-implementation-plan.md states any performance budget: grepping both for `seconds|budget|perf|slow|large repo|monorepo` returns nothing.

*Why it matters:* The largest repo I could measure is 633 files. On a real product monorepo (10k+ files, 10k+ commits/year) the cold build extrapolates to tens of seconds, paid again on every single commit, on a single-threaded server with no progress card (see the previous finding). That is the difference between a tool you leave open …


**[major] The UI cannot follow an agent working in a git worktree — the vision's own default setup**  
`G2-understand-changes` · `absent`

> `grep -rn worktree packages/reggie/src` → only claim.ts:64-71,140-143 (create/remove) and cli.ts:397-401 (the flag). No `git worktree list` anywhere. facts.ts:78-98 puts `.worktree` in IGNORED_SEGMENTS. docs/repo-manager-vision.md:28 and :100 make worktrees the normal execution model ("One session, one worktree, one …

`reggie serve` binds one `RepoCtx` per repo root (serve.ts:706, workspace.ts:318-332) and every git call runs with `cwd: this.root`. `git rev-parse HEAD` in the main checkout reports the main checkout's HEAD. I confirmed the topology here: `git worktree list` shows `…/reggie b0a04fb [main]`, `…/.worktree/onboard-trial [onboard-trial]`, `…/.worktree/repo-manager 0630543 [repo-manager]`. The workspace CLAUDE.md at ~/Desktop/Projects/Reggie Workspace/CLAUDE.md lists `./reggie` — the main checkout. So a server started against this workspace would describe `main` at b0a04fb and show none of the six-commit repo-manager branch, with no indication that another worktree exists. The `.worktree` …

*Why it matters:* G2 and G3 both assume the UI is looking at the same code the agent is editing. In the workflow this repo itself uses and this branch documents, it is looking at a different commit on a different branch, silently.


**[major] POST /api/launch always starts the agent in the repo root, never in the task's worktree**  
`G3-direct-agents` · `broken`

> serve.ts:1962 `return json(res, 200, launchSession({ repo: c.root, ...parsed.value }));`; launch.ts:216-232 `plan.cwd = path.resolve(input.repo)`; claim.ts:64-71 creates the worktree at `path.join(root, ".worktree", slug)`

`reggie claim <slug> --worktree` puts the task branch in `.worktree/<slug>`. The launch route has no knowledge of it: it passes `c.root` unconditionally, and launch.ts builds `cd <root> && claude '/reggie-execute <slug>'`. So clicking Implement on a task whose branch is checked out in a worktree starts the session in the main checkout, on whatever branch happens to be there. Nothing comes back either — `LaunchResult` is `{launched, command, reason?}` (launch.ts:41-46); no pid, no session id, no way for the UI to know the session started, is running, or finished.

*Why it matters:* G3 is 'give direction to the agents so they understand exactly what the user is imagining'. Directing a session into the wrong directory is a direction failure at the mechanical level, before any prompt quality question arises. And the launch being fire-and-forget means the direction loop has no return path at all.


**[major] Only writes made through the UI's own POST routes refresh the expensive caches**  
`G2-understand-changes` · `broken`

> serve.ts:1863,1885,1904,1928,1950 `c.invalidate()` — the only invalidation calls in src/, all inside handlePost; workspace.ts:291-297 (no-arg invalidate clears the whole map and the sha)

Adding a note from the web form clears every cache, so the browser that did it sees a rebuilt graph. The same note written by an agent through `reggie_note` over MCP (a different process, mcp.ts:40) or by `reggie note` on the CLI reaches the server only through the 10 s TTL on `notesOf`/`notesIndexOf` (serve.ts:174,178) — which refreshes the notes *list* but not the `graph` that joined those notes into node `knowledge` (graph.ts builds knowledge from `opts.notes`, serve.ts:205). So an agent-written note appears in the story text within ~10 s but never recolours the Knowledge lens until HEAD moves. Symmetrically, a second person's browser sees nothing from the first person's POST. There is …

*Why it matters:* Multiple simultaneous sessions and multiple people are explicit goals of the vision (docs/repo-manager-vision.md:34). The cache is coherent only for the single browser tab that happens to be doing the writing.


**[major] No surface for work in flight; the only diff is a summary of a task already finished**  
`G2-understand-changes` · `absent`

> `grep -rn -i diff packages/reggie/ui/*.js` → the only data-bearing hits are ui/board.js:1795,1826-1856. serve.ts:1252-1268 completionDiff; serve.ts:1231-1240 completionCommits. tasks.ts:575 lastActivity = branch committer date; tasks.ts:238-244 `ageInDays` floors to whole days.

The Completed view of a *done* task renders a table of files with `+added −deleted` and totals across commits (board.js:1854). That is the entire change-comprehension surface in the product. There is no line-level diff, no 'what changed since I last looked', no highlighting of recently-touched nodes on the map beyond the Heat lens (which is commits-in-30-days from the sha-frozen history index), and nothing at all for an in-process task. The freshest signal a running session produces is the board card's age, computed from the branch's last commit date and floored to whole days — so a session that committed 30 seconds ago and one that committed 20 hours ago both read '0 days'.

*Why it matters:* G2 asks the UI to help the user understand the changes being made — present tense. What exists answers 'what did this finished task change', past tense, at file granularity, only after a merge or packet.


**[minor] Spec drift: the vision specifies a daemon that watches files; nothing watches anything**  
`foundation` · `spec-drift`

> docs/repo-manager-vision.md:48 — "reggie daemon (TypeScript): serves the UI, exposes the MCP server, watches files, builds graphs, composes episodes, drains the inbox, syncs metadata through git." versus the grep in finding 2.

Of that list, `serve` and `builds graphs` exist. The MCP server exists but as a *separate process* (`reggie mcp`, cli.ts:563-568, stdio transport at mcp.ts:40-42), not inside the daemon — so the two have no shared cache and no IPC. "Watches files" was never built. Meanwhile packages/reggie/docs/ui-spec.md, ui-api-contract.md, ui-implementation-plan.md, tasks-page-spec.md and services-and-flows-spec.md contain no liveness requirement whatsoever — grepping all five for `live|watch|refresh|poll|real-time|SSE|reload` returns only unrelated words ('stale note', 'without a reload' at tasks-page-spec.md:110,117). The UI was specified as a static guidebook, and it was built exactly to that spec.

*Why it matters:* This is the root cause of the whole dimension: liveness was in the product vision but fell out of the UI specs, so no implementation gap was ever visible. Nothing will improve here until a liveness contract is written into ui-api-contract.md.


---

## codex-parity

10 findings (0 blocker). Real parity work exists at the edges: the state layer under `.reggie/` is genuinely tool-neutral, the MCP server (packages/reggie/src/mcp.ts:40) is stdio and tool-agnostic, `detectTool` attributes writes to Claude or Codex (src/journal.ts:21), `reggie plan prompt` prints interactive and headless invocations for both tools (src/cli.ts:322-334), and every launch button in the UI offers both tools (ui/board.js:132, 1196). The parity breaks in the middle layer — the instructions each tool actually receives. `renderGeneratedBlock` (src/docs.ts:11) emits a block that is nearly identical for both tools and carries the state layout and the CLI verbs, but it carries no procedures: `/code-review`, `/security-review`, `/simplify` and plan mode appear in exactly one agent-visible file, `.claude/commands/reggie-execute.md`, which only Claude Code loads. Codex's execute prompt (src/launch.ts:136-146) …


**[major] Codex sessions run no review at all — the entire risk-class review policy is missing from the Codex execute prompt**  
`G2-understand-changes` · `absent`

> packages/reggie/src/launch.ts:136-146 (implementPrompt) vs .claude/commands/reggie-execute.md:10 / packages/reggie/src/onboard.ts:154

I read implementPrompt end to end. Its steps are: run context, claim, execute the plan and record deviations, save evidence, write notes and journal entries, capture unrelated problems, run `reggie packet` and commit. There is no step 4. The Claude command file has one: "Reviews by risk class (from the plan's front matter): low, run the repo's own checks; medium, also run `/code-review`; high, also run `/security-review` and have a second pass execute the tests. Run `/simplify` when the diff is large. Resolve findings before continuing." Risk class is computed for both tools (`reggie plan risk`, src/cli.ts:309) and stored in the plan front matter, but for a Codex session it is a label with …

*Why it matters:* The user's G2 is understanding the changes being made. A high-risk auth or schema change implemented from the Tasks board with the tool switch set to Codex gets zero review — no code review, no security review, no second pass executing the tests — and produces a completion packet that looks identical to a reviewed …


**[major] No capability map exists; the borrowed procedures are invisible to every agent except a Claude session running /reggie-execute**  
`G3-direct-agents` · `absent`

> `grep -rn "/code-review" --exclude-dir=node_modules --exclude-dir=.git .` — agent-visible hits are only .claude/commands/reggie-execute.md:10 and its source packages/reggie/src/onboard.ts:154. `grep -rn "capabilit" packages/reggie/src/` returns nothing.

The vision's central parity mechanism (docs/repo-manager-vision.md:138-139) is "the review policy that names which borrowed skill runs at each risk class, per tool" plus "a capability map per tool: one step resolves to `/code-review` in Claude Code and to Codex's equivalent, with a small fallback prompt where a tool has no native command." Neither exists as code or config. `renderGeneratedBlock` (src/docs.ts:27-53) — the only text guaranteed to reach both tools in every session — names `reggie note add`, `reggie context`, `reggie plan lint`, `reggie journal add`, `reggie capture` and the state derivation, but never mentions a review command, a risk class, plan mode, or `/init`. CLAUDE.md:7 …

*Why it matters:* This is the difference between the vision's claim ("Codex parity becomes a mapping problem, not a porting problem", vision:147) and the branch's reality: there is no map. Every place that resolves a step to a tool-specific command is hand-written prose duplicated between onboard.ts's COMMANDS strings and launch.ts's …


**[major] Claude's triage launch sends a slash command that does not exist in this repo**  
`G3-direct-agents` · `broken`

> packages/reggie/src/launch.ts:154 returns `/reggie-triage ${slugs.join(" ")}`; `ls .claude/commands/` shows only reggie-capture.md, reggie-execute.md, reggie-onboard.md, reggie-plan.md; `git ls-files .claude` confirms the same four.

onboard.ts:119 defines reggie-triage.md and onboard.ts:164 defines reggie-chat.md, but `installProjectCommands` uses `writeIfMissing` (onboard.ts:180) and this repo was onboarded before those two were added, so they were never installed. The board's "Shape these in a session" control (ui/board.js:1939-1941, mode "triage") and every per-card triage launch therefore hand a Claude Code session `/reggie-triage <slug>`, an unknown command. The Codex path works, because triagePrompt (launch.ts:107-119) is spelled out inline. Parity is inverted here: Codex behaves correctly and Claude does not.

*Why it matters:* The user's own repo is the demo. Clicking "Shape these" with the default tool (claude, ui/board.js:588) opens a session that does nothing, while the same button with Codex selected works — the opposite of what the vision promises, and a failure the UI does not report because launchSession only reports whether Terminal …


**[major] Codex implement prompt omits the decision step — no `reggie pr`, no `reggie decide`**  
`G2-understand-changes` · `spec-drift`

> packages/reggie/src/launch.ts:144 ("Finish with `reggie packet ${slug}`, fill every section honestly, and commit.") vs packages/reggie/src/onboard.ts:156

The Claude command's step 6 continues past the packet: "Open a PR whose body is the packet (`reggie pr $ARGUMENTS`), or in solo mode ask the user to decide with `reggie decide`." implementPrompt stops at commit. Task state "awaiting-decision" is derived from an open PR (see the generated block, CLAUDE.md:45, and TASK_STATES in src/tasks.ts:14-15), so a Codex-implemented task stays "in-process" indefinitely and never appears in the user's decision queue. Neither `reggie pr` nor `reggie decide` is exposed as an MCP tool either (src/mcp.ts registers only 10 tools), so there is no second route to the same outcome.

*Why it matters:* The vision's whole asynchronous premise is that tasks park in awaiting-decision and the human decides from the UI, a packet, or a PR (vision:106-108). Work done in Codex never parks — it just sits, and the board shows it as still in progress.


**[major] AGENTS.md's curated half is a pointer, so the repo's real rules — including one whose violation breaks the user's installation — never reach a Codex session**  
`G1-understand-codebase` · `absent`

> AGENTS.md:6 ("Same as CLAUDE.md. Read its Conventions, Decisions, and Gotchas sections") vs CLAUDE.md:6, CLAUDE.md:7, CLAUDE.md:14; template at packages/reggie/src/docs.ts:137

Codex loads AGENTS.md automatically; it does not load CLAUDE.md. CLAUDE.md's curated section carries four conventions, two decisions, and two gotchas that AGENTS.md does not restate: the worktree rule at CLAUDE.md:6 ("Develop the `repo-manager` branch in a git worktree, never by checking it out in the main clone: `~/.claude/*` symlinks point into this repo's `resources/`"), the borrow-procedures rule at CLAUDE.md:7, and the gotcha at CLAUDE.md:14 (`npm install` in packages/reggie needs `--legacy-peer-deps`). The template's own placeholder concedes the design is manual: "(keep in sync with CLAUDE.md, or make CLAUDE.md a symlink to this file)" (docs.ts:137). `checkGeneratedBlock` …

*Why it matters:* G1 is the user understanding the codebase, and the same mechanism is how an agent understands it. A Codex session here can check out repo-manager in the main clone and break the ~/.claude symlinks the user's whole Reggie install depends on, because the one line warning against it is in a file Codex was never given. …


**[major] The MCP surface is a small subset of the CLI, so "the same state through the same MCP server" only really covers reading**  
`G3-direct-agents` · `absent`

> packages/reggie/src/mcp.ts registers 10 tools (lines 44, 58, 73, 93, 108, 130, 156, 171, 195, 213); `grep -n '.command(' packages/reggie/src/cli.ts` lists ~33 CLI verbs

MCP exposes tasks, task, context, find_notes, add_note, journal, capture, plan_new, lint_plan, people. Absent: triage, brief lint/show, plan risk, claim, release, packet, decide, pr, note stale, note path, services, flows, launch, docs refresh/check. Every state transition after planning — claim, packet, decide, pr — is reachable only by shelling out to the `reggie` binary. The vision states the opposite intent: "A handful of thin commands for humans... Everything else is an MCP tool the model calls" (vision:141). This hits both tools equally, but it lands harder on Codex: the branch's own recommended headless Codex invocation is `codex exec -s read-only` (cli.ts:333), a sandbox where the …

*Why it matters:* For G3, the user directs agents through the board, and the board's buttons resolve to prompts that tell the agent to run CLI verbs. Anywhere the agent's environment restricts shell execution — sandboxes, permission prompts, a `reggie` binary not on PATH — the whole loop degrades to reading, and neither tool has a …


**[minor] Codex plan prompt omits the commit/plan-branch step, so a Codex-planned task never reaches "planned" in team mode**  
`G3-direct-agents` · `spec-drift`

> packages/reggie/src/launch.ts:122-133 (planPrompt) vs packages/reggie/src/onboard.ts:142 (reggie-plan.md step 5); state derivation at packages/reggie/src/tasks.ts:539-546

The Claude command has step 5: "Solo mode: commit the plan to the default branch. Team mode: commit on a `plan/$ARGUMENTS` branch and open a draft PR so others can comment on the plan lines." planPrompt has no commit instruction at all — it ends at lint plus a journal entry. tasks.ts:539-546 reads: if only a local plan exists, `planLintOk && snap.mode === "solo"` gives "planned" with the reason "solo mode counts it as planned until committed"; otherwise team mode gives "groomed" with "team mode needs it merged or on a plan/ branch". Solo mode masks the omission entirely; team mode strands the task. planPrompt also never says "plan mode" while reggie-plan.md (onboard.ts:139) says "Enter plan …

*Why it matters:* The board's state columns are the user's view of where work stands (G2). A team-mode repo where one person plans in Codex silently accumulates tasks stuck in Groomed with a finished plan on disk, and the reason string blames the mode rather than the missing instruction.


**[minor] Codex MCP registration is never automated and never verified; the instruction to register is delivered inside the session that needs it**  
`foundation` · `friction`

> packages/reggie/src/onboard.ts:83-100 (ensureMcpConfig writes .mcp.json) and packages/reggie/src/docs.ts:23-25 (the Codex branch is prose only); packages/reggie/src/cli.ts:99

`ensureMcpConfig` writes `.mcp.json` into the repo and returns a boolean; onboard reports "Configured the reggie MCP server in .mcp.json (Claude Code). For Codex: codex mcp add reggie -- reggie mcp" (cli.ts:99). Nothing writes or checks a Codex-side config, and there is no `.codex` path in RepoPaths (src/paths.ts:39-58) — `find . -name .codex` finds none. The generated AGENTS.md line the Codex agent reads (AGENTS.md:36) instructs it to run `codex mcp add`, which is circular: the session is already running without the tools, and `codex mcp add` is a global registration, not a repo-scoped one, so the per-repo state Claude gets from a committed `.mcp.json` has no Codex equivalent. …

*Why it matters:* A teammate who clones the repo and opens Codex gets a session with no Reggie tools, no signal that anything is missing, and an AGENTS.md instruction it cannot usefully act on. The Claude path is one committed file; the Codex path is tribal knowledge.


**[minor] No onboard launch mode: /reggie-onboard is Claude-only and Codex onboarding is a hand-typed one-liner in a doc**  
`G1-understand-codebase` · `absent`

> packages/reggie/src/launch.ts:11 (LAUNCH_MODES = chat, triage, plan, implement); packages/reggie/src/onboard.ts:103 (reggie-onboard.md); docs/getting-started.md:53-54

onboard.ts:103-118 defines a detailed six-step onboarding command for Claude — replace the placeholder `_repo` note, write `_dir.md` notes per source folder, write store:/service:/env: entity notes, fill the curated CLAUDE.md sections, journal it. Codex's only path is getting-started.md:54: `codex "Read .reggie/ONBOARDING.md and do what it says."` The brief itself (renderOnboardingBrief, onboard.ts:185-232) is tool-neutral and good, but its step 4 says "Fill Conventions, Decisions, and Gotchas above the generated block. Keep AGENTS.md in step, or symlink one to the other" (onboard.ts:216) — leaving the sync problem to the agent. Neither the UI nor `reggie launch` offers an onboarding …

*Why it matters:* Onboarding is where the notes that power G1 get written. If only Claude has a first-class path to write them, the quality of the repo's understanding depends on which tool the user happened to open, which is precisely the switching cost the vision set out to remove.


**[minor] "The generated block is identical in both files" is asserted in three places and is false; nothing in CI checks the two files agree**  
`foundation` · `spec-drift`

> AGENTS.md:3, packages/reggie/src/docs.ts:134, docs/information-paradigm.md:75 all assert identity; packages/reggie/src/docs.ts:22-25 and docs.ts:49 make it per-tool. .github/workflows/ci.yml (read in full, lines 1-60) has no packages/reggie job and never runs `reggie docs check`.

The blocks differ by exactly two lines — the `## Working here with Reggie and Claude Code` / `and Codex` heading, and the MCP registration sentence. The per-tool difference is deliberate and correct; the claim of identity is the drift. It matters because it invites the obvious verification (diff the two files, or symlink one to the other, as docs.ts:137 suggests) and both would be wrong: a symlink would hand Codex the Claude MCP instruction. Separately, `reggie docs check` exists and works (cli.ts:115-131, checking both files) but is not run anywhere automatically — the only CI jobs are the old Tauri frontend (npm ci + tsc + npm test at repo root), a Rust backend matrix on src-tauri, and a …

*Why it matters:* The two-file design only holds if something enforces it. Today the enforcement tool exists, is unused, and the docs describe a stricter invariant than the code implements — so drift between the tools' instructions is both possible and undetectable, which is how the review-policy gap survived three commits.


---

## quality-risk

10 findings (0 blocker). The v3 package has a genuinely strong server-side test suite — 471 `it()` blocks across 22 test files, including a 65 KB `test/serve.test.ts` that exercises all 30 HTTP routes, plus deliberate security tests for DNS rebinding, path traversal and shell quoting. That suite has never run in CI: `.github/workflows/ci.yml` still installs and tests only the decommissioned Tauri app at the repo root (`npm ci`/`npx tsc --noEmit`/`npm test` at lines 22-24, plus a three-OS Rust clippy+test matrix at lines 45-46), and no workflow references `packages/` at all. The 12,133 lines of live UI JavaScript in `ui/*.js` have zero automated tests of any kind — no jsdom, no Playwright, no `.test.js` — while 20,923 lines of jsdom/testing-library tests for the dead React app do run. Verification of the UI is entirely manual: three `.html` harnesses, a console-invoked `audit-overflow.js`, and 376 KB of …


**[major] CI does not run a single test from packages/reggie**  
`foundation` · `broken`

> `grep -rn packages .github/workflows/` → "NO REFERENCE TO packages/ IN ANY CI WORKFLOW"; .github/workflows/ci.yml:22-24 runs npm ci / npx tsc --noEmit / npm test at the repo root; root package.json has no "workspaces" field, so npm ci at root never installs packages/reggie; root tsconfig.json:20 is `"include": …

All 471 tests and the `npm run typecheck` in packages/reggie exist only as a local convenience. CI's frontend job typechecks and tests the dead React app, and its backend job spends a three-OS matrix on `cargo clippy`/`cargo test` for src-tauri. Nothing in the pipeline compiles src/serve.ts, runs test/serve.test.ts, or even proves `tsc -p tsconfig.json` still succeeds for the v3 package.

*Why it matters:* Every guarantee the audit can otherwise point to — endpoint contracts, story link well-formedness, path-traversal guards — is unenforced on merge. An agent (or the user) can land a change that breaks the whole UI's data layer and the pipeline stays green, which is exactly the failure mode that erodes trust in the G1 …


**[major] Zero automated tests for 12,133 lines of live UI JavaScript**  
`foundation` · `absent`

> `find packages/reggie/ui -name '*.test.*' -o -name '*.spec.*'` returns nothing; grep for jsdom|happy-dom|playwright|puppeteer across packages/reggie/package.json, vitest.config.ts, src, test, ui returns nothing; vitest.config.ts:5 `include: ["src/**/*.test.ts", "test/**/*.test.ts"]`. wc -l: map.js 4944, board.js 2982, …

The only references to ui/ from any test are a path string in src/roles.test.ts:21 and a reimplemented route parser in src/story.test.ts:88. Meanwhile the repo root already carries jsdom 27, @testing-library/react and @vitest/coverage-v8 as devDependencies, and 38 test files / 20,923 lines under src/ — all aimed at the decommissioned Tauri app. The testing capability exists and is pointed at dead code.

*Why it matters:* Everything the user actually looks at — the map, the story column, the task board that starts agent sessions — is verified only by opening ui/dev/*-harness.html by hand and running window.__audit() in a console. Regressions in G1/G2/G3 surfaces are invisible until a human happens to look at the right page at the right …


**[major] The code graph never updates while an agent is working (sha-keyed cache, no watcher)**  
`G2-understand-changes` · `broken`

> src/workspace.ts:270 `cached()` — `useSha = opts.sha ?? true`, slot reused while `slot.sha === sha`; src/serve.ts:203 graphOf, :164 factsOf, :169 historyOf, :208 nodeIndexOf, :227 edgeIndexOf all call `c.cached(key, build)` with no ttlMs. `grep -rn "fs.watch|watchFile|chokidar|EventSource|WebSocket|text/event-stream" …

The graph, repo facts, git history, node index and edge index are rebuilt only when HEAD moves. Uncommitted working-tree edits — which is what an agent produces for the entire duration of a task — never invalidate them, and there is no file watcher, no SSE and no WebSocket to push a change to the browser. The client's own cache (ui/app.js:410, CACHE_TTL_MS) compounds it. The only self-refresh is `{fresh:true}` on /api/status, /api/tasks and /api/task.

*Why it matters:* G2 is 'help the user understand the changes that are being made'. The page silently shows a picture of the last commit while the agent edits files, and nothing on screen says so. The user cannot tell a stale map from a map of a codebase that genuinely has not changed.


**[major] Nothing anywhere reads the working tree — no `git status`, no diff of uncommitted work**  
`G2-understand-changes` · `absent`

> `grep -rn "porcelain|uncommitted|dirty" packages/reggie/src/*.ts` (non-test) returns only prose in comments — packet.ts:105,110,113; serve.ts:71,1399; tasks.ts:316,508,683. Every actual diff call is a commit range: src/git.ts:176 `diff --stat base...HEAD`, git.ts:181 `diff --name-only base...HEAD`, tasks.ts:417 `diff …

Change awareness in the product is entirely commit-shaped: which files a merged or branch range touched, and per-file history aggregates from history.ts. There is no endpoint, no view, and no story sentence derived from `git status --porcelain` or an unstaged `git diff`. graph.ts:823 reads file content from the working tree for imports, but that read sits behind the sha-keyed cache above, so even it is frozen at the last commit.

*Why it matters:* The single most valuable G2 signal while coding with Claude Code or Codex is 'what has the agent changed in the last five minutes, and what does it touch'. That is the one thing the product cannot show.


**[major] Reggie's own generated agent instructions describe the decommissioned Tauri app**  
`G3-direct-agents` · `broken`

> CLAUDE.md:26 `- Entry points: \`src-tauri/src/main.rs\`, \`src/main.tsx\``; CLAUDE.md:34 `- tauri: \`npm run tauri\``; the block header reads 'Repo facts (generated 2026-09-09)' and the description is the v2 tagline 'Brain-dump to merged PR — a desktop workspace and agent system…'. AGENTS.md carries the identical …

collectFacts() has no notion of a monorepo: it reads the single root package.json, so on this branch it reports the dead app's name, description, scripts and entry points, and its structure list is dominated by src/ 89 and src-tauri/ 28. src/docs.test.ts:14 fixtures a single-package repo (root package.json with `main: src/index.ts`), so the monorepo case is untested. The generated block is the mechanism that tells Claude Code and Codex what this repo is.

*Why it matters:* G3 is 'help the user give direction to the agents so the agents understand exactly what the user is imagining'. Reggie's flagship G3 artefact, regenerated today on its own repo, actively points agents at 52,000 lines of dead code and tells them to build with `npm run tauri`.


**[major] 52,493 lines of decommissioned Tauri app still tracked, and it is the only thing CI builds**  
`foundation` · `over-built`

> `git ls-files src | xargs wc -l` → 89 files, 34,267 lines; `git ls-files src-tauri | xargs wc -l` → 28 files, 18,226 lines (11,464 of Rust). CLAUDE.md:12 'the Tauri desktop app is decommissioned on this branch'; docs/repo-manager-vision.md:20 says the same. `git diff --stat main...HEAD` shows 55,989 insertions and 1 …

Root package.json still declares the Tauri/React/xterm dependency tree and scripts dev/build/preview/tauri, root tsconfig.json includes only src/, vite.config.ts:1 configures the dead app, and release.yml still builds Tauri bundles on tag. The dead tree also skews every heuristic Reggie runs on itself: facts.ts entry points, the language census, and the area selection that drives the Level-1 map.

*Why it matters:* It costs three OS runners per PR on code nobody ships, it makes the repo's own dogfood output wrong (see the finding above), and it means anyone reading this repo — human or agent — has to work out which 34k-line src/ is the real one.


**[minor] story.test.ts validates client routes against a reimplementation that has already drifted**  
`G1-understand-codebase` · `spec-drift`

> src/story.test.ts:86-88 — "The client's route parser (ui/app.js `parseRoute`), reimplemented here". The copy at :99-105 uses `decodeURIComponent(segs[1] ?? "")` and a flat `levels` lookup. The real one in ui/app.js uses `decodeId()` (which try/catches a malformed escape and returns the raw string) and strips trailing …

Two divergences already exist: a route containing a malformed percent-escape throws in the test copy and is passed through by the client, and a trailing slash on an area id is normalised by the client but not by the test. expectLinksWellFormed() (story.test.ts:109) therefore proves that every story link parses under a model of the client, not under the client. The same shape applies to ui/DOM-CONTRACT.md — 271 lines describing IDs and wiring, with no test asserting index.html or app.js still matches it.

*Why it matters:* story.ts is the G1 narration engine and its links are how the user navigates the codebase. The suite that is supposed to protect those links can stay green through a client-side change that breaks every one of them.


**[minor] A failed warm-up stage reports the repo as ready with no user-visible signal**  
`G1-understand-codebase` · `risk`

> src/serve.ts:958-963 — `try { stage.build(c); warmup.steps[stage.step] = true; } catch { /* The data route for this source reports the failure; the tick stays off. */ }`; the loop continues and serve.ts:951-953 sets `warmup.done = true` when the queue empties. ui/app.js:899 `if (!status || status.ready) { …

The five stages are files, imports, notes, history, tasks (serve.ts:925-930). If, say, the history stage throws (a shallow clone, a corrupt object, a repo with no commits), /api/status answers `{ready:true, steps:{history:false}}`, the 'Reading the repo' card is removed as if everything succeeded, and the Heat/Owners lenses and every 'what happened recently' paragraph render from empty data. The exception itself is discarded — no log line, no error field.

*Why it matters:* The user sees a confident, complete-looking map of a codebase that is missing a whole dimension, with nothing to distinguish 'no recent churn' from 'churn data failed to build'. Silent partial truth is worse than a visible error for a tool whose job is understanding.


**[minor] No linter, formatter, or type checking of any kind for the UI JavaScript**  
`foundation` · `absent`

> No .eslintrc/eslint.config/.prettierrc/biome.json/jsconfig.json at the repo root or in packages/reggie (`ls -a | grep -iE 'eslint|jsconfig|prettier|biome'` empty at both levels); `grep -rn '@ts-check|@ts-nocheck' packages/reggie/ui/*.js` empty. packages/reggie/tsconfig.json:26 `"exclude": ["src/**/*.test.ts", ...]`, …

ui/*.js is plain untyped ES modules consuming JSON whose shape is defined in TypeScript on the server side. There is no mechanism — not a type, not a lint rule — connecting the contract types in src/story.ts:37 or src/flows.ts:31 to the client code that destructures them. Server-only mitigations are strong (strict, noUncheckedIndexedAccess, exactOptionalPropertyTypes at tsconfig.json:14-19) and stop at the wire.

*Why it matters:* A renamed field on the server side is caught nowhere: not by tsc (the client is JS), not by a test (no UI tests), not by CI (it runs neither). It surfaces as a blank panel the next time a human opens that page.


**[minor] map.js createMap is a 2,073-line closure, and 376 KB of dev harness ships to users**  
`foundation` · `risk`

> ui/map.js:1973 `export function createMap(container, opts = {})` runs to the next banner at :4047 — 2,073 lines, ~70 inner functions over shared mutable state (cy, model, controls, tip, legend). The largest are fit() 192 lines (:3319) and stylesheet() 190 lines (:1737). packages/reggie/package.json:16 `"files": …

Everything else in the codebase is well sectioned — src/story.ts, serve.ts, flows.ts and services.ts all carry banner headers every 100-300 lines and their longest functions are 77, 165 and 191 lines respectively. createMap is the one place where size and shared mutability coincide, and its own internal banners (:2039 show/diff/layout, :2945 lenses, :3004 highlight, :3112 viewport, :3492 legend, :3581 toolbar, :3763 footer/tooltip, :3823 events) already mark the split lines.

*Why it matters:* It is the file an agent is most likely to be asked to change (every map bug lands here), it is the file with the least test protection, and its size makes any agent edit a whole-file read. The bundled ui/dev is minor dead weight but also means the harness pages and 10k lines of fabricated sample data are served …
