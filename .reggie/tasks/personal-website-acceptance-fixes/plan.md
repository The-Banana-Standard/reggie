---
slug: personal-website-acceptance-fixes
title: Resolve configured fetch endpoints during real-repo acceptance
risk: high
deciders: []
author: jacobpress
created: 2026-09-23
---
# Resolve configured fetch endpoints during real-repo acceptance

## Problem
The final `personal_website` acceptance run proves `POST /api/chat`, its handler, six request fields, and `resolveSessionId`, but its dedicated route page has no client caller. The production client calls `fetch(chatData.apiEndpoint, ...)`, where `chatData.apiEndpoint` is an imported object property containing the static string `/api/chat`. The semantic index currently recognizes only a literal fetch argument, so a source-known client disappears from the route page.

## Approach
Extend the compiler-backed static-string reader to follow aliases and declarations for immutable string-valued identifiers and object properties, with cycle protection. Use it for fetch URLs while retaining literal route and method behavior. Add a fixture that imports a configuration object exactly like `personal_website`, then rerun the real route projection.

Rejected: special-casing `chatData.apiEndpoint` or re-parsing import text. Both would make a repository-specific promise and discard the TypeScript compiler's resolved declaration graph.

## Files to touch
- packages/reggie/src/semantic-index.ts (MOD)
- packages/reggie/src/semantic-index.test.ts (MOD)
- packages/reggie/src/entity-pages.test.ts (MOD)
- .reggie/notes/packages/reggie/src/semantic-index.ts.md (MOD)
- .reggie/notes/packages/reggie/src/semantic-index.test.ts.md (MOD)
- .reggie/notes/packages/reggie/src/entity-pages.test.ts.md (MOD)
- .reggie/journal/2026-09-23/jacobpress-session.md (MOD)

## Acceptance criteria
- [ ] A fetch URL expressed as an imported immutable object property resolves to its static route string and creates a client call on the matching route.
- [ ] The route entity page connects that client call to its exact caller symbol and retains the inline request-body shape.
- [ ] Literal fetch URLs, unresolved dynamic expressions, alias cycles, typecheck, focused tests, full tests, build, and hosted Linux/macOS CI remain safe and passing.

## Verification strategy
- Criterion 1: semantic-index fixture imports a configuration object and asserts one exact `/api/chat` client; save focused output in `evidence/tests.txt`.
- Criterion 2: entity-page fixture asserts the resolved caller and request fields; save route API output from `personal_website` in `evidence/real-repo.txt`.
- Criterion 3: include literal/dynamic/cycle cases, then run focused tests, full suite, typecheck, build, diff/docs checks, review, and hosted CI; save results in `evidence/full-verification.txt` and `evidence/reviews.txt`.

## Assumptions
- Only expressions whose compiler-resolved declaration reduces to a source string are static. Environment values, calls, mutable runtime assignments, and unresolved properties remain unknown.
- The configured value may be declared in another tracked JS/TS module; the compiler program already contains it.

## Out of scope
- Evaluating arbitrary JavaScript, runtime environment values, computed getters, or mutable assignment history.
- Changing `personal_website` source code or adding declarations to it.
- The separately captured false-positive risk for generic `.post('/api/...')` helpers.

## Bail conditions
- If the TypeScript checker does not resolve the imported property to a source declaration, stop rather than add repository-specific import parsing.
- If the declaration is mutable or has multiple incompatible writes, leave the URL unresolved rather than selecting one value.
