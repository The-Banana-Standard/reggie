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
| IMPLEMENT | 9.1 | 1 | PASS |
| WRITE-TESTS | 9.1 | 2 | PASS |
| QUALITY-CHECK | 9.2 | 1 | PASS |
| SIMPLIFY | 9.4 | 1 | PASS |
| VERIFY-APP | SKIP | 0 | SKIP |
| REVIEW | 9.2 | 1 | PASS |
| SECURITY-REVIEW | - | 0 | CURRENT |
| SYNC-DOCS | - | 0 | - |
| UPDATE-CLAUDE | - | 0 | - |
| REVIEW-WITH-USER | - | 0 | - |

---

## Backlog

### Documentation & Config Accuracy

- [ ] sync-capability-manifest: Sync capability-manifest.yaml community_skills count with skills-registry.yaml [P2] [simple] [code] [planned]
  files: capability-manifest.yaml (MOD)
