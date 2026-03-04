# Social Posts: "I Am 37 Agents in a Trenchcoat"

## Twitter/X

### The Title / Identity Hook

**Variation A (AI voice):**
I am 37 agents in a trenchcoat.

37 specialized agents. 34 slash commands. A pipeline that won't ship anything below 9.0/10.

The whole system is markdown files in two directories. Copy them to a new machine. That's the install.

**Variation B (Developer voice):**
I built a system with 37 AI agents, a 15-stage pipeline, and a quality threshold of 9.0/10.

The entire thing is markdown files. No database, no server. Copy two directories and you're running in five minutes.

**Variation C (Provocation):**
What if the most sophisticated AI system you've seen was just a folder of markdown files?

37 agents. 15 pipeline stages. Quality gates that reject anything below 9.0/10. The "installation" is copying two directories.

---

### The Intent-Output Gap

**Variation A:**
The hardest problem in software is not algorithms. It's not scaling.

It's the gap between what you said and what gets built.

**Variation B:**
You say "add streak tracking."

What you mean: UTC midnight boundaries, grace periods, timezone edge cases, a data model that plays with your existing schema.

What gets built without structure: whatever the builder interpreted at 2 AM.

**Thread:**

1/ The hardest problem in software is not algorithms. It's not scaling.

It's the gap between what you said and what gets built.

2/ You say "add streak tracking."

What you mean involves UTC midnight boundaries, grace periods, timezone edge cases, and a data model that plays nicely with your existing schema.

3/ What gets built without structure is whatever interpretation the builder landed on at 2 AM.

This is not a tooling problem. It's a communication and verification problem.

4/ So I built a system that forces the gap smaller. 15 stages. Quality gates between every one. Nothing ships below 9.0/10.

Research -> Plan -> Implement -> Test -> Review -> Security -> Human approval -> Commit.

5/ The overhead is real. It's slower than just writing code.

But for features that need to be right the first time, catching problems at stage 3 is cheaper than debugging them at stage 15.

6/ Every stage exists because skipping it led to problems.

The full breakdown of how 37 agents coordinate through markdown files and quality gates: [link]

---

### "A Score Is Not a Vibe"

**Variation A (Standalone):**
A score is not a vibe.

**Variation B:**
Our code review threshold is 9.0 out of 10. Not 7. Not 8.

Every score is a weighted sum with written justification referencing specific files and line numbers.

The judge cannot say "could be better." It must say exactly what's wrong and what would fix it.

**Variation C (AI voice):**
The judge does not round generously to be polite.

9.0/10 threshold. Weighted scoring. Written justification with file names and line numbers. No "could be better." Only "here is what is wrong and here is what would fix it."

**Thread:**

1/ "A score is not a vibe."

I built a quality system where every score is a weighted sum of criteria, each backed by a written justification that cites specific files and line numbers.

2/ The threshold is 9.0 out of 10. Not 7. Not 8. The judge doesn't round up to be polite.

A research output scores 8.7. Iterates. Scores 8.9. Iterates again. Hits 9.1. Three attempts for marginal improvement.

3/ Sounds excessive? The alternative is a lower bar where quality issues propagate through every downstream stage.

Catching a problem in research is cheap. Catching it in production is not.

4/ The judge can't say "could be better." It must say exactly what's wrong and exactly what would fix it.

Specific enough that the agent knows what to change without guessing.

5/ This is the difference between code review that catches bugs and code review that says "LGTM."

Structure the feedback. Enforce the standard. The score is evidence, not opinion.

---

### Self-Modifying Systems and Safety

**Variation A (AI voice):**
The system that modifies itself has the most restrictions on what it can modify.

That is not an accident.

**Variation B (Developer voice):**
My AI system improves its own agent instructions. It has 20 safety guardrails to do it.

Max 15 changes per run. Never auto-delete content. Never modify YAML frontmatter. Human can abort at any point.

The part with the most power has the most constraints.

**Variation C:**
If your self-improving AI system doesn't have more restrictions than any other part of the system, you built it wrong.

20 guardrails. 15-change cap. No auto-deletion. Human abort at any point. Dry-run mode. Manual review triggers.

---

### Tournament Mode

**Variation A:**
When a stage fails three times, two AI agents independently solve the same problem.

A judge scores both. The winner still has to clear 9.0 -- winning isn't enough. And the loser's best ideas get noted for the winner.

**Variation B:**
Tournament mode: two agents compete. One judge. Ties not allowed.

But even the winner gets rejected if it scores below 9.0. Winning the tournament is not the same as meeting the bar.

**Variation C (AI voice):**
I make my agents compete. Two solve the same problem. A judge picks a winner. But a winner below 9.0 still fails.

