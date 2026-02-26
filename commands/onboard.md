# Onboard Workflow

Prepare an existing repository for the Claude Code agent system.

## Context

```bash
echo "=== Project Root ==="
pwd

echo ""
echo "=== Existing Documentation ==="
ls -la *.md 2>/dev/null | head -20
ls -la docs/*.md 2>/dev/null | head -20

echo ""
echo "=== Existing Config Files ==="
ls -la .* 2>/dev/null | grep -E '\.(json|yaml|yml|toml|env)' | head -20
ls -la *.json *.yaml *.yml *.toml 2>/dev/null | head -20

echo ""
echo "=== Directory Structure ==="
find . -type d -maxdepth 3 | grep -v node_modules | grep -v .git | grep -v .worktree | head -40

echo ""
echo "=== Source Files Sample ==="
find . -type f \( -name "*.swift" -o -name "*.ts" -o -name "*.tsx" -o -name "*.js" -o -name "*.jsx" -o -name "*.py" -o -name "*.go" -o -name "*.kt" -o -name "*.java" -o -name "*.rs" \) 2>/dev/null | grep -v node_modules | head -30

echo ""
echo "=== Git Info ==="
git remote -v 2>/dev/null || echo "Not a git repo"
git log --oneline -5 2>/dev/null || echo "No commits"
git branch --show-current 2>/dev/null || echo "No branch"

echo ""
echo "=== Package Managers ==="
[ -f "package.json" ] && echo "Node: package.json found"
[ -f "Podfile" ] && echo "iOS: Podfile found"
ls *.xcodeproj 2>/dev/null && echo "iOS: Xcode project found"
[ -f "go.mod" ] && echo "Go: go.mod found"
[ -f "requirements.txt" ] && echo "Python: requirements.txt found"
[ -f "pyproject.toml" ] && echo "Python: pyproject.toml found"
[ -f "Cargo.toml" ] && echo "Rust: Cargo.toml found"
[ -f "build.gradle" ] && echo "Android/Java: build.gradle found"

echo ""
echo "=== Existing Agent Infrastructure ==="
[ -f "CLAUDE.md" ] && echo "CLAUDE.md: EXISTS" || echo "CLAUDE.md: NOT FOUND"
[ -f "TASKS.md" ] && echo "TASKS.md: EXISTS" || echo "TASKS.md: NOT FOUND"
[ -d ".pipeline" ] && echo ".pipeline/: EXISTS" || echo ".pipeline/: NOT FOUND"
```

## Instructions

This command runs the **onboard pipeline** — a 6-stage workflow that prepares any repository for the Claude Code agent system.

**IMPORTANT**: You (the main Claude) orchestrate this pipeline directly. Do NOT launch the onboard-pipeline-manager as a subagent — subagents cannot launch other subagents. Instead, read `~/.claude/agents/onboard-pipeline-manager.md` for detailed guidance, then run each stage yourself by launching the appropriate specialized agent via the Task tool. When launching any agent via Task, only use `model: "opus"` or `model: "sonnet"` — never `model: "haiku"`.

### Arguments

```
/onboard                    # Full onboard with tests and doc pruning
/onboard --skip-tests       # Skip VALIDATE stage (build/test verification)
/onboard --no-prune         # Skip REFINE stage (doc pruning)
$ARGUMENTS
```

### The Onboard Pipeline

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                                                                             │
│   DISCOVER → VALIDATE → ANALYZE → DOC-AUDIT → GENERATE → REFINE            │
│                                                                             │
│   With human checkpoints at ANALYZE and GENERATE                            │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

| Stage | Agent | Purpose | Skippable |
|-------|-------|---------|-----------|
| DISCOVER | researcher | Map structure, tech stack, docs, config | No |
| VALIDATE | (direct bash) | Run build/test to verify they work | `--skip-tests` |
| ANALYZE | researcher | Identify patterns, conventions, architecture | No |
| DOC-AUDIT | researcher | Assess existing docs for signal vs noise | No |
| GENERATE | technical-writer | Create CLAUDE.md, TASKS.md, .pipeline/, MEMORY.md | No |
| REFINE | technical-writer | Prune/update docs per audit recommendations | `--no-prune` |

---

## Stage Details

### Phase 1: DISCOVER

Launch **researcher** via Task tool with this prompt:

```
Perform a discovery audit of this repository. This is NOT a quality audit —
it's a structural mapping. I need to understand:

1. **Tech Stack**: Languages, frameworks, libraries, package managers
2. **Project Structure**: Directory layout, key directories, entry points
3. **Build System**: How to build, test, and run the project
4. **Existing Documentation**: README, docs/, inline docs, comments quality
5. **Configuration Files**: What configs exist (.env, firebase, xcode, etc.)
6. **Dependencies**: What external services/APIs does this depend on?
7. **Testing Setup**: Test framework, test location, how to run tests

Output in Discovery Report format. Be thorough but fast — this is reconnaissance.
```

No quality gate. Store results for later stages.

---

### Phase 2: VALIDATE

If `--skip-tests` in $ARGUMENTS, skip this stage.

Otherwise, run directly (no subagent):
1. Install dependencies (npm install, pod install, etc.)
2. Run build command
3. Run test command (if tests exist)
4. Record results — failures don't block, just get noted in CLAUDE.md

---

### Phase 3: ANALYZE

Launch **researcher** via Task tool with this prompt:

```
Analyze this codebase to identify patterns, conventions, and architecture.

[Include discovery results from Phase 1]

Search the codebase for:

1. **Architecture Pattern**: MVC, MVVM, Clean, etc. How is code organized?
2. **Naming Conventions**: camelCase, snake_case, file naming patterns
3. **Code Style**: Indentation, line length, bracket style
4. **Error Handling**: How are errors handled? Thrown? Returned? Logged?
5. **State Management**: How is state managed? Observables? Redux? SwiftUI?
6. **API Patterns**: How are API calls made? What service layer exists?
7. **Testing Patterns**: Unit vs integration, mocking approach
8. **Key Abstractions**: What are the core domain models and services?

Focus on PATTERNS, not issues. Document how this codebase works.
Output in Codebase Analysis format.
```

**Human checkpoint**: Present findings and ask user to confirm accuracy before continuing.

---

### Phase 4: DOC-AUDIT

Launch **researcher** via Task tool with this prompt:

```
Audit the existing documentation in this repository. For each doc:

1. **Signal vs Noise**: Is this useful context or outdated clutter?
2. **Accuracy**: Does it match current code reality?
3. **Redundancy**: Does it duplicate what CLAUDE.md will cover?
4. **Action**: KEEP (valuable), PRUNE (remove/archive), UPDATE (fix)

Check: README.md, docs/, CONTRIBUTING.md, inline documentation quality.
Output a Documentation Assessment with recommendations for each file.
```

No quality gate. Store recommendations for REFINE stage.

---

### Phase 5: GENERATE

Launch **technical-writer** via Task tool with this prompt:

```
Generate the Claude Code infrastructure files for this repository.
Use the discovery data, analysis, and doc audit from previous stages.

Create:

1. **CLAUDE.md** — Primary project context file with:
   - Project Overview (1 paragraph)
   - Commands section (build, test, run)
   - Architecture section (patterns, key directories)
   - Key Files table
   - Rules section (conventions, gotchas)
   - Patterns section (actual code examples from this codebase)

2. **TASKS.md** — Empty task tracker

3. **.pipeline/.gitkeep** — Pipeline metadata directory

4. **MEMORY.md** — Initial project memory with build/test gotchas

Make it specific to THIS project, not generic. Pull actual patterns from
the codebase analysis.
```

**Human checkpoint**: Show CLAUDE.md and ask user to approve before writing files.

---

### Phase 6: REFINE

If `--no-prune` in $ARGUMENTS, skip this stage.

Launch **technical-writer** via Task tool with this prompt:

```
Based on the DOC-AUDIT recommendations, clean up the documentation:

[Include doc audit results]

PRUNE actions: Move to docs/archive/ or delete (ask user preference)
UPDATE actions: Fix inaccuracies, sync with CLAUDE.md
KEEP actions: Leave unchanged

Show what you're changing and why.
```

---

## Completion

After all stages complete:

```
┌──────────────────────────────────────────────────────────────────┐
│ ONBOARD COMPLETE                                                 │
│                                                                  │
│ Files created:                                                   │
│   - CLAUDE.md (project context)                                  │
│   - TASKS.md (task tracker)                                      │
│   - .pipeline/.gitkeep (pipeline directory)                      │
│   - MEMORY.md (project memory)                                   │
│                                                                  │
│ Ready for:                                                       │
│   /audit           Run a full codebase audit                     │
│   /code-workflow   Start building features                       │
│   /plan            Plan a specific change                        │
│                                                                  │
│ Commit the new files? (y/n)                                      │
└──────────────────────────────────────────────────────────────────┘
```

If yes, commit with message: `chore: onboard project to Claude Code agent system`

---

## Post-Completion: CAPTURE-LEARNINGS

After onboard is complete and committed, capture agent-level learnings. This feeds the self-improvement loop.

**Process**:
1. Review the onboard pipeline — discovery quality, analysis accuracy, CLAUDE.md usefulness
2. For each genuine learning, append an entry to `~/.claude/AGENT-IMPROVE.md` using the standard entry format (see `~/.claude/agents/improve-pipeline-manager.md` for format)
3. If the pipeline ran smoothly, capture zero learnings — do NOT invent entries
4. Classify each learning at capture time:
   - **UNIVERSAL**: Would benefit any project using this agent (general best practices, language-level patterns)
   - **PROJECT**: Specific to this project (conventions, dependencies, domain knowledge)
   - **PROCESS**: Suggests a pipeline/command workflow change
   - If unsure, default to PROJECT

**Focus areas for onboard**:
- Did the discovery stage miss any key project aspects?
- Did researcher's analysis accurately identify patterns?
- Was the generated CLAUDE.md specific enough to be useful?
- Did doc pruning recommendations make sense?

After capturing (or skipping), the AUTO-IMPROVE stage runs next.

---

## AUTO-IMPROVE

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
│ AUTO-IMPROVE (onboard)                                            │
│                                                                  │
│ Entries found: [N]                                               │
│ Threshold: 3                                                     │
│ Action: [skipped — no entries | deferred — below threshold |     │
│          ran — N minor applied, N major deferred]                │
└──────────────────────────────────────────────────────────────────┘
```

---

## Workflow Controls

| Command | Action |
|---------|--------|
| `continue` / `y` | Proceed to next stage |
| `skip` | Skip current stage |
| `pause` | Save progress, exit workflow |
| `abort` | Cancel workflow |

---

## Error Handling

**Build/Test Failures**: Don't block. Add to CLAUDE.md under "Known Issues" section.

**Can't Detect Commands**: Ask user for the build/test command.

**Existing CLAUDE.md**: Ask user whether to overwrite, merge, or skip GENERATE.

**Not a Git Repo**: Offer to initialize git or continue without it.

