# Article Workflow

Execute the full article production pipeline from idea to published draft.

## Context

```bash
echo "=== Current Task ==="
if [ -f "TASKS.md" ]; then
  cat TASKS.md
fi

echo ""
echo "=== Article Inventory ==="
for f in content/articles/*.md content/articles/*.mdx 2>/dev/null; do
  [ -f "$f" ] || continue
  title=""; date=""; status=""; tags=""
  in_fm=0; in_tags=0
  while IFS= read -r line; do
    if [ "$line" = "---" ]; then
      if [ "$in_fm" -eq 1 ]; then break; fi
      in_fm=1; continue
    fi
    if [ "$in_fm" -eq 1 ]; then
      if echo "$line" | grep -q '^title:'; then
        title=$(echo "$line" | sed 's/^title:[[:space:]]*//' | sed 's/^"//;s/"$//')
        in_tags=0
      elif echo "$line" | grep -q '^date:'; then
        date=$(echo "$line" | sed 's/^date:[[:space:]]*//' | sed 's/^"//;s/"$//')
        in_tags=0
      elif echo "$line" | grep -q '^status:'; then
        status=$(echo "$line" | sed 's/^status:[[:space:]]*//')
        in_tags=0
      elif echo "$line" | grep -q '^tags:'; then
        inline=$(echo "$line" | sed 's/^tags:[[:space:]]*//')
        if echo "$inline" | grep -q '^\['; then
          tags=$(echo "$inline" | sed 's/^\[//;s/\]$//')
          in_tags=0
        else
          in_tags=1; tags=""
        fi
      elif [ "$in_tags" -eq 1 ]; then
        if echo "$line" | grep -q '^[[:space:]]*-'; then
          tag=$(echo "$line" | sed 's/^[[:space:]]*-[[:space:]]*//')
          if [ -n "$tags" ]; then tags="$tags, $tag"; else tags="$tag"; fi
        else
          in_tags=0
        fi
      fi
    fi
  done < "$f"
  [ -z "$status" ] && status="published"
  echo "  - \"$title\" ($date) [$status] [$tags]"
done

echo ""
echo "=== Product Registry ==="
for f in content/products/*.md content/products/*.mdx 2>/dev/null; do
  [ -f "$f" ] || continue
  name=""; pstatus=""
  in_fm=0
  while IFS= read -r line; do
    if [ "$line" = "---" ]; then
      if [ "$in_fm" -eq 1 ]; then break; fi
      in_fm=1; continue
    fi
    if [ "$in_fm" -eq 1 ]; then
      if echo "$line" | grep -q '^name:'; then
        name=$(echo "$line" | sed 's/^name:[[:space:]]*//' | sed 's/^"//;s/"$//')
      elif echo "$line" | grep -q '^status:'; then
        pstatus=$(echo "$line" | sed 's/^status:[[:space:]]*//')
      fi
    fi
  done < "$f"
  echo "  - $name ($pstatus)"
done

echo ""
echo "=== Tag Frequency ==="
all_tags=""
for f in content/articles/*.md content/articles/*.mdx 2>/dev/null; do
  [ -f "$f" ] || continue
  in_fm=0; in_tags=0
  while IFS= read -r line; do
    if [ "$line" = "---" ]; then
      if [ "$in_fm" -eq 1 ]; then break; fi
      in_fm=1; continue
    fi
    if [ "$in_fm" -eq 1 ]; then
      if echo "$line" | grep -q '^tags:'; then
        inline=$(echo "$line" | sed 's/^tags:[[:space:]]*//')
        if echo "$inline" | grep -q '^\['; then
          cleaned=$(echo "$inline" | sed 's/^\[//;s/\]$//')
          all_tags="$all_tags,$cleaned"
          in_tags=0
        else
          in_tags=1
        fi
      elif [ "$in_tags" -eq 1 ]; then
        if echo "$line" | grep -q '^[[:space:]]*-'; then
          tag=$(echo "$line" | sed 's/^[[:space:]]*-[[:space:]]*//')
          all_tags="$all_tags,$tag"
        else
          in_tags=0
        fi
      else
        in_tags=0
      fi
    fi
  done < "$f"
done
if [ -n "$all_tags" ]; then
  echo "$all_tags" | tr ',' '\n' | sed 's/^[[:space:]]*//;s/[[:space:]]*$//' | grep -v '^$' | sort | uniq -c | sort -rn | while read count tag; do
    echo "  $tag: $count"
  done
else
  echo "  (no tags found)"
fi

echo ""
echo "=== Voice Profile ==="
if [ -f .claude/voice-profile.md ]; then
  lines=$(wc -l < .claude/voice-profile.md | tr -d ' ')
  echo "  Status: project-level ($lines lines)"
elif [ -f ~/.claude/voice-profile.md ]; then
  lines=$(wc -l < ~/.claude/voice-profile.md | tr -d ' ')
  echo "  Status: system fallback ($lines lines)"
else
  echo "  Status: not found"
fi
echo "  Edit histories in progress:"
if [ -d .claude/voice-edits ] && [ "$(ls -A .claude/voice-edits 2>/dev/null)" ]; then
  for f in .claude/voice-edits/*.md; do
    [ -f "$f" ] || continue
    echo "    - $(basename "$f" .md)"
  done
else
  echo "    (none)"
fi

echo ""
echo "=== Project Info ==="
pwd
```

