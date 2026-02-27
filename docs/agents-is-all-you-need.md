---
title: "Agents is All You Need — Reggie"
description: "Building a development team inside Claude Code"
date: "2026-02-05"
status: published
tags: [Reggie, High Level Overview, Agentic Engineering]
---

## Why We Built Reggie

AI tools like Claude Code and Codex allowed us to prioritize MVP's at speed but as the codebase grew the problems grew. AI coding came with diminishing returns. In our haste to get a working product out, MVP code was often based on a series of loosely connected prompts resulting in poor architecture, missing unit tests, and often, far too much AI written documentation.

There had to be a way to build a quality codebase at scale while still getting the benefits of the AI coding tools. That's when we learned about Claude Code's subagents feature.

What started as a collection of agents and pipelines became a structured collaboration system between us and Claude, built on Claude Code.  We named it **Reggie** because it suggested we call it "register"; the linguistics term for how language shifts to match its context. That felt perfect. The whole system is built around one AI shifting between specialized registers — an architect designs, a reviewer critiques, a researcher investigates. Register was shortened to Reggie because it's a system we talk to all day, and it deserved a name that felt like one.

---

## The General Concept

The philosophy, an ode to the transformer, is simple: **Agents is all you need**.

When we say Agents, we mean Claude Code's **subagents** feature — specialized agents primed with context for a specific task. Previously we would interact with one agent, build a feature, then forget to tell it to simplify, test, document, etc. Or if we did remember, we would hit context limits and have problems with split focus. Not to mention the mental effort it takes to write a thorough prompt for each step of the coding process!

With Reggie, instead of one agent trying to do everything — research, plan, implement, test, review, we use specialized subagents that each excel at one thing. A researcher researches. An architect plans. An implementer codes. A tester tests. Each gets exactly the context it needs to do its job well, nothing more.

### The Orchestrator

The specialist agents are great but to create a true development team, we needed to figure out coordination between the agents. The main Claude Code agent now acts as an **orchestrator** for the entire process. It ingests a **pipeline manager** markdown file — a reference document that describes to the main agent how to run the prescribed workflow. With this document, the orchestrator knows what to do with the researcher's findings, what the architect planned, what the implementer built, and what the tester tested. It maintains a long term memory of the current task and provides the relevant context to each specialist agent so they can do their best work.

### Quality Gates

Sometimes agents produce poor output. We wanted to mitigate that risk, so we implemented **quality gates** at every stage of the pipeline. Each specialized agent submits its work to a **judge** agent that scores it against specific criteria.

When the Judge's threshold isn't met, there's a structured escalation: iterate with feedback, call the researcher for new information, retry on a stronger model if applicable, run a tournament where two agents compete, and finally escalate to the user.

In practice, most failures resolve on the first retry. The feedback loop is tight enough that it rarely goes past attempt two.

### Persistent Memory

Agents have **persistent memory** — a two-tier system that lets knowledge survive across sessions:

- **System-level memory** (`~/.claude/agent-memory/<agent>/MEMORY.md`): global knowledge that persists across all projects. The judge's scoring calibration lives here. The architect's pattern preferences live here.
- **Project-level memory** (`project-repo/.claude/agent-memory/<agent>/MEMORY.md`): per-project knowledge. The researcher's cache of "this project uses a custom auth flow, check `auth/` first" lives here.

Every agent's process starts with **Step 0: Consult Memory** and ends with **Final: Update Memory**. Memory files are capped at 200 lines — concise and actionable, not a diary.

Project-level context lives in **CLAUDE.md** at the root of each repo. Every agent reads it at session start. It defines project conventions, architecture decisions, tech stack details, and workflow preferences — the things a new team member would need to know on day one.

We are really excited about this, especially as context capabilities continue to grow in frontier models.

### The Self-Improvement Loop

The system improves itself through two mechanisms that work together: collection and processing.

