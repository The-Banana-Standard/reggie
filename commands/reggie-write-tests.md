# Write Tests

Use the qa-engineer agent to write tests for code.

## Context

```bash
echo "=== Recent Changes ==="
git diff --name-only HEAD~1 2>/dev/null | head -10

echo ""
echo "=== Test Config ==="
if [ -f "vitest.config.ts" ]; then echo "Vitest"; cat vitest.config.ts | head -10; fi
if [ -f "jest.config.js" ]; then echo "Jest"; cat jest.config.js | head -10; fi

echo ""
echo "=== Existing Test Patterns ==="
find . -type f \( -name "*.test.*" -o -name "*.spec.*" \) 2>/dev/null | grep -v node_modules | head -5 | xargs head -30 2>/dev/null
```

## Instructions

Use the **qa-engineer** agent to write tests for: $ARGUMENTS

If no specific target, write tests for recently changed files.

### Guidelines

1. Match existing test patterns in the codebase
2. Focus on behavior, not implementation
3. Cover:
   - Happy path
   - Edge cases (empty, null, max values)
   - Error handling
4. Use descriptive test names
5. Keep tests independent

### Output

```
## Tests Written

### [filename.test.ts]
- [test name]: [what it verifies]
- [test name]: [what it verifies]

### Run Command
npm test -- path/to/file.test.ts

### Coverage Notes
[What's covered, what's intentionally skipped]
```

