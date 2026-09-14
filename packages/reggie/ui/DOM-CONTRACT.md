# Reggie web UI — DOM and module contract

Binding for every file under `packages/reggie/ui/`. Shapes come from `docs/ui-api-contract.md`; behaviour from `docs/ui-spec.md`. `styles.css` owns the tokens and the classes listed here; `story.css`, `map.css`, `reader.css` and `board.css` may add module-private classes but must reuse these for anything shared.

## 1. Shell ids (`index.html`)

Every container below exists on first paint and is never replaced, only filled.

| id | What | Owner |
|---|---|---|
| `app` | Root wrapper; gets `is-map-open` on a phone when the map overlay is up | app.js |
| `header` | 48px header | app.js |
| `crumbs` | Breadcrumb `<nav>`; rendered from `story.crumbs` (`renderCrumbs`) | app.js |
| `nav` | Header navigation `<nav>`: Overview / Services / Data flow / Tasks for the current repo (`renderNav`); empty on the workspace level, hidden by CSS at ≤1100px where the header row is already full | app.js |
| `search-trigger` | "Search ⌘K" button | app.js |
| `lens` | Lens segmented control (`role=radiogroup`) | app.js |
| `lens-structure`, `lens-knowledge`, `lens-tests`, `lens-heat`, `lens-owners` | Lens buttons (`data-lens`) | app.js |
| `panes` | Pane toggles, a `role="group"` of `pane-story`, `pane-map`, `pane-code` (`aria-pressed`; the last open one is `aria-disabled`; `pane-code` hidden where code does not apply; the map label reads Board or Repos where the column is the page); hidden below 1101px | app.js |
| `rail-story`, `rail-map`, `rail-code` | Rails standing in for a collapsed pane, children of `main`; shown by CSS from `data-panes`/`data-open`; click reopens the pane | app.js |
| `story-tools` | Collapse all / Expand all (`data-sections="collapse|expand"`) at the top of `story`; hidden while `sections` is a skeleton | app.js |
| `repo-switcher`, `repo-select` | Repo switcher slot (hidden in single-repo mode) and its `<select>` | app.js |
| `main` | Flex row of panes; carries `data-level="<route level>"`, `data-map="payload|map"` (phone), and on desktop `data-panes` (the panes this level has) and `data-open` (the expanded ones), both space-separated in the order `story map code` | app.js |
| `story` | Story column | story.js / board.js |
| `spotlight` | Spotlight slot above the sections | story.js |
| `sections` | Story sections container (or the Needs-you queue on the board) | story.js / board.js |
| `mini-crumbs` | Sticky mini-breadcrumb above the canvas; the last two crumbs, only visible under 1100px | app.js |
| `map-col` | Map column (gets `is-disabled` on renderer failure, `is-loading` while a payload is in flight) | app.js |
| `map-stage` | Positioned wrapper around the canvas and its floating cards | map.js |
| `cy` | Cytoscape container (`createMap($("cy"))`); board.js hides it and mounts the board in `map-stage` | map.js / board.js |
| `toolbar` | Floating toolbar card | map.js |
| `tb-fit`, `tb-zoom-out`, `tb-zoom-in`, `tb-relayout`, `tb-tests` | Toolbar buttons; `tb-tests` carries `aria-pressed` | app.js wires, map.js acts |
| `tb-extra` | Slot for depth / direction / planned-actual controls (`display: contents`) | map.js / board.js |
| `legend` | Floating legend card (empty = hidden) | map.js |
| `map-footer` | Bottom-right counts line ("7 areas · 12 edges · 49 tests hidden") | map.js |
| `map-tip` | The single tooltip div (`.tip`, `hidden` when idle) | map.js |
| `reader` | Reader drawer container (`hidden` when closed) | reader.js |
| `palette`, `palette-backdrop`, `palette-input`, `palette-results` | Search modal | app.js |
| `toasts` | Toast region (`aria-live=polite`) | app.js |
| `icons` | Inline `<svg><symbol>` set; `#i-<name>` | — |

