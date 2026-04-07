# Sync Docs

Sync project documentation with recent code changes.

## Context

```bash
echo "=== Recent Changes ==="
git diff --stat HEAD~5 2>/dev/null || echo "No git history"
echo ""
git log -5 --oneline 2>/dev/null || echo "No commits"

echo ""
echo "=== Documentation Files ==="
find . -maxdepth 3 -name "*.md" -not -path "./.git/*" -not -path "./.worktree/*" -not -path "./.pipeline/*" -not -path "./node_modules/*" 2>/dev/null | head -30

echo ""
echo "=== Project Type ==="
if [ -f "CLAUDE.md" ]; then echo "CLAUDE.md: exists"; else echo "CLAUDE.md: missing"; fi
if [ -d "docs/" ]; then echo "docs/: exists"; ls docs/ 2>/dev/null; else echo "docs/: missing"; fi
if [ -f "README.md" ]; then echo "README.md: exists"; fi
if [ -f "CHANGELOG.md" ]; then echo "CHANGELOG.md: exists"; fi

echo ""
echo "=== Foundational Docs ==="
for doc in architecture.md patterns.md styling-guide.md data-models.md getting-started.md contributing.md; do
  if [ -f "docs/$doc" ]; then echo "docs/$doc: exists"; else echo "docs/$doc: MISSING"; fi
done
```

## Instructions

Sync all project documentation to reflect the current state of the code. This command is used both as a standalone utility and as the SYNC-DOCS stage in `/reggie-code-workflow`.

### Process

1. **Detect what changed**: Review `git diff` and recent commits to understand what code changed
2. **Identify affected documentation**: Map code changes to the docs they affect using the table below
3. **Read each affected doc**: Compare current documentation against the actual code
4. **Update or flag**: Fix inaccuracies directly, or flag docs that need human attention

### What Code Changes Affect Which Docs

| Code Change | Check These Docs |
|-------------|-----------------|
| New/modified API endpoint | API reference, README (if it lists endpoints) |
| Database schema change | Schema docs, data model docs |
| New environment variable | CLAUDE.md, README (setup section), .env.example |
| Config file change | Setup/installation docs |
| New dependency added | README (prerequisites), setup docs |
| UI component added/changed | Component docs, storybook, design system docs |
| CLI command added/changed | README (usage section), man pages |
| Auth/permissions change | Security docs, API docs (auth section) |
| Build/test command change | CLAUDE.md (Commands section), CI docs, README |
| New feature | README (features section), user-facing docs |
| Breaking change | CHANGELOG.md, migration guides |

### What to Update

**CLAUDE.md** — The most important doc. Update:
- Commands section if build/test/run commands changed
- Architecture section if structure changed
- Key Files table if important files were added/moved
- Rules section if new conventions were established
- Patterns section if new code patterns were introduced

**README.md** — Update:
- Feature descriptions if functionality changed
- Setup instructions if dependencies/config changed
- Usage examples if API/CLI changed

**API/Schema docs** — Update:
- Endpoint signatures, request/response schemas
- Database field types, relationships, indices
- Authentication requirements

**CHANGELOG.md** — If it exists, add entries for user-facing changes (use `/reggie-changelog` for detailed changelog work)

**docs/architecture.md** (if exists) — Update:
- Module boundaries if new services/components added
- Data flow if routing or data pipeline changed
- External dependencies if new integrations added
- Key decisions table if architectural choices were made

**docs/patterns.md** (if exists) — Update:
- Naming conventions if new patterns were introduced
- Approved patterns section if new abstractions were standardized
- Anti-patterns section if gotchas were discovered during implementation
- Testing conventions if test approach changed

**docs/data-models.md** (if exists) — Update:
- Model definitions if database schema changed
- API contracts if endpoint signatures changed
- Relationships if foreign keys or references were added/modified
- Constraints if validation rules changed

**docs/styling-guide.md** (if exists) — Update:
- Color palette if new colors were introduced
- Component patterns if new UI components were added
- Typography or spacing if design tokens changed
- Animation patterns if new transitions were added

**docs/getting-started.md** (if exists) — Update:
- Prerequisites if new dependencies were added
- Setup steps if environment configuration changed
- Common issues table if new gotchas were discovered

**docs/contributing.md** (if exists) — Update:
- Branch conventions if workflow changed
- Code standards if new conventions were established

### Missing Foundational Docs

If foundational docs are missing but the project is mature enough to warrant them, flag the gap and offer to create them. Use these heuristics:

| Doc | Create when... |
|-----|---------------|
| `docs/architecture.md` | Always (every project has structure) |
| `docs/patterns.md` | Project has 3+ source files in the same language |
| `docs/styling-guide.md` | Project has UI (HTML/CSS/SwiftUI/Compose/React detected) |
| `docs/data-models.md` | Project has a database, API layer, or typed models |
| `docs/getting-started.md` | Always |
| `docs/contributing.md` | Always |

**Process for missing docs:**
1. Identify which foundational docs are missing
2. For each missing doc, analyze the codebase to determine if it should exist
3. If it should exist, present what you would populate it with (summary, not full doc)
4. Ask the user: "Create [doc]? (y/n)"
5. Only create with user approval
6. Use the templates from `onboard-pipeline-manager.md` (Foundational Doc Templates section)

### What NOT to Do

- Don't create arbitrary new documentation files — only foundational docs listed above
- Don't add docs for internal implementation details unless they already have docs
- Don't update docs that weren't affected by recent changes
- Don't create foundational docs without user approval (flag and ask)
- If no documentation updates are needed, confirm "Documentation is in sync"

### Output Format

```
## Documentation Sync

### Changes Detected
- [Code change 1] → affects [doc]
- [Code change 2] → affects [doc]

### Updates Applied
- `CLAUDE.md`: Updated Commands section (new test command)
- `docs/architecture.md`: Added new service component
- `docs/patterns.md`: Added error handling convention

### Missing Foundational Docs
- `docs/styling-guide.md` — MISSING (project has 45 HTML files with CSS)
  - Would document: color palette, typography scale, component patterns
  - Create? (awaiting user approval)

### No Updates Needed
- `README.md`: Still accurate
- `docs/contributing.md`: Still accurate
```

$ARGUMENTS

