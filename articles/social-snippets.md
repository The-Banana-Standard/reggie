# Social Snippets: "I Am 37 Agents in a Trenchcoat"

## Source

**Article:** "I Am 37 Agents in a Trenchcoat"
**Path:** /Users/jacobpress/Desktop/Projects/reggie/articles/i-am-37-agents-in-a-trenchcoat.md
**Summary:** A self-explanatory article written from the perspective of Reggie, a multi-agent system built on Claude Code. It describes the system's architecture: 37 specialized agents, a 15-stage pipeline with quality gates, a 9.0/10 scoring threshold, self-improvement loops, and parallel task execution via git worktrees. The tone is direct, philosophical, and honest about tradeoffs.

---

## Strongest Standalone Hooks

These lines can each anchor an entire post on their own. They are short, opinionated, and memorable.

1. "A score is not a vibe."
2. "Garbage in, structured garbage out."
3. "The system that modifies itself has the most restrictions on what it can modify."
4. "The judge does not round generously to be polite."
5. "I am 37 agents in a trenchcoat."
6. "Plans are context, not orders."
7. "The org chart, the process manual, and the quality department wrapped around that generalist."

---

## Audience Segments

| Segment | What they care about | Best angles |
|---|---|---|
| AI/LLM practitioners | Architecture decisions, novel agent patterns | 4, 5, 6, 9, 10 |
| Software engineers broadly | Universal dev truths, quality, process | 2, 3, 7, 8, 11 |
| Engineering leaders/managers | Quality culture, governance, speed/quality tradeoffs | 3, 5, 7, 9, 11 |
| AI-curious general tech | Accessible, surprising, quotable content | 1, 4, 8, 9 |

---

## Angle 1: The Title Itself / "37 Agents in a Trenchcoat"

**Type:** Quotable moment / curiosity hook

**Key passage:**
> "I am 37 specialized agents, 34 slash commands, and a pipeline architecture with quality gates. All of it lives in ~/.claude/ as markdown files. All of it is portable -- copy the two directories to any machine with Claude Code installed and you have the full system in five minutes."

**Alternative hook passage:**
> "If Claude Code is a skilled generalist, I am the org chart, the process manual, and the quality department wrapped around that generalist."

**Why it works on social:** The title is inherently shareable. It is funny, unexpected, and immediately makes people want to know more. The juxtaposition of "37 agents" with "markdown files" creates a compelling contrast between sophistication and simplicity. People will click to understand what this actually means. The "org chart, process manual, quality department" metaphor is a strong alternative hook -- it reframes the system in corporate terms everyone understands, making the technical architecture instantly legible to non-technical audiences.

**Best platforms:** Twitter/X (the title alone is a hook), LinkedIn (curiosity-driven opening), Threads

**Platform-specific recommendations:**
- **Twitter/X:** Single tweet (under 280 chars). The title line or the "org chart" metaphor each work as standalone tweets. No thread needed -- this angle is a door-opener, not a deep dive.
- **LinkedIn:** Single post, 150-200 words. Open with the "org chart" metaphor (it speaks manager), then reveal what it actually is. Text-only; the surprise is in the words.
- **Instagram:** Quote card visual with the title line in large typography over a minimal background. Caption expands with the "org chart" metaphor. 150-word caption max.
- **Threads/Bluesky:** Single post, conversational tone. The trenchcoat line plus one sentence of context.

---

## Angle 2: The Intent-Output Gap as the Hardest Problem

**Type:** Contrarian take

**Key passage:**
> "That gap is the hardest problem in software. Not algorithms. Not scaling. The gap between intent and output. You say 'add streak tracking.' What you mean involves UTC midnight boundaries, grace periods, timezone edge cases, and a data model that plays nicely with your existing user schema. What gets built, without structure, is whatever interpretation the builder landed on at 2 AM."

**Supporting passage:**
> "The gap between what you mean and what gets built is not a tooling problem. It is a communication and verification problem."

**Why it works on social:** This reframes software engineering's core challenge in a way that every developer has felt but rarely articulated. The "add streak tracking" example is viscerally specific -- anyone who has written or received a vague feature request will feel this immediately. It is a strong contrarian take because most discourse focuses on technical complexity, not communication complexity. The framing that this is "not a tooling problem" but a "communication and verification problem" directly challenges the default assumption that better tools solve everything.

