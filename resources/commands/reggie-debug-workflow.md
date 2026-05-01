---
type: pipeline
manager: reggie-debug-manager
---

# Debug Workflow

Conversational debugging workflow that produces a diagnosis before transitioning to code-workflow for implementation.

## Context

```bash
echo "=== Git Status ==="
git status --short 2>/dev/null || echo "Not a git repository"

echo ""
echo "=== Recent Commits (last 5) ==="
git log --oneline -5 2>/dev/null || echo "No git history"

echo ""
echo "=== Modified Files ==="
git diff --name-only 2>/dev/null | head -10

echo ""
echo "=== Project Type ==="
if [ -f "package.json" ]; then echo "Node/JS project"; fi
if [ -f "*.xcodeproj" ] || [ -f "Package.swift" ]; then echo "iOS/Swift project"; fi
if [ -f "build.gradle" ]; then echo "Android project"; fi
if [ -f "go.mod" ]; then echo "Go project"; fi
if [ -f "Cargo.toml" ]; then echo "Rust project"; fi
if [ -f "requirements.txt" ] || [ -f "pyproject.toml" ]; then echo "Python project"; fi
```

## Instructions

You are orchestrating a debug workflow. This is a conversational debugging process that produces a diagnosis before any code changes.

**IMPORTANT**: You (the main Claude) run this workflow directly. Read `~/.claude/agents/reggie-debug-manager.md` for stage guidance, then launch the reggie-codebase-debugger agent via the Task tool during DEBUG-DIALOGUE. When launching any agent via Task, only use `model: "opus"` or `model: "sonnet"` — never `model: "haiku"`.

**`--yes` flag (Ralph Wiggum mode)**: If `$ARGUMENTS` contains `--yes`, strip it from arguments and auto-approve stage gates **within** a single debug session — INTAKE clarifications, convergence checks during DEBUG-DIALOGUE, and the diagnosis confirmation. The HANDOFF summary checkpoint at the end of each slug is **never** auto-approved; the user always reviews summaries before moving to the next debug task.

**`--yes <slug>` mode (slug-mode entry)**: When `--yes` is followed by a slug argument (e.g., `/reggie-debug-workflow --yes investigate-stale-meta`), the pipeline enters **slug-mode**:

1. **Cross-pipeline guard** (FIRST — before reading anything else): Read the slug's line in TASKS.md and pattern-match the mode tag inside square brackets.
   - `[code]` / `[design]` → print:
     ```
     [slug] is a [code]/[design] task. Run:
       /reggie-code-workflow [slug]
     ```
     Exit cleanly with `~~REGGIE:DONE:reggie-debug-workflow:failed~~`.
   - `[manual]` → print:
     ```
     [slug] is a [manual] task. Run:
       /reggie-manual-task [slug]
     ```
     Exit.
   - `[reggie-system]` → print:
     ```
     [slug] is a [reggie-system] task. Run:
       /reggie-system-change --yes [slug]
     ```
     Exit.
   - `[debug]` → proceed.
   - Slug not in TASKS.md → print "not found" and exit.

2. **Slug-mode entry path**: Read `.pipeline/<slug>/task.md` and use its Problem / Vision / Context / Acceptance Criteria sections as the symptom + investigation context.
   - **Skip Stage 1 (INTAKE)** clarification questions — task.md already documents the symptoms.
   - **Enter at Stage 2 (DEBUG-DIALOGUE)**: launch `reggie-codebase-debugger` with task.md as the symptom summary, auto-approve all convergence checks (since `--yes` is active).
   - **Run Stage 3 (HANDOFF)** with the structured summary format below.

3. **HANDOFF summary** (printed in the session, not just a file): The HANDOFF stage MUST end every debug slug — including slug-mode runs — with a structured summary in this exact format:

   ```
   ## Debug Summary: [slug]

   ### Hypotheses tested
   - [hypothesis 1]: [confirmed / ruled out / inconclusive] — [1-line evidence]
   - [hypothesis 2]: ...

   ### Root cause identified
   [Clear single-paragraph statement, OR "Inconclusive — see Open Questions"]

   ### Fix applied (if any)
   [Description of fix, or "No fix applied — diagnosis only"]

   ### Confidence level
   [High / Medium / Low] — [1-line justification]

   ### Open questions
   - [unresolved question 1]
   - [unresolved question 2]
   - [Or: "None"]
   ```

   This summary is also written to `.pipeline/<slug>/HANDOFF.md` for downstream pipelines.

