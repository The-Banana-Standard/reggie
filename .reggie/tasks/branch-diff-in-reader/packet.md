---
slug: branch-diff-in-reader
title: Show what a task changed, line by line, inside the reader; no route returns a hunk anywhere today
risk: medium
author: jacobpress
date: 2026-09-17
branch: task/branch-diff-in-reader
base: repo-manager
verdict: approved
decided_by: jacobpress
decided_at: 2026-09-17T10:59:02.121Z
---
# Completion: Show what a task changed, line by line, inside the reader; no route returns a hunk anywhere today

Read this top to bottom to decide whether the work is done. Every claim should point at evidence.

Each criterion's `evidence:` line holds file paths and nothing else, so that Reggie's own packet
reader can link them; the `how:` line under it says what in those files to look at.

Built unattended; nobody was available to answer anything. Two independent sessions then reviewed
the branch at `101166b`, one for code and one for security, and this packet was written after their
findings were resolved. 44 of the 47 criteria are met as written. Three are ticked with a statement
beside them that should be read before the tick is believed: AC29 cannot be literally true beside
AC40, and what is actually met is said there; AC35 holds with a caveat about a page that was already
too wide; and AC44 rests on an independent security review, **not** on the borrowed
`/security-review` skill, which nobody ran.

## Acceptance criteria
- [x] AC1 `TaskInfo` carries `branchRef`: `task/<slug>` for a local task branch, `origin/task/<slug>` when only the remote-tracking ref exists, and `null` for a task with no task branch, including one that has only a `plan/<slug>` branch.
  evidence: .reggie/tasks/branch-diff-in-reader/evidence/tasks-branchref.txt, .reggie/tasks/branch-diff-in-reader/evidence/branchref-board-diff.txt
  how: `tasks-branchref.txt` — one case over a bare origin: a local branch, a branch pushed and then deleted locally so only the remote-tracking ref is left, a `plan/` branch, and no branch; asserted through `getTask` and again through `listTasks`. `branchref-board-diff.txt` is the bail check: 79 tasks before, 79 after, none differing in slug, state, reason or changed files.
- [x] AC2 `diffRawRange`, `numstatRange` and `patchFor` in `git.ts` throw before spawning git when either revision is not 40 lowercase hex characters, pass revisions after `--end-of-options` and paths after `--`, run under `--literal-pathspecs` with `--no-color --no-ext-diff --no-textconv -M`, and return `null` on a non-zero exit or a timeout and `""` for an empty diff.
  evidence: .reggie/tasks/branch-diff-in-reader/evidence/git-helpers.txt
  how: `git-helpers.txt` — each helper handed `--output=<fresh temp path>`, a short sha, a branch name, an upper-case sha, a padded sha and an empty string, the throw asserted and the temp path asserted absent; the argument arrays read from the exported builder and compared whole; `null` for a commit that does not exist and `""` for identical commits. Beyond the criterion: `--diff-algorithm=myers` and `diff.suppressBlankEmpty=false` are pinned too (Deviation 3), and since the review `patchFor` takes a byte bound and a read that outgrows it is `null` every time (Deviation 13).
- [x] AC3 In a fixture repo whose own git config sets `color.ui=always`, `diff.noprefix=true`, `diff.context=0`, `diff.renames=false` and `diff.external` to a program that writes a marker file, `/api/changes` and `/api/filediff` return the same parsed result as without those settings, and the marker file is never written.
  evidence: .reggie/tasks/branch-diff-in-reader/evidence/hostile-config.txt
  how: `hostile-config.txt` — the five settings the criterion names plus four more (`color.diff`, `diff.suppressBlankEmpty`, `diff.algorithm=patience`, `diff.interHunkContext`, `core.quotePath=true`) written into a fixture's `.git/config`; the test first proves an ordinary `git diff` there runs the external program and is coloured, removes the marker, then runs both routes' functions over every task, compares with the unconfigured result by deep equality and asserts the marker absent.
- [x] AC4 `GET /api/changes?slug=` for an in-process task lists every changed file with `path`, `status`, `oldMode`, `newMode`, `binary`, `added` and `deleted`, puts every path under `.reggie/` in `records` and the rest in `files`, and its `totals` count `files` only.
  evidence: .reggie/tasks/branch-diff-in-reader/evidence/api-changes.json, .reggie/tasks/branch-diff-in-reader/evidence/routes.txt
  how: `api-changes.json` — the captured response for the fixture's in-process task; `routes.txt` — the route case asserting every field, the split, and totals over `files` only.
- [x] AC5 Names with a space, a double quote, a tab, non-ASCII letters, a leading dash, the text ` => ` and pathspec magic (`:(top)magic.ts`) are each listed byte-for-byte as they were committed, and each opens through `/api/filediff` with status 200 and its own rows, never another file's.
  evidence: .reggie/tasks/branch-diff-in-reader/evidence/routes.txt, .reggie/tasks/branch-diff-in-reader/evidence/file-cases.txt, .reggie/tasks/branch-diff-in-reader/evidence/task-page-doors.txt
  how: `routes.txt` ("lists each awkward name byte for byte, and opens each one's own rows") and `file-cases.txt` (the same at the library). Each of the seven files holds one added line naming itself, so a route that answered with another file's rows would fail. `task-page-doors.txt` shows all seven surviving the round trip through the address bar in a real browser.
- [x] AC6 A file deleted on the branch answers `status: "deleted"`, a `deleted` card, and one `del` row per removed line carrying old numbers 1 to n and no new number.
  evidence: .reggie/tasks/branch-diff-in-reader/evidence/file-cases.txt
  how: `file-cases.txt` — library and route cases on the fixture's deleted file.
- [x] AC7 A file added on the branch answers `status: "added"`, rows that are all `add` numbered from 1, and no gap row.
  evidence: .reggie/tasks/branch-diff-in-reader/evidence/file-cases.txt
  how: `file-cases.txt` — library and route cases on the added file, which also holds the markup line of AC30.
- [x] AC8 A rename without edits is listed once, with `status: "renamed"`, `from` set to the old path, `similarity: 100` and counts of 0 and 0, and its `/api/filediff` answers a `renamed` card and no rows.
  evidence: .reggie/tasks/branch-diff-in-reader/evidence/file-cases.txt
  how: `file-cases.txt` — listed once, under its new path, the whole entry compared; the route case also asserts the old name is not a door (404).
- [x] AC9 A rename with one edited line answers exactly one `add` row and one `del` row plus context, and not the whole file as added.
  evidence: .reggie/tasks/branch-diff-in-reader/evidence/file-cases.txt
  how: `file-cases.txt` — the row kinds compared exactly: `gap ctx ctx ctx del add ctx ctx ctx gap`.
