# Reggie Guide

Get answers about how Reggie's agent and pipeline system works.

## Context

```bash
echo "=== Available Commands ==="
ls ~/.claude/commands/ | sed 's/\.md$//' | sort

echo ""
echo "=== Available Agents ==="
ls ~/.claude/agents/ | sed 's/\.md$//' | sort

echo ""
echo "=== Voice Profile ==="
if [ -f .claude/voice-profile.md ]; then
  head -20 .claude/voice-profile.md
elif [ -f ~/.claude/voice-profile.md ]; then
  head -20 ~/.claude/voice-profile.md
else
  echo "No voice profile yet"
fi

echo ""
echo "=== Reggie Identity ==="
cat ~/.claude/REGGIE.md
```

## Instructions

Answer the user's question about the agent/pipeline system. If they didn't ask a specific question, show the quick reference below.

Use `$ARGUMENTS` to determine what they're asking about. Match their question to the relevant section and give a concise, helpful answer.

---

### Quick Reference (shown when no specific question)

```
Welcome to /reggie-guide — ask me anything about this system.

WORKFLOWS — start a pipeline
  /code-workflow                Full feature dev (14 stages, tasks predefined)
  /article-workflow        Write an article (brainstorm → publish)
  /article-workflow edit   Polish an existing draft
  /social-workflow         Turn content into social posts
  /design-workflow         Design mode pipeline (visual quality focus, human review)
  /audit-workflow          Audit and fix a codebase
  /debug-workflow          Conversational debugging (diagnose → fix)
  /onboard                 Prepare existing repo for agent system
  /port                    Port feature from another codebase
  /new-repo               Bootstrap a new project
  /improve                Process agent learnings, improve agent/command files
  /evaluate-reggie        Evaluate agent system architecture, propose improvements
  /reggie-system-change   Formalize known changes to agent system

PIPELINE CONTROLS — while inside a workflow
  /status                  Where am I? Current task and stage
  /back                    Go back one stage
  skip                     Skip current stage
  pause                    Save progress, exit workflow

INDIVIDUAL STAGES — run outside a pipeline
  /plan                    Design an implementation plan
  /implement               Hand off plan to developer agent
  /write-tests             Write tests
  /simplify                Clean up code
  /verify-app              End-to-end verification
  /code-review             Code review current changes
  /review-security         Security audit current changes
  /commit                  Commit with doc sync

UTILITIES
  /brainstorm              Think through something
  /research                Investigate a topic
  /debug                   Debug an issue
  /audit                   Audit a codebase
  /diagram                 Create architecture diagram
  /docs                    Write documentation
  /changelog               Update changelog
  /fix-tests               Fix failing tests
  /sync-docs               Sync all documentation
  /update-claude           Capture learnings in CLAUDE.md
  /repo-advisor            Evaluate repo's agent-readiness

HELP
  /reggie-guide            This help (you're here)

Try: /reggie-guide pipelines, /reggie-guide agents, /reggie-guide quality gates, /reggie-guide agent memory, /reggie-guide which command, /reggie-guide task management, /reggie-guide system evaluation, /reggie-guide system changes
```

---

### Topic: Pipelines

**What is a pipeline?**
A pipeline is a sequence of stages that takes work from start to finish. Each stage uses a specialized agent. Each stage's output goes through a quality gate (9.0/10 to advance). Quality gate pass = automatic git commit on the task's branch.

**Available pipelines:**

