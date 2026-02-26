# Initialize Tasks

Refine loosely-formed tasks into a structured TASKS.md with rich, implementation-ready descriptions and grouped areas of focus.

## Context

```bash
echo "=== Checking for existing TASKS.md ==="
if [ -f "TASKS.md" ]; then
  echo "TASKS.md already exists:"
  cat TASKS.md
else
  echo "No TASKS.md found — ready to create one"
fi

echo ""
echo "=== Checking for HISTORY.md ==="
if [ -f "HISTORY.md" ]; then
  echo "HISTORY.md exists:"
  wc -l HISTORY.md
else
  echo "No HISTORY.md found"
fi

echo ""
echo "=== Project Context ==="
pwd
if [ -f "CLAUDE.md" ]; then
  echo ""
  echo "=== From CLAUDE.md ==="
  head -40 CLAUDE.md
fi
if [ -f "package.json" ]; then
  echo ""
  echo "=== From package.json ==="
  cat package.json | grep -E '"name"|"description"' | head -2
fi
if [ -f "go.mod" ]; then
  echo ""
  echo "=== From go.mod ==="
  head -3 go.mod
fi

echo ""
echo "=== Project Structure ==="
ls -1 | head -30
```

## Instructions

This command takes a loose task list, iteratively refines each task with codebase-aware dialogue, and writes a structured TASKS.md with rich descriptions, acceptance criteria, and grouped areas of focus.

**IMPORTANT**: You (the main Claude) run this directly. Subagent calls: **researcher** during DEEPEN (codebase exploration per task), **code-architect** during ORGANIZE (section assignment). All other phases are handled by you. When launching any agent via Task, only use `model: "opus"` or `model: "sonnet"` — never `model: "haiku"`.

### Two Modes

**Organize mode** — `$ARGUMENTS` contains task descriptions:
Skip brain dump, go straight to INTAKE with the provided input.

**Brain dump mode** — `$ARGUMENTS` is empty and no TASKS.md exists:
Start with conversational exploration, then flow into INTAKE.

### If TASKS.md Already Exists

First, count items under `### Ungroomed` in TASKS.md (if the section exists). Then ask:

```
You already have a TASKS.md. Want to:
1. Add more tasks (I'll merge new items into existing sections)
2. Reorganize everything (I'll regroup all backlog items)
3. Start fresh (I'll archive current backlog to HISTORY.md)
```

If `### Ungroomed` has items, append an additional option:
```
4. Refine [N] ungroomed items (discovered issues waiting for triage)
```

If user picks option 4, extract all items from `### Ungroomed` and feed them into INTAKE as the raw input. The user can also add new items alongside them during INTAKE.

### Migration Check

If TASKS.md contains a `## Completed` section (old format), auto-migrate those entries to `HISTORY.md` and remove the section before proceeding.

---

## Brain Dump (when no input and no TASKS.md)

Start conversationally:

```
Let's figure out what needs to be done on this project.

Dump whatever's on your mind — features you want to build,
bugs that need fixing, ideas you've been kicking around,
things you know you're forgetting...

Don't worry about order or format. We'll sort it all out.
```

Help them get everything out:
- Get everything out of their head before organizing anything
- Identify what's actually a task vs. a thought vs. a question
- Find hidden tasks ("you mentioned X — does that need work?")
- Surface things they might be forgetting ("testing? deployment? docs?")

Keep it conversational. Ask follow-up questions. Don't rush to structure.

When the dump feels complete:
```
Okay, I think we've got everything. Let me pull out the
actionable items and we'll get them organized.
```

Then proceed to INTAKE with all items from the conversation.

---

## Phase 1: INTAKE

Parse the raw input (from `$ARGUMENTS`, pasted text, or brain dump) into discrete task items.

**Ungroomed items**: If the input includes items pulled from `### Ungroomed` (option 4 above), parse them the same as any other input. They already have slug and description from when they were discovered — preserve those but still run them through CLARIFY and DEEPEN like any other item. Strip the `> context` lines and use them as starting context for DEEPEN.

For each item, extract:
- **What**: The task (concrete action)
- **Slug**: kebab-case identifier (lowercase, hyphens, strip non-alphanumeric)
- **Vague?**: Flag items too vague to act on

