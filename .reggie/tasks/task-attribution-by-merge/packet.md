---
slug: task-attribution-by-merge
title: Join commits to tasks by the merge commit
risk: low
author: jacobpress
date: 2026-09-15
branch: task/task-attribution-by-merge
base: repo-manager
verdict: approved
decided_by: jacobpress
decided_at: 2026-09-15T22:43:23.517Z
---
# Completion: Join commits to tasks by the merge commit

Read this top to bottom to decide whether the work is done. Every claim should point at evidence.

## Acceptance criteria
- [x] `parseNumstatLog` returns task `about-this-repo` for a record whose body has `Task: about-this-repo` in a paragraph above a `Co-Authored-By` paragraph, and task `feat-b` for a commit with subject `task/feat-a: x` and body line `Task: feat-b`.
  evidence: .reggie/tasks/task-attribution-by-merge/evidence/tests.txt ("history parsing > reads Task from anywhere in the body and prefers it to the subject")
- [x] `readGitLog` on a temp repo with a `--no-ff` merge returns the merge commit with two parents and a non-empty file list equal to `git diff --numstat <merge>^1 <merge>`.
  evidence: .reggie/tasks/task-attribution-by-merge/evidence/tests.txt ("attribution by merge commit > reads a merge's files against its first parent and keeps them out of churn")
- [x] After that merge, `historyFor(index, "src/a.ts").linesChanged` and `.commits365` equal the values from the branch commits alone, so the merge adds nothing to per-file churn or commit counts.
  evidence: .reggie/tasks/task-attribution-by-merge/evidence/tests.txt (the same test compares src/a.ts, src/c.ts, src/ and historyForFiles with and without the merge)
- [x] A disk cache written with version 1 is ignored and rewritten as version 2 on the next `repoHistory` call.
  evidence: .reggie/tasks/task-attribution-by-merge/evidence/tests.txt ("history > ignores a cache written before merges carried parents and rewrites it at version 2")
- [x] `taskLanding(root, slug)` on a temp repo where `task/<slug>` was merged `--no-ff` and then deleted returns the merge sha and exactly the branch's commits with their shas, subjects, authors and files.
  evidence: .reggie/tasks/task-attribution-by-merge/evidence/tests.txt ("attribution by merge commit > finds a landed task's commits by slug after the branch is gone")
- [x] `taskLanding` finds the landing merge when the index is read with `since` set later than the merge date (outside the window), and ignores a `Merge branch 'main' into task/<slug>` commit made on the task branch.
  evidence: .reggie/tasks/task-attribution-by-merge/evidence/tests.txt ("attribution by merge commit > finds the landing outside the index window and never takes a merge into the branch for it")
- [x] `reggie decide <slug> approved` in solo mode on a clean base checkout leaves one new merge commit on the base with two parents, subject `merge: task/<slug> — <title>`, body containing `Task: <slug>` and `Decided-by: <handle>`, and `verdict: approved` in the packet at that commit.
  evidence: .reggie/tasks/task-attribution-by-merge/evidence/decide-merge.txt (a real CLI run: merge 94e6d5e with parents be7da35 and 0ebfa17, the message, and the packet at HEAD); .reggie/tasks/task-attribution-by-merge/evidence/tests.txt ("landTask > merges an approved task with the verdict inside the merge commit, releases it, and pushes nothing")
- [x] After that decide, `git branch --list task/<slug>` prints nothing, `.worktree/<slug>` does not exist, `git log origin/<base>` is unchanged (nothing pushed), and `getTask` reports state `done`.
  evidence: .reggie/tasks/task-attribution-by-merge/evidence/tests.txt (the same landTask test, against a bare origin: origin/main sha compared before and after, no task branch on the remote, state done); .reggie/tasks/task-attribution-by-merge/evidence/decide-merge.txt (branch list shows only main, worktree dir removed)
