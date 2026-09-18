---
entity: .reggie/config.yaml
kind: file
---

## how · 2026-09-18 · Claude via jacobpress · high
The policy block was added by hand on 2026-09-18, additions only: plans high, completions low, under a comment that says what each key means and that it is read from the integration branch's committed copy, never from a task branch. Today it changes nothing in this repo: plans high admits every class, which is what the board already does, and completions is read only by the policy report. When policy-acts-on-its-verdict lands, completions low is what will let a low-risk task whose every gate holds be merged with no person deciding; set it to none to switch that off.
sources: low-risk-auto-approval

