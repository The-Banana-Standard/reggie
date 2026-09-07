# Reggie web UI implementation plan

Companion to ui-spec.md and ui-api-contract.md. Generated from the design workflow on 2026-09-07.

## File plan

### packages/reggie/ui/index.html
Static shell: header (breadcrumb, search trigger, Lens control, Dense toggle, repo switcher), two-column grid (story column with Spotlight slot; map column with tabs, canvas, toolbar, legend, footer, reader drawer), palette modal, toast region, inline <svg><symbol> icon set, GLOSSARY-driven tooltips, vendor-first <script> tags with onerror CDN fallback for cytoscape 3.30.4, dagre 0.8.5, cytoscape-dagre 2.5.0 (d3 7.9.0 tag commented, stretch), then <script type=module src=/ui/app.js>. No inline JS beyond the onerror handlers.
Depends on: packages/reggie/ui/styles.css, packages/reggie/ui/app.js

### packages/reggie/ui/styles.css
All tokens (palette, type scale, spacing) as :root custom properties; layout grid and the <1100px stack; story typography and 62ch measure; cards, chips, note-type borders, task-state colours, board columns, palette, toasts, skeletons, reader drawer, toolbar and legend cards, focus rings, prefers-reduced-motion overrides, dense mode.

### packages/reggie/ui/app.js
Boot and renderer check; hash router (parse/format routes and query; pushState vs replaceState); fetch cache (URL-keyed, 10 s TTL) and error cards; h() DOM helper; entityLink(kind, route, label) and GLOSSARY chips; shell rendering (breadcrumb from story.crumbs, header, lens control, dense toggle, repo switcher); search palette (⌘K, /api/search, Enter navigates, Shift+Enter highlights via map.resolveRef, toasts); keyboard map (F, T, 1–5, Escape unwind, Backspace up); localStorage helpers (positions, dense, last routes); toasts; wiring between story.js, map.js, reader.js, board.js per level; POST helpers (capture, note, decide, journal) with same-origin fetch.
Depends on: packages/reggie/ui/story.js, packages/reggie/ui/map.js, packages/reggie/ui/reader.js, packages/reggie/ui/board.js

### packages/reggie/ui/story.js
Render a Story payload into the story column: sections, headings, paragraph kinds (fact, note, journal, gap, commit, decision, list), [[route|label]] link markup through entityLink, chips with glossary tooltips, empty-state blocks with inline forms (capture, add note, approve/needs work), 'Widen to 60 days' and <details> for commands; Spotlight card (render from /api/explain, pin/unpin, actions); story→map sync (mouseenter/leave → map.highlight/clearHighlight; IntersectionObserver .reading → map.softHighlight) and map→story sync (tint paragraphs on map hover); skeleton rendering with headings during loads.
Depends on: packages/reggie/ui/map.js

### packages/reggie/ui/map.js
The single Cytoscape instance and its stylesheet; cytoscape.use(cytoscapeDagre); ResizeObserver-guarded creation; element builders for ViewGraph payloads at each level (container map, area focus-plus-context with compound + ghost bands, explorer with side classes, blast radius with multiple centres, workspace repo map); diff-based show() with dagre layout only when the node set changes (animate 350 ms) and preset positions from localStorage; lens application in cy.batch (structure/knowledge/tests/heat/owners; tasks stretch); generated legend with isolate-on-click; toolbar (Fit, zoom, Re-layout, Show tests, depth/direction); highlight/softHighlight/clearHighlight/select/resolveRef; hover direction highlight (.up/.down) with the footer counts; single-div tooltips with sentence text from names/via; duplicate-basename prefixing; cycle class; events (hover, tap, dbltap, edgeTap) for app.js; renderer-failure stub that keeps the API surface but no-ops.

### packages/reggie/ui/reader.js
Source reader drawer for Levels 3 and 4: fetch /api/file, line-numbered rendering (first 20 000 chars with a truncation banner), gutter marks for exported symbols, scrollTo(line) with span highlight, resizable height (drag handle, min 120px, persisted), selection → 'Add a note about lines a–b' prefill, 'Open in editor' link from config editorScheme, open/close with 200 ms slide.

