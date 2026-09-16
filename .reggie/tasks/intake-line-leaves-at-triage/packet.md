---
slug: intake-line-leaves-at-triage
title: Remove the intake line at triage instead of at plan done, and report a scaffolded but unfilled brief as ungroomed
risk: medium
author: jacobpress
date: 2026-09-15
branch: task/intake-line-leaves-at-triage
base: repo-manager
verdict: approved
decided_by: jacobpress
decided_at: 2026-09-16T03:38:23.257Z
---
# Completion: Remove the intake line at triage instead of at plan done, and report a scaffolded but unfilled brief as ungroomed

Read this top to bottom to decide whether the work is done. Every claim should point at evidence.

Built unattended overnight. Nobody was available to answer anything, so every choice the plan
left open was made here and is recorded under Deviations, and every number below was measured
rather than reasoned about.

## Acceptance criteria
- [x] AC1 `briefDraft(content)` is exported from `brief.ts` and returns `draft: true` only when `lintBrief` reports at least one `placeholder text still present in ## <section>` error, or reports `empty section: ## Problem` or `missing section: ## Problem`; for every other content, including a brief that fails only on `size` and `priority`, it returns `draft: false`.
  evidence: .reggie/tasks/intake-line-leaves-at-triage/evidence/brief-draft.txt — five cases over the four fixtures the plan named, plus one asserting a passing brief. The size/priority case asserts `lintBrief`'s two errors and then `draft: false`, so the separation is shown rather than claimed.
- [x] AC2 A task whose only brief is a scaffold written by `reggie triage` is reported `ungroomed`, with a reason that names the draft and says which sections are still the placeholder — for example `brief on disk is still triage's scaffold: placeholder text in Why now, Suspected area, Open questions, Not this`.
  evidence: .reggie/tasks/intake-line-leaves-at-triage/evidence/state-derivation.txt ("the scaffold triage writes leaves the task ungroomed, with a reason naming the draft"), which asserts that exact string; also .reggie/tasks/intake-line-leaves-at-triage/evidence/triage-all.txt, where the CLI prints it for three real tasks.
- [x] AC3 A task whose brief has every section written but leaves `size: unset` and `priority: unset` is reported `groomed`, and its reason is the unchanged `brief on disk; no plan yet`.
  evidence: .reggie/tasks/intake-line-leaves-at-triage/evidence/state-derivation.txt ("a brief written out but missing size and priority is groomed, with today's reason").
- [x] AC4 A task whose brief has every other section written but an empty `## Problem` is reported `ungroomed`, with a reason naming the empty Problem.
  evidence: .reggie/tasks/intake-line-leaves-at-triage/evidence/state-derivation.txt ("a brief written out but with an empty Problem is ungroomed, naming the empty Problem"); the reason asserted is `brief on disk is still triage's scaffold: the Problem section is empty`.
- [x] AC5 A task whose brief passes `lintBrief` is reported `groomed` with the reason `brief on disk; no plan yet`, or `brief on <base>; no plan yet` when the brief is only on the default branch — both strings byte-identical to today's.
  evidence: .reggie/tasks/intake-line-leaves-at-triage/evidence/state-derivation.txt — the two pre-existing cases "a brief alone makes an ungroomed item groomed" and "a brief committed to the default branch counts even when it is gone from disk" already assert both strings with `toBe`, and were not edited.
- [x] AC6 `reggie tasks --json --all` reports the same `slug`, `state` and `reason` for all 70 tasks before and after the code change, with the intake file untouched: the new rule relabels nothing that is on the board today.
  evidence: .reggie/tasks/intake-line-leaves-at-triage/evidence/board-diff.txt, which is empty (0 bytes), with board-before.json and board-after.json beside it and board-diff-command.txt naming the commands. 73 tasks, not 70: three more were captured after the plan was written. Both runs were made over one working tree at one moment, the "before" by a dist built from the base commit, so the only variable is the code — see Deviation 2.
