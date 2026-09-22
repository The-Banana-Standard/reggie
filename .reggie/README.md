# .reggie — what this folder is

Reggie keeps everything a team and its coding agents need to know about this
repo in one place, next to the code, under version control. Nothing here is a
cache. If a file exists, it is meant to be read and committed.

## The layout

- `intake.md` — raw ideas, bugs, and requests. One line each. No structure needed.
- `tasks/<slug>/plan.md` — the plan for one piece of work. Written in plan mode,
  checked against a contract, approved before anyone codes.
- `tasks/<slug>/packet.md` — the completion packet: what was done, how it was
  verified, what changed, what was found. This is what a reviewer reads.
- `tasks/<slug>/checks.jsonl` — what was verified, as data: one line per check
  of a criterion or a review, written by `reggie check`. The packet's checklist
  is built from these lines; nobody ticks a box by hand.
- `tasks/<slug>/evidence/` — test output, screenshots, command output that
  proves the packet's claims. A packet that cites a file which is not committed
  here is refused when someone approves it.
- `notes/` — knowledge about the code, arranged as a mirror of the code tree.
  Information about `src/auth/login.ts` lives at `notes/src/auth/login.ts.md`.
  Information about the `src/auth/` folder lives at `notes/src/auth/_dir.md`.
  Repo-wide knowledge lives at `notes/_repo.md`. Things that are not files, such
  as databases, routes, and external services, live under `notes/_entities/`.
- `journal/YYYY-MM-DD/<person>-<session>.md` — a plain-English record of what
  each person and each agent did, written as the work happens.
- `discussions/` — conversations bigger than one task, such as direction or
  architecture, that can turn into tasks.
- `people.yaml` — who works here and their roles. `config.yaml` — solo or team
  mode, risk rules, the default branch.

## How state works

Reggie does not keep a separate status database. It reads git:

- An intake line is **ungroomed**, and so is a `brief.md` that is still the
  scaffold `reggie triage` wrote.
- A `brief.md` somebody has written into is **groomed**. A plan that passes the
  plan contract is **planned**.
- A `task/<slug>` branch with commits is **in process**. Its last commit says who and when.
- An open pull request for that branch is **awaiting decision**.
- A merged pull request is **done**.

## The habit that makes this work

Before you change a file, read its note. After you change it, update the note.
Before you start a task, run `reggie context <slug>`. When you finish a step,
write one journal entry in plain English. That is the whole discipline.
