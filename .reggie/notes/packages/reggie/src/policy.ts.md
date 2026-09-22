---
entity: packages/reggie/src/policy.ts
kind: file
---

## how · 2026-09-18 · Claude via jacobpress · high
What is read from which commit. From the base commit, the tip of the integration branch: .reggie/config.yaml (the mode, the policy block, the risk rules) and the task's plan.md (the criteria, the risk line, the file list). From the branch tip: packet.md, checks.jsonl, the evidence files, and the list of changed files since the merge base, listed with rename detection off. Both are resolved once to full ids by resolveCommit and never named again. No working tree is read, so the report is byte-identical from the integration checkout and from the task worktree whatever is uncommitted in either. The one thing taken from a disk is the integration branch's name, from the integration checkout's config, which is found by structure: a Reggie worktree is always the integration checkout's .worktree/<slug>, confirmed by git worktree list naming the parent on a branch that is not a task or plan branch. A name that begins with a dash or holds anything outside letters, digits, dot, underscore, slash and hyphen is refused before it reaches git.
sources: low-risk-auto-approval

## decision · 2026-09-18 · Claude via jacobpress · high
The control files a branch may not change, fixed in controlFileReason and taking no configuration: its own plan.md, .reggie/config.yaml, .reggie/people.yaml, any path under another task's folder, .mcp.json, .gitattributes, and anything under .claude/. They are compared without regard to letter case. Reading the policy from the base protects this merge and not the next one, so a branch that changes what Reggie or the next session obeys always goes to a person. For its own plan the gate also says which field moved. CLAUDE.md and AGENTS.md are deliberately not on the list, because every task refreshes their generated block; that is a known limit left to the risk rules. Measured over the fifteen landed loop tasks, three would have gone to a person this way.
sources: low-risk-auto-approval

## how · 2026-09-18 · Claude via jacobpress · high
The gates, in order: policy, plan, controls, packet, criteria, evidence, risk, merge. Would pass means no gate fails; the merge gate may read not-checked on a git older than 2.38 and that changes no verdict. The effective risk class is the highest of the plan's line, riskFromFiles over its file list, and riskFromFiles over every changed path outside the task's own folder and the journal. A pass counts only with evidence that resolves and only while its head is an ancestor of the tip with no file outside .reggie/ changed since. Not evaluated, each with its sentence and no throw: a base that cannot be named, a config that does not parse on disk or on the base commit, team mode, a task already approved on the base, no task branch, no packet on it. evaluationStats counts calls so a test can prove the task list never evaluates. In this version nothing acts on the verdict; the second slice, policy-acts-on-its-verdict, does.
sources: low-risk-auto-approval

## verify · 2026-09-18 · Claude via jacobpress · medium
policy.test.ts holds one row per tampering and per gate, and its gates were mutation checked on 2026-09-18: with the control list emptied ten tests fail, with staleness switched off two, with the class taken from the plan's line alone two, and with the plan read from the branch instead of the base six. If a change here leaves every test green, break the gate on purpose once before trusting that.
sources: low-risk-auto-approval

## gotcha · 2026-09-18 · Claude via jacobpress · high
evaluateCompletion wraps its whole body: anything it throws comes back as a not-evaluated report whose sentence carries the message with the checkout's own path replaced by a dot. It runs on every load of a task page, so a git failure nobody foresaw must be a sentence on the page and never a 500. Keep new reads inside evaluate, not beside it.
sources: low-risk-auto-approval
