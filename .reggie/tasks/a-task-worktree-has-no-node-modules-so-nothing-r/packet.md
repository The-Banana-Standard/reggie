---
slug: a-task-worktree-has-no-node-modules-so-nothing-r
title: Make a claimed worktree runnable, and stop the stats file riding into commits
risk: medium
author: jacobpress
date: 2026-09-15
branch: task/a-task-worktree-has-no-node-modules-so-nothing-r
base: repo-manager
verdict: approved
decided_by: jacobpress
decided_at: 2026-09-15T23:21:22.274Z
---
# Completion: Make a claimed worktree runnable, and stop the stats file riding into commits

Read this top to bottom to decide whether the work is done. Every claim should point at evidence.

## Acceptance criteria
- [x] `loadConfig` returns `install` entries with `dir` and `command` from YAML, defaults a missing `dir` to `.`, drops entries with an absolute dir, a `..` segment or an empty command, and leaves `install` undefined when the key is absent.
  evidence: .reggie/tasks/a-task-worktree-has-no-node-modules-so-nothing-r/evidence/tests.txt
- [x] Claiming with a worktree, when the serving checkout has `node_modules` and a byte-identical lockfile at the entry's dir, makes `<worktree>/<dir>/node_modules` a symlink resolving to the serving checkout's directory, runs no command, and reports outcome `linked`.
  evidence: .reggie/tasks/a-task-worktree-has-no-node-modules-so-nothing-r/evidence/tests.txt
- [x] When the lockfile differs, or the serving checkout has no `node_modules` at that dir, claim creates no link, runs the command in `<worktree>/<dir>`, and reports `installed`.
  evidence: .reggie/tasks/a-task-worktree-has-no-node-modules-so-nothing-r/evidence/tests.txt
- [x] When the install command exits non-zero or exceeds the timeout, `claimTask` returns without throwing, the worktree and the claim commit exist, and the outcome is `failed` with the dir and command; `reggie claim` prints `run` followed by that command and dir.
  evidence: .reggie/tasks/a-task-worktree-has-no-node-modules-so-nothing-r/evidence/tests.txt, .reggie/tasks/a-task-worktree-has-no-node-modules-so-nothing-r/evidence/claim-cli.txt
- [x] With no `install` key, a worktree claim creates no `node_modules` and runs no command, and every existing claim test passes unchanged.
  evidence: .reggie/tasks/a-task-worktree-has-no-node-modules-so-nothing-r/evidence/tests.txt
- [x] Resuming a claim whose worktree holds a `node_modules` symlink after the branch changed the lockfile removes the link and runs the install; a real `node_modules` directory in the worktree is left in place with outcome `present`.
  evidence: .reggie/tasks/a-task-worktree-has-no-node-modules-so-nothing-r/evidence/tests.txt
- [x] `releaseTask` removes the `node_modules` symlink before removing the worktree, and after a forced release the serving checkout's `node_modules` directory and a marker file inside it still exist.
  evidence: .reggie/tasks/a-task-worktree-has-no-node-modules-so-nothing-r/evidence/tests.txt, .reggie/tasks/a-task-worktree-has-no-node-modules-so-nothing-r/evidence/e2e.txt
- [x] A claim in `defer` mode runs no command and returns `deferred` for each entry that would install; both `POST /api/launch` and `reggie launch --run` claim in `defer` mode.
  evidence: .reggie/tasks/a-task-worktree-has-no-node-modules-so-nothing-r/evidence/tests.txt, .reggie/tasks/a-task-worktree-has-no-node-modules-so-nothing-r/evidence/defer-callsites.txt
- [x] A build prompt given pending setup entries names each command and directory before the instruction to execute the plan, and every build prompt tells the session to `unlink` the `node_modules` link before adding or changing a dependency.
  evidence: .reggie/tasks/a-task-worktree-has-no-node-modules-so-nothing-r/evidence/tests.txt
- [x] `.reggie/config.yaml` carries one install entry with dir `packages/reggie` and command `npm ci --legacy-peer-deps`.
  evidence: .reggie/tasks/a-task-worktree-has-no-node-modules-so-nothing-r/evidence/config.txt
- [x] In a local clone of this branch with dependencies installed at `packages/reggie`, the built CLI's `claim <slug> --worktree` links `node_modules`, `npm test` passes inside the new worktree, and after `release --force` the clone's `node_modules` is intact.
  evidence: .reggie/tasks/a-task-worktree-has-no-node-modules-so-nothing-r/evidence/e2e.txt
