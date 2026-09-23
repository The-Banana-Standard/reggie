// Reggie Guidebook — app.js
// Owns: boot and renderer check, hash router, fetch cache, h() DOM helper, entityLink and GLOSSARY,
// breadcrumb, lens control, pane and section folding, keyboard map, toasts, POST helpers, search palette shell.
// Other modules import the helpers exported at the bottom; see ui/DOM-CONTRACT.md.
//
// renderLevel() below wires story.js, map.js, reader.js and board.js together per level
// (ui/DOM-CONTRACT.md §"Route → data").

import { renderStory, renderSpotlight, renderSkeleton, sectionHeadingsFor, closeSpotlight, focusNoteForm } from "./story.js";
import { createMap, SERVICE_NOUNS } from "./map.js";
import { createReader, diffUrl } from "./reader.js";
import { renderBoard, renderTaskPage, unmountBoard } from "./board.js";
import { ideaButtonFor, mountIdeaTrigger } from "./idea.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const LENSES = ["structure", "knowledge", "tests", "heat", "owners"];
export const LENS_KEYS = { 1: "structure", 2: "knowledge", 3: "tests", 4: "heat", 5: "owners" };
export const LEVELS = ["workspace", "repo", "area", "file", "symbol", "route", "concept", "tasks", "task", "services", "flows", "flow", "people", "person", "time"];
export const CACHE_TTL_MS = 10_000;
export const VENDOR_EXPECTED = "/vendor/cytoscape.min.js";
export const RENDERER_FAILURE_TEXT =
  "The map library did not load. The story still works. Expected `/vendor/cytoscape.min.js` (from packages/reggie/node_modules) or cdnjs.";

const STORAGE = {
  lens: "reggie.lens",
  recent: "reggie.recent",
  /** The open panes of a level (story, map, code); `symbol` shares the file's. */
  panes: (level) => `reggie.panes.${paneKey(level)}`,
  /** The collapsed section ids of a level in a repo. */
  sections: (repo, level) => `reggie.sections.${repo ?? "ws"}.${paneKey(level)}`,
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
  ungroomed: "Ungroomed: captured but not yet shaped — no brief.md says what it is, or the one there is still triage's unfilled scaffold.",
  groomed: "Groomed: somebody wrote into the brief — a problem, a suspected area, a size and a priority. No plan that passes the contract yet.",
  planned: "Planned: a plan that passes the contract is on the default branch. Ready to build.",
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
    case "route":
      return { ...route, level: "route", id: rest };
    case "concept":
      return { ...route, level: "concept", id: rest };
    case "tasks":
      return { ...route, level: "tasks" };
    case "services":
      return { ...route, level: "services" };
    case "flows":
      return { ...route, level: "flows" };
    case "flow":
      return { ...route, level: "flow", id: rest };
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
    case "route":
      path = `/repo/${encodeId(route.repo)}/route/${encodeId(route.id)}`;
      break;
    case "concept":
      path = `/repo/${encodeId(route.repo)}/concept/${encodeId(route.id)}`;
      break;
    case "tasks":
      path = `/repo/${encodeId(route.repo)}/tasks`;
      break;
    case "services":
      path = `/repo/${encodeId(route.repo)}/services`;
      break;
    case "flows":
      path = `/repo/${encodeId(route.repo)}/flows`;
      break;
    case "flow":
      path = `/repo/${encodeId(route.repo)}/flow/${encodeId(route.id)}`;
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
  if (id.startsWith("svc:")) return formatRoute({ ...base, level: "services", query: { ...(query ?? {}), service: id } });
  if (id.startsWith("resp:")) return formatRoute({ ...base, level: "flow", id: id.slice(5) });
  if (id.startsWith("route:")) return formatRoute({ ...base, level: "route", id });
  if (id.startsWith("concept:")) return formatRoute({ ...base, level: "concept", id });
  if (id.startsWith("sym:")) {
    const rest = id.slice(4);
    const cut = rest.lastIndexOf("#");
    // A flow step names a symbol with `#`; the symbol level addresses it with `::`.
    if (cut > 0) return formatRoute({ ...base, level: "symbol", id: `sym:${rest.slice(0, cut)}::${rest.slice(cut + 1)}` });
    return formatRoute({ ...base, level: "symbol", id });
  }
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
      return { level: "file", repo: route.repo, id: String(route.id).replace(/^sym:/, "").split("::")[0], query: {} };
    case "route":
      return { level: "flows", repo: route.repo, query: {} };
    case "concept":
      return { level: "repo", repo: route.repo, query: {} };
    case "task":
      return { level: "tasks", repo: route.repo, query: {} };
    case "flow":
      return { level: "flows", repo: route.repo, query: {} };
    case "services":
    case "flows":
      return { level: "repo", repo: route.repo, query: {} };
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

// ---------------------------------------------------------------------------
// The serve key (phones): `reggie serve --host 0.0.0.0` prints an address ending in ?key=. The
// page keeps the key in localStorage, drops it from the address bar, and sends it as a header on
// every API call. Audio elements and feed links cannot send headers, so they append it instead.
// ---------------------------------------------------------------------------

const KEY_STORAGE = "reggie:key";

export function serveKey() {
  try {
    return localStorage.getItem(KEY_STORAGE) || "";
  } catch {
    return "";
  }
}

function rememberKey(key) {
  try {
    localStorage.setItem(KEY_STORAGE, key);
  } catch {
    // A private window keeps it for this page load only.
  }
}

function adoptKeyFromUrl() {
  const params = new URLSearchParams(location.search);
  const key = params.get("key");
  if (!key) return;
  rememberKey(key);
  params.delete("key");
  const qs = params.toString();
  history.replaceState(null, "", `${location.pathname}${qs ? `?${qs}` : ""}${location.hash}`);
}

/** The key as a query parameter, for URLs the browser fetches itself (audio, the feed link). */
export function withKey(url) {
  const key = serveKey();
  if (!key) return url;
  return `${url}${url.includes("?") ? "&" : "?"}key=${encodeURIComponent(key)}`;
}

function keyHeaders(extra = {}) {
  const key = serveKey();
  return key ? { ...extra, "x-reggie-key": key } : extra;
}

/**
 * The server wants a key this page does not have: ask for it in the story column. Deferred a tick,
 * because the render that triggered the 401 is about to replace the column with its own error card;
 * the prompt lands after that and is added only when no prompt is already on the page.
 */
function showKeyPrompt(message) {
  setTimeout(() => {
    if (document.querySelector(".key-prompt")) return;
    mountKeyPrompt(message);
  }, 0);
}

function mountKeyPrompt(message) {
  const input = h("input", { class: "form__input", type: "text", autocomplete: "off", spellcheck: "false", placeholder: "Paste the key", "aria-label": "Serve key" });
  const form = h(
    "form",
    {
      class: "form form--key",
      on: {
        submit: (ev) => {
          ev.preventDefault();
          const key = input.value.trim();
          if (!key) return;
          rememberKey(key);
          location.reload();
        },
      },
    },
    input,
    h("div", { class: "form__actions" }, h("button", { class: "btn btn--primary", type: "submit" }, "Use this key")),
  );
  const card = h(
    "div",
    { class: "card card--empty empty key-prompt" },
    h("p", { class: "empty__text" }, "This server is being reached over the network and needs its key."),
    h("p", { class: "empty__hint" }, message || "It is printed by `reggie serve` on the Mac, after ?key= in the address to open, and kept in .reggie/.cache/serve-key."),
    form,
  );
  const target = $("sections");
  if (target) target.prepend(card);
  else document.body.prepend(card);
  input.focus();
}

/** GET JSON with a 10 s in-memory cache keyed by URL. Throws Error(message) on non-2xx or network failure. */
export function api(url, opts = {}) {
  const now = Date.now();
  const hit = cache.get(url);
  if (!opts.fresh && hit && now - hit.at < CACHE_TTL_MS) return hit.promise;
  const promise = fetch(url, { credentials: "same-origin", headers: keyHeaders() })
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
        if (res.status === 401) showKeyPrompt(body?.error);
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
  service: "service",
  flow: "flow",
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
  if (/^#?\/repo\/[^/]+\/services/.test(r)) return "service";
  if (/^#?\/repo\/[^/]+\/flows?(\/|$)/.test(r)) return "flow";
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
  groomed: "Groomed",
  planned: "Planned",
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
    headers: keyHeaders({ "content-type": "application/json", accept: "application/json" }),
    body: JSON.stringify(body ?? {}),
  });
  let data = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }
  if (res.status === 401) showKeyPrompt(data?.error);
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
  /** Which panes this level has and which are open; see the Panes section. */
  panes: { applies: ["story", "map"], open: ["story", "map"], remembered: [] },
  /** Section ids folded on this level, from storage. */
  collapsed: new Set(),
  rendererOk: false,
  map: null, // set by the integrator: createMap(container)
  reader: null,
  renderToken: 0,
};

/** Simple event bus for cross-module wiring (e.g. "route", "lens", "panes"). */
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
      const [file, name] = String(route.id).replace(/^sym:/, "").split("::");
      segCrumbs(file, "file");
      out.push({ label: name ?? "symbol", route: formatRoute(route) });
      break;
    }
    case "route":
      out.push({ label: "Data flow", route: formatRoute({ level: "flows", repo, query: {} }) });
      out.push({ label: String(route.id).replace(/^route:/, ""), route: formatRoute(route) });
      break;
    case "concept":
      out.push({ label: "Data concepts", route: formatRoute({ level: "repo", repo, query: {} }) });
      out.push({ label: String(route.id).replace(/^concept:/, ""), route: formatRoute(route) });
      break;
    case "tasks":
      out.push({ label: "Tasks", route: formatRoute({ level: "tasks", repo, query: {} }) });
      break;
    case "services":
      out.push({ label: "Services", route: formatRoute({ level: "services", repo, query: {} }) });
      break;
    case "flows":
      out.push({ label: "Data flow", route: formatRoute({ level: "flows", repo, query: {} }) });
      break;
    case "flow":
      out.push({ label: "Data flow", route: formatRoute({ level: "flows", repo, query: {} }) });
      out.push({ label: route.id, route: formatRoute(route) });
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
// Lens control
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

// ---------------------------------------------------------------------------
// Panes: which of story, map and code a level has, and which are open (desktop)
// ---------------------------------------------------------------------------

const PANE_ORDER = ["story", "map", "code"];

/**
 * One table says what a level has. `map: "payload"` means the column *is* the page (the board, the
 * workspace tiles) and gets its own label; every level not listed has a story and a map beside it.
 */
const PANES_BY_LEVEL = {
  workspace: { map: "payload", mapLabel: "Repos" },
  tasks: { map: "payload", mapLabel: "Board" },
  file: { map: "graph", code: true },
  symbol: { map: "graph", code: true },
  route: {},
  concept: {},
};

function paneSpec(level) {
  return PANES_BY_LEVEL[level] ?? { map: "graph" };
}

/** The panes a level has, in canonical order. */
export function panesFor(level) {
  const spec = paneSpec(level);
  return ["story", ...(spec.map ? ["map"] : []), ...(spec.code ? ["code"] : [])];
}

