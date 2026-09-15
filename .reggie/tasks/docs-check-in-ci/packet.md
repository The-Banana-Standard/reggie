---
slug: docs-check-in-ci
title: Run the generated-block check in CI, on a tree the refresh just made clean
risk: low
author: jacobpress
date: 2026-09-15
branch: task/docs-check-in-ci
base: repo-manager
verdict: pending
decided_by:
decided_at:
---
# Completion: Run the generated-block check in CI, on a tree the refresh just made clean

Read this top to bottom to decide whether the work is done. Every claim should point at evidence.

Built unattended overnight by a Claude session, with the owner asleep and unable to answer
anything. Every choice the plan left open was decided the way its Approach points, and each
decision is recorded below with its reason.

The landing commit is `fc7b95e`. It holds exactly `.github/workflows/ci.yml`, `CLAUDE.md` and
`AGENTS.md`. The commits on either side of it hold only `.reggie/` bookkeeping; see Deviations
for why the work is three commits rather than one.

## Acceptance criteria
- [x] `.github/workflows/ci.yml` runs `node dist/cli.js docs check` as the final step of the `reggie` job, positioned after `- run: npm run build`.
  evidence: (.reggie/tasks/docs-check-in-ci/evidence/ci-diff.txt) — the diff shows the step added directly below `- run: npm run build`, with nothing after it, and (evidence/ci-steps.txt) confirms from the parsed file that the last step in the job is this one.
- [x] That step declares no `working-directory` of its own and no `if:` condition, so it inherits `packages/reggie` and runs on both `ubuntu-latest` and `macos-latest`.
  evidence: (.reggie/tasks/docs-check-in-ci/evidence/ci-steps.txt) — the parsed step prints `[no working-directory]` and `[no if]`, beside `defaults.run.working-directory: packages/reggie` and `strategy.matrix.os: ["ubuntu-latest","macos-latest"]`. (evidence/ci-diff.txt) quotes the unchanged `strategy` and `defaults` blocks straight from the file.
- [x] `ci.yml` parses as YAML and the `reggie` job holds five `run` steps in this order: `npm ci --legacy-peer-deps`, `npm run typecheck`, `npm test`, `npm run build`, `node dist/cli.js docs check`.
  evidence: (.reggie/tasks/docs-check-in-ci/evidence/ci-steps.txt) — parsed with the package's own `yaml` dependency from `packages/reggie`; five run steps, in that order, `exit=0`.
- [x] One commit contains exactly `.github/workflows/ci.yml`, `CLAUDE.md` and `AGENTS.md`, and touches no file outside `.reggie/` besides those three.
  evidence: (.reggie/tasks/docs-check-in-ci/evidence/commit-files.txt) — `git show --name-only --format= fc7b95e` prints those three paths and nothing else; the whole-branch list beside it shows every other path is under `.reggie/`.
- [x] At that commit, with `git status --porcelain` printing nothing, the four job commands run from `packages/reggie` each exit 0, and `node dist/cli.js docs check` prints `fresh: CLAUDE.md` and `fresh: AGENTS.md`.
  evidence: (.reggie/tasks/docs-check-in-ci/evidence/ci-rehearsal.txt) — clean tree, then `npm run typecheck` exit 0, `npm test` 578 passed / 1 skipped across 31 files exit 0, `npm run build` exit 0, `node dist/cli.js docs check` → `fresh: CLAUDE.md` / `fresh: AGENTS.md` exit 0. `npm ci --legacy-peer-deps` was deliberately not re-run; see Decisions taken unattended.
- [x] The generated block committed in `CLAUDE.md` reports the counts `collectFacts` returns at that commit, not the superseded `Files: 217` / `TypeScript 73` / `30 test files` of the 2026-09-15 hand refresh.
  evidence: (.reggie/tasks/docs-check-in-ci/evidence/facts-compare.txt) — the block read out of the commit and the block rendered fresh from `collectFacts` are line-for-line identical: `TypeScript 78`, `Files: 223`, `packages/ 121`, `33 test files`. Those are exactly the numbers the plan predicted before the refresh ran.
- [x] Restoring the previous `CLAUDE.md` over the refreshed one makes `node dist/cli.js docs check` print `stale: CLAUDE.md` and exit 1, proving the new step would catch drift rather than pass unconditionally.
  evidence: (.reggie/tasks/docs-check-in-ci/evidence/drift-probe.txt) — `git show HEAD~1:CLAUDE.md > CLAUDE.md` puts `Files: 217` back; the check prints `stale: CLAUDE.md` and exits 1. `git checkout -- CLAUDE.md` restores `Files: 223` and the check exits 0 with both files fresh. The tree is clean before and after.
