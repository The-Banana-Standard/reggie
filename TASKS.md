# Tasks

## Active Tasks

### general-cleanup
**Task**: Clean up stale files, counts, and references across the repo
**Stage**: IMPLEMENT
**Pipeline**: code-workflow
**Branch**: task/general-cleanup
**Worktree**: .worktree/general-cleanup
**Base**: release/v1.1.2
**Started**: 2026-04-06
**Attempts**: 1
**Files**:
- MOD: README.md
- MOD: REGGIE.md
- MOD: docs/agents-is-all-you-need.md
- MOD: docs/reggie-quickstart.md
- MOD: docs/PORTABLE-PACKAGE.md
- DEL: articles/
- DEL: .pipeline/_tmp/pre-filter-rewrite-*.bundle
**Quality Scores**:
| Stage | Score | Attempts | Status |
|-------|-------|----------|--------|
| IMPLEMENT | - | 0 | CURRENT |

---

## Backlog

### Repo Infrastructure
- [ ] rework-install-and-namespace: Make install additive + prefix all Reggie commands with reggie- [P1] [complex] [depends: general-cleanup] [tier: opus:high] [code] [planned]
  files: commands/*.md (RENAME+MOD), agents/*.md (MOD), install.sh (MOD), install.ps1 (MOD), uninstall.sh (MOD), uninstall.ps1 (MOD), docs/*.md (MOD)
