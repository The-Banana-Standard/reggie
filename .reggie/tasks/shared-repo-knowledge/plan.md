---
slug: shared-repo-knowledge
title: Build shared repository knowledge
risk: medium
deciders: [jacobpress]
author: jacobpress
created: 2026-09-22
---
# Build shared repository knowledge

## Problem
Reggie has append-only notes, but it has no durable, shared current understanding for symbols and other code entities. The web UI, CLI context, MCP, and generated agent instructions therefore cannot share concise explanations, detect when those explanations are stale, or update them safely. There is also no guarded way to use a locally selected Codex or Claude CLI to populate that knowledge across a repository without risking unrelated working-tree changes.

## Approach
Evolve each note into a backward-compatible `KnowledgeRecord`: a replaceable structured current-understanding block, immutable dated note entries, immutable update history, entity/source fingerprint, optimistic revision token, and optional retirement or supersession metadata. Existing note files without a current block continue to parse, and the current block is the only prose used for ordinary narration. Give symbols their own source-derived path below `_symbols`; retain route, concept, service, store, and environment entities below `_entities`.

Build one knowledge service that inventories every tracked first-party JavaScript and TypeScript entity from the semantic index, derives fingerprints, reports new and stale records, validates all updates, writes files atomically under a repository-wide lock, and commits only the knowledge paths it changed. Inline edits create one commit each. A confirmed batch validates every chunk before publishing one atomic batch and one commit. Expected revision tokens prevent lost edits, and the service refuses writes outside the configured integration checkout.

Add schema-constrained adapters for the locally installed Codex and Claude CLIs. Both receive bounded, read-only source context and return the same schema for summaries, parameters, fields, return variants, and call-site explanations. Preview reports agent, entity/file/symbol counts, new/stale counts, chunks, and commit behavior; execution requires one explicit confirmation. Job state is local and resumable, and the last agent choice is local rather than committed.

Expose current knowledge and job status through CLI, MCP, server read APIs, repository context, and generated `CLAUDE.md`/`AGENTS.md`. Add guarded HTTP writes for inline edits, refresh/generation, retirement, and job resume using the server's existing loopback, origin, body-size, path, and attribution protections. Rejected: separate Codex- and Claude-owned knowledge stores, because switching generators would fork the repository's understanding and make history and conflict handling unreliable.

## Files to touch
- packages/reggie/src/knowledge.ts (NEW)
- packages/reggie/src/knowledge.test.ts (NEW)
- packages/reggie/src/knowledge-agents.ts (NEW)
- packages/reggie/src/knowledge-agents.test.ts (NEW)
- packages/reggie/src/knowledge-jobs.ts (NEW)
- packages/reggie/src/knowledge-jobs.test.ts (NEW)
- packages/reggie/src/notes.ts (MOD)
- packages/reggie/src/notes.test.ts (MOD)
- packages/reggie/src/paths.ts (MOD)
- packages/reggie/src/git.ts (MOD)
- packages/reggie/src/layout.ts (MOD)
- packages/reggie/src/context.ts (MOD)
- packages/reggie/src/context.test.ts (MOD)
- packages/reggie/src/docs.ts (MOD)
- packages/reggie/src/docs.test.ts (MOD)
- packages/reggie/src/cli.ts (MOD)
- packages/reggie/src/mcp.ts (MOD)
- packages/reggie/test/mcp.test.ts (MOD)
- packages/reggie/src/serve.ts (MOD)
- packages/reggie/test/serve.test.ts (MOD)
- packages/reggie/docs/ui-api-contract.md (MOD)
- packages/reggie/README.md (MOD)
- AGENTS.md (MOD)
- CLAUDE.md (MOD)

## Acceptance criteria
- [ ] `KnowledgeRecord` represents repo, folder, file, symbol, route, concept, service, store, and environment knowledge with a replaceable current block, append-only dated notes, append-only update history, source fingerprint, revision token, retirement, and supersession metadata while parsing legacy note files unchanged.
- [ ] Symbol records resolve to `.reggie/notes/_symbols/<source-path>/<qualified-symbol>.md`; routes and concepts remain below `_entities`, and all target resolution rejects traversal or ambiguous IDs.
- [ ] Fingerprints come from the indexed source or entity evidence, changed fingerprints mark current prose stale, and no stale record refreshes without an explicit edit or generation request.
- [ ] Normal narration, search, context, MCP, server reads, and generated agent instructions use only non-retired current text while history and retired or superseded text remain explicitly retrievable.
- [ ] A validated human or AI update can replace current text, and every update appends agent/author, code revision, changed fields, reason, timestamp, and prior revision without altering earlier history.
- [ ] Inline saves and retirement writes use expected revisions, atomic replacement, a shared knowledge lock, the configured integration checkout, and exactly one knowledge-only Git commit without including or unstaging unrelated working-tree or index changes.
- [ ] A confirmed batch validates all generator output before publishing, writes one atomic knowledge batch, creates exactly one knowledge-only commit, exposes the resulting commit, and leaves no partial current updates when a chunk fails.
- [ ] Codex and Claude adapters run with read-only permissions, bounded source context, timeouts, and a strict shared output schema that rejects malformed, hostile, extra-entity, or over-sized responses.
- [ ] Batch and incremental jobs expose selected agent, new/stale entities, file/symbol counts, expected chunks, progress, failures, resumability, confirmation state, and resulting commit; the last selected agent and job state remain local and uncommitted.
- [ ] Generated knowledge covers concise entity summaries, parameter and field descriptions, return descriptions, and per-call-site explanations for every tracked first-party JavaScript/TypeScript role without writing types into target source code.
- [ ] CLI commands preview, confirm, generate/refresh, inspect history, and retire knowledge; server APIs read knowledge/job status and guard edits, jobs, retirement, and resume with existing loopback, same-origin, attribution, size, and path rules.
- [ ] The web data readers, `reggie context`, MCP, `CLAUDE.md`, and `AGENTS.md` consume the same current-understanding records and clearly report stale state, provenance, history availability, and explicit refresh semantics.
- [ ] Tests cover legacy compatibility, current/history rendering, retirement/supersession, both agent adapters, invalid/hostile output, timeout, stale fingerprints, atomic writes, revision conflicts, concurrent locks, failed batches, resumability, integration-checkout enforcement, and knowledge-only commits amid unrelated dirty and staged files.
- [ ] From `packages/reggie`, focused tests, the full suite, typecheck, build, generated documentation checks, code review, security review, simplification review, and hosted Linux/macOS CI all pass.

