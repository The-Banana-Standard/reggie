# Reggie

<p align="center">
  <img src="reggie-logo.png" alt="Reggie" width="200">
</p>

**A repo manager for Claude Code and Codex.** Reggie keeps tasks, plans, notes, and a plain-English journal inside each repo, derives task state from git, and serves a local web view that explains the code and the work.

Reggie does not run your sessions. Claude Code, Codex, or a plain terminal do that. Reggie is the shared ledger and map that every tool and every person reads and writes.

Everything runs locally — no external APIs, no cloud dependencies. Start at [docs/getting-started.md](docs/getting-started.md); the design and its open questions are in [docs/repo-manager-vision.md](docs/repo-manager-vision.md).

---

## The loop

```text
capture -> shape (brief) -> plan -> build -> decide
```

1. `reggie capture "…"` puts a raw idea in `.reggie/intake.md`.
2. `reggie triage <slug>` scaffolds a brief from that line and removes the line; you fill the brief in with the problem, the suspected area, a size and a priority.
3. Plan in your tool's own plan mode against Reggie's plan contract, then `reggie plan lint <slug>`.
4. `reggie claim <slug>` starts a `task/<slug>` branch; the plan names the evidence that will prove it works.
5. `reggie packet <slug>` writes the completion packet, and the PR body is that packet.

Task state is not stored — it is read from git. An intake line means ungroomed, and so does a brief still holding triage's scaffold; a brief somebody has written into means groomed; a plan that passes the contract means planned; a `task/<slug>` branch means in process; an open PR means awaiting decision; a merge means done.

---

## Install

Requires Node.js 20+.

```bash
git clone https://github.com/The-Banana-Standard/reggie.git
cd reggie/packages/reggie
npm install --legacy-peer-deps
npm run build
npm link
```

Then, in any repo you want Reggie to manage:

```bash
reggie onboard
```

That writes `.reggie/`, generates the `CLAUDE.md` and `AGENTS.md` blocks both tools auto-load, and registers the MCP server so Claude Code and Codex reach the same state through the same tools.

---

## The web view

```bash
reggie serve
```

Opens a local, read-mostly view of the repo: a plain-English story column beside a map that stays in lockstep with it, from the whole repo down to a single file, plus a task board, the services the code talks to, and how data flows through it. Nothing is hand-written — every fact is derived from the code, git, and the notes, and anything inferred by a heuristic says so.

---

## Development

```bash
cd packages/reggie
npm install --legacy-peer-deps
npm test          # vitest
npm run typecheck
npm run build
npm run dev -- serve --port 4311   # run the CLI from source
```

`npm test`, `npm run build`, and `npm run typecheck` also work from the repo root and delegate here.

---

## Documentation

- [docs/getting-started.md](docs/getting-started.md) — install, onboard, and the first task
- [docs/how-reggie-structures-a-repo.md](docs/how-reggie-structures-a-repo.md) — what lands in `.reggie/` and why
- [docs/information-paradigm.md](docs/information-paradigm.md) — notes, journal, and evidence: the three audiences
- [docs/repo-manager-vision.md](docs/repo-manager-vision.md) — the v3 direction, its decisions and open forks
- [packages/reggie/docs/](packages/reggie/docs/) — the web UI spec, API contract, and page specs

## The v2 agent system

`resources/` still holds the 37-agent, 36-command pipeline system that Reggie v2 installed into `~/.claude/`. v3 borrows procedures instead of shipping them — planning happens in each tool's native plan mode, and review, security, and simplify steps are delegated to the tools' own commands — so these files are retained for the v2 line rather than extended. See [resources/docs/REGGIE.md](resources/docs/REGGIE.md).

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## Security

See [SECURITY.md](SECURITY.md) to report vulnerabilities.

## License

MIT — see [LICENSE](LICENSE).
