# Initialize Tasks

Refine loosely-formed tasks into a structured TASKS.md with implementation-ready task files, rich metadata, and grouped areas of focus.

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
echo "=== Checking for existing task files ==="
if [ -d ".pipeline" ]; then
  for d in .pipeline/*/; do
    if [ -f "${d}task.md" ]; then
      echo "  ${d}task.md exists"
    fi
  done
else
  echo "No .pipeline/ directory"
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

echo ""
echo "=== MCP Servers ==="
if [ -f ".mcp.json" ]; then
  cat .mcp.json | head -20
else
  echo "No .mcp.json"
fi
```

## Instructions

This command takes a loose task list and — through collaborative dialogue with the user — researches each task against the codebase, creates implementation plans, and writes a structured TASKS.md with slim metadata lines pointing to individual `.pipeline/[slug]/task.md` files.

**Init-tasks is a partnership.** Reggie researches, asks targeted questions grounded in the codebase, and the user makes decisions. Every implementation choice that could go multiple ways gets surfaced as a question — never resolved silently.

**IMPORTANT**: You (the main Claude) run this directly. Subagent calls: **researcher** (web research when needed), **code-architect** during ORGANIZE (section assignment + metadata). All other phases are handled by you directly — including codebase research and planning. When launching any agent via Task, only use `model: "opus"` or `model: "sonnet"` — never `model: "haiku"`.

### Two Modes

**Organize mode** — `$ARGUMENTS` contains task descriptions:
Skip brain dump, go straight to INTAKE with the provided input.

**Brain dump mode** — `$ARGUMENTS` is empty:
The standard workflow is for users to brain dump directly into TASKS.md before running `/reggie-init-tasks` (any format — bullet points, notes, half-formed ideas). If TASKS.md exists with raw unstructured content (no `## Backlog` header or metadata tags), treat it as a brain dump and flow into INTAKE with that as the raw input. If no TASKS.md exists at all, start with conversational exploration, then flow into INTAKE.

### If TASKS.md Already Exists (structured)

If TASKS.md has structured content (has `## Backlog` header, metadata tags like `[P1]`, `[planned]`, etc.), first count items under `### Ungroomed` in TASKS.md (if the section exists). Then ask:

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

If TASKS.md contains old-format tasks with inline `>` context blocks, those are from the previous init-tasks format. They still work — code-workflow can read them. But new tasks will use the task.md file format.

---

## Brain Dump (when no input and no TASKS.md exists)

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

**Ungroomed items**: If the input includes items pulled from `### Ungroomed` (option 4 above), parse them the same as any other input. They already have slug and description from when they were discovered — preserve those but still run them through CLARIFY and RESEARCH+PLAN like any other item. Strip any `> context` lines and use them as starting context for research.

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
All items are clear. Moving to research and planning...
```

---

## Phase 3: RESEARCH+PLAN

Research each task against the codebase and create implementation plans through collaborative dialogue with the user. This is the core of init-tasks — it transforms thin descriptions into fully researched, implementation-ready task files.

**This phase always runs** — even after brain dump mode. Brain dump captures intent; RESEARCH+PLAN validates it against the codebase and produces actionable plans.

**Tasks are processed sequentially** so each plan can build on previous plans. When planning task B, the orchestrator has task A's full plan as context — so B's plan can reference files A creates or modifies.

### Step 1: Smart Grouping

Before researching individual tasks, scan the full task list for clusters of related tasks that share the same area (same screen, same module, same file set). When found, propose bundling:

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
- If rejected, keep tasks separate and research individually
- Run smart grouping once at the start, before per-task research

### Step 2: Per-Task Research+Plan

For each task (or grouped task), work through this cycle:

**a) Codebase research** — You (the orchestrator) explore the codebase directly:

1. Read foundational docs if they exist (`docs/soul.md`, `docs/architecture.md`, `docs/patterns.md`, `docs/data-models.md`)
2. Use Glob, Grep, Read to understand:
   - What files/modules does this task touch?
   - What existing patterns or conventions are relevant?
   - What related areas might be affected?
   - What's the approximate complexity?
3. **Use MCP tools when relevant** — check if the project has MCP servers configured (`.mcp.json`). Use `ToolSearch` to discover MCP tools that match the task's domain:
   - **Chrome DevTools MCP**: For UI tasks — inspect current page state, check layout, measure performance
   - **Firebase MCP**: For backend tasks — check Firestore structure, Cloud Functions, auth config
   - **Other configured servers**: Any MCP server relevant to the task's technology
   - Only invoke MCP tools when they provide context you can't get from the codebase alone
4. **Launch researcher for web research** if needed (unfamiliar APIs, external best practices, library comparison). Include your codebase findings so the researcher skips codebase exploration:
   ```
   Codebase context for [task]:
   [your findings — affected files, existing patterns, conventions]

   Research these external questions:
   - [specific question needing web research]
   ```

**Efficiency shortcut**: For clearly trivial tasks (typo fix, config change, one-liner), do a quick `Grep` or `Read` directly. The enriched format still applies but Problem/Vision sections can be brief and the implementation plan should be minimal (files + 1-2 steps).

**If this isn't the first task**: Include a summary of prior task plans as context:
```
Prior task plans (for context — this task may reference their outputs):
- [slug-a]: Creates src/utils/auth.ts, modifies src/middleware/auth.ts
- [slug-b]: Adds new API routes at src/routes/billing.ts
```

**b) Code-informed questions** — Based on your research, ask the user targeted questions grounded in actual code. This is the partnership — you surface decisions, the user decides:

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

Ask questions in batches. Focus on things the codebase revealed that the user likely hasn't thought about — specific constants, existing patterns, related components that would need to change. **Never silently resolve an implementation choice that could go multiple ways.**

**c) Build enriched description + plan** — From the user's answers + your research, construct the full task:

```
Here's the refined task:

add-jwt-auth: Add JWT authentication to login endpoint

  ## Problem
  Login uses session cookies which don't work well for the mobile
  app and create server-side state management overhead.

  ## Vision
  Stateless JWT auth via httpOnly cookies — works for web and mobile,
  no server-side session storage needed.

  ## Context
  Currently using express-session with connect-redis. Mobile app
  launching next quarter needs token-based auth.

  ## Affected Areas
  src/middleware/auth.ts, src/routes/login.ts, src/utils/

  ## Acceptance Criteria
  - JWT issued on successful login, stored in httpOnly cookie
  - All authenticated routes validate JWT instead of session
  - Token refresh mechanism prevents forced re-login
  - express-session dependency removed

  ## Implementation Plan
  ### Overview
  Replace express-session with JWT-based auth using httpOnly cookies.
  ### Files
  - NEW: src/utils/jwt.ts — JWT sign/verify utility
  - MOD: src/middleware/auth.ts — Replace session validation with JWT
  - MOD: src/routes/login.ts — Return JWT in httpOnly cookie
  ### Approach
  1. Create JWT utility with sign/verify using jsonwebtoken
  2. Replace session middleware with JWT validation middleware
  3. Update login route to return JWT in httpOnly cookie
  4. Add token refresh endpoint
  ### Key Decisions
  | Decision | Rationale |
  | httpOnly cookie over localStorage | XSS protection |
  | Clean replacement over parallel migration | User chose simplicity |
  ### Risks
  - Existing session-dependent code needs migration — grep for req.session
```

**Complexity classification** — determines the depth of `## Implementation Plan`:

**All tasks get an implementation plan.** Simple tasks get a minimal plan (files + 1-2 steps); complex tasks get a full plan. Init-tasks already has the codebase context — writing down what you already know is cheap and saves code-workflow from running full RESEARCH+PLAN stages later.

**Complex** (full plan):
- Tasks with 3+ files/directories in Affected Areas
- Tasks involving architecture decisions (new patterns, migrations, multi-system integration)
- Tasks with 4+ acceptance criteria
- P1 tasks (blocking/critical/foundational)

**Simple** (minimal plan — files + 1-2 steps, no Key Decisions/Risks):
- Single-file changes, config tweaks, cosmetic fixes
- Tasks with 1-2 acceptance criteria
- Tasks where the implementation path is obvious from the acceptance criteria alone
- The minimal plan should take seconds to write, not another research pass

**d) User approval gate** — Present the enriched task and ask:

```
Is this task ready? (approve / edit / dig deeper)
```

- **approve** — Task is locked, move to next task
- **edit** — User provides corrections, Claude revises and re-presents
- **dig deeper** — Run another research pass on a specific aspect the user wants to explore

**e) Planning discussion** — For complex tasks, discuss implementation choices interactively:

```
For add-jwt-auth, I'm looking at two approaches:

1. Replace express-session middleware entirely with a new jwt-auth.ts
   middleware. Clean but requires touching every authenticated route.

2. Add JWT as a parallel auth method alongside sessions, then
   migrate routes incrementally. Safer but more temporary complexity.

Which direction?
```

Ground questions in what you found in the codebase. The user should feel like they're making decisions with a knowledgeable partner, not answering a survey.

### Step 3: Batch Approval for Simple Tasks

If remaining tasks are clearly simple and the user is moving fast, offer batch mode:

```
The remaining 4 tasks look straightforward. Want to:
1. Research and plan each one individually
2. Let me research them all and present as a batch for approval
```

If batch mode: research all remaining tasks, present as a list, user approves/edits the batch.

### Transition

After all tasks are approved:
```
All [N] tasks researched and planned.
All planned ([M] with full plans, [K] with minimal plans).
Moving to organization...
```

---

## Phase 4: ORGANIZE

Launch **code-architect** agent to assign refined tasks to areas of focus, prioritize, and compute rich metadata.

**IMPORTANT**: ORGANIZE does NOT modify task descriptions, sub-items, acceptance criteria, or implementation plans. Tasks are already fully refined from RESEARCH+PLAN. ORGANIZE only handles section assignment, priority ordering, dependency mapping, conflict detection, and metadata assignment.

**Prompt for code-architect:**

```
## Task: Assign refined tasks to areas of focus and compute metadata

Before exploring, read `docs/soul.md` and `docs/architecture.md` (if they exist) for product and structural context.

These tasks are already refined with full descriptions and plans. Your job is to
organize them and compute metadata, not modify them.

### The Tasks

[paste full list of refined task slugs, one-line descriptions, and file lists]

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

5. **Detect file conflicts**: Compare the file lists across all tasks.
   When two tasks modify the same file, flag them as conflicting:
   - Add `[conflicts: slug-x]` to both tasks
   - This tells the orchestrator to avoid running them in parallel

6. **Classify complexity**: Based on the task's plan (or lack thereof):
   - `[simple]` — minimal implementation plan (files + 1-2 steps), 1-2 files, obvious path
   - `[moderate]` — has a plan, 2-4 files, some decisions
   - `[complex]` — has a plan, 5+ files or architecture decisions

7. **Assign execution tier**: Based on complexity classification, assign a
   `[tier: model:effort]` tag that tells Forge what terminal configuration
   to use and tells code-workflow which tasks to pick up:
   - `[simple]` → `[tier: sonnet:medium]`
   - `[moderate]` → `[tier: opus:medium]`
   - `[complex]` → `[tier: opus:high]`
   This enables parallel execution: Forge launches terminals at different
   tiers and each code-workflow instance filters the backlog to matching tasks.

8. **Assign pipeline mode**: Based on task nature:
   - `[code]` — default, standard code-workflow
   - `[design]` — UI/UX focused, design-innovator agent leads IMPLEMENT

9. **Mark plan status**:
   - `[planned]` — has a full implementation plan in task.md
   - `[unplanned]` — has acceptance criteria only, no implementation plan (code-workflow will reject these at PICKUP with a redirect to /reggie-init-tasks)

10. **Check for staleness**: Flag tasks that may be stale:
    - References files that no longer exist in the project
    - Describes fixing something that appears already fixed
    - Duplicates or near-duplicates of other tasks
    Mark stale tasks with `[STALE: reason]` so the user can confirm removal.

11. **Order groups by priority** — first group is highest priority.

12. **Order tasks within each group** by priority then dependency order.

13. **Handle singles**: If only 1 task fits a group, put it in "Other"
    at the bottom. Every group needs at least 2 items.

### Output Format

Return the grouped list with full metadata:

### [Area of Focus 1]
- [slug]: [One-line description] [P1] [complex] [tier: opus:high] [code] [planned]
  files: src/middleware/auth.ts (MOD), src/utils/jwt.ts (NEW)
- [slug]: [One-line description] [P2] [depends: slug-above] [conflicts: slug-above] [moderate] [tier: opus:medium] [code] [planned]
  files: src/middleware/rbac.ts (NEW), src/routes/*.ts (MOD)

### [Area of Focus 2]
- [slug]: [One-line description] [P2] [simple] [tier: sonnet:medium] [code] [planned]
  files: src/config/colors.xml (MOD)

### Other
- [slug]: [One-line description] [P3] [simple] [tier: sonnet:medium] [code] [planned]
  files: tests/*.test.ts (MOD)
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
- add-jwt-auth: Add JWT authentication [P1] [complex] [tier: opus:high] [code] [planned]
  files: src/utils/jwt.ts (NEW), src/middleware/auth.ts (MOD), src/routes/login.ts (MOD)
- implement-rbac: Implement role-based access [P2] [depends: add-jwt-auth] [conflicts: add-jwt-auth] [moderate] [tier: opus:medium] [code] [planned]
  files: src/middleware/rbac.ts (NEW), src/routes/*.ts (MOD)

### Settings & UI Polish
- polish-settings-screen: Polish settings screen UI [P2] [simple] [tier: sonnet:medium] [design] [planned]
  files: src/screens/Settings/ (MOD), src/components/SettingsRow (MOD), theme.ts (MOD)

Does this grouping and metadata make sense? Want to adjust anything?
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

**Ungroomed movement**: If any of the organized tasks came from `### Ungroomed`, they are now in their proper `### Section`. After writing TASKS.md in FORMALIZE, verify that `### Ungroomed` no longer contains any items that were processed.

---

## Phase 5: FORMALIZE

Write the approved structure into TASKS.md using the slim metadata format, and create individual `.pipeline/[slug]/task.md` files for each task.

### Slim TASKS.md Format

TASKS.md is a lightweight coordination file. Each task is a slug line with rich metadata. The full task description and implementation plan live in `.pipeline/[slug]/task.md`.

```markdown
# Tasks

## Active Tasks

---

## Backlog

### [Area of Focus 1]
- [ ] add-jwt-auth: Add JWT authentication [P1] [complex] [tier: opus:high] [code] [planned]
  files: src/utils/jwt.ts (NEW), src/middleware/auth.ts (MOD), src/routes/login.ts (MOD)
- [ ] implement-rbac: Implement role-based access [P2] [depends: add-jwt-auth] [conflicts: add-jwt-auth] [moderate] [tier: opus:medium] [code] [planned]
  files: src/middleware/rbac.ts (NEW), src/routes/*.ts (MOD)

### [Area of Focus 2]
- [ ] polish-settings-screen: Polish settings screen UI [P2] [simple] [tier: sonnet:medium] [design] [planned]
  files: src/screens/Settings/ (MOD), src/components/SettingsRow (MOD), theme.ts (MOD)

### Other
- [ ] improve-test-coverage: Improve test coverage [P3] [simple] [tier: sonnet:medium] [code] [planned]
  files: tests/*.test.ts (MOD)
```

**Metadata tags** (all on the slug line):
- `[P1]` / `[P2]` / `[P3]` — priority
- `[depends: slug-a, slug-b]` — must complete first
- `[conflicts: slug-c]` — shares files, avoid parallel execution
- `[simple]` / `[moderate]` / `[complex]` — complexity
- `[tier: model:effort]` — execution tier for terminal matching (`sonnet:medium`, `opus:medium`, `opus:high`). Derived from complexity. Used by Forge to launch terminals at the right level and by code-workflow `--tier` flag to filter pickup.
- `[code]` / `[design]` — pipeline mode
- `[planned]` — has task.md with implementation plan (init-tasks always produces `[planned]`; code-workflow requires this)

**Files line** (indented under slug): `files: path (NEW/MOD), path (NEW/MOD)`
- Enables cross-task conflict detection at PICKUP without reading task.md files
- Uses same format as code-workflow's `**Files**` field in Active Tasks

### Task File Format

Each task gets a `.pipeline/[slug]/task.md` file containing the full enriched description:

```markdown
# Task: [slug]
[one-line description]

## Problem
[what's wrong / what's needed]

## Vision
[what success looks like]

## Context
[project context, related systems, prior task references]

## Affected Areas
[file paths and directories]

## Sub-items
- [sub-item 1]
- [sub-item 2]

## Acceptance Criteria
- [criterion 1]
- [criterion 2]

## Implementation Plan
### Overview
[1-2 sentences on the approach]
### Files
- NEW: [path] — [purpose]
- MOD: [path] — [purpose]
### Approach
1. [step]
2. [step]
### Key Decisions
| Decision | Rationale |
|----------|-----------|
| [choice] | [why] |
### Risks
- [risk]: [mitigation]
```

**Notes**:
- `## Sub-items` only present for grouped tasks
- `## Implementation Plan` is always present — minimal for simple tasks (files + 1-2 steps, no Key Decisions/Risks), full for complex tasks
- `## Context` may reference prior task plans (e.g., "Depends on add-jwt-auth which creates src/utils/jwt.ts")

### Writing Process

1. Create `.pipeline/` directory if it doesn't exist
2. Ensure `.pipeline/` is in `.gitignore`
3. For each task:
   a. Create `.pipeline/[slug]/` directory
   b. Write `.pipeline/[slug]/task.md` with full enriched content
4. Write TASKS.md with slim metadata format

### Merging into Existing TASKS.md

- Preserve everything under `## Active Tasks` exactly as-is
- New items merge into existing sections (append to bottom of matching section)
- New sections are inserted in priority order relative to existing sections
- Existing backlog items are NOT reorganized (unless user chose "Reorganize everything")
- Old-format tasks with inline `>` blocks are preserved as-is — they still work with code-workflow

### Reorganize Everything

All existing backlog items (stripped of section headers) + new items go through ORGANIZE together. Active Tasks preserved. New grouped backlog replaces old `## Backlog` section entirely. Old-format `>` block tasks are converted to task.md files.

### Start Fresh

Archive current backlog items to HISTORY.md: `- [~] [slug]: [description] -- archived [date]`
Active Tasks preserved. Fresh backlog written from ORGANIZE output.

### After Writing

Confirm:

```
TASKS.md created with [N] tasks in [M] areas of focus:

  [Section 1] — [N] tasks (all planned)
  [Section 2] — [N] tasks
  [Section 3] — [N] tasks

Task files written to .pipeline/:
  .pipeline/add-jwt-auth/task.md (planned)
  .pipeline/implement-rbac/task.md (planned)
  .pipeline/polish-settings-screen/task.md (planned)
  ...

First area of focus: [Section 1]
First task: [slug] — [description]
  Acceptance criteria: [N] items
  Implementation plan: [yes/no]

Ready to start working? Run /reggie-code-workflow to pick up the first task.
```

After the confirmation message, emit the completion marker:

```
~~REGGIE:DONE:reggie-init-tasks:success~~
```

If the user aborts at any phase, emit:

```
~~REGGIE:DONE:reggie-init-tasks:failed~~
```

---

## Arguments

```
/reggie-init-tasks                                  # Brain dump mode
/reggie-init-tasks fix auth, add tests, refactor    # Organize these items
/reggie-init-tasks $ARGUMENTS
```

---

## Example: Organize Mode

```
> /reggie-init-tasks fix toggle alignment in settings, adjust section spacing
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

All items are clear. Moving to research and planning...

## Phase 3: RESEARCH+PLAN

### Smart Grouping

I noticed these 3 tasks all touch the Settings screen:

  - fix-toggle-alignment: Fix toggle alignment in settings
  - adjust-section-spacing: Adjust section spacing in settings
  - increase-back-button: Increase back button tap target

Want to bundle these into a single task?
  Proposed: "polish-settings-screen: Polish settings screen UI"
  with the originals as sub-items?

> yes

Bundled into polish-settings-screen. Now researching each task...

### Task 1 of 3: polish-settings-screen

[Orchestrator explores settings screen code with Glob/Grep/Read...]

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

Is this task ready? (approve / edit / dig deeper)

> approve

### Task 2 of 3: add-jwt-auth

[Orchestrator explores auth code, middleware, routes...]

Based on what I found:

1. Login currently uses session cookies via express-session.
   Are you replacing cookies with JWT, or adding JWT as an option?

2. I see a middleware/ directory with auth.js. Should JWT
   validation be a new middleware or replace the existing one?

3. Token storage on the client — localStorage, httpOnly cookie,
   or in-memory?

> replacing cookies entirely. new middleware file. httpOnly cookie

This is complex enough for a full plan. I see two approaches:

1. Replace express-session middleware entirely with jwt-auth.ts.
   Clean but requires touching every authenticated route.

2. Add JWT alongside sessions, migrate incrementally.
   Safer but temporary complexity.

> option 1, clean replacement

add-jwt-auth: Add JWT authentication to login endpoint

  [full enriched description + implementation plan]

Is this task ready?

> approve

### Task 3 of 3: migrate-csv-parser

Prior task plans (for context):
- add-jwt-auth: Creates src/utils/jwt.ts, modifies auth.ts and login.ts

[Orchestrator explores ingestion pipeline...]
[Similar research + dialogue flow, user approves]

All 3 tasks researched and planned.
All 3 planned (2 full plans, 1 minimal plan).
Moving to organization...

## Phase 4: ORGANIZE

### Authentication & Security
- add-jwt-auth: Add JWT authentication [P1] [complex] [tier: opus:high] [code] [planned]
  files: src/utils/jwt.ts (NEW), src/middleware/auth.ts (MOD), src/routes/login.ts (MOD)

### Settings & UI Polish
- polish-settings-screen: Polish settings screen UI [P2] [simple] [tier: sonnet:medium] [design] [planned]
  files: src/screens/Settings/ (MOD), src/components/SettingsRow (MOD), theme.ts (MOD)

### Data Pipeline
- migrate-csv-parser: Migrate CSV ingestion [P2] [complex] [tier: opus:high] [code] [planned]
  files: src/services/ingestion/ (MOD), src/utils/csv-stream.ts (NEW)

Does this grouping make sense?

> yes

## Phase 5: FORMALIZE

TASKS.md created with 3 tasks in 3 areas of focus:

  Authentication & Security — 1 task (planned)
  Settings & UI Polish — 1 task (planned)
  Data Pipeline — 1 task (planned)

Task files written to .pipeline/:
  .pipeline/add-jwt-auth/task.md (planned)
  .pipeline/polish-settings-screen/task.md (planned)
  .pipeline/migrate-csv-parser/task.md (planned)

First area of focus: Authentication & Security
First task: add-jwt-auth — Add JWT authentication
  Acceptance criteria: 4 items
  Implementation plan: yes

Ready to start working? Run /reggie-code-workflow to pick up the first task.
```

## Example: Brain Dump Mode

```
> /reggie-init-tasks

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

All clear. Moving to research and planning...

## Phase 3: RESEARCH+PLAN

No obvious groupings found. Researching individually...

### Task 1 of 5: implement-streak-system

[Orchestrator explores user engagement code...]

Based on what I found:

1. UserProgress model tracks daily completions with a
   lastCompletedDate field. Should streaks build on this,
   or use a separate tracking mechanism?

2. I see a HomeView with a stats section. Is that where
   the streak display should go?

3. Streak reset — midnight UTC, or user's local timezone?

> build on UserProgress. yes HomeView stats. UTC midnight

[Builds full enriched description + implementation plan...]

Is this task ready?

> approve

### Task 2 of 5: fix-android-color-rendering

This looks straightforward — let me research it quickly.

[Quick read of Android color code, no researcher needed]

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

  ## Implementation Plan
  ### Overview
  Update Android color values to match iOS.
  ### Files
  - MOD: android/app/src/main/res/values/colors.xml — Fix primary color hex value
  ### Approach
  1. Update colorPrimary in colors.xml to #3B82F6

Is this refined enough?

> approve

The remaining 3 tasks look straightforward. Want to:
1. Research and plan each one individually
2. Let me research them all and present as a batch for approval

> batch them

[Researches 3 tasks, presents batch, user approves...]

All 5 tasks researched and planned.
All 5 planned (2 full plans, 3 minimal plans).
Moving to organization...

## Phase 4: ORGANIZE

### User Engagement
- implement-streak-system: Build streak tracking [P1] [complex] [tier: opus:high] [code] [planned]
  files: src/models/UserProgress.swift (MOD), src/services/StreakManager.swift (NEW), src/views/HomeView.swift (MOD)
- add-push-notifications: Add push notifications [P2] [complex] [tier: opus:high] [code] [planned]
  files: src/services/PushManager.swift (NEW), AppDelegate.swift (MOD)
- redesign-onboarding: Redesign onboarding flow [P2] [moderate] [tier: opus:medium] [design] [planned]
  files: src/views/Onboarding/ (MOD)

### Quality & Polish
- fix-android-color-rendering: Fix Android colors [P2] [simple] [tier: sonnet:medium] [code] [planned]
  files: android/app/src/main/res/values/colors.xml (MOD)
- improve-test-coverage: Improve test coverage [P3] [simple] [tier: sonnet:medium] [code] [planned]
  files: tests/*.test.ts (MOD)

> looks good

## Phase 5: FORMALIZE

TASKS.md created with 5 tasks in 2 areas of focus:

  User Engagement — 3 tasks (all planned)
  Quality & Polish — 2 tasks (all planned)

Task files written to .pipeline/:
  .pipeline/implement-streak-system/task.md (planned)
  .pipeline/add-push-notifications/task.md (planned)
  .pipeline/redesign-onboarding/task.md (planned)
  .pipeline/fix-android-color-rendering/task.md (planned)
  .pipeline/improve-test-coverage/task.md (planned)

First task: implement-streak-system — Build streak tracking
  Acceptance criteria: 5 items
  Implementation plan: yes

Run /reggie-code-workflow to pick up the first task.
```
