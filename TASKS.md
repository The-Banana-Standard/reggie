# Tasks

## Active Tasks

### rename-app-to-reggie
**Task**: Rename app from Forge to Reggie across all configs, source, and tests
**Stage**: COMMIT
**Pipeline**: code-workflow
**Branch**: task/rename-app-to-reggie
**Worktree**: .worktree/rename-app-to-reggie
**Base**: release/v1.1.2
**Started**: 2026-04-10
**Attempts**: 0
**Files**:
- MOD: tauri.conf.json, Cargo.toml, package.json, index.html, 6 source files, 5 test files
**Quality Scores**:
| Stage | Score | Attempts | Status |
|-------|-------|----------|--------|
| IMPLEMENT | 9.66 | 1 | PASS |
| SIMPLIFY | SKIP | 0 | SKIP |
| VERIFY-APP | 9.0+ | 1 | PASS |
| REVIEW | 9.5 | 1 | PASS |
| REVIEW-WITH-USER | APPROVED | 0 | PASS |

---

## Backlog

### App Integration
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
