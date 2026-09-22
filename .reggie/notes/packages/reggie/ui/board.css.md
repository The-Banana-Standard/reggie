---
entity: packages/reggie/ui/board.css
kind: file
---

## gotcha · 2026-09-13 · Claude via jacobpress · medium
The phone block at the end must match the specificity of the .board-wrap rules above it (210px columns, absolute board-wrap) or it loses; it makes the board static, one 84vw column per swipe, with columns as tall as their cards.
sources: packages/reggie/ui/board.css:336

## how · 2026-09-18 · Claude via jacobpress · medium
The policy report block wraps long paths and sentences with overflow-wrap anywhere and gives every flex child a zero minimum width, which is what keeps the task page from scrolling sideways at 390 pixels; measured at 390 by 844 on 2026-09-18 for a would-pass and a refused page, zero overflow on both.
sources: low-risk-auto-approval

