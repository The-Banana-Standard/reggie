/**
 * reader.js — the source reader drawer under the map (spec §2 Level 3 "Reader drawer",
 * §3.1, §5.2, §5.6; DOM-CONTRACT.md §4). Owns everything inside `#reader`.
 *
 *   createReader(container, deps) → { open, close, scrollTo, isOpen, current }
 *
 * deps (all optional):
 *   fetchJson(url, { fresh }?) → Promise<FilePayload>
 *                                           JSON fetch; default is a same-origin fetch that throws
 *                                           an Error carrying `.status`. app.js passes its cached `api`;
 *                                           `fresh: true` asks it to go past that cache, which the reader
 *                                           does whenever it needs to know whether a branch has moved.
 *   onNoteRequest(prefillText, ctx)         Called from the floating "Add a note about lines a–b" button
 *                                           with `(lines a–b) ` and ctx = { path, from, to, text }.
 *                                           `onNotePrefill` is accepted as an alias (DOM contract name).
 *   editorScheme, root                      Fallback for "Open in editor" when the payload has no
 *                                           `editorUrl`: `<scheme>/<root>/<path>:<line>` (default vscode://file).
 *   repo / withRepo(url)                    Adds `?repo=` to `/api/file` and `/api/filediff` in workspace mode.
 *   onModeChange(slug | null)               Called by the head's mode button: null asks for the file as it is
 *                                           now, a slug asks for that task's change again. app.js rewrites
 *                                           `?diff=` on the route; without the dep the reader reopens itself.
 *
 * open(path, { line?, endLine?, highlight?, symbols?, file?, fresh?, diff? })
 *   `file` is a pre-fetched /api/file payload (skips the fetch); `symbols` overrides the payload's
 *   symbol list (e.g. from /api/symbols); `highlight` is a symbol name or { line, endLine }.
 *   `diff` is a task slug: the reader then shows what that task changed in the file, from
 *   /api/filediff, instead of the file. The rows arrive built (ctx / add / del / gap, with their line
 *   numbers); this module only draws them. A row that has a new-side number keeps `data-line`, so
 *   scrollTo, the highlight and select-to-note mean the same thing in both modes; symbol marks are
 *   dropped, because they are computed from this checkout's text and the rows are the branch's.
 *   A change is only the same change while it is read between the same two commits: what is already
 *   drawn is kept when `file` (or, without one, a fresh first page) carries the same `range`, and is
 *   drawn again when the branch has moved. A later page from another range is never appended.
 *   Resolves once the source is rendered (or the error card is shown).
 * scrollTo(line, endLine?) — highlights line..endLine with --panel-2 and scrolls the first line into
 *   view; queued when called before the file has loaded. In diff mode a line is a new-side number.
 *
 * The module has no imports so ui/dev/reader-harness.html can load it without app.js.
 */

const MIN_HEIGHT = 120; // px — spec: min 120px
const DEFAULT_SHARE = 0.4; // spec: 40% of the map column by default
const MAP_MIN = 120; // px of canvas always kept above the drawer
const STORAGE_KEY = "reggie.reader.height";
const SHOWN_CHARS = 20_000; // spec: first 20 000 characters
const FILE_ENDPOINT = "/api/file";
const DIFF_ENDPOINT = "/api/filediff";
const STATUS_LABEL = { added: "Added", deleted: "Deleted", modified: "Modified", renamed: "Renamed", copied: "Copied", typechange: "Type changed" };
const SIGN = { add: "+", del: "\u2212" };

// ---------------------------------------------------------------------------
// Small DOM helpers (kept local so this module stays import-free)
// ---------------------------------------------------------------------------

function el(tag, attrs, ...children) {
  const node = document.createElement(tag);
  if (attrs && typeof attrs === "object") {
    for (const [k, v] of Object.entries(attrs)) {
      if (v === null || v === undefined || v === false) continue;
      if (k === "class") node.className = v;
      else if (k === "text") node.textContent = v;
      else if (v === true) node.setAttribute(k, "");
      else node.setAttribute(k, String(v));
    }
  }
  for (const child of children.flat()) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

function icon(name, size) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("class", size === 16 ? "i i--16" : "i");
  svg.setAttribute("aria-hidden", "true");
  const use = document.createElementNS("http://www.w3.org/2000/svg", "use");
  use.setAttribute("href", `#i-${name}`);
  svg.appendChild(use);
  return svg;
}

/** "20 000" — thousands separated by a no-break space, as the spec writes numbers. */
function fmt(n) {
  return String(Math.max(0, Math.round(Number(n) || 0))).replace(/\B(?=(\d{3})+(?!\d))/g, " ");
}

