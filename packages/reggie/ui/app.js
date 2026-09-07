// Reggie Guidebook — app.js
// Owns: boot and renderer check, hash router, fetch cache, h() DOM helper, entityLink and GLOSSARY,
// breadcrumb, lens control, dense toggle, keyboard map, toasts, POST helpers, search palette shell.
// Other modules import the helpers exported at the bottom; see ui/DOM-CONTRACT.md.
//
// renderLevel() below wires story.js, map.js, reader.js and board.js together per level
// (ui/DOM-CONTRACT.md §"Route → data").

import { renderStory, renderSpotlight, renderSkeleton, sectionHeadingsFor, closeSpotlight, focusNoteForm } from "./story.js";
import { createMap } from "./map.js";
import { createReader } from "./reader.js";
import { renderBoard, renderTaskPage, unmountBoard } from "./board.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const LENSES = ["structure", "knowledge", "tests", "heat", "owners"];
export const LENS_KEYS = { 1: "structure", 2: "knowledge", 3: "tests", 4: "heat", 5: "owners" };
export const LEVELS = ["workspace", "repo", "area", "file", "symbol", "tasks", "task", "people", "person", "time"];
export const CACHE_TTL_MS = 10_000;
export const VENDOR_EXPECTED = "/vendor/cytoscape.min.js";
export const RENDERER_FAILURE_TEXT =
  "The map library did not load. The story still works. Expected `/vendor/cytoscape.min.js` (from packages/reggie/node_modules) or cdnjs.";

const STORAGE = {
  dense: "reggie.dense",
  lens: "reggie.lens",
  recent: "reggie.recent",
  positions: (repo, level, root) => `reggie.pos.${repo}.${level}.${root}`,
};

/** Tooltip text for every chip value (spec §5.2). Keys are lower-case. */
export const GLOSSARY = {
  // note types
  why: "Why this exists: the reason behind a decision or a piece of code.",
  how: "How it works or how to run it.",
  gotcha: "Something surprising that has bitten someone before.",
  verify: "How to check that this is healthy or correct.",
  "data-source": "Where data comes from, who reads and writes it.",
  decision: "A decision that was taken, with its alternatives.",
  // confidence
  high: "Confidence: high — the author checked this against the code.",
  medium: "Confidence: medium — likely right, not fully verified.",
  low: "Confidence: low — a guess; verify before relying on it.",
  // pipeline stages
  onboard: "Stage: onboard — first notes written when the repo joined Reggie.",
  plan: "Stage: plan — a plan was written against the contract.",
  claim: "Stage: claim — someone took the task and started a branch.",
  execute: "Stage: execute — the plan is being carried out.",
  review: "Stage: review — reviews ran on the change.",
  packet: "Stage: packet — the completion packet was written.",
  decide: "Stage: decide — a maintainer approved or sent the work back.",
  release: "Stage: release — the claim on the task was released.",
  // task states
  ungroomed: "Ungroomed: an intake line or task folder with no plan yet.",
  grooming: "Grooming: a plan exists but is not yet merged or does not pass the contract.",
  groomed: "Groomed: the plan is merged to the default branch (solo: passing plan on disk).",
  "in-process": "In process: a task/<slug> branch has commits.",
  "awaiting-decision": "Awaiting decision: an open PR or a completion packet on the branch.",
  done: "Done: the PR merged or the packet was approved on the default branch.",
  // tools
  claude: "Written by Claude Code.",
  codex: "Written by Codex.",
  human: "Written by a person.",
  web: "Written from the web view.",
  // roles
  source: "Role: source file.",
  test: "Role: test file.",
  fixture: "Role: test fixture or helper.",
  config: "Role: configuration.",
  generated: "Role: generated; do not edit by hand.",
  // misc
  exact: "Exact: derived from named imports or declarations.",
  heuristic: "Heuristic: matched by name; may include false matches.",
  stale: "Possibly out of date: the code changed after this note was written.",
};

/** Chip label prefixes (spec: metadata is never a dot-joined tuple). */
export const CHIP_LABELS = {
  type: "Type",
  confidence: "Confidence",
  author: "Written by",
  date: "Date",
  person: "Person",
  tool: "Tool",
  stage: "Stage",
  slug: "Task",
  task: "Task",
  state: "State",
  risk: "Risk",
  role: "Role",
};

// ---------------------------------------------------------------------------
// Small utilities
// ---------------------------------------------------------------------------

export function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

/** localStorage helpers that never throw. */
export const storage = {
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
      /* private mode or quota: ignore */
    }
  },
  remove(key) {
    try {
      localStorage.removeItem(key);
    } catch {
      /* ignore */
    }
  },
  positionsKey: STORAGE.positions,
};

/**
 * h(tag, attrs?, ...children): tiny DOM builder.
 *  - attrs: { class, id, dataset: {…}, style: {…}|string, on: {event: fn}, html: rawString, any other attribute }
 *  - children: strings, Nodes, arrays, null/false (skipped)
 */
export function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  if (attrs && typeof attrs === "object" && !(attrs instanceof Node) && !Array.isArray(attrs)) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v === null || v === undefined || v === false) continue;
      if (k === "class" || k === "className") el.className = v;
      else if (k === "dataset") for (const [dk, dv] of Object.entries(v)) el.dataset[dk] = dv;
      else if (k === "style" && typeof v === "object") Object.assign(el.style, v);
      else if (k === "on") for (const [ev, fn] of Object.entries(v)) el.addEventListener(ev, fn);
      else if (k === "html") el.innerHTML = v;
      else if (k === "text") el.textContent = v;
      else if (v === true) el.setAttribute(k, "");
      else el.setAttribute(k, String(v));
    }
  } else if (attrs !== undefined) {
    children.unshift(attrs);
  }
  append(el, children);
  return el;
}

function append(el, children) {
  for (const c of children) {
    if (c === null || c === undefined || c === false || c === true) continue;
    if (Array.isArray(c)) append(el, c);
    else if (c instanceof Node) el.appendChild(c);
    else el.appendChild(document.createTextNode(String(c)));
  }
}

/** Replace the children of a container. */
export function mount(container, ...children) {
  container.replaceChildren();
  append(container, children);
  return container;
}

export function icon(name, size) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("class", size === 16 ? "i i--16" : "i");
  svg.setAttribute("aria-hidden", "true");
  const use = document.createElementNS("http://www.w3.org/2000/svg", "use");
  use.setAttribute("href", `#i-${name}`);
  svg.appendChild(use);
  return svg;
}

export function $(id) {
  return document.getElementById(id);
}

// ---------------------------------------------------------------------------
// Router (spec §2)
// ---------------------------------------------------------------------------

/** Encode a path/id for the hash: keep '/', ':' and '.' readable, escape anything that breaks parsing. */
export function encodeId(id) {
  return encodeURIComponent(String(id)).replace(/%2F/gi, "/").replace(/%3A/gi, ":").replace(/%40/gi, "@");
}

