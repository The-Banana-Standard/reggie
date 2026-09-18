---
entity: packages/reggie/src/launch.ts
kind: file
---

## gotcha · 2026-09-08 · Claude via jacobpress · high
Builds and starts Claude Code or Codex sessions in four modes. Two separate quoting layers that must not be confused: shellQuote for the command, appleScriptLiteral for the osascript wrapper. Every slug is validated before it reaches a command string and nothing ever runs through a shell. The osascript call is bounded by a timeout because macOS gates Terminal automation behind a consent dialog, and the server is single-threaded, so an unanswered prompt would block every other request.
sources: packages/reggie/src/launch.ts

## how · 2026-09-13 · Claude via jacobpress · medium
Two launch modes, discuss and build. The goal (shape, plan, discuss, build) is derived from the task's state by resolveGoal, so no button chooses a prompt and no Reggie slash command is ever emitted. Discussion goals open Claude Code in plan mode and Codex read-only; a build expects the caller to have claimed the task and passes the branch. The prompt names a context file the caller wrote under .reggie/.cache/context, and carries the user's note verbatim.
sources: packages/reggie/src/launch.ts:1

## gotcha · 2026-09-13 · Claude via jacobpress · medium
launchCommand is pure and mints nothing. Session ids, context files, launch records and the claim for a build are the caller's job (serve.ts POST /api/launch and cli.ts launch --run both do it); keep them there so GET /api/launch can describe a command without side effects.
sources: packages/reggie/src/launch.ts:1

## how · 2026-09-15 · Claude via jacobpress · medium
The build prompt asks for a Task: <slug> line in the commit message body, not a trailer; history reads the line anywhere in the body, so keep the wording and the parser agreeing.
sources: task-attribution-by-merge

## how · 2026-09-15 · Claude via jacobpress · high
A build prompt carries the dependency setup the claim did not finish. LaunchInput.setup is a list of directories and commands, from pendingSetup over the claim's outcomes, and the prompt names each one before it says to execute the plan. Every build prompt, setup or not, tells the session to unlink a node_modules symlink before adding or changing a dependency. Both launchers claim with deps: defer rather than installing themselves.
sources: packages/reggie/src/launch.ts, a-task-worktree-has-no-node-modules-so-nothing-r

## how · 2026-09-15 · Claude via jacobpress · medium
The shape prompt says triage also removes the intake line, and tells the session to fill in a brief that is already there rather than passing --force, because the scaffold's Problem is where the captured words live once the line is gone.

## how · 2026-09-17 · Claude via jacobpress · high
recordLaunch still writes the single latest record per slug, and now also appends the same object as one line to a log beside it, so a plan launch followed by a build launch keeps both session ids. A record written before the log existed is carried into the log before it is overwritten. readLaunches returns every launch oldest first, skips lines that do not parse or are not a launch for that slug, and validates the tool and goal, because the cache is a file anyone can edit. The record still names no person and a Codex launch still has no id; both are captured, not fixed.
sources: derive-the-journal

## how · 2026-09-18 · Claude via jacobpress · high
LaunchInput.paths names the places the pack was built around. launchCommand checks only what can reach a command line (an empty entry, a control character, more than eight, longer than 512) and adds one sentence after the context clause in every goal, build included; whether each path is a file or folder of the repo is the caller's check through resolveCaptureOrigin, the same split the slug and the note have. A path reaches the command only inside the single-quoted prompt, exactly where the note already does. writeContextPacks is the one function both launchers use to write the packs, so the server and the CLI cannot disagree about what a session reads first; launchCommand itself stays pure.
sources: idea-from-every-page

## how · 2026-09-18 · Claude via jacobpress · high
The build prompt tells a session to record each criterion with reggie check or the reggie_check tool and each review with --review, to record a check after the code it proves is committed and after the last commit that changes code or docs because a pass goes stale once anything outside .reggie/ changes after it, to list every unrelated problem under Discovered issues because an approval captures what the session did not, to run reggie packet again until the checklist is current and check it with --lint, and to read reggie check <slug> for what a decider will see. It still ends by asking the person to decide; the session is never told to decide for itself.
sources: low-risk-auto-approval

