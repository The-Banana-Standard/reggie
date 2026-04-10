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
echo "=== Smithery API ==="
if [ -n "$SMITHERY_API_KEY" ]; then
  echo "SMITHERY_API_KEY: SET"
else
  echo "SMITHERY_API_KEY: NOT SET (Smithery discovery disabled)"
fi

echo ""
echo "=== MCP Registry ==="
cat ~/.claude/mcp-registry.yaml 2>/dev/null | head -5 || echo "Registry not found"
[ -f ~/.claude/mcp-registry.local.yaml ] && echo "--- local overlay found: ~/.claude/mcp-registry.local.yaml ---" && head -5 ~/.claude/mcp-registry.local.yaml
```

## Instructions

This command scans the current project, matches its tech stack against the MCP registry, and helps configure the right MCP servers at project scope.

You (the main Claude) handle this directly. No subagents needed.

### Arguments

```
/reggie-find-tools                    # Scan project and recommend MCP servers
/reggie-find-tools --check            # Show current config status only (no install)
$ARGUMENTS
```

### The Flow

```
SCAN → MATCH LOCAL → SEARCH SMITHERY → RECOMMEND → CONFIGURE
```

No quality gates. Interactive — user selects which tools to enable.

---

## Step 1: SCAN

Read `~/.claude/mcp-registry.yaml` to load the base registry. If `~/.claude/mcp-registry.local.yaml` exists, merge it on top of the base registry (local entries override by key). Use the merged registry for all matching and recommendations. Then scan the project for signals:

1. **Files**: Check for each registry entry's `signals.files` — do these files exist in the project?
2. **Dependencies**: Parse `package.json` (dependencies + devDependencies), `go.mod`, `requirements.txt`, `pyproject.toml`, `Cargo.toml`, `Podfile`, `build.gradle` — do any deps match `signals.deps`?
3. **Directories**: Check for `signals.dirs` — do these directories exist?

Build a list of matched servers with their signal evidence.

---

## Step 2: MATCH LOCAL

Read current MCP configuration from three sources:

1. **Project-level**: `.mcp.json` in project root
2. **Global-level**: `~/.claude/claude_mcp_settings.json`
3. **Plugins**: `enabledPlugins` in `~/.claude/settings.json`

Cross-reference matched servers against current config to categorize each.

---

## Step 3: SEARCH SMITHERY

Search the Smithery.ai registry for verified MCP servers that match the project's tech stack. This step is **optional** — it only runs when `SMITHERY_API_KEY` is set.

### If `SMITHERY_API_KEY` is NOT set:

Skip this step entirely. In the RECOMMEND output, add a note at the bottom:

```
Smithery discovery disabled. Set SMITHERY_API_KEY to find additional
verified servers from smithery.ai.
Get your key: https://smithery.ai/account/api-keys
```

### If `SMITHERY_API_KEY` IS set:

1. **Extract keywords** from the SCAN results. Map detected signals to search terms:
   - Dependencies: `next` → "nextjs", `react` → "react", `firebase` → "firebase", `@playwright/test` → "playwright", `stripe` → "stripe", etc.
   - Config files: `firebase.json` → "firebase", `Dockerfile` → "docker", `go.mod` → "golang", `Podfile` → "ios swift", `build.gradle` → "android"
   - Use the most specific terms available. Aim for 3-6 keywords max — don't over-query.

2. **Query the Smithery API** for each keyword. The `verified=true` parameter is **mandatory** — never omit it:

   ```bash
   curl -s -H "Authorization: Bearer $SMITHERY_API_KEY" \
     "https://api.smithery.ai/servers?q=<keyword>&verified=true&pageSize=10"
   ```

   The response contains a `servers` array with objects like:
   ```json
   {
     "qualifiedName": "owner/server-name",
     "displayName": "Server Name",
     "description": "What it does",
     "verified": true,
     "useCount": 1234
   }
   ```

3. **Filter results** — defense-in-depth beyond the query param:
   - Only include results where `verified: true` in the response object
   - Remove results that match any server already in the merged MCP registry (base + local overlay; compare `qualifiedName` and `slug` against registry server names)
   - Remove results already configured in `.mcp.json` or global MCP settings

4. **Deduplicate across keywords** — if the same server appears for multiple keywords, keep only one entry and list all matched keywords.

5. **Rank by popularity** — sort remaining results by `useCount` descending. Cap at 10 total Smithery results to avoid overwhelming the user.

---

## Step 4: RECOMMEND

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
│ DISCOVERED ON SMITHERY (verified servers, matched your stack):    │
│                                                                  │
│  [8] owner/server-name (1.2k installs, verified)                 │
│      "Description of what it does"                               │
│      Matched: firebase keyword                                   │
│                                                                  │
│  [9] owner/another-server (890 installs, verified)               │
│      "Description of what it does"                               │
│      Matched: react, typescript keywords                         │
│                                                                  │
│  (Set SMITHERY_API_KEY to enable — smithery.ai/account/api-keys) │
│  ↑ shown instead of results when API key is not set              │
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

If `--check` flag: stop here, don't proceed to CONFIGURE. Smithery results are still shown if the API key is set (read-only display is fine).

---

## Step 5: CONFIGURE

Ask user which tools to enable:

```
Which tools would you like to enable? (enter numbers, e.g. "1 2 3" or "all")
```

Numbering is sequential across all categories: RECOMMENDED, OPTIONAL, and DISCOVERED ON SMITHERY all share the same number sequence so the user can pick from any category with a single selection.

For each selected tool:

1. **Check env vars**: If the registry entry has `env_vars`, prompt:
   ```
   [server] requires: SENTRY_AUTH_TOKEN
   This must be set in your environment before the MCP server will work.
   Continue? (y/n)
   ```

2. **Install** — the method depends on whether the server is from the local registry or Smithery:

   **Local registry servers** — use `claude mcp add`:
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

   **Smithery-discovered servers** — use the Smithery CLI:
   ```bash
   npx -y @smithery/cli@latest mcp add <qualifiedName> --client claude
   ```
   This auto-detects the server's transport and configures it. If the CLI prompts for configuration values, pass them through. The server is added to the project's MCP config.

3. **Report** what was configured, noting the source (local registry vs Smithery) for each.

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

- In a `/reggie-code-workflow` run with 10+ subagent launches, MCP context cost is multiplied 10x+
- chrome-devtools (28 tools, `high` token profile) is the largest single contributor
- Subagents that never use MCP tools (reggie-researcher, reggie-code-architect, reggie-code-reviewer) still pay the full schema cost

**Mitigations (in priority order):**
1. **ENABLE_TOOL_SEARCH** — Defers schema loading so subagents only pay for tools they actually invoke
2. **Project-scope servers** — Only loads MCP tools in projects that need them (vs global which loads everywhere)
3. **Remove unused servers** — The UNUSED category above identifies configured tools with no matching signals. Removing them eliminates wasted context.
4. **Pipeline prompt gating** — The reggie-code-manager tells each subagent which MCP tools are relevant, preventing agents from wasting turns on irrelevant tools

---

## Completion

```
┌──────────────────────────────────────────────────────────────────┐
│ FIND-TOOLS COMPLETE                                               │
│                                                                  │
│ Configured: [N] MCP servers                                      │
│   - [server1] (project-level, local registry)                    │
│   - [server2] (project-level, smithery)                          │
│                                                                  │
│ Already configured: [N]                                          │
│ Skipped: [N]                                                     │
│ Removed: [N]                                                     │
│                                                                  │
│ Smithery: [N verified servers discovered / disabled — no API key]│
│ Tool Search: [enabled / already enabled / not enabled]           │
│                                                                  │
│ MCP servers are now available in this project.                   │
│ Run /reggie-find-tools --check to review your config anytime.           │
└──────────────────────────────────────────────────────────────────┘
```

After the completion box, emit:

```
~~REGGIE:DONE:reggie-find-tools:success~~
```

---

## For Integration: CONFIGURE-TOOLS Stage

When called from `/reggie-onboard` or `/reggie-new-repo`, the flow is the same but:
- Skip the Tool Search setup check (not relevant during onboard/new-repo)
- Auto-scan and present recommendations without the explicit `/reggie-find-tools` framing
- The CONFIGURE-TOOLS stage name is used in the pipeline output
- The Smithery search step runs if `SMITHERY_API_KEY` is set — same keyword extraction from the already-discovered tech stack. This lets newly onboarded or scaffolded projects benefit from Smithery discovery automatically.

When called from `/reggie-improve` (TOOLING-CHECK), the flow is read-only:
- SCAN and MATCH LOCAL only (no Smithery search — avoid API calls in read-only audits)
- Produces tool gap/unused proposals that feed into PROPOSE
- Does NOT install anything directly

---

## Broader Ecosystem

After presenting findings, add a brief note:

```
For broader capability awareness (plugins, community agents, Smithery servers),
run /reggie-refresh-capabilities. Pipeline planning stages automatically consult the
capability manifest during RESEARCH and PLAN to recommend relevant tools.
```

This is informational only — `/reggie-find-tools` remains focused on MCP servers.