- [x] AC10 A changed binary file answers `binary: true`, zero counts, a `binary` card carrying both byte sizes, and no rows; a binary file added on the branch has a null old size.
  evidence: .reggie/tasks/branch-diff-in-reader/evidence/file-cases.txt
  how: `file-cases.txt` — both byte sizes equal the lengths the fixture wrote (10 and 12); the added binary's old size is `null`.
- [x] AC11 A mode-only change answers `oldMode: "100644"`, `newMode: "100755"`, a `mode` card and no rows; a symlink added on the branch answers `newMode: "120000"`, a `symlink` card, and one row holding its target.
  evidence: .reggie/tasks/branch-diff-in-reader/evidence/file-cases.txt
  how: `file-cases.txt` — the mode-only change and the symlink, whose one row is `target.txt` with `noeol: true`.
- [x] AC12 An empty file added on the branch answers an `empty` card and no rows; a file emptied on the branch answers only `del` rows; an empty file that gains one line answers one `add` row numbered 1.
  evidence: .reggie/tasks/branch-diff-in-reader/evidence/file-cases.txt
  how: `file-cases.txt` — the three empty-file cases.
- [x] AC13 `\ No newline at end of file` never becomes a row: the row before it carries `noeol: true`, an edit to an unterminated line yields two flagged rows, and the new-side numbers of every later row equal the file's real line numbers.
  evidence: .reggie/tasks/branch-diff-in-reader/evidence/parser.txt, .reggie/tasks/branch-diff-in-reader/evidence/file-cases.txt
  how: `parser.txt` — pure cases over the measured patch text for both no-newline shapes, plus one with the marker in the middle of a hunk followed by three added lines, asserting every later new-side number; `file-cases.txt` repeats both shapes against git itself.
- [x] AC14 The patch parser reads hunks by the counts in the `@@` header: a deleted line whose text is `-- a/old.ts` is one `del` row with that text, an added line reading `@@ -9,9 +9,9 @@ fake` is one `add` row, and an added line reading `\ No newline at end of file` is one `add` row and sets no flag.
  evidence: .reggie/tasks/branch-diff-in-reader/evidence/parser.txt, .reggie/tasks/branch-diff-in-reader/evidence/file-cases.txt, .reggie/tasks/branch-diff-in-reader/evidence/parser-vs-numstat-real-repo.txt
  how: `parser.txt` — the measured patch of the file whose content imitates diff syntax, every row's kind and text compared; `file-cases.txt` reads the same file from git. Since the review the parser walks the text with a cursor and stops at a row budget; `parser-vs-numstat-real-repo.txt` was re-run after that rewrite.
- [x] AC15 A changed line of a CRLF file is returned with no trailing carriage return.
  evidence: .reggie/tasks/branch-diff-in-reader/evidence/file-cases.txt, .reggie/tasks/branch-diff-in-reader/evidence/parser.txt
  how: `file-cases.txt` — no row text of the CRLF file ends in a carriage return, and a carriage return in the middle of a line is kept (`parser.txt`).
- [x] AC16 A task branch with zero commits past the base answers `available: true`, empty `files` and `records`, and `range.commits: 0`.
  evidence: .reggie/tasks/branch-diff-in-reader/evidence/branch-cases.txt
  how: `branch-cases.txt` — the zero-ahead task, library and route.
- [x] AC17 A task branch whose only changes are under `.reggie/` answers empty `files`, the records in `records`, and totals of zero files and zero lines.
  evidence: .reggie/tasks/branch-diff-in-reader/evidence/branch-cases.txt
  how: `branch-cases.txt` — the records-only task; its claim record also opens through the file route.
- [x] AC18 A task branch that merged the base back in lists only the files the branch itself changed; a file changed only on the base is absent from `files` and `records`.
  evidence: .reggie/tasks/branch-diff-in-reader/evidence/branch-cases.txt
  how: `branch-cases.txt` — the merged-base-back task lists `src/a.ts` only, and the base's `src/b.ts` answers 404 on the file route.
- [x] AC19 A task branch that changed a line and changed it back answers empty `files` with `range.commits: 2`, and the task page says in words that the commits left no net change.
  evidence: .reggie/tasks/branch-diff-in-reader/evidence/branch-cases.txt, .reggie/tasks/branch-diff-in-reader/evidence/net-zero-task-page.png
  how: `branch-cases.txt` for the payload (empty lists, `range.commits: 2`); `net-zero-task-page.png` for the sentence: "The 2 commits on this branch left no net change against main: whatever one of them changed, another changed back."
- [x] AC20 A 60,000-line added file answers 2,000 rows with `totalRows: 60000` and `truncated: true`; `offset=58000` returns the rows numbered 58,001 to 60,000 with `truncated: false`; `offset=60000` returns no rows; a non-numeric or negative `offset` answers 400.
  evidence: .reggie/tasks/branch-diff-in-reader/evidence/large.txt
  how: `large.txt` — offsets 0, 58000 and 60000, and `abc`, `-1`, `1.5` and `1e3` answering 400. The 60,000-line fixture adds about a tenth of a second to the fixture build, so it was not shrunk. Since the review a later page is a slice of rows already built: the same file's case takes the file's blob away from git between two pages and still gets rows 30,001 onward.
- [x] AC21 A 5 MB single-line added file answers one row whose text is 2,000 characters long with `cut: true`, in a response smaller than 100 KB.
  evidence: .reggie/tasks/branch-diff-in-reader/evidence/large.txt, .reggie/tasks/branch-diff-in-reader/evidence/parser.txt
  how: `large.txt` — one row of 2,000 characters with `cut: true`, in a response under 100 KB. Since the review the cut never ends on half a surrogate pair and the cut text is copied out of its 5 MB line (`parser.txt`).
- [x] AC22 A done task whose branch is deleted answers `range.kind: "merge"`, with `base` the merge's first parent and `ref` the merge found by `taskLanding`; its `records` include the packet, and that packet's rows show `verdict: approved`.
  evidence: .reggie/tasks/branch-diff-in-reader/evidence/landed.txt
  how: `landed.txt` — landed through `landTask`, the branch asserted gone, `range.base` and `range.ref` compared with the merge's first parent and the merge from `git rev-list --parents`, and the packet's rows holding `verdict: approved` and not `verdict: pending`.
- [x] AC23 For that landed task, after the base has changed the same file again, `/api/filediff` still returns the rows and numbers as they were at the merge, with `changedSince: true`; for a file the base has not touched since, `changedSince` is `false`.
  evidence: .reggie/tasks/branch-diff-in-reader/evidence/landed.txt
  how: `landed.txt` — after the base changed `src/a.ts` again the rows and numbers are the landing's, `changedSince: true`; `false` for the file the base has not touched; `null` for a live branch.
