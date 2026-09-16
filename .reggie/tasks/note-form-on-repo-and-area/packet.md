---
slug: note-form-on-repo-and-area
title: Once a repo or area has one note there is no way to add another from the page
risk: medium
author: jacobpress
date: 2026-09-15
branch: task/note-form-on-repo-and-area
base: repo-manager
verdict: approved
decided_by: jacobpress
decided_at: 2026-09-16T02:29:07.235Z
---
# Completion: Once a repo or area has one note there is no way to add another from the page

Read this top to bottom to decide whether the work is done. Every claim should point at evidence.

## Acceptance criteria
- [x] Exactly one function in `packages/reggie/src/story.ts` builds the add-note section; it takes the scope and the note entity as parameters, and `repoStory`, `areaStory` and `fileStory` are its only callers.
  evidence: .reggie/tasks/note-form-on-repo-and-area/evidence/one-builder.txt
- [x] `repoStory` emits the section ids `needs-you, what, made-of, starts, talks, flight, recent, gaps, run, add-note` in that order, in the default lens and under `lens=knowledge` alike.
  evidence: .reggie/tasks/note-form-on-repo-and-area/evidence/section-ids.txt, .reggie/tasks/note-form-on-repo-and-area/evidence/tests.txt
- [x] `areaStory` emits `read-first, inside, uses, used-by, tests, people, tasks, recent, add-note` in that order, and under `lens=knowledge` the last id is still `gaps`.
  evidence: .reggie/tasks/note-form-on-repo-and-area/evidence/section-ids.txt, .reggie/tasks/note-form-on-repo-and-area/evidence/tests.txt
- [x] `fileStory` emits `read-first, exports, used-by, uses, tests, tasks, history, add-note` unchanged, and under `lens=knowledge` the last id is still `gaps`.
  evidence: .reggie/tasks/note-form-on-repo-and-area/evidence/section-ids.txt, .reggie/tasks/note-form-on-repo-and-area/evidence/tests.txt
- [x] The workspace, task-with-a-plan, task-with-a-brief, task-with-an-intake-line, services and flow section-id lists are byte-identical to the ones at the landing commit of `graph-coverage-published`.
  evidence: .reggie/tasks/note-form-on-repo-and-area/evidence/lists-frozen.txt
- [x] At every one of the three scopes the section has id `add-note`, heading `Add a note`, zero paragraphs, a non-empty `empty.text` and `empty.action.form` equal to `note`, so the client's `renderSection` cannot drop it for want of empty text.
  evidence: .reggie/tasks/note-form-on-repo-and-area/evidence/tests.txt, .reggie/tasks/note-form-on-repo-and-area/evidence/section-ids.txt
- [x] The empty text names its scope: the repo sentence ends `about this repo.`, the area sentence ends `about this area.`, and the file sentence is byte-identical to the one `EMPTY_TEXT.fileAddNote` holds today.
  evidence: .reggie/tasks/note-form-on-repo-and-area/evidence/empty-text.txt, .reggie/tasks/note-form-on-repo-and-area/evidence/tests.txt
- [x] `EMPTY_TEXT` no longer exports a `fileAddNote` key, its three replacement keys are the only source of those three sentences, and no call site in `story.ts` inlines any part of one.
  evidence: .reggie/tasks/note-form-on-repo-and-area/evidence/empty-text.txt, .reggie/tasks/note-form-on-repo-and-area/evidence/one-builder.txt
- [x] The terminal hint reads `reggie note add <entity> --type why "…"` at all three scopes, so the copied command writes the same note type the rendered form posts.
  evidence: .reggie/tasks/note-form-on-repo-and-area/evidence/hints.txt, .reggie/tasks/note-form-on-repo-and-area/evidence/tests.txt
- [x] The hint entity is `_repo` on a repo page, the folder path with a trailing slash on an area page, `_repo` on the repo root reached as an area page with id `.`, and the repo-relative path on a file page; the area expression is written once and read by both the add-note hint and the read-first empty state.
  evidence: .reggie/tasks/note-form-on-repo-and-area/evidence/hints.txt, .reggie/tasks/note-form-on-repo-and-area/evidence/section-ids.txt
- [x] In a repo with no notes at all, the repo story carries two actions with `form: "note"` and the area story carries two, and on each page both forms resolve through `noteEntityFor` to the same note entity.
  evidence: .reggie/tasks/note-form-on-repo-and-area/evidence/degenerate.txt, .reggie/tasks/note-form-on-repo-and-area/evidence/two-forms.txt
