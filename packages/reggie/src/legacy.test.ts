import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { extractTags, parseFileList, parseLegacyBacklog, readLegacy, type LegacyItem } from "./legacy.js";
import { repoPaths } from "./paths.js";
import { loadConfig } from "./people.js";
import { listTasks } from "./tasks.js";
import { git } from "./git.js";
import { makeTempRepo, type TempRepo } from "../test/helpers.js";

/** A blank item, so extractTags can be exercised without building a whole line. */
function blank(): LegacyItem {
  return {
    slug: "x",
    title: "",
    description: "",
    done: false,
    section: [],
    ungroomed: false,
    priority: "unset",
    size: "unset",
    sizeWord: null,
    kinds: [],
    planned: false,
    parked: false,
    depends: [],
    conflicts: [],
    tier: null,
    files: [],
    completedAt: null,
    source: "tasks",
    file: "TASKS.md",
    line: 1,
    initiative: null,
  };
}

const BACKLOG = `# Tasks

## Backlog

### Chatbot — Core Experience

> Tile-family initiative (groomed 2026-07-21): expand first, refine last.

- [ ] wrap-rail-pills: Pills wrap instead of clipping on a narrow shelf [P1] [moderate] [code] [planned] [tier: opus:high] [depends: pin-context-docs] [conflicts: seat-the-card]
  files: src/Rail.js (MOD), src/Rail.css (MOD), src/__tests__/rail.test.js (NEW)
- [x] pin-context-docs: **DONE 2026-09-05** (commit f9a66dc). Pinned pills become guarantees [P2] [simple] [code]

### Ungroomed

#### Surfaced 2026-08-27 (a triage session)
- [ ] audit-unmounted-components: Three component folders exist but nothing mounts them [P3] [code]
`;

const HISTORY = `# Completed Tasks
- [x] shorten-chat-answers Chat answers cut to a ~100-120 word budget -- 2026-07-31
- [x] enrich-project-reggie: First-person project doc for the agent system -- 2026-05-29
`;

describe("extractTags", () => {
  it("takes the tags it knows and leaves the prose alone", () => {
    const item = blank();
    const prose = extractTags("Do the thing [P1] [moderate] [code] [planned] [tier: opus:high]", item);
    expect(prose).toBe("Do the thing");
    expect(item.priority).toBe("P1");
    expect(item.size).toBe("medium");
    expect(item.sizeWord).toBe("moderate");
    expect(item.kinds).toEqual(["code"]);
    expect(item.planned).toBe(true);
    expect(item.tier).toBe("opus:high");
  });

  it("leaves a Markdown link and an unknown bracket group in the text", () => {
    const item = blank();
    expect(extractTags("See [the note](http://x/y) about [some aside] here [P2]", item)).toBe(
      "See [the note](http://x/y) about [some aside] here",
    );
    expect(item.priority).toBe("P2");
  });

  it("does not eat a bracket group whose label happens to be a tag word, when it is a link", () => {
    const item = blank();
    expect(extractTags("read [code](./src) first", item)).toBe("read [code](./src) first");
    expect(item.kinds).toEqual([]);
  });

  it("leaves a tag word alone inside a code span, where it is the subject, not the metadata", () => {
    const item = blank();
    const text = "The `[planned]` tag drifts: items get tagged `[planned]` too early [P2] [code]";
    expect(extractTags(text, item)).toBe("The `[planned]` tag drifts: items get tagged `[planned]` too early");
    expect(item.planned).toBe(false);
    expect(item.priority).toBe("P2");
    expect(item.kinds).toEqual(["code"]);
  });

  it("handles several code spans and a doubled backtick fence", () => {
    const item = blank();
    expect(extractTags("`[depends: a]` and ``[conflicts: b]`` are values [P1]", item)).toBe(
      "`[depends: a]` and ``[conflicts: b]`` are values",
    );
    expect(item.depends).toEqual([]);
    expect(item.conflicts).toEqual([]);
  });

  it("survives an unclosed bracket", () => {
    const item = blank();
    expect(extractTags("a [P1] and an unclosed [thing", item)).toBe("a and an unclosed [thing");
  });

  it("reads dependency and conflict lists, dropping anything that is not a slug", () => {
    const item = blank();
    extractTags("x [depends: a-slug, b-slug] [conflicts: c-slug; not a slug]", item);
    expect(item.depends).toEqual(["a-slug", "b-slug"]);
    expect(item.conflicts).toEqual(["c-slug"]);
  });
});

