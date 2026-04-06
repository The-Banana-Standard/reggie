# Tasks

## Active Tasks

### general-cleanup
**Task**: Clean up stale files, counts, and references across the repo
**Stage**: REVIEW
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
- MOD: commands/reggie-guide.md
- MOD: commands/code-workflow.md
- MOD: commands/init-tasks.md
- MOD: agents/pipeline-manager.md
- MOD: agents/judge.md
- MOD: agents/thought-partner.md
- NEW: agents/rust-developer.md
- DEL: agents/feature-analyzer.md
- DEL: agents/port-pipeline-manager.md
- DEL: commands/design-workflow.md
- DEL: commands/implement.md
- DEL: commands/port.md
- DEL: articles/ (untracked)
- DEL: .pipeline/_tmp/ bundle (untracked)
**Quality Scores**:
| Stage | Score | Attempts | Status |
|-------|-------|----------|--------|
| IMPLEMENT | 9.24 | 2 | PASS |
| WRITE-TESTS | SKIP | - | SKIP |
| QUALITY-CHECK | SKIP | - | SKIP |
| SIMPLIFY | SKIP | - | SKIP |
| VERIFY-APP | SKIP | - | SKIP |
| REVIEW | - | 0 | CURRENT |

---

## Backlog

### Repo Infrastructure
- [ ] rework-install-and-namespace: Make install additive + prefix all Reggie commands with reggie- [P1] [complex] [depends: general-cleanup] [tier: opus:high] [code] [planned]
  files: commands/*.md (RENAME+MOD), agents/*.md (MOD), install.sh (MOD), install.ps1 (MOD), uninstall.sh (MOD), uninstall.ps1 (MOD), docs/*.md (MOD)