## Instructions

This command orchestrates the **article pipeline** — a workflow that takes a topic from brainstorm through research, outlining, drafting, editing, and review to produce a publication-ready article.

**IMPORTANT**: You (the main Claude) orchestrate this pipeline directly. Do NOT launch the content-pipeline-manager as a subagent — subagents cannot launch other subagents. Instead, read `~/.claude/agents/content-pipeline-manager.md` for detailed guidance, then run each stage yourself by launching the appropriate specialized agent via the Task tool. After each agent returns, launch the **judge** agent to score the output (9.0/10 threshold). Print the stage summary box after every stage. If the judge fails a stage, feed the feedback back to the stage agent, re-launch, and re-judge until it passes or escalates. When launching any agent via Task, only use `model: "opus"` or `model: "sonnet"` — never `model: "haiku"`.

### When to Use

- Writing a technical blog post or Substack article
- Want to turn a project experience into content
- Need a structured process to go from idea to finished article
- Want quality-gated writing with editorial review
- **Already have a draft** and want to refine it through human editing, review, and publishing

### The Article Pipeline

```
BRAINSTORM → RESEARCH → OUTLINE → DRAFT → EDIT → HUMAN-EDIT
                                                      ↓
                                              [satisfied?]
                                             ↙            ↘
                                          [no]            [yes]
                                            ↓                ↓
                                     RESEARCH PLAN        REVIEW → PUBLISH
                                     (from edits)
                                            ↓
                                     RESEARCH (targeted)
                                            ↓
                                     DRAFT → EDIT → HUMAN-EDIT (loop)
```

Every `→` is a quality gate (9.0/10 to advance). HUMAN-EDIT is a mandatory human checkpoint. After HUMAN-EDIT, the author decides: satisfied → REVIEW, or another pass → loops back through RESEARCH → DRAFT → EDIT → HUMAN-EDIT with their feedback as context.

### Pipeline Stages

**BRAINSTORM** — thought-partner explores the topic. What's the angle? Who cares? What's the one thing the reader should take away?

**RESEARCH** — researcher gathers supporting material: data, examples, quotes, competing perspectives, technical accuracy checks.

**OUTLINE** — content-producer structures the article: thesis, sections, key points per section, planned examples, estimated word count.

**DRAFT** — content-producer writes the full article (1500-3000 words target). Hook, body, conclusion with takeaway.

**EDIT** — editor performs structural editing, line editing, fact checking, voice consistency, and clarity enforcement.

