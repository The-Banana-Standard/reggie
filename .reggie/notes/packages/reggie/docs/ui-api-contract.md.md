---
entity: packages/reggie/docs/ui-api-contract.md
kind: file
---

## gotcha · 2026-09-15 · Claude via jacobpress · high
Two fields on the counts block describe the repo and not the view, and the contract has to keep saying so or a client will scope them wrongly. Three sentences here are load-bearing and were each written because the code is easy to misread: the total of code files is what the graph opened and read rather than what it recognised, so a file listed by git but missing from disk is in neither it nor the skipped list; the count of imports that led nowhere counts only specifiers written as a path, so a zero means no path-style import failed and not that every import was followed; and consistency is guaranteed inside one payload, not across two requests, because the story and the level payloads are cached separately and carry no commit. Change the code and change these sentences together.
sources: packages/reggie/docs/ui-api-contract.md, graph-coverage-published

## gotcha · 2026-09-15 · Claude via jacobpress · high
One line lists the section ids for every scope in order, and it is what a client author reads instead of the code, so it is wrong from the moment a story function's section list changes. Change the line in the same commit as the list. Repo and area end with add-note; the file, task, workspace, services and flow lists are untouched by that change.
sources: packages/reggie/docs/ui-api-contract.md, note-form-on-repo-and-area

## gotcha · 2026-09-17 · Claude via jacobpress · medium
The two change routes are documented with their row kinds, card kinds, caps and status codes, and the text says which conditions make a file unreadable. Those lists are copies of unions in the changes module; add a card kind or a status there and this file is wrong until the same commit edits it. The completion block now lists the landing merge, which the Completed view reads to decide whether a changed file is a door.
sources: packages/reggie/docs/ui-api-contract.md, branch-diff-in-reader

## gotcha · 2026-09-17 · Claude via jacobpress · medium
The journal section documents the optional derived field on a journal entry, the handle on a claim, and, in the launch route's paragraph, the launch log beside the single launch record. The derived field's shape is a copy of DerivedMark in the journal module; change one and change the other in the same commit.
sources: derive-the-journal

## gotcha · 2026-09-18 · Claude via jacobpress · high
The capture route's paragraph now lists every refusal the origin resolver makes and the exact detail-line sentences it writes, and the launch routes document the path parameter and the sentence added to the prompt. Those lists and sentences are copies of what resolveCaptureOrigin, originLine and pathsClause do; change one and change the other in the same commit, because a client author reads this file instead of the code.
sources: idea-from-every-page

## how · 2026-09-18 · Claude via jacobpress · high
The task route's section documents the policy object with every gate id and criterion status, what is read from which commit, the not-evaluated cases, and the checks file's record shape. The decide route's paragraph was rewritten to match what the route really answers: a solo approval lands the task and answers the merge, the release and captured, and every refusal is a 409 carrying its own sentence, the evidence gate and the landing lock among them. It also states the rule by which an evidence reference is read and when a reference is a citation. GateId, CriterionStatus and the record shape are copies of unions in policy.ts and checks.ts; change one and change the other in the same commit.
sources: low-risk-auto-approval

## decision · 2026-09-22 · Codex via jacobpress · medium
Flow API steps expose structured ArgumentValue and ReturnVariant records under stable double-colon symbol IDs.

## decision · 2026-09-23 · Codex via jacobpress · high
The public contract documents KnowledgeRecord, inventory, preview, job and guarded write routes, including explicit confirmation, stale behavior, cache locality and knowledge-only commits.
sources: shared-repo-knowledge

## decision · 2026-09-23 · Codex via jacobpress · medium
Knowledge detail reads expose historyCount but require history=1 to include immutable history entries in the response.

## decision · 2026-09-23 · Codex via jacobpress · high
The API contract documents entity reads, role-aware reachability, revision-checked source pages, and guarded concept override writes.
sources: code-entity-pages

## decision · 2026-09-23 · Codex via jacobpress · high
The documented source-read boundary is tracked first-party JavaScript and TypeScript only, with repository internals and symlinks excluded.
sources: code-entity-pages

## decision · 2026-09-23 · Codex via jacobpress · medium
The UI API contract removes Payload/input/output and documents entryNode, typed nodes, call-site IDs, semantic values, and returns.

## how · 2026-09-24 · Codex via jacobpress · medium
Documents optional compact client summaries, unique-origin versus path counts and bounded client detection on the flow index.
sources: complete-data-flow-view

