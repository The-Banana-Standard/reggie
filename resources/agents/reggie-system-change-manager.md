---
name: reggie-system-change-manager
description: "Pipeline manager for formalizing changes to the ~/.claude/ agent system — both modifying existing components and creating new ones. Orchestrates INTAKE, BRAINSTORM, PLAN, IMPLEMENT, and VERIFY stages with on-demand research. This is a REFERENCE DOCUMENT for the main Claude orchestrator — do NOT launch this as a subagent. Read this file for guidance, then run each stage yourself. Examples: (1) '/reggie-system-change' triggers the pipeline when you already know what you want to change. (2) 'I want to change how the improve pipeline classifies learnings' triggers a focused system change workflow. (3) 'I need a new agent for reviewing database schemas' triggers creation of a new component through the same structured pipeline."
tools: Glob, Grep, Read, Edit, Write
model: opus
memory: user
---

## Role

This document guides the main Claude orchestrator through the reggie-system-change pipeline. It formalizes changes to the `~/.claude/` agent system that emerge from conversation or known requirements — when you already know what you want to change and need a structured process to design, implement, and verify it.

**IMPORTANT**: This is a reference document, not a subagent. The main Claude reads this for guidance and executes each stage directly.

**This is NOT /reggie-evaluation-system.** The evaluate-reggie pipeline discovers issues through systematic inventory and analysis. This pipeline starts with a known change request — the user already knows what they want to modify.

**This is NOT /reggie-improve.** The improve pipeline processes accumulated per-agent learnings from AGENT-IMPROVE.md entries. This pipeline handles deliberate, user-initiated system changes.

---

## Pipeline Overview

```
INTAKE → BRAINSTORM → PLAN → IMPLEMENT → VERIFY
              ↕              ↕
           RESEARCH        RESEARCH
          (on demand)     (on demand)
```

Confirmation-based gates with one exception: when the PLAN includes `new-component` changes (creating new files), the plan goes through **reggie-judge scoring (9.0/10)** to validate design quality before user approval. All other gates are confirmation-based.

## --yes Flag Handling

When `--yes` is present in $ARGUMENTS, the orchestrator auto-approves ALL **in-session** confirmation gates for the current task:

- INTAKE confirmation → auto-proceed
- BRAINSTORM direction confirmation → auto-proceed
- PLAN approval → auto-approve entire plan
- Frontmatter change approvals → auto-approve each
- VERIFY issues → auto-fix and continue

**Does NOT affect**: Judge scoring (9.0/10) on new-component plans, file validation checks, cross-reference verification.

### Slug-Mode Entry Path (`--yes <slug>`)

When `--yes` is followed by a slug argument, the pipeline enters **slug-mode**: it reads `.pipeline/<slug>/task.md` as the authoritative plan input and skips conversational stages.

**Cross-pipeline guard (FIRST — before reading task.md):** Pattern-match the slug's TASKS.md line for its mode tag.
- `[code]` / `[design]` → redirect to `/reggie-code-workflow [slug]`, exit.
- `[manual]` → redirect to `/reggie-manual-task [slug]`, exit.
- `[debug]` → redirect to `/reggie-debug-workflow --yes [slug]`, exit.
- `[reggie-system]` → proceed.
- Slug not in TASKS.md → print "not found" and exit.

**Stage skipping**: With `--yes <slug>`:
- **Skip Stage 1 (INTAKE)** — task.md already has WHAT/WHY/CONTEXT.
- **Skip Stage 2 (BRAINSTORM)** — design was locked at init-tasks ORGANIZE time.
- **Skip the PLAN judge gate** — the plan was already evaluated at init-tasks time and accepted by the user; re-judging is wasted work.
- **Enter at Stage 3 (PLAN)**: present `.pipeline/<slug>/task.md`'s `## Implementation Plan` as the change plan, auto-approve, advance.
- Run Stage 4 (IMPLEMENT) and Stage 5 (VERIFY) normally with auto-approval.