Rules:
- Split compound items ("fix the bug and add the feature" -> 2 items)
- Promote implied tasks ("I should probably add tests" -> explicit task)
- Discard non-tasks ("I wonder if..." -> not a task unless confirmed)
- Generate slugs: "Add JWT authentication" -> `add-jwt-auth`

Present the parsed list:

```
I found [N] tasks:

1. add-jwt-auth: Add JWT authentication to login endpoint
2. fix-responsive-layout: Fix responsive layout on dashboard cards
3. migrate-csv-parser: Migrate CSV ingestion to streaming parser
4. ??? "make the backend better" — needs clarification

Anything missing? Anything I misunderstood?
```

Wait for user confirmation before proceeding.

---

## Phase 2: CLARIFY

For items flagged as vague, ask targeted clarification questions. **Batch all questions into a single message** — do NOT ask one at a time.

```
A few items need clarification:

1. "Make the backend better" — What specifically? Performance?
   Error handling? Code organization?

2. "Deal with the auth stuff" — Adding new auth, fixing existing,
   or migrating providers?
```

After answers:
- Convert vague items into concrete tasks with slugs
- If answers reveal sub-tasks, split them
- If user says "skip it", drop the item

If no items were vague, skip this phase:
```
All items are clear. Moving to task refinement...
```

---

## Phase 3: DEEPEN

Iteratively refine each task with codebase-aware exploration and user dialogue. This phase transforms thin task descriptions into rich, implementation-ready entries with acceptance criteria.

**DEEPEN always runs** — even after brain dump mode. Brain dump captures intent; DEEPEN validates it against the codebase and adds precision.

### Step 1: Smart Grouping

Before refining individual tasks, scan the full task list for clusters of related tasks that share the same area (same screen, same module, same file set). When found, propose bundling:

```
I noticed these tasks all touch the same area (Settings screen):

  - fix-toggle-alignment: Fix toggle alignment in settings
  - adjust-section-spacing: Adjust section spacing in settings
  - increase-back-button: Increase back button tap target

Want to bundle these into a single task?
  Proposed: "polish-settings-screen: Polish settings screen UI"
  with the originals as sub-items?

(y/n/customize)
```

Rules:
- Propose grouping when 3+ tasks share the same area
- 2 related tasks: mention the relationship but don't force grouping
- User must approve every grouping proposal — "no" is valid
- If approved, merged tasks get a new parent slug and the originals become sub-items
- If rejected, keep tasks separate and refine individually
- Run smart grouping once at the start of DEEPEN, before per-task refinement

### Step 2: Per-Task Refinement

For each task (or grouped task), iterate through this cycle:

**a) Codebase exploration** — Launch the **researcher** agent with a targeted prompt:

```
## Quick Codebase Exploration for Task Refinement

Task: [task description]
[If grouped: Sub-items: [list sub-items]]

Explore the codebase to understand:
1. What files/modules does this task likely touch?
2. What existing patterns or conventions are relevant?
3. Are there related areas that might be affected?
4. What's the approximate complexity?

Return a brief (10-15 line) summary with:
- Affected files/directories
- Relevant patterns found
- Complexity notes
- Any risks or dependencies spotted

Keep it lightweight — this is for task refinement, not full research.
```

**Efficiency shortcut**: For clearly trivial tasks (typo fix, config change, one-liner), skip the researcher call. Main Claude can do a quick `Grep` or `Read` directly. The enriched format still applies but Problem/Vision sections can be brief.

**b) Code-informed questions** — Based on the researcher's findings, ask the user targeted questions grounded in actual code. These are NOT generic questions:

```
Based on what I found in the codebase:

1. The settings screen uses SettingsRow components — should the
   toggle alignment fix apply to all SettingsRow instances or
   just the notification preferences section?

2. I see two spacing constants: SECTION_GAP (24px) and
   ITEM_GAP (8px). The dashboard uses 16px between sections.
   Should settings match the dashboard's 16px?

3. The back button is currently a NavigationButton with no
   explicit frame. Want to use .frame(minWidth:minHeight:) or
   increase the padding?
```

Ask questions in batches. Focus on things the codebase revealed that the user likely hasn't thought about — specific constants, existing patterns, related components that would need to change.

**c) Build enriched description** — From the user's answers + researcher findings, construct the enriched task:

