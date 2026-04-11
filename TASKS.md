# Tasks

## Active Tasks

---

## Backlog

### App Integration
- [ ] merge-ci-workflows: Consolidate CI into ci.yml + release.yml with yamllint and dependency-review jobs [P2] [depends: integrate-app-code] [simple] [tier: sonnet:medium] [code] [planned]
  files: .github/workflows/ (NEW+DEL)

### Resource Bundling & Installation
- [ ] reggie-installer: Rust install lifecycle — copy/symlink to ~/.claude/, version tracking, settings merge, first-launch setup UI [P1] [depends: bundle-resources-in-app, rename-app-to-reggie] [complex] [tier: opus:high] [code] [planned]
  files: installer.rs (NEW), lib.rs (MOD), mod.rs (MOD), FirstLaunchSetup.tsx (NEW), App.tsx (MOD)
- [ ] add-management-ui: Settings panel in ActivityBar with version info, reinstall, environment setup [P2] [depends: reggie-installer] [moderate] [tier: opus:medium] [code] [planned]
  files: SettingsPanel.tsx (NEW), ActivityBar.tsx (MOD), mod.rs (MOD), installer.rs (MOD), globals.css (MOD)

### Ungroomed
- [ ] update-forge-reggie-data: Update forge-reggie reggie_data.rs to use manager: frontmatter lookup instead of find_matching_manager heuristic [P2]
  > Discovered during prefix-rename-agents. The Forge app in forge-reggie/src-tauri/src/commands/reggie_data.rs still uses substring heuristics to match pipeline commands to managers. Now that commands have manager: frontmatter, Forge should parse that field directly.
- [ ] consolidate-frontmatter-parsing: Consolidate duplicate YAML frontmatter parsing in reggie_data.rs and skills.rs into shared utility [P3]
  > Discovered during bundle-resources-in-app IMPLEMENT. reggie_data.rs has extract_frontmatter and skills.rs has skip_yaml_frontmatter — slightly different functions doing the same job.
---