- [x] No file under `docs/`, nor `packages/reggie/README.md`, nor `packages/reggie/src/onboard.ts`, is changed by this task; each of the six passages describing the check reads true once the step lands.
  evidence: (.reggie/tasks/docs-check-in-ci/evidence/commit-files.txt) — `git diff --name-only repo-manager...HEAD` piped through a grep for those three prefixes matches nothing (`grep exit=1`). The six passages as they stand:
  1. `docs/information-paradigm.md:21` — "`reggie docs refresh` regenerates; `reggie docs check` fails CI on drift." True: the check is now the job's last step and exits 1 on drift.
  2. `docs/how-reggie-structures-a-repo.md:55` — "When the repo changes, `reggie docs refresh` rewrites the block, and `reggie docs check` in CI fails when it drifts." True, same step.
  3. `docs/getting-started.md:173` — "Once a week: `reggie note stale` and `reggie docs check`." This one describes a human rhythm, not CI, and was true before and after; the step makes the weekly run a backstop rather than the only guard.
  4. `packages/reggie/README.md:22` — "Exit 1 when a generated block is missing or stale. Use in CI on a clean tree." True, and the job is a clean checkout by construction.
  5. `packages/reggie/src/onboard.ts:201` and 6. `.reggie/ONBOARDING.md:7` — "Refresh it any time with `reggie docs refresh`; check it in CI with `reggie docs check`." These are advice written into other repos; unaffected either way, and now matched by this repo's own practice.
  None of the six names a job, a runner or a file, so none needed an edit.

## Evidence
- .reggie/tasks/docs-check-in-ci/evidence/ci-diff.txt — criteria 1 and 2: the workflow diff, plus the unchanged matrix and defaults.
- .reggie/tasks/docs-check-in-ci/evidence/ci-steps.txt — criterion 3: `ci.yml` parsed with the package's `yaml` dependency, the five run steps in order.
- .reggie/tasks/docs-check-in-ci/evidence/commit-files.txt — criteria 4 and 8: what the landing commit touches, and what the branch does not.
- .reggie/tasks/docs-check-in-ci/evidence/ci-rehearsal.txt — criterion 5: the job rehearsed locally at `fc7b95e` on a clean tree, every command's output and exit code.
- .reggie/tasks/docs-check-in-ci/evidence/drift-probe.txt — criterion 7: the mutation probe, failing then passing again.
- .reggie/tasks/docs-check-in-ci/evidence/facts-compare.txt — criterion 6: the committed block beside the freshly rendered one.

## Changes
Three commits on `task/docs-check-in-ci`, plus the claim record, against `repo-manager` at `e0369cd`:

- `f18a178 meta: claim docs-check-in-ci` — the claim record and the claim journal entry, written by `reggie claim --worktree`.
- `f41cc2f journal: docs-check-in-ci execute stage, with the notes for the three files` — the first execute journal entry, the new note for the workflow, the new notes for `CLAUDE.md` and `AGENTS.md`, and the first two evidence files.
- `fc7b95e ci: run the generated-block check, on a tree the refresh just made clean` — **the landing commit.** `.github/workflows/ci.yml` gains four lines (a two-line comment and the named step); `CLAUDE.md` and `AGENTS.md` each gain three changed lines, all inside the generated block.
- The final commit that carries this packet adds the second execute journal entry, the four remaining evidence files, the captured intake item, and this file. Every path in it is under `.reggie/`, which `collectFacts` ignores, so it cannot make the block it just proved fresh go stale.

The whole product change is four lines of YAML:

```yaml
      # The bin is not installed in this job, so the check runs from the output `npm run build`
      # just wrote. It stays last: the CLI refuses every command when `dist/` is behind `src/`.
      - name: docs check (CLAUDE.md and AGENTS.md)
        run: node dist/cli.js docs check
```

## Reviews
The plan's front matter is `risk: low`, and the build instruction for this task sets the repo's own
checks as the review bar at that class, so `/code-review` was not run. What ran instead, all at the
landing commit on a clean tree and all recorded in `evidence/ci-rehearsal.txt`:

- `npm run typecheck` (`tsc --noEmit`) — exit 0.
- `npm test` (`vitest run`) — 31 files, 578 passed, 1 skipped, exit 0.
- `npm run build` (`tsc`) — exit 0.
- `node dist/cli.js docs check` — `fresh: CLAUDE.md`, `fresh: AGENTS.md`, exit 0.

Nothing was found, and so nothing needed resolving. Two further checks beyond the repo's own were
run because a workflow file has no compiler: the file was parsed with the package's own `yaml`
dependency to confirm it is valid YAML and that the step landed where it was meant to
(`evidence/ci-steps.txt`), and the gate was mutation-tested to confirm it can actually fail
(`evidence/drift-probe.txt`). `/simplify` was not run: it applies edits, and in this worktree it
would have risked writing into the checkout that serves the rest of tonight's queue.

## Deviations from plan
- **Three commits instead of one.** The plan speaks of "one commit" carrying the step and the
  refresh, and criterion 4 asks that one commit hold exactly the three files while allowing
  `.reggie/` paths elsewhere. Writing the journal, the notes and the evidence into the same commit
  would have made it a ten-file commit; leaving them uncommitted would have made `git status
  --porcelain` non-empty during the rehearsal, which criterion 5 forbids. So the bookkeeping sits in
  a commit before the landing one and a commit after it, and the landing commit is exactly the three
  files the plan names. A reviewer reading `fc7b95e` alone sees the whole product change.
