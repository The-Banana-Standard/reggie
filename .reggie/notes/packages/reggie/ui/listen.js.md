---
entity: packages/reggie/ui/listen.js
kind: file
---

## how · 2026-09-13 · Claude via jacobpress · medium
The Listen control on a task page. Read it to me uses the browser's speechSynthesis over the narration script, split at paragraph breaks so long scripts do not stall; Make an episode posts to /api/episode and shows an audio element plus a link to the private feed; Show the script prints the words.
sources: packages/reggie/ui/listen.js:1

## gotcha · 2026-09-13 · Claude via jacobpress · medium
The audio src and the feed link go through withKey(): an audio element and a podcast app cannot send the X-Reggie-Key header, so over the network the key rides in the URL. Strip it and a phone gets 401 on every episode.
sources: packages/reggie/ui/listen.js:112

