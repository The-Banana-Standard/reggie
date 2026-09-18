# Security review of idea-from-every-page

## What was run, and what was not

An independent security review session read the task worktree at commit `e823d04` (23 product files) on 2026-09-18, with its own probes against the branch's code: a resolver and intake-writer probe, a server probe over HTTP, and a probe of the three doors (HTTP, CLI, MCP). It wrote only into throwaway repos it created itself. Its findings and the manager's rulings reached the build session as a findings file; the fixes below are on the branch after `e823d04`.

The borrowed `/security-review` skill itself was **not** run. The build session runs as a subagent, and from a subagent that skill resolves against the parent session's directory (the integration checkout), not the task worktree, so it would have reviewed the wrong tree. The independent session did the review in its place.

No HIGH or MEDIUM finding. Four LOW, all introduced by this task; four pre-existing observations, captured.

## Findings and their resolution

| # | Severity | Finding | Resolution |
|---|---|---|---|
| S1 | LOW | The control-character class in the resolver and in `launchCommand` stopped at ASCII: C1 controls (U+0080–U+009F, NEL), U+2028, U+2029 and zero-width characters passed. Such a character has to be in a file name `git ls-files` lists (a request cannot invent one); it would then sit verbatim inside the backticks of the detail line and inside the single-quoted prompt. Nothing broke. | **Fixed** in `6d769fb`. One class, `INVISIBLE_CHARS` in `src/capture.ts`, covers C0, DEL, C1, U+200B–U+200F, U+2028, U+2029, U+2060 and U+FEFF; `src/launch.ts` imports it rather than keeping a copy. Tested with plain strings and with a real file named with U+200B that git lists (`src/capture.test.ts`); the cases fail on the old resolver (`review-tests-before-fix.txt`). |
| S2 | LOW | The refusal sentence echoed the request's path unbounded: a 60 KB path came back whole in the 400 body, on the CLI's stderr and in the MCP error text. | **Fixed** in `6d769fb`. A refusal repeats at most 200 characters of the path, with an ellipsis. Tested with a 5,000-character path (message under 300 characters); fails on the old resolver. |
| S3 | LOW (plausible only) | `realpathSync` and `statSync` were unguarded after `existsSync`: an entry removed in between would answer with Node's `ENOENT … '/Users/…'` message as a 400 body. A race on the owner's own disk. | **Fixed** in `6d769fb`. Both calls are inside a try/catch that throws the existing "listed by git but is not on disk" sentence. Tested in `src/capture-race.test.ts`, which stubs `node:fs` for that file alone to stage the vanishing entry; fails on the old resolver with Node's message and the absolute path. |
| S4 | LOW | The trim ran before the control-character check, so a path with a trailing newline or tab was accepted (tidied) rather than refused, while AC2 says a newline or tab is refused. | **Fixed by refusing on the raw value** in `6d769fb` (the other option, rewording AC2, was not taken): the check runs on the value as given, before trimming. Tested with `"src/serve.ts\n"` and `"\tsrc/serve.ts"`; fails on the old resolver. AC2 stands as written. |

Pre-existing, captured and not fixed (each as its own intake item):

- The POST guard accepts `Origin: null` on a loopback socket when no `Sec-Fetch-Site` header is present — `the-post-guard-accepts-a-request-whose-origin-he`.
- The server's outer handler returns the raw `err.message` on a 500 — `the-server-answers-an-unexpected-error-with-the`.
- Captured text and detail become raw markdown in the brief's Problem at triage, so a `## Heading` detail line forges a section (the owner's own input, same origin only) — `the-words-of-a-captured-line-and-its-detail-line`.
- A keyed remote reader can start a build session on the owner's machine through `POST /api/launch` (the documented design of the key) — `anyone-who-holds-the-serve-key-can-start-a-build`.
- No cap on the length of a captured line — already captured by the planner as `post-api-capture-and-reggie-capture-put-a-line-o`; not duplicated.

## The three statements AC28 asks for

1. **Where the body's `path` is validated.** In one place: `resolveCaptureOrigin` in `packages/reggie/src/capture.ts`. `POST /api/capture` hands it the body's `path`, `symbol` and `task` exactly as sent (`originFields` in `src/serve.ts` keeps every string, even empty) before the intake file is touched; `GET` and `POST /api/launch` hand it every `path` through `resolvePackPaths` before any pack is written, session minted or launch recorded; `reggie capture --path`, `reggie launch --path` and the MCP tool's `path` call the same function. A refusal is a 400, an exit 1 or a tool error with the same sentence.
2. **The detail line is built only from the resolver's output.** `capture()` writes `originLine(input.origin)`, and `input.origin` is the object `resolveCaptureOrigin` returned: the kind, the tidied path that is an exact entry (or a folder prefix) of `git ls-files`, a symbol matching `^[A-Za-z_$][A-Za-z0-9_$]{0,199}$`, or a slug that passed `isSafeSlug` and is a known task. No string from the request is written into the line without having passed through it, and a path holding a backtick, a square bracket, a pipe, a control or an invisible character is refused rather than escaped.
3. **The path reaches a command line only inside the single-quoted prompt.** `launchCommand` puts the paths into one sentence of the prompt, the prompt is one element of `argv`, and `command` is `argv.map(shellQuote).join(" ")`: single quotes with `'` written as `'\''`. osascript is spawned with an argument vector, never a shell string. The captured text is never part of a launch request at all.

## What the review found sound

Traversal in every spelling, `.git`, `.reggie/.cache`, ignored files, globs, pathspec magic, an index-but-deleted file and tracked symlinks to `/etc` are all refused with sentences holding no absolute path and the intake byte-identical. Nothing from the request reaches git (fixed argv with `-z`; paths after `--`). Intake injection — LF, CRLF, U+2028/2029, NEL, zero-width, tab, a leading `- `, `> ` or `## `, `[[…|…]]`, HTML, front matter, a fake stamp, "IGNORE ALL PREVIOUS INSTRUCTIONS" — collapses to one item line with zero forged items and an unforgeable stamp. On the shell path, a path with `'`, a space, `$(id)`, `"`, `;`, `&` and `é` is one argv element, single-quoted with `'\''`; zsh parses exactly three arguments after `claude`, and the AppleScript literal round-trips byte for byte. The prompt contains no captured text. The POST guard refuses cross-site, same-site, a foreign Origin, another port, https loopback and Host rebinding with 403 on both routes, nothing written and osascript never called; on `0.0.0.0` a keyless or wrong-key request is 401; the key is never in a launch answer; a 70 KB body is 413. The three doors give identical sentences. There is no MCP launch tool. No route string reaches `innerHTML`, and `CSS.escape` guards the tile selector.

The review also noted that this file was not on the branch at `e823d04`; it is now.
