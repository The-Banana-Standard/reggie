# Tasks

## Active Tasks

### add-headless-auto-relaunch-on-done
**Task**: UI relaunches next backlog task when a Repo-Start session emits DONE-success
**Pipeline**: code-workflow
**Branch**: task/add-headless-auto-relaunch-on-done
**Worktree**: .worktree/add-headless-auto-relaunch-on-done
**Base**: main
**Started**: 2026-04-30
**Files**:
- MOD: src/types/terminal.ts
- MOD: src/hooks/useTerminal.ts
- MOD: src/components/WorkspaceOverview/CodeWorkflowTab.tsx
- MOD: src/components/WorkspaceOverview/__tests__/CodeWorkflowTab.test.tsx

## Backlog

### v2.0.0 Release

(all v2.0.0 release tasks complete or in progress)

### Pipeline System Expansion

### Reggie UI
- [x] investigate-cross-domain-batch-start: Diagnose why Batch Start Coding fails for `[debug]` and possibly `[reggie-system]` tasks [P2] [conflicts: configurable-pipelines-with-locked-reggie-system] [complex] [tier: opus:high] [debug] [planned]
  files: src/components/WorkspaceOverview/CodeWorkflowTab.tsx (MOD)
  > closed 2026-04-30: 4 bugs identified in per-repo Start dispatch (backend conflict prune drops cross-domain backlog tasks; active slugs re-launched as duplicates; active slugs lose mode tag; reggie-system cap is per-repo instead of group-wide), plus 1 secondary bug in Batch Start (per-repo skip via `isWorkflowLabel` swallows cross-domain dispatch). Design intent confirmed: code/debug per-repo (5/3), reggie-system group-wide (1 total). Visible-signal UX decision for held reggie-system slot. Follow-up `[code]` task: fix-cross-domain-dispatch-per-repo-and-batch. See .pipeline/investigate-cross-domain-batch-start/HANDOFF.md.

### Bug Fixes & Tech Debt
- [x] vitest-env-hang-investigation: Diagnose and fix vitest hanging at 0% CPU [P2] [depends: add-pipeline-mode-tags-manual-reggie-system-and-debug] [conflicts: replace-sqlite-with-json-bookmarks] [complex] [tier: opus:high] [debug] [planned]
  files: vite.config.ts (MOD), package.json (MOD)
  > closed 2026-04-25: hang not reproducible — full suite runs 962 tests in 6.86s across 3 invocations. Diagnosis inconclusive (likely stale Vite dep-optimizer cache or sandbox-trapped stale processes, both since cleared). setupFiles AC item folded into vitest-setupfiles-and-contract-test-fixes. See .pipeline/vitest-env-hang-investigation/HANDOFF.md.

### Other

### Ungroomed
- [ ] one-click-install-from-internet: One-click install of skills, agents, commands, plugins, hooks from internet sources
  > context: broad install surface for the Reggie UI. Per-unit-type install mechanics differ — skills/agents/commands = file copy to `~/.claude/`, hooks = edit `settings.json`, plugins = bundle. Hooks management folds into this rather than being a standalone feature. Existing `src-tauri/src/installer.rs` is hardcoded to `~/.claude/` system-level install; install/uninstall symmetry is a known footgun there. Also relates to Anthropic's own `/plugin install` — open Q whether to shell out vs. write files directly.

- [ ] federate-marketplace-sources: Aggregate plugins/skills/agents from multiple sources in the Reggie UI marketplace
  > context: discovery is the user's biggest pain — they don't know what exists. Sources to federate: Anthropic's claude-plugins-official, claude-plugins-community, alirezarezvani/claude-skills, awesome-claude-code, arbitrary GitHub repos. Anthropic's own marketplace is curated and small; community lives elsewhere. Trust/safety surfaces (prompt preview, tool list, source attribution) matter here.

- [ ] mcp-visualization-panel: Visualize MCP servers configured and running in the Reggie UI
  > context: user wants visibility into what MCPs are active. Suspect Reggie already manages this somewhere but it's not surfaced in the UI. Distinct from the install feature — this is a "see what I have" surface, not "install new things."

