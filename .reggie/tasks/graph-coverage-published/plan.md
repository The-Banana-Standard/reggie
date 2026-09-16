---
slug: graph-coverage-published
title: The map says how much of the repo it read, in the counts block, the made-of section and the footer
risk: medium
deciders: []
author: jacobpress
created: 2026-09-15
---
# The map says how much of the repo it read, in the counts block, the made-of section and the footer

## Problem
`buildGraph` keeps only the files whose extension sits in `CODE_EXT` — `ts, tsx, mts, cts, js, jsx, mjs, cjs, rs` at `packages/reggie/src/graph.ts:200` — and drops the rest at `graph.ts:791` before a single node exists. Nothing downstream is told that a filter ran. The container map, the area map, the story and the file pages are all built from what survived, and a repo Reggie read in full and a repo it read a quarter of render identically.

The two numbers that would say so are already computed and then thrown where nobody looks.

- `unresolved` is accumulated in the edge pass at `graph.ts:899`, one increment per relative import specifier that resolved to no file. It lands on `RepoGraph` and is copied to `FlatGraph` by `flatGraph` at `graph.ts:1151`.
- `languages` is the distinct `lang` of the flat nodes at `graph.ts:1125`, copied the same way.

Both ride the no-parameter `GET /api/graph`, which is the compatibility shape. The client never asks for it: `ui/app.js:1611`, `1613`, `1618` and `1986` fetch `/api/graph?level=container`, `/api/graph?level=dir`, `/api/impact` and `/api/workspace`, and `grep -rn "unresolved" packages/reggie/ui` returns nothing. So both numbers are computed correctly, serialized faithfully, and read by no reader.

What the map does read is `ViewCounts` — `totalCodeFiles`, `shown`, `folded`, `hiddenTests` and the impact-only `up`/`down` at `views.ts:34` — built at three sites (`views.ts:678` container, `views.ts:843` dir, `views.ts:1105` impact) and rendered by `footerFor` at `ui/map.js:1510`. Every number in that block describes how much of the graph is on screen. None describes how much of the repo is in the graph. `totalCodeFiles` is `code.length`, the length of the list *after* the `CODE_EXT` filter, so the denominator the footer compares against has already had the skipped files removed from it.

Measured on this worktree at `729e3a2`, with `collectFacts` and `buildGraph` over the real repo:

- 223 tracked, non-ignored files; `facts.languages` = Markdown 96, TypeScript 78, JSON 18, JavaScript 8, CSS 5, HTML 5, YAML 4, Shell 1.
- `graph.totalCodeFiles` = 86. `graph.languages` = `["JavaScript", "TypeScript", "task"]`, which includes the synthetic `task` language set at `graph.ts:997` and is therefore not a list of languages read.
- `graph.unresolved` = 3, from exactly two distinct unresolved specifiers, both string literals inside `packages/reggie/src/graph.test.ts:372-373` — `import("./dyn")` once and `require("./cjs")` counted twice, because `REQUIRE_BIND_RE` and `REQUIRE_RE` at `graph.ts:310-311` both match one bound `require` and `jsImports` pushes a ref for each. Resolvable imports are unharmed by the duplicate because `addEdge` dedupes on `source>target>kind`; the unresolved counter has no such dedupe.
- The container footer for this repo today reads `2 areas · … · 33 tests hidden`, with no statement anywhere on the page that eleven code files were never looked at.

The story's made-of section has the same shape of problem in prose. `madeOfSection` at `story.ts:909` writes one paragraph per Level-1 area from the container view and is the page's literal answer to what the repo is made of; it is an inventory of the survivors. `false-tests-sentence` landed at `771b3d9` and rewrote its counting clause into the shared `testedClause` helper at `story.ts:224`, so the paragraph now reads "N source files, M of them tested" with the clause omitted at zero. That paragraph is the one this item extends, and the helper is the pattern it follows.

The empty case is the worst case and it is already reachable. `footerFor` returns `""` when nothing is drawable (`map.js:1516`), and `emptyMapText` at `map.js:1585` tells a container or dir with nothing on it "No code files under here, so there is nothing to draw." For a Go service or a static site that sentence is false in the most damaging way available: there are plenty of code files, and the only thing missing is Reggie's ability to read them.