/** A symbol page is the file page with a highlight, so it shares the file's choices. */
function paneKey(level) {
  return level || "repo";
}

/** Above this width the panes are side by side and can be collapsed; below it everything stacks. */
const DESKTOP_QUERY = "(min-width: 1101px)";
function isDesktop() {
  return typeof matchMedia === "function" && matchMedia(DESKTOP_QUERY).matches;
}

/** The open set a level remembers, restricted to what it has; a new level opens everything but code. */
function rememberedPanes(level) {
  const applies = panesFor(level);
  const stored = storage.get(STORAGE.panes(level), null);
  let open = Array.isArray(stored) ? stored.filter((p) => applies.includes(p)) : applies.filter((p) => p !== "code");
  if (open.length === 0) open = ["story"];
  return PANE_ORDER.filter((p) => open.includes(p));
}

function rememberPanes(level, open) {
  storage.set(STORAGE.panes(level), open);
}

/** Paint state.panes onto <main> and the header toggles. Below the desktop width the attributes go. */
function applyPanes() {
  const main = $("main");
  const group = $("panes");
  if (!main) return;
  const { applies, open } = state.panes;
  if (!isDesktop()) {
    delete main.dataset.panes;
    delete main.dataset.open;
    if (group) group.hidden = true;
    return;
  }
  main.dataset.panes = applies.join(" ");
  main.dataset.open = open.join(" ");
  if (group) group.hidden = false;
  const spec = paneSpec(state.route?.level);
  const mapLabel = spec.mapLabel ?? "Map";
  for (const pane of PANE_ORDER) {
    const btn = $(`pane-${pane}`);
    if (!btn) continue;
    const applicable = applies.includes(pane);
    const on = applicable && open.includes(pane);
    btn.hidden = !applicable;
    btn.setAttribute("aria-pressed", on ? "true" : "false");
    btn.classList.toggle("is-active", on);
    // The last open pane cannot be closed: a page with nothing on it is not a layout.
    btn.setAttribute("aria-disabled", on && open.length === 1 ? "true" : "false");
    if (pane === "map") {
      const label = btn.querySelector("span");
      if (label) label.textContent = mapLabel;
      btn.title = `${mapLabel} (M)`;
    }
  }
  const rail = $("rail-map");
  const railLabel = rail?.querySelector(".pane-rail__label");
  if (railLabel) railLabel.textContent = mapLabel;
  if (rail) rail.setAttribute("aria-label", `Show the ${mapLabel.toLowerCase()}`);
}

/**
 * Called on every level: what this level has, what it remembers open, and whether the reader is
 * showing. Code is open exactly when the reader is not hidden; the remembered set only says whether
 * to reopen it on arrival (renderGraphLevel does that).
 */
function syncPanes(route) {
  const level = route?.level ?? "";
  const applies = panesFor(level);
  const remembered = rememberedPanes(level);
  const open = remembered.filter((p) => p !== "code");
  if (applies.includes("code") && $("reader") && !$("reader").hidden) open.push("code");
  state.panes = { applies, open: PANE_ORDER.filter((p) => open.includes(p)), remembered };
  applyPanes();
}

/**
 * Open or collapse one pane. Story and map are attributes; code is the reader, so opening it opens
 * the reader for the current file and closing it closes the reader, and `onReaderVisibility`
 * brings the attribute in step when the reader's `hidden` flips. Returns whether anything changed.
 */
export function setPaneOpen(pane, open) {
  if (!PANE_ORDER.includes(pane) || !isDesktop()) return false;
  const { applies, open: current } = state.panes;
  if (!applies.includes(pane)) return false;
  const on = Boolean(open);
  if (current.includes(pane) === on) return false;
  if (!on && current.length === 1) return false;
  if (pane === "code") {
    if (on) openReader(state.route);
    else state.reader?.close?.();
    return true;
  }
  const next = PANE_ORDER.filter((p) => (p === pane ? on : current.includes(p)));
  state.panes = { ...state.panes, open: next, remembered: next };
  rememberPanes(state.route?.level, next);
  applyPanes();
  if (pane === "map" && on) {
    // A stage that was display:none gave the map's resize observer a 0×0 box it ignored, so its
    // last known size is stale; ask for a fit the way the phone's Map button does.
    const map = ensureMap();
    requestAnimationFrame(() => map?.fit?.());
  }
  emit("panes", next);
  return true;
}

/** The reader's `hidden` flipped: mirror it into the open set, and never leave the page empty. */
function onReaderVisibility() {
  if (!isDesktop()) return;
  const reader = $("reader");
  if (!reader) return;
  const { applies, open } = state.panes;
  if (!applies.includes("code")) return;
  const showing = !reader.hidden;
  if (showing === open.includes("code")) return;
  let next = showing ? PANE_ORDER.filter((p) => p === "code" || open.includes(p)) : open.filter((p) => p !== "code");
  if (next.length === 0) next = ["story"];
  state.panes = { ...state.panes, open: next, remembered: next };
  rememberPanes(state.route?.level, next);
  applyPanes();
  emit("panes", next);
}

function togglePane(pane) {
  return setPaneOpen(pane, !state.panes.open.includes(pane));
}

// ---------------------------------------------------------------------------
// Sections: every one folds from its heading; the folded set is remembered per repo and level
// ---------------------------------------------------------------------------

export function setSectionCollapsed(el, collapsed) {
  if (!el) return;
  const on = Boolean(collapsed);
  el.classList.toggle("is-collapsed", on);
  el.querySelector(":scope > .section__h .section__toggle")?.setAttribute("aria-expanded", on ? "false" : "true");
  const id = el.dataset.section;
  if (!id) return;
  if (on) state.collapsed.add(id);
  else state.collapsed.delete(id);
  storage.set(STORAGE.sections(state.route?.repo, state.route?.level), Array.from(state.collapsed));
}

export function setAllSections(collapsed) {
  for (const el of document.querySelectorAll("#story .section[data-section]")) setSectionCollapsed(el, collapsed);
}

function loadCollapsed(route) {
  const stored = storage.get(STORAGE.sections(route?.repo, route?.level), []);
  state.collapsed = new Set(Array.isArray(stored) ? stored.filter((x) => typeof x === "string") : []);
}

function wireSections() {
  const story = $("story");
  if (!story) return;
  story.addEventListener("click", (ev) => {
    const toggle = ev.target.closest?.(".section__toggle");
    if (toggle) {
      const sec = toggle.closest(".section");
      if (sec) setSectionCollapsed(sec, !sec.classList.contains("is-collapsed"));
      return;
    }
    const all = ev.target.closest?.("[data-sections]");
    if (all) setAllSections(all.dataset.sections === "collapse");
  });
}

/** Below this width the map sits behind a header button instead of beside the story (phones). */
const PHONE_QUERY = "(max-width: 760px)";
export function isPhone() {
  return typeof matchMedia === "function" && matchMedia(PHONE_QUERY).matches;
}

/**
 * On a phone the map column is hidden until asked for, then fills the viewport below the header.
 * The tasks page keeps its board in that column as the page's payload, so the button steps out
 * there. Opening a file in the reader drawer opens the overlay too, since the drawer lives in it.
 */
export function setMapOpen(open) {
  const app = $("app");
  const btn = $("map-toggle");
  if (!app) return;
  const on = Boolean(open);
  app.classList.toggle("is-map-open", on);
  if (btn) {
    btn.setAttribute("aria-pressed", on ? "true" : "false");
    btn.setAttribute("aria-label", on ? "Close the map" : "Show the map");
    btn.title = on ? "Close the map" : "Show the map";
    mount(btn, on ? "Close map" : "Map");
  }
  state.mapOpen = on;
  if (on) {
    const map = ensureMap();
    requestAnimationFrame(() => map?.fit?.());
  }
}

/**
 * One attribute on <main> says whether the map column is payload or optional; the phone CSS and the
 * Map button both key off it, and it comes from the same table the desktop panes use, so adding a
 * level cannot leave the two disagreeing.
 */
function syncMapToggle(route) {
  const level = route?.level ?? "";
  const payload = paneSpec(level).map === "payload";
  const main = $("main");
  if (main) main.dataset.map = payload ? "payload" : "map";
  const btn = $("map-toggle");
  if (!btn) return;
  btn.hidden = level === "" || level === "home" || payload;
  // A new level starts story-first: the overlay never survives navigation.
  setMapOpen(false);
}

function wireHeader() {
  for (const btn of document.querySelectorAll("#lens .seg__btn")) {
    btn.addEventListener("click", () => setLens(btn.dataset.lens));
  }
  for (const btn of document.querySelectorAll("#panes .seg__btn")) {
    btn.addEventListener("click", () => {
      if (btn.getAttribute("aria-disabled") === "true") return;
      togglePane(btn.dataset.pane);
    });
  }
  for (const rail of document.querySelectorAll(".pane-rail")) {
    rail.addEventListener("click", () => setPaneOpen(rail.dataset.pane, true));
  }
  if (typeof matchMedia === "function") matchMedia(DESKTOP_QUERY).addEventListener?.("change", () => syncPanes(state.route));
  $("map-toggle")?.addEventListener("click", () => setMapOpen(!state.mapOpen));
  on("route", (route) => syncMapToggle(route));
  const reader = $("reader");
  if (reader && typeof MutationObserver === "function") {
    new MutationObserver(() => {
      if (isPhone()) {
        if (!reader.hidden && !state.mapOpen) setMapOpen(true);
        else if (reader.hidden && state.mapOpen) setMapOpen(false);
        return;
      }
      onReaderVisibility();
    }).observe(reader, { attributes: true, attributeFilter: ["hidden"] });
  }
  $("search-trigger")?.addEventListener("click", () => openPalette());
  // The idea action: the trigger follows the route and hides itself on the workspace level.
  mountIdeaTrigger();
  $("repo-select")?.addEventListener("change", (ev) => {
    navigate({ level: "repo", repo: ev.target.value, query: {} });
  });
  $("tab-map")?.addEventListener("click", () => setQuery({ tab: null }));
}

