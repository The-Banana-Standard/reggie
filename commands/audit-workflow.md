# Audit Workflow

Execute the full audit-to-fix pipeline for a codebase.

## Context

```bash
echo "=== Active Tasks ==="
if [ -f "TASKS.md" ]; then
  cat TASKS.md
else
  echo "No TASKS.md found"
fi

echo ""
echo "=== Pipeline Directories ==="
if [ -d ".pipeline" ]; then
  ls -la .pipeline/ 2>/dev/null
else
  echo "No .pipeline/ directory"
fi

echo ""
echo "=== Git Worktrees ==="
git worktree list 2>/dev/null || echo "Not a git repo"
echo ""
echo "=== Current Branch ==="
git branch --show-current 2>/dev/null || echo "Not a git repo"

echo ""
echo "=== Project Info ==="
pwd

echo ""
echo "=== Project Files ==="
find . -maxdepth 2 -type f \( -name "*.json" -o -name "*.md" -o -name "*.swift" -o -name "*.kt" -o -name "*.ts" -o -name "*.go" -o -name "*.py" \) 2>/dev/null | grep -v node_modules | grep -v .next | head -30

echo ""
echo "=== Git Status ==="
git log --oneline -5 2>/dev/null
```

## Instructions

This command orchestrates the **audit pipeline** — a systematic workflow that audits a codebase, prioritizes findings, and fixes them one at a time through quality-gated stages.

**IMPORTANT**: You (the main Claude) orchestrate this pipeline directly. Do NOT launch the audit-pipeline-manager as a subagent — subagents cannot launch other subagents. Instead, read `~/.claude/agents/audit-pipeline-manager.md` for detailed guidance, then run each stage yourself by launching the appropriate specialized agent via the Task tool. After each agent returns, launch the **judge** agent to score the output (9.0/10 threshold). Print the stage summary box after every stage. If the judge fails a stage, feed the feedback back to the stage agent, re-launch, and re-judge until it passes or escalates. When launching any agent via Task, only use `model: "opus"` or `model: "sonnet"` — never `model: "haiku"`.