It is an honesty item before it is a feature. Reggie's claim is that an owner can trust what it says about a repo they have not read, and a map that silently omits most of a polyglot repo fails that claim invisibly, which is worse than failing it loudly, because the reader is never given the chance to discount the page.

## Approach
Compute one more number in `graph.ts`, carry it and `unresolved` on the block the map already reads, and spend them at two surfaces: one sentence at the top of the made-of section and one segment on the container footer. Nothing new is parsed, resolved or inferred.

**1. One line between code and not-code, in `facts.ts`.** `LANGUAGE_BY_EXT` at `facts.ts:35` recognises 38 extensions and folds documentation, configuration and data in with programming languages, so a naive diff against `CODE_EXT` announces that this repo "skipped 96 Markdown files" — noise presented as honesty. `workspace.ts:375` already holds a third, private table, `CODE_LANGUAGES`, which excludes Markdown, JSON, YAML and TOML but also excludes HTML, CSS and SCSS, so a static site repo reports zero code files there.

`facts.ts` gains one exported helper, `codeLanguageOf(file: string): string | null`, returning the `LANGUAGE_BY_EXT` language when that language is not in a new exported `NON_CODE_LANGUAGES` set of `Markdown, JSON, YAML, TOML`, and `null` otherwise. The rule it encodes, stated in its doc comment: a file is code when a person authored it as part of how the product behaves or looks — programming languages, shell, SQL, and the markup and stylesheets a browser runs — and is not code when it describes or configures the product. `graph.ts` is its only caller in this change; `workspace.ts` keeps its own table and is left alone, and the duplication is captured as its own item.

**2. `RepoGraph.skipped`, in `graph.ts`.** Beside the existing `const code = all.filter(...)` at `graph.ts:791`, walk the same `all` list once more and count, per language, the files that `codeLanguageOf` calls code and `CODE_EXT` does not read. The result is `LanguageCount[]` — the type `facts.ts:7` already exports — sorted by `files` descending, ties by language ascending, and added to `RepoGraph`. Because `graph.ts` and `facts.ts` build `all` from the same `listRepoFiles(root).filter((f) => !isIgnoredPath(f))`, `totalCodeFiles + sum(skipped.files)` is the repo's code-file total by construction, and no fourth field is needed to carry a denominator.

**3. `unresolved` counts imports, not scanner matches.** The edge pass keeps a `Set` of `` `${s.file}>${ref.spec}` `` for the misses instead of an integer, and `unresolved` becomes its size: distinct (importing file, specifier) pairs. One bad path imported from twelve files is twelve; one bad path written twice in one file is one; the bound `require` that counts twice today counts once. That is the unit a reader's "an import" means — a line in a file — and it is the unit the wording can honestly carry. `src/orphan.ts` in the `graph.test.ts` fixture holds a single ES import of `./missing`, so the existing `expect(g.unresolved).toBe(1)` at `graph.test.ts:42` and `unresolved: 0` at `graph.test.ts:314` are unchanged. The duplicate that `jsImports` itself returns is left in place and captured separately; this change stops it corrupting a published number without touching the scanner's output.

**4. `ViewCounts` gains `skipped` and `unresolved`.** Both are lifted straight from the `RepoGraph` at all three build sites, exactly as `totalCodeFiles` already is, so the three levels cannot disagree and no view recomputes anything. `skipped` is the array, not a total: a footer that wants one number sums it and a sentence that wants names reads it, from one field, which is the only way the two surfaces cannot drift.

**5. The made-of sentence.** `madeOfSection` gains a first paragraph, id `made-of-coverage`, kind `fact`, refs `[repo:<name>]`, built by one module-local helper in `story.ts` in the shape `testedClause` established: `coverageSentence(read, skipped, unresolved)` returns the whole sentence and nothing else formats it. The area paragraphs keep their `made-of-1` upward ids and their text is untouched, so the new paragraph cannot renumber or disturb them.

The sentence has two halves. Reading: when `skipped` is empty, "Reggie read all N code files in this repo"; otherwise "Reggie read N of this repo's M code files, skipping " plus the languages, each named with its file count, at most three named in the array's own order, any remainder folded into one clause naming how many files in how many other languages. Imports: when `unresolved` is zero, " and followed every import."; otherwise "; N imports pointed at no file, so the map is missing those connections." Counts under ten are words, per `numberWord` and spec §6.6.

