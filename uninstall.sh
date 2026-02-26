#!/bin/bash
# uninstall.sh — Remove Reggie from ~/.claude/
set -euo pipefail

CLAUDE_DIR="$HOME/.claude"

echo "Uninstalling Reggie..."
echo ""

# 1. Remove symlinks
if [ -L "$CLAUDE_DIR/agents" ]; then
  rm "$CLAUDE_DIR/agents"
  echo "Removed agents symlink"
fi

if [ -L "$CLAUDE_DIR/commands" ]; then
  rm "$CLAUDE_DIR/commands"
  echo "Removed commands symlink"
fi

# 2. Restore from backup if available
LATEST_BACKUP=$(ls -dt "$CLAUDE_DIR/backups/pre-reggie-"* 2>/dev/null | head -1)
if [ -n "$LATEST_BACKUP" ]; then
  echo "Restoring from backup: $LATEST_BACKUP"
  cp -r "$LATEST_BACKUP/agents" "$CLAUDE_DIR/agents" 2>/dev/null || mkdir -p "$CLAUDE_DIR/agents"
  cp -r "$LATEST_BACKUP/commands" "$CLAUDE_DIR/commands" 2>/dev/null || mkdir -p "$CLAUDE_DIR/commands"
else
  echo "No backup found. Creating empty directories."
  mkdir -p "$CLAUDE_DIR/agents"
  mkdir -p "$CLAUDE_DIR/commands"
fi

# 3. Remove hooks
if [ -f "$CLAUDE_DIR/hooks/track-stats.sh" ]; then
  rm "$CLAUDE_DIR/hooks/track-stats.sh"
  echo "Removed track-stats.sh hook"
fi

# 4. Remove REGGIE.md
if [ -f "$CLAUDE_DIR/REGGIE.md" ]; then
  rm "$CLAUDE_DIR/REGGIE.md"
  echo "Removed REGGIE.md"
fi

echo ""
echo "Reggie uninstalled."
echo "Remember to remove the hooks from ~/.claude/settings.json if you added them."