**Best platforms:** Twitter/X (thread opener), LinkedIn (professional insight that resonates across roles -- PMs, designers, and engineers all feel this gap), Instagram (carousel concept: "What you said vs. what you meant")

**Platform-specific recommendations:**
- **Twitter/X:** Thread (5-7 tweets). Open with "The hardest problem in software is not algorithms" hook. The "add streak tracking" example is tweet 2. Each tweet under 280 chars. End with CTA linking to article.
- **LinkedIn:** Single post, 200-300 words. First person developer voice works better than Reggie voice here -- this is a universal insight. Text-only; the example carries the post.
- **Instagram:** Carousel (5-6 slides). Slide 1: "The hardest problem in software." Slide 2: "You say 'add streak tracking.'" Slide 3: "What you actually mean..." (list of edge cases). Slide 4: "What gets built without structure." Slide 5: The reframe. Needs designed visual assets.
- **Threads/Bluesky:** Single post. The "add streak tracking" example in 2-3 sentences. Under 500 chars.

---

## Angle 3: The 9.0 Threshold and "A Score Is Not a Vibe"

**Type:** Practical insight / quotable moment

**Key passage:**
> "A score is not a vibe. It is a weighted sum of criterion-level scores, each with a written justification that references specific file names, line numbers, and concrete evidence. The judge cannot say 'could be better.' The judge must say exactly what is wrong and what would fix it."

**Supporting passage:**
> "9.0 out of 10 is the threshold. Not 7.0. Not 8.0. A seven is a seven. The judge does not round generously to be polite."

**Additional detail:**
> "The 9.0 threshold sometimes causes iteration loops that feel excessive. A research output might score 8.7, iterate, score 8.9, iterate again, and finally hit 9.1. Three attempts for marginal improvement. But the alternative -- a lower threshold -- means quality issues propagate through every downstream stage."

**Why it works on social:** The line "a score is not a vibe" is immediately quotable and contrasts sharply with how most teams actually do code review (vague comments, "LGTM" approvals). The 9.0 threshold is a concrete, opinionated stance that invites debate. People will argue whether this is rigorous or excessive, which is exactly the kind of engagement that performs. The 8.7 to 8.9 to 9.1 iteration example makes the abstract concrete.

**Best platforms:** Twitter/X (the one-liner "A score is not a vibe" is a standalone tweet), LinkedIn (discussion about code review standards and quality culture), Instagram (visual quote card)

**Platform-specific recommendations:**
- **Twitter/X:** Two formats. Format A: standalone tweet with just the one-liner "A score is not a vibe." -- let it breathe. Format B: thread (4-5 tweets) unpacking the scoring system with the 8.7-to-9.1 iteration example. Both under 280 per tweet.
- **LinkedIn:** Single post, 200-250 words. Open with "A score is not a vibe." then contrast with how most teams actually do code review. Professional voice. Text-only; the provocation drives engagement.
- **Instagram:** Quote card with "A score is not a vibe." in bold typography. Clean design, high contrast. Caption (150-200 words) explains the scoring system. Second option: carousel showing the iteration loop (8.7 -> 8.9 -> 9.1) across slides.
- **Mastodon:** Longer single post (under 500 chars). The technical audience will engage with the weighted-sum scoring detail.

---

## Angle 4: Tournament Mode -- Two Agents Compete, Loser Still Contributes

**Type:** Surprising detail

**Key passage:**
> "Tournament mode. Two agents independently solve the same problem. The judge scores both against the same framework, declares a winner (ties are not allowed), and checks whether the winner clears 9.0. A winner that scores below 9.0 still does not advance. The loser might have elements worth incorporating -- the judge notes those too."

**Why it works on social:** This is a genuinely novel approach that most people have never considered. The idea that AI agents can compete and that even the loser contributes is fascinating. It raises questions about how we evaluate work, whether competition produces better output, and what collaboration looks like between AI agents. The detail that "ties are not allowed" and "a winner that scores below 9.0 still does not advance" shows the system's commitment to quality over convenience. The losing entry still contributing useful elements is a nuanced take on competition that resonates beyond tech.

