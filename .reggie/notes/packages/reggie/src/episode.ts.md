---
entity: packages/reggie/src/episode.ts
kind: file
---

## how · 2026-09-13 · Claude via jacobpress · medium
Audio episodes are derived, so they live under .reggie/.cache/episodes and are never committed. macOS say writes AIFF and afconvert packs it as m4a; a JSON sidecar carries title, words, seconds and bytes for the feed. renderFeed is a plain RSS 2.0 feed with itunes duration, served at /api/feed.xml over loopback.
sources: packages/reggie/src/episode.ts:1

