# Reggie Guide

Get answers about how Reggie works. Reggie turns your backlog into a parallel build queue -- it organizes your to-dos into structured tasks, then executes them in parallel across specialized agents.

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

Reggie turns your backlog into a parallel build queue.
Dump your to-dos, Reggie organizes and executes them.

THE PRIMARY WORKFLOW

  Step 1: Brain dump your tasks into TASKS.md (any format —
          bullet points, notes, half-formed ideas)
  Step 2: /reggie-init-tasks — turns raw notes into implementation-
          ready tasks (researches codebase, asks questions,
          builds plans)
  Step 3: /reggie-code-workflow (×N in parallel) — open as many
          terminals as you want, each picks a different task
          and works in its own git worktree (implement → test
          → review → commit). Quality gates handle retries.

  That's it. /reggie-init-tasks plans, /reggie-code-workflow executes.

OTHER WORKFLOWS
  /reggie-article-workflow        Write an article (brainstorm → publish)
  /reggie-article-workflow edit   Polish an existing draft
  /reggie-social-workflow         Turn content into social posts
  /reggie-audit-workflow          Audit and fix a codebase
  /reggie-debug-workflow          Conversational debugging (diagnose → fix)
  /reggie-onboard                 Prepare existing repo for agent system
  /reggie-new-repo               Bootstrap a new project
  /reggie-improve                Process agent learnings, improve agent/command files
  /reggie-evaluation-system        Evaluate agent system architecture, propose improvements
  /reggie-system-change   Formalize known changes to agent system

PIPELINE CONTROLS — while inside a workflow
  /reggie-status                  Where am I? Current task and stage
  /back                    Go back one stage
  skip                     Skip current stage
  pause                    Save progress, exit workflow

INDIVIDUAL STAGES — run outside a pipeline
  /reggie-plan                    Design an implementation plan
  /reggie-write-tests             Write tests
  /reggie-simplify                Clean up code
  /reggie-verify-app              End-to-end verification
  /reggie-code-review             Code review current changes
  /reggie-review-security         Security audit current changes
  /reggie-commit                  Commit with doc sync

UTILITIES
  /reggie-brainstorm              Think through something
  /reggie-research                Investigate a topic
  /reggie-debug                   Debug an issue
  /reggie-audit                   Audit a codebase
  /reggie-diagram                 Create architecture diagram
  /reggie-docs                    Write documentation
  /reggie-changelog               Update changelog
  /reggie-fix-tests               Fix failing tests
  /reggie-sync-docs               Sync all documentation
  /reggie-update-claude           Capture learnings in CLAUDE.md
  /reggie-repo-advisor            Evaluate repo's agent-readiness
  /reggie-find-tools              Scan project, configure MCP servers
  /reggie-refresh-capabilities    Update capability manifest from all sources
  /reggie-setup-workspace-docs    Generate workspace CLAUDE.md + architecture doc
  /reggie-distribute-tasks        Parse notes into tasks, route to correct repos