4. **End-of-slug checkpoint prompt** (always shown — never auto-approved by `--yes`): After printing the summary, present these three options exactly:

   ```
   What next?
     1. Continue investigating this bug
     2. Move to next debug task
     3. Done

   (Type 1 / 2 / 3, or "Next" as a synonym for option 2.)
   ```

   - **Option 1 ("Continue investigating this bug")**: Re-enter Stage 2 (DEBUG-DIALOGUE) for the same slug. Carry the prior hypotheses and evidence forward — don't restart from scratch.
   - **Option 2 / "Next" / "Move to next"**: Mark the current slug `[x]` in TASKS.md, move to HISTORY.md with the standard meta-commit, then scan `## Backlog` for the next `[debug]` slug in document order. If one exists, re-enter slug-mode with that slug. If none remain, exit cleanly with `~~REGGIE:DONE:reggie-debug-workflow:success~~`.
   - **Option 3 ("Done")**: Mark the current slug `[x]` in TASKS.md, migrate to HISTORY.md with the standard meta-commit (`meta: complete [slug]`), then exit cleanly with `~~REGGIE:DONE:reggie-debug-workflow:success~~`. Does not scan for the next `[debug]` slug — only Option 2 continues.

   **Auto-continue rule**: The orchestrator MUST NOT auto-continue to the next `[debug]` slug without an explicit "Next" / "Move to next" / "2" from the user. `--yes` accelerates work *within* a debug session but never bypasses this checkpoint between sessions. This is intentional — debug findings often warrant human pause.

### The Pipeline

```
INTAKE → DEBUG-DIALOGUE → HANDOFF → [code-workflow at PLAN]
```

### When to Use This vs /reggie-debug

- **`/reggie-debug`** — Quick investigation for simple, obvious issues
- **`/reggie-debug-workflow`** — Structured diagnosis for complex bugs where the cause isn't clear

### Arguments

```
/reggie-debug-workflow                              # Prompts for symptom description
/reggie-debug-workflow the app crashes on launch    # With initial symptoms
/reggie-debug-workflow --yes                        # Auto-approve in-session gates (still pauses at HANDOFF checkpoint)
/reggie-debug-workflow --yes <slug>                 # Slug-mode: read .pipeline/<slug>/task.md as symptom context, run autonomously, end with HANDOFF summary + checkpoint
/reggie-debug-workflow $ARGUMENTS                   # Captures all args as symptoms
```

---

## Stage 1: INTAKE

**Purpose**: Understand the symptoms before investigating.

**Your actions**:
1. Read the user's symptom description from `$ARGUMENTS` (or prompt if empty)
2. Ask 2-3 clarifying questions:
   - When does this happen? (Always, sometimes, after specific actions?)
   - What is the expected vs actual behavior?
   - When did this start? (Recent change, always broken, regression?)
   - Can it be reproduced reliably?
3. Do NOT investigate the codebase yet — focus on understanding

**Transition**: When symptoms are clear, announce:
```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
INTAKE Complete — Moving to DEBUG-DIALOGUE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

---

## Stage 2: DEBUG-DIALOGUE

**Purpose**: Locate the root cause through hypothesis-driven investigation.

**Your actions**:
1. Launch the **reggie-codebase-debugger** agent with the symptom summary:
   ```
   Task tool → subagent_type: reggie-codebase-debugger
   Prompt: Include symptoms, expected/actual behavior, context
   ```
2. The debugger will:
   - Form hypotheses about potential causes
   - Investigate the codebase to test hypotheses
   - Ask follow-up questions if needed
   - Invoke reggie-researcher for deep subsystem investigation
   - Offer periodic convergence checks

3. When the debugger offers a convergence check like:
   > "Here's what I think is happening: [diagnosis]. Should we fix this or dig deeper?"

   Let the user decide whether to proceed or continue investigating.

**Transition**: When user confirms the diagnosis, announce:
```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
DEBUG-DIALOGUE Complete — Moving to HANDOFF
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

---

## Stage 3: HANDOFF

**Purpose**: Create diagnosis document and transition to code-workflow.

**Your actions**:
1. Generate a diagnosis document:

```markdown
# Diagnosis: [Brief title]

## Symptoms
[What the user observed]

## Investigation Summary
[Key areas examined, what was found, what was ruled out]

## Root Cause
[Clear statement of what is causing the problem]

## Evidence
[Specific code locations, log outputs, test results]

## Affected Systems
[Files, modules, services impacted]

## Recommended Fix Direction
[High-level approach — not detailed implementation]

## Open Questions
[Any uncertainties for implementation phase]
```

2. Present the diagnosis summary to user
3. Ask: "Ready to proceed to planning the fix?"
4. On confirmation, start code-workflow at PLAN stage with diagnosis as context

