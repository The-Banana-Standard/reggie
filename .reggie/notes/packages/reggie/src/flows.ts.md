---
entity: packages/reggie/src/flows.ts
kind: file
---

## how · 2026-09-08 · Claude via jacobpress · high
Traces data from an entry point to its sinks and labels each edge with the payload. Payload extraction is a ladder and the rung matters: destructured request bodies, object literals and type annotations are exact; bare parameter names are heuristic and must be drawn differently; anything else is null and says so. Never invent a shape. Two caps apply, a per-hop budget and a total, and both report what they dropped rather than showing a partial picture silently.
sources: packages/reggie/src/flows.ts

## how · 2026-09-22 · Codex via jacobpress · medium
Richer flow steps use compiler-backed actual arguments, boundary payload shapes, and all return variants while legacy input and output payloads remain temporarily for old readers.

