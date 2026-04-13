# Tasks

## Active Tasks

### brand-reggie-with-pixel-logo
**Task**: Replace placeholder icons and add in-app branding using reggie-logo-2.png
**Stage**: SYNC-DOCS
**Pipeline**: code-workflow
**Branch**: task/brand-reggie-with-pixel-logo
**Worktree**: .worktree/brand-reggie-with-pixel-logo
**Base**: release/v1.1.2
**Started**: 2026-04-12
**Attempts**: 1
**Files**:
- KEEP: reggie-logo-2.png
- NEW: public/reggie-logo.png
- MOD: src-tauri/icons/32x32.png
- MOD: src-tauri/icons/128x128.png
- MOD: src-tauri/icons/128x128@2x.png
- MOD: src-tauri/icons/icon.icns
- MOD: src-tauri/icons/icon.ico
- DEL: src-tauri/icons/reggie-logo.svg
- MOD: index.html
- MOD: src/components/Sidebar/Sidebar.tsx
- MOD: src/styles/globals.css
**Quality Scores**:
| Stage | Score | Attempts | Status |
|-------|-------|----------|--------|
| IMPLEMENT | 9.4 | 1 | PASS |
| WRITE-TESTS | 9.4 | 1 | PASS |
| QUALITY-CHECK | 9.3 | 1 | PASS |
| SIMPLIFY | 9.2 | 1 | PASS |
| VERIFY-APP | 9.5 | 1 | PASS |
| REVIEW | 9.3 | 1 | PASS |
| SECURITY-REVIEW | 9.5 | 1 | PASS |
| SYNC-DOCS | - | 0 | CURRENT |

---

## Backlog

### Ungroomed
- [ ] fix-tauri-contract-test: `src/__tests__/tauri-contract.test.ts` fails — 6 TS invoke commands have no Rust counterparts (`get_install_status`, `get_detailed_install_status`, `get_shell_export_line`, `force_reinstall`, `add_to_shell_profile`, `complete_setup`). Contract test correctly flags drift — either remove the unused invoke sites or restore the Rust handlers. [P2] [needs-grooming]
- [ ] fix-useterminal-headless-test: `src/hooks/__tests__/useTerminal.test.ts:1644` — `headless status listener updates promoted tabs` expects `promotedHeadlessIds.size === 2`, receives `0`. Pre-existing broken test unrelated to branding work. [P3] [needs-grooming]
- [ ] code-split-main-bundle: `vite build` emits chunk-size warning — `index-*.js` is 773kB. Candidate for dynamic import / manual chunks split. [P3] [needs-grooming]
- [ ] cleanup-orphan-logo-assets: Two unreferenced logo files tracked at repo root — `reggie-logo.png` (1024x1024 legacy) and `logo.svg` (1420 bytes, no longer referenced by `index.html`). Decide whether to delete or document. [P3] [needs-grooming]

---
