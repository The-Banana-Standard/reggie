---
slug: journal-files-conflict-on-merge-a-claim-in-the-m
title: Stop journal files from colliding when a task branch merges
area: packages/reggie
size: small
risk: low
priority: P1
author: jacobpress
created: 2026-09-15
---
# Stop journal files from colliding when a task branch merges

## Problem
Every journal entry for one person on one day lands in a single file, `.reggie/journal/<date>/<person>-<session>.md`. The session suffix was meant to separate writers, but nothing ever sets it: the environment variable it reads is never populated, and the session id Reggie mints at launch goes to the tool's own `--session-id` flag instead. Every file written since 2026-09-06 is named `jacobpress-session.md`. So the day file is shared by every writer on the machine, whichever checkout or branch they are sitting in.

Two writers then edit it at once. A task branch collects the entries its build session writes from the worktree. The serving checkout keeps writing into the same path on the default branch the whole time: `claim` and `release` append there even when the claim created a separate worktree, `decide` appends there at the moment a verdict is recorded, and the web view appends there whenever someone writes an entry from a page. Both sides have appended to the same lines of the same file, so merging the task branch conflicts. It happened on the first merge and has happened on every merge since, and each one is cleared by hand-editing a file whose whole point is that nobody should ever have to edit it.

There are two distinct failures stacked here, and only one of them is a merge conflict. The first is git having to reconcile two sets of appended lines, which a union merge resolves: take both sides, keep both. The second is worse and a union merge does not touch it. `claim` writes its entry through the serving checkout's paths even when it has just built a worktree, so the moment a task is claimed the serving checkout has an uncommitted change to the exact file the merge wants to write. Git refuses that merge outright rather than merging it badly, and in solo mode Reggie is the one performing the merge, from that same dirty checkout. The agreed first step is one line of `.gitattributes` asking git to union-merge journal files. Whether that line is enough depends on where the claim entry is written, which is the second half of this item.

## Why now
The 2026-09-15 decisions put loop plumbing ahead of every feature and name this second in the order, straight after the stale bin, with the reason attached: the first merge Reggie performs itself should not walk into a collision that is already known. Reggie owning the merge is what attribution by merge commit rests on, and what the derived journal will later read to reconstruct a task's history. A merge that stops with a dirty working tree, or one that a person had to hand-resolve, produces exactly the muddled commit those features are supposed to read cleanly. Every remaining item is built through the loop, so this is paid once now or paid again on every task.

## Suspected area
- .gitattributes because it does not exist in this repo yet, and the agreed fix is the one union-merge line for the journal glob; creating the file is most of the change
- packages/reggie/src/claim.ts because `claimTask` computes a separate `workdir` for the worktree case, commits the claim file there, and then appends the journal entry through the serving checkout's paths regardless; `releaseTask` does the same
- packages/reggie/src/journal.ts because `journalFile` builds the shared name and `sessionName` supplies the suffix that is never set, so this is where any change to which file a writer opens would go
- packages/reggie/src/launch.ts because it mints the session id that the filename slot was apparently meant to carry and passes it to the tool instead
- packages/reggie/src/cli.ts and packages/reggie/src/serve.ts and packages/reggie/src/mcp.ts because they are the other three writers into the shared file, from the serving checkout, and whatever rule claim follows they probably follow too
- packages/reggie/src/onboard.ts because it is what sets a repo up for Reggie, and a repo onboarded tomorrow needs the union line as much as this one does
- docs/repo-manager-vision.md because it carries the decision and should say what shipped once it has

## Open questions
- Does the union line live only in this repo's own `.gitattributes`, or does `reggie onboard` write it into every repo it sets up? If onboard writes it, it has to cope with a repo that already has a `.gitattributes` by appending rather than replacing, which is a slightly larger change than the one-line version.
  > Answered by jacobpress on 2026-09-15: Yes, onboard writes the union line into every repo it sets up, appending if a .gitattributes already exists.
- Where should the claim entry be written when the claim created a worktree: into the worktree, so it rides the task branch, or into the serving checkout as today? The decisions settle that Reggie owns the merge in solo mode, which makes the dirty-checkout failure certain rather than occasional, but they do not name the fix.
  > Answered by jacobpress on 2026-09-15: Into the worktree, committed with the claim, so it rides the task branch and never leaves an uncommitted change on the serving checkout.
- If the entry moves into the worktree, is it committed there as part of the claim commit, or left uncommitted for the build session to carry? An uncommitted entry in the worktree is harmless to the merge, but it is also invisible to anyone reading the branch.
- If the entry stays in the serving checkout, should the verbs that write it commit it themselves on the default branch, so the working tree is clean when the merge runs? Metadata commits on main is already decided, so this would be consistent, but it means claim and release and decide each produce a commit nobody asked for.
- Do `release`, `decide`, the web view and the MCP tool follow whatever rule claim follows, or is claim the only one that has a branch to write to? The other three usually run when no worktree is in play, so the answer may simply be that they are unaffected.
- A union merge concatenates both sides, so entries from two branches can end up out of time order inside the day file. Is that acceptable while hand-written entries last, or does the file need to be re-sorted after a merge? The reader sorts entries by date and time when it displays them, so this may only ever be visible to someone opening the raw file.
- Does anything need to happen for merges performed on GitHub, where the union attribute is ignored? The decision says this does not matter in solo mode, which leaves the team-mode answer open rather than settled.

## Not this
- Naming journal files by branch or by task slug. That is the durable fix the decision explicitly defers; it changes the file scheme, the reader, and every existing path, and it is not the one line agreed for now.
- The derived journal. Deriving entries from session transcripts and commits is its own captured item with its own decision, and it is what eventually makes hand-written entries, and this whole collision, go away.
- What a journal entry says, or who writes one when. This is about which file the writing lands in and whether git can merge it, not about the habit.
- Attribution by merge commit. It shares a motive with this item, that Reggie's own merges should be clean, but it is the next task in the order and touches history rather than the journal.
- The stale bin, the worktree dependency link, and the stray stats file. They are the neighbouring loop-plumbing items from the same decision, each landing as its own task.
