# Security review — derive-the-journal (AC49)

An independent security-and-privacy review session read the task worktree at HEAD `4fc5369` and reported its
findings; a separate independent code-review session read the same commit. Their full findings, with reproducing
probe scripts, are in `scratchpad/review-findings-derive-journal.md`, `scratchpad/secreview-derive-journal/`
and `scratchpad/review-derive-journal/`. This file records each finding and its resolution. It satisfies AC49.

**The borrowed `/security-review` skill was not run.** From a subagent it resolves against the parent session's
directory rather than this task worktree, so it would have reviewed the wrong tree. Instead an independent review
session (not this build session) did the review and produced the findings this file resolves; each CONFIRMED finding
was reproduced here with the reviewer's own probe before it was fixed, and a table-driven regression net was added.

Scope was set by the repo owner's delegate (the manager). Every finding below was introduced by this task, so all
are this task's to fix except the three marked PRE-EXISTING, which are captured for their own slices.

## Security and privacy findings

- **S1 HIGH — a bolded/quoted secret label withheld, the value left.** `**Password:** hunter2` etc. and JSON/dict
  forms passed. FIXED (`redact.ts`): the name/value pattern now accepts emphasis, quote and code marks around the
  name and separator and withholds the value to the end of the line. Regression net in `redact.test.ts`
  ("the bypass regression net" > caught: the S1 rows). Evidence: `evidence/redaction.txt`.
- **S2 HIGH — fences nested in a list or block quote, and indented/`<pre>` code, were kept.** FIXED (`redact.ts`
  `dropBlocks`): fences are recognised under leading whitespace, block-quote markers and a list marker; indented
  code blocks and `<pre>` are dropped. Regression net: the S2 rows. Evidence: `evidence/redaction.txt`.
- **S3 HIGH — well-known secret shapes passed.** FIXED (`redact.ts`): added `sk_live_`/`rk_live_`/`whsec_`,
  `glpat-`, `hf_`, `GOCSPX-`, `dop_v1_`, `shpat_`, `npm_`, Twilio `SK<hex>`, Telegram, SendGrid, AGE key, Slack and
  Discord webhook URLs; made Bearer case-insensitive and added Basic (a value of 16+ chars, so "Bearer
  authentication" is left); extended the name set with `pwd|passphrase|private_key|access_key|auth|client_secret`;
  withhold a name=value to the end of line so a comma or spaces in the value are taken whole. Regression net: the S3
  rows. Evidence: `evidence/redaction.txt`.
- **S4 MEDIUM (call cannot be run here) — rewrite ran in `os.tmpdir()` and loaded user settings/CLAUDE.md.** FIXED
  (`derive.ts`): the rewrite now runs in a fresh `mkdtempSync` directory removed afterwards, and the argv adds
  `--setting-sources ""` (documented in `claude --help` 2.1.261 as the list of sources to load — empty loads none of
  user, project or local) and `--system-prompt <fixed>` (replaces the default system prompt so no user CLAUDE.md or
  memory is read), alongside the existing `--tools ""`, `--strict-mcp-config` and `--no-session-persistence`. The
  call is still never run and stays tested through the fake runner; the exact flags are recorded in
  `evidence/unverified-call.txt` and the packet. Verified by test (`derive.test.ts` "rewrite seam").
- **S5 LOW — a hostile claim naming a victim's real session id created an oracle.** FIXED (`derive.ts`): a session
  with no record inside the repository is now skipped for every source (not only `--session`), and a session's span
  is computed from its in-repo records only. Reproduced before and after with `scratchpad/secreview-derive-journal/
  oracle.mts`: no `mallory-<victim id>.md` is written; the entry is commits-only, `session=none`, with the honest
  "none of its work is inside this repository" sentence.
- **S6 LOW — catastrophic backtracking; no length cap.** FIXED (`redact.ts`): every quantifier is bounded and the
  raw input is capped to 32 KB at a whitespace boundary. Before: `token.`×8 KB took 11.2 s, `secret-`×8 KB 8.1 s.
  After: those are ~10 ms, and every 1 MB line-ceiling input completes in ~10–21 ms — well under a second, the bail
  condition. Timings in `evidence/redos.txt`.
- **S7 LOW — some invisible characters survived (soft hyphen, CGJ, variation selectors, tag chars).** FIXED
  (`redact.ts`): `stripInvisible` runs first and removes `\p{Cc}\p{Cf}`, U+034F, the variation selectors and the
  line/paragraph separators, so a key split by any of them rejoins and is caught. Regression net: the S7 rows.
- **S8 LOW — path forms revealing a username passed.** FIXED (`redact.ts`): added roots
  (`data|media|run/media|workspace|nix`), `C:/` and `C:\`, `~user/`, `$HOME/`, `%USERPROFILE%\`, UNC, the encoded
  project-folder name, and a URL path containing a home-root; the look-behind now allows a `-`, `:` or `=` before
  `/Users`. Remaining as documented limits: a path glued to a flag (`-I/Users`), a relative path with a username, a
  bare project-folder name after a caught username. Regression net: the S8 rows; limits table.
- **S9 LOW — a URL password with `/`, `?`, `#` or `)` defeated the userinfo strip.** FIXED (`redact.ts`
  `stripUrls`): everything up to and including the last `@` whose remainder looks like a host is dropped, and a
  home-root in the URL path is cut. Remaining limit: a `)` in the password (a paren ends URLs in prose). Regression
  net: the S9 rows.
