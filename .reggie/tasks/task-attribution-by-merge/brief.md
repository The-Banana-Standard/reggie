---
slug: task-attribution-by-merge
title: Join commits to tasks by the merge commit
area: packages/reggie
size: medium
risk: medium
priority: P1
author: jacobpress
created: 2026-09-15
---
# Join commits to tasks by the merge commit

## Problem
Reggie cannot reliably say which commits belong to a task, so the record of what a task actually changed is thin where it should be richest. The join is made in two places and both of them leak. The history index reads `Task:` out of git's trailer block alone, through a `%(trailers:key=Task,valueonly)` field in the log format, so a session that writes the line above `Co-Authored-By` but outside the final trailer paragraph writes a line Reggie never sees. The fallback, reading `task/<slug>` out of the subject, only catches merge subjects and branch-prefixed subjects, so an ordinary commit on a task branch with a body-level `Task:` line joins to nothing.

The second leak is the merge commit itself. The history log runs `--numstat` without `-m` and without `--first-parent`, so a merge commit arrives with a header and no file lines at all. That is the one commit guaranteed to name the task in its subject, and it is the one commit that reports changing nothing. So the whole of a landed task's diff hangs on the individual branch commits having been joined correctly — and once the task branch is deleted, those commits are only findable through a join that may never have been made.

The consequence is visible in the Completed view. `completionCommits` in `serve.ts` asks the history index for commits whose task matches the slug, and falls back to logging `base..task/<slug>` only while the branch still exists. A task that landed and had its branch released shows an empty commit list, which means `completionDiff` reports no files, no lines and no commits, and the page that exists to answer "how do I know it was done" answers with a blank. What it needs from this work is one lookup that returns a finished task's commits from the merge commit, with per-file numbers, long after the branch is gone.

The same lookup is what the planned `reggie journal derive <slug>` verb rests on. The 2026-09-15 decision says the verb must work for a task in flight and for a completed one, and for a completed one the only durable handle on the work is the merge commit: the branch is gone, the transcript is found by a session id, and the commits are found by walking the merge. What derive needs from this work is the ability to ask for a completed task's commits by slug alone and get back shas, subjects, authors and files, without a branch and without depending on any per-machine hook.

Underneath both is a gap in the loop: nothing in Reggie performs a merge today. There is no merge call anywhere in `packages/reggie/src`. `reggie decide <slug> approved` writes a verdict into the packet and appends a journal entry, and the task flips to done because a packet on the base branch says approved — the branch is merged later, by hand, by whatever command the person happens to type. The decision closes that: in solo mode `decide approved` performs the `--no-ff` merge itself so the merge commit always exists, and team mode keeps merge commits on GitHub, never squash and never rebase, because a squash destroys the per-commit join and a rebase destroys the merge commit the join now depends on. When the merge conflicts, `decide` aborts and reports: the merge is undone, the base branch and the task branch are left exactly as they were, and the verdict does not silently claim a landing that did not happen.

## Why now
The 2026-09-15 decisions put loop plumbing ahead of every feature and place this third in the order, after the stale bin and the journal union-merge line. It sits there because it is the join that "what landed" and "what changed and why" both rest on, and because it must not depend on a session remembering a habit or on a hook installed on one machine. Two of the items queued behind it — the derived journal and the Completed view's evidence — are built directly on top of it and cannot be finished first.

It also gets harder the longer it waits, in a way most items do not. Every task that lands before the join is fixed lands as history that is already wrong: commits whose `Task:` line was never parsed, and merge commits that report no files. Reggie reads a year of history, so a bad join is not a transient bug, it is a growing hole in the record the web view narrates from. The three merges performed so far are already in that state.

The merge half is urgent for a second reason. The low-risk auto-approval decision has Reggie owning the merge as an explicit precondition, so `decide` gains the merge either here or there; doing it here means the first automatic approval lands through a merge path that a human has already watched work.