Icons: `repo area file symbol task person note journal entry test stale external search fit zoom-in zoom-out relayout close copy back service flow`. Use `<svg class="i"><use href="#i-file"/></svg>` (14px) or `class="i i--16"` (toolbar). In JS: `icon("file")`, `icon("fit", 16)`.

## 2. Class names (`styles.css`)

### Layout
- `.main[data-panes~=…][data-open~=…]` — the pane layout (desktop ≥1101px): the story is a flex share floored at `--story-min` and capped at its measure; the map column a share; a pane not in `data-open` is `display:none` and its `.pane-rail` shows; `data-open="map code"` turns the map column into a two-column grid; code without the map gives `.reader` the column at full height (`height: auto !important` over the drawer's inline height, handle hidden).
- `.header`, `.header__tools`, `.kbd`.
- `.main`, `.story`, `.map-col`, `.map-stage`, `.map-canvas`, `.map-footer`.
- `.tabs`, `.tabs__tab`, `.tabs__tab.is-active`.
- `.crumbs`, `.crumbs__item`, `.crumbs__item.is-muted` (greyed Workspace crumb), `.crumbs__sep`, `.crumbs__last` (page title, 22px/600).
- `.crumbs--mini` on `#mini-crumbs` — `display: none` above 1100px, a one-line crumb tail below it.
- `.nav` > `.nav__item` (`.is-active` for the level in view) — the header's page navigation.
- `.app` sets `grid-template-columns: minmax(0, 1fr)`: an `auto` track is floored by its items'
  min-content, so a long breadcrumb widened the whole page and pushed the header tools off the right
  edge. With a 0 floor the breadcrumb shrinks and ellipsises instead.

### Story
- `.sections` (62ch measure), `.section` (`id="sec-<sectionId>"`, `data-section`; `.is-collapsed` hides every child but the heading), `.section__h` (17px/600 + 1px rule) wrapping `.section__toggle` (a button with `aria-expanded` and a chevron), `.section__more` (a marker for content after the first paragraph).
- Paragraph kinds — every paragraph element carries `data-refs="<id> <id>"` (space-separated graph node ids) and `data-para="<paragraphId>"`:
  - `.para.para--fact` — plain text.
  - `.para.para--gap` — amber left border.
  - `.para.para--list` — contains a `<ul>`.
  - `.para.para--commit` — mono `.sha` chip + subject.
  - `.para.para--warn` — amber text (e.g. "No test imports this file.").
  - `.card.card--note.note--<type>` — note card; add `.is-stale` for "Possibly out of date".
  - `.card.card--journal` — journal entry card.
  - `.card.card--decision` — decision card with Approve / Needs work.
  - `.card.card--spotlight` — the Spotlight card (in `#spotlight`), with `.card__crumbs` and `.card__close`.
  - `.card.card--error` — inline error card (`errorCard()`), `.card--renderer` centres a card in the map stage, `.card--status` is the first-load card.
  - `.card.card--empty` — dashed empty-state card containing a form.
  - `.card.card--capped` — the Data flow page's "Not every step is drawn" notice: what a cap hid,
    in words, from `Flow.dropped` (`droppedSentence`). Amber left border.
  - `.card.card--flow` — one entry point on the Data flow index: `.card__title` link, its route in
    `.flow-row__route`, chips (Method / Steps / Hops / Capped), and `.flow-row__body` naming the
    file it starts in and the services it reaches.
- State classes on paragraphs/cards: `.is-reading` (IntersectionObserver), `.is-tinted` (map hover → left border `--info` 60%), `.is-hot` (background tint).
- Card internals: `.card__head`, `.card__title`, `.card__body`, `.card__chips`, `.card__actions`.
- Empty-state block: `.empty` > `.empty__text` + `.empty__hint` (command as secondary hint) + optional `.form`.
- `.hint` (12px muted, `<code>` for commands), `.muted`, `.faint`, `details.cmds` (collapsed commands).
- `.story__actions` — the "Read the source" row app.js prepends to `#sections` at the file level; `.spot__via` — the `<ul>` of file pairs app.js appends to a Spotlight pinned from an edge tap.
- `.ws-tiles` > `.ws-tile` (> `.ws-tile__name`, `.ws-tile__meta`, `.ws-tile__bar` > `.ws-tile__seg`) — the workspace tile strip, a block inside `#map-col` under `#map-stage` (map.css).

### Services and Data flow (`services-and-flows-spec.md` §4)
- `.declared` > `.declared__file` > `.declared__list` > `.declared__row` (`.declared__what`,
  `.declared__line`) — the "Declared in this repo" index at the foot of the Services story: every
  declared service grouped by the manifest that names it, with its line. It exists because the
  services story gives a paragraph only to services that carry an operation and collapses the plain
  vars into a truncated list, so a declared `[vars]` entry can otherwise never have its line printed
  (§5 acceptance 1).
- `?service=<id>` on the services route focuses one service: the map filters to it and its files, and
  the Spotlight is pinned from `/api/service?id=`. Closing the Spotlight clears the query.
- `?all=1` draws every service instead of the top of the fan-in ranking; `?tests=1` adds the files
  only tests touch; `?depth=1..6` on a flow route re-traces it at that many hops.

### Links and chips
- `.link.link--<kind>` — produced only by `entityLink()`; kinds: `repo area file symbol task person note journal entry test service flow`.
- `.chip` with `.chip__k` (label, `--faint-text`) and `.chip__v` (value); tones `.chip--ok .chip--warn .chip--bad .chip--info .chip--muted`; `.chip--code` (mono); `.chip--state.state--<taskState>` (filled state colour). `.chips` is a wrapping row.
- Task states are `ungroomed groomed planned in-process awaiting-decision done` — `grooming` is gone. `--state-planned` is the palette's violet `#bb9af7`.
- Task state utilities `.state--<state>` set `--state`; `.state-dot` draws it.
- Risk borders `.risk--low .risk--medium .risk--high .risk--unset` (left border).
- `.badge`, `.badge--new .badge--mod .badge--del` (NEW/MOD/DEL).

### Buttons and controls
- `.btn` (28px) variants: `.btn--primary .btn--ok .btn--warn .btn--bad .btn--ghost .btn--tool .btn--small .btn--link .btn--icon`. Toggles use `aria-pressed`.
- `.seg` + `.seg__btn.is-active` (segmented control), `.select`, `.range` (slider with label).

### Forms
`.form` > `.form__row`, `.form__label`, `.form__input`, `.form__textarea`, `.form__select`, `.form__actions`, `.form__error`. Forms: capture (`text`, `detail`), note (`type`, `confidence`, `text`), decide (`comment` + Approve / Needs work), journal (`text`).

### Floating cards, legend, tooltip
- `.float`, `.float--toolbar`, `.float--legend`, `.float__extra`, `.float__sep`.
- Legend: `.float--legend.is-row` — one horizontal band under the toolbar, set by map.js when the card would clip its own rows on a short canvas; `.legend__title` (names the hue channel), `.legend__row` (`.is-isolated` when isolating), `.legend__swatch` (`--ghost`, `--hollow`, `--edge`, `--edge.is-dotted`), `.legend__count`, `.legend__note`.
- Tooltip: `.tip` with `.tip__path` and `.tip__meta`.

### Loading, toasts, palette
- `.skeleton` > `.skeleton__bar` ×3 (`skeleton()` in app.js; `renderSkeleton` in story.js adds headings). `.map-col.is-loading` dims the canvas to 0.35.
- `.status-list > li.is-done` — first-load ticks.
- `.toast.toast--<ok|warn|bad|info>` inside `#toasts`; backticks in `toast()` text render as `<code>`.
- Palette: `.palette`, `.palette__backdrop`, `.palette__box`, `.palette__input`, `.palette__results`, `.palette__group`, `.palette__row` (`.is-active`, `role=option`, `data-index`), `.palette__label`, `.palette__snippet`, `.palette__empty`, `.palette__hint`.

### Board and the tasks page (shared shell; board.css owns the rest)

The tasks page is two views behind one segmented control (`docs/tasks-page-spec.md` §7): **Open**, the five
live states as columns, and **Completed**, finished work newest first. The chosen view is `?view=completed`
in the hash and is written with `replaceState`, never `setQuery` — switching views re-uses the payload in hand.

- `.board-head` (the row above the strip) > `.board-head__views` (a `.seg` of Open / Completed, buttons carrying `data-view`), `.board-head__counts`, `.board-head__toolwrap` > `.board-head__tool` (a `.seg` naming the tool every launch defaults to).
- `.board` — the Open view: **five** columns (`ungroomed groomed planned in-process awaiting-decision`), always one left-to-right row (flex, horizontal scroll, never wrapped). `done` is not a column; it is the Completed view.
- `.board__col` — one per state, `data-state="<id>"`, its own scroller; `.board__head` sticks to its top. `.board__def` carries the column's git rule as one rendered line at the narrowest column width, with the server's `definition` as its `title` and the server's full `rule` on the header; the story column does not repeat either.
- `.board__head-extra` (Ungroomed only) > `.board__shape-row` > `.board__shape` ("Shape these (n)", POSTs `/api/triage`) and a launch action for the same slugs in `triage` mode. `.board__add` > `.board__add-h` + the capture form, always visible at the top of Ungroomed.
- `.board__card` (+ `.risk--*`, `.is-reading` while its panel is open) > `.board__card-title` (with `.board__pick`, the shaping checkbox, on Ungroomed), `.board__chips`, `.board__meta`, `.board__badges`, `.board__actions`, `.board__detail` > `.detail__body` > `.detail__sec` / `.detail__chips`. One card is open board-wide; its column widens to a readable measure rather than opening a drawer elsewhere.
- `.avatar` (`.avatar--none` for an unclaimed task), `.strip` (state-machine SVG strip) + `.strip__readout` (fixed 20px slot showing the hovered/focused arrow's transition rule; arrows carry it as `<title>` and `aria-label`, never as drawn text). Clicking the strip's `done` pill switches to Completed.
- Launching: `.launch` > a `.btn` using the remembered tool, `.launch__caret`, and `.launch__menu` (`position: fixed`, placed by hand so a column's scroll box cannot clip it) > `.launch__tool` rows naming both tools. Both the button and every row carry `GET /api/launch`'s exact command as their `title`, fetched on first hover or focus. `.launch--compact` is the column-header variant. When nothing could be spawned, `.launch-cmd` > `.launch-cmd__why` + `.launch-cmd__row` > `.launch-cmd__input` holds the command to copy.
- Completed: `.completed` > `.completed__list` > `.done-row` (`.is-open`) > `.done-row__head` (`.done-row__title`, `.done-row__chips`, `.done-row__toggle`) + `.done-row__detail` > `.done-detail__body`, which draws the verdict chips, `.packet__criteria` with `.evidence-link` (or `.evidence-missing` when the packet cites proof nobody saved), `.done-files` > `.done-file` > `.done-file__stat` (`.done-file__add` / `.done-file__del`), and `.done-journal`. `.completed__empty` is its empty state.

### Reader (shared shell; reader.css owns the rest)
`.reader` on `#reader` (a 40% drawer under the map, `hidden` when closed; a full-height pane when the map is collapsed, by the pane rules in styles.css).

## 3. Link markup and refs

- Story text uses `[[route|label]]`; optional third field `[[route|label|kind]]`. `linkify(text)` (app.js) turns it into `entityLink(kind, route, label)` nodes; the kind defaults from the route shape (`/area/` → area, `/file/` → file, `/symbol/` → symbol, `/task/` or `/tasks` → task, `/person/` → person, `/repo/<name>` → repo).
- `data-refs` on paragraphs, cards, Spotlight sentences and links: space-separated graph node ids (`dir:src/components/`, `packages/reggie/src/paths.ts`, `task:<slug>`, `person:<handle>`). Hover → `map.highlight(refs)`; leave → `map.clearHighlight()`; `.is-reading` → `map.softHighlight(refs)`. Ids not on the canvas go through `map.resolveRef(id)`.
- Routes are hash routes (`#/repo/<name>/area/<path>?lens=…`); build them with `formatRoute()` or `routeForNode(repo, nodeId)`; never hand-concatenate.

## 4. Module interfaces (ES modules, `.js`, no bundler)

### `app.js` (owner of routing, cache, links, toasts, POSTs, keyboard)
Exports: `droppedSentence, h, mount, icon, $, esc, storage, parseRoute, formatRoute, routeForNode, currentRoute, navigate, setQuery, parentRoute, encodeId, api, invalidate, withRepo, errorCard, entityLink, kindForRoute, linkify, chip, chipFrom, stateChip, STATE_LABELS, GLOSSARY, CHIP_LABELS, LENSES, LENS_KEYS, toast, post, postCapture, postNote, postDecide, postJournal, state, on, emit, renderCrumbs, crumbsFor, setLens, panesFor, setPaneOpen, setSectionCollapsed, setAllSections, rendererAvailable, rendererFailureCard, RENDERER_FAILURE_TEXT, storyParams, skeleton, section, render, openPalette, closePalette, recentRoutes, unwind, boot, ensureMap, ensureReader, mapUrlFor`.
- `api(url, {fresh})` → JSON with a 10 s URL-keyed cache; throws `Error` with `.status`.
- `post(url, body)` → JSON; same-origin fetch; invalidates the `/api/` cache.
- `state.map` / `state.reader` are set by the integrator once `createMap` / `createReader` run; keyboard `F`, `T`, `1–5`, `Escape`, `Backspace` act through them.
- Events (`on(event, fn)`): `route` (parsed route), `lens` (lens id), `panes` (the open pane ids), `tests` (bool), `escape` (return `true` to stop the unwind chain).
- `ensureMap()` / `ensureReader()` create the single `createMap(#cy)` / `createReader(#reader)` instance on first use and store it on `state.map` / `state.reader`; `mapUrlFor(route)` is the map endpoint for a level (null when the level draws no graph).
- Level wiring (`renderLevel`, private): breadcrumb + `renderSkeleton` first, then `/api/story` and the level's map payload in parallel; file and symbol levels also pin `/api/explain` and add the "Read the source" button; `tasks` and `task` hand both columns to board.js. A symbol link inside `#sections` scrolls the reader instead of navigating (Level 4 is stretch).

### `map.js`
```js
export function createMap(container) → {
  show(view /* ViewGraph */, { lens, level }),   // diff by id; dagre only when the node set changed
  setLens(lens),                                  // cy.batch recolour; never re-layouts
  highlight(ids), softHighlight(ids), clearHighlight(),
  select(id), resolveRef(id) → { id, folded: boolean, label } | null,
  fit(), relayout(), zoom(factor),
  on(event /* 'hover'|'tap'|'dbltap'|'edgeTap'|'hoverEnd' */, fn) → unsubscribe,
  destroy()
}
export function legendFor(view, lens) → { title: string, rows: [{ label, color, kind, count, isolate: ids[] }] }
export function lensColor(node, lens, ctx) → css colour string
export function labelOn(fill) → "#0f1115" | "#e6e8ee" | "#ffffff" | "#000000"  // clears 4.5:1 on `fill` (§5.7)
export function edgeSentence(edge, nodeById) → string   // the one place the "mostly X (n)" wording lives
```
`labelOn` prefers `--bg` / `--text`, whichever reads better on the fill. Mid-greys clear neither
(`--area-other` #6b7280 is 3.95:1 on `--bg` and 3.74:1 on `--text`), so it falls back to pure white or
pure black; every return value clears 4.5:1. Callers must not assume the two tokens.

The Heat window is map.js's own choice, not a constant this contract pins: it decides which commit
count to colour by and `legendFor().title` names the window it used, so the legend is the only place
that has to be read for the period on screen. Nothing outside map.js may hard-code a window.

`legendFor().title` names the channel and follows the data, so it is not a fixed string per lens:
Heat names its window ("Colour = commits in 30 days"), the structure legend at the `dir` level says
"Colour = sub-area", and the file explorer says "Fill = … · Ring = direction" because direction is
that level's reserved channel under every lens. The title states what is drawn and nothing else — an
earlier build appended an implementer's caveat ("(30 days had no spread)"), which is a note about the
code, not a fact about the repo.

**The two new levels** (`services`, `flows`, `flow`) are built by `buildModel` from their own
payloads rather than from a `ViewGraph`: pass `{ level, ... }` as the view and the same `level` in the
show options. `map.show({ level: 'services', index, areas, focus?, all?, tests? })`,
`map.show({ level: 'flows', flows, services })`, `map.show({ level: 'flow', flow, services })`.
- Services is a bipartite layout computed by the builder (`layout.name = 'bipartite'`, `shaped: true`,
  so the shaping passes and `fillTarget` are skipped): the files that touch a service on the left in
  their Level-1 area compounds, the services on the right ranked by fan-in and wrapped into columns.
  Every *declared* service is drawn whatever its rank; the tail folds into `fold:services`, which the
  toolbar's "Show all" button and a tap both unfold (`?all=1`).
- Flow is dagre `rankDir: 'LR'` with `fixedDir` (a flow is not re-ranked into a column for a portrait
  pane) and `grid: true`, which deals a hop wider than `GRID_ROWS` into stacked columns inside its own
  rank. `fitWhole` on a model over 36 nodes asks `fit()` to hold the whole graph rather than clip at
  the readability floor, because at those zooms no label is drawn either way.
- Node data: `svc` (`service | file | area | step | entry | response | fold`) and `svcKind` (the
  `ServiceKind`) drive the stylesheet. Edge data: `op` (`read | write | touch`), `payload`
  (`exact | heuristic | none`) and `labelColor`. Exact payloads are solid, heuristic dotted, and
  "shape not derivable" is drawn back at 0.5 opacity — the distinction is the page.
- Exports: `SERVICE_SHAPES`, `SERVICE_NOUNS`, `OP_COLORS`, `OP_VERBS`, `MAX_SERVICE_NODES`,
  `serviceNoun`, `serviceShape`, `serviceLabel`, `declaredLine`, `payloadLabel`, `payloadClause`.

`window.__reggieMap` — a debug handle (`{ cy, getModel, getLens, fit }`) set when the instance is
created. For inspection from a browser session only; nothing in the app reads it.
When `window.cytoscape` is missing, `createMap` returns the same surface with no-ops.

### `story.js`
```js
export function renderStory(container, story /* Story */, deps /* { map, reader, repo, route, onDecide, onCapture, onNote } */)
export function renderSpotlight(container, explain /* /api/explain payload */, deps /* { map, repo, onClose, onAddNote } */)
export function renderSkeleton(container, sectionHeadings /* string[] */)
export function renderParagraph(p /* Paragraph */, deps) → Element     // link helper: one paragraph
export function sectionHeadingsFor(scope, lens) → string[]                // the fixed headings per scope (repo, area, file, task, workspace, services, flow)
export function dedupeChips(chips, seenValues?) → chips[]                 // one chip per fact
```
Every chip row goes through `dedupeChips`: chips are keyed by their canonical label ("By" and
"Written by" are one key, "Date"/"When" are one), the first wins, and a chip whose value the card
header already prints is dropped.

### `reader.js`
```js
export function createReader(container, deps /* { repo, onNotePrefill, editorScheme } */) → {
  open(path, { line?, symbols?, highlight? }), close(), scrollTo(line, endLine?), isOpen() → boolean
}
```

### `board.js`
```js
export function renderBoard(storyEl, mapEl, data /* { tasks, stateMachine, people, mode, view } */, deps /* { repo, onDecide, onCapture } */)
   → { refresh(tasks, stateMachine), setView("open"|"completed"), destroy() }
export function renderTaskPage(storyEl, mapEl, data /* /api/task/<slug> payload */, deps /* { map, repo, onDecide } */)
export const STATE_ORDER   // the six states in lifecycle order
export const OPEN_STATES   // the five the Open view columns by
export const LAUNCH_TOOLS  // ["claude", "codex"]
export function rememberedTool()   // localStorage `reggie.launch.tool`, "claude" until someone chooses
```

### Route → data
| Level | Story | Map |
|---|---|---|
| workspace | `/api/story?scope=workspace` | `/api/workspace` (plus the tile strip) |
| repo | `/api/story?scope=repo` | `/api/graph?level=container` |
| area | `/api/story?scope=area&id=<path>` | `/api/graph?level=dir&root=<path>&tests=&all=` |
| file | `/api/story?scope=file&id=<path>` + `/api/explain?id=` | `/api/impact?id=&depth=&direction=&tests=` |
| tasks | `/api/tasks` + `/api/state-machine` (+ `/api/tasks?all=1` when Completed is first shown, and `/api/task/<slug>` lazily behind each read action) | board |
| task | `/api/task/<slug>` | `/api/impact?slug=` |
| services | `/api/story?scope=services` | `/api/services` + `/api/graph?level=container` (for the Level-1 areas the file column is grouped and coloured by) |
| flows | the index is rendered by app.js from `/api/flows` (there is no `scope=flows` story) | `/api/flows` + `/api/services` (for each service's kind and shape) |
| flow | `/api/story?scope=flow&id=&depth=` | `/api/flow?id=&depth=` + `/api/services` |

## 5. Additive server field the client relies on

`view.entries` (string[], optional, set by app.js before `map.show`) — the file paths the story's
"Where it starts" section names. The graph payload carries no entry data on container nodes, so app.js
passes the story's list through and map.js attributes each path to the deepest area containing it and
draws it as the node's third label line ("▸ main.tsx", spec §2 Level 1).

`edge.top` (optional, `{ path, files }` on an aggregated `import` edge of `/api/graph`) — the file
most of the edge's weight goes to, and **how many importing files** reach it. `via` is capped at five
file pairs, so the client cannot count this itself; `edgeSentence` prints the parenthetical only when
the server supplies it or when `via` is complete, and drops the number rather than printing one in
the wrong unit. The story's "mostly for X (n)" sentence must be computed from the same figure.
map.js reads `edge.top` (the server's field name, `docs/ui-api-contract.md`) and falls back to
`edge.mostly` — the same object under the name the tooltip sentence uses — for older payloads and the
test fixtures. Reading only `mostly` is how the count went missing: nothing ever sent it, every
aggregated edge fell through to the truncated `via` sample, and the parenthetical was dropped.

`aggregates.documentedOwn` (integer, on `dir`/`repo` nodes of `/api/graph?level=container|dir`) — source files under that directory carrying a note **of their own**. `aggregates.documented` counts inherited notes too, so with one `_repo` note every area reads as 100% documented and the Knowledge lens goes flat; the container label ("N files · M% documented"), the Knowledge fill and the node tooltip all use `documentedOwn`, falling back to `documented` when it is absent (harness fixtures, `/api/workspace` tiles).
