---
slug: false-tests-sentence
title: Three story sites say how many source files are tested, or say nothing
risk: low
author: jacobpress
date: 2026-09-15
branch: task/false-tests-sentence
base: repo-manager
verdict: pending
decided_by:
decided_at:
---
# Completion: Three story sites say how many source files are tested, or say nothing

Read this top to bottom to decide whether the work is done. Every claim should point at evidence.

## Acceptance criteria
- [x] `grep -n "files > source" packages/reggie/src/story.ts` returns nothing, and the string `with tests` appears nowhere in `packages/reggie/src/story.ts`.
  evidence: .reggie/tasks/false-tests-sentence/evidence/guard-gone.txt — both greps empty, plus the one definition and three call sites of the helper that replaced the guard
- [x] All three sites — the made-of paragraph, the area subtitle and `explainContainer`'s first sentence — build their tests clause by calling one shared helper in `story.ts`, and no site formats the clause text itself.
  evidence: .reggie/tasks/false-tests-sentence/evidence/story-diff.txt — one `testedClause` definition; each of the three sites reads `agg?.testedSource ?? 0`, calls it, and appends the string it returns without reformatting it
- [x] The clause text is `N of them tested`, where N is `numberWord(aggregates.testedSource)` of the node the sentence is about, and it is preceded by a comma rather than wrapped in parentheses.
  evidence: .reggie/tasks/false-tests-sentence/evidence/story-diff.txt for the template and the comma; .reggie/tasks/false-tests-sentence/evidence/rendered-before-after.txt for the rendered sentences at all three sites
- [x] Each of the three sites omits the clause entirely when `testedSource` is zero, leaving the rest of the sentence and its punctuation intact.
  evidence: .reggie/tasks/false-tests-sentence/evidence/tests.txt — the config-only and source-only cases, by test name; .reggie/tasks/false-tests-sentence/evidence/rendered-before-after.txt — the `packages/reggie/ui` and `packages/reggie/test` rows carry no clause and the rest of each sentence is intact
- [x] In the made-of paragraph the clause text is the label of a link whose route is the area's route with `?lens=tests`, unchanged from today.
  evidence: .reggie/tasks/false-tests-sentence/evidence/rendered-before-after.txt — the made-of paragraph with its raw [[route|label]] markup, `?lens=tests` on the clause label; pinned by the test named in .reggie/tasks/false-tests-sentence/evidence/tests.txt
- [x] Rendered against the repo at the landing commit, the area subtitle for `packages/reggie/src` names the same tested count as the first number after `cover` in that area's Tests section paragraph.
  evidence: .reggie/tasks/false-tests-sentence/evidence/subtitle-vs-tests.txt — subtitle "38 source files, 35 of them tested" beside "28 test files cover 35 of 38 source files"
- [x] Rendered against the repo at the landing commit, no clause prints a tested count greater than the source count printed beside it in the same sentence, at any of the three sites, for every Level-1 area and for the repo.
  evidence: .reggie/tasks/false-tests-sentence/evidence/counts-bounded.txt — per area and for the repo, the two counts and a tested <= source line; every row OK
- [x] Rendered against the repo at the landing commit, the area subtitle for `packages/reggie/test` is `TypeScript area, no source files.` with no tests clause.
  evidence: .reggie/tasks/false-tests-sentence/evidence/subtitle-vs-tests.txt — the `packages/reggie/test` row, exactly that string
- [x] `story.test.ts` gains a test that renders all three sites against a purpose-built repo holding three areas: one with test files importing its source, one whose only non-source file is a config file with a code extension such as `vitest.config.ts`, and one holding source files only.
  evidence: .reggie/tasks/false-tests-sentence/evidence/story-test-diff.txt — three areas: `covered/` (a test imports all three source files), `configured/` (three source files and `vitest.config.ts`), `plain/` (source only)
- [x] That test asserts the clause appears with the tested count for the first area and is absent for the other two, and it fails when the guard is restored to `files > source`.
  evidence: .reggie/tasks/false-tests-sentence/evidence/mutation-probe.txt — guard restored at all three sites: 5 of the 6 assertions fail, vitest exit 1; reverted, 70 pass, exit 0
- [x] `packages/reggie/ui/dev/sample-story.json` and `packages/reggie/ui/dev/sample-explain.json` carry the new clause, with tested counts equal to the `testedSource` values the matching areas hold in `packages/reggie/ui/dev/sample-container.json`.
  evidence: .reggie/tasks/false-tests-sentence/evidence/samples-consistent.txt — 20/20, 12/12, one/1 against the aggregates in sample-container.json; both files still parse
