# Making the Reggie UI effective for building software with Claude Code and Codex

> **Status (2026-09-13, later): M0 is built. The loop-path fixes and the intake story landed the same day, by hand, ahead of the milestone order below.**
> The audit this plan rests on, the decisions behind it, and the still-open questions are in
> `.reggie/discussions/ui-audit-2026-09/`. Read that first if you are new to this work.
>
> **What landed on 2026-09-13, and where it differs from the plan as written:**
> - **M1 is done** in its small form: the brief reaches the context pack (`## What the user is asking for`, `## Open questions still open`), the planning prompt and the MCP task tool.
> - **The launch redesign is done, and it replaced M1's prompt fixes rather than patching them.** Two modes, `discuss` and `build`; the goal (shape, plan, discuss, build) follows from the task's state on the server; no Reggie slash command is ever emitted; Claude opens in `--permission-mode plan` and Codex in `-s read-only` for every discussion; a free-text note rides along; the context pack is written to a file the prompt names; a session id is minted with `--session-id`; a build **claims the task at launch** and opens in the worktree. `src/launch.ts`, `docs/ui-api-contract.md`.
> - **M2 mostly collapsed into that.** The session id is known before the session starts and is written into the claim record and `.reggie/.cache/launches/<slug>.json`. What remains of M2 is the "open the chat" button and the in-flight card; note that `claude://code/continue?session=` accepts only `last` or a desktop-local id, so the button must use `claude://resume?session=<uuid>` or `claude --resume <uuid>`.
> - **Not in the plan, built because it is the view you look at most:** the task story for a task without a plan (what was written, where it probably lives, what is known there, what it resembles, what is unclear, what happens next; or the brief as a story), a form that adds detail under the intake line, and narration: every story has a spoken script, a browser read-aloud, an audio episode made with macOS `say`, and a private RSS feed. `src/narrate.ts`, `src/episode.ts`, `ui/listen.js`.
> - The `Task:` trailer is written on claim commits; the dead Tauri-era backlog was dropped from `TASKS.md`; `.reggie/config.yaml` pins `defaultBranch: repo-manager` while v3 is built on this branch.
> - **2026-09-13, later:** the first task went through the loop end to end (`mobile-ui`: phone layout, a serve key for the network, a playable feed). It confirmed the shape and surfaced four gaps, all captured: a task worktree has no dependencies, the stale-build warning misreads a missing build folder, two journals appended to the same day file collide on merge, and a superseded note keeps rendering beside its replacement.
> - **Decided the same day:** Reggie is not an agent system, and the journal is to be derived from transcripts and commits rather than written by a session that remembers to. See the vision doc's "Decisions made on 2026-09-13".
> - **Next, through Reggie itself:** the derived journal, then branch diff in the reader (part of M4, needs no working-tree tier), then M5, then the rest of M6, then M-Lang's regex tier, then M3.

## Context

The `repo-manager` branch rebuilt Reggie as a repo manager: a TypeScript CLI, an MCP server, and the Guidebook web UI (`reggie serve`) — a plain-English story column beside a Cytoscape map, with a task board, five lenses, and Services/Data-flow pages. It is six commits and ~56,000 lines ahead of `main`, and it works.

The question is whether it is the right thing. You asked for three outcomes: understand a codebase you've lost track of, understand the changes agents are making, and give direction agents interpret the way you imagined it. A nine-dimension audit of the branch (24 agents, every finding adversarially re-checked against the code) says the branch is excellent at the first and close to silent on the other two.

**The one-sentence diagnosis: the Guidebook narrates committed history, and everything you actually want to see or steer happens before a commit exists.**

That is not a flaw in the story+map concept — the concept is good and worth keeping. It is a coverage gap with a single structural cause, and the fix is mostly re-pointing machinery that is already written and tested.

## What the audit found

90 findings confirmed, 9 blockers, 59 majors. Independently verified by hand: CI, `AGENTS.md`, `sessionName()`, the absence of any diff, and the `claude://` scheme.

**The branch is in good shape as an engineering artifact.** 471 server-side tests. The generated prose is genuinely specific and hedged, not template mush — "`src/components` leans on `src/types` 41 times, mostly for `terminal.ts` (21)", "It stands alone: nothing else in the repo imports it". Heuristic edges are labelled as heuristic; undeclared secrets are separated from declared ones; flows say what could not be derived. That honesty discipline is the best thing in the codebase and every new surface should inherit it.

