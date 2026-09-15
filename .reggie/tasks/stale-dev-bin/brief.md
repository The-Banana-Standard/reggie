---
slug: stale-dev-bin
title: Stop the reggie on the PATH from silently running a stale build
area: packages/reggie
size: small
risk: low
priority: P1
author: jacobpress
created: 2026-09-15
---
# Stop the reggie on the PATH from silently running a stale build

## Problem
The `reggie` command on the PATH is a link into this checkout, and the package's bin entry points at `dist/cli.js`, so every verb runs whatever was last compiled rather than what is written in `src/`. Edit the source, skip the build, and nothing complains: the commands keep working, with the behaviour they had before the edit.

On 2026-09-14 the compiled build in use was four days behind the source. A whole loop session ran against old code, and the symptoms — a verb that recorded less than it should, an endpoint that was not there — read as a set of broken features rather than as one unbuilt package. Only `serve` checks for this; `claim`, `launch`, `triage`, `journal`, `decide` and the MCP server say nothing at all. The one check that does exist also lies in the worst case: when `dist/` is missing entirely it compares the newest source against a zero timestamp and reports an age of hundreds of thousands of hours, so the first time a reader meets the warning it is obviously false and easy to dismiss.

The build was refreshed by hand on 2026-09-15, which clears today's symptom and changes nothing about tomorrow's. This item is the durable fix: make it impossible, or at least loud, to run the loop against code that is not the code in the checkout.

## Why now
Every remaining item is built through the loop, and the 2026-09-15 decisions put loop plumbing ahead of every feature with this one first in the order. That order exists because a stale bin poisons the evidence for everything after it: a verb that quietly runs old code makes the next bug report untrustworthy, and the debugging time is spent on a feature that was never actually running. The hand rebuild bought a day, not a fix, and the same trap is waiting for the next session that edits the source before running a verb.

## Suspected area
- packages/reggie/package.json because `bin.reggie` resolves to `dist/cli.js`; that single line is why a linked checkout can run stale at all, and it is what a source-running dev bin would change
- packages/reggie/src/build-state.ts because it holds the src-versus-dist comparison and the age arithmetic that produces the nonsense number when there is no build to compare against
- packages/reggie/src/cli.ts because `warnIfStale` is defined there and is wired into `serve` alone; whatever replaces it — a refusal, a wider warning — is wired in the same place, next to the other command definitions
- .mcp.json because it starts the MCP server with the bare `reggie mcp` command, so the server Claude Code and Codex talk to inherits whatever the bin happens to resolve to
- packages/reggie/src/mcp.ts because that server speaks stdio to a session and writes its only status line to stderr, so it needs its own answer for how a person would ever see a staleness complaint
- docs/getting-started.md because the setup it documents is exactly the link-then-build step that creates this situation, and the instruction changes with whichever shape wins

## Open questions
- Which shape wins: a dev bin that runs `src/` through tsx so a build is never needed in a checkout, or keeping the compiled bin and refusing to run the loop verbs while the build is behind the source? The 2026-09-15 decisions settle the order of the work but not this fork. Weighing it needs the per-command startup cost of tsx, since every verb and the MCP server would pay it.
  > Answered by jacobpress on 2026-09-15: Refuse. Keep the single compiled bin and refuse the loop verbs when dist is behind src; one bin keeps the CLI and the MCP server on the same code and the staleness check already exists.
- If refusing is the shape, is the refusal absolute, or does it keep an escape hatch — an environment variable or a flag — for someone who knowingly wants to run the previous build?
  > Answered by jacobpress on 2026-09-15: An environment variable escape hatch, not a flag, so a half-edited source tree cannot lock out serve or the MCP server.
- Which verbs refuse or warn? `serve` warns today. `claim`, `launch`, `triage`, `journal`, `packet` and `decide` are all loop plumbing, and in solo mode `decide` performs the merge itself, so it is the most expensive one to run stale.
- What should happen when `dist/` is missing altogether rather than merely old? The agreed part is that the message says it is not built yet instead of inventing an age; the open part is whether the command stops there or builds once and carries on.
- How does the MCP server surface this? It talks stdio to a session and its stderr may never reach a person, so a refusal that only prints is a refusal nobody reads. A tool result that says the server is stale is one option; failing to start is another, harsher one.
- If the dev bin wins, does `.mcp.json` point at it too, or does the MCP entry keep naming the installed bin so a session is never running two different Reggies at once?

## Not this
- The missing `Task:` line and session line that `claim` failed to write. That belongs to the attribution item, third in the 2026-09-15 order; it is about what a claim records, not about which code runs.
- Changing what any loop verb does. This item only makes sure the verb that runs is the one that was written.
- Packaging or publishing the CLI for people who install it rather than link it. An installed package has no `src/` to compare against, so the problem is already absent there.
- The journal union-merge, the worktree dependency link, and the stray stats file. They are the neighbouring loop-plumbing items from the same decision and each lands as its own task.
