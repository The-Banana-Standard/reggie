---
entity: packages/reggie/ui/test/dom-fixture.js
kind: file
---

## gotcha · 2026-09-22 · Codex via jacobpress · medium
The DOM fixture supplies a fresh Storage implementation because Node 26's incomplete global localStorage can shadow jsdom unless Node receives a localstorage file flag.

