---
name: repo-bootstrapper
description: "Pipeline manager for new repository setup. This is a REFERENCE DOCUMENT for the main Claude orchestrator — do NOT launch this as a subagent. Read this file for guidance, then launch specialized agents at each stage via the Task tool. Examples: (1) '/new-repo' starts the PROJECT-VISION loop to brainstorm, design, and scaffold a new project. (2) 'Set up a new repo for my iOS fitness tracking app' triggers new-repo with a specific project idea. (3) '/new-repo daily-habits ios' scaffolds with an abbreviated vision loop when details are provided upfront."
tools: Glob, Grep, Read, Edit, Write, Bash
model: opus
memory: user
---

## Role

This document guides the main Claude orchestrator through the repo bootstrap pipeline. It takes a project idea from brainstorm through scaffolding, task planning, documentation, and GitHub push.

**IMPORTANT**: This is a reference document, not a subagent. The main Claude reads this for guidance and launches specialized agents at each stage.

## The Pipeline

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
           SCAFFOLD → SEED-MEMORY → GIT-INIT → CLAUDE-MD → DOCS → INITIAL-COMMIT → PUSH
```

The PROJECT-VISION loop runs until the user is satisfied with the complete project summary (vision + design + tasks).

## Stage Reference

| Stage | Agent(s) | Purpose |
|-------|----------|---------|
| PROJECT-VISION | thought-partner, researcher, design-innovator, code-architect | Complete project exploration loop |
| SCAFFOLD | (main Claude) | Create directory structure and config files |
| SEED-MEMORY | (main Claude) | Create agent memory directories with initial context |
| GIT-INIT | (main Claude) | Initialize git, create .gitignore |
| CLAUDE-MD | (main Claude) | Create CLAUDE.md with project context |
| DOCS | technical-writer | Set up documentation structure |
| INITIAL-COMMIT | (main Claude) | Stage everything and create initial commit |
| PUSH | (main Claude) | Create GitHub repo and push |

## Quality Gate Criteria

| Stage | Gate Question |
|-------|--------------|
| PROJECT-VISION | User explicitly says "satisfied" with the summary |
| SCAFFOLD | Is the scaffold correct and idiomatic for the stack? |
| SEED-MEMORY | Are agent memory dirs created with relevant initial context? |
| GIT-INIT | Is the .gitignore comprehensive for this stack? |
| CLAUDE-MD | Would an AI agent have everything it needs? |
| DOCS | Are the docs accurate, complete, and useful? |
| INITIAL-COMMIT | Is the commit clean with no secrets? |
| PUSH | Is the repo accessible and README rendering? |

## Quality Gate System

**Every stage is quality-gated at 9.0/10.**

The judge agent evaluates each stage's output. If below 9.0:

```
QUALITY GATE FAILS ON STAGE X
  |
  Attempt 1: Iterate with judge feedback
  | (still failing?)
  Attempt 2: Call researcher for new information / best practices, then iterate
  | (still failing?)
  Attempt 3: AUTO-TOURNAMENT — two agents compete on stage X, judge picks winner
  | (tournament winner still below 9.0?)
  Attempt 4: Escalate to user
```

### Tournament Mode

Tournament is a quality escalation, not a separate pipeline. Two agents work the same stage independently, judge picks the winner.

**Auto-triggers** after 2 quality gate failures on the same stage.

**Tournamentable stages**: PROJECT-VISION (individual agents within), SCAFFOLD, CLAUDE-MD, DOCS

**Non-tournamentable**: GIT-INIT, INITIAL-COMMIT, PUSH (mechanical/deterministic)

---

## Stage Details

### PROJECT-VISION Loop

This is a **user-satisfaction loop** that runs multiple specialist agents, then presents a comprehensive summary. The loop continues until the user says "satisfied".

```
┌─────────────────────────────────────────────────────────────────┐
│ 1. thought-partner: Initial Q&A (what, platform, scope)        │
│                           ↓                                     │
│ 2. researcher: Prior art, patterns, best practices             │
│                           ↓                                     │
│ 3. design-innovator: Design direction (user-facing apps only)  │
│                           ↓                                     │
│ 4. code-architect: Task breakdown                               │
│                           ↓                                     │
│ 5. Present COMPLETE SUMMARY to user                             │
│                           ↓                                     │
│ [satisfied?] ──yes──→ EXIT to SCAFFOLD                          │
│      ↓ no                                                       │
│ (incorporate feedback, loop with relevant agents)               │
└─────────────────────────────────────────────────────────────────┘
```

---

#### Phase 1: thought-partner (Initial Exploration)

Launch thought-partner for guided Q&A. Ask ONE question at a time.

**Required Questions:**
1. **What are we building?** — Accept vague or detailed. Probe for the problem and target user.
2. **Platform?** — iOS, Android, web, API, CLI, library

**Optional Questions:**
3. **Design feel?** — minimal, playful, professional, bold, warm, technical. "You decide" valid.
4. **Tech stack?** — "You decide" valid. Claude picks based on platform:
   - iOS → SwiftUI + local storage (or Firebase if sync needed)
   - Web → Next.js + TypeScript + Tailwind + Vercel
   - API → Go or Python FastAPI
   - Android → Capacitor or native Kotlin
5. **MVP scope?** — "You decide" valid. Claude proposes 3-5 core features.

**Handling "You Decide":**
Make the decision immediately, state it clearly, explain briefly, move on.

**Output:** Initial project context for downstream agents.

---

#### Phase 2: researcher (Prior Art & Patterns)

Launch researcher to investigate:

1. **Similar apps/projects** — What exists in this space? What works, what doesn't?
2. **Best practices** — For this platform + problem domain, what patterns are proven?
3. **Pitfalls to avoid** — Common mistakes in this type of project
4. **Technical considerations** — Any platform-specific constraints or opportunities

**Prompt template:**
```
Research prior art and best practices for: [PROJECT DESCRIPTION]

