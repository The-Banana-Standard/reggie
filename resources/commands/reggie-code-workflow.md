---
type: pipeline
manager: reggie-code-manager
---

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

**IMPORTANT**: You (the main Claude) orchestrate this pipeline directly. Do NOT launch the reggie-code-manager as a subagent — subagents cannot launch other subagents. Instead, read `~/.claude/agents/reggie-code-manager.md` for detailed guidance, then run each stage yourself by launching the appropriate specialized agent via the Task tool. After each agent returns, launch the **reggie-judge** agent to score the output (9.0/10 threshold). Print the stage summary box after every stage. If the judge fails a stage, feed the feedback back to the stage agent, re-launch, and re-judge until it passes or escalates. When launching any agent via Task, only use `model: "opus"` or `model: "sonnet"` — never `model: "haiku"`.

**`--opus` flag**: If `$ARGUMENTS` contains `--opus`, strip it from arguments before further parsing and force `model: "opus"` on **every** Task tool agent launch for the entire pipeline run. This disables all Sonnet optimizations. Use when maximum quality is needed on every stage. When active, print `⚙ Mode: all-opus` during PICKUP.

**`--yes` flag**: If `$ARGUMENTS` contains `--yes`, strip it from arguments and skip ALL **in-session** confirmation gates for the current task. Stage advancement, REVIEW-WITH-USER acceptance, merge strategy selection, and any other human confirmation prompts are auto-approved. Automated quality gates (9.0/10 reggie-judge scoring) still run normally. The flag does **not** auto-continue across tasks: after the current task completes, the workflow emits the standard DONE marker and exits. Cross-task relaunch is the UI's job (per-repo / Batch Start sessions detect the DONE marker and launch the next backlog task in a fresh session). When active, print `⚙ Mode: --yes` during PICKUP.

**`--tier` flag**: If `$ARGUMENTS` contains `--tier <model:effort>` (e.g., `--tier opus:high`), strip it from arguments and enable tier-filtered pickup. During PICKUP, only pick up backlog tasks whose `[tier: X]` tag matches the specified tier. Tasks without a tier tag are treated as `opus:high` (default to highest). When active, print `⚙ Tier: [model:effort]` during PICKUP. Valid tiers: `opus:high`, `opus:medium`, `sonnet:medium`. This enables parallel execution — The Reggie app launches terminals at different tiers and each filters to matching tasks.

