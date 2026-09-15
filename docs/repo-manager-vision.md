# Reggie as a Repo Manager (v3 direction)

Status: ratified in stages. Each dated block below records what was decided and why; the forks still open are listed at the end. The 6 September backlog that proposed a ratification task lived only in the main clone's uncommitted `TASKS.md`; its live rows were captured into `.reggie/intake.md` on 2026-09-15.

## Summary

Reggie stops being the thing that runs Claude Code sessions and becomes the thing that understands and steers a repo. Sessions run in the Claude desktop app, in Codex, or in a plain terminal. Reggie is the shared ledger and map that every tool and every person reads and writes.

Three things follow:

1. Reggie's state lives in the repo, committed, in a tool-neutral layout. Anything Claude Code writes, Codex and a teammate can read.
2. The pipeline goes asynchronous. Tasks park and wait for a human decision instead of blocking a terminal.
3. Everything a human consumes is a rendering of that state: a desktop web UI, generated diagrams, and a private podcast you can talk back to.

## Decisions made on 2026-09-06

- Reggie does not run sessions or own a PTY. The Tauri desktop app is decommissioned on the `repo-manager` branch.
- State is committed in `.reggie/` inside each repo. Nothing durable is gitignored. `.pipeline/` and project-level `.claude/agent-memory/` are replaced.
- Five task states, derived from which files exist: ungroomed, groomed, in process, awaiting decision, done.
- Three decision packets: plan, completion with evidence, backlog. A packet renders to the desktop view and to the podcast script.
- Agent notes have three audiences: orchestrator context, entity-keyed structured notes for visualization and doc generation, and a plain-English journal written for a listener.
- Verification evidence persists after completion. Today it is deleted at COMPLETE.
- Visualizations are derived from source by parsers and language servers. Agents annotate the graph; they never hand-write it.
- CLAUDE.md and AGENTS.md are compiled from one source with a generated block and a curated block.
- Podcast interaction is asynchronous: listen, leave a voice note against the current chapter, and the note is transcribed and applied later. No real-time voice agent in v1.
- Podcasts are also on demand. Anyone can request an explainer episode on any topic, and every visualization has a narration so it can be heard as well as seen.
- Multiple people work the same repos from different machines. Identity is the git author. Claims, decisions, and journals are attributed and committed.
- Work happens on the `repo-manager` branch in a git worktree, because `~/.claude/*` symlinks point into the main checkout's `resources/`.
- Procedures are borrowed. Anthropic, OpenAI, and community skills run the planning, review, simplify, security, and init steps. Reggie keeps state, contracts, policy, and glue.
- Plans and packets are discussable. Anyone, including agents, can comment, anchored to a section and attributed. Discussion is separate from decision. Solo mode is a policy preset with minimal ceremony over the same state machine.

## Decisions made on 2026-09-13

- **Reggie is not an agent system.** It never runs a planning agent, an execution pipeline, a judge or a reviewer of its own. Planning happens in Claude Code's or Codex's plan mode, opened by Reggie with a prompt that frames the conversation and a context file to read. Building happens in an ordinary session in the task's worktree, opened by Reggie with the plan. Review is a borrowed skill (`/code-review`, `/security-review`) named by the risk class. Reggie keeps the state (`.reggie/`), the contracts (brief, plan, packet and their linters), the policy (which review runs at which risk, who may decide), the web view and the MCP tools. This is the 6 September direction made concrete by the first task built through it (`mobile-ui`).
- **The v2 agents and commands under `resources/` are legacy.** Nothing on this branch reads them. They are still what `~/.claude/*` symlinks point at from the main clone, so every project on this machine still has them until the branch lands; what happens to them then is an open fork below. The fixed-stage pipeline fork is closed: retired, not kept as a profile.
- **The journal is derived, not remembered.** A session should not have to remember to write it. Reggie derives the narrative from what already exists: the session transcript on disk (both tools write one, and Reggie mints the Claude session id at launch, so the transcript is findable), the commits on the task branch, and the state transitions it already reads from git. The entry is written in listener register, attributed to the person and the tool, with the evidence linked. A person or a session may still add an entry by hand when the transcript does not say what mattered. Until the derivation is built, the generated instruction block keeps asking for one entry per step.
- **A model is called, never resident.** When something genuinely needs a model reading code, such as an explainer on why a bug lives where it does, or an overnight shaping pass over the intake, Reggie makes a headless call (`claude -p`, `codex exec`) with a prompt and reads the result back into its state. That is a tool use with an input and an output, not a process that lives inside Reggie.

