// Reggie Guidebook — board.js
// Owns the task board (spec §3.6) and the task page (spec §3.7).
//
//   renderBoard(storyEl, mapEl, { tasks, stateMachine, people, mode }, deps)
//   renderTaskPage(storyEl, mapEl, { ...GET /api/task/<slug>, view: GET /api/impact?slug= }, deps)
//   unmountBoard(mapEl)
//
// deps (all optional): { repo, post(url, body), fetchJson(url), map, onDecide, onCapture, depth, show, syncQuery, tasksUrl }
//   - post / fetchJson default to app.js `post` / `api` (same-origin, ?repo= added in workspace mode).
//   - map defaults to app.js `state.map`; the blast radius calls map.show(view, { level: "impact", lens: "structure" }).
// Shapes follow docs/ui-api-contract.md; behaviour follows docs/ui-spec.md; DOM names follow ui/DOM-CONTRACT.md.

import {
  h,
  mount,
  icon,
  entityLink,
  chip,
  stateChip,
  toast,
  formatRoute,
  routeForNode,
  kindForRoute,
  GLOSSARY,
  STATE_LABELS,
  api,
  post,
  withRepo,
  state as appState,
  on,
  setQuery,
  storage,
  section,
} from "./app.js";

// ---------------------------------------------------------------------------
// Constants (spec §5.1, §6.8)
// ---------------------------------------------------------------------------

export const STATE_ORDER = ["ungroomed", "grooming", "groomed", "in-process", "awaiting-decision", "done"];

const STATE_COLORS = {
  ungroomed: "#5c6478",
  grooming: "#8b93a7",
  groomed: "#7dcfff",
  "in-process": "#7aa2f7",
  "awaiting-decision": "#e0af68",
  done: "#9ece6a",
};

/** People palette (spec §5.1): six colours by order in /api/people, then grey. */
export const PEOPLE_PALETTE = ["#7aa2f7", "#c792ea", "#ffcb6b", "#89ddff", "#f78c6c", "#c3e88d"];
// #6b7280 passed neither the light nor the dark label (3.95:1 / 3.91:1) and the avatar prints an
// initial on it; #9ca3af takes --bg at 7.42:1, matching --person-other in styles.css.
const PEOPLE_OTHER = "#9ca3af";

/** Used only when /api/state-machine is unavailable; mirrors tasks.ts STATE_MACHINE (spec §6.8). */
const FALLBACK_STATES = [
  { id: "ungroomed", label: "Ungroomed", definition: "An intake line or task folder with no plan yet.", rule: "intake line or task folder, no plan" },
  { id: "grooming", label: "Grooming", definition: "A plan exists but does not pass the contract or is not merged yet.", rule: "plan on disk failing the contract or a plan/<slug> branch" },
  { id: "groomed", label: "Groomed", definition: "The plan is merged to the default branch.", rule: "plan merged to the default branch (solo: passing plan on disk)" },
  { id: "in-process", label: "In process", definition: "Someone is working on a task/<slug> branch.", rule: "task/<slug> branch with commits" },
  { id: "awaiting-decision", label: "Awaiting decision", definition: "The work is finished and waits for a maintainer.", rule: "open PR or packet on the branch" },
  { id: "done", label: "Done", definition: "The change is on the default branch.", rule: "PR merged or packet approved on the default branch" },
];
const FALLBACK_TRANSITIONS = [
  { from: "ungroomed", to: "grooming", trigger: "a plan is written", who: "anyone" },
  { from: "grooming", to: "groomed", trigger: "the plan passes the contract and is merged", who: "a maintainer" },
  { from: "groomed", to: "in-process", trigger: "reggie claim creates task/<slug> and commits land", who: "the owner" },
  { from: "in-process", to: "awaiting-decision", trigger: "a PR opens or a packet is written on the branch", who: "the owner" },
  { from: "awaiting-decision", to: "done", trigger: "the PR merges or the packet is approved", who: "a maintainer" },
  { from: "awaiting-decision", to: "in-process", trigger: "needs work", who: "a maintainer" },
];

/**
 * The board column sublabel: the state's rule in **one rendered line**. The server's `definition` is
 * prose ("A pull request is open or a completion packet sits on the branch, waiting for a verdict.")
 * and ran four to six lines in a 150px column. A first pass shortened it to a sentence, which still
 * wrapped to two lines in five of the six columns; a column head that is three stacked lines pushes
 * every card down and makes the row of heads look ragged. Each string below measures under 132px in
 * the 11px column font, so it fits the ~152px sublabel at 1600px and still fits a 156px column.
 * Nothing is lost: `.board__def` carries the server's prose as its `title`, and the header tooltip
 * carries the full git rule. The story column no longer repeats any of it.
 */
const COLUMN_RULE = {
  ungroomed: "No plan.md yet.",
  grooming: "plan.md, not merged yet.",
  groomed: "plan.md merged.",
  "in-process": "task/<slug> open, no PR.",
  "awaiting-decision": "PR open, or a packet.md.",
  done: "PR merged, or approved.",
};

const COLUMN_EMPTY = {
  ungroomed: "Nothing captured. Capture one below.",
  grooming: "No plan being written. Start one with reggie plan <slug>.",
  groomed: "No plan waiting. Merge a plan to fill this.",
  "in-process": "No branch open. Claim a groomed task with reggie claim <slug>.",
  "awaiting-decision": "Nothing to decide. Open a PR, or write reggie packet <slug>.",
  done: "Nothing finished yet. Approve a packet or merge a PR.",
};

const EMPTY_BOARD_TEXT =
  "Nothing has been captured yet. A task starts as one line in `.reggie/intake.md`; a plan makes it groomed; a `task/<slug>` branch means in process; an open PR means awaiting decision; a merge means done. Capture one below.";

const RISK_TIPS = {
  low: "Risk: low — no touched path matches a risk rule.",
  medium: "Risk: medium — a touched path matches a medium-risk rule in config.yaml.",
  high: "Risk: high — a touched path matches a high-risk rule in config.yaml (auth, tokens, payments, migrations…).",
  unset: "Risk: unset — the plan has no risk class yet.",
};
const RISK_TONE = { low: "ok", medium: "warn", high: "bad", unset: "muted" };
const OP_TIPS = { NEW: "NEW: the plan creates this file", MOD: "MOD: the plan changes this file", DEL: "DEL: the plan deletes this file" };
const VERDICT_TONE = { pending: "warn", approved: "ok", "needs-work": "bad" };
const VERDICT_LABEL = { pending: "Pending", approved: "Approved", "needs-work": "Needs work" };
const PACKET_SECTIONS = ["Changes", "Reviews", "Deviations from plan", "Discovered issues", "Open risks"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DONE_OPEN_KEY = "reggie.board.doneOpen";

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

/** "just now", "5 min ago", "3 hours ago", "2 days ago", "3 weeks ago", "2 months ago", "a year ago". */
export function relTime(input, now = Date.now()) {
  if (input === null || input === undefined || input === "") return null;
  const t = typeof input === "number" ? input : parseDate(input);
  if (t === null) return null;
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 45) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const hr = Math.round(m / 60);
  if (hr < 24) return hr === 1 ? "an hour ago" : `${hr} hours ago`;
  const d = Math.round(hr / 24);
  if (d < 14) return d === 1 ? "yesterday" : `${d} days ago`;
  if (d < 60) return `${Math.round(d / 7)} weeks ago`;
  if (d < 365) {
    const mo = Math.round(d / 30);
    return mo <= 1 ? "a month ago" : `${mo} months ago`;
  }
  const y = Math.round(d / 365);
  return y <= 1 ? "a year ago" : `${y} years ago`;
}

/** Age in days → "today", "1 day", "12 days". */
export function ageText(days) {
  if (days === null || days === undefined || Number.isNaN(Number(days))) return null;
  const n = Math.max(0, Math.round(Number(days)));
  if (n === 0) return "today";
  return n === 1 ? "1 day" : `${n} days`;
}

function parseDate(input) {
  const s = String(input).trim();
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getTime();
  const t = Date.parse(s);
  return Number.isNaN(t) ? null : t;
}

/** "6 Sep" in the current year, "6 Sep 2025" otherwise (spec §6.6). */
export function fmtDate(input) {
  if (!input) return "";
  const t = parseDate(input);
  if (t === null) return String(input);
  const d = new Date(t);
  const now = new Date();
  const base = `${d.getDate()} ${MONTHS[d.getMonth()]}`;
  return d.getFullYear() === now.getFullYear() ? base : `${base} ${d.getFullYear()}`;
}

function firstSentence(text) {
  const s = String(text ?? "").replace(/\s+/g, " ").trim();
  if (!s) return "";
  const m = /^(.+?[.!?])(\s|$)/.exec(s);
  return m ? m[1] : s;
}

/** "smooth" unless the reader asked for less motion (§5.6); scrollIntoView ignores the CSS override. */
function scrollBehavior() {
  return typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";
}

function basename(p) {
  const parts = String(p).split("/").filter(Boolean);
  return parts[parts.length - 1] ?? String(p);
}

function cap(s) {
  const t = String(s ?? "");
  return t ? t[0].toUpperCase() + t.slice(1) : t;
}

function stateLabel(id, sm) {
  return sm?.byId?.get(id)?.label ?? STATE_LABELS[id] ?? id;
}

function stateDefinition(id, sm) {
  return sm?.byId?.get(id)?.definition ?? GLOSSARY[id] ?? "";
}

