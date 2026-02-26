# Claude Code Agent System — Transfer Package

A complete agent and pipeline system for software development, design, and content production using Claude Code.

## Quick Setup (5 minutes)

### Prerequisites
- Claude Code CLI installed and authenticated
- `~/.claude/` directory exists (created automatically on first run)

### Install

```bash
# Copy the two directories into your Claude config
cp -r agents/ ~/.claude/agents/
cp -r commands/ ~/.claude/commands/

# Restart Claude Code to pick up new commands
```

That's it. All `/slash-commands` and agents are now available.

### Verify

```
> /status
> /pipeline
```

If both respond, you're set.

---

## What You Get

### 37 Agents

Specialized AI agents that Claude Code invokes as subprocesses. Each has a defined role, tools, and output format.

#### Developers (7)

| Agent | Specialty | Tools |
|-------|-----------|-------|
| `ios-developer` | SwiftUI, UIKit, StoreKit, HealthKit, XCTest, Swift patterns | Read, Write, Bash |
| `android-developer` | Jetpack Compose, Material 3, Capacitor, Gradle, Kotlin patterns | Read, Write, Bash |
| `web-developer` | React, Next.js App Router, TypeScript, Tailwind, Vercel, React patterns | Read, Write, Bash |
| `typescript-developer` | Node.js backends, type-safe APIs, Zod, testing | Read, Write, Bash |
| `go-developer` | Go servers, stdlib routing, concurrency, Docker | Read, Write, Bash |
| `python-developer` | pandas, FastAPI, pytest, CLI tools, data processing | Read, Write, Bash |
| `cloud-engineer` | Firebase, GCP, Docker, Vercel, GitHub Actions, CI/CD | Read, Write, Bash |
| `firebase-debugger` | Debug Cloud Functions, Firestore, Auth, Analytics | Read, Bash |

#### Quality & Architecture (7)

| Agent | Role | Tools |
|-------|------|-------|
| `code-architect` | Design implementation plans (PLAN stage) | Read only |
| `judge` | Evaluate quality gates and tournament rounds (9.0/10 threshold) | Read only |
| `qa-engineer` | Write tests and check quality (WRITE-TESTS / QUALITY-CHECK) | Read, Write, Bash |
| `app-tester` | End-to-end verification (VERIFY stage) | Read, Bash |
| `refactorer` | Simplify code without behavior changes (SIMPLIFY stage) | Read, Write |
| `code-reviewer` | Structured code review of task diff (REVIEW stage) | Read, Bash |
| `security-reviewer` | Security audit for secrets, injection, auth/authz (SECURITY-REVIEW stage) | Read, Bash |

#### Research & Thinking (5)

| Agent | Role | Tools |
|-------|------|-------|
| `researcher` | Build pipeline context: search codebase first, web second, calibrate depth to complexity | Read, Web, Bash |
| `thought-partner` | Brainstorm, untangle ideas, find clarity | Read, Web |
| `claude-architect` | Design Claude Code system components (agents, commands, workflows) with correct permissions | Read, Web |
| `feature-analyzer` | Analyze source codebase features for porting (boundaries, deps, patterns, risks) | Read, Web |
| `codebase-debugger` | Socratic debugging partner: hypothesis-driven investigation to locate bugs | Read, Web, Bash |

#### Design (2)

| Agent | Role | Tools |
|-------|------|-------|
| `design-innovator` | UI/UX trend research, cutting-edge design concepts | Read, Web |
| `visual-architect` | Architecture diagrams, data flows, system visualizations | Read, Write, Bash |

#### Content & Communication (4)

| Agent | Role | Tools |
|-------|------|-------|
| `content-producer` | Write Substack-length technical articles (1500-3000 words) | Read, Write |
| `social-media-strategist` | Adapt content for Twitter/X, LinkedIn, Instagram | Read, Write |
| `editor` | Review and improve written content (quality gate) | Read, Write |
| `technical-writer` | Documentation, changelogs, commit messages | Read, Write, Bash |

#### Pipeline Managers (8)

