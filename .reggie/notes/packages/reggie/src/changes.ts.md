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
A fourth thing is answered as unreadable: a change that would draw more than a hundred thousand rows, with context and gap rows counted. A cap on changed lines alone does not bound the rows, which the security review proved with a million line file changed at every eighth line: exactly a quarter of a million changed lines, over a million rows, half a second and 466 megabytes for one request. So the cap is applied three times, each cheaper than the work it prevents: on git's own added plus deleted count before the patch is asked for, on hunk lines as they are parsed, and on the built rows. The parser walks the text with a cursor rather than splitting it precisely so that it can stop at the budget instead of finishing, and the patch read is bounded at sixteen megabytes. A cut row's text is copied out of its line, because a slice of a five megabyte line keeps all five megabytes alive for as long as the row is cached.
sources: packages/reggie/src/changes.ts, branch-diff-in-reader

## gotcha · 2026-09-17 · Claude via jacobpress · high
The range never hands git a name. Every name is resolved once, by its full ref, to a commit id, and that id is what the landing lookup is given as its base too. The first version handed the lookup the integration branch's name, which comes from a tracked config file and so is as hostile as the repo is: a name that reads as an output option, with a ref of exactly that name so that it resolves, made an ordinary request write a file of the attacker's choosing. Resolving by full ref also stops a tag that carries a branch's name from standing in for it. A done task whose kept branch holds nothing past the base was fast forwarded, and is answered as unavailable with that reason rather than as a branch with no commits yet.
sources: packages/reggie/src/changes.ts, branch-diff-in-reader

## how · 2026-09-17 · Claude via jacobpress · high
Built rows are memoized: buildFileDiff does the expensive, immutable part (patch, parse, rows, card) and fileDiff cuts a page from it and adds the one thing that depends on this checkout's HEAD. The cache is keyed by slug, the two commit ids and the path, so an entry can never be stale, and is bounded by entries, by rows and by the text the rows carry, least recently read out first. An answer marked transient, which is a git read that failed or timed out, is never kept, so the next request asks again; every other answer, the over the cap ones included, is final.
sources: packages/reggie/src/changes.ts, branch-diff-in-reader