/** Parse the "(person, source, date)" group behind an intake line. */
function intakeMeta(meta) {
  const parts = String(meta ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return { person: parts[0] ?? null, source: parts[1] ?? null, date: parts[2] ?? null };
}

function taskRoute(repo, slug) {
  return formatRoute({ level: "task", repo, id: slug, query: {} });
}

function fileRoute(repo, id) {
  return routeForNode(repo, id);
}

/**
 * The one handle that owns every owned task, or null when ownership is shared (or nobody owns
 * anything). On a single-author repo the owner is the same word on every card, which is noise: say it
 * once above the board instead and let the cards carry only what differs.
 */
export function soleOwner(tasks) {
  const owners = new Set((tasks ?? []).map((t) => t?.owner).filter(Boolean));
  return owners.size === 1 ? [...owners][0] : null;
}

function personRoute(repo, handle) {
  return routeForNode(repo, `person:${handle}`);
}

function withRepoOnce(url) {
  return /[?&]repo=/.test(url) ? url : withRepo(url);
}

/** Resolve deps against app.js defaults. */
function makeCtx(data, deps = {}) {
  const repo = deps.repo ?? appState.route?.repo ?? appState.facts?.facts?.name ?? data?.repo ?? null;
  return {
    repo,
    deps,
    post: deps.post ?? ((url, body) => post(withRepoOnce(url), body)),
    fetchJson: deps.fetchJson ?? ((url) => api(withRepoOnce(url), { fresh: true })),
    map: deps.map ?? appState.map ?? null,
  };
}

/** The container that receives story content: #sections inside a story column, else the element itself. */
function storyTarget(storyEl) {
  if (!storyEl) return null;
  const spot = storyEl.querySelector?.("#spotlight");
  if (spot) spot.replaceChildren();
  return storyEl.querySelector?.("#sections") ?? storyEl;
}

function stageOf(mapEl) {
  if (!mapEl) return null;
  if (mapEl.id === "map-stage") return mapEl;
  return mapEl.querySelector?.("#map-stage") ?? mapEl;
}

// ---------------------------------------------------------------------------
// People palette, avatars
// ---------------------------------------------------------------------------

function peopleList(people) {
  if (Array.isArray(people)) return people;
  return Array.isArray(people?.people) ? people.people : [];
}

export function personColor(handle, people) {
  const list = peopleList(people);
  const i = list.findIndex((p) => p.handle === handle || p.name === handle || p.email === handle);
  return i >= 0 && i < PEOPLE_PALETTE.length ? PEOPLE_PALETTE[i] : PEOPLE_OTHER;
}

function personName(handle, people) {
  const p = peopleList(people).find((x) => x.handle === handle);
  return p?.name && p.name !== handle ? p.name : null;
}

export function avatar(handle, people, opts = {}) {
  if (!handle) {
    return h("span", { class: "avatar avatar--none", title: opts.title ?? "No owner yet", "aria-label": "No owner" }, "·");
  }
  const name = personName(handle, people);
  const label = name ? `${name} (${handle})` : handle;
  const initial = String(handle).replace(/^[^a-z0-9]+/i, "").charAt(0).toUpperCase() || "?";
  return h("span", { class: "avatar", style: { background: personColor(handle, people) }, title: opts.title ?? `Owner: ${label}`, "aria-label": `Owner ${label}` }, initial);
}

// ---------------------------------------------------------------------------
// Prose: minimal Markdown → DOM (paragraphs, bullets, fences, `code`, **bold**, [[route|label]])
// ---------------------------------------------------------------------------

function looksLikePath(s) {
  if (!/^[\w@.-]+(\/[\w@.-]+)+$/.test(s)) return false;
  if (s.startsWith(".reggie/") || s.startsWith("evidence/")) return false;
  return true;
}

function codeOrLink(text, ctx) {
  const t = text.trim();
  if (ctx?.repo && (looksLikePath(t) || ctx.files?.has(t))) return entityLink("file", fileRoute(ctx.repo, t), t, { refs: t });
  return h("code", {}, text);
}

/** Inline markup for one line of prose. */
export function inline(text, ctx = {}) {
  const frag = document.createDocumentFragment();
  const s = String(text ?? "");
  const re = /`([^`]+)`|\[\[([^\]|]+)\|([^\]|]*)(?:\|([a-z-]+))?\]\]|\*\*([^*]+)\*\*/g;
  let last = 0;
  for (const m of s.matchAll(re)) {
    if (m.index > last) frag.appendChild(document.createTextNode(s.slice(last, m.index)));
    if (m[1] !== undefined) frag.appendChild(codeOrLink(m[1], ctx));
    else if (m[2] !== undefined) frag.appendChild(entityLink(m[4] || kindForRoute(m[2]), m[2].trim(), m[3] || m[2].trim()));
    else if (m[5] !== undefined) frag.appendChild(h("strong", {}, m[5]));
    last = m.index + m[0].length;
  }
  if (last < s.length) frag.appendChild(document.createTextNode(s.slice(last)));
  return frag;
}

/** Block-level prose. Returns an element with class .prose (or null when the text is blank). */
export function prose(text, ctx = {}) {
  const src = String(text ?? "").replace(/\r\n/g, "\n").trim();
  if (!src) return null;
  const out = h("div", { class: "prose" });
  const lines = src.split("\n");
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (line.trim() === "") {
      i += 1;
      continue;
    }
    if (/^\s*```/.test(line)) {
      const buf = [];
      i += 1;
      while (i < lines.length && !/^\s*```/.test(lines[i])) {
        buf.push(lines[i]);
        i += 1;
      }
      i += 1;
      out.appendChild(h("pre", { class: "prose__pre" }, buf.join("\n")));
      continue;
    }
    if (/^\s*[-*+]\s+/.test(line) || /^\s*\d+[.)]\s+/.test(line)) {
      const ordered = /^\s*\d+[.)]\s+/.test(line);
      const list = h(ordered ? "ol" : "ul", { class: "prose__list" });
      while (i < lines.length && (/^\s*[-*+]\s+/.test(lines[i]) || /^\s*\d+[.)]\s+/.test(lines[i]))) {
        const item = lines[i].replace(/^\s*(?:[-*+]|\d+[.)])\s+/, "");
        const m = /^\[([ xX])\]\s+(.*)$/.exec(item);
        if (m) {
          list.appendChild(h("li", { class: "prose__check" }, h("input", { type: "checkbox", disabled: true, checked: m[1] !== " " ? true : null, "aria-label": m[2] }), " ", inline(m[2], ctx)));
        } else {
          list.appendChild(h("li", {}, inline(item, ctx)));
        }
        i += 1;
        // continuation lines indented under the bullet
        while (i < lines.length && /^\s{2,}\S/.test(lines[i]) && !/^\s*[-*+]\s+/.test(lines[i])) {
          list.lastChild.appendChild(document.createTextNode(" "));
          list.lastChild.appendChild(inline(lines[i].trim(), ctx));
          i += 1;
        }
      }
      out.appendChild(list);
      continue;
    }
    if (/^\s*#{1,6}\s+/.test(line)) {
      out.appendChild(h("h4", { class: "prose__h" }, inline(line.replace(/^\s*#{1,6}\s+/, ""), ctx)));
      i += 1;
      continue;
    }
    const buf = [];
    while (i < lines.length && lines[i].trim() !== "" && !/^\s*[-*+]\s+/.test(lines[i]) && !/^\s*```/.test(lines[i]) && !/^\s*#{1,6}\s+/.test(lines[i])) {
      buf.push(lines[i].trim());
      i += 1;
    }
    out.appendChild(h("p", { class: "prose__p" }, inline(buf.join(" "), ctx)));
  }
  return out;
}

// ---------------------------------------------------------------------------
// State machine normalisation
// ---------------------------------------------------------------------------

function normalizeStateMachine(sm, tasks) {
  const states = Array.isArray(sm?.states) && sm.states.length > 0 ? sm.states : FALLBACK_STATES;
  const ordered = [...states].sort((a, b) => idx(a.id) - idx(b.id));
  const transitions = Array.isArray(sm?.transitions) && sm.transitions.length > 0 ? sm.transitions : FALLBACK_TRANSITIONS;
  const counts = {};
  for (const s of ordered) counts[s.id] = 0;
  for (const t of tasks ?? []) if (t?.state in counts) counts[t.state] += 1;
  const serverCounts = sm?.counts ?? {};
  for (const s of ordered) {
    // /api/tasks without all=1 omits done tasks; trust the server count when the list has none.
    if (counts[s.id] === 0 && Number(serverCounts[s.id]) > 0) counts[s.id] = Number(serverCounts[s.id]);
  }
  return { states: ordered, transitions, counts, byId: new Map(ordered.map((s) => [s.id, s])), mode: sm?.mode ?? null };
}

function idx(stateId) {
  const i = STATE_ORDER.indexOf(stateId);
  return i < 0 ? STATE_ORDER.length : i;
}

/** Who may decide: solo mode → everyone; team mode → maintainers only (spec §3.6). */
function decisionRights(people, mode) {
  const list = peopleList(people);
  const current = people?.current ?? null;
  const maintainers = list.filter((p) => p.role === "maintainer").map((p) => p.handle);
  const me = current ? list.find((p) => p.handle === current) : null;
  // Team mode: only maintainers decide. When the current person is unknown the server enforces it (403).
  const canDecide = mode !== "team" || !current || (me ? me.role === "maintainer" : false);
  return { canDecide, maintainers, current };
}

function whoCanDecideText(rights) {
  if (rights.maintainers.length === 0) return "A maintainer decides this one; nobody is listed as a maintainer in people.yaml yet.";
  if (rights.maintainers.length === 1) return `Only ${rights.maintainers[0]} can decide this.`;
  const list = rights.maintainers.slice();
  const last = list.pop();
  return `Only ${list.join(", ")} or ${last} can decide this.`;
}

// ---------------------------------------------------------------------------
// Forms: decide, capture
// ---------------------------------------------------------------------------

function friendlyError(err) {
  const status = err?.status;
  if (status === 409) return "No completion packet exists for this task yet, so there is nothing to decide.";
  if (status === 403) return "The server refused this decision: only a maintainer may decide in team mode, and only from this machine.";
  if (status === 413) return "The comment is too long for the server.";
  return err?.message ? String(err.message) : "The request failed.";
}

/** Approve / Needs work + comment → POST /api/decide. */
export function decideForm(ctx, slug, opts = {}) {
  const ta = h("textarea", {
    class: "form__textarea",
    rows: "2",
    placeholder: opts.placeholder ?? "Comment — required for Needs work",
    "aria-label": `Decision comment for ${slug}`,
  });
  const err = h("div", { class: "form__error", role: "alert" });
  const approve = h("button", { class: "btn btn--ok", type: "button", "aria-label": `Approve ${slug}` }, "Approve");
  const needs = h("button", { class: "btn btn--warn", type: "button", "aria-label": `Send ${slug} back: needs work` }, "Needs work");
  const buttons = [approve, needs];
  const busy = (on) => buttons.forEach((b) => (b.disabled = on));

  async function submit(verdict) {
    err.textContent = "";
    const comment = ta.value.trim();
    if (verdict === "needs-work" && !comment) {
      err.textContent = "Say what needs work before sending it back.";
      ta.focus();
      return;
    }
    busy(true);
    try {
      const body = { slug, verdict };
      if (comment) body.comment = comment;
      const res = await ctx.post("/api/decide", body);
      toast(verdict === "approved" ? `Approved \`${slug}\`` : `Sent \`${slug}\` back for more work`, { tone: verdict === "approved" ? "ok" : "warn" });
      try {
        ctx.deps?.onDecide?.(slug, verdict, res);
      } catch (e) {
        console.error(e);
      }
      opts.onDone?.(verdict, res);
    } catch (e) {
      // The inline message is easy to miss under the fold of a long packet section, and a decision
      // that did not land is exactly the thing the reader must not walk away believing (F1).
      const text = friendlyError(e);
      err.textContent = text;
      toast(`Could not record the decision on \`${slug}\`: ${text}`, { tone: "bad" });
      busy(false);
    }
  }
  approve.addEventListener("click", () => submit("approved"));
  needs.addEventListener("click", () => submit("needs-work"));
  return h("form", { class: "form form--decide", on: { submit: (ev) => ev.preventDefault() } }, ta, err, h("div", { class: "form__actions" }, approve, needs));
}

