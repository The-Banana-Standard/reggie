---
entity: packages/reggie/src/knowledge.ts
kind: file
---

## decision · 2026-09-23 · Codex via jacobpress · high
Knowledge updates validate a single structured current block, append immutable audit markers, and commit through an isolated Git index so unrelated staged and unstaged work remains untouched.
sources: shared-repo-knowledge

## gotcha · 2026-09-23 · Codex via jacobpress · high
All repository knowledge writes are refused outside the configured integration branch before an agent runs or a note changes.
sources: shared-repo-knowledge

## gotcha · 2026-09-23 · Codex via jacobpress · medium
Treat unreadable or partially written knowledge lock files as live; never steal a lock while another process may still be creating it.
## gotcha · 2026-09-23 · Codex via jacobpress · medium
If the targeted normal-index refresh fails after the integration ref moves, roll the ref back with compare-and-swap before the caller restores the knowledge files.
## gotcha · 2026-09-23 · Codex via jacobpress · medium
Reject a batch if two prepared entities ever resolve to one note file, even though digest-backed entity paths prevent known slug collisions.
## how · 2026-09-23 · Codex via jacobpress · high
Knowledge-related JSON artifacts reuse the integration-checkout lock, atomic rollback, isolated Git index, dirty-target guard, and artifact-only commit transaction used by note edits.
sources: code-entity-pages
