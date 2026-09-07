---
entity: packages/reggie/src/views.ts
kind: file
---

## how · 2026-09-07 · Claude via jacobpress · high
Projects the full graph into per-level payloads. chooseAreas picks the level-one areas, promoting directories that hold a manifest, splitting anything oversized and folding anything tiny; dirView adds ghost nodes so an edge leaving the current scope is redrawn against the nearest visible container instead of being dropped. Its file-to-area lookup is more accurate than the cheap one on graph nodes once an area has been split.
sources: packages/reggie/src/views.ts

