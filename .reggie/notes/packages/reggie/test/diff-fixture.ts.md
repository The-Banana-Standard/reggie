---
entity: packages/reggie/test/diff-fixture.ts
kind: file
---

## why · 2026-09-17 · Claude via jacobpress · high
One throwaway repo for everything that reads a task's change, because every real hazard in this feature sits in degenerate input and git's output is full of it. One in process task carries every awkward file on a single branch, and each other slug is one whole branch case: awaiting decision, zero ahead, records only, merged the base back in, net zero, large, landed by Reggie's own landing with the branch released and the base moved on, landed by fast forward, no branch, unrelated history. It turns off line ending conversion in the repo it builds, because a developer's global setting would otherwise turn the CRLF file into plain newlines on the way in and the CRLF test would pass for the wrong reason. The large branch is optional so the unit tests skip it; it costs about a second.
sources: packages/reggie/test/diff-fixture.ts, branch-diff-in-reader

## how · 2026-09-17 · Claude via jacobpress · medium
Three tasks were added for what the reviews found untested: a done task fast forwarded with its branch kept, two files whose names begin and end with a space, and a branch this clone only has as a remote tracking ref, which is written with update-ref where a fetch would have put it so that no remote and no push are needed. The hostile default branch and the tag that shadows a branch are made and removed inside their own tests, because left in the shared fixture they would change what every other test reads.
sources: packages/reggie/test/diff-fixture.ts, branch-diff-in-reader

## gotcha · 2026-09-17 · Claude via jacobpress · high
The fixture turns off git's automatic maintenance in the repo it builds. Git starts a detached maintenance process after a commit or a merge once a repo holds about a hundred loose objects, and this one holds more: measured, the same build sometimes ended with everything loose and sometimes with two packs, a test that takes one file's blob away from git failed one run in four, and once a git add racing the repack failed outright. A fixture must not depend on when a background process finishes. If a test here ever needs packed objects, pack them on purpose.
sources: packages/reggie/test/diff-fixture.ts, branch-diff-in-reader

## gotcha · 2026-09-18 · Claude via jacobpress · medium
The packet helper takes a third argument, cites, false for the one packet landTask lands: it never saved an evidence/tests.txt, and since the evidence gate a hand approval refuses a packet that cites a file nobody committed. Saving the file instead would have moved the pinned file lists of the change routes.
sources: low-risk-auto-approval