/** The repo-level pages, in the header, with the current one marked (§4). */
const NAV_ITEMS = [
  ["repo", "Overview", "repo"],
  ["services", "Services", "service"],
  ["flows", "Data flow", "flow"],
  ["tasks", "Tasks", "task"],
];
const NAV_ACTIVE = { repo: "repo", area: "repo", file: "repo", symbol: "repo", concept: "repo", route: "flows", services: "services", flows: "flows", flow: "flows", tasks: "tasks", task: "tasks" };
function renderNav(route) {
  const nav = $("nav");
  if (!nav) return;
  const repo = route.repo ?? state.facts?.facts?.name ?? null;
  if (!repo || route.level === "workspace" || route.level === "home") {
    mount(nav, []);
    return;
  }
  const active = NAV_ACTIVE[route.level] ?? null;
  mount(
    nav,
    NAV_ITEMS.map(([level, label, glyph]) =>
      h(
        "a",
        {
          class: `nav__item${level === active ? " is-active" : ""}`,
          href: formatRoute({ level, repo, query: {} }),
          "aria-current": level === active ? "page" : null,
          title: label,
        },
        icon(glyph),
        h("span", {}, label),
      ),
    ),
  );
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
  route: "Route",
  concept: "Data concept",
  tasks: "Task board",
  task: "Task",
  services: "Services",
  flows: "Data flow",
  flow: "Data flow",
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
    case "services":
      q.set("scope", "services");
      break;
    case "flow":
      q.set("scope", "flow");
      q.set("id", route.id);
      if (route.query?.depth) q.set("depth", route.query.depth);
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

/**
 * Section wrapper used by every level: <section class="section" id="sec-<id>"><h2 class="section__h">
 * <button class="section__toggle">…</button></h2>…</section>. The heading folds the section; a
 * section whose id is in state.collapsed is built folded, so a skeleton never flashes it open.
 */
export function section(id, heading, ...children) {
  const collapsed = state.collapsed?.has?.(id) ?? false;
  const toggle = h(
    "button",
    { class: "section__toggle", type: "button", "aria-expanded": collapsed ? "false" : "true", title: "Collapse or expand this section" },
    icon("chevron"),
    h("span", { class: "section__label" }, heading),
  );
  return h("section", { class: `section${collapsed ? " is-collapsed" : ""}`, id: `sec-${id}`, dataset: { section: id } }, h("h2", { class: "section__h" }, toggle), ...children);
}

/**
 * render(route): the router target. Applies query state (lens), fetches facts once,
 * then hands off to renderLevel(). The integrator replaces renderLevel's body with the real wiring.
 */
export async function render(route) {
  const token = (state.renderToken += 1);
  state.route = route;

  // Query-driven state: the lens (query wins, then localStorage).
  const lens = LENSES.includes(route.query?.lens) ? route.query.lens : storage.get(STORAGE.lens, "structure");
  if (lens !== state.lens) setLens(lens, { silent: true });
  else setLens(state.lens, { silent: true });

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
  renderNav(route);
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
const STORY_SCOPE = { workspace: "workspace", repo: "repo", area: "area", file: "file", task: "task", services: "services", flow: "flow" };

/** The file a file/symbol route points at, and the symbol name when the route names one. */
function fileOf(route) {
  return route.level === "symbol" ? String(route.id ?? "").replace(/^sym:/, "").split("::")[0] : String(route.id ?? "");
}
function symbolOf(route) {
  if (route.level !== "symbol") return null;
  const parts = String(route.id ?? "").replace(/^sym:/, "").split("::");
  return parts.length > 1 ? parts.slice(1).join("::") : null;
}
/**
 * The task whose change a file route asks the reader for: `?diff=<slug>`, on the file level only. A
 * symbol route never carries it, so a symbol link clicked in diff mode lands on the plain file.
 */
export function diffOf(route) {
  const slug = route?.level === "file" ? route.query?.diff : null;
  return typeof slug === "string" && /^[a-z0-9][a-z0-9-]{0,79}$/.test(slug) ? slug : null;
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
    fetchJson: (url, opts) => api(url, opts),
    onNoteRequest: (prefill) => {
      setPaneOpen("story", true);
      if (!focusNoteForm(prefill)) toast("There is no note form on this page.", { tone: "warn" });
    },
    editorScheme: state.facts?.editorScheme ?? "vscode://file",
    root: state.facts?.root ?? null,
    withRepo: (url) => withRepo(url),
    // The mode lives in the address, so a reload and the back button both keep it.
    onModeChange: (slug) => setQuery({ diff: slug }),
  });
  return state.reader;
}

