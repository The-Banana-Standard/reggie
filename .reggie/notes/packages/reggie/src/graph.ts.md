---
entity: packages/reggie/src/graph.ts
kind: file
---

## how · 2026-09-07 · Claude via jacobpress · high
Import graph for TypeScript, JavaScript, and Rust only. Relative and @/ imports resolve against the repo file set with the usual extension and index fallbacks; Rust follows mod declarations and use crate:: paths from the nearest src beside a Cargo.toml. Everything else shows as a node with no edges. Notes and task plans are overlaid as counts and touches edges; the graph is rebuilt on request with a ten-second cache in the server.
sources: packages/reggie/src/graph.ts, packages/reggie/src/serve.ts

## how · 2026-09-15 · Claude via jacobpress · high
The graph now says what it did not read. Beside the filter that keeps only the extensions it can parse, it walks the same file list again and counts, per language, the code files it is about to drop, and publishes that as a per-language breakdown sorted largest first with ties by language name. Because both walks are over the same list, the files it read plus the files it skipped are the repo's code files with no third number to keep in step. The count of imports that led nowhere changed unit at the same time: it is now the number of distinct importing-file-and-specifier pairs rather than the number of scanner matches, because the scanner returns a bound require twice and this repo therefore published three where two was the truth. Nothing about resolution changed; no import that failed before succeeds now.
sources: packages/reggie/src/graph.ts, graph-coverage-published

## gotcha · 2026-09-15 · Claude via jacobpress · high
The count of code files is what was opened and read, not what passed the extension filter, and that distinction is load-bearing now that a page states it. The repo file list comes from git and includes a file that is in the index but missing from the worktree; the scan loop skips whatever it cannot open. Counting those as read let the page say it had read every code file when one of them was never seen. A file the graph could not open is now in neither the read count nor the skipped list, so the repo's code-file total can be understated by that many — understating what is there is survivable, claiming to have read it is not.
sources: packages/reggie/src/graph.ts, graph-coverage-published

