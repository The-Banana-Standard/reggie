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
    [ -d "$CLAUDE_DIR/$item" ] && [ ! -L "$CLAUDE_DIR/$item" ] && cp -r "$CLAUDE_DIR/$item" "$BACKUP_DIR/$item" 2>/dev/null || true
  done
  for item in REGGIE.md PORTABLE-PACKAGE.md agents-is-all-you-need.md reggie-quickstart.md; do
    [ -f "$CLAUDE_DIR/$item" ] && [ ! -L "$CLAUDE_DIR/$item" ] && cp "$CLAUDE_DIR/$item" "$BACKUP_DIR/$item" 2>/dev/null || true
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

# 4. Create symlinks — directories
ln -s "$REPO_DIR/agents" "$CLAUDE_DIR/agents"
ln -s "$REPO_DIR/commands" "$CLAUDE_DIR/commands"
ln -s "$REPO_DIR/hooks" "$CLAUDE_DIR/hooks"

# 5. Create symlinks — files
ln -s "$REPO_DIR/REGGIE.md" "$CLAUDE_DIR/REGGIE.md"
ln -s "$REPO_DIR/docs/PORTABLE-PACKAGE.md" "$CLAUDE_DIR/PORTABLE-PACKAGE.md"
ln -s "$REPO_DIR/docs/agents-is-all-you-need.md" "$CLAUDE_DIR/agents-is-all-you-need.md"
ln -s "$REPO_DIR/docs/reggie-quickstart.md" "$CLAUDE_DIR/reggie-quickstart.md"

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
echo ""
echo "Manual step: Add the stats hooks to ~/.claude/settings.json:"
echo ""
echo '  "hooks": {'
echo '    "PostToolUse": ['
echo '      {'
echo '        "matcher": "Task",'
echo '        "hooks": [{"type": "command", "command": "$HOME/.claude/hooks/track-stats.sh", "timeout": 10}]'
echo '      },'
echo '      {'
echo '        "matcher": "Skill",'
echo '        "hooks": [{"type": "command", "command": "$HOME/.claude/hooks/track-stats.sh", "timeout": 10}]'
echo '      }'
echo '    ]'
echo '  }'
echo ""
echo "Restart Claude Code to pick up the new commands."