**HUMAN-EDIT** — Claude saves a snapshot of the AI draft, then hands you the file. Edit it however you want — no special format needed. When you're done, Claude diffs your version against the snapshot to see exactly what you changed. Those changes teach Claude your writing personality (updated in `.claude/voice-profile.md`). Future articles start closer to your voice automatically. Use `//` comments to flag areas for research (`// need retention data here`, `// find a real example of this`), explain voice preferences (`// voice: I never say "leverage"`), or mark weak sections (`// this section needs work`). Then Claude asks: **satisfied, or another pass?** If another pass, Claude scans your edits and comments to build a **research plan** — a structured list of what needs investigating. You confirm or adjust the plan, then the pipeline loops through RESEARCH → DRAFT → EDIT → HUMAN-EDIT. BRAINSTORM and OUTLINE are skipped on subsequent loops. **On each loop**, Claude overwrites both the draft file AND the snapshot with the new AI version before handing it back to you.

**REVIEW** — judge evaluates the article against quality standards. Must score 9.0/10.

**PUBLISH** — Final article delivered in clean markdown with headline options, subtitle, TL;DR, tags, and estimated read time.

### Arguments

```
/article-workflow                                    # Start with brainstorm
/article-workflow how we built offline mode           # Start with a topic
/article-workflow edit path/to/draft.md               # Jump to HUMAN-EDIT with existing draft
/article-workflow edit                                # Jump to HUMAN-EDIT, prompts for file path
/article-workflow $ARGUMENTS
```

### Starting from an Existing Draft

Use `edit` as the first argument to skip straight to HUMAN-EDIT with a draft you've already written (or one generated by a previous pipeline run).

**What happens:**
1. Reads the draft file you provide
2. Saves a snapshot for diffing (`.filename-pre-human.md`)
3. Prints the HUMAN-EDIT instructions
4. You edit the file, say "done"
5. Claude diffs, captures voice observations, updates `.claude/voice-profile.md`
6. Claude asks: **satisfied, or another pass?**
   - **Satisfied** → proceeds to REVIEW → PUBLISH
   - **Another pass** → Claude builds a research plan from your edits, then loops through RESEARCH → DRAFT → EDIT → HUMAN-EDIT

This is useful when:
- You wrote a draft outside the pipeline and want to polish it
- A previous pipeline run produced a draft you want to revisit
- You want to build your voice profile without running the full pipeline

### Pre-PUBLISH: CAPTURE-LEARNINGS

After the article passes REVIEW and before PUBLISH, capture agent-level learnings. This feeds the self-improvement loop.

**Process**:
1. Review the article pipeline — HUMAN-EDIT loop count, editor catch rate, research quality
2. For each genuine learning, append an entry to `~/.claude/AGENT-IMPROVE.md` using the standard entry format (see `~/.claude/agents/improve-pipeline-manager.md` for format)
3. If the pipeline ran smoothly, capture zero learnings — do NOT invent entries
4. Classify each learning at capture time:
   - **UNIVERSAL**: Would benefit any project using this agent (general best practices, language-level patterns)
   - **PROJECT**: Specific to this project (conventions, dependencies, domain knowledge)
   - **PROCESS**: Suggests a pipeline/command workflow change
   - If unsure, default to PROJECT

**Focus areas for article-workflow**:
- How many HUMAN-EDIT loops were needed? What did the human consistently change?
- Did the editor catch issues the content-producer should have avoided?
- Were research findings well-integrated into the draft?
- Did voice-profile learnings improve across iterations?

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
│ AUTO-IMPROVE (article-workflow)                                   │
│                                                                  │
│ Entries found: [N]                                               │
│ Threshold: 3                                                     │
│ Action: [skipped — no entries | deferred — below threshold |     │
│          ran — N minor applied, N major deferred]                │
└──────────────────────────────────────────────────────────────────┘
```

---

### Workflow Controls

| Command | Action |
|---------|--------|
| `continue` / `y` | Proceed to next stage |
| `skip brainstorm` | Start from research with a known topic |
| `back` | Go back one stage |
| `show draft` | Display current draft |
| `done` | Signal you're finished editing during HUMAN-EDIT |
| `social` | After publish, run social media adaptation |
| `pause` | Save progress, exit workflow |
| `status` | Show current position |

### Output

The final article includes:

```markdown
# [Headline]

