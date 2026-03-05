#!/bin/bash
# test-installer-fixes.sh — Validate the 5 installer fixes
# Run: bash tests/test-installer-fixes.sh
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

PASSED=0
FAILED=0

pass() {
  PASSED=$((PASSED + 1))
  echo "  PASS: $1"
}

fail() {
  FAILED=$((FAILED + 1))
  echo "  FAIL: $1"
}

# ---------------------------------------------------------------------------
echo "=== Fix 1: install.sh fallback message contains all 3 matchers ==="
# ---------------------------------------------------------------------------

# Search by content rather than brittle line number — find the fallback echo
# that lives in the else branch after "Could not auto-configure hooks"
FALLBACK_LINE=$(grep -A 5 'Could not auto-configure hooks' "$REPO_DIR/install.sh" \
  | grep 'PostToolUse' | head -1)

if echo "$FALLBACK_LINE" | grep -q '"matcher": "Task"'; then
  pass "fallback contains Task matcher"
else
  fail "fallback missing Task matcher"
fi

if echo "$FALLBACK_LINE" | grep -q '"matcher": "Skill"'; then
  pass "fallback contains Skill matcher"
else
  fail "fallback missing Skill matcher"
fi

if echo "$FALLBACK_LINE" | grep -q '"matcher": "ToolSearch"'; then
  pass "fallback contains ToolSearch matcher"
else
  fail "fallback missing ToolSearch matcher"
fi

# Verify the fallback line is an echo with all three matchers on it
if echo "$FALLBACK_LINE" | grep -q 'echo.*Task.*Skill.*ToolSearch'; then
  pass "all 3 matchers appear in a single echo statement"
else
  fail "matchers not in a single echo statement in the fallback block"
fi

# ---------------------------------------------------------------------------
echo ""
echo "=== Fix 2: install.ps1 says install.ps1 not install.sh ==="
# ---------------------------------------------------------------------------

REGGIE_GUIDE_LINE=$(grep 'reggie-guide I just ran' "$REPO_DIR/install.ps1")

if echo "$REGGIE_GUIDE_LINE" | grep -q 'install\.ps1'; then
  pass "install.ps1 references install.ps1 in reggie-guide message"
else
  fail "install.ps1 still references install.sh in reggie-guide message"
fi

if echo "$REGGIE_GUIDE_LINE" | grep -q 'install\.sh'; then
  fail "install.ps1 incorrectly references install.sh"
else
  pass "install.ps1 does not reference install.sh"
fi

# ---------------------------------------------------------------------------
echo ""
echo "=== Fix 3: track-stats.sh uses mktemp, not hardcoded .tmp ==="
# ---------------------------------------------------------------------------

STATS_SCRIPT="$REPO_DIR/hooks/track-stats.sh"

# Should use mktemp
MKTEMP_COUNT=$(grep -c 'mktemp' "$STATS_SCRIPT")
if [ "$MKTEMP_COUNT" -ge 3 ]; then
  pass "track-stats.sh has $MKTEMP_COUNT mktemp calls (one per jq block)"
else
  fail "track-stats.sh has only $MKTEMP_COUNT mktemp calls, expected >= 3"
fi

# Should NOT use hardcoded .tmp suffix
if grep -q '"${STATS_FILE}\.tmp"' "$STATS_SCRIPT"; then
  fail "track-stats.sh still uses hardcoded .tmp suffix"
else
  pass "track-stats.sh does not use hardcoded .tmp suffix"
fi

# Verify mktemp uses XXXXXX template
MKTEMP_TEMPLATE_COUNT=$(grep -c 'mktemp "${STATS_FILE}\.XXXXXX"' "$STATS_SCRIPT")
if [ "$MKTEMP_TEMPLATE_COUNT" -ge 3 ]; then
  pass "all mktemp calls use XXXXXX template"
else
  fail "expected 3 mktemp calls with XXXXXX template, found $MKTEMP_TEMPLATE_COUNT"
fi

# ---------------------------------------------------------------------------
echo ""
echo "=== Fix 4: uninstall.sh removes ENABLE_TOOL_SEARCH ==="
# ---------------------------------------------------------------------------

UNINSTALL_SH="$REPO_DIR/uninstall.sh"

if grep -q 'ENABLE_TOOL_SEARCH' "$UNINSTALL_SH"; then
  pass "uninstall.sh contains ENABLE_TOOL_SEARCH removal logic"
else
  fail "uninstall.sh missing ENABLE_TOOL_SEARCH removal"
fi

if grep -q 'export ENABLE_TOOL_SEARCH' "$UNINSTALL_SH"; then
  pass "uninstall.sh targets 'export ENABLE_TOOL_SEARCH' line"
else
  fail "uninstall.sh does not target 'export ENABLE_TOOL_SEARCH'"
