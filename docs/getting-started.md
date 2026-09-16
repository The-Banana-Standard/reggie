# Getting started with Reggie

Reggie is a repo manager for teams that code with Claude Code and Codex. It keeps tasks, plans, notes, and a plain-English journal inside your repo, and it reads task state from git instead of keeping its own database. This guide takes you from nothing to your first finished task in about twenty minutes.

If you want to understand what Reggie adds to a repo before you touch anything, read [How Reggie structures a repo](how-reggie-structures-a-repo.md) first. If you want the rules for keeping information useful to agents, read [The information paradigm](information-paradigm.md).

## What you need

- git, and a repository you want to manage
- Node.js 20 or newer
- Claude Code, Codex, or both
- Optional: the GitHub CLI (`gh`), logged in. Reggie uses it for pull requests and issues and works without it.

## 1. Install the CLI

Reggie is not on npm yet. Install it from this repository:

```bash
git clone https://github.com/The-Banana-Standard/reggie.git
cd reggie/packages/reggie
npm install --legacy-peer-deps
npm run build
npm link
```

Check it worked:

```bash
reggie --version
```

`npm link` puts a `reggie` command on your PATH that points at this checkout. Pull and rebuild to upgrade.

The command runs the compiled build in `dist/`, not the source. So a linked checkout refuses to run after a source edit until it is rebuilt: every command stops with the file that changed and the one line that fixes it, `npm run build` in `packages/reggie`. The MCP server still starts, but each tool call returns that same message as an error, so the agent in the session tells you. To run the previous build knowingly, set `REGGIE_ALLOW_STALE=1` in the environment.

## 2. Onboard a repository

Go to the repo you want to manage and run:

```bash
reggie onboard
```

This is safe to run more than once. It creates a `.reggie/` folder with a README that explains itself, generates a facts block in `CLAUDE.md` and `AGENTS.md`, registers you in `.reggie/people.yaml`, installs four small commands under `.claude/commands/`, and points Claude Code at Reggie's MCP server through `.mcp.json`. It also writes `.reggie/ONBOARDING.md`, a checklist of the notes only a person or an agent can write.

Now let an agent write those notes. In Claude Code, open the repo and run:

```
/reggie-onboard
```

In Codex, register the MCP server once and paste the brief:

```bash
codex mcp add reggie -- reggie mcp
codex "Read .reggie/ONBOARDING.md and do what it says."
```

When the agent is done, look at `.reggie/notes/_repo.md` and the folder notes. Fix anything wrong. Then commit everything, including `.reggie/`. Nothing in it is a cache.

## On your phone

`reggie serve` listens on loopback. To read a task's story, hear it, and add what you meant from a phone on the same Wi-Fi or on your tailnet, bind every interface:

```bash
reggie serve --host 0.0.0.0
```

It prints an address for each network interface, ending in `?key=…`. Open that on the phone once; the page keeps the key and every request after that carries it. Without the key nothing under `/api` answers, so a neighbour on the network sees only an empty shell. The key lives at `.reggie/.cache/serve-key`; delete the file to rotate it. A podcast app on the phone can subscribe to the same address plus `/api/feed.xml?key=…`.

The page below 760px is one column, story first. The map sits behind a **Map** button in the header, and the tasks board scrolls one column per swipe. The Mac has to be awake and on the same network; reaching it from further away is the vision doc's open fork.

