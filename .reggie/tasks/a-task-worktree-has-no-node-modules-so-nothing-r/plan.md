---
slug: a-task-worktree-has-no-node-modules-so-nothing-r
title: Make a claimed worktree runnable, and stop the stats file riding into commits
risk: medium
deciders: [jacobpress]
author: jacobpress
created: 2026-09-15
---
# Make a claimed worktree runnable, and stop the stats file riding into commits

## Problem
`reggie claim --worktree` runs `git worktree add` and nothing else. Installed dependencies are not tracked, so the worktree a build session receives cannot run `npm test` or `reggie serve`, and the session's first command fails through no fault of its own. `npm ci` works but takes minutes. A hand symlink of `node_modules` (used while building mobile-ui) is instant, but it goes silently wrong once a branch changes a dependency. In this repo the lockfile and `node_modules` sit under `packages/reggie`, not at the root, and the install command that works is `npm ci --legacy-peer-deps`. `.reggie/config.yaml` has nowhere to record either fact.

Separately, `packages/reggie/.claude/stats.json` is tracked, and `git add -A` sweeps it into task commits. The `.claude/*` ignore rule contains a slash, so git anchors it at the root and it never matches the nested copy.

## Approach
Implement the 2026-09-15 hybrid decision in a new module `src/deps.ts` that `claim.ts` calls. It is driven by a new config key:

    install:
      - dir: packages/reggie
        command: npm ci --legacy-peer-deps

`loadConfig` parses `install` as a list of `{ dir, command }`. `dir` is relative to the repo root and defaults to `.`. An entry is dropped if its dir is absolute or contains `..`, or if its command is empty. With no key, claim behaves exactly as it does today.

For each entry, after the worktree exists (on a fresh claim and on a resume), `prepareDeps` compares the serving checkout (`paths.root`) with the worktree at `dir`:
- **Link.** If the serving checkout has a real `node_modules` directory there, and the known lockfiles (`package-lock.json`, `npm-shrinkwrap.json`, `yarn.lock`, `pnpm-lock.yaml`, `bun.lock`) exist in the same set on both sides, at least one exists, and each pair is byte-identical, then `<worktree>/<dir>/node_modules` becomes an absolute symlink to the serving checkout's real path. Outcome `linked`.
- **Install.** Otherwise, including when the serving checkout has nothing installed, the command runs in `<worktree>/<dir>`. It is split on whitespace and run as an argument vector through `run()` (never a shell), bounded by a 10-minute timeout that `ClaimOptions` can override. Outcome `installed`. A non-zero exit or a timeout gives outcome `failed`, carrying the dir and command. The claim, its commit and the worktree all stay.
- **Stale link.** If the worktree already holds a symlink and the lockfiles now differ, the link is unlinked and the entry proceeds to install. A real `node_modules` directory in the worktree is never touched (outcome `present`).
- **Defer.** In `defer` mode no command runs, and every entry that would install is returned as `deferred`.

`ClaimResult` gains `deps: DepsOutcome[]`:
- `reggie claim` runs installs and prints one line per entry. A failed entry prints `run \`<command>\` in <dir>`.
- Both launchers (`POST /api/launch` in serve.ts and `reggie launch --run` in cli.ts) claim in `defer` mode, because a synchronous install of several minutes would block the single-threaded server. They pass every deferred or failed entry to `buildPrompt`, whose first instruction names each command and directory.
- Every build prompt says that adding or changing a dependency means first removing the `node_modules` link with `unlink`, never `rm -r` through it, and then running the install command.

`releaseTask` calls `unlinkDeps` before `git worktree remove --force`. It removes only paths that `lstat` reports as symlinks. Git 2.55 was checked in a scratch repo and does not follow the link. The explicit unlink keeps the result from depending on that.

Stats fold, in order: `git rm --cached packages/reggie/.claude/stats.json` (the file stays on disk), then replace `.claude/*` / `!.claude/commands/` with `**/.claude/*` / `!**/.claude/commands/`. This task retires the `stats-json-changes-under-test` intake line, since this brief answers it.

Rejected alternatives:
- Always `npm ci`: slow for every claim.
- Always link: wrong when a branch changes dependencies.
- Search the tree for lockfiles: a monorepo would get guesses. The config names the directories.
- Teach `collectFacts` to read nested manifests: out of scope per the brief.
- Run installs inside the server request: blocks every other request.

