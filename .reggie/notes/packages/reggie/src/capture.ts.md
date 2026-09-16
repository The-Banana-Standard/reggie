---
entity: packages/reggie/src/capture.ts
kind: file
---

## how · 2026-09-13 · Claude via jacobpress · medium
addIntakeDetail appends detail lines under an existing intake item, after the detail already there, stamping the last line with person, source and date. A slug with no intake line gets one so the detail has a home. POST /api/intake and the answer form on the board and the task page use it.
sources: packages/reggie/src/capture.ts:60

## gotcha · 2026-09-15 · Claude via jacobpress · medium
removeFromIntake matches every bullet shape parseIntake accepts — dash, star, plus, checkbox, up to three spaces of indent — and not just the dash form it started with. A shape the parser counts as an item but the remover does not would outlive its own brief and sit in the queue for work the board already reports as shaped. The slug is followed by a colon in the pattern, which is what keeps foo from taking foo-2.

