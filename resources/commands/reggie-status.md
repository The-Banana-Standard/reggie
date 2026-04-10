# Project Status

Quick check on all active tasks and progress.

## Context

```bash
echo "=== Active Tasks ==="
if [ -f "TASKS.md" ]; then
  cat TASKS.md
else
  echo "No TASKS.md found"
fi

echo ""
echo "=== Completed Tasks ==="
if [ -f "HISTORY.md" ]; then
  cat HISTORY.md
else
  echo "No HISTORY.md found"
fi

echo ""
echo "=== Pipeline Directories ==="
if [ -d ".pipeline" ]; then
  ls -la .pipeline/ 2>/dev/null
  echo ""
  echo "=== Stage Files ==="
  for d in .pipeline/*/; do
    if [ -f "${d}STAGE" ]; then
      echo "  $(basename $d): $(cat ${d}STAGE)"
    fi
  done
else
  echo "No .pipeline/ directory"
fi
```

## Instructions

Use the **reggie-code-manager** agent to report:

1. **All active tasks** with their current stage and pipeline
   - Read stage from `.pipeline/[slug]/STAGE` file for each active task (most reliable source)
   - Fall back to TASKS.md `**Stage**` field if STAGE file doesn't exist
2. What's next for each active task
3. How many tasks in backlog (with priority breakdown: P1/P2/P3)
4. How many completed tasks (from HISTORY.md if it exists)
5. Any potential file conflicts between active tasks
6. How many backlog tasks are blocked by dependencies

### Output Format

```
Active Tasks:
  1. [slug] — [task name] — Stage: [STAGE] ([pipeline])
  2. [slug] — [task name] — Stage: [STAGE] ([pipeline])

Backlog: [N] tasks in [M sections] ([N] P1, [N] P2, [N] P3)
  Ready: [N] tasks (no blockers)
  Blocked: [N] tasks (waiting on dependencies)
Completed: [N] tasks (from HISTORY.md)

[If file conflicts exist between active tasks, note them]
```

Keep it brief — this is a status check, not a planning session.

If no TASKS.md exists, offer to create one.

### Capability Context (optional)

If `.claude/stats.json` exists and contains `capability_runs` or `tool_searches`, append a brief capability section:

```
Capability Context:
  Orchestrator: [N] deferred tools, [N] plugins, [N] MCP servers
  Last pipeline ([slug]):
    [N] agent launches, [N] with MCP routing ([server names])
    Highest context: [agent] ([tier] — [reason])
  ToolSearch hits (last 30 days): [server] [N]x, [server] [N]x
```

Only show this section if capability data exists. Skip entirely for projects with no pipeline runs or no MCP configuration.