- [x] AC7 `reggie triage <slug>` removes the slug's intake line, and its detail lines, in the same call that writes the brief, and does so after the write, so a write that throws leaves the line in place.
  evidence: .reggie/tasks/intake-line-leaves-at-triage/evidence/triage.txt — "takes the intake line and its detail in the same call that writes the brief" and "leaves the line in place when the write throws", the latter making the write fail with a directory where the brief should go.
- [x] AC8 `reggie triage <slug>` on a slug whose brief already exists reports the brief and removes no intake line, because it wrote nothing.
  evidence: .reggie/tasks/intake-line-leaves-at-triage/evidence/triage.txt ("removes no line when a brief is already there and force is not set"), which re-captures a line for the slug and asserts the intake file byte-identical afterwards.
- [x] AC9 `reggie triage <slug>` a second time, after the line is already gone, changes no file and exits 0.
  evidence: .reggie/tasks/intake-line-leaves-at-triage/evidence/triage.txt ("changes nothing at all when it runs a second time"), comparing a hashed recursive listing of `.reggie/`; and .reggie/tasks/intake-line-leaves-at-triage/evidence/plan-done.txt, where the CLI is run twice against a real repo with the same `shasum` before and after and `exit=0`.
- [x] AC10 When two intake lines carry one slug, `reggie triage` prefills `## Problem` from both lines and all their detail, and removes both, so no wording is dropped. Measured today: only the first line is read, and both are removed.
  evidence: .reggie/tasks/intake-line-leaves-at-triage/evidence/triage.txt ("reads every line carrying the slug"); and degenerate-cases.txt §1, which shows the rendered Problem holding both wordings, both detail lines and both capture stamps.
- [x] AC11 `reggie triage <slug> --force`, run when the slug has no intake line, keeps the existing brief's `title` front matter and its `## Problem` section instead of writing the scaffold placeholder and the slug, and an explicit `--title` still wins.
  evidence: .reggie/tasks/intake-line-leaves-at-triage/evidence/triage.txt ("falls back to the brief's own title and Problem when force runs with no line left"); and degenerate-cases.txt §3 against the real CLI. `--force` still rewrites the *other* sections back to the scaffold, which is what the flag has always meant; only the title and the Problem are preserved, and the card is ungroomed afterwards. Noted in Open risks.
- [x] AC12 `removeFromIntake` removes every bullet shape `parseIntake` accepts as an item — `- slug:`, `* slug:`, `+ slug:`, `- [ ] slug:` and a form indented up to three spaces — and still refuses to touch a different slug that shares a prefix, so `foo` does not take `foo-2`.
  evidence: .reggie/tasks/intake-line-leaves-at-triage/evidence/remove-from-intake.txt, asserting the remaining file text exactly; and degenerate-cases.txt §2. **Widened past the criterion**: the code review found two more shapes `parseIntake` accepts that the criterion did not list — a bullet with no slug prefix at all, and a raw prefix the parser slugifies (`Login_Retry:` → `login-retry`). Both are now covered, because removal is driven by `parseIntake` itself rather than by a second pattern. See Deviation 5.
- [x] AC13 `removeFromIntake` called for a slug that has no line returns `false` and writes nothing, so a second `reggie plan done` is harmless.
  evidence: .reggie/tasks/intake-line-leaves-at-triage/evidence/remove-from-intake.txt ("writes nothing for a slug that has no line"), asserting the file byte-identical; and plan-done.txt, where the CLI prints `was not in intake` and exits 0.
- [x] AC14 An intake line whose slug has no task directory is still on the board after triage: the directory holding the new brief is what keeps it there, and `reggie tasks` lists the slug with no intake line.
  evidence: .reggie/tasks/intake-line-leaves-at-triage/evidence/triage.txt ("keeps a slug on the board after its line is taken").
