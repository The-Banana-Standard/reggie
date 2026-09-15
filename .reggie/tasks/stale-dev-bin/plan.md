---
slug: stale-dev-bin
title: Stop the reggie on the PATH from silently running a stale build
risk: low
deciders: [jacobpress]
author: jacobpress
created: 2026-09-15
---
# Stop the reggie on the PATH from silently running a stale build

## Problem
The `reggie` command on the PATH is an `npm link` into this checkout and its bin is `dist/cli.js`, so every verb runs the last compiled build, not `src/`. Edit the source, skip the build, and every command keeps working with the old behaviour. On 2026-09-14 a whole loop session ran against a build four days behind. Only `serve` checks, and it only warns; `claim`, `launch`, `triage`, `journal`, `packet`, `decide` and the MCP server say nothing. The existing check also lies when there is nothing built: it compares the newest source against a zero timestamp and prints an age of hundreds of thousands of hours. The durable fix is to make running stale code loud and blocking, with a deliberate way through.

## Approach
Keep the single compiled bin, as jacobpress decided, and turn the warning into a gate.

- **build-state.ts.** `buildState` gains `built: boolean`. It is false when `dist/` holds no `.js` file, and then `aheadMs` is 0 instead of an age computed against the epoch. It also takes an optional `builtAt` so a long-running process can compare the source against the build it actually loaded. A new `checkBuild(moduleUrl, env, opts?)` returns `{ verdict: "current" | "stale" | "allowed", message }` and replaces `staleBuildWarning`:
  - The verdict is `current` whenever the running module is not inside `<packageRoot>/dist/`. Code run from `src/` through tsx is by definition the source; that covers `npm run dev`, every vitest spawn, and CI, which tests before it builds. An installed package has no `src/`.
  - When stale, the message names the newest source file and its age, or says "has not been built yet" when `built` is false. It always ends with the fix line `(cd <root> && npm run build)` and names the escape hatch `REGGIE_ALLOW_STALE=1`.
  - The verdict is `allowed` when stale and `env.REGGIE_ALLOW_STALE` is exactly `"1"`. The message is then prefixed "Running the stale build because REGGIE_ALLOW_STALE=1".
- **cli.ts.** `warnIfStale` is deleted. A `program.hook("preAction", …)` runs `checkBuild(import.meta.url, process.env)` before every command's action. On `stale` it prints the message to stderr and exits 1 before the action runs; on `allowed` it prints the message and continues. `--help` and `--version` exit before any action, so they are never gated. The hook covers every verb, read verbs included, instead of a list of loop verbs: a stale `plan lint` or `tasks` produces untrustworthy evidence as surely as a stale `decide`, and a list would miss the next verb added. `serve` loses its own warning and is gated like every other verb; its old warn-and-continue behaviour is what `REGGIE_ALLOW_STALE=1` now gives.
- **mcp.ts.** `startMcpServer` is split: `createMcpServer(root, opts)` builds the server, and `startMcpServer` connects it to stdio. The `mcp` command is exempt from the preAction refusal and still starts when stale, because a server that fails to start shows up only as a connection error in a log nobody reads. Instead, every tool handler goes through one wrapper. It re-runs the build check against the newest `dist/` mtime recorded at startup, so a source edit or a rebuild during a session is caught. When stale, the wrapper returns `isError: true` with the message, so the agent sees it on its first call and relays it to the person. When the build on disk is newer than the one the server loaded, the message says to restart the MCP server rather than to rebuild. With `REGGIE_ALLOW_STALE=1` tools run normally. The stderr ready line carries the message whenever the check is not `current`. Resources are not gated: they return file contents, not code behaviour.
- **Docs and notes.** Section 1 of getting-started says a linked checkout refuses to run after a source edit until it is rebuilt, and names the variable. The package README documents `REGGIE_ALLOW_STALE` next to `REGGIE_TOOL`. The notes for build-state.ts and cli.ts are corrected, and one is added for mcp.ts.
- **Rejected.** A dev bin that runs `src/` through tsx: jacobpress chose one compiled bin, so the CLI and the MCP server always run the same code. Building automatically when stale or unbuilt: a build started by any verb in any repo can fail on a half-edited tree, and tsc output would corrupt the MCP stdio channel. A command-line flag as the escape hatch: jacobpress chose an environment variable, because `.mcp.json` and serve launchers cannot easily pass a flag.

