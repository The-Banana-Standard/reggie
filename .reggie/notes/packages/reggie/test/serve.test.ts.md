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

## how · 2026-09-18 · Claude via jacobpress · medium
The idea-action block at the end starts its own server over a fresh fixture with the origin shapes added to it (a file with a space, one with non-ASCII letters, a symlink into the repo and one out of it, a file indexed but gone from disk, an ignored cache file), because adding those files to the shared fixture would move the file counts and section lists the earlier blocks pin. Its launch cases stub the platform away from darwin through one helper so nothing in it can open a Terminal window. The team-mode case connects over the machine's own network address with the minted key, and returns early when the machine has no non-internal interface.
sources: idea-from-every-page

## verify · 2026-09-22 · Codex via jacobpress · medium
Server contract tests expect the TypeScript symbol engine and exercise semantic-index-backed search through the existing route.

## gotcha · 2026-09-22 · Codex via jacobpress · medium
Keep the numeric-days contract as one parameterized case per API route. Combining all 36 requests in one test makes an unrelated saturated CI worker consume the whole per-test timeout and hides which route failed.