/** Text + optional detail → POST /api/capture, then toast "Captured as `slug`". */
export function captureForm(ctx, opts = {}) {
  const input = h("input", {
    class: "form__input",
    type: "text",
    placeholder: opts.placeholder ?? "One line: what should change, and why",
    "aria-label": "Capture text",
    autocomplete: "off",
  });
  const detail = h("textarea", { class: "form__textarea", rows: "2", placeholder: "Optional detail", "aria-label": "Capture detail" });
  const err = h("div", { class: "form__error", role: "alert" });
  const submit = h("button", { class: "btn btn--primary", type: "submit", "aria-label": "Capture" }, "Capture");
  const form = h(
    "form",
    {
      class: "form form--capture",
      on: {
        submit: async (ev) => {
          ev.preventDefault();
          err.textContent = "";
          const text = input.value.trim();
          if (!text) {
            err.textContent = "Write one line first.";
            input.focus();
            return;
          }
          const extra = detail.value.trim();
          submit.disabled = true;
          try {
            const body = { text };
            if (extra) body.detail = extra;
            const res = await ctx.post("/api/capture", body);
            toast(`Captured as \`${res?.slug ?? text}\``, { tone: "ok" });
            input.value = "";
            detail.value = "";
            try {
              ctx.deps?.onCapture?.(res, body);
            } catch (e) {
              console.error(e);
            }
            opts.onCaptured?.(res, body);
          } catch (e) {
            err.textContent = friendlyError(e);
          } finally {
            submit.disabled = false;
          }
        },
      },
    },
    input,
    detail,
    err,
    h("div", { class: "form__actions" }, submit, h("span", { class: "hint" }, "Or from a terminal: ", h("code", {}, 'reggie capture "…"'))),
  );
  return form;
}

// ---------------------------------------------------------------------------
// State-machine strip (inline SVG)
// ---------------------------------------------------------------------------

const SVG_NS = "http://www.w3.org/2000/svg";

function svg(tag, attrs = {}, ...children) {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined || v === false) continue;
    el.setAttribute(k, String(v));
  }
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    el.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
  }
  return el;
}

/** Six pills joined by arrows; counts in each pill; the derivation rule as tooltip on each arrow (spec §3.6). */
export function stateStrip(sm, counts, opts = {}) {
  const states = sm.states;
  const W = 120;
  const H = 40;
  const GAP = 28;
  const X0 = 6;
  const Y0 = 6;
  const n = states.length;
  const totalW = X0 * 2 + n * W + (n - 1) * GAP;
  const totalH = Y0 + H + 30;
  const root = svg("svg", {
    class: "strip__svg",
    viewBox: `0 0 ${totalW} ${totalH}`,
    preserveAspectRatio: "xMinYMid meet",
    role: "img",
    "aria-label": `State machine: ${states.map((s) => `${s.label} ${counts[s.id] ?? 0}`).join(" → ")}`,
  });
  const defs = svg("defs");
  const marker = svg("marker", { id: "strip-arrow", viewBox: "0 0 10 10", refX: "9", refY: "5", markerWidth: "7", markerHeight: "7", orient: "auto-start-reverse" });
  marker.appendChild(svg("path", { d: "M0 0 L10 5 L0 10 z", fill: "#3b4252" }));
  defs.appendChild(marker);
  root.appendChild(defs);

  const xOf = (i) => X0 + i * (W + GAP);
  const byId = new Map(states.map((s, i) => [s.id, i]));

  // pills
  states.forEach((s, i) => {
    const x = xOf(i);
    const count = counts[s.id] ?? 0;
    const fill = STATE_COLORS[s.id] ?? "#3b4252";
    const textColor = s.id === "ungroomed" ? "#e6e8ee" : "#0f1115";
    const g = svg("g", { class: `strip__pill state--${s.id}`, "data-state": s.id, tabindex: opts.focusable === false ? null : "0", role: "button", "aria-label": `${s.label}: ${count}. ${s.definition}` });
    g.appendChild(svg("title", {}, `${s.label} · ${count}\n${s.definition}${s.rule ? `\nRule: ${s.rule}` : ""}`));
    g.appendChild(svg("rect", { x, y: Y0, width: W, height: H, rx: H / 2, fill, class: "strip__rect" }));
    g.appendChild(svg("text", { x: x + W / 2, y: Y0 + 16, "text-anchor": "middle", fill: textColor, class: "strip__label" }, s.label));
    g.appendChild(svg("text", { x: x + W / 2, y: Y0 + 33, "text-anchor": "middle", fill: textColor, class: "strip__count" }, String(count)));
    if (opts.onPill) {
      g.addEventListener("click", () => opts.onPill(s.id));
      g.addEventListener("keydown", (ev) => {
        if (ev.key === "Enter" || ev.key === " ") {
          ev.preventDefault();
          opts.onPill(s.id);
        }
      });
    }
    root.appendChild(g);
  });

  // forward arrows between neighbours and backward arrows below; every arrow tooltip carries the
  // trigger and the derivation rule of the state it lands in (spec §3.6)
  const ruleOf = (id) => sm.byId?.get(id)?.rule ?? states.find((s) => s.id === id)?.rule ?? "";
  const tipFor = (t) => {
    const base = `${stateLabel(t.from, sm)} → ${stateLabel(t.to, sm)}: ${t.trigger}${t.who ? ` (${t.who})` : ""}`;
    const rule = ruleOf(t.to);
    return rule ? `${base}\nRule for ${stateLabel(t.to, sm).toLowerCase()}: ${rule}` : base;
  };
  const forward = new Map();
  const backward = [];
  for (const t of sm.transitions) {
    const a = byId.get(t.from);
    const b = byId.get(t.to);
    if (a === undefined || b === undefined) continue;
    if (b === a + 1) forward.set(a, [...(forward.get(a) ?? []), t]);
    else if (b < a) backward.push(t);
  }
  for (let i = 0; i < n - 1; i += 1) {
    const x1 = xOf(i) + W + 2;
    const x2 = xOf(i + 1) - 2;
    const y = Y0 + H / 2;
    const ts = forward.get(i) ?? [];
    const g = svg("g", { class: "strip__arrow", "data-from": states[i].id, "data-to": states[i + 1].id });
    const fallback = `${states[i].label} → ${states[i + 1].label}${ruleOf(states[i + 1].id) ? `\nRule for ${states[i + 1].label.toLowerCase()}: ${ruleOf(states[i + 1].id)}` : ""}`;
    g.appendChild(svg("title", {}, ts.length ? ts.map(tipFor).join("\n\n") : fallback));
    g.appendChild(svg("path", { d: `M${x1} ${y} L${x2} ${y}`, class: "strip__hit" }));
    g.appendChild(svg("path", { d: `M${x1} ${y} L${x2} ${y}`, class: "strip__line", "marker-end": "url(#strip-arrow)" }));
    root.appendChild(g);
  }
  backward.forEach((t, k) => {
    const a = byId.get(t.from);
    const b = byId.get(t.to);
    const xa = xOf(a) + W / 2 - 8;
    const xb = xOf(b) + W / 2 + 8;
    const yTop = Y0 + H + 2;
    const yDip = Y0 + H + 22 + k * 8;
    const d = `M${xa} ${yTop} C ${xa} ${yDip}, ${xb} ${yDip}, ${xb} ${yTop + 1}`;
    const g = svg("g", { class: "strip__arrow strip__arrow--back", "data-from": t.from, "data-to": t.to });
    g.appendChild(svg("title", {}, tipFor(t)));
    g.appendChild(svg("path", { d, class: "strip__hit" }));
    g.appendChild(svg("path", { d, class: "strip__line", "marker-end": "url(#strip-arrow)" }));
    root.appendChild(g);
  });
  root.querySelectorAll(".strip__arrow").forEach((g) => {
    const text = g.querySelector("title")?.textContent ?? "";
    if (!text) return;
    g.setAttribute("aria-label", text.replace(/\n+/g, " · "));
    g.setAttribute("role", "img");
    if (opts.onArrow) {
      g.setAttribute("tabindex", opts.focusable === false ? "-1" : "0");
      g.addEventListener("mouseenter", () => opts.onArrow(text));
      g.addEventListener("focus", () => opts.onArrow(text));
      g.addEventListener("mouseleave", () => opts.onArrow(null));
      g.addEventListener("blur", () => opts.onArrow(null));
    }
  });
  return root;
}

// ---------------------------------------------------------------------------
// Board mount / unmount in the map column
// ---------------------------------------------------------------------------

const HIDE_IDS = ["cy", "toolbar", "legend", "map-footer", "map-tip"];

function mountBoardWrap(mapEl) {
  const stage = stageOf(mapEl);
  if (!stage) return null;
  for (const id of HIDE_IDS) {
    const el = stage.querySelector(`#${id}`) ?? (stage.id === id ? stage : null);
    if (el && !el.hidden) {
      el.hidden = true;
      el.dataset.boardHidden = "1";
    }
  }
  let wrap = stage.querySelector(":scope > .board-wrap");
  if (!wrap) {
    wrap = h("div", { class: "board-wrap", role: "region", "aria-label": "Task board" });
    stage.appendChild(wrap);
  }
  return wrap;
}

