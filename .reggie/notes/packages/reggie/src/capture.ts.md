---
entity: packages/reggie/src/capture.ts
kind: file
---

## how · 2026-09-13 · Claude via jacobpress · medium
addIntakeDetail appends detail lines under an existing intake item, after the detail already there, stamping the last line with person, source and date. A slug with no intake line gets one so the detail has a home. POST /api/intake and the answer form on the board and the task page use it.
sources: packages/reggie/src/capture.ts:60

## gotcha · 2026-09-15 · Claude via jacobpress · medium
removeFromIntake matches every bullet shape parseIntake accepts — dash, star, plus, checkbox, up to three spaces of indent — and not just the dash form it started with. A shape the parser counts as an item but the remover does not would outlive its own brief and sit in the queue for work the board already reports as shaped. The slug is followed by a colon in the pattern, which is what keeps foo from taking foo-2.

## gotcha · 2026-09-15 · Claude via jacobpress · medium
removeFromIntake does not match lines with a pattern of its own: it asks parseIntake which lines carry the slug and removes those line numbers and the detail under each. The parser accepts far more than '- slug:' — a bullet with no prefix at all takes its slug from the text, and a raw prefix like Login_Retry: is slugified to login-retry — so a second pattern here drifts from it silently, and a line the parser counts but the remover misses outlives its own brief with no verb able to sweep it. Keep the two on one parser.

## how · 2026-09-18 · Claude via jacobpress · high
resolveCaptureOrigin is the only place a page path is accepted, and every door (the capture route, both launch routes, reggie capture --path, reggie launch --path, the MCP tool's path) calls it before anything is written or built. A path is an entity of the repo when it is in the same git ls-files listing the code map is built from: an exact entry is a file (or a tracked symlink whose real path stays under the repo's real path), a prefix of one followed by a slash is a folder. That listing is what keeps .git, ignored files, globs, pathspec magic and a deleted file out before any of them could reach git log. Backticks, square brackets and pipes are refused rather than escaped because the board's inline renderer and the story's link markup disagree on precedence, so no one escaping serves both. Every refusal is a sentence of Reggie's own that names no absolute path, because the server answers it as a 400 body.
sources: idea-from-every-page

## how · 2026-09-18 · Claude via jacobpress · high
capture() writes an origin as the last detail line under the item, after any detail the person gave, through originLine: Captured from the file, the folder, a symbol in the file, or the task, with the path printed exactly as the resolver tidied it. It is a plain detail line on purpose: parseIntake reads it, removeFromIntake removes it, triage's scaffold copies it into the brief's Problem, and the board card and the task page render it, with no change to any of them. The source stamp stays web, cli or mcp: it sits between commas in the parser's meta and a path can hold a comma.
sources: idea-from-every-page

