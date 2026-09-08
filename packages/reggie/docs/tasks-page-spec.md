# Tasks page and the four-phase task model

Addendum to `ui-spec.md` and `ui-api-contract.md`. Where this document disagrees with them, this one wins; update those two as you implement.

## 1. Why the state model changes

Today a task jumps from `ungroomed` (a raw intake line) straight to `grooming` the moment a plan file appears. That collapses two different pieces of work into one: deciding **what a task is** (shaping a raw line into a problem statement, an area, a size and a priority) and deciding **how to do it** (a full plan against the contract, informed by reading the code). In practice the first happens in bulk across many items, and the second happens one task at a time and costs far more.

So the model gains a real middle state. The phases are: capture it, shape it, plan it, build it.

## 2. States

| State | Means | Derived from |
|---|---|---|
| `ungroomed` | Captured, not yet shaped. | An intake line, or a task folder, with no `brief.md`. |
| `groomed` | Shaped by triage: it has a problem statement, a suspected area, a size and a priority. No full plan yet. | `brief.md` exists (on the default branch, or on disk) and no plan passes the contract. A plan draft that fails the contract leaves the task here, with the reason naming the draft. |
| `planned` | Fully groomed: a plan that passes the contract, informed by the code. Ready to build. | `plan.md` passes `lintPlan` and is on the default branch; in solo mode a passing plan on disk counts. |
| `in-process` | Someone holds the branch and is building. | `task/<slug>` branch, no packet, or a packet marked needs-work. |
| `awaiting-decision` | Finished, waiting for a verdict. | An open PR, or `packet.md` on the branch without a needs-work verdict. |
| `done` | Merged or approved. | PR merged, or `packet.md` with `verdict: approved` on the default branch. |

`grooming` is removed as a state name. A `plan/<slug>` branch, or a plan draft failing the contract, is reported as `groomed` with a reason that says a plan is in progress. Anything that has a plan but no brief is still `planned` (or `groomed` if the plan fails); a brief is not retroactively required for tasks that already have plans.

`STATE_MACHINE` gains the new states, definitions, rules and transitions, including the two new triggers: triage writes the brief (`ungroomed → groomed`) and planning writes the plan (`groomed → planned`).

## 3. The brief

`.reggie/tasks/<slug>/brief.md`, written by triage. Front matter: `slug`, `title`, `area` (a repo-relative dir, or empty), `size` (`small` | `medium` | `large`), `risk` (`low` | `medium` | `high` | `unset`), `priority` (`P1` | `P2` | `P3`), `author`, `created`. Sections in order: `## Problem` (a short paragraph in plain English), `## Why now`, `## Suspected area` (a bullet per file or directory the work probably touches, with a short reason), `## Open questions` (each would change the shape of the work, or "none"), `## Not this` (what a reader might confuse it with).

A brief is far cheaper than a plan: it is written from the intake line, the graph and the notes, without reading much code. `lintBrief(content)` mirrors `lintPlan`: every section present and non-empty, no placeholder text left in parentheses, no `TBD`, `size` and `priority` set. Errors block, warnings advise.

New module `src/brief.ts` exporting `renderBriefTemplate`, `parseBrief`, `lintBrief`, `briefFile`/`briefRelPath` helpers (add the path helpers to `paths.ts` beside the plan ones, with the same slug validation).

## 4. Launching work

The page must be able to actually start a session, not merely describe one. `src/launch.ts`:

- `launchCommand({repo, tool, mode, slugs})` returns `{ command, cwd, description }` — a pure function, no side effects, so the UI can display and copy it.
- `launchSession(...)` spawns it in a new terminal window and returns `{ launched, command, pid? }`. On macOS use `osascript` to tell Terminal to run the command in the repo directory; on other platforms return `{ launched: false }` with the command so the UI falls back to copy. Never `shell: true` with interpolated user input: build the argument vector, and quote the repo path and prompt with a single quoting helper that is unit tested against paths containing spaces and quotes.

Modes, per tool:

| Mode | Claude Code | Codex |
|---|---|---|
| `chat` | `claude "<discussion prompt>"` | `codex "<discussion prompt>"` |
| `triage` | `claude "/reggie-triage <slugs>"` | `codex "<triage prompt>"` |
| `plan` | `claude "/reggie-plan <slug>"` | `codex "<plan prompt>"` |
| `implement` | `claude "/reggie-execute <slug>"` | `codex "<execute prompt>"` |

The chat prompt must say plainly that this is a discussion and that the session must not edit files: something like "Discuss the task `<slug>` with me. Run `reggie context <slug>` first and read it. Do not edit any file, do not write a plan, do not start work — answer questions and think it through with me."

For Codex, where no slash commands exist, inline the equivalent instruction and point at the same CLI verbs, so both tools do the same thing.

Two new project commands installed by `onboard`, alongside the existing four: `reggie-triage.md` (shape one or more ungroomed items into briefs, in bulk, conversationally) and `reggie-chat.md` (discuss a task, read-only). Add them to `COMMANDS` in `onboard.ts`.

## 5. CLI

- `reggie triage [slug]` — scaffold `brief.md` from the intake line. `--all` scaffolds one for every ungroomed item. `--title`, `--area`, `--size`, `--priority` prefill; `--force` rewrites a brief that is already there.
- `reggie brief lint <slug>` — check a brief against its contract; exit 1 on errors.
- `reggie brief show <slug>` — print it.
- `reggie launch <slug...> --tool claude|codex --mode chat|triage|plan|implement` — print the command, and run it with `--run`. `triage` accepts several slugs; the other modes take exactly one.
- `reggie tasks` output gains the new states.

Shipped, with these differences from the lines above:

- The slug is **optional** (`triage [slug]`), because `--all` names no slug; passing both is an error, as is passing neither. `--title` and `--area` are refused with `--all`, since they shape one task. `--size` and `--priority` are validated against `SIZES` and `PRIORITIES` and fail with the list.
- `--force` was added: without it an existing brief is reported and left alone, because a brief holds thinking no template can reproduce. The scaffolding itself lives in `src/triage.ts` (`scaffoldBrief`, `isSize`, `isPriority`, `isRisk`), shared with `POST /api/triage` so both produce byte-identical briefs.
- `reggie tasks` now **groups by state**: one heading per state in board order (`awaiting-decision, in-process, planned, groomed, ungroomed, done`) carrying the state's label, its count and its one-line definition from `STATE_MACHINE`, then one card per task showing the brief's shaping decisions as chips (`[P2 · medium · low risk · src/big/]`), the owner, the last activity, the title, and the git reason. It closes with the next move (`reggie triage --all`, or `reggie launch <slug> --mode plan --run`). `--json` is unchanged, and `reggie task <slug>` still uses the single-line `renderTaskLine`.
- `reggie launch --run` prints the command on stdout either way; when nothing could be started it then exits 1 with the reason on stderr, so a script can tell.

## 6. API

- `GET /api/tasks` — each task gains `brief: { exists, area, size, priority, problem } | null` and `phase` (`capture` | `shape` | `plan` | `build` | `review` | `done`, a coarser grouping for the page).
- `GET /api/task/<slug>` — gains `brief` (parsed sections like `plan`), and for finished tasks a `completion` block: verdict, who decided and when, the criteria with pass/fail and evidence links, the diff summary, the commits, and the journal for the slug.
- `GET /api/launch?slug=&tool=&mode=` — the command and description, without running anything.
- `POST /api/triage` `{ slug }` or `{ slugs: [...] }` — scaffold briefs; returns what was created.
- `POST /api/launch` `{ slugs, tool, mode }` — spawn the session. Same guards as the other POST routes (loopback socket, `Sec-Fetch-Site`, `Origin`, 64 KB). Returns `{ launched, command }`; when `launched` is false the UI shows the command to copy.

Shipped, with these differences. `docs/ui-api-contract.md` carries the full shapes.

