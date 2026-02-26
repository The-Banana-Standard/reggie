---
name: improve-pipeline-manager
description: "Pipeline manager for the two-level agent improvement loop. Orchestrates COLLECT, CLASSIFY, ANALYZE, PROPOSE, APPLY, VERIFY, and CURATE stages. Routes learnings to system agents (universal), project agent memory (project-specific), or commands (process). Supports fork suggestions when project needs diverge. This is a REFERENCE DOCUMENT for the main Claude orchestrator — do NOT launch this as a subagent. Read this file for guidance, then run each stage yourself."
tools: Glob, Grep, Read, Edit, Write
model: opus
memory: user
---

## Role

This document guides the main Claude orchestrator through the two-level improve pipeline. It processes accumulated learnings from `~/.claude/AGENT-IMPROVE.md`, classifies them by scope (universal vs project vs process), proposes specific edits, applies changes to the appropriate targets (system agents, project agent memory, or commands), verifies modifications, and curates agent memory to prevent bloat.

**IMPORTANT**: This is a reference document, not a subagent. The main Claude reads this for guidance and executes each stage directly.

---

## Pipeline Overview

```
COLLECT → CLASSIFY → ANALYZE → PROPOSE → APPLY → VERIFY → CURATE
```

No numeric quality gates — this pipeline uses confirmation-based gates. The user confirms proposed changes before major modifications are applied.

### Two-Level Architecture

Learnings route to different targets based on classification:

| Classification | Target | Location | Persistence |
|---------------|--------|----------|-------------|
| UNIVERSAL | System agent files | `~/.claude/agents/*.md` | Global, all projects |
| PROJECT | Project agent memory | `.claude/agent-memory/<agent>/MEMORY.md` | Per-project |
| PROCESS | Command files | `~/.claude/commands/*.md` | Global, all projects |
| FORK-CANDIDATE | Suggest project agent fork | `.claude/agents/<agent>.md` | Per-project |

## Stage Reference

| Stage | Purpose | Executor | Gate |
|-------|---------|----------|------|
| COLLECT | Parse AGENT-IMPROVE.md, group by target | Main Claude | Entries exist |
| CLASSIFY | Tag each learning UNIVERSAL/PROJECT/PROCESS/FORK | Main Claude | All entries classified |
| ANALYZE | Filter, dedupe, categorize, prioritize | researcher agent | Actionable items identified |
| PROPOSE | Generate specific diffs with rationale | Main Claude | User reviews proposals |
| APPLY | Route changes to correct targets | Main Claude | Changes applied |
| VERIFY | Validate modified files | Main Claude | All files valid |
| CURATE | Prune stale agent memory entries | Main Claude | Memory files under limits |

---

## Stage Details

### Stage 1: COLLECT

**Executor**: Main Claude (no subagent)

**Purpose**: Parse the accumulated learnings and group them by target file.

**Process**:
1. Read `~/.claude/AGENT-IMPROVE.md`
2. Parse all entries (delimited by `## Entry:` headers), validate format
3. Skip malformed entries with a warning
4. Group entries by target agent/command file
5. Count: total entries, entries per target, minor vs major
6. If zero valid entries: print "No improvements to process" and exit
7. If entries exist: print summary table and advance

**Output**:
```
+------------------------------------------------------------------+
| IMPROVE PIPELINE -- COLLECT                                       |
+------------------------------------------------------------------+
| Learnings found: [N]                                              |
| Targets: [N] agents/commands                                      |
| Minor (auto-apply): [N]                                           |
| Major (needs approval): [N]                                       |
|                                                                   |
| Breakdown:                                                        |
|   ios-developer: 3 entries (2 minor, 1 major)                     |
|   code-architect: 1 entry (1 major)                               |
|   researcher: 2 entries (2 minor)                                 |
|                                                                   |
| Advancing to CLASSIFY...                                          |
+------------------------------------------------------------------+
```

---

### Stage 2: CLASSIFY

**Executor**: Main Claude (no subagent)

**Purpose**: Tag each learning with its destination scope.

**Classification Rules**:

**UNIVERSAL** -- Learning applies to any project using this agent:
- General best practices the agent should always follow
- Tool usage patterns that are language/framework-level (not project-specific)
- Common pitfalls that would occur in any project
- Quality standards that are universally applicable
- Examples: "Always check for nil map before writing in Go", "SwiftUI @MainActor annotation for ObservableObject"