| Pipeline | Command | Stages |
|----------|---------|--------|
| Feature (tasks ready) | `/code-workflow` | PICKUP → RESEARCH → PLAN → IMPLEMENT → WRITE-TESTS → QUALITY-CHECK → SIMPLIFY → VERIFY-APP → REVIEW → SECURITY-REVIEW → SYNC-DOCS → UPDATE-CLAUDE → COMMIT → COMPLETE |
| Article | `/article-workflow` | BRAINSTORM → RESEARCH → OUTLINE → DRAFT → EDIT → HUMAN-EDIT → [loop until satisfied] → REVIEW → PUBLISH |
| Article (edit) | `/article-workflow edit` | HUMAN-EDIT → [satisfied?] → RESEARCH PLAN → RESEARCH → DRAFT → EDIT → HUMAN-EDIT (loop until satisfied) → REVIEW → PUBLISH |
| Social | `/social-workflow` | EXTRACT-SNIPPETS → ADAPT-PER-PLATFORM → REVIEW |
| Design | `/design-workflow` | PICKUP → RESEARCH → PLAN → IMPLEMENT → VERIFY-APP → REFINE → DESIGN-REVIEW → COMMIT → COMPLETE (design mode of code-workflow) |
| Audit | `/audit-workflow` | AUDIT → PRIORITIZE → [loop: RESEARCH → PLAN → IMPLEMENT → WRITE-TESTS → QUALITY-CHECK → SIMPLIFY → VERIFY-APP → REVIEW → SECURITY-REVIEW → SYNC-DOCS → COMMIT per task] |
| Repo Setup | `/new-repo` | PROJECT-VISION (loop with 4 agents until satisfied) → SCAFFOLD → GIT-INIT → CLAUDE-MD → DOCS → INITIAL-COMMIT → PUSH |
| Port Feature | `/port` | ANALYZE → PLAN → IMPLEMENT → VERIFY |
| Onboard | `/onboard` | DISCOVER → VALIDATE → ANALYZE → DOC-AUDIT → GENERATE → SEED-MEMORY → REFINE |
| Improve | `/improve` | COLLECT → CLASSIFY → ANALYZE → PROPOSE → APPLY → VERIFY → CURATE |

**How stages connect:**
The pipeline-manager maintains a cumulative `.pipeline/[slug]/CONTEXT.md` per task (in the main repo). Each agent's output is added verbatim (never summarized). The next agent gets relevant context from it. Agents have autonomy — the context is reference material, not rigid orders. The **researcher** agent builds the initial context by searching the codebase and web, calibrated to task complexity. Code-modifying agents work in the task's worktree (`.worktree/[slug]/`), while pipeline metadata stays in the main repo.

**Cross-pipeline task sharing:**
The audit pipeline (AUDIT → PRIORITIZE) populates a backlog in TASKS.md. A `/code-workflow` session in another terminal can auto-pick tasks from that same backlog. Both pipelines share the same TASKS.md, each task gets its own worktree and branch, and conflict detection works across pipeline types.

---

### Topic: Agents

**What is an agent?**
An agent is a specialized AI subprocess that Claude Code launches via the Task tool. Each agent has a defined role, specific tools it can access, and a structured output format. You don't invoke agents directly — commands and pipelines invoke them for you.

**Agent categories:**

| Category | Agents |
|----------|--------|
| Developers (8) | ios-developer, android-developer, web-developer, typescript-developer, go-developer, python-developer, cloud-engineer, firebase-debugger |
| Quality (7) | code-architect, judge, qa-engineer, app-tester, refactorer, code-reviewer, security-reviewer |
| Research (5) | researcher, thought-partner, claude-architect, feature-analyzer, codebase-debugger |
| Design (2) | design-innovator, visual-architect |
| Content (4) | content-producer, social-media-strategist, editor, technical-writer |
| Pipeline Managers (10) | pipeline-manager, audit-pipeline-manager, content-pipeline-manager, port-pipeline-manager, repo-bootstrapper, onboard-pipeline-manager, debug-pipeline-manager, improve-pipeline-manager, evaluate-reggie-manager, reggie-system-change-manager |
| Utilities (1) | repo-advisor |

**Where do they live?**
`~/.claude/agents/` — each is a markdown file with YAML frontmatter defining name, description, tools, model, and memory type. Each agent has `memory: project` (per-project learnings) or `memory: user` (global learnings).

---

### Topic: Quality Gates

**How do quality gates work?**
Every stage output is scored by the judge agent. Threshold is 9.0/10. Below that, automatic escalation:

```
Attempt 1: Iterate with judge feedback
Attempt 2: Call researcher for new context, iterate again
Attempt 3: AUTO-TOURNAMENT — two agents compete, judge picks winner
Attempt 4: Escalate to user
```

**What is a tournament?**
When a stage fails its quality gate repeatedly, the system automatically runs two agents on the same stage independently. The judge evaluates both outputs blind and picks the winner. You can also say "tournament" at any stage to force it.

**What stages can tournament?**
BRAINSTORM, RESEARCH, PLAN, IMPLEMENT, TEST, DRAFT, OUTLINE, EDIT