**Single-task scope (no auto-continue)**: After VERIFY passes:
1. Mark the slug `[x]` in TASKS.md (move to HISTORY.md), commit metadata.
2. Emit `~~REGGIE:DONE:reggie-system-change:success~~` and exit.

Do **not** scan for the next `[reggie-system]` slug, do **not** run `/compact`, do **not** re-enter the pipeline. The Reggie UI handles task-to-task relaunch when the session was launched via per-repo or Batch Start — it detects the DONE marker and starts the next eligible slug in a fresh session.

**Runtime cap = 1.** Every `[reggie-system]` change touches `~/.claude/` (or the `resources/` source-of-truth tree), so parallel runs would race. The UI enforces a workspace-wide cap of 1 concurrent `/reggie-system-change` invocation; never launch a second `/reggie-system-change` while one is active, even from a batch sweep.

### On-Demand Research

BRAINSTORM and PLAN can dispatch the **reggie-researcher** agent when questions arise about current system state that require reading many files. This is not a sequential stage — it is a tool available to the orchestrator when the reggie-thought-partner needs information not already in context, or when dependency tracing during planning requires broad file exploration.

**When to dispatch reggie-researcher**:
- The reggie-thought-partner asks "how does X currently work?" and you do not have the answer in context
- The reggie-claude-architect needs to know which files reference a specific agent before planning changes
- A dependency question arises that requires reading multiple files to answer

**When NOT to dispatch reggie-researcher**:
- The information is already in the conversation context
- The question can be answered by reading a single file (just read it directly)
- The change is simple enough that full investigation is unnecessary

---

## Stage Reference

| Stage | Purpose | Executor | Gate |
|-------|---------|----------|------|
| INTAKE | Capture the change request with full context | Main Claude | Auto (requirement stated) |
| BRAINSTORM | Explore the design space, confirm direction | reggie-thought-partner agent | User confirms direction |
| PLAN | Concrete file-by-file change plan with classifications | Main Claude (orchestrator-direct) | User approves plan (+ reggie-judge 9.0/10 if new components) |
| IMPLEMENT | Execute approved plan: direct edits + file creation | Main Claude | Changes applied |
| VERIFY | Validate consistency after changes | reggie-researcher agent | All checks pass |

---

## Stage Details

### Stage 1: INTAKE

**Executor**: Main Claude (no subagent)

**Purpose**: Capture the change request clearly. This stage synthesizes what the user wants from the conversation so far and presents it back for confirmation before proceeding.

**Process**:

1. Review the conversation history. Identify:
   - **What** is being changed (which agents, commands, pipelines, conventions)
   - **Why** (what prompted this — a problem, a new idea, a conversation insight)
   - **Context** (any prior discussion, decisions, or constraints already established)

2. Present the change request back to the user in this format:

```
## Change Request

**What**: [1-2 sentences describing the change]

**Why**: [1-2 sentences on motivation]

**Context**: [Any prior discussion or decisions that inform this]

**Scope estimate**: [small (1-3 files) / medium (4-8 files) / large (9+ files)]

Does this capture what you want to change?
```

3. If the user corrects or adds detail, update and re-present.

**Pass Criteria**: User confirms the change request captures their intent. If the change request is obvious from prior conversation, this stage can be very brief — even a single confirmation.

---

### Stage 2: BRAINSTORM

**Executor**: Launch **reggie-thought-partner** agent via Task tool

**Purpose**: Explore the design space for the change. Quick if the direction is obvious from conversation context, deeper if there are real design questions to resolve.

**Prompt Template**:
```
We're making a change to the ~/.claude/ agent system. Here's the change request:

[Include the confirmed INTAKE change request]

Your job is to help think through the design space for this change. Some changes are obvious — if the user and conversation have already made the direction clear, reflect that back quickly and confirm. Other changes have real design questions worth exploring.

Questions to consider (only if genuinely uncertain):
- Are there multiple reasonable approaches? What are the trade-offs?
- Does this change interact with other parts of the system in ways that need thinking through?
- Are there second-order effects — things that would need to change as a consequence?
- Is there a simpler version of this change that gets 80% of the value?

If the direction is already clear from the conversation context, say so: "The direction here seems straightforward — [summary]. Any aspects you want to explore before we plan?"

If there are real design questions, explore them one at a time.

When the direction is confirmed, produce a summary:

## Brainstorm Summary

### Direction (confirmed)
[1-3 sentences describing the agreed approach]

### Design decisions made
- [Decision 1]
- [Decision 2]

### Open questions for PLAN to resolve
- [Any implementation-level questions the architect should figure out]

### Out of scope
- [Anything explicitly excluded]
```

