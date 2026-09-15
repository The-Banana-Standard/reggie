---
entity: packages/reggie/src/serve.ts
kind: file
---

## how · 2026-09-13 · Claude via jacobpress · medium
A non-loopback bind mints or reads a key at .reggie/.cache/serve-key and requires it on every /api request over a non-loopback socket, as the X-Reggie-Key header or ?key=. Loopback sockets never need it. A keyed POST may carry an Origin equal to its own Host, because the key is the rebinding defence there. The static shell is served without the key so the page can ask for it. The feed builds enclosure URLs from the request Host and appends the key.
sources: packages/reggie/src/serve.ts:590

## how · 2026-09-15 · Claude via jacobpress · high
POST /api/decide approved in solo mode goes through landTask and answers 409 on a refusal or a conflict; needs-work and team mode only write the verdict. The completed view reads commits from taskLanding: the diff comes from the merge alone, the commits from the branch, and the merge is reported separately.
sources: task-attribution-by-merge

