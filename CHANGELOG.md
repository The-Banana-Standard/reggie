# Changelog

All notable changes to Reggie are documented in this file.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Changed
- Renamed all 36 agent files to `reggie-` prefix (e.g., `ios-developer.md` -> `reggie-ios-developer.md`)
- Shortened pipeline manager names from `pipeline-manager-*` to `reggie-*-manager` (e.g., `pipeline-manager-code.md` -> `reggie-code-manager.md`)
- Added `manager:` frontmatter to pipeline commands linking each to its pipeline manager agent
- Added `type: pipeline` frontmatter to 12 pipeline commands
- Updated cross-references across 74+ files to use new agent names

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
