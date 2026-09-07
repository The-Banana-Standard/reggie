---
entity: packages/reggie/ui/map.js
kind: file
---

## gotcha · 2026-09-07 · Claude via jacobpress · high
Every layout is dagre and no canvas draws more than about forty nodes; force layouts are banned because they made the old page a hairball. Fitting is the subtle part: candidate viewport rectangles reserve the floating toolbar and legend, a frame is rejected when it would leave the graph degenerate, and a sparse view is spread along its short axis rather than left as a thin band. Changing fit or the reserved rectangles means re-measuring coverage at 1600, 1280 and 1000 pixel widths.
sources: packages/reggie/ui/map.js

