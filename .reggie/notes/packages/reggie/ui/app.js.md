---
entity: packages/reggie/ui/app.js
kind: file
---

## how · 2026-09-13 · Claude via jacobpress · medium
The page adopts ?key= from the address once, keeps it in localStorage under reggie:key, strips it from the URL, and sends it as X-Reggie-Key on every api() and post(); withKey() appends it for audio and feed links. A 401 from any API call shows a paste-the-key card once. Below 760px the map column hides behind the header's Map button (setMapOpen), which is hidden on the tasks page where the column holds the board; opening the reader drawer opens the overlay too.
sources: packages/reggie/ui/app.js:404

## how · 2026-09-14 · Claude via jacobpress · medium
Panes and sections. PANES_BY_LEVEL is the one table saying what a level has (story, map, code; map may be the page itself, as the board or the workspace tiles). syncPanes writes data-panes and data-open on main for desktop widths and the header toggles follow; setPaneOpen changes story or map and remembers the set per level; code is the reader, so opening it opens the reader and onReaderVisibility mirrors the reader's hidden attribute back. section() builds every section with a folding heading, from state.collapsed loaded per repo and level. Keys S M C fold panes, [ and ] fold or open every section. Dense was retired on 2026-09-14.
sources: packages/reggie/ui/app.js:865