```
Here's the refined task:

polish-settings-screen: Polish settings screen UI [P2]

  ## Problem
  The settings screen feels unfinished — toggles don't align with
  each other, section spacing is inconsistent, and the back button
  is hard to tap. Overall it doesn't match the polish level of the
  rest of the app.

  ## Vision
  Settings should feel as tight as the main dashboard. Clean
  alignment, consistent rhythm between sections, comfortable tap
  targets throughout.

  ## Context
  Part of a broader pre-launch polish pass. Dashboard already
  cleaned up — settings should match that standard. Design tokens
  are in theme.ts. SettingsRow components are reused across all
  settings sections.

  ## Affected Areas
  src/screens/Settings/, src/components/SettingsRow, theme.ts

  ## Sub-items
  - Fix toggle alignment in notification preferences
  - Adjust section header spacing to match dashboard sections (16px)
  - Increase back button tap target to 44px minimum

  ## Acceptance Criteria
  - All toggles left-edge aligned within their rows
  - Consistent 16px spacing between section groups
  - Back button passes minimum 44pt tap target
  - Visual consistency with dashboard screen's polish level
```

**d) User approval gate** — Present the enriched task and ask:

```
Is this task refined enough? (approve / edit / dig deeper)
```

- **approve** — Task is locked, move to next task
- **edit** — User provides corrections, Claude revises and re-presents
- **dig deeper** — Run another researcher pass on a specific aspect the user wants to explore

### Step 3: Batch Approval for Simple Tasks

If remaining tasks are clearly simple and the user is moving fast, offer batch mode:

```
The remaining 4 tasks look straightforward. Want to:
1. Review each one individually
2. Let me refine them all and present as a batch for approval
```

If batch mode: refine all remaining tasks, present as a list, user approves/edits the batch.

### Transition

After all tasks are approved:
```
All [N] tasks refined with acceptance criteria.
Moving to organization...
```

---

## Phase 4: ORGANIZE

Launch **code-architect** agent to assign refined tasks to areas of focus and prioritize them.

**IMPORTANT**: ORGANIZE does NOT modify task descriptions, sub-items, or acceptance criteria. Tasks are already fully refined from DEEPEN. ORGANIZE only handles section assignment, priority ordering, and dependency flagging.

**Prompt for code-architect:**

```
## Task: Assign refined tasks to areas of focus and prioritize

These tasks are already refined with full descriptions. Your job is to
organize them, not modify them.

### The Tasks

[paste full list of refined task slugs and one-line descriptions]

### Your Job

1. **Explore the codebase** — understand project structure, modules,
   technology boundaries, feature areas

2. **Assign tasks to areas of focus** (2-6 sections) based on actual
   project structure:

   GOOD groupings (project-specific):
   - "Authentication & Sessions" (maps to src/auth/)
   - "Data Pipeline" (maps to services/ingestion/)

   BAD groupings (generic):
   - "Backend" (too broad)
   - "Improvements" (meaningless)
   - "Nice to Have" (that's priority, not area)

3. **Assign priority tags** to each task:
   - `[P1]` — blocking, critical, or foundational (other tasks depend on it)
   - `[P2]` — standard work (default — most tasks are P2)
   - `[P3]` — nice-to-have, low urgency
   Default to P2 unless there's a clear reason for P1 or P3.

4. **Map dependencies thoroughly**: For each task, determine if it depends
   on other tasks:
   - Does task A need to complete before task B can start?
   - Would task A's changes create the foundation task B builds on?
   - Are there shared files or modules that create ordering constraints?
   Only flag real dependencies — not every task in the same area depends
   on the others. Add `[depends: slug-a]` (or `[depends: slug-a, slug-b]`
   for multiple) to dependent tasks.

5. **Check for staleness**: Flag tasks that may be stale:
   - References files that no longer exist in the project
   - Describes fixing something that appears already fixed (check completed
     tasks in HISTORY.md if provided)
   - Duplicates or near-duplicates of other tasks
   - Superseded by completed work
   Mark stale tasks with `[STALE: reason]` so the user can confirm removal.

6. **Order groups by priority** — first group is highest priority.

7. **Order tasks within each group** by priority then dependency order.

8. **Handle singles**: If only 1 task fits a group, put it in "Other"
   at the bottom. Every group needs at least 2 items.

### Output Format

Return ONLY the grouped list with slugs and one-line descriptions:

### [Area of Focus 1]
- [slug]: [One-line description] [P1]
- [slug]: [One-line description] [P2] [depends: slug-above]

### [Area of Focus 2]
- [slug]: [One-line description] [P2]

### Other
- [slug]: [One-line description] [P3]
```

