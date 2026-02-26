# Commit with Doc Sync

Sync documentation and create a commit with everything.

## Context

```bash
echo "=== Staged Changes ==="
git diff --cached --stat

echo ""
echo "=== Diff Preview ==="
git diff --cached | head -150

echo ""
echo "=== Recent Commits (for style) ==="
git log --oneline -5

echo ""
echo "=== Existing Docs ==="
ls -la README.md CHANGELOG.md docs/ 2>/dev/null

echo ""
echo "=== Current CHANGELOG Head ==="
if [ -f "CHANGELOG.md" ]; then
  head -30 CHANGELOG.md
fi
```

## Instructions

Use the **technical-writer** agent for a three-step process:

### Step 1: Analyze Changes

Review the staged changes and identify:
- What type of change (feat, fix, refactor, etc.)
- What scope (which area of code)
- What docs might need updating

### Step 2: Update Docs

Based on the changes, update relevant documentation:

**Always consider:**
- CHANGELOG.md — Add entry under `[Unreleased]` section
- README.md — If new features or changed usage

**If applicable:**
- API docs — If endpoints/functions changed
- Code comments — If complex logic added

**Make the updates** — don't just suggest them.

After updating docs:
```bash
# Stage the doc changes
git add README.md CHANGELOG.md docs/ 2>/dev/null
```

### Step 3: Generate Commit Message

Write a conventional commit message covering both the code AND doc changes.

If docs were updated, the commit message should reflect the primary change (not "docs: update docs"):
```
feat(streaks): add streak tracking system

- Track consecutive days played
- Display streak count on home screen
- Add streak reminder notifications

Updated CHANGELOG.md and README.md
```

### Output Format

```
## Doc Updates

### CHANGELOG.md
Added under [Unreleased]:
- Added: Streak tracking system for daily play retention

### README.md  
Added to Features section:
- Streak tracking

(Changes staged)

---

## Commit Message

feat(streaks): add streak tracking system

Track consecutive days played with reminder notifications.

---

Commit with:
git commit -m "feat(streaks): add streak tracking system" -m "Track consecutive days played with reminder notifications."

Or run the commit? (y/n)
```

### Rules

1. **Don't over-document** — Not every change needs README updates
2. **CHANGELOG is almost always** — Any user-visible change should be logged
3. **Match existing style** — Read current docs before updating
4. **Stage docs before suggesting commit** — So they're included
5. **One commit** — Code + docs together, not separate commits

### When to Update What

| Change Type | CHANGELOG | README | API Docs |
|-------------|-----------|--------|----------|
| New feature | ✓ | Maybe | If API |
| Bug fix | ✓ | Rarely | If API changed |
| Refactor | Maybe | No | No |
| Performance | ✓ | No | No |
| Breaking change | ✓ | ✓ | ✓ |

### CHANGELOG Entry Format

Add under `## [Unreleased]` at the top:

```markdown
### Added
- Streak tracking to encourage daily engagement

### Fixed  
- Color rendering on Android 14 devices
```

If `[Unreleased]` section doesn't exist, create it.

