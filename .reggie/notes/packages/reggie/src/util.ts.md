---
entity: packages/reggie/src/util.ts
kind: file
---

## gotcha · 2026-09-17 · Claude via jacobpress · high
escapeBodyLine indents any body line that starts with a header marker or with sources:, evidence: or derived:, for notes and journal entries alike. The last was added with the derived journal: that word starts the machine-written watermark line, so a hand entry that happens to begin a line with it must never be read back as one. Add a trailer here in the same commit that teaches a parser to read it.
sources: derive-the-journal

