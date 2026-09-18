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

## how · 2026-09-18 · Claude via jacobpress · medium
The idea action is written down in four places here: the trigger's row in the shell ids, the idea icon in the icon list, the tile's new shape and the popover's classes under the story classes, and the idea module plus the five board exports under the module interfaces. The tile row now says the tile is a div and why; a change to the tile's markup in app.js changes that row in the same commit.
sources: idea-from-every-page

## how · 2026-09-18 · Claude via jacobpress · medium
The board section gained one row for the policy report block on the task page: its classes, the data-verdict and data-gate attributes, the glyph for each status, that it sits above .packet__decide, and that record strings are text nodes. Change the markup in policyReport and change that row in the same commit.
sources: low-risk-auto-approval

