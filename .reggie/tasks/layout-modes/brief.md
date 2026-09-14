---
slug: layout-modes
title: Read a page as story, map or code, alone or together
area: packages/reggie/ui
size: medium
risk: low
priority: P2
author: jacobpress
created: 2026-09-14
---
# Read a page as story, map or code, alone or together

## Problem
A page has up to three things to look at: the story column, the map, and the source reader, and their arrangement is fixed. The story takes 44% on the left, the map the rest, and the reader is a drawer under the map. Dense mode is the only lever, and it only shrinks the story. Jacob wants to read a page as text alone, map alone or code alone, or any two side by side, with the open panes filling the width, and to fold story sections from their headings so the column reads like an outline until he opens what he needs. Today he cannot see the whole map without the story beside it, cannot read code at full height, and cannot hide a section he has finished with.

## Why now
The story column grew a lot this week (intake stories, brief stories, Listen, the answer form), and the phone layout already had to invent a map-only mode. The desktop is the place these pages are read most, and the fixed split is now the thing in the way of reading them.

## Suspected area
- packages/reggie/ui/styles.css because the shell grid, the map column and the Dense rules live there
- packages/reggie/ui/app.js because section() is the one builder every level uses, and the header, storage and keyboard wiring are there
- packages/reggie/ui/index.html because the header controls and the shell containers are static there
- packages/reggie/ui/story.js because focusNoteForm must open a collapsed section before focusing it
- packages/reggie/ui/DOM-CONTRACT.md because it names every shell id and class the modules rely on

## Open questions
- none: the three-up arrangement (story beside map over code), rails plus header toggles, retiring Dense, and equal shares with the story capped at its measure were all decided with Jacob on 2026-09-14

## Not this
- A touch-first map, a resizable gutter between panes, or a fourth pane; the reader keeps its drag handle only as a drawer under the map.
- Any change to what the story, the map or the reader say or show; this is arrangement only.
- The phone layout, which keeps its Map button and overlay unchanged.
