<!-- buildContext(paths, config, {"slug":"the-big-area-is-big","paths":["src/big"]}) on the fixture repo; what POST /api/launch writes to .reggie/.cache/context/the-big-area-is-big.md -->
# Context pack for the-big-area-is-big

Repo: fixture: 75 files; TypeScript (57), Markdown (4), Rust (4), JSON (3); manifests: package.json; commands: npm run build, npm run test; tests: 6 files.

## Plan: none yet for the-big-area-is-big
Write one with `reggie plan new the-big-area-is-big` or in plan mode against the contract.

## Notes to read first
### _repo (repo)
- **how** 2026-09-18 reggie (high): Onboarded on 2026-09-18. Facts are generated into CLAUDE.md and AGENTS.md; this file holds what a person or agent learned that the facts cannot say. Replace this entry with the first real overview.
  sources: CLAUDE.md
- **why** 2026-09-18 Test Person (high): A fixture repo that exists so the tests have a small codebase with a long import chain, a tiny area, and a native crate to read.
  sources: package.json
- **how** 2026-09-18 Test Person (high): A fixture repo: a long import chain under the big area, a tiny area, and a native crate reached over Tauri IPC. Run the tests with npm test.
  sources: package.json
### src/big/ (dir)
- **gotcha** 2020-01-01 Test Person (medium · STALE): The chain must stay in order; a01 is the entry and a45 the leaf.
  sources: src/big/a01.ts

## Files in scope
- src/big

## Recent commits touching these files
- 2026-09-18 8365b20 Test Person: code: big chain, tiny area, shared types, native crate

## Related tasks touching the same files
- share-shape-helpers (awaiting-decision, Test Person): Share the shape helpers
- cache-chain-shape (in-process, Test Person): Cache the chain shape

## Active work elsewhere in the repo
- share-shape-helpers (awaiting-decision, Test Person, task/share-shape-helpers)
- cache-chain-shape (in-process, Test Person, task/cache-chain-shape)

## Working agreement
- Read the notes above before editing. After changing a file, add or correct its note.
- Write one plain-English journal entry after each step; `reggie journal derive the-big-area-is-big` adds the commits and a launched session's closing words, not the reasons. Capture unrelated problems; do not fix them here.
