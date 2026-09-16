---
slug: graph-coverage-published
title: The map says how much of the repo it read, in the counts block, the made-of section and the footer
risk: medium
author: jacobpress
date: 2026-09-15
branch: task/graph-coverage-published
base: repo-manager
verdict: pending
decided_by:
decided_at:
---
# Completion: The map says how much of the repo it read, in the counts block, the made-of section and the footer

Read this top to bottom to decide whether the work is done. Every claim should point at evidence.

Built unattended overnight with the owner asleep. Every open choice was decided the way the plan's
Approach points and is recorded below. Two of the plan's own pinned strings changed, and both are
under Deviations with the measurement that forced the change.

## Acceptance criteria

- [x] `RepoGraph` carries `skipped: LanguageCount[]`, sorted by `files` descending with ties by `language` ascending, and every entry names a language the graph does not read.
  evidence: (.reggie/tasks/graph-coverage-published/evidence/skipped-shape.txt) — the diff, plus the sort proved on a throwaway repo with unequal counts and a tie, and a table test over a literal file list in `evidence/tests.txt`.
- [x] `ViewCounts` carries `skipped` and `unresolved`, and all three build sites — container, dir and impact — lift both straight from the `RepoGraph` without recomputing either.
  evidence: (.reggie/tasks/graph-coverage-published/evidence/views-diff.txt) — every site is `g.skipped` / `g.unresolved` verbatim; `views.test.ts` asserts all three agree with the graph, including a folder that holds none of the skipped files.
- [x] A file counts as skipped code exactly when one exported helper in `packages/reggie/src/facts.ts` returns a language for it and `CODE_EXT` does not hold its extension; `graph.ts` is that helper's only caller in this change and `workspace.ts` is unchanged.
  evidence: (.reggie/tasks/graph-coverage-published/evidence/one-rule.txt) — one definition, one production caller (`graph.ts`), and `git diff --stat` on `workspace.ts` is empty. `facts.test.ts` also imports it; that is the test for it, not a second caller.
- [x] Markdown, JSON, YAML and TOML files are never counted as skipped code, and HTML, CSS, SCSS, Shell and SQL files are, with the reason stated in the helper's doc comment.
  evidence: (.reggie/tasks/graph-coverage-published/evidence/one-rule.txt) for the doc comment; (.../evidence/tests.txt) for the table, one case per language the table knows, plus an assertion that the not-code set is exactly those four.
- [x] `graph.unresolved` counts distinct importing-file-and-specifier pairs: the same specifier written twice in one file counts once, and one specifier imported from two files counts twice.
  evidence: (.reggie/tasks/graph-coverage-published/evidence/tests.txt) — a repo with one file importing a missing path twice, two files importing the same missing path, a bound `require`, and a bare specifier, asserting 4.
- [x] Built against this repo at the landing commit, `graph.unresolved` is 2, down from 3 today, and `counts.skipped` is CSS 5, HTML 5, Shell 1 against a `totalCodeFiles` of 86.
  evidence: (.reggie/tasks/graph-coverage-published/evidence/this-repo-numbers.txt) — before and after from the same probe. Read `evidence/what-the-number-counts.txt` beside it: the 2 is two string literals in a unit test, stated plainly under Open risks.
- [x] The made-of section's first paragraph has id `made-of-coverage`, kind `fact`, and the area paragraphs keep their `made-of-1` upward ids with their text unchanged from the landing commit of `false-tests-sentence`.
  evidence: (.reggie/tasks/graph-coverage-published/evidence/made-of-rendered.txt) — the rendered section diffed against the same section at the branch point; only the new paragraph appears. **The paragraph's `refs` deviate** — see Deviations 4.
- [~] One module-local helper in `story.ts` returns that paragraph's whole sentence, and no other site in `story.ts` formats any part of it.
  evidence: (.reggie/tasks/graph-coverage-published/evidence/story-diff.txt) — one helper, one call site, nothing else formats any part of it. **It is exported, not module-local** — see Deviations 1.
- [~] With nothing skipped and nothing unresolved the paragraph reads `Reggie read all N code files in this repo and followed every import.` with N as the code-file total.
  evidence: (.reggie/tasks/graph-coverage-published/evidence/tests.txt) — the shape holds and N is the code-file total, but **the clause is now qualified and the noun agrees at one** — see Deviations 2 and 3.
