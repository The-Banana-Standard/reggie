---
title: "Reggie: Quickstart Guide"
description: "From install to parallel execution loop"
date: "2026-03-04"
status: published
tags: [Reggie, How-To, Agentic Engineering]
---

# Reggie: Quickstart Guide

## What You Get

All distributable content lives under `resources/` in the repo:

- `resources/agents/` - 36 specialized AI agents
- `resources/commands/` - 35 slash commands
- `resources/hooks/` - Stats tracking hook
- `resources/docs/` - System documentation
- `resources/registries/` - MCP and skills registries

`capability-manifest.yaml` is local generated state in `~/.claude/` and is refreshed with `/reggie-refresh-capabilities`.

---

## Prerequisites

1. Claude Code CLI installed and authenticated
2. Git installed
3. Optional: GitHub CLI (`gh`) authenticated for repo workflows

---

## Install

Reggie is installed and managed by the [Reggie desktop app](https://github.com/The-Banana-Standard/reggie). The app copies the contents of `resources/` into `~/.claude/` and keeps them in sync.

The Reggie app handles:
- Copying agents, commands, hooks, docs, and registries into `~/.claude/`
- Preserving user-created files (additive install -- never deletes existing files)
- Configuring stats tracking hooks in `settings.json`
- Adding `ENABLE_TOOL_SEARCH=auto:5` to shell profile
- Creating optional local overlays if missing:
  - `~/.claude/mcp-registry.local.yaml`
  - `~/.claude/skills-registry.local.yaml`

After install, restart Claude Code and run:

```text
/reggie-guide I just installed Reggie, what do I do now?
```

---

## Daily Driver Loop

```text
Brain dump -> /reggie-init-tasks -> /reggie-code-workflow (xN in parallel)
```

### New project path

1. Create/open project folder
2. Run `claude`
3. Run `/reggie-new-repo`
4. Brain dump raw tasks into `TASKS.md`
5. Run `/reggie-init-tasks`
6. Run `/reggie-code-workflow` (single or multiple terminals)

### Existing project path

1. Open project folder
2. Run `claude`
3. Run `/reggie-onboard`
4. Brain dump raw tasks into `TASKS.md`
5. Run `/reggie-init-tasks`
6. Run `/reggie-code-workflow`

---

## Capabilities

- `/reggie-find-tools` is explicit and interactive (opt-in tool discovery/configuration)
- `/reggie-refresh-capabilities` is optional and refreshes local generated manifest state
- Curated registries are versioned in this repo
- Local overlays are user-specific and not versioned

---

## Update

Updates are managed through the Reggie app. Pull the latest changes from the repo and the app will sync `resources/` into `~/.claude/`.

---

## Uninstall

Use the Reggie app to remove Reggie files from `~/.claude/`. Alternatively, delete the Reggie agent and command files from `~/.claude/agents/` and `~/.claude/commands/` manually.

---

## Troubleshooting

`/reggie-guide` shows nothing:
- Ensure the Reggie app has synced into `~/.claude/`
- Restart Claude Code

GitHub operations fail:
- Run `gh auth status`
- If needed: `gh auth login`

Commands behave inconsistently:
- Fully restart Claude Code (it reads `~/.claude/` at launch)
