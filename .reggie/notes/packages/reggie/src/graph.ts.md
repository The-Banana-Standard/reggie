---
entity: packages/reggie/src/graph.ts
kind: file
---

## how · 2026-09-07 · Claude via jacobpress · high
Import graph for TypeScript, JavaScript, and Rust only. Relative and @/ imports resolve against the repo file set with the usual extension and index fallbacks; Rust follows mod declarations and use crate:: paths from the nearest src beside a Cargo.toml. Everything else shows as a node with no edges. Notes and task plans are overlaid as counts and touches edges; the graph is rebuilt on request with a ten-second cache in the server.
sources: packages/reggie/src/graph.ts, packages/reggie/src/serve.ts

