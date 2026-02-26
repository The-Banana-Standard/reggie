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
```

## Instructions

Sync all project documentation to reflect the current state of the code. This command is used both as a standalone utility and as the SYNC-DOCS stage in `/code-workflow`.

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

**CHANGELOG.md** — If it exists, add entries for user-facing changes (use `/changelog` for detailed changelog work)

### What NOT to Do

- Don't create new documentation files — only update existing ones
- Don't add docs for internal implementation details unless they already have docs
- Don't update docs that weren't affected by recent changes
- If no documentation updates are needed, confirm "Documentation is in sync"

### Output Format

```
## Documentation Sync

### Changes Detected
- [Code change 1] → affects [doc]
- [Code change 2] → affects [doc]

### Updates Applied
- `CLAUDE.md`: Updated Commands section (new test command)
- `docs/api.md`: Added POST /users endpoint

### No Updates Needed
- `README.md`: Still accurate
```

$ARGUMENTS

