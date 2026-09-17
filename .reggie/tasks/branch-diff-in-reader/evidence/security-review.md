# Security review of task/branch-diff-in-reader

## Who reviewed what

Two passes were made, and they did not agree. Where they differ, the second is right.

1. **The build session's own pass**, by hand, on 2026-09-17, over `git diff repo-manager...task/branch-diff-in-reader`. It is kept below, corrected. It missed the most serious thing in this file.
2. **An independent security session**, started by the manager, which reviewed the task worktree at commit `101166b` (19 product files), built hostile fixtures of its own, and confirmed its findings by running them, several end to end over HTTP. Its probes are in the manager's scratch directory (`secreview-branch-diff`). Its findings are the list under "Independent review" below, each with how it was resolved. This independent review is what AC44 rests on.

The borrowed `/security-review` skill itself was **not** run, by either session. From a subagent it resolves its diff against the integration checkout rather than the task worktree, so it would have reviewed the wrong tree. An independent session reading the right tree stood in for it.

## Correction to the first version of this file

The first version of this file recorded the dash-leading default branch name as finding 8, ranked it **low**, called it pre-existing, and said: "The new routes are not exposed to it: `taskRange` resolves the name to a commit id first and answers unavailable when it does not resolve, so an unresolvable name never reaches `taskLanding` from there."

**Both statements were wrong.**

- The new routes **were** exposed. `taskRange` resolved the name to a commit id and then handed `taskLanding` the **name**, not the id. The reasoning about an unresolvable name overlooked that the attacker controls the refs too: a repo can carry a ref named exactly `--output=/abs/path`, so the name resolves, and `git log … --output=/abs/path --` then writes that file. The independent session confirmed it over HTTP: `GET /api/changes?slug=landed-task` against this branch's own fixture, made hostile, created a 269-byte file at an attacker-named path.
- It is not low. The config is a tracked file a clone carries, the path is fully attacker-chosen, and the trigger is an ordinary GET. A request-triggered arbitrary file write is **high**.

## Independent review: findings and resolutions

Found sound by the independent session, with nothing to change: option, pathspec and traversal injection through `slug`, `path` and `offset` (all refused, nothing written); execution of committed content through `.gitattributes` drivers (neutralised by `--no-ext-diff --no-textconv`); markup injection through diff text, file names, cards and gap rows (text nodes only, no `innerHTML`); leaks in error bodies (none); the regexes (linear).

### P1. A dash-leading integration branch name reaches `git log` as an option. HIGH. Pre-existing sink, reachable through the new route. **Closed for the new routes; the rest captured as high.**
`taskLanding` and the shared `historyLogArgs` in `history.ts` put the base branch name before the revisions with no `--end-of-options`.

