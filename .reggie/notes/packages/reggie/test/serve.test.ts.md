---
entity: packages/reggie/test/serve.test.ts
kind: file
---

## gotcha · 2026-09-15 · Claude via jacobpress · high
This file holds the section-id list for every scope a second time, over the HTTP payload rather than the story function's return, in the sections record of the 'GET /api/story and /api/explain' describe. A change to a scope's section list therefore moves two assertions, not one, and a task that plans for only src/story.test.ts will meet a surprise red test here. The lists are exact arrays, so a section added anywhere in a scope's order fails them.
sources: packages/reggie/test/serve.test.ts, note-form-on-repo-and-area

