---
slug: docs-check-in-ci
title: Run the generated-block check in CI, on a tree the refresh just made clean
risk: low
deciders: []
author: jacobpress
created: 2026-09-15
---
# Run the generated-block check in CI, on a tree the refresh just made clean

## Problem
Six places in the repo tell a reader that the generated block in `CLAUDE.md` and `AGENTS.md` is guarded automatically: `docs/information-paradigm.md:21` ("fails CI on drift"), `docs/how-reggie-structures-a-repo.md:55` ("`reggie docs check` in CI fails when it drifts"), the weekly rhythm at `docs/getting-started.md:173`, `packages/reggie/README.md:22` ("Use in CI on a clean tree"), and the same sentence written into every onboarded repo by `packages/reggie/src/onboard.ts:201` and `.reggie/ONBOARDING.md:7`. The one workflow, `.github/workflows/ci.yml`, runs `npm ci`, `npm run typecheck`, `npm test` and `npm run build`, and stops. Nothing guards the block, so a stale one can sit on the default branch until somebody notices by hand — the exact failure the generated-block paradigm exists to prevent — and the promise makes it less likely anybody looks.

The block is stale right now. Run in this worktree on a clean tree at `cb46252`, `reggie docs check` prints `stale: CLAUDE.md`, `stale: AGENTS.md` and exits 1. The committed block claims `TypeScript 73`, `Files: 217`, `packages/ 116` and `30 test files`; `collectFacts` at this commit returns `TypeScript 78`, `Files: 223`, `packages/ 121` and `33 test files`. The difference is tonight's four merges into `repo-manager` (stale-dev-bin, journal-files-conflict, task-attribution-by-merge, worktree-dependencies), which added five TypeScript files under `packages/` and the root `.gitattributes`. So the hand refresh of 2026-09-15 that the brief and the intake line rest on has already been overtaken, and adding the step alone would make the first CI run red.

## Approach
Add one step to the existing `reggie` job in `.github/workflows/ci.yml`, immediately after `- run: npm run build` and last in the job: `node dist/cli.js docs check`. It inherits `defaults.run.working-directory: packages/reggie`, which is where `dist/cli.js` is written, so the invocation needs no path juggling and no globally installed bin. It must follow the build for two reasons, not one: `dist/cli.js` does not exist before it, and `cli.ts`'s `preAction` hook refuses to run any command when `dist/` is older than `src/`, so a pre-build invocation would fail as a stale build rather than report drift. No git identity is needed — `currentPerson` falls back to `$USER` when `git config user.name` is unset — and `findRepoRoot` resolves the root with `git rev-parse --show-toplevel`, which is correct from the package directory.

In the same commit, run `reggie docs refresh` and commit the regenerated `CLAUDE.md` and `AGENTS.md`. The commit therefore contains exactly three files and the first run of the new step is green on its own merge rather than red for drift that predates it.

The refresh has to be the last content edit before the commit, because the block reports counts of the whole tree. Two things make that tractable. `.reggie/` is in `IGNORED_SEGMENTS` in `facts.ts`, so this task's own plan, journal and packet files cannot re-stale the block, and neither can the intake capture already committed. Editing `ci.yml` cannot change any count either, since the file already exists. The only thing that can re-stale it is another branch landing counted files between this refresh and this task's merge, so the build session brings `repo-manager` into the task branch first, refreshes last, and re-checks after any later merge (see Assumptions).

Rejected alternative: a separate `docs` job. It reads more clearly in the log, but it would need its own checkout, `setup-node`, `npm ci --legacy-peer-deps` and `npm run build` — two to four minutes of runner time — purely to rebuild a `dist/` the existing job already holds. A named step in the existing job buys nearly all the log clarity for one second, and the command's own failure message already names the fix.

## Files to touch
- .github/workflows/ci.yml (MOD)
- CLAUDE.md (MOD)
- AGENTS.md (MOD)

## Acceptance criteria
- [ ] `.github/workflows/ci.yml` runs `node dist/cli.js docs check` as the final step of the `reggie` job, positioned after `- run: npm run build`.
- [ ] That step declares no `working-directory` of its own and no `if:` condition, so it inherits `packages/reggie` and runs on both `ubuntu-latest` and `macos-latest`.
- [ ] `ci.yml` parses as YAML and the `reggie` job holds five `run` steps in this order: `npm ci --legacy-peer-deps`, `npm run typecheck`, `npm test`, `npm run build`, `node dist/cli.js docs check`.
- [ ] One commit contains exactly `.github/workflows/ci.yml`, `CLAUDE.md` and `AGENTS.md`, and touches no file outside `.reggie/` besides those three.
- [ ] At that commit, with `git status --porcelain` printing nothing, the four job commands run from `packages/reggie` each exit 0, and `node dist/cli.js docs check` prints `fresh: CLAUDE.md` and `fresh: AGENTS.md`.
- [ ] The generated block committed in `CLAUDE.md` reports the counts `collectFacts` returns at that commit, not the superseded `Files: 217` / `TypeScript 73` / `30 test files` of the 2026-09-15 hand refresh.
- [ ] Restoring the previous `CLAUDE.md` over the refreshed one makes `node dist/cli.js docs check` print `stale: CLAUDE.md` and exit 1, proving the new step would catch drift rather than pass unconditionally.
- [ ] No file under `docs/`, nor `packages/reggie/README.md`, nor `packages/reggie/src/onboard.ts`, is changed by this task; each of the six passages describing the check reads true once the step lands.