- [x] `git ls-files packages/reggie/.claude/stats.json` prints nothing, the file still exists on disk, `git check-ignore -v` on it names the `**/.claude/*` rule, `git ls-files .claude/commands` still lists four files, and `git ls-files -ci --exclude-standard` prints nothing.
  evidence: .reggie/tasks/a-task-worktree-has-no-node-modules-so-nothing-r/evidence/gitignore.txt
- [x] `.reggie/intake.md` no longer contains the `stats-json-changes-under-test` line or its detail lines.
  evidence: .reggie/tasks/a-task-worktree-has-no-node-modules-so-nothing-r/evidence/gitignore.txt
- [x] `docs/ui-api-contract.md`'s `POST /api/launch` entry says a build claim links dependencies and defers any install to the session's prompt.
  evidence: .reggie/tasks/a-task-worktree-has-no-node-modules-so-nothing-r/evidence/config.txt
- [x] `npm test` and `npm run typecheck` pass from the repo root.
  evidence: .reggie/tasks/a-task-worktree-has-no-node-modules-so-nothing-r/evidence/tests.txt

## Evidence
- .reggie/tasks/a-task-worktree-has-no-node-modules-so-nothing-r/evidence/claim-cli.txt
- .reggie/tasks/a-task-worktree-has-no-node-modules-so-nothing-r/evidence/config.txt
- .reggie/tasks/a-task-worktree-has-no-node-modules-so-nothing-r/evidence/defer-callsites.txt
- .reggie/tasks/a-task-worktree-has-no-node-modules-so-nothing-r/evidence/e2e.txt
- .reggie/tasks/a-task-worktree-has-no-node-modules-so-nothing-r/evidence/gitignore.txt
- .reggie/tasks/a-task-worktree-has-no-node-modules-so-nothing-r/evidence/tests.txt

## Changes
27 files changed against repo-manager:

```
.gitignore                                         |   7 +-
 .reggie/config.yaml                                |   7 +
 .reggie/intake.md                                  |  12 +-
 .reggie/journal/2026-09-15/jacobpress-session.md   |  12 +
 .reggie/notes/.gitignore.md                        |   9 +
 .reggie/notes/packages/reggie/src/claim.ts.md      |   4 +
 .reggie/notes/packages/reggie/src/cli.ts.md        |   4 +
 .reggie/notes/packages/reggie/src/deps.ts.md       |  13 +
 .reggie/notes/packages/reggie/src/launch.ts.md     |   4 +
 .reggie/notes/packages/reggie/src/people.ts.md     |   9 +
 .reggie/notes/packages/reggie/src/serve.ts.md      |   4 +
 .../claim.md                                       |  10 +
 .../evidence/claim-cli.txt                         |  26 ++
 .../evidence/config.txt                            |   9 +
 .../evidence/defer-callsites.txt                   |  15 +
 .../evidence/gitignore.txt                         |  37 ++
 .../evidence/tests.txt                             |  33 ++
 packages/reggie/.claude/stats.json                 |  14 -
 packages/reggie/docs/ui-api-contract.md            |   2 +-
 packages/reggie/src/claim.ts                       |  22 +-
 packages/reggie/src/cli.ts                         |  28 +-
 packages/reggie/src/deps.test.ts                   | 416 +++++++++++++++++++++
 packages/reggie/src/deps.ts                        | 211 +++++++++++
 packages/reggie/src/launch.test.ts                 |  25 ++
 packages/reggie/src/launch.ts                      |  32 +-
 packages/reggie/src/people.ts                      |  35 ++
 packages/reggie/src/serve.ts                       |  10 +-
 27 files changed, 984 insertions(+), 26 deletions(-)
```

## Reviews
Risk class is medium, so the repo's own checks plus `/code-review`.

**Repo checks.** `npm test` and `npm run typecheck` from the repo root: 31 files, 578 passed, 1 skipped, typecheck clean (`evidence/tests.txt`). The suite was 30 files and 551 tests before this task; the 27 new tests are `deps.test.ts` (25) and two additions to `launch.test.ts`.

**`/code-review`, first run: wrong target.** It reviewed `9534cc4..HEAD` in the serving checkout, which is the already-merged `task-attribution-by-merge` work, and reported "working tree is clean" while this branch's changes sat uncommitted in the task worktree. None of its ten findings were about this diff. Three of the substantial ones are captured (see Discovered issues) rather than fixed here.

**`/code-review`, second run: this diff.** Re-invoked with this worktree's path. Seven findings, all in code this task wrote, all resolved:

