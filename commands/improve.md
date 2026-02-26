# Improve

Process accumulated agent learnings and apply improvements to system agents, project agent memory, and command files.

## Context

```bash
echo "=== Agent Improve Status ==="
if [ -f ~/.claude/AGENT-IMPROVE.md ]; then
  TOTAL=$(grep -c "^## Entry:" ~/.claude/AGENT-IMPROVE.md 2>/dev/null || echo "0")
  MINOR=$(grep -c "Severity.*minor" ~/.claude/AGENT-IMPROVE.md 2>/dev/null || echo "0")
  MAJOR=$(grep -c "Severity.*major" ~/.claude/AGENT-IMPROVE.md 2>/dev/null || echo "0")
  echo "Total entries: $TOTAL"
  echo "Minor (auto-apply): $MINOR"
  echo "Major (needs approval): $MAJOR"
  echo ""
  echo "--- Classifications ---"
  grep "^\- \*\*Classification\*\*:" ~/.claude/AGENT-IMPROVE.md 2>/dev/null | sort | uniq -c | sort -rn
  echo ""
  echo "--- Affected Agents/Commands ---"
  grep "^\- \*\*Agent\*\*:" ~/.claude/AGENT-IMPROVE.md 2>/dev/null | sort | uniq -c | sort -rn
else
  echo "No AGENT-IMPROVE.md found — nothing to process"
fi

echo ""
echo "=== Recent Improve Runs ==="
if [ -f ~/.claude/IMPROVE-CHANGELOG.md ]; then
  grep "^## Run:" ~/.claude/IMPROVE-CHANGELOG.md | tail -5
else
  echo "No previous improve runs"
fi

echo ""
echo "=== Agent System Stats ==="
echo "System agents: $(ls ~/.claude/agents/ | wc -l | tr -d ' ')"
echo "Commands: $(ls ~/.claude/commands/ | wc -l | tr -d ' ')"
echo "Project agent memory: $(ls .claude/agent-memory/ 2>/dev/null | wc -l | tr -d ' ') agents"
echo "Project agent overrides: $(ls .claude/agents/ 2>/dev/null | wc -l | tr -d ' ') forks"
```

## Instructions

This command runs the **two-level improve pipeline** -- the agent self-improvement loop that processes accumulated learnings from pipeline runs and routes them to the correct targets: system agents (universal), project agent memory (project-specific), or commands (process changes).

**IMPORTANT**: You (the main Claude) orchestrate this pipeline directly. Do NOT launch the improve-pipeline-manager as a subagent -- subagents cannot launch other subagents. Instead, read `~/.claude/agents/improve-pipeline-manager.md` for detailed guidance, then run each stage yourself. Launch the **researcher** agent via the Task tool during ANALYZE. All other stages you execute directly. When launching any agent via Task, only use `model: "opus"` or `model: "sonnet"` — never `model: "haiku"`.

### When to Use

- Auto-triggered at the end of every pipeline (if AGENT-IMPROVE.md has entries)
- Manually via `/improve` to process accumulated learnings on demand
- `/improve --dry-run` to preview what would change without applying

### Arguments

```
/improve                    # Process all learnings
/improve --dry-run          # Show proposals without applying
/improve --minor-only       # Only process minor (auto-apply) changes
/improve --target [agent]   # Only process learnings for a specific agent
/improve --curate-only      # Only run the CURATE stage (memory maintenance)
$ARGUMENTS
```

### The Pipeline

```
COLLECT → CLASSIFY → ANALYZE → PROPOSE → APPLY → VERIFY → CURATE
```

No numeric quality gates. Uses confirmation-based gates (user approves major changes).

### Two-Level Routing

Learnings are classified and routed to different targets:

| Classification | Target | Location |
|---------------|--------|----------|
| UNIVERSAL | System agent files | `~/.claude/agents/*.md` |
| PROJECT | Project agent memory | `.claude/agent-memory/<agent>/MEMORY.md` |
| PROCESS | Command files | `~/.claude/commands/*.md` |
| FORK-CANDIDATE | Suggest project agent fork | `.claude/agents/<agent>.md` |

### Execution

Read `~/.claude/agents/improve-pipeline-manager.md` for full stage details, then execute each stage in sequence:

1. **COLLECT**: Parse `~/.claude/AGENT-IMPROVE.md`, group by target, print summary
2. **CLASSIFY**: Tag each learning as UNIVERSAL/PROJECT/PROCESS/FORK-CANDIDATE
3. **ANALYZE**: Launch **researcher** to filter, dedupe, categorize, prioritize, evaluate fork candidates
4. **PROPOSE**: Generate specific diffs for universal/process changes, memory entries for project changes, fork proposals with trade-off analysis
5. **APPLY**: Auto-apply minor changes and memory entries, present major changes and forks for approval
6. **VERIFY**: Validate all modified files (agents, commands, memory)
7. **CURATE**: Prune stale memory entries, consolidate duplicates, enforce 200-line limit

### Curate-Only Mode

If `--curate-only` in $ARGUMENTS:
- Skip COLLECT through VERIFY
- Run only the CURATE stage to maintain agent memory health
- Useful for periodic memory maintenance without new learnings

### Dry Run Mode

If `--dry-run` in $ARGUMENTS:
- Run COLLECT, CLASSIFY, and ANALYZE normally
- Run PROPOSE to generate diffs and memory entries
- Print all proposals but skip APPLY, VERIFY, and CURATE
- Do not modify any files or clear AGENT-IMPROVE.md

### Safety Rules

- Maximum 15 system agent/command changes per run (memory entries don't count)
- Never auto-modify YAML frontmatter
- Never auto-delete existing content
- Always log changes to `~/.claude/IMPROVE-CHANGELOG.md`
- If 3+ changes target the same file, pause for confirmation
- Files modified by improve within 24 hours get flagged for review
- Command file changes always require approval
- Fork proposals always require approval with full trade-off analysis
- Agent memory capped at 200 lines per file

### Workflow Controls

| Command | Action |
|---------|--------|
| `y` / `approve` | Approve a major change or fork |
| `n` / `skip` | Skip a change (stays in AGENT-IMPROVE.md) |
| `edit` | Modify proposed text before applying |
| `approve all` | Approve all remaining major changes |
| `skip all` | Skip all remaining major changes |
| `abort` | Stop processing, keep AGENT-IMPROVE.md intact |

