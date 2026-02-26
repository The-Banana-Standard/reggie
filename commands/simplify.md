# Simplify Recent Changes

Use the refactorer agent to clean up code after implementation.

## Context

```bash
echo "=== Changed Files ==="
git diff --name-only HEAD~1 2>/dev/null || git diff --name-only --cached

echo ""
echo "=== Diff Stats ==="
git diff --stat HEAD~1 2>/dev/null || git diff --stat --cached
```

## Instructions

Use the **refactorer** agent to review and simplify the changed files listed above.

Focus on:
- Removing dead code and unused imports
- Consolidating duplicate logic
- Flattening nested conditionals
- Improving naming for clarity
- Removing unnecessary comments

Run tests after each change to ensure nothing breaks.

Provide a summary of simplifications made and lines saved.

