---
slug: web-ui-test-foundation
title: Give the web UI a real DOM test lane
area: packages/reggie
size: medium
risk: medium
priority: P1
author: jacobpress
created: 2026-09-22
---
# Give the web UI a real DOM test lane

## Problem
Reggie's browser client is the main way a person reads the repository, but the automated suite never loads it. The router, story renderer, source reader, and Cytoscape model can therefore drift or fail at import time while every CI check remains green, and CI does not run on direct pushes to the integration branch where this program lands.

## Why now
Every later task in the code-intelligence program changes these modules and their shared contracts. A DOM lane has to land first so those changes are covered by the same gate as the server and CLI instead of relying only on end-of-program browser checks.

## Suspected area
- `packages/reggie/vitest.config.ts` to separate the existing Node suite from a browser-DOM project.
- `packages/reggie/ui/` to hold fixtures and tests that import the real production modules.
- `packages/reggie/package.json` and its lockfile for the DOM environment dependency and test scripts.
- `.github/workflows/ci.yml` so pushes to both maintained branches execute the complete suite.

## Open questions
- None. The program fixes the test environment as Vitest with a DOM implementation and keeps real-browser checks for Cytoscape layout and responsive behavior.

## Not this
- This task does not redesign a page, change the API contract, or make semantic-analysis changes. It freezes today's relevant browser behavior before those contracts move.
- It does not pretend a simulated DOM can validate Cytoscape geometry or responsive layout; those remain explicit manual browser acceptance checks.
