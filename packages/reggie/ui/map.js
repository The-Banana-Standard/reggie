// Reggie Guidebook — map.js
// The single Cytoscape instance and its stylesheet (spec §3.4), the element builders for every level
// (§2: container map, area focus-plus-context, file explorer, blast radius, workspace repo map), the
// lenses (§2 lens table), the generated legend (§5.5), motion (§5.6) and the palette (§5.1).
//
// Vanilla ES module with no imports: app.js, story.js and board.js import from here, never the
// other way round. Inputs are ViewGraph payloads exactly as in docs/ui-api-contract.md; the
// workspace level also accepts the raw /api/workspace payload (see workspaceToView).
//
//   createMap(container, opts?) → {
//     show(view, { lens, level, tests, depth, direction, mode, task }),
//     setLens(lens), highlight(ids), softHighlight(ids), clearHighlight(),
//     select(id), resolveRef(id) → { id, folded, label } | null,
//     fit(), relayout(), zoom(factor), on(event, fn) → unsubscribe, destroy(),
//     setControls({ tests, depth, direction, mode }), getView(), isReady()
//   }
//   legendFor(view, lens) → { title, rows: [{ label, color, kind, count, isolate }] }
//   lensColor(node, lens, ctx) → css colour string  (ctx = areas[] or { areas, nodes, view })
//
// Events: hover(id, data) · leave(id) / hoverEnd(id) · tap(id, data) · dbltap(id, data) ·
//         edgeTap(edgeData) · tapBackground() · tests(bool) · depth(n) · direction(dir) ·
//         mode(planned|actual|both) · fold(id) · back() · ready(cy)

// ---------------------------------------------------------------------------
// Palette (spec §5.1) — the same hex values as styles.css tokens; Cytoscape cannot read CSS vars
// ---------------------------------------------------------------------------

export const COLORS = {
  bg: "#0f1115",
  panel: "#161a22",
  panel2: "#1c2130",
  line: "#262c38",
  lineStrong: "#3b4252",
  text: "#e6e8ee",
  muted: "#8b93a7",
  faint: "#5c6478",
  ok: "#9ece6a",
  warn: "#e0af68",
  bad: "#f7768e",
  info: "#7dcfff",
  up: "#7dcfff",
  down: "#ff9e64",
  explorerFill: "#2a3140",
  // #4b5568 measured 2.52:1 on --bg, under the 3:1 §5.1 claims for it; #5a677e is 3.30:1 (F17).
  edge: "#5a677e",
  /** Outline for the near-black semantic fills (undocumented / untested / no commits): 3.3:1 on --bg (F12). */
  shapeEdge: "#5a677e",
  edgeActive: "#ffffff",
  selection: "#ffffff",
  knowOwn: "#9ece6a",
  knowInherited: "#5f7a5a",
  knowNone: "#3b4252",
  knowStale: "#f7768e",
  areaOther: "#6b7280",
  personOther: "#9ca3af",
  /**
   * A cycle is information, not a fault. It is drawn in the ordinary edge colour with a dashed
   * stroke (see the `edge.cycle` rule) so `--bad` stays reserved for genuine problems: nine of the
   * seventeen edges on the repo map are cycle members, and painting those `--bad` made the whole
   * default landing map read as an alarm (F-MAP-04).
   */
  cycle: "#5a677e",
};
/**
 * Area hues by source-file rank, exactly the six of spec §5.1: index 0 is `--area-other` (the sixth
 * area and beyond), 1–5 are `--area-1` … `--area-5`. The ramp had been widened with #7dcfff and
 * #ef8f6b, which are the direction channel (`--up` / `--down`) wearing an area's hat, and #c3e88d,
 * which belongs to the people palette; one view then used the same colour for two different
 * meanings. Everything past the ramp falls back to slot 0, as the spec says it should.
 */
export const AREA_HUES = ["#6b7280", "#5d7bd6", "#bb9af7", "#f06fb1", "#73daca", "#d9a066"];
/** People palette, then #6b7280. */
export const PEOPLE_PALETTE = ["#7aa2f7", "#c792ea", "#ffcb6b", "#89ddff", "#f78c6c", "#c3e88d"];
/** Heat ramp, five quantile steps. */
export const HEAT_RAMP = ["#2a3140", "#3d5a99", "#7a6bb0", "#c76b8a", "#f7768e"];
/** Task-state fills, in lifecycle order (§5.1). Mirrors --state-* in styles.css. */
export const STATE_COLORS = {
  ungroomed: "#5c6478",
  groomed: "#7dcfff",
  planned: "#bb9af7",
  "in-process": "#7aa2f7",
  "awaiting-decision": "#e0af68",
  done: "#9ece6a",
};

// Heat's entry is the fallback only: the legend rewrites it with the window the view actually chose
// (see HEAT_WINDOWS), so the title, the sub-labels and the tooltips all quote the same period.
const LENS_TITLES = {
  structure: "Colour = area",
  knowledge: "Colour = documentation",
  tests: "Colour = test coverage",
  heat: "Colour = commits in 30 days",
  owners: "Colour = dominant author",
  tasks: "Colour = task",
};

const MOTION = { highlight: 180, move: 350, fit: 250 };
const MAX_DRAWABLE = 40;
const STATE_CLASSES = new Set(["hl", "soft", "dim", "up", "down", "iso"]);

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

const $ = (id) => (typeof document === "undefined" ? null : document.getElementById(id));

