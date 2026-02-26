# Create Architecture Diagram

Use the visual-architect agent to visualize code architecture.

## Context

```bash
echo "=== Project Structure ==="
find . -type d -name "src" -o -name "app" -o -name "lib" -o -name "components" -o -name "features" 2>/dev/null | grep -v node_modules | head -20

echo ""
echo "=== Key Files ==="
find . -type f \( -name "*.ts" -o -name "*.tsx" -o -name "*.swift" -o -name "*.kt" \) 2>/dev/null | grep -v node_modules | grep -v .next | grep -E "(index|main|app|route|service|model)" | head -20
```

## Instructions

Use the **visual-architect** agent to create a diagram for: $ARGUMENTS

If no specific request, create a system architecture overview showing:
- Main components/modules
- Data flow between them
- External services/APIs

Output as Mermaid diagram that can be rendered in markdown.

Diagram types available:
- `flowchart` - User flows, processes
- `sequenceDiagram` - API calls, interactions over time
- `classDiagram` - Data models, relationships
- `erDiagram` - Database schema
- `stateDiagram` - UI states, workflows

