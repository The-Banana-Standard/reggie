---
slug: semantic-code-index
title: Build the semantic code index
risk: medium
deciders: [jacobpress]
author: jacobpress
created: 2026-09-22
---
# Build the semantic code index

## Problem
The current regex-first symbol and flow scanners cannot accurately connect callers, positional arguments, returns, declared types, routes, data concepts, or role-specific reachability across JS, JSX, TS, and TSX.

## Approach
Add one repository-wide semantic index built from the TypeScript compiler API with `allowJs` and JSX enabled. Feed it every tracked first-party JavaScript or TypeScript file regardless of production, test, script, migration, or generated role. The index owns stable `sym:<path>::<qualified-name>` identities and immutable records for declarations, source spans, explicit type declarations, call sites, actual argument expressions, all return variants, runtime validation facts, routes, client requests, unresolved/dynamic findings, and recursively nested value shapes.

Resolve direct calls with the compiler checker, including imported aliases and class members. Keep dynamic dispatch, callbacks that cannot be proven, external-library calls, and unresolved internal names as findings rather than edges. Treat a type as present only when the source contains a TypeScript annotation, JSDoc type, or referenced declared type; compiler-inferred types never appear as declared facts. Runtime checks remain separate `ValidationRule` records.

Build data concepts only from proof-bearing links: direct assignments, destructuring, resolved call argument-to-parameter bindings, and resolved return-to-assignment bindings. Build reachability separately from reference counts, using roots appropriate to production entry points, tests, scripts, migrations, and generated files. Both outputs state their limitations and never label a result safe to delete.

Adapt the existing symbol and flow facades to the semantic records. Rust keeps the current scanner. Flow steps gain structured arguments, request/service payloads, and multiple return variants while retaining the old `input`/`output` payload fields for downstream compatibility. Rejected: layering more regular expressions onto the existing scanners, because that cannot provide identity-based alias resolution, ownership of nested methods, or a defensible distinction between declared and inferred types.

## Files to touch
- packages/reggie/package.json (MOD)
- packages/reggie/package-lock.json (MOD)
- packages/reggie/src/symbols.ts (MOD)
- packages/reggie/src/flows.ts (MOD)
- packages/reggie/src/roles.ts (MOD)
- packages/reggie/src/graph.ts (MOD)
- packages/reggie/src/serve.ts (MOD)
- packages/reggie/src/story.ts (MOD)
- packages/reggie/src/symbols.test.ts (MOD)
- packages/reggie/src/flows.test.ts (MOD)
- packages/reggie/src/semantic-index.ts (NEW)
- packages/reggie/src/semantic-index.test.ts (NEW)
- packages/reggie/src/reachability.ts (NEW)
- packages/reggie/src/reachability.test.ts (NEW)
- packages/reggie/src/data-concepts.ts (NEW)
- packages/reggie/src/data-concepts.test.ts (NEW)
- packages/reggie/src/roles.test.ts (MOD)
- packages/reggie/src/graph.test.ts (MOD)
- packages/reggie/ui/dev/flows-probe.ts (MOD)
- packages/reggie/docs/services-and-flows-spec.md (MOD)
- AGENTS.md (MOD)
- CLAUDE.md (MOD)

## Acceptance criteria
- [ ] One compiler-backed index catalogs tracked first-party JS, JSX, TS, TSX, MJS, CJS, MTS, and CTS files in every code role, while ignored dependencies/build output stay excluded and tracked generated code stays visible.
- [ ] `SymbolRecord` covers functions, classes, constructors, methods, arrow functions, and relevant declared types with complete declaration/documentation spans, qualified names, and one `sym:<path>::<qualified-name>` ID form used by symbols, flows, routes, stories, and tests.
- [ ] `CallSite` resolves same-file, cross-file, imported-alias, constructor, and method calls exactly where the compiler can prove the target; dynamic dispatch, unresolved callbacks, external calls, and unresolved internal calls are reported as separate findings.
- [ ] `ArgumentValue` preserves positional order and the exact source expression, distinguishes positional values from object/request/service payloads, and represents nested object and array shapes without a field-count cap.
- [ ] `ReturnVariant` records every direct return and HTTP response variant without swallowing returns from nested functions; declared return types appear only when written in TypeScript, JSDoc, or a referenced declared type.
- [ ] Explicit parameter, field, and return types remain separate from `ValidationRule` runtime checks, and undeclared types are represented as absent rather than populated from checker inference.
- [ ] `RouteRecord` covers Cloudflare, Next, Express/Hono-style handlers and static client `fetch` calls, connecting route, handler, middleware/client symbols, request shape, and response variants where the source proves them.
- [ ] `DataConcept` groups only occurrences connected through direct assignments, destructuring, resolved argument-to-parameter bindings, or resolved return-to-assignment bindings, retaining occurrence-level types, validations, transformations, routes, and symbols.
- [ ] `ReachabilityResult` reports role-specific roots and not-reachable files/symbols for production, tests, scripts, migrations, and generated code, and reports no-reference findings separately with analyzer limitations and no deletion claim.
- [ ] Existing flow consumers remain usable through legacy payload fields while richer steps expose actual arguments and multiple returns; the `resolveSessionId(payload.session_id)` fixture reports that expression and both return variants, with no declared return type.
- [ ] Focused fixtures cover JS/TS/JSX/TSX declarations, methods, aliases, positional/object arguments, complete nested shapes, declared versus inferred types, runtime validation, conditional/HTTP returns, client route calls, dynamic unresolved calls, concept propagation, and role-aware reachability.
- [ ] From `packages/reggie`, focused tests, the full suite, typecheck, build, generated documentation checks, code review, security review, and simplification review all pass.