Platform: [PLATFORM]
Domain: [PROBLEM DOMAIN]

Investigate:
1. 2-3 similar existing apps/projects — what do they do well?
2. Common patterns for this type of app
3. Technical pitfalls to avoid
4. Any emerging trends relevant to this space

Keep findings concise and actionable. Focus on what affects our decisions.
```

**Output:** Research findings that inform design and task planning.

---

#### Phase 3: design-innovator (Design Direction)

**Skip this phase for non-user-facing projects** (APIs, CLIs, libraries).

Launch design-innovator to explore visual and interaction direction:

1. **Design trends** relevant to this app type
2. **Interaction patterns** that would elevate the UX
3. **2-3 design concept directions** with rationale
4. **Platform-specific considerations** (iOS HIG, Material, etc.)

**Prompt template:**
```
Explore design direction for: [PROJECT NAME]

Context:
- [ONE-LINER]
- Platform: [PLATFORM]
- Design feel requested: [DIRECTION or "you decide"]

Research findings: [RESEARCHER OUTPUT SUMMARY]

Provide:
1. 2-3 distinct design directions with names and rationales
2. Recommended micro-interactions and transitions
3. Color/typography direction suggestions
4. Platform convention notes

Be specific enough that a developer could begin implementation.
```

**Output:** Design direction recommendation.

---

#### Phase 4: code-architect (Task Breakdown)

Launch code-architect to create development tasks:

**Prompt template:**
```
Break this project into development tasks:

Project: [NAME]
One-liner: [DESCRIPTION]
Platform: [PLATFORM]
Stack: [TECH STACK]

MVP Scope:
- [Feature 1]
- [Feature 2]
- [Feature 3]

Research insights: [KEY FINDINGS]
Design direction: [DESIGN SUMMARY]

Create 5-10 tasks:
- Each scoped for 1-4 hours
- Ordered by dependency (foundation first)
- Named with kebab-case slugs
- Include enough context that a developer can start immediately
```

**Task Ordering:**
1. Foundation first: Data models, core types, config
2. Services next: Business logic
3. Views after: UI components
4. Polish last: Animations, edge cases

**Output:** TASKS.md content ready for the repo.

---

#### Phase 5: Present Complete Summary

After all agents complete, present the **Complete Project Summary** to the user:

```markdown
## Complete Project Summary

### Vision
**Project**: [name]
**One-liner**: [description]
**Platform**: [platform]
**Stack**: [tech stack]

### Research Insights
- [Key finding 1]
- [Key finding 2]
- [Pitfall to avoid]

### Design Direction
**Style**: [design direction name]
- [Key design element 1]
- [Key design element 2]

### MVP Scope
- [Feature 1]
- [Feature 2]
- [Feature 3]

### Development Tasks (6 tasks, ~15 hours)
1. [task-slug]: [description]
2. [task-slug]: [description]
3. [task-slug]: [description]
4. [task-slug]: [description]
5. [task-slug]: [description]
6. [task-slug]: [description]

### GitHub
- **Destination**: [personal / org]
- **Visibility**: [private / public]
- **Repo name**: [slug]

---

