---
slug: mobile-ui
title: Use Reggie from a phone
risk: medium
deciders: [jacobpress]
author: jacobpress
created: 2026-09-13
---
# Use Reggie from a phone

## Problem
Reggie cannot be used from a phone. The server binds loopback and refuses every write from any other socket; the feed's enclosure URLs name 127.0.0.1 so a podcast app cannot play an episode; and the page is a desktop two-column layout that stacks the map on top of a phone screen. The surfaces built today for reading and hearing a task, and for answering it, are exactly the ones wanted away from the keyboard.

## Approach
Three parts, each small. (1) A capability key for the network: when `reggie serve` is bound to a non-loopback host it reads or mints a key under `.reggie/.cache/serve-key`, prints the LAN and tailnet addresses with `?key=` appended, and requires the key on every `/api` request that arrives over a non-loopback socket, as a header, a query parameter or a cookie. Loopback traffic is unchanged. Over the network a POST may carry an Origin that matches the request's own Host, because the key, not the origin, is what a rebound page cannot forge; the Sec-Fetch-Site check stays. The page reads `?key=` once, keeps it in localStorage, strips it from the address and sends it as a header; when an API call answers 401 it shows a card asking for the key. Rejected alternative: trusting private address ranges without a key, because that opens the repo to every device on a coffee-shop network and every rebound page in a LAN browser. (2) The feed and the episode player build their URLs from the request's Host, with the key appended when the request carried one, so a podcast app on the phone can play what it lists. (3) A phone layout below 760px: one column, story first; the map column is hidden and opens as a full-screen overlay from a Map button in the header, fitted on open; the tasks board keeps its place as the page's payload with columns scrolling sideways; the lens and Dense controls step out; the reader drawer opens the overlay; touch targets and the launch menu widen. The map is not reworked for touch.

## Files to touch
- packages/reggie/src/serve.ts (MOD)
- packages/reggie/src/cli.ts (MOD)
- packages/reggie/src/episode.ts (MOD)
- packages/reggie/test/serve.test.ts (MOD)
- packages/reggie/src/serve-key.test.ts (NEW)
- packages/reggie/ui/app.js (MOD)
- packages/reggie/ui/listen.js (MOD)
- packages/reggie/ui/index.html (MOD)
- packages/reggie/ui/styles.css (MOD)
- packages/reggie/ui/board.css (MOD)
- packages/reggie/docs/ui-api-contract.md (MOD)
- docs/getting-started.md (MOD)

## Acceptance criteria
- [ ] `reggie serve --host 0.0.0.0` prints at least one non-loopback address ending in `?key=<key>`, and the same key is printed on the next start.
- [ ] A request to any `/api` route over a non-loopback socket without the key is answered 401 with an error naming the key; with the key as `X-Reggie-Key`, `?key=` or the cookie it is answered as before.
- [ ] A request over a loopback socket needs no key, whether or not the server is bound to a non-loopback host.
- [ ] A POST over a non-loopback socket carrying the key and an Origin equal to the request's own Host is accepted; the same POST without the key is refused; a cross-site Sec-Fetch-Site is still refused with or without the key.
- [ ] `/api/feed.xml` requested with Host `192.0.2.7:4310` and a key yields enclosure URLs starting with `http://192.0.2.7:4310/api/episode?` and carrying `key=`.
- [ ] At a 390px wide viewport the repo overview shows the story column full width with no map visible, the header shows a Map button, and pressing it shows the map filling the viewport below the header with a close control.
- [ ] At a 390px wide viewport the tasks page shows the board with its columns scrolling sideways and the Map button is not shown.
- [ ] At a 390px wide viewport a task page shows the story, the Listen row and the answer form, and no control in the header overflows the viewport width.
- [ ] Opening the page as `/?key=abc` stores `abc`, removes it from the address bar, and every later `/api` request carries `X-Reggie-Key: abc`.
- [ ] The existing server test suite passes with no test removed.

## Verification strategy
- Criterion 1: run `npx tsx src/cli.ts serve --host 0.0.0.0 --port 4399` twice and capture stdout to evidence/serve-key.txt; both runs print the same `?key=`.
- Criterion 2 and 3: unit tests over the pure key check in serve-key.test.ts with a loopback and a non-loopback remote address, plus a server test that a keyless request from 127.0.0.1 still works; output saved to evidence/tests.txt.
- Criterion 4: unit tests over checkPostOrigin with and without the key and with a cross-site Sec-Fetch-Site; in evidence/tests.txt.
- Criterion 5: a server test requesting the feed with a forged Host header and `?key=`, asserting the enclosure URL; in evidence/tests.txt.
- Criteria 6, 7 and 8: drive the page in the browser pane at 390px and save screenshots to evidence/phone-overview.png, evidence/phone-tasks.png and evidence/phone-task.png; assert with read_page that the header controls fit.
- Criterion 9: browser check that localStorage holds the key, the address has no `key=`, and a network request to `/api/facts` carries the header; note the result in evidence/phone-key.txt.
- Criterion 10: `npm test` output in evidence/tests.txt.

## Assumptions
- The Host header check keeps accepting bare IP literals only; a tailnet address is an IP literal, so Tailscale works, and a MagicDNS name does not until a later task adds an allowlist.
- Phone means a viewport below 760px; a tablet in portrait gets the existing stacked layout.
- The key is per machine and per repo, stored under the ignored cache; rotating it is deleting the file.
- iOS Safari supports the `:has()` selector and speechSynthesis, both true since iOS 15.4.

## Out of scope
- A touch-first map, a hosted server, HTTPS, or a MagicDNS allowlist.
- Serving the feed to a phone when the Mac is asleep.
- Any change to what the story or the narration says.

## Bail conditions
- If the loopback socket check cannot tell a LAN socket from a loopback one under the Node version in use, the key gate cannot be scoped and the whole network half returns to the brief.
- If the board or the map cannot be shown inside a fixed overlay without breaking Cytoscape's sizing, the phone layout ships without the map toggle and the overlay is dropped from this task.
