# Fix Failing Tests

Use the qa-engineer agent to run tests and fix any failures.

## Context

```bash
echo "=== Test Command ==="
cat package.json 2>/dev/null | grep -E '"test' | head -5

echo ""
echo "=== Test Files ==="
find . -type f \( -name "*.test.*" -o -name "*.spec.*" -o -name "*_test.*" \) 2>/dev/null | grep -v node_modules | head -20
```

## Instructions

Use the **qa-engineer** agent to fix the failing tests.

1. Run the test suite
2. For each failure:
   - Understand what the test expects
   - Determine if the test or the code is wrong
   - Fix the appropriate one
3. Re-run tests to confirm fix
4. Repeat until all tests pass

### Rules

- If test is outdated (tests old behavior), update the test
- If code is buggy (doesn't match intended behavior), fix the code
- If test is flaky (intermittent failures), make it deterministic
- Never delete tests just to make the suite pass

### Output

```
## Test Fix Report

### Initial State
X tests failing

### Fixes Applied
1. [test name]: [what was wrong] → [how fixed]

### Final State
All tests passing ✅
```

