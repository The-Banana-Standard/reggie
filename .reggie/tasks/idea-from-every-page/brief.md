---
slug: idea-from-every-page
title: An idea action on every page that captures a line and opens a shaping session with the page's entity in the context pack
area: packages/reggie
size: medium
risk: low
priority: P2
author: jacobpress
created: 2026-09-15
---
# An idea action on every page that captures a line and opens a shaping session with the page's entity in the context pack

## Problem
The decision of 2026-09-15 says planning happens only in Claude Code or Codex sessions, and that every page gets an idea action so an idea can be shaped the moment it strikes: capture a line, mint the slug, open a discuss session in plan mode with the page's entity as context. Today the web view has the two halves of that and no way to join them. The board has a capture form that posts to `/api/capture`, which mints the slug from the text, stamps the line with the person, `web` and the date, and appends it to `.reggie/intake.md`. The board also has the one launcher that talks to `/api/launch`, which looks each slug up in the task list, refuses any slug the repo has never heard of, resolves the goal from the task's state (an ungroomed task becomes `shape`, so discuss mode is the right mode and no new mode is needed), writes the context pack for the slug and starts the session. What no page has is a single action that does the first half and then the second, from the page the reader was on, in the repo that page belongs to.

The pack is the other gap. `buildContext` in `context.ts` already takes a list of repo-relative paths: for each one it walks the note chain from the repo note down through every folder note to the entity's own note, lists the files in scope, pulls the last commits that touched them, and finds tasks whose plans overlap. But `LaunchInput` in `launch.ts` has no field for paths, and both callers, `POST /api/launch` and `reggie launch --run`, build the pack from `{ slug }` alone. A freshly captured slug has no brief and no plan, so its pack is the repo note and the working agreement and nothing else; the intake line is not in it either, which is the captured `context-pack-omits-intake-line` item. The shaping session opens knowing nothing about where the idea struck.

What the pack carries at each level, settled here from what `buildContext` already does with a path. At the repo level the entity is the repo itself and there is no path: the pack carries the repo note, the recent journal, the active work, and the intake line with its detail. At the area level the path is the folder: the pack adds the folder's note chain (repo note, each folder note above it, the folder's own `_dir` note), the folder as a file in scope, the recent commits under it, and the tasks whose plans touch it. At the file level the path is the file: the same chain ending in the file's own note, the file in scope, its recent commits and the tasks that plan to touch it. A symbol page is treated as the file level, with the file that holds the symbol as the path. Nothing new is rendered for any level; the levels differ only in which path, if any, is handed to the builder.

Where the page entity lands, also settled here: both. It goes into the intake item as a detail line naming the repo-relative path, because intake is committed and survives into the brief and the task's story, while the pack is derived cache that is rewritten on every launch; and it goes to the launcher as a pack path, because the path is what makes the builder pull the notes, commits and related tasks for that place. The detail line is the durable record of where the idea struck; the path is how the session reads that place. The two are not redundant: once `context-pack-omits-intake-line` lands, the detail line is also what tells the session, in the pack's first screen, that the idea came from a page and which one.

## Why now
Every one of the thirty-odd items captured on 2026-09-15 was captured from a shell, and every shaping session so far was started from a shell after reading the intake file to find the slug. The web view exists to shorten the distance between noticing something on a page and having it shaped, and today that distance is: leave the page, type the line into a terminal, copy the slug, run launch, and then explain to the session where the idea came from because the pack does not say. Each step loses a little of what the reader saw, and the last one is where the entity is lost entirely.

