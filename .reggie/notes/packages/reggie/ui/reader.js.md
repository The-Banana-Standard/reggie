---
entity: packages/reggie/ui/reader.js
kind: file
---

## how · 2026-09-17 · Claude via jacobpress · high
The reader has two modes and its identity is the path plus the diff slug, so the same path in the other mode is always a reload. Plain mode splits a file's text into numbered rows. Diff mode draws rows the server already built, with the same line elements: only a row with a new side number carries data-line, which is what scrollTo, the highlight and select to note key on in both modes, so a deleted row and a gap row are simply not addressable. Symbol marks are dropped in diff mode because they are computed from this checkout's text. The mode button asks the page to rewrite the diff query rather than flipping itself, so the address always says what is on screen. diffUrl is exported because the page asks the same address first and the fetch cache must recognise the reader's request.
sources: packages/reggie/ui/reader.js, branch-diff-in-reader

## gotcha · 2026-09-17 · Claude via jacobpress · medium
Nothing here has an automated test, which is why no arithmetic lives here: row kinds, line numbers, gaps, the no newline flag and the cut all arrive from the server. If a diff looks wrong, the bug is almost certainly in the changes module and has a test waiting to be written there. The banner's extra note is looked up by class and removed by the plain mode's code, so the landed file has changed since message deliberately uses the banner text class instead. In diff mode the editor link uses the payload's address alone and hides without one; falling back to the checkout root would open the unchanged file at the branch's line numbers.
sources: packages/reggie/ui/reader.js, branch-diff-in-reader

## gotcha · 2026-09-17 · Claude via jacobpress · high
In diff mode the reader's identity has a third part: the two commits the change was read between. Path and slug alone are the same before and after a task is sent back and fixed, and the first version kept what it had drawn, so the owner would have decided on the old change while the task page beside it showed the new counts. What is drawn is kept only when a fresh answer carries the same range; the page hands that answer in, and without one the reader asks for the first page again past the fetch cache. Paging compares every page's range with the first and starts over with a sentence in the banner rather than append rows of another change. Closing the reader forgets the way back to a change and redraws the button, because reopening the same plain file redraws nothing. Select to note is not offered on a file the page has no note form for.
sources: packages/reggie/ui/reader.js, branch-diff-in-reader

## gotcha · 2026-09-23 · Codex via jacobpress · high
Declaration reader identity includes the exact source span as well as path and mode, so navigating between two symbols in one file cannot leave the prior declaration visible. Full-file mode pages by source revision.
sources: code-entity-pages