- [x] AC24 For a done task with a landing merge, `totals.files`, `totals.added` and `totals.deleted` from `/api/changes` equal `completion.diff.filesChanged`, `added` and `deleted` from `/api/task/<slug>`.
  evidence: .reggie/tasks/branch-diff-in-reader/evidence/landed.txt, .reggie/tasks/branch-diff-in-reader/evidence/totals-match-real-repo.txt
  how: `landed.txt` for the fixture; `totals-match-real-repo.txt` for this repo, re-run after the review fixes: 25 files for `intake-line-leaves-at-triage` as the plan measured, and all twelve landed tasks match the Completed view's counts.
- [x] AC25 A done task that landed by fast-forward, with no merge commit and no branch, answers 200 with `available: false` and a reason naming the missing merge commit, and `/api/filediff` for it answers 404 carrying the same reason.
  evidence: .reggie/tasks/branch-diff-in-reader/evidence/unavailable.txt
  how: `unavailable.txt` — 200 with `available: false` and the reason; the file route answers 404 carrying the same sentence. The review added the case the criterion did not cover, a fast-forwarded task whose branch was kept (CR4).
- [x] AC26 A task with no task branch and no landing answers 200 with `available: false` and the reason that there is no task branch yet; an unknown slug answers 404; a slug that fails `isSafeSlug` answers 400.
  evidence: .reggie/tasks/branch-diff-in-reader/evidence/unavailable.txt
  how: `unavailable.txt` — a planned task with no branch, an unknown slug on both routes, and the slugs `../x`, empty, `UPPER`, `a/b` and `-dash` on both routes.
- [x] AC27 A task branch that shares no history with the base answers `available: false` with a reason saying so, never a 500 and never an empty list presented as "nothing changed".
  evidence: .reggie/tasks/branch-diff-in-reader/evidence/unavailable.txt
  how: `unavailable.txt` — the orphan branch: 200, `available: false`, the reason; its file route 404.
- [x] AC28 `/api/filediff` answers 400 for an empty path, a path with a NUL, an absolute path and any `..` segment, and 404 for a well-formed path that is not in the task's change list, including `--output=<a fresh path under the OS temp directory>` and `:(exclude)src`; after those requests no file exists at that temp path.
  evidence: .reggie/tasks/branch-diff-in-reader/evidence/path-validation.txt
  how: `path-validation.txt` — seven malformed paths and a missing one answer 400; `--output=<fresh temp path>`, `:(exclude)src`, `:(top)src/keep.ts`, `src/*.bin`, a planned but unchanged file, a directory, a trailing slash and a case variant answer 404 with the same sentence; the temp path is asserted absent. Since the review the contract says what the match really forgives (a leading `./`, surrounding whitespace, and a committed name that begins or ends with a space), and a test opens two such names.
- [x] AC29 Neither route puts git's stderr or an absolute filesystem path into a response body.
  evidence: .reggie/tasks/branch-diff-in-reader/evidence/path-validation.txt
  how: `path-validation.txt` — every 400, every 404 and every `available: false` body the suite makes is collected and read for `fatal:`, `error: `, `usage: git`, the fixture root in both its symlinked and its real form, and the OS temp directory. **Stated as it is** (code review, CR10): as literally worded the criterion is not true of a 200 from `/api/filediff`, whose `editorUrl` is an absolute path, exactly as `/api/file`'s is and as AC40 requires. What is met is what the plan's verification describes: no refusal and no unavailable answer leaks. The API contract now says so in those words.