/** Remove the board from the map column and restore the canvas and floating cards it hid. */
export function unmountBoard(mapEl) {
  const scope = mapEl && mapEl.querySelectorAll ? mapEl : document;
  for (const wrap of scope.querySelectorAll(".board-wrap")) wrap.remove();
  if (mapEl?.classList?.contains("board-wrap")) mapEl.remove();
  for (const el of scope.querySelectorAll("[data-board-hidden]")) {
    el.hidden = false;
    delete el.dataset.boardHidden;
  }
  if (mapEl?.dataset?.boardHidden) {
    mapEl.hidden = false;
    delete mapEl.dataset.boardHidden;
  }
}

let routeHooked = false;
/** The task page currently wired to the map (its depth / mode listeners), so a route change can release it. */
let activeTaskPage = null;
function hookRouteOnce() {
  if (routeHooked) return;
  routeHooked = true;
  try {
    on("route", (route) => {
      if (route?.level !== "tasks") unmountBoard(document);
      if (route?.level !== "task") {
        activeTaskPage?.destroy();
        clearExtraSlot(document.getElementById("tb-extra"));
      }
    });
  } catch {
    /* no bus available */
  }
}

// ---------------------------------------------------------------------------
// renderBoard (spec §3.6)
// ---------------------------------------------------------------------------

/**
 * Story column → the Needs-you queue; map column → the six-column board with the state-machine strip.
 * data = { tasks: TaskInfo[], stateMachine, people, mode }.
 * Returns { refresh(tasks), destroy() }.
 */
export function renderBoard(storyEl, mapEl, data = {}, deps = {}) {
  hookRouteOnce();
  const ctx = makeCtx(data, deps);
  const people = data.people ?? { people: [], mode: data.mode ?? "solo", current: null };
  const mode = data.mode ?? data.stateMachine?.mode ?? people.mode ?? "solo";
  const model = {
    tasks: Array.isArray(data.tasks) ? data.tasks.slice() : [],
    sm: normalizeStateMachine(data.stateMachine, data.tasks ?? []),
    people,
    mode,
    rights: decisionRights(people, mode),
    // All six states read left to right by default. Collapsing `done` to a 44px rail turned the last
    // column into a sliver with its header set one letter per line (F11); it is still one click away.
    soleOwner: soleOwner(Array.isArray(data.tasks) ? data.tasks : []),
    doneOpen: Boolean(storage.get(DONE_OPEN_KEY, true)),
    loadingDone: false,
    detail: new Map(), // slug → /api/task payload (lazy, for the Problem line)
  };

  const target = storyTarget(storyEl);
  const wrap = mountBoardWrap(mapEl);
  const stripEl = h("div", { class: "strip", "aria-label": "Task state machine" });
  const boardEl = h("div", { class: "board", role: "group", "aria-label": "Task columns" });
  const emptySlot = h("div", { class: "board__empty-slot" });
  if (wrap) mount(wrap, stripEl, emptySlot, boardEl);

  const isEmpty = () => model.tasks.length === 0 && Object.values(model.sm.counts).every((n) => !n);

  function recount() {
    model.sm = normalizeStateMachine({ ...(data.stateMachine ?? {}), counts: isEmpty() ? {} : data.stateMachine?.counts }, model.tasks);
    model.soleOwner = soleOwner(model.tasks);
  }

  // --- strip -----------------------------------------------------------------
  function drawStrip() {
    const hint = h(
      "div",
      { class: "strip__hint hint" },
      "State is read from git, so cards are not dragged: ",
      model.sm.states.map((s, i) => [i > 0 ? " → " : null, h("span", { title: s.rule ? `Rule: ${s.rule}` : null }, s.label.toLowerCase())]),
      ".",
    );
    // One fixed slot for the rule of whichever arrow is hovered or focused, in --muted at 12px —
    // the rule used to be drawn as 9.6px --faint text under a single arrow (F09).
    const readout = h("div", { class: "strip__readout", "aria-live": "polite" });
    mount(
      stripEl,
      stateStrip(model.sm, model.sm.counts, {
        onPill: (id) => {
          const col = boardEl.querySelector(`.board__col[data-state="${id}"]`);
          if (!col) return;
          if (id === "done" && !model.doneOpen) toggleDone();
          col.scrollIntoView({ block: "nearest", inline: "nearest", behavior: scrollBehavior() });
          const link = col.querySelector(".board__card a, .board__head");
          link?.focus?.();
        },
        onArrow: (text) => {
          readout.textContent = text ? String(text).replace(/\n+/g, " · ") : "";
        },
      }),
      readout,
      hint,
    );
  }

  // --- columns ---------------------------------------------------------------
  function sortTasks(list) {
    return list.slice().sort((a, b) => {
      const ta = a.lastActivity ? parseDate(a.lastActivity) ?? 0 : 0;
      const tb = b.lastActivity ? parseDate(b.lastActivity) ?? 0 : 0;
      if (tb !== ta) return tb - ta;
      return String(a.title ?? a.slug).localeCompare(String(b.title ?? b.slug));
    });
  }

  function badges(t) {
    const out = [];
    if (t.planExists) {
      if (t.planLintOk === true) out.push(h("span", { class: "badge badge--ok", title: "Plan passes the contract (reggie plan lint)" }, "plan ✓"));
      else if (t.planLintOk === false) out.push(h("span", { class: "badge badge--bad", title: `Plan fails the contract: reggie plan lint ${t.slug}` }, "plan ✗"));
    }
    if (t.packetExists) out.push(h("span", { class: "badge", title: "A completion packet exists for this task" }, "packet"));
    if (t.pr) {
      out.push(
        h(
          "a",
          { class: "badge badge--pr", href: t.pr.url, target: "_blank", rel: "noopener", title: `${t.pr.title ?? "Pull request"} (${String(t.pr.state ?? "").toLowerCase()})` },
          `PR #${t.pr.number}`,
          icon("external"),
        ),
      );
    }
    return out;
  }

  function card(t) {
    const risk = t.risk ?? "unset";
    const age = ageText(t.age);
    const when = relTime(t.lastActivity) ?? (age === "today" ? "today" : age ? `${age} old` : "no activity yet");
    // One owner for the whole board: the intro says so once, so a card only marks what differs.
    const sole = model.soleOwner;
    const owner = sole
      ? t.owner
        ? []
        : [h("span", { class: "board__owner board__owner--none", title: `Not claimed; ${sole} owns every other task here` }, "unclaimed")]
      : t.owner
        ? [avatar(t.owner, model.people), h("span", { class: "board__owner" }, t.owner)]
        : [avatar(null, model.people)];
    const b = badges(t);
    return h(
      "article",
      { class: `board__card risk--${risk}`, title: t.reason ? `Why: ${t.reason}` : null, role: "listitem", dataset: { slug: t.slug, state: t.state, refs: `task:${t.slug}` } },
      h("div", { class: "board__card-title" }, entityLink("task", taskRoute(ctx.repo, t.slug), t.title || t.slug, { refs: `task:${t.slug}` })),
      h("div", { class: "board__meta" }, ...owner, h("span", { class: "board__time", title: t.lastActivity ? `Last activity: ${fmtDate(t.lastActivity)}` : "No git activity recorded" }, when)),
      b.length ? h("div", { class: "board__badges" }, b) : null,
    );
  }

  function toggleDone() {
    model.doneOpen = !model.doneOpen;
    storage.set(DONE_OPEN_KEY, model.doneOpen);
    const loaded = model.tasks.some((t) => t.state === "done");
    if (model.doneOpen && !loaded && model.sm.counts.done > 0 && !model.loadingDone) {
      model.loadingDone = true;
      drawColumns();
      ctx
        .fetchJson("/api/tasks?all=1")
        .then((list) => {
          if (Array.isArray(list)) model.tasks = list;
        })
        .catch((e) => toast(`Could not load done tasks: ${e.message}`, { tone: "bad" }))
        .finally(() => {
          model.loadingDone = false;
          recount();
          draw();
        });
      return;
    }
    drawColumns();
  }

  function column(s) {
    const items = sortTasks(model.tasks.filter((t) => t.state === s.id));
    const count = model.sm.counts[s.id] ?? items.length;
    const isDone = s.id === "done";
    const open = !isDone || model.doneOpen;
    const toggle = isDone
      ? h(
          "button",
          { class: "btn btn--small btn--ghost board__toggle", type: "button", "aria-expanded": open ? "true" : "false", "aria-label": open ? "Collapse done" : "Expand done", on: { click: toggleDone } },
          open ? "Hide" : "Show",
        )
      : null;
    const short = COLUMN_RULE[s.id] ?? firstSentence(s.rule ?? s.definition ?? "");
    const head = h(
      "div",
      { class: "board__head", tabindex: "-1", title: s.rule ? `Rule: ${s.rule}` : s.definition || null },
      h("span", { class: `state-dot state--${s.id}`, "aria-hidden": "true" }),
      h("span", { class: "board__head-label" }, s.label),
      h("span", { class: "board__count", "aria-label": `${count} ${s.label.toLowerCase()}` }, String(count)),
      toggle,
    );
    const def = h("div", { class: "board__def", title: s.definition || null }, short);
    const list = h("div", { class: "board__cards", role: "list", "aria-label": `${s.label} tasks` }, items.map(card));
    if (open && items.length === 0) {
      list.appendChild(h("div", { class: "board__none" }, isDone && model.loadingDone ? "Loading…" : isDone && count > 0 ? `${count} done, not loaded.` : COLUMN_EMPTY[s.id] ?? "Nothing here."));
    }
    if (!open) list.hidden = true;
    const footer = s.id === "ungroomed" && !isEmpty() ? h("details", { class: "board__capture" }, h("summary", {}, "Capture one"), captureForm(ctx, { onCaptured })) : null;
    return h("section", { class: `board__col state--${s.id}${!open ? " is-collapsed" : ""}`, dataset: { state: s.id }, "aria-label": s.label }, head, def, list, footer);
  }

  function drawColumns() {
    mount(boardEl, model.sm.states.map(column));
    mount(
      emptySlot,
      isEmpty()
        ? h("div", { class: "card card--empty board__empty" }, h("p", { class: "empty__text" }, inline(EMPTY_BOARD_TEXT, {})), captureForm(ctx, { onCaptured }))
        : null,
    );
  }

  function onCaptured(res, body) {
    const slug = res?.slug ?? body.text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48);
    if (!model.tasks.some((t) => t.slug === slug)) {
      model.tasks.push({
        slug,
        title: body.text,
        state: "ungroomed",
        risk: "unset",
        owner: null,
        ownerEmail: null,
        lastActivity: new Date().toISOString(),
        branch: null,
        pr: null,
        planExists: false,
        planOnDefault: false,
        planLintOk: null,
        packetExists: false,
        intake: { slug, rawSlug: null, text: body.text, meta: null, detail: body.detail ? [body.detail] : [], line: 0 },
        reason: "intake item with no plan",
        stateDefinition: stateDefinition("ungroomed", model.sm),
        age: 0,
        planFiles: [],
        changedFiles: [],
      });
    }
    recount();
    draw();
    boardEl.querySelector(`.board__card[data-slug="${CSS.escape(slug)}"] a`)?.focus?.();
    reconcile();
  }

  /**
   * Re-read /api/tasks after a write so the board shows what git says. A decision is recorded in packet.md
   * before git moves the task (the merge or the packet landing on the default branch), so when the server
   * still reports the pre-decision state the optimistic move is kept: `keep = { slug, from, to, reason }`.
   */
  function reconcile(keep) {
    const url = deps.tasksUrl ?? "/api/tasks";
    ctx
      .fetchJson(url)
      .then((list) => {
        if (!Array.isArray(list)) return;
        const fresh = list.map((t) => {
          if (keep && t.slug === keep.slug && t.state === keep.from) return { ...t, state: keep.to, reason: keep.reason };
          return t;
        });
        const done = model.tasks.filter((t) => t.state === "done" && !fresh.some((x) => x.slug === t.slug));
        model.tasks = fresh.concat(done);
        recount();
        draw();
      })
      .catch(() => {
        /* keep the optimistic model */
      });
  }

  // --- Needs-you queue (story column) ------------------------------------------
  function problemLine(t) {
    const cached = model.detail.get(t.slug);
    const fromDetail = cached?.plan?.sections?.Problem ?? cached?.plan?.sections?.problem;
    const text = t.problem ?? (fromDetail ? firstSentence(fromDetail) : null) ?? (t.intake?.text ? firstSentence(t.intake.text) : null);
    const p = h("p", { class: "card__problem" }, text ? inline(text, { repo: ctx.repo }) : h("span", { class: "faint" }, "Reading the plan…"));
    if (!text && !cached && !model.detail.has(t.slug)) {
      model.detail.set(t.slug, null);
      ctx
        .fetchJson(`/api/task/${encodeURIComponent(t.slug)}`)
        .then((d) => {
          model.detail.set(t.slug, d);
          const prob = d?.plan?.sections?.Problem ?? d?.plan?.sections?.problem;
          const live = target?.querySelector(`.card--decision[data-slug="${CSS.escape(t.slug)}"] .card__problem`) ?? p;
          mount(live, prob ? inline(firstSentence(prob), { repo: ctx.repo }) : h("span", { class: "faint" }, "The plan has no Problem section."));
        })
        .catch(() => {
          const live = target?.querySelector(`.card--decision[data-slug="${CSS.escape(t.slug)}"] .card__problem`) ?? p;
          mount(live, h("span", { class: "faint" }, "The plan could not be read."));
        });
    }
    return p;
  }

  function decisionCard(t) {
    const risk = t.risk ?? "unset";
    const chips = [
      t.owner
        ? model.soleOwner
          ? null
          : chip("Owner", t.owner, { tip: `Owner: ${personName(t.owner, model.people) ?? t.owner}` })
        : chip("Owner", "nobody", { tone: "muted", tip: "No claim or branch author" }),
      chip("Age", ageText(t.age) ?? relTime(t.lastActivity) ?? "unknown", { tip: t.lastActivity ? `Last activity ${fmtDate(t.lastActivity)}` : "Days since the last git activity" }),
      chip("Risk", risk, { tone: RISK_TONE[risk], tip: RISK_TIPS[risk] }),
    ];
    const pr = t.pr ? h("a", { class: "link link--task", href: t.pr.url, target: "_blank", rel: "noopener", title: t.pr.title ?? "Pull request" }, icon("external"), h("span", {}, `PR #${t.pr.number}`)) : null;
    const body = model.rights.canDecide
      ? decideForm(ctx, t.slug, {
          onDone: (verdict) => {
            const task = model.tasks.find((x) => x.slug === t.slug);
            const from = task?.state ?? "awaiting-decision";
            const to = verdict === "approved" ? "done" : "in-process";
            const reason = verdict === "approved" ? "packet approved (recorded; git catches up on merge)" : "packet sent back: needs work";
            if (task) {
              task.state = to;
              task.reason = reason;
              task.lastActivity = new Date().toISOString();
            }
            recount();
            draw();
            reconcile({ slug: t.slug, from, to, reason });
          },
        })
      : h("p", { class: "hint card__who" }, whoCanDecideText(model.rights));
    return h(
      "article",
      { class: `card card--decision risk--${risk}`, dataset: { slug: t.slug, refs: `task:${t.slug}` } },
      h("div", { class: "card__head" }, h("span", { class: "card__title" }, entityLink("task", taskRoute(ctx.repo, t.slug), t.title || t.slug)), stateChip("awaiting-decision"), pr),
      problemLine(t),
      h("div", { class: "card__chips" }, chips),
      t.reason ? h("p", { class: "card__why muted" }, "Why it is here: ", t.reason) : null,
      body,
    );
  }

  function drawQueue() {
    if (!target) return;
    const awaiting = sortTasks(model.tasks.filter((t) => t.state === "awaiting-decision"));
    const cards = awaiting.length
      ? awaiting.map(decisionCard)
      : h(
          "div",
          { class: "empty" },
          h("p", { class: "empty__text" }, "Nothing is waiting on a decision. A task lands here when a pull request opens or a completion packet is written on its branch."),
          h("p", { class: "empty__hint" }, "Finish work with ", h("code", {}, "reggie packet <slug>"), " and open a PR whose body is the packet."),
        );
    const sole = model.soleOwner;
    /**
     * "How the board works" used to end in a six-item list of the state definitions — the same six
     * facts the six column sublabels carry, three hundred pixels to the right, on the same screen.
     * The columns are where a reader looks for what a column means, so the definitions stay there
     * and this paragraph says only what the columns cannot: where the states come from.
     */
    const intro = h(
      "p",
      { class: "para para--fact" },
      `${model.tasks.length === 1 ? "One task" : `${model.tasks.length || "No"} tasks`} on the board${model.mode === "team" ? " (team mode: maintainers decide)" : ""}. `,
      "The board on the right reads every state from git; nothing here is dragged. Each column names the git fact that puts a task in it — hover a column head for the full rule.",
      sole
        ? h(
            "span",
            {},
            " ",
            entityLink("person", personRoute(ctx.repo, sole), sole),
            " owns every claimed task here, so the cards do not repeat the name — only unclaimed ones are marked.",
          )
        : null,
    );
    mount(target, section("needs-you", "Needs you", cards), section("board-how", "How the board works", intro));
  }

  function draw() {
    // Keep keyboard focus on the same card across a redraw.
    const focusedSlug = document.activeElement?.closest?.(".board__card")?.dataset?.slug ?? null;
    drawStrip();
    drawColumns();
    drawQueue();
    if (focusedSlug) boardEl.querySelector(`.board__card[data-slug="${CSS.escape(focusedSlug)}"] a`)?.focus?.();
  }

  // --- keyboard: arrows move between cards and columns (spec §3.1) --------------
  function wireKeys() {
    if (!wrap) return;
    wrap.addEventListener("keydown", (ev) => {
      if (!["ArrowDown", "ArrowUp", "ArrowLeft", "ArrowRight"].includes(ev.key)) return;
      const active = document.activeElement;
      const cardEl = active?.closest?.(".board__card");
      const colEl = active?.closest?.(".board__col");
      if (!colEl) return;
      const cols = Array.from(boardEl.querySelectorAll(".board__col"));
      const cards = Array.from(colEl.querySelectorAll(".board__card"));
      const ci = cols.indexOf(colEl);
      const ri = cardEl ? cards.indexOf(cardEl) : -1;
      let targetEl = null;
      if (ev.key === "ArrowDown") targetEl = cards[ri + 1] ?? null;
      else if (ev.key === "ArrowUp") targetEl = ri > 0 ? cards[ri - 1] : colEl.querySelector(".board__head");
      else {
        const next = cols[ci + (ev.key === "ArrowRight" ? 1 : -1)];
        if (next) {
          const nc = Array.from(next.querySelectorAll(".board__card"));
          targetEl = nc[Math.min(Math.max(ri, 0), nc.length - 1)] ?? next.querySelector(".board__head");
        }
      }
      if (targetEl) {
        ev.preventDefault();
        (targetEl.querySelector?.("a") ?? targetEl).focus();
      }
    });
  }

  draw();
  wireKeys();
  hookStoryHover(target, ctx);

  return {
    refresh(tasks, stateMachine) {
      if (Array.isArray(tasks)) model.tasks = tasks.slice();
      if (stateMachine) data.stateMachine = stateMachine;
      recount();
      draw();
    },
    destroy() {
      unmountBoard(mapEl);
    },
  };
}

