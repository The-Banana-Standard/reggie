#!/bin/bash
# track-stats.sh — Claude Code PostToolUse hook for automatic stats tracking
# Fires on Task (agent calls), Skill (command invocations), and ToolSearch (MCP tool discovery)

set -euo pipefail

INPUT=$(cat)
TOOL_NAME=$(echo "$INPUT" | jq -r '.tool_name // empty')
CWD=$(echo "$INPUT" | jq -r '.cwd // empty')

[ -z "$TOOL_NAME" ] || [ -z "$CWD" ] && exit 0

# Find main worktree if CWD is a linked worktree
# This ensures stats always go to the main repo, not a temporary worktree
REPO_ROOT="$CWD"
if [ -d "${CWD}/.git" ] || [ -f "${CWD}/.git" ]; then
  MAIN_WORKTREE=$(cd "$CWD" && git worktree list --porcelain 2>/dev/null | head -1 | sed 's/^worktree //')
  if [ -n "$MAIN_WORKTREE" ] && [ -d "$MAIN_WORKTREE" ]; then
    REPO_ROOT="$MAIN_WORKTREE"
  fi
fi

# Stats file lives in .claude/ within the main repo (not worktrees)
STATS_FILE="${REPO_ROOT}/.claude/stats.json"
mkdir -p "$(dirname "$STATS_FILE")"

# Initialize if missing
if [ ! -f "$STATS_FILE" ]; then
  echo '{"agents":{},"commands":{},"tool_searches":{}}' > "$STATS_FILE"
fi

TODAY=$(date +%Y-%m-%d)

if [ "$TOOL_NAME" = "Task" ]; then
  AGENT=$(echo "$INPUT" | jq -r '.tool_input.subagent_type // empty')
  MODEL=$(echo "$INPUT" | jq -r '.tool_input.model // "opus"')

  # Haiku is below system floor — warn but still record for evidence
  if echo "$MODEL" | grep -qi "haiku"; then
    echo "[REGGIE WARNING] Agent '$AGENT' launched on haiku — system floor is sonnet. Use opus or sonnet only." >&2
  fi

  [ -z "$AGENT" ] && exit 0

  jq --arg agent "$AGENT" \
     --arg model "$MODEL" \
     --arg date "$TODAY" \
     '
     .agents[$agent] //= {"calls": 0, "last": null, "models": {"opus": 0, "sonnet": 0}} |
     .agents[$agent].calls += 1 |
     .agents[$agent].last = $date |
     .agents[$agent].models[$model] = ((.agents[$agent].models[$model] // 0) + 1)
     ' "$STATS_FILE" > "${STATS_FILE}.tmp" && mv "${STATS_FILE}.tmp" "$STATS_FILE"

elif [ "$TOOL_NAME" = "Skill" ]; then
  CMD=$(echo "$INPUT" | jq -r '.tool_input.skill // empty')

  [ -z "$CMD" ] && exit 0

  jq --arg cmd "$CMD" \
     --arg date "$TODAY" \
     '
     .commands[$cmd] //= {"runs": 0, "last": null} |
     .commands[$cmd].runs += 1 |
     .commands[$cmd].last = $date
     ' "$STATS_FILE" > "${STATS_FILE}.tmp" && mv "${STATS_FILE}.tmp" "$STATS_FILE"

elif [ "$TOOL_NAME" = "ToolSearch" ]; then
  QUERY=$(echo "$INPUT" | jq -r '.tool_input.query // empty')

  [ -z "$QUERY" ] && exit 0

  # Extract server/tool name from query:
  #   "select:mcp__firebase__get_doc" -> "firebase"
  #   "+firebase create" -> "firebase"
  #   "firebase" -> "firebase"
  #   "slack message" -> "slack"
  SERVER=$(echo "$QUERY" | sed 's/^select://; s/^+//; s/^mcp__//; s/__.*//; s/ .*//')

  [ -z "$SERVER" ] && exit 0

  jq --arg server "$SERVER" \
     --arg date "$TODAY" \
     '
     .tool_searches //= {} |
     .tool_searches[$server] //= {"searches": 0, "last": null} |
     .tool_searches[$server].searches += 1 |
     .tool_searches[$server].last = $date
     ' "$STATS_FILE" > "${STATS_FILE}.tmp" && mv "${STATS_FILE}.tmp" "$STATS_FILE"
fi

exit 0
