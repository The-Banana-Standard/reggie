#!/bin/bash
# install.sh — Install Reggie into ~/.claude/
set -euo pipefail

REPO_DIR="$(cd "$(dirname "$0")" && pwd)"
CLAUDE_DIR="$HOME/.claude"
TIMESTAMP=$(date +%Y%m%d-%H%M%S)
BACKUP_DIR="$CLAUDE_DIR/backups/pre-reggie-$TIMESTAMP"

echo "Installing Reggie from $REPO_DIR"
echo ""

# 1. Ensure ~/.claude/ exists
mkdir -p "$CLAUDE_DIR"

# 2. Back up existing content if it exists (and isn't already symlinked to this repo)
NEEDS_BACKUP=false
for item in agents commands hooks REGGIE.md; do
  target="$CLAUDE_DIR/$item"
  if [ -e "$target" ] && [ ! -L "$target" ]; then
    NEEDS_BACKUP=true
    break
  fi
done

if [ "$NEEDS_BACKUP" = true ]; then
  echo "Backing up existing files to $BACKUP_DIR"
  mkdir -p "$BACKUP_DIR"
  for item in agents commands hooks; do
    if [ -d "$CLAUDE_DIR/$item" ] && [ ! -L "$CLAUDE_DIR/$item" ]; then
      cp -r "$CLAUDE_DIR/$item" "$BACKUP_DIR/$item" 2>/dev/null || true
    fi
  done
  for item in REGGIE.md PORTABLE-PACKAGE.md agents-is-all-you-need.md reggie-quickstart.md mcp-registry.yaml skills-registry.yaml; do
    if [ -f "$CLAUDE_DIR/$item" ] && [ ! -L "$CLAUDE_DIR/$item" ]; then
      cp "$CLAUDE_DIR/$item" "$BACKUP_DIR/$item" 2>/dev/null || true
    fi
  done
fi

# 3. Remove existing dirs/files or symlinks
rm -rf "$CLAUDE_DIR/agents"
rm -rf "$CLAUDE_DIR/commands"
rm -rf "$CLAUDE_DIR/hooks"
rm -f "$CLAUDE_DIR/REGGIE.md"
rm -f "$CLAUDE_DIR/PORTABLE-PACKAGE.md"
rm -f "$CLAUDE_DIR/agents-is-all-you-need.md"
rm -f "$CLAUDE_DIR/reggie-quickstart.md"
rm -f "$CLAUDE_DIR/mcp-registry.yaml"
rm -f "$CLAUDE_DIR/skills-registry.yaml"
# Legacy cleanup: old installs symlinked this file. Keep regular files untouched.
[ -L "$CLAUDE_DIR/capability-manifest.yaml" ] && rm -f "$CLAUDE_DIR/capability-manifest.yaml"

# 4. Create symlinks — directories
ln -s "$REPO_DIR/agents" "$CLAUDE_DIR/agents"
ln -s "$REPO_DIR/commands" "$CLAUDE_DIR/commands"
ln -s "$REPO_DIR/hooks" "$CLAUDE_DIR/hooks"

# 5. Create symlinks — files
ln -s "$REPO_DIR/REGGIE.md" "$CLAUDE_DIR/REGGIE.md"
ln -s "$REPO_DIR/docs/PORTABLE-PACKAGE.md" "$CLAUDE_DIR/PORTABLE-PACKAGE.md"
ln -s "$REPO_DIR/docs/agents-is-all-you-need.md" "$CLAUDE_DIR/agents-is-all-you-need.md"
ln -s "$REPO_DIR/docs/reggie-quickstart.md" "$CLAUDE_DIR/reggie-quickstart.md"
ln -s "$REPO_DIR/mcp-registry.yaml" "$CLAUDE_DIR/mcp-registry.yaml"
ln -s "$REPO_DIR/skills-registry.yaml" "$CLAUDE_DIR/skills-registry.yaml"

echo ""
echo "Reggie installed successfully."
echo ""
echo "  Symlinked directories:"
echo "    agents/   -> $REPO_DIR/agents"
echo "    commands/ -> $REPO_DIR/commands"
echo "    hooks/    -> $REPO_DIR/hooks"
echo ""
echo "  Symlinked files:"
echo "    REGGIE.md              -> $REPO_DIR/REGGIE.md"
echo "    PORTABLE-PACKAGE.md    -> $REPO_DIR/docs/PORTABLE-PACKAGE.md"
echo "    agents-is-all-you-need.md -> $REPO_DIR/docs/agents-is-all-you-need.md"
echo "    reggie-quickstart.md   -> $REPO_DIR/docs/reggie-quickstart.md"
echo "    mcp-registry.yaml      -> $REPO_DIR/mcp-registry.yaml"
echo "    skills-registry.yaml   -> $REPO_DIR/skills-registry.yaml"
echo ""
echo "  Local generated file:"
echo "    capability-manifest.yaml (created/updated by /refresh-capabilities)"
echo ""

# 6. Optional local overlay files for user-specific additions
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

# 7. Add stats hooks to settings.json
SETTINGS_FILE="$CLAUDE_DIR/settings.json"

if [ ! -f "$SETTINGS_FILE" ]; then
  # No settings file — create one with just the hooks
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
  # Settings file exists — merge hooks using python3 (idempotent)
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
  echo "  Manually add to $SETTINGS_FILE:"
  echo "  Manually add hooks to $SETTINGS_FILE. See README for details."
fi

# 8. Configure ENABLE_TOOL_SEARCH in shell profile
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
