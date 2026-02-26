# New Repo

Bootstrap a new repository with proper structure, docs, and git setup.

## Context

```bash
echo "=== Current Directory ==="
pwd

echo ""
echo "=== GitHub Auth ==="
gh auth status 2>&1 | head -3

echo ""
echo "=== GitHub Orgs ==="
gh api user/orgs --jq '.[].login' 2>/dev/null | head -5
```

## Instructions

This command orchestrates the **repo bootstrap pipeline** — a workflow that takes a project idea from concept through scaffolding, documentation, and git setup to a pushed GitHub repository ready for development.

**IMPORTANT**: You (the main Claude) orchestrate this pipeline directly. Do NOT launch the repo-bootstrapper as a subagent — subagents cannot launch other subagents. Instead, read `~/.claude/agents/repo-bootstrapper.md` for detailed guidance, then run each stage yourself by launching the appropriate specialized agent via the Task tool. When launching any agent via Task, only use `model: "opus"` or `model: "sonnet"` — never `model: "haiku"`.

### When to Use

- Starting a brand new project
- Setting up a repo with proper structure from day one
- Want CLAUDE.md, docs, and git configured automatically
- Need consistent project scaffolding across your tech stacks
- Want a TASKS.md backlog ready for `/code-workflow`

### The Bootstrap Pipeline

```
┌──────────────────────────────────────────────────────────┐
│                    PROJECT-VISION LOOP                    │
│                                                          │
│  thought-partner → researcher → design-innovator →       │
│  code-architect → Summary → [satisfied?]                 │
│                                   ↓ no                   │
│                              (loop with feedback)        │
│                                   ↓ yes                  │
└──────────────────────────────────────────────────────────┘
                              ↓
           SCAFFOLD → GIT-INIT → CLAUDE-MD → DOCS → INITIAL-COMMIT → PUSH
```

The PROJECT-VISION loop runs until you say "satisfied" with the complete project summary.

### PROJECT-VISION Loop

The loop brings in **4 specialist agents** in sequence:

1. **thought-partner** — Initial Q&A: what we're building, platform, design feel, tech stack, MVP scope
2. **researcher** — Prior art: similar apps, best practices, pitfalls to avoid
3. **design-innovator** — Design direction: trends, interaction patterns, visual concepts (skipped for APIs/CLIs)
4. **code-architect** — Task breakdown: 5-10 prioritized tasks ready for `/code-workflow`

After all agents complete, you get a **Complete Project Summary**. Review it, then:
- Say **"satisfied"** to proceed to SCAFFOLD
- Or provide feedback to refine (only relevant agents re-run)

### Pipeline Stages

**SCAFFOLD** — Create the directory structure and configuration files for the chosen stack:
- **iOS**: SwiftUI app structure, Info.plist, Assets, Tests
- **React/Next.js**: App Router, components, lib, Tailwind config, ESLint
- **Go**: cmd/, internal/, Makefile, go.mod
- **Python**: src/, tests/, pyproject.toml, requirements.txt
- **TypeScript**: src/, tests/, tsconfig.json, ESLint

**GIT-INIT** — Initialize git with a comprehensive `.gitignore` for the tech stack.

**CLAUDE-MD** — Create CLAUDE.md with project overview, tech stack, conventions, key commands, and agent preferences.

**DOCS** — technical-writer creates:
- `docs/architecture.md` — High-level architecture
- `docs/getting-started.md` — Setup and first run
- `docs/contributing.md` — How to contribute
- `docs/decisions/001-initial-stack.md` — Why this stack
- `README.md` — Project description and quick start

**INITIAL-COMMIT** — Stage and commit everything: `chore: initial project scaffold`

**PUSH** — Create GitHub repo (personal or org) and push. Uses `gh` CLI.

### Arguments

```
/new-repo                          # Start with full PROJECT-VISION loop
/new-repo daily-habits ios         # Provide context upfront, faster loop
/new-repo my-api go                # Go server project
/new-repo landing-page react       # React/Next.js project
/new-repo $ARGUMENTS
```

### Workflow Controls

| Command | Action |
|---------|--------|
| `satisfied` | Exit PROJECT-VISION loop, proceed to SCAFFOLD |
| `you decide` | Let Claude choose (valid for design, stack, MVP scope) |
| `continue` / `y` | Proceed to next stage |
| `personal` | Push to personal GitHub |
| `org [name]` | Push to organization |
| `private` / `public` | Set repo visibility |
| `pause` | Save progress |
| `status` | Show current position |

### Example Session

