---
slug: journal-files-conflict-on-merge-a-claim-in-the-m
title: Stop journal files from colliding when a task branch merges
risk: low
deciders: []
author: jacobpress
created: 2026-09-15
---
# Stop journal files from colliding when a task branch merges

## Problem
Journal day files (`.reggie/journal/<date>/<person>-session.md`) conflict on every task-branch merge. Two failures are stacked.

1. The task branch and the serving checkout both append to the same lines of the same file. Git cannot reconcile them without a union merge, and the repo has no `.gitattributes`.
2. `claimTask` in packages/reggie/src/claim.ts builds a worktree and commits the claim record there. It then appends its journal entry through the serving checkout's paths. That leaves an uncommitted change on the default branch to the very file the merge writes, so git refuses the merge outright. In solo mode Reggie is about to be the one performing that merge.

## Approach
- Add `.gitattributes` at the repo root with the line `.reggie/journal/**/*.md merge=union`.
- Make onboarding write the same line into every repo it sets up.
  - In `layout.ts`, add `ensureGitattributes(root)` and a `GITATTRIBUTES_LINES` constant, modelled on `ensureGitignore`. It appends only the missing lines under a comment header and copes with a file that has no trailing newline.
  - `ensureLayout` returns a new `gitattributesUpdated` flag, and `reggie onboard` in cli.ts prints a line when that flag is set.
  - `onboard.ts` already calls `ensureLayout`, so it needs no change.
- In `claimTask`, write the journal entry through `repoPaths(workdir)`, not the serving checkout's paths, so it rides the task branch.
  - On a new claim, write the entry before the claim commit and include its day file in the same commit, next to the claim record. This covers both the worktree claim and the in-place claim.
  - On a resume, where the claim record already exists, write the entry into `workdir` without committing. A commit there would count as unmerged work in `releaseTask`'s ahead-count check.
- `release`, `decide`, `journal add`, the web view's journal route and the MCP journal tool stay as they are. They run from the serving checkout and have no branch to ride, and `release` deletes the worktree before it writes.
- Rejected alternative: keep the entry in the serving checkout and have each verb commit it on the default branch. That produces a commit nobody asked for, and the answer on file puts the entry in the worktree.

## Files to touch
- .gitattributes (NEW)
- packages/reggie/src/layout.ts (MOD)
- packages/reggie/src/layout.test.ts (NEW)
- packages/reggie/src/claim.ts (MOD)
- packages/reggie/src/robustness.test.ts (MOD)
- packages/reggie/src/cli.ts (MOD)
- docs/repo-manager-vision.md (MOD)
- .reggie/notes/packages/reggie/src/claim.ts.md (MOD)
- .reggie/notes/packages/reggie/src/layout.ts.md (NEW)

## Acceptance criteria
- [ ] The repo root `.gitattributes` contains the line `.reggie/journal/**/*.md merge=union`, and `git check-attr merge -- .reggie/journal/2026-09-15/jacobpress-session.md` prints `merge: union`.
- [ ] On a repo with no `.gitattributes`, `ensureLayout` creates one containing the union line and returns `gitattributesUpdated: true`.
- [ ] On a repo whose `.gitattributes` already holds other lines and has no trailing newline, `ensureLayout` keeps those lines unchanged and appends the union line on its own line.
- [ ] A second `ensureLayout` on the same repo returns `gitattributesUpdated: false` and leaves `.gitattributes` byte-for-byte unchanged.
- [ ] `reggie onboard` prints a line naming `.gitattributes` when it wrote the union line, and prints nothing about `.gitattributes` otherwise.
- [ ] After `claimTask` with `worktree: true`, `git status --porcelain --untracked-files=no` in the serving checkout prints nothing.
- [ ] After a new claim, worktree or in place, the claim commit on `task/<slug>` contains both `claim.md` and the day's journal file, and that file holds an entry with stage `claim`.
- [ ] Start from a temp repo onboarded and committed on main. Claim a task in a worktree, commit a journal entry on the task branch, then commit a journal entry the same day on main. `git merge --no-ff task/<slug>` run from the serving checkout exits 0, the day file has no conflict markers, and `readJournal` returns every entry from both sides.
- [ ] Resuming an already-claimed task creates no new commit on `task/<slug>`, and `releaseTask` without `--force` still succeeds on a branch holding only the claim commit.
- [ ] `npm test`, `npm run typecheck` and `npm run build` in packages/reggie all exit 0.
- [ ] The "Journals union-merge" decision in docs/repo-manager-vision.md states that onboard writes the line and that the claim entry is committed on the task branch. The claim.ts and layout.ts notes describe the new behaviour.

