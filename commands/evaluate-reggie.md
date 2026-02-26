# Evaluate Reggie

Evaluate the ~/.claude/ agent system architecture and propose improvements.

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
ls ~/.claude/agents/ | grep -E "manager" | sed 's/\.md$//'

echo ""
echo "=== PORTABLE-PACKAGE.md Stats ==="
if [ -f ~/.claude/PORTABLE-PACKAGE.md ]; then
  grep -E "^#### " ~/.claude/PORTABLE-PACKAGE.md | head -15
else
  echo "PORTABLE-PACKAGE.md not found"
fi

echo ""
echo "=== Pending AGENT-IMPROVE entries ==="
if [ -f ~/.claude/AGENT-IMPROVE.md ]; then
  TOTAL=$(grep -c "^## Entry:" ~/.claude/AGENT-IMPROVE.md 2>/dev/null || echo "0")
  echo "$TOTAL pending entries"
else
  echo "No AGENT-IMPROVE.md (clean)"
fi

echo ""
echo "=== Reggie Identity ==="
cat ~/.claude/REGGIE.md
```

## Instructions

This command orchestrates the **evaluate-reggie pipeline** — a periodic architectural review of the `~/.claude/` agent system. It inventories all agents and commands, analyzes the system for gaps and issues, discusses findings with you, and produces actionable improvement proposals.

**IMPORTANT**: You (the main Claude) orchestrate this pipeline directly. Do NOT launch the evaluate-reggie-manager as a subagent — subagents cannot launch other subagents. Instead, read `~/.claude/agents/evaluate-reggie-manager.md` for detailed guidance, then run each stage yourself by launching the appropriate specialized agent via the Task tool. When launching any agent via Task, only use `model: "opus"` or `model: "sonnet"` — never `model: "haiku"`.

**This is NOT /improve.** The improve pipeline processes per-agent learnings accumulated during pipeline runs. This pipeline evaluates the system architecture itself: are there missing agents, redundant commands, permission mismatches, outdated patterns, or broken integrations?

### Arguments

```
/evaluate-reggie                    # Full evaluation: SCAN → EVALUATE → BRAINSTORM → PROPOSE
/evaluate-reggie --scan-only        # Just produce the system inventory
/evaluate-reggie --implement        # Full evaluation + implement + verify
$ARGUMENTS
```

### The Pipeline

```
SCAN → EVALUATE → BRAINSTORM → PROPOSE → [IMPLEMENT → VERIFY]
                                           optional (--implement)

