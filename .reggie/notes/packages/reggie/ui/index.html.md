---
entity: packages/reggie/ui/index.html
kind: file
---

## how · 2026-09-13 · Claude via jacobpress · medium
The header's #map-toggle is the phone's way to the map column; app.js shows it only on levels where the map is optional (data-map=map on <main>) and hides it where the column is the page (tasks, workspace). The viewport meta allows safe-area insets.
sources: packages/reggie/ui/index.html:105

## how · 2026-09-14 · Claude via jacobpress · medium
The header's #panes group (Story, Map, Code toggles) replaced the Dense button on 2026-09-14; #map-toggle is the phone's Map button. Inside main, #story-tools holds Collapse all and Expand all, and #rail-story, #rail-map and #rail-code are the static buttons that stand in for a folded pane; styles.css shows them from data-panes and data-open, JS never toggles them.
sources: packages/reggie/ui/index.html:104

## how · 2026-09-18 · Claude via jacobpress · medium
The idea trigger is the first button in the header tools, hidden until idea.js shows it for a level that belongs to one repo; the idea icon (a bulb) joins the symbol set. Everything else about the popover is built by idea.js and appended to body.
sources: idea-from-every-page