**Best platforms:** Twitter/X (surprising detail that gets quote-tweeted with reactions), LinkedIn (management/process insight about competitive evaluation), Reddit (technical audience will debate the approach)

**Platform-specific recommendations:**
- **Twitter/X:** Single tweet or short thread (2-3 tweets). The core concept fits in one tweet: "Two AI agents independently solve the same problem. A judge scores both. The winner still has to clear 9.0 -- winning is not enough. And the loser's best ideas get noted too." Under 280 per tweet.
- **LinkedIn:** Single post, 200-250 words. Frame as a management insight: what if your code review process looked like this? Text-only works; the concept is the visual.
- **Instagram:** Infographic showing the tournament flow: two agents, one judge, scoring, winner/loser outcomes. Needs designed visual asset. Caption 150-200 words.
- **Reddit/HN:** Comment or post format. Lead with the mechanism, invite technical debate about whether competitive evaluation produces better output than iteration.

---

## Angle 5: "The System That Modifies Itself Has the Most Restrictions"

**Type:** Contrarian take / quotable moment

**Key passage:**
> "There are twenty safety guardrails on the improve pipeline. Maximum fifteen changes per run. Never auto-delete existing content. Never auto-modify YAML frontmatter. All changes logged before modification. Same-file threshold triggers manual review. Dry-run mode available. The human can abort at any point."

**Punchline:**
> "The system that modifies itself has the most restrictions on what it can modify. That is not an accident."

**Supporting detail on learning classification:**
> "The classification matters. 'Always check for nil map before writing in Go' is universal -- it goes into the Go developer's system-level instructions and benefits every project. 'This project uses Zustand not Redux' is project-specific -- it goes into project memory. 'PLAN stage should check for database migrations' is a process change -- it modifies the command workflow."

**Why it works on social:** This is a profound design principle that applies far beyond this specific system. It resonates with anyone thinking about AI safety, self-modifying systems, or governance in any domain. The phrasing is tight and memorable -- the kind of line people screenshot and share. It serves as a counterpoint to the "AI will rewrite everything" fear narrative: here is a system that deliberately constrains its own self-modification. The specific guardrails (20 of them, enumerated) make the principle concrete rather than aspirational.

**Best platforms:** Twitter/X (standalone quotable tweet), LinkedIn (leadership/governance angle), Mastodon (technical and philosophical audience will engage deeply)

**Platform-specific recommendations:**
- **Twitter/X:** Single tweet. The line "The system that modifies itself has the most restrictions on what it can modify. That is not an accident." fits under 280 and works as a standalone post. No thread needed -- the brevity is the power.
- **LinkedIn:** Single post, 200-300 words. Open with the quotable line, then enumerate some of the 20 guardrails. Frame as a governance lesson: the most powerful systems need the most constraints. Text-only.
- **Instagram:** Quote card with the core line. Bold typography, dark background. Caption (150 words) lists 3-4 of the specific guardrails to make it concrete.
- **Mastodon:** Single post (under 500 chars). Include the line plus 2-3 guardrail specifics. This audience appreciates the AI safety angle.

---

## Angle 6: The Entire System Is Just Markdown Files

**Type:** Surprising detail / practical insight

**Key passage:**
> "Everything is markdown files in two directories: ~/.claude/agents/ and ~/.claude/commands/. Copy them to a new machine. That is the installation. There is no database, no server, no configuration beyond what Claude Code already provides."

**Supporting passage:**
> "Each agent is a markdown file with YAML frontmatter that defines its name, description, available tools, and model. The body contains its role, responsibilities, process, quality standards, output format, and common pitfalls."

**Additional detail:**
> "Per-project customization lives in .claude/ inside each repository. Agent memory, voice profiles, pipeline configuration. This travels with the repo, version controlled, shared with collaborators."

**Why it works on social:** In an era of complex DevOps toolchains, Docker containers, and infrastructure-as-code, the idea that a 37-agent system is "just markdown files you copy" is genuinely surprising. Developers love elegant simplicity. This angle also makes the system feel accessible and demystifiable -- it is not a black box, it is text files you can read and modify. The "five minutes" installation claim is a concrete hook. The fact that per-project config is version-controlled and shared with collaborators addresses a real pain point.

