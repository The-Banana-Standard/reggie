# Tasks

## Active Tasks

---

## Backlog

### v2.0.0 Release

(all v2.0.0 release tasks complete or in progress)

### Pipeline System Expansion
- [x] fix-groomed-section-shows-done-tasks: Fix debug-workflow "Done" path orphaning [x] tasks [P2] [simple] [tier: sonnet:medium] [reggie-system] [planned]
  files: resources/commands/reggie-debug-workflow.md (MOD)

### Reggie UI

### Bug Fixes & Tech Debt
- [ ] slug-control-char-whitelist: Whitelist colon-style slugs + strip control chars at PTY write [P3] [conflicts: harden-tasks-md-watcher, preexisting-clippy-warnings-in-projects-rs-tests] [simple] [tier: sonnet:medium] [code] [planned]
  files: src-tauri/src/commands/projects.rs (MOD), src-tauri/src/commands/terminal.rs (MOD)
- [ ] preexisting-clippy-warnings-in-projects-rs-tests: Fix 7 pre-existing clippy warnings + add CI gate [P3] [conflicts: harden-tasks-md-watcher, slug-control-char-whitelist] [simple] [tier: sonnet:medium] [code] [planned]
  files: src-tauri/src/commands/projects.rs (MOD), .github/workflows/ci.yml (MOD)

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

- [ ] tauri-capabilities-no-per-command-allowlist: `src-tauri/capabilities/default.json` does not enumerate per-command allowlists, so every `#[tauri::command]` in the binary is reachable from any frontend script in the `main` window. Pre-existing posture; not introduced by any specific task. If the app ever loads third-party content (extensions, embedded webviews of remote pages), this becomes exploitable.
  > context: discovered during security review of fix-groomed-tasks-refresh-stale (2026-04-30). Pre-existing in main. Severity LOW in current single-user trust model; HIGH if trust model expands.

- [ ] inconsistent-act-wrapping-in-codeworkflowtab-tests: ~30+ `fireEvent.click` calls in `CodeWorkflowTab.test.tsx` remain bare (no `act` wrapper) while others are wrapped. The implicit rule "wrap only if it warns" is fragile — warning behavior depends on whether the handler triggers a microtask that escapes React's batched update detection.
  > context: discovered 2026-05-01 during codeworkflowtab-act-warnings-from-relaunch-effect. As production code evolves, formerly-bare clicks may start warning. Consider adopting a project-wide convention (always `await act(async () => fireEvent.click(...))` for any click that may trigger state updates) and applying it in a follow-up sweep.

<!-- folded into vitest-setupfiles-and-contract-test-fixes (2026-04-25). Original guess (scanner glob bug) was wrong — RUST_COMMANDS is a hand-maintained table; just needs the missing entry. -->
