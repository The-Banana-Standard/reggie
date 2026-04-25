---
name: reggie-debug-manager
description: "Pipeline manager for debug workflows. Orchestrates INTAKE, DEBUG-DIALOGUE, and HANDOFF stages. This is a REFERENCE DOCUMENT for the main Claude orchestrator — do NOT launch this as a subagent. Read this file for guidance, then launch the reggie-codebase-debugger agent via the Task tool."
tools: Glob, Grep, Read, Bash
model: opus
memory: user
---

## Role

This document guides the main Claude orchestrator through the debug workflow pipeline. It manages systematic debugging investigations through INTAKE, DEBUG-DIALOGUE, and HANDOFF stages, ensuring thorough diagnosis before any code changes. The workflow produces a diagnosis document that feeds into code-workflow at the PLAN stage.

**IMPORTANT**: This is a reference document, not a subagent. The main Claude reads this for guidance and launches the reggie-codebase-debugger agent for investigation.

## Pipeline Overview

```
INTAKE → DEBUG-DIALOGUE → HANDOFF → [code-workflow at PLAN]
```

**Quality Gates**: Debug workflows use confirmation-based gates rather than numeric scores. The user confirms at each transition point.

## --yes Flag Handling (Ralph Wiggum Mode)

When `--yes` is present in $ARGUMENTS, the orchestrator auto-approves stage gates **within** a single debug session — INTAKE clarifications are skipped, convergence checks auto-proceed, diagnosis confirmation auto-approved. The end-of-slug HANDOFF checkpoint (the three-option "What next?" prompt) is **never** auto-approved — debug findings always warrant a human pause.

### Slug-Mode Entry Path (`--yes <slug>`)

When `--yes` is followed by a slug argument, the pipeline enters **slug-mode**.

**Cross-pipeline guard (FIRST — before reading task.md):** Pattern-match the slug's TASKS.md line for its mode tag.
- `[code]` / `[design]` → redirect to `/reggie-code-workflow [slug]`, exit.
- `[manual]` → redirect to `/reggie-manual-task [slug]`, exit.
- `[reggie-system]` → redirect to `/reggie-system-change --yes [slug]`, exit.
- `[debug]` → proceed.
- Slug not in TASKS.md → print "not found" and exit.

**Stage handling**:
- **Skip INTAKE clarifications**: read `.pipeline/<slug>/task.md` and use its Problem / Vision / Context / Acceptance Criteria sections as the symptom summary.
- **DEBUG-DIALOGUE**: launch `reggie-codebase-debugger` with task.md content as context; auto-approve convergence checks.
- **HANDOFF**: produce the structured Debug Summary (hypotheses tested / root cause / fix applied / confidence / open questions). Print in-session AND write to `.pipeline/<slug>/HANDOFF.md`.

### End-of-Slug Checkpoint (mandatory, never auto-approved)

After the HANDOFF summary, present these three options:
```
What next?
  1. Continue investigating this bug
  2. Move to next debug task
  3. Done
```

- **1**: Re-enter DEBUG-DIALOGUE for the same slug, carrying prior hypotheses forward.
- **2 / "Next" / "Move to next"**: Mark current slug `[x]` (move to HISTORY.md), scan backlog for next `[debug]` slug in document order, re-enter slug-mode. If none remain, exit.
- **3**: Mark current slug `[x]`, exit.

**The orchestrator MUST NOT auto-continue between debug slugs** without explicit user input. This is the critical difference from `/reggie-system-change --yes <slug>`'s serial auto-loop.

## Stage Reference

| Stage | Purpose | Agent | Quality Gate |
|-------|---------|-------|--------------|
| INTAKE | Understand symptoms | main Claude | Symptoms clearly documented |
| DEBUG-DIALOGUE | Locate root cause | reggie-codebase-debugger | Root cause identified with evidence |
| HANDOFF | Create diagnosis, transition | main Claude | User confirms diagnosis |

## Stage Details

### Stage 1: INTAKE

**Purpose**: Gather symptom details through targeted questions.

**Actions**:
1. Read the user's initial symptom description
2. Ask 2-3 focused clarifying questions:
   - When does this happen? (Always, sometimes, after specific actions?)
   - What is the expected vs actual behavior?
   - When did this start? (Recent change, always broken, regression?)
   - Can it be reproduced reliably?
3. Do NOT investigate the codebase yet — focus on understanding the problem space
4. Document the symptoms clearly

**Transition Criteria**: Symptoms are documented (what, when, expected vs actual, reproducibility)

**Announce Transition**:
```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
INTAKE Complete — Moving to DEBUG-DIALOGUE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Symptoms documented:
- [Summary of what user described]
- [Expected vs actual]
- [Timing/reproducibility]

Now launching reggie-codebase-debugger to investigate...
```

