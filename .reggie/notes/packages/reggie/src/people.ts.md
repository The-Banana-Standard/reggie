---
entity: packages/reggie/src/people.ts
kind: file
---

## how · 2026-09-15 · Claude via jacobpress · high
loadConfig reads an install key: a list of dir and command records naming each directory that holds installed dependencies and the command that installs them there. A missing dir defaults to the repo root; an entry is dropped when its command is empty or its dir is absolute or climbs out of the repo, because that dir becomes a path Reggie writes a symlink into and runs a command in. The key is absent in most repos, and claim then leaves a worktree exactly as git made it.
sources: packages/reggie/src/people.ts, .reggie/config.yaml

