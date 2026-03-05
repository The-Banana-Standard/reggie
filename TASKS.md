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

### sync-capability-manifest
**Task**: Sync capability-manifest.yaml community_skills count with skills-registry.yaml
**Stage**: IMPLEMENT
**Pipeline**: code-workflow
**Branch**: task/sync-capability-manifest
**Worktree**: .worktree/sync-capability-manifest
**Base**: main
**Started**: 2026-03-05
**Attempts**: 1
**Files**:
- MOD: capability-manifest.yaml
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
