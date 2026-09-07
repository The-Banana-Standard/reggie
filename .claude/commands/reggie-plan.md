---
description: Plan a task in plan mode against Reggie's plan contract. Usage: /reggie-plan <slug> [one-line problem]
---

Slug: $ARGUMENTS

1. Run `npx reggie context $ARGUMENTS` and read all of it. Then run `npx reggie plan new $ARGUMENTS` if no plan exists yet.
2. Enter plan mode. Explore the code read-only. Ask the user every question whose answer would change the approach; if the user is not available, answer it yourself and record it under Assumptions.
3. Write the plan into `.reggie/tasks/$ARGUMENTS/plan.md`, filling every section. Each acceptance criterion must be a statement a reviewer can check without asking. Each criterion needs a line in Verification strategy naming the evidence that will prove it.
4. Run `npx reggie plan risk $ARGUMENTS` to set the risk class from the files, then `npx reggie plan lint $ARGUMENTS` and fix every error.
5. Solo mode: commit the plan to the default branch. Team mode: commit on a `plan/$ARGUMENTS` branch and open a draft PR so others can comment on the plan lines.
6. Write one journal entry with `--stage plan`.
