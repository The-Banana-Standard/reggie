---
entity: packages/reggie/src/flows.test.ts
kind: file
---

## verify · 2026-09-22 · Codex via jacobpress · medium
Flow tests require the real payload.session_id argument and both resolveSessionId return variants while the declared return type remains absent.

## gotcha · 2026-09-22 · Codex via jacobpress · medium
Share the immutable semantic index across the Cloudflare flow fixture. Rebuilding a TypeScript Program in every test can starve unrelated parallel Vitest workers and cause misleading server timeouts in hosted CI.