**On-demand research**: If the reggie-thought-partner (or you, while formulating the prompt) needs information about current system state — how an agent currently works, what a pipeline manager currently does, which files reference something — dispatch the **reggie-researcher** agent to gather that information before or during the brainstorm.

**Pass Criteria**: User confirms the brainstorm summary direction. This is a conversational gate.

---

### Stage 3: PLAN (Orchestrator-Direct Mode)

**Executor**: Main Claude (orchestrator handles planning directly)

**Purpose**: Produce a concrete, file-by-file change plan with classifications, risks, and dependencies. The orchestrator writes the plan directly instead of delegating to reggie-claude-architect — this eliminates context transfer overhead since the orchestrator already has the conversation context, brainstorm findings, and direct file access.

**Process**:

1. Read the files most likely to be affected (use Read tool directly)
2. If tracing dependencies (which commands reference an agent, which pipeline managers list a stage), use Grep to search across the system
3. Write the plan following this format:

```
## Change Plan

### Change 1: [file path]
- **Action**: modify / create-new / integration-update
- **Classification**:
  - `direct-edit` — Modification to an existing file. Will be applied inline during IMPLEMENT.
  - `new-component` — A new agent, command, or workflow file. Will be created directly during IMPLEMENT with validation.
  - `integration-update` — Update to PORTABLE-PACKAGE.md, reggie-guide.md, or MEMORY.md to reflect changes.
- **What changes**: [Specific description of modifications — which sections, what content]
- **Frontmatter affected**: yes / no (if yes, specify which fields change — these need per-change user approval)
- **Risk**: low (additive) / medium (modifies behavior) / high (restructures patterns)

### Change 2: [file path]
...

### Dependencies
- [Change N] must happen before [Change M] because [reason]
- [Or: No dependencies — changes are independent]

### Risks
- [Risk 1]: [mitigation]
- [Risk 2]: [mitigation]

### Execution Order
1. [Change] — [reason for ordering]
2. [Change]
...
N. Integration updates (always last)

### Summary
- Total changes: [N]
- Direct edits: [N]
- New components: [N]
- Integration updates: [N]
- Frontmatter changes requiring approval: [N]
```

4. Run validation checks on your own plan (see below)
5. If the plan includes `new-component` changes, launch the **reggie-judge** agent to score design quality (9.0/10 threshold)
6. Present the plan to the user for approval. If `--yes` flag is active, auto-approve.

**On-demand research**: If you need to trace dependencies that require reading many files — dispatch the **reggie-researcher** agent to do the dependency analysis. For simple dependency checks (grep for a name across a few files), do it yourself.

**Classification rules**:
- **direct-edit**: Any modification to an existing agent, command, or pipeline manager file. This includes adding sections, changing content, updating descriptions, adjusting process steps.
- **new-component**: Any brand-new agent, command, or workflow file that does not yet exist. Created directly during IMPLEMENT using the Write tool, following the file templates and validation checks below.
- **integration-update**: Updates to PORTABLE-PACKAGE.md, reggie-guide.md, MEMORY.md to reflect changes made. Always the last step.

**Validation checks** (performed by the orchestrator on its own plan):

1. **Naming conflicts**: Do any proposed filenames already exist in `~/.claude/agents/` or `~/.claude/commands/`?
2. **Naming conventions**: Do names follow role-based pattern (e.g., `reggie-researcher` not `reggie-research`)?
3. **Tool permissions validation**:
   - Valid tools only: `Glob, Grep, Read, Edit, Write, NotebookEdit, Bash, WebFetch, WebSearch`
   - No invalid combinations: Write without Read, Bash without Read, NotebookEdit without Read
   - Permission level appropriate for role: reviewers/analysts → Read-only, research → +Web, content/refactoring → +Write, developers/DevOps/QA → +Bash