- [x] In a repo whose only note is the `_repo` note with a `why` entry that `reggie onboard` writes, the repo story carries exactly one action with `form: "note"` and the area story carries exactly one, and the area's is the new section with the area's own entity in its hint.
  evidence: .reggie/tasks/note-form-on-repo-and-area/evidence/degenerate.txt, .reggie/tasks/note-form-on-repo-and-area/evidence/section-ids.txt
- [x] On an area page whose read-first section is filled only by inherited entries, the sentence `No note is written on` … `itself; everything above is inherited from the repo and the folders around it.` and an `add-note` section whose hint names that same folder both appear in the same payload.
  evidence: .reggie/tasks/note-form-on-repo-and-area/evidence/degenerate.txt, .reggie/tasks/note-form-on-repo-and-area/evidence/section-ids.txt
- [x] In a repo whose `_repo` note has `how` entries and no `why` entry, the repo story's `what` section is empty and carries a note form while `add-note` is also present, and the area story's `read-first` is filled while `add-note` is its only note action.
  evidence: .reggie/tasks/note-form-on-repo-and-area/evidence/degenerate.txt, .reggie/tasks/note-form-on-repo-and-area/evidence/section-ids.txt
- [x] In a repo with no code files, and therefore no area pages, the repo story still emits `add-note` with its empty text and its note form.
  evidence: .reggie/tasks/note-form-on-repo-and-area/evidence/degenerate.txt, .reggie/tasks/note-form-on-repo-and-area/evidence/section-ids.txt
- [x] `HEADINGS.repo` and `HEADINGS.area` in `packages/reggie/ui/story.js` each end with `["add-note", "Add a note"]`, so `sectionHeadingsFor` returns the same headings in the same order as the payload for the repo, area and file scopes.
  evidence: .reggie/tasks/note-form-on-repo-and-area/evidence/skeleton.txt, .reggie/tasks/note-form-on-repo-and-area/evidence/client-diff.txt
- [x] The spotlight fallback toast in `packages/reggie/ui/app.js` names the repo scope alongside areas and files, and no reader-facing string in `ui/` still claims a note can be added only from a file or an area.
  evidence: .reggie/tasks/note-form-on-repo-and-area/evidence/client-diff.txt
- [x] `emptyBlock`, `noteForm`, `noteEntityFor` and `focusNoteForm` in `packages/reggie/ui/story.js` are unchanged from the landing commit of `graph-coverage-published`.
  evidence: .reggie/tasks/note-form-on-repo-and-area/evidence/client-diff.txt
- [x] The section-ids line in `packages/reggie/docs/ui-api-contract.md` lists `add-note` last for the repo and area scopes and leaves every other scope's list alone.
  evidence: .reggie/tasks/note-form-on-repo-and-area/evidence/docs-diff.txt
- [x] `packages/reggie/docs/ui-spec.md` has an `add-note` row in the §2 repo table, names **Add a note** in the §3 Level 2 area walkthrough, and its §4 table has a row for the always-present section separate from the unchanged "Notes (any chain)" row.
  evidence: .reggie/tasks/note-form-on-repo-and-area/evidence/docs-diff.txt
- [x] `ui/dev/sample-story.json` and `ui/dev/sample-story-empty.json` both carry the `add-note` section last, and loading `sample-story-empty.json` in `ui/dev/story-harness.html` renders two note forms on the one page.
  evidence: .reggie/tasks/note-form-on-repo-and-area/evidence/samples.txt, .reggie/tasks/note-form-on-repo-and-area/evidence/two-forms.txt, .reggie/tasks/note-form-on-repo-and-area/evidence/two-forms.html
- [x] `src/story.test.ts` and `test/serve.test.ts` pass with only their repo and area exact-array assertions changed, and deleting the add-note section from `repoStory` or from `areaStory` makes at least one named test in each of those two files fail.
  evidence: .reggie/tasks/note-form-on-repo-and-area/evidence/lists-frozen.txt, .reggie/tasks/note-form-on-repo-and-area/evidence/mutation-probe.txt
- [x] Run from `packages/reggie`, `TZ=UTC npm test`, `npm run typecheck` and `npm run build` each exit 0 at the landing commit.
  evidence: .reggie/tasks/note-form-on-repo-and-area/evidence/build.txt

