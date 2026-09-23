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

### 00:54 · jacobpress · codex · shared-repo-knowledge · implement
Hardened note identifiers, knowledge write locks, resumable job publication, and ordinary API reads. Cached agent output is revalidated at publication, concurrent writers retain ownership, and history is loaded only when explicitly requested.

### 01:02 · jacobpress · codex · shared-repo-knowledge · review
The transaction review found and closed a post-commit index-refresh failure window. A compare-and-swap rollback now restores the integration ref before note restoration, with a real locked-index regression test.

### 01:05 · jacobpress · codex · shared-repo-knowledge · review
The path review found lossy slug collisions between distinct route or concept identifiers. New entity notes now add a digest while exact legacy frontmatter retains its old path; batch writes also reject any residual target collision.

### 01:20 · jacobpress · codex · shared-repo-knowledge · verify
All local acceptance checks passed. Hosted Ubuntu passed immediately; an unchanged macOS rerun passed after the first runner lost a temporary Git fixture object directory.

### 01:27 · jacobpress · codex · shared-repo-knowledge · decide
Decision: approved. Merged the task branch into repo-manager. All 14 criteria, required reviews, local verification, and final hosted Linux/macOS CI passed. Approved under the user's instruction to complete and merge the program tasks into repo-manager.

### 01:37 · jacobpress · codex · code-entity-pages · plan
Planned first-class symbol, route, and concept pages on the semantic and shared-knowledge contracts. The task includes exact declaration source, paged full files, safe editing and refresh, and durable manual concept overrides while leaving Data Flow cards for the next task.

### 01:38 · jacobpress · codex · code-entity-pages · claim
Claimed the task and started a branch from repo-manager in a separate worktree.