**Satisfied with this summary, or want to refine something?**
(Say "satisfied" to proceed, or provide feedback to adjust)
```

---

#### Satisfaction Loop

**If user says "satisfied":** Exit loop, proceed to SCAFFOLD.

**If user provides feedback:**
1. Identify which phase(s) need re-running based on feedback
2. Re-run only the relevant agents with the feedback incorporated
3. Update the summary
4. Ask again: "Satisfied, or more adjustments?"

**Examples of feedback routing:**
- "I want more features" → re-run thought-partner + code-architect
- "Different design direction" → re-run design-innovator
- "What about using X technology instead?" → re-run researcher + code-architect
- "Add a specific task for Y" → update code-architect output directly
- "Looks good but change the repo name" → update summary directly

---

### TASKS.md Generation

After the user is satisfied, generate `TASKS.md` from the code-architect output:

```markdown
# Tasks

## Project Vision
**App**: [name] — [one sentence description]
**MVP**: [scope summary]
**Design**: [direction]
**Stack**: [tech stack]

---

## Backlog
- [ ] [task-slug]: [Description]
- [ ] [task-slug]: [Description]
- [ ] [task-slug]: [Description]

## Active Tasks
```

Completed tasks are stored in `HISTORY.md` (same directory), not in TASKS.md.

---

### SCAFFOLD Stage

Create the directory structure based on tech stack. Each task should be:
   - Scoped for 1-4 hours of focused work
   - Self-contained (can be done in one `/code-workflow` session)
   - Ordered by dependency (foundational tasks first)
   - Named with a kebab-case slug

#### Task Breakdown Guidelines

| Task Type | Typical Scope | Example |
|-----------|---------------|---------|
| Data models | 1-2 hours | `define-habit-model`: Create Habit struct with properties |
| Core service | 2-4 hours | `build-habit-service`: CRUD operations for habits |
| Primary view | 2-3 hours | `create-habit-list-view`: Main list with add/delete |
| Secondary view | 1-2 hours | `add-habit-detail-view`: Edit view for single habit |
| Integration | 2-4 hours | `integrate-firebase`: Sync habits to Firestore |
| Polish | 1-2 hours | `add-streak-animation`: Flame animation for streaks |

#### Output: TASKS.md

Generate `TASKS.md` in the repo root with this format:

```markdown
# Tasks

## Project Vision
**App**: [name] — [one sentence description]
**MVP**: [scope summary in one line]
**Design**: [direction]
**Stack**: [tech stack]

---

## Backlog
- [ ] [task-slug]: [Description — what to build and why]
- [ ] [task-slug]: [Description]
- [ ] [task-slug]: [Description]
- [ ] [task-slug]: [Description]
- [ ] [task-slug]: [Description]

## Active Tasks
```

Completed tasks are stored in `HISTORY.md` (same directory), not in TASKS.md.

#### Task Ordering

Order tasks by dependency chain:
1. **Foundation first**: Data models, core types, config
2. **Services next**: Business logic that operates on models
3. **Views after**: UI that uses services
4. **Polish last**: Animations, edge cases, refinements

#### Example TASKS.md

```markdown
# Tasks

## Project Vision
**App**: DailyHabits — Track daily habits with streak motivation
**MVP**: Habit CRUD, daily check-off, 7-day streak display
**Design**: Minimal, clean with subtle animations
**Stack**: SwiftUI + Core Data

---

## Backlog
- [ ] define-habit-model: Create Habit struct with id, name, frequency, createdAt, and streak count
- [ ] build-habit-service: HabitService with create, read, update, delete, and markComplete methods
- [ ] create-habit-list-view: Main view showing all habits with today's completion status
- [ ] add-habit-form: Sheet for creating new habits with name and frequency picker
- [ ] implement-streak-logic: Calculate current streak and longest streak from completion history
- [ ] add-streak-display: Show streak count with flame icon, animate on milestone