**CAPTURE-LEARNINGS** is the collection step. It's embedded at the end of every pipeline. After a pipeline completes, the orchestrator reflects on what went well and what didn't. It reviews quality gate patterns, missed context, investigation dead ends, scoring calibrations that felt off. These learnings get appended to `~/.claude/AGENT-IMPROVE.md` with a standardized format and classification.

**`/improve`** is the processing engine. It runs automatically at the end of every pipeline. If `AGENT-IMPROVE.md` has accumulated entries, the system processes them without us having to think about it.

The result is a system that gets measurably better at the things it does repeatedly. The judge learns to calibrate. The researcher learns where to look first. The architect learns which patterns work in which contexts.

---

## Pipelines

The full Reggie system has 42 agents and 44 commands, but the core experience is built around 11 pipelines — each invokable as a slash command. These are the workflows we actually use day to day, organized by what they're for.

### Set Up

Getting a project ready for Reggie.

1. **Repo Setup** (`/new-repo`) — Project vision session, scaffolding, git setup.
2. **Onboard** (`/onboard`) — Prepare an existing repo for Reggie. Seven stages from discovery through refinement, including memory-seeding that pre-populates agent knowledge based on the detected tech stack.

### Coding

Building, fixing, and maintaining code.

3. **Init Tasks** (`/init-tasks`) — Takes rough notes or a brain dump and organizes them into structured TASKS.md entries through four stages: intake, clarification, codebase-aware grouping by the code-architect agent, and formalization with P1/P2/P3 priorities and dependency tags.
4. **Code Development** (`/code-workflow`) — The core of the system. Methodical feature development through eleven stages: research, planning, implementation, testing, quality checks, simplification, verification, review, security review, documentation sync, and capture-learnings. Picks up already-created tasks from TASKS.md.
5. **Audit Pipeline** (`/audit-workflow`) — Runs security and quality audits on existing code, adds findings to TASKS.md with structured context (What/Where/Risk/Fix/Effort), then flows into the code pipeline to fix issues.
6. **Port Feature** (`/port`) — Analyze a feature in one codebase, plan the adaptation, implement in the target, verify. Useful for moving functionality between platforms for the same project.
7. **Debug** (`/debug-workflow`) — Socratic debugging: hypothesis-driven investigation with convergence checks. Diagnosis only — no fixes proposed until the problem is understood.

### Business

Content and communication workflows.

8. **Article Pipeline** (`/article-workflow`) — Research, outline, draft, edit, and review stages for writing. Includes an edit mode that jumps directly to the human-edit loop, plus a voice profile that learns the author's style over time.

### Reggie

Maintaining and evolving the system itself. The self-improvement loop catches learnings from the bottom up. But the system also has a top-down evaluation. This is my personal favorite part, talking to reggie. Want a new pipeline? Want something in a current pipeline changed? Want reggie to evaluate its health? got any question about how reggie works? This is how you get the most out of reggie.

9. **Evaluate Reggie** (`/evaluate-reggie`) — Periodic architectural review of the entire system. Scans for coverage gaps, redundancies, consistency drift, and integration health.
10. **System Change** (`/reggie-system-change`) — Formalizes a change to Reggie through structured intake, brainstorming, planning, implementation, and verification. If you'd like to contribute to the system via our open source repository, this is the pipeline for you!
11. **Reggie Guide** (`/reggie-guide`) - is a topic-based help for the system. It can answer any question about Reggie. It can also help you with specific tasks in the system. Just use /reggie-guide with a question.

---

## Coding With Reggie

### Initializing Tasks

Before any code gets written, there needs to be a plan. We start by dumping rough notes into TASKS.md — feature ideas, bugs we've noticed, things that came up in conversation. It doesn't need to be structured. Just get it down.