No numeric quality gates. Confirmation-based gates throughout.
```

---

## Phase 1: SCAN

Launch **researcher** agent via Task tool.

Read `~/.claude/agents/evaluate-reggie-manager.md` Stage 1: SCAN for the full prompt template. The core task: inventory every file in `~/.claude/agents/` and `~/.claude/commands/`, recording metadata, section completeness, cross-references, and system file accuracy.

Key instructions for the researcher:
- Read EVERY file in both directories. Do not sample.
- For agents: record name, category, tools, memory type, line count, section completeness
- For commands: record name, type, Context/Instructions/Arguments presence, agents referenced
- Cross-reference: orphaned agents, missing agents, pipeline managers without commands
- Check PORTABLE-PACKAGE.md counts against actual file counts
- Check reggie-guide.md completeness

After the researcher returns, print the SCAN summary box.

**If `--scan-only` in $ARGUMENTS**: Print the inventory and stop. Do not advance to EVALUATE.

---

## Phase 2: EVALUATE

Launch **claude-architect** agent via Task tool.

Read `~/.claude/agents/evaluate-reggie-manager.md` Stage 2: EVALUATE for the full prompt template. Provide the full inventory from SCAN as input.

The claude-architect evaluates six dimensions:
1. Coverage gaps (missing agents for tech stack, missing reviewers)
2. Redundancies (overlapping agents, duplicate commands)
3. Consistency (section structure, memory config, examples, naming, permissions)
4. Drift & staleness (outdated references, count mismatches)
5. Integration health (pipeline manager/command alignment)
6. Permission audit (over/under-permissioned agents)

After the claude-architect returns, print the EVALUATE summary box.

---

## Phase 3: BRAINSTORM

Launch **thought-partner** agent via Task tool.

Read `~/.claude/agents/evaluate-reggie-manager.md` Stage 3: BRAINSTORM for the full prompt template. Provide the evaluation findings and strengths.

This is a CONVERSATION with the user. The thought-partner discusses what resonates, what to prioritize, and what to leave alone. The user may add findings, deprioritize flagged issues, or redirect entirely.

**Conversational gate**: This stage ends when the user confirms the prioritized summary.

After the thought-partner produces the Brainstorm Summary and the user confirms, print the BRAINSTORM summary box.

---

## Phase 4: PROPOSE

Launch **claude-architect** agent via Task tool.

Read `~/.claude/agents/evaluate-reggie-manager.md` Stage 4: PROPOSE for the full prompt template. Provide the Brainstorm Summary (prioritized items only) and relevant SCAN inventory data.

The claude-architect produces a concrete proposal for each prioritized item with: problem, proposed change, implementation path, effort, risk, and dependencies.

Present the proposals to the user.

**If `--implement` NOT in $ARGUMENTS**: Print the PROPOSE completion box with a note to run `/evaluate-reggie --implement` to execute. Pipeline complete.

**If `--implement` in $ARGUMENTS**: Present proposals for approval, then advance to IMPLEMENT.

---

## Phase 5: IMPLEMENT (only with --implement flag)

**Skip this phase entirely if `--implement` is NOT in $ARGUMENTS.**

Read `~/.claude/agents/evaluate-reggie-manager.md` Stage 5: IMPLEMENT for full details. You (main Claude) execute this directly.

1. Present each proposal to the user: approve (y), skip (n), or modify
2. For each approved proposal, route to the appropriate method:
   - **New agents/commands/workflows**: Read 2-3 similar files for patterns, create with Write tool, validate
   - **Small modifications to existing files**: Apply directly with Edit tool, validate, log
   - **PORTABLE-PACKAGE.md/reggie-guide.md updates**: Apply directly with Edit tool
3. Print implementation summary and follow-up list
4. Advance to VERIFY

**Safety rules**: Never delete files. Never modify YAML frontmatter without per-change user approval. When creating new files, read similar existing files first to match patterns.

---

## Phase 6: VERIFY (only after IMPLEMENT)

Launch **researcher** agent via Task tool.

Read `~/.claude/agents/evaluate-reggie-manager.md` Stage 6: VERIFY for the full prompt template. Provide the list of all changes made during IMPLEMENT.

The researcher validates:
1. **File counts** — actual counts match PORTABLE-PACKAGE.md and MEMORY.md
2. **Cross-references** — no dangling references to deleted/renamed files
3. **Internal consistency** — pipeline managers match commands, reggie-guide.md is complete
4. **Format validation** — YAML frontmatter valid, required sections present

If VERIFY finds issues, fix them immediately and re-verify. Print the VERIFY summary box when all checks pass.

---

## Workflow Controls

| Command | Action |
|---------|--------|
| `continue` / `y` | Advance to next stage / approve a proposal |
| `skip` / `n` | Skip a proposal |
| `modify` | Adjust a proposal before approving |
| `add` | Add a finding or proposal the evaluation missed |
| `abort` | Stop the pipeline |
| `show inventory` | Re-display the SCAN inventory |
| `show findings` | Re-display the EVALUATE findings |
| `show proposals` | Re-display the PROPOSE proposals |

---

## Post-Completion: CAPTURE-LEARNINGS

After the evaluation pipeline completes, capture agent-level learnings. This feeds the self-improvement loop.

**Process**:
1. Review the evaluation pipeline — SCAN thoroughness, EVALUATE accuracy, BRAINSTORM productivity, PROPOSE quality
2. For each genuine learning, append an entry to `~/.claude/AGENT-IMPROVE.md` using the standard entry format (see `~/.claude/agents/improve-pipeline-manager.md` for format)
3. If the pipeline ran smoothly, capture zero learnings — do NOT invent entries
4. Classify each learning at capture time:
   - **UNIVERSAL**: Would benefit any project using this agent
   - **PROJECT**: Specific to this project
   - **PROCESS**: Suggests a pipeline/command workflow change
   - If unsure, default to PROJECT

**Focus areas for evaluate-reggie**:
- Did SCAN catch all files and cross-references, or were gaps discovered later?
- Did EVALUATE's six dimensions cover the actual issues found?
- Did BRAINSTORM with the user surface priorities the evaluation missed?
- Were PROPOSE recommendations specific enough to implement directly?
- If --implement was used, did changes apply cleanly or need manual fixes?

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
│ AUTO-IMPROVE (evaluate-reggie)                                    │
│                                                                  │
│ Entries found: [N]                                               │
│ Threshold: 3                                                     │
│ Action: [skipped — no entries | deferred — below threshold |     │
│          ran — N minor applied, N major deferred]                │
└──────────────────────────────────────────────────────────────────┘
```