| Agent | Role | Tools |
|-------|------|-------|
| `pipeline-manager` | Core orchestrator for feature dev, brainstorm, and tournament flows | Read, Write |
| `audit-pipeline-manager` | Audit → prioritize → fix loop | Read, Write, Bash |
| `design-pipeline-manager` | Design workflow for iOS and React with parallel worktrees | Read, Write, Bash |
| `content-pipeline-manager` | Article and social media production | Read, Write, Bash |
| `workflow-generator-manager` | Create new workflows, agents, and commands | Read, Write, Bash |
| `port-pipeline-manager` | Port features from source to target codebase | Read, Write, Bash |
| `repo-bootstrapper` | New project setup (scaffold → git → docs → push) | Read, Write, Bash |
| `onboard-pipeline-manager` | Onboard existing repos (discover → CLAUDE.md → doc cleanup) | Read, Write |

#### Utilities (1)

| Agent | Role | Tools |
|-------|------|-------|
| `repo-advisor` | Evaluate repo readiness for agent system | Read, Write, Bash |

### 34 Slash Commands

Commands invoke pipelines or individual stages.

#### Full Pipelines

| Command | What It Does |
|---------|-------------|
| `/code-workflow` | Full feature development pipeline (15 stages incl. REVIEW-WITH-USER, tasks predefined) |
| `/audit-workflow` | Audit codebase, prioritize findings, fix them one by one |
| `/design-workflow` | Design pipeline for iOS or React with parallel worktrees and human review |
| `/article-workflow` | Article production pipeline (brainstorm → draft → edit → publish) |
| `/social-workflow` | Adapt content into platform-specific social posts |
| `/new-repo` | Bootstrap a new repo with structure, docs, git, and GitHub push |
| `/new-workflow` | Create new workflows, agents, or commands |
| `/port` | Port a feature from source codebase to target |
| `/onboard` | Prepare existing repo for agent system (creates CLAUDE.md, cleans docs) |
| `/init-tasks` | Brain dump or task list → iterative DEEPEN with codebase context → structured TASKS.md with acceptance criteria |
| `/debug-workflow` | Conversational debugging: diagnose before fixing |

#### Pipeline Stages (invoke individually)

| Command | Stage |
|---------|-------|
| `/research` | Research the problem space |
| `/plan` | Design the technical approach |
| `/implement` | Hand off plan to developer agent |
| `/write-tests` | Write tests for implementation |
| `/simplify` | Clean up code without changing behavior |
| `/verify-app` | End-to-end verification |
| `/code-review` | Code review current task's changes (REVIEW stage) |
| `/review-security` | Security audit current task's changes (SECURITY-REVIEW stage) |
| `/commit` | Create commit with documentation |

#### Utilities

| Command | What It Does |
|---------|-------------|
| `/status` | Current task and stage |
| `/backlog` | Manage task backlog |
| `/audit` | Run codebase audit |
| `/debug` | Debug an issue |
| `/diagram` | Create architecture diagram |
| `/brainstorm` | Brainstorm session |
| `/docs` | Write documentation |
| `/changelog` | Update changelog |
| `/sync-docs` | Sync all documentation |
| `/update-claude` | Capture learnings in CLAUDE.md |
| `/fix-tests` | Fix failing tests |
| `/guide` | Topic-based help for the agent system |

---

## Pipeline System

### How It Works

Every pipeline follows the same pattern:
1. The **main Claude orchestrates directly** — it reads the pipeline manager agent file for guidance, then launches specialized agents at each stage via the Task tool
2. After each stage agent returns, Claude launches the **judge** agent to score the output (9.0/10 threshold)
3. A **stage summary box** is printed after every stage showing score, summary, and next step
4. If a stage fails, the judge's feedback is fed back and the stage is re-run and re-judged
5. Quality gate pass = `git commit` (checkpoint)
6. Full pipeline pass = push-ready

**Why this architecture?** Subagents (launched via Task) cannot launch other subagents. Pipeline manager agents contain detailed orchestration guidance but run as reference docs, not as subagent orchestrators.

### Quality Gate Escalation

When a stage fails its quality gate:

```
Attempt 1: Iterate with judge feedback
Attempt 2: Call researcher for new information, iterate again
Attempt 3: AUTO-TOURNAMENT — two agents compete, judge picks winner
Attempt 4: Escalate to user for guidance
```

### Feature Development Pipeline (`/code-workflow`)

```
PICKUP → RESEARCH → PLAN → IMPLEMENT → WRITE-TESTS → QUALITY-CHECK
  → SIMPLIFY → VERIFY-APP → REVIEW → SECURITY-REVIEW
  → SYNC-DOCS → UPDATE-CLAUDE → REVIEW-WITH-USER → COMMIT → COMPLETE
```