// ---------------------------------------------------------------------------
// Story hover → map highlight (data-refs)
// ---------------------------------------------------------------------------

function hookStoryHover(container, ctx) {
  if (!container) return;
  container.__boardCtx = ctx;
  if (container.dataset.boardHover === "1") return;
  container.dataset.boardHover = "1";
  const mapOf = () => container.__boardCtx?.map ?? appState.map;
  container.addEventListener("mouseover", (ev) => {
    const el = ev.target?.closest?.("[data-refs]");
    if (!el || !container.contains(el)) return;
    const map = mapOf();
    const refs = String(el.dataset.refs).split(/\s+/).filter(Boolean);
    if (refs.length && typeof map?.highlight === "function") map.highlight(refs);
  });
  container.addEventListener("mouseout", (ev) => {
    const el = ev.target?.closest?.("[data-refs]");
    if (!el) return;
    const map = mapOf();
    if (typeof map?.clearHighlight === "function") map.clearHighlight();
  });
}

// ---------------------------------------------------------------------------
// Blast radius (spec §3.7): depth 1–3, Planned / Actual / Both, Fit
// ---------------------------------------------------------------------------

function findExtraSlot(mapEl) {
  const stage = stageOf(mapEl);
  let slot = stage?.querySelector?.("#tb-extra") ?? document.getElementById("tb-extra");
  if (slot) return slot;
  if (!stage) return null;
  let bar = stage.querySelector(":scope > .float--toolbar");
  if (!bar) {
    bar = h("div", { class: "float float--toolbar", role: "toolbar", "aria-label": "Blast radius tools" });
    stage.appendChild(bar);
  }
  slot = h("div", { id: "tb-extra", class: "float__extra" });
  bar.appendChild(slot);
  return slot;
}

