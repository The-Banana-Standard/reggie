---
entity: packages/reggie/src/story.test.ts
kind: file
---

## verify · 2026-09-15 · Claude via jacobpress · high
The 'tests clause' block is a mutation-tested pin, not a smoke test. It builds three throwaway areas — one whose source files a test imports, one whose only non-source file is a build config file with a code extension, one of source files only — and asserts the clause at all three printing sites, its link to the tests lens, and its absence in the other two areas. The config-only area is the one that matters: restore the old guard and it fails, because a config file alone used to make a folder claim it had tests. Do not rewrite that area to use a project config file in JSON; that kind of file is never scanned, so the test would pass with the bug back in place.
sources: packages/reggie/src/story.test.ts, false-tests-sentence

## verify · 2026-09-15 · Claude via jacobpress · high
The coverage sentence block is a mutation-tested pin like the tests clause above it. Three purpose-built repos, one per branch: everything read and every import followed, more skipped languages than the sentence will name, and a repo with one broken import line written twice. Delete the paragraph from the story and all five tests in the block fail; drop the two fields from the counts block and most of this file fails with them. Keep the repos purpose-built rather than bending the shared fixture to one of them, and keep asserting the whole sentence rather than a fragment, because the wording is the feature.
sources: packages/reggie/src/story.test.ts, graph-coverage-published