## Verification strategy
- Criterion 1: run the mixed-extension, ignored-output, and role inventory cases in `semantic-index.test.ts`; save focused output in `evidence/semantic-tests.txt`.
- Criterion 2: run declaration/span tests and search production code and fixtures for legacy `sym:...#...` identifiers; save both in `evidence/symbol-ids.txt`.
- Criterion 3: run the same-file, cross-file alias, constructor, method, dynamic, callback, external, and unresolved call cases; save the serialized fixture in `evidence/semantic-fixture.json` and its focused output in `evidence/semantic-tests.txt`.
- Criterion 4: run positional, object, spread, array, and six-field nested value cases; review the serialized record in `evidence/model-review.txt`.
- Criterion 5: run conditional, nested-callback, declared return, `Response.json`, and `new Response` cases; review every variant in `evidence/model-review.txt`.
- Criterion 6: run declared-versus-inferred parameter/field/return cases and runtime validation cases; save the relevant records in `evidence/semantic-fixture.json`.
- Criterion 7: run Cloudflare, Next, Express/Hono, middleware, and static `fetch` route cases; save route records in `evidence/semantic-fixture.json`.
- Criterion 8: run assignment, destructuring, argument binding, return binding, and false-same-name concept cases; save focused output in `evidence/semantic-tests.txt`.
- Criterion 9: run each role's root/reachability case plus no-reference and limitation cases; save focused output in `evidence/semantic-tests.txt`.
- Criterion 10: run the `resolveSessionId` fixture and save the structured step in `evidence/resolve-session.json`.
- Criterion 11: temporarily break one declaration, call target, nested field, declared-type guard, concept link, and role root expectation; record the intended focused failures and restoration in `evidence/mutation-probes.txt`.
- Criterion 12: save full-suite, typecheck, build, docs-check, audit, diff-check, and review results in `evidence/full-verification.txt` and `evidence/reviews.txt`.

## Assumptions
- TypeScript becomes a runtime dependency because the installed CLI must build the semantic index; relying on a development-only dependency would make published use fail.
- Compiler inference may be used internally to resolve identities, but it is never presented as an explicit source type.
- A tracked generated file is cataloged and evaluated under the generated role; ignored generated output and dependencies are not read.
- Role reachability is evidence, not a deletion recommendation. A file can be both unreachable from known roots and referenced by an unsupported/dynamic path.
- The existing graph remains the source of tracked first-party files and import edges during this task; semantic imports can enrich it without making graph construction depend on the new entity pages.

## Out of scope
- Symbol, route, concept, cleanup, and knowledge pages or their browser editing interactions.
- AI-authored knowledge, note history/retirement, generation jobs, commits, or agent selection.
- Removing the temporary `Payload` fields or redesigning Data Flow cards and graph labels.
- Semantic support for Rust or other languages beyond retaining their current inventory/extraction behavior.

## Bail conditions
- If the compiler cannot resolve ordinary relative imports from an in-memory or temporary repository without loading arbitrary dependency code, stop and re-plan the program/host boundary rather than silently falling back to regular expressions.
- If stable qualified names require source-position IDs for ordinary declarations, stop and define a durable rename/overload identity policy before producing committed knowledge paths.
- If preserving legacy flow fields requires fabricating parameter-name payloads in the richer records, keep those fabrications isolated to the legacy adapter and stop before exposing them through any new record.
