import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { makeFixtureRepo, type FixtureRepo } from "../test/fixtures.js";
import { makeTempRepo, type TempRepo } from "../test/helpers.js";
import { buildGraph, type GraphEdge, type RepoGraph } from "./graph.js";
import { repoHistory } from "./history.js";
import { repoPaths } from "./paths.js";
import { AREA_HUE_COUNT, MAX_VIEW_NODES, chooseAreas, containerView, dirView, impactView, level1, type ViewGraph } from "./views.js";

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

const cleanups: TempRepo[] = [];

/** A throwaway repo from a file map, built into a graph. */
function synth(files: Record<string, string>): RepoGraph {
  const repo = makeTempRepo("reggie-views-");
  cleanups.push(repo);
  for (const [file, content] of Object.entries(files)) repo.write(file, content);
  repo.commitAll("synthetic");
  return buildGraph(repoPaths(repo.root));
}

function ids(view: ViewGraph): string[] {
  return view.nodes.map((n) => n.id);
}
function edgeOf(view: ViewGraph, source: string, target: string): GraphEdge | undefined {
  return view.edges.find((e) => e.source === source && e.target === target);
}

const NODE_KEYS = ["id", "kind", "label", "path", "parent", "lang", "lines", "role", "area", "knowledge", "tasks", "inDegree", "outDegree", "testedBy", "entry", "entryKinds", "dir", "noteCount", "dirNoteCount"];
const EDGE_KEYS = new Set(["source", "target", "kind", "weight", "names", "confidence", "via", "cycle", "isType", "top", "mostly"]);

/** Every view must satisfy the ViewGraph contract (ui-api-contract.md). */
function expectViewGraph(view: ViewGraph, level: ViewGraph["level"]): void {
  expect(view.level).toBe(level);
  expect(typeof view.root).toBe("string");
  expect(Array.isArray(view.nodes)).toBe(true);
  expect(Array.isArray(view.edges)).toBe(true);
  expect(Array.isArray(view.cycles)).toBe(true);
  expect(typeof view.generatedAt).toBe("string");
  expect(Object.keys(view.counts)).toEqual(expect.arrayContaining(["totalCodeFiles", "shown", "folded", "hiddenTests"]));
  for (const key of ["totalCodeFiles", "shown", "folded", "hiddenTests"] as const) expect(typeof view.counts[key]).toBe("number");
  for (const a of view.areas) {
    expect(Object.keys(a).sort()).toEqual(["files", "hue", "id", "label", "source"]);
    expect(a.hue).toBeGreaterThanOrEqual(0);
    expect(a.hue).toBeLessThanOrEqual(AREA_HUE_COUNT);
  }
  const seen = new Set<string>();
  for (const n of view.nodes) {
    expect(seen.has(n.id)).toBe(false);
    seen.add(n.id);
    for (const key of NODE_KEYS) expect(n, `${n.id} is missing ${key}`).toHaveProperty(key);
    expect(n.knowledge).toHaveProperty("byType");
  }
  // Ghosts and folds are context, not drawables; at the dir level the root compound is not drawn.
  const drawable = view.nodes.filter((n) => !n.ghost && n.kind !== "fold" && !(level === "dir" && n.id === view.root));
  expect(drawable.length).toBeLessThanOrEqual(MAX_VIEW_NODES);
  expect(view.counts.shown).toBe(drawable.length);
  for (const e of view.edges) {
    expect(seen.has(e.source)).toBe(true);
    expect(seen.has(e.target)).toBe(true);
    for (const key of Object.keys(e)) expect(EDGE_KEYS.has(key), `unexpected edge key ${key}`).toBe(true);
    if (e.weight !== undefined) expect(e.weight).toBeGreaterThan(1);
    for (const v of e.via ?? []) expect(Object.keys(v).sort()).toEqual(["names", "source", "target"]);
    // `top` is a slice of the same aggregate, so it can never claim more traffic than the whole.
    const view_ = e as { top?: { path: string; files: number }; mostly?: { path: string; files: number } };
    if (view_.top) {
      expect(Object.keys(view_.top).sort()).toEqual(["files", "path"]);
      expect(view_.top.files).toBeGreaterThanOrEqual(1);
      expect(view_.top.files).toBeLessThanOrEqual(e.weight ?? 1);
    }
    // `mostly` is the same answer under the name the tooltip reads; the two must never diverge.
    expect(view_.mostly).toEqual(view_.top);
  }
  for (const c of view.cycles) expect(c.length).toBeGreaterThanOrEqual(2);
}