- [x] With something skipped the sentence names each skipped language with its file count, at most three of them, and folds any remainder into one clause naming how many files in how many other languages.
  evidence: (.reggie/tasks/graph-coverage-published/evidence/tests.txt) — five skipped languages render "four CSS files, three HTML files, two Shell files and two files in two other languages"; exactly three render with nothing folded.
- [x] Rendered against this repo at the landing commit the paragraph reads `Reggie read 86 of this repo's 97 code files, skipping five CSS files, five HTML files and one Shell file; two imports pointed at no file, so the map is missing those connections.`
  evidence: (.reggie/tasks/graph-coverage-published/evidence/made-of-rendered.txt) — rendered for real and compared character by character with the plan's text: `IDENTICAL: True`, 178 characters both. This check earned its keep: it failed once, at "three imports", and the cause was a real defect (Discovered issues 1).
- [x] `footerFor` appends the unresolved segment on `level === "container"` only, only when the count is positive, as the last segment of the line, and the word `unresolved` appears in no string the reader can see.
  evidence: (.reggie/tasks/graph-coverage-published/evidence/footers.txt) and (.../evidence/phrase-sweep.txt) — `grep -rin "unresolved"` over `ui/*.js` and `ui/*.html` returns nothing, and every reader-visible string the change adds is quoted there.
- [x] For identical payloads the dir, impact and workspace footer strings are byte-identical to the ones `footerFor` returns at the landing commit of `false-tests-sentence`.
  evidence: (.reggie/tasks/graph-coverage-published/evidence/footers.txt) — the same script run at the branch point and here, diffed: only the two container lines change.
- [~] `emptyMapText` at container level, given a payload with nothing drawable and a non-empty `skipped`, names the skipped code-file total and its languages instead of saying there are no code files, and the footer stays empty for that payload.
  evidence: (.reggie/tasks/graph-coverage-published/evidence/footers.txt) — it does, **and it now also requires that the graph read no code files at all** — see Deviations 5. The footer is `""` in every empty case.
- [x] The no-parameter `GET /api/graph` payload gains no field: `test/serve.test.ts` still asserts the same nine keys and passes unchanged.
  evidence: (.reggie/tasks/graph-coverage-published/evidence/flat-route-frozen.txt) — `git diff` on that file is empty and the suite passes. The field's *meaning* changed without its name; that is captured and is under Open risks.
- [x] `packages/reggie/docs/ui-api-contract.md` documents `skipped` and `unresolved` on `counts` and states that the flat route's copies are the compatibility shape the UI does not read.
  evidence: (.reggie/tasks/graph-coverage-published/evidence/docs-diff.txt)
- [x] The `map-footer` row of `packages/reggie/ui/DOM-CONTRACT.md` and the made-of row and footer example of `packages/reggie/docs/ui-spec.md` quote the post-change wording, including the rule that the footer segment is omitted at zero.
  evidence: (.reggie/tasks/graph-coverage-published/evidence/docs-diff.txt) — each quote is printed beside the real output it claims to specify. The spec quotes the dev sample's figures, not this repo's live census, so it does not read as a regression the next time someone adds a stylesheet.
- [x] The five generated `ui/dev` samples carry `skipped` and `unresolved` from `gen-samples.mjs`, and `sample-story.json` carries a coverage paragraph whose numbers agree with `sample-container.json`.
  evidence: (.reggie/tasks/graph-coverage-published/evidence/samples.txt) — regenerated, and a machine check proves the hand-written sentence is exactly what the code renders from the container sample's counts (`IDENTICAL: true`). Two files beyond the plan's list were also updated — see Deviations 6.
- [x] `makeFixtureRepo` holds at least one file in a skipped code language and at least one in a language the graph reads, and every existing test that pins a count from that fixture passes unchanged.
  evidence: (.reggie/tasks/graph-coverage-published/evidence/tests.txt) — the fixture reports CSS 1 and Shell 1 against 59 read, and the five files that build on it all pass.
