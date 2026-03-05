# Tasks

> Global priority order: fix-doc-counts (8.0) > gitignore-sensitive-files (7.0) = fix-tool-list-mismatches (7.0) > remove-haiku-recommendation (6.0) > fix-readme-pipeline (5.0) = fix-install-fallback (5.0) > fix-track-stats-race (4.0) > fix-uninstall-cleanup (3.0) > fix-broken-refs (2.3) > sync-capability-manifest (1.3)

## Active Tasks

### fix-doc-counts
- **Branch**: task/fix-doc-counts
- **Worktree**: .worktree/fix-doc-counts
- **Base**: main
- Fix documentation counts across README.md, REGGIE.md, agents-is-all-you-need.md, PORTABLE-PACKAGE.md

## Backlog

### Documentation Accuracy
- [ ] fix-tool-list-mismatches — Update PORTABLE-PACKAGE.md tool tables to match actual agent frontmatter (12 agents have incorrect tool descriptions)
- [ ] remove-haiku-recommendation — Remove haiku from PORTABLE-PACKAGE.md model recommendation table (all pipelines ban it)
- [ ] fix-readme-pipeline — Update README.md "How It Works" pipeline description (RESEARCH→PLAN moved to /init-tasks)
- [ ] fix-broken-refs — Remove/fix references to non-existent /done, /next commands in PORTABLE-PACKAGE.md and add missing "RESEARCH/PLAN (Orchestrator-Direct Mode)" headings to pipeline-manager.md. Impact 7 but Effort M due to content that must be written for the missing headings — not just deletions.

### Security & Config
- [ ] gitignore-sensitive-files — Add .pipeline/, .worktree/, .env* to .gitignore
- [ ] fix-install-fallback — Fix install.sh fallback missing ToolSearch hook + install.ps1 "install.sh" message typo

### Code Quality
- [ ] fix-track-stats-race — Fix track-stats.sh race condition (lines 53, 66) using mktemp instead of hardcoded .tmp suffix
- [ ] fix-uninstall-cleanup — Add ENABLE_TOOL_SEARCH cleanup to uninstall.sh and uninstall.ps1

### Config Sync
- [ ] sync-capability-manifest — Sync capability-manifest.yaml community_skills count with skills-registry.yaml: 15 manifest entries vs 19 registry entries due to undocumented bundling (pdf/docx/xlsx/pptx → skill-document-suite) and missing canvas-design entry. Either add missing entries or document the bundling.
