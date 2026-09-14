---
slug: layout-modes
title: Read a page as story, map or code, alone or together
risk: low
deciders: [jacobpress]
author: jacobpress
created: 2026-09-14
---
# Read a page as story, map or code, alone or together

## Problem
The three panes of a page (story, map, reader) sit in a fixed arrangement, and Dense mode is the only lever. Jacob wants each pane collapsible with the open ones filling the width naturally, and every story section collapsible from its heading. Decided with him on 2026-09-14: with all three open the page is two columns with the right one split (story beside map over code); collapsed panes stay reachable by a rail where the pane was and by Story, Map and Code toggles in the header; Dense is retired; open panes share the width equally with the story capped at its reading measure.

## Approach
One table in app.js says which panes a level has, and two attributes on the main element carry the layout: which panes apply and which are open, in the canonical order story, map, code. CSS reads only those attributes. The main grid becomes a flex row: the story is a share floored at its minimum and capped at its measure, the map column is a share, and the reader stays inside the map column as today, so three open panes are story beside map over code with the drawer's drag handle intact. When the story is collapsed the map column becomes a two-column grid so map and code sit side by side; when the map is collapsed the reader fills the column at full height by a CSS override of its inline drawer height. Rails are static buttons shown by CSS when their pane applies and is collapsed. The code pane is open exactly when the reader is not hidden, mirrored into the attribute by the observer that already exists for the phone. Section collapse changes the one section builder: the heading becomes a toggle button, a collapsed section hides everything but its heading, and the collapsed set is remembered per repo and level. Dense is removed. Rejected: moving the reader out of the map column into a third top-level pane; it gives three equal columns, which Jacob did not want, and it would drop the drawer's draggable split. Also rejected: per-combination grid templates; flex shares give every combination from one rule.

## Files to touch
- packages/reggie/ui/index.html (MOD)
- packages/reggie/ui/styles.css (MOD)
- packages/reggie/ui/story.css (MOD)
- packages/reggie/ui/app.js (MOD)
- packages/reggie/ui/story.js (MOD)
- packages/reggie/ui/DOM-CONTRACT.md (MOD)
- packages/reggie/docs/ui-spec.md (MOD)

## Acceptance criteria
- [ ] On the repo overview at 1600px wide, the main element carries data-panes "story map" and data-open "story map", no rail is visible, and the Code toggle is hidden.
- [ ] Pressing the Map toggle on the repo overview hides the map, shows a rail at its place, centres the story at its reading measure, and pressing the rail brings the map back fitted so every node lies inside the canvas.
- [ ] Pressing the Story toggle hides the story behind a rail, the map takes the full width, and the Map toggle becomes disabled because it is the last open pane.
- [ ] A pane choice survives a reload of the same level, and a section choice survives a reload of the same repo and level.
- [ ] On a file page, opening the source shows story beside map over the reader with its drag handle; collapsing the story puts map and code side by side at full height with no handle; collapsing the map instead gives the reader the full height of its column.
- [ ] Closing the reader shows a code rail under the map, and pressing it reopens the same file; a remembered open code pane reopens on arriving at a file page.
- [ ] Clicking a section heading collapses that section to its heading with aria-expanded false, and Collapse all and Expand all (and the [ and ] keys) act on every section of the page.
- [ ] Adding a note from the reader or the Spotlight while the story is collapsed or the note section is collapsed reopens both and focuses the textarea with its prefill.
- [ ] At 1000px wide the page stacks as before with no pane attributes, no rails and no toggles, the reader opens as a drawer under the map with its handle, and section collapse still works.
- [ ] At 390px wide the phone layout is unchanged: Map button, overlay, reader inside the overlay, bottom tab bar.
- [ ] The Dense button, its query flag and its rules are gone, and no horizontal overflow appears on the repo, file or tasks level at 1101px or 1280px.
- [ ] The server test suite and typecheck still pass.

## Verification strategy
- Criteria 1 to 3: drive the browser pane at 1600px on the repo overview, read the main element's dataset and the toggles' aria state with read_page and javascript_tool, and check window.__reggieMap.cy.extent() against the node positions after the rail is pressed; record in evidence/desktop-checks.txt.
- Criterion 4: reload and read localStorage keys reggie.panes.repo and reggie.sections.reggie.repo; in evidence/desktop-checks.txt.
- Criteria 5 and 6: the same on a file page after Read the source, checking the map column's display and the reader's computed height and the handle's display; in evidence/desktop-checks.txt.
- Criterion 7: click a heading, read the class and aria-expanded, press the tools and the keys; in evidence/desktop-checks.txt.
- Criterion 8: select lines in the reader with the story collapsed, press Add a note, read the focused element and the textarea value; in evidence/desktop-checks.txt.
- Criteria 9 and 10: resize to 1000 and 390 and repeat the reads from the mobile-ui task; in evidence/desktop-checks.txt.
- Criterion 11: grep the shipped files for is-dense and dense, and run the overflow audit at 1101 and 1280; in evidence/desktop-checks.txt.
- Criterion 12: npm test and npm run typecheck output in evidence/tests.txt.

## Assumptions
- Flex shares with a capped story give the widths Jacob wants; if the story looks too narrow beside the map at 1440px the cap is one token.
- A CSS override of the reader's inline height is acceptable in pane mode; if close() misbehaves under it, a mode flag in reader.js is the fallback.
- The map's own resize observer handles every width change; only re-expanding from display none needs an explicit fit, done the way the phone's Map button already does it.

## Out of scope
- A resizable gutter between the story and the map column.
- Any change to the phone layout, the map's drawing, or the reader's content and its 20,000 character cap.
- Persisting layout choices anywhere but the browser.

## Bail conditions
- If Cytoscape cannot recover a sane layout after being hidden and shown (a stage laid out at 0 by 0 that an explicit fit does not repair), the map rail becomes a minimise that keeps a 1px stage instead of display none, and the task returns to its brief to write that down.
- If the reader's drawer height logic fights the CSS override so that closing or reopening the reader leaves a wrong height, reader.js gets a pane mode flag and the plan's Files to touch grows by one.
