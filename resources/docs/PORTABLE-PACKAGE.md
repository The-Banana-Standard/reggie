# Claude Code Agent System — Transfer Package

A complete agent and pipeline system for software development, design, and content production using Claude Code.

## Quick Setup (5 minutes)

### Prerequisites
- Claude Code CLI installed and authenticated
- `~/.claude/` directory exists (created automatically on first run)

### Install

Reggie is installed and managed by [Forge](https://github.com/The-Banana-Standard/forge-reggie), the desktop companion app. Forge copies the contents of `resources/` into `~/.claude/` and keeps them in sync. User-created files are preserved. Restart Claude Code to pick up the new commands.

### Verify

```
> /reggie-guide
```

If the guide loads, you're set.

---

## What You Get

### 36 Agents

Specialized AI agents that Claude Code invokes as subprocesses. Each has a defined role, tools, and output format.

#### Developers (9)

| Agent | Specialty | Tools |
|-------|-----------|-------|
| `reggie-ios-developer` | SwiftUI, UIKit, StoreKit, HealthKit, XCTest, Swift patterns | Read, Web, Write, Bash |
| `reggie-android-developer` | Jetpack Compose, Material 3, Capacitor, Gradle, Kotlin patterns | Read, Web, Write, Bash |
| `reggie-web-developer` | React, Next.js App Router, TypeScript, Tailwind, Vercel, React patterns | Read, Web, Write, Bash |
| `reggie-typescript-developer` | Node.js backends, type-safe APIs, Zod, testing | Read, Web, Write, Bash |
| `reggie-go-developer` | Go servers, stdlib routing, concurrency, Docker | Read, Web, Write, Bash |
| `reggie-python-developer` | pandas, FastAPI, pytest, CLI tools, data processing | Read, Web, Write, Bash |
| `reggie-rust-developer` | Rust apps, Tauri v2, async tokio, serde, systems programming | Read, Web, Write, Bash |
| `reggie-cloud-engineer` | Firebase, GCP, Docker, Vercel, GitHub Actions, CI/CD | Read, Web, Write, Bash |
| `reggie-firebase-debugger` | Debug Cloud Functions, Firestore, Auth, Analytics | Read, Web, Bash |

*Tool categories are simplified: **Read** = Glob + Grep + Read; **Web** = WebFetch + WebSearch; **Write** = Edit + Write (+ NotebookEdit where applicable); **Bash** = Bash.*

#### Quality & Architecture (7)

| Agent | Role | Tools |
|-------|------|-------|
| `reggie-code-architect` | Design implementation plans (PLAN stage) | Read, Web |
| `reggie-judge` | Evaluate quality gates and tournament rounds (9.0/10 threshold) | Read, Web |
| `reggie-qa-engineer` | Write tests and check quality (WRITE-TESTS / QUALITY-CHECK) | Read, Web, Write, Bash |
| `reggie-app-tester` | End-to-end verification (VERIFY stage) | Read, Web, Bash |
| `reggie-refactorer` | Simplify code without behavior changes (SIMPLIFY stage) | Read, Write, Bash |
| `reggie-code-reviewer` | Structured code review of task diff (REVIEW stage) | Read, Web, Bash |
| `reggie-security-reviewer` | Security audit for secrets, injection, auth/authz (SECURITY-REVIEW stage) | Read, Web, Bash |

#### Research & Thinking (4)

| Agent | Role | Tools |
|-------|------|-------|
| `reggie-researcher` | Build pipeline context: search codebase first, web second, calibrate depth to complexity | Read, Web, Bash |
| `reggie-thought-partner` | Brainstorm, untangle ideas, find clarity | Read, Web |
| `reggie-claude-architect` | Design Claude Code system components (agents, commands, workflows) with correct permissions | Read, Web |
| `reggie-codebase-debugger` | Socratic debugging partner: hypothesis-driven investigation to locate bugs | Read, Web, Bash |

#### Design (2)

| Agent | Role | Tools |
|-------|------|-------|
| `reggie-design-innovator` | UI/UX trend research, cutting-edge design concepts | Read, Web |
| `reggie-visual-architect` | Architecture diagrams, data flows, system visualizations | Read, Web, Write, Bash |

#### Content & Communication (4)

| Agent | Role | Tools |
|-------|------|-------|
| `reggie-content-producer` | Write Substack-length technical articles (1500-3000 words) | Read, Web, Write |
| `reggie-social-media-strategist` | Adapt content for Twitter/X, LinkedIn, Instagram | Read, Web, Write |
| `reggie-article-editor` | Review and improve written content (quality gate) | Read, Web, Write |
| `reggie-technical-writer` | Documentation, changelogs, commit messages | Read, Web, Write, Bash |

#### Pipeline Managers (9)

| Agent | Role | Tools |
|-------|------|-------|
| `reggie-code-manager` | Core orchestrator for feature dev, brainstorm, and tournament flows | Read, Write |
| `reggie-audit-manager` | Audit → prioritize → fix loop | Read, Write |
| `reggie-content-manager` | Article and social media production | Read, Write |
| `reggie-bootstrap-manager` | New project setup (scaffold → git → docs → push) | Read, Write, Bash |
| `reggie-onboard-manager` | Onboard existing repos (discover → CLAUDE.md → doc cleanup) | Read, Write |
| `reggie-debug-manager` | Conversational debugging: diagnose before fixing | Read, Bash |
| `reggie-improve-manager` | Two-level agent improvement loop | Read, Write |
| `reggie-evaluate-manager` | Periodic architectural review of agent system | Read, Write |
| `reggie-system-change-manager` | Formalize changes to agent system components | Read, Write |

#### Utilities (1)

| Agent | Role | Tools |
|-------|------|-------|
| `reggie-repo-advisor` | Evaluate repo readiness for agent system | Read, Write, Bash |

### 35 Slash Commands

Commands invoke pipelines or individual stages.

#### Full Pipelines

| Command | What It Does |
|---------|-------------|
| `/reggie-code-workflow` | Full feature development pipeline (13 stages, tasks predefined). Requires `/reggie-init-tasks` first — RESEARCH+PLAN handled there. |
| `/reggie-audit-workflow` | Audit codebase, prioritize findings, fix them one by one |
| `/reggie-article-workflow` | Article production pipeline (brainstorm → draft → edit → publish) |
| `/reggie-social-workflow` | Adapt content into platform-specific social posts |
| `/reggie-new-repo` | Bootstrap a new repo with structure, docs, git, and GitHub push |
| `/reggie-onboard` | Prepare existing repo for agent system (creates CLAUDE.md, cleans docs) |
| `/reggie-init-tasks` | Brain dump or task list → collaborative RESEARCH+PLAN per task → slim TASKS.md with metadata + `.pipeline/[slug]/task.md` files with full plans. Required before `/reggie-code-workflow`. |
| `/reggie-debug-workflow` | Conversational debugging: diagnose before fixing |
| `/reggie-improve` | Process accumulated agent learnings, apply improvements |
| `/reggie-evaluation-system` | Evaluate agent system architecture, propose improvements |
| `/reggie-system-change` | Formalize known changes to agent system components |

#### Pipeline Stages (invoke individually)

| Command | Stage |
|---------|-------|
| `/reggie-research` | Research the problem space |
| `/reggie-plan` | Design the technical approach |
| `/reggie-write-tests` | Write tests for implementation |
| `/reggie-simplify` | Clean up code without changing behavior |
| `/reggie-verify-app` | End-to-end verification |
| `/reggie-code-review` | Code review current task's changes (REVIEW stage) |
| `/reggie-review-security` | Security audit current task's changes (SECURITY-REVIEW stage) |
| `/reggie-commit` | Create commit with documentation |

#### Utilities

| Command | What It Does |
|---------|-------------|
| `/reggie-status` | Current task and stage |
| `/reggie-audit` | Run codebase audit |
| `/reggie-debug` | Debug an issue |
| `/reggie-diagram` | Create architecture diagram |
| `/reggie-brainstorm` | Brainstorm session |
| `/reggie-docs` | Write documentation |
| `/reggie-changelog` | Update changelog |
| `/reggie-sync-docs` | Sync all documentation |
| `/reggie-update-claude` | Capture learnings in CLAUDE.md |
| `/reggie-fix-tests` | Fix failing tests |
| `/reggie-find-tools` | Scan project, configure MCP servers |
| `/reggie-refresh-capabilities` | Update capability manifest from all sources |
| `/reggie-repo-advisor` | Evaluate repo readiness for agent system |
| `/reggie-guide` | Topic-based help for the agent system |
| `/reggie-setup-workspace-docs` | Generate workspace CLAUDE.md + architecture docs for multi-repo workspaces |
| `/reggie-distribute-tasks` | Parse freeform notes into tasks and route them to correct repo TASKS.md files |

---

## Pipeline System

### How It Works

Every pipeline follows the same pattern:
1. The **main Claude orchestrates directly** — it reads the pipeline manager agent file for guidance, then launches specialized agents at each stage via the Task tool
2. After each stage agent returns, Claude launches the **reggie-judge** agent to score the output (9.0/10 threshold)
3. A **stage summary box** is printed after every stage showing score, summary, and next step
4. If a stage fails, the reggie-judge's feedback is fed back and the stage is re-run and re-judged
5. Quality gate pass = `git commit` (checkpoint)
6. Full pipeline pass = push-ready

**Why this architecture?** Subagents (launched via Task) cannot launch other subagents. Pipeline manager agents contain detailed orchestration guidance but run as reference docs, not as subagent orchestrators.

### Universal Flags

| Flag | Effect | Available On |
|------|--------|-------------|
| `--yes` | Skip all confirmation gates. Pipeline runs end-to-end without user input. Automated quality gates (9.0/10) still run. | All pipeline commands |
| `--opus` | Force `model: "opus"` on every agent launch. | `/reggie-code-workflow` |

### Quality Gate Escalation

When a stage fails its quality gate:

```
Attempt 1: Iterate with reggie-judge feedback
Attempt 2: Call reggie-researcher for new information, iterate again
Attempt 3: AUTO-TOURNAMENT — two agents compete, reggie-judge picks winner
Attempt 4: Escalate to user for guidance
```

### Feature Development Pipeline (`/reggie-code-workflow`)

```
PICKUP → IMPLEMENT → WRITE-TESTS → QUALITY-CHECK → SIMPLIFY
  → VERIFY-APP → REVIEW → SECURITY-REVIEW → SYNC-DOCS
  → UPDATE-CLAUDE → REVIEW-WITH-USER → COMMIT → COMPLETE
```

**REVIEW-WITH-USER**: After all automated checks pass, walks the user through each acceptance criterion from the task, showing what was built and asking for confirmation. Mismatches loop back to IMPLEMENT with specific feedback. Skipped for legacy tasks without acceptance criteria.

Each `→` is a quality gate. The pipeline manager orchestrates which agent runs at each stage.

### Parallel Task Execution

Multiple Claude sessions can work on different tasks in the same repo simultaneously using **git worktrees** — each task gets its own branch and working directory:

1. **Git worktree isolation**: Each task gets `.worktree/[slug]/` (full working copy on branch `task/[slug]`) — eliminates interleaved commits between parallel sessions
2. **Pipeline metadata isolation**: Each task gets `.pipeline/[slug]/` directory with its own `CONTEXT.md`, `HANDOFF.md`, and `DECISIONS.md` (stays in main repo)
3. **Shared TASKS.md**: All active tasks tracked under `## Active Tasks` with `### [slug]` subsections (includes Branch, Worktree, Base fields)
4. **Auto-pickup**: Running `/reggie-code-workflow` with no arguments auto-picks the next task from backlog and creates a worktree
5. **Conflict detection**: After PLAN passes, file lists are compared across active tasks. Overlapping files trigger a warning (worktrees prevent immediate breakage but warn about merge conflicts at completion)
6. **Merge strategies at completion**: Local merge (merge branch + delete), PR (push + create PR), or push only
7. **Clean completion**: The COMPLETE stage merges or pushes the branch, removes the worktree, removes the task's `### [slug]` section, and deletes `.pipeline/[slug]/`

Works across pipeline types — a `/reggie-code-workflow` session and an `/reggie-audit-workflow` session can run simultaneously with cross-pipeline conflict detection.

### Cross-Pipeline Task Sharing

The audit pipeline creates a prioritized backlog via AUDIT → PRIORITIZE. A `/reggie-code-workflow` session in another terminal can auto-pick tasks from that same backlog. Both pipelines share the same TASKS.md, and conflict detection works across pipeline types.

### Discovered Issues

Agents report unrelated issues they find during work under a `## Discovered Issues` heading. The orchestrator adds these to `### Ungroomed` at the bottom of `## Backlog` in TASKS.md after each stage. Ungroomed items are never auto-picked — they must go through `/reggie-init-tasks` for refinement first. This captures tech debt, bugs, and security problems without letting them enter the pipeline unrefined.

### Other Pipelines

| Pipeline | Command | Stages |
|----------|---------|--------|
| Audit | `/reggie-audit-workflow` | AUDIT → PRIORITIZE → [loop: IMPLEMENT → ... → COMMIT per task] |
| Article | `/reggie-article-workflow` | BRAINSTORM → RESEARCH → OUTLINE → DRAFT → EDIT → HUMAN-EDIT → [loop until satisfied] → REVIEW → PUBLISH |
| Social | `/reggie-social-workflow` | EXTRACT-SNIPPETS → ADAPT-PER-PLATFORM → REVIEW |
| Repo Setup | `/reggie-new-repo` | PROJECT-VISION (loop) → SCAFFOLD → SEED-MEMORY → CONFIGURE-TOOLS → GIT-INIT → CLAUDE-MD → DOCS → INITIAL-COMMIT → PUSH |
| Onboard | `/reggie-onboard` | DISCOVER → VALIDATE → ANALYZE → DOC-AUDIT → GENERATE → SEED-MEMORY → CONFIGURE-TOOLS → REFINE |
| Improve | `/reggie-improve` | TOOLING-CHECK → COLLECT → CLASSIFY → ANALYZE → PROPOSE → APPLY → VERIFY → CURATE |
| Evaluate | `/reggie-evaluation-system` | SCAN → EVALUATE → BRAINSTORM → PROPOSE → [IMPLEMENT → VERIFY] |
| System Change | `/reggie-system-change` | INTAKE → BRAINSTORM → PLAN → IMPLEMENT → VERIFY |

### MCP Tool Management

MCP (Model Context Protocol) servers extend agent capabilities with external tools (Firebase, browser automation, databases, etc.). The system manages MCP tools through:

- **`mcp-registry.yaml`** — Curated mapping of project signals to MCP servers with `relevant_agents` field for pipeline routing (versioned)
- **`skills-registry.yaml`** — Curated index of community Claude Code skills (SKILL.md-based playbooks) from Anthropic, awesome-claude-skills, and notable standalone repos (versioned)
- **`~/.claude/mcp-registry.local.yaml`** — Optional local overlay for user-specific MCP entries
- **`~/.claude/skills-registry.local.yaml`** — Optional local overlay for user-specific skill entries
- **`~/.claude/capability-manifest.yaml`** — Local generated index of ~200 capabilities (official plugins, community plugins, community skills, Smithery servers, local MCP cross-reference). Pipeline PICKUP builds a capability snapshot; `/reggie-init-tasks` RESEARCH+PLAN phase consults it to recommend tools and skills
- **`/reggie-find-tools`** — Scan a project and configure relevant MCP servers on demand
- **`/reggie-refresh-capabilities`** — Update the capability manifest from all sources (plugin marketplaces, skills registry, Smithery API, community repos)
- **CONFIGURE-TOOLS stage** — Automatically scan and configure during `/reggie-onboard` and `/reggie-new-repo`
- **TOOLING-CHECK stage** — Periodic drift check during `/reggie-improve` (unused servers, missing tools, stale manifest)
- **Pipeline MCP routing** — The orchestrator reads `.mcp.json` at pipeline start and tells each subagent which MCP tools are available via ToolSearch, keeping context cost at zero for agents that don't need them
- **Per-launch capability logging** — Each subagent launch is logged with its full capability profile (built-in tools, MCP routing, deferred tools, pre-loaded context, agent memory, estimated context tier)

Requires `ENABLE_TOOL_SEARCH=auto:5` to defer MCP schema loading in subagents.

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
- `sonnet` — Faster, good for straightforward tasks (system floor — all pipelines require at minimum sonnet)

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
---
type: pipeline
---

# My Command

Brief description.

## Context

\`\`\`bash
# Commands to gather context at invocation time
\`\`\`

## Instructions

What to do when `/my-command` is invoked.
```

The `type: pipeline` frontmatter is optional — add it for multi-stage workflow commands so tools like the Reggie app can classify them. Omit it for single-action commands.

### Voice Profile

The article pipeline includes a HUMAN-EDIT stage where the author reviews and edits the AI draft. Claude analyzes the edits to build a persistent voice profile at `~/.claude/voice-profile.md`. Over time, the reggie-content-producer and reggie-article-editor agents read this profile to match the author's natural writing voice — tone, word choices, sentence patterns, and structural preferences.

### Per-Project Context

Add a `CLAUDE.md` to any project root. Agents read this file to understand project-specific conventions, tech stack, and patterns. The `/reggie-new-repo` command creates this automatically.

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

**Pipeline stuck** — Run `/reggie-status` to see where you are, or describe what's wrong to the orchestrator.

---

## Version

```
Package version: 3.0.0
Last updated: 2026-03-09
Agents: 36
Commands: 35
Pipelines: 10 (code, audit, article, social, repo-setup, onboard, debug, improve, evaluate-reggie, reggie-system-change)
Features: Git worktree isolation for parallel tasks, branch-per-task with merge strategies, cross-pipeline task sharing, conflict detection, discovered issues → backlog, reggie-researcher as context builder, always-loaded language patterns in developer agents, onboard workflow for existing repos, conversational debug workflow with Socratic diagnosis, MCP tool management with three-layer routing, capability manifest for plugin/skill awareness, self-improvement loop with agent learnings, workspace-level task distribution across repos
```