### packages/reggie/ui/board.js
Task board and task page DOM: six columns from /api/state-machine with definitions, cards (risk border, owner initial, badges, reason tooltip), the inline SVG state-machine strip with counts, Needs-you decision cards with Approve/Needs work → POST /api/decide, empty-board lifecycle text with capture form → POST /api/capture, task page sections (plan, criteria checkboxes, packet, evidence links, journal, copy context pack), blast-radius controls that call map.show with the impact payload.
Depends on: packages/reggie/ui/map.js

### packages/reggie/ui/treemap.js
STRETCH. d3.treemap over /api/treemap sharing the lens colour functions exported by map.js; tile labels ≥ 60px; click descends via the router; hover tooltip; cross-highlight with story refs.
Depends on: packages/reggie/ui/map.js

### packages/reggie/src/roles.ts
New. roleOf(path, firstLine?) returning source|test|fixture|config|generated; TEST_HINTS moved here from facts.ts and re-exported; used by facts.ts, graph.ts, views.ts.

### packages/reggie/src/symbols.ts
New. Regex symbol extraction for TS/JS/Rust (declarations with line/endLine/exported, tauriCommand flag), named-import parsing helper parseNamedImports(clause) used by graph.ts, usedBy(graph, file, name) from edge names, content-hash cache; calls() heuristic and the TypeScript compiler-API extractor are stretch behind the same interface.

### packages/reggie/src/history.ts
New. repoHistory(root, {since: '365.days'}) running one git log --numstat with Task trailers; per-path and per-directory churn/ownership aggregates, last 8 commits per path, commitsPerDay, busFactor; lastTouched map for batched staleness; in-memory + .reggie/.cache/history-<sha>.json cache keyed by HEAD sha; author→handle join with people.yaml.
Depends on: packages/reggie/src/git.ts, packages/reggie/src/people.ts

### packages/reggie/src/graph.ts
Modified. Full normalized graph: file nodes with role, named-import edges, tests retyping and testedBy, dir/repo hierarchy with aggregates and manifests, knowledge join (own/inherited/stale/byType) and entity nodes with annotates edges, IPC boundary edges and lib-crate resolution, entry markers with entryKinds from BOUNDARY_DETECTORS (config-extensible), task nodes from listTasks with touches from plan ∪ branch diff ∪ packet targeting dir nodes for folders, history attachment, cycles; keeps the flat compatibility fields (dir, dirKey, noteCount, dirNoteCount, degrees, unresolved, dirs, languages) and adds totalCodeFiles/included/truncated.
Depends on: packages/reggie/src/roles.ts, packages/reggie/src/symbols.ts, packages/reggie/src/history.ts, packages/reggie/src/notes.ts, packages/reggie/src/tasks.ts, packages/reggie/src/git.ts, packages/reggie/src/facts.ts

### packages/reggie/src/views.ts
New. Pure projections over RepoGraph: chooseAreas (adaptive, config-pinnable), containerView (aggregated + IPC edges, areas with hues, cycles), dirView (children, loose files, fold node, ghost bands with up/down split, aggregated child→ghost edges with via/names), impactView (multi-centre BFS with hop/side, per-hop counts, area folds), tarjan, treemapTree (stretch), legend counts helper.
Depends on: packages/reggie/src/graph.ts, packages/reggie/src/roles.ts

### packages/reggie/src/story.ts
New. DOM-free narration: repoStory, areaStory, fileStory, taskStory, workspaceStory, explain (four sentences), number-to-words, date formatting, [[route|label]] link builder, gap sentences, crumbs; symbolStory/personStory/timeStory stretch. Shared with the podcast composer later; unit tested on fixture contexts.
Depends on: packages/reggie/src/views.ts, packages/reggie/src/tasks.ts, packages/reggie/src/notes.ts, packages/reggie/src/journal.ts, packages/reggie/src/history.ts, packages/reggie/src/facts.ts

