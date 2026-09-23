import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { request as httpRequest } from "node:http";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { claimTask } from "../src/claim.js";
import { git } from "../src/git.js";
import { clearHistoryCache } from "../src/history.js";
import { appendJournal } from "../src/journal.js";
import { briefFile, packetFile } from "../src/paths.js";
import { lanAddresses, startServer, type ServerHandle } from "../src/serve.js";
import { TASK_STATES } from "../src/tasks.js";
import { ensureLayout } from "../src/layout.js";
import { currentPerson, ensureConfig, loadConfig, loadPeople } from "../src/people.js";
import { repoPaths } from "../src/paths.js";
import { makeDiffFixture, oddLine, SPACED_NAMES, XSS_LINE, type DiffFixture } from "./diff-fixture.js";
import { makeFixtureRepo, type FixtureRepo } from "./fixtures.js";
import { fullPlan, makeTempRepo, type TempRepo } from "./helpers.js";
import { evidenceRelDir, packetRelPath } from "../src/paths.js";
import { evaluateCompletion, evaluationStats } from "../src/policy.js";
import { parseIntake } from "../src/tasks.js";
import { makePolicyFixture, policySnapshot, type PolicyFixture } from "./policy-fixture.js";

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
  it.each(["/api/history", "/api/story?scope=repo", "/api/explain?id=src/types/shape.ts"])(
    "refuses an out-of-range or non-numeric days on %s",
    async (route) => {
      const sep = route.includes("?") ? "&" : "?";
      for (const bad of ["100000000", "0", "-5", "731", "abc", "1e9", "12.5", "999999999999999999999"]) {
        const { status, body } = await get(`${route}${sep}days=${encodeURIComponent(bad)}`);
        expect(status, `${route} days=${bad}`).toBe(400);
        expect(body.error).toMatch(/days must be an integer between 1 and 730/);
      }
      for (const good of ["1", "30", "730", ""]) expect((await get(`${route}${sep}days=${good}`)).status, `${route} days=${good}`).toBe(200);
    }
  );

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
    repo: ["needs-you", "what", "made-of", "starts", "talks", "flight", "recent", "gaps", "run", "add-note"],
    area: ["read-first", "inside", "uses", "used-by", "tests", "people", "tasks", "recent", "add-note"],
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
    expect(body.engine).toBe("typescript");
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

  it("serves evidence sandboxed, so agent-written HTML cannot reach this origin's write routes", async () => {
    const res = await fetch(`${base}/api/evidence?slug=${fx.slugs.awaiting}&file=tests.txt`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-security-policy")).toBe("sandbox");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("referrer-policy")).toBe("no-referrer");
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

  it("404s the withdrawn stretch routes rather than promising them with a 501", async () => {
    for (const route of ["/api/treemap?root=src", "/api/timeline", "/api/export?view=container"]) {
      const { status, body } = await get(route);
      expect(status).toBe(404);
      expect(body).toEqual({ error: "not found" });
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

    // A solo approval merges, and git will not merge over the page's own uncommitted writes above.
    fx.repo.commitAll("the page's writes so far");
    const { status, body } = await post("/api/decide", { slug, verdict: "approved", comment: "criteria met" });
    expect(status, JSON.stringify(body)).toBe(200);
    expect(body.verdict).toBe("approved");
    expect(body.merge).toMatch(/^[0-9a-f]{40}$/);
    expect(body.alreadyLanded).toBe(false);
    expect(git(["rev-parse", "HEAD"], { cwd: fx.repo.root }).stdout.trim()).toBe(body.merge);
    expect(git(["branch", "--list", `task/${slug}`], { cwd: fx.repo.root }).stdout.trim()).toBe("");
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
  it("describes the session without starting anything, and derives the goal from the task's state", async () => {
    const body = await ok(`/api/launch?slug=${fx.slugs.inProcess}&tool=claude&mode=build`);
    expect(Object.keys(body).sort()).toEqual(["command", "cwd", "description", "goal"]);
    expect(body.goal).toBe("build");
    expect(body.command.startsWith("claude ")).toBe(true);
    expect(body.command).not.toContain("/reggie-");
    expect(body.command).toContain(`Implement \`${fx.slugs.inProcess}\``);
    expect(body.command).toContain(`.reggie/.cache/context/${fx.slugs.inProcess}.md`);
    expect(body.cwd).toBe(fx.repo.root);
    expect(body.description).toContain("Claude Code");
    expect(body.description).toContain(fx.slugs.inProcess);
  });

  it("opens a discussion in plan mode, read-only, for both tools", async () => {
    const claude = await ok(`/api/launch?slug=${fx.slugs.ungroomed}&tool=claude&mode=discuss`);
    expect(claude.goal).toBe("shape");
    expect(claude.command.startsWith("claude --permission-mode plan ")).toBe(true);
    const codex = await ok(`/api/launch?slug=${fx.slugs.inProcess}&tool=codex&mode=discuss`);
    expect(codex.goal).toBe("discuss");
    expect(codex.command.startsWith("codex -s read-only ")).toBe(true);
    expect(codex.command).toContain("do not edit any file");
    expect(codex.description).toContain("read-only");
  });

  it("carries the user's note into the prompt", async () => {
    const body = await ok(`/api/launch?slug=${fx.slugs.inProcess}&tool=claude&mode=discuss&note=${encodeURIComponent("focus on the cache key")}`);
    expect(body.command).toContain('The user adds, in their own words: "focus on the cache key"');
  });

  it("shapes several ungroomed slugs at once and refuses several of anything else", async () => {
    const many = await ok(`/api/launch?slug=${fx.slugs.ungroomed}&tool=claude&mode=discuss`);
    expect(many.goal).toBe("shape");
    const { status, body } = await get(`/api/launch?slug=${fx.slugs.ungroomed}&slug=${fx.slugs.inProcess}&tool=claude&mode=discuss`);
    expect(status).toBe(400);
    expect(body.error).toContain("one task unless every task is ungroomed");
    const build = await get(`/api/launch?slug=${fx.slugs.ungroomed}&tool=claude&mode=build`);
    expect(build.status).toBe(400);
    expect(build.body.error).toContain("Discuss it first");
  });

  it("400s an unknown tool, an unknown mode, a bad slug, and no slug at all; 404s an unknown task", async () => {
    const cases: [string, string][] = [
      [`/api/launch?slug=${fx.slugs.inProcess}&tool=emacs&mode=discuss`, "tool must be one of"],
      [`/api/launch?slug=${fx.slugs.inProcess}&tool=claude&mode=plan`, "mode must be one of"],
      ["/api/launch?slug=../etc/passwd&tool=claude&mode=discuss", "bad slug"],
      ["/api/launch?tool=claude&mode=discuss", "at least one slug"],
      [`/api/launch?slug=${fx.slugs.inProcess}&mode=discuss`, "tool must be one of"],
    ];
    for (const [route, message] of cases) {
      const { status, body } = await get(route);
      expect(status, route).toBe(400);
      expect(body.error, route).toContain(message);
    }
    const missing = await get("/api/launch?slug=no-such-task&tool=claude&mode=discuss");
    expect(missing.status).toBe(404);
    expect(missing.body.error).toContain("unknown task");
  });
});

describe("POST /api/triage", () => {
  it("scaffolds a brief, takes the intake line, and leaves the card ungroomed until it is filled in", async () => {
    const slug = fx.slugs.ungroomed;
    const before = await ok("/api/tasks?all=1");
    expect(before.find((t: any) => t.slug === slug).state).toBe("ungroomed");
    expect(before.find((t: any) => t.slug === slug).brief).toBeNull();
    expect(before.find((t: any) => t.slug === slug).phase).toBe("capture");
    expect(before.find((t: any) => t.slug === slug).intake).not.toBeNull();

    const { status, body } = await post("/api/triage", { slug });
    expect(status, JSON.stringify(body)).toBe(200);
    expect(body.created).toEqual([slug]);
    expect(body.skipped).toEqual([]);
    expect(body.takenFromIntake).toEqual([slug]);
    expect(readFileSync(briefFile(fx.paths, slug), "utf8")).toContain("## Suspected area");
    expect(readFileSync(fx.paths.intake, "utf8")).not.toContain(slug);

    const after = await ok("/api/tasks?all=1");
    const card = after.find((t: any) => t.slug === slug);
    // The brief exists, but nobody has written into it, so nothing has been shaped yet.
    expect(card.state).toBe("ungroomed");
    expect(card.phase).toBe("capture");
    expect(card.reason).toBe("brief on disk is still triage's scaffold: placeholder text in Why now, Suspected area, Open questions, Not this");
    expect(card.intake).toBeNull();
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

  it("moves the card to Groomed once somebody writes into the scaffold", async () => {
    // The transition the state machine now describes: filling the brief in is what shapes it,
    // and triage only wrote the template. This is also what puts a card in the Groomed column
    // for the counts further down.
    const slug = fx.slugs.ungroomed;
    const filled = readFileSync(briefFile(fx.paths, slug), "utf8")
      .replace("size: unset", "size: small")
      .replace("priority: unset", "priority: P2")
      .replace(/^\(what makes this worth shaping.*\)$/m, "The chain is the slowest area to read and every task in it pays for the split being deferred.")
      .replace(/^- \(one bullet per file or directory.*\)$/m, "- src/big/ because the chain that would be split lives there")
      .replace(/^- \(each question whose answer.*\)$/m, "- Does anything outside src/big/ import the middle of the chain?")
      .replace(/^- \(the nearby work a reader might confuse this with.*\)$/m, "- Caching the chain shape, which is its own task against the same files");
    writeFileSync(briefFile(fx.paths, slug), filled, "utf8");

    const card = (await ok("/api/tasks?all=1")).find((t: any) => t.slug === slug);
    expect(card.state).toBe("groomed");
    expect(card.phase).toBe("shape");
    expect(card.reason).toBe("brief on disk; no plan yet");
  });

  it("refuses an intake answer for a task that has a brief, rather than rebuilding the line", async () => {
    const slug = fx.slugs.ungroomed;
    const brief = await ok(`/api/task/${slug}`);
    expect(brief.task.brief.exists).toBe(true);
    const before = readFileSync(fx.paths.intake, "utf8");

    const { status, body } = await post("/api/intake", { slug, text: "Here is what I meant." });
    expect(status, JSON.stringify(body)).toBe(409);
    expect(body.error).toContain(`.reggie/tasks/${slug}/brief.md`);
    // `addIntakeDetail` would have written a fresh line for a slug that has none; nothing moved.
    expect(readFileSync(fx.paths.intake, "utf8")).toBe(before);
  });

  it("400s an empty request and a bad slug", async () => {
    expect((await post("/api/triage", {})).status).toBe(400);
    expect((await post("/api/triage", { slug: "../etc" })).status).toBe(400);
    expect((await post("/api/triage", { slugs: ["ok-one", "../etc"] })).status).toBe(400);
  });
});

describe("POST /api/launch", () => {
  it("refuses a cross-site launch with 403 and starts nothing", async () => {
    const { status, body } = await post("/api/launch", { slugs: [fx.slugs.inProcess], tool: "claude", mode: "discuss" }, { "sec-fetch-site": "cross-site" });
    expect(status).toBe(403);
    expect(body.error).toContain("cross-site");
  });

  it("refuses a foreign Origin with 403", async () => {
    const { status, body } = await post("/api/launch", { slugs: [fx.slugs.inProcess], tool: "claude", mode: "discuss" }, { origin: "http://evil.example.com" });
    expect(status).toBe(403);
    expect(body.error).toContain("origin");
  });

  it("400s bad input and 404s a task this repo has never heard of", async () => {
    expect((await post("/api/launch", { slugs: [fx.slugs.inProcess], tool: "emacs", mode: "discuss" })).status).toBe(400);
    expect((await post("/api/launch", { slugs: [fx.slugs.inProcess], tool: "claude", mode: "implement" })).status).toBe(400);
    expect((await post("/api/launch", { slugs: ["../etc"], tool: "claude", mode: "discuss" })).status).toBe(400);
    expect((await post("/api/launch", { slugs: [], tool: "claude", mode: "discuss" })).status).toBe(400);
    expect((await post("/api/launch", { slugs: [fx.slugs.inProcess, fx.slugs.ungroomed], tool: "claude", mode: "discuss" })).status).toBe(400);
    expect((await post("/api/launch", { slugs: [fx.slugs.ungroomed], tool: "claude", mode: "build" })).status).toBe(400);
    expect((await post("/api/launch", { slugs: [fx.slugs.inProcess], tool: "claude", mode: "discuss", note: "x".repeat(5000) })).status).toBe(400);
    const { status, body } = await post("/api/launch", { slugs: ["no-such-task"], tool: "claude", mode: "discuss" });
    expect(status).toBe(404);
    expect(body.error).toContain("unknown task");
  });

  // Nothing in this suite may open a Terminal window, so the platform is stubbed away from
  // darwin first: launchSession then takes the branch that returns the command to copy.
  it("writes the context pack, mints a session, and returns the command unlaunched where it cannot open a terminal", async () => {
    const real = process.platform;
    Object.defineProperty(process, "platform", { value: "linux", configurable: true });
    try {
      const { status, body } = await post("/api/launch", { slugs: [fx.slugs.inProcess], tool: "claude", mode: "discuss", note: "start with the cache" });
      expect(status, JSON.stringify(body)).toBe(200);
      expect(body.launched).toBe(false);
      expect(body.goal).toBe("discuss");
      expect(body.session).toMatch(/^[0-9a-f-]{36}$/);
      expect(body.resume).toBe(`claude --resume ${body.session}`);
      expect(body.command.startsWith(`claude --permission-mode plan --session-id ${body.session} `)).toBe(true);
      expect(body.command).toContain("start with the cache");
      expect(body.reason).toContain("macOS");
      const pack = readFileSync(path.join(fx.repo.root, ".reggie", ".cache", "context", `${fx.slugs.inProcess}.md`), "utf8");
      expect(pack).toContain("# Context pack for " + fx.slugs.inProcess);
      const record = JSON.parse(readFileSync(path.join(fx.repo.root, ".reggie", ".cache", "launches", `${fx.slugs.inProcess}.json`), "utf8"));
      expect(record.session).toBe(body.session);
      expect(record.goal).toBe("discuss");
    } finally {
      Object.defineProperty(process, "platform", { value: real, configurable: true });
    }
  });

  it("claims the task and starts a build in its worktree, on its branch", async () => {
    const real = process.platform;
    Object.defineProperty(process, "platform", { value: "linux", configurable: true });
    try {
      const slug = fx.slugs.inProcess;
      const { status, body } = await post("/api/launch", { slugs: [slug], tool: "codex", mode: "build" });
      expect(status, JSON.stringify(body)).toBe(200);
      expect(body.goal).toBe("build");
      expect(body.cwd).toBe(path.join(fx.repo.root, ".worktree", slug));
      expect(body.command.startsWith("codex -s workspace-write ")).toBe(true);
      expect(body.command).toContain(`worktree on branch \`task/${slug}\``);
      expect(body.command).not.toContain("reggie claim");
      expect(existsSync(path.join(body.cwd, ".reggie", ".cache", "context", `${slug}.md`))).toBe(true);
      expect(git(["rev-parse", "--abbrev-ref", "HEAD"], { cwd: body.cwd }).stdout.trim()).toBe(`task/${slug}`);
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

    // The branch was released when it landed, so all of this comes from the merge commit.
    expect(git(["branch", "--list", `task/${slug}`], { cwd: fx.repo.root }).stdout.trim()).toBe("");
    expect(done.merge.sha).toMatch(/^[0-9a-f]{40}$/);
    expect(done.merge.subject).toContain(`task/${slug}`);
    expect(done.merge.task).toBe(slug);
    expect(done.diff.filesChanged).toBeGreaterThan(0);
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

// ---------------------------------------------------------------------------
// Services and data flow (services-and-flows-spec.md §3)
// ---------------------------------------------------------------------------

/**
 * The fixture the two detectors are written against: a wrangler.toml declaring a D1 database,
 * two KV namespaces (one never touched), an assets binding and a plain var; a migration that
 * names a table; an undeclared secret; a literal fetch host; and a two-hop handler chain that
 * hands `env.CHAT_LOGS` to another module as an object-literal value.
 */
function makeServiceRepo(): TempRepo {
  const repo = makeTempRepo("reggie-serve-services-");
  repo.write(
    "wrangler.toml",
    [
      'name = "fixture-worker"',
      "",
      "[vars]",
      'GREETING = "hello"',
      "",
      "[assets]",
      'binding = "ASSETS"',
      'directory = "./public"',
      "",
      "[[d1_databases]]",
      'binding = "CHAT_LOGS"',
      'database_name = "fixture-logs"',
      'database_id = "db-abc-123"',
      "",
      "[[kv_namespaces]]",
      'binding = "CACHE"',
      'id = "kv-1"',
      "",
      "[[kv_namespaces]]",
      'binding = "UNUSED_KV"',
      'id = "kv-2"',
      "",
    ].join("\n"),
  );
  repo.write("migrations/0001_init.sql", "CREATE TABLE conversations (\n  id TEXT PRIMARY KEY,\n  question TEXT\n);\n");
  repo.write(
    "functions/api/chat.js",
    [
      "import { logConversation } from '../chat/logging.js';",
      "import { askModel } from '../chat/openai.js';",
      "",
      "export async function onRequestPost(context) {",
      "    const { request, env } = context;",
      "    const { message, sessionId } = await request.json();",
      "    const cached = await env.CACHE.get(`chat:${sessionId}`);",
      "    const reply = cached || (await askModel(env.OPENAI_API_KEY, message));",
      "    await logConversation({ db: env.CHAT_LOGS, sessionId, question: message });",
      "    return Response.json({ reply, sessionId });",
      "}",
      "",
    ].join("\n"),
  );
  repo.write(
    "functions/chat/logging.js",
    [
      "export async function logConversation({ db, sessionId, question }) {",
      "    await db",
      "        .prepare('INSERT INTO conversations (id, question) VALUES (?, ?)')",
      "        .bind(sessionId, question)",
      "        .run();",
      "}",
      "",
    ].join("\n"),
  );
  repo.write(
    "functions/chat/openai.js",
    [
      "export async function askModel(apiKey, message) {",
      "    const res = await fetch('https://api.openai.com/v1/responses', {",
      "        headers: { authorization: `Bearer ${apiKey}` },",
      "        body: JSON.stringify({ message }),",
      "    });",
      "    return res.json();",
      "}",
      "",
    ].join("\n"),
  );
  repo.commitAll("worker with a declared database and an undeclared secret");
  return repo;
}

describe("the serve key and the feed's address", () => {
  it("is loopback only by default: no key, no addresses, and a network-style request is refused", async () => {
    expect(server.key).toBeNull();
    expect(server.addresses).toEqual([]);
  });

  it("names its episodes at the address it was asked on, with the key the request carried", async () => {
    const res = await raw({ route: "/api/feed.xml?key=abc", headers: { host: "192.0.2.7:4310" } });
    expect(res.status).toBe(200);
    const xml = res.body;
    expect(xml).toContain("<link>http://192.0.2.7:4310</link>");
    // No episode has been made in this fixture, so there is no enclosure; the base is what the
    // enclosure would carry, and the key suffix is exercised by the unit test on renderFeed.
    expect(xml).not.toContain("127.0.0.1");
  });

  it("mints a key when bound to every interface, and a loopback request still needs none", async () => {
    const wide = await startServer(fx.paths, fx.config, { port: 0, host: "0.0.0.0" });
    try {
      expect(wide.key).toMatch(/^[A-Za-z0-9_-]{20,}$/);
      expect(readFileSync(path.join(fx.repo.root, ".reggie", ".cache", "serve-key"), "utf8").trim()).toBe(wide.key);
      const res = await fetch(`http://127.0.0.1:${wide.port}/api/facts`);
      expect(res.status).toBe(200);
      const again = await startServer(fx.paths, fx.config, { port: 0, host: "0.0.0.0" });
      expect(again.key).toBe(wide.key);
      await again.close();
      // A key on a loopback bind would never be checked, so the handle does not pretend to have one.
      const local = await startServer(fx.paths, fx.config, { port: 0, host: "127.0.0.1", key: "abc" });
      expect(local.key).toBeNull();
      await local.close();
    } finally {
      await wide.close();
    }
  });
});

describe("a repo with nothing to talk to", () => {
  it("answers the services routes with empty lists rather than an error", async () => {
    const body = await ok("/api/services");
    expect(body.services).toEqual([]);
    expect(body.edges).toEqual([]);
    expect(body.undeclared).toEqual([]);
    expect(body.unused).toEqual([]);
    expect((await get("/api/service?id=svc:kv:CACHE")).status).toBe(404);
  });

  it("says why each services section is empty instead of dropping it", async () => {
    const body = await ok("/api/story?scope=services");
    expect(body.sections.map((s: any) => s.id)).toEqual(["needs-attention", "talks-to", "secrets", "not-wired"]);
    for (const section of body.sections) {
      expect(section.paragraphs).toEqual([]);
      expect(section.empty?.text, section.id).toBeTruthy();
    }
    // With no service and no entry point, the repo story keeps its own empty text.
    const talks = (await ok("/api/story?scope=repo")).sections.find((s: any) => s.id === "talks");
    expect(JSON.stringify(talks)).not.toContain("/services|Services");
  });

  it("lists no flow and 404s any flow id", async () => {
    const body = await ok("/api/flows");
    expect(body.flows).toEqual([]);
    expect((await get("/api/flow?id=anything")).status).toBe(404);
  });
});

describe("GET /api/services, /api/service, /api/flows and /api/flow", () => {
  let repo: TempRepo;
  let server: ServerHandle;
  let at: string;
  const FLOW_ID = "functions-api-chat-js-onrequestpost";

  const load = async (route: string): Promise<{ status: number; body: any }> => {
    const res = await fetch(at + route);
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null };
  };
  const loadOk = async (route: string): Promise<any> => {
    const { status, body } = await load(route);
    expect(status, `${route} -> ${JSON.stringify(body).slice(0, 200)}`).toBe(200);
    return body;
  };

  beforeAll(async () => {
    repo = makeServiceRepo();
    const paths = repoPaths(repo.root);
    ensureLayout(paths);
    server = await startServer(paths, loadConfig(paths), { port: 0, host: "127.0.0.1", workspace: null });
    at = `http://127.0.0.1:${server.port}`;
  }, 60_000);

  afterAll(async () => {
    await server?.close();
    repo?.cleanup();
  });

  it("lists every declared binding with the line that declares it, plus the files that touch it", async () => {
    const body = await loadOk("/api/services");
    expect(Object.keys(body).sort()).toEqual(["edges", "generatedAt", "services", "undeclared", "unused"]);
    const byId = new Map<string, any>(body.services.map((s: any) => [s.id, s]));

    const db = byId.get("svc:database:CHAT_LOGS");
    expect(db.declared).toBe(true);
    expect(db.name).toBe("fixture-logs");
    expect(db.resourceId).toBe("db-abc-123");
    expect(db.declaredAt.file).toBe("wrangler.toml");
    expect(readFileSync(`${repo.root}/wrangler.toml`, "utf8").split("\n")[db.declaredAt.line - 1]).toContain("CHAT_LOGS");
    // The files that touch it, per service — including the one that only ever sees it as `db`.
    expect(db.files).toContain("functions/chat/logging.js");
    expect(db.writers).toContain("functions/chat/logging.js");

    expect(byId.get("svc:kv:CACHE").declared).toBe(true);
    expect(byId.get("svc:assets:ASSETS").kind).toBe("assets");
    expect(byId.get("svc:var:GREETING").kind).toBe("var");
    // The migration's table, hung under the database that owns it.
    expect(byId.get("svc:table:conversations").parent).toBe("svc:database:CHAT_LOGS");
  });

  it("puts the undeclared secret and the fetch host in undeclared, and the untouched binding in unused", async () => {
    const body = await loadOk("/api/services");
    const undeclared = body.undeclared.map((s: any) => s.id);
    expect(undeclared).toContain("svc:secret:OPENAI_API_KEY");
    expect(undeclared).toContain("svc:api:api.openai.com");
    // It is a secret, not a declared var, and its call sites are counted.
    const secret = body.undeclared.find((s: any) => s.id === "svc:secret:OPENAI_API_KEY");
    expect(secret.declared).toBe(false);
    expect(secret.uses).toBeGreaterThan(0);
    expect(secret.files).toContain("functions/api/chat.js");
    // Passing the secret to `askModel` must not put an operation on its `apiKey` parameter.
    expect(body.edges.some((e: any) => e.service === "svc:secret:OPENAI_API_KEY" && e.file === "functions/chat/openai.js")).toBe(false);

    const unused = body.unused.map((s: any) => s.id);
    expect(unused).toContain("svc:kv:UNUSED_KV");
    expect(unused).not.toContain("svc:kv:CACHE");
  });

  it("labels every edge read, write or touch, and cites a line that really holds the call", async () => {
    const body = await loadOk("/api/services");
    for (const edge of body.edges) {
      expect(["read", "write", "touch"]).toContain(edge.op);
      expect(edge.sources.length).toBeGreaterThan(0);
    }
    const write = body.edges.find((e: any) => e.service === "svc:database:CHAT_LOGS" && e.op === "write" && e.file === "functions/chat/logging.js");
    // The D1 write reached through the `db` parameter: resolved through a name, so heuristic.
    expect(write).toBeDefined();
    expect(write.confidence).toBe("heuristic");
    const line = readFileSync(`${repo.root}/functions/chat/logging.js`, "utf8").split("\n")[write.sources[0].line - 1];
    expect(line).toContain("prepare");
  });

  it("answers /api/service with the call sites, tasks, children and the flows that reach it", async () => {
    const body = await loadOk("/api/service?id=svc%3Adatabase%3ACHAT_LOGS");
    expect(Object.keys(body).sort()).toEqual(["callSites", "children", "editorUrl", "flows", "notes", "parent", "service", "tasks"]);
    expect(body.service.id).toBe("svc:database:CHAT_LOGS");
    expect(body.callSites.every((e: any) => e.service === "svc:database:CHAT_LOGS")).toBe(true);
    expect(body.children.map((c: any) => c.id)).toEqual(["svc:table:conversations"]);
    expect(body.parent).toBeNull();
    expect(Array.isArray(body.notes)).toBe(true);
    expect(Array.isArray(body.tasks)).toBe(true);
    expect(body.flows.map((f: any) => f.id)).toContain(FLOW_ID);
    expect(body.editorUrl).toContain("wrangler.toml");
  });

  it("refuses a missing id and 404s an unknown one", async () => {
    expect((await load("/api/service")).status).toBe(400);
    expect((await load(`/api/service?id=${"x".repeat(300)}`)).status).toBe(400);
    const missing = await load("/api/service?id=svc:kv:NOPE");
    expect(missing.status).toBe(404);
    expect(missing.body.error).toContain("svc:kv:NOPE");
  });

  it("lists the Cloudflare handler as a flow, with its route and the services it reaches", async () => {
    const body = await loadOk("/api/flows");
    expect(Object.keys(body).sort()).toEqual(["flows", "generatedAt"]);
    const flow = body.flows.find((f: any) => f.id === FLOW_ID);
    expect(flow.kind).toBe("cloudflare");
    expect(flow.method).toBe("POST");
    expect(flow.route).toBe("/api/chat");
    expect(flow.title).toBe("POST /api/chat");
    expect(flow.services).toEqual(expect.arrayContaining(["svc:database:CHAT_LOGS", "svc:kv:CACHE", "svc:api:api.openai.com"]));
    expect(flow.truncated).toBe(false);
    expect(flow.dropped).toEqual([]);
    expect(flow.source.file).toBe("functions/api/chat.js");
  });

  it("traces one flow with its payloads, and reaches D1 through a binding passed as a parameter", async () => {
    const body = await loadOk(`/api/flow?id=${FLOW_ID}`);
    expect(body.id).toBe(FLOW_ID);
    // The request payload is read from the destructured body, marked exact.
    expect(body.steps[0].input.fields).toEqual(["message", "sessionId"]);
    expect(body.steps[0].input.confidence).toBe("exact");
    expect(body.steps[0].input.shape).toBe("request.json()");

    const write = body.steps.find((s: any) => s.to === "svc:database:CHAT_LOGS");
    expect(write.kind).toBe("write");
    expect(write.label).toBe("CHAT_LOGS.prepare");
    expect(write.via).toBe("db");
    expect(write.confidence).toBe("heuristic");
    expect(write.source.file).toBe("functions/chat/logging.js");
    // Two hops: the handler calls the logger, the logger writes.
    expect(body.depth).toBeGreaterThanOrEqual(2);
    expect(body.services).toContain("svc:database:CHAT_LOGS");
    // Every step is either shown or explicitly not derivable — never a guess.
    for (const step of body.steps) {
      for (const p of [step.input, step.output]) {
        if (p !== null) expect(["exact", "heuristic"]).toContain(p.confidence);
      }
    }
  });

  it("validates depth, clamps it to the tracer's hops, and 404s an unknown flow", async () => {
    expect((await load(`/api/flow?id=${FLOW_ID}&depth=0`)).status).toBe(400);
    expect((await load(`/api/flow?id=${FLOW_ID}&depth=abc`)).status).toBe(400);
    expect((await load(`/api/flow?id=${FLOW_ID}&depth=-1`)).status).toBe(400);
    const clamped = await loadOk(`/api/flow?id=${FLOW_ID}&depth=99`);
    expect(clamped.depth).toBeLessThanOrEqual(6);
    const shallow = await loadOk(`/api/flow?id=${FLOW_ID}&depth=1`);
    expect(shallow.depth).toBe(1);
    expect(shallow.truncated).toBe(true);
    expect(shallow.dropped.some((d: any) => d.reason === "depth")).toBe(true);
    expect((await load("/api/flow")).status).toBe(400);
    expect((await load("/api/flow?id=nope")).status).toBe(404);
  });

  it("narrates the services page, undeclared secret first", async () => {
    const body = await loadOk("/api/story?scope=services");
    expect(body.scope).toBe("services");
    expect(body.sections.map((s: any) => s.id)).toEqual(["needs-attention", "talks-to", "secrets", "not-wired"]);
    // Undeclared secrets come first, before the declared-and-unused binding (spec §4).
    const needs = body.sections[0].paragraphs;
    expect(needs[0].text).toContain("OPENAI_API_KEY");
    expect(needs[0].text).toContain("read in one place");
    expect(needs.findIndex((p: any) => p.text.includes("OPENAI_API_KEY"))).toBeLessThan(needs.findIndex((p: any) => p.text.includes("UNUSED_KV")));
    expect(body.sections[3].paragraphs.map((p: any) => p.text).join("\n")).toContain("UNUSED_KV");
    // Every paragraph carries refs and links through routeFor, never a raw path.
    for (const section of body.sections) {
      for (const p of section.paragraphs) {
        expect(p.refs.length, p.text).toBeGreaterThan(0);
        for (const m of p.text.matchAll(/\[\[([^\]|]+)\|/g)) expect(m[1]).toMatch(/^#\//);
      }
    }
  });

  it("narrates one flow step by step, with each paragraph pointing at its own step", async () => {
    const flow = await loadOk(`/api/flow?id=${FLOW_ID}`);
    const body = await loadOk(`/api/story?scope=flow&id=${FLOW_ID}`);
    expect(body.scope).toBe("flow");
    expect(body.id).toBe(FLOW_ID);
    expect(body.title).toBe("POST /api/chat");
    const steps = body.sections.find((s: any) => s.id === "steps");
    expect(steps.paragraphs).toHaveLength(flow.steps.length);
    steps.paragraphs.forEach((p: any, i: number) => {
      expect(p.id).toBe(`step-${i + 1}`);
      expect(p.refs).toContain(flow.steps[i].from);
      expect(p.refs).toContain(flow.steps[i].to);
    });
    expect(steps.paragraphs[0].text).toContain("Step one.");
    // A heuristic payload says where the names came from instead of presenting them as data.
    const guessed = steps.paragraphs.find((p: any) => p.text.includes("field names taken from"));
    expect(guessed?.text).toContain("not from the data");
    // The inferred D1 write is named as inferred.
    const gaps = body.sections.find((s: any) => s.id === "not-derivable");
    expect(JSON.stringify(gaps)).toContain("db");
  });

  it("refuses a flow story without an id and 404s an unknown one", async () => {
    expect((await load("/api/story?scope=flow")).status).toBe(400);
    expect((await load("/api/story?scope=flow&id=nope")).status).toBe(404);
  });

  it("links both pages from the repo story once they have something on them", async () => {
    const body = await loadOk("/api/story?scope=repo");
    const talks = body.sections.find((s: any) => s.id === "talks");
    const text = talks.paragraphs.map((p: any) => p.text).join("\n");
    expect(text).toContain("/services|Services");
    expect(text).toContain("/flows|Data flow");
  });

  it("refuses POST on all four routes", async () => {
    for (const route of ["/api/services", "/api/service", "/api/flows", "/api/flow"]) {
      const res = await fetch(at + route, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
      expect(res.status, route).toBe(405);
      await res.text();
    }
  });
});

// ---------------------------------------------------------------------------
// What a task changed: GET /api/changes and GET /api/filediff
// ---------------------------------------------------------------------------

describe("what a task changed", () => {
  let dfx: DiffFixture;
  let diffServer: ServerHandle;
  let at: string;
  /** A task claimed into `.worktree/<slug>`, for the editor link. */
  const WORKTREE_SLUG = "worktree-task";
  /** Every body a refusal answered with, checked together for leaks at the end. */
  const refusals: string[] = [];

  beforeAll(async () => {
    dfx = makeDiffFixture();
    const person = currentPerson(dfx.repo.root, loadPeople(dfx.paths));
    const worktree = claimTask(dfx.paths, dfx.config, WORKTREE_SLUG, { worktree: true, person, deps: "defer" }).worktree ?? "";
    mkdirSync(path.join(worktree, "src"), { recursive: true });
    writeFileSync(path.join(worktree, "src/in-worktree.ts"), "export const here = 1;\n", "utf8");
    git(["add", "--", "src/in-worktree.ts"], { cwd: worktree });
    git(["-c", "commit.gpgsign=false", "commit", "-q", "-m", "feat: work in the worktree", "-m", `Task: ${WORKTREE_SLUG}`], { cwd: worktree });
    diffServer = await startServer(dfx.paths, dfx.config, { port: 0, host: "127.0.0.1", workspace: null });
    at = `http://127.0.0.1:${diffServer.port}`;
  }, 120_000);

  afterAll(async () => {
    await diffServer?.close();
    git(["worktree", "remove", "--force", path.join(dfx.repo.root, ".worktree", WORKTREE_SLUG)], { cwd: dfx.repo.root, allowFailure: true });
    clearHistoryCache(dfx.repo.root);
    dfx?.repo.cleanup();
  });

  async function hit(route: string): Promise<{ status: number; body: any; text: string }> {
    const res = await fetch(at + route);
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null, text };
  }
  async function changes(slug: string): Promise<any> {
    const { status, body } = await hit(`/api/changes?slug=${encodeURIComponent(slug)}`);
    expect(status, JSON.stringify(body).slice(0, 200)).toBe(200);
    return body;
  }
  async function filediff(slug: string, file: string, extra = ""): Promise<any> {
    const { status, body } = await hit(`/api/filediff?slug=${encodeURIComponent(slug)}&path=${encodeURIComponent(file)}${extra}`);
    expect(status, `${file} -> ${JSON.stringify(body).slice(0, 200)}`).toBe(200);
    return body;
  }
  async function refused(route: string, status: number): Promise<any> {
    const r = await hit(route);
    expect(r.status, `${route} -> ${r.text.slice(0, 200)}`).toBe(status);
    refusals.push(r.text);
    return r.body;
  }
  const kindsOf = (rows: any[]): string => rows.map((r) => r.kind).join(" ");

  describe("routes", () => {
    it("lists an in-process task's change: every field, records apart, totals over the files only", async () => {
      const body = await changes(dfx.slugs.cases);
      expect(body.slug).toBe(dfx.slugs.cases);
      expect(body.available).toBe(true);
      expect(body.reason).toBeNull();
      expect(body.range).toMatchObject({ kind: "branch", baseName: "main", refName: `task/${dfx.slugs.cases}`, commits: 1 });
      expect(body.range.base).toMatch(/^[0-9a-f]{40}$/);
      expect(body.range.ref).toMatch(/^[0-9a-f]{40}$/);
      expect(body.files.length).toBeGreaterThan(20);
      for (const f of [...body.files, ...body.records]) {
        expect(Object.keys(f).filter((k) => k !== "from" && k !== "similarity").sort()).toEqual(["added", "binary", "deleted", "newMode", "oldMode", "path", "status"]);
      }
      expect(body.records.map((f: any) => f.path)).toEqual([`.reggie/tasks/${dfx.slugs.cases}/evidence/tests.txt`]);
      expect(body.files.some((f: any) => f.path.startsWith(".reggie/"))).toBe(false);
      const sum = (key: string): number => body.files.reduce((n: number, f: any) => n + f[key], 0);
      expect(body.totals).toEqual({ files: body.files.length, added: sum("added"), deleted: sum("deleted") });
      const byPath = new Map(body.files.map((f: any) => [f.path, f]));
      expect(byPath.get("src/keep.ts")).toEqual({ path: "src/keep.ts", status: "modified", oldMode: "100644", newMode: "100644", binary: false, added: 2, deleted: 1 });
      expect(byPath.get("src/deleted.ts")).toMatchObject({ status: "deleted", newMode: null, added: 0, deleted: 2 });
      expect(byPath.get("src/added.ts")).toMatchObject({ status: "added", oldMode: null, added: 2, deleted: 0 });
    });

    it("lists each awkward name byte for byte, and opens each one's own rows", async () => {
      const body = await changes(dfx.slugs.cases);
      const listed = body.files.map((f: any) => f.path);
      for (const name of dfx.oddNames) {
        expect(listed, JSON.stringify(name)).toContain(name);
        const d = await filediff(dfx.slugs.cases, name);
        expect(d.path).toBe(name);
        expect(d.rows.filter((r: any) => r.kind === "add").map((r: any) => r.text), JSON.stringify(name)).toEqual([oddLine(name)]);
      }
    });

    it("adds branchRef to every task the list and the task page return", async () => {
      const list = (await hit("/api/tasks?all=1")).body as any[];
      expect(list.find((t) => t.slug === dfx.slugs.cases).branchRef).toBe(`task/${dfx.slugs.cases}`);
      expect(list.find((t) => t.slug === dfx.slugs.noBranch).branchRef).toBeNull();
      expect((await hit(`/api/task/${dfx.slugs.landed}`)).body.task.branchRef).toBeNull();
    });

    it("says whether the graph ever read the file, so a page can skip the routes that would 404", async () => {
      expect((await filediff(dfx.slugs.cases, "src/keep.ts")).mapped).toBe(true);
      expect((await filediff(dfx.slugs.cases, "src/deleted.ts")).mapped).toBe(true);
      for (const [slug, file] of [[dfx.slugs.cases, "src/added.ts"], [dfx.slugs.cases, `.reggie/tasks/${dfx.slugs.cases}/evidence/tests.txt`], [dfx.slugs.landed, `.reggie/tasks/${dfx.slugs.landed}/packet.md`]] as const) {
        expect((await filediff(slug, file)).mapped, file).toBe(false);
        expect((await hit(`/api/story?scope=file&id=${encodeURIComponent(file)}`)).status, file).toBe(404);
        expect((await hit(`/api/impact?id=${encodeURIComponent(file)}`)).status, file).toBe(404);
        expect((await hit(`/api/explain?id=${encodeURIComponent(file)}`)).status, file).toBe(404);
      }
      for (const file of ["src/keep.ts", "src/deleted.ts"]) expect((await hit(`/api/story?scope=file&id=${encodeURIComponent(file)}`)).status, file).toBe(200);
    });

    it("refuses POST on both routes", async () => {
      for (const route of ["/api/changes", "/api/filediff"]) {
        const res = await fetch(at + route, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
        expect(res.status, route).toBe(405);
        await res.text();
      }
    });
  });

  describe("file-level cases over HTTP", () => {
    it("a deleted file: status, card, and del rows numbered on the old side only", async () => {
      const d = await filediff(dfx.slugs.cases, "src/deleted.ts");
      expect(d.status).toBe("deleted");
      expect(d.card.kind).toBe("deleted");
      expect(d.rows).toEqual([
        { kind: "del", old: 1, text: "gone1" },
        { kind: "del", old: 2, text: "gone2" },
      ]);
    });

    it("an added file: all add rows from 1 and no gap, with markup kept as the text it is", async () => {
      const d = await filediff(dfx.slugs.cases, "src/added.ts");
      expect(d.status).toBe("added");
      expect(kindsOf(d.rows)).toBe("add add");
      expect(d.rows.map((r: any) => r.new)).toEqual([1, 2]);
      expect(d.rows[1].text).toBe(XSS_LINE);
    });

    it("a rename without edits is listed once and answers a card and no rows", async () => {
      const body = await changes(dfx.slugs.cases);
      const hits = body.files.filter((f: any) => f.path === "src/renamed-pure.ts" || f.path === "src/rename-pure.ts");
      expect(hits).toEqual([{ path: "src/renamed-pure.ts", status: "renamed", from: "src/rename-pure.ts", similarity: 100, oldMode: "100644", newMode: "100644", binary: false, added: 0, deleted: 0 }]);
      const d = await filediff(dfx.slugs.cases, "src/renamed-pure.ts");
      expect(d.card.kind).toBe("renamed");
      expect(d.rows).toEqual([]);
      // The old name is not a member of the list, so it is not a door.
      await refused(`/api/filediff?slug=${dfx.slugs.cases}&path=${encodeURIComponent("src/rename-pure.ts")}`, 404);
    });

    it("a rename with one edited line answers one add and one del, not the whole file", async () => {
      const d = await filediff(dfx.slugs.cases, "src/renamed-edit.ts");
      expect(kindsOf(d.rows)).toBe("gap ctx ctx ctx del add ctx ctx ctx gap");
      expect([d.added, d.deleted, d.from]).toEqual([1, 1, "src/rename-edit.ts"]);
    });

    it("a binary file answers both byte sizes and no rows; an added one has no old size", async () => {
      const changed = await filediff(dfx.slugs.cases, "src/blob.bin");
      expect([changed.binary, changed.added, changed.deleted, changed.rows]).toEqual([true, 0, 0, []]);
      expect(changed.card).toMatchObject({ kind: "binary", oldSize: dfx.sizes.blobBefore, newSize: dfx.sizes.blobAfter });
      const added = await filediff(dfx.slugs.cases, "src/newblob.bin");
      expect(added.card).toMatchObject({ kind: "binary", oldSize: null, newSize: dfx.sizes.newBlob });
    });

    it("a mode-only change and a symlink", async () => {
      const mode = await filediff(dfx.slugs.cases, "src/script.sh");
      expect([mode.oldMode, mode.newMode, mode.card.kind, mode.rows]).toEqual(["100644", "100755", "mode", []]);
      const link = await filediff(dfx.slugs.cases, "src/link-to-target");
      expect([link.newMode, link.card.kind]).toEqual(["120000", "symlink"]);
      expect(link.rows).toEqual([{ kind: "add", new: 1, text: "target.txt", noeol: true }]);
    });

    it("the three empty-file cases", async () => {
      const empty = await filediff(dfx.slugs.cases, "src/added-empty.txt");
      expect([empty.card.kind, empty.rows]).toEqual(["empty", []]);
      expect(kindsOf((await filediff(dfx.slugs.cases, "src/filled-then-empty.txt")).rows)).toBe("del");
      expect((await filediff(dfx.slugs.cases, "src/empty-then-filled.txt")).rows).toEqual([{ kind: "add", new: 1, text: "now filled" }]);
    });

    it("a CRLF file carries no carriage return into a row", async () => {
      const d = await filediff(dfx.slugs.cases, "src/crlf.txt");
      expect(d.rows.map((r: any) => r.text)).toEqual(["crlf one", "crlf two", "crlf two EDITED"]);
    });
  });

  describe("branch-level cases over HTTP", () => {
    it("an awaiting-decision task lists its file, and its packet among the records", async () => {
      expect((await hit(`/api/task/${dfx.slugs.awaiting}`)).body.task.state).toBe("awaiting-decision");
      const body = await changes(dfx.slugs.awaiting);
      expect(body.files.map((f: any) => [f.path, f.added, f.deleted])).toEqual([["src/b.ts", 1, 0]]);
      expect(body.records.map((f: any) => f.path)).toEqual([`.reggie/tasks/${dfx.slugs.awaiting}/packet.md`]);
    });

    it("a branch this clone only has as origin/task/<slug> is read from that ref", async () => {
      expect((await hit(`/api/task/${dfx.slugs.remoteOnly}`)).body.task.branchRef).toBe(`origin/task/${dfx.slugs.remoteOnly}`);
      const body = await changes(dfx.slugs.remoteOnly);
      expect(body.range).toMatchObject({ kind: "branch", refName: `origin/task/${dfx.slugs.remoteOnly}`, commits: 1 });
      expect(body.files.map((f: any) => f.path)).toEqual(["src/from-origin.ts"]);
      expect((await filediff(dfx.slugs.remoteOnly, "src/from-origin.ts")).rows).toEqual([{ kind: "add", new: 1, text: "export const fromOrigin = 1;" }]);
    });

    it("zero commits past the base", async () => {
      const body = await changes(dfx.slugs.zeroAhead);
      expect([body.available, body.files, body.records, body.range.commits]).toEqual([true, [], [], 0]);
    });

    it("only Reggie's own records", async () => {
      const body = await changes(dfx.slugs.recordsOnly);
      expect(body.files).toEqual([]);
      expect(body.records.map((f: any) => f.path)).toEqual([`.reggie/tasks/${dfx.slugs.recordsOnly}/claim.md`, `.reggie/tasks/${dfx.slugs.recordsOnly}/evidence/tests.txt`]);
      expect(body.totals).toEqual({ files: 0, added: 0, deleted: 0 });
      const claim = await filediff(dfx.slugs.recordsOnly, `.reggie/tasks/${dfx.slugs.recordsOnly}/claim.md`);
      expect(claim.rows).toEqual([{ kind: "add", new: 1, text: "claim" }]);
    });

    it("merged the base back in: the base's own file is in neither list", async () => {
      const body = await changes(dfx.slugs.mergedBack);
      expect(body.files.map((f: any) => f.path)).toEqual(["src/a.ts"]);
      expect([...body.files, ...body.records].some((f: any) => f.path === "src/b.ts")).toBe(false);
      await refused(`/api/filediff?slug=${dfx.slugs.mergedBack}&path=src/b.ts`, 404);
    });

    it("changed a line and changed it back: nothing listed, two commits", async () => {
      const body = await changes(dfx.slugs.netZero);
      expect([body.available, body.files, body.records, body.range.commits]).toEqual([true, [], [], 2]);
    });
  });

  describe("large changes", () => {
    it("pages a 60,000-line file 2,000 rows at a time", async () => {
      const first = await filediff(dfx.slugs.large, "src/big.ts");
      expect([first.rows.length, first.totalRows, first.truncated, first.offset]).toEqual([2000, dfx.large.lines, true, 0]);
      expect([first.rows[0].new, first.rows[1999].new]).toEqual([1, 2000]);
      const last = await filediff(dfx.slugs.large, "src/big.ts", "&offset=58000");
      expect([last.rows.length, last.truncated, last.offset]).toEqual([2000, false, 58000]);
      expect([last.rows[0].new, last.rows[1999].new]).toEqual([58001, 60000]);
      expect(last.rows[1999].text).toBe("const v60000 = 60000;");
      const past = await filediff(dfx.slugs.large, "src/big.ts", "&offset=60000");
      expect([past.rows, past.truncated, past.totalRows]).toEqual([[], false, dfx.large.lines]);
      for (const bad of ["abc", "-1", "1.5", "1e3"]) await refused(`/api/filediff?slug=${dfx.slugs.large}&path=src/big.ts&offset=${bad}`, 400);
    });

    it("cuts a 5 MB single line to 2,000 characters in a small response", async () => {
      const r = await hit(`/api/filediff?slug=${dfx.slugs.large}&path=src/oneline.txt`);
      expect(r.status).toBe(200);
      expect(Buffer.byteLength(r.text)).toBeLessThan(100 * 1024);
      expect(r.body.rows).toHaveLength(1);
      expect([r.body.rows[0].text.length, r.body.rows[0].cut, r.body.rows[0].noeol]).toEqual([2000, true, true]);
    });
  });

  describe("landed tasks", () => {
    it("reads a done task whose branch is gone through the merge that landed it", async () => {
      expect(git(["branch", "--list", `task/${dfx.slugs.landed}`], { cwd: dfx.repo.root }).stdout.trim()).toBe("");
      const body = await changes(dfx.slugs.landed);
      expect(body.range.kind).toBe("merge");
      const [merge, firstParent, secondParent] = git(["rev-list", "--parents", "-n", "1", body.range.ref], { cwd: dfx.repo.root }).stdout.trim().split(" ");
      expect(secondParent).toMatch(/^[0-9a-f]{40}$/);
      expect([body.range.ref, body.range.base]).toEqual([merge, firstParent]);
      expect(body.range.refName).toContain(`task/${dfx.slugs.landed}`);
      const packet = `.reggie/tasks/${dfx.slugs.landed}/packet.md`;
      expect(body.records.map((f: any) => f.path)).toContain(packet);
      const rows = (await filediff(dfx.slugs.landed, packet)).rows;
      expect(rows.some((r: any) => r.kind === "add" && r.text === "verdict: approved")).toBe(true);
      expect(rows.some((r: any) => r.text === "verdict: pending")).toBe(false);
    });

    it("keeps the landing's rows and numbers after the base moved on, and says which files moved", async () => {
      // main now reads zero / one / two LANDED / three / later on main; the landing read one / two LANDED / three.
      expect(readFileSync(path.join(dfx.repo.root, "src/a.ts"), "utf8").split("\n")[0]).toBe("zero");
      const a = await filediff(dfx.slugs.landed, "src/a.ts");
      expect(a.rows).toEqual([
        { kind: "ctx", old: 1, new: 1, text: "one" },
        { kind: "del", old: 2, text: "two" },
        { kind: "add", new: 2, text: "two LANDED" },
        { kind: "ctx", old: 3, new: 3, text: "three" },
      ]);
      expect(a.changedSince).toBe(true);
      expect((await filediff(dfx.slugs.landed, "src/landed-only.ts")).changedSince).toBe(false);
      expect((await filediff(dfx.slugs.cases, "src/keep.ts")).changedSince).toBeNull();
    });

    it("counts what the Completed view counts", async () => {
      const body = await changes(dfx.slugs.landed);
      const done = (await hit(`/api/task/${dfx.slugs.landed}`)).body.completion;
      expect(done.merge.sha).toBe(body.range.ref);
      expect(body.totals).toEqual({ files: done.diff.filesChanged, added: done.diff.added, deleted: done.diff.deleted });
      expect(body.totals.files).toBe(2);
    });
  });

  describe("no change to read", () => {
    it("a done task landed by fast-forward: 200 and a reason; its file route 404s with the same reason", async () => {
      const body = await changes(dfx.slugs.ffLanded);
      expect([body.available, body.range, body.files, body.records]).toEqual([false, null, [], []]);
      expect(body.reason).toMatch(/no merge commit on main landed it/);
      refusals.push(JSON.stringify(body));
      const denied = await refused(`/api/filediff?slug=${dfx.slugs.ffLanded}&path=src/ff.ts`, 404);
      expect(denied.error).toBe(body.reason);
    });

    it("no task branch and no landing: 200 and a reason; unknown slug 404; unsafe slug 400", async () => {
      const body = await changes(dfx.slugs.noBranch);
      expect(body.available).toBe(false);
      expect(body.reason).toMatch(/There is no task branch yet/);
      refusals.push(JSON.stringify(body));
      for (const route of ["/api/changes?slug=never-heard-of-it", "/api/filediff?slug=never-heard-of-it&path=src/a.ts"]) expect((await refused(route, 404)).error).toBe("unknown task: never-heard-of-it");
      for (const slug of ["../x", "", "UPPER", "a/b", "-dash"]) {
        await refused(`/api/changes?slug=${encodeURIComponent(slug)}`, 400);
        await refused(`/api/filediff?slug=${encodeURIComponent(slug)}&path=src/a.ts`, 400);
      }
    });

    it("a done task landed by fast-forward whose branch was kept: a reason, never 'no commits yet'", async () => {
      expect((await hit(`/api/task/${dfx.slugs.ffKept}`)).body.task).toMatchObject({ state: "done", branchRef: `task/${dfx.slugs.ffKept}` });
      const body = await changes(dfx.slugs.ffKept);
      expect([body.available, body.range, body.files, body.records]).toEqual([false, null, [], []]);
      expect(body.reason).toMatch(/no merge commit on main landed it/);
      expect(body.reason).toMatch(/fast-forwarded/);
      refusals.push(JSON.stringify(body));
      expect((await refused(`/api/filediff?slug=${dfx.slugs.ffKept}&path=src/ff-kept.ts`, 404)).error).toBe(body.reason);
    });

    it("a branch with no shared history: 200, unavailable, and a reason, never a 500 or an empty list", async () => {
      const body = await changes(dfx.slugs.orphan);
      expect(body.available).toBe(false);
      expect(body.reason).toMatch(/shares no history with main/);
      refusals.push(JSON.stringify(body));
      await refused(`/api/filediff?slug=${dfx.slugs.orphan}&path=orphan.txt`, 404);
    });
  });

  describe("path validation", () => {
    it("400s a path that cannot be a repo path, 404s one that is not in the change list, and writes nothing", async () => {
      const fresh = path.join(os.tmpdir(), `reggie-filediff-output-${process.pid}-${Date.now()}`);
      const slug = dfx.slugs.cases;
      for (const bad of ["", "   ", "src/a\0.ts", "/etc/passwd", "../outside.ts", "src/../../outside.ts", "src\\keep.ts"]) {
        await refused(`/api/filediff?slug=${slug}&path=${encodeURIComponent(bad)}`, 400);
      }
      await refused(`/api/filediff?slug=${slug}`, 400);
      for (const unlisted of [`--output=${fresh}`, ":(exclude)src", ":(top)src/keep.ts", "src/*.bin", "src/untouched.ts", "src", "src/keep.ts/", "SRC/KEEP.TS"]) {
        const body = await refused(`/api/filediff?slug=${slug}&path=${encodeURIComponent(unlisted)}`, 404);
        expect(body.error).toBe(`that path is not part of what ${slug} changed`);
      }
      expect(existsSync(fresh)).toBe(false);
      // A forgiven `./` still lands on the list member, and on that member's rows.
      expect((await filediff(slug, "./src/keep.ts")).path).toBe("src/keep.ts");
    });

    it("opens a committed name that begins or ends with a space, which a tidied path no longer matches", async () => {
      const listed = (await changes(dfx.slugs.spaced)).files.map((f: any) => f.path);
      expect(listed).toEqual(SPACED_NAMES);
      for (const name of SPACED_NAMES) {
        const d = await filediff(dfx.slugs.spaced, name);
        expect(d.path, JSON.stringify(name)).toBe(name);
        expect(d.rows).toEqual([{ kind: "add", new: 1, text: oddLine(name) }]);
      }
      // The tidied spelling names no member of the list, so it is not quietly answered with the other file.
      await refused(`/api/filediff?slug=${dfx.slugs.spaced}&path=lead.ts`, 404);
      await refused(`/api/filediff?slug=${dfx.slugs.spaced}&path=${encodeURIComponent("src/trail.ts")}`, 404);
    });

    it("never answers a refusal with git's stderr or an absolute path", () => {
      // Every refusal above went through `refused`; the test before this one alone makes sixteen,
      // so the check still means something when this describe is run on its own.
      expect(refusals.length).toBeGreaterThanOrEqual(16);
      for (const text of refusals) {
        expect(text).not.toContain("fatal:");
        expect(text).not.toMatch(/\berror: /);
        expect(text).not.toContain("usage: git");
        expect(text).not.toContain(dfx.repo.root);
        expect(text).not.toContain(realpathSync(dfx.repo.root));
        expect(text).not.toContain(os.tmpdir());
      }
    });
  });

  describe("editor link", () => {
    it("opens the worktree's copy for a live task, this checkout's for a landed one, and nothing otherwise", async () => {
      const live = await filediff(WORKTREE_SLUG, "src/in-worktree.ts");
      expect(live.editorUrl).toBe(`vscode://file${encodeURI(path.join(dfx.repo.root, ".worktree", WORKTREE_SLUG, "src/in-worktree.ts"))}`);
      const landed = await filediff(dfx.slugs.landed, "src/a.ts");
      expect(landed.editorUrl).toBe(`vscode://file${encodeURI(path.join(dfx.repo.root, "src/a.ts"))}`);
      // A live branch with no worktree, not checked out here: the file on disk is the unchanged one.
      expect((await filediff(dfx.slugs.cases, "src/keep.ts")).editorUrl).toBeNull();
      expect((await filediff(dfx.slugs.cases, "src/deleted.ts")).editorUrl).toBeNull();
    });

    it("opens this checkout's copy when this checkout is the one that has the task branch checked out", async () => {
      // An in-place claim: no worktree, the serving checkout itself is on task/<slug>.
      const repo = makeTempRepo("reggie-inplace-");
      const paths = repoPaths(repo.root);
      ensureLayout(paths);
      repo.write("src/here.ts", "export const here = 0;\n");
      repo.commitAll("base");
      git(["checkout", "-q", "-b", "task/in-place"], { cwd: repo.root });
      repo.write("src/here.ts", "export const here = 1;\n");
      repo.write("src/gone.ts", "");
      repo.commitAll("feat: work in place");
      git(["rm", "-q", "src/gone.ts"], { cwd: repo.root });
      repo.commitAll("feat: and a file that is not here any more");
      const inPlace = await startServer(paths, loadConfig(paths), { port: 0, host: "127.0.0.1", workspace: null });
      try {
        const res = await fetch(`http://127.0.0.1:${inPlace.port}/api/filediff?slug=in-place&path=src/here.ts`);
        expect(res.status).toBe(200);
        const body = (await res.json()) as any;
        expect(body.range.refName).toBe("task/in-place");
        expect(body.editorUrl).toBe(`vscode://file${encodeURI(path.join(repo.root, "src/here.ts"))}`);
      } finally {
        await inPlace.close();
        clearHistoryCache(repo.root);
        repo.cleanup();
      }
    });
  });

  describe("paging builds a file's rows once", () => {
    it("answers later pages of the 60,000-line file from the rows the first page built", async () => {
      const first = await filediff(dfx.slugs.large, "src/big.ts");
      // Take the file's blob out from under git: refs still resolve, but its patch can no longer be
      // produced, so a later page can only come from rows that were already built.
      const blob = git(["rev-parse", `refs/heads/task/${dfx.slugs.large}:src/big.ts`], { cwd: dfx.repo.root }).stdout.trim();
      const object = path.join(dfx.repo.root, ".git", "objects", blob.slice(0, 2), blob.slice(2));
      expect(existsSync(object)).toBe(true);
      renameSync(object, `${object}.aside`);
      try {
        expect(git(["cat-file", "-e", blob], { cwd: dfx.repo.root, allowFailure: true }).ok).toBe(false);
        const later = await filediff(dfx.slugs.large, "src/big.ts", "&offset=30000");
        expect(later.card).toBeNull();
        expect([later.offset, later.rows.length, later.totalRows]).toEqual([30000, 2000, first.totalRows]);
        expect(later.rows[0]).toEqual({ kind: "add", new: 30001, text: "const v30001 = 30001;" });
      } finally {
        renameSync(`${object}.aside`, object);
      }
    });
  });

  describe("a hostile integration branch name", () => {
    it("is never handed to git by either route, and nothing is written", async () => {
      // What a clone of a hostile repo holds: a tracked config naming an option as the default branch,
      // and a ref of exactly that name, so the name resolves. `git log <name> --` would write the file.
      const hostile = makeDiffFixture({ large: false });
      const target = path.join(os.tmpdir(), `reggie-hostile-http-${process.pid}-${Date.now()}`);
      const name = `--output=${target}`;
      git(["update-ref", `refs/heads/${name}`, "refs/heads/main"], { cwd: hostile.repo.root });
      writeFileSync(hostile.paths.config, `defaultBranch: ${JSON.stringify(name)}\n`, "utf8");
      const config = loadConfig(hostile.paths);
      expect(config.defaultBranch).toBe(name);
      const evil = await startServer(hostile.paths, config, { port: 0, host: "127.0.0.1", workspace: null });
      const before = new Set(readdirSync(os.tmpdir()));
      try {
        const answers: { slug: string; list: number; body: any; file: number; error: string }[] = [];
        for (const slug of [hostile.slugs.landed, hostile.slugs.cases, hostile.slugs.ffLanded, "never-heard-of-it"]) {
          const list = await fetch(`http://127.0.0.1:${evil.port}/api/changes?slug=${slug}`);
          const body = (await list.json()) as any;
          const file = await fetch(`http://127.0.0.1:${evil.port}/api/filediff?slug=${slug}&path=src/a.ts`);
          answers.push({ slug, list: list.status, body, file: file.status, error: ((await file.json()) as any).error });
        }
        // First, the thing that matters: eight requests later, git has written nothing.
        expect(existsSync(target), "git wrote the file the integration branch's name asked for").toBe(false);
        // Nothing appeared beside it either: the older helpers append `..task/<slug>` to the name.
        const appeared = readdirSync(os.tmpdir()).filter((f) => !before.has(f) && f.startsWith(path.basename(target)));
        expect(appeared).toEqual([]);
        for (const a of answers) {
          expect([a.list, a.body.available, a.body.files, a.body.records], a.slug).toEqual([200, false, [], []]);
          expect(a.body.reason).toMatch(/begins with a dash/);
          expect(a.body.reason).not.toContain(target);
          expect([a.file, a.error], a.slug).toEqual([404, a.body.reason]);
        }
      } finally {
        await evil.close();
        rmSync(target, { force: true });
        clearHistoryCache(hostile.repo.root);
        hostile.repo.cleanup();
      }
    }, 60_000);
  });
});

describe("a derived journal entry over HTTP", () => {
  it("comes back from both journal routes with its derived object, and with the mark kept out of the text", async () => {
    const repo = makeTempRepo("reggie-serve-derived-");
    const paths = repoPaths(repo.root);
    ensureLayout(paths);
    const slug = "derived-task";
    mkdirSync(path.join(paths.tasks, slug), { recursive: true });
    writeFileSync(path.join(paths.tasks, slug, "plan.md"), fullPlan(slug), "utf8");
    repo.commitAll("plan");
    const mark = { session: "00000000-0000-4000-8000-000000000001", through: new Date().toISOString(), commits: ["0123456789ab"], prose: "template" as const };
    appendJournal(paths, { person: "test", tool: "claude", slug, stage: "execute", text: "Reggie wrote this entry from invented facts.", evidence: [`.reggie/tasks/${slug}/plan.md`], session: mark.session, derived: mark });
    appendJournal(paths, { person: "test", tool: "human", slug, stage: "execute", text: "A hand entry beside it.", session: "s1" });
    const derivedServer = await startServer(paths, loadConfig(paths), { port: 0, host: "127.0.0.1", workspace: null });
    try {
      const fromJournal = (await (await fetch(`http://127.0.0.1:${derivedServer.port}/api/journal?slug=${slug}`)).json()) as any[];
      const fromTask = ((await (await fetch(`http://127.0.0.1:${derivedServer.port}/api/task/${slug}`)).json()) as any).journal as any[];
      for (const entries of [fromJournal, fromTask]) {
        expect(entries).toHaveLength(2);
        const derived = entries.find((e) => e.derived);
        expect(derived.derived).toEqual(mark);
        expect(derived.text).toBe("Reggie wrote this entry from invented facts.");
        expect(derived.text).not.toContain("derived:");
        expect(derived.evidence).toEqual([`.reggie/tasks/${slug}/plan.md`]);
        expect(entries.find((e) => !e.derived).text).toBe("A hand entry beside it.");
      }
    } finally {
      await derivedServer.close();
      clearHistoryCache(repo.root);
      repo.cleanup();
    }
  }, 60_000);
});

describe("the idea action: origins on capture and paths on launch", () => {
  let ifx: FixtureRepo;
  let ideaServer: ServerHandle;
  let ideaBase: string;
  const gone = "src/gone.ts";

  beforeAll(async () => {
    ifx = makeFixtureRepo();
    const root = ifx.repo.root;
    // The shapes an origin can take, added to a fixture of this block's own so nothing the other
    // blocks pin (file counts, section lists) moves.
    ifx.repo.write("src/a b.ts", "export const ab = 1;\n");
    ifx.repo.write("src/café ü/uni.ts", "export const uni = 1;\n");
    ifx.repo.write(gone, "export const gone = 1;\n");
    ifx.repo.write("docs/README.md", "# docs\n");
    symlinkSync("../src/types/shape.ts", path.join(root, "docs", "inside"));
    symlinkSync("/etc/hosts", path.join(root, "docs", "outside"));
    ifx.repo.commitAll("origins");
    rmSync(path.join(root, gone));
    mkdirSync(path.join(root, ".reggie", ".cache"), { recursive: true });
    writeFileSync(path.join(root, ".reggie", ".cache", "x"), "cached\n", "utf8");
    ideaServer = await startServer(ifx.paths, ifx.config, { port: 0, host: "127.0.0.1", workspace: null });
    ideaBase = `http://127.0.0.1:${ideaServer.port}`;
  }, 120_000);

  afterAll(async () => {
    await ideaServer?.close();
    ifx?.repo.cleanup();
  });

  async function ipost(route: string, body: unknown, headers: Record<string, string> = {}): Promise<{ status: number; body: any }> {
    const res = await fetch(ideaBase + route, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: typeof body === "string" ? body : JSON.stringify(body) });
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null };
  }
  async function iget(route: string): Promise<{ status: number; body: any }> {
    const res = await fetch(ideaBase + route);
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null };
  }
  const intake = () => readFileSync(ifx.paths.intake, "utf8");
  const packOf = (slug: string) => path.join(ifx.repo.root, ".reggie", ".cache", "context", `${slug}.md`);
  const launchesDir = () => path.join(ifx.repo.root, ".reggie", ".cache", "launches");

  /** The platform stubbed away from darwin, so no test here can open a Terminal window. */
  async function offMac<T>(fn: () => Promise<T>): Promise<T> {
    const real = process.platform;
    Object.defineProperty(process, "platform", { value: "linux", configurable: true });
    try {
      return await fn();
    } finally {
      Object.defineProperty(process, "platform", { value: real, configurable: true });
    }
  }

  it("refuses a launch path that is not an entity of the repo before any pack, session or record exists", async () => {
    const before = intake();
    const cases: [Record<string, unknown>, RegExp][] = [
      [{ paths: [gone] }, /listed by git but is not on disk/],
      [{ paths: ["../etc"] }, /step outside/],
      [{ paths: ["/etc/hosts"] }, /never absolute/],
      [{ paths: [".git/HEAD"] }, /not a file or folder in this repo/],
      [{ paths: ["src/*.ts"] }, /not a file or folder in this repo/],
      [{ paths: ["docs/outside"] }, /points outside the repo/],
      [{ path: "." }, /repo itself is not an origin/],
      [{ paths: Array.from({ length: 9 }, (_, i) => `src/big/a${String(i + 1).padStart(2, "0")}.ts`) }, /at most 8 paths/],
    ];
    for (const [extra, why] of cases) {
      const { status, body } = await ipost("/api/launch", { slugs: [ifx.slugs.ungroomed], tool: "claude", mode: "discuss", ...extra });
      expect(status, JSON.stringify(extra)).toBe(400);
      expect(body.error, JSON.stringify(extra)).toMatch(why);
      expect(body.error, JSON.stringify(extra)).not.toContain(ifx.repo.root);
    }
    expect(existsSync(packOf(ifx.slugs.ungroomed))).toBe(false);
    expect(existsSync(launchesDir())).toBe(false);
    expect(intake()).toBe(before);
    // GET answers the same sentence for the same path.
    const described = await iget(`/api/launch?slug=${ifx.slugs.ungroomed}&tool=claude&mode=discuss&path=${encodeURIComponent(gone)}`);
    expect(described.status).toBe(400);
    expect(described.body.error).toMatch(/listed by git but is not on disk/);
  });

  it("refuses a path field of the wrong shape or a blank path, and counts the cap after resolution", async () => {
    const base = { slugs: [ifx.slugs.ungroomed], tool: "claude", mode: "discuss" };
    const shapes: [Record<string, unknown>, RegExp][] = [
      [{ paths: "src/big" }, /paths must be a list of strings/],
      [{ paths: ["src/big", 5] }, /paths must be a list of strings/],
      [{ path: 5 }, /path must be a string/],
      [{ path: " " }, /repo itself is not an origin/],
      [{ paths: ["src/big", ""] }, /repo itself is not an origin/],
    ];
    for (const [extra, why] of shapes) {
      const { status, body } = await ipost("/api/launch", { ...base, ...extra });
      expect(status, JSON.stringify(extra)).toBe(400);
      expect(body.error, JSON.stringify(extra)).toMatch(why);
    }
    expect(existsSync(launchesDir())).toBe(false);
    // Nine spellings of two paths are two paths, not nine.
    const nine = ["src/big", "src/big/", "./src/big", "./src/big/", "src/types/shape.ts", "./src/types/shape.ts", "src/types/shape.ts/", " src/big ", "src/types/shape.ts"];
    const described = await iget(`/api/launch?slug=${ifx.slugs.ungroomed}&tool=claude&mode=discuss${nine.map((p) => `&path=${encodeURIComponent(p)}`).join("")}`);
    expect(described.status, JSON.stringify(described.body)).toBe(200);
    expect(described.body.command).toContain("The pack was also built around `src/big` and `src/types/shape.ts`:");
  });

  it("describes a launch whose pack is built around a folder, and runs it: the pack holds the chain, the scope, the commits and the related tasks", async () => {
    const described = await iget(`/api/launch?slug=${ifx.slugs.ungroomed}&tool=claude&mode=discuss&path=${encodeURIComponent("./src/big/")}`);
    expect(described.status, JSON.stringify(described.body)).toBe(200);
    expect(described.body.command).toContain("The pack was also built around `src/big`: its notes, its recent commits and the tasks that touch it are in there, so start reading at that place.");
    const run = await offMac(() => ipost("/api/launch", { slugs: [ifx.slugs.ungroomed], tool: "claude", mode: "discuss", paths: ["src/big"] }));
    expect(run.status, JSON.stringify(run.body)).toBe(200);
    expect(run.body.goal).toBe("shape");
    expect(run.body.launched).toBe(false);
    expect(run.body.command).toContain("The pack was also built around `src/big`");
    // The same command GET described, plus the session id the POST minted.
    expect(run.body.command).toBe(described.body.command.replace("claude --permission-mode plan ", `claude --permission-mode plan --session-id ${run.body.session} `));
    const pack = readFileSync(packOf(ifx.slugs.ungroomed), "utf8");
    expect(pack).toContain("A fixture repo that exists so the tests have a small codebase");
    expect(pack).toContain("The chain must stay in order; a01 is the entry and a45 the leaf.");
    expect(pack).toContain("## Files in scope\n- src/big\n");
    expect(pack).toContain("## Recent commits touching these files");
    expect(pack).toContain("## Related tasks touching the same files");
    expect(pack).toContain(`- ${ifx.slugs.inProcess}`);
    // The singular alias does the same.
    const single = await offMac(() => ipost("/api/launch", { slug: ifx.slugs.ungroomed, tool: "codex", mode: "discuss", path: "src/big/" }));
    expect(single.status).toBe(200);
    expect(single.body.command).toContain("built around `src/big`:");
    expect(single.body.session).toBeNull();
  });

  it("captures with a file, a symbol or a task origin and echoes it; without one it echoes null and writes the old line", async () => {
    const file = await ipost("/api/capture", { text: "The shape type is unread", path: "src/types/shape.ts" });
    expect(file.status, JSON.stringify(file.body)).toBe(200);
    expect(file.body).toEqual({ slug: "the-shape-type-is-unread", line: expect.stringMatching(/^- the-shape-type-is-unread: The shape type is unread \(test, web, \d{4}-\d{2}-\d{2}\)$/), origin: { kind: "file", path: "src/types/shape.ts" } });
    const symbol = await ipost("/api/capture", { text: "emptyShape allocates", path: "./src/types/shape.ts", symbol: "emptyShape" });
    expect(symbol.status).toBe(200);
    expect(symbol.body.origin).toEqual({ kind: "symbol", path: "src/types/shape.ts", symbol: "emptyShape" });
    const folder = await ipost("/api/capture", { text: "The big area is big", path: "src/big/", detail: "forty-five files" });
    expect(folder.body.origin).toEqual({ kind: "folder", path: "src/big" });
    const task = await ipost("/api/capture", { text: "Idea while reading a task", task: ifx.slugs.inProcess });
    expect(task.status).toBe(200);
    expect(task.body.origin).toEqual({ kind: "task", task: ifx.slugs.inProcess });
    const spaced = await ipost("/api/capture", { text: "A spaced path", path: "src/a b.ts" });
    expect(spaced.body.origin).toEqual({ kind: "file", path: "src/a b.ts" });
    const uni = await ipost("/api/capture", { text: "A non-ASCII path", path: "src/café ü/uni.ts" });
    expect(uni.body.origin).toEqual({ kind: "file", path: "src/café ü/uni.ts" });
    const none = await ipost("/api/capture", { text: "Nothing to see", detail: "plain" });
    expect(none.status).toBe(200);
    expect(none.body.origin).toBeNull();
    expect(Object.keys(none.body).sort()).toEqual(["line", "origin", "slug"]);

    const text = intake();
    expect(text).toContain("- the-shape-type-is-unread: The shape type is unread (test, web, ");
    expect(text).toContain("  > Captured from the file `src/types/shape.ts`\n");
    expect(text).toContain("  > Captured from `emptyShape` in the file `src/types/shape.ts`\n");
    expect(text).toContain("  > forty-five files\n  > Captured from the folder `src/big`\n");
    expect(text).toContain(`  > Captured from the task \`${ifx.slugs.inProcess}\`\n`);
    expect(text).toContain("  > Captured from the file `src/a b.ts`\n");
    expect(text).toContain("  > Captured from the file `src/café ü/uni.ts`\n");
    expect(text).toContain("- nothing-to-see: Nothing to see (test, web, ");
    expect(text).toContain("  > plain\n");
    const all = (await iget("/api/tasks?all=1")).body;
    expect(all.find((t: any) => t.slug === "nothing-to-see").intake.detail).toEqual(["plain"]);
    const fromTask = all.find((t: any) => t.slug === "idea-while-reading-a-task");
    expect(fromTask.state).toBe("ungroomed");
    expect(fromTask.intake.detail).toEqual([`Captured from the task \`${ifx.slugs.inProcess}\``]);
    // The task page's story carries the origin line, where "What was written" renders it.
    const story = await iget("/api/story?scope=task&id=idea-while-reading-a-task");
    expect(story.status).toBe(200);
    expect(JSON.stringify(story.body)).toContain(`Captured from the task`);
  });

  it("answers 400 with the resolver's sentence for every refused origin and writes nothing; a big body is still 413", async () => {
    const before = intake();
    const refused: [Record<string, unknown>, RegExp][] = [
      [{ path: "" }, /repo itself is not an origin/],
      [{ path: "." }, /repo itself is not an origin/],
      [{ path: "./" }, /repo itself is not an origin/],
      [{ path: "/etc/hosts" }, /never absolute/],
      [{ path: ifx.repo.root }, /never absolute/],
      [{ path: "src/../etc" }, /step outside/],
      [{ path: "src\\types" }, /backslash/],
      [{ path: "src/types\u0000" }, /control character/],
      [{ path: "src/ty\npes" }, /control character/],
      [{ path: "src/ty\tpes" }, /control character/],
      [{ path: "src/`x`.ts" }, /backtick/],
      [{ path: "src/[x].ts" }, /square bracket/],
      [{ path: "src/x|y.ts" }, /pipe/],
      [{ path: ".git/HEAD" }, /not a file or folder in this repo/],
      [{ path: ".reggie/.cache/x" }, /not a file or folder in this repo/],
      [{ path: "src/*.ts" }, /not a file or folder in this repo/],
      [{ path: ":(exclude)src" }, /not a file or folder in this repo/],
      [{ path: gone }, /listed by git but is not on disk/],
      [{ path: "src/never.ts" }, /not a file or folder in this repo/],
      [{ path: "docs/outside" }, /points outside the repo/],
      [{ symbol: "emptyShape" }, /needs the file that holds it/],
      [{ path: "src/big", symbol: "emptyShape" }, /belongs to a file, not a folder/],
      [{ path: "src/types/shape.ts", symbol: "empty Shape" }, /not a symbol name/],
      [{ path: "src/types/shape.ts", symbol: "a::b" }, /not a symbol name/],
      [{ path: "src/types/shape.ts", symbol: "<script>" }, /not a symbol name/],
      [{ path: "src/types/shape.ts", symbol: "x".repeat(201) }, /not a symbol name/],
      [{ task: ifx.slugs.inProcess, path: "src/big" }, /task or the path, not both/],
      [{ task: "../etc" }, /not a task slug/],
      [{ task: "no-such-task" }, /`no-such-task` is not a task in this repo/],
    ];
    for (const [origin, why] of refused) {
      const { status, body } = await ipost("/api/capture", { text: "Must not land", ...origin });
      expect(status, JSON.stringify(origin)).toBe(400);
      expect(body.error, JSON.stringify(origin)).toMatch(why);
      expect(body.error, JSON.stringify(origin)).not.toContain(ifx.repo.root);
    }
    expect(intake()).toBe(before);
    const big = await ipost("/api/capture", { text: "x".repeat(70_000), path: "src/types/shape.ts" });
    expect(big.status).toBe(413);
    expect(intake()).toBe(before);
  });

  it("refuses a capture carrying a path from a foreign origin or a cross-site page, writing nothing", async () => {
    const before = intake();
    const foreign = await ipost("/api/capture", { text: "Evil idea", path: "src/types/shape.ts" }, { origin: "http://evil.example.com" });
    expect(foreign.status).toBe(403);
    expect(foreign.body.error).toContain("origin");
    const cross = await ipost("/api/capture", { text: "Evil idea", path: "src/types/shape.ts" }, { "sec-fetch-site": "cross-site" });
    expect(cross.status).toBe(403);
    expect(cross.body.error).toContain("cross-site");
    expect(intake()).toBe(before);
  });

  it("launches the slug a capture just minted, in the same second, with the file's own note and commits in the pack", async () => {
    const captured = await ipost("/api/capture", { text: "Launch me at once", path: "src/types/shape.ts" });
    expect(captured.status).toBe(200);
    const slug = captured.body.slug;
    const launched = await offMac(() => ipost("/api/launch", { slugs: [slug], tool: "claude", mode: "discuss", paths: ["src/types/shape.ts"] }));
    expect(launched.status, JSON.stringify(launched.body)).toBe(200);
    expect(launched.body.goal).toBe("shape");
    expect(launched.body.launched).toBe(false);
    expect(launched.body.reason).toContain("macOS");
    expect(launched.body.session).toMatch(/^[0-9a-f-]{36}$/);
    expect(launched.body.resume).toBe(`claude --resume ${launched.body.session}`);
    expect(launched.body.command).toContain(`shape \`${slug}\` into a brief`);
    expect(launched.body.command).toContain("The pack was also built around `src/types/shape.ts`");
    const pack = readFileSync(packOf(slug), "utf8");
    expect(pack).toContain("Shape is the one shared type");
    expect(pack).toContain("## Files in scope\n- src/types/shape.ts\n");
    expect(pack).toContain("## Recent commits touching these files");
    // The capture stands after a launch that opened nothing.
    expect(intake()).toContain(`- ${slug}: Launch me at once (test, web, `);
    expect(intake()).toContain("  > Captured from the file `src/types/shape.ts`\n");
    const record = JSON.parse(readFileSync(path.join(launchesDir(), `${slug}.json`), "utf8"));
    expect(record.goal).toBe("shape");
    expect(record.session).toBe(launched.body.session);
  });

  // No non-internal interface means no non-loopback socket to test over; the unit tests on checkKey
  // cover the layer, and this case is the end-to-end refusal when the machine allows it. Skipped
  // visibly rather than passing in silence.
  it.skipIf(lanAddresses("0.0.0.0").length === 0)("refuses a keyed capture in team mode over a network socket, writing nothing", async () => {
    const lan = lanAddresses("0.0.0.0");
    const repo = makeTempRepo("reggie-team-");
    const paths = repoPaths(repo.root);
    ensureLayout(paths);
    ensureConfig(paths, "team");
    repo.write("src/one.ts", "export const one = 1;\n");
    repo.commitAll("team");
    const team = await startServer(paths, loadConfig(paths), { port: 0, host: "0.0.0.0" });
    try {
      expect(loadConfig(paths).mode).toBe("team");
      const before = readFileSync(paths.intake, "utf8");
      const res = await fetch(`http://${lan[0]}:${team.port}/api/capture?key=${encodeURIComponent(team.key ?? "")}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: "From a phone in a team", path: "src/one.ts" }),
      });
      expect(res.status).toBe(403);
      expect(((await res.json()) as { error: string }).error).toContain("team mode");
      expect(readFileSync(paths.intake, "utf8")).toBe(before);
    } finally {
      await team.close();
      repo.cleanup();
    }
  });
});

describe("the policy report and the evidence gate over HTTP", () => {
  const made: PolicyFixture[] = [];
  const servers: ServerHandle[] = [];
  afterAll(async () => {
    for (const srv of servers) await srv.close();
    for (const f of made) f.cleanup();
  });

  async function serve(f: PolicyFixture): Promise<{ get: (route: string) => Promise<{ status: number; body: any }>; post: (route: string, body: unknown) => Promise<{ status: number; body: any }> }> {
    made.push(f);
    const srv = await startServer(f.paths, f.config, { port: 0, host: "127.0.0.1", workspace: null });
    servers.push(srv);
    const at = `http://127.0.0.1:${srv.port}`;
    const read = async (res: Response) => ({ status: res.status, body: JSON.parse((await res.text()) || "null") });
    return {
      get: async (route) => read(await fetch(at + route)),
      post: async (route, body) => read(await fetch(at + route, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })),
    };
  }

  it("returns as policy the object reggie check --json prints, null for a task with no packet on a branch, and never evaluates while the list is built", async () => {
    const f = makePolicyFixture();
    const http = await serve(f);
    const detail = await http.get(`/api/task/${f.slug}`);
    expect(detail.status).toBe(200);
    expect(detail.body.policy).toEqual(JSON.parse(JSON.stringify(evaluateCompletion(f.root, f.slug))));
    expect(detail.body.policy.verdict).toBe("would-pass");
    expect(detail.body.policy.gates.map((g: any) => g.id)).toEqual(["policy", "plan", "controls", "packet", "criteria", "evidence", "risk", "merge"]);

    const before = evaluationStats.calls;
    for (const route of ["/api/tasks", "/api/tasks?all=1", "/api/status"]) expect((await http.get(route)).status).toBe(200);
    expect(evaluationStats.calls).toBe(before);

    const planned = makePolicyFixture({ stage: "planned", slug: "only-planned" });
    const built = makePolicyFixture({ stage: "built", slug: "no-packet-yet" });
    expect((await (await serve(planned)).get("/api/task/only-planned")).body.policy).toBeNull();
    expect((await (await serve(built)).get("/api/task/no-packet-yet")).body.policy).toBeNull();
  });

  it("answers 409 with each path and its reason for a packet that cites a file nobody committed, changes nothing, and lands it once the file is there", async () => {
    const f = makePolicyFixture();
    const http = await serve(f);
    f.wt(packetRelPath(f.slug), (readFileSync(path.join(f.worktree, packetRelPath(f.slug)), "utf8")).replace("## Evidence\n", "## Evidence\n- evidence/never-saved.png — the screenshot\n"));
    f.commitWt("packet: cite a screenshot nobody saved");
    const before = policySnapshot(f);

    const refused = await http.post("/api/decide", { slug: f.slug, verdict: "approved" });
    expect(refused.status).toBe(409);
    expect(refused.body.error).toMatch(/its packet cites evidence that does not resolve on task\/two-not-one \([0-9a-f]{12}\): evidence\/never-saved\.png is not on the commit/);
    expect(refused.body.error).not.toContain(f.root);
    expect(policySnapshot(f)).toEqual(before);
    expect((await http.get(`/api/task/${f.slug}`)).body.task.state).toBe("awaiting-decision");

    f.wt(`${evidenceRelDir(f.slug)}never-saved.png`, "not really a png, but a file with bytes in it\n");
    f.commitWt("evidence: the screenshot");
    const landed = await http.post("/api/decide", { slug: f.slug, verdict: "approved" });
    expect(landed.status, JSON.stringify(landed.body)).toBe(200);
    expect(landed.body.merge).toMatch(/^[0-9a-f]{40}$/);
    expect(landed.body.captured).toEqual([]);
    expect(git(["show", `HEAD:${packetRelPath(f.slug)}`], { cwd: f.root }).stdout).toMatch(new RegExp(`^decided_by: ${f.person.handle}$`, "m"));
  });

  it("carries the slugs an approval captured in its response, and captures nothing on needs-work", async () => {
    const discovered = "- The toast hides why a landing was refused, which nobody has captured yet\n- none of the rest matters";
    const sentBack = makePolicyFixture({ discovered, slug: "sent-back" });
    const http = await serve(sentBack);
    const intake = readFileSync(sentBack.paths.intake, "utf8");
    const needsWork = await http.post("/api/decide", { slug: "sent-back", verdict: "needs-work", comment: "not yet" });
    expect(needsWork.status).toBe(200);
    expect(needsWork.body.captured).toBeUndefined();
    expect(readFileSync(sentBack.paths.intake, "utf8")).toBe(intake);

    const approved = makePolicyFixture({ discovered, slug: "approved-one" });
    const res = await (await serve(approved)).post("/api/decide", { slug: "approved-one", verdict: "approved" });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.captured).toEqual(["the-toast-hides-why-a-landing-was-refused-which"]);
    const item = parseIntake(git(["show", `${res.body.merge}:.reggie/intake.md`], { cwd: approved.root }).stdout).find((i) => i.slug === res.body.captured[0]);
    expect(item?.meta).toMatch(/, packet, /);
    expect(item?.detail).toEqual(["Captured from the task `approved-one`"]);
  });
});