- [x] The made-of row of `packages/reggie/docs/ui-spec.md` quotes the new sentence, maps `N of them tested` to `?lens=tests`, and states that the clause is omitted when no source file is tested.
  evidence: .reggie/tasks/false-tests-sentence/evidence/docs-diff.txt — the row quotes the new sentence, maps each number to its lens including `N of them tested` to `?lens=tests`, and states the omission rule
- [x] The about-this-repo bullet in `docs/ui-plan.md` no longer lists this defect under "Still to fix" and instead records that `false-tests-sentence` fixed it, naming the clause that replaced it.
  evidence: .reggie/tasks/false-tests-sentence/evidence/docs-diff.txt — the bullet now reads "Fixed on 2026-09-15 (task `false-tests-sentence`)" and names the clause that replaced it
- [ ] `grep -rn "with tests" packages/reggie/src packages/reggie/ui packages/reggie/docs docs` returns exactly one line, the lens comment in `packages/reggie/src/views.ts` about test files being hidden.
  evidence: .reggie/tasks/false-tests-sentence/evidence/phrase-sweep.txt — TWO lines, not one. See Deviations: the second is a named constant in story.test.ts whose only job is to fail if the phrase returns
- [ ] Run from `packages/reggie`, `npm test`, `npm run typecheck` and `npm run build` each exit 0 at the landing commit.
  evidence: .reggie/tasks/false-tests-sentence/evidence/build.txt — typecheck 0, build 0, `npm test` 1 and `TZ=UTC npm test` 0. The single failure is a pre-existing clock artifact in an unrelated test. See Discovered issues

## Evidence
- .reggie/tasks/false-tests-sentence/evidence/build.txt
- .reggie/tasks/false-tests-sentence/evidence/counts-bounded.txt
- .reggie/tasks/false-tests-sentence/evidence/docs-diff.txt
- .reggie/tasks/false-tests-sentence/evidence/guard-gone.txt
- .reggie/tasks/false-tests-sentence/evidence/mutation-probe.txt
- .reggie/tasks/false-tests-sentence/evidence/phrase-sweep.txt
- .reggie/tasks/false-tests-sentence/evidence/rendered-before-after.txt
- .reggie/tasks/false-tests-sentence/evidence/samples-consistent.txt
- .reggie/tasks/false-tests-sentence/evidence/story-diff.txt
- .reggie/tasks/false-tests-sentence/evidence/story-test-diff.txt
- .reggie/tasks/false-tests-sentence/evidence/subtitle-vs-tests.txt
- .reggie/tasks/false-tests-sentence/evidence/tests.txt

## Changes
14 files changed against repo-manager:

```
.reggie/intake.md                                  |   1 +
 .reggie/journal/2026-09-15/jacobpress-session.md   |  14 +++
 .reggie/notes/docs/ui-plan.md.md                   |   9 ++
 .reggie/notes/packages/reggie/docs/ui-spec.md.md   |   9 ++
 .reggie/notes/packages/reggie/src/story.test.ts.md |   9 ++
 .reggie/notes/packages/reggie/src/story.ts.md      |   4 +
 .reggie/notes/packages/reggie/ui/dev/_dir.md       |   9 ++
 .reggie/tasks/false-tests-sentence/claim.md        |  10 ++
 docs/ui-plan.md                                    |   2 +-
 packages/reggie/docs/ui-spec.md                    |   2 +-
 packages/reggie/src/story.test.ts                  | 109 +++++++++++++++++++++
 packages/reggie/src/story.ts                       |  31 ++++--
 packages/reggie/ui/dev/sample-explain.json         |   2 +-
 packages/reggie/ui/dev/sample-story.json           |   4 +-
 14 files changed, 204 insertions(+), 11 deletions(-)
```

## Reviews
- Risk is low, so the review bar is the repo's own checks rather than `/code-review`. From `packages/reggie`: `npm run typecheck` exit 0, `npm run build` exit 0, `npm test` exit 1 on one pre-existing failure in an unrelated file and exit 0 with `TZ=UTC`. Full output and both test runs in `evidence/build.txt`.
- The generated blocks were checked on the committed tree: `reggie docs check` reports `fresh: CLAUDE.md` and `fresh: AGENTS.md`, so this change does not move the counts in the generated block.
- `/simplify` was deliberately not run: it applies edits and defaults to the parent session's directory, which is the serving checkout, not this worktree.
- Findings from those checks: one, the `npm test` failure, which was traced rather than resolved here because it is not this task's. It is recorded under Discovered issues and captured to intake.
- Self-review of the change itself found one thing worth naming: after the edit, `files` is no longer read at any of the three sites, so the local was removed in all three rather than left unused. `ref.files` is still on the `AreaRef` contract type and is untouched; only this file stopped reading it.

