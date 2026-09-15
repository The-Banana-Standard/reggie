---
slug: false-tests-sentence
title: Three story sites say how many source files are tested, or say nothing
risk: low
deciders: []
author: jacobpress
created: 2026-09-15
---
# Three story sites say how many source files are tested, or say nothing

## Problem
`packages/reggie/src/story.ts` builds the same tests clause three times from the same two aggregates, each guarded by `files > source`:

- `madeOfSection`, the repo page's "What it is made of" paragraph: `if (files > source) parts.push(" (" + linkRoute(routeFor(ctx.repo, ref.id, { lens: "tests" }), numberWord(files) + " with tests") + ")")`.
- `areaStory`'s subtitle: `${countPhrase(source, "source file")}${files > source ? ` (${numberWord(files)} with tests)` : ""}`.
- `explainContainer`'s what-it-is sentence, the first of the four Spotlight sentences, built the same way.

`files` is every scanned file of every role, so the clause prints a total under a label that says tests. Rendered from this worktree at `32dc1fa` with `buildStoryContext` over the real graph, the three sentences are:

- made-of: "`packages/reggie/src` is a TypeScript area: 38 source files (66 with tests), 23 with a note, changed 17 times in the last 30 days, mostly by jacobpress."
- area subtitle for `packages/reggie/src`: "TypeScript area, 38 source files (66 with tests)."
- repo Spotlight: "`reggie` is a TypeScript repo of 52 source files (86 with tests), 43903 lines in all."

Sixty-six is larger than thirty-eight: the sentence claims more tested files than there are files to test. The honest numbers are already in the same payload and the same page. `areaTests` renders, a few hundred pixels under that subtitle, "28 test files cover 35 of 38 source files." One page carries both.

The guard fails a second way. `roles.ts` puts `source`, `test`, `fixture`, `config` and `generated` in `files` and only `source` in `source`, so `files > source` is true whenever an area holds anything that is not source. Verified on a throwaway repo: a folder of three source files plus `vitest.config.ts` renders "TypeScript area, three source files (four with tests)" with no test anywhere in the repo, and the same folder with `routes.gen.ts` instead renders the same sentence. One correction to the brief, which matters for the test: `CODE_EXT` in `graph.ts` is `ts, tsx, mts, cts, js, jsx, mjs, cjs, rs`, so `tsconfig.json` is never scanned, never lands in `files`, and cannot trip the guard. Only a config or generated file with a code extension does. In this repo the single config-role file is `packages/reggie/vitest.config.ts`.

The guard also produces the reverse nonsense where an area is all tests: `packages/reggie/test` renders "TypeScript area, no source files (five with tests)."

Nothing holds the clause in place. `story.test.ts` asserts `expect(text).toMatch(/source files/)` on the made-of paragraph and nothing else about counts, which is how three copies drifted from the graph unnoticed. The wrong wording is also the written record: `packages/reggie/docs/ui-spec.md:49` quotes "21 source files (32 with tests)" as the specification of the paragraph, `packages/reggie/ui/dev/sample-story.json` carries it twice and `packages/reggie/ui/dev/sample-explain.json` once, and `docs/ui-plan.md:143` lists it as "Still to fix" on the about-this-repo track.

## Approach
Print the tested-source count, name it, and drop the clause when it is zero.

One module-local helper in `story.ts` returns the clause text or nothing, something like `testedClause(tested: number): string | null`, yielding `${numberWord(tested)} of them tested` when `tested > 0` and `null` otherwise. All three sites read `agg?.testedSource ?? 0`, call the helper and append `, ${clause}` after the source-file count; `madeOfSection` additionally wraps the clause text in the `linkRoute(routeFor(ctx.repo, ref.id, { lens: "tests" }), …)` it already has. `files > source` disappears from `story.ts`, and with it the parentheses. The three sites become one expression so they cannot drift apart again, which is the defect's actual cause.

The sentences become:

