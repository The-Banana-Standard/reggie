---
title: "Reggie: Quickstart Guide"
description: "From zip folder to automated workflow in minutes"
date: "2026-02-05"
status: published
tags: [Reggie, How-To, Agentic Engineering]
---

# Reggie: Quickstart Guide

Congrats! You just received Reggie. Unzip the folder and follow the steps below to get started.

## What's Inside?

- **agents/** -- 41 specialized AI agents
- **commands/** -- 41 slash commands, including 11 pipeline commands
- **portable-package/** -- System documentation and reference guides
- **reggie.md** -- System architecture and philosophy overview
- **AGENT-IMPROVE.md** -- Learnings accumulator for the improve pipeline
- **hooks/** -- Post-task hooks for tracking and automation
- **all_you_need_is_agents.md** -- Article for deeper understanding

---

## Prerequisites

You need two things already set up:

1. **Claude Code CLI** -- installed and authenticated
2. **GitHub CLI (gh)** -- authenticated with your GitHub account (for repo operations and branch management)

If you need help with either, check out the [Claude Code CLI](https://code.claude.com/docs/en/overview) or [GitHub CLI](https://cli.github.com/) documentation.

---

## Install

1. Navigate to this folder in your terminal:

   ```bash
   cd ~/Downloads/Reggie
   ```

2. Copy the system files to your Claude config:

   ```bash
   cp -r agents/ ~/.claude/agents/
   cp -r commands/ ~/.claude/commands/
   cp -r portable-package/ ~/.claude/
   cp reggie.md ~/.claude/
   cp AGENT-IMPROVE.md ~/.claude/
   cp -r hooks/ ~/.claude/hooks/
   ```

3. Verify the installation:

   ```bash
   claude
   /reggie-guide
   ```

   If the command loads the guide, your installation succeeded. If Claude Code was already running when you installed, exit and restart it to pick up the new commands.

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

That's it, you're using Reggie!

## Troubleshooting

**`/reggie-guide` shows nothing:** Your commands folder didn't copy correctly. Re-run `cp -r commands/ ~/.claude/commands/`, then exit and restart Claude Code.

**GitHub operations fail:** Run `gh auth status` to verify GitHub CLI is authenticated. If not, run `gh auth login`.

**Commands work inconsistently:** Exit Claude Code completely and restart it. Claude reads `~/.claude/` when it launches, not when commands are copied.

---

## Helpful Tips

- **When in doubt, run `/reggie-guide`** -- Explores the full system and shows available commands
- **Read "All You Need Is Agents"** (`all_you_need_is_agents.md`) for the technical and philosophical perspective on the system
