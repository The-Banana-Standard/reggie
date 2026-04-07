#!/bin/bash
# install.sh — Install Reggie into ~/.claude/ (additive, per-file symlinks)
set -euo pipefail

REPO_DIR="$(cd "$(dirname "$0")" && pwd)"
CLAUDE_DIR="$HOME/.claude"

echo "Installing Reggie from $REPO_DIR"
echo ""

# 1. Ensure target directories exist
mkdir -p "$CLAUDE_DIR/agents"
mkdir -p "$CLAUDE_DIR/commands"
mkdir -p "$CLAUDE_DIR/hooks"

# 2. Migration: if agents/ or commands/ are directory-level symlinks (old install),
#    remove them and restore from backup or create fresh directories.
for dir in agents commands hooks; do
  target="$CLAUDE_DIR/$dir"
  if [ -L "$target" ] && [ -d "$target" ]; then
    echo "Migrating from old directory-level symlink: $dir/"
    rm "$target"
    mkdir -p "$target"
  fi
done

# 3. Symlink individual agent files
AGENT_COUNT=0
for file in "$REPO_DIR/agents/"*.md; do
  [ -f "$file" ] || continue
  filename=$(basename "$file")
  dest="$CLAUDE_DIR/agents/$filename"

  # Skip if already a symlink pointing to our repo
  if [ -L "$dest" ]; then
    link_target=$(readlink "$dest")
    if [ "$link_target" = "$file" ]; then
      AGENT_COUNT=$((AGENT_COUNT + 1))
      continue
    fi
    # Symlink points elsewhere — remove it
    rm "$dest"
  elif [ -f "$dest" ]; then
    # Regular file exists — back it up
    backup_dest="$CLAUDE_DIR/agents/${filename}.pre-reggie-backup"
    echo "  Backing up existing $filename -> ${filename}.pre-reggie-backup"
    mv "$dest" "$backup_dest"
  fi

  ln -s "$file" "$dest"
  AGENT_COUNT=$((AGENT_COUNT + 1))
done

# 4. Symlink individual command files
CMD_COUNT=0
for file in "$REPO_DIR/commands/"*.md; do
  [ -f "$file" ] || continue
  filename=$(basename "$file")
  dest="$CLAUDE_DIR/commands/$filename"

  # Skip if already a symlink pointing to our repo
  if [ -L "$dest" ]; then
    link_target=$(readlink "$dest")
    if [ "$link_target" = "$file" ]; then
      CMD_COUNT=$((CMD_COUNT + 1))
      continue
    fi
    rm "$dest"
  elif [ -f "$dest" ]; then
    backup_dest="$CLAUDE_DIR/commands/${filename}.pre-reggie-backup"
    echo "  Backing up existing $filename -> ${filename}.pre-reggie-backup"
    mv "$dest" "$backup_dest"
  fi

  ln -s "$file" "$dest"
  CMD_COUNT=$((CMD_COUNT + 1))
done

# 5. Symlink individual hook files
HOOK_COUNT=0
for file in "$REPO_DIR/hooks/"*; do
  [ -f "$file" ] || continue
  filename=$(basename "$file")
  dest="$CLAUDE_DIR/hooks/$filename"

  if [ -L "$dest" ]; then
    link_target=$(readlink "$dest")
    if [ "$link_target" = "$file" ]; then
      HOOK_COUNT=$((HOOK_COUNT + 1))
      continue
    fi
    rm "$dest"
  elif [ -f "$dest" ]; then
    backup_dest="$CLAUDE_DIR/hooks/${filename}.pre-reggie-backup"
    echo "  Backing up existing $filename -> ${filename}.pre-reggie-backup"
    mv "$dest" "$backup_dest"
  fi

  ln -s "$file" "$dest"
  HOOK_COUNT=$((HOOK_COUNT + 1))
done

# 6. Symlink standalone files
STANDALONE_FILES=(
  "REGGIE.md:$REPO_DIR/REGGIE.md"
  "PORTABLE-PACKAGE.md:$REPO_DIR/docs/PORTABLE-PACKAGE.md"
  "agents-is-all-you-need.md:$REPO_DIR/docs/agents-is-all-you-need.md"
  "reggie-quickstart.md:$REPO_DIR/docs/reggie-quickstart.md"
  "mcp-registry.yaml:$REPO_DIR/mcp-registry.yaml"
  "skills-registry.yaml:$REPO_DIR/skills-registry.yaml"
)

for entry in "${STANDALONE_FILES[@]}"; do
  name="${entry%%:*}"
  source="${entry#*:}"
  dest="$CLAUDE_DIR/$name"

  if [ -L "$dest" ]; then
    link_target=$(readlink "$dest")
    if [ "$link_target" = "$source" ]; then
      continue
    fi
    rm "$dest"
  elif [ -f "$dest" ]; then
    echo "  Backing up existing $name -> ${name}.pre-reggie-backup"
    mv "$dest" "$dest.pre-reggie-backup"
  fi

  ln -s "$source" "$dest"
done

# Legacy cleanup: old installs symlinked this file. Keep regular files untouched.
[ -L "$CLAUDE_DIR/capability-manifest.yaml" ] && rm -f "$CLAUDE_DIR/capability-manifest.yaml"

# Legacy cleanup: remove old directory-level symlinks from pre-v1.2 installs
# (already handled in step 2, this catches edge cases)

