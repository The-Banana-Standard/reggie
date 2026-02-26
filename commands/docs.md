# Write Documentation

Generate or update documentation.

## Context

```bash
echo "=== Existing Docs ==="
ls -la *.md README* CHANGELOG* docs/ 2>/dev/null | head -20

echo ""
echo "=== Project Structure ==="
find . -type f \( -name "*.ts" -o -name "*.tsx" -o -name "*.swift" -o -name "*.kt" \) 2>/dev/null | grep -v node_modules | grep -v .next | head -20
```

## Instructions

Use the **technical-writer** agent to create documentation for: $ARGUMENTS

If no specific target given, ask:
```
What would you like to document?
1. README — project overview and setup
2. API — endpoint documentation  
3. Feature — how something works
4. Guide — how to do something
5. Other — describe what you need
```

Match existing documentation style if present.

Output the complete document, ready to save.