function wireMapEvents(map) {
  map.on("tap", (id, nd) => onNodeTap(id, nd));
  map.on("dbltap", (id, nd) => onNodeOpen(id, nd));
  map.on("edgeTap", (edge) => pinEdgeSpotlight(edge));
  map.on("depth", (n) => {
    if (state.route?.level === "task") return; // board.js owns the blast-radius depth
    // The explorer's default depth is 1 and drops out of the URL; a flow's default is the tracer's
    // six hops, so *one* hop is a choice worth keeping in the hash.
    const isFlow = state.route?.level === "flow";
    const drop = isFlow ? Number(n) === 6 : Number(n) === 1;
    setQuery({ depth: drop ? null : String(n) });
  });
  map.on("direction", (dir) => {
    if (state.route?.level === "task") return;
    setQuery({ dir: dir === "both" ? null : dir });
  });
  map.on("all", (on) => setQuery({ all: on ? "1" : null }));
  map.on("fold", (id) => {
    if (state.route?.level === "services" && String(id).startsWith("fold:")) setQuery({ all: "1" });
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
  // §4: on the Services map a service pins its Spotlight and filters the map to it, and a file
  // opens its file page — the two questions that map is drawn to answer.
  if (sid.startsWith("svc:")) {
    if (route.level === "services") return setQuery({ service: sid });
    state.map?.select?.(sid);
    pinServiceSpotlight(sid, route, state.renderToken);
    return undefined;
  }
  if (route.level === "services" && nd?.svc === "file") return navigate(routeForNode(route.repo, sid));
  if (route.level === "flow" || route.level === "flows") {
    if (sid.startsWith("route:") || sid.startsWith("sym:")) return navigate(routeForNode(route.repo, sid));
    if (nd?.entityKind === "file" || nd?.kind === "file") return navigate(routeForNode(route.repo, nd?.file ?? sid));
    const path = nd?.file ?? (sid.startsWith("sym:") ? sid.slice(4).split("::")[0] : null);
    if (!path) return undefined;
    state.map?.select?.(sid);
    pinSpotlight(path);
    return undefined;
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
  if (sid.startsWith("flow:")) return navigate(formatRoute({ level: "flow", repo: route.repo, id: sid.slice(5), query: {} }));
  if ((route.level === "flow" || route.level === "flows") && (sid.startsWith("route:") || sid.startsWith("sym:"))) return navigate(routeForNode(route.repo, sid));
  if ((route.level === "flow" || route.level === "flows") && nd?.file) return navigate(routeForNode(route.repo, nd.file));
  const repo = sid.startsWith("repo:") ? sid.slice(5) : route.repo;
  const target = routeForNode(repo, sid);
  if (target && target !== location.hash) navigate(target);
  return undefined;
}

/** Close the pinned card without treating it as the reader dismissing the service focus. */
function closeSpotlightQuietly() {
  state.quietSpotlightClose = true;
  try {
    closeSpotlight({ immediate: true });
  } finally {
    state.quietSpotlightClose = false;
  }
}

function spotlightDeps(route) {
  return {
    map: state.map,
    repo: route?.repo ?? null,
    reader: state.reader,
    route,
    // Dismissing the Spotlight on the Services page is how you leave a focused service, so it puts
    // the whole map back rather than leaving the canvas filtered with nothing saying why.
    onClose: () => {
      if (state.quietSpotlightClose) return;
      const r = currentRoute();
      if (r.level === "services" && r.query?.service) setQuery({ service: null });
    },
    onAddNote: () => {
      setPaneOpen("story", true);
      if (!focusNoteForm()) toast("Open a repo, an area or a file to add a note there.", { tone: "warn" });
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

function symbolHref(repo, id) {
  return formatRoute({ level: "symbol", repo, id, query: {} });
}

function routeHref(repo, id) {
  return formatRoute({ level: "route", repo, id, query: {} });
}

function conceptHref(repo, id) {
  return formatRoute({ level: "concept", repo, id, query: {} });
}

function descriptionOf(knowledge, id) {
  for (const key of ["parameters", "fields", "returns", "callSites"]) {
    const item = knowledge?.current?.[key]?.find?.((entry) => entry.id === id);
    if (item?.description) return item.description;
  }
  return "No description yet.";
}

function typeFact(explicitType) {
  return explicitType?.text ? `Type: ${explicitType.text}` : "Type: not declared";
}

function conceptsForField(concepts, field) {
  const source = field?.source;
  return (concepts ?? []).filter((concept) => concept.occurrences?.some?.((occurrence) => {
    if (source?.file && occurrence.source?.file && occurrence.source.file !== source.file) return false;
    if (Number.isInteger(source?.startLine) && Number.isInteger(occurrence.source?.line) && occurrence.source.line !== source.startLine) return false;
    const occurrencePath = occurrence.path?.length ? occurrence.path : [occurrence.name];
    const fieldPath = field.path?.length ? field.path : [field.name];
    return occurrencePath.length === fieldPath.length && occurrencePath.every((part, index) => part === fieldPath[index]);
  }));
}

/** Recursive, uncapped rendering of semantic values. Every leaf states type, validation and shared description facts. */
export function renderValueTree(shape, options = {}) {
  if (!shape) return h("p", { class: "empty__hint" }, "No structure was derivable from the code.");
  const prefix = options.prefix ?? "value";
  const renderShape = (value, pathParts, depth) => {
    const children = [];
    for (const field of value.fields ?? []) {
      const next = [...pathParts, field.name];
      const id = `${prefix}:${next.join(".")}`;
      const validations = (options.validations ?? []).filter((rule) => rule.fieldPaths?.some?.((candidate) => candidate.join(".").endsWith(next.join("."))));
      const concepts = conceptsForField(options.concepts, field);
      const detail = h(
        "details",
        { class: "value-tree__field", open: depth < 1 ? true : null },
        h(
          "summary",
          {},
          h("code", {}, field.name),
          h("span", { class: `value-tree__type${field.explicitType ? "" : " is-missing"}` }, typeFact(field.explicitType)),
        ),
        h("p", { class: "value-tree__description" }, descriptionOf(options.knowledge, id)),
        validations.length
          ? h("ul", { class: "fact-list" }, validations.map((rule) => h("li", {}, h("span", { class: "chip chip--muted" }, `Validation: ${rule.kind}`), " ", h("code", {}, rule.expression))))
          : h("p", { class: "faint" }, "Validation: none found"),
        concepts.length
          ? h("div", { class: "entity-links" }, concepts.map((concept) => entityLink("entity", conceptHref(options.repo, concept.id), concept.canonicalName, { refs: concept.id })))
          : null,
        field.shape ? renderShape(field.shape, next, depth + 1) : null,
      );
      children.push(detail);
    }
    for (const [index, element] of (value.elements ?? []).entries()) {
      children.push(h("details", { class: "value-tree__field", open: depth < 1 ? true : null }, h("summary", {}, h("code", {}, `Item ${index + 1}`), h("span", { class: "value-tree__type is-missing" }, "Type: not declared")), renderShape(element, [...pathParts, `[${index}]`], depth + 1)));
    }
    for (const [index, variant] of (value.variants ?? []).entries()) {
      children.push(h("details", { class: "value-tree__field" }, h("summary", {}, `Variant ${index + 1}`), renderShape(variant, [...pathParts, `variant-${index + 1}`], depth + 1)));
    }
    if (!children.length) children.push(h("p", { class: "faint" }, value.reference ? `Declared shape: ${value.reference}` : "No fields are declared or statically visible."));
    return h("div", { class: "value-tree", dataset: { kind: value.kind ?? "unknown" } }, children);
  };
  return renderShape(shape, [], 0);
}

export function renderReturns(returns, options = {}) {
  if (!returns?.length) return h("p", { class: "empty__hint" }, "No explicit return statements were found.");
  return h("div", { class: "return-list" }, returns.map((variant, index) => h(
    "details",
    { class: "return-card", open: index === 0 ? true : null },
    h("summary", {}, h("code", {}, variant.expression || "implicit return"), h("span", { class: `value-tree__type${variant.explicitType ? "" : " is-missing"}` }, typeFact(variant.explicitType)), variant.status ? h("span", { class: "chip chip--muted" }, `HTTP ${variant.status}`) : null),
    variant.condition ? h("p", { class: "faint" }, `When ${variant.condition}`) : null,
    h("p", { class: "value-tree__description" }, descriptionOf(options.knowledge, variant.id)),
    variant.shape ? renderValueTree(variant.shape, { ...options, prefix: variant.id }) : null,
  )));
}

function renderKnowledgeEditor(knowledge, route) {
  const current = structuredClone(knowledge.current ?? { summary: "", parameters: [], fields: [], returns: [], callSites: [] });
  const summary = h("p", { class: "entity-summary" }, current.summary || "No shared summary yet.");
  const editor = h("form", { class: "form knowledge-editor", hidden: true });
  const summaryInput = h("textarea", { class: "form__textarea", name: "summary", required: true, "aria-label": "Current summary" }, current.summary);
  const reason = h("input", { class: "form__input", name: "reason", required: true, placeholder: "Why are you changing this understanding?", "aria-label": "Reason for edit" });
  const error = h("p", { class: "form__error", role: "alert", hidden: true });
  const groups = ["parameters", "fields", "returns", "callSites"];
  const descriptionInputs = new Map();
  for (const group of groups) {
    for (const item of current[group] ?? []) {
      const input = h("textarea", { class: "form__textarea knowledge-editor__description", rows: "2", dataset: { group, id: item.id }, "aria-label": `Description for ${item.id}` }, item.description ?? "");
      descriptionInputs.set(`${group}:${item.id}`, input);
      editor.append(h("label", { class: "form__label knowledge-editor__field" }, h("code", {}, item.id), item.explicitType ? h("span", { class: "faint" }, ` · ${item.explicitType}`) : h("span", { class: "faint" }, " · type not declared"), input));
    }
  }
  const edit = h("button", { class: "btn btn--small", type: "button" }, "Edit");
  const cancel = h("button", { class: "btn btn--small", type: "button" }, "Cancel");
  const save = h("button", { class: "btn btn--primary btn--small", type: "submit" }, "Save");
  const reload = h("button", { class: "btn btn--small", type: "button", hidden: true }, "Reload server version");
  editor.prepend(h("label", { class: "form__label" }, "Current summary", summaryInput));
  editor.append(h("label", { class: "form__label" }, "Change reason", reason), error, h("div", { class: "form__actions" }, save, cancel, reload));
  edit.addEventListener("click", () => {
    summary.hidden = true;
    edit.hidden = true;
    editor.hidden = false;
    summaryInput.focus();
  });
  cancel.addEventListener("click", () => {
    editor.reset();
    summaryInput.value = current.summary;
    for (const group of groups) for (const item of current[group] ?? []) descriptionInputs.get(`${group}:${item.id}`).value = item.description ?? "";
    error.hidden = true;
    reload.hidden = true;
    editor.hidden = true;
    summary.hidden = false;
    edit.hidden = false;
  });
  reload.addEventListener("click", () => render(route));
  editor.addEventListener("submit", async (event) => {
    event.preventDefault();
    error.hidden = true;
    reload.hidden = true;
    const next = structuredClone(current);
    next.summary = summaryInput.value.trim();
    for (const group of groups) for (const item of next[group] ?? []) item.description = descriptionInputs.get(`${group}:${item.id}`).value.trim();
    if (!next.summary || !reason.value.trim()) {
      error.textContent = "A summary and change reason are required.";
      error.hidden = false;
      return;
    }
    save.disabled = true;
    try {
      await post(withRepo("/api/knowledge", route.repo), { entity: knowledge.entity, expectedRevision: knowledge.revision, fingerprint: knowledge.fingerprint, current: next, reason: reason.value.trim() });
      toast("Shared understanding saved in its own commit.", { tone: "ok" });
      render(route);
    } catch (err) {
      error.textContent = err.status === 409 ? `${err.message} Your draft is still here.` : err.message;
      error.hidden = false;
      reload.hidden = err.status !== 409;
      save.disabled = false;
    }
  });

  const refresh = h("div", { class: "knowledge-refresh" });
  const agent = h("select", { class: "form__select", "aria-label": "Knowledge generator" }, h("option", { value: "codex" }, "Codex"), h("option", { value: "claude" }, "Claude"));
  const previewButton = h("button", { class: "btn btn--small", type: "button" }, knowledge.stale ? "Preview refresh" : "Generate summary");
  const preview = h("div", { class: "knowledge-refresh__preview", hidden: true });
  previewButton.addEventListener("click", async () => {
    previewButton.disabled = true;
    try {
      const scope = await api(withRepo(`/api/knowledge-preview?agent=${agent.value}&entity=${encodeURIComponent(knowledge.entity)}`, route.repo), { fresh: true });
      const confirm = h("button", { class: "btn btn--primary btn--small", type: "button" }, "Confirm refresh");
      confirm.addEventListener("click", async () => {
        confirm.disabled = true;
        mount(preview, h("p", { class: "para" }, "Generation is running…"));
        try {
          const job = await post(withRepo("/api/knowledge-generate", route.repo), { agent: agent.value, entities: [knowledge.entity] });
          const finished = await post(withRepo("/api/knowledge-run", route.repo), { id: job.id, confirm: true });
          if (finished.status === "completed") {
            mount(preview, h("p", { class: "para para--fact" }, `Completed ${finished.completedChunks} chunk${finished.completedChunks === 1 ? "" : "s"}; commit ${finished.commit}.`));
            render(route);
          } else mount(preview, h("p", { class: "form__error" }, finished.failures?.join("; ") || `Generation ${finished.status}.`));
        } catch (err) {
          mount(preview, h("p", { class: "form__error" }, err.message));
        }
      });
      mount(preview, h("p", { class: "para" }, `${scope.agent} will refresh ${scope.entities} entity in ${scope.expectedChunks} chunk. It will create ${scope.commitBehavior}.`), h("p", { class: "faint" }, `${scope.files} files · ${scope.symbols} symbols · ${scope.newEntities} new · ${scope.staleEntities} stale`), confirm);
      preview.hidden = false;
    } catch (err) {
      mount(preview, h("p", { class: "form__error" }, err.message));
      preview.hidden = false;
    } finally {
      previewButton.disabled = false;
    }
  });
  refresh.append(h("div", { class: "form__row" }, agent, previewButton), preview);

  return h(
    "div",
    { class: "knowledge-panel" },
    knowledge.stale ? h("div", { class: "stale-warning", role: "status" }, "This summary may be stale. Current source fingerprint ", h("code", {}, knowledge.currentFingerprint ?? knowledge.fingerprint), "; saved fingerprint ", h("code", {}, knowledge.storedFingerprint ?? "unknown"), ".") : null,
    knowledge.retired ? h("div", { class: "stale-warning" }, "This understanding is retired", knowledge.supersededBy ? ` and superseded by ${knowledge.supersededBy}` : "", ".") : null,
    summary,
    h("div", { class: "card__actions" }, edit),
    editor,
    refresh,
    h("p", { class: "faint" }, `${knowledge.historyCount} saved update${knowledge.historyCount === 1 ? "" : "s"} · revision ${knowledge.revision}`),
  );
}

function callList(items, repo, empty) {
  if (!items?.length) return h("p", { class: "empty__hint" }, empty);
  return h("ul", { class: "entity-list" }, items.map((item) => h("li", {}, entityLink("symbol", symbolHref(repo, item.symbol.id), item.symbol.qualifiedName, { refs: item.symbol.id }), h("span", { class: "faint" }, ` · ${item.callSites.length} call site${item.callSites.length === 1 ? "" : "s"} · ${item.symbol.file}`))));
}

function callView(graph) {
  return {
    level: "call",
    center: graph.center,
    nodes: graph.nodes.map((node) => ({ id: node.id, kind: "symbol", label: node.label, path: node.file, center: node.selected, side: node.side === "caller" ? "up" : node.side === "callee" ? "down" : "center", hop: node.depth, role: "source" })),
    edges: graph.edges.map((edge) => ({ ...edge, kind: "calls", weight: edge.callSiteIds.length, names: edge.callSiteIds })),
    counts: {
      up: [graph.nodes.filter((node) => node.side === "caller").length],
      down: [graph.nodes.filter((node) => node.side === "callee").length],
    },
  };
}

/** Dedicated symbol page renderer; exported for the DOM contract tests. */
export function renderSymbolEntity(container, page, route) {
  const params = page.parameters?.length
    ? h("div", { class: "parameter-list" }, page.parameters.map((parameter) => {
      const name = parameter.name ?? (parameter.bindingPaths?.map((parts) => parts.join(".")).join(", ") || `argument ${parameter.index + 1}`);
      return h("details", { class: "parameter-card" }, h("summary", {}, h("code", {}, name), h("span", { class: `value-tree__type${parameter.explicitType ? "" : " is-missing"}` }, typeFact(parameter.explicitType))), h("p", { class: "value-tree__description" }, descriptionOf(page.knowledge, `parameter:${parameter.index}:${parameter.name ?? "anonymous"}`)), parameter.shape ? renderValueTree(parameter.shape, { prefix: `parameter:${parameter.index}`, knowledge: page.knowledge, validations: page.validations, repo: route.repo }) : null);
    }))
    : h("p", { class: "empty__hint" }, "This declaration has no parameters.");
  mount(
    container,
    section("understanding", "Current understanding", renderKnowledgeEditor(page.knowledge, route)),
    section("signature", "Inputs and returns", params, renderReturns(page.returns, { knowledge: page.knowledge, validations: page.validations, repo: route.repo })),
    section("calls", "Call relationships", h("h3", { class: "entity-subhead" }, "Called by"), callList(page.callers, route.repo, "No resolved direct callers were found."), h("h3", { class: "entity-subhead" }, "Calls"), callList(page.callees, route.repo, "No resolved direct callees were found.")),
    section("unresolved", "Unresolved call sites", page.unresolved?.length ? h("ul", { class: "entity-list" }, page.unresolved.map((item) => h("li", {}, h("code", {}, item.finding.expression), " — ", item.finding.reason, h("span", { class: "faint" }, ` · ${item.finding.source.file}`)))) : h("p", { class: "empty__hint" }, "No unresolved calls originate in this symbol.")),
  );
}

async function renderSymbolLevel(route, token) {
  const sections = $("sections");
  const map = ensureMap();
  const reader = ensureReader();
  const depth = ["1", "2", "3"].includes(String(route.query?.depth)) ? route.query.depth : "1";
  const direction = ["up", "down", "both"].includes(String(route.query?.dir)) ? route.query.dir : "both";
  try {
    const page = await api(withRepo(`/api/symbol?id=${encodeURIComponent(route.id)}&depth=${depth}&direction=${direction}`, route.repo));
    if (token !== state.renderToken) return;
    renderCrumbs([
      { label: route.repo, route: formatRoute({ level: "repo", repo: route.repo, query: {} }) },
      { label: page.parentFile, route: formatRoute({ level: "file", repo: route.repo, id: page.parentFile, query: {} }) },
      { label: page.symbol.qualifiedName, route: formatRoute(route) },
    ]);
    renderSymbolEntity(sections, page, route);
    sections.prepend(h("div", { class: "entity-hero" }, h("span", { class: "chip chip--muted" }, page.symbol.kind.toUpperCase()), h("h1", {}, page.symbol.qualifiedName), entityLink("file", formatRoute({ level: "file", repo: route.repo, id: page.parentFile, query: {} }), page.parentFile, { refs: page.parentFile }), h("div", { class: "form__row entity-controls" }, h("span", { class: "form__label" }, "Direction"), ...["up", "both", "down"].map((value) => h("button", { class: `btn btn--small${direction === value ? " is-active" : ""}`, type: "button", on: { click: () => setQuery({ dir: value === "both" ? null : value }) } }, value === "up" ? "Callers" : value === "down" ? "Callees" : "Both")), h("label", { class: "form__label" }, "Depth ", h("select", { class: "form__select", on: { change: (event) => setQuery({ depth: event.target.value === "1" ? null : event.target.value }) } }, [1, 2, 3].map((value) => h("option", { value, selected: String(value) === depth ? true : null }, value)))))));
    try {
      map?.show(callView(page.graph), { level: "call", lens: "structure", repo: route.repo, depth: Number(depth), direction });
      $("map-footer").textContent = `${page.callers.length} direct caller${page.callers.length === 1 ? "" : "s"} · ${page.callees.length} direct callee${page.callees.length === 1 ? "" : "s"}`;
    } catch (err) {
      console.error("symbol call map failed", err);
    }
    reader?.open(page.parentFile, { source: page.source, symbolSource: page.source });
  } catch (err) {
    if (token !== state.renderToken) return;
    mount(sections, errorCard("/api/symbol", err.message, () => render(route)));
  }
}

function symbolReference(repo, symbol, fallback = "Unknown symbol") {
  return symbol ? entityLink("symbol", symbolHref(repo, symbol.id), symbol.qualifiedName, { refs: symbol.id }) : h("span", { class: "faint" }, fallback);
}

export function renderRouteEntity(container, page, route) {
  const handler = h("div", { class: "entity-links" }, symbolReference(route.repo, page.handler, "No handler symbol was resolved."), ...(page.middleware ?? []).map((symbol) => symbolReference(route.repo, symbol)));
  const clients = page.clients?.length ? h("ul", { class: "entity-list" }, page.clients.map((item) => h("li", {}, symbolReference(route.repo, item.caller), h("span", { class: "faint" }, ` · ${item.call.method} ${item.call.path}`)))) : h("p", { class: "empty__hint" }, "No static client callers were found.");
  mount(
    container,
    h("div", { class: "entity-hero" }, h("span", { class: "chip chip--muted" }, "ENDPOINT"), h("h1", {}, `${page.route.method} ${page.route.path}`), h("span", { class: "faint" }, page.route.kind)),
    section("understanding", "Current understanding", renderKnowledgeEditor(page.knowledge, route)),
    section("handlers", "Handler and middleware", handler),
    section("clients", "Client callers", clients),
    section("request", "Request fields", renderValueTree(page.requestShape, { prefix: "request", knowledge: page.knowledge, validations: page.validations, concepts: page.concepts, repo: route.repo })),
    section("responses", "Response variants", renderReturns(page.responses, { knowledge: page.knowledge, validations: page.validations, concepts: page.concepts, repo: route.repo })),
    section("connections", "Flows, services, and concepts", h("div", { class: "entity-links" }, ...(page.flows ?? []).map((flow) => entityLink("flow", formatRoute({ level: "flow", repo: route.repo, id: flow.id, query: {} }), flow.title, { refs: flow.id })), ...(page.services ?? []).map((service) => entityLink("service", formatRoute({ level: "services", repo: route.repo, query: { service } }), service.replace(/^svc:[^:]+:/, ""), { refs: service })), ...(page.concepts ?? []).map((concept) => entityLink("entity", conceptHref(route.repo, concept.id), concept.canonicalName, { refs: concept.id })))),
  );
}

async function renderRouteLevel(route, token) {
  try {
    const page = await api(withRepo(`/api/route?id=${encodeURIComponent(route.id)}`, route.repo));
    if (token !== state.renderToken) return;
    renderRouteEntity($("sections"), page, route);
  } catch (err) {
    if (token === state.renderToken) mount($("sections"), errorCard("/api/route", err.message, () => render(route)));
  }
}

function conceptOverrideForms(page, route) {
  const status = h("p", { class: "form__error", role: "status", hidden: true });
  const mergeSources = h("input", { class: "form__input", placeholder: "concept:source-one, concept:source-two", "aria-label": "Concept IDs to merge" });
  const mergeReason = h("input", { class: "form__input", placeholder: "Why should these concepts be merged?", "aria-label": "Merge reason" });
  const mergeForm = h("form", { class: "form concept-override" }, h("label", { class: "form__label" }, "Merge these concept IDs into this concept", mergeSources), h("label", { class: "form__label" }, "Reason", mergeReason), h("button", { class: "btn btn--small", type: "submit" }, "Merge concepts"));
  mergeForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      const sourceIds = mergeSources.value.split(",").map((value) => value.trim()).filter(Boolean);
      await post(withRepo("/api/concept-merge", route.repo), { expectedRevision: page.override.revision, targetId: page.concept.id, sourceIds, reason: mergeReason.value.trim() });
      render(route);
    } catch (err) {
      status.textContent = err.message;
      status.hidden = false;
    }
  });
  const target = h("input", { class: "form__input", placeholder: "concept:new-name", "aria-label": "New concept ID" });
  const name = h("input", { class: "form__input", placeholder: "New canonical name", "aria-label": "New concept name" });
  const splitReason = h("input", { class: "form__input", placeholder: "Why are these occurrences distinct?", "aria-label": "Split reason" });
  const choices = (page.concept.occurrences ?? []).map((occurrence) => h("label", { class: "concept-occurrence-choice" }, h("input", { type: "checkbox", value: occurrence.id }), h("code", {}, occurrence.name), h("span", { class: "faint" }, ` · ${occurrence.source.file}:${occurrence.source.startLine}`)));
  const splitForm = h("form", { class: "form concept-override" }, h("label", { class: "form__label" }, "New concept ID", target), h("label", { class: "form__label" }, "Canonical name", name), h("fieldset", { class: "concept-occurrences" }, h("legend", { class: "form__label" }, "Occurrences to move"), choices), h("label", { class: "form__label" }, "Reason", splitReason), h("button", { class: "btn btn--small", type: "submit" }, "Split selected occurrences"));
  splitForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      const occurrenceIds = [...splitForm.querySelectorAll('input[type="checkbox"]:checked')].map((input) => input.value);
      await post(withRepo("/api/concept-split", route.repo), { expectedRevision: page.override.revision, sourceId: page.concept.id, targetId: target.value.trim(), canonicalName: name.value.trim(), occurrenceIds, reason: splitReason.value.trim() });
      render(route);
    } catch (err) {
      status.textContent = err.message;
      status.hidden = false;
    }
  });
  return h("div", {}, h("details", { class: "concept-action" }, h("summary", {}, "Merge concepts"), mergeForm), h("details", { class: "concept-action" }, h("summary", {}, "Split this concept"), splitForm), status);
}