function clearExtraSlot(slot) {
  if (!slot) return;
  for (const el of slot.querySelectorAll(":scope > .blast")) el.remove();
}

/** Filter an impact ViewGraph to the centres of one mode (planned | actual | both) and what they reach. */
export function filterImpactView(view, mode) {
  if (!view || mode === "both" || !Array.isArray(view.nodes)) return view;
  const nodes = view.nodes;
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const isCenter = (n) => n.center || n.hop === 0 || (view.centers ?? []).includes(n.id) || view.center === n.id;
  const keepCenter = (n) => (mode === "planned" ? Boolean(n.planned) : Boolean(n.actual));
  const keep = new Set();
  for (const n of nodes) if (isCenter(n) && keepCenter(n)) keep.add(n.id);
  const excluded = new Set(nodes.filter((n) => isCenter(n) && !keepCenter(n)).map((n) => n.id));
  let frontier = new Set(keep);
  for (let hop = 0; hop < 8 && frontier.size > 0; hop += 1) {
    const next = new Set();
    for (const e of view.edges ?? []) {
      if (frontier.has(e.target) && !keep.has(e.source) && !excluded.has(e.source)) {
        const src = byId.get(e.source);
        if (src && src.side !== "down") next.add(e.source);
      }
      if (frontier.has(e.source) && !keep.has(e.target) && !excluded.has(e.target)) {
        const dst = byId.get(e.target);
        if (dst && dst.side !== "up") next.add(e.target);
      }
    }
    for (const id of next) keep.add(id);
    frontier = next;
  }
  // parents (area compounds) of kept nodes, walking up while the parent is in the payload
  for (const id of Array.from(keep)) {
    let p = byId.get(id)?.parent;
    while (p && byId.has(p) && !keep.has(p)) {
      keep.add(p);
      p = byId.get(p)?.parent;
    }
  }
  const outNodes = nodes.filter((n) => keep.has(n.id));
  const outEdges = (view.edges ?? []).filter((e) => keep.has(e.source) && keep.has(e.target));
  const centers = (view.centers ?? []).filter((id) => keep.has(id));
  const countSide = (side) => {
    const perHop = [];
    for (const n of outNodes) {
      if (n.side !== side && !(side === "up" && n.side === "both")) continue;
      const hp = Number(n.hop ?? 1);
      perHop[hp - 1] = (perHop[hp - 1] ?? 0) + (n.kind === "fold" ? Number(n.foldCount ?? 1) : 1);
    }
    return perHop.map((x) => x ?? 0);
  };
  return {
    ...view,
    nodes: outNodes,
    edges: outEdges,
    centers,
    counts: { ...(view.counts ?? {}), shown: outNodes.length, up: countSide("up"), down: countSide("down") },
  };
}

function viewCountParts(view, depth) {
  const nodes = view?.nodes ?? [];
  const isCenter = (n) => n.center || n.hop === 0 || (view?.centers ?? []).includes(n.id);
  const centers = nodes.filter(isCenter);
  const planned = centers.filter((n) => n.planned).length;
  const actual = centers.filter((n) => n.actual).length;
  let up = 0;
  for (const n of nodes) {
    if (isCenter(n) || n.ghost || n.kind === "dir") continue;
    if (n.side === "up" || n.side === "both") up += n.kind === "fold" ? Number(n.foldCount ?? 1) : 1;
  }
  const overlaps = nodes.filter((n) => Array.isArray(n.collision) && n.collision.length > 0).length;
  const parts = [
    { label: "Planned", value: String(planned), tip: "Files the plan lists" },
    { label: "Changed", value: String(actual), tip: "Files changed on the task branch" },
    { label: `Importers at depth ${depth}`, value: String(up), tip: `Files that reach a centre file within ${depth} import hop${depth === 1 ? "" : "s"}` },
  ];
  if (overlaps) parts.push({ label: "Overlaps", value: String(overlaps), tone: "warn", tip: "Files another in-flight task also touches" });
  return parts;
}

/** The same counts as one sentence, for the story column's radius line and for screen readers. */
function viewCountsText(view, depth) {
  return viewCountParts(view, depth)
    .map((p) => `${p.value} ${p.label.toLowerCase()}`)
    .join(", ");
}

function blastControls(mapEl, ctx, blast) {
  const slot = findExtraSlot(mapEl);
  if (!slot) return null;
  clearExtraSlot(slot);
  const val = h("span", { class: "range__val" }, String(blast.depth));
  const range = h("input", { type: "range", min: "1", max: "3", step: "1", value: String(blast.depth), "aria-label": "Blast radius depth (1–3)" });
  range.addEventListener("input", () => {
    val.textContent = range.value;
  });
  range.addEventListener("change", () => blast.setDepth(Number(range.value)));
  const depthEl = h("label", { class: "range blast blast__depth", title: "How many import hops upstream to draw" }, "Depth ", range, val);

  const seg = h("div", { class: "seg blast blast__mode", role: "radiogroup", "aria-label": "Which files to show" });
  const modes = [
    ["planned", "Planned", "Files the plan lists"],
    ["actual", "Actual", "Files changed on the task branch"],
    ["both", "Both", "Planned and changed files"],
  ];
  for (const [id, label, tip] of modes) {
    const b = h("button", { class: `seg__btn${blast.mode === id ? " is-active" : ""}`, type: "button", role: "radio", "aria-checked": blast.mode === id ? "true" : "false", dataset: { mode: id }, title: tip }, label);
    b.addEventListener("click", () => blast.setMode(id));
    seg.appendChild(b);
  }
  const counts = h("span", { class: "blast blast__counts", "aria-live": "polite" });
  const fit = document.getElementById("tb-fit")
    ? null
    : h("button", { class: "btn btn--tool blast", type: "button", "aria-label": "Fit (F)", title: "Fit (F)", on: { click: () => blast.fit() } }, icon("fit", 16), h("span", {}, "Fit"));
  slot.append(...[h("span", { class: "float__sep blast", "aria-hidden": "true" }), depthEl, seg, counts, fit].filter(Boolean));
  return {
    update() {
      range.value = String(blast.depth);
      val.textContent = String(blast.depth);
      for (const b of seg.querySelectorAll(".seg__btn")) {
        const active = b.dataset.mode === blast.mode;
        b.classList.toggle("is-active", active);
        b.setAttribute("aria-checked", active ? "true" : "false");
      }
      // Every fact is its own labelled chip with a tooltip; the dot-joined tuple said nothing about
      // what "3 · 5 · 12" counted (§5.2).
      mount(counts, blast.view ? viewCountParts(blast.filtered ?? blast.view, blast.depth).map((c) => chip(c.label, c.value, { tone: c.tone, tip: c.tip })) : null);
    },
  };
}

// ---------------------------------------------------------------------------
// renderTaskPage (spec §3.7)
// ---------------------------------------------------------------------------

/**
 * data = GET /api/task/<slug> payload plus `view` (GET /api/impact?slug=…), optional `people`.
 * deps = { repo, map, post, fetchJson, onDecide, depth, show, syncQuery }.
 */
