---
entity: packages/reggie/src/services.ts
kind: file
---

## why · 2026-09-08 · Claude via jacobpress · high
Finds what a repo talks to by reading manifests and then the code: wrangler bindings with the line that declares each, firebase config, SDK dependencies, migration tables, and every env read. The headline output is the mismatch between the two — a name the code depends on that no manifest declares is a dashboard secret or a missing config, and it is invisible until it breaks. Example files count as documentation, not provisioning. Test files never establish a service.
sources: packages/reggie/src/services.ts, docs/services-and-flows-spec.md

