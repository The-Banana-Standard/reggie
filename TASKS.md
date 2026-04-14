# Tasks

## Active Tasks

### add-reggie-uninstaller
**Task**: Build in-app "Remove Reggie Files" Danger Zone (Rust command + React modal + tests)
**Stage**: WRITE-TESTS
**Pipeline**: code-workflow (--yes)
**Branch**: task/add-reggie-uninstaller
**Worktree**: .worktree/add-reggie-uninstaller
**Base**: release/v1.1.2
**Started**: 2026-04-14
**Attempts**: 1
**Files**:
- MOD: src-tauri/src/installer.rs
- MOD: src-tauri/src/lib.rs
- MOD: src/components/ActivityBar/SettingsPanel.tsx
- NEW: src/components/ActivityBar/__tests__/SettingsPanel.test.tsx
- MOD: src/styles/globals.css
**Quality Scores**:
| Stage | Score | Attempts | Status |
|-------|-------|----------|--------|
| IMPLEMENT | 9.4 | 1 | PASS |
| WRITE-TESTS | - | 0 | CURRENT |

---

## Backlog

### v2.0.0 Release

- [ ] fix-reggie-guide-installation-topic: Fix 4 targeted inaccuracies in reggie-guide.md Installation topic (paragraph-to-bullets, clone→bundled-resources rewrite, git-pull→app-download rewrite, uninstall Q&A pointing at new Danger Zone) [P1] [moderate] [tier: opus:medium] [code] [planned] [depends: add-reggie-uninstaller]
  files: resources/commands/reggie-guide.md

- [ ] prepare-v2.0.0-release: Bump all 3 version manifests to 2.0.0, pivot README/REGGIE/CONTRIBUTING framing to "notes → groom → code" paradigm, rename bundle id to xyz.thebananastandard.reggie, cut CHANGELOG with Breaking section + narrative intro, verify npm+cargo builds [P1] [complex] [tier: opus:high] [code] [planned] [depends: audit-portable-package-accuracy, add-reggie-uninstaller, fix-reggie-guide-installation-topic]
  files: package.json, src-tauri/tauri.conf.json, src-tauri/Cargo.toml, README.md, resources/docs/REGGIE.md, CONTRIBUTING.md, CHANGELOG.md

### Ungroomed

- [ ] replace-sqlite-with-json-bookmarks: Investigate replacing tauri-plugin-sql + database-service.ts with a single JSON bookmark file; DB only holds ~20 folder bookmarks with no JOINs or aggregations
  > context: 3-table schema (projects, workspaces, all_projects), 175 lines of TS, tauri-plugin-sql Rust crate dep, all queries are single-table CRUD by id; serde JSON file in app_data_dir would replace everything with ~40 lines of code
