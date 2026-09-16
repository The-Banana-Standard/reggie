---
entity: packages/reggie/src/story.ts
kind: file
---

## how · 2026-09-07 · Claude via jacobpress · high
Generates the plain-English column for every level and the four-sentence Spotlight, with no DOM and no file reads of its own; serve.ts assembles the context and passes it in. Numbers under ten are words, dates are day and month, and every entity in a sentence is [[route|label]] markup that the client turns into a link. It is meant to double as the narration source for the podcast explainers in the vision doc, so keep it pure.
sources: packages/reggie/src/story.ts

## how · 2026-09-13 · Claude via jacobpress · medium
A task without a plan no longer renders ten empty plan sections. With only an intake line it tells the intake story (what was written, where it probably lives by matching the line's words to file and folder names, what notes are known there, what it resembles, what is unclear, what happens next); with a brief it tells the brief as a story (ask, why now, area, open questions, not this, next). The task page renders this story from /api/story when there is no plan.
sources: packages/reggie/src/story.ts:1598

## how · 2026-09-15 · Claude via jacobpress · high
How well something is tested is said in exactly one place: testedClause, which takes the count of source files with a test importing them and returns 'N of them tested' or null. The made-of paragraph, the area subtitle and the container spotlight all append its result after the source-file count they have just printed, with a comma, and the made-of paragraph additionally wraps the words in the link to the tests lens. Do not inline the wording at a call site; three hand-built copies of this clause are what let it drift from the graph and print an area's total file count under a label that said tests. The count is bounded by the source count printed beside it because only source files can be tested, and a zero prints nothing rather than 'none of them tested', because a repo whose imports the graph cannot follow would otherwise be told its code is untested.
sources: packages/reggie/src/story.ts, false-tests-sentence