**[Subtitle]**

[Article body — 1500-3000 words, clean markdown]
```

**Metadata:**
- Headline options (primary + 2 alternates)
- Subtitle
- TL;DR (2-3 sentences for social sharing)
- Estimated read time
- Word count
- Target audience
- Suggested tags

### Example Session

```
> /article-workflow building a streak system

## BRAINSTORM Stage
Exploring the angle...
- Not "how to build streaks" (too generic)
- Angle: "What Duolingo gets wrong about streaks"
- Thesis: Most streak systems punish users instead of motivating them

## RESEARCH Stage
Gathering material...
- Duolingo, Wordle, GitHub contribution graph patterns
- Psychology of loss aversion vs positive reinforcement
- Our own streak implementation decisions

## OUTLINE Stage
Structure:
1. Hook: The moment I broke my Duolingo streak
2. The problem with punitive streaks
3. What positive streaks look like (with code)
4. Our implementation choices
5. Results after 30 days
Word count target: 2200

## DRAFT Stage
Writing...
[content-producer produces full draft]

## EDIT Stage
Editor feedback:
- Hook is strong, keep it
- Section 3 needs a concrete code example
- Cut paragraph 4 in section 2 (redundant)
- Fix: "impact" used as verb (use "affect")

## HUMAN-EDIT Stage
Draft saved to articles/streak-systems.md — edit it however you want.
Say "done" when finished.

> User edits the file: softens the opening, adds a personal anecdote
> in section 2, replaces "utilize" with "use" throughout, shortens
> the conclusion

Diffing your edits against the AI version...

Voice observations captured:
- Prefers personal anecdotes over abstract examples
- Replaces formal language with conversational ("utilize" → "use")
- Likes punchy conclusions (cut 40% of closing paragraph)
Updated .claude/voice-profile.md

Satisfied with this draft, or another pass? (satisfied / another pass)

> another pass — the code example should be Swift not pseudocode

(Claude also found in the edits:)
  - `// need actual retention data for this claim` in section 2
  - `// find a real company example, not hypothetical` in section 4
  - Author deleted the "industry trends" paragraph (evidence wasn't convincing)

## Research Plan (Pass 2)

Based on your edits:

1. Duolingo/Wordle retention data after streak breaks — you flagged the claim in section 2 needs real numbers
2. Real company example of positive streak design — you asked for a real case, not hypothetical
3. Swift streak implementation patterns — you want the code example in Swift, not pseudocode
4. Stronger evidence for section 2 — you cut the industry trends paragraph, need a better replacement

Anything to add or change? (y / adjust)

> y

## RESEARCH Stage (pass 2)
Researching against the plan...
- Found Duolingo 2024 retention data (12% drop after streak break)
- Gathered Swift streak implementation patterns from open source
- Found Strava's streak recovery feature as real-world positive example

## DRAFT Stage (pass 2)
Rewriting with new research and your voice preferences...
[content-producer rewrites incorporating findings + voice profile]

## EDIT Stage (pass 2)
Editor review of revised draft...

## HUMAN-EDIT Stage (pass 2)
Updated draft saved — edit it however you want.

> User makes minor tweaks, says "done"
> "satisfied"

## REVIEW Stage
Score: 9.2/10 — PASS
Strong angle, good evidence, actionable takeaway.

## PUBLISH Stage
Article ready:
"What Duolingo Gets Wrong About Streaks"
2,180 words | 9 min read

Run /social-workflow to create social posts from this article?
```