For this repo at `729e3a2` that renders: "Reggie read 86 of this repo's 97 code files, skipping five CSS files, five HTML files and one Shell file; two imports pointed at no file, so the map is missing those connections." For a fully read repo it renders the owner's own wording: "Reggie read all 86 code files in this repo and followed every import."

**6. The footer, and only the container footer.** `footerFor`'s container branch appends `${plural(n, "import")} point at no file` as the last `·` segment when `counts.unresolved` is positive, and appends nothing when it is zero. The dir, impact and workspace branches are untouched. `unresolved` is a repo-wide number; a folder footer that reports it beside "12 files · 8 edges" invites the reader to attach it to the folder, and scoping it per view would mean counting misses per file, which the graph does not do and this item does not add. The rule the whole change follows is that a repo-wide number appears only on a repo-wide surface: the container map and the repo story.

Being last is also the crowding rule. The footer is one line in a floating card with `max-width: 60%` (`ui/map.css:71`) and it wraps rather than clipping, so the segment that costs the least when the line wraps is the one added last, and the one segment that is added is short.

**7. The empty container map.** `emptyMapText`'s container branch reads `model.counts.skipped`, which `map.js:915` already puts on the model and `renderEmptyState` already passes. When nothing is drawable and `skipped` is non-empty, the card says how many code files are in the repo and which languages they are, instead of "No code files under here" — text on the order of "Nothing here is in a language the map reads: 214 code files, mostly Go and Swift.", hint "The files are in the repo. They are missing from the map, not from the code." When `skipped` is empty the existing text stands, and the footer stays empty in both cases, because F-MAP-C already assigns the explanation to the canvas and silence to the footer. This is the case where the coverage claim matters most and the case where the footer is guaranteed to be unavailable, so the empty card is where it has to be said.

**8. The written record and the fixtures, in the same commit.** `docs/ui-api-contract.md:85` documents the two new fields on `counts`; `ui/DOM-CONTRACT.md:34` quotes the footer content, and `docs/ui-spec.md:49` and `:100` quote the made-of paragraph and the footer example as their own specification, which `packages/reggie/docs/ui-spec.md`'s own note says goes stale the moment the code's wording changes. `gen-samples.mjs` writes the two fields into the five payloads it generates and `sample-story.json`, which has no generator, is hand-edited to carry the coverage paragraph with numbers consistent with `sample-container.json`. `test/fixtures.ts` gains a stylesheet and a shell script so `makeFixtureRepo` exercises a non-zero skipped count in the dev harness and the served fixture; neither file has a `CODE_EXT` extension, so `totalCodeFiles` and every count pinned to it are unmoved.

Rejected alternatives:

- Counting skipped files against every tracked file, or against every language `facts.ts` recognises. Against 223 tracked files this repo reports 137 skipped; against the 215 with a recognised language it reports 129, of which 96 are Markdown. Both are true and both are unusable, and a disclaimer a reader learns to ignore is worse than no disclaimer.
- Reusing `workspace.ts`'s `CODE_LANGUAGES` as the code/not-code line. It is the nearest existing answer and it excludes HTML, CSS and SCSS, so on the static-site repos this feature is aimed at it would report zero code files and the sentence would claim Reggie read all of nothing. Widening it instead would move the workspace tile's `codeFiles` and `primaryLanguage`, a surface held back by the one-repo-at-a-time decision.
- A single skipped total instead of the per-language array. It fits the footer and starves the sentence, and a second field for the names is the drift this item exists to prevent.
- Publishing the skipped count in the footer as well. The footer gains one number, per the intake line; two more segments about a repo-wide fact would crowd the line the item promises not to redesign, and the sentence beside the map already names the languages.
- Repeating the repo-wide `unresolved` in the dir and impact footers. Argued above: the number is not about the scope those footers describe.
- Removing `unresolved` and `languages` from the flat `/api/graph`. `test/serve.test.ts:160` pins the flat payload's exact key set as a contract, and the brief puts reshaping that route out of scope; the fields stay and the contract gains a line saying which copy the UI reads.