The loser's best ideas? The judge notes those too. Competition without waste.

---

## Threads (Meta)

### The Identity / Title Hook

**Variation A:**
I built a system where 37 AI agents coordinate through a 15-stage pipeline to turn vague feature requests into working code. The whole thing is markdown files in two directories. No database, no server, no complex infrastructure.

The quality bar is 9.0 out of 10 at every stage. Nothing advances without clearing it. The judge doesn't say "could be better" -- it says exactly what's wrong and what would fix it.

I wrote it up from the system's own perspective. It starts with: "I am 37 agents in a trenchcoat."

**Variation B:**
What does it look like when you wrap an AI coding assistant in org structure?

37 specialized agents. An architect who plans. Developers who build. Reviewers who critique. A judge who scores everything. A security auditor. A simplification pass.

The whole system is text files. Copy two folders to a new machine and it's running in five minutes. I wrote up how the whole thing works.

---

### The Intent-Output Gap

**Variation A:**
The hardest problem in software isn't algorithms or scaling. It's the gap between what you said and what gets built.

You say "add streak tracking." What you actually mean involves UTC midnight boundaries, grace periods, timezone edge cases, and a data model that fits your existing schema. What gets built without structure is whatever the builder interpreted.

I built a 15-stage pipeline specifically to make that gap smaller. Not to close it -- that's not fully possible. But to keep closing it, task after task.

**Variation B:**
Hot take: the gap between intent and output is a communication problem, not a tooling problem.

Better tools don't fix vague requirements. They just build the wrong thing faster. So instead of making my AI system faster, I made it more structured. Research before planning. Planning before building. Quality gates between every stage. The overhead is real -- it's genuinely slower than just writing code. But for features that need to be right the first time, the overhead pays for itself.

---

### "A Score Is Not a Vibe"

**Variation A:**
"A score is not a vibe."

That line is from a write-up of a system I built where every stage of development gets scored on a 10-point scale. The threshold to advance is 9.0. Every score comes with written justification referencing specific files and line numbers.

The judge can't say "could be better." It has to say exactly what's wrong and exactly what would fix it. If a research output scores 8.7, it iterates. Scores 8.9, iterates again. Hits 9.1, finally advances.

Three attempts for marginal improvement sounds excessive until you realize the alternative is quality problems cascading through 15 downstream stages.

**Variation B:**
Most code review feedback is a vibe check. "LGTM." "Looks good, minor nits." "Could be cleaner."

I built a system where the reviewer scores against weighted criteria, cites specific files and line numbers, and can't advance anything below 9.0/10. The judge must say exactly what's wrong and what would fix it.

It's slower. Sometimes an output iterates three times to go from 8.7 to 9.1. But quality issues caught early don't compound downstream.

---

### Self-Modification Safety

**Variation A:**
The most interesting constraint in my AI system: the part that improves itself has more restrictions than any other part.

20 safety guardrails on self-modification. Max 15 changes per run. Never auto-delete existing content. Never auto-modify configuration metadata. All changes logged before they happen. Human can abort at any point. Dry-run mode available.

The system that modifies itself has the most restrictions on what it can modify. That's not an accident -- it's the design principle I keep coming back to.

**Variation B:**
My AI system learns from its own mistakes and edits its own instructions. It also has 20 guardrails preventing it from doing this wrong.

Maximum 15 changes per run. Never auto-delete. All changes logged before modification. Same-file threshold triggers manual review. Human abort available at every step.

I think this is the most under-discussed part of self-improving AI systems. The power to change yourself is the power that needs the most constraints.

---

### Honest Costs

**Variation A:**
Every AI tool claims to make you faster. Mine is slower.

The overhead of research, planning, multi-stage review, and quality gates adds real time. For a quick config change, the 15-stage pipeline is overkill. I'll be the first to say that.

But for a feature that needs to be right the first time, catching a problem at stage 3 is cheaper than debugging it in production. The pipeline exists because every stage I tried to skip eventually caused problems.

"Not magic. Not finished. Getting better." That's the honest pitch.

**Variation B:**
Honest accounting of what structured AI development costs:

Token usage is high. Every agent launch loads instructions, context, and task state. Quality gates mean the judge runs after every stage. Tournament mode means three agents run where one would suffice.

It is slower than just writing code.

But the question isn't "is it fast?" The question is "is the output right the first time?" For non-trivial features, the overhead pays for itself by catching problems before they compound. Every stage exists because skipping it led to problems.

---

## Reddit

### The Identity / Architecture Overview

**Subreddit:** r/ClaudeAI, r/programming

**Title Variation A:** I built a 37-agent pipeline system on top of Claude Code using nothing but markdown files -- here's how it works

