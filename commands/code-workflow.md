# Code Workflow

Execute the complete development workflow for a task from start to finish.

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
ls -la *.md 2>/dev/null | head -5
```

## Instructions

### CRITICAL: DO NOT RESUME ACTIVE TASKS

Tasks listed under `## Active Tasks` in TASKS.md belong to OTHER sessions. **Do NOT resume, continue, or pick up any task that is already in Active Tasks.** There is no session ownership tracking — if a task is active, another terminal is working on it.

- **NEVER** look at an active task and decide to "continue" or "resume" it
- **ALWAYS** pick from the `## Backlog` section or start a new task from user input
- The **only** exception: the user explicitly says `resume [slug]` — meaning they know this is their own paused task

If `$ARGUMENTS` is empty and the backlog is empty and there are active tasks, **ask the user what to do** — do not grab an active task.

---

This command orchestrates the **full development pipeline** for a single task.

**IMPORTANT**: You (the main Claude) orchestrate this pipeline directly. Do NOT launch the pipeline-manager as a subagent — subagents cannot launch other subagents. Instead, read `~/.claude/agents/pipeline-manager.md` for detailed guidance, then run each stage yourself by launching the appropriate specialized agent via the Task tool. After each agent returns, launch the **judge** agent to score the output (9.0/10 threshold). Print the stage summary box after every stage. If the judge fails a stage, feed the feedback back to the stage agent, re-launch, and re-judge until it passes or escalates. When launching any agent via Task, only use `model: "opus"` or `model: "sonnet"` — never `model: "haiku"`.

**`--opus` flag**: If `$ARGUMENTS` contains `--opus`, strip it from arguments before further parsing and force `model: "opus"` on **every** Task tool agent launch for the entire pipeline run. This disables all Sonnet optimizations. Use when maximum quality is needed on every stage. When active, print `⚙ Mode: all-opus` during PICKUP.