- [ ] judge-driven-pipeline-comparison: Use `reggie-judge` to compare two pipelines or two agents on a real task
  > context: lowest priority of the marketplace cluster. Differentiator vs. other marketplaces — Reggie has `reggie-judge` baked into its architecture, so the marketplace can offer "evaluate these candidates against your codebase" as a recommendation surface. Nobody else can easily copy this. Needs the install/substrate features to exist first to have anything meaningful to compare.

- [ ] pipeline-bindings-concurrent-write-race: `set_pipeline_binding` and `clear_pipeline_binding` Rust commands do read-modify-write on pipeline-bindings.json with no mutex. Two near-simultaneous calls can interleave and lose one write (same class as the Tauri parallel IPC state race in memory). Interactive single-button use is safe; the race would trigger if a future surface batches multiple bind operations concurrently.
  > context: discovered during security review of configurable-pipelines-with-locked-reggie-system. Fix: Mutex<()> in AppState guarding the file for the duration of read+write, or pid-suffixed tmp file.

- [ ] pipeline-bindings-css-unstyled: Classes `.pipeline-bindings-strip`, `.pipeline-bind-row`, `.pipeline-bind-btn`, `.pipeline-binding-badge`, `.pipeline-missing-warning` are referenced in PipelinesPanel.tsx and CodeWorkflowTab.tsx but have no CSS rules yet. They're functional but styled with bare inline styles only.
  > context: discovered during simplify/review pass of configurable-pipelines-with-locked-reggie-system.

- [ ] dev-build-symlinks-pollute-working-tree: The Tauri dev build replaces `resources/*` with symlinks into `src-tauri/target/debug/reggie-resources/`, creating ~73 typechange entries every release prep
  > context: discovered 2026-04-28 while prepping v2.1.0. After running the app locally for testing, `git status` showed 73 typechange entries — every file under `resources/agents/`, `resources/commands/`, and `resources/hooks/` had been flipped from regular file (100644) to symlink (120000) pointing into `src-tauri/target/debug/reggie-resources/...`. All 73 flipped at the same minute (Apr 26 17:11), so it's a single dev-build step doing this. This means every "test locally → push a release" cycle requires `git restore --staged resources/` before the release commit, which is fragile (easy to accidentally commit the symlinks and break the bundled distribution). Need to investigate: which Tauri build step is creating these symlinks, why source files are pointing into the build output (reverse of the usual pattern), and whether the dev build can use a separate output dir or copy instead of symlink. Likely fix touches: `src-tauri/build.rs`, `src-tauri/tauri.conf.json` resource bundling, or a custom build script. Workarounds to consider in the meantime: add `resources/` typechanges to a pre-commit guard, or have the dev script restore from HEAD on exit.

- [ ] add-headless-session-slug-dedupe: `addHeadlessSession` (`src/hooks/useTerminal.ts:220-244`) has no slug-level dedupe. The cross-domain dispatch fix relies entirely on backend never emitting active slugs in `backlogSlugs`. Defensive belt-and-suspenders: filter `pickBacklogToLaunch` input against any active slug already running.
  > context: discovered during quality-check + review of fix-cross-domain-dispatch-per-repo-and-batch (2026-04-30). Today's correctness depends on a backend invariant; one regression in `get_parallelizable_tasks` would re-introduce duplicate launches. Suggested fix: in `pickBacklogToLaunch`, filter `backlog` to drop any slug whose name appears in a running session's label. Cheap, makes the invariant explicit at the consumer.

- [ ] reggie-system-holder-deterministic-tiebreaker: `reggieSystemHolder` memo in `CodeWorkflowTab.tsx:422-437` picks the first matching session by iteration order (headless first, then promoted). When both arrays have a holder simultaneously (transient state during promotion), the badge name is non-deterministic across renders.
  > context: discovered during quality-check of fix-cross-domain-dispatch-per-repo-and-batch (2026-04-30). UX-only impact; cap enforcement unaffected. Suggested fix: tie-break by session start time or by promoted-takes-precedence rule. Or just document that "any holder" is fine.