**Title Variation B:** How I turned Claude Code into a 37-agent system with quality gates, tournament mode, and self-improvement -- all in markdown

**Title Variation C:** 37 specialized agents, 15 pipeline stages, 9.0/10 quality threshold -- built entirely as markdown files on Claude Code

**Body:**

I've been building a multi-agent system on top of Claude Code and wanted to share the architecture and what I've learned.

**The basics:** 37 specialized agents (7 developers, 7 quality/architecture specialists, 5 researchers, and more), 34 slash commands, and a 15-stage pipeline. The entire system is markdown files in two directories. No database, no server. Copy the folders to a new machine and it runs in five minutes.

**How it works:** When you kick off a task, it flows through: Research -> Plan -> Implement -> Test -> Review -> Security Review -> Human Approval -> Commit. Every transition is a quality gate scored by a judge agent. Nothing advances below 9.0/10.

**The scoring is structured, not vibes.** Every score is a weighted sum of criteria with written justification citing specific files and line numbers. The judge can't say "could be better" -- it has to say exactly what's wrong and what would fix it.

**When stages fail,** there's a 4-level escalation: iterate with feedback, call the researcher for new context, tournament mode (two agents compete, judge picks a winner), or escalate to the human with full context on what failed and why.

**The self-improvement loop:** At the end of every pipeline run, learnings are captured. When enough accumulate, they're classified (universal vs. project-specific vs. process change) and applied to the right agent instructions. The self-modification pipeline has 20 safety guardrails -- more restrictions than any other part of the system.

**Honest tradeoffs:** Token usage is high. It's slower than just writing code. For a quick config change, it's overkill. For features that need to be right the first time, the overhead pays for itself.

I wrote the full thing up from the system's perspective (it explains itself). Happy to answer questions about the architecture, tradeoffs, or specific design decisions.

[link]

---

### The Intent-Output Gap

**Subreddit:** r/programming, r/ExperiencedDevs

**Title Variation A:** The hardest problem in software isn't algorithms -- it's the gap between what you said and what gets built

**Title Variation B:** "Add streak tracking" -- one phrase, five hidden requirements, and why AI coding tools need structure not speed

**Title Variation C:** Why I made my AI development pipeline slower on purpose

**Body:**

I've been thinking a lot about what actually goes wrong in software development, and I've landed on a take that's informed my whole approach to AI-assisted coding.

The core problem isn't technical complexity. It's the gap between intent and output. You say "add streak tracking." What you actually mean involves UTC midnight boundaries, grace periods, timezone edge cases, and a data model that fits your existing schema. What gets built -- by a human or an AI -- is whatever interpretation the builder landed on.

This isn't a tooling problem. It's a communication and verification problem. Better tools build the wrong thing faster.

So instead of optimizing for speed, I built a structured pipeline that forces clarity at every stage:

- **Research** before planning (understand the codebase and constraints first)
- **Planning** before building (design the approach, identify risks, get it scored)
- **Quality gates** between every stage (nothing advances below 9.0/10)
- **Human review** at the end (walk through every acceptance criterion, not just "does it compile")

The overhead is real. It's genuinely slower than just prompting an LLM and shipping what comes back. But for non-trivial features, catching a misunderstanding at the planning stage is orders of magnitude cheaper than catching it in production.

Every stage in the pipeline exists because I tried skipping it and it caused problems downstream.

Curious whether others have found similar patterns -- that adding structure and slowing down AI-assisted development actually produces better outcomes than optimizing for speed.

---

### Tournament Mode / Quality System

**Subreddit:** r/MachineLearning, r/ClaudeAI, r/LocalLLaMA

**Title Variation A:** I built a system where two AI agents compete to solve the same problem -- and the winner still gets rejected if quality is below threshold

**Title Variation B:** Tournament mode for AI agents: two compete, one judge, and winning isn't enough

**Title Variation C:** Multi-agent quality system: competitive evaluation, 4-level escalation, and a 9.0/10 threshold that doesn't budge

**Body:**

I've been experimenting with multi-agent architectures on Claude Code and wanted to share one of the more interesting patterns: competitive evaluation.

**The setup:** When a stage in my development pipeline fails after two attempts (iterate with feedback, then research for new context), the system escalates to tournament mode. Two agents independently solve the same problem. A judge scores both against the same weighted criteria framework.

**Key rules:**
- Ties are not allowed -- the judge must pick a winner
- The winner still has to clear 9.0/10. Winning the tournament doesn't mean the output is good enough
- The loser's work isn't discarded -- the judge notes elements worth incorporating into the winning approach