- `GET /api/tasks` needed no change: `listTasks` already returns `brief` and `phase` on every `TaskInfo`, and the route serialises `TaskInfo` whole.
- `completion.criteria[].evidence` is not a bare string list but `{ path, route, exists }`: `path` as the packet wrote it, `route` the `/api/evidence` URL when the reference names a file under `.reggie/tasks/<slug>/evidence/` (`null` otherwise), and `exists` whether that file is really there. A criterion that claims proof nobody saved is then visible as such rather than a dead link.
- `completion.diff` is `{ files: [{path, added, deleted}], filesChanged, added, deleted, commits }`, summed from the numstat of the task's own commits with `.reggie/` records excluded. The commits come from the `Task:` trailer in the history index; when the work is still unmerged the index (read from HEAD) has never seen it, so `<base>..task/<slug>` is read directly with the same format and the same parser.
- `GET /api/launch` requires `tool` and `mode` — no defaults — and 400s on an unknown tool or mode, no slug, an unsafe slug, or more than one slug in a mode other than `triage`. It does not check the slugs against the task list: it only describes a command.
- `POST /api/triage` returns `{ created: string[], skipped: { slug, reason }[] }`. It accepts `slug` and `slugs` together (union, de-duplicated). There is no `force` over HTTP, and a slug no task in this repo carries is skipped rather than creating a task folder from nothing: a button must not be able to erase thinking or invent a task.
- `POST /api/launch` accepts `slug` as a singular alias, and adds 404 `unknown task: …` on top of the `GET` validation, so a session is never opened on a task that does not exist.
- `GET /api/state-machine` needed no change; it reads `TASK_STATES` and `STATE_MACHINE`, so it reported the six states as soon as `tasks.ts` did.

## 7. The page

Route `#/repo/<name>/tasks`. Two views on one page, switched by a segmented control: **Open** (default) and **Completed**.

**Open** shows the four working states as columns, in order: Ungroomed, Groomed, Planned, In process, plus Awaiting decision. Each column header carries its one-line rule. Cards show title, priority and risk chips, area, owner, and last activity. The column header for Ungroomed carries a **Shape these** action that triages every item in the column at once (this is the "initialization for a set of ungroomed tasks"), with a checkbox on each card to narrow the set.

**Completed** lists done tasks newest first. Each row expands, or opens the task page, to show what was actually done: the verdict and who gave it, the acceptance criteria with pass or fail and links to the evidence, the files changed, and the journal entries for that task. This is the "how do I know it was done" view, for work that finished.

Per-card actions, by state:

| State | Actions |
|---|---|
| ungroomed | Read the intake line; **Shape it** (triage: POST, or launch a triage session); **Discuss** |
| groomed | **Read the brief**; **Plan it** (launch plan mode in Claude or Codex); **Discuss** |
| planned | **Read the plan**; **Start** (launch implement, Claude or Codex); **Discuss** |
| in-process | Read the plan; open the branch; **Discuss** |
| awaiting-decision | Read the packet; Approve / Needs work; **Discuss** |
| done | **What was done** (the completion block) |

Every launch action offers both tools. Remember the last tool used in `localStorage` and default to it. Before spawning, show the exact command in the button's tooltip; after spawning, toast what was started. If the platform cannot spawn, show the command in a copyable field instead and say why.

An **Add a task** form sits at the top of the Ungroomed column, always visible: one text field, an optional detail field, POSTing to `/api/capture`, and the new card appears without a reload.

Empty states use the register the rest of the product uses: say why it is empty and what fills it.

## 8. Acceptance

1. A repo with no tasks shows the Add form and an empty-state sentence explaining the four phases.
2. Capturing through the form creates an intake line and an Ungroomed card without a reload.
3. Shaping an ungroomed card writes `brief.md` and the card moves to Groomed, with the reason naming the brief.
4. Selecting three ungroomed cards and pressing Shape these writes three briefs in one action.
5. A groomed card reads its brief in place; a planned card reads its plan; both render the sections, not raw markdown.
6. Plan it on a groomed card launches a planning session in the chosen tool, in that repo, and the toast names the command.
7. Start on a planned card launches an implement session; Discuss on any card launches a session whose prompt forbids editing.
8. The Completed view shows, for a finished task, the verdict, who decided it, each criterion with pass or fail and a working evidence link, the files changed, and the journal for that task.
9. `reggie tasks` from the CLI reports the same six states as the page for the same repo.
10. Typecheck clean, tests green, zero console errors, and no node drawn outside the canvas on the task page at 1600, 1280 and 1000 px.
