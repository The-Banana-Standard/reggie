# Refresh Capabilities

Update the capability manifest with the latest tools, plugins, MCP servers, and community skills from all known sources.

## Context

```bash
echo "=== Current Manifest ==="
if [ -f ~/.claude/capability-manifest.yaml ]; then
  head -15 ~/.claude/capability-manifest.yaml
  echo ""
  echo "--- Entry counts ---"
  grep -c "^  [a-z]" ~/.claude/capability-manifest.yaml 2>/dev/null || echo "0 entries"
else
  echo "No capability manifest found"
fi

echo ""
echo "=== Smithery API ==="
if [ -n "$SMITHERY_API_KEY" ]; then
  echo "SMITHERY_API_KEY: SET"
else
  echo "SMITHERY_API_KEY: NOT SET (Smithery indexing disabled)"
fi

echo ""
echo "=== Local MCP Registry ==="
if [ -f ~/.claude/mcp-registry.yaml ]; then
  SERVER_COUNT=$(grep -c "^  [a-z]" ~/.claude/mcp-registry.yaml 2>/dev/null)
  echo "Base registry found: $SERVER_COUNT servers"
  if [ -f ~/.claude/mcp-registry.local.yaml ]; then
    LOCAL_SERVER_COUNT=$(grep -c "^  [a-z]" ~/.claude/mcp-registry.local.yaml 2>/dev/null)
    echo "Local overlay found: $LOCAL_SERVER_COUNT servers"
  fi
else
  echo "Registry not found"
fi

echo ""
echo "=== Official Plugin Marketplace ==="
INTERNAL=$(ls ~/.claude/plugins/marketplaces/claude-plugins-official/plugins/ 2>/dev/null | wc -l | tr -d ' ')
EXTERNAL=$(ls ~/.claude/plugins/marketplaces/claude-plugins-official/external_plugins/ 2>/dev/null | wc -l | tr -d ' ')
echo "Internal plugins: $INTERNAL"
echo "External plugins: $EXTERNAL"

echo ""
echo "=== Community Marketplaces ==="
ls ~/.claude/plugins/marketplaces/ 2>/dev/null | grep -v claude-plugins-official || echo "No community marketplaces installed"

echo ""
echo "=== Skills Registry ==="
if [ -f ~/.claude/skills-registry.yaml ]; then
  SKILL_COUNT=$(grep -c "^  [a-z]" ~/.claude/skills-registry.yaml 2>/dev/null)
  echo "Base registry found: $SKILL_COUNT skills"
  if [ -f ~/.claude/skills-registry.local.yaml ]; then
    LOCAL_SKILL_COUNT=$(grep -c "^  [a-z]" ~/.claude/skills-registry.local.yaml 2>/dev/null)
    echo "Local overlay found: $LOCAL_SKILL_COUNT skills"
  fi
else
  echo "Skills registry not found"
fi
```

## Instructions

This command updates `~/.claude/capability-manifest.yaml` with the latest capabilities from all known sources. Pipeline planning stages (RESEARCH, PLAN) read this manifest to recommend tools during capability-aware planning.

You (the main Claude) handle this directly. No subagents needed.

### Arguments

```
/reggie-refresh-capabilities                # Full refresh from all sources
/reggie-refresh-capabilities --smithery     # Refresh Smithery section only
/reggie-refresh-capabilities --skills       # Refresh community skills section only
/reggie-refresh-capabilities --check        # Show current manifest status (no changes)
$ARGUMENTS
```

### The Flow

```
READ CURRENT → SCAN OFFICIAL PLUGINS → SCAN COMMUNITY → SCAN SKILLS → QUERY SMITHERY → MERGE → WRITE
```

No quality gates. Reports what changed.

---

## Step 1: READ CURRENT

Read `~/.claude/capability-manifest.yaml` if it exists. Note the current entry counts per source and `last_refreshed` timestamp.

If `--check` flag: show the manifest status and stop. Display:

```
Capability Manifest Status:
  Last refreshed: [date]
  Official plugins: [N] entries
  Community plugins: [N] entries
  Community skills: [N] entries
  Smithery servers: [N] entries
  Local MCP: [N] servers (cross-ref to mcp-registry.yaml)
  Total: [N] capabilities indexed
```

---

## Step 2: SCAN OFFICIAL PLUGINS

**Skip if**: `--skills` flag is set (only refreshing skills section).

Read the official plugin marketplace directories:

1. **Internal plugins**: Scan `~/.claude/plugins/marketplaces/claude-plugins-official/plugins/`
   - For each plugin directory, read `.claude-plugin/plugin.json` for description
   - If no `plugin.json`, read the first paragraph of `README.md`
   - Check what it provides: agents/, skills/, commands/, hooks/, .mcp.json
   - Generate a manifest entry with: source, type, name, description, keywords, provides, install command, category

2. **External plugins**: Scan `~/.claude/plugins/marketplaces/claude-plugins-official/external_plugins/`
   - Same process as internal plugins
   - These are typically MCP-based, so check `.mcp.json` for server configuration

**Deduplication**: Compare against existing manifest entries. Update descriptions if they've changed. Add new plugins. Do NOT remove manually curated entries.

**Keyword generation**: Extract keywords from the description and plugin name. For LSP plugins, include the language name. For MCP plugins, include the service name.

---

## Step 3: SCAN COMMUNITY MARKETPLACES

**Skip if**: `--skills` flag is set (only refreshing skills section).

Check for community marketplaces installed at `~/.claude/plugins/marketplaces/`:

1. **If `wshobson/agents` (or similar) is installed**: Scan its plugin directories the same way as official plugins. Extract plugin names, descriptions, and capabilities.

2. **If NOT installed but entries exist in the manifest**: Keep existing community entries — they were manually curated. Mark them with a note that the marketplace is not installed locally.