## Files to touch
- packages/reggie/src/facts.ts (MOD)
- packages/reggie/src/graph.ts (MOD)
- packages/reggie/src/views.ts (MOD)
- packages/reggie/src/story.ts (MOD)
- packages/reggie/ui/map.js (MOD)
- packages/reggie/src/graph.test.ts (MOD)
- packages/reggie/src/views.test.ts (MOD)
- packages/reggie/src/story.test.ts (MOD)
- packages/reggie/test/fixtures.ts (MOD)
- packages/reggie/docs/ui-api-contract.md (MOD)
- packages/reggie/ui/DOM-CONTRACT.md (MOD)
- packages/reggie/docs/ui-spec.md (MOD)
- packages/reggie/ui/dev/gen-samples.mjs (MOD)
- packages/reggie/ui/dev/sample-container.json (MOD)
- packages/reggie/ui/dev/sample-dir.json (MOD)
- packages/reggie/ui/dev/sample-dir-tests.json (MOD)
- packages/reggie/ui/dev/sample-impact.json (MOD)
- packages/reggie/ui/dev/sample-blast.json (MOD)
- packages/reggie/ui/dev/sample-story.json (MOD)
- docs/ui-plan.md (MOD)

## Acceptance criteria
- [ ] `RepoGraph` carries `skipped: LanguageCount[]`, sorted by `files` descending with ties by `language` ascending, and every entry names a language the graph does not read.
- [ ] `ViewCounts` carries `skipped` and `unresolved`, and all three build sites — container, dir and impact — lift both straight from the `RepoGraph` without recomputing either.
- [ ] A file counts as skipped code exactly when one exported helper in `packages/reggie/src/facts.ts` returns a language for it and `CODE_EXT` does not hold its extension; `graph.ts` is that helper's only caller in this change and `workspace.ts` is unchanged.
- [ ] Markdown, JSON, YAML and TOML files are never counted as skipped code, and HTML, CSS, SCSS, Shell and SQL files are, with the reason stated in the helper's doc comment.
- [ ] `graph.unresolved` counts distinct importing-file-and-specifier pairs: the same specifier written twice in one file counts once, and one specifier imported from two files counts twice.
- [ ] Built against this repo at the landing commit, `graph.unresolved` is 2, down from 3 today, and `counts.skipped` is CSS 5, HTML 5, Shell 1 against a `totalCodeFiles` of 86.
- [ ] The made-of section's first paragraph has id `made-of-coverage`, kind `fact`, and the area paragraphs keep their `made-of-1` upward ids with their text unchanged from the landing commit of `false-tests-sentence`.
- [ ] One module-local helper in `story.ts` returns that paragraph's whole sentence, and no other site in `story.ts` formats any part of it.
- [ ] With nothing skipped and nothing unresolved the paragraph reads `Reggie read all N code files in this repo and followed every import.` with N as the code-file total.
- [ ] With something skipped the sentence names each skipped language with its file count, at most three of them, and folds any remainder into one clause naming how many files in how many other languages.
- [ ] Rendered against this repo at the landing commit the paragraph reads `Reggie read 86 of this repo's 97 code files, skipping five CSS files, five HTML files and one Shell file; two imports pointed at no file, so the map is missing those connections.`
- [ ] `footerFor` appends the unresolved segment on `level === "container"` only, only when the count is positive, as the last segment of the line, and the word `unresolved` appears in no string the reader can see.
- [ ] For identical payloads the dir, impact and workspace footer strings are byte-identical to the ones `footerFor` returns at the landing commit of `false-tests-sentence`.
- [ ] `emptyMapText` at container level, given a payload with nothing drawable and a non-empty `skipped`, names the skipped code-file total and its languages instead of saying there are no code files, and the footer stays empty for that payload.
- [ ] The no-parameter `GET /api/graph` payload gains no field: `test/serve.test.ts` still asserts the same nine keys and passes unchanged.
- [ ] `packages/reggie/docs/ui-api-contract.md` documents `skipped` and `unresolved` on `counts` and states that the flat route's copies are the compatibility shape the UI does not read.
- [ ] The `map-footer` row of `packages/reggie/ui/DOM-CONTRACT.md` and the made-of row and footer example of `packages/reggie/docs/ui-spec.md` quote the post-change wording, including the rule that the footer segment is omitted at zero.
- [ ] The five generated `ui/dev` samples carry `skipped` and `unresolved` from `gen-samples.mjs`, and `sample-story.json` carries a coverage paragraph whose numbers agree with `sample-container.json`.
- [ ] `makeFixtureRepo` holds at least one file in a skipped code language and at least one in a language the graph reads, and every existing test that pins a count from that fixture passes unchanged.
- [ ] `story.test.ts` and `views.test.ts` each gain a test that fails when the coverage paragraph is deleted or when `ViewCounts` stops carrying the two fields.
- [ ] The `publish the graph's own coverage` bullet in `docs/ui-plan.md` records this task and no longer claims `unresolved` is discarded.
- [ ] Run from `packages/reggie`, `TZ=UTC npm test`, `npm run typecheck` and `npm run build` each exit 0 at the landing commit.