function reducedMotion() {
  try {
    return typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}
let motionEnabled = true;
/** Turn every animation off (tests, screenshots); `prefers-reduced-motion` does the same automatically. */
export function setMotion(enabled) {
  motionEnabled = Boolean(enabled);
}
const dur = (ms) => (!motionEnabled || reducedMotion() ? 0 : ms);

const store = {
  get(key, fallback = null) {
    try {
      const v = localStorage.getItem(key);
      return v === null ? fallback : JSON.parse(v);
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      /* quota or private mode */
    }
  },
  remove(key) {
    try {
      localStorage.removeItem(key);
    } catch {
      /* ignore */
    }
  },
};

export function positionsKey(repo, level, root) {
  return `reggie.pos.${repo || "repo"}.${level}.${root || "-"}`;
}

function trimSlash(p) {
  return String(p ?? "").replace(/\/+$/, "");
}
function basename(p) {
  const s = trimSlash(p);
  const i = s.lastIndexOf("/");
  return i < 0 ? s : s.slice(i + 1);
}
function parentSegment(p) {
  const s = trimSlash(p);
  const parts = s.split("/");
  return parts.length >= 2 ? parts[parts.length - 2] : "";
}
/** `ghost:up:dir:x/` → `dir:x/`; anything else unchanged. */
export function ghostTarget(id) {
  return String(id).replace(/^ghost:(up|down):/, "");
}
function isGhostId(id) {
  return /^ghost:(up|down):/.test(String(id));
}
function dirPathOf(id) {
  // dir:src/components/ → src/components ; repo:x → x ; dir:./ → .
  return trimSlash(String(id).replace(/^dir:/, "").replace(/^repo:/, ""));
}
function displayName(node) {
  if (!node) return "";
  if (node.kind === "dir") {
    const p = dirPathOf(node.id);
    if (node.residual && !/\(other\)$/.test(node.label ?? "")) return `${p || node.label} (other)`;
    return node.label && node.label !== basename(p) ? node.label : p === "." ? node.label || "." : p;
  }
  if (node.kind === "file") return basename(node.path ?? node.id);
  return node.label ?? node.id;
}
function pct(n, d) {
  return d > 0 ? Math.round((n / d) * 100) : 0;
}

/**
 * Source files with a note **of their own** over source files (spec §2 lens table).
 * `aggregates.documented` counts inherited notes too, so a single `_repo` note would paint every
 * container green; the server adds `documentedOwn` for exactly this. Fall back to `documented` when
 * a payload predates that field (harness fixtures, /api/workspace tiles).
 */
function documentedShare(agg) {
  if (!agg) return 0;
  const source = agg.source ?? agg.files ?? 0;
  const own = agg.documentedOwn ?? agg.documented ?? 0;
  return source > 0 ? own / source : 0;
}
/**
 * The Heat lens windows, narrowest first. Spec §2 names 30 days and that is where the lens starts,
 * but a window is only worth a colour channel when it separates the nodes on screen: on a repo whose
 * work sits further back than a month, every node lands in the same bucket and the lens draws one
 * flat colour under a legend promising commit activity. So the window widens — 30 days, then 90,
 * then a year — stopping at the first one whose ramp is occupied by three or more distinct steps.
 * The window that wins is named in the legend title, the node sub-label and the tooltip, so every
 * number on screen is over the same period and the reader is never left guessing which.
 */
export const HEAT_WINDOWS = [
  { key: "commits30", days: 30, label: "30 days", noun: "in 30 days" },
  { key: "commits90", days: 90, label: "90 days", noun: "in 90 days" },
  { key: "commits365", days: 365, label: "365 days", noun: "in 365 days" },
];
/** The window the lens starts at (spec §2); the fallback wherever no model is in hand. */
export const HEAT_WINDOW = HEAT_WINDOWS[0];
/** A window separates the visible nodes when its ramp lands them in at least this many steps. */
const HEAT_MIN_BUCKETS = 3;

function historyOf(n) {
  return n?.history ?? n?.raw?.history ?? n?.aggregates?.history ?? null;
}
/**
 * Commits on a node over one window, or `null` when the server declined to give a number.
 * `history.ts` reports a node it has nothing for as `{ commits30: null, commits90: null, … }` — an
 * object that is present and says nothing — so "not measured" has to be told apart from "measured,
 * and it is zero" everywhere the map writes a count.
 */
function commitsIn(n, key) {
  const v = historyOf(n)?.[key];
  return typeof v === "number" ? v : null;
}
function commits30Of(n) {
  return commitsIn(n, "commits30");
}
/** A node's commits over the window its model chose; 0 only where the server really said zero. */
function heatValue(nd) {
  return typeof nd?.heat === "number" ? nd.heat : 0;
}

/**
 * Whether the server reported any git history for this node at all. A residual area ("src (other)")
 * is a set of loose files with no directory of its own, and `history.ts` has nothing to aggregate
 * for it: that is "we do not know", which is a different statement from "nobody touched it in 30
 * days". The Heat lens gives it its own swatch rather than painting it the coldest step.
 *
 * The object being present is not the test. `noHistory()` is a full record of nulls, and taking that
 * for history is what drew such a node with a "0 commits" sub-label — the map asserting a number the
 * server had explicitly declined to give.
 */
function hasHistory(n) {
  const h = historyOf(n);
  return Boolean(h) && HEAT_WINDOWS.some((w) => typeof h[w.key] === "number");
}

/** How many ramp steps the given nodes actually occupy under one window. */
function heatSpread(nodes, key) {
  const values = nodes.map((n) => commitsIn(n, key)).filter((v) => typeof v === "number");
  if (!values.length) return 0;
  const t = quantileThresholds(values);
  return new Set(values.map((v) => heatStep(v, t))).size;
}
/**
 * The narrowest window that separates these nodes. When none of them does, the one that comes
 * closest — widening past a window that says no more than 30 days does would only put a larger
 * number under a longer period and still draw one colour.
 */
function chooseHeatWindow(nodes) {
  let best = HEAT_WINDOWS[0];
  let bestSpread = -1;
  for (const w of HEAT_WINDOWS) {
    const spread = heatSpread(nodes, w.key);
    if (spread >= HEAT_MIN_BUCKETS) return w;
    if (spread > bestSpread) {
      bestSpread = spread;
      best = w;
    }
  }
  return best;
}

/**
 * The commit clause a label or tooltip writes for a node. Three distinct statements, never confused:
 * the server gave no history at all, it gave a zero, or it gave a count.
 */
function commitClause(nd, compact = false) {
  const w = nd?.heatWindow ?? HEAT_WINDOW;
  if (!hasHistory(nd)) return "no history";
  const c = heatValue(nd);
  if (c === 0) return compact ? "no commits" : `no commits ${w.noun}`;
  return compact ? `${c} commit${c === 1 ? "" : "s"}` : `${c} commit${c === 1 ? "" : "s"} ${w.noun}`;
}
function authorsOf(n) {
  const a = n?.history?.authors ?? n?.aggregates?.history?.authors ?? [];
  return Array.isArray(a) ? a : [];
}
function dominantAuthor(n) {
  const a = authorsOf(n).slice().sort((x, y) => (y.share ?? 0) - (x.share ?? 0));
  return a[0] ?? null;
}
function svgUri(svg) {
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}
const NOTCH_SVG = svgUri(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 8 8"><circle cx="4" cy="4" r="3" fill="${COLORS.bad}" stroke="${COLORS.bg}" stroke-width="1"/></svg>`);
/**
 * The single-owner hatch (Owners lens). It used to be a 12px pitch of 2px lines at 0.55 alpha drawn
 * at 0.9 image opacity, which cut the label inside the node into stripes and dropped its contrast
 * below 4.5:1. A 20px pitch of 1px lines at 0.3 alpha (and 0.4 image opacity in the stylesheet)
 * still reads as "one person wrote this" while leaving the text alone.
 */
const HATCH_SVG = svgUri(
  `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 20 20"><path d="M-5 5 5 -5M0 20 20 0M15 25 25 15" stroke="${COLORS.bg}" stroke-width="1" stroke-opacity="0.3"/></svg>`,
);

/**
 * WCAG relative luminance of a #rrggbb / #rgb colour.
 */
function relLum(hex) {
  const h = String(hex || "").trim().replace("#", "");
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  if (!/^[0-9a-fA-F]{6}$/.test(full)) return 0;
  const ch = [0, 2, 4].map((i) => {
    const v = parseInt(full.slice(i, i + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
}
function contrast(a, b) {
  const la = relLum(a);
  const lb = relLum(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}
/**
 * Label colour for a solid fill (spec §5.7, >= 4.5:1): whichever of --text / --bg reads better.
 * Every coloured node fill and every filled pill goes through this — `--text` on an area hue or a
 * status colour measured as low as 1.36:1 (F03).
 */
export function labelOn(fill) {
  const dark = contrast(fill, COLORS.bg);
  const light = contrast(fill, COLORS.text);
  if (Math.max(dark, light) >= 4.5) return dark >= light ? COLORS.bg : COLORS.text;
  // Mid-greys clear neither token: `--area-other` #6b7280 measures 3.95:1 on --bg and 3.74:1 on
  // --text. Pure white takes it to 4.79:1, so the reserved hue keeps its meaning and the label
  // still clears §5.7 (F03).
  return contrast(fill, "#ffffff") >= contrast(fill, "#000000") ? "#ffffff" : "#000000";
}

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}
function quantileThresholds(values, steps = 5) {
  const v = values.filter((x) => x > 0).sort((a, b) => a - b);
  if (v.length === 0) return [];
  const out = [];
  for (let i = 1; i < steps; i += 1) {
    const idx = Math.min(v.length - 1, Math.floor((i / steps) * v.length));
    out.push(v[idx]);
  }
  return out; // thresholds for steps 1..4 (step 0 = zero commits)
}
function heatStep(value, thresholds) {
  if (!(value > 0)) return 0;
  let step = 1;
  for (const t of thresholds) if (value >= t) step += 1;
  return clamp(step, 1, HEAT_RAMP.length - 1);
}

// ---------------------------------------------------------------------------
// Workspace payload → ViewGraph
// ---------------------------------------------------------------------------

/** Turns the /api/workspace payload into a ViewGraph with kind 'repo' nodes. */
export function workspaceToView(ws) {
  if (!ws || Array.isArray(ws.nodes)) return ws;
  const repos = ws.repos ?? [];
  const nodes = repos.map((r) => ({
    id: `repo:${r.name}`,
    kind: "repo",
    label: r.name,
    path: r.path ?? "",
    parent: null,
    lang: r.primaryLanguage ?? "",
    lines: 0,
    role: "source",
    area: null,
    knowledge: { own: r.knowledge?.noted ?? 0, inherited: r.knowledge?.inherited ?? 0, stale: r.knowledge?.stale ?? 0, byType: {}, lastNoteDate: null, lowestConfidence: null },
    tasks: [],
    inDegree: 0,
    outDegree: 0,
    testedBy: [],
    entry: (r.entryPoints ?? []).length > 0,
    entryKinds: [],
    aggregates: { files: r.codeFiles ?? 0, source: r.knowledge?.source ?? r.codeFiles ?? 0, tests: 0, config: 0, lines: 0, documented: r.knowledge?.noted ?? 0, stale: r.knowledge?.stale ?? 0, testedSource: 0, tasks: [] },
    dir: "",
    noteCount: 0,
    dirNoteCount: 0,
    sub: `${r.primaryLanguage || "code"} · ${r.codeFiles ?? 0} code files`,
    repo: r,
  }));
  const strong = new Set();
  for (const e of ws.edges ?? []) if (e.kind === "depends-on") strong.add([e.source, e.target].sort().join("|"));
  const edges = [];
  for (const e of ws.edges ?? []) {
    const src = e.source.startsWith("repo:") ? e.source : `repo:${e.source}`;
    const tgt = e.target.startsWith("repo:") ? e.target : `repo:${e.target}`;
    if (e.kind === "same-org" && strong.has([e.source, e.target].sort().join("|"))) continue;
    edges.push({ source: src, target: tgt, kind: e.kind, names: e.via ? [e.via] : [], weight: 1 });
  }
  return {
    level: "workspace",
    root: "ws",
    nodes,
    edges,
    areas: [],
    cycles: [],
    counts: { totalCodeFiles: repos.reduce((s, r) => s + (r.codeFiles ?? 0), 0), shown: nodes.length, folded: 0, hiddenTests: 0 },
    generatedAt: ws.generatedAt ?? new Date().toISOString(),
    workspace: ws,
  };
}

// ---------------------------------------------------------------------------
// Model: a ViewGraph plus the encodings derived from it (pure; shared by createMap and legendFor)
// ---------------------------------------------------------------------------

function areaIndex(view) {
  const byId = new Map();
  for (const a of view?.areas ?? []) byId.set(a.id, a);
  return byId;
}

function areaOfNode(n, view, areasById) {
  if (!n) return null;
  if (n.kind === "dir" && areasById.has(n.id)) return areasById.get(n.id);
  const gid = ghostTarget(n.id);
  if (areasById.has(gid)) return areasById.get(gid);
  if (n.area && areasById.has(n.area)) return areasById.get(n.area);
  // Fall back to the longest area path that prefixes this node's path.
  const p = n.kind === "dir" ? dirPathOf(gid) : String(n.path ?? gid);
  let best = null;
  for (const a of areasById.values()) {
    const ap = dirPathOf(a.id);
    if (ap && (p === ap || p.startsWith(`${ap}/`)) && (!best || ap.length > dirPathOf(best.id).length)) best = a;
  }
  return best;
}
function areaHue(area, resolver) {
  if (!area) return AREA_HUES[0];
  if (resolver) return resolver(area);
  const h = Number(area.hue ?? 0);
  return AREA_HUES[h >= 1 && h < AREA_HUES.length ? h : 0];
}

/**
 * One palette slot per visible area (acceptance 2: the legend lists one swatch per visible area).
 * Server hues in range and not already taken are honoured; everything else — hue 0, a hue past the
 * end of the ramp, or a second area claiming a slot — is re-seated into the lowest free slot, in the
 * server's own ranking order so the assignment is stable across loads (VIEW-01).
 */
function areaHueResolver(areas) {
  const list = (areas ?? []).filter((a) => a && a.id);
  const ranked = [...list].sort((a, b) => (b.source ?? 0) - (a.source ?? 0) || (b.files ?? 0) - (a.files ?? 0) || String(a.id).localeCompare(String(b.id)));
  const taken = new Set();
  const slot = new Map();
  for (const a of ranked) {
    const h = Number(a.hue ?? 0);
    if (h >= 1 && h < AREA_HUES.length && !taken.has(h)) {
      taken.add(h);
      slot.set(a.id, h);
    }
  }
  let next = 1;
  for (const a of ranked) {
    if (slot.has(a.id)) continue;
    while (next < AREA_HUES.length && taken.has(next)) next += 1;
    if (next >= AREA_HUES.length) continue; // ramp exhausted: fall back to "other" grey
    taken.add(next);
    slot.set(a.id, next);
  }
  return (area) => AREA_HUES[slot.get(area?.id) ?? 0];
}

/**
 * Build the drawable model for a view: node/edge records with labels, sizes, layout options and the
 * data the lenses need (heat thresholds, people order). Pure; no DOM.
 */
export function buildModel(view, opts = {}) {
  // The two levels of `services-and-flows-spec.md` §4 are not import graphs: their node sets, their
  // shapes and their layouts all come from a different payload, so they are built whole rather than
  // squeezed through the graph builder below.
  const asked = opts.level ?? view?.level ?? null;
  if (asked === "services") return buildServiceModel(view, opts);
  if (asked === "flow") return buildFlowModel(view, opts);
  if (asked === "flows") return buildFlowsModel(view, opts);
  view = workspaceToView(view);
  const level = opts.level ?? view.level ?? "container";
  const root = view.root ?? (level === "container" ? "dir:./" : "-");
  const areasById = areaIndex(view);
  const hueOf = areaHueResolver(view?.areas ?? []);
  // Inside an area, colouring every child with the area's own hue spends the map's most valuable
  // channel on a fact the breadcrumb already states — ten of sixteen nodes came out the same purple
  // and the legend read "src/components 10" (F13). Level 2 colours by immediate sub-area instead:
  // one hue per sub-folder, one for the files that sit loose in the area, ghosts keep their area hue.
  const subGroupOf = (n, rootPath) => {
    if (!n || n.ghost || isGhostId(n.id)) return null;
    if (n.kind === "dir") return { key: n.id, label: lastSegment(displayName(n)) };
    const p = String(n.path ?? n.id);
    const base = rootPath && rootPath !== "." ? `${rootPath}/` : "";
    const rest = p.startsWith(base) ? p.slice(base.length) : p;
    const cut = rest.indexOf("/");
    if (cut < 0) return { key: "__loose__", label: `${rootPath ? lastSegment(rootPath) : "this area"} (loose files)` };
    return { key: `dir:${base}${rest.slice(0, cut)}/`, label: rest.slice(0, cut) };
  };
  const rawNodes = Array.isArray(view.nodes) ? view.nodes.slice() : [];
  const rawEdges = Array.isArray(view.edges) ? view.edges.slice() : [];
  const byId = new Map(rawNodes.map((n) => [n.id, n]));
  const primaryTask = opts.task ?? opts.slug ?? view.task ?? (view.centers ? rawNodes.find((n) => n.center && n.task)?.task ?? null : null);
  const isBlast = level === "impact" && Array.isArray(view.centers);

  // Root compound for the area level.
  let compoundId = null;
  if (level === "dir") {
    compoundId = root;
    if (!byId.has(root)) {
      const rootArea = areasById.get(root) ?? null;
      const synthesized = {
        id: root,
        kind: "dir",
        label: rootArea?.label ?? dirPathOf(root),
        path: dirPathOf(root),
        parent: null,
        area: rootArea?.id ?? null,
        role: "source",
        lines: 0,
        knowledge: { own: 0, inherited: 0, stale: 0, byType: {}, lastNoteDate: null, lowestConfidence: null },
        tasks: [],
        aggregates: { files: rootArea?.files ?? 0, source: rootArea?.source ?? 0, tests: 0, config: 0, lines: 0, documented: 0, stale: 0, testedSource: 0, tasks: [] },
        synthesized: true,
      };
      rawNodes.unshift(synthesized);
      byId.set(root, synthesized);
    }
  }

  // Duplicate basenames get the parent segment prefixed (§5.5 rule 3).
  const baseCount = new Map();
  for (const n of rawNodes) {
    if (n.kind !== "file" || n.ghost) continue;
    const b = basename(n.path ?? n.id);
    baseCount.set(b, (baseCount.get(b) ?? 0) + 1);
  }

  // Size scales from the visible set.
  const dirNodes = rawNodes.filter((n) => n.kind === "dir" && !n.ghost && n.id !== compoundId);
  const srcCounts = dirNodes.map((n) => Math.sqrt(Math.max(0, n.aggregates?.source ?? n.aggregates?.files ?? 0)));
  const srcMin = srcCounts.length ? Math.min(...srcCounts) : 0;
  const srcMax = srcCounts.length ? Math.max(...srcCounts) : 0;
  const fanIns = rawNodes.filter((n) => n.kind === "file").map((n) => Math.sqrt(Math.max(0, n.inDegree ?? 0)));
  const fanMax = fanIns.length ? Math.max(...fanIns) : 0;

  // Heat thresholds and people order for the lenses.
  const drawable = rawNodes.filter((n) => !n.ghost && n.kind !== "fold" && n.id !== compoundId);
  // Nodes the server has no history for are left out of every heat calculation: including them
  // would drag the window choice, the thresholds and the modal value toward zero on the strength of
  // a number nobody measured.
  const measured = drawable.filter(hasHistory);
  // 30 days first, widened only as far as it takes to tell these nodes apart (see chooseHeatWindow).
  const heatWindow = chooseHeatWindow(measured);
  // Five quantile steps over the visible nodes' commits in that window (spec §5.1).
  const heatThresholds = quantileThresholds(measured.map((n) => commitsIn(n, heatWindow.key)));
  // Every node carries the count for that window, so the fill, the label line, the legend and the
  // tooltip all quote the same number over the same period.
  const heatOf = (n) => commitsIn(n, heatWindow.key);
  const heatModal = (() => {
    const counts = new Map();
    for (const n of measured) counts.set(heatOf(n), (counts.get(heatOf(n)) ?? 0) + 1);
    let mode = null;
    let best = 0;
    for (const [v, c] of counts) if (c > best) { best = c; mode = v; }
    return { value: mode, share: measured.length ? best / measured.length : 0 };
  })();
  const heatCtx = { window: heatWindow, modal: heatModal };
  const peopleLines = new Map();
  for (const n of drawable) {
    const a = dominantAuthor(n);
    if (!a) continue;
    const key = a.handle || a.email || a.name;
    const prev = peopleLines.get(key) ?? { handle: key, name: a.name ?? key, lines: 0, nodes: 0 };
    prev.lines += a.lines ?? 0;
    prev.nodes += 1;
    peopleLines.set(key, prev);
  }
  const people = Array.from(peopleLines.values())
    .sort((a, b) => b.lines - a.lines || a.handle.localeCompare(b.handle))
    .map((p, i) => ({ ...p, color: PEOPLE_PALETTE[i] ?? COLORS.personOther }));
  const peopleById = new Map(people.map((p) => [p.handle, p]));

  const cycleSets = (view.cycles ?? []).map((c) => new Set(c));
  const inSameCycle = (a, b) => cycleSets.some((s) => s.has(a) && s.has(b));

  // The lens drives the second label line, so the map never claims "0% documented" under the Tests
  // legend (F06). Entry points come in on `view.entries` — the same list the story's "Where it
  // starts" section names — and are attributed to the deepest area that contains them (F15).
  const lensKey = opts.lens ?? view.lens ?? "structure";
  const entriesByNode = assignEntries(rawNodes, view.entries);

  // Sub-area palette for Level 2. The ramp holds five hues and it is never spent twice: an area with
  // eight sub-folders used to wrap back to the start, so the legend swatch reading "Layout" was also
  // the fill of the Terminal node and the one reading "TasksViewer" was also ActivityBar — a legend
  // naming a colour two different nodes wear is worse than no legend at all (F-MAP-08). Past the
  // fifth, a sub-area takes the neutral `--area-other` and shares the single "Other sub-areas" row:
  // a grey that names no sub-area cannot mislabel one, and every sub-area node prints its own name
  // inside the shape anyway. The five hues go to the biggest groups, ties broken by key so the
  // assignment is stable across loads — the same ranking level 1 uses for areas.
  const subHue = new Map();
  const subLabels = new Map();
  if (level === "dir") {
    const rootPath = dirPathOf(compoundId ?? root);
    const keys = [];
    const groupSize = new Map();
    for (const n of rawNodes) {
      if (n.id === compoundId) continue;
      const g = subGroupOf(n, rootPath);
      if (!g) continue;
      subLabels.set(g.key, g.label);
      groupSize.set(g.key, (groupSize.get(g.key) ?? 0) + 1);
      if (!keys.includes(g.key)) keys.push(g.key);
    }
    // Loose files belong to no sub-folder, so `--area-other` is what they have always meant.
    for (const k of keys) subHue.set(k, AREA_HUES[0]);
    const ordered = keys
      .filter((k) => k !== "__loose__")
      .sort((a, b) => (groupSize.get(b) ?? 0) - (groupSize.get(a) ?? 0) || a.localeCompare(b));
    ordered.slice(0, AREA_HUES.length - 1).forEach((k, i) => subHue.set(k, AREA_HUES[i + 1]));
  }

  const nodes = [];
  for (const n of rawNodes) {
    const ghost = Boolean(n.ghost) || isGhostId(n.id);
    const kind = n.kind ?? (ghost ? "dir" : "file");
    const area = areaOfNode(n, view, areasById);
    const sub = level === "dir" && n.id !== compoundId ? subGroupOf(n, dirPathOf(compoundId ?? root)) : null;
    const hue = sub && subHue.has(sub.key) ? subHue.get(sub.key) : areaHue(area, hueOf);
    const isCompound = n.id === compoundId;
    const agg = n.aggregates ?? null;
    const source = agg?.source ?? agg?.files ?? 0;
    let label = displayName(n);
    let fullLabel = null; // set when a node is titled by something other than displayName (Level 1 areas)
    let labelLine1 = null; // set on the nodes whose second line follows the lens (F06)
    let labelCompact = false; // sub-areas are 96px wide: no room for the file count as well
    let entryLine = "";
    let w = 0;
    let h = 0;
    let size = 0;
    let shape = "ellipse";
    if (kind === "repo") {
      w = 200;
      h = 72;
      shape = "round-rectangle";
      label = `${n.label ?? basename(n.id)}\n${n.sub ?? `${n.lang || "code"} · ${agg?.files ?? 0} code files`}`;
    } else if (ghost) {
      w = 96;
      h = 40;
      shape = "round-rectangle";
      const files = n.filesUsed ?? n.aggregates?.files ?? null;
      const nm = n.label && /·/.test(n.label) ? n.label : `${area?.label ?? dirPathOf(ghostTarget(n.id))}${files != null ? ` · ${files} files used` : ""}`;
      label = nm;
    } else if (kind === "fold") {
      w = 104;
      h = 36;
      shape = "round-rectangle";
      const count = n.foldCount ?? n.foldIds?.length ?? 0;
      label = n.label && /^\+/.test(n.label) ? n.label : level === "impact" && area ? `+${count} more in ${area.label}` : `+${count} more`;
    } else if (level === "call") {
      w = Math.max(170, Math.min(270, 90 + String(n.label ?? n.id).length * 3));
      h = 58;
      shape = "round-rectangle";
      label = n.label ?? displayName(n);
    } else if (kind === "task") {
      w = 44;
      h = 44;
      shape = "diamond";
      label = n.label ?? n.id.replace(/^task:/, "");
    } else if (kind === "dir" && isCompound) {
      shape = "round-rectangle";
      label = dirPathOf(n.id) === "." ? n.label ?? "." : dirPathOf(n.id);
    } else if (kind === "dir" && level === "container") {
      shape = "round-rectangle";
      // Level 1 nodes are areas: use the AreaRef label so the map, the legend and the story agree
      // (graph.ts labels a manifest directory with its package name, e.g. src-tauri -> reggie_lib).
      fullLabel = area?.label ?? displayName(n);
      const s = Math.sqrt(Math.max(0, source));
      w = srcMax > srcMin ? 120 + ((s - srcMin) / (srcMax - srcMin)) * 100 : 170;
      // Entry markers (§2 Level 1, §5.4): "▸ main.tsx" as a third line, and the room to draw it (F15).
      entryLine = entryLabel(n) || basename(entriesByNode.get(n.id) ?? "");
      h = entryLine ? 78 : 64;
      labelLine1 = fullLabel;
      label = `${labelLine1}\n${subLine({ aggregates: agg, commits30: commits30Of(n), heat: heatOf(n), heatWindow, history: n.history ?? agg?.history ?? null, author: dominantAuthor(n) }, lensKey, false, heatCtx)}${entryLine ? `\n▸ ${entryLine}` : ""}`;
    } else if (kind === "dir") {
      // Sub-area inside the compound (or at impact/workspace level). The label is the last path
      // segment only — the full path lives in the tooltip. The node widens to hold that segment and
      // wraps it onto a second line rather than cutting it, so one directory never shows up under
      // two different names on one screen (F-MAP-06).
      shape = "round-rectangle";
      const nm = nameLines(lastSegment(displayName(n)), 96, 168);
      w = nm.w;
      h = 44 + (nm.lines.length - 1) * 15;
      labelLine1 = nm.lines.join("\n");
      labelCompact = true;
      label = `${labelLine1}\n${subLine({ aggregates: agg, commits30: commits30Of(n), heat: heatOf(n), heatWindow, history: n.history ?? agg?.history ?? null, author: dominantAuthor(n) }, lensKey, true, heatCtx)}`;
    } else {
      // file
      const b = basename(n.path ?? n.id);
      label = baseCount.get(b) > 1 ? `${parentSegment(n.path ?? n.id)}/${b}` : b;
      const fi = Math.sqrt(Math.max(0, n.inDegree ?? 0));
      // §5.5.5 puts file nodes on a 16–40px sqrt(fan-in) ramp. On the explorer a 16px dot fitted at
      // 0.5 zoom is an 8px speck, so the level that is *about* a handful of neighbours draws them no
      // smaller than 18px and lets the viewport pan instead of shrinking further (F2).
      const floor = level === "impact" ? 18 : 16;
      size = fanMax > 0 ? floor + (fi / fanMax) * (40 - floor) : Math.max(20, floor);
      if (n.center || (Array.isArray(view.centers) && view.centers.includes(n.id))) size = Math.max(size, 24);
      w = size;
      h = size;
    }
    let parent = null;
    if (level === "dir" && !isCompound && !ghost) parent = compoundId;
    else if (isBlast && n.area && opts.areaCompounds !== false && kind === "file") parent = `area:${n.area}`;

    const hop = n.hop ?? (n.center ? 0 : null);
    const center = Boolean(n.center) || (Array.isArray(view.centers) && view.centers.includes(n.id)) || (level === "impact" && view.center === n.id);
    const side = n.side ?? (center ? "center" : null);
    nodes.push({
      id: n.id,
      kind,
      label,
      fullLabel: fullLabel ?? displayName(n),
      path: n.path ?? (kind === "dir" ? dirPathOf(ghostTarget(n.id)) : n.id),
      parent,
      compound: isCompound,
      ghost,
      side,
      hop,
      center,
      planned: Boolean(n.planned),
      actual: Boolean(n.actual),
      task: n.task ?? null,
      otherTask: Boolean(n.task && primaryTask && n.task !== primaryTask),
      collision: Array.isArray(n.collision) ? n.collision : [],
      foldCount: n.foldCount ?? n.foldIds?.length ?? 0,
      foldIds: n.foldIds ?? [],
      role: n.role ?? "source",
      area: area?.id ?? n.area ?? null,
      areaLabel: area?.label ?? null,
      subGroup: sub?.key ?? null,
      subLabel: sub ? subLabels.get(sub.key) ?? sub.label : null,
      hue,
      w,
      h,
      size,
      shape,
      lines: n.lines ?? 0,
      lang: n.lang ?? "",
      knowledge: n.knowledge ?? null,
      aggregates: agg,
      history: n.history ?? agg?.history ?? null,
      commits30: commits30Of(n),
      heat: heatOf(n),
      heatWindow,
      author: dominantAuthor(n),
      inDegree: n.inDegree ?? 0,
      outDegree: n.outDegree ?? 0,
      testedBy: n.testedBy ?? [],
      entry: Boolean(n.entry) || Boolean(entryLine),
      entryKinds: n.entryKinds ?? [],
      labelLine1,
      labelCompact,
      entryLine,
      tasks: n.tasks ?? [],
      state: n.state ?? null,
      raw: n,
    });
  }
  // Area compounds for orientation in the blast radius (§3.7).
  if (isBlast && opts.areaCompounds !== false) {
    const seen = new Set();
    for (const nd of nodes) {
      if (!nd.parent || !nd.parent.startsWith("area:") || seen.has(nd.parent)) continue;
      seen.add(nd.parent);
      const area = areasById.get(nd.parent.slice(5)) ?? null;
      nodes.push({
        id: nd.parent,
        kind: "dir",
        label: area?.label ?? dirPathOf(nd.parent.slice(5)),
        fullLabel: area?.label ?? dirPathOf(nd.parent.slice(5)),
        path: dirPathOf(nd.parent.slice(5)),
        parent: null,
        compound: true,
        ghost: false,
        side: null,
        hop: null,
        center: false,
        planned: false,
        actual: false,
        task: null,
        otherTask: false,
        collision: [],
        foldCount: 0,
        foldIds: [],
        role: "source",
        area: area?.id ?? nd.parent.slice(5),
        areaLabel: area?.label ?? null,
        hue: areaHue(area, hueOf),
        w: 0,
        h: 0,
        size: 0,
        shape: "round-rectangle",
        lines: 0,
        lang: "",
        knowledge: null,
        aggregates: null,
        history: null,
        commits30: null,
        heat: null,
        heatWindow,
        author: null,
        inDegree: 0,
        outDegree: 0,
        testedBy: [],
        entry: false,
        entryKinds: [],
        tasks: [],
        state: null,
        raw: null,
      });
    }
  }
  nodes.sort((a, b) => a.id.localeCompare(b.id));
  const nodeById = new Map(nodes.map((n) => [n.id, n]));
  // Level 3 draws spokes from the centre first; everything else is a background link (F10).
  const centerIds = new Set(level === "impact" ? nodes.filter((n) => n.center).map((n) => n.id) : []);

  const weights = rawEdges.map((e) => Math.max(1, e.weight ?? 1));
  const maxW = weights.length ? Math.max(...weights) : 1;
  const edges = [];
  const seenEdge = new Set();
  for (const e of rawEdges) {
    if (!nodeById.has(e.source) || !nodeById.has(e.target)) continue;
    const kind = e.kind ?? "import";
    const id = `${e.source}->${e.target}:${kind}`;
    if (seenEdge.has(id)) continue;
    seenEdge.add(id);
    const weight = Math.max(1, e.weight ?? 1);
    const cycle = Boolean(e.cycle) || inSameCycle(e.source, e.target);
    let width = maxW > 1 ? 1.5 + (6 * Math.log(weight)) / Math.log(maxW) : 1.5;
    // A cycle is drawn dashed in the ordinary edge colour, so it needs no width of its own; capping
    // it here (a leftover from when cycles were thick and red) would have cost the weight channel its
    // top half on exactly the edges that carry the most imports.
    if (kind === "tests") width = 1;
    const names = Array.isArray(e.names) ? e.names : [];
    let label = "";
    if (kind === "ipc") label = `IPC · ${names.length || weight}`;
    else if (kind === "depends-on") label = e.via ?? names[0] ?? "";
    else if (kind === "same-org" || kind === "tests") label = "";
    else if (weight >= 2) label = String(weight);
    const s = nodeById.get(e.source);
    const t = nodeById.get(e.target);
    let sideColor = COLORS.edge;
    if (level === "impact") {
      const sideOf = (nd) => (nd.center ? "center" : nd.side);
      const ss = sideOf(s);
      const ts = sideOf(t);
      const downish = ss === "down" || ts === "down" || (ss === "center" && ts !== "up") ;
      const upish = ss === "up" || (ts === "center" && ss !== "down") || ts === "up";
      sideColor = upish && !downish ? COLORS.up : downish ? COLORS.down : COLORS.edge;
      if (ss === "both" || ts === "both") sideColor = upish ? COLORS.up : COLORS.down;
    }
    edges.push({
      id,
      source: e.source,
      target: e.target,
      kind,
      weight,
      names,
      via: Array.isArray(e.via) ? e.via : [],
      confidence: e.confidence ?? "exact",
      cycle,
      cycleReturn: false,
      spoke: centerIds.size === 0 || centerIds.has(e.source) || centerIds.has(e.target),
      width,
      label,
      sideColor,
      raw: e,
    });
  }
  edges.sort((a, b) => a.id.localeCompare(b.id));
  markCycleReturns(edges, cycleSets);

  const counts = view.counts ?? {};
  const hiddenTests = counts.hiddenTests ?? 0;
  const testsShown = nodes.some((n) => n.role === "test" && !n.ghost);
  const layout = layoutFor(level, edges.length > 0);

  return {
    view,
    level,
    root,
    compoundId,
    areasById,
    nodes,
    nodeById,
    edges,
    heatThresholds,
    heatWindow,
    heatCtx,
    people,
    peopleById,
    primaryTask,
    isBlast,
    hiddenTests,
    testsShown,
    counts,
    layout,
    opts,
  };
}

/**
 * Mark one edge per cycle as the return edge, so a cycle is announced once (with a small ↺) instead
 * of painting every member edge as an alarm (spec §5.1 as amended by F14).
 */
function markCycleReturns(edges, cycleSets) {
  for (const set of cycleSets) {
    const order = Array.from(set);
    const index = new Map(order.map((id, i) => [id, i]));
    const members = edges.filter((e) => e.cycle && set.has(e.source) && set.has(e.target));
    if (!members.length) continue;
    const back = members.find((e) => (index.get(e.source) ?? 0) > (index.get(e.target) ?? 0)) ?? members[members.length - 1];
    back.cycleReturn = true;
    back.label = back.label ? `${back.label} ↺` : "↺";
  }
}

/** 13px system text averages ~6.6px per character; a node's text box is its width less 14px of padding. */
const CHAR_PX = 6.6;
const fitsIn = (text, px) => String(text ?? "").length * CHAR_PX <= px;

/**
 * Split a single unbreakable token into two lines at the most natural boundary near the middle — a
 * path separator, a dash/underscore/dot, or a camelCase hump — so `WorkspaceOverview` becomes
 * "Workspace / Overview" rather than `WorkspaceOv…`.
 */
function splitToken(text, maxChars) {
  const s = String(text ?? "");
  const mid = Math.ceil(s.length / 2);
  const cuts = [];
  for (let i = 1; i < s.length; i += 1) {
    if (/[/\-_.]/.test(s[i - 1])) cuts.push(i);
    else if (/[a-z0-9]/.test(s[i - 1]) && /[A-Z]/.test(s[i])) cuts.push(i);
  }
  const usable = cuts.filter((i) => i <= maxChars && s.length - i <= maxChars);
  const at = usable.length ? usable.reduce((a, b) => (Math.abs(b - mid) < Math.abs(a - mid) ? b : a)) : Math.min(maxChars, mid);
  return [s.slice(0, at), s.slice(at)];
}

/**
 * The name lines a container node draws, and the width it needs to draw them. Cytoscape's `wrap`
 * only breaks at whitespace, so a long single token used to be cut to fit a fixed 96px node — and
 * the same directory then appeared as `WorkspaceOv…` on the canvas and `WorkspaceOverview` in the
 * legend and the sidebar, two names for one thing on one screen (F-MAP-06). Now the node widens to
 * hold the name, and only a name too long even for the widened node wraps onto a second line.
 * Nothing is ever truncated; the full path is in the tooltip either way.
 */
function nameLines(text, minW, maxW) {
  const s = String(text ?? "");
  const inner = (px) => px - 14;
  if (fitsIn(s, inner(minW))) return { lines: [s], w: minW };
  const wide = Math.min(maxW, Math.ceil(s.length * CHAR_PX) + 14);
  if (fitsIn(s, inner(wide))) return { lines: [s], w: wide };
  const [a, b] = splitToken(s, Math.floor(inner(maxW) / CHAR_PX));
  const need = Math.ceil(Math.max(a.length, b.length) * CHAR_PX) + 14;
  return { lines: [a, b], w: clamp(need, minW, maxW) };
}

/** Last path segment of a label ("src/components/WorkspaceOverview" -> "WorkspaceOverview"). */
function lastSegment(label) {
  const s = trimSlash(label);
  if (!s || s === ".") return label;
  const i = s.lastIndexOf("/");
  return i < 0 ? s : s.slice(i + 1);
}

/**
 * Second label line for a container (spec §2 Level 1). It follows the active lens so the label and
 * the legend always describe the same variable; `compact` drops the file count for sub-areas, whose
 * node is only 96px wide.
 */
function subLine(nd, lens, compact, heat = null) {
  const agg = nd.aggregates ?? {};
  const source = agg.source ?? agg.files ?? 0;
  const files = `${source} file${source === 1 ? "" : "s"}`;
  const join = (extra) => (compact ? extra : `${files} · ${extra}`);
  switch (lens) {
    case "tests":
      return join(`${pct(agg.testedSource ?? 0, source)}% tested`);
    case "heat": {
      // "no history" and "no commits" are different statements and the label makes both, never the
      // second in place of the first.
      if (!hasHistory(nd)) return join("no history");
      const c = heatValue(nd);
      // A three-line label that repeats the modal value on every node says nothing; only the nodes
      // that differ from the crowd spend a line on the metric (F5).
      if (heat?.modal && heat.modal.share >= 0.5 && c === heat.modal.value) return files;
      return join(commitClause({ ...nd, heatWindow: nd.heatWindow ?? heat?.window }, compact));
    }
    case "owners": {
      const a = nd.author ?? null;
      return join(a ? `mostly ${a.handle ?? a.name}` : "no history");
    }
    case "knowledge":
      return join(`${Math.round(documentedShare(agg) * 100)}% documented`);
    default:
      return compact ? files : `${files} · ${Math.round(documentedShare(agg) * 100)}% documented`;
  }
}

/** The label a node carries under `lens`; nodes without a lens-driven line keep the one they got. */
function nodeLabel(nd, lens, heat = null) {
  if (!nd.labelLine1) return nd.label;
  return `${nd.labelLine1}\n${subLine(nd, lens, Boolean(nd.labelCompact), heat)}${nd.entryLine ? `\n▸ ${nd.entryLine}` : ""}`;
}

/**
 * Attribute each entry-point path to the deepest directory node that contains it, so an area can
 * draw "▸ main.tsx" (spec §2 Level 1). `entries` is optional; without it nothing is marked.
 */
function assignEntries(rawNodes, entries) {
  const out = new Map();
  const list = Array.isArray(entries) ? entries.filter((e) => typeof e === "string" && e) : [];
  if (!list.length) return out;
  const dirs = rawNodes.filter((n) => n.kind === "dir" || n.kind === "repo");
  for (const e of list) {
    let best = null;
    let bestLen = -1;
    for (const n of dirs) {
      const base = trimSlash(n.path ?? dirPathOf(n.id));
      const pre = base && base !== "." ? `${base}/` : "";
      if (pre && !e.startsWith(pre)) continue;
      if (pre.length > bestLen) {
        best = n;
        bestLen = pre.length;
      }
    }
    if (!best) continue;
    const cur = out.get(best.id);
    if (!cur || e.length < cur.length) out.set(best.id, e);
  }
  return out;
}

function entryLabel(n) {
  const raw = n.entries ?? n.entryFiles ?? null;
  if (Array.isArray(raw) && raw.length) return basename(raw[0]);
  if (typeof n.entryFile === "string") return basename(n.entryFile);
  if (n.entry && n.kind === "file") return basename(n.path ?? n.id);
  if (n.entry && typeof n.entryLabel === "string") return n.entryLabel;
  if (n.entry && Array.isArray(n.entryKinds) && n.entryKinds.length) return n.entryKinds.map((k) => k.kind).join(", ");
  return "";
}

function layoutFor(level, hasEdges) {
  const base = { name: "dagre", rankDir: "TB", ranker: "network-simplex", nodeDimensionsIncludeLabels: true, fit: false, animate: true, animationDuration: dur(MOTION.move), animationEasing: "ease-out", padding: 30, spacingFactor: 1 };
  switch (level) {
    case "container":
      return { ...base, rankSep: 90, nodeSep: 40 };
    case "dir":
      return { ...base, rankSep: 70, nodeSep: 28 };
    case "impact":
      return { ...base, rankSep: 64, nodeSep: 24 };
    case "call":
      return { ...base, rankDir: "LR", rankSep: 86, nodeSep: 32 };
    case "workspace":
      return hasEdges ? { ...base, rankDir: "LR", rankSep: 80, nodeSep: 48 } : { name: "row", gap: 48 };
    default:
      return { ...base, rankSep: 70, nodeSep: 28 };
  }
}

// ---------------------------------------------------------------------------
// Lenses (spec §2 lens table): paint(model, lens) → per node { fill, border, bw, bgOpacity, classes }
// ---------------------------------------------------------------------------

/**
 * Spec §5.1: own = --ok, inherited = #5f7a5a, none = #3b4252, stale drawn as a --bad notch. The
 * partial step used to be --warn, which put the warning colour on the one area that *did* have
 * documentation and meant the "documented" green never appeared at all (F7). Partial now shares the
 * inherited green, so the ramp reads none → some → plenty in one hue.
 */
const KNOWLEDGE_FILL = { documented: COLORS.knowOwn, partly: COLORS.knowInherited, inherited: COLORS.knowInherited, undocumented: COLORS.knowNone };

function knowledgeFill(nd) {
  return KNOWLEDGE_FILL[knowledgeClass(nd)] ?? COLORS.knowNone;
}

/**
 * Knowledge classes (spec §2 lens table). Containers go by the share of their source files carrying a
 * note of their own; a container that has a note of its own and some documented files is "partly"
 * (amber) even below the 20% step, so a folder somebody wrote about never reads as untouched.
 */
function knowledgeClass(nd) {
  const k = nd.knowledge ?? {};
  if (nd.kind === "dir" || nd.kind === "repo") {
    const agg = nd.aggregates ?? {};
    const share = documentedShare(agg);
    if (!(agg.source ?? agg.files) && (k.own ?? 0) > 0) return "documented";
    // Three stops on documented share (§5.1 as amended by F7): none / some / plenty.
    if (share > 0.6) return "documented";
    if (share > 0 || (k.own ?? 0) > 0) return "partly";
    return "undocumented";
  }
  if ((k.own ?? 0) > 0) return "documented";
  if ((k.inherited ?? 0) > 0) return "inherited";
  return "undocumented";
}
function isStale(nd) {
  return (nd.knowledge?.stale ?? 0) > 0 || (nd.aggregates?.stale ?? 0) > 0;
}
function testsFill(nd) {
  if (nd.role === "test" || nd.role === "fixture") return COLORS.explorerFill;
  if (nd.kind === "dir" || nd.kind === "repo") {
    const agg = nd.aggregates ?? {};
    const share = (agg.testedSource ?? 0) / Math.max(1, agg.source ?? 0);
    return share >= 0.6 ? COLORS.ok : share >= 0.2 ? COLORS.warn : COLORS.knowNone;
  }
  return (nd.testedBy?.length ?? 0) > 0 ? COLORS.ok : COLORS.knowNone;
}
function testsClass(nd) {
  if (nd.role === "test" || nd.role === "fixture") return "testfile";
  if (nd.kind === "dir" || nd.kind === "repo") {
    const agg = nd.aggregates ?? {};
    const share = (agg.testedSource ?? 0) / Math.max(1, agg.source ?? 0);
    return share >= 0.6 ? "tested" : share >= 0.2 ? "partly" : "untested";
  }
  return (nd.testedBy?.length ?? 0) > 0 ? "tested" : "untested";
}
/** The swatch for a node the server reported no history for: outside the ramp, so it cannot read as cold. */
const HEAT_NO_HISTORY = COLORS.panel2;
function heatFill(nd, thresholds) {
  if (!hasHistory(nd)) return HEAT_NO_HISTORY;
  return HEAT_RAMP[heatStep(heatValue(nd), thresholds)];
}
function ownerOf(nd, model) {
  const a = nd.author;
  if (!a) return null;
  return model.peopleById.get(a.handle || a.email || a.name) ?? null;
}

/**
 * Colour for one node under a lens. `ctx` is the view's `areas` array or `{ areas, nodes, view }`
 * (nodes/view let heat quantiles and the people order come from the visible set).
 */
export function lensColor(node, lens, ctx) {
  const view = Array.isArray(ctx) ? { areas: ctx, nodes: [node], edges: [] } : ctx?.view ?? { areas: ctx?.areas ?? [], nodes: ctx?.nodes ?? [node], edges: [] };
  if (!view.nodes.some((n) => n.id === node.id)) view.nodes = [...view.nodes, node];
  const model = buildModel({ ...view, level: view.level ?? "container" }, { level: view.level ?? "container" });
  const nd = model.nodeById.get(node.id);
  if (!nd) return COLORS.knowNone;
  return paintNode(nd, lens, model).fill;
}

/**
 * The file explorer's reserved channel is the ring: cyan upstream, orange downstream, white focus
 * (§2 Level 3, acceptance 9). A lens may take the fill, never the ring — arriving at a file with
 * Heat or Owners active used to grey out the direction entirely and leave the view meaningless (F6).
 */
function directionBorder(nd) {
  if (nd.center) return COLORS.selection;
  return nd.side === "down" ? COLORS.down : COLORS.up;
}

function paintNode(nd, lens, model) {
  const level = model.level;
  const out = { fill: nd.hue, border: nd.hue, bw: 1, bgOpacity: 1, classes: [], textColor: COLORS.text, hatch: false, stale: false };
  if (nd.compound) {
    out.fill = nd.hue;
    out.border = nd.hue;
    out.bgOpacity = 0.12;
    out.classes.push("compound");
    return out;
  }
  if (nd.kind === "repo") {
    out.fill = COLORS.panel2;
    out.border = COLORS.lineStrong;
  }
  if (nd.kind === "fold") {
    out.fill = COLORS.panel2;
    out.border = COLORS.faint;
    out.textColor = COLORS.muted;
    out.classes.push("fold");
    return out;
  }
  if (nd.kind === "task") {
    out.fill = STATE_COLORS[nd.state] ?? COLORS.warn;
    out.border = out.fill;
    out.classes.push("task");
    return out;
  }
  if (nd.svc) return paintServiceNode(nd, lens);
  if (nd.ghost) {
    out.bgOpacity = 0.35;
    out.classes.push("ghost", nd.side === "down" ? "ghost-down" : "ghost-up");
  }
  const explorer = level === "impact";
  if (explorer && !nd.ghost) {
    out.fill = COLORS.explorerFill;
    out.border = nd.center ? COLORS.selection : nd.side === "down" ? COLORS.down : COLORS.up;
    out.bw = 2;
    if (nd.hop != null && nd.hop > 0) out.classes.push(`hop-${Math.min(3, nd.hop)}`);
    out.classes.push(nd.center ? "center" : nd.side === "down" ? "side-down" : "side-up");
  } else if (level === "workspace") {
    out.fill = COLORS.panel2;
    out.border = COLORS.lineStrong;
  }
  if (nd.role === "test" || nd.role === "fixture") out.classes.push("test");

  switch (lens) {
    case "knowledge": {
      out.fill = knowledgeFill(nd);
      if (explorer) out.border = directionBorder(nd);
      else out.border = nd.ghost ? nd.hue : out.fill;
      out.classes.push(`k-${knowledgeClass(nd)}`);
      // "Undocumented" is the commonest state in a real repo and #3b4252 is 1.88:1 on --bg — the
      // lens meant to show knowledge gaps was the one where the shapes disappeared (F12).
      if (out.fill === COLORS.knowNone && !explorer && !nd.ghost) {
        out.border = COLORS.shapeEdge;
        out.bw = 1.5;
      }
      if (isStale(nd)) {
        out.stale = true;
        out.classes.push("stale");
      }
      break;
    }
    case "tests": {
      out.fill = testsFill(nd);
      if (explorer) out.border = directionBorder(nd);
      else out.border = nd.ghost ? nd.hue : nd.role === "test" ? COLORS.muted : out.fill;
      out.classes.push(`t-${testsClass(nd)}`);
      if (out.fill === COLORS.knowNone && !explorer && !nd.ghost) {
        out.border = COLORS.shapeEdge;
        out.bw = 1.5;
      }
      break;
    }
    case "heat": {
      out.fill = heatFill(nd, model.heatThresholds);
      const unknown = !hasHistory(nd);
      if (explorer) out.border = directionBorder(nd);
      else out.border = nd.ghost ? nd.hue : out.fill === HEAT_RAMP[0] || unknown ? COLORS.lineStrong : out.fill;
      out.classes.push(unknown ? "h-none" : `h-${heatStep(heatValue(nd), model.heatThresholds)}`);
      if ((out.fill === HEAT_RAMP[0] || unknown) && !explorer && !nd.ghost) {
        out.border = COLORS.shapeEdge;
        out.bw = 1.5;
      }
      break;
    }
    case "owners": {
      const p = ownerOf(nd, model);
      out.fill = p ? p.color : COLORS.knowNone;
      if (explorer) out.border = directionBorder(nd);
      else out.border = nd.ghost ? nd.hue : p ? p.color : COLORS.shapeEdge;
      if (!p && !explorer && !nd.ghost) out.bw = 1.5;
      if (p) out.classes.push(`o-${cssSafe(p.handle)}`);
      if (p && (nd.author?.share ?? 0) >= 0.8) {
        out.hatch = true;
        out.classes.push("hatch");
      }
      break;
    }
    default:
      break;
  }
  // Blast radius overlays (§3.7) win over the lens fill for centres.
  if (model.isBlast) {
    if (nd.collision.length) {
      out.border = COLORS.bad;
      out.bw = 3;
      out.classes.push("collision");
    } else if (nd.otherTask) {
      out.border = AREA_HUES[2];
      out.bw = 2;
      out.classes.push("other-task");
    }
    if (nd.center && !nd.otherTask) {
      if (nd.actual) {
        out.fill = COLORS.warn;
        out.classes.push("actual");
      }
      if (nd.planned) {
        out.border = nd.collision.length ? COLORS.bad : COLORS.warn;
        out.bw = 3;
        out.classes.push("planned");
      }
    }
  }
  if (nd.role === "test" && !nd.ghost) {
    out.bgOpacity = 0;
    out.border = lens === "tests" ? COLORS.muted : out.border === out.fill ? COLORS.muted : out.border;
  }
  // Level 3's centre has to win at a glance against ten orange neighbours (F10).
  if (nd.center && !nd.ghost) {
    out.bw = Math.max(out.bw, explorer ? 3 : 2);
    // Only the single-centre explorer gets the enlarged, haloed centre; the blast radius has many
    // centres and codes them with the planned / changed / collision borders instead (§3.7).
    if (explorer && !model.isBlast) out.classes.push("center-explorer");
  }
  // A label drawn *inside* a coloured fill must clear 4.5:1 (§5.7). File labels sit below the node
  // on a --bg plate and keep --text; containers take whichever of --text / --bg reads better (F03).
  if ((nd.kind === "dir" || nd.kind === "repo") && !nd.ghost && out.bgOpacity >= 0.6) {
    out.textColor = labelOn(out.fill);
  }
  return out;
}
function cssSafe(s) {
  return String(s).replace(/[^a-zA-Z0-9_-]/g, "_");
}

// ---------------------------------------------------------------------------
// Legend (spec §5.5 rules 7–8): generated from the encodings present on the canvas
// ---------------------------------------------------------------------------

/**
 * Legend rows for a view under a lens. `kind` is one of fill | ghost | hollow | edge | edge-dotted |
 * edge-dashed | hatch | notch | ring; `isolate` lists the element ids the row isolates on click.
 */
export function legendFor(view, lens = "structure", opts = {}) {
  const model = view && view.nodes && view.__model ? view.__model : buildModel(view, opts);
  return legendForModel(model, lens);
}

function legendForModel(model, lens) {
  if (model.level === "services" || model.level === "flow" || model.level === "flows") return serviceLegend(model, lens);
  const rows = [];
  const level = model.level;
  const drawable = model.nodes.filter((n) => !n.compound);
  /**
   * A legend row earns its place only when the canvas cannot explain itself (§5.5 rule 7). Two
   * kinds of row are dropped here:
   *  - `labelled`: every node in the class already prints its own name inside the shape, so the row
   *    repeats what the reader can see. On the repo map that was one row per area, each of them
   *    reading "1" — six rows spent restating six labels (F-MAP-03).
   *  - `showCount: false`: a count that is always one and always obvious ("This file 1").
   */
  const push = (row) => {
    if (row.count > 0 && !row.labelled) rows.push(row);
  };
  const byClass = (pred) => drawable.filter(pred);
  let title = LENS_TITLES[lens] ?? LENS_TITLES.structure;
  if (lens === "heat") title = `Colour = commits in ${(model.heatWindow ?? HEAT_WINDOW).label}`;

  if (lens === "structure" || !LENS_TITLES[lens]) {
    if (level === "impact") {
      title = "Colour = direction";
      const ups = byClass((n) => !n.ghost && n.kind !== "fold" && n.side === "up" && !n.center);
      const downs = byClass((n) => !n.ghost && n.kind !== "fold" && n.side === "down" && !n.center);
      const centres = byClass((n) => n.center);
      if (model.isBlast) {
        title = "Colour = task";
        const planned = centres.filter((n) => n.planned && !n.otherTask);
        const actual = centres.filter((n) => n.actual && !n.otherTask);
        const others = drawable.filter((n) => n.otherTask);
        const overlaps = drawable.filter((n) => n.collision.length);
        push({ label: "Planned", color: COLORS.warn, kind: "ring", count: planned.length, isolate: planned.map((n) => n.id) });
        push({ label: "Changed on branch", color: COLORS.warn, kind: "fill", count: actual.length, isolate: actual.map((n) => n.id) });
        push({ label: "Depends on it", color: COLORS.up, kind: "ring", count: ups.filter((n) => !n.otherTask).length, isolate: ups.map((n) => n.id) });
        push({ label: "Other active task", color: AREA_HUES[2], kind: "ring", count: others.length, isolate: others.map((n) => n.id) });
        push({ label: "Overlap", color: COLORS.bad, kind: "ring", count: overlaps.length, isolate: overlaps.map((n) => n.id) });
      } else {
        push({ label: "This file", color: COLORS.selection, kind: "ring", count: centres.length, showCount: false, isolate: centres.map((n) => n.id) });
        push({ label: "Depends on it (upstream)", color: COLORS.up, kind: "ring", count: ups.length, isolate: ups.map((n) => n.id) });
        push({ label: "It depends on (downstream)", color: COLORS.down, kind: "ring", count: downs.length, isolate: downs.map((n) => n.id) });
      }
    } else if (level === "workspace") {
      // Every node on this map is a repo and says so inside its own shape: the row would be a
      // caption for the whole canvas.
      title = "Repos";
    } else {
      // Level 1 areas are labelled inside the node, so the hue channel is named in the title and
      // nothing more is said about it. Level 2 colours files by sub-area — a fact no file label
      // carries — so those rows stay, unless there is only one group, which the compound already names.
      const seen = new Map();
      for (const n of drawable) {
        if (n.kind === "fold" || n.kind === "task" || n.ghost) continue;
        // A sub-area drawn as its own node prints its own name inside the shape, so it is its own
        // legend row and does not need a second one reading "ActivityBar 1". Only the file nodes,
        // whose labels are filenames, need the colour explained.
        if (level === "dir" && n.kind === "dir") continue;
        // Everything the sub-area ramp could not give a hue of its own shares `--area-other`, so it
        // shares one row: naming any single sub-area there would name a colour other nodes wear too.
        const overflow = level === "dir" && n.hue === AREA_HUES[0];
        const key = level === "container" ? n.id : overflow ? "__other__" : n.subGroup ?? n.area ?? "other";
        const label = level === "container" ? n.fullLabel : n.subLabel ?? n.areaLabel ?? model.nodeById.get(model.compoundId)?.fullLabel ?? "this area";
        const row = seen.get(key) ?? { label, color: n.hue, kind: "fill", count: 0, isolate: [], labelled: level === "container", groups: new Set() };
        row.groups.add(n.subGroup ?? key);
        row.count += 1;
        row.isolate.push(n.id);
        seen.set(key, row);
      }
      // One group in the grey keeps its own name ("src (loose files)"); more than one and the row
      // says only that these are the sub-areas the ramp ran out for.
      const overflowRow = seen.get("__other__");
      if (overflowRow && overflowRow.groups.size > 1) overflowRow.label = "Other sub-areas";
      for (const r of seen.values()) delete r.groups;
      if (level === "dir" && seen.size > 1) title = "Colour = sub-area";
      if (level !== "container" && seen.size > 1) for (const r of seen.values()) push(r);
      // One row for the ghosts, whatever area they came from: the encoding they share is "drawn
      // dashed because it lives outside this area", and each ghost already prints its own name.
      const ghosts = drawable.filter((n) => n.ghost);
      push({ label: "Outside this area", color: COLORS.faint, kind: "ghost", count: ghosts.length, isolate: ghosts.map((n) => n.id) });
    }
  } else if (lens === "knowledge") {
    const groups = {
      documented: ["Documented", KNOWLEDGE_FILL.documented],
      partly: ["Partly documented", KNOWLEDGE_FILL.partly],

      inherited: ["Inherited", KNOWLEDGE_FILL.inherited],
      undocumented: ["Undocumented", KNOWLEDGE_FILL.undocumented],
    };
    for (const [cls, [label, color]] of Object.entries(groups)) {
      const ids = drawable.filter((n) => n.kind !== "fold" && n.kind !== "task" && n.role !== "test" && knowledgeClass(n) === cls).map((n) => n.id);
      push({ label, color, kind: "fill", count: ids.length, isolate: ids });
    }
    const stale = drawable.filter((n) => isStale(n)).map((n) => n.id);
    push({ label: "Stale", color: COLORS.bad, kind: "notch", count: stale.length, isolate: stale });
  } else if (lens === "tests") {
    const tested = drawable.filter((n) => n.kind !== "fold" && n.role !== "test" && (testsClass(n) === "tested")).map((n) => n.id);
    const partly = drawable.filter((n) => n.kind !== "fold" && testsClass(n) === "partly").map((n) => n.id);
    const untested = drawable.filter((n) => n.kind !== "fold" && n.kind !== "task" && n.role !== "test" && testsClass(n) === "untested").map((n) => n.id);
    push({ label: "Tested", color: COLORS.ok, kind: "fill", count: tested.length, isolate: tested });
    push({ label: "Partly tested", color: COLORS.warn, kind: "fill", count: partly.length, isolate: partly });
    push({ label: "Untested", color: COLORS.knowNone, kind: "fill", count: untested.length, isolate: untested });
  } else if (lens === "heat") {
    const t = model.heatThresholds;
    const heatWin = model.heatWindow ?? HEAT_WINDOW;
    const heatVal = (n) => heatValue(n);
    const steps = new Map();
    const unknown = [];
    for (const n of drawable) {
      if (n.kind === "fold" || n.kind === "task" || n.ghost) continue;
      if (!hasHistory(n)) {
        unknown.push(n.id);
        continue;
      }
      const s = heatStep(heatVal(n), t);
      const row = steps.get(s) ?? { step: s, min: Infinity, max: -Infinity, ids: [] };
      row.min = Math.min(row.min, heatVal(n));
      row.max = Math.max(row.max, heatVal(n));
      row.ids.push(n.id);
      steps.set(s, row);
    }
    // Hottest step first, each row naming the commit counts it actually holds.
    for (const s of Array.from(steps.keys()).sort((a, b) => b - a)) {
      const r = steps.get(s);
      const range = s === 0 ? `no commits in ${heatWin.label}` : r.min === r.max ? `${r.min} commit${r.min === 1 ? "" : "s"}` : `${r.min}–${r.max} commits`;
      push({ label: range, color: HEAT_RAMP[s], kind: "fill", count: r.ids.length, isolate: r.ids });
    }
    // Not the same statement as "no commits": git had nothing to report for these at all.
    push({ label: "no history", color: HEAT_NO_HISTORY, kind: "fill", count: unknown.length, isolate: unknown });
  } else if (lens === "owners") {
    for (const p of model.people) {
      const ids = drawable.filter((n) => ownerOf(n, model)?.handle === p.handle).map((n) => n.id);
      push({ label: p.handle, color: p.color, kind: "fill", count: ids.length, isolate: ids });
    }
    const nobody = drawable.filter((n) => !n.ghost && n.kind !== "fold" && n.kind !== "task" && !ownerOf(n, model)).map((n) => n.id);
    push({ label: "No history", color: COLORS.knowNone, kind: "fill", count: nobody.length, isolate: nobody });
    const single = drawable.filter((n) => (n.author?.share ?? 0) >= 0.8 && ownerOf(n, model)).map((n) => n.id);
    push({ label: "single owner (≥ 80%)", color: COLORS.muted, kind: "hatch", count: single.length, isolate: single });
  }

  // The explorer's ring keeps direction under every lens, so the legend names both channels (F6).
  if (level === "impact" && lens !== "structure" && LENS_TITLES[lens]) {
    title = `Fill = ${title.replace(/^Colour = /, "")} · Ring = direction`;
    const centres = byClass((n) => n.center);
    const ups = byClass((n) => !n.ghost && n.kind !== "fold" && n.side === "up" && !n.center);
    const downs = byClass((n) => !n.ghost && n.kind !== "fold" && n.side === "down" && !n.center);
    push({ label: "This file", color: COLORS.selection, kind: "ring", count: centres.length, isolate: centres.map((n) => n.id) });
    push({ label: "Depends on it (upstream)", color: COLORS.up, kind: "ring", count: ups.length, isolate: ups.map((n) => n.id) });
    push({ label: "It depends on (downstream)", color: COLORS.down, kind: "ring", count: downs.length, isolate: downs.map((n) => n.id) });
  }

  // Rows shared by every lens: the shape and stroke conventions no label on the canvas explains.
  const tests = drawable.filter((n) => n.role === "test" && !n.ghost).map((n) => n.id);
  push({ label: "Test file", color: COLORS.muted, kind: "hollow", count: tests.length, isolate: tests });
  const folds = drawable.filter((n) => n.kind === "fold");
  push({ label: "Folded", color: COLORS.faint, kind: "ghost", count: folds.length, isolate: folds.map((n) => n.id) });
  const ipc = model.edges.filter((e) => e.kind === "ipc");
  push({ label: "IPC (matched by name)", color: AREA_HUES[2], kind: "edge-dotted", count: ipc.length, isolate: ipc.map((e) => e.id) });
  const cycles = model.edges.filter((e) => e.cycle);
  push({ label: "Cycle (they import each other)", color: COLORS.cycle, kind: "edge-dashed", count: cycles.length, isolate: cycles.map((e) => e.id) });
  const touches = model.edges.filter((e) => e.kind === "touches");
  push({ label: "Task touches", color: COLORS.warn, kind: "edge-dashed", count: touches.length, isolate: touches.map((e) => e.id) });
  if (level === "workspace") {
    const dep = model.edges.filter((e) => e.kind === "depends-on");
    push({ label: "Depends on", color: COLORS.muted, kind: "edge", count: dep.length, isolate: dep.map((e) => e.id) });
    const org = model.edges.filter((e) => e.kind === "same-org");
    push({ label: "Same GitHub org", color: COLORS.muted, kind: "edge-dashed", count: org.length, isolate: org.map((e) => e.id) });
  }
  return { title, rows };
}

// ---------------------------------------------------------------------------
// Footer counts and tooltip sentences
// ---------------------------------------------------------------------------

function plural(n, one, many = `${one}s`) {
  return `${n} ${n === 1 ? one : many}`;
}

export function footerFor(model, controls = {}) {
  const level = model.level;
  // Nothing on the canvas, nothing to count. The task page's blast radius read "0 upstream · 0
  // downstream at depth 1" over an empty pane — three numbers about a picture that was not there,
  // and a depth control that had nothing to control. The canvas says why it is empty instead
  // (`emptyMapText`), and the footer says nothing (F-MAP-C).
  if (!model.nodes.some((n) => !n.compound)) return "";
  if (level === "services" || level === "flow" || level === "flows") return serviceFooter(model);
  const drawable = model.nodes.filter((n) => !n.compound && !n.ghost && n.kind !== "fold");
  const edges = model.edges.length;
  const hidden = model.hiddenTests;
  // The Tests lens draws test files (see `maybeShowTests`), so it must never also claim they are
  // hidden. The repo map has no file nodes at all — its tests are counted inside the areas — so
  // under that lens it says so rather than reporting a hidden set the reader cannot unhide.
  const hiddenText = !hidden ? null : controls.lens === "tests" ? (level === "container" ? `${plural(hidden, "test")} counted inside these areas` : null) : `${plural(hidden, "test")} hidden`;
  if (level === "container") {
    const areas = drawable.filter((n) => n.kind === "dir").length;
    // Last, and only here. `unresolved` is repo-wide, so a dir or impact footer reporting it would
    // invite the reader to attach it to the scope that footer describes; the repo map and the repo
    // story are the two repo-wide surfaces. Omitted at zero, like every other segment on this line,
    // and worded without the word "unresolved", which is jargon to the reader being addressed.
    // `model?.counts?` because `footerFor` is part of this module's exported surface and a caller
    // that hand-builds a model need not have a counts block — the in-app path always does.
    const unresolved = model?.counts?.unresolved ?? 0;
    // The verb agrees with the count: "1 import points at no file", "2 imports point at no file".
    const unresolvedText = unresolved > 0 ? `${plural(unresolved, "import")} ${unresolved === 1 ? "points" : "point"} at no file` : null;
    return [plural(areas, "area"), plural(edges, "edge"), hiddenText, unresolvedText].filter(Boolean).join(" · ");
  }
  if (level === "dir") {
    const files = drawable.filter((n) => n.kind === "file" && n.role !== "test").length;
    const tests = drawable.filter((n) => n.role === "test").length;
    const subs = drawable.filter((n) => n.kind === "dir").length;
    const fold = model.nodes.find((n) => n.kind === "fold");
    const parts = [plural(files, "file"), subs ? plural(subs, "sub-area") : null, plural(edges, "edge"), tests ? `${plural(tests, "test")} shown` : hiddenText];
    if (fold) {
      const total = (model.counts.totalCodeFiles ?? files + fold.foldCount);
      parts.unshift(`Showing ${files} of ${model.counts.shown && model.counts.folded ? model.counts.shown + model.counts.folded : total} files; ${fold.foldCount} folded into +N more`);
      parts.splice(1, 1);
    }
    return parts.filter(Boolean).join(" · ");
  }
  if (level === "impact") {
    const up = model.counts.up ? model.counts.up.reduce((a, b) => a + b, 0) : drawable.filter((n) => n.side === "up" && !n.center).length;
    const down = model.counts.down ? model.counts.down.reduce((a, b) => a + b, 0) : drawable.filter((n) => n.side === "down" && !n.center).length;
    const deepest = Math.max(1, ...drawable.map((n) => n.hop ?? 0));
    const depth = Math.max(controls.depth ?? 1, deepest);
    const dir = controls.direction ?? "both";
    const parts = [];
    if (dir !== "down") parts.push(`${up} upstream`);
    if (dir !== "up") parts.push(`${down} downstream`);
    return `${parts.join(" · ")} at depth ${depth}${hiddenText ? ` · ${hiddenText}` : ""}`;
  }
  if (level === "workspace") return `${plural(drawable.length, "repo")} · ${plural(edges, "connection")}`;
  return `${plural(drawable.length, "node")} · ${plural(edges, "edge")}`;
}

/**
 * Why this view has nothing on it, and what would put something there.
 *
 * A map column with no nodes used to render as a blank rectangle with a footer counting zeroes — the
 * task page's blast radius, whose plan names no files and whose branch changed none, so there is
 * genuinely nothing to draw (F-MAP-C). An empty state says which of those it is; the register is the
 * one the story column uses for its own empty states: a sentence about the repo, then the thing you
 * would do about it.
 */
export function emptyMapText(model) {
  const level = model?.level;
  // A caller that knows why its view is empty says so itself: a file page in diff mode draws an
  // empty impact view for a path the graph never read, and "nothing imports this file" would be a
  // claim about imports nobody measured.
  const own = model?.view?.empty;
  if (own && typeof own.text === "string" && own.text) return { text: own.text, hint: typeof own.hint === "string" ? own.hint : "" };
  if (level === "services") {
    return {
      text: "Nothing in this repo reaches a service that can be read from the code.",
      hint: "A binding in `wrangler.toml`, a `fetch` to a host, or an `env.NAME` read is what puts something here.",
    };
  }
  if (level === "flow") {
    return { text: "This entry point calls nothing the tracer can follow.", hint: "The story beside the map says what it does derive." };
  }
  if (level === "flows") {
    return { text: "No entry point was found in this repo.", hint: "A Cloudflare handler, an Express or Hono route, a Next route or a CLI command is what starts a flow." };
  }
  if (level === "impact" && model?.isBlast) {
    return {
      text: "This task's plan names no files yet, so there is no blast radius to draw.",
      hint: "Add the files the task will touch to its plan, and the map draws them with everything they reach.",
    };
  }
  if (level === "impact") {
    return {
      text: "Nothing imports this file and it imports nothing, so there is nothing to draw.",
      hint: "Raise the depth, or switch the direction, to look further out from it.",
    };
  }
  if (level === "container" || level === "dir") {
    // A repo written in a language the graph does not read lands here with a canvas that is empty
    // and a footer that `footerFor` returns "" for (F-MAP-C: the canvas says why, the footer says
    // nothing). "No code files under here" is then false in the most damaging way available — the
    // files exist, and only Reggie's ability to read them is missing — so the container card says
    // so from `counts.skipped`. A repo-wide skipped list does not explain why one folder is empty,
    // so the dir card keeps its own text.
    //
    // `totalCodeFiles === 0` is the other half of the guard and it is not optional. A container
    // canvas comes back empty for reasons that have nothing to do with language: `chooseAreas`
    // folds every candidate below `MIN_AREA_FILES`, so two source files under `src` beside one
    // stylesheet already draws nothing. Without the check this card would tell a repo whose code
    // the map reads perfectly well that nothing here is in a language the map reads, and would
    // print a file count that omits the files it did read — a worse lie than the one it replaces.
    const counts = model?.counts ?? {};
    const skipped = level === "container" && (counts.totalCodeFiles ?? 0) === 0 ? (counts.skipped ?? []) : [];
    if (skipped.length > 0) {
      const files = skipped.reduce((sum, e) => sum + (e.files ?? 0), 0);
      const named = skipped.slice(0, 3).map((e) => e.language);
      const list = named.length > 1 ? `${named.slice(0, -1).join(", ")} and ${named[named.length - 1]}` : named[0];
      // "mostly" only when the named languages do not account for all of them; with three or fewer
      // the list is the whole set and "mostly" would assert a remainder that does not exist. The
      // comma belongs to the hedge, not to the exhaustive list: "12 code files in CSS and HTML",
      // "229 code files, mostly Go, Swift and Python".
      const languages = skipped.length > named.length ? `, mostly ${list}` : ` in ${list}`;
      return {
        text: `Nothing here is in a language the map reads: ${plural(files, "code file")}${languages}.`,
        hint: "The files are in the repo. They are missing from the map, not from the code.",
      };
    }
    return { text: "No code files under here, so there is nothing to draw.", hint: "Areas appear on the map once they hold files the import graph can read." };
  }
  if (level === "workspace") {
    return { text: "No repositories in this workspace yet.", hint: "Run `reggie onboard` in a repository to add it." };
  }
  return { text: "Nothing to draw for this view.", hint: "Pick a repository, an area or a file from the story beside the map." };
}

function nodeName(nd) {
  if (!nd) return "?";
  if (nd.kind === "file") return basename(nd.path);
  if (nd.kind === "task") return nd.fullLabel;
  return nd.fullLabel || dirPathOf(nd.id);
}

/**
 * The "mostly X (n)" parenthetical on an aggregated edge. The count is in the same unit as the total
 * it sits inside — **importing files**, not named imports — so it has to be the server's own figure:
 * `via` is truncated to the top five file pairs, and summing names over those five produced 15 where
 * the story (counting every pair) said 17, two different numbers for one fact on one screen
 * (F1 / F9 / MAP-01). The server may attach the answer as `mostly: { path, files }`; failing that a
 * complete `via` is counted by distinct importing file, and a truncated one drops the number rather
 * than printing a wrong one.
 *
 * The server's field is `top: { path, files }` (docs/ui-api-contract.md). This used to read
 * `mostly`, which the server has never sent, so every aggregated edge fell through to the truncated
 * `via` sample and the count was dropped: "mostly terminal.ts" instead of "mostly terminal.ts (17)"
 * (MAP-01). `mostly` is still accepted as a fallback for older payloads and the test fixtures.
 */
function mostlyFor(e, s, t) {
  const raw = e.raw ?? e;
  const supplied = raw.top ?? e.top ?? raw.mostly ?? e.mostly ?? null;
  if (supplied && (supplied.path || supplied.target)) {
    const files = supplied.files ?? supplied.count ?? supplied.weight ?? null;
    return { name: basename(supplied.path ?? supplied.target), files: typeof files === "number" ? files : null };
  }
  const via = Array.isArray(e.via) ? e.via : [];
  if (!via.length) return null;
  const towardsTarget = t?.kind === "dir" || t?.ghost;
  const groups = new Map();
  for (const v of via) {
    const key = towardsTarget ? basename(v.target) : basename(v.source);
    const g = groups.get(key) ?? new Set();
    // One importing *file* per pair, whichever end of the pair is the one being summarised.
    g.add(towardsTarget ? v.source : v.target);
    groups.set(key, g);
  }
  const top = Array.from(groups.entries()).sort((x, y) => y[1].size - x[1].size || x[0].localeCompare(y[0]))[0];
  if (!top) return null;
  // `via` complete? The server caps it, so an edge whose weight outruns its pair list is a sample.
  const truncated = via.length < e.weight && via.length >= MAX_VIA_SAMPLE;
  return { name: top[0], files: truncated ? null : top[1].size };
}

/** The server's cap on `via` entries per aggregated edge (docs/ui-api-contract.md). */
const MAX_VIA_SAMPLE = 5;

/** The tooltip sentence for an edge (spec §3.4, acceptance 3 and 10). */
export function edgeSentence(e, nodeById) {
  if (e.svc) return serviceEdgeSentence(e, nodeById);
  const s = nodeById.get(e.source);
  const t = nodeById.get(e.target);
  const a = nodeName(s);
  const b = nodeName(t);
  const heuristic = e.confidence === "heuristic" ? " (matched by name; may include false matches)" : "";
  const cycle = e.cycle ? " They depend on each other." : "";
  const times = (n) => (n === 1 ? "once" : n === 2 ? "twice" : `${n} times`);
  let text;
  switch (e.kind) {
    case "ipc": {
      const n = e.names.length || e.weight;
      const list = e.names.length && e.names.length <= 3 ? ` (${e.names.join(", ")})` : "";
      text = `${a} calls into ${b} through ${n} Tauri command${n === 1 ? "" : "s"}${list} (matched by name)`;
      break;
    }
    case "tests":
      text = `${a} tests ${b}`;
      break;
    case "touches":
      text = `${a} touches ${b}`;
      break;
    case "depends-on":
      text = `${a} depends on ${b}${e.label ? ` (package ${e.label})` : ""}`;
      break;
    case "same-org":
      text = `${a} and ${b} share a GitHub org`;
      break;
    case "annotates":
      text = `${a} annotates ${b}`;
      break;
    default: {
      const aggregated = (s?.kind === "dir" || t?.kind === "dir" || s?.ghost || t?.ghost) && e.weight >= 1 && (e.weight > 1 || !e.names.length);
      if (aggregated) {
        const top = mostlyFor(e, s, t);
        const mostly = top ? `, mostly ${top.name}${top.files != null ? ` (${top.files})` : ""}` : "";
        text = `${a} imports from ${b} ${times(e.weight)}${mostly}`;
      } else if (e.names.length) {
        const shown = e.names.slice(0, 8);
        text = `${a} imports ${shown.join(", ")}${e.names.length > 8 ? ` and ${e.names.length - 8} more` : ""} from ${b}`;
      } else {
        text = `${a} imports ${b}`;
      }
    }
  }
  return `${text}${heuristic}.${cycle}`;
}

function nodeTip(nd) {
  const meta = [];
  if (nd.svc) return serviceTip(nd);
  if (nd.ghost) {
    meta.push("outside this area");
    const files = nd.raw?.filesUsed ?? nd.aggregates?.files;
    if (files != null) meta.push(`${files} files used`);
    return { path: nd.path, meta };
  }
  if (nd.kind === "fold") return { path: `${nd.foldCount} files folded`, meta: nd.foldIds.slice(0, 6).map(basename).concat(nd.foldIds.length > 6 ? ["…"] : []) };
  if (nd.kind === "task") return { path: nd.id, meta: [nd.state ? `state: ${nd.state}` : null].filter(Boolean) };
  if (nd.kind === "repo") return { path: nd.path || nd.fullLabel, meta: [nd.raw?.sub ?? nd.lang].filter(Boolean) };
  if (nd.kind === "dir") {
    const agg = nd.aggregates ?? {};
    meta.push(`${plural(agg.source ?? agg.files ?? 0, "source file")}`);
    if (agg.source) meta.push(`${Math.round(documentedShare(agg) * 100)}% documented`);
    if (agg.tests) meta.push(plural(agg.tests, "test"));
    if (isStale(nd)) meta.push("stale note");
    meta.push(commitClause(nd));
    return { path: nd.path ? `${nd.path}/` : nd.fullLabel, meta };
  }
  meta.push(nd.role);
  if (nd.lines) meta.push(`${nd.lines} lines`);
  const k = nd.knowledge ?? {};
  meta.push(k.own > 0 ? "own note" : k.inherited > 0 ? "inherited note" : "no note");
  if (isStale(nd)) meta.push("stale note");
  meta.push(commitClause(nd));
  if (nd.center && nd.task) meta.push(`task ${nd.task}`);
  if (nd.collision.length) meta.push(`also touched by ${nd.collision.join(", ")}`);
  if (nd.hop != null && nd.hop > 0) meta.push(`${nd.hop} hop${nd.hop === 1 ? "" : "s"} away`);
  return { path: nd.path, meta };
}

// ---------------------------------------------------------------------------
// Stylesheet (spec §3.4)
// ---------------------------------------------------------------------------

function stylesheet() {
  const t = `${dur(MOTION.highlight)}ms`;
  return [
    {
      selector: "core",
      style: { "active-bg-opacity": 0, "selection-box-opacity": 0 },
    },
    {
      selector: "node",
      style: {
        shape: "data(shape)",
        width: "data(w)",
        height: "data(h)",
        "background-color": "data(fill)",
        "background-opacity": "data(bgOpacity)",
        "border-width": "data(bw)",
        "border-color": "data(border)",
        "border-opacity": 1,
        label: "data(label)",
        color: "data(textColor)",
        "font-family": '-apple-system, BlinkMacSystemFont, "Segoe UI", Inter, Roboto, sans-serif',
        "font-size": 12,
        "font-weight": 500,
        "text-wrap": "wrap",
        "text-max-width": "data(textMax)",
        "text-valign": "center",
        "text-halign": "center",
        "line-height": 1.25,
        // Labels drawn *outside* their node get a plate of their own, so when two do end up close one
        // reads over the other instead of the pair blending into a word-pile (F1). A container label
        // sits inside its own filled shape and takes the plate at zero opacity — its text colour is
        // already chosen against that fill, and a --bg plate under dark-on-light text erased it.
        "text-background-color": COLORS.bg,
        "text-background-opacity": 0,
        "text-background-padding": 2,
        "text-background-shape": "round-rectangle",
        "overlay-color": COLORS.selection,
        "overlay-opacity": 0,
        "overlay-padding": 6,
        "transition-property": "opacity, overlay-opacity, border-color, background-opacity",
        "transition-duration": t,
        "transition-timing-function": "ease-out",
        "z-index": 5,
      },
    },
    // Container labels are multi-line, so they must stay on "wrap"; a long single word cannot be
    // broken by Cytoscape, so the *text* is truncated when the node is built instead (F1).
    { selector: "node[kind = 'dir']", style: { "text-max-width": "data(textMax)", "text-wrap": "wrap", "font-size": 12, "font-weight": 600 } },
    { selector: "node[kind = 'repo']", style: { "font-size": 13, "font-weight": 600, "text-max-width": 190 } },
    {
      selector: "node[kind = 'file']",
      style: {
        "font-size": 12,
        "font-weight": 400,
        // Acceptance 16: file labels disappear below 9px rendered. The fit zoom floor is 0.75, which
        // renders a 12px label at exactly 9px, so labels survive a fitted view and vanish only when
        // the user zooms out past it.
        "min-zoomed-font-size": 9,
        "text-valign": "bottom",
        "text-margin-y": 4,
        "text-background-color": COLORS.bg,
        "text-background-opacity": 0.85,
        "text-background-padding": 3,
        "text-background-shape": "round-rectangle",
        "text-max-width": 150,
        "text-wrap": "ellipsis",
      },
    },
    { selector: "node[role = 'test']", style: { "background-opacity": 0, "border-style": "dashed", "border-width": 1.5 } },
    { selector: "node[?ghost]", style: { "border-style": "dashed", "border-width": 1.5, opacity: 0.75, "font-size": 11, "font-weight": 500, "z-index": 3 } },
    { selector: "node[kind = 'fold']", style: { "border-style": "dashed", "border-width": 1.5, "font-size": 11, "font-weight": 500 } },
    { selector: "node[kind = 'task']", style: { shape: "diamond", "font-size": 11, "text-valign": "bottom", "text-margin-y": 4, color: COLORS.text, "text-background-opacity": 0.85, "text-background-padding": 3 } },
    { selector: "node[kind = 'symbol']", style: { "font-size": 11, "font-weight": 600, "text-valign": "center", "text-halign": "center", "text-margin-y": 0, "text-background-opacity": 0, "text-wrap": "wrap", "text-max-width": 250 } },
    { selector: "node[?ghost]", style: { "text-background-opacity": 0.7 } },
    {
      selector: "node:parent",
      style: {
        shape: "round-rectangle",
        "background-opacity": 0.12,
        "border-width": 1,
        "border-style": "solid",
        padding: 26,
        "text-valign": "top",
        "text-halign": "center",
        "text-margin-y": 20,
        "font-size": 12,
        "font-weight": 500,
        "text-background-opacity": 0,
        color: COLORS.muted,
        "text-max-width": 400,
        "z-index": 1,
        events: "yes",
      },
    },
    // border-width comes from data(bw) — paintNode owns it, so a blast-radius centre keeps its
    // planned/collision weight instead of being flattened back to 2px here.
    { selector: "node.center", style: { "z-index": 8 } },
    { selector: "node.center-explorer", style: { width: 34, height: 34, "overlay-color": "#ffffff", "overlay-opacity": 0.18, "overlay-padding": 4, "z-index": 11 } },
    // Heat lens, "no history": a dashed outline says "not measured", where a solid one would say
    // "measured, and the answer is zero".
    { selector: "node.h-none", style: { "border-style": "dashed" } },
    { selector: "node.hop-2", style: { opacity: 0.7 } },
    { selector: "node.hop-3", style: { opacity: 0.45 } },
    { selector: "node.stale", style: { "background-image": [NOTCH_SVG], "background-width": [8], "background-height": [8], "background-position-x": ["86%"], "background-position-y": ["12%"], "background-clip": "none", "bounds-expansion": 4 } },
    { selector: "node.hatch", style: { "background-image": [HATCH_SVG], "background-fit": ["cover"], "background-image-opacity": [0.4], "background-clip": "node" } },
    {
      selector: "node.stale.hatch",
      style: { "background-image": [HATCH_SVG, NOTCH_SVG], "background-fit": ["cover", "none"], "background-width": ["auto", 8], "background-height": ["auto", 8], "background-position-x": ["0", "86%"], "background-position-y": ["0", "12%"], "background-image-opacity": [0.4, 1], "background-clip": "none" },
    },
    {
      selector: "edge",
      style: {
        width: "data(width)",
        "line-color": "data(color)",
        "target-arrow-color": "data(color)",
        "target-arrow-shape": "triangle",
        "arrow-scale": 1.2,
        "curve-style": "bezier",
        "control-point-step-size": 24,
        label: "data(label)",
        "font-size": 11,
        color: COLORS.muted,
        "text-background-color": COLORS.bg,
        "text-background-opacity": 0.8,
        "text-background-padding": 2,
        "text-background-shape": "round-rectangle",
        "text-rotation": "none",
        "overlay-color": COLORS.selection,
        "overlay-opacity": 0,
        "overlay-padding": 4,
        "transition-property": "opacity, overlay-opacity, line-color",
        "transition-duration": t,
        "transition-timing-function": "ease-out",
        "z-index": 2,
      },
    },
    // --- Services and Data flow (§4) -------------------------------------------------------------
    // A service, a step and a response are all labelled *inside* the shape, in two lines: what it is
    // called, then what it is and who provides it. 11px is what fits 26 characters in 170px.
    {
      selector: "node[svc = 'service'], node[svc = 'step'], node[svc = 'entry'], node[svc = 'endpoint'], node[svc = 'function'], node[svc = 'method'], node[svc = 'class'], node[svc = 'response'], node[svc = 'client event'], node[svc = 'client effect']",
      style: { "font-size": 11, "font-weight": 600, "text-wrap": "wrap", "text-max-width": "data(textMax)", "text-valign": "center", "text-halign": "center", "text-margin-y": 0, "text-background-opacity": 0, "min-zoomed-font-size": 6, "line-height": 1.3 },
    },
    { selector: "node.unused", style: { "border-style": "dashed" } },
    // Edges without a source-backed semantic value are drawn back so the eye lands on the steps
    // whose arguments, boundary shape, or return expressions the repo does state.
    { selector: "edge[valueEvidence = 'none']", style: { opacity: 0.5 } },
    { selector: "edge[labelColor]", style: { color: "data(labelColor)" } },
    { selector: "edge[svc = 'step']", style: { "font-size": 11, "min-zoomed-font-size": 7, "text-max-width": 150, "text-wrap": "ellipsis", "text-background-opacity": 0.9 } },
    { selector: "edge[svc = 'op']", style: { "font-size": 11, "min-zoomed-font-size": 6, "font-weight": 600 } },
    { selector: "edge.straight", style: { "curve-style": "straight" } },
    { selector: "edge[kind = 'ipc']", style: { "line-style": "dotted", "line-color": AREA_HUES[2], "target-arrow-color": AREA_HUES[2] } },
    { selector: "edge[kind = 'tests']", style: { "line-style": "dotted", "line-color": COLORS.knowNone, "target-arrow-color": COLORS.knowNone, width: 1 } },
    { selector: "edge[kind = 'touches']", style: { "line-style": "dashed", "line-color": COLORS.warn, "target-arrow-color": COLORS.warn } },
    { selector: "edge[kind = 'same-org']", style: { "line-style": "dashed", "line-color": COLORS.muted, "target-arrow-shape": "none" } },
    { selector: "edge[kind = 'depends-on']", style: { width: 1.5, "line-color": COLORS.muted, "target-arrow-color": COLORS.muted } },
    { selector: "edge[confidence = 'heuristic']", style: { "line-style": "dotted" } },
    // A cycle keeps the ordinary edge colour and is distinguished by a dashed stroke (the returning
    // edge also carries a ↺). Nine of the repo map's seventeen edges are cycle members; drawing them
    // in `--bad` turned the default landing map into an alarm and left no colour for a real problem.
    { selector: "edge.cycle", style: { "line-style": "dashed", "line-dash-pattern": [7, 4] } },
    // Level 3: spokes from the centre read first; neighbour-to-neighbour links stay a background mesh (F10).
    { selector: "edge.spoke", style: { opacity: 0.55 } },
    { selector: "edge.peripheral", style: { width: 0.8, "line-color": COLORS.lineStrong, "target-arrow-color": COLORS.lineStrong, opacity: 0.3, "z-index": 1 } },
    // Temporary direction highlight (hover)
    { selector: "node.up", style: { "border-color": COLORS.up, "border-width": 2, "z-index": 9 } },
    { selector: "node.down", style: { "border-color": COLORS.down, "border-width": 2, "z-index": 9 } },
    { selector: "edge.up", style: { "line-color": COLORS.up, "target-arrow-color": COLORS.up, "z-index": 9 } },
    { selector: "edge.down", style: { "line-color": COLORS.down, "target-arrow-color": COLORS.down, "z-index": 9 } },
    // Story highlight, soft (reading) highlight, dim, selection — achromatic (§1.5)
    { selector: ".dim", style: { opacity: 0.35 } },
    { selector: "node.soft", style: { "overlay-opacity": 0.12 } },
    { selector: "node.hl", style: { "border-color": COLORS.selection, "border-width": 2, "overlay-opacity": 0.25, "min-zoomed-font-size": 0, opacity: 1, "z-index": 10 } },
    { selector: "node.hl[?ghost]", style: { opacity: 1 } },
    // A highlighted edge always shows its label, whatever the zoom — the same promise `.hl` makes for
    // a node's label. On the flow map that is what makes reading the story walk the flow: the step
    // the paragraph is about lights up *with its value summary*, at a zoom where nothing else is labelled.
    { selector: "edge.hl", style: { "line-color": COLORS.edgeActive, "target-arrow-color": COLORS.edgeActive, "overlay-opacity": 0.18, opacity: 1, "min-zoomed-font-size": 0, "z-index": 10 } },
    { selector: "node:selected", style: { "border-color": COLORS.selection, "border-width": 2, "overlay-opacity": 0.25, "min-zoomed-font-size": 0, "z-index": 10 } },
    { selector: "edge:selected", style: { "line-color": COLORS.edgeActive, "target-arrow-color": COLORS.edgeActive } },
    { selector: "node:active", style: { "overlay-opacity": 0.18 } },
    { selector: "edge:active", style: { "overlay-opacity": 0.12 } },
  ];
}

// ---------------------------------------------------------------------------
// createMap
// ---------------------------------------------------------------------------

/** The no-op surface returned when the renderer is missing (spec §3.1 renderer failure). */
function stubMap() {
  const noop = () => {};
  return {
    show: noop,
    setLens: noop,
    highlight: noop,
    softHighlight: noop,
    clearHighlight: noop,
    select: noop,
    resolveRef: () => null,
    fit: noop,
    relayout: noop,
    zoom: noop,
    on: () => () => {},
    destroy: noop,
    setControls: noop,
    getView: () => null,
    isReady: () => false,
    available: false,
    cy: null,
  };
}

let dagreRegistered = false;
function registerDagre() {
  if (dagreRegistered) return true;
  const cyto = typeof window !== "undefined" ? window.cytoscape : null;
  const ext = typeof window !== "undefined" ? window.cytoscapeDagre : null;
  if (!cyto || !ext) return false;
  try {
    cyto.use(ext);
  } catch {
    /* already registered */
  }
  dagreRegistered = true;
  return true;
}

/**
 * Create the map on `container` (the #cy div). Options:
 *   repo        — used for the positions cache key
 *   stage       — the positioned wrapper (default: container.parentElement / #map-stage)
 *   ids         — { toolbar, extra, legend, footer, tip, tests } element ids (defaults from DOM-CONTRACT)
 *   wireToolbar — when true, map.js wires Fit / − / + / Re-layout / Show tests itself (app.js normally does)
 *   motion      — false disables every animation (same as prefers-reduced-motion)
 */
export function createMap(container, opts = {}) {
  if (opts.motion === false) setMotion(false);
  const hasRenderer = typeof window !== "undefined" && Boolean(window.cytoscape && window.dagre && window.cytoscapeDagre) && registerDagre();
  if (!container || !hasRenderer) {
    const stub = stubMap();
    stub.legendFor = legendFor;
    return stub;
  }

  const ids = { toolbar: "toolbar", extra: "tb-extra", legend: "legend", footer: "map-footer", tip: "map-tip", tests: "tb-tests", fit: "tb-fit", zoomIn: "tb-zoom-in", zoomOut: "tb-zoom-out", relayout: "tb-relayout", ...(opts.ids ?? {}) };
  const stage = opts.stage ?? container.closest?.(".map-stage") ?? container.parentElement ?? document.body;
  const listeners = new Map();
  const emit = (event, ...args) => {
    let handled = false;
    for (const fn of listeners.get(event) ?? []) {
      handled = true;
      try {
        fn(...args);
      } catch (err) {
        console.error(err);
      }
    }
    return handled;
  };

  let cy = null;
  let model = null;
  let lens = "structure";
  let controls = { tests: false, depth: 1, direction: "both", mode: "both" };
  let repo = opts.repo ?? "repo";
  let pending = null;
  let currentLayout = null;
  let layoutGen = 0;
  let fitTimer = null;
  let fitGen = 0; // bumped by every fit and every cancellation; a stale fit checks it before landing
  let fitPending = false; // a scheduled fit that has not run yet; show() must not lose it
  let lastSize = null;
  let resizeTimer = null;
  let lastLayoutDir = null; // rank direction the current positions were computed for
  let lastLayoutAspect = null; // canvas aspect the current positions were shaped for
  let lastLegendSize = null; // legend card size the last fit reserved room for
  let isolated = null; // { key, ids: Set }
  let hoverId = null;
  let footerText = "";
  let destroyed = false;
  let lastTapAt = 0;

  const tip = ensureTip();

  // -- Instance creation once the container has size ---------------------------------------------
  const ro = typeof ResizeObserver === "function" ? new ResizeObserver(onResize) : null;
  if (ro) ro.observe(container);
  else setTimeout(() => onResize([{ contentRect: container.getBoundingClientRect() }]), 0);

  /** The canvas's shape, the one number a layout has to agree with. */
  function canvasAspect() {
    const w = cy?.width() ?? 0;
    const h = cy?.height() ?? 0;
    return w > 0 && h > 0 ? w / h : null;
  }

  /**
   * The container changed size — window resize, the 1100px stacked breakpoint, a pane folding or opening, the
   * reader drawer opening or being dragged. `cy.resize()` first, always: a Cytoscape instance that
   * has not been told its canvas grew computes every fit against the old viewport, which is how a
   * grown window ended up still zoomed for the small one and a shrunk one ended up at minZoom with
   * every node on top of every other (F-MAP-01).
   */
  function onResize(entries) {
    if (destroyed) return;
    const rect = entries?.[0]?.contentRect ?? container.getBoundingClientRect();
    if (!(rect.width > 0 && rect.height > 0)) return;
    if (!cy) {
      lastSize = { w: rect.width, h: rect.height };
      createInstance();
      return;
    }
    cy.resize();
    syncLegendShape();
    // The drawer and the breakpoint animate, so the observer fires once per frame with a size that is
    // barely different from the last one. Compare against the size we last fitted for — not the last
    // event — and settle before acting, or a smooth resize slips through in 2% steps.
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(settleResize, 120);
  }

  function settleResize() {
    if (destroyed || !cy || !cy.elements().length) return;
    const w = cy.width();
    const h = cy.height();
    if (!(w > 0 && h > 0)) return;
    const prev = lastSize;
    if (prev && Math.abs(w - prev.w) <= prev.w * 0.02 && Math.abs(h - prev.h) <= prev.h * 0.02) return;
    // A canvas that changed shape needs a differently *shaped* graph, not just a new zoom: a ladder
    // laid out for a tall pane fills a third of a wide one however it is zoomed. Re-run dagre — which
    // re-shapes to the new pane and fits when it lands — whenever the aspect moved appreciably or the
    // rank direction should now run the other way; otherwise a fit is all the change needs.
    const aspect = canvasAspect();
    const reshaped = lastLayoutAspect && aspect ? Math.abs(Math.log(aspect / lastLayoutAspect)) > 0.12 : true;
    const turned = model?.layout?.name === "dagre" && lastLayoutDir && rankDirFor(model.layout.rankDir) !== lastLayoutDir;
    if (model?.layout && (reshaped || turned)) {
      // A layout that is still animating cannot be re-shaped from under itself — and the re-shape
      // must not be dropped either. Arriving at the area map from the workspace, whose 320px-tall
      // pane the layout had just been stretched 3.5x wide for, the pane grew to 459 while the
      // animation was running; the re-shape was skipped, a plain fit ran instead, and the map stayed
      // 3288px wide in a 1000px pane — 31% of the height, and no later event ever asked again
      // (F-MAP-A). `lastSize` stays untouched so the change is still outstanding on the way back.
      if (currentLayout) {
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(settleResize, dur(MOTION.move) + 80);
        return;
      }
      lastSize = { w, h };
      runDagre(model, positionsKey(repo, model.level, model.root));
      return;
    }
    lastSize = { w, h };
    fit();
  }

  /**
   * A 45%-tall legend card silently clips its own last rows on a short canvas — the stacked
   * breakpoint, or a tall reader drawer. When that happens, lay it out as one scrollable row under
   * the toolbar instead of a card whose overflow nobody can see (F04).
   */
  function syncLegendShape() {
    const el = document.getElementById(ids.legend);
    if (!el || !cy) return;
    const h = cy.height();
    if (!(h > 0)) return;
    const wasRow = el.classList.contains("is-row");
    if (wasRow) el.classList.remove("is-row"); // measure as a card before deciding to stay a row
    const clipped = el.scrollHeight > el.clientHeight + 2;
    const tall = el.getBoundingClientRect().height > h * 0.4;
    el.classList.toggle("is-row", h < 560 && (clipped || tall));
  }

  function createInstance() {
    cy = window.cytoscape({
      container,
      elements: [],
      style: stylesheet(),
      minZoom: 0.1,
      maxZoom: 4,
      boxSelectionEnabled: false,
      selectionType: "single",
      autoungrabify: false,
      pixelRatio: "auto",
      textureOnViewport: false,
      hideEdgesOnViewport: false,
    });
    wireEvents();
    emit("ready", cy);
    // Debug handle: the browser verification pass reads zoom, colours and label boxes through it.
    try {
      if (typeof window !== "undefined") window.__reggieMap = { cy, getModel: () => model, getLens: () => lens, fit: () => fit({ explicit: true }) };
    } catch {
      /* no window */
    }
    if (pending) {
      const p = pending;
      pending = null;
      show(p.view, p.opts);
    }
  }

  // -- Show / diff / layout --------------------------------------------------------------------------
  function show(view, showOpts = {}) {
    if (destroyed) return;
    if (!cy) {
      pending = { view, opts: showOpts };
      return;
    }
    if (showOpts.repo) repo = showOpts.repo;
    if (showOpts.lens) lens = showOpts.lens;
    controls = {
      tests: showOpts.tests ?? controls.tests,
      depth: showOpts.depth ?? controls.depth,
      direction: showOpts.direction ?? controls.direction,
      mode: showOpts.mode ?? controls.mode,
      all: showOpts.all ?? controls.all,
    };
    const prevModel = model;
    const next = buildModel(view, { level: showOpts.level, lens, task: showOpts.task ?? showOpts.slug ?? null, areaCompounds: showOpts.areaCompounds });
    model = next;
    const sameScope = prevModel && prevModel.level === next.level && prevModel.root === next.root;

    // Previous positions for the animation source (ghost swap: strip ghost prefixes both ways).
    const prevPos = new Map();
    for (const n of cy.nodes()) prevPos.set(n.id(), { ...n.position() });
    const prevPosFor = (id) => {
      if (prevPos.has(id)) return prevPos.get(id);
      const base = ghostTarget(id);
      if (prevPos.has(base)) return prevPos.get(base);
      for (const pre of ["ghost:up:", "ghost:down:"]) if (prevPos.has(pre + base)) return prevPos.get(pre + base);
      return null;
    };
    const viewportCenter = () => {
      const ext = cy.extent();
      return { x: (ext.x1 + ext.x2) / 2, y: (ext.y1 + ext.y2) / 2 };
    };

    // The previous view's layout and fit are both still in the air when a reader clicks through
    // quickly. Stop the layout, drop the queued fit *and* the animation it was already playing:
    // a fit computed for the graph that has just been replaced must never land on this one, and
    // Cytoscape will happily play it a beat later if nobody stops it (F-MAP-A).
    if (currentLayout) {
      try {
        currentLayout.stop();
      } catch {
        /* ignore */
      }
      currentLayout = null;
    }
    const hadPendingFit = fitPending;
    clearTimeout(fitTimer);
    fitTimer = null;
    fitPending = false;
    cancelViewport();

    const nextIds = new Set(next.nodes.map((n) => n.id));
    const existingIds = new Set(cy.nodes().map((n) => n.id()));
    const removed = cy.nodes().filter((n) => !nextIds.has(n.id()));
    const added = next.nodes.filter((n) => !existingIds.has(n.id));
    const nodeSetChanged = removed.length > 0 || added.length > 0;
    const additionsOnly = sameScope && removed.length === 0 && added.length > 0;
    // Showing tests adds nodes beside the files they test, which keeps the map still under the
    // reader's eye — but `placeIncrementally` only knows about shapes, not about the 150px labels
    // that hang under them, so nine test files arriving at once piled nine labels into one smear.
    // A handful can be slotted in; a crowd gets a proper layout.
    const testOnlyChange = additionsOnly && added.length <= 3 && added.every((n) => n.role === "test" || n.role === "fixture");
    const keep = showOpts.keepPositions === true || testOnlyChange;

    isolated = null;
    hoverId = null;
    hideTip();

    cy.batch(() => {
      cy.remove(removed);
      cy.remove(cy.edges());
      // Parents must exist before children: add compounds first.
      const ordered = next.nodes.slice().sort((a, b) => Number(b.compound) - Number(a.compound));
      for (const nd of ordered) {
        const data = nodeData(nd);
        const ele = cy.getElementById(nd.id);
        if (ele.length) {
          ele.data(data);
          const curParent = ele.parent().length ? ele.parent().id() : null;
          if (curParent !== (nd.parent ?? null)) ele.move({ parent: nd.parent ?? null });
        } else {
          const start = prevPosFor(nd.id) ?? (nd.parent && nd.parent === next.compoundId ? prevPosFor(next.compoundId) : null);
          const el = { group: "nodes", data, classes: "" };
          if (!nd.compound) el.position = start ? { ...start } : neighbourStart(nd, next, prevPos) ?? viewportCenter();
          cy.add(el);
        }
      }
      for (const e of next.edges) {
        cy.add({ group: "edges", data: edgeData(e, next), classes: edgeClasses(e, next) });
      }
      applyLens(lens);
    });

    renderToolbar();
    renderLegend();
    setFooter(footerFor(next, { ...controls, lens }));
    renderEmptyState(next);
    maybeShowTests();

    const key = positionsKey(repo, next.level, next.root);
    const cached = store.get(key);
    const layoutIds = next.nodes.filter((n) => !n.compound).map((n) => n.id);
    // A layout computed for a landscape canvas is the wrong shape for a portrait one, so the cache is
    // only reusable while the rank direction still matches (F01/F04).
    const wantDir = next.layout?.name === "dagre" ? (next.layout.fixedDir ? next.layout.rankDir : rankDirFor(next.layout.rankDir)) : null;
    const dirOk = !wantDir || !cached?.dir || cached.dir === wantDir;
    // Positions are shaped to the pane they were computed in (see `fillTarget`), so a cache written
    // for a differently shaped pane is the wrong shape here whatever its rank direction says.
    const nowAspect = canvasAspect();
    const aspectOk = !cached?.aspect || !nowAspect || Math.abs(Math.log(nowAspect / cached.aspect)) <= 0.12;
    const cacheCoversAll = cached?.pos && dirOk && aspectOk && layoutIds.every((id) => cached.pos[id]);

    if (!nodeSetChanged && sameScope) {
      // Only data changed (lens, weights): never move anything. The *viewport* may still owe a move:
      // a lens with more legend rows grows the card the fit keeps clear of, and `renderLegend` asks
      // for a fit when that happens. A second show() for the same nodes (a lens deep link renders the
      // level twice) cleared that pending fit above and would not ask again, because by then the
      // legend has not changed size since — and six nodes sat under the Heat legend.
      if (hadPendingFit) scheduleFit(60);
      return;
    }
    if (keep && !cacheCoversAll) {
      // Show tests / explicit keep: place only the new nodes next to their neighbours.
      placeIncrementally(added, next);
      savePositions(key);
      scheduleFit();
      return;
    }
    if (cacheCoversAll && cacheUsable(cached.pos, next)) {
      lastLayoutDir = cached.dir ?? wantDir ?? lastLayoutDir;
      lastLayoutAspect = cached.aspect ?? nowAspect ?? lastLayoutAspect;
      runPreset(cached.pos, key);
    } else {
      runDagre(next, key);
    }
  }

  function neighbourStart(nd, next, prevPos) {
    const neigh = [];
    for (const e of next.edges) {
      if (e.source === nd.id && prevPos.has(e.target)) neigh.push(prevPos.get(e.target));
      if (e.target === nd.id && prevPos.has(e.source)) neigh.push(prevPos.get(e.source));
    }
    if (!neigh.length) return null;
    const x = neigh.reduce((s, p) => s + p.x, 0) / neigh.length;
    const y = neigh.reduce((s, p) => s + p.y, 0) / neigh.length;
    return { x, y };
  }

  function placeIncrementally(added, next) {
    const placed = new Map();
    for (const n of cy.nodes()) if (!added.some((a) => a.id === n.id())) placed.set(n.id(), { ...n.position() });
    added.forEach((nd, i) => {
      const ele = cy.getElementById(nd.id);
      if (!ele.length || nd.compound) return;
      const targets = [];
      const sources = [];
      for (const e of next.edges) {
        if (e.source === nd.id && placed.has(e.target)) targets.push(placed.get(e.target));
        if (e.target === nd.id && placed.has(e.source)) sources.push(placed.get(e.source));
      }
      const anchor = targets[0] ?? sources[0] ?? null;
      let pos;
      if (anchor) {
        const above = targets.length > 0; // a test imports its subject: put it above
        pos = { x: anchor.x + ((i % 3) - 1) * 36, y: anchor.y + (above ? -1 : 1) * (56 + Math.floor(i / 3) * 24) };
      } else {
        const bb = cy.nodes().boundingBox();
        pos = { x: bb.x1 + 40 + (i % 6) * 60, y: bb.y2 + 60 + Math.floor(i / 6) * 40 };
      }
      const d = dur(MOTION.move);
      if (d > 0) ele.animate({ position: pos }, { duration: d, easing: "ease-out" });
      else ele.position(pos);
      placed.set(nd.id, pos);
    });
  }

  function runPreset(pos, key) {
    const layout = cy.layout({
      name: "preset",
      positions: (node) => (node.isParent() ? undefined : pos[node.id()] ?? undefined),
      fit: false,
      animate: dur(MOTION.move) > 0,
      animationDuration: dur(MOTION.move),
      animationEasing: "ease-out",
    });
    currentLayout = layout;
    const gen = ++layoutGen;
    // Cytoscape fires `layoutstop` when a layout is *stopped* as well as when it finishes, and show()
    // stops the running layout on every navigation. Saving there wrote half-animated coordinates to
    // the positions cache and corrupted that URL's layout for good (F2). Only a layout that ran to
    // completion, and is still the current one, gets to persist — and it persists the targets it was
    // given, not whatever the canvas happens to show.
    let finished = false;
    const finish = () => {
      if (finished || gen !== layoutGen || currentLayout !== layout) return;
      finished = true;
      currentLayout = null;
      // The position animation is driven by requestAnimationFrame too, so it can stall exactly like
      // the fit can (F-MAP-01). Whatever the animation did or did not do, the targets are known: put
      // any node that has not reached its target there before fitting, so the fit is computed
      // against the layout that was actually decided and never against a half-finished one.
      cy.batch(() => {
        for (const n of cy.nodes()) {
          if (n.isParent()) continue;
          const p = pos[n.id()];
          if (!p) continue;
          const c = n.position();
          if (Math.abs(c.x - p.x) > 0.5 || Math.abs(c.y - p.y) > 0.5) {
            n.stop();
            n.position({ x: p.x, y: p.y });
          }
        }
      });
      savePositions(key, pos);
      scheduleFit();
    };
    layout.one("layoutstop", finish);
    layout.run();
    // Backstop for a `layoutstop` that never arrives (a hidden or throttled tab): the map must not be
    // left fitted to the canvas it had before the resize.
    setTimeout(finish, dur(MOTION.move) + 160);
  }

  function runDagre(next, key) {
    // Dagre runs synchronously (no animation), the ghost rows are pushed into clean bands above and
    // below the compound (§2 Level 2), then every node animates from where it was to its target.
    const spec = next.layout;
    const before = new Map();
    for (const n of cy.nodes()) if (!n.isParent()) before.set(n.id(), { ...n.position() });
    const target = {};
    if (spec.name === "row") {
      // Workspace without edges: a single row spaced 48px.
      let x = 0;
      cy.nodes().forEach((n) => {
        if (n.isParent()) return;
        target[n.id()] = { x: x + n.width() / 2, y: 0 };
        x += n.width() + spec.gap;
      });
    } else if (spec.name === "bipartite") {
      // The Services map (§4): "the files on the left, grouped; the services on the right, ranked"
      // *is* the layout, so the builder places every node and nothing here re-derives it.
      for (const nd of next.nodes) if (nd.pos && !nd.compound) target[nd.id] = { ...nd.pos };
    } else {
      // The graph should be shaped like the canvas it has to fit in: a wide, short map column wants
      // ranks running left to right, a tall one wants them top to bottom (F04). Guessing from the
      // canvas alone is not enough — a chain of ten sub-areas laid top-to-bottom in a 805x740 pane
      // came out 596x1111 and hung 141px off the bottom edge (F3). Both directions are laid out and
      // the one that actually fits better wins; the passes below run on each candidate, since they
      // change the shape as much as the ranking does.
      // A flow reads left to right because that is what a flow is (§4); it does not get to be
      // re-ranked into a column because the pane is portrait.
      const first = spec.fixedDir ? spec.rankDir : rankDirFor(spec.rankDir);
      const dirs = spec.fixedDir ? [first] : first === "TB" ? ["TB", "LR"] : ["LR", "TB"];
      let bestScore = -Infinity;
      let bestDir = first;
      let bestTarget = null;
      for (const dir of dirs) {
        const l = cy.layout({ ...spec, rankDir: dir, animate: false, fit: false });
        l.run();
        const candidate = {};
        for (const n of cy.nodes()) if (!n.isParent()) candidate[n.id()] = { ...n.position() };
        if (spec.grid) gridRanks(candidate, next);
        else if (!spec.shaped) {
          wrapWideRanks(candidate, next);
          bandExplorer(candidate, next);
          spreadLabelBoxes(candidate, next);
          if (next.level === "dir") bandGhosts(candidate, next);
        }
        const score = layoutScore(candidate, next);
        if (score > bestScore + 0.001) {
          bestScore = score;
          bestDir = dir;
          bestTarget = candidate;
        }
      }
      lastLayoutDir = bestDir;
      Object.assign(target, bestTarget ?? {});
    }
    // dagre has decided the structure; this decides how much of the pane it occupies. The flow opts
    // in (`fill`), because a short flow is otherwise a flat band across a portrait pane at a third of
    // the readable zoom, and these passes only scale gaps and move whole ranks in order. The
    // bipartite Services map opts out: it is already shaped to the pane, and the same passes stretch
    // its two columns apart until the files are off one edge and the services off the other.
    if (!spec.shaped || spec.fill) fillTarget(target, next);
    lastLayoutAspect = canvasAspect();
    cy.batch(() => {
      for (const n of cy.nodes()) if (!n.isParent() && before.has(n.id())) n.position(before.get(n.id()));
    });
    runPreset(target, key);
  }

  /**
   * Shape a finished layout to the box it has to fill.
   *
   * dagre knows about ranks, not about the pane it is drawn in, so its output has whatever aspect the
   * graph happens to have: on the repo map a 470x735 ladder in an 871x660 box, which fits at a zoom
   * where the graph covers half the canvas width and the rest is empty (F-MAP-01); on the file
   * explorer three nodes in a 150px column that fit only by zooming past the readable cap, leaving a
   * speck in the middle of the pane (F-MAP-02). Node sizes are fixed, so this moves *positions* only:
   * the gaps between nodes change, the shapes and their labels do not.
   *
   * Four passes, each a no-op when it is not needed:
   *   1. Shear, for a layout with no spread at all on one axis (a focus file with one importer and
   *      one import is a vertical line, and no amount of scaling makes a line wide). Rows keep their
   *      y and their internal order; the composition runs from the importers at the top left to the
   *      imports at the bottom right.
   *   2. Stretch the short axis, so the drawn box has the shape of the box it sits in.
   *   3. Spread, so that box *is* the box it sits in: at the readable zoom cap a small graph would
   *      otherwise be a small graph in a large pane.
   *   4. Fill both axes, by *placing* rather than scaling. Passes 2 and 3 widen the gaps between
   *      nodes, which does nothing at all for an axis the layout has no gaps on: board.js and its
   *      two neighbours drew a left-to-right band across 97% of the width and 7% of the height, and
   *      stretching a band 14 times taller still leaves a band (F-MAP-B). When an axis still ends up
   *      under `MIN_AXIS_FILL` of the pane, the nodes are dealt out along it in rows instead.
   */
  const FILL_ZOOM = 1; // the zoom a freshly shaped layout is meant to fit at: 12px labels at 12px
  const MAX_STRETCH = 3.5; // one axis may be stretched this much relative to the layout's own spread
  const MAX_SPREAD = 24; // and a whole layout pushed apart this much to fill a pane it is lost in
  const MIN_AXIS_FILL = 0.45; // an axis drawn thinner than this share of the pane is empty space

  function fillTarget(target, next) {
    if (!cy) return;
    const byId = new Map(next.nodes.map((n) => [n.id, n]));
    const ids = Object.keys(target).filter((id) => byId.get(id) && !byId.get(id).compound);
    if (ids.length < 2) return;
    const halfW = (id) => {
      const n = byId.get(id);
      return Math.max(n.w || 20, boxW(n)) / 2;
    };
    const halfH = (id) => {
      const n = byId.get(id);
      return ((n.h || 20) + (n.kind === "file" || n.kind === "task" ? 22 : 0)) / 2;
    };
    const pad = next.compoundId ? 60 : 0; // compound padding + its label row
    const box = () => {
      let x1 = Infinity;
      let x2 = -Infinity;
      let y1 = Infinity;
      let y2 = -Infinity;
      let px1 = Infinity;
      let px2 = -Infinity;
      let py1 = Infinity;
      let py2 = -Infinity;
      for (const id of ids) {
        const p = target[id];
        x1 = Math.min(x1, p.x - halfW(id));
        x2 = Math.max(x2, p.x + halfW(id));
        y1 = Math.min(y1, p.y - halfH(id));
        y2 = Math.max(y2, p.y + halfH(id));
        px1 = Math.min(px1, p.x);
        px2 = Math.max(px2, p.x);
        py1 = Math.min(py1, p.y);
        py2 = Math.max(py2, p.y);
      }
      return { w: x2 - x1 + pad, h: y2 - y1 + pad, sx: px2 - px1, sy: py2 - py1, cx: (px1 + px2) / 2, cy: (py1 + py2) / 2 };
    };
    const avail = availableBox();
    const wantW = avail.w / FILL_ZOOM;
    const wantH = avail.h / FILL_ZOOM;
    if (!(wantW > 0 && wantH > 0)) return;
    const fillAxis = (axis) => fillAxisIn(axis, { target, next, ids, box, halfW, halfH, wantW, wantH });
    const scaleX = (k, cx) => {
      for (const id of ids) target[id] = { x: cx + (target[id].x - cx) * k, y: target[id].y };
    };
    const scaleY = (k, cy0) => {
      for (const id of ids) target[id] = { x: target[id].x, y: cy0 + (target[id].y - cy0) * k };
    };

    // 1. Shear a degenerate axis into existence (explorer bands only; a container ladder always has
    //    width, and shearing the workspace row would tilt a deliberate straight line).
    let b = box();
    if (next.level === "impact" && b.sy > 60 && b.sx < wantW * 0.25 && b.w < wantW * 0.5) {
      const s = clamp((wantW * 0.78 - b.w) / b.sy, 0, 3);
      if (s > 0.05) for (const id of ids) target[id] = { x: target[id].x + s * (target[id].y - b.cy), y: target[id].y };
    }

    // 2. Stretch the short axis to the pane's aspect ratio.
    b = box();
    const want = wantW / wantH;
    const aspect = b.w / b.h;
    if (aspect < want * 0.92 && b.sx > 4) {
      const k = clamp(1 + (b.h * want - b.w) / b.sx, 1, MAX_STRETCH);
      if (k > 1.01) scaleX(k, b.cx);
    } else if (aspect > want * 1.08 && b.sy > 4) {
      const k = clamp(1 + (b.w / want - b.h) / b.sy, 1, MAX_STRETCH);
      if (k > 1.01) scaleY(k, b.cy);
    }

    // 3. Spread until the box fills the pane at the readable zoom.
    b = box();
    const z0 = Math.min(wantW / b.w, wantH / b.h);
    if (z0 > 1.02) {
      if (b.sx > 4) {
        const k = clamp(1 + (b.w * z0 - b.w) / b.sx, 1, MAX_SPREAD);
        if (k > 1.01) scaleX(k, b.cx);
      }
      if (b.sy > 4) {
        const k = clamp(1 + (b.h * z0 - b.h) / b.sy, 1, MAX_SPREAD);
        if (k > 1.01) scaleY(k, b.cy);
      }
    }

    // 4. Fill both axes (see the header). The workspace row is exempt: one straight line of repos is
    //    what §2 Level 0 asks for, not a layout that failed to spread.
    if (next.level !== "workspace" && next.layout?.name !== "row") {
      fillAxis("y");
      fillAxis("x");
    }
    for (const id of ids) target[id] = { x: Math.round(target[id].x), y: Math.round(target[id].y) };
  }

  /**
   * Deal the nodes out along one axis so the drawing has a real extent on it.
   *
   * Only runs when the axis is nearly empty — under `MIN_AXIS_FILL` of the pane at the zoom this
   * layout would fit at — and only by moving whole rows, so what the layout already says stays said:
   * nodes that share a coordinate on this axis keep sharing one, and the order along it is kept. The
   * explorer's order along y *is* its direction encoding (upstream above the focus, downstream
   * below, deepest hop furthest out), so that is the key it is ordered by rather than the coordinate
   * a sheared or scaled pass happened to leave behind.
   *
   * The rows are spaced to fill the box, never past it: the fit that follows then lands at about
   * FILL_ZOOM, comfortably under the readable zoom cap, instead of blowing three nodes up to fill a
   * pane.
   */
  function fillAxisIn(axis, ctx) {
    const { target, next, ids, box, halfW, halfH, wantW, wantH } = ctx;
    const b = box();
    const zFit = Math.min(FIT_MAX_ZOOM, Math.min(wantW / b.w, wantH / b.h));
    const drawn = axis === "x" ? b.w * zFit : b.h * zFit;
    const pane = axis === "x" ? cy.width() || wantW : cy.height() || wantH;
    if (drawn >= pane * MIN_AXIS_FILL) return;
    const want = axis === "x" ? wantW : wantH;
    // Only an axis the layout has next to no spread on is re-dealt. An axis with real structure that
    // merely came out short is passes 2 and 3's business — scaling keeps the ranks, and dealing rows
    // out along an axis the layout is already using would take a wrapped band apart.
    if ((axis === "x" ? b.sx : b.sy) > want * 0.25) return;
    const half = axis === "x" ? halfW : halfH;
    const byId = new Map(next.nodes.map((n) => [n.id, n]));

    // The key each row is identified and ordered by.
    const explorerY = axis === "y" && next.level === "impact" && !next.isBlast;
    const keyOf = (id) => {
      if (explorerY) {
        const n = byId.get(id);
        if (n.center) return 0;
        const hop = Math.max(1, Math.abs(n.hop ?? 1));
        return (n.side === "down" ? 1 : -1) * hop;
      }
      return Math.round(target[id][axis] / 8) * 8;
    };
    const rows = new Map();
    for (const id of ids) {
      const k = keyOf(id);
      if (!rows.has(k)) rows.set(k, []);
      rows.get(k).push(id);
    }
    const keys = Array.from(rows.keys()).sort((a, c) => a - c);
    if (keys.length < 2) return; // one row: there is nothing to spread along this axis

    const thickness = keys.map((k) => Math.max(...rows.get(k).map((id) => half(id) * 2)));
    const total = thickness.reduce((a, c) => a + c, 0);
    const gap = (want - total) / (keys.length - 1);
    if (!(gap > 4)) return; // no room: the rows already touch
    let cursor = (axis === "x" ? b.cx : b.cy) - (total + gap * (keys.length - 1)) / 2;
    keys.forEach((k, i) => {
      const at = cursor + thickness[i] / 2;
      for (const id of rows.get(k)) target[id] = { ...target[id], [axis]: at };
      cursor += thickness[i] + gap;
    });
  }

  /** The zoom a candidate layout would fit at; higher is better. Compound padding is approximated. */
  function layoutScore(target, next) {
    const byId = new Map(next.nodes.map((n) => [n.id, n]));
    let x1 = Infinity;
    let x2 = -Infinity;
    let y1 = Infinity;
    let y2 = -Infinity;
    for (const [id, p] of Object.entries(target)) {
      const nd = byId.get(id);
      if (!nd || nd.compound) continue;
      const w = Math.max(nd.w || 20, boxW(nd));
      const h = (nd.h || 20) + (nd.kind === "file" || nd.kind === "task" ? 20 : 0);
      x1 = Math.min(x1, p.x - w / 2);
      x2 = Math.max(x2, p.x + w / 2);
      y1 = Math.min(y1, p.y - h / 2);
      y2 = Math.max(y2, p.y + h / 2);
    }
    const w = x2 - x1;
    const h = y2 - y1;
    if (!(w > 0 && h > 0)) return 0;
    const pad = next.compoundId ? 60 : 0; // compound padding + its label row
    const availW = Math.max(80, (cy.width() || 800) - 140);
    const availH = Math.max(80, (cy.height() || 600) - 140);
    return Math.min(availW / (w + pad), availH / (h + pad));
  }

  /** Ranks run across the long side of the canvas; `fallback` wins when the canvas has no size yet. */
  function rankDirFor(fallback) {
    const cw = cy.width();
    const ch = cy.height();
    if (!(cw > 0 && ch > 0)) return fallback;
    return cw / ch > 1.4 ? "LR" : "TB";
  }

  /**
   * dagre is happy to put ten children in one rank; in a portrait canvas that is a 1372x628 box that
   * fits at 0.53 and renders 12px labels at 6.3px (F02). Any rank wider than sqrt(n) is wrapped into
   * stacked sub-rows and everything below it moves down to make room.
   */
  function wrapWideRanks(target, next) {
    if (next.level === "impact" && !next.isBlast) return; // bandExplorer places these
    const cw = cy.width();
    const ch = cy.height();
    if (!(cw > 0 && ch > 0)) return;
    const byId = new Map(next.nodes.map((n) => [n.id, n]));
    const ids = Object.keys(target).filter((id) => byId.get(id) && !byId.get(id).compound && !byId.get(id).ghost);
    if (ids.length < 6) return;
    const box = () => {
      let x1 = Infinity;
      let x2 = -Infinity;
      let y1 = Infinity;
      let y2 = -Infinity;
      for (const id of ids) {
        const n = byId.get(id);
        const p = target[id];
        x1 = Math.min(x1, p.x - (n.w || 20) / 2);
        x2 = Math.max(x2, p.x + (n.w || 20) / 2);
        y1 = Math.min(y1, p.y - (n.h || 20) / 2);
        y2 = Math.max(y2, p.y + (n.h || 20) / 2);
      }
      return { x1, x2, y1, y2, w: x2 - x1, h: y2 - y1 };
    };
    const bb = box();
    if (!(bb.w > 0 && bb.h > 0)) return;
    if (bb.w / bb.h <= (cw / ch) * 1.4) return;

    const ranks = new Map();
    for (const id of ids) {
      const key = Math.round(target[id].y);
      if (!ranks.has(key)) ranks.set(key, []);
      ranks.get(key).push(id);
    }
    const perRow = Math.max(2, Math.ceil(Math.sqrt(ids.length)));
    const sep = next.layout.nodeSep ?? 28;
    let shift = 0;
    for (const key of Array.from(ranks.keys()).sort((a, b) => a - b)) {
      const rank = ranks.get(key).sort((a, b) => target[a].x - target[b].x);
      for (const id of rank) target[id] = { ...target[id], y: target[id].y + shift };
      if (rank.length <= perRow) continue;
      const rows = Math.ceil(rank.length / perRow);
      const per = Math.ceil(rank.length / rows);
      const rowH = Math.max(...rank.map((id) => byId.get(id).h || 20)) + 12;
      const centre = rank.reduce((sum, id) => sum + target[id].x, 0) / rank.length;
      for (let r = 0; r < rows; r += 1) {
        const row = rank.slice(r * per, (r + 1) * per);
        if (!row.length) continue;
        const width = row.reduce((sum, id) => sum + (byId.get(id).w || 20), 0) + sep * (row.length - 1);
        let x = centre - width / 2;
        for (const id of row) {
          const w = byId.get(id).w || 20;
          target[id] = { x: x + w / 2, y: target[id].y + r * rowH };
          x += w + sep;
        }
      }
      shift += (rows - 1) * rowH;
    }
  }

  /**
   * Cytoscape draws labels with no collision avoidance, so dagre's node spacing — which only knows
   * about the shapes — left the area and file maps as word-piles: "Termin…" over "Sideb…",
   * "HiddenSes|terminal-service.ts|sTracking.ts" (F1). This widens each rank until the *label* boxes
   * clear each other and stretches wrapped sub-rows to fit the label that hangs below the node. It
   * runs on dagre's output before the preset animation, so it is deterministic and it is what gets
   * cached (acceptance 15: two loads of a URL produce the same positions).
   */
  /** 12px system text averages ~6.3px per character; the stylesheet caps a file label at 150px. */
  function labelW(nd) {
    const line = String(nd.label ?? "").split("\n").reduce((a, b) => (b.length > a.length ? b : a), "");
    const cap = nd.kind === "file" ? 150 : Math.max(60, (nd.w || 120) - 14);
    return Math.min(cap, line.length * 6.3 + 8);
  }
  /** How much horizontal room a node needs including the label that hangs below it. */
  function boxW(nd) {
    return Math.max(nd.w || 20, nd.kind === "file" || nd.kind === "task" ? labelW(nd) : 0);
  }

  /**
   * The file explorer is focus-plus-context, not a dependency ladder: importers belong in a band
   * above the focus and imports in a band below it (§2 Level 3, acceptance 9). Left to dagre, the
   * importers' own edges to each other ranked them into a ten-deep chain 1738px wide, which fitted at
   * 0.58 and rendered every label at 7px — grey specks with no readable names (F2). This replaces
   * dagre's x/y for the explorer with bands: hop 1 nearest the focus, wrapped into rows that fit the
   * canvas, widest fan-in first.
   */
  /**
   * A flow keeps dagre's left-to-right ranks and its order inside them, but a hop is allowed to be
   * more than one node wide. `onRequestPost` makes thirty-three calls in the ground-truth repo; one
   * column of thirty-three is a mile-high strip that fits only at a zoom where no label survives, so
   * a hop taller than GRID_ROWS is dealt into stacked columns *inside its own rank* and the ranks
   * after it move right. Left to right still means "later in the flow"; up and down still mean
   * nothing, which is what a rank is.
   */
  const GRID_ROWS = 13;
  function gridRanks(target, next) {
    const byId = new Map(next.nodes.map((n) => [n.id, n]));
    const ids = Object.keys(target).filter((id) => byId.get(id) && !byId.get(id).compound);
    if (ids.length < 4) return;
    const ranks = new Map();
    for (const id of ids) {
      const key = Math.round(target[id].x / 8) * 8;
      if (!ranks.has(key)) ranks.set(key, []);
      ranks.get(key).push(id);
    }
    const keys = Array.from(ranks.keys()).sort((a, b) => a - b);
    const rowH = 66;
    const colW = 200;
    const rankGap = 150; // the channel an edge label is drawn in
    let x = 0;
    for (const k of keys) {
      const list = ranks.get(k).sort((a, b) => target[a].y - target[b].y || a.localeCompare(b));
      const cols = Math.max(1, Math.ceil(list.length / GRID_ROWS));
      const rows = Math.ceil(list.length / cols);
      list.forEach((id, i) => {
        target[id] = { x: x + Math.floor(i / rows) * colW, y: ((i % rows) - (rows - 1) / 2) * rowH };
      });
      x += (cols - 1) * colW + rankGap + (byId.get(list[0])?.w ?? 170);
    }
  }

  function bandExplorer(target, next) {
    if (next.level !== "impact" || next.isBlast) return;
    const byId = new Map(next.nodes.map((n) => [n.id, n]));
    const drawn = Object.keys(target).map((id) => byId.get(id)).filter((n) => n && !n.compound);
    const centres = drawn.filter((n) => n.center);
    // Two nodes are a band too. Left to dagre a focus file with a single neighbour came out as a
    // horizontal pair — the direction encoding gone, and a flat pair is a shape no amount of scaling
    // can make tall (board.js drew 62% of the width and 9% of the height, F-MAP-B).
    if (centres.length !== 1 || drawn.length < 2) return;
    const GAPX = 14;
    const width = Math.max(360, (cy.width() || 800) - 96);
    const rowsFor = (list) => {
      const rows = [];
      let cur = [];
      let w = 0;
      for (const n of list) {
        const bw = boxW(n);
        if (cur.length && w + GAPX + bw > width) {
          rows.push(cur);
          cur = [];
          w = 0;
        }
        w += (cur.length ? GAPX : 0) + bw;
        cur.push(n);
      }
      if (cur.length) rows.push(cur);
      return rows;
    };
    const placeRow = (row, y) => {
      const total = row.reduce((sum, n) => sum + boxW(n), 0) + GAPX * (row.length - 1);
      let x = -total / 2;
      for (const n of row) {
        target[n.id] = { x: x + boxW(n) / 2, y };
        x += boxW(n) + GAPX;
      }
    };
    const rowH = (row) => Math.max(...row.map((n) => n.h || 20)) + 34; // shape + the label under it

    target[centres[0].id] = { x: 0, y: 0 };
    const bands = new Map();
    for (const n of drawn) {
      if (n.center) continue;
      const side = n.side === "down" ? "down" : "up";
      const hop = Math.max(1, Math.abs(n.hop ?? 1));
      const key = `${side}:${hop}`;
      if (!bands.has(key)) bands.set(key, { side, hop, list: [] });
      bands.get(key).list.push(n);
    }
    let yUp = 0;
    let yDown = 0;
    const hops = [...new Set([...bands.values()].map((b) => b.hop))].sort((a, b) => a - b);
    for (const hop of hops) {
      for (const side of ["up", "down"]) {
        const band = bands.get(`${side}:${hop}`);
        if (!band) continue;
        // Widest fan-in first, so the file everything leans on is the one nearest the focus.
        const list = [...band.list].sort((a, b) => (b.inDegree ?? 0) - (a.inDegree ?? 0) || String(a.id).localeCompare(String(b.id)));
        const rows = rowsFor(list);
        for (const row of rows) {
          const h = rowH(row);
          if (side === "up") {
            yUp -= h;
            placeRow(row, yUp);
          } else {
            yDown += h;
            placeRow(row, yDown);
          }
        }
      }
    }
  }

  function spreadLabelBoxes(target, next) {
    const byId = new Map(next.nodes.map((n) => [n.id, n]));
    const movable = Object.keys(target).filter((id) => byId.get(id) && !byId.get(id).compound);
    if (movable.length < 2) return;
    const GAP = 10;

    const ranks = new Map();
    for (const id of movable) {
      const key = Math.round(target[id].y / 8) * 8;
      if (!ranks.has(key)) ranks.set(key, []);
      ranks.get(key).push(id);
    }
    for (const rank of ranks.values()) {
      if (rank.length < 2) continue;
      rank.sort((a, b) => target[a].x - target[b].x || a.localeCompare(b));
      const widths = rank.map((id) => boxW(byId.get(id)));
      const span = widths.reduce((a, b) => a + b, 0) + GAP * (rank.length - 1);
      const centre = rank.reduce((sum, id) => sum + target[id].x, 0) / rank.length;
      const natural = target[rank[rank.length - 1]].x - target[rank[0]].x + (widths[0] + widths[widths.length - 1]) / 2;
      if (natural >= span) continue; // already clear
      let x = centre - span / 2;
      rank.forEach((id, i) => {
        target[id] = { ...target[id], x: x + widths[i] / 2 };
        x += widths[i] + GAP;
      });
    }

    // A label that hangs below its node needs vertical room too: ranks closer together than the node
    // height plus a line of text put one rank's labels through the next rank's shapes.
    const belowLabel = movable.some((id) => byId.get(id).kind === "file" || byId.get(id).kind === "task");
    if (!belowLabel) return;
    const keys = Array.from(ranks.keys()).sort((a, b) => a - b);
    let shift = 0;
    for (let i = 0; i < keys.length; i += 1) {
      const rank = ranks.get(keys[i]);
      for (const id of rank) target[id] = { ...target[id], y: target[id].y + shift };
      if (i === keys.length - 1) break;
      const h = Math.max(...rank.map((id) => byId.get(id).h || 20));
      const nextH = Math.max(...ranks.get(keys[i + 1]).map((id) => byId.get(id).h || 20));
      const need = h / 2 + 22 + nextH / 2; // 4px margin + ~14px line + breathing room
      const have = keys[i + 1] - keys[i];
      if (have < need) shift += need - have;
    }
  }

  /** Move ghost nodes into an importers band above the compound and an imports band below it. */
  function bandGhosts(target, next) {
    const children = next.nodes.filter((n) => !n.compound && !n.ghost && target[n.id]);
    if (!children.length) return;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const c of children) {
      minY = Math.min(minY, target[c.id].y - c.h / 2);
      maxY = Math.max(maxY, target[c.id].y + c.h / 2);
    }
    const pad = 26 + 24; // compound padding + label room
    const gap = next.layout.rankSep ?? 70;
    let minX = Infinity;
    let maxX = -Infinity;
    for (const c of children) {
      minX = Math.min(minX, target[c.id].x - c.w / 2);
      maxX = Math.max(maxX, target[c.id].x + c.w / 2);
    }
    for (const side of ["up", "down"]) {
      const ghosts = next.nodes.filter((n) => n.ghost && target[n.id] && (n.side === "down") === (side === "down")).sort((a, b) => target[a.id].x - target[b.id].x);
      if (!ghosts.length) continue;
      // Keep each ghost near the children that use it, but never let the band grow wider than the
      // compound it belongs to: dagre happily parks a ghost hundreds of pixels off to one side, which
      // costs the whole view zoom at fit.
      const sep = 28;
      const span = ghosts.reduce((sum, g) => sum + g.w, 0) + sep * (ghosts.length - 1);
      const bandLeft = span >= maxX - minX ? (minX + maxX) / 2 - span / 2 : minX;
      const room = Math.max(0, maxX - minX - span);
      const step = ghosts.length > 1 ? room / (ghosts.length - 1) : 0;
      let cursor = bandLeft;
      for (const g of ghosts) {
        const y = side === "up" ? minY - pad - gap - g.h / 2 : maxY + pad + gap + g.h / 2;
        const wanted = target[g.id].x - g.w / 2;
        const x = Math.max(cursor, Math.min(wanted, cursor + step));
        target[g.id] = { x: x + g.w / 2, y };
        cursor = x + g.w + sep;
      }
    }
  }

  function savePositions(key, target) {
    if (!cy || !model) return;
    const pos = {};
    for (const n of cy.nodes()) {
      if (n.isParent()) continue;
      const t = target?.[n.id()];
      const p = t ?? n.position();
      pos[n.id()] = { x: Math.round(p.x), y: Math.round(p.y) };
    }
    store.set(key, { at: Date.now(), pos, dir: lastLayoutDir, aspect: lastLayoutAspect ?? canvasAspect() });
  }

  /**
   * A cached layout is only usable when its nodes still have room to breathe: a set squashed by an
   * interrupted animation packs the same node areas into a fraction of the box (F2). Reject those
   * and let dagre run again rather than restoring a pile.
   */
  function cacheUsable(pos, next) {
    const drawn = next.nodes.filter((n) => !n.compound && pos[n.id]);
    if (drawn.length < 3) return true;
    let x1 = Infinity;
    let x2 = -Infinity;
    let y1 = Infinity;
    let y2 = -Infinity;
    let area = 0;
    for (const n of drawn) {
      const p = pos[n.id];
      const w = n.w || 20;
      const h = n.h || 20;
      x1 = Math.min(x1, p.x - w / 2);
      x2 = Math.max(x2, p.x + w / 2);
      y1 = Math.min(y1, p.y - h / 2);
      y2 = Math.max(y2, p.y + h / 2);
      area += w * h;
    }
    const box = Math.max(1, (x2 - x1) * (y2 - y1));
    return box >= area * 0.9;
  }

  function scheduleFit(delay) {
    clearTimeout(fitTimer);
    fitPending = true;
    fitTimer = setTimeout(() => {
      fitPending = false;
      fit();
    }, delay ?? (dur(MOTION.fit) > 0 ? 20 : 0));
  }

  function nodeData(nd) {
    return {
      id: nd.id,
      kind: nd.kind,
      label: nd.label,
      fullLabel: nd.fullLabel,
      path: nd.path,
      parent: nd.parent ?? undefined,
      ghost: nd.ghost,
      side: nd.side ?? "",
      hop: nd.hop ?? -1,
      center: nd.center,
      role: nd.role,
      area: nd.area ?? "",
      w: nd.w || 20,
      h: nd.h || 20,
      shape: nd.shape,
      textMax: Math.max(60, (nd.w || 120) - 14),
      fill: nd.hue,
      border: nd.hue,
      bw: 1,
      bgOpacity: 1,
      textColor: COLORS.text,
      foldCount: nd.foldCount,
      task: nd.task ?? "",
      // Only the services and flow levels carry these, and `[svc]` selectors must not match a node
      // that has no business with them, so they are added rather than defaulted.
      ...(nd.svc ? { svc: nd.svc } : null),
      ...(nd.svcKind ? { svcKind: nd.svcKind } : null),
      ...(nd.entityKind ? { entityKind: nd.entityKind } : null),
    };
  }

  /** Classes an edge carries on the canvas: straight container links, cycles, and Level 3 spokes. */
  function edgeClasses(e, next) {
    const cls = [];
    if (next.level === "container") cls.push("straight");
    if (e.cycle) cls.push("cycle");
    if (next.level === "impact") cls.push(e.spoke ? "spoke" : "peripheral");
    return cls.join(" ");
  }

  function edgeData(e, next) {
    // Cycle members are not given a colour of their own: `edge.cycle` dashes whatever the edge's own
    // kind already says, so `--bad` stays available for something that is actually wrong.
    const color = e.color ?? (e.kind === "ipc" ? AREA_HUES[2] : e.kind === "tests" ? COLORS.knowNone : e.kind === "touches" ? COLORS.warn : next.level === "impact" ? e.sideColor : COLORS.edge);
    return {
      ...(e.svc ? { svc: e.svc } : null),
      ...(e.op ? { op: e.op } : null),
      ...(e.valueEvidence ? { valueEvidence: e.valueEvidence } : null),
      ...(e.labelColor ? { labelColor: e.labelColor } : null),
      id: e.id,
      source: e.source,
      target: e.target,
      kind: e.kind,
      weight: e.weight,
      names: e.names,
      via: e.via,
      confidence: e.confidence,
      cycle: e.cycle,
      width: e.width,
      label: e.label,
      color,
    };
  }

  // -- Lenses ---------------------------------------------------------------------------------------
  function applyLens(next) {
    if (!cy || !model) return;
    lens = next;
    cy.batch(() => {
      for (const nd of model.nodes) {
        const ele = cy.getElementById(nd.id);
        if (!ele.length) continue;
        const p = paintNode(nd, lens, model);
        // The second label line follows the lens, in the same batch as the fill so the swap stays
        // instant and the map never describes a different variable than the legend (F06).
        const data = { fill: p.fill, border: p.border, bw: p.bw, bgOpacity: p.bgOpacity, textColor: p.textColor };
        if (nd.labelLine1 && !nd.svc) data.label = nodeLabel(nd, lens, model.heatCtx);
        ele.data(data);
        const state = ele.classes().filter((c) => STATE_CLASSES.has(c));
        ele.classes([...p.classes, ...state]);
      }
      for (const e of model.edges) {
        const ele = cy.getElementById(e.id);
        if (!ele.length) continue;
        const state = ele.classes().filter((c) => STATE_CLASSES.has(c) || c === "straight" || c === "spoke" || c === "peripheral");
        ele.classes([...(e.cycle ? ["cycle"] : []), ...state]);
      }
    });
  }

  function setLens(next) {
    if (!next || next === lens) {
      lens = next ?? lens;
      renderLegend();
      maybeShowTests();
      return;
    }
    applyLens(next);
    isolated = null;
    renderLegend();
    if (model) setFooter(footerFor(model, { ...controls, lens }));
    maybeShowTests();
  }

  /**
   * The lens whose subject is test coverage cannot be the lens that hides the tests. Levels 2 and 3
   * draw file nodes, so entering the Tests lens turns the test files on — through the same toolbar
   * switch the user and the router already share, so the URL, the button and the map stay in step.
   * Level 1 draws areas, not files: there is nothing to unhide there, and the footer says so.
   */
  function maybeShowTests() {
    if (lens !== "tests" || controls.tests || !model) return;
    if (model.level !== "dir" && model.level !== "impact") return;
    if (!(model.hiddenTests > 0)) return;
    // Out of band: the switch re-enters the router, which calls show() again.
    setTimeout(() => {
      if (destroyed || lens !== "tests" || controls.tests) return;
      if (emit("tests", true)) return;
      const btn = $(ids.tests);
      if (btn && btn.getAttribute("aria-pressed") !== "true") btn.click();
    }, 0);
  }

  // -- Highlight API ---------------------------------------------------------------------------------
  function resolveRef(id) {
    if (!cy || !model || id == null) return null;
    const direct = cy.getElementById(String(id));
    if (direct.length && !direct.isParent()) return { id: direct.id(), folded: false, label: direct.data("fullLabel") ?? direct.data("label") };
    if (direct.length) return { id: direct.id(), folded: false, label: direct.data("fullLabel") ?? direct.data("label") };
    const sid = String(id);
    // Folded into a +N node?
    for (const nd of model.nodes) if (nd.kind === "fold" && nd.foldIds.includes(sid)) return { id: nd.id, folded: true, label: nd.label };
    // Ghost of that container?
    for (const pre of ["ghost:up:", "ghost:down:"]) {
      const g = cy.getElementById(pre + sid);
      if (g.length) return { id: g.id(), folded: true, label: g.data("fullLabel") };
    }
    // Nearest visible ancestor directory (or its ghost), then the L1 area.
    const path = sid.startsWith("dir:") ? dirPathOf(sid) : sid.startsWith("task:") || sid.startsWith("person:") ? null : sid;
    if (path) {
      const parts = path.split("/");
      for (let i = parts.length - 1; i >= 1; i -= 1) {
        const dirId = `dir:${parts.slice(0, i).join("/")}/`;
        for (const cand of [dirId, `ghost:up:${dirId}`, `ghost:down:${dirId}`, `area:${dirId}`]) {
          const ele = cy.getElementById(cand);
          if (ele.length) return { id: ele.id(), folded: true, label: ele.data("fullLabel") ?? ele.data("label") };
        }
      }
      const rootEle = cy.getElementById("dir:./");
      if (rootEle.length) return { id: "dir:./", folded: true, label: rootEle.data("fullLabel") };
    }
    // A task or person: the nodes it touches, if drawn.
    if (sid.startsWith("task:")) {
      const slug = sid.slice(5);
      const touched = model.nodes.filter((n) => n.tasks?.includes(slug) || n.task === slug);
      if (touched.length) return { id: touched[0].id, folded: true, label: touched[0].fullLabel, ids: touched.map((n) => n.id) };
    }
    return null;
  }

  function resolveMany(ids) {
    const out = [];
    for (const id of ids ?? []) {
      const r = resolveRef(id);
      if (!r) continue;
      if (r.ids) out.push(...r.ids);
      else out.push(r.id);
    }
    return Array.from(new Set(out));
  }

  function highlight(ids) {
    if (!cy) return;
    const targets = resolveMany(Array.isArray(ids) ? ids : [ids]);
    cy.batch(() => {
      cy.elements().removeClass("hl soft dim");
      if (!targets.length) return;
      const nodes = cy.collection(targets.map((id) => cy.getElementById(id)).filter((e) => e.length));
      const between = nodes.edgesWith(nodes);
      const lit = nodes.union(between);
      nodes.addClass("hl");
      between.addClass("hl");
      cy.elements().not(lit).not(nodes.parents()).addClass("dim");
    });
  }

  function softHighlight(ids) {
    if (!cy) return;
    const targets = resolveMany(Array.isArray(ids) ? ids : [ids]);
    cy.batch(() => {
      cy.nodes().removeClass("soft");
      for (const id of targets) cy.getElementById(id).addClass("soft");
    });
  }

  /**
   * The selection highlight a tap draws: the node in `.hl`, everything one hop away in `.soft`, the
   * edges between them lit, the rest dimmed — the same treatment `highlight()` gives a story hover,
   * extended by one hop because a tap is a question about a neighbourhood, not about one shape.
   */
  function highlightNeighbourhood(node) {
    if (!cy || !node || !node.length) return;
    cy.batch(() => {
      cy.elements().removeClass("hl soft dim");
      // closedNeighborhood is the node, the edges on it and the nodes at their far ends — the edges
      // *between* those neighbours are not part of the answer and stay dimmed with everything else.
      const near = node.closedNeighborhood();
      node.addClass("hl");
      near.nodes().not(node).addClass("soft");
      near.edges().addClass("hl");
      cy.elements().not(near).not(near.nodes().parents()).addClass("dim");
    });
  }

  function clearHighlight() {
    if (!cy) return;
    cy.batch(() => {
      cy.elements().removeClass("hl soft dim");
      if (isolated) applyIsolation();
    });
  }

  function select(id) {
    if (!cy) return;
    cy.elements().unselect();
    if (id == null) return;
    const r = resolveRef(id);
    if (!r) return;
    cy.getElementById(r.id).select();
  }

  // -- Viewport ---------------------------------------------------------------------------------------
  const FIT_MAX_ZOOM = 1.2; // a two-node view should not blow one node up to fill the canvas
  const FIT_MIN_ZOOM = 0.75; // 12px * 0.75 = 9px, the floor acceptance 16 sets: clip and pan below it
  const FIT_CLEAR_FLOOR = 0.55; // below this the whole graph is a smear; clip and pan instead
  // A frame that leaves the graph under this share of the canvas on *both* axes is not showing the
  // graph, it is storing it in a corner. Such a frame is only taken when there is no other.
  const FIT_MIN_FILL = 0.5;

  /**
   * The free rectangle inside the canvas: the toolbar, the legend and the footer float *over* it, and
   * fitting against the full container parked nodes underneath them on the default landing map (F05).
   * The legend is a corner card, so it is returned separately: reserving a whole column for it can
   * cost more zoom than reserving the strip of height it actually occupies, and fit() tries both.
   */
  function freeInsets() {
    const out = { top: 12, right: 12, bottom: 12, left: 12 };
    const cRect = container.getBoundingClientRect();
    if (!(cRect.width > 0 && cRect.height > 0)) return out;
    const visible = (el) => el && !el.hidden && el.offsetParent !== null && (el.childElementCount > 0 || el.textContent.trim() !== "");
    const tb = document.getElementById(ids.toolbar);
    if (visible(tb)) {
      const r = tb.getBoundingClientRect();
      out.top = Math.max(out.top, r.bottom - cRect.top + 16);
    }
    const lg = document.getElementById(ids.legend);
    if (visible(lg)) {
      const r = lg.getBoundingClientRect();
      if (r.width >= cRect.width * 0.6) {
        // Row mode: a horizontal band, above or below depending on where it is pinned.
        const top = r.top - cRect.top < cRect.height / 2;
        out.legend = { side: top ? "top" : "bottom", along: top ? r.bottom - cRect.top + 12 : cRect.bottom - r.top + 12 };
      } else {
        const left = r.left - cRect.left < cRect.width / 2;
        out.legend = {
          side: left ? "left" : "right",
          along: left ? r.right - cRect.left + 16 : cRect.right - r.left + 16,
          across: cRect.bottom - r.top + 12,
        };
      }
      out.legendRect = { x1: r.left - cRect.left - 8, y1: r.top - cRect.top - 8, x2: r.right - cRect.left + 8, y2: r.bottom - cRect.top + 8 };
    }
    const ft = document.getElementById(ids.footer);
    if (visible(ft)) {
      const r = ft.getBoundingClientRect();
      out.bottom = Math.max(out.bottom, cRect.bottom - r.top + 12);
    }
    // Never let the floating cards eat the canvas: a third of each axis is the most they may claim.
    out.left = Math.min(out.left, cRect.width * 0.33);
    out.right = Math.min(out.right, cRect.width * 0.33);
    out.top = Math.min(out.top, cRect.height * 0.33);
    out.bottom = Math.min(out.bottom, cRect.height * 0.33);
    // The legend's own insets are deliberately NOT capped: fit() offers one candidate per way of
    // keeping clear of it and picks the best, so an expensive candidate simply loses. Clamping it
    // instead produced a "free" rectangle the legend still covered.

    return out;
  }

  /**
   * The rectangles fit() is allowed to draw into, each one clear of the toolbar, the legend and the
   * footer. There is more than one because the legend is a corner card: reserving the column it sits
   * in and reserving the strip of height it occupies are both valid, and which is cheaper depends on
   * the shape of the graph — so both are offered and fit() picks.
   */
  function viewportRects() {
    const W = cy.width();
    const H = cy.height();
    if (!(W > 0 && H > 0)) return [];
    const ins = freeInsets();
    const rects = [];
    // `legendAxis` is the axis the legend was reserved along. It matters when the graph is too big to
    // fit: on that axis the graph must stay inside the rectangle, because the card is there; on the
    // other it may run off the edge of the canvas, where nothing is hidden and the user can pan.
    const add = (left, right, top, bottom, legendAxis) => {
      rects.push({ left, top, legendAxis, availW: Math.max(40, W - left - right), availH: Math.max(40, H - top - bottom) });
    };
    if (!ins.legend) {
      add(ins.left, ins.right, ins.top, ins.bottom, null);
    } else {
      const lg = ins.legend;
      if (lg.side === "left") add(ins.left + lg.along, ins.right, ins.top, ins.bottom, "x");
      else if (lg.side === "right") add(ins.left, ins.right + lg.along, ins.top, ins.bottom, "x");
      else if (lg.side === "top") add(ins.left, ins.right, Math.max(ins.top, lg.along), ins.bottom, "y");
      else add(ins.left, ins.right, ins.top, Math.max(ins.bottom, lg.along), "y");
      if (lg.across != null) add(ins.left, ins.right, ins.top, Math.max(ins.bottom, lg.across), "y");
    }
    rects.ins = ins;
    return rects;
  }

  /**
   * The box a freshly computed layout is shaped to fill: the roomiest rectangle fit() may choose.
   * Shaping the layout to *this* box, rather than to the whole canvas, is what keeps nodes out from
   * under the toolbar and the legend without the fit having to shrink the graph to dodge them.
   */
  function availableBox() {
    const rects = viewportRects();
    if (!rects.length) return { w: Math.max(120, (cy.width() || 800) - 24), h: Math.max(120, (cy.height() || 600) - 24) };
    const best = rects.reduce((a, b) => (b.availW * b.availH > a.availW * a.availH ? b : a));
    return { w: best.availW, h: best.availH };
  }

  /**
   * @param {{ explicit?: boolean }} [fitOpts] `explicit` marks a fit the user asked for (the Fit
   * button, the `F` key, the public `fit()`): it re-measures the floating cards and re-decides the
   * frame from scratch, and it is allowed to re-shape a layout no frame can show properly.
   */
  function fit(fitOpts = {}) {
    if (!cy || !cy.elements().length) return;
    const explicit = fitOpts?.explicit === true;
    // An explicit fit starts from a clean slate: nothing measured for an earlier canvas, an earlier
    // legend shape or an interrupted navigation may survive into the decision, or pressing Fit
    // reproduces the stuck view it was pressed to escape (F-MAP-A).
    if (explicit) {
      clearTimeout(fitTimer);
      fitTimer = null;
      cancelViewport();
      syncLegendShape();
    }
    // A fit computed while the layout is still moving nodes measures a graph that is half where it
    // was and half where it is going, and the zoom it lands stays after the nodes arrive: clicking
    // repo → area before the repo map settled left the area map drawn 130% of the canvas wide with
    // 41 elements off the edge (F-MAP-A). Every layout fits when it completes, so a fit asked for
    // mid-flight is simply asked again once the nodes have stopped.
    if (currentLayout) {
      scheduleFit(dur(MOTION.move) + 60);
      return;
    }
    // A layout is shaped for the pane it was computed in, and no zoom rescues one shaped for another:
    // arriving at the area map from the workspace, whose 320px-tall pane stretched the layout 3.5x
    // wide, left it 3288px wide in a 1000px pane at 31% of the height. `settleResize` is meant to
    // catch that, but it cannot always: a fit that ran after the pane grew has already recorded the
    // new size, so the next resize sees no change and the mismatch is never asked about again. Ask
    // here, where it is visible whatever caused it. Re-shaping records the new aspect, so it runs once.
    const aspectNow = canvasAspect();
    const shapedElsewhere = Boolean(lastLayoutAspect && aspectNow) && Math.abs(Math.log(aspectNow / lastLayoutAspect)) > 0.12 && !model?.shaped;
    if (shapedElsewhere && model?.layout) {
      runDagre(model, positionsKey(repo, model.level, model.root));
      return;
    }
    const bb = cy.elements().boundingBox();
    const W = cy.width();
    const H = cy.height();
    if (!(bb.w > 0 && bb.h > 0 && W > 0 && H > 0)) return;
    const rects = viewportRects();
    if (!rects.length) return;
    const ins = rects.ins;
    // A pixel of tolerance, used everywhere a graph is asked whether it fits. The frame a layout was
    // *shaped* to fill is the frame it is then measured against, so "exactly" comes back as a half
    // pixel over or a rounding error under; read strictly, that half pixel is the difference between
    // "holds the whole graph" and "clips it", and the ranking below turns it into a very different
    // picture.
    const EPS = 0.5;
    // Cytoscape's own fit only takes a scalar padding, so the zoom and the pan are set directly.
    const cands = rects.map((r) => ({ ...r, z: Math.min(r.availW / bb.w, r.availH / bb.h) }));
    const roomiest = cands.reduce((a, b) => (b.z > a.z ? b : a));
    // The readability floor: 12px labels below 9px rendered are a smear, so a graph that would need
    // less zoom than that is drawn bigger and clipped, and the user pans to the rest. The floor may
    // lift the zoom by at most 30% — a graph needing half of it is better seen small than mostly gone.
    const floored = model?.fitWhole
      ? clamp(roomiest.z, 0.1, FIT_MAX_ZOOM)
      : clamp(Math.max(roomiest.z, Math.min(FIT_MIN_ZOOM, roomiest.z * 1.3)), 0.1, FIT_MAX_ZOOM);

    // Choose the frame. Each legend candidate reserved the card along one axis; on that axis the
    // graph has to fit, because the card is there, and on the other it may overflow off the canvas
    // edge, where nothing is hidden. Taking the roomiest such frame is what makes "no node is ever
    // drawn beneath the toolbar or the legend" true even for a graph too big for the pane (F-MAP-05).
    let best = roomiest;
    let level = floored;
    if (ins.legendRect) {
      // A frame is only worth taking if what it draws is worth looking at. A candidate that reserves
      // the legend's *height* on a short pane can leave a strip so shallow that the graph lands in
      // two fifths of the canvas on both axes — 42% x 42% at zoom 0.276 on the area map at 1000x900,
      // and every later Fit re-derived the same frame, so the view was stuck until Re-layout
      // (F-MAP-A). That is a degenerate frame: it holds the whole graph the way a stamp holds a
      // painting. Measured against the canvas, not against the frame, because the empty part of the
      // canvas is what the reader sees.
      const degenerate = (z) => degenerateFit(bb, z, W, H);
      // Each frame is offered at two zooms. The first is the one its reserved axis allows, letting
      // the graph leave the canvas by the other edge. The second is the one that holds all of it —
      // and it is only offered while the whole graph still reads at that zoom, because the floor
      // exists to stop a graph being shrunk into a smear, not to make one overflow that need not.
      // Without the second offer the area map at 1280x800 judged the wide frame "clipping" at the
      // zoom its own axis allowed, took the narrow one at 0.41 instead, and drew the graph in two
      // fifths of the pane's height with the reserved gutter beside it empty.
      const zoomsFor = (c) => {
        const room = c.legendAxis === "x" ? c.availW / bb.w : c.availH / bb.h;
        const zClip = Math.min(clamp(room, 0.1, FIT_MAX_ZOOM), floored);
        const zAll = Math.min(clamp(Math.min(c.availW / bb.w, c.availH / bb.h), 0.1, FIT_MAX_ZOOM), floored);
        return zAll < zClip - 0.001 && zAll >= FIT_CLEAR_FLOOR ? [zClip, zAll] : [zClip];
      };
      const pickFrame = (allow) => {
        let clear = null;
        for (const c of cands) {
          for (const z of zoomsFor(c)) {
            // Does this frame hold the whole graph? Asked in pixels and with a pixel of tolerance, not
            // by comparing zooms: the frame the layout was shaped to fill is the frame it is measured
            // against, so "exactly" arrives as half a pixel over. Read strictly, the repo map under the
            // Heat lens — whose taller legend leaves the graph 0.5px too tall for the reserved column —
            // was handed to the frame that reserves the legend's *height* instead, which does hold the
            // whole graph, at half the zoom, in 39% of the canvas width.
            const holdsAll = bb.w * z <= c.availW + EPS && bb.h * z <= c.availH + EPS;
            if (!allow({ c, z, holdsAll })) continue;
            // A frame that holds the whole graph is the best answer, whichever axis it reserved. Failing
            // that, vertical overflow is the dangerous kind — the toolbar owns a band at the top and the
            // footer one at the bottom, so a graph running off the top or the bottom passes under a card
            // on its way out, where one running off the left or right leaves by an empty edge. So among
            // frames that must clip, the one that reserves the legend along y wins even when reserving
            // its column would allow more zoom.
            const rank = (holdsAll ? 2000 : c.legendAxis === "y" ? 1000 : 0) + z;
            if (!clear || rank > clear.rank) clear = { rect: c, z, rank };
          }
        }
        return clear;
      };
      // The readability floor is a reason to clip a graph that cannot be shown whole; it is not a
      // reason to clip one that can. On a wide, short pane — the stacked breakpoint puts the map in
      // roughly 1000x459 — reserving the legend's column costs a quarter of the width, every
      // candidate came out under the floor, and dropping them all fell back to the unreserved frame
      // at the *floored* zoom: the graph then stood 214px past the right edge with all five ghosts
      // below the bottom. So the floor only discards frames that would clip anyway.
      let clear = pickFrame(({ z, holdsAll }) => holdsAll || z >= FIT_CLEAR_FLOOR);
      // …and a degenerate frame loses to any frame that is not, even one that clips. On the area map
      // the column frame was 1.4px too short to "hold all" and fell under the floor, so it was
      // dropped and the 42% strip won by default; drawn in it the graph covers three quarters of the
      // canvas and leaves the canvas by an empty edge. The floor is ignored on this second pass for
      // the same reason it exists: a smear you can read half of beats a speck you can read none of.
      if (clear && degenerate(clear.z)) clear = pickFrame(({ z }) => !degenerate(z)) ?? clear;
      if (clear) {
        best = clear.rect;
        level = clear.z;
      }
    }

    // Centre in the frame where there is room; where the graph is bigger than the frame, align to the
    // frame's near edge so the overflow leaves the canvas rather than sliding under a card.
    //
    // "Bigger than the frame" is measured with a pixel of tolerance, because the frame the graph was
    // *shaped* to fill is the frame it is now measured against: the slack comes out at -1e-13 rather
    // than 0, and a bare `< 0` read that as an overflow. On the file explorer that handed the graph to
    // the focus-centring rule below, which slid it 20px past the right-hand edge of a canvas it
    // otherwise fitted exactly.
    const slackX = best.availW - bb.w * level;
    const slackY = best.availH - bb.h * level;
    const overflowX = slackX < -EPS;
    const overflowY = slackY < -EPS;
    const pan = {
      x: best.left + (slackX > 0 ? slackX / 2 : 0) - bb.x1 * level,
      y: best.top + (slackY > 0 ? slackY / 2 : 0) - bb.y1 * level,
    };
    // Reserving the legend's whole column can leave a dead gutter down the other side of the canvas.
    // When the graph is small enough to sit in the middle of the *whole* canvas and still clear the
    // card, that symmetric frame is the better picture, so take it.
    const lr = ins.legendRect;
    if (lr && !overflowX && !overflowY) {
      const cx = ins.left + Math.max(0, W - ins.left - ins.right - bb.w * level) / 2 - bb.x1 * level;
      const cyy = ins.top + Math.max(0, H - ins.top - ins.bottom - bb.h * level) / 2 - bb.y1 * level;
      const x1 = cx + bb.x1 * level;
      const x2 = cx + bb.x2 * level;
      const y1 = cyy + bb.y1 * level;
      const y2 = cyy + bb.y2 * level;
      const clearsCard = x2 <= lr.x1 || x1 >= lr.x2 || y2 <= lr.y1 || y1 >= lr.y2;
      const onCanvas = x1 >= ins.left - 1 && x2 <= W - ins.right + 1 && y1 >= ins.top - 1 && y2 <= H - ins.bottom + 1;
      if (clearsCard && onCanvas) {
        pan.x = cx;
        pan.y = cyy;
      }
    }

    // The explorer is about one file. When its fan-in overflows the frame, the focus node is what has
    // to stay in the middle of it — it used to end up in a corner under the legend and the footer.
    // Only the overflowing axis is touched, and that is never the axis the legend was reserved along.
    if (model?.level === "impact" && (overflowX || overflowY)) {
      const focus = cy.nodes().filter((n) => n.data("center") === true);
      if (focus.length) {
        const p = focus[0].position();
        if (overflowX) pan.x = best.left + best.availW / 2 - p.x * level;
        // Vertically the graph may only be pushed *down* from the frame's top edge: sliding it up to
        // centre the focus is what walked three neighbours under the toolbar.
        if (overflowY) pan.y = Math.max(best.top - bb.y1 * level, best.top + best.availH / 2 - p.y * level);
      }
    }
    // The last resort for an explicit Fit: every frame still leaves the graph in a corner of the pane
    // although the graph is bigger than the box — no viewport can rescue that, only a new shape. It
    // is exactly the state a reader presses Fit to escape. Explicit only: dagre is deterministic, so
    // an automatic re-run on the same condition would re-run for ever, and a *small* graph lost in a
    // large pane is `fillTarget`'s business rather than a reason to lay it out again.
    if (explicit && model?.layout && !currentLayout && degenerateFit(bb, level, W, H)) {
      const box = availableBox();
      if (bb.w > box.w || bb.h > box.h) {
        runDagre(model, positionsKey(repo, model.level, model.root));
        return;
      }
    }
    lastSize = { w: W, h: H };
    applyViewport(level, pan);
  }

  /** Does this zoom leave the graph in a corner of the canvas on both axes? (see `FIT_MIN_FILL`) */
  function degenerateFit(bb, level, W, H) {
    return bb.w * level < W * FIT_MIN_FILL && bb.h * level < H * FIT_MIN_FILL;
  }

  /**
   * Move the viewport to a computed zoom and pan.
   *
   * A fit that is animated is a fit that can fail to happen: `cy.animate` is driven by
   * requestAnimationFrame, which a background tab or a busy frame can stall indefinitely, and the map
   * is then left at the zoom it had for the *previous* canvas size — the "resize and it never
   * recovers" symptom (F-MAP-01). Note where the viewport was, and if nothing has moved at all by the
   * time the animation should have finished, set the target directly. If it moved but did not arrive,
   * the user grabbed the canvas mid-animation and the map is theirs.
   *
   * Every fit carries the generation it was computed in. Cytoscape *queues* core animations, so four
   * fits in flight during a navigation played one after another and the map ended on whichever one
   * happened to be last in the queue — a zoom computed for the graph the user had already left
   * (F-MAP-A). A new fit supersedes the old one (`queue: false`) and a fit from a superseded
   * generation neither animates nor lands through its own backstop.
   */
  function applyViewport(level, pan) {
    const gen = ++fitGen;
    const d = dur(MOTION.fit);
    if (d <= 0) {
      cy.zoom(level);
      cy.pan(pan);
      return;
    }
    const from = { zoom: cy.zoom(), pan: { ...cy.pan() } };
    cy.stop();
    cy.animate({ zoom: level, pan }, { duration: d, easing: "ease-out", queue: false });
    setTimeout(() => {
      if (destroyed || !cy || gen !== fitGen) return;
      const now = { zoom: cy.zoom(), pan: cy.pan() };
      const arrived = Math.abs(now.zoom - level) < 0.005 && Math.abs(now.pan.x - pan.x) < 1 && Math.abs(now.pan.y - pan.y) < 1;
      if (arrived) return;
      const moved = Math.abs(now.zoom - from.zoom) > 0.001 || Math.abs(now.pan.x - from.pan.x) > 0.5 || Math.abs(now.pan.y - from.pan.y) > 0.5;
      if (moved) return;
      cy.stop();
      cy.zoom(level);
      cy.pan(pan);
    }, d + 140);
  }

  /**
   * Drop any fit that is still in the air: the animation itself and the backstop that would land it.
   * Called when the ground moves under it — a navigation, or a Fit the user pressed.
   */
  function cancelViewport() {
    fitGen += 1;
    if (!cy) return;
    try {
      cy.stop();
    } catch {
      /* a destroyed instance has nothing to stop */
    }
  }

  function zoom(factor) {
    if (!cy) return;
    const level = clamp(cy.zoom() * (factor || 1), 0.1, 4);
    cy.zoom({ level, renderedPosition: { x: cy.width() / 2, y: cy.height() / 2 } });
  }

  function relayout() {
    if (!cy || !model) return;
    const key = positionsKey(repo, model.level, model.root);
    store.remove(key);
    clearTimeout(fitTimer);
    fitTimer = null;
    cancelViewport();
    if (currentLayout) {
      try {
        currentLayout.stop();
      } catch {
        /* ignore */
      }
    }
    runDagre(model, key);
  }

  // -- Legend ----------------------------------------------------------------------------------------
  function renderLegend() {
    const el = $(ids.legend);
    if (!el || !model) return;
    const legend = legendForModel(model, lens);
    el.textContent = "";
    if (!legend.rows.length) return;
    const title = document.createElement("div");
    title.className = "legend__title";
    title.textContent = legend.title;
    el.appendChild(title);
    legend.rows.forEach((row, i) => {
      const r = document.createElement("div");
      r.className = "legend__row";
      r.setAttribute("role", "button");
      r.tabIndex = 0;
      r.dataset.index = String(i);
      r.title = `Click to show only ${row.label}`;
      const sw = document.createElement("span");
      sw.className = `legend__swatch legend__swatch--${row.kind}`;
      if (row.kind === "fill") sw.style.background = row.color;
      else if (row.kind === "edge") sw.style.background = row.color;
      else sw.style.color = row.color;
      if (row.kind === "edge-dotted") sw.className = "legend__swatch legend__swatch--edge is-dotted";
      if (row.kind === "edge-dashed") sw.className = "legend__swatch legend__swatch--edge is-dashed";
      const label = document.createElement("span");
      label.className = "legend__label";
      label.textContent = row.label;
      r.append(sw, label);
      // A count is worth printing when it says how many nodes or edges are in the class. A row that
      // can only ever read "1" (the explorer's focus file) says nothing, so it prints no number.
      if (row.showCount !== false) {
        const count = document.createElement("span");
        count.className = "legend__count";
        count.textContent = String(row.count);
        r.append(count);
      }
      const key = `${lens}:${i}:${row.label}`;
      if (isolated?.key === key) r.classList.add("is-isolated");
      const toggle = () => {
        if (isolated?.key === key) {
          isolated = null;
          cy.elements().removeClass("dim iso");
        } else {
          isolated = { key, ids: new Set(row.isolate) };
          applyIsolation();
        }
        for (const other of el.querySelectorAll(".legend__row")) other.classList.toggle("is-isolated", other === r && isolated?.key === key);
      };
      r.addEventListener("click", toggle);
      r.addEventListener("keydown", (ev) => {
        if (ev.key === "Enter" || ev.key === " ") {
          ev.preventDefault();
          toggle();
        }
      });
      el.appendChild(r);
    });
    const note = document.createElement("div");
    note.className = "legend__note";
    note.textContent = "Click a row to isolate it";
    el.appendChild(note);
    // Card or row? Only decidable once the rows are in the DOM and the card has its real height.
    syncLegendShape();
    // The legend is one of the boxes the fit keeps clear of, and it changes height whenever the lens
    // changes the number of rows. A card that grew upward over two nodes has to be answered by a new
    // fit, or the rule "no node is ever drawn beneath the legend" only holds for the lens the map
    // happened to load with (F-MAP-05).
    const r = el.getBoundingClientRect();
    const now = `${Math.round(r.width)}x${Math.round(r.height)}`;
    if (lastLegendSize !== null && lastLegendSize !== now) scheduleFit(60);
    lastLegendSize = now;
  }

  function applyIsolation() {
    if (!cy || !isolated) return;
    cy.batch(() => {
      cy.elements().removeClass("dim iso");
      const keep = cy.collection();
      for (const id of isolated.ids) {
        const ele = cy.getElementById(id);
        if (ele.length) keep.merge(ele);
      }
      const kept = keep.union(keep.connectedNodes()).union(keep.nodes().edgesWith(keep.nodes())).union(keep.parents());
      cy.elements().not(kept).addClass("dim");
      keep.addClass("iso");
    });
  }

  // -- Toolbar (§3.1 / §3.4) ---------------------------------------------------------------------------
  let toolbarWired = false;
  function renderToolbar() {
    const extra = $(ids.extra);
    const testsBtn = $(ids.tests);
    const level = model?.level ?? "container";
    if (testsBtn) {
      const hidden = model?.hiddenTests ?? 0;
      const span = testsBtn.querySelector("span");
      const shown = controls.tests;
      const label = shown ? "Hide tests" : hidden ? `Show tests (${hidden})` : "Show tests";
      if (span) span.textContent = label;
      testsBtn.setAttribute("aria-pressed", shown ? "true" : "false");
      testsBtn.setAttribute("aria-label", `${label} (T)`);
      testsBtn.title = `${label} (T)`;
      testsBtn.hidden = level === "workspace" || level === "flow" || level === "flows" || level === "call";
    }
    if (opts.wireToolbar && !toolbarWired) {
      toolbarWired = true;
      $(ids.fit)?.addEventListener("click", () => fit({ explicit: true }));
      $(ids.zoomIn)?.addEventListener("click", () => zoom(1.2));
      $(ids.zoomOut)?.addEventListener("click", () => zoom(1 / 1.2));
      $(ids.relayout)?.addEventListener("click", relayout);
      $(ids.tests)?.addEventListener("click", () => {
        controls.tests = !controls.tests;
        renderToolbar();
        emit("tests", controls.tests);
      });
    }
    if (!extra) return;
    extra.textContent = "";
    const sep = () => {
      const s = document.createElement("span");
      s.className = "float__sep";
      return s;
    };
    // The flow tracer walks six hops; a reader who only wants the handler's own calls says so here,
    // and the router re-traces at that depth (`/api/flow?depth=`).
    if (level === "flow") {
      extra.appendChild(sep());
      const range = document.createElement("label");
      range.className = "range";
      range.innerHTML = `<span>Hops</span><input type="range" min="1" max="6" step="1" aria-label="Hops (1 to 6)"><output></output>`;
      const input = range.querySelector("input");
      const out = range.querySelector("output");
      input.value = String(clamp(controls.depth ?? 6, 1, 6));
      out.textContent = input.value;
      input.addEventListener("input", () => {
        out.textContent = input.value;
      });
      input.addEventListener("change", () => {
        controls.depth = Number(input.value);
        emit("depth", controls.depth);
      });
      extra.appendChild(range);
      return;
    }
    // The Services map ranks by fan-in and folds the tail (§4). One button unfolds it.
    if (level === "services") {
      const folded = model?.counts?.folded ?? 0;
      if (!folded && !controls.all) return;
      extra.appendChild(sep());
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "btn btn--tool";
      btn.setAttribute("aria-pressed", controls.all ? "true" : "false");
      const label = controls.all ? "Top services only" : `Show all (${folded} more)`;
      btn.title = controls.all ? "Draw only the services with the most callers" : "Draw every service, including the ones with a single caller";
      btn.setAttribute("aria-label", label);
      btn.textContent = label;
      btn.addEventListener("click", () => {
        controls.all = !controls.all;
        emit("all", controls.all);
      });
      extra.appendChild(btn);
      return;
    }
    if (level !== "impact") return;
    extra.appendChild(sep());
    // Depth 1–3
    const range = document.createElement("label");
    range.className = "range";
    range.innerHTML = `<span>Depth</span><input type="range" min="1" max="3" step="1" aria-label="Depth (1 to 3)"><output></output>`;
    const input = range.querySelector("input");
    const out = range.querySelector("output");
    input.value = String(clamp(controls.depth ?? 1, 1, 3));
    out.textContent = input.value;
    input.addEventListener("input", () => {
      out.textContent = input.value;
    });
    input.addEventListener("change", () => {
      controls.depth = Number(input.value);
      emit("depth", controls.depth);
    });
    extra.appendChild(range);
    // Direction (explorer) or Planned / Actual / Both (blast radius)
    const seg = document.createElement("div");
    seg.className = "seg seg--tool";
    seg.setAttribute("role", "radiogroup");
    const options = model.isBlast
      ? [
          ["both", "Both", "Planned and changed files"],
          ["planned", "Planned", "Files the plan names"],
          ["actual", "Actual", "Files changed on the branch"],
        ]
      : [
          ["both", "Both", "Importers above, imports below"],
          ["up", "What depends on me", "Only the files that import this one"],
          ["down", "What I depend on", "Only the files this one imports"],
        ];
    const current = model.isBlast ? controls.mode : controls.direction;
    seg.setAttribute("aria-label", model.isBlast ? "Planned or actual files" : "Direction");
    for (const [value, label, title] of options) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = `seg__btn${current === value ? " is-active" : ""}`;
      b.setAttribute("role", "radio");
      b.setAttribute("aria-checked", current === value ? "true" : "false");
      b.title = title;
      b.textContent = label;
      b.addEventListener("click", () => {
        for (const o of seg.querySelectorAll(".seg__btn")) {
          o.classList.toggle("is-active", o === b);
          o.setAttribute("aria-checked", o === b ? "true" : "false");
        }
        if (model.isBlast) {
          controls.mode = value;
          emit("mode", value);
        } else {
          controls.direction = value;
          setFooter(footerFor(model, { ...controls, lens }));
          emit("direction", value);
        }
      });
      seg.appendChild(b);
    }
    extra.appendChild(seg);
    if (!model.isBlast) {
      extra.appendChild(sep());
      const back = document.createElement("button");
      back.type = "button";
      back.id = "tb-back";
      back.className = "btn btn--tool";
      back.title = "Back to the previous file";
      back.setAttribute("aria-label", "Back to the previous file");
      back.innerHTML = `<svg class="i"><use href="#i-back"/></svg><span>Back</span>`;
      back.addEventListener("click", () => {
        if (!emit("back")) history.back();
      });
      extra.appendChild(back);
    }
  }

  function setControls(next = {}) {
    controls = { ...controls, ...next };
    renderToolbar();
    if (model) setFooter(footerFor(model, { ...controls, lens }));
  }

  /**
   * A view with nothing in it gets an in-pane empty state instead of a blank rectangle: a centred
   * card in the map stage, in the same dashed-card register as the story column's empty states
   * (`.card--empty`, DOM-CONTRACT §2), saying why the pane is empty and what would fill it (F-MAP-C).
   */
  function renderEmptyState(next) {
    if (!stage) return;
    for (const el of stage.querySelectorAll(":scope > .map-empty")) el.remove();
    if (!next || next.nodes.some((n) => !n.compound)) return;
    const { text, hint } = emptyMapText(next);
    const card = document.createElement("div");
    card.className = "card card--empty card--renderer map-empty";
    card.setAttribute("role", "status");
    const p = document.createElement("p");
    p.className = "empty__text";
    p.textContent = text;
    const h = document.createElement("p");
    h.className = "empty__hint";
    h.textContent = hint;
    card.append(p, h);
    stage.appendChild(card);
  }

  // -- Footer and tooltip ------------------------------------------------------------------------------
  function setFooter(text) {
    footerText = text;
    const el = $(ids.footer);
    if (el) el.textContent = text;
  }
  function showFooterTemp(text) {
    const el = $(ids.footer);
    if (el) el.textContent = text;
  }
  function restoreFooter() {
    const el = $(ids.footer);
    if (el) el.textContent = footerText;
  }

  function ensureTip() {
    let el = $(ids.tip);
    if (!el && stage) {
      el = document.createElement("div");
      el.id = ids.tip;
      el.className = "tip";
      el.setAttribute("role", "tooltip");
      el.hidden = true;
      stage.appendChild(el);
    }
    return el;
  }
  function showTip(content, evt) {
    if (!tip) return;
    tip.textContent = "";
    const p = document.createElement("div");
    p.className = "tip__path";
    p.textContent = content.path;
    tip.appendChild(p);
    if (content.meta?.length) {
      const m = document.createElement("div");
      m.className = "tip__meta";
      m.textContent = content.meta.join(" · ");
      tip.appendChild(m);
    }
    tip.hidden = false;
    moveTip(evt);
  }
  function moveTip(evt) {
    if (!tip || tip.hidden || !stage) return;
    const oe = evt?.originalEvent;
    const rect = stage.getBoundingClientRect();
    let x = (oe?.clientX ?? rect.left + (evt?.renderedPosition?.x ?? 0)) - rect.left + 14;
    let y = (oe?.clientY ?? rect.top + (evt?.renderedPosition?.y ?? 0)) - rect.top + 14;
    const tw = tip.offsetWidth;
    const th = tip.offsetHeight;
    if (x + tw > rect.width - 8) x = Math.max(8, x - tw - 28);
    if (y + th > rect.height - 8) y = Math.max(8, y - th - 28);
    tip.style.left = `${x}px`;
    tip.style.top = `${y}px`;
  }
  function hideTip() {
    if (tip) tip.hidden = true;
  }

  // -- Events -----------------------------------------------------------------------------------------
  function wireEvents() {
    cy.on("mouseover", "node", (evt) => {
      const node = evt.target;
      const nd = model?.nodeById.get(node.id());
      if (!nd) return;
      if (nd.compound) return;
      hoverId = node.id();
      showTip(nodeTip(nd), evt);
      if (model.level !== "workspace" && nd.kind !== "fold" && nd.kind !== "task") {
        const inc = node.incomers("edge").filter((e) => e.data("kind") !== "tests" || controls.tests);
        const out = node.outgoers("edge");
        cy.batch(() => {
          inc.addClass("up");
          inc.sources().addClass("up");
          out.addClass("down");
          out.targets().addClass("down");
        });
        showFooterTemp(`Used by ${inc.sources().length} · Uses ${out.targets().length}`);
      }
      emit("hover", node.id(), nd);
    });
    cy.on("mouseout", "node", (evt) => {
      const node = evt.target;
      if (hoverId !== node.id()) return;
      hoverId = null;
      hideTip();
      cy.batch(() => cy.elements().removeClass("up down"));
      restoreFooter();
      emit("leave", node.id());
      emit("hoverEnd", node.id());
    });
    cy.on("mousemove", "node, edge", (evt) => moveTip(evt));
    cy.on("mouseover", "edge", (evt) => {
      const e = evt.target;
      const em = model?.edges.find((x) => x.id === e.id());
      if (!em) return;
      showTip({ path: edgeSentence(em, model.nodeById), meta: [] }, evt);
      e.addClass("hl");
    });
    cy.on("mouseout", "edge", (evt) => {
      hideTip();
      evt.target.removeClass("hl");
    });
    cy.on("tap", "node", (evt) => {
      const node = evt.target;
      const nd = model?.nodeById.get(node.id());
      if (!nd) return;
      const now = Date.now();
      const dbl = now - lastTapAt < 320;
      lastTapAt = now;
      if (nd.compound) {
        emit("tap", node.id(), nd);
        return;
      }
      if (nd.kind === "fold") emit("fold", node.id(), nd);
      // Tapping pins the Spotlight; the map has to answer the same question the story's hover
      // answers — "which of these is it, and what touches it" — so the node and its immediate
      // neighbourhood light up and everything else dims (F-MAP-08).
      else highlightNeighbourhood(node);
      if (dbl) emit("dbltap", node.id(), nd);
      else emit("tap", node.id(), nd);
    });
    cy.on("tap", "edge", (evt) => {
      const em = model?.edges.find((x) => x.id === evt.target.id());
      if (em) emit("edgeTap", { ...em, sentence: edgeSentence(em, model.nodeById) });
    });
    cy.on("tap", (evt) => {
      if (evt.target === cy) {
        cy.elements().unselect();
        clearHighlight();
        emit("tapBackground");
      }
    });
    cy.on("dragfree", "node", () => {
      if (model) savePositions(positionsKey(repo, model.level, model.root));
    });
  }

  function on(event, fn) {
    if (!listeners.has(event)) listeners.set(event, new Set());
    listeners.get(event).add(fn);
    return () => listeners.get(event)?.delete(fn);
  }

  function destroy() {
    clearTimeout(resizeTimer);
    destroyed = true;
    clearTimeout(fitTimer);
    ro?.disconnect();
    listeners.clear();
    if (cy) {
      cy.destroy();
      cy = null;
    }
  }

  return {
    show,
    setLens,
    highlight,
    softHighlight,
    clearHighlight,
    select,
    resolveRef,
    // The public `fit()` is only ever a person asking (the Fit button, `F`, the story's fit action),
    // so it re-decides everything rather than reusing a frame a stuck view was drawn in.
    fit: () => fit({ explicit: true }),
    relayout,
    zoom,
    on,
    destroy,
    setControls,
    getView: () => model?.view ?? null,
    getModel: () => model,
    isReady: () => Boolean(cy),
    legendFor: (view, l) => legendFor(view ?? model?.view, l ?? lens),
    available: true,
    get cy() {
      return cy;
    },
  };
}

// ---------------------------------------------------------------------------
// Services and Data flow (services-and-flows-spec.md §4)
// ---------------------------------------------------------------------------

/**
 * Node shape by service kind (§4). Every shape here is wide enough to hold the two-line label a
 * service node carries (name, then "<what it is> · <provider>"), so the shape is a second cue and
 * never the only one: a reader who cannot tell a barrel from a bucket still reads the words.
 */
export const SERVICE_SHAPES = {
  database: "barrel",
  table: "rectangle",
  kv: "round-rectangle",
  bucket: "bottom-round-rectangle",
  queue: "right-rhomboid",
  "durable-object": "hexagon",
  assets: "tag",
  api: "round-octagon",
  var: "ellipse",
  secret: "concave-hexagon",
  vectorize: "round-hexagon",
  ai: "round-tag",
  hyperdrive: "cut-rectangle",
  analytics: "octagon",
};
/** What a service kind is called in a sentence. */
export const SERVICE_NOUNS = {
  database: "database",
  table: "table",
  kv: "KV namespace",
  bucket: "bucket",
  queue: "queue",
  "durable-object": "durable object",
  assets: "assets binding",
  api: "HTTP API",
  var: "var",
  secret: "secret",
  vectorize: "vectorize index",
  ai: "AI binding",
  hyperdrive: "hyperdrive",
  analytics: "analytics dataset",
};
/** Operation colours (§4): read `--up` cyan, write `--down` orange, touch muted. */
export const OP_COLORS = { read: COLORS.up, write: COLORS.down, touch: COLORS.edge };
export const OP_VERBS = { read: "reads", write: "writes to", touch: "touches" };
const SERVICE_W = 170;
const SERVICE_H = 46;
const STEP_W = 172;
const STEP_H = 44;
/** Services drawn before the rest fold into one node; `?all=1` draws every one of them. */
export const MAX_SERVICE_NODES = 18;

export function serviceNoun(kind) {
  return SERVICE_NOUNS[kind] ?? String(kind ?? "service");
}
export function serviceShape(kind) {
  return SERVICE_SHAPES[kind] ?? "round-rectangle";
}
/** The name a service is known by on screen: its binding, else its human name. */
export function serviceLabel(s) {
  return s?.binding || s?.name || String(s?.id ?? "").replace(/^svc:[^:]+:/, "");
}
/** "wrangler.toml:97" — the line that declares a service, or documents it when nothing declares it. */
export function declaredLine(s) {
  const at = s?.declaredAt;
  return at?.file ? `${at.file}:${at.line ?? 1}` : null;
}

/** Every field of a model node, so the level builders only state what differs. */
function blankNode(over) {
  return {
    kind: "file",
    label: "",
    fullLabel: "",
    path: "",
    parent: null,
    compound: false,
    ghost: false,
    side: null,
    hop: null,
    center: false,
    planned: false,
    actual: false,
    task: null,
    otherTask: false,
    collision: [],
    foldCount: 0,
    foldIds: [],
    role: "source",
    area: null,
    areaLabel: null,
    subGroup: null,
    subLabel: null,
    hue: COLORS.explorerFill,
    w: 20,
    h: 20,
    size: 20,
    shape: "ellipse",
    lines: 0,
    lang: "",
    knowledge: null,
    aggregates: null,
    history: null,
    commits30: null,
    heat: null,
    heatWindow: HEAT_WINDOW,
    author: null,
    inDegree: 0,
    outDegree: 0,
    testedBy: [],
    entry: false,
    entryKinds: [],
    labelLine1: null,
    labelCompact: false,
    entryLine: "",
    tasks: [],
    state: null,
    raw: null,
    ...over,
  };
}

/** The model every level shares, with the fields the services and flow levels never use zeroed. */
function baseModel(over) {
  const nodes = over.nodes ?? [];
  return {
    view: over.view ?? {},
    level: over.level,
    root: over.root ?? "-",
    compoundId: null,
    areasById: over.areasById ?? new Map(),
    nodes,
    nodeById: new Map(nodes.map((n) => [n.id, n])),
    edges: over.edges ?? [],
    heatThresholds: [],
    heatWindow: HEAT_WINDOW,
    heatCtx: { window: HEAT_WINDOW, modal: null },
    people: [],
    peopleById: new Map(),
    primaryTask: null,
    isBlast: false,
    hiddenTests: over.hiddenTests ?? 0,
    testsShown: Boolean(over.testsShown),
    counts: over.counts ?? {},
    layout: over.layout,
    shaped: true, // positions come from the builder or from a fixed-direction dagre: no re-shaping
    opts: over.opts ?? {},
    ...over,
  };
}

/** The level-1 area a repo-relative file path belongs to: the longest AreaRef whose path prefixes it. */
function areaForPath(path, areas) {
  const p = String(path ?? "");
  let best = null;
  for (const a of areas ?? []) {
    const dir = dirPathOf(a.id);
    const pre = dir === "." || dir === "" ? "" : `${dir}/`;
    if (pre === "" || p.startsWith(pre)) {
      if (!best || pre.length > (best.pre?.length ?? 0)) best = { area: a, pre };
    }
  }
  return best?.area ?? null;
}

/**
 * The Services map (§4): a bipartite layout — the files that touch a service on the left, grouped
 * into their level-1 areas, the services on the right ranked by fan-in. Positions are computed here
 * rather than by dagre, because "left, grouped" and "right, ranked" *is* the layout; dagre would
 * re-derive a worse version of it from the edges.
 *
 * `view`: { level:'services', index: ServiceIndex, areas: AreaRef[], focus?: serviceId, all?, tests? }
 */
function buildServiceModel(view, opts = {}) {
  const index = view.index ?? { services: [], edges: [] };
  const lensKey = opts.lens ?? view.lens ?? "structure";
  const focus = view.focus ?? null;
  const showTests = Boolean(view.tests);
  const areas = Array.isArray(view.areas) ? view.areas : [];
  const hueOf = areaHueResolver(areas);
  const areasById = areaIndex({ areas });

  const allServices = Array.isArray(index.services) ? index.services : [];
  const byId = new Map(allServices.map((s) => [s.id, s]));
  const allEdges = (Array.isArray(index.edges) ? index.edges : []).filter((e) => byId.has(e.service));
  const testEdges = allEdges.filter((e) => e.viaTest);
  let edgesIn = showTests ? allEdges : allEdges.filter((e) => !e.viaTest);
  if (focus) {
    const family = new Set([focus, ...allServices.filter((s) => s.parent === focus).map((s) => s.id)]);
    edgesIn = edgesIn.filter((e) => family.has(e.service));
  }

  // Fan-in is the number of distinct files that touch a service: the rank the spec orders by.
  const fanIn = new Map();
  const filesOf = new Map();
  for (const e of edgesIn) {
    if (!filesOf.has(e.service)) filesOf.set(e.service, new Set());
    filesOf.get(e.service).add(e.file);
  }
  for (const [id, set] of filesOf) fanIn.set(id, set.size);

  let services = focus ? allServices.filter((s) => s.id === focus || s.parent === focus) : allServices.slice();
  const rank = (s) => [-(fanIn.get(s.id) ?? 0), -(s.uses ?? 0), s.kind === "var" ? 1 : 0, serviceLabel(s).toLowerCase()];
  services.sort((a, b) => {
    const ra = rank(a);
    const rb = rank(b);
    for (let i = 0; i < ra.length; i += 1) {
      if (ra[i] < rb[i]) return -1;
      if (ra[i] > rb[i]) return 1;
    }
    return 0;
  });
  // Every *declared* service is drawn whatever its fan-in: a binding nothing touches ranks last by
  // definition, and it is one of the two states this page exists to show. The remaining seats go to
  // the top of the fan-in ranking, and the tail folds into one node the toolbar can unfold.
  let folded = [];
  if (!(view.all || focus)) {
    const keep = new Set(services.filter((s) => s.declared !== false).map((s) => s.id));
    const seats = Math.max(MAX_SERVICE_NODES, keep.size);
    for (const s of services) {
      if (keep.size >= seats) break;
      keep.add(s.id);
    }
    folded = services.filter((s) => !keep.has(s.id));
    services = services.filter((s) => keep.has(s.id));
  }
  const drawnIds = new Set(services.map((s) => s.id));
  const edges = edgesIn.filter((e) => drawnIds.has(e.service));
  const fileIds = Array.from(new Set(edges.map((e) => e.file))).sort();

  const nodes = [];
  const areaOrder = [];
  const groups = new Map();
  for (const path of fileIds) {
    const a = areaForPath(path, areas);
    const key = a?.id ?? "area:root";
    if (!groups.has(key)) {
      groups.set(key, { key, area: a, label: a?.label ?? "repo root", files: [] });
      areaOrder.push(key);
    }
    groups.get(key).files.push(path);
  }
  areaOrder.sort((x, y) => groups.get(y).files.length - groups.get(x).files.length || String(x).localeCompare(String(y)));

  // Left side: one stack per area, 34px a file, the compound drawn around it. A stack taller than
  // LEFT_ROWS starts a second column rather than running off the pane — whole groups only, so a
  // compound is always a clean rectangle.
  const ROW = 40; // a 12px label hangs under each dot: less than this and two file names touch
  const GROUP_GAP = 36;
  const LEFT_ROWS = 15;
  const LEFT_COL_W = 230;
  let y = 0;
  let leftCol = 0;
  let leftHeightMax = 0;
  for (const key of areaOrder) {
    const g = groups.get(key);
    if (y > 0 && y / ROW + g.files.length > LEFT_ROWS) {
      leftHeightMax = Math.max(leftHeightMax, y - GROUP_GAP);
      leftCol += 1;
      y = 0;
    }
    const leftX = leftCol * LEFT_COL_W;
    const hue = g.area ? areaHue(g.area, hueOf) : COLORS.areaOther;
    const compoundId = `area:${key}`;
    const top = y;
    for (const path of g.files) {
      const touches = edges.filter((e) => e.file === path);
      const size = clamp(18 + Math.sqrt(new Set(touches.map((t) => t.service)).size) * 5, 18, 34);
      nodes.push(
        blankNode({
          id: path,
          kind: "file",
          label: basename(path),
          fullLabel: path,
          path,
          parent: compoundId,
          role: touches.every((t) => t.viaTest) ? "test" : "source",
          area: g.area?.id ?? null,
          areaLabel: g.label,
          hue,
          w: size,
          h: size,
          size,
          shape: "ellipse",
          svc: "file",
          outDegree: new Set(touches.map((t) => t.service)).size,
          pos: { x: leftX, y },
        }),
      );
      y += ROW;
    }
    nodes.push(
      blankNode({
        id: compoundId,
        kind: "dir",
        label: g.label,
        fullLabel: g.label,
        path: g.area ? dirPathOf(g.area.id) : ".",
        compound: true,
        area: g.area?.id ?? null,
        hue,
        shape: "round-rectangle",
        svc: "area",
        pos: { x: leftX, y: (top + y - ROW) / 2 },
      }),
    );
    y += GROUP_GAP;
  }
  const leftHeight = Math.max(leftHeightMax, Math.max(0, y - GROUP_GAP));
  const leftWidth = (leftCol + 1) * LEFT_COL_W;

  // Right side: services in rank order, read down the first column and on into the next. Ranked by
  // fan-in either way; wrapping keeps a repo with fifty services from becoming a mile-high strip.
  const SROW = SERVICE_H + 16;
  const SCOL_W = SERVICE_W + 34;
  const total = services.length + (folded.length ? 1 : 0);
  const rightCols = clamp(Math.ceil(total / 12), 1, 4);
  const rightRows = Math.max(1, Math.ceil(total / rightCols));
  const rightHeight = Math.max(0, Math.min(total, rightRows) * SROW - (SROW - SERVICE_H));
  const rightX = leftWidth + 150;
  const height = Math.max(leftHeight, rightHeight);
  const leftShift = (height - leftHeight) / 2;
  for (const n of nodes) if (n.pos) n.pos.y += leftShift;
  const rightShift = (height - rightHeight) / 2;
  const seatAt = (i) => ({ x: rightX + Math.floor(i / rightRows) * SCOL_W, y: (i % rightRows) * SROW + rightShift });
  let seat = 0;
  for (const s of services) {
    const declared = s.declared !== false;
    const used = (fanIn.get(s.id) ?? 0) > 0;
    nodes.push(
      blankNode({
        id: s.id,
        kind: "service",
        svc: "service",
        svcKind: s.kind,
        label: `${serviceLabel(s)}\n${serviceSubLine(s, declared, used)}`,
        labelLine1: serviceLabel(s),
        fullLabel: serviceLabel(s),
        path: s.name ?? serviceLabel(s),
        w: SERVICE_W,
        h: SERVICE_H,
        size: SERVICE_H,
        shape: serviceShape(s.kind),
        hue: COLORS.explorerFill,
        declared,
        unused: !used,
        provider: s.provider ?? null,
        notes: s.notes ?? 0,
        knowledge: { own: s.notes ?? 0, inherited: 0, stale: 0, byType: {}, lastNoteDate: null, lowestConfidence: null },
        inDegree: fanIn.get(s.id) ?? 0,
        raw: s,
        pos: seatAt(seat),
      }),
    );
    seat += 1;
  }
  if (folded.length) {
    nodes.push(
      blankNode({
        id: "fold:services",
        kind: "fold",
        svc: "fold",
        label: `+${folded.length} more`,
        fullLabel: `${folded.length} services with fewer callers`,
        foldCount: folded.length,
        foldIds: folded.map((s) => s.id),
        w: 150,
        h: 36,
        shape: "round-rectangle",
        pos: seatAt(seat),
      }),
    );
  }

  const modelEdges = [];
  for (const e of edges) {
    const id = `${e.file}->${e.service}:${e.op}`;
    modelEdges.push({
      id,
      source: e.file,
      target: e.service,
      kind: "uses",
      op: e.op,
      weight: e.count ?? e.sources?.length ?? 1,
      names: [],
      via: [],
      confidence: e.confidence ?? "exact",
      viaTest: Boolean(e.viaTest),
      cycle: false,
      cycleReturn: false,
      spoke: true,
      width: clamp(1.2 + Math.log2(Math.max(1, e.count ?? 1)) * 0.9, 1.2, 4),
      label: String(e.count ?? e.sources?.length ?? 1),
      color: OP_COLORS[e.op] ?? COLORS.edge,
      labelColor: COLORS.muted,
      sources: Array.isArray(e.sources) ? e.sources : [],
      svc: "op",
      raw: e,
    });
  }
  modelEdges.sort((a, b) => a.id.localeCompare(b.id));

  return baseModel({
    view,
    level: "services",
    root: focus ? `services:${focus}` : view.all ? "services:all" : "services",
    areasById,
    nodes,
    edges: modelEdges,
    hiddenTests: showTests ? 0 : new Set(testEdges.map((e) => e.file)).size,
    testsShown: showTests,
    counts: { services: allServices.length, shown: services.length, folded: folded.length, files: fileIds.length, undeclared: allServices.filter((s) => s.declared === false).length, unused: (index.unused ?? []).length },
    layout: { name: "bipartite", shaped: true },
    focus,
    opts,
  });
}

/** "KV namespace · cloudflare", "secret · declared nowhere", "assets binding · unused". */
function serviceSubLine(s, declared, used) {
  const noun = serviceNoun(s.kind);
  if (!declared) return `${noun} · declared nowhere`;
  if (!used) return `${noun} · unused`;
  return s.provider ? `${noun} · ${s.provider}` : noun;
}

/**
 * The Data flow map (§4): dagre `rankdir: LR` from the endpoint through every function to the
 * services and response. Edges carry compact summaries of compiler-backed arguments, boundary
 * shapes, or returns; the story card beside the graph owns the complete recursive detail.
 *
 * `view`: { level:'flow', flow: Flow, services: ServiceNode[] }
 */
function buildFlowModel(view, opts = {}) {
  const flow = view.flow ?? { steps: [], services: [] };
  const steps = Array.isArray(flow.steps) ? flow.steps : [];
  const svcById = new Map((Array.isArray(view.services) ? view.services : []).map((s) => [s.id, s]));
  const flowNodeById = new Map((Array.isArray(flow.nodes) ? flow.nodes : []).map((node) => [node.id, node]));

  const seen = new Map();
  const order = [];
  const note = (id) => {
    if (id == null || seen.has(id)) return;
    seen.set(id, true);
    order.push(String(id));
  };
  for (const s of steps) {
    note(s.from);
    note(s.to);
  }

  const nodes = [];
  for (const id of order) {
    const semantic = flowNodeById.get(id) ?? null;
    const entityKind = semantic?.kind ?? (id.startsWith("svc:") ? "service" : id.startsWith("resp:") ? "response" : id.startsWith("route:") ? "endpoint" : id.startsWith("sym:") ? "function" : "file");
    const kindLabel = entityKind.toUpperCase();
    if (entityKind === "service") {
      const s = svcById.get(id) ?? { id, kind: id.split(":")[1] ?? "api", binding: null, name: id.split(":").slice(2).join(":"), declared: true, provider: null };
      const declared = s.declared !== false;
      nodes.push(
        blankNode({
          id,
          kind: "service",
          svc: "service",
          entityKind,
          svcKind: s.kind,
          label: `${kindLabel}\n${semantic?.label ?? serviceLabel(s)}\n${semantic?.path ?? serviceSubLine(s, declared, true)}`,
          labelLine1: serviceLabel(s),
          fullLabel: serviceLabel(s),
          path: semantic?.path ?? s.name ?? serviceLabel(s),
          w: SERVICE_W,
          h: 62,
          size: 62,
          shape: serviceShape(s.kind),
          hue: COLORS.explorerFill,
          declared,
          provider: s.provider ?? null,
          notes: s.notes ?? 0,
          knowledge: { own: s.notes ?? 0, inherited: 0, stale: 0, byType: {}, lastNoteDate: null, lowestConfidence: null },
          raw: s,
        }),
      );
      continue;
    }
    if (entityKind === "response") {
      nodes.push(
        blankNode({
          id,
          kind: "response",
          svc: "response",
          entityKind,
          label: `${kindLabel}\n${semantic?.label ?? "Response"}\n${semantic?.path ?? (flow.route ? `${flow.method ?? "GET"} ${flow.route}` : "response")}`,
          fullLabel: semantic?.label ?? "Response",
          path: semantic?.path ?? (flow.route ? `${flow.method ?? "GET"} ${flow.route} response` : "response"),
          w: STEP_W,
          h: 62,
          shape: "round-rectangle",
          hue: COLORS.ok,
        }),
      );
      continue;
    }
    if (id.startsWith("sym:") || entityKind === "function" || entityKind === "method" || entityKind === "class") {
      const rest = id.startsWith("sym:") ? id.slice(4) : id;
      const cut = rest.lastIndexOf("::");
      const file = semantic?.file ?? (cut > 0 ? rest.slice(0, cut) : rest);
      const name = semantic?.label ?? (cut > 0 ? rest.slice(cut + 2) : rest);
      const entry = id === flow.entry;
      nodes.push(
        blankNode({
          id,
          kind: "symbol",
          svc: entityKind,
          entityKind,
          label: `${kindLabel}\n${name}\n${file}`,
          labelLine1: name,
          fullLabel: name,
          path: file,
          file,
          symbol: name,
          entry,
          w: STEP_W,
          h: 62,
          shape: "round-rectangle",
          hue: entry ? COLORS.info : COLORS.explorerFill,
        }),
      );
      continue;
    }
    const label = semantic?.label ?? (entityKind === "endpoint" ? flow.title : basename(id));
    const file = semantic?.file ?? (entityKind === "file" ? id : null);
    nodes.push(
      blankNode({
        id,
        kind: entityKind === "endpoint" ? "route" : "file",
        svc: entityKind,
        entityKind,
        label: `${kindLabel}\n${label}\n${semantic?.path ?? id}`,
        labelLine1: label,
        fullLabel: label,
        path: semantic?.path ?? id,
        file,
        entry: id === flow.entryNode,
        w: STEP_W,
        h: 62,
        shape: "round-rectangle",
        hue: COLORS.info,
      }),
    );
  }

  if (flow.requestPathOnly) for (const node of nodes) {
    node.w = 320;
    node.h = 76;
    // Display-only break opportunities; canonical IDs and navigable paths remain untouched.
    node.label = node.label.replaceAll("/", "/\u200b");
  }
  const edges = [];
  const seenEdge = new Map();
  steps.forEach((s, i) => {
    const base = `${s.from}->${s.to}:${s.kind}:${s.label}`;
    const n = (seenEdge.get(base) ?? 0) + 1;
    seenEdge.set(base, n);
    const value = valueForStep(s);
    edges.push({
      id: n > 1 ? `${base}#${n}` : base,
      source: s.from,
      target: s.to,
      kind: s.kind === "read" || s.kind === "write" ? "uses" : s.kind === "respond" ? "respond" : "call",
      op: s.kind === "read" ? "read" : s.kind === "write" ? "write" : null,
      weight: 1,
      names: value.names,
      via: [],
      confidence: s.confidence ?? "exact",
      valueEvidence: value.evidence,
      cycle: false,
      cycleReturn: false,
      spoke: true,
      width: s.kind === "read" || s.kind === "write" ? 2 : 1.4,
      label: value.label,
      color: s.kind === "read" ? OP_COLORS.read : s.kind === "write" ? OP_COLORS.write : s.kind === "respond" ? COLORS.ok : COLORS.edge,
      labelColor: value.evidence === "none" ? COLORS.faint : COLORS.muted,
      step: s,
      stepIndex: i + 1,
      svc: "step",
      raw: s,
    });
  });

  return baseModel({
    view,
    level: "flow",
    root: `flow:${flow.id ?? "?"}`,
    nodes,
    edges,
    counts: { steps: steps.length, services: (flow.services ?? []).length, depth: flow.depth ?? 0, dropped: (flow.dropped ?? []).reduce((a, d) => a + (d.count ?? 0), 0) },
    // A flow this size only fits at a zoom where no label is drawn anyway, so the readability floor
    // buys nothing and costs the shape: hold the whole walk, and let the reader zoom into a hop.
    fitWhole: nodes.length > 36,
    layout: { name: "dagre", rankDir: flow.requestPathOnly ? "TB" : "LR", fixedDir: true, shaped: true, grid: !flow.requestPathOnly, fill: !flow.requestPathOnly, ranker: "network-simplex", nodeDimensionsIncludeLabels: false, fit: false, animate: true, animationDuration: dur(MOTION.move), animationEasing: "ease-out", padding: 30, spacingFactor: 1, rankSep: flow.requestPathOnly ? 38 : 150, nodeSep: 22 },
    flow,
    opts,
  });
}

/** The Data flow index (§4): every entry point on the left, the services each one reaches on the right. */
function buildFlowsModel(view, opts = {}) {
  const flows = Array.isArray(view.flows) ? view.flows : [];
  const svcById = new Map((Array.isArray(view.services) ? view.services : []).map((s) => [s.id, s]));
  const reached = new Map();
  for (const f of flows) for (const id of f.services ?? []) reached.set(id, (reached.get(id) ?? 0) + 1);

  const nodes = [];
  const ROW = 66;
  const services = Array.from(reached.keys()).sort((a, b) => (reached.get(b) ?? 0) - (reached.get(a) ?? 0) || a.localeCompare(b));
  // Both sides wrap into columns: a repo with fifty entry points is a wall, not a list, and one
  // column of fifty fits only at a zoom where nothing on it can be read.
  const ROWS = 12;
  const ECOL_W = 232;
  const SCOL_W2 = SERVICE_W + 34;
  const eCols = Math.max(1, Math.ceil(flows.length / ROWS));
  const eRows = Math.max(1, Math.ceil(flows.length / eCols));
  const sCols = Math.max(1, Math.ceil(services.length / ROWS));
  const sRows = Math.max(1, Math.ceil(Math.max(1, services.length) / sCols));
  const height = Math.max(eRows, sRows) * ROW;
  const eShift = (height - eRows * ROW) / 2;
  const sShift = (height - sRows * ROW) / 2;
  const gap = services.length ? 200 : 0;
  const rightX = eCols * ECOL_W + gap;
  flows.forEach((f, i) => {
    nodes.push(
      blankNode({
        id: `flow:${f.id}`,
        kind: "step",
        svc: "entry",
        label: `${f.title}\n${f.steps} step${f.steps === 1 ? "" : "s"} · ${basename(f.source?.file ?? "")}`,
        labelLine1: f.title,
        fullLabel: f.title,
        path: f.source?.file ?? "",
        file: f.source?.file ?? "",
        entry: true,
        w: 200,
        h: STEP_H,
        shape: "round-rectangle",
        hue: COLORS.info,
        raw: f,
        pos: { x: Math.floor(i / eRows) * ECOL_W, y: (i % eRows) * ROW + eShift },
      }),
    );
  });
  services.forEach((id, i) => {
    const s = svcById.get(id) ?? { id, kind: id.split(":")[1] ?? "api", binding: null, name: id.split(":").slice(2).join(":"), declared: true };
    const declared = s.declared !== false;
    nodes.push(
      blankNode({
        id,
        kind: "service",
        svc: "service",
        svcKind: s.kind,
        label: `${serviceLabel(s)}\n${serviceSubLine(s, declared, true)}`,
        labelLine1: serviceLabel(s),
        fullLabel: serviceLabel(s),
        path: s.name ?? serviceLabel(s),
        w: SERVICE_W,
        h: SERVICE_H,
        shape: serviceShape(s.kind),
        hue: COLORS.explorerFill,
        declared,
        provider: s.provider ?? null,
        notes: s.notes ?? 0,
        knowledge: { own: s.notes ?? 0, inherited: 0, stale: 0, byType: {}, lastNoteDate: null, lowestConfidence: null },
        raw: s,
        pos: { x: rightX + Math.floor(i / sRows) * SCOL_W2, y: (i % sRows) * ROW + sShift },
      }),
    );
  });
  const edges = [];
  for (const f of flows) {
    for (const id of f.services ?? []) {
      if (!reached.has(id)) continue;
      edges.push({
        id: `flow:${f.id}->${id}`,
        source: `flow:${f.id}`,
        target: id,
        kind: "uses",
        op: null,
        weight: 1,
        names: [],
        via: [],
        confidence: "exact",
        cycle: false,
        cycleReturn: false,
        spoke: true,
        width: 1.4,
        label: "",
        color: COLORS.edge,
        labelColor: COLORS.muted,
        svc: "reaches",
        raw: f,
      });
    }
  }
  return baseModel({
    view,
    level: "flows",
    root: "flows",
    nodes,
    edges,
    counts: { flows: flows.length, services: services.length },
    // Same reasoning as the flow map: past this many entry points the readability floor would clip
    // the last columns off a picture whose whole point is "here is everything that starts a flow".
    fitWhole: flows.length + services.length > 36,
    layout: { name: "bipartite", shaped: true },
    opts,
  });
}

/** A recursive semantic shape reduced to one compact edge label. The card keeps the full tree. */
export function valueShapeLabel(shape) {
  if (!shape) return null;
  const fields = Array.isArray(shape.fields) ? shape.fields.map((field) => field.name).filter(Boolean) : [];
  if (fields.length >= 6) return `${fields.length} fields`;
  if (fields.length) {
    const list = `{ ${fields.join(", ")} }`;
    return list.length <= 34 ? list : `${fields.length} fields`;
  }
  if (shape.reference) return String(shape.reference);
  if (shape.kind === "array") return "array";
  if (shape.kind === "tuple") return `${shape.elements?.length ?? 0} items`;
  if (shape.kind === "union") return `${shape.variants?.length ?? 0} variants`;
  return null;
}

function argumentLabel(values) {
  if (!Array.isArray(values) || values.length === 0) return null;
  if (values.length === 1) {
    const value = values[0];
    const shaped = valueShapeLabel(value?.shape);
    if (shaped) return shaped;
    const expression = String(value?.expression ?? "argument");
    return expression.length <= 34 ? expression : "1 argument";
  }
  return `${values.length} arguments`;
}

function returnLabel(returns) {
  if (!Array.isArray(returns) || returns.length === 0) return null;
  if (returns.length > 1) return `${returns.length} returns`;
  const variant = returns[0];
  const shaped = valueShapeLabel(variant?.shape);
  if (shaped) return shaped;
  const expression = String(variant?.expression ?? "return");
  return expression.length <= 34 ? expression : "1 return";
}

/** Authoritative structured value carried by an edge, in boundary-first order. */
export function valueForStep(step) {
  const boundary = valueShapeLabel(step?.requestPayload) ?? valueShapeLabel(step?.servicePayload);
  if (boundary) {
    const shape = step.requestPayload ?? step.servicePayload;
    return { label: boundary, names: (shape?.fields ?? []).map((field) => field.name), evidence: "structured" };
  }
  const args = argumentLabel(step?.arguments);
  if (args) return { label: args, names: (step.arguments ?? []).map((argument) => argument.expression), evidence: "positional" };
  const returned = returnLabel(step?.returns);
  if (returned) return { label: returned, names: (step.returns ?? []).map((variant) => variant.expression), evidence: "structured" };
  return { label: "no values found", names: [], evidence: "none" };
}

/** Paint for the services and flow levels: the shape and the words say what a node is, the border what state it is in. */
function paintServiceNode(nd, lens) {
  const out = { fill: COLORS.explorerFill, border: COLORS.lineStrong, bw: 1.5, bgOpacity: 1, classes: ["svc", `svc-${nd.svc}`], textColor: COLORS.text, hatch: false, stale: false };
  if (nd.svc === "file") {
    out.fill = nd.hue;
    out.border = nd.hue;
    out.bw = 1;
    if (nd.role === "test") {
      out.bgOpacity = 0;
      out.border = COLORS.muted;
    }
    return out;
  }
  if (nd.svc === "response") {
    out.fill = COLORS.panel2;
    out.border = COLORS.ok;
    out.bw = 2;
    return out;
  }
  if (nd.svc === "entry" || nd.svc === "endpoint") {
    out.fill = COLORS.panel2;
    out.border = COLORS.info;
    out.bw = 2;
    return out;
  }
  if (nd.svc === "step" || nd.svc === "function" || nd.svc === "method" || nd.svc === "class") {
    out.fill = COLORS.panel2;
    out.border = COLORS.lineStrong;
    return out;
  }
  // A service. Undeclared is the headline (§4): it takes `--bad`. Declared and untouched is a
  // dashed border — a state, not a fault.
  out.fill = COLORS.explorerFill;
  if (nd.declared === false) {
    out.border = COLORS.bad;
    out.bw = 2;
    out.classes.push("undeclared");
  } else if (nd.unused) {
    out.border = COLORS.warn;
    out.classes.push("unused");
  }
  if (lens === "knowledge") {
    out.fill = (nd.notes ?? 0) > 0 ? COLORS.knowOwn : COLORS.knowNone;
    out.textColor = labelOn(out.fill);
    // `--know-none` is near-black on `--bg`: without an outline an unnoted service is a hole in the
    // canvas (§5.1's shapeEdge rule). The undeclared and unused borders still win — they are the
    // page's headline, and a lens may not take them.
    if (nd.declared !== false && !nd.unused) out.border = out.fill === COLORS.knowNone ? COLORS.shapeEdge : out.fill;
  }
  return out;
}

/** Legend rows for the two new levels (§5.5 rules 7–8: only what the canvas cannot explain itself). */
function serviceLegend(model, lens) {
  const rows = [];
  const nodes = model.nodes.filter((n) => !n.compound);
  const edges = model.edges;
  const push = (row) => {
    if (row.count > 0) rows.push(row);
  };
  if (model.level === "flow" || model.level === "flows") {
    const byEvidence = (value) => edges.filter((edge) => edge.valueEvidence === value);
    push({ label: "Structured value read from code", color: COLORS.muted, kind: "edge", count: byEvidence("structured").length, isolate: byEvidence("structured").map((e) => e.id) });
    push({ label: "Positional arguments", color: COLORS.info, kind: "edge", count: byEvidence("positional").length, isolate: byEvidence("positional").map((e) => e.id) });
    push({ label: "No value structure found", color: COLORS.faint, kind: "edge", count: byEvidence("none").length, isolate: byEvidence("none").map((e) => e.id) });
    for (const [op, label] of [["read", "Reads a service"], ["write", "Writes to a service"]]) {
      const list = edges.filter((e) => e.op === op);
      push({ label, color: OP_COLORS[op], kind: "edge", count: list.length, isolate: list.map((e) => e.id) });
    }
    const svcNodes = nodes.filter((n) => n.svc === "service");
    push({ label: "Service", color: COLORS.lineStrong, kind: "ring", count: svcNodes.length, isolate: svcNodes.map((n) => n.id) });
    const undeclared = svcNodes.filter((n) => n.declared === false);
    push({ label: "Declared nowhere", color: COLORS.bad, kind: "ring", count: undeclared.length, isolate: undeclared.map((n) => n.id) });
    return { title: model.level === "flow" ? "Line = value · Colour = operation" : "Ring = whether a manifest declares it", rows };
  }
  // Services: the left column is coloured by area, the edges by operation, the borders by state.
  const areasSeen = new Map();
  for (const n of nodes) {
    if (n.svc !== "file") continue;
    const key = n.areaLabel ?? "repo root";
    if (!areasSeen.has(key)) areasSeen.set(key, { label: key, color: n.hue, ids: [] });
    areasSeen.get(key).ids.push(n.id);
  }
  for (const a of Array.from(areasSeen.values()).sort((x, y) => y.ids.length - x.ids.length)) {
    push({ label: a.label, color: a.color, kind: "fill", count: a.ids.length, isolate: a.ids });
  }
  for (const [op, label] of [["read", "Reads"], ["write", "Writes"], ["touch", "Touches"]]) {
    const list = edges.filter((e) => e.op === op);
    push({ label, color: OP_COLORS[op], kind: "edge", count: list.length, isolate: list.map((e) => e.id) });
  }
  const heur = edges.filter((e) => e.confidence === "heuristic");
  push({ label: "Matched through a name", color: COLORS.muted, kind: "edge-dotted", count: heur.length, isolate: heur.map((e) => e.id) });
  const svcNodes = nodes.filter((n) => n.svc === "service");
  if (lens === "knowledge") {
    const noted = svcNodes.filter((n) => (n.notes ?? 0) > 0);
    const unnoted = svcNodes.filter((n) => !(n.notes ?? 0));
    push({ label: "A note about it", color: COLORS.knowOwn, kind: "fill", count: noted.length, isolate: noted.map((n) => n.id) });
    push({ label: "Nobody has written about it", color: COLORS.knowNone, kind: "fill", count: unnoted.length, isolate: unnoted.map((n) => n.id) });
  }
  const undeclared = svcNodes.filter((n) => n.declared === false);
  push({ label: "Used in code, declared nowhere", color: COLORS.bad, kind: "ring", count: undeclared.length, isolate: undeclared.map((n) => n.id) });
  const unused = svcNodes.filter((n) => n.unused && n.declared !== false);
  push({ label: "Declared, nothing touches it", color: COLORS.warn, kind: "ring", count: unused.length, isolate: unused.map((n) => n.id) });
  const title = lens === "knowledge" ? "Colour = area · Fill = notes on each service" : "Colour = area · Line = operation";
  return { title, rows };
}

/** Footer counts for the two new levels. */
function serviceFooter(model) {
  const c = model.counts ?? {};
  if (model.level === "flow") {
    const parts = [plural(c.steps ?? 0, "step"), plural((c.depth ?? 0) + 1 > 0 ? c.depth ?? 0 : 0, "hop"), plural(c.services ?? 0, "service")];
    if (c.dropped) parts.push(`${c.dropped} more not drawn`);
    return parts.filter(Boolean).join(" · ");
  }
  if (model.level === "flows") return [plural(c.flows ?? 0, "entry point"), plural(c.services ?? 0, "service")].join(" · ");
  const parts = [];
  if (c.folded) parts.push(`${c.shown} of ${c.services} services`);
  else parts.push(plural(c.shown ?? 0, "service"));
  parts.push(plural(c.files ?? 0, "file"));
  parts.push(plural(model.edges.length, "edge"));
  if (c.folded) parts.push(`${c.folded} folded`);
  if (model.hiddenTests) parts.push(`${plural(model.hiddenTests, "test file")} hidden`);
  return parts.join(" · ");
}

/** Tooltip for a services / flow node. */
function serviceTip(nd) {
  if (nd.svc === "file") {
    const n = nd.outDegree ?? 0;
    return { path: nd.fullLabel, meta: [n ? `touches ${plural(n, "service")}` : null, nd.role === "test" ? "test file" : null].filter(Boolean) };
  }
  if (["entry", "step", "endpoint", "function", "method", "class"].includes(nd.svc)) {
    return { path: nd.symbol ? `${nd.entityKind?.toUpperCase() ?? "SYMBOL"}: ${nd.symbol} — ${nd.file}` : `${nd.entityKind?.toUpperCase() ?? "ENTRY"}: ${nd.path}`, meta: [nd.entry ? "the entry point" : null].filter(Boolean) };
  }
  if (nd.svc === "response") return { path: nd.path, meta: ["what the handler sends back"] };
  if (nd.svc === "fold") return { path: `${nd.foldCount} services with fewer callers`, meta: [nd.foldIds.slice(0, 6).map((id) => id.replace(/^svc:[^:]+:/, "")).join(", "), nd.foldIds.length > 6 ? "…" : null].filter(Boolean) };
  const s = nd.raw ?? {};
  const meta = [];
  meta.push(s.name && s.name !== nd.fullLabel ? `${serviceNoun(nd.svcKind)} ${s.name}` : serviceNoun(nd.svcKind));
  if (s.provider) meta.push(s.provider);
  const line = declaredLine(s);
  if (s.declared === false) meta.push(line ? `declared nowhere — documented in ${line}` : "declared nowhere: set outside this repo");
  else if (line) meta.push(`declared in ${line}`);
  if (s.uses != null) meta.push(plural(s.uses, "call site"));
  if (nd.unused) meta.push("no code touches it");
  if ((nd.notes ?? 0) > 0) meta.push(plural(nd.notes, "note"));
  return { path: nd.fullLabel, meta };
}

/** The sentence behind an edge on the two new levels. */
function serviceEdgeSentence(e, nodeById) {
  const s = nodeById.get(e.source);
  const t = nodeById.get(e.target);
  if (e.svc === "op") {
    const where = (e.sources ?? []).slice(0, 3).map((r) => `${r.file}:${r.line}`).join(", ");
    const n = e.weight ?? 1;
    const heur = e.confidence === "heuristic" ? " Found through a name — a binding handed over as a parameter, or an alias — so it holds for this call site, not for every caller." : "";
    const test = e.viaTest ? " In a test." : "";
    return `${basename(s?.fullLabel ?? e.source)} ${OP_VERBS[e.op] ?? "touches"} ${t?.fullLabel ?? e.target} in ${n === 1 ? "one place" : `${n} places`}${where ? ` (${where}${(e.sources ?? []).length > 3 ? ", …" : ""})` : ""}.${heur}${test}`;
  }
  if (e.svc === "reaches") return `${s?.fullLabel ?? e.source} reaches ${t?.fullLabel ?? e.target}.`;
  const step = e.step ?? {};
  const a = s?.fullLabel ?? e.source;
  const b = t?.fullLabel ?? e.target;
  const verb = step.kind === "read" ? "reads" : step.kind === "write" ? "writes to" : step.kind === "respond" ? "answers with" : "calls";
  const at = step.source?.file ? ` in ${step.source.file}` : "";
  const value = valueForStep(step);
  return `Step ${e.stepIndex}. ${a} ${verb} ${b}${at}. ${value.label}.`;
}