- [x] When the merge conflicts, `decide approved` exits non-zero with a message naming the conflicted file, and afterwards the base sha, the task branch sha, `git status --porcelain` and the packet verdict on both branches equal their values before the command.
  evidence: .reggie/tasks/task-attribution-by-merge/evidence/decide-conflict.txt (exit 1, "conflicts in src/auth/login.ts", identical shas and empty status before and after, no merge in progress, worktree present); .reggie/tasks/task-attribution-by-merge/evidence/tests.txt ("landTask > aborts a conflicting merge and leaves both branches, the tree and the verdicts as they were")
- [x] `decide approved` refuses with a named reason, and changes no sha or file, when the checkout is not the base branch, when tracked files are modified, or when the task worktree has uncommitted changes.
  evidence: .reggie/tasks/task-attribution-by-merge/evidence/tests.txt (the three "landTask > refuses …" tests, each comparing a snapshot of shas, status, verdicts and merge state)
- [x] `decide approved` on a branch already contained in the base creates no merge commit, commits the verdict on the base with a `Task:` line, releases the branch, and prints `already landed`.
  evidence: .reggie/tasks/task-attribution-by-merge/evidence/tests.txt ("landTask > records the verdict without a second merge when the branch has already landed, and says so", run through the CLI)
- [x] `POST /api/decide` with `approved` in solo mode performs the same landing: the response carries a 40-hex `merge` sha, the task reads `done`, and `GET /api/task/<slug>` `completion.diff.filesChanged` is greater than 0 after the task branch is gone.
  evidence: .reggie/tasks/task-attribution-by-merge/evidence/tests.txt ("POST writes > approves a packet that only exists on the task branch and moves the card to done" and "the completed view > says what was actually done for a finished task")
- [x] `reggie decide <slug> needs-work` still only writes the verdict into the packet and creates no commit.
  evidence: .reggie/tasks/task-attribution-by-merge/evidence/tests.txt ("landTask > leaves needs-work as a verdict written into the packet, with no commit", run through the CLI in the task worktree)
- [x] The build prompt from `launchCommand` contains `Task: <slug>` described as a line in the commit message body and no longer contains the word `trailer`.
  evidence: .reggie/tasks/task-attribution-by-merge/evidence/tests.txt ("launchCommand > a build knows it is already claimed, runs the review policy, and commits with a Task line in the body")
- [x] Run in this worktree, `readGitLog` attributes merge commits 56334b1, c41a73e and 8cf4e92 to `about-this-repo`, `layout-modes` and `mobile-ui`, and `npm test` and `npm run typecheck` pass in packages/reggie.
  evidence: .reggie/tasks/task-attribution-by-merge/evidence/real-merges.txt (all three, plus the journal-collision merge c0502ae, with their branch commits); .reggie/tasks/task-attribution-by-merge/evidence/tests.txt (30 files, 551 passed, 1 skipped, exit 0); .reggie/tasks/task-attribution-by-merge/evidence/typecheck.txt (exit 0)

## Evidence
- .reggie/tasks/task-attribution-by-merge/evidence/tests.txt — full verbose `vitest run`, 551 passed, 1 skipped, exit 0
- .reggie/tasks/task-attribution-by-merge/evidence/typecheck.txt — `npm run typecheck`, exit 0
- .reggie/tasks/task-attribution-by-merge/evidence/decide-merge.txt — a throwaway solo repo, claim in a worktree, `reggie decide approved` from this branch's CLI source
- .reggie/tasks/task-attribution-by-merge/evidence/decide-conflict.txt — the same with a conflicting commit on main
- .reggie/tasks/task-attribution-by-merge/evidence/real-merges.txt — `readGitLog` and `taskLanding` from this branch run against the repo-manager checkout

## Changes
Two commits against repo-manager: 3e0a05f is the implementation, 206741e fixes the two review findings with a test each. The implementation covers: `history.ts` (record-separated log, parents, Task from the body, merge files out of churn, `taskLanding`), a new `land.ts` (the solo landing), `cli.ts` and `serve.ts` (both decide paths use it, the completed view reads from the landing), `claim.ts` (release can skip its journal entry), `launch.ts` (prompt wording), tests beside each, notes for every changed file, and the shipped line in the vision doc. `npm run build` also succeeds.