4. **Required sections**: Does design include all standard sections for file type?
   - Agents: Role, Core Responsibilities, Process, Quality Standards, Output Format, Common Pitfalls
   - Commands: Context bash, Instructions, Arguments
   - Pipeline Managers: Pipeline Overview, Stage Details, Output Format
5. **Description quality**: Does agent description include 2-3 trigger examples?
6. **Path validation**: Are all paths absolute under `~/.claude/`?
7. **Integration completeness**: Are updates to PORTABLE-PACKAGE.md, reggie-guide.md, MEMORY.md identified? When a change removes or renames a string (field name, stage name, slug, keyword), grep for it across `resources/docs/` in addition to `resources/agents/` and `resources/commands/` — PORTABLE-PACKAGE.md contains full format examples that mirror agent/command files and will silently diverge otherwise.
8. **No skills**: Reject any attempt to create a skill — language/framework patterns belong in developer agents.

**Conditional reggie-judge scoring**: If the plan includes ANY `new-component` changes, launch the **reggie-judge** agent to score the plan design quality at 9.0/10 threshold. The judge evaluates: naming quality, tool permission appropriateness, section completeness, description quality, integration coverage. If the plan has only `direct-edit` and `integration-update` changes, skip reggie-judge scoring.

**The reggie-claude-architect agent is NOT deleted.** It remains available for:
- Standalone `/reggie-plan` command (user explicitly wants a subagent to plan)
- `/reggie-init-tasks` ORGANIZE phase (reggie-code-architect groups and prioritizes tasks)
- `/reggie-new-repo` task breakdown (reggie-code-architect analyzes project structure)
- Tournament mode (if PLAN stage escalates to tournament, reggie-code-architect is launched as one of the two competitors)

**Pass Criteria**: User approves the plan. They may approve all changes, approve some and reject others, or request modifications to specific changes. If reggie-judge scoring was triggered, plan must also pass 9.0/10.

---

### Stage 4: IMPLEMENT

**Executor**: Main Claude (no subagent)

**Purpose**: Execute the approved plan. Apply direct edits, create new components, and apply integration updates.

**Process**:

1. **Present the approved plan** for final confirmation:
   - List each change with its classification and risk
   - For any frontmatter changes, ask for explicit per-change approval:
     ```
     Change 3 modifies YAML frontmatter in reggie-researcher.md:
       tools: adding WebSearch
     Approve this frontmatter change? (y/n)
     ```

2. **Execute changes in the planned order**:

   **For `direct-edit` changes**:
   - Read the current file
   - Apply the planned modification using Edit tool
   - Validate: YAML frontmatter still parses, required sections still present
   - Report what was changed

   **For `new-component` changes**:
   - Read 2-3 similar existing files to understand current patterns (e.g., if creating an agent, read agents in the same category)
   - Create the file using Write tool, following the file templates below
   - Validate: YAML frontmatter valid, all required sections present, description includes trigger examples
   - Report what was created

   **For `integration-update` changes**:
   - Apply updates to PORTABLE-PACKAGE.md, reggie-guide.md, MEMORY.md using Edit tool
   - Update counts, table entries, descriptions, references

3. **Print implementation summary**:
   ```
   ## Implementation Summary

   ### Applied directly
   - [file]: [what changed]

   ### New components created
   - [file]: [what was created]

   ### Integration updates
   - [file]: [what updated]

   ### Skipped (user rejected)
   - [change]: [reason]
   ```

**Safety Rules**:
- Never delete agent or command files — only modify or note for manual deletion
- Never modify YAML frontmatter without explicit per-change user approval
- Always read a file before editing it (verify current state matches expectations)
- If a file has changed unexpectedly since PLAN, stop and report the discrepancy
- When creating new files, always read 2-3 similar existing files first to match patterns
- New agent/command files must pass format validation before logging as complete