export function renderConceptEntity(container, page, route) {
  const occurrences = h("div", { class: "concept-occurrence-list" }, ...(page.concept.occurrences ?? []).map((occurrence) => h("details", { class: "concept-occurrence" }, h("summary", {}, h("code", {}, occurrence.name), h("span", { class: `value-tree__type${occurrence.explicitType ? "" : " is-missing"}` }, occurrence.explicitType ? `Type: ${occurrence.explicitType}` : "Type: not declared")), h("p", {}, descriptionOf(page.knowledge, occurrence.id)), h("div", { class: "entity-links" }, entityLink("file", formatRoute({ level: "file", repo: route.repo, id: occurrence.source.file, query: { line: String(occurrence.source.startLine) } }), occurrence.source.file, { refs: occurrence.source.file }), occurrence.symbolId ? entityLink("symbol", symbolHref(route.repo, occurrence.symbolId), occurrence.symbolId.split("::").at(-1), { refs: occurrence.symbolId }) : null))));
  mount(
    container,
    h("div", { class: "entity-hero" }, h("span", { class: "chip chip--muted" }, "DATA CONCEPT"), h("h1", {}, page.concept.canonicalName), page.redirectedFrom ? h("p", { class: "stale-warning" }, `Redirected from ${page.redirectedFrom}. The older knowledge record and history were retained.`) : null, h("p", { class: "faint" }, `Aliases: ${(page.concept.aliases ?? []).join(", ") || "none"}`)),
    section("understanding", "Current understanding", renderKnowledgeEditor(page.knowledge, route)),
    section("occurrences", "Occurrences and declared types", occurrences),
    section("evidence", "Validations and transformations", page.validations?.length ? h("ul", { class: "entity-list" }, page.validations.map((rule) => h("li", {}, h("code", {}, rule.expression), h("span", { class: "faint" }, ` · ${rule.kind}`)))) : h("p", { class: "empty__hint" }, "No runtime validations were connected."), page.concept.transformations?.length ? h("ul", { class: "entity-list" }, page.concept.transformations.map((value) => h("li", {}, value))) : h("p", { class: "empty__hint" }, "No transformations were proven.")),
    section("connections", "Routes, flows, and symbols", h("div", { class: "entity-links" }, ...(page.routes ?? []).map((item) => entityLink("flow", routeHref(route.repo, item.id), `${item.method} ${item.path}`, { refs: item.id })), ...(page.flows ?? []).map((flow) => entityLink("flow", formatRoute({ level: "flow", repo: route.repo, id: flow.id, query: {} }), flow.title, { refs: flow.id })), ...(page.symbols ?? []).map((symbol) => entityLink("symbol", symbolHref(route.repo, symbol.id), symbol.qualifiedName, { refs: symbol.id })))),
    section("manual", "Manual grouping", h("p", { class: "para" }, `Override revision ${page.override.revision}. Splits are applied before merges; older records and history are retained.`), conceptOverrideForms(page, route)),
  );
}