**The blockers, condensed:**

| # | Blocker | Goal |
|---|---|---|
| 1 | No diff exists anywhere — not an endpoint, not a CLI verb, not a pixel. The only `git diff` calls are `--name-only` and one `--stat` pasted into `packet.md`. | G2 |
| 2 | Nothing reads the working tree. No `git status` call in `src/`. An agent editing for forty minutes produces zero visible change. | G2 |
| 3 | Every derived cache is keyed on HEAD sha with no TTL (`workspace.ts:270`), so uncommitted work is invisible *forever*, not just until refresh. | G2 |
| 4 | No update mechanism at all. After `boot()`, the only thing that re-fetches is a `hashchange`. The page is a report generated once. | G2 |
| 5 | The UI cannot write a plan, a brief, or a single acceptance criterion. The POST allowlist is six routes: capture, note, decide, journal, triage, launch. | G3 |
| 6 | A launched session carries no words from you — the prompt is a pure function of `(tool, mode, slug)`. | G3 |
| 7 | `brief.md` is read by nothing that talks to a planning agent. `grep -c brief src/context.ts` = **0**. | G3 |
| 8 | The graph parses only TypeScript, JavaScript and Rust (`graph.ts:200`). Swift, Kotlin, Go, Python get no node, no map, no story. | G1 |

**Findings I verified myself, not in the list above:**

- **CI does not run a single test from `packages/reggie`.** `.github/workflows/ci.yml` has a `frontend` job (`npm ci && npm test` at the root — the decommissioned React app) and a `backend` job (`cargo clippy` on `src-tauri`). The actual product is ungated; 52,493 lines of dead Tauri app are the only thing gated.
- **`AGENTS.md`'s curated half is a pointer, not content.** It says "Same as CLAUDE.md. Read its Conventions, Decisions, and Gotchas" — but Codex never loads `CLAUDE.md`. Only the generated block is shared. So the rule "never check out this branch in the main clone — `~/.claude/*` symlinks point into `resources/`" never reaches a Codex session, and violating it breaks your installation.
- **The generated block both agents auto-load describes the decommissioned Tauri app** ("a desktop workspace and agent system…", entry points `src-tauri/src/main.rs` and `src/main.tsx`). Every agent starting work on this branch is handed a false description of what the repo is.
- **`sessionName()` (`journal.ts:28`) returns `process.env.REGGIE_SESSION || "session"`.** Nothing in `.reggie/` can point back at the chat that produced it.
- **The server on `:4310` is a stale pre-Guidebook build.** Not evidence about the current code; kill it before verifying anything.

## Why the significant changes

You asked to understand the *why* behind anything large. Four things drive this plan:

1. **One cause, not many.** Blockers 1–4 are all downstream of `RepoCtx.cached()` keying on HEAD. Fixing the key and adding a working-tree read turns a snapshot into a view. This is one choke point at `workspace.ts:269-281` that twelve callers funnel through.
2. **The intent compiler is written and unplugged.** `brief.ts`, `plan.ts`, `triage.ts`, `notes.ts`, `context.ts` all exist, are linted and are unit-tested. `buildContext` just never reads the brief, and `LaunchInput` just has no text field. The largest G3 win in the audit costs about two days.
3. **Change is a story scope, not a new page.** All three independent design lenses converged here, and it is the structural insight worth keeping: a `changeStory` in the same `StorySection`/`Paragraph`/`refs` shape inherits the story↔map lockstep, the entity links, the honesty conventions and the narration register for free. A standalone diff page inherits none of it. Same for the diff itself — it goes *inside* `reader.js`, which already emits one `div.reader__line[data-line]` per source line, keeping symbols, notes, importers and selection-to-note working.
4. **Deleting the Tauri app is a precondition, not cleanup.** Until it goes, every generated fact about this repo is false, CI gates the wrong thing, and `chooseAreas` ranks a dead React app above the actual product on the landing page.

**Where I'd push back, and am proceeding anyway because you decided it:** full tree-sitter for Swift, Kotlin, Go and Python is the largest single workstream here, and all three design lenses recommended cutting it. I've kept it — your products are those languages, and a repo-understanding tool that can't read your repos isn't one — but I've split it so a shallow tier lands in days and full fidelity follows, and I've put it on a parallel track so it never blocks G2/G3.

## Design decisions

