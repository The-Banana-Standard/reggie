---
slug: code-entity-pages
title: Build code entity pages
risk: high
deciders: [jacobpress]
author: jacobpress
created: 2026-09-23
---
# Build code entity pages

## Problem
The web UI parses symbol URLs but renders them as file-page aliases: it asks for the file story and impact graph, opens the reader on the whole file, and merely highlights a matching exported name. Routes and data concepts have no pages at all. That prevents the owner from reading one complete declaration with its documentation, seeing exact callers and callees, understanding a route's clients and payload variants, following a concept across the repository, or safely maintaining the shared summaries that now exist behind the UI.

The existing file reader also stops at 20,000 characters, so “show the full file” cannot be truthful for larger files. The semantic index already supplies exact source spans, callers, callees, route clients, recursive shapes, validations, concepts, and reachability; this task must expose and present those records without re-deriving them in the browser.

## Approach
Add a pure entity-page projection layer over the semantic index. A symbol detail contains the exact documented declaration slice, parent file, knowledge/current edit model, validations, returns, resolved callers and callees, unresolved sites, and a bounded call graph projected to the existing map contract. A route detail contains handler and middleware symbols, static clients, request/response trees, services and flows reached, and shared knowledge. A concept detail contains aliases, occurrences, occurrence-level declared types, validations, transformations, routes, flows, symbols, current knowledge, and manual override metadata. Add read endpoints for those details, reachability, and line-ranged source pages.

Make symbol, route, and concept hash routes first-class UI levels. Symbol pages open the reader in declaration mode by default, including attached documentation/decorators and the complete declaration; “Show full file” switches to paged source and can read past the old character cap. The symbol map centers the selected symbol, callers to the left and callees to the right, with direction/depth controls and unresolved sites listed separately. Route and concept pages render dedicated structured sections with direct entity links and recursive value/type facts.

Use the shared KnowledgeRecord edit contract for explicit Save/Cancel summary and description editing, optimistic revision conflicts, stale warnings, and explicit refresh preview/confirmation. A small versioned concept-override file records manual merges, splits, redirects, actor, reason, revision, and history. Apply splits before merges to static concepts; keep source knowledge records and override history intact, and resolve old merged IDs as redirects. Concept writes use the same integration-checkout lock, atomic replacement, isolated-index commit, and unrelated-work preservation as knowledge writes. Rejected: storing UI-only prose or grouping in browser local storage, because other agents and repository checkouts would not share it and histories would disappear.

## Files to touch
- packages/reggie/src/entity-pages.ts (NEW)
- packages/reggie/src/entity-pages.test.ts (NEW)
- packages/reggie/src/concept-overrides.ts (NEW)
- packages/reggie/src/concept-overrides.test.ts (NEW)
- packages/reggie/src/data-concepts.ts (MOD)
- packages/reggie/src/data-concepts.test.ts (MOD)
- packages/reggie/src/knowledge.ts (MOD)
- packages/reggie/src/knowledge.test.ts (MOD)
- packages/reggie/src/paths.ts (MOD)
- packages/reggie/src/layout.ts (MOD)
- packages/reggie/src/layout.test.ts (MOD)
- packages/reggie/src/serve.ts (MOD)
- packages/reggie/test/entity-api.test.ts (NEW)
- packages/reggie/ui/app.js (MOD)
- packages/reggie/ui/app.dom.test.js (MOD)
- packages/reggie/ui/reader.js (MOD)
- packages/reggie/ui/reader.css (MOD)
- packages/reggie/ui/reader.dom.test.js (MOD)
- packages/reggie/ui/styles.css (MOD)
- packages/reggie/ui/DOM-CONTRACT.md (MOD)
- packages/reggie/docs/ui-api-contract.md (MOD)
- .reggie/concepts.json (NEW)
- .reggie/journal/2026-09-23/jacobpress-session.md (MOD)
- .reggie/notes/packages/reggie/src/entity-pages.ts.md (NEW)
- .reggie/notes/packages/reggie/src/entity-pages.test.ts.md (NEW)
- .reggie/notes/packages/reggie/src/concept-overrides.ts.md (NEW)
- .reggie/notes/packages/reggie/src/concept-overrides.test.ts.md (NEW)
- .reggie/notes/packages/reggie/src/data-concepts.ts.md (MOD)
- .reggie/notes/packages/reggie/src/data-concepts.test.ts.md (MOD)
- .reggie/notes/packages/reggie/src/knowledge.ts.md (MOD)
- .reggie/notes/packages/reggie/src/knowledge.test.ts.md (MOD)
- .reggie/notes/packages/reggie/src/paths.ts.md (MOD)
- .reggie/notes/packages/reggie/src/layout.ts.md (MOD)
- .reggie/notes/packages/reggie/src/layout.test.ts.md (MOD)
- .reggie/notes/packages/reggie/src/serve.ts.md (MOD)
- .reggie/notes/packages/reggie/test/entity-api.test.ts.md (NEW)
- .reggie/notes/packages/reggie/ui/app.js.md (MOD)
- .reggie/notes/packages/reggie/ui/app.dom.test.js.md (MOD)
- .reggie/notes/packages/reggie/ui/reader.js.md (MOD)
- .reggie/notes/packages/reggie/ui/reader.css.md (MOD)
- .reggie/notes/packages/reggie/ui/reader.dom.test.js.md (MOD)
- .reggie/notes/packages/reggie/ui/styles.css.md (MOD)
- .reggie/notes/packages/reggie/ui/DOM-CONTRACT.md.md (MOD)
- .reggie/notes/packages/reggie/docs/ui-api-contract.md.md (MOD)
- AGENTS.md (MOD)
- CLAUDE.md (MOD)