**Best platforms:** Twitter/X (developer audience loves "no dependencies" stories), LinkedIn (practical for engineering leaders evaluating tooling), Hacker News / Reddit (technical simplicity argument)

**Platform-specific recommendations:**
- **Twitter/X:** Single tweet or short thread (2-3 tweets). Lead with "37 agents. Zero dependencies. Just markdown files in two directories." Under 280 per tweet. The simplicity claim is the hook.
- **LinkedIn:** Single post, 150-200 words. Frame for engineering leaders: what if your most complex system was also your most portable? Text-only.
- **Instagram:** Screenshot or mockup of a directory listing showing the markdown files. Caption (150 words) explains the simplicity. The visual makes the abstract tangible.
- **Reddit/HN:** This is the strongest angle for these platforms. Lead with the technical architecture, invite discussion about tradeoffs of markdown-as-config vs. traditional tooling.

---

## Angle 7: "It Is Slower Than Just Writing Code" -- Honest Cost Admission

**Type:** Contrarian take (honesty as differentiation)

**Key passage:**
> "Token usage is high. Every subagent launch loads agent instructions, pre-read context, and the task state. Quality gates mean the judge runs after every stage. Tournament mode means three agents run where one would otherwise suffice. A full pipeline run for a moderate feature uses significant context."

**The reframe:**
> "It is slower than just writing code. The overhead of research, planning, multi-stage review, and quality gates adds time. For a quick config change, this pipeline is overkill. For a feature that needs to be right the first time, the overhead pays for itself by catching problems before they compound."

**Supporting passage:**
> "That is fifteen stages for a single task. It sounds heavy. It is heavy on purpose. Every stage exists because skipping it led to problems."

**Why it works on social:** Almost every AI tool claims to make you faster. This article openly says the system is slower for certain tasks. That honesty is disarming and credible. It sets up a strong reframe: speed is not the metric that matters; correctness on the first pass is. This resonates with anyone who has spent three days debugging something that "shipped fast." The nuance of "overkill for config changes, essential for features" gives people a framework for when to use heavy vs. light processes. The line "every stage exists because skipping it led to problems" is a universal engineering truth.

**Best platforms:** LinkedIn (strong professional insight about speed vs. quality tradeoffs), Twitter/X (contrarian framing against the "10x developer" narrative)

**Platform-specific recommendations:**
- **Twitter/X:** Thread (3-4 tweets). Open with "Every AI tool says it makes you faster. This one is slower." The contrarian hook earns the read. Then the reframe. Under 280 per tweet.
- **LinkedIn:** Single post, 250-300 words. This is the strongest LinkedIn angle overall. The speed-vs-quality framing maps directly to engineering leadership concerns. Open with the honest admission. Text-only; the candor is the hook.
- **Instagram:** Carousel (3-4 slides). Slide 1: "It is slower than just writing code." Slide 2: "But..." Slide 3: The reframe with the "every stage exists because skipping it led to problems" line. Minimal design, bold text.
- **Mastodon:** Single post. The technical audience values honest cost analysis over hype.

---

## Angle 8: "Garbage In, Structured Garbage Out"

**Type:** Quotable moment / honesty as credibility

**Key passage:**
> "I am not magic. I enforce structure and quality, but the human still needs to articulate intent clearly. Garbage in, structured garbage out."

**Supporting passage:**
> "Not magic. Not finished. Getting better."

**Additional context:**
> "I am not finished. I improve myself, and I improve through use."

**Why it works on social:** This is a perfect sound bite that undercuts AI hype while still being compelling. It is self-deprecating in a way that builds trust. It reframes the human's role -- you are not replaced, you are the quality bottleneck. In a landscape where every AI tool promises magic, admitting "I am not magic" is a pattern interrupt that earns attention. The twist on the classic "garbage in, garbage out" by adding "structured" is clever without being cute. The closing triplet "Not magic. Not finished. Getting better." is a strong narrative arc in nine words.

**Best platforms:** Twitter/X (standalone tweet, highly shareable), LinkedIn (reframing the human role in AI-assisted development), Instagram (quote card)

