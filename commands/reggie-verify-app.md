# Verify Changes Work

Use the app-tester agent to test that recent changes actually work.

## Context

```bash
echo "=== Changed Files ==="
git diff --name-only HEAD~1 2>/dev/null || git diff --name-only

echo ""
echo "=== Available Test Commands ==="
cat package.json 2>/dev/null | grep -E '"test|"lint|"typecheck|"build' | head -10 || echo "No package.json"

echo ""
echo "=== Dev Server Command ==="
cat package.json 2>/dev/null | grep -E '"dev|"start' | head -5
```

## Instructions

Use the **app-tester** agent to verify the recent changes.

1. Run available test commands (test, typecheck, lint, build)
2. If this is a web app, start the dev server and test affected user flows
3. Verify both happy path and error cases
4. Check for regressions in related features

Provide a verification report with:
- Test results (pass/fail)
- Any issues found
- Specific fix instructions for failures

Do not mark as complete until verification passes.