**If merging into existing TASKS.md**, add to the prompt:
```
These sections already exist in the backlog: [list section names].
Assign new items to existing sections where they fit. Create new
sections only if no existing section is appropriate.
Do not reorganize existing items.

Completed tasks (for staleness checking):
[paste last 20 entries from HISTORY.md, or "No HISTORY.md found"]
```

After code-architect returns, present the grouping:

```
Here's how I'd organize these based on your project structure:

### Authentication & Security
- add-jwt-auth: Add JWT authentication to login endpoint [P1]
- implement-rbac: Implement role-based access control [P2] [depends: add-jwt-auth]

### Settings & UI Polish
- polish-settings-screen: Polish settings screen UI [P2]

### Data Pipeline
- migrate-csv-parser: Migrate CSV ingestion to streaming parser [P2]

Does this grouping make sense? Want to move anything or rename a section?
```

Wait for user approval or adjustments.

**Staleness review**: If the architect flagged any tasks as `[STALE: reason]`, present them:
```
These tasks may be stale:
- [slug]: [reason]
- [slug]: [reason]

Remove them? (yes all / review individually / keep all)
```
Approved stale items are moved to HISTORY.md as `- [~] slug: description -- pruned [date]`.

**Ungroomed movement**: If any of the organized tasks came from `### Ungroomed`, they are now in their proper `### Section`. After writing TASKS.md in FORMALIZE, verify that `### Ungroomed` no longer contains any items that were processed. Items the user chose NOT to refine remain in `### Ungroomed`.

---

## Phase 5: FORMALIZE

Write the approved structure into TASKS.md using the enriched task format.

### Enriched Task Format

Each task is written with the full `>` context block containing all sections from DEEPEN:

```markdown
- [ ] polish-settings-screen: Polish settings screen UI [P2]
  > ## Problem
  > The settings screen feels unfinished — toggles don't align with
  > each other, section spacing is inconsistent, and the back button
  > is hard to tap.
  >
  > ## Vision
  > Settings should feel as tight as the main dashboard. Clean
  > alignment, consistent rhythm between sections, comfortable tap
  > targets throughout.
  >
  > ## Context
  > Part of a broader pre-launch polish pass. Dashboard already
  > cleaned up — settings should match that standard.
  >
  > ## Affected Areas
  > src/screens/Settings/, src/components/SettingsRow, theme.ts
  >
  > ## Sub-items
  > - Fix toggle alignment in notification preferences
  > - Adjust section header spacing to match dashboard sections (16px)
  > - Increase back button tap target to 44px minimum
  >
  > ## Acceptance Criteria
  > - All toggles left-edge aligned within their rows
  > - Consistent 16px spacing between section groups
  > - Back button passes minimum 44pt tap target
  > - Visual consistency with dashboard screen's polish level
```

**Indentation rule**: The `>` blocks must be indented with exactly 2 spaces under the `- [ ]` line to be parsed correctly by PICKUP context seeding.

### New TASKS.md

```markdown
# Tasks

## Active Tasks

---

## Backlog

### [Area of Focus 1]
- [ ] [slug]: [Description] [P1]
  > ## Problem
  > [problem text]
  >
  > ## Vision
  > [vision text]
  >
  > ## Context
  > [context text]
  >
  > ## Affected Areas
  > [file paths]
  >
  > ## Sub-items
  > - [sub-item 1]
  > - [sub-item 2]
  >
  > ## Acceptance Criteria
  > - [criterion 1]
  > - [criterion 2]

- [ ] [slug]: [Description] [P2] [depends: slug]
  > ## Problem
  > [problem text]
  > ...
```

### Merging into Existing TASKS.md

- Preserve everything under `## Active Tasks` exactly as-is
- New items merge into existing sections (append to bottom of matching section)
- New sections are inserted in priority order relative to existing sections
- Existing backlog items are NOT reorganized (unless user chose "Reorganize everything")

