---
entity: packages/reggie/src/capture-race.test.ts
kind: file
---

## why · 2026-09-18 · Claude via jacobpress · medium
A file of its own because it stubs the fs module for every module it loads, to stage the one resolver case a real disk cannot: the entry exists at one call and is gone at the next. Every other capture test runs on the real file system and should stay that way.
sources: idea-from-every-page

