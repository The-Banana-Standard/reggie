---
slug: a-task-worktree-has-no-node-modules-so-nothing-r
title: Make a claimed worktree runnable, and stop the stats file riding into commits
area: packages/reggie
size: medium
risk: low
priority: P1
author: jacobpress
created: 2026-09-15
---
# Make a claimed worktree runnable, and stop the stats file riding into commits

## Problem
`reggie claim --worktree` creates `.worktree/<slug>` with `git worktree add`, and that is all it does. Git checks out tracked files, and installed dependencies are not tracked: `node_modules` is ignored twice over in `.gitignore`, once bare and once slashed. So the worktree a build session is handed looks complete and runs nothing. `npm test` fails, `reggie serve` fails, and the session's first act in its own workspace is a broken command it did not cause.

The two ways out are both bad on their own. Running `npm ci` takes minutes for a worktree that may live an hour, and the session pays that cost before it has read anything. Symlinking `node_modules` from the serving checkout is instant, which is what was done by hand while building `mobile-ui`, but it is silently wrong the moment the branch changes a dependency: the install lands in the shared tree and every other worktree inherits it.

Two details of this repo are exactly the ones a naive implementation gets wrong. The lockfile and `node_modules` live under `packages/reggie`, not at the root that `collectFacts` reads — the root `package.json` only holds scripts that delegate with `npm --prefix`, and the facts line for this repo therefore advertises `npm run build, npm run test` and no install command at all. And the install command that actually works here is `npm ci --legacy-peer-deps`, which no generated fact would ever produce. There is nowhere in `.reggie/config.yaml` to write it down: `loadConfig` knows `mode`, `defaultBranch`, `mcpServerName`, `risk` and `legacy`, and nothing else.

Folded into this item: `packages/reggie/.claude/stats.json` is tracked, and a `git add -A` during a task commit sweeps its changes in. The `.gitignore` entry meant to cover it, `.claude/*`, contains a slash, so git anchors it to the repo root and it never matches the copy nested under `packages/reggie`. Two things have to happen in order — untrack the file first, then unanchor the pattern, because an ignore rule does nothing to a file git is already tracking. The writer was the v2 `track-stats` hook, whose registration was removed from `~/.claude/settings.json` on 2026-09-15; the test suite was never the culprit, so no test needs changing.

## Why now
The 2026-09-15 decisions put loop plumbing ahead of every feature, and name this item fourth in the order, paired with the stats file. Both are here for the same reason: every remaining item on the backlog is built through the loop, so every remaining build session starts by claiming a worktree, and every one of them currently starts by hitting this. The hand symlink is not a fix that carries — it lives in one person's memory, it has to be redone per worktree, and its dangerous case, a session adding a dependency into the shared tree, has not been hit yet only because no session has needed one.

Waiting also gets more expensive as the loop gets more automatic. The same decision block approves low-risk plans and completions by policy, which means sessions that run without anyone watching the first command fail. A worktree that cannot run its own tests cannot produce the evidence a packet is required to cite, so the gate that is supposed to catch a bad change instead catches a missing dependency. The stats file compounds it quietly: it rides into commits as unexplained noise, and the attribution work landing just before this one makes "what changed in this task" a thing Reggie reports rather than a thing a person skims.

## Suspected area
- `packages/reggie/src/claim.ts` because `claimTask` is where `git worktree add` runs and where anything that makes the new worktree usable has to hang; `releaseTask` in the same file removes the worktree with `--force` and is the other half of whatever linking does
- `packages/reggie/src/people.ts` because `loadConfig` and the `ReggieConfig` interface are the only place a new install-command key can be declared and parsed, and it currently ignores every key it does not know
- `.reggie/config.yaml` because it is the file that would carry this repo's own answer, `npm ci --legacy-peer-deps` run from `packages/reggie`
- `packages/reggie/src/facts.ts` because `collectFacts` reads manifests and scripts from the repo root only, which is why the generated facts cannot supply the install command the intake line originally hoped they would
- `packages/reggie/src/launch.ts` because `buildPrompt` is the prompt a build session receives, and the decision says it must tell the session to unlink before adding a dependency
- `.gitignore` because the `node_modules` pair already there is what keeps a link untracked, and because the root-anchored `.claude/*` rule and its `!.claude/commands/` negation are what the stats fold has to change
- `packages/reggie/.claude/stats.json` because it is the tracked file to remove from the index before any ignore rule can take effect
- `packages/reggie/src/claim.ts`'s tests and the fixture repos under `packages/reggie/test` because linking, installing and unlinking are behaviours that need a repo with a lockfile to assert against