If the repo already keeps a backlog — a `TASKS.md` of open work, a `HISTORY.md` of finished work, a
folder of per-task plans from whatever ran before — you do not have to migrate any of it. Reggie
finds those files and reads them as tasks, in place. It never writes to them: you keep editing the
Markdown, and the board follows. Run `reggie tasks` after onboarding and you should see your real
backlog, not an empty one. The formats it reads, and how to point it at a different file, are in
[the reference](../packages/reggie/README.md#the-backlog-you-already-had).

## 3. Your first task, at the keyboard

The loop is capture, plan, execute, decide. Here it is end to end.

**Capture.** Write the idea down without structuring it:

```bash
reggie capture "Login retries are never capped on web" --detail "seen on staging Tuesday"
```

Reggie prints a slug, for example `login-retries-are-never-capped-on-web`. Use that slug from here on.

**Plan.** In Claude Code:

```
/reggie-plan login-retries-are-never-capped-on-web
```

The command reads the context pack, enters plan mode, explores the code read-only, asks you the questions that would change the approach, and writes `.reggie/tasks/<slug>/plan.md`. Then it sets the risk class from the files it will touch and lints the plan against the contract. A plan passes only when every acceptance criterion is something a reviewer can check without asking, and every criterion names the evidence that will prove it.

You can do the same by hand:

```bash
reggie plan new <slug>            # scaffold from the contract
# edit .reggie/tasks/<slug>/plan.md
reggie plan risk <slug>           # low, medium, or high from the files
reggie plan lint <slug>           # PASS or a list of what is missing
git add .reggie && git commit -m "plan: <slug>"
```

In solo mode, committing the plan to your default branch is the approval. The task is now **planned**.

(`reggie triage` already removed the intake line when it wrote the brief. `reggie plan done <slug>` is still there to sweep a line that outlived its brief — one captured before triage did that, or written by hand afterwards.)

**Execute.** In Claude Code:

```
/reggie-execute <slug>
```

That claims the task on a `task/<slug>` branch, does the work, saves the evidence the plan asked for under `.reggie/tasks/<slug>/evidence/`, runs the review policy for the risk class (`/code-review` at medium, `/security-review` too at high), writes notes for the files it touched, journals each step, and scaffolds the completion packet. By hand:

```bash
reggie claim <slug>               # task/<slug> branch; add --worktree to keep your checkout free
# ... do the work, commit as you go ...
reggie packet <slug>              # packet.md from the plan, the diff, and the evidence folder
# fill in the packet honestly, then commit
```

**Decide.** With `gh`, open a pull request whose body is the packet:

```bash
reggie pr <slug>
```

Approving the PR is the decision, and merging it makes the task **done**. Without `gh`, or in solo mode:

```bash
reggie decide <slug> approved --comment "Evidence matches the criteria"
git add .reggie && git commit -m "decide: <slug>"
git switch main && git merge task/<slug>
```

Check where everything stands at any time:

```bash
reggie tasks       # every task with its state, owner, and why Reggie thinks so
reggie status      # who is on what right now
reggie journal show
```

## 4. Overnight: planning without you

The same contract runs headless. Print the planning prompt and the exact commands:

```bash
reggie plan prompt <slug>
```

For Claude Code it uses `claude -p --permission-mode plan`, which can read but not write, and redirects the plan into `plan.md`. For Codex it uses `codex exec -s read-only --output-last-message`. Either way the planner answers its own questions and lists them under Assumptions, so you review assumptions in the morning instead of answering questions at night. Run `reggie plan risk` and `reggie plan lint` afterwards, then commit or open a plan PR.

## 5. Solo or team

Reggie reads `.reggie/people.yaml`. One person means **solo** mode: your commits are your approvals, and no PR is required for plans. Two or more people means **team** mode: plans go up as draft PRs so others can comment on the plan lines, task branches are pushed so claims are visible, and completion packets are decided in PR review. Override the mode in `.reggie/config.yaml`.

Claims are branches with a record on them. `reggie claim` commits a small `claim.md` naming the person, machine, and tool, so ownership is explicit from the first commit. If a `task/<slug>` branch is held by someone else, `reggie claim` refuses and tells you who has it, and `reggie release` refuses to delete their work or anyone's unmerged commits unless you pass `--force`.

## 6. The habits that make it work

- Before touching an area: `reggie context <slug>` or `reggie context <path>`.
- Before editing a file: read its note at `.reggie/notes/<same path>.md`.
- After changing a file: `reggie note add <path> --type gotcha "..."` (or `why`, `how`, `verify`, `data-source`, `decision`).
- After each step: one journal entry in plain English, no file paths.
- Found something unrelated: `reggie capture "..."`. Do not fix it in passing.
- Once a week: `reggie note stale` and `reggie docs check`.

The generated block in `CLAUDE.md` tells every agent session exactly this, so you rarely have to say it yourself.

## Where things live

| Path | What it is |
|------|------------|
| `.reggie/README.md` | The layout, explained |
| `.reggie/intake.md` | Raw captured items |
| `.reggie/tasks/<slug>/plan.md` | The plan, against the contract |
| `.reggie/tasks/<slug>/packet.md` | The completion packet a reviewer reads |
| `.reggie/tasks/<slug>/evidence/` | Proof: test output, screenshots, command output |
| `.reggie/notes/` | Knowledge, arranged like the code |
| `.reggie/journal/` | What happened, day by day, per person |
| `.reggie/people.yaml`, `.reggie/config.yaml` | Who, and which mode |
| `CLAUDE.md`, `AGENTS.md` | Curated sections plus Reggie's generated block |
| `.claude/commands/reggie-*.md` | The four thin project commands |
| `.mcp.json` | Claude Code's pointer to `reggie mcp` |

## When something is off

- `reggie docs check` says stale: run `reggie docs refresh` and commit. Run the check on a clean tree; untracked files count as part of the repo.
- `reggie claim` refuses: someone else's commits are on that branch. Talk to them or pick another task.
- `reggie pr` fails: you need `gh auth login`, a GitHub remote, and to be on the `task/<slug>` branch.
- Codex cannot see the tools: run `codex mcp add reggie -- reggie mcp` once, then start a new session.

## Seeing the connections

```bash
reggie serve
```

Opens a local page at `http://127.0.0.1:4310/` with the repo drawn as a graph: files as nodes sized by length, imports as arrows, a green ring on files that have a note, an amber ring on files whose folder has one, and task plans as diamonds linked to the files they will touch. Click a node to see the notes an agent would read before editing it and what imports it. The other tabs list tasks by state, every note, and the journal. TypeScript, JavaScript, and Rust imports are resolved in this version; other languages appear as nodes without edges.

## What this version does not do yet

This is the first release of the repo-manager direction. The graph is imports only: no call graph, data flow, cross-repo map, or ownership overlays yet. It does not generate podcast episodes, drain voice notes, or mirror tasks to GitHub Issues and Projects. Those are planned and tracked in `TASKS.md`. Everything here is designed so those features read the same files you are creating now.
