---
description: Execute an approved plan, produce its evidence, run the review policy, and submit a completion packet. Usage: /reggie-execute <slug>
---

Slug: $ARGUMENTS

1. `reggie context $ARGUMENTS`; read the plan and the notes it points at. Then `reggie claim $ARGUMENTS` (add `--worktree` when other work is active in this checkout).
2. Execute the plan. You may deviate; record every deviation and its reason for the packet.
3. Produce the evidence the plan's Verification strategy names. Save outputs under `.reggie/tasks/$ARGUMENTS/evidence/` (test logs, command output, screenshots). Never claim a test passed without its output saved.
4. Reviews by risk class (from the plan's front matter): low, run the repo's own checks; medium, also run `/code-review`; high, also run `/security-review` and have a second pass execute the tests. Run `/simplify` when the diff is large. Resolve findings before continuing.
5. After each file change, add or correct its note in `.reggie/notes/`. After each step, one journal entry with `--stage execute`. Unrelated problems: `reggie capture "..."`, do not fix them.
6. `reggie packet $ARGUMENTS` creates `packet.md` from the plan, the diff, and the evidence folder (it never overwrites an existing packet; edit that in place). Fill every section honestly. Commit. Open a PR whose body is the packet (`reggie pr $ARGUMENTS`), or in solo mode ask the user to decide with `reggie decide`.
