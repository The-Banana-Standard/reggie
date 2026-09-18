---
entity: packages/reggie/ui/idea.js
kind: file
---

## how · 2026-09-18 · Claude via jacobpress · high
One module owns the idea action: the header trigger, the popover and the capture-then-launch sequence. originFor is the only mapping from a route to what a page posts (the folder for an area, the file for a file, the file half of the id plus the name for a symbol, the task for a task page, nothing for the other repo-level pages, null for the workspace and home, where the trigger hides), and only those three keys ever reach the capture body. The popover posts the capture, toasts the slug, redraws the level, then hands the new slug and the page's path to the board's launcher in discuss mode; the captured text is never part of the launch body. The three outcomes all stay inside the popover: a session that opened here closes it, one that opened on the machine running reggie serve (the page holds a serve key) keeps it open with the link, a sentence saying so and the command, and a launch that failed, threw or ran past six seconds keeps it open with the link, the reason and the command to copy.
sources: idea-from-every-page

## gotcha · 2026-09-18 · Claude via jacobpress · high
The description is fetched before the launch is posted, not at six seconds: the launch holds the single-threaded server for the whole Terminal timeout, so a GET asked at six seconds would queue behind the request it is meant to explain and the still-waiting sentence would arrive with the answer instead of before it. The board avoids this by accident through its tooltip prefetch. Leaving the page closes the popover (its sentence names the page), keyed on the level, repo and id, so the redraw after a capture, which emits the same route, leaves it open with its result. A workspace tile is re-mounted by that redraw, so the opener is found again by the repo the tile button names rather than kept by reference.
sources: idea-from-every-page

## gotcha · 2026-09-18 · Claude via jacobpress · high
Three rules the 2026-09-18 code review added, each from a reproduced bug. Everything in submit after its first await reads a snapshot of the target taken at the top, and an open while a submit is in flight shows the popover without re-targeting it, because the launch that follows the capture must be built for the page the line came from and not the page the reader moved to. While busy, neither a route change nor a second click on the trigger closes it, and the result stays until the next submit clears it, because the toast tells the reader the command is there. And a description that resolves after the launch has answered is dropped through a settled flag, because on the single-threaded server it queues behind the launch in exactly the hang case and would overwrite the reason with a stale waiting sentence. originFor posts the file alone for a symbol name that is not an identifier: the code map names a star re-export with an asterisk and links a real page for it.
sources: idea-from-every-page

