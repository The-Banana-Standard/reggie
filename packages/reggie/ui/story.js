// Reggie Guidebook — story.js (spec §3.2 Story column, §3.3 Spotlight card)
// Renders a Story payload (docs/ui-api-contract.md → GET /api/story) into the story column:
// sections with headings and rules, the seven paragraph kinds, chips with glossary tooltips,
// [[route|label]] links through entityLink, empty-state blocks with inline forms, the
// story→map sync (hover → highlight, IntersectionObserver → softHighlight) and the map→story
// tint. Also the Spotlight card (GET /api/explain) and the skeleton shown while a level loads.
//
// Module interface (ui/DOM-CONTRACT.md §4):
//   renderStory(container, story, deps)      deps: { map, reader, repo, route, onDecide, onCapture, onNote, onJournal, onWiden,
//                                                    GLOSSARY?, entityLink?, post?, toast?, navigate? }
//   renderSpotlight(container, explain, deps) deps: { map, repo, onClose, onAddNote, entityLink?, navigate? }
//   renderSkeleton(container, headings)
//   renderParagraph(p, deps) → Element
//   sectionHeadingsFor(scope, lens) → string[]
//   tintForNode(id) → number of paragraphs tinted (null clears)
//   closeSpotlight(), focusNoteForm(prefill), linkifyWith(text, deps)
//
// Every helper that lives in app.js (h, icon, GLOSSARY, entityLink, post, …) can be overridden through deps so the
// module also runs inside ui/dev/story-harness.html without the shell.

import {
  h,
  mount,
  icon,
  entityLink as appEntityLink,
  kindForRoute,
  routeForNode,
  formatRoute,
  GLOSSARY as APP_GLOSSARY,
  CHIP_LABELS,
  post as appPost,
  withRepo,
  toast as appToast,
  navigate as appNavigate,
  setQuery,
  on as appOn,
  section as appSection,
  skeleton as appSkeleton,
  setSectionCollapsed as appSetSectionCollapsed,
} from "./app.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Fixed section headings per scope (spec §2 tables). `lens=knowledge` adds Gaps to area and file. */
const HEADINGS = {
  repo: [
    ["needs-you", "Needs you"],
    ["what", "About this repo"],
    ["made-of", "What it is made of"],
    ["starts", "Where it starts"],
    ["talks", "How the pieces talk"],
    ["flight", "What is in flight"],
    ["recent", "What happened recently"],
    ["gaps", "What nobody has written down"],
    ["run", "How to run it"],
  ],
  area: [
    ["read-first", "Read these first"],
    ["inside", "What is in here"],
    ["uses", "What it depends on"],
    ["used-by", "What depends on it"],
    ["tests", "Tests"],
    ["people", "Who works here"],
    ["tasks", "Tasks that will touch this area"],
    ["recent", "Recently"],
  ],
  file: [
    ["read-first", "Read these first"],
    ["exports", "What it exports"],
    ["used-by", "Who uses it"],
    ["uses", "What it uses"],
    ["tests", "Tests"],
    ["tasks", "Tasks"],
    ["history", "History"],
    ["add-note", "Add a note"],
  ],
  task: [
    ["state", "State"],
    ["owner", "Owner"],
    ["problem", "Problem"],
    ["approach", "Approach"],
    ["files", "Files to touch"],
    ["criteria", "Acceptance criteria"],
    ["verification", "Verification"],
    ["assumptions", "Assumptions"],
    ["scope", "Out of scope"],
    ["bail", "Bail conditions"],
    ["risk", "Risk"],
    ["packet", "Completion packet"],
    ["journal", "Journal for this task"],
  ],
  workspace: [
    ["needs-you", "Needs you"],
    ["repos", "Repos"],
    ["connect", "How they connect"],
  ],
  services: [
    ["needs-attention", "Needs attention"],
    ["talks-to", "What this repo talks to"],
    ["secrets", "Where the secrets come from"],
    ["not-wired", "What is not wired up"],
  ],
  flow: [
    ["steps", "How the data moves"],
    ["not-derivable", "What could not be derived"],
  ],
};
const GAPS_HEADING = ["gaps", "What nobody has written down"];

const NOTE_TYPES = ["why", "how", "gotcha", "verify", "data-source", "decision"];
const CONFIDENCES = ["high", "medium", "low"];
const KIND_LABEL = { repo: "repo", dir: "area", area: "area", file: "file", symbol: "symbol", sym: "symbol", task: "task", person: "person", entity: "entity", fold: "area", ghost: "area", note: "note", journal: "journal", service: "service", flow: "data flow" };
const KIND_ICON = { repo: "repo", dir: "area", area: "area", file: "file", symbol: "symbol", sym: "symbol", task: "task", person: "person", entity: "note", fold: "area", ghost: "area", note: "note", journal: "journal", entry: "entry", test: "test", service: "service", flow: "flow" };
const LINK_RE = /\[\[([^\]|]+)\|([^\]|]*)(?:\|([a-z-]+))?\]\]/g;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// ---------------------------------------------------------------------------
// Module state (one story and one spotlight at a time)
// ---------------------------------------------------------------------------

const live = {
  observer: null, // IntersectionObserver for the reading mode
  readingEl: null,
  mapSubs: [], // unsubscribe functions for map.on('hover' | 'hoverEnd')
  spotlight: null, // { container, card, deps }
  escapeWired: false,
};

// ---------------------------------------------------------------------------
// Deps and small helpers
// ---------------------------------------------------------------------------

function resolveDeps(deps) {
  const d = deps ?? {};
  return {
    ...d,
    map: d.map ?? null,
    reader: d.reader ?? null,
    repo: d.repo ?? null,
    route: d.route ?? null,
    GLOSSARY: d.GLOSSARY ?? APP_GLOSSARY ?? {},
    entityLink: d.entityLink ?? appEntityLink,
    post: d.post ?? ((url, body) => appPost(withRepo(url, d.repo), body)),
    toast: d.toast ?? appToast,
    navigate: d.navigate ?? appNavigate,
  };
}

