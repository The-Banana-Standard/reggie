# Tasks

## Active Tasks

### code-split-main-bundle
**Task**: Split 773kB main JS chunk via Vite manualChunks
**Stage**: SIMPLIFY
**Pipeline**: code-workflow
**Branch**: task/code-split-main-bundle
**Worktree**: .worktree/code-split-main-bundle
**Base**: release/v1.1.2
**Started**: 2026-04-12
**Attempts**: 1
**Files**:
- MOD: vite.config.ts
**Quality Scores**:
| Stage | Score | Attempts | Status |
|-------|-------|----------|--------|
| IMPLEMENT | 9.2 | 1 | PASS |
| WRITE-TESTS | SKIP | - | SKIP |
| QUALITY-CHECK | SKIP | - | SKIP |
| SIMPLIFY | 9.5 | 1 | PASS |
| VERIFY-APP | - | 0 | CURRENT |

### update-docs-tauri-rebrand
**Task**: Rewrite README + docs to reflect Reggie as Tauri app with bundled subagent system
**Stage**: IMPLEMENT
**Pipeline**: code-workflow
**Branch**: task/update-docs-tauri-rebrand
**Worktree**: .worktree/update-docs-tauri-rebrand
**Base**: release/v1.1.2
**Started**: 2026-04-12
**Attempts**: 1
**Mode**: --yes
**Tier**: opus:high
**Files**:
- MOD: README.md
- MOD: CONTRIBUTING.md
- MOD: CHANGELOG.md
- MOD: SECURITY.md
- MOD: resources/commands/reggie-guide.md
- MOD: resources/docs/PORTABLE-PACKAGE.md
- MOD: docs/open-source-release-checklist.md
**Quality Scores**:
| Stage | Score | Attempts | Status |
|-------|-------|----------|--------|
| IMPLEMENT | - | 0 | CURRENT |

### cleanup-orphan-logo-assets
**Task**: Delete unreferenced `reggie-logo-2.png` and `logo.svg` from repo root
**Stage**: IMPLEMENT
**Pipeline**: code-workflow
**Branch**: task/cleanup-orphan-logo-assets
**Worktree**: .worktree/cleanup-orphan-logo-assets
**Base**: release/v1.1.2
**Started**: 2026-04-12
**Attempts**: 1
**Files**:
- DEL: reggie-logo-2.png
- DEL: logo.svg
**Quality Scores**:
| Stage | Score | Attempts | Status |
|-------|-------|----------|--------|
| IMPLEMENT | - | 0 | CURRENT |

---

## Backlog

### Documentation & Repo Hygiene

### Testing & Build Quality

_(none)_