Then we run `/init-tasks`. The pipeline takes that brain dump and turns it into structured, refined tasks — but it's not just automation. It's a conversation. Claude reflects back what it heard, asks targeted follow-ups ("Is the Android color bug blocking users or just annoying?"), and lets us drop or split items on the fly. Vague entries like "make the backend better" get clarified before anything moves forward. Once the items are concrete, a code-architect agent explores the actual codebase to create meaningful groupings — not generic categories like "Backend" or "Frontend," but real areas of the code like "Authentication & Sessions" mapped to `src/auth/`. Each task gets a priority tag and dependency markers so parallel work doesn't collide.

Once the tasks are refined and sitting in TASKS.md, they feed directly into `/code-workflow`. No copy-pasting, no re-explaining what needs to be built. The structured backlog becomes the input for the development pipeline.


### Completing a Task

Here's what happens when you run `/code-workflow` with refined tasks in ./TASKS.md.

**1. Task pickup.** The orchestrator selects a task and moves it from backlog to active in TASKS.md. This file is shared across sessions — when a new session picks up work, it knows what's available versus what's already in progress.

**2. Context initialization.** A `.pipeline/[slug]/` directory is created for the task. This is the task's workspace — everything the pipeline needs to coordinate lives here:

**3. Skip list computation.** The orchestrator assesses which stages are categorically inapplicable and records them in SKIP. Documentation-only tasks skip IMPLEMENT. Config-only tasks skip WRITE-TESTS. Design mode has its own default skips.

RESEARCH and PLAN are never skipped — they're too important for grounding the work.

**4. Stage execution.** Each stage runs, gets quality-gated, and its outputs feed into context.

### What Each Stage Contributes to CONTEXT.md

```text
+-----------------+--------------------------------------------------------------------+
|      Stage      |                         Adds to CONTEXT.md                         |
+-----------------+--------------------------------------------------------------------+
| RESEARCH        | Key findings, sources, risks                                       |
| PLAN            | Full architecture plan, decisions, gotchas                         |
| IMPLEMENT       | Files changed, implementation decisions, deviations with rationale |
| TEST            | Coverage summary, edge cases, bugs caught                          |
| QUALITY-CHECK   | Gaps identified                                                    |
| SIMPLIFY        | What was refactored, complexity reductions                         |
| VERIFY          | Results, issues found                                              |
| REVIEW          | Findings, blockers resolved                                        |
| SECURITY-REVIEW | Findings, mitigations applied                                      |
| SYNC-DOCS       | Documentation updates, CHANGELOG entries                           |
| CAPTURE-LEARN   | Quality gate patterns, missed context, calibration notes           |
+-----------------+--------------------------------------------------------------------+
```

---

## Other Key Concepts

### Agent Autonomy

Context is reference material, not rigid orders. If an implementer discovers something that changes the architect's approach, it adapts and logs why in DECISIONS.md.

**The principle:** document what you learned, don't ask permission.

This extends to scope management. Every agent prompt includes: "If you discover unrelated issues, list them under Discovered Issues." After each stage, the orchestrator checks for these and adds them to the ungroomed backlog in TASKS.md. Nothing gets lost and scope doesn't creep.

### Parallelism with Git Worktrees

Everything so far assumes one task at a time. But what if you want to run multiple pipelines in parallel — several terminals, each running `/code-workflow`, auto-picking different tasks from a shared backlog?

The solution is **git worktrees** — a native git feature that creates separate working directories, each on its own branch, all linked to the same repository. When a task is picked up, the system creates a dedicated branch and working directory.

TASKS.md acts as a lock — a task is claimed before the worktree is created, so parallel sessions can't grab the same work. After the PLAN stage, conflict detection runs: the system compares file lists across active tasks. Overlapping files trigger a warning before implementation begins.

At completion, you pick a merge strategy: merge locally, push as a PR, or defer.

---

## Beyond Code

Feature development was the starting point, but the concept applies to anything. Agents are good at specific tasks but bad at orchestration. So use agents for specific tasks and build explicit orchestration around them. Quality gates force rigor at each step. Persistent context survives conversation resets. Git commits at every gate make everything traceable and reversible.

Although it still took a lot of human editing this article was written with the help of the article workflow. And to me, that's pretty cool!