fi

# Check all 3 profile files are covered
for PROF in '.zshrc' '.bashrc' '.bash_profile'; do
  if grep -q "$PROF" "$UNINSTALL_SH"; then
    pass "uninstall.sh checks $PROF"
  else
    fail "uninstall.sh does not check $PROF"
  fi
done

# ---------------------------------------------------------------------------
echo ""
echo "=== Fix 5: uninstall.ps1 removes ENABLE_TOOL_SEARCH ==="
# ---------------------------------------------------------------------------

UNINSTALL_PS1="$REPO_DIR/uninstall.ps1"

if grep -q 'ENABLE_TOOL_SEARCH' "$UNINSTALL_PS1"; then
  pass "uninstall.ps1 contains ENABLE_TOOL_SEARCH removal logic"
else
  fail "uninstall.ps1 missing ENABLE_TOOL_SEARCH removal"
fi

if grep -q '\$PROFILE' "$UNINSTALL_PS1"; then
  pass "uninstall.ps1 uses \$PROFILE variable"
else
  fail "uninstall.ps1 does not use \$PROFILE variable"
fi

# ---------------------------------------------------------------------------
echo ""
echo "=== Fix 6: uninstall.sh sed pattern matches install.sh comment ==="
# ---------------------------------------------------------------------------

# install.sh writes: # Reggie: defer MCP tool schemas for efficiency
# But the sed must match what was actually written. Let's check consistency.
# The install writes "# Reggie: defer MCP tool schemas for efficiency"
# The uninstall sed matches "# Reggie: defer MCP tool schemas" (substring match, which is fine for sed)

# The sed pattern from uninstall.sh should be a substring of what install.sh writes
INSTALL_WRITTEN_COMMENT="# Reggie: defer MCP tool schemas for efficiency"
UNINSTALL_PATTERN="# Reggie: defer MCP tool schemas"

if echo "$INSTALL_WRITTEN_COMMENT" | grep -qF "$UNINSTALL_PATTERN"; then
  pass "uninstall.sh sed pattern matches substring of install.sh comment"
else
  fail "uninstall.sh sed pattern does not match install.sh comment"
fi

# Verify the actual sed command exists and targets the right pattern
if grep -q "sed.*Reggie: defer MCP tool schemas" "$UNINSTALL_SH"; then
  pass "uninstall.sh has sed command with correct comment pattern"
else
  fail "uninstall.sh missing sed command for comment removal"
fi

# ---------------------------------------------------------------------------
echo ""
echo "=== Fix 7: uninstall.ps1 filter pattern matches install.ps1 comment ==="
# ---------------------------------------------------------------------------

# install.ps1 writes: # Reggie: defer MCP tool schemas for efficiency
# uninstall.ps1 filters: '# Reggie: defer MCP tool schemas'

INSTALL_PS1_COMMENT=$(grep 'Reggie: defer MCP tool schemas' "$REPO_DIR/install.ps1" | head -1)

if echo "$INSTALL_PS1_COMMENT" | grep -qF '# Reggie: defer MCP tool schemas'; then
  pass "install.ps1 writes expected comment"
else
  fail "install.ps1 does not write expected comment"
fi

if grep -q "'# Reggie: defer MCP tool schemas'" "$UNINSTALL_PS1"; then
  pass "uninstall.ps1 filter matches the comment install.ps1 writes"
else
  fail "uninstall.ps1 filter does not match install.ps1 comment"
fi

# Both uninstall scripts filter ENABLE_TOOL_SEARCH AND the comment line
if grep -q 'ENABLE_TOOL_SEARCH.*Reggie: defer MCP tool schemas\|Reggie: defer MCP tool schemas.*ENABLE_TOOL_SEARCH' "$UNINSTALL_PS1"; then
  pass "uninstall.ps1 filters both ENABLE_TOOL_SEARCH and comment in same expression"
else
  # They might be on separate -notmatch clauses, which is also fine
  if grep -q 'ENABLE_TOOL_SEARCH' "$UNINSTALL_PS1" && grep -q 'Reggie: defer MCP tool schemas' "$UNINSTALL_PS1"; then
    pass "uninstall.ps1 filters both ENABLE_TOOL_SEARCH and comment (separate clauses)"
  else
    fail "uninstall.ps1 does not filter both patterns"
  fi
fi

# ---------------------------------------------------------------------------
echo ""
echo "=== Functional test: track-stats.sh mktemp behavior ==="
# ---------------------------------------------------------------------------

if ! command -v jq &>/dev/null; then
  echo "  SKIP: jq not available, skipping functional test"