- **Nothing had to be merged in first.** The plan tells the build session to bring `repo-manager`
  into the task branch before working. `reggie claim` branches from the configured default branch,
  which is `repo-manager`, so the branch was cut from its current tip (`e0369cd`) and there was
  nothing to merge. That tip was re-checked immediately before the refresh and again before the
  landing commit, and had not moved either time. The plan's intent — refresh against the real base —
  is met; the merge step itself was simply unnecessary.
- **The rehearsal and probe output was written outside the repo and copied in afterwards.** The plan
  asks for the output under `evidence/`, and criterion 5 asks for an empty `git status --porcelain`
  at the same moment. Writing straight into `evidence/` would have dirtied the tree the rehearsal
  was supposed to be measuring. The commands wrote to a scratch directory and the files were copied
  into `evidence/` once the probe was over; the contents are the runs themselves, unedited except
  for one stray shell-expansion artifact removed from `facts-compare.txt`, where a backticked phrase
  in a comment line was evaluated by the shell instead of printed.
- **Notes were added for `CLAUDE.md` and `AGENTS.md` as well as for the workflow.** The working
  agreement asks for a note after each file change and all three files changed. The two new notes
  say something the generated block does not: that its counts cover the whole tree, so the refresh
  belongs last among a branch's edits, and that `AGENTS.md` is compared end to end rather than only
  between its markers.

## Decisions taken unattended
The owner was asleep and could answer nothing, so these were decided here, the way the plan's
Approach and Assumptions point.

- **`npm ci --legacy-peer-deps` was not re-run in the rehearsal.** The plan's Assumptions already
  rule it out, because the install touches only `node_modules`, which is gitignored and ignored by
  the fact collector, so it cannot change what the check compares. There is now a second and
  stronger reason: in a claimed worktree `packages/reggie/node_modules` is a symlink into the
  serving checkout, and `npm ci` deletes and rebuilds that folder, which would have taken the
  dependencies the rest of tonight's queue is sharing with it. The four commands that were run are
  exactly the four criterion 5 names.
- **The step carries a `name:`, while the four steps above it are bare `- run:` lines.** The plan's
  Assumptions ask for this, and it is what makes a drift failure read as drift in the log instead of
  as an anonymous command failure. A two-line comment was added above it as well, in the style the
  file already uses twice, saying why the step is invoked from `dist/` and why it has to stay last.
- **The step runs on both matrix legs, with no `if:`.** Recorded in the plan; the check reads
  `git ls-files` output and file contents, which cannot differ between `ubuntu-latest` and
  `macos-latest`, so a conditional would be the job's only exception for a saving too small to
  measure.

## Discovered issues
- **CI never actually runs for this branch.** The workflow's push trigger is filtered to `main`, and
  tonight's v3 work is merged into `repo-manager` locally and never pushed, so neither the new step
  nor the typecheck, test and build steps beside it will run for any of it. The `pull_request`
  trigger has no branch filter, so the gate does have teeth the moment a task goes through a PR. The
  new step is correct either way and this is not a reason to hold it — a gate that is right and not
  yet firing is better than no gate — but nobody should believe the check is running today. Captured
  as `ci-only-fires-for-pushes-to-main-so-nothing-in-i`; not fixed here, since the plan puts any
  other change to the workflow out of scope.
- Nothing else was found. The only other thing noticed — that the generated block counts 33 test
  files where vitest runs 31, because two helper files sit under the test directory — is the fact
  collector counting a directory rather than a mistake, and was judged too small to be worth an
  intake line.

## Open risks
- **The block can go stale again before this branch lands.** It reports counts over the whole tree,
  so any branch that merges into `repo-manager` between this refresh and this merge re-stales it,
  and the merged result would then fail the very check it just added. Nothing on this branch can
  cause it: every file it adds outside the three is under `.reggie/`, which `collectFacts` ignores.
  Whoever merges should run `node dist/cli.js docs check` from `packages/reggie` on the merged tree;
  if it prints `stale:`, run `node dist/cli.js docs refresh` and commit the two files on
  `repo-manager` straight away. This is the plan's own instruction for the case, carried forward.
- **Nothing was verified by a real GitHub Actions run**, because this session may not push. The
  rehearsal is the same commands the job runs, from the same directory, on a clean tree, on macOS.
  The `ubuntu-latest` leg is unproven by execution; the check's inputs are file paths and file
  contents, so the two legs cannot disagree, but that is an argument rather than a run.
- **The probe proves the gate for `CLAUDE.md`, and only argues it for `AGENTS.md`.** Rolling back
  `CLAUDE.md` left `AGENTS.md` reported fresh, which is correct: `AGENTS.md` is composed from
  `CLAUDE.md`'s curated half plus a freshly rendered block, and only the generated half had been
  rolled back. `docs.test.ts` already covers the `AGENTS.md` drift case directly, and that test ran
  green in the rehearsal.
- **The step fails the build for a reason that is not the contributor's code.** That is the point,
  but the first person it catches will be someone who added or deleted files and never touched the
  docs. The step's name and the command's own message both name the fix, and this was preferred to a
  bot that refreshes the block automatically, which the plan puts out of scope on purpose.
