---
entity: _repo
kind: repo
---

## why · 2026-09-14 · jacobpress · high
Reggie helps a repo's owner keep understanding a codebase that AI engineering builds faster than anyone can read it. Code arrives from Claude Code and Codex sessions in hours, and the person responsible for the repo needs a way to keep up: to see how the pieces fit together, to review what changed recently and why, and to notice where the knowledge is thin. Reggie draws that picture from git and from notes kept in the repo, and serves it as a web view that explains the code and the work. Once the owner understands enough to want something changed, they capture a task here, groom it into a brief, and plan it in Claude or Codex. As those sessions produce work, Reggie tracks each task from idea to plan to branch to decision, so the owner always knows what is in flight, what is waiting on them, and what landed. The loop from understanding to improvement stays inside the repo.
sources: docs/repo-manager-vision.md, CLAUDE.md

## how · 2026-09-14 · jacobpress · high
The product is the TypeScript CLI, MCP server and web UI in packages/reggie. Build and test inside packages/reggie with npm run build and npm test, or from the repo root, which delegates there. Start the web view with reggie serve.
sources: packages/reggie/package.json, packages/reggie/src/cli.ts

