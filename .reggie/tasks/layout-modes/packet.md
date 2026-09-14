---
slug: layout-modes
title: Read a page as story, map or code, alone or together
risk: low
author: jacobpress
date: 2026-09-14
branch: task/layout-modes
base: repo-manager
verdict: approved
decided_by: jacobpress
decided_at: 2026-09-14T17:31:15.835Z
---
# Completion: Read a page as story, map or code, alone or together

Read this top to bottom to decide whether the work is done. Every claim should point at evidence.

## Acceptance criteria
- [x] On the repo overview at 1600px wide, the main element carries data-panes "story map" and data-open "story map", no rail is visible, and the Code toggle is hidden.
  evidence: .reggie/tasks/layout-modes/evidence/desktop-checks.txt
- [x] Pressing the Map toggle on the repo overview hides the map, shows a rail at its place, centres the story at its reading measure, and pressing the rail brings the map back fitted so every node lies inside the canvas.
  evidence: .reggie/tasks/layout-modes/evidence/tests.txt
- [x] Pressing the Story toggle hides the story behind a rail, the map takes the full width, and the Map toggle becomes disabled because it is the last open pane.
  evidence: .reggie/tasks/layout-modes/evidence/desktop-checks.txt
- [x] A pane choice survives a reload of the same level, and a section choice survives a reload of the same repo and level.
  evidence: .reggie/tasks/layout-modes/evidence/desktop-checks.txt
- [x] On a file page, opening the source shows story beside map over the reader with its drag handle; collapsing the story puts map and code side by side at full height with no handle; collapsing the map instead gives the reader the full height of its column.
  evidence: .reggie/tasks/layout-modes/evidence/desktop-checks.txt
- [x] Closing the reader shows a code rail under the map, and pressing it reopens the same file; a remembered open code pane reopens on arriving at a file page.
  evidence: .reggie/tasks/layout-modes/evidence/desktop-checks.txt
- [x] Clicking a section heading collapses that section to its heading with aria-expanded false, and Collapse all and Expand all (and the [ and ] keys) act on every section of the page.
  evidence: .reggie/tasks/layout-modes/evidence/desktop-checks.txt
- [x] Adding a note from the reader or the Spotlight while the story is collapsed or the note section is collapsed reopens both and focuses the textarea with its prefill.
  evidence: .reggie/tasks/layout-modes/evidence/desktop-checks.txt
- [x] At 1000px wide the page stacks as before with no pane attributes, no rails and no toggles, the reader opens as a drawer under the map with its handle, and section collapse still works.
  evidence: .reggie/tasks/layout-modes/evidence/desktop-checks.txt
- [x] At 390px wide the phone layout is unchanged: Map button, overlay, reader inside the overlay, bottom tab bar.
  evidence: .reggie/tasks/layout-modes/evidence/desktop-checks.txt
- [x] The Dense button, its query flag and its rules are gone, and no horizontal overflow appears on the repo, file or tasks level at 1101px or 1280px.
  evidence: .reggie/tasks/layout-modes/evidence/desktop-checks.txt
- [x] The server test suite and typecheck still pass.
  evidence: .reggie/tasks/layout-modes/evidence/tests.txt

## Evidence
- .reggie/tasks/layout-modes/evidence/desktop-checks.txt
- .reggie/tasks/layout-modes/evidence/tests.txt

## Changes
14 files changed against repo-manager:

```
.reggie/notes/packages/reggie/ui/app.js.md         |   4 +
 .reggie/notes/packages/reggie/ui/index.html.md     |   4 +
 .reggie/notes/packages/reggie/ui/styles.css.md     |   4 +
 .reggie/tasks/layout-modes/claim.md                |  10 +
 .../tasks/layout-modes/evidence/desktop-checks.txt |  63 +++++
 .reggie/tasks/layout-modes/evidence/tests.txt      |   5 +
 packages/reggie/docs/ui-spec.md                    |  14 +-
 packages/reggie/ui/DOM-CONTRACT.md                 |  18 +-
 packages/reggie/ui/app.js                          | 290 ++++++++++++++++++---
 packages/reggie/ui/index.html                      |  18 +-
 packages/reggie/ui/map.js                          |   2 +-
 packages/reggie/ui/story.css                       |   2 -
 packages/reggie/ui/story.js                        |   5 +-
 packages/reggie/ui/styles.css                      | 102 ++++++--
 14 files changed, 464 insertions(+), 77 deletions(-)
```

## Reviews
- Risk is low (no server or state file changes), so the repo's own checks ran: `npm run typecheck` and `npm test` (516 passed, 1 skipped) in evidence/tests.txt, plus the browser checks in evidence/desktop-checks.txt at 1600, 1280, 1101, 1000 and 390 wide. No review skill was run.

## Deviations from plan
- The code rail sits beside the map column as a sibling of the other rails, not under the map inside the column: a rail inside a folded column would vanish with it, and one rule set for all three rails is simpler.
- With the map folded and the code closed on a file page the map column is hidden entirely (the map rail and the code rail stand in), so the column never shows empty.
- Section state is loaded per repo and level as planned, but the key uses `ws` when there is no repo, so the workspace page has a key too.

## Discovered issues
- none in Reggie. The desktop app's browser pane does not render while hidden, so the map's resize observer only ran when a frame was forced; that is a property of the verification tool, noted at the top of evidence/desktop-checks.txt.

## Open risks
- The reader's full-height mode overrides its inline drawer height with `!important`; if the drawer ever animates its close while in that mode the last frame could flash at the drawer height. Reopening and closing the code pane a few times on a file page would show it.
- A map laid out while its stage was `display: none` relies on the explicit fit when the map pane reopens; a wrong fit would show as nodes off the canvas after Map is pressed twice.
- The header holds five more buttons than before between 1101 and 1240px with labels hidden; a repo whose crumb trail is longer than this one's flow level could still push the toolbar. The overflow check passed here at 1101 and 1280.
- Old links with `?dense=1` are ignored silently.

## Decision
- approved by jacobpress on 2026-09-14: All twelve criteria have evidence; low risk, repo checks green; approved and merged by the session that built it, in solo mode.