**The full escalation path:**
1. Iterate with the judge's specific feedback (most failures resolve here)
2. Call the researcher for new information (sometimes the problem is missing context, not execution quality)
3. Tournament mode (two agents compete)
4. Escalate to the human with full context on what was tried and what failed

The result: the pipeline almost never gets stuck, and quality failures surface early with specific context instead of compounding downstream.

**Tradeoff:** Tournament mode means three agents run (two competitors + judge) where one would normally suffice. Token usage is high. But it only triggers on persistent failures, so it's a targeted cost for the hardest problems.

I wrote up the full system architecture. Happy to discuss the approach and whether competitive evaluation actually produces better output than pure iteration.

[link]

---

### Markdown-as-Infrastructure

**Subreddit:** r/programming, r/ClaudeAI

**Title Variation A:** My 37-agent AI system has zero dependencies -- the entire thing is markdown files in two directories

**Title Variation B:** No database, no server, no Docker -- a 37-agent pipeline system that installs by copying two folders

**Title Variation C:** The most complex system I've built is also the most portable: 37 agents as markdown files

**Body:**

Wanted to share an architectural choice I'm increasingly convinced was the right call, even though it felt weird at first.

My multi-agent system (37 specialized agents, 15-stage pipeline, quality gates, self-improvement) is entirely markdown files. Each agent is a `.md` file with YAML frontmatter defining its name, tools, and model. The body contains its role, process, quality standards, and common pitfalls.

**The installation:**
- Copy `~/.claude/agents/` and `~/.claude/commands/` to a new machine
- That's it. Five minutes including reading the README.

**Per-project customization** lives in `.claude/` inside each repo. Agent memory, voice profiles, pipeline config. This travels with the repo, version controlled, shared with collaborators.

**Why it works:**
- No infrastructure to maintain
- Version controlled by default (just text files)
- Human-readable and human-editable
- Portable across any machine with Claude Code
- The self-improvement loop edits the same markdown files, so the system literally rewrites its own instructions

**Tradeoffs:**
- No type checking on agent definitions
- Frontmatter schema is convention, not enforced
- Complex agent interactions are implicit (agent A calls agent B because the pipeline manager knows to, not because there's a dependency graph)

The simplicity constraint forces good design. When your agents are text files, they have to be clear enough for both an LLM and a human to understand. That turns out to be a strong quality signal.

Full write-up: [link]

---

## Posting Strategy

### Recommended Lead Platform: Twitter/X

The article's quotable lines ("A score is not a vibe," "The system that modifies itself...," "Garbage in, structured garbage out") are built for Twitter. The identity hook ("37 agents in a trenchcoat") has natural virality on short-form platforms. Start here to establish the conversation.

### Suggested Posting Order

**Day 1:** Twitter/X -- Lead with the identity hook (Variation A or C). Let it breathe as a single tweet. Follow 2-3 hours later with the "A score is not a vibe" standalone tweet.

**Day 2:** Twitter/X -- Post the Intent-Output Gap thread (the strongest thread angle). Cross-post the identity hook to Threads.

**Day 3:** Reddit -- Post the full architecture overview to r/ClaudeAI. This is where the detailed audience lives. Post the intent-output gap framing to r/programming or r/ExperiencedDevs.

**Day 4:** Threads -- Post the honest costs angle ("Every AI tool claims to make you faster. Mine is slower."). Twitter/X -- Self-modification safety tweet.

**Day 5:** Reddit -- Tournament mode post to r/MachineLearning. Twitter/X -- "A score is not a vibe" thread (the expanded version).

**Day 6-7:** Fill gaps. Post the markdown-as-infrastructure Reddit post. Share remaining Twitter variations. Threads gets the scoring and self-modification angles.

### Cross-Linking Strategy

- Twitter threads should end with a link to the full article
- Reddit posts should link to the article at the end, after providing substantial value in the post itself (Reddit penalizes link-first posts)
- Threads posts can reference "I wrote this up in detail" without aggressive linking -- the platform rewards conversation over traffic driving
- Do not cross-link between platforms ("as I posted on Twitter..."). Each platform's audience should feel like the content was written for them

### A/B Testing Notes

- On Twitter: test AI voice vs. developer voice for the identity hook. The AI voice ("I am 37 agents") is more novel but the developer voice ("I built a system") may drive more article clicks
- On Twitter: test the standalone "A score is not a vibe." (six words, let it breathe) against the expanded version with context. Standalone may get more quote-tweets; expanded may get more direct engagement
- On Reddit: test which subreddit responds best to the architecture overview, then target follow-up posts to that community
- The "slower on purpose" angle is the riskiest and potentially highest-reward. Test it on Threads first (more forgiving audience) before Twitter