- [x] `story.test.ts` and `views.test.ts` each gain a test that fails when the coverage paragraph is deleted or when `ViewCounts` stops carrying the two fields.
  evidence: (.reggie/tasks/graph-coverage-published/evidence/mutation-probe.txt) — both probes were actually performed. Deleting the paragraph fails 3 tests; dropping the two fields fails 40 across `views.test.ts`, `story.test.ts` and `serve.test.ts`; reverting both runs green at 653 passed.
- [x] The `publish the graph's own coverage` bullet in `docs/ui-plan.md` records this task and no longer claims `unresolved` is discarded.
  evidence: (.reggie/tasks/graph-coverage-published/evidence/docs-diff.txt) — it names the slug, says what was published, and the stale half of the sentence about the symbol engine is dropped rather than restated.
- [x] Run from `packages/reggie`, `TZ=UTC npm test`, `npm run typecheck` and `npm run build` each exit 0 at the landing commit.
  evidence: (.reggie/tasks/graph-coverage-published/evidence/build.txt) — `TZ=UTC npm test` exit 0, 653 passed / 1 skipped; typecheck exit 0; build exit 0. Plain `npm test` exits 1 on one pre-existing, unrelated failure, recorded in full below.

## Evidence
- .reggie/tasks/graph-coverage-published/evidence/build.txt — both test runs, typecheck and build, with exit codes
- .reggie/tasks/graph-coverage-published/evidence/docs-diff.txt — all four documentation diffs, each quote checked against real output
- .reggie/tasks/graph-coverage-published/evidence/flat-route-frozen.txt — the flat route's key set is untouched
- .reggie/tasks/graph-coverage-published/evidence/footer-width.txt — the footer measured in a real browser at five widths; the plan's bail condition, answered
- .reggie/tasks/graph-coverage-published/evidence/footers.txt — every footer and every empty-state card, before and after
- .reggie/tasks/graph-coverage-published/evidence/made-of-rendered.txt — the section rendered, diffed, and the sentence compared character by character with the plan
- .reggie/tasks/graph-coverage-published/evidence/mutation-probe.txt — both mutations performed, with the failing test names
- .reggie/tasks/graph-coverage-published/evidence/one-rule.txt — one helper, one caller, workspace.ts untouched
- .reggie/tasks/graph-coverage-published/evidence/phrase-sweep.txt — the word "unresolved" reaches no reader
- .reggie/tasks/graph-coverage-published/evidence/samples.txt — the dev samples, regenerated, with the hand-written story machine-checked
- .reggie/tasks/graph-coverage-published/evidence/skipped-shape.txt — the shape and the sort
- .reggie/tasks/graph-coverage-published/evidence/story-diff.txt — one helper builds the whole sentence
- .reggie/tasks/graph-coverage-published/evidence/tests.txt — the tests that pin each claim, and their output
- .reggie/tasks/graph-coverage-published/evidence/this-repo-numbers.txt — the published numbers, before and after
- .reggie/tasks/graph-coverage-published/evidence/views-diff.txt — the three build sites, read for arithmetic
- .reggie/tasks/graph-coverage-published/evidence/what-the-number-counts.txt — what the published import number actually counts, in both directions

## Changes

23 files changed outside `.reggie/`. The plan named 20; the three extra are under Deviations 6.

```
 docs/ui-plan.md                                |   2 +-
 packages/reggie/docs/ui-api-contract.md        |  16 +++-
 packages/reggie/docs/ui-spec.md                |   4 +-
 packages/reggie/src/facts.test.ts              |  71 ++++++++++++++++-
 packages/reggie/src/facts.ts                   |  33 ++++++++
 packages/reggie/src/graph.test.ts              | 104 ++++++++++++++++++++++++-
 packages/reggie/src/graph.ts                   |  62 +++++++++++++--
 packages/reggie/src/story.test.ts              |  94 ++++++++++++++++++++++
 packages/reggie/src/story.ts                   |  69 +++++++++++++++-
 packages/reggie/src/views.test.ts              |  39 +++++++++-
 packages/reggie/src/views.ts                   |  18 ++++-
 packages/reggie/test/fixtures.ts               |   9 ++-
 packages/reggie/ui/DOM-CONTRACT.md             |   2 +-
 packages/reggie/ui/dev/gen-samples.mjs         |  14 +++-
 packages/reggie/ui/dev/map-harness.html        |   2 +-
 packages/reggie/ui/dev/sample-blast.json       |  17 +++-
 packages/reggie/ui/dev/sample-container.json   |  17 +++-
 packages/reggie/ui/dev/sample-dir-tests.json   |  17 +++-
 packages/reggie/ui/dev/sample-dir.json         |  17 +++-
 packages/reggie/ui/dev/sample-impact.json      |  17 +++-
 packages/reggie/ui/dev/sample-story-empty.json |   6 ++
 packages/reggie/ui/dev/sample-story.json       |   6 ++
 packages/reggie/ui/map.js                      |  42 +++++++++-
 23 files changed, 646 insertions(+), 32 deletions(-)
```

