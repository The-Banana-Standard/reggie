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
| QUALITY-CHECK | - | 0 | CURRENT |
| SIMPLIFY | - | 0 | - |
| VERIFY-APP | - | 0 | - |
| REVIEW | - | 0 | - |
| SECURITY-REVIEW | - | 0 | - |
| SYNC-DOCS | - | 0 | - |
| UPDATE-CLAUDE | - | 0 | - |
| REVIEW-WITH-USER | - | 0 | - |

### fix-portable-package-docs
**Task**: Fix documentation accuracy in PORTABLE-PACKAGE.md (tool tables, haiku removal, dead command refs)
**Stage**: REVIEW
**Pipeline**: code-workflow
**Branch**: task/fix-portable-package-docs
**Worktree**: .worktree/fix-portable-package-docs
**Base**: main
**Started**: 2026-03-05
**Attempts**: 1
**Files**:
- MOD: docs/PORTABLE-PACKAGE.md
**Quality Scores**:
| Stage | Score | Attempts | Status |
|-------|-------|----------|--------|
| IMPLEMENT | 9.3 | 1 | PASS |
| WRITE-TESTS | - | 0 | SKIP |
| QUALITY-CHECK | - | 0 | SKIP |
| SIMPLIFY | - | 0 | SKIP |
| VERIFY-APP | - | 0 | SKIP |
| REVIEW | - | 0 | CURRENT |
| SECURITY-REVIEW | - | 0 | - |
| SYNC-DOCS | - | 0 | - |
| UPDATE-CLAUDE | - | 0 | - |
| REVIEW-WITH-USER | - | 0 | - |

---

## Backlog

### Documentation & Config Accuracy

- [ ] sync-capability-manifest: Sync capability-manifest.yaml community_skills count with skills-registry.yaml [P2] [simple] [code] [planned]
  files: capability-manifest.yaml (MOD)
