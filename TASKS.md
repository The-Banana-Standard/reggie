# Tasks

## Active Tasks

### prepare-v2.0.0-release
**Task**: Cut v2.0.0 major release — version manifests, framing pivot, bundle id rename, CHANGELOG cut
**Stage**: PICKUP
**Pipeline**: code-workflow (--yes, tier: opus:high)
**Branch**: task/prepare-v2.0.0-release
**Worktree**: .worktree/prepare-v2.0.0-release
**Base**: release/v1.1.2
**Started**: 2026-04-14
**Attempts**: 1
**Files**:
- MOD: package.json
- MOD: src-tauri/tauri.conf.json
- MOD: src-tauri/Cargo.toml
- MOD: README.md
- MOD: resources/docs/REGGIE.md
- MOD: CONTRIBUTING.md
- MOD: CHANGELOG.md
**Quality Scores**:
| Stage | Score | Attempts | Status |
|-------|-------|----------|--------|
| PICKUP | - | 1 | PASS |
| IMPLEMENT | 9.4 | 1 | PASS |
| WRITE-TESTS | SKIP | - | no testable logic |
| QUALITY-CHECK | SKIP | - | no tests added |
| SIMPLIFY | SKIP | - | mechanical + prose only |
| VERIFY-APP | 9.4 | 1 | PASS |
| REVIEW | 9.05 | 1 | PASS |
| SECURITY-REVIEW | 9.19 | 1 | PASS |
| SYNC-DOCS | SKIP | - | CHANGELOG/README ARE the work |
| UPDATE-CLAUDE | SKIP | - | no learnings this run |
| REVIEW-WITH-USER | APPROVED | 1 | auto (--yes) |

## Backlog

### v2.0.0 Release

(all v2.0.0 release tasks complete or in progress)

### Ungroomed

- [ ] replace-sqlite-with-json-bookmarks: Investigate replacing tauri-plugin-sql + database-service.ts with a single JSON bookmark file; DB only holds ~20 folder bookmarks with no JOINs or aggregations
  > context: 3-table schema (projects, workspaces, all_projects), 175 lines of TS, tauri-plugin-sql Rust crate dep, all queries are single-table CRUD by id; serde JSON file in app_data_dir would replace everything with ~40 lines of code

- [ ] fix-clippy-projects-rs: Fix 7 pre-existing clippy errors in src-tauri/src/commands/projects.rs (5x unnecessary to_path_buf at L997/1004/1072/1085/1093; 2x redundant closure at L2939/2981) blocking `cargo clippy -- -D warnings`
  > context: discovered during add-reggie-uninstaller VERIFY-APP. Unrelated to that task but blocks strict clippy in CI. Straightforward cleanup.

- [ ] vitest-env-hang-investigation: Vitest hangs indefinitely at 0% CPU with zero stdout in this repo; reproduces on trivial non-React tests, independent of code under test
  > context: hit during add-reggie-uninstaller VERIFY-APP. Tried arm64 node (/Users/jacobpress/.nvm/versions/node/v22.14.0/bin/node), --pool=forks --poolOptions.forks.singleFork=true, direct node node_modules/vitest/dist/cli.js. All hang. Multiple stale vitest processes accumulate that can't be killed from inside the sandbox. Root-cause and fix — vitest is effectively unusable in this environment until resolved.

- [ ] uninstaller-ui-polish: Minor UX gaps in Remove Reggie Files modal — no Escape-key-to-close, no click-outside-overlay dismiss, trigger + confirm buttons share the same label (tests rely on brittle getAllByRole[last])
  > context: discovered in REVIEW attempt 1 of add-reggie-uninstaller. All non-blocking. Fix: add useEffect keydown listener for Escape, add aria-label="Confirm remove Reggie files" to the modal confirm button.

- [ ] uninstaller-error-visibility: remove_stats_hook_from_settings silently returns Ok(false) on malformed JSON, and list_bundled_doc_names errors are swallowed via unwrap_or_default() in the Tauri command
  > context: add an eprintln! on each silent path so users with a broken settings.json or a Tauri resource dir resolution failure can see why the uninstaller reported "nothing removed." Cosmetic only — logic is correct.

- [ ] shared-reggie-comment-const: `# Added by Reggie — enables Claude Code auto tool search` string literal is duplicated between installer.rs install (~L210) and uninstaller (~L874); extract to `const REGGIE_COMMENT: &str` so install/uninstall can't drift
  > context: flagged as nit during add-reggie-uninstaller REVIEW. One-line refactor.

- [ ] tsconfig-test-exclude: src/**/__tests__/** appears to be compiled by tsc in the default tsconfig; consider excluding tests from production type-check
  > context: web-dev agent discovered issue from add-reggie-uninstaller IMPLEMENT stage. Verify vite.config.ts setupFiles is populated and tsconfig exclude matches project convention.

- [ ] settings-panel-dead-state: SettingsPanel.tsx has a `reinstallState` that is set but never reset after completion, and a dead `dismissTimer` that's allocated but never cleared
  > context: discovered during add-reggie-uninstaller SIMPLIFY. Pre-existing tech debt in settings panel, not introduced by the uninstaller feature but worth a cleanup pass.
