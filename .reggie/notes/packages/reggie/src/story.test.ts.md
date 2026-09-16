---
entity: packages/reggie/src/story.test.ts
kind: file
---

## verify · 2026-09-15 · Claude via jacobpress · high
The 'tests clause' block is a mutation-tested pin, not a smoke test. It builds three throwaway areas — one whose source files a test imports, one whose only non-source file is a build config file with a code extension, one of source files only — and asserts the clause at all three printing sites, its link to the tests lens, and its absence in the other two areas. The config-only area is the one that matters: restore the old guard and it fails, because a config file alone used to make a folder claim it had tests. Do not rewrite that area to use a project config file in JSON; that kind of file is never scanned, so the test would pass with the bug back in place.
sources: packages/reggie/src/story.test.ts, false-tests-sentence