describe("parseFileList", () => {
  it("reads paths and operations, including the counted and uncertain spellings", () => {
    expect(parseFileList("src/a.js (MOD), src/b.js (NEW), content/*.md (MOD x4), d.md (MOD?), plain.js")).toEqual([
      { path: "src/a.js", op: "MOD", tentative: false },
      { path: "src/b.js", op: "NEW", tentative: false },
      { path: "content/*.md", op: "MOD", tentative: false },
      { path: "d.md", op: "MOD", tentative: true },
      { path: "plain.js", op: null, tentative: false },
    ]);
  });

  it("maps the older operation words and keeps READ as no operation", () => {
    expect(parseFileList("a.md (CREATE), b.md (REWRITE), c.md (READ)").map((f) => f.op)).toEqual(["NEW", "MOD", null]);
  });
});

describe("parseLegacyBacklog", () => {
  const items = parseLegacyBacklog(BACKLOG, "TASKS.md", "tasks");
  const byId = new Map(items.map((i) => [i.slug, i]));

  it("finds every checkbox line", () => {
    expect(items.map((i) => i.slug).sort()).toEqual(["audit-unmounted-components", "pin-context-docs", "wrap-rail-pills"]);
  });

  it("records the heading trail and the section note", () => {
    const t = byId.get("wrap-rail-pills")!;
    expect(t.section).toEqual(["Backlog", "Chatbot — Core Experience"]);
    expect(t.initiative).toContain("Tile-family initiative");
    expect(t.ungroomed).toBe(false);
  });

  it("marks an item under an Ungroomed heading, however deep", () => {
    const t = byId.get("audit-unmounted-components")!;
    expect(t.ungroomed).toBe(true);
    expect(t.section).toEqual(["Backlog", "Ungroomed", "Surfaced 2026-08-27 (a triage session)"]);
  });

  it("attaches the files line to the item above it", () => {
    expect(byId.get("wrap-rail-pills")!.files.map((f) => f.path)).toEqual(["src/Rail.js", "src/Rail.css", "src/__tests__/rail.test.js"]);
    expect(byId.get("pin-context-docs")!.files).toEqual([]);
  });

  it("reads the completion date out of a DONE marker", () => {
    const t = byId.get("pin-context-docs")!;
    expect(t.done).toBe(true);
    expect(t.completedAt).toBe("2026-09-05");
  });

  it("leaves an open item without a date", () => {
    expect(byId.get("wrap-rail-pills")!.done).toBe(false);
    expect(byId.get("wrap-rail-pills")!.completedAt).toBeNull();
  });

  it("reads a history file's colon-less lines, and its trailing date", () => {
    const hist = parseLegacyBacklog(HISTORY, "HISTORY.md", "history");
    expect(hist.map((i) => i.slug)).toEqual(["shorten-chat-answers", "enrich-project-reggie"]);
    expect(hist[0]!.completedAt).toBe("2026-07-31");
    expect(hist[0]!.title).toContain("Chat answers cut");
    // Everything in a history file is finished, ticked box or not.
    expect(hist.every((i) => i.done)).toBe(true);
  });

  it("does not read an ordinary sentence's first word as a slug", () => {
    const items = parseLegacyBacklog("- [x] Fixed the thing that was broken\n", "HISTORY.md", "history");
    expect(items[0]!.slug).not.toBe("fixed");
    expect(items[0]!.title).toContain("Fixed the thing");
  });

  it("ignores a heading, a quote and a bare bullet with no checkbox", () => {
    const items = parseLegacyBacklog("## Notes\n> a note\n- not a task\n", "TASKS.md", "tasks");
    expect(items).toEqual([]);
  });
});

describe("readLegacy", () => {
  const repos: TempRepo[] = [];
  const makeRepo = (): string => {
    const r = makeTempRepo("reggie-legacy-");
    repos.push(r);
    return r.root;
  };
  afterAll(() => repos.forEach((r) => r.cleanup()));

  it("reads TASKS.md and HISTORY.md together and keeps one entry per slug", () => {
    const repo = makeRepo();
    writeFileSync(path.join(repo, "TASKS.md"), BACKLOG, "utf8");
    writeFileSync(path.join(repo, "HISTORY.md"), `${HISTORY}- [x] wrap-rail-pills Shipped after all -- 2026-09-06\n`, "utf8");
    const backlog = readLegacy(repoPaths(repo), undefined);
    expect(backlog.sources.map((s) => s.file).sort()).toEqual(["HISTORY.md", "TASKS.md"]);
    // The slug is in both files; it stays one task, and the finished record wins.
    const merged = backlog.items.get("wrap-rail-pills")!;
    expect(merged.done).toBe(true);
    expect(merged.completedAt).toBe("2026-09-06");
    // …and the open line's richer metadata survives the merge.
    expect(merged.priority).toBe("P1");
    expect(merged.files).toHaveLength(3);
  });

  it("picks up per-slug plans from an old pipeline folder", () => {
    const repo = makeRepo();
    writeFileSync(path.join(repo, "TASKS.md"), BACKLOG, "utf8");
    mkdirSync(path.join(repo, ".pipeline", "wrap-rail-pills"), { recursive: true });
    writeFileSync(path.join(repo, ".pipeline", "wrap-rail-pills", "task.md"), "# Task\n\n## Problem\nPills clip.\n", "utf8");
    const backlog = readLegacy(repoPaths(repo), undefined);
    expect(backlog.planDir).toBe(".pipeline");
    expect(backlog.plans.get("wrap-rail-pills")?.content).toContain("Pills clip");
  });

  it("is switched off by config, per source and as a whole", () => {
    const repo = makeRepo();
    writeFileSync(path.join(repo, "TASKS.md"), BACKLOG, "utf8");
    writeFileSync(path.join(repo, "HISTORY.md"), HISTORY, "utf8");
    expect(readLegacy(repoPaths(repo), { enabled: false }).items.size).toBe(0);
    const noHistory = readLegacy(repoPaths(repo), { history: false });
    expect(noHistory.items.has("shorten-chat-answers")).toBe(false);
    expect(noHistory.items.has("wrap-rail-pills")).toBe(true);
  });

  it("returns nothing when the repo keeps no backlog file", () => {
    const backlog = readLegacy(repoPaths(makeRepo()), undefined);
    expect(backlog.items.size).toBe(0);
    expect(backlog.sources).toEqual([]);
  });
});

