# Contributing to Reggie

Thanks for your interest in contributing. Reggie is a repo manager for Claude Code and Codex: it keeps tasks, plans, notes, and a plain-English journal inside each repo, derives task state from git, and serves a local web view that explains the code and the work. It is shared openly as a personal system, and contributions that improve it for everyone are welcome.

There are two contribution tracks: (a) the product, a TypeScript CLI, MCP server, and web UI under `packages/reggie/`, and (b) the retained v2 agent system under `resources/`.

## Setup

Prerequisites: [Node.js](https://nodejs.org/) 20+.

```bash
git clone https://github.com/The-Banana-Standard/reggie.git
cd reggie/packages/reggie
npm install --legacy-peer-deps
```

`--legacy-peer-deps` is required: npm 10.9 crashes resolving vitest 4's peers without it.

**If you have `~/.claude/{agents,commands,hooks}` symlinked into this repo's `resources/`, never check out another branch in your main clone** — it swaps the live agents for every project on your machine. Use a worktree:

```bash
git worktree add .worktree/my-change
```

## Dev loop

```bash
cd packages/reggie
npm test                          # vitest
npm run typecheck                 # tsc --noEmit
npm run build                     # tsc
npm run dev -- serve --port 4311  # run the CLI from source
npm run dev -- <any command>      # e.g. tasks, context, note add
```

`npm test`, `npm run build`, and `npm run typecheck` also work from the repo root and delegate into the package. CI runs exactly these three on Linux and macOS.

## How to contribute

1. Fork the repository.
2. Create a branch for your change.
3. Make your changes, with tests.
4. Verify end to end — for anything the web view renders, run `serve` and look at it.
5. Submit a pull request.

## What you can contribute

### Track A — the product (`packages/reggie/`)

- **Server** (`src/`): the graph and views, story generation, services and data-flow derivation, task state, notes, journal, plan and brief contracts, the HTTP server, the MCP tools.
- **Client** (`ui/`): vanilla ES modules, no bundler and no framework. Libraries are vendored from `node_modules` and served at `/vendor`, with a CDN fallback.
- **Tests** (`src/*.test.ts`, `test/`): every module has a unit test; `test/serve.test.ts` starts a real server against a fixture repo.

### Track B — the v2 agent system (`resources/`)

Retained for the v2 line rather than extended — v3 borrows procedures instead of shipping them. Fixes and documentation corrections are welcome; new agents generally are not.

### Documentation and bug fixes

Clarifications, corrections, new guides; fixing outdated counts, broken links, and stale references.

## Guidelines

- **Follow existing patterns.** Read two or three similar files before creating a new one.
- **Reggie owns state, contracts, policy, and glue.** Procedures that Anthropic, OpenAI, or the community maintain — plan mode, `/code-review`, `/security-review`, `/simplify`, `/init` — are borrowed by name, never copied in.
- **Nothing durable is gitignored.** If a feature needs state, it is a file under `.reggie/` or something git already records.
- **Every command must work for a team**, not only for one person: attribution, no shared-file conflicts, no silent takeovers.
- **Say what you cannot derive.** Anything inferred by a heuristic is labelled as one, in the tooltip and in the prose. A confident wrong answer is worse than no answer.
- **Test your changes.** A change that the UI renders needs a test and a look at the real page.
- **One change per PR.** Don't bundle unrelated changes.

## Review process

- All PRs are reviewed by the maintainer.
- No direct pushes to main.
- Expect feedback on code quality, consistency with existing patterns, and integration completeness.

## Questions?

Open an issue if you're unsure about an approach before investing time in a PR.
