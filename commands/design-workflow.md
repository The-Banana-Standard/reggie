# Design Workflow

Execute the design mode pipeline — optimized for visual quality over functional completeness. Use this to redesign entire screens to a new theme, build new UI features with visual polish, or explore design directions.

## Context

```bash
echo "=== Current Task ==="
if [ -f "TASKS.md" ]; then
  cat TASKS.md
fi

echo ""
echo "=== Project Info ==="
pwd

echo ""
echo "=== Platform Detection ==="
if [ -d "ios" ] || ls *.xcodeproj 1>/dev/null 2>&1 || [ -f "Package.swift" ]; then
  echo "iOS project detected"
fi
if [ -f "package.json" ]; then
  echo "Web/Node project detected"
  if grep -q "next" package.json 2>/dev/null; then
    echo "Next.js detected"
  fi
  if grep -q "react" package.json 2>/dev/null; then
    echo "React detected"
  fi
fi

echo ""
echo "=== Git Worktrees ==="
git worktree list 2>/dev/null || echo "Not a git repo"
echo ""
echo "=== Current Branch ==="
git branch --show-current 2>/dev/null || echo "Not a git repo"

echo ""
echo "=== Pipeline Directories ==="
if [ -d ".pipeline" ]; then
  ls -la .pipeline/ 2>/dev/null
else
  echo "No .pipeline/ directory"
fi
```

## Instructions

This command runs the **design mode** of the development pipeline. It shares all infrastructure with `/code-workflow` (worktrees, TASKS.md, quality gates, context seeding, skip lists, conflict detection, merge strategies, CAPTURE-LEARNINGS) but uses a different stage sequence optimized for visual quality.

**IMPORTANT**: You (the main Claude) orchestrate this pipeline directly. Read `~/.claude/agents/pipeline-manager.md` for detailed infrastructure guidance (worktrees, quality gates, TASKS.md management, stage summaries, merge strategies). This file specifies only the design-mode differences. When launching any agent via Task, only use `model: "opus"` or `model: "sonnet"` — never `model: "haiku"`.

