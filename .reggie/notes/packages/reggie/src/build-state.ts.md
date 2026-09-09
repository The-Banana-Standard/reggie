---
entity: packages/reggie/src/build-state.ts
kind: file
---

## why · 2026-09-09 · Claude via jacobpress · high
A linked development checkout runs whatever dist/ last held, so an unbuilt edit is invisible: the Services and Data flow tabs looked broken for a day because the global reggie symlink pointed at a build from before those endpoints existed. Every command that would be confusing to run stale checks first. Inert in an installed package, which has no src/ to compare.

