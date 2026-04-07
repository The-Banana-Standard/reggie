# Social Workflow

Adapt existing content into platform-specific social media posts.

## Context

```bash
echo "=== Recent Content ==="
find . -name "*.md" -path "*/articles/*" -o -name "*.md" -path "*/posts/*" -o -name "*.md" -path "*/content/*" 2>/dev/null | head -10

echo ""
echo "=== Current Task ==="
if [ -f "TASKS.md" ]; then
  cat TASKS.md
fi

echo ""
echo "=== Project Info ==="
pwd
```

## Instructions

This command orchestrates the **social media pipeline** — a workflow that takes existing long-form content and adapts it into platform-specific social posts with multiple variations for testing.

**IMPORTANT**: You (the main Claude) orchestrate this pipeline directly. Do NOT launch the content-pipeline-manager as a subagent — subagents cannot launch other subagents. Instead, read `~/.claude/agents/content-pipeline-manager.md` for detailed guidance, then run each stage yourself by launching the appropriate specialized agent via the Task tool. After each agent returns, launch the **judge** agent to score the output (9.0/10 threshold). Print the stage summary box after every stage. When launching any agent via Task, only use `model: "opus"` or `model: "sonnet"` — never `model: "haiku"`.

**`--yes` flag (Ralph Wiggum mode)**: If `$ARGUMENTS` contains `--yes`, strip it from arguments and skip ALL confirmation gates throughout the pipeline. All human prompts are auto-approved. Automated quality gates (9.0/10 judge scoring) still run normally.

### When to Use

- Just finished an article and want to promote it
- Have content that should be adapted for social platforms
- Need multiple variations for A/B testing
- Want platform-native posts (not just copy-paste across platforms)

### The Social Pipeline

```
EXTRACT-SNIPPETS → ADAPT-PER-PLATFORM → REVIEW
```

Every `→` is a quality gate (9.0/10 to advance).

### Pipeline Stages

**EXTRACT-SNIPPETS** — social-media-strategist reads the source content and identifies the most compelling angles, quotes, data points, and narratives. A single article may yield 3-5 distinct social angles.

**ADAPT-PER-PLATFORM** — social-media-strategist writes native content for each platform:
- **Twitter/X**: 280-char tweets, threads with numbered tweets, hook-first
- **LinkedIn**: Professional framing, "see more" optimized opening, 150-300 words
- **Instagram**: Visual-first captions, hashtag strategy, suggested visual assets
- **Threads**: Conversational, slightly longer than Twitter/X

Each angle gets 2-3 variations for A/B testing.

**REVIEW** — judge evaluates platform-nativeness, hook quality, variation distinctness, and value-before-promotion ratio.

### Arguments

```
/reggie-social-workflow                           # Find recent content to adapt
/reggie-social-workflow articles/streak-post.md   # Adapt specific file
/reggie-social-workflow $ARGUMENTS
```

### Workflow Controls

| Command | Action |
|---------|--------|
| `continue` / `y` | Proceed to next stage |
| `twitter only` | Only produce Twitter/X content |
| `linkedin only` | Only produce LinkedIn content |
| `show angles` | Display extracted angles |
| `more variations` | Generate additional variations |
| `pause` | Save progress |
| `status` | Show current position |

### Output

For each piece of source content:

```
## Source: [Title]

### Angles
1. [Angle — description]
2. [Angle — description]

### Twitter/X
**Angle 1 — Variation A:** [tweet]
**Angle 1 — Variation B:** [tweet]
**Angle 1 — Thread:** [numbered thread]

### LinkedIn
**Angle 1 — Variation A:** [post]
**Angle 1 — Variation B:** [post]

### Instagram
**Angle 1 — Variation A:** [caption]
**Suggested visual:** [description]
**Hashtags:** [set]

### Posting Strategy
- Lead platform: [where this performs best]
- Posting order: [sequence]
- Cross-linking: [how posts reference each other]
```

### Post-REVIEW: CAPTURE-LEARNINGS

After social content passes review, capture agent-level learnings. This feeds the self-improvement loop.

**Process**:
1. Review the social pipeline — snippet quality, platform adaptation, variation distinctness
2. For each genuine learning, append an entry to `~/.claude/AGENT-IMPROVE.md` using the standard entry format (see `~/.claude/agents/improve-pipeline-manager.md` for format)
3. If the pipeline ran smoothly, capture zero learnings — do NOT invent entries
4. Classify each learning at capture time:
   - **UNIVERSAL**: Would benefit any project using this agent (general best practices, language-level patterns)
   - **PROJECT**: Specific to this project (conventions, dependencies, domain knowledge)
   - **PROCESS**: Suggests a pipeline/command workflow change
   - If unsure, default to PROJECT

**Focus areas for social-workflow**:
- Were extracted snippets the most compelling angles?
- Were platform adaptations truly native (not just reformatted)?
- Were variations distinct enough for real A/B testing?

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
   - Log major proposals to `~/.claude/IMPROVE-CHANGELOG.md` but do NOT prompt for approval — defer to explicit `/reggie-improve` run
   - Clear processed minor entries from AGENT-IMPROVE.md; keep major entries for later

**Summary box** (print after AUTO-IMPROVE completes or skips):
```
┌──────────────────────────────────────────────────────────────────┐
│ AUTO-IMPROVE (social-workflow)                                    │
│                                                                  │
│ Entries found: [N]                                               │
│ Threshold: 3                                                     │
│ Action: [skipped — no entries | deferred — below threshold |     │
│          ran — N minor applied, N major deferred]                │
└──────────────────────────────────────────────────────────────────┘
```

---

### Example Session

```
> /reggie-social-workflow articles/streak-post.md

## EXTRACT-SNIPPETS Stage
Reading "What Duolingo Gets Wrong About Streaks"...

Angles identified:
1. Contrarian take — most streak systems are punitive
2. Practical — our positive streak implementation (with code)
3. Data — 40% retention improvement in 30 days
4. Personal — the moment I broke my 200-day streak

## ADAPT-PER-PLATFORM Stage

Twitter/X — Angle 1, Variation A:
"Most streak systems are designed to make you feel bad.
Duolingo's streak freeze costs gems.
GitHub's contribution graph guilts you into commits.
What if streaks rewarded consistency instead of punishing breaks?
Thread on what we built instead 🧵"

LinkedIn — Angle 3, Variation A:
"We changed one thing about our streak system and retention jumped 40% in 30 days.

The change? We stopped punishing users for missing a day..."

## REVIEW Stage
Score: 9.1/10 — PASS
Platform-native, distinct variations, strong hooks.
```