## Acceptance criteria
- [ ] `GET /api/symbol?id=<sym:id>` returns one exact semantic symbol, its documented declaration source, parent file, parameters, validations, return variants, resolved callers/callees, unresolved related sites, knowledge edit model, and a direction/depth-aware call graph; malformed, legacy, traversal-like, and unknown IDs fail without guessing.
- [ ] Symbol hash routes keep the full canonical `sym:<path>::<qualified-name>` ID, render a real symbol page, provide parent-file breadcrumbs and links, and center the selected symbol between resolved callers and callees while listing unresolved sites outside the graph.
- [ ] The reader's default symbol mode shows attached documentation/decorators plus the complete function, class, constructor, or method declaration with original line numbers, and its “Show full file” action switches modes without losing the selected symbol.
- [ ] A line-ranged source API validates repo paths and integer bounds, returns stable start/end/total line metadata, and lets the reader page through every line of files larger than 20,000 characters without duplication, gaps, or a false complete state.
- [ ] `GET /api/route?id=<route:id>` returns handler and middleware symbols, statically detected client callers, recursive request fields, all response variants, reached services/flows, shared knowledge, and direct links; malformed or unknown route IDs fail explicitly.
- [ ] Route hash routes render a dedicated endpoint page whose handler, middleware, client, flow, service, concept, and parent-file references navigate to their corresponding pages rather than aliasing a file page.
- [ ] `GET /api/concept?id=<concept:id>` returns canonical description, aliases, occurrences, occurrence-level explicit declarations or `not declared`, validations, transformations, routes, flows, symbols, shared knowledge, and manual override/redirect state.
- [ ] Concept hash routes render a dedicated data-concept page with linked occurrences and expandable evidence, and an old merged concept URL follows a durable redirect while retaining access to the old record and history through explicit knowledge history.
- [ ] Manual concept merge and split writes require expected revisions, attribution, a reason, valid current concept/occurrence IDs, and the configured integration checkout; splits apply before merges, manual overrides win over static grouping, and writes create one atomic override-only commit without disturbing unrelated staged or unstaged changes.
- [ ] Inline entity editing has explicit Edit, Save, and Cancel states; saves submit the complete source-backed KnowledgeCurrent shape with optimistic revision handling, cancel restores server text, and a conflict leaves the user's draft visible with a clear reload choice.
- [ ] Stale summaries remain visible with their stale source/current fingerprints and an explicit refresh action; refresh shows agent, scope, chunks, and one-commit behavior before one confirmation, then reports progress/failure/result without silently starting an agent.
- [ ] Recursive value trees show every field and nested element with an explicit declared type or `not declared`, validation links, editable descriptions, and data-concept links; no rendering path truncates fields by count.
- [ ] `GET /api/reachability` exposes the semantic index's role-specific roots, unreachable findings, no-reference findings, and analyzer limitations without describing either finding as safe deletion.
- [ ] Router, reader, entity projection, override, HTTP, and DOM fixtures cover canonical IDs, classes/methods/constructors, documented source spans, depth/direction, paged full files, route clients and response variants, recursive fields, type absence, stale/edit/conflict/refresh states, redirects, merge/split history, hostile writes, and keyboard/phone-safe markup.
- [ ] From `packages/reggie`, focused tests, the full suite, typecheck, build, generated documentation checks, code review, security review, simplification review, manual desktop/phone browser acceptance, zero console errors, no horizontal overflow, and hosted Linux/macOS CI all pass.

