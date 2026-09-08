import { readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { makeFixtureRepo, type FixtureRepo } from "../test/fixtures.js";
import { makeTempRepo, type TempRepo } from "../test/helpers.js";
import { buildGraph, type RepoGraph } from "./graph.js";
import { repoHistory } from "./history.js";
import { repoPaths } from "./paths.js";
import { loadConfig } from "./people.js";
import { detectServices, type ServiceIndex } from "./services.js";
import { traceFlow, type Flow } from "./flows.js";
import {
  EMPTY_TEXT,
  areaStory,
  buildStoryContext,
  countPhrase,
  explain,
  fileStory,
  flowStory,
  formatAge,
  formatDate,
  numberWord,
  parseLinks,
  repoStory,
  routeFor,
  servicesStory,
  taskStory,
  timesPhrase,
  workspaceStory,
  type Paragraph,
  type Story,
  type StoryContext,
} from "./story.js";
import type { WorkspaceSummary } from "./workspace.js";

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

const cleanups: (TempRepo | FixtureRepo)[] = [];

function contextFor(root: string): StoryContext {
  const paths = repoPaths(root);
  const config = loadConfig(paths);
  const graph: RepoGraph = buildGraph(paths);
  const history = repoHistory(root, { diskCache: false });
  return buildStoryContext(paths, config, graph, history, {
    readFile: (file) => {
      try {
        return readFileSync(path.join(root, file), "utf8");
      } catch {
        return null;
      }
    },
  });
}

let fixture: FixtureRepo;
let ctx: StoryContext;

beforeAll(() => {
  fixture = makeFixtureRepo();
  cleanups.push(fixture);
  ctx = contextFor(fixture.repo.root);
}, 120_000);

afterAll(() => {
  for (const c of cleanups) ("cleanup" in c ? c : c.repo).cleanup();
});

function sectionIds(story: Story): string[] {
  return story.sections.map((s) => s.id);
}

function sectionOf(story: Story, id: string) {
  const found = story.sections.find((s) => s.id === id);
  expect(found, `section ${id} is missing`).toBeDefined();
  return found!;
}

function allParagraphs(story: Story): Paragraph[] {
  return story.sections.flatMap((s) => s.paragraphs);
}

/**
 * The client's route parser (ui/app.js `parseRoute`), reimplemented here so the test can prove
 * that every route the story emits lands on a real level with the right repo and id.
 */
function parseRoute(hash: string): { level: string; repo: string | null; id: string | null; query: Record<string, string> } {
  const raw = hash.startsWith("#") ? hash.slice(1) : hash;
  const q = raw.indexOf("?");
  const pathPart = q >= 0 ? raw.slice(0, q) : raw;
  const query: Record<string, string> = {};
  for (const [k, v] of new URLSearchParams(q >= 0 ? raw.slice(q + 1) : "")) query[k] = v;
  const segs = pathPart.split("/").filter((s) => s.length > 0);
  const out = { level: "home", repo: null as string | null, id: null as string | null, query };
  if (segs.length === 0) return out;
  if (segs[0] === "ws") return { ...out, level: "workspace" };
  if (segs[0] !== "repo" || segs.length < 2) return out;
  const repo = decodeURIComponent(segs[1] ?? "");
  if (segs.length === 2) return { ...out, level: "repo", repo };
  const rest = decodeURIComponent(segs.slice(3).join("/"));
  const kind = segs[2];
  const levels: Record<string, string> = { area: "area", file: "file", symbol: "symbol", task: "task", person: "person", tasks: "tasks", people: "people", time: "time", services: "services", flows: "flows", flow: "flow" };
  const level = kind ? levels[kind] : undefined;
  if (!level) return { ...out, level: "unknown", repo };
  return { ...out, level, repo, id: rest || null };
}

/** Every link in every paragraph parses, names this repo, and has a non-empty label. */
function expectLinksWellFormed(story: Story, repo: string): void {
  const texts = [...allParagraphs(story).map((p) => p.text), ...story.sections.flatMap((s) => (s.empty?.action?.route ? [s.empty.action.route] : []))];
  let seen = 0;
  for (const text of texts) {
    // No half-open markup anywhere.
    expect(text.split("[[").length, `unbalanced [[ in: ${text}`).toBe(text.split("]]").length);
    for (const { route, label } of parseLinks(text)) {
      seen += 1;
      expect(label.trim().length, `empty label in: ${text}`).toBeGreaterThan(0);
      expect(route.startsWith("#/"), `route is not a hash route: ${route}`).toBe(true);
      const parsed = parseRoute(route);
      expect(["repo", "area", "file", "symbol", "task", "tasks", "person", "workspace", "services", "flows", "flow"], `unparseable route ${route}`).toContain(parsed.level);
      if (parsed.level !== "workspace") expect(parsed.repo).toBe(repo);
    }
  }
  expect(seen).toBeGreaterThan(0);
  for (const c of story.crumbs) expect(parseRoute(c.route).level).not.toBe("unknown");
  for (const n of story.next) expect(parseRoute(n.route).level).not.toBe("unknown");
}

/** Every paragraph has an id, a kind, refs, and no stray `undefined` in its refs. */
function expectParagraphContract(story: Story): void {
  const ids = new Set<string>();
  for (const p of allParagraphs(story)) {
    expect(p.id).toBeTruthy();
    expect(ids.has(p.id), `duplicate paragraph id ${p.id}`).toBe(false);
    ids.add(p.id);
    expect(["fact", "note", "journal", "gap", "commit", "decision", "list"]).toContain(p.kind);
    expect(Array.isArray(p.refs)).toBe(true);
    for (const r of p.refs) expect(typeof r === "string" && r.length > 0, `bad ref on ${p.id}`).toBe(true);
    expect(p.text.trim().length).toBeGreaterThan(0);
  }
}

// ---------------------------------------------------------------------------
// Numbers, dates, ages (spec §6.6)
// ---------------------------------------------------------------------------

describe("numbers, dates and ages", () => {
  it("writes 0 as 'no', 1–9 as words and 10 and up as digits", () => {
    expect(numberWord(0)).toBe("no");
    expect(numberWord(1)).toBe("one");
    expect(numberWord(2)).toBe("two");
    expect(numberWord(9)).toBe("nine");
    expect(numberWord(10)).toBe("10");
    expect(numberWord(41)).toBe("41");
    expect(numberWord(-3)).toBe("no");
  });

  it("agrees number and noun", () => {
    expect(countPhrase(0, "file")).toBe("no files");
    expect(countPhrase(1, "file")).toBe("one file");
    expect(countPhrase(2, "file")).toBe("two files");
    expect(countPhrase(12, "source file")).toBe("12 source files");
    expect(countPhrase(1, "entry", "entries")).toBe("one entry");
    expect(countPhrase(3, "entry", "entries")).toBe("three entries");
  });

  it("counts repetitions as once / twice / N times", () => {
    expect(timesPhrase(1)).toBe("once");
    expect(timesPhrase(2)).toBe("twice");
    expect(timesPhrase(3)).toBe("three times");
    expect(timesPhrase(41)).toBe("41 times");
  });

  it("drops the year inside the current year and keeps it otherwise", () => {
    const now = new Date("2026-09-07T10:00:00Z");
    expect(formatDate("2026-09-06", now)).toBe("6 Sep");
    expect(formatDate("2026-09-06T11:22:33+02:00", now)).toBe("6 Sep");
    expect(formatDate("2025-12-02", now)).toBe("2 Dec 2025");
    expect(formatDate(null, now)).toBe("an unknown date");
  });

  it("writes ages in days", () => {
    expect(formatAge(0)).toBe("today");
    expect(formatAge(1)).toBe("1 day");
    expect(formatAge(2)).toBe("2 days");
    expect(formatAge(null)).toBe("no recorded activity");
  });
});

// ---------------------------------------------------------------------------
// routeFor: one id → route map (spec §2)
// ---------------------------------------------------------------------------

describe("routeFor", () => {
  it("maps every id kind to the route in spec §2", () => {
    expect(routeFor("reggie", "repo:reggie")).toBe("#/repo/reggie");
    expect(routeFor("reggie", "dir:./")).toBe("#/repo/reggie");
    expect(routeFor("reggie", "dir:src/components/")).toBe("#/repo/reggie/area/src/components");
    expect(routeFor("reggie", "packages/reggie/src/graph.ts")).toBe("#/repo/reggie/file/packages/reggie/src/graph.ts");
    expect(routeFor("reggie", "sym:src/a.ts::buildGraph")).toBe("#/repo/reggie/symbol/src/a.ts::buildGraph");
    expect(routeFor("reggie", "task:cache-chain")).toBe("#/repo/reggie/task/cache-chain");
    expect(routeFor("reggie", "person:jacobpress")).toBe("#/repo/reggie/person/jacobpress");
    expect(routeFor("reggie", "ghost:up:dir:src/types/")).toBe("#/repo/reggie/area/src/types");
    expect(routeFor("reggie", "fold:dir:src/:loose")).toBe("#/repo/reggie");
  });

  it("appends the query string and escapes what would break the hash", () => {
    expect(routeFor("reggie", "dir:src/types/", { lens: "knowledge" })).toBe("#/repo/reggie/area/src/types?lens=knowledge");
    expect(routeFor("reggie", "src/a.ts", { dir: "up", depth: 2 })).toBe("#/repo/reggie/file/src/a.ts?dir=up&depth=2");
    expect(routeFor("reggie", "person:Test Person")).toBe("#/repo/reggie/person/Test%20Person");
    expect(parseRoute(routeFor("reggie", "person:Test Person")).id).toBe("Test Person");
  });
});

// ---------------------------------------------------------------------------
// Repo scope
// ---------------------------------------------------------------------------

describe("repoStory on the fixture repo", () => {
  it("emits every section id from the contract, in order", () => {
    expect(sectionIds(repoStory(ctx))).toEqual(["needs-you", "what", "made-of", "starts", "talks", "flight", "recent", "gaps", "run"]);
  });

  it("keeps every paragraph and every link well formed", () => {
    const story = repoStory(ctx);
    expectParagraphContract(story);
    expectLinksWellFormed(story, ctx.repo);
  });

  it("puts the awaiting-decision task in Needs you with a decision block", () => {
    const s = sectionOf(repoStory(ctx), "needs-you");
    expect(s.paragraphs).toHaveLength(1);
    const p = s.paragraphs[0]!;
    expect(p.kind).toBe("decision");
    expect(p.decision?.slug).toBe(fixture.slugs.awaiting);
    expect(p.text).toContain("is waiting for a decision");
    expect(p.refs).toContain(`task:${fixture.slugs.awaiting}`);
  });

  it("describes each area with counts, notes, heat and its island status", () => {
    const s = sectionOf(repoStory(ctx), "made-of");
    expect(s.paragraphs.length).toBeGreaterThan(0);
    const text = s.paragraphs.map((p) => p.text).join("\n");
    expect(text).toMatch(/source files/);
    expect(text).toMatch(/with a note|none with a note|no note/);
    // The lens presets the spec asks for are on the links.
    expect(text).toContain("?lens=structure");
    expect(text).toContain("?lens=knowledge");
  });

  it("keeps the 'mostly for' count inside the total the sentence gives", () => {
    // Every importer names three symbols, so counting named imports instead of importing files
    // would print a parenthetical (15) larger than the sentence's own total.
    const repo = makeTempRepo("reggie-story-talks-");
    cleanups.push(repo);
    repo.write("b/b1.ts", "export const x = 1;\nexport const y = 2;\nexport const z = 3;\n");
    repo.write("b/b2.ts", "export const w = 4;\n");
    repo.write("b/b3.ts", "export const v = 5;\n");
    for (let i = 1; i <= 5; i += 1) {
      const extra = i === 1 ? 'import { w } from "../b/b2.js";\n' : "";
      repo.write(`a/a${i}.ts`, `import { x, y, z } from "../b/b1.js";\n${extra}\nexport const a${i} = x + y + z;\n`);
    }
    repo.commitAll("talks");
    const local = contextFor(repo.root);

    const view = local.views.container();
    const paragraphs = sectionOf(repoStory(local), "talks").paragraphs;
    let checked = 0;
    for (const p of paragraphs) {
      const m = /mostly for \[\[[^\]]+\]\] \((\d+)\)/.exec(p.text);
      if (!m?.[1]) continue;
      const edge = view.edges.find((e) => e.source === p.refs[0] && e.target === p.refs[1] && e.kind === "import");
      expect(edge, p.text).toBeDefined();
      // The parenthetical counts importing files, exactly like the edge weight it sits inside.
      expect(Number(m[1]), p.text).toBeLessThanOrEqual(edge?.weight ?? 1);
      expect(Number(m[1]), p.text).toBe(5);
      // F1/F9: the sentence and the map tooltip must be the same field, not two counts that
      // happen to agree. Summing named imports over the (truncated) `via` list is what used to
      // make the tooltip say 15 while the story said 5.
      expect(edge?.top, p.text).toEqual({ path: "b/b1.ts", files: 5 });
      expect(Number(m[1]), p.text).toBe(edge?.top?.files);
      const viaNames = (edge?.via ?? []).reduce((sum, v) => sum + v.names.length, 0);
      expect(viaNames, "the old tooltip arithmetic is not the answer").not.toBe(edge?.top?.files);
      checked += 1;
    }
    expect(checked).toBe(1);
  });

  it("lists the three fixture tasks grouped by state, in process first", () => {
    const s = sectionOf(repoStory(ctx), "flight");
    const text = s.paragraphs.map((p) => p.text).join("\n");
    expect(text).toContain(fixture.slugs.inProcess);
    expect(text).toContain(fixture.slugs.awaiting);
    expect(text).toContain(fixture.slugs.ungroomed);
    expect(text.indexOf("in process")).toBeLessThan(text.indexOf("awaiting decision"));
  });

  it("quotes the journal verbatim with attribution chips", () => {
    const s = sectionOf(repoStory(ctx), "recent");
    const journal = s.paragraphs.filter((p) => p.kind === "journal");
    expect(journal.length).toBeGreaterThan(0);
    const first = journal[0]!;
    expect(ctx.journal.some((e) => e.text.replace(/\s+/g, " ").trim() === first.text)).toBe(true);
    expect(first.chips?.map((c) => c.label)).toContain("Person");
    expect(first.chips?.map((c) => c.label)).toContain("Tool");
    expect(first.source?.person).toBeTruthy();
  });

  it("names the stale note and the undocumented area in Gaps", () => {
    const text = sectionOf(repoStory(ctx), "gaps")
      .paragraphs.map((p) => p.text)
      .join("\n");
    expect(text).toMatch(/none of them has a note/);
    expect(text).toMatch(/was written on .* but the folder changed on .*; it may be out of date/);
  });

  it("uses the repo name and branch in the header", () => {
    const story = repoStory(ctx);
    expect(story.title).toBe(ctx.repo);
    expect(story.subtitle).toContain("Branch");
    expect(story.crumbs[0]?.route).toBe("#/ws");
  });
});