- [x] AC15 A card with a brief and no branch reports an age: `age` falls back to the brief's `created` front matter when there is no `lastActivity` and no intake line.
  evidence: .reggie/tasks/intake-line-leaves-at-triage/evidence/state-derivation.txt ("dates a card with a brief and no branch from the brief's created"), asserting `lastActivity` null, `intake` null and a non-null age; and sweep-ages.txt, where the fallback is what makes `derive-the-journal` report 1 rather than null after its line goes.
- [x] AC16 `reggie triage --all` scaffolds a brief only for ungroomed tasks that have none, and names an ungroomed task that already has a draft in the closing line as needing a session, so running it twice never prints "already exists" for the same slugs.
  evidence: .reggie/tasks/intake-line-leaves-at-triage/evidence/triage-all.txt — the verb run twice in a throwaway repo, with both outputs captured; and triage.txt ("the --all filter skips an ungroomed task that already has a draft").
- [x] AC17 `POST /api/intake` answers 409 with a message naming the brief when the task has one, and never creates an intake line for a slug that has a brief.
  evidence: .reggie/tasks/intake-line-leaves-at-triage/evidence/api-intake-409.txt (a server test asserting 409, the message naming the brief, and the intake file byte-identical); and degenerate-cases.txt §4, a live `curl` against `reggie serve` showing the 409 for a triaged slug and a 200 for one that still has a line and no brief.
- [x] AC18 The task page stops offering the "Say what you meant" form for a task whose brief exists, so AC17's refusal is never reached by an ordinary click.
  evidence: .reggie/tasks/intake-line-leaves-at-triage/evidence/ui-board-and-task-page.txt — a real browser on a live server: the form is found on a task that still has a line and no brief, and not found on one with a brief. Screenshots were replaced by DOM queries; see Deviation 6.
- [x] AC19 The board's optimistic update after `POST /api/triage` leaves the card in Ungroomed with a reason naming the new draft and clears its intake line, rather than moving it to Groomed and having the next reconcile pull it back.
  evidence: .reggie/tasks/intake-line-leaves-at-triage/evidence/ui-board-and-task-page.txt — the Scaffold button pressed in a real browser, the column counts read from the DOM straight after (ungroomed 5, groomed 0), and the server's own payload after the reconcile matching what the client wrote.
- [x] AC20 `reggie plan done <slug>` still exists, still removes a line, and its `--help` description says it sweeps a line that outlived its brief rather than that it is the step after a plan.
  evidence: .reggie/tasks/intake-line-leaves-at-triage/evidence/plan-done.txt — the `--help` output, a run against an already-swept slug printing `was not in intake` with exit 0, and a run that really removes a hand-written line.
- [x] AC21 The `ungroomed` and `groomed` entries of `STATE_MACHINE`, and the `ungroomed → groomed` transition trigger, describe the new rule, and `ui/board.js`'s `FALLBACK_STATES`, `FALLBACK_TRANSITIONS` and `COLUMN_RULE` say the same thing in the client's shorter form.
  evidence: .reggie/tasks/intake-line-leaves-at-triage/evidence/state-machine.txt — the live `/api/state-machine` payload beside the three client constants pasted from the file, and `ui/app.js`'s state tooltips, which the review found had been missed. Each `COLUMN_RULE` string is 26 characters or fewer, matching the previous longest, and ui-board-and-task-page.txt shows all five rendering on one line.
- [x] AC22 `docs.ts` no longer generates "intake line = ungroomed, `brief.md` = groomed", and this repo's `CLAUDE.md` and `AGENTS.md` carry the regenerated block.
  evidence: .reggie/tasks/intake-line-leaves-at-triage/evidence/docs-refresh.txt — the refresh output, the git diff of both generated blocks, and the diff of the one sentence in `docs.ts` that produced it. degenerate-cases.txt §6 also shows the new sentence in a repo freshly onboarded by this branch.
