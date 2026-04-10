# Tasks

## Active Tasks

### integrate-app-code
**Task**: Copy forge-reggie Tauri app into reggie repo, verify build
**Stage**: REVIEW
**Pipeline**: code-workflow
**Branch**: task/integrate-app-code
**Worktree**: .worktree/integrate-app-code
**Base**: release/v1.1.2
**Started**: 2026-04-10
**Attempts**: 0
**Files**:
- NEW: src-tauri/, src/, package.json, configs
- MOD: .gitignore
**Quality Scores**:
| Stage | Score | Attempts | Status |
|-------|-------|----------|--------|
| IMPLEMENT | 9.39 | 1 | PASS |
| WRITE-TESTS | SKIP | 0 | SKIP |
| QUALITY-CHECK | SKIP | 0 | SKIP |
| SIMPLIFY | SKIP | 0 | SKIP |
| VERIFY-APP | 9.0+ | 1 | PASS |
| REVIEW | - | 0 | CURRENT |
| SECURITY-REVIEW | SKIP | 0 | SKIP |
| SYNC-DOCS | SKIP | 0 | SKIP |
| UPDATE-CLAUDE | - | 0 | - |
| REVIEW-WITH-USER | - | 0 | - |

---

## Backlog

### App Integration
- [ ] rename-app-to-reggie: Rename app from Forge to Reggie across all configs, source, and tests [P1] [depends: integrate-app-code] [conflicts: bundle-resources-in-app] [moderate] [tier: opus:medium] [code] [planned]
  files: tauri.conf.json (MOD), Cargo.toml (MOD), package.json (MOD), index.html (MOD), 6 source files (MOD), 5 test files (MOD)
- [ ] merge-ci-workflows: Consolidate CI into ci.yml + release.yml with yamllint and dependency-review jobs [P2] [depends: integrate-app-code] [simple] [tier: sonnet:medium] [code] [planned]
  files: .github/workflows/ (NEW+DEL)

### Resource Bundling & Installation
- [ ] bundle-resources-in-app: Configure Tauri to bundle resources/ and add Rust path resolver [P1] [depends: reorganize-reggie-repo, integrate-app-code] [conflicts: rename-app-to-reggie] [moderate] [tier: opus:medium] [code] [planned]
  files: tauri.conf.json (MOD), resources.rs (NEW), mod.rs (MOD)
- [ ] reggie-installer: Rust install lifecycle — copy/symlink to ~/.claude/, version tracking, settings merge, first-launch setup UI [P1] [depends: bundle-resources-in-app, rename-app-to-reggie] [complex] [tier: opus:high] [code] [planned]
  files: installer.rs (NEW), lib.rs (MOD), mod.rs (MOD), FirstLaunchSetup.tsx (NEW), App.tsx (MOD)
- [ ] add-management-ui: Settings panel in ActivityBar with version info, reinstall, environment setup [P2] [depends: reggie-installer] [moderate] [tier: opus:medium] [code] [planned]
  files: SettingsPanel.tsx (NEW), ActivityBar.tsx (MOD), mod.rs (MOD), installer.rs (MOD), globals.css (MOD)

### Ungroomed
- [ ] update-forge-reggie-data: Update forge-reggie reggie_data.rs to use manager: frontmatter lookup instead of find_matching_manager heuristic [P2]
  > Discovered during prefix-rename-agents. The Forge app in forge-reggie/src-tauri/src/commands/reggie_data.rs still uses substring heuristics to match pipeline commands to managers. Now that commands have manager: frontmatter, Forge should parse that field directly.
---
