# Tasks

## Active Tasks

### attach-images-to-ungroomed-tasks
**Task**: Paste/drop images into ungroomed task input, consumed during init-tasks
**Stage**: PICKUP
**Pipeline**: code-workflow
**Mode**: --yes
**Branch**: task/attach-images-to-ungroomed-tasks
**Worktree**: .worktree/attach-images-to-ungroomed-tasks
**Base**: main
**Started**: 2026-04-26
**Attempts**: 1
**Files**:
- MOD: src/components/ProjectSummary/ProjectSummaryPanel.tsx
- MOD: src/components/ProjectSummary/__tests__/ProjectSummaryPanel.test.tsx
- MOD: src/components/ProjectSummary/__tests__/parseTaskInput.test.ts
- MOD: src/__tests__/tauri-contract.test.ts
- MOD: src-tauri/src/commands/projects.rs
- MOD: src-tauri/src/commands/mod.rs
- MOD: src-tauri/src/lib.rs
- MOD: resources/commands/reggie-init-tasks.md
**Quality Scores**:
| Stage | Score | Attempts | Status |
|-------|-------|----------|--------|
| PICKUP | - | 1 | DONE |
| IMPLEMENT | 9.10 | 1 | PASS |
| WRITE-TESTS | 9.28 | 1 | PASS |
| QUALITY-CHECK | 9.28 | 1 | PASS |
| SIMPLIFY | 9.40 | 1 | PASS |
| VERIFY-APP | PASS | 1 | PASS |
| REVIEW | - | 0 | CURRENT |

---

## Backlog

### v2.0.0 Release

(all v2.0.0 release tasks complete or in progress)

### Pipeline System Expansion


### Bug Fixes & Tech Debt
- [x] vitest-env-hang-investigation: Diagnose and fix vitest hanging at 0% CPU [P2] [depends: add-pipeline-mode-tags-manual-reggie-system-and-debug] [conflicts: replace-sqlite-with-json-bookmarks] [complex] [tier: opus:high] [debug] [planned]
  files: vite.config.ts (MOD), package.json (MOD)
  > closed 2026-04-25: hang not reproducible — full suite runs 962 tests in 6.86s across 3 invocations. Diagnosis inconclusive (likely stale Vite dep-optimizer cache or sandbox-trapped stale processes, both since cleared). setupFiles AC item folded into vitest-setupfiles-and-contract-test-fixes. See .pipeline/vitest-env-hang-investigation/HANDOFF.md.

### Other

### Ungroomed
- [ ] the-batch-start-button-isn-t-working-for-debug-and-possibly-reggie-system-changes: the batch start button isn’t working for debug and possibly reggie system changes
- [ ] tasks-viewer-mode-tag-gap: TasksViewer ignores [manual], [reggie-system], and [debug] mode tags
  > context: discovered 2026-04-25 while running wire-manual-reggie-system-and-debug-tags-runtime locally. The Rust parser (src-tauri/src/commands/projects.rs) and CodeWorkflowTab/RepoTaskRow surface all five mode tags correctly, but TasksViewer/TaskCard uses a separate TS parser at src/types/task.ts whose PIPELINE_RE only matches /\[(code|design)\]/. Result: groomed [debug] tasks render no mode badge and a hardcoded "Start" button (TaskCard.tsx:49) — same problem will hit [manual] and [reggie-system]. Fix touches: src/types/task.ts (broaden TaskPipeline + regex), TaskCard.tsx (mode-aware button: Debug / Walk through / Start, plus dispatch routing). Open question for grooming: should TasksViewer dispatch directly to /reggie-debug-workflow and /reggie-system-change like CodeWorkflowTab does, or always go through the per-domain path?

- [ ] clicking-a-link-on-the-sessions-tab-doesn-t-open-the-link-in-a-browser: clicking a link on the sessions tab doesn’t open the link in a browser

- [ ] ui-pipeline-button-rebinding: Let users bind any auto-discovered pipeline (not just `reggie-code-workflow`) to UI workflow buttons
  > context: pipeline auto-discovery already works via frontmatter `type: pipeline` (PipelinesPanel.tsx + get_pipelines in reggie_data.rs). Substrate is small — just adding the rebinding layer on top. Open question for grooming: per-workspace or global persistence of the binding.

- [ ] one-click-install-from-internet: One-click install of skills, agents, commands, plugins, hooks from internet sources
  > context: broad install surface for the Reggie UI. Per-unit-type install mechanics differ — skills/agents/commands = file copy to `~/.claude/`, hooks = edit `settings.json`, plugins = bundle. Hooks management folds into this rather than being a standalone feature. Existing `src-tauri/src/installer.rs` is hardcoded to `~/.claude/` system-level install; install/uninstall symmetry is a known footgun there. Also relates to Anthropic's own `/plugin install` — open Q whether to shell out vs. write files directly.

- [ ] federate-marketplace-sources: Aggregate plugins/skills/agents from multiple sources in the Reggie UI marketplace
  > context: discovery is the user's biggest pain — they don't know what exists. Sources to federate: Anthropic's claude-plugins-official, claude-plugins-community, alirezarezvani/claude-skills, awesome-claude-code, arbitrary GitHub repos. Anthropic's own marketplace is curated and small; community lives elsewhere. Trust/safety surfaces (prompt preview, tool list, source attribution) matter here.

- [ ] mcp-visualization-panel: Visualize MCP servers configured and running in the Reggie UI
  > context: user wants visibility into what MCPs are active. Suspect Reggie already manages this somewhere but it's not surfaced in the UI. Distinct from the install feature — this is a "see what I have" surface, not "install new things."

- [ ] judge-driven-pipeline-comparison: Use `reggie-judge` to compare two pipelines or two agents on a real task
  > context: lowest priority of the marketplace cluster. Differentiator vs. other marketplaces — Reggie has `reggie-judge` baked into its architecture, so the marketplace can offer "evaluate these candidates against your codebase" as a recommendation surface. Nobody else can easily copy this. Needs the install/substrate features to exist first to have anything meaningful to compare.

<!-- folded into vitest-setupfiles-and-contract-test-fixes (2026-04-25). Original guess (scanner glob bug) was wrong — RUST_COMMANDS is a hand-maintained table; just needs the missing entry. -->

