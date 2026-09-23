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

## gotcha · 2026-09-15 · Claude via jacobpress · medium
The Spotlight's Add a note action calls focusNoteForm(), which takes the first .form--note in the document rather than one belonging to the node the Spotlight describes, so on a repo or area page it focuses that page's form and not the tapped node's. Its fallback toast has to name every scope whose page carries a form; it named only files and areas while areas in any set-up repo had none, and repo, area and file pages all carry one now. The reader drawer's own fallback beside it is scope-neutral and needs no such upkeep.
sources: packages/reggie/ui/app.js, note-form-on-repo-and-area

## how · 2026-09-17 · Claude via jacobpress · high
A file route may carry a diff query naming a task, read by diffOf on the file level only. With it set the page asks for the change first, because that answer says whether the graph ever read the path. When it did not, the story, impact and explain requests are skipped rather than made and swallowed, since each would answer 404 and log a failure: the story column gets one section in plain words, no toast is raised, and the canvas is cleared with an empty view that brings its own sentence. The reader is then opened without a click, on a phone too, where the overlay is raised explicitly because a reader left open behind a closed overlay never flips its hidden flag. A symbol link clicked in diff mode is left to navigate, and openReader always passes the route's mode, so the Read button and the code pane toggle follow it.
sources: packages/reggie/ui/app.js, branch-diff-in-reader

## how · 2026-09-17 · Claude via jacobpress · medium
On a file route with a diff query the change is asked for past the fetch cache on every render and the answer is passed to the reader as its file. That costs one server round trip per render of such a page and buys the guarantee that the reader and the task page never disagree about a branch that has moved. The reader's fetch dep forwards a fresh option to the same cached api function for the same reason.
sources: packages/reggie/ui/app.js, branch-diff-in-reader

## how · 2026-09-18 · Claude via jacobpress · medium
wireHeader mounts the idea trigger, which follows the route event on its own. A workspace tile is a div holding the link that wraps every fact and the idea button in its corner, because a button inside an anchor is invalid; the hover cross-highlight and the refs stay on the wrapper, and the whole-tile click is the link's click.
sources: idea-from-every-page

## gotcha · 2026-09-22 · Codex via jacobpress · medium
Flow symbol IDs split at the double-colon separator; the former hash separator is no longer accepted.