```
> /new-repo

## PROJECT-VISION Loop

### Phase 1: thought-partner
What are we building?
→ A habit tracking app for daily routines

Platform?
→ iOS

Design feel? (or "you decide")
→ you decide
→ Going with minimal, clean — fits productivity apps well

Tech stack? (or "you decide")
→ you decide
→ SwiftUI + Core Data for local storage. Can add Firebase sync later.

MVP scope? (or "you decide")
→ you decide
→ Proposing: habit CRUD, daily check-off, 7-day streak display

---

### Phase 2: researcher
Investigating similar apps and patterns...

Research findings:
- Streaks app (iOS) — minimal, focused, uses haptics for satisfaction
- Habitify — gamification elements, but can feel cluttered
- Common pattern: single-tap to complete, undo available
- Pitfall: over-complicating streak logic (keep it simple)

---

### Phase 3: design-innovator
Exploring design direction...

Recommended: "Quiet Motivation"
- Soft gradients, muted colors, generous whitespace
- Subtle haptic feedback on completion
- Streak flame icon that grows with streak length
- Dark mode with true blacks

---

### Phase 4: code-architect
Breaking MVP into tasks...

6 tasks generated (~14 hours total):
1. define-habit-model
2. build-habit-service
3. create-habit-list-view
4. add-habit-form
5. implement-streak-logic
6. add-streak-display

---

## Complete Project Summary

### Vision
**Project**: DailyHabits
**One-liner**: Track daily habits with streak motivation
**Platform**: iOS
**Stack**: SwiftUI + Core Data

### Research Insights
- Single-tap completion is table stakes
- Keep streak logic simple (consecutive days only)
- Haptic feedback matters for satisfaction

### Design Direction
**Style**: Quiet Motivation
- Minimal, soft gradients, generous whitespace
- Streak flame that grows with progress
- Dark mode ready

### Development Tasks (6 tasks, ~14 hours)
1. define-habit-model: Habit struct with id, name, frequency, streak
2. build-habit-service: CRUD + markComplete methods
3. create-habit-list-view: Main list with completion toggles
4. add-habit-form: Sheet for new/edit habit
5. implement-streak-logic: Calculate current and longest streak
6. add-streak-display: Flame icon with growth animation

### GitHub
- **Destination**: personal
- **Visibility**: private
- **Repo name**: daily-habits

---

**Satisfied with this summary, or want to refine something?**

→ satisfied

---

## SCAFFOLD Stage
Created 14 files, 6 directories...

## GIT-INIT Stage
Initialized git repo with .gitignore...

## CLAUDE-MD Stage
Created CLAUDE.md with project context...

## DOCS Stage
Created documentation structure...

## INITIAL-COMMIT Stage
Committed: "chore: initial project scaffold"

## PUSH Stage
Push to personal GitHub as private repo? (y/n)
→ https://github.com/your-username/daily-habits

Pipeline COMPLETE.
TASKS.md has 6 tasks ready in backlog.
Run /code-workflow to pick up your first task.
```

### Refining the Summary

If you're not satisfied, provide feedback and only the relevant agents re-run:

```
→ I want a bolder design, more playful

Re-running design-innovator with feedback...

Updated Design Direction:
**Style**: Playful Progress
- Bright accent colors, rounded shapes
- Celebratory animations on completion
- Streak displayed as growing character/mascot

Updated summary presented...
**Satisfied, or more adjustments?**

→ satisfied
```

---

### Post-Completion: CAPTURE-LEARNINGS

After the new repo is scaffolded, committed, and pushed, capture agent-level learnings. This feeds the self-improvement loop.

**Process**:
1. Review the bootstrap pipeline — PROJECT-VISION loop quality, scaffold completeness, documentation accuracy
2. For each genuine learning, append an entry to `~/.claude/AGENT-IMPROVE.md` using the standard entry format (see `~/.claude/agents/improve-pipeline-manager.md` for format)
3. If the pipeline ran smoothly, capture zero learnings — do NOT invent entries
4. Classify each learning at capture time:
   - **UNIVERSAL**: Would benefit any project using this agent
   - **PROJECT**: Specific to this project
   - **PROCESS**: Suggests a pipeline/command workflow change
   - If unsure, default to PROJECT

**Focus areas for new-repo**:
- Did the PROJECT-VISION loop converge quickly, or did it take too many iterations?
- Did thought-partner ask the right questions to establish project scope?
- Did researcher find relevant prior art for the chosen stack?
- Was the scaffold complete and correct for the tech stack, or were manual fixes needed?
- Did code-architect produce a well-scoped task breakdown?

After capturing (or skipping), the AUTO-IMPROVE stage runs next.

---

### AUTO-IMPROVE

After CAPTURE-LEARNINGS, automatically run the improve pipeline if enough entries have accumulated.

**Process**:
1. Count entries in `~/.claude/AGENT-IMPROVE.md` (count `## Entry:` headers)
2. If file doesn't exist or has 0 entries: skip silently, proceed to next stage
3. If 1-2 entries: print "X entries in AGENT-IMPROVE.md (below threshold of 3). Deferring to next pipeline run." and proceed
4. If 3+ entries: run the improve pipeline with `--minor-only` behavior:
   - Read `~/.claude/agents/improve-pipeline-manager.md` for full stage guidance
   - Execute COLLECT → CLASSIFY → ANALYZE → PROPOSE → APPLY → VERIFY → CURATE
   - Auto-apply minor changes (Common Pitfalls, Quality Standards, project memory entries)
   - Log major proposals to `~/.claude/IMPROVE-CHANGELOG.md` but do NOT prompt for approval — defer to explicit `/improve` run
   - Clear processed minor entries from AGENT-IMPROVE.md; keep major entries for later

**Summary box** (print after AUTO-IMPROVE completes or skips):
```
┌──────────────────────────────────────────────────────────────────┐
│ AUTO-IMPROVE (new-repo)                                           │
│                                                                  │
│ Entries found: [N]                                               │
│ Threshold: 3                                                     │
│ Action: [skipped — no entries | deferred — below threshold |     │
│          ran — N minor applied, N major deferred]                │
└──────────────────────────────────────────────────────────────────┘
```