**PROJECT** -- Learning is specific to the current project:
- Project-specific conventions (naming, folder structure, architecture patterns)
- Dependencies and versions unique to this project
- Business logic quirks or domain-specific knowledge
- Integration patterns specific to this project's tech stack combination
- Examples: "This project uses Zustand not Redux", "API responses always wrapped in {data: ...} envelope"

**PROCESS** -- Learning suggests a command or pipeline workflow change:
- Missing steps in a pipeline stage
- Better ordering of operations
- New validation checks needed
- Workflow gaps that caused quality failures
- Examples: "PLAN stage should check for database migrations", "REVIEW should run linter before code-reviewer"

**FORK-CANDIDATE** -- Project needs fundamentally different agent behavior:
- When project memory has 5+ entries that contradict the system agent's instructions
- When an agent's core process doesn't fit the project's workflow
- When the agent's quality standards conflict with project requirements
- This is rare -- most customization is handled by PROJECT memory
- Examples: "This project needs web-developer to use Svelte patterns instead of React patterns"

**Process**:
1. For each collected entry, apply classification rules above
2. Check if a `Classification` field already exists on the entry -- respect it if present
3. For ambiguous cases, default to PROJECT (safer scope)
4. Flag any FORK-CANDIDATE entries for special attention in ANALYZE

**Output**:
```
+------------------------------------------------------------------+
| IMPROVE PIPELINE -- CLASSIFY                                      |
+------------------------------------------------------------------+
| UNIVERSAL: [N] entries -> system agents                           |
| PROJECT:   [N] entries -> agent memory                            |
| PROCESS:   [N] entries -> command files                           |
| FORK-CANDIDATE: [N] entries -> needs evaluation                   |
|                                                                   |
| Advancing to ANALYZE...                                           |
+------------------------------------------------------------------+
```

---

### Stage 3: ANALYZE

**Executor**: Launch **researcher** agent via Task tool

**Purpose**: Filter noise, deduplicate, categorize severity, prioritize, and evaluate fork candidates.

**Prompt Template**:
```
Analyze these agent improvement entries for actionability and quality.

[Include classified entries from CLASSIFY]

For each entry, determine:
1. Is it actionable? (specific enough to generate a file edit or memory entry)
2. Is it already covered in the target agent file or agent memory? (read the file and check)
3. Does it contradict any existing content or other entries?
4. Is the severity classification (minor/major) correct?
5. Is the scope classification (UNIVERSAL/PROJECT/PROCESS/FORK) correct?
6. How impactful is this? (would it have prevented a quality gate failure?)

Severity guidelines:
- MINOR (auto-apply eligible): Adding to Common Pitfalls, adding an additive Quality Standard, adding an example, fixing a typo, adding a project memory entry
- MAJOR (requires approval): Modifying Process steps, changing Role description, changing Core Responsibilities, changing Output Format, adding/removing Tools, removing/rewriting existing content, command workflow changes

For FORK-CANDIDATE entries specifically:
- Read the system agent file AND the project agent memory
- Count how many memory entries contradict or override system agent instructions
- Assess: is the divergence fundamental (different framework, different paradigm) or superficial (different convention)?
- Recommend: FORK (create project agent) or KEEP-MEMORY (project memory is sufficient)

Additionally, look across ALL entries for **system gaps** -- patterns that suggest a missing agent, command, or pipeline:
- Are multiple entries about the same type of problem that no specialist agent handles?
- Are entries describing workarounds agents use because a needed tool/agent doesn't exist?
- Do entries reveal a recurring workflow that users keep assembling manually?

If you identify a gap, add it as a separate "New Component" proposal.

Output a prioritized list with rationale for each keep/filter decision, fork evaluation results, and any gap proposals.
```

**Pass Criteria**: At least one actionable entry or gap proposal identified. If all entries are filtered and no gaps found, report why and exit.

---

### Stage 4: PROPOSE

**Executor**: Main Claude (no subagent)

**Purpose**: Generate specific edits with rationale for each actionable entry, routed to the correct target.

**Process**:
1. For each actionable UNIVERSAL entry (in priority order):
   - Read the target system agent file (`~/.claude/agents/<agent>.md`)
   - Find the exact insertion/modification point
   - Generate a diff showing target file, section, old/new text, rationale
2. For each actionable PROJECT entry:
   - Read existing agent memory (`.claude/agent-memory/<agent>/MEMORY.md`) if it exists
   - Generate a memory entry to append (not a file diff -- just the text)
   - If memory file doesn't exist, note it will be created
3. For each actionable PROCESS entry:
   - Read the target command file (`~/.claude/commands/<command>.md`)
   - Find the exact insertion/modification point
   - Generate a diff showing target file, section, old/new text, rationale
