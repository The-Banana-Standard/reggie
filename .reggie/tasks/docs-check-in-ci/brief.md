---
slug: docs-check-in-ci
title: Three docs promise reggie docs check runs in CI; ci.yml never runs it
area: .github/workflows
size: small
risk: low
priority: P2
author: jacobpress
created: 2026-09-15
---
# Three docs promise reggie docs check runs in CI; ci.yml never runs it

## Problem
Four places in the repo tell a reader that the generated block in CLAUDE.md and AGENTS.md is guarded automatically: the paradigm doc says the check fails CI on drift, the structure doc says the same, the weekly rhythm in getting-started lists it, and the package README says to use it in CI on a clean tree. The workflow runs typecheck, test and build and nothing else, so nobody is guarded. A stale block can sit on main for as long as it takes someone to notice by hand, which is exactly the failure the generated-block paradigm exists to prevent, and the promise itself makes it less likely anyone looks.

## Why now
The generated block was refreshed by hand on 2026-09-15 and that refresh has not been committed yet. While the tree is fresh the step can be added and proved in the same breath: the refresh and the new step land in one commit, so the first run of the step on main passes rather than failing on drift that predates it. Wait, and the next person to change the repo's shape reopens the gap and the first run turns red for a reason that has nothing to do with their change. The loop-plumbing-first decision of 2026-09-15 also puts small guardrails like this ahead of features.

## Suspected area
- `.github/workflows/ci.yml` — the one workflow; the job sets its working directory to the package and ends at build. The step belongs after build because the bin is not installed in that job, so the check has to be invoked from the freshly built output.
- `packages/reggie/src/docs.ts` — read only, to confirm what the check compares and what it forgives; it already ignores the generation date, so the step is stable on any later day.
- `CLAUDE.md`, `AGENTS.md` — the files the check reads; their refreshed block is the thing the first green run depends on.

## Open questions
- Should the check run on both matrix legs, or once on ubuntu only? Its result does not depend on the platform, so the second run is pure cost, but a single-platform step is an exception to how the job is built today.
- Should it be a step in the existing job or a job of its own, so a drift failure reads as drift rather than as a build failure in the log?
- The refreshed block's file and language counts already assume the other pending changes in the working tree, including the removed history file. Does the same commit have to carry those, or does the block need refreshing once more at the moment the step lands?
- Once the step exists, do the four places that describe the check need any edit to say where it runs, or do they stand as written?

## Not this
- Checking the curated, hand-written sections of CLAUDE.md against the graph. That is a separate captured item; this check only compares the generated block.
- Automating the refresh itself, by a bot or a hook that commits a regenerated block. This task only makes drift visible; who fixes it and how stays a human act.
- Any other addition to the workflow, such as lint, coverage or a release step, and any change to the matrix beyond what the question above settles.
