# Tasks

## Active Tasks

### consolidate-frontmatter-parsing
**Task**: Consolidate duplicate YAML frontmatter parsing into shared utility
**Stage**: SECURITY-REVIEW
**Pipeline**: code-workflow
**Branch**: task/consolidate-frontmatter-parsing
**Worktree**: .worktree/consolidate-frontmatter-parsing
**Base**: release/v1.1.2
**Started**: 2026-04-11
**Attempts**: 0
**Files**:
- NEW: src-tauri/src/commands/frontmatter.rs
- MOD: src-tauri/src/commands/mod.rs
- MOD: src-tauri/src/commands/reggie_data.rs
- MOD: src-tauri/src/commands/skills.rs
**Quality Scores**:
| Stage | Score | Attempts | Status |
|-------|-------|----------|--------|
| IMPLEMENT | 9.38 | 1 | PASS |
| WRITE-TESTS | 9.20 | 1 | PASS |
| QUALITY-CHECK | 9.28 | 1 | PASS |
| SIMPLIFY | 9.30 | 1 | PASS |
| VERIFY-APP | PASS | 1 | PASS |
| REVIEW | 9.12 | 2 | PASS |
| SECURITY-REVIEW | - | 0 | CURRENT |
| SYNC-DOCS | - | 0 | - |
| UPDATE-CLAUDE | - | 0 | - |
| REVIEW-WITH-USER | - | 0 | - |

---

## Backlog

### Reggie Data Parsing
- [ ] update-forge-reggie-data: Update reggie_data.rs to use manager: frontmatter lookup [P2] [depends: consolidate-frontmatter-parsing] [conflicts: consolidate-frontmatter-parsing] [simple] [tier: sonnet:medium] [code] [planned]
  files: src-tauri/src/commands/reggie_data.rs (MOD)
---
