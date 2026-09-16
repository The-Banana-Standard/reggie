---
entity: packages/reggie/ui/board.js
kind: file
---

## how · 2026-09-09 · Claude via jacobpress · high
Parked tasks are hidden behind a Show parked toggle in the board head, and the state strip counts what the columns draw rather than the unfiltered total. On personal_website all 44 groomed tasks are parked, so without the filter the Groomed column reads as a queue of ready work when nobody intends to start any of it.

## gotcha · 2026-09-15 · Claude via jacobpress · medium
The optimistic update after a triage POST leaves the card in Ungroomed and only clears its intake line. Triage writes a scaffold nobody has filled in, which is what the server reports on the next reconcile, so moving the card to Groomed here would flicker and snap back. FALLBACK_STATES, FALLBACK_TRANSITIONS and COLUMN_RULE are the client's hand-written copy of the server's state machine and have to be edited in the same commit as tasks.ts; each COLUMN_RULE string has to fit one rendered line at the narrowest column width.

