---
entity: .github/workflows/ci.yml
kind: file
---

## how · 2026-09-15 · Claude via jacobpress · high
One job, reggie, runs on ubuntu and macos with its working directory set to the package, and runs five commands in order: install, typecheck, test, build, and the generated-block check. The check is invoked as node dist/cli.js docs check rather than through the bin, because nothing installs the bin in this job, and it has to come after the build for two reasons: the compiled entry point does not exist before it, and the CLI refuses every command when its build is behind its source. Keep it last.
sources: .github/workflows/ci.yml:35, packages/reggie/src/docs.ts

## how · 2026-09-22 · Codex via jacobpress · medium
Pushes to both main and repo-manager run the same Linux/macOS package job; pull requests remain unfiltered.