**Handoff announcement**:
```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
HANDOFF — Starting code-workflow at PLAN
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

After the handoff announcement, emit:

```
~~REGGIE:DONE:reggie-debug-workflow:success~~
```

If the user says `abort` at any stage, emit:

```
~~REGGIE:DONE:reggie-debug-workflow:failed~~
```

---

## Post-HANDOFF: CAPTURE-LEARNINGS

After handing off to code-workflow, capture agent-level learnings. This feeds the self-improvement loop.

**Process**:
1. Review the debug pipeline — hypothesis quality, investigation efficiency
2. For each genuine learning, append an entry to `~/.claude/AGENT-IMPROVE.md` using the standard entry format (see `~/.claude/agents/reggie-improve-manager.md` for format)
3. If the pipeline ran smoothly, capture zero learnings — do NOT invent entries
4. Classify each learning at capture time:
   - **UNIVERSAL**: Would benefit any project using this agent (general best practices, language-level patterns)
   - **PROJECT**: Specific to this project (conventions, dependencies, domain knowledge)
   - **PROCESS**: Suggests a pipeline/command workflow change
   - If unsure, default to PROJECT

**Focus areas for debug-workflow**:
- Did the reggie-codebase-debugger form good initial hypotheses?
- How many hypotheses were tested before finding root cause?
- Did the debugger invoke reggie-researcher when it should have?
- Was the diagnosis accurate?

After capturing (or skipping), the AUTO-IMPROVE stage runs next.

---

## AUTO-IMPROVE

After CAPTURE-LEARNINGS, automatically run the improve pipeline if enough entries have accumulated.

**Process**:
1. Count entries in `~/.claude/AGENT-IMPROVE.md` (count `## Entry:` headers)
2. If file doesn't exist or has 0 entries: skip silently, proceed to next stage
3. If 1-2 entries: print "X entries in AGENT-IMPROVE.md (below threshold of 3). Deferring to next pipeline run." and proceed
4. If 3+ entries: run the improve pipeline with `--minor-only` behavior:
   - Read `~/.claude/agents/reggie-improve-manager.md` for full stage guidance
   - Execute COLLECT → CLASSIFY → ANALYZE → PROPOSE → APPLY → VERIFY → CURATE
   - Auto-apply minor changes (Common Pitfalls, Quality Standards, project memory entries)
   - Log major proposals to `~/.claude/IMPROVE-CHANGELOG.md` but do NOT prompt for approval — defer to explicit `/reggie-improve` run
   - Clear processed minor entries from AGENT-IMPROVE.md; keep major entries for later

**Summary box** (print after AUTO-IMPROVE completes or skips):
```
┌──────────────────────────────────────────────────────────────────┐
│ AUTO-IMPROVE (debug-workflow)                                     │
│                                                                  │
│ Entries found: [N]                                               │
│ Threshold: 3                                                     │
│ Action: [skipped — no entries | deferred — below threshold |     │
│          ran — N minor applied, N major deferred]                │
└──────────────────────────────────────────────────────────────────┘
```

---

## Workflow Controls

| Command | Action |
|---------|--------|
| `continue` / `y` | Proceed to next stage |
| `status` | Show current stage and findings |
| `hypotheses` | List tested hypotheses |
| `diagnose` | Force transition to HANDOFF |
| `abort` | Exit without handoff |

---

## Example Session

```
> /reggie-debug-workflow the login button doesn't work

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
STAGE: INTAKE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

I understand the login button isn't working. Let me ask a few questions:

1. What happens when you tap it? (Nothing? Error? Partial response?)
2. Did this work before, or has it never worked?
3. Is this happening for all users or just you?

[User answers]

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
INTAKE Complete — Moving to DEBUG-DIALOGUE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Launching reggie-codebase-debugger to investigate...

[Debugger investigates, forms hypotheses, reports findings]

Debugger: "Based on my investigation, here's what I think is happening:
The button's onTap handler is calling an async function but not awaiting it,
causing the auth state to update after the UI check. Confidence: High.

Should we proceed to fix this, or investigate further?"

> proceed

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
DEBUG-DIALOGUE Complete — Moving to HANDOFF
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

## Diagnosis: Missing await in login handler

**Root Cause**: LoginButton.swift:42 — onTap calls authenticateUser()
without await, race condition with UI state check.

**Evidence**: Auth logs show state updates after navigation check.

**Fix Direction**: Add await, restructure async flow.

Ready to proceed to planning the fix?

> yes

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
HANDOFF — Starting code-workflow at PLAN
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

