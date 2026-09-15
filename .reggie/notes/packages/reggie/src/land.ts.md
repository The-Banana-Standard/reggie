---
entity: packages/reggie/src/land.ts
kind: file
---

## gotcha · 2026-09-15 · Claude via jacobpress · high
landTask refuses before writing anything: checkout not on the base, tracked changes on the base, no local task branch, uncommitted work in the task worktree, no packet on the branch. It then merges --no-ff --no-commit, writes the verdict and the decide journal entry into that merge, commits with Task: and Decided-by: lines, and releases without a journal entry. A merge that fails is aborted. A branch already in the base gets a plain verdict commit. It never pushes and signs nothing, like claim.
sources: task-attribution-by-merge

