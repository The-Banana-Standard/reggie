---
entity: packages/reggie/src/triage.ts
kind: file
---

## gotcha · 2026-09-15 · Claude via jacobpress · medium
scaffoldBrief removes the slug's intake lines, and two orderings are load-bearing. The removal runs after the write and only when a write happened, so a throw leaves the line where it was rather than destroying both records of the item at once; and every line carrying the slug is read into the Problem, not just the first, because removal takes them all and reading one while deleting two loses the second wording silently. Under --force with no line left, the title and the Problem fall back to the brief already on disk, because by then the brief is the only place the captured words live.

