---
entity: packages/reggie/src/claim.ts
kind: file
---

## gotcha · 2026-09-06 · Claude via jacobpress · high
Ownership comes from the claim record committed on the task branch, not from the tip author. Releasing refuses another person's branch and refuses unmerged commits unless forced; the claim commit itself does not count as unmerged work.
sources: packages/reggie/src/claim.ts

## gotcha · 2026-09-15 · Claude via jacobpress · high
A worktree claim writes its journal entry in the worktree and commits it in the claim commit beside claim.md, so the serving checkout that performs the merge is never left holding it uncommitted. An in-place claim and every resume write the entry uncommitted in the checkout they run in. Committing it in place would track a dirty day file that release then cannot switch away from, and a resume commit would count as unmerged work beyond the claim.
sources: packages/reggie/src/claim.ts:84

## gotcha · 2026-09-15 · Claude via jacobpress · high
releaseTask takes journal: false from landTask. The decide entry is already inside the merge commit, and a release entry written after it would leave the base checkout dirty, which makes the next landing refuse.
sources: task-attribution-by-merge

## gotcha · 2026-09-15 · Claude via jacobpress · high
A worktree claim prepares dependencies through prepareDeps every time, on a fresh claim and on a resume, and returns one outcome per configured directory in result.deps. A resume is not a no-op: a link made before the branch changed its lockfile is removed and replaced by an install. releaseTask unlinks before git worktree remove --force, because a worktree holding a link into the serving checkout is the one way this could delete the dependencies it shares. Never rm -r through that link; unlink it.
sources: packages/reggie/src/claim.ts, a-task-worktree-has-no-node-modules-so-nothing-r

