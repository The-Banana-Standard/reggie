# Implement

Execute a plan using the appropriate dev agent.

## Context

```bash
echo "=== Active Tasks ==="
if [ -f "TASKS.md" ]; then
  cat TASKS.md
fi

echo ""
echo "=== Pipeline Directories ==="
if [ -d ".pipeline" ]; then
  for dir in .pipeline/*/; do
    echo "--- $dir ---"
    ls "$dir" 2>/dev/null
  done
else
  echo "No .pipeline/ directory"
fi

echo ""
echo "=== Recent Plan Files ==="
find . -name "*.plan.md" -o -name "*plan*.md" -o -name "PLAN.md" 2>/dev/null | head -5

echo ""
echo "=== Project Type Detection ==="
if [ -d "ios" ] || [ -f "*.xcodeproj" ] || [ -f "Package.swift" ]; then
  echo "iOS project detected"
fi
if [ -d "android" ] || [ -f "build.gradle" ] || [ -f "build.gradle.kts" ]; then
  echo "Android project detected"
fi
if [ -f "package.json" ]; then
  echo "Web/Node project detected"
fi
if [ -d "functions" ]; then
  echo "Firebase Functions detected"
fi
```

## Instructions

Hand off the current plan to a dev agent for implementation.

### Step 1: Identify the Plan

Look for the plan in this order:
1. Recent conversation (if just completed planning)
2. `.pipeline/[slug]/CONTEXT.md` (contains the architecture plan from PLAN stage)
3. `.pipeline/[slug]/HANDOFF.md` (if context was compacted)
4. *.plan.md files
5. TASKS.md active task notes

If no plan found:
```
No plan found. Either:
1. Run /plan first to create one
2. Describe what to implement
```

### Step 2: Select Dev Agent

If agent specified in $ARGUMENTS, use that:
```
/implement ios        → ios-developer
/implement android    → android-developer  
/implement web        → web-developer
/implement firebase   → firebase-debugger
```

If not specified, auto-detect from:
- Plan mentions (SwiftUI → ios-developer, Compose → android-developer)
- Files to modify (.swift → ios-developer, .kt → android-developer, .tsx → web-developer)
- Project structure

If ambiguous, ask:
```
This plan touches multiple platforms. Which to implement first?
1. ios-developer — SwiftUI/iOS
2. android-developer — Kotlin/Android
3. web-developer — React/Next.js
4. firebase-debugger — Cloud Functions
```

### Step 3: Hand Off to Agent

Invoke the selected agent with clear instructions:

```
Use the **[agent-name]** agent to implement this plan:

## Task
[Task name from TASKS.md or plan]

## Plan Summary
[Condensed version of the plan]

## Files to Create/Modify
- [file list from plan]

## Approach
1. [Step 1]
2. [Step 2]
3. [Step 3]

## Key Decisions
- [Decisions made during planning]

## Watch Out For
- [Gotchas identified during planning]

---

Start with: [First file or step]
```

### Step 4: Update Task Stage

After handoff, update TASKS.md to CODE stage if not already:
```bash
# Note: pipeline-manager agent handles this
```

### Examples

```
/implement
→ Auto-detect platform, use plan from conversation

/implement ios
→ Use ios-developer agent with current plan

/implement android streak feature
→ Use android-developer agent, find streak feature plan

/implement firebase
→ Use firebase-debugger for Cloud Functions work
```

### Agent Selection Reference

| Keyword | Agent | Use For |
|---------|-------|---------|
| ios, swift, swiftui | ios-developer | iOS app code |
| android, kotlin, compose | android-developer | Android app code |
| web, react, next, frontend | web-developer | Web app code |
| firebase, functions, firestore | firebase-debugger | Backend/Cloud Functions |

### Multi-Platform Plans

If the plan spans multiple platforms:
```
This plan has work for multiple platforms:
- iOS: User model, StreakService, HomeView
- Firebase: Streak notification function

Implement one at a time. Starting with which?
1. ios-developer (client-side first)
2. firebase-debugger (backend first)
```

After one completes, prompt:
```
iOS implementation complete.

Ready to implement the Firebase portion?
Run: /implement firebase
```