function refsAttr(refs) {
  return Array.isArray(refs) ? refs.filter(Boolean).join(" ") : refs ? String(refs) : "";
}

/** "2026-09-06" → "6 Sep" (this year) or "6 Sep 2025"; anything else is returned as given. */
export function formatDate(value) {
  if (!value) return "";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value));
  if (!m) return String(value);
  const year = Number(m[1]);
  const month = MONTHS[Number(m[2]) - 1] ?? m[2];
  const day = Number(m[3]);
  return year === new Date().getFullYear() ? `${day} ${month}` : `${day} ${month} ${year}`;
}

/** Duration token from CSS (`--t-spot`) in ms; respects prefers-reduced-motion through the token itself. */
function cssMs(token, fallback) {
  try {
    const v = getComputedStyle(document.documentElement).getPropertyValue(token).trim();
    if (!v) return fallback;
    if (v.endsWith("ms")) return Number.parseFloat(v);
    if (v.endsWith("s")) return Number.parseFloat(v) * 1000;
    return Number.parseFloat(v) || fallback;
  } catch {
    return fallback;
  }
}

/** Labelled chip with a tooltip from the glossary (spec §5.2: never a dot-joined tuple). */
export function chipEl(label, value, opts, d) {
  const glossary = (d && d.GLOSSARY) || APP_GLOSSARY || {};
  const o = opts ?? {};
  const key = String(value ?? "").toLowerCase();
  // A tip that only repeats the chip's own text is not a tooltip: fall through to the glossary, and
  // to the first word of the value ("Claude via jacobpress" -> claude) after that (F16).
  const echo = label ? `${label}: ${value}` : String(value);
  const supplied = o.tip && o.tip !== echo ? o.tip : null;
  const first = key.split(/[^a-z0-9-]+/).filter(Boolean)[0] ?? "";
  const tip = supplied ?? glossary[key] ?? (first.length >= 3 ? glossary[first] : null) ?? echo;
  const cls = ["chip", o.tone ? `chip--${o.tone}` : null, o.code ? "chip--code" : null, o.class ?? null].filter(Boolean).join(" ");
  const attrs = { class: cls, title: tip };
  if (o.href) attrs.href = o.href;
  return h(
    o.href ? "a" : "span",
    attrs,
    o.icon ? icon(o.icon) : null,
    label ? h("span", { class: "chip__k" }, `${label}: `) : null,
    h("span", { class: "chip__v" }, String(value)),
  );
}

/**
 * Labels that name the same fact. The server and the card builders both add metadata, so a commit
 * row rendered "Written by: jacobpress · Date: 7 Sep · Date: 7 Sep · By: jacobpress" — two facts,
 * four chips (F8). Chips are keyed by the canonical label and the first one wins.
 */
const CHIP_SYNONYMS = { by: "written by", author: "written by", "authored by": "written by", when: "date", on: "date", committed: "date", slug: "task", state: "stage" };
function chipKey(c) {
  const raw = String(c.label ?? "").trim().toLowerCase().replace(/:$/, "");
  if (!raw) return `\u0000${String(c.value ?? "").toLowerCase()}`; // unlabelled chips key on their value
  return CHIP_SYNONYMS[raw] ?? raw;
}
/** Drop repeats by canonical label, and anything whose value the card header already prints. */
export function dedupeChips(chips, seenValues = []) {
  const shown = new Set(seenValues.filter(Boolean).map((v) => String(v).toLowerCase()));
  const seen = new Set();
  const out = [];
  for (const c of chips ?? []) {
    if (!c || c.value === undefined || c.value === null || c.value === "") continue;
    const key = chipKey(c);
    if (seen.has(key)) continue;
    if (shown.has(String(c.value).toLowerCase())) continue;
    seen.add(key);
    out.push(c);
  }
  return out;
}

function chipsRow(chips, d, cls = "card__chips", seenValues = []) {
  const list = dedupeChips(chips, seenValues);
  if (!list.length) return null;
  return h(
    "div",
    { class: cls },
    list.map((c) => chipEl(c.label, c.value, { tone: c.tone, tip: c.tip, href: c.href, code: c.code, icon: c.icon }, d)),
  );
}

/** Route for a note entity: "_repo" → repo, "dir/" → area, "file" → file, "kind:name" → null. */
function routeForEntity(entity, d) {
  const e = String(entity ?? "");
  const repo = d.repo ?? d.route?.repo ?? null;
  if (!e || !repo) return null;
  if (e === "_repo" || e === "." || e === "repo") return formatRoute({ level: "repo", repo, query: {} });
  if (/^[a-z-]+:/.test(e) && !e.startsWith("dir:")) return null;
  if (e.endsWith("/")) return routeForNode(repo, e.startsWith("dir:") ? e : `dir:${e}`);
  return routeForNode(repo, e);
}

