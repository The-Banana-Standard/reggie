---
slug: data-flow-experience
title: Finish the semantic data-flow experience
risk: high
deciders: [jacobpress]
author: jacobpress
created: 2026-09-23
---
# Finish the semantic data-flow experience

## Problem
The semantic index now records real positional arguments, recursive shapes, declared types, validation facts, return variants, routes, concepts, reachability, and shared knowledge, but the Data Flow page still narrates and draws the temporary pre-index `Payload` contract. It turns parameter names into object-looking braces, says that shapes are not derivable when return expressions are known, uses generic graph nodes, opens flow symbols as files, and compresses each step into a dense paragraph. The overview also exposes no role-aware cleanup evidence even though the analyzer computes it.

The remaining migration must make the richer model the only flow contract. It must preserve uncertainty: values without a declared TypeScript, JSDoc, or referenced type say `not declared`; runtime checks stay validation facts; unresolved analysis and reachability findings never become deletion claims.

## Approach
Make a flow's graph identity explicit. HTTP entries start at their canonical `route:<METHOD>:<path>` node, callable symbols carry their semantic kind, and every node is projected as an `ENDPOINT`, `FUNCTION`, `METHOD`, `CLASS`, `FILE`, `SERVICE`, or `RESPONSE` with its primary symbol/name above its secondary file/path. A node tap navigates directly to route and symbol entity pages. Edge labels come only from the authoritative structured value for that boundary: positional argument counts/expressions for calls, complete request or service shapes at boundaries, and return variants for responses. Labels remain compact while the story exposes every field.

Replace generic flow paragraphs with a structured story-step record and renderer. Each card has a small `Step N` heading, one concise plain-English summary, a linked technical sentence naming caller, callee, and file without line-number prose, an expandable callee explanation, and expandable Inputs and Returns. Inputs choose the truthful label `Arguments`, `Request payload`, or `Service payload`; values render recursively with all fields, source-declared types or `not declared`, runtime validations, shared descriptions, and data-concept links. Knowledge supplies current callee and call-site prose when present; deterministic source-backed fallback wording remains concise when knowledge has not been generated. Stale knowledge remains visibly stale through the existing knowledge model.

Remove `Payload`, `FlowStep.input`, and `FlowStep.output` after the CLI, graph, story, probes, tests, and documentation use `arguments`, `requestPayload`, `servicePayload`, and `returns`. Keep request/response and service boundaries distinct from ordinary arguments. Add a role-grouped Possible cleanup section to the overview by consuming `/api/reachability`; show not-reachable and no-reference evidence separately with the analyzer's limitations and an explicit warning that neither proves safe deletion.

Rejected: keeping a browser fallback that reconstructs fields from parameter names. It would preserve the exact ambiguity this task removes and would let the CLI, graph, and story disagree again.

## Files to touch
- packages/reggie/src/flows.ts (MOD)
- packages/reggie/src/flows.test.ts (MOD)
- packages/reggie/src/story.ts (MOD)
- packages/reggie/src/story.test.ts (MOD)
- packages/reggie/src/cli.ts (MOD)
- packages/reggie/src/cli.test.ts (NEW)
- packages/reggie/src/serve.ts (MOD)
- packages/reggie/test/serve.test.ts (MOD)
- packages/reggie/ui/app.js (MOD)
- packages/reggie/ui/app.dom.test.js (MOD)
- packages/reggie/ui/story.js (MOD)
- packages/reggie/ui/story.dom.test.js (MOD)
- packages/reggie/ui/map.js (MOD)
- packages/reggie/ui/map.dom.test.js (MOD)
- packages/reggie/ui/styles.css (MOD)
- packages/reggie/ui/DOM-CONTRACT.md (MOD)
- packages/reggie/ui/dev/flows-probe.ts (MOD)
- packages/reggie/docs/services-and-flows-spec.md (MOD)
- packages/reggie/docs/ui-api-contract.md (MOD)
- packages/reggie/docs/ui-spec.md (MOD)
- .reggie/journal/2026-09-23/jacobpress-session.md (MOD)
- .reggie/notes/packages/reggie/src/flows.ts.md (MOD)
- .reggie/notes/packages/reggie/src/flows.test.ts.md (MOD)
- .reggie/notes/packages/reggie/src/story.ts.md (MOD)
- .reggie/notes/packages/reggie/src/story.test.ts.md (MOD)
- .reggie/notes/packages/reggie/src/cli.ts.md (MOD)
- .reggie/notes/packages/reggie/src/cli.test.ts.md (NEW)
- .reggie/notes/packages/reggie/src/serve.ts.md (MOD)
- .reggie/notes/packages/reggie/test/serve.test.ts.md (MOD)
- .reggie/notes/packages/reggie/ui/app.js.md (MOD)
- .reggie/notes/packages/reggie/ui/app.dom.test.js.md (MOD)
- .reggie/notes/packages/reggie/ui/story.js.md (MOD)
- .reggie/notes/packages/reggie/ui/story.dom.test.js.md (MOD)
- .reggie/notes/packages/reggie/ui/map.js.md (MOD)
- .reggie/notes/packages/reggie/ui/map.dom.test.js.md (MOD)
- .reggie/notes/packages/reggie/ui/styles.css.md (MOD)
- .reggie/notes/packages/reggie/ui/DOM-CONTRACT.md.md (MOD)
- .reggie/notes/packages/reggie/ui/dev/flows-probe.ts.md (MOD)
- .reggie/notes/packages/reggie/docs/services-and-flows-spec.md.md (MOD)
- .reggie/notes/packages/reggie/docs/ui-api-contract.md.md (MOD)
- .reggie/notes/packages/reggie/docs/ui-spec.md.md (MOD)
- AGENTS.md (MOD)
- CLAUDE.md (MOD)

