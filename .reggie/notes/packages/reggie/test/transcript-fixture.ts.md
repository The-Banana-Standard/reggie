---
entity: packages/reggie/test/transcript-fixture.ts
kind: file
---

## why · 2026-09-17 · Claude via jacobpress · high
Builds a synthetic Claude home in a temp directory, one record at a time, from text invented for the test that asks for it. Nothing in it is copied from a real transcript and no transcript file is ever added to the repository; only the shape follows what was measured: a flat file named by the session id under an encoded project folder, one content block per assistant record with its stop reason, cwd, timestamp and sidechain flag, the rarer record types that hold the owner's words, and the workflows folder a session leaves where it changed directory. It also holds one invented example of each secret shape the redactor withholds, assembled at run time so no literal in the repo looks like a credential to a scanner.
sources: derive-the-journal

