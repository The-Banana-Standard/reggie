---
entity: packages/reggie/src/knowledge.test.ts
kind: file
---

## verify · 2026-09-23 · Codex via jacobpress · high
Knowledge fixtures pin legacy compatibility, schema rejection, stale fingerprints, immutable history, retirement, revision and branch conflicts, repository locks, atomic batches, and preservation of unrelated Git state.
sources: shared-repo-knowledge

## verify · 2026-09-23 · Codex via jacobpress · medium
Knowledge write tests prove an unreadable live lock is preserved and rejected rather than stolen.
## verify · 2026-09-23 · Codex via jacobpress · medium
A real Git index lock forces the post-commit path refresh to fail; the test proves HEAD rolls back and the new knowledge note is removed.
## verify · 2026-09-23 · Codex via jacobpress · medium
Batch fixtures prove formerly colliding route IDs publish to two distinct knowledge note files.