**DISCOVERED ISSUES**: When prompting any agent, always include: "If you discover unrelated issues in the codebase (bugs, tech debt, security problems, missing tests), list them under a `## Discovered Issues` heading at the end of your output. Do not fix them." After each stage returns, check for discovered issues and add them to `### Ungroomed` at the bottom of `## Backlog` in TASKS.md (create the section if it doesn't exist).

**DESIGN MODE**: For design-focused work (redesigning screens, new UI themes, visual polish), use `/design-workflow` instead. It runs a design-optimized stage sequence with different agents (design-innovator, visual-architect) and a human review gate. See `~/.claude/agents/pipeline-manager.md` → "Pipeline Modes" for how modes work.

### The Pipeline

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                                                                             │
│   PICKUP → RESEARCH → PLAN → IMPLEMENT → WRITE-TESTS → QUALITY-CHECK       │
│                                                                             │
│                                         → SIMPLIFY                          │
│                                              ↓                              │
│                                         VERIFY-APP                          │
│                                        ↙         ↘                         │
│                                   [FAIL]         [PASS]                     │
│                                     ↓               ↓                       │
│                              Back to PLAN       REVIEW                      │
│                                                ↙      ↘                    │
│                                           [FAIL]      [PASS]                │
│                                             ↓            ↓                  │
│                                      Back to PLAN   SECURITY-REVIEW         │
│                                                    ↙          ↘            │
│                                               [FAIL]          [PASS]        │
│                                                 ↓                ↓          │
│                                          Back to PLAN      SYNC-DOCS        │
│                                                                 ↓           │
│                                                           UPDATE-CLAUDE     │
│                                                                 ↓           │
│                                                        REVIEW-WITH-USER     │
│                                                        ↙            ↘      │
│                                                  [NEEDS WORK]    [APPROVED] │
│                                                       ↓               ↓     │
│                                                Back to IMPLEMENT    COMMIT  │
│                                                                       ↓     │
│                                                                 ✓ COMPLETE  │
│                                                                       ↓     │
│                                                               PICKUP (next) │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Workflow Execution

Execute each stage, waiting for completion and confirmation before proceeding. After updating TASKS.md quality scores or stage status at each stage, commit metadata: `git add TASKS.md 2>/dev/null && git diff --cached --quiet || git commit -m "meta: stage [slug] [STAGE-NAME]" --no-gpg-sign 2>/dev/null`. See pipeline-manager.md → "Metadata Commit System" for all commit events.

---

## Stage 1: PICKUP

**Migration check**: If TASKS.md contains a `## Completed` section (old format), auto-migrate those entries to `HISTORY.md` and remove the section from TASKS.md, then commit metadata: `git add TASKS.md HISTORY.md 2>/dev/null && git diff --cached --quiet || git commit -m "meta: migrate-history" --no-gpg-sign 2>/dev/null`. See pipeline-manager.md → "TASKS.md Migration" for details.

**Key rule: never resume someone else's active task.** Active tasks in TASKS.md are assumed to be owned by another session. This session should only work on tasks it picks up fresh from the backlog or that the user explicitly specifies.

**Auto-pickup** (when `/code-workflow` is run with no arguments and no task context):
1. Look at TASKS.md: list active tasks (these belong to other sessions) and backlog
2. If backlog has items, auto-pick the first `- [ ]` item (reads top-to-bottom, skipping `###` section headings and skipping all items under `### Ungroomed`)
3. Print: "Picking up: [task name]. Starting PLAN stage."
4. Print active tasks as FYI: "Other active tasks: [list slugs + stages]"
5. Record base branch: `git branch --show-current`
6. Create worktree:
   ```bash
   git worktree prune
   git worktree remove --force .worktree/[slug] 2>/dev/null || true
   git branch -D task/[slug] 2>/dev/null || true
   git worktree add -b task/[slug] .worktree/[slug] [base-branch]
   ```
7. Copy untracked essentials:
   ```bash
   for f in .env .env.local .env.development.local; do
       [ -f "$f" ] && cp "$f" ".worktree/[slug]/$f"
   done
   ```
8. If project uses `node_modules/`, run install command in `.worktree/[slug]/`
9. Create `.pipeline/[slug]/` with `CONTEXT.md` (in main repo). **Context Seeding**: If the backlog entry has `>` context blocks, extract them and write to `CONTEXT.md` under a `## Pre-existing Context` section. If no context blocks, create empty `CONTEXT.md`.
10. Ensure `.pipeline/` and `.worktree/` are in `.gitignore`
11. Add to Active Tasks in TASKS.md (include **Branch**, **Worktree**, **Base** fields)
12. Remove the picked-up task's `- [ ] slug: ...` entry from `## Backlog` in TASKS.md. Delete the entire entry including any indented `>` context lines below it.
13. Commit metadata: `git add TASKS.md 2>/dev/null && git diff --cached --quiet || git commit -m "meta: pickup [slug]" --no-gpg-sign 2>/dev/null`
14. **Skip List**: Evaluate if any stages are categorically inapplicable (see pipeline-manager.md → Skip List). Write `.pipeline/[slug]/SKIP` with stage names and reasons. If no stages should be skipped, skip this step.

**If no backlog items remain:**
```
Active tasks (owned by other sessions):
  - [slug]: [task name] (STAGE)
  - [slug]: [task name] (STAGE)

Backlog is empty. Options:
  1. Describe a new task to start
  2. Wait for an active task to complete
```

**If task specified in arguments** (`/code-workflow add streak tracking`):
Tasks need refinement before entering the pipeline. Redirect the user:
```
This task needs refinement before entering the pipeline. Run:
  /init-tasks [task description]
to refine it with codebase context and acceptance criteria, then
run /code-workflow to pick it up from the backlog.
```

**Resuming your own task** (after context compaction or `/code-workflow resume [slug]`):
- Only resume a specific task if the user explicitly names it
- Verify worktree exists; if missing, recreate from branch: `git worktree add .worktree/[slug] task/[slug]`
- Read `.pipeline/[slug]/CONTEXT.md` and `.pipeline/[slug]/HANDOFF.md` to restore context
- Continue from the stage recorded in TASKS.md

Use **pipeline-manager** agent to manage TASKS.md.

**IMPORTANT**: After creating `.pipeline/[slug]/` and `.worktree/[slug]/`, ensure both `.pipeline/` and `.worktree/` are in `.gitignore`.

### Agent Working Directory

When launching any code-modifying agent (IMPLEMENT, WRITE-TESTS, SIMPLIFY, VERIFY-APP, etc.), always include in the prompt:

> "The project root for this task is: `[absolute path to .worktree/[slug]]`. All file reads, writes, and bash commands must operate in this directory."

Agents that only manage pipeline metadata (judge, pipeline-manager) operate from the main repo root. The `.pipeline/[slug]/CONTEXT.md` is always read/written from the main repo root.

### Skip Handling

Before launching any stage agent, check `.pipeline/[slug]/SKIP`. If the current stage is listed, record `SKIP` in the quality scores table, print `⊘ [STAGE] — skipped ([reason])`, and advance to the next stage. Progress markers: `✓ = passed, ● = current, ○ = upcoming, ⊘ = skipped`.

---

## Stage 2: RESEARCH

```
## Research Phase

Before planning, let's understand the problem space.

[Use **researcher** agent]

Researching: [task topic]
- How have others solved this?
- What patterns should we follow?
- Any gotchas to watch for?
```

After research completes:
```
Research complete. Key findings:
- [Finding 1]
- [Finding 2]
- [Finding 3]

Ready to plan? (y/n)
```

---

## Stage 3: PLAN

```
## Planning Phase

[Use **code-architect** agent]

Creating technical plan for: [task]
```

After plan completes:
```
Plan complete:
- [X] files to create/modify
- [X] step approach
- Key decisions documented

Review the plan above. Ready to implement? (y/n)
```

### Post-PLAN: Conflict Detection

After PLAN passes its quality gate, before advancing to IMPLEMENT:
1. Parse the code-architect's file list from the plan output (look for `### Files` section)
2. Write the file list to this task's `**Files**` field in TASKS.md (format: `NEW: path` or `MOD: path`)
3. Commit metadata: `git add TASKS.md 2>/dev/null && git diff --cached --quiet || git commit -m "meta: files [slug]" --no-gpg-sign 2>/dev/null`
4. Compare against all other active tasks' `**Files**` lists in TASKS.md
5. If overlap exists, show conflict warning and ask user to choose: Proceed / Wait / Rethink / Abort
6. If no overlap, proceed to IMPLEMENT

---

## Stage 4: IMPLEMENT

```
## Implementation Phase

[Use appropriate dev agent: **ios-developer**, **android-developer**, **web-developer**, **typescript-developer**, **go-developer**, **python-developer**, **cloud-engineer**, or **firebase-debugger**]

Implementing: [task]
Platform: [detected platform]
```

After implementation:
```
Implementation complete.

Files changed:
- [file list]

Ready to write tests? (y/n)
```

---

## Stage 5: WRITE-TESTS

```
## Testing Phase

[Use **qa-engineer** agent]

Writing tests for: [implemented feature]
```

After tests written:
```
Tests written:
- [test file 1]
- [test file 2]

Ready for quality check? (y/n)
```

---

## Stage 6: QUALITY-CHECK

```
## Quality Check Phase

[Use **qa-engineer** agent]

Validating test quality and coverage...
```

After quality check:
```
Quality check complete:
- Test coverage: [X%]
- Edge cases covered: [list]
- Gaps identified: [any issues]

Ready to simplify? (y/n)
```

---

## Stage 7: SIMPLIFY

```
## Simplification Phase

[Use **refactorer** agent]

Cleaning up implementation...
```

After simplification:
```
Simplification complete:
- [Changes made]

Ready to verify? (y/n)
```

---

## Stage 8: VERIFY-APP

```
## Verification Phase

[Use **app-tester** agent]

Running tests and verifying the feature works...
```

**If PASS:**
```
✓ Verification PASSED
- All tests passing
- Feature works as expected

Proceeding to review...
```

**If FAIL:**
```
✗ Verification FAILED

Issues found:
- [Issue 1]
- [Issue 2]

This needs to go back. Where should we return?
1. Back to PLAN (rethink approach)
2. Back to IMPLEMENT (fix the code)
3. Back to RESEARCH (need more info)
```

Loop back to selected stage.

---

## Stage 9: REVIEW

```
## Code Review Phase

[Use **code-reviewer** agent]

Reviews the current task's diff for:
- Bugs and edge cases
- Error handling
- Performance issues
- Plan compliance
- Readability
```

**If PASS:**
```
✓ Code Review PASSED

Proceeding to security review...
```

**If FAIL:**
```
✗ Code Review found [N] blockers:
- [file:line]: [issue]

Going back to IMPLEMENT to fix blockers.
```

---

## Stage 10: SECURITY-REVIEW

```
## Security Review Phase

[Use **security-reviewer** agent]

Audits the current task's changes for:
- Secrets in code
- Injection vulnerabilities (SQL, XSS, command)
- Auth/authz enforcement
- Dependency CVEs
- Security headers and rules
```

**If PASS:**
```
✓ Security Review PASSED

Proceeding to sync docs...
```

**If FAIL:**
```
✗ Security issues found:
- [file:line]: [vulnerability]

Going back to IMPLEMENT to fix security issues.
```

---

## Stage 11: SYNC-DOCS

```
## Documentation Sync Phase

[Use **technical-writer** agent]

Updating:
- CHANGELOG.md
- README.md (if needed)
- API docs (if needed)
```

After sync:
```
Docs updated:
- [Changes made]

Proceeding to update CLAUDE.md...
```

---

## Stage 12: UPDATE-CLAUDE

```
## Learning Capture Phase

Any learnings from this task to add to CLAUDE.md?

- Mistakes to avoid next time?
- Patterns that worked well?
- Gotchas discovered?

[Add to CLAUDE.md or skip if none]
```

---

## Stage 12.5: REVIEW-WITH-USER

Walk the user through what was built, mapped to each acceptance criterion from the task. This is a human gate — no judge scoring.

**Skip condition**: If the task has no acceptance criteria (legacy format without enriched `>` blocks), auto-skip: `⊘ REVIEW-WITH-USER — skipped (no acceptance criteria found)`. Also skip in design mode (DESIGN-REVIEW already covers user review).

**Process**:

1. **Extract acceptance criteria**: Read the task's acceptance criteria from `.pipeline/[slug]/CONTEXT.md` (under `## Pre-existing Context`). Look for the `## Acceptance Criteria` section within the context block.

2. **Per-criterion walkthrough**: For each criterion, present what was done:

```
## Acceptance Criterion 1 of [N]

Criterion: "All toggles left-edge aligned within their rows"

What was done:
- Modified SettingsRow.swift: added .frame(alignment: .leading)
  to toggle container
- Applied to all SettingsRow instances in SettingsView.swift

Files changed:
- src/components/SettingsRow.swift (lines 24-28)
- src/screens/SettingsView.swift (lines 45, 67, 89)

Does this satisfy the criterion? (y / needs work)
```

3. **User response handling**:
   - **y**: Mark criterion as satisfied, move to next
   - **needs work**: Collect specific feedback on what's wrong

4. **On mismatch**: If any criteria need work, collect all feedback first (walk through remaining criteria too), then:
   - Add feedback to `.pipeline/[slug]/CONTEXT.md`:
     ```markdown
     ## REVIEW-WITH-USER Feedback (Round [N])
     - Criterion: "[text]" — NEEDS WORK
       Feedback: [user's specific feedback]
     - Criterion: "[text]" — PASS
     ```
   - Loop back to **IMPLEMENT** with the specific feedback. The implementer addresses only failing criteria.
   - After IMPLEMENT, the pipeline re-runs through WRITE-TESTS → QUALITY-CHECK → SIMPLIFY → VERIFY-APP → REVIEW → SECURITY-REVIEW → SYNC-DOCS → UPDATE-CLAUDE → REVIEW-WITH-USER
   - On subsequent passes, only show previously-failed criteria (skip already-approved ones)

5. **On all pass**:
```
All [N] acceptance criteria satisfied.

  - [criterion 1] — PASS
  - [criterion 2] — PASS
  - [criterion 3] — PASS
```

6. **Live preview**: After presenting all criteria, start the app so the user can test hands-on before approving.

   **Detection**: Determine the start command(s) from the worktree project files:
   - `package.json` → look at `scripts.dev`, `scripts.start`, `scripts.serve`
   - `Makefile` / `Procfile` → look for dev/serve targets
   - Python → `manage.py runserver`, `uvicorn`, `flask run`
   - Go → `go run .`
   - Swift → `swift run`
   - If multiple services needed (e.g., backend + frontend), start both

   **Port selection**: Scan for available ports to avoid conflicts with other running pipelines:
   ```bash
   # Find ports already in use
   lsof -iTCP -sTCP:LISTEN -P -n 2>/dev/null | awk '{print $9}' | grep -oE '[0-9]+$' | sort -u
   ```
   Pick the next available port starting from the project's default (e.g., 3000, 3001, 3002...). Pass the port via environment variable or CLI flag (e.g., `PORT=3001 npm run dev`, `--port 3001`).

   **Startup**: Run in background **from the worktree directory**:
   ```bash
   cd .worktree/[slug] && PORT=[port] [start-command] &
   echo $! >> .pipeline/[slug]/SERVERS
   ```
   Wait a few seconds for the server to be ready (check with `curl -s -o /dev/null -w "%{http_code}" http://localhost:[port]` or just a brief pause).

   **Present to user**:
   ```
   Live preview running:
     → http://localhost:[port]          (frontend)
     → http://localhost:[api-port]/api  (backend, if separate)

   Test the feature, then confirm:
     y = approve and proceed to commit
     needs work = describe what's wrong
   ```

   Save all PIDs to `.pipeline/[slug]/SERVERS` (one PID per line) for later cleanup.

   **If startup fails**: Fall back gracefully — print the command the user can run manually and proceed without blocking.

   **On "needs work"**: Kill the servers (read PIDs from `.pipeline/[slug]/SERVERS`, `kill` each, delete the file), then loop back to IMPLEMENT as described in step 4.

   **On approve**: Leave servers running — they'll be cleaned up at COMMIT.

Record `APPROVED` or `CHANGES-[N]` in the Quality Scores table.

---

## Stage 12.7: CAPTURE-LEARNINGS

Before committing, capture any agent-level learnings from this pipeline run. This feeds the self-improvement loop.

**Process**:
1. Review the pipeline run — quality gate failures, iteration loops, unexpected deviations, missed patterns
2. For each genuine learning, append an entry to `~/.claude/AGENT-IMPROVE.md` using this format:

```markdown
## Entry: [pipeline]-[task-slug]-[N]
- **Date**: [today's date]
- **Pipeline**: code-workflow
- **Task**: [task slug]
- **Stage**: [which stage]
- **Agent**: [which agent the learning is about]
- **Severity**: [minor or major]
- **Classification**: [UNIVERSAL / PROJECT / PROCESS]
- **Target Section**: [Common Pitfalls / Quality Standards / Process / etc.]
- **Learning**: [specific, actionable description of what should change]
```

3. If the file doesn't exist, create it with the header from `~/.claude/AGENT-IMPROVE.md`
4. If the pipeline ran smoothly with no quality gate failures, no surprising deviations, and no missed patterns, capture zero learnings — do NOT invent entries
5. Classify each learning at capture time:
   - **UNIVERSAL**: Would benefit any project using this agent (general best practices, language-level patterns)
   - **PROJECT**: Specific to this project (conventions, dependencies, domain knowledge)
   - **PROCESS**: Suggests a pipeline/command workflow change
   - If unsure, default to PROJECT

**Focus areas for code-workflow**:
- Did the researcher provide enough context for the architect?
- Did the architect's plan survive implementation, or did the developer deviate significantly?
- Did tests catch real issues, or were they superficial?
- Did the refactorer actually simplify, or just rearrange?
- Did reviews (code + security) catch things that earlier stages should have prevented?

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
│ AUTO-IMPROVE (code-workflow)                                      │
│                                                                  │
│ Entries found: [N]                                               │
│ Threshold: 3                                                     │
│ Action: [skipped — no entries | deferred — below threshold |     │
│          ran — N minor applied, N major deferred]                │
└──────────────────────────────────────────────────────────────────┘
```

---

## Stage 13: COMMIT

**Server teardown**: Before committing, shut down any servers started during REVIEW-WITH-USER:
```bash
if [ -f .pipeline/[slug]/SERVERS ]; then
  while read pid; do
    kill "$pid" 2>/dev/null
  done < .pipeline/[slug]/SERVERS
  rm .pipeline/[slug]/SERVERS
fi
```

```
## Commit Phase

[Use **technical-writer** agent for commit message]

Committing in worktree:
  git -C .worktree/[slug] add [changed files]
  git -C .worktree/[slug] commit -m "[stage]: description"
```

After commit:
```
✓ Committed in worktree (.worktree/[slug]): [commit message]
Branch: task/[slug]

Ready to mark task complete? (y/n)
```

---

## Stage 14: COMPLETE & NEXT

**Actions to perform (not just display — actually do these):**

1. Final commit in worktree (if uncommitted changes remain)
2. Remove `### [slug]` section from `## Active Tasks` in TASKS.md
3. Append to `HISTORY.md` (same directory as TASKS.md): `- [x] [slug] [task name] -- [date]`. Create the file with a `# Completed Tasks` header if it doesn't exist.
4. Commit metadata: `git add TASKS.md HISTORY.md 2>/dev/null && git diff --cached --quiet || git commit -m "meta: complete [slug]" --no-gpg-sign 2>/dev/null`
5. **CRITICAL: `cd` to the repo root first** — the shell may be sitting in the worktree directory that is about to be removed. Run `cd [repo-root]` (use the known project root path) before any worktree removal. If `cd` fails, the shell CWD is already invalid — start a fresh shell.
6. Ask user for merge strategy. **Always merge/push BEFORE removing the worktree, never after.**
   - **Local merge** (recommended for solo work): Merge branch, then remove worktree
     ```bash
     cd [repo-root]
     git merge task/[slug]
     git worktree remove --force .worktree/[slug]
     git worktree prune
     git branch -d task/[slug]
     ```
   - **PR** (recommended for team projects): Push branch, create PR, then remove worktree
     ```bash
     cd [repo-root]
     git -C .worktree/[slug] push -u origin task/[slug]
     gh pr create --title "[task name]" --body "## Summary\n- [changes]\n\n## Quality Scores\n[scores table]"
     git worktree remove --force .worktree/[slug]
     git worktree prune
     ```
   - **Push only**: Push branch, then remove worktree (user merges later)
     ```bash
     cd [repo-root]
     git -C .worktree/[slug] push -u origin task/[slug]
     git worktree remove --force .worktree/[slug]
     git worktree prune
     ```
7. **Server teardown safety net**: Kill any remaining servers before cleanup:
   ```bash
   if [ -f .pipeline/[slug]/SERVERS ]; then
     while read pid; do kill "$pid" 2>/dev/null; done < .pipeline/[slug]/SERVERS
   fi
   ```
8. **Run `rm -rf .pipeline/[slug]/`** to delete the task's pipeline directory (this also removes the SERVERS file)
9. Show remaining active tasks + backlog

```
Task complete: [task name] ([slug])
Merge strategy: [local merge / PR / push only]

Cleaned up:
  - Worktree .worktree/[slug]/ removed
  - Branch task/[slug] [merged+deleted / pushed / pushed]
  - Pipeline directory .pipeline/[slug]/ deleted

Active tasks: [list remaining active tasks, if any]
Backlog ([X] tasks remaining):
- [ ] [Task 1]
- [ ] [Task 2]

Pick up the next task? (y/n)
```

If yes, loop back to Stage 1 with new task.

---

## Workflow Controls

At any stage, the user can say:

| Command | Action |
|---------|--------|
| `continue` / `y` | Proceed to next stage |
| `skip` | Skip current stage |
| `back` | Go back one stage |
| `back to [stage]` | Jump back to specific stage |
| `pause` | Save progress, exit workflow |
| `status` | Show current position in pipeline |
| `abort` | Cancel workflow (task stays in progress) |

---

## State Tracking

Track workflow state in TASKS.md under `## Active Tasks`:

```markdown
## Active Tasks

### add-streak-tracking
**Task**: Add streak tracking
**Stage**: VERIFY
**Pipeline**: code-workflow
**Branch**: task/add-streak-tracking
**Worktree**: .worktree/add-streak-tracking
**Base**: main
**Started**: 2026-02-05
**Attempts**: 1
**Files**:
- NEW: src/services/StreakManager.swift
- MOD: src/models/UserProgress.swift
**Quality Scores**:
| Stage | Score | Attempts | Status |
|-------|-------|----------|--------|
| RESEARCH | 9.2 | 1 | PASS |
| PLAN | 9.1 | 1 | PASS |
| IMPLEMENT | 9.3 | 1 | PASS |
| VERIFY | - | 0 | CURRENT |
```

Pipeline context lives in `.pipeline/add-streak-tracking/CONTEXT.md`.
Code changes live in `.worktree/add-streak-tracking/` (branch `task/add-streak-tracking`).

If verification/review fails, increment attempts in the quality scores table.

**Metadata commits**: Every edit to TASKS.md or HISTORY.md is immediately committed on the base branch with a `meta:` prefix (e.g., `meta: pickup [slug]`, `meta: stage [slug] IMPLEMENT`, `meta: complete [slug]`). This prevents stash conflicts when multiple sessions edit metadata in parallel. See pipeline-manager.md → "Metadata Commit System" for the full convention.

---

## Starting the Workflow

```
/code-workflow                    # Start/continue workflow (picks from backlog)
/code-workflow --opus             # Force Opus for all agents (no Sonnet overrides)
/code-workflow status             # Show current workflow state
/code-workflow pause              # Pause and save progress
/code-workflow resume [slug]      # Resume paused workflow
/code-workflow --opus resume [slug]  # Resume with all-opus mode
```

### Flags

| Flag | Effect |
|------|--------|
| `--opus` | Force `model: "opus"` on every agent launch. Disables Sonnet optimizations for the entire pipeline run. Use for critical tasks or when Sonnet quality has been insufficient. |

**Note**: To add new tasks, use `/init-tasks` first to refine them with codebase context and acceptance criteria, then `/code-workflow` to pick them up from the backlog.

---

## Example Session

```
> /code-workflow

Picking up from backlog: implement-streak-system [P1]
  "Build streak tracking for user retention"
  Acceptance criteria: 5 items

Other active tasks: fix-color-rendering (IMPLEMENT)
Starting RESEARCH stage.

┌──────────────────────────────────────────────────────────────────┐
│ Stage: RESEARCH — PASS ✓                                         │
│ Score: 9.2/10 (Attempt 1)                                        │
│                                                                  │
│ Summary:                                                         │
│   Researched Duolingo, Wordle, and GitHub streak patterns.       │
│   Identified UTC midnight reset as standard approach.            │
│                                                                  │
│ Key outputs:                                                     │
│   - UTC midnight reset avoids timezone edge cases                │
│   - Grace period pattern from Duolingo reduces churn             │
│                                                                  │
│ Next: PLAN → code-architect                                      │
└──────────────────────────────────────────────────────────────────┘

... [PLAN, IMPLEMENT, WRITE-TESTS, etc. proceed normally] ...

┌──────────────────────────────────────────────────────────────────┐
│ Stage: REVIEW-WITH-USER                                          │
│                                                                  │
│ Acceptance Criterion 1 of 5:                                     │
│   "Streak counter resets at UTC midnight"                        │
│                                                                  │
│ What was done:                                                   │
│   - StreakManager.calculateStreak() uses Calendar with           │
│     TimeZone(identifier: "UTC") for day boundary checks          │
│   - Tests verify reset at 00:00 UTC                              │
│                                                                  │
│ Does this satisfy the criterion? (y / needs work)                │
└──────────────────────────────────────────────────────────────────┘

> y

[... walks through remaining 4 criteria ...]

All 5 acceptance criteria satisfied.
Proceeding to commit...

┌──────────────────────────────────────────────────────────────────┐
│ ✓ PIPELINE COMPLETE: Build streak tracking                       │
│                                                                  │
│  PICKUP → RESEARCH → PLAN → IMPLEMENT → WRITE-TESTS             │
│    ✓         ✓        ✓        ✓            ✓                    │
│                                                                  │
│  → QUALITY-CHECK → SIMPLIFY → VERIFY-APP → REVIEW               │
│         ✓             ✓           ✓          ✓                   │
│                                                                  │
│  → SECURITY-REVIEW → SYNC-DOCS → UPDATE-CLAUDE                  │
│         ✓                ✓            ✓                          │
│                                                                  │
│  → REVIEW-WITH-USER → COMMIT → COMPLETE                         │
│         ✓                ✓        ✓                              │
│                                                                  │
├──────────────────────────────────────────────────────────────────┤
│ All scores:                                                      │
│   RESEARCH: 9.2  PLAN: 9.1  IMPLEMENT: 9.3                      │
│   WRITE-TESTS: 9.0  QUALITY-CHECK: 9.2                          │
│   SIMPLIFY: 9.4  VERIFY-APP: 9.1                                │
│   REVIEW: 9.0  SECURITY-REVIEW: 9.5                             │
│   SYNC-DOCS: 9.2  REVIEW-WITH-USER: APPROVED                    │
│                                                                  │
│ Commits: 12 checkpoints                                          │
│ Status: Push-ready                                               │
└──────────────────────────────────────────────────────────────────┘

Pick up next task? (y)
```