## Files to touch
- packages/reggie/src/build-state.ts (MOD)
- packages/reggie/src/build-state.test.ts (MOD)
- packages/reggie/src/cli.ts (MOD)
- packages/reggie/src/mcp.ts (MOD)
- packages/reggie/test/mcp.test.ts (MOD)
- packages/reggie/README.md (MOD)
- docs/getting-started.md (MOD)
- .reggie/notes/packages/reggie/src/build-state.ts.md (MOD)
- .reggie/notes/packages/reggie/src/cli.ts.md (MOD)
- .reggie/notes/packages/reggie/src/mcp.ts.md (NEW)

## Acceptance criteria
- [ ] `buildState` on a fixture with `src/a.ts` and an empty `dist/` returns `built: false` and `aheadMs: 0`, and `checkBuild` for a module inside that `dist/` returns a message containing "not been built" and no count of hours or minutes.
- [ ] `checkBuild` returns verdict `current` for a module URL under `src/`, both when the fixture's `dist/` is older than its source and when it has no `dist/`.
- [ ] `checkBuild` for a module under a stale fixture's `dist/` returns verdict `stale` with a message naming the newest source file, `npm run build`, and `REGGIE_ALLOW_STALE=1`; with `REGGIE_ALLOW_STALE=1` in the env it returns `allowed`; with the variable set to `0` or unset it returns `stale`.
- [ ] In a checkout whose `src/util.ts` mtime is newer than every file in `dist/`, `node dist/cli.js tasks`, `node dist/cli.js journal show` and `node dist/cli.js serve --port 0` each exit with status 1, print the stale message on stderr, and print nothing on stdout.
- [ ] In the same checkout, `REGGIE_ALLOW_STALE=1 node dist/cli.js tasks` exits 0 with the task list on stdout and the "Running the stale build" message on stderr, and `node dist/cli.js --version` exits 0 with no stale message.
- [ ] After `npm run build` in that checkout, `node dist/cli.js tasks` exits 0 with nothing about a stale build on stderr.
- [ ] An MCP client connected to a server whose build check reports stale gets `isError: true` from both `reggie_tasks` and `reggie_journal`, with text naming `npm run build`, and no journal file is written.
- [ ] An MCP client connected to a server whose on-disk build is newer than the build it loaded gets `isError: true` with text telling it to restart the MCP server.
- [ ] The existing MCP end-to-end test, which spawns the CLI from `src/` through tsx, still lists the ten tools and captures through them.
- [ ] `docs/getting-started.md` and `packages/reggie/README.md` both name `REGGIE_ALLOW_STALE` and say a linked checkout refuses to run after a source edit until rebuilt, and `grep -rn warnIfStale packages/reggie/src` prints nothing.
- [ ] `npm test`, `npm run typecheck` and `npm run build` in packages/reggie each exit 0.

