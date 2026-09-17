---
entity: packages/reggie/src/derive.ts
kind: file
---

## how · 2026-09-17 · Claude via jacobpress · high
reggie journal derive writes one entry per session that has something new, plus one entry for commits no session's span holds. Sessions come from four places, deduplicated by id: the launch log (this checkout's cache and, from a task worktree, the parent's), a UUID in the claim file, journal day files named by a session that hold an entry for the slug, and the session flag. A session is never guessed by directory or time, and a Codex launch is only counted as unread. Commits come from base..branch while the branch lives and from the landing lookup after; merges, the claim commit and decide commits are left out because those steps write their own entries. What is new is read back from the entries themselves: each ends in a derived line naming its session, the instant it read through and the twelve character ids of the commits it told. Marks are collected from the working tree, from the journal files the task branch changed, and from the ones the base gained since the branch was cut.
sources: derive-the-journal

## decision · 2026-09-17 · Claude via jacobpress · high
The sentence that says a session ran on another machine needs a recorded session id whose transcript is missing; a differing machine name alone is not enough. Measured on 2026-09-17: the owner's one laptop signed twelve claims as device-180.home and two as Jacobs-MacBook-Pro-3.local, because the claim records the network's name for the machine. With no id recorded the entry says no session was recorded. Also decided: a quotation is only ever the newest closing message later than the watermark; when the newest assistant record ends on tool calls and nothing closed the turn, the entry says so instead of quoting; the entry is dated at the last moment it covers, in local time; and a claim's handle is used for attribution only when it is safe as a file name and a header field.
sources: derive-the-journal

## gotcha · 2026-09-17 · Claude via jacobpress · high
The verb appends and never commits, and every refusal happens before anything is written. The opt-in rewrite sends the fixed instruction and exactly the template body, already flattened, redacted and cut, to claude -p with no tools, no MCP servers and no saved session, from the temp directory; the reply goes through the same cleaning, and any failure keeps the template. The runner is injected: deriveJournal has no default, the CLI builds the real one, and the real one throws under vitest. As of 2026-09-17 the real call has never been run by anyone: headless sessions are denied in the build environment. A live task branch costs each run a pull request lookup of about a third of a second, which is why most tests commit on main with a Task line instead.
sources: derive-the-journal

