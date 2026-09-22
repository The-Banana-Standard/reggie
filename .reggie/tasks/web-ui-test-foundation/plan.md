---
slug: web-ui-test-foundation
title: Give the web UI a real DOM test lane
risk: low
deciders: [jacobpress]
author: jacobpress
created: 2026-09-22
---
# Give the web UI a real DOM test lane

## Problem
The browser modules are not executed by Vitest, so router, story, reader, and graph-model changes can regress without CI seeing them.

## Approach
Configure Vitest as two named projects: the existing Node project keeps every server, CLI, and repository test in its current environment, while a `web-dom` project loads only tests under `ui/` in jsdom. Add one reusable DOM shell fixture based on the real element IDs and exercise the production exports directly: route parsing and formatting from `app.js`, narrative rendering from `story.js`, the source drawer from `reader.js`, and view-to-element construction from `map.js`. Pin both ordinary and edge behavior that later tasks will intentionally change. Update the development documentation and make pushes to `repo-manager` run the same CI matrix as `main`.

The DOM project will not instantiate Cytoscape to claim layout correctness. Model construction is deterministic and belongs in Vitest; canvas sizing, fitting, and responsive rendering remain checks in the in-app browser. Rejected: copying helpers into test-only modules, because that would test a parallel implementation instead of the code users run.

## Files to touch
- packages/reggie/package.json (MOD)
- packages/reggie/package-lock.json (MOD)
- packages/reggie/vitest.config.ts (MOD)
- packages/reggie/ui/test/dom-fixture.js (NEW)
- packages/reggie/ui/app.dom.test.js (NEW)
- packages/reggie/ui/story.dom.test.js (NEW)
- packages/reggie/ui/reader.dom.test.js (NEW)
- packages/reggie/ui/map.dom.test.js (NEW)
- packages/reggie/README.md (MOD)
- .github/workflows/ci.yml (MOD)

## Acceptance criteria
- [ ] `npm test` runs named `node` and `web-dom` Vitest projects, with the existing TypeScript suites remaining in the Node environment and only `ui/**/*.dom.test.js` running in jsdom.
- [ ] The DOM suite imports the production `app.js` module and pins parsing plus formatting for workspace, repository, area, file, symbol, task, services, flows, and single-flow routes, including encoded path and query values.
- [ ] The DOM suite renders a real `Story` through `renderStory`, preserving section headings, entity links, expandable details, refs, and safe text handling.
- [ ] The DOM suite creates the real source reader, opens a file payload, renders line numbers and symbol markers, navigates to a requested line, and closes without leaving stale content or state.
- [ ] The DOM suite calls the real map model builder for representative repo, file, and flow payloads and pins node IDs, edge IDs, labels, classes, and payload summaries without starting Cytoscape.
- [ ] A deliberate import-time or contract-breaking mutation in each of `app.js`, `story.js`, `reader.js`, and `map.js` causes at least one DOM test to fail.
- [ ] `.github/workflows/ci.yml` runs the existing Linux and macOS job for direct pushes to both `main` and `repo-manager`, as well as pull requests.
- [ ] The package development guide explains the two test projects and states that Cytoscape layout and responsive rendering still require an in-app-browser check.
- [ ] At 1600px and 390px in the in-app browser, the repo and flow pages render with zero console errors and no horizontal overflow, and the map fits after a desktop hide/show cycle.
- [ ] From `packages/reggie`, `npm test`, `npm run typecheck`, `npm run build`, and the generated documentation check all exit zero.

## Verification strategy
- Criteria 1 through 5: run `npm test -- --reporter=verbose` and save project names and focused test output in `evidence/dom-tests.txt`.
- Criterion 6: temporarily break one tested export in each production UI module, record the four failing test names, restore the files, and save the transcript in `evidence/mutation-probe.txt`.
- Criterion 7: inspect the workflow trigger and use a YAML parse assertion; save both in `evidence/ci-trigger.txt`.
- Criterion 8: compare the package guide with the resolved Vitest project configuration; save the relevant excerpts in `evidence/docs.txt`.
- Criterion 9: drive the real server in the in-app browser at both widths, record console and overflow measurements plus the Cytoscape extent after hide/show in `evidence/browser.txt`.
- Criterion 10: save the complete test, typecheck, build, and docs-check exits in `evidence/full-verification.txt`.

## Assumptions
- jsdom is sufficient for DOM structure, events, history, and rendering assertions; real-browser geometry is deliberately verified separately.
- The production modules' existing named exports are the stable seam. If importing `app.js` boots automatically under jsdom, the fixture will set `document.readyState` and required globals rather than adding a second router implementation.
- Existing dev harnesses remain useful for visual work but are not themselves the test source; the tests may reuse their sample payloads only when the payload matches the server contract.

## Out of scope
- New symbol, route, concept, knowledge, flow, or reachability behavior.
- Pixel snapshots, screenshot baselines, or running a headed browser in CI.
- Refactoring production modules beyond a minimal testability seam proven necessary by importing the real code.

## Bail conditions
- If the browser modules cannot be imported without a production refactor that changes runtime behavior, stop after documenting the exact side effect and re-plan that seam rather than hiding it with mocks.
- If jsdom cannot support the reader or story interactions without replacing browser APIs central to their behavior, move only that interaction to a real-browser test project and amend the dependency and CI design before implementation.