---

### Stage 5: VERIFY

**Executor**: Launch **reggie-researcher** agent via Task tool

**Purpose**: Validate that all implemented changes are internally consistent, no references are broken, and counts are accurate.

**Prompt Template**:
```
Verify the consistency of the ~/.claude/ system after recent changes.

Changes made:
[Include the full implementation summary from IMPLEMENT stage]

Check the following:

1. FILE COUNTS
   - Count actual .md files in ~/.claude/agents/ and ~/.claude/commands/
   - Compare against counts stated in PORTABLE-PACKAGE.md
   - Compare against counts in MEMORY.md

2. CROSS-REFERENCES
   - Every agent referenced in a command file exists in ~/.claude/agents/
   - Every command listed in reggie-guide.md exists in ~/.claude/commands/
   - Every pipeline manager listed in PORTABLE-PACKAGE.md exists
   - No dangling references to renamed agents or commands

3. INTERNAL CONSISTENCY
   - Pipeline manager stage lists match their corresponding command files
   - Agent tool lists in PORTABLE-PACKAGE.md match actual agent frontmatter
   - reggie-guide.md "Which Command" table includes all current commands
   - reggie-guide.md quick reference lists all current commands

4. FORMAT VALIDATION
   - All modified agent files have valid YAML frontmatter (name, description, tools, model, memory)
   - All modified command files have ## Context and ## Instructions sections
   - No orphaned sections or broken markdown

5. DESCRIPTION ACCURACY
   - Modified agent descriptions still accurately reflect what the agent does
   - Pipeline manager descriptions still include the REFERENCE DOCUMENT warning
   - Modified agent descriptions still include 2-3 example triggers

Output format:

## Verification Results

### Status: [PASS / FAIL]

### Checks
| Check | Result | Details |
|-------|--------|---------|
| File counts match | PASS/FAIL | [specifics] |
| Cross-references valid | PASS/FAIL | [specifics] |
| Internal consistency | PASS/FAIL | [specifics] |
| Format validation | PASS/FAIL | [specifics] |
| Description accuracy | PASS/FAIL | [specifics] |

### Issues Found (if any)
- [issue]: [what's wrong and how to fix it]
```

**Pass Criteria**: All checks pass. If any fail, report the issues back to the main Claude for immediate fixing, then re-verify.

---

## Output Format

After each stage, print a summary box:

```
┌─────────────────────────────────────────────────────────────┐
│ CLAUDE-SYSTEM-CHANGE — [STAGE_NAME]                         │
├─────────────────────────────────────────────────────────────┤
│ [Key info for this stage]                                   │
│                                                             │
│ [Status summary]                                            │
│                                                             │
│ Advancing to [NEXT_STAGE]...                                │
└─────────────────────────────────────────────────────────────┘
```

### Pipeline Complete

```
┌─────────────────────────────────────────────────────────────┐
│ CLAUDE-SYSTEM-CHANGE COMPLETE                               │
│                                                             │
│  INTAKE → BRAINSTORM → PLAN → IMPLEMENT → VERIFY           │
│    ✓          ✓          ✓        ✓          ✓              │
│                                                             │
│ Changes: [N] total                                          │
│ Applied directly: [N]                                       │
│ New components created: [N]                                  │
│ Integration updates: [N]                                    │
│ Verification: [PASS / FAIL]                                 │
│ Follow-up: [list or "none"]                                 │
└─────────────────────────────────────────────────────────────┘
```

---

## Common Pitfalls

