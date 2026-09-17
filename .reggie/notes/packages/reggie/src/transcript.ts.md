---
entity: packages/reggie/src/transcript.ts
kind: file
---

## why · 2026-09-17 · Claude via jacobpress · high
A transcript is a private conversation, so this is the one module allowed to open one, and it decides what Reggie understands of it. It understands seven fields and no others: a record's type, isSidechain, timestamp and cwd, the message's stop_reason, and the type and text of each content block. Text is copied out of one kind of record only, the assistant's closing message of a turn: type assistant, not a sidechain, stop_reason end_turn, text blocks. The record kinds that must never be read into anything that leaves the module are: user records (the owner's prompts, every tool result, and the compaction summary, which is a user record flagged isCompactSummary), thinking and tool_use blocks, interim assistant text (stop_reason tool_use), text that ends on stop_sequence or with no reason, attachment, queue-operation, last-prompt, custom-title, ai-title and bridge-session records (the last holds account and organisation ids), and the record's own slug key, which is the tool's nickname for the session and not a task. Subagent files and the tool-results folder beside a transcript are never opened. Widening any of this is a decision for the owner, not a build detail.
sources: derive-the-journal

## how · 2026-09-17 · Claude via jacobpress · high
A transcript is found by its session id as <id>.jsonl in whichever folder under the Claude home's projects folder holds it. The folder name is never computed from a start directory, because the encoding is lossy, and a <id>/ folder holding workflows, subagents or tool-results is side data, not a transcript. An id that is not a lowercase UUID is refused before any path is built. The file is read through a synchronous chunked line reader, 64 KB at a time with a 1 MB ceiling per line: an oversized line is dropped unassembled and counted, a line that does not parse is counted and skipped, and the file is never read whole. Measured on 2026-09-17 with this reader, the largest real transcript (39 MB, 3,118 lines) took 96 ms and dropped two oversized lines. File order is not time order, so everything compares timestamps. Which records count for a task is a lexical path rule: the cwd must be inside the repository, and once any record is inside the slug's own worktree only those count.
sources: derive-the-journal

## gotcha · 2026-09-17 · Claude via jacobpress · high
The Claude home has no default here. defaultClaudeHome is the only place the home directory is named, only the CLI calls it, and every library function takes the home as a required argument, which is what stops a test from ever reading a real conversation. A test asserts that the word homedir appears once in this file and never in the derive module, and that this file never calls a whole-file read. Keep both true.
sources: derive-the-journal

