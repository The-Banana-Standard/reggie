---
entity: packages/reggie/ui/styles.css
kind: file
---

## gotcha · 2026-09-13 · Claude via jacobpress · medium
The phone block at the end (max-width 760px) turns the shell into one column and hides .map-col unless .app.is-map-open, when it becomes a fixed overlay under the header. The tasks level is the exception: its .map-col holds the board and stays in flow. Anything added to the header must fit 390px; the lens and Dense are hidden there.
sources: packages/reggie/ui/styles.css:1

## how · 2026-09-14 · Claude via jacobpress · medium
The main element is a flex row: the story is a share floored at --story-min and capped at its measure, the map column a share; the reader stays inside the map column. Above 1100px the pane rules read data-panes and data-open on main: a pane not open is display none and its .pane-rail shows; map and code without the story become a two-column grid inside the map column; code without the map takes the column at full height by overriding the drawer's inline height with !important. Below 1100px the attributes are absent and the stacked rules apply as before.
sources: packages/reggie/ui/styles.css:261

## gotcha · 2026-09-18 · Claude via jacobpress · high
The header is full at 1440px, measured with the idea trigger's label showing: the repo page's title keeps its full width with two pixels to spare in workspace mode, so the label shows from 1440 and the icon alone below it. That margin is thin; if the title suffers on a real repo, moving the label's breakpoint to 1500 is the intended fallback. On a phone the header shows only the parent crumb and the title, because the earlier crumbs never shrink and in workspace mode the title was the only crumb that could, and it shrank to nothing on any file page with or without the trigger; the full trail is on the story's first card. The popover is fixed under the trigger on a desktop and spans the width under the header on a phone, where the inline position idea.js sets is cleared.
sources: idea-from-every-page

