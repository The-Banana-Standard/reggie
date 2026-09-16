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

## decision · 2026-09-09 · Claude via jacobpress · high
A legacy backlog line never overrides git. Every branch, packet and pull-request check runs first; only then does the file decide. The [planned] tag alone is not enough for the planned state either — it needs the plan document to really exist, because on the first real repo 44 of 47 plan documents belonged to items the author had explicitly parked.

## decision · 2026-09-15 · Claude via jacobpress · medium
A brief earns groomed by saying something, not by passing its contract. resolveTask's brief branch consults briefDraft, so only an unfilled scaffold holds the task at ungroomed; a brief missing a size or a priority stays groomed with the lint reason on the card. That is deliberately not symmetric with the plan rule, where a failing draft holds at groomed: planned means a builder can follow this, which a contract can test, while groomed means somebody has said what this is, which only emptiness can disprove. Card age falls back to the brief's created once triage has taken the intake line, after lastActivity and the intake date.

