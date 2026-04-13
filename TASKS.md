# Tasks

## Active Tasks

### update-docs-tauri-rebrand
**Task**: Rewrite README + docs to reflect Reggie as Tauri app with bundled subagent system
**Stage**: UPDATE-CLAUDE
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
- MOD: docs/open-source-release-checklist.md (audit only — no changes)
**Quality Scores**:
| Stage | Score | Attempts | Status |
|-------|-------|----------|--------|
| IMPLEMENT | 9.6 | 1 | PASS |
| WRITE-TESTS | SKIP | - | SKIP |
| QUALITY-CHECK | SKIP | - | SKIP |
| SIMPLIFY | SKIP | - | SKIP |
| VERIFY-APP | SKIP | - | SKIP |
| REVIEW | 9.6 | 1 | PASS |
| SECURITY-REVIEW | SKIP | - | SKIP |
| SYNC-DOCS | SKIP | - | SKIP |
| UPDATE-CLAUDE | - | 0 | CURRENT |

---

## Backlog

### Documentation & Repo Hygiene

### Testing & Build Quality

_(none)_

### Ungroomed
- [ ] audit-src-tauri-forge-strings: Sweep `src-tauri/` source (window titles, error messages, About dialog) for stale "Forge" strings post-rebrand
  > surfaced during update-docs-tauri-rebrand — out of scope for docs task
- [ ] refresh-portable-package-body: Audit full 451-line PORTABLE-PACKAGE.md beyond the rewritten Quick Setup block; may contain other stale installation-flow assumptions
  > surfaced during update-docs-tauri-rebrand
- [ ] readme-uninstall-section: Decide whether README needs an Uninstall section (previous version referenced "the Reggie app" removing files from `~/.claude/`; new README omits it)
  > surfaced during update-docs-tauri-rebrand
- [ ] v1.2.0-release-framing: When cutting next release, frame the forge-reggie → reggie merge prominently in release notes (CHANGELOG `[Unreleased]` compare URL still points to `v1.1.2...HEAD`)
  > surfaced during update-docs-tauri-rebrand
- [ ] tighten-reggie-guide-installation-topic: `resources/commands/reggie-guide.md` L535 rewritten installation paragraph is dense; consider converting to bullet list for scannability
  > surfaced during update-docs-tauri-rebrand (cosmetic, low priority)
- [ ] rename-dev-bundle-identifier: `src-tauri/tauri.conf.json` identifier `com.reggie-app.dev` has `.dev` suffix that looks like pre-release leftover — decide pre-1.2.0 whether to drop it
  > surfaced during update-docs-tauri-rebrand code review
- [ ] consolidate-unreleased-changelog: Two CHANGELOG `[Unreleased]` entries ("Built-in installer…" under Added + new "Merged forge-reggie…" under Changed) describe related work; consider consolidating before cutting release
  > surfaced during update-docs-tauri-rebrand code review
