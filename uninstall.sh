#!/bin/bash
# uninstall.sh — Remove Reggie from ~/.claude/
set -euo pipefail

CLAUDE_DIR="$HOME/.claude"

echo "Uninstalling Reggie..."
echo ""

# 1. Remove symlinks — directories
for item in agents commands hooks; do
  if [ -L "$CLAUDE_DIR/$item" ]; then
    rm "$CLAUDE_DIR/$item"
    echo "Removed $item symlink"
  fi
done

# 2. Remove symlinks — files
for item in REGGIE.md PORTABLE-PACKAGE.md agents-is-all-you-need.md reggie-quickstart.md mcp-registry.yaml skills-registry.yaml; do
  if [ -L "$CLAUDE_DIR/$item" ]; then
    rm "$CLAUDE_DIR/$item"
    echo "Removed $item symlink"
  fi
done
# Legacy cleanup: old installs symlinked this file. Keep regular files untouched.
if [ -L "$CLAUDE_DIR/capability-manifest.yaml" ]; then
  rm "$CLAUDE_DIR/capability-manifest.yaml"
  echo "Removed legacy capability-manifest.yaml symlink"
fi

# 3. Restore from backup if available
LATEST_BACKUP=$(ls -dt "$CLAUDE_DIR/backups/pre-reggie-"* 2>/dev/null | head -1)
if [ -n "$LATEST_BACKUP" ]; then
  echo ""
  echo "Restoring from backup: $LATEST_BACKUP"
  for item in agents commands hooks; do
    [ -d "$LATEST_BACKUP/$item" ] && cp -r "$LATEST_BACKUP/$item" "$CLAUDE_DIR/$item" 2>/dev/null || true
  done
  for item in REGGIE.md PORTABLE-PACKAGE.md agents-is-all-you-need.md reggie-quickstart.md mcp-registry.yaml skills-registry.yaml; do
    [ -f "$LATEST_BACKUP/$item" ] && cp "$LATEST_BACKUP/$item" "$CLAUDE_DIR/$item" 2>/dev/null || true
  done
else
  echo ""
  echo "No backup found. Creating empty directories."
  mkdir -p "$CLAUDE_DIR/agents"
  mkdir -p "$CLAUDE_DIR/commands"
fi

# 4. Remove stats hooks from settings.json
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
    # Clean up empty structures
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

# 5. Remove ENABLE_TOOL_SEARCH from shell profile
for PROFILE in "$HOME/.zshrc" "$HOME/.bashrc" "$HOME/.bash_profile"; do
  if [ -f "$PROFILE" ] && grep -q 'ENABLE_TOOL_SEARCH' "$PROFILE" 2>/dev/null; then
    # Remove the export line and its preceding comment (written by installer)
    sed -i.bak -e '/# Reggie: defer MCP tool schemas/d' -e '/export ENABLE_TOOL_SEARCH/d' "$PROFILE"
    rm -f "${PROFILE}.bak"
    echo "Removed ENABLE_TOOL_SEARCH from $PROFILE"
  fi
done

echo ""
echo "Reggie uninstalled."
