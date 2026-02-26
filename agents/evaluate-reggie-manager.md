---
name: evaluate-reggie-manager
description: "Pipeline manager for periodic evaluation of the ~/.claude/ agent system architecture. Orchestrates SCAN, EVALUATE, BRAINSTORM, PROPOSE, and optional IMPLEMENT stages to inventory the system, identify improvements, discuss with the user, and produce actionable proposals. This is a REFERENCE DOCUMENT for the main Claude orchestrator — do NOT launch this as a subagent. Read this file for guidance, then run each stage yourself. Examples: (1) '/evaluate-reggie' triggers a full architectural review of the agent system. (2) 'I feel like some of my agents overlap — can you evaluate the whole system?' triggers system-wide redundancy analysis. (3) '/evaluate-reggie --implement' triggers evaluation with direct implementation of approved proposals."
tools: Glob, Grep, Read, Edit, Write
model: opus
memory: user
---

## Role

This document guides the main Claude orchestrator through the evaluate-reggie pipeline. It performs a periodic architectural review of the `~/.claude/` agent system — inventorying all components, analyzing for structural issues, discussing findings with the user, and producing concrete improvement proposals.

**IMPORTANT**: This is a reference document, not a subagent. The main Claude reads this for guidance and executes each stage directly.

**This is NOT /improve.** The improve pipeline processes accumulated per-agent learnings from pipeline runs (AGENT-IMPROVE.md entries). This pipeline steps back and evaluates the entire system architecture: missing agents, redundant commands, outdated patterns, mismatched permissions, broken integrations, structural drift.

---

## Pipeline Overview

```
SCAN → EVALUATE → BRAINSTORM → PROPOSE → [IMPLEMENT → VERIFY]
                                           optional (--implement)
```

No numeric quality gates. This pipeline uses confirmation-based gates. The user is the arbiter at every stage.

### Modes

| Mode | Stages | When |
|------|--------|------|
| Default | SCAN → EVALUATE → BRAINSTORM → PROPOSE | Standard evaluation |
| `--scan-only` | SCAN | Just produce the inventory |
| `--implement` | SCAN → EVALUATE → BRAINSTORM → PROPOSE → IMPLEMENT → VERIFY | Evaluate, execute, verify |

---

## Stage Reference

| Stage | Purpose | Executor | Gate |
|-------|---------|----------|------|
| SCAN | Full inventory of ~/.claude/ system | researcher agent | Inventory complete |
| EVALUATE | Architectural analysis of inventory | claude-architect agent | Analysis complete |
| BRAINSTORM | Discuss findings with user, prioritize | thought-partner agent | User satisfied |
| PROPOSE | Concrete, prioritized proposals with rationale | claude-architect agent | User reviews |
| IMPLEMENT | Hand off approved proposals to existing pipelines | Main Claude | Optional |
| VERIFY | Validate all changes are consistent and correct | researcher agent | Optional (after IMPLEMENT) |

---

## Stage Details

### Stage 1: SCAN

**Executor**: Launch **researcher** agent via Task tool

**Purpose**: Produce a structured inventory of the entire `~/.claude/` system. This is a factual accounting, not analysis.

**Prompt Template**:
```
Scan the entire ~/.claude/ system and produce a structured inventory.

AGENTS — for each agent in ~/.claude/agents/:
1. Read the file
2. Record: name, category (Developers/Quality/Research/Design/Content/Pipeline Managers/Utilities), tools list, model, memory type, description (first sentence only)
3. Count sections present vs required (Role, Core Responsibilities, Process, Quality Standards, Output Format, Common Pitfalls)
4. Note if "Step 0: Consult Memory" and "Final: Update Memory" are present in Process
5. Count approximate line length

COMMANDS — for each command in ~/.claude/commands/:
1. Read the file
2. Record: name, type (workflow/stage/utility), whether it has Context/Instructions/Arguments sections, which agents it references
3. Classify: workflow command, pipeline stage, utility

CROSS-REFERENCES:
1. Which agents are referenced by commands but don't exist?
2. Which agents exist but are never referenced by any command or pipeline manager?
3. Which pipeline managers have a corresponding command? Which don't?
4. Do all pipeline manager descriptions include the REFERENCE DOCUMENT warning?

SYSTEM FILES:
1. Check for: PORTABLE-PACKAGE.md, AGENT-IMPROVE.md, IMPROVE-CHANGELOG.md
2. Record agent and command counts in PORTABLE-PACKAGE.md vs actual file counts
3. Check if reggie-guide.md lists all commands

Output in this exact format:

## System Inventory

### Summary
- Agents: [N] ([N] developers, [N] quality, [N] research, [N] design, [N] content, [N] pipeline managers, [N] utilities)
- Commands: [N] ([N] workflows, [N] pipeline stages, [N] utilities)
- Pipeline managers with matching commands: [N]/[N]

### Agent Inventory
| Agent | Category | Tools | Memory | Lines | Sections OK |
|-------|----------|-------|--------|-------|-------------|
[one row per agent]

### Command Inventory
| Command | Type | Context | Instructions | Agents Referenced |
|---------|------|---------|-------------|-------------------|
[one row per command]

### Cross-Reference Issues
[list any orphaned agents, missing references, count mismatches]

### System File Status
[PORTABLE-PACKAGE.md accuracy, AGENT-IMPROVE.md entry count, etc.]
```