HELP
  /reggie-guide            This help (you're here)

Try: /reggie-guide pipelines, /reggie-guide agents, /reggie-guide quality gates, /reggie-guide agent memory, /reggie-guide which command, /reggie-guide task management, /reggie-guide system evaluation, /reggie-guide system changes, /reggie-guide mcp tools, /reggie-guide foundational docs, /reggie-guide installation
```

---

### Topic: Universal Flags

**`--yes` (Ralph Wiggum mode)**

Auto-approve ALL confirmation gates in any pipeline command. The pipeline runs end-to-end without stopping for user input — no stage confirmations, no approval prompts, no human review gates. Full send.

- **Applies to**: All pipeline commands (`/reggie-code-workflow`, `/reggie-system-change`, `/reggie-evaluation-system`, `/reggie-improve`, `/reggie-audit-workflow`, `/reggie-article-workflow`, `/reggie-social-workflow`, `/reggie-debug-workflow`, `/reggie-onboard`)
- **Does NOT bypass**: Automated quality gates (9.0/10 reggie-judge scoring still runs and iterates)
- **Usage**: Append `--yes` to any pipeline command, e.g. `/reggie-code-workflow --yes`, `/reggie-system-change --yes [description]`

**`--opus`**

Force `model: "opus"` on every agent launch for the entire pipeline run. Available on `/reggie-code-workflow`.

---

### Topic: Pipelines

**What is a pipeline?**
A pipeline is a sequence of stages that takes work from start to finish. Each stage uses a specialized agent. Each stage's output goes through a quality gate (9.0/10 to advance). Quality gate pass = automatic git commit on the task's branch.

**The primary pipeline (init-tasks → code-workflow):**

| Phase | Command | What it does |
|-------|---------|--------------|
| Brain dump | TASKS.md | Write tasks in any format (bullet points, notes, ideas) |
| Planning | `/reggie-init-tasks` | Reads TASKS.md → codebase research → collaborative Q&A → task grouping → implementation plans |
| Execution | `/reggie-code-workflow` | PICKUP → IMPLEMENT → WRITE-TESTS → QUALITY-CHECK → SIMPLIFY → VERIFY-APP → REVIEW → SECURITY-REVIEW → SYNC-DOCS → UPDATE-CLAUDE → REVIEW-WITH-USER → COMMIT → COMPLETE |
| Parallel | `/reggie-code-workflow` (×N) | Each terminal auto-picks a different task, works in its own git worktree |

**Other pipelines:**

| Pipeline | Command | Stages |
|----------|---------|--------|
| Article | `/reggie-article-workflow` | BRAINSTORM → RESEARCH → OUTLINE → DRAFT → EDIT → HUMAN-EDIT → [loop until satisfied] → REVIEW → PUBLISH |
| Article (edit) | `/reggie-article-workflow edit` | HUMAN-EDIT → [satisfied?] → RESEARCH PLAN → RESEARCH → DRAFT → EDIT → HUMAN-EDIT (loop until satisfied) → REVIEW → PUBLISH |
| Social | `/reggie-social-workflow` | EXTRACT-SNIPPETS → ADAPT-PER-PLATFORM → REVIEW |
| Audit | `/reggie-audit-workflow` | AUDIT → PRIORITIZE → [loop: RESEARCH → PLAN → IMPLEMENT → WRITE-TESTS → QUALITY-CHECK → SIMPLIFY → VERIFY-APP → REVIEW → SECURITY-REVIEW → SYNC-DOCS → COMMIT per task] |
| Repo Setup | `/reggie-new-repo` | PROJECT-VISION (loop with 4 agents until satisfied) → SCAFFOLD → SEED-MEMORY → CONFIGURE-TOOLS → GIT-INIT → CLAUDE-MD → DOCS → INITIAL-COMMIT → PUSH → handoff to `/reggie-init-tasks` |
| Onboard | `/reggie-onboard` | DISCOVER → VALIDATE → ANALYZE → DOC-AUDIT → GENERATE → SEED-MEMORY → CONFIGURE-TOOLS → REFINE → handoff to `/reggie-init-tasks` |
| Improve | `/reggie-improve` | TOOLING-CHECK → COLLECT → CLASSIFY → ANALYZE → PROPOSE → APPLY → VERIFY → CURATE |

**How stages connect:**
The reggie-code-manager maintains a cumulative `.pipeline/[slug]/CONTEXT.md` per task (in the main repo). Each agent's output is added verbatim (never summarized). The next agent gets relevant context from it. Agents have autonomy — the context is reference material, not rigid orders. The **reggie-researcher** agent builds the initial context by searching the codebase and web, calibrated to task complexity. Code-modifying agents work in the task's worktree (`.worktree/[slug]/`), while pipeline metadata stays in the main repo.

**Cross-pipeline task sharing:**
The audit pipeline (AUDIT → PRIORITIZE) populates a backlog in TASKS.md. A `/reggie-code-workflow` session in another terminal can auto-pick tasks from that same backlog. Both pipelines share the same TASKS.md, each task gets its own worktree and branch, and conflict detection works across pipeline types.

---

### Topic: Agents

**What is an agent?**
An agent is a specialized AI subprocess that Claude Code launches via the Task tool. Each agent has a defined role, specific tools it can access, and a structured output format. You don't invoke agents directly — commands and pipelines invoke them for you. Work agents (developers, reviewers, testers, reggie-code-architect, reggie-refactorer) read relevant foundational docs from `docs/` at Step 1 before starting their main work. Non-technical agents (reggie-thought-partner, reggie-design-innovator) read `docs/soul.md` for product context.

**Agent categories:**

| Category | Agents |
|----------|--------|
| Developers (9) | reggie-ios-developer, reggie-android-developer, reggie-web-developer, reggie-typescript-developer, reggie-go-developer, reggie-python-developer, reggie-rust-developer, reggie-cloud-engineer, reggie-firebase-debugger |
| Quality (7) | reggie-code-architect, reggie-judge, reggie-qa-engineer, reggie-app-tester, reggie-refactorer, reggie-code-reviewer, reggie-security-reviewer |
| Research (4) | reggie-researcher, reggie-thought-partner, reggie-claude-architect, reggie-codebase-debugger |
| Design (2) | reggie-design-innovator, reggie-visual-architect |
| Content (4) | reggie-content-producer, reggie-social-media-strategist, reggie-article-editor, reggie-technical-writer |
| Pipeline Managers (9) | reggie-code-manager, reggie-audit-manager, reggie-content-manager, reggie-bootstrap-manager, reggie-onboard-manager, reggie-debug-manager, reggie-improve-manager, reggie-evaluate-manager, reggie-system-change-manager |
| Utilities (1) | reggie-repo-advisor |

**Where do they live?**
`~/.claude/agents/` — each is a markdown file with YAML frontmatter defining name, description, tools, model, and memory type. Each agent has `memory: project` (per-project learnings) or `memory: user` (global learnings).

---

### Topic: Quality Gates

**How do quality gates work?**
Every stage output is scored by the reggie-judge agent. Threshold is 9.0/10. Below that, automatic escalation:

```
Attempt 1: Iterate with reggie-judge feedback
Attempt 2: Call reggie-researcher for new context, iterate again
Attempt 3: AUTO-TOURNAMENT — two agents compete, reggie-judge picks winner
Attempt 4: Escalate to user
```

**What is a tournament?**
When a stage fails its quality gate repeatedly, the system automatically runs two agents on the same stage independently. The reggie-judge evaluates both outputs blind and picks the winner. You can also say "tournament" at any stage to force it.

**What stages can tournament?**
BRAINSTORM, IMPLEMENT, TEST, DRAFT, OUTLINE, EDIT

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
Run `/reggie-article-workflow` or `/reggie-article-workflow edit path/to/draft.md` and make edits during HUMAN-EDIT. The more you change, the more Claude learns.

---

### Topic: Context Document

**What is CONTEXT.md?**
A cumulative document the reggie-code-manager maintains during a pipeline run. Each stage's key outputs are appended verbatim. The next agent receives relevant sections as context. It lives at `.pipeline/[task-slug]/CONTEXT.md` in the main repo — each task gets its own isolated context.

**How is it different from TASKS.md and the worktree?**
- `TASKS.md` tracks task status, stage, scores, branch info — the pipeline's state machine (all tasks in one file, main repo)
- `.pipeline/[slug]/CONTEXT.md` tracks the actual content — research findings, plans, implementation notes, decisions (one per task, main repo)
- `.worktree/[slug]/` is the code workspace — where agents read and write project files (one per task, separate branch)

**What survives context compaction?**
TASKS.md, `.pipeline/[slug]/CONTEXT.md`, `.pipeline/[slug]/HANDOFF.md`, and `.pipeline/[slug]/DECISIONS.md` are all re-read if the conversation context gets compacted. The worktree and its branch persist on disk — if the worktree is missing on resume, it's recreated from the branch.

---

### Topic: Foundational Docs

**What are foundational docs?**
Standardized documentation files in `docs/` that agents read before starting work. They provide project-level context about architecture, conventions, data models, and design — the stable knowledge that applies across all tasks in a project.

**Which docs exist?**

| File | Contents | When created |
|------|----------|--------------|
| `docs/soul.md` | Project purpose, target users, core mechanics, success criteria | Always |
| `docs/architecture.md` | System design, components, data flow, key decisions | Always |
| `docs/patterns.md` | Coding conventions, approved patterns, anti-patterns | Always (if 3+ source files) |
| `docs/styling-guide.md` | UI/UX design system, component library, tokens | UI projects only |
| `docs/data-models.md` | Data structures, relationships, constraints, migrations | DB/API/models projects only |
| `docs/getting-started.md` | Setup, dependencies, first run | Always |
| `docs/contributing.md` | Contribution workflow, branch strategy, PR guidelines | Always |

**How do agents use them?**
Every work agent (developers, reviewers, testers, reggie-code-architect, reggie-refactorer) reads the subset of foundational docs relevant to their role at Step 1, before their main work. Non-technical agents (reggie-thought-partner, reggie-design-innovator) read `docs/soul.md` only for product context. The reggie-technical-writer is the only agent that creates or updates them.

**How are they created and maintained?**
- `/reggie-onboard` GENERATE stage — creates them for existing repos
- `/reggie-new-repo` DOCS stage — creates them for new projects
- `/reggie-sync-docs` — keeps them current after code changes
- `/reggie-update-claude` — routes new learnings to the appropriate doc

**How are they different from CLAUDE.md?**
`CLAUDE.md` is the top-level project context: rules, key commands, entry points, what matters most. Foundational docs go deeper on specific domains (architecture, patterns, data models). If information conflicts, `CLAUDE.md` wins.

**What about workspace-level docs?**
Per-repo foundational docs cover a single repo's internals. For multi-repo workspaces, `/reggie-setup-workspace-docs` recursively generates a CLAUDE.md + `docs/architecture.md` at every workspace level from the current directory downward. The architecture doc describes how repos relate — communication patterns, data flow, deployment topology, shared dependencies, and folder structure. Individual repos are never modified. This cross-repo context complements the per-repo docs and helps `/reggie-distribute-tasks` route work accurately.

**How are they different from CONTEXT.md?**
`CONTEXT.md` is per-task and ephemeral — it records pipeline state for a single task run. Foundational docs are project-level, persistent, and version-controlled. They survive across tasks, pipelines, and sessions.

---

### Topic: Parallel Tasks

**Can I run multiple tasks at the same time?**
Yes. Open multiple terminal windows and run `/reggie-code-workflow` in each. Each session auto-picks a different task from the backlog and gets its own **git worktree** — a full working copy of the repo on a dedicated branch (`task/[slug]`). This eliminates interleaved commits between parallel sessions.

**How does it work?**
1. Terminal 1: `/reggie-code-workflow` — picks up task 1 from backlog, creates `.worktree/task-1/` on branch `task/task-1`
2. Terminal 2: `/reggie-code-workflow` — auto-picks task 2, creates `.worktree/task-2/` on branch `task/task-2`
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
- **Local merge**: Squash merges all stage commits into a single well-written commit on base, removes worktree, deletes branch
- **PR**: Pushes branch, creates a pull request, removes worktree
- **Push only**: Pushes branch, removes worktree (you merge later)

**How many tasks can run in parallel?**
There's no hard limit, but you'll get a warning if > 3 tasks are active. More tasks = more merge risk. Each worktree is a full copy of the repo, so disk space is a consideration.

**Does it work with audit-workflow too?**
Yes. Each audit task gets its own worktree and branch. If an audit task wants to modify files claimed by a `/reggie-code-workflow` session, conflict detection fires.

**Can I use code-workflow to pull tasks from an audit?**
Yes. Run `/reggie-audit-workflow` to AUDIT and PRIORITIZE — this populates the backlog. Then open another terminal and run `/reggie-code-workflow` — it auto-picks from the same backlog. Both pipelines share TASKS.md, conflict detection works across them, and each gets its own worktree. Let the audit workflow pick up its first task before launching the second terminal to avoid a race on the same backlog item.

---

### Topic: Researcher & Context Building

**What does the reggie-researcher do?**
The reggie-researcher's primary job is to build context for downstream agents (architect, implementer, reviewers). It searches the codebase first, then the web, and writes its findings into `.pipeline/[slug]/CONTEXT.md`. This context is the foundation every subsequent agent builds on.

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
Yes — both `/reggie-code-workflow` and `/reggie-audit-workflow` include this instruction for every agent prompt.

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
Agents store project-specific learnings in `.claude/agent-memory/<agent>/MEMORY.md`. This is created automatically by `/reggie-onboard` and `/reggie-new-repo`.

---

### Topic: Self-Improvement (/reggie-improve)

**What is the improve pipeline?**
A two-level feedback loop that makes agents better over time. Every pipeline run captures learnings about agent behavior — quality gate failures, iteration patterns, missed context. These accumulate in `~/.claude/AGENT-IMPROVE.md` with a classification tag.

**The pipeline (8 stages):**
```
TOOLING-CHECK → COLLECT → CLASSIFY → ANALYZE → PROPOSE → APPLY → VERIFY → CURATE
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
- `~/.claude/agents/reggie-improve-manager.md` — Pipeline reference doc
- `~/.claude/commands/reggie-improve.md` — Command to invoke

**Arguments:**
- `/reggie-improve` — Process all learnings
- `/reggie-improve --dry-run` — Preview without applying
- `/reggie-improve --curate-only` — Only run memory maintenance
- `/reggie-improve --minor-only` — Only auto-apply minor changes

**Safety:** Max 15 system changes/run (memory entries don't count). Never auto-deletes content. Never auto-modifies frontmatter. All changes logged. 3+ changes to same file triggers manual review. Fork proposals always require approval with trade-off analysis.

---

### Topic: MCP Tools

**What are MCP tools?**
MCP (Model Context Protocol) servers extend Claude Code with external capabilities — Firebase management, browser automation, database queries, Stripe API access, etc. They're configured per-project (`.mcp.json`) or globally (`~/.claude/settings.json`).

**How does Reggie manage MCP tools?**
Four layers:

1. **Configuration** — Getting the right servers into `.mcp.json`:
   - `/reggie-find-tools` — Scan a project and configure relevant MCP servers on demand
   - `/reggie-onboard` CONFIGURE-TOOLS stage — Automatically scan and configure during onboarding
   - `/reggie-new-repo` CONFIGURE-TOOLS stage — Configure for new projects based on chosen stack
   - `/reggie-improve` TOOLING-CHECK stage — Periodic drift check (new signals, unused servers)

2. **Capability awareness** — The reggie-code-manager reads `~/.claude/capability-manifest.yaml` at PICKUP and matches project signals (files, deps, directories) against the manifest. It writes a capability snapshot to CONTEXT.md listing installed tools, recommended tools (matched signals but not installed), task-relevant tools (keyword matches), and community skills (supplementary SKILL.md-based playbooks). `/reggie-init-tasks` RESEARCH+PLAN phase and IMPLEMENT stage consult this snapshot to factor available tools and skills into plans.

3. **Orchestrator awareness** — The reggie-code-manager reads `.mcp.json` at pipeline start and cross-references with the merged MCP registry (`~/.claude/mcp-registry.yaml` + optional `~/.claude/mcp-registry.local.yaml`) to build a map of which MCP servers are relevant to which agent types.

4. **Subagent routing** — Before each subagent launch, the orchestrator checks the routing map. Agents that match a configured server's `relevant_agents` list get a prompt hint: "MCP tools available: [server]. Use ToolSearch to find these tools if needed." Agents not listed get no mention of MCP — they won't search for tools they don't know about, keeping context cost at zero. Each launch is logged with its full capability profile (built-in tools, MCP routing, deferred tools, pre-loaded context, agent memory, estimated context tier).

**What is `ENABLE_TOOL_SEARCH`?**
The single most important setting for MCP efficiency. Without it, every MCP tool schema loads into every subagent's context window, multiplying token cost by the number of agent launches per pipeline. With `ENABLE_TOOL_SEARCH=auto:5`, schemas are deferred — agents only pay for tools they actively search for via ToolSearch.

```
# Add to ~/.zshrc or ~/.bashrc
export ENABLE_TOOL_SEARCH=auto:5
```

**What is `mcp-registry.yaml`?**
A curated mapping of project signals (files, dependencies, directories) to MCP servers. Used by `/reggie-find-tools`, `/reggie-onboard`, `/reggie-new-repo`, and `/reggie-improve` to automatically detect which servers are relevant for a project. Each entry includes `relevant_agents` — which agent types actually use that server's tools during pipelines.

**What is `capability-manifest.yaml`?**
A local generated index of ~200 capabilities from five sources: official Claude plugins (42), community plugins from marketplaces like wshobson/agents (35+), community skills from skills-registry.yaml (15 curated SKILL.md-based playbooks), top Smithery servers by category (verified only), and a cross-reference to the local MCP registry (13 servers). Pipeline stages read this at PICKUP — no live API calls during planning. Run `/reggie-refresh-capabilities` to update `~/.claude/capability-manifest.yaml`.

**What is `skills-registry.yaml`?**
A curated index of community Claude Code skills (SKILL.md-based playbooks) from known sources: Anthropic's official skills repo, awesome-claude-skills, and notable standalone repos (Trail of Bits, obra/superpowers, Expo). Each entry includes source trust level (official/curated/community), install instructions, keywords for task matching, and `overlaps_with` to note which Reggie agents cover similar functionality. Skills are supplementary — Reggie agents always take priority for overlapping capabilities.

**How do I add MCP tools to a project?**
Run `/reggie-find-tools`. It scans the project, matches against the registry, and offers to install relevant servers via `claude mcp add --scope project`. Prefer project-scope over global to reduce context cost in other projects.

**How do I see what tools are available beyond MCP?**
Run `/reggie-refresh-capabilities` to populate the capability manifest with plugins, Smithery servers, and community skills. `/reggie-init-tasks` RESEARCH+PLAN phase automatically consults it to recommend tools and skills that could simplify the implementation.

---

### Topic: Task Management

**How do init-tasks and code-workflow work together?**

`/reggie-init-tasks` is the planning phase. `/reggie-code-workflow` is the execution phase. They share TASKS.md and `.pipeline/[slug]/task.md` files:

1. **Brain dump into TASKS.md** — write your tasks in any format (bullet points, notes, half-formed ideas). This is the standard starting point.
2. **`/reggie-init-tasks`** reads TASKS.md → researches the codebase → asks you targeted questions → builds implementation plans → rewrites TASKS.md (slim metadata) + `.pipeline/[slug]/task.md` (full plans)
3. **`/reggie-code-workflow`** reads TASKS.md → auto-picks the highest-priority task with a `[planned]` tag → reads its task.md for context → runs the full pipeline (implement → test → review → commit) → picks up the next task
4. **Multiple `/reggie-code-workflow` sessions** can run in parallel — each auto-picks a different task and works in its own git worktree

Tasks without a `task.md` file (unplanned) are rejected by `/reggie-code-workflow` with a redirect back to `/reggie-init-tasks`.

**What is the task format?**
Tasks in TASKS.md use a slim metadata-rich format. Full task details live in separate `.pipeline/[slug]/task.md` files:

```markdown
## Backlog

### Authentication & Security
- [ ] add-jwt-auth: Add JWT authentication to login endpoint [P1] [complex] [code] [planned]
  files: src/utils/jwt.ts (NEW), src/middleware/auth.ts (MOD), src/routes/login.ts (MOD)
- [ ] implement-rbac: Implement role-based access control [P2] [depends: add-jwt-auth] [conflicts: add-jwt-auth] [moderate] [code] [planned]
  files: src/middleware/rbac.ts (NEW), src/routes/*.ts (MOD)

### Dashboard UI
- [ ] fix-responsive-cards: Fix responsive layout on dashboard cards [P2] [simple] [code] [planned]
- [ ] add-loading-skeletons: Add loading skeletons to data tables [P3] [moderate] [design] [planned]
  files: src/components/Skeleton.tsx (NEW), src/pages/Dashboard.tsx (MOD)
```

**Metadata tags**: `[P1/P2/P3]` priority, `[depends: slug]` dependencies, `[conflicts: slug]` file overlap, `[simple/moderate/complex]` complexity, `[code/design]` pipeline mode, `[planned]` plan status (required for code-workflow). The optional `files:` line lists NEW/MOD files from the plan.

**task.md files**: Pre-planned tasks (from `/reggie-init-tasks`) have a `.pipeline/[slug]/task.md` file containing the full enriched description (Problem, Vision, Context, Affected Areas, Acceptance Criteria) and an Implementation Plan. These are created by `/reggie-init-tasks` FORMALIZE phase, read by `/reggie-code-workflow` PICKUP for context seeding, and deleted by COMPLETE.

**Priority tags**: `[P1]` (critical/blocking), `[P2]` (standard, default), `[P3]` (nice-to-have). Assigned by `/reggie-init-tasks` ORGANIZE phase. Tasks without tags default to P2.

**Dependency tags**: `[depends: slug]` or `[depends: slug-a, slug-b]`. Mapped by `/reggie-init-tasks` ORGANIZE phase using reggie-code-architect analysis. Auto-pickup skips tasks with unmet dependencies.

**How does auto-pickup work?**
Auto-pickup is priority-aware and dependency-respecting: it scans all `- [ ]` items, filters out tasks with unmet dependencies, then picks the highest priority task (P1 > P2 > P3). Within the same priority, it picks first in document order.

**How are groups created?**
`/reggie-init-tasks` uses reggie-code-architect to analyze your project structure and group tasks into areas of focus. You can also create sections manually.

**How do I refine ungroomed items?**
Run `/reggie-init-tasks` — if `### Ungroomed` has items, it offers to refine them. They go through RESEARCH+PLAN for acceptance criteria and implementation planning, then ORGANIZE moves them to proper sections with priorities and dependencies.

**Where do discovered issues go?**
Into `### Ungroomed` at the bottom of `## Backlog`. They stay there until refined via `/reggie-init-tasks`. Auto-pickup never selects ungroomed items.

**How is pipeline stage tracked?**
Each active task has a `.pipeline/[slug]/STAGE` file that stores the current stage (e.g., `IMPLEMENT`). This is updated on every stage transition and read by `/reggie-status`.

**Can I use a flat backlog?**
Yes. Section headers are optional. A backlog with no `### ` headers works exactly as before.

---

### Topic: Installation & File Structure

**How is Reggie installed?**
Reggie is installed and managed by [Forge](https://github.com/The-Banana-Standard/forge-reggie), the desktop companion app. Forge copies the contents of `resources/` into `~/.claude/` and keeps them in sync. All distributable content lives under `resources/` in the repo: `resources/agents/`, `resources/commands/`, `resources/hooks/`, `resources/docs/`, and `resources/registries/`.

**What gets installed where?**

| ~/.claude/ path | Repo path | What |
|----------------|-----------|------|
| `agents/*.md` | `resources/agents/*.md` | 36 agent definitions |
| `commands/*.md` | `resources/commands/*.md` | 35 slash commands |
| `hooks/track-stats.sh` | `resources/hooks/track-stats.sh` | Stats tracking hook |
| `REGGIE.md` | `resources/docs/REGGIE.md` | Philosophy and principles |
| `PORTABLE-PACKAGE.md` | `resources/docs/PORTABLE-PACKAGE.md` | Full system reference |
| `agents-is-all-you-need.md` | `resources/docs/agents-is-all-you-need.md` | Design essay |
| `reggie-quickstart.md` | `resources/docs/reggie-quickstart.md` | Quickstart guide |
| `mcp-registry.yaml` | `resources/registries/mcp-registry.yaml` | Curated MCP registry |
| `skills-registry.yaml` | `resources/registries/skills-registry.yaml` | Curated skills registry |

**What gets configured automatically?**
The Reggie app adds stats tracking hooks to `~/.claude/settings.json` (idempotent — safe to run multiple times). These hooks track Task, Skill, and ToolSearch usage for pipeline stats. It also sets `ENABLE_TOOL_SEARCH=auto:5` in your shell profile — this defers MCP tool schemas so agents only load tools they need.

**What stays local (NOT installed from repo)?**
These files are user-specific and not part of the open-source repo:

| File | Purpose |
|------|---------|
| `settings.json` | Permissions, hooks config, plugins, effort level |
| `capability-manifest.yaml` | Local generated capability index refreshed by `/reggie-refresh-capabilities` |
| `mcp-registry.local.yaml` | Optional local MCP registry overrides |
| `skills-registry.local.yaml` | Optional local skills registry overrides |
| `AGENT-IMPROVE.md` | Accumulated agent learnings (processed by `/reggie-improve`) |
| `IMPROVE-CHANGELOG.md` | Record of improvement changes applied |
| `voice-profile.md` | Personal writing style profile |
| `current_thoughts.md` | Scratch notes |
| `agent-memory/` | Global agent memory |
| `cache/`, `debug/`, `file-history/` | Runtime data |

**What does this mean for /reggie-system-change?**
When `/reggie-system-change` edits agents, commands, hooks, or docs, those changes happen in the `resources/` directory of the git repo. You can commit and push them. Changes to local-only files (settings.json, AGENT-IMPROVE.md, etc.) are not version-controlled.

**How do I install?**
Install the [Reggie desktop app](https://github.com/The-Banana-Standard/reggie) and use it to install Reggie. The app handles cloning the repo, copying `resources/` into `~/.claude/`, and configuring hooks.

**What do I do after installing?**
Restart Claude Code and run: `/reggie-guide I just installed Reggie, what do I do now?`

**How do I update?**
Updates are managed through the Reggie app. Pull the latest changes from the repo and the app will sync `resources/` into `~/.claude/`.

**How do I uninstall?**
Use the Reggie app to remove Reggie files from `~/.claude/`. Alternatively, delete the Reggie agent and command files from `~/.claude/agents/` and `~/.claude/commands/` manually.

---

### Topic: Common Questions

**How do I skip a stage?**
Say "skip" during any pipeline run.

**How do I go back?**
Say "back" or "back to [stage name]".

**How do I pause and resume?**
Say "pause" to save progress. Run the workflow command again to resume. Your worktree and branch persist on disk — if the worktree is missing on resume, it's automatically recreated from the branch.

**How do I see where I am?**
Run `/reggie-status`.

**What if the quality gate keeps failing?**
The system escalates automatically: iterate → research → tournament → ask you. If you want to force it forward, say "skip".

**Can I run stages individually outside a pipeline?**
Yes. Commands like `/reggie-plan`, `/reggie-write-tests`, `/reggie-code-review`, `/reggie-review-security` etc. work standalone.

---

### Topic: Onboarding

**What is /reggie-onboard?**
An 8-stage workflow that prepares any existing repository for the Claude Code agent system. It discovers the codebase structure, validates build/test commands work, analyzes patterns and conventions, audits existing documentation, generates CLAUDE.md and supporting files, seeds agent memory based on the tech stack, scans for and configures relevant MCP tools, and optionally prunes outdated docs.

**When to use it:**

- Fresh clone of a repo you've never worked in
- Existing project without CLAUDE.md
- Inherited codebase that needs documentation
- Any repo before running /reggie-audit or /reggie-code-workflow

**Stages:**

| Stage | Purpose | Skippable |
|-------|---------|-----------|
| DISCOVER | Map structure, tech stack, docs | No |
| VALIDATE | Run build/test to verify they work | `--skip-tests` |
| ANALYZE | Identify patterns and conventions | No |
| DOC-AUDIT | Assess existing docs for signal vs noise | No |
| GENERATE | Create CLAUDE.md, TASKS.md, .pipeline/ | No |
| SEED-MEMORY | Create agent memory directories based on stack | No |
| CONFIGURE-TOOLS | Scan for and configure relevant MCP servers | No |
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
- Foundational docs: `docs/soul.md`, `docs/architecture.md`, `docs/patterns.md`, `docs/getting-started.md`, `docs/contributing.md` (plus `docs/styling-guide.md` and `docs/data-models.md` if applicable)

**Examples:**

```bash
/reggie-onboard                    # Full onboard
/reggie-onboard --skip-tests       # Skip build/test validation
/reggie-onboard --no-prune         # Don't touch existing docs
```

**How is this different from /reggie-new-repo?**

- `/reggie-new-repo` creates a NEW project from scratch (scaffolding, initial files). Produces raw tasks in TASKS.md — run `/reggie-init-tasks` to refine them.
- `/reggie-onboard` prepares an EXISTING project for the agent system (discovery, doc audit). Creates empty TASKS.md — run `/reggie-init-tasks` to brainstorm and plan tasks.

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
- `/reggie-onboard` and `/reggie-new-repo` run a SEED-MEMORY stage that creates initial memory for relevant agents based on the detected tech stack
- Agents update their own memory after each task (conventions found, gotchas discovered, patterns confirmed)
- `/reggie-improve --curate-only` prunes stale entries and enforces the 200-line cap

**How does /reggie-improve use memory?**
When processing learnings, `/reggie-improve` classifies each one:
- **UNIVERSAL** learnings → update system agent files (applies everywhere)
- **PROJECT** learnings → update project agent memory (applies to this project only)
- **PROCESS** learnings → update command files (workflow changes)

**Is memory committed to git?**
No. `.claude/agent-memory/` and `.claude/research-cache/` are `.gitignore`d. They're local developer knowledge, not shared code.

**What is the research cache?**
The reggie-researcher caches **web research findings only** (external best practices, library comparisons, API docs) to `.claude/research-cache/`. Codebase context is never cached — it's gathered live each time (by the orchestrator in pipeline mode, or by the reggie-researcher in standalone mode). Cache entries expire after 30 days. Size limit is 10-15k characters per entry. This prevents redundant web research while ensuring codebase context is always fresh.

---

### Topic: Which Command Should I Use?

**The primary workflow (most work goes through here):**

| Step | Command | What happens |
|------|---------|--------------|
| 1 | Brain dump into TASKS.md | Write your tasks in any format (bullet points, notes, half-formed ideas) |
| 2 | `/reggie-init-tasks` | Reads TASKS.md → researches the codebase, asks questions, groups related tasks, builds implementation plans → produces task.md files |
| 3 | `/reggie-code-workflow` | Auto-picks the next planned task → implements, tests, reviews, commits → repeat |
| 4 | `/reggie-code-workflow` (more terminals) | Run in parallel — each session gets its own task and git worktree |

**Everything else:**

| Goal | Command | Notes |
|------|---------|-------|
| Fix a bug (unclear root cause) | `/reggie-debug-workflow` | Socratic diagnosis → handoff to code-workflow |
| Quickly investigate a bug | `/reggie-debug` | Lightweight, no pipeline |
| Audit codebase health | `/reggie-audit-workflow` | Full pipeline: audit → prioritize → fix loop |
| Quick codebase assessment | `/reggie-audit` | One-shot audit, no fixes |
| Set up a new project | `/reggie-new-repo` | Scaffold → git → docs → push → `/reggie-init-tasks` to plan tasks |
| Prepare an existing repo for agents | `/reggie-onboard` | Discovery → CLAUDE.md → agent memory → `/reggie-init-tasks` to plan tasks |
| Write a technical article | `/reggie-article-workflow` | Brainstorm → draft → edit → publish |
| Create social media posts | `/reggie-social-workflow` | Extract → adapt per platform → review |
| Plan an implementation (no coding) | `/reggie-plan` | Produces an architect plan only |
| Review code I just wrote | `/reggie-code-review` | Structured code review of current diff |
| Check for security issues | `/reggie-review-security` | Security audit of current changes |
| Brainstorm or think through something | `/reggie-brainstorm` | Conversational thinking partner |
| Research a topic | `/reggie-research` | Investigative research with evidence |
| Create new agents or workflows | `/reggie-system-change` | Intake → brainstorm → plan → implement → verify |
| Process agent learnings | `/reggie-improve` | Two-level improve pipeline |
| Evaluate the agent system itself | `/reggie-evaluation-system` | Architecture review, not per-agent learnings |
| Check if this repo is ready for agents | `/reggie-repo-advisor` | Per-project readiness, prescriptions, drift |
| Scan project for relevant MCP tools | `/reggie-find-tools` | Detect project signals, configure MCP servers |
| Update capability manifest from sources | `/reggie-refresh-capabilities` | Refresh plugins, skills, Smithery servers |
| Map repos in a workspace | `/reggie-setup-workspace-docs` | CLAUDE.md + `docs/architecture.md` at workspace level (recursive) |
| Distribute tasks across repos | `/reggie-distribute-tasks` | Parse freeform notes → route tasks to correct repo TASKS.md files |
| Write or update documentation | `/reggie-docs` | Produce documentation for code or features |
| Update changelog | `/reggie-changelog` | Append to CHANGELOG.md |
| Create an architecture diagram | `/reggie-diagram` | Mermaid or ASCII visualization |
| Fix failing tests | `/reggie-fix-tests` | Diagnose and fix test failures |
| Sync all documentation | `/reggie-sync-docs` | Keep docs current after code changes |
| Capture learnings in CLAUDE.md | `/reggie-update-claude` | Route new learnings to the right doc |
| Write tests for existing code | `/reggie-write-tests` | Comprehensive test suite for a feature |
| Clean up code without behavior changes | `/reggie-simplify` | Remove dead code, simplify logic |

---

### Topic: System Evaluation (/reggie-evaluation-system)

**What is /reggie-evaluation-system?**
A periodic architectural review of the ~/.claude/ agent system. Unlike /reggie-improve (which processes per-agent learnings from pipeline runs), /reggie-evaluation-system steps back and evaluates the whole system: are there missing agents, redundant commands, outdated patterns, or broken integrations?

**The pipeline:**
`SCAN → EVALUATE → BRAINSTORM → PROPOSE → [IMPLEMENT → VERIFY]`

| Stage | Agent | Purpose |
|-------|-------|---------|
| SCAN | reggie-researcher | Full inventory of all agents and commands |
| EVALUATE | reggie-claude-architect | Analyze for gaps, redundancies, drift |
| BRAINSTORM | reggie-thought-partner | Discuss findings with user, prioritize |
| PROPOSE | reggie-claude-architect | Concrete improvement proposals |
| IMPLEMENT | Main Claude | Execute approved proposals (optional, `--implement` flag) |
| VERIFY | reggie-researcher | Validate consistency after changes (after IMPLEMENT) |

**No numeric quality gates.** Uses confirmation-based gates. The user decides what matters.

**Arguments:**
- `/reggie-evaluation-system` — Full evaluation (SCAN through PROPOSE)
- `/reggie-evaluation-system --scan-only` — Just produce the inventory
- `/reggie-evaluation-system --implement` — Evaluate, execute, and verify approved proposals

**How is this different from /reggie-improve?**
- `/reggie-improve` processes AGENT-IMPROVE.md entries — specific learnings from pipeline runs
- `/reggie-evaluation-system` evaluates system architecture — structural gaps, redundancies, drift
- They're complementary: /reggie-improve handles tactical refinements, /reggie-evaluation-system handles strategic review

---

### Topic: System Changes (/reggie-system-change)

**What is /reggie-system-change?**
The unified pipeline for formalizing changes to the ~/.claude/ agent system — both modifying existing components and creating new ones. Unlike /reggie-evaluation-system (which discovers issues), this pipeline starts with a known change request and walks it through brainstorming, planning, implementation, and verification.

**The pipeline:**
`INTAKE → BRAINSTORM → PLAN → IMPLEMENT → VERIFY`

| Stage | Agent | Purpose |
|-------|-------|---------|
| INTAKE | Main Claude | Capture the change request |
| BRAINSTORM | reggie-thought-partner | Explore design space (quick if obvious) |
| PLAN | orchestrator (direct) | File-by-file change plan with classifications and validation |
| IMPLEMENT | Main Claude | Apply edits, create new files, update integration docs |
| VERIFY | reggie-researcher | Validate consistency after changes |

**On-demand research.** The orchestrator reads files directly during PLAN (orchestrator-direct mode). For broad dependency tracing requiring many files, the reggie-researcher agent can be dispatched. BRAINSTORM can also dispatch the reggie-researcher when questions arise about current system state.

**Change classifications:**
- `direct-edit` — Modify existing file inline
- `new-component` — Create new agent/command/workflow with validation (reads similar files first, validates structure)
- `integration-update` — Update PORTABLE-PACKAGE.md, guide.md, MEMORY.md

**Quality gates:** Confirmation-based for most changes. When the plan includes `new-component` changes, the PLAN goes through reggie-judge scoring (9.0/10) to validate design quality.

**How is this different from other system commands?**
- `/reggie-evaluation-system` — Discovers issues (you do NOT know what to change yet)
- `/reggie-improve` — Processes accumulated per-agent learnings
- `/reggie-system-change` — Formalizes a known change, creates new components, modifies existing ones