- [ ] slug-control-char-whitelist: `parse_task_line` and the active-section parser in `src-tauri/src/commands/projects.rs:455, 586` use `String::trim()` only — embedded `\r` in a slug survives parsing and reaches Claude Code's REPL stdin via `terminal.rs:625-638`. Single-user trust model makes this minor, but a whitelist (`[A-Za-z0-9._-]`) would foreclose the CR-injection path entirely.
  > context: discovered during security review of fix-cross-domain-dispatch-per-repo-and-batch (2026-04-30). Pre-existing in main, not introduced by the diff. Severity MINOR. Bonus hardening: strip ASCII control chars from `cmd` in `spawn_headless_terminal` before `writer.write_all`.

- [ ] tasks-md-watch-skip-when-path-null: The `useSessionTracking` watcher useEffect at `src/hooks/useSessionTracking.ts:143-170` always calls `invoke("stop_tasks_md_watch")` on mount and on cleanup, even when `activeLevelPath` is and was always null. Harmless (Rust stop is a no-op) but produces extra IPC traffic in the null-path case.
  > context: discovered during write-tests of fix-groomed-tasks-refresh-stale (2026-04-30). Suggested fix: gate the effect body on `activeLevelPath != null` if both prev and next are null, or track via a ref whether a watcher is currently running.

- [ ] tasks-md-watch-recursive-scope-guard: `start_tasks_md_watch` accepts any `path: String` from the frontend and watches recursively. A buggy or malicious frontend passing `/` or `$HOME` could exhaust FSEvents/inotify resources until app restart. Single-user trust model makes this acceptable today; defense-in-depth would canonicalize the path and reject roots, home, or fewer than N components.
  > context: discovered during security review of fix-groomed-tasks-refresh-stale (2026-04-30). Severity MEDIUM in current threat model. notify itself doesn't crash; stop_tasks_md_watch recovers.

- [ ] tauri-capabilities-no-per-command-allowlist: `src-tauri/capabilities/default.json` does not enumerate per-command allowlists, so every `#[tauri::command]` in the binary is reachable from any frontend script in the `main` window. Pre-existing posture; not introduced by any specific task. If the app ever loads third-party content (extensions, embedded webviews of remote pages), this becomes exploitable.
  > context: discovered during security review of fix-groomed-tasks-refresh-stale (2026-04-30). Pre-existing in main. Severity LOW in current single-user trust model; HIGH if trust model expands.

- [ ] codeworkflowtab-act-warnings-from-relaunch-effect: New `useEffect` in `CodeWorkflowTab.tsx` (added by add-headless-auto-relaunch-on-done) fires on `headlessSessions` mutation, causing React `act(...)` warnings in unrelated tests that mutate sessions without wrapping in `act()`. Stderr-only, no test failures.
  > context: discovered during implement of add-headless-auto-relaunch-on-done (2026-04-30). Cleanup: wrap impacted test mutations in `await act(async () => { ... })`. Low priority — cosmetic test output noise only.

- [ ] preexisting-clippy-warnings-in-projects-rs-tests: `cargo clippy --all-targets -- -D warnings` fails on main with 7 errors in `src-tauri/src/commands/projects.rs` test helpers — 5× `unnecessary use of to_path_buf` (around lines 1298, 1305, 1373, 1386, 1394) and 2× `redundant closure` calling `parse_task_line`. Blocks any future CI gate that includes test targets.
  > context: discovered during verify-app of fix-groomed-tasks-refresh-stale (2026-04-30). Pre-existing on base commit `50571df`. Trivial fix; would unblock a stricter clippy CI gate.

<!-- folded into vitest-setupfiles-and-contract-test-fixes (2026-04-25). Original guess (scanner glob bug) was wrong — RUST_COMMANDS is a hand-maintained table; just needs the missing entry. -->