**Pass Criteria**: Inventory is complete (every file in both directories is accounted for). If the researcher misses files, re-scan.

---

### Stage 2: EVALUATE

**Executor**: Launch **claude-architect** agent via Task tool

**Purpose**: Analyze the inventory for architectural issues, gaps, redundancies, and drift from established conventions.

**Prompt Template**:
```
Analyze this system inventory for architectural health. You are reviewing the ~/.claude/ agent system — not a software codebase.

[Include full inventory from SCAN]

Evaluate on these dimensions:

1. COVERAGE GAPS
   - Are there obvious agent roles missing for the tech stack (iOS/SwiftUI, Android/Capacitor, React/Next.js/TypeScript/Tailwind, Python/pandas/FastAPI, Go, Firebase/GCP, Docker, Vercel, GitHub)?
   - Are there pipeline stages that reference agents that could be stronger specialists?
   - Are there recurring manual tasks that should have a command?
   - Is there a reviewer for every domain that has a developer?

2. REDUNDANCIES
   - Do any agents have substantially overlapping responsibilities?
   - Do any commands do effectively the same thing?
   - Are there pipeline stages that could be consolidated?

3. CONSISTENCY
   - Do all agents follow the standard section structure?
   - Do all agents have memory configuration (Step 0/Final)?
   - Do all pipeline managers have the REFERENCE DOCUMENT warning?
   - Do all agent descriptions include 2-3 examples?
   - Are tool permissions appropriate for each agent's role?
   - Are naming conventions consistent? (role-based, kebab-case)

4. DRIFT & STALENESS
   - Do any agents reference patterns, tools, or conventions that seem outdated?
   - Do any pipeline managers reference stages or agents that don't exist?
   - Does PORTABLE-PACKAGE.md accurately reflect the current system?
   - Does reggie-guide.md accurately reflect all available commands?

5. INTEGRATION HEALTH
   - Are all pipeline managers referenced by exactly one command?
   - Do pipeline managers and their commands agree on stage names and flow?
   - Are there dead code paths (stages listed but never reachable)?

6. PERMISSION AUDIT
   - Any agents with more permissions than they need?
   - Any agents with fewer permissions than their role requires?
   - Any invalid tool combinations?

Output format:

## System Evaluation

### Health Summary
- Overall: [healthy / needs attention / significant issues]
- Gaps found: [N]
- Redundancies: [N]
- Consistency issues: [N]
- Drift issues: [N]
- Integration issues: [N]
- Permission issues: [N]

### Findings (prioritized by impact)

#### Finding 1: [title]
- **Category**: [gap / redundancy / consistency / drift / integration / permission]
- **Severity**: [high / medium / low]
- **Description**: [what's wrong]
- **Evidence**: [specific files, line references, comparisons]
- **Suggested fix**: [brief direction]

[repeat for each finding]

### Strengths (what's working well)
[2-5 things the system does right]
```

**Pass Criteria**: At least one finding or an explicit "system is healthy, no issues found" with evidence.

---

### Stage 3: BRAINSTORM

**Executor**: Launch **thought-partner** agent via Task tool

**Purpose**: Discuss the evaluation findings with the user. Help them decide what resonates, what to prioritize, and what to leave alone. This is a CONVERSATION, not a presentation.

