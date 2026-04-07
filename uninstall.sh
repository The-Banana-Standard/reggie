#!/bin/bash
# uninstall.sh — Remove Reggie from ~/.claude/ (only removes Reggie-owned symlinks)
set -euo pipefail

REPO_DIR="$(cd "$(dirname "$0")" && pwd)"
CLAUDE_DIR="$HOME/.claude"
REMOVED=0

echo "Uninstalling Reggie..."
echo ""

# Helper: remove a file only if it's a symlink pointing into the reggie repo
remove_if_reggie_symlink() {
  local filepath="$1"
  if [ -L "$filepath" ]; then
    local target
    target=$(readlink "$filepath")
    # Check if the symlink target is inside the reggie repo
    case "$target" in
      "$REPO_DIR"/*|*/reggie/agents/*|*/reggie/commands/*|*/reggie/hooks/*|*/reggie/docs/*|*/reggie/REGGIE.md|*/reggie/mcp-registry.yaml|*/reggie/skills-registry.yaml)
        rm "$filepath"
        echo "  Removed: $(basename "$filepath")"
        REMOVED=$((REMOVED + 1))
        ;;
    esac
  fi
}

# 1. Remove individual agent symlinks that point to reggie
echo "Checking agents/..."
if [ -L "$CLAUDE_DIR/agents" ]; then
  # Old directory-level symlink — remove and create empty dir
  rm "$CLAUDE_DIR/agents"
  mkdir -p "$CLAUDE_DIR/agents"
  echo "  Removed old directory-level symlink: agents/"
  REMOVED=$((REMOVED + 1))
elif [ -d "$CLAUDE_DIR/agents" ]; then
  for file in "$CLAUDE_DIR/agents/"*; do
    [ -e "$file" ] || continue
    remove_if_reggie_symlink "$file"
  done
fi

# 2. Remove individual command symlinks that point to reggie
echo "Checking commands/..."
if [ -L "$CLAUDE_DIR/commands" ]; then
  rm "$CLAUDE_DIR/commands"
  mkdir -p "$CLAUDE_DIR/commands"
  echo "  Removed old directory-level symlink: commands/"
  REMOVED=$((REMOVED + 1))
elif [ -d "$CLAUDE_DIR/commands" ]; then
  for file in "$CLAUDE_DIR/commands/"*; do
    [ -e "$file" ] || continue
    remove_if_reggie_symlink "$file"
  done
fi

# 3. Remove individual hook symlinks that point to reggie
echo "Checking hooks/..."
if [ -L "$CLAUDE_DIR/hooks" ]; then
  rm "$CLAUDE_DIR/hooks"
  mkdir -p "$CLAUDE_DIR/hooks"
  echo "  Removed old directory-level symlink: hooks/"
  REMOVED=$((REMOVED + 1))
elif [ -d "$CLAUDE_DIR/hooks" ]; then
  for file in "$CLAUDE_DIR/hooks/"*; do
    [ -e "$file" ] || continue
    remove_if_reggie_symlink "$file"
  done
fi

# 4. Remove standalone file symlinks
echo "Checking standalone files..."
for item in REGGIE.md PORTABLE-PACKAGE.md agents-is-all-you-need.md reggie-quickstart.md mcp-registry.yaml skills-registry.yaml; do
  remove_if_reggie_symlink "$CLAUDE_DIR/$item"
done

# Legacy cleanup
if [ -L "$CLAUDE_DIR/capability-manifest.yaml" ]; then
  target=$(readlink "$CLAUDE_DIR/capability-manifest.yaml")
  case "$target" in
    */reggie/*)
      rm "$CLAUDE_DIR/capability-manifest.yaml"
      echo "  Removed legacy capability-manifest.yaml symlink"
      REMOVED=$((REMOVED + 1))
      ;;
  esac
fi

# 5. Remove stats hooks from settings.json
SETTINGS_FILE="$CLAUDE_DIR/settings.json"
if [ -f "$SETTINGS_FILE" ] && command -v python3 &>/dev/null; then
  python3 - "$SETTINGS_FILE" << 'PYEOF'
import json, sys

settings_path = sys.argv[1]
with open(settings_path) as f:
    settings = json.load(f)

hook_cmd = "$HOME/.claude/hooks/track-stats.sh"

if "hooks" in settings and "PostToolUse" in settings["hooks"]:
    settings["hooks"]["PostToolUse"] = [
        entry for entry in settings["hooks"]["PostToolUse"]
        if not any(h.get("command") == hook_cmd for h in entry.get("hooks", []))
    ]
    if not settings["hooks"]["PostToolUse"]:
        del settings["hooks"]["PostToolUse"]
    if not settings["hooks"]:
        del settings["hooks"]

with open(settings_path, "w") as f:
    json.dump(settings, f, indent=2)
    f.write("\n")
PYEOF
  echo "Removed stats hooks from settings.json"
fi

# 6. Remove ENABLE_TOOL_SEARCH from shell profile
for PROFILE in "$HOME/.zshrc" "$HOME/.bashrc" "$HOME/.bash_profile"; do
  if [ -f "$PROFILE" ] && grep -q 'ENABLE_TOOL_SEARCH' "$PROFILE" 2>/dev/null; then
    sed -i.bak -e '/# Reggie: defer MCP tool schemas/d' -e '/export ENABLE_TOOL_SEARCH/d' "$PROFILE"
    rm -f "${PROFILE}.bak"
    echo "Removed ENABLE_TOOL_SEARCH from $PROFILE"
  fi
done

echo ""
echo "Reggie uninstalled. Removed $REMOVED Reggie-owned files."
echo "User-created files in ~/.claude/ were preserved."