**REVIEW-WITH-USER**: After all automated checks pass, walks the user through each acceptance criterion from the task, showing what was built and asking for confirmation. Mismatches loop back to IMPLEMENT with specific feedback. Skipped for legacy tasks without acceptance criteria and in design mode (where DESIGN-REVIEW covers this).

Each `→` is a quality gate. The pipeline manager orchestrates which agent runs at each stage.

### Parallel Task Execution

Multiple Claude sessions can work on different tasks in the same repo simultaneously using **git worktrees** — each task gets its own branch and working directory:

1. **Git worktree isolation**: Each task gets `.worktree/[slug]/` (full working copy on branch `task/[slug]`) — eliminates interleaved commits between parallel sessions
2. **Pipeline metadata isolation**: Each task gets `.pipeline/[slug]/` directory with its own `CONTEXT.md`, `HANDOFF.md`, and `DECISIONS.md` (stays in main repo)
3. **Shared TASKS.md**: All active tasks tracked under `## Active Tasks` with `### [slug]` subsections (includes Branch, Worktree, Base fields)
4. **Auto-pickup**: Running `/code-workflow` with no arguments auto-picks the next task from backlog and creates a worktree
5. **Conflict detection**: After PLAN passes, file lists are compared across active tasks. Overlapping files trigger a warning (worktrees prevent immediate breakage but warn about merge conflicts at completion)
6. **Merge strategies at completion**: Local merge (merge branch + delete), PR (push + create PR), or push only
7. **Clean completion**: `/done` merges or pushes the branch, removes the worktree, removes the task's `### [slug]` section, and deletes `.pipeline/[slug]/`

Works across pipeline types — a `/code-workflow` session and an `/audit-workflow` session can run simultaneously with cross-pipeline conflict detection.

### Cross-Pipeline Task Sharing

The audit pipeline creates a prioritized backlog via AUDIT → PRIORITIZE. A `/code-workflow` session in another terminal can auto-pick tasks from that same backlog. Both pipelines run the same stages per task (RESEARCH → PLAN → IMPLEMENT → ... → COMMIT), share the same TASKS.md, and conflict detection works across pipeline types.

### Discovered Issues

Agents report unrelated issues they find during work under a `## Discovered Issues` heading. The orchestrator adds these to `### Ungroomed` at the bottom of `## Backlog` in TASKS.md after each stage. Ungroomed items are never auto-picked — they must go through `/init-tasks` for refinement first. This captures tech debt, bugs, and security problems without letting them enter the pipeline unrefined.

### Other Pipelines

| Pipeline | Command | Stages |
|----------|---------|--------|
| Audit | `/audit-workflow` | AUDIT → PRIORITIZE → [loop: RESEARCH → PLAN → IMPLEMENT → ... → COMMIT per task] |
| Design | `/design-workflow` | BRAINSTORM → RESEARCH-TRENDS → CONCEPT → [worktree] → PROTOTYPE → TEST → REFINE → BUILD → DESIGN-REVIEW → [merge] |
| Article | `/article-workflow` | BRAINSTORM → RESEARCH → OUTLINE → DRAFT → EDIT → HUMAN-EDIT → [loop until satisfied] → REVIEW → PUBLISH |
| Social | `/social-workflow` | EXTRACT-SNIPPETS → ADAPT-PER-PLATFORM → REVIEW |
| Repo Setup | `/new-repo` | BRAINSTORM → SCAFFOLD → GIT-INIT → CLAUDE-MD → DOCS → COMMIT → PUSH |
| Onboard | `/onboard` | DISCOVER → VALIDATE → ANALYZE → DOC-AUDIT → GENERATE → REFINE |

---

## How Agents Work

### Agent File Structure

Each agent is a markdown file in `~/.claude/agents/` with YAML frontmatter:

```yaml
---
name: agent-name
description: "When to use this agent and examples..."
tools: Glob, Grep, Read, Edit, Write, Bash
model: opus
---

You are a [role description]...

## Core Responsibilities
...

## Process
...

## Quality Standards
...

## Output Format
...
```

### Tool Permissions

Agents can only use the tools listed in their frontmatter. This is enforced by Claude Code.

| Permission Level | Tools | Risk |
|-----------------|-------|------|
| Read-only | `Glob, Grep, Read` | None — can only look at files |
| + Web | `+ WebFetch, WebSearch` | Low — can access the internet |
| + Write | `+ Edit, Write, NotebookEdit` | Medium — can modify files |
| + Execute | `+ Bash` | High — can run shell commands |

