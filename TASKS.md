# Tasks

## Active Tasks

---

## Backlog

### Resource Bundling & Installation

### Ungroomed
- [ ] update-forge-reggie-data: Update forge-reggie reggie_data.rs to use manager: frontmatter lookup instead of find_matching_manager heuristic [P2]
  > Discovered during prefix-rename-agents. The Forge app in forge-reggie/src-tauri/src/commands/reggie_data.rs still uses substring heuristics to match pipeline commands to managers. Now that commands have manager: frontmatter, Forge should parse that field directly.
- [ ] consolidate-frontmatter-parsing: Consolidate duplicate YAML frontmatter parsing in reggie_data.rs and skills.rs into shared utility [P3]
  > Discovered during bundle-resources-in-app IMPLEMENT. reggie_data.rs has extract_frontmatter and skills.rs has skip_yaml_frontmatter — slightly different functions doing the same job.
---