### Reorganize Everything

All existing backlog items (stripped of section headers) + new items go through ORGANIZE together. Active Tasks preserved. New grouped backlog replaces old `## Backlog` section entirely.

### Start Fresh

Archive current backlog items to HISTORY.md: `- [~] [slug]: [description] -- archived [date]`
Active Tasks preserved. Fresh backlog written from ORGANIZE output.

### After Writing

Also create `.pipeline/` directory if it doesn't exist and ensure `.pipeline/` is in `.gitignore`.

Confirm:

```
TASKS.md created with [N] tasks in [M] areas of focus:

  [Section 1] — [N] tasks ([N] with sub-items)
  [Section 2] — [N] tasks
  [Section 3] — [N] tasks

First area of focus: [Section 1]
First task: [slug] — [description]
  Acceptance criteria: [N] items

Ready to start working? Run /code-workflow to pick up the first task.
```

---

## Arguments

```
/init-tasks                                  # Brain dump mode
/init-tasks fix auth, add tests, refactor    # Organize these items
/init-tasks $ARGUMENTS
```

---

## Example: Organize Mode

```
> /init-tasks fix toggle alignment in settings, adjust section spacing
  in settings, increase back button tap target, add JWT auth,
  migrate CSV parser

## Phase 1: INTAKE

I found 5 tasks:

1. fix-toggle-alignment: Fix toggle alignment in settings
2. adjust-section-spacing: Adjust section spacing in settings
3. increase-back-button: Increase back button tap target in settings
4. add-jwt-auth: Add JWT authentication to login endpoint
5. migrate-csv-parser: Migrate CSV ingestion to streaming parser

Anything missing? Anything I misunderstood?

> looks right

All items are clear. Moving to task refinement...

## Phase 3: DEEPEN

### Smart Grouping

I noticed these 3 tasks all touch the Settings screen:

  - fix-toggle-alignment: Fix toggle alignment in settings
  - adjust-section-spacing: Adjust section spacing in settings
  - increase-back-button: Increase back button tap target

Want to bundle these into a single task?
  Proposed: "polish-settings-screen: Polish settings screen UI"
  with the originals as sub-items?

> yes

Bundled into polish-settings-screen. Now refining each task...

### Task 1 of 3: polish-settings-screen

[Researcher explores settings screen code...]

Based on what I found in the codebase:

1. SettingsRow uses HStack with .trailing alignment for toggles.
   Should I switch to a consistent .leading alignment for all rows?

2. I see SECTION_GAP (24px) and ITEM_GAP (8px) in theme.ts.
   The dashboard uses 16px between sections. Match that?

3. The back button is a NavigationButton with default frame.
   Standard iOS minimum is 44pt. Use .frame(minHeight: 44)?

> 1. yes leading for all  2. yes match dashboard  3. yes 44pt

Here's the refined task:

polish-settings-screen: Polish settings screen UI

  ## Problem
  The settings screen feels unfinished — toggles don't align
  consistently, section spacing doesn't match the dashboard,
  and the back button tap target is too small.

  ## Vision
  Settings should match the dashboard's polish level — clean
  alignment, consistent rhythm, comfortable tap targets.

  ## Context
  Pre-launch polish pass. Dashboard already cleaned up.
  Design tokens in theme.ts. SettingsRow components reused
  across all settings sections.

  ## Affected Areas
  src/screens/Settings/, src/components/SettingsRow, theme.ts

  ## Sub-items
  - Fix toggle alignment to .leading in all SettingsRow instances
  - Change SECTION_GAP from 24px to 16px to match dashboard
  - Add .frame(minHeight: 44) to NavigationButton

  ## Acceptance Criteria
  - All toggles left-edge aligned within their rows
  - 16px spacing between section groups (matching dashboard)
  - Back button passes minimum 44pt tap target
  - Visual consistency with dashboard screen

Is this task refined enough? (approve / edit / dig deeper)

> approve

### Task 2 of 3: add-jwt-auth

[Researcher explores auth code...]

Based on what I found:

1. Login currently uses session cookies via express-session.
   Are you replacing cookies with JWT, or adding JWT as an option?

2. I see a middleware/ directory with auth.js. Should JWT
   validation be a new middleware or replace the existing one?

3. Token storage on the client — localStorage, httpOnly cookie,
   or in-memory?

> replacing cookies entirely. new middleware file. httpOnly cookie

[Builds enriched description, user approves...]

### Task 3 of 3: migrate-csv-parser

[Similar refinement flow...]

All 3 tasks refined with acceptance criteria.
Moving to organization...

## Phase 4: ORGANIZE

### Authentication & Security
- add-jwt-auth: Add JWT authentication to login endpoint [P1]

### Settings & UI Polish
- polish-settings-screen: Polish settings screen UI [P2]

### Data Pipeline
- migrate-csv-parser: Migrate CSV ingestion to streaming parser [P2]

Does this grouping make sense?

> yes

## Phase 5: FORMALIZE

TASKS.md created with 3 tasks in 3 areas of focus:

  Authentication & Security — 1 task
  Settings & UI Polish — 1 task (3 sub-items)
  Data Pipeline — 1 task

First area of focus: Authentication & Security
First task: add-jwt-auth — Add JWT authentication
  Acceptance criteria: 4 items

Ready to start working? Run /code-workflow to pick up the first task.
```