**What stages can't tournament?**
PICKUP, COMMIT, PUSH, HUMAN-EDIT (mechanical or requires human)

---

### Topic: Voice Profile

**What is the voice profile?**
A persistent file at `.claude/voice-profile.md` (project-level) that captures your writing personality. Falls back to `~/.claude/voice-profile.md` (system-level general voice) if no project-level profile exists. Built during the HUMAN-EDIT stage of the article pipeline.

**How does it work?**
1. Claude saves a snapshot of the AI draft
2. You edit the file however you want
3. Claude diffs your version against the snapshot
4. Patterns in your edits (word choices, tone, structure, cuts) get documented
5. Future articles read the profile before drafting and editing

**How do I build it?**
Run `/article-workflow` or `/article-workflow edit path/to/draft.md` and make edits during HUMAN-EDIT. The more you change, the more Claude learns.

---

### Topic: Context Document

**What is CONTEXT.md?**
A cumulative document the pipeline-manager maintains during a pipeline run. Each stage's key outputs are appended verbatim. The next agent receives relevant sections as context. It lives at `.pipeline/[task-slug]/CONTEXT.md` in the main repo — each task gets its own isolated context.

**How is it different from TASKS.md and the worktree?**
- `TASKS.md` tracks task status, stage, scores, branch info — the pipeline's state machine (all tasks in one file, main repo)
- `.pipeline/[slug]/CONTEXT.md` tracks the actual content — research findings, plans, implementation notes, decisions (one per task, main repo)
- `.worktree/[slug]/` is the code workspace — where agents read and write project files (one per task, separate branch)

**What survives context compaction?**
TASKS.md, `.pipeline/[slug]/CONTEXT.md`, `.pipeline/[slug]/HANDOFF.md`, and `.pipeline/[slug]/DECISIONS.md` are all re-read if the conversation context gets compacted. The worktree and its branch persist on disk — if the worktree is missing on resume, it's recreated from the branch.

---

### Topic: Parallel Tasks

**Can I run multiple tasks at the same time?**
Yes. Open multiple terminal windows and run `/code-workflow` in each. Each session auto-picks a different task from the backlog and gets its own **git worktree** — a full working copy of the repo on a dedicated branch (`task/[slug]`). This eliminates interleaved commits between parallel sessions.

**How does it work?**
1. Terminal 1: `/code-workflow` — picks up task 1 from backlog, creates `.worktree/task-1/` on branch `task/task-1`
2. Terminal 2: `/code-workflow` — auto-picks task 2, creates `.worktree/task-2/` on branch `task/task-2`
3. Both work through their pipelines simultaneously in isolated directories
4. TASKS.md shows both under `## Active Tasks` (with **Branch**, **Worktree**, **Base** fields)
5. `.pipeline/` has both task's metadata directories
6. `.worktree/` has both task's working copies

**What is a worktree?**
A git worktree is a separate working directory linked to the same repository. Each worktree has its own branch and files. Changes in one worktree don't affect another. At completion, the branch is merged back (or pushed as a PR).

**What about file conflicts?**
Worktrees isolate work so there's no immediate breakage. But overlapping files will cause merge conflicts at completion. After PLAN passes, the system still checks for overlapping files and warns you. Options: proceed (accept merge risk), wait, rethink, or abort.

**What happens at completion?**
You choose a merge strategy:
- **Local merge**: Removes worktree, merges branch into base, deletes branch
- **PR**: Pushes branch, creates a pull request, removes worktree
- **Push only**: Pushes branch, removes worktree (you merge later)

**How many tasks can run in parallel?**
There's no hard limit, but you'll get a warning if > 3 tasks are active. More tasks = more merge risk. Each worktree is a full copy of the repo, so disk space is a consideration.

**Does it work with audit-workflow too?**
Yes. Each audit task gets its own worktree and branch. If an audit task wants to modify files claimed by a `/code-workflow` session, conflict detection fires.

**Can I use code-workflow to pull tasks from an audit?**
Yes. Run `/audit-workflow` to AUDIT and PRIORITIZE — this populates the backlog. Then open another terminal and run `/code-workflow` — it auto-picks from the same backlog. Both pipelines share TASKS.md, conflict detection works across them, and each gets its own worktree. Let the audit workflow pick up its first task before launching the second terminal to avoid a race on the same backlog item.