/** The note entity that the inline note form writes to for this story. */
function noteEntityFor(story) {
  if (!story) return "_repo";
  switch (story.scope) {
    case "repo":
    case "workspace":
      return "_repo";
    case "area":
      return `${String(story.id).replace(/\/+$/, "")}/`;
    case "file":
      return String(story.id);
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Link markup
// ---------------------------------------------------------------------------

/**
 * "plain text with [[route|label]] links" → DocumentFragment of text nodes and entity links (kind glyph + label).
 * `[[route|label|kind]]` sets the kind; otherwise it is derived from the route shape. Backticks render as <code>.
 */
export function linkifyWith(text, deps, linkOpts) {
  const d = deps && deps.entityLink ? deps : resolveDeps(deps);
  const frag = document.createDocumentFragment();
  const s = String(text ?? "");
  let last = 0;
  for (const m of s.matchAll(LINK_RE)) {
    if (m.index > last) appendText(frag, s.slice(last, m.index));
    const route = m[1].trim();
    const label = m[2] || route;
    const kind = m[3] || kindForRoute(route);
    frag.appendChild(d.entityLink(kind, route, label, linkOpts ?? {}));
    last = m.index + m[0].length;
  }
  if (last < s.length) appendText(frag, s.slice(last));
  return frag;
}

/** Plain text with `code` spans. */
function appendText(frag, text) {
  const parts = String(text).split(/`([^`\n]*)`/g);
  parts.forEach((p, i) => {
    if (!p) return;
    if (i % 2 === 1) frag.appendChild(h("code", { class: "code" }, p));
    else frag.appendChild(document.createTextNode(p));
  });
}

// ---------------------------------------------------------------------------
// Story → map sync
// ---------------------------------------------------------------------------

/** Resolve refs through map.resolveRef; returns { ids, folded: label|null }. */
function resolveRefs(refs, d) {
  const map = d.map;
  const ids = [];
  let folded = null;
  for (const id of refs ?? []) {
    if (!id) continue;
    if (map && typeof map.resolveRef === "function") {
      let r = null;
      try {
        r = map.resolveRef(id);
      } catch {
        r = null;
      }
      if (r && r.id) {
        ids.push(r.id);
        if (r.folded && !folded) folded = r.label ?? r.id;
        continue;
      }
    }
    ids.push(id);
  }
  return { ids: Array.from(new Set(ids)), folded };
}

/** mouseenter/focus → map.highlight(refs); mouseleave/blur → map.clearHighlight() (spec §3.2). */
function wireRefs(el, refs, d) {
  const list = (refs ?? []).filter(Boolean);
  el.dataset.refs = refsAttr(list);
  if (!list.length) return el;
  const enter = () => {
    const r = resolveRefs(list, d);
    // Refs not on the canvas resolve to an ancestor or ghost; say so in the tooltip (spec §3.2).
    if (r.folded) {
      el.title = `inside ${r.folded} (folded)`;
      el.dataset.foldTitle = "1";
    } else if (el.dataset.foldTitle) {
      el.removeAttribute("title");
      delete el.dataset.foldTitle;
    }
    if (d.map && typeof d.map.highlight === "function") d.map.highlight(r.ids);
  };
  const leave = () => {
    if (d.map && typeof d.map.clearHighlight === "function") d.map.clearHighlight();
  };
  el.addEventListener("mouseenter", enter);
  el.addEventListener("mouseleave", leave);
  el.addEventListener("focusin", enter);
  el.addEventListener("focusout", leave);
  return el;
}

/** Reading mode: the paragraph crossing the top third gets .is-reading and a soft halo on the map. */
function observeReading(container, d) {
  if (live.observer) live.observer.disconnect();
  live.observer = null;
  live.readingEl = null;
  if (typeof IntersectionObserver === "undefined") return;
  const paras = Array.from(container.querySelectorAll("[data-para]"));
  if (!paras.length) return;
  const visible = new Set();
  const pick = () => {
    let best = null;
    let bestTop = Infinity;
    for (const el of visible) {
      const top = el.getBoundingClientRect().top;
      if (top < bestTop) {
        bestTop = top;
        best = el;
      }
    }
    if (best === live.readingEl) return;
    if (live.readingEl) live.readingEl.classList.remove("is-reading", "reading");
    live.readingEl = best;
    if (!best) return;
    best.classList.add("is-reading", "reading");
    const refs = (best.dataset.refs ?? "").split(" ").filter(Boolean);
    if (refs.length && d.map && typeof d.map.softHighlight === "function") d.map.softHighlight(resolveRefs(refs, d).ids);
  };
  live.observer = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (e.isIntersecting) visible.add(e.target);
        else visible.delete(e.target);
      }
      pick();
    },
    { root: null, rootMargin: "-30% 0px -60% 0px", threshold: 0 },
  );
  for (const el of paras) live.observer.observe(el);
}

function refMatches(refs, id) {
  if (!id) return false;
  const hovered = String(id).replace(/^ghost:(up|down):/, "");
  const dirPath = hovered.startsWith("dir:") ? hovered.slice(4) : null;
  for (const ref of refs) {
    const r = ref.replace(/^ghost:(up|down):/, "");
    if (r === hovered) return true;
    if (dirPath && dirPath !== "./" && !r.startsWith("task:") && !r.startsWith("person:") && !r.startsWith("repo:")) {
      const p = r.startsWith("dir:") ? r.slice(4) : r;
      if (p.startsWith(dirPath)) return true;
    }
  }
  return false;
}

/**
 * Map → story: tint the left border of every paragraph / card / Spotlight sentence whose refs include `id`
 * (a directory id also matches refs inside it). `tintForNode(null)` clears. Returns the number of tinted elements.
 */
export function tintForNode(id) {
  const scope = document;
  for (const el of scope.querySelectorAll(".is-tinted")) el.classList.remove("is-tinted");
  if (!id) return 0;
  const key = typeof id === "string" ? id : id?.id ?? null;
  if (!key) return 0;
  let n = 0;
  for (const el of scope.querySelectorAll("[data-para][data-refs], .spot__sentence[data-refs]")) {
    const refs = (el.dataset.refs ?? "").split(" ").filter(Boolean);
    if (refMatches(refs, key)) {
      el.classList.add("is-tinted");
      n += 1;
    }
  }
  return n;
}

function wireMapHover(d) {
  for (const off of live.mapSubs) {
    try {
      off?.();
    } catch {
      /* ignore */
    }
  }
  live.mapSubs = [];
  if (!d.map || typeof d.map.on !== "function") return;
  live.mapSubs.push(d.map.on("hover", (id) => tintForNode(id)));
  live.mapSubs.push(d.map.on("hoverEnd", () => tintForNode(null)));
}

// ---------------------------------------------------------------------------
// Paragraph kinds
// ---------------------------------------------------------------------------

function sectionOf(p) {
  return p && p.sectionId ? String(p.sectionId) : "";
}

/** renderParagraph(p, deps) → one paragraph or card element with data-para and data-refs. */
export function renderParagraph(p, deps) {
  const d = deps && deps.entityLink && deps.GLOSSARY ? deps : resolveDeps(deps);
  let el;
  switch (p.kind) {
    case "note":
      el = noteCard(p, d);
      break;
    case "journal":
      el = journalCard(p, d);
      break;
    case "decision":
      el = decisionCard(p, d);
      break;
    case "commit":
      el = commitPara(p, d);
      break;
    case "list":
      el = listPara(p, d);
      break;
    case "gap":
      el = factPara(p, d, "para para--gap" + (sectionOf(p) === "tests" ? " para--warn" : ""));
      break;
    case "fact":
    default:
      el = factPara(p, d, "para para--fact");
      break;
  }
  el.dataset.para = String(p.id ?? "");
  el.dataset.kind = String(p.kind ?? "fact");
  wireRefs(el, p.refs, d);
  return el;
}

function factPara(p, d, cls) {
  const chips = chipsRow(p.chips, d, "para__chips");
  return h("p", { class: cls }, linkifyWith(p.text, d), chips);
}

function listPara(p, d) {
  const items = String(p.text ?? "")
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
  return h(
    "div",
    { class: "para para--list" },
    h("ul", {}, items.map((t) => h("li", {}, linkifyWith(t, d)))),
    chipsRow(p.chips, d, "para__chips"),
  );
}

function commitPara(p, d) {
  const src = p.source ?? {};
  const sha = src.sha ? String(src.sha).slice(0, 7) : null;
  const descriptors = [];
  if (src.author) descriptors.push({ label: CHIP_LABELS.author, value: src.author, tip: `Written by: ${src.author}` });
  if (src.date) descriptors.push({ label: CHIP_LABELS.date, value: formatDate(src.date), tip: `Date: ${src.date}` });
  for (const c of p.chips ?? []) descriptors.push(c);
  const meta = dedupeChips(descriptors).map((c) => chipEl(c.label, c.value, { tone: c.tone, tip: c.tip }, d));
  if (src.slug) meta.splice(2, 0, taskChip(src.slug, d));
  return h(
    "p",
    { class: "para para--commit" },
    sha ? h("span", { class: "sha chip chip--code", title: src.sha }, sha) : null,
    sha ? " " : null,
    h("span", { class: "commit__subject" }, linkifyWith(p.text, d)),
    meta.length ? h("span", { class: "para__chips" }, meta) : null,
  );
}

function taskChip(slug, d) {
  const repo = d.repo ?? d.route?.repo ?? null;
  const href = repo ? formatRoute({ level: "task", repo, id: slug, query: {} }) : null;
  return chipEl(CHIP_LABELS.task, slug, { tone: "info", href, icon: "task", tip: `Task: ${slug}` }, d);
}

function staleChip(src, d) {
  const written = src.date ? formatDate(src.date) : "an earlier date";
  const changed = src.codeChanged ? formatDate(src.codeChanged) : "later";
  return chipEl("", "Possibly out of date", { tone: "bad", icon: "stale", tip: `Possibly out of date: written ${written}, code changed ${changed}.`, class: "chip--stale" }, d);
}

function hasChip(chips, pred) {
  return (chips ?? []).some(pred);
}

function noteCard(p, d) {
  const src = p.source ?? {};
  const type = src.type ?? (p.chips ?? []).find((c) => /^type$/i.test(c.label ?? ""))?.value ?? null;
  const stale = Boolean(src.stale) || hasChip(p.chips, (c) => /out of date|stale/i.test(String(c.value)));
  const cls = ["card", "card--note", type ? `note--${type}` : null, stale ? "is-stale" : null].filter(Boolean).join(" ");
  const entityRoute = src.entity ? routeForEntity(src.entity, d) : null;
  const entityLabel = src.entity === "_repo" ? "repo note" : src.entity ? `note on ${src.entity}` : "note";
  const head = h(
    "div",
    { class: "card__head" },
    entityRoute ? d.entityLink("note", entityRoute, entityLabel, { title: `Open ${src.entity}` }) : h("span", { class: "card__label" }, icon("note"), entityLabel),
    stale ? staleChip(src, d) : null,
  );
  const chips = p.chips && p.chips.length
    ? p.chips.filter((c) => !/out of date|stale/i.test(String(c.value))).map((c) => ({ label: c.label, value: c.value, tone: c.tone, tip: c.tip }))
    : [];
  if (!chips.length) {
    if (src.type) chips.push({ label: CHIP_LABELS.type, value: src.type });
    if (src.confidence) chips.push({ label: CHIP_LABELS.confidence, value: src.confidence });
    if (src.author) chips.push({ label: CHIP_LABELS.author, value: src.author, tip: `Written by: ${src.author}` });
    if (src.date) chips.push({ label: CHIP_LABELS.date, value: formatDate(src.date), tip: `Date: ${src.date}` });
  }
  return h("div", { class: cls }, head, h("div", { class: "card__body" }, linkifyWith(p.text, d)), chipsRow(chips, d));
}

function journalCard(p, d) {
  const src = p.source ?? {};
  const chips = [];
  if (p.chips && p.chips.length) {
    for (const c of p.chips) chips.push(c);
  } else {
    if (src.person) chips.push({ label: CHIP_LABELS.person, value: src.person, tip: `Person: ${src.person}` });
    if (src.tool) chips.push({ label: CHIP_LABELS.tool, value: src.tool });
    if (src.stage) chips.push({ label: CHIP_LABELS.stage, value: src.stage });
  }
  const head = h(
    "div",
    { class: "card__head" },
    h("span", { class: "card__label" }, icon("journal"), "journal"),
    src.date ? h("span", { class: "card__date muted", title: src.date }, formatDate(src.date)) : null,
    src.slug ? taskChip(src.slug, d) : null,
  );
  // The header owns kind, date and task; the chip row owns person, tool and stage (F8).
  const headOwns = [src.date ? formatDate(src.date) : null, src.date, src.slug, "journal"];
  return h("div", { class: "card card--journal" }, head, h("div", { class: "card__body" }, linkifyWith(p.text, d)), chipsRow(chips, d, "card__chips", headOwns));
}

function decisionCard(p, d) {
  const dec = p.decision ?? {};
  const slug = dec.slug ?? p.source?.slug ?? null;
  const head = h(
    "div",
    { class: "card__head" },
    h("span", { class: "card__label" }, icon("task"), "Needs a decision"),
    chipsRow(p.chips, d, "chips"),
  );
  const body = h("div", { class: "card__body" }, linkifyWith(p.text, d));
  const card = h("div", { class: "card card--decision" }, head, body);
  if (!slug) return card;
  if (dec.canDecide === false) {
    const who = (dec.deciders ?? []).join(", ") || "a maintainer";
    card.appendChild(h("p", { class: "hint decision__who" }, `Only ${who} can decide this one.`));
    return card;
  }
  card.appendChild(decideForm(slug, d, (res) => {
    card.querySelector(".decision__form")?.replaceWith(
      h("div", { class: "card__actions" }, chipEl("Verdict", res.verdict, { tone: res.verdict === "approved" ? "ok" : "warn", tip: `Verdict: ${res.verdict}, written to ${res.file ?? "packet.md"}` }, d)),
    );
  }));
  return card;
}

// ---------------------------------------------------------------------------
// Forms (capture / note / journal / decide) → deps.post
// ---------------------------------------------------------------------------

function formError(form, message) {
  let err = form.querySelector(".form__error");
  if (!message) {
    err?.remove();
    return;
  }
  if (!err) {
    err = h("div", { class: "form__error", role: "alert" });
    form.appendChild(err);
  }
  err.textContent = message;
}

function setBusy(form, busy) {
  for (const b of form.querySelectorAll("button, input, select, textarea")) b.disabled = busy;
  form.classList.toggle("is-busy", busy);
}

async function submit(form, d, url, body, onOk) {
  formError(form, null);
  setBusy(form, true);
  try {
    const res = await d.post(url, body);
    setBusy(form, false);
    onOk(res ?? {});
  } catch (err) {
    setBusy(form, false);
    formError(form, err?.message ?? String(err));
  }
}

function decideForm(slug, d, done) {
  const comment = h("textarea", { class: "form__textarea decision__comment", name: "comment", rows: "2", placeholder: "Optional comment for the packet", "aria-label": "Comment" });
  const form = h("form", { class: "form form--decide decision__form", on: { submit: (ev) => ev.preventDefault() } });
  const decide = (verdict) => {
    submit(form, d, "/api/decide", { slug, verdict, comment: comment.value.trim() || undefined }, (res) => {
      const r = { slug, verdict, ...res };
      d.toast?.(`${verdict === "approved" ? "Approved" : "Sent back"} \`${slug}\``, { tone: verdict === "approved" ? "ok" : "warn" });
      done(r);
      d.onDecide?.(r);
    });
  };
  form.append(
    comment,
    h(
      "div",
      { class: "form__actions card__actions" },
      h("button", { class: "btn btn--ok", type: "button", "aria-label": `Approve ${slug}`, on: { click: () => decide("approved") } }, "Approve"),
      h("button", { class: "btn btn--warn", type: "button", "aria-label": `Send ${slug} back as needs work`, on: { click: () => decide("needs-work") } }, "Needs work"),
    ),
  );
  return form;
}

