---
entity: packages/reggie/src/layout.ts
kind: file
---

## how · 2026-09-15 · Claude via jacobpress · high
ensureLayout also calls ensureGitattributes, which appends the journal union-merge line (.reggie/journal/**/*.md merge=union) under a Reggie comment to .gitattributes. It creates the file when missing, copes with a missing trailing newline, never rewrites existing lines, and does nothing on a second run. GitHub ignores merge attributes; in solo mode Reggie merges locally, so that does not matter yet.
sources: packages/reggie/src/layout.ts:120

## gotcha · 2026-09-15 · Claude via jacobpress · medium
INTAKE_HEADER and the state list in REGGIE_README state the same rule the code derives, and they are written into every onboarded repo. This repo's own copies at .reggie/intake.md and .reggie/README.md are not regenerated from these templates, so both have to be edited by hand alongside them.

## how · 2026-09-18 · Claude via jacobpress · medium
REGGIE_README names tasks/<slug>/checks.jsonl between the packet and the evidence folder, says the packet's checklist is built from it and nobody ticks a box by hand, and says a packet that cites a file which is not committed is refused when someone approves it. This repo's own .reggie/README.md is not regenerated from the template and was edited by hand to match.
sources: low-risk-auto-approval

## how · 2026-09-23 · Codex via jacobpress · high
New layouts create and explain notes/_symbols beside _entities, and document replaceable current understanding, fingerprints, explicit refresh, immutable history and retirement.
sources: shared-repo-knowledge

## how · 2026-09-23 · Codex via jacobpress · high
Onboarding creates an empty versioned concept-override document and explains it in the repository-owned Reggie readme.
sources: code-entity-pages

