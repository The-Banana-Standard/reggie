---
entity: packages/reggie/src/deps.ts
kind: file
---

## how · 2026-09-15 · Claude via jacobpress · high
Makes a claimed worktree runnable, one entry at a time from the install list in .reggie/config.yaml. Lockfiles decide between linking and installing: the same lockfile names present on both sides, at least one of them, and every pair byte-identical, or it runs the directory's command instead. A link is an absolute symlink of the whole node_modules into the serving checkout. Every probe that asks whether something is a usable folder follows symlinks, because the serving checkout's own node_modules is a link whenever Reggie runs from inside a worktree. Nothing here ever throws at its caller: a filesystem error becomes a failed outcome, because claimTask's callers read a throw as 'someone else holds this branch'.
sources: packages/reggie/src/deps.ts, a-task-worktree-has-no-node-modules-so-nothing-r

## gotcha · 2026-09-15 · Claude via jacobpress · high
A real node_modules directory in a worktree is never touched, only described. When its lockfile no longer matches the branch, the outcome is still present but carries pending, so the claim prints the install command and the build prompt names it. pending, not the status, is what says the session still owes a command: a configured directory that is not in the worktree fails without it, because telling someone to install into a directory that is not there is worse than saying nothing.
sources: packages/reggie/src/deps.ts:1

