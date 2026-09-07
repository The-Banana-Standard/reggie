---
description: Onboard this repo to Reggie, then write the first real notes so agents can find good information.
---

Run `reggie onboard` in the repo root and read `.reggie/ONBOARDING.md`. It lists exactly which notes to write.

Then, working from the code itself, not from memory:

1. Replace the placeholder entry in `.reggie/notes/_repo.md` with a **how** entry: what this repo is, how it is run, how it is tested, in plain English.
2. For each top-level source folder listed in the brief, write a `_dir.md` **how** entry (what lives there, what depends on it) and a **gotcha** entry if you find one.
3. For every database, collection, external service, and environment variable you can find in the code, add a `store:`, `service:`, or `env:` note under `.reggie/notes/_entities/` with a **data-source** entry.
4. Fill the curated sections of CLAUDE.md (Conventions, Decisions, Gotchas). Do not edit inside the generated block.
5. Write one journal entry: `reggie journal add --stage onboard "..."`.

Use `reggie note add <path> --type <type> "text" --source <file:line>` for each note, or the `reggie` MCP tools. Cite a source for every note. When unsure, say so with `--confidence low`.
