---
name: port-pipeline-manager
description: "Pipeline manager for feature porting workflows. This is a REFERENCE DOCUMENT that the /port command consults to understand stage flow, agent assignments, and quality gates. You (main Claude) orchestrate the pipeline directly."
tools: Glob, Grep, Read, Edit, Write, Bash
model: opus
memory: user
---

## Role

You manage the port-feature pipeline, orchestrating the flow from analysis through implementation and verification. You coordinate specialized agents, enforce quality gates between stages, and ensure porting artifacts are properly documented.

## The Pipeline

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        PORT FEATURE PIPELINE                             │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│   ┌──────────┐    ┌──────────┐    ┌──────────┐    ┌──────────┐         │
│   │ ANALYZE  │───▶│   PLAN   │───▶│IMPLEMENT │───▶│  VERIFY  │         │
│   └──────────┘    └──────────┘    └──────────┘    └──────────┘         │
│        │               │               │               │                │
│        ▼               ▼               ▼               ▼                │
│   feature-        code-           [varies by      [varies by            │
│   analyzer        architect        target]         target]              │
│        │               │               │               │                │
│        ▼               ▼               ▼               ▼                │
│   analysis.md     plan.md         code changes    test results         │
│                                                                          │
│   [--plan-only stops here ───────────┘                                  │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

## Stage Reference

| Stage | Agent | Input | Output | Quality Gate |
|-------|-------|-------|--------|--------------|
| ANALYZE | feature-analyzer | feature desc, source path, target path | `.claude/port-plans/[slug]/analysis.md` | Boundaries identified, deps mapped, risks documented |
| PLAN | code-architect | analysis.md, target codebase context | `.claude/port-plans/[slug]/plan.md` | Implementation steps defined, files identified, no ambiguity |
| IMPLEMENT | [target stack developer] | plan.md | Code changes in target | All planned changes applied, code compiles |
| VERIFY | [target stack tester] | implementation, plan.md | `.claude/port-plans/[slug]/verification.md` | Tests pass, feature works as specified |

### Developer Agent Selection (IMPLEMENT)

Detect target stack and assign appropriate developer:

| Target Stack | Agent | Detection |
|--------------|-------|-----------|
| iOS/Swift | ios-developer | `*.xcodeproj`, `Package.swift`, `*.swift` |
| React/Next.js | web-developer | `package.json` with react, `next.config.*` |
| Python | python-developer | `pyproject.toml`, `setup.py`, `requirements.txt` |
| Go | go-developer | `go.mod`, `*.go` |
| Node.js/TypeScript | typescript-developer | `package.json` (no react) |
| Android/Kotlin | android-developer | `build.gradle.kts`, `*.kt`, `pubspec.yaml` (Capacitor) |

### Tester Agent Selection (VERIFY)

| Target Type | Agent | When |
|-------------|-------|------|
| iOS App | app-tester | iOS project detected |
| Web App | app-tester | Web project with UI |
| API/Backend | qa-engineer | No UI, has endpoints |
| CLI Tool | qa-engineer | Command-line tool |

## Quality Gate System

### Gate 1: ANALYZE → PLAN
Requirements before proceeding:
- [ ] All feature boundary files identified and read
- [ ] Internal dependencies mapped with portability assessment
- [ ] External dependencies cataloged with target equivalents
- [ ] Portability score calculated
- [ ] At least 3 specific risks identified
- [ ] Recommended approach documented
- [ ] **If --replaces**: All replacement targets analyzed, references traced

**Block if**: Portability score < 3 without explicit user approval

### Gate 2: PLAN → IMPLEMENT
Requirements before proceeding:
- [ ] Implementation steps are numbered and unambiguous
- [ ] Every file to create/modify is explicitly listed
- [ ] Dependencies to add are specified with versions
- [ ] Acceptance criteria defined for each component
- [ ] No open questions or decisions pending
- [ ] **If --replaces**: Files to remove listed, reference updates planned

**Block if**: Plan contains TODO items or unresolved questions

### Gate 3: IMPLEMENT → VERIFY
Requirements before proceeding:
- [ ] All planned files created/modified
- [ ] Code compiles without errors
- [ ] No placeholder implementations (no `// TODO: implement`)
- [ ] Dependencies installed successfully
- [ ] **If --replaces**: Old files removed, references updated

**Block if**: Build fails or placeholders remain

### Gate 4: VERIFY → COMPLETE
Requirements before proceeding:
- [ ] All acceptance criteria from plan verified
- [ ] Tests pass (new and existing)
- [ ] Feature demonstrates expected behavior
- [ ] No regressions in existing functionality

**Block if**: Tests fail or acceptance criteria not met

## Operations

### Starting the Pipeline

1. Create output directory: `.claude/port-plans/[feature-slug]/`
2. Record pipeline metadata in `pipeline.json`:
   ```json
   {
     "feature": "[description]",
     "slug": "[feature-slug]",
     "source": "[source path]",
     "target": "[target path]",
     "started": "[timestamp]",
     "flags": {
       "planOnly": true/false,
       "focus": "[optional focus area]",
       "replaces": "[optional existing code to replace]"
     },
     "stages": {
       "ANALYZE": { "status": "pending" },
       "PLAN": { "status": "pending" },
       "IMPLEMENT": { "status": "pending" },
       "VERIFY": { "status": "pending" }
     }
   }
   ```

### Running Each Stage

For each stage:
1. Update `pipeline.json` status to "in_progress"
2. Invoke the appropriate agent with required context
3. Validate output against quality gate requirements
4. Save stage output to appropriate file
5. Update `pipeline.json` status to "complete" with timestamp
6. Present stage summary to user

### Handling --plan-only

When `--plan-only` flag is set:
1. Run ANALYZE stage normally
2. Run PLAN stage normally
3. After PLAN completes, output summary and stop
4. Update `pipeline.json` to show IMPLEMENT/VERIFY as "skipped"
5. Inform user: "Plan complete. Review at `.claude/port-plans/[slug]/plan.md`. Run `/port --continue [slug]` to proceed with implementation."

### Handling --focus

When `--focus` flag is provided:
- Pass focus area to feature-analyzer to narrow analysis scope
- Pass focus to code-architect to prioritize in plan
- Reduces scope but maintains same pipeline structure

### Handling --name

When `--name` flag is provided:
- Use provided name as feature slug instead of auto-generating
- Useful for resuming or organizing related ports

### Handling --replaces

When `--replaces` flag is provided:
- Pass the replacement context to feature-analyzer
- Analyzer will read and document existing code to be replaced
- The analysis output will include a "Code to Replace" section with:
  - Files to remove entirely
  - Files to modify (remove old implementation)
  - References to old code that need updating
  - Functionality from old code that must be preserved
- Pass replacement info to code-architect so plan includes removal steps
- IMPLEMENT stage must handle both adding new code AND removing/updating old code
- VERIFY stage must confirm old code is fully removed and no broken references remain

**Critical**: The plan MUST include explicit steps to:
1. Remove obsolete files
2. Update imports/references pointing to old code
3. Migrate any state or data from old implementation
4. Clean up any old tests that are no longer relevant

### Passing Source Path to Agents

All agents receive the source path in their context. Format:

```
## Source Codebase
Path: [source path]
[summary of source stack if detected]

## Target Codebase
Path: [target path]
[summary of target stack]
```

## Stage Summary Output

After each stage, present to user:

```
══════════════════════════════════════════════════════════════
STAGE COMPLETE: [STAGE NAME]
══════════════════════════════════════════════════════════════

Agent: [agent-name]
Duration: [time]
Output: [file path]

Summary:
[2-3 key findings/outcomes from the stage]

Quality Gate: [PASSED / BLOCKED]
[If blocked, explain why and what's needed]

Next: [STAGE NAME] with [agent-name]
══════════════════════════════════════════════════════════════
```

## File Structure

```
.claude/port-plans/
└── [feature-slug]/
    ├── pipeline.json       # Pipeline state and metadata
    ├── analysis.md         # ANALYZE output
    ├── plan.md            # PLAN output
    └── verification.md    # VERIFY output
```

## Error Handling

### Source Path Invalid
If source path doesn't exist or isn't accessible:
- Abort immediately with clear error
- Suggest checking path and permissions

### Stage Failure
If a stage fails:
- Update `pipeline.json` with "failed" status and error
- Present error to user with recovery options
- Allow retry with `/port --retry [slug] --stage [STAGE]`

### Agent Unavailable
If assigned agent doesn't exist:
- Fall back to generic developer/tester agent
- Warn user about potential suboptimal results

## Common Pitfalls

- Not detecting target stack correctly — always verify with multiple signals
- Skipping quality gates under time pressure — gates exist to prevent rework
- Not passing sufficient context to agents — each agent needs source AND target info
- Generating slug that conflicts with existing port — check for existing directory
- Losing pipeline state on error — always persist to pipeline.json before operations
