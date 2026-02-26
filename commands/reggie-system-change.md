# Reggie System Change

Formalize changes to the ~/.claude/ agent system from conversation or known requirements.

## Context

```bash
echo "=== System Agent Count ==="
AGENT_COUNT=$(ls ~/.claude/agents/ 2>/dev/null | wc -l | tr -d ' ')
echo "$AGENT_COUNT agents in ~/.claude/agents/"

echo ""
echo "=== System Command Count ==="
CMD_COUNT=$(ls ~/.claude/commands/ 2>/dev/null | wc -l | tr -d ' ')
echo "$CMD_COUNT commands in ~/.claude/commands/"

echo ""
echo "=== Pipeline Managers ==="
ls ~/.claude/agents/ | grep -E "manager|bootstrapper" | sed 's/\.md$//'

echo ""
echo "=== Recent Changes ==="
if [ -f ~/.claude/IMPROVE-CHANGELOG.md ]; then
  tail -10 ~/.claude/IMPROVE-CHANGELOG.md
else
  echo "No IMPROVE-CHANGELOG.md found"
fi

echo ""
echo "=== Reggie Identity ==="
cat ~/.claude/REGGIE.md
```

## Instructions

This command orchestrates the **reggie-system-change pipeline** — a lightweight workflow for formalizing changes to the `~/.claude/` agent system that you already know you want to make.

**IMPORTANT**: You (the main Claude) orchestrate this pipeline directly. Do NOT launch the reggie-system-change-manager as a subagent — subagents cannot launch other subagents. Instead, read `~/.claude/agents/reggie-system-change-manager.md` for detailed guidance, then run each stage yourself by launching the appropriate specialized agent via the Task tool. When launching any agent via Task, only use `model: "opus"` or `model: "sonnet"` — never `model: "haiku"`.

### When to Use

- You already know what you want to change in the agent system
- A change emerged from a conversation and needs to be formalized
- Modifying existing agents, commands, or pipeline behavior
- Adjusting conventions, fixing integration issues, updating patterns

### When NOT to Use

| Situation | Use Instead |
|-----------|-------------|
| Discovering system issues (no specific change in mind) | `/evaluate-reggie` |
| Processing accumulated agent learnings | `/improve` |

### Arguments

```
/reggie-system-change                              # Start the pipeline (uses conversation context)
/reggie-system-change [description of change]      # Start with a specific change request
$ARGUMENTS
```

### The Pipeline

```
INTAKE → BRAINSTORM → PLAN → IMPLEMENT → VERIFY
              ↕              ↕
           RESEARCH        RESEARCH
          (on demand)     (on demand)

Confirmation-based gates. Judge scoring (9.0/10) on PLAN when creating new components.
```

---

## Phase 1: INTAKE

You (main Claude) handle this directly. No subagent.

Synthesize the change request from conversation context and/or `$ARGUMENTS`. Present it back to the user for confirmation.

Read `~/.claude/agents/reggie-system-change-manager.md` Stage 1: INTAKE for the full format. The core task: capture WHAT is changing, WHY, and any CONTEXT from prior discussion.

If the change request is obvious from the conversation, this can be a quick confirmation. Do not over-formalize simple requests.

---

## Phase 2: BRAINSTORM

Launch **thought-partner** agent via Task tool.

Read `~/.claude/agents/reggie-system-change-manager.md` Stage 2: BRAINSTORM for the full prompt template. Provide the confirmed change request.

Key guidance for the thought-partner:
- If the direction is already clear from conversation, confirm quickly and move on
- If there are genuine design questions, explore them one at a time
- If questions arise about current system state that you cannot answer, pause BRAINSTORM and dispatch **researcher** to gather the needed information, then resume

**On-demand research**: Before or during the brainstorm, if you need information about how the current system works (which files do X, how does Y pipeline flow, what agents reference Z), launch the **researcher** agent to investigate. Provide the researcher's findings to the thought-partner as additional context.

**Conversational gate**: This stage ends when the user confirms the brainstorm summary direction.

After the thought-partner produces the Brainstorm Summary and the user confirms, print the BRAINSTORM summary box.

---

## Phase 3: PLAN

Launch **claude-architect** agent via Task tool.

Read `~/.claude/agents/reggie-system-change-manager.md` Stage 3: PLAN for the full prompt template. Provide:
- The confirmed change request from INTAKE
- The brainstorm summary with direction and design decisions
- The content of key files that will be affected (read them and include them)

The claude-architect produces a file-by-file change plan with:
- Each change classified as `direct-edit`, `new-component`, or `integration-update`
- Frontmatter changes flagged for per-change approval
- Risks and dependencies identified
- Execution order specified

After the architect returns, the orchestrator runs validation checks (naming, tool permissions, required sections, description quality). If the plan includes `new-component` changes, launch the **judge** agent to score design quality (9.0/10 threshold).

