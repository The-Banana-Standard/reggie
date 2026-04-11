# Tasks

## Active Tasks

### bundle-resources-in-app
**Task**: Configure Tauri to bundle resources/ and add Rust path resolver
**Stage**: QUALITY-CHECK
**Pipeline**: code-workflow
**Branch**: task/bundle-resources-in-app
**Worktree**: .worktree/bundle-resources-in-app
**Base**: release/v1.1.2
**Started**: 2026-04-10
**Attempts**: 1
**Files**:
- MOD: src-tauri/tauri.conf.json
- NEW: src-tauri/src/commands/resources.rs
- MOD: src-tauri/src/commands/mod.rs
**Quality Scores**:
| Stage | Score | Attempts | Status |
|-------|-------|----------|--------|
| IMPLEMENT | 9.35 | 2 | PASS |
| WRITE-TESTS | 9.30 | 1 | PASS |
| QUALITY-CHECK | - | 0 | CURRENT |
| SIMPLIFY | - | 0 | - |
| VERIFY-APP | - | 0 | - |
| REVIEW | - | 0 | - |
| SECURITY-REVIEW | - | 0 | - |
| SYNC-DOCS | - | 0 | - |
| REVIEW-WITH-USER | - | 0 | - |

---

## Backlog

### App Integration
- [ ] merge-ci-workflows: Consolidate CI into ci.yml + release.yml with yamllint and dependency-review jobs [P2] [depends: integrate-app-code] [simple] [tier: sonnet:medium] [code] [planned]
  files: .github/workflows/ (NEW+DEL)

### Resource Bundling & Installation
- [ ] reggie-installer: Rust install lifecycle — copy/symlink to ~/.claude/, version tracking, settings merge, first-launch setup UI [P1] [depends: bundle-resources-in-app, rename-app-to-reggie] [complex] [tier: opus:high] [code] [planned]
  files: installer.rs (NEW), lib.rs (MOD), mod.rs (MOD), FirstLaunchSetup.tsx (NEW), App.tsx (MOD)
- [ ] add-management-ui: Settings panel in ActivityBar with version info, reinstall, environment setup [P2] [depends: reggie-installer] [moderate] [tier: opus:medium] [code] [planned]
  files: SettingsPanel.tsx (NEW), ActivityBar.tsx (MOD), mod.rs (MOD), installer.rs (MOD), globals.css (MOD)

### Ungroomed
- [ ] update-forge-reggie-data: Update forge-reggie reggie_data.rs to use manager: frontmatter lookup instead of find_matching_manager heuristic [P2]
  > Discovered during prefix-rename-agents. The Forge app in forge-reggie/src-tauri/src/commands/reggie_data.rs still uses substring heuristics to match pipeline commands to managers. Now that commands have manager: frontmatter, Forge should parse that field directly.
- [ ] consolidate-frontmatter-parsing: Consolidate duplicate YAML frontmatter parsing in reggie_data.rs and skills.rs into shared utility [P3]
  > Discovered during bundle-resources-in-app IMPLEMENT. reggie_data.rs has extract_frontmatter and skills.rs has skip_yaml_frontmatter — slightly different functions doing the same job.
---