## Evidence
- .reggie/tasks/note-form-on-repo-and-area/evidence/build.txt
- .reggie/tasks/note-form-on-repo-and-area/evidence/client-diff.txt
- .reggie/tasks/note-form-on-repo-and-area/evidence/code-review.txt
- .reggie/tasks/note-form-on-repo-and-area/evidence/degenerate.txt
- .reggie/tasks/note-form-on-repo-and-area/evidence/docs-diff.txt
- .reggie/tasks/note-form-on-repo-and-area/evidence/empty-text.txt
- .reggie/tasks/note-form-on-repo-and-area/evidence/headings-payload.mjs
- .reggie/tasks/note-form-on-repo-and-area/evidence/hints.txt
- .reggie/tasks/note-form-on-repo-and-area/evidence/lists-frozen.txt
- .reggie/tasks/note-form-on-repo-and-area/evidence/mutation-probe.txt
- .reggie/tasks/note-form-on-repo-and-area/evidence/one-builder.txt
- .reggie/tasks/note-form-on-repo-and-area/evidence/probe.mjs
- .reggie/tasks/note-form-on-repo-and-area/evidence/samples.txt
- .reggie/tasks/note-form-on-repo-and-area/evidence/section-ids.txt
- .reggie/tasks/note-form-on-repo-and-area/evidence/skeleton.mjs
- .reggie/tasks/note-form-on-repo-and-area/evidence/skeleton.txt
- .reggie/tasks/note-form-on-repo-and-area/evidence/tests.txt
- .reggie/tasks/note-form-on-repo-and-area/evidence/two-forms.html
- .reggie/tasks/note-form-on-repo-and-area/evidence/two-forms.txt

## Changes

The nine files the plan named, plus one it did not (`ui/dev/sample-story-file.json`, see Deviations),
and the task's own records. Against `repo-manager`, the product change is:

```
 packages/reggie/src/story.ts                   |  47 +-
 packages/reggie/src/story.test.ts              | 230 ++++++++-
 packages/reggie/test/serve.test.ts             |   4 +-
 packages/reggie/ui/story.js                    |   2 +
 packages/reggie/ui/app.js                      |   2 +-
 packages/reggie/docs/ui-api-contract.md        |   2 +-
 packages/reggie/docs/ui-spec.md                |   4 +-
 packages/reggie/ui/dev/sample-story.json       |   6 +
 packages/reggie/ui/dev/sample-story-empty.json |   6 +
 packages/reggie/ui/dev/sample-story-file.json  |   2 +-
 10 files changed, 290 insertions(+), 15 deletions(-)
```

Alongside it the commit carries eight file notes, the claim, the completion packet and twenty
evidence files, for 41 files and 2316 insertions in total.

What actually changed in the product:

- `fileAddNote(node)` became `addNoteSection(scope, entity)`. `repoStory` calls it with `"repo", "_repo"`,
  `areaStory` with `"area", areaNoteEntity(dirPath)`, `fileStory` with `"file", node.id`, and they are
  its only callers. It goes last in all three base section lists, which leaves `gaps` last under
  `lens=knowledge` at area and file by construction, so the existing assertion on that was not touched.
- `EMPTY_TEXT.fileAddNote` became `addNoteRepo`, `addNoteArea` and `addNoteFile`, read through one
  `ADD_NOTE_TEXT` record so no call site inlines the wording. The file sentence is byte-identical to
  the one at `dd613ed`.
- `areaNoteEntity(dirPath)` lifts the expression `areaReadFirst` already computed; both it and the
  read-first empty state now read it, so a folder is never offered two spellings of its own note.
- The terminal hint says `--type why` at all three scopes. At file scope this is a correction: the
  rendered select has always posted `why`, so the page's copied command and its own button disagreed.
- Client: two `HEADINGS` rows so the loading skeleton matches the payload, and one toast reworded.
  The rendering functions are untouched.
- Docs: the contract's section-ids line, and three edits to the spec.
- Samples: `add-note` last in the two repo samples; the file sample's retired `--type how` corrected.

Nothing was built on the client: `emptyBlock` already renders a form for any empty section carrying a
note action, and `noteEntityFor` already maps a repo story and an area story to the right entity.

## Reviews

`/code-review`, medium effort, pointed explicitly at this worktree
(`.worktree/repo-manager/.worktree/note-form-on-repo-and-area`, branch `task/note-form-on-repo-and-area`).
Full transcript and the confirmation work in `evidence/code-review.txt`.

It was checked, not assumed, that the review read this branch rather than a merged checkout: its
output names `addNoteSection`, `areaNoteEntity`, the `EMPTY_TEXT.fileAddNote` rename, the
`--type how` -> `--type why` correction, the `…, add-note, gaps` lens ordering and the two new
call-site line numbers — none of which exist in the merged tree.

Three findings, none a defect in the change itself:

1. MEDIUM, `ui/app.js:1533` — the Spotlight's "Add a note" focuses the first note form on the current
   page rather than one for the node it describes, so tapping an area node on the repo map and
   clicking it writes to `_repo`. NOT FIXED. Already captured before this task began as
   `the-spotlight-s-add-a-note-button-focuses-whatev`, and ruled out of scope by the plan because the
   fix needs an `entity` channel on `StorySection.empty.action` that the contract does not have.
   The review adds one thing the capture did not say, and it is the most important sentence in this
   packet: **this change widens that exposure.** Before it, an onboarded repo had no form on the repo
   page or any area page, so the button fell through to a warn toast and the reader navigated. Now
   every repo and area page carries a form, so the path that used to warn instead succeeds against
   the page's own entity. The plan's mitigation is real and was verified in the browser — the form
   prints "on `_repo`" above the textarea and the success toast names what it wrote to — so it is a
   visible mis-target, not a silent one. It should be done soon.
2. LOW, the repo root as an area page — the hint says `_repo`, the client's `noteEntityFor` makes the
   form say `./`. NOT FIXED. Pre-existing (`areaReadFirst` already spelled it `_repo`) and already
   captured as `the-repo-root-reached-as-an-area-page-shows-the`. Both resolve to the same note
   through `resolveNoteTarget`, so nothing is written to the wrong place.
3. LOW, narration — NEW, not anticipated by the plan. Verified by measurement rather than taken on
   the review's word: `spokenSection` renders a paragraph-less section as its empty sentence and
   `narrate` filters no ids, so every repo and area episode now ends "Add a note. Write what the next
   person should know about this repo." before the outro. NOT FIXED, CAPTURED as
   `the-audio-episode-for-a-repo-or-an-area-now-ends`. See Discovered issues.

Nothing in the change was altered in response to the review. `/simplify` was deliberately not run: it
applies edits and could write into the serving checkout the queue depends on.

## Deviations from plan

Four, all small, all recorded here:

1. **One extra file: `packages/reggie/ui/dev/sample-story-file.json`.** The plan names nine files and
   says the two repo samples are the only ones to update. But that sample's hand-written hint still
   read `reggie note add packages/reggie/src/paths.ts --type how "…"`, which the same commit was
   retiring everywhere else. The note on `packages/reggie/ui/dev/` is explicit that these samples have
   no generator and no test reading them, and that when a sentence changes you must grep the repo for
   the phrase you retired and fix them by hand. Left alone it would have been a checked-in sample
   contradicting the payload. One token changed: `how` -> `why`.

2. **Criterion 15's verification strategy was wrong, and the test asserts the measured truth instead.**
   The strategy says to assert "that `areaStory` returns null for every path" in a repo with no code
   files. It does not: the root dir node exists in the graph regardless, so `areaStory(ctx, ".")`
   returns a real story while `"src"`, `"src/big"` and `"doc"` are all null. Writing the assertion as
   specified would have meant a failing test, or a passing one that lied. The test asserts null for
   every path *below* the root, and that the root is still reachable with its hint reading `_repo`.
   The criterion itself — the repo story still emits `add-note` with its empty text and its form — is
   met unchanged. Measurement in `evidence/degenerate.txt` and `evidence/section-ids.txt`.

3. **`evidence/two-forms.png` was not produced.** Criterion 21's strategy asks for a screenshot. There
   is no headless browser in `packages/reggie/node_modules`, and the only other way to write a PNG here
   is macOS `screencapture`, which grabs the whole desktop of a machine whose owner is asleep, into a
   repo that is public on GitHub. That was judged not safe to commit. The criterion's own claim —
   loading `sample-story-empty.json` in the harness renders two note forms on one page — was verified
   in a real browser against a server running this worktree, and what is committed instead is stronger
   than a picture for this claim: the DOM values themselves in `evidence/two-forms.txt` (both forms
   carry `data-entity="_repo"`, both print `on _repo`, both default to `why`, both print the same
   command) plus `evidence/two-forms.html`, a standalone rendering of the two sections a reviewer can
   open. A screenshot was taken and read in the session and showed exactly that.

4. **An edit was made and then reverted.** `whatSection`'s hint was briefly rewritten to read a new
   `REPO_NOTE_ENTITY` constant. The rendered string was byte-identical, so it was a diff with no
   observable effect — exactly the churn the plan rejects when it declines to change the action's
   `label`. Both the constant and the rewrite were reverted and the plan's literals stand.

Two things the plan predicted that are worth confirming rather than deviating from: `test/serve.test.ts`
did hold the repo and area lists a second time, so four exact arrays changed and not two; and there is
no area-scope sample under `ui/dev` to add.

