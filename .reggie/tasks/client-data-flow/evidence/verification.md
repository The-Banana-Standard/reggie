# Client data flow verification — 2026-09-24

## Automated checks

- Final focused compiler/router/client DOM/map tests: 34 passed.
- Final full suite: `npm test` — 58 test files passed; 1329 tests passed, one existing skip (1330 total).
- `npm run typecheck` — passed.
- `npm run build` — passed.
- `node packages/reggie/dist/cli.js docs check` — both shared instruction files fresh.
- `git diff --check` — passed.
- The initial sandboxed full run failed because test HTTP listeners and tsx IPC sockets were blocked with EPERM. The authorized unrestricted reruns passed; those environment failures were not treated as code regressions.

## Real repository

Read-only acceptance against personal_website; no target application files, knowledge jobs or target Git state were modified.

The live `functions-api-chat-js-onrequestpost` flow has three production origins:

1. Submit form → ChatOverlay.handleSubmit → ChatOverlay.handlePrompt → requestChatResponse.
2. KeyDown textarea → ChatOverlay.handleKeyDown → ChatOverlay.handleSubmit → ChatOverlay.handlePrompt → requestChatResponse.
3. React effect in ChatOverlay → handlePrompt(initialQuestion, isNonEmptyString(initialPromptId) ? initialPromptId.trim() : undefined) → requestChatResponse.

All join POST /api/chat → onRequestPost. Typed submission passes inputValue without a prompt ID. The fetch request exposes all six fields: message, history, selectedPromptId, session_id, context_doc_ids, clicked_doc_ids. The displayed authored-response condition is `selectedPromptId && starterPrompt && starterPrompt.response_mode !== 'dynamic'`.

The handler's existing trace contains 124 server steps and reports 17 omitted steps at the existing breadth caps. The compact Request path intentionally stops at the handler; Full server flow restores the shared server graph. Neither mode pretends to be a runtime recording.

## Browser

In-app browser against localhost:4310:

- Bare repository URL opens Data Flow. Navigation order is Data Flow, Tasks, Overview, Services, with secondary styling and explicit Overview URL.
- Selectable form, keydown and effect origins change client cards and graph; effect arguments preserve initialQuestion and initialPromptId.
- Request payload expanded using keyboard Space; all six fields and missing-type labels were visible.
- Server conditions expanded and authored-response gate confirmed.
- Following requestChatResponse opened its dedicated symbol page, parent-file breadcrumb, code reader and direct caller list.
- Request path and Full server flow controls change only the map projection.
- Desktop 1280: document width 1265, no horizontal overflow; compact six-node graph readable with client event, functions, endpoint and handler labels.
- Phone 390 × 844: document width 375, no horizontal overflow; bottom primary/secondary navigation, wrapping cards and fitted map checked.
- Tablet 1000 × 800: document width 985, no horizontal overflow; bottom navigation stays visible and request map receives a 640px-tall frame.
- Wide 1600 × 1000: document width 1585, no horizontal overflow.
- Browser warning/error log inspection: empty.

## Known limits

React state/prop handoffs are not followed. The initial-question effect is not mislabelled as a proven suggested-message click. Dynamic callback dispatch and non-JSX event registration remain explicit limitations. A native select was exercised through browser selection; keyboard activation was verified on expandable payload details, not claimed as a full assistive-technology audit.

Portable doctor: zero errors, three warnings about the repository's existing native layout (no root HANDOFF, no Codex knowledge router, and the generic evidence path in generated instructions). Durable handoff is this native task packet, evidence and notes; no alternate workflow scaffolding was added.
