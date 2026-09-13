---
entity: packages/reggie/src/launch.ts
kind: file
---

## gotcha · 2026-09-08 · Claude via jacobpress · high
Builds and starts Claude Code or Codex sessions in four modes. Two separate quoting layers that must not be confused: shellQuote for the command, appleScriptLiteral for the osascript wrapper. Every slug is validated before it reaches a command string and nothing ever runs through a shell. The osascript call is bounded by a timeout because macOS gates Terminal automation behind a consent dialog, and the server is single-threaded, so an unanswered prompt would block every other request.
sources: packages/reggie/src/launch.ts

## how · 2026-09-13 · Claude via jacobpress · medium
Two launch modes, discuss and build. The goal (shape, plan, discuss, build) is derived from the task's state by resolveGoal, so no button chooses a prompt and no Reggie slash command is ever emitted. Discussion goals open Claude Code in plan mode and Codex read-only; a build expects the caller to have claimed the task and passes the branch. The prompt names a context file the caller wrote under .reggie/.cache/context, and carries the user's note verbatim.
sources: packages/reggie/src/launch.ts:1

## gotcha · 2026-09-13 · Claude via jacobpress · medium
launchCommand is pure and mints nothing. Session ids, context files, launch records and the claim for a build are the caller's job (serve.ts POST /api/launch and cli.ts launch --run both do it); keep them there so GET /api/launch can describe a command without side effects.
sources: packages/reggie/src/launch.ts:1