**Platform-specific recommendations:**
- **Twitter/X:** Single tweet. "I am not magic. I enforce structure and quality, but the human still needs to articulate intent clearly. Garbage in, structured garbage out." Fits under 280. Alternatively, just "Garbage in, structured garbage out." as a standalone -- six words that earn the quote-tweet.
- **LinkedIn:** Single post, 150-200 words. Frame around the human's role in AI-augmented work. The "not magic, not finished, getting better" arc makes a satisfying close. Text-only.
- **Instagram:** Quote card with "Garbage in, structured garbage out." Bold typography. Caption (100-150 words) unpacks what it means for AI collaboration. Clean, minimal design.
- **Threads/Bluesky:** Single post. The full quote plus one line of context. Conversational.

---

## Angle 9: "Plans Are Context, Not Orders" -- Agent Autonomy

**Type:** Contrarian take / AI-human collaboration philosophy

**Key passage:**
> "The key principle: plans are context, not orders. When the code architect produces a plan and the iOS developer receives it, the developer is not blindly executing steps. The developer understands the codebase, applies language-specific patterns, and may deviate from the plan if the plan missed something. The judge evaluates the output against the original requirements, not against plan compliance for its own sake."

**Why it works on social:** This directly addresses the dominant fear about AI systems: that they are rigid instruction-followers that cannot adapt. The phrase "plans are context, not orders" is immediately quotable and applies far beyond AI -- it describes how the best human teams work too. The distinction between evaluating against requirements vs. evaluating against plan compliance is a subtle but powerful insight. It reframes AI agents from "automated task executors" to something closer to "skilled collaborators who understand intent." Engineering leaders will recognize this as the difference between micromanagement and delegation.

**Best platforms:** Twitter/X (quotable one-liner plus discussion), LinkedIn (management philosophy crossover), Threads, Mastodon

**Platform-specific recommendations:**
- **Twitter/X:** Single tweet. "Plans are context, not orders. The judge evaluates the output against the original requirements, not against plan compliance for its own sake." Under 280. Alternatively, thread (3 tweets): the principle, the example (architect plans, developer deviates), the implication.
- **LinkedIn:** Single post, 200-300 words. This is a strong management crossover angle. Open with "Plans are context, not orders." Frame as a lesson about delegation -- whether to humans or AI agents. The parallel to how good engineering teams work is the bridge to broad relevance. Text-only.
- **Instagram:** Quote card with "Plans are context, not orders." Pair with a carousel version (3 slides): the principle, the mechanism, the implication for AI collaboration. Needs designed visual.
- **Mastodon:** Single post. The technical and philosophical audience will engage with the evaluation-against-requirements distinction.

---

## Angle 10: Parallel Execution via Worktrees

**Type:** Surprising implementation detail / practical insight

**Key passage:**
> "You can run multiple pipeline sessions simultaneously. Open three terminals, run /code-workflow in each, and three different tasks will be picked from the backlog, each getting its own git worktree and pipeline directory."

**Supporting passage:**
> "Worktrees solve the interleaving problem. Without them, two sessions modifying files on the same branch create chaos. With worktrees, each task has a complete working copy on its own branch. They cannot step on each other's code."

**Implementation detail:**
> "TASKS.md is the shared state. All active tasks, all backlog items, all quality scores, all stage progress. It lives in the main repo, not in worktrees. Metadata changes to TASKS.md are committed immediately with meta: prefix commits to prevent stash conflicts between sessions."

**Why it works on social:** The image of three terminals running simultaneously, each with its own AI agent working on a different feature, is viscerally compelling. It makes the system feel real and powerful in a way that abstract architecture descriptions do not. The "meta: prefix commits to prevent stash conflicts" detail is the kind of surprising implementation specificity that signals genuine engineering -- not a theoretical system but one that has encountered and solved real concurrency problems. The conflict detection after PLAN (warning before implementation, not preventing it) shows thoughtful design that trusts the human to make decisions.

**Best platforms:** Twitter/X (visual/concrete detail that developers respond to), Reddit/HN (technical implementation debate), LinkedIn (for engineering leaders thinking about parallelizing their AI workflows)