4. For each FORK-CANDIDATE that the researcher recommended forking:
   - Present the full fork proposal (see Fork Proposals below)
5. Group all minor changes into a single batch per classification
6. Present major changes individually
7. Cap file edits at **15 changes per run** (safety guardrail) -- memory entries don't count against this cap

**Fork Proposals**:
When a fork is recommended, present:
```
FORK PROPOSAL: [agent-name]

Current system agent: ~/.claude/agents/[agent-name].md
Proposed project agent: .claude/agents/[agent-name].md

Why fork?
- [N] memory entries contradict system agent instructions
- Core divergence: [description of fundamental difference]

What changes in the fork:
- [Specific modifications to Process/Role/Standards]

Trade-offs:
- PRO: Agent behavior fully customized for this project
- PRO: No memory overhead -- instructions are direct
- CON: Misses future system agent improvements (must manually sync)
- CON: Another file to maintain in the project

Alternative: Keep using project memory (current approach)
- Memory currently handles [N] overrides
- This works but adds [N]ms context per invocation

Recommend: FORK / KEEP-MEMORY
Create fork? (y/n)
```

**Output**:
```
+------------------------------------------------------------------+
| IMPROVE PIPELINE -- PROPOSE                                       |
+------------------------------------------------------------------+
| UNIVERSAL CHANGES (system agents):                                |
|                                                                   |
| [Minor batch + Major changes for ~/.claude/agents/ files]         |
|                                                                   |
| PROJECT CHANGES (agent memory):                                   |
|                                                                   |
| [Memory entries to append to .claude/agent-memory/ files]         |
|                                                                   |
| PROCESS CHANGES (commands):                                       |
|                                                                   |
| [Diffs for ~/.claude/commands/ files]                             |
|                                                                   |
| FORK PROPOSALS:                                                   |
|                                                                   |
| [Any fork proposals with full trade-off analysis]                 |
|                                                                   |
| NEW COMPONENT PROPOSALS:                                          |
|                                                                   |
| [Any gap proposals]                                               |
+------------------------------------------------------------------+
```

---

### Stage 5: APPLY

**Executor**: Main Claude (no subagent)

**Purpose**: Apply the proposed changes to their appropriate targets.

**Process**:

**Step 1: Log all proposed changes** to `~/.claude/IMPROVE-CHANGELOG.md` before any modification.

**Step 2: Apply UNIVERSAL changes** (system agent files):
1. Auto-apply all minor changes in the batch (append to Common Pitfalls, add Quality Standards)
2. For each major change:
   - Present the change with context
   - Wait for user response: `y` (approve), `n` (skip), `edit` (modify the proposed text)
   - If `edit`: user provides adjusted text, apply that instead
3. Use Edit tool for all modifications

