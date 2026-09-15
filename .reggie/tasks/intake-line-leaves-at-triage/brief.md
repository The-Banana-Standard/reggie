---
slug: intake-line-leaves-at-triage
title: Remove the intake line at triage, and report an unfilled brief as ungroomed
area: packages/reggie
size: small
risk: low
priority: P2
author: jacobpress
created: 2026-09-15
---
# Remove the intake line at triage, and report an unfilled brief as ungroomed

## Problem
`.reggie/intake.md` says at the top of itself that it holds raw items waiting for triage, and that an item's line goes away once its plan is merged. Those two sentences disagree, and the code follows the second one: the only caller that deletes a line is `reggie plan done`, a verb a person has to remember to type after the plan is written and committed. Everything between capture and a merged plan leaves the line sitting there. So the file that is supposed to be the queue of unshaped work is really a log of everything ever captured, and the reader has to hold in their head which of the lines have already been answered by a brief.

The decision of 2026-09-15 is that the brief replaces the line. The moment triage writes a brief, the brief is the better record of the same item — it carries the problem statement, an area, a size and a priority, and it is where anything further gets written. Keeping the raw line alongside it means two records of one item, drifting apart, with nothing saying which is current.

The second half of the item is the thing that makes the first half safe. Today the state rule counts any brief as shaping done: a brief on disk with no plan is reported as groomed, with the reason "brief on disk; no plan yet". But `reggie triage` writes a scaffold, not a brief — front matter with size and priority unset, and a parenthesised hint standing in for every section except Problem. That scaffold fails the brief contract on several counts, and the contract exists precisely to say so. Nothing checks it, so scaffolding a brief today silently promotes an item that nobody has thought about yet. Move the deletion to triage without fixing this, and a bulk scaffold would empty intake and report a column of untouched drafts as shaped work, with no record left of what was originally captured.

So the two halves land together: triage takes the line, and a brief that does not pass its own contract keeps the task at ungroomed with the reason naming the draft rather than pretending it is groomed. The rest is telling the truth in the places that currently describe the old behaviour — the state machine's own rules, the sentence in the intake file's header, the API contract's description of what a triage call does, and the state table in the structure document.

## Why now
The needs-you queue is the next feature that reads the board rather than one task, and a queue is only as good as the states behind it. Two of its columns are wrong today: intake carries lines for items that were shaped days ago, and the groomed column counts scaffolds nobody has filled in. A queue built on that shows the owner work that is already done and hides work that has not started, which is the exact failure the queue exists to prevent. Fixing the states first is cheaper than fixing them under a feature that depends on them.

It is also cheap right now and gets dearer later. The behaviour is described in four places and performed in one, and every week of capture adds lines to a file whose header already promises something the code does not do. Once the web board is the way people triage, every one of those descriptions is also a tooltip or a column rule somebody has read and believed.

## Suspected area
- packages/reggie/src/triage.ts because `scaffoldBrief` is the single shared path behind both the CLI verb and the web button, so it is the one place that can take the line and keep the two doors byte-identical
- packages/reggie/src/capture.ts because `removeFromIntake` already exists there and does exactly the deletion this item wants, just called from the wrong moment
- packages/reggie/src/cli.ts because `reggie plan done` is the verb whose whole body is that call, and its description sentence is one of the four places that describe the old rule
- packages/reggie/src/tasks.ts because the state derivation lives there: the branch that turns a brief into groomed, the reason strings a card shows, and the `STATE_MACHINE` constant whose per-state rules and transition triggers are rendered in the UI and served over the API
- packages/reggie/src/brief.ts because `lintBrief` is the contract the new rule would consult, and the template's own comment already claims a scaffold fails it
- packages/reggie/docs/ui-api-contract.md because it tells a page author that a triage call moves a card from ungroomed to groomed, which is the behaviour being changed
- docs/how-reggie-structures-a-repo.md because its state table still says an item is ungroomed while an intake line exists and no plan does
- .reggie/intake.md because its header paragraph states the plan-done rule to every person and session that opens the file
- packages/reggie/src/serve.ts because the triage endpoint and the endpoint that appends answers to an intake line sit next to each other and both touch the line this item removes

## Open questions
- Does triage take the line when it scaffolds, or only once the brief passes its contract? Taking it at scaffold time is the literal reading of the decision, but it leaves an item that is still reported as ungroomed with no intake line behind it and only a half-filled draft standing for it. Waiting for a clean lint keeps a record for exactly as long as the item is unshaped, at the cost of a second moment that has to notice.
- What becomes of `reggie plan done`? Its entire body is the removal call. It can be retired, or kept as a verb that quietly reports the line was already gone. The 2026-09-15 block does not say, and retiring a verb touches whatever documents and prompts name it.
- Which lint failures should drop a task back to ungroomed — any error, or only the scaffold placeholders? A brief a person genuinely wrote but left `size: unset` on also fails the contract today, and calling that ungroomed would erase visible work.
  > Answered by jacobpress on 2026-09-15: Only an unfilled scaffold drops to ungroomed: placeholder text still present, or an empty Problem. A brief missing size or priority stays groomed with the lint reason on the card.
- Is the plan-draft rule now inconsistent with the brief rule? A plan draft that fails its contract leaves the task at groomed with the reason naming the draft; this item makes a brief draft that fails its contract drop to ungroomed instead. Both are defensible, but they should be one story, and the difference will be read as a bug by the next person to meet it.
- Once the line is gone, how does re-triaging with `--force` prefill the Problem section? It reads the intake line today, and after this change there is nothing to read. Either the raw capture survives somewhere, or `--force` becomes a rewrite that silently drops the original words.
- What should the web form that appends answers to an intake line do for an item that has been triaged? It currently creates a line for an item that has none, which after this change would reconstruct the very line triage removed, and possibly pull the card backwards. Answers probably belong in the brief now, which is a different endpoint and a different shape.
- What dates an ungroomed card once the line is gone? Card age falls back to the intake date when there is no branch activity, so an item with only a failing draft has nothing to age from unless the brief's `created` field is used.
- Should the removed line be recoverable other than through git history — a copy inside the brief, or a done section of the intake file? Nothing in the decision requires it, but a bulk `reggie triage --all` would remove many lines at once and the raw wording is sometimes the only record of what the person actually meant.
- Does anything outside this repo read `.reggie/intake.md` and expect a line to live until its plan merges? The MCP capture tool and the generated instruction blocks both talk about intake, and their wording may need the same correction as the four documents.

## Not this
- The needs-you queue itself. This item exists so the queue's columns mean what they say; the rows, the decision cards and the layout are the queue's own task.
- The context pack leaving out the intake line and its detail. That is its own captured item, and it becomes more urgent once triage removes the line, but it is about what a shaping session gets to read, not about when the line dies.
- Changing what a brief must contain. The contract is taken as it stands; this item only starts consulting it where nothing consults it today.
- Making triage fill briefs in rather than scaffold them. Shaping stays a session's job; the scaffold is deliberately empty, and this item is about how an empty one is reported.
- The legacy backlog reader's own notion of ungroomed, which derives state from headings in `TASKS.md`. That path is on its way out with the v2 retirement and should not grow a new rule.
- The journal, worktree and attribution items from the same 2026-09-15 decision. They are the neighbouring loop-plumbing tasks and each lands separately.
