---
slug: mobile-ui
title: Use Reggie from a phone
area: packages/reggie/ui
size: medium
risk: medium
priority: P1
author: jacobpress
created: 2026-09-13
---
# Use Reggie from a phone

## Problem
Jacob wants to open Reggie on his phone, read what it can say about a task, listen to it, and type back what he meant, from the sofa or on a walk. Today the server binds loopback only, every write is refused from any socket that is not loopback, the podcast feed's enclosure URLs point at 127.0.0.1 so a podcast app can list episodes but not play them, and the page is a desktop two-column layout that, under 1100px, stacks the map on top at 60vh of the screen. On a phone that is unreadable and read-only, which defeats the two things the phone is for: hearing the story and answering it.

## Why now
The intake story, the answer form and narration landed today, and they are exactly the surfaces that are most useful away from the keyboard. Without a phone path they only ever get used at the desk, where a terminal is already open. The vision doc also names "on the go via the podcast" as the second of the three modes of use.

## Suspected area
- packages/reggie/ui/styles.css because the shell grid, the header and the stacked breakpoint live there
- packages/reggie/ui/app.js because the fetch helpers, the header controls and the boot sequence live there
- packages/reggie/src/serve.ts because the host, origin and loopback guards are there and the feed builds its URLs there
- packages/reggie/src/cli.ts because `reggie serve` prints the address to open
- packages/reggie/src/episode.ts because renderFeed takes the base URL

## Open questions
- Same Wi-Fi only, or from anywhere over Tailscale? Answer chosen: both, by binding a non-loopback host and treating any IP literal as this server, which covers a LAN address and a tailnet address alike; a MagicDNS name is not accepted yet.
- Should the whole page need the key over the network, or only writes? Answer chosen: everything under /api needs it, because a LAN neighbour should not be able to read the repo either; the static shell stays free so the app can ask for the key.

## Not this
- A hosted or public server. This is loopback, LAN and tailnet only, still bound to one machine.
- Reworking the map for touch. The map stays a desktop instrument; on a phone it sits behind a toggle.
- Pushing episodes to a phone without the Mac running. The feed is served by `reggie serve`; off-laptop reach is the vision doc's open fork and stays open.