echo ""
echo "Reggie installed successfully (additive, per-file symlinks)."
echo ""
echo "  Agents:   $AGENT_COUNT files symlinked"
echo "  Commands: $CMD_COUNT files symlinked"
echo "  Hooks:    $HOOK_COUNT files symlinked"
echo ""
echo "  Standalone files:"
echo "    REGGIE.md              -> $REPO_DIR/REGGIE.md"
echo "    PORTABLE-PACKAGE.md    -> $REPO_DIR/docs/PORTABLE-PACKAGE.md"
echo "    agents-is-all-you-need.md -> $REPO_DIR/docs/agents-is-all-you-need.md"
echo "    reggie-quickstart.md   -> $REPO_DIR/docs/reggie-quickstart.md"
echo "    mcp-registry.yaml      -> $REPO_DIR/mcp-registry.yaml"
echo "    skills-registry.yaml   -> $REPO_DIR/skills-registry.yaml"
echo ""
echo "  Local generated file:"
echo "    capability-manifest.yaml (created/updated by /reggie-refresh-capabilities)"
echo ""
echo "  User files in ~/.claude/agents/ and ~/.claude/commands/ are preserved."
echo ""

# 7. Optional local overlay files for user-specific additions
if [ ! -f "$CLAUDE_DIR/mcp-registry.local.yaml" ]; then
  cat > "$CLAUDE_DIR/mcp-registry.local.yaml" << 'OVERLAY_MCP_EOF'
# Optional local MCP server overrides.
# This file is local-only and should not be committed.
servers: {}
OVERLAY_MCP_EOF
  echo "  Created $CLAUDE_DIR/mcp-registry.local.yaml"
fi

if [ ! -f "$CLAUDE_DIR/skills-registry.local.yaml" ]; then
  cat > "$CLAUDE_DIR/skills-registry.local.yaml" << 'OVERLAY_SKILLS_EOF'
# Optional local community skill overrides.
# This file is local-only and should not be committed.
skills: {}
OVERLAY_SKILLS_EOF
  echo "  Created $CLAUDE_DIR/skills-registry.local.yaml"
fi
echo ""

# 8. Add stats hooks to settings.json
SETTINGS_FILE="$CLAUDE_DIR/settings.json"

if [ ! -f "$SETTINGS_FILE" ]; then
  cat > "$SETTINGS_FILE" << 'SETTINGS_EOF'
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Task",
        "hooks": [{"type": "command", "command": "$HOME/.claude/hooks/track-stats.sh", "timeout": 10}]
      },
      {
        "matcher": "Skill",
        "hooks": [{"type": "command", "command": "$HOME/.claude/hooks/track-stats.sh", "timeout": 10}]
      },
      {
        "matcher": "ToolSearch",
        "hooks": [{"type": "command", "command": "$HOME/.claude/hooks/track-stats.sh", "timeout": 10}]
      }
    ]
  }
}
SETTINGS_EOF
  echo "  Created settings.json with stats hooks"
elif command -v python3 &>/dev/null; then
  python3 - "$SETTINGS_FILE" << 'PYEOF'
import json, sys

settings_path = sys.argv[1]
with open(settings_path) as f:
    settings = json.load(f)

hook_cmd = "$HOME/.claude/hooks/track-stats.sh"
task_hook = {"matcher": "Task", "hooks": [{"type": "command", "command": hook_cmd, "timeout": 10}]}
skill_hook = {"matcher": "Skill", "hooks": [{"type": "command", "command": hook_cmd, "timeout": 10}]}
toolsearch_hook = {"matcher": "ToolSearch", "hooks": [{"type": "command", "command": hook_cmd, "timeout": 10}]}

if "hooks" not in settings:
    settings["hooks"] = {}
if "PostToolUse" not in settings["hooks"]:
    settings["hooks"]["PostToolUse"] = []

existing = settings["hooks"]["PostToolUse"]

def has_hook(matcher):
    for entry in existing:
        if entry.get("matcher") == matcher:
            for h in entry.get("hooks", []):
                if h.get("command") == hook_cmd:
                    return True
    return False

if not has_hook("Task"):
    existing.append(task_hook)
if not has_hook("Skill"):
    existing.append(skill_hook)
if not has_hook("ToolSearch"):
    existing.append(toolsearch_hook)

with open(settings_path, "w") as f:
    json.dump(settings, f, indent=2)
    f.write("\n")
PYEOF
  echo "  Added stats hooks to settings.json"
else
  echo ""
  echo "  Could not auto-configure hooks (python3 not found)."
  echo "  Manually add hooks to $SETTINGS_FILE. See README for details."
fi

# 9. Configure ENABLE_TOOL_SEARCH in shell profile
SHELL_PROFILE=""
if [ -f "$HOME/.zshrc" ]; then
  SHELL_PROFILE="$HOME/.zshrc"
elif [ -f "$HOME/.bashrc" ]; then
  SHELL_PROFILE="$HOME/.bashrc"
elif [ -f "$HOME/.bash_profile" ]; then
  SHELL_PROFILE="$HOME/.bash_profile"
fi

if [ -n "$SHELL_PROFILE" ]; then
  if ! grep -q 'ENABLE_TOOL_SEARCH' "$SHELL_PROFILE" 2>/dev/null; then
    {
      echo ''
      echo '# Reggie: defer MCP tool schemas for efficiency'
      echo 'export ENABLE_TOOL_SEARCH=auto:5'
    } >> "$SHELL_PROFILE"
    echo "  Added ENABLE_TOOL_SEARCH=auto:5 to $SHELL_PROFILE"
  else
    echo "  ENABLE_TOOL_SEARCH already configured in $SHELL_PROFILE"
  fi
else
  echo ""
  echo "  Could not find shell profile (~/.zshrc, ~/.bashrc, or ~/.bash_profile)."
  echo "  Manually add to your shell profile:"
  echo '    export ENABLE_TOOL_SEARCH=auto:5'
fi

echo ""
echo "Reggie installed successfully. Restart Claude Code, then run:"
echo ""
echo "  /reggie-guide I just ran install.sh what do I do now?"
echo ""