- **Home stays the repo overview.** Not a `/now` page — for a solo developer that page is empty most of the time, so the first screen after `reggie serve` would be an empty-state card. Instead the overview's first section becomes the queue, which is empty-tolerant, and a freshness strip in the header says what the page is a picture of.
- **Refresh, not a daemon.** No SSE, no WebSocket, no file watcher — you said refresh is fine. A cheap `/api/pulse` route polled every few seconds carries revision, branch, dirty count and in-flight sessions; the expensive rebuild happens on demand.
- **Cross-repo linkage must not depend on workspace folders.** You may delete them. Derive sibling repos from git remotes, manifests and shared service ids, with the workspace `CLAUDE.md` as an optional hint — never a requirement.
- **Everything narratable stays narratable.** `story.ts` is explicitly the narration layer for the future podcast. `changeStory` and the queue must be written in listener register (no paths, no slugs in the prose; links carry the entities) so "what the agent did, on the go" is a downstream consumer, not a rewrite. Podcast itself is out of scope here.

## Milestones

### M0 — Clear the ground (small, do first)

Subtractive and unblocking. Until it lands, every generated fact about this repo is a lie.

- Delete root `src/` (89 files), `src-tauri/` (28 files), `vite.config.ts`, root `index.html`, `public/`, `tsconfig.node.json`. Rewrite root `package.json` and `tsconfig.json`.
- Repoint `.github/workflows/ci.yml` at `packages/reggie`: drop the `backend` matrix and the root `frontend` job; run `npm test` and `tsc --noEmit` in the package. Add a jsdom project to `vitest.config.ts` over `ui/` — the four `ui/dev/*-harness.html` files already wire the real modules against sample payloads, so the UI lane is those harnesses with assertions.
- `reggie docs refresh` to regenerate the block in both files. Reuse `docs.ts` `locateBlock`/`replaceBlock`.
- **Generate both `CLAUDE.md` and `AGENTS.md` curated halves from one source** so Codex gets the real Conventions/Decisions/Gotchas, not a pointer.
- Delete `/api/export`, `/api/treemap`, `/api/timeline` (501 stubs), the five dead GET routes, and `ui/dev` from the published `files` list and from `safeStaticPath`.

### M1 — Intent reaches the agent (small) — the cheapest large G3 win

- `context.ts`: read `briefFile` beside `planFile`; emit `## What the user is asking for` and `## Open questions still open` above the plan block. Reuse `brief.ts` `parseBrief` (already tested).
- `cli.ts:601` `planningPrompt` seeds from `brief.problem`, not the raw intake line.
- `launch.ts`: `LaunchInput` gains an optional free-text `note`, appended verbatim to every prompt. `launchCommand` already builds an argv vector (quoting round-tripped through a real shell at `launch.test.ts:144`), so nothing about quoting changes. Add a textarea beside every launch button; `GET /api/launch` echoes exactly what will run.
- Fix three prompt defects: Claude's triage launch emits `/reggie-triage`, a slash command this repo does not install; the Codex implement prompt has no review step; the Codex plan prompt omits the commit step.
- Fix `POST /api/launch` starting in the repo root rather than the task's worktree.

### M2 — In progress, and a button to the chat (small) — your explicit ask

Feasibility confirmed by hand: `CLAUDE_CODE_HOST_SESSION_ID` is in a running session's environment, transcripts live at `~/.claude/projects/<encoded-cwd>/<uuid>.jsonl` carrying `sessionId`/`cwd`/`gitBranch`/`timestamp`, and `claude://code/continue?session=…&source=desktop_action` is a real route in the app bundle.

- `journal.ts` `sessionName()` captures the real id (`CLAUDE_CODE_HOST_SESSION_ID`, Codex equivalent, `REGGIE_SESSION` override). Record tool + session id in `claim.json` and journal headers.
- New `/api/sessions`: enumerate transcripts for this repo *and its worktrees*, mtime as last activity.
- "Open the chat" button on every in-flight card → `claude://code/continue?session=<id>`, with copy-the-command fallback.
- `git worktree list` enumeration so the UI follows an agent working in `.worktree/<slug>` — the vision's own default setup, invisible today.
- **Spike first (half a day):** confirm the deep link accepts a session id rather than only `last`. If it doesn't, the button degrades to focusing the app plus a copyable resume command; everything else in M2 still stands.

### M3 — Working-tree truth and one revision key (medium) — foundation