## Active Tasks
```

Completed tasks are stored in `HISTORY.md` (same directory), not in TASKS.md.

Quality gate: Are the tasks well-scoped, prioritized, and actionable? Could a developer pick up task #1 and start immediately?

---

### SCAFFOLD Stage

Create the directory structure based on tech stack. The main Claude handles this directly.

Each tech stack has a standard scaffold:

#### iOS (SwiftUI)
```
[project-name]/
├── [ProjectName]/
│   ├── App/
│   │   └── [ProjectName]App.swift
│   ├── Views/
│   ├── Models/
│   ├── ViewModels/
│   ├── Services/
│   ├── Extensions/
│   ├── Resources/
│   │   └── Assets.xcassets/
│   └── Info.plist
├── [ProjectName]Tests/
├── [ProjectName]UITests/
├── docs/
├── TASKS.md          ← from PLAN-TASKS
├── .gitignore
├── CLAUDE.md
├── README.md
└── LICENSE
```

#### React / Next.js
```
[project-name]/
├── app/
│   ├── layout.tsx
│   ├── page.tsx
│   ├── globals.css
│   └── api/
├── components/
│   └── ui/
├── lib/
├── hooks/
├── types/
├── public/
├── docs/
├── TASKS.md          ← from PLAN-TASKS
├── .gitignore
├── .env.example
├── CLAUDE.md
├── README.md
├── LICENSE
├── package.json
├── tsconfig.json
├── tailwind.config.ts
├── next.config.js
└── eslint.config.js
```

#### Go
```
[project-name]/
├── cmd/
│   └── [project-name]/
│       └── main.go
├── internal/
│   ├── handlers/
│   ├── models/
│   └── services/
├── pkg/
├── docs/
├── TASKS.md          ← from PLAN-TASKS
├── .gitignore
├── CLAUDE.md
├── README.md
├── LICENSE
├── go.mod
└── Makefile
```

#### Python
```
[project-name]/
├── src/
│   └── [project_name]/
│       ├── __init__.py
│       └── main.py
├── tests/
│   └── __init__.py
├── docs/
├── TASKS.md          ← from PLAN-TASKS
├── .gitignore
├── .env.example
├── CLAUDE.md
├── README.md
├── LICENSE
├── pyproject.toml
└── requirements.txt
```

#### TypeScript (General)
```
[project-name]/
├── src/
│   └── index.ts
├── tests/
├── docs/
├── TASKS.md          ← from PLAN-TASKS
├── .gitignore
├── .env.example
├── CLAUDE.md
├── README.md
├── LICENSE
├── package.json
├── tsconfig.json
└── eslint.config.js
```

**Note**: TASKS.md is created during PLAN-TASKS and included in the scaffold. Don't overwrite it.

Quality gate: Is the scaffold correct for the stack? Are configs valid? Is the structure idiomatic?

---

### SEED-MEMORY Stage

Create agent memory directories with initial context based on the project's tech stack.

1. Create `.claude/agent-memory/` directory in the project
2. For each relevant agent (based on tech stack), create `<agent>/MEMORY.md`:

**Which agents to seed** (based on stack detection):

| Stack | Agents to Seed |
|-------|---------------|
| iOS/SwiftUI | ios-developer, code-architect, qa-engineer |
| React/Next.js | web-developer, code-architect, qa-engineer |
| Go | go-developer, code-architect, qa-engineer |
| Python/FastAPI | python-developer, code-architect, qa-engineer |
| Android | android-developer, code-architect, qa-engineer |
| TypeScript | typescript-developer, code-architect, qa-engineer |
| Any with Firebase | cloud-engineer, firebase-debugger |

3. Each seed memory file gets:

```markdown
# [Agent Name] Memory

## Project Context
- Project: [name] -- [one-liner]
- Stack: [tech stack]
- Architecture: [pattern from code-architect output]

## Conventions
- [Key conventions from thought-partner/researcher output]

## Known Patterns
- [Patterns identified during PROJECT-VISION]
```

4. Create `.claude/research-cache/` directory for the researcher's cached findings
5. Add `.claude/agent-memory/` and `.claude/research-cache/` to `.gitignore` (local developer data, not committed)
6. Ensure `.claude/` directory structure is correct

Quality gate: Are the right agents seeded for this stack? Is initial context accurate?

---

### GIT-INIT Stage

1. Run `git init` in the project directory
2. Create a comprehensive `.gitignore` for the tech stack:
   - Language-specific ignores (node_modules, .build, __pycache__, etc.)
   - IDE ignores (.idea, .vscode, .DS_Store)
   - Environment files (.env, .env.local -- but NOT .env.example)
   - Agent memory (`.claude/agent-memory/`)
   - Research cache (`.claude/research-cache/`)
   - Build artifacts
   - OS files
3. Output: Initialized git repo with proper .gitignore

Quality gate: Is the .gitignore comprehensive for this stack?

---

### CLAUDE-MD Stage

Create CLAUDE.md with the following structure:

```markdown
# CLAUDE.md

## Project Overview
[1-2 sentence description of what this project is and does]

## Tech Stack
- **Language**: [e.g., TypeScript]
- **Framework**: [e.g., Next.js 14]
- **Styling**: [e.g., Tailwind CSS]
- **Backend**: [e.g., Firebase]
- **Testing**: [e.g., Jest + React Testing Library]
- **Deployment**: [e.g., Vercel]

## Project Structure
[Brief annotated directory tree]

## Conventions
- [Naming conventions]
- [File organization rules]
- [Code style preferences]
- [Commit message format]
- [Branch naming]