- made-of: "`packages/reggie/src` is a TypeScript area: 38 source files, 35 of them tested, 23 with a note, changed 17 times in the last 30 days, mostly by jacobpress."
- subtitle: "TypeScript area, 38 source files, 35 of them tested."
- Spotlight: "`reggie` is a TypeScript repo of 52 source files, 35 of them tested, 43903 lines in all."

The clause sits where the old parenthetical sat, so it reads as one more property of the source files the sentence just counted, exactly like the `${numberWord(documented)} with a note` clause beside it. "Of them" always has its antecedent in the same sentence, and `testedSource` counts only source files, so the number can never exceed the source count printed immediately before it. The impossible sentence becomes unreachable rather than merely corrected.

It does not contradict `areaTests`: "28 test files cover 35 of 38 source files" and "38 source files, 35 of them tested" are the headline and the detail of one fact, and both read `agg.testedSource`, so they cannot disagree by construction. The link keeps `?lens=tests`, because `docs/ui-spec.md:89` says that lens colours "containers by tested share" and marks source files with a test importer `--ok` and those without `#3b4252` — the clause now claims exactly what the lens draws.

Rejected alternatives:

- The test-file count, `agg.tests`, worded "and 11 test files". It is the cheaper claim and it survives in repos whose imports the graph cannot resolve, but it puts a number in a coverage-shaped slot that a reader converts into a coverage impression — the original sin of this item — and `tests` folds fixtures, mocks and `test/helpers.*` in through `isTestLike`, so the label would over-count what it names. The full argument, including the case where it would have won, is in Assumptions.
- Printing both, "38 source files, 35 of them tested by 28 test files". It restates the Tests section in full in three more places, which is the "same fact twice" the brief warns against, and it crowds the one-line subtitle.
- Keeping the parenthetical and only changing the number. A parenthesis reads as an aside; the clause is a claim about the subject of the sentence and belongs in the list with the other claims.
- Adding `tests` and `testedSource` to `AreaRef`. `AreaRef` is a published contract type in `docs/ui-api-contract.md` and the legend and lenses read it; widening it for a fallback that only fires when a view node has no aggregates is a contract change for no reader.

Alongside the code, the same commit corrects the written record: the made-of row in `packages/reggie/docs/ui-spec.md`, the two `ui/dev` samples the dev harness renders, and the "Still to fix" line in `docs/ui-plan.md`. The build session also records a `how` note on `story.ts` for the clause, per the working agreement.

## Files to touch
- packages/reggie/src/story.ts (MOD)
- packages/reggie/src/story.test.ts (MOD)
- packages/reggie/ui/dev/sample-story.json (MOD)
- packages/reggie/ui/dev/sample-explain.json (MOD)
- packages/reggie/docs/ui-spec.md (MOD)
- docs/ui-plan.md (MOD)

