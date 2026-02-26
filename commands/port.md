# Port Feature

Port a feature from a source codebase to the current (target) codebase. Analyzes the source implementation, creates an adaptation plan, implements the port, and verifies it works correctly.

## Context

```bash
# Target codebase info (current directory)
echo "=== TARGET CODEBASE ==="
pwd
echo ""

# Detect target stack
echo "--- Target Stack Detection ---"
if ls *.xcodeproj 1>/dev/null 2>&1 || [ -f "Package.swift" ]; then
    echo "Stack: iOS/Swift"
    ls -la *.xcodeproj 2>/dev/null || true
    head -20 Package.swift 2>/dev/null || true
elif [ -f "package.json" ]; then
    echo "Stack: JavaScript/TypeScript"
    head -30 package.json
elif [ -f "go.mod" ]; then
    echo "Stack: Go"
    head -20 go.mod
elif [ -f "pyproject.toml" ]; then
    echo "Stack: Python"
    head -30 pyproject.toml
elif [ -f "pubspec.yaml" ]; then
    echo "Stack: Flutter/Dart"
    head -20 pubspec.yaml
elif [ -f "Cargo.toml" ]; then
    echo "Stack: Rust"
    head -20 Cargo.toml
else
    echo "Stack: Unknown - will need manual detection"
fi
echo ""

# Target structure
echo "--- Target Structure ---"
find . -maxdepth 3 -type d ! -path "*/.*" ! -path "*/node_modules/*" ! -path "*/build/*" ! -path "*/.build/*" 2>/dev/null | head -40
echo ""

# Git status
echo "--- Git Status ---"
git status --short 2>/dev/null | head -20 || echo "Not a git repo"
echo ""

# Check for existing port plans
echo "--- Existing Port Plans ---"
ls -la .claude/port-plans/ 2>/dev/null || echo "No existing port plans"
```

## Instructions

**IMPORTANT**: You (main Claude) orchestrate this pipeline directly. Reference `~/.claude/agents/port-pipeline-manager.md` for pipeline structure, stage flow, and quality gates. When launching any agent via Task, only use `model: "opus"` or `model: "sonnet"` — never `model: "haiku"`.

### Arguments

```
/port "feature description" --source /path/to/source
/port "feature description" --source /path/to/source --plan-only
/port "feature description" --source /path/to/source --focus "specific aspect"
/port "feature description" --source /path/to/source --replaces "existing feature or files"
/port "feature description" --source /path/to/source --name "custom-slug"
/port --continue [slug]
/port --retry [slug] --stage [STAGE]
/port $ARGUMENTS
```

| Argument | Required | Description |
|----------|----------|-------------|
| "feature description" | Yes | What feature to port (in quotes) |
| --source | Yes | Path to source codebase |
| --plan-only | No | Stop after PLAN stage for review |
| --focus | No | Narrow scope to specific aspect of feature |
| --replaces | No | Existing code/feature in target to replace (files or description) |
| --name | No | Custom slug for the port plan directory |
| --continue | No | Resume a paused pipeline |
| --retry | No | Retry a failed stage |

### Pipeline Overview

```
ANALYZE → PLAN → IMPLEMENT → VERIFY
```

1. **ANALYZE**: Deep analysis of feature in source codebase
2. **PLAN**: Create implementation plan adapted for target codebase
3. **IMPLEMENT**: Execute the plan (developer agent varies by target stack)
4. **VERIFY**: Test and validate the ported feature

### Execution Steps

1. **Validate Arguments**
   - Ensure feature description is provided
   - Ensure --source path exists and is accessible
   - Check for --plan-only, --focus, --name flags

2. **Initialize Pipeline**
   - Create `.claude/port-plans/[slug]/` directory
   - Generate slug from feature description (or use --name)
   - Write initial `pipeline.json`

3. **Gather Source Context**
   Read source codebase to understand its stack:
   ```bash
   # Run in source directory
   cd [source-path]

   echo "=== SOURCE CODEBASE ==="
   pwd

   # Detect source stack (same detection as target)
   # ... [stack detection commands]

   # Source structure
   find . -maxdepth 3 -type d ! -path "*/.*" ! -path "*/node_modules/*" | head -40
   ```

4. **Run ANALYZE Stage**
   - Launch `feature-analyzer` agent via Task tool
   - Provide: feature description, source path, target path, focus (if any)
   - Agent reads source files and produces `analysis.md`
   - Validate quality gate before proceeding

5. **Run PLAN Stage**
   - Launch `code-architect` agent via Task tool
   - Provide: analysis.md content, target codebase context
   - Agent creates `plan.md` with implementation steps
   - Validate quality gate before proceeding
   - **If --plan-only**: Stop here, output summary, exit

6. **Run IMPLEMENT Stage**
   - Detect target stack (iOS, Web, Python, Go, etc.)
   - Select appropriate developer agent
   - Launch developer agent via Task tool
   - Provide: plan.md content, target codebase access
   - Developer implements all planned changes
   - Validate: code compiles, no placeholders

