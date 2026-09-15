---
entity: packages/reggie/src/land.ts
kind: file
---

## gotcha · 2026-09-15 · Claude via jacobpress · high
landTask refuses before writing anything: checkout not on the base, tracked changes on the base, no local task branch, uncommitted work in the task worktree, no packet on the branch. It then merges --no-ff --no-commit, writes the verdict and the decide journal entry into that merge, commits with Task: and Decided-by: lines, and releases without a journal entry. A merge that fails is aborted. A branch already in the base gets a plain verdict commit. It never pushes and signs nothing, like claim.
sources: task-attribution-by-merge

## gotcha · 2026-09-15 · Claude via jacobpress · high
Landing also refuses when the base holds untracked files the task branch carries, because git refuses that merge outright: the day's journal file is the common pair, committed on the branch by a worktree claim while the serving checkout holds its own copy. A task with no local branch can still be approved when a merge on the base landed it; it takes the already-landed path and only refuses when neither exists.
sources: task-attribution-by-merge

