---
entity: packages/reggie/src/build-state.ts
kind: file
---

## why · 2026-09-09 · Claude via jacobpress · high
A linked development checkout runs whatever dist/ last held, so an unbuilt edit is invisible: the Services and Data flow tabs looked broken for a day because the global reggie symlink pointed at a build from before those endpoints existed. Since 2026-09-15 (stale-dev-bin) every command refuses to run while dist/ is behind src/, and REGGIE_ALLOW_STALE=1 is the deliberate way through. checkBuild only judges code loaded from dist/: code run from src/ through tsx is the source, which keeps CI (tests before build) and npm run dev ungated. An empty dist/ says not built yet instead of an age against the epoch. Inert in an installed package, which has no src/ to compare.