## Acceptance criteria
- [ ] `grep -n "files > source" packages/reggie/src/story.ts` returns nothing, and the string `with tests` appears nowhere in `packages/reggie/src/story.ts`.
- [ ] All three sites — the made-of paragraph, the area subtitle and `explainContainer`'s first sentence — build their tests clause by calling one shared helper in `story.ts`, and no site formats the clause text itself.
- [ ] The clause text is `N of them tested`, where N is `numberWord(aggregates.testedSource)` of the node the sentence is about, and it is preceded by a comma rather than wrapped in parentheses.
- [ ] Each of the three sites omits the clause entirely when `testedSource` is zero, leaving the rest of the sentence and its punctuation intact.
- [ ] In the made-of paragraph the clause text is the label of a link whose route is the area's route with `?lens=tests`, unchanged from today.
- [ ] Rendered against the repo at the landing commit, the area subtitle for `packages/reggie/src` names the same tested count as the first number after `cover` in that area's Tests section paragraph.
- [ ] Rendered against the repo at the landing commit, no clause prints a tested count greater than the source count printed beside it in the same sentence, at any of the three sites, for every Level-1 area and for the repo.
- [ ] Rendered against the repo at the landing commit, the area subtitle for `packages/reggie/test` is `TypeScript area, no source files.` with no tests clause.
- [ ] `story.test.ts` gains a test that renders all three sites against a purpose-built repo holding three areas: one with test files importing its source, one whose only non-source file is a config file with a code extension such as `vitest.config.ts`, and one holding source files only.
- [ ] That test asserts the clause appears with the tested count for the first area and is absent for the other two, and it fails when the guard is restored to `files > source`.
- [ ] `packages/reggie/ui/dev/sample-story.json` and `packages/reggie/ui/dev/sample-explain.json` carry the new clause, with tested counts equal to the `testedSource` values the matching areas hold in `packages/reggie/ui/dev/sample-container.json`.
- [ ] The made-of row of `packages/reggie/docs/ui-spec.md` quotes the new sentence, maps `N of them tested` to `?lens=tests`, and states that the clause is omitted when no source file is tested.
- [ ] The about-this-repo bullet in `docs/ui-plan.md` no longer lists this defect under "Still to fix" and instead records that `false-tests-sentence` fixed it, naming the clause that replaced it.
- [ ] `grep -rn "with tests" packages/reggie/src packages/reggie/ui packages/reggie/docs docs` returns exactly one line, the lens comment in `packages/reggie/src/views.ts` about test files being hidden.
- [ ] Run from `packages/reggie`, `npm test`, `npm run typecheck` and `npm run build` each exit 0 at the landing commit.

## Verification strategy
- Criterion 1: `grep -n "files > source" packages/reggie/src/story.ts; grep -n "with tests" packages/reggie/src/story.ts`, both empty, output saved to `evidence/guard-gone.txt`.
- Criterion 2: the diff of `story.ts`, saved to `evidence/story-diff.txt`, read for one helper definition and three call sites that pass through it.
- Criterion 3: the same diff, read for the clause template and the comma, plus the rendered sentences in `evidence/rendered-before-after.txt`.
- Criterion 4: the new test's assertions for the config-only and source-only areas, named in `evidence/tests.txt` by test name, plus the `packages/reggie/test` subtitle line in `evidence/rendered-before-after.txt`.
- Criterion 5: `evidence/rendered-before-after.txt` holds the made-of paragraph with its raw `[[route|label]]` markup, showing `?lens=tests` on the clause label.
- Criterion 6: a probe script run with `tsx` that builds the real context for this repo and prints, per area, the subtitle and the Tests section's first paragraph side by side; saved to `evidence/subtitle-vs-tests.txt`.
- Criterion 7: the same probe prints, per area and for the repo, the source count and tested count it used for each of the three sites, with a line asserting `tested <= source`; saved to `evidence/counts-bounded.txt`.
- Criterion 8: the `packages/reggie/test` row of `evidence/subtitle-vs-tests.txt`.
- Criterion 9: `npx vitest run src/story.test.ts` output naming the new test, saved to `evidence/tests.txt`, and the test body in `evidence/story-test-diff.txt`.
- Criterion 10: a mutation probe — restore `files > source` at the three sites, re-run `npx vitest run src/story.test.ts`, record the failure, revert, re-run green; both runs appended to `evidence/mutation-probe.txt`.
- Criterion 11: the two sample files' changed lines beside the matching `aggregates` blocks of `sample-container.json`, saved to `evidence/samples-consistent.txt`.
- Criterion 12: the diff of `packages/reggie/docs/ui-spec.md`, saved to `evidence/docs-diff.txt`.
- Criterion 13: the diff of `docs/ui-plan.md`, in the same `evidence/docs-diff.txt`.
- Criterion 14: `grep -rn "with tests" packages/reggie/src packages/reggie/ui packages/reggie/docs docs`, output saved to `evidence/phrase-sweep.txt`.
- Criterion 15: `npm test`, `npm run typecheck` and `npm run build` run from `packages/reggie`, each command's output and exit code appended to `evidence/build.txt`.

## Assumptions
The owner is asleep and the brief carries no `Answered by jacobpress` lines, so every open question is answered here, unattended, on 2026-09-15. Each answer names the evidence it rests on.