## Verification strategy
- Criterion 1: run symbol projection and HTTP cases for canonical/malformed/legacy/unknown IDs, source, calls, findings, knowledge, depth, and direction; save payloads in `evidence/symbol-and-source.txt`.
- Criterion 2: run router and symbol-page DOM cases for canonical IDs, breadcrumbs, links, centered call nodes, direction/depth controls, and unresolved lists; save assertions in `evidence/symbol-and-source.txt`.
- Criterion 3: run reader DOM cases for documented function/class/method/constructor declarations, original line numbers, and mode switching; save rendered rows in `evidence/symbol-and-source.txt`.
- Criterion 4: run source-range API and reader paging cases over a file larger than 20,000 characters, including invalid bounds and source revision changes; save the complete page transcript in `evidence/symbol-and-source.txt`.
- Criterion 5: run route projection and HTTP cases for handler, middleware, client, request, response, service, flow, knowledge, malformed IDs, and unknown IDs; save the `POST /api/chat` fixture payload in `evidence/routes-and-concepts.txt`.
- Criterion 6: run route-page DOM cases and click each entity link class; save navigation targets and rendered endpoint sections in `evidence/routes-and-concepts.txt`.
- Criterion 7: run concept projection and HTTP cases for aliases, occurrences, type absence, validations, transformations, routes, flows, symbols, knowledge, and overrides; save payloads in `evidence/routes-and-concepts.txt`.
- Criterion 8: run concept-page DOM and redirect cases, then retrieve the old explicit knowledge history; save the redirect and retained-history results in `evidence/routes-and-concepts.txt`.
- Criterion 9: run concept override fixtures for merge, split, redirect, invalid occurrence, revision conflict, wrong checkout, lock contention, dirty targets, unrelated staged work, rollback, and one-commit publication; save commit trees/status in `evidence/concept-writes.txt`.
- Criterion 10: run entity editor DOM/API cases for Edit, Save, Cancel, successful replacement, revision conflict, retained draft, and reload; save transitions in `evidence/editing-and-refresh.txt`.
- Criterion 11: run stale and job DOM/API cases for visible text, fingerprints, preview, confirmation, progress, failure, resume, and result; save transitions in `evidence/editing-and-refresh.txt`.
- Criterion 12: run recursive tree DOM cases with more than six fields, nesting, arrays, variants, explicit and missing types, validations, descriptions, and concept links; save the full rendered tree in `evidence/structured-facts.txt`.
- Criterion 13: run reachability HTTP cases for every role, both evidence categories, and limitation wording; save the response in `evidence/structured-facts.txt`.
- Criterion 14: run focused node and web-dom projects with verbose names across every named fault and interaction case; save output in `evidence/focused-tests.txt`.
- Criterion 15: run the full suite, typecheck, build, docs check, audit, plan lint, diff check, code/security/simplification reviews, browser acceptance at desktop and phone widths, and hosted CI; save results in `evidence/full-verification.txt`, `evidence/browser-acceptance.txt`, and `evidence/reviews.txt`.

## Assumptions
- The canonical browser symbol identity is the full `sym:<path>::<qualified-name>` string. Legacy symbol URLs without `sym:` are rejected instead of silently aliasing a potentially different entity.
- Full-file reading is paged by original source line, not by bytes or characters; line numbers are the stable coordinate users see and use for links.
- “All direct callers” means every call the semantic index resolved exactly. Dynamic dispatch, unresolved callbacks, external calls, and unresolved calls remain findings and never appear as proven graph edges.
- Concept split selects explicit occurrence IDs into one new manual child at a time; unselected occurrences remain with the source concept. Repeating the action can create additional children. The alternative was an all-groups-at-once editor, rejected as harder to validate and recover.
- Concept merge chooses a canonical target ID and redirects each source ID to it. Source KnowledgeRecords are never deleted or rewritten; the target page may present their histories as related retired/superseded knowledge.
- Inline editing covers the structured current summary and source-backed parameter/field/return/call-site descriptions. Append-only dated notes continue through the existing note action rather than being overloaded into the current block.
- Refresh execution remains synchronous at the local server boundary in this task, but the persisted job record exposes progress and resumability before and after the call. Converting generation to a background worker is outside this program unless browser acceptance proves the UI unusable.

## Out of scope
- The Data Flow node label redesign, step-card narrative, Arguments/Request payload/Service payload wording, and removal of the legacy flow payload contract; those belong to the next ordered task.
- Initial AI knowledge generation in `personal_website`; this task provides and tests the controls, while the final program task performs the confirmed real-repository batch.
- Adding or inferring types in target source code.
- Semantic analysis for languages other than tracked JavaScript/TypeScript variants.

## Bail conditions
- If a complete documented declaration cannot be recovered from the compiler spans without reparsing source differently from the semantic index, stop and correct the index contract before building a second parser.
- If a concept override cannot reference stable occurrence IDs across unchanged source or cannot preserve old records/redirects without destructive migration, stop before enabling merge/split writes and revise the override model.
- If the shared knowledge commit primitive cannot safely support the override JSON while retaining its path, lock, rollback, and isolated-index guarantees, stop and redesign the transaction once rather than adding a second write implementation.
- If paged source can mix revisions or duplicate/skip lines after a file changes, add a source revision token and reject mixed pages before exposing “Show full file.”