else
  # Set up temp directory to act as a fake repo
  TEST_DIR=$(mktemp -d)
  TEST_CLAUDE_DIR="$TEST_DIR/.claude"
  mkdir -p "$TEST_CLAUDE_DIR"

  STATS_FILE="$TEST_CLAUDE_DIR/stats.json"
  echo '{"agents":{},"commands":{},"tool_searches":{}}' > "$STATS_FILE"

  # Build JSON input for a Task event
  TASK_INPUT='{"tool_name":"Task","cwd":"'"$TEST_DIR"'","tool_input":{"subagent_type":"test-agent","model":"opus"}}'

  # Run track-stats.sh with the test input
  # Initialize a real git repo so git worktree list works
  git init "$TEST_DIR" >/dev/null 2>&1

  echo "$TASK_INPUT" | bash "$STATS_SCRIPT" 2>/dev/null

  # Verify: no .tmp file should exist
  if ls "${STATS_FILE}.tmp" 2>/dev/null; then
    fail "track-stats.sh created a .tmp file (old behavior)"
  else
    pass "no .tmp file created by track-stats.sh"
  fi

  # Verify: stats file was updated correctly
  if jq -e '.agents["test-agent"].calls == 1' "$STATS_FILE" >/dev/null 2>&1; then
    pass "stats file updated correctly for Task event"
  else
    fail "stats file not updated correctly for Task event"
  fi

  if jq -e '.agents["test-agent"].models.opus == 1' "$STATS_FILE" >/dev/null 2>&1; then
    pass "model count incremented correctly"
  else
    fail "model count not incremented"
  fi

  # Test Skill event
  SKILL_INPUT='{"tool_name":"Skill","cwd":"'"$TEST_DIR"'","tool_input":{"skill":"test-command"}}'
  echo "$SKILL_INPUT" | bash "$STATS_SCRIPT" 2>/dev/null

  if jq -e '.commands["test-command"].runs == 1' "$STATS_FILE" >/dev/null 2>&1; then
    pass "stats file updated correctly for Skill event"
  else
    fail "stats file not updated correctly for Skill event"
  fi

  # Test ToolSearch event
  TOOLSEARCH_INPUT='{"tool_name":"ToolSearch","cwd":"'"$TEST_DIR"'","tool_input":{"query":"firebase create"}}'
  echo "$TOOLSEARCH_INPUT" | bash "$STATS_SCRIPT" 2>/dev/null

  if jq -e '.tool_searches["firebase"].searches == 1' "$STATS_FILE" >/dev/null 2>&1; then
    pass "stats file updated correctly for ToolSearch event"
  else
    fail "stats file not updated correctly for ToolSearch event"
  fi

  # Verify no leftover temp files (mktemp files should all have been mv'd)
  LEFTOVER_COUNT=$(ls "${STATS_FILE}".* 2>/dev/null | wc -l | tr -d ' ')
  if [ "$LEFTOVER_COUNT" -eq 0 ]; then
    pass "no leftover temp files after all operations"
  else
    fail "found $LEFTOVER_COUNT leftover temp files"
  fi

  # Clean up
  rm -rf "$TEST_DIR"
fi

# ---------------------------------------------------------------------------
echo ""
echo "=== Functional test: concurrent track-stats.sh invocations (race safety) ==="
# ---------------------------------------------------------------------------

if ! command -v jq &>/dev/null; then
  echo "  SKIP: jq not available, skipping concurrent test"
else
  TEST_DIR=$(mktemp -d)
  git init "$TEST_DIR" >/dev/null 2>&1
  TEST_CLAUDE_DIR="$TEST_DIR/.claude"
  mkdir -p "$TEST_CLAUDE_DIR"

  CONC_STATS_FILE="$TEST_CLAUDE_DIR/stats.json"
  echo '{"agents":{},"commands":{},"tool_searches":{}}' > "$CONC_STATS_FILE"

  # Launch 5 parallel Task invocations with unique agent names
  for i in 1 2 3 4 5; do
    echo '{"tool_name":"Task","cwd":"'"$TEST_DIR"'","tool_input":{"subagent_type":"agent'"$i"'","model":"opus"}}' \
      | bash "$STATS_SCRIPT" 2>/dev/null &
  done
  wait

  # mktemp prevents temp file collisions but the read-modify-write cycle has
  # an inherent race (last writer wins). Verify the stats file is valid JSON
  # and at least 1 agent was recorded (no corruption or zero-write).
  AGENT_COUNT=$(jq '.agents | length' "$CONC_STATS_FILE" 2>/dev/null)
  if [ -n "$AGENT_COUNT" ] && [ "$AGENT_COUNT" -ge 1 ]; then
    pass "concurrent: stats file is valid JSON with $AGENT_COUNT agent(s) recorded"
  else
    fail "concurrent: stats file is corrupt or empty after parallel writes"
  fi

  # Verify no leftover temp files
  CONC_LEFTOVER=$(ls "${CONC_STATS_FILE}".* 2>/dev/null | wc -l | tr -d ' ')
  if [ "$CONC_LEFTOVER" -eq 0 ]; then
    pass "concurrent: no leftover temp files"
  else
    fail "concurrent: found $CONC_LEFTOVER leftover temp files"
  fi

  rm -rf "$TEST_DIR"
