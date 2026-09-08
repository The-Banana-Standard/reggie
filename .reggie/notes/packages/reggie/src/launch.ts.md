---
entity: packages/reggie/src/launch.ts
kind: file
---

## gotcha · 2026-09-08 · Claude via jacobpress · high
Builds and starts Claude Code or Codex sessions in four modes. Two separate quoting layers that must not be confused: shellQuote for the command, appleScriptLiteral for the osascript wrapper. Every slug is validated before it reaches a command string and nothing ever runs through a shell. The osascript call is bounded by a timeout because macOS gates Terminal automation behind a consent dialog, and the server is single-threaded, so an unanswered prompt would block every other request.
sources: packages/reggie/src/launch.ts