3. **If a community marketplace URL is known but not installed**: Use WebFetch to read the README or plugin index from the GitHub repo. Extract plugin names and descriptions. This is a best-effort scan — the manifest entries may have less detail than locally installed plugins.

**Known community marketplaces**:
- `wshobson/agents` — https://github.com/wshobson/agents

---

## Step 3.5: SCAN SKILLS REGISTRY

Read `~/.claude/skills-registry.yaml` if it exists. This is a curated index of community Claude Code skills (SKILL.md-based playbooks) from known sources. If `~/.claude/skills-registry.local.yaml` exists, merge it on top of the base registry and use the merged result.

**Skip if**: `--smithery` flag is set (only refreshing Smithery). Also skip if the registry file does not exist.

**Process**:

1. Read each entry from the merged skills registry (base + optional local overlay)
2. Generate a manifest entry for the `COMMUNITY SKILLS` section with:
   - `source: community-skill`
   - `type: skill` or `type: skill-collection` (collections bundle multiple skills)
   - All fields from the registry entry: name, description, keywords, source_trust, install, install_type, provides_skills, category
   - Optional fields: signals, overlaps_with, github_stars, marketplace
3. Deduplicate against existing manifest entries — if a skill is already covered by an official plugin entry (e.g., webapp-testing is part of example-skills plugin), keep both but note the overlap
4. Preserve any manually added skill entries in the manifest that are NOT in the registry

**Quality filtering**: Only include entries with `source_trust: official` or `source_trust: curated`. Community-trust entries are included but capped at 10 to keep the manifest focused.

**Known skill sources** (indexed in the registry):
- `anthropics/skills` — Official Anthropic skills repo
- `travisvn/awesome-claude-skills` — Curated community list (7.6k+ stars)
- Notable standalone repos (Trail of Bits, obra/superpowers, Expo, etc.)

---

## Step 4: QUERY SMITHERY

**Skip if**: `--skills` flag is set (only refreshing skills section), or `SMITHERY_API_KEY` is not set. If skipping due to missing key, preserve any existing Smithery entries in the manifest and add a comment noting the key is not set.

**If SMITHERY_API_KEY is set**:

1. Define search categories with keywords:
   ```
   backend:    database, api, backend, server
   frontend:   react, vue, frontend, css, browser
   devops:     docker, kubernetes, ci-cd, deployment, monitoring
   testing:    testing, e2e, selenium, playwright, automation
   docs:       documentation, markdown, openapi
   productivity: slack, email, calendar, project-management
   ai-ml:     ai, machine-learning, llm, embeddings, vector
   data:       analytics, etl, data-pipeline, sql
   ```

2. For each category, query Smithery:
   ```bash
   curl -s -H "Authorization: Bearer $SMITHERY_API_KEY" \
     "https://api.smithery.ai/servers?q=<keyword>&verified=true&pageSize=10"
   ```

3. Filter results:
   - Only `verified: true` in the response object
   - Remove servers that match any entry in the merged MCP registry (base + optional local overlay)
   - Remove servers already represented by official plugin marketplace entries
   - Deduplicate across keywords (same server from multiple queries = keep one, note all keywords)

4. Rank by `useCount` descending. Cap at 75 total Smithery entries across all categories.

5. Generate manifest entries with: source=smithery, type=mcp-server, qualifiedName, description, keywords, install command (`npx -y @smithery/cli@latest mcp add <qualifiedName> --client claude`), useCount, verified=true.

---

## Step 5: MERGE & WRITE

1. Merge all sources into the manifest. Preserve the existing structure:
   - Official plugins section
   - Community plugins section
   - Community skills section
   - Smithery servers section
   - Local MCP cross-reference section

2. Update the metadata header:
   ```yaml
   metadata:
     last_refreshed: "[current ISO timestamp]"
     sources:
       official_plugins: [count]
       community_plugins: [count]
       community_skills: [count]
       smithery_servers: [count]
       local_mcp: [count from merged MCP registry]
   ```

3. Write the updated manifest to the YAML file using the Write tool.

4. Report what changed:
   ```
   ┌──────────────────────────────────────────────────────────────────┐
   │ REFRESH-CAPABILITIES COMPLETE                                     │
   │                                                                  │
   │ Official plugins: [N] ([+X new, -Y removed, ~Z updated])        │
   │ Community plugins: [N] ([+X new])                                │
   │ Community skills: [N] ([+X new]) (from merged skills registry)  │
   │ Smithery servers: [N] ([+X new, -Y removed])                    │
   │ Local MCP: [N] (cross-ref to merged MCP registry)               │
   │                                                                  │
   │ Total: [N] capabilities indexed                                  │
   │ Manifest written to ~/.claude/capability-manifest.yaml           │
   │                                                                  │
   │ Smithery: [enabled / disabled — set SMITHERY_API_KEY]            │
   │                                                                  │
   │ Pipeline planning stages will use this manifest automatically    │
   │ during RESEARCH and PLAN.                                        │
   └──────────────────────────────────────────────────────────────────┘
   ```

After the completion box, emit:

```
~~REGGIE:DONE:reggie-refresh-capabilities:success~~
```

---

## Notes

- This command writes local generated state to `~/.claude/capability-manifest.yaml`. It is not a source file to commit.
- The manifest is designed to be human-readable and hand-editable. `/reggie-refresh-capabilities` augments but does not overwrite manual edits to existing entries.
- Smithery queries are rate-limited. The command makes ~8 API calls (one per category). If rate-limited, report what succeeded and what was skipped.
- Community plugin entries from `wshobson/agents` are curated — the refresh process updates descriptions but does not auto-add new community plugins without verification. New community plugins are noted in the output for manual review.
