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

