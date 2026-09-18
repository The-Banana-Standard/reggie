---
entity: packages/reggie/src/people.ts
kind: file
---

## how · 2026-09-15 · Claude via jacobpress · high
loadConfig reads an install key: a list of dir and command records naming each directory that holds installed dependencies and the command that installs them there. A missing dir defaults to the repo root; an entry is dropped when its command is empty or its dir is absolute or climbs out of the repo, because that dir becomes a path Reggie writes a symlink into and runs a command in. The key is absent in most repos, and claim then leaves a worktree exactly as git made it.
sources: packages/reggie/src/people.ts, .reggie/config.yaml

## how · 2026-09-18 · Claude via jacobpress · high
The policy block: plans and completions each name the highest risk class that passes without a person, none, low, medium or high. Absent keys take the mode's default, solo plans high and completions low, team both none. A value that is not one of the four, such as yes, 3, a list or High, takes that key's default and policySource reports the key as unreadable, never guessed at. parseConfig is split out of loadConfig so the base commit's copy is parsed by the same code as the file on disk; it throws what the YAML parser throws, and the policy report catches that. saveConfig writes the block under POLICY_COMMENT, and only ever runs when no config exists, so it cannot rewrite a hand-commented file. Nothing reads plans yet, and nothing acts on completions: it feeds the policy report only.
sources: low-risk-auto-approval

## gotcha · 2026-09-18 · Claude via jacobpress · medium
An unreadable policy value falls to the mode's default, which in solo mode is low for completions: someone who writes completions: off meaning none gets low, reported as unreadable. Harmless while the verdict is only a report; it is captured for the slice that acts on the verdict, which should consider failing closed.
sources: low-risk-auto-approval