**Step 3: Apply PROJECT changes** (agent memory):
1. For each project memory entry:
   - Check if `.claude/agent-memory/<agent>/` directory exists; create if not
   - Check if `MEMORY.md` exists; create with `# [Agent Name] Memory` header if not
   - Append the new learning entry under appropriate section
   - Memory entries are always auto-applied (they don't modify agent behavior directly)
2. Format each memory entry as:
   ```markdown
   ## [Topic/Category]
   - [Learning] (from [pipeline]/[task], [date])
   ```

**Step 4: Apply PROCESS changes** (command files):
1. These always require approval (commands affect all pipelines)
2. Present each change with full context
3. Wait for user approval before applying
4. Use Edit tool for modifications

**Step 5: Handle fork proposals**:
1. If user approves a fork:
   - Copy the system agent file to `.claude/agents/<agent>.md`
   - Apply the proposed modifications to the project copy
   - Migrate relevant project memory entries into the forked agent's instructions
   - Log the fork in IMPROVE-CHANGELOG.md
2. If user declines: log as skipped

**Step 6: Handle new component proposals**:
1. Present the proposal with evidence
2. If user approves: suggest running `/reggie-system-change` to create the new component -- do NOT create it inline
3. If user declines: log as skipped

**Step 7: Clear processed entries** from `~/.claude/AGENT-IMPROVE.md`
- Keep skipped entries for future runs

**Changelog entry format**:
```markdown
## Run: [ISO datetime]

### Universal Changes (System Agents)

1. **[agent-name].md** -- [Section] (minor, auto-applied)
   - Added: "[text added]"
   - Source: [pipeline] / [task] / [stage]

### Project Changes (Agent Memory)

2. **[agent-name]** -- [Topic] (auto-applied to memory)
   - Added: "[memory entry]"
   - Source: [pipeline] / [task] / [stage]

### Process Changes (Commands)

3. **[command-name].md** -- [Section] (major, user-approved)
   - Modified: [description of change]
   - Source: [pipeline] / [task] / [stage]

### Fork Actions

4. **[agent-name]** -- FORKED to .claude/agents/ (user-approved)
   - Reason: [why forked]
   - Migrated [N] memory entries into fork

### Skipped

5. **[agent-name].md** -- [Section] (minor, filtered: duplicate)
   - Proposed: [text]
   - Reason: [why skipped]

---
```

---

### Stage 6: VERIFY

**Executor**: Main Claude (no subagent)

**Purpose**: Validate all modified files still parse correctly and have required sections.

**Process**:
1. For each modified system agent file:
   - Read the file
   - Check YAML frontmatter parses (first `---` to second `---`)
   - Check all required sections present: Role/intro, Core Responsibilities, Process, Quality Standards, Output Format, Common Pitfalls
   - Check no broken references (agent names that don't exist)
2. For each modified command file:
   - Read the file
   - Check structure is intact (## Context, ## Instructions sections)
3. For each new/modified agent memory file:
   - Read the file
   - Check it has a header
   - Check line count is under 200 (flag if approaching limit)
4. For each forked agent:
   - Verify project agent loads correctly (valid frontmatter)
   - Verify it doesn't duplicate the system agent (should have meaningful differences)
5. If any file fails validation:
   - Show what's wrong
   - Offer to revert (read the old text from IMPROVE-CHANGELOG.md)
6. Print final summary

**Output**:
```
+------------------------------------------------------------------+
| IMPROVE PIPELINE -- VERIFY                                        |
+------------------------------------------------------------------+
| Universal changes: [N] minor (auto), [N] major (approved)         |
| Project memory entries: [N] added                                 |
| Process changes: [N] applied                                      |
| Forks created: [N]                                                |
| Changes skipped: [N] (user declined or filtered)                  |
|                                                                   |
| Files modified:                                                   |
|   ~/.claude/agents/ios-developer.md (2 additions)                 |
|   .claude/agent-memory/ios-developer/MEMORY.md (1 entry added)    |
|   ~/.claude/commands/code-workflow.md (1 modification)            |
|                                                                   |
| All files validated successfully                                  |
|                                                                   |
| Entries processed: [N] of [N] cleared from AGENT-IMPROVE.md       |
| Remaining: [N] entries (skipped/deferred)                         |
|                                                                   |
| Advancing to CURATE...                                            |
+------------------------------------------------------------------+
```

---

### Stage 7: CURATE

**Executor**: Main Claude (no subagent)

**Purpose**: Maintain agent memory health across all projects and the system.

**Process**:
1. Scan all agent memory files in the current project (`.claude/agent-memory/*/MEMORY.md`)
2. For each memory file:
   - Count lines -- flag if over 150 (warning) or 200 (action needed)
   - Check for stale entries (references to files/patterns that no longer exist in the project)
   - Check for duplicate or near-duplicate entries
   - Check for contradictory entries
3. If any file needs curation:
   - **Consolidate**: Merge duplicate entries into a single, clearer entry
   - **Prune**: Remove entries about patterns/files confirmed deleted from the project
   - **Summarize**: If approaching 200 lines, compress verbose entries into concise bullets
   - Present all proposed curation changes for user approval
4. Check system agent memory files (`~/.claude/agent-memory/*/MEMORY.md`) with same process
5. Print curation summary

**Output**:
```
+------------------------------------------------------------------+
| IMPROVE PIPELINE -- CURATE                                        |
+------------------------------------------------------------------+
| Project memory files scanned: [N]                                 |
| System memory files scanned: [N]                                  |
|                                                                   |
| Curation actions:                                                 |
|   ios-developer: consolidated 3 entries -> 1 (duplicates)         |
|   web-developer: pruned 2 entries (referenced deleted files)      |
|   code-architect: no action needed (47 lines, healthy)            |
|                                                                   |
| Memory health:                                                    |
|   All files under 200-line limit                                  |
|   No contradictions detected                                      |
+------------------------------------------------------------------+
```

---

## AGENT-IMPROVE.md Entry Format

Each entry follows this structure:

```markdown
## Entry: [pipeline]-[task-slug]-[N]
- **Date**: [ISO date]
- **Pipeline**: [pipeline name]
- **Task**: [task slug]
- **Stage**: [which stage]
- **Agent**: [which agent the learning is about]
- **Severity**: [minor or major]
- **Classification**: [UNIVERSAL / PROJECT / PROCESS]
- **Target Section**: [Common Pitfalls / Quality Standards / Process / Role / Core Responsibilities / Output Format / New Component / Memory / Command]
- **Learning**: [specific, actionable description of what should change]
```

### Classification Guidelines (for CAPTURE-LEARNINGS)

When capturing learnings at the end of a pipeline, classify them at the source:

- **UNIVERSAL**: "Any project using this agent would benefit from this"
- **PROJECT**: "This is specific to how this project works"
- **PROCESS**: "The pipeline/command workflow should change"

If unsure, default to PROJECT -- it's the safest scope and can be promoted to UNIVERSAL later.

### Severity Classification

**Minor** (auto-apply eligible):
- Adding a new item to Common Pitfalls
- Adding an additive Quality Standard (new bullet, does not modify existing)
- Adding an example to an existing list
- Fixing a typo or clarifying ambiguous wording
- Adding a project memory entry (always minor)

**Major** (requires approval):
- Modifying the Process section (steps, ordering)
- Changing the Role description
- Modifying Core Responsibilities
- Changing the Output Format
- Adding or removing Tools from frontmatter
- Removing or rewriting existing content
- Changing the description or examples in frontmatter
- Proposing a new agent, command, or pipeline (Target Section: "New Component")
- Any command file modification

---

## Safety Guardrails

| # | Guardrail | Rationale |
|---|-----------|-----------|
| 1 | Maximum 15 system agent/command changes per `/improve` run | Prevents runaway modifications; keeps review manageable |
| 2 | Never auto-modify YAML frontmatter (name, tools, model, description) | These are structural -- wrong tools break agents, wrong names break references |
| 3 | Never auto-delete existing content | Deletions can remove important context; only humans should remove |
| 4 | Only auto-apply additions to Common Pitfalls and Quality Standards | These sections are additive by nature; modifications to Process/Role/Output change behavior |
| 5 | All changes logged to IMPROVE-CHANGELOG.md before file modification | Creates an audit trail and enables rollback |
| 6 | Same-file threshold: 3+ changes to one file in one run triggers manual review | Protects against over-modifying a single agent |
| 7 | Recent-modification flag: files modified by improve within 24 hours get flagged | Prevents rapid successive modifications that compound |
| 8 | Dry-run mode (`--dry-run`) available | Lets user preview without risk |
| 9 | Skipped entries stay in AGENT-IMPROVE.md | Nothing is lost -- user-declined changes persist for future consideration |
| 10 | VERIFY stage checks structural validity after every run | Catches broken frontmatter, missing sections, invalid references |
| 11 | Scope containment: only touches `~/.claude/agents/`, `~/.claude/commands/`, and `.claude/agent-memory/` | Improve only modifies the agent system and memory, nothing else |
| 12 | Researcher filters duplicates and contradictions before proposing | Prevents applying a learning that conflicts with existing content |
| 13 | No learnings are invented | CAPTURE-LEARNINGS explicitly says: if the pipeline ran cleanly, capture nothing |
| 14 | User can abort at any time during APPLY | Full control over what gets modified |
| 15 | Revert capability | IMPROVE-CHANGELOG.md records exact changes, enabling manual revert |
| 16 | Project memory entries are auto-applied but never modify agent instructions | Memory is context, not commands -- low risk, high value |
| 17 | Fork proposals always require explicit user approval with full trade-off analysis | Forking has maintenance costs -- user must understand before committing |
| 18 | CURATE never deletes memory without user approval | Even stale entries might have value the system doesn't recognize |
| 19 | Agent memory files capped at 200 lines | Keeps auto-loaded context manageable; forces curation over accumulation |
| 20 | Command file changes always require approval (never auto-apply) | Commands affect all pipelines globally |

---

## Common Pitfalls

- Applying a learning that contradicts existing content without checking
- Auto-applying a change that looks minor but actually changes behavior (e.g., adding a "pitfall" that implies a different process)
- Processing the same learning twice if AGENT-IMPROVE.md was not properly cleared
- Modifying a file that is currently being read by another pipeline session
- Making changes so generic they add noise rather than signal (e.g., "be thorough")
- Forgetting to log to IMPROVE-CHANGELOG.md before modifying a file
- Classifying a project-specific learning as UNIVERSAL (pollutes system agents with project noise)
- Suggesting a fork when project memory would suffice (forks have maintenance cost)
- Letting agent memory grow unchecked past 200 lines (degrades context quality)
- Applying PROCESS changes without considering downstream effects on other commands
