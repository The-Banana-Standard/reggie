# Verification — complete-data-flow-view

## Commands
- Focused: `npm test -- ui/client-flow.dom.test.js ui/map.dom.test.js ui/app.dom.test.js src/flows.test.ts` in packages/reggie: 4 files, 63 tests passed.
- Full: `npm test` at the task root with local socket/subprocess permissions: 58 files passed; 1,335 tests passed and one existing skip (1,336 total).
- The first sandboxed full run failed on denied loopback and tsx IPC sockets. The permitted rerun above passed; no tests were weakened to bypass the restriction.
- `npm run typecheck` and `npm run build`: passed.
- `git diff --check`: passed.
- Final DOM regression run: `npm test -- --project web-dom` in packages/reggie: 5 files, 40 tests passed. An initial invocation from the delegating root script did not forward the option; rerunning in the package selected the project correctly.
- `reggie docs refresh`, `reggie docs check`, and `reggie plan lint complete-data-flow-view`: fresh/pass.
- Packet lint is recorded in the completion workflow before landing.

## Real repository acceptance
Target: personal_website, served read-only by the task build at 127.0.0.1:4311. Its pre-existing dirty files were not edited or staged.

- All-flows index retains GET /api/admin-stats (7 server steps), POST /api/chat (124), POST /api/feedback (8), and the src/index.js program entry.
- Overview maps four unique client origins to the matching endpoints, then to five reached services. Chat has three paths/origins; feedback has two paths sharing one origin. Path and unique-origin counts are labelled separately.
- Admin-stats remains listed and navigable despite no matched client, with an explicit explanation that external or dynamic callers may exist. Its server story and COST_TRACKER remain available.
- Chat opens with Clients + server checked and a 132-step combined graph, four services and the existing 17 omitted server steps disclosed. All 124 server story cards remain available.
- Selecting the React effect changes client details to initialQuestion but leaves the combined step count, services and server story unchanged.
- Keyboard ArrowRight on the native scope radio selects Focus on this path. The explicit focus shows five edges joining the browser event, submit, handlePrompt, requestChatResponse, POST /api/chat and onRequestPost.
- Settled Cytoscape inspection at 1280 and 1600 widths confirms alternating rows: event → submit, down to handlePrompt → requestChatResponse in reverse, down to endpoint → handler. No branch is flattened; the full graph remains hierarchical.
- At 1000 width the wrapped graph fits the tablet frame above the story with the primary bottom navigation intact.
- At 390 width the story and scope controls wrap and all four entry links remain reachable. The map overlay uses a vertical chain with fit/zoom controls. All flows returns to the complete index.
- Measured document clientWidth/scrollWidth: 1585/1585 at 1600, 1265/1265 at 1280, 985/985 at 1000 and 375/375 at 390. No page-level horizontal overflow.
- Browser error/warning log empty during acceptance. Temporary viewport override reset afterward.

## Preserved limits
Existing server breadth caps and incomplete static client tracing remain visible. No React state/prop or runtime branch inference was added. Large full graphs require zooming or depth controls to read individual nodes; explicit focus is available without replacing the broad default.
