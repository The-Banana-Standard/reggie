# Journal · 2026-09-23 · jacobpress · session

Plain-English record of what happened, written as it happened. No file paths in the prose; link evidence instead.

### 00:03 · jacobpress · codex · shared-repo-knowledge · plan
Defined the shared knowledge contract around backward-compatible notes, guarded local-agent generation, stale fingerprints, optimistic revisions, atomic knowledge-only commits, and one confirmed batch. The main uncertainty is preserving unrelated staged changes across path-limited commits, so the plan makes that a bail condition and a required Git fixture.

### 00:04 · jacobpress · codex · shared-repo-knowledge · claim
Resumed work on the task branch.

### 00:16 · jacobpress · codex · shared-repo-knowledge · build
Built the durable knowledge record and Git transaction layer. Legacy notes remain valid, symbol knowledge has stable source-based storage, current text and immutable history are separate, and knowledge-only commits preserve unrelated staged and unstaged work. Focused tests and type checking pass.

### 00:27 · jacobpress · codex · shared-repo-knowledge · build
Added source-constrained Codex and Claude adapters plus resumable knowledge jobs. Every generated description is bound to semantic IDs and declared types, previews show the complete scope and commit behavior, confirmation happens once, failures publish nothing, and successful batches produce one knowledge-only commit. Focused adapter, job, record, and note tests pass with type checking.

### 00:45 · jacobpress · codex · shared-repo-knowledge · build
Connected shared knowledge to context, note search, MCP, generated agent instructions, CLI commands, and guarded web APIs. Current and stale state now come from one record, retired text is excluded from normal narration, and explicit history remains readable. Interface, documentation, context, job, adapter, and Git-safety tests pass.

