---
entity: _repo
kind: repo
---

## how · 2026-09-06 · Claude via jacobpress · high
Reggie is the agent system and repo manager used across the Banana Standard projects. On this branch the product is the TypeScript CLI and MCP server in packages/reggie; the Tauri desktop app in src and src-tauri is legacy and slated for removal. Build and test the package with npm run build and npm test inside packages/reggie.
sources: packages/reggie/package.json, docs/repo-manager-vision.md

## how · 2026-09-10 · Claude via jacobpress · high
Reggie is a repo manager for Claude Code and Codex. The product is the TypeScript CLI, MCP server and web UI in packages/reggie; the Tauri desktop app that used to live in src and src-tauri was deleted on this branch. Build and test inside packages/reggie with npm run build and npm test, or from the repo root, which delegates there. Start the web view with reggie serve.
sources: CLAUDE.md, packages/reggie/src/cli.ts