## Verification strategy
- Criterion 1: the `RepoGraph` diff plus a `tsx` probe printing `skipped` for this repo and for a throwaway repo holding two skipped languages with unequal counts, saved to `evidence/skipped-shape.txt`.
- Criterion 2: the `views.ts` diff read at all three build sites, saved to `evidence/views-diff.txt`, showing each lifting from `g` with no arithmetic.
- Criterion 3: `grep -rn "codeLanguageOf" packages/reggie/src` showing one definition and callers only in `graph.ts`, plus `git diff --stat packages/reggie/src/workspace.ts` empty, both in `evidence/one-rule.txt`.
- Criterion 4: a table-driven unit test in `facts.test.ts` over one file per language, with its output in `evidence/tests.txt` and the doc comment in `evidence/one-rule.txt`.
- Criterion 5: a `graph.test.ts` case built on a repo with one file importing a missing path twice and two files importing the same missing path, asserting 1 and 2; named in `evidence/tests.txt`.
- Criterion 6: the `tsx` probe of criterion 1 run against this worktree, printing `unresolved`, `totalCodeFiles` and `skipped` before and after, saved to `evidence/this-repo-numbers.txt`.
- Criterion 7: the rendered made-of section with every paragraph id and text, saved to `evidence/made-of-rendered.txt`, diffed against the same section rendered at `729e3a2`.
- Criterion 8: the `story.ts` diff in `evidence/story-diff.txt`, read for one helper and one call site.
- Criterion 9: a `story.test.ts` assertion on a purpose-built repo that is entirely TypeScript with every import resolving, quoted in `evidence/tests.txt`.
- Criterion 10: a `story.test.ts` assertion on a purpose-built repo holding five skipped languages, showing three named and the rest folded; quoted in `evidence/tests.txt`.
- Criterion 11: the coverage paragraph line of `evidence/made-of-rendered.txt`, compared character by character with the sentence in this plan.
- Criterion 12: `footerFor` called from a small node script over the five `ui/dev` samples at each level, output saved to `evidence/footers.txt`, plus `grep -rin "unresolved" packages/reggie/ui/*.js packages/reggie/ui/*.html` showing no reader-visible string in `evidence/phrase-sweep.txt`.
- Criterion 13: `evidence/footers.txt` diffed against the same script run at the landing commit of `false-tests-sentence`, with only the container line changed.
- Criterion 14: the same script calling `emptyMapText` and `footerFor` on a payload with no drawable nodes and a non-empty `skipped`, appended to `evidence/footers.txt`.
- Criterion 15: `npx vitest run test/serve.test.ts` output and `git diff packages/reggie/test/serve.test.ts` empty, both in `evidence/flat-route-frozen.txt`.
- Criterion 16: the diff of `packages/reggie/docs/ui-api-contract.md`, saved to `evidence/docs-diff.txt`.
- Criterion 17: the diffs of `packages/reggie/ui/DOM-CONTRACT.md` and `packages/reggie/docs/ui-spec.md`, in the same `evidence/docs-diff.txt`, each quote compared with `evidence/footers.txt` and `evidence/made-of-rendered.txt`.
- Criterion 18: `node ui/dev/gen-samples.mjs` rerun, `git diff` of the five samples plus the hand edit to `sample-story.json`, saved to `evidence/samples.txt`, with the story numbers read beside the container sample's counts.
- Criterion 19: `npx vitest run test/fixtures.test.ts src/views.test.ts src/story.test.ts test/serve.test.ts` output in `evidence/tests.txt`, plus the probe of criterion 1 run against `makeFixtureRepo`'s root showing a non-zero skipped count.
- Criterion 20: a mutation probe — delete the coverage paragraph, run the suite, record the failing test names; restore it, drop `skipped` and `unresolved` from `ViewCounts`, run again, record; revert and run green. All three runs appended to `evidence/mutation-probe.txt`.
- Criterion 21: the diff of `docs/ui-plan.md`, in `evidence/docs-diff.txt`.
- Criterion 22: `TZ=UTC npm test`, `npm run typecheck` and `npm run build` run from `packages/reggie`, each command's output and exit code appended to `evidence/build.txt`, with the pre-existing `src/tasks.test.ts` timezone failure noted as the reason `TZ=UTC` is set.

