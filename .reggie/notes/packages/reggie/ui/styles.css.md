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

## decision · 2026-09-18 · Claude via jacobpress · high
The idea trigger's label shows from 1500 px, not 1440. The earlier note's two pixels to spare held only for a seven-character repo name; with forge-reggie in workspace mode the repo switcher widens too, and at 1440 the title keeps 106 of 126 px with no trigger, 62 beside the icon and 29 beside the label. A plain minimum width on the desktop title was tried and rejected: at the title's font twelve characters is 151 px, which crushed every earlier crumb to a letter. That earlier note's fallback is now the rule.
sources: idea-from-every-page

## gotcha · 2026-09-23 · Codex via jacobpress · high
Phone story columns must clear the desktop minimum width so entity pages never create page-level horizontal overflow.
sources: code-entity-pages

## how · 2026-09-23 · Codex via jacobpress · medium
Flow step details and role-grouped cleanup sections use compact cards and wrapping layouts that remain phone-safe.

