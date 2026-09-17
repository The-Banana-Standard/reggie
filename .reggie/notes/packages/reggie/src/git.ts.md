---
entity: packages/reggie/src/git.ts
kind: file
---

## gotcha · 2026-09-17 · Claude via jacobpress · high
The three range readers and their small helpers take full forty character commit ids and throw before git is spawned for anything else, because a revision that begins with a dash is an option: handed an output flag, git tried to write that file. Names are resolved once, by resolveCommit, and only its answer goes on. Revisions sit after end of options and paths after the double dash, under literal pathspecs, so exclude magic and globs name files instead of matching them. No external diff and no textconv are part of the security posture, not only of correctness: a read route must not run a program the repo's config names. They return null for a failed or timed out read and an empty string for an empty diff; the older helpers beside them return an empty string for both, which is why they were not reused.
sources: packages/reggie/src/git.ts, branch-diff-in-reader

## how · 2026-09-17 · Claude via jacobpress · high
diffRangeArgs is the one place the diff arguments are built, exported so a test can read exactly what git is handed, the way the history log's arguments are. Everything a person's git settings could change is pinned there for all three shapes: colour, renames, the algorithm, quoting, blank context stripping, and for a patch the context width, the merging of nearby hunks and the two prefixes. Blob sizes and blob text are asked by blob id, and the blob a path holds at a commit is asked through ls-tree with the path after the double dash, so a path from a request is never spliced into a revision.
sources: packages/reggie/src/git.ts, branch-diff-in-reader

## gotcha · 2026-09-17 · Claude via jacobpress · high
The shared runner treats any spawn error as a failure, not only a non zero status. Output that outgrows the buffer is reported by node as an error beside a status of zero whenever the child had already exited, measured at five runs in six for a small patch, so judging by status alone passed over limit output off as a clean read. patchFor takes a byte bound for exactly that reason: what is turned into row objects on a request must be bounded where it is read.
sources: packages/reggie/src/git.ts, branch-diff-in-reader

