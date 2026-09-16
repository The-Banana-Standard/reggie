---
entity: packages/reggie/src/brief.ts
kind: file
---

## why · 2026-09-08 · Claude via jacobpress · high
The brief is the cheap half of grooming: written from the intake line, the notes and the graph without reading much code, it gives a task a problem statement, an area, a size and a priority. Its presence is what makes a task groomed. Deliberately not lint-gated for the state transition, unlike the plan: a scaffolded brief still moves the card, because shaping is meant to be quick and iterative.
sources: packages/reggie/src/brief.ts, docs/tasks-page-spec.md

## how · 2026-09-15 · Claude via jacobpress · medium
briefDraft answers whether a brief is still the scaffold triage wrote, and resolveTask consults it: a draft holds the task at ungroomed with a reason naming what is missing. It reads lintBrief's own errors rather than re-deriving them, and counts only two kinds — a section still holding its parenthesised hint, and a Problem that is missing or empty. An unset size or priority is deliberately not a draft: that is a brief somebody wrote and has not finished, which is visible work.