// ---------------------------------------------------------------------------
// Shared graphs
// ---------------------------------------------------------------------------

let fixture: FixtureRepo;
let fx: RepoGraph;

/** src/ has 48 source files over two big subdirectories plus three small ones: it must split. */
function splitFiles(): Record<string, string> {
  const files: Record<string, string> = {
    "src/index.ts": 'export const version = "1";\n',
    "src/gamma/h1.ts": "export const h1 = 1;\n",
    "src/gamma/h2.ts": "export const h2 = 2;\n",
  };
  for (let i = 1; i <= 25; i += 1) files[`src/alpha/f${String(i).padStart(2, "0")}.ts`] = `export const f${i} = ${i};\n`;
  for (let i = 1; i <= 20; i += 1) files[`src/beta/g${String(i).padStart(2, "0")}.ts`] = `export const g${i} = ${i};\n`;
  return files;
}

/** Two areas that import each other, so ghosts appear on both sides and a cycle exists. */
const MUTUAL: Record<string, string> = {
  "a/a1.ts": 'import { b1 } from "../b/b1.js";\n\nexport const a1 = b1;\n',
  "a/a2.ts": "export const a2 = 2;\n",
  "a/a3.ts": "export const a3 = 3;\n",
  "b/b1.ts": 'import { a3 } from "../a/a3.js";\n\nexport const b1 = a3;\n',
  "b/b2.ts": "export const b2 = 2;\n",
  "b/b3.ts": "export const b3 = 3;\n",
};

/**
 * Two areas where a test file imports across the boundary too: the aggregated import weight has to
 * count it (3, not 2) while no `tests` edge is drawn (acceptance 2, 3 and 7).
 */
const TESTED_ACROSS: Record<string, string> = {
  "a/sub/s1.ts": 'import { b1 } from "../../b/b1.js";\n\nexport const s1 = b1;\n',
  "a/sub/s2.ts": 'import { b1 } from "../../b/b1.js";\n\nexport const s2 = b1 + 1;\n',
  "a/sub/s3.ts": "export const s3 = 3;\n",
  "a/sub/s1.test.ts": 'import { b1 } from "../../b/b1.js";\n\nexport const t1 = b1;\n',
  "a/x1.ts": "export const x1 = 1;\n",
  "a/x2.ts": "export const x2 = 2;\n",
  "a/x3.ts": "export const x3 = 3;\n",
  "b/b1.ts": "export const b1 = 1;\n",
  "b/b2.ts": "export const b2 = 2;\n",
  "b/b3.ts": "export const b3 = 3;\n",
};

/** One file every one of 50 others imports: the impact view must fold the overflow. */
function hubFiles(): Record<string, string> {
  const files: Record<string, string> = { "hub/hub.ts": "export const hub = 1;\n" };
  for (let i = 1; i <= 50; i += 1) files[`users/u${String(i).padStart(2, "0")}.ts`] = `import { hub } from "../hub/hub.js";\n\nexport const u${i} = hub + ${i};\n`;
  return files;
}

beforeAll(() => {
  fixture = makeFixtureRepo();
  fx = buildGraph(fixture.paths, { config: fixture.config });
}, 120000);

afterAll(() => {
  fixture?.repo.cleanup();
  for (const r of cleanups) r.cleanup();
});

// ---------------------------------------------------------------------------
// §6.2 chooseAreas
// ---------------------------------------------------------------------------

