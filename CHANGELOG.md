# Changelog

All notable changes to Reggie are documented in this file.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Changed
- **Mode-aware task dispatch in the project summary panel.** TasksViewer (used by ProjectSummaryPanel) now respects all 5 pipeline mode tags — `[code]`, `[design]`, `[manual]`, `[reggie-system]`, `[debug]` — matching the CodeWorkflow tab's behavior. Per-mode buttons (`Walk through` for manual, `Debug` for debug, `Start` for the rest) and correct command dispatch (e.g. `[debug]` → `/reggie-debug-workflow --yes`, `[manual]` → `/reggie-manual-task`). Previously all dispatches were hardcoded to `/reggie-code-workflow`, regardless of mode.

## [2.1.0] - 2026-04-28

### Added
- **Image attachments on ungroomed tasks.** The "Add Tasks" textarea on a project's summary panel now accepts pasted or drag-dropped images (PNG, JPG, JPEG, GIF, WebP):
  - Each attached image inserts a `[Image N]` placeholder at the cursor; the image itself is held in browser memory until you submit.
  - On submit, images are written under `.reggie/attachments/<slug>-<random>/` and the new task line in `TASKS.md` gets a sibling `> attachments: [Image 1]=<path>, ...` annotation.
  - When `/reggie-init-tasks` grooms the task, RESEARCH+PLAN reads each attached image and transcribes the relevant detail into Problem, Vision, Context, and Acceptance Criteria. After FORMALIZE writes `task.md`, the attachment directory is cleaned up — images are treated as transient input, not durable artifacts.
  - INTAKE sweeps orphan attachment directories (any folder under `.reggie/attachments/` not referenced by a `> attachments:` line) at the start of the run.
  - Unsupported types (HEIC/HEIF and others) are rejected inline with a clear error.
  - Path-safety guard: `> attachments:` paths must resolve inside `.reggie/attachments/` — paths with `..`, absolute paths, or symlink escapes are skipped.
- **Mode-aware task dispatch in the CodeWorkflow tab.** Backlog tasks can carry a mode tag — `[code]`, `[design]`, `[manual]`, `[reggie-system]`, or `[debug]` — and Reggie now routes each task to the correct CLI command automatically:
  - `[code]` / `[design]` → `/reggie-code-workflow`
  - `[reggie-system]` → `/reggie-system-change`
  - `[debug]` → `/reggie-debug-workflow`
  - `[manual]` → `/reggie-manual-task`
- **Per-domain concurrency caps** enforced on "Batch Start": 5 concurrent sessions for `code`/`design`, 3 for `debug`, 1 for `reggie-system`.
- **Per-task action buttons** vary by mode: `[manual]` tasks show "Walk through", `[debug]` tasks show "Debug", all others show "Start".
- **Per-domain aggregate badges** in the CodeWorkflow tab header show live counts (e.g., "2 code running, 1 reggie-sys running").

### Changed
- Bookmarks now persist as JSON at `app_data_dir/bookmarks.json` using atomic temp+fsync+rename writes. Removed `tauri-plugin-sql` and `@tauri-apps/plugin-sql` dependencies.

### Fixed
- Completed promoted sessions in CodeWorkflowTab now show a per-session **Trash** button alongside Open/Hide, matching the headless completed session behavior. Previously the only way to clear a completed promoted session was the "Trash All Completed" header button.
- Sessions tab terminal width no longer shrinks to ~10 columns after switching to another tab and back. Previously, switching away from Sessions caused the terminal to re-render at a very narrow width, producing hard-wrapped output that could not be reflowed on return.
- Test-infra: vitest now auto-applies the Tauri mock via global `setupFiles` (no per-test import required), and the Tauri command contract test correctly recognizes `uninstall_reggie_files`. Resolves the lone failure in the test suite.

### Removed
- SQLite persistence (`tauri-plugin-sql`). The legacy `reggie.db` file in `app_data_dir` is no longer used and can be deleted manually.

### Migration
- First run of a new build: re-select your All Projects folder. The workspace scan rebuilds all projects automatically. No other data is affected.

## [2.0.1] - 2026-04-22

### Fixed
- macOS release DMGs are now code-signed and notarized. The release workflow now passes `APPLE_CERTIFICATE`, `APPLE_CERTIFICATE_PASSWORD`, `APPLE_SIGNING_IDENTITY`, `APPLE_ID`, `APPLE_PASSWORD`, and `APPLE_TEAM_ID` through to `tauri-action`, so downloaded DMGs open cleanly without Gatekeeper "damaged / cannot verify" errors.

## [2.0.0] - 2026-04-14

Reggie 2.0.0 merges the `forge-reggie` Tauri desktop app into the `reggie` repo. Reggie is now a single desktop application that bundles the 36-agent pipeline system as installable resources, with a built-in installer that replaces the legacy `install.sh` / `install.ps1` scripts. The daily driver loop — brain dump, `/reggie-init-tasks`, `/reggie-code-workflow` — is now one `npm install` + `npm run tauri build` away (or one download from Releases).