## Files to touch
- packages/reggie/src/deps.ts (NEW)
- packages/reggie/src/deps.test.ts (NEW)
- packages/reggie/src/claim.ts (MOD)
- packages/reggie/src/people.ts (MOD)
- packages/reggie/src/launch.ts (MOD)
- packages/reggie/src/launch.test.ts (MOD)
- packages/reggie/src/cli.ts (MOD)
- packages/reggie/src/serve.ts (MOD)
- packages/reggie/docs/ui-api-contract.md (MOD)
- .reggie/config.yaml (MOD)
- .reggie/intake.md (MOD)
- .reggie/notes/packages/reggie/src/claim.ts.md (MOD)
- .reggie/notes/packages/reggie/src/launch.ts.md (MOD)
- .gitignore (MOD)
- packages/reggie/.claude/stats.json (DEL)

## Acceptance criteria
- [ ] `loadConfig` returns `install` entries with `dir` and `command` from YAML, defaults a missing `dir` to `.`, drops entries with an absolute dir, a `..` segment or an empty command, and leaves `install` undefined when the key is absent.
- [ ] Claiming with a worktree, when the serving checkout has `node_modules` and a byte-identical lockfile at the entry's dir, makes `<worktree>/<dir>/node_modules` a symlink resolving to the serving checkout's directory, runs no command, and reports outcome `linked`.
- [ ] When the lockfile differs, or the serving checkout has no `node_modules` at that dir, claim creates no link, runs the command in `<worktree>/<dir>`, and reports `installed`.
- [ ] When the install command exits non-zero or exceeds the timeout, `claimTask` returns without throwing, the worktree and the claim commit exist, and the outcome is `failed` with the dir and command; `reggie claim` prints `run` followed by that command and dir.
- [ ] With no `install` key, a worktree claim creates no `node_modules` and runs no command, and every existing claim test passes unchanged.
- [ ] Resuming a claim whose worktree holds a `node_modules` symlink after the branch changed the lockfile removes the link and runs the install; a real `node_modules` directory in the worktree is left in place with outcome `present`.
- [ ] `releaseTask` removes the `node_modules` symlink before removing the worktree, and after a forced release the serving checkout's `node_modules` directory and a marker file inside it still exist.
- [ ] A claim in `defer` mode runs no command and returns `deferred` for each entry that would install; both `POST /api/launch` and `reggie launch --run` claim in `defer` mode.
- [ ] A build prompt given pending setup entries names each command and directory before the instruction to execute the plan, and every build prompt tells the session to `unlink` the `node_modules` link before adding or changing a dependency.
- [ ] `.reggie/config.yaml` carries one install entry with dir `packages/reggie` and command `npm ci --legacy-peer-deps`.
- [ ] In a local clone of this branch with dependencies installed at `packages/reggie`, the built CLI's `claim <slug> --worktree` links `node_modules`, `npm test` passes inside the new worktree, and after `release --force` the clone's `node_modules` is intact.
- [ ] `git ls-files packages/reggie/.claude/stats.json` prints nothing, the file still exists on disk, `git check-ignore -v` on it names the `**/.claude/*` rule, `git ls-files .claude/commands` still lists four files, and `git ls-files -ci --exclude-standard` prints nothing.
- [ ] `.reggie/intake.md` no longer contains the `stats-json-changes-under-test` line or its detail lines.
- [ ] `docs/ui-api-contract.md`'s `POST /api/launch` entry says a build claim links dependencies and defers any install to the session's prompt.
- [ ] `npm test` and `npm run typecheck` pass from the repo root.