### packages/reggie/src/workspace.ts
New. discoverWorkspace(dir) parsing the parent CLAUDE.md '## Repos' section (### name, **Path**, **Purpose**), RepoCtx registry with lazy per-repo caches, workspaceSummary() (per-repo counts, coverage, last journal, entry points) and cross-repo edges (depends-on from manifest names, same-org from git remotes; shares-service stretch); auto-detection helper used by cli.ts.
Depends on: packages/reggie/src/facts.ts, packages/reggie/src/tasks.ts, packages/reggie/src/notes.ts, packages/reggie/src/journal.ts, packages/reggie/src/paths.ts, packages/reggie/src/people.ts, packages/reggie/src/git.ts

### packages/reggie/src/tasks.ts
Modified. Export STATE_MACHINE and stateDefinition(); TaskInfo gains stateDefinition and age; getTaskDetail(paths, config, slug) returning parsed plan sections, packet (verdict, criteria pass/fail, evidence), claim, journal for slug, risk rules fired; planned/actual file sets for impact.
Depends on: packages/reggie/src/plan.ts, packages/reggie/src/packet.ts, packages/reggie/src/git.ts, packages/reggie/src/journal.ts

### packages/reggie/src/notes.ts
Modified. staleEntriesFor gains an optional lastTouched map parameter (from history.ts) so staleness is one git pass; StaleEntry keeps codeChanged; a small notesIndex(paths) helper returning entries keyed by entity for graph.ts.
Depends on: packages/reggie/src/history.ts

### packages/reggie/src/facts.ts
Modified. Import TEST_HINTS/roleOf from roles.ts instead of defining them; no behaviour change.
Depends on: packages/reggie/src/roles.ts

### packages/reggie/src/serve.ts
Modified. Remove the PAGE template literal; serve /, /ui/*, /vendor/* statically; multi-repo registry and ?repo=; cached() helper keyed by HEAD sha or TTL; all GET routes in the API contract (graph levels, story, explain, file, symbols, impact, tasks, task, state-machine, history, notes, note, journal, people, search, workspace, status, context, evidence; treemap/timeline stretch); POST capture/note/decide/journal with loopback + Sec-Fetch-Site/Origin checks and 64 KB body cap; JSON errors with status codes.
Depends on: packages/reggie/src/graph.ts, packages/reggie/src/views.ts, packages/reggie/src/story.ts, packages/reggie/src/symbols.ts, packages/reggie/src/history.ts, packages/reggie/src/workspace.ts, packages/reggie/src/tasks.ts, packages/reggie/src/notes.ts, packages/reggie/src/journal.ts, packages/reggie/src/capture.ts, packages/reggie/src/packet.ts, packages/reggie/src/context.ts, packages/reggie/src/facts.ts, packages/reggie/src/people.ts

### packages/reggie/src/cli.ts
Modified. `reggie serve` gains --workspace <dir>, --no-workspace, --port, --host (existing); auto-detects a workspace from the parent CLAUDE.md; prints the URL and the list of served repos.
Depends on: packages/reggie/src/serve.ts, packages/reggie/src/workspace.ts

### packages/reggie/package.json
Modified. Add exact-pinned dependencies cytoscape 3.30.4, dagre 0.8.5, cytoscape-dagre 2.5.0 (d3 7.9.0 stretch) for /vendor; add "ui" to files; no build step for the UI.

### packages/reggie/src/views.test.ts
New. chooseAreas split/fold rules, ghost sides, fold at >40, impact hops and folds, tarjan cycles on fixture graphs.
Depends on: packages/reggie/src/views.ts, packages/reggie/test/helpers.ts

### packages/reggie/src/symbols.test.ts
New. TS/JS/Rust declaration extraction, endLine by braces, usedBy from named imports.
Depends on: packages/reggie/src/symbols.ts

### packages/reggie/src/history.test.ts
New. numstat parsing with two authors, per-dir roll-up, busFactor, lastTouched staleness map, cache file round-trip.
Depends on: packages/reggie/src/history.ts, packages/reggie/test/helpers.ts

### packages/reggie/src/story.test.ts
New. Fixture ctx → repo/area/file/task stories have every section, link markup is well-formed, explain returns four sentences, gaps appear on empty inputs, number words.
Depends on: packages/reggie/src/story.ts

### packages/reggie/src/workspace.test.ts
New. Parse a temp workspace CLAUDE.md with two repos; depends-on edge from a manifest dependency; missing path skipped.
Depends on: packages/reggie/src/workspace.ts, packages/reggie/test/helpers.ts

### packages/reggie/test/fixtures.ts
New. makeFixtureRepo(): a temp repo with two areas (a 45-file dir and a 2-file dir), tests and fixtures, a Rust crate with a tauri command and a TS invoke, notes (one stale), a journal, and tasks in ungroomed / in-process (branch) / awaiting-decision (packet) states, for views, story and serve tests.
Depends on: packages/reggie/test/helpers.ts

### packages/reggie/test/serve.test.ts
New. Starts the server on the fixture repo; asserts every GET route's shape; POST capture creates an ungroomed task; POST with a cross-site Sec-Fetch-Site is refused; /vendor 404s cleanly when node_modules lacks a file; / serves index.html.
Depends on: packages/reggie/src/serve.ts, packages/reggie/test/fixtures.ts

## Implementation order

- Day 0 (half day, one person): freeze this contract; add pinned deps (cytoscape 3.30.4, dagre 0.8.5, cytoscape-dagre 2.5.0) and 'ui' to package.json files; create packages/reggie/ui/ with index.html, styles.css and an app.js stub; make serve.ts serve /, /ui/*, /vendor/* and drop the PAGE template literal; write test/fixtures.ts (two areas incl. a 45-file dir, tests, a tauri command + invoke, notes incl. one stale, journal, tasks in three states). After this the server track (A) and the client track (B) are disjoint and can run in parallel; B develops against the live server or the fixture repo.
- Day 1 — Track A (server): roles.ts; symbols.ts named-import parser; graph.ts hierarchy nodes + aggregates + roles + tests retyping + testedBy + knowledge join + IPC and lib-crate edges + entry markers + tasks from listTasks; views.ts chooseAreas/containerView/dirView/tarjan; GET /api/graph?level=container|dir; extend graph.test.ts and add views.test.ts. Verify on the live repo that chooseAreas yields the 7 areas and the src/components→src/types edge is 41.
- Day 1 — Track B (client): index.html shell + icon set + vendor/CDN script tags; styles.css tokens and layout; app.js router, fetch cache, entityLink, breadcrumb, lens control, keyboard, toasts, renderer-failure card; map.js instance, stylesheet, container map builder, dagre layout, legend generator, toolbar, highlight/dim API, tooltips, localStorage positions. Milestone: #/repo/reggie draws the container map from /api/graph?level=container.
- Day 2 — Track A: history.ts (numstat pass, roll-ups, cache, lastTouched map) and notes.ts batched staleness; symbols.ts declarations + usedBy; story.ts repoStory/areaStory/fileStory/explain with story.test.ts; views.ts impactView with folds; serve.ts routes /api/story, /api/explain, /api/file (extended), /api/symbols, /api/impact, /api/history, /api/search, /api/note stale flags, /api/status.
- Day 2 — Track B: story.js (sections, paragraph kinds, chips, link markup, empty blocks, skeletons, data-refs hover + IntersectionObserver reading mode, map→story tint); Spotlight card; map.js area view (compound, ghost bands with up/down split, fold node, Show tests) and ghost-swap animation; lenses structure/knowledge/tests/heat/owners with generated legends. Milestone: Levels 1 and 2 with story+map lockstep on the live repo.
- Day 3 — Track A: tasks.ts STATE_MACHINE, stateDefinition, age, getTaskDetail; serve.ts /api/tasks (extended), /api/task/<slug>, /api/state-machine, /api/evidence, /api/impact?slug=…, /api/people, /api/journal filters; POST /api/capture, /api/note, /api/decide, /api/journal with the loopback/Sec-Fetch-Site/Origin checks; test/serve.test.ts on the fixture repo.
- Day 3 — Track B: map.js explorer view (direction hue, depth/direction controls, folds, in-page Back, cycle class) and blast-radius mode; reader.js drawer with gutter marks, scrollTo, selection-to-note, resize; board.js (columns, state strip, decision cards, capture form, task page sections); inline note form; Dense toggle; search palette with Shift+Enter highlight. Milestone: Level 3, board and task page working on the fixture repo.
- Day 4 — Track A: workspace.ts (parent CLAUDE.md '## Repos' parsing, registry, summary, depends-on/same-org edges), cli.ts --workspace/--no-workspace with auto-detect, /api/workspace, per-repo caches keyed by HEAD sha, workspace.test.ts. Track B: Level 0 workspace map and tile strip, repo switcher, greyed Workspace crumb in single-repo mode, loading/empty/error state pass across every level, label-collision and legend checks, accessibility pass (focus order, chips, contrast), and a walk through both acceptance scenarios.
- Stretch, in this order once Core is accepted: (1) symbols.ts calls() heuristic + Level 4 symbol map + symbolStory; (2) Tasks lens on the container map and entry-point pin nodes with 'Trace from here'; (3) treemap.js + /api/treemap; (4) /api/timeline + Timeline lens and People pages; (5) config.yaml boundaries/areas overrides exposed in the UI; (6) workspace shares-service edges and '## Workspaces' descent; (7) TypeScript compiler-API extractor behind the symbols.ts interface, tree-sitter for Rust; (8) /api/export Mermaid/SVG via headless Cytoscape; (9) sentence-bank phrasing in story.ts.

## Acceptance criteria

**Counting rule for these numbers.** Aggregated *edge weights* (container edges, area ghost edges, and the `talks` sentences built from them) count every importing file, tests included, and never draw an edge of kind `tests` while the toggle is off — a test's import is still traffic across the boundary. The only test importers missing from an area-level weight are files with no drawn parent in that view (loose test files directly under the root); `Show tests (N)` draws them. *Node counts* (`shown`, the explorer's `N upstream · N downstream`) count what is drawn, with `hiddenTests` naming the rest. Parentheticals such as "mostly for terminal.ts (17)" are in the same unit as the total they sit inside — importing files, not named imports.

1. Landing: opening http://127.0.0.1:4310/ redirects to #/repo/reggie and shows a repo header (name 'reggie', branch 'repo-manager', description) with the absolute path only as a tooltip; no file-level graph is visible on first paint.
2. Repo map: the container map draws exactly the areas chosen by chooseAreas for this repo (packages/reggie, src-tauri, src/components, src/hooks, src/types, src/services, src (other)); every node is labelled inside with name and 'N files · M% documented'; no file nodes and no test edges appear; the legend lists one swatch per visible area plus 'IPC' and hides rows absent from the canvas.
3. Aggregated edges: the edge src/components → src/types is the widest import edge and is labelled 41; hovering it shows the tooltip sentence 'src/components imports from src/types 41 times, mostly terminal.ts (17)'; clicking it pins a Spotlight listing the top 5 file pairs, each a link that opens the file level.
4. Boundary edges: dotted violet IPC edges connect the React areas (src/components, src/hooks, src/services, src (other)) to src-tauri; the edge labels sum to 48 distinct commands across those areas; the story section 'Where it starts' says a user action starts in src/main.tsx and reaches the Rust side through 48 Tauri commands; src-tauri/src/main.rs is no longer isolated (an edge to src-tauri/src/lib.rs exists at the file level).
5. Story ↔ map sync: hovering the 'How the pieces talk' paragraph about src/components and src/types highlights exactly those two nodes and the edge between them with a white halo while everything else dims to 0.35 opacity; hovering the src/types node tints the left border of every story paragraph that mentions it; clicking any node pins a Spotlight card with exactly four sentences whose nouns are links.
6. Drill-down and URL: clicking the src/components node (or its name in the story) changes the hash to #/repo/reggie/area/src/components, the breadcrumb reads Workspace › reggie › src › components, and the browser Back button returns to the repo level with the map animating rather than re-randomising; reloading any URL restores the same level, lens and selection.
7. Area map: at #/repo/reggie/area/src/components the compound node contains the sub-areas and loose files chosen by chooseAreas (ActivityBar, WorkspaceOverview, ProjectSummary, Terminal, Sidebar as collapsed sub-area nodes; ≤ 40 drawable children), ghost nodes for src/types, src/hooks, src/services, src (other) and src-tauri sit in bands above (importers) or below (imports) the compound with dashed borders and 'N files used' labels; no cross-boundary edge between drawn children is dropped (the src/types ghost edge has weight 35: the 41 crossing file pairs less the six in src/components/__tests__/, which have no drawn parent while tests are hidden and reappear with the toggle); tests are hidden with a 'Show tests (25)' toggle that draws them as hollow dashed circles.
8. Ghost swap: clicking the src/types ghost navigates to #/repo/reggie/area/src/types and the map animates over ~350 ms so src/components becomes a ghost above the new compound.
9. File level: at #/repo/reggie/file/packages/reggie/src/paths.ts the explorer shows paths.ts at the centre with its 19 non-test importers above in cyan borders and its imports below in orange; the counts line reads '19 upstream · 1 downstream at depth 1 · 17 tests hidden' (the explorer counts drawn nodes, so the 12 test importers are behind the tests toggle); moving the depth slider to 2 adds nodes without recreating the instance (positions of existing nodes animate); 'What depends on me' hides the downstream side; the Spotlight sentence 'It is used by …' lists at least the top importers as links.
10. Named imports: hovering the edge serve.ts → graph.ts in the explorer shows 'serve.ts imports buildGraph, RepoGraph from graph.ts'; the 'What it exports' section for graph.ts lists buildGraph and dirKey with 'used by N files' counts, and clicking buildGraph scrolls the reader drawer to its declaration line with the span highlighted.
11. Reader: 'Read the source' opens a drawer under the map with line numbers and gutter marks on exported symbols; for a file over 20 000 characters a banner states how many characters are shown; selecting text offers 'Add a note about lines a–b' which prefills the note form.
12. Knowledge lens: pressing 2 (or choosing Knowledge) recolours the repo map instantly: packages/reggie is amber or green by documented share, src/components is grey (no notes), and packages/reggie carries a red stale notch; the legend shows Documented / Inherited / Undocumented / Stale with counts; the story gains a 'What nobody has written down' item reading 'The note on packages/reggie/ was written on 6 Sep but the folder changed on 7 Sep; it may be out of date', and clicking it opens the area with that note pinned and a 'Possibly out of date' chip.
13. Tests lens: the Tests lens colours source files with a test importer green and others grey; at the file level for packages/reggie/src/serve.ts the Tests section reads 'No test imports this file.' in amber, while packages/reggie/src/graph.ts lists graph.test.ts.
14. Heat and Owners lenses: Heat fills areas on the five-step ramp with packages/reggie the hottest (most commits in 30 days) and src-tauri the coldest; Owners fills every area with the jacobpress colour and a hatch pattern, and the legend shows 'jacobpress' plus 'single owner'; the area story says one person wrote ≥ 90% of the lines changed in the last year.
15. No hairball: at no level does the canvas contain more than 40 drawable nodes (ghosts and folds excluded); every map is laid out by dagre (importers above, imports below) and two consecutive loads of the same URL produce the same node positions; toggling Show tests or changing a lens never moves existing nodes.
16. Labels and legend: at fit zoom on the area map no two file labels overlap for the src/components view; file labels disappear below 9px rendered size; duplicate basenames (mod.rs, Sidebar.test.tsx) show a parent-segment prefix; every node has a full-path tooltip; the selected node's label stays visible at any zoom.
17. Task board (empty state on this repo): #/repo/reggie/tasks shows six columns with one-line definitions from /api/state-machine, a state-machine strip with counts of 0, and the empty text explaining intake → plan → branch → PR → merge with an inline capture form; submitting 'Try the new guidebook' creates an ungroomed card, a toast 'Captured as try-the-new-guidebook', and a new line in .reggie/intake.md.
18. Task page on a fixture repo (test/fixtures.ts served): an in-process task shows the plan sections as prose, Files to touch as links, criteria as checkboxes, the git reason as a muted line, and a blast-radius map with planned files ringed amber, branch-changed files filled amber, importers to depth 2 fading by hop, and a red overlap plus the sentence 'This task and <other> both touch <file>' when two active tasks share a file; Approve / Needs work write the verdict to packet.md and the board moves the card.
19. Search: ⌘K, typing 'terminal' lists src/types/terminal.ts first (exact basename), Enter navigates to its file page; Shift+Enter on the repo level highlights src/types with the toast 'inside src/types (folded)' instead of leaving the level; Escape closes the palette.
20. Workspace level: starting `reggie serve --workspace "/Users/jacobpress/Desktop/Projects/Reggie Workspace"` serves reggie and forge-reggie, opens at #/ws with one paragraph per repo, one node per repo joined by a dashed same-org edge, and a tile strip with the five-state counts and a coverage bar per repo; clicking a repo node enters #/repo/<name>; in single-repo mode the Workspace crumb is greyed with the tooltip naming the --workspace flag.
21. Offline and failure: with network disabled the page renders fully from /vendor (no request leaves 127.0.0.1); renaming node_modules/cytoscape and blocking cdnjs shows the card 'The map library did not load. The story still works. Expected /vendor/cytoscape.min.js …' while the story, palette, board and reader remain usable; resizing the window keeps the map fitted and never leaves a blank canvas (zoom stays within 0.1–4).
22. Loading states: navigating between levels shows the section headings with skeleton bars immediately and keeps the previous map dimmed until the new payload arrives; the very first load shows 'Reading the repo' with per-source ticks.
23. Accessibility: Tab reaches every story link in order with a visible 2px focus ring; every chip has a tooltip (Type, Confidence, Written by, Date) instead of a dot-joined tuple; text contrast ≥ 4.5:1 and edges ≥ 3:1 measured on the dark theme; with Dense off and the map column hidden via CSS, every drill-down in this list is still reachable through story links alone.
24. Security: a POST /api/capture with header Sec-Fetch-Site: cross-site or a foreign Origin returns 403 and writes nothing; a body over 64 KB returns 413; /api/file?path=../package.json returns 400.
25. Compatibility: GET /api/graph with no parameters still returns nodes (kind file|task) and edges as before plus totalCodeFiles/included/truncated, and the existing graph.test.ts passes unchanged; all new unit tests (views, symbols, history, story, workspace, serve) pass with `npm test` inside packages/reggie.
26. Scenario — newcomer (first 10 minutes, no prior knowledge): from #/repo/reggie they read 'What this is' (the repo note says the product is packages/reggie and the Tauri app is legacy), see in the map that packages/reggie is an island while the React areas talk to src-tauri over IPC, click 'src/main.tsx' in 'Where it starts' to watch the explorer show what the entry point reaches at depth 2, jump to packages/reggie, learn from 'What is in here' that paths.ts and util.ts are the most relied-on files, open paths.ts, read the note chain (repo → packages/reggie/ → none on the file), open the source in the reader, and add a 'how' note from the inline form — all without opening a terminal; every step above is a click on a link or node, and Back retraces it.
27. Scenario — manager who does not read code: from #/repo/reggie the 'Needs you' section is hidden (nothing awaiting decision) and 'What is in flight' explains the lifecycle with a capture form; they capture an idea, switch to the Knowledge lens and read in plain English that src/components (29 source files) has no notes and that one note may be out of date, open #/repo/reggie/tasks to see the six states with definitions and their captured item in Ungroomed, and on the fixture repo open an awaiting-decision task, read the criteria with pass/fail and evidence links, see the blast radius and collision sentence, and click Approve with a comment — the verdict appears in the packet and the card moves to Done; at no point is a file path, git branch name, or CLI command required to complete these steps (commands appear only as secondary hints).
