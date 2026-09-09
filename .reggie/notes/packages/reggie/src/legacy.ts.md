---
entity: packages/reggie/src/legacy.ts
kind: file
---

## gotcha · 2026-09-09 · Claude via jacobpress · high
History files drop the colon after the slug once a line becomes a record rather than a to-do: 95 of 108 lines in one real file read 'slug text', not 'slug: text'. Requiring the colon silently dropped every one of them. The bare form is only accepted for a hyphenated lowercase token, so an ordinary sentence's first word is never mistaken for a slug.

## why · 2026-09-09 · Claude via jacobpress · high
Reads the backlog a repo already kept — TASKS.md, HISTORY.md and an old per-slug plan folder — as a task source, in place, without ever writing to it. Without this the tasks page is not empty but wrong: on personal_website it showed four captured items over a real backlog of 207 lines. Tags are matched against a whitelist rather than a bracket pattern, and never inside a code span, because backlogs about tooling discuss the very tags they use.
sources: TASKS.md, HISTORY.md

