---
entity: packages/reggie/src/knowledge-jobs.ts
kind: file
---

## how · 2026-09-23 · Codex via jacobpress · high
Knowledge inventory covers repo, folders, tracked first-party JavaScript and TypeScript files in every role, symbols, routes, concepts, and existing service/store/environment entities. Jobs preview new and stale scope, require confirmation once, persist chunk results only in the ignored cache, resume missing chunks, and publish one batch commit.
sources: shared-repo-knowledge

## verify · 2026-09-23 · Codex via jacobpress · medium
Revalidate every persisted completed chunk against the current inventory before a resumed job publishes, so editable cache files cannot bypass hostile-output validation.