## Verification strategy
- Criterion 1: run legacy/current/history parsing tests across every knowledge kind; save focused output and representative records in `evidence/knowledge-records.txt`.
- Criterion 2: run symbol, entity, and traversal target-resolution tests; save resolved paths in `evidence/knowledge-records.txt`.
- Criterion 3: run file, symbol, route, and concept fingerprint/staleness tests and assert no implicit refresh; save stale records in `evidence/knowledge-records.txt`.
- Criterion 4: compare narration, search, context, MCP, HTTP, and generated-doc output for active, retired, and superseded fixtures; save output in `evidence/knowledge-consumers.txt`.
- Criterion 5: run human-to-AI and AI-to-human replacements and inspect immutable update fields; save rendered history in `evidence/knowledge-records.txt`.
- Criterion 6: run isolated Git-fixture tests for inline/retirement commits, revision conflicts, lock contention, integration-branch enforcement, and dirty/staged preservation; save commit trees and status in `evidence/knowledge-git.txt`.
- Criterion 7: run multi-chunk success, invalid final chunk, atomic publish, and one-commit batch cases; save commit trees and job state in `evidence/knowledge-git.txt`.
- Criterion 8: run Codex and Claude command, schema, hostile output, over-size, and timeout fixtures; save focused output in `evidence/knowledge-jobs.txt`.
- Criterion 9: run preview, confirmation, progress, failure, resume, agent preference, and resulting-commit cases; save preview/job JSON in `evidence/knowledge-jobs.txt`.
- Criterion 10: generate fixture knowledge for every first-party code role and assert summary, parameter, field, return, call-site, and undeclared-type output; save schema samples in `evidence/knowledge-jobs.txt`.
- Criterion 11: run CLI, HTTP, and MCP contract tests, including same-origin, body-size, path, and attribution failures; save command help and responses in `evidence/interfaces.txt`.
- Criterion 12: build context and generated docs from the same current records, verify stale/provenance/history notices, and save output in `evidence/knowledge-consumers.txt`.
- Criterion 13: run the complete focused knowledge suite, including every named fault case, and record mutation probes for held locks, hostile entities, partial failure, and unrelated staged files in `evidence/mutation-probes.txt`.
- Criterion 14: save full-suite, typecheck, build, docs-check, audit, diff-check, review, and hosted CI results in `evidence/full-verification.txt` and `evidence/reviews.txt`.

## Assumptions
- The integration checkout is the worktree whose current branch equals Reggie's configured integration branch; generation and edits are rejected from task worktrees rather than silently committing to them.
- Current knowledge is structured repository data stored inside the existing Markdown note file, not a second database. Existing note entries remain readable and appendable.
- A source fingerprint change marks prose stale but does not retire it, hide it, or trigger an agent automatically.
- AI may replace human-edited current fields only after the user explicitly confirms the refresh; the immutable update record makes that replacement auditable.
- Batch atomicity means no knowledge record becomes current until every requested chunk validates, followed by atomic file replacement and one commit. Agent invocations themselves may be resumed without repeating successful local job chunks.
- Codex and Claude executable availability is checked at execution time. Preview and tests do not require either executable to be installed.
- Parameter and return descriptions report declared types when the semantic index proves them; undeclared types remain visibly absent and are never inferred into target code.

## Out of scope
- Symbol, route, and concept page layouts, inline browser editing controls, call visuals, and stale-warning presentation; this task provides their durable records and APIs.
- Data Flow card redesign, graph label changes, and removal of legacy payload fields.
- Generating initial knowledge in `personal_website`; that occurs in the final acceptance task after its onboarding files and conflicts are resolved.
- Modifying target repository source code to add TypeScript or JSDoc declarations.

## Bail conditions
- If legacy Markdown notes cannot embed a deterministic current block without corrupting existing entries, stop and define a versioned migration with reversible fixtures before writing any repository note.
- If Git cannot create a path-limited commit while preserving unrelated staged and unstaged changes exactly, stop and redesign the commit transaction around an isolated index before enabling writes.
- If either local agent CLI cannot be constrained to read-only repository access and strict bounded output, leave that adapter disabled and re-plan its security boundary rather than executing it permissively.
- If the semantic index cannot provide stable source fingerprints for symbols and proof-bearing evidence for non-symbol entities, stop before generating prose that cannot be invalidated accurately.
