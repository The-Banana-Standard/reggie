# How Reggie structures a repo

This is a plain walkthrough of what Reggie adds to a repository, why each piece exists, who writes it, and how it changes over time. There is no hidden database and no background service. Everything Reggie knows is a file you can open, and every status it reports is something it read from git.

## Before and after

A repo before Reggie:

```
my-app/
  src/
  tests/
  package.json
  README.md
```

The same repo after `reggie onboard` and a first task:

```
my-app/
  src/
  tests/
  package.json
  README.md
  CLAUDE.md                  ← curated notes + a generated block Reggie maintains
  AGENTS.md                  ← the same, for Codex
  .mcp.json                  ← tells Claude Code where Reggie's tools are
  .claude/commands/          ← four small commands: onboard, plan, execute, capture
  .reggie/
    README.md                ← explains this folder, in plain English
    config.yaml              ← solo or team, risk rules
    people.yaml              ← who works here
    intake.md                ← raw ideas, one line each
    tasks/
      cap-login-retries/
        plan.md              ← the plan, checked against a contract
        packet.md            ← the completion packet a reviewer reads
        checks.jsonl         ← what was verified, as data: one line per check
        evidence/            ← proof: test output, screenshots
    notes/
      _repo.md               ← what this repo is and how to run it
      src/_dir.md            ← what lives in src/
      src/auth/login.ts.md   ← what to know before touching login.ts
      _entities/store/users.md   ← a database collection, described
    journal/
      2026-09-06/jacob-session.md   ← what happened today, in sentences
    discussions/             ← conversations bigger than one task
```

Everything under `.reggie/` is committed. The only things Reggie ever ignores are derived caches, which do not exist yet in this version.

## The pieces, one at a time

### CLAUDE.md and AGENTS.md: two blocks, two owners

Both files have a part you write and a part Reggie writes. Your part holds conventions, decisions, and gotchas, the things a new teammate needs on day one. Reggie's part sits between two comment markers and holds facts it can derive from the repo: languages, structure, commands, entry points, tests, CI, and the standing instructions for how to work here. You never edit inside the markers. When the repo changes, `reggie docs refresh` rewrites the block, and `reggie docs check` in CI fails when it drifts.

The reason for the split is that hand-written descriptions of derivable facts go stale, and stale instructions are worse than none. Anything a script can know, a script maintains.

### .reggie/intake.md: where ideas land

One line per item, no structure required. You can add a line by hand, by `reggie capture`, from a Claude or Codex session through the MCP tools, or later from a voice note. Each line gets a slug, and the slug follows the task for the rest of its life. `reggie triage <slug>` removes the line as it writes the brief: from then on the brief is the record of that item, so this file stays the queue of what has not been shaped rather than a log of everything ever captured.

### .reggie/tasks/<slug>/plan.md: the plan, against a contract

A plan is written in plan mode by Claude Code or Codex, or by hand, but it must satisfy the same contract either way: a problem, an approach that names the alternative it rejected, the files it will touch, acceptance criteria a reviewer can check without asking, a verification strategy that names the evidence for each criterion, the assumptions made, what is out of scope, and the conditions that would send it back to planning. `reggie plan lint` enforces this. `reggie plan risk` reads the files list and sets a risk class of low, medium, or high, which decides how much review the work gets later.

### .reggie/tasks/<slug>/packet.md, checks.jsonl and evidence/: how you know it is done

What was verified is recorded as data, not as a ticked box. When a criterion has been proved, the session saves the proof under `evidence/` and runs `reggie check <slug> <criterion> pass --evidence <file>` (or calls the `reggie_check` tool); a review is recorded the same way with `--review <name>`, and a `fail` is always recordable. Each check is one JSON line in `checks.jsonl`: the criterion's key, the outcome, the evidence, who and what recorded it, when, and the commit the checkout was on. The key is a hash of the criterion's own words in the plan, so renumbering the plan changes nothing and rewording a criterion makes a new key that an old pass cannot count for. The latest line for a key wins, by its position in the file. The verb refuses a pass with no evidence, evidence that is not a non-empty regular file directly inside the task's evidence folder, and a pass while code is uncommitted, because a check proves committed code.

When the work is finished, `reggie packet` builds the completion packet from the plan: the acceptance checklist, generated from those records between two markers and never edited by hand; the list of files changed; the reviews that ran; deviations from the plan and why; issues discovered on the way; open risks. Run again, it refreshes only the checklist. `reggie packet <slug> --lint` checks the packet against its contract, the third beside the brief's and the plan's: its own slug and a verdict, the seven sections filled, a checklist equal to what the records render, and well-formed citations. A reviewer reads the packet top to bottom and decides. The evidence folder holds the proof, so a claim like "tests pass" is a file, not a sentence. All three survive forever, because a task you cannot re-verify six months later is a task you have to trust.

**The evidence gate.** A packet that cites evidence nobody committed is never approved, by hand or otherwise, and there is no override. A citation is a path on an `evidence:` line under a criterion or on a bullet under `## Evidence` that names the task's own evidence folder; it must resolve to a regular, non-empty file directly inside that folder on the task branch's tip. `reggie decide <slug> approved` and the page's Approve button both refuse otherwise, naming each path and why, with nothing written. A packet that cites nothing is approved by hand exactly as before.

