---
title: "Reggie: Quickstart Guide"
description: "From install to parallel execution loop"
date: "2026-03-04"
status: published
tags: [Reggie, How-To, Agentic Engineering]
---

# Reggie: Quickstart Guide

## What You Install

- `agents/` - 37 specialized AI agents
- `commands/` - 36 slash commands
- `hooks/` - Post-task hooks for tracking and automation
- `docs/` - System docs and references
- `mcp-registry.yaml` - Curated MCP registry (versioned)
- `skills-registry.yaml` - Curated community skills registry (versioned)
- `install.sh` / `install.ps1` - Install scripts
- `uninstall.sh` / `uninstall.ps1` - Uninstall scripts

`capability-manifest.yaml` is local generated state in `~/.claude/` and is refreshed with `/refresh-capabilities`.

---

## Prerequisites

1. Claude Code CLI installed and authenticated
2. Git installed
3. Optional: GitHub CLI (`gh`) authenticated for repo workflows

---

## Choose a Channel

### Stable (recommended)

Use tagged releases.

### Edge

Track `main` for latest changes.

---

## Install

### Stable

macOS/Linux:

```bash
git clone https://github.com/The-Banana-Standard/reggie.git
cd reggie
git fetch --tags
git checkout v1.1.0
./install.sh
```

Windows (PowerShell as Administrator):

```powershell
git clone https://github.com/The-Banana-Standard/reggie.git
cd reggie
git fetch --tags
git checkout v1.1.0
.\install.ps1
```

### Edge

macOS/Linux:

```bash
git clone https://github.com/The-Banana-Standard/reggie.git
cd reggie
./install.sh
```

Windows:

```powershell
git clone https://github.com/The-Banana-Standard/reggie.git
cd reggie
.\install.ps1
```

Installer behavior:
- Symlinks Reggie directories/files into `~/.claude/`
- Configures stats tracking hooks in `settings.json`
- Adds `ENABLE_TOOL_SEARCH=auto:5` to shell profile
- Creates optional local overlays if missing:
  - `~/.claude/mcp-registry.local.yaml`
  - `~/.claude/skills-registry.local.yaml`

> Windows note: symlink creation requires Administrator PowerShell or Developer Mode.

After install, restart Claude Code and run:

```text
/reggie-guide I just ran install.sh what do I do now?
```

---

## Daily Driver Loop

```text
Brain dump -> /init-tasks -> /code-workflow (xN in parallel)
```

### New project path

1. Create/open project folder
2. Run `claude`
3. Run `/new-repo`
4. Brain dump raw tasks into `TASKS.md`
5. Run `/init-tasks`
6. Run `/code-workflow` (single or multiple terminals)

### Existing project path

1. Open project folder
2. Run `claude`
3. Run `/onboard`
4. Brain dump raw tasks into `TASKS.md`
5. Run `/init-tasks`
6. Run `/code-workflow`

---

## Capabilities

- `/find-tools` is explicit and interactive (opt-in tool discovery/configuration)
- `/refresh-capabilities` is optional and refreshes local generated manifest state
- Curated registries are versioned in this repo
- Local overlays are user-specific and not versioned

---

## Update

### Stable

```bash
cd ~/path/to/reggie
git fetch --tags
git checkout <newer-tag>
./install.sh   # run if needed
```

### Edge

```bash
cd ~/path/to/reggie
git pull
```

---

## Uninstall

macOS/Linux:

```bash
cd ~/path/to/reggie
./uninstall.sh
```

Windows:

```powershell
cd ~\path\to\reggie
.\uninstall.ps1
```

---

## Troubleshooting

`/reggie-guide` shows nothing:
- Re-run install from the repo root
- Restart Claude Code

GitHub operations fail:
- Run `gh auth status`
- If needed: `gh auth login`

Commands behave inconsistently:
- Fully restart Claude Code (it reads `~/.claude/` at launch)
