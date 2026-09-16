---
entity: packages/reggie/src/views.test.ts
kind: file
---

## verify · 2026-09-15 · Claude via jacobpress · high
The contract check every view goes through now requires the counts block to carry the repo's coverage as well, and a block of its own asserts that the container, folder and impact views all report the graph's figures unchanged, including a folder that holds none of the skipped files. That is the property worth defending: the numbers describe the repo, so a view that recomputed them per scope would be wrong even if it type-checked.
sources: packages/reggie/src/views.test.ts, graph-coverage-published

