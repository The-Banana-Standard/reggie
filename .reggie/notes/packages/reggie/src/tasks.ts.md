---
entity: packages/reggie/src/tasks.ts
kind: file
---

## gotcha · 2026-09-06 · Claude via jacobpress · high
State derivation checks the pull request first, then the packet verdict on the default branch, then packet on the task branch, then branch existence, then plan on the default branch, then plan branch, then plan on disk. Order matters: a merged PR must win over a stale local plan.
sources: packages/reggie/src/tasks.ts