- `RepoCtx.revision()` = headSha + a cheap dirty digest. Split `cached()` into a revision-keyed cheap tier and a sha-keyed expensive tier on an idle debounce. One change at `workspace.ts:269-281` fixes all twelve callers.
- `git.ts`: add `statusPorcelain`, `numstatRange`, `patchFor`, `worktreeList` beside the existing `diffStat`/`changedFiles` at `:175-183`.
- New `changes.ts` + `changes.test.ts`. Reuse `history.ts` `parseNumstatLog` — it already parses exactly this format — and `serve.ts:1252` `completionDiff`, which already aggregates numstat and excludes `.reggie/`.
- `/api/pulse`: revision, branch, dirty count, in-flight sessions. Client polls it and renders a freshness strip (`repo-manager · a2f19c3 · 3 files dirty · as of 14:22`) with a Refresh button. `/api/facts` already returns `branch` and `headSha` and no UI file renders either.
- Fix: writes made outside the UI's own POST routes never invalidate the expensive caches; journal and evidence written inside a task worktree never reach the server.

### M4 — See and read the change (large) — closes G2

- `/api/changes` and `/api/filediff` (hunks, paged).
- **Diff mode inside `reader.js`**, not a new view: `renderFile` at `:452` gains a diff mode, splicing deletion rows into the existing numbered rows. The drawer, gutter, symbol marks, line highlight, selection-to-note (`:580-660`) and editor link all keep working.
- **`changeStory` as a seventh story scope and a `changed` lens on the map.** Reuse `section()` and the paragraph builders (`story.ts:564-712`), `routeFor`/`link`, `renderStory` (`story.js:905`), and `map.js`'s existing lens machinery (`paintNode:1172`, `legendForModel:1332`, `footerFor:1524`).
- Activity feed answering "what did the agents do while I was away", from `historyOf`/`journalOf`/`tasksOf` — all four already cached.
- Test results and review findings become data, not a hand-ticked checkbox: a `reggie check` verb writing records that join to `parsePacketCriteria` (`tasks.ts:866`).

### M5 — The queue and the ranked backlog (medium) — "what should I do next"

Your call: a blocking queue plus a ranked backlog with the reason shown per row.

- **Blocking queue** (deterministic, explainable, nothing to tune): decisions waiting, agents' open questions unanswered, plans failing lint, briefs failing lint, stale notes on code that changed since. `brief.questions` is already parsed (`brief.ts:151`) and already on the wire (`tasks.ts:820`) to a client that ignores it.
- **Ranked backlog** below it: declared priority, blast radius from `impactView`, churn×complexity hotspots from `history.ts`, dependency order, staleness. **Every row shows the formula's reason in words** so you can disagree with it.
- Surface `lintPlan`/`lintBrief` results over HTTP — they are computed today and thrown away before reaching the client.
- Open questions become answerable in place; the answer appends into the brief's `## Open questions` section.

### M6 — Write the direction, not just read it (medium) — G3

- `POST /api/brief` and `POST /api/plan` with hash-guarded section merges, returning `LintResult`. New `compose.ts`; reuse `util.ts` `splitFrontMatter`/`upsertFrontMatter` and the existing POST guard machinery.
- Brief composer and criteria editor in the story column (new `ui/compose.js`). Reuse `story.js`'s `submit()`/`formError()`/`setBusy()` idiom at `:617-645`.
- Pointing: map and reader selection become typed references you can attach to a brief or a note. Reuse `map.js`'s `emit('tap', id, nd)` at `:3975` and `reader.js`'s line-range selection at `:603-660`.
- Expose the derived layer over MCP (`impact`, `services`, `flows`, `search`, `story`). Today `mcp.ts` omits all of it, so agents get none of the understanding the UI is built on.

### M-Lang — Language coverage (large, parallel track, starts after M2)

Runs alongside M3–M6; touches `graph.ts`/`roles.ts`/`facts.ts` and nothing the other track needs.

- **Phase 1 (days): shallow tier.** Extend `CODE_EXT` and add a regex import/entry extractor for Swift, Kotlin, Go and Python. Immediately yields file nodes, areas, tests, notes, history, ownership and a real story on Color Lock, speech-therapy-app, color-lock-android and RetroFantasy. Ship the honest banner with it — `facts.ts:37-67 LANGUAGE_BY_EXT` already knows every skipped language and `facts.ts:188-196` already emits `swift build` / `go build ./...` / `pytest`.
- **Phase 2: tree-sitter** for real symbols and imports in those four languages, replacing the regex tier per language as each lands.
- Alongside: publish the graph's own coverage. `unresolved` and `SYMBOL_ENGINE` are computed and discarded today, so a partly-resolved map is indistinguishable from a complete one.
- Also on this track: read `README`/`ARCHITECTURE`/`CLAUDE.md` into "What this is" (today it prints `package.json.description` alone), and fix `"(54 with tests)"` — it renders a total-file count as a tests claim, a false sentence in the most-read paragraph on the landing page.