function captureForm(d, story) {
  const text = h("input", { class: "form__input", name: "text", type: "text", required: true, placeholder: "One line: what should change?", "aria-label": "What should change" });
  const detail = h("textarea", { class: "form__textarea", name: "detail", rows: "2", placeholder: "Optional detail", "aria-label": "Detail" });
  const form = h("form", { class: "form form--capture" });
  form.addEventListener("submit", (ev) => {
    ev.preventDefault();
    const t = text.value.trim();
    if (!t) return formError(form, "Write one line first.");
    submit(form, d, "/api/capture", { text: t, detail: detail.value.trim() || undefined }, (res) => {
      const slug = res.slug ?? "";
      d.toast?.(`Captured as \`${slug}\``, { tone: "ok" });
      const repo = d.repo ?? d.route?.repo ?? story?.id ?? null;
      const route = repo && slug ? formatRoute({ level: "task", repo, id: slug, query: {} }) : null;
      form.replaceWith(
        h("p", { class: "para para--fact form__done" }, "Captured as ", route ? d.entityLink("task", route, slug) : h("code", {}, slug), " — it is now ungroomed."),
      );
      d.onCapture?.(res);
    });
  });
  form.append(
    h("div", { class: "form__row" }, text),
    detail,
    h(
      "div",
      { class: "form__actions" },
      h("button", { class: "btn btn--primary", type: "submit" }, "Capture"),
      h("span", { class: "hint" }, "Lands in intake as an ungroomed task."),
    ),
  );
  return form;
}