## Assumptions
The owner is asleep and unreachable. The brief carries two `Answered by jacobpress on 2026-09-15` lines and both are binding and honoured below. Every other open question is answered here, unattended, on 2026-09-15, with the evidence each answer rests on.

- **The skipped figure is a per-language breakdown, and the single number is its sum.** One field, `skipped: LanguageCount[]`, serves both surfaces. The footer that wants one number sums it; the sentence that wants names reads it. A total field beside a names field is two representations of one fact in one payload, which is exactly how `unresolved` and `totalCodeFiles` came to describe different populations without anyone noticing.
- **The denominator is code files, and the line between code and not-code is drawn explicitly rather than borrowed.** Measured on this repo: all tracked files gives 137 skipped of 223; `facts.LANGUAGE_BY_EXT` gives 129 of 215, 96 of them Markdown; the chosen rule gives 11 of 97. The first two are true and unusable. The rule is that a file is code when a person authored it as part of how the product behaves or looks, and is not code when it describes or configures the product, which excludes exactly Markdown, JSON, YAML and TOML from `LANGUAGE_BY_EXT` and keeps HTML, CSS, SCSS, Shell, SQL and every programming language. HTML and CSS stay in deliberately: `workspace.ts:375` drops them, and on a static-site repo — the kind named as a near-term target — dropping them would report zero code files and let the sentence claim Reggie read all of nothing. This repo's own `ui/index.html` and `ui/styles.css` are product source by any reading, and their absence from the map is the honest thing to declare.
- **The unresolved count is repo-wide and appears only on repo-wide surfaces.** The brief's own objection is correct: a dir footer reporting a repo-wide total reports something that is not about the directory in view. Scoping it per view means counting misses per file, which the graph does not do and this item will not add. So the container footer and the repo story carry it, and the dir, impact and workspace footers stay exactly as they are. The same rule settles the empty-state wording and the workspace question below.
- **`unresolved` counts distinct importing-file-and-specifier pairs.** Today it counts scanner matches, and `graph.ts:310-311` makes one bound `require` produce two matches, so this repo publishes 3 for 2 broken lines. A reader's unit for "an import" is a line in a file, so one bad path used in twelve files is twelve and one bad path written twice in one file is one. Deduping at the counter is not resolver improvement — no specifier that failed now succeeds — so it does not trespass on the brief's "Not this". The duplicate `jsImports` itself returns is left alone and captured as its own item, because fixing the scanner changes what every caller sees, and this task only needs the published number to be right.
- **The footer says nothing when the count is zero.** Every other segment on that line already vanishes at zero — `hiddenText` is null at `map.js:1524`, and the sub-area and test segments at `map.js:1534` are conditional — so a lone `0` would be the only zero on the line and would be noise on the surface the reader looks at most. The brief's worry, that silence is indistinguishable from never having been given the number, is answered on the other surface: the made-of sentence always renders and makes the positive claim when there is nothing to disclaim, so the page never goes silent even when the footer does.
- **The segment goes last, and short.** The container line is `7 areas · 12 edges · 49 tests hidden` and the dir line already prepends the folding sentence. Appending puts the newest and least structural fact where a wrap costs least, and `2 imports point at no file` is five words. The card is `max-width: 60%` with no `white-space: nowrap` (`ui/map.css:71`), so an over-long line wraps inside the card rather than clipping or overflowing the canvas; nothing is dropped and no layout rule has to be invented.
- **The word `unresolved` never reaches the reader.** It is precise and it is jargon, and the reader being addressed has not read the code. The footer says `N imports point at no file` and the sentence says `N imports pointed at no file, so the map is missing those connections`. The field keeps its name in the payload and the contract, where the audience is a client author.
- **The sentence is the first paragraph of the made-of section.** Binding, answered by jacobpress on 2026-09-15: first paragraph, so the reader can discount the inventory before reading it. It is given the stable id `made-of-coverage` rather than `made-of-1`, so the area paragraphs keep their existing numbering and nothing that reads a paragraph id shifts under it.
- **The all-clear sentence makes the positive claim.** Binding, answered by jacobpress on 2026-09-15: "Reggie read all N code files and followed every import." Recorded with one correction to the premise it was given for: the answer says this is "true of this repo today", and measurement says otherwise — 11 skipped code files and 2 unresolved imports at `729e3a2`. So the positive form will not render on this repo, and the reason the answer gave for choosing it, that it keeps the feature exercised here, does not hold. The answer is kept because the honesty rule genuinely does cut both ways, and the exercise is supplied instead by the purpose-built test repos in criteria 9 and 10.
- **The sentence names the skipped languages, capped at three, with the rest folded.** Naming is what makes the sentence useful; the long tail of one-file languages is what makes naming risky. Three named entries in an array already sorted by file count keeps the sentence to a readable length and puts the largest omissions in front of the reader, and a single fold clause keeps the total honest without listing seven languages of one file each.
- **The workspace payload and the workspace footer stay silent.** `footerFor`'s workspace branch and `workspaceToView` at `map.js:415` build their counts client-side from repo tiles, and `workspace.ts` counts languages with its own third table. Teaching that surface the same disclaimer means settling which table is right for every repo in the workspace, which is the cross-repo work the one-repo-at-a-time decision of 2026-09-15 defers. The inconsistency is real and is accepted for now: the repo map disclaims and the workspace map says nothing, which is the same position every other repo-derived number is already in there.
- **The flat `/api/graph` keeps `unresolved` and `languages`, and gains nothing.** `test/serve.test.ts:160` pins its exact key set, and the brief puts reshaping that route out of scope. `skipped` is therefore deliberately absent from `FlatGraph`; the counts block is the published home for it. The contract gains one sentence naming the counts block as what the UI reads, so the duplication is documented rather than silent. `graph.languages` is also left alone and is deliberately not used to name what the graph reads, because it includes the synthetic `task` language from `graph.ts:997`.
- **The file page says nothing new.** A file in a skipped language has no node, so `/api/story?scope=file` for it is a page built from a graph that never heard of it. That is a real gap and the brief leaves it unsettled; it needs its own decision about what a file page even is for a file the graph has no record of, which is a page-shaped question rather than a number-shaped one. The item as captured covers the map and the story, and this plan stays inside it.
- **The empty container map explains itself from `skipped`.** An all-skipped repo is where the coverage claim matters most and is exactly where `footerFor` returns nothing, so the claim goes in the empty card, which `renderEmptyState` already draws and which already receives `counts`. The division of labour is the one F-MAP-C set: the canvas says why it is empty and the footer says nothing. Only the container branch changes; the dir branch keeps its current text, because a repo-wide skipped list does not explain why one particular folder is empty.
- **The shared fixture repo gains a skipped language.** Without one, every assertion about the new numbers asserts zero: `test/fixtures.ts` writes only `.ts`, `.rs`, `.json` and `.toml` files today. It gains a stylesheet and a shell script. Neither extension is in `CODE_EXT`, so `totalCodeFiles`, `included` and every count pinned to them are unmoved, `test/fixtures.test.ts` asserts no file counts at all, and `views.test.ts:284` compares the view against the fixture's own total rather than a literal. The branch-level assertions still get purpose-built repos of their own, because a shared fixture tuned to one test is how fixtures stop being readable.
- **Nothing here narrows the gap.** No extension is added to `CODE_EXT`, no resolver is improved, and no import that fails today succeeds afterwards. The published numbers describe the gap exactly as it is; M-Lang is what closes it.
- **The evidence comes from throwaway probes run with `tsx` from the scratchpad, not from files added to the repo**, and the footer and empty-state checks call the exported `footerFor` and `emptyMapText` from a node script over the `ui/dev` samples, because `vitest.config.ts` includes only `src/**` and `test/**` and this task does not stand up a UI test harness.
- **`TZ=UTC` is set for the suite deliberately.** `src/tasks.test.ts`'s "assembles plan, packet, claim, journal, and impact as a task moves" fails in local evening time because `ageInDays` parses a bare `YYYY-MM-DD` as midnight UTC against a locally written date. It is unrelated to this task, is already captured as its own intake item, and reproduces on a clean `repo-manager`.
- **Three unrelated findings were captured during this pass rather than fixed**: the duplicate ref `jsImports` returns for a bound `require`; the claim at `docs/ui-plan.md:142` that `SYMBOL_ENGINE` is discarded, when `serve.ts:1364` serves it at `/api/symbols`; and the three disagreeing tables for what a code file is. The `docs/ui-plan.md` edit in this task rewrites that bullet to record what was published and drops the stale half of the sentence rather than restating it either way.