---

### Topic: Researcher & Context Building

**What does the researcher do?**
The researcher's primary job is to build context for downstream agents (architect, implementer, reviewers). It searches the codebase first, then the web, and writes its findings into `.pipeline/[slug]/CONTEXT.md`. This context is the foundation every subsequent agent builds on.

**How does it decide how much to research?**
It calibrates depth to task complexity:
- **Simple** (rename, add constant, fix typo): Quick codebase scan, 5-10 lines of context
- **Moderate** (refactor pattern, add validation): Codebase scan + relevant conventions, 20-40 lines
- **Complex** (architecture change, security overhaul): Deep scan + web research, 40-80 lines

**Why codebase first?**
Existing patterns, modules, and conventions in the codebase are the most relevant context. Web research fills gaps — best practices, library docs, solutions to specific problems.

---

### Topic: Discovered Issues

**What happens when an agent finds unrelated problems?**
Every agent prompt includes: "If you discover unrelated issues, list them under `## Discovered Issues` at the end of your output." After each stage, the orchestrator checks for discovered issues and adds them to `## Backlog` in TASKS.md.

**Why?**
Agents see code deeply during their work. A security reviewer might spot a performance issue. An implementer might notice tech debt in a neighboring file. Rather than fixing them (scope creep), they report them so they get tracked and prioritized properly.

**Does this work in all pipelines?**
Yes — both `/code-workflow` and `/audit-workflow` include this instruction for every agent prompt.

---

### Topic: Customization

**Adding an agent:**
Create a file in `~/.claude/agents/`:
```yaml
---
name: my-agent
description: "When to use this agent. Examples: (1) 'trigger phrase 1', (2) 'trigger phrase 2'"
tools: Glob, Grep, Read
model: opus
memory: project
---
You are a [role]...

## Process

### Step 0: Consult Memory
Review agent memory for project context.

[... your steps ...]

### Final: Update Memory
Record significant learnings.
```

**Adding a command:**
Create a file in `~/.claude/commands/`:
```markdown
# My Command
Brief description.
## Context
\`\`\`bash
# Gather context at invocation
\`\`\`
## Instructions
What to do when /my-command is invoked.
```

**Per-project context:**
Add a `CLAUDE.md` to any project root. Agents read this to understand project-specific conventions.

**Per-project agent memory:**
Agents store project-specific learnings in `.claude/agent-memory/<agent>/MEMORY.md`. This is created automatically by `/onboard` and `/new-repo`.

---

### Topic: Self-Improvement (/improve)

**What is the improve pipeline?**
A two-level feedback loop that makes agents better over time. Every pipeline run captures learnings about agent behavior — quality gate failures, iteration patterns, missed context. These accumulate in `~/.claude/AGENT-IMPROVE.md` with a classification tag.

**The pipeline (7 stages):**
```
COLLECT → CLASSIFY → ANALYZE → PROPOSE → APPLY → VERIFY → CURATE
```

**How does classification work?**
Each learning is classified and routed to the correct target:

| Classification | Target | Location |
|---------------|--------|----------|
| UNIVERSAL | System agent files | `~/.claude/agents/*.md` |
| PROJECT | Project agent memory | `.claude/agent-memory/<agent>/MEMORY.md` |
| PROCESS | Command files | `~/.claude/commands/*.md` |
| FORK-CANDIDATE | Suggest project fork | `.claude/agents/<agent>.md` |

**What's the tiered system?**
- **Minor changes** (auto-applied): Common Pitfalls, Quality Standards, memory entries
- **Major changes** (need approval): Process, Role, Tools, Output Format, Core Responsibilities
- **Fork proposals** (always need approval): When project needs fundamentally different agent behavior

**Key files:**
- `~/.claude/AGENT-IMPROVE.md` — Accumulator (persistent until processed)
- `~/.claude/IMPROVE-CHANGELOG.md` — Record of all changes made
- `~/.claude/agents/improve-pipeline-manager.md` — Pipeline reference doc
- `~/.claude/commands/improve.md` — Command to invoke

**Arguments:**
- `/improve` — Process all learnings
- `/improve --dry-run` — Preview without applying
- `/improve --curate-only` — Only run memory maintenance
- `/improve --minor-only` — Only auto-apply minor changes

