---
entity: packages/reggie/ui/board.js
kind: file
---

## how · 2026-09-09 · Claude via jacobpress · high
Parked tasks are hidden behind a Show parked toggle in the board head, and the state strip counts what the columns draw rather than the unfiltered total. On personal_website all 44 groomed tasks are parked, so without the filter the Groomed column reads as a queue of ready work when nobody intends to start any of it.

## gotcha · 2026-09-15 · Claude via jacobpress · medium
The optimistic update after a triage POST leaves the card in Ungroomed and only clears its intake line. Triage writes a scaffold nobody has filled in, which is what the server reports on the next reconcile, so moving the card to Groomed here would flicker and snap back. FALLBACK_STATES, FALLBACK_TRANSITIONS and COLUMN_RULE are the client's hand-written copy of the server's state machine and have to be edited in the same commit as tasks.ts; each COLUMN_RULE string has to fit one rendered line at the narrowest column width.

## how · 2026-09-17 · Claude via jacobpress · high
The task page has a What changed section for in process, awaiting decision and done tasks. It mounts as a skeleton and fills itself from the changes route: a summary of which two points the change is read between, a row per file with a status badge and counts, then Reggie's own records under their own heading with the same doors. That list is the one source of doors on the page. File links that may become doors are marked with a change path data attribute when they are drawn, and once the list arrives the marked links whose path is in it are pointed at the diff route; the rest keep the plain file link. That is how a done task, whose branch comparison is empty, gets doors too. In the Completed view a changed file is a door only when the completion carries a landing merge, because without one there is no range to read.
sources: packages/reggie/ui/board.js, branch-diff-in-reader

## gotcha · 2026-09-17 · Claude via jacobpress · high
The What changed section drops an answer that arrives after it has left the document. The story container is shared by every task page and the door rewriting reaches into all of it, so a late answer for one task used to rewrite the file links of whichever task was on screen by then, a planned task with no branch included. The check is safe because mounting is synchronous: by the time any answer can arrive, a section that is still wanted is attached.
sources: packages/reggie/ui/board.js, branch-diff-in-reader

## how · 2026-09-18 · Claude via jacobpress · medium
makeLauncher, commandField, friendlyError, TOOL_LABEL and rememberTool are exported for the idea action, which composes them rather than copying them; no behaviour moved. describe takes paths and run takes opts.paths, the repo paths the pack is built around, which the launch URL and body carry as path parameters; run's warning toast takes opts.where so the popover can say the command is below rather than on the card.
sources: idea-from-every-page

## how · 2026-09-18 · Claude via jacobpress · high
The task page draws the policy report inside the packet section, above the decide form, from policy on the task route: the verdict chip and the server's sentence, the two commits read, the completions class and where it came from, the effective risk, one row per criterion and review with who recorded it, with what and when, and one row per gate with its reasons. It says it is a report and that a person decides below; the decide form is unchanged. Every string that came out of a check record is set as a text node and never through the inline renderer, because a record is a file anyone on the branch can write. decideError shows the server's own sentence for a 409 from the decide route, in the form and in the toast, because that route now refuses for several different reasons and each sentence says what to do; friendlyError still maps 409 to the missing-packet sentence for its other callers, which is captured and not fixed here.
sources: low-risk-auto-approval