- [x] AC30 A changed line containing `<img src=x onerror=alert(1)>` is drawn in the reader as that literal text, and the page raises no dialog and logs no console error.
  evidence: .reggie/tasks/branch-diff-in-reader/evidence/html-is-text.png, .reggie/tasks/branch-diff-in-reader/evidence/html-is-text.json, .reggie/tasks/branch-diff-in-reader/evidence/console.txt
  how: `html-is-text.png`, `html-is-text.json` (the row's `textContent` is the markup, its `innerHTML` is entity-escaped, it has no child element, there is no `img` in the reader, no dialog was raised) and `console.txt`.
- [x] AC31 On a task page for an in-process, awaiting-decision or done task, a "What changed" section lists each changed file with a status badge and `+n −n`, lists Reggie's own records under their own heading, and every row links to `#/repo/<repo>/file/<path>?diff=<slug>`.
  evidence: .reggie/tasks/branch-diff-in-reader/evidence/task-page-what-changed.png, .reggie/tasks/branch-diff-in-reader/evidence/task-page-records.png, .reggie/tasks/branch-diff-in-reader/evidence/task-page-doors.txt, .reggie/tasks/branch-diff-in-reader/evidence/branch-cases.txt, .reggie/tasks/branch-diff-in-reader/evidence/landed.txt
  how: `task-page-what-changed.png`, `task-page-records.png` and `task-page-doors.txt` — 25 rows read from the DOM, every `href` carrying `?diff=diff-cases`, the record under its own heading. The awaiting-decision page (2 doors) and the done page (4 doors, read through its merge) were read from the DOM in the same session and carried `?diff=<their slug>` on every row, but only the in-process page was saved to a file; the route tests in `branch-cases.txt` and `landed.txt` cover the payloads those two pages draw.
- [x] AC32 On the same page a "Files to touch" row whose path is in the change list links to the `?diff=<slug>` route, and a row whose path is not in the list keeps its plain file link.
  evidence: .reggie/tasks/branch-diff-in-reader/evidence/task-page-doors.txt
  how: `task-page-doors.txt` — `src/keep.ts` (in the list) links to the door, `src/untouched.ts` (planned, unchanged) keeps the plain link. Also there, because it is true: of 23 "also changed" links 20 became doors and 3 stayed plain, the three whose names `impact.actual` still carries C-quoted, which is the planner's captured item and is out of scope by the plan.
- [x] AC33 In the Completed view, each "Files changed" link of a task that has a landing merge opens the `?diff=<slug>` route, and the records sentence links to the task page.
  evidence: .reggie/tasks/branch-diff-in-reader/evidence/completed-doors.png, .reggie/tasks/branch-diff-in-reader/evidence/task-page-doors.txt, .reggie/tasks/branch-diff-in-reader/evidence/completed-doors.json
  how: `completed-doors.png` and `task-page-doors.txt` (raw: `completed-doors.json`) — this repo's Completed view, 25 of 25 file links doors, the records sentence linking to the task page; the fixture's fast-forwarded task, which has no landing merge, kept its plain link.
- [x] AC34 Opening a `?diff=<slug>` file route in a real browser at 1440 px wide opens the reader without a click and shows tinted added and deleted rows, each with a `+` or `−` in the sign column, new-side line numbers, at least one gap row stating a count of unchanged lines, and head chips naming the task and the counts.
  evidence: .reggie/tasks/branch-diff-in-reader/evidence/reader-diff-desktop.png, .reggie/tasks/branch-diff-in-reader/evidence/reader-diff-desktop-add-and-del.png
  how: `reader-diff-desktop.png` — this repo's `serve.ts` with `?diff=branch-diff-in-reader` at 1440 by 900 while the branch was live: opened without a click, tinted rows, `+` in the sign column, new-side numbers, gap rows with counts, head chips naming the task and `+104 −0`. That file's change has no deleted rows, so `reader-diff-desktop-add-and-del.png` shows `reader.js` from the same branch with both. Taken before the review fixes; the fixes did not change how rows are drawn.
- [x] AC35 The same route at 390 px wide opens the map overlay with the reader in it, the rows scroll sideways without the page itself scrolling sideways, and the link back to the task is reachable once the reader is closed.
  evidence: .reggie/tasks/branch-diff-in-reader/evidence/reader-diff-phone.png, .reggie/tasks/branch-diff-in-reader/evidence/reader-diff-phone-closed.png, .reggie/tasks/branch-diff-in-reader/evidence/phone-overflow.txt, .reggie/tasks/branch-diff-in-reader/evidence/phone-overflow.json
  how: `reader-diff-phone.png`, `reader-diff-phone-closed.png` and `phone-overflow.txt` (raw: `phone-overflow.json`). **Met with a caveat, stated as it is.** The overlay opens with the reader in it, and scrolling the rows sideways leaves the page where it was (`scrollX` 0) on both files measured. On `git.ts` the page is 390 wide on a 390 screen. On `serve.ts`, the file the plan names, the page is 412 wide: a chip in the story column holding a long task slug does that, the plain page with no `?diff=` measures the same 412, and it is captured, not fixed. The link back to the task is reachable once the reader is closed, but it sits under the pinned card, 936 px down at this width: by scrolling, not on the first screen.
- [x] AC36 In a real browser the deleted, binary, mode-only, renamed and truncated cases each render their card or banner, and the truncated case's "show the next rows" control appends rows 2,001 onward under the first 2,000.
  evidence: .reggie/tasks/branch-diff-in-reader/evidence/card-deleted.png, .reggie/tasks/branch-diff-in-reader/evidence/card-binary.png, .reggie/tasks/branch-diff-in-reader/evidence/card-mode.png, .reggie/tasks/branch-diff-in-reader/evidence/card-renamed.png, .reggie/tasks/branch-diff-in-reader/evidence/truncated-before.png, .reggie/tasks/branch-diff-in-reader/evidence/truncated-after.png, .reggie/tasks/branch-diff-in-reader/evidence/truncated-after.json
  how: `card-deleted.png`, `card-binary.png`, `card-mode.png`, `card-renamed.png`, `truncated-before.png`, `truncated-after.png` and `truncated-after.json` (4,000 rows after one press, row 2,001 under row 2,000, the banner counting both).
- [x] AC37 Opening `?diff=<slug>` for one of Reggie's own records, and for a file that exists only on a live branch, shows the rows in the reader, a plain-words section in the story column in place of an error card, no failure toast, and no graph left over from the previous page.
  evidence: .reggie/tasks/branch-diff-in-reader/evidence/unmapped-record.png, .reggie/tasks/branch-diff-in-reader/evidence/unmapped-added.png, .reggie/tasks/branch-diff-in-reader/evidence/console.txt
  how: `unmapped-record.png` (a packet of this repo opened as a change), `unmapped-added.png` (the fixture's branch-only file; the same shot as `html-is-text.png`, which is that page) and `console.txt`. The plan expected the page to swallow three 404s; Chrome logs each as a console error, so the page asks for the change first and skips them (Deviation 1). One request, an empty console.
- [x] AC38 The reader head's mode button drops `diff` from the route and shows the working-tree file, and pressing it again restores the diff; opening the same path first plain and then with `?diff=` never shows the other mode's rows.
  evidence: .reggie/tasks/branch-diff-in-reader/evidence/mode-toggle-1.png, .reggie/tasks/branch-diff-in-reader/evidence/mode-toggle-2.png, .reggie/tasks/branch-diff-in-reader/evidence/mode-toggle-3.png, .reggie/tasks/branch-diff-in-reader/evidence/mode-toggle.json, .reggie/tasks/branch-diff-in-reader/evidence/review-cr5-cr6-cr7-after.json
  how: `mode-toggle-1.png`, `mode-toggle-2.png`, `mode-toggle-3.png` and `mode-toggle.json` (the address and the rows at each step; the screenshots are of the page and do not include the address bar, which is why the json is beside them). `review-cr5-cr6-cr7-after.json` shows the toggle still working after the review's change to the way back.
- [x] AC39 In diff mode, selecting text across two added rows offers "Add a note about lines a–b" with the branch-side numbers and a prefill that names the task; a selection that includes a deleted row or a gap row offers nothing.
  evidence: .reggie/tasks/branch-diff-in-reader/evidence/select-to-note-two-added-rows.png, .reggie/tasks/branch-diff-in-reader/evidence/select-to-note-two-added-rows.json, .reggie/tasks/branch-diff-in-reader/evidence/select-to-note.png, .reggie/tasks/branch-diff-in-reader/evidence/select-to-note-refused.png, .reggie/tasks/branch-diff-in-reader/evidence/select-to-note.json
  how: `select-to-note-two-added-rows.png` and `select-to-note-two-added-rows.json` (two adjacent added rows, "Add a note about lines 7–8", prefill `(lines 7–8, as changed by task diff-cases) `), `select-to-note.png`, `select-to-note-refused.png` and `select-to-note.json` (offered across an added and an unchanged row; nothing across a deleted row; nothing across a gap row). The two-added-rows capture was redone after the review: it had been taken on a branch-only file, where the button is no longer offered at all (CR5).
- [x] AC40 In diff mode the editor link targets `.worktree/<slug>/<path>` when that file exists, targets the serving checkout's copy for a landed task whose file still exists, and is hidden otherwise.
  evidence: .reggie/tasks/branch-diff-in-reader/evidence/editor-url.txt
  how: `editor-url.txt` — the worktree's copy for a task claimed with `claimTask` and `worktree: true`, this checkout's copy for the landed task, `null` for a live branch with no worktree and for a deleted file; and, added after the review, this checkout's copy when it is the one with `task/<slug>` checked out (Deviation 5).
- [x] AC41 `packages/reggie/docs/ui-api-contract.md` documents `GET /api/changes` and `GET /api/filediff` with their parameters, payload types, row kinds, card kinds, caps and status codes, and adds `branchRef` to the `TaskInfo` text.
  evidence: .reggie/tasks/branch-diff-in-reader/evidence/api-contract.diff
  how: `api-contract.diff` — both routes, their types, row and card kinds, caps, paging and status codes, `branchRef`, and since the review the row cap, the byte bound, the row cache, what the path match forgives, and the hostile base name.
- [x] AC42 `packages/reggie/ui/DOM-CONTRACT.md` documents the reader's `diff` option and mode dep, the new reader and board classes, the `?diff=<slug>` query on the file route, and both new rows of the route-to-data table.
  evidence: .reggie/tasks/branch-diff-in-reader/evidence/dom-contract.diff
  how: `dom-contract.diff` — the `diff` option and the mode dep, the reader and board classes, the `?diff=<slug>` query, both rows of the route-to-data table, and since the review the range as part of the reader's identity.
- [x] AC43 Entity notes exist for `changes.ts`, `git.ts` and `reader.js`, and the notes for `serve.ts`, `tasks.ts`, `app.js` and `board.js` each gain an entry describing what this task changed there.
  evidence: .reggie/tasks/branch-diff-in-reader/evidence/notes.txt
  how: `notes.txt` — `reggie note path` for each of the seven files, then the stat of `.reggie/notes/`: fourteen note files touched, six more than the criterion asks for.
- [x] AC44 A `/security-review` pass over the branch's diff is recorded, and every finding in it is either fixed on the branch or answered in writing.
  evidence: .reggie/tasks/branch-diff-in-reader/evidence/security-review.md
  how: `security-review.md`. **Stated as it is.** The borrowed `/security-review` skill was **not run**, by anyone: from a subagent it resolves its diff against the integration checkout rather than the task worktree, so it would have reviewed the wrong tree. What stands in for it, by the manager's ruling, is an independent security session that reviewed the task worktree at `101166b` with hostile fixtures of its own. The file lists each of its findings and how it was resolved: P1 closed for the new routes and captured as high for the rest, M1 fixed, L3 fixed, L2, P2 and P3 captured with reasons. It also records that the build session's own first pass ranked P1 low and called the new routes unexposed, and that both statements were wrong.
- [x] AC45 `TZ=UTC npx vitest run` in `packages/reggie` passes with at least the baseline 687 passed and 1 skipped, and no failures.
  evidence: .reggie/tasks/branch-diff-in-reader/evidence/tests.txt
  how: `tests.txt` — 33 files, 777 passed, 1 skipped, 0 failed, against a baseline of 687 and 1 (761 before the reviews).
- [x] AC46 `npm run typecheck` in `packages/reggie` passes with no output after the tsc line.
  evidence: .reggie/tasks/branch-diff-in-reader/evidence/typecheck.txt
  how: `typecheck.txt` — exit 0, nothing after the tsc line.
- [x] AC47 After `npm run build` and `reggie docs refresh` on a clean tree, `reggie docs check` reports both `CLAUDE.md` and `AGENTS.md` fresh.
  evidence: .reggie/tasks/branch-diff-in-reader/evidence/docs-check.txt
  how: `docs-check.txt` — `npm run build`, `docs refresh` on a clean tree (four new source files moved the counts), the refresh committed, then `docs check` on a clean tree: both fresh, exit 0. The review fixes added and removed no source file; the check was run again as the last step and is still fresh.

## Evidence
Test output, vitest's own, per criterion group, at the branch's final code:
- .reggie/tasks/branch-diff-in-reader/evidence/tests.txt — AC45, the whole suite under `TZ=UTC`: 777 passed, 1 skipped
- .reggie/tasks/branch-diff-in-reader/evidence/typecheck.txt — AC46
- .reggie/tasks/branch-diff-in-reader/evidence/docs-check.txt — AC47
- .reggie/tasks/branch-diff-in-reader/evidence/tasks-branchref.txt — AC1
- .reggie/tasks/branch-diff-in-reader/evidence/git-helpers.txt — AC2
- .reggie/tasks/branch-diff-in-reader/evidence/hostile-config.txt — AC3
- .reggie/tasks/branch-diff-in-reader/evidence/routes.txt — AC4, AC5
- .reggie/tasks/branch-diff-in-reader/evidence/api-changes.json — AC4, the captured response
- .reggie/tasks/branch-diff-in-reader/evidence/file-cases.txt — AC5 to AC12, AC15
- .reggie/tasks/branch-diff-in-reader/evidence/parser.txt — AC13, AC14
- .reggie/tasks/branch-diff-in-reader/evidence/branch-cases.txt — AC16 to AC19
- .reggie/tasks/branch-diff-in-reader/evidence/large.txt — AC20, AC21, and the row cap and row cache
- .reggie/tasks/branch-diff-in-reader/evidence/landed.txt — AC22, AC23, AC24
- .reggie/tasks/branch-diff-in-reader/evidence/unavailable.txt — AC25, AC26, AC27
- .reggie/tasks/branch-diff-in-reader/evidence/path-validation.txt — AC28, AC29
- .reggie/tasks/branch-diff-in-reader/evidence/editor-url.txt — AC40

Checked against this repo rather than the fixture:
- .reggie/tasks/branch-diff-in-reader/evidence/totals-match-real-repo.txt — AC24 by hand: all twelve landed tasks match the Completed view's counts
- .reggie/tasks/branch-diff-in-reader/evidence/parser-vs-numstat-real-repo.txt — bail conditions 1 and 4, re-run after the parser was rewritten: 12 landing merges found by their own merge, 453 files, 22,492 rows, none unreadable, none disagreeing with git's numstat
- .reggie/tasks/branch-diff-in-reader/evidence/branchref-board-diff.txt — bail condition 5: 0 of 79 tasks differ

What a real browser showed (Chrome, 1440 by 900 and 390 by 844):
- .reggie/tasks/branch-diff-in-reader/evidence/reader-diff-desktop.png, .reggie/tasks/branch-diff-in-reader/evidence/reader-diff-desktop-add-and-del.png — AC34
- .reggie/tasks/branch-diff-in-reader/evidence/reader-diff-phone.png, .reggie/tasks/branch-diff-in-reader/evidence/reader-diff-phone-closed.png, .reggie/tasks/branch-diff-in-reader/evidence/phone-overflow.txt, .reggie/tasks/branch-diff-in-reader/evidence/phone-overflow.json — AC35 and its caveat
- .reggie/tasks/branch-diff-in-reader/evidence/task-page-what-changed.png, .reggie/tasks/branch-diff-in-reader/evidence/task-page-records.png, .reggie/tasks/branch-diff-in-reader/evidence/task-page-doors.txt, .reggie/tasks/branch-diff-in-reader/evidence/task-page-doors.json — AC31, AC32
- .reggie/tasks/branch-diff-in-reader/evidence/completed-doors.png, .reggie/tasks/branch-diff-in-reader/evidence/completed-doors.json — AC33
- .reggie/tasks/branch-diff-in-reader/evidence/net-zero-task-page.png — AC19
- .reggie/tasks/branch-diff-in-reader/evidence/card-deleted.png, .reggie/tasks/branch-diff-in-reader/evidence/card-binary.png, .reggie/tasks/branch-diff-in-reader/evidence/card-mode.png, .reggie/tasks/branch-diff-in-reader/evidence/card-renamed.png, .reggie/tasks/branch-diff-in-reader/evidence/truncated-before.png, .reggie/tasks/branch-diff-in-reader/evidence/truncated-after.png, .reggie/tasks/branch-diff-in-reader/evidence/truncated-after.json — AC36
- .reggie/tasks/branch-diff-in-reader/evidence/unmapped-record.png, .reggie/tasks/branch-diff-in-reader/evidence/unmapped-added.png — AC37
- .reggie/tasks/branch-diff-in-reader/evidence/html-is-text.png, .reggie/tasks/branch-diff-in-reader/evidence/html-is-text.json, .reggie/tasks/branch-diff-in-reader/evidence/console.txt — AC30, AC37
- .reggie/tasks/branch-diff-in-reader/evidence/mode-toggle-1.png, .reggie/tasks/branch-diff-in-reader/evidence/mode-toggle-2.png, .reggie/tasks/branch-diff-in-reader/evidence/mode-toggle-3.png, .reggie/tasks/branch-diff-in-reader/evidence/mode-toggle.json — AC38
- .reggie/tasks/branch-diff-in-reader/evidence/select-to-note.png, .reggie/tasks/branch-diff-in-reader/evidence/select-to-note-refused.png, .reggie/tasks/branch-diff-in-reader/evidence/select-to-note.json, .reggie/tasks/branch-diff-in-reader/evidence/select-to-note-two-added-rows.png, .reggie/tasks/branch-diff-in-reader/evidence/select-to-note-two-added-rows.json — AC39

Documents:
- .reggie/tasks/branch-diff-in-reader/evidence/api-contract.diff — AC41
- .reggie/tasks/branch-diff-in-reader/evidence/dom-contract.diff — AC42
- .reggie/tasks/branch-diff-in-reader/evidence/notes.txt — AC43
- .reggie/tasks/branch-diff-in-reader/evidence/security-review.md — AC44

The reviews, each finding reproduced before it was fixed:
- .reggie/tasks/branch-diff-in-reader/evidence/review-tests-before-fix.txt — nine unit tests failing on the code the reviewers read: CR4, CR8, CR9, L3, P1 and M1
- .reggie/tasks/branch-diff-in-reader/evidence/review-route-tests-before-fix.txt — three route tests failing on a plain copy of `101166b`: CR4, M1, and P1 with the message "git wrote the file the integration branch's name asked for"
- .reggie/tasks/branch-diff-in-reader/evidence/review-tests-after-fix.txt — the same tests, and the four test gaps, passing
- .reggie/tasks/branch-diff-in-reader/evidence/m1-before-after.txt — M1 measured with the reviewer's own probe and repo
- .reggie/tasks/branch-diff-in-reader/evidence/review-cr1-before.json, .reggie/tasks/branch-diff-in-reader/evidence/review-cr1-after.json, .reggie/tasks/branch-diff-in-reader/evidence/review-cr1-after.png — CR1, the reviewer's exact trigger
- .reggie/tasks/branch-diff-in-reader/evidence/review-cr2-before.json, .reggie/tasks/branch-diff-in-reader/evidence/review-cr2-after.json — CR2, the reviewer's exact trigger
- .reggie/tasks/branch-diff-in-reader/evidence/review-cr3-before.json, .reggie/tasks/branch-diff-in-reader/evidence/review-cr3-after.json, .reggie/tasks/branch-diff-in-reader/evidence/review-cr3-after.png — CR3
- .reggie/tasks/branch-diff-in-reader/evidence/review-cr5-cr6-before.json, .reggie/tasks/branch-diff-in-reader/evidence/review-cr5-cr6-cr7-after.json — CR5, CR6, CR7, and the sign column's role from CR10

## Changes
Eighteen commits on `task/branch-diff-in-reader` after the claim, and this packet's own. The ones that change the product or its tests:

- `adca010` feat(changes): read what a task changed as two commit ids, a null-separated list, and rows built on the server
- `ed98af9` feat(serve): GET /api/changes and GET /api/filediff, the first routes that return a changed line
- `8936cf5` feat(reader): a diff mode in the reader, opened from the task page and the Completed view
- `7d6f095` fix(changes): a first cap on changed lines, and the diff head's counts kept on screen
- `a224c2f` docs: refresh the generated block for the four new source files
- `2e077b8` fix(changes): never hand git a name, cap the rows built, and build a file's rows once (the reviews, server side)
- `4571cfb` fix(reader): a change is only the same change between the same two commits (the reviews, client side)
- `7f32a21` fix(test): the diff fixture turns off git's background maintenance

Nineteen product files, 3,266 lines added and 60 removed, of which about 1,650 added lines are tests, the fixture and the dev script.

- `packages/reggie/src/changes.ts` (new) — `taskRange`, the null-separated list, the count-driven patch parser, the row builder, the cards, the row cap and the row cache
- `packages/reggie/src/git.ts` — `diffRangeArgs` and the three range readers, `resolveCommit`, `mergeBase`, `commitCount`, the blob readers; `run()` gains a byte bound and treats any spawn error as a failure
- `packages/reggie/src/tasks.ts` — `branchRef` on `TaskInfo`
- `packages/reggie/src/serve.ts` — the two routes, the base-name guard, the per-slug list, the row cache, `mapped`, `editorUrl`
- `packages/reggie/ui/reader.js`, `reader.css` — diff mode
- `packages/reggie/ui/app.js` — the `?diff=` query, the change asked for first, the plain-words page for a file the map never read
- `packages/reggie/ui/board.js`, `board.css` — "What changed", the doors, the Completed view's doors
- `packages/reggie/ui/map.js` — the empty card prefers a sentence the view brings (five lines; not in the plan's list, Deviation 2)
- `packages/reggie/test/diff-fixture.ts` (new), `packages/reggie/ui/dev/make-diff-fixture.ts` (new) — one repo holding every awkward input, and the script that serves it to a browser
- tests: `src/changes.test.ts` (new, 54 cases), one case in `src/tasks.test.ts`, 35 route cases in `test/serve.test.ts`; 777 in all, from 687
- documents: the API contract, the DOM contract, the generated blocks of `CLAUDE.md` and `AGENTS.md`
- notes: fourteen note files, one for every source file touched

## Reviews
Two independent sessions, started by the manager, read the task worktree at `101166b`; both confirmed
the commit and the 19 product files. Neither was the build session. The borrowed `/code-review` and
`/security-review` skills were **not** run by anyone: from a subagent they resolve their diff against
the integration checkout, not the task worktree. Each CONFIRMED finding was reproduced here before it
was touched, server-side ones as a failing test and client-side ones in a real browser.

**Code review** (1 blocker, 1 major, 5 minor, 4 nit):

1. **CR1, blocker — re-opening a change after the branch moved showed the old change.** Fixed in `4571cfb`. Reproduced with the reviewer's exact trigger: the task page said +3 −1, the reader +2 −1, the server +3 −1. The reader's identity in diff mode now includes the two commits the change was read between; the page asks past the fetch cache on every render and hands the reader the answer, and without one the reader asks again itself. After: +4 −1 everywhere, and the same door with no commit in between keeps the rows already drawn. `review-cr1-before.json`, `review-cr1-after.json`, `review-cr1-after.png`.
2. **CR2, major — a late `/api/changes` answer rewrote links on another task's page.** Fixed in `4571cfb` with the reviewer's one-line guard, in the `.then` and the `.catch`. Reproduced with a 2.5 s held answer: a planned task with no branch had its "Files to touch" link pointed at another task's change. After: untouched, and the task's own links still become doors. `review-cr2-before.json`, `review-cr2-after.json`.
3. **CR3, minor — paging spliced two changes when the tip moved between pages.** Fixed in `4571cfb`. Reproduced: `const v4000` on screen twice. After: the change is read again from the top, 2,000 rows, no duplicate, and the banner says why. `review-cr3-before.json`, `review-cr3-after.json`, `review-cr3-after.png`.
4. **CR4, minor — a done task fast-forwarded with its branch kept read as "nothing changed".** Fixed in `2e077b8`, with a fixture task and tests at the library and over HTTP, failing before.
5. **CR5, minor — select-to-note was a dead end on files the map never read.** Fixed in `4571cfb`: not offered there, still offered on a mapped file. `review-cr5-cr6-before.json`, `review-cr5-cr6-cr7-after.json`.
6. **CR6, minor, accessibility — focus fell to the body after "Show the next rows".** Fixed in `4571cfb`: focus goes to the new button, or to the first appended row when no pages remain. Same two files.
7. **CR7, minor, plausible — the way back survived `close()` and was keyed by path alone.** Fixed in `4571cfb`: cleared and redrawn on close, and keyed by the file's address, which carries the repo in workspace mode. The close half was driven in a browser; the cross-repo half was **not**, since only single repos were served. `review-cr5-cr6-cr7-after.json`.
8. **CR8, nit — the 2,000-character cut could split a surrogate pair.** Fixed in `2e077b8`, test failing before.
9. **CR9, nit — `fileDiff(…, NaN)` answered `offset: NaN`.** Fixed in `2e077b8`, test failing before.
10. **CR10, nit — contract wording.** Fixed: the contract says what the path match forgives, and that a 200 does carry an editor path; AC29 is worded honestly above; the sign column's label has `role="img"`.
11. **CR11, nit — the history index was built for every request and never read.** Fixed in `2e077b8`: the routes no longer build it at all, which is lazier than the reviewer's "pass it lazily", because the range needs nothing it holds.

The four named test gaps are closed in `2e077b8`: the editor link when this checkout has the task branch checked out; a committed name that begins or ends with a space; `taskRange` over `origin/task/<slug>`, with the ref written by `update-ref` where a fetch would put it, so no remote and no push; and CR4's case.

**Security review** (1 medium, 2 low, 3 pre-existing; six areas found sound). Full account, with the correction of the build session's own first pass, in `security-review.md`:

1. **P1, high, pre-existing sink reachable through the new route — a request-triggered arbitrary file write.** The build session's first pass had ranked this low and said the new routes were not exposed; both were wrong, and `security-review.md` says so. Closed for the new routes in `2e077b8` by the smallest change available: `taskLanding` uses its base only as a revision, so it is handed the resolved commit id, and `history.ts` is untouched. Both routes also stop before the task list is built for a name that begins with a dash (Deviation 10). Proven at the library with a real ref of that name and over HTTP with the hostile `defaultBranch` shape, no file written, both failing before. The same sink remains through `GET /api/task/<slug>`, `POST /api/decide` and the CLI: captured, ranked high.
2. **M1, medium, introduced — rows built without a bound, and again per page.** Fixed in `2e077b8`. Before: 483 ms, 1,125,000 rows, 466 MB of heap, 961 MB peak RSS, twice over. After: refused in 7 ms at 9 MB and 95 MB peak; a change that slips under the count but not under the rows, 125 ms and 53 MB; a later page of an allowed file, nothing measurable. `m1-before-after.txt`. The comment that overstated the old bound is gone.
3. **L3, low, introduced — a tag named `task/<slug>` shadowed the branch.** Fixed in `2e077b8`: names are resolved by full ref, the base too. Test failing before.
4. **L2, low, introduced — a checked-out `.gitattributes` can hide a diff.** Captured, not fixed, within the manager's ruling: the flag exists on this git (verified), but a fix needs a version guard and a product decision about which tree to read attributes from, both written into the capture.
5. **P2, pre-existing — `editorScheme` becomes a link with no allowlist.** Captured, not fixed, by ruling.
6. **P3, pre-existing — git obeys the served repo's local config.** Captured, not fixed, by ruling.

Found while fixing M1 and fixed: `run()` reported output that outgrew its buffer as a success whenever the child had already exited (node gives `ENOBUFS` beside a status of 0; five runs in six for a small patch).

## Deviations from plan
1. **The page asks for the change first and skips three requests.** The plan had the file page ask the story, the impact view and the Spotlight and treat their 404s as ordinary in diff mode. Chrome logs every failed fetch as a console error, which broke the plan's own clean-console criterion, so `/api/filediff` answers `mapped` and the page skips those requests when it is false. It needed an exported `diffUrl` in `reader.js`.
2. **`ui/map.js` was touched**, five lines, outside the plan's file list: the empty-map card prefers a sentence the view brings, because "nothing imports this file" would be a claim nobody measured.
3. **More is pinned than the plan listed.** `--diff-algorithm=myers` for all three shapes, so the list's counts and a patch's rows come from one diff, and `diff.suppressBlankEmpty=false`, which the parser tolerates anyway.
4. **A patch that disagrees with git's numstat is refused**, and `taskRange` resolves only the two names a safe slug builds.
5. **`editorUrl` also points at this checkout when it has `task/<slug>` checked out**, which is what an in-place claim produces. The plan listed three situations; this is a fourth, from its own rule that the link follows the text on screen.
6. **Path membership is tried on the name as asked, then as tidied**, so a committed name that begins or ends with a space opens. The plan listed that as a known limit.
7. **In diff mode the head's chips take a row of their own at every width.** Beside the path they clipped from the right and the counts went first.
8. **The fixture is larger than the plan described**: an awaiting-decision task, and after the reviews a fast-forwarded task with its branch kept, two names with leading and trailing spaces, and a branch held only as `origin/task/<slug>`. Notes were written for six more files than AC43 asks. The contract's `Completion` now lists `merge`, which the Completed view's doors read.
9. **AC34 has a second screenshot**, because `serve.ts` has no deleted rows to show, and `unmapped-added.png` is a byte-for-byte copy of `html-is-text.png`, the same page.
10. **P1 was closed with two changes, not one.** The manager preferred the smallest clean change, handing `taskLanding` the resolved commit id, and that is done and is sufficient for `taskRange`. A route-level guard was added as well, because the routes' own path includes the cached task list, and building that list hands the same name to older helpers bare; without the guard "the new routes never hand such a name to git" would not have been true. No branch can have such a name, so nothing legitimate is refused.
11. **The cap is on rows built, not on changed lines, and there is a byte bound and a row cache.** The plan had a page size and no total. The first build capped changed lines at 250,000; the security review measured why that bounds nothing. Now 100,000 rows, a 16 MB patch read, and a cache bounded by 8 files, 200,000 rows and 32 MB of text. The 60,000-line file AC20 requires still pages.
12. **The patch parser walks the text with a cursor instead of splitting it**, so that it can stop at the budget. What it reads and how it reads hunks by count is unchanged; its agreement with git was measured again over this repo afterwards.
13. **`run()` in `git.ts` changed for every caller**: any spawn error is a failure, and it takes a byte bound. A shared helper the plan did not name. No legitimate call changes: a spawn error beside a status of 0 only happens when output outgrew the buffer.
14. **Names are resolved by full ref**, not by the short names the plan's assumption described, so a tag cannot stand in for a branch.
15. **A done task with a kept branch and nothing past the base is unavailable**, where the plan's order would have read it from its merge base and said nothing had changed.
16. **The reader's identity has a third part.** The plan said path plus slug; the blocker showed that is the same before and after a send-back. It is now path, slug and range, and the page makes one uncached request per render of a change page to know the range.
17. **Select-to-note is not offered on a file the map never read.** AC39 did not distinguish; the button there led only to "There is no note form on this page".
18. **The routes do not build the history index**, and `taskRange` takes no index option; the plan passed one through.
19. **AC44 rests on an independent security session, not on the borrowed skill.** Said in full under AC44 and in `security-review.md`.

No bail condition fired. `taskLanding` is reused as it stands; no revision or path is spliced from a request; `--literal-pathspecs` and `--end-of-options` are accepted by this machine's git 2.55 (CI's version was not checked); the parser agrees with `--numstat` on every file of the fixture and of this repo's twelve landed merges; `branchRef` changed nothing on the board; the plain reader renders as before; the unmapped case was softened without changing what a plain file page does on a 404; the large fixture adds a tenth of a second.

## Discovered issues
Each is captured in `.reggie/intake.md`; none is fixed here.

- `a-hostile-default-branch-name-makes-a-get-write-a-file` — **high**. A request-triggered arbitrary file write, still reachable through the task route, the decide route and the CLI. Supersedes the next item.
- `a-default-branch-beginning-with-a-dash-is-a-git-option` — the build session's first, low-ranked description of the same sink. Wrong about the rank and about the new routes; kept because it was captured, superseded by the item above.
- `the-editor-scheme-from-config-becomes-a-link-with-no-allowli` — a `javascript:` editor scheme makes "Open in editor" run script on click.
- `git-runs-whatever-the-local-git-config-names` — server-wide; needs control of the local `.git/config`.
- `a-checked-out-gitattributes-can-hide-a-diff-from-the-reader` — with the version guard and the product decision a fix needs.
- `diff-rows-do-not-flag-invisible-or-direction-changing-charac` — Trojan Source, now that the reader is a review surface.
- `a-long-task-slug-in-a-story-chip-widens-the-phone-page` — the cause of AC35's caveat.
- `a-new-page-keeps-the-last-page-s-scroll-position` — a door clicked low on a task page lands on a file page scrolled past its own heading.
- `the-reader-drawer-is-two-fifths-of-a-phone-screen` — a change is read through about ten rows on a phone.
- `the-plain-reader-takes-the-same-path-in-another-repo-for-the` — noticed by reading the code; **not verified** in a browser, and the capture says so.
- `throwaway-test-repos-run-git-s-background-maintenance` — the race described under Open risks, fixed for the diff fixture only.
- `a-packet-s-evidence-line-with-prose-after-the-path-links-not` — the Completed view shows "no evidence linked" for every criterion of the last landed packet, because its evidence lines carry a sentence after the path. This packet keeps bare paths on the `evidence:` line for that reason.

The planner captured four more before the build, and they still stand: the changed-file helpers trusting git's quoting (the reason three "also changed" links stay plain, under AC32), the history reader taking an arrow in a file name for a rename, the plain file page's three 404s for a path the map never read, and the plain reader's 20,000-character cut.

## Open risks
- **The high-severity file write is still open outside these two routes.** It should not wait long.
- **Nothing under `ui/` has an automated test.** The blocker, the major and CR3 were found by a reviewer and fixed and re-verified by hand in a browser; the next regression there will be found the same way or not at all. The arithmetic is on the server on purpose, but the reader's identity, the staleness guard and paging are client logic.
- **A change page now costs one uncached request per render**, a lens change included. That is the price of never showing a stale change. Measured on this repo: about 26 ms to resolve the range, with the list and the rows answered from what the server keeps; the first request for a task pays about 30 ms more for the list and about 20 ms for the rows.
- **A legitimate file over 100,000 rows is not drawn at all**, only named, with a sentence. Nothing in this repo's history is within a hundredth of that.
- **A gap row cannot be expanded.** "Show the file" has every line, but for a landed task whose file has changed since, that file is no longer the one the rows came from; the banner says so.
- **The task list is cached for ten seconds**, so a branch claimed or landed in that window reads as it was. A moved tip is not affected; the range is resolved on every request.
- **The cross-repo half of CR7 was reasoned about, not driven in a browser.**
- **Git's background maintenance races with test repos.** While finishing, the route test that proves paging slices failed three runs in a row and then passed nine, and once a fixture build failed with git's "unable to create temporary file". The cause was measured: git packs a repo's loose objects in a detached process once it holds about a hundred, so what a test finds on disk depended on timing. The diff fixture now turns that off (`7f32a21`), after which five builds stayed loose and eight runs plus two full suites passed. Every other test repo is still subject to it; captured.
- **Five throwaway fixture folders remain in the OS temp directory** (`reggie-diff-YUKGwT`, `reggie-diff-fSRia5`, `reggie-diff-iYZXQ9`, `reggie-diff-ENQGQx`, `reggie-diff-7MmcCZ`): four that were served to a browser or probed, and one left by a probe whose output pipe closed before it could clean up. This session was refused permission to remove them. They are outside the repo and hold nothing but fixture data.

## Decision
- approved by jacobpress on 2026-09-17: Approved by the unattended run's manager session on jacobpress's standing instruction of 2026-09-17 to plan, build and merge every groomed task. Verified independently before approving: 777 tests pass under TZ=UTC, typecheck clean, generated blocks fresh, all 47 criteria ticked with every cited evidence file present on the branch. Two independent review sessions (code, security) read the branch at 101166b; every finding the task introduced is fixed except the checked-out .gitattributes one, which is captured with the pre-existing ones. Caveats stated in the packet: AC29 wording, AC35 pre-existing phone overflow from a long slug chip, AC44 met by an independent session rather than the borrowed skill.