function decodeId(s) {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

/**
 * parseRoute("#/repo/reggie/area/src/components?lens=heat") →
 *   { level: "area", repo: "reggie", id: "src/components", query: { lens: "heat" } }
 * Unknown hashes parse as { level: "home" } so the boot redirect can decide.
 */
export function parseRoute(hash) {
  let raw = String(hash ?? "");
  if (raw.startsWith("#")) raw = raw.slice(1);
  const qIndex = raw.indexOf("?");
  const pathPart = qIndex >= 0 ? raw.slice(0, qIndex) : raw;
  const queryPart = qIndex >= 0 ? raw.slice(qIndex + 1) : "";
  const query = {};
  for (const [k, v] of new URLSearchParams(queryPart)) query[k] = v;

  const segs = pathPart.split("/").filter((s) => s.length > 0);
  const route = { level: "home", repo: null, id: null, query, hash: `#${raw}` };
  if (segs.length === 0) return route;
  if (segs[0] === "ws") return { ...route, level: "workspace" };
  if (segs[0] !== "repo" || segs.length < 2) return route;
  route.repo = decodeId(segs[1]);
  route.level = "repo";
  if (segs.length === 2) return route;
  const kind = segs[2];
  const rest = decodeId(segs.slice(3).join("/"));
  switch (kind) {
    case "area":
      return { ...route, level: "area", id: rest.replace(/\/+$/, "") };
    case "file":
      return { ...route, level: "file", id: rest };
    case "symbol":
      return { ...route, level: "symbol", id: rest };
    case "tasks":
      return { ...route, level: "tasks" };
    case "task":
      return { ...route, level: "task", id: rest };
    case "people":
      return { ...route, level: "people" };
    case "person":
      return { ...route, level: "person", id: rest };
    case "time":
      return { ...route, level: "time" };
    default:
      return route;
  }
}

/** formatRoute({level, repo, id, query}) → "#/repo/reggie/area/src/components?lens=heat" */
export function formatRoute(route) {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(route.query ?? {})) {
    if (v === null || v === undefined || v === "" || v === false) continue;
    q.set(k, String(v));
  }
  const qs = q.toString();
  let path;
  switch (route.level) {
    case "workspace":
      path = "/ws";
      break;
    case "repo":
      path = `/repo/${encodeId(route.repo)}`;
      break;
    case "area":
      path = `/repo/${encodeId(route.repo)}/area/${encodeId(route.id)}`;
      break;
    case "file":
      path = `/repo/${encodeId(route.repo)}/file/${encodeId(route.id)}`;
      break;
    case "symbol":
      path = `/repo/${encodeId(route.repo)}/symbol/${encodeId(route.id)}`;
      break;
    case "tasks":
      path = `/repo/${encodeId(route.repo)}/tasks`;
      break;
    case "task":
      path = `/repo/${encodeId(route.repo)}/task/${encodeId(route.id)}`;
      break;
    case "people":
      path = `/repo/${encodeId(route.repo)}/people`;
      break;
    case "person":
      path = `/repo/${encodeId(route.repo)}/person/${encodeId(route.id)}`;
      break;
    case "time":
      path = `/repo/${encodeId(route.repo)}/time`;
      break;
    default:
      path = "/";
  }
  return `#${path}${qs ? `?${qs}` : ""}`;
}

/** Route for an entity by graph node id (spec §2 id scheme). */
export function routeForNode(repo, nodeId, query) {
  const id = String(nodeId);
  const base = { repo, query: query ?? {} };
  if (id.startsWith("repo:")) return formatRoute({ ...base, level: "repo", repo: id.slice(5) });
  if (id === "dir:./" || id === "dir:.") return formatRoute({ ...base, level: "repo" });
  if (id.startsWith("dir:")) return formatRoute({ ...base, level: "area", id: id.slice(4).replace(/\/+$/, "") });
  if (id.startsWith("task:")) return formatRoute({ ...base, level: "task", id: id.slice(5) });
  if (id.startsWith("person:")) return formatRoute({ ...base, level: "person", id: id.slice(7) });
  if (id.startsWith("sym:")) return formatRoute({ ...base, level: "symbol", id: id.slice(4) });
  if (id.startsWith("ghost:")) return routeForNode(repo, id.replace(/^ghost:(up|down):/, ""), query);
  if (id.startsWith("fold:") || id.startsWith("entity:")) return formatRoute({ ...base, level: "repo" });
  return formatRoute({ ...base, level: "file", id });
}

export function currentRoute() {
  return parseRoute(location.hash);
}

/**
 * navigate(routeOrHash, { replace }) — pushState for level changes, replaceState for query-only changes.
 * Passing a string hash is accepted. Returns the hash used.
 */
export function navigate(target, opts = {}) {
  const hash = typeof target === "string" ? (target.startsWith("#") ? target : `#${target}`) : formatRoute(target);
  if (hash === location.hash) {
    if (opts.force) render(parseRoute(hash));
    return hash;
  }
  if (opts.replace) {
    history.replaceState(null, "", hash);
    render(parseRoute(hash));
  } else {
    location.hash = hash; // fires hashchange → render
  }
  return hash;
}

/** Update one or more query keys on the current route without leaving the level (replaceState). */
export function setQuery(patch) {
  const route = currentRoute();
  const query = { ...route.query };
  for (const [k, v] of Object.entries(patch)) {
    if (v === null || v === undefined || v === "" || v === false) delete query[k];
    else query[k] = String(v);
  }
  navigate({ ...route, query }, { replace: true });
}

/** The parent crumb route for Backspace. */
export function parentRoute(route) {
  switch (route.level) {
    case "area": {
      const parts = route.id.split("/").filter(Boolean);
      if (parts.length > 1) return { level: "area", repo: route.repo, id: parts.slice(0, -1).join("/"), query: {} };
      return { level: "repo", repo: route.repo, query: {} };
    }
    case "file": {
      const parts = route.id.split("/").filter(Boolean);
      if (parts.length > 1) return { level: "area", repo: route.repo, id: parts.slice(0, -1).join("/"), query: {} };
      return { level: "repo", repo: route.repo, query: {} };
    }
    case "symbol":
      return { level: "file", repo: route.repo, id: route.id.split("::")[0], query: {} };
    case "task":
      return { level: "tasks", repo: route.repo, query: {} };
    case "person":
      return { level: "people", repo: route.repo, query: {} };
    case "repo":
      return state.facts?.workspace ? { level: "workspace", query: {} } : null;
    case "workspace":
      return null;
    default:
      return { level: "repo", repo: route.repo, query: {} };
  }
}

// ---------------------------------------------------------------------------
// Fetch cache and error cards
// ---------------------------------------------------------------------------

const cache = new Map(); // url → { at, promise }

/** GET JSON with a 10 s in-memory cache keyed by URL. Throws Error(message) on non-2xx or network failure. */
export function api(url, opts = {}) {
  const now = Date.now();
  const hit = cache.get(url);
  if (!opts.fresh && hit && now - hit.at < CACHE_TTL_MS) return hit.promise;
  const promise = fetch(url, { credentials: "same-origin" })
    .then(async (res) => {
      let body = null;
      try {
        body = await res.json();
      } catch {
        body = null;
      }
      if (!res.ok) {
        const err = new Error(body?.error ?? `${res.status} ${res.statusText}`);
        err.status = res.status;
        err.url = url;
        throw err;
      }
      return body;
    })
    .catch((err) => {
      cache.delete(url);
      throw err;
    });
  cache.set(url, { at: now, promise });
  return promise;
}

export function invalidate(prefix) {
  for (const key of Array.from(cache.keys())) if (!prefix || key.startsWith(prefix)) cache.delete(key);
}

/** Add ?repo= when the app serves a workspace. */
export function withRepo(url, repo) {
  const r = repo ?? state.route?.repo;
  if (!r || !state.facts?.workspace) return url;
  return `${url}${url.includes("?") ? "&" : "?"}repo=${encodeURIComponent(r)}`;
}

/** Inline error card: "`/api/story` failed: <message>" + Retry. */
export function errorCard(endpoint, message, retry) {
  return h(
    "div",
    { class: "card card--error", role: "alert" },
    h("div", { class: "card__head" }, h("code", {}, endpoint), " failed: ", h("span", {}, String(message))),
    retry ? h("div", { class: "card__actions" }, h("button", { class: "btn btn--small", type: "button", on: { click: retry } }, "Retry")) : null,
  );
}

// ---------------------------------------------------------------------------
// Links, chips, link markup
// ---------------------------------------------------------------------------

/** The one link helper (spec §1.2): kind glyph + label, href = hash route. */
export function entityLink(kind, route, label, opts = {}) {
  const k = ICON_KIND[kind] ?? kind ?? "file";
  const a = h("a", { class: `link link--${k}`, href: route.startsWith("#") ? route : `#${route}`, title: opts.title ?? null }, icon(k), h("span", {}, label ?? route));
  if (opts.refs) a.dataset.refs = Array.isArray(opts.refs) ? opts.refs.join(" ") : String(opts.refs);
  return a;
}

const ICON_KIND = {
  repo: "repo",
  dir: "area",
  area: "area",
  file: "file",
  symbol: "symbol",
  sym: "symbol",
  task: "task",
  person: "person",
  note: "note",
  entity: "note",
  journal: "journal",
  entry: "entry",
  test: "test",
  fold: "area",
  ghost: "area",
};

