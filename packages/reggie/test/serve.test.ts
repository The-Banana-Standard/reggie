import { existsSync, readFileSync } from "node:fs";
import { request as httpRequest } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { briefFile, packetFile } from "../src/paths.js";
import { startServer, type ServerHandle } from "../src/serve.js";
import { TASK_STATES } from "../src/tasks.js";
import { makeFixtureRepo, type FixtureRepo } from "./fixtures.js";

let fx: FixtureRepo;
let server: ServerHandle;
let base: string;

beforeAll(async () => {
  fx = makeFixtureRepo();
  server = await startServer(fx.paths, fx.config, { port: 0, host: "127.0.0.1", workspace: null });
  base = `http://127.0.0.1:${server.port}`;
}, 120_000);

afterAll(async () => {
  await server?.close();
  fx?.repo.cleanup();
});

/** GET a JSON route; returns the status and the parsed body. */
async function get(route: string): Promise<{ status: number; body: any }> {
  const res = await fetch(base + route);
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

/** GET expecting 200; returns the body. */
async function ok(route: string): Promise<any> {
  const { status, body } = await get(route);
  expect(status, `${route} -> ${JSON.stringify(body).slice(0, 200)}`).toBe(200);
  return body;
}

/**
 * `fetch` refuses to set `Host`, and `Host` is the header a DNS-rebinding attack forges, so the
 * rebinding tests go through `node:http` instead: connect to 127.0.0.1 the way a rebound browser
 * would, but claim to be talking to a name the attacker owns.
 */
function raw(opts: { method?: string; route: string; headers?: Record<string, string>; body?: string }): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = httpRequest({ host: "127.0.0.1", port: server.port, method: opts.method ?? "GET", path: opts.route, headers: opts.headers ?? {} }, (res) => {
      let text = "";
      res.setEncoding("utf8");
      res.on("data", (chunk: string) => {
        text += chunk;
      });
      res.on("end", () => resolve({ status: res.statusCode ?? 0, body: text }));
    });
    req.on("error", reject);
    if (opts.body !== undefined) req.write(opts.body);
    req.end();
  });
}

