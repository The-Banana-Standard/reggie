---
entity: packages/reggie/src/mcp.ts
kind: file
---

## how · 2026-09-15 · Claude via jacobpress · medium
createMcpServer builds the server without connecting it, so tests drive it over InMemoryTransport; startMcpServer connects it to stdio. Every tool is registered through a local wrapper that consults the buildCheck option before the handler runs and returns isError with the refusal while it says stale, because stderr on a stdio server may never reach a person but a tool error reaches the agent. Resources are not gated. Register new tools through the same wrapper, not server.registerTool directly.