### Breaking
- **Install flow changed.** Legacy `install.sh`, `install.ps1`, `uninstall.sh`, and `uninstall.ps1` scripts are removed. To upgrade from 1.x, download the Reggie desktop app from [Releases](https://github.com/The-Banana-Standard/reggie/releases) and launch it — the built-in installer handles `~/.claude/` on first run. If you had a 1.x install via `install.sh`, the 2.0.0 app's installer updates existing files in place; no manual cleanup required.
- **Bundle identifier renamed.** `com.reggie-app.dev` → `xyz.thebananastandard.reggie`. On first launch of 2.0.0 your project sidebar will appear empty — re-add your project folders via the **Add Project** button. No other data is affected: Claude Code sessions (`~/.claude/projects/`), task history (`.pipeline/` per repo), and the bundled agent system (`~/.claude/`) are all preserved.

### Added
- **Remove Reggie Files** button in Settings → Danger Zone: full reversal of the built-in installer. Removes Reggie-prefixed files from `~/.claude/` (agents, commands, docs, registries), cleans the PostToolUse stats hook out of `settings.json` (with a `.bak` backup written before any mutation), optionally removes the `ENABLE_TOOL_SEARCH` line from the shell profile (opt-in checkbox), and deletes `.reggie-version` so next launch re-runs first-launch setup. Preserves user-authored files, `*.local.yaml` overlays, and unrelated `settings.json` entries. Idempotent.
- **Built-in installer.** The Tauri app copies (production) or symlinks (`cfg!(debug_assertions)` dev mode) bundled `resources/` to `~/.claude/` on startup. Includes:
  - Version tracking via `~/.claude/.reggie-version` — re-installs only when the bundled version is newer
  - `settings.json` merge that injects the PostToolUse stats hook without clobbering existing user config
  - Creation of `mcp-registry.local.yaml` and `skills-registry.local.yaml` overlay files if missing
  - First-launch setup UI that explains `ENABLE_TOOL_SEARCH=auto:5` and offers shell profile integration
  - Fish shell support in the shell profile export (in addition to bash/zsh)
- Pixel-art Reggie branding: new app icon (macOS `.icns`, Windows `.ico`, 32x32 hand-crafted nearest-neighbor), favicon in the Tauri webview, and logo in the sidebar header. CSS uses `image-rendering: pixelated` to keep edges crisp at any DPR.

### Changed
- Renamed all 36 agent files to `reggie-` prefix (e.g., `ios-developer.md` → `reggie-ios-developer.md`)
- Shortened pipeline manager names from `*-pipeline-manager` to `reggie-*-manager` (e.g., `audit-pipeline-manager.md` → `reggie-audit-manager.md`)
- Added `manager:` frontmatter to pipeline commands linking each to its pipeline manager agent
- Added `type: pipeline` frontmatter to 12 pipeline commands
- Updated cross-references across 74+ files to use new agent names
- Reorganized repo: moved agents, commands, hooks, docs, and registries into `resources/`
- Rewrote installation docs to reflect the built-in Reggie installer (replacing `install.sh` scripts)

### Fixed
- `/reggie-guide` "Installation & File Structure" topic: replaced a dense 5-fact paragraph with a scannable bullet list, rewrote the stale "clones the repo" / "pull the latest changes from the repo" Q&A to reflect the Tauri app install/update flow, and updated the uninstall Q&A to point at the new Settings → Danger Zone → Remove Reggie Files button. Also corrected a layout sentence that implied `~/.claude/registries/` was a subdirectory when registry YAMLs actually install to `~/.claude/` root.
- Tauri contract test now covers all 6 installer commands (`get_install_status`, `get_detailed_install_status`, `get_shell_export_line`, `force_reinstall`, `add_to_shell_profile`, `complete_setup`) — previously flagged as unknown by the contract test

### Performance
- Split 773kB main JS bundle into four vendor chunks (`vendor-react` 192kB, `vendor-xterm` 333kB, `vendor-tauri` 16kB, `vendor-markdown` 118kB) via Vite `manualChunks`; main app chunk reduced to 112kB. Clears Vite chunk-size warning and improves browser cache reuse on app updates.

### Removed
- Deleted `install.sh`, `install.ps1`, `uninstall.sh`, `uninstall.ps1` (replaced by the built-in Reggie installer)
- Deleted `tests/test-installer-fixes.sh` (tested deleted scripts)
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

[Unreleased]: https://github.com/The-Banana-Standard/reggie/compare/v2.0.0...HEAD
[2.0.0]: https://github.com/The-Banana-Standard/reggie/compare/v1.1.2...v2.0.0
[1.1.2]: https://github.com/The-Banana-Standard/reggie/compare/v1.1.1...v1.1.2
[1.1.1]: https://github.com/The-Banana-Standard/reggie/compare/v1.1.0...v1.1.1
[1.1.0]: https://github.com/The-Banana-Standard/reggie/releases/tag/v1.1.0
