---
slug: idea-from-every-page
title: An idea action on every page that captures a line and opens a shaping session with the page's entity in the context pack
risk: medium
author: jacobpress
date: 2026-09-18
branch: task/idea-from-every-page
base: repo-manager
verdict: pending
decided_by:
decided_at:
---
# Completion: An idea action on every page that captures a line and opens a shaping session with the page's entity in the context pack

Read this top to bottom to decide whether the work is done. Every claim should point at evidence.

Each criterion's `evidence:` line holds file paths and nothing else, so that Reggie's own packet
reader can link them; the `how:` line under it says what in those files to look at.

Built unattended; nobody was available to answer anything. Two independent sessions then reviewed the
branch at `e823d04`, one for code and one for security, and this packet was written after their
findings were resolved. 27 of the 31 criteria are met as written. Four are ticked with a statement
beside them that should be read before the tick is believed: **AC18** (the label shows from 1500 px,
not 1440, by the manager's ruling on the code review), **AC19** (the area page already overflows a
390 px viewport by 14 px with nothing of this task on screen), **AC21** (a headless browser has no
address bar to photograph) and **AC28** (an independent session reviewed security; the borrowed skill
itself was not run).

**No real launch was ever triggered.** Every launch in the tests ran with the platform stubbed off
macOS, and every launch in a browser ran against the harness, which replaces the `osascript` call at
the `child_process` level (`harness-ok.txt`, `harness-deny.txt`, `harness-hang.txt`,
`harness-keyed.txt` and `harness-review.txt` hold the stub's line for each). The real Terminal path,
`launched: true` with a window actually opening, has never been exercised by this task; the owner's
first click is the first real one.

## Acceptance criteria
- [x] AC1 `resolveCaptureOrigin` accepts a file (`src/serve.ts`), a folder written as `src/lib`, `src/lib/` and `./src/lib`, a file with a space, a file whose path holds non-ASCII letters, and a symlink that git tracks whose target is inside the repo, and returns the kind and the tidied path (no leading `./`, no trailing slash) for each.
  evidence: .reggie/tasks/idea-from-every-page/evidence/origin-resolver.txt
  how: `origin-resolver.txt` — the table-driven case over the seven accepted shapes (a file, `src/lib`, `src/lib/`, `./src/lib`, a file with a space, `src/café ü/uni.ts`, and `docs/inside`, a tracked symlink into the repo), each asserted by deep equality on the kind and the tidied path.
- [x] AC2 `resolveCaptureOrigin` refuses, with a sentence that holds no absolute path, each of: an empty path, `.`, `./`, an absolute path, a path with a `..` segment, a backslash, a NUL, a newline, a tab, a backtick, `[`, `]`, `|`, `.git/HEAD`, a path under an ignored directory (`.reggie/.cache/x`), a glob (`src/*.ts`), pathspec magic (`:(exclude)src`), a file that is in the index but no longer on disk, a file that was never in `git ls-files`, and a tracked symlink whose target resolves outside the repo; after each refusal `.reggie/intake.md` is byte-identical to before.
  evidence: .reggie/tasks/idea-from-every-page/evidence/origin-resolver.txt, .reggie/tasks/idea-from-every-page/evidence/review-tests-before-fix.txt
  how: `origin-resolver.txt` — the table of refused inputs: every one the criterion names (the absolute case twice, once as the fixture root itself), and since the review a trailing newline, a leading tab, NEL, U+2028, U+2029, U+200B, U+FEFF and a real file named with a zero-width space that git lists. Each asserts the sentence, that it holds neither the fixture root nor any `/Users`, `/private`, `/var`, `/tmp` or `/etc` path outside backticks, and that the intake file's bytes are unchanged. S4 was fixed by refusing on the raw value, so "a newline, a tab" holds for a trailing one too; `review-tests-before-fix.txt` shows that case failing on the resolver as reviewed.
- [x] AC3 `resolveCaptureOrigin` refuses a `symbol` without a path, a `symbol` with a folder path, a `symbol` that fails `^[A-Za-z_$][A-Za-z0-9_$]{0,199}$` (a space, `::`, `<script>`, 201 characters), a `task` given together with a path, a `task` that fails `isSafeSlug`, and a `task` no task in the repo carries.
  evidence: .reggie/tasks/idea-from-every-page/evidence/origin-resolver.txt
  how: `origin-resolver.txt` — the symbol and task case: a symbol alone, with a folder, with a space, `a::b`, `<script>`, 201 characters and the empty string; a task with a path, `Not A Slug`, `../etc`, and a slug no task carries; and the accepted forms beside them, including `knownTasks` supplied by the caller.
- [x] AC4 `capture()` with an origin writes exactly one added detail line, the last `  > ` line under the item, reading `` Captured from the file `src/serve.ts` ``, `` Captured from the folder `src/lib` ``, `` Captured from `launchSession` in the file `src/serve.ts` `` or `` Captured from the task `<slug>` ``; the intake line itself is byte-identical to one captured without an origin; a `detail` given beside the origin is written first; `parseIntake` reads the line and its detail back, `removeFromIntake` removes both, and `scaffoldBrief` copies the origin line into the brief's Problem.
  evidence: .reggie/tasks/idea-from-every-page/evidence/detail-line.txt, .reggie/tasks/idea-from-every-page/evidence/intake-after.txt
  how: `detail-line.txt` — the four lines asserted through `readIntake`, exactly four `  > Captured from` lines in the file, the intake line compared with one captured without an origin, the detail-then-origin order asserted on the raw bytes, the round trip through `parseIntake` and `removeFromIntake`, and `scaffoldBrief` asserted to carry the origin line into the brief (and to take the intake line). `intake-after.txt` is the intake file after the four cases, the folder one with a detail line first.
- [x] AC5 A capture whose origin is a task writes the detail line naming that task for an origin in each of the six states, mints the new slug from the text, and when the text equals the origin task's title and slugifies to the origin's own slug the new slug is `<origin>-2`; the new item's state is `ungroomed` and the origin task's state is unchanged.
  evidence: .reggie/tasks/idea-from-every-page/evidence/detail-line.txt
  how: `detail-line.txt` — a fixture with a task in each of the six states (the fixture's three, plus a filled brief, a passing plan on main, and a packet approved on main), the states asserted first; a capture from each names that task, mints `idea-from-<state>`, leaves the origin's state unchanged and lands `ungroomed`; text equal to the ungroomed origin's title mints `<origin>-2`.
- [x] AC6 `POST /api/capture` with `path`, `path` and `symbol`, or `task` answers 200 with `{ slug, line, origin: { kind, path?, symbol?, task? } }` and the file holds the line and the detail; without any of the three it answers `origin: null` and writes exactly what it wrote before this task; each refusal in AC2 and AC3 answers 400 with the resolver's sentence and writes nothing; a body over 64 KB is still 413.
  evidence: .reggie/tasks/idea-from-every-page/evidence/api-capture.txt, .reggie/tasks/idea-from-every-page/evidence/api-capture.json
  how: `api-capture.txt` — the route cases: a file, a symbol (with `./` tidied), a folder with a detail, a task, a spaced path, a non-ASCII path, and no origin (`origin: null`, keys exactly `line`, `origin`, `slug`), each checked in the file's bytes; twenty-nine refusals answering 400 with the resolver's sentence and an unchanged intake; and the 70 KB body still 413. `api-capture.json` is one captured 200 answer from the route.
- [x] AC7 `POST /api/capture` carrying `path` from a foreign `Origin`, and with `Sec-Fetch-Site: cross-site`, is refused 403 and writes nothing; in team mode over a keyed socket it is refused 403 and writes nothing.
  evidence: .reggie/tasks/idea-from-every-page/evidence/api-capture.txt
  how: `api-capture.txt` — a foreign `Origin` and `Sec-Fetch-Site: cross-site`, both 403 with the intake unchanged; and the team-mode case, which starts a second server bound to `0.0.0.0` over a team-mode repo, posts over this machine's network address with the minted key, and gets 403 with nothing written. It ran here (the output shows it passing, not skipped); on a machine with no network interface it is now skipped visibly (CR9).
- [x] AC8 `launchCommand` with `paths` puts the clause naming each path into the prompt for the shape, plan, discuss and build goals, keeps the prompt as one element of `argv` in which a path holding `'`, a space, `$(`, a backtick, `;` and `|` appears verbatim, and in `command` that element is one single-quoted word with `'` written as `'\''`; it throws before building anything for an empty entry, a control character, a ninth path or a path over 512 characters; without `paths` every prompt is byte-identical to today's.
  evidence: .reggie/tasks/idea-from-every-page/evidence/launch-quoting.txt
  how: `launch-quoting.txt` — the clause asserted for both tools in the shape, plan, discuss and build goals, after the context clause; two and three paths joined with "and"; a hostile path found in exactly one element of `argv`, that element single-quoted in `command` with `'\''`, and round-tripped through a real `sh`; the four refusals; and `argv` and `command` compared with and without an empty `paths` for every goal.
- [x] AC9 `POST /api/launch` with `paths: ["src/lib"]` (and with the singular `path` alias) resolves each path with `resolveCaptureOrigin`, answers 400 with its sentence for a refused path before any pack is written, any session minted or any launch recorded, and for an accepted path writes a pack under `.reggie/.cache/context/<slug>.md` that holds the folder's note chain, the folder under "Files in scope", the commits that touched it and the tasks whose plans overlap it, and a command holding the clause; `GET /api/launch?path=` answers the same command and the same 400.
  evidence: .reggie/tasks/idea-from-every-page/evidence/api-launch.txt, .reggie/tasks/idea-from-every-page/evidence/pack-folder.md
  how: `api-launch.txt` — eight refused launch paths answering 400 with no pack file, no `launches/` directory and an unchanged intake, and the same sentence over GET; an accepted folder described over GET and run over POST (platform stubbed off macOS), the two commands equal but for the minted session id, the pack read back for the repo note, the folder's note, the scope, the commits and the related task; the singular `path` alias with Codex. Since the review a fourth case: a `paths` or `path` of the wrong shape and a blank path answer 400, and nine spellings of two paths are two. `pack-folder.md` is a pack as written for a folder.
- [x] AC10 A capture with a file origin followed at once by a launch of the new slug (the same second, no wait) answers 200 with `goal: "shape"`, and the pack holds the file's own note and its commits: the launch never answers 404 for a slug the capture just minted.
  evidence: .reggie/tasks/idea-from-every-page/evidence/api-launch.txt
  how: `api-launch.txt` — "launches the slug a capture just minted, in the same second": the two POSTs back to back with no wait, 200 with `goal: "shape"`, the pack holding the file's own note, the file in scope and its commits. The bail condition about a 404 here did not fire.
- [x] AC11 With the platform stubbed off macOS, capture then launch answers `launched: false` with `reason`, `command`, `goal: "shape"` and, for Claude, a UUID `session` and a `resume` command; afterwards `.reggie/intake.md` still holds the captured line and its origin detail line, and the pack file exists with the path in scope.
  evidence: .reggie/tasks/idea-from-every-page/evidence/failure-path.txt
  how: `failure-path.txt` — the same case read for the failure path: `launched: false`, a reason naming macOS, the command holding the clause, a UUID session and its resume command; the intake still holding the line and its origin line afterwards, and the pack file on disk with the path in scope.
- [x] AC12 The pack for a fresh slug with a file origin holds the file's own note and the repo note; with a folder origin it holds the folder's `_dir` note; with a symbol origin it is the same pack as for the file; with a task origin or no origin it holds the repo note and the working agreement and no "Files in scope" section; a symbol origin whose file the code map never read (a file under `.reggie/`) still produces the pack with that file's commits.
  evidence: .reggie/tasks/idea-from-every-page/evidence/pack-by-level.txt, .reggie/tasks/idea-from-every-page/evidence/pack-file.md, .reggie/tasks/idea-from-every-page/evidence/pack-folder.md, .reggie/tasks/idea-from-every-page/evidence/pack-symbol.md, .reggie/tasks/idea-from-every-page/evidence/pack-task.md
  how: `pack-by-level.txt` — four cases over `buildContext` for a fresh slug: a file origin (its own note and the repo note), a folder origin (its `_dir` note and the related task), a symbol origin whose pack is built from the origin's `path` field and equals the file's (CR8: the two calls are no longer the same call), a task origin or none (no "Files in scope"), and a file under `.reggie/` with that file's commits and not the whole repo's. The four `.md` files are the packs themselves, written by a scratch script over the same fixture (Deviation 8).
- [x] AC13 `reggie capture "<text>" --path src/lib` and `--path src/serve.ts` write the folder and file origin lines with source `cli`; `--path src/gone.ts`, `--path .` and `--path ""` exit 1 with the resolver's sentence and write nothing; `--detail "d" --path src/lib` writes `d` before the origin line.
  evidence: .reggie/tasks/idea-from-every-page/evidence/cli.txt
  how: `cli.txt` — `tsx src/cli.ts --root <fixture> capture …` spawned the way `land.test.ts` spawns it: the folder and file lines with `cli` in the stamp, `--detail d` before the origin line, and `--path src/gone.ts`, `.` and the empty string each exiting 1 with the resolver's sentence, empty stdout and an unchanged intake.
- [x] AC14 `reggie launch <slug> --path src/lib --path src/serve.ts` without `--run` prints a command whose prompt holds the clause naming both paths; `--path src/gone.ts` exits 1 before printing a command; the `--run` branch passes the resolved paths to `buildContext`, shown by a unit case on the shared function the two callers use.
  evidence: .reggie/tasks/idea-from-every-page/evidence/cli.txt
  how: `cli.txt` — `launch <slug> --path src/lib --path src/serve.ts` printing the clause naming both, `./src/lib/` tidied, `src/gone.ts` and `../etc` exiting 1 with empty stdout; and the unit case on `writeContextPacks`, the one function `POST /api/launch` and `launch --run` both call, asserting the written pack holds both paths in scope and both notes, and none without paths.
- [x] AC15 `reggie_capture` with `path: "src/lib"` writes the folder origin line with source `mcp` and reports the slug; with `path: "../etc"` it returns `isError` with the resolver's sentence and writes nothing; the tool list is otherwise unchanged and no launch tool is registered.
  evidence: .reggie/tasks/idea-from-every-page/evidence/mcp.txt
  how: `mcp.txt` — over the stdio transport: `path: "src/lib"` writes the folder line with `mcp` in the stamp and reports the slug; `path: "../etc"` returns `isError` with "a path may not step outside the repo" and an unchanged intake; ten tools, none with "launch" in its name.
- [x] AC16 `#idea-trigger` is present in `.header__tools` on the repo, area, file, symbol, task, tasks, services, flows and flow levels and hidden on the workspace level; clicking it opens `.idea` with `role="dialog"`, focus in the input, and a sentence naming the repo and, per level, the folder, the file, the symbol in its file, or the task; Escape closes it and returns focus to the trigger.
  evidence: .reggie/tasks/idea-from-every-page/evidence/browser-trigger-levels.txt, .reggie/tasks/idea-from-every-page/evidence/browser-popover-file.png
  how: `browser-trigger-levels.txt` — read from the DOM at nine levels: the trigger's `hidden`, its place as the first child of `.header__tools`, the dialog's role, label, focus and sentence, and after Escape the dialog hidden with focus on the trigger. The fixture has no flow, so the `flow` level itself was not opened; it takes the same branch of `originFor` as `flows`. Read on the first build; the review fixes did not touch these paths. `browser-popover-file.png` is the open popover on the file page.
- [x] AC17 On the workspace page each repo card is a `div.ws-tile` holding `a.ws-tile__link` and `button.ws-tile__idea`; the link still opens the repo page and the button opens `.idea` naming that repo alone; a workspace whose listing has no repos draws no tile and no trigger.
  evidence: .reggie/tasks/idea-from-every-page/evidence/browser-workspace-tiles.png, .reggie/tasks/idea-from-every-page/evidence/browser-workspace.txt
  how: `browser-workspace.txt` — each tile a `DIV.ws-tile` with `a.ws-tile__link` as its child and `button.ws-tile__idea` outside the link, the two hrefs, the header trigger hidden, and the button opening "Into bare, as a repo-wide idea." The empty-listing run draws no tile and no trigger, but only because that page is an error card: a registry with no repos answers every route 404 (pre-existing, captured). The map-to-tile hover highlight was not re-tested by eye; the wrapper keeps `data-refs` and the two hover handlers.
- [x] AC18 In a real browser at 1440 by 900 against the harness in `ok` mode, submitting a line from the repo, area, file, symbol and task pages captures it (the toast names the slug, `.reggie/intake.md` holds the line and the right origin line), the launch request body holds `slugs`, `tool`, `mode` and `paths` and never the captured text, the launcher's toast reports the session, and the popover closes; the header at 1440 shows the icon and the label, and the breadcrumb title is still readable on the repo page.
  evidence: .reggie/tasks/idea-from-every-page/evidence/browser-desktop-repo.png, .reggie/tasks/idea-from-every-page/evidence/browser-desktop-area.png, .reggie/tasks/idea-from-every-page/evidence/browser-desktop-file.png, .reggie/tasks/idea-from-every-page/evidence/browser-desktop-symbol.png, .reggie/tasks/idea-from-every-page/evidence/browser-desktop-task.png, .reggie/tasks/idea-from-every-page/evidence/browser-desktop-repo-final.png, .reggie/tasks/idea-from-every-page/evidence/browser-intake-after.txt, .reggie/tasks/idea-from-every-page/evidence/browser-network.txt, .reggie/tasks/idea-from-every-page/evidence/review-majors-after.txt
  how: **One clause is not met as written, by ruling: read this before the tick.** Everything about the five submits holds: `browser-network.txt` has each pair of bodies (the launch body holds `slugs`, `tool`, `mode` and, where the page has an entity, `paths`; never the text), the toasts and the closed popover; `browser-intake-after.txt` is the served intake with the five lines and the four origin lines exactly as specified. The clause "the header at 1440 shows the icon and the label" is **not** true of the branch: the first build showed the label from 1440 (the five `browser-desktop-*.png`), the code review measured that against a real repo name (CR4), and the manager ruled for the plan's own 1500 breakpoint, which the plan's Approach had said all along. At 1440 the header shows the icon alone (`browser-desktop-repo-final.png`, taken on the final code; numbers in `review-majors-after.txt`). The fixture's title is fully readable on the repo page; with `forge-reggie` it keeps 62 of 126 px beside the icon (Open risks).
- [x] AC19 In a real browser at 390 by 844 against the same harness, the trigger is an icon in the header on the five page kinds, the popover spans the width under the header, `document.documentElement.scrollWidth` equals `clientWidth` with it open, and submitting from each page kind captures and reports as in AC18.
  evidence: .reggie/tasks/idea-from-every-page/evidence/browser-phone-repo.png, .reggie/tasks/idea-from-every-page/evidence/browser-phone-area.png, .reggie/tasks/idea-from-every-page/evidence/browser-phone-file.png, .reggie/tasks/idea-from-every-page/evidence/browser-phone-symbol.png, .reggie/tasks/idea-from-every-page/evidence/browser-phone-task.png, .reggie/tasks/idea-from-every-page/evidence/browser-phone-overflow.txt
  how: **Holds on four of the five page kinds; read this before the tick.** `browser-phone-overflow.txt` — Chrome device emulation at 390 by 844: the trigger is the 36 px icon, the popover spans 8 to 382 under the 48 px header with focus in its input, and each page kind captured and reported as in AC18. `scrollWidth` equals `clientWidth` (390) with the popover open on the repo, file, symbol and task pages. On the **area** page it is 404 with the popover closed and 404 with it open: the phone tab bar and a chip in the area story overflow the viewport by 14 px with nothing of this task on screen. Pre-existing, captured, not fixed; the popover adds nothing to it.
- [x] AC20 In a real browser against the harness in `deny` mode, submitting from a file page shows, inside the popover, a link to the new task, the server's reason, and the copy field holding the command with the path clause, while `.reggie/intake.md` holds the line and its origin line; in `hang` mode the popover shows the "still waiting" sentence and the command after six seconds and the timeout reason after the server answers, and the capture stands.
  evidence: .reggie/tasks/idea-from-every-page/evidence/browser-fail-deny.png, .reggie/tasks/idea-from-every-page/evidence/browser-fail-hang-waiting.png, .reggie/tasks/idea-from-every-page/evidence/browser-fail-hang-answer.png, .reggie/tasks/idea-from-every-page/evidence/browser-fail.txt, .reggie/tasks/idea-from-every-page/evidence/review-majors-after.txt
  how: `browser-fail.txt` — deny: the link, the server's reason and the copy field holding the command with the path clause, and the served intake's line and origin line. Hang: the description answered at 205 ms, the "still waiting" sentence and the command at 6.6 s with the form still disabled, the 8 s timeout reason after the answer, and the capture in the intake. (The plan names `browser-intake-after.txt` for the intake here; that file is the `ok` run's, so the deny and hang intake lines are in `browser-fail.txt`.) The hang run predates the review; since CR2 a description that arrives after the answer is dropped, reproduced both ways in `review-majors-after.txt`.
- [x] AC21 In a real browser opened through a network address with `?key=` against the harness bound to `0.0.0.0` in `ok` mode, submitting from a file page keeps the popover open with the link to the new task, the sentence that the session opened on the machine running `reggie serve`, and the copy field holding the command; the capture is in the file.
  evidence: .reggie/tasks/idea-from-every-page/evidence/browser-keyed.png, .reggie/tasks/idea-from-every-page/evidence/browser-keyed.txt
  how: **The screenshot cannot show the address bar; read this before the tick.** `browser-keyed.txt` — the harness bound to `0.0.0.0` in `ok` mode, the page opened at `http://172.16.0.124:4905/?key=…`; `location.href` read from the page afterwards is the network address with the key adopted and dropped, and both POSTs carried the key header. The popover stayed open with the link, the sentence that the session opened on the machine running `reggie serve`, and the copy field; the capture is in the served intake. The browser was driven headless, which has no address bar, so the address is recorded from the page rather than shown in `browser-keyed.png`.
- [x] AC22 While a submit is in flight the input, the main button and the caret are `disabled` and a second click changes nothing; after the answer a second submit of the same text captures `<slug>-2`.
  evidence: .reggie/tasks/idea-from-every-page/evidence/browser-doubleclick.txt, .reggie/tasks/idea-from-every-page/evidence/review-majors-after.txt
  how: `browser-doubleclick.txt` — 25 ms after the click the input, the main button and the caret all read `disabled` ("Capturing…"); two further clicks produced no further request (exactly one capture and one launch in the hook's log); the same text submitted after the answer captured `…-2`. Since the review a click on the header trigger mid-flight changes nothing either (`review-majors-after.txt`, CR5).
- [x] AC23 With `reggie.launch.tool` remembered as `codex`, the main button reads "Capture and shape in Codex", the launch body says `tool: "codex"`, the answer has `session: null`, and the launch record's `tool` is `codex`; choosing Claude Code from the caret changes the remembered tool.
  evidence: .reggie/tasks/idea-from-every-page/evidence/browser-codex.png, .reggie/tasks/idea-from-every-page/evidence/browser-network.txt, .reggie/tasks/idea-from-every-page/evidence/launch-record-codex.json, .reggie/tasks/idea-from-every-page/evidence/browser-doubleclick.txt
  how: `browser-doubleclick.txt` and `browser-network.txt` — with `reggie.launch.tool` set to `codex` the main button read "Capture and shape in Codex" and the launch body said `tool: "codex"`; the command began `codex -s read-only`; `launch-record-codex.json` is the record, `tool: "codex"`, `session: null`. Choosing Claude Code from the caret set the remembered tool to `claude` and the button followed.
- [x] AC24 After a capture from a task page, the new item's board card detail panel and its task page's "What was written" section both show the origin line naming the origin task, with no change to `story.ts`, `story.js` or the board's rendering.
  evidence: .reggie/tasks/idea-from-every-page/evidence/browser-origin-shown-card.png, .reggie/tasks/idea-from-every-page/evidence/browser-origin-shown-task.png, .reggie/tasks/idea-from-every-page/evidence/untouched.txt
  how: The two screenshots show "Captured from the task `cache-chain-shape`" in the board card's detail panel (under "Detail") and in the task page's "What was written" section. `untouched.txt` — an empty `git diff --stat` for `story.ts` and `story.js`, and the whole `board.js` diff: five exports and `paths` through the launcher, no rendering function moved.
- [x] AC25 Against a served repo that has no `.reggie/` directory, submitting from its repo page creates `.reggie/intake.md` holding the line, and the launch answers 200.
  evidence: .reggie/tasks/idea-from-every-page/evidence/browser-bare-repo.txt
  how: `browser-bare-repo.txt` — the workspace's `bare` repo, a git repo with no `.reggie/` at all: the submit created `.reggie/intake.md` with the header and the line, the launch answered 200 (`launched: true` through the `ok` stub, `goal: "shape"`), and `git status` there shows `.reggie/` as the only change.
- [x] AC26 `packages/reggie/docs/ui-api-contract.md` documents `path`, `symbol` and `task` on `POST /api/capture` with the `origin` field of the answer and every refusal, `paths` and `path` on `POST /api/launch` and `path` on `GET /api/launch`, and the sentence added to the prompt; `packages/reggie/docs/ui-spec.md` documents the header button, the tile button and the flow; `packages/reggie/ui/DOM-CONTRACT.md` documents `#idea-trigger`, the `.idea` classes, `.ws-tile__link`, `.ws-tile__idea`, the `idea` icon, the `ui/idea.js` module and the new `board.js` exports; `packages/reggie/README.md` lists `--path` on `capture` and `launch`.
  evidence: .reggie/tasks/idea-from-every-page/evidence/api-contract.diff, .reggie/tasks/idea-from-every-page/evidence/ui-spec.diff, .reggie/tasks/idea-from-every-page/evidence/dom-contract.diff, .reggie/tasks/idea-from-every-page/evidence/readme.diff
  how: The four diffs against `repo-manager`, regenerated after the review fixes: the capture fields, the `origin` echo and every refusal (the invisible-character list, the 200-character echo, the blank path), `paths`/`path` on both launch routes with the cap counted after resolution and the wrong-shape 400s, and the sentence added to the prompt; the header button (label from 1500), the tile button and §3.9 for the flow, with the in-flight rules the review added; the trigger's id, the `.idea` classes, the tile's new shape, the `idea` icon, the `idea.js` module and the five `board.js` exports; `--path` on `capture` and on `launch` (whose row the README never had).
- [x] AC27 An entity note exists for `ui/idea.js`, and the notes for `capture.ts`, `launch.ts`, `serve.ts`, `cli.ts`, `mcp.ts`, `app.js`, `board.js`, `index.html`, `styles.css`, `DOM-CONTRACT.md` and `ui-api-contract.md` each gain an entry saying what this task changed there.
  evidence: .reggie/tasks/idea-from-every-page/evidence/notes.txt
  how: `notes.txt` — `reggie note path` for each of the twelve files, filtered to this task's entries, and the stat of `.reggie/notes/`: eighteen note files, four of them new (`ui/idea.js`, `ui/map.css`, `test/serve-idea-fixture.ts` and `src/capture-race.test.ts`).
- [x] AC28 A `/security-review` pass over the branch's diff is recorded, and every finding in it is either fixed on the branch or answered in writing; the record states where the body's `path` is validated, that the detail line is built only from the resolver's output, and that the path reaches the command line only inside the single-quoted prompt.
  evidence: .reggie/tasks/idea-from-every-page/evidence/security-review.md
  how: **The borrowed skill was not run; read this before the tick.** `/security-review` resolves its diff against the parent session's directory when started from a subagent, which would have reviewed the integration checkout and not this worktree. An independent security session, started by the manager, reviewed the task worktree at `e823d04` with its own probes instead. `security-review.md` records that, each of its four LOW findings with the commit and the failing-before test that resolved it, the four pre-existing observations and their captures, the three statements the criterion asks for, and what the review found sound.
- [x] AC29 `TZ=UTC npx vitest run` in `packages/reggie` passes with at least the baseline 1022 passed and 1 skipped, and no failures.
  evidence: .reggie/tasks/idea-from-every-page/evidence/tests.txt
  how: `tests.txt` — `TZ=UTC npx vitest run` whole, at the review-fix HEAD: 37 files, **1052 passed, 1 skipped**, no failures (baseline 1022 and 1; thirty new tests).
- [x] AC30 `npm run typecheck` in `packages/reggie` passes with no output after the tsc line.
  evidence: .reggie/tasks/idea-from-every-page/evidence/typecheck.txt
  how: `typecheck.txt` — `npm run typecheck` with nothing after the tsc line, exit 0. The harness is under `test/`, outside the package tsconfig (whose root is `src`), so that run does not see it; the same file records it typechecking on its own, exit 0 (CR11).
- [x] AC31 After `npm run build` and `reggie docs refresh` on a clean tree, `reggie docs check` reports both `CLAUDE.md` and `AGENTS.md` fresh.
  evidence: .reggie/tasks/idea-from-every-page/evidence/docs-check.txt
  how: `docs-check.txt` — after `npm run build`, `reggie docs refresh` updated both files (new source, test and note files), and `npx tsx src/cli.ts docs check` (the branch's own code) reported both fresh, exit 0; repeated on a clean tree after the first build and again after the review fixes moved one file and added one, where the refresh reports both unchanged.

## Evidence
- .reggie/tasks/idea-from-every-page/evidence/api-capture.json
- .reggie/tasks/idea-from-every-page/evidence/api-capture.txt
- .reggie/tasks/idea-from-every-page/evidence/api-contract.diff
- .reggie/tasks/idea-from-every-page/evidence/api-launch.txt
- .reggie/tasks/idea-from-every-page/evidence/browser-bare-repo.txt
- .reggie/tasks/idea-from-every-page/evidence/browser-codex.png
- .reggie/tasks/idea-from-every-page/evidence/browser-desktop-area.png
- .reggie/tasks/idea-from-every-page/evidence/browser-desktop-file.png
- .reggie/tasks/idea-from-every-page/evidence/browser-desktop-repo-final.png
- .reggie/tasks/idea-from-every-page/evidence/browser-desktop-repo.png
- .reggie/tasks/idea-from-every-page/evidence/browser-desktop-symbol.png
- .reggie/tasks/idea-from-every-page/evidence/browser-desktop-task.png
- .reggie/tasks/idea-from-every-page/evidence/browser-doubleclick.txt
- .reggie/tasks/idea-from-every-page/evidence/browser-fail-deny.png
- .reggie/tasks/idea-from-every-page/evidence/browser-fail-hang-answer.png
- .reggie/tasks/idea-from-every-page/evidence/browser-fail-hang-waiting.png
- .reggie/tasks/idea-from-every-page/evidence/browser-fail.txt
- .reggie/tasks/idea-from-every-page/evidence/browser-intake-after.txt
- .reggie/tasks/idea-from-every-page/evidence/browser-keyed.png
- .reggie/tasks/idea-from-every-page/evidence/browser-keyed.txt
- .reggie/tasks/idea-from-every-page/evidence/browser-network.txt
- .reggie/tasks/idea-from-every-page/evidence/browser-origin-shown-card.png
- .reggie/tasks/idea-from-every-page/evidence/browser-origin-shown-task.png
- .reggie/tasks/idea-from-every-page/evidence/browser-phone-area.png
- .reggie/tasks/idea-from-every-page/evidence/browser-phone-file.png
- .reggie/tasks/idea-from-every-page/evidence/browser-phone-overflow.txt
- .reggie/tasks/idea-from-every-page/evidence/browser-phone-repo.png
- .reggie/tasks/idea-from-every-page/evidence/browser-phone-symbol.png
- .reggie/tasks/idea-from-every-page/evidence/browser-phone-task.png
- .reggie/tasks/idea-from-every-page/evidence/browser-popover-file.png
- .reggie/tasks/idea-from-every-page/evidence/browser-trigger-levels.txt
- .reggie/tasks/idea-from-every-page/evidence/browser-workspace-tiles.png
- .reggie/tasks/idea-from-every-page/evidence/browser-workspace.txt
- .reggie/tasks/idea-from-every-page/evidence/cli.txt
- .reggie/tasks/idea-from-every-page/evidence/detail-line.txt
- .reggie/tasks/idea-from-every-page/evidence/docs-check.txt
- .reggie/tasks/idea-from-every-page/evidence/dom-contract.diff
- .reggie/tasks/idea-from-every-page/evidence/failure-path.txt
- .reggie/tasks/idea-from-every-page/evidence/harness-deny.txt
- .reggie/tasks/idea-from-every-page/evidence/harness-hang.txt
- .reggie/tasks/idea-from-every-page/evidence/harness-keyed.txt
- .reggie/tasks/idea-from-every-page/evidence/harness-ok.txt
- .reggie/tasks/idea-from-every-page/evidence/harness-review.txt
- .reggie/tasks/idea-from-every-page/evidence/intake-after.txt
- .reggie/tasks/idea-from-every-page/evidence/launch-quoting.txt
- .reggie/tasks/idea-from-every-page/evidence/launch-record-codex.json
- .reggie/tasks/idea-from-every-page/evidence/mcp.txt
- .reggie/tasks/idea-from-every-page/evidence/notes.txt
- .reggie/tasks/idea-from-every-page/evidence/origin-resolver.txt
- .reggie/tasks/idea-from-every-page/evidence/pack-by-level.txt
- .reggie/tasks/idea-from-every-page/evidence/pack-file.md
- .reggie/tasks/idea-from-every-page/evidence/pack-folder.md
- .reggie/tasks/idea-from-every-page/evidence/pack-symbol.md
- .reggie/tasks/idea-from-every-page/evidence/pack-task.md
- .reggie/tasks/idea-from-every-page/evidence/readme.diff
- .reggie/tasks/idea-from-every-page/evidence/review-cr1-after.png
- .reggie/tasks/idea-from-every-page/evidence/review-cr2-after.png
- .reggie/tasks/idea-from-every-page/evidence/review-cr2-before.png
- .reggie/tasks/idea-from-every-page/evidence/review-cr3-after.png
- .reggie/tasks/idea-from-every-page/evidence/review-cr3-before.png
- .reggie/tasks/idea-from-every-page/evidence/review-cr4-header-1440-forge-reggie.png
- .reggie/tasks/idea-from-every-page/evidence/review-majors-after.txt
- .reggie/tasks/idea-from-every-page/evidence/review-majors-before.txt
- .reggie/tasks/idea-from-every-page/evidence/review-tests-before-fix.txt
- .reggie/tasks/idea-from-every-page/evidence/security-review.md
- .reggie/tasks/idea-from-every-page/evidence/tests.txt
- .reggie/tasks/idea-from-every-page/evidence/typecheck.txt
- .reggie/tasks/idea-from-every-page/evidence/ui-spec.diff
- .reggie/tasks/idea-from-every-page/evidence/untouched.txt

## Changes
Against `repo-manager`, before this packet's own commit: 109 files changed, 3724 insertions(+), 82 deletions(-). Most of those files are evidence, notes and the journal; the product files:

```
 AGENTS.md                                  |   8 +-
 CLAUDE.md                                  |   8 +-
 packages/reggie/README.md                  |   5 +-
 packages/reggie/docs/ui-api-contract.md    |   8 +-
 packages/reggie/docs/ui-spec.md            |  14 +-
 packages/reggie/src/capture-race.test.ts   |  50 ++++
 packages/reggie/src/capture.test.ts        | 312 ++++++++++++++++++++-
 packages/reggie/src/capture.ts             | 154 ++++++++++-
 packages/reggie/src/cli.ts                 |  28 +-
 packages/reggie/src/context.test.ts        |  54 ++++
 packages/reggie/src/launch.test.ts         | 136 +++++++++
 packages/reggie/src/launch.ts              |  85 +++++-
 packages/reggie/src/mcp.ts                 |  18 +-
 packages/reggie/src/serve.ts               |  96 ++++++-
 packages/reggie/test/mcp.test.ts           |  28 +-
 packages/reggie/test/serve-idea-fixture.ts | 137 +++++++++
 packages/reggie/test/serve.test.ts         | 288 ++++++++++++++++++-
 packages/reggie/ui/DOM-CONTRACT.md         |  22 +-
 packages/reggie/ui/app.js                  |  11 +-
 packages/reggie/ui/board.js                |  34 ++-
 packages/reggie/ui/idea.js                 | 427 +++++++++++++++++++++++++++++
 packages/reggie/ui/index.html              |   7 +
 packages/reggie/ui/map.css                 |  17 +-
 packages/reggie/ui/styles.css              |  53 ++++
 24 files changed, 1918 insertions(+), 82 deletions(-)
```

- **`src/capture.ts`** — `resolveCaptureOrigin`, the one validator every door calls; `originLine`; `CaptureInput.origin`, written as the last detail line; `resolvePackPaths`; the shared `INVISIBLE_CHARS` class.
- **`src/launch.ts`** — `LaunchInput.paths`, checked for what can reach a command line and named in one sentence of every goal's prompt; `writeContextPacks`, the function both launchers build their packs through. `launchCommand` stays pure.
- **`src/serve.ts`** — `POST /api/capture` takes `path`, `symbol`, `task` and echoes `origin`; both launch routes take `path`/`paths`, resolved before anything is written, minted or recorded.
- **`src/cli.ts`, `src/mcp.ts`** — `reggie capture --path`, `reggie launch --path`, and `reggie_capture`'s `path`. No MCP launch tool.
- **`ui/idea.js`** (new) — the trigger, the popover and the capture-then-launch sequence. **`ui/board.js`** exports five existing pieces and carries `paths`. **`ui/app.js`** mounts the trigger and makes each workspace tile a `div` holding the link and its idea button. **`ui/index.html`**, **`ui/styles.css`**, **`ui/map.css`** — the button, the icon, the popover, the phone breadcrumb, the tile.
- **`test/serve-idea-fixture.ts`** (new) — the browser harness with Terminal stubbed in three modes.
- Tests in `src/capture.test.ts`, `src/capture-race.test.ts` (new), `src/launch.test.ts`, `src/context.test.ts`, `test/serve.test.ts`, `test/mcp.test.ts`; the four documents; `CLAUDE.md` and `AGENTS.md` regenerated.

## Reviews
Two independent sessions, started by the manager, read the task worktree at `e823d04` (23 product files); neither was the build session. The borrowed `/code-review`, `/security-review` and `/simplify` skills were **not** run by anyone: from a subagent they resolve their diff against the parent session's directory, which is the integration checkout and not the task worktree. Each of the three majors was reproduced in a real browser with the reviewer's exact trigger before it was touched and again afterwards (`review-majors-before.txt`, `review-majors-after.txt`, the `review-cr*.png` files); each server-side fix has a test that fails on the code as reviewed (`review-tests-before-fix.txt`). The fixes are `6d769fb` (server), `8daa93b` (client), `2791847` (harness) and `fb5d762` (documents).

**Code review** (3 major, 2 minor, 6 nit):

1. **CR1, major — the launch was built for the page the reader moved to, not the page the line came from.** Fixed in `8daa93b`. Reproduced: a capture delayed 2.5 s, a move to the area page, a click on the trigger; the intake said "Captured from the file `src/types/shape.ts`" while the launch body and the pack's scope said `src/big`. `submit` now takes a snapshot of the repo, the origin and the launcher before its first await, and an open while a submit is in flight shows the popover without re-targeting it. After: the launch body, the pack and the intake all name the file.
2. **CR2, major — a late description overwrote the server's answer with "Still waiting".** Fixed in `8daa93b` with the reviewer's settled flag. Reproduced with the launch answering at 7 s and the description at 9 s: the reason shown at 8 s was replaced at 10.8 s. After: the reason stands at 10.8 s and 12.5 s. Deviation 5 (the pre-fetch) introduced this; the reviewer judged the pre-fetch itself right.
3. **CR3, major — a star re-export's symbol page could never capture.** Fixed in `8daa93b`. Reproduced on `symbol/src/index.ts::*`, a page the file story links: the body carried `symbol: "*"` and the server answered 400. `originFor` now posts the file alone for a name that is not an identifier (a symbol page is the file level by the brief). After: 200 with a file origin, and the sentence reads "from the file `src/index.ts`".
4. **CR4, minor — the label at 1440 rested on a seven-character repo name.** Fixed in `8daa93b` by taking the plan's 1500 breakpoint, as the manager ruled. Measured with the repo named `forge-reggie` in workspace mode, settled after a fresh load: the title (126 px) keeps 105.8 px with no trigger (the repo switcher widens with the name; pre-existing), 61.8 px beside the icon and 29.4 px beside the label at 1440; at 1500 with the label it keeps 89.4 px. The manager's other option, a desktop minimum width for the title, was tried as an injected rule and rejected: at the title's 22 px font twelve characters is 151 px, which crushed every earlier crumb to one letter and padded a three-letter title. Captured instead. (My first reading in `review-majors-before.txt` shows 37 px more room than there is, taken before the switcher had settled; the settled numbers are in `review-majors-after.txt`.)
5. **CR5, minor — the result was lost on a route change or a trigger click mid-flight.** Fixed in `8daa93b` with CR1: while a submit is in flight neither closes the popover (Escape and the close button still do), and the result stays until the next submit clears it. Reproduced after: a trigger click 800 ms into a submit left it open; the reason and the command were still there after closing, moving to another page and reopening; the next submit replaced them.
6. **CR6, nit — the task list was built for every origin.** Fixed in `6d769fb`: only when the body names a task. No test: there is nothing observable to assert but the time.
7. **CR7, nit — the resolve-dedupe-refuse loop was written twice.** Fixed in `6d769fb`: `resolvePackPaths` beside the resolver, called by both launch routes and by the CLI, with its own unit case.
8. **CR8, nit — the symbol pack assertion could not fail.** Fixed in `6d769fb`: the symbol pack is built from a resolved symbol origin's `path` field.
9. **CR9, nit — the team-mode network case passed silently with no interface.** Fixed in `6d769fb` with `it.skipIf`. It ran, not skipped, on this machine.
10. **CR10, nit — the cap counted spellings, a blank launch path was dropped, a wrong-shaped field was dropped.** Fixed in `6d769fb`: the cap counts what the paths resolved to (nine spellings of two paths are two), a blank is refused in the resolver's words as on capture, and a `paths` that is not a list of strings or a `path` that is not a string answers 400. A new route case covers all four.
11. **CR11, nit — the harness shipped in the package and was served at `/ui/dev/`, yet imported the unshipped test fixtures, and the typecheck never saw it.** Fixed in `2791847`: moved to `test/serve-idea-fixture.ts`, where nothing is shipped or served. It is still outside the package tsconfig (whose root is `src`), so `npm run typecheck` does not cover it; it typechecks on its own, recorded in `typecheck.txt`.

The reviewer judged Deviations 1, 3, 4, 6, 7, 8 and 9 fine, Deviation 2 not justified (CR4, reversed) and Deviation 5 right in its reasoning but the cause of CR2.

**Security review** (no HIGH, no MEDIUM, 4 LOW, all introduced; full record in `security-review.md`):

1. **S1, low — the control-character class stopped at ASCII.** Fixed in `6d769fb`: one class shared by the resolver and `launchCommand` also refuses the C1 controls, U+2028, U+2029 and the zero-width and byte-order marks. Tested with a real file named with U+200B.
2. **S2, low — a refusal echoed the whole path.** Fixed in `6d769fb`: at most 200 characters, with an ellipsis.
3. **S3, low, plausible only — an unguarded `realpathSync` could answer with Node's message and an absolute path in a race.** Fixed in `6d769fb`: guarded, answering "listed by git but is not on disk". Tested in a file of its own that stubs `node:fs`, since a real disk cannot stage the race.
4. **S4, low — a trailing newline or tab was tidied rather than refused.** Fixed in `6d769fb` **by refusing on the raw value**; AC2's wording was not amended and holds as written.

Pre-existing observations, captured and not fixed: `Origin: null` accepted on a loopback socket without `Sec-Fetch-Site`; a raw `err.message` on a 500; captured text becoming raw markdown in the brief's Problem; a keyed remote reader able to start a build session. The missing cap on a captured line's length was already captured by the planner and was not duplicated. The review found the rest sound: traversal, `.git`, ignored files, globs, pathspec magic, symlinks, intake injection, the shell path, the POST guard, the key, the body cap, the three doors agreeing, no MCP launch tool, no `innerHTML` from a route string.

## Deviations from plan
1. **The resolver takes the repo's paths object and an optional set of known tasks**, not `(root, raw)`. `capture()` beside it takes the same object, and the server passes its task list rather than `knownSlugs`, because a task page can show a backlog item `knownSlugs` does not know.
2. **Reversed in review.** The first build showed the trigger's label from 1440 px because AC18 asks for it there, where the plan's Approach says 1500. The code review measured a real repo name (CR4) and the manager ruled for 1500. The branch now does what the Approach says and AC18's label clause is not met (said at AC18).
3. **A phone breadcrumb rule the plan does not have.** Below 760 px the header shows the parent crumb and the title only. The bail condition about the title at 390 px was already true without the button in workspace mode (the title measured 0 px on a deep file page, because the earlier crumbs never shrink), and on a shallow file page the button took its last 15 px. With the owner away the rule was applied rather than stopping; the full trail stays on the story's first card.
4. **`makeLauncher.run` takes `opts.where`** so the warning toast can say the command is "below", and `describe`'s cache key includes the paths.
5. **The description is fetched before the launch is posted**, not at six seconds: the launch holds the single-threaded server for the whole Terminal timeout, so a GET made at six seconds queues behind it. Since CR2 a description that arrives after the answer is dropped.
6. **The popover flips above its anchor** when there is no room below (a tile sits at the foot of the map column), **a route change closes it**, and a re-mounted tile's button is found again by the repo it names. Since CR1 and CR5 a route change does not close it while a submit is in flight.
7. **The README gained a row for `reggie launch`**, which its command table never had.
8. **`pack-*.md`, `intake-after.txt` and `api-capture.json` were written by a scratch script** over the same fixture rather than by the tests, which stay free of writes into the repo.
9. **A fix commit for raw control bytes** (`049ae86`): the editor wrote the `\u0000` escapes of two regexes and one test input as the bytes themselves, which made git call two source files binary. Textual escapes, behaviour unchanged.
10. **The harness is at `test/serve-idea-fixture.ts`, not `ui/dev/`** as the plan's file list says (CR11). It gained a star re-export in its fixture and `--repo-name`, both for reproducing review findings. It typechecks on its own, not under `npm run typecheck`.
11. **Two exports and one test file the plan does not name**: `resolvePackPaths` and `INVISIBLE_CHARS` in `capture.ts` (so `launch.ts` now imports `capture.ts`; there is no cycle), and `src/capture-race.test.ts`, which stubs `node:fs` for that file alone.
12. **A symbol page whose name is not an identifier posts the file alone** (CR3), where the plan says a symbol page posts the path and the symbol.
13. **The popover keeps its last result until the next submit**, and is neither re-targeted nor implicitly closed while a submit is in flight (CR1, CR5). The plan says nothing about either.
14. **The eight-path cap is counted after resolution** in the routes and the CLI, and a wrong-shaped `paths` or `path` is a 400 (CR10). `launchCommand` still refuses a ninth path itself, as AC8 says.
15. **The harness logs are committed as `harness-*.txt`.** The first build saved them as `.log`, which the repo's root `.gitignore` ignores, so they were on disk and cited in that build's report but never on the branch. Found while checking that every path this packet cites is tracked; renamed, nothing in them changed.

Bail conditions: none fired. The 390 px one is Deviation 3. Stubbing `osascript` at the `child_process` level worked without touching `launch.ts` or `git.ts`. The capture-then-launch race did not appear. The tile restructure kept the whole-surface click and the refs.

## Discovered issues
Captured during the build and the review, each its own intake item:
- `the-breadcrumb-loses-the-page-title-entirely-on` — at 1440 px in workspace mode a file page four levels deep shows no title at all, with or without the idea button.
- `at-390-px-the-phone-s-bottom-tab-bar-nav-positio` — the phone tab bar and a chip overflow a 390 px viewport by 14 px on the area page (what AC19 meets).
- `a-workspace-whose-listing-names-no-usable-repo-4` — a workspace with no usable repo answers every route 404, so the page is only an error card.
- `with-a-long-repo-name-the-header-s-repo-switcher` — the repo switcher widens with the repo's name and cuts the title at 1440 before any tool is added; a desktop breadcrumb that gives way gracefully needs designing.
- `the-post-guard-accepts-a-request-whose-origin-he` — `Origin: null` is accepted on a loopback socket when no `Sec-Fetch-Site` header is present (security review, pre-existing).
- `the-server-answers-an-unexpected-error-with-the` — a 500 carries the raw message of whatever was thrown (security review, pre-existing).
- `the-words-of-a-captured-line-and-its-detail-line` — captured text becomes raw markdown in the brief's Problem at triage (security review, pre-existing).
- `anyone-who-holds-the-serve-key-can-start-a-build` — a keyed remote reader can start a build session on the owner's machine (security review, pre-existing, the documented design).

Captured by the planner before the build and relied on here, not duplicated: `post-api-capture-and-reggie-capture-put-a-line-o` (no cap on a captured line), `both-launchers-write-a-launch-record-even-when-t`, `recentcommits-hands-paths-to-git-log-after-a-dou`, `the-context-pack-lists-the-last-ten-commits-of-t`, `triage-could-seed-the-brief-s-area-front-matter`, `on-a-phone-the-workspace-page-s-repo-tiles-with`.

## Open risks
- **The real Terminal path has never run.** `launched: true` was only ever seen through the `ok` stub. If macOS refuses automation or the AppleScript line misbehaves with a path in the prompt, the owner's first click is where it shows; the popover then keeps the capture and shows the command, which is the path that was exercised most.
- **Most browser evidence predates the review fixes.** The five desktop and five phone runs, the keyed run, the in-order hang run, the bare repo and the Codex case were recorded on the first build. After the fixes the browser was used for the four reproductions (deny mode, 1440) and one `ok` smoke on the repo page (1440); the phone, keyed, hang, bare and Codex runs were not repeated. The fixes touch `submit`, `openIdea`, `originFor` and one CSS breakpoint; a regression would show as a popover that will not open or close on those pages.
- **At 1440 px the icon still costs a long repo name its title**: `forge-reggie` keeps 62 of 126 px on the repo page in workspace mode (106 px with no trigger at all). The plan accepted the 36 px; with a real name it reads as "forge-r…". From 1500 px the label adds to that (89 px left).
- **The kept result can sit under a new page's sentence**: after a failed launch, opening the popover on another page shows that page's sentence above the previous capture's link and command until the next submit. It names its own slug, but a reader may take it for this page's.
- **The phone header shows two crumbs.** Deeper ancestors are reachable only from the story's first card on a phone.
- **`src/capture-race.test.ts` stubs `node:fs` with `vi.mock`**; a vitest upgrade that changes how builtins are mocked would break that one test, not the product.
- **Until `context-pack-omits-intake-line` lands**, the session this action opens does not see the captured line or the origin line in its pack; it reads them from `.reggie/intake.md`, as every shaping session does today. The path in scope and its notes are there.
- **The map-to-tile hover highlight was not re-tested by eye** after the tile became a wrapper; the handlers and the refs moved with it.
- **The generated facts count the harness as a test file** (42 test files), because it lives under `test/`.