async function renderConceptLevel(route, token) {
  try {
    const page = await api(withRepo(`/api/concept?id=${encodeURIComponent(route.id)}`, route.repo));
    if (token !== state.renderToken) return;
    renderConceptEntity($("sections"), page, route);
  } catch (err) {
    if (token === state.renderToken) mount($("sections"), errorCard("/api/concept", err.message, () => render(route)));
  }
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
  closeSpotlightQuietly();
  // A node selected on the level being left keeps its white ring when the same id is drawn on the
  // next one (a service is on the Services map, the flow index and every flow that reaches it).
  state.map?.select?.(null);
  if (route.level !== "tasks" && route.level !== "task") unmountBoard(stage);
  if (route.level !== "file" && route.level !== "symbol") state.reader?.close?.();
  if (route.level !== "workspace") $("map-col")?.querySelector(".ws-tiles")?.remove();
  syncTestsButton(route);
  syncGraphChrome(route);

  const main = $("main");
  if (main) main.dataset.level = route.level ?? "";
  // Folded sections and open panes are per level; both are read before anything is drawn.
  loadCollapsed(route);
  syncPanes(route);
  renderCrumbs(crumbsFor(route));
  if (scope) renderSkeleton(sections, sectionHeadingsFor(scope, state.lens));
  else if (route.level === "flows") renderSkeleton(sections, ["Cloudflare handlers", "HTTP routes", "Program entry points"]);
  else mount(sections, section("loading", LEVEL_NAMES[route.level] ?? "Loading", skeleton()));

  switch (route.level) {
    case "tasks":
      return renderTasksLevel(route, token);
    case "task":
      return renderTaskLevel(route, token);
    case "services":
      return renderServicesLevel(route, token);
    case "flows":
      return renderFlowsLevel(route, token);
    case "flow":
      return renderFlowLevel(route, token);
    case "symbol":
      return renderSymbolLevel(route, token);
    case "route":
      return renderRouteLevel(route, token);
    case "concept":
      return renderConceptLevel(route, token);
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
const GRAPHLESS_LEVELS = new Set(["tasks", "route", "concept", "people", "person", "time"]);
/** The levels whose maps carry no history, no coverage and no authorship to colour by (§4). */
const SERVICE_LEVELS = new Set(["services", "flows", "flow"]);
const SERVICE_LENSES = new Set(["structure", "knowledge"]);
function syncGraphChrome(route) {
  const graphless = GRAPHLESS_LEVELS.has(route.level ?? "");
  const dedicatedGraph = route.level === "symbol";
  const lens = $("lens");
  if (lens) lens.hidden = graphless || dedicatedGraph;
  const tabs = $("map-tabs");
  if (tabs) tabs.hidden = graphless || dedicatedGraph;
  // A lens that cannot say anything about the nodes on screen is disabled rather than left live and
  // inert: the Services and Data flow maps draw services and steps, which have notes but no commits,
  // no test coverage and no authors of their own.
  const limited = SERVICE_LEVELS.has(route.level ?? "");
  for (const btn of document.querySelectorAll("#lens .seg__btn")) {
    if (!btn.dataset.tip) btn.dataset.tip = btn.title;
    const ok = !limited || SERVICE_LENSES.has(btn.dataset.lens);
    btn.disabled = !ok;
    btn.setAttribute("aria-disabled", ok ? "false" : "true");
    btn.title = ok
      ? limited && btn.dataset.lens === "knowledge"
        ? "Colour = notes about each service (2)"
        : btn.dataset.tip
      : "Not on this page: a service has notes, but no commits, no tests and no authors of its own";
  }
}

function syncTestsButton(route) {
  const btn = $("tb-tests");
  if (!btn) return;
  const on = route.query?.tests === "1";
  btn.setAttribute("aria-pressed", on ? "true" : "false");
  btn.hidden = !(route.level === "area" || route.level === "file" || route.level === "services");
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
  // In diff mode the change is asked for first: its answer says whether the graph ever read this
  // path, and when it did not, the story, the impact view and the Spotlight would each answer 404.
  // Reggie's own records, branch-only files and deleted files are most of what a task changes, so
  // those three failures are skipped rather than made and swallowed. The reader asks the same URL a
  // moment later and is answered from the fetch cache.
  // It is asked past the fetch cache every time, and handed to the reader, which compares the two
  // commits it was read between with what it last drew: a branch that was sent back and fixed is the
  // same path and the same slug, and only the range says the change on screen is the old one.
  const diffSlug = diffOf(route);
  let offMap = false;
  let change = null;
  if (diffSlug) {
    const probe = await wrap(api(withRepo(diffUrl(fileOf(route), diffSlug)), { fresh: true }));
    if (token !== state.renderToken) return;
    change = probe.value ?? null;
    offMap = change?.mapped === false;
  }
  const [story, view] = offMap
    ? [{ value: null }, { value: null }]
    : await Promise.all([storyUrl ? wrap(api(storyUrl)) : Promise.resolve({ value: null }), mapUrl ? wrap(api(mapUrl)) : Promise.resolve({ value: null })]);
  if (token !== state.renderToken) return;

  // --- story ------------------------------------------------------------------
  // A 404 in diff mode is still the ordinary answer when the change itself could not say (a slug
  // that names no change, say): the page explains in words and lets the reader carry what it can.
  const unmapped = offMap || (Boolean(diffSlug) && story.error?.status === 404);
  if (unmapped) {
    state.story = null;
    renderUnmappedChange(route, diffSlug);
    addReaderButton(route);
  } else if (story.error) {
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
  } else if (diffSlug && (offMap || view.error?.status === 404)) {
    // No toast, and no graph left over from the page before: an empty view, with its own sentence.
    try {
      map?.show({ level: "impact", nodes: [], edges: [], empty: { text: "This file is not on the code map in this checkout, so there is nothing to draw around it.", hint: "The reader below shows what the task changed in it." } }, showOptsFor(route));
    } catch (err) {
      console.error("map.show failed", err);
    }
    $("map-footer").textContent = "";
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
    if (!offMap) pinSpotlight(fileOf(route)); // spec §2 Level 3: the Spotlight is pinned automatically
    const name = symbolOf(route);
    const shown = state.reader?.current?.() ?? null;
    if (name) openReader(route, { highlight: name });
    // A change is what the route asked for, so the reader opens without a click, on a phone too,
    // where the reader opening brings up the map overlay it lives in.
    else if (diffSlug) {
      openReader(route, change ? { file: change } : {});
      // A reader left open behind a closed overlay never flips `hidden`, so nothing else would raise it.
      if (isPhone()) setMapOpen(true);
    }
    // The mode button dropped `diff` from the route while the reader was showing the change.
    else if (shown?.open && shown.diff) openReader(route);
    else if (isDesktop() && state.panes.remembered.includes("code")) openReader(route);
  }
  return undefined;
}

/** The story column of a `?diff=` file page whose path the graph never read: words, not an error card. */
function renderUnmappedChange(route, slug) {
  const file = fileOf(route);
  const why = file.startsWith(".reggie/")
    ? "This file is one of Reggie's own records. The code map leaves those out, so there is no story, no imports and no history to show for it here."
    : "This file is not on the code map in this checkout, so there is no story for it here. That is what happens to a file that exists only on a task's branch, to one that has since been deleted, and to a kind of file the map does not read.";
  mount(
    $("sections"),
    section(
      "unmapped",
      "About this file",
      h("p", { class: "para para--fact" }, why),
      h("p", { class: "para para--gap" }, "The reader shows what ", entityLink("task", formatRoute({ level: "task", repo: route.repo, id: slug, query: {} }), slug), " changed in it, line by line."),
    ),
  );
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
  const slug = diffOf(route);
  const btn = h(
    "button",
    { class: "btn btn--primary", type: "button", title: slug ? `Open what ${slug} changed in ${path} in the reader drawer` : `Open ${path} in the reader drawer`, on: { click: () => openReader(route) } },
    icon("file"),
    h("span", {}, slug ? "Read the change" : "Read the source"),
  );
  // In diff mode the way back to the task is one tap away, which on a phone is once the reader is closed.
  const back = slug ? h("a", { class: "btn story__back", href: formatRoute({ level: "task", repo: route.repo, id: slug, query: {} }), title: `Back to task ${slug}` }, icon("task"), h("span", {}, `Back to task ${slug}`)) : null;
  sections.prepend(h("div", { class: "card__actions story__actions" }, btn, back));
}

/** Open the reader on the route's file, in the mode the route names: `?diff=<slug>` is that task's change. */
function openReader(route, opts = {}) {
  const reader = ensureReader();
  if (!reader) return;
  reader.open(fileOf(route), { diff: diffOf(route), ...opts });
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
      // A div around the link, not a link: the tile carries the idea button, and interactive
      // content inside an <a> is invalid. The link wraps every fact so the whole surface still
      // opens the repo; the hover cross-highlight and the refs stay on the wrapper.
      const link = h(
        "a",
        { class: "ws-tile__link", href: formatRoute({ level: "repo", repo: r.name, query: {} }) },
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
            { n: counts.groomed ?? 0, color: "#7dcfff", label: "Groomed" },
            { n: counts.planned ?? 0, color: "#bb9af7", label: "Planned" },
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
      const tile = h("div", { class: "ws-tile", "data-refs": `repo:${r.name}` }, link, ideaButtonFor(r.name));
      tile.addEventListener("mouseenter", () => state.map?.highlight?.([`repo:${r.name}`]));
      tile.addEventListener("mouseleave", () => state.map?.clearHighlight?.());
      return tile;
    }),
  );
  void route;
}

/** #/repo/<name>/tasks — story column becomes the Needs-you queue, map column becomes the board. */
// ---------------------------------------------------------------------------
// Services and Data flow (services-and-flows-spec.md §4)
// ---------------------------------------------------------------------------

/** Promise → { value } | { error }, so one failed panel never blanks the other. */
function settle(p) {
  return p.then((value) => ({ value }), (error) => ({ error }));
}

/** The entry kinds `/api/flows` reports, in the order the index lists them, with a heading each. */
const FLOW_KIND_HEADINGS = [
  ["cloudflare", "Cloudflare handlers"],
  ["http-route", "HTTP routes"],
  ["next-route", "Next.js route handlers"],
  ["next-page", "Next.js pages"],
  ["mcp", "MCP tools"],
  ["cli", "CLI commands"],
  ["main", "Program entry points"],
];
const DROP_REASONS = {
  "hop-budget": "each hop may draw only its share of the step budget, so a wide entry point cannot spend what the deeper hops need",
  "step-cap": "the whole walk is capped at 200 steps",
  depth: (flow) => `the walk stops at ${flow?.depth ? `hop ${flow.depth}` : "the hop limit"}, which is as far as this trace was asked to go`,
};
const FLOW_DEPTHS = ["1", "2", "3", "4", "5", "6"];

function flowDepth(route) {
  return FLOW_DEPTHS.includes(String(route.query?.depth)) ? Number(route.query.depth) : 6;
}

/** "18 steps are not drawn: nine at hop one and nine at hop two" — what a cap cost, in words. */
export function droppedSentence(flow) {
  const list = (Array.isArray(flow?.dropped) ? flow.dropped : []).filter((d) => (d?.count ?? 0) > 0);
  if (!list.length) return null;
  const total = list.reduce((a, d) => a + d.count, 0);
  const parts = list.map((d) => `${d.count} at hop ${d.hop}`);
  const where = parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
  const reasons = Array.from(new Set(list.map((d) => {
    const r = DROP_REASONS[d.reason];
    return typeof r === "function" ? r(flow) : r ?? d.reason;
  })));
  const widthOnly = list.every((d) => d.reason === "hop-budget");
  const tail = widthOnly ? " What is missing is breadth, not depth: every hop below is still walked." : "";
  return `${total} step${total === 1 ? "" : "s"} of this flow ${total === 1 ? "is" : "are"} not drawn — ${where} — because ${reasons.join(", and ")}.${tail}`;
}

