---
entity: CLAUDE.md
kind: file
---

## gotcha · 2026-09-15 · Claude via jacobpress · high
Everything between the generated markers is rendered from the repo itself and is replaced wholesale by the refresh; edit only the curated prose above it. The counts inside report the whole tree, so any branch that adds or removes files makes the block stale, and since the check now runs as the last step of CI a stale block fails the build. Refresh it as the last edit before committing, not the first.
sources: packages/reggie/src/docs.ts, .github/workflows/ci.yml

## verify · 2026-09-22 · Codex via jacobpress · medium
The generated repository facts include the browser-DOM test files; refresh and check these blocks after test inventory changes.

