---
entity: packages/reggie/src/tasks.ts
kind: file
---

## gotcha · 2026-09-06 · Claude via jacobpress · high
State derivation checks the pull request first, then the packet verdict on the default branch, then packet on the task branch, then branch existence, then plan on the default branch, then plan branch, then plan on disk. Order matters: a merged PR must win over a stale local plan.
sources: packages/reggie/src/tasks.ts

## gotcha · 2026-09-08 · Claude via jacobpress · high
State derivation order matters and is written top down: merged or approved wins over an open pull request, which wins over a packet, which wins over a branch, which wins over a plan, which wins over a brief. The plan branches sit above the brief branch on purpose, so a task that has a plan but no brief still reads as planned rather than being dragged backwards.
sources: packages/reggie/src/tasks.ts

