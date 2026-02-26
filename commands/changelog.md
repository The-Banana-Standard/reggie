# Update Changelog

Generate a changelog entry for recent changes.

## Context

```bash
echo "=== Last Tag ==="
git describe --tags --abbrev=0 2>/dev/null || echo "No tags found"

echo ""
echo "=== Commits Since Last Tag ==="
LAST_TAG=$(git describe --tags --abbrev=0 2>/dev/null)
if [ -n "$LAST_TAG" ]; then
  git log --oneline $LAST_TAG..HEAD
else
  git log --oneline -20
fi

echo ""
echo "=== Current Changelog ==="
if [ -f "CHANGELOG.md" ]; then
  head -40 CHANGELOG.md
else
  echo "No CHANGELOG.md found"
fi
```

## Instructions

Use the **technical-writer** agent to generate a changelog entry.

1. Review commits since last tag (or last changelog entry)
2. Group changes by type:
   - Added
   - Changed
   - Fixed
   - Removed
   - Security
3. Write human-readable descriptions (not just commit messages)
4. Format per Keep a Changelog standard

If $ARGUMENTS contains a version number, use it. Otherwise ask:
```
What version is this release? (e.g., 1.2.0)
```

Output format:
```
## [1.2.0] - 2024-02-03

### Added
- Streak tracking to encourage daily play
- Push notification reminders for at-risk streaks

### Fixed
- Color rendering on Android devices with wide gamut displays

---
Add this to CHANGELOG.md?
```