## Example: Brain Dump Mode

```
> /init-tasks

Let's figure out what needs to be done on this project.
Dump whatever's on your mind...

> retention sucks, streaks would help. colors wrong on android.
  push notifications. need more tests. onboarding is confusing.

I'm hearing:
- Retention → streaks as a solution
- Android color bug
- Push notifications
- Test coverage
- Onboarding UX issues

Anything else? Is the Android bug blocking users or cosmetic?

> just cosmetic. that's everything

Okay, pulling out 5 actionable items...

## Phase 1: INTAKE

1. implement-streak-system: Build streak tracking for user retention
2. fix-android-color-rendering: Fix color rendering on Android
3. add-push-notifications: Add push notification support
4. improve-test-coverage: Improve test coverage across the app
5. redesign-onboarding: Redesign confusing onboarding flow

All clear. Moving to task refinement...

## Phase 3: DEEPEN

No obvious groupings found. Refining individually...

### Task 1 of 5: implement-streak-system

[Researcher explores user engagement code...]

Based on what I found:

1. UserProgress model tracks daily completions with a
   lastCompletedDate field. Should streaks build on this,
   or use a separate tracking mechanism?

2. I see a HomeView with a stats section. Is that where
   the streak display should go?

3. Streak reset — midnight UTC, or user's local timezone?

> build on UserProgress. yes HomeView stats. UTC midnight

[Builds enriched description with Problem, Vision, Context,
Affected Areas, Acceptance Criteria...]

Is this task refined enough?

> approve

### Task 2 of 5: fix-android-color-rendering

This looks straightforward — let me refine it quickly.

[Quick read of Android color code, no full researcher call]

fix-android-color-rendering: Fix color rendering on Android

  ## Problem
  Colors render differently on Android vs iOS. The primary
  brand color appears washed out on Android devices.

  ## Vision
  Colors should render identically across platforms.

  ## Context
  Cosmetic issue, not blocking. Color values defined in
  colors.xml (Android) and Assets.xcassets (iOS).

  ## Affected Areas
  android/app/src/main/res/values/colors.xml

  ## Acceptance Criteria
  - Brand primary color matches iOS rendering (#3B82F6)
  - No color shifts on tested Android devices

Is this refined enough?

> approve

[Remaining 3 tasks refined similarly...]

The remaining 3 tasks look straightforward. Want to:
1. Review each one individually
2. Let me refine them all and present as a batch for approval

> batch them

[Presents 3 enriched tasks, user approves batch...]

All 5 tasks refined. Moving to organization...

## Phase 4: ORGANIZE

### User Engagement
- implement-streak-system [P1]
- add-push-notifications [P2]
- redesign-onboarding [P2]

### Quality & Polish
- fix-android-color-rendering [P2]
- improve-test-coverage [P3]

> looks good

## Phase 5: FORMALIZE

TASKS.md created with 5 tasks in 2 areas of focus:

  User Engagement — 3 tasks
  Quality & Polish — 2 tasks

First task: implement-streak-system — Build streak tracking
  Acceptance criteria: 5 items

Run /code-workflow to pick up the first task.
```
