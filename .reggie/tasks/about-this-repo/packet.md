---
slug: about-this-repo
title: About this repo is the blurb, written by a person
risk: low
author: jacobpress
date: 2026-09-14
branch: task/about-this-repo
base: repo-manager
verdict: pending
decided_by:
decided_at:
---
# Completion: About this repo is the blurb, written by a person

Read this top to bottom to decide whether the work is done. Every claim should point at evidence.

## Acceptance criteria
- [x] The repo story's subtitle is null and its `what` section has the heading "About this repo".
  evidence: .reggie/tasks/about-this-repo/evidence/tests.txt
- [x] With a `_repo` note holding a `why` and a `how` entry, the `what` section holds one `fact` paragraph whose text is the `why` entry, whose source names `_repo`, and whose only chip is Branch; the `how` entry appears as a `note` paragraph in the `run` section and nowhere else.
  evidence: .reggie/tasks/about-this-repo/evidence/tests.txt
- [x] With a `_repo` note holding no `why` entry and a package description, the `what` section is empty with the description as its text and the Add a note action; with no description it uses the spec's empty text.
  evidence: .reggie/tasks/about-this-repo/evidence/tests.txt
- [x] The served repo overview shows no grey subtitle above the first heading, the first heading reads "About this repo", and the paragraph under it is the new note text as prose with a Branch chip and no card frame.
  evidence: .reggie/tasks/about-this-repo/evidence/overview-check.txt (and overview.png)
- [x] The narration script for the repo opens with "This is Reggie, on reggie, on repo reggie" followed by the About this repo text, and never says "Tauri".
  evidence: .reggie/tasks/about-this-repo/evidence/overview-check.txt
- [x] Neither package.json description nor the `_repo` note mentions Tauri, src or src-tauri.
  evidence: .reggie/tasks/about-this-repo/evidence/overview-check.txt
- [x] docs/ui-spec.md §2 names the section "About this repo" and describes the prose rendering and the fallback.
  evidence: .reggie/tasks/about-this-repo/evidence/overview-check.txt
- [x] The test suite and typecheck pass.
  evidence: .reggie/tasks/about-this-repo/evidence/tests.txt

## Evidence
- .reggie/tasks/about-this-repo/evidence/overview-check.txt
- .reggie/tasks/about-this-repo/evidence/overview.png
- .reggie/tasks/about-this-repo/evidence/tests.txt

## Changes
13 files changed against repo-manager:

```
.reggie/notes/_repo.md                             |  10 +++--
 .reggie/tasks/about-this-repo/claim.md             |   9 +++++
 .../about-this-repo/evidence/overview-check.txt    |  27 ++++++++++++++
 .../tasks/about-this-repo/evidence/overview.png    | Bin 0 -> 196601 bytes
 .reggie/tasks/about-this-repo/evidence/tests.txt   |  12 ++++++
 docs/ui-plan.md                                    |   2 +-
 package.json                                       |   2 +-
 packages/reggie/docs/ui-spec.md                    |   2 +-
 packages/reggie/package.json                       |   2 +-
 packages/reggie/src/story.test.ts                  |  41 ++++++++++++++++++++-
 packages/reggie/src/story.ts                       |  30 ++++++++++-----
 packages/reggie/test/fixtures.ts                   |   7 ++++
 packages/reggie/ui/story.js                        |   2 +-
 13 files changed, 126 insertions(+), 20 deletions(-)
```

## Reviews
- None borrowed. The change is a story builder, a heading string, a note file and two manifest strings; the full suite (518 passed, 1 skipped) and typecheck are the gate, and the rendered page was checked by eye in the screenshot.

## Deviations from plan
- The page was rendered with headless Google Chrome rather than the browser pane, because both in-app browsers were unavailable in the session; the DOM was read from the story API instead of read_page. The screenshot carries the visual claim.
- Criterion 6 says "src"; the check greps for the deleted app (tauri, "src and src-tauri") and not the word src on its own, since the how note's sources line legitimately names packages/reggie/src/cli.ts.
- The shared test fixture gained a `why` entry on its `_repo` note so the fixture repo has a blurb; no existing assertion depended on the note having one entry.

## Discovered issues
- The generated "Repo facts" line in CLAUDE.md still carries the old package description until `reggie docs` next runs; not captured, it regenerates.
- A test run modifies packages/reggie/.claude/stats.json in the working tree, which nearly rode into the feature commit; captured as `stats-json-changes-under-test`.

## Open risks
- A repo whose `_repo` note has several `why` entries shows them as consecutive paragraphs with the Branch chip on the first only; if that reads oddly the chip moves to the heading in a follow-up.
- A gotcha or verify note on `_repo` now lands under "How to run it"; a reader looking for it under About this repo will not find it there. The spec row says so.
