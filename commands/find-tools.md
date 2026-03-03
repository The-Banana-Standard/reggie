# Find Tools

Scan a project's tech stack, match against the MCP registry, and configure the right MCP servers at project scope.

## Context

```bash
echo "=== Project Root ==="
pwd

echo ""
echo "=== Tech Stack Signals ==="
[ -f "package.json" ] && echo "package.json: EXISTS" && cat package.json | grep -E '"(dependencies|devDependencies)"' -A 50 | head -60
[ -f "go.mod" ] && echo "go.mod: EXISTS" && head -20 go.mod
[ -f "requirements.txt" ] && echo "requirements.txt: EXISTS" && head -20 requirements.txt
[ -f "pyproject.toml" ] && echo "pyproject.toml: EXISTS" && head -30 pyproject.toml
[ -f "Podfile" ] && echo "Podfile: EXISTS"
[ -f "Cargo.toml" ] && echo "Cargo.toml: EXISTS"
[ -f "build.gradle" ] && echo "build.gradle: EXISTS"

echo ""
echo "=== Config File Signals ==="
for f in firebase.json .firebaserc Dockerfile docker-compose.yml docker-compose.yaml playwright.config.ts playwright.config.js sentry.properties .sentryclirc index.html next.config.js next.config.ts next.config.mjs vite.config.ts vite.config.js vite.config.mjs; do
  [ -e "$f" ] && echo "FOUND: $f"
done

echo ""
echo "=== Directory Signals ==="
for d in functions/ supabase/ prisma/ drizzle/ .github/workflows/; do
  [ -d "$d" ] && echo "FOUND: $d"
done

echo ""
echo "=== Current MCP Config ==="
echo "--- Project-level (.mcp.json) ---"
if [ -f ".mcp.json" ]; then
  cat .mcp.json
else
  echo "No .mcp.json found"
fi

echo ""
echo "--- Global MCP settings ---"
if [ -f ~/.claude/claude_mcp_settings.json ]; then
  cat ~/.claude/claude_mcp_settings.json
else
  echo "No claude_mcp_settings.json found"
fi

echo ""
echo "--- Enabled Plugins ---"
if [ -f ~/.claude/settings.json ]; then
  grep -A 5 '"enabledPlugins"' ~/.claude/settings.json 2>/dev/null || echo "No plugins configured"
else
  echo "No settings.json found"
fi

echo ""
echo "=== MCP Registry ==="
cat ~/.claude/mcp-registry.yaml 2>/dev/null | head -5 || echo "Registry not found"
```

## Instructions

This command scans the current project, matches its tech stack against the MCP registry, and helps configure the right MCP servers at project scope.

You (the main Claude) handle this directly. No subagents needed.

### Arguments

```
/find-tools                    # Scan project and recommend MCP servers
/find-tools --check            # Show current config status only (no install)
$ARGUMENTS
```

### The Flow

```
SCAN → MATCH → RECOMMEND → CONFIGURE
```

No quality gates. Interactive — user selects which tools to enable.

---

## Step 1: SCAN

Read `~/.claude/mcp-registry.yaml` to load the full registry. Then scan the project for signals:

1. **Files**: Check for each registry entry's `signals.files` — do these files exist in the project?
2. **Dependencies**: Parse `package.json` (dependencies + devDependencies), `go.mod`, `requirements.txt`, `pyproject.toml`, `Cargo.toml`, `Podfile`, `build.gradle` — do any deps match `signals.deps`?
3. **Directories**: Check for `signals.dirs` — do these directories exist?

Build a list of matched servers with their signal evidence.

---

## Step 2: MATCH

Read current MCP configuration from three sources:

1. **Project-level**: `.mcp.json` in project root
2. **Global-level**: `~/.claude/claude_mcp_settings.json`
3. **Plugins**: `enabledPlugins` in `~/.claude/settings.json`

Cross-reference matched servers against current config to categorize each.

---

## Step 3: RECOMMEND

Present findings in this format:

```
┌──────────────────────────────────────────────────────────────────┐
│ MCP TOOL SCAN                                                     │
├──────────────────────────────────────────────────────────────────┤
│                                                                  │
│ RECOMMENDED (matched signals, not yet configured):               │
│                                                                  │
│  [1] firebase (medium tokens)                                    │
│      Signals: firebase.json, functions/, firebase-admin dep      │
│      Scope: project | Env vars: none                             │
│                                                                  │
│  [2] playwright (medium tokens)                                  │
│      Signals: playwright.config.ts, @playwright/test dep         │
│      Scope: project | Env vars: none                             │
│                                                                  │
│ ALREADY CONFIGURED:                                              │
│                                                                  │
│  [✓] chrome-devtools (plugin, global)                            │
│                                                                  │
│ OPTIONAL (no signal match, but you might want):                  │
│                                                                  │
│  [3] context7 — Docs lookup for any project (low tokens)         │
│  [4] figma — Design-to-code workflows (medium tokens)            │
│  [5] linear — Project management integration (low tokens)        │
│  [6] slack — Team communication integration (low tokens)         │
│  [7] github — GitHub API access (low tokens, needs PAT)          │
│                                                                  │
│ UNUSED (configured but no signals match):                        │
│                                                                  │
│  [!] supabase — configured globally, no supabase signals found   │
│      Remove? This saves context tokens.                          │
│                                                                  │
└──────────────────────────────────────────────────────────────────┘
```

