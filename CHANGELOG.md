# Changelog

All notable changes to Reggie are documented in this file.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Performance
- Split 773kB main JS bundle into four vendor chunks (`vendor-react` 192kB, `vendor-xterm` 333kB, `vendor-tauri` 16kB, `vendor-markdown` 118kB) via Vite `manualChunks`; main app chunk reduced to 112kB. Clears Vite chunk-size warning and improves browser cache reuse on app updates.

### Added
- Danger Zone in Settings: "Remove Reggie Files" uninstalls Reggie from `~/.claude/` without touching the app itself. Removes all Reggie-prefixed agents, commands, docs, registries, the stats hook, and version tracking — while preserving user-authored files, `*.local.yaml` overlays, and unrelated `settings.json` entries (a `.bak` is written before any mutation). Optional checkbox removes the `ENABLE_TOOL_SEARCH` line from the shell profile. Idempotent; next launch re-runs first-launch setup.
- Pixel-art Reggie branding: new app icon (macOS dock/`.icns`, Windows `.ico`, 32x32 hand-crafted nearest-neighbor), favicon in the Tauri webview, and logo in the sidebar header. CSS uses `image-rendering: pixelated` to keep edges crisp at any DPR.
- Built-in installer: Tauri app copies/symlinks bundled resources to `~/.claude/` on startup
- Version tracking via `~/.claude/.reggie-version` — re-installs only when bundled version is newer
- Dev mode symlinks (`cfg!(debug_assertions)`) for live editing; production mode copies files
- Settings.json merge: injects PostToolUse stats hook without clobbering existing user config
- Local overlay files: creates `mcp-registry.local.yaml` and `skills-registry.local.yaml` if missing
- First-launch setup UI: explains `ENABLE_TOOL_SEARCH=auto:5`, offers shell profile integration
- Fish shell support in shell profile export

### Changed
- Merged `forge-reggie` Tauri desktop app into `reggie` repo. Reggie is now a single Tauri v2 desktop app that bundles the 36-agent system as installable `resources/`. The `forge-reggie` repo is archived.
- Renamed all 36 agent files to `reggie-` prefix (e.g., `ios-developer.md` -> `reggie-ios-developer.md`)
- Shortened pipeline manager names from `*-pipeline-manager` to `reggie-*-manager` (e.g., `audit-pipeline-manager.md` -> `reggie-audit-manager.md`)
- Added `manager:` frontmatter to pipeline commands linking each to its pipeline manager agent
- Added `type: pipeline` frontmatter to 12 pipeline commands
- Updated cross-references across 74+ files to use new agent names
- Reorganized repo: moved agents, commands, hooks, docs, and registries into `resources/`
- Rewrote installation docs to reflect the built-in Reggie installer (replacing install.sh scripts)

### Fixed
- `/reggie-guide` "Installation & File Structure" topic: replaced a dense 5-fact paragraph with a scannable bullet list, rewrote the stale "clones the repo" / "pull the latest changes from the repo" Q&A to reflect the Tauri app install/update flow, and updated the uninstall Q&A to point at the new Settings → Danger Zone → Remove Reggie Files button. Also corrected a layout sentence that implied `~/.claude/registries/` was a subdirectory when registry YAMLs actually install to `~/.claude/` root.
- Tauri contract test now covers all 6 installer commands (`get_install_status`, `get_detailed_install_status`, `get_shell_export_line`, `force_reinstall`, `add_to_shell_profile`, `complete_setup`) — previously flagged as unknown by the contract test

### Removed
- Deleted install.sh, install.ps1, uninstall.sh, uninstall.ps1 (replaced by the built-in Reggie installer)
- Deleted tests/test-installer-fixes.sh (tested deleted scripts)
- Deleted unreferenced `src-tauri/icons/reggie-logo.svg` placeholder

## [1.1.2] - 2026-03-09

### Added
- Workspace commands: `/reggie-setup-workspace-docs` and `/reggie-distribute-tasks`
- Completion markers (`~~REGGIE:DONE:command-name:status~~`) on all pipeline commands
- Pipeline enhancements for onboard and init-tasks flows

### Changed
- Onboard pipeline and command documentation updated to include HISTORY.md

## [1.1.1] - 2026-03-05

### Fixed
- Installer/uninstaller script robustness: race condition, missing hook, wrong message, incomplete cleanup
- ShellCheck and yamllint CI failures
- PORTABLE-PACKAGE.md accuracy: tool tables, haiku model removal, dead command references

### Changed
- Onboard and new-repo flows reference `/init-tasks`
- Capability manifest community_skills count synced with skills-registry.yaml
- Install instructions bumped to v1.1.1

## [1.1.0] - 2026-03-04

Initial public release.

### Added
- 36 specialized agents across development, quality, research, design, and content
- 35 slash commands for pipelines, stages, and utilities
- Pipeline architecture with quality gates (9.0/10 threshold)
- Git worktree isolation for parallel task execution
- Persistent agent memory (system-level and project-level)
- MCP tool management with three-layer routing
- Capability manifest for plugin/skill awareness
- Self-improvement loop with agent learnings
- Per-file symlink installer for macOS, Linux, and Windows

[Unreleased]: https://github.com/The-Banana-Standard/reggie/compare/v1.1.2...HEAD
[1.1.2]: https://github.com/The-Banana-Standard/reggie/compare/v1.1.1...v1.1.2
[1.1.1]: https://github.com/The-Banana-Standard/reggie/compare/v1.1.0...v1.1.1
[1.1.0]: https://github.com/The-Banana-Standard/reggie/releases/tag/v1.1.0