- [x] AC23 Searching the named paths for `the intake line is removed`, `Once a plan is`, `intake line with no plan`, `intake line = ungroomed` and `plan merged to the default branch` returns nothing that still states the old rule.
  evidence: .reggie/tasks/intake-line-leaves-at-triage/evidence/old-rule-grep.txt — the whole output with each remaining hit accounted for. Two hits are the superseded pre-brief `grooming` state in `docs/ui-spec.md` (named Out of scope by the plan) and in `ui/dev/sample-board.json`; the latter was captured rather than edited, see Discovered issues. One hit is the *new* rule in the structure document's table.
- [x] AC24 `.reggie/intake.md` carries the reworded header, and after the sweep every slug left in it is reported `ungroomed` by `reggie tasks --json --all` and has no `brief.md`.
  evidence: .reggie/tasks/intake-line-leaves-at-triage/evidence/intake-after-sweep.txt — the twelve removals, the item count either side, a join of every remaining slug against the board reporting 0 offenders, 0 consecutive blank lines and a single trailing newline. **68 items to 56, not 65 to 53**: three items were captured between the plan being written and this build. See Deviation 3.
- [x] AC25 The sweep changes no task's state and changes exactly one card's age: `derive-the-journal` goes from 3 days to 1.
  evidence: .reggie/tasks/intake-line-leaves-at-triage/evidence/sweep-ages.txt — `{slug,state,age}` for all 73 tasks captured under `TZ=UTC` immediately either side of the sweep, diffed twice: by line (one hunk, `"age": 3` → `"age": 1`) and keyed by slug (1 card changed, 0 state changes).
- [x] AC26 `TZ=UTC npm test` in `packages/reggie` passes with at least the baseline 665 tests and no failures; the known `src/tasks.test.ts` local-time failure does not appear under `TZ=UTC` and is not this task's.
  evidence: .reggie/tasks/intake-line-leaves-at-triage/evidence/tests.txt — 687 passed, 1 skipped, 32 files, exit 0. tests-local-tz.txt is the plain `npm test` run, where the one known local-time case fails; known-failure-on-base.txt runs that same case on the untouched base checkout and shows the identical assertion failing there, so it is not this task's.
- [x] AC27 `npm run typecheck` in `packages/reggie` passes.
  evidence: .reggie/tasks/intake-line-leaves-at-triage/evidence/typecheck.txt — exit 0.
- [x] AC28 `node dist/cli.js docs check` passes on a clean tree.
  evidence: .reggie/tasks/intake-line-leaves-at-triage/evidence/docs-check.txt — `fresh: CLAUDE.md`, `fresh: AGENTS.md`, exit 0, with the working tree listed beside it. Only `.reggie/` files were outstanding at that moment, and the check does not count `.reggie/` in the facts it compares (the refresh moved the count 223 → 224 for the one added source file and nothing else), so the result holds for the final tree.

