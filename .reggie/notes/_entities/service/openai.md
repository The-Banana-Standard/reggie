---
entity: service:openai
kind: entity
---

## data-source · 2026-09-08 · Claude via jacobpress · medium
Reached from the chat handler through functions/chat/embed.js and the response call. The API key is read from the environment in thirteen places and no manifest declares it, because it is set as a dashboard secret; the example vars file documents the name but provisions nothing. Losing it fails closed and loudly, unlike the retrieval flag beside it, which fails silently to keyword-only search.
sources: docs/services-and-flows-spec.md

