---
slug: stale-dev-bin
title: Stop the reggie on the PATH from silently running a stale build
risk: low
author: jacobpress
date: 2026-09-15
branch: task/stale-dev-bin
base: repo-manager
verdict: pending
decided_by:
decided_at:
---
# Completion: Stop the reggie on the PATH from silently running a stale build

Read this top to bottom to decide whether the work is done. Every claim should point at evidence.

## Acceptance criteria
- [x] `buildState` on a fixture with `src/a.ts` and an empty `dist/` returns `built: false` and `aheadMs: 0`, and `checkBuild` for a module inside that `dist/` returns a message containing "not been built" and no count of hours or minutes.
  evidence: .reggie/tasks/stale-dev-bin/evidence/tests-named.txt, tests "buildState > says an empty dist was never built, instead of inventing an age against the epoch" and "checkBuild > says not built yet, with no age, when dist holds nothing"
- [x] `checkBuild` returns verdict `current` for a module URL under `src/`, both when the fixture's `dist/` is older than its source and when it has no `dist/`.
  evidence: .reggie/tasks/stale-dev-bin/evidence/tests-named.txt, test "checkBuild > is current for code run from src/, however far behind the build is"
- [x] `checkBuild` for a module under a stale fixture's `dist/` returns verdict `stale` with a message naming the newest source file, `npm run build`, and `REGGIE_ALLOW_STALE=1`; with `REGGIE_ALLOW_STALE=1` in the env it returns `allowed`; with the variable set to `0` or unset it returns `stale`.
  evidence: .reggie/tasks/stale-dev-bin/evidence/tests-named.txt, tests "checkBuild > refuses a stale dist and names the file, the fix, and the escape hatch" and "checkBuild > allows a stale dist only when REGGIE_ALLOW_STALE is exactly 1"
- [x] In a checkout whose `src/util.ts` mtime is newer than every file in `dist/`, `node dist/cli.js tasks`, `node dist/cli.js journal show` and `node dist/cli.js serve --port 0` each exit with status 1, print the stale message on stderr, and print nothing on stdout.
  evidence: .reggie/tasks/stale-dev-bin/evidence/stale-cli.txt, first three runs (stdout 0 lines, refusal on stderr, exit 1); the same file also shows the nested `plan lint stale-dev-bin` refused
- [x] In the same checkout, `REGGIE_ALLOW_STALE=1 node dist/cli.js tasks` exits 0 with the task list on stdout and the "Running the stale build" message on stderr, and `node dist/cli.js --version` exits 0 with no stale message.
  evidence: .reggie/tasks/stale-dev-bin/evidence/stale-cli.txt, the `REGGIE_ALLOW_STALE=1` run (27 lines of tasks, warning on stderr, exit 0) and the `--version` run (empty stderr, exit 0)
- [x] After `npm run build` in that checkout, `node dist/cli.js tasks` exits 0 with nothing about a stale build on stderr.
  evidence: .reggie/tasks/stale-dev-bin/evidence/stale-cli.txt, section "Rebuild, then run again" (empty stderr, exit 0)
- [x] An MCP client connected to a server whose build check reports stale gets `isError: true` from both `reggie_tasks` and `reggie_journal`, with text naming `npm run build`, and no journal file is written.
  evidence: .reggie/tasks/stale-dev-bin/evidence/tests-named.txt, test "mcp server on a stale build > refuses every tool call with an error naming the build, and writes nothing"; live against the compiled bin in .reggie/tasks/stale-dev-bin/evidence/stale-mcp.txt (`reggie_tasks` only, see Deviations)
- [x] An MCP client connected to a server whose on-disk build is newer than the build it loaded gets `isError: true` with text telling it to restart the MCP server.
  evidence: .reggie/tasks/stale-dev-bin/evidence/tests-named.txt, test "mcp server on a stale build > tells the session to restart when dist was rebuilt after the server loaded it"
- [x] The existing MCP end-to-end test, which spawns the CLI from `src/` through tsx, still lists the ten tools and captures through them.
  evidence: .reggie/tasks/stale-dev-bin/evidence/tests-named.txt, test "mcp server > exposes the tools and captures through them" (unchanged)
- [x] `docs/getting-started.md` and `packages/reggie/README.md` both name `REGGIE_ALLOW_STALE` and say a linked checkout refuses to run after a source edit until rebuilt, and `grep -rn warnIfStale packages/reggie/src` prints nothing.
  evidence: .reggie/tasks/stale-dev-bin/evidence/docs-check.txt
- [x] `npm test`, `npm run typecheck` and `npm run build` in packages/reggie each exit 0.
  evidence: .reggie/tasks/stale-dev-bin/evidence/tests.txt (28 files, 527 passed, 1 skipped; all three exit 0)

