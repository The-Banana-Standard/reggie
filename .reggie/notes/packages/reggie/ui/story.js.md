---
entity: packages/reggie/ui/story.js
kind: file
---

## gotcha · 2026-09-15 · Claude via jacobpress · high
HEADINGS is a second, hand-kept copy of the payload's section list, and sectionHeadingsFor reads it to draw the loading skeleton. If a scope gains or loses a section on the server and this table is not changed with it, the page visibly reflows by that many sections as the payload lands. Repo, area and file all end with add-note here because all three now end with it in the payload. The rendering side needs nothing: emptyBlock appends noteForm for any section whose action says form: note, and noteEntityFor derives the target from the story's scope and id rather than from the section, so every form on a page writes to the same entity. Note also that renderSection drops an empty section outright when it carries no empty block at all, so a server-side section with zero paragraphs and no empty.text disappears from the page while a server-only test still sees its id.
sources: packages/reggie/ui/story.js, note-form-on-repo-and-area

