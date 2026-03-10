# Setup Workspace Docs

Recursively scan workspaces from the current directory downward and generate CLAUDE.md + `docs/architecture.md` at each workspace level. Workspaces are directories that contain git repos. Individual repos are not modified — only workspace-level docs are created.

## Context

```bash
echo "=== Current Directory ==="
pwd

echo ""
echo "=== Directory Tree (workspaces and repos) ==="

classify_dir() {
  local dir="$1"
  local indent="$2"

  # Check if this dir is a git repo
  if [ -d "$dir/.git" ]; then
    echo "${indent}[repo] $(basename "$dir")"
    # Detect tech stack
    for f in package.json Cargo.toml go.mod requirements.txt Gemfile build.gradle Podfile; do
      if [ -f "$dir/$f" ]; then
        echo "${indent}  stack: $f"
      fi
    done
    if [ -f "$dir/CLAUDE.md" ]; then
      echo "${indent}  CLAUDE.md: $(wc -l < "$dir/CLAUDE.md" | tr -d ' ') lines"
    fi
    return
  fi

  # Check if this dir contains git repos (making it a workspace)
  local has_repos=false
  local has_workspaces=false
  for sub in "$dir"/*/; do
    [ -d "$sub" ] || continue
    if [ -d "$sub/.git" ]; then
      has_repos=true
    else
      # Check if sub contains repos (nested workspace)
      for subsub in "$sub"/*/; do
        if [ -d "$subsub/.git" ]; then
          has_workspaces=true
          break
        fi
      done
    fi
  done

  if [ "$has_repos" = true ]; then
    echo "${indent}[workspace] $(basename "$dir")"
    if [ -f "$dir/CLAUDE.md" ]; then
      echo "${indent}  CLAUDE.md: $(wc -l < "$dir/CLAUDE.md" | tr -d ' ') lines"
    else
      echo "${indent}  CLAUDE.md: none"
    fi
    if [ -f "$dir/docs/architecture.md" ]; then
      echo "${indent}  docs/architecture.md: $(wc -l < "$dir/docs/architecture.md" | tr -d ' ') lines"
    else
      echo "${indent}  docs/architecture.md: none"
    fi
    # Recurse into children
    for sub in "$dir"/*/; do
      [ -d "$sub" ] || continue
      classify_dir "$sub" "$indent  "
    done
  elif [ "$has_workspaces" = true ]; then
    echo "${indent}[container] $(basename "$dir")"
    if [ -f "$dir/CLAUDE.md" ]; then
      echo "${indent}  CLAUDE.md: $(wc -l < "$dir/CLAUDE.md" | tr -d ' ') lines"
    else
      echo "${indent}  CLAUDE.md: none"
    fi
    for sub in "$dir"/*/; do
      [ -d "$sub" ] || continue
      classify_dir "$sub" "$indent  "
    done
  fi
}

# Classify current directory first
has_repos=false
has_workspaces=false
for dir in */; do
  [ -d "$dir" ] || continue
  if [ -d "$dir/.git" ]; then
    has_repos=true
  else
    for sub in "$dir"/*/; do
      if [ -d "$sub/.git" ]; then
        has_workspaces=true
        break
      fi
    done
  fi
done

if [ "$has_repos" = true ]; then
  echo "[workspace] $(basename "$(pwd)")"
elif [ "$has_workspaces" = true ]; then
  echo "[container] $(basename "$(pwd)")"
else
  echo "[unknown] $(basename "$(pwd)")"
fi

if [ -f "CLAUDE.md" ]; then
  echo "  CLAUDE.md: $(wc -l < "CLAUDE.md" | tr -d ' ') lines"
else
  echo "  CLAUDE.md: none"
fi
if [ -f "docs/architecture.md" ]; then
  echo "  docs/architecture.md: $(wc -l < "docs/architecture.md" | tr -d ' ') lines"
else
  echo "  docs/architecture.md: none"
fi

for dir in */; do
  [ -d "$dir" ] || continue
  classify_dir "$dir" "  "
done
```

## Instructions

You are generating documentation that maps repos to their responsibilities. This documentation is consumed by `/distribute-tasks` to know where to route tasks. The process is **recursive** — you generate docs for the current directory and all workspace-level directories below it. Individual repos are never modified.

### Definitions

- **Repo**: A directory with a `.git/` folder. Never gets workspace docs.
- **Workspace**: A directory that contains repos as children. Gets a CLAUDE.md + `docs/architecture.md`.
- **Container**: A directory that contains workspaces (or other containers). Gets a CLAUDE.md summarizing its workspaces.

