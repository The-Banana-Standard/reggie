---
entity: packages/reggie/ui/DOM-CONTRACT.md
kind: file
---

## gotcha · 2026-09-15 · Claude via jacobpress · high
The footer row quotes the real string, so it is wrong the moment the footer's wording changes and nothing checks it. Two clauses in it are easy to get subtly wrong: the segment about imports appears on the repo map only and vanishes at zero, and the footer is empty only when the model holds no non-compound node at all, which is not the same as nothing being drawable — a view whose every child is folded still renders a line.
sources: packages/reggie/ui/DOM-CONTRACT.md, graph-coverage-published

## how · 2026-09-17 · Claude via jacobpress · medium
Diff mode is written down in four places here: the reader's classes under the shell section, the What changed classes and the door rule under the board section, the diff query under link markup, and the reader's interface with its mode dep and exported address helper. The route to data table has a row for a file route with the diff query and the task row names the changes request.
sources: packages/reggie/ui/DOM-CONTRACT.md, branch-diff-in-reader

