# Reggie Quick Start

Get up and running in 5 minutes.

## Prerequisites

- [Claude Code](https://docs.anthropic.com/en/docs/claude-code) installed and authenticated
- `~/.claude/` directory exists (created automatically on first Claude Code run)

## Install

```bash
git clone https://github.com/your-username/reggie.git
cd reggie
./install.sh
```

Restart Claude Code after installing.

## Verify

```
/reggie-guide
```

If you see the command reference, you're set.

## First Steps

### 1. Explore the system

```
/reggie-guide agents
/reggie-guide pipelines
/reggie-guide which command
```

### 2. Start a project

```
/new-repo
```

This walks you through brainstorming, scaffolding, and pushing a new repo.

### 3. Work on features

```
/init-tasks          # Break work into tasks with acceptance criteria
/code-workflow       # Full pipeline: research → plan → implement → review → commit
```

### 4. Write content

```
/brainstorm          # Think through an idea
/article-workflow    # Write a technical article
```

## Key Concepts

- **Pipelines** are multi-stage workflows with quality gates between every stage
- **Agents** are specialized AI subprocesses (you never invoke them directly)
- **Quality gates** score outputs at 9.0/10 to advance — failures auto-escalate
- **Commands** start pipelines or run individual stages

## Common Workflows

| I want to... | Command |
|--------------|---------|
| Build a feature | `/code-workflow` |
| Fix a bug | `/debug-workflow` |
| Audit a codebase | `/audit-workflow` |
| Write an article | `/article-workflow` |
| Start a new project | `/new-repo` |
| Brainstorm an idea | `/brainstorm` |

See `/reggie-guide` for the full reference.
