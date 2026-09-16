---
entity: packages/reggie/src/layout.ts
kind: file
---

## how · 2026-09-15 · Claude via jacobpress · high
ensureLayout also calls ensureGitattributes, which appends the journal union-merge line (.reggie/journal/**/*.md merge=union) under a Reggie comment to .gitattributes. It creates the file when missing, copes with a missing trailing newline, never rewrites existing lines, and does nothing on a second run. GitHub ignores merge attributes; in solo mode Reggie merges locally, so that does not matter yet.
sources: packages/reggie/src/layout.ts:120

## gotcha · 2026-09-15 · Claude via jacobpress · medium
INTAKE_HEADER and the state list in REGGIE_README state the same rule the code derives, and they are written into every onboarded repo. This repo's own copies at .reggie/intake.md and .reggie/README.md are not regenerated from these templates, so both have to be edited by hand alongside them.