**Prompt Template**:
```
We just evaluated the ~/.claude/ agent system and found some things worth discussing. Here's the context:

[Include the EVALUATE output — Health Summary + all Findings + Strengths]

Your job is to help the user think through these findings. Some questions to explore:

- Which findings actually matter day-to-day? (Some architectural imperfections don't affect real workflows)
- Are there things NOT in the findings that they've been noticing?
- What's the energy around different improvements? (Excited to fix vs resigned vs "whatever")
- Are there any findings that seem right on paper but would be wrong to change? (System has history and reasons)

Start by reflecting back what seems most impactful, then ask one question to understand priorities. Keep it conversational — short responses, one question at a time.

Important: The user might add findings the evaluation missed, deprioritize things the evaluator flagged, or redirect entirely. Follow their lead. Your output should be a summary of what the user wants to prioritize.

When the user is satisfied with the direction, produce a final summary:

## Brainstorm Summary

### Prioritized for action (user confirmed)
1. [Finding/idea] — [why it matters to the user]

### Acknowledged but deferred
- [Finding] — [reason to defer]

### Rejected
- [Finding] — [reason to reject]

### New ideas raised
- [Anything the user brought up that wasn't in the evaluation]
```

**Pass Criteria**: User confirms the prioritized summary. This is a conversational gate, not a score.

---

### Stage 4: PROPOSE

**Executor**: Launch **claude-architect** agent via Task tool

**Purpose**: Produce concrete, actionable proposals for each prioritized item.

**Prompt Template**:
```
Create implementation proposals for these prioritized system improvements:

[Include Brainstorm Summary — prioritized items only]

[Include relevant parts of the SCAN inventory for reference]

For each prioritized item, produce a proposal:

## Proposal [N]: [title]

### Problem
[1-2 sentences describing the issue]

### Proposed Change
[Exactly what would change — which files, what modifications]

### Implementation Path
[How to implement: /reggie-system-change for new components, /improve for agent edits, direct edits for small fixes]

### Effort
[small (< 30 min) / medium (1-2 hours) / large (half day+)]

### Risk
[low (additive, no breaking changes) / medium (modifies existing behavior) / high (restructures core patterns)]

### Dependencies
[Other proposals this depends on or conflicts with]

---

Order proposals by: high-impact low-effort first.

Also produce an implementation plan if --implement is active:

## Implementation Plan

### Batch 1 (independent, can be done in parallel)
- Proposal [N]: [method] — [1 sentence]

### Batch 2 (depends on Batch 1)
- Proposal [N]: [method] — [1 sentence]
```

**Pass Criteria**: Proposals are concrete enough to execute. User reviews which to proceed with.

---

### Stage 5: IMPLEMENT (optional, --implement flag required)

**Executor**: Main Claude (no subagent)

**Purpose**: Execute approved proposals using existing system capabilities.

**Process**:

1. Present the full proposal list to the user for final approval:
   - Show each proposal with effort and risk
   - User marks: approve (y), skip (n), or modify

2. For each approved proposal, execute using the appropriate method:

   **New agent/command/workflow**:
   - Read 2-3 similar existing files to understand current patterns
   - Create the file using Write tool, following standard templates (see reggie-system-change-manager.md File Templates)
   - Validate: YAML frontmatter valid, all required sections present, description includes trigger examples
   - Log the change

   **Modify existing agent/command file** (small, targeted changes):
   - Read the file
   - Apply the proposed edit
   - Validate: YAML frontmatter parses, required sections present
   - Log the change

   **Update PORTABLE-PACKAGE.md or reggie-guide.md**:
   - Apply directly using Edit tool

3. After all approved proposals are handled:
   - Print summary of what was done
   - List any follow-up items
   - Suggest running /evaluate-reggie again after implementation to verify

**Safety Rules**:
- Never delete agent or command files — only modify or create
- Never modify YAML frontmatter without explicit user approval per change
- When creating new files, read 2-3 similar existing files first to match patterns
- Log all changes made during IMPLEMENT

---

### Stage 6: VERIFY (after IMPLEMENT)

**Executor**: Launch **researcher** agent via Task tool

**Purpose**: Validate that all implemented changes are internally consistent, no references are broken, and counts are accurate. This catches the kind of drift that happens when editing multiple interconnected files.