**DISCOVERED ISSUES**: When prompting any agent, always include: "If you discover unrelated issues in the codebase (bugs, tech debt, security problems, missing tests), list them under a `## Discovered Issues` heading at the end of your output. Do not fix them." After each stage returns, check for discovered issues and add them to `### Ungroomed` at the bottom of `## Backlog` in TASKS.md (create the section if it doesn't exist).

**PRE-LAUNCH CONTEXT**: Before launching any subagent, pre-read relevant files (~200 line budget) and include their contents in the Task prompt. See `~/.claude/agents/reggie-code-manager.md` → "Pre-Launch Context Loading" for what to include and the format template.

**MODEL ROUTING**: Use the tier table in `~/.claude/agents/reggie-code-manager.md` → "Model Routing" to select the correct model for each agent launch. Tier 1 (reggie-judge, reggie-code-reviewer, reggie-security-reviewer) always Opus. Tier 2 (developers, reggie-qa-engineer, etc.) Opus default. Tier 3 (reggie-technical-writer, etc.) Sonnet acceptable.


### The Pipeline

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                                                                             │
│   PICKUP → IMPLEMENT → WRITE-TESTS → QUALITY-CHECK → SIMPLIFY              │
│                                                          ↓                  │
│                                                     VERIFY-APP              │
│                                                    ↙         ↘             │
│                                               [FAIL]         [PASS]        │
│                                                 ↓               ↓          │
│                                          Back to IMPLEMENT   REVIEW         │
│                                                            ↙      ↘        │
│                                                       [FAIL]      [PASS]   │
│                                                         ↓            ↓     │
│                                                  Back to IMPLEMENT        │
│                                                              SECURITY-REVIEW│
│                                                            ↙          ↘   │
│                                                       [FAIL]          [PASS]│
│                                                         ↓                ↓  │
│                                                  Back to IMPLEMENT  SYNC-DOCS│
│                                                                        ↓   │
│                                                                  UPDATE-CLAUDE│
│                                                                        ↓   │
│                                                               REVIEW-WITH-USER│
│                                                               ↙            ↘│
│                                                         [NEEDS WORK]  [APPROVED]│
│                                                              ↓             ↓│
│                                                       Back to IMPLEMENT  COMMIT│
│                                                                            ↓│
│                                                                    ✓ COMPLETE│
│                                                                            ↓│
│                                                                  PICKUP (next)│
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Workflow Execution

Execute each stage, waiting for completion and confirmation before proceeding. After each stage advance, rewrite `.pipeline/[slug]/STATE` with the new current stage and updated quality scores table. **Do NOT commit metadata for stage advancement** — STATE is gitignored runtime state, not TASKS.md. See reggie-code-manager.md → "Per-Task Pipeline State Files" for the STATE format and "Metadata Commit System" for the events that DO commit (pickup, files, complete, migrate-history, discovered-issues).

---

## Stage 1: PICKUP

**Migration check**: If TASKS.md contains a `## Completed` section (old format), auto-migrate those entries to `HISTORY.md` and remove the section from TASKS.md, then commit metadata: `git add TASKS.md HISTORY.md 2>/dev/null && git diff --cached --quiet || git commit -m "meta: migrate-history" --no-gpg-sign 2>/dev/null`. See reggie-code-manager.md → "TASKS.md Migration" for details.

**Key rule: never resume someone else's active task.** Active tasks in TASKS.md are assumed to be owned by another session. This session should only work on tasks it picks up fresh from the backlog or that the user explicitly specifies.

**Auto-pickup** (when `/reggie-code-workflow` is run with no arguments and no task context):
1. Look at TASKS.md: list active tasks (these belong to other sessions) and backlog
2. If backlog has items, auto-pick using priority + dependency + tier logic:
   - Scan all `- [ ]` items across all sections EXCEPT `### Ungroomed`
   - Filter out tasks with unmet dependencies (`[depends: slug]` where slug is still in backlog or active)
   - **If `--tier` is active**: Filter to tasks whose `[tier: X]` tag matches the specified tier. Tasks without a `[tier:]` tag are treated as `opus:high`. If no tasks match the tier, print "No [tier] tasks in backlog. Waiting." and exit cleanly with `~~REGGIE:DONE:reggie-code-workflow:success~~`.
   - From remaining, pick highest priority: P1 > P2 > P3 (tasks without tags = P2)
   - Within same priority, pick first in document order (top-to-bottom)
   - If ALL tasks are blocked by dependencies, warn user and ask what to do
3. **Pipeline-mode guard** (BEFORE creating any worktree or claiming the task): Read the raw TASKS.md line for the candidate slug and pattern-match the mode tag inside square brackets. If the line contains `[manual]`, `[reggie-system]`, or `[debug]`, this task does NOT belong to code-workflow. Leave the task in `## Backlog` (do not move to Active Tasks, do not create worktree, do not commit metadata), print the matching redirect below, and continue scanning the backlog for the next eligible task. If no eligible tasks remain, exit cleanly with `~~REGGIE:DONE:reggie-code-workflow:success~~`.

   - `[manual]` → print:
     ```
     Skipping [slug] — this is a [manual] task. Run:
       /reggie-manual-task [slug]
     to walk through it interactively. Manual tasks are not autonomous and
     are excluded from /reggie-code-workflow batch sweeps.
     ```
   - `[reggie-system]` → print:
     ```
     Skipping [slug] — this is a [reggie-system] task. Run:
       /reggie-system-change --yes [slug]
     to apply it through the system-change pipeline.
     ```
   - `[debug]` → print:
     ```
     Skipping [slug] — this is a [debug] task. Run:
       /reggie-debug-workflow --yes [slug]
     to investigate it through the debug pipeline.
     ```

   When a task slug is supplied as an explicit argument (`/reggie-code-workflow [slug]`) and that slug carries a non-code mode tag, do NOT silently skip — print the redirect and exit cleanly with `~~REGGIE:DONE:reggie-code-workflow:failed~~` (do not auto-pick a different task). The user clearly intended to act on that slug; auto-substitution would be surprising.

4. Print: "Picking up: [task name] [P#]. Starting IMPLEMENT stage."
5. Print active tasks as FYI: "Other active tasks: [list slugs + stages]"
6. Record base branch: `git branch --show-current`
7. Create worktree:
   ```bash
   git worktree prune
   git worktree remove --force .worktree/[slug] 2>/dev/null || true
   git branch -D task/[slug] 2>/dev/null || true
   git worktree add -b task/[slug] .worktree/[slug] [base-branch]
   ```
8. Copy untracked essentials:
   ```bash
   for f in .env .env.local .env.development.local; do
       [ -f "$f" ] && cp "$f" ".worktree/[slug]/$f"
   done
   ```
9. If project uses `node_modules/`, run install command in `.worktree/[slug]/`
10. **Context Seeding from task.md**: Create `.pipeline/[slug]/` if it doesn't exist. Seed `CONTEXT.md`:
   - **If `.pipeline/[slug]/task.md` exists** (from `/reggie-init-tasks`): Read the task.md file and write its contents into `CONTEXT.md` under `## Pre-existing Context`. The task.md contains Problem, Vision, Context, Affected Areas, Acceptance Criteria, and Implementation Plan — all preserved verbatim.
   - **If no task.md**: The task has not been planned. Print redirect message and stop:
     ```
     This task needs planning before it can enter the pipeline. Run:
       /reggie-init-tasks [task description]
     to research it against the codebase, create an implementation plan,
     then run /reggie-code-workflow to pick it up.
     ```
     Move the task back to `## Backlog` in TASKS.md and remove it from `## Active Tasks`. Clean up the worktree. Stop the pipeline for this task.
11. Ensure `.pipeline/` and `.worktree/` are in `.gitignore`
12. Add to Active Tasks in TASKS.md (include **Branch**, **Worktree**, **Base** fields)
13. Remove the picked-up task's `- [ ] slug: ...` entry from `## Backlog` in TASKS.md. Delete the entire entry including any indented `files:` or `>` context lines below it.
14. Commit metadata: `git add TASKS.md 2>/dev/null && git diff --cached --quiet || git commit -m "meta: pickup [slug]" --no-gpg-sign 2>/dev/null`
15. **Staleness Validation**: If task.md has `## Implementation Plan` with a `### Files` section, validate that referenced files still exist in the codebase:
    - For `MOD:` files: check they exist. If missing, warn: "File [path] from plan no longer exists."
    - For `NEW:` files: check they DON'T exist yet (if they do, the plan may be stale). If found, warn: "File [path] already exists — plan may be stale."
    - If any warnings: ask user to proceed (accept risk), re-plan via `/reggie-init-tasks`, or skip task.
    - If no warnings: proceed normally.
16. **Conflict Detection**: Parse the file list from the task.md `### Files` section. Compare against all other active tasks' `**Files**` lists in TASKS.md. If overlap exists, show conflict warning and ask user to choose: Proceed / Wait / Rethink / Abort. If no overlap, proceed.
17. **Skip List**: Evaluate which stages are categorically inapplicable (see reggie-code-manager.md → Skip List). Write `.pipeline/[slug]/SKIP` with stage names and reasons. If no stages should be skipped, skip this step.

**If no backlog items remain:**
```
Active tasks (owned by other sessions):
  - [slug]: [task name] (STAGE)
  - [slug]: [task name] (STAGE)

Backlog is empty. Options:
  1. Describe a new task to start
  2. Wait for an active task to complete
```

**If task specified in arguments** (`/reggie-code-workflow fix-toggle-alignment` or `/reggie-code-workflow --yes fix-toggle-alignment`):
First, check if the argument matches a slug in TASKS.md `## Backlog` (look for `- [ ] [argument]:` pattern).

- **If slug matches a backlog task**: Pick up that specific task. This is a "start here" directive — useful for guaranteeing which task this session grabs when multiple code-workflows run in parallel. After completing this task, normal behavior resumes: in `--yes` mode, continue the loop picking up remaining tasks; in normal mode, ask "Pick up the next task?". The slug only controls which task is picked up FIRST — it does not limit the session to a single task.

- **If slug does NOT match any backlog task**: Treat as a new task description. Redirect the user:
```
This task needs refinement before entering the pipeline. Run:
  /reggie-init-tasks [task description]
to refine it with codebase context and acceptance criteria, then
run /reggie-code-workflow to pick it up from the backlog.
```

**Resuming your own task** (after context compaction or `/reggie-code-workflow resume [slug]`):
- Only resume a specific task if the user explicitly names it
- Verify worktree exists; if missing, recreate from branch: `git worktree add .worktree/[slug] task/[slug]`
- Read `.pipeline/[slug]/CONTEXT.md` and `.pipeline/[slug]/HANDOFF.md` to restore context
- Continue from the stage recorded in `.pipeline/[slug]/STATE` (the `CURRENT:` line)

Use **reggie-code-manager** agent to manage TASKS.md.

**IMPORTANT**: After creating `.pipeline/[slug]/` and `.worktree/[slug]/`, ensure both `.pipeline/` and `.worktree/` are in `.gitignore`.

### Agent Working Directory

When launching any code-modifying agent (IMPLEMENT, WRITE-TESTS, SIMPLIFY, VERIFY-APP, etc.), always include in the prompt:

> "The project root for this task is: `[absolute path to .worktree/[slug]]`. All file reads, writes, and bash commands must operate in this directory."

Agents that only manage pipeline metadata (reggie-judge, reggie-code-manager) operate from the main repo root. The `.pipeline/[slug]/CONTEXT.md` is always read/written from the main repo root.

### Skip Handling

Before launching any stage agent, check `.pipeline/[slug]/SKIP`. If the current stage is listed, record `SKIP` in the quality scores table, print `⊘ [STAGE] — skipped ([reason])`, and advance to the next stage. Progress markers: `✓ = passed, ● = current, ○ = upcoming, ⊘ = skipped`.

---

## Stage 2: IMPLEMENT

```
## Implementation Phase

[Use appropriate dev agent: **reggie-ios-developer**, **reggie-android-developer**, **reggie-web-developer**, **reggie-typescript-developer**, **reggie-go-developer**, **reggie-python-developer**, **reggie-cloud-engineer**, or **reggie-firebase-debugger**]

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

## Stage 3: WRITE-TESTS

```
## Testing Phase

[Use **reggie-qa-engineer** agent]

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

## Stage 4: QUALITY-CHECK

```
## Quality Check Phase

[Use **reggie-qa-engineer** agent]

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

## Stage 5: SIMPLIFY

```
## Simplification Phase

[Use **reggie-refactorer** agent]

Cleaning up implementation...
```

After simplification:
```
Simplification complete:
- [Changes made]

Ready to verify? (y/n)
```

---

## Stage 6: VERIFY-APP

```
## Verification Phase

[Use **reggie-app-tester** agent]

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
1. Back to IMPLEMENT (fix the code)
2. Re-plan via /reggie-init-tasks (rethink approach entirely)
```

Loop back to selected stage.

---

## Stage 7: REVIEW

```
## Code Review Phase

[Use **reggie-code-reviewer** agent]

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

Going back to IMPLEMENT to address blockers.
```

---

## Stage 8: SECURITY-REVIEW

```
## Security Review Phase

[Use **reggie-security-reviewer** agent]

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

## Stage 9: SYNC-DOCS

```
## Documentation Sync Phase

[Use **reggie-technical-writer** agent]

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

## Stage 10: UPDATE-CLAUDE

```
## Learning Capture Phase

Any learnings from this task to add to CLAUDE.md?

- Mistakes to avoid next time?
- Patterns that worked well?
- Gotchas discovered?

[Add to CLAUDE.md or skip if none]
```

---

## Stage 10.5: REVIEW-WITH-USER

Walk the user through what was built, mapped to each acceptance criterion from the task. This is a human gate — no reggie-judge scoring.

**Skip condition**: If the task has no acceptance criteria (legacy format without enriched `>` blocks), auto-skip: `⊘ REVIEW-WITH-USER — skipped (no acceptance criteria found)`.

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

## Stage 10.7: CAPTURE-LEARNINGS

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
- Did the task.md plan from /reggie-init-tasks survive implementation, or did the developer deviate significantly?
- Did tests catch real issues, or were they superficial?
- Did the reggie-refactorer actually simplify, or just rearrange?
- Did reviews (code + security) catch things that earlier stages should have prevented?
- Was the task.md plan detailed enough, or did the implementer struggle with missing context?

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
│ AUTO-IMPROVE (code-workflow)                                      │
│                                                                  │
│ Entries found: [N]                                               │
│ Threshold: 3                                                     │
│ Action: [skipped — no entries | deferred — below threshold |     │
│          ran — N minor applied, N major deferred]                │
└──────────────────────────────────────────────────────────────────┘
```

---

## Stage 11: COMMIT

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

[Use **reggie-technical-writer** agent for commit message]

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

## Stage 12: COMPLETE & NEXT

**Actions to perform (not just display — actually do these):**

1. Final commit in worktree (if uncommitted changes remain)
2. **Remove the slug's line from TASKS.md** and any indented continuation lines beneath it (`files: ...`, `> ...`, until the next blank line or next task line). Also remove the `### [slug]` section from `## Active Tasks` if present. The slug's row must be deleted, not toggled to `[x]` — `meta: complete` is a true migration from TASKS.md to HISTORY.md.
3. Append to `HISTORY.md` (same directory as TASKS.md): `- [x] [slug] [task name] -- [date]`. Create the file with a `# Completed Tasks` header if it doesn't exist.
4. Commit metadata: `git add TASKS.md HISTORY.md 2>/dev/null && git diff --cached --quiet || git commit -m "meta: complete [slug]" --no-gpg-sign 2>/dev/null`
5. **CRITICAL: `cd` to the repo root first** — the shell may be sitting in the worktree directory that is about to be removed. Run `cd [repo-root]` (use the known project root path) before any worktree removal. If `cd` fails, the shell CWD is already invalid — start a fresh shell.
6. Ask user for merge strategy. **Always merge/push BEFORE removing the worktree, never after.**
   - **Local merge** (recommended for solo work): Squash merge into a single well-written commit, then remove worktree
     ```bash
     cd [repo-root]
     git merge --squash task/[slug]
     # Read branch commits to compose message:
     git log [base-branch]..task/[slug] --pretty=format:"%s%n%b" --reverse
     # Synthesize a single conventional commit (feat:/fix:/refactor: + concise summary)
     # with 2-5 body bullets covering key changes (strip stage prefixes like implement:/test:)
     # See reggie-code-manager.md "Composing the Squash Commit Message" for full details
     git commit -m "$(cat <<'EOF'
     [summary line, e.g. feat: add streak tracking with daily reset logic]

     - [key change 1]
     - [key change 2]
     - [key change 3]
     EOF
     )"
     git worktree remove --force .worktree/[slug]
     git worktree prune
     git branch -D task/[slug]
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
8. **Run `rm -rf .pipeline/[slug]/`** to delete the task's pipeline directory (this removes task.md, CONTEXT.md, SERVERS file, and all other pipeline artifacts for this task)
9. Show remaining active tasks + backlog

```
Task complete: [task name] ([slug])
Merge strategy: [local merge / PR / push only]

Cleaned up:
  - Worktree .worktree/[slug]/ removed
  - Branch task/[slug] [merged+deleted / pushed / pushed]
  - Pipeline directory .pipeline/[slug]/ deleted (including task.md)

Active tasks: [list remaining active tasks, if any]
Backlog ([X] tasks remaining):
- [ ] [Task 1]
- [ ] [Task 2]
```

**Next task behavior depends on mode:**

- **Normal mode**: Ask "Pick up the next task? (y/n)". If yes, loop back to Stage 1 with new task. If no (or no tasks remain), emit:
  ```
  ~~REGGIE:DONE:reggie-code-workflow:success~~
  ```
- **`--yes` mode**: After successful completion of the task, emit the standard DONE marker and exit. Do **not** loop back to PICKUP, do **not** run `/compact`, do **not** pick up another backlog task in the same session. The Reggie UI handles task-to-task relaunch when the session was launched via per-repo or Batch Start (it detects the DONE marker and starts the next task in a fresh session). Emit:
  ```
  ~~REGGIE:DONE:reggie-code-workflow:success~~
  ```

If the user says `abort` at any stage, emit:

```
~~REGGIE:DONE:reggie-code-workflow:failed~~
```

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

TASKS.md under `## Active Tasks` carries only static fields set once at PICKUP — the runtime stage, attempts counter, and quality scores table do NOT live here:

```markdown
## Active Tasks

### add-streak-tracking
**Task**: Add streak tracking
**Pipeline**: code-workflow
**Branch**: task/add-streak-tracking
**Worktree**: .worktree/add-streak-tracking
**Base**: main
**Started**: 2026-02-05
**Files**:
- NEW: src/services/StreakManager.swift
- MOD: src/models/UserProgress.swift
```

Runtime stage state lives in `.pipeline/add-streak-tracking/STATE` (gitignored, plain text):

```
CURRENT: VERIFY-APP

| Stage | Score | Attempts | Status |
|-------|-------|----------|--------|
| IMPLEMENT | 9.3 | 1 | PASS |
| VERIFY-APP | - | 0 | CURRENT |
```

Pipeline context lives in `.pipeline/add-streak-tracking/CONTEXT.md`.
Code changes live in `.worktree/add-streak-tracking/` (branch `task/add-streak-tracking`).

If verification/review fails, increment the Attempts column in STATE — TASKS.md is not touched.

**Metadata commits**: Edits to TASKS.md or HISTORY.md are immediately committed on the base branch with a `meta:` prefix (e.g., `meta: pickup [slug]`, `meta: files [slug]`, `meta: complete [slug]`). This prevents stash conflicts when multiple sessions edit metadata in parallel. **Per-stage advancement does not emit a metadata commit** — STATE is runtime-only and never written to TASKS.md. See reggie-code-manager.md → "Metadata Commit System" for the full event list and "Per-Task Pipeline State Files" for STATE format.

---

## Starting the Workflow

```
/reggie-code-workflow                    # Start/continue workflow (picks from backlog)
/reggie-code-workflow --opus             # Force Opus for all agents (no Sonnet overrides)
/reggie-code-workflow --yes              # Auto-approve all in-session confirmation gates
/reggie-code-workflow status             # Show current workflow state
/reggie-code-workflow pause              # Pause and save progress
/reggie-code-workflow resume [slug]      # Resume paused workflow
/reggie-code-workflow --opus resume [slug]  # Resume with all-opus mode
/reggie-code-workflow --yes --tier opus:high           # Auto-approve gates, pick first opus:high task
/reggie-code-workflow --yes --tier sonnet:medium        # Auto-approve gates, pick first sonnet:medium task
/reggie-code-workflow --yes fix-toggle-alignment        # Run this slug to completion, auto-approving gates
/reggie-code-workflow --yes --tier opus:high fix-auth   # Run fix-auth (tier-tagged) to completion, auto-approving gates
```

### Flags

| Flag | Effect |
|------|--------|
| `--opus` | Force `model: "opus"` on every agent launch. Disables Sonnet optimizations for the entire pipeline run. Use for critical tasks or when Sonnet quality has been insufficient. |
| `--yes` | Skip all confirmation gates. Pipeline runs end-to-end without user input. Automated quality gates (9.0/10) still run. |
| `--tier <model:effort>` | Filter backlog pickup to tasks matching this tier (`opus:high`, `opus:medium`, `sonnet:medium`). Untagged tasks default to `opus:high`. Exits cleanly when no matching tasks remain. Enables parallel execution across terminals at different tiers. |

**Note**: All tasks must go through `/reggie-init-tasks` first for codebase research, acceptance criteria, and implementation planning. Tasks without a `task.md` file will be rejected with a redirect to `/reggie-init-tasks`.

---

## Example Session

```
> /reggie-code-workflow

Picking up from backlog: implement-streak-system [P1]
  "Build streak tracking for user retention"
  Acceptance criteria: 5 items
  Implementation plan: yes (from /reggie-init-tasks)

Other active tasks: fix-color-rendering (IMPLEMENT)
Starting IMPLEMENT stage.

... [IMPLEMENT, WRITE-TESTS, etc. proceed normally] ...

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
│  PICKUP → IMPLEMENT → WRITE-TESTS → QUALITY-CHECK               │
│    ✓         ✓            ✓              ✓                       │
│                                                                  │
│  → SIMPLIFY → VERIFY-APP → REVIEW → SECURITY-REVIEW             │
│       ✓           ✓          ✓           ✓                       │
│                                                                  │
│  → SYNC-DOCS → UPDATE-CLAUDE → REVIEW-WITH-USER                 │
│       ✓             ✓               ✓                            │
│                                                                  │
│  → COMMIT → COMPLETE                                             │
│      ✓         ✓                                                 │
│                                                                  │
├──────────────────────────────────────────────────────────────────┤
│ All scores:                                                      │
│   IMPLEMENT: 9.3  WRITE-TESTS: 9.0  QUALITY-CHECK: 9.2          │
│   SIMPLIFY: 9.4  VERIFY-APP: 9.1                                │
│   REVIEW: 9.0  SECURITY-REVIEW: 9.5                             │
│   SYNC-DOCS: 9.2  REVIEW-WITH-USER: APPROVED                    │
│                                                                  │
│ Commits: 12 checkpoints                                          │
│ Status: Push-ready                                               │
└──────────────────────────────────────────────────────────────────┘

Pick up next task? (y)
```

