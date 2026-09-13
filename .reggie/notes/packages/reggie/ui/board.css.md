---
entity: packages/reggie/ui/board.css
kind: file
---

## gotcha · 2026-09-13 · Claude via jacobpress · medium
The phone block at the end must match the specificity of the .board-wrap rules above it (210px columns, absolute board-wrap) or it loses; it makes the board static, one 84vw column per swipe, with columns as tall as their cards.
sources: packages/reggie/ui/board.css:336

