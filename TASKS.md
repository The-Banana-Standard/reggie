# Tasks

## Active Tasks

### fix-installer-scripts
**Task**: Fix installer/uninstaller script issues (race condition, missing hook, wrong message, incomplete cleanup)
**Stage**: IMPLEMENT
**Pipeline**: code-workflow
**Branch**: task/fix-installer-scripts
**Worktree**: .worktree/fix-installer-scripts
**Base**: main
**Started**: 2026-03-05
**Attempts**: 1
**Files**:
- MOD: install.sh
- MOD: install.ps1
- MOD: hooks/track-stats.sh
- MOD: uninstall.sh
- MOD: uninstall.ps1
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

### Documentation & Config Accuracy

- [ ] fix-portable-package-docs: Fix documentation accuracy in PORTABLE-PACKAGE.md (tool tables, haiku removal, dead command refs) [P2] [simple] [code] [planned]
  files: docs/PORTABLE-PACKAGE.md (MOD)
- [ ] sync-capability-manifest: Sync capability-manifest.yaml community_skills count with skills-registry.yaml [P2] [simple] [code] [planned]
  files: capability-manifest.yaml (MOD)
