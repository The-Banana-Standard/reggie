# Audit Codebase

Analyze a codebase to understand it and find areas for improvement.

## Context

```bash
echo "=== Project Root ==="
pwd

echo ""
echo "=== Project Files ==="
find . -maxdepth 2 -type f \( -name "*.json" -o -name "*.md" -o -name "*.swift" -o -name "*.kt" -o -name "*.ts" \) 2>/dev/null | grep -v node_modules | grep -v .next | head -30

echo ""
echo "=== Package Info ==="
if [ -f "package.json" ]; then
  cat package.json | head -20
fi

echo ""
echo "=== README Preview ==="
if [ -f "README.md" ]; then
  head -30 README.md
fi

echo ""
echo "=== Git Status ==="
git log --oneline -5 2>/dev/null
```

## Instructions

Use the **researcher** agent to analyze this codebase.

### Audit Modes

**No arguments** → Full audit
```
/reggie-audit
```

**With focus area** → Targeted audit
```
/reggie-audit security      → Security-focused review
/reggie-audit tests         → Test coverage and quality
/reggie-audit architecture  → Structural issues
/reggie-audit deps          → Dependency health
/reggie-audit performance   → Performance concerns
/reggie-audit quality       → Code quality issues
/reggie-audit orientation   → Just help me understand this codebase
```

### For $ARGUMENTS:

- If empty or "full": Run comprehensive audit
- If "orientation" or "overview": Quick orientation only
- If specific area: Focus audit on that area

### Output

For full audit, provide:
1. Executive summary with health score
2. Critical issues (🔴)
3. Technical debt (🟡)
4. Improvement opportunities (🟢)
5. Prioritized recommendations
6. Quick wins list

For orientation, provide:
1. What the project is
2. Tech stack
3. Structure overview
4. Key files to understand
5. Patterns used

### Follow-up

After audit, offer:
```
Want me to:
1. Add these findings to TASKS.md backlog?
2. Deep-dive on a specific issue?
3. Create a plan to address [top priority]?
```