export function renderTaskPage(storyEl, mapEl, data = {}, deps = {}) {
  hookRouteOnce();
  activeTaskPage?.destroy();
  unmountBoard(mapEl);
  const ctx = makeCtx(data, deps);
  const repo = ctx.repo;
  const task = data.task ?? {};
  const slug = task.slug ?? data.slug ?? appState.route?.id ?? "";
  const plan = data.plan ?? null;
  const packet = data.packet ?? null;
  const claim = data.claim ?? null;
  const journal = Array.isArray(data.journal) ? data.journal : [];
  const impact = { planned: [], actual: [], plannedButUntouched: [], touchedButUnplanned: [], downstream: [], collisions: [], riskRules: [], ...(data.impact ?? {}) };
  const people = data.people ?? appState.facts?.people ?? null;
  const mode = data.mode ?? data.people?.mode ?? appState.facts?.config?.mode ?? "solo";
  const rights = decisionRights(people ? { ...people, current: people.current ?? appState.facts?.people?.current ?? null } : null, mode);
  if (deps.canDecide !== undefined) rights.canDecide = Boolean(deps.canDecide);
  const files = normalizeFiles(plan?.files ?? task.planFiles ?? []);
  const fileSet = new Set(files.map((f) => f.path));
  const pctx = { repo, files: fileSet };
  const changed = new Set(impact.actual ?? task.changedFiles ?? []);
  const untouched = new Set(impact.plannedButUntouched ?? []);

  const target = storyTarget(storyEl);

  // --- head --------------------------------------------------------------------
  const copyBtn = h("button", { class: "btn", type: "button", "aria-label": "Copy context pack for an agent", title: `Copies what \`reggie context ${slug}\` prints: notes, related tasks, recent commits and active work` }, icon("copy"), h("span", {}, "Copy context pack for an agent"));
  copyBtn.addEventListener("click", async () => {
    copyBtn.disabled = true;
    try {
      const res = await ctx.fetchJson(`/api/context?slug=${encodeURIComponent(slug)}`);
      const text = typeof res === "string" ? res : (res?.text ?? "");
      if (!text) throw new Error("the context pack came back empty");
      await copyText(text);
      toast(`Context pack for \`${slug}\` copied (${text.length.toLocaleString()} characters)`, { tone: "ok" });
    } catch (e) {
      toast(`Could not copy the context pack: ${e.message}`, { tone: "bad" });
    } finally {
      copyBtn.disabled = false;
    }
  });
  const radiusLine = h("p", { class: "task-radius muted", "aria-live": "polite" }, "Blast radius: reading the import graph…");
  const head = h(
    "div",
    { class: "task-head", dataset: { refs: `task:${slug}` } },
    h("div", { class: "task-head__title" }, icon("task"), h("span", {}, task.title || slug)),
    h(
      "div",
      { class: "chips task-head__chips" },
      chip("Task", slug, { code: true, tip: `Slug: ${slug}` }),
      task.branch ? chip("Branch", task.branch, { code: true, tip: "Git branch for this task" }) : null,
      task.pr
        ? h(
            "a",
            { class: "link link--task", href: task.pr.url, target: "_blank", rel: "noopener", title: `${task.pr.title ?? "Pull request"} (${String(task.pr.state ?? "unknown").toLowerCase()})` },
            icon("external"),
            h("span", {}, `PR #${task.pr.number}`),
          )
        : null,
      task.pr ? chip("PR", String(task.pr.state ?? "unknown").toLowerCase(), { tip: `State of pull request #${task.pr.number}` }) : null,
    ),
    h("div", { class: "task-head__actions" }, copyBtn),
    radiusLine,
  );

  // --- state -------------------------------------------------------------------
  const stateSec = section(
    "state",
    "State",
    h("p", { class: "para para--fact" }, stateChip(task.state), " ", task.stateDefinition ?? GLOSSARY[task.state] ?? ""),
    h(
      "p",
      { class: "para muted task-reason" },
      "Why: ",
      task.reason ? (/[.!?]$/.test(task.reason) ? task.reason : `${task.reason}.`) : "no git evidence recorded.",
      task.age !== null && task.age !== undefined ? ` Last activity ${ageText(task.age) === "today" ? "today" : `${ageText(task.age)} ago`}.` : null,
    ),
  );

  // --- owner -------------------------------------------------------------------
  const ownerSec = section(
    "owner",
    "Owner",
    task.owner
      ? h("p", { class: "para para--fact", dataset: { refs: `person:${task.owner}` } }, avatar(task.owner, people), " ", entityLink("person", personRoute(repo, task.owner), task.owner), claim ? " claimed this task." : " owns this task (from git; no claim file).")
      : h("div", { class: "empty" }, h("p", { class: "empty__text" }, "Nobody has claimed this task."), h("p", { class: "empty__hint" }, "Take it with ", h("code", {}, `reggie claim ${slug}`), ".")),
    claim
      ? h("div", { class: "chips section__more" }, chip("Person", claim.person, { tip: "Who claimed it" }), chip("Machine", claim.machine, { tip: "Machine the claim was made from" }), chip("Tool", claim.tool), chip("Date", fmtDate(claim.date), { tip: `Claimed ${claim.date}` }))
      : null,
  );

  // --- plan sections -------------------------------------------------------------
  const planSections = [];
  if (!plan) {
    const meta = intakeMeta(task.intake?.meta);
    const label = stateLabel(task.state, null).toLowerCase();
    const parts = ["No plan yet. This task is ", label];
    if (task.intake?.text) parts.push(": ", h("code", {}, task.intake.text), meta.person ? ` captured by ${meta.person}` : "", meta.date ? ` on ${fmtDate(meta.date)}` : "");
    parts.push(". Plan it in plan mode against the contract (", h("code", {}, `reggie plan new ${slug}`), ").");
    planSections.push(section("problem", "Problem", h("div", { class: "empty" }, h("p", { class: "empty__text" }, parts))));
    if (task.intake?.detail?.length) planSections.push(section("approach", "Captured detail", prose(task.intake.detail.join("\n"), pctx)));
  } else {
    const secs = plan.sections ?? {};
    const get = (name) => secs[name] ?? secs[name.toLowerCase()] ?? secs[name.toLowerCase().replace(/\s+/g, "-")] ?? "";
    const proseSec = (id, heading, name) => {
      const text = get(name);
      return section(id, heading, prose(text, pctx) ?? h("p", { class: "para muted" }, `The plan has no ${name} section (`, h("code", {}, `reggie plan lint ${slug}`), " flags it)."));
    };
    planSections.push(proseSec("problem", "Problem", "Problem"));
    planSections.push(proseSec("approach", "Approach", "Approach"));

    // files
    const rows = files.map((f) => {
      const id = f.nodeId ?? f.path;
      const tags = [];
      if (f.op) tags.push(h("span", { class: `badge badge--${f.op.toLowerCase()}`, title: OP_TIPS[f.op] ?? f.op }, f.op));
      if (f.exists === false && f.op !== "NEW" && f.op !== "DEL") tags.push(chip(null, "missing", { tone: "warn", tip: "This path is not in the repo" }));
      if (changed.has(f.path)) tags.push(chip(null, "changed on branch", { tone: "ok", tip: "This file has commits on the task branch" }));
      else if (untouched.has(f.path)) tags.push(chip(null, "not changed yet", { tone: "muted", tip: "Planned but no commit touches it yet" }));
      return h("li", { class: "task-file", dataset: { refs: id } }, entityLink("file", fileRoute(repo, id), f.path, { refs: id }), tags);
    });
    const unplanned = (impact.touchedButUnplanned ?? []).map((p, i) => [i > 0 ? ", " : null, entityLink("file", fileRoute(repo, p), p, { refs: p })]);
    const collisions = (impact.collisions ?? []).map((c) => {
      const same = c.owner && task.owner && c.owner === task.owner;
      const clause = same ? `${c.owner} owns both.` : c.owner ? `${c.owner} owns the other${task.owner ? "" : "; this one has no owner"}.` : "the other has no owner yet.";
      return h(
        "p",
        { class: "para para--gap task-collision", dataset: { refs: `${c.file} task:${c.slug}` } },
        "This task and ",
        entityLink("task", taskRoute(repo, c.slug), c.slug, { refs: `task:${c.slug}` }),
        " both touch ",
        entityLink("file", fileRoute(repo, c.file), basename(c.file), { refs: c.file, title: c.file }),
        "; ",
        clause,
      );
    });
    planSections.push(
      section(
        "files",
        "Files to touch",
        rows.length ? h("ul", { class: "task-files" }, rows) : h("p", { class: "para muted" }, "The plan lists no files."),
        unplanned.length ? h("p", { class: "para para--gap", dataset: { refs: (impact.touchedButUnplanned ?? []).join(" ") } }, "Also changed on the branch but not in the plan: ", unplanned, ".") : null,
        collisions,
      ),
    );

    // criteria
    const packetCriteria = new Map((packet?.criteria ?? []).map((c) => [normCriterion(c.text), c]));
    const criteria = (plan.criteria ?? []).map((text) => {
      const p = packetCriteria.get(normCriterion(text));
      const pass = p ? p.pass : null;
      return h(
        "li",
        { class: `task-crit${pass === true ? " is-pass" : pass === false ? " is-fail" : ""}` },
        h("label", { class: "task-crit__label" }, h("input", { type: "checkbox", disabled: true, checked: pass === true ? true : null, "aria-label": text }), h("span", {}, inline(text, pctx))),
        pass === false ? chip(null, "not met", { tone: "bad", tip: "The completion packet marks this criterion as failed" }) : packet && pass === null ? chip(null, "unverified", { tone: "muted", tip: "The packet has not marked this criterion yet" }) : null,
      );
    });
    planSections.push(
      section(
        "criteria",
        "Acceptance criteria",
        criteria.length ? h("ul", { class: "task-criteria" }, criteria) : h("p", { class: "para muted" }, "The plan lists no acceptance criteria."),
        h("p", { class: "hint section__more" }, packet ? "A checked box means the completion packet says it passes." : "Boxes are checked by the completion packet, not by hand."),
      ),
    );
    planSections.push(proseSec("verification", "Verification", "Verification strategy"));
    planSections.push(proseSec("assumptions", "Assumptions", "Assumptions"));
    planSections.push(proseSec("scope", "Out of scope", "Out of scope"));
    planSections.push(proseSec("bail", "Bail conditions", "Bail conditions"));
  }

  // --- risk ------------------------------------------------------------------------
  const riskLevel = plan?.meta?.risk ?? task.risk ?? "unset";
  const rules = impact.riskRules ?? [];
  const riskSec = section(
    "risk",
    "Risk",
    h(
      "p",
      { class: "para para--fact" },
      chip("Risk", riskLevel, { tone: RISK_TONE[riskLevel] ?? "muted", tip: RISK_TIPS[riskLevel] ?? riskLevel }),
      " ",
      rules.length ? "Rules that fired:" : riskLevel === "unset" ? "No risk class is set; the plan front matter decides it." : "No risk rule fired; the class comes from the plan front matter.",
    ),
    rules.length
      ? h(
          "ul",
          { class: "para para--list task-rules" },
          rules.map((r) => h("li", { dataset: { refs: r.file } }, `${r.level} because a touched path (`, entityLink("file", fileRoute(repo, r.file), basename(r.file), { refs: r.file, title: r.file }), ") contains ", h("code", {}, r.pattern), ".")),
        )
      : null,
  );

  // --- packet ------------------------------------------------------------------------
  const packetSec = packet ? packetSection(ctx, slug, packet, task, rights) : section("packet", "Completion packet", h("div", { class: "empty" }, h("p", { class: "empty__text" }, "No completion packet yet. It is written when the work is finished and lists what was verified, with evidence."), h("p", { class: "empty__hint" }, "Write it with ", h("code", {}, `reggie packet ${slug}`), ".")));

  // --- journal ------------------------------------------------------------------------
  const entries = journal.slice().sort((a, b) => `${b.date} ${b.time}`.localeCompare(`${a.date} ${a.time}`));
  const journalSec = section(
    "journal",
    "Journal for this task",
    entries.length
      ? entries.map((e) =>
          h(
            "article",
            { class: "card card--journal", dataset: { refs: (e.nodeIds ?? []).join(" ") } },
            h("div", { class: "card__body" }, inline(e.text, pctx)),
            h("div", { class: "card__chips" }, chip("Person", e.person), chip("Tool", e.tool), e.stage ? chip("Stage", e.stage) : null, chip("Date", `${fmtDate(e.date)}${e.time ? ` ${e.time}` : ""}`, { tip: `${e.date} ${e.time ?? ""}`.trim() }), (e.evidence ?? []).map((ev) => evidenceLink(ctx, slug, ev))),
          ),
        )
      : h("div", { class: "empty" }, h("p", { class: "empty__text" }, "Nothing has been recorded for this task yet. Each step of work adds one plain-English entry."), h("p", { class: "empty__hint" }, h("code", {}, `reggie journal add --slug ${slug} --stage <stage> "what happened"`))),
  );

  if (target) mount(target, head, stateSec, ownerSec, ...planSections, riskSec, packetSec, journalSec);
  hookStoryHover(target, ctx);

  // --- blast radius map -----------------------------------------------------------------
  const q = appState.route?.level === "task" ? appState.route.query ?? {} : {};
  const blast = {
    depth: clampDepth(deps.depth ?? q.depth ?? data.depth ?? 1),
    mode: ["planned", "actual", "both"].includes(deps.show ?? q.show) ? deps.show ?? q.show : "both",
    // The impact ViewGraph arrives as data.view (or spread over data: level 'impact' with nodes and edges).
    view: data.view ?? data.impactView ?? data.blast ?? deps.view ?? (Array.isArray(data.nodes) && Array.isArray(data.edges) ? data : null),
    filtered: null,
    cache: new Map(),
    slugs: null,
    setDepth(n) {
      const d = clampDepth(n);
      if (d === blast.depth && blast.cache.has(d)) return;
      blast.depth = d;
      load(d);
    },
    setMode(m) {
      blast.mode = m;
      apply();
    },
    fit() {
      ctx.map?.fit?.();
    },
  };
  // The integrator fetched `view` at the route's depth; cache it under that depth.
  if (blast.view) blast.cache.set(blast.depth, blast.view);
  // map.js draws Depth and Planned / Actual / Both in #tb-extra for every impact view and emits `depth` / `mode`
  // (it never filters by mode itself); a map without that surface (stub, renderer failure) gets the controls from here.
  const mapOwnsControls = typeof ctx.map?.setControls === "function" && typeof ctx.map?.on === "function";
  const controls = mapOwnsControls ? null : blastControls(mapEl, ctx, blast);
  const unsubs = [];
  let alive = true;
  if (mapOwnsControls) {
    unsubs.push(ctx.map.on("depth", (n) => alive && blast.setDepth(n)));
    unsubs.push(ctx.map.on("mode", (m) => alive && blast.setMode(m)));
  }

  /**
   * Every slug the blast radius must ask about. The server only marks `node.collision` when two or
   * more slugs are requested, and a single-slug response tags each centre with its own slug only — so
   * discovering the others from the response could never work. The colliding slugs are already in the
   * task payload, at impact.collisions[].slug (F2).
   */
  function slugsFor(view) {
    if (blast.slugs) return blast.slugs;
    const set = new Set([slug]);
    for (const c of data?.impact?.collisions ?? []) if (c?.slug) set.add(c.slug);
    for (const n of view?.nodes ?? []) if (n.task && (n.center || n.hop === 0)) set.add(n.task);
    blast.slugs = Array.from(set);
    return blast.slugs;
  }

  function impactUrl(depth) {
    const params = new URLSearchParams();
    for (const s of slugsFor(blast.view)) params.append("slug", s);
    params.set("depth", String(depth));
    return `/api/impact?${params.toString()}`;
  }

  function radiusText() {
    const v = blast.filtered ?? blast.view;
    const hasCentres = Boolean(v && (v.centers?.length || (v.nodes ?? []).some((n) => n.center || n.hop === 0)));
    if (!v || !hasCentres) return "No blast radius to draw: the plan names no files and the branch changed none.";
    const scope = blast.mode === "planned" ? " (planned files only)" : blast.mode === "actual" ? " (files changed on the branch only)" : "";
    return `Blast radius${scope}: ${viewCountsText(v, blast.depth)}.`;
  }

  function apply() {
    if (!alive) return;
    const view = blast.cache.get(blast.depth) ?? blast.view;
    if (!view) {
      controls?.update();
      radiusLine.textContent = radiusText();
      return;
    }
    blast.view = view;
    blast.filtered = filterImpactView(view, blast.mode);
    const map = ctx.map;
    if (map && typeof map.show === "function") {
      try {
        map.show(blast.filtered, { level: "impact", lens: "structure", mode: blast.mode, depth: blast.depth, slug });
      } catch (e) {
        console.error("map.show failed", e);
      }
    }
    controls?.update();
    radiusLine.textContent = radiusText();
    syncQuery();
  }

  function syncQuery() {
    if (deps.syncQuery === false || appState.route?.level !== "task") return;
    const cur = appState.route.query ?? {};
    const wantDepth = blast.depth === 1 ? null : String(blast.depth);
    const wantShow = blast.mode === "both" ? null : blast.mode;
    if ((cur.depth ?? null) === wantDepth && (cur.show ?? null) === wantShow) return;
    try {
      setQuery({ depth: wantDepth, show: wantShow });
    } catch (e) {
      console.warn("setQuery failed", e);
    }
  }

  let loadToken = 0;
  async function load(depth) {
    const token = (loadToken += 1);
    if (blast.cache.has(depth)) {
      apply();
      return;
    }
    const col = stageOf(mapEl)?.closest?.(".map-col");
    col?.classList.add("is-loading");
    try {
      const view = await ctx.fetchJson(impactUrl(depth));
      if (token !== loadToken || !alive) return;
      blast.cache.set(depth, view);
      apply();
    } catch (e) {
      if (token !== loadToken) return;
      toast(`\`/api/impact\` failed: ${e.message}`, { tone: "bad" });
    } finally {
      col?.classList.remove("is-loading");
    }
  }

  if (blast.view) apply();
  else load(blast.depth);

  const handle = {
    setDepth: blast.setDepth,
    setMode: blast.setMode,
    get view() {
      return blast.filtered ?? blast.view;
    },
    destroy() {
      alive = false;
      for (const u of unsubs) {
        try {
          u();
        } catch {
          /* already gone */
        }
      }
      unsubs.length = 0;
      clearExtraSlot(findExtraSlot(mapEl));
      if (activeTaskPage === handle) activeTaskPage = null;
    },
  };
  activeTaskPage = handle;
  return handle;
}

