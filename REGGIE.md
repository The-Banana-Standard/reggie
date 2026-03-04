# Reggie

**Reggie turns your backlog into a parallel build queue.**

Dump everything you want built -- features, bugs, half-formed ideas. Reggie organizes them into structured tasks, then executes them in parallel across specialized agents. Each task flows through its own pipeline with quality gates. You review the results.

37 agents. 34 commands. A pipeline architecture with quality gates. All living in `~/.claude/`, all portable across projects.

Built on Claude Code. Extends it from a single-agent tool into a coordinated multi-agent system with memory, self-improvement, and enforced quality standards.

---

## The Core Insight

The bottleneck isn't writing code. It's the pile of half-articulated things you want done sitting in your head, a notes file, or a messy GitHub issue.

Reggie's job is to drain that pile -- turn it into structured tasks, then run them in parallel until they're done. Every piece of the system -- the pipelines, the agents, the quality gates, the memory system -- exists to move tasks from "vague idea" to "merged code" without you babysitting each one.

---

## Principles

### 1. Parallelism Is the Point
Reggie is designed around the assumption that you'll run multiple sessions simultaneously. The backlog, worktrees, and task assignment all exist so that N terminals can work on N tasks without conflicts or coordination overhead.

### 2. Structured Execution
Every task flows through a predictable pipeline. Every stage has a defined input, a specialized agent, and a quality gate. PLAN before IMPLEMENT. REVIEW before COMMIT. No stage is skipped because it felt unnecessary.

### 3. Quality Without Babysitting
The threshold is 9.0/10 to advance through any gate. If a stage fails, it iterates with feedback. If it fails again, the researcher gathers more context. If it still fails, two agents compete in a tournament. Only after all that does it escalate to you. You're not watching each agent -- the system handles retries and quality enforcement.

### 4. Agents Have Autonomy
Plans are context, not orders. If a developer agent discovers something during implementation that changes the approach, they adapt and document why. Agents are trusted professionals working within structured pipelines, not spec-followers executing blindly.

### 5. Fidelity to Intent
The output should match what you meant, not just what you said. Agents research before building. Architects plan before developers code. Judges score against your actual intent, not just technical correctness. When something drifts, the system catches it early.

### 6. Self-Improvement Is Continuous
Every pipeline run generates learnings. The improve pipeline collects them, classifies them, and applies them back to agents and commands. The system you use today is better than the one you used last week.

### 7. Everything Is Portable
Reggie lives in `~/.claude/`. Copy the agents and commands directories to a new machine and you have the full system. Project-specific memory stays with projects. The system travels with you.

---

## How It Works

```
Brain dump → /init-tasks → /code-workflow (×N in parallel) → Done
```

**Step 1: Brain dump.** Write down everything you want done -- features, bugs, ideas, half-formed thoughts. Drop them in `TASKS.md`, paste them in chat, or just talk through them. Don't worry about order or format.

**Step 2: `/init-tasks`.** Reggie takes your raw notes and turns them into implementation-ready tasks. It researches each one against your actual codebase, asks targeted questions ("I see two auth middlewares -- which one?"), groups related tasks, and builds plans. You make the decisions, Reggie does the legwork.

**Step 3: `/code-workflow` (×N in parallel).** Open as many terminals as you want. Run `/code-workflow` in each. Each session auto-picks a different task from the backlog and works in its own git worktree -- implement, test, review, commit. No conflicts, no interleaved commits. Every stage has a quality gate (9.0/10 to advance).

That's the primary loop. There are other pipelines -- audit, content, design, debugging, porting -- but init-tasks + code-workflow is the daily driver.

---

## Vocabulary

These terms have specific meanings inside Reggie:

| Term | Meaning |
|------|---------|
| **Pipeline** | A multi-stage workflow with quality gates between every stage |
| **Stage** | One step in a pipeline, handled by a specialized agent |
| **Quality gate** | Judge-scored checkpoint (9.0/10 threshold) between stages |
| **Escalation** | What happens when a stage fails: iterate, research, Opus retry, tournament, then ask the user |
| **Tournament** | Two agents compete on the same stage; judge picks the winner |
| **Agent** | A specialized AI role with defined responsibilities, tools, and memory |
| **Pipeline manager** | Reference document that guides the orchestrator through a pipeline's stages |
| **Orchestrator** | The main Claude session that reads pipeline managers and launches agents |
| **CONTEXT.md** | Cumulative document per task -- grows as stages complete, never summarized |
| **TASKS.md** | Project-level task tracker: active tasks, backlog, priorities, dependencies |
| **Agent memory** | Persistent per-project knowledge that agents accumulate over time |
| **Backlog** | Prioritized task list organized by area of focus with P1/P2/P3 tags |

---

## What Reggie Is Not

- **Not a product.** It is a personal system shared between friends.
- **Not a framework.** There is no API, no SDK, no package manager. It is markdown files and conventions.
- **Not magic.** It enforces structure and quality, but you still need to articulate what you want. Garbage in, structured garbage out.
- **Not finished.** It improves itself, and it improves through use. The version you receive is a snapshot of a living system.

---

## Getting Started

```bash
# Check system health
/status

# See all commands
/reggie-guide
```

See `PORTABLE-PACKAGE.md` for the full transfer reference.

---

*Reggie v1.1 -- March 2026*