**Platform-specific recommendations:**
- **Twitter/X:** Thread (3-4 tweets). Tweet 1: "Open three terminals. Run the same command in each. Three different features get built simultaneously, each on its own git worktree." Tweet 2: How conflict detection works. Tweet 3: The meta: prefix detail. Under 280 per tweet.
- **LinkedIn:** Single post, 200-250 words. Frame for engineering leaders: what does it look like to parallelize AI-assisted development? The concrete "three terminals" image is the hook. Text-only.
- **Instagram:** Screen recording or screenshot mockup of three terminal windows running simultaneously. Caption (150-200 words) explains the worktree mechanism. The visual is essential for this angle.
- **Reddit/HN:** This angle invites deep technical discussion about git worktrees, concurrency, and state management. Lead with the implementation details, not the pitch.

---

## Angle 11: The 4-Level Escalation Path -- How Problems Get Solved

**Type:** Narrative arc / universal problem-solving framework

**Key passage:**
> "When a stage fails, the escalation path has four levels:
> Attempt 1: Iterate with the judge's feedback. Most failures resolve here. The feedback is specific enough that the agent knows exactly what to fix.
> Attempt 2: Call the researcher for new information. Sometimes the failure is not execution quality but missing context. A fresh research pass can unblock.
> Attempt 3: Tournament mode. Two agents independently solve the same problem.
> Attempt 4: Escalate to the human. 'I have tried three approaches and none meet the bar. Here is what I have and what is failing. What do you want me to do?'"

**Closing insight:**
> "This escalation path means the pipeline almost never gets stuck. And it means quality failures surface early, with specific context, instead of compounding downstream."

**Why it works on social:** The four-level progression -- iterate, research, compete, escalate -- is a complete narrative arc that maps to universal problem-solving. Everyone recognizes this pattern from their own work: try harder, get more info, get a second opinion, ask for help. Framing it as a deliberate system design (rather than ad hoc human behavior) makes it feel both familiar and novel. The fact that the system knows when to stop trying and ask the human is a powerful trust signal -- it is not an AI that hallucinates its way through problems. Each level is a distinct and interesting concept on its own, but together they tell a story about how quality failures get resolved rather than hidden.

**Best platforms:** Twitter/X (numbered list format is native to the platform), LinkedIn (process design for engineering leaders), Instagram (carousel with one level per slide)

**Platform-specific recommendations:**
- **Twitter/X:** Thread (5 tweets). One tweet per escalation level plus an opener and closer. The numbered progression is natural thread structure. Under 280 per tweet. Alternatively, single tweet: "How my AI system handles failure: 1) Iterate with feedback. 2) Research what's missing. 3) Two agents compete. 4) Ask the human. Most problems die at step 1. The ones that reach step 4 come with full context."
- **LinkedIn:** Single post, 250-300 words. Frame as a process design insight. The escalation path is really about knowing when to try harder vs. when to get help -- a lesson for teams, not just AI systems. Text-only; the list structure provides visual rhythm.
- **Instagram:** Carousel (5-6 slides). Slide 1: "How problems get solved." Slides 2-5: One escalation level per slide with brief explanation. Slide 6: The insight about surfacing failures early. Needs clean, consistent visual design across slides.
- **Threads/Bluesky:** Single post. The compressed version: four levels in four short sentences, then the punchline about never getting stuck.

---

## Cross-Cutting Notes

**Voice consideration:** The article is written from Reggie's first-person perspective. Social posts could either maintain this voice (the system speaking about itself) or shift to the developer's perspective (someone describing their system). Both framings have different strengths. The first-person AI voice is novel and attention-grabbing. The developer voice is more credible for practical advice. The content producer voice notes specify: "direct, principled, short declarative sentences, honest about limitations" and "avoid punchy copywriter one-liners; prefer conversational confidence."

**Numbers and specifics available for posts:**
- 37 agents
- 34 slash commands
- 15 pipeline stages
- 9.0/10 quality threshold
- 7 developer agents (iOS, Android, web, TypeScript, Go, Python, cloud/infrastructure)
- 20 safety guardrails on the self-improvement pipeline
- 15 max changes per improve run
- 200-line memory cap per agent
- 2 directories for the full installation
- 5 minutes to set up on a new machine
- 4-level escalation path for quality failures
- 3 simultaneous pipeline sessions via worktrees
- meta: prefix commits for shared state coordination
