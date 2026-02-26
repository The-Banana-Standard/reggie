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

# 2. Back up existing agents/ and commands/ if they exist (and aren't already symlinks)
if [ -d "$CLAUDE_DIR/agents" ] && [ ! -L "$CLAUDE_DIR/agents" ]; then
  echo "Backing up existing agents/ and commands/ to $BACKUP_DIR"
  mkdir -p "$BACKUP_DIR"
  cp -r "$CLAUDE_DIR/agents" "$BACKUP_DIR/agents" 2>/dev/null || true
  cp -r "$CLAUDE_DIR/commands" "$BACKUP_DIR/commands" 2>/dev/null || true
fi

# 3. Remove existing dirs or symlinks
rm -rf "$CLAUDE_DIR/agents"
rm -rf "$CLAUDE_DIR/commands"

# 4. Create symlinks
ln -s "$REPO_DIR/agents" "$CLAUDE_DIR/agents"
ln -s "$REPO_DIR/commands" "$CLAUDE_DIR/commands"

# 5. Copy hooks
mkdir -p "$CLAUDE_DIR/hooks"
cp "$REPO_DIR/hooks/track-stats.sh" "$CLAUDE_DIR/hooks/track-stats.sh"
chmod +x "$CLAUDE_DIR/hooks/track-stats.sh"

# 6. Copy REGGIE.md
cp "$REPO_DIR/REGGIE.md" "$CLAUDE_DIR/REGGIE.md"

echo ""
echo "Reggie installed successfully."
echo ""
echo "  agents/   -> $REPO_DIR/agents (symlinked)"
echo "  commands/ -> $REPO_DIR/commands (symlinked)"
echo "  hooks/track-stats.sh copied"
echo "  REGGIE.md copied"
echo ""
echo "Manual step: Add the stats hooks to ~/.claude/settings.json:"
echo ""
echo '  "hooks": {'
echo '    "PostToolUse": ['
echo '      {'
echo '        "matcher": "Task",'
echo '        "hooks": [{"type": "command", "command": "~/.claude/hooks/track-stats.sh"}]'
echo '      },'
echo '      {'
echo '        "matcher": "Skill",'
echo '        "hooks": [{"type": "command", "command": "~/.claude/hooks/track-stats.sh"}]'
echo '      }'
echo '    ]'
echo '  }'
echo ""
echo "Restart Claude Code to pick up the new commands."
