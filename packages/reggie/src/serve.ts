import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { buildContext } from "./context.js";
import { collectFacts } from "./facts.js";
import { buildGraph, type RepoGraph } from "./graph.js";
import { readJournal } from "./journal.js";
import { allNoteFiles, notesForPath, staleEntriesFor } from "./notes.js";
import type { RepoPaths } from "./paths.js";
import { loadPeople, type ReggieConfig } from "./people.js";
import { listTasks } from "./tasks.js";
import { isSafeSlug, readText } from "./util.js";

const VERSION = "3.0.0-alpha.1";

interface Cache {
  graph: { at: number; value: RepoGraph } | null;
}

function json(res: ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body);
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "content-length": Buffer.byteLength(text) });
  res.end(text);
}

function html(res: ServerResponse, body: string): void {
  res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
  res.end(body);
}

/** A small read-only local server: JSON endpoints over the state layer and one page that draws them. */
export function startServer(paths: RepoPaths, config: ReggieConfig, opts: { port: number; host: string }): Promise<{ url: string; close: () => void }> {
  const cache: Cache = { graph: null };
  const graph = (): RepoGraph => {
    const now = Date.now();
    if (cache.graph && now - cache.graph.at < 10_000) return cache.graph.value;
    const value = buildGraph(paths);
    cache.graph = { at: now, value };
    return value;
  };

  const handler = (req: IncomingMessage, res: ServerResponse): void => {
    const url = new URL(req.url ?? "/", `http://${opts.host}`);
    try {
      switch (url.pathname) {
        case "/":
          return html(res, PAGE.replaceAll("__REPO__", escapeHtml(paths.root)).replaceAll("__VERSION__", VERSION));
        case "/api/facts":
          return json(res, 200, { facts: collectFacts(paths.root), config, people: loadPeople(paths) });
        case "/api/graph":
          return json(res, 200, graph());
        case "/api/tasks":
          return json(res, 200, listTasks(paths, config, { includeDone: url.searchParams.get("all") === "1" }));
        case "/api/notes": {
          const notes = allNoteFiles(paths);
          const stale = staleEntriesFor(paths, notes).map((s) => `${s.entity}|${s.entry.date}|${s.entry.type}`);
          return json(res, 200, { notes, stale });
        }
        case "/api/note": {
          const entity = url.searchParams.get("path") ?? "";
          return json(res, 200, { chain: entity ? notesForPath(paths, entity) : [] });
        }
        case "/api/journal": {
          const days = Number.parseInt(url.searchParams.get("days") ?? "30", 10);
          return json(res, 200, readJournal(paths, { days: Number.isFinite(days) ? days : 30, limit: 200 }));
        }
        case "/api/context": {
          const slug = url.searchParams.get("slug");
          const p = url.searchParams.getAll("path");
          const req2: { slug?: string; paths?: string[]; maxLines?: number } = { maxLines: 400 };
          if (slug && isSafeSlug(slug)) req2.slug = slug;
          if (p.length > 0) req2.paths = p;
          return json(res, 200, { text: buildContext(paths, config, req2) });
        }
        case "/api/file": {
          const p = url.searchParams.get("path") ?? "";
          if (!p || p.includes("..") || p.startsWith("/")) return json(res, 400, { error: "bad path" });
          const text = readText(`${paths.root}/${p}`);
          return json(res, text === null ? 404 : 200, { path: p, text: text === null ? null : text.slice(0, 20000) });
        }
        default:
          return json(res, 404, { error: "not found" });
      }
    } catch (err) {
      return json(res, 500, { error: err instanceof Error ? err.message : String(err) });
    }
  };

  return new Promise((resolve, reject) => {
    const server = createServer(handler);
    server.on("error", reject);
    server.listen(opts.port, opts.host, () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : opts.port;
      resolve({ url: `http://${opts.host}:${port}/`, close: () => server.close() });
    });
  });
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

const PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Reggie</title>
<script src="https://unpkg.com/cytoscape@3/dist/cytoscape.min.js"></script>
<style>
  :root { --bg:#0f1115; --panel:#161a22; --line:#262c38; --text:#e6e8ee; --muted:#8b93a7; --accent:#7aa2f7; --ok:#9ece6a; --warn:#e0af68; --bad:#f7768e; }
  * { box-sizing:border-box; }
  body { margin:0; background:var(--bg); color:var(--text); font:14px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif; height:100vh; display:grid; grid-template-rows:auto 1fr; }
  header { display:flex; gap:16px; align-items:center; padding:10px 14px; border-bottom:1px solid var(--line); background:var(--panel); }
  header h1 { font-size:15px; margin:0; font-weight:600; }
  header .repo { color:var(--muted); font-size:12px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  nav button { background:transparent; border:1px solid var(--line); color:var(--text); padding:5px 10px; border-radius:6px; cursor:pointer; }
  nav button.active { border-color:var(--accent); color:var(--accent); }
  main { display:grid; grid-template-columns:1fr 380px; min-height:0; }
  #stage { position:relative; min-height:0; }
  #cy { position:absolute; inset:0; }
  #controls { position:absolute; top:10px; left:10px; display:flex; flex-wrap:wrap; gap:6px; z-index:2; max-width:70%; }
  #controls input, #controls select, #controls label { background:var(--panel); border:1px solid var(--line); color:var(--text); padding:5px 8px; border-radius:6px; font-size:12px; }
  #controls label { display:inline-flex; gap:6px; align-items:center; cursor:pointer; }
  #legend { position:absolute; bottom:10px; left:10px; z-index:2; font-size:12px; color:var(--muted); background:var(--panel); border:1px solid var(--line); border-radius:6px; padding:6px 10px; }
  aside { border-left:1px solid var(--line); background:var(--panel); overflow:auto; padding:12px 14px; min-height:0; }
  aside h2 { font-size:13px; margin:0 0 8px; color:var(--muted); text-transform:uppercase; letter-spacing:.04em; }
  aside h3 { font-size:14px; margin:12px 0 6px; }
  .entry { border-left:3px solid var(--line); padding:4px 8px; margin:6px 0; }
  .entry .meta { color:var(--muted); font-size:12px; }
  .entry.stale { border-left-color:var(--warn); }
  .pill { display:inline-block; font-size:11px; padding:1px 7px; border-radius:10px; border:1px solid var(--line); color:var(--muted); margin-right:4px; }
  .pill.ok { border-color:var(--ok); color:var(--ok); } .pill.warn { border-color:var(--warn); color:var(--warn); } .pill.bad { border-color:var(--bad); color:var(--bad); } .pill.accent { border-color:var(--accent); color:var(--accent); }
  .list { display:flex; flex-direction:column; gap:8px; padding:12px 14px; overflow:auto; min-height:0; }
  .card { background:var(--panel); border:1px solid var(--line); border-radius:8px; padding:10px 12px; }
  .card .title { font-weight:600; }
  .card .sub { color:var(--muted); font-size:12px; margin-top:2px; }
  .hidden { display:none !important; }
  code, pre { font-family:ui-monospace,SFMono-Regular,Menlo,monospace; font-size:12px; }
  pre { white-space:pre-wrap; background:var(--bg); border:1px solid var(--line); border-radius:6px; padding:8px; }
  a { color:var(--accent); }
  .muted { color:var(--muted); }
  .stat { display:inline-block; margin-right:14px; }
</style>
</head>
<body>
<header>
  <h1>Reggie <span class="muted" style="font-weight:400">__VERSION__</span></h1>
  <nav>
    <button data-view="graph" class="active">Graph</button>
    <button data-view="tasks">Tasks</button>
    <button data-view="notes">Notes</button>
    <button data-view="journal">Journal</button>
  </nav>
  <div class="repo" title="__REPO__">__REPO__</div>
</header>
<main>
  <section id="view-graph" style="display:contents">
    <div id="stage">
      <div id="controls">
        <input id="search" placeholder="find a file…" size="22">
        <select id="dir"><option value="">all folders</option></select>
        <label><input type="checkbox" id="onlyNotes"> only files with notes</label>
        <label><input type="checkbox" id="showTasks" checked> tasks</label>
        <label><input type="checkbox" id="hideLeaves"> hide leaves</label>
      </div>
      <div id="legend">node size = lines · <b style="color:var(--ok)">green ring</b> = has a note · <b style="color:var(--warn)">amber</b> = folder note only · diamonds = tasks · arrows = imports</div>
      <div id="cy"></div>
    </div>
    <aside id="details"><h2>Details</h2><div class="muted">Click a node. Double-click to focus on its neighborhood.</div><div id="stats" style="margin-top:12px"></div></aside>
  </section>
  <section id="view-tasks" class="hidden" style="grid-column:1 / span 2"><div class="list" id="tasks"></div></section>
  <section id="view-notes" class="hidden" style="grid-column:1 / span 2"><div class="list" id="notes"></div></section>
  <section id="view-journal" class="hidden" style="grid-column:1 / span 2"><div class="list" id="journal"></div></section>
</main>
<script>
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
const palette = ["#7aa2f7","#bb9af7","#7dcfff","#ff9e64","#9ece6a","#e0af68","#f7768e","#2ac3de","#c0caf5","#73daca","#b4f9f8","#ff007c"];
let G = null, cy = null, dirColor = {};

async function api(p) { const r = await fetch(p); return r.json(); }

function switchView(name) {
  document.querySelectorAll("nav button").forEach((b) => b.classList.toggle("active", b.dataset.view === name));
  for (const v of ["graph","tasks","notes","journal"]) {
    const el = $("#view-" + v);
    el.classList.toggle("hidden", v !== name);
    if (v === "graph") el.style.display = v === name ? "contents" : "none";
  }
  if (name === "tasks") loadTasks();
  if (name === "notes") loadNotes();
  if (name === "journal") loadJournal();
  if (name === "graph" && cy) cy.resize();
}
document.querySelectorAll("nav button").forEach((b) => b.addEventListener("click", () => switchView(b.dataset.view)));

function nodeColor(n) { return n.kind === "task" ? "#e0af68" : (dirColor[n.dir] || "#7aa2f7"); }

function buildElements() {
  const onlyNotes = $("#onlyNotes").checked, showTasks = $("#showTasks").checked, hideLeaves = $("#hideLeaves").checked, dir = $("#dir").value;
  const keep = new Set();
  for (const n of G.nodes) {
    if (n.kind === "task" && !showTasks) continue;
    if (n.kind === "file") {
      if (dir && n.dir !== dir) continue;
      if (onlyNotes && n.noteCount === 0) continue;
      if (hideLeaves && n.inDegree + n.outDegree === 0) continue;
    }
    keep.add(n.id);
  }
  const els = [];
  for (const n of G.nodes) if (keep.has(n.id)) els.push({ data: { id: n.id, label: n.label, kind: n.kind, size: n.kind === "task" ? 26 : Math.max(14, Math.min(48, 10 + Math.sqrt(n.lines) * 1.6)), color: nodeColor(n), ring: n.noteCount > 0 ? "#9ece6a" : (n.dirNoteCount > 0 ? "#e0af68" : "#262c38"), ringW: n.noteCount > 0 ? 4 : (n.dirNoteCount > 0 ? 3 : 1) } });
  for (const e of G.edges) if (keep.has(e.source) && keep.has(e.target)) els.push({ data: { id: e.source + ">" + e.target, source: e.source, target: e.target, kind: e.kind } });
  return els;
}

function draw() {
  const els = buildElements();
  if (cy) cy.destroy();
  cy = cytoscape({
    container: $("#cy"), elements: els, wheelSensitivity: 0.2,
    style: [
      { selector: "node", style: { "background-color": "data(color)", "border-color": "data(ring)", "border-width": "data(ringW)", width: "data(size)", height: "data(size)", label: "data(label)", color: "#e6e8ee", "font-size": 9, "text-valign": "bottom", "text-margin-y": 3, "text-background-color": "#0f1115", "text-background-opacity": 0.7, "text-background-padding": 1 } },
      { selector: "node[kind = 'task']", style: { shape: "diamond" } },
      { selector: "edge", style: { width: 1, "line-color": "#3b4252", "target-arrow-color": "#3b4252", "target-arrow-shape": "triangle", "arrow-scale": 0.7, "curve-style": "bezier", opacity: 0.8 } },
      { selector: "edge[kind = 'touches']", style: { "line-color": "#e0af68", "target-arrow-color": "#e0af68", "line-style": "dashed" } },
      { selector: ".dim", style: { opacity: 0.12 } },
      { selector: ".hl", style: { "border-color": "#7aa2f7", "border-width": 5 } },
      { selector: "edge.hl", style: { "line-color": "#7aa2f7", "target-arrow-color": "#7aa2f7", width: 2, opacity: 1 } },
    ],
    layout: els.length > 600 ? { name: "concentric", concentric: (n) => n.degree(), levelWidth: () => 4, minNodeSpacing: 12, animate: false } : { name: "cose", animate: false, nodeRepulsion: () => 9000, idealEdgeLength: () => 70, gravity: 0.25, numIter: 600, padding: 30 },
  });
  cy.on("tap", "node", (ev) => showNode(ev.target.id()));
  cy.on("dbltap", "node", (ev) => focus(ev.target));
  cy.on("tap", (ev) => { if (ev.target === cy) { cy.elements().removeClass("dim hl"); } });
  $("#stats").innerHTML = "<span class='stat'><b>" + cy.nodes().length + "</b> nodes</span><span class='stat'><b>" + cy.edges().length + "</b> edges</span><span class='stat muted'>" + G.unresolved + " unresolved relative imports</span>";
}

function focus(node) {
  const hood = node.closedNeighborhood();
  cy.elements().addClass("dim"); hood.removeClass("dim"); hood.addClass("hl");
  cy.animate({ fit: { eles: hood, padding: 60 }, duration: 250 });
}

async function showNode(id) {
  const n = G.nodes.find((x) => x.id === id);
  if (!n) return;
  const inbound = G.edges.filter((e) => e.target === id).map((e) => e.source);
  const outbound = G.edges.filter((e) => e.source === id).map((e) => e.target);
  let h = "<h2>Details</h2><h3><code>" + esc(n.id) + "</code></h3>";
  h += "<div class='meta'><span class='pill'>" + esc(n.lang) + "</span>" + (n.kind === "file" ? "<span class='pill'>" + n.lines + " lines</span>" : "") + "<span class='pill'>" + inbound.length + " in</span><span class='pill'>" + outbound.length + " out</span>" + (n.noteCount ? "<span class='pill ok'>" + n.noteCount + " note" + (n.noteCount > 1 ? "s" : "") + "</span>" : "<span class='pill warn'>no note</span>") + "</div>";
  if (n.kind === "file") {
    const r = await api("/api/note?path=" + encodeURIComponent(n.id));
    if (r.chain.length) {
      h += "<h3>Notes to read first</h3>";
      for (const nf of r.chain) { h += "<div class='muted'><code>" + esc(nf.entity) + "</code></div>"; for (const e of nf.entries) h += "<div class='entry'><div class='meta'><b>" + esc(e.type) + "</b> · " + esc(e.date) + " · " + esc(e.author) + " · " + esc(e.confidence) + "</div>" + esc(e.text) + (e.sources.length ? "<div class='meta'>sources: " + esc(e.sources.join(", ")) + "</div>" : "") + "</div>"; }
    } else {
      h += "<div class='muted' style='margin-top:8px'>No notes on the way to this file. <code>reggie note add " + esc(n.id) + " --type how \\"…\\"</code></div>";
    }
    if (n.tasks.length) h += "<h3>Touched by tasks</h3>" + n.tasks.map((t) => "<span class='pill accent'>" + esc(t) + "</span>").join(" ");
  } else {
    const r = await api("/api/context?slug=" + encodeURIComponent(n.label));
    h += "<h3>Context pack</h3><pre>" + esc(r.text) + "</pre>";
  }
  if (inbound.length) h += "<h3>Imported by</h3>" + inbound.slice(0, 40).map((x) => "<div><a href='#' data-node='" + esc(x) + "'><code>" + esc(x) + "</code></a></div>").join("");
  if (outbound.length) h += "<h3>Imports</h3>" + outbound.slice(0, 40).map((x) => "<div><a href='#' data-node='" + esc(x) + "'><code>" + esc(x) + "</code></a></div>").join("");
  $("#details").innerHTML = h;
  $("#details").querySelectorAll("a[data-node]").forEach((a) => a.addEventListener("click", (ev) => { ev.preventDefault(); const t = cy.getElementById(a.dataset.node); if (t.length) { focus(t); showNode(a.dataset.node); } }));
  const el = cy.getElementById(id); if (el.length) { cy.elements().removeClass("hl"); el.addClass("hl"); }
}

async function loadGraph() {
  G = await api("/api/graph");
  G.dirs.forEach((d, i) => { dirColor[d] = palette[i % palette.length]; });
  const sel = $("#dir"); sel.innerHTML = "<option value=''>all folders</option>" + G.dirs.filter((d) => d !== "(tasks)").map((d) => "<option value='" + esc(d) + "'>" + esc(d) + "</option>").join("");
  draw();
}
for (const id of ["dir","onlyNotes","showTasks","hideLeaves"]) $("#" + id).addEventListener("change", draw);
$("#search").addEventListener("input", (ev) => {
  const q = ev.target.value.trim().toLowerCase();
  if (!cy) return;
  cy.elements().removeClass("dim hl");
  if (!q) return;
  const hits = cy.nodes().filter((n) => n.id().toLowerCase().includes(q));
  cy.elements().addClass("dim"); hits.removeClass("dim").addClass("hl");
  if (hits.length) cy.animate({ fit: { eles: hits, padding: 80 }, duration: 200 });
});

const stateClass = { "awaiting-decision":"warn", "in-process":"accent", groomed:"ok", grooming:"", ungroomed:"", done:"ok" };
async function loadTasks() {
  const tasks = await api("/api/tasks?all=1");
  $("#tasks").innerHTML = tasks.length ? tasks.map((t) => "<div class='card'><div class='title'><span class='pill " + (stateClass[t.state] || "") + "'>" + esc(t.state) + "</span>" + (t.risk !== "unset" ? "<span class='pill " + (t.risk === "high" ? "bad" : t.risk === "medium" ? "warn" : "ok") + "'>" + esc(t.risk) + "</span>" : "") + esc(t.title) + "</div><div class='sub'><code>" + esc(t.slug) + "</code>" + (t.owner ? " · " + esc(t.owner) : "") + (t.branch ? " · " + esc(t.branch) : "") + (t.pr ? " · <a href='" + esc(t.pr.url) + "'>PR #" + t.pr.number + "</a>" : "") + "</div><div class='sub'>" + esc(t.reason) + "</div></div>").join("") : "<div class='muted'>No tasks yet. <code>reggie capture \\"…\\"</code></div>";
}
async function loadNotes() {
  const r = await api("/api/notes");
  const stale = new Set(r.stale);
  $("#notes").innerHTML = r.notes.length ? r.notes.map((n) => "<div class='card'><div class='title'><code>" + esc(n.entity) + "</code> <span class='pill'>" + esc(n.kind) + "</span></div>" + n.entries.map((e) => "<div class='entry" + (stale.has(n.entity + "|" + e.date + "|" + e.type) ? " stale" : "") + "'><div class='meta'><b>" + esc(e.type) + "</b> · " + esc(e.date) + " · " + esc(e.author) + " · " + esc(e.confidence) + (stale.has(n.entity + "|" + e.date + "|" + e.type) ? " · <span style='color:var(--warn)'>stale</span>" : "") + "</div>" + esc(e.text) + (e.sources.length ? "<div class='meta'>sources: " + esc(e.sources.join(", ")) + "</div>" : "") + "</div>").join("") + "</div>").join("") : "<div class='muted'>No notes yet.</div>";
}
async function loadJournal() {
  const entries = await api("/api/journal?days=60");
  $("#journal").innerHTML = entries.length ? entries.map((e) => "<div class='card'><div class='sub'>" + esc(e.date) + " " + esc(e.time) + " · " + esc(e.person) + " · " + esc(e.tool) + (e.slug ? " · <code>" + esc(e.slug) + "</code>" : "") + (e.stage ? " · " + esc(e.stage) : "") + "</div><div style='margin-top:4px'>" + esc(e.text) + "</div>" + (e.evidence.length ? "<div class='sub'>evidence: " + esc(e.evidence.join(", ")) + "</div>" : "") + "</div>").join("") : "<div class='muted'>No journal entries in the last 60 days.</div>";
}
loadGraph();
</script>
</body>
</html>`;
