# Tasks

## Active Tasks

### sessions-tab-link-not-opening
**Task**: Make clickable terminal links open in system browser
**Pipeline**: code-workflow
**Branch**: task/sessions-tab-link-not-opening
**Worktree**: .worktree/sessions-tab-link-not-opening
**Base**: main
**Started**: 2026-04-29
**Files**:
- MOD: src/components/Terminal/TerminalView.tsx
- MOD: src/components/Terminal/__tests__/TerminalView.test.tsx

---

## Backlog

### v2.0.0 Release

(all v2.0.0 release tasks complete or in progress)

### Pipeline System Expansion

(no open tasks)

### Reggie UI
- [ ] wire-tasksviewer-mode-dispatch: Make TasksViewer respect all 5 pipeline mode tags [P2] [moderate] [tier: opus:medium] [code] [planned]
  files: src/types/task.ts (MOD), src/components/TasksViewer/TaskCard.tsx (MOD), src/components/TasksViewer/TasksViewer.tsx (MOD), src/App.tsx (MOD)
- [ ] configurable-pipelines-with-locked-reggie-system: Let users bind any pipeline to code/debug/manual modes; reggie-system stays fixed [P2] [depends: wire-tasksviewer-mode-dispatch] [conflicts: investigate-cross-domain-batch-start, wire-tasksviewer-mode-dispatch] [complex] [tier: opus:high] [code] [planned]
  files: src-tauri/src/commands/pipeline_bindings.rs (NEW), src/lib/pipelineBindings.ts (NEW), src/components/ActivityBar/PipelinesPanel.tsx (MOD), src/components/WorkspaceOverview/CodeWorkflowTab.tsx (MOD), src-tauri/src/lib.rs (MOD)
- [ ] investigate-cross-domain-batch-start: Diagnose why Batch Start Coding fails for `[debug]` and possibly `[reggie-system]` tasks [P2] [conflicts: configurable-pipelines-with-locked-reggie-system] [complex] [tier: opus:high] [debug] [planned]
  files: src/components/WorkspaceOverview/CodeWorkflowTab.tsx (MOD)

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

- [ ] dev-build-symlinks-pollute-working-tree: The Tauri dev build replaces `resources/*` with symlinks into `src-tauri/target/debug/reggie-resources/`, creating ~73 typechange entries every release prep
  > context: discovered 2026-04-28 while prepping v2.1.0. After running the app locally for testing, `git status` showed 73 typechange entries — every file under `resources/agents/`, `resources/commands/`, and `resources/hooks/` had been flipped from regular file (100644) to symlink (120000) pointing into `src-tauri/target/debug/reggie-resources/...`. All 73 flipped at the same minute (Apr 26 17:11), so it's a single dev-build step doing this. This means every "test locally → push a release" cycle requires `git restore --staged resources/` before the release commit, which is fragile (easy to accidentally commit the symlinks and break the bundled distribution). Need to investigate: which Tauri build step is creating these symlinks, why source files are pointing into the build output (reverse of the usual pattern), and whether the dev build can use a separate output dir or copy instead of symlink. Likely fix touches: `src-tauri/build.rs`, `src-tauri/tauri.conf.json` resource bundling, or a custom build script. Workarounds to consider in the meantime: add `resources/` typechanges to a pre-commit guard, or have the dev script restore from HEAD on exit.

<!-- folded into vitest-setupfiles-and-contract-test-fixes (2026-04-25). Original guess (scanner glob bug) was wrong — RUST_COMMANDS is a hand-maintained table; just needs the missing entry. -->
