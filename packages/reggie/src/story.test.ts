import { readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { makeFixtureRepo, type FixtureRepo } from "../test/fixtures.js";
import { makeTempRepo, type TempRepo } from "../test/helpers.js";
import { addNote } from "./notes.js";
import { buildGraph, type RepoGraph } from "./graph.js";
import { repoHistory } from "./history.js";
import { briefFile, repoPaths } from "./paths.js";
import { loadConfig } from "./people.js";
import { detectServices, type ServiceIndex } from "./services.js";
import { buildSemanticIndex, type SemanticIndex } from "./semantic-index.js";
import { traceFlow, type Flow } from "./flows.js";
import {
  EMPTY_TEXT,
  areaStory,
  buildStoryContext,
  countPhrase,
  coverageSentence,
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
import { writeText } from "./util.js";
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

/** The ids of the sections whose empty state is an inline note form, in page order. */
function noteFormSections(story: Story): string[] {
  return story.sections.filter((s) => s.empty?.action?.form === "note").map((s) => s.id);
}

/**
 * `noteEntityFor` from ui/story.js, reimplemented here so the test can prove that every note form
 * on a page resolves to one entity. The client derives it from the story, never from the section,
 * which is what makes two forms on a page harmless.
 */
function noteEntityFor(story: Story): string | null {
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
  const levels: Record<string, string> = { area: "area", file: "file", symbol: "symbol", route: "route", concept: "concept", task: "task", person: "person", tasks: "tasks", people: "people", time: "time", services: "services", flows: "flows", flow: "flow" };
  const level = kind ? levels[kind] : undefined;
  if (!level) return { ...out, level: "unknown", repo };
  return { ...out, level, repo, id: rest || null };
}

/** Every link in every paragraph parses, names this repo, and has a non-empty label. */
function expectLinksWellFormed(story: Story, repo: string): void {
  const texts = [
    ...allParagraphs(story).flatMap((p) => [p.text, p.flowStep?.technical].filter((text): text is string => Boolean(text))),
    ...story.sections.flatMap((s) => (s.empty?.action?.route ? [s.empty.action.route] : [])),
  ];
  let seen = 0;
  for (const text of texts) {
    // No half-open markup anywhere.
    expect(text.split("[[").length, `unbalanced [[ in: ${text}`).toBe(text.split("]]").length);
    for (const { route, label } of parseLinks(text)) {
      seen += 1;
      expect(label.trim().length, `empty label in: ${text}`).toBeGreaterThan(0);
      expect(route.startsWith("#/"), `route is not a hash route: ${route}`).toBe(true);
      const parsed = parseRoute(route);
      expect(["repo", "area", "file", "symbol", "route", "concept", "task", "tasks", "person", "workspace", "services", "flows", "flow"], `unparseable route ${route}`).toContain(parsed.level);
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
    expect(["fact", "note", "journal", "gap", "commit", "decision", "list", "flow-step"]).toContain(p.kind);
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
    expect(routeFor("reggie", "sym:src/a.ts::buildGraph")).toBe("#/repo/reggie/symbol/sym:src/a.ts::buildGraph");
    expect(routeFor("reggie", "route:POST:/api/chat")).toBe("#/repo/reggie/route/route:POST:/api/chat");
    expect(routeFor("reggie", "concept:session-id")).toBe("#/repo/reggie/concept/concept:session-id");
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
    expect(sectionIds(repoStory(ctx))).toEqual(["needs-you", "what", "made-of", "starts", "talks", "flight", "recent", "gaps", "run", "add-note"]);
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

  it("uses the repo name in the header and carries no subtitle", () => {
    const story = repoStory(ctx);
    expect(story.title).toBe(ctx.repo);
    expect(story.subtitle).toBeNull();
    expect(story.crumbs[0]?.route).toBe("#/ws");
    expect(sectionOf(story, "what").heading).toBe("About this repo");
  });

  it("shows the repo note's why entries as prose under About this repo and its other entries under How to run it", () => {
    const story = repoStory(ctx);
    const what = sectionOf(story, "what").paragraphs;
    expect(what.length).toBeGreaterThan(0);
    for (const p of what) {
      expect(p.kind).toBe("fact");
      expect(p.source?.entity).toBe("_repo");
      expect(p.source?.type).toBe("why");
    }
    expect(what[0]?.chips?.map((c) => c.label)).toEqual(["Branch"]);
    expect(what[1]?.chips).toBeUndefined();
    const run = sectionOf(story, "run").paragraphs.filter((p) => p.kind === "note");
    expect(run.length).toBeGreaterThan(0);
    expect(run.every((p) => p.source?.entity === "_repo" && p.source?.type !== "why")).toBe(true);
    expect(run.some((p) => p.text.includes("npm test"))).toBe(true);
    expect(sectionOf(story, "what").paragraphs.some((p) => p.text.includes("npm test"))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Area scope
// ---------------------------------------------------------------------------

describe("areaStory", () => {
  it("emits every section id from the contract", () => {
    const story = areaStory(ctx, "src/big");
    expect(story).not.toBeNull();
    expect(sectionIds(story!)).toEqual(["read-first", "inside", "uses", "used-by", "tests", "people", "tasks", "recent", "add-note"]);
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
// The add-note section, at every scope it is emitted at
// ---------------------------------------------------------------------------

/**
 * A mutation-tested pin, not a smoke test. Delete the `addNoteSection` call from `repoStory` or from
 * `areaStory` and named tests in this block fail along with the exact-array assertions above.
 *
 * What it holds: the section exists at all three scopes, it is always empty and therefore always a
 * form, it carries non-empty empty text at every scope (the client drops an empty section that has no
 * empty block, so a section with zero paragraphs and no text would vanish from the page while this
 * file still saw its id), and the command it prints names an entity `reggie note add` accepts.
 */
describe("the add-note section", () => {
  const knowledge = (): StoryContext =>
    buildStoryContext(fixture.paths, fixture.config, ctx.graph, ctx.history, { lens: "knowledge", journal: ctx.journal, notes: ctx.notes, tasks: ctx.tasks });

  const scopes = (c: StoryContext): [string, Story][] => [
    ["repo", repoStory(c)],
    ["area", areaStory(c, "src/big")!],
    ["file", fileStory(c, "src/big/a02.ts")!],
  ];

  it("is present and is a form at repo, area and file scope", () => {
    for (const [scope, story] of scopes(ctx)) {
      const add = sectionOf(story, "add-note");
      expect(add.heading, scope).toBe("Add a note");
      expect(add.paragraphs, scope).toHaveLength(0);
      expect(add.empty?.action?.form, scope).toBe("note");
    }
  });

  it("carries non-empty empty text at every scope, so the client cannot drop it", () => {
    // `renderSection` returns null for a section with no paragraphs and no `empty` block, and
    // `section()` only attaches `empty` when one is passed. This section is empty at every scope by
    // construction, so its empty text is the only thing keeping it on the page.
    for (const [scope, story] of scopes(ctx)) {
      const text = sectionOf(story, "add-note").empty?.text;
      expect(text, scope).toBeTruthy();
      expect((text ?? "").trim().length, scope).toBeGreaterThan(0);
    }
  });

  it("names its scope in the empty text, and keeps the file sentence as it was", () => {
    const text = (story: Story) => sectionOf(story, "add-note").empty?.text;
    expect(text(repoStory(ctx))).toBe("Write what the next person should know about this repo.");
    expect(text(areaStory(ctx, "src/big")!)).toBe("Write what the next person should know about this area.");
    expect(text(fileStory(ctx, "src/big/a02.ts")!)).toBe("Write what the next person should know about this file.");
    // The three sentences come from EMPTY_TEXT and nowhere else.
    expect(EMPTY_TEXT.addNoteRepo).toBe(text(repoStory(ctx)));
    expect(EMPTY_TEXT.addNoteArea).toBe(text(areaStory(ctx, "src/big")!));
    expect(EMPTY_TEXT.addNoteFile).toBe(text(fileStory(ctx, "src/big/a02.ts")!));
  });

  it("hints --type why at every scope, so the copied command matches what the form posts", () => {
    // `noteForm` in ui/story.js reads `opts.type ?? "why"` and `emptyBlock` passes no opts, so the
    // rendered select always posts `why`. A hint saying anything else disagrees with its own button.
    for (const [scope, story] of scopes(ctx)) {
      expect(sectionOf(story, "add-note").empty?.action?.command, scope).toContain('--type why "…"');
    }
  });

  it("spells the note entity the way `reggie note add` accepts it, including at the repo root", () => {
    const hint = (story: Story) => sectionOf(story, "add-note").empty?.action?.command;
    expect(hint(repoStory(ctx))).toBe('reggie note add _repo --type why "…"');
    expect(hint(areaStory(ctx, "src/big")!)).toBe('reggie note add src/big/ --type why "…"');
    expect(hint(fileStory(ctx, "src/big/a02.ts")!)).toBe('reggie note add src/big/a02.ts --type why "…"');

    // The repo root is reachable as an area page, and there the entity is `_repo`, not `./`.
    const root = areaStory(ctx, ".");
    expect(root, "the repo root is a real area page").not.toBeNull();
    expect(root!.id).toBe(".");
    expect(hint(root!)).toBe('reggie note add _repo --type why "…"');
  });

  it("is written once: the area hint and the read-first empty state agree on the entity", () => {
    // Both read `areaNoteEntity`, so a folder can never be offered two spellings of its own note.
    for (const dir of ["src/big", "src/types", "."]) {
      const story = areaStory(ctx, dir);
      expect(story, dir).not.toBeNull();
      const add = sectionOf(story!, "add-note").empty?.action?.command;
      const readFirst = sectionOf(story!, "read-first").empty?.action?.command;
      // read-first only carries an action while it is empty; when it does, it must match.
      if (readFirst) expect(readFirst, dir).toBe(add);
      expect(add, dir).toBe(`reggie note add ${dir === "." ? "_repo" : `${dir}/`} --type why "…"`);
    }
  });

  it("is last at every scope in the default lens, and leaves gaps last under the knowledge lens", () => {
    expect(sectionIds(repoStory(ctx)).at(-1)).toBe("add-note");
    expect(sectionIds(areaStory(ctx, "src/big")!).at(-1)).toBe("add-note");
    expect(sectionIds(fileStory(ctx, "src/big/a02.ts")!).at(-1)).toBe("add-note");

    const k = knowledge();
    // The repo has no lens push, so add-note stays last there.
    expect(sectionIds(repoStory(k))).toEqual(["needs-you", "what", "made-of", "starts", "talks", "flight", "recent", "gaps", "run", "add-note"]);
    // Area and file append gaps after the base list, so gaps stays last and add-note sits before it.
    expect(sectionIds(areaStory(k, "src/big")!)).toEqual(["read-first", "inside", "uses", "used-by", "tests", "people", "tasks", "recent", "add-note", "gaps"]);
    expect(sectionIds(fileStory(k, "src/big/a02.ts")!)).toEqual(["read-first", "exports", "used-by", "uses", "tests", "tasks", "history", "add-note", "gaps"]);
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

  it("explains an ungroomed task from what was written, instead of ten empty plan sections", () => {
    const story = taskStory(ctx, fixture.slugs.ungroomed)!;
    expect(sectionIds(story)).toEqual(["state", "written", "lives", "known", "resembles", "unclear", "next", "journal"]);
    const written = sectionOf(story, "written");
    expect(written.paragraphs[0]?.text).toContain("Split the big area into two packages");
    expect(written.paragraphs[0]?.text).toContain("wrote this down on");
    expect(written.paragraphs.some((p) => p.text.includes("no detail under the line"))).toBe(true);
    // "big" and "packages" are words in the line; src/big/ carries one of them.
    const lives = sectionOf(story, "lives");
    expect(lives.paragraphs[0]?.text).toContain("src/big");
    expect(lives.paragraphs[0]?.text).toContain("name match, not an understanding");
    expect(lives.paragraphs[0]?.refs).toContain("dir:src/big/");
    const known = sectionOf(story, "known");
    expect(known.paragraphs.some((p) => p.text.includes("chain must stay in order"))).toBe(true);
    const unclear = sectionOf(story, "unclear");
    expect(unclear.paragraphs[0]?.kind).toBe("list");
    expect(unclear.paragraphs[0]?.text).toContain("Why it matters now");
    expect(sectionOf(story, "next").paragraphs[0]?.text).toContain(`reggie launch ${fixture.slugs.ungroomed} --run`);
    expect(JSON.stringify(story)).not.toContain("No plan yet");
    expectParagraphContract(story);
    expectLinksWellFormed(story, ctx.repo);
  });

  it("tells a groomed task's story from its brief", () => {
    const slug = fixture.slugs.ungroomed;
    writeText(briefFile(fixture.paths, slug), [
      "---",
      `slug: ${slug}`,
      "title: Split the big area into two packages",
      "area: src/big",
      "size: medium",
      "risk: low",
      "priority: P2",
      "author: test",
      "created: 2026-09-13",
      "---",
      "# Split the big area into two packages",
      "",
      "## Problem",
      "The big area is one forty-five file chain and nobody can tell where a change lands.",
      "",
      "## Why now",
      "Two agents collided in it last week.",
      "",
      "## Suspected area",
      "- src/big/ because the chain lives there",
      "",
      "## Open questions",
      "- Should the split follow the chain order or the shape importers?",
      "",
      "## Not this",
      "- Renaming the files; that is a separate task.",
      "",
    ].join("\n"));
    try {
      const story = taskStory(contextFor(fixture.repo.root), slug)!;
      expect(sectionIds(story)).toEqual(["state", "ask", "why-now", "area", "questions", "not-this", "next", "journal"]);
      expect(sectionOf(story, "ask").paragraphs[0]?.text).toContain("nobody can tell where a change lands");
      expect(sectionOf(story, "ask").paragraphs[0]?.chips?.map((c) => c.value)).toEqual(["P2", "medium", "low", "src/big"]);
      expect(sectionOf(story, "area").paragraphs[0]?.refs).toContain("dir:src/big/");
      expect(sectionOf(story, "questions").paragraphs[0]?.text).toContain("chain order");
      expect(sectionOf(story, "next").paragraphs[0]?.text).toContain("one question is still open");
      expectParagraphContract(story);
      expectLinksWellFormed(story, ctx.repo);
    } finally {
      rmSync(briefFile(fixture.paths, slug), { force: true });
    }
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
// The tests clause, at the three sites that print it
// ---------------------------------------------------------------------------

/**
 * Three purpose-built areas, one per case the clause has to get right: an area whose source files
 * are imported by a test, an area whose only non-source file is a config file, and an area of
 * source files and nothing else. The middle one is the point of the fixture. The clause used to be
 * guarded by `files > source`, which is true of any area holding anything that is not source, so
 * a folder with a config file and no test at all announced that it had tests. A `tsconfig.json`
 * will not reproduce that: `.json` is not a scanned extension and never reaches the graph, so the
 * config case has to be a config file with a code extension.
 */
describe("the tests clause", () => {
  /**
   * The retired wording, named once so the repo holds exactly one copy of it. The phrase sweep in
   * this task's acceptance criteria greps for it; this constant is the only live reference left.
   */
  const OLD_WORDING = "with tests";
  /** The clause in either wording, plus the link only the clause ever emits. None may appear. */
  const NO_CLAUSE = new RegExp(`of them tested|${OLD_WORDING}|lens=tests`);
  let local: StoryContext;

  beforeAll(() => {
    const repo = makeTempRepo("reggie-story-clause-");
    cleanups.push(repo);
    // covered/: three source files, each imported by the one test file.
    for (let i = 1; i <= 3; i += 1) repo.write(`covered/c${i}.ts`, `export const c${i} = ${i};\n`);
    repo.write(
      "covered/__tests__/covered.test.ts",
      ['import { c1 } from "../c1.js";', 'import { c2 } from "../c2.js";', 'import { c3 } from "../c3.js";', "", "export const seen = [c1, c2, c3];", ""].join("\n"),
    );
    // configured/: three source files and one config file. No test anywhere in it.
    for (let i = 1; i <= 3; i += 1) repo.write(`configured/g${i}.ts`, `export const g${i} = ${i};\n`);
    repo.write("configured/vitest.config.ts", "export default { test: {} };\n");
    // plain/: three source files and nothing else.
    for (let i = 1; i <= 3; i += 1) repo.write(`plain/p${i}.ts`, `export const p${i} = ${i};\n`);
    repo.commitAll("one tested area, one config-only area, one source-only area");
    local = contextFor(repo.root);
  }, 120_000);

  const aggOf = (area: string) => {
    const agg = local.node(`dir:${area}/`)?.aggregates;
    expect(agg, `no aggregates for ${area}`).toBeDefined();
    return agg!;
  };

  /** Site 1: the repo page's "What it is made of" paragraph for one area. */
  function madeOf(area: string): string {
    const found = sectionOf(repoStory(local), "made-of").paragraphs.find((p) => p.text.includes(`|${area}]]`));
    expect(found, `no made-of paragraph for ${area}`).toBeDefined();
    return found!.text;
  }
  /** Site 2: the area page's subtitle. */
  const subtitleOf = (area: string) => areaStory(local, area)?.subtitle ?? "";
  /** Site 3: the first of the four Spotlight sentences for the container. */
  const spotlightOf = (area: string) => explain(local, `dir:${area}/`)?.sentences[0]?.text ?? "";

  it("names the tested-source count at all three sites when source files are tested", () => {
    const agg = aggOf("covered");
    expect([agg.source, agg.testedSource]).toEqual([3, 3]);
    expect(madeOf("covered")).toContain("three of them tested");
    expect(subtitleOf("covered")).toBe("TypeScript area, three source files, three of them tested.");
    expect(spotlightOf("covered")).toContain("three source files, three of them tested,");
  });

  it("makes the clause in the made-of paragraph a link to the tests lens", () => {
    expect(madeOf("covered")).toContain(`[[${routeFor(local.repo, "dir:covered/", { lens: "tests" })}|three of them tested]]`);
  });

  it("says nothing about tests when the only non-source file is a config file", () => {
    const agg = aggOf("configured");
    expect([agg.source, agg.config, agg.testedSource]).toEqual([3, 1, 0]);
    // The condition the old guard tripped on. It is still true here; it just no longer says anything.
    expect(agg.files).toBeGreaterThan(agg.source);
    expect(subtitleOf("configured")).toBe("TypeScript area, three source files.");
    for (const text of [madeOf("configured"), subtitleOf("configured"), spotlightOf("configured")]) {
      expect(text, text).not.toMatch(NO_CLAUSE);
    }
  });

  it("says nothing about tests in an area of source files only", () => {
    const agg = aggOf("plain");
    expect([agg.source, agg.files, agg.testedSource]).toEqual([3, 3, 0]);
    expect(subtitleOf("plain")).toBe("TypeScript area, three source files.");
    for (const text of [madeOf("plain"), subtitleOf("plain"), spotlightOf("plain")]) {
      expect(text, text).not.toMatch(NO_CLAUSE);
    }
  });

  it("prints one wording at every site, and never more tested than source", () => {
    for (const area of ["covered", "configured", "plain"]) {
      const agg = aggOf(area);
      expect(agg.testedSource, area).toBeLessThanOrEqual(agg.source);
      const clause = agg.testedSource > 0 ? `${numberWord(agg.testedSource)} of them tested` : null;
      for (const text of [madeOf(area), subtitleOf(area), spotlightOf(area)]) {
        if (clause) expect(text, text).toContain(clause);
        else expect(text, text).not.toContain("of them tested");
        expect(text, text).not.toContain(OLD_WORDING);
      }
    }
  });

  it("names the same count as the area's own Tests section, which is the fixed point", () => {
    expect(sectionOf(areaStory(local, "covered")!, "tests").paragraphs[0]?.text).toBe("one test file covers three of three source files.");
    expect(subtitleOf("covered")).toContain("three of them tested");
  });
});

// ---------------------------------------------------------------------------
// Empty inputs: every section states its absence in the spec's words
// ---------------------------------------------------------------------------

describe("a repo with a description but no why note", () => {
  it("falls back to the package description as the empty text of About this repo", () => {
    const repo = makeTempRepo("reggie-story-desc-");
    cleanups.push(repo);
    repo.write("package.json", JSON.stringify({ name: "described", description: "A described repo.", scripts: { test: "vitest" } }));
    repo.write("src/a.ts", "export const a = 1;\n");
    repo.commitAll("described");
    addNote(repoPaths(repo.root), "_repo", { type: "how", text: "Run npm test.", author: "test", confidence: "high" });
    const story = repoStory(contextFor(repo.root));
    const what = sectionOf(story, "what");
    expect(what.paragraphs).toEqual([]);
    expect(what.empty?.text).toBe("A described repo.");
    expect(what.empty?.action?.form).toBe("note");
    expect(sectionOf(story, "run").paragraphs.some((p) => p.kind === "note" && p.text === "Run npm test.")).toBe(true);
  });

  it("shows the repo two note forms and the area one, because only `why` fills About this repo", () => {
    // The reverse mismatch of the onboarding state: `whatSection` counts only `why` entries, so a
    // `_repo` note of `how` entries leaves the repo page with its empty-state form while every area
    // page in the same repo is filled by that same note and has none. Both pages have add-note.
    const repo = makeTempRepo("reggie-story-howonly-");
    cleanups.push(repo);
    repo.write("src/big/a01.ts", 'import { b } from "./a02.js";\nexport const a = () => b() + 1;\n');
    repo.write("src/big/a02.ts", "export const b = () => 2;\n");
    repo.commitAll("how only");
    addNote(repoPaths(repo.root), "_repo", { type: "how", text: "Run npm test.", author: "test", confidence: "high" });
    const c = contextFor(repo.root);

    const story = repoStory(c);
    expect(sectionOf(story, "what").paragraphs).toEqual([]);
    expect(noteFormSections(story), "the repo keeps its empty-state form and gains add-note").toEqual(["what", "add-note"]);

    const area = areaStory(c, "src/big")!;
    expect(sectionOf(area, "read-first").paragraphs.length, "the how note fills the area chain").toBeGreaterThan(0);
    expect(noteFormSections(area), "add-note is the area's only note form").toEqual(["add-note"]);
  });
});

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

  it("offers two note forms on each page, both writing to the same entity", () => {
    // Nothing has been written, so the empty state above and the always-present section below are
    // both forms. That is accepted rather than designed around: the client takes the entity from
    // the story's scope and id (`noteEntityFor`) and not from the section, so the two forms on a
    // page are the same form twice and the Spotlight's jump cannot mis-target.
    const repo = repoStory(bare);
    expect(noteFormSections(repo)).toEqual(["what", "add-note"]);
    expect(noteEntityFor(repo)).toBe("_repo");
    expect(sectionOf(repo, "add-note").empty?.action?.command).toBe('reggie note add _repo --type why "…"');

    const area = areaStory(bare, "src")!;
    expect(noteFormSections(area)).toEqual(["read-first", "add-note"]);
    expect(noteEntityFor(area)).toBe("src/");
    expect(sectionOf(area, "add-note").empty?.action?.command).toBe('reggie note add src/ --type why "…"');
    // Both of the area's forms print the same command, so neither can send the reader elsewhere.
    expect(sectionOf(area, "read-first").empty?.action?.command).toBe(sectionOf(area, "add-note").empty?.action?.command);
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

describe("the state `reggie onboard` leaves: one `_repo` note with a `why` entry", () => {
  let onboarded: StoryContext;

  beforeAll(() => {
    const repo = makeTempRepo("reggie-story-onboarded-");
    cleanups.push(repo);
    repo.write("src/big/a01.ts", 'import { b } from "./a02.js";\nexport const a = () => b() + 1;\n');
    repo.write("src/big/a02.ts", "export const b = () => 2;\n");
    repo.commitAll("onboarded");
    addNote(repoPaths(repo.root), "_repo", { type: "why", text: "This repo exists to hold the chained files.", author: "test", confidence: "high" });
    onboarded = contextFor(repo.root);
  }, 60_000);

  it("leaves add-note as the only note form on the repo page and on every area page", () => {
    // This is the common case, not an exotic one: one repo-level note fills the read-first section of
    // every area in the repo at once, because `noteChain` starts at `_repo`. Before this section
    // existed, that meant no area page in a set-up repo had a note form at all.
    expect(noteFormSections(repoStory(onboarded))).toEqual(["add-note"]);
    const area = areaStory(onboarded, "src/big")!;
    expect(noteFormSections(area)).toEqual(["add-note"]);
    expect(sectionOf(area, "add-note").empty?.action?.command).toBe('reggie note add src/big/ --type why "…"');
  });

  it("says no note is written on the folder and offers a form for that folder in the same payload", () => {
    // The gap sentence and the form that answers it have to arrive together; the sentence on its own
    // is the page telling the reader something is missing and giving them no way to supply it.
    const area = areaStory(onboarded, "src/big")!;
    const readFirst = sectionOf(area, "read-first");
    const gap = readFirst.paragraphs.find((p) => p.kind === "gap");
    expect(gap, "the inherited-only chain prints the gap sentence").toBeDefined();
    expect(gap!.text).toContain("No note is written on");
    expect(gap!.text).toContain("itself; everything above is inherited from the repo and the folders around it.");
    expect(sectionOf(area, "add-note").empty?.action?.command).toContain("reggie note add src/big/");
  });
});

describe("a repo with no code files", () => {
  it("still offers the repo page a note form, and has no area page below the root", () => {
    // `makeTempRepo` commits only a README, so the graph has no code files and no area nodes under
    // the root. Measured, not assumed: the root itself IS still reachable as an area page, so the
    // claim is that every path below it is null, not that every path is.
    const repo = makeTempRepo("reggie-story-nocode-");
    cleanups.push(repo);
    const c = contextFor(repo.root);

    const story = repoStory(c);
    const add = sectionOf(story, "add-note");
    expect(add.paragraphs).toHaveLength(0);
    expect(add.empty?.text).toBe(EMPTY_TEXT.addNoteRepo);
    expect(add.empty?.action?.form).toBe("note");
    expect(add.empty?.action?.command).toBe('reggie note add _repo --type why "…"');

    for (const p of ["src", "src/big", "doc", "packages/reggie"]) expect(areaStory(c, p), p).toBeNull();

    // The root reached as an area page is the one area that survives, and it says `_repo` too.
    const root = areaStory(c, ".");
    expect(root).not.toBeNull();
    expect(sectionOf(root!, "add-note").empty?.action?.command).toBe('reggie note add _repo --type why "…"');
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
  let semanticIndex: SemanticIndex;
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
    semanticIndex = buildSemanticIndex(repoPaths(repo.root), graph);
    flow = traceFlow(repoPaths(repo.root), graph, "sym:functions/api/chat.js::onRequestPost", { services: index.services, semanticIndex });
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
    const story = flowStory(local, flow, { services: index.services, index: semanticIndex });
    expect(sectionIds(story)).toEqual(["steps", "not-derivable"]);
    const steps = sectionOf(story, "steps").paragraphs;
    expect(steps).toHaveLength(flow.steps.length);
    expect(steps[0]?.kind).toBe("flow-step");
    expect(steps[0]?.flowStep?.number).toBe(1);
    expect(steps[0]?.flowStep?.summary).toContain("endpoint hands the request");
    expect(steps[0]?.flowStep?.technical).toContain("route:POST:/api/chat");
    expect(steps[0]?.flowStep?.technical).toContain("POST /api/chat");
    expect(steps[0]?.flowStep?.technical).toContain("onRequestPost");
    expect(steps[0]?.flowStep?.technical).toContain("functions/api/chat.js");
    expect(steps[0]?.flowStep?.technical).not.toContain("line ");
    expect(steps[0]?.flowStep?.inputs[0]?.label).toBe("Request payload");
    expect(steps[0]?.flowStep?.inputs[0]?.shape?.fields.map((field) => field.name)).toEqual(["message", "sessionId"]);
    steps.forEach((p, i) => {
      expect(p.flowStep?.number).toBe(i + 1);
      expect(p.refs).toContain(flow.steps[i]?.from);
      expect(p.refs).toContain(flow.steps[i]?.to);
    });
    expectParagraphContract(story);
    expectLinksWellFormed(story, local.repo);
  });

  it("names the service a step lands on and does not overstate a heuristic payload", () => {
    const story = flowStory(local, flow, { services: index.services, index: semanticIndex });
    const steps = sectionOf(story, "steps").paragraphs;
    const write = steps.find((paragraph) => paragraph.flowStep?.calleeId === "svc:database:CHAT_LOGS");
    expect(write?.flowStep?.summary).toContain("writes data to CHAT_LOGS");
    expect(write?.flowStep?.technical).toContain("CHAT_LOGS");
    expect(write?.flowStep?.technical).toContain("logging.js");
    expect(write?.flowStep?.technical).not.toContain("line ");
    expect(write?.flowStep?.inputs.some((input) => input.label === "Service payload")).toBe(true);
    expect(write?.chips?.find((item) => item.label === "Confidence")?.value).toBe("heuristic");
    const put = steps.find((paragraph) => paragraph.flowStep?.calleeId === "svc:kv:CACHE");
    expect(put?.flowStep?.summary).toContain("writes data to CACHE");
    expect(put?.flowStep?.calleeSummary).toContain("KV namespace");
  });

  it("ends with what could not be derived, and why", () => {
    const story = flowStory(local, flow, { services: index.services, index: semanticIndex });
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
    const shallow = traceFlow(repoPaths(repo.root), buildGraph(repoPaths(repo.root)), "sym:functions/api/chat.js::onRequestPost", { depth: 1, services: index.services, semanticIndex });
    expect(shallow.truncated).toBe(true);
    const text = sectionOf(flowStory(local, shallow, { services: index.services, index: semanticIndex }), "not-derivable")
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
    expect(routeFor("r", "sym:functions/api/chat.js::onRequestPost")).toBe("#/repo/r/symbol/sym:functions/api/chat.js::onRequestPost");
    // The graph's own `::` symbol ids are untouched.
    expect(routeFor("r", "sym:src/a.ts::thing")).toBe("#/repo/r/symbol/sym:src/a.ts::thing");
  });
});


// ---------------------------------------------------------------------------
// The coverage sentence: how much of the repo the page is a picture of
// ---------------------------------------------------------------------------

/**
 * The made-of section is an inventory of the files the import graph could read, and until this
 * paragraph existed a repo Reggie read in full and a repo it read a tenth of rendered identically.
 *
 * The wording is pinned by a table over the exported helper, because the branches that matter are
 * the degenerate ones — a repo with no code the graph reads, a repo with one file, a repo with a
 * long tail of skipped languages — and standing a git repo up for each of those costs most of a
 * second to assert one string. The wiring from graph to view to story is pinned separately, on the
 * shared fixture context that every other test in this file already shares.
 */
describe("coverageSentence", () => {
  const css = (files: number) => ({ language: "CSS", files });
  const html = (files: number) => ({ language: "HTML", files });
  const shell = (files: number) => ({ language: "Shell", files });

  const CASES: [name: string, read: number, skipped: { language: string; files: number }[], unresolved: number, expected: string | null][] = [
    ["everything read, every path followed", 12, [], 0, "Reggie read all 12 code files in this repo and followed every import written as a path."],
    // Agreement at one: `numberWord` alone would render "all one code files".
    ["a one-file repo", 1, [], 0, "Reggie read all one code file in this repo and followed every import written as a path."],
    // Nothing to be a picture of: the section's own empty paragraph already says so.
    ["no code files at all", 0, [], 0, null],
    ["no code files, nothing skipped, a broken path", 0, [], 2, null],
    // "none of", not `numberWord(0)`'s "no", which would read "Reggie read no of this repo's…".
    // This is the repo the feature exists for: a Go service, a Swift app, a static site.
    ["a repo in languages the graph does not read", 0, [html(9), css(3)], 0, "Reggie read none of this repo's 12 code files, skipping nine HTML files and three CSS files, and followed every import written as a path."],
    ["this repo's own numbers", 86, [css(5), html(5), shell(1)], 2, "Reggie read 86 of this repo's 97 code files, skipping five CSS files, five HTML files and one Shell file; two imports pointed at no file, so the map is missing those connections."],
    ["one broken path, singular", 40, [], 1, "Reggie read all 40 code files in this repo; one import pointed at no file, so the map is missing those connections."],
    // At most three named, in the order given, and the tail folded into one clause.
    [
      "more skipped languages than it will name",
      2,
      [css(4), html(3), shell(2), { language: "Python", files: 1 }, { language: "SQL", files: 1 }],
      0,
      "Reggie read two of this repo's 13 code files, skipping four CSS files, three HTML files, two Shell files and two files in two other languages, and followed every import written as a path.",
    ],
    ["exactly three skipped languages, nothing folded", 5, [css(2), html(1), shell(1)], 0, "Reggie read five of this repo's nine code files, skipping two CSS files, one HTML file and one Shell file, and followed every import written as a path."],
    ["one skipped language, one file", 5, [shell(1)], 0, "Reggie read five of this repo's six code files, skipping one Shell file, and followed every import written as a path."],
  ];

  it.each(CASES)("%s", (_name, read, skipped, unresolved, expected) => {
    expect(coverageSentence(read, skipped, unresolved)).toBe(expected);
  });

  it("never shows the reader the word unresolved", () => {
    for (const [, read, skipped, unresolved] of CASES) {
      expect(coverageSentence(read, skipped, unresolved) ?? "").not.toMatch(/unresolved/i);
    }
  });

  it("does not claim to have followed imports it cannot see", () => {
    // `unresolved` counts only specifiers written as a path; an alias the resolver could not follow
    // is dropped with no edge and no count, so the affirmative clause has to say what it ranges over.
    expect(coverageSentence(4, [], 0)).toContain("followed every import written as a path");
    expect(coverageSentence(4, [], 0)).not.toContain("followed every import.");
  });
});

/** The wiring: the same sentence, reached through a real graph, view and story. */
describe("the coverage paragraph on the repo page", () => {
  it("is the first paragraph, has its own id, and leaves the area paragraphs where they were", () => {
    const section = sectionOf(repoStory(ctx), "made-of");
    const first = section.paragraphs[0];
    expect(first?.id).toBe("made-of-coverage");
    expect(first?.kind).toBe("fact");
    // The area paragraphs keep their own numbering from 1, so nothing that reads an id shifts.
    expect(section.paragraphs.slice(1).map((p) => p.id)).toEqual(section.paragraphs.slice(1).map((_, i) => `made-of-${i + 1}`));
    expect(section.paragraphs.filter((p) => p.id === "made-of-coverage")).toHaveLength(1);
  });

  it("carries refs the map can resolve, so scrolling into the section does not blank the halo", () => {
    const first = sectionOf(repoStory(ctx), "made-of").paragraphs[0];
    const areas = ctx.views.container().areas.map((a) => a.id);
    expect(first?.refs[0]).toBe(`repo:${ctx.repo}`);
    // Every Level-1 area, in the section's own order; the map can resolve these, a `repo:` id alone
    // resolves to nothing on a container canvas and would clear the halo rather than move it.
    expect([...(first?.refs ?? [])].slice(1).sort()).toEqual([...areas].sort());
    expect(areas.length).toBeGreaterThan(0);
  });

  it("renders the fixture's own numbers, which are not zero", () => {
    const first = sectionOf(repoStory(ctx), "made-of").paragraphs[0];
    const counts = ctx.views.container().counts;
    expect(counts.skipped.length).toBeGreaterThan(0);
    expect(first?.text).toBe(coverageSentence(counts.totalCodeFiles, counts.skipped, counts.unresolved));
    expect(first?.text).toMatch(/^Reggie read \d+ of this repo's \d+ code files, skipping /);
  });
});
