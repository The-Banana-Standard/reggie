---
title: "Reggie: Quickstart Guide"
description: "From git clone to automated workflow in minutes"
date: "2026-02-05"
status: published
tags: [Reggie, How-To, Agentic Engineering]
---

# Reggie: Quickstart Guide

## What's Inside?

- **agents/** -- 37 specialized AI agents
- **commands/** -- 34 slash commands, including 11 pipeline commands
- **hooks/** -- Post-task hooks for tracking and automation
- **docs/** -- System documentation and reference guides
  - `PORTABLE-PACKAGE.md` -- Full system reference
  - `agents-is-all-you-need.md` -- Article for deeper understanding
- **REGGIE.md** -- System architecture and philosophy overview
- **install.sh** / **uninstall.sh** -- Install and uninstall scripts (macOS/Linux)
- **install.ps1** / **uninstall.ps1** -- Install and uninstall scripts (Windows)

---

## Prerequisites

You need two things already set up:

1. **Claude Code CLI** -- installed and authenticated
2. **GitHub CLI (gh)** -- authenticated with your GitHub account (for repo operations and branch management)

If you need help with either, check out the [Claude Code CLI](https://code.claude.com/docs/en/overview) or [GitHub CLI](https://cli.github.com/) documentation.

---

## Install

1. Clone the repo:

   ```bash
   git clone https://github.com/The-Banana-Standard/reggie.git
   cd reggie
   ```

2. Run the install script:

   **macOS / Linux:**

   ```bash
   ./install.sh
   ```

   **Windows (PowerShell as Administrator):**

   ```powershell
   .\install.ps1
   ```

   This symlinks `agents/`, `commands/`, `hooks/`, and key docs into `~/.claude/`, configures the stats tracking hook in `settings.json`, and backs up any existing files before overwriting.

   > **Windows note:** Creating symlinks requires running PowerShell as Administrator, or having Developer Mode enabled in Windows Settings.

3. Restart Claude Code, then verify the installation:

   ```bash
   claude
   /reggie-guide
   ```

   If the command loads the guide, your installation succeeded.

---

## Pulling Updates

Since everything is symlinked to the repo, updates are simple:

```bash
cd ~/path/to/reggie
git pull
```

Changes take effect immediately -- no reinstall needed.

---

## Start Your First Project From Scratch

1. Create a new folder for your project and navigate to it
2. Run `claude` to start Claude Code in that folder
3. Run `/new-repo` to bootstrap your project
4. Once complete, you'll have:
   - `TASKS.md` -- prioritized backlog
   - `CLAUDE.md` -- project context for agents
   - `docs/` -- documentation structure
5. Run `/code-workflow` to start building (it picks up the next task from TASKS.md and works through it)

---

## Onboard an Existing Project

Already have a project? Use `/onboard` to analyze your codebase and generate TASKS.md, CLAUDE.md, and documentation.

1. Navigate to your existing project folder
2. Run `claude` to start Claude Code
3. Run `/onboard` to start the onboarding pipeline
4. The system will analyze your codebase, check for compatibility, and generate your project infrastructure. You'll confirm at two checkpoints: after codebase analysis (findings, tech stack, compatibility), then after infrastructure generation (TASKS.md, CLAUDE.md, docs).
5. Once complete, run `/code-workflow` to start building

---

## Uninstall

**macOS / Linux:**

```bash
cd ~/path/to/reggie
./uninstall.sh
```

**Windows (PowerShell):**

```powershell
cd ~\path\to\reggie
.\uninstall.ps1
```

This removes the symlinks and restores your original files from the backup created during install.

---

That's it, you're using Reggie!

## Troubleshooting

**`/reggie-guide` shows nothing:** Your commands didn't symlink correctly. Re-run `./install.sh` from the repo directory, then restart Claude Code.

**GitHub operations fail:** Run `gh auth status` to verify GitHub CLI is authenticated. If not, run `gh auth login`.

**Commands work inconsistently:** Exit Claude Code completely and restart it. Claude reads `~/.claude/` when it launches.

---

## Helpful Tips

- **When in doubt, run `/reggie-guide`** -- Explores the full system and shows available commands
- **Read "Agents Is All You Need"** (`docs/agents-is-all-you-need.md`) for the technical and philosophical perspective on the system