describe("chooseAreas", () => {
  it("promotes the manifest directory first and keeps the rest in path order", () => {
    const { areas, loose } = chooseAreas(fx, "dir:./");
    expect(areas.map((a) => a.id)).toEqual(["dir:native/", "dir:src/"]);
    expect(areas[0]?.manifest).toBe("Cargo.toml");
    expect(loose).toEqual([]);
  });

  it("keeps an oversized candidate whole when fewer than two grandchildren qualify", () => {
    // src/ holds 49 source files but only src/big has 3 or more, so §6.2 step 2 does not fire.
    const { areas } = chooseAreas(fx, "dir:./");
    const src = areas.find((a) => a.id === "dir:src/");
    expect(src?.aggregates?.source).toBeGreaterThan(MAX_VIEW_NODES);
    expect(src?.residual).toBeUndefined();
  });

  it("folds a candidate under minFiles into the parent's loose set", () => {
    // Inside src/: big (46 source) stays an area; tiny (2) and types (1) fold.
    const { areas, loose } = chooseAreas(fx, "dir:src/");
    expect(areas.map((a) => a.id)).toEqual(["dir:src/big/"]);
    expect(loose).toEqual(["src/tiny/one.ts", "src/tiny/two.ts", "src/types/shape.ts"]);
  });

  it("splits one level deeper and leaves a recomputed residual", () => {
    const g = synth(splitFiles());
    const { areas, loose, files } = chooseAreas(g, "dir:./");
    expect(areas.map((a) => a.id)).toEqual(["dir:src/alpha/", "dir:src/beta/", "dir:src/"]);
    const residual = areas[2];
    expect(residual?.residual).toBe(true);
    expect(residual?.label).toBe("src (other)");
    // The residual holds only the small grandchildren plus the candidate's own file …
    expect(residual?.aggregates?.source).toBe(3);
    expect(files.get("dir:src/")).toEqual(["src/gamma/h1.ts", "src/gamma/h2.ts", "src/index.ts"]);
    // … not the whole subtree, which the graph's own aggregates still describe.
    const raw = g.nodes.find((n) => n.id === "dir:src/");
    expect(raw?.aggregates?.source).toBe(48);
    expect(loose).toEqual([]);
    expect(areas[0]?.aggregates?.source).toBe(25);
    expect(areas[1]?.aggregates?.source).toBe(20);
  });

  it("does not split when the split would yield one qualifying grandchild", () => {
    const files = splitFiles();
    for (let i = 1; i <= 20; i += 1) delete files[`src/beta/g${String(i).padStart(2, "0")}.ts`];
    for (let i = 26; i <= 45; i += 1) files[`src/alpha/f${String(i).padStart(2, "0")}.ts`] = `export const f${i} = ${i};\n`;
    const g = synth(files);
    const { areas } = chooseAreas(g, "dir:./");
    expect(areas.map((a) => a.id)).toEqual(["dir:src/"]);
    expect(areas[0]?.residual).toBeUndefined();
  });

  it("pins the areas from config for the repo root", () => {
    const g = synth(splitFiles());
    const { areas } = chooseAreas(g, "dir:./", { areas: ["src/alpha", "src/gamma"] });
    expect(areas.map((a) => a.id)).toEqual(["dir:src/alpha/", "dir:src/gamma/", "dir:./"]);
    const other = areas[2];
    expect(other?.residual).toBe(true);
    expect(other?.label.endsWith(" (other)")).toBe(true);
    expect(other?.aggregates?.source).toBe(21); // beta (20) + src/index.ts
  });

  it("returns nothing for an unknown root", () => {
    expect(chooseAreas(fx, "dir:nope/")).toEqual({ areas: [], loose: [], files: new Map() });
  });

  it("rolls git history up onto residual and config-pinned areas", () => {
    // A residual is a slice of a subtree, so `byPath` has no entry for it. Without the roll-up its
    // aggregates arrived with no `history` at all, which the Heat lens reads as 0 and buckets with
    // the genuinely cold areas — the whole lens collapsed to two occupied steps.
    const history = repoHistory(fixture.repo.root, { diskCache: false });
    const bare = chooseAreas(fx, "dir:./", { areas: ["src/big", "src/types"] });
    expect(bare.areas.find((a) => a.residual)?.aggregates?.history).toBeUndefined();

    const rolled = chooseAreas(fx, "dir:./", { areas: ["src/big", "src/types"], history });
    for (const area of rolled.areas) {
      const h = area.aggregates?.history;
      expect(h, `${area.id} has no history`).toBeDefined();
      // A number for anything git has seen, null only for a file set with no commits at all.
      expect(h?.commits30 === null || typeof h?.commits30 === "number").toBe(true);
    }
    const residual = rolled.areas.find((a) => a.residual);
    expect(residual?.aggregates?.history?.commits365).toBeGreaterThan(0);
    // The residual is part of the repo, so it can never claim more commits than the repo has.
    const repoTotal = history.byPath.get("./")?.commits365 ?? 0;
    expect(residual?.aggregates?.history?.commits365 ?? 0).toBeLessThanOrEqual(repoTotal);
  });

  it("gives every drawable node of the container and dir views a history the Heat lens can read", () => {
    const history = repoHistory(fixture.repo.root, { diskCache: false });
    const commitsOf = (n: { history?: unknown; aggregates?: { history?: unknown } }): unknown =>
      (n.history as { commits30?: unknown } | undefined)?.commits30 ?? (n.aggregates?.history as { commits30?: unknown } | undefined)?.commits30;
    for (const view of [containerView(fx, { history }), dirView(fx, "src", { history })]) {
      const drawable = (view?.nodes ?? []).filter((n) => !n.ghost && n.kind !== "fold");
      expect(drawable.length).toBeGreaterThan(0);
      for (const n of drawable) {
        const c = commitsOf(n);
        expect(c === null || typeof c === "number", `${n.id} has no commits30`).toBe(true);
      }
    }
  });

  it("hands out hues by size rank and labels the residual area", () => {
    const g = synth({ ...splitFiles(), ...MUTUAL, "hub/hub.ts": "export const hub = 1;\n", "hub/hub2.ts": "export const hub2 = 2;\n", "hub/hub3.ts": "export const hub3 = 3;\n" });
    const refs = level1(g).refs;
    expect(refs.length).toBeGreaterThanOrEqual(5);
    const ranked = [...refs].sort((a, b) => b.source - a.source || b.files - a.files || a.id.localeCompare(b.id));
    expect(ranked.slice(0, AREA_HUE_COUNT).map((r) => r.hue)).toEqual(ranked.slice(0, AREA_HUE_COUNT).map((_, i) => i + 1));
    for (const r of ranked.slice(AREA_HUE_COUNT)) expect(r.hue).toBe(0);
    expect(refs.find((r) => r.id === "dir:src/")?.label).toBe("src (other)");
    expect(refs.find((r) => r.id === "dir:src/alpha/")?.label).toBe("src/alpha");
  });

  // VIEW-01: with a five-hue ramp the sixth and seventh areas both fell back to the "other" grey,
  // so two legend rows shared one swatch and neither could be matched to its nodes on the canvas.
  it("gives seven areas seven distinguishable hues", () => {
    const files: Record<string, string> = { ...splitFiles(), ...MUTUAL };
    for (const dir of ["hub", "edge", "rim", "spoke"]) for (let i = 0; i < 3; i += 1) files[`${dir}/${dir}${i}.ts`] = `export const ${dir}${i} = ${i};\n`;
    const refs = level1(synth(files)).refs;
    expect(refs.length).toBeGreaterThanOrEqual(7);
    const coloured = refs.map((r) => r.hue).filter((h) => h > 0);
    expect(coloured.length).toBe(Math.min(refs.length, AREA_HUE_COUNT));
    expect(new Set(coloured).size).toBe(coloured.length);
  });
});