---

### Stage 2: DEBUG-DIALOGUE

**Agent**: reggie-codebase-debugger

**Purpose**: Iterative conversation to locate the root cause through hypothesis-driven investigation.

**Prompt Template for Launching reggie-codebase-debugger**:
```
Investigate this bug through hypothesis-driven debugging.

## Symptoms
[Summary from INTAKE]

## Expected Behavior
[What should happen]

## Actual Behavior
[What is happening]

## Context
[Any additional context: recent changes, timing, reproduction steps]

## Your Task
1. Form 2-3 initial hypotheses ranked by likelihood
2. Investigate the most likely hypothesis first
3. Report findings with evidence
4. Offer convergence checks every 3-4 investigation cycles
5. Continue until root cause is identified or user decides to proceed

Remember: Diagnose only — do not propose fixes until diagnosis is confirmed.
```

**During DEBUG-DIALOGUE**:
- Let reggie-codebase-debugger lead the investigation
- The debugger will invoke reggie-researcher for deep subsystem investigation if needed
- Debugger offers periodic convergence checks

**Convergence Check Format** (from reggie-codebase-debugger):
```
Let me summarize where we are:

**Tested**: [Hypotheses tested]
**Ruled out**: [What it's NOT]
**Current theory**: [Best explanation]
**Confidence**: [High/Medium/Low]

Should we proceed with this diagnosis, or investigate further?
```

**Transition Criteria**:
- Root cause identified with evidence, AND
- User confirms the diagnosis makes sense

---

### Stage 3: HANDOFF

**Purpose**: Create diagnosis document and transition to code-workflow.

**Actions**:
1. Generate the diagnosis document (see format below)
2. Present diagnosis summary to user
3. Ask: "Ready to proceed to planning the fix?"
4. On confirmation, transition to code-workflow at PLAN stage

**Diagnosis Document Format**:
```markdown
# Diagnosis: [Brief descriptive title]

## Symptoms
[What the user observed — exact error messages, unexpected behavior]

## Investigation Summary
[Key areas examined, what was found, what was ruled out]

## Root Cause
[Clear statement of what is causing the problem]

## Evidence
[Specific code locations, log outputs, test results that confirm the diagnosis]

## Affected Systems
[Files, modules, services impacted]

## Recommended Fix Direction
[High-level approach to fixing — not detailed implementation]

## Open Questions
[Any uncertainties or areas that may need further investigation during implementation]
```

**Handoff to Code-Workflow**:
```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
HANDOFF — Transitioning to code-workflow
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Diagnosis complete. Starting code-workflow at PLAN stage.

The diagnosis will inform the implementation plan.
```

Then invoke code-workflow with the diagnosis as context, starting at the PLAN stage (skipping IDEATION since the problem is already understood).

---

## Quality Gate Criteria

**INTAKE → DEBUG-DIALOGUE**:
- User has answered clarifying questions
- Symptoms are documented (what, when, expected vs actual)
- Initial scope is understood

**DEBUG-DIALOGUE → HANDOFF**:
- At least one hypothesis has been tested
- Root cause is identified OR user decides to proceed with best current understanding
- Evidence exists linking root cause to symptoms

**HANDOFF → code-workflow**:
- Diagnosis document is complete
- User confirms the diagnosis
- User approves proceeding to fix

## Workflow Commands

| Command | Action |
|---------|--------|
| `status` | Show current stage and findings so far |
| `hypotheses` | List hypotheses tested and their status |
| `diagnose` | Force transition to HANDOFF with current understanding |
| `abort` | Exit workflow without handoff |

## Output Format

### Stage Announcements
```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
STAGE: [STAGE NAME]
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

[Stage-specific content]
```

### Status Response
```
## Debug Workflow Status

**Current Stage**: [INTAKE/DEBUG-DIALOGUE/HANDOFF]
**Symptoms**: [Brief summary]
**Hypotheses Tested**: [Count]
**Current Leading Theory**: [Summary or "Still investigating"]
**Next Action**: [What happens next]
```

## Integration Points

- **reggie-codebase-debugger**: Primary investigation agent during DEBUG-DIALOGUE
- **reggie-researcher**: Invoked by reggie-codebase-debugger for deep investigation
- **code-workflow**: Receives handoff at PLAN stage with diagnosis context

## Common Pitfalls

- Rushing to DEBUG-DIALOGUE before symptoms are clear
- Letting investigation sprawl without convergence checks
- Creating diagnosis document before user confirms understanding
- Skipping evidence gathering — diagnosis must be grounded in code
- Forgetting to pass diagnosis context to code-workflow
