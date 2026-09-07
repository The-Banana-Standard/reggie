---
entity: packages/reggie/ui/
kind: dir
---

## how · 2026-09-07 · Claude via jacobpress · high
The Guidebook web UI: static files served by node:http with no bundler. index.html is the shell, app.js the router and integration layer, map.js the single Cytoscape instance with every level's element builder and lens, story.js the narrative column, reader.js the source drawer, board.js the task board and task page. Vendor libraries load from node_modules through /vendor with a CDN fallback. Sample payloads and standalone harnesses under dev/ let a module be developed without the server.
sources: packages/reggie/ui/DOM-CONTRACT.md

