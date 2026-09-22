# Security review (AC51)

Reviewed 2026-09-22 against `repo-manager...task/low-risk-auto-approval`. Scope included the full changed implementation and its tests, with special attention to the six areas required by the plan.

## Findings and disposition

1. **Evidence path handling — pass.** `evidencePath` rejects absolute paths, drive-prefixed paths, `..`, backslashes, controls, nested paths, option-like names, and paths outside the task evidence folder. Disk recording also rejects links, directories, non-files, missing files, and empty files. Commit resolution uses a full 40-character commit, literal pathspecs, one bounded tree listing, and accepts only non-empty regular blobs. The packet and check-record readers converge on this resolver. Covered by `checks.test.ts`, `packet.test.ts`, and `policy.test.ts`.

2. **Landing lock — pass.** The lock lives in the shared git directory, is created atomically, carries a random ownership token, refuses a live holder, replaces only a dead or expired holder, and removes only a lock whose token belongs to the caller. A pre-existing merge is refused before `git merge`; rollback aborts only the merge whose `MERGE_HEAD` matches the resolved task tip. Covered by `land.test.ts`, including contention and rollback cases.

3. **Record-reader limits — pass.** The reader caps each JSON line at 16 KiB, caps the file at 5,000 lines and the policy read at 8 MiB, validates an exact field set and bounded field types, rebuilds the object field by field, and reports every malformed line as a policy refusal. This prevents prototype fields, oversized input, and malformed evidence values from being trusted. Covered by `checks.test.ts` and `policy.test.ts`.

4. **Hostile record text reaching the page — pass.** Record strings are normalized to one line, controls and bidirectional formatting characters are removed, and lengths are bounded. The browser constructs all report content with text nodes; it does not send record values through the Markdown/inline renderer or `innerHTML`. Covered by the hostile-record cases and task-page tests.

5. **Config source — pass.** The evaluator resolves the integration checkout structurally, resolves the integration branch to one full commit id, and parses mode, policy, and risk rules from that base commit. Task-worktree edits cannot widen the policy used for the current report. Plan criteria and file scope also come from the base commit. Covered by policy-source, uncommitted-edit, and tamper cases.

6. **Base branch name reaching git — pass with bounded input.** The only disk-derived git revision name is rejected when it begins with a dash, contains `..`, or contains characters outside the branch-name subset. It is then expanded under fixed `refs/heads/` or `refs/remotes/origin/` prefixes and resolved to a full SHA before commit reads. Subsequent reads use full SHAs and literal pathspecs.

7. **Known limitation — accepted for this report-only slice.** `AGENTS.md` and `CLAUDE.md` are instruction surfaces but are deliberately not on the fixed control-file list because every task refreshes their generated blocks. The task plan explicitly records this limit and leaves it to the repository's risk rules until `policy-acts-on-its-verdict`; this slice never acts on a policy report, so no automatic merge authority is introduced here.

8. **Simplification pass — pass.** Shared parsing/resolution stays centralized in `checks.ts`, `packet.ts`, and `git.ts`; the CLI, MCP, server, and browser are thin consumers. No duplicate decision path, shell interpolation, policy write, or automatic merge path was found. Whitespace-only diff noise was removed from test and evidence files.

## Second-pass execution

Command:

`TZ=UTC npx vitest run src/checks.test.ts src/packet.test.ts src/policy.test.ts src/land.test.ts test/mcp.test.ts test/serve.test.ts`

Result (run outside the restricted sandbox because these suites intentionally open local fixture sockets and IPC pipes):

- Test files: 6 passed of 6.
- Tests: 278 passed of 278.
- Exit status: 0.
- Duration: 30.20 seconds.

No release-blocking security finding remains open in this slice.