## Verification strategy
- Criterion 1: the diff of `.github/workflows/ci.yml`, saved to `evidence/ci-diff.txt`, showing the new step directly below `- run: npm run build` with nothing after it.
- Criterion 2: the same diff, read for the absence of `working-directory` and `if:` on the new step, plus the unchanged `strategy.matrix.os` block quoted in the packet.
- Criterion 3: `node -e` using the package's own `yaml` dependency to parse `.github/workflows/ci.yml` and print `jobs.reggie.steps[].run`, with the printed list saved to `evidence/ci-steps.txt`.
- Criterion 4: `git show --stat --name-only HEAD` for the landing commit, saved to `evidence/commit-files.txt`.
- Criterion 5: `git status --porcelain` (empty) followed by `npm run typecheck`, `npm test`, `npm run build` and `node dist/cli.js docs check` run from `packages/reggie`, each command's output and exit code appended to `evidence/ci-rehearsal.txt`.
- Criterion 6: the `## Repo facts (generated …)` lines of the committed `CLAUDE.md` beside the fresh block rendered by `collectFacts` at that commit, both saved to `evidence/facts-compare.txt`.
- Criterion 7: a mutation probe — `git show HEAD~1:CLAUDE.md > CLAUDE.md`, run `node dist/cli.js docs check`, record the `stale:` lines and exit 1, then `git checkout -- CLAUDE.md` and re-run to record the return to `fresh:` and exit 0; both runs saved to `evidence/drift-probe.txt`.
- Criterion 8: `git show --name-only HEAD` read for the absence of any `docs/`, `README.md` or `onboard.ts` path, with the six promise lines quoted in the packet as they stand.

## Assumptions
The owner is asleep and the brief carries no `Answered by jacobpress` lines, so every open question below is answered here, unattended, on 2026-09-15.

- Both matrix legs run the step; no `if: matrix.os == 'ubuntu-latest'` guard. The check's inputs are `git ls-files` output and file contents, which are identical on `ubuntu-latest` and `macos-latest`, so the second run adds no signal about drift. It costs about a second inside a job that is already running, while a conditional step is a permanent exception a reader has to decode, and it is the only thing in the job that would not run everywhere. The rejected alternative was the ubuntu-only step the brief floats; it trades a readable, uniform job for a saving too small to measure.
- It is a step in the existing job, not a job of its own. This follows the owner's framing note ("Add the docs check step to ci.yml after the build step") and the cost argument in Approach. A `name:` on the step is the cheap half of what a separate job would have bought.
- The commit does not need to carry other pending working-tree changes; that premise in the brief and in the `.reggie/intake.md` detail line ("The generated block was refreshed on 2026-09-15 so the check passes on a clean tree") has gone stale. Those changes landed in `4dde7a3`, the tree is clean, and four later merges moved the counts the block reports. So the block needs refreshing once more at the moment the step lands, and the refresh is the build session's own last content edit before it commits.
- Later merges can re-stale the block again, and the build session handles it this way: bring `repo-manager` into `task/docs-check-in-ci` first, then run `reggie docs refresh`, then confirm `reggie docs check` exits 0 on a clean tree, then commit. If `repo-manager` moves again before this task lands, re-run refresh on the task branch and commit before merging; if a merge has already happened, refresh and commit on `repo-manager` immediately after it. `.reggie/` is excluded from `collectFacts`, so plans, journals, packets and intake captures never trigger this; only a merge that adds or removes counted files does.
- The six passages describing the check stand as written and this task edits none of them. None names a job, a runner or a file, so each becomes true the moment the step lands; `packages/reggie/README.md:22` and the `onboard.ts` line are advice to other repos and are unaffected either way. Editing them would widen a three-file diff for no gain.
- Nothing is verified by an actual GitHub Actions run, because this session may not push. The rehearsal is the same four commands run locally from `packages/reggie` on a clean tree, which is what the job does after checkout.
- The rehearsal reuses the `node_modules` already present rather than re-running `npm ci --legacy-peer-deps`. The install affects only `node_modules`, which is gitignored and in `IGNORED_SEGMENTS`, so it cannot change what the check compares.
- `npm ci` and `npm run build` cannot make the check fail on a clean CI tree: `node_modules`, `dist` and `*.tsbuildinfo` are all gitignored, so `git ls-files --others --exclude-standard` never sees them, and `facts.ts` ignores `node_modules` and `dist` besides.
- The step's name is written for the log, something like `docs check (CLAUDE.md and AGENTS.md)`, even though the existing steps are bare `- run:` lines. A named step is what makes a drift failure read as drift.

## Out of scope
- A separate `docs` job, any change to `strategy.matrix`, and any other workflow addition such as lint, coverage or a release step.
- A test asserting the contents of `ci.yml`. A test that reads a workflow file is brittle and the diff is three lines a reviewer reads directly.
- Checking the curated, hand-written sections of `CLAUDE.md` against the graph; that is its own intake item.
- Automating the refresh, by bot or hook. This task makes drift visible; fixing it stays a human act.
- Editing the six passages that describe the check, or adding a new one that names the job.
- Making a UI test lane run in CI, captured tonight as `the-web-client-has-no-automated-test-and-ci-neve`.

## Bail conditions
- `node dist/cli.js docs check` exits non-zero from `packages/reggie` on a clean tree straight after a refresh and a build, which would mean the check is not reproducible from the built output and the step cannot be trusted to gate anything.
- The `preAction` build guard refuses the command in the job even though `npm run build` ran immediately before, which would make the step's placement insufficient and turn this into a change to `build-state.ts` rather than to `ci.yml`.
- A refresh on a clean tree produces a block that differs between `ubuntu-latest` and a local macOS run, which would make the check platform-dependent and reopen the matrix question as a real one rather than a cost question.
- `repo-manager` keeps moving fast enough that every refresh is stale before the task can land, which would mean drift needs an automated refresh rather than a gate, and the task goes back to its brief.
