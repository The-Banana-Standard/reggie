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

## how · 2026-09-18 · Claude via jacobpress · high
One landing at a time. landTask takes a lock before its first check and drops it in a finally: a file under the git directory every worktree shares, created with its content in one step by a hard link so no reader ever sees it empty, holding the pid, the slug, the instant and a random token. A live lock is a refusal that names the other landing, with no waiting and no polling, because the server answers one request at a time. A lock whose pid is dead or that is older than ten minutes is replaced once: moved aside by an atomic rename, checked to be the stale lock that was read and not a fresh one that took its place, and put back if it was fresh. A holder only ever removes a lock carrying its own token. It refuses while MERGE_HEAD exists, before the dirty check so the sentence says which it is, and abortOwnMerge aborts only when MERGE_HEAD names the very commit this call asked git to merge. Ten rounds of two approvals started together on 2026-09-18: one landed and one was refused cleanly every time, with no half merge.
sources: low-risk-auto-approval

## gotcha · 2026-09-18 · Claude via jacobpress · high
git merge --abort is not enough to take back what recordApproval wrote. It keeps a file's unstaged changes, and refuses outright when such a file is also part of the merge, which the intake file is on most branches: a capture that wrote a line and then threw left the base dirty, or left the merge in progress. So recordApproval remembers the intake, the packet and the day's journal file as they were, on disk and in the index, and puts each back before the caller aborts; a file that was not in the index is taken out of it again rather than staged, so an untracked journal day file is never swept into the abort. The test with the intake on both sides of the merge fails without this.
sources: low-risk-auto-approval

## how · 2026-09-18 · Claude via jacobpress · high
The evidence gate runs before anything is written, on the packet's citations against the branch tip, or against the base for a task that has already landed. There is no override flag: fixing a citation is a one-line commit, and an override would make the gate advice. A packet that cites nothing, one exactly as scaffolded included, merges by hand as it always did. Between git merge --no-commit and the commit, recordApproval captures the packet's Discovered issues that the merged intake does not hold, so the landing, the verdict, the journal line and the captures are one commit; LandResult.captured carries the slugs. It does not run on needs-work or in team mode, which never reach landTask.
sources: low-risk-auto-approval