function noteForm(d, story, opts = {}) {
  const entity = opts.entity ?? noteEntityFor(story) ?? "_repo";
  const type = h("select", { class: "form__select", name: "type", "aria-label": "Note type" }, NOTE_TYPES.map((t) => h("option", { value: t, selected: t === (opts.type ?? "why") ? true : null, title: d.GLOSSARY?.[t] ?? null }, t)));
  const confidence = h("select", { class: "form__select", name: "confidence", "aria-label": "Confidence" }, CONFIDENCES.map((c) => h("option", { value: c, selected: c === "medium" ? true : null, title: d.GLOSSARY?.[c] ?? null }, c)));
  const text = h("textarea", { class: "form__textarea", name: "text", rows: "3", required: true, placeholder: "What should the next person know?", "aria-label": "Note text" });
  if (opts.prefill) text.value = opts.prefill;
  const form = h("form", { class: "form form--note", dataset: { entity } });
  form.addEventListener("submit", (ev) => {
    ev.preventDefault();
    const t = text.value.trim();
    if (!t) return formError(form, "Write the note first.");
    submit(form, d, "/api/note", { entity, type: type.value, text: t, confidence: confidence.value }, (res) => {
      d.toast?.(`Note added to \`${res.entity ?? entity}\``, { tone: "ok" });
      const entry = res.entry ?? {};
      const card = renderParagraph(
        {
          id: `note-new-${Date.now()}`,
          kind: "note",
          text: entry.text ?? t,
          refs: [],
          source: { entity: res.entity ?? entity, type: entry.type ?? type.value, confidence: entry.confidence ?? confidence.value, author: entry.author ?? "you (web)", date: entry.date ?? new Date().toISOString().slice(0, 10) },
        },
        d,
      );
      form.replaceWith(card);
      d.onNote?.(res);
    });
  });
  form.append(
    h(
      "div",
      { class: "form__row" },
      h("label", { class: "form__label" }, "Type ", type),
      h("label", { class: "form__label" }, "Confidence ", confidence),
      h("span", { class: "form__label form__entity", title: `The note is written to notes/${entity === "_repo" ? "_repo.md" : entity}` }, "on ", h("code", {}, entity)),
    ),
    text,
    h("div", { class: "form__actions" }, h("button", { class: "btn btn--primary", type: "submit" }, "Add note")),
  );
  return form;
}