## Deviations from plan
- **The phrase sweep returns two lines, not one.** The plan's criterion 14 expects `grep -rn "with tests"` over `packages/reggie/src`, `packages/reggie/ui`, `packages/reggie/docs` and `docs` to return exactly one line — the lens comment in `views.ts`. It returns two. The second is `const OLD_WORDING = "with tests";` in `story.test.ts`, used twice: once to build the regex that asserts no clause appears in an area with no tested source, and once to assert the retired phrase appears nowhere in the covered area's three sentences. Spelling around the grep (matching `"with test"`, or dropping the assertion) would either be a trick or would remove the drift guard the criterion exists to provide, so the phrase is named once, in the one place whose job is to fail if it comes back. Two other hits were removed to get to two: the `ui-plan.md` record was reworded to describe the old defect instead of quoting it, which criterion 13 permits since it asks only that the new clause be named, and the test's second literal was folded into this one constant. `evidence/phrase-sweep.txt` lists both remaining lines and a second sweep for the new wording.
- **`npm test` exits 1 at the landing commit, in local time.** Criterion 15 asks for exit 0 from all three commands. `npm run typecheck` and `npm run build` exit 0. `npm test` fails one assertion in `src/tasks.test.ts` and passes under `TZ=UTC`. The failure is a clock artifact with no connection to this change — see Discovered issues — and it was captured rather than fixed, per the working agreement. The criterion is left unchecked rather than quietly redefined: a reader running `npm test` this evening will see red, and should know why before they see it.
- No other deviation. The approach, the wording, the placement, the link, the zero behaviour, the one-helper design and the three-area test are as the plan specifies.

## Discovered issues
- **A task captured in the evening west of UTC reads as one day old, and one test fails with it.** `ageInDays` in `tasks.ts` parses a `YYYY-MM-DD` with `Date.parse`, which reads a bare date as midnight UTC, but the date it is given was written in local time. From roughly 20:00 EDT onwards, a task captured today measures as one day old. `src/tasks.test.ts` > "assembles plan, packet, claim, journal, and impact as a task moves" asserts `age` is 0 and gets 1; the same test passes with `TZ=UTC`, and nothing in its import graph touches `story.ts`. This affects every age Reggie prints for a task, not only the test. Captured to intake as `a-task-captured-today-reads-as-one-day-old-for-t`. Not fixed here.
- The two defects in the area Tests section that the plan lists as out of scope were already captured while planning, and are visible in the evidence rather than fixed: `evidence/subtitle-vs-tests.txt` shows `packages/reggie/test` rendering "five test files cover no of no source files". That section is the fixed point this task was made to agree with, so editing both ends of the agreement at once would have lost the reference.

## Open risks
- **The clause goes silent where the graph cannot resolve imports.** `testedSource` is zero everywhere in a repo whose language the import graph does not follow — the Swift, Kotlin, Go and Python repos on the near-term roadmap — so the clause will simply not appear there. This is the accepted cost of choosing the tested-source count over the test-file count, argued at length in the plan's Assumptions. Someone would notice it as an area page that says nothing about tests in a repo that visibly has tests. `graph-coverage-published` is the queued item that will say what the map could not read.
- **The story payload's text is now assumed not to be parsed by any client.** Removing the parentheses changes the text a client receives. The plan named this as a bail condition, so it was checked rather than assumed: every paragraph in `ui/story.js` reaches the DOM through `linkifyWith`, which resolves `[[route|label]]` markup and backticks and nothing else, and the only regexes in that file parse dates. Nothing in the client reads the parenthetical as structure, and no test asserted on it. If some consumer outside this repo parses the sentence, it would break, and the payload would turn out to be a contract.
- **The two `ui/dev` samples can drift again.** They are hand-written, no generator writes them, and no test reads them. The guard is the phrase sweep, which is a habit rather than a check. A note on `ui/dev/` now says so.
- **The new test pins exact strings.** Two assertions compare a whole subtitle with `toBe`. A deliberate future rewording of the subtitle will fail them, which is the point, but it means the test has to be updated with the wording rather than around it.
