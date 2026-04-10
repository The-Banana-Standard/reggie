# Tasks

## Active Tasks

### prefix-rename-agents
**Task**: Rename all 36 agent files to reggie- prefix, shorten pipeline manager names, add manager: frontmatter
**Stage**: COMMIT
**Pipeline**: code-workflow
**Branch**: task/prefix-rename-agents
**Worktree**: .worktree/prefix-rename-agents
**Base**: release/v1.1.2
**Started**: 2026-04-10
**Attempts**: 0
**Files**:
- MOD: agents/*.md (36 RENAME+MOD)
- MOD: commands/*.md (35 MOD)
- MOD: docs/*.md, REGGIE.md, README.md
- MOD: reggie_data.rs
**Quality Scores**:
| Stage | Score | Attempts | Status |
|-------|-------|----------|--------|
| IMPLEMENT | 9.26 | 2 | PASS |
| WRITE-TESTS | SKIP | 0 | SKIP |
| QUALITY-CHECK | SKIP | 0 | SKIP |
| SIMPLIFY | 9.0+ | 2 | PASS |
| VERIFY-APP | SKIP | 0 | SKIP |
| REVIEW | 9.24 | 1 | PASS |
| SECURITY-REVIEW | SKIP | 0 | SKIP |
| SYNC-DOCS | 9.0+ | 1 | PASS |
| UPDATE-CLAUDE | SKIP | 0 | SKIP |
| REVIEW-WITH-USER | APPROVED | 0 | PASS |

---

## Backlog

### Agent System Restructuring
- [ ] reorganize-reggie-repo: Move agents/commands/hooks into resources/, remove install scripts [P1] [depends: prefix-rename-agents] [moderate] [tier: opus:medium] [code] [planned]
  files: agents/ (MOV), commands/ (MOV), hooks/ (MOV), docs/ (MOV), registries (MOV), install scripts (DEL), .gitignore (MOD)

### App Integration
- [ ] integrate-app-code: Copy forge-reggie Tauri app into reggie repo, verify build [P1] [depends: reorganize-reggie-repo] [conflicts: reorganize-reggie-repo] [moderate] [tier: opus:medium] [code] [planned]
  files: src-tauri/ (NEW), src/ (NEW), package.json (NEW), configs (NEW), .gitignore (MOD)
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

---
