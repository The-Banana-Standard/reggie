# Making the Reggie UI effective for building with Claude Code and Codex

Discussion opened 2026-09-09 by jacobpress, with Claude. Status: **direction decided, M0 built, M1 not started.**

Read this file first. It is written for someone arriving with no memory of the conversation.

- `findings.md` — all 90 audit findings, by dimension, with evidence
- `proposals.md` — the three competing designs, their cuts, and the judges' objections
- The operative plan lives at `docs/ui-plan.md` in this repo

---

## Why this exists

The `repo-manager` branch replaced the Tauri desktop app with a repo manager: a TypeScript CLI, an MCP server, and the Guidebook web UI (`reggie serve`). The question put to the audit was whether that UI actually serves three things Jacob wants from it:

- **G1** — understand a codebase you've lost track of, including *how the application works*, not just how files import each other
- **G2** — understand the changes agents are making
- **G3** — give direction agents interpret the way you imagined it

## What the audit found

Nine dimensions, 24 agents, every finding re-checked by a second agent sent to refute it. 90 findings confirmed, 0 refuted, 9 blockers, 59 majors.

**The diagnosis is one sentence: the Guidebook narrates committed history, and everything you want to see or steer happens before a commit exists.**

That is not a flaw in the story+map concept. The concept is good and the execution is careful — 471 server-side tests at the time, prose that is specific and hedged rather than template mush, heuristic edges labelled as heuristic, undeclared secrets separated from declared ones, flows that say what could not be derived. **That honesty discipline is the best thing in the codebase and every new surface should inherit it.**

The gap is coverage, and blockers 1–4 share a single structural cause: `RepoCtx.cached()` keys every derived payload on HEAD sha with no TTL (`workspace.ts:269-281`), and nothing in `src/` ever calls `git status`.

### The nine blockers

| # | Blocker | Goal |
|---|---|---|
| 1 | No diff exists anywhere — not an endpoint, not a CLI verb, not a pixel. The only `git diff` calls are `--name-only` and one `--stat` pasted into `packet.md`. | G2 |
| 2 | Nothing reads the working tree. An agent editing for forty minutes produces zero visible change. | G2 |
| 3 | Caches keyed on HEAD sha with no TTL, so uncommitted work is invisible *forever*, not just until refresh. | G2 |
| 4 | No update mechanism at all. After `boot()`, only a `hashchange` re-fetches. The page is a report generated once. | G2 |
| 5 | The UI cannot write a plan, a brief, or a single acceptance criterion. | G3 |
| 6 | A launched session carries no words from the user — the prompt is a pure function of `(tool, mode, slug)`. | G3 |
| 7 | `brief.md` is read by nothing that talks to a planning agent. `grep -c brief src/context.ts` = **0**. | G3 |
| 8 | The graph parses only TypeScript, JavaScript and Rust (`graph.ts:200`). Swift, Kotlin, Go, Python get no node, no map, no story. | G1 |

Three more were verified by hand outside the agent audit:

- **CI did not run a single test from `packages/reggie`.** It ran the root React app and `cargo clippy` on `src-tauri` — 52,493 lines of decommissioned app were the only thing gated. *(fixed in M0)*
- **`AGENTS.md`'s curated half was a pointer, not content.** It said "Same as CLAUDE.md", but Codex never loads `CLAUDE.md`. The rule "never check this branch out in the main clone" — whose violation breaks the `~/.claude` symlinks — never reached a Codex session. *(fixed in M0)*
- **The generated block both agents auto-load described the deleted Tauri app.** *(fixed in M0)*

## Decisions made

Jacob's calls, in his words where it matters:

1. **Open to a rethink**, but wants the *why* behind anything large.
2. **Three modes of use**, in order: (a) lost on a repo, dive in and understand how the application works; (b) caught up on the repo, learn what the agent did — *ideally on the go via the podcast*; (c) caught up on both, know **what is the next most valuable thing to do**.
3. **Liveness:** no live caching needed. Refresh is fine. But he wants to know when something is *in progress*, and **a button that opens the chat it is being worked in**.
4. **Scope:** one repo at a time for now; eventually a projects level showing which repo is next up. The workspace folders may be deleted, so cross-repo linkage must derive from git remotes and manifests, not from a workspace `CLAUDE.md`.
5. **Languages: full tree-sitter for Swift, Kotlin, Go — plus Python.** Chosen *against* all three design lenses, which recommended cutting it. The reason: those are his actual products, and a repo-understanding tool that cannot read his repos is not one. Mitigated by shipping a shallow regex tier first.
6. **"Next most valuable thing" = a deterministic blocking queue plus a ranked backlog**, with the formula's reason shown per row so he can disagree with it.
7. **Home stays the repo overview**, not a `/now` page — a judge's objection that for a solo developer that page is empty most of the time.
8. **No SSE, no WebSocket, no file watcher.** Strike "watches files" from `docs/repo-manager-vision.md:48`.

