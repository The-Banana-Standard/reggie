# Repo Advisor

Evaluate this repository's readiness for the Claude Code agent system.

## Context

```bash
echo "=== Project Root ==="
pwd

echo ""
echo "=== Infrastructure Check ==="
[ -f "CLAUDE.md" ] && echo "CLAUDE.md: EXISTS ($(wc -l < CLAUDE.md | tr -d ' ') lines)" || echo "CLAUDE.md: NOT FOUND"
[ -f "TASKS.md" ] && echo "TASKS.md: EXISTS ($(wc -l < TASKS.md | tr -d ' ') lines)" || echo "TASKS.md: NOT FOUND"
[ -f "HISTORY.md" ] && echo "HISTORY.md: EXISTS" || echo "HISTORY.md: NOT FOUND"
[ -d ".pipeline" ] && echo ".pipeline/: EXISTS ($(ls .pipeline/ 2>/dev/null | wc -l | tr -d ' ') subdirs)" || echo ".pipeline/: NOT FOUND"

echo ""
echo "=== Agent Infrastructure ==="
[ -d ".claude/agent-memory" ] && echo "Agent memory: EXISTS ($(ls .claude/agent-memory/ 2>/dev/null | wc -l | tr -d ' ') agents)" || echo "Agent memory: NOT FOUND"
[ -d ".claude/research-cache" ] && echo "Research cache: EXISTS ($(ls .claude/research-cache/ 2>/dev/null | wc -l | tr -d ' ') entries)" || echo "Research cache: NOT FOUND"
[ -f ".claude/stats.json" ] && echo "Stats: EXISTS ($(wc -c < .claude/stats.json | tr -d ' ') bytes)" || echo "Stats: NOT FOUND"

echo ""
echo "=== Git Status ==="
git remote -v 2>/dev/null | head -2 || echo "Not a git repo"
git log --oneline -3 2>/dev/null || echo "No commits"

echo ""
echo "=== CLAUDE.md Preview ==="
if [ -f "CLAUDE.md" ]; then
  head -40 CLAUDE.md
fi

echo ""
echo "=== CLAUDE.md Sections ==="
if [ -f "CLAUDE.md" ]; then
  grep -E "^##" CLAUDE.md 2>/dev/null || echo "No sections found"
fi

echo ""
echo "=== Stats Summary ==="
if [ -f ".claude/stats.json" ]; then
  if command -v jq &> /dev/null; then
    jq -r 'keys[] as $k | "\($k): \(.[$k] | length // .[$k])"' .claude/stats.json 2>/dev/null | head -15 || cat .claude/stats.json | head -20
  else
    cat .claude/stats.json | head -30
  fi
else
  echo "No stats file"
fi

echo ""
echo "=== TASKS.md Summary ==="
if [ -f "TASKS.md" ]; then
  echo "Backlog items: $(grep -c '^\- \[ \]' TASKS.md 2>/dev/null || echo 0)"
  echo "Active tasks: $(grep -c '^### ' TASKS.md 2>/dev/null || echo 0)"
  echo "Sections:"
  grep -E "^### " TASKS.md 2>/dev/null | head -10 || echo "No sections"
fi

echo ""
echo "=== Directory Structure ==="
find . -type d -maxdepth 2 | grep -v node_modules | grep -v .git | grep -v .worktree | head -30

echo ""
echo "=== Documentation Files ==="
find . -name "*.md" -maxdepth 2 2>/dev/null | grep -v node_modules | grep -v .git | sort
```

## Instructions

Use the **repo-advisor** agent to evaluate this repository's agent-readiness.

### Modes

**No arguments** -> Full assessment (or drift if agent has previous memory for this project)
```
/repo-advisor
```

**With mode** -> Specific assessment type
```
/repo-advisor full     -> Complete infrastructure + config quality + stats analysis
/repo-advisor quick    -> Fast infrastructure existence check only
/repo-advisor drift    -> Compare to previous assessment (requires prior run)
```

### For $ARGUMENTS:

- If empty: Let the agent decide based on memory state (drift if memory exists, full otherwise)
- If "full": Force full assessment even if memory exists
- If "quick": Fast check, infrastructure existence only
- If "drift": Force drift comparison (warns if no previous memory exists)

### Boundary

This command evaluates **this PROJECT's readiness for agents**. It answers: "Is this repo set up well for Claude Code?"

It does NOT evaluate the agent system itself. For that, use `/evaluate-reggie` which answers: "Is ~/.claude/ healthy?"

### Output

The repo-advisor is conversational. Expect prose, not tables. Every finding comes with a prescription -- the specific `/command` to fix it.

### Follow-up

After assessment, the natural next steps are usually one of:
- `/onboard` -- if the project lacks basic infrastructure
- `/update-claude` -- if CLAUDE.md exists but needs improvement
- `/init-tasks` -- if there's no task tracking
- `/audit` -- if infrastructure is fine but code health is unknown

