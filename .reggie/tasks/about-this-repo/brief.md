---
slug: about-this-repo
title: About this repo is the blurb, written by a person
area: packages/reggie
size: small
risk: low
priority: P2
author: jacobpress
created: 2026-09-14
---
# About this repo is the blurb, written by a person

## Problem
The repo overview opens with a grey subtitle that is the `description` field of package.json plus the branch name, and then a section called "What this is" that shows the same description again followed by every `_repo` note entry as a card with four chips. Nobody wrote the subtitle for a reader; it is a manifest string. The one repo note that exists is a `how` entry from 10 Sep that spends half its words on the Tauri app that was deleted from this branch, so the most-read paragraph on the landing page is a changelog of the pivot rather than what Reggie is for. Jacob wants the section renamed "About this repo", the subtitle gone, and the section's text to be the repo's own account of itself: Reggie helps a repo owner keep understanding a codebase that AI engineering builds faster than anyone can read it, see how the pieces fit, review what changed, and plan and track the tasks that follow.

## Why now
The story column is now the page (layout-modes landed today) and the phone and the podcast both open with this section. Every reader and every listener meets the stale note first. The rewrite is one note and a heading; leaving it makes the demo of Reggie explain the wrong product.

## Suspected area
- packages/reggie/src/story.ts because whatSection builds the section and repoStory builds the subtitle
- packages/reggie/ui/story.js because the fixed heading table and the note card renderer live there
- .reggie/notes/_repo.md because it is the text the section shows
- packages/reggie/package.json and package.json because the description is the fallback text and what npm shows
- packages/reggie/docs/ui-spec.md because §2 names the section and what it prints
- packages/reggie/src/story.test.ts because a test asserts the subtitle carries the branch

## Open questions
- none: the heading "About this repo" and the wording of the note were settled with Jacob on 2026-09-14

## Not this
- Reading README, ARCHITECTURE or CLAUDE.md into the section (ui-plan.md's older idea); the section shows what a person wrote in the repo note, nothing derived.
- Changing how notes on files and folders render; only the `_repo` note's `why` entries become prose, every other note stays a card.
- The narration script's shape; it follows the story, so dropping the subtitle changes what it says without touching narrate.ts.