describe("legacy tasks in the derived board", () => {
  const repos: TempRepo[] = [];
  afterAll(() => repos.forEach((r) => r.cleanup()));

  function repoWithBacklog(): string {
    const made = makeTempRepo("reggie-legacy-board-");
    repos.push(made);
    const repo = made.root;
    writeFileSync(path.join(repo, "TASKS.md"), BACKLOG, "utf8");
    writeFileSync(path.join(repo, "HISTORY.md"), HISTORY, "utf8");
    return repo;
  }

  it("puts every backlog line on the board, in the state the file implies", () => {
    const repo = repoWithBacklog();
    const paths = repoPaths(repo);
    const tasks = listTasks(paths, loadConfig(paths), { includeDone: true });
    const state = new Map(tasks.map((t) => [t.slug, t.state]));
    expect(state.get("wrap-rail-pills")).toBe("groomed"); // [planned], but no plan document exists
    expect(state.get("audit-unmounted-components")).toBe("ungroomed"); // under the Ungroomed heading
    expect(state.get("pin-context-docs")).toBe("done");
    expect(state.get("shorten-chat-answers")).toBe("done");
  });

  it("carries the priority, size and area through to the card, without claiming a brief exists", () => {
    const repo = repoWithBacklog();
    const paths = repoPaths(repo);
    const t = listTasks(paths, loadConfig(paths)).find((x) => x.slug === "wrap-rail-pills")!;
    expect(t.brief).toMatchObject({ exists: false, priority: "P1", size: "medium" });
    expect(t.brief!.area).toBe("src/");
    expect(t.planFiles).toContain("src/Rail.js");
  });

  it("cites the file and line it read the task from", () => {
    const repo = repoWithBacklog();
    const paths = repoPaths(repo);
    const t = listTasks(paths, loadConfig(paths)).find((x) => x.slug === "audit-unmounted-components")!;
    expect(t.legacy).toMatchObject({ file: "TASKS.md", source: "tasks" });
    expect(t.legacy!.line).toBeGreaterThan(0);
    expect(t.reason).toContain("TASKS.md");
  });

  it("only calls a legacy task planned when the plan document is really there", () => {
    const repo = repoWithBacklog();
    const paths = repoPaths(repo);
    expect(listTasks(paths, loadConfig(paths)).find((t) => t.slug === "wrap-rail-pills")!.state).toBe("groomed");

    mkdirSync(path.join(repo, ".pipeline", "wrap-rail-pills"), { recursive: true });
    writeFileSync(path.join(repo, ".pipeline", "wrap-rail-pills", "task.md"), "# Task\n\n## Problem\nPills clip.\n", "utf8");
    const after = listTasks(paths, loadConfig(paths)).find((t) => t.slug === "wrap-rail-pills")!;
    expect(after.state).toBe("planned");
    expect(after.legacy!.planFile).toBe(".pipeline/wrap-rail-pills/task.md");
  });

  it("lets git win: a task branch beats a ticked box in the file", () => {
    const repo = repoWithBacklog();
    const paths = repoPaths(repo);
    git(["checkout", "-q", "-b", "task/pin-context-docs"], { cwd: repo });
    writeFileSync(path.join(repo, "work.txt"), "in progress\n", "utf8");
    git(["add", "-A"], { cwd: repo });
    git(["commit", "-q", "-m", "work"], { cwd: repo });
    git(["checkout", "-q", "-"], { cwd: repo });
    const t = listTasks(paths, loadConfig(paths)).find((x) => x.slug === "pin-context-docs")!;
    expect(t.state).toBe("in-process");
  });
});