// ---------------------------------------------------------------------------
// §6.3 containerView
// ---------------------------------------------------------------------------

describe("containerView", () => {
  it("draws the level-1 areas and the traffic between them", () => {
    const view = containerView(fx);
    expectViewGraph(view, "container");
    expect(view.root).toBe("dir:./");
    expect(ids(view)).toEqual(["dir:native/", "dir:src/"]);
    expect(view.counts.shown).toBe(2);
    expect(view.counts.folded).toBe(0);
    expect(view.counts.hiddenTests).toBe(6);
    expect(view.counts.totalCodeFiles).toBe(fx.totalCodeFiles);
  });

  it("aggregates IPC on its own channel with the distinct command names", () => {
    const ipc = containerView(fx).edges.find((e) => e.kind === "ipc");
    expect(ipc).toBeDefined();
    expect(ipc?.source).toBe("dir:src/");
    expect(ipc?.target).toBe("dir:native/");
    expect(ipc?.names).toEqual(["list_widgets"]);
  });

  it("counts one aggregated edge per ordered pair and kind, with via behind it", () => {
    const g = synth({
      "x/x1.ts": 'import { y1 } from "../y/y1.js";\nimport { y2 } from "../y/y2.js";\n\nexport const x1 = y1 + y2;\n',
      "x/x2.ts": 'import { y1 } from "../y/y1.js";\n\nexport const x2 = y1;\n',
      "x/x3.ts": "export const x3 = 3;\n",
      "y/y1.ts": "export const y1 = 1;\n",
      "y/y2.ts": "export const y2 = 2;\n",
      "y/y3.ts": "export const y3 = 3;\n",
    });
    const view = containerView(g);
    expectViewGraph(view, "container");
    const edges = view.edges.filter((e) => e.source === "dir:x/" && e.target === "dir:y/");
    expect(edges).toHaveLength(1);
    expect(edges[0]?.kind).toBe("import");
    expect(edges[0]?.weight).toBe(3); // x1→y1, x1→y2, x2→y1
    expect(edges[0]?.via?.length).toBe(3);
    expect(edges[0]?.via?.[0]?.names).toEqual(["y1"]);
  });

  it("reports cycles between areas and flags the edges in them", () => {
    const view = containerView(synth(MUTUAL));
    expectViewGraph(view, "container");
    expect(view.cycles).toEqual([["dir:a/", "dir:b/"]]);
    expect(edgeOf(view, "dir:a/", "dir:b/")?.cycle).toBe(true);
    expect(edgeOf(view, "dir:b/", "dir:a/")?.cycle).toBe(true);
  });

  it("never emits a test edge", () => {
    const view = containerView(fx);
    expect(view.edges.some((e) => e.kind === "tests")).toBe(false);
  });

  it("counts a test file's cross-area import into the import weight instead of dropping it", () => {
    const g = synth(TESTED_ACROSS);
    const view = containerView(g);
    const edge = edgeOf(view, "dir:a/", "dir:b/");
    // 2 source importers + 1 test importer, on one import edge.
    expect(edge?.kind).toBe("import");
    expect(edge?.weight).toBe(3);
    expect(view.edges.some((e) => e.kind === "tests")).toBe(false);
    expect(view.nodes.some((n) => n.role === "test")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// §6.3 dirView
// ---------------------------------------------------------------------------

describe("dirView", () => {
  it("returns null for a directory the graph does not know", () => {
    expect(dirView(fx, "src/nope")).toBeNull();
  });

  it("folds everything past the drawable cap into one fold node", () => {
    const view = dirView(fx, "src/big");
    expect(view).not.toBeNull();
    if (!view) return;
    expectViewGraph(view, "dir");
    expect(view.root).toBe("dir:src/big/");
    expect(view.counts.shown).toBe(MAX_VIEW_NODES);
    expect(view.counts.folded).toBe(6);
    const fold = view.nodes.find((n) => n.kind === "fold");
    expect(fold?.id).toBe("fold:dir:src/big/:loose");
    expect(fold?.label).toBe("+6 more");
    expect(fold?.foldCount).toBe(6);
    expect(fold?.foldIds).toHaveLength(6);
    // The cap counts drawables only: ghosts and the fold node are context.
    expect(view.nodes.length).toBeGreaterThan(MAX_VIEW_NODES);
  });

  it("draws every child when all=1", () => {
    const view = dirView(fx, "src/big", { all: true });
    expect(view?.counts.folded).toBe(0);
    expect(view?.counts.shown).toBe(46);
    expect(view?.nodes.some((n) => n.kind === "fold")).toBe(false);
  });

  it("hides tests until the toggle is on", () => {
    const off = dirView(fx, "src/big");
    expect(off?.counts.hiddenTests).toBe(6);
    expect(off?.nodes.some((n) => n.role === "test")).toBe(false);
    const on = dirView(fx, "src/big", { tests: true, all: true });
    expect(on?.counts.hiddenTests).toBe(0);
    expect(on?.nodes.filter((n) => n.role === "test")).toHaveLength(6);
    expect(on?.edges.some((e) => e.kind === "tests")).toBe(true);
  });

  it("keeps a hidden test file's crossing import in the ghost edge weight", () => {
    const g = synth(TESTED_ACROSS);
    const off = dirView(g, "a");
    const ghost = (off?.edges ?? []).filter((e) => e.target === "ghost:down:dir:b/");
    expect(ghost.map((e) => e.kind)).toEqual(["import"]);
    expect(ghost[0]?.weight).toBe(3);
    expect(off?.counts.hiddenTests).toBe(1);
    // With the toggle on the test edge gets its own channel again, so the weights split 2 + 1.
    const on = dirView(g, "a", { tests: true });
    const shown = (on?.edges ?? []).filter((e) => e.target === "ghost:down:dir:b/");
    expect(shown.reduce((sum, e) => sum + (e.weight ?? 1), 0)).toBe(3);
    expect(shown.some((e) => e.kind === "tests")).toBe(true);
  });

  it("puts a ghost below when the outside area is imported", () => {
    const view = dirView(fx, "src/big", { all: true });
    const ghosts = view?.nodes.filter((n) => n.ghost) ?? [];
    expect(ghosts.map((n) => n.id).sort()).toEqual(["ghost:down:dir:native/", "ghost:down:dir:src/"]);
    for (const g of ghosts) expect(g.side).toBe("down");
    // The ghost's label names the outside area and how many of its files are used.
    expect(ghosts.find((n) => n.id === "ghost:down:dir:src/")?.label).toBe("src · 1 file used");
    expect(ghosts.find((n) => n.id === "ghost:down:dir:src/")?.aggregates).toBeDefined();
  });

  it("puts a ghost above when the outside area imports, resolving it against the parent", () => {
    // src/types and src/big share one level-1 area (dir:src/), so the ghost is the sibling.
    const view = dirView(fx, "src/types");
    const ghosts = view?.nodes.filter((n) => n.ghost) ?? [];
    expect(ghosts.map((n) => n.id)).toEqual(["ghost:up:dir:src/big/"]);
    expect(ghosts[0]?.side).toBe("up");
    expect(ghosts[0]?.label).toBe("src/big · 20 files used");
    const edge = view?.edges.find((e) => e.source === "ghost:up:dir:src/big/");
    expect(edge?.target).toBe("src/types/shape.ts");
    expect(edge?.weight).toBe(20);
    expect(edge?.via).toHaveLength(5);
    expect(edge?.names).toEqual(expect.arrayContaining(["emptyShape", "Shape"]));
  });

  it("splits a two-way neighbour into an up ghost and a down ghost", () => {
    const view = dirView(synth(MUTUAL), "a");
    expect(view).not.toBeNull();
    if (!view) return;
    expectViewGraph(view, "dir");
    const ghosts = view.nodes.filter((n) => n.ghost);
    expect(ghosts.map((n) => n.id).sort()).toEqual(["ghost:down:dir:b/", "ghost:up:dir:b/"]);
    expect(edgeOf(view, "a/a1.ts", "ghost:down:dir:b/")?.kind).toBe("import");
    expect(edgeOf(view, "ghost:up:dir:b/", "a/a3.ts")?.kind).toBe("import");
  });

  it("keeps intra-directory cycles", () => {
    const g = synth({
      "loop/p.ts": 'import { q } from "./q.js";\n\nexport const p = () => q;\n',
      "loop/q.ts": 'import { p } from "./p.js";\n\nexport const q = () => p;\n',
      "loop/r.ts": "export const r = 3;\n",
    });
    const view = dirView(g, "loop");
    expect(view?.cycles).toEqual([["loop/p.ts", "loop/q.ts"]]);
    expect(edgeOf(view as ViewGraph, "loop/p.ts", "loop/q.ts")?.cycle).toBe(true);
  });

  it("draws sub-areas and loose files together, and keeps folded files' edges", () => {
    const view = dirView(fx, "src");
    expect(view).not.toBeNull();
    if (!view) return;
    expectViewGraph(view, "dir");
    expect(ids(view)).toContain("dir:src/big/");
    expect(ids(view)).toEqual(expect.arrayContaining(["src/tiny/one.ts", "src/tiny/two.ts", "src/types/shape.ts"]));
    expect(edgeOf(view, "dir:src/big/", "src/types/shape.ts")?.weight).toBe(20);
  });
});

// ---------------------------------------------------------------------------
// §6.3 impactView
// ---------------------------------------------------------------------------

describe("impactView", () => {
  it("walks both sides to depth and counts each hop", () => {
    const view = impactView(fx, ["src/big/a20.ts"], { depth: 2, direction: "both" });
    expectViewGraph(view, "impact");
    expect(view.center).toBe("src/big/a20.ts");
    expect(view.centers).toBeUndefined();
    expect(view.counts.up).toEqual([1, 1]); // a19, then a18
    expect(view.counts.down).toEqual([2, 1]); // a21 + shape.ts, then a22
    const byId = new Map(view.nodes.map((n) => [n.id, n]));
    expect(byId.get("src/big/a20.ts")?.hop).toBe(0);
    expect(byId.get("src/big/a20.ts")?.center).toBe(true);
    expect(byId.get("src/big/a19.ts")?.side).toBe("up");
    expect(byId.get("src/big/a19.ts")?.hop).toBe(1);
    expect(byId.get("src/big/a18.ts")?.hop).toBe(2);
    expect(byId.get("src/big/a21.ts")?.side).toBe("down");
  });

  it("honours direction", () => {
    const up = impactView(fx, ["src/big/a20.ts"], { depth: 1, direction: "up" });
    expect(up.counts.up).toEqual([1]);
    expect(up.counts.down).toBeUndefined();
    expect(ids(up).sort()).toEqual(["src/big/a19.ts", "src/big/a20.ts"]);
    const down = impactView(fx, ["src/big/a20.ts"], { depth: 1, direction: "down" });
    expect(down.counts.up).toBeUndefined();
    expect(down.counts.down).toEqual([2]);
  });

  it("takes a file::symbol id as the file", () => {
    const view = impactView(fx, ["src/big/a20.ts::a20"], { depth: 1 });
    expect(view.center).toBe("src/big/a20.ts");
  });

  it("groups the overflow of a hop into fold nodes by area", () => {
    const view = impactView(synth(hubFiles()), ["hub/hub.ts"], { depth: 1, direction: "up" });
    expectViewGraph(view, "impact");
    expect(view.counts.up).toEqual([50]);
    expect(view.counts.shown).toBe(MAX_VIEW_NODES);
    expect(view.counts.folded).toBe(11);
    const fold = view.nodes.find((n) => n.kind === "fold");
    expect(fold?.id).toBe("fold:up:dir:users/");
    expect(fold?.side).toBe("up");
    expect(fold?.hop).toBe(1);
    expect(fold?.foldCount).toBe(11);
    expect(fold?.label).toBe("+11 more in users");
    // The folded files keep their edge to the centre, remapped onto the fold node.
    expect(edgeOf(view, "fold:up:dir:users/", "hub/hub.ts")?.weight).toBe(11);
  });

  it("marks a node reached from more than one centre", () => {
    const view = impactView(fx, ["src/big/a01.ts", "src/big/a02.ts"], { depth: 1, direction: "down" });
    expectViewGraph(view, "impact");
    expect(view.centers).toEqual(["src/big/a01.ts", "src/big/a02.ts"]);
    expect(view.center).toBeUndefined();
    const shape = view.nodes.find((n) => n.id === "src/types/shape.ts");
    expect(shape?.collision).toEqual(["src/big/a01.ts", "src/big/a02.ts"]);
    expect(view.nodes.find((n) => n.id === "src/big/a03.ts")?.collision).toBeUndefined();
  });

  it("leaves tests out until the toggle is on", () => {
    const off = impactView(fx, ["src/big/a01.ts"], { depth: 1, direction: "up" });
    expect(ids(off).some((id) => id.includes("__tests__"))).toBe(false);
    expect(off.counts.hiddenTests).toBeGreaterThan(0);
    const on = impactView(fx, ["src/big/a01.ts"], { depth: 1, direction: "up", tests: true });
    expect(ids(on)).toContain("src/big/__tests__/a01.test.ts");
    expect(on.counts.hiddenTests).toBe(0);
  });

  it("returns an empty view for an id that is not a file", () => {
    const view = impactView(fx, ["dir:src/big/"], { depth: 1 });
    expect(view.nodes).toEqual([]);
    expect(view.root).toBe("");
    expect(view.counts.shown).toBe(0);
  });
});