1. *(medium/high)* A throw from the dependency step escaped `claimTask`, and every caller reads a throw from `claimTask` as "someone else holds this branch" — `serve.ts` turns it into a 409 — while the branch and worktree already exist. `symlinkSync` throws `EPERM` on Windows without Developer Mode, and `unlinkSync` can throw `EBUSY`. Resolved: each entry now runs inside its own guard in `prepareDeps`, and a filesystem error becomes a `failed` outcome. `unlinkDeps` is guarded too, so a link that will not come off cannot block a release. Test: "turns a filesystem error into a failed outcome instead of a failed claim".
2. *(medium)* A real `node_modules` was reported `present` unconditionally, so a worktree whose branch had since changed its lockfile looked ready. Resolved within the plan's rule that a real directory is never touched: it is still never touched, but when the lockfiles disagree the outcome carries `pending`, so `reggie claim` prints the command and the build prompt names it. Test: "says a real folder is out of date rather than letting the branch look ready". The reviewer's other example — a partial tree left by a failed install, where the lockfiles still match — needs state this task does not keep, and is captured instead.
3. *(medium)* An existing symlink plus matching lockfiles was reported `linked` without checking the link still resolved, so a deleted serving folder left every worktree dangling and called ready. Resolved: the check follows the link. Test: "replaces a link whose target has been deleted, rather than calling it ready".
4. *(low/medium)* The probe for the serving checkout's folder used `lstat`, which does not follow links, so a serving checkout whose own `node_modules` is a link — which is every worktree inside a worktree, including the one this session ran in — could never link and always paid a full install. Resolved with a following `statSync`. Test: "links from a serving folder that is itself a link, which is every nested worktree".
5. *(low)* A configured directory absent from the branch produced a `failed` outcome that `pendingSetup` still passed on, so the prompt told the session to install into a directory that is not there. Resolved: `pending` now marks what a session actually owes, and this case is not marked. Tested in "says so when the configured directory is not in the worktree".
6. *(low)* The unlink instruction was phrased as an order in every build prompt, but `node_modules` is not always a link and `unlink` on a directory fails. Resolved by wording it as a condition ("check whether `node_modules` here is a symlink: if it is, ..."). It is still in every build prompt, which acceptance criterion 9 requires.
7. *(low)* A failure reason kept only the exit status and discarded stderr, and a command that could not start at all read as `exit ?`. Resolved: the reason names "could not run `<cmd>`" for a null status and carries the command's own first line of complaint — visible in `evidence/claim-cli.txt`, where npm's 403 reaches the claim's output.

**`/simplify`: deliberately not run.** The diff is large by line count, but 627 of its 984 added lines are one new module and its tests, which `/code-review` just went through in detail. Against that, the first `/code-review` run showed these skills default to the parent session's directory, which is the serving checkout for tonight's queue; `/simplify` *applies* its fixes, so a mis-targeted run would edit the checkout every later task in the queue depends on. Unattended, that trade was not worth taking. Recorded here so a reviewer can run it deliberately if they disagree.

## Deviations from plan
**Bootstrap, and why this task needed one.** The bug being fixed is that a claimed worktree has no dependencies, so the worktree this session was handed could run nothing. It was bootstrapped by hand exactly as the feature now does automatically: the two `packages/reggie/package-lock.json` files were compared byte for byte, and an absolute symlink was made from this worktree's `packages/reggie/node_modules` to the serving checkout's. Safe because this branch changes no dependency, so the lockfiles stay identical; and the bare `node_modules` line in `.gitignore` keeps the link out of `git status` at any depth, which was checked before anything else. The full suite was run through the link before a single file was edited — 551 passed — which cleared the plan's first bail condition, that Node might resolve packages through the link into the serving checkout's sources. It does not: vitest reported the worktree's own root. Nothing was ever deleted through the link; the one stray link created during the end-to-end run was removed with `unlink`, and the serving checkout's 139 packages were verified intact afterwards.

**Shape of a `DepsOutcome`.** The plan describes outcomes as a status per entry. Implementation adds one optional field, `pending`, set when the session still has to run the command itself. It exists because three different situations share the status `failed` or `present` but differ on whether re-running the command would help: an install that ran and failed (it would), a directory named in config but absent from the branch (it would not), and a real folder that no longer matches the branch (it would). `pendingSetup` filters on `pending`, not on status, so the build prompt only ever names commands worth running. This came out of review finding 5.

**A non-directory where `node_modules` belongs** is a `failed` outcome naming the problem, not `present`. The plan's rule is about a real *directory*; a plain file there can be neither linked over nor installed into, and is for a person to look at.

**A configured directory missing from the worktree** returns `failed` with "no `<dir>` directory in the worktree". The plan does not say what happens here. Silence would hide a misconfiguration, so it is reported, but not marked pending.

**`saveConfig` now writes `install`** when it is present. The plan does not mention it. `saveConfig` only runs from `ensureConfig` when no config file exists, so nothing is lost today, but leaving the key out would have made it the second key `saveConfig` silently drops.