// ---------------------------------------------------------------------------
// Area scope
// ---------------------------------------------------------------------------

describe("areaStory", () => {
  it("emits every section id from the contract", () => {
    const story = areaStory(ctx, "src/big");
    expect(story).not.toBeNull();
    expect(sectionIds(story!)).toEqual(["read-first", "inside", "uses", "used-by", "tests", "people", "tasks", "recent"]);
  });

  it("adds a gaps section under the knowledge lens", () => {
    const knowledge = buildStoryContext(fixture.paths, fixture.config, ctx.graph, ctx.history, { lens: "knowledge", journal: ctx.journal, notes: ctx.notes, tasks: ctx.tasks });
    const story = areaStory(knowledge, "src/big");
    expect(sectionIds(story!)).toContain("gaps");
    expect(sectionIds(story!).at(-1)).toBe("gaps");
  });

  it("reads the note chain first and flags the stale folder note", () => {
    const s = sectionOf(areaStory(ctx, "src/big")!, "read-first");
    expect(s.paragraphs.some((p) => p.kind === "note")).toBe(true);
    const stale = s.paragraphs.find((p) => p.source?.stale === true);
    expect(stale, "the fixture's src/big note is stale and should say so").toBeDefined();
    expect(stale!.chips?.some((c) => c.label === "Possibly out of date")).toBe(true);
  });

  it("names the most relied-on file and keeps the links parseable", () => {
    const story = areaStory(ctx, "src/big")!;
    expect(sectionOf(story, "inside").paragraphs[0]?.text).toContain("most relied-on file here");
    expectParagraphContract(story);
    expectLinksWellFormed(story, ctx.repo);
  });

  it("returns null for a path that is not a directory in the graph", () => {
    expect(areaStory(ctx, "src/nope")).toBeNull();
    expect(areaStory(ctx, "src/big/a01.ts")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// File scope
// ---------------------------------------------------------------------------

describe("fileStory", () => {
  it("emits every section id from the contract", () => {
    const story = fileStory(ctx, "src/types/shape.ts");
    expect(story).not.toBeNull();
    expect(sectionIds(story!)).toEqual(["read-first", "exports", "used-by", "uses", "tests", "tasks", "history", "add-note"]);
  });

  it("lists the most-used exports first, so the cap cannot bury them", () => {
    const repo = makeTempRepo("reggie-story-exports-");
    cleanups.push(repo);
    const decls: string[] = [];
    for (let i = 1; i <= 20; i += 1) decls.push(`export type T${String(i).padStart(2, "0")} = string;`);
    decls.push("export function hot(): number {\n  return 1;\n}");
    decls.push("export const cold = 0;");
    repo.write("src/lib.ts", `${decls.join("\n\n")}\n`);
    for (let i = 1; i <= 5; i += 1) repo.write(`src/u${i}.ts`, `import { hot } from "./lib.js";\n\nexport const u${i} = hot();\n`);
    repo.commitAll("exports");
    const local = contextFor(repo.root);

    const s = sectionOf(fileStory(local, "src/lib.ts")!, "exports");
    const lines = (s.paragraphs[0]?.text ?? "").split("\n");
    expect(lines).toHaveLength(20);
    // `hot` is declared 21st but used by five files: it must be listed, and listed first.
    expect(lines[0]).toContain("hot");
    expect(lines[0]).toContain("used by five files");
    expect(s.paragraphs[1]?.text).toContain("more exports are not listed here");
  });

  it("lists exports with their usage counts when a reader is available", () => {
    const s = sectionOf(fileStory(ctx, "src/types/shape.ts")!, "exports");
    expect(s.paragraphs[0]?.kind).toBe("list");
    expect(s.paragraphs[0]?.text).toContain("emptyShape");
    expect(s.paragraphs[0]?.text).toMatch(/used by \w+ files?/);
  });

  it("leaves exports empty, with its empty text, when no reader was passed in", () => {
    const blind = buildStoryContext(fixture.paths, fixture.config, ctx.graph, ctx.history, { journal: ctx.journal, notes: ctx.notes, tasks: ctx.tasks });
    const s = sectionOf(fileStory(blind, "src/types/shape.ts")!, "exports");
    expect(s.paragraphs).toHaveLength(0);
    expect(s.empty?.text).toBe(EMPTY_TEXT.fileExports);
  });

  it("says exactly 'No test imports this file.' when nothing tests it", () => {
    const s = sectionOf(fileStory(ctx, "src/tiny/one.ts")!, "tests");
    expect(s.paragraphs).toHaveLength(0);
    expect(s.empty?.text).toBe("No test imports this file.");
    expect(s.empty?.action?.route).toContain("lens=tests");
  });

  it("names the test that imports a covered file", () => {
    const s = sectionOf(fileStory(ctx, "src/big/a01.ts")!, "tests");
    expect(s.paragraphs[0]?.text).toContain("a01.test.ts");
    expect(s.paragraphs[0]?.text).toMatch(/imports? this file/);
  });

  it("groups importers by area and lists external packages", () => {
    const story = fileStory(ctx, "src/big/ipc.ts")!;
    expect(sectionOf(story, "uses").paragraphs.some((p) => p.text.includes("@tauri-apps/api/core"))).toBe(true);
    expectParagraphContract(story);
    expectLinksWellFormed(story, ctx.repo);
  });

  it("always offers the note form, and adds gaps under the knowledge lens", () => {
    const story = fileStory(ctx, "src/big/a02.ts")!;
    const add = sectionOf(story, "add-note");
    expect(add.paragraphs).toHaveLength(0);
    expect(add.empty?.action?.form).toBe("note");
    expect(add.empty?.action?.command).toContain("reggie note add src/big/a02.ts");

    const knowledge = buildStoryContext(fixture.paths, fixture.config, ctx.graph, ctx.history, { lens: "knowledge", journal: ctx.journal, notes: ctx.notes, tasks: ctx.tasks });
    const gaps = sectionOf(fileStory(knowledge, "src/big/a02.ts")!, "gaps");
    expect(gaps.paragraphs.some((p) => p.kind === "gap")).toBe(true);
  });

  it("returns null for an unknown path", () => {
    expect(fileStory(ctx, "src/big/nope.ts")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Task scope
// ---------------------------------------------------------------------------

describe("taskStory", () => {
  it("emits every section id from the contract, in order", () => {
    const story = taskStory(ctx, fixture.slugs.awaiting);
    expect(story).not.toBeNull();
    expect(sectionIds(story!)).toEqual(["state", "owner", "problem", "approach", "files", "criteria", "verification", "assumptions", "scope", "bail", "risk", "packet", "journal"]);
  });

  it("states the state, its definition and the git reason", () => {
    const s = sectionOf(taskStory(ctx, fixture.slugs.awaiting)!, "state");
    expect(s.paragraphs[0]?.text).toContain("awaiting decision");
    expect(s.paragraphs[0]?.chips?.some((c) => c.label === "State")).toBe(true);
    expect(s.paragraphs[1]?.text).toContain("read that state from git");
  });

  it("links the planned files and calls out the collision with the other plan", () => {
    const s = sectionOf(taskStory(ctx, fixture.slugs.awaiting)!, "files");
    const text = s.paragraphs.map((p) => p.text).join("\n");
    expect(text).toContain("src/big/a01.ts");
    expect(text).toContain(`both touch`);
    expect(text).toContain(fixture.slugs.inProcess);
  });

  it("explains an ungroomed task instead of showing an empty plan", () => {
    const story = taskStory(ctx, fixture.slugs.ungroomed)!;
    const problem = sectionOf(story, "problem");
    expect(problem.paragraphs).toHaveLength(0);
    expect(problem.empty?.text).toContain("No plan yet.");
    expect(problem.empty?.text).toContain("Plan it in plan mode against the contract");
    expectLinksWellFormed(story, ctx.repo);
  });

  it("keeps every paragraph and link well formed for an in-process task", () => {
    const story = taskStory(ctx, fixture.slugs.inProcess)!;
    expectParagraphContract(story);
    expectLinksWellFormed(story, ctx.repo);
  });

  it("returns null for an unknown slug", () => {
    expect(taskStory(ctx, "not-a-task")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// explain: exactly four sentences
// ---------------------------------------------------------------------------

describe("explain", () => {
  it("returns exactly four sentences for a directory", () => {
    const e = explain(ctx, "dir:src/big/");
    expect(e).not.toBeNull();
    expect(e!.kind).toBe("dir");
    expect(e!.sentences).toHaveLength(4);
    expect(e!.route).toBe("#/repo/fixture/area/src/big");
    expect(e!.actions.map((a) => a.label)).toEqual(["Go deeper", "Show what breaks if it changes", "Add a note"]);
  });

  it("returns exactly four sentences for a file", () => {
    const e = explain(ctx, "src/types/shape.ts");
    expect(e).not.toBeNull();
    expect(e!.kind).toBe("file");
    expect(e!.sentences).toHaveLength(4);
    expect(e!.sentences[0]?.text).toContain("shape.ts");
    expect(e!.sentences[1]?.text).toMatch(/used by|Nothing imports it/);
  });

  it("returns exactly four sentences for a task", () => {
    const e = explain(ctx, `task:${fixture.slugs.inProcess}`);
    expect(e).not.toBeNull();
    expect(e!.kind).toBe("task");
    expect(e!.sentences).toHaveLength(4);
    expect(e!.sentences[0]?.text).toContain("in process");
  });

  it("gives every sentence refs and links that parse", () => {
    for (const id of ["dir:src/big/", "src/types/shape.ts", `task:${fixture.slugs.inProcess}`, "repo:fixture", "dir:./"]) {
      const e = explain(ctx, id);
      expect(e, `explain(${id}) returned null`).not.toBeNull();
      expect(e!.sentences).toHaveLength(4);
      for (const s of e!.sentences) {
        expect(s.text.trim().length).toBeGreaterThan(0);
        expect(s.refs.length).toBeGreaterThan(0);
        for (const { route } of parseLinks(s.text)) expect(parseRoute(route).level).not.toBe("unknown");
      }
      for (const a of e!.actions) expect(parseRoute(a.route.split("#add-note")[0] ?? a.route).level).not.toBe("unknown");
    }
  });

  it("returns null for an id that is not in the graph", () => {
    expect(explain(ctx, "dir:nope/")).toBeNull();
    expect(explain(ctx, "src/nope.ts")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Empty inputs: every section states its absence in the spec's words
// ---------------------------------------------------------------------------

describe("a repo with no notes, tasks, journal or commands", () => {
  let bare: StoryContext;
  let bareRoot: string;

  beforeAll(() => {
    const repo = makeTempRepo("reggie-story-bare-");
    cleanups.push(repo);
    bareRoot = repo.root;
    repo.write("src/a.ts", 'import { b } from "./b.js";\n\nexport function a(): number {\n  return b() + 1;\n}\n');
    repo.write("src/b.ts", "export function b(): number {\n  return 2;\n}\n");
    repo.write("src/c.ts", "export function c(): number {\n  return 3;\n}\n");
    repo.commitAll("bare");
    bare = contextFor(repo.root);
  }, 60_000);

  it("uses the spec's empty text for every empty repo section", () => {
    const story = repoStory(bare);
    expect(sectionOf(story, "what").empty?.text).toBe(EMPTY_TEXT.repoWhat);
    expect(sectionOf(story, "what").empty?.action?.form).toBe("note");
    expect(sectionOf(story, "starts").empty?.text).toBe(EMPTY_TEXT.repoStarts);
    expect(sectionOf(story, "flight").empty?.text).toBe(EMPTY_TEXT.tasks);
    expect(sectionOf(story, "flight").empty?.action?.form).toBe("capture");
    expect(sectionOf(story, "run").empty?.text).toBe(EMPTY_TEXT.repoRun);
  });

  it("says how far back it looked when nothing falls inside the journal window", () => {
    // Everything in this repo was committed today, so look at it from a hundred days later.
    const hundredDaysOn = new Date(Date.now() + 100 * 24 * 60 * 60 * 1000);
    const later = buildStoryContext(repoPaths(bareRoot), loadConfig(repoPaths(bareRoot)), bare.graph, bare.history, { now: hundredDaysOn });
    const recent = sectionOf(repoStory(later), "recent");
    expect(recent.paragraphs).toHaveLength(0);
    expect(recent.empty?.text).toBe("Nothing was recorded in the last 14 days.");
    expect(recent.empty?.action?.label).toBe("Widen to 60 days");

    const widened = buildStoryContext(repoPaths(bareRoot), loadConfig(repoPaths(bareRoot)), bare.graph, bare.history, { days: 60, now: hundredDaysOn });
    const wide = sectionOf(repoStory(widened), "recent");
    expect(wide.empty?.text).toBe("Nothing was recorded in the last 60 days.");
    expect(wide.empty?.action).toBeUndefined();
  });

  it("hides Needs you and never leaves 'What it is made of' empty", () => {
    const story = repoStory(bare);
    const needsYou = sectionOf(story, "needs-you");
    expect(needsYou.paragraphs).toHaveLength(0);
    expect(needsYou.empty).toBeUndefined();
    expect(sectionOf(story, "made-of").paragraphs.length).toBeGreaterThan(0);
  });

  it("emits a gap sentence naming the undocumented area", () => {
    const gaps = sectionOf(repoStory(bare), "gaps");
    expect(gaps.paragraphs.length).toBeGreaterThan(0);
    expect(gaps.paragraphs[0]?.kind).toBe("gap");
    expect(gaps.paragraphs[0]?.text).toContain("none of them has a note");
    expect(gaps.paragraphs[0]?.text).toContain("three source files");
  });

  it("uses the spec's note text for an empty note chain at every level", () => {
    expect(sectionOf(areaStory(bare, "src")!, "read-first").empty?.text).toBe(EMPTY_TEXT.notes);
    expect(sectionOf(fileStory(bare, "src/a.ts")!, "read-first").empty?.text).toBe(EMPTY_TEXT.notes);
    expect(sectionOf(fileStory(bare, "src/c.ts")!, "used-by").empty?.text).toBe(EMPTY_TEXT.fileUsedBy);
    expect(sectionOf(fileStory(bare, "src/c.ts")!, "tasks").empty?.text).toBe(EMPTY_TEXT.fileTasks);
  });

  it("still produces well-formed links everywhere", () => {
    expectLinksWellFormed(repoStory(bare), bare.repo);
    expectLinksWellFormed(areaStory(bare, "src")!, bare.repo);
    expectLinksWellFormed(fileStory(bare, "src/a.ts")!, bare.repo);
  });
});

// ---------------------------------------------------------------------------
// Workspace scope
// ---------------------------------------------------------------------------

describe("workspaceStory", () => {
  const summary: WorkspaceSummary = {
    name: "Reggie Workspace",
    root: "/tmp/ws",
    single: false,
    repos: [
      {
        name: "reggie",
        path: "/tmp/ws/reggie",
        description: "the agent system",
        primaryLanguage: "TypeScript",
        codeFiles: 161,
        branch: "repo-manager",
        taskCounts: { ungroomed: 1, groomed: 0, planned: 0, "in-process": 2, "awaiting-decision": 1, done: 4 },
        knowledge: { source: 100, noted: 20, inherited: 30, stale: 1 },
        lastJournal: { date: "2026-09-07", time: "09:00", person: "jacobpress", tool: "claude", slug: "ui", stage: "build", text: "Wired the story column. It highlights on hover.", evidence: [], file: "x.md" },
        entryPoints: ["src/cli.ts"],
        needsYou: [{ slug: "story-column", title: "Story column", owner: "jacobpress", age: 2 }],
      },
      {
        name: "forge-reggie",
        path: "/tmp/ws/forge-reggie",
        description: "the desktop companion",
        primaryLanguage: "Rust",
        codeFiles: 42,
        branch: "main",
        taskCounts: { ungroomed: 0, groomed: 0, planned: 0, "in-process": 0, "awaiting-decision": 0, done: 0 },
        knowledge: { source: 40, noted: 0, inherited: 0, stale: 0 },
        lastJournal: null,
        entryPoints: [],
        needsYou: [],
      },
    ],
    edges: [{ source: "forge-reggie", target: "reggie", kind: "same-org", via: "The-Banana-Standard" }],
  };

  it("emits the workspace section ids from the contract", () => {
    expect(sectionIds(workspaceStory(summary))).toEqual(["needs-you", "repos", "connect"]);
  });

  it("writes one paragraph per repo with counts, coverage and the last journal line", () => {
    const s = sectionOf(workspaceStory(summary, new Date("2026-09-07T12:00:00Z")), "repos");
    expect(s.paragraphs).toHaveLength(2);
    const first = s.paragraphs[0]!;
    expect(first.text).toContain("161 code files");
    expect(first.text).toContain("50% of its source files have a note");
    expect(first.text).toContain('Last recorded: "Wired the story column."');
    expect(s.paragraphs[1]?.text).toContain("Nothing has been recorded in its journal yet.");
  });

  it("names the cross-repo edge and the awaiting-decision task", () => {
    const story = workspaceStory(summary);
    expect(sectionOf(story, "connect").paragraphs[0]?.text).toContain("share the GitHub org The-Banana-Standard");
    expect(sectionOf(story, "needs-you").paragraphs[0]?.text).toContain("is waiting for a decision");
    for (const p of allParagraphs(story)) for (const { route } of parseLinks(p.text)) expect(parseRoute(route).level).not.toBe("unknown");
  });

  it("uses the spec's empty text when no manifest links the repos", () => {
    const s = sectionOf(workspaceStory({ ...summary, edges: [] }), "connect");
    expect(s.paragraphs).toHaveLength(0);
    expect(s.empty?.text).toBe("No dependency between these repos was found in their manifests.");
  });
});

// ---------------------------------------------------------------------------
// Services and data flow (services-and-flows-spec.md §4)
// ---------------------------------------------------------------------------

describe("servicesStory and flowStory", () => {
  let repo: TempRepo;
  let local: StoryContext;
  let index: ServiceIndex;
  let flow: Flow;

  beforeAll(() => {
    repo = makeTempRepo("reggie-story-services-");
    cleanups.push(repo);
    repo.write(
      "wrangler.toml",
      [
        'name = "storyworker"',
        "",
        "[vars]",
        'GREETING = "hi"',
        "",
        "[[d1_databases]]",
        'binding = "CHAT_LOGS"',
        'database_name = "story-logs"',
        "",
        "[[kv_namespaces]]",
        'binding = "CACHE"',
        'id = "kv-1"',
        "",
        "[[kv_namespaces]]",
        'binding = "IDLE"',
        'id = "kv-2"',
        "",
      ].join("\n"),
    );
    repo.write(
      "functions/api/chat.js",
      [
        "import { logIt } from '../chat/logging.js';",
        "",
        "export async function onRequestPost(context) {",
        "    const { request, env } = context;",
        "    const { message, sessionId } = await request.json();",
        "    await env.CACHE.put(`c:${sessionId}`, message);",
        "    await fetch('https://api.openai.com/v1/responses', { headers: { key: env.OPENAI_API_KEY } });",
        "    await logIt({ db: env.CHAT_LOGS, sessionId });",
        "    return Response.json({ reply: 'ok', sessionId });",
        "}",
        "",
      ].join("\n"),
    );
    repo.write(
      "functions/chat/logging.js",
      ["export async function logIt({ db, sessionId }) {", "    await db.prepare('INSERT INTO chats (id) VALUES (?)').bind(sessionId).run();", "}", ""].join("\n"),
    );
    repo.commitAll("worker with a database, a cache, a secret and an idle namespace");
    local = contextFor(repo.root);
    const graph = buildGraph(repoPaths(repo.root));
    index = detectServices(repoPaths(repo.root), graph);
    flow = traceFlow(repoPaths(repo.root), graph, "sym:functions/api/chat.js#onRequestPost", { services: index.services });
  }, 60_000);

  it("puts the undeclared secret first, then the unused binding, then the shared writer", () => {
    const story = servicesStory(local, index);
    expect(sectionIds(story)).toEqual(["needs-attention", "talks-to", "secrets", "not-wired"]);
    const needs = sectionOf(story, "needs-attention").paragraphs;
    expect(needs[0]?.text).toContain("OPENAI_API_KEY");
    expect(needs[0]?.text).toContain("no manifest declares it");
    expect(needs[0]?.text).toContain("read in one place");
    expect(needs[0]?.refs).toContain("svc:secret:OPENAI_API_KEY");
    expect(needs.some((p) => p.text.includes("IDLE"))).toBe(true);
    // The unused binding is named in its own section too, with the line that declares it.
    const notWired = sectionOf(story, "not-wired").paragraphs;
    expect(notWired.map((p) => p.text).join("\n")).toContain("IDLE");
    expect(notWired[0]?.text).toMatch(/wrangler\.toml\|wrangler\.toml\]\] at line \d+/);
  });

  it("describes each service: what it is, where it is declared, who reads and who writes", () => {
    const story = servicesStory(local, index);
    const talks = sectionOf(story, "talks-to").paragraphs.map((p) => p.text);
    const db = talks.find((t) => t.includes("CHAT_LOGS"));
    expect(db).toContain("D1 database story-logs");
    expect(db).toContain("declared in");
    expect(db).toContain("wrangler.toml");
    expect(db).toContain("writes to it");
    // The write reached through a parameter is attributed to the file that performs it.
    expect(db).toContain("logging.js");
    const cache = talks.find((t) => t.includes("CACHE"));
    expect(cache).toContain("KV namespace");
    // Plain vars are collapsed into one list paragraph rather than a paragraph each.
    const vars = sectionOf(story, "talks-to").paragraphs.find((p) => p.id === "talks-to-vars");
    expect(vars?.kind).toBe("list");
    expect(vars?.text).toContain("GREETING");
  });

  it("says where a secret comes from without calling it declared", () => {
    const story = servicesStory(local, index);
    const secrets = sectionOf(story, "secrets").paragraphs;
    expect(secrets).toHaveLength(1);
    expect(secrets[0]?.text).toContain("OPENAI_API_KEY");
    expect(secrets[0]?.text).toContain("comes from outside the repo");
    expect(secrets[0]?.chips?.find((c) => c.label === "Declared")?.value).toBe("no");
  });

  it("carries refs, links and the paragraph contract on every services paragraph", () => {
    const story = servicesStory(local, index);
    expectParagraphContract(story);
    expectLinksWellFormed(story, local.repo);
    expect(story.crumbs.at(-1)?.route).toBe(`#/repo/${local.repo}/services`);
    expect(story.next[0]?.route).toBe(`#/repo/${local.repo}/flows`);
  });

  it("numbers every step and points each paragraph at its own step", () => {
    const story = flowStory(local, flow, { services: index.services });
    expect(sectionIds(story)).toEqual(["steps", "not-derivable"]);
    const steps = sectionOf(story, "steps").paragraphs;
    expect(steps).toHaveLength(flow.steps.length);
    expect(steps[0]?.text).toContain("Step one.");
    expect(steps[0]?.text).toContain("The request arrives at");
    // Rule 1 of the payload ladder, named as what it is.
    expect(steps[0]?.text).toContain("{ message, sessionId }");
    expect(steps[0]?.text).toContain("read from request.json()");
    steps.forEach((p, i) => {
      expect(p.refs).toContain(flow.steps[i]?.from);
      expect(p.refs).toContain(flow.steps[i]?.to);
    });
    expectParagraphContract(story);
    expectLinksWellFormed(story, local.repo);
  });

  it("names the service a step lands on and does not overstate a heuristic payload", () => {
    const story = flowStory(local, flow, { services: index.services });
    const texts = sectionOf(story, "steps").paragraphs.map((p) => p.text);
    const write = texts.find((t) => t.includes("CHAT_LOGS.prepare"));
    expect(write).toContain("writes to");
    expect(write).toContain("the D1 database story-logs");
    expect(write).toContain("arrived as the `db` parameter");
    expect(write).toContain("inferred rather than read off `env`");
    const put = texts.find((t) => t.includes("CACHE.put"));
    expect(put).toContain("a KV namespace");
    expect(put).toContain("writes to");
    for (const text of texts) {
      // A field list is never presented as data unless it was read from one.
      if (text.includes("field names taken from")) expect(text).toContain("not from the data");
    }
  });

  it("ends with what could not be derived, and why", () => {
    const story = flowStory(local, flow, { services: index.services });
    const gaps = sectionOf(story, "not-derivable");
    const text = gaps.paragraphs.map((p) => p.text).join("\n");
    expect(text).toContain("was found only by following a binding handed over as a parameter");
    expect(text).toContain("`db`");
    expect(gaps.paragraphs.every((p) => p.kind === "gap")).toBe(true);
    // Nothing was capped on a flow this small, so no truncation paragraph is invented.
    expect(flow.truncated).toBe(false);
    expect(text).not.toContain("The walk stopped short");
  });

  it("says what a cap dropped, at which hop, when one bites", () => {
    const shallow = traceFlow(repoPaths(repo.root), buildGraph(repoPaths(repo.root)), "sym:functions/api/chat.js#onRequestPost", { depth: 1, services: index.services });
    expect(shallow.truncated).toBe(true);
    const text = sectionOf(flowStory(local, shallow, { services: index.services }), "not-derivable")
      .paragraphs.map((p) => p.text)
      .join("\n");
    expect(text).toContain("The walk stopped short");
    expect(text).toContain("hop two");
  });

  it("links both pages from the repo story only when they have something on them", () => {
    const withPages = repoStory(local, { services: index, flows: [{ services: [] }] });
    const talks = sectionOf(withPages, "talks").paragraphs.map((p) => p.text).join("\n");
    expect(talks).toContain(`#/repo/${local.repo}/services|Services`);
    expect(talks).toContain(`#/repo/${local.repo}/flows|Data flow`);
    expect(talks).toContain("declared nowhere");
    expectLinksWellFormed(withPages, local.repo);

    const bare = sectionOf(repoStory(local), "talks");
    expect(bare.paragraphs.some((p) => p.text.includes("/services|Services"))).toBe(false);
  });

  it("routes a service id to the services page and a flow step's symbol to its file", () => {
    expect(routeFor("r", "svc:kv:CACHE")).toBe("#/repo/r/services?service=svc%3Akv%3ACACHE");
    expect(routeFor("r", "flow:api-chat")).toBe("#/repo/r/flow/api-chat");
    expect(routeFor("r", "sym:functions/api/chat.js#onRequestPost")).toBe("#/repo/r/file/functions/api/chat.js?symbol=onRequestPost");
    // The graph's own `::` symbol ids are untouched.
    expect(routeFor("r", "sym:src/a.ts::thing")).toBe("#/repo/r/symbol/src/a.ts::thing");
  });
});