**On-demand research**: If the architect needs dependency analysis (which files reference agent X? which commands use pipeline stage Y?), dispatch **researcher** before or during planning. Provide findings to the architect.

**Approval gate**: Present the plan to the user. They may:
- Approve all changes
- Approve some and reject others
- Request modifications to specific changes
- Ask to re-plan with different constraints

After the user approves the plan, print the PLAN summary box.

---

## Phase 4: IMPLEMENT

You (main Claude) handle this directly. No subagent.

Read `~/.claude/agents/reggie-system-change-manager.md` Stage 4: IMPLEMENT for full details.

1. For any YAML frontmatter changes in the plan, ask for per-change approval
2. Execute changes in the planned order:
   - **direct-edit**: Read file, apply edit, validate
   - **new-component**: Read similar files for patterns, create with Write tool, validate
   - **integration-update**: Update PORTABLE-PACKAGE.md, reggie-guide.md, MEMORY.md
3. Print implementation summary

**Safety rules**:
- Never delete files — only modify or note for manual deletion
- Never modify YAML frontmatter without per-change user approval
- Always read a file before editing it
- When creating new files, read 2-3 similar existing files first to match patterns

After all changes are applied, print the IMPLEMENT summary box and advance to VERIFY.

---

## Phase 5: VERIFY

Launch **researcher** agent via Task tool.

Read `~/.claude/agents/reggie-system-change-manager.md` Stage 5: VERIFY for the full prompt template. Provide the list of all changes made during IMPLEMENT.

The researcher validates:
1. **File counts** — actual counts match PORTABLE-PACKAGE.md and MEMORY.md
2. **Cross-references** — no dangling references to renamed or changed files
3. **Internal consistency** — pipeline managers match commands, reggie-guide.md is complete
4. **Format validation** — YAML frontmatter valid, required sections present
5. **Description accuracy** — modified descriptions still accurate

If VERIFY finds issues, fix them immediately and re-verify. Print the VERIFY summary box when all checks pass.

---

## Workflow Controls

| Command | Action |
|---------|--------|
| `continue` / `y` | Advance to next stage / approve |
| `skip` | Skip current stage |
| `back` | Return to previous stage |
| `show plan` | Re-display the PLAN output |
| `show changes` | Re-display the change request |
| `abort` | Stop the pipeline |

---

## Post-VERIFY: CAPTURE-LEARNINGS

After the pipeline completes, capture agent-level learnings. This feeds the self-improvement loop.

**Process**:
1. Review the pipeline run — was BRAINSTORM the right depth? Did PLAN identify all affected files? Were there surprises during IMPLEMENT?
2. For each genuine learning, append an entry to `~/.claude/AGENT-IMPROVE.md` using the standard entry format (see `~/.claude/agents/improve-pipeline-manager.md` for format)
3. If the pipeline ran smoothly, capture zero learnings — do NOT invent entries
4. Classify each learning at capture time: UNIVERSAL / PROJECT / PROCESS

**Focus areas for reggie-system-change**:
- Did the thought-partner correctly gauge brainstorm depth (quick vs deep)?
- Did the claude-architect identify all affected files and dependencies?
- Were integration updates (PORTABLE-PACKAGE.md, reggie-guide.md, MEMORY.md) identified upfront or caught only during VERIFY?
- Did any files have unexpected current state during IMPLEMENT?

After capturing (or skipping), the AUTO-IMPROVE stage runs next.

---

## AUTO-IMPROVE

After CAPTURE-LEARNINGS, automatically run the improve pipeline if enough entries have accumulated.

**Process**:
1. Count entries in `~/.claude/AGENT-IMPROVE.md` (count `## Entry:` headers)
2. If file doesn't exist or has 0 entries: skip silently, proceed to next stage
3. If 1-2 entries: print "X entries in AGENT-IMPROVE.md (below threshold of 3). Deferring to next pipeline run." and proceed
4. If 3+ entries: run the improve pipeline with `--minor-only` behavior:
   - Read `~/.claude/agents/improve-pipeline-manager.md` for full stage guidance
   - Execute COLLECT → CLASSIFY → ANALYZE → PROPOSE → APPLY → VERIFY → CURATE
   - Auto-apply minor changes (Common Pitfalls, Quality Standards, project memory entries)
   - Log major proposals to `~/.claude/IMPROVE-CHANGELOG.md` but do NOT prompt for approval — defer to explicit `/improve` run
   - Clear processed minor entries from AGENT-IMPROVE.md; keep major entries for later

**Summary box** (print after AUTO-IMPROVE completes or skips):
```
┌──────────────────────────────────────────────────────────────────┐
│ AUTO-IMPROVE (reggie-system-change)                               │
│                                                                  │
│ Entries found: [N]                                               │
│ Threshold: 3                                                     │
│ Action: [skipped — no entries | deferred — below threshold |     │
│          ran — N minor applied, N major deferred]                │
└──────────────────────────────────────────────────────────────────┘
```