## Suspected area
- packages/reggie/src/history.ts because `HISTORY_LOG_FORMAT`, `parseNumstatLog`, `taskFromTrailers` and `taskFromSubject` are the join as it exists today; a body-wide `Task:` parse changes the log format and the parser together, and merge-commit files change which git options the log runs with
- packages/reggie/src/serve.ts because `completionCommits` is the consumer that fails first, and because `completionDiff` sums per-file churn across whatever that lookup returns, so it is where double counting would show up if a merge's files were added beside the branch commits that already carry them
- packages/reggie/src/packet.ts because `decidePacket` is what records an approved verdict, and the merge in solo mode hangs off that verdict being written
- packages/reggie/src/cli.ts because the `decide` command wires the verdict, the journal entry and whatever the merge turns out to be, and it is where an abort has to turn into a message a person reads
- packages/reggie/src/git.ts because every git call goes through it and a merge, a conflict abort and a first-parent diff are new shapes of call rather than variations on the existing read-only ones
- packages/reggie/src/claim.ts because it writes the `Task:` line on the claim commit today and is the one place the convention is currently produced rather than consumed
- packages/reggie/src/launch.ts because the build prompt tells a session to commit with the `Task:` line, and what the parser accepts and what the prompt asks for should not drift apart
- packages/reggie/src/tasks.ts because task state is derived from branches, packets and pull requests, and a task whose branch was deleted after a Reggie-performed merge has to keep reading as done
- .reggie/.cache because the history index is cached with a version number, and a change to what the log records invalidates every cache written before it

## Open questions
- How does the log format carry a whole commit body without breaking the parser? The current format is one pipe-delimited header line per commit, which cannot hold a multi-line body; the choices are a record-separated format, a NUL-delimited one, or a second pass that reads bodies only for commits that need them. This changes the size of the cached index as well as the parser.
- Does the index store every commit's full body, or only the first `Task:` value found in it? Storing the body makes later questions (the `Co-Authored-By` item, for one) cheap and makes the cache much larger.
- When a commit's body names one slug and its subject or branch names another, which wins? Today the trailer wins and the subject is only a fallback, and nothing reports the disagreement.
- Does a merge commit's file list replace the files already counted from the commits it brings in, or add to them? Counting both doubles every landed task's churn in the ownership and hotspot data that history.ts feeds, so one of the two has to be excluded somewhere, and which one is not settled.
- Does `reggie decide approved` also delete the task branch and its worktree after a successful merge, or leave the release as a separate act? Related: does it push, and what does it do when the remote rejects the push.
  > Answered by jacobpress on 2026-09-15: Release the worktree and the local branch after a successful merge, reusing the release path; do not push. The repo owns decisions and the loop must work offline.
- What does the merge commit's own message say? A subject naming `task/<slug>` is enough for the subject-based join, but whether the body also carries the `Task:` line, the verdict and the decider is unsettled, and the derived journal may want them there.
- Does `decide` merge before or after committing the packet verdict, and on which branch does the verdict commit land? The two orders leave different histories behind when the merge aborts.
- How does team mode enforce merge commits rather than merely require them? Checking GitHub's merge method through the API, warning when a landed task has no merge commit, or documenting the setting and trusting it are three different amounts of work.
  > Answered by jacobpress on 2026-09-15: Not now. Team mode is deferred until the loop works for one person; nothing team-mode is built or decided in this task.
- What does a completed task's lookup do when the merge is older than the history window? The index reads a year of history by default, and a task whose branch is gone has no other handle.
- Does `reggie journal derive` want the merge sha recorded in the packet or the task folder when the merge happens, or should it re-find the merge by walking the base branch each time? Recording it is cheaper and makes the packet the record of the landing; re-finding it survives a merge Reggie did not perform.
- Does the merge Reggie performs disable commit signing the way `claim` does with `commit.gpgsign=false`, or should a merge that lands work be signed like a person's own merge.
- What does `decide approved` do when the branch is already merged, or has nothing ahead of the base? Reporting it as already landed and recording the existing merge is one answer; refusing is another.

## Not this
- The journal files that conflict on every merge. That is `journal-files-conflict-on-merge-a-claim-in-the-m`, which lands before this one and adds the `.gitattributes` union line; the collision behind the last three merges is its problem, not this one's. This item assumes it is already fixed, because the first merge Reggie performs should not walk into a known conflict.
- Building `reggie journal derive`. This work makes a completed task's commits findable, which is the thing derive was blocked on; the verb, its transcript reading and its listener-register prose are their own task.
- Showing the diff itself. Reading hunks in the reader is `branch-diff-in-reader`, which adds the patch routes; this item is about which commits belong to a task and what files they touched, not about rendering what changed inside them.
- Parsing `Co-Authored-By` into per-commit coauthors. It reads the same commit bodies and may reuse whatever this item does to the log format, but its question is who wrote a file rather than which task a commit belongs to.
- Low-risk auto-approval. Reggie owning the merge is one of that item's preconditions, which is why the merge is built here, but the policy that decides without a human is separate and lands later.
- The stale bin. A `decide` that performs a merge is the most expensive verb to run from an old build, which is why that item is first in the order; it does not change what the merge does.