function journalForm(d, story) {
  const text = h("textarea", { class: "form__textarea", name: "text", rows: "3", required: true, placeholder: "What happened?", "aria-label": "Journal text" });
  const slug = story?.scope === "task" ? String(story.id) : undefined;
  const form = h("form", { class: "form form--journal" });
  form.addEventListener("submit", (ev) => {
    ev.preventDefault();
    const t = text.value.trim();
    if (!t) return formError(form, "Write the entry first.");
    submit(form, d, "/api/journal", { text: t, slug }, (res) => {
      d.toast?.("Recorded in the journal", { tone: "ok" });
      const card = renderParagraph(
        { id: `journal-new-${Date.now()}`, kind: "journal", text: res.text ?? t, refs: [], source: { person: res.person ?? "you", tool: res.tool ?? "human", stage: res.stage ?? undefined, slug: res.slug ?? slug, date: res.date ?? res.at ?? new Date().toISOString().slice(0, 10) } },
        d,
      );
      form.replaceWith(card);
      d.onJournal?.(res);
    });
  });
  form.append(text, h("div", { class: "form__actions" }, h("button", { class: "btn btn--primary", type: "submit" }, "Record")));
  return form;
}

/** Scroll to and focus the inline note form (the Spotlight's "Add a note" and the reader's selection prefill). */
export function focusNoteForm(prefill) {
  const form = document.querySelector(".form--note");
  if (!form) return false;
  const text = form.querySelector("textarea");
  if (prefill && text) text.value = text.value ? `${text.value}\n${prefill}` : prefill;
  const sec = form.closest(".section");
  if (sec?.classList.contains("is-collapsed")) appSetSectionCollapsed(sec, false);
  sec?.scrollIntoView({ behavior: "smooth", block: "start" });
  text?.focus({ preventScroll: true });
  return true;
}

// ---------------------------------------------------------------------------
// Empty-state blocks and section extras
// ---------------------------------------------------------------------------

function widenButton(d, sectionEl) {
  return h(
    "button",
    {
      class: "btn btn--small",
      type: "button",
      on: {
        click: (ev) => {
          ev.currentTarget.disabled = true;
          if (typeof d.onWiden === "function") d.onWiden(60);
          else setQuery({ days: "60" });
          sectionEl?.classList.add("is-widened");
        },
      },
    },
    "Widen to 60 days",
  );
}

function alreadyWide(d) {
  return String(d.route?.query?.days ?? "") === "60";
}

function emptyBlock(sec, story, d, sectionEl) {
  const e = sec.empty ?? {};
  const action = e.action ?? null;
  const block = h("div", { class: "card card--empty empty", role: "note" }, h("p", { class: "empty__text" }, linkifyWith(e.text ?? "Nothing here yet.", d)));
  if (!action) return block;
  const label = action.label ?? "";
  if (action.form === "capture") block.appendChild(captureForm(d, story));
  else if (action.form === "note") block.appendChild(noteForm(d, story));
  else if (action.form === "journal") block.appendChild(journalForm(d, story));
  else if (action.route) block.appendChild(h("div", { class: "card__actions" }, h("a", { class: "btn btn--small", href: action.route.startsWith("#") ? action.route : `#${action.route}` }, label || action.route)));
  else if (/widen|60 days/i.test(label) || sec.id === "recent") {
    if (!alreadyWide(d)) block.appendChild(h("div", { class: "card__actions" }, widenButton(d, sectionEl)));
  } else if (label && !action.command) block.appendChild(h("div", { class: "card__actions" }, h("button", { class: "btn btn--small", type: "button", on: { click: () => d.onAction?.(action, sec) } }, label)));
  if (action.command) {
    const copy = h("button", { class: "btn btn--link cmd__copy", type: "button", "aria-label": "Copy command", title: "Copy", on: { click: () => copyText(action.command, d) } }, icon("copy"));
    block.appendChild(h("p", { class: "empty__hint hint" }, action.form || action.route ? "Or from a terminal: " : `${label ? `${label}: ` : ""}`, h("code", {}, action.command), " ", copy));
  }
  return block;
}

function copyText(text, d) {
  try {
    navigator.clipboard?.writeText(text).then(
      () => d.toast?.("Copied", { tone: "ok", ms: 1500 }),
      () => d.toast?.("Could not copy", { tone: "warn" }),
    );
  } catch {
    d.toast?.("Could not copy", { tone: "warn" });
  }
}

/** "How to run it": commands as copyable <code> chips inside a collapsed <details>. */
function commandsBlock(sec, d) {
  const cmds = [];
  for (const p of sec.paragraphs ?? []) {
    for (const line of String(p.text ?? "").split("\n")) {
      const t = line.trim();
      if (t) cmds.push({ text: t, refs: p.refs ?? [], id: p.id });
    }
  }
  const list = h(
    "ul",
    { class: "cmds__list" },
    cmds.map((c, i) =>
      wireRefs(
        h(
          "li",
          { class: "cmd", dataset: { para: `${c.id ?? "cmd"}-${i}` } },
          h("code", { class: "cmd__code chip chip--code" }, c.text),
          h("button", { class: "btn btn--link cmd__copy", type: "button", "aria-label": `Copy ${c.text}`, title: "Copy", on: { click: () => copyText(c.text, d) } }, icon("copy")),
        ),
        c.refs,
        d,
      ),
    ),
  );
  return h("details", { class: "cmds" }, h("summary", {}, `${cmds.length} command${cmds.length === 1 ? "" : "s"}`), list);
}