`.reggie/` also carries the amended plan, the completion packet, sixteen evidence files, eleven new
or corrected notes, nine journal entries and nine captured intake items.

## Reviews

`/code-review` at effort `high`, invoked with this worktree's absolute path as the target, because a
previous session tonight found it defaults to the parent session's directory and silently reviews the
wrong diff. **Confirmed it read this diff**: every finding names a symbol that exists only on this
branch — `coverageSentence`, `skippedLanguages`, `codeLanguageOf`, the new `describe("graph coverage")`
block — and quotes line numbers inside this worktree. It reported ten angles. What they found and how
each was resolved:

**Fixed here (correctness, all verified by probe before and after):**

1. `numberWord(0)` renders as the word "no", so a repo the graph read none of said "Reggie read **no
   of** this repo's 40 code files". Now "none of". This is the repo the whole feature exists for.
2. The all-read branch hard-coded a plural: a one-file repo said "Reggie read all **one code files**".
   Now routed through `countPhrase`, like every other count in the file.
3. A repo with no code files at all said "Reggie read all **no** code files in this repo", directly
   above the section's own paragraph saying it has none Reggie recognises — two contradictory claims
   opening the section. The helper now returns `null` at zero, in the shape `testedClause` established,
   and the caller omits the paragraph.
4. The footer said "**1 import point** at no file". The verb now agrees with the count.
5. `codeLanguageOf` indexed the language table without checking the table owned the key, so a file
   called `snapshot.constructor` returned `Object.prototype.constructor` — truthy, not in the not-code
   set, then used as a `Map` key and passed to `localeCompare`. Guarded with `Object.hasOwn`, and the
   table test now includes prototype-key filenames.
6. `totalCodeFiles` was `code.length`, the files that passed the extension filter, not the files the
   graph opened. Git lists a file that is in the index but missing from the worktree, the scan loop
   skips it, and the page could then say it had read all 140 code files having read 139. It is now the
   scanned count. A file the graph could not open is in neither side of the partition, which
   understates the repo's total rather than overstating what was read; the contract says so.
7. The empty repo map card fired on a non-empty skipped list alone. A container canvas comes back
   empty for reasons that have nothing to do with language — every area candidate folding below the
   minimum size does it, and two source files beside one stylesheet is enough — so a repo the map
   reads perfectly well would have been told "Nothing here is in a language the map reads", with a
   file count that omitted the files it did read. Now gated on the read count being zero as well.
8. The card's "mostly" asserted a remainder that did not exist when the named languages exhausted the
   skipped set. Now "N code files in X, Y and Z" when the list is complete, ", mostly X, Y and Z" when
   it is not. (Writing that fix introduced a missing comma, caught by re-running the probe.)
9. `footerFor` dereferenced `model.counts` unconditionally in the container branch, where it
   previously never touched `counts`, so a hand-built model threw. It is part of this module's
   exported surface; guarded, and `emptyMapText` twelve lines below already was.
10. The coverage paragraph's `refs` were `[repo:<name>]` alone. The map cannot resolve a `repo:` id on
    a container canvas, and the story column's reading observer passes whatever resolves to the map's
    soft highlight — so scrolling into "What it is made of" **cleared** the halo where it used to light
    the first area. A regression in the product's signature behaviour. Fixed by carrying the Level-1
    area ids too, with a test.
