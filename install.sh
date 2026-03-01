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

# 6. Add stats hooks to settings.json
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

with open(settings_path, "w") as f:
    json.dump(settings, f, indent=2)
    f.write("\n")
PYEOF
  echo "  Added stats hooks to settings.json"
else
  echo ""
  echo "  Could not auto-configure hooks (python3 not found)."
  echo "  Manually add to $SETTINGS_FILE:"
  echo '    "hooks": { "PostToolUse": [ { "matcher": "Task", "hooks": [{"type":"command","command":"$HOME/.claude/hooks/track-stats.sh","timeout":10}] }, { "matcher": "Skill", "hooks": [{"type":"command","command":"$HOME/.claude/hooks/track-stats.sh","timeout":10}] } ] }'
fi

echo ""
echo "Restart Claude Code to pick up the new commands."