Where the plan left a choice open it was decided as the Approach points, with no open question
re-opened. Nothing was asked of the owner.

## Discovered issues

One new, captured rather than fixed:

- `the-audio-episode-for-a-repo-or-an-area-now-ends` — the audio episode for a repo or an area now
  ends by reading out the Add a note form's empty text. `spokenSection` (`src/narrate.ts:109`) renders
  a section with no paragraphs as its empty sentence, and `narrate` (`src/narrate.ts:128`) maps every
  section with no id filter. `add-note` has no paragraphs at any scope by construction, so every
  episode now ends "Add a note. Write what the next person should know about this repo." right before
  the outro. Measured on a throwaway repo at all three scopes. File episodes already did this before
  this task; this change extends it to the two most-listened scopes. Not fixed here because the fix
  belongs in `src/narrate.ts`, a file the plan neither lists nor analysed, and because the behaviour is
  pre-existing rather than introduced. Someone has to decide whether narration should skip sections
  that exist only to carry a form, or whether an end-of-episode call to action is wanted and should be
  written for a listener instead of borrowed from the page.

Confirmed but already captured while planning, so not captured again:

- `the-spotlight-s-add-a-note-button-focuses-whatev` — widened by this change; see Reviews.
- `the-repo-root-reached-as-an-area-page-shows-the` — the `_repo` / `./` disagreement at the root.
- `the-inline-note-form-ignores-the-section-s-inten` — the reason the hint had to be corrected to
  `--type why` rather than the select taught to honour the hint.

Also noticed and deliberately left alone: `src/cli.ts:525` still suggests `reggie note add <file>
--type how "..."`. That is a terminal message with no button beside it to disagree with, so it is
correct as it stands and is not the same defect as the web hint.

One environment observation for the queue, not a repo problem: port 4422 was already held by a
different checkout still serving the nine-section sample, so it was left untouched and the browser
verification used port 4519. That server is still listening on loopback; stopping it was refused by
the sandbox. It serves this worktree only and does not interfere with 4422.

## Open risks

- **The Spotlight mis-target is now reachable everywhere.** This is the one thing a reviewer should
  weigh before merging. It is a pre-existing defect with an existing capture, but this change turns a
  path that used to warn into one that quietly writes to the page's entity. How someone would notice:
  pin a Spotlight for a child node on a repo or area page, click Add a note, and watch the form's
  "on `<entity>`" label name the page rather than the node. Mitigated by that label and by the success
  toast naming what was written. If that is judged too sharp an edge to ship, the bail is to take the
  capture next rather than to hold this, because reverting this would put every area page back to
  having no note form at all.

- **Two forms on one page is accepted, not solved.** It exists only while nothing has been written on
  the page, and the first note ends it. Both forms were measured to carry the same entity, in the DOM
  and in the tests, so the duplication cannot send a note to the wrong place. It will look odd on a
  brand-new repo. Someone would notice it as two identical forms stacked on the repo page.

- **The samples are still hand-written and nothing tests them.** `ui/dev/sample-story-file.json`
  carried a retired hint into this task precisely because of that. The next wording change will have
  the same trap. Captured previously as the `ui/dev` note's own gotcha, not solved here.

- **The spec quotes real sentences as the specification and nothing checks it.** The three new spec
  edits are correct today and will rot the same way the made-of row did. The §4 row deliberately
  quotes all three empty sentences, which is three more strings to keep in step.

- **The local-time test failure is pre-existing but will keep firing.** `npm test` without `TZ=UTC`
  fails `src/tasks.test.ts > "assembles plan, packet, claim, journal, and impact as a task moves"` in
  a negative-offset timezone. It is unrelated to this task, in a file this task does not touch, and is
  captured as its own item. Anyone running the suite locally in the evening will see it and should not
  chase it here.

- **Not verified: phone-width layout.** The plan's bail conditions include the new section pushing
  "How to run it" below a scroll on a narrow layout. That was not measured. The section is last and
  `run` renders as a collapsed `<details>`, so the risk is low, but the claim is untested and is
  stated as untested rather than assumed.


## Decision
- approved by jacobpress on 2026-09-15: Overnight run: independently re-ran TZ=UTC suite (665 passed, +12) and verified scope is 10 product files (plan's 9 plus one declared deviation). Both mutation probes fail named tests in two files. All six degenerate states verified against real output, including the onboarding default state. Accepted caveat, captured not fixed: this widens an already-captured Spotlight mis-target from rare to every repo/area page; reverting would leave every area page with no note form, so the capture is the right next task. Approved by the manager session under the overnight delegation.