11. `ui/dev/sample-story-empty.json` had a made-of section the server can no longer emit. Updated to
    what the corrected code produces.
12. The new `describe("graph coverage")` block cleaned up an uninitialised `let repo`, which would
    have masked a setup failure with a TypeError. Guarded and reset.
13. `ViewCounts.skipped` is now `readonly`, and `NON_CODE_LANGUAGES` is a `ReadonlySet`: both are
    assigned by reference from one graph, and one in-place sort would have reordered every surface.
14. The unresolved dedupe key joined two unescaped fields with `>`, which is legal in both a path and
    a specifier. Now a nested map, which removes the class of bug.
15. The `codeLanguageOf` doc comment hard-coded four live census figures of this repo; they move on
    most commits. The rule is stated, the numbers are gone.
16. Documentation that contradicted the code: the contract had dropped the word "relative" from the
    import count's definition, described `totalCodeFiles` loosely, and claimed the two surfaces "can
    never disagree" when that holds inside one payload and not across two requests; the DOM contract
    said the footer is empty "when nothing is drawable", which is stronger than the code; the spec
    quoted the clause without its comma and with this repo's live figures. All four corrected.
17. **Honesty of the number itself**, which the plan did not know about: the affirmative clause
    claimed every import was followed, and the count behind it only sees specifiers written as a path.
    Verified on a throwaway repo whose four files all import through `@/` and `~/`: zero import edges,
    zero unresolved, and the old wording claiming a clean read over a map with no edges at all. The
    clause is now "and followed every import written as a path". See Deviations 2.

**Performance, on this task's own new code:** both helpers were private, so every assertion about a
pure function paid for a git repo, a graph build and a rendered story — about 862 ms on a file that
runs in four seconds. Exporting them turned the wording cases into a table and, more to the point,
made the branches that were actually broken reachable at all. `story.test.ts` is back to 3.98 s with
more cases than before. Both mutation probes still bite, which was the condition for doing it.

**The footer's width**, which is a plan bail condition: measured in a real browser against the real
stylesheets rather than argued. Every string the container branch can produce is one line at 1000 px
and above, including a worst case ten times this repo's count. The condition is not met and the task
does not bail. It costs one extra line at phone widths and reaches three only on a phone in portrait
under the tests lens with a two-digit count — below the width the condition names, and a question
about the floating card rather than this segment. Captured, with the measurements
(`evidence/footer-width.txt`).

**Not fixed, deliberately, because the plan scopes them out** — each captured instead, with the
reviewer's specific verified example:
- Making `workspace.ts` share the code/not-code rule. The plan has an acceptance criterion requiring
  that file unchanged, so editing it would fail this task's own criterion. Captured with the verified
  contradiction: a static-site repo shows a workspace tile saying it has no code files while its repo
  page one click away says it skipped nine HTML files.
- Anchoring the import scanner's regexes, improving the resolver, deriving `CODE_EXT` from the
  language table, a shared tally-and-rank, a shared list joiner, the dir-level empty card, the
  cross-request cache skew, the renamed-meaning field on the flat route, the two task-board harness
  payloads. Nine captures in all, listed under Discovered issues.

`/simplify` was **not** run, as instructed: it applies edits and could write into the serving checkout.

## Deviations from plan

1. **`coverageSentence` and `skippedLanguages` are exported, not module-local.** Criterion 8 says
   "one module-local helper". It is one helper and no other site formats any part of the sentence, so
   the criterion's substance holds, but the word "module-local" does not. The reason is the review's
   strongest lesson: four of the sentence's branches were wrong precisely because reaching them meant
   standing up a git repo, so nobody had. Exported, the degenerate cases are a table that runs in
   microseconds, and the wiring is still pinned end to end on the shared fixture.

2. **The all-clear clause is qualified: "and followed every import written as a path."** Criterion 9
   pins "and followed every import." That wording is a binding owner answer of 2026-09-15, and it is
   false for a whole class of repo. Measured: a repo whose imports all go through `@/` and `~/`
   aliases produces zero import edges and an unresolved count of zero, so the page would have made an
   affirmative clean-read claim over a map with no connections on it at all. Only specifiers starting
   with a dot are counted; the resolver also handles aliases and silently drops the ones that fail,
   and closing that gap is explicitly out of scope. A universal claim has to say what it ranges over.
   The existential branch — "N imports pointed at no file" — is unchanged and unqualified, because an
   existential claim needs no such scope; that asymmetry is deliberate. The plan already recorded one
   correction to this answer's premise; this is a second, and the owner should look at the wording.