## Evidence
- .reggie/tasks/stale-dev-bin/evidence/tests.txt: typecheck, the full suite and the build, with exit statuses.
- .reggie/tasks/stale-dev-bin/evidence/tests-named.txt: a verbose run of the build-state and MCP test files, naming each test cited above.
- .reggie/tasks/stale-dev-bin/evidence/stale-cli.txt: live runs of the compiled bin with a touched source, the escape hatch, `--version`, then a rebuild.
- .reggie/tasks/stale-dev-bin/evidence/stale-mcp.txt: a live MCP client against `node dist/cli.js mcp` with a touched source.
- .reggie/tasks/stale-dev-bin/evidence/docs-check.txt: the doc greps and the empty `warnIfStale` grep.

## Changes
Implementation commit 412b0e6 against repo-manager, plus the claim record from the claim commit:

```
.reggie/journal/2026-09-15/jacobpress-session.md   |  8 ++
 .../notes/packages/reggie/src/build-state.ts.md    |  2 +-
 .reggie/notes/packages/reggie/src/cli.ts.md        |  3 +
 .reggie/notes/packages/reggie/src/mcp.ts.md        |  8 ++
 .reggie/tasks/stale-dev-bin/claim.md               | 10 +++
 .../tasks/stale-dev-bin/evidence/docs-check.txt    |  7 ++
 .reggie/tasks/stale-dev-bin/evidence/stale-cli.txt | 77 +++++++++++++++++
 .reggie/tasks/stale-dev-bin/evidence/stale-mcp.txt | 16 ++++
 .reggie/tasks/stale-dev-bin/evidence/tests.txt     | 29 +++++++
 docs/getting-started.md                            |  2 +
 packages/reggie/README.md                          |  2 +
 packages/reggie/src/build-state.test.ts            | 99 ++++++++++++++++++----
 packages/reggie/src/build-state.ts                 | 98 ++++++++++++++++-----
 packages/reggie/src/cli.ts                         | 32 ++++---
 packages/reggie/src/mcp.ts                         | 55 +++++++++---
 packages/reggie/test/mcp.test.ts                   | 82 ++++++++++++++++++
 16 files changed, 465 insertions(+), 65 deletions(-)
```

The packet commit adds this file, evidence/tests-named.txt, and one intake line (see Discovered issues).

In short: build-state.ts gains `built`, `builtAt`, `rebuilt` and `checkBuild`, which replaces `staleBuildWarning`. cli.ts replaces `warnIfStale` with a root `preAction` hook that gates every command except `mcp`. mcp.ts splits `createMcpServer` from `startMcpServer` and registers every tool through one wrapper that refuses while the check says stale. `.mcp.json` and package.json are unchanged.

## Reviews
- No review commands ran. The plan's risk class is low, and the review policy asks for `/code-review` only at medium and `/security-review` at high. The change adds no network, auth or file-write paths; the gate only reads mtimes under the package's own `src/` and `dist/`.

## Deviations from plan
- Under `REGGIE_ALLOW_STALE=1` the message drops its last line, the one telling you to set the variable, since it is already set. The plan said the allowed message would be the same text with a prefix.
- The restart message ends with "restart the MCP server (or the command)" instead of the `npm run build` fix line, because the build on disk is already current in that case.
- Criterion 7's live run against the compiled bin called `reggie_tasks` only. `reggie_journal` and the no-journal-file check are proven by the in-process test, which uses the real `checkBuild` over a fixture package.
- Added beyond the plan: an MCP test that tools run normally with the escape hatch set, a live refusal of the nested `plan lint` to show the hook reaches subcommands, and tests-named.txt so the unit criteria cite test names rather than a pass count.
- The first live run was invalid and is not in the evidence. It touched the source inside the one-second grace, so the build still looked current and `serve --port 0` started for real. That run was stopped and redone with a three-second wait before the touch.

## Discovered issues
- `reggie packet` pairs evidence files with acceptance criteria round-robin: here criterion 1, a unit test, pointed at the docs grep and the last seven had placeholders. Captured to intake as `reggie-packet-pairs-evidence-files-with-acceptan`.

## Open risks
- The gate ships inside the build it guards. The `reggie` on the PATH links to the repo-manager worktree, so it stays unguarded until this merges there and that checkout is built once.
- Already-running processes keep their old code: several `reggie serve` processes started days ago are still up, and MCP servers in open sessions predate the per-call guard. Anyone noticing odd behaviour should restart them.
- Staleness is judged by mtimes. A branch switch, pull or rebase that rewrites source mtimes refuses until the next build even when behaviour has not changed; you would notice a refusal right after `git switch`, and a build or `REGGIE_ALLOW_STALE=1` gets past it.
- `serve` is only checked at start, not per request, so an edit made while it runs goes unnoticed until it is restarted (out of scope in the plan).
