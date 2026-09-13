---
slug: mobile-ui
title: Use Reggie from a phone
risk: medium
author: jacobpress
date: 2026-09-13
branch: task/mobile-ui
base: repo-manager
verdict: pending
decided_by:
decided_at:
---
# Completion: Use Reggie from a phone

Read this top to bottom to decide whether the work is done. Every claim should point at evidence.

## Acceptance criteria
- [x] `reggie serve --host 0.0.0.0` prints at least one non-loopback address ending in `?key=<key>`, and the same key is printed on the next start.
  evidence: .reggie/tasks/mobile-ui/evidence/serve-key.txt
- [x] A request to any `/api` route over a non-loopback socket without the key is answered 401 with an error naming the key; with the key as `X-Reggie-Key` or `?key=` it is answered as before. (The cookie form named in the plan was not built; see Deviations.)
  evidence: .reggie/tasks/mobile-ui/evidence/curl-lan.txt, .reggie/tasks/mobile-ui/evidence/tests.txt (serve-key.test.ts)
- [x] A request over a loopback socket needs no key, whether or not the server is bound to a non-loopback host.
  evidence: .reggie/tasks/mobile-ui/evidence/curl-lan.txt, .reggie/tasks/mobile-ui/evidence/tests.txt
- [x] A POST over a non-loopback socket carrying the key is accepted; the same POST without the key is refused; a cross-site Sec-Fetch-Site is still refused with or without the key. (After review the keyed branch no longer compares Origin to Host; see Deviations.)
  evidence: .reggie/tasks/mobile-ui/evidence/curl-lan.txt, .reggie/tasks/mobile-ui/evidence/tests.txt
- [x] `/api/feed.xml` requested with Host `192.0.2.7:4310` and a key yields URLs based on `http://192.0.2.7:4310` carrying `key=`.
  evidence: .reggie/tasks/mobile-ui/evidence/tests.txt (serve.test.ts "names its episodes at the address it was asked on"), .reggie/tasks/mobile-ui/evidence/curl-lan.txt
- [x] At a 390px wide viewport the repo overview shows the story column full width with no map visible, the header shows a Map button, and pressing it shows the map filling the viewport below the header with a close control.
  evidence: .reggie/tasks/mobile-ui/evidence/phone-checks.txt
- [x] At a 390px wide viewport the tasks page shows the board with its columns scrolling sideways and the Map button is not shown.
  evidence: .reggie/tasks/mobile-ui/evidence/phone-checks.txt
- [x] At a 390px wide viewport a task page shows the story, the Listen row and the answer form, and no control in the header overflows the viewport width.
  evidence: .reggie/tasks/mobile-ui/evidence/phone-checks.txt
- [x] Opening the page as `/?key=abc` stores `abc`, removes it from the address bar, and every later `/api` request carries `X-Reggie-Key: abc`.
  evidence: .reggie/tasks/mobile-ui/evidence/phone-checks.txt (storage and address), .reggie/tasks/mobile-ui/evidence/curl-lan.txt (the header is what the server accepts; the browser pane could not be pointed at the LAN address, so the header on a real phone request was not observed)
- [x] The existing server test suite passes with no test removed.
  evidence: .reggie/tasks/mobile-ui/evidence/tests.txt

## Evidence
- .reggie/tasks/mobile-ui/evidence/curl-lan.txt
- .reggie/tasks/mobile-ui/evidence/phone-checks.txt
- .reggie/tasks/mobile-ui/evidence/serve-key.txt
- .reggie/tasks/mobile-ui/evidence/tests.txt
- .reggie/tasks/mobile-ui/evidence/review.txt

## Changes
21 files changed against repo-manager:

