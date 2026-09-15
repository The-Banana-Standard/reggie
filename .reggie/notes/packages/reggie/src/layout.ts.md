---
entity: packages/reggie/src/layout.ts
kind: file
---

## how · 2026-09-15 · Claude via jacobpress · high
ensureLayout also calls ensureGitattributes, which appends the journal union-merge line (.reggie/journal/**/*.md merge=union) under a Reggie comment to .gitattributes. It creates the file when missing, copes with a missing trailing newline, never rewrites existing lines, and does nothing on a second run. GitHub ignores merge attributes; in solo mode Reggie merges locally, so that does not matter yet.
sources: packages/reggie/src/layout.ts:120

