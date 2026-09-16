---
entity: packages/reggie/src/views.ts
kind: file
---

## how · 2026-09-07 · Claude via jacobpress · high
Projects the full graph into per-level payloads. chooseAreas picks the level-one areas, promoting directories that hold a manifest, splitting anything oversized and folding anything tiny; dirView adds ghost nodes so an edge leaving the current scope is redrawn against the nearest visible container instead of being dropped. Its file-to-area lookup is more accurate than the cheap one on graph nodes once an area has been split.
sources: packages/reggie/src/views.ts

## gotcha · 2026-09-15 · Claude via jacobpress · high
Two numbers on the counts block describe the repo, not the view: the code files the graph never read, by language, and the import lines that pointed at no file. They are lifted from the graph unchanged at all three build sites, so no level can disagree with another, and nothing that reads them may present them as being about the scope on screen. That is why the repo map's footer carries the second one and the folder and impact footers do not. The skipped figure is kept as the per-language array and never as a total: the footer sums it and the repo story names the languages from it, and a total field beside a names field is exactly how two numbers about one fact drift apart.
sources: packages/reggie/src/views.ts, graph-coverage-published