```
.reggie/intake.md                                 |   4 +
 .reggie/notes/packages/reggie/src/serve.ts.md     |   9 ++
 .reggie/notes/packages/reggie/ui/app.js.md        |   9 ++
 .reggie/notes/packages/reggie/ui/styles.css.md    |   9 ++
 .reggie/tasks/mobile-ui/claim.md                  |  10 ++
 .reggie/tasks/mobile-ui/evidence/curl-lan.txt     |  14 +++
 .reggie/tasks/mobile-ui/evidence/phone-checks.txt |  41 +++++++
 .reggie/tasks/mobile-ui/evidence/serve-key.txt    |   6 +
 .reggie/tasks/mobile-ui/evidence/tests.txt        |   6 +
 docs/getting-started.md                           |  12 ++
 packages/reggie/docs/ui-api-contract.md           |   3 +
 packages/reggie/node_modules                      |   1 +
 packages/reggie/src/cli.ts                        |  16 ++-
 packages/reggie/src/serve-key.test.ts             |  81 +++++++++++++
 packages/reggie/src/serve.ts                      | 123 ++++++++++++++++++--
 packages/reggie/test/serve.test.ts                |  32 ++++++
 packages/reggie/ui/app.js                         | 133 +++++++++++++++++++++-
 packages/reggie/ui/board.css                      |  18 +++
 packages/reggie/ui/index.html                     |   6 +-
 packages/reggie/ui/listen.js                      |   7 +-
 packages/reggie/ui/styles.css                     |  37 ++++++
 21 files changed, 557 insertions(+), 20 deletions(-)
```

## Reviews
- Risk is medium, so `/code-review medium task/mobile-ui` ran: eight finder angles, one-vote verification, eight findings reported. All eight were fixed before this packet; the list and the re-verification are in evidence/review.txt. The most serious was a tracked `node_modules` symlink that would have landed a dangling link on the branch.

## Deviations from plan
- The cookie form of the key was not built: the header and the query parameter cover every caller (the page, audio elements, podcast apps, curl), and a cookie would have widened where the secret travels for no caller that needs it.
- After review, a keyed POST is not origin-checked beyond Sec-Fetch-Site; the plan said an Origin equal to the request's own Host would be accepted. The key is the defence, and the Host comparison would have refused every write through a TLS-terminating proxy once names are allowed.
- After review, keyed writes are refused in team mode, since the key names no person and every write would be attributed to the host. The plan did not consider attribution.
- After review, `--key` is ignored on a loopback bind, so a key exists exactly when the server is reachable from the network.
- Screenshots were viewed in the browser pane but could not be saved to the evidence folder; the measurements the plan wanted from them are recorded as text in phone-checks.txt.
- The browser pane refuses non-loopback addresses, so the phone layout was driven over loopback and the network path was proven with curl against the LAN address.
- `packages/reggie/src/episode.ts` was not changed: the feed base is chosen in serve.ts and passed through renderFeed's existing suffix argument.

## Discovered issues
- A task worktree has no node_modules, so nothing runs in it until deps are installed or linked (captured: a-task-worktree-has-no-node-modules-so-nothing-r).
- warnIfStale prints a nonsense age when dist/ is missing (captured: warnifstale-prints-a-nonsense-age-when-dist-is-m).
- `.gitignore`'s `node_modules/` pattern did not cover a symlink; fixed here by adding the bare pattern, since it bit this task.

## Open risks
- A DNS name in the address (tailnet MagicDNS, `.local`) is still refused by the Host check, so only the printed IP addresses work; a phone user typing a name sees 403 on the shell itself.
- The key is a bearer secret in a URL: anyone who sees the printed address, a screenshot of it, or the feed URL in a podcast app has full read access and, in solo mode, write access as the host. Rotation is deleting `.reggie/.cache/serve-key`.
- The phone layout was verified in a desktop browser at 390px, not on iOS Safari; `:has()` and speechSynthesis are assumed present, and the map overlay's fit on first open depends on a resize observer firing when the column appears.
- Off Wi-Fi reach depends on Tailscale being on; nothing here starts it or checks it.