### Model Selection

All agents default to `model: opus` for maximum capability. You can change this in agent files:
- `opus` — Most capable, best for complex reasoning
- `sonnet` — Faster, good for straightforward tasks
- `haiku` — Fastest, good for simple operations

---

## TASKS.md Format

The pipeline system tracks state in a `TASKS.md` file in your project root. Multiple tasks can be active simultaneously:

```markdown
# Tasks

## Active Tasks

### add-user-auth
**Task**: Add user authentication
**Stage**: IMPLEMENT
**Pipeline**: code-workflow
**Branch**: task/add-user-auth
**Worktree**: .worktree/add-user-auth
**Base**: main
**Started**: 2026-02-04
**Attempts**: 1
**Files**:
- NEW: src/auth/AuthManager.swift
- MOD: src/models/User.swift
**Quality Scores**:
| Stage | Score | Attempts | Status |
|-------|-------|----------|--------|
| RESEARCH | 9.2 | 1 | PASS |
| PLAN | 9.1 | 1 | PASS |
| IMPLEMENT | - | 0 | CURRENT |

---

### fix-color-rendering
**Task**: Fix Android color rendering
**Stage**: PLAN
**Pipeline**: code-workflow
**Branch**: task/fix-color-rendering
**Worktree**: .worktree/fix-color-rendering
**Base**: main
**Started**: 2026-02-04
**Attempts**: 0
**Files**: (pending PLAN)
**Quality Scores**:
| Stage | Score | Attempts | Status |
|-------|-------|----------|--------|
| PLAN | - | 0 | CURRENT |

---

## Backlog
- [ ] Push notification support
- [ ] Add leaderboard

## Completed
- [x] [setup-project] Set up project structure -- 2026-02-03
```

Each active task gets an isolated `.pipeline/[slug]/` directory containing its `CONTEXT.md`, `HANDOFF.md`, and `DECISIONS.md`.

---

## Customization

### Adding Your Own Agents

Create a new file in `~/.claude/agents/`:

```yaml
---
name: my-custom-agent
description: "When to use: [describe triggers]. Examples: [1-3 examples]"
tools: Glob, Grep, Read
model: opus
---

You are a [role]...
```

### Adding Your Own Commands

Create a new file in `~/.claude/commands/`:

```markdown
# My Command

Brief description.

## Context

\`\`\`bash
# Commands to gather context at invocation time
\`\`\`

## Instructions

What to do when `/my-command` is invoked.
```

### Voice Profile

The article pipeline includes a HUMAN-EDIT stage where the author reviews and edits the AI draft. Claude analyzes the edits to build a persistent voice profile at `~/.claude/voice-profile.md`. Over time, the content-producer and editor agents read this profile to match the author's natural writing voice — tone, word choices, sentence patterns, and structural preferences.

### Per-Project Context

Add a `CLAUDE.md` to any project root. Agents read this file to understand project-specific conventions, tech stack, and patterns. The `/new-repo` command creates this automatically.

---

## What NOT to Share

| Path | Reason |
|------|--------|
| `~/.claude/settings.json` | User-specific permissions |
| `~/.claude/projects/` | Session history |
| `~/.claude/memory/` | Personal memory |
| `~/.claude/plans/` | Session-specific plans |

---

## Troubleshooting

**"Agent not found"** — Ensure the file exists in `~/.claude/agents/` with correct YAML frontmatter (name must match filename without .md).

**"Permission denied"** — The agent needs tools added to its frontmatter, or you need to approve the permission prompt.

**Commands not appearing** — Restart Claude Code. Commands load at startup.

**Pipeline stuck** — Run `/status` to see where you are. Run `/next` to advance manually, or describe what's wrong.

---

## Version

```
Package version: 2.8.0
Last updated: 2026-02-06
Agents: 37
Commands: 34
Pipelines: 9 (audit, design, article, social, repo-setup, brainstorm, workflow-generator, port-feature, onboard, debug)
Features: Git worktree isolation for parallel tasks, branch-per-task with merge strategies, cross-pipeline task sharing, conflict detection, discovered issues → backlog, researcher as context builder, always-loaded language patterns in developer agents, meta-workflow for creating new workflows with permission validation, onboard workflow for existing repos, conversational debug workflow with Socratic diagnosis
```
