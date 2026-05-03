---
type: pipeline
---

# Manual Task

Walk the user interactively through a `[manual]` task — a task that cannot be done autonomously by Claude because it requires the user to act in the physical world or in an external system (rotate a credential in a vendor console, install software, take a photo, sign a document, configure something in a third-party UI).

## Context

```bash
SLUG="$1"
echo "=== Manual Task: ${SLUG:-<no slug>} ==="

if [ -z "$SLUG" ]; then
  echo "ERROR: no slug provided"
  exit 0
fi

echo ""
echo "=== TASKS.md entry ==="
if [ -f "TASKS.md" ]; then
  grep -n "$SLUG" TASKS.md | head -5 || echo "Slug not found in TASKS.md"
else
  echo "No TASKS.md"
fi

echo ""
echo "=== Task file ==="
TASK_FILE=".pipeline/${SLUG}/task.md"
if [ -f "$TASK_FILE" ]; then
  echo "Found: $TASK_FILE"
  wc -l "$TASK_FILE"
else
  echo "Missing: $TASK_FILE"
fi
```

## Instructions

You (the main Claude) run this command directly. There are no subagents — manual tasks are interactive walkthroughs between you and the user. The whole point is that Claude cannot do this work autonomously; the user must.

**`--yes` flag (Ralph Wiggum mode)**: If `$ARGUMENTS` contains `--yes`, strip it from arguments. In manual-task mode, `--yes` only suppresses confirmation between criteria (auto-advances after the user marks each one done) — it does NOT skip the criteria themselves. The user must still report on each acceptance criterion. Manual tasks are inherently human-gated; `--yes` cannot bypass that.

### Arguments

```
/reggie-manual-task <slug>           # Walk through .pipeline/<slug>/task.md interactively
/reggie-manual-task --yes <slug>     # Same, but auto-advance after each "done" answer
$ARGUMENTS
```

If no slug is provided, print:
```
Usage: /reggie-manual-task <slug>

Available [manual] tasks in TASKS.md backlog:
  - [list slugs whose line contains [manual]]
```
Then exit cleanly with `~~REGGIE:DONE:reggie-manual-task:failed~~`.

### Stage 1: Validate slug + mode

1. **Slug presence**: Confirm `.pipeline/<slug>/task.md` exists. If missing, print:
   ```
   No task file found at .pipeline/<slug>/task.md.
   Has this task been refined yet? Run:
     /reggie-init-tasks
   to refine the backlog into task files.
   ```
   Exit with `~~REGGIE:DONE:reggie-manual-task:failed~~`.

2. **Cross-pipeline guard**: Read the slug's line in TASKS.md and pattern-match the mode tag inside square brackets. If the line does NOT contain `[manual]`, print the matching redirect and exit:
   - Contains `[code]` or `[design]` → redirect to `/reggie-code-workflow [slug]`.
   - Contains `[reggie-system]` → redirect to `/reggie-system-change --yes [slug]`.
   - Contains `[debug]` → redirect to `/reggie-debug-workflow --yes [slug]`.
   - No mode tag at all → print "Slug [slug] has no pipeline-mode tag — only [manual] tasks can run here. Add `[manual]` to the TASKS.md line, or run `/reggie-init-tasks` to refine."
   - Slug not in TASKS.md → print "Slug [slug] not found in TASKS.md backlog." and exit.

   Exit cleanly with `~~REGGIE:DONE:reggie-manual-task:failed~~` for any redirect.

### Stage 2: Read task.md and present overview

1. Read `.pipeline/<slug>/task.md` in full.
2. Extract the `## Acceptance Criteria` section (the bullet list under that heading). If the section is missing or empty, print "Task <slug> has no acceptance criteria — nothing to walk. Edit task.md to add them, or mark the task done manually." and exit cleanly with `~~REGGIE:DONE:reggie-manual-task:failed~~`.
3. Print an overview:

   ```
   ## Manual Task: <slug>

   <one-line description from task.md>

   ### Why this is manual
   <Read the Problem / Vision / Context sections from task.md and summarize in 1-2 sentences why this can't be done autonomously by Claude.>

   ### Acceptance criteria (N items)
   1. [criterion 1]
   2. [criterion 2]
   ...

   I'll walk you through each one. For each, you'll have three options:
     done    — you completed it
     skip    — leave it unchecked, move on
     stop    — pause the walkthrough (task stays open in TASKS.md)

   Ready? (y to start, or "stop" to exit)
   ```