## Feasibility established by hand

- `CLAUDE_CODE_HOST_SESSION_ID` is present in a running Claude Code session's environment; `CLAUDE_CODE_ENTRYPOINT` and `AI_AGENT` too.
- Session transcripts live at `~/.claude/projects/<encoded-cwd>/<session-uuid>.jsonl`, carrying `sessionId`, `cwd`, `gitBranch`, `timestamp`.
- `claude://` is a registered URL scheme. Real routes in the app bundle include `claude://code/continue?session=last&source=desktop_action`, `claude://code/new`, `claude://resume`, `claude://code/needs-input`.
- `journal.ts:28` `sessionName()` returns `process.env.REGGIE_SESSION || "session"` — it captures no real session id, so nothing in `.reggie/` can point back at the chat that produced it.
- `claude --permission-mode plan "<prompt>"` exists. Codex has no literal plan mode; `codex --sandbox read-only "<prompt>"` is the equivalent.

## Open forks — unresolved, and the reason this discussion is still open

**The launch redesign.** Jacob: *"I don't want it to launch a specific reggie command. I think I want to launch claude or codex in plan mode with a prompt that we are going to have a discussion to plan this."*

This aligns with the vision doc's own "borrow procedures, own state" principle — `docs/repo-manager-vision.md:122` already says planning should happen in native plan mode and that Reggie should retire its bespoke planning machinery. The current `launch.ts` contradicts that: `claudeArgument()` emits `/reggie-plan <slug>`, `/reggie-triage <slug>`, `/reggie-execute <slug>`.

Two questions were put to him and **dismissed without answer** — they are still open:

1. **What happens to the four launch modes** (`chat`, `triage`, `plan`, `implement`)? Collapse to Discuss + Build? Keep shaping separate? Keep all four but drop the slash commands?
2. **Where should a launched session open?** Today `launchSession` drives Terminal.app via AppleScript. Alternatives: deep-link into the Claude desktop app via `claude://code/new` (needs a spike to confirm it accepts a prompt, cwd and permission mode), or stop launching and just show the command to copy.

A related defect, unfixed: only four project commands are installed (`capture`, `execute`, `onboard`, `plan`). There is no `reggie-triage.md`, so the board's "Shape it" button fires a slash command that does not exist in this repo. Whatever replaces the launch design should make that class of bug impossible rather than fix this instance.

**The existing backlog is dead.** Ten of the eleven `ungroomed` items describe the Tauri app, its UI marketplace, its Rust task parser, or the `[planned]` tag the vision retires. Only `try-the-new-guidebook` survives. They should be dropped, and the fact that Reggie confidently displayed eleven live-looking tasks the morning after their subject matter ceased to exist is itself the argument for M5's queue.

## Where the work stands

**M0 is built and committed with this discussion.** It deleted the Tauri app (57,089 deletions), pointed CI at the real product, made `AGENTS.md` compose from `CLAUDE.md`, fixed monorepo entry-point detection, withdrew three 501 stub routes, and sandboxed agent-written evidence (it was served as active content on the app's own origin, with same-origin reach to the POST routes that write files and launch sessions).

**M1 onward is not started.** See `docs/ui-plan.md`.

One deviation from the approved plan worth knowing: it called for deleting five working-but-unused GET routes (`/api/notes`, `/api/history`, `/api/symbols`, `GET /api/note`, `GET /api/journal`). They were kept, because M6 exposes the derived layer over MCP and will likely consume exactly those. Only the 501 stubs were removed.

## Provenance

The raw workflow output (548 KB) and the 14 MB of per-agent transcripts live outside this repo, under `~/.claude/projects/…/subagents/workflows/wf_61bff1a0-fd8/` and in session temp directories that will be cleaned. `findings.md` and `proposals.md` here are the durable extract. Nothing else survives.