## Evidence
- .reggie/tasks/intake-line-leaves-at-triage/evidence/board-before.json — the board under the base code
- .reggie/tasks/intake-line-leaves-at-triage/evidence/board-after.json — the board under this branch's code, same tree, same moment
- .reggie/tasks/intake-line-leaves-at-triage/evidence/board-diff.txt — empty; the headline criterion
- .reggie/tasks/intake-line-leaves-at-triage/evidence/board-diff-command.txt — how the two were produced
- .reggie/tasks/intake-line-leaves-at-triage/evidence/brief-draft.txt — AC1
- .reggie/tasks/intake-line-leaves-at-triage/evidence/state-derivation.txt — AC2, AC3, AC4, AC5, AC15
- .reggie/tasks/intake-line-leaves-at-triage/evidence/triage.txt — AC7, AC8, AC9, AC10, AC11, AC14, AC16
- .reggie/tasks/intake-line-leaves-at-triage/evidence/remove-from-intake.txt — AC12, AC13
- .reggie/tasks/intake-line-leaves-at-triage/evidence/api-intake-409.txt — AC17
- .reggie/tasks/intake-line-leaves-at-triage/evidence/triage-all.txt — AC16 at the CLI, run twice
- .reggie/tasks/intake-line-leaves-at-triage/evidence/plan-done.txt — AC9, AC20
- .reggie/tasks/intake-line-leaves-at-triage/evidence/degenerate-cases.txt — the six degenerate cases, end to end
- .reggie/tasks/intake-line-leaves-at-triage/evidence/ui-board-and-task-page.txt — AC18, AC19, the client half of AC21
- .reggie/tasks/intake-line-leaves-at-triage/evidence/state-machine.txt — AC21
- .reggie/tasks/intake-line-leaves-at-triage/evidence/intake-after-sweep.txt — AC24
- .reggie/tasks/intake-line-leaves-at-triage/evidence/sweep-ages.txt — AC25
- .reggie/tasks/intake-line-leaves-at-triage/evidence/tests.txt — AC26, `TZ=UTC npm test`
- .reggie/tasks/intake-line-leaves-at-triage/evidence/tests-local-tz.txt — the same suite in local time
- .reggie/tasks/intake-line-leaves-at-triage/evidence/known-failure-on-base.txt — that failure, on the untouched base
- .reggie/tasks/intake-line-leaves-at-triage/evidence/typecheck.txt — AC27
- .reggie/tasks/intake-line-leaves-at-triage/evidence/docs-refresh.txt — AC22
- .reggie/tasks/intake-line-leaves-at-triage/evidence/docs-check.txt — AC28
- .reggie/tasks/intake-line-leaves-at-triage/evidence/old-rule-grep.txt — AC23

## Changes
Four commits on `task/intake-line-leaves-at-triage`, after the claim:

- `5c085e3` feat(triage): the intake line leaves at triage, and an unfilled brief reads as ungroomed
- `4ec91a0` chore(intake): sweep the twelve lines that outlived their briefs
- `d0c2a02` fix(intake): remove by what parseIntake parsed, and stop assuming Ungroomed holds one kind of work
- `6de4d1c` docs: refresh the generated block for the new state rule

The behaviour is about seventy lines across six modules; most of the file count is one-line
wording in documents.

- `packages/reggie/src/brief.ts` — one exported predicate, `briefDraft(content)`, reading `lintBrief`'s errors
- `packages/reggie/src/tasks.ts` — the `hasBrief` branch consults it; `age` falls back to the brief's `created`; the two `STATE_MACHINE` entries and the shaping transition
- `packages/reggie/src/triage.ts` — removal moved in, after the write and only when it wrote; prefill from every line carrying the slug; the `--force` fallback; the capture stamp carried in
- `packages/reggie/src/capture.ts` — `removeFromIntake` driven by `parseIntake`
- `packages/reggie/src/cli.ts` — the `triage` and `plan done` descriptions, the `--all` filter, the `tasks` summary
- `packages/reggie/src/serve.ts` — the 409 on `POST /api/intake`, `takenFromIntake` on `POST /api/triage`
- `packages/reggie/ui/board.js` — the optimistic update, the answer form, the card actions and tick, the three state-machine constants
- `packages/reggie/ui/app.js` — the two state tooltips
- `packages/reggie/src/story.ts`, `launch.ts`, `layout.ts`, `docs.ts` — the descriptions each of them emits
- tests: `triage.test.ts` (new, 9 cases), plus cases in `brief.test.ts`, `tasks.test.ts`, `capture.test.ts` and `test/serve.test.ts`
- documents: the API contract, the tasks page spec, the structure document, getting started, three READMEs, `.reggie/README.md`, `.reggie/intake.md`
- notes: one for every source file touched

## Reviews
`/code-review` at medium effort, pointed at this worktree by absolute path. It reported reading
commits `5c085e3` and `4ec91a0` and the uncommitted evidence, quoted line numbers inside this
diff, and ran the package suite itself — so it was reading the right diff. It found eight things.
Seven are fixed in `d0c2a02`; one is declined with its reason.

