---
entity: packages/reggie/ui/styles.css
kind: file
---

## gotcha · 2026-09-13 · Claude via jacobpress · medium
The phone block at the end (max-width 760px) turns the shell into one column and hides .map-col unless .app.is-map-open, when it becomes a fixed overlay under the header. The tasks level is the exception: its .map-col holds the board and stays in flow. Anything added to the header must fit 390px; the lens and Dense are hidden there.
sources: packages/reggie/ui/styles.css:1