## Verification strategy
- Criterion 1: a unit test in build-state.test.ts that replaces "calls a missing dist stale" and asserts `built`, `aheadMs` and the message text; output in evidence/tests.txt.
- Criterion 2: a unit test in build-state.test.ts that passes a `src/cli.ts` module URL over a stale fixture and over a fixture with no `dist/`; output in evidence/tests.txt.
- Criterion 3: unit tests in build-state.test.ts for stale, for allowed with "1", and for stale with "0" and with the variable unset; output in evidence/tests.txt.
- Criterion 4: in the task worktree after a build, `touch src/util.ts`, then run the three commands capturing stdout, stderr and the exit status; transcript in evidence/stale-cli.txt.
- Criterion 5: in the same shell, the `REGGIE_ALLOW_STALE=1` run and the `--version` run with stdout, stderr and exit status; transcript in evidence/stale-cli.txt.
- Criterion 6: `npm run build`, then `node dist/cli.js tasks` with stderr and exit status; transcript in evidence/stale-cli.txt.
- Criterion 7: a test in test/mcp.test.ts that connects `createMcpServer` over `InMemoryTransport` with an injected stale check, calls both tools, and asserts no new file under `.reggie/journal`, with output in evidence/tests.txt; plus a live run, a small client script against `node dist/cli.js mcp` with a touched source file, recorded in evidence/stale-mcp.txt.
- Criterion 8: a test in test/mcp.test.ts with an injected check whose loaded build time is older than the build on disk; output in evidence/tests.txt.
- Criterion 9: the unchanged test "exposes the tools and captures through them" passing; output in evidence/tests.txt.
- Criterion 10: grep of both docs for the variable and the refusal sentence, and the empty grep for `warnIfStale`; transcript in evidence/docs-check.txt.
- Criterion 11: `npm test`, `npm run typecheck` and `npm run build` output with exit statuses; in evidence/tests.txt.

## Assumptions
- Decided by jacobpress in the brief: refuse instead of a tsx dev bin, keeping the single compiled bin; the escape hatch is an environment variable, not a flag.
- Settled from the code, as jacobpress asked, on which verbs refuse: every command, not a named list of loop verbs. Read verbs produce evidence too, and a list goes stale when verbs are added. The alternative was gating claim, launch, triage, journal, packet, decide and serve only.
- Settled from the code on a missing build: the command stops with "not built yet" and never builds automatically. Since the bin is `dist/cli.js`, that state is reachable only with a partial `dist/`, so it needs a clear message, not a build step. The alternative was one automatic build and carrying on.
- Settled from the code on the MCP server: it starts even when stale and refuses each tool call with `isError`. Failing to start surfaces only as a connection error, while a tool error reaches the agent, which relays it to the person. The alternative was refusing to start.
- Settled from the code on `.mcp.json`: it keeps `reggie mcp`, since there is no second bin to point at, and the server inherits the escape hatch from its environment.
- The variable is `REGGIE_ALLOW_STALE`, and only the exact value `1` opens it, matching the existing `REGGIE_TOOL` and `REGGIE_SESSION` naming.
- Running from `src/` through tsx is never stale, which keeps CI (tests before build), `npm run dev` and the tsx-spawned MCP test ungated.
- The per-call MCP check walks roughly forty source files, which is negligible next to a tool call and needs no caching.

## Out of scope
- A tsx-running dev bin, or any change to `bin` in package.json or to `.mcp.json`.
- Changing what any verb does once it runs, including the missing `Task:` and session lines on claims, which belong to the attribution item.
- Packaging or publishing for people who install the CLI rather than link it; an installed package has no `src/`.
- Gating MCP resources, or re-checking inside `serve` on each request after it has started.
- The journal union-merge, the worktree dependency link, and the stray stats file, which are separate items from the same decision.

## Bail conditions
- If commander 15's `preAction` hook on the root program does not fire for nested subcommands such as `plan lint` and `journal add`, gate through a shared helper called at the top of each action instead, and record the change in the packet.
- If `InMemoryTransport` cannot connect to the split `createMcpServer` without changing tool behaviour, drop the in-process MCP tests and prove criteria 7 and 8 with live `node dist/cli.js mcp` client runs only.
- If gating every verb breaks `reggie onboard` or `docs refresh` run from another repo in a way the escape hatch cannot cover, stop and ask jacobpress whether those verbs should warn instead of refusing.
- If the per-call MCP check adds more than 50 ms per call on this repo, stop and ask before adding caching.
