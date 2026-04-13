# Tasks

## Active Tasks

### code-split-main-bundle
**Task**: Split 773kB main JS chunk via Vite manualChunks
**Stage**: IMPLEMENT
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
| IMPLEMENT | - | 0 | CURRENT |

### fix-useterminal-headless-test
**Task**: Rewrite broken promoted-tabs test to use correct code path
**Stage**: QUALITY-CHECK
**Pipeline**: code-workflow
**Branch**: task/fix-useterminal-headless-test
**Worktree**: .worktree/fix-useterminal-headless-test
**Base**: release/v1.1.2
**Started**: 2026-04-12
**Attempts**: 1
**Files**:
- MOD: src/hooks/__tests__/useTerminal.test.ts
**Quality Scores**:
| Stage | Score | Attempts | Status |
|-------|-------|----------|--------|
| IMPLEMENT | 9.3 | 1 | PASS |
| WRITE-TESTS | - | 0 | SKIP |
| QUALITY-CHECK | - | 0 | CURRENT |

### fix-tauri-contract-test
**Task**: Add missing installer commands to contract test RUST_COMMANDS map
**Stage**: IMPLEMENT
**Pipeline**: code-workflow
**Branch**: task/fix-tauri-contract-test
**Worktree**: .worktree/fix-tauri-contract-test
**Base**: release/v1.1.2
**Started**: 2026-04-12
**Attempts**: 1
**Files**:
- MOD: src/__tests__/tauri-contract.test.ts
**Quality Scores**:
| Stage | Score | Attempts | Status |
|-------|-------|----------|--------|
| IMPLEMENT | - | 0 | CURRENT |

---

## Backlog

### Documentation & Repo Hygiene
- [ ] update-docs-tauri-rebrand: Rewrite README + docs to reflect Reggie as Tauri app with bundled subagent system [P1] [complex] [tier: opus:high] [code] [planned]
  files: README.md (MOD), CONTRIBUTING.md (MOD), CHANGELOG.md (MOD), SECURITY.md (MOD), resources/commands/reggie-guide.md (MOD), resources/docs/PORTABLE-PACKAGE.md (MOD), docs/open-source-release-checklist.md (MOD)
- [ ] cleanup-orphan-logo-assets: Delete unreferenced `reggie-logo-2.png` and `logo.svg` from repo root [P3] [simple] [tier: sonnet:medium] [code] [planned]
  files: reggie-logo-2.png (DEL), logo.svg (DEL)

### Testing & Build Quality
- [ ] code-split-main-bundle: Split 773kB main JS chunk via Vite manualChunks [P3] [simple] [tier: sonnet:medium] [code] [planned]
  files: vite.config.ts (MOD)