### Step 1: Build the workspace tree

Starting from the current directory, recursively identify all workspaces and containers. The context script's output shows the full tree with `[workspace]`, `[container]`, and `[repo]` labels.

Collect every directory labeled `[workspace]` or `[container]` — these are your targets. Process them **bottom-up** (deepest workspaces first, then their parent containers), so parent docs can reference child workspace summaries.

### Step 2: For each workspace — generate CLAUDE.md

For each workspace found, read the CLAUDE.md of every repo it contains, then create or update a `CLAUDE.md` in that workspace directory:

```markdown
# [Workspace Name]

## Overview
[1-2 sentence description of what this workspace covers]

## Repos

### [repo-name]
- **Path**: ./[repo-name]
- **Purpose**: [What this repo does — extracted from its CLAUDE.md or inferred]
- **Tech Stack**: [Languages, frameworks, key tools]
- **Domain**: [What area of responsibility — e.g., "user-facing iOS app", "backend API", "shared utilities"]

### [repo-name-2]
...

## Domain Boundaries
[Describe how repos relate to each other — shared dependencies, API contracts, data flow between repos]

## Cross-Cutting Concerns
[Shared conventions, deployment pipelines, testing strategies that span repos]
```

### Step 3: For each workspace — generate docs/architecture.md

For each workspace, create or update `docs/architecture.md`. Read each repo's `docs/architecture.md` and `CLAUDE.md` (if they exist) to synthesize the cross-repo view.

```markdown
# [Workspace Name] — Architecture

## System Overview
[High-level description of the full system and how repos compose into a product]

## Repo Responsibilities
[One-liner per repo — what it owns, what it doesn't]

## Communication Patterns
[How repos talk to each other — REST APIs, shared packages, event buses, database sharing, file contracts, etc. Include specific endpoints or package names where known]

## Data Flow
[How data moves through the system — which repo is the source of truth for what, where transformations happen, key data handoff points]

## Deployment Topology
[How repos are deployed relative to each other — shared infra, independent deploys, mono-deploy, CI/CD relationships]

## Shared Dependencies
[Packages, tools, or services that multiple repos depend on — shared libraries, common CI configs, shared database instances]

## Folder Structure
[Map of the workspace directory — what lives where and why]
```

Keep sections concise. Omit sections that don't apply (e.g., skip Deployment Topology if all repos are local-only tools). If a `docs/` directory doesn't exist at the workspace level, create it.

### Step 4: For each container — generate CLAUDE.md

For each container (directory that holds workspaces), create or update a `CLAUDE.md` summarizing its children:

```markdown
# [Container Name]

## Workspaces

### [workspace-name]
- **Path**: ./[workspace-name]
- **Domain**: [What product/area this workspace covers]
- **Repos**: [List of repo names]

### [workspace-name-2]
...

## Standalone Repos
[List any repos that sit directly under this container without a workspace]

## Architecture Overview
[How workspaces relate — shared infrastructure, cross-product dependencies]
```

### Step 5: Merge logic for existing docs

**CRITICAL**: If a CLAUDE.md already exists at the target level:

1. Read the existing file
2. Identify sections that appear auto-generated (matching the templates above) vs. user-modified sections
3. **Preserve user-modified sections** — sections with custom content that don't match the template structure
4. **Update auto-generated sections** — refresh repo listings, tech stacks, and descriptions from current repo CLAUDE.md files
5. Show the user what changed and ask for confirmation before writing

If the file has been significantly customized beyond the template, warn the user and offer to:
- Append new repo entries without modifying existing content
- Generate a `.claude-workspace-docs-draft.md` for manual merging
- Overwrite (with backup to `.claude-workspace-docs-backup.md`)

### Output

After generating, print a summary:

```
Generated workspace documentation:

  [path-1]/ (workspace)
    CLAUDE.md: [New/Updated/Unchanged] — [N] repos documented
    docs/architecture.md: [New/Updated/Unchanged]

  [path-2]/ (workspace)
    CLAUDE.md: [New/Updated/Unchanged] — [N] repos documented
    docs/architecture.md: [New/Updated/Unchanged]

  [path-3]/ (container)
    CLAUDE.md: [New/Updated/Unchanged] — [N] workspaces, [N] standalone repos

Total: [N] workspaces + [N] containers documented

These docs can be consumed by /distribute-tasks for routing decisions.
```
