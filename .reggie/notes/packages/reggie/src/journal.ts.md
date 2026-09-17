---
entity: packages/reggie/src/journal.ts
kind: file
---

## how · 2026-09-17 · Claude via jacobpress · high
One writer shape for every entry: a header line, the body with any line that looks like a header or a trailer indented, an optional evidence line, and for a machine-written entry an optional last line, derived: session=… through=… commits=… prose=…. parseJournalFile reads that line into the entry's derived field and keeps it out of the text; the header pattern and everything about a hand entry are unchanged. Only the exact line the writer produces is a mark: a UUID or none, an ISO instant or none, twelve character hex ids or none, template or model. Anything else that starts with the word stays body text, and a hand entry's own derived line is indented on the way in, so neither a person nor a quotation can forge a watermark. formatJournalEntry renders the block without writing it, which is what a dry run prints.
sources: derive-the-journal

## gotcha · 2026-09-17 · Claude via jacobpress · medium
sessionName still returns the placeholder word unless REGGIE_SESSION is set, so every hand entry and every entry drawn from commits alone shares one day file per person, while a derived session entry gets a file of its own named by the real session id. That split closes when session-name-reads-real-id lands; derive needs no change for it, because it already treats any UUID-named day file that mentions the slug as one of the task's sessions.
sources: derive-the-journal

