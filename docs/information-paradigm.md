# The information paradigm

How a repo managed by Reggie keeps information good enough that agents find what they need and people trust what they read. These are the rules the tooling enforces and the habits it expects.

## The problem this solves

Agents work well when the right context is in front of them and badly when it is not. Most repos have knowledge in three bad places: in one person's head, in a long document nobody updates, and in commit messages nobody reads. The usual fix, a big hand-written guide, drifts within weeks and then misleads with confidence.

Reggie's answer is to decide, for every kind of information, exactly where it lives, who writes it, how it is dated, and how staleness is detected. Then it puts a single entry point in front of every agent session.

## Six rules

### 1. Knowledge mirrors code

Information about a path lives at the same path under `.reggie/notes/`. A file's note is `notes/<path>.md`. A folder's note is `notes/<folder>/_dir.md`. The repo's note is `notes/_repo.md`. Things that are not files, such as databases, external services, environment variables, and routes, live under `notes/_entities/<kind>/<name>.md`.

There is nothing to search and nothing to guess. An agent about to edit `src/auth/login.ts` reads `notes/_repo.md`, `notes/src/_dir.md`, `notes/src/auth/_dir.md`, and `notes/src/auth/login.ts.md`, in that order. `reggie note path <file>` prints exactly that chain. The same layout tells the agent where to write what it learned.

### 2. Derived facts are generated, never typed

Languages, structure, commands, entry points, tests, CI: anything a script can read from the repo is written by a script into the generated block of `CLAUDE.md` and `AGENTS.md`. People and agents write only what the script cannot know: why, conventions, decisions, gotchas. `reggie docs refresh` regenerates; `reggie docs check` fails CI on drift. Hand-editing inside the markers is the one thing the paradigm forbids.

### 3. Every entry is dated, attributed, sourced, and rated

A note entry is not a paragraph. It is a header and a paragraph:

```
## gotcha · 2026-09-06 · Claude via jacob · high
Retries are capped in the client, not the server. Changing the server cap does nothing for web.
sources: src/auth/login.ts:42, cap-login-retries
```

The date lets staleness be computed: `reggie note stale` compares each entry's date to the last commit that touched its entity. The author tells a reader whether a person or an agent said it, and through whom. The confidence tells them how hard to lean on it. The sources let them check. An entry without a source is an opinion, and the onboarding command asks agents to cite one every time.

### 4. Three registers, three homes

The same event produces three different kinds of writing, and they must not be mixed:

- **Reference** for agents goes in notes. Short, typed, keyed to an entity, meant to be read before an edit.
- **Narrative** for people goes in the journal. Sentences, no paths, meant to be read or heard later to understand what happened and why.
- **Decisions** go in plans and packets. Structured against a contract, meant to be approved.

A plan that contains journal prose is hard to lint. A note that contains a story is hard to trust. A journal that lists file paths is unreadable aloud. Keep each in its register.

### 5. Read before edit, write after change

The habit, stated in every generated block so no session can miss it:

1. Before starting a task: `reggie context <slug>`. It assembles the plan, the notes for every file in scope, related tasks, recent commits, active work nearby, and the task's journal.
2. Before editing a file: read its note.
3. After changing a file: add or correct its note. If an existing entry is now wrong, add a new entry that says so rather than deleting history.
4. After each step: one journal entry.

Agents follow this because the instruction is in front of them and the commands are one line. People follow it because the notes they read are the notes they wrote.

### 6. Capture, do not fix

Anything discovered that is not the current task goes to `reggie capture`. It lands in intake with the person, the source, and the date. Nothing is lost and nothing sprawls. Later, triage decides whether it becomes a task. This rule is what keeps notes and journal focused on one thing at a time, which is what keeps them useful.

## Note types, and when to use each

| Type | Answers | Example |
|---|---|---|
| `why` | Why does this exist or look this way? | "Exists because the SDK has no retry policy of its own." |
| `how` | How does it work, in plain words? | "Reads the puzzle for today from the daily collection, falls back to yesterday." |
| `gotcha` | What will bite you? | "The animation leaves nodes at 0.2x scale; measure after settling." |
| `verify` | How do I prove it works? | "Run the auth tests; the outage case is `login.test.ts` under 'offline'." |
| `data-source` | Where does data come from and go? | "Writes to `users/{uid}/stats`; read by the web dashboard only." |
| `decision` | What was chosen, and what was not? | "Chose three retries over five; five felt like a hang." |

## What goes in CLAUDE.md, and what does not

The curated sections of `CLAUDE.md` hold rules that apply everywhere in the repo and that every session should carry: conventions, cross-cutting decisions, and gotchas that are not tied to one file. Anything tied to a file, folder, or entity belongs in its note. The generated block covers facts. Keep `CLAUDE.md` short; it is loaded into every session, and every line there is a line of context that could have been spent on the task.

`AGENTS.md` is Codex's version. Its generated block is identical. Its curated sections should match `CLAUDE.md` by convention, or make one a symlink to the other.

## Keeping it honest over time

- **Weekly**: `reggie note stale` and `reggie docs check`. Confirm or correct stale entries with a new dated entry.
- **On every PR**: notes for touched files are part of the diff. Reviewers read them like code. A packet whose criteria point at no evidence is not approved.
- **On onboarding a new person**: they read `_repo.md`, then the `_dir.md` notes, then `reggie journal show --days 30`. If that is not enough to start, the notes are missing something; write it.
- **When a note is wrong**: add an entry that says what is right and cites the source. Do not delete the old one; the history of being wrong is itself information.
- **When there are too many entries**: consolidate into one `how` entry with high confidence and cite the entries it replaces. Notes are reference, not a diary.

## Anti-patterns this replaces

- A 400-line `CLAUDE.md` that describes the file tree by hand.
- Agent memory that lives in a gitignored folder on one machine and is deleted when a task completes.
- "Documentation" that is a list of what was done, not what a reader needs to know.
- Pipeline stages that regenerate the same prose about the repo on every run.
- Status kept in a markdown table that only one machine can see.
