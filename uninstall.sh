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
for item in REGGIE.md PORTABLE-PACKAGE.md agents-is-all-you-need.md reggie-quickstart.md; do
  if [ -L "$CLAUDE_DIR/$item" ]; then
    rm "$CLAUDE_DIR/$item"
    echo "Removed $item symlink"
  fi
done

# 3. Restore from backup if available
LATEST_BACKUP=$(ls -dt "$CLAUDE_DIR/backups/pre-reggie-"* 2>/dev/null | head -1)
if [ -n "$LATEST_BACKUP" ]; then
  echo ""
  echo "Restoring from backup: $LATEST_BACKUP"
  for item in agents commands hooks; do
    [ -d "$LATEST_BACKUP/$item" ] && cp -r "$LATEST_BACKUP/$item" "$CLAUDE_DIR/$item" 2>/dev/null || true
  done
  for item in REGGIE.md PORTABLE-PACKAGE.md agents-is-all-you-need.md reggie-quickstart.md; do
    [ -f "$LATEST_BACKUP/$item" ] && cp "$LATEST_BACKUP/$item" "$CLAUDE_DIR/$item" 2>/dev/null || true
  done
else
  echo ""
  echo "No backup found. Creating empty directories."
  mkdir -p "$CLAUDE_DIR/agents"
  mkdir -p "$CLAUDE_DIR/commands"
fi

echo ""
echo "Reggie uninstalled."
echo "Remember to remove the hooks from ~/.claude/settings.json if you added them."