/** Services: story from `/api/story?scope=services`, map from `/api/services` (§4). */
async function renderServicesLevel(route, token) {
  const sections = $("sections");
  const mapCol = $("map-col");
  const map = ensureMap();
  const focus = route.query?.service ?? null;
  const mapUrl = withRepo("/api/services");
  if (state.rendererOk) mapCol?.classList.add("is-loading");
  const [story, index, graph] = await Promise.all([
    settle(api(withRepo(`/api/story?${storyParams(route)}`))),
    settle(api(mapUrl)),
    // The map groups the files that touch a service into their Level-1 areas, and takes the hue for
    // each area from the same list the repo map colours by, so one area is one colour everywhere.
    state.rendererOk ? settle(api(withRepo("/api/graph?level=container"))) : Promise.resolve({ value: null }),
  ]);
  if (token !== state.renderToken) return;

  if (story.error) {
    state.story = null;
    mount(sections, errorCard("/api/story", story.error.message, () => render(route)));
  } else if (story.value) {
    state.story = story.value;
    renderCrumbs(story.value.crumbs?.length ? story.value.crumbs : crumbsFor(route));
    renderStory(sections, story.value, storyDeps(route));
    if (index.value) appendDeclaredList(sections, index.value, route);
  }

  mapCol?.classList.remove("is-loading");
  if (!state.rendererOk) {
    $("map-footer").textContent = "map unavailable";
  } else if (index.error) {
    toast(`\`/api/services\` failed: ${index.error.message}`, { tone: "bad" });
    $("map-footer").textContent = "the services payload failed; the story is unaffected";
  } else if (index.value && map) {
    const view = {
      level: "services",
      index: index.value,
      areas: graph.value?.areas ?? [],
      focus,
      all: route.query?.all === "1",
      tests: route.query?.tests === "1",
    };
    try {
      map.show(view, { level: "services", lens: state.lens, repo: route.repo ?? "repo", tests: view.tests, all: view.all });
    } catch (err) {
      console.error("map.show failed", err);
      toast("The map could not draw the services; the story is unaffected.", { tone: "warn" });
    }
  }
  if (focus) await pinServiceSpotlight(focus, route, token);
  return undefined;
}

/**
 * Every declared binding with the line that declares it, in one place (§5 acceptance 1). The story
 * gives a paragraph to the services that carry an operation and collapses the plain vars into a
 * truncated list, so a `[vars]` entry can be declared, drawn on the map, and still never have its
 * line printed in prose. This block is the index that guarantees it: one row per declaration.
 */
function appendDeclaredList(sections, index, route) {
  const declared = (index.services ?? []).filter((s) => s.declared !== false && s.declaredAt?.file);
  if (!declared.length) return;
  const repo = route.repo;
  const byFile = new Map();
  for (const s of declared) {
    if (!byFile.has(s.declaredAt.file)) byFile.set(s.declaredAt.file, []);
    byFile.get(s.declaredAt.file).push(s);
  }
  const rows = [];
  for (const [file, list] of Array.from(byFile.entries()).sort((a, b) => a[0].localeCompare(b[0]))) {
    list.sort((a, b) => (a.declaredAt.line ?? 0) - (b.declaredAt.line ?? 0));
    rows.push(
      h(
        "li",
        { class: "declared__file" },
        entityLink("file", formatRoute({ level: "file", repo, id: file, query: {} }), file, { refs: file }),
        h(
          "ul",
          { class: "declared__list" },
          list.map((s) =>
            h(
              "li",
              { class: "declared__row", dataset: { refs: s.id } },
              entityLink("service", formatRoute({ level: "services", repo, query: { service: s.id } }), s.binding || s.name, { refs: s.id }),
              h("span", { class: "declared__what muted" }, ` ${SERVICE_NOUNS[s.kind] ?? s.kind}${s.name && s.name !== (s.binding || s.name) ? ` ${s.name}` : ""}`),
              h("span", { class: "declared__line" }, `line ${s.declaredAt.line ?? 1}`),
            ),
          ),
        ),
      ),
    );
  }
  const sec = section(
    "declared",
    "Declared in this repo",
    h("p", { class: "para para--fact" }, `${declared.length} binding${declared.length === 1 ? "" : "s"} ${declared.length === 1 ? "is" : "are"} named by a manifest in the repo, with the line that names each one.`),
    h("ul", { class: "declared section__more" }, rows),
  );
  sections.appendChild(sec);
  for (const el of sec.querySelectorAll("[data-refs]")) {
    const refs = el.dataset.refs.split(" ").filter(Boolean);
    el.addEventListener("mouseenter", () => state.map?.highlight?.(refs));
    el.addEventListener("mouseleave", () => state.map?.clearHighlight?.());
  }
}

/** The Spotlight for one service, built from `/api/service?id=` the way `/api/explain` builds one. */
async function pinServiceSpotlight(id, route, token) {
  try {
    const d = await api(withRepo(`/api/service?id=${encodeURIComponent(id)}`));
    if (token != null && token !== state.renderToken) return;
    state.quietSpotlightClose = true;
    try {
      renderSpotlight($("spotlight"), serviceExplain(d, route), spotlightDeps(route));
    } finally {
      state.quietSpotlightClose = false;
    }
    state.map?.select?.(id);
  } catch (err) {
    if (err.status === 404) {
      toast(`No service is called \`${id}\`.`, { tone: "warn" });
      setQuery({ service: null });
      return;
    }
    toast(`\`/api/service\` failed: ${err.message}`, { tone: "warn" });
  }
}

/** `/api/service` payload → the four-sentence Spotlight shape `story.js` renders. */
function serviceExplain(payload, route) {
  const s = payload?.service ?? {};
  const repo = route?.repo ?? state.route?.repo;
  const name = s.binding || s.name || s.id;
  const fileLink = (p) => `[[${formatRoute({ level: "file", repo, id: p, query: {} })}|${p.split("/").pop()}]]`;
  const noun = SERVICE_NOUNS[s.kind] ?? s.kind ?? "service";
  const where = s.declaredAt ? `${s.declaredAt.file} at line ${s.declaredAt.line}` : null;
  const sentences = [];
  const first = s.name && s.name !== name ? `${name} is the ${noun} ${s.name}` : `${name} is a ${noun}`;
  sentences.push({
    text: s.declared === false
      ? `${first}. No manifest in this repo declares it, so its value is set outside the repo${where ? `; the name is written down in ${fileLink(s.declaredAt.file)} at line ${s.declaredAt.line}` : ""}.`
      : `${first}${s.provider ? `, provided by ${s.provider}` : ""}. It is declared in ${where ? `${fileLink(s.declaredAt.file)} at line ${s.declaredAt.line}` : "a manifest"}.`,
    refs: [s.id, s.declaredAt?.file].filter(Boolean),
  });
  const readers = s.readers ?? [];
  const writers = s.writers ?? [];
  const files = s.files ?? [];
  sentences.push({
    text: files.length
      ? `${readers.length ? `${readers.length} file${readers.length === 1 ? "" : "s"} read it (${readers.slice(0, 3).map(fileLink).join(", ")}${readers.length > 3 ? ", …" : ""})` : "Nothing reads it"}; ${writers.length ? `${writers.length} write${writers.length === 1 ? "s" : ""} to it (${writers.slice(0, 3).map(fileLink).join(", ")}${writers.length > 3 ? ", …" : ""})` : "nothing writes to it"}.`
      : "No code outside tests touches it, so it is either dead or reached in a way Reggie cannot see.",
    refs: [s.id, ...files.slice(0, 8)],
  });
  const sites = (payload.callSites ?? []).flatMap((c) => (c.sources ?? []).map((r) => `${r.file}:${r.line}`));
  sentences.push({
    text: sites.length
      ? `${s.uses ?? sites.length} call site${(s.uses ?? sites.length) === 1 ? "" : "s"}, the first at \`${sites[0]}\`${payload.children?.length ? `. It holds ${payload.children.length} table${payload.children.length === 1 ? "" : "s"}: ${payload.children.map((c) => `[[${formatRoute({ level: "services", repo, query: { service: c.id } })}|${c.binding || c.name}]]`).join(", ")}` : ""}.`
      : "Nothing in the code names it.",
    refs: [s.id],
  });
  const flows = payload.flows ?? [];
  const tasks = payload.tasks ?? [];
  const bits = [];
  if (flows.length) bits.push(`${flows.length} flow${flows.length === 1 ? "" : "s"} reach it: ${flows.map((f) => `[[${formatRoute({ level: "flow", repo, id: f.id, query: {} })}|${f.title}]]`).join(", ")}`);
  if (tasks.length) bits.push(`${tasks.length} task${tasks.length === 1 ? "" : "s"} plan to touch its files: ${tasks.map((t) => `[[${formatRoute({ level: "task", repo, id: t.slug, query: {} })}|${t.slug}]]`).join(", ")}`);
  if ((s.notes ?? 0) > 0) bits.push(`${s.notes} note${s.notes === 1 ? "" : "s"} in the notebook`);
  sentences.push({ text: bits.length ? `${bits.join(". ")}.` : "No flow reaches it, no task names it and nobody has written about it.", refs: [s.id] });

  const actions = [];
  if (s.declaredAt?.file) actions.push({ label: `Open ${s.declaredAt.file}`, route: formatRoute({ level: "file", repo, id: s.declaredAt.file, query: {} }) });
  if (flows.length) actions.push({ label: `Trace ${flows[0].title}`, route: formatRoute({ level: "flow", repo, id: flows[0].id, query: {} }) });
  else if (files.length) actions.push({ label: `Open ${files[0].split("/").pop()}`, route: formatRoute({ level: "file", repo, id: files[0], query: {} }) });
  return {
    id: s.id,
    kind: "service",
    title: name,
    crumbs: [{ label: "Services", route: formatRoute({ level: "services", repo, query: {} }) }, { label: noun, route: formatRoute({ level: "services", repo, query: { service: s.id } }) }],
    route: null,
    sentences,
    actions,
  };
}