7. **Run VERIFY Stage**
   - Select appropriate tester agent for target type
   - Launch tester agent via Task tool
   - Run tests, verify acceptance criteria
   - Produce `verification.md` with results
   - Report final status

### Developer Agent Selection

| Target | Agent to Launch |
|--------|-----------------|
| `*.xcodeproj`, `Package.swift` | ios-developer |
| `package.json` + react | web-developer |
| `package.json` (no react) | typescript-developer |
| `go.mod` | go-developer |
| `pyproject.toml` | python-developer |
| Other / Unknown | typescript-developer (fallback) |

**Note**: If the target stack has no matching developer agent, the pipeline uses typescript-developer as a general-purpose fallback. Review the output more carefully for language-specific idioms.

### Tester Agent Selection

| Target | Agent to Launch |
|--------|-----------------|
| iOS App | app-tester |
| Web App | app-tester |
| Backend/API | qa-engineer |

### Output Location

All artifacts are saved to:
```
.claude/port-plans/[feature-slug]/
├── pipeline.json
├── analysis.md
├── plan.md
└── verification.md
```

### Error Recovery

If the pipeline fails at any stage:
1. Check `.claude/port-plans/[slug]/pipeline.json` for status
2. Review the last completed stage's output
3. Resume with `/port --retry [slug] --stage [FAILED_STAGE]`

### Example Session

```
> /port "user authentication with OAuth" --source ~/projects/other-app

══════════════════════════════════════════════════════════════
STARTING PORT PIPELINE
══════════════════════════════════════════════════════════════
Feature: user authentication with OAuth
Source: ~/projects/other-app (React/TypeScript)
Target: /current/project (iOS/Swift)
Plan directory: .claude/port-plans/user-authentication-oauth/

Beginning ANALYZE stage...
[feature-analyzer works]

══════════════════════════════════════════════════════════════
STAGE COMPLETE: ANALYZE
══════════════════════════════════════════════════════════════
...
```

### Workflow Controls

| Command | Action |
|---------|--------|
| `continue` / `y` | Proceed to next stage |
| `pause` | Stop and save state |
| `show analysis` | Display analysis.md |
| `show plan` | Display plan.md |
| `abort` | Cancel pipeline |

### Post-Completion: CAPTURE-LEARNINGS

After the port is complete, capture agent-level learnings. This feeds the self-improvement loop.

**Process**:
1. Review the port pipeline — analysis accuracy, plan quality, implementation fidelity
2. For each genuine learning, append an entry to `~/.claude/AGENT-IMPROVE.md` using the standard entry format (see `~/.claude/agents/improve-pipeline-manager.md` for format)
3. If the pipeline ran smoothly, capture zero learnings — do NOT invent entries
4. Classify each learning at capture time:
   - **UNIVERSAL**: Would benefit any project using this agent (general best practices, language-level patterns)
   - **PROJECT**: Specific to this project (conventions, dependencies, domain knowledge)
   - **PROCESS**: Suggests a pipeline/command workflow change
   - If unsure, default to PROJECT

**Focus areas for port**:
- Did feature-analyzer identify all boundaries and dependencies correctly?
- Did the adaptation plan account for target codebase conventions?
- Were cross-platform differences handled well by the developer agent?

After capturing (or skipping), the AUTO-IMPROVE stage runs next.

---

### AUTO-IMPROVE

After CAPTURE-LEARNINGS, automatically run the improve pipeline if enough entries have accumulated.

**Process**:
1. Count entries in `~/.claude/AGENT-IMPROVE.md` (count `## Entry:` headers)
2. If file doesn't exist or has 0 entries: skip silently, proceed to next stage
3. If 1-2 entries: print "X entries in AGENT-IMPROVE.md (below threshold of 3). Deferring to next pipeline run." and proceed
4. If 3+ entries: run the improve pipeline with `--minor-only` behavior:
   - Read `~/.claude/agents/improve-pipeline-manager.md` for full stage guidance
   - Execute COLLECT → CLASSIFY → ANALYZE → PROPOSE → APPLY → VERIFY → CURATE
   - Auto-apply minor changes (Common Pitfalls, Quality Standards, project memory entries)
   - Log major proposals to `~/.claude/IMPROVE-CHANGELOG.md` but do NOT prompt for approval — defer to explicit `/improve` run
   - Clear processed minor entries from AGENT-IMPROVE.md; keep major entries for later

**Summary box** (print after AUTO-IMPROVE completes or skips):
```
┌──────────────────────────────────────────────────────────────────┐
│ AUTO-IMPROVE (port)                                               │
│                                                                  │
│ Entries found: [N]                                               │
│ Threshold: 3                                                     │
│ Action: [skipped — no entries | deferred — below threshold |     │
│          ran — N minor applied, N major deferred]                │
└──────────────────────────────────────────────────────────────────┘
```

---

### Notes

- The source path must be accessible (local filesystem)
- Both codebases should ideally be git repositories
- Large features benefit from --focus to break into smaller ports
- Use --plan-only first for complex ports to review before implementing
- Pipeline state is persisted, so you can resume after interruption

