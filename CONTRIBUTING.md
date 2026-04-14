# Contributing to Reggie

Thanks for your interest in contributing. Reggie is a brain-dump-to-merged-PR workflow for Claude Code — a desktop app and agent system that turns messy notes into shipped code — shared openly as a personal system, and contributions that improve it for everyone are welcome. There are two contribution tracks: (a) the Tauri desktop app itself (Rust + React) and (b) the bundled 36-agent system under `resources/`. Both are welcome.

## Setup

Prerequisites:
- [Rust](https://rustup.rs/) (stable toolchain)
- [Node.js](https://nodejs.org/) v18+
- [Tauri v2 prerequisites](https://v2.tauri.app/start/prerequisites/) for your platform

```bash
git clone https://github.com/The-Banana-Standard/reggie.git
cd reggie
npm install
```

## Dev Loop

```bash
# Run the full app in development mode (hot reload)
npm run tauri dev

# Run frontend tests
npm test

# Run Rust tests
cargo test --manifest-path src-tauri/Cargo.toml

# Frontend-only dev server (limited use, no Tauri shell)
npm run dev
```

When you run `npm run tauri dev`, the built-in installer picks up changes to `resources/` on launch — no need to manually copy files into `~/.claude/`.

## How to Contribute

1. Fork the repository
2. Create a branch for your change (`git checkout -b my-change`)
3. Make your changes
4. Test with `npm run tauri dev` — verify your change works end-to-end
5. Submit a pull request

## What You Can Contribute

### Track A — Tauri App Code
- Rust commands in `src-tauri/src/` (PTY handling, installer, session management)
- React components in `src/` (terminal view, workspace manager, session history)
- Frontend tests (Vitest) and Rust tests (cargo test)
- Tauri configuration, build pipeline, packaging

### Track B — Bundled Agent System
- New agents in `resources/agents/` for uncovered specialties
- Improvements to existing agent prompts (quality standards, common pitfalls, process)
- New commands in `resources/commands/` for workflows not yet covered
- Fixes to cross-references between agents and commands
- Fixes to tool permissions in agent frontmatter
- Documentation updates in `resources/docs/`

### Documentation and Bug Fixes
- Clarifications, corrections, new guides
- Fix outdated counts, broken links, stale references

## Guidelines

- **Follow existing patterns.** Read 2-3 similar files before creating new ones. Agents follow: Role → Core Responsibilities → Process → Quality Standards → Output Format → Common Pitfalls.
- **Keep it concise.** Agents, commands, and code should be as short as possible while being complete.
- **Test your changes.** Run `npm run tauri dev` and verify end-to-end — the installer picks up resource changes on launch.
- **One change per PR.** Don't bundle unrelated changes.

## Review Process

- All PRs are reviewed by the maintainer
- No direct pushes to main
- Expect feedback on prompt quality, code quality, consistency with existing patterns, and integration completeness

## Questions?

Open an issue if you're unsure about an approach before investing time in a PR.
