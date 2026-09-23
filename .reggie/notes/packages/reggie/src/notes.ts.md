---
entity: packages/reggie/src/notes.ts
kind: file
---

## how · 2026-09-23 · Codex via jacobpress · high
Symbol notes use the stable semantic ID and live under notes/_symbols/<source-path>/<qualified-symbol>.md; legacy repo, folder, file, and _entities paths remain readable.
sources: shared-repo-knowledge

## gotcha · 2026-09-23 · Codex via jacobpress · medium
Reject control characters in every note entity before frontmatter or filesystem routing so route and other free-form identifiers cannot inject metadata.
## decision · 2026-09-23 · Codex via jacobpress · medium
New free-form entity notes use a readable slug plus a source-name digest so distinct route or concept IDs cannot alias one file; an exact frontmatter match preserves legacy slug-only paths.
