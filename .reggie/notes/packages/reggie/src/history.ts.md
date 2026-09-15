---
entity: packages/reggie/src/history.ts
kind: file
---

## how · 2026-09-15 · Claude via jacobpress · high
The log is record-separated: each commit starts with a record separator, then unit-separated fields for sha, parents, author, email, date, subject and the whole body, then the numstat lines, run with --diff-merges=first-parent. The task is the first Task: line anywhere in the body, else task/<slug> in the subject. The body is not stored. Cache version 2.
sources: task-attribution-by-merge

## gotcha · 2026-09-15 · Claude via jacobpress · high
A merge keeps its first-parent files on its LogCommit so the landing lookup can report what landed, but deriveHistory and historyForFiles skip the files of any commit with two or more parents. Counting both would double every landed task's churn and hand its lines to whoever ran the merge.
sources: task-attribution-by-merge

## how · 2026-09-15 · Claude via jacobpress · high
taskLanding(root, slug, {base, index}) finds the newest merge on the base's first-parent line whose task is the slug, with no --since, so a merge older than the index window is still found and a merge of the base into the task branch is never taken for the landing. Branch commits are merge^1..merge^2, which needs no branch. With no merge it falls back to the indexed commits naming the slug.
sources: task-attribution-by-merge