## Open questions
- What is the new config key called, and what shape does it take: a single command string, or a record that also carries the directory it runs in? This repo needs both halves — the command is `npm ci --legacy-peer-deps` and it must run in `packages/reggie` — so a bare string key cannot express this repo's own answer.
- Which lockfile does the byte-identical comparison read, given that `collectFacts` only looks at the root? Does Reggie search for lockfiles, take the directory from the same config key, or compare every lockfile it finds under the repo?
- What happens when the serving checkout itself has no dependencies installed, so there is nothing to link and no lockfile pair to compare? Falling through to the install command is the obvious answer and it is not what the decision says.
- Does the link go in as a symlink to the whole `node_modules` directory, and does a repo with several installed packages get one link each? A monorepo with three package directories has three answers and the decision describes one.
- What does claim do when the install command fails or hangs: fail the claim and leave no worktree, leave the worktree and warn, or print the command and let the session run it? The claim currently cannot fail halfway, and an install that takes minutes changes what claiming feels like.
  > Answered by jacobpress on 2026-09-15: Keep the worktree and the claim, bound the install with a timeout, and print the failed command so the session starts with a known step. A failed install is recoverable; a half-made claim is not.
- Does `releaseTask` have to unlink before `git worktree remove --force` runs? Removing a directory that contains a symlink into the serving checkout is the one way this feature could delete the dependencies it was meant to share, and nothing in the decision covers teardown.
- Is "unlink before adding a dependency" only prose in the build prompt, or does something check it — a verb the session can run, or a claim-time check that notices the link is still in place when the lockfile has changed? Prose in a prompt is the cheapest version and the easiest to ignore.
- For the stats fold: does the ignore become an unanchored `**/.claude/*` with a matching unanchored negation, or a single explicit `packages/reggie/.claude/` line? Unanchoring changes what is ignored everywhere in the repo, and four `.claude/commands/*.md` files are tracked today on the strength of the current negation.
- Does the `stats-json-changes-under-test` intake line get removed when this brief lands, given the decision that the intake line leaves at triage and the brief replaces it? It is a second captured item being answered by one brief, and nothing says which brief owns its removal.
- Should this repo's peer-dependency conflict be fixed so a plain `npm ci` works, rather than recorded as a flag in config forever? Out of scope for the mechanism either way, but it decides whether the config value here is a workaround or the real answer.
  > Answered by jacobpress on 2026-09-15: Keep the flag in config now. The peer-dependency fix is its own intake item, npm-ci-without-legacy-peer-deps.

## Not this
- The stale `dist` build that the installed `reggie` bin runs. That is the first item in the same decision order and it is about which code a verb executes, not about whether the worktree it creates can run anything.
- Journal files colliding on merge, and joining commits to tasks by the merge commit. Both are the neighbouring loop-plumbing items from the same 2026-09-15 block, and each lands as its own task.
- Dependency management in general: upgrading packages, adding workspaces to the root `package.json`, or moving to a single root-level install. This item makes a claimed worktree match the checkout it came from, and does not change how the repo installs anything.
- Removing the v2 system under `resources/` and repointing the `~/.claude` symlinks. The `track-stats` hook belongs to that retirement; its registration is already gone from this machine, and the per-machine settings file is not a repo file this task edits.
- Making the test suite stop writing the stats file. It never wrote it. The fold is an untrack and an ignore-pattern fix, not a change to any test.
- Teaching `collectFacts` to read nested manifests so it can find `packages/reggie`. That would be a real improvement to the facts, and the decision routes around it with a config key instead; the fact-reading fix is a separate item if anyone wants it.
