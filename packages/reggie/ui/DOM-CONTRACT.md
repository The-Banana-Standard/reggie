# Reggie web UI — DOM and module contract

Binding for every file under `packages/reggie/ui/`. Shapes come from `docs/ui-api-contract.md`; behaviour from `docs/ui-spec.md`. `styles.css` owns the tokens and the classes listed here; `story.css`, `map.css`, `reader.css` and `board.css` may add module-private classes but must reuse these for anything shared.

## 1. Shell ids (`index.html`)

Every container below exists on first paint and is never replaced, only filled.

| id | What | Owner |
|---|---|---|
| `app` | Root wrapper; gets `is-map-open` on a phone when the map overlay is up | app.js |
| `header` | 48px header | app.js |
| `crumbs` | Breadcrumb `<nav>`; rendered from `story.crumbs` (`renderCrumbs`) | app.js |
| `nav` | Header navigation `<nav>`: primary Data flow / Tasks, then secondary Overview / Services separated by a rule (`renderNav`); empty on workspace, bottom navigation on phones | app.js |
| `idea-trigger` | The idea action's header button (first in `.header__tools`; `aria-haspopup="dialog"`, `aria-expanded`; `hidden` on the workspace and home levels; its "Idea" label shows from 1500px). Opens the `.idea` popover for the current page | idea.js |
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
| `map-footer` | Bottom-right counts line ("7 areas · 12 edges · 49 tests hidden"). On the repo map only, and only when `counts.unresolved` is positive, a last segment is appended: "7 areas · 12 edges · 49 tests hidden · 2 imports point at no file" (singular: "1 import points at no file"). Omitted entirely at zero, and never shown on the dir, impact or workspace footers, because the number is repo-wide. Empty string when the model holds no non-compound node at all — the canvas explains itself instead; a view whose every child is folded still has non-compound nodes and still renders a line | map.js |
| `map-tip` | The single tooltip div (`.tip`, `hidden` when idle) | map.js |
| `reader` | Reader drawer container (`hidden` when closed) | reader.js |
| `palette`, `palette-backdrop`, `palette-input`, `palette-results` | Search modal | app.js |
| `toasts` | Toast region (`aria-live=polite`) | app.js |
| `icons` | Inline `<svg><symbol>` set; `#i-<name>` | — |

Icons: `repo area file symbol task person note journal entry test stale external search fit zoom-in zoom-out relayout close copy back service flow idea`. Use `<svg class="i"><use href="#i-file"/></svg>` (14px) or `class="i i--16"` (toolbar). In JS: `icon("file")`, `icon("fit", 16)`.

## 2. Class names (`styles.css`)