**`loadConfig` sets `install` to the filtered list whenever the key is an array**, which can be an empty list when every entry was dropped. The criterion requires `undefined` only when the key is *absent*, and that holds; an empty list and `undefined` behave identically in `prepareDeps`. The distinction is kept because "the key is there and nothing valid came of it" is a different fact from "there is no key".

**`deps.test.ts` cleans up its own fixtures** with a retrying `rmSync` rather than the shared `makeTempRepo` cleanup. These fixtures hold git worktrees, and the shared cleanup deletes in a single pass, which raced git and failed a passing test roughly one run in three. Fixing the shared helper would touch a file outside the plan's list and every other suite, so it is captured instead. Three consecutive clean runs of `deps.test.ts` after the change, plus two full-suite runs.

**How the end-to-end check was set up.** The plan says to clone, copy the serving `node_modules` in with `cp -Rc`, and run the built CLI. Two adjustments, both forced by the environment and both recorded in `evidence/e2e.txt`:
- The clone is checked out under the name `repo-manager`, the integration branch `.reggie/config.yaml` points at, so that `claim` branches from *this* code rather than from the branch as it stands before the merge. That is the state right after the manager merges.
- `cp -Rc` of this worktree's `node_modules` copied the bootstrap *symlink*, giving the clone a link back into the real serving checkout. That was unlinked, and the real directory was copied from the serving checkout instead, so the clone is self-contained. Copying `dist` in the same way carried its original timestamps and the stale-build guard correctly refused to run it, so the clone was built in place.

The end-to-end result is unchanged by either: the claim linked with no command, `npm test` inside the brand-new worktree passed 578 tests with no setup at all, and `release --force` unlinked first and left the clone's 139 packages and its marker file untouched.

## Discovered issues
All five are captured in `.reggie/intake.md`; none is fixed here.

- `a-failed-install-leaves-a-partial-node-modules-a` — mine. A failed install leaves a partial `node_modules`, and a later resume calls it `present` and stops naming the install command. Knowing the last install failed needs state this task does not keep.
- `maketemprepo-cleanup-deletes-without-retries-whi` — mine. `test/helpers.ts` cleans up without `maxRetries`, which flakes for any test that makes a git worktree.
- `approving-from-the-web-board-fails-whenever-the` — from the first `/code-review` run, against already-merged code, **not verified by hand**. `landTask` refuses a dirty base while the server's own POST routes write into `.reggie/` and never commit, and `friendlyError` in `ui/board.js` maps every 409 from decide to "no completion packet exists". Partly overlaps the existing `the-web-page-s-own-writes-notes-journal-entries` item; the new half is the misleading message.
- `a-task-line-anywhere-in-a-commit-body-lets-a-squ` — same run, **not verified by hand**. `taskFromBody` scans the whole commit body, and `merge --squash` and `merge --log` concatenate other commits' messages into it.
- `every-reggie-decide-approved-builds-a-full-histo` — same run, **not verified by hand**. `land.ts` computes `landedBy` unconditionally, building a full history index the happy path never reads.

## Open risks
- **Windows is untested.** The guard added for finding 1 means a `symlinkSync` refusal now degrades to a `failed` outcome and a named install command rather than a broken claim, but no Windows machine ran any of this. A Windows user would see every claim install rather than link, which is correct but slow.
- **A link is only as good as the lockfile comparison.** A dependency change that does not touch a lockfile — editing `node_modules` by hand, an install with `--no-save` — still leaks between worktrees, and nothing here detects it. The build prompt's unlink instruction is the only cover, and it is prose.
- **`present` still forgives a partial install** when the lockfiles match, which is the captured item above. Someone would notice as a session failing on a missing module in a worktree whose claim said nothing was wrong.
- **The ten-minute timeout is a guess.** A cold `npm ci` on a large monorepo over a slow link could exceed it and be reported as failed after killing a partial install, which lands in the case above. The session is told to run the command, so it recovers, but it recovers into a partial tree.
- **The `**/.claude/*` rule is repo-wide.** It was verified that no tracked file besides `stats.json` changed state (`git ls-files -ci --exclude-standard` prints nothing, and the four `.claude/commands` files are still tracked), but any future nested `.claude/` directory is now ignored by default, and a file someone expects to commit there would need its own negation.
- **`reggie release` unlinks only the directories named in `install`.** A link made by hand somewhere else is still inside the worktree when `git worktree remove --force` runs. Git 2.55 does not follow it, per the plan, but that is now the only thing protecting it.

## Decision
- approved by jacobpress on 2026-09-15: Overnight run: verified 578 tests pass with typecheck clean, end-to-end claim/link/release proven on a clone, seven code-review findings resolved with tests. Approved by the manager session under the overnight delegation.