3. **The all-clear clause agrees in number: "all one code file", not "all one code files".** Criterion
   9's `N` is still the code-file total.

4. **The coverage paragraph's `refs` are `[repo:<name>, ...Level-1 area ids]`, not `[repo:<name>]`
   alone.** The plan's Approach says the repo id. With only that, scrolling into the made-of section
   cleared the map's halo instead of lighting anything, because the map cannot resolve a `repo:` id on
   a container canvas and the story column passes whatever resolves. A repo-wide claim points at every
   area on a repo map. The general trap — a paragraph whose refs resolve to nothing clearing the halo
   rather than leaving it — is captured.

5. **The empty container card also requires that the graph read no code files.** Criterion 14 says
   "nothing drawable and a non-empty `skipped`". That is not sufficient: the canvas is empty whenever
   every area candidate folds below the minimum size, which two source files and a stylesheet already
   achieve, and the card would then have told a repo the map reads perfectly well that nothing here is
   in a language the map reads. Both halves are now required. The consequence is that a repo with some
   readable code, a non-empty skipped list and an empty canvas keeps the old text — which is also
   wrong, for a different reason, and is captured.

6. **Four files beyond the plan's twenty.** `packages/reggie/src/facts.test.ts` (the plan's own
   Verification strategy names it under criterion 4 but the file list omitted it);
   `ui/dev/sample-story-empty.json` (the server can no longer emit the shape it held, so leaving it
   would have been a harness lying about the contract); `ui/dev/map-harness.html` (the container
   harness is where the new footer segment and the new empty card are eyeballed, and its counts block
   had neither field). The plan's "Files to touch" has been amended to name all three, so the task
   page does not report untouched-but-planned or touched-but-unplanned files. `reggie plan lint`
   still passes. The two task-board harness payloads with the same gap were captured, not fixed.

7. **`totalCodeFiles` is the count of code files opened and read, not the count that passed the
   extension filter.** The plan describes it as `code.length`. See Reviews item 6: as `code.length` it
   let the page claim a complete read of files it never opened, which is the exact over-claim this
   paragraph exists to prevent. The published number for this repo is 86 either way, so no pinned
   figure moves.

No other deviation. In particular: no language was added to `CODE_EXT`, no resolver was improved,
`workspace.ts` is byte-identical, the flat route gained no field, and the dir, impact and workspace
footers are byte-identical.

## Discovered issues

Captured, not fixed. Eleven items, of which two were captured during planning and nine tonight:

1. **The import scanner reads string literals and comments**, so a test fixture can move a published
   number. Found the hard way: a new fixture string in `graph.test.ts` moved the rendered sentence
   from "two imports" to "three", and the fix was to interpolate the specifier so the file's own text
   holds no scannable call. `REQUIRE_RE` and `DYNAMIC_IMPORT_RE` are not line-anchored the way
   `ES_IMPORT_RE` is. *(slug: the-import-scanner-reads-string-literals-and-com)*
2. **Four tables answer "is this a code file", and two of them are published side by side.** Verified:
   a static-site repo shows "no code files" on its workspace tile and "Reggie read none of this repo's
   twelve code files" on its repo page, one click apart. *(four-tables-answer-is-this-a-code-file-and-two-o)*
3. **The scanner cannot see two whole classes of import** — unresolvable `@/` and `~/` aliases, and
   bare specifiers — so the count can be zero over a map with no edges.
   *(the-import-scanner-cannot-see-two-whole-classes)*
4. **The empty map card still lies to a folder**, and it is reachable in this repo today: `test/` holds
   five TypeScript files the graph read, all tests, so with the tests toggle off the card says there
   are no code files under here. Same class of falsehood, one click away.
   *(the-empty-map-card-tells-a-directory-there-are-n)*
