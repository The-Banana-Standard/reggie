---
entity: packages/reggie/test/serve.test.ts
kind: file
---

## gotcha · 2026-09-15 · Claude via jacobpress · high
This file holds the section-id list for every scope a second time, over the HTTP payload rather than the story function's return, in the sections record of the 'GET /api/story and /api/explain' describe. A change to a scope's section list therefore moves two assertions, not one, and a task that plans for only src/story.test.ts will meet a surprise red test here. The lists are exact arrays, so a section added anywhere in a scope's order fails them.
sources: packages/reggie/test/serve.test.ts, note-form-on-repo-and-area

## how · 2026-09-17 · Claude via jacobpress · medium
The last describe block starts a second server over the diff fixture repo, with the large branch included, and claims one more task into a worktree for the editor link. Its refusal cases push every body they get into one list, and the final test reads that list for git's stderr and absolute paths, so a new refusal case should go through the same helper to stay covered. The large branch adds about a second to the suite.
sources: packages/reggie/test/serve.test.ts, branch-diff-in-reader

## how · 2026-09-17 · Claude via jacobpress · medium
The last describe block builds its own small repo holding one derived entry and one hand entry, starts a third server over it, and checks that both journal routes return the derived object with the mark kept out of the text. It writes into its own repo so the shared fixture's journal counts are untouched.
sources: derive-the-journal