## Out of scope
- Adding any language to `CODE_EXT`, or writing an import or entry extractor for one. That is M-Lang, deferred by the decision of 2026-09-15, and this item must describe the gap without narrowing it.
- Improving `resolveJsImport`: tsconfig path aliases, package self-references, extensionless directory imports and index resolution are all reasons a relative specifier misses, and every one of them would lower the number this task publishes. Publishing it is the task; reducing it is a separate argument on its own evidence.
- Fixing `jsImports` so a bound `require` yields one ref instead of two. Captured; this task stops the duplicate corrupting a published number and leaves the scanner's output alone.
- Consolidating `CODE_EXT`, `LANGUAGE_BY_EXT` and `workspace.ts`'s `CODE_LANGUAGES` into one table, and deciding once for the whole product whether HTML and CSS are code. Captured.
- Coverage in the testing sense. The tests lens, the Tests section, `testedClause` and `aggregates.testedSource` are read here and left exactly as they are, even though the word coverage is about to appear near them.
- The workspace map, the workspace tiles and cross-repo discovery, per the one-repo-at-a-time decision.
- The file page for a file in a skipped language, and any per-file or per-area coverage number.
- Redesigning the footer, the toolbar or the legend, or changing how the map fits around them. The footer gains one segment inside the composition that exists.
- Removing or reshaping the flat `GET /api/graph` route, or changing `graph.languages`.
- The treemap tab, the lenses, and anything that colours nodes by what was skipped. This is two numbers, one sentence and one footer segment.
- Re-examining the made-of area paragraphs that `false-tests-sentence` just rewrote, and the two defects in the area Tests section captured at `47bbcce`.

## Bail conditions
- `ViewCounts` turns out to have a reader outside this repo that the contract does not cover, which would make adding fields a published contract change and move this task behind a versioning decision.
- The skipped rule lands and this repo's skipped count is still zero or still dominated by documentation, which would mean the code and not-code line is drawn in the wrong place and the definition needs the owner rather than a plan.
- Deduping the unresolved counter moves `graph.test.ts:42` or `graph.test.ts:314` away from their current expectations, which would mean the fixture holds an unresolved import this plan has not accounted for and the unit needs re-deciding before anything is published.
- The container footer with the new segment wraps to three or more lines at 1000 pixels wide, which would mean the footer's layout, not its content, is the constraint, and the line belongs in its own item about the floating card.
- Adding the two files to `makeFixtureRepo` turns any existing test red, which would mean the shared fixture is load-bearing in ways this plan did not find and the fixture work becomes its own change.
- `emptyMapText` turns out to be reached with no `counts` on the model for some level, which would mean the empty state cannot be trusted to carry the claim and the all-skipped case needs a different surface.
- The made-of coverage paragraph and the `false-tests-sentence` clause read as two contradictory coverage claims in one section when rendered together, which would mean the section needs re-shaping rather than one more sentence, and the task goes back to its brief.
