# Journal · 2026-09-15 · jacobpress · session

Plain-English record of what happened, written as it happened. No file paths in the prose; link evidence instead.

### 16:57 · jacobpress · claude · stale-dev-bin · execute
Built the stale build gate as planned. Every command now refuses to run while the compiled build is behind the source and names the file and the fix; setting the escape hatch variable runs the old build with a warning, and version and help are never gated. The MCP server still starts but refuses each tool call with an error, and says to restart when the build on disk is newer than the one it loaded. An empty build folder now says it was never built instead of inventing an age. The full suite, typecheck and build pass, and a live run against the compiled bin refused four commands, including two nested ones, which cleared the bail condition about the hook. My first live run was wrong: I touched the source inside the one-second grace, so it looked current and serve started for real; I stopped that run and redid it with a wait. Not committed yet; no packet written.
evidence: .reggie/tasks/stale-dev-bin/evidence/tests.txt, .reggie/tasks/stale-dev-bin/evidence/stale-cli.txt, .reggie/tasks/stale-dev-bin/evidence/stale-mcp.txt, .reggie/tasks/stale-dev-bin/evidence/docs-check.txt