### Layout
- `.main[data-panes~=…][data-open~=…]` — the pane layout (desktop ≥1101px): the story is a flex share floored at `--story-min` and capped at its measure; the map column a share; a pane not in `data-open` is `display:none` and its `.pane-rail` shows; `data-open="map code"` turns the map column into a two-column grid; code without the map gives `.reader` the column at full height (`height: auto !important` over the drawer's inline height, handle hidden).
- `.header`, `.header__tools`, `.kbd`.
- `.main`, `.story`, `.map-col`, `.map-stage`, `.map-canvas`, `.map-footer`.
- `.tabs`, `.tabs__tab`, `.tabs__tab.is-active`.
- `.crumbs`, `.crumbs__item`, `.crumbs__item.is-muted` (greyed Workspace crumb), `.crumbs__sep`, `.crumbs__last` (page title, 22px/600). Below 760px only the last three children (the parent crumb, its separator, the title) are shown; the parent ellipsises first and the title keeps at least six characters.
- `.crumbs--mini` on `#mini-crumbs` — `display: none` above 1100px, a one-line crumb tail below it.
- `.nav` > `.nav__item` (`.is-active` for the level in view) — the header's page navigation. Primary items use `nav__item--primary`; quieter items use `nav__item--secondary` with `nav__item--divider` on Overview. All have accessible labels even when visible labels are hidden.
- Bare `#/repo/<name>` URLs, initial repository load and workspace tiles open Data Flow. `#/repo/<name>/overview` preserves the Overview page; explicit `/flows` URLs remain valid.
- `client-flow.js` renders `#sec-client-origins` above the shared server story. A labelled native `#client-origin` selector switches source-backed client paths and upstream map nodes, without filtering server branches. `.client-flow__step` cards link symbols/files and expand actual arguments or the complete request tree. `.client-flow__conditions` shows lexical server if-conditions and `.client-flow__limits` states callback, role, state/prop and cap limitations. Values are text nodes, never HTML. `withClientJourney` projects the selected path without mutating the server response; `CLIENT EVENT` and `CLIENT EFFECT` nodes open their source file.
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
  - `.card.card--flow-step.flow-step` — one numbered flow story step: `.flow-step__number`,
    `.flow-step__summary`, `.flow-step__technical`, then collapsed `.flow-step__callee`,
    `.flow-step__inputs-detail`, and `.flow-step__returns-detail`. Input groups carry
    `data-input-kind="Arguments|Request payload|Service payload"`; recursive values reuse the
    uncapped `.value-tree` contract and retain stale, validation, description, and concept facts.
  - `#sec-possible-cleanup` — role-grouped `.cleanup-role` details with separate unreachable and
    no-reference lists, a non-deletion `.cleanup-warning`, and collapsed `.cleanup-limitations`.
- State classes on paragraphs/cards: `.is-reading` (IntersectionObserver), `.is-tinted` (map hover → left border `--info` 60%), `.is-hot` (background tint).
- Card internals: `.card__head`, `.card__title`, `.card__body`, `.card__chips`, `.card__actions`.
- Empty-state block: `.empty` > `.empty__text` + `.empty__hint` (command as secondary hint) + optional `.form`.
- `.hint` (12px muted, `<code>` for commands), `.muted`, `.faint`, `details.cmds` (collapsed commands).
- `.story__actions` — the "Read the source" row app.js prepends to `#sections` at the file level; `.spot__via` — the `<ul>` of file pairs app.js appends to a Spotlight pinned from an edge tap.
- `.ws-tiles` > `div.ws-tile` (`data-refs="repo:<name>"`, the hover cross-highlight) > `a.ws-tile__link` (the whole surface, > `.ws-tile__name`, `.ws-tile__meta`, `.ws-tile__bar` > `.ws-tile__seg`) + `button.ws-tile__idea` (`data-idea-repo`, top-right; opens `.idea` for that repo alone) — the workspace tile strip, a block inside `#map-col` under `#map-stage` (map.css). The tile is a `div` and not the link, because a button inside an `<a>` is invalid.
- The idea popover (idea.js; one per page, appended to `body`, `position: fixed`): `.idea` (`role="dialog"`, `aria-label`, `hidden` when closed) > `.idea__head` (`.idea__where`, the sentence naming the repo and the entity; `.idea__close`) + `form.form--idea` (`.idea__input`, `.idea__error`, `.idea__actions` > `.launch.idea__launch` > `.idea__go` (the main button, `.btn--primary`) + `.launch__caret.idea__caret` + `.idea__menu` (`role="menu"`, `.idea__tool` rows, absolute rather than fixed) and `.idea__hint`) + `.idea__result` (`.idea__task`, the link to the new task; `.idea__remote`, the sentence for a keyed page; then the board's `.launch-cmd` command field). Below 760px it spans the width under the header.

### Services and Data flow (`services-and-flows-spec.md` §4)

The all-flows map connects known client origins → every entry point → reached services. Unmatched endpoints remain visible; flow cards expose source links and missing/capped client evidence. Endpoint map nodes open their flow on a single click.

Flow pages default to **Clients + server**: all detected upstream paths plus the existing server trace. **Highlight client origin** changes the blue upstream edges and adjacent details, not the nodes shown. **Focus on this path** explicitly isolates the chosen browser-to-handler handoff. Shared call-site edges are deduplicated. The **← All flows** link returns to the complete entry-point index. Server story cards, depth controls, and truncation notices remain available in both modes.

Genuinely linear acyclic graphs use a responsive alternating-row layout (left-to-right, down, right-to-left); narrow panes stack. Branches, joins, cycles and disconnected graphs keep the hierarchical layout. Source strings are safe text and canonical IDs/paths are unchanged.
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
- Completed: `.completed` > `.completed__list` > `.done-row` (`.is-open`) > `.done-row__head` (`.done-row__title`, `.done-row__chips`, `.done-row__toggle`) + `.done-row__detail` > `.done-detail__body`, which draws the verdict chips, `.packet__criteria` with `.evidence-link` (or `.evidence-missing` when the packet cites proof nobody saved), `.done-files` > `.done-file` > `.done-file__stat` (`.done-file__add` / `.done-file__del`), and `.done-journal`. `.completed__empty` is its empty state. When the task has a landing merge (`completion.merge`), each `.done-file` link is a door (`?diff=<slug>`, below) and the records sentence links to the task page; without one the links stay plain file links.
- Task page, the policy report (inside `#sec-packet`, after the packet's sub-sections and **above** `.packet__decide`, only when `GET /api/task/<slug>` carries a non-null `policy`): `.policy` (`.policy--would-pass` / `.policy--refused` / `.policy--not-evaluated`, with `data-verdict`) > an `h3.task-sub` "What the policy would say", a `.hint` saying it is a report and that a person decides below, `.policy__verdict` (a Policy `.chip` toned ok / bad / muted, then `.policy__summary` with the server's sentence), `.policy__facts` (the two commits read, the completions class and where it came from, the effective risk; a second one lists `risk.unplanned` when it is not empty), `.policy__list.policy__criteria` > `.policy__row` per criterion and per review (`.packet__mark` glyph: `✓` pass, `✗` fail, `!` stale or no-evidence, `○` missing; `.policy__text` "n. text"; `.policy__who` with the status, who recorded it, with what, and when, then `why`), and `.policy__list.policy__gates` > `.policy__row[data-gate="<GateId>"]` (`.packet__mark`, `.policy__text` with the gate's title, `.policy__why` > one `.policy__reason` per reason). Every string that came out of a check record is set as a text node, never through `inline()`: a record is a file anyone on the branch can write. The block wraps long paths (`overflow-wrap: anywhere`) so the page never scrolls sideways at phone width. The decide form is unchanged and still below it; on a refused decision `.form__error` and the toast show the server's own sentence for a 409 (`decideError`), never a guess at a missing packet.
- Task page, "What changed" (`#sec-changes`, only for `in-process`, `awaiting-decision` and `done`): `.changes` (`aria-live`, a skeleton until `/api/changes` answers; an answer that arrives after the section has left the document is dropped, because the story container is shared by every task page) > `.changes__summary` (which two points the change is read between, and its size), then one of `.changes__reason` (no change to read, in the server's words), `.changes__none` (the commits left no net change, no commits yet, or only records changed), or `.change-files` > `.change-file` > `.change-file__status` (a `.badge`: `badge--new` Added, `badge--del` Deleted, `badge--mod` Modified, `badge--ren` Renamed / Copied / Type changed), the door link, `.change-file__from` for a rename, and `.change-file__stat` (`+n −n`, or `binary`). Reggie's own records follow under a `.task-sub` heading in `.change-files--records`, with the same rows. Every row links to `#/repo/<repo>/file/<path>?diff=<slug>`. A file link elsewhere on the page that may become a door carries `data-change-path`; once the list arrives, the ones whose path is in it (a "Files to touch" row, an "also changed" link) have their `href` rewritten to the door, and the rest keep the plain file link. The list is the one source of doors.

### Reader (shared shell; reader.css owns the rest)
`.reader` on `#reader` (a 40% drawer under the map, `hidden` when closed; a full-height pane when the map is collapsed, by the pane rules in styles.css).

Diff mode (`.reader.is-diff`, reader.css): the same `.reader__code` > `.reader__line` rows, drawn from `/api/filediff` instead of split from a file's text. `.reader__code--diff` holds `.reader__line--ctx`, `.reader__line--add`, `.reader__line--del` and `.reader__line--gap`. Inside `.reader__ln` the number is followed by `.reader__sign` (`+` or `−`, so colour is never the only signal; on an added or deleted row it carries `role="img"` with `aria-label` "added" / "deleted", and on an unchanged row neither); a deleted row shows its old-side number as `.reader__num--old`. Only a row with a new-side number carries `data-line` (a deleted row carries `data-old`, a gap row neither), which is what `scrollTo`, `.is-hl` and select-to-note key on. `.reader__gap` states how many unchanged lines are folded and which; it is unselectable. `.reader__flag` marks a row that was cut at 2,000 characters or is an unterminated last line. `.reader__card` (`--binary`, `--mode`, `--renamed`, `--empty`, `--symlink`, `--deleted`, `--unreadable`) sits above the rows, or alone when there are none. The head gains `.reader__mode` (the mode button) and, in `.reader__chips`, the task chip, `.reader__status` (`--added` … `--typechange`) and `.reader__counts` (`.reader__plus` / `.reader__minus`); below 1100px the chips take a row of their own in diff mode instead of disappearing. The banner holds `.reader__more` ("Show the next n rows", appends the next page under the rows already drawn) and `.reader__banner-since` (a landed file that has changed again since).

Symbol source mode (`.reader.is-symbol`) draws the `documentedDeclaration` returned by `/api/symbol` at its original line numbers. `.reader__full` switches to revision-checked `/api/source` pages and then reads “Show declaration”; `.reader__source-more` appends the next 500 lines. The first page's source revision accompanies every later request, and a 409 reloads the file from line 1 instead of mixing revisions.

Entity-page classes are `.entity-hero`, `.knowledge-panel` / `.knowledge-editor` / `.knowledge-refresh`, recursive `.value-tree` > `.value-tree__field`, `.parameter-list`, `.return-list`, `.entity-list`, `.entity-links`, `.concept-occurrence-list`, and `.concept-action`. Native `<details>` keeps deep evidence collapsed while every field remains present in the DOM. Save and Cancel are explicit; a 409 leaves the draft visible and reveals “Reload server version”. Stale current text remains visible above its fingerprint warning and explicit refresh preview.

## 3. Link markup and refs

- Story text uses `[[route|label]]`; optional third field `[[route|label|kind]]`. `linkify(text)` (app.js) turns it into `entityLink(kind, route, label)` nodes; the kind defaults from the route shape (`/area/` → area, `/file/` → file, `/symbol/` → symbol, `/task/` or `/tasks` → task, `/person/` → person, `/repo/<name>` → repo).
- `data-refs` on paragraphs, cards, Spotlight sentences and links: space-separated graph node ids (`dir:src/components/`, `packages/reggie/src/paths.ts`, `task:<slug>`, `person:<handle>`). Hover → `map.highlight(refs)`; leave → `map.clearHighlight()`; `.is-reading` → `map.softHighlight(refs)`. Ids not on the canvas go through `map.resolveRef(id)`.
- Routes are hash routes (`#/repo/<name>/area/<path>?lens=…`); symbol routes retain the full canonical ID (`#/repo/<name>/symbol/sym:<path>::<qualified-name>`), routes use `/route/route:<METHOD>:<path>`, and concepts use `/concept/concept:<slug>`. Build them with `formatRoute()` or `routeForNode(repo, nodeId)`; never hand-concatenate.
- `?diff=<slug>` on a **file** route (`#/repo/<name>/file/<path>?diff=<slug>`) asks for that task's change to the file instead of the file: the door every "What changed" row, listed "Files to touch" row and Completed-view file link opens. It is honoured on the file level only (`diffOf(route)`); a symbol route never carries it. The mode lives in the address, so a reload and the back button keep it.

## 4. Module interfaces (ES modules, `.js`, no bundler)

### `app.js` (owner of routing, cache, links, toasts, POSTs, keyboard)
Exports: `droppedSentence, h, mount, icon, $, esc, storage, parseRoute, formatRoute, routeForNode, currentRoute, navigate, setQuery, parentRoute, encodeId, api, invalidate, withRepo, errorCard, entityLink, kindForRoute, linkify, chip, chipFrom, stateChip, STATE_LABELS, GLOSSARY, CHIP_LABELS, LENSES, LENS_KEYS, toast, post, postCapture, postNote, postDecide, postJournal, state, on, emit, renderCrumbs, crumbsFor, setLens, panesFor, setPaneOpen, setSectionCollapsed, setAllSections, rendererAvailable, rendererFailureCard, RENDERER_FAILURE_TEXT, storyParams, skeleton, section, render, renderValueTree, renderSymbolEntity, renderRouteEntity, renderConceptEntity, openPalette, closePalette, recentRoutes, unwind, boot, ensureMap, ensureReader, mapUrlFor, diffOf`.
- `api(url, {fresh})` → JSON with a 10 s URL-keyed cache; throws `Error` with `.status`.
- `post(url, body)` → JSON; same-origin fetch; invalidates the `/api/` cache.
- `state.map` / `state.reader` are set by the integrator once `createMap` / `createReader` run; keyboard `F`, `T`, `1–5`, `Escape`, `Backspace` act through them.
- Events (`on(event, fn)`): `route` (parsed route), `lens` (lens id), `panes` (the open pane ids), `tests` (bool), `escape` (return `true` to stop the unwind chain).
- `ensureMap()` / `ensureReader()` create the single `createMap(#cy)` / `createReader(#reader)` instance on first use and store it on `state.map` / `state.reader`; `mapUrlFor(route)` is the map endpoint for a level (null when the level draws no graph).
- Level wiring (`renderLevel`, private): breadcrumb + skeleton first. Repo/area/file levels load story and map payloads; symbols load `/api/symbol`, a left-to-right call map, and declaration-mode source; routes and concepts load their dedicated entity payload and structured sections; `tasks` and `task` hand both columns to board.js.
- A file route with `?diff=<slug>` (`diffOf(route)`, exported): `/api/filediff` is asked first, past the fetch cache every time, and that answer is handed to the reader as `file`, which is how a branch that was sent back and fixed is never shown as it was before; the reader is opened on it without a click, on a phone too, where it brings the map overlay up. `.story__actions` reads "Read the change" and gains `.story__back`, the link back to the task. When the answer says `mapped: false` (one of Reggie's own records, a file that exists only on the branch, a deleted file) the story, impact and explain routes are **not** asked, since each would answer 404: the story column gets one plain-words section (`#sec-unmapped`) in place of an error card, no toast is raised, and the canvas is cleared with an empty impact view carrying its own sentence (`view.empty = { text, hint }`, which map.js's `emptyMapText` prefers over its own). A 404 from `/api/story` in diff mode is treated the same way. A symbol link clicked in diff mode navigates normally and lands on the plain file, because symbol lines are this checkout's and the rows are the branch's.

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
- Branching flow is dagre `rankDir: 'LR'` with `fixedDir` (a flow is not re-ranked into a column for a portrait
  pane) and `grid: true`, which deals a hop wider than `GRID_ROWS` into stacked columns inside its own
  rank. `fitWhole` on a model over 36 nodes asks `fit()` to hold the whole graph rather than clip at
  the readability floor, because at those zooms no label is drawn either way.
- A single chain uses `layout.name = 'serpentine'` with graph-derived `order`, not step-list order.
  Pure `linearChain` and `serpentinePositions` helpers are exported for geometry regression tests.
- Flow node data carries `entityKind` (`endpoint | function | method | class | file | service |
  response`) and `svc`; the three-line label is uppercase entity kind, prominent entity name, then
  path. Edge data carries `op`, `valueEvidence` (`structured | positional | none`), and
  `labelColor`; labels stay compact while the adjacent story card owns the full semantic values.
- Exports: `SERVICE_SHAPES`, `SERVICE_NOUNS`, `OP_COLORS`, `OP_VERBS`, `MAX_SERVICE_NODES`,
  `serviceNoun`, `serviceShape`, `serviceLabel`, `declaredLine`, `valueShapeLabel`, `valueForStep`.

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
export function createReader(container, deps /* { repo, fetchJson(url, { fresh }?), onNotePrefill, editorScheme, onModeChange } */) → {
  open(path, { line?, symbols?, highlight?, diff?, file?, source?, symbolSource?, full?, fresh? }), close(), scrollTo(line, endLine?), isOpen() → boolean,
  current() → { path, diff, mode: 'file'|'symbol'|'full', open, loaded, height }
}
export function diffUrl(path, slug, offset?)   // the /api/filediff address; app.js asks the same URL first so its fetch cache answers the reader
```
- `open(path, { diff: slug })` shows what task `slug` changed in the file, from `/api/filediff`, instead of the file from `/api/file`. The rows arrive built; the reader only draws them. The reader's identity is the path **plus** the diff slug **plus**, in diff mode, the two commits the change was read between (`range.base`, `range.ref`): the same path in the other mode is a reload, and the same path and slug after the branch has moved is a reload too. What is drawn is kept only when `file` (or, without one, a first page asked for with `fresh: true`) carries the same range. "Show the next rows" compares each page's range with the first page's; when the branch moved in between, the whole change is read again from the top and the banner says so, and rows of two changes are never spliced. After a page arrives, keyboard focus goes to the new button, or to the first appended row when no pages remain. Symbol marks are dropped in diff mode; `scrollTo` takes a new-side line number and says so in the banner when that line is not among the rows.
- `deps.onModeChange(slug | null)` is called by the head's mode button: `null` asks for the file as it is now, a slug asks for that change again (offered on the plain file only when a change to the same file address was just left and the reader has stayed open since; `close()` forgets it). app.js answers with `setQuery({ diff })`; without the dep the reader reopens itself.
- Select-to-note in diff mode is offered only on a file the page has a note form for (`mapped !== false`): one of Reggie's own records or a branch-only file has none, and a button that ends in "There is no note form on this page" is not offered. There it offers "Add a note about lines a–b" only when every row the selection covers has a new-side number; a deleted row or a gap row anywhere inside it offers nothing. The prefill names the task (`(lines a–b, as changed by task <slug>) `), because the numbers are the branch's and not this checkout's, and the handler's context gains `diff`.
- "Open in editor" in diff mode uses the payload's `editorUrl` alone and is hidden when that is `null`; it never falls back to `deps.root`.

### `board.js`
```js
export function renderBoard(storyEl, mapEl, data /* { tasks, stateMachine, people, mode, view } */, deps /* { repo, onDecide, onCapture } */)
   → { refresh(tasks, stateMachine), setView("open"|"completed"), destroy() }
export function renderTaskPage(storyEl, mapEl, data /* /api/task/<slug> payload */, deps /* { map, repo, onDecide } */)
export const STATE_ORDER   // the six states in lifecycle order
export const OPEN_STATES   // the five the Open view columns by
export const LAUNCH_TOOLS  // ["claude", "codex"]
export const TOOL_LABEL    // { claude: "Claude Code", codex: "Codex" }
export function rememberedTool()   // localStorage `reggie.launch.tool`, "claude" until someone chooses
export function rememberTool(tool) // writes it
export function makeLauncher(ctx /* { post, fetchJson } */) → { describe(slugs, tool, mode, paths?), run(slugs, tool, mode, { paths?, onCommand?, onLaunched?, where? }), noteFor, setNote }
export function commandField(command, reason) → Element   // the `.launch-cmd` readonly field with its Copy button
export function friendlyError(err) → string
```
`makeLauncher` is the one place that talks to `/api/launch`; `paths` on `describe` and `opts.paths` on `run` are the repo paths the pack is built around (the idea action passes the page's), and `opts.where` names in the warning toast where the command to copy went ("on the card" unless told otherwise). The five exports exist so `idea.js` composes the launcher, the copy field and the tool constants rather than copying them.

### `idea.js`
```js
export function mountIdeaTrigger()        // wires #idea-trigger, follows the `route` event (hidden off-repo, closed on leaving the page)
export function originFor(route) → { path?, symbol?, task? } | null   // area/file → path; symbol → path + symbol (the path alone when the name is not an identifier, e.g. a star re-export `*`); task → task; other repo levels → {}; workspace/home → null
export function ideaButtonFor(repo) → Element                          // button.ws-tile__idea for a workspace tile
```
The popover posts `/api/capture` with the text and the origin, then hands `[slug]` and the origin's path to `makeLauncher(ctx).run` in `discuss` mode, reading a snapshot of its target taken when the submit began; while a submit is in flight an open is shown but not re-targeted, and neither a route change nor a second trigger click closes it; the result stays until the next submit; `ctx` names the repo explicitly (`withRepo(url, repo)`) because a tile's repo is not the route's. Outcomes and the failure paths are in `docs/ui-spec.md` §3.9.

### Route → data
| Level | Story | Map |
|---|---|---|
| workspace | `/api/story?scope=workspace` | `/api/workspace` (plus the tile strip) |
| repo | `/api/story?scope=repo` | `/api/graph?level=container` |
| area | `/api/story?scope=area&id=<path>` | `/api/graph?level=dir&root=<path>&tests=&all=` |
| file | `/api/story?scope=file&id=<path>` + `/api/explain?id=` | `/api/impact?id=&depth=&direction=&tests=` |
| file with `?diff=<slug>` | `/api/filediff?slug=&path=` first (also what the reader draws, `&offset=` for later pages); then the file row's three routes, unless it answered `mapped: false` | the file row's map, or an empty impact view with its own sentence when `mapped: false` |
| tasks | `/api/tasks` + `/api/state-machine` (+ `/api/tasks?all=1` when Completed is first shown, and `/api/task/<slug>` lazily behind each read action) | board |
| task | `/api/task/<slug>`, then `/api/changes?slug=` for "What changed" when the state is `in-process`, `awaiting-decision` or `done` | `/api/impact?slug=` |
| services | `/api/story?scope=services` | `/api/services` + `/api/graph?level=container` (for the Level-1 areas the file column is grouped and coloured by) |
| flows | the index is rendered by app.js from `/api/flows` (there is no `scope=flows` story) | `/api/flows` + `/api/services` (for each service's kind and shape) |
| flow | `/api/story?scope=flow&id=&depth=` | `/api/flow?id=&depth=` + `/api/services` |

## 5. Additive server field the client relies on

`view.entries` (string[], optional, set by app.js before `map.show`) — the file paths the story's
"Where it starts" section names. The graph payload carries no entry data on container nodes, so app.js
passes the story's list through and map.js attributes each path to the deepest area containing it and
draws it as the node's third label line ("▸ main.tsx", spec §2 Level 1).

`view.empty` (optional, `{ text, hint }`, set by app.js on a view it knows is empty and why) — the sentence the
in-pane empty card shows instead of the one `emptyMapText` would derive from the level. Used by the
file page in diff mode for a path the graph never read, where "nothing imports this file" would be a
claim about imports nobody measured.

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
