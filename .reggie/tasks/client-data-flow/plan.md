---
slug: client-data-flow
title: Make client-to-server data flow the primary experience
risk: medium
deciders: [jacobpress]
author: jacobpress
created: 2026-09-24
---
# Make client-to-server data flow the primary experience

## Problem
The personal website's Data Flow starts at the server even though visitors start in the browser. Repository navigation gives Overview and Services the same prominence as Data Flow and Tasks. The chat has several client origins converging on one request helper and one Cloudflare handler; a prompt ID can select an authored response, while typed messages use live retrieval. A static graph must not imply that every server branch runs on every request.

## Approach
Make bare repository URLs and initial repository selection land on Data Flow. Preserve Overview at an explicit overview URL. Group Data Flow and Tasks as primary navigation, with Overview and Services visually secondary and keyboard accessible.

Extend compiler evidence with source-backed UI event/effect bindings and enclosing call conditions. Build bounded reverse direct-call journeys from each statically matched fetch to those triggers. Keep each journey's actual arguments and request shape, node identity, source, and limits. Inline callbacks are boundaries: unknown callback execution must never become an ordinary synchronous call. Do not invent React state/prop edges. Show detected effect origins and explain the missing state handoff explicitly.

Add a client-origin selector and expandable client step cards above the shared server story. The chosen origin joins the same endpoint on the map; switching origins does not assert a runtime branch. Show server conditions as evidence and explain that this is a static map of possible calls. The website's form submit and initial-question effect must appear with inputValue versus initialQuestion/initialPromptId expressions, and the authored-response gate must remain inspectable.

## Files to touch
- packages/reggie/src/semantic-index.ts (MOD)
- packages/reggie/src/client-journeys.ts (NEW)
- packages/reggie/src/client-journeys.test.ts (NEW)
- packages/reggie/src/flows.ts (MOD)
- packages/reggie/src/flows.test.ts (MOD)
- packages/reggie/ui/client-flow.js (NEW)
- packages/reggie/ui/client-flow.dom.test.js (NEW)
- packages/reggie/ui/app.js (MOD)
- packages/reggie/ui/app.dom.test.js (MOD)
- packages/reggie/ui/map.js (MOD)
- packages/reggie/ui/map.dom.test.js (MOD)
- packages/reggie/ui/styles.css (MOD)
- packages/reggie/ui/DOM-CONTRACT.md (MOD)
- packages/reggie/docs/services-and-flows-spec.md (MOD)
- .reggie/notes/ (MOD)
- .reggie/journal/ (MOD)
- .reggie/tasks/client-data-flow/ (MOD)
- AGENTS.md (MOD)
- CLAUDE.md (MOD)

## Acceptance criteria
- [ ] Bare repository URLs, initial load and repository switching lead to Data Flow; explicit Overview and Services remain accessible, with Data Flow and Tasks visually primary.
- [ ] Compiler-backed journeys connect native JSX events and React effects through resolved direct calls to matching HTTP endpoints, preserving canonical symbol IDs and actual positional arguments.
- [ ] Anonymous callbacks, dynamic dispatch, cycles, missing clients and analysis caps are reported honestly without invented UI or state/prop links.
- [ ] Selecting a client origin updates the upstream graph and client cards while retaining the shared endpoint and server story; all entity/source links are navigable.
- [ ] Expandable request trees include all fields and nested values, missing types remain visible, and enclosing server conditions are shown without implying runtime execution.
- [ ] Real personal website acceptance shows the chat form and initial-question effect joining requestChatResponse, POST /api/chat and onRequestPost, including selectedPromptId evidence and the authored-response condition.
- [ ] Focused and full tests, typecheck, build, docs checks, code/security/simplification self-reviews and desktop/phone browser acceptance pass or have explicitly documented pre-existing limitations.

## Verification strategy
- Criterion 1: DOM router and navigation tests plus initial-load browser check.
- Criterion 2: JS/JSX/TSX fixtures for imported aliases, multiple triggers and inline callbacks.
- Criterion 3: unit fixtures for callback boundaries, shadowed effects, cycles, role filtering and bounded traversal.
- Criterion 4: DOM and graph-model tests for origin selection and canonical links.
- Criterion 5: DOM tests for full payloads, explicit/missing types and safe text rendering.
- Criterion 6: inspect real local API payload and browser against personal_website, recording source evidence and known state/prop analysis limits.
- Criterion 7: record commands and outcomes in evidence/verification.md; record self-reviews and browser acceptance in evidence/review.md; lint plan and completion packet before landing.

## Assumptions
- Work is in Reggie, using personal_website as the read-only acceptance repository. Preserve all its unrelated dirty files.
- Static call paths explain possible behavior, not a captured request trace. Initial-question effects can be proven, but UI state/prop handoffs remain explicit coverage gaps.
- Existing explicit flows links keep working; bare repo URLs intentionally become the new default, and overview content receives an explicit path.

## Out of scope
- Editing personal_website source or adding types, running knowledge generation, adding telemetry/runtime instrumentation, or inferring dynamic callback targets.
- Full React state/prop provenance, runtime scenario simulation, deleting Overview/Services, or changing task workflows.

## Bail conditions
- If client matching depends on names alone rather than compiler identity, retain the unresolved boundary and explain it.
- If target dirty files conflict with acceptance, do not change or stage them.
- If graph breadth obscures the client origin, use a selectable upstream path and retain the existing server depth controls rather than drawing all origins at once.
