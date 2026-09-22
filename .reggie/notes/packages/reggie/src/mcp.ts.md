---
entity: packages/reggie/src/mcp.ts
kind: file
---

## how · 2026-09-15 · Claude via jacobpress · medium
createMcpServer builds the server without connecting it, so tests drive it over InMemoryTransport; startMcpServer connects it to stdio. Every tool is registered through a local wrapper that consults the buildCheck option before the handler runs and returns isError with the refusal while it says stale, because stderr on a stdio server may never reach a person but a tool error reaches the agent. Resources are not gated. Register new tools through the same wrapper, not server.registerTool directly.

## how · 2026-09-18 · Claude via jacobpress · medium
reggie_capture takes an optional path, resolved by the same resolver as every other door; a refusal comes back as a tool error with the resolver's sentence, because an error result reaches the agent where stderr may not. There is no launch tool, by the owner's ruling: launching opens a terminal on the serving machine and is a human act.
sources: idea-from-every-page

## how · 2026-09-18 · Claude via jacobpress · high
reggie_check wraps recordCheck exactly as the CLI verb does and is registered through the stale-build wrapper like every other tool. A refusal comes back as a tool error carrying the verb's own sentence, because an error result reaches the agent where stderr may not; called with no criterion, review or outcome it returns the policy report's text, which says it is a report. Like the journal tool it records the tool as agent when the environment does not say which. There is still no tool that decides, and a test asserts that no tool's name contains decide: a decision is a person's.
sources: low-risk-auto-approval

