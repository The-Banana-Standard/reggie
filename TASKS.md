# Tasks

## Active Tasks

### fix-clippy-projects-rs
**Task**: Fix pre-existing clippy errors in projects.rs
**Stage**: IMPLEMENT
**Pipeline**: code-workflow
**Branch**: task/fix-clippy-projects-rs
**Worktree**: .worktree/fix-clippy-projects-rs
**Base**: main
**Started**: 2026-04-25
**Attempts**: 1
**Files**:
- MOD: src-tauri/src/commands/projects.rs
**Quality Scores**:
| Stage | Score | Attempts | Status |
|-------|-------|----------|--------|
| IMPLEMENT | 9.23 | 1 | PASS |

### replace-sqlite-with-json-bookmarks
**Task**: Replace tauri-plugin-sql with a JSON bookmark file
**Stage**: SIMPLIFY
**Pipeline**: code-workflow
**Branch**: task/replace-sqlite-with-json-bookmarks
**Worktree**: .worktree/replace-sqlite-with-json-bookmarks
**Base**: main
**Started**: 2026-04-25
**Attempts**: 1
**Files**:
- NEW: src-tauri/src/commands/bookmarks.rs
- MOD: src/services/database-service.ts
- MOD: src/services/__tests__/database-service.test.ts
- MOD: src-tauri/src/commands/mod.rs
- MOD: src-tauri/src/lib.rs
- MOD: src-tauri/Cargo.toml
- MOD: package.json
- MOD: src-tauri/capabilities/default.json
- MOD: src-tauri/tauri.conf.json
**Quality Scores**:
| Stage | Score | Attempts | Status |
|-------|-------|----------|--------|
| IMPLEMENT | 9.25 | 1 | PASS |
| WRITE-TESTS | 9.35 | 1 | PASS |
| QUALITY-CHECK | 9.2 | 1 | PASS |
| SIMPLIFY | - | 0 | CURRENT |


### add-pipeline-mode-tags-manual-reggie-system-and-debug
**Task**: Introduce [manual], [reggie-system], and [debug] pipeline-mode tags
**Stage**: IMPLEMENT
**Pipeline**: code-workflow
**Branch**: task/add-pipeline-mode-tags-manual-reggie-system-and-debug
**Worktree**: .worktree/add-pipeline-mode-tags-manual-reggie-system-and-debug
**Base**: main
**Started**: 2026-04-25
**Attempts**: 1
**Files**:
- MOD: resources/commands/reggie-init-tasks.md
- MOD: resources/agents/reggie-code-architect.md
- MOD: resources/agents/reggie-code-manager.md
- MOD: resources/commands/reggie-code-workflow.md
- MOD: resources/commands/reggie-system-change.md
- MOD: resources/agents/reggie-system-change-manager.md
- MOD: resources/commands/reggie-debug-workflow.md
- MOD: resources/agents/reggie-debug-manager.md
- NEW: resources/commands/reggie-manual-task.md
**Quality Scores**:
| Stage | Score | Attempts | Status |
|-------|-------|----------|--------|
| IMPLEMENT | - | 0 | CURRENT |

### settings-panel-dead-state
**Task**: Wire reinstall state reset and remove dead state in SettingsPanel
**Stage**: IMPLEMENT
**Pipeline**: code-workflow
**Branch**: task/settings-panel-dead-state
**Worktree**: .worktree/settings-panel-dead-state
**Base**: main
**Started**: 2026-04-25
**Attempts**: 1
**Files**:
- MOD: src/components/ActivityBar/SettingsPanel.tsx
- MOD: src/components/ActivityBar/__tests__/SettingsPanel.test.tsx
**Quality Scores**:
| Stage | Score | Attempts | Status |
|-------|-------|----------|--------|
| IMPLEMENT | - | 0 | CURRENT |

---

## Backlog

### v2.0.0 Release

(all v2.0.0 release tasks complete or in progress)

### Pipeline System Expansion

- [ ] wire-manual-reggie-system-and-debug-tags-runtime: Wire [manual], [reggie-system], and [debug] tags into Rust parser and UI [P1] [depends: add-pipeline-mode-tags-manual-reggie-system-and-debug] [conflicts: fix-clippy-projects-rs, attach-images-to-ungroomed-tasks, kill-button-completed-items, replace-sqlite-with-json-bookmarks] [complex] [tier: opus:high] [code] [planned]
  files: src-tauri/src/commands/projects.rs (MOD), src/types/terminal.ts (MOD), src/components/WorkspaceOverview/CodeWorkflowTab.tsx (MOD), src/components/WorkspaceOverview/RepoTaskRow.tsx (MOD)

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