## Cuts, with reasons

- **The Tauri app** (52,493 lines). Decommissioned by decision, still the only thing CI builds.
- **Treemap, Timeline, People/Person pages.** Three routes render "not in this release" while `story.ts` links to them from twelve places. Delete the routes and the links, or the links keep lying. (People's data is live at `/api/people` — if you want it, it's a small add later, not part of this plan.)
- **The symbol and call-graph level.** `calls()` (`symbols.ts:911`) returns `[]`; no `calls` edge is constructed anywhere. Building it means the TypeScript compiler API. Deferred behind M-Lang, which buys more.
- **SSE, WebSockets, a file watcher** — and strike "watches files" from `docs/repo-manager-vision.md:48`. A poll of a loopback route running two git commands is enough, and you said refresh is fine.
- **Anchored discussion threads** (`repo-manager-vision.md:243-247`). A comment on an acceptance criterion is a criterion edit; the write layer in M6 covers the real need without a second subsystem.
- **The ⧗ STRETCH half of `ui-spec.md`**: `shares-service` workspace edges, the `boundaries:` config hook, the Tasks lens, "Trace from here".
- **Freehand drawing on the map.** The literal reading of "point at this and say *like this*" — but a scribble isn't a reference an agent can resolve. M6's typed references are.
- **Rewriting `ui-spec.md`.** It froze at commit `1fb7aa2` (its own line 5) and still teaches the removed `grooming` state. Replace it with a short living contract plus `spec.test.ts`, rather than maintaining prose that drifts.

## Critical files

`packages/reggie/src/` — `serve.ts` (routes, caches, POST guards), `workspace.ts:269-281` (the cache choke point), `git.ts:175-183`, `context.ts`, `launch.ts`, `journal.ts:28`, `story.ts`, `views.ts`, `graph.ts:200`, `brief.ts`, `plan.ts`, `mcp.ts`, `docs.ts`.
`packages/reggie/ui/` — `app.js` (router, fetch cache, shell), `reader.js:452` (diff mode), `story.js:905`, `map.js` (lens machinery), `board.js`.
New: `changes.ts`, `compose.ts`, `activity.ts`, `ui/compose.js`, `spec.test.ts`.
Root: `.github/workflows/ci.yml`, `CLAUDE.md`, `AGENTS.md`.

## Verification

Kill the stale server on `:4310` first — it is a pre-Guidebook build and will mislead every check.

1. **Tests and types:** `cd packages/reggie && npm install --legacy-peer-deps && npm run build && npm test && npm run typecheck`. The suite must be green *and running in CI* after M0.
2. **UI lane:** the new jsdom project must cover the modules each milestone touches. No milestone lands with its client code untested — that is the rule M0 exists to establish.
3. **Live, per milestone:** `npx tsx src/cli.ts serve --port 4311` against this repo, then drive it in the browser pane. M2: start a Claude session in a worktree, confirm the card appears and the button opens the right chat. M3: edit a file without committing, hit Refresh, confirm the dirty count and the map both move. M4: have an agent make a real change, then read the diff in the drawer and the change story beside it without leaving the page.
4. **The real test for M-Lang:** run `reggie serve` against `color-lock-android` and `RetroFantasy`. If the story is still empty, the phase isn't done.
5. **Intent round-trip for M1/M6:** write a brief in the UI, launch a plan with a note attached, and confirm both appear in `reggie context <slug>` — that is the whole G3 loop in one check.

## Open risks

- **The `claude://` deep link is unverified.** Spike it before committing to the button's shape.
- **Cold history build is superlinear** and was calibrated on a 356-commit repo. Measure on Color Lock before M3 ships.
- **Agent-written evidence HTML/SVG is served as active content on the app's own origin.** Small fix, real hole; fold it into M0.
- **90 findings were confirmed and 0 refuted.** The verifiers each read the cited code and I re-checked several by hand, but a 100% confirmation rate is unusual — treat individual minor findings as leads, not gospel.
