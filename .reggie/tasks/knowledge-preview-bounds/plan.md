---
slug: knowledge-preview-bounds
title: Bound high-cardinality knowledge previews
risk: high
deciders: []
author: jacobpress
created: 2026-09-23
---
# Bound high-cardinality knowledge previews

## Problem
Knowledge preview fails on real repositories when a concept or high-connectivity symbol repeats more evidence than the per-chunk safety budget allows.

## Approach
Project compiler records into a compact, source-backed knowledge prompt: keep every entity and every required parameter, field, return, and call-site description, but send totals plus deterministic representative evidence instead of repeating hundreds of complete semantic records. Measure and generate from the prompt projection rather than from job-only metadata, and prove the behavior with synthetic high-cardinality concepts and symbols plus the real `personal_website` preview.

Rejected: increasing or removing the byte ceiling. That would hide the duplication, make agent latency and cost unpredictable, and weaken the existing safety boundary without improving the knowledge model.

## Files to touch
- packages/reggie/src/knowledge-jobs.ts (MOD)
- packages/reggie/src/knowledge-jobs.test.ts (MOD)
- .reggie/notes/packages/reggie/src/knowledge-jobs.ts.md (MOD)
- .reggie/notes/packages/reggie/src/knowledge-jobs.test.ts.md (MOD)
- .reggie/journal/2026-09-23/jacobpress-session.md (MOD)

## Acceptance criteria
- [ ] Knowledge preview remains within the existing per-chunk byte ceiling for a concept with hundreds of occurrences and a symbol with hundreds of call sites.
- [ ] Every high-cardinality occurrence and call-site ID remains present in the exact generated-output contract even when only representative evidence is included in the prompt facts.
- [ ] The real `personal_website` Codex preview succeeds and reports the full new/stale scope without writing notes, jobs, or commits.
- [ ] Focused tests, the full suite, typecheck, build, documentation checks, reviews, and hosted Linux/macOS CI pass before landing.

## Verification strategy
- Criteria 1 and 2: add a high-cardinality inventory/preview test and save focused output in `evidence/tests.txt`.
- Criterion 3: run `knowledge preview --agent codex` against `personal_website`, compare Git status and revision before/after, and save the result in `evidence/real-repo.txt`.
- Criterion 4: save full local verification in `evidence/full-verification.txt`, review results in `evidence/reviews.txt`, and hosted checks in the completion packet.

## Assumptions
- Representative evidence is prompt context only. The semantic index, entity pages, fingerprints, generated-output schema, and committed knowledge retain their complete source-backed identities.
- A deterministic spread across the full ordered evidence list is more useful than taking only the first records because it represents different files and regions while remaining reproducible.
- The existing 180,000-byte chunk ceiling and 220,000-byte adapter prompt ceiling remain unchanged.

## Out of scope
- Changing semantic grouping, concept identities, source analysis, or target repository code.
- Generating or committing `personal_website` knowledge before the required user confirmation.
- Splitting one knowledge entity across multiple agent responses.

## Bail conditions
- If the exact expected IDs alone exceed the chunk ceiling, stop and redesign resumable per-entity fragments rather than dropping descriptions or raising the limit.
- If representative evidence changes fingerprints or removes records from the static index/UI, stop because compaction must remain isolated to agent prompt context.
