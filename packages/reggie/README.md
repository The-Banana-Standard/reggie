# reggie (CLI + MCP server)

The command-line tool and MCP server behind Reggie's repo-manager direction. Tasks, plans, notes, and journals live in `.reggie/` inside your repository; task state is derived from git branches and pull requests. Works with Claude Code and Codex.

Start with [Getting started](../../docs/getting-started.md). This file is the reference.

## Install

```bash
cd packages/reggie
npm install --legacy-peer-deps
npm run build
npm link            # puts `reggie` on your PATH
```

## Commands

| Command | What it does |
|---|---|
| `reggie onboard [dir]` | Create `.reggie/`, generate the `CLAUDE.md` and `AGENTS.md` blocks, register you, install project commands, write `.reggie/ONBOARDING.md`. Alias: `init`. Idempotent. |
| `reggie docs refresh` | Regenerate the facts block in both files. |
| `reggie docs check` | Exit 1 when a generated block is missing or stale. Use in CI on a clean tree. |
| `reggie capture <text> [--detail t] [--slug s] [--path p] [--issue]` | Add a raw item to `.reggie/intake.md`; optionally open a GitHub issue. `--path` names the file or folder the idea came from, written under the item as its last detail line (``Captured from the file `src/serve.ts` ``); a path git does not list as a file or folder of the repo is refused. |
| `reggie tasks [--all] [--json]` | Every task with its derived state, owner, and the reason. |
| `reggie task <slug>` | One task with its plan. |
| `reggie status` | Who is working on what. |
| `reggie plan new <slug> [--title] [--problem] [--files a,b] [--risk]` | Scaffold `plan.md` from the contract. |
| `reggie plan lint <slug>` | Check the plan against the contract; exit 1 on errors. |
| `reggie plan risk <slug>` | Set `risk:` from the files the plan touches and the rules in `config.yaml`. |
| `reggie plan prompt <slug>` | Print the planning prompt and the exact interactive and headless commands for Claude Code and Codex. |
| `reggie plan done <slug>` | Sweep an intake line that outlived its brief. Triage removes the line itself now, so this is only for lines captured before it did, or written by hand afterwards. |
| `reggie claim <slug> [--worktree]` | Create or switch to `task/<slug>` and commit a claim record on it; refuses a branch someone else holds. |
| `reggie release <slug> [--force]` | Delete your local task branch and worktree. Refuses someone else's branch and unmerged commits unless forced. |
| `reggie context [slug] [-p path...] [--max-lines n]` | The pack to read before working. |
| `reggie launch <slug...> [--tool claude\|codex] [--mode discuss\|build] [--note t] [--path p...] [--run]` | Print the command that opens a Claude Code or Codex session on a task (shape, plan, discuss or build, from the task's state); `--run` opens it in a new Terminal window on macOS and writes the context pack first. `--path` builds the pack around those files or folders and names them in the prompt. |
| `reggie note add <entity> -t <type> [-c conf] [-s a,b] <text>` | Add a dated entry. Entities: a file, a folder, `_repo`, `store:name`, `service:name`, `env:NAME`, `route:name`. |
| `reggie note find [query]` | Notes whose entity contains the query. |
| `reggie note path <file>` | The read-before-edit chain for a file. |
| `reggie note stale` | Entries whose code changed after they were written. |
| `reggie journal add <text> [--slug] [--stage] [--evidence a,b] [--session s]` | Append a plain-English entry. |
| `reggie journal show [--days n] [--slug] [--person]` | Recent entries, newest first. |
| `reggie journal derive <slug> [--session <uuid>] [--dry-run] [--rewrite]` | Write an entry from the task's commits and the closing words of its launched Claude sessions. Appends only what is new, prints every character it wrote, and never commits. See "The derived journal" below. |
| `reggie packet <slug> [--force]` | Scaffold the completion packet from the plan, the diff, and the evidence folder. Never overwrites an existing packet unless forced. |
| `reggie decide <slug> approved\|needs-work [--comment t]` | Record a verdict in the packet (solo mode or no-PR review). |
| `reggie pr <slug> [--draft]` | Push the task branch and open a PR whose body is the packet. Needs `gh`. |
| `reggie services [--json]` | What the repo talks to: every binding, store and API, with the manifest line that declares it and the files that touch it. Names the ones the code reads and no manifest declares first. |
| `reggie flows [id] [--depth n] [--json]` | Where data enters and where it goes. With no id, the entry points grouped by kind with their step counts and the services they reach; with one, that flow traced step by step, each step's payload in and out, and what any cap dropped. |
| `reggie people` | Who is registered and which mode is active. |
| `reggie mcp` | Start the MCP server on stdio. |
| `reggie serve [--port 4310] [--host 127.0.0.1]` | Local read-only web view: the import graph (TypeScript, JavaScript, Rust) with notes and task plans overlaid, plus tabs for tasks, notes, and the journal. Click a node for its read-before-edit note chain and its imports. |

Every command accepts `-C <dir>` to run against another repo. Text that starts with a dash must follow `--`, for example `reggie capture -- "--legacy-peer-deps is required"`.

Claims are explicit: `reggie claim` commits a small `claim.md` on the task branch naming the person, machine, and tool. Ownership is read from that record, not guessed from the last commit's author.

## Task states

Derived, never stored:

Four phases: capture it, shape it, plan it, build it.

| State | Phase | Derived from |
|---|---|---|
| ungroomed | capture | an intake line with no `brief.md`, or a `brief.md` that is still triage's unfilled scaffold |
| groomed | shape | `brief.md` exists and somebody has written into it; a plan draft that fails the contract also lands here |
| planned | plan | `plan.md` passes the contract on the default branch (solo mode also accepts a passing plan on disk) |
| in-process | build | `task/<slug>` branch with commits |
| awaiting-decision | review | open PR from that branch, or a packet on the branch |
| done | done | PR merged, or packet approved on the default branch |

A brief is the cheap half of grooming: the problem, the area, a size and a priority, written from the intake line without reading much code. `reggie triage` scaffolds it and takes the intake line with it — the brief is the record of that item from then on — but the card stays ungroomed until the scaffold is filled in, so scaffolding a column never reports untouched drafts as shaped work. A plan is the expensive half. Splitting them lets you shape a whole backlog in one pass and plan only what you decide to build.

## The backlog you already had

Most repos arrive with a hand-written backlog. Reggie reads it in place, as a task source, and never
writes to it: the Markdown file stays yours to edit, and the board follows what it says.

Found automatically at the repo root, case-insensitively: `TASKS.md` (or `BACKLOG.md`, `TODO.md`) for
open work, `HISTORY.md` (or `DONE.md`, `COMPLETED.md`) for finished work, and `.pipeline/` (or
`.tasks/`) for per-slug plan documents an older pipeline left behind.

Lines are read in either of the two shapes those files settle into. Only the tag words below are
taken as metadata, so a Markdown link or a bracketed aside stays in the title:

```markdown
### Chatbot — Core Experience
- [ ] wrap-rail-pills: Pills wrap instead of clipping [P1] [moderate] [code] [depends: pin-docs]
  files: src/Rail.js (MOD), src/__tests__/rail.test.js (NEW)
- [x] pin-context-docs Pinned pills became guarantees -- 2026-09-05
```

| Tag | Becomes |
|---|---|
| `[P1]` `[P2]` `[P3]` | the priority chip |
| `[trivial]` `[simple]` `[small]` `[moderate]` `[complex]` | the size chip (small, medium, large) |
| `[code]` `[manual]` `[content]` and friends | a kind badge |
| `[planned]` | planned, but only when the plan document really exists |
| `[parked]` | hidden from the board until you tick **Show parked** |
| `[depends: a, b]` `[conflicts: c]` | links to those tasks |
| `[tier: opus:high]` | shown as written |

State still comes from git. A legacy line supplies "this task exists" plus the author's own shaping;
a `task/<slug>` branch, a packet or a pull request overrides it. A ticked box means done, a line
under an `Ungroomed` heading means ungroomed, and anything else the file shapes means groomed.

Point Reggie elsewhere, or switch a source off, in `.reggie/config.yaml`:

```yaml
legacy:
  tasks: docs/BACKLOG.md
  history: false
```

## The derived journal

`reggie journal derive <slug>` writes a journal entry from what is already on disk, for a task in flight or a finished one. It reads two things. The task's commits: `base..task/<slug>` while the branch lives, and after that the branch side of the merge that landed it (or, for a fast-forward, the commits whose body names the task). And the closing words of each Claude Code session it can tie to the task by a recorded session id: the launch log under `.reggie/.cache/launches/`, a UUID in the claim file, a journal day file named by a session, or `--session <uuid>`. It never guesses a session by directory or time, it names a Codex launch as unread, and it does not read subagent transcripts.

What it reads from a transcript is one kind of record only: the assistant's closing message of a turn, from the main conversation, written while the session was working inside this repository (and inside the task's own worktree, once it has been there; records in another task's worktree are never read). The owner's prompts, tool calls and their results, reasoning, attachments, titles and the compaction summary are never read. Only the newest closing message since the last entry is quoted. It is flattened to one line, so it cannot forge an entry or a link; secret shapes, email addresses and local paths are replaced by `[withheld]` and counted; and it is cut to 800 characters. That filter is by kind first and by pattern second, and neither is a guarantee: an assistant can repeat something private in words no pattern knows. So the verb never commits and never pushes, prints every character it wrote, and has `--dry-run`. Read the entry, then commit it. A journal file already tracked on the branch blocks the next `reggie decide` in that checkout until it is committed, as a hand entry does; a brand-new day file does not, so commit it before you land the task.

**What the redactor cannot catch, before you point this at a public repo.** The pattern pass errs toward withholding, but it catches only shapes it knows. It does **not** catch a secret spoken in prose ("the password is X"), a value passed as a bare flag (`--password X`, `curl -u a:b`), a key with no known prefix and no mixed case (a hex or UUID key, anything short), a phone number, an IP address, an internal hostname, an obfuscated email, a client's or a person's name, or a relative path holding a username. **The withheld count says nothing about what was missed** — it is the number of shapes it recognised, not a measure of safety. The only real safeguard is that the verb never commits: read the entry before you commit it. This is why the quotation is one closing message of the assistant's own prose (where secrets rarely sit) and not tool output, prompts or reasoning (where they do).

**What a derived entry publishes to git**, so you can judge it for a public repo: the full Claude session id, three times over — in the day file's name `<person>-<session id>.md`, in that file's `# Journal · … · <session id>` heading, and in the entry's `derived: session=<id>` line; the `through=` instant to the millisecond and the entry's own local clock time and date; and, by design, cross-task quoting **within one repo** — a session that never entered the slug's own worktree has its newest closing message inside the repository quoted whichever task that message was about. None of an absolute path, the Claude home, a transcript file name, or a commit id outside the `derived:` line is ever written.

Each derived entry ends with a line `derived: session=… through=… commits=… prose=…`. That line is the watermark: a second run tells only commits no entry has named and quotes only a closing message later than `through`, so running it again with nothing new writes nothing. A commit whose every file is under `.reggie/journal/` is never narrated, so committing the entry the verb tells you to commit does not make the next run tell that commit. A session's entry goes to `.reggie/journal/<date>/<person>-<session id>.md`; an entry drawn from commits alone goes to the file a hand entry would. **A rebase is a known gap**: the watermark names commit ids, so rebasing a task branch changes every id and the next run narrates the branch again (`derive-re-narrates-a-rebased-branch`).

`--rewrite` is off by default. It sends the entry's text, and nothing else, to the session's own tool (`claude -p`) for one rewrite per entry, in a fresh empty directory with no tools, no MCP servers, no saved session, none of your user, project or local settings, and a fixed system prompt in place of the default; it falls back to the template on any failure. As of 2026-09-18 that call has never been run, by a person or by the tests.

Until a session records its real id in the claims and entries it writes (`session-name-reads-real-id`), only a session started through `reggie launch` can be found on its own. For any other, the entry is drawn from commits alone unless you name the session with `--session`.

## MCP server

`.mcp.json` (written by `onboard`) points Claude Code at `reggie mcp`. For Codex: `codex mcp add reggie -- reggie mcp`.

Tools: `reggie_tasks`, `reggie_task`, `reggie_context`, `reggie_find_notes`, `reggie_add_note`, `reggie_journal`, `reggie_capture` (with an optional `path`, the file or folder the idea came from, checked the way `reggie capture --path` checks it), `reggie_plan_new`, `reggie_lint_plan`, `reggie_people`. There is no launch tool: launching opens a terminal on the serving machine and is a human act. Resources: `reggie://readme`, `reggie://intake`, `reggie://onboarding`.

Writes made through the server are attributed as `Claude via <handle>` or `Codex via <handle>`, detected from the environment; set `REGGIE_TOOL` to override.

A linked checkout refuses to run after a source edit until it is rebuilt: when `dist/` is behind `src/`, every CLI command exits 1 with the file that changed and the fix, and every MCP tool call returns the same message as an error result (or tells the session to restart the server when `dist/` was rebuilt after it started). Set `REGGIE_ALLOW_STALE=1` to run the previous build anyway. Code run from `src/` through tsx, and an installed package, are never refused.

## The plan contract

Front matter: `slug`, `title`, `risk` (low, medium, high), `deciders`, `author`, `created`. Sections in order: Problem, Approach, Files to touch, Acceptance criteria, Verification strategy, Assumptions, Out of scope, Bail conditions. Criteria are `- [ ]` lines a reviewer can check without asking. Placeholders in parentheses and any `TBD`/`TODO` fail the lint.

## Development

```bash
npm test            # vitest, including an end-to-end MCP client test
npm run typecheck
npm run dev -- tasks
```

Source layout: one module per concern under `src/` (`paths`, `git`, `gh`, `layout`, `people`, `facts`, `docs`, `notes`, `journal`, `plan`, `tasks`, `packet`, `context`, `claim`, `capture`, `onboard`, `mcp`, `cli`). Tests sit beside the modules; `test/helpers.ts` builds throwaway git repos.