**Safety:** Max 15 system changes/run (memory entries don't count). Never auto-deletes content. Never auto-modifies frontmatter. All changes logged. 3+ changes to same file triggers manual review. Fork proposals always require approval with trade-off analysis.

---

### Topic: Task Management

**What is the task format?**
Tasks in TASKS.md support priority tags, dependency tags, and optional context blocks:

```markdown
## Backlog

### Authentication & Security
- [ ] add-jwt-auth: Add JWT authentication to login endpoint [P1]
  > Middleware at src/middleware/auth.ts currently uses sessions.
  > Need to support both JWT and session during migration period.
- [ ] implement-rbac: Implement role-based access control [P2] [depends: add-jwt-auth]

### Dashboard UI
- [ ] fix-responsive-cards: Fix responsive layout on dashboard cards [P2]
- [ ] add-loading-skeletons: Add loading skeletons to data tables [P3]
```

**Priority tags**: `[P1]` (critical/blocking), `[P2]` (standard, default), `[P3]` (nice-to-have). Assigned by `/init-tasks` ORGANIZE phase. Tasks without tags default to P2.

**Dependency tags**: `[depends: slug]` or `[depends: slug-a, slug-b]`. Mapped by `/init-tasks` ORGANIZE phase using code-architect analysis. Auto-pickup skips tasks with unmet dependencies.

**Context blocks**: Indented `>` lines under a task provide richer detail. Optional — saves the researcher time when available.

**How does auto-pickup work?**
Auto-pickup is priority-aware and dependency-respecting: it scans all `- [ ]` items, filters out tasks with unmet dependencies, then picks the highest priority task (P1 > P2 > P3). Within the same priority, it picks first in document order.

**How are groups created?**
`/init-tasks` uses code-architect to analyze your project structure and group tasks into areas of focus. You can also create sections manually.

**How do I refine ungroomed items?**
Run `/init-tasks` — if `### Ungroomed` has items, it offers to refine them. They go through DEEPEN for acceptance criteria, then ORGANIZE moves them to proper sections with priorities and dependencies.

**Where do discovered issues go?**
Into `### Ungroomed` at the bottom of `## Backlog`. They stay there until refined via `/init-tasks`. Auto-pickup never selects ungroomed items.

**How is pipeline stage tracked?**
Each active task has a `.pipeline/[slug]/STAGE` file that stores the current stage (e.g., `IMPLEMENT`). This is updated on every stage transition and read by `/status`.

**Can I use a flat backlog?**
Yes. Section headers are optional. A backlog with no `### ` headers works exactly as before.

---

### Topic: Common Questions

**How do I skip a stage?**
Say "skip" during any pipeline run.

**How do I go back?**
Say "back" or "back to [stage name]".

**How do I pause and resume?**
Say "pause" to save progress. Run the workflow command again to resume. Your worktree and branch persist on disk — if the worktree is missing on resume, it's automatically recreated from the branch.

**How do I see where I am?**
Run `/status`.

**What if the quality gate keeps failing?**
The system escalates automatically: iterate → research → tournament → ask you. If you want to force it forward, say "skip".

**Can I run stages individually outside a pipeline?**
Yes. Commands like `/plan`, `/implement`, `/code-review`, `/review-security` etc. work standalone.

---

### Topic: Onboarding

**What is /onboard?**
A 7-stage workflow that prepares any existing repository for the Claude Code agent system. It discovers the codebase structure, validates build/test commands work, analyzes patterns and conventions, audits existing documentation, generates CLAUDE.md and supporting files, seeds agent memory based on the tech stack, and optionally prunes outdated docs.

**When to use it:**

- Fresh clone of a repo you've never worked in
- Existing project without CLAUDE.md
- Inherited codebase that needs documentation
- Any repo before running /audit or /code-workflow

**Stages:**

| Stage | Purpose | Skippable |
|-------|---------|-----------|
| DISCOVER | Map structure, tech stack, docs | No |
| VALIDATE | Run build/test to verify they work | `--skip-tests` |
| ANALYZE | Identify patterns and conventions | No |
| DOC-AUDIT | Assess existing docs for signal vs noise | No |
| GENERATE | Create CLAUDE.md, TASKS.md, .pipeline/ | No |
| SEED-MEMORY | Create agent memory directories based on stack | No |
| REFINE | Prune/update docs per audit | `--no-prune` |

**Human checkpoints:**

- After ANALYZE: Confirm pattern findings are accurate
- After GENERATE: Review CLAUDE.md before committing

**What gets created:**

- `CLAUDE.md` — Project context for agents
- `TASKS.md` — Empty task tracker
- `.pipeline/.gitkeep` — Pipeline metadata directory
- `MEMORY.md` — Project memory (in ~/.claude/projects/)
- `.claude/agent-memory/` — Initial agent memory for relevant agents (based on detected tech stack)

**Examples:**

```bash
/onboard                    # Full onboard
/onboard --skip-tests       # Skip build/test validation
/onboard --no-prune         # Don't touch existing docs
```

**How is this different from /new-repo?**

- `/new-repo` creates a NEW project from scratch (scaffolding, initial files)
- `/onboard` prepares an EXISTING project for the agent system (discovery, doc audit)

---

### Topic: Agent Memory

**What is agent memory?**
Agents accumulate project-specific knowledge in memory files that persist across sessions. Each agent has a `MEMORY.md` that's auto-loaded (first 200 lines) into its system prompt every time it runs. Agents read memory at start (Step 0) and write learnings at end (Final step).

**Two-tier memory system:**

| Level | Location | Purpose |
|-------|----------|---------|
| System agents | `~/.claude/agents/` | Global behavior, shared across all projects |
| Project agent memory | `.claude/agent-memory/<agent>/MEMORY.md` | Per-project knowledge (conventions, gotchas, patterns) |
| Project agent forks | `.claude/agents/<agent>.md` (in project) | Full agent override (rare, for fundamental divergence) |

**Memory types:**
- **`memory: project`** — Work agents (developers, reviewers, testers). Memory lives in the project at `.claude/agent-memory/<agent>/MEMORY.md`.
- **`memory: user`** — Pipeline managers and system agents. Memory lives globally at `~/.claude/agent-memory/<agent>/MEMORY.md`.

**How is memory created?**
- `/onboard` and `/new-repo` run a SEED-MEMORY stage that creates initial memory for relevant agents based on the detected tech stack
- Agents update their own memory after each task (conventions found, gotchas discovered, patterns confirmed)
- `/improve --curate-only` prunes stale entries and enforces the 200-line cap

**How does /improve use memory?**
When processing learnings, `/improve` classifies each one:
- **UNIVERSAL** learnings → update system agent files (applies everywhere)
- **PROJECT** learnings → update project agent memory (applies to this project only)
- **PROCESS** learnings → update command files (workflow changes)

**Is memory committed to git?**
No. `.claude/agent-memory/` and `.claude/research-cache/` are `.gitignore`d. They're local developer knowledge, not shared code.

**What is the research cache?**
The researcher writes structured findings to `.claude/research-cache/` after moderate and complex research tasks. Each cache file has a topic, keywords, timestamp, and the actual findings. On subsequent tasks, the researcher checks the cache first — if a relevant entry exists and is less than 90 days old, it uses the cached findings (with a git delta check for file changes). This prevents redundant research on the same codebase areas.

---

### Topic: Which Command Should I Use?

**I want to...**

| Goal | Command | Notes |
|------|---------|-------|
| Build a new feature (tasks already defined) | `/code-workflow` | Full 14-stage pipeline |
| Explore a feature idea first, then build | `/init-tasks` + `/code-workflow` | Brain dump → task breakdown → code-workflow |
| Fix a bug (I know the cause) | `/code-workflow` | Create a task, use the pipeline |
| Fix a bug (unclear root cause) | `/debug-workflow` | Socratic diagnosis → handoff to code-workflow |
| Quickly investigate a bug | `/debug` | Lightweight, no pipeline |
| Audit codebase health | `/audit-workflow` | Full pipeline: audit → prioritize → fix loop |
| Quick codebase assessment | `/audit` | One-shot audit, no fixes |
| Set up a new project | `/new-repo` | Scaffold → git → docs → push |
| Prepare an existing repo for agents | `/onboard` | Discovery → CLAUDE.md → agent memory |
| Write a technical article | `/article-workflow` | Brainstorm → draft → edit → publish |
| Create social media posts | `/social-workflow` | Extract → adapt per platform → review |
| Design a UI feature | `/design-workflow` | Design mode pipeline with visual quality focus and human review |
| Port a feature from another codebase | `/port` | Analyze → plan → implement → verify |
| Plan an implementation (no coding) | `/plan` | Produces an architect plan only |
| Review code I just wrote | `/code-review` | Structured code review of current diff |
| Check for security issues | `/review-security` | Security audit of current changes |
| Brainstorm or think through something | `/brainstorm` | Conversational thinking partner |
| Research a topic | `/research` | Investigative research with evidence |
| Create new agents or workflows | `/reggie-system-change` | Intake → brainstorm → plan → implement → verify |
| Process agent learnings | `/improve` | Two-level improve pipeline |
| Evaluate the agent system itself | `/evaluate-reggie` | Architecture review, not per-agent learnings |
| Formalize a known system change | `/reggie-system-change` | Change request already known, structured implementation |
| Check if this repo is ready for agents | `/repo-advisor` | Per-project readiness, prescriptions, drift |

---

### Topic: System Evaluation (/evaluate-reggie)

**What is /evaluate-reggie?**
A periodic architectural review of the ~/.claude/ agent system. Unlike /improve (which processes per-agent learnings from pipeline runs), /evaluate-reggie steps back and evaluates the whole system: are there missing agents, redundant commands, outdated patterns, or broken integrations?

**The pipeline:**
`SCAN → EVALUATE → BRAINSTORM → PROPOSE → [IMPLEMENT → VERIFY]`

| Stage | Agent | Purpose |
|-------|-------|---------|
| SCAN | researcher | Full inventory of all agents and commands |
| EVALUATE | claude-architect | Analyze for gaps, redundancies, drift |
| BRAINSTORM | thought-partner | Discuss findings with user, prioritize |
| PROPOSE | claude-architect | Concrete improvement proposals |
| IMPLEMENT | Main Claude | Execute approved proposals (optional, `--implement` flag) |
| VERIFY | researcher | Validate consistency after changes (after IMPLEMENT) |

**No numeric quality gates.** Uses confirmation-based gates. The user decides what matters.

**Arguments:**
- `/evaluate-reggie` — Full evaluation (SCAN through PROPOSE)
- `/evaluate-reggie --scan-only` — Just produce the inventory
- `/evaluate-reggie --implement` — Evaluate, execute, and verify approved proposals

**How is this different from /improve?**
- `/improve` processes AGENT-IMPROVE.md entries — specific learnings from pipeline runs
- `/evaluate-reggie` evaluates system architecture — structural gaps, redundancies, drift
- They're complementary: /improve handles tactical refinements, /evaluate-reggie handles strategic review

---

### Topic: System Changes (/reggie-system-change)

**What is /reggie-system-change?**
The unified pipeline for formalizing changes to the ~/.claude/ agent system — both modifying existing components and creating new ones. Unlike /evaluate-reggie (which discovers issues), this pipeline starts with a known change request and walks it through brainstorming, planning, implementation, and verification.

**The pipeline:**
`INTAKE → BRAINSTORM → PLAN → IMPLEMENT → VERIFY`

| Stage | Agent | Purpose |
|-------|-------|---------|
| INTAKE | Main Claude | Capture the change request |
| BRAINSTORM | thought-partner | Explore design space (quick if obvious) |
| PLAN | claude-architect | File-by-file change plan with classifications and validation |
| IMPLEMENT | Main Claude | Apply edits, create new files, update integration docs |
| VERIFY | researcher | Validate consistency after changes |

**On-demand research.** BRAINSTORM and PLAN can dispatch the researcher agent when questions arise about current system state. Research is not a sequential stage — it's available when needed.

**Change classifications:**
- `direct-edit` — Modify existing file inline
- `new-component` — Create new agent/command/workflow with validation (reads similar files first, validates structure)
- `integration-update` — Update PORTABLE-PACKAGE.md, guide.md, MEMORY.md

**Quality gates:** Confirmation-based for most changes. When the plan includes `new-component` changes, the PLAN goes through judge scoring (9.0/10) to validate design quality.

**How is this different from other system commands?**
- `/evaluate-reggie` — Discovers issues (you do NOT know what to change yet)
- `/improve` — Processes accumulated per-agent learnings
- `/reggie-system-change` — Formalizes a known change, creates new components, modifies existing ones

