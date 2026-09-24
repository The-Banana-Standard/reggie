---
slug: complete-data-flow-view
title: Restore the complete data flow view with additive client context
risk: medium
deciders: [jacobpress]
author: jacobpress
created: 2026-09-24
---
# Restore the complete data flow view with additive client context

## Problem
The new default client-only diagram ends at the handler, hiding the downstream functions and services that made the previous view useful. Other Cloudflare endpoints are difficult to discover, and a vertical linear path wastes space.

## Approach
Keep Data Flow as the primary page. Extend its all-entry-point overview with compact, source-backed client origin summaries connected to every endpoint and its reached services. Endpoints without matched clients remain visible and are explicitly described as unmatched, not unused. Show a prominent All flows return link on each flow.

Default each flow to all detected client paths plus the existing server graph. Selecting an origin highlights its upstream edges without removing other origins or server calls. Offer an explicit Focus on this path option for the selected origin. Preserve server depth and cap notices. Fit only genuinely unbranched, acyclic chains into responsive alternating rows; retain hierarchical layouts for branches, cycles, and disconnected graphs.

## Files to touch
- packages/reggie/src/flows.ts (MOD)
- packages/reggie/src/flows.test.ts (MOD)
- packages/reggie/ui/client-flow.js (MOD)
- packages/reggie/ui/client-flow.dom.test.js (MOD)
- packages/reggie/ui/app.js (MOD)
- packages/reggie/ui/app.dom.test.js (MOD)
- packages/reggie/ui/map.js (MOD)
- packages/reggie/ui/map.dom.test.js (MOD)
- packages/reggie/ui/styles.css (MOD)
- packages/reggie/ui/DOM-CONTRACT.md (MOD)
- packages/reggie/docs/services-and-flows-spec.md (MOD)
- packages/reggie/docs/ui-api-contract.md (MOD)
- .reggie/notes/ (MOD)
- .reggie/journal/ (MOD)
- .reggie/tasks/complete-data-flow-view/ (MOD)
- AGENTS.md (MOD)
- CLAUDE.md (MOD)

## Acceptance criteria
- [ ] The overview retains every endpoint and program entry, adds known client connections, and keeps endpoints without matched clients visible with honest coverage text.
- [ ] Flow pages default to client paths plus downstream server calls and services; origin selection highlights rather than filters, with canonical navigation and an explicit All flows link.
- [ ] Optional focused linear paths use responsive alternating rows, while branches, cycles, and disconnected graphs retain their graph structure.
- [ ] Existing server story, depth controls, cap notices, full input trees, and client analysis limitations remain available; source strings remain safe text.
- [ ] Personal website acceptance verifies all three Cloudflare endpoints, chat clients and downstream functions/services, focus switching, desktop/tablet/phone layouts, keyboard controls, and no new console errors or page overflow.
- [ ] Focused tests, full suite, typecheck, build, docs checks, code/security/simplification reviews, and the completion packet are recorded before landing into repo-manager.

## Verification strategy
- Criterion 1: flow summary fixtures and DOM/model tests for every entry, unmatched origins and shared client identities.
- Criterion 2: DOM/model tests for additive edges, source links and default controls.
- Criterion 3: deterministic geometry tests for row direction and wrapping, narrow screens, and rejection of branching, cyclic or disconnected chains; real Cytoscape browser inspection.
- Criterion 4: regression tests for metadata preservation, payload details and hostile labels; compare server steps before and after projection.
- Criterion 5: local API and browser acceptance against personal_website at 1600, 1280, 1000 and 390 pixels, with actual endpoint and call evidence.
- Criterion 6: record exact commands in evidence/verification.md and self-reviews in evidence/review.md; lint plan and packet, then land through Reggie and push the integration branch.

## Assumptions
- This changes Reggie only; personal_website is the read-only acceptance target and its dirty source is preserved.
- Client matches remain static evidence, not runtime traces. Existing limits remain explicit.
- The user's approval authorizes correcting the previous feature and landing it back in repo-manager.

## Out of scope
- Target website source changes, knowledge generation, React state/prop tracing, runtime instrumentation, and unrelated navigation redesign.

## Bail conditions
- Preserve unmatched endpoints if no client evidence exists; never fabricate an origin.
- Do not force branches into a sequential path; fall back to the hierarchical graph.
- Stop landing if integration or task worktree changes overlap unowned work or verification exposes unresolved regressions.
