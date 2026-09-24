---
entity: packages/reggie/ui/map.js
kind: file
---

## gotcha · 2026-09-07 · Claude via jacobpress · high
Every layout is dagre and no canvas draws more than about forty nodes; force layouts are banned because they made the old page a hairball. Fitting is the subtle part: candidate viewport rectangles reserve the floating toolbar and legend, a frame is rejected when it would leave the graph degenerate, and a sparse view is spread along its short axis rather than left as a thin band. Changing fit or the reserved rectangles means re-measuring coverage at 1600, 1280 and 1000 pixel widths.
sources: packages/reggie/ui/map.js

## how · 2026-09-15 · Claude via jacobpress · high
The repo map's footer ends with one more segment when imports in the repo point at no file, and nothing at all when none do, like every other segment on that line. It appears on the repo map only, because the number is about the whole repo and a folder footer reporting it would invite the reader to attach it to the folder. It goes last because that line wraps inside a floating card rather than clipping, so the newest and least structural fact is the one that costs least when it wraps. The empty repo map is the case the whole feature exists for: a repo written in a language the graph cannot read draws nothing, and the footer is guaranteed to be absent there, so the empty card says how many code files are in the repo and which languages they are instead of claiming there are none. The folder card keeps its own text, because a repo-wide list does not explain why one folder is empty.
sources: packages/reggie/ui/map.js, graph-coverage-published

## gotcha · 2026-09-15 · Claude via jacobpress · high
The empty repo map only blames the language when the language is actually the reason. A container canvas comes back empty for reasons that have nothing to do with what the graph can read: every area candidate folding below the minimum size does it, and two source files beside one stylesheet is enough. So the card asserts that nothing here is in a language the map reads only when the count of files it read is zero as well; otherwise the old text stands. Without that second half the card would tell a repo whose code the map reads perfectly well the opposite, and would print a file count that omitted the files it did read.
sources: packages/reggie/ui/map.js, graph-coverage-published

## how · 2026-09-17 · Claude via jacobpress · medium
The empty state card prefers a sentence the view brings with it, as an empty field holding text and a hint, over the one it would derive from the level. The file page uses it in diff mode for a path the graph never read, where saying that nothing imports the file would be a claim about imports nobody measured.
sources: packages/reggie/ui/map.js, branch-diff-in-reader

## gotcha · 2026-09-22 · Codex via jacobpress · medium
Flow map labels and file extraction parse stable double-colon symbol IDs.

## how · 2026-09-23 · Codex via jacobpress · high
Call graphs use a left-to-right symbol layout with full symbol and file labels; unrelated test controls stay hidden on that graph.
sources: code-entity-pages

## how · 2026-09-23 · Codex via jacobpress · medium
Flow maps consume typed nodes and semantic values; labels show uppercase kind, entity name, and path while edges stay compact.

## how · 2026-09-24 · Codex via jacobpress · medium
Compact request-path graphs use a top-to-bottom dagre chain so browser-to-handler labels remain readable in the narrow map pane. Full server flows retain their left-to-right layout.

## how · 2026-09-24 · Codex via jacobpress · medium
All-flows maps retain every entry between known clients and reached services. Only a single directed acyclic chain uses responsive alternating rows; branches, joins and disconnected graphs retain hierarchy. Cache roots distinguish the new full and focus layouts.
sources: complete-data-flow-view

