---
entity: packages/reggie/src/paths.ts
kind: file
---

## how · 2026-09-18 · Claude via jacobpress · medium
checksFile and checksRelPath name a task's check records, .reggie/tasks/<slug>/checks.jsonl, beside packet.md and evidence/. taskRelDir and evidenceRelDir are the repo-relative prefixes, trailing slash included, that the policy uses to tell a task's own records from code and that the evidence rule uses as the only folder a citation may name. Every one of them goes through assertSlug, because the slug is the only user input that becomes a path segment.
sources: low-risk-auto-approval
