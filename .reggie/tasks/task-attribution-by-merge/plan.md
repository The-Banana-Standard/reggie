---
slug: task-attribution-by-merge
title: Join commits to tasks by the merge commit
risk: low
deciders: []
author: jacobpress
created: 2026-09-15
---
# Join commits to tasks by the merge commit

## Problem
Reggie cannot reliably say which commits belong to a task. The history log reads `Task:` only from git's trailer block (`%(trailers:key=Task)`). Sessions write the line in its own paragraph above `Co-Authored-By`, so git never treats it as a trailer. All three hand merges on this branch (mobile-ui, layout-modes, about-this-repo) carry it there and parse as no task. The log also runs `--numstat` without a merge diff option, so every merge commit arrives with zero files. `completionCommits` in serve.ts therefore returns nothing once `task/<slug>` is deleted, and the Completed view shows no files, lines or commits. The same gap blocks `reggie journal derive` for finished tasks. Underneath, nothing in Reggie performs a merge. `decide approved` (CLI) and `POST /api/decide` (web) only write a verdict, so a task reads as done while its branch is still unmerged, and whether a merge commit ever exists depends on a person's habit.

## Approach
Three parts, one shared log shape.

**1. The log carries bodies and merge files (history.ts).** Replace the pipe-delimited header with a record-separated format: `%x1e%H%x1f%P%x1f%an%x1f%ae%x1f%aI%x1f%s%x1f%b%x1f`, run with `--numstat -M --diff-merges=first-parent` (git 2.55 here; the probe against 56334b1 printed the merge's 16 files and its full body). `parseNumstatLog` splits records on `\x1e` and fields on `\x1f`; whatever follows the last field is numstat lines, parsed as today. The task comes from a body line matching `^Task:\s*<slug>\s*$` (case-insensitive key, first valid slug). If no body line matches, `taskFromSubject` is the fallback. When they disagree, the body wins. `LogCommit` gains `parents: string[]`. The body itself is not stored. `CACHE_VERSION` goes to 2, so every old cache is re-read. One exported `historyLogArgs(range)` builds the git arguments, so serve.ts stops duplicating them.

**No double counting.** A merge's first-parent files stay on its `LogCommit`, because the landing lookup needs them. `deriveHistory` and `historyForFiles` skip the file lists of commits with two or more parents. Churn, ownership, hotspots and per-path recent lists keep attributing lines to the branch commits and their real authors. The merge still counts once toward the repo (`./`), as it does today.

**2. One lookup for a landed task (history.ts, `taskLanding(root, slug, opts)`).** It returns `{ merge: LogCommit | null, commits: LogCommit[] }`:
- It finds the landing merge on the base branch's first-parent chain: the newest commit there with two or more parents whose task is the slug. Merges into a task branch (`Merge 'repo-manager' into task/x`) sit off that chain and are never mistaken for a landing. The chain walk uses the index's `parents`.
- If no merge is in the index window, one unbounded `git log --first-parent --merges` over the base (header and body fields only, no numstat) finds it. A match is then read once with numstat.
- The branch commits are `git log <merge>^1..<merge>^2`, read with the same args and parser. That is one git call, and it does not need the branch.
- If there is no merge at all, `commits` is the index commits whose task is the slug and `merge` is null. That covers work merged by fast-forward or squash before this change.

serve.ts `completionCommits` uses `taskLanding` first and keeps its existing `base..task/<slug>` fallback for a branch that still exists. When a merge is found, `completionDiff` takes files and lines from the merge alone (the first-parent diff is exactly what landed) and counts commits from the branch commits. The commit list shown is the merge plus the branch commits.

**3. An approval lands the branch (new `land.ts`, used by both `cli.ts decide` and `serve.ts /api/decide`).** Solo mode and verdict `approved` only. `needs-work`, and team mode, keep today's verdict-only behaviour. `landTask(paths, config, slug, person, comment)`:
1. Preconditions, all checked before anything is written. The failure message names each one.
   - The serving checkout is on the base branch.
   - It has no staged or unstaged changes to tracked files. git's `merge --abort` cannot promise to restore those, so the merge is refused rather than risked.
   - Local `task/<slug>` exists.
   - The task worktree `.worktree/<slug>`, if present, has no uncommitted changes. Release would otherwise force-remove them.
   - A packet exists on the branch.
2. If the branch is already an ancestor of the base (already merged, or nothing ahead), it does not merge. It records the verdict as one ordinary commit on the base, `decide: <slug> approved` with a `Task:` line, releases the branch, and reports "already landed", naming the existing merge sha from `taskLanding` when there is one.
3. Otherwise it runs `git -c commit.gpgsign=false merge --no-ff --no-commit task/<slug>`. On a non-zero exit it runs `git merge --abort` and throws a message that lists the conflicted paths, with nothing recorded.
4. With the merge staged, the packet from the branch is in the working tree. `decidePacket` writes the verdict into it, `appendJournal` writes the decide entry, and both are staged. Then it commits: subject `merge: task/<slug> — <plan title>`, body the decision comment if given, then a final paragraph `Task: <slug>` and `Decided-by: <handle>`. The verdict, the journal line and the landing are one commit, so the task can never read done without having landed.
5. It calls the existing `releaseTask` (worktree and local branch). It never pushes. If release throws, the merge stands and the message says what was not released.
6. It returns `{ merge: sha | null, alreadyLanded, released: string[] }`. The CLI prints it. The web route returns it in the JSON beside the existing fields.

The rejected alternative for step 4 was committing the verdict on the task branch first, which is what the hand merges did. An abort would then leave the task branch changed and showing an approved packet, and the brief requires both branches exactly as they were.

**Prompt and notes.** launch.ts's build prompt says to put a `Task: <slug>` line in the commit message body instead of calling it a trailer. claim.ts needs no change, since its `-m "Task: <slug>"` paragraph already parses. After each file changes, the notes for history.ts, serve.ts, cli.ts, launch.ts, git.ts (if touched), tasks.ts and the new land.ts are added or corrected.

## Files to touch
- packages/reggie/src/history.ts (MOD)
- packages/reggie/src/history.test.ts (MOD)
- packages/reggie/src/land.ts (NEW)
- packages/reggie/src/land.test.ts (NEW)
- packages/reggie/src/serve.ts (MOD)
- packages/reggie/test/serve.test.ts (MOD)
- packages/reggie/src/cli.ts (MOD)
- packages/reggie/src/launch.ts (MOD)
- packages/reggie/src/launch.test.ts (MOD)
- packages/reggie/src/tasks.test.ts (MOD)
- docs/repo-manager-vision.md (MOD)

## Acceptance criteria
- [ ] `parseNumstatLog` returns task `about-this-repo` for a record whose body has `Task: about-this-repo` in a paragraph above a `Co-Authored-By` paragraph, and task `feat-b` for a commit with subject `task/feat-a: x` and body line `Task: feat-b`.
- [ ] `readGitLog` on a temp repo with a `--no-ff` merge returns the merge commit with two parents and a non-empty file list equal to `git diff --numstat <merge>^1 <merge>`.
- [ ] After that merge, `historyFor(index, "src/a.ts").linesChanged` and `.commits365` equal the values from the branch commits alone, so the merge adds nothing to per-file churn or commit counts.
- [ ] A disk cache written with version 1 is ignored and rewritten as version 2 on the next `repoHistory` call.
- [ ] `taskLanding(root, slug)` on a temp repo where `task/<slug>` was merged `--no-ff` and then deleted returns the merge sha and exactly the branch's commits with their shas, subjects, authors and files.
- [ ] `taskLanding` finds the landing merge when the index is read with `since` set later than the merge date (outside the window), and ignores a `Merge branch 'main' into task/<slug>` commit made on the task branch.
- [ ] `reggie decide <slug> approved` in solo mode on a clean base checkout leaves one new merge commit on the base with two parents, subject `merge: task/<slug> — <title>`, body containing `Task: <slug>` and `Decided-by: <handle>`, and `verdict: approved` in the packet at that commit.
- [ ] After that decide, `git branch --list task/<slug>` prints nothing, `.worktree/<slug>` does not exist, `git log origin/<base>` is unchanged (nothing pushed), and `getTask` reports state `done`.
- [ ] When the merge conflicts, `decide approved` exits non-zero with a message naming the conflicted file, and afterwards the base sha, the task branch sha, `git status --porcelain` and the packet verdict on both branches equal their values before the command.
- [ ] `decide approved` refuses with a named reason, and changes no sha or file, when the checkout is not the base branch, when tracked files are modified, or when the task worktree has uncommitted changes.
- [ ] `decide approved` on a branch already contained in the base creates no merge commit, commits the verdict on the base with a `Task:` line, releases the branch, and prints `already landed`.
- [ ] `POST /api/decide` with `approved` in solo mode performs the same landing: the response carries a 40-hex `merge` sha, the task reads `done`, and `GET /api/task/<slug>` `completion.diff.filesChanged` is greater than 0 after the task branch is gone.
- [ ] `reggie decide <slug> needs-work` still only writes the verdict into the packet and creates no commit.
- [ ] The build prompt from `launchCommand` contains `Task: <slug>` described as a line in the commit message body and no longer contains the word `trailer`.
- [ ] Run in this worktree, `readGitLog` attributes merge commits 56334b1, c41a73e and 8cf4e92 to `about-this-repo`, `layout-modes` and `mobile-ui`, and `npm test` and `npm run typecheck` pass in packages/reggie.

## Verification strategy
- Criterion 1: a new unit test in history.test.ts, "reads Task from anywhere in the body and prefers it to the subject". Output in `evidence/tests.txt`.
- Criterion 2: a history.test.ts temp-repo test comparing `readGitLog` merge files with `git diff --numstat <merge>^1 <merge>`. Output in `evidence/tests.txt`.
- Criterion 3: a history.test.ts test asserting per-file `linesChanged` and `commits365` before and after adding the merge. Output in `evidence/tests.txt`.
- Criterion 4: a history.test.ts cache test that writes a version 1 file, calls `repoHistory`, and reads back `version: 2`. Output in `evidence/tests.txt`.
- Criterion 5: a history.test.ts `taskLanding` test on a temp repo with the branch deleted. Output in `evidence/tests.txt`.
- Criterion 6: a history.test.ts `taskLanding` test with `since` after the merge date and an extra base-into-branch merge. Output in `evidence/tests.txt`.
- Criterion 7: a land.test.ts test inspecting `git cat-file -p HEAD` parents and message and `git show HEAD:<packet>`. Also the manual transcript of a real `reggie decide` on a throwaway repo, saved as `evidence/decide-merge.txt`.
- Criterion 8: land.test.ts assertions on branch list, worktree path, remote ref and `getTask` state, plus `evidence/decide-merge.txt`.
- Criterion 9: a land.test.ts conflict test that captures shas, porcelain status and verdicts before and after. Also a manual conflicting run saved as `evidence/decide-conflict.txt`.
- Criterion 10: three land.test.ts refusal tests comparing shas and status before and after. Output in `evidence/tests.txt`.
- Criterion 11: a land.test.ts already-merged test checking parent count 1, the `Task:` line and the output text. Output in `evidence/tests.txt`.
- Criterion 12: the updated serve.test.ts "approves a packet … and moves the card to done" plus the completed-view test asserting `merge` and `filesChanged > 0`. Output in `evidence/tests.txt`.
- Criterion 13: a land.test.ts or tasks.test.ts needs-work test asserting HEAD sha is unchanged. Output in `evidence/tests.txt`.
- Criterion 14: a launch.test.ts assertion on the build prompt text. Output in `evidence/tests.txt`.
- Criterion 15: a node one-liner run from this worktree printing sha and task for the three merges, saved as `evidence/real-merges.txt`. Full `npm test` and `npm run typecheck` output saved as `evidence/tests.txt` and `evidence/typecheck.txt`.

## Assumptions
- Answered by jacobpress (brief): after a successful merge, release the worktree and local branch through `releaseTask` and never push. The loop works offline.
- Answered by jacobpress (brief): team mode is deferred. Team mode keeps today's verdict-only decide, and nothing checks GitHub merge methods.
- Log format (settled from code): record-separated `%x1e`/`%x1f` fields with `%b` last before numstat. Rejected: a second pass for bodies (extra git calls per view) and NUL-delimited `-z` (it changes numstat path quoting, which `parseNumstatPath` already handles in the current form).
- The index stores only the parsed task and `parents`, not bodies. The Co-Authored-By item can add a field and bump the cache version again. Rejected: storing full bodies, which grows the cache for a question nobody asks yet.
- Body `Task:` line beats subject. Disagreements are not reported, because nothing consumes a report yet.
- Merge files are kept on the merge commit for the landing lookup and excluded from churn, ownership and recent-per-path. Rejected: dropping branch-commit files instead, which would hand every landed line to whoever ran the merge.
- The verdict lands inside the merge commit (`--no-commit`, write verdict, commit). An abort leaves both branches untouched. Rejected: verdict committed on the task branch first, as the hand merges did.
- Merge message: `merge: task/<slug> — <title>`, which matches the three hand merges, with `Task:` and `Decided-by:` as a final trailer paragraph.
- The merge sha is not recorded in the packet. The packet is inside the merge commit and cannot name it, and re-finding by first-parent walk also covers the three hand merges.
- A merge older than the history window is found by one unbounded `--first-parent --merges` scan of the base.
- Signing disabled with `commit.gpgsign=false`, as `claim` does. A pinentry prompt would block the single-threaded server. Global `commit.gpgsign` is unset on this machine, so nothing changes for the owner today.
- Already merged, or nothing ahead: record the verdict as a base commit, release, and report "already landed" rather than refuse.
- A dirty serving checkout is refused rather than merged. The web view's own uncommitted journal writes will trip this until the journal item moves those writes. The refusal message says to commit or stash first.
- The web Approve button in solo mode goes through the same landing as the CLI. Otherwise the button would keep producing done tasks with no merge commit.

## Out of scope
- The `.gitattributes` union line and where claim writes its journal entry (`journal-files-conflict-on-merge-a-claim-in-the-m`).
- `reggie journal derive` itself. This task only provides `taskLanding` for it.
- Rendering diff hunks (`branch-diff-in-reader`).
- Parsing `Co-Authored-By` into coauthors.
- Low-risk auto-approval policy and a `decide` MCP tool.
- Pushing, GitHub merge-method checks, and anything else team-mode.
- Rewriting or re-attributing history already committed. The three hand merges become readable through the parser change alone.
- The stale dev bin.

## Bail conditions
- `journal-files-conflict-on-merge-a-claim-in-the-m` has not landed when implementation starts (no `.gitattributes` journal union line on `repo-manager`). Stop, because the first Reggie merge would hit the known conflict.
- `--diff-merges=first-parent` output cannot be parsed reliably alongside `%b` bodies (for example, a body line that looks like a numstat line cannot be told apart). Go back to the brief and choose the two-pass format.
- Excluding merge files from `deriveHistory` changes any existing graph, story or views test expectation beyond merge commits. That means some consumer relied on merges contributing files, and the double-counting answer needs revisiting.
- `git merge --abort` in a test fails to restore the exact pre-merge state under the refusal preconditions. The "branches left exactly as they were" guarantee cannot be kept this way.
- The serve test fixture cannot run a real merge from its serving checkout without restructuring the fixture shared by other suites. Stop and split the web route into its own task.
