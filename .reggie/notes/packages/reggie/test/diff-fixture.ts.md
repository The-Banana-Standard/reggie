---
entity: packages/reggie/test/diff-fixture.ts
kind: file
---

## why · 2026-09-17 · Claude via jacobpress · high
One throwaway repo for everything that reads a task's change, because every real hazard in this feature sits in degenerate input and git's output is full of it. One in process task carries every awkward file on a single branch, and each other slug is one whole branch case: awaiting decision, zero ahead, records only, merged the base back in, net zero, large, landed by Reggie's own landing with the branch released and the base moved on, landed by fast forward, no branch, unrelated history. It turns off line ending conversion in the repo it builds, because a developer's global setting would otherwise turn the CRLF file into plain newlines on the way in and the CRLF test would pass for the wrong reason. The large branch is optional so the unit tests skip it; it costs about a second.
sources: packages/reggie/test/diff-fixture.ts, branch-diff-in-reader

