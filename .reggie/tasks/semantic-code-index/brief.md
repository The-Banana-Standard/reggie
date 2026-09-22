---
slug: semantic-code-index
title: Build the semantic code index
area: packages/reggie/src
size: large
risk: high
priority: P1
author: jacobpress
created: 2026-09-22
---
# Build the semantic code index

## Problem
Replace regex-first JavaScript and TypeScript symbol, call, data-shape, route, concept, and reachability analysis with a compiler-backed semantic index while keeping the legacy flow contract temporarily. (jacobpress, cli, 2026-09-22)
Captured from the folder `packages/reggie/src`

## Why now
Every entity page, knowledge record, and Data Flow redesign in the approved program depends on trustworthy declarations, calls, values, returns, routes, and cleanup evidence. Building those surfaces on the current regular-expression model would preserve the false payloads and missing callers that prompted the program.

## Suspected area
- `packages/reggie/src/semantic-index.ts` for the compiler-backed repository model and its public records.
- `packages/reggie/src/symbols.ts` to use compiler declarations for JavaScript and TypeScript while retaining the Rust extractor.
- `packages/reggie/src/flows.ts` to expose structured arguments and return variants while preserving its legacy payload fields during the migration.
- `packages/reggie/src/data-concepts.ts` for evidence-backed assignment, destructuring, argument-to-parameter, and return-to-assignment links.
- `packages/reggie/src/reachability.ts` for role-specific roots and separate no-reference evidence.
- `packages/reggie/src/roles.ts` and `packages/reggie/src/graph.ts` for code-role and entry/import facts consumed by reachability.
- Focused fixtures and tests covering JavaScript, JSX, TypeScript, TSX, route clients, dynamic calls, validations, concepts, and role-aware reachability.

## Open questions
- None. The approved program fixes the first language family, ID scheme, evidence boundaries, and backward-compatibility period.

## Not this
- This task does not build the symbol, route, or concept pages; it establishes the records those pages will read.
- It does not generate or edit explanatory prose, modify target repositories to add types, or infer undeclared types from runtime values.
- It does not remove legacy flow payload fields yet; that waits until every UI and CLI consumer has moved to the richer model.