- **S10a — empty/relative cwd counted as inside the repo.** FIXED (`transcript.ts` `isInsideDir`): a candidate must
  be absolute. Test in `transcript.test.ts`.
- **S10b — an unreadable transcript aborted the whole verb (= C5).** FIXED (`derive.ts`): `readTranscript` is
  wrapped; an error reports that session as not read and the verb carries on. Test: `derive.test.ts` "reports an
  unreadable transcript as one session not read".
- **S10c — `--dry-run` wrote the gitignored history cache on a landed task.** FIXED (`derive.ts`): a dry run builds
  the landing lookup's history index with `diskCache: false`, so a dry run writes nothing at all. **Chosen option:**
  avoid the write (not soften the promise), because "writes nothing" then stays literally true for a dry run.
  Verified by a synthetic check: `history-*.json` count unchanged across a dry run on a landed task.
- **S10d — a curly close-quote in the text could break out of the entry's quotation wrapper.** FIXED (`redact.ts`
  `flattenText`): curly double quotes become straight ones. Regression net: the "curly quote break-out" input.

## Code-review findings

- **C1 MAJOR — committing the derived entry made the next run narrate it, forever.** FIXED (`derive.ts`
  `isBookkeeping`): a commit whose every file is under `.reggie/journal/` is bookkeeping and never narrated. The
  AC25 test now asserts `fromBase.entries` is empty, and a new test runs three commit-and-derive cycles and asserts
  each derives nothing.
- **C2 MAJOR — another task's worktree records were quoted into this task's journal.** FIXED (`transcript.ts`
  `selectRecords`): a record inside another task's `.worktree/<other>` is excluded. Test: `derive.test.ts`
  "narrates another task's own commits but never quotes a session that only worked in another task's worktree" and
  the updated `transcript.test.ts` selectRecords case.
- **C3 MAJOR — a landed task whose branch still exists reported nothing to derive.** FIXED (`derive.ts`
  `taskCommits`): an empty `base..branch` falls through to the landing lookup. Test: "narrates a landed task's
  commits even when the local branch still exists".
- **C4 MINOR — the printed merge-refusal promise was false for a new untracked day file.** FIXED (`cli.ts`): the
  wording now says a tracked journal file blocks the landing, a brand-new day file does not, so commit it before
  landing. Confirmed by `scratchpad/review-derive-journal/probe13.mts` (an untracked new day file did not block
  `landTask`).
- **C5 MINOR = S10b.** FIXED (above).
- **C6 MINOR — a rebased branch is re-narrated in full.** NOT FIXED by design (manager ruling): documented as a
  stated limit in `README.md` and the vision, and captured as `derive-re-narrates-a-rebased-branch` naming patch-id
  or author-date-plus-subject as the fix.
- **C7 — the AC25 test was mistitled and could not fail; no test covered C2, C3, C6.** FIXED: the AC25 test now
  asserts emptiness, and C2, C3 and C6 (as a limit and a capture) all have tests/records.
- **C8 NIT — a plan-then-build session kept the first goal.** FIXED (`derive.ts` `collectSessions`): the latest
  launch goal wins. Confirmed by `scratchpad/review-derive-journal/probe10.mts V` (now `execute`).
- **C9 NIT — a far-future timestamp poisoned the watermark.** FIXED (`transcript.ts` `parseRecord`): a timestamp
  more than ~a day ahead of the clock is dropped to null. Tests in `transcript.test.ts` and `derive.test.ts`.
- **C10 NIT — a session whose records are all outside the repo said "no closing message".** FIXED (`derive.ts`):
  such a session is skipped and the commits-only entry carries `SENTENCE_SESSION_ELSEWHERE`. Test: "says nothing was
  inside this repository, not that there were no closing words, when the checkout has moved".
- **C11 NIT — an evidence item newline could plant a `derived:` mark line.** FIXED (`journal.ts`
  `formatJournalEntry`): each evidence item's newlines collapse to a space. Test in `journal.test.ts`.
- **C12 NIT — `isSidechain` truthiness and relative cwd (= S10a).** FIXED (`transcript.ts`): any truthy
  `isSidechain` counts as a sidechain; relative/empty cwd is outside. Tests in `transcript.test.ts`.

Deviations 1–7 from the first build packet were judged sound by the code reviewer.

## PRE-EXISTING (captured, not fixed)

Surfaced by the security review; not introduced by this task and out of scope to fix here:
- `claim-commits-hostname-and-email` — `claim.ts` commits the machine hostname and the owner's email to `claim.md`.
- `session-name-unvalidated-in-journal-path` — `journal.ts` builds a day-file name from `REGGIE_SESSION` unchecked.
- `journal-text-flows-into-context-as-instructions` — journal text flows into `reggie context` packs future sessions read.

## Stated limits (written into the user-facing docs)

The README's derived-journal section and the vision now state plainly, for an owner deciding whether to trust this
on a public repo: what the redactor cannot catch (prose secrets, bare-flag values, hex/UUID keys, phones, IPs,
internal hostnames, obfuscated emails, client/people names, relative paths with a username); that the withheld count
says nothing about what was missed; and exactly what a derived entry publishes to git — the full session id (in the
file name, the file heading, and the `derived: session=` mark), the `through=` instant to the millisecond, the
entry's local clock time and date, and cross-task quoting within one repo. The limits are also asserted as a table
in `redact.test.ts` so that a change which starts catching one is noticed.
