# Reggie

A structured collaboration system between a human and Claude. 37 agents, 34 commands, and a pipeline architecture with quality gates — all running on [Claude Code](https://docs.anthropic.com/en/docs/claude-code).

Reggie extends Claude Code from a single-agent tool into a coordinated multi-agent system with memory, self-improvement, and enforced quality standards.

See [REGGIE.md](REGGIE.md) for the full philosophy and principles.

---

## Install

```bash
git clone https://github.com/your-username/reggie.git
cd reggie
./install.sh
```

This symlinks `agents/` and `commands/` into `~/.claude/`, copies the stats hook, and backs up any existing files. Restart Claude Code after installing.

## What You Get

### 37 Agents

Specialized AI agents launched as subprocesses during pipeline execution:

- **Developers** (8): ios, android, web, typescript, go, python, cloud, firebase
- **Quality** (7): code-architect, judge, qa-engineer, app-tester, refactorer, code-reviewer, security-reviewer
- **Research** (5): researcher, thought-partner, claude-architect, feature-analyzer, codebase-debugger
- **Design** (2): design-innovator, visual-architect
- **Content** (4): content-producer, social-media-strategist, editor, technical-writer
- **Pipeline Managers** (10): orchestration reference docs for each workflow
- **Utilities** (1): repo-advisor

### 34 Commands

Slash commands that invoke pipelines or individual stages:

- **Workflows**: `/code-workflow`, `/audit-workflow`, `/design-workflow`, `/article-workflow`, `/new-repo`, `/onboard`, `/port`, `/debug-workflow`
- **Stages**: `/plan`, `/implement`, `/write-tests`, `/code-review`, `/review-security`, `/commit`
- **Utilities**: `/brainstorm`, `/research`, `/debug`, `/audit`, `/diagram`, `/status`, `/reggie-guide`
- **System**: `/improve`, `/evaluate-reggie`, `/reggie-system-change`

## Key Commands

| Command | What it does |
|---------|-------------|
| `/reggie-guide` | Help — shows all commands and topics |
| `/code-workflow` | Full feature dev pipeline (14 stages with quality gates) |
| `/brainstorm` | Think through an idea with a thought partner |
| `/init-tasks` | Turn a brain dump into structured tasks with acceptance criteria |
| `/status` | See current task and stage |

## How It Works

Every pipeline follows the same pattern:

1. A **slash command** starts a workflow (e.g., `/code-workflow`)
2. The main Claude reads the **pipeline manager** for stage guidance
3. At each stage, a **specialized agent** is launched via the Task tool
4. The **judge agent** scores the output (9.0/10 threshold to advance)
5. Quality gate pass = git commit checkpoint
6. If a stage fails: iterate with feedback → research → tournament → ask user

```
Your intent
  → RESEARCH (understand the problem)
  → PLAN (design the approach)
  → IMPLEMENT (build it)
  → TEST (verify it works)
  → REVIEW (code review + security)
  → COMMIT (checkpoint)
Your output
```

## Self-Improvement

Reggie improves itself. Every pipeline run can capture learnings. Run `/improve` to process them:

- Minor changes (common pitfalls, quality standards) auto-apply
- Major changes (process, role, tools) require approval
- All changes show as git diffs in the repo since agents/commands are symlinked

## Pulling Updates

```bash
cd ~/path/to/reggie
git pull
```

Since `~/.claude/agents/` and `~/.claude/commands/` are symlinks to the repo, updates take effect immediately.

## Uninstall

```bash
cd ~/path/to/reggie
./uninstall.sh
```

Restores your original agents/commands from the backup created during install.

## Documentation

- [REGGIE.md](REGGIE.md) — Philosophy and principles
- [docs/PORTABLE-PACKAGE.md](docs/PORTABLE-PACKAGE.md) — Full system reference
- [docs/reggie-quickstart.md](docs/reggie-quickstart.md) — Quick start guide
- [docs/agents-is-all-you-need.md](docs/agents-is-all-you-need.md) — Why agents over tools

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

MIT — see [LICENSE](LICENSE).