**DISCOVERED ISSUES**: When prompting any agent, always include: "If you discover unrelated issues in the codebase (bugs, tech debt, security problems, missing tests), list them under a `## Discovered Issues` heading at the end of your output. Do not fix them." After each stage returns, check for discovered issues and add them to `### Ungroomed` at the bottom of `## Backlog` in TASKS.md (create the section if it doesn't exist).

### The Audit Pipeline

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                                                                             │
│   AUDIT → PRIORITIZE → [TASK LOOP] → COMPLETE                              │
│                                                                             │
│   Where each task goes through:                                             │
│                                                                             │
│   RESEARCH → PLAN → IMPLEMENT → WRITE-TESTS → QUALITY-CHECK → SIMPLIFY            │
│                                                                             │
│     → VERIFY-APP → REVIEW → SECURITY-REVIEW → SYNC-DOCS → COMMIT                           │
│                                                                             │
│   Every → is a quality gate (9.0/10). Each fix committed individually.      │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Arguments

```
/audit-workflow                    # Full audit, all categories
/audit-workflow security           # Security-focused audit
/audit-workflow performance        # Performance-focused audit
/audit-workflow tests              # Test coverage audit
/audit-workflow $ARGUMENTS         # Custom focus
```

---

## Pre-flight: TASKS.md Migration

If TASKS.md contains a `## Completed` section (old format), auto-migrate those entries to `HISTORY.md` and remove the section from TASKS.md before proceeding. See pipeline-manager.md → "TASKS.md Migration" for details.

## Phase 1: AUDIT

```
## Audit Phase

[Launch **researcher** agent via Task tool]

Prompt: "Perform a full codebase audit. Identify all issues: critical bugs,
security vulnerabilities, tech debt, missing tests, performance problems,
code quality issues. Rate each finding by severity. Be thorough — check
every directory, every file pattern, every common vulnerability."
```

If $ARGUMENTS specifies a focus (e.g., "security"), tell the auditor:
```
"Focus your audit on [security/performance/tests]. Still note other critical
issues if you spot them, but go deep on [focus area]."
```

After audit completes, launch **judge** to score thoroughness:
- Did it check all directories?
- Did it look at dependencies, configs, and infrastructure — not just app code?
- Are severity ratings calibrated (not everything is "critical")?
- Are findings specific (file paths, line numbers) or vague?

**If PASS:**
```
AUDIT complete — [N] issues found ([breakdown by severity])
→ Committed: "audit: full codebase audit"
→ Advancing to PRIORITIZE
```

**If FAIL:**
Re-launch auditor with judge feedback to dig deeper into missed areas.

---

## Phase 2: PRIORITIZE

You do this yourself (no agent needed):

1. Review all audit findings
2. Score each on two axes:
   - **Impact**: How much does this hurt? (1-10)
   - **Effort**: How hard is the fix? (S/M/L → 1/3/5)
   - **Priority Score** = Impact / Effort (higher = do first)
3. Group related findings into logical tasks
4. Create TASKS.md with tasks grouped by area of focus under `## Backlog` using `### Section Name` headers (e.g., "### Security", "### Performance", "### Code Quality"). Order sections by priority — highest-priority section first.

```
I've prioritized the audit findings into [N] tasks:

| # | Task | Impact | Effort | Priority |
|---|------|--------|--------|----------|
| 1 | [Most impactful, lowest effort first] | 9 | S | 9.0 |
| 2 | ... | ... | ... | ... |

Starting with Task 1. Ready? (y/n)
```

Launch **judge** to score the prioritization:
- Is the ordering sensible? (high-impact low-effort first)
- Are tasks well-scoped? (not too big, not too granular)
- Are related findings grouped logically?

---

## Task Loop

For each task from the prioritized backlog:

### Step 0: Setup

1. Pick the highest-priority task from `## Backlog`
2. Generate slug from task name
3. Record base branch: `git branch --show-current`
4. Create worktree:
   ```bash
   git worktree prune
   git worktree remove --force .worktree/[slug] 2>/dev/null || true
   git branch -D task/[slug] 2>/dev/null || true
   git worktree add -b task/[slug] .worktree/[slug] [base-branch]
   ```
5. Copy untracked essentials:
   ```bash
   for f in .env .env.local .env.development.local; do
       [ -f "$f" ] && cp "$f" ".worktree/[slug]/$f"
   done
   ```
6. If project uses `node_modules/`, run install command in `.worktree/[slug]/`
7. Create `.pipeline/[slug]/` with `CONTEXT.md` (in main repo). **Context Seeding**: Write the audit finding details to `CONTEXT.md` under a `## Pre-existing Context` section using structured format (What, Where, Risk, Fix approach, Effort, Severity). This gives the researcher a head start.
8. Ensure `.pipeline/` and `.worktree/` are in `.gitignore`
9. Add `### [slug]` to `## Active Tasks` in TASKS.md (include **Branch**, **Worktree**, **Base** fields)
10. Remove from backlog
11. Commit metadata: `git add TASKS.md 2>/dev/null && git diff --cached --quiet || git commit -m "meta: pickup [slug]" --no-gpg-sign 2>/dev/null`
12. **Skip List**: Evaluate if any stages are categorically inapplicable. Write `.pipeline/[slug]/SKIP` with stage names and reasons. Never skip SECURITY-REVIEW for Critical/High severity findings. See pipeline-manager.md → Skip List for rules.

**Skip Handling**: Before launching any stage agent, check `.pipeline/[slug]/SKIP`. If the current stage is listed, record `SKIP` in the quality scores table, print `⊘ [STAGE] — skipped ([reason])`, and advance to the next stage.

**Agent Working Directory**: When launching code-modifying agents (IMPLEMENT, WRITE-TESTS, SIMPLIFY, etc.), include in prompt: "The project root for this task is: `[absolute path to .worktree/[slug]]`. All file reads, writes, and bash commands must operate in this directory."

```
┌──────────────────────────────────────────────────────────────────┐
│ Task [N]/[total]: [task name]                                    │
│ Pipeline: audit                                                  │
│ Issue: [audit finding this addresses]                            │
│                                                                  │
│  RESEARCH → PLAN → IMPLEMENT → WRITE-TESTS → QUALITY-CHECK → SIMPLIFY  │
│     ●         ○        ○        ○          ○             ○       │
│                                                                  │
│  → VERIFY-APP → REVIEW → SECURITY-REVIEW → SYNC-DOCS → COMMIT                   │
│      ○        ○         ○        ○       ○                       │
└──────────────────────────────────────────────────────────────────┘
```

---

### Step 1: RESEARCH

```
## Research Phase

[Launch **researcher** agent]

Prompt: "Research context for fixing this audit finding:

  Finding: [audit finding description]
  Severity: [severity]

  1. Search the codebase for all files and patterns related to this issue
  2. Understand what existing code does and how it's structured
  3. Identify conventions and patterns already in use
  4. Note any dependencies or side effects a fix might have
  5. If needed, search the web for best practices on fixing this type of issue

  Output in Pipeline Context format for CONTEXT.md."
```

The researcher should calibrate:
- **Simple fix** (rename, add constant, fix typo): Quick codebase scan, 5-10 lines of context
- **Moderate fix** (refactor pattern, add validation): Codebase scan + relevant conventions, 20-40 lines
- **Complex fix** (architecture change, security overhaul): Deep scan + web research, 40-80 lines

After research completes, **judge scores it**. Key question: does the architect have enough context to plan a good fix?

Append research output to `.pipeline/[slug]/CONTEXT.md`.

---

### Step 2: PLAN

```
## Planning Phase

[Launch **code-architect** agent]

Prompt: "Design a fix for this audit finding:

  [Include research context from .pipeline/[slug]/CONTEXT.md]

  Audit finding: [finding]
  Requirements: Fix the issue thoroughly, not just superficially.

  Output a plan with:
  - ### Files section listing all files to create/modify (NEW: or MOD:)
  - Step-by-step approach
  - Key decisions
  - What could go wrong"
```

After plan completes, **judge scores it**:
- Does the plan actually fix the root cause, not just the symptom?
- Are edge cases considered?
- Is the scope appropriate (not over-engineering, not under-engineering)?

**Post-PLAN actions:**
1. Parse the `### Files` section from the plan
2. Write file list to this task's `**Files**` field in TASKS.md
3. Commit metadata: `git add TASKS.md 2>/dev/null && git diff --cached --quiet || git commit -m "meta: files [slug]" --no-gpg-sign 2>/dev/null`
4. Compare against all other active tasks' file lists
5. If conflict: warn and ask user (Proceed / Skip / Rethink)

Append plan to `.pipeline/[slug]/CONTEXT.md`.

---

### Step 3: IMPLEMENT

```
## Implementation Phase

[Launch appropriate dev agent: **ios-developer**, **web-developer**, etc.]

Prompt: "Implement this fix:

  [Include plan from .pipeline/[slug]/CONTEXT.md]

  This is an audit fix — focus on correctness and completeness.
  The plan is context, not rigid orders. If you discover something
  that changes the approach, adapt and note why."
```

After implementation, **judge scores it**:
- Does it actually fix the finding?
- Are there any new issues introduced?
- Does it follow existing codebase conventions?

---

### Step 4: WRITE-TESTS

```
## Testing Phase

[Launch **qa-engineer** agent]

Prompt: "Write tests for this audit fix:

  Finding: [what was fixed]
  Files changed: [list]

  Write tests that:
  1. Verify the fix works (the issue is gone)
  2. Regression test (the issue can't come back)
  3. Edge cases related to the fix
  4. Run existing tests to ensure nothing broke"
```

After tests, **judge scores**:
- Do tests actually verify the fix?
- Are regression cases covered?
- Do existing tests still pass?

---

### Step 5: QUALITY-CHECK

```
## Quality Check Phase

[Launch **qa-engineer** agent]

Prompt: "Review test quality for this audit fix:

  Tests written: [list]
  Fix description: [what changed]

  Check: coverage adequate? Edge cases covered?
  Missing scenarios? Tests actually running and passing?"
```

---

### Step 6: SIMPLIFY

```
## Simplification Phase

[Launch **refactorer** agent]

Prompt: "Review and simplify this audit fix:

  Files changed: [list]

  Clean up without changing behavior. Remove dead code,
  simplify logic, ensure it matches codebase conventions."
```

---

### Step 7: VERIFY-APP

```
## Verification Phase

[Launch **app-tester** agent]

Prompt: "Verify this audit fix works end-to-end:

  Finding: [original issue]
  Fix: [what was changed]

  Run tests, check the app still works, verify the
  original issue is actually resolved."
```

**If FAIL:** Go back to IMPLEMENT with feedback.

---

### Step 8: REVIEW

```
## Code Review Phase

[Launch **code-reviewer** agent]

Prompt: "Code review this audit fix diff:

  Review for: bugs, edge cases, error handling,
  performance, readability, plan compliance."
```

**If FAIL:** Go back to IMPLEMENT with feedback.

---

### Step 9: SECURITY-REVIEW

```
## Security Review Phase

[Launch **security-reviewer** agent]

Prompt: "Security audit this change:

  Check for: secrets in code, injection vulnerabilities,
  auth/authz issues, dependency CVEs."
```

**If FAIL:** Go back to IMPLEMENT with feedback.

---

### Step 10: SYNC-DOCS

```
## Documentation Sync Phase

[Launch **technical-writer** agent]

Prompt: "Update documentation for this fix if needed.
  Only update docs that are actually affected.
  Skip if the fix doesn't change any public interfaces or behavior."
```

---

### Step 11: COMMIT

```
## Commit Phase

Commit the fix in the worktree:
  git -C .worktree/[slug] add [changed files]
  git -C .worktree/[slug] commit -m "fix([scope]): [description]"

Remove from Active Tasks in TASKS.md. Append to HISTORY.md (same directory): `- [x] [slug] [task name] -- [date]`. Create the file with a `# Completed Tasks` header if it doesn't exist.
Commit metadata: git add TASKS.md HISTORY.md 2>/dev/null && git diff --cached --quiet || git commit -m "meta: complete [slug]" --no-gpg-sign 2>/dev/null

Then `cd [repo-root]` (shell may be in the worktree that is about to be removed) and ask user for merge strategy. **Always merge/push BEFORE removing the worktree.**
  - Local merge: cd [repo-root] && git merge task/[slug] && git worktree remove --force .worktree/[slug] && git worktree prune && git branch -d task/[slug]
  - PR: cd [repo-root] && git -C .worktree/[slug] push -u origin task/[slug] && gh pr create ... && git worktree remove --force .worktree/[slug] && git worktree prune
  - Push only: cd [repo-root] && git -C .worktree/[slug] push -u origin task/[slug] && git worktree remove --force .worktree/[slug] && git worktree prune
Run: rm -rf .pipeline/[slug]/
```

**Task completion summary:**
```
┌──────────────────────────────────────────────────────────────────┐
│ ✓ Task [N]/[total] COMPLETE: [task name]                         │
│ Pipeline: audit                                                  │
│                                                                  │
│  RESEARCH → PLAN → IMPLEMENT → WRITE-TESTS → QUALITY-CHECK → SIMPLIFY  │
│     ✓         ✓        ✓        ✓          ✓             ✓      │
│                                                                  │
│  → VERIFY-APP → REVIEW → SECURITY-REVIEW → SYNC-DOCS → COMMIT                   │
│      ✓        ✓         ✓        ✓       ✓                       │
│                                                                  │
├──────────────────────────────────────────────────────────────────┤
│ All scores:                                                      │
│   RESEARCH: X.X  PLAN: X.X  IMPLEMENT: X.X                      │
│   WRITE-TESTS: X.X  QUALITY-CHECK: X.X  SIMPLIFY: X.X           │
│   VERIFY-APP: X.X  REVIEW: X.X  SECURITY-REVIEW: X.X            │
│   SYNC-DOCS: X.X                                                 │
│                                                                  │
│ Committed: "[commit message]"                                    │
│ Next task: [next task name] ([N+1]/[total])                      │
└──────────────────────────────────────────────────────────────────┘
```

Pick up next task from backlog and repeat.

---

## Pre-Completion: CAPTURE-LEARNINGS

Before the final summary, capture agent-level learnings from the full audit run. This feeds the self-improvement loop.

**Process**:
1. Review the full audit pipeline — quality gate failures, iteration loops, patterns across tasks
2. For each genuine learning, append an entry to `~/.claude/AGENT-IMPROVE.md` using this format:

```markdown
## Entry: audit-workflow-[task-slug]-[N]
- **Date**: [today's date]
- **Pipeline**: audit-workflow
- **Task**: [task slug or "full-audit"]
- **Stage**: [which stage]
- **Agent**: [which agent the learning is about]
- **Severity**: [minor or major]
- **Classification**: [UNIVERSAL / PROJECT / PROCESS]
- **Target Section**: [Common Pitfalls / Quality Standards / Process / etc.]
- **Learning**: [specific, actionable description of what should change]
```

3. If the file doesn't exist, create it with the header from `~/.claude/AGENT-IMPROVE.md`
4. If the pipeline ran smoothly, capture zero learnings — do NOT invent entries
5. Capture learnings that span multiple tasks (patterns, not one-offs)
6. Classify each learning at capture time:
   - **UNIVERSAL**: Would benefit any project using this agent (general best practices, language-level patterns)
   - **PROJECT**: Specific to this project (conventions, dependencies, domain knowledge)
   - **PROCESS**: Suggests a pipeline/command workflow change
   - If unsure, default to PROJECT

**Focus areas for audit-workflow**:
- Did the audit find the most impactful issues, or were critical ones missed?
- Were the prioritization scores well-calibrated?
- Did any task type (security fixes, refactors, etc.) consistently struggle at certain stages?
- Were researchers providing enough context for the specific type of audit fix?

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
│ AUTO-IMPROVE (audit-workflow)                                     │
│                                                                  │
│ Entries found: [N]                                               │
│ Threshold: 3                                                     │
│ Action: [skipped — no entries | deferred — below threshold |     │
│          ran — N minor applied, N major deferred]                │
└──────────────────────────────────────────────────────────────────┘
```

---

## Phase 3: COMPLETE

After all tasks are done:

1. Run a final summary of all changes made
2. List all commits created
3. Note any tasks that were skipped or deferred
4. **Run `/audit` one more time** — re-audit the codebase to verify health improved
5. Compare before/after health score
6. Prompt user: push to remote?

```
┌──────────────────────────────────────────────────────────────────┐
│ ✓ AUDIT PIPELINE COMPLETE                                        │
│                                                                  │
│ Tasks completed: [N]/[total]                                     │
│ Tasks deferred: [N] (if any)                                     │
│ Commits: [N] fix commits                                         │
│                                                                  │
│ Health score: [before] → [after]                                 │
│                                                                  │
│ Status: Push-ready                                               │
└──────────────────────────────────────────────────────────────────┘
```

---

## Workflow Controls

| Command | Action |
|---------|--------|
| `continue` / `y` | Proceed to next stage |
| `skip` | Skip current task, move to next |
| `skip audit` | Skip audit phase, use existing TASKS.md |
| `pause` | Save progress, exit workflow |
| `status` | Show current position |
| `abort` | Cancel workflow |

---

## Quality Gate Escalation

Every stage is judged at 9.0/10. If a stage fails:

```
Attempt 1: Feed judge feedback to stage agent, re-run, re-judge
Attempt 2: Launch researcher for more context, re-run stage, re-judge
Attempt 3: AUTO-TOURNAMENT — two agents compete, judge picks winner
Attempt 4: Escalate to user
```

