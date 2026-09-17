# Security review of task/branch-diff-in-reader

## What this is, and what it is not

This is a security pass over the branch's diff (`git diff repo-manager...task/branch-diff-in-reader`), made by the build session on 2026-09-17, by hand, against the same questions the borrowed `/security-review` procedure asks: where does input enter, what does it reach, what runs, what is written, what leaves.

It is **not** a run of the `/security-review` skill. The build session is a subagent whose working directory is the integration checkout, and the borrowed review skills resolve their diff against that directory, not against the task worktree, so a run from here would have reviewed the wrong tree. AC44 asks for a recorded `/security-review` pass; that still needs to be run from the task worktree by a session that can, and its findings set beside these. Everything below is therefore a first pass, not the independent one.

## Surface added

Two GET routes, `/api/changes?slug=` and `/api/filediff?slug=&path=&offset=`, nine git helpers, one parser, and web code that draws what they return. No POST route, no file written, no process other than `git` spawned, no network call. Both routes sit under `/api/`, so the existing host-header check (the DNS-rebinding guard) and the serve key on a non-loopback bind apply to them unchanged; a test confirms both refuse POST with 405.

## Findings

### 1. A very large text file could make the server build millions of row objects. Medium. **Fixed on the branch.**
`fileDiff` parses a whole patch into rows before it cuts a 2,000-row page from them. The patch is bounded at 64 MB by the process buffer, but 64 MB of one-character lines is tens of millions of rows, each an object: a repo holding such a file could take the server down by memory whenever that file's change was opened. The count git itself reports for the file is known from the list before the patch is asked for, so it is now checked first: past 250,000 changed lines (`DIFF_MAX_CHANGED_LINES`) the patch is not read at all and the answer is an `unreadable` card that says why. Tested in `src/changes.test.ts` ("does not read the patch of a file whose changed lines pass the cap"), documented in the API contract. The 60,000-line case the plan requires still pages normally.

### 2. Option injection through a revision. Considered; closed by design, tested.
Measured while planning: `--output=/tmp/x` in a revision position made git try to write that file. No revision comes from a request. The slug must pass `isSafeSlug` (it cannot begin with a dash or hold a slash, a dot or a colon) and must name a known task; the only names ever resolved are `task/<slug>` and `origin/task/<slug>` (anything else in `branchRef` is treated as no branch, tested), the integration branch name, and `HEAD`; each is resolved once by `rev-parse --verify --quiet --end-of-options <name>^{commit}`; and every helper that takes a revision throws before spawning git unless it is 40 lowercase hex characters. Tests hand each helper `--output=<fresh temp path>`, a short sha, a branch name, an upper-case sha, a padded sha and an empty string, assert the throw, and assert the temp path does not exist afterwards.

### 3. Option and pathspec injection through a path. Considered; closed by design, tested.
`path` does come from the request. It is checked twice: `safeRepoPath` refuses an empty path, a NUL, a backslash, an absolute path and any `..` segment with 400, and only then is it looked up, by exact match, in the task's own change list; what reaches git is the list entry's own string, after `--`, under `--literal-pathspecs`. `--output=<fresh temp path>`, `:(exclude)src`, `:(top)src/keep.ts`, `src/*.bin`, a directory, a trailing slash and a case variant all answer 404 without git being run, and the temp path does not exist afterwards (tested over HTTP). A file really named `:(top)magic.ts` or `-leading-dash.ts` opens and answers its own rows and nobody else's. The order of the two checks matters and is deliberate: a tree object crafted to hold a `..` path could be listed by `/api/changes`, but it can never be opened, because the syntactic refusal comes before membership, so `editorUrl` is never computed for it either.

### 4. Running a program the repo's git config names. Considered; closed, tested.
Measured: a configured `diff.external` runs in place of the patch, and a textconv filter runs a program too. Every diff read passes `--no-ext-diff --no-textconv`. The hostile-config test writes an external diff program that drops a marker file into a fixture's `.git/config`, proves an ordinary `git diff` there runs it (the marker appears), removes the marker, runs both routes' functions over every task, and asserts the marker is still absent and the results are deep-equal to the unconfigured ones.