## Verification strategy
- Criterion 1: a unit test in deps.test.ts that feeds `loadConfig` valid, defaulted and invalid entries; output in evidence/tests.txt.
- Criterion 2: a deps.test.ts test on a `makeTempRepo` fixture with a lockfile and a `node_modules/marker` in the root checkout, asserting `lstat().isSymbolicLink()`, the `realpath`, and no marker from the install script; in evidence/tests.txt.
- Criterion 3: two fixture tests, one where the lockfile is changed on the task branch and one with no root `node_modules`, where the configured command is `node install.js`, which writes a marker file, and the tests assert that the marker exists in the worktree; in evidence/tests.txt.
- Criterion 4: fixture tests with a `node fail.js` command and a sleeping script under a 200ms timeout override, asserting the result, the worktree directory and `git log` on the task branch, plus a CLI run against a fixture repo whose printed line is saved to evidence/claim-cli.txt.
- Criterion 5: a no-config fixture test in deps.test.ts plus the unchanged robustness.test.ts and tasks.test.ts claim tests; in evidence/tests.txt.
- Criterion 6: a resume test that commits a lockfile change on the task branch and claims again, plus a test that pre-creates a real directory; in evidence/tests.txt.
- Criterion 7: a release test asserting the link is gone and the root `node_modules/marker` still reads the same; in evidence/tests.txt.
- Criterion 8: a defer-mode fixture test, plus a grep of serve.ts and cli.ts for the `defer` option at both claimTask call sites saved to evidence/defer-callsites.txt.
- Criterion 9: launch.test.ts assertions on the build prompt with and without setup entries; in evidence/tests.txt.
- Criterion 10: `grep -A3 '^install:' .reggie/config.yaml` saved to evidence/config.txt.
- Criterion 11: `git clone --local` into a temp dir, `cp -Rc` the serving `packages/reggie/node_modules` into it, run `node packages/reggie/dist/cli.js claim e2e-deps --worktree`, `ls -l` the link, `npm test` in the worktree, `release e2e-deps --force`, and `ls` the clone's node_modules; full transcript in evidence/e2e.txt.
- Criterion 12: the five git commands run after the change, with output in evidence/gitignore.txt.
- Criterion 13: `grep -c stats-json-changes-under-test .reggie/intake.md` printing 0, saved to evidence/gitignore.txt.
- Criterion 14: `grep -n "api/launch" packages/reggie/docs/ui-api-contract.md` excerpt in evidence/config.txt.
- Criterion 15: `npm test` and `npm run typecheck` output in evidence/tests.txt.

## Assumptions
- Config key: `install`, a list of `{dir, command}` records. It is a list because a monorepo with several installed packages gets one entry, and one link, per directory. The alternative was a single record, which cannot express several packages.
- Lockfile comparison reads only the known lockfile names in each configured dir, in both checkouts. The alternative, searching the tree, would guess at directories the config already names.
- Nothing installed in the serving checkout means install. Linking to nothing is useless, and install is the decision's "otherwise" branch.
- The link is the whole `node_modules` directory, one per entry. Other dependency folders (a Python `.venv`, say) are not handled until a repo needs them.
- Install failure keeps the worktree and the claim and prints the command, with a 10-minute timeout (answered by jacobpress). The launchers defer rather than run, which is my extension of that answer: the server is single-threaded, so the command goes into the session's prompt as its known first step.
- Release unlinks before removal even though git 2.55 does not follow the link, so safety does not rest on git's behaviour.
- "Unlink before adding a dependency" is prompt prose, backed by a claim-time check that replaces a stale link on resume. A dedicated verb was the alternative and is left out as extra surface nobody has asked for.
- The ignore becomes `**/.claude/*` with `!**/.claude/commands/`, as the decision says ("unanchor"). The only tracked `.claude` files are the four root commands and stats.json, so no other tracked file changes state. The explicit single-path line was the alternative.
- This task removes the `stats-json-changes-under-test` intake line in its build commit. The main item's line leaves through the existing `reggie plan done` path.
- `--legacy-peer-deps` stays in config (answered by jacobpress). Fixing the peer conflict is `npm-ci-without-legacy-peer-deps`.
- The vision's non-goal "Installing anything by symlinking into a repo" is about installing Reggie itself into `~/.claude`, not about dependency links, which the 2026-09-15 decision asks for explicitly.
- Vitest's cache under `node_modules/.vite` is shared through the link. It is keyed by content, so sharing is acceptable.

## Out of scope
- The stale `dist` build the installed bin runs (stale-dev-bin).
- Journal merge collisions and attribution by merge commit.
- Upgrading packages, root workspaces, or a single root-level install.
- Teaching `collectFacts` to read nested manifests or suggest an install command.
- Fixing the peer-dependency conflict.
- Retiring the v2 system under `resources/` or the `track-stats` hook.
- Any test change aimed at the stats file.
- A verb for linking or unlinking dependencies by hand, and dependency folders other than `node_modules`.

## Bail conditions
- If tests or the build fail inside a linked worktree because Node resolves packages through the link's real path into the serving checkout's sources, then linking is wrong for this repo and the task goes back to its brief.
- If `**/.claude/*` makes any tracked file other than stats.json ignored, or changes `git status` for files outside `.claude` directories, stop and return to the brief rather than switching silently to a single-path rule.
- If the link shows up as untracked in the worktree's `git status`, meaning the bare `node_modules` ignore does not cover it there, stop and re-plan the ignore rules.
- If deferring the install in `POST /api/launch` needs a response-shape change the web client depends on, stop and re-plan with the UI contract.
