# Reviews — complete-data-flow-view

## Code review
Reviewed the diff against all six acceptance criteria and the existing client-data-flow contract. Confirmed that the default projection appends the untouched server step array, services, depth and cap metadata. Origin selection retains all source-backed paths and marks shared call sites selected if they belong to the chosen path. Deduplication uses caller, callee and call-site identity, not display names. No client match is required to retain an endpoint.

Linear layout is allowed only after graph degree, connectivity and cycle checks; the order comes from directed edges rather than step-list order. Layout cache roots separate focus, full and the changed overview. Real browser checks confirm settled geometry and native keyboard controls.

Corrected two details during review: trigger labels must come from each path rather than the selected path, and the old Client origins chip must say Client paths now that the unique origin count is also visible.

## Security review
Read-only additive flow summary data and local rendering changes only. No write endpoint, origin policy, attribution rule, process launch path, credential handling or dependency changes. Source-derived labels use text nodes and model strings; canonical file/symbol links continue through existing route builders. Hostile-label DOM regression checks pass. No personal_website source, knowledge generation or external API calls were introduced.

## Simplification review
Reused existing summary tracing, native radio/select controls, graph builder and preset animation. Added two small pure graph/geometry helpers rather than a new layout dependency or separate renderer. Full argument/return trees stay on the detailed flow API rather than being copied into summary payloads. Existing story cards and entity pages are reused unchanged.

## Documentation and handoff
Native Reggie file notes, journal, plan, checks, evidence and packet are the durable handoff. The portable doctor identifies existing native-layout gaps (HANDOFF, Codex knowledge router and the generic evidence path; the integration checkout also has legacy Claude memory routing). These are not repaired by adding a parallel documentation system during this UI correction.