/** The Data flow index (§4): entry points grouped by kind, each with route, step count and services. */
async function renderFlowsLevel(route, token) {
  const sections = $("sections");
  const mapCol = $("map-col");
  const map = ensureMap();
  if (state.rendererOk) mapCol?.classList.add("is-loading");
  const [flows, index, reachability] = await Promise.all([
    settle(api(withRepo("/api/flows"))),
    settle(api(withRepo("/api/services"))),
    settle(api(withRepo("/api/reachability"))),
  ]);
  if (token !== state.renderToken) return;
  renderCrumbs(crumbsFor(route));
  state.story = null;
  if (flows.error) {
    mount(sections, errorCard("/api/flows", flows.error.message, () => render(route)));
    mapCol?.classList.remove("is-loading");
    return;
  }
  const list = flows.value?.flows ?? [];
  const svcById = new Map((index.value?.services ?? []).map((s) => [s.id, s]));
  const repo = route.repo;
  const serviceLink = (id) => {
    const s = svcById.get(id);
    return entityLink("service", formatRoute({ level: "services", repo, query: { service: id } }), s ? s.binding || s.name : id.replace(/^svc:[^:]+:/, ""), { refs: id });
  };
  const nodes = [];
  nodes.push(
    h(
      "p",
      { class: "story__subtitle muted" },
      list.length
        ? `Data enters this repo at ${list.length} ${list.length === 1 ? "entry point" : "entry points"}. Each one is traced to the services it reaches, with source-backed values on every step.`
        : "Nothing in this repo answers a request, runs a command or registers a tool, so there is no flow to trace.",
    ),
  );
  const seen = new Set();
  for (const [kind, heading] of FLOW_KIND_HEADINGS) {
    const group = list.filter((f) => f.kind === kind);
    for (const f of group) seen.add(f.id);
    if (!group.length) continue;
    nodes.push(section(`flows-${kind}`, heading, ...group.map((f, i) => flowRow(f, repo, serviceLink, i))));
  }
  const rest = list.filter((f) => !seen.has(f.id));
  if (rest.length) nodes.push(section("flows-other", "Other entry points", ...rest.map((f, i) => flowRow(f, repo, serviceLink, i))));
  if (reachability.value) nodes.push(cleanupOverview(reachability.value, repo));
  else if (reachability.error) nodes.push(section("possible-cleanup", "Possible cleanup", errorCard("/api/reachability", reachability.error.message, () => render(route))));
  if (!list.length) {
    nodes.push(
      section(
        "flows-empty",
        "Entry points",
        h(
          "div",
          { class: "card card--empty empty" },
          h("p", { class: "empty__text" }, "No entry point was found in this repo."),
          h("p", { class: "empty__hint" }, "A Cloudflare handler, an Express or Hono route, a Next route or page, a CLI command or an MCP tool registration is what starts a flow."),
        ),
      ),
    );
  }
  mount(sections, nodes);
  sections.classList.remove("is-skeleton");

  mapCol?.classList.remove("is-loading");
  if (!state.rendererOk) {
    $("map-footer").textContent = "map unavailable";
  } else if (map) {
    try {
      map.show({ level: "flows", flows: list, services: index.value?.services ?? [] }, { level: "flows", lens: state.lens, repo: route.repo ?? "repo" });
    } catch (err) {
      console.error("map.show failed", err);
      toast("The map could not draw the entry points; the list is unaffected.", { tone: "warn" });
    }
  }
  return undefined;
}

const CLEANUP_ROLES = [
  ["production", "Production"],
  ["test", "Tests"],
  ["script", "Scripts"],
  ["migration", "Migrations"],
  ["generated", "Generated code"],
];

function cleanupEntityList(items, repo) {
  if (!items.length) return h("p", { class: "empty__hint" }, "None in this evidence category.");
  return h(
    "ul",
    { class: "entity-list cleanup-list" },
    items.map((id) => h(
      "li",
      {},
      entityLink(id.startsWith("sym:") ? "symbol" : "file", routeForNode(repo, id), id.startsWith("sym:") ? id.slice(id.lastIndexOf("::") + 2) : id, { refs: id }),
      id.startsWith("sym:") ? h("span", { class: "muted" }, ` · ${id.slice(4, id.lastIndexOf("::"))}`) : null,
    )),
  );
}

/** Role-aware review queue. Reachability and reference evidence stay separate and never become a delete claim. */
export function cleanupOverview(reachability, repo) {
  const noReferenceFiles = new Set(reachability?.noReferences?.files ?? []);
  const noReferenceSymbols = new Set(reachability?.noReferences?.symbols ?? []);
  const groups = [];
  for (const [role, label] of CLEANUP_ROLES) {
    const facts = reachability?.byRole?.[role] ?? {};
    const roleFiles = new Set([...(facts.reachableFiles ?? []), ...(facts.notReachableFiles ?? [])]);
    const roleSymbols = new Set([...(facts.reachableSymbols ?? []), ...(facts.notReachableSymbols ?? [])]);
    const notReachable = [...(facts.notReachableFiles ?? []), ...(facts.notReachableSymbols ?? [])];
    const noReferences = [...noReferenceFiles].filter((id) => roleFiles.has(id)).concat([...noReferenceSymbols].filter((id) => roleSymbols.has(id)));
    if (!notReachable.length && !noReferences.length) continue;
    groups.push(h(
      "details",
      { class: "cleanup-role" },
      h("summary", {}, `${label} · ${notReachable.length} not reachable · ${noReferences.length} with no references`),
      h("h4", { class: "flow-step__subheading" }, "Not reachable from a role-specific root"),
      cleanupEntityList(notReachable, repo),
      h("h4", { class: "flow-step__subheading" }, "No references found"),
      cleanupEntityList(noReferences, repo),
    ));
  }
  return section(
    "possible-cleanup",
    "Possible cleanup",
    h("p", { class: "para para--gap cleanup-warning" }, "These are review leads, not deletion instructions. Neither result proves that removal is safe."),
    ...groups,
    h(
      "details",
      { class: "cleanup-limitations" },
      h("summary", {}, "Analyzer limitations"),
      h("ul", { class: "fact-list" }, (reachability?.limitations ?? []).map((text) => h("li", {}, text))),
    ),
  );
}

/** One entry point in the index: its title, where it is, how far it goes and what it reaches. */
function flowRow(f, repo, serviceLink, i) {
  const to = formatRoute({ level: "flow", repo, id: f.id, query: {} });
  const chips = [
    f.method ? chip("Method", f.method, { tone: "info" }) : null,
    chip("Steps", String(f.steps), { tone: f.truncated ? "warn" : "muted" }),
    chip("Hops", String(f.depth), { tone: "muted" }),
    f.truncated ? chip("Capped", "yes", { tone: "warn", tip: "A cap hid some steps; the flow page says which" }) : null,
  ].filter(Boolean);
  const row = h(
    "div",
    { class: `card card--flow${i > 0 ? " section__more" : ""}`, dataset: { refs: `flow:${f.id}` } },
    h(
      "div",
      { class: "card__head" },
      h("a", { class: "card__title link link--flow", href: to }, icon("flow"), h("span", {}, f.title)),
      f.route ? h("code", { class: "flow-row__route" }, f.route) : null,
    ),
    h("div", { class: "card__chips chips" }, chips),
    h(
      "div",
      { class: "card__body flow-row__body" },
      h("span", { class: "muted" }, "Starts in "),
      entityLink("file", formatRoute({ level: "file", repo, id: f.source?.file ?? "", query: {} }), `${f.source?.file ?? "?"}:${f.source?.line ?? 1}`, { refs: f.source?.file }),
      f.services?.length
        ? h("span", {}, h("span", { class: "muted" }, " · reaches "), ...f.services.flatMap((id, n) => (n > 0 ? [document.createTextNode(", "), serviceLink(id)] : [serviceLink(id)])))
        : h("span", { class: "muted" }, " · reaches no service"),
    ),
  );
  wireRowRefs(row, [`flow:${f.id}`, ...(f.services ?? [])]);
  return row;
}

/** Hover a row → light its node and the services it reaches on the map beside it. */
function wireRowRefs(el, refs) {
  const list = refs.filter(Boolean);
  el.dataset.refs = list.join(" ");
  el.addEventListener("mouseenter", () => state.map?.highlight?.(list));
  el.addEventListener("mouseleave", () => state.map?.clearHighlight?.());
}

/** One flow (§4): the story walks it, the map draws it, and a cap that hid steps says so in words. */
async function renderFlowLevel(route, token) {
  const sections = $("sections");
  const mapCol = $("map-col");
  const map = ensureMap();
  const depth = flowDepth(route);
  const q = `id=${encodeURIComponent(route.id)}${depth !== 6 ? `&depth=${depth}` : ""}`;
  if (state.rendererOk) mapCol?.classList.add("is-loading");
  const [story, flow, index] = await Promise.all([
    settle(api(withRepo(`/api/story?${storyParams(route)}`))),
    settle(api(withRepo(`/api/flow?${q}`))),
    settle(api(withRepo("/api/services"))),
  ]);
  if (token !== state.renderToken) return;

  if (story.error) {
    state.story = null;
    mount(sections, errorCard("/api/story", story.error.message, () => render(route)));
  } else if (story.value) {
    state.story = story.value;
    renderCrumbs(story.value.crumbs?.length ? story.value.crumbs : crumbsFor(route));
    renderStory(sections, story.value, storyDeps(route));
  }
  // A flow that lost steps to a cap says so at the top, in words, with what was lost: a partial
  // picture presented as a whole one is exactly the confident wrong answer this page exists against.
  const dropped = droppedSentence(flow.value);
  if (dropped && !story.error) {
    sections.prepend(
      h(
        "div",
        { class: "card card--error card--capped", role: "status" },
        h("div", { class: "card__head" }, h("strong", {}, "Not every step is drawn")),
        h("div", { class: "card__body" }, dropped),
      ),
    );
  }

  mapCol?.classList.remove("is-loading");
  if (!state.rendererOk) {
    $("map-footer").textContent = "map unavailable";
  } else if (flow.error) {
    toast(`\`/api/flow\` failed: ${flow.error.message}`, { tone: "bad" });
    $("map-footer").textContent = "the flow payload failed; the story is unaffected";
  } else if (flow.value && map) {
    try {
      map.show({ level: "flow", flow: flow.value, services: index.value?.services ?? [] }, { level: "flow", lens: state.lens, repo: route.repo ?? "repo", depth });
    } catch (err) {
      console.error("map.show failed", err);
      toast("The map could not draw this flow; the story is unaffected.", { tone: "warn" });
    }
  }
  return undefined;
}

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
    // ?view=completed selects the Completed view on load, so a link to finished work carries it.
    { tasks: tasks.value ?? [], stateMachine: sm.value, people: people.value ?? null, mode: sm.value?.mode ?? "solo", view: route.query?.view === "completed" ? "completed" : "open" },
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
    } else if (ev.key === "s" || ev.key === "S") {
      togglePane("story");
    } else if (ev.key === "m" || ev.key === "M") {
      togglePane("map");
    } else if (ev.key === "c" || ev.key === "C") {
      togglePane("code");
    } else if (ev.key === "[") {
      setAllSections(true);
    } else if (ev.key === "]") {
      setAllSections(false);
    } else if (LENS_KEYS[ev.key]) {
      // A lens the current level has switched off (see `syncGraphChrome`) is off for the keyboard
      // too, or `4` would leave the Heat button lit over a map that does not draw heat.
      if ($(`lens-${LENS_KEYS[ev.key]}`)?.disabled) return;
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
  adoptKeyFromUrl();
  checkRenderer();
  wireHeader();
  wireSections();
  wirePalette();
  wireKeyboard();
  storage.remove("reggie.dense"); // Dense mode retired 2026-09-14; the pane toggles replace it
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