**What an approval captures.** In solo mode an approval reads the packet's `## Discovered issues` and captures every bullet the queue does not hold yet into `intake.md`, inside the same merge commit as the verdict, so an issue a session wrote down and never captured is not lost. It skips the scaffold's stand-in, a bullet that says none, and a bullet that names a slug Reggie knows or repeats an intake line.

**The policy report.** `reggie check <slug>` with no outcome, and the task's page above the decide form, say what the policy would say about the finished task: would pass, refused with each reason, or not evaluated. It judges exactly two commits and no working tree, so it reads the same from any checkout. The config, the risk rules and the plan come from the integration branch's tip, and the packet, the records and the evidence from the task branch's tip, so a branch cannot lower its own risk, delete a criterion or widen the policy it is judged by; a branch that changes its own plan, `config.yaml`, `people.yaml`, another task's folder, `.mcp.json`, `.gitattributes` or anything under `.claude/` always goes to a person. It is a report: nothing acts on it yet, and a person decides every task.

### .reggie/notes/: knowledge arranged like the code

To find out what is known about `src/auth/login.ts`, open `.reggie/notes/src/auth/login.ts.md`. To learn about the folder, open `_dir.md` in the same place. The repo as a whole is `_repo.md`. Things that are not files, such as a database collection or an external service, live under `_entities/`. Each note holds dated entries with a type, an author, a confidence, and the sources it came from. Types are `why`, `how`, `gotcha`, `verify`, `data-source`, and `decision`.

A note goes stale when the code it describes changes after it was written. `reggie note stale` lists those, because a confident wrong note is the most expensive kind. The whole point of the mirror layout is that an agent about to edit a file always knows where to look first, and always knows where to write what it learned.

### .reggie/journal/: what happened, for people

Every step of work gets a short entry in plain English: what was done, why, what was uncertain. No file paths in the prose; evidence is linked separately. There is one file per person per session per day, so two people never edit the same file and merges never conflict. This is the feed a teammate reads to catch up, and later the script an audio briefing is built from.

### Branches and pull requests: the state machine you already have

Reggie does not store task status anywhere. It reads it:

| If this is true | The task is |
|---|---|
| An intake line exists and no plan does | ungroomed |
| A `plan/<slug>` branch exists, or a plan is on disk but fails the contract | grooming |
| The plan is merged to the default branch | groomed |
| A `task/<slug>` branch has commits | in process |
| A pull request from that branch is open | awaiting decision |
| That pull request is merged | done |

When a task is claimed, Reggie commits a small `claim.md` on the branch naming the person, the machine, and the tool. That record says who holds the task; the branch's last commit says when they last touched it. That is the whole claim system. In team mode branches are pushed so everyone sees them; in solo mode they can stay local. A pull request whose body is the completion packet is the review, and approving it is the decision.

### .reggie/people.yaml and config.yaml: who, and which mode

Identity is your git author email. The first person in becomes a maintainer. One person means solo mode: your commit is your approval. More than one means team mode: plans go up as draft PRs for comments, and packets are decided in PR review. Risk rules in `config.yaml` are substrings of file paths; a plan touching anything matching the high list gets full review. The `policy` block names, for plans and for completions, the highest risk class that passes without a person: `none`, `low`, `medium` or `high`. Solo mode defaults to `plans: high` and `completions: low`, team mode to `none` for both. It is always read from the integration branch's committed copy, never from a task branch, and today it feeds the policy report and nothing else.

### .claude/commands/ and .mcp.json: the thin layer for agents

Four small commands, `reggie-onboard`, `reggie-plan`, `reggie-execute`, and `reggie-capture`, tell Claude Code how to run the loop. They are deliberately short: they call the `reggie` CLI and the borrowed review commands rather than carrying long procedures of their own. `.mcp.json` points Claude Code at `reggie mcp`, a small server that exposes tasks, context, notes, journal, and capture as tools, so an agent can read and write Reggie state without shelling out. Codex uses the same server after `codex mcp add reggie -- reggie mcp`, and reads `AGENTS.md` instead of `CLAUDE.md`.

## What changes when

| Event | What Reggie touches |
|---|---|
| `reggie onboard` | Creates `.reggie/`, the generated blocks, commands, `.mcp.json`, and the onboarding brief |
| Code changes | Nothing automatically; `reggie docs refresh` updates the facts, `reggie note stale` finds notes to revisit |
| A capture | One line in `intake.md` |
| A triage | `tasks/<slug>/brief.md`, scaffolded; the intake line is removed |
| A plan | `tasks/<slug>/plan.md` |
| A claim | A `task/<slug>` branch and a journal entry |
| Work | Commits on the branch, notes for touched files, journal entries, evidence files |
| A check | One line in `tasks/<slug>/checks.jsonl`, uncommitted until the session commits it |
| A packet | `tasks/<slug>/packet.md`, its checklist generated from the checks |
| A decision | The PR review, or the packet's verdict in solo mode, where an approval also merges the branch and captures the packet's discovered issues in the same commit |
| A merge | Nothing; the task is done because git says so |

## What Reggie never does

- It never runs your coding sessions. Claude Code, Codex, or you do.
- It never keeps state you cannot see in a file or in git.
- It never edits your curated notes. Only the generated block is Reggie's.
- It never takes over someone else's branch.
- It never fixes an unrelated issue in passing. It captures it.
