# Intake

Raw items waiting for triage. Anyone can add a line here, by hand, by voice
note, or by asking Claude or Codex to capture it. No structure is required.

Format Reggie writes (angle brackets are placeholders):

    - <slug>: <one-line description> (<person>, <source>, <date>)
      > <optional detail>

Reggie turns items into plans under `tasks/<slug>/plan.md`. Once a plan is
merged, the intake line is removed.

- try-the-new-guidebook: Try the new guidebook (jacobpress, web, 2026-09-07)
- mobile-ui: Use Reggie from a phone: read a task's story, listen to it, and add what I meant, over Wi-Fi or Tailscale (jacobpress, cli, 2026-09-13)
  > Today reggie serve binds loopback, every write is refused from any other socket, the feed's enclosure URLs point at 127.0.0.1, and the page is a two-column desktop layout that stacks the map on top under 1100px. On a phone that is unreadable and read-only. Wanted: a phone layout (story first, map behind a toggle), writes allowed from a phone through a capability token that keeps the rebinding defence, and a feed a podcast app on the phone can actually play.
- a-task-worktree-has-no-node-modules-so-nothing-r: A task worktree has no node_modules, so nothing runs in it until deps are installed or linked (jacobpress, cli, 2026-09-13)
  > Discovered building mobile-ui: reggie claim --worktree checks out .worktree/<slug> from git, and packages/reggie/node_modules is ignored, so npm test and the server fail there until npm ci runs (slow) or node_modules is symlinked from the main checkout (what I did). claim --worktree should either run the repo's install command from the generated facts or link node_modules from the root checkout when the lockfile is identical.
- warnifstale-prints-a-nonsense-age-when-dist-is-m: warnIfStale prints a nonsense age when dist/ is missing (jacobpress, cli, 2026-09-13)
  > Running the CLI through tsx in a fresh worktree with no dist/ prints 'src/serve.ts changed 497038 hours ago, after dist/ was last compiled'. When dist/ does not exist the warning should say so or stay quiet; the age arithmetic is against a missing file.
