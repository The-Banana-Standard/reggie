# Debug Issue

Investigate and fix a bug or unexpected behavior.

## Context

```bash
echo "=== Recent Changes ==="
git log --oneline -10

echo ""
echo "=== Modified Files (uncommitted) ==="
git diff --name-only

echo ""
echo "=== Project Type ==="
if [ -f "package.json" ]; then echo "Node/JS project"; fi
if [ -f "Podfile" ]; then echo "iOS project"; fi
if [ -f "build.gradle" ]; then echo "Android project"; fi
if [ -f "firebase.json" ]; then echo "Firebase project"; fi
```

## Instructions

Debug the issue: $ARGUMENTS

### Process

1. **Reproduce** - Understand exactly what's failing
2. **Locate** - Find where the bug originates
3. **Understand** - Determine root cause (not just symptoms)
4. **Fix** - Implement minimal fix
5. **Verify** - Confirm fix works and doesn't break other things

### For Firebase Issues
Use the **firebase-debugger** agent if the issue involves:
- Cloud Functions
- Firestore
- Authentication
- FCM/Push notifications

### Output

```
## Bug Report

### Symptom
[What was happening]

### Root Cause
[Why it was happening]

### Fix
[What was changed]

### Verification
[How we confirmed it's fixed]
```

