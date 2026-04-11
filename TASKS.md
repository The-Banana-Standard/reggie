# Tasks

## Active Tasks

### add-management-ui
**Task**: Settings panel in ActivityBar with version info, reinstall, environment setup
**Stage**: IMPLEMENT
**Pipeline**: code-workflow
**Branch**: task/add-management-ui
**Worktree**: .worktree/add-management-ui
**Base**: release/v1.1.2
**Started**: 2026-04-11
**Attempts**: 0
**Files**:
- NEW: src/components/ActivityBar/SettingsPanel.tsx
- MOD: src/components/ActivityBar/ActivityBar.tsx
- MOD: src-tauri/src/commands/mod.rs
- MOD: src-tauri/src/installer.rs
- MOD: src/styles/globals.css
**Quality Scores**:
| Stage | Score | Attempts | Status |
|-------|-------|----------|--------|
| IMPLEMENT | - | 0 | CURRENT |
| WRITE-TESTS | - | 0 | - |
| QUALITY-CHECK | - | 0 | - |
| SIMPLIFY | - | 0 | - |
| VERIFY-APP | - | 0 | - |
| REVIEW | - | 0 | - |
| SECURITY-REVIEW | - | 0 | - |
| SYNC-DOCS | - | 0 | - |
| UPDATE-CLAUDE | - | 0 | - |
| REVIEW-WITH-USER | - | 0 | - |

---

## Backlog

### Resource Bundling & Installation

### Ungroomed
- [ ] update-forge-reggie-data: Update forge-reggie reggie_data.rs to use manager: frontmatter lookup instead of find_matching_manager heuristic [P2]
  > Discovered during prefix-rename-agents. The Forge app in forge-reggie/src-tauri/src/commands/reggie_data.rs still uses substring heuristics to match pipeline commands to managers. Now that commands have manager: frontmatter, Forge should parse that field directly.
- [ ] consolidate-frontmatter-parsing: Consolidate duplicate YAML frontmatter parsing in reggie_data.rs and skills.rs into shared utility [P3]
  > Discovered during bundle-resources-in-app IMPLEMENT. reggie_data.rs has extract_frontmatter and skills.rs has skip_yaml_frontmatter — slightly different functions doing the same job.
---
