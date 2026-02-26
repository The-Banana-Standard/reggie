# Code Review

Run a thorough code review on the current task's changes.

## Context

```bash
echo "=== Current Task ==="
if [ -f "TASKS.md" ]; then
  cat TASKS.md
fi

echo ""
echo "=== Changed Files ==="
git diff --name-only HEAD~1 2>/dev/null || git diff --name-only --cached 2>/dev/null || echo "No changes detected"

echo ""
echo "=== Diff Stats ==="
git diff --stat HEAD~1 2>/dev/null || git diff --stat --cached 2>/dev/null || echo "No diff available"
```

## Instructions

Use the **code-reviewer** agent to review the changes made in the current pipeline task.

### What Gets Reviewed

This reviews the **current task's diff only** — not the whole codebase. The reviewer:

1. Reads every changed file in full (for context)
2. Examines every changed line
3. Checks cross-file interactions
4. Verifies compliance with the architect's plan
5. Identifies edge cases the tests may have missed

### Review Criteria

- **Bugs**: Off-by-one errors, null risks, race conditions, logic errors
- **Edge cases**: Empty inputs, max values, concurrent access, malformed data
- **Error handling**: Caught at right level, useful messages, proper recovery
- **Performance**: N+1 queries, unnecessary re-renders, blocking operations
- **Plan compliance**: Does implementation match the architect's specification?
- **Readability**: Clear naming, reasonable complexity, consistent patterns

### Quality Gate

The review is scored by the judge agent (9.0/10 to advance). If it fails:
- BLOCKER findings must be fixed
- Review runs again after fixes
- Standard escalation: iterate → researcher → auto-tournament → user

### Verdict

- **PASS**: No blockers. Advances to `/review-security`.
- **FAIL**: Blockers listed with specific file:line references and suggested fixes. Goes back to IMPLEMENT.

### Usage

```
/code-review                # Review current task's changes
/code-review $ARGUMENTS     # Review with specific focus
```

### After Review

If PASS:
```
Code review passed. Proceeding to security review.
Run: /review-security
```

If FAIL:
```
Code review found [N] blockers:
- [file:line]: [issue]

Fix these and re-run /code-review.
```