## Verification strategy
- Criterion 1: the output of `git check-attr merge -- .reggie/journal/2026-09-15/jacobpress-session.md`, saved to evidence/check-attr.txt.
- Criterion 2: the layout.test.ts test "creates .gitattributes with the journal union line", with npm test output saved to evidence/tests.txt.
- Criterion 3: the layout.test.ts test "appends to an existing .gitattributes without a trailing newline", which asserts the original prefix is preserved; output in evidence/tests.txt.
- Criterion 4: the layout.test.ts test "is idempotent", which compares file contents before and after the second run; output in evidence/tests.txt.
- Criterion 5: `reggie onboard` run twice against a fresh temp repo, with both outputs saved to evidence/onboard.txt.
- Criterion 6: the robustness.test.ts test "a worktree claim leaves the serving checkout clean"; output in evidence/tests.txt.
- Criterion 7: the robustness.test.ts test "the claim commit carries the journal entry", which reads `git show --name-only task/<slug>` for a worktree claim and an in-place claim; output in evidence/tests.txt.
- Criterion 8: the robustness.test.ts test "a task branch with journal entries merges into a main that also journaled"; output in evidence/tests.txt.
- Criterion 9: the robustness.test.ts test "resuming a claim adds no commit", which asserts an ahead count of 1 and that `releaseTask` returns without throwing, with the existing release tests still passing; output in evidence/tests.txt.
- Criterion 10: the output of the three commands, saved to evidence/tests.txt, evidence/typecheck.txt and evidence/build.txt.
- Criterion 11: the `git diff` of docs/repo-manager-vision.md and the two note files, saved to evidence/docs-diff.txt and cited in the packet.

## Assumptions
- Onboard writes the union line into every repo, appending when a `.gitattributes` already exists. Answered by jacobpress on 2026-09-15.
- When the claim builds a worktree, the claim entry goes into the worktree and is committed with the claim. Answered by jacobpress on 2026-09-15.
- The claim entry is committed rather than left for the build session to carry. This follows from the answer above. An in-place claim takes the same path, because its `workdir` is the root and committing the entry leaves that tree clean too.
- On a resume the entry is written into `workdir` and left uncommitted. The alternative was a separate journal commit, but `releaseTask` would count it as unmerged work beyond the claim commit.
- `release`, `decide`, `journal add`, the web view and the MCP tool keep writing into the serving checkout. They have no task branch to ride, and `release` removes the worktree before it writes. The attribution task, which is next, makes `decide approved` perform the merge on a clean tree, so it has to commit its own entry or write it after merging. That note goes into intake when this task is built.
- A union merge can leave entries out of time order inside the raw day file, and that is acceptable. `readJournal` sorts by date and time, so only someone opening the raw file sees the order.
- Nothing is done for merges performed on GitHub, which ignores the attribute. That does not matter in solo mode, and the team-mode answer stays open.
- Launch records and context packs live under `.reggie/.cache/`, which is gitignored, so launching a build dirties nothing else in the serving checkout.

## Out of scope
- Naming journal files by branch, task or session, including filling `REGGIE_SESSION` from the id minted at launch.
- The derived journal.
- What journal entries say, or who writes one and when.
- Attribution by merge commit, and making `decide approved` perform the merge.
- The stale bin, the worktree dependency link and the stray stats file.
- Re-sorting journal files after a merge.
- Team-mode merges performed on GitHub.

## Bail conditions
- The end-to-end merge test still fails after both changes, which would mean another writer dirties the serving checkout during a claim and the brief's diagnosis is incomplete.
- Committing the journal file in the claim commit changes what `branchOwner`, `releaseTask`'s ahead count or task-state derivation reports for a claimed task.
- git will not apply `merge=union` to journal files for a merge run from the serving checkout under any glob, so the one-line fix cannot hold.
- Getting the claim entry onto the task branch turns out to require changing the journal file naming scheme, which the brief defers.
