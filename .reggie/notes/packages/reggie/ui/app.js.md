---
entity: packages/reggie/ui/app.js
kind: file
---

## how · 2026-09-13 · Claude via jacobpress · medium
The page adopts ?key= from the address once, keeps it in localStorage under reggie:key, strips it from the URL, and sends it as X-Reggie-Key on every api() and post(); withKey() appends it for audio and feed links. A 401 from any API call shows a paste-the-key card once. Below 760px the map column hides behind the header's Map button (setMapOpen), which is hidden on the tasks page where the column holds the board; opening the reader drawer opens the overlay too.
sources: packages/reggie/ui/app.js:404

