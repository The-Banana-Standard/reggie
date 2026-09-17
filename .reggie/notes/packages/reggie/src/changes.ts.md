---
entity: packages/reggie/src/changes.ts
kind: file
---

## how · 2026-09-17 · Claude via jacobpress · high
What a task changed, in three steps that each have their own function. taskRange turns a task into two full commit ids: a task that is not done and whose branch is ahead reads from the merge base to the tip; otherwise the merge taskLanding finds, against its first parent; otherwise a branch that still resolves; otherwise a sentence saying why there is nothing to read. listChanges reads the raw and the numstat listing in their null separated forms and joins them by the new path, sorted by path. fileDiff asks git for one listed file's patch, by both paths for a rename, parses it, and builds the rows the reader draws, two thousand to a page. changesPayload splits the list into files and Reggie's own records and counts the files only, which is the owner's ruling.
sources: packages/reggie/src/changes.ts, branch-diff-in-reader

## gotcha · 2026-09-17 · Claude via jacobpress · high
The patch parser never reads a path out of a patch header and never looks for a header inside a hunk. It finds a hunk by its at-sign header, then consumes exactly as many old and new lines as that header counts, taking only the first character of each line as its sign. That is what keeps a deleted line whose text is two dashes and a path, which git prints byte for byte like a file header, a deletion. The no newline marker flags the line before it and is never a line, so new side numbers cannot drift. A count of zero in a hunk header makes the start the line before rather than the first line, which the gap arithmetic depends on. Do not make it smarter about headers; every hazard the planner measured lives there.
sources: packages/reggie/src/changes.ts, branch-diff-in-reader

## decision · 2026-09-17 · Claude via jacobpress · high
A patch that cannot be trusted is answered as an unreadable card with no rows, never as best effort rows. Three things count: git failed or timed out or the patch outgrew the buffer, a hunk did not add up to its own header, and the added and deleted rows disagree with the counts git's own numstat gave for the file. The third check is why the diff algorithm is pinned for the list as well as the patch: with a person's own algorithm setting the counts and the rows would come from two different diffs and honest files would be refused. Measured over the twelve landed merges in this repo, 363 files, no file was refused.
sources: packages/reggie/src/changes.ts, branch-diff-in-reader

## verify · 2026-09-17 · Claude via jacobpress · high
The fixture repo in the test folder holds every awkward input as one in process branch plus one small branch per whole branch case, and both the unit tests and the route tests read it. A new degenerate case belongs there first, with a comment saying what git prints for it. The hostile config test writes a person's worst git settings into a fixture, proves an ordinary diff then runs the external program, and proves ours never does.
sources: packages/reggie/test/diff-fixture.ts, branch-diff-in-reader

## gotcha · 2026-09-17 · Claude via jacobpress · high
A fourth thing is answered as unreadable, and it is checked before git is asked for anything: a file whose added plus deleted count, as the list already knows it, passes a quarter of a million lines. Every row is an object in memory before a page is cut from it, so a committed file of a few million one character lines would otherwise cost hundreds of megabytes per request. The cap came out of the security pass, not the plan. Raise it only with the memory arithmetic in hand; the sixty thousand line case the plan requires is far below it.
sources: packages/reggie/src/changes.ts, branch-diff-in-reader