**DISCOVERED ISSUES**: Same as code-workflow — always include the discovered issues instruction when prompting any agent. After each stage, check for discovered issues and add them to `### Ungroomed` at the bottom of `## Backlog` in TASKS.md (create the section if it doesn't exist).

**METADATA COMMITS**: All TASKS.md and HISTORY.md edits must be immediately committed using the `meta:` commit pattern from pipeline-manager.md → "Metadata Commit System". This prevents stash conflicts when multiple sessions run in parallel.

### CRITICAL: DO NOT RESUME ACTIVE TASKS

Same rules as code-workflow. Tasks under `## Active Tasks` belong to OTHER sessions. Always pick from `## Backlog` or start fresh. Only exception: user explicitly says `resume [slug]`.

---

### Design Mode Differences from Code Workflow

**Stage sequence:**
```
PICKUP → RESEARCH → PLAN → IMPLEMENT → VERIFY-APP → REFINE → DESIGN-REVIEW → COMMIT → COMPLETE
```

**Automatic skip list** (written to `.pipeline/[slug]/SKIP` at PICKUP):
```
WRITE-TESTS: design mode — visual quality over test coverage
QUALITY-CHECK: design mode — no test suite to validate
SECURITY-REVIEW: design mode — visual focus
SYNC-DOCS: design mode — design changes rarely need doc updates
UPDATE-CLAUDE: design mode — skipped
```

**Agent overrides:**

| Stage | Design Mode Agent | Notes |
|-------|-------------------|-------|
| RESEARCH | design-innovator + researcher | Research current UI/UX trends, competitor approaches, platform conventions (HIG / Material Design). Researcher handles codebase context; design-innovator handles trend research. |
| PLAN | design-innovator + visual-architect | Create design concepts: layout, user flow, component specs, interaction patterns, color/typography/spacing. Include `### Files` section. Replaces code-architect. |
| IMPLEMENT | ios-developer / web-developer | Same dev agent as code mode. Prompt emphasizes visual fidelity: "Focus on visual quality — pixel-perfect implementation of the design concept. Functional correctness matters, but visual polish is the priority." |
| VERIFY-APP | app-tester + design-innovator | Run both: platform tester for functional verification, design-innovator for usability and visual quality. |
| REFINE | design-innovator | Polish for design system compliance, visual consistency, accessibility. Replaces refactorer/SIMPLIFY. |
| DESIGN-REVIEW | human gate | See pipeline-manager.md → DESIGN-REVIEW Stage. User reviews running app: approve / changes / abort. |
| REVIEW | code-reviewer (light-touch) | If not skipped, prompt to focus on structure and obvious bugs, not deep logic review. |

**Platform detection**: Auto-detect from project structure. If ambiguous, ask the user. Platform determines which dev agent and tester are used (ios-developer + app-tester vs web-developer + app-tester).

**Judge framework**: Use the **Design Implementations** framework (see judge.md) for IMPLEMENT and REFINE stages instead of the standard Implementations framework.

**TASKS.md format**: Design tasks use `## Active Tasks` (not a separate section). The `**Pipeline**` field is `design-workflow`. Branch prefix is `task/[slug]`.

---

### Arguments

```
/design-workflow                   # Auto-detect platform, auto-pick from backlog
/design-workflow ios               # Force iOS mode
/design-workflow react             # Force React mode
/design-workflow ios onboarding    # iOS design for specific feature
/design-workflow resume [slug]     # Resume your own paused design
/design-workflow status            # Show current design state
/design-workflow $ARGUMENTS
```

If platform not specified, auto-detect from project structure.

---

### DESIGN-REVIEW Stage

After REFINE passes, enter the DESIGN-REVIEW human gate. See `~/.claude/agents/pipeline-manager.md` → "DESIGN-REVIEW Stage (Design Mode Only)" for the full procedure:

1. Generate `.pipeline/[slug]/DESIGN-SUMMARY.md`
2. Provide viewing instructions (read CLAUDE.md for dev server command)
3. Present options: **approve** / **changes** / **abort**

If `changes`: collect user feedback, loop back: IMPLEMENT → VERIFY-APP → REFINE → DESIGN-REVIEW.
If `approve`: proceed to COMMIT → COMPLETE (same merge strategies as code-workflow).
If `abort`: cleanup worktree, branch, pipeline directory, remove from Active Tasks.

---

### CAPTURE-LEARNINGS

Before completing, capture agent-level learnings from this pipeline run. This feeds the self-improvement loop.

**Process**:
1. Review the pipeline run — quality gate failures, iteration loops, unexpected deviations, missed patterns
2. For each genuine learning, append an entry to `~/.claude/AGENT-IMPROVE.md` using the standard entry format (see `~/.claude/agents/improve-pipeline-manager.md` for format)
3. If the pipeline ran smoothly, capture zero learnings — do NOT invent entries
4. Classify each learning at capture time:
   - **UNIVERSAL**: Would benefit any project using this agent
   - **PROJECT**: Specific to this project
   - **PROCESS**: Suggests a pipeline/command workflow change
   - If unsure, default to PROJECT

**Focus areas for design-workflow**:
- Did research surface relevant design trends and platform patterns?
- Did the design concept survive implementation, or were significant changes needed?
- Did platform/UX testing catch real visual issues?
- Did human review request changes that agents should have caught?

After capturing (or skipping), the AUTO-IMPROVE stage runs next.

---

### AUTO-IMPROVE

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
│ AUTO-IMPROVE (design-workflow)                                    │
│                                                                  │
│ Entries found: [N]                                               │
│ Threshold: 3                                                     │
│ Action: [skipped — no entries | deferred — below threshold |     │
│          ran — N minor applied, N major deferred]                │
└──────────────────────────────────────────────────────────────────┘
```

---

### Workflow Controls

Same as code-workflow:

| Command | Action |
|---------|--------|
| `continue` / `y` | Proceed to next stage |
| `skip` | Skip current stage |
| `back` | Go back one stage |
| `show concept` | Display current design concept |
| `pause` | Save progress, exit workflow |
| `status` | Show current position |
| `abort` | Cancel workflow (cleanup worktree and branch) |

For all other details (worktree management, quality gate escalation, conflict detection, merge strategies, state tracking format, context compaction), see `/code-workflow` and `~/.claude/agents/pipeline-manager.md`.

