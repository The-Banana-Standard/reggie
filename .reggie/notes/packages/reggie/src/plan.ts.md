---
entity: packages/reggie/src/plan.ts
kind: file
---

## how · 2026-09-18 · Claude via jacobpress · high
planCriteria walks the Acceptance criteria section once and gives each criterion its number, its first-line text and its key: c: and twelve hex characters of the SHA-256 of the whole bullet, first line and indented continuation lines, whitespace collapsed, with #2 and #3 for identical bullets in the order they appear. Reordering, renumbering, a ticked box and changed indentation leave a key alone; one changed word on any line of the bullet makes a new one, so a pass recorded against old words cannot count for new ones. A blank line inside a bullet does not end it. parsePlan uses the same walk and returns exactly the criteria it returned before: checked on 2026-09-18 against a build of the base commit over every plan under .reggie/tasks/, sixteen plans, identical.
sources: low-risk-auto-approval
