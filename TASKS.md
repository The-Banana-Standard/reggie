# Tasks

## Active Tasks

---

## Backlog

### v2.0.0 Release

(all v2.0.0 release tasks complete or in progress)

### Pipeline System Expansion


### Bug Fixes & Tech Debt
- [ ] fix-sessions-tab-width-on-return: Diagnose and fix Sessions tab terminal width shrinking on return [P2] [depends: add-pipeline-mode-tags-manual-reggie-system-and-debug] [complex] [tier: opus:high] [debug] [planned]
  files: src/components/Terminal/TerminalView.tsx (MOD)
- [ ] vitest-env-hang-investigation: Diagnose and fix vitest hanging at 0% CPU [P2] [depends: add-pipeline-mode-tags-manual-reggie-system-and-debug] [conflicts: replace-sqlite-with-json-bookmarks] [complex] [tier: opus:high] [debug] [planned]
  files: vite.config.ts (MOD), package.json (MOD)

### Other
- [ ] attach-images-to-ungroomed-tasks: Paste/drop images into ungroomed task input, consumed during init-tasks [P3] [conflicts: wire-manual-reggie-system-and-debug-tags-runtime, fix-clippy-projects-rs, replace-sqlite-with-json-bookmarks, add-pipeline-mode-tags-manual-reggie-system-and-debug] [complex] [tier: opus:high] [code] [unplanned]
  files: src/components/ProjectSummary/ProjectSummaryPanel.tsx (MOD), src-tauri/src/commands/projects.rs (MOD), src-tauri/src/lib.rs (MOD), resources/commands/reggie-init-tasks.md (MOD), .gitignore (MOD)

### Ungroomed

- [ ] ui-pipeline-button-rebinding: Let users bind any auto-discovered pipeline (not just `reggie-code-workflow`) to UI workflow buttons
  > context: pipeline auto-discovery already works via frontmatter `type: pipeline` (PipelinesPanel.tsx + get_pipelines in reggie_data.rs). Substrate is small — just adding the rebinding layer on top. Open question for grooming: per-workspace or global persistence of the binding.

- [ ] one-click-install-from-internet: One-click install of skills, agents, commands, plugins, hooks from internet sources
  > context: broad install surface for the Reggie UI. Per-unit-type install mechanics differ — skills/agents/commands = file copy to `~/.claude/`, hooks = edit `settings.json`, plugins = bundle. Hooks management folds into this rather than being a standalone feature. Existing `src-tauri/src/installer.rs` is hardcoded to `~/.claude/` system-level install; install/uninstall symmetry is a known footgun there. Also relates to Anthropic's own `/plugin install` — open Q whether to shell out vs. write files directly.

- [ ] federate-marketplace-sources: Aggregate plugins/skills/agents from multiple sources in the Reggie UI marketplace
  > context: discovery is the user's biggest pain — they don't know what exists. Sources to federate: Anthropic's claude-plugins-official, claude-plugins-community, alirezarezvani/claude-skills, awesome-claude-code, arbitrary GitHub repos. Anthropic's own marketplace is curated and small; community lives elsewhere. Trust/safety surfaces (prompt preview, tool list, source attribution) matter here.

- [ ] mcp-visualization-panel: Visualize MCP servers configured and running in the Reggie UI
  > context: user wants visibility into what MCPs are active. Suspect Reggie already manages this somewhere but it's not surfaced in the UI. Distinct from the install feature — this is a "see what I have" surface, not "install new things."

- [ ] judge-driven-pipeline-comparison: Use `reggie-judge` to compare two pipelines or two agents on a real task
  > context: lowest priority of the marketplace cluster. Differentiator vs. other marketplaces — Reggie has `reggie-judge` baked into its architecture, so the marketplace can offer "evaluate these candidates against your codebase" as a recommendation surface. Nobody else can easily copy this. Needs the install/substrate features to exist first to have anything meaningful to compare.

- [ ] tauri-contract-test-missing-uninstall-reggie-files: tauri-contract.test.ts fails because scanner doesn't see `uninstall_reggie_files` in Rust
  > context: discovered during polish-uninstaller (2026-04-25). The contract test (`src/__tests__/tauri-contract.test.ts`) reports "Unknown commands called from TS: uninstall_reggie_files" — the test passes on a clean main checkout too, so this is pre-existing, not regressed by the polish work. Likely the scanner glob/regex doesn't pick up the command's `#[tauri::command]` attribute in `src-tauri/src/installer.rs` (most other commands live under `src-tauri/src/commands/`). Fix is probably one line in the contract test's source-file enumeration.