## Acceptance criteria
- [ ] `Flow` exposes canonical typed nodes for endpoint, function, method, class, file, service, and response identities; HTTP traces begin at their canonical route node, and flow graph nodes show the uppercase kind, primary entity name, and secondary file/path.
- [ ] Clicking an endpoint graph node changes the hash to its dedicated `route:` page, clicking a symbol graph node changes it to the exact canonical `sym:` page, file and service nodes keep their existing destinations, and keyboard-activating each corresponding story link reaches the same hash.
- [ ] “How the data moves” renders one card per step with a small `Step 1`, `Step 2`, … heading, one concise plain-English summary, and a linked technical sentence that names caller, callee, and source file without line-number prose.
- [ ] Every step card has expandable callee explanation, Inputs, and Returns regions; current shared callee and call-site summaries are used when available, stale summaries remain visibly stale, and missing prose gets a concise source-backed fallback rather than a fabricated claim.
- [ ] Inputs are labelled `Arguments`, `Request payload`, or `Service payload` according to their semantic category, positional expressions stay positional, and `resolveSessionId` receives the expression `payload.session_id` rather than a synthetic `{ rawSessionId }` object.
- [ ] Expanded inputs and returns render uncapped recursive field trees with all fields, nested shapes, source-declared types or `not declared`, validation facts, shared descriptions, and data-concept links; graph edge labels stay compact and use counts such as `6 fields` for larger shapes.
- [ ] Every return branch is visible with expression, condition/status where present, and explicit return type or `not declared`; `resolveSessionId` shows `rawSessionId` and `crypto.randomUUID()` while correctly reporting that no return type is declared.
- [ ] The Data Flow overview includes a role-grouped Possible cleanup section that keeps “not reachable from a role-specific root” separate from “no references found,” includes the analyzer limitations, and explicitly says neither result proves safe deletion.
- [ ] The public Flow contract, CLI human output, JSON output, map/story readers, development probe, tests, and documentation no longer define or consume legacy `Payload`, `input`, or `output` fields.
- [ ] JS, TS, JSX, and TSX fixtures cover endpoint/symbol kinds, ordinary positional arguments, request and service payloads, six-field and nested structures, explicit and missing types, validation, conditional and HTTP returns, exact links, dynamic unresolved limitations, and role-grouped cleanup evidence.
- [ ] DOM tests cover step-card headings, plain-English and linked technical sentences, all expandable regions, recursive values, stale/missing knowledge, map labels and routes, compact edge labels, cleanup grouping, keyboard operation, and phone-safe no-overflow markup.
- [ ] From `packages/reggie`, focused tests, the full suite, typecheck, build, generated documentation checks, code review, security review, simplification review, manual desktop/phone browser acceptance, zero console errors, no horizontal overflow, and hosted Linux/macOS CI all pass.

