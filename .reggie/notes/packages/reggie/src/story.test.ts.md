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

## verify · 2026-09-15 · Claude via jacobpress · high
The 'the add-note section' block is a mutation-tested pin, not a smoke test: delete the addNoteSection call from repoStory and 12 named tests fail, delete it from areaStory and 14 do, in both this file and test/serve.test.ts. Two of its assertions look redundant and are not. The non-empty empty-text case guards a client behaviour a server-only test cannot see: renderSection drops an empty section that carries no empty block, so a section with zero paragraphs and no empty.text would vanish from the page while the exact-array assertions still passed. The repo-root case pins areaStory(ctx, '.'), which is a real page whose hint must read _repo rather than ./. Keep the degenerate repos purpose-built. The one that matters most is the single _repo note with a why entry, because that is what reggie onboard writes, so it is the state nearly every repo is actually in; before this section existed no area page in such a repo had a note form while read-first printed a sentence saying nothing was written about the folder.
sources: packages/reggie/src/story.test.ts, note-form-on-repo-and-area

## verify · 2026-09-22 · Codex via jacobpress · medium
Story routing tests require stable double-colon symbol IDs to open symbol routes and label flow nodes.

## verify · 2026-09-23 · Codex via jacobpress · high
Story route coverage expects canonical symbol, route, and concept entity URLs.
sources: code-entity-pages

