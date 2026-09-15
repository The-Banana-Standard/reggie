---
slug: needs-you-queue
title: Needs you becomes a queue of everything waiting on the owner, not only decisions
area: packages/reggie
size: medium
risk: low
priority: P2
author: jacobpress
created: 2026-09-15
---
# Needs you becomes a queue of everything waiting on the owner, not only decisions

## Problem
The vision says the owner should always know what is waiting on them. The place that promises to say so is the Needs you section: it heads the repo landing page, the workspace page and the story column of the task board. Today all three of them answer one question only. The repo story filters the task list to `awaiting-decision`, the workspace summary does the same per repo, and the board renders one decision card per such task with Approve and Needs work. When nothing is awaiting a decision the section hides itself, which reads as "nothing needs you" on a repo where four other kinds of thing are waiting for exactly that person.

Those four kinds each exist somewhere on disk and none of them reaches the queue. Intake lines sit in `.reggie/intake.md` until someone shapes them; the board shows them as ungroomed cards, but nothing says "this is yours to shape". Plan and brief lint results are computed every time the state is derived, then thrown away down to a single boolean: the task record carries `planLintOk` and the board turns it into a tick or a cross badge, so the owner can see that a draft fails without ever seeing the message that says why, and a brief's lint result does not reach the task record at all. A brief's Open questions are parsed into a list and shown on the task page with the sentence that they can be answered "here or in the planning session", but there is no here: nothing on the page takes an answer, and the one form that does take an answer appends to the intake line, not to the brief. Stale notes are found and marked on the entity pages, and counted in the knowledge numbers, but never listed as work; and the staleness check silently skips any note whose file or folder no longer exists, so the notes that are most wrong of all, the ones about code that is gone, are the ones that never show up anywhere.

The item asks for one deterministic queue built from those sources: rows for decisions, for lint messages on plans and on briefs, for unanswered brief questions, and for stale notes, with a new class for a note whose entity no longer exists. Deterministic means each row is a pure function of files and git, so the same repo state always produces the same queue and a row disappears the moment the thing it names is fixed.

Two rules from 2026-09-15 shape it. First, the intake line leaves at triage and a scaffolded brief that was never filled in is reported as ungroomed rather than groomed; that item lands before this one, and the queue must tell those two cases apart, a scaffold with the placeholders still in it against a brief someone genuinely wrote that still fails its contract. The lint messages are how it tells: the placeholder errors name a draft nobody has touched, and any other error names unfinished thinking. Second, planning happens only in Claude Code or Codex sessions, and the one in-page edit a brief allows is answering an open question in place. So the queue's question row takes an answer and appends it under the brief's Open questions section, and that is the only way a page ever writes into a brief.

## Why now
The decision order of 2026-09-15 puts the queue last, after the loop plumbing, the small items, the branch diff and the derived journal, and it belongs there: a queue is only as good as the states and records behind it, and the earlier items are what make those records true. The intake-line item in particular is named as its precondition, and this brief is written on the assumption it has landed. Once it has, the queue is the feature the plumbing was for. Every item captured on 2026-09-15 was captured by hand from a shell, every shaping session was started from a shell, and the person doing that had to read the intake file, the task folder and the entity pages to find out what was waiting. That is the reading the web view exists to save.

It also gets worse the longer the repo is used through the loop. Each shaping session leaves a brief with a list of open questions that nobody is prompted to answer; the four briefs written today carry more than thirty between them, and the derived state of the board never changes because of them. Each session on a branch changes files that notes describe, and each deleted file leaves a note behind that no page will ever list. The knowledge layer is built on the promise that the owner will notice where it is thin or wrong, and the queue is the first place that promise is kept in one list rather than found page by page.

The cross-repo work is explicitly waiting on it: the one-repo-at-a-time decision says discovery from remotes and manifests waits until the diff and the queue land.

## Suspected area
- packages/reggie/src/story.ts because `needsYouSection` builds the repo landing section from `awaiting-decision` tasks alone, the workspace story does the same from the per-repo summary, and the task page's `questions` section is where the answer form would sit; the queue rows are new story paragraphs or a new payload the story cites
- packages/reggie/src/workspace.ts because `NeedsYouItem` and the `needsYou` filter in the repo summary are the cross-repo half of the same section
- packages/reggie/src/tasks.ts because the state derivation is where the lint result is reduced to `planLintOk`, where the `reason` string is written, and where the brief-on-disk branch decides groomed; the row kinds for lint and for a scaffolded brief are read from what this file already computes and drops
- packages/reggie/src/brief.ts because `lintBrief` and `parseBrief` produce the messages and the question list the queue rows carry, and because the placeholder test is what separates a scaffold from a filled brief that fails
- packages/reggie/src/plan.ts because `lintPlan` is the other lint whose messages only survive as a boolean
- packages/reggie/src/notes.ts because `staleEntriesFor` is the check that skips a note whose entity path is missing, which is where the entity-no-longer-exists class is born
- packages/reggie/src/serve.ts because the queue needs a route to read from, the answer needs a route to write to, and the existing intake-answer endpoint is the shape the new one should mirror rather than reuse
- packages/reggie/src/capture.ts because the append-a-detail-line function there is the nearest existing writer to an append-under-a-section writer for the brief
- packages/reggie/src/mcp.ts because the decision says MCP and the CLI wrap the same functions, so a queue read and an answer write probably want a tool each
- packages/reggie/ui/board.js because the decision cards, the badge that shows lint as a tick or a cross, and the story-column queue are rendered there
- packages/reggie/ui/story.js because the repo and workspace Needs you sections are story sections that hide when empty
- packages/reggie/docs/ui-api-contract.md and packages/reggie/docs/ui-spec.md because both describe Needs you as awaiting-decision cards only, and the contract's task payload documents `planLintOk` as the only lint field
- packages/reggie/src/tasks.test.ts, brief.test.ts and notes.test.ts because each row kind is a pure function of files and git and should be asserted from a fixture