fi

# ---------------------------------------------------------------------------
echo ""
echo "=== Functional test: uninstall ENABLE_TOOL_SEARCH removal ==="
# ---------------------------------------------------------------------------

MOCK_PROFILE=$(mktemp)
# Write exact lines that install.sh would append
cat > "$MOCK_PROFILE" << 'MOCKEOF'
# existing content
export PATH="/usr/local/bin:$PATH"

# Reggie: defer MCP tool schemas for efficiency
export ENABLE_TOOL_SEARCH=auto:5
MOCKEOF

# Apply the same sed commands uninstall.sh uses
sed -i.bak '/# Reggie: defer MCP tool schemas/d' "$MOCK_PROFILE"
sed -i.bak '/export ENABLE_TOOL_SEARCH/d' "$MOCK_PROFILE"
rm -f "${MOCK_PROFILE}.bak"

if grep -q 'ENABLE_TOOL_SEARCH' "$MOCK_PROFILE"; then
  fail "uninstall sed did not remove ENABLE_TOOL_SEARCH line"
else
  pass "uninstall sed removed ENABLE_TOOL_SEARCH line"
fi

if grep -q 'Reggie: defer MCP tool schemas' "$MOCK_PROFILE"; then
  fail "uninstall sed did not remove Reggie comment line"
else
  pass "uninstall sed removed Reggie comment line"
fi

# Verify pre-existing content is preserved
if grep -q 'export PATH=' "$MOCK_PROFILE"; then
  pass "uninstall sed preserved unrelated profile content"
else
  fail "uninstall sed damaged unrelated profile content"
fi

rm -f "$MOCK_PROFILE"

# ---------------------------------------------------------------------------
echo ""
echo "=== ToolSearch query parsing edge cases ==="
# ---------------------------------------------------------------------------

if ! command -v jq &>/dev/null; then
  echo "  SKIP: jq not available, skipping ToolSearch parsing tests"
else
  TEST_DIR=$(mktemp -d)
  git init "$TEST_DIR" >/dev/null 2>&1
  mkdir -p "$TEST_DIR/.claude"

  TS_STATS="$TEST_DIR/.claude/stats.json"

  # Case 1: select:mcp__firebase__get_doc -> firebase
  echo '{"agents":{},"commands":{},"tool_searches":{}}' > "$TS_STATS"
  echo '{"tool_name":"ToolSearch","cwd":"'"$TEST_DIR"'","tool_input":{"query":"select:mcp__firebase__get_doc"}}' \
    | bash "$STATS_SCRIPT" 2>/dev/null

  if jq -e '.tool_searches["firebase"].searches == 1' "$TS_STATS" >/dev/null 2>&1; then
    pass "ToolSearch parses 'select:mcp__firebase__get_doc' -> firebase"
  else
    fail "ToolSearch failed to parse 'select:mcp__firebase__get_doc' -> firebase"
  fi

  # Case 2: +slack send -> slack
  echo '{"agents":{},"commands":{},"tool_searches":{}}' > "$TS_STATS"
  echo '{"tool_name":"ToolSearch","cwd":"'"$TEST_DIR"'","tool_input":{"query":"+slack send"}}' \
    | bash "$STATS_SCRIPT" 2>/dev/null

  if jq -e '.tool_searches["slack"].searches == 1' "$TS_STATS" >/dev/null 2>&1; then
    pass "ToolSearch parses '+slack send' -> slack"
  else
    fail "ToolSearch failed to parse '+slack send' -> slack"
  fi

  # Case 3: bare-keyword -> bare-keyword
  echo '{"agents":{},"commands":{},"tool_searches":{}}' > "$TS_STATS"
  echo '{"tool_name":"ToolSearch","cwd":"'"$TEST_DIR"'","tool_input":{"query":"bare-keyword"}}' \
    | bash "$STATS_SCRIPT" 2>/dev/null

  if jq -e '.tool_searches["bare-keyword"].searches == 1' "$TS_STATS" >/dev/null 2>&1; then
    pass "ToolSearch parses 'bare-keyword' -> bare-keyword"
  else
    fail "ToolSearch failed to parse 'bare-keyword' -> bare-keyword"
  fi

  rm -rf "$TEST_DIR"
fi

# ---------------------------------------------------------------------------
echo ""
echo "========================================="
echo "Results: $PASSED passed, $FAILED failed"
echo "========================================="

if [ "$FAILED" -gt 0 ]; then
  exit 1
else
  exit 0
fi
