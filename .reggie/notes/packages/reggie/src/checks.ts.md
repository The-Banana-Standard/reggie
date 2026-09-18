---
entity: packages/reggie/src/checks.ts
kind: file
---

## how · 2026-09-18 · Claude via jacobpress · high
A check is one JSON line in the task's checks.jsonl, appended by recordCheck, which the CLI verb and the reggie_check MCP tool both wrap. The verb refuses, writing nothing: a criterion it cannot choose (by number, key, or a leading label that ends where the selector does, so AC1 never chooses AC12), a slug with no plan, a checkout that is not on the task branch, an outcome that is neither pass nor fail, a criterion passed with no evidence, an evidence path that is not a non-empty regular file directly inside the task's evidence folder, and a pass while a tracked file outside .reggie/ is modified. A fail is always recordable. It never stages and never commits. evidencePath is the one rule for what a citation's words may say, shared with the evidence gate in packet.ts so the verb and the gate cannot disagree.
sources: low-risk-auto-approval

## decision · 2026-09-18 · Claude via jacobpress · high
The verb is a convenience and not a lock: anyone who can commit on the branch can write a line by hand. What makes that harmless is the reader in policy.ts, which verifies the key against the plan on the base commit, the evidence against the branch tip, and the head against the branch's history. So n and text are for readers and are never trusted, the latest line for a key wins by its position in the file and never by its clock, and readChecks never throws: a line that is not exactly a version 1 record, an unknown field such as __proto__ included, is counted by line number and is itself a refusal. Records are rebuilt field by field, lines are bounded at 16 KB and files at five thousand lines.
sources: low-risk-auto-approval

## gotcha · 2026-09-18 · Claude via jacobpress · high
Never type a backslash-u escape into this file through the file-writing tool: it arrives as the raw character, and three character classes here were briefly raw control bytes because of it. They are written as escapes, and after any edit to UNSAFE_TEXT_CHARS, cleanLine or evidencePath the file should be scanned for bytes below 0x20. The same trap is recorded for capture.ts.
sources: low-risk-auto-approval