/** Guess the entity kind from a hash route (used by [[route|label]] markup without an explicit kind). */
export function kindForRoute(route) {
  const r = String(route);
  if (/^#?\/ws$/.test(r)) return "repo";
  if (/^#?\/repo\/[^/]+\/area\//.test(r)) return "area";
  if (/^#?\/repo\/[^/]+\/file\//.test(r)) return "file";
  if (/^#?\/repo\/[^/]+\/symbol\//.test(r)) return "symbol";
  if (/^#?\/repo\/[^/]+\/task(s)?(\/|$)/.test(r)) return "task";
  if (/^#?\/repo\/[^/]+\/pe(ople|rson)/.test(r)) return "person";
  if (/^#?\/repo\/[^/]+\/time/.test(r)) return "journal";
  if (/^#?\/repo\/[^/]+$/.test(r)) return "repo";
  return "file";
}

/**
 * Render "plain text with [[route|label]] links" into a DocumentFragment. Kinds come from the route shape.
 * `[[route|label|kind]]` overrides the kind. Text outside the markup is escaped by construction.
 */
export function linkify(text, opts = {}) {
  const frag = document.createDocumentFragment();
  const re = /\[\[([^\]|]+)\|([^\]|]*)(?:\|([a-z-]+))?\]\]/g;
  const s = String(text ?? "");
  let last = 0;
  for (const m of s.matchAll(re)) {
    if (m.index > last) frag.appendChild(document.createTextNode(s.slice(last, m.index)));
    const route = m[1].trim();
    const label = m[2] || route;
    const kind = m[3] || kindForRoute(route);
    frag.appendChild(entityLink(kind, route, label, opts.linkOpts ?? {}));
    last = m.index + m[0].length;
  }
  if (last < s.length) frag.appendChild(document.createTextNode(s.slice(last)));
  return frag;
}

/** Labelled chip "Type: how" with a glossary tooltip (spec §5.2). */
export function chip(label, value, opts = {}) {
  const key = String(value ?? "").toLowerCase();
  // A caller-supplied tip that only repeats the chip's own text is not a tooltip: fall through to the
  // glossary, and to the first word of the value ("Claude via jacobpress" -> claude) after that (F16).
  const echo = label ? `${label}: ${value}` : String(value);
  const supplied = opts.tip && opts.tip !== echo ? opts.tip : null;
  const first = key.split(/[^a-z0-9-]+/).filter(Boolean)[0] ?? "";
  const tip = supplied ?? GLOSSARY[key] ?? (first.length >= 3 ? GLOSSARY[first] : null) ?? echo;
  const cls = ["chip", opts.tone ? `chip--${opts.tone}` : null, opts.code ? "chip--code" : null, opts.class ?? null].filter(Boolean).join(" ");
  return h("span", { class: cls, title: tip }, label ? h("span", { class: "chip__k" }, `${label}: `) : null, h("span", { class: "chip__v" }, String(value)));
}

/** Chip from a Paragraph.chips entry { label, value, tone?, tip? }. */
export function chipFrom(c) {
  return chip(c.label, c.value, { tone: c.tone, tip: c.tip });
}

/** Task-state chip with the state colour. */
export function stateChip(stateId, label) {
  return h("span", { class: `chip chip--state state--${stateId}`, title: GLOSSARY[stateId] ?? stateId }, label ?? STATE_LABELS[stateId] ?? stateId);
}

export const STATE_LABELS = {
  ungroomed: "Ungroomed",
  grooming: "Grooming",
  groomed: "Groomed",
  "in-process": "In process",
  "awaiting-decision": "Awaiting decision",
  done: "Done",
};

// ---------------------------------------------------------------------------
// Toasts
// ---------------------------------------------------------------------------

/** toast("Captured as `slug`", { tone: "ok"|"warn"|"bad"|"info", ms }) — backticks render as <code>. */
export function toast(text, opts = {}) {
  const region = $("toasts");
  if (!region) return null;
  const el = h("div", { class: `toast toast--${opts.tone ?? "info"}`, role: "status" });
  const parts = String(text).split(/`([^`]*)`/g);
  parts.forEach((p, i) => {
    if (i % 2 === 1) el.appendChild(h("code", {}, p));
    else if (p) el.appendChild(document.createTextNode(p));
  });
  region.appendChild(el);
  const ms = opts.ms ?? 4000;
  const remove = () => el.remove();
  const timer = setTimeout(remove, ms);
  el.addEventListener("click", () => {
    clearTimeout(timer);
    remove();
  });
  return el;
}

// ---------------------------------------------------------------------------
// POST helpers (same-origin; spec §8)
// ---------------------------------------------------------------------------

export async function post(url, body) {
  const res = await fetch(url, {
    method: "POST",
    mode: "same-origin",
    credentials: "same-origin",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify(body ?? {}),
  });
  let data = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }
  if (!res.ok) {
    const err = new Error(data?.error ?? `${res.status} ${res.statusText}`);
    err.status = res.status;
    throw err;
  }
  invalidate("/api/");
  return data;
}

export const postCapture = (body) => post(withRepo("/api/capture"), body); // { text, detail?, slug? } → { slug, line }
export const postNote = (body) => post(withRepo("/api/note"), body); // { entity, type, text, confidence?, sources? }
export const postDecide = (body) => post(withRepo("/api/decide"), body); // { slug, verdict, comment? }
export const postJournal = (body) => post(withRepo("/api/journal"), body); // { text, slug?, stage?, evidence? }

// ---------------------------------------------------------------------------
// Shell state
// ---------------------------------------------------------------------------

export const state = {
  route: null,
  facts: null,
  story: null,
  lens: "structure",
  dense: false,
  rendererOk: false,
  map: null, // set by the integrator: createMap(container)
  reader: null,
  renderToken: 0,
};

/** Simple event bus for cross-module wiring (e.g. "route", "lens", "dense"). */
const listeners = new Map();
export function on(event, fn) {
  if (!listeners.has(event)) listeners.set(event, new Set());
  listeners.get(event).add(fn);
  return () => listeners.get(event)?.delete(fn);
}
export function emit(event, payload) {
  for (const fn of listeners.get(event) ?? []) {
    try {
      fn(payload);
    } catch (err) {
      console.error(err);
    }
  }
}

// ---------------------------------------------------------------------------
// Breadcrumb
// ---------------------------------------------------------------------------

/** Render crumbs [{label, route}] into #crumbs. The last crumb is the page title. */
export function renderCrumbs(crumbs) {
  const nav = $("crumbs");
  if (!nav) return;
  const items = [];
  const list = Array.isArray(crumbs) && crumbs.length > 0 ? crumbs : [{ label: "Reggie", route: "#/" }];
  list.forEach((c, i) => {
    const last = i === list.length - 1;
    if (i > 0) items.push(h("span", { class: "crumbs__sep", "aria-hidden": "true" }, "›"));
    const isWs = c.route === "#/ws" || c.route === "/ws";
    if (last) {
      items.push(h("span", { class: "crumbs__last", title: c.title ?? null, "aria-current": "page" }, c.label));
    } else if (isWs && !state.facts?.workspace) {
      items.push(h("span", { class: "crumbs__item is-muted", title: "Start `reggie serve --workspace <dir>` to see sibling repos" }, c.label));
    } else {
      items.push(h("a", { class: "crumbs__item", href: c.route.startsWith("#") ? c.route : `#${c.route}`, title: c.title ?? null }, c.label));
    }
  });
  mount(nav, items);
  renderMiniCrumbs(list);
}

/** The stacked breakpoint hides the header crumbs behind the map: repeat the tail above the canvas. */
function renderMiniCrumbs(list) {
  const el = $("mini-crumbs");
  if (!el) return;
  // It is a *tail*, and only worth a row when there is a tail to show. On the board and at the repo
  // level the whole trail is two crumbs, so it printed the header breadcrumb again one row lower
  // (F12). `:empty` hides the strip.
  if (GRAPHLESS_LEVELS.has(currentRoute().level ?? "") || list.length <= 2) {
    mount(el, []);
    return;
  }
  const tail = list.slice(-2);
  const items = [];
  tail.forEach((c, i) => {
    const last = i === tail.length - 1;
    if (i > 0) items.push(h("span", { class: "crumbs__sep", "aria-hidden": "true" }, "›"));
    if (last) items.push(h("span", { class: "crumbs__last" }, c.label));
    else items.push(h("a", { href: c.route?.startsWith("#") ? c.route : `#${c.route ?? "/"}` }, c.label));
  });
  mount(el, items);
}

/** Fallback crumbs derived from the route when the story payload is not available. */
export function crumbsFor(route) {
  const repo = route.repo ?? state.facts?.facts?.name ?? "repo";
  const out = [{ label: "Workspace", route: "#/ws" }];
  if (route.level === "workspace") return [{ label: state.facts?.workspace?.name ?? "Workspace", route: "#/ws" }];
  out.push({ label: repo, route: formatRoute({ level: "repo", repo, query: {} }), title: state.facts?.root ?? null });
  const segCrumbs = (id, leafLevel) => {
    const parts = String(id).split("/").filter(Boolean);
    parts.forEach((p, i) => {
      const last = i === parts.length - 1;
      const sub = parts.slice(0, i + 1).join("/");
      out.push({ label: p, route: formatRoute({ level: last ? leafLevel : "area", repo, id: sub, query: {} }) });
    });
  };
  switch (route.level) {
    case "area":
      segCrumbs(route.id, "area");
      break;
    case "file":
      segCrumbs(route.id, "file");
      break;
    case "symbol": {
      const [file, name] = String(route.id).split("::");
      segCrumbs(file, "file");
      out.push({ label: name ?? "symbol", route: formatRoute(route) });
      break;
    }
    case "tasks":
      out.push({ label: "Tasks", route: formatRoute({ level: "tasks", repo, query: {} }) });
      break;
    case "task":
      out.push({ label: "Tasks", route: formatRoute({ level: "tasks", repo, query: {} }) });
      out.push({ label: route.id, route: formatRoute(route) });
      break;
    case "people":
      out.push({ label: "People", route: formatRoute(route) });
      break;
    case "person":
      out.push({ label: "People", route: formatRoute({ level: "people", repo, query: {} }) });
      out.push({ label: route.id, route: formatRoute(route) });
      break;
    case "time":
      out.push({ label: "Timeline", route: formatRoute(route) });
      break;
    default:
      break;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Lens control and dense toggle
// ---------------------------------------------------------------------------

export function setLens(lens, opts = {}) {
  if (!LENSES.includes(lens)) return;
  state.lens = lens;
  storage.set(STORAGE.lens, lens);
  for (const btn of document.querySelectorAll("#lens .seg__btn")) {
    const active = btn.dataset.lens === lens;
    btn.classList.toggle("is-active", active);
    btn.setAttribute("aria-checked", active ? "true" : "false");
  }
  if (!opts.silent) setQuery({ lens: lens === "structure" ? null : lens });
  if (state.map && typeof state.map.setLens === "function") state.map.setLens(lens);
  emit("lens", lens);
}

export function setDense(dense, opts = {}) {
  state.dense = Boolean(dense);
  storage.set(STORAGE.dense, state.dense);
  $("app")?.classList.toggle("is-dense", state.dense);
  $("dense")?.setAttribute("aria-pressed", state.dense ? "true" : "false");
  if (!opts.silent) setQuery({ dense: state.dense ? "1" : null });
  if (state.map && typeof state.map.fit === "function") setTimeout(() => state.map.fit(), 0);
  emit("dense", state.dense);
}

function wireHeader() {
  for (const btn of document.querySelectorAll("#lens .seg__btn")) {
    btn.addEventListener("click", () => setLens(btn.dataset.lens));
  }
  $("dense")?.addEventListener("click", () => setDense(!state.dense));
  $("search-trigger")?.addEventListener("click", () => openPalette());
  $("repo-select")?.addEventListener("change", (ev) => {
    navigate({ level: "repo", repo: ev.target.value, query: {} });
  });
  $("tab-map")?.addEventListener("click", () => setQuery({ tab: null }));
}

function renderRepoSwitcher() {
  const slot = $("repo-switcher");
  const select = $("repo-select");
  if (!slot || !select) return;
  const ws = state.facts?.workspace;
  if (!ws || !Array.isArray(ws.repos) || ws.repos.length < 2) {
    slot.hidden = true;
    return;
  }
  slot.hidden = false;
  mount(select, ws.repos.map((name) => h("option", { value: name, selected: name === state.route?.repo ? true : null }, name)));
}

// ---------------------------------------------------------------------------
// Renderer check and first-load status card
// ---------------------------------------------------------------------------

export function rendererAvailable() {
  return Boolean(window.cytoscape && window.dagre && window.cytoscapeDagre);
}

export function rendererFailureCard() {
  return h(
    "div",
    { class: "card card--error card--renderer", role: "alert" },
    h("div", { class: "card__body" }, "The map library did not load. The story still works. Expected ", h("code", {}, VENDOR_EXPECTED), " (from packages/reggie/node_modules) or cdnjs."),
    h("div", { class: "card__actions" }, h("button", { class: "btn btn--small", type: "button", on: { click: () => location.reload() } }, "Retry")),
  );
}

function checkRenderer() {
  state.rendererOk = rendererAvailable();
  const col = $("map-col");
  if (!state.rendererOk && col) {
    col.classList.add("is-disabled");
    $("map-stage")?.appendChild(rendererFailureCard());
    for (const b of document.querySelectorAll("#toolbar button")) b.disabled = true;
  }
  return state.rendererOk;
}

const STATUS_STEPS = [
  ["files", "files"],
  ["imports", "imports"],
  ["notes", "notes"],
  ["history", "git history"],
  ["tasks", "tasks"],
];

/** "Reading the repo" card driven by /api/status ticks. Resolves when ready (or after a bounded wait). */
async function waitForStatus() {
  const stage = $("map-stage");
  let card = null;
  const draw = (status) => {
    const list = STATUS_STEPS.map(([key, label]) => h("li", { class: status?.steps?.[key] ? "is-done" : "" }, label));
    if (!card) {
      card = h("div", { class: "card card--status card--renderer" }, h("div", { class: "card__title" }, "Reading the repo"), h("ul", { class: "status-list" }, list));
      stage?.appendChild(card);
    } else {
      mount(card.querySelector(".status-list"), list);
    }
  };
  for (let i = 0; i < 60; i += 1) {
    let status = null;
    try {
      status = await api("/api/status", { fresh: true });
    } catch {
      status = null;
    }
    if (!status || status.ready) {
      card?.remove();
      return status;
    }
    draw(status);
    await new Promise((r) => setTimeout(r, 500));
  }
  card?.remove();
  return null;
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

const LEVEL_NAMES = {
  workspace: "Workspace",
  repo: "Repo",
  area: "Area",
  file: "File",
  symbol: "Symbol",
  tasks: "Task board",
  task: "Task",
  people: "People",
  person: "Person",
  time: "Timeline",
};

/** Story scope and id for /api/story per route. */
export function storyParams(route) {
  const q = new URLSearchParams();
  const lens = route.query?.lens ?? state.lens;
  switch (route.level) {
    case "workspace":
      q.set("scope", "workspace");
      break;
    case "repo":
      q.set("scope", "repo");
      break;
    case "area":
      q.set("scope", "area");
      q.set("id", route.id);
      break;
    case "file":
    case "symbol":
      q.set("scope", "file");
      q.set("id", route.level === "symbol" ? route.id.split("::")[0] : route.id);
      break;
    case "task":
      q.set("scope", "task");
      q.set("id", route.id);
      break;
    default:
      return null;
  }
  if (lens && lens !== "structure") q.set("lens", lens);
  if (route.query?.days) q.set("days", route.query.days);
  return q.toString();
}

/** Skeleton block (three bars) — story.js exports the full renderSkeleton with headings. */
export function skeleton() {
  return h("div", { class: "skeleton", "aria-hidden": "true" }, h("div", { class: "skeleton__bar" }), h("div", { class: "skeleton__bar" }), h("div", { class: "skeleton__bar" }));
}

/** Section wrapper used by every level: <section class="section" id="sec-<id>"><h2 class="section__h">…</h2>…</section> */
export function section(id, heading, ...children) {
  return h("section", { class: "section", id: `sec-${id}`, dataset: { section: id } }, h("h2", { class: "section__h" }, heading), ...children);
}

/**
 * render(route): the router target. Applies query state (lens, dense), fetches facts once,
 * then hands off to renderLevel(). The integrator replaces renderLevel's body with the real wiring.
 */
export async function render(route) {
  const token = (state.renderToken += 1);
  state.route = route;

  // Query-driven state: lens and dense (query wins, then localStorage).
  const lens = LENSES.includes(route.query?.lens) ? route.query.lens : storage.get(STORAGE.lens, "structure");
  if (lens !== state.lens) setLens(lens, { silent: true });
  else setLens(state.lens, { silent: true });
  const dense = route.query?.dense === "1" ? true : route.query?.dense === "0" ? false : Boolean(storage.get(STORAGE.dense, false));
  if (dense !== state.dense) setDense(dense, { silent: true });

  if (!state.facts) {
    try {
      state.facts = await api("/api/facts");
    } catch (err) {
      mount($("sections"), errorCard("/api/facts", err.message, () => render(route)));
      return;
    }
    if (token !== state.renderToken) return;
  }

  // Home redirect (spec §2): single-repo → #/repo/<name>; workspace → #/ws.
  if (route.level === "home") {
    const target = state.facts.workspace ? { level: "workspace", query: {} } : { level: "repo", repo: state.facts.facts?.name ?? "repo", query: {} };
    navigate({ ...target, query: route.query ?? {} }, { replace: true });
    return;
  }
  if (route.level === "repo" && !route.repo) {
    navigate({ level: "repo", repo: state.facts.facts?.name ?? "repo", query: route.query ?? {} }, { replace: true });
    return;
  }

  renderRepoSwitcher();
  rememberRoute(route.hash);
  document.title = titleFor(route);
  emit("route", route);
  await renderLevel(route, token);
}

function titleFor(route) {
  const name = route.repo ?? state.facts?.facts?.name ?? "Reggie";
  if (route.level === "workspace") return `${state.facts?.workspace?.name ?? "Workspace"} · Reggie`;
  if (route.level === "repo") return `${name} · Reggie`;
  return `${route.id ?? LEVEL_NAMES[route.level] ?? ""} · ${name} · Reggie`;
}

/** Story scope per route level (`/api/story?scope=`); levels without a story render their own column. */
const STORY_SCOPE = { workspace: "workspace", repo: "repo", area: "area", file: "file", symbol: "file", task: "task" };

/** The file a file/symbol route points at, and the symbol name when the route names one. */
function fileOf(route) {
  return route.level === "symbol" ? String(route.id ?? "").split("::")[0] : String(route.id ?? "");
}
function symbolOf(route) {
  if (route.level !== "symbol") return null;
  const parts = String(route.id ?? "").split("::");
  return parts.length > 1 ? parts.slice(1).join("::") : null;
}

// ---------------------------------------------------------------------------
// The map and the reader (created once, kept for the life of the page)
// ---------------------------------------------------------------------------

/** createMap on #cy the first time a level needs it; a renderer-less page gets map.js's no-op stub. */
export function ensureMap() {
  if (state.map) return state.map;
  const container = $("cy");
  if (!container) return null;
  const map = createMap(container, { stage: $("map-stage"), repo: currentRoute().repo ?? "repo" });
  state.map = map;
  if (map.available) wireMapEvents(map);
  return map;
}

/** createReader on #reader; the drawer stays hidden until something opens it. */
export function ensureReader() {
  if (state.reader) return state.reader;
  const container = $("reader");
  if (!container) return null;
  state.reader = createReader(container, {
    fetchJson: (url) => api(url),
    onNoteRequest: (prefill) => {
      if (!focusNoteForm(prefill)) toast("There is no note form on this page.", { tone: "warn" });
    },
    editorScheme: state.facts?.editorScheme ?? "vscode://file",
    root: state.facts?.root ?? null,
    withRepo: (url) => withRepo(url),
  });
  return state.reader;
}

function wireMapEvents(map) {
  map.on("tap", (id, nd) => onNodeTap(id, nd));
  map.on("dbltap", (id, nd) => onNodeOpen(id, nd));
  map.on("edgeTap", (edge) => pinEdgeSpotlight(edge));
  map.on("depth", (n) => {
    if (state.route?.level === "task") return; // board.js owns the blast-radius depth
    setQuery({ depth: Number(n) === 1 ? null : String(n) });
  });
  map.on("direction", (dir) => {
    if (state.route?.level === "task") return;
    setQuery({ dir: dir === "both" ? null : dir });
  });
}

/** Single tap: ghosts and folds move, everything else pins a Spotlight (spec §2, §3.3). */
function onNodeTap(id, nd) {
  const route = state.route;
  if (!route) return;
  const sid = String(id);
  if (sid.startsWith("ghost:")) return onNodeOpen(sid, nd);
  if (nd?.kind === "fold" || sid.startsWith("fold:")) {
    if (route.level === "area") return setQuery({ all: "1" });
    toast(`${nd?.foldCount ?? "Several"} files are folded into this node; raise the depth or open the area to see them.`, { tone: "info" });
    return;
  }
  state.map?.select?.(sid);
  pinSpotlight(sid);
  return undefined;
}

/** Double tap (and single tap on a ghost): go to the node's own level. */
function onNodeOpen(id, nd) {
  const route = state.route;
  if (!route) return;
  const sid = String(id);
  if (nd?.kind === "fold" || sid.startsWith("fold:")) return onNodeTap(sid, nd);
  const repo = sid.startsWith("repo:") ? sid.slice(5) : route.repo;
  const target = routeForNode(repo, sid);
  if (target && target !== location.hash) navigate(target);
  return undefined;
}

function spotlightDeps(route) {
  return {
    map: state.map,
    repo: route?.repo ?? null,
    reader: state.reader,
    route,
    onAddNote: () => {
      if (!focusNoteForm()) toast("Open a file or an area to add a note there.", { tone: "warn" });
    },
  };
}

/** GET /api/explain?id= and pin the four-sentence card above the story. */
async function pinSpotlight(id) {
  const route = state.route;
  const token = state.renderToken;
  try {
    const explain = await api(withRepo(`/api/explain?id=${encodeURIComponent(id)}`));
    if (token !== state.renderToken) return;
    renderSpotlight($("spotlight"), explain, spotlightDeps(route));
  } catch (err) {
    if (err.status === 404) return;
    toast(`\`/api/explain\` failed: ${err.message}`, { tone: "warn" });
  }
}

/** Edge tap: the aggregated sentence plus the top 5 file pairs behind it, each a link (spec §2 Level 1). */
function pinEdgeSpotlight(edge) {
  const route = state.route;
  if (!route || !edge) return;
  const model = state.map?.getModel?.() ?? null;
  const nameOf = (nid) => model?.nodeById?.get(nid)?.fullLabel ?? String(nid).replace(/^dir:/, "").replace(/\/$/, "");
  const src = nameOf(edge.source);
  const tgt = nameOf(edge.target);
  const via = Array.isArray(edge.via) ? edge.via.slice(0, 5) : [];
  const card = renderSpotlight(
    $("spotlight"),
    {
      id: String(edge.id ?? `${edge.source}->${edge.target}`),
      kind: "area",
      title: `${src} → ${tgt}`,
      crumbs: [],
      route: null,
      sentences: [{ text: edge.sentence ?? `${src} reaches ${tgt}.`, refs: [edge.source, edge.target] }],
      actions: [],
    },
    spotlightDeps(route),
  );
  const body = card?.querySelector(".spot__body");
  if (!body) return;
  if (via.length) {
    body.appendChild(h("p", { class: "spot__sentence muted" }, via.length === 1 ? "The file pair behind it:" : `The top ${via.length} file pairs behind it:`));
    body.appendChild(
      h(
        "ul",
        { class: "spot__via" },
        via.map((v) =>
          h(
            "li",
            { "data-refs": `${v.source} ${v.target}` },
            entityLink("file", routeForNode(route.repo, v.source), v.source, { refs: v.source }),
            " → ",
            entityLink("file", routeForNode(route.repo, v.target), v.target, { refs: v.target }),
            v.names?.length ? h("span", { class: "faint" }, ` (${v.names.slice(0, 6).join(", ")})`) : null,
          ),
        ),
      ),
    );
  } else if (edge.names?.length) {
    body.appendChild(h("p", { class: "spot__sentence muted" }, `Names carried: ${edge.names.slice(0, 12).join(", ")}`));
  }
}

// ---------------------------------------------------------------------------
// Per-level data
// ---------------------------------------------------------------------------

/** The map endpoint for a route, or null when the level draws no graph. */
export function mapUrlFor(route) {
  const q = route.query ?? {};
  const tests = q.tests === "1" ? "1" : "0";
  switch (route.level) {
    case "workspace":
      return "/api/workspace";
    case "repo":
      return withRepo("/api/graph?level=container");
    case "area":
      return withRepo(`/api/graph?level=dir&root=${encodeURIComponent(route.id)}&tests=${tests}&all=${q.all === "1" ? "1" : "0"}`);
    case "file":
    case "symbol": {
      const depth = ["1", "2", "3"].includes(String(q.depth)) ? String(q.depth) : "1";
      const dir = ["up", "down", "both"].includes(String(q.dir)) ? String(q.dir) : "both";
      return withRepo(`/api/impact?id=${encodeURIComponent(fileOf(route))}&depth=${depth}&direction=${dir}&tests=${tests}`);
    }
    default:
      return null;
  }
}

function showOptsFor(route) {
  const q = route.query ?? {};
  return {
    level: route.level === "repo" ? "container" : route.level === "area" ? "dir" : route.level === "workspace" ? "workspace" : "impact",
    lens: state.lens,
    repo: route.repo ?? "repo",
    tests: q.tests === "1",
    depth: ["1", "2", "3"].includes(String(q.depth)) ? Number(q.depth) : 1,
    direction: ["up", "down", "both"].includes(String(q.dir)) ? String(q.dir) : "both",
  };
}

function storyDeps(route) {
  return {
    map: state.map,
    reader: state.reader,
    repo: route.repo,
    route,
    onDecide: () => afterWrite(),
    onCapture: () => afterWrite(),
    onNote: () => invalidate("/api/"),
    onJournal: () => invalidate("/api/"),
    onWiden: (days) => setQuery({ days: String(days) }),
  };
}

/** A POST landed: drop the cache so the next read sees it, and redraw this level. */
function afterWrite() {
  invalidate("/api/");
  const route = currentRoute();
  render(route);
}

// ---------------------------------------------------------------------------
// Level rendering
// ---------------------------------------------------------------------------

/**
 * renderLevel(route, token): breadcrumb + skeleton first, then the story and the map for this level.
 * `token` guards against a slower fetch from a route the user already left.
 */
async function renderLevel(route, token) {
  const sections = $("sections");
  const stage = $("map-stage");
  const scope = STORY_SCOPE[route.level] ?? null;

  // Leaving a level: unpin the Spotlight, put the canvas back, close the reader, drop workspace tiles.
  closeSpotlight({ immediate: true });
  if (route.level !== "tasks" && route.level !== "task") unmountBoard(stage);
  if (route.level !== "file" && route.level !== "symbol") state.reader?.close?.();
  if (route.level !== "workspace") $("map-col")?.querySelector(".ws-tiles")?.remove();
  syncTestsButton(route);
  syncGraphChrome(route);

  // The board is the payload on /tasks and wants the wider column (F08).
  const main = $("main");
  if (main) main.dataset.level = route.level ?? "";
  renderCrumbs(crumbsFor(route));
  if (scope) renderSkeleton(sections, sectionHeadingsFor(scope, state.lens));
  else mount(sections, section("loading", LEVEL_NAMES[route.level] ?? "Loading", skeleton()));

  switch (route.level) {
    case "tasks":
      return renderTasksLevel(route, token);
    case "task":
      return renderTaskLevel(route, token);
    case "people":
    case "person":
    case "time":
      return renderStretchLevel(route);
    default:
      return renderGraphLevel(route, token, scope);
  }
}

/**
 * The lens control and the Map / Treemap tabs steer a Cytoscape view. On the board and the people
 * levels there is no Cytoscape view, so they sat there live and controlled nothing (F12). They are
 * hidden on exactly the levels `mapUrlFor` draws no graph for, the same way the tests toggle is.
 */
const GRAPHLESS_LEVELS = new Set(["tasks", "people", "person", "time"]);
function syncGraphChrome(route) {
  const graphless = GRAPHLESS_LEVELS.has(route.level ?? "");
  const lens = $("lens");
  if (lens) lens.hidden = graphless;
  const tabs = $("map-tabs");
  if (tabs) tabs.hidden = graphless;
}

function syncTestsButton(route) {
  const btn = $("tb-tests");
  if (!btn) return;
  const on = route.query?.tests === "1";
  btn.setAttribute("aria-pressed", on ? "true" : "false");
  btn.hidden = !(route.level === "area" || route.level === "file" || route.level === "symbol");
}

/** Workspace, repo, area, file and symbol: story column + Cytoscape map, fetched together. */
async function renderGraphLevel(route, token, scope) {
  const sections = $("sections");
  const mapCol = $("map-col");
  const map = ensureMap();
  ensureReader();

  const params = scope ? storyParams(route) : null;
  const storyUrl = params ? withRepo(`/api/story?${params}`) : null;
  const mapUrl = state.rendererOk ? mapUrlFor(route) : null;
  if (mapUrl) mapCol?.classList.add("is-loading");

  const wrap = (p) => p.then((value) => ({ value }), (error) => ({ error }));
  const [story, view] = await Promise.all([
    storyUrl ? wrap(api(storyUrl)) : Promise.resolve({ value: null }),
    mapUrl ? wrap(api(mapUrl)) : Promise.resolve({ value: null }),
  ]);
  if (token !== state.renderToken) return;

  // --- story ------------------------------------------------------------------
  if (story.error) {
    state.story = null;
    mount(sections, errorCard("/api/story", story.error.message, () => render(route)));
  } else if (story.value) {
    state.story = story.value;
    renderCrumbs(story.value.crumbs?.length ? story.value.crumbs : crumbsFor(route));
    renderStory(sections, story.value, storyDeps(route));
    if (route.level === "file" || route.level === "symbol") addReaderButton(route);
  }

  // --- map --------------------------------------------------------------------
  // Entry markers (§2 Level 1): the map has no entry data of its own, so give it the same file list
  // the story's "Where it starts" section names (F15).
  if (view.value && story.value) view.value.entries = entryPathsFrom(story.value);
  mapCol?.classList.remove("is-loading");
  if (!state.rendererOk) {
    $("map-footer").textContent = "map unavailable";
  } else if (view.error) {
    toast(`\`${mapUrl.split("?")[0]}\` failed: ${view.error.message}`, { tone: "bad" });
    $("map-footer").textContent = "the map payload failed; the story is unaffected";
  } else if (view.value && map) {
    try {
      map.show(view.value, showOptsFor(route));
    } catch (err) {
      console.error("map.show failed", err);
      toast("The map could not draw this level; the story is unaffected.", { tone: "warn" });
    }
    if (route.level === "workspace") renderWorkspaceTiles(view.value, route);
  }

  // --- level extras -------------------------------------------------------------
  if (route.level === "file" || route.level === "symbol") {
    pinSpotlight(fileOf(route)); // spec §2 Level 3: the Spotlight is pinned automatically
    const name = symbolOf(route);
    if (name) openReader(route, { highlight: name });
  }
  return undefined;
}

/** File paths named by the story's "Where it starts" section, in the order it names them. */
function entryPathsFrom(story) {
  const sec = (story?.sections ?? []).find((x) => x.id === "starts");
  if (!sec) return [];
  const out = [];
  for (const p of sec.paragraphs ?? []) {
    for (const ref of p.refs ?? []) {
      if (typeof ref !== "string" || /^(dir|repo|task|person|note|journal):/.test(ref)) continue;
      if (!/\.[a-z0-9]+$/i.test(ref) || out.includes(ref)) continue;
      out.push(ref);
    }
  }
  return out;
}

/** "Read the source" (spec §2 Level 3) above the file story. */
function addReaderButton(route) {
  const sections = $("sections");
  if (!sections || sections.querySelector(".story__actions")) return;
  const path = fileOf(route);
  const btn = h(
    "button",
    { class: "btn btn--primary", type: "button", title: `Open ${path} in the reader drawer`, on: { click: () => openReader(route) } },
    icon("file"),
    h("span", {}, "Read the source"),
  );
  sections.prepend(h("div", { class: "card__actions story__actions" }, btn));
}

function openReader(route, opts = {}) {
  const reader = ensureReader();
  if (!reader) return;
  reader.open(fileOf(route), opts);
}

/** Level 0 tile strip: five task-state counts and a coverage bar per repo (spec §2 Level 0). */
function renderWorkspaceTiles(ws, route) {
  const col = $("map-col");
  if (!col || !ws?.repos?.length) return;
  let strip = col.querySelector(".ws-tiles");
  if (!strip) {
    strip = h("div", { class: "ws-tiles", "aria-label": "Repos" });
    col.insertBefore(strip, $("reader") ?? null); // below the canvas, above the reader drawer
  }
  const bar = (parts, total, cls) =>
    h(
      "div",
      { class: `ws-tile__bar ${cls}` },
      parts
        .filter((p) => p.n > 0)
        .map((p) => h("span", { class: "ws-tile__seg", style: { width: `${(p.n / Math.max(1, total)) * 100}%`, background: p.color }, title: `${p.label}: ${p.n}` })),
    );
  mount(
    strip,
    ws.repos.map((r) => {
      const counts = r.taskCounts ?? {};
      const tasks = Object.values(counts).reduce((a, b) => a + (b ?? 0), 0);
      const k = r.knowledge ?? { source: 0, noted: 0, inherited: 0, stale: 0 };
      const undocumented = Math.max(0, (k.source ?? 0) - (k.noted ?? 0) - (k.inherited ?? 0));
      const tile = h(
        "a",
        { class: "ws-tile", href: formatRoute({ level: "repo", repo: r.name, query: {} }), "data-refs": `repo:${r.name}` },
        h("div", { class: "ws-tile__name" }, icon("repo"), h("span", {}, r.name)),
        // Every fact is a labelled chip with a tooltip; "TypeScript · 224 code files" left the reader
        // to guess which half was which (§5.2).
        h(
          "div",
          { class: "ws-tile__meta chips" },
          chip("Language", r.primaryLanguage || "code", { tip: "The language most of this repo's source files are written in" }),
          chip("Code files", String(r.codeFiles ?? 0), { tip: "Source files, not counting tests or generated files" }),
        ),
        bar(
          [
            { n: counts.ungroomed ?? 0, color: "#5c6478", label: "Ungroomed" },
            { n: counts.grooming ?? 0, color: "#8b93a7", label: "Grooming" },
            { n: counts.groomed ?? 0, color: "#7dcfff", label: "Groomed" },
            { n: counts["in-process"] ?? 0, color: "#7aa2f7", label: "In process" },
            { n: counts["awaiting-decision"] ?? 0, color: "#e0af68", label: "Awaiting decision" },
            { n: counts.done ?? 0, color: "#9ece6a", label: "Done" },
          ],
          tasks,
          "ws-tile__bar--states",
        ),
        h(
          "div",
          { class: "ws-tile__meta chips" },
          chip("Tasks", tasks ? String(tasks) : "none yet", { tone: tasks ? null : "muted", tip: "Tasks on this repo's board, in every state" }),
        ),
        bar(
          [
            { n: k.noted ?? 0, color: "#9ece6a", label: "With a note" },
            { n: k.inherited ?? 0, color: "#4e6a4a", label: "Inherited note" },
            { n: undocumented, color: "#3b4252", label: "No note" },
            { n: k.stale ?? 0, color: "#f7768e", label: "Stale" },
          ],
          Math.max(1, k.source ?? 0),
          "ws-tile__bar--knowledge",
        ),
        h(
          "div",
          { class: "ws-tile__meta chips" },
          chip("Documented", `${Math.round((((k.noted ?? 0) + (k.inherited ?? 0)) / Math.max(1, k.source ?? 1)) * 100)}%`, {
            tip: "Share of source files carrying a note of their own or inherited from a folder",
          }),
        ),
      );
      tile.addEventListener("mouseenter", () => state.map?.highlight?.([`repo:${r.name}`]));
      tile.addEventListener("mouseleave", () => state.map?.clearHighlight?.());
      return tile;
    }),
  );
  void route;
}

/** #/repo/<name>/tasks — story column becomes the Needs-you queue, map column becomes the board. */
async function renderTasksLevel(route, token) {
  const wrap = (p) => p.then((value) => ({ value }), (error) => ({ error }));
  const [tasks, sm, people] = await Promise.all([
    wrap(api(withRepo("/api/tasks"), { fresh: true })),
    wrap(api(withRepo("/api/state-machine"), { fresh: true })),
    wrap(api(withRepo("/api/people"))),
  ]);
  if (token !== state.renderToken) return;
  if (tasks.error || sm.error) {
    mount($("sections"), errorCard(tasks.error ? "/api/tasks" : "/api/state-machine", (tasks.error ?? sm.error).message, () => render(route)));
    return;
  }
  renderCrumbs(crumbsFor(route));
  renderBoard(
    $("story"),
    $("map-stage"),
    { tasks: tasks.value ?? [], stateMachine: sm.value, people: people.value ?? null, mode: sm.value?.mode ?? "solo" },
    { repo: route.repo, map: ensureMap(), onDecide: () => afterWrite(), onCapture: () => invalidate("/api/") },
  );
}

/** #/repo/<name>/task/<slug> — plan, packet and journal as prose; blast radius on the map. */
async function renderTaskLevel(route, token) {
  const wrap = (p) => p.then((value) => ({ value }), (error) => ({ error }));
  const [detail, people] = await Promise.all([
    wrap(api(withRepo(`/api/task/${encodeURIComponent(route.id)}`), { fresh: true })),
    wrap(api(withRepo("/api/people"))),
  ]);
  if (token !== state.renderToken) return;
  if (detail.error) {
    mount($("sections"), errorCard(`/api/task/${route.id}`, detail.error.message, () => render(route)));
    return;
  }
  renderCrumbs(crumbsFor(route));
  const map = ensureMap();
  renderTaskPage($("story"), $("map-stage"), { ...detail.value, people: people.value ?? null }, { repo: route.repo, map, onDecide: () => afterWrite() });
}

/** People, Person and Timeline are stretch (spec §0): say so rather than 404. */
function renderStretchLevel(route) {
  const name = LEVEL_NAMES[route.level] ?? route.level;
  renderCrumbs(crumbsFor(route));
  mount(
    $("sections"),
    section(
      "stretch",
      name,
      h("p", { class: "para para--gap" }, `${name} pages are not in this release. Ownership is on every area page under "Who works here", and the journal is under "What happened recently".`),
      h("div", { class: "card__actions" }, h("a", { class: "btn btn--small", href: formatRoute({ level: "repo", repo: route.repo, query: {} }) }, "Back to the repo")),
    ),
  );
  $("map-footer").textContent = "";
}

/**
 * Symbol links inside the story scroll the reader instead of leaving the page (spec §2 Level 3:
 * Level 4 is stretch, "Core: reader scroll"). Everything else is a normal hash link.
 */
function wireStoryLinks() {
  $("sections")?.addEventListener("click", (ev) => {
    const a = ev.target?.closest?.("a[href^='#/']");
    if (!a || ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.button > 0) return;
    const target = parseRoute(a.getAttribute("href"));
    if (target.level !== "symbol") return;
    const route = state.route;
    if (!route || (route.level !== "file" && route.level !== "symbol")) return;
    const [file, ...rest] = String(target.id ?? "").split("::");
    if (file !== fileOf(route) || rest.length === 0) return;
    ev.preventDefault();
    openReader(route, { highlight: rest.join("::") });
  });
}

// ---------------------------------------------------------------------------
// Recent routes (palette empty state)
// ---------------------------------------------------------------------------

function rememberRoute(hash) {
  if (!hash || hash === "#/") return;
  const list = storage.get(STORAGE.recent, []).filter((r) => r.hash !== hash);
  list.unshift({ hash, at: Date.now() });
  storage.set(STORAGE.recent, list.slice(0, 8));
}

export function recentRoutes() {
  return storage.get(STORAGE.recent, []);
}

// ---------------------------------------------------------------------------
// Search palette (spec §3.5) — shell only; results come from /api/search
// ---------------------------------------------------------------------------

const palette = { open: false, results: [], active: -1, timer: null };

export function openPalette() {
  const el = $("palette");
  if (!el) return;
  el.hidden = false;
  palette.open = true;
  const input = $("palette-input");
  input.value = "";
  renderPaletteResults([]);
  input.focus();
}

export function closePalette() {
  const el = $("palette");
  if (!el) return;
  el.hidden = true;
  palette.open = false;
  palette.results = [];
  palette.active = -1;
}

const KIND_GROUPS = [
  ["area", "Areas"],
  ["file", "Files"],
  ["symbol", "Symbols"],
  ["task", "Tasks"],
  ["person", "People"],
  ["note", "Notes"],
  ["journal", "Journal"],
];

function renderPaletteResults(results, query = "") {
  const box = $("palette-results");
  palette.results = results;
  palette.active = results.length > 0 ? 0 : -1;
  if (!results.length) {
    if (query) {
      mount(box, h("div", { class: "palette__empty" }, `Nothing matches '${query}'. Try a basename, a slug, or a person.`));
    } else {
      const recent = recentRoutes();
      mount(
        box,
        recent.length
          ? [h("div", { class: "palette__group" }, "Recent"), ...recent.map((r, i) => paletteRow({ kind: kindForRoute(r.hash), label: r.hash.replace(/^#\//, ""), route: r.hash, snippet: "" }, i))]
          : h("div", { class: "palette__empty" }, "Type to search areas, files, symbols, tasks, people and notes."),
      );
      palette.results = recent.map((r) => ({ kind: kindForRoute(r.hash), label: r.hash, route: r.hash, id: null }));
      palette.active = recent.length ? 0 : -1;
    }
    return;
  }
  const rows = [];
  let i = 0;
  const ordered = [];
  // Groups keep their fixed order (spec §3.5) but the group holding the best match comes first, so the
  // top-scoring result is the first row and Enter opens it (acceptance 19: an exact basename wins).
  const best = (kind) => Math.max(...results.filter((r) => r.kind === kind).map((r) => r.score ?? 0), -1);
  const groups = KIND_GROUPS.slice().sort((a, b) => best(b[0]) - best(a[0]));
  for (const [kind, title] of groups) {
    const group = results.filter((r) => r.kind === kind);
    if (!group.length) continue;
    rows.push(h("div", { class: "palette__group" }, title));
    for (const r of group) {
      rows.push(paletteRow(r, i));
      ordered.push(r);
      i += 1;
    }
  }
  const rest = results.filter((r) => !KIND_GROUPS.some(([k]) => k === r.kind));
  for (const r of rest) {
    rows.push(paletteRow(r, i));
    ordered.push(r);
    i += 1;
  }
  palette.results = ordered;
  mount(box, rows);
  updatePaletteActive();
}

function paletteRow(r, index) {
  return h(
    "div",
    {
      class: "palette__row",
      role: "option",
      id: `palette-row-${index}`,
      dataset: { index: String(index) },
      "aria-selected": "false",
      on: {
        click: (ev) => choosePalette(index, ev.shiftKey),
        mousemove: () => {
          palette.active = index;
          updatePaletteActive();
        },
      },
    },
    icon(ICON_KIND[r.kind] ?? "file"),
    h("span", { class: "palette__label" }, r.label),
    r.snippet ? h("span", { class: "palette__snippet" }, r.snippet) : null,
  );
}

function updatePaletteActive() {
  document.querySelectorAll("#palette-results .palette__row").forEach((row) => {
    const active = Number(row.dataset.index) === palette.active;
    row.classList.toggle("is-active", active);
    row.setAttribute("aria-selected", active ? "true" : "false");
    if (active) row.scrollIntoView({ block: "nearest" });
  });
}

function choosePalette(index, highlight) {
  const r = palette.results[index];
  if (!r) return;
  if (highlight && state.map && r.id) {
    const resolved = typeof state.map.resolveRef === "function" ? state.map.resolveRef(r.id) : null;
    if (resolved) {
      state.map.highlight([resolved.id ?? resolved]);
      if (resolved.folded) toast(`inside \`${resolved.label ?? resolved.id}\` (folded)`, { tone: "info" });
    } else {
      toast("Not on this map", { tone: "warn" });
    }
    closePalette();
    return;
  }
  closePalette();
  if (r.route) navigate(r.route);
}

function wirePalette() {
  const input = $("palette-input");
  if (!input) return;
  $("palette-backdrop")?.addEventListener("click", closePalette);
  input.addEventListener("input", () => {
    clearTimeout(palette.timer);
    const q = input.value.trim();
    palette.timer = setTimeout(async () => {
      if (!q) return renderPaletteResults([]);
      try {
        const data = await api(withRepo(`/api/search?q=${encodeURIComponent(q)}&limit=20`));
        if (input.value.trim() !== q) return;
        renderPaletteResults(data?.results ?? [], q);
      } catch (err) {
        mount($("palette-results"), h("div", { class: "palette__empty" }, `Search is not available: ${err.message}`));
      }
    }, 120);
  });
  input.addEventListener("keydown", (ev) => {
    if (ev.key === "ArrowDown" || ev.key === "ArrowUp") {
      ev.preventDefault();
      const n = palette.results.length;
      if (!n) return;
      palette.active = (palette.active + (ev.key === "ArrowDown" ? 1 : n - 1)) % n;
      updatePaletteActive();
    } else if (ev.key === "Enter") {
      ev.preventDefault();
      choosePalette(palette.active, ev.shiftKey);
    } else if (ev.key === "Escape") {
      ev.preventDefault();
      closePalette();
    }
  });
}

// ---------------------------------------------------------------------------
// Keyboard map (spec §3.1)
// ---------------------------------------------------------------------------

function isTypingTarget(el) {
  if (!el) return false;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable;
}

/** Escape unwinds: highlights → focus history → Spotlight → palette. Modules register handlers via on("escape"). */
export function unwind() {
  if (palette.open) {
    closePalette();
    return true;
  }
  const handlers = Array.from(listeners.get("escape") ?? []);
  for (const fn of handlers) if (fn() === true) return true;
  if (state.map && typeof state.map.clearHighlight === "function") state.map.clearHighlight();
  return false;
}

function wireKeyboard() {
  document.addEventListener("keydown", (ev) => {
    const meta = ev.metaKey || ev.ctrlKey;
    if (meta && ev.key.toLowerCase() === "k") {
      ev.preventDefault();
      if (palette.open) closePalette();
      else openPalette();
      return;
    }
    if (ev.key === "Escape") {
      if (unwind()) ev.preventDefault();
      return;
    }
    if (isTypingTarget(ev.target) || meta || ev.altKey) return;
    if (ev.key === "f" || ev.key === "F") {
      state.map?.fit?.();
      $("tb-fit")?.dispatchEvent(new CustomEvent("reggie:fit"));
    } else if (ev.key === "t" || ev.key === "T") {
      $("tb-tests")?.click();
    } else if (LENS_KEYS[ev.key]) {
      setLens(LENS_KEYS[ev.key]);
    } else if (ev.key === "Backspace") {
      const up = state.route ? parentRoute(state.route) : null;
      if (up) {
        ev.preventDefault();
        navigate(up);
      }
    }
  });
  $("tb-tests")?.addEventListener("click", (ev) => {
    const btn = ev.currentTarget;
    const next = btn.getAttribute("aria-pressed") !== "true";
    btn.setAttribute("aria-pressed", next ? "true" : "false");
    setQuery({ tests: next ? "1" : null });
    emit("tests", next);
  });
  $("tb-fit")?.addEventListener("click", () => state.map?.fit?.());
  $("tb-zoom-in")?.addEventListener("click", () => state.map?.zoom?.(1.2));
  $("tb-zoom-out")?.addEventListener("click", () => state.map?.zoom?.(1 / 1.2));
  $("tb-relayout")?.addEventListener("click", () => state.map?.relayout?.());
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

let booted = false;

export async function boot() {
  if (booted || !$("app")) return;
  booted = true;
  checkRenderer();
  wireHeader();
  wirePalette();
  wireKeyboard();
  wireStoryLinks();
  const tests = currentRoute().query?.tests === "1";
  $("tb-tests")?.setAttribute("aria-pressed", tests ? "true" : "false");
  window.addEventListener("hashchange", () => render(currentRoute()));
  await waitForStatus();
  await render(currentRoute());
}

if (typeof document !== "undefined") {
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => boot());
  else boot();
}
