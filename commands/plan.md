# Plan Feature Implementation

Use the code-architect agent to create a technical plan before coding.

## Context

```bash
echo "=== Project Structure ==="
find . -type f -name "*.ts" -o -name "*.tsx" -o -name "*.js" -o -name "*.jsx" -o -name "*.swift" -o -name "*.kt" 2>/dev/null | grep -v node_modules | grep -v .next | head -30

echo ""
echo "=== Package Info ==="
cat package.json 2>/dev/null | grep -A 5 '"name"\|"dependencies"' | head -20 || echo "No package.json"
```

## Instructions

Use the **code-architect** agent to create a technical plan for: $ARGUMENTS

The plan should include:
1. Overview of what we're building
2. Components/files that need to be created or modified
3. Data flow and state management approach
4. Dependencies needed (if any)
5. Implementation phases (ordered steps)
6. Potential risks or edge cases

Do NOT start implementation. Output only the plan for review.