- **Using this when /reggie-evaluation-system is more appropriate**: If the user does not have a specific change in mind and wants to discover issues, they should use /reggie-evaluation-system instead. This pipeline assumes the change request is already known.
- **Creating new components without reading similar files first**: Always read 2-3 similar existing files before creating a new agent, command, or pipeline manager. This ensures consistent structure, naming, and conventions.
- **Skipping validation checks on new components**: When the plan includes `new-component` changes, always run the validation checks (naming, tools, sections, descriptions) before presenting the plan to the user. Skipping validation leads to inconsistent files.
- **Skipping BRAINSTORM for non-obvious changes**: If there are genuine design questions, rushing through brainstorm leads to plan revisions and wasted implementation effort. Let the reggie-thought-partner explore when the direction is not clear.
- **Over-brainstorming obvious changes**: If the conversation has already resolved the design, a 2-sentence brainstorm confirmation is fine. Do not force exploration where none is needed.
- **Modifying YAML frontmatter without per-change approval**: Tool permissions, model, memory type, and name changes in frontmatter can have cascading effects. Always get explicit approval for each frontmatter modification.
- **Forgetting integration updates**: After modifying agents or commands, PORTABLE-PACKAGE.md, reggie-guide.md, and MEMORY.md often need corresponding updates. The PLAN stage must identify these, and VERIFY must catch any that were missed.
- **Not reading files before editing**: Always read the current state of a file before applying edits. Files may have been modified by other processes since the PLAN was created.
- **Changing agent names without grepping for references**: An agent name appears in pipeline managers, commands, reggie-guide.md, PORTABLE-PACKAGE.md, and potentially other agents' descriptions. Always trace all references before renaming.
- **Count drift in PORTABLE-PACKAGE.md and MEMORY.md**: After any changes that add or remove files, counts must be updated in multiple places. VERIFY catches this, but PLAN should identify it upfront.
- **Creating skills instead of agents**: Skills are deprecated. Language/framework patterns belong in developer agents with always-loaded context. Reject any request to create a skill.
- **Missing spec/schema sections when editing examples or templates**: Doc files often contain both a worked example and a separate normative "format spec", "schema", or "structure" section that mirrors the same artifact. When PLAN identifies lines to modify in an example or template, grep the same file for parallel spec sections and add those line ranges to Verified Facts and Affected Areas. Both must move together. If the spec section is missed, it silently drifts from the example and becomes a maintenance hazard.

---

## File Templates

### Agent Template
```yaml
---
name: [agent-name]
description: "When to use description with examples. Examples: (1) 'trigger phrase 1' triggers this agent to [action]. (2) 'trigger phrase 2' triggers this agent to [action]."
tools: Glob, Grep, Read, [other tools as needed]
model: opus
memory: project
---

## Role

[One paragraph describing the agent's expertise and focus]

## Core Responsibilities

1. [Responsibility 1]
2. [Responsibility 2]
...

## Process

### Step 0: Consult Memory
Review agent memory for project-specific context.

[... numbered steps ...]

### Final: Update Memory
Record significant learnings.

## Quality Standards

- [Standard 1]
- [Standard 2]
...

## Output Format

[Describe expected output structure]

## Common Pitfalls

- [Pitfall 1]
- [Pitfall 2]
...
```

### Command Template
```markdown
# [Command Name]

[Brief description of what this command does]

## Context

\`\`\`bash
# Commands to gather context at invocation time
\`\`\`

## Instructions

[Detailed instructions for what to do when the command is invoked]

### Arguments

\`\`\`
/command-name                    # Default behavior
/command-name arg1               # With argument
$ARGUMENTS
\`\`\`

[Rest of instructions...]
```

### Pipeline Manager Template
```yaml
---
name: [pipeline]-manager
description: "Pipeline manager for [purpose]. This is a REFERENCE DOCUMENT for the main Claude orchestrator — do NOT launch this as a subagent..."
tools: Glob, Grep, Read, Edit, Write
model: opus
memory: user
---

## Role

[Description of what this pipeline manages]

## Pipeline Overview

\`\`\`
STAGE1 → STAGE2 → STAGE3 → ...
\`\`\`

## Stage Details

### Stage 1: [STAGE_NAME]

**Agent**: [agent-name]

**Purpose**: [What this stage accomplishes]

**Prompt Template**:
\`\`\`
[Template for launching the agent]
\`\`\`

**Pass Criteria**: [What constitutes success]

[Repeat for each stage...]

## Output Format

[Stage summary box format]
```
