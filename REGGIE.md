# Reggie

**Reggie is a structured collaboration system between a human and Claude.**

It exists to close the gap between what you mean and what gets built. It does this by giving shape to how we talk, and structure to what happens after we talk.

37 agents. 34 commands. A pipeline architecture with quality gates. All living in `~/.claude/`, all portable across projects.

Built on Claude Code. Extends it from a single-agent tool into a coordinated multi-agent system with memory, self-improvement, and enforced quality standards.

---

## The Core Insight

The purpose of this system is to structure the way we talk and structure the things that happen after we talk. The goal is that when we talk, the final output is exactly what you expected.

That is not fully possible. But every piece of Reggie -- the pipelines, the agents, the quality gates, the memory system -- exists to get closer.

---

## Principles

### 1. Fidelity to Intent
The output should match what you meant, not just what you said. Agents research before building. Architects plan before developers code. Judges score against your actual intent, not just technical correctness. When something drifts, the system catches it early.

### 2. Structured Execution
Conversations become predictable pipelines. Every stage has a defined input, a specialized agent, and a quality gate. RESEARCH before PLAN. PLAN before IMPLEMENT. REVIEW before COMMIT. No stage is skipped because it felt unnecessary.

### 3. Quality Over Speed
The threshold is 9.0/10 to advance through any gate. If a stage fails, it iterates with feedback. If it fails again, the researcher gathers more context. If it still fails, two agents compete in a tournament. Only after all that does it escalate to you. Speed is nice. Fidelity is the point.

### 4. Agents Have Autonomy
Plans are context, not orders. If a developer agent discovers something during implementation that changes the approach, they adapt and document why. Agents are trusted professionals working within structured pipelines, not spec-followers executing blindly.

### 5. Self-Improvement Is Continuous
Every pipeline run generates learnings. The improve pipeline collects them, classifies them (universal, project-specific, or process-level), and applies them back to agents and commands. The system you use today is better than the one you used last week.

### 6. Opus by Default
Complex reasoning, design, review, and judgment always run on the strongest model available. Cheaper models handle only mechanical tasks where the output would be identical. When unsure, go Opus. Quality is not where you save money.

### 7. Everything Is Portable
Reggie lives in `~/.claude/`. Copy the agents and commands directories to a new machine and you have the full system. Project-specific memory stays with projects. The system travels with you.

---

## How It Works

You say what you want. Reggie turns that into a pipeline.

```
Your intent
  --> RESEARCH (understand the problem space)
  --> PLAN (design the approach)
  --> IMPLEMENT (build it)
  --> TEST (verify it works)
  --> REVIEW (code review + security audit)
  --> COMMIT (checkpoint)
Your output
```

Every arrow is a quality gate scored by the judge agent. Pass at 9.0 or iterate until you do.

This is the feature development pipeline. There are others -- audit, content, repo onboarding, debugging, design, porting -- each with their own stages and specialized agents.

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
- **Not magic.** It enforces structure and quality, but the human still needs to articulate intent clearly. Garbage in, structured garbage out.
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

*Reggie v1.0 -- February 2026*
