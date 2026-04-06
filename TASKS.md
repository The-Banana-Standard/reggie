# Tasks

## Active Tasks

### rework-install-and-namespace
**Task**: Make install additive + prefix all Reggie commands with reggie-
**Stage**: IMPLEMENT
**Pipeline**: code-workflow
**Branch**: task/rework-install-and-namespace
**Worktree**: .worktree/rework-install-and-namespace
**Base**: release/v1.1.2
**Started**: 2026-04-06
**Attempts**: 1
**Files**:
- RENAME: 33 command files (add reggie- prefix)
- RENAME: evaluate-reggie.md → reggie-evaluation-system.md
- MOD: ~71 files (internal slash-command references)
- MOD: install.sh, install.ps1 (per-file symlinks)
- MOD: uninstall.sh, uninstall.ps1 (per-file removal)
- MOD: README.md, REGGIE.md, docs/*
**Quality Scores**:
| Stage | Score | Attempts | Status |
|-------|-------|----------|--------|
| IMPLEMENT | - | 0 | CURRENT |

---

## Backlog

