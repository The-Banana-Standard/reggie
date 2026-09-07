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
| `reggie capture <text> [--detail t] [--slug s] [--issue]` | Add a raw item to `.reggie/intake.md`; optionally open a GitHub issue. |
| `reggie tasks [--all] [--json]` | Every task with its derived state, owner, and the reason. |
| `reggie task <slug>` | One task with its plan. |
| `reggie status` | Who is working on what. |
| `reggie plan new <slug> [--title] [--problem] [--files a,b] [--risk]` | Scaffold `plan.md` from the contract. |
| `reggie plan lint <slug>` | Check the plan against the contract; exit 1 on errors. |
| `reggie plan risk <slug>` | Set `risk:` from the files the plan touches and the rules in `config.yaml`. |
| `reggie plan prompt <slug>` | Print the planning prompt and the exact interactive and headless commands for Claude Code and Codex. |
| `reggie plan done <slug>` | Remove the intake line after the plan exists. |
| `reggie claim <slug> [--worktree]` | Create or switch to `task/<slug>` and commit a claim record on it; refuses a branch someone else holds. |
| `reggie release <slug> [--force]` | Delete your local task branch and worktree. Refuses someone else's branch and unmerged commits unless forced. |
| `reggie context [slug] [-p path...] [--max-lines n]` | The pack to read before working. |
| `reggie note add <entity> -t <type> [-c conf] [-s a,b] <text>` | Add a dated entry. Entities: a file, a folder, `_repo`, `store:name`, `service:name`, `env:NAME`, `route:name`. |
| `reggie note find [query]` | Notes whose entity contains the query. |
| `reggie note path <file>` | The read-before-edit chain for a file. |
| `reggie note stale` | Entries whose code changed after they were written. |
| `reggie journal add <text> [--slug] [--stage] [--evidence a,b] [--session s]` | Append a plain-English entry. |
| `reggie journal show [--days n] [--slug] [--person]` | Recent entries, newest first. |
| `reggie packet <slug> [--force]` | Scaffold the completion packet from the plan, the diff, and the evidence folder. Never overwrites an existing packet unless forced. |
| `reggie decide <slug> approved\|needs-work [--comment t]` | Record a verdict in the packet (solo mode or no-PR review). |
| `reggie pr <slug> [--draft]` | Push the task branch and open a PR whose body is the packet. Needs `gh`. |
| `reggie people` | Who is registered and which mode is active. |
| `reggie mcp` | Start the MCP server on stdio. |
| `reggie serve [--port 4310] [--host 127.0.0.1]` | Local read-only web view: the import graph (TypeScript, JavaScript, Rust) with notes and task plans overlaid, plus tabs for tasks, notes, and the journal. Click a node for its read-before-edit note chain and its imports. |

Every command accepts `-C <dir>` to run against another repo. Text that starts with a dash must follow `--`, for example `reggie capture -- "--legacy-peer-deps is required"`.

Claims are explicit: `reggie claim` commits a small `claim.md` on the task branch naming the person, machine, and tool. Ownership is read from that record, not guessed from the last commit's author.

## Task states

Derived, never stored:

| State | Derived from |
|---|---|
| ungroomed | intake line, no plan |
| grooming | `plan/<slug>` branch, or a plan on disk that fails the contract |
| groomed | `plan.md` merged to the default branch (solo mode also accepts a passing plan on disk) |
| in-process | `task/<slug>` branch with commits |
| awaiting-decision | open PR from that branch, or a packet on the branch |
| done | PR merged, or packet approved on the default branch |

## MCP server

`.mcp.json` (written by `onboard`) points Claude Code at `reggie mcp`. For Codex: `codex mcp add reggie -- reggie mcp`.

Tools: `reggie_tasks`, `reggie_task`, `reggie_context`, `reggie_find_notes`, `reggie_add_note`, `reggie_journal`, `reggie_capture`, `reggie_plan_new`, `reggie_lint_plan`, `reggie_people`. Resources: `reggie://readme`, `reggie://intake`, `reggie://onboarding`.

Writes made through the server are attributed as `Claude via <handle>` or `Codex via <handle>`, detected from the environment; set `REGGIE_TOOL` to override.

## The plan contract

Front matter: `slug`, `title`, `risk` (low, medium, high), `deciders`, `author`, `created`. Sections in order: Problem, Approach, Files to touch, Acceptance criteria, Verification strategy, Assumptions, Out of scope, Bail conditions. Criteria are `- [ ]` lines a reviewer can check without asking. Placeholders in parentheses and any `TBD`/`TODO` fail the lint.

## Development

```bash
npm test            # vitest, including an end-to-end MCP client test
npm run typecheck
npm run dev -- tasks
```

Source layout: one module per concern under `src/` (`paths`, `git`, `gh`, `layout`, `people`, `facts`, `docs`, `notes`, `journal`, `plan`, `tasks`, `packet`, `context`, `claim`, `capture`, `onboard`, `mcp`, `cli`). Tests sit beside the modules; `test/helpers.ts` builds throwaway git repos.