4. Wait for user confirmation. If they answer "stop" or anything other than affirmative, exit cleanly with `~~REGGIE:DONE:reggie-manual-task:stopped~~`.

### Stage 3: Walk acceptance criteria

For each criterion, in order:

1. Print:
   ```
   ## Criterion <i> of <N>

   <criterion text>

   <If task.md provides additional context for this criterion (sub-bullets, links, instructions), include it verbatim here.>

   done? / skip? / stop?
   ```

2. Wait for user response.
   - **done**: Record as satisfied, advance. If `--yes` is active, advance immediately; otherwise prompt "Next criterion? (y)" and wait.
   - **skip**: Record as skipped (don't fail the task — skipped criteria are noted in the summary), advance.
   - **stop**: Stop the walkthrough. Print a partial summary of what's been done so far, leave the task in TASKS.md unchanged (still `[ ]`), and exit cleanly with `~~REGGIE:DONE:reggie-manual-task:stopped~~`.
   - **status**: Print progress summary ("N of M criteria: X done, Y skipped, Z remaining") then re-show the current criterion prompt.
   - **back**: Decrement the criterion index and re-show the previous criterion (so the user can amend a done/skip choice). If already on criterion 1, print "Already at first criterion." and re-show it.

3. If the user provides a free-text answer instead of one of the three keywords, treat it as additional notes about the criterion, ask "Counting that as done? (y/skip/stop)", and route accordingly.

### Stage 4: Completion

After all criteria are walked:

1. Print a summary:
   ```
   ## Manual Task Complete: <slug>

   Criteria summary:
     - [done]    [criterion 1]
     - [done]    [criterion 2]
     - [skipped] [criterion 3]
     - [done]    [criterion 4]

   Result: <N>/<M> criteria satisfied.
   ```

2. **Decide completion state**:
   - If at least one criterion was marked **done** AND no criteria are still pending (every criterion was answered): migrate the task from TASKS.md to HISTORY.md.
   - If ALL criteria were skipped: do NOT migrate — print "All criteria skipped — leaving task open." and exit with `~~REGGIE:DONE:reggie-manual-task:stopped~~`.
   - Edge case: ask the user "Mark task as complete in TASKS.md? (y/n)" if there's any ambiguity (e.g., mixed done/skip results that may or may not satisfy the task's intent).

3. **Migrate from TASKS.md to HISTORY.md**: Use the standard meta-commit pattern from `~/.claude/agents/reggie-code-manager.md` → "Metadata Commit System". Specifically:
   - **Remove the slug's line from TASKS.md** and any indented `files: ...` / `> ...` continuation lines beneath it (until the next blank line or next task line). The slug's row must be deleted, not toggled to `[x]` — this is a true migration, matching how code-workflow's COMPLETE step handles it.
   - Append to `HISTORY.md`: `- [x] <slug>: <description> -- manual, completed [today's date]`. Create HISTORY.md with a `# Completed Tasks` header if it doesn't exist.
   - Commit metadata: `git add TASKS.md HISTORY.md 2>/dev/null && git diff --cached --quiet || git commit -m "meta: complete <slug> (manual)" --no-gpg-sign 2>/dev/null`.

4. **Clean up `.pipeline/<slug>/`**: Delete the directory: `rm -rf .pipeline/<slug>/`. The task.md is consumed at completion just like code-workflow does.

5. Emit the completion marker:
   ```
   ~~REGGIE:DONE:reggie-manual-task:success~~
   ```

### No auto-continue

Manual tasks NEVER auto-continue to the next `[manual]` slug, even with `--yes`. Manual work requires the user to be present and engaged; chaining manual sessions without a break would defeat the point. After completion, the user can run `/reggie-manual-task <next-slug>` themselves when they're ready.

### Workflow Controls

| Command | Action |
|---------|--------|
| `done` | Mark current criterion as satisfied, advance |
| `skip` | Mark current criterion as skipped, advance |
| `stop` | Pause walkthrough; task stays open in TASKS.md |
| `status` | Show progress through criteria (e.g., "3 of 7 done") |
| `back` | Re-show the previous criterion (in case the user wants to amend) |

### Failure markers

- `~~REGGIE:DONE:reggie-manual-task:success~~` — walkthrough completed and task marked `[x]`.
- `~~REGGIE:DONE:reggie-manual-task:stopped~~` — user stopped mid-walkthrough; task remains open.
- `~~REGGIE:DONE:reggie-manual-task:failed~~` — guard rejection (wrong mode, missing slug, missing task.md, missing acceptance criteria).