**Chrome-DevTools cleanup**: If chrome-devtools is enabled globally (in `settings.json` `enabledPlugins`) AND the project has web signals (React, Vue, Next.js, Vite, etc.), offer:

```
Chrome-DevTools is currently enabled globally but this is a web project.
Move to project-level so it's only active where you need it? (y/n)
```

**Optional servers**: Servers with no signal matches (empty `signals.files`, `signals.deps`, `signals.dirs`) are always listed under OPTIONAL. These are "user-intent" tools — the system never auto-recommends them.

If `--check` flag: stop here, don't proceed to CONFIGURE.

---

## Step 4: CONFIGURE

Ask user which tools to enable:

```
Which tools would you like to enable? (enter numbers, e.g. "1 2 3" or "all")
```

For each selected tool:

1. **Check env vars**: If the registry entry has `env_vars`, prompt:
   ```
   [server] requires: SENTRY_AUTH_TOKEN
   This must be set in your environment before the MCP server will work.
   Continue? (y/n)
   ```

2. **Install**: Use `claude mcp add` for project-level installs:
   - For `transport: stdio` servers:
     ```bash
     claude mcp add --scope project [name] [command] [args...]
     ```
   - For `transport: http` servers:
     ```bash
     claude mcp add --scope project --transport http [name] [url]
     ```
   - For `transport: plugin` servers: Note that plugins are configured in `~/.claude/settings.json` under `enabledPlugins` — guide the user to add it.
   - For `scope: global` servers, use `--scope user` instead of `--scope project`.

3. **Report** what was configured.

---

## Tool Search Setup

On first run, check if `ENABLE_TOOL_SEARCH` is configured. This is the single most important setting for pipeline efficiency — without it, every MCP tool schema loads into every subagent's context window, multiplying cost by the number of subagent launches per pipeline run.

If not found in the environment or settings:

```
Tool Search lets Claude discover MCP tools on-demand instead of loading
all tool schemas upfront. This keeps token costs near-zero when multiple
MCP servers are configured.

Recommended setting: ENABLE_TOOL_SEARCH=auto:5

To enable, add to your shell profile (~/.zshrc or ~/.bashrc):
  export ENABLE_TOOL_SEARCH=auto:5

Enable now? (y/n)
```

If yes, append the export line to the user's shell profile and note it takes effect in new terminals.

---

## Context Impact

MCP tool schemas load into every subagent launched via the Task tool during pipeline runs — not just the parent session. The `tools:` allowlist on Task filters built-in tools but does NOT filter MCP tools. This means:

- In a `/code-workflow` run with 10+ subagent launches, MCP context cost is multiplied 10x+
- chrome-devtools (28 tools, `high` token profile) is the largest single contributor
- Subagents that never use MCP tools (researcher, architect, reviewer) still pay the full schema cost

**Mitigations (in priority order):**
1. **ENABLE_TOOL_SEARCH** — Defers schema loading so subagents only pay for tools they actually invoke
2. **Project-scope servers** — Only loads MCP tools in projects that need them (vs global which loads everywhere)
3. **Remove unused servers** — The UNUSED category above identifies configured tools with no matching signals. Removing them eliminates wasted context.
4. **Pipeline prompt gating** — The pipeline-manager tells each subagent which MCP tools are relevant, preventing agents from wasting turns on irrelevant tools

---

## Completion

```
┌──────────────────────────────────────────────────────────────────┐
│ FIND-TOOLS COMPLETE                                               │
│                                                                  │
│ Configured: [N] MCP servers                                      │
│   - [server1] (project-level)                                    │
│   - [server2] (project-level)                                    │
│                                                                  │
│ Already configured: [N]                                          │
│ Skipped: [N]                                                     │
│ Removed: [N]                                                     │
│                                                                  │
│ Tool Search: [enabled / already enabled / not enabled]           │
│                                                                  │
│ MCP servers are now available in this project.                   │
│ Run /find-tools --check to review your config anytime.           │
└──────────────────────────────────────────────────────────────────┘
```

---

## For Integration: CONFIGURE-TOOLS Stage

When called from `/onboard` or `/new-repo`, the flow is the same but:
- Skip the Tool Search check (not relevant during onboard/new-repo)
- Auto-scan and present recommendations without the explicit `/find-tools` framing
- The CONFIGURE-TOOLS stage name is used in the pipeline output

When called from `/improve` (TOOLING-CHECK), the flow is read-only:
- SCAN and MATCH only
- Produces tool gap/unused proposals that feed into PROPOSE
- Does NOT install anything directly