function clampDepth(n) {
  const d = Number(n);
  if (Number.isNaN(d)) return 1;
  return Math.min(3, Math.max(1, Math.round(d)));
}

function normalizeFiles(list) {
  return (Array.isArray(list) ? list : []).map((f) => {
    if (typeof f === "string") {
      const m = /^(.*?)\s*\((NEW|MOD|DEL)\)\s*$/i.exec(f);
      const path = (m ? m[1] : f).trim();
      return { path, op: m ? m[2].toUpperCase() : null, exists: true, nodeId: path };
    }
    return { path: f.path, op: f.op ? String(f.op).toUpperCase() : null, exists: f.exists !== false, nodeId: f.nodeId ?? f.path };
  });
}

function normCriterion(text) {
  return String(text ?? "").toLowerCase().replace(/\s+/g, " ").trim();
}

function evidenceName(entry) {
  return String(entry ?? "").replace(/^\.?\/?(?:\.reggie\/tasks\/[^/]+\/)?evidence\//, "");
}

function evidenceLink(ctx, slug, entry) {
  const name = evidenceName(entry);
  if (!name || name.includes("/") || name.includes("..")) return h("code", { class: "evidence-code", title: "Not an evidence file" }, entry);
  const url = withRepoOnce(`/api/evidence?slug=${encodeURIComponent(slug)}&file=${encodeURIComponent(name)}`);
  return h("a", { class: "link link--file evidence-link", href: url, target: "_blank", rel: "noopener", title: `Open evidence/${name}` }, icon("external"), h("span", {}, name));
}

function packetSection(ctx, slug, packet, task, rights) {
  const verdict = packet.verdict ?? "pending";
  const marks = { true: ["✓", "ok", "passes"], false: ["✗", "bad", "fails"], null: ["○", "muted", "not verified"] };
  const crit = (packet.criteria ?? []).map((c) => {
    const [glyph, tone, word] = marks[String(c.pass)] ?? marks.null;
    return h(
      "li",
      { class: `packet__crit is-${tone}` },
      h("span", { class: `packet__mark packet__mark--${tone}`, title: `Criterion ${word}`, "aria-label": word }, glyph),
      h("span", { class: "packet__text" }, inline(c.text, { repo: ctx.repo })),
      (c.evidence ?? []).length ? h("span", { class: "packet__evidence" }, (c.evidence ?? []).map((e) => evidenceLink(ctx, slug, e))) : h("span", { class: "faint packet__noev" }, "no evidence linked"),
    );
  });
  const subs = PACKET_SECTIONS.filter((name) => packet.sections?.[name] !== undefined && String(packet.sections[name]).trim() !== "").map((name) =>
    h("div", { class: "packet__sub section__more" }, h("h3", { class: "task-sub" }, name), prose(packet.sections[name], { repo: ctx.repo })),
  );
  const allEvidence = (packet.evidence ?? []).length ? h("div", { class: "packet__all section__more" }, h("h3", { class: "task-sub" }, "Evidence"), h("div", { class: "chips" }, packet.evidence.map((e) => evidenceLink(ctx, slug, e)))) : null;
  const decision =
    verdict === "pending" && task.state !== "done"
      ? rights.canDecide
        ? h("div", { class: "packet__decide" }, h("p", { class: "hint" }, "Decide from here: the verdict is written to the packet front matter."), decideForm(ctx, slug, { onDone: (v) => afterDecision(v) }))
        : h("p", { class: "hint" }, whoCanDecideText(rights))
      : null;
  const headRow = h(
    "p",
    { class: "para para--fact packet__verdict" },
    chip("Verdict", VERDICT_LABEL[verdict] ?? verdict, { tone: VERDICT_TONE[verdict] ?? "muted", tip: verdict === "pending" ? "The packet awaits a decision" : `The packet was ${verdict.replace("-", " ")}` }),
    packet.decidedBy ? chip("Decided by", packet.decidedBy) : null,
    packet.decidedAt ? chip("Date", fmtDate(packet.decidedAt), { tip: packet.decidedAt }) : null,
  );
  const sec = section("packet", "Completion packet", headRow, crit.length ? h("ul", { class: "packet__criteria" }, crit) : h("p", { class: "para muted" }, "The packet lists no criteria."), subs, allEvidence, decision);

  function afterDecision(v) {
    const label = v === "approved" ? "Approved" : "Needs work";
    mount(headRow, chip("Verdict", label, { tone: VERDICT_TONE[v] ?? "muted" }), chip("Decided by", rights.current ?? "you"), chip("Date", fmtDate(new Date().toISOString())));
    sec.querySelector(".packet__decide")?.replaceWith(h("p", { class: "hint" }, v === "approved" ? "Approved. The board moves this task to Done once git sees the packet on the default branch." : "Sent back. The task returns to In process."));
  }
  return sec;
}

async function copyText(text) {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch {
      /* not focused or not permitted: fall through to the selection-based copy */
    }
  }
  const ta = h("textarea", { style: { position: "fixed", opacity: "0", top: "0", left: "0" }, "aria-hidden": "true" }, text);
  document.body.appendChild(ta);
  ta.select();
  try {
    if (!document.execCommand("copy")) throw new Error("the browser refused the clipboard write");
  } finally {
    ta.remove();
  }
}