What changed on this branch:
- `taskRange` now hands `taskLanding` the **resolved commit id**. `taskLanding` uses its base only as a revision, so this is the whole fix at the library level and nothing in `history.ts` was touched. Names are also resolved by full ref (`refs/heads/<base>`), see L3.
- Both routes stop before the task list is built when the configured name begins with a dash, and answer `available: false` (404 on the file route) with a sentence that does not echo the name. This second guard exists because the routes read the cached task list, and building that list hands the same name to older helpers (`base..branch` strings in `aheadCount`, `branchChangedFiles`). Those are a weaker form of the same bug, since the written path always ends in `..task/<slug>`, but "the new routes never hand such a name to git" would not have been true without it. No branch can have such a name, so nothing legitimate is refused.
- Proof, failing before and passing after: `src/changes.test.ts` "never hands git an integration branch name that reads as an option" (a real ref of that name, so the name resolves; the landed task's change is still read, from commit ids alone, and no file appears), and `test/serve.test.ts` "a hostile integration branch name … is never handed to git by either route, and nothing is written" (the hostile `defaultBranch` shape in a tracked config, eight requests, the target path and its neighbours checked). `evidence/review-tests-before-fix.txt` and `evidence/review-route-tests-before-fix.txt` show both failing on the code the reviewers read, the second with the message "git wrote the file the integration branch's name asked for".

What did **not** change, by the manager's ruling on scope: `GET /api/task/<slug>` (through `completionLanding`), `POST /api/decide` (through `landTask`) and the CLI still hand the raw name to `taskLanding`. Captured as `a-hostile-default-branch-name-makes-a-get-write-a-file`, which says it is a request-triggered file write, ranks it high, names the single choke point that closes the class, and supersedes the earlier low-ranked capture `a-default-branch-beginning-with-a-dash-is-a-git-option`.

### M1. Rows were built without a bound, and built again for every page. MEDIUM, introduced. **Fixed.**
The first pass had capped changed lines at 250,000 and believed that closed it (its finding 1). It did not: context and gap rows were uncounted, so 1,000,000 lines with every eighth changed, exactly 250,000 changed lines, built 1,125,000 rows: 483 ms, 466 MB of heap and 961 MB peak RSS for one call, and the same again for page two, because only the file list was cached. GETs are not subject to the `Sec-Fetch-Site` check that guards POSTs, so any page the owner has open could fire them.

Now: a cap of 100,000 **rows built**, context and gaps included, applied three times (on git's count before the patch is asked for; on hunk lines as they are parsed, by a parser that walks the text with a cursor instead of splitting it, so it stops rather than finishing; on the built rows); the patch bytes read are bounded at 16 MB instead of the runner's 64 MB; a cut row's text is copied out of its line, so a 2,000-character row no longer keeps a 5 MB line alive; and built rows are memoized per slug, base, ref and path in a cache bounded by entries (8), rows (200,000) and text (32 MB), so paging slices. The comment that said a quarter of a million changed lines "is 125 pages" overstated the bound and is gone. Measured with the reviewer's own probe: the 1,000,000-line case is refused in 7 ms at 9 MB of heap and 95 MB peak RSS; a change that slips under the count but not under the rows costs about 125 ms and 53 MB; a later page of the 60,000-line file costs nothing measurable. `evidence/m1-before-after.txt`.

Found while fixing it, and fixed: `run()` reported a command whose output outgrew its buffer as **successful** whenever the child had already exited (node gives `ENOBUFS` beside a status of 0; five runs in six for a small patch), so an over-limit read could pass as a clean one. Any spawn error is now a failure; tested eight times over.

Not changed: GET routes remain outside the `Sec-Fetch-Site` check. That is how every GET on this server works and is a server-wide question.

### L2. A checked-out `.gitattributes` can hide a diff. LOW, introduced. **Captured, not fixed.**
A `*.ts -diff` line in whatever tree is checked out makes a text change in another commit arrive as binary with no rows. Nothing executes; a change is hidden from its reviewer. This machine's git (2.55) accepts `--attr-source`, verified. It was not shipped, within the manager's ruling, because a correct fix needs two things decided first: a version guard made once (the option arrived in git 2.41, and unguarded an older git turns every diff into a failed read), and which tree to read attributes from, which is a product decision: the empty tree draws files the repo honestly marks as not diffable, while the branch's own tree lets a hostile branch hide itself. Captured as `a-checked-out-gitattributes-can-hide-a-diff-from-the-reader` with both options and the reviewer's measurement.

### L3. A tag named `task/<slug>` shadowed the branch. LOW, introduced. **Fixed.**
The branch was resolved by its short name, and git prefers a tag. Both the task branch and the base are now resolved by full ref (`refs/heads/…`, `refs/remotes/origin/…`). Tested with a tag over a task branch and a tag named `main`, failing before the fix.

### P2. `editorScheme` from the config becomes a link with no allowlist. Pre-existing. **Captured, not fixed.**
With `editorScheme: "javascript:…//"` the "Open in editor" link runs script on click; the new `diffEditorUrl` inherits it unchanged from `editorUrlFor`. Captured as `the-editor-scheme-from-config-becomes-a-link-with-no-allowli`.

### P3. Git obeys the served repo's local config. Pre-existing, server-wide. **Captured, not fixed.**
`core.fsmonitor`, `core.pager`, `gpg.program`, promisor `ext::` remotes. It needs control of the local `.git/config`, which a fresh clone does not inherit. Captured as `git-runs-whatever-the-local-git-config-names`.

## The build session's pass, as corrected

| # | Finding | First verdict | Now |
|---|---|---|---|
| 1 | Unbounded row building for a huge text file | "fixed" with a cap on changed lines | **Wrong as a fix**: see M1. Now capped on rows built, bounded in bytes, memoized. |
| 2 | Option injection through a revision from the request | not present; tested | Stands, and the independent session found it sound. What it missed is that the **base name from the config** is also a revision: see P1. |
| 3 | Option and pathspec injection through a path | not present; tested | Stands; found sound independently. The order of the two path checks (syntax, then membership) is deliberate. |
| 4 | External diff or textconv program run by a GET | not present; tested | Stands; found sound independently. P3 is the wider version of it, outside the diff path. |
| 5 | Markup injection in the page | not found; checked in a browser | Stands; found sound independently. P2 is a different sink, the link's `href`, that this pass did not look at. |
| 6 | Leaks in error bodies | not present; tested | Stands. The P1 guard's sentence deliberately does not echo the configured name, which may be an absolute path; tested. |
| 7 | Content of deleted files is readable through a landing | by design | Stands, stated so nobody is surprised. |
| 8 | Default branch name as a bare git argument | **low, "new routes not exposed"** | **Wrong on both counts**: see the correction and P1 above. |
| 9 | Invisible and bidi characters not flagged | informational, captured | Stands: `diff-rows-do-not-flag-invisible-or-direction-changing-charac`. |
| 10 | Request cost | "bounded; see 1" | **Wrong**: it was not bounded. See M1. |

## What this leaves open

- The high-severity file write is still reachable through the task route, the decide route and the CLI (captured, ranked high). It should not wait long.
- P2 and P3 (captured). L2 (captured, with the decision it needs).
- The borrowed `/security-review` skill has not been run over this branch by anyone.