## Reviews
- The repo's own checks: `vitest run` (551 passed, 1 skipped), `npm run typecheck` (exit 0), and `npm run build` (exit 0).
- `/code-review` ran over the branch at the decider's request, though the computed risk is low. It reported two findings, both real and both fixed in 206741e, each with a test:
  - Landing checked only tracked files, so an untracked file on the base that the branch also carries made git refuse the merge, reported only as a generic failure. The everyday case is today's journal file: a worktree claim commits it on the branch while the serving checkout holds an untracked copy, and the `repo-manager` checkout was in exactly that state at the start of this session. A second case is a packet left untracked on the base by a needs-work decision from the web page. Landing now refuses up front and names the files ("refuses when the base holds untracked files the merge would overwrite, naming them").
  - Approval required a local task branch, so a task merged by hand and released before anyone decided could no longer be approved at all, a regression against the previous verdict-only behaviour. Approval now proceeds when a merge on the base landed the task, taking the already-landed path, and only refuses when there is neither a branch nor a landing merge (two tests: "approves a task whose branch was merged and released before anyone decided" and "refuses when there is neither a branch nor a merge that landed the task").
- No `/security-review` was run; the change adds no network, auth or input-parsing surface beyond git output it already read.
- Behaviour was also checked end to end outside the test suite with the two throwaway-repo transcripts above.

## Deviations from plan
- `taskLanding` always scans the base's first-parent merges once, with no `--since`, instead of walking the index's parents first and scanning only as a fallback. It is one git call either way, gives the same answer inside and outside the window, and does not depend on the index having been read from the base.
- The completed view reports the landing merge as a separate `merge` field instead of prepending it to `commits`, so `commits` stays the branch commits and `commits.length` still equals `diff.commits`.
- `claim.ts` was touched though it was not in Files to touch: `releaseTask` gained `journal: false`, because a release entry written after the merge commit left the base checkout dirty and made the next landing refuse.
- `tasks.test.ts` was not changed; the done-after-landing check lives in `land.test.ts`, which exercises `getTask` directly.
- The already-landed and needs-work criteria are tested through the real CLI (spawned with tsx) rather than by calling functions, so the printed text is what is asserted.
- After the review, approval no longer requires a local task branch: a task landed by a merge on the base can be approved after its branch is released, which keeps the behaviour that existed before this task. The plan assumed a branch was always there.

## Discovered issues
- The packet scaffold pairs criteria with evidence files by position, which pointed this packet's criteria at unrelated files. Captured as `the-packet-scaffold-pairs-each-acceptance-criter`.
- The web page's own note, journal, triage and capture writes leave the serving checkout dirty, so a solo Approve on the page refuses until they are committed by hand. Captured as `the-web-page-s-own-writes-notes-journal-entries`.

## Open risks
- A solo Approve from the web view still refuses while the page's own writes leave tracked files modified in the serving checkout, until the captured issue above is fixed. The refusal names the files, so it is visible rather than silent, and untracked leftovers are now named too instead of failing inside git.
- `reggie decide <slug> needs-work` run from the base checkout still fails when the packet exists only on the task branch, as it did before; the web route copies the packet in, the CLI does not. Unchanged by this task.
- A commit body containing the ASCII record or unit separator characters would split a record in the parser. None exist in this repo; it would show as a commit with a truncated body or a missing Task.
- If one slug has landed more than once, `taskLanding` returns the newest merge only.
- Reading merges with `--diff-merges=first-parent` makes the year's log and its cache larger by each merge's diff; on a repo with very large merges the first history read after a new HEAD would be slower.
- Tasks merged by squash or fast-forward before this change still have no merge commit; `taskLanding` falls back to the commits the index attributes to the slug, which is empty once those commits carry no Task line.

## Decision
- approved by jacobpress on 2026-09-15: Criteria met with evidence; code review ran and both findings are fixed with tests.
