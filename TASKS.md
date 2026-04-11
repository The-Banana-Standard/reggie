# Tasks

## Active Tasks

### reggie-installer
**Task**: Rust install lifecycle — copy/symlink to ~/.claude/, version tracking, settings merge, first-launch setup UI
**Stage**: SYNC-DOCS
**Pipeline**: code-workflow
**Branch**: task/reggie-installer
**Worktree**: .worktree/reggie-installer
**Base**: release/v1.1.2
**Started**: 2026-04-11
**Attempts**: 0
**Files**:
- NEW: src-tauri/src/installer.rs
- MOD: src-tauri/src/lib.rs
- MOD: src-tauri/src/commands/mod.rs
- NEW: src/components/Setup/FirstLaunchSetup.tsx
- MOD: src/App.tsx
**Quality Scores**:
| Stage | Score | Attempts | Status |
|-------|-------|----------|--------|
| IMPLEMENT | 9.25 | 1 | PASS |
| WRITE-TESTS | 9.35 | 1 | PASS |
| QUALITY-CHECK | 9.0 | 1 | PASS |
| SIMPLIFY | 9.4 | 1 | PASS |
| VERIFY-APP | 9.5 | 1 | PASS |
| REVIEW | 9.0 | 2 | PASS |
| SECURITY-REVIEW | 9.3 | 1 | PASS |
| SYNC-DOCS | - | 0 | CURRENT |
| UPDATE-CLAUDE | - | 0 | - |
| REVIEW-WITH-USER | - | 0 | - |

---

## Backlog

### App Integration
- [ ] merge-ci-workflows: Consolidate CI into ci.yml + release.yml with yamllint and dependency-review jobs [P2] [depends: integrate-app-code] [simple] [tier: sonnet:medium] [code] [planned]
  files: .github/workflows/ (NEW+DEL)

### Resource Bundling & Installation
- [ ] add-management-ui: Settings panel in ActivityBar with version info, reinstall, environment setup [P2] [depends: reggie-installer] [moderate] [tier: opus:medium] [code] [planned]
  files: SettingsPanel.tsx (NEW), ActivityBar.tsx (MOD), mod.rs (MOD), installer.rs (MOD), globals.css (MOD)

### Ungroomed
- [ ] update-forge-reggie-data: Update forge-reggie reggie_data.rs to use manager: frontmatter lookup instead of find_matching_manager heuristic [P2]
  > Discovered during prefix-rename-agents. The Forge app in forge-reggie/src-tauri/src/commands/reggie_data.rs still uses substring heuristics to match pipeline commands to managers. Now that commands have manager: frontmatter, Forge should parse that field directly.
- [ ] consolidate-frontmatter-parsing: Consolidate duplicate YAML frontmatter parsing in reggie_data.rs and skills.rs into shared utility [P3]
  > Discovered during bundle-resources-in-app IMPLEMENT. reggie_data.rs has extract_frontmatter and skills.rs has skip_yaml_frontmatter — slightly different functions doing the same job.
---
