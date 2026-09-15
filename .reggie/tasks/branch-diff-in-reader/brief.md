---
slug: branch-diff-in-reader
title: Show a task branch's diff inside the reader; no route returns hunks anywhere today
area: packages/reggie
size: medium
risk: low
priority: P2
author: jacobpress
created: 2026-09-15
---
# Show a task branch's diff inside the reader; no route returns hunks anywhere today

## Problem
Reggie's stated job is to let the repo owner review what changed and why, and today it cannot show a single changed line. The only git diff calls in the product are name-only and stat: a task page says which planned files have commits on the branch, the Completed view sums added and deleted counts per file, and the packet carries a pasted stat block. Nothing returns hunks, not a route, not a CLI verb, not a pixel. So when a build session finishes a task and it sits in process or awaiting a decision, Jacob has to leave the page and open a terminal or an editor to see what the branch actually did before he can approve or send it back. The reader drawer already renders one numbered row per source line with symbols, notes, importers and select-to-note, but it only ever shows the working tree at HEAD, so even opening a changed file from the task page shows the file before the change.

Wanted: git helpers that return a branch's patch and its numstat over a range, a changes module with a unified-diff parser, two read routes for tasks in process and awaiting decision (the changed-file list with counts, and one file's hunks), a diff mode inside the existing reader that is fed the branch-side text, and the two routes recorded in the UI API contract. This is the first surface for reviewing what changed; everything that follows (the change story, the changed lens, the queue) reads from it.

## Why now
Decided 2026-09-15: this lands after the loop plumbing (stale bin, journal merges last, attribution, worktree dependencies and the stats file) and before the derived journal and the queue. The loop is now running real tasks through build sessions, and every one of them ends in a decision that the page cannot inform: the awaiting-decision card offers an approve form beside a file list with no way to read the change. The decision that low-risk plans and completions pass by policy makes this sharper, not softer, because the owner's review then happens after the fact, on the page, and the page has to be able to show him what landed. The queue that comes next puts decisions first, so the diff must be readable before the queue sends him to it.

## Suspected area
- `packages/reggie/src/git.ts` — the existing `diffStat` and `changedFiles` helpers use `base...HEAD`; the new `patchFor` and `numstatRange` sit beside them, taking a ref and a range rather than assuming HEAD.
- `packages/reggie/src/changes.ts` (new) with `changes.test.ts` — the unified-diff parser and the per-task change list; `history.ts` already parses numstat output in exactly this format and `serve.ts` already aggregates numstat and leaves `.reggie/` out for the Completed view, so both are reusable rather than reinvented.
- `packages/reggie/src/serve.ts` — `GET /api/changes` and `GET /api/filediff` go beside `fileRoute` and the task route; the task route already knows a task's branch, base and changed files, and `fileAtRef` already reads a file from a ref.
- `packages/reggie/src/tasks.ts` — `branchChangedFiles` and the state derivation say which tasks count as in process or awaiting decision and which ref each one's branch is; the routes should reuse that rather than redo it.
- `packages/reggie/ui/reader.js` — `renderFile` gains a diff mode that splices deletion rows into the numbered rows and takes branch-side text instead of the working-tree payload; the drawer, gutter, line highlight, select-to-note and editor link keep working.
- `packages/reggie/ui/board.js` — the task page's file rows already carry a "changed on branch" chip; that row is the door into the diff.
- `packages/reggie/ui/app.js` — the route into the file page has to carry which task's branch the reader should show, and the reader is opened from there.
- `packages/reggie/docs/ui-api-contract.md` and `packages/reggie/ui/DOM-CONTRACT.md` — the two routes and the reader's diff-mode surface must be written down where every other route and module interface is.

## Open questions
- Entry point, settled here: the file page hosts the diff, because the reader pane exists only at the file and symbol levels (the tasks level puts the board where the map goes and has no code pane). The task page is the door: each file row that says "changed on branch" opens that file with the reader in diff mode for that task. The board card gets nothing new beyond linking to the task page. A diff on the card or a code pane on the tasks page would be a new surface, and the decision says a mode inside the existing reader rather than a new page.
- Which range is "the branch's diff": the three-dot diff from the merge base with the default branch, as `changedFiles` computes today, or the union of the task's own commits found by the Task line, as the Completed view sums? They agree for a clean branch and diverge once the branch merges main back in or carries a commit without the trailer. Leaning three-dot for a live branch, since that is what will be merged, but not decided.
- Should Reggie's own records under `.reggie/` be left out of the change list, as the Completed view and `changedFiles` do, or included, given that reviewing an awaiting-decision task means reading the packet and the evidence the branch added? Leaving them out matches everything else on the page; including them is what a reviewer actually needs. Possibly both: excluded from counts, listed under their own heading.
  > Answered by jacobpress on 2026-09-15: Both. Exclude .reggie/ from counts and from the rows that feed impact and the map, but list those files under their own heading with the same hunk view; the packet and evidence are part of what landed.
- Files the reader cannot show as branch-side text: a file deleted on the branch has no branch-side text, a binary file has no lines, and a rename has two paths. What the reader does for each is not settled; a plain "deleted on this branch" or "binary, N bytes" card is the least the page owes.
- The reader shows the first 20,000 characters of a file and marks the rest truncated. In diff mode, is the cut applied to the branch-side text, to the patch, or should hunks beyond the cut still be reachable? The vision's earlier sketch says hunks are paged; the paging unit and the cap are open.
- Symbols, notes and importers in the reader are computed from the working tree at HEAD; on the branch-side text the line numbers move. Are symbol marks recomputed from the branch text, shifted by the hunks, or dropped while in diff mode?
- A file changed on two live branches: the file page's route names one task, but the task page is not the only way to reach a file page. When the reader is opened from the file page itself with no task named, does it offer the tasks whose branches touch the file, pick the newest, or stay in the plain mode?
- Done tasks: the routes are scoped to in process and awaiting decision by decision. Once attribution by merge commit lands, a completed task's diff is readable from its merge commit against its first parent. Should these routes accept a done task's slug then, or is that the attribution task's follow-on?
  > Answered by jacobpress on 2026-09-15: Yes, accept a done slug through the merge-commit lookup once attribution lands, and drop the Not this line that excludes it. With auto-approval most review happens after work has landed.
- Team mode: an awaiting-decision task may be so because a pull request is open while the branch exists only on the remote. Does the route fetch, read `origin/task/<slug>`, or answer that the branch is not local?
- Should the diff mode be reachable from the story's file links inside the task page (the plan's file list under the story) as well as from the file rows, and does the keyboard fold set (S, M, C) need a way to flip diff on and off?

## Not this
- The change story as a story scope and the changed lens on the map. Both read from the same routes and were sketched in the same milestone, but they are narration and map work, not the diff, and they come after it.
- The working-tree tier: uncommitted edits in a task worktree, `statusPorcelain`, a pulse route or a freshness strip. The vision's note on the re-ranking says the branch diff needs no working-tree tier; this task reads committed refs only.
- A new page or a standalone diff view. The decision is a mode inside the existing reader.
- A review action from the diff: comments anchored to hunks, approve or needs-work from the reader. Deciding stays on the awaiting-decision card and `reggie decide`.
- Diff for done tasks through the merge commit, and the numstat for the Completed view. The Completed view already sums numstat; joining a finished task to its merge commit is the attribution task.
- A `reggie diff` CLI verb or an MCP tool. The decision names routes and the reader; a verb can wrap the same functions later if a session needs it.
- Line-level notes or evidence anchored to a diff row. Select-to-note keeps working on the visible rows, and nothing new is recorded against a hunk.
