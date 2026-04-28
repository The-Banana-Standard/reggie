# Tasks

## Active Tasks

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

- [ ] squash-pipeline-stage-commits-on-complete: Collapse the per-stage `meta:` commits a pipeline emits into a single `feat:`/`fix:` commit on `complete`
  > context: discovered 2026-04-28 while prepping the v2.1.0 release. `git log v2.0.1..HEAD` showed 59 commits since the last tag — roughly 5–6 features × ~10 stage commits each (PICKUP, IMPLEMENT, WRITE-TESTS, QUALITY-CHECK, SIMPLIFY, VERIFY-APP, REVIEW, SECURITY-REVIEW, SYNC-DOCS, UPDATE-CLAUDE, complete) plus the actual change commit. No merge commits in the range — pipelines commit straight to `main`. Stage commits are useful as mid-pipeline rewind checkpoints, but they pollute `main`'s history and make `git log`/`git blame`/release notes painful. Two candidate approaches: (a) run the pipeline on a worktree branch and squash-merge into `main` on `complete`, (b) on `complete`, `git reset --soft` to the pre-pipeline HEAD and recommit as one squashed commit. Open question for grooming: do we lose anything important by dropping the stage commits, or is the `.pipeline/<task>/` directory already a sufficient audit trail?

- [ ] dev-build-symlinks-pollute-working-tree: The Tauri dev build replaces `resources/*` with symlinks into `src-tauri/target/debug/reggie-resources/`, creating ~73 typechange entries every release prep
  > context: discovered 2026-04-28 while prepping v2.1.0. After running the app locally for testing, `git status` showed 73 typechange entries — every file under `resources/agents/`, `resources/commands/`, and `resources/hooks/` had been flipped from regular file (100644) to symlink (120000) pointing into `src-tauri/target/debug/reggie-resources/...`. All 73 flipped at the same minute (Apr 26 17:11), so it's a single dev-build step doing this. This means every "test locally → push a release" cycle requires `git restore --staged resources/` before the release commit, which is fragile (easy to accidentally commit the symlinks and break the bundled distribution). Need to investigate: which Tauri build step is creating these symlinks, why source files are pointing into the build output (reverse of the usual pattern), and whether the dev build can use a separate output dir or copy instead of symlink. Likely fix touches: `src-tauri/build.rs`, `src-tauri/tauri.conf.json` resource bundling, or a custom build script. Workarounds to consider in the meantime: add `resources/` typechanges to a pre-commit guard, or have the dev script restore from HEAD on exit.

<!-- folded into vitest-setupfiles-and-contract-test-fixes (2026-04-25). Original guess (scanner glob bug) was wrong — RUST_COMMANDS is a hand-maintained table; just needs the missing entry. -->