## Open questions
- What does the queue return when the intake-line item has landed and an ungroomed task has no intake line, only a failing scaffold: one row of the ungroomed kind, one row per lint error, or both? The item says to distinguish a scaffolded brief from a filled one that fails lint, and the simplest reading is one row per task naming which of the two it is, with the lint messages inside it rather than one row each.
- Is an intake item a queue row at all, or is the ungroomed column of the board already that list? The intake line says intake items wait unseen, but a row per unshaped item would make the queue as long as the intake file on a repo with thirty captures, and the board's ungroomed column shows the same set with a Shape action already.
  > Answered by jacobpress on 2026-09-15: One aggregate row linking to the ungroomed column, not a row per item; the board already lists them.
- Which lint failures belong in the queue for a plan: any error on a plan draft on the default branch, or only a draft with no plan branch in flight, since a session is presumably still writing the latter?
- How does the queue tell an unanswered question from an answered one once answers are appended under the same section? Bullets under Open questions are all parsed as questions today; an appended answer needs a shape the parser recognises as an answer, indented under its question, prefixed, or dated, and that shape decides whether the question row disappears or just shrinks.
- Who is the "you" in solo mode versus team mode? Decisions have a rights check already; a stale note's owner, an unanswered question's asker and an intake item's captor are three different people, and in team mode the queue may need a filter to the current person or to show everyone's rows with a name on each.
- Does the entity-no-longer-exists class also cover a symbol note, which the stale check skips today because only files and folders can go stale by git, or is it strictly the file-and-folder case the intake note describes?
- Is a missing entity always a deletion, or does the check consult git for a rename, so a note about a moved file is reported as moved rather than gone? History already reads renames for the file story.
- What is the row's action for a stale note? A decision row has Approve and Needs work, a question row has an answer box; a stale note can only be reread and rewritten, retired, or dismissed, and the retire verb is its own captured item that has not been decided.
  > Answered by jacobpress on 2026-09-15: Link to the note on its entity page with the existing Add a note form, one row per note file, clearing when a fresh entry postdates the code change. No new verb until the note-retire item is decided.
- Do rows carry an age and an order? Decisions are ordered by age today; a queue that mixes five kinds needs one ordering, and priority from the brief front matter is available for some rows and not for others.
- Does the queue live at the repo scope only, or also on the workspace page where Needs you is the first section and the payload is a per-repo summary computed without the task detail?
  > Answered by jacobpress on 2026-09-15: Repo scope only. The workspace page shows per-repo counts by row kind from the same function and links to each repo queue.
- Is the answer to a question attributed and dated the way an intake detail line is stamped with handle, source and date, and is it committed on the default branch immediately the way a triage scaffold is, or left in the working tree?
- Does answering the last open question change the task's state or its reason string, given that groomed is derived from the brief passing its contract and a brief with questions still passes?
- Does the queue also read the packet's discovered issues or unresolved review comments, which the vision names as surfacing in the decision queue, or is that the low-risk-auto-approval item's concern?
- Should a brief whose lint passes with warnings only (risk unset, area empty) produce a row, or are warnings advice that never reach the queue?
  > Answered by jacobpress on 2026-09-15: No. Errors only; warnings never reach the queue.

## Not this
- Removing the intake line at triage and reporting a scaffold as ungroomed. That is `intake-line-leaves-at-triage`, which lands first; this item reads the state it produces and does not redefine it.
- A note retire or supersede verb. The stale-note row points at a note; what a person does about it is the captured notes-have-no-way-to-retire item, still undecided.
- Editing a brief from the page beyond appending an answer. The 2026-09-15 decision keeps every other brief and plan edit inside a Claude Code or Codex session.
- The idea action on every page and the discuss launch it opens. The queue may link to a launch, but the action and its context pack are `idea-from-every-page`.
- Auto-capturing a packet's discovered issues into intake and the policy that passes low-risk plans. That is `low-risk-auto-approval`; the queue shows decisions that policy did not take, it does not take them.
- The context pack leaving out the intake line. That is `context-pack-omits-intake-line`, about what a shaping session reads.
- Changing the six task states, their derivation rules or the board columns. The queue is a view over them.
- Cross-repo discovery from remotes. It waits on the queue by decision and is not part of it.
- Episodes or narration reading the queue. They are later milestones; nothing here composes a summary of what is waiting.