## Key Commands
- `[build command]` — Build the project
- `[test command]` — Run tests
- `[dev command]` — Start dev server
- `[lint command]` — Run linter

## Documentation
See `docs/` for:
- [doc 1]
- [doc 2]

## Agent Preferences
- Use [specific agent] for [specific task type]
- Prefer [pattern] over [anti-pattern]
- Always run tests before committing
- Follow the existing code style — check nearby files before writing new code
```

Tailor content to the actual project, not generic boilerplate.

Quality gate: Would an AI agent landing in this repo for the first time have everything it needs?

---

### DOCS Stage

Launch technical-writer agent to create documentation structure:

```
docs/
├── architecture.md      # High-level architecture overview
├── getting-started.md   # Setup and first run instructions
├── contributing.md      # How to contribute
└── decisions/           # Architecture Decision Records
    └── 001-initial-stack.md
```

Also create README.md:
- Project name and description
- Quick start (3-5 steps to running)
- Features / goals
- Tech stack
- Link to docs/
- License

Quality gate: Are the docs accurate, complete, and useful for a new contributor?

---

### INITIAL-COMMIT Stage

1. Stage all files: `git add -A`
2. Review what's being committed — ensure no secrets or unwanted files
3. Create initial commit: `git commit -m "chore: initial project scaffold"`

Quality gate: Is the commit clean? No secrets? No unwanted files?

---

### PUSH Stage

1. Determine GitHub destination:
   - **Personal**: `gh repo create [repo-name] --private --source=. --push`
   - **Organization**: `gh repo create [org]/[repo-name] --private --source=. --push`
2. Confirm with user: "Push to [destination] as [public/private]?"
3. Push to GitHub
4. Output: Live GitHub repository URL

Quality gate: Is the repo accessible? Is the README rendering correctly?

---

## TASKS.md Formats

### Bootstrap Pipeline Tracking (internal)

This tracks the bootstrap pipeline progress. Lives in working directory during setup, deleted after push.

```markdown
# Repo Bootstrap

## Project
**Name**: [repo name]
**Purpose**: [one sentence]
**Stack**: [tech stack]
**GitHub**: [personal / org name]
**Started**: [date]

---

## Current Stage
**Stage**: [current stage]
**Attempts**: [per-stage attempt count]
**Quality Scores**:
| Stage | Score | Attempts | Status |
|-------|-------|----------|--------|
| BRAINSTORM | 9.2 | 1 | PASS |
| PLAN-TASKS | 9.1 | 1 | PASS |
| SCAFFOLD | 9.4 | 1 | PASS |
| GIT-INIT | - | 0 | CURRENT |

---

## Project Brief
[From BRAINSTORM — what we're building and why]

## Stack Decisions
- [Decision]: [Rationale]

---

## Notes
- [Context from each completed stage]
```

### Project TASKS.md (generated for development)

This is the TASKS.md generated by PLAN-TASKS stage. Lives in repo root. Compatible with `/code-workflow`.

```markdown
# Tasks

## Project Vision
**App**: [name] — [one sentence description]
**MVP**: [scope summary]
**Design**: [direction]
**Stack**: [tech stack]

---

## Backlog
- [ ] [task-slug]: [Description]
- [ ] [task-slug]: [Description]
- [ ] [task-slug]: [Description]

## Active Tasks
```

Completed tasks are stored in `HISTORY.md` (same directory), not in TASKS.md.

The Project Vision header gives `/code-workflow` context about the overall project when picking up tasks.

---

## Communication Style

Brief, actionable updates after each stage:

```
BRAINSTORM complete (9.2/10)
→ "daily-habits" — iOS habit tracker with streak motivation
→ Stack: SwiftUI + Core Data
→ MVP: habit CRUD, daily check-off, 7-day streak
→ Advancing to PLAN-TASKS

---

PLAN-TASKS complete (9.1/10)
→ 6 tasks generated in TASKS.md
→ Estimated: 12-18 hours total
→ Advancing to SCAFFOLD

---

SCAFFOLD complete (9.4/10) — 14 files, 6 directories created
→ Advancing to GIT-INIT

---

PUSH complete — https://github.com/your-username/daily-habits
→ Private repo created and pushed
→ Pipeline COMPLETE

TASKS.md has 6 tasks ready in backlog.
Run /code-workflow to pick up your first task.
```

## Common Pitfalls

- Launching this file as a subagent — it is a reference document for the main Claude orchestrator
- Scaffolding before the PROJECT-VISION loop converges — premature structure leads to rework
- Not checking that git and gh CLI are available before GIT-INIT and PUSH stages
- Creating a repo without running the SEED-MEMORY stage — agents need initial project context
