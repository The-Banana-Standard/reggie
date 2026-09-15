---
slug: false-tests-sentence
title: The landing paragraph prints a total file count as a tests claim
area: packages/reggie/src
size: small
risk: low
priority: P2
author: jacobpress
created: 2026-09-15
---
# The landing paragraph prints a total file count as a tests claim

## Problem
The first thing a reader sees about an area is a sentence that tells them how well it is tested, and the number in that sentence is not a test count. It is the area's total file count, printed under a label that says tests. An area of 21 source files with 11 test files reads as "21 source files (32 with tests)", a number larger than the source count it is compared against, so the claim is not merely wrong, it is impossible: it says more files are tested than exist to be tested. A reader who trusts it walks away believing the area is thoroughly covered, which is exactly the judgement the web view exists to inform, and exactly the judgement a person is least able to check for themselves in a codebase written faster than they can read it.

The clause appears at three places in `story.ts`, all built the same way from the same two aggregates. The repo's made-of paragraph builds it with a link to the tests lens; the area page subtitle builds it as plain text; the container explain builds it as plain text inside the what-it-is sentence. All three read `agg.files` and `agg.source` and print `(N with tests)` when `files > source`.

The guard is wrong for a second, independent reason. `files` counts every role the graph knows — source, test, fixture, config and generated — so `files > source` is true whenever an area holds anything that is not source. An area with a `tsconfig.json` and no test at all trips the guard and announces that it has tests. The same is true of an area whose only non-source file is generated. So the sentence can appear where the honest answer is that nothing tests this folder.

None of this is for want of the right numbers. The graph already aggregates `tests` (files whose role is test or fixture) and `testedSource` (source files with at least one inbound test edge) for every directory, folds them up the tree, and the area page's own Tests section already narrates both in a sentence that is true: "30 test files cover 24 of 73 source files." So one page can carry both the false headline and the true detail, a few hundred pixels apart, and a reader has no way to tell which one to believe.

What is unsettled is which of the two true numbers the clause should carry, and that choice decides the wording. The test-file count answers "how much test code is here"; the tested-source count answers "how much of this is covered". Whichever is chosen, the clause has to name what it counts rather than leaving `with tests` to be read as either, it has to agree with the Tests section rather than restate it in a second vocabulary, and it has to disappear entirely when the count is zero instead of leaning on a guard about file roles.

The two sample payloads under `ui/dev` carry the old phrase with the old numbers, and the spec table that documents the made-of paragraph quotes it as the example sentence, so the wrong wording is also the written record of what the wording should be.

## Why now
It is a sentence that says the opposite of the truth in the place a reader looks first, and the cost of leaving it is not that the page looks untidy but that the page misleads. Reggie's whole claim is that an owner can trust what it says about a repo they have not read. One number that is provably impossible — more tested files than files — is enough to make a careful reader stop trusting the rest, and a careless one is worse off still, because they believe it.

It is also the cheapest possible repair. The numbers exist, they are already folded per directory, and the honest sentence already exists a section below; nothing has to be computed, only chosen and worded. That makes it a natural fit for the small-items stretch the 2026-09-15 order puts after the loop plumbing, and a good early exercise of the loop on work where the change is small and the decision is the whole of it.

Waiting makes it worse in one specific way: `graph-coverage-published` is queued to add what the map skipped to the same made-of section, so the paragraph that states this false claim is about to gain a neighbouring sentence about the graph's honesty. Landing the two in the wrong order publishes a coverage disclaimer directly beside a coverage lie.

## Suspected area
- `packages/reggie/src/story.ts` — the three sites: the made-of paragraph in the repo story, the area page subtitle, and `explainContainer`'s what-it-is sentence. `areaTests` is the fourth place, read rather than changed, because it is the wording the other three have to agree with.
- `packages/reggie/src/graph.ts` — read only, to confirm what `tests` and `testedSource` mean before the clause commits to one of them: `tests` counts test and fixture roles, `testedSource` counts source files with an inbound test edge, and both fold up the directory tree.
- `packages/reggie/src/roles.ts` — read only; it is why `files > source` is a bad guard, since config, fixture and generated files all sit in `files` and none of them is a test.
- `packages/reggie/ui/dev/sample-story.json` and `packages/reggie/ui/dev/sample-explain.json` — both carry the old phrase, so whatever the sentence becomes has to reach the fixtures the dev view renders from, or the dev view keeps showing the bug.
- `packages/reggie/docs/ui-spec.md` — the made-of row quotes the sentence as the specification of the paragraph, so the spec says the wrong thing until it is edited with the code.
- `packages/reggie/src/story.test.ts` — nothing currently asserts the clause at all, which is why three copies of it drifted from the graph unnoticed; a test that pins the sentence against an area with tests, an area with only a config file and an area with neither belongs with the change.

## Open questions
- Does the clause print the test-file count or the tested-source count? The test-file count is the cheaper claim and matches the tests lens; the tested-source count is what a reader actually wants to know and is the number the Tests section compares against the source count. The 2026-09-15 decisions do not settle it, and it decides the wording of all three sites.
- What is the exact wording? "21 source files, 11 of them tested" and "21 source files and 11 test files" are different sentences with different subjects, and the choice has to sit beside "30 test files cover 24 of 73 source files" without reading as a contradiction or as the same fact twice.
- Should all three sites say the same thing, or does the one-line subtitle earn a shorter form than the made-of paragraph? They are three different amounts of room, and forcing one sentence into all three may make the longest one terse or the shortest one crowded.
- When the count is zero, does the clause vanish silently or does the area say so? An area with no tests at all is a fact worth stating, and saying nothing is indistinguishable from the graph not having looked.
- Does the linked lens change with the number? The made-of clause links to `?lens=tests` today; if the clause becomes a tested-source claim, whether that lens shows what the sentence just claimed is worth checking before the link is kept.
- How do the two `ui/dev` samples get the new wording — regenerated from a real graph, or hand-edited? Nothing in the repo says where they came from, and a hand-edit leaves them free to drift again.
- Does `testedSource` count a source file tested only by a fixture, and is that the honest reading? The test edge and the role are two different classifications, and the number the sentence publishes should not depend on an accident of which one was used.
- Should the same reckoning be applied to the other counts in the same paragraph while it is open — `none with a note` is built from a separate map and has not been checked against the graph in this pass.

## Not this
- `graph-coverage-published`. It also edits the made-of section, to say how many files the graph skipped and how many imports it could not resolve. That is about what the map did not read; this is about a number the map read correctly and then printed under the wrong name. They touch the same paragraph and should be sequenced, not merged.
- Changing how the graph decides what a test is, or what counts as tested. `roles.ts` and the test-edge logic are read here to know what the numbers mean; if they are wrong that is a separate item, and this one is only about printing the numbers that exist truthfully.
- Adding coverage in any real sense — parsing a coverage report, or counting assertions or lines. The tested-source count is a structural proxy taken from imports, and nothing in this work should imply it is more than that.
- Reworking the Tests section itself. It is already true and it is the reference the other three sites are being made to agree with; editing both ends of the agreement at once loses the fixed point.
- The area page's tests lens and its rendering. This is prose in the story payload; what the lens colours is a separate surface.
- `note-form-on-repo-and-area` and the other small story-surface items captured on the same day. They share a file and nothing else.