5. **A published field changed meaning without changing its name**: `unresolved` on the flat route went
   from scanner matches to distinct pairs, and this repo's figure fell from 3 to 2 with no change to
   the repo. The serve test pins the key set only. *(a-published-field-on-the-compatibility-graph-rou)*
6. **The two surfaces cannot disagree inside one payload but can across two requests**, because the
   story and the level payloads are cached separately and neither carries its commit.
   *(the-two-surfaces-that-publish-the-repo-s-coverag)*
7. **Structural repeats and ordering traps**: two copies of the tally-and-rank, two list joiners, the
   two fields hand-copied into three counts literals, the made-of section assembling out of render
   order, and the bound-`require` duplicate de-duplicated downstream rather than at the root.
   *(several-small-structural-repeats-and-ordering-tr)*
8. **Two task-board harness payloads and one phone-width layout** left behind, with the footer
   measurements attached. *(two-dev-harness-payloads-and-one-phone-width-lay)*
9. **The language census reads an extension straight off the shared table** without checking the table
   owns the key, so a file named after a property of `Object` miscounts or crashes there; the new
   helper guards, the census does not. *(the-language-census-reads-a-file-extension-strai)*
10. **A paragraph whose refs the map cannot resolve clears the halo** rather than leaving it; fixed for
    this paragraph, still a trap for the next. *(a-paragraph-whose-references-the-map-cannot-reso)*
11. From the planning pass: `three-tables-disagree-about-what-a-code-file-is` (item 2 is its sharper,
    verified successor) and the pre-existing `src/tasks.test.ts` timezone failure.

## Open risks

**What the published import number actually counts, stated plainly rather than buried.** On this repo
it is 2, and both come from string literals inside the import-parsing unit test — `import("./dyn")`
and `require("./cjs")` at `src/graph.test.ts:372-373` — which the file-level scanner reads as real
imports because those two patterns are not anchored to a line. The number is defensible as "specifiers
written as a path that resolved to no file". The clause the sentence attaches to it, *"so the map is
missing those connections"*, **overstates it on this repo**: no real import is missing, the map is
complete, and the scanner is reading a test's data as if it were code. The wording is kept because it
is right for the general case and the plan chose it knowing where these two came from, but the owner
should see the tradeoff. Evidence: `evidence/what-the-number-counts.txt`. Captured as item 1.

**The other direction.** The count cannot see an unresolvable alias or a bare specifier at all, so on
an alias-heavy repo it reads zero while the map has no edges. The affirmative clause is now scoped so
it is not false there, but the map is still silently thin. Captured as item 3.

**A code file the graph cannot open** is in neither the read count nor the skipped list, so the repo's
code-file total can be understated by that many. That is the deliberate trade in Reviews item 6:
understating what is there rather than claiming to have read it.

**Two published surfaces disagree about what a code file is**, and this change widens the gap by
publishing the newer answer in prose. The workspace tile keeps the old, narrower one. Captured as
item 2; it needs a product decision, not a patch.

**The dir-level empty card** still says "No code files under here" to a folder that holds only
stylesheets and markup — the falsehood this change fixed for the repo map. Reachable in this repo
today. Captured as item 4.

**The footer at phone-portrait width** reaches three lines in the compound worst case, in a card with
no clamp whose bottom-left neighbour is the legend. Measured; below the width the plan's bail
condition names. Captured as item 8.

**Pre-existing test failure, unrelated and not fixed:** `src/tasks.test.ts > "assembles plan, packet,
claim, journal, and impact as a task moves"` fails under a local evening timezone because `ageInDays`
parses a bare `YYYY-MM-DD` as midnight UTC against a locally written date. `TZ=UTC npm test` exits 0
with 653 passed; plain `npm test` exits 1 with that one failure and nothing else. This branch touches
neither `tasks.ts` nor `tasks.test.ts` — `git diff --stat` on both is empty, in `evidence/build.txt`.

**How someone would notice if this is wrong.** Open the repo page: the first paragraph under "What it
is made of" should say 86 of 97 and name CSS, HTML and Shell, and the map footer should end with
"2 imports point at no file". Both numbers come from one graph in one payload, so if they ever
disagree with each other the cause is the cross-request skew in item 6, not this code.
