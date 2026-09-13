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