async function post(route: string, body: unknown, headers: Record<string, string> = {}): Promise<{ status: number; body: any }> {
  const res = await fetch(base + route, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

function intakeText(): string {
  return readFileSync(fx.paths.intake, "utf8");
}

describe("static files", () => {
  it("serves ui/index.html at /", async () => {
    const res = await fetch(`${base}/`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    const html = await res.text();
    expect(html.toLowerCase()).toContain("<!doctype html>");
    expect(html).toContain("/ui/app.js");
  });

  it("serves ui files and refuses traversal", async () => {
    expect((await fetch(`${base}/ui/styles.css`)).status).toBe(200);
    expect((await fetch(`${base}/ui/nope.js`)).status).toBe(404);
    // fetch() collapses a literal `/ui/../x`, so traversal is probed in its encoded forms.
    for (const escape of ["%2e%2e/package.json", "%2e%2e%2fpackage.json", "..%2fpackage.json", "/etc/passwd"]) {
      const res = await fetch(`${base}/ui/${escape}`);
      expect([400, 404]).toContain(res.status);
      expect(await res.text()).not.toContain("\"dependencies\"");
    }
  });

  it("404s an un-whitelisted vendor name", async () => {
    const { status, body } = await get("/vendor/lodash.min.js");
    expect(status).toBe(404);
    expect(body.error).toBe("not found");
  });

  it("serves a whitelisted vendor file with an immutable cache header", async () => {
    const res = await fetch(`${base}/vendor/cytoscape.min.js`);
    // 404 is the contract's answer when the module is not installed; the page then uses the CDN.
    if (res.status === 200) {
      expect(res.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
      expect(res.headers.get("content-type")).toContain("javascript");
    } else {
      expect(res.status).toBe(404);
    }
    await res.arrayBuffer();
  });
});

describe("GET /api/facts and /api/status", () => {
  it("returns facts with branch, headSha, root, workspace and editorScheme", async () => {
    const body = await ok("/api/facts");
    expect(Object.keys(body).sort()).toEqual(["branch", "config", "editorScheme", "facts", "headSha", "people", "root", "workspace"]);
    expect(body.facts.name).toBe("fixture");
    expect(body.branch).toBe("main");
    expect(body.headSha).toMatch(/^[0-9a-f]{40}$/);
    expect(body.root).toBe(fx.repo.root);
    expect(body.workspace).toBeNull();
    expect(body.editorScheme).toBe("vscode://file");
    expect(body.config.mode).toBe("solo");
    expect(Array.isArray(body.people.people)).toBe(true);
  });

  it("answers the first poll before the work is done, then ticks each source off", async () => {
    // The very first poll must come back with ready:false, or the "Reading the repo" card can
    // never be drawn (spec §3.1). A ready:true answer here means the route is building inline.
    const first = await ok("/api/status");
    expect(first.ready).toBe(false);
    expect(Object.keys(first.steps).sort()).toEqual(["files", "history", "imports", "notes", "tasks"]);
    expect(first.headSha).toMatch(/^[0-9a-f]{40}$/);

    let body = first;
    for (let i = 0; i < 200 && !body.ready; i += 1) {
      await new Promise((r) => setTimeout(r, 50));
      body = await ok("/api/status");
    }
    expect(body.ready).toBe(true);
    expect(body.steps).toEqual({ files: true, imports: true, notes: true, history: true, tasks: true });
  });

  it("404s an unknown ?repo", async () => {
    const { status, body } = await get("/api/status?repo=nope");
    expect(status).toBe(404);
    expect(body.error).toContain("nope");
  });
});

describe("GET /api/graph", () => {
  it("keeps the flat compatibility payload with no parameters", async () => {
    const body = await ok("/api/graph");
    expect(Object.keys(body).sort()).toEqual(["dirs", "edges", "generatedAt", "included", "languages", "nodes", "totalCodeFiles", "truncated", "unresolved"]);
    expect(body.nodes.length).toBeGreaterThan(0);
    for (const n of body.nodes) expect(["file", "task"]).toContain(n.kind);
    expect(body.totalCodeFiles).toBeGreaterThanOrEqual(50);
    expect(body.included).toBeLessThanOrEqual(body.totalCodeFiles);
    expect(body.truncated).toBe(false);
    expect(body.languages).toContain("TypeScript");
  });

  it("returns a container ViewGraph for level=container", async () => {
    const body = await ok("/api/graph?level=container");
    expect(body.level).toBe("container");
    expect(body.root).toBe("dir:./");
    expect(body.nodes.length).toBeGreaterThan(0);
    expect(body.nodes.length).toBeLessThanOrEqual(40);
    for (const n of body.nodes) expect(n.kind).toBe("dir");
    expect(body.areas.map((a: any) => a.id)).toContain("dir:src/");
    for (const a of body.areas) expect(typeof a.hue).toBe("number");
    expect(body.counts.totalCodeFiles).toBeGreaterThan(0);
    expect(Array.isArray(body.cycles)).toBe(true);
    expect(typeof body.generatedAt).toBe("string");
  });

  it("returns a dir ViewGraph with ghosts for level=dir", async () => {
    const body = await ok("/api/graph?level=dir&root=src/big");
    expect(body.level).toBe("dir");
    expect(body.root).toBe("dir:src/big/");
    const ghosts = body.nodes.filter((n: any) => n.ghost);
    expect(ghosts.length).toBeGreaterThan(0);
    for (const g of ghosts) {
      expect(g.id).toMatch(/^ghost:(up|down):/);
      expect(["up", "down", "both"]).toContain(g.side);
    }
    expect(body.counts.hiddenTests).toBeGreaterThan(0);
  });

  it("draws tests when tests=1", async () => {
    const off = await ok("/api/graph?level=dir&root=src/big");
    const on = await ok("/api/graph?level=dir&root=src/big&tests=1&all=1");
    expect(on.counts.hiddenTests).toBe(0);
    expect(on.nodes.length).toBeGreaterThan(off.nodes.length);
  });

  it("404s an unknown dir and 400s an unknown level", async () => {
    expect((await get("/api/graph?level=dir&root=does/not/exist")).status).toBe(404);
    expect((await get("/api/graph?level=dir")).status).toBe(400);
    expect((await get("/api/graph?level=galaxy")).status).toBe(400);
  });

  it("gives every drawable node the history the Heat lens colours by", async () => {
    // A residual or config-pinned area is a file set, not a directory, so `byPath` has no entry for
    // it: the server has to roll history up itself or the lens sees no `commits30` and buckets the
    // area with the cold ones (which is how Heat ended up with two occupied steps).
    for (const route of ["/api/graph?level=container", "/api/graph?level=dir&root=src"]) {
      const body = await ok(route);
      const drawable = body.nodes.filter((n: any) => !n.ghost && n.kind !== "fold");
      expect(drawable.length).toBeGreaterThan(0);
      for (const n of drawable) {
        const h = n.history ?? n.aggregates?.history;
        expect(h, `${route}: ${n.id} carries no history`).toBeTruthy();
        // A number for anything git has seen; null (never absent) for a node with no history at all.
        expect(h.commits30 === null || typeof h.commits30 === "number", `${route}: ${n.id} commits30=${h.commits30}`).toBe(true);
        expect(h.commits90 === null || typeof h.commits90 === "number").toBe(true);
        expect(h.commits365 === null || typeof h.commits365 === "number").toBe(true);
      }
      // The fixture lands in one commit, so the *values* are flat here; what this guards is that
      // every node carries one at all. Spread is the lens's business (map.js widens the window).
    }
  });

  it("names the dominant file behind an aggregated edge under both `top` and `mostly`", async () => {
    const body = await ok("/api/graph?level=dir&root=src");
    const aggregated = body.edges.filter((e: any) => (e.weight ?? 1) > 1);
    expect(aggregated.length).toBeGreaterThan(0);
    for (const e of aggregated) {
      // Both names carry the same object: `top` is what the map reads, `mostly` what the tooltip
      // sentence ("mostly shape.ts (7)") probes for. The count is distinct importing files over the
      // whole aggregate, so it is never derived from the `via` list the server cuts to five.
      expect(e.top, `${e.source} -> ${e.target} has no top`).toBeTruthy();
      expect(e.mostly).toEqual(e.top);
      expect(Object.keys(e.top).sort()).toEqual(["files", "path"]);
      expect(e.top.files).toBeGreaterThanOrEqual(1);
      expect(e.top.files).toBeLessThanOrEqual(e.weight);
      expect((e.via ?? []).length).toBeLessThanOrEqual(5);
    }
  });
});

describe("numeric query parameters are bounded", () => {
  // `commitsPerDayFor` builds one object per day in the window, so an unchecked `days` let a single
  // request size a ~1.3 GB allocation. Every numeric parameter is refused outside its range rather
  // than silently clamped, so a typo is visible instead of answered.
  it("refuses an out-of-range or non-numeric days on every route that takes one", async () => {
    for (const route of ["/api/history", "/api/story?scope=repo", "/api/explain?id=src/types/shape.ts"]) {
      const sep = route.includes("?") ? "&" : "?";
      for (const bad of ["100000000", "0", "-5", "731", "abc", "1e9", "12.5", "999999999999999999999"]) {
        const { status, body } = await get(`${route}${sep}days=${encodeURIComponent(bad)}`);
        expect(status, `${route} days=${bad}`).toBe(400);
        expect(body.error).toMatch(/days must be an integer between 1 and 730/);
      }
      for (const good of ["1", "30", "730", ""]) expect((await get(`${route}${sep}days=${good}`)).status, `${route} days=${good}`).toBe(200);
    }
  });

  it("bounds depth, limit and the journal window", async () => {
    expect((await get("/api/impact?id=src/types/shape.ts&depth=99")).status).toBe(400);
    expect((await get("/api/impact?id=src/types/shape.ts&depth=0")).status).toBe(400);
    expect((await get("/api/impact?id=src/types/shape.ts&depth=3")).status).toBe(200);
    expect((await get("/api/search?q=shape&limit=100000")).status).toBe(400);
    expect((await get("/api/search?q=shape&limit=0")).status).toBe(400);
    expect((await get("/api/search?q=shape&limit=100")).status).toBe(200);
    // The journal window filters a file rather than sizing an array, so "show me everything" stays legal.
    expect((await get("/api/journal?days=3650")).status).toBe(200);
    expect((await get("/api/journal?days=99999999")).status).toBe(400);
  });

  it("keeps the day series the size the query asked for", async () => {
    expect((await ok("/api/history?days=90")).commitsPerDay).toHaveLength(90);
    expect((await ok("/api/history?days=730")).commitsPerDay).toHaveLength(730);
  });
});

describe("GET /api/impact", () => {
  it("returns hops and sides for a file id", async () => {
    const body = await ok("/api/impact?id=src/types/shape.ts&depth=1&direction=both");
    expect(body.level).toBe("impact");
    expect(body.center).toBe("src/types/shape.ts");
    expect(body.counts.up?.length).toBe(1);
    expect(body.counts.up[0]).toBeGreaterThan(0);
    const centre = body.nodes.find((n: any) => n.id === "src/types/shape.ts");
    expect(centre.hop).toBe(0);
    for (const n of body.nodes) if (n.id !== body.center) expect(["up", "down"]).toContain(n.side);
    expect(body.nodes.length).toBeLessThanOrEqual(40 + body.nodes.filter((n: any) => n.foldCount).length);
  });

  it("answers a file::symbol id with the file's impact", async () => {
    const body = await ok("/api/impact?id=src/types/shape.ts::emptyShape");
    expect(body.center).toBe("src/types/shape.ts");
  });

  it("400s a traversal id and 404s an unknown file", async () => {
    expect((await get("/api/impact?id=../package.json")).status).toBe(400);
    expect((await get("/api/impact?id=src/nope.ts")).status).toBe(404);
    expect((await get("/api/impact")).status).toBe(400);
  });

  it("returns a task blast radius with centres and collisions", async () => {
    const body = await ok(`/api/impact?slug=${fx.slugs.inProcess}&slug=${fx.slugs.awaiting}&depth=2`);
    expect(body.level).toBe("impact");
    expect(body.centers).toContain("src/big/a01.ts");
    expect(body.centers).toContain("src/types/shape.ts");
    const shared = body.nodes.find((n: any) => n.id === "src/big/a01.ts");
    expect(shared.planned).toBe(true);
    expect(shared.actual).toBe(true);
    expect(typeof shared.task).toBe("string");
    expect(shared.collision.sort()).toEqual([fx.slugs.awaiting, fx.slugs.inProcess].sort());
    const planOnly = body.nodes.find((n: any) => n.id === "src/big/a02.ts");
    expect(planOnly.planned).toBe(true);
    expect(planOnly.actual).toBe(false);
    expect(planOnly.task).toBe(fx.slugs.inProcess);
  });

  // IMPACT-01: `planned`/`actual` describe the one slug in `task`, never the union of the slugs
  // asked for. Merged flags made the task page paint a file "Changed on branch" on the map while
  // its own files-to-touch list, fed by /api/task, said "not changed yet".
  it("keeps planned and actual on the slug the node reports as its task", async () => {
    for (const order of [
      [fx.slugs.awaiting, fx.slugs.inProcess],
      [fx.slugs.inProcess, fx.slugs.awaiting],
    ]) {
      const merged = await ok(`/api/impact?slug=${order[0]}&slug=${order[1]}&depth=2`);
      const single = new Map<string, any>();
      for (const slug of order) {
        const body = await ok(`/api/impact?slug=${slug}&depth=2`);
        for (const n of body.nodes) if (n.task === slug) single.set(`${slug}:${n.id}`, n);
      }
      const shared = merged.nodes.find((n: any) => n.id === "src/big/a01.ts");
      expect(shared.task, order.join(",")).toBe(order[0]);
      expect(shared.collision.sort()).toEqual([...order].sort());
      for (const n of merged.nodes) {
        if (typeof n.task !== "string" || n.task === "") continue;
        const truth = single.get(`${n.task}:${n.id}`);
        expect(truth, `${n.id} claims ${n.task}`).toBeDefined();
        expect({ planned: n.planned, actual: n.actual }, `${n.id} as ${n.task} (${order.join(",")})`).toEqual({ planned: truth.planned, actual: truth.actual });
      }
    }
  });

  it("400s an unsafe slug and 404s an unknown one", async () => {
    expect((await get("/api/impact?slug=../etc")).status).toBe(400);
    expect((await get("/api/impact?slug=no-such-task")).status).toBe(404);
  });
});

describe("GET /api/story and /api/explain", () => {
  const sections: Record<string, string[]> = {
    repo: ["needs-you", "what", "made-of", "starts", "talks", "flight", "recent", "gaps", "run"],
    area: ["read-first", "inside", "uses", "used-by", "tests", "people", "tasks", "recent"],
    file: ["read-first", "exports", "used-by", "uses", "tests", "tasks", "history", "add-note"],
    task: ["state", "owner", "problem", "approach", "files", "criteria", "verification", "assumptions", "scope", "bail", "risk", "packet", "journal"],
    workspace: ["needs-you", "repos", "connect"],
  };

  it("returns the contract's section ids for every scope", async () => {
    const routes: [string, string][] = [
      ["repo", "/api/story?scope=repo"],
      ["area", "/api/story?scope=area&id=src/big"],
      ["file", "/api/story?scope=file&id=src/types/shape.ts"],
      ["task", `/api/story?scope=task&id=${fx.slugs.inProcess}`],
      ["workspace", "/api/story?scope=workspace"],
    ];
    for (const [scope, route] of routes) {
      const story = await ok(route);
      expect(story.scope).toBe(scope);
      expect(typeof story.title).toBe("string");
      expect(Array.isArray(story.crumbs)).toBe(true);
      expect(story.sections.map((s: any) => s.id)).toEqual(sections[scope]);
      for (const section of story.sections) {
        expect(typeof section.heading).toBe("string");
        for (const p of section.paragraphs) {
          expect(["fact", "note", "journal", "gap", "commit", "decision", "list"]).toContain(p.kind);
          expect(Array.isArray(p.refs)).toBe(true);
        }
      }
      expect(Array.isArray(story.next)).toBe(true);
    }
  });

  it("adds the gaps section under the knowledge lens", async () => {
    const story = await ok("/api/story?scope=file&id=src/types/shape.ts&lens=knowledge");
    expect(story.sections.map((s: any) => s.id)).toContain("gaps");
  });

  it("validates scope and id", async () => {
    expect((await get("/api/story?scope=nowhere")).status).toBe(400);
    expect((await get("/api/story?scope=file&id=../package.json")).status).toBe(400);
    expect((await get("/api/story?scope=file&id=src/nope.ts")).status).toBe(404);
    expect((await get("/api/story?scope=area&id=src/nope")).status).toBe(404);
    expect((await get("/api/story?scope=task&id=..%2Fetc")).status).toBe(400);
  });

  it("explains a node in exactly four sentences", async () => {
    const body = await ok("/api/explain?id=src/types/shape.ts");
    expect(body.id).toBe("src/types/shape.ts");
    expect(body.kind).toBe("file");
    expect(body.sentences).toHaveLength(4);
    for (const s of body.sentences) {
      expect(typeof s.text).toBe("string");
      expect(Array.isArray(s.refs)).toBe(true);
    }
    expect(body.actions.length).toBeGreaterThan(0);
    expect((await get("/api/explain")).status).toBe(400);
    expect((await get("/api/explain?id=src/nope.ts")).status).toBe(404);
  });
});

describe("GET /api/file and /api/symbols", () => {
  it("returns the extended file shape", async () => {
    const body = await ok("/api/file?path=src/big/a01.ts");
    expect(Object.keys(body).sort()).toEqual(
      [
        "area",
        "editorUrl",
        "history",
        "imports",
        "importers",
        "lang",
        "notes",
        "path",
        "role",
        "symbols",
        "tasks",
        "testedBy",
        "text",
        "totalChars",
        "totalLines",
        "truncated",
      ].sort(),
    );
    expect(body.text).toContain("export function a01");
    expect(body.truncated).toBe(false);
    expect(body.totalChars).toBe(body.text.length);
    expect(body.totalLines).toBeGreaterThan(1);
    expect(body.role).toBe("source");
    expect(body.area).toBe("dir:src/");
    expect(body.symbols.map((s: any) => s.name)).toContain("a01");
    const symbol = body.symbols.find((s: any) => s.name === "a01");
    expect(symbol.exported).toBe(true);
    expect(symbol.endLine).toBeGreaterThanOrEqual(symbol.line);
    expect(symbol.usedBy.map((u: any) => u.file)).toContain("src/big/__tests__/a01.test.ts");
    expect(body.notes.map((n: any) => n.entity)).toEqual(["_repo", "src/big/"]);
    const stale = body.notes.flatMap((n: any) => n.entries).filter((e: any) => e.stale);
    expect(stale.length).toBe(1);
    expect(stale[0].codeChanged).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(body.importers.map((i: any) => i.id)).toEqual(["src/big/__tests__/a01.test.ts"]);
    expect(body.importers[0].role).toBe("test");
    expect(body.imports.find((i: any) => i.id === "src/types/shape.ts").names).toEqual(["emptyShape", "Shape"]);
    expect(body.testedBy).toEqual(["src/big/__tests__/a01.test.ts"]);
    expect(body.tasks.map((t: any) => t.slug).sort()).toEqual([fx.slugs.awaiting, fx.slugs.inProcess].sort());
    for (const t of body.tasks) expect(TASK_STATES).toContain(t.state);
    expect(body.history.commits365).toBeGreaterThan(0);
    expect(Array.isArray(body.history.recent)).toBe(true);
    expect(body.editorUrl.startsWith("vscode://file")).toBe(true);
    expect(body.editorUrl).toContain("src/big/a01.ts");
  });

  it("lists external packages among the imports", async () => {
    const body = await ok("/api/file?path=src/big/ipc.ts");
    const external = body.imports.find((i: any) => i.external);
    expect(external.id).toBe("@tauri-apps/api/core");
    expect(external.area).toBeNull();
    expect(external.names).toContain("invoke");
  });

  it("400s a traversal path and 404s a missing file", async () => {
    const bad = await get("/api/file?path=../package.json");
    expect(bad.status).toBe(400);
    expect(bad.body.error).toBe("bad path");
    expect((await get("/api/file?path=/etc/passwd")).status).toBe(400);
    expect((await get("/api/file?path=")).status).toBe(400);
    expect((await get("/api/file?path=src/nope.ts")).status).toBe(404);
  });

  it("returns symbols with the engine name", async () => {
    const body = await ok("/api/symbols?path=src/types/shape.ts");
    expect(body.path).toBe("src/types/shape.ts");
    expect(body.engine).toBe("regex");
    expect(body.symbols.map((s: any) => s.name).sort()).toEqual(["Shape", "emptyShape"]);
    expect((await get("/api/symbols?path=../package.json")).status).toBe(400);
    expect((await get("/api/symbols?path=src/nope.ts")).status).toBe(404);
  });
});

describe("GET tasks, task detail, state machine and evidence", () => {
  it("lists tasks with the extended fields", async () => {
    const body = await ok("/api/tasks?all=1");
    expect(Array.isArray(body)).toBe(true);
    const bySlug = new Map(body.map((t: any) => [t.slug, t]));
    expect(bySlug.get(fx.slugs.inProcess).state).toBe("in-process");
    expect(bySlug.get(fx.slugs.awaiting).state).toBe("awaiting-decision");
    expect(bySlug.get(fx.slugs.ungroomed).state).toBe("ungroomed");
    for (const t of body) {
      expect(typeof t.stateDefinition).toBe("string");
      expect(t.stateDefinition.length).toBeGreaterThan(0);
      expect(t.age === null || typeof t.age === "number").toBe(true);
      expect(Array.isArray(t.planFiles)).toBe(true);
      expect(Array.isArray(t.changedFiles)).toBe(true);
    }
    expect(bySlug.get(fx.slugs.inProcess).planFiles).toContain("src/big/a01.ts");
    expect(bySlug.get(fx.slugs.inProcess).changedFiles).toContain("src/big/a01.ts");
  });

  it("returns the task detail with plan, packet, journal and impact", async () => {
    const body = await ok(`/api/task/${fx.slugs.awaiting}`);
    expect(body.task.slug).toBe(fx.slugs.awaiting);
    expect(body.plan.criteria.length).toBeGreaterThan(0);
    expect(body.plan.files.map((f: any) => f.path)).toContain("src/types/shape.ts");
    for (const f of body.plan.files) expect(typeof f.nodeId).toBe("string");
    expect(body.packet).not.toBeNull();
    expect(body.packet.evidence.some((e: string) => e.endsWith("tests.txt"))).toBe(true);
    expect(Array.isArray(body.journal)).toBe(true);
    expect(body.impact.planned).toContain("src/types/shape.ts");
    expect(body.impact.collisions.map((c: any) => c.file)).toContain("src/big/a01.ts");
    expect(body.impact.downstream.length).toBeGreaterThan(0);
    for (const d of body.impact.downstream) expect(d.hop).toBeGreaterThanOrEqual(1);
    expect(body.contextRoute).toContain("/api/context?slug=");
  });

  it("400s an unsafe slug and 404s an unknown one", async () => {
    expect((await get("/api/task/..%2F..%2Fetc")).status).toBe(400);
    expect((await get("/api/task/no-such-task")).status).toBe(404);
  });

  it("returns the state machine with counts", async () => {
    const body = await ok("/api/state-machine");
    expect(body.states.map((s: any) => s.id)).toEqual([...TASK_STATES]);
    for (const s of body.states) {
      expect(typeof s.label).toBe("string");
      expect(typeof s.definition).toBe("string");
      expect(typeof s.rule).toBe("string");
    }
    expect(body.transitions.length).toBeGreaterThan(0);
    expect(Object.keys(body.counts).sort()).toEqual([...TASK_STATES].sort());
    expect(body.counts["in-process"]).toBe(1);
    expect(body.counts["awaiting-decision"]).toBe(1);
    expect(body.mode).toBe("solo");
  });

  it("streams evidence and refuses traversal", async () => {
    const res = await fetch(`${base}/api/evidence?slug=${fx.slugs.awaiting}&file=tests.txt`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/plain");
    expect(await res.text()).toContain("passed");
    expect((await fetch(`${base}/api/evidence?slug=${fx.slugs.awaiting}&file=../packet.md`)).status).toBe(400);
    expect((await fetch(`${base}/api/evidence?slug=${fx.slugs.awaiting}&file=a/b.txt`)).status).toBe(400);
    expect((await fetch(`${base}/api/evidence?slug=../etc&file=tests.txt`)).status).toBe(400);
    expect((await fetch(`${base}/api/evidence?slug=${fx.slugs.awaiting}&file=nope.txt`)).status).toBe(404);
  });
});

describe("GET history, notes, journal, people, search, workspace and context", () => {
  it("returns history for a path and for the repo", async () => {
    const body = await ok("/api/history?path=src/big&days=90");
    expect(body.path).toBe("src/big");
    expect(body.history.commits365).toBeGreaterThan(0);
    expect(body.history.authors[0].handle).toBe("test");
    expect(body.history.busFactor).toBeGreaterThanOrEqual(1);
    expect(body.recent.length).toBeGreaterThan(0);
    for (const c of body.recent) expect(c.sha).toMatch(/^[0-9a-f]{7,40}$/);
    expect(Array.isArray(body.commitsPerDay)).toBe(true);
    const whole = await ok("/api/history");
    expect(whole.path).toBe("");
    expect(whole.history.commits365).toBeGreaterThan(0);
    expect((await get("/api/history?path=../etc")).status).toBe(400);
  });

  it("returns notes with stale keys and citedBy", async () => {
    const body = await ok("/api/notes");
    expect(body.notes.map((n: any) => n.entity)).toContain("src/big/");
    expect(body.stale).toContain("src/big/|2020-01-01|gotcha");
    const flagged = body.notes.find((n: any) => n.entity === "src/big/").entries.find((e: any) => e.stale);
    expect(flagged.codeChanged).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(body.citedBy["src/big/a01.ts"]).toContain("src/big/");
  });

  it("returns a note chain for a path", async () => {
    const body = await ok("/api/note?path=src/big/a01.ts");
    expect(body.chain.map((n: any) => n.entity)).toEqual(["_repo", "src/big/"]);
    expect(body.chain[1].entries[0].stale).toBe(true);
    expect((await ok("/api/note?path=_repo")).chain.map((n: any) => n.entity)).toEqual(["_repo"]);
    expect((await ok("/api/note")).chain).toEqual([]);
    expect((await get("/api/note?path=../package.json")).status).toBe(400);
  });

  it("returns journal entries with taskExists, nodeIds and the path filter", async () => {
    const body = await ok("/api/journal?days=3650");
    expect(body.length).toBeGreaterThan(0);
    for (const e of body) {
      expect(typeof e.taskExists).toBe("boolean");
      expect(Array.isArray(e.nodeIds)).toBe(true);
    }
    const withTask = body.find((e: any) => e.slug === fx.slugs.inProcess);
    expect(withTask.taskExists).toBe(true);
    expect(withTask.nodeIds).toContain("src/big/a01.ts");
    const filtered = await ok("/api/journal?days=3650&path=src/big");
    expect(filtered.length).toBeGreaterThan(0);
    expect(filtered.length).toBeLessThan(body.length);
    for (const e of filtered) expect(e.nodeIds.some((id: string) => id.startsWith("src/big"))).toBe(true);
    expect((await ok(`/api/journal?days=3650&slug=${fx.slugs.inProcess}`)).every((e: any) => e.slug === fx.slugs.inProcess)).toBe(true);
    expect((await get("/api/journal?slug=..%2Fetc")).status).toBe(400);
  });

  it("returns people with areas, claims and the current handle", async () => {
    const body = await ok("/api/people");
    expect(body.mode).toBe("solo");
    expect(body.current).toBe("test");
    const me = body.people.find((p: any) => p.handle === "test");
    expect(me.role).toBe("maintainer");
    expect(me.fromGit).toBe(false);
    expect(me.commits365).toBeGreaterThan(0);
    expect(me.areas.map((a: any) => a.id)).toContain("dir:src/");
    expect(me.busFactorAreas).toContain("dir:src/");
    expect(me.activeClaims.map((c: any) => c.slug).sort()).toEqual([fx.slugs.awaiting, fx.slugs.inProcess].sort());
    expect(me.lastJournal).not.toBeNull();
  });

  it("ranks search results by the contract's table", async () => {
    const body = await ok("/api/search?q=shape");
    expect(body.results[0]).toMatchObject({ kind: "file", id: "src/types/shape.ts", score: 100 });
    expect(body.results[0].route).toBe("#/repo/fixture/file/src/types/shape.ts");
    const kinds = new Map(body.results.map((r: any) => [r.kind, r.score]));
    expect(kinds.get("symbol")).toBe(55);
    expect(kinds.get("task")).toBe(50);
    expect(kinds.get("note")).toBe(30);
    for (let i = 1; i < body.results.length; i += 1) expect(body.results[i].score).toBeLessThanOrEqual(body.results[i - 1].score);
    for (const r of body.results) {
      expect(typeof r.snippet).toBe("string");
      expect(r.route.startsWith("#/")).toBe(true);
    }
    expect((await ok("/api/search?q=emptyShape")).results[0]).toMatchObject({ kind: "symbol", score: 55 });
    expect((await ok("/api/search?q=&limit=5")).results).toEqual([]);
    expect((await ok("/api/search?q=shape&limit=1")).results).toHaveLength(1);
  });

  it("returns the single-repo workspace summary", async () => {
    const body = await ok("/api/workspace");
    expect(body.single).toBe(true);
    expect(body.edges).toEqual([]);
    expect(body.repos).toHaveLength(1);
    const repo = body.repos[0];
    expect(repo.name).toBe("fixture");
    expect(repo.branch).toBe("main");
    expect(repo.codeFiles).toBeGreaterThan(0);
    expect(Object.keys(repo.taskCounts).sort()).toEqual([...TASK_STATES].sort());
    expect(repo.knowledge.source).toBeGreaterThan(0);
    expect(Array.isArray(repo.needsYou)).toBe(true);
  });

  it("returns a context pack", async () => {
    const body = await ok(`/api/context?slug=${fx.slugs.inProcess}`);
    expect(body.text).toContain(fx.slugs.inProcess);
    const byPath = await ok("/api/context?path=src/big/a01.ts");
    expect(byPath.text.length).toBeGreaterThan(0);
  });

  it("reserves the stretch routes with 501", async () => {
    for (const route of ["/api/treemap?root=src", "/api/timeline", "/api/export?view=container"]) {
      const { status, body } = await get(route);
      expect(status).toBe(501);
      expect(body).toEqual({ error: "not implemented" });
    }
  });

  it("404s an unknown api route and 405s a non-GET method", async () => {
    expect((await get("/api/nope")).status).toBe(404);
    const res = await fetch(`${base}/api/tasks`, { method: "DELETE" });
    expect(res.status).toBe(405);
    await res.text();
  });
});

describe("POST guards", () => {
  it("refuses a cross-site POST with 403 and writes nothing", async () => {
    const before = intakeText();
    const { status, body } = await post("/api/capture", { text: "Cross-site capture" }, { "sec-fetch-site": "cross-site" });
    expect(status).toBe(403);
    expect(body.error).toContain("cross-site");
    expect(intakeText()).toBe(before);
  });

  it("refuses a foreign Origin with 403 and writes nothing", async () => {
    const before = intakeText();
    const { status, body } = await post("/api/capture", { text: "Evil capture" }, { origin: "http://evil.example.com" });
    expect(status).toBe(403);
    expect(body.error).toContain("origin");
    expect(intakeText()).toBe(before);
  });

  it("accepts a same-origin POST header set", async () => {
    const res = await fetch(`${base}/api/journal`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: base, "sec-fetch-site": "same-origin" },
      body: JSON.stringify({ text: "Checked the guidebook from the browser.", stage: "verify" }),
    });
    expect(res.status).toBe(200);
    const entry = await res.json();
    expect(entry.tool).toBe("human");
    expect(entry.person).toBe("test");
    expect(entry.stage).toBe("verify");
  });

  // SEC-01: the guard used to accept any POST whose `Origin` equalled its own `Host`, both of
  // which the attacker writes. A page on a domain rebound to 127.0.0.1 satisfied every check —
  // loopback socket, `same-origin` Sec-Fetch-Site, matching Origin — and got write access.
  it("refuses a DNS-rebound POST whose Origin matches its forged Host", async () => {
    const before = intakeText();
    const payload = JSON.stringify({ text: "Rebound capture" });
    const { status, body } = await raw({
      method: "POST",
      route: "/api/capture",
      headers: {
        host: `evil.test:${server.port}`,
        origin: `http://evil.test:${server.port}`,
        "sec-fetch-site": "same-origin",
        "content-type": "application/json",
        "content-length": String(Buffer.byteLength(payload)),
      },
      body: payload,
    });
    expect(status).toBe(403);
    expect(JSON.parse(body).error).toContain("host");
    expect(intakeText()).toBe(before);
  });

  it("refuses a DNS-rebound GET, so a rebound page cannot read source either", async () => {
    const { status, body } = await raw({ route: "/api/file?path=src/types/shape.ts", headers: { host: `evil.test:${server.port}` } });
    expect(status).toBe(403);
    expect(JSON.parse(body).error).toContain("host");
  });

  it("still serves loopback Host headers by name, literal and brackets", async () => {
    for (const host of [`127.0.0.1:${server.port}`, `localhost:${server.port}`, `[::1]:${server.port}`]) {
      const { status } = await raw({ route: "/api/status", headers: { host } });
      expect(status, host).toBe(200);
    }
  });

  it("413s a body over 64 KB", async () => {
    const { status, body } = await post("/api/capture", { text: "x".repeat(70_000) });
    expect(status).toBe(413);
    expect(body.error).toContain("too large");
  });

  it("400s malformed JSON and missing fields", async () => {
    expect((await post("/api/capture", "{not json")).status).toBe(400);
    expect((await post("/api/capture", {})).status).toBe(400);
    expect((await post("/api/note", { entity: "src/big/a01.ts", text: "hi", type: "nonsense" })).status).toBe(400);
    expect((await post("/api/decide", { slug: fx.slugs.awaiting, verdict: "maybe" })).status).toBe(400);
  });

  it("404s a POST to an unknown route and 405s a POST to a read-only one", async () => {
    expect((await post("/api/nope", {})).status).toBe(404);
    expect((await post("/api/tasks", {})).status).toBe(405);
  });
});

describe("POST writes", () => {
  it("captures an idea that shows up as an ungroomed task", async () => {
    const before = await ok("/api/tasks?all=1");
    const { status, body } = await post("/api/capture", { text: "Try the new guidebook", detail: "From the web UI" });
    expect(status).toBe(200);
    expect(body.slug).toBe("try-the-new-guidebook");
    expect(body.line).toContain("Try the new guidebook");
    expect(intakeText()).toContain("try-the-new-guidebook");

    const after = await ok("/api/tasks?all=1");
    expect(after.length).toBe(before.length + 1);
    const created = after.find((t: any) => t.slug === "try-the-new-guidebook");
    expect(created.state).toBe("ungroomed");
    expect(created.stateDefinition.length).toBeGreaterThan(0);
    expect(created.intake.text).toBe("Try the new guidebook");

    const counts = await ok("/api/state-machine");
    expect(counts.counts.ungroomed).toBe(2);
  });

  it("adds a note attributed to the web", async () => {
    const { status, body } = await post("/api/note", {
      entity: "src/tiny/one.ts",
      type: "how",
      text: "One adds to two; the tiny area exists to test folding.",
      confidence: "high",
      sources: ["src/tiny/one.ts:1"],
    });
    expect(status).toBe(200);
    expect(body.entity).toBe("src/tiny/one.ts");
    expect(body.kind).toBe("file");
    expect(body.created).toBe(true);
    expect(body.entry.author).toBe("test (web)");
    expect(body.entry.confidence).toBe("high");

    const chain = await ok("/api/note?path=src/tiny/one.ts");
    expect(chain.chain.map((n: any) => n.entity)).toContain("src/tiny/one.ts");
  });

  it("refuses a note that escapes the repo", async () => {
    expect((await post("/api/note", { entity: "../outside.ts", type: "how", text: "no" })).status).toBe(400);
  });

  it("409s a decision when no packet exists anywhere", async () => {
    const { status, body } = await post("/api/decide", { slug: fx.slugs.inProcess, verdict: "approved" });
    expect(status).toBe(409);
    expect(body.error).toContain("no packet");
  });

  // Last: approving the awaiting-decision task moves it to done for every route after it.
  it("approves a packet that only exists on the task branch and moves the card to done", async () => {
    const slug = fx.slugs.awaiting;
    const before = await ok(`/api/task/${slug}`);
    expect(before.task.state).toBe("awaiting-decision");
    expect(before.packet.verdict).toBe("pending");
    expect(existsSync(packetFile(fx.paths, slug))).toBe(false);

    const { status, body } = await post("/api/decide", { slug, verdict: "approved", comment: "criteria met" });
    expect(status, JSON.stringify(body)).toBe(200);
    expect(body.verdict).toBe("approved");
    expect(body.materializedFrom).toBe(`task/${slug}`);
    expect(readFileSync(packetFile(fx.paths, slug), "utf8")).toContain("verdict: approved");

    const after = await ok(`/api/task/${slug}`);
    expect(after.packet.verdict).toBe("approved");
    expect(after.packet.decidedBy.length).toBeGreaterThan(0);
    expect(after.packet.sections["Decision"]).toContain("criteria met");
    expect(after.task.state).toBe("done");

    const board = await ok("/api/tasks?all=1");
    expect(board.find((t: any) => t.slug === slug).state).toBe("done");
  });
});

describe("GET /api/launch", () => {
  it("describes the session without starting anything", async () => {
    const body = await ok(`/api/launch?slug=${fx.slugs.inProcess}&tool=claude&mode=implement`);
    expect(Object.keys(body).sort()).toEqual(["command", "cwd", "description"]);
    expect(body.command).toBe(`claude '/reggie-execute ${fx.slugs.inProcess}'`);
    expect(body.cwd).toBe(fx.repo.root);
    expect(body.description).toContain("Claude Code");
    expect(body.description).toContain(fx.slugs.inProcess);
  });

  it("spells the Codex prompts out inline, since Codex has no slash commands", async () => {
    const body = await ok(`/api/launch?slug=${fx.slugs.ungroomed}&tool=codex&mode=chat`);
    expect(body.command.startsWith("codex ")).toBe(true);
    expect(body.command).toContain("do not edit any file");
    expect(body.description).toContain("read-only");
  });

  it("takes several slugs in triage mode and exactly one in every other mode", async () => {
    const many = await ok(`/api/launch?slug=${fx.slugs.ungroomed}&slug=${fx.slugs.inProcess}&tool=claude&mode=triage`);
    expect(many.command).toContain("/reggie-triage");
    expect(many.command).toContain(fx.slugs.ungroomed);
    expect(many.command).toContain(fx.slugs.inProcess);

    const { status, body } = await get(`/api/launch?slug=${fx.slugs.ungroomed}&slug=${fx.slugs.inProcess}&tool=claude&mode=plan`);
    expect(status).toBe(400);
    expect(body.error).toContain("exactly one slug");
  });

  it("400s an unknown tool, an unknown mode, a bad slug, and no slug at all", async () => {
    const cases: [string, string][] = [
      [`/api/launch?slug=${fx.slugs.inProcess}&tool=emacs&mode=chat`, "tool must be one of"],
      [`/api/launch?slug=${fx.slugs.inProcess}&tool=claude&mode=refactor`, "mode must be one of"],
      ["/api/launch?slug=../etc/passwd&tool=claude&mode=chat", "bad slug"],
      ["/api/launch?tool=claude&mode=chat", "at least one slug"],
      [`/api/launch?slug=${fx.slugs.inProcess}&mode=chat`, "tool must be one of"],
    ];
    for (const [route, message] of cases) {
      const { status, body } = await get(route);
      expect(status, route).toBe(400);
      expect(body.error, route).toContain(message);
    }
  });
});

describe("POST /api/triage", () => {
  it("scaffolds a brief and moves the card from ungroomed to groomed", async () => {
    const slug = fx.slugs.ungroomed;
    const before = await ok("/api/tasks?all=1");
    expect(before.find((t: any) => t.slug === slug).state).toBe("ungroomed");
    expect(before.find((t: any) => t.slug === slug).brief).toBeNull();
    expect(before.find((t: any) => t.slug === slug).phase).toBe("capture");

    const { status, body } = await post("/api/triage", { slug });
    expect(status, JSON.stringify(body)).toBe(200);
    expect(body.created).toEqual([slug]);
    expect(body.skipped).toEqual([]);
    expect(readFileSync(briefFile(fx.paths, slug), "utf8")).toContain("## Suspected area");

    const after = await ok("/api/tasks?all=1");
    const card = after.find((t: any) => t.slug === slug);
    expect(card.state).toBe("groomed");
    expect(card.phase).toBe("shape");
    expect(card.reason).toContain("brief");
    expect(card.brief.exists).toBe(true);
    expect(card.brief.size).toBe("unset");
    expect(card.brief.priority).toBe("unset");

    const detail = await ok(`/api/task/${slug}`);
    expect(detail.brief.meta.slug).toBe(slug);
    expect(Object.keys(detail.brief.sections)).toContain("Problem");
    expect(detail.brief.sections["Not this"].length).toBeGreaterThan(0);
    expect(detail.completion).toBeNull();
  });

  it("never overwrites a brief that is already there", async () => {
    const slug = fx.slugs.ungroomed;
    const before = readFileSync(briefFile(fx.paths, slug), "utf8");
    const { status, body } = await post("/api/triage", { slugs: [slug] });
    expect(status).toBe(200);
    expect(body.created).toEqual([]);
    expect(body.skipped).toEqual([{ slug, reason: "a brief already exists" }]);
    expect(readFileSync(briefFile(fx.paths, slug), "utf8")).toBe(before);
  });

  it("shapes a whole selection in one call and skips what it does not know", async () => {
    const { status, body } = await post("/api/triage", { slugs: [fx.slugs.inProcess, "no-such-task"] });
    expect(status).toBe(200);
    expect(body.created).toEqual([fx.slugs.inProcess]);
    expect(body.skipped).toEqual([{ slug: "no-such-task", reason: "nothing in this repo names that task" }]);
    expect(existsSync(briefFile(fx.paths, fx.slugs.inProcess))).toBe(true);
  });

  it("400s an empty request and a bad slug", async () => {
    expect((await post("/api/triage", {})).status).toBe(400);
    expect((await post("/api/triage", { slug: "../etc" })).status).toBe(400);
    expect((await post("/api/triage", { slugs: ["ok-one", "../etc"] })).status).toBe(400);
  });
});

describe("POST /api/launch", () => {
  it("refuses a cross-site launch with 403 and starts nothing", async () => {
    const { status, body } = await post("/api/launch", { slugs: [fx.slugs.inProcess], tool: "claude", mode: "chat" }, { "sec-fetch-site": "cross-site" });
    expect(status).toBe(403);
    expect(body.error).toContain("cross-site");
  });

  it("refuses a foreign Origin with 403", async () => {
    const { status, body } = await post("/api/launch", { slugs: [fx.slugs.inProcess], tool: "claude", mode: "chat" }, { origin: "http://evil.example.com" });
    expect(status).toBe(403);
    expect(body.error).toContain("origin");
  });

  it("400s bad input and 404s a task this repo has never heard of", async () => {
    expect((await post("/api/launch", { slugs: [fx.slugs.inProcess], tool: "emacs", mode: "chat" })).status).toBe(400);
    expect((await post("/api/launch", { slugs: [fx.slugs.inProcess], tool: "claude", mode: "refactor" })).status).toBe(400);
    expect((await post("/api/launch", { slugs: ["../etc"], tool: "claude", mode: "chat" })).status).toBe(400);
    expect((await post("/api/launch", { slugs: [], tool: "claude", mode: "chat" })).status).toBe(400);
    expect((await post("/api/launch", { slugs: [fx.slugs.inProcess, fx.slugs.ungroomed], tool: "claude", mode: "plan" })).status).toBe(400);
    const { status, body } = await post("/api/launch", { slugs: ["no-such-task"], tool: "claude", mode: "chat" });
    expect(status).toBe(404);
    expect(body.error).toContain("unknown task");
  });

  // Nothing in this suite may open a Terminal window, so the platform is stubbed away from
  // darwin first: launchSession then takes the branch that returns the command to copy.
  it("returns the command unlaunched where it cannot open a terminal", async () => {
    const real = process.platform;
    Object.defineProperty(process, "platform", { value: "linux", configurable: true });
    try {
      const { status, body } = await post("/api/launch", { slugs: [fx.slugs.inProcess], tool: "claude", mode: "implement" });
      expect(status, JSON.stringify(body)).toBe(200);
      expect(body.launched).toBe(false);
      expect(body.command).toBe(`claude '/reggie-execute ${fx.slugs.inProcess}'`);
      expect(body.reason).toContain("macOS");
    } finally {
      Object.defineProperty(process, "platform", { value: real, configurable: true });
    }
  });
});

describe("the completed view", () => {
  it("says what was actually done for a finished task", async () => {
    const slug = fx.slugs.awaiting;
    const body = await ok(`/api/task/${slug}`);
    expect(body.task.state).toBe("done");
    expect(body.task.phase).toBe("done");

    const done = body.completion;
    expect(done).not.toBeNull();
    expect(done.verdict).toBe("approved");
    expect(done.decidedBy.length).toBeGreaterThan(0);
    expect(done.decidedAt).toMatch(/\d{4}-\d{2}-\d{2}/);

    expect(done.criteria.length).toBeGreaterThan(0);
    for (const k of done.criteria) {
      expect(typeof k.text).toBe("string");
      expect(k.pass === null || typeof k.pass === "boolean").toBe(true);
      expect(Array.isArray(k.evidence)).toBe(true);
    }
    const proof = done.criteria.flatMap((k: any) => k.evidence).find((e: any) => e.path.endsWith("tests.txt"));
    expect(proof.exists).toBe(true);
    expect(proof.route).toBe(`/api/evidence?slug=${slug}&file=tests.txt`);
    const fetched = await fetch(base + proof.route);
    expect(fetched.status).toBe(200);
    expect(await fetched.text()).toContain("passed");

    expect(done.diff.files.map((f: any) => f.path)).toContain("src/types/shape.ts");
    expect(done.diff.files.every((f: any) => !f.path.startsWith(".reggie/"))).toBe(true);
    expect(done.diff.filesChanged).toBe(done.diff.files.length);
    expect(done.diff.added).toBeGreaterThan(0);
    expect(done.diff.commits).toBeGreaterThan(0);

    expect(done.commits.length).toBe(done.diff.commits);
    expect(done.commits.some((k: any) => k.subject.includes("sizeOf"))).toBe(true);
    for (const k of done.commits) {
      expect(k.sha).toMatch(/^[0-9a-f]{40}$/);
      expect(typeof k.handle).toBe("string");
    }
    expect(Array.isArray(done.journal)).toBe(true);
  });

  it("leaves the completion block null for everything still open", async () => {
    for (const slug of [fx.slugs.inProcess, fx.slugs.ungroomed]) {
      const body = await ok(`/api/task/${slug}`);
      expect(body.task.state).not.toBe("done");
      expect(body.completion).toBeNull();
    }
  });

  it("still reports the six states on the state machine", async () => {
    const body = await ok("/api/state-machine");
    expect(body.states.map((s: any) => s.id)).toEqual(["ungroomed", "groomed", "planned", "in-process", "awaiting-decision", "done"]);
    expect(JSON.stringify(body)).not.toContain("grooming");
    expect(body.transitions.some((t: any) => t.from === "ungroomed" && t.to === "groomed")).toBe(true);
    expect(body.transitions.some((t: any) => t.from === "groomed" && t.to === "planned")).toBe(true);
    expect(body.counts.groomed).toBeGreaterThan(0);
  });
});
