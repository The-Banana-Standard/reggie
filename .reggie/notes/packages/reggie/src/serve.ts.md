---
entity: packages/reggie/src/serve.ts
kind: file
---

## how · 2026-09-13 · Claude via jacobpress · medium
A non-loopback bind mints or reads a key at .reggie/.cache/serve-key and requires it on every /api request over a non-loopback socket, as the X-Reggie-Key header or ?key=. Loopback sockets never need it. A keyed POST may carry an Origin equal to its own Host, because the key is the rebinding defence there. The static shell is served without the key so the page can ask for it. The feed builds enclosure URLs from the request Host and appends the key.
sources: packages/reggie/src/serve.ts:590

