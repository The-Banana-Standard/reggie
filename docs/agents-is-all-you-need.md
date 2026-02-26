# Agents Is All You Need

Why Reggie uses markdown agent files instead of a framework, SDK, or custom tooling.

## The Insight

Claude Code already has everything you need for a multi-agent system:

- **Task tool** launches subprocesses with isolated context
- **Markdown files** in `~/.claude/agents/` become launchable agents
- **YAML frontmatter** controls tools, model, and description
- **Slash commands** in `~/.claude/commands/` become invocable workflows

No framework needed. No package manager. No API. Just markdown files and conventions.

## How It Works

When you write a markdown file in `~/.claude/agents/` with the right frontmatter:

```yaml
---
name: my-agent
description: "When to use this agent..."
tools: Glob, Grep, Read, Edit, Write, Bash
model: opus
---
```

Claude Code registers it as a launchable agent. The main Claude can invoke it via the Task tool, passing a prompt and receiving structured output.

## Why Markdown Over Code

### 1. Zero dependencies
No runtime, no build step, no package installs. Copy two directories and restart Claude Code.

### 2. Instantly editable
Change an agent's behavior by editing a markdown file. No recompilation, no redeployment. Changes take effect on the next invocation.

### 3. Version controlled
Every change to every agent shows as a git diff. Review prompt changes the same way you review code changes.

### 4. Self-improving
The `/improve` pipeline can edit agent files programmatically. The system literally rewrites itself based on what it learns from pipeline runs.

### 5. Portable
`~/.claude/agents/` and `~/.claude/commands/` are the entire system. Symlink them from a git repo and you have version control, collaboration, and easy updates.

## The Architecture

```
User intent
    ↓
Slash command (commands/*.md)
    ↓
Main Claude reads pipeline manager (agents/*-manager.md)
    ↓
Main Claude launches specialized agents (agents/*.md) via Task tool
    ↓
Judge agent scores output (9.0/10 threshold)
    ↓
Quality gate pass → git commit → next stage
```

Pipeline managers are reference documents, not running processes. The main Claude orchestrates everything. Agents are stateless subprocesses that receive context and return structured output.

## Limitations

- Subagents can't launch other subagents (one level deep)
- Agent context is limited to what's passed in the prompt
- No persistent state between agent invocations (memory files bridge this)

These are acceptable tradeoffs. The simplicity of the system outweighs the constraints.

## The Bottom Line

If you have Claude Code, you have a multi-agent system. You just need to write the agent files.
