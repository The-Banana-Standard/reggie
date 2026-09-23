---
entity: packages/reggie/docs/ui-spec.md
kind: file
---

## gotcha · 2026-09-15 · Claude via jacobpress · high
The Content/template column quotes real sentences as the specification, so it is wrong the moment the code's wording changes and nothing checks it. The made-of row carried a false tests clause for as long as the code did, and was cited as proof the code was right. Change the row in the same commit as the sentence.
sources: packages/reggie/docs/ui-spec.md, false-tests-sentence

## gotcha · 2026-09-15 · Claude via jacobpress · high
The §4 table now distinguishes two things that look alike and behave differently. Notes (any chain) is the empty state on a section that carries content the rest of the time, so its form goes as soon as the chain has anything in it, including an entry inherited from the repo note. Add a note is a section that never has paragraphs at any scope, so its form is always there. Keep them as separate rows: collapsing them is what let the repo and area pages be described as always offering a note form when neither did. A page whose chain is still empty shows both forms, and the spec says so.
sources: packages/reggie/docs/ui-spec.md, note-form-on-repo-and-area

## how · 2026-09-18 · Claude via jacobpress · medium
Section 3.9 is the idea action: where the trigger sits, what each level posts, the sequence, and the three outcomes inside the popover. The header sentence in 3.1 and the tile sentence in Level 0 name the trigger and the tile button; keep the three agreeing with idea.js.
sources: idea-from-every-page

## decision · 2026-09-23 · Codex via jacobpress · high
The UI specification promotes symbol, route, and concept pages from stretch aliases to first-class code-intelligence levels.
sources: code-entity-pages

