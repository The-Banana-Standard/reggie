---
slug: about-this-repo
title: About this repo is the blurb, written by a person
risk: low
deciders: [jacobpress]
author: jacobpress
created: 2026-09-14
---
# About this repo is the blurb, written by a person

## Problem
The repo overview opens with a subtitle that is package.json's description plus the branch, then a "What this is" section that repeats the description and shows the `_repo` note as a card whose only entry is a `how` note about the deleted Tauri app. Jacob wants the section called "About this repo", the subtitle removed, and the section to read as the repo's own account of itself, written by a person: Reggie helps a repo owner keep understanding a codebase that AI engineering builds faster than anyone can read, see how the pieces fit, review what changed, and plan and track the tasks that follow.

## Approach
The section stays id `what` so remembered folds and paragraph ids keep working, and its heading becomes "About this repo" in story.ts and in the UI's heading table. Its body is the `why` entries of the `_repo` note rendered as prose: whatSection emits them as `fact` paragraphs that keep the note's `source` (so the click-through to the note file and the "possibly out of date" chip still work) and carry no type, confidence, author or date chips; the first one carries a Branch chip, which is where the branch moves now that the subtitle is gone. Every other `_repo` entry (how, gotcha, verify, data-source, decision) is a card as today, but appended to "How to run it", because that is what a how note on the repo is about. The package description is no longer a paragraph; it becomes the section's empty text when there is no `why` entry, so the manifest string is only ever a stand-in under the Add a note prompt, and the spec's empty text is used when there is no description either. repoStory returns subtitle null. The narration intro already omits an empty subtitle, so the script opens with the section. The `_repo` note is rewritten with two entries: a `why` entry with the agreed blurb and a `how` entry with the build and run sentences, neither mentioning the Tauri app; both package.json descriptions get the one-line rewrite. Rejected: keeping a "Branch x." subtitle, because it is still a grey line above the blurb; rejected: reading README or CLAUDE.md into the section, because the point is that a person wrote it.

## Files to touch
- packages/reggie/src/story.ts (MOD)
- packages/reggie/src/story.test.ts (MOD)
- packages/reggie/ui/story.js (MOD)
- packages/reggie/docs/ui-spec.md (MOD)
- .reggie/notes/_repo.md (MOD)
- packages/reggie/package.json (MOD)
- package.json (MOD)
- docs/ui-plan.md (MOD)

## Acceptance criteria
- [ ] The repo story's subtitle is null and its `what` section has the heading "About this repo".
- [ ] With a `_repo` note holding a `why` and a `how` entry, the `what` section holds one `fact` paragraph whose text is the `why` entry, whose source names `_repo`, and whose only chip is Branch; the `how` entry appears as a `note` paragraph in the `run` section and nowhere else.
- [ ] With a `_repo` note holding no `why` entry and a package description, the `what` section is empty with the description as its text and the Add a note action; with no description it uses the spec's empty text.
- [ ] The served repo overview shows no grey subtitle above the first heading, the first heading reads "About this repo", and the paragraph under it is the new note text as prose with a Branch chip and no card frame.
- [ ] The narration script for the repo opens with "This is Reggie, on reggie, on repo reggie" followed by the About this repo text, and never says "Tauri".
- [ ] Neither package.json description nor the `_repo` note mentions Tauri, src or src-tauri.
- [ ] docs/ui-spec.md §2 names the section "About this repo" and describes the prose rendering and the fallback.
- [ ] The test suite and typecheck pass.

## Verification strategy
- Criterion 1: a unit test in story.test.ts asserting subtitle null and the heading; output in evidence/tests.txt.
- Criterion 2: a unit test with a fixture `_repo` note holding a why and a how entry, asserting the what and run paragraphs; in evidence/tests.txt.
- Criterion 3: a unit test with a how-only note and a package description, and the existing bare-repo test; in evidence/tests.txt.
- Criterion 4: serve the task worktree on a fresh port, open the repo overview in the browser pane at 1440px, read the story column's first child and the first section's heading and paragraph with read_page and javascript_tool; in evidence/overview-check.txt with evidence/overview.png.
- Criterion 5: GET /api/narration?scope=repo&id=reggie on the task server and grep the script for the opening and for Tauri; in evidence/overview-check.txt.
- Criterion 6: grep the two package.json files and the note; in evidence/overview-check.txt.
- Criterion 7: read the spec row; in evidence/overview-check.txt.
- Criterion 8: npm test and npm run typecheck; in evidence/tests.txt.

## Assumptions
- A `why` entry on `_repo` is the blurb by definition; a repo with several `why` entries shows them in order as separate paragraphs.
- Moving how notes to "How to run it" is right for a repo note; if a gotcha reads oddly there, the split becomes why versus how only and the rest stay in About this repo as cards.
- The Branch chip on the first paragraph is enough; the branch is also in the header crumb when the workspace lists it.

## Out of scope
- Rendering any note other than `_repo`'s `why` entries as prose.
- The ui-implementation-plan's scenario text, which is a historical plan and keeps its Tauri sentence.
- Any change to narrate.ts, the map or the reader.

## Bail conditions
- If the UI's dedupe or spotlight logic depends on a non-null repo subtitle in a way that breaks the file or symbol levels, the subtitle stays as the empty string and the plan grows a line in story.js.
- If a `fact` paragraph with a `source` confuses the map's ref wiring (a note node highlighted as a fact), the paragraphs keep kind `note` and story.js gains a `prose` flag on the source instead.