**Prompt Template**:
```
Verify the consistency of the ~/.claude/ system after recent changes.

Changes made:
[Include summary of all changes from IMPLEMENT stage]

Check the following:

1. FILE COUNTS
   - Count actual .md files in ~/.claude/agents/ and ~/.claude/commands/
   - Compare against counts stated in PORTABLE-PACKAGE.md
   - Compare against counts in MEMORY.md (if referenced)

2. CROSS-REFERENCES
   - Every agent referenced in a command file exists in ~/.claude/agents/
   - Every command listed in reggie-guide.md exists in ~/.claude/commands/
   - Every pipeline manager listed in PORTABLE-PACKAGE.md exists
   - No dangling references to deleted/renamed files

3. INTERNAL CONSISTENCY
   - Pipeline manager stage lists match their corresponding command files
   - Agent tool lists in PORTABLE-PACKAGE.md match actual agent frontmatter
   - reggie-guide.md "Which Command" table includes all current commands
   - reggie-guide.md quick reference lists all current commands

4. FORMAT VALIDATION
   - All modified agent files have valid YAML frontmatter (name, description, tools, model, memory)
   - All modified command files have ## Context and ## Instructions sections
   - No orphaned sections or broken markdown

Output format:

## Verification Results

### Status: [PASS / FAIL]

### Checks
| Check | Result | Details |
|-------|--------|---------|
[one row per check]

### Issues Found (if any)
- [issue]: [what's wrong and how to fix it]
```

**Pass Criteria**: All checks pass. If any fail, report the issues back to the main Claude for immediate fixing, then re-verify.

---

## Output Format

After each stage, print a summary box:

```
┌─────────────────────────────────────────────────────────────┐
│ EVALUATE-CLAUDE — [STAGE_NAME]                              │
├─────────────────────────────────────────────────────────────┤
│ [Key metrics for this stage]                                │
│                                                             │
│ [Status summary]                                            │
│                                                             │
│ Advancing to [NEXT_STAGE]...                                │
└─────────────────────────────────────────────────────────────┘
```

### Pipeline Complete (default mode)

```
┌─────────────────────────────────────────────────────────────┐
│ EVALUATE-CLAUDE COMPLETE                                    │
│                                                             │
│  SCAN → EVALUATE → BRAINSTORM → PROPOSE                    │
│   ✓        ✓          ✓           ✓                         │
│                                                             │
│ System health: [healthy / needs attention / significant]    │
│ Findings: [N] total, [N] prioritized, [N] deferred         │
│ Proposals: [N] produced                                     │
│                                                             │
│ To implement: /evaluate-reggie --implement                  │
└─────────────────────────────────────────────────────────────┘
```

### Pipeline Complete (with --implement)

```
┌─────────────────────────────────────────────────────────────┐
│ EVALUATE-CLAUDE COMPLETE (with implementation)              │
│                                                             │
│  SCAN → EVALUATE → BRAINSTORM → PROPOSE → IMPLEMENT → VERIFY│
│   ✓        ✓          ✓           ✓          ✓         ✓    │
│                                                             │
│ Proposals: [N] produced, [N] approved                       │
│ Applied directly: [N]                                       │
│ New components created: [N]                                  │
│ Verification: [PASS / FAIL — N issues found]                │
│ Follow-up: [list or "none"]                                 │
└─────────────────────────────────────────────────────────────┘
```

---

## Common Pitfalls

- **Proposing changes that break existing pipelines**: Always check if a modified agent is referenced by pipeline managers before changing its tools, name, or role. Route through cross-reference data from SCAN.
- **Over-evaluating**: Not every inconsistency needs fixing. Some agents evolved organically for good reasons. BRAINSTORM exists to filter signal from noise with the user.
- **Creating agents without reading similar files first**: Always read 2-3 similar existing files before creating a new agent, command, or pipeline manager. This ensures consistent structure, naming, and conventions.
- **Ignoring the user's priorities**: The evaluation might flag 15 issues but the user might care about 3. BRAINSTORM is where user priorities override evaluator priorities.
- **Confusing this with /improve**: If the issue is about a specific agent needing a new Common Pitfall or Quality Standard, that belongs in AGENT-IMPROVE.md, not here. This pipeline is for architectural/structural issues.
- **Changing tool permissions without understanding why**: Some agents have permissions that seem wrong but exist for a specific reason. Always check the agent's full Process section before proposing permission changes.
- **Count drift in PORTABLE-PACKAGE.md**: After any changes, counts must be updated. Easy to forget.
- **Evaluating while other pipelines are running**: SCAN might read files being modified by other sessions. Warn the user to pause other sessions first.
