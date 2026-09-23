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

## how · 2026-09-15 · Claude via jacobpress · high
The made-of section opens with one sentence saying how much of the repo the page is a picture of, built by a single helper that returns the whole sentence so no call site formats any part of it. It has a stable id of its own rather than a number, so the area paragraphs keep their existing numbering and nothing that reads a paragraph id shifts under it. The sentence names at most three skipped languages and folds any remainder into one clause, because naming is what makes it useful and a long tail of one-file languages is what would make it unreadable. When nothing was skipped it makes the positive claim instead of going silent, so a reader can always tell a full read from a page that was never given the number. The word unresolved is kept out of it deliberately: it is precise and it is jargon, and the reader being addressed has not read the code.
sources: packages/reggie/src/story.ts, graph-coverage-published

## gotcha · 2026-09-15 · Claude via jacobpress · high
Three things about the coverage sentence are deliberate and each was a bug first. It says 'followed every import written as a path', not 'followed every import': the count behind it only sees specifiers written as a path, so an alias the resolver could not follow is dropped with no edge and no count, and an unqualified claim is false on a repo whose imports are all aliases — measured, over a map with no edges at all. A universal claim has to say what it ranges over; the existential branch beside it does not and is unqualified. It says 'none of' rather than the number word for zero, which would read as 'read no of'. And it returns nothing at all when the repo has no code files, because the section already has a paragraph saying there are none and two contradictory claims would open the section.
sources: packages/reggie/src/story.ts, graph-coverage-published

## how · 2026-09-15 · Claude via jacobpress · high
The add-note section is built by one scope-neutral function, addNoteSection(scope, entity), and the repo, area and file stories are its only callers; it goes last in all three base section lists. It has no paragraphs at any scope, which is the whole mechanism: section() attaches the empty block only to a section with no paragraphs, and the client renders an empty section carrying form: note as an inline form, so a permanently empty section is a permanently open door. The empty states above it, About this repo and Read these first, also offer the form, but they close as soon as someone writes the first note, which is why they are not a substitute. Its three sentences live in EMPTY_TEXT as addNoteRepo, addNoteArea and addNoteFile and are read through the one ADD_NOTE_TEXT record; do not inline the wording at a call site. The hint says --type why at all three scopes on purpose: noteForm defaults its select to why whatever the action carries, so any other type would print a command that disagrees with the button beside it. The folder's note entity is areaNoteEntity(dirPath), written once and read by both the add-note hint and the read-first empty state; its root branch is live because areaStory(ctx, '.') is a real page and must say _repo rather than ./.
sources: packages/reggie/src/story.ts, note-form-on-repo-and-area

## how · 2026-09-15 · Claude via jacobpress · medium
The brief story's What happens next paragraph asks the task's own state rather than re-deciding what counts as filled in: an ungroomed task with a brief is one triage scaffolded and nobody wrote into, so the next step it names is the shaping conversation, not a plan.

## gotcha · 2026-09-15 · Claude via jacobpress · medium
taskLine prints a capture date for an unclaimed ungroomed card, which is now often absent: triage takes the line. It falls back to the card's age, which the derivation fills from the brief's created. Any other place that reads t.intake for a date needs the same fallback.

## decision · 2026-09-22 · Codex via jacobpress · medium
Symbol links use only the stable double-colon identity and route directly to symbol pages.