// ---------------------------------------------------------------------------
// Sections and the whole story
// ---------------------------------------------------------------------------

function renderSection(sec, story, d) {
  const paragraphs = Array.isArray(sec.paragraphs) ? sec.paragraphs : [];
  const empty = paragraphs.length === 0;
  if (empty && !sec.empty) return null; // e.g. "Needs you" with nothing awaiting a decision (spec: section hidden)
  const el = appSection(sec.id, sec.heading ?? headingFor(story.scope, sec.id));
  el.dataset.kind = empty ? "empty" : "filled";
  if (empty) {
    el.appendChild(emptyBlock(sec, story, d, el));
    return el;
  }
  if (sec.id === "run") {
    el.appendChild(commandsBlock(sec, d));
    return el;
  }
  paragraphs.forEach((p, i) => {
    const node = renderParagraph({ ...p, sectionId: sec.id }, d);
    if (i > 0) node.classList.add("section__more");
    el.appendChild(node);
  });
  if (sec.id === "recent" && story.scope === "repo" && !alreadyWide(d)) {
    el.appendChild(h("div", { class: "section__foot section__more" }, widenButton(d, el)));
  }
  if (sec.id === "add-note" && !el.querySelector(".form--note")) {
    el.appendChild(h("div", { class: "card card--empty empty section__more" }, noteForm(d, story)));
  }
  return el;
}

function headingFor(scope, id) {
  const row = (HEADINGS[scope] ?? []).find(([sid]) => sid === id) ?? (id === "gaps" ? GAPS_HEADING : null);
  return row ? row[1] : id;
}

/**
 * renderStory(container, story, deps): sections in order, each with h2 + rule and its paragraphs;
 * wires story→map hover, the reading observer and the map→story tint. Returns the container.
 */
export function renderStory(container, story, deps) {
  const d = resolveDeps(deps);
  const s = dedupeSoleAuthor(dedupeLead(story ?? { sections: [] }));
  const nodes = [];
  // On the file and symbol levels the Spotlight is pinned above this column and opens with the same
  // sentence ("graph.ts is a TypeScript file of 1159 lines in packages/reggie"), so the meta line
  // would be the second copy of it in the first 200px (F13).
  const spotlit = d.route?.level === "file" || d.route?.level === "symbol";
  if (s.subtitle && !spotlit) nodes.push(h("p", { class: "story__subtitle muted" }, linkifyWith(s.subtitle, d)));
  for (const sec of s.sections ?? []) {
    const el = renderSection(sec, s, d);
    if (el) nodes.push(el);
  }
  if (Array.isArray(s.next) && s.next.length) {
    nodes.push(
      h(
        "nav",
        { class: "story__next", "aria-label": "Where next" },
        h("span", { class: "story__next-label muted" }, "Where next"),
        s.next.map((n) => d.entityLink(kindForRoute(n.route), n.route, n.label)),
      ),
    );
  }
  mount(container, nodes);
  container.classList.remove("is-skeleton");
  wireMapHover(d);
  observeReading(container, d);
  return container;
}