It is also the piece the planning decision rests on. Refusing in-page brief editing is only workable if a shaping session is one click away from any page; otherwise the refusal reads as friction and the pressure to edit briefs in the browser comes back. The decision order of 2026-09-15 puts the loop plumbing first and this among the items after it; it wants `context-pack-omits-intake-line` before it (so the pack shows the line and detail the action wrote) and `intake-line-leaves-at-triage` beside it (so the shaping session's triage step removes the line the action added).

## Suspected area
- packages/reggie/src/launch.ts because `LaunchInput` has no field for the paths a pack should be built from, and because the shape prompt is where the session is told what the pack contains
- packages/reggie/src/context.ts because `buildContext` already accepts `paths` and does the right thing with a file or a folder; this item wires callers to it rather than changing it
- packages/reggie/src/serve.ts because `POST /api/capture` mints the slug, `POST /api/launch` refuses unknown slugs via `launchTasks` and builds each pack from `{ slug }` only, and the page needs either one route that captures then launches or a sequence the client can run without a race against the task cache
- packages/reggie/src/capture.ts because `capture` writes the intake line and its detail lines, so the page entity's detail line is written here, and because the `source` stamp is free text (`cli`, `web`) that may want to say which page
- packages/reggie/src/cli.ts because the `launch` verb takes slugs only, and the CLI door should carry a path the same way the page does if the two are to wrap the same function
- packages/reggie/src/story.ts because `explainActions` emits the Spotlight's three actions (Go deeper, Show what breaks, Add a note) and the story's empty-state sections already emit an action with `form: "capture"`; the idea action is a story action at repo, area and file scope
- packages/reggie/ui/story.js because it renders `action.form === "capture"` with the board's `captureForm` and caps Spotlight actions at three, treating the third as the note button
- packages/reggie/ui/board.js because `captureForm` and the launcher that talks to `/api/launch` (with the remembered tool and the copy-the-command fallback) are the two pieces the action composes
- packages/reggie/src/mcp.ts because `reggie_capture` is the session door for capture and the 2026-09-15 decision says MCP and the CLI wrap the same functions
- packages/reggie/docs/ui-api-contract.md and packages/reggie/docs/ui-spec.md because `/api/launch` is documented as slug-only and every page action is specified there
- packages/reggie/src/launch.test.ts, context.test.ts, capture.test.ts and story.test.ts because the pack per level and the detail line are pure functions of files and should be asserted from a fixture

## Open questions
- Does "every page" include the task page and the workspace page, or only the repo, area and file pages? An idea on a task page is most naturally a detail line on that task, or a new item whose detail names the task; the workspace page has no single repo to capture into unless the reader picks one.
  > Answered by jacobpress on 2026-09-15: Repo, area, file and symbol pages capture into their repo; the task page captures a new item whose detail names the task; the workspace page puts the action on each repo card.
- Does the action launch in the same click as the capture, or capture first and offer Shape as a second click? A launch opens a Terminal window on the serving machine and can only do so on macOS; a reader on a phone through the serve key would capture a line and then watch the launch fail, so the two-step may be the only honest shape there.
  > Answered by jacobpress on 2026-09-15: One click: capture first, then launch. If the launch cannot run on this machine the capture stands and the command is shown, so the idea is never lost.
- Does the detail line name the path alone, or also the route and the page level (repo, area, file), and is the intake `source` stamp still `web` or something that names the page?
- At the area level, does the pack also pull the notes of the files inside the folder, or only the chain above the folder and its own note, which is what a path gives today?
- Should the page path seed the brief's `area` front matter when triage scaffolds it, so the shaped brief remembers where the idea struck without the session retyping it?
- Where does the action sit on the page: the page header, the Spotlight (whose renderer takes three actions and assumes the third is the note button), or beside the add-note form; and does the Spotlight cap move to make room?
  > Answered by jacobpress on 2026-09-15: The page header, at every scope, leaving the Spotlight untouched.
- Does the CLI get the same door, as a path option on launch or a launch flag on capture, and does the MCP server expose a launch tool at all when launching means opening a terminal on the serving machine rather than in the session that called it?
  > Answered by jacobpress on 2026-09-15: The CLI gets a path option on capture and launch. No MCP launch tool: launching opens a terminal on the serving machine and is a human act.
- Before the item is shaped, does the ungroomed card or the task page show the entity the idea came from, or is the detail line in the intake the only place it is visible until a brief names an area?

## Not this
- Rendering the intake line and its detail at the top of the pack for an ungroomed item. That is `context-pack-omits-intake-line`; this item relies on it and does not redo it.
- Removing the intake line at triage. That is `intake-line-leaves-at-triage`; the shaping session this action opens runs triage, and that item decides what triage does to the line.
- The board's capture form and the three capture doors (CLI, MCP tool, web form). That form exists and is not changed here; this item adds the page-level door that also launches.
- Editing a brief from the page beyond answering an open question in place. The 2026-09-15 decision keeps planning in sessions, and the answer-in-place form is `needs-you-queue`.
- Making Codex sessions work end to end. The action offers both tools the way the launcher already does; whether a Codex session then completes the loop is `codex-parity-end-to-end`.
- The Spotlight's Go deeper button reloading the page you are on. That is `go-deeper-on-own-page`, though the two touch the same three-action renderer.
- Emitting the add-note form on repo and area pages. That is `note-form-on-repo-and-area`, a sibling change to the same story scopes.
- A new launch mode or goal. Discuss mode already resolves to shape for an ungroomed slug and to plan or discuss for others; the action uses that resolution as it is.
- Cross-repo capture from the workspace page. One repo at a time by decision; the action captures into the repo the page belongs to.
