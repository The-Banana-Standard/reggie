---
entity: packages/reggie/
kind: dir
---

## how · 2026-09-06 · Claude via jacobpress · high
One module per concern under src: paths and git for repo access, layout and people for the .reggie tree, facts and docs for the generated CLAUDE and AGENTS blocks, notes and journal for knowledge, plan and tasks and packet for the task loop, context for the pack agents read first, claim and capture for branches and intake, onboard for setup, mcp and cli as the two front ends. Tests sit beside modules; test/helpers.ts builds throwaway git repos.
sources: packages/reggie/src/cli.ts

## how · 2026-09-10 · Claude via jacobpress · high
The whole product lives here: src holds the CLI, the MCP server, the graph and story derivation, and the HTTP server; ui holds the web client as vanilla ES modules with no bundler; docs holds the UI spec and API contract. Install with npm install --legacy-peer-deps.
sources: packages/reggie/package.json

