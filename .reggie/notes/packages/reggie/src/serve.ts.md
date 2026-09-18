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

## gotcha · 2026-09-15 · Claude via jacobpress · high
POST /api/launch claims a build with deps: defer. Linking is instant and still happens, but an install is never run inside the request: this server answers one request at a time, so a cold npm ci would hold every other request for minutes. The deferred commands travel to the session in the build prompt.
sources: packages/reggie/src/serve.ts:2260

## gotcha · 2026-09-15 · Claude via jacobpress · medium
POST /api/intake answers 409 for a task that has a brief. addIntakeDetail writes a fresh line for a slug that has none, so an answer posted after triage would rebuild the very line triage removed and bring the card's age back with it. The task page hides the form in that case, so the refusal is not reached by an ordinary click. POST /api/triage reports takenFromIntake so the client knows which cards' lines really went.

## how · 2026-09-17 · Claude via jacobpress · high
Two read routes return what a task changed. The list route answers 200 for any known task and says available false with a sentence of Reggie's own when there is no range to read; the file route answers 404 carrying the same sentence. The file route checks its path twice: a path that could not be a repo path is 400, and a well formed path that is not a member of the task's own change list is 404 and never reaches git, which is what an output flag or exclude magic gets. Membership is tried on the name exactly as asked and then as tidied, so a committed name with a leading space still opens. The range is resolved on every request because a branch tip moves without this checkout's HEAD moving; the list between two commit ids is kept per slug while the ids stay the same. The file answer adds mapped, which is exactly the condition under which the story, impact and explain routes answer that path 404, and editorUrl, which follows the text on screen.
sources: packages/reggie/src/serve.ts, branch-diff-in-reader

## gotcha · 2026-09-17 · Claude via jacobpress · high
Both change routes ask for the integration branch's name before anything else and stop when it begins with a dash, answering unavailable without echoing the name and without building the task list. The order matters: building the task list hands that name to older helpers that put it in front of git bare, so a guard placed after the task lookup would still have let these routes reach them. The rest of the server is still exposed through the task route and the decide route; that is captured as its own high ranked item and is not something these routes can fix. The routes no longer build the history index at all, and they keep one bounded cache of built rows per repo so that paging slices.
sources: packages/reggie/src/serve.ts, branch-diff-in-reader

## how · 2026-09-18 · Claude via jacobpress · high
POST /api/capture reads path, symbol and task through originFields, which keeps every string value even when empty so that an empty path is refused by the resolver with a sentence rather than dropped in silence; the resolver runs before the file is touched and the detail line is built from its output, never from the body. The task list, not knownSlugs, is what a task origin is checked against, because a task page can show a backlog item that knownSlugs does not know. Both launch routes resolve every path through launchPaths before any pack is written, session minted or launch recorded, and parseLaunch bounds the list at eight before the resolver runs git ls-files per entry. The capture route clears the repo's caches before answering, which is what lets a launch that follows at once find the slug.
sources: idea-from-every-page