### 5. Markup in a changed line, a path, a slug or a reason. Considered; no injection found.
Row text, card text, paths, reasons and slugs all reach the page as text nodes or through `setAttribute`; nothing on the new paths uses `innerHTML`. The `?diff=` value is matched against the slug pattern before it is used anywhere, and every door's `href` is built by `formatRoute`, so it always begins with `#/` and cannot become a `javascript:` URL. Class names built from a payload (`reader__line--<kind>`, `reader__status--<status>`, `reader__card--<kind>`) take values from closed unions the server sets, not from file content. Checked in a real browser with the fixture line `<img src=x onerror=alert(1)>`: the row's `textContent` is that text, its `innerHTML` is entity-escaped, it has no child element, no `img` exists in the reader, no dialog was raised and the console stayed empty (`html-is-text.json`, `html-is-text.png`, `console.txt`).

### 6. What an error body can leak. Considered; closed, tested.
The three new readers return `null` on failure and never surface git's stderr; every refusal is a sentence written in `changes.ts` or `serve.ts`. A test collects the body of every 400, every 404 and every `available: false` answer the suite makes and asserts none contains `fatal:`, `error: `, `usage: git`, the fixture's root (in both its symlinked and its real form) or the OS temp directory. A 200 from `/api/filediff` does carry an absolute path, in `editorUrl`, exactly as `/api/file` does today; that is the feature, and it is `null` whenever there is no honest file to open.

### 7. What the file route can now be made to serve. By design; stated so nobody is surprised.
`/api/filediff` serves the content of any file a task's range changed, including a file that has since been deleted from the working tree, and including anything under `.reggie/`. That is the point of the task, and it is the same boundary `/api/file` and `/api/evidence` already sit behind (loopback, or the serve key). It does widen what that boundary holds: a secret committed on a task branch and removed in a later commit of the same branch nets to nothing and is not shown, but one that landed and was removed by a later task is readable through the first task's merge, as it is through `git show`.

### 8. The default branch name reaches older git helpers as a bare argument. Low, pre-existing. **Captured, not fixed.**
`taskLanding`, `aheadCount`, `changedFiles`, `diffStat` and `branchChangedFiles` place the configured default branch before any `--end-of-options`. The value comes from the repo's own `config.yaml`, not from a request, so it takes a hostile repo and someone serving it. The new routes are not exposed to it: `taskRange` resolves the name to a commit id first and answers unavailable when it does not resolve, so an unresolvable name never reaches `taskLanding` from there, and git refuses to create a branch whose name begins with a dash. Captured as `a-default-branch-beginning-with-a-dash-is-a-git-option`.

### 9. Invisible and direction-changing characters are drawn as committed. Informational. **Captured, not fixed.**
The reader is now a review surface, and a reviewer can be shown text that reads differently from what a compiler reads (Trojan Source). Nothing executes; the risk is a misled reviewer, and the plain reader has the same property today. The rows are built on the server, so a per-row flag could be computed and tested there. Captured as `diff-rows-do-not-flag-invisible-or-direction-changing-charac`.

### 10. Time and memory a request can cost. Considered.
Every new git call runs through the existing argument-array runner with a 10-second timeout and no shell. `offset` goes through `qInt` (0 to 99,999,999; anything else is 400). The per-slug list cache is keyed by a validated slug of a known task, so it is bounded by the number of tasks. A row's text is cut at 2,000 characters, so a 5 MB single-line file answers in under 100 KB (tested). Finding 1 closes the one unbounded allocation that was left.

## Disposition

| # | Finding | Severity | Disposition |
|---|---|---|---|
| 1 | Unbounded row building for a huge text file | medium | fixed on the branch, tested |
| 2 | Option injection through a revision | high if present | not present; tested |
| 3 | Option and pathspec injection through a path | high if present | not present; tested |
| 4 | External diff or textconv program run by a GET | high if present | not present; tested |
| 5 | Markup injection in the page | high if present | not found; checked in a browser |
| 6 | Leaks in error bodies | medium if present | not present; tested |
| 7 | Content of deleted files is readable through a landing | by design | stated here |
| 8 | Default branch name as a bare git argument in older helpers | low, pre-existing | captured |
| 9 | Invisible and bidi characters not flagged | informational | captured |
| 10 | Request cost | low | bounded; see 1 |