- The clause prints the tested-source count, not the test-file count. Four reasons, in order of weight. First, `testedSource` only ever increments for a node whose `role === "source"` (`graph.ts:1053`), so it is bounded by the source count printed beside it and the impossible sentence this task exists to kill becomes structurally unreachable rather than merely corrected; `tests` carries no such bound. Second, the clause sits in a list whose other member, `${numberWord(documented)} with a note`, is a property of the same source files, so a coverage-shaped number is what the grammar of the sentence already promises. Third, the link goes to the tests lens, which `docs/ui-spec.md:89` defines as colouring "containers by tested share" and marking source files with and without a test importer — the tested-source count is literally what that lens draws. Fourth, `tests` counts `isTestLike`, which folds `fixture` in with `test` (`roles.ts:86`), so a clause saying "11 test files" would be counting mocks, fixtures and `test/helpers.*` as tests and would spread that mislabel to three new places.
- The case for the test-file count, and why it loses. A role count needs no import graph, so it survives in the Swift, Kotlin, Go and Python repos that `docs/ui-plan.md:140` puts on the near-term roadmap, where the graph draws no edges at all and `testedSource` is therefore zero everywhere; with this choice the clause simply vanishes in those repos. That is the real cost and it is accepted, because silence about a derived fact is already how Reggie behaves in those repos for every other derived surface, and because a bald "11 test files" in a coverage-shaped slot invites the reader to compute a coverage ratio that the number does not support — which is the exact misreading this item was opened to stop. A number that understates is recoverable; a number a reader over-reads is what broke trust here.
- When `testedSource` is zero the clause vanishes at all three sites, silently. The brief's Problem asks for exactly this, and its open question asks whether "the area says so" instead — it already does: `EMPTY_TEXT.areaTests` renders "No test file imports anything in this folder." in the Tests section of every area page with no tested source. On the repo page there is no such statement, and it stays that way here on purpose: asserting "none of them tested" for an area whose imports the graph failed to resolve would be a fresh false claim of the same family being fixed. The queued `graph-coverage-published` is the item that will say what the map could not read, in this same paragraph; stating the zero belongs with it, not before it.
- All three sites print the same wording, produced by one helper. The brief asks whether the one-line subtitle earns a shorter form; it does not. The clause is five words, the subtitle already carries a longer source-file phrase, and three separately worded copies of one fact is precisely the condition that let these three drift from the graph in the first place.
- The exact wording is `N of them tested`. It names what it counts, its subject is the source-file count it follows, and it agrees with `areaTests`'s "cover ... of ... source files" without repeating the source count twice in one sentence. "N of them under test" and "N of them covered by a test" were rejected as longer without being more precise; "covered" in particular would lean toward implying measured coverage, which this number is not.
- The link stays on `?lens=tests`. `docs/ui-spec.md:89` defines that lens as tested share for containers plus tested and untested source files, so it shows what the clause claims. No new lens, no route change.
- `testedSource` does not count a source file tested only by a fixture, and that is the honest reading. `graph.ts:894` types an edge as `tests` for any `isTestLike` source, but `graph.ts:921` fills `testedBy` only when `source.role === "test"`, so a file imported only by `test/helpers.ts` is not counted as tested. A helper importing a module is not a test of it, and the asymmetry makes the number understate rather than overstate, which is the safe direction for a sentence whose whole problem was overstating. Nothing in `graph.ts` or `roles.ts` changes here.
- The two `ui/dev` samples are hand-edited, not regenerated. `ui/dev/gen-samples.mjs` writes only `sample-container.json`, `sample-dir.json`, `sample-dir-tests.json`, `sample-impact.json`, `sample-blast.json` and `sample-workspace.json`; `sample-story.json` and `sample-explain.json` are hand-written payloads with no generator and no test reading them, and writing one for two files is more machinery than the drift is worth. The drift guard is instead the phrase sweep in the acceptance criteria, which is cheap and catches any copy of the old wording anywhere in the repo. The hand edit takes its numbers from `sample-container.json`, where those same areas already carry aggregates: `packages/reggie` 21 source, 12 tested; `src/components` 29 source, 20 tested; `src/types` 7 source, 1 tested.
- The `none with a note` clause in the same paragraph is left alone. It is built by `ownNotedByArea` (`story.ts:874`), which counts only files with `role === "source"` and `knowledge.own > 0`, keyed by Level-1 area, so it is bounded by the source count and says what it names. It was checked in this pass and needs no change.
- The brief's `tsconfig.json` example does not reproduce, and the test must not use it. `CODE_EXT` in `graph.ts:200` admits only `ts, tsx, mts, cts, js, jsx, mjs, cjs, rs`, so a `.json` file is never scanned and never enters `files`. The config-only case was reproduced instead with `vitest.config.ts`, and the generated case with `routes.gen.ts`; both render "three source files (four with tests)" today against three source files and no test. A test built on `tsconfig.json` would pass without the fix and prove nothing.
- In `madeOfSection` the tested count comes from `agg?.testedSource ?? 0` with no `AreaRef` fallback, unlike `source` and `files`, which fall back to `ref.source` and `ref.files`. `AreaRef` carries no tested count, and a missing-aggregates node therefore omits the clause rather than printing a wrong number — the fail-safe direction. Widening the contract type is rejected above.
- An area that is all test files, like `packages/reggie/test`, says nothing about tests under this choice, because it has no source files to be tested. Its subtitle becomes "TypeScript area, no source files." That is honest for a clause whose subject is the area's source files, and the sentence a reader wants there belongs to the Tests section, whose behaviour on a zero-source area is broken today and is captured separately rather than fixed here.
- The context pack's "tests: 33 files" line is `facts.ts` counting `TEST_HINTS` matches over the whole repo, not a graph aggregate, and no site in this task reads it. It is named here only so a reviewer does not read it as the number the story should print.
- The evidence is produced by a throwaway probe script run with `tsx` from the scratchpad, not by a file added to the repo, and the graph history is built with `diskCache: false`, so verification writes nothing into the working tree.