/** Text as the reader sees it: link markup flattened to its labels, whitespace and full stop dropped. */
function plainText(t) {
  return String(t ?? "")
    .replace(/\[\[([^\]|]+)\|([^\]|]+)(?:\|[^\]]+)?\]\]/g, "$2")
    .replace(/`/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[.\s]+$/, "");
}

/**
 * The description already sits in the header row above the sections. When the first section opens by
 * repeating it word for word, the most valuable 200px of the page says the same thing twice — so drop
 * the repeat and let the notes lead, unless the repeat is all the section has (F13).
 */
function dedupeLead(story) {
  const sub = plainText(story?.subtitle);
  const sections = story?.sections;
  if (!sub || !Array.isArray(sections) || !sections.length) return story;
  const idx = sections.findIndex((sec) => Array.isArray(sec?.paragraphs) && sec.paragraphs.length > 1);
  if (idx < 0) return story;
  const sec = sections[idx];
  const first = sec.paragraphs[0];
  const lead = plainText(first?.text);
  if (!lead || lead.length < 20 || !sub.startsWith(lead)) return story;
  const next = sections.slice();
  next[idx] = { ...sec, paragraphs: sec.paragraphs.slice(1) };
  return { ...story, sections: next };
}

/**
 * "mostly by X" / "all by X" is a fact about an area. On a repo where one person wrote everything it
 * stops being a fact and becomes a refrain: seven area lines each ending in the same name, under an
 * Owners lens whose swatches are all one colour. The clause is stripped from every line and said
 * once, at the top of the section that carried it, so the reader learns the same thing in one place
 * instead of seven. It only fires when two or more lines name an author and every one of them names
 * the same person — a repo with two authors keeps its per-area attribution, which is the whole point
 * of the channel.
 */
const authorClause = () => /,\s*(?:mostly|all) by (\[\[([^\]|]+)\|([^\]|]+)\]\])/g;

function dedupeSoleAuthor(story) {
  const sections = story?.sections;
  if (!Array.isArray(sections) || !sections.length) return story;
  let handle = null;
  let markup = null;
  let hits = 0;
  let at = -1;
  let mixed = false;
  sections.forEach((sec, i) => {
    for (const para of sec?.paragraphs ?? []) {
      if (typeof para?.text !== "string") continue;
      for (const m of para.text.matchAll(authorClause())) {
        hits += 1;
        if (handle === null) {
          handle = m[3];
          markup = m[1];
          at = i;
        } else if (m[3] !== handle) {
          mixed = true;
        }
      }
    }
  });
  if (mixed || hits < 2 || at < 0) return story;
  const next = sections.map((sec) => {
    const paras = sec?.paragraphs;
    if (!Array.isArray(paras)) return sec;
    let touched = false;
    const stripped = paras.map((para) => {
      if (typeof para?.text !== "string") return para;
      const text = para.text.replace(authorClause(), "");
      if (text === para.text) return para;
      touched = true;
      return { ...para, text };
    });
    return touched ? { ...sec, paragraphs: stripped } : sec;
  });
  const lead = {
    id: "sole-author",
    kind: "fact",
    text: `Every area here was written mostly by ${markup}; the lines below do not repeat the name.`,
    refs: [`person:${handle}`],
  };
  next[at] = { ...next[at], paragraphs: [lead, ...(next[at].paragraphs ?? [])] };
  return { ...story, sections: next };
}

/** The fixed headings for a scope, used by the skeleton before the payload arrives. */
export function sectionHeadingsFor(scope, lens) {
  const rows = HEADINGS[scope] ?? HEADINGS.repo;
  const out = rows.map(([, heading]) => heading);
  if (lens === "knowledge" && (scope === "area" || scope === "file")) out.push(GAPS_HEADING[1]);
  return out;
}

/** Section headings with three skeleton bars under each (spec §3.1 loading). */
export function renderSkeleton(container, headings) {
  const list = Array.isArray(headings) && headings.length ? headings : sectionHeadingsFor("repo");
  mount(
    container,
    list.map((hd, i) => {
      const id = typeof hd === "object" && hd ? hd.id ?? `s${i}` : `s${i}`;
      const label = typeof hd === "object" && hd ? hd.heading ?? hd.label ?? String(id) : String(hd);
      const sec = appSection(id, label, appSkeleton());
      sec.classList.add("section--skeleton");
      sec.setAttribute("aria-busy", "true");
      return sec;
    }),
  );
  container.classList.add("is-skeleton");
  if (live.observer) live.observer.disconnect();
  live.observer = null;
  live.readingEl = null;
  return container;
}

// ---------------------------------------------------------------------------
// Spotlight (spec §3.3)
// ---------------------------------------------------------------------------

function wireEscape() {
  if (live.escapeWired) return;
  live.escapeWired = true;
  try {
    appOn("escape", () => {
      if (!live.spotlight) return false;
      closeSpotlight();
      return true;
    });
  } catch {
    /* app.js not available (harness): the harness wires its own Escape */
  }
}

/** Close the pinned Spotlight with a 180 ms fade. Returns true when one was open. */
export function closeSpotlight(opts = {}) {
  const cur = live.spotlight;
  if (!cur) return false;
  live.spotlight = null;
  const { card, container, deps } = cur;
  const finish = () => {
    if (card.isConnected) card.remove();
    if (container && container.childElementCount === 0) container.classList.remove("has-spotlight");
    deps?.onClose?.();
  };
  if (opts.immediate) finish();
  else {
    card.classList.add("is-leaving");
    setTimeout(finish, cssMs("--t-spot", 180));
  }
  return true;
}

/**
 * renderSpotlight(container, explain, deps): kind glyph + title + kind badge + crumbs, exactly four sentences with
 * data-refs, three actions (Go deeper / Show what breaks if it changes / Add a note), × and Escape close.
 * Only one is pinned at a time; pinning fades in over 180 ms.
 */
export function renderSpotlight(container, explain, deps) {
  const d = resolveDeps(deps);
  wireEscape();
  if (live.spotlight) closeSpotlight({ immediate: true });
  const ex = explain ?? {};
  const kind = KIND_ICON[ex.kind] ?? "file";
  const kindLabel = KIND_LABEL[ex.kind] ?? String(ex.kind ?? "entity");
  const closeBtn = h("button", { class: "btn btn--icon btn--ghost card__close", type: "button", "aria-label": "Close spotlight", title: "Close (Esc)", on: { click: () => closeSpotlight() } }, icon("close"));
  const head = h(
    "div",
    { class: "card__head spot__head" },
    icon(kind),
    ex.route ? h("a", { class: "card__title spot__title", href: ex.route.startsWith("#") ? ex.route : `#${ex.route}` }, ex.title ?? ex.id ?? "") : h("span", { class: "card__title spot__title" }, ex.title ?? ex.id ?? ""),
    h("span", { class: "badge spot__kind", title: `Kind: ${kindLabel}` }, kindLabel),
    closeBtn,
  );
  const crumbs = Array.isArray(ex.crumbs) && ex.crumbs.length
    ? h(
        "div",
        { class: "card__crumbs spot__crumbs" },
        ex.crumbs.flatMap((c, i) => [i > 0 ? h("span", { class: "crumbs__sep", "aria-hidden": "true" }, "›") : null, h("a", { class: "spot__crumb", href: c.route.startsWith("#") ? c.route : `#${c.route}` }, c.label)]),
      )
    : null;
  const sentences = (Array.isArray(ex.sentences) ? ex.sentences : []).slice(0, 4).map((s, i) => {
    const p = h("p", { class: "spot__sentence", dataset: { sentence: String(i + 1) } }, linkifyWith(s.text, d));
    wireRefs(p, s.refs, d);
    return p;
  });
  const actions = (Array.isArray(ex.actions) ? ex.actions : []).slice(0, 3).map((a, i) => {
    const isNote = /note/i.test(a.label ?? "") || i === 2;
    if (isNote) {
      return h(
        "button",
        {
          class: "btn btn--small",
          type: "button",
          on: {
            click: () => {
              if (typeof d.onAddNote === "function") return d.onAddNote(ex, a);
              if (focusNoteForm()) return undefined;
              if (a.route) d.navigate(a.route);
              return undefined;
            },
          },
        },
        icon("note"),
        a.label ?? "Add a note",
      );
    }
    const glyph = i === 0 ? "entry" : "external";
    return h("a", { class: "btn btn--small", href: a.route && a.route.startsWith("#") ? a.route : `#${a.route ?? ""}` }, icon(glyph), a.label ?? a.route);
  });
  const card = h(
    "div",
    { class: "card card--spotlight", role: "region", "aria-label": `Spotlight: ${ex.title ?? ""}`, dataset: { id: String(ex.id ?? "") }, "data-refs": String(ex.id ?? "") },
    head,
    crumbs,
    h("div", { class: "spot__body" }, sentences),
    actions.length ? h("div", { class: "card__actions spot__actions" }, actions) : null,
  );
  mount(container, card);
  container.classList.add("has-spotlight");
  live.spotlight = { card, container, deps: d };
  return card;
}

export function currentSpotlight() {
  return live.spotlight ? live.spotlight.card : null;
}