## Decisions made on 2026-09-15

Made against the goal statement of 2026-09-14: Reggie helps a repo owner keep understanding a codebase that AI builds faster than anyone can read it, draws the picture from git and in-repo notes, serves it as a web view, and tracks each captured task from idea to plan to branch to decision, with the loop staying inside the repo.

- **Loop plumbing lands before any feature.** The first three tasks built through the loop showed the installed bin running a stale build, the `Task:` line never parsing, claimed worktrees with no dependencies, journal files conflicting on every merge, and a stats file riding into commits. Every later item is built through the loop, so the loop is fixed first. Order: stale bin, journal merges (one union line, so the first merge Reggie performs does not hit the known collision), attribution, worktree dependencies and the stats file, then the small items, branch diff, derived journal, the queue.
- **Attribution by merge commit.** Reggie joins commits to tasks by reading the `Task:` line anywhere in a commit body (sessions write it above `Co-Authored-By`, outside git's trailer block) and by taking a merge commit's files against its first parent. In solo mode `reggie decide approved` performs the no-ff merge itself so the merge commit always exists; team mode requires merge commits on GitHub, never squash or rebase. A completed task's commits are listed from its merge commit, so a journal can be derived after the branch is gone. Why: the join is what "what landed" and "what changed and why" rest on, and it must not depend on a session's habit or a per-machine hook.
- **Worktree dependencies, hybrid.** Claim links the serving checkout's installed packages into the task worktree when the lockfiles are byte-identical, otherwise runs the repo's install command from a config key. The launch prompt says that adding a dependency means unlinking first. Why: instant for the common case, correct for the rare one.
- **Capture has three doors: the CLI verb, the MCP tool, the web form.** The six project slash commands `reggie onboard` installs are retired; nothing has emitted them since the launch redesign and the MCP tool covers sessions.
- **Planning happens only in Claude Code or Codex sessions.** No in-page brief editing beyond answering a brief's open questions in place. Every page gets an idea action that captures a line and opens a discuss session in plan mode with the page's entity as context, so an idea can be shaped the moment it strikes. Why: all three briefs so far were written inside the planning session, and a second author of the same file needs conflict handling nobody has asked for.
- **Journals union-merge.** A `.gitattributes` line for `.reggie/journal/**/*.md` until the derived journal replaces hand-written entries. Why: one line stops a conflict that has hit every merge; GitHub ignores it, which does not matter in solo mode. Shipped 2026-09-15: `reggie onboard` appends the line to every repo's `.gitattributes`, and a worktree claim's journal entry is committed with the claim on the task branch, so the checkout that performs the merge is never left holding it uncommitted. An in-place claim, a resume, release, decide, the web view and the MCP tool still write into the checkout they run in, uncommitted.
- **The derived journal is an explicit verb.** `reggie journal derive <slug>` works for a task in flight and for a completed one. A pass inside `reggie serve` may call it once it is trusted. Why: a verb can be tested against a fixture transcript and attributed; a hook is per machine and Codex has none.
- **Languages deferred.** Reggie is built against this repo and `personal_website` first, both already parsed. More languages once it is in good shape.
- **The repo owns decisions; GitHub mirrors them.** Why: the loop stays inside the repo and works offline.
- **Plans of every risk class and low-risk completions pass by policy.** Amended later on 2026-09-15: in solo mode every plan passes, low, medium and high, and whether high should be removed is judged as the loop runs; completions pass at low only. Solo mode approves them automatically, on the assumption that anything a human would not have approved surfaces later as a discovered issue and becomes the next task. Preconditions, built as one task: a packet citing evidence that does not exist never passes; checks are recorded as data rather than a ticked box; Reggie owns the merge; the packet's discovered issues are captured into intake automatically. The risk class stays the path-rule proxy until it derives from the graph.
- **The intake line leaves at triage.** The brief replaces it. A scaffolded brief that was never filled in is reported as such rather than counted as groomed.
- **MCP and the CLI wrap the same functions.** `packet` and `pr` become MCP tools so a build session does not depend on a shell PATH; `decide` is never a session tool, it is a human act or the policy above. The CLI stays for people, scripts and CI.
- **Team mode is deferred.** Nothing team-mode is built or decided until the loop works for one person; every brief that raised a team-mode question records that answer. The state machine stays mode-neutral so the switch needs no migration.
- **One repo at a time.** Cross-repo discovery from remotes and manifests waits until the diff and the queue land.
- **Metadata commits on main.** One history; the story of the work sits beside the work.
- **The v2 system under `resources/` retires when the branch lands.** Before the merge: move the folder to an archive, its own repository or a legacy folder, repoint the `~/.claude/{agents,commands,hooks}` symlinks, then delete it from the branch. Deleting it with the merge would remove the v2 agents from every project on the machine at once. The `track-stats` hook registration was removed from `~/.claude/settings.json` on 2026-09-15; it was the writer of the stray stats file.
- **`HISTORY.md` deleted, `TASKS.md` kept as a pointer** until the branch lands. The legacy reader counted its 73 Tauri-era lines as done work. A generated `TASKS.md` view returns as a question when a GitHub-only reader exists.
- **The 2026-09-06 backlog is not committed as a backlog.** Two thirds of its rows were already half true. Its live rows with no other home were captured into intake on 2026-09-15; the rest are carried by the milestones in `docs/ui-plan.md`.

## Non-goals

- Running or babysitting terminals, headless sessions, or DONE-marker scanning.
- Installing anything by symlinking into a repo.
- A real-time conversational voice agent.
- Replacing GitHub. Reggie mirrors to it and reads back from it.

## Shape

```
                 writers                          renderers
  Claude Code ──┐                              ┌── web UI (board, decisions, definition of done)
  Codex ────────┼──► .reggie/ state layer ◄────┼── graph views (derived) + Mermaid/SVG export
  voice inbox ──┤    tasks · journal · notes    ├── podcast episodes (private feed per person)
  GitHub sync ──┘    inbox · people · graph     └── CLAUDE.md / AGENTS.md generated blocks

  reggie serve (TypeScript): serves the UI, exposes the MCP server, builds graphs on request,
  composes episodes, drains the inbox, syncs metadata through git. It watches nothing: the
  page refreshes on demand (decided 2026-09-09).
```

Both Claude Code and Codex reach the state through the same MCP server and the same generated instructions. That is the whole "seamless switching" mechanism.

## Core loop (proposed 2026-09-06, not ratified)

Four verbs over the state layer: Capture, Plan, Execute, Decide. Two speeds, keyboard and overnight, running the same state machine. The only difference between the speeds is who answers questions and when.

### Capture

- Anything, from anywhere: the TASKS.md intake section, a voice note, a chat message in Claude Code or Codex through an `add_intake` MCP tool, discovered issues from sessions, mirrored GitHub issues.
- Triage turns raw items into candidates with a one-line problem statement and a size and risk guess. Automatic overnight as a backlog packet, or interactive in the triage view or the backlog episode.

### Plan

- Planning happens in the tool's native plan mode, Claude Code's or Codex's. Reggie stops owning planning prompts and retires the bespoke RESEARCH and PLAN machinery in init-tasks.
- Reggie owns the plan contract: what a plan must contain to become a plan packet. Problem. Approach. Files to touch, with blast radius from the graph. Acceptance criteria, each one checkable. Verification strategy naming the evidence that proves each criterion. Risk class. Assumptions. Out of scope. Bail conditions. A linter rejects a plan that misses any of it, and the contract is the same for both tools.
- Interactive mode: questions asked and answered at the keyboard, approval on the spot, task becomes groomed.
- Automatic mode: the planner answers its own questions with explicit, flagged assumptions and submits a plan packet. Approval comes later through the UI, the podcast, or an auto-approval policy for low-risk plans.

### Grooming, step by step

Grooming is the path from a captured item to an approved plan. Two phases, triage and plan. Approval is what flips the state to groomed.

**Triage** shapes the intake before anyone plans.

1. Dedupe against open tasks and history; cluster related items.
2. Attach graph context: the files, symbols, and stores the item most likely refers to, found by searching the graph and notes. This replaces the architect's hand-made area grouping.
3. Guess size and risk class from that neighborhood; suggest a priority from hotspot and dependency data.
4. Record open questions only where the answer would fork the plan.

Output: a candidate with a one-line problem statement, suspected area, size and risk guess, suggested priority, and questions. Overnight triage produces a backlog packet. Interactive triage happens in the triage view or the backlog episode. Merge, split, drop, and reorder are decisions, and every decision is attributed.

**Plan** produces the approvable document.

1. A planning session opens with a context pack Reggie assembles: the candidate, its graph neighborhood, relevant notes, related past tasks with their evidence, current claims nearby, and the generated instructions block.
2. Interactive: native plan mode, questions answered at the keyboard, plan saved to `.reggie/tasks/<slug>/plan.md`, approved on the spot. Overnight: the same contract run headlessly, assumptions flagged, plan packet submitted.
3. The linter checks the contract before a packet can exist.
4. Blast radius is computed from the named files and risk class is set from it. The ownership graph suggests a decider for medium and high risk.

**Groomed means** all of the following hold: every acceptance criterion is checkable; the verification strategy names evidence for each criterion; files and blast radius are listed; risk class is set; assumptions are explicit; no blocking question is open; size is within budget or the plan proposes a split; ordering against active claims and dependencies is recorded; the required decider approved.

**Afterwards**: the plan is the executor's input. Deviations are allowed and must be recorded in the completion packet with reasons. A tripped bail condition returns the task to grooming with context attached. A decider who does not understand a plan can request an explainer episode on the area before deciding.

**Bulk**: "groom everything in intake" overnight yields a set of plan packets. The morning episode walks them in priority order. Low-risk plans can be approved in bulk or by policy; high-risk plans get the full narration.

What disappears: init-tasks' INTAKE, CLARIFY, RESEARCH, PLAN, and ORGANIZE stages as Reggie-owned prompts; the `[planned]` tag; TASKS.md tag editing; the architect's grouping pass.

### Execute

- Default is execute the plan. One session, one worktree, one claim. The executor must produce the evidence the plan's verification strategy demands.
- Review is proportional to risk class, which is computed from blast radius. Low: automated checks plus a self-check against acceptance criteria. Medium: add one fresh-context reviewer. High, meaning auth, data, schema, public API, or payments: add security review, a verifier that executes claims, and a mandatory human decision from a maintainer.
- Findings loop back to the executor in the same session until clean or a bail condition trips.
- Output: a completion packet with evidence, findings, and scores. Journal entries and structured notes at each boundary. Discovered issues go back to Capture.
- Retired as fixed stages: SIMPLIFY, SYNC-DOCS, UPDATE-CLAUDE, per-stage judge scoring, tournament by default. Kept: worktrees, claims, discovered issues, learnings capture, and the judge as a high-risk claims verifier that has Bash.

### Decide

- Plan packets, completion packets, and backlog packets, decided at the keyboard, in the UI, from the podcast, or through a PR. Auto-approval policies by risk class. Every decision attributed.

### Why

- Plan quality is the lever. The fixed eleven-stage pipeline compensated for weak plans. Plan mode with a contract produces strong ones, and a strong plan makes execution nearly mechanical.
- Fewer hops mean fewer relayed errors. The improve log records the orchestrator introducing wrong premises into stage briefs; every relay is a chance to distort.
- Review cost should follow risk, not a fixed sequence. A config change and an auth change do not deserve the same eight reviews.

## Borrow procedures, own state (direction stated 2026-09-06)

Principle: Reggie owns only what nobody else will maintain for this team. Repo state, decisions, notes, the graph, the voice loop, and the glue between them. Every procedure that Anthropic, OpenAI, or the community maintains is borrowed by name, never copied into Reggie.

| Reggie today | Borrowed instead |
|---|---|
| reggie-plan, the RESEARCH and PLAN machinery in init-tasks | Native plan mode in Claude Code and Codex, plus Reggie's plan contract |
| reggie-code-review, reggie-code-reviewer, reggie-judge | `/code-review` in Claude Code, Codex's review command |
| reggie-review-security, reggie-security-reviewer | `/security-review` |
| reggie-simplify, reggie-refactorer | `/simplify` |
| reggie-verify-app, reggie-app-tester | `/run` plus the plan's verification strategy |
| reggie-onboard, reggie-update-claude, reggie-setup-workspace-docs | `/init` plus Reggie's generated blocks |
| reggie-code-workflow, reggie-distribute-tasks, pipeline managers | The Workflow tool and Agent worktree isolation for parallelism; Reggie's execute contract for what must come out |
| reggie-improve, AGENT-IMPROVE, agent memory | Native auto-memory and memory consolidation, plus Reggie notes and journal |
| reggie-find-tools, reggie-refresh-capabilities, skills registries | Native skill and connector search, plugin marketplaces |
| reggie-diagram | Reggie's graph views and Mermaid export |
| reggie-status | The Reggie UI |
| Language-specific developer agents | Community plugins when needed; the main session otherwise |

What Reggie still ships:

- The MCP server and the state layer.
- The plan contract and linter, the execute contract, and the review policy that names which borrowed skill runs at each risk class, per tool.
- A capability map per tool: one step resolves to `/code-review` in Claude Code and to Codex's equivalent, with a small fallback prompt where a tool has no native command.
- Onboarding that installs or recommends the required skills and plugins and checks they are present, so teammates run the same procedures.
- A handful of thin commands for humans: capture, plan, execute, brainstorm. Everything else is an MCP tool the model calls.

Consequences:

- Quality is guaranteed by evidence, not by Reggie's judge scores. Tests pass, review findings are resolved, the plan's criteria are checked.
- Reggie pins nothing. Skills improve upstream and Reggie inherits the improvement. A missing skill degrades to a warning and a fallback, never a broken pipeline.
- Codex parity becomes a mapping problem, not a porting problem.

## Git-first substrate (proposed 2026-09-06, not ratified)

Extend the borrowing principle to the collaboration substrate. Git already provides versions, attribution, and history. GitHub already provides anchored comments, approvals, ownership, notifications, and boards. Reggie builds only what neither provides: the graph, the voice loop, entity-keyed notes, the listener journal, and the policy that ties them together. State is derived from git objects, not from a parallel store.

| Need | Git or GitHub feature | Reggie adds |
|------|-----------------------|-------------|
| Plan versions and diffs | Commit history of `plan.md` | Nothing |
| Attribution of every change | Commit author, signed commits | Nothing |
| Claims, who is on what | A `task/<slug>` branch on the remote; last commit is the heartbeat | Stale-branch detection, board rendering |
| Grooming in progress | A `plan/<slug>` branch | Same |
| Discussion on a plan | Draft PR of the plan branch; review comments anchored to lines of `plan.md` | Voice notes posted as comments through the inbox drainer |
| Plan approval, groomed | Plan PR approved and merged; `plan.md` lands in main | Contract linter as a CI check on plan PRs |
| Completion packet | Implementation PR description from a template; CI checks as automated gates | Packet parser, evidence links |
| Decision on completion | PR review approval; required reviewers from CODEOWNERS | Policy that maps risk class to required reviews |
| Area owner as decider | CODEOWNERS | Suggestions from the ownership graph to keep CODEOWNERS current |
| Auto-approval by risk | Branch protection rulesets, auto-merge, a bot approving low-risk PRs | The risk classifier that labels the PR |
| Capture | Issues, issue forms, the mobile app | Voice and chat capture posting issues |
| Broader conversations | GitHub Discussions | Episode narration, voice replies |
| Board and cross-repo view | Projects with custom fields for state and risk | The Reggie UI as a richer rendering |
| Notifications | GitHub notifications | Episodes as the batched alternative |
| Task to code linkage | Branch names, commit trailers `Task: <slug>`, PR file lists | Graph edges |
| Timeline and audit trail | PR timeline, `git log` | Rendering |

State derivation becomes:

| State | Derived from |
|-------|--------------|
| ungroomed | An open issue with no plan branch |
| groomed | `plan.md` for the slug merged to main |
| in process | A `task/<slug>` branch with commits ahead of main |
| awaiting decision | An open implementation PR |
| done | That PR merged |

What stays Reggie-native: the graph and every visualization, entity-keyed notes, the listener journal, evidence files, the inbox and episode composer, the CLAUDE and AGENTS generators, and `people.yaml` reduced to feed tokens and preferences.

Consequences:

- Solo mode skips PRs for plans: `plan.md` commits straight to main, one commit per version, approval implicit. Team mode opens the plan PR. Same derivation either way.
- Teammates who only use GitHub are first-class by default. The mirror tasks disappear because GitHub is the store, not a copy.
- Agents read the same substrate through the `gh` CLI, which both Claude Code and Codex can run, so Codex parity improves.
- The coupling is to GitHub. A host adapter for GitLab or others is possible later but not in scope. Offline work still functions on plain git; discussion and decisions wait for a connection.
- Branch noise is real: `plan/*` and `task/*` branches must be pruned on merge.



| State | Derived from | Who moves it |
|-------|--------------|--------------|
| ungroomed | intake entry, no plan | anyone, by adding an item or a voice note |
| groomed | approved `plan.md` | a decider approving a plan packet |
| in process | fresh `claim.json` | a session claiming the task |
| awaiting decision | `packet.json` with no verdict | the pipeline submitting a packet |
| done | verdict recorded, packet archived | a decider approving a completion packet |

Needs work returns a task from awaiting decision to in process with the reviewer's comments attached. Redirect returns a plan to grooming.

## Decision packets

- **Plan packet**: problem, approach, files to touch, blast radius, verification strategy, open questions, requested deciders.
- **Completion packet**: acceptance criteria with pass/fail and evidence links, diff summary, test results, verify-app results, judge scores, discovered issues, open risks.
- **Backlog packet**: ungroomed items with suggested priority, likely duplicates, hotspot data.

Every packet records author, repo, slug, and who is asked to decide. Every decision records who decided, when, and how.

## Notes, journal, evidence

- **Context** (`CONTEXT.md`, `DECISIONS.md`): verbatim stage outputs for the orchestrator. Exists today; becomes persistent.
- **Structured notes** (`.reggie/notes/`): keyed to a file, symbol, store, route, or repo. Typed why, how, gotcha, verify, data-source, decision. Carry author, date, confidence, source refs. Stale when the entity changed after the note.
- **Journal** (`.reggie/journal/<date>/<person>-<session>.md`): append-only plain English in listener register. No paths or slugs in the prose. Every entry links evidence. Derived by Reggie from session transcripts, commits and state transitions (decided 2026-09-13); a person or a session may add an entry by hand. Until the derivation exists, sessions are asked to write one entry per step.
- **Evidence** (`.reggie/tasks/<slug>/evidence/`): test output, verify-app results, screenshots, judge reports. Referenced by completion packets. Secrets redacted before commit.

Journal is narrative. Git, STATE, and evidence are truth. An episode says "tests passed" only when the evidence file says so.

## Podcast and voice loop

1. The composer builds a per-person episode from packets and journal entries, prioritizing what needs that person. Four episode types: a plan to approve, a completed task to accept, a repo-state-and-priorities briefing, and a requested explainer on any topic such as how everything connects or the specifics of one repo. Plus an on-demand live digest with nothing to decide.
2. Episodes publish to a private RSS feed per person per workspace, playable in any podcast app.
3. The listener leaves a voice note against the current chapter. Chapters map to entities, so the note lands on the right task or code area.
4. Notes are transcribed and parsed into structured decisions with confidence, plus free comments.
5. `reggie inbox drain` applies confident decisions, routes comments, asks for confirmation on the rest, and commits the metadata.

Explainers are documentation you can hear. A request comes from a voice note mid-episode, the UI, the CLI, or an MCP tool in Claude Code or Codex. If the graph and notes already answer it, the composer renders it immediately. Otherwise a session researches it, writes the script and the notes it derived, and the episode joins a shared library with onboarding playlists for new collaborators. Every structural claim in an explainer traces to a graph edge or a note. Corrections spoken while listening become notes on the entity under discussion, which is how human knowledge flows back into the graph.

## Multi-person model

- Identity is the git author email. `.reggie/people.yaml` lists people, roles, notification preferences, and feed token hashes.
- Claims are committed and pushed. A claim carries person, machine, tool, session, and heartbeat. Stale claims expire; takeovers are attributed.
- One directory per task and append-only journals so two people never edit the same file.
- Decisions are attributed. Two people deciding differently is surfaced, never last-write-wins.
- Blast radius and conflict detection compare across people's active claims, not just one machine.
- Teams that live in PRs get a PR path: the completion packet becomes the PR description and PR approval is the decision. Tasks mirror to GitHub Issues and Projects for teammates who don't run Reggie.
- Onboarding is `npx reggie init` in a cloned repo. No symlinks, no installer.

### Discussion

- Every plan and packet carries a discussion thread. Comments are append-only, one file each, anchored to a plan section, an acceptance criterion, a file in the blast radius, or a podcast chapter. Attributed and resolvable.
- Participants are people through the UI or voice notes, agents posting as "Claude via <person>" or the Codex equivalent, and mirrored GitHub comments.
- Discussion is unbounded. Decision is the bounded approve or needs-work at the end. Unresolved comments surface in the decision queue and in the episode so a decider sees them before deciding.
- Plans have versions. A revision keeps the thread, diffs against the prior version, and flags comments whose section changed. Approval applies to a specific version.
- Conversations broader than one task live in `.reggie/discussions/` with the same comment model, can be narrated as episodes, and can graduate into captured items. This brainstorm is the first example.

### Modes

- **Solo**: self-approval implicit, low-risk plans and completions approved by policy (decided 2026-09-15), no PR by default, Reggie performs the merge, notifications off, claims still recorded for multi-machine use, comments still available as notes to self and from agents.
- **Team**: deciders by risk class, PR by default, notifications on, discussion threads expected before high-risk approval.
- One state machine underneath. Mode is inferred from `people.yaml` and can be overridden per repo. Moving from solo to team needs no migration.

## Visualization catalog

All derived from a normalized graph (repo, package, directory, file, symbol, route, store, external service, env var, task, person, note; edges for contains, imports, calls, references, reads, writes, exposes, touches, owns, annotates, depends-on). Notes annotate nodes. Everything exports to Mermaid or SVG for GitHub. Every view also has a narration template, so any picture can be requested as an episode.

| View | Question it answers |
|------|---------------------|
| Module dependency graph | What depends on what, where are the cycles |
| Symbol call graph explorer | What calls this, what breaks if I change it |
| Directory treemap with overlays | Where is the mass, who owns it, what is hot, what is undocumented |
| Architecture container diagram | What are the big pieces and how do they talk |
| Data flow diagram and per-feature traces | Where does data come from, what touches it, where does it go |
| Data inventory bipartite | Who touches this collection, which secrets does this repo need |
| Cross-repo map | How does this repo connect to the others |
| Entry point and route map | How does a request or user action travel through the code |
| Task blast radius overlay | What will this change affect, who am I about to collide with |
| Change impact for a completion packet | What did this change and what did it risk |
| Hotspots, complexity against churn | What should we prioritize cleaning up |
| Ownership and bus factor | Who do I ask, where are we fragile as a team |
| Test coverage map | What has no tests, what did the last run say |
| State machine diagrams | What states exist and which transitions are legal |
| Sequence diagrams for key flows | In what order do the pieces talk for this scenario |
| Knowledge coverage map | What do we not understand, which docs are lying |
| Timeline of work | What happened while I was away, who worked on what |

## Open forks

- **Off-laptop reach**: git as the sync bus, or a hosted coordination service. Podcast feed hosting: Cloudflare R2 plus Worker, a local server over Tailscale, or a synced folder.
- **Episode granularity**: one edited episode per person per day (recommended), or one story per session.
- **TTS provider**.
- **Graph engine for more languages**: tree-sitter plus language servers is the proposal; deferred on 2026-09-15 until Reggie is in good shape on the repos it already parses.
- **A generated `TASKS.md` view** for readers who only use GitHub; returns when such a reader exists.
- **Risk class from the graph** instead of path rules, which decides how much the auto-approval policy can be trusted.

Closed on 2026-09-15: metadata commits, the derived journal trigger, the git-first substrate, auto-approval thresholds, the fate of `resources/`, and the fate of `TASKS.md` and `HISTORY.md`. See that block.

## Glossary

- **Packet**: the document a human decides on. Plan, completion, or backlog.
- **Awaiting decision**: the parked state between in process and done.
- **Journal**: the plain-English, listener-register account of what agents did.
- **Listener register**: same facts, no paths or slugs, written to be heard.
- **Claim**: a committed record that a person's session owns a task.
- **Inbox**: transcribed voice notes waiting to be applied.
- **Blast radius**: the files and downstream modules a task will touch.
- **Explainer**: a requested episode on a topic, scripted from the graph, notes, and code rather than from a packet.