1. **High — `removeFromIntake` still missed two shapes.** `parseIntake` also accepts a bullet with
   no slug prefix (slug from the text) and a raw prefix it slugifies, and the widened pattern
   matched neither, so such a line would outlive its own brief with no verb able to sweep it.
   Reproduced, then fixed by deleting the pattern and driving removal from `parseIntake` itself.
   The AC12 test now covers both shapes.
2. **Medium — the answer form's replacement hint contradicted itself.** "A brief has replaced this
   line" was printed directly under the line it said was gone. Reworded to say where the answer
   belongs and to name `reggie plan done` for the line. The second half of the finding — that the
   task page drops the form for groomed and later states too — is intended and matches AC17 and
   AC18: the server refuses those writes, so the page must not offer them.
3. **Medium — the capture date and capturer are lost.** Declined in the form the reviewer wanted
   (writing the intake date into the brief's `created`): the plan rejects adding a field to the
   brief contract, and AC25 requires the one age change that follows. Taken in a form that costs
   no new field: `problemFrom` now carries the line's `(person, source, date)` stamp into the
   Problem with the words, so the deletion no longer destroys who captured it and when.
4. **Medium — the `reggie tasks` summary contradicted its own column header.** It counted only the
   raw half and hid the drafts behind an `else if`. Both now print, and the two counts add to the
   header.
5. **Medium — `story.ts`'s flight section printed no date** for an ungroomed card once its line was
   gone, which is the case the age fallback exists for. It now falls back to the age.
6. **Low — the optimistic reason was hardcoded** for the prefilled case. It now mirrors what the
   server will say in both cases, and the optimistic problem text includes the detail lines.
7. **Low — the story's next-step copy over-claimed** ("nobody has filled it in yet") for a brief
   with one hint left. Reworded to "at least one section is still the template".
8. **Low — `ui/app.js`'s state tooltips were missed** by the sweep through every other copy of the
   rule, and the "brief not filled in" chip advised `reggie triage`, the one command that would
   wipe the brief. Both corrected.

`/simplify` was deliberately not run: it applies edits and can write into the serving checkout.

## Deviations from plan
1. **`reggie claim --worktree` was run from the serving checkout, not from the launch directory's
   own branch.** The session was started in `.worktree/repo-manager`, which is the integration
   branch's working copy. Claiming created `.worktree/intake-line-leaves-at-triage` on
   `task/intake-line-leaves-at-triage`, which is the pattern every task on this branch has
   followed; the manager merges that branch.
2. **AC6's before/after pair was taken differently from the plan's recipe.** The plan said to run
   at `a3887e4` and again on the build branch. That would have compared two different repositories:
   the plan commit, the capture commit and the claim commit all change what the board reports,
   independently of any code. Instead both runs were made over one working tree at one moment, the
   "before" by a dist compiled from the base commit's source, so the only variable is the code —
   which is what the criterion is actually about. Commands recorded in board-diff-command.txt.
3. **The numbers in AC6 and AC24 are 73 and 68 → 56, not 70 and 65 → 53.** Three items were
   captured after the planner measured, in the `capture: three findings` commit that immediately
   precedes the plan. The twelve stale lines are exactly the twelve the plan named; they were found
   by joining `parseIntake` against the board rather than typed from the plan.
4. **The board's optimistic update no longer stamps `lastActivity`.** The old code set it to now,
   which the server never reports for a brief, so the reconcile would have undone it — the same
   snap-back AC19 exists to remove.
5. **AC12 was implemented wider than written.** It named five bullet shapes; the review found two
   more that `parseIntake` accepts. Rather than list seven, removal now asks `parseIntake` which
   lines carry the slug, so the two can never disagree again.
6. **AC18 and AC19 were verified by DOM query rather than by screenshot.** The plan named three
   PNGs. This session can drive a browser but cannot write image files from it. Every page was
   opened and viewed, and each screenshot is replaced by the query it was meant to prove, which is
   machine-checkable. Recorded at the top of ui-board-and-task-page.txt.
7. **Two card controls outside the plan's list were changed.** After triage an ungroomed card still
   offered "Read the intake line", for a line that is gone, and "Scaffold a brief", which the server
   would skip; the column button counted those cards too. Both now depend on whether the card has a
   brief. This is the same defect the plan already named on the answer form, one screen over.
8. **`story.ts` and `launch.ts` were edited beyond their descriptions.** The brief story's
   "What happens next" now asks the task's state, because for a draft brief the next step is the
   shaping conversation and not a plan; the shape prompt tells a session that triage takes the line
   and to fill in an existing scaffold rather than pass `--force`.

Nothing was blocked, and no bail condition fired. The board diff was empty on the first run and
again on the last.

## Discovered issues
Captured, not fixed:

- `the-dev-harness-sample-board-still-carries-the-p` — `packages/reggie/ui/dev/sample-board.json`
  holds a frozen `/api/state-machine` payload from before briefs existed, with a `grooming` state.
  The dev harnesses let a module be developed without the server, so anyone opening `board.js`
  that way sees a state machine that has been wrong since briefs landed and is now wrong twice
  over. `ui-spec.md` carries the same superseded text and the plan names it Out of scope as a
  historical design document; a sample payload is not history, so it is captured separately.
- `the-episode-m4a-test-can-time-out-at-sixty-secon` — `src/episode.test.ts`'s m4a case failed once
  at 60006 ms during a full run while a browser and a local `reggie serve` were on the same
  machine; alone the file finishes in 547 ms and a repeat full run passed. It shells out to the
  platform speech synthesiser, so a fixed sixty-second timeout turns a busy machine into a red
  build. Third intermittent failure recorded on this suite.

Already captured before this task and still true: the local-time `ageInDays` failure
(`a-task-captured-today-reads-as-one-day-old-for-t`), the flaky fixture repo under parallel vitest
(`the-test-suite-fails-intermittently-in-makefixtu`), and the hand-written client copy of the state
machine (`the-web-client-keeps-a-hand-written-copy-of-stat`), which this task edits by hand as the
plan says it would.

## Open risks
- **`--force` still rewrites the sections it does not preserve.** AC11 asked only for the title and
  the Problem, and that is what survives; Why now, Suspected area, Open questions and Not this go
  back to the template, so a `--force` on a filled-in brief demotes the card to ungroomed. That is
  what the flag has always meant ("discarding what it says") and what its help text says, but it is
  sharper now that the demotion is visible. Someone would notice as a card moving backwards after
  a deliberate rewrite.
- **The draft rule fires on any single remaining hint.** A brief with four sections written and the
  one-line "Not this" hint left behind reads as ungroomed. That is the rule the owner asked for —
  only emptiness disproves "somebody has said what this is" — but the first person to leave one
  section blank will read it as a bug. No brief in this repo trips it today.
- **The answer form is gone for every task that has a brief**, not only ungroomed ones. A planned or
  in-flight task can no longer have intake detail added from the page. The server refuses those
  writes anyway, so the alternative is a button that always errors; routing answers into the brief
  belongs to `needs-you-queue`, whose own brief already claims it.
- **`ui/board.js` still has no automated test**, so AC18, AC19 and the client's copy of the state
  machine rest on the browser checks in this packet and on a reviewer reading two files side by
  side. Captured separately as `the-web-client-keeps-a-hand-written-copy-of-stat`.
- **The intake header now promises something the code does for `reggie triage` only.** A line
  written by hand for a slug that already has a brief still sits in intake until someone runs
  `reggie plan done`. The board no longer offers the answer form on such a card and says where the
  words belong, but nothing removes the line automatically.

## Decision
- approved by jacobpress on 2026-09-15: Overnight run: independently re-ran TZ=UTC suite (687 passed, +22) and confirmed board-diff.txt is genuinely 0 bytes - 73 of 73 tasks keep the same slug, state and reason. Known tasks.ts failure reproduced identically on the untouched base. Seven of eight code-review findings fixed, one declined with reasoning. docs check exits 0 on a clean tree. Approved by the manager session under the overnight delegation.
