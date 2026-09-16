---
entity: packages/reggie/ui/DOM-CONTRACT.md
kind: file
---

## gotcha · 2026-09-15 · Claude via jacobpress · high
The footer row quotes the real string, so it is wrong the moment the footer's wording changes and nothing checks it. Two clauses in it are easy to get subtly wrong: the segment about imports appears on the repo map only and vanishes at zero, and the footer is empty only when the model holds no non-compound node at all, which is not the same as nothing being drawable — a view whose every child is folded still renders a line.
sources: packages/reggie/ui/DOM-CONTRACT.md, graph-coverage-published