## Out of scope
- Changing how the graph decides what a test is or what counts as tested: `roles.ts`, `isTestLike`, the `tests` edge kind and the `testedBy` rule are read here and left exactly as they are.
- Reworking the `areaTests` section. It is the fixed point the three sites are being made to agree with, and editing both ends of the agreement at once loses the reference.
- The two defects found in that section while reading it, both captured tonight rather than fixed: it renders "five test files cover no of no source files" for an area with tests and no source, and it calls `agg.tests` "test files" although that count folds fixtures and helpers in.
- Real coverage in any sense — parsing a coverage report, counting assertions or lines. The tested-source count is a structural proxy taken from imports and the wording must not imply more.
- `graph-coverage-published`, which adds what the map skipped to the same paragraph. It lands after this one.
- Adding `tests` or `testedSource` to `AreaRef`, or any other change to `docs/ui-api-contract.md`.
- The tests lens itself, the map node labels, and anything the client renders beyond the story payload's text.
- `note-form-on-repo-and-area` and the other small story-surface items captured the same day.

## Bail conditions
- `testedSource` turns out to be zero for every Level-1 area of this repo at the landing commit, which would mean the clause never prints here, the choice cannot be judged against real sentences, and the task goes back to its brief with the test-file count reopened.
- The tested count and the number in the `areaTests` sentence disagree for any area, which would mean the two sites do not read the same aggregate and the real defect is in the aggregation rather than in the printing.
- A tested count greater than its source count appears anywhere after the change, which would mean `testedSource` is not bounded by `source` as `graph.ts:1053` implies and this task is a graph fix, not a wording fix.
- Removing the parentheses turns out to break a client that parses the story text rather than rendering it, which would make the payload a contract and move this task behind a contract change.
- `graph-coverage-published` lands first and rewrites the made-of paragraph, in which case this plan's three sites may no longer be three and the approach is re-planned against the new paragraph.