## Verification strategy
- Criterion 1: trace HTTP and non-HTTP fixtures through every node kind, assert canonical node IDs/kinds/labels, and save the serialized flow/model in `evidence/flow-contract.txt`.
- Criterion 2: run map and story DOM navigation cases for route, symbol, file, service, and response nodes, including focus/keyboard activation; save destinations in `evidence/navigation.txt`.
- Criterion 3: run story projection and DOM cases for card count/order, `Step N`, summaries, linked technical sentences, and absence of line-number prose; save rendered text in `evidence/step-cards.txt`.
- Criterion 4: run knowledge-backed, stale, and missing-knowledge story cases for callee/call-site prose and fallback text; save the three rendered states in `evidence/step-cards.txt`.
- Criterion 5: trace the chat fixture and assert the exact argument category and `payload.session_id` expression for `resolveSessionId`; save that step JSON and card text in `evidence/chat-ground-truth.txt`.
- Criterion 6: render a nested shape with more than six fields, declarations, missing declarations, validations, descriptions, and concepts; save the complete DOM tree plus compact graph label in `evidence/structured-values.txt`.
- Criterion 7: assert both `resolveSessionId` return variants, conditions, and missing declaration in semantic, flow, story, CLI, and DOM output; save output in `evidence/chat-ground-truth.txt`.
- Criterion 8: run the overview against role-aware reachability fixtures and assert grouping, separate evidence categories, limitation text, and no deletion claim; save the rendered overview in `evidence/cleanup-overview.txt`.
- Criterion 9: search the supported source, test, UI, probe, and documentation surfaces for removed contract names and run CLI text/JSON snapshots; save results in `evidence/flow-contract.txt`.
- Criterion 10: run focused compiler/flow/story fixtures across JS, TS, JSX, and TSX and save verbose output in `evidence/focused-tests.txt`.
- Criterion 11: run the Vitest DOM project across story, app, and map modules at desktop and phone fixtures and save verbose output in `evidence/focused-tests.txt`.
- Criterion 12: run the full suite, typecheck, build, docs check, audit, plan lint, diff check, code/security/simplification reviews, browser acceptance at desktop and phone widths, and hosted CI; save results in `evidence/full-verification.txt`, `evidence/browser-acceptance.txt`, and `evidence/reviews.txt`.

## Assumptions
- The canonical endpoint node ID is the existing `RouteRecord.id` (`route:<METHOD>:<path>`). Non-HTTP entry points retain a file entry node because no route entity exists for them.
- `FUNCTION` covers named functions and arrow/function-valued variables; `METHOD` covers methods and constructors; `CLASS` is reserved for class symbols reached directly. Semantic kinds remain available in the payload even when two kinds share a display label.
- The technical sentence's file link points to the call-site file and deliberately omits the line number. Source coordinates remain in the API and code reader for exact inspection.
- A step may expose both ordinary arguments and a service payload when the call crosses a service boundary. The card labels each region separately rather than choosing one and hiding the other.
- For request-arrival steps, the request tree is authoritative even though there is no ordinary JavaScript caller expression. For response steps, return variants are authoritative even when no reusable callee symbol exists.
- Callee explanation and call-site summary come from current non-retired shared knowledge when present. Empty or retired knowledge produces deterministic wording from step kind and symbol facts; the UI does not invoke an agent automatically.
- “Possible cleanup” is a review queue, not a delete action. Role groups with no findings may be omitted, but analyzer limitations and the non-deletion warning are always shown.

## Out of scope
- Generating the initial knowledge batch in `personal_website`; that remains the final real-repository rollout after this task lands.
- Adding declarations or changing runtime behavior in target repositories to improve type coverage.
- Inferring semantic types beyond explicit TypeScript, JSDoc, or referenced declarations.
- Static analysis for languages outside tracked first-party JavaScript, TypeScript, JSX, and TSX.
- Retiring the remaining v2 `resources/` system or merging `repo-manager` into `main`.

## Bail conditions
- If canonical route nodes cannot be introduced without breaking flow lookup by its existing flow id or handler symbol id, preserve lookup compatibility and add a separate entry-node field rather than changing URL identity.
- If a value description or concept cannot be joined through stable source-backed IDs, show the structural fact without prose/concept linkage and fix the shared semantic identity; do not join only by display text in the browser.
- If removing the legacy payload scanners removes service or response discovery rather than only presentation, retain the smallest internal scanner needed for discovery under a non-public type and prove that no reader treats its field names as data.
- If the cleanup overview cannot distinguish roles or evidence categories from `/api/reachability`, stop and correct the server projection instead of reconstructing reachability in the browser.