function toInt(v) {
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function reducedMotion() {
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

function readStoredHeight() {
  try {
    const v = Number(localStorage.getItem(STORAGE_KEY));
    return Number.isFinite(v) && v > 0 ? v : null;
  } catch {
    return null;
  }
}

function writeStoredHeight(px) {
  try {
    if (px === null) localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, String(Math.round(px)));
  } catch {
    /* private mode or quota: ignore */
  }
}

async function defaultFetchJson(url) {
  const res = await fetch(url, { headers: { accept: "application/json" }, credentials: "same-origin" });
  let body = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  if (!res.ok) {
    const err = new Error(body?.error ?? `${res.status} ${res.statusText}`);
    err.status = res.status;
    throw err;
  }
  return body;
}

/**
 * The `/api/filediff` address for one file of a task's change. Exported because app.js asks the same
 * question first, to learn whether the file is on the map, and the two must spell the URL alike for
 * its fetch cache to answer the reader's request.
 */
export function diffUrl(path, slug, offset = 0) {
  const url = `${DIFF_ENDPOINT}?slug=${encodeURIComponent(slug)}&path=${encodeURIComponent(path)}`;
  return offset > 0 ? `${url}&offset=${offset}` : url;
}

/** The editor link base: the payload's editorUrl without a trailing :line(:col), else built from deps. */
function editorBase(file, path, deps) {
  if (file?.editorUrl) return String(file.editorUrl).replace(/:\d+(?::\d+)?$/, "");
  if (deps.root && path) {
    const scheme = String(deps.editorScheme || "vscode://file").replace(/\/+$/, "");
    const abs = `${String(deps.root).replace(/\/+$/, "")}/${path}`;
    return `${scheme}/${encodeURI(abs)}`;
  }
  return null;
}

// ---------------------------------------------------------------------------
// createReader
// ---------------------------------------------------------------------------

export function createReader(container, deps = {}) {
  if (!container) throw new Error("createReader: container is required");
  const fetchJson = typeof deps.fetchJson === "function" ? deps.fetchJson : defaultFetchJson;
  const noteHandler = typeof deps.onNoteRequest === "function" ? deps.onNoteRequest : typeof deps.onNotePrefill === "function" ? deps.onNotePrefill : null;

  const st = {
    open: false,
    path: null, // path currently shown (or loading)
    file: null, // rendered payload
    lines: [], // rendered source lines
    rows: [], // .reader__line elements by index (line - 1)
    symbols: [],
    token: 0, // load token; stale fetches are dropped
    pending: null, // { line, endLine } requested before the file loaded
    heightPx: null,
    closing: null, // cancel handle for the close transition
    selection: null, // { from, to, text } behind the floating note button
    selTimer: 0,
    diff: null, // task slug while the reader shows that task's change instead of the file
    byLine: new Map(), // diff mode: new-side line number → .reader__line
    shownRows: 0, // diff mode: rows drawn so far, the offset of the next page
    widest: 1, // diff mode: the largest line number drawn, which sizes the gutter
    lastDiff: null, // { where, slug } of the last change shown, so the plain file can offer the way back
    check: 0, // revalidation counter: a newer "has the branch moved?" question drops an older one's answer
  };

  // ---- DOM skeleton: handle, head, banner, body ---------------------------

  const grip = el("span", { class: "reader__grip", "aria-hidden": "true" });
  const handle = el(
    "div",
    {
      class: "reader__handle",
      role: "separator",
      "aria-orientation": "horizontal",
      "aria-label": "Resize the reader (drag, or arrow keys; double-click to reset)",
      "aria-valuemin": String(MIN_HEIGHT),
      tabindex: "0",
      title: "Drag to resize · double-click to reset",
    },
    grip,
  );

  const dirEl = el("span", { class: "reader__dir" });
  const baseEl = el("span", { class: "reader__base" });
  const pathEl = el("span", { class: "reader__path" }, dirEl, baseEl);
  const chipsEl = el("span", { class: "reader__chips" });
  const modeBtn = el("button", { class: "btn btn--small reader__mode", type: "button", hidden: true });
  const editorLink = el("a", { class: "btn btn--small reader__editor", rel: "noopener", hidden: true }, icon("external"), "Open in editor");
  const closeBtn = el("button", { class: "btn btn--tool btn--icon reader__close", type: "button", "aria-label": "Close the reader (Escape)", title: "Close (Esc)" }, icon("close", 16));
  const head = el("div", { class: "reader__head" }, icon("file"), pathEl, chipsEl, el("span", { class: "reader__actions" }, modeBtn, editorLink, closeBtn));

  const banner = el("div", { class: "reader__banner", role: "status", hidden: true });

  const noteBtn = el("button", { class: "btn btn--primary btn--small reader__note", type: "button", hidden: true });
  const body = el("div", { class: "reader__body", tabindex: "0", "aria-label": "Source" });
  body.append(noteBtn);

  container.classList.add("reader");
  container.setAttribute("role", "region");
  container.setAttribute("aria-label", "Source reader");
  container.hidden = true;
  container.replaceChildren(handle, head, banner, body);

  // ---- Height: default 40 % of the map column, min 120 px, persisted ---------

  function parentHeight() {
    const p = container.parentElement;
    return (p && p.clientHeight) || window.innerHeight;
  }
  function maxHeight() {
    return Math.max(MIN_HEIGHT, parentHeight() - MAP_MIN);
  }
  function clampHeight(px) {
    return Math.min(maxHeight(), Math.max(MIN_HEIGHT, Math.round(px)));
  }
  function defaultHeight() {
    return clampHeight(parentHeight() * DEFAULT_SHARE);
  }
  function targetHeight() {
    const stored = readStoredHeight();
    return stored ? clampHeight(stored) : defaultHeight();
  }
  function applyHeight(px) {
    st.heightPx = px;
    container.style.height = `${px}px`;
    handle.setAttribute("aria-valuenow", String(px));
    handle.setAttribute("aria-valuemax", String(maxHeight()));
  }

  let drag = null;
  handle.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    drag = { y: e.clientY, h: container.getBoundingClientRect().height, id: e.pointerId };
    try {
      handle.setPointerCapture(e.pointerId);
    } catch {
      /* not supported */
    }
    container.classList.add("is-resizing");
    e.preventDefault();
  });
  handle.addEventListener("pointermove", (e) => {
    if (!drag) return;
    applyHeight(clampHeight(drag.h + (drag.y - e.clientY)));
  });
  const endDrag = () => {
    if (!drag) return;
    drag = null;
    container.classList.remove("is-resizing");
    writeStoredHeight(st.heightPx);
  };
  handle.addEventListener("pointerup", endDrag);
  handle.addEventListener("pointercancel", endDrag);
  handle.addEventListener("lostpointercapture", endDrag);
  handle.addEventListener("dblclick", () => {
    writeStoredHeight(null);
    applyHeight(defaultHeight());
  });
  handle.addEventListener("keydown", (e) => {
    const step = e.shiftKey ? 96 : 24;
    let next = null;
    if (e.key === "ArrowUp") next = st.heightPx + step;
    else if (e.key === "ArrowDown") next = st.heightPx - step;
    else if (e.key === "Home") next = maxHeight();
    else if (e.key === "End") next = MIN_HEIGHT;
    else if (e.key === "Enter") next = defaultHeight();
    if (next === null) return;
    e.preventDefault();
    applyHeight(clampHeight(next));
    writeStoredHeight(e.key === "Enter" ? null : st.heightPx);
  });

  if (typeof ResizeObserver !== "undefined" && container.parentElement) {
    const ro = new ResizeObserver(() => {
      if (!st.open || drag || st.heightPx === null) return;
      const max = maxHeight();
      if (st.heightPx > max) applyHeight(max);
      else handle.setAttribute("aria-valuemax", String(max));
    });
    ro.observe(container.parentElement);
  }

  // ---- Open / close with the 200 ms slide (reduced-motion aware) ------------

  function drawerDuration() {
    if (reducedMotion()) return 0;
    const raw = getComputedStyle(container).transitionDuration.split(",")[0].trim();
    const n = Number.parseFloat(raw);
    if (!Number.isFinite(n)) return 0;
    return raw.endsWith("ms") ? n : n * 1000;
  }

  function afterHeightTransition(duration, fn) {
    let done = false;
    let timer = 0;
    const finish = () => {
      if (done) return;
      done = true;
      container.removeEventListener("transitionend", onEnd);
      clearTimeout(timer);
      fn();
    };
    const onEnd = (e) => {
      if (e.target === container && e.propertyName === "height") finish();
    };
    container.addEventListener("transitionend", onEnd);
    timer = setTimeout(finish, duration + 80);
    return {
      cancel() {
        done = true;
        container.removeEventListener("transitionend", onEnd);
        clearTimeout(timer);
      },
    };
  }

  function reveal() {
    if (st.closing) {
      st.closing.cancel();
      st.closing = null;
    }
    if (st.open && !container.hidden) return;
    st.open = true;
    container.hidden = false;
    const target = targetHeight();
    if (drawerDuration() > 0 && !container.classList.contains("is-open")) {
      container.style.height = "0px";
      void container.offsetHeight; // commit the start height so the transition runs
    }
    container.classList.add("is-open");
    applyHeight(target);
    document.addEventListener("selectionchange", onSelectionChange);
  }

  function close() {
    if (!st.open) return;
    st.open = false;
    // The way back to a change is offered while the reader stays open on that file, and no longer:
    // kept past a close, it would offer one repo's task on another repo's file of the same name.
    // The button is redrawn here because reopening the same plain file redraws nothing.
    st.lastDiff = null;
    if (st.path) setModeButton(st.path);
    hideNoteButton();
    document.removeEventListener("selectionchange", onSelectionChange);
    if (container.contains(document.activeElement)) document.activeElement.blur();
    container.classList.remove("is-open");
    const duration = drawerDuration();
    container.style.height = "0px";
    const finish = () => {
      st.closing = null;
      container.hidden = true;
    };
    if (duration === 0) finish();
    else st.closing = afterHeightTransition(duration, finish);
  }

  closeBtn.addEventListener("click", () => close());
  container.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && st.open) {
      e.stopPropagation();
      close();
    }
  });

  // ---- Head, banner, editor link ---------------------------------------------

  function chip(label, value, title) {
    return el("span", { class: "chip chip--muted", title: title || `${label} ${value}` }, el("span", { class: "chip__k" }, `${label}:`), el("span", { class: "chip__v" }, String(value)));
  }

  function setHead(path, file) {
    const slash = path.lastIndexOf("/");
    dirEl.textContent = slash >= 0 ? path.slice(0, slash + 1) : "";
    baseEl.textContent = slash >= 0 ? path.slice(slash + 1) : path;
    pathEl.title = path;
    chipsEl.replaceChildren();
    container.classList.toggle("is-diff", Boolean(st.diff));
    setModeButton(path);
    if (st.diff) {
      chipsEl.append(chip("Task", st.diff, `What task ${st.diff} changed in this file`));
      if (file) {
        const label = STATUS_LABEL[file.status] ?? file.status;
        chipsEl.append(el("span", { class: `chip reader__status reader__status--${file.status}`, title: file.from ? `${label} from ${file.from}` : `${label} by this task` }, label));
        if (!file.binary) {
          chipsEl.append(el("span", { class: "chip chip--muted reader__counts", title: `${fmt(file.added)} lines added, ${fmt(file.deleted)} deleted` }, el("span", { class: "reader__plus" }, `+${fmt(file.added)}`), " ", el("span", { class: "reader__minus" }, `\u2212${fmt(file.deleted)}`)));
        }
      }
    } else if (file && typeof file.text === "string") {
      const total = toInt(file.totalLines) || st.lines.length;
      chipsEl.append(chip("Lines", fmt(total), `${fmt(total)} lines in the file`));
      const exported = st.symbols.filter((s) => s && s.exported).length;
      if (exported > 0) chipsEl.append(chip("Exports", exported, `${exported} exported symbols — ▸ marks their declaration lines`));
      if (file.role && file.role !== "source") chipsEl.append(chip("Role", file.role, `This file is classified as ${file.role}`));
    }
    setEditorLine(0);
  }

  /** "Show the file" while a change is on screen; "Show the change" on the plain file a change was just left for. */
  function setModeButton(path) {
    const back = !st.diff && st.lastDiff && st.lastDiff.where === fileUrl(path, null, 0) ? st.lastDiff.slug : null;
    modeBtn.hidden = !st.diff && !back;
    if (modeBtn.hidden) return;
    modeBtn.textContent = st.diff ? "Show the file" : "Show the change";
    modeBtn.title = st.diff ? "Show this file as it is in this checkout now" : `Show what task ${back} changed in this file`;
    modeBtn.dataset.diff = st.diff ? "" : back;
  }

  modeBtn.addEventListener("click", () => {
    const next = modeBtn.dataset.diff || null;
    if (typeof deps.onModeChange === "function") deps.onModeChange(next);
    else if (st.path) open(st.path, { diff: next });
  });

  function setEditorLine(line) {
    // In diff mode the link follows the text on screen: the payload names the copy to open, or none.
    const base = st.diff ? (st.file?.editorUrl ? String(st.file.editorUrl) : null) : editorBase(st.file, st.path, deps);
    if (!base) {
      editorLink.hidden = true;
      editorLink.removeAttribute("href");
      return;
    }
    const href = line > 0 ? `${base}:${line}` : base;
    editorLink.href = href;
    editorLink.title = line > 0 ? `Open at line ${line}: ${href}` : href;
    editorLink.hidden = false;
  }

  function setBanner(file) {
    banner.replaceChildren();
    const text = typeof file?.text === "string" ? file.text : "";
    const truncated = file?.truncated === true || (file?.truncated === undefined && text.length >= SHOWN_CHARS);
    if (!truncated) {
      banner.hidden = true;
      return;
    }
    const total = toInt(file?.totalChars);
    const totalLines = toInt(file?.totalLines);
    const parts = [
      el("span", { class: "reader__banner-text" }, "Showing the first ", el("strong", {}, fmt(text.length)), total > text.length ? [" of ", el("strong", {}, fmt(total))] : null, " characters", totalLines > st.lines.length ? [" (lines 1–", fmt(st.lines.length), " of ", fmt(totalLines), ")"] : null, "."),
    ];
    const base = editorBase(file, st.path, deps);
    if (base) parts.push(el("a", { class: "btn btn--link reader__banner-link", href: base, rel: "noopener", title: base }, "Open the whole file in your editor"));
    banner.append(...parts);
    banner.hidden = false;
  }

  function bannerNote(text) {
    let extra = banner.querySelector(".reader__banner-extra");
    if (!text) {
      if (extra) extra.remove();
      if (!banner.querySelector(".reader__banner-text")) banner.hidden = true;
      return;
    }
    if (!extra) {
      extra = el("span", { class: "reader__banner-extra" });
      banner.append(extra);
    }
    extra.textContent = text;
    banner.hidden = false;
  }

  // ---- Source rendering ---------------------------------------------------------

  function showLoading() {
    hideNoteButton();
    banner.hidden = true;
    banner.replaceChildren();
    body.replaceChildren(noteBtn, el("div", { class: "skeleton reader__loading", "aria-busy": "true", "aria-label": "Loading source" }, el("div", { class: "skeleton__bar" }), el("div", { class: "skeleton__bar" }), el("div", { class: "skeleton__bar" })));
  }

  function showError(message, retry) {
    hideNoteButton();
    const card = el(
      "div",
      { class: "card card--error reader__error", role: "alert" },
      el("div", { class: "card__body" }, el("code", {}, st.diff ? DIFF_ENDPOINT : FILE_ENDPOINT), ` failed: ${message}`),
      retry ? el("div", { class: "card__actions" }, el("button", { class: "btn btn--small", type: "button" }, "Retry")) : null,
    );
    if (retry) card.querySelector("button").addEventListener("click", retry);
    body.replaceChildren(noteBtn, card);
  }

  function splitLines(text) {
    if (text === "") return [];
    const lines = text.split("\n");
    if (lines.length > 1 && lines[lines.length - 1] === "") lines.pop();
    return lines.map((l) => (l.endsWith("\r") ? l.slice(0, -1) : l));
  }

  function symbolLabel(sym) {
    const span = sym.endLine && sym.endLine !== sym.line ? `lines ${sym.line}–${sym.endLine}` : `line ${sym.line}`;
    const used = Array.isArray(sym.usedBy) ? sym.usedBy.length : 0;
    const parts = [`${sym.name}`, `exported ${sym.kind || "symbol"}`, span];
    if (sym.tauriCommand) parts.push("Tauri command");
    if (used > 0) parts.push(`used by ${used} ${used === 1 ? "file" : "files"}`);
    return parts;
  }

  function renderFile(file, symbols) {
    st.file = file;
    st.symbols = symbols;
    st.lines = typeof file.text === "string" ? splitLines(file.text) : [];
    st.rows = [];
    hideNoteButton();

    setHead(st.path, file);
    setBanner(file);

    if (typeof file.text !== "string") {
      showError("this file could not be read as text", null);
      return;
    }
    if (st.lines.length === 0) {
      body.replaceChildren(noteBtn, el("p", { class: "reader__empty" }, "This file is empty."));
      return;
    }

    const marks = new Map(); // line → exported symbols declared there
    for (const sym of symbols) {
      if (!sym || !sym.exported) continue;
      const line = toInt(sym.line);
      if (!line) continue;
      if (!marks.has(line)) marks.set(line, []);
      marks.get(line).push(sym);
    }

    const code = el("div", { class: "reader__code" });
    code.style.setProperty("--reader-gutter", `${String(st.lines.length).length}ch`);
    const frag = document.createDocumentFragment();
    for (let i = 0; i < st.lines.length; i++) {
      const n = i + 1;
      const syms = marks.get(n);
      let mark;
      if (syms) {
        const first = syms[0];
        const label = syms.map((s) => symbolLabel(s).join(", ")).join("; ");
        mark = el("button", { class: "reader__mark", type: "button", "data-line": String(first.line), "data-end": String(toInt(first.endLine) || first.line), "aria-label": `Highlight ${label}`, title: syms.map((s) => symbolLabel(s).join(" · ")).join("\n") }, "▸");
      } else {
        mark = el("span", { class: "reader__mark reader__mark--none", "aria-hidden": "true" });
      }
      const row = el("div", { class: "reader__line", "data-line": String(n) }, el("span", { class: "reader__ln" }, mark, el("span", { class: "reader__num", "aria-hidden": "true" }, String(n))), el("code", { class: "reader__src" }, st.lines[i]));
      st.rows.push(row);
      frag.append(row);
    }
    code.append(frag);
    body.replaceChildren(noteBtn, code);
  }

  // ---- Diff mode: the rows /api/filediff built, drawn with the same line DOM --------------------

  /** One row. Only a row with a new-side number carries `data-line`; a deleted row shows its old number, dimmed. */
  function diffRow(r) {
    if (r.kind === "gap") {
      const last = r.new + r.count - 1;
      const where = r.count === 1 ? `line ${fmt(r.new)}` : `lines ${fmt(r.new)}\u2013${fmt(last)}`;
      return el("div", { class: "reader__line reader__line--gap", role: "note" }, el("span", { class: "reader__ln", "aria-hidden": "true" }, el("span", { class: "reader__num" }, "\u22ef"), el("span", { class: "reader__sign" })), el("span", { class: "reader__gap" }, `${fmt(r.count)} unchanged ${r.count === 1 ? "line" : "lines"} not shown (${where})`));
    }
    const num = r.kind === "del" ? r.old : r.new;
    const word = r.kind === "add" ? "added" : r.kind === "del" ? "deleted" : null;
    const row = el(
      "div",
      { class: `reader__line reader__line--${r.kind}`, "data-line": r.kind === "del" ? null : String(r.new), "data-old": r.kind === "add" ? null : String(r.old) },
      el(
        "span",
        { class: "reader__ln" },
        el("span", { class: `reader__num${r.kind === "del" ? " reader__num--old" : ""}`, "aria-hidden": "true", title: r.kind === "del" ? `Line ${num} before this change` : null }, String(num)),
        el("span", { class: "reader__sign", role: word ? "img" : null, "aria-label": word, title: word }, SIGN[r.kind] ?? ""),
      ),
      el("code", { class: "reader__src" }, r.text),
      r.cut ? el("span", { class: "reader__flag", title: "This line is longer than the 2 000 characters shown" }, "\u2026 cut") : null,
      r.noeol ? el("span", { class: "reader__flag", title: "This is the file's last line and it does not end with a newline" }, "no newline at end of file") : null,
    );
    if (r.kind !== "del") st.byLine.set(r.new, row);
    return row;
  }

  function appendDiffRows(code, rows) {
    const frag = document.createDocumentFragment();
    let first = null;
    for (const r of rows) {
      const row = diffRow(r);
      if (!first) first = row;
      frag.append(row);
      st.widest = Math.max(st.widest, r.new ?? 0, r.old ?? 0, r.kind === "gap" ? r.new + r.count - 1 : 0);
    }
    code.append(frag);
    // Later pages carry longer numbers; the gutter grows with them so the columns stay aligned.
    code.style.setProperty("--reader-gutter", `${String(st.widest).length}ch`);
    st.shownRows += rows.length;
    return first;
  }

  function setDiffBanner(file) {
    banner.replaceChildren();
    const parts = [];
    if (file.truncated || st.shownRows < toInt(file.totalRows)) {
      const more = el("button", { class: "btn btn--small reader__more", type: "button" }, `Show the next ${fmt(Math.min(toInt(file.totalRows) - st.shownRows, 2000))} rows`);
      more.addEventListener("click", () => loadMoreRows(more));
      parts.push(el("span", { class: "reader__banner-text" }, "Showing rows 1\u2013", el("strong", {}, fmt(st.shownRows)), " of ", el("strong", {}, fmt(file.totalRows)), " in this change."), more);
    }
    if (file.changedSince === true) parts.push(el("span", { class: "reader__banner-text reader__banner-since" }, "This file has changed again since the task landed, so these line numbers are the landing's, not this checkout's."));
    banner.append(...parts);
    banner.hidden = parts.length === 0;
  }

  /** Two answers describe the same change exactly when they were read between the same two commits. */
  function sameRange(a, b) {
    return Boolean(a?.range && b?.range && a.range.base === b.range.base && a.range.ref === b.range.ref);
  }

  async function loadMoreRows(button) {
    const token = st.token;
    const path = st.path;
    const diff = st.diff;
    // The button is replaced once the rows arrive, and a disabled button drops focus to <body>.
    const hadFocus = document.activeElement === button;
    button.disabled = true;
    try {
      const page = await fetchJson(fileUrl(path, diff, st.shownRows), { fresh: true });
      if (token !== st.token) return;
      if (!sameRange(page, st.file)) {
        // The branch moved between two pages. Rows of one change are never appended under rows of
        // another: the whole change is read again, from the top, and the banner says why.
        await open(path, { diff, fresh: true });
        if (st.path === path && st.diff === diff) bannerNote("The branch moved while you were reading, so this change was read again from the top.");
        if (hadFocus) body.focus({ preventScroll: true });
        return;
      }
      const code = body.querySelector(".reader__code");
      if (!code || !Array.isArray(page?.rows)) return;
      const first = appendDiffRows(code, page.rows);
      st.file = { ...st.file, truncated: page.truncated === true, totalRows: page.totalRows ?? st.file.totalRows };
      setDiffBanner(st.file);
      if (first) animateScroll(Math.max(0, first.offsetTop - 36));
      if (hadFocus) {
        const next = banner.querySelector(".reader__more");
        const target = next ?? first;
        if (target && !next) target.tabIndex = -1;
        target?.focus({ preventScroll: true });
      }
    } catch (err) {
      if (token !== st.token) return;
      button.disabled = false;
      if (hadFocus) button.focus({ preventScroll: true });
      bannerNote(`The next rows could not be read: ${err?.message || String(err)}`);
    }
  }

  function renderDiff(file) {
    st.file = file;
    st.symbols = [];
    st.lines = [];
    st.rows = [];
    st.byLine = new Map();
    st.shownRows = 0;
    st.widest = 1;
    hideNoteButton();
    setHead(st.path, file);

    const rows = Array.isArray(file.rows) ? file.rows : [];
    const card = file.card ? el("div", { class: `card reader__card reader__card--${file.card.kind}`, role: "status" }, el("div", { class: "card__body" }, String(file.card.text ?? ""))) : null;
    if (rows.length === 0) {
      setDiffBanner(file);
      body.replaceChildren(noteBtn, card ?? el("p", { class: "reader__empty" }, "There are no changed lines to show for this file."));
      return;
    }
    const code = el("div", { class: "reader__code reader__code--diff" });
    appendDiffRows(code, rows);
    setDiffBanner(file);
    body.replaceChildren(...[noteBtn, card, code].filter(Boolean));
  }

  function rowFor(n) {
    return st.diff ? st.byLine.get(n) : st.rows[n - 1];
  }

  body.addEventListener("click", (e) => {
    const mark = e.target.closest(".reader__mark[data-line]");
    if (!mark || !body.contains(mark)) return;
    e.preventDefault();
    scrollTo(toInt(mark.dataset.line), toInt(mark.dataset.end));
  });

  // ---- scrollTo: highlight line..endLine with --panel-2 and bring it into view ----

  function clearHighlight() {
    for (const row of body.querySelectorAll(".reader__line.is-hl")) row.classList.remove("is-hl");
  }

  function scrollTo(line, endLine) {
    const from = toInt(line);
    if (!from) return false;
    const to = Math.max(from, toInt(endLine) || from);
    if (!st.file) {
      st.pending = { line: from, endLine: to };
      return true;
    }
    clearHighlight();
    const rows = [];
    for (let n = from; n <= to; n++) {
      const row = rowFor(n);
      if (row) {
        row.classList.add("is-hl");
        rows.push(row);
      }
    }
    setEditorLine(from);
    if (rows.length === 0 && st.diff) {
      bannerNote(`Line ${fmt(from)} is not among the rows of this change. "Show the file" has every line.`);
      return false;
    }
    if (rows.length === 0) {
      const truncated = !banner.hidden && banner.querySelector(".reader__banner-text");
      bannerNote(truncated ? `Line ${fmt(from)} is past the ${fmt(SHOWN_CHARS)} characters shown here.` : `Line ${fmt(from)} is beyond the end of this file (${fmt(st.lines.length)} lines).`);
      return false;
    }
    bannerNote("");
    const first = rows[0];
    // Mid-slide the body is still collapsing/expanding, so size the viewport from the target height.
    const chrome = handle.offsetHeight + head.offsetHeight + (banner.hidden ? 0 : banner.offsetHeight);
    const viewH = body.clientHeight > 40 ? body.clientHeight : Math.max(0, (st.heightPx || 0) - chrome);
    const top = Math.max(0, first.offsetTop - Math.round(viewH / 3));
    animateScroll(top);
    return true;
  }

  /** Scroll the body to `top` over --t-fit (250 ms) with an ease-out; instant under reduced motion.
   *  Done by hand rather than `behavior: "smooth"` so it works in every embedding (some disable smooth scrolling). */
  let scrollAnim = 0;
  let scrollGuard = 0;
  function animateScroll(top) {
    cancelAnimationFrame(scrollAnim);
    clearTimeout(scrollGuard);
    const from = body.scrollTop;
    const delta = top - from;
    const duration = reducedMotion() || document.hidden ? 0 : 250;
    if (duration === 0 || Math.abs(delta) < 2) {
      body.scrollTop = top;
      return;
    }
    const start = performance.now();
    let settled = false;
    const step = (now) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - (1 - t) * (1 - t) * (1 - t);
      body.scrollTop = from + delta * eased;
      if (t < 1) scrollAnim = requestAnimationFrame(step);
      else settled = true;
    };
    scrollAnim = requestAnimationFrame(step);
    // Frames stop in background tabs; land on the target regardless.
    scrollGuard = setTimeout(() => {
      if (settled) return;
      cancelAnimationFrame(scrollAnim);
      body.scrollTop = top;
    }, duration + 100);
  }

  // ---- Selection → floating "Add a note about lines a–b" ------------------------

  function hideNoteButton() {
    noteBtn.hidden = true;
    st.selection = null;
  }

  /** Line number of a range boundary; `edge` = 'start' | 'end'. */
  function lineOf(node, offset, edge) {
    let n = node;
    if (n && n.nodeType === Node.ELEMENT_NODE) {
      const kids = n.childNodes;
      if (kids.length > 0) {
        const idx = edge === "end" ? offset - 1 : offset;
        n = kids[Math.min(Math.max(idx, 0), kids.length - 1)];
      }
    }
    const elm = n && n.nodeType === Node.ELEMENT_NODE ? n : n && n.parentElement;
    const row = elm && elm.closest ? elm.closest(".reader__line") : null;
    return row ? toInt(row.dataset.line) : 0;
  }

  function onSelectionChange() {
    // A short timer rather than requestAnimationFrame: frames pause in background tabs, selections do not.
    clearTimeout(st.selTimer);
    st.selTimer = setTimeout(updateSelection, 40);
  }

  /** The row a range boundary sits in. */
  function rowOf(node, offset, edge) {
    let n = node;
    if (n && n.nodeType === Node.ELEMENT_NODE && n.childNodes.length > 0) {
      const idx = edge === "end" ? offset - 1 : offset;
      n = n.childNodes[Math.min(Math.max(idx, 0), n.childNodes.length - 1)];
    }
    const elm = n && n.nodeType === Node.ELEMENT_NODE ? n : n && n.parentElement;
    return elm && elm.closest ? elm.closest(".reader__line") : null;
  }

  /**
   * Diff mode: a note is about lines of the branch-side text, so every row the selection covers must
   * have a new-side number. A deleted row or a gap row anywhere inside it means there is no honest
   * "lines a–b" to offer, and nothing is offered.
   */
  function diffSelection(range) {
    const first = rowOf(range.startContainer, range.startOffset, "start");
    let last = rowOf(range.endContainer, range.endOffset, "end");
    if (!first || !last) return null;
    // A drag that ends at the very start of the next row selects nothing on that row.
    if (last !== first && range.endOffset === 0 && last.previousElementSibling) last = last.previousElementSibling;
    const texts = [];
    for (let row = first; row; row = row.nextElementSibling) {
      if (!toInt(row.dataset.line)) return null;
      texts.push(row.querySelector(".reader__src")?.textContent ?? "");
      if (row === last) return { from: toInt(first.dataset.line), to: toInt(last.dataset.line), text: texts.join("\n") };
    }
    return null; // `last` came before `first`: not a forward selection inside the code
  }

  function updateSelection() {
    if (!noteHandler || !st.file) return hideNoteButton();
    const sel = document.getSelection();
    if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return hideNoteButton();
    const range = sel.getRangeAt(0);
    if (!body.contains(range.commonAncestorContainer)) return hideNoteButton();
    if (st.diff) {
      // A note is written in the form on the file's page, and a file the map never read has no such
      // page content: offering the button there only leads to "There is no note form on this page."
      if (st.file?.mapped === false) return hideNoteButton();
      const picked = diffSelection(range);
      if (!picked || !picked.text.trim()) return hideNoteButton();
      st.selection = picked;
      noteBtn.textContent = picked.from === picked.to ? `Add a note about line ${picked.from}` : `Add a note about lines ${picked.from}\u2013${picked.to}`;
      noteBtn.hidden = false;
      positionNoteButton(range);
      return undefined;
    }
    const a = lineOf(range.startContainer, range.startOffset, "start");
    let b = lineOf(range.endContainer, range.endOffset, "end");
    if (!a || !b) return hideNoteButton();
    // A drag that ends at the very start of the next line selects nothing on that line.
    if (b > a && range.endOffset === 0) b -= 1;
    const from = Math.min(a, b);
    const to = Math.max(a, b);
    const text = st.lines.slice(from - 1, to).join("\n");
    if (!text.trim()) return hideNoteButton();
    st.selection = { from, to, text };
    noteBtn.textContent = from === to ? `Add a note about line ${from}` : `Add a note about lines ${from}–${to}`;
    noteBtn.hidden = false;
    positionNoteButton(range);
  }

  function positionNoteButton(range) {
    // Anchor on the last non-empty rect: a drag ending at a line start leaves a zero-width rect there.
    let anchor = null;
    const rects = range.getClientRects();
    for (let i = rects.length - 1; i >= 0; i--) {
      if (rects[i].width > 0 && rects[i].height > 0) {
        anchor = rects[i];
        break;
      }
    }
    if (!anchor) anchor = range.getBoundingClientRect();
    const bodyRect = body.getBoundingClientRect();
    const bw = noteBtn.offsetWidth;
    const bh = noteBtn.offsetHeight;
    let top = anchor.top - bodyRect.top + body.scrollTop - bh - 6;
    if (top < body.scrollTop + 2) top = anchor.bottom - bodyRect.top + body.scrollTop + 6;
    let left = anchor.right - bodyRect.left + body.scrollLeft - Math.round(bw / 2);
    const minLeft = body.scrollLeft + 4;
    const maxLeft = body.scrollLeft + body.clientWidth - bw - 4;
    left = Math.max(minLeft, Math.min(maxLeft, left));
    noteBtn.style.top = `${Math.round(top)}px`;
    noteBtn.style.left = `${Math.round(left)}px`;
  }

  // Keep the selection alive when the button takes focus.
  noteBtn.addEventListener("mousedown", (e) => e.preventDefault());
  noteBtn.addEventListener("click", () => {
    const s = st.selection;
    if (!s || !noteHandler) return;
    // In diff mode the numbers are the branch's, not this checkout's, so the note says whose they are.
    const where = s.from === s.to ? `line ${s.from}` : `lines ${s.from}–${s.to}`;
    const prefill = st.diff ? `(${where}, as changed by task ${st.diff}) ` : `(${where}) `;
    const diff = st.diff;
    hideNoteButton();
    noteHandler(prefill, { path: st.path, from: s.from, to: s.to, text: s.text, diff });
  });

  // ---- open ----------------------------------------------------------------------------

  function fileUrl(path, diff, offset) {
    let url = diff ? diffUrl(path, diff, offset) : `${FILE_ENDPOINT}?path=${encodeURIComponent(path)}`;
    if (typeof deps.withRepo === "function") return deps.withRepo(url);
    if (deps.repo) url += `&repo=${encodeURIComponent(deps.repo)}`;
    return url;
  }

  function resolveHighlight(opts, symbols) {
    let line = toInt(opts.line);
    let endLine = toInt(opts.endLine);
    const hl = opts.highlight;
    if (typeof hl === "string" && hl) {
      const sym = symbols.find((s) => s && s.name === hl);
      if (sym) {
        line = toInt(sym.line);
        endLine = toInt(sym.endLine);
      }
    } else if (Array.isArray(hl)) {
      line = toInt(hl[0]) || line;
      endLine = toInt(hl[1]) || endLine;
    } else if (hl && typeof hl === "object") {
      line = toInt(hl.line) || line;
      endLine = toInt(hl.endLine) || endLine;
    }
    return line ? { line, endLine: Math.max(line, endLine || line) } : null;
  }

  async function open(path, opts = {}) {
    if (typeof path !== "string" || !path) return;
    reveal();
    const diff = typeof opts.diff === "string" && opts.diff ? opts.diff : null;
    // The reader's identity is the path plus the mode: the same path in the other mode is a reload.
    const drawn = st.path === path && st.diff === diff && st.file && !opts.fresh;
    const highlightOnly = () => {
      const hl = resolveHighlight(opts, Array.isArray(opts.symbols) ? opts.symbols : st.symbols);
      if (hl) scrollTo(hl.line, hl.endLine);
    };
    if (drawn && !diff && !opts.file) return highlightOnly();
    if (drawn && diff) {
      // In diff mode the identity has a third part, the two commits the change was read between. A
      // task that was sent back and fixed is the same path and the same slug with a new tip, and
      // what is on screen must never be the change as it was before. The caller's fresh answer says
      // which it is; without one the first page is asked for again, past the fetch cache.
      let latest = opts.file ?? null;
      if (!latest) {
        const check = ++st.check;
        try {
          latest = await fetchJson(fileUrl(path, diff, 0), { fresh: true });
        } catch {
          latest = null;
        }
        if (check !== st.check || st.path !== path || st.diff !== diff || !st.file) return;
      }
      if (sameRange(latest, st.file)) return highlightOnly();
      if (latest) opts = { ...opts, file: latest };
    }
    st.path = path;
    st.diff = diff;
    if (diff) st.lastDiff = { where: fileUrl(path, null, 0), slug: diff };
    else if (st.lastDiff && st.lastDiff.where !== fileUrl(path, null, 0)) st.lastDiff = null;
    st.file = null;
    st.lines = [];
    st.rows = [];
    st.byLine = new Map();
    st.shownRows = 0;
    st.symbols = Array.isArray(opts.symbols) && !diff ? opts.symbols : [];
    st.pending = resolveHighlight(opts, st.symbols);
    const token = ++st.token;
    setHead(path, null);
    showLoading();

    let file = opts.file ?? null;
    if (!file) {
      try {
        file = await fetchJson(fileUrl(path, diff, 0), opts.fresh ? { fresh: true } : undefined);
      } catch (err) {
        if (token !== st.token) return;
        showError(err?.message || String(err), () => open(path, { ...opts, fresh: true }));
        return;
      }
    }
    if (token !== st.token) return;
    if (!file || typeof file !== "object") {
      showError("empty response", () => open(path, { ...opts, fresh: true }));
      return;
    }
    const symbols = diff ? [] : Array.isArray(opts.symbols) ? opts.symbols : Array.isArray(file.symbols) ? file.symbols : [];
    if (diff) renderDiff(file);
    else renderFile(file, symbols);
    const hl = st.pending || resolveHighlight(opts, symbols);
    st.pending = null;
    if (hl) scrollTo(hl.line, hl.endLine);
    else body.scrollTop = 0;
  }

  return {
    open,
    close,
    scrollTo,
    isOpen: () => st.open,
    current: () => ({ path: st.path, diff: st.diff, open: st.open, loaded: Boolean(st.file), height: st.heightPx }),
  };
}
