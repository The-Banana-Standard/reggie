# Self-reviews — 2026-09-24

## Code review

Reviewed compiler evidence, reverse traversal, public flow additions, router defaults, DOM rendering, map projection, and responsive styles. Corrected test callers appearing as visitor origins; retained them in the underlying index. Corrected condition extraction so a call evaluating an if-test is not labelled as conditional on its own result. Restricted effect recognition to imported React hooks, including aliases, and rejected properties on an imported hook. Added explicit callee parameter-type fallback rather than falsely saying no declaration exists. No unresolved blocking findings.

## Security review

This change adds read-only projections and local UI state, not server write routes, executable source evaluation, generated prose or remote requests. Source-derived labels, expressions and conditions render through text nodes; hostile markup has a DOM regression. Canonical entity/source routes use existing encoders. Call paths are bounded by depth, count, search visits and cycle detection. Personal-website dirty state was read but not staged or changed. Existing knowledge-write and loopback protections are untouched.

## Simplification review

Reused the existing compiler program, canonical symbol IDs, recursive value renderer, router and graph model. One small reverse-call module owns path derivation; one UI module owns the client projection. Avoided repository-specific chat hardcoding, simulated runtime branches, automatic knowledge generation and unproven React state links. A separate compact request-path projection solves the large server graph's unreadable client edge without changing the server trace.

## Remaining scope limits

No full React state/prop provenance, dynamic dispatch resolution or runtime request recording. Existing server breadth caps remain visible. The native task packet is the durable handoff; portable doctor warnings about alternate documentation conventions are not new defects.
