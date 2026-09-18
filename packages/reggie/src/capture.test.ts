import { mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { makeFixtureRepo, type FixtureRepo } from "../test/fixtures.js";
import { fullPlan, makeTempRepo, type TempRepo } from "../test/helpers.js";
import { addIntakeDetail, capture, captureDiscoveredIssues, INVISIBLE_CHARS, originLine, parseDiscoveredIssues, removeFromIntake, resolveCaptureOrigin, resolvePackPaths, type CaptureOrigin } from "./capture.js";
import { run } from "./git.js";
import { ensureLayout } from "./layout.js";
import { addNote } from "./notes.js";
import { decidePacket, scaffoldPacket } from "./packet.js";
import { briefFile, planFile, repoPaths, type RepoPaths } from "./paths.js";
import { currentPerson } from "./people.js";
import { listTasks, parseIntake, readIntake } from "./tasks.js";
import { scaffoldBrief } from "./triage.js";
import { readText, writeText } from "./util.js";

const CLI = path.resolve("src/cli.ts");
const TSX = path.resolve("node_modules/.bin/tsx");

/**
 * The shapes an origin can take: a file, a folder, a file with a space, a file with non-ASCII
 * letters, a symlink into the repo and one out of it, a file git indexes but the disk lost, and a
 * path git ignores. Written into any temp repo so both the resolver's cases and the CLI's share it.
 */
function seedOrigins(repo: TempRepo): void {
  repo.write("src/serve.ts", "export function launchSession() {\n  return 1;\n}\n");
  repo.write("src/lib/one.ts", "export const one = 1;\n");
  repo.write("src/a b.ts", "export const ab = 1;\n");
  repo.write("src/café ü/uni.ts", "export const uni = 1;\n");
  repo.write("src/gone.ts", "export const gone = 1;\n");
  // A real file whose name holds a zero-width space: git lists it, and the resolver must still refuse it.
  repo.write("src/zero\u200bwidth.ts", "export const zw = 1;\n");
  repo.write("docs/README.md", "# docs\n");
  symlinkSync("../src/serve.ts", path.join(repo.root, "docs", "inside"));
  symlinkSync("/etc/hosts", path.join(repo.root, "docs", "outside"));
  repo.commitAll("origins");
  rmSync(path.join(repo.root, "src", "gone.ts"));
  mkdirSync(path.join(repo.root, ".reggie", ".cache"), { recursive: true });
  writeFileSync(path.join(repo.root, ".reggie", ".cache", "x"), "cached\n", "utf8");
}

describe("capture", () => {
  let repo: TempRepo;
  beforeEach(() => {
    repo = makeTempRepo();
    ensureLayout(repoPaths(repo.root));
  });
  afterEach(() => repo.cleanup());

  it("derives unique slugs and keeps detail lines", () => {
    const paths = repoPaths(repo.root);
    const person = currentPerson(repo.root);
    const a = capture(paths, { text: "Login retries are not capped", person, source: "cli", detail: "seen on staging\nonly on web" });
    const b = capture(paths, { text: "Login retries are not capped", person, source: "voice" });
    expect(a.slug).toBe("login-retries-are-not-capped");
    expect(b.slug).toBe("login-retries-are-not-capped-2");
    const items = readIntake(paths);
    expect(items).toHaveLength(2);
    expect(items[0]?.detail).toEqual(["seen on staging", "only on web"]);
    expect(items[1]?.text).toBe("Login retries are not capped");
    expect(items[1]?.meta).toContain("test, voice,");
  });

  it("removes an item and its detail once planned", () => {
    const paths = repoPaths(repo.root);
    const person = currentPerson(repo.root);
    capture(paths, { text: "First thing", person, source: "cli", detail: "d1" });
    capture(paths, { text: "Second thing", person, source: "cli" });
    expect(removeFromIntake(paths, "first-thing")).toBe(true);
    const items = readIntake(paths);
    expect(items.map((i) => i.slug)).toEqual(["second-thing"]);
    expect(removeFromIntake(paths, "first-thing")).toBe(false);
  });

  it("removes every bullet shape parseIntake accepts, and leaves a slug that only shares a prefix", () => {
    const paths = repoPaths(repo.root);
    // The intake header invites hand-written lines, and parseIntake takes all of these. A shape
    // parsed as an item but not matched here would outlive its own brief and sit in the queue.
    const file = [
      "# Intake",
      "",
      "- dash: A plain dash (a, cli, 2026-09-15)",
      "  > detail under the dash",
      "* star: A star bullet (a, cli, 2026-09-15)",
      "  > detail under the star",
      "+ plus: A plus bullet (a, cli, 2026-09-15)",
      "- [ ] boxed: A checkbox bullet (a, cli, 2026-09-15)",
      "   - indented: Three spaces of indent (a, cli, 2026-09-15)",
      "- Raw_Prefix: A prefix parseIntake slugifies (a, cli, 2026-09-15)",
      "  > detail under the slugified prefix",
      "- A bullet with no slug prefix at all (a, cli, 2026-09-15)",
      "- foo: The short slug (a, cli, 2026-09-15)",
      "- foo-2: The slug that only shares a prefix (a, cli, 2026-09-15)",
      "",
    ].join("\n");
    writeText(paths.intake, file);
    expect(readIntake(paths).map((i) => i.slug)).toEqual([
      "dash",
      "star",
      "plus",
      "boxed",
      "indented",
      "raw-prefix",
      "a-bullet-with-no-slug-prefix-at-all",
      "foo",
      "foo-2",
    ]);

    for (const slug of ["dash", "star", "plus", "boxed", "indented", "raw-prefix", "a-bullet-with-no-slug-prefix-at-all"]) {
      expect(removeFromIntake(paths, slug)).toBe(true);
    }
    expect(removeFromIntake(paths, "foo")).toBe(true);
    expect(readText(paths.intake)).toBe("# Intake\n\n- foo-2: The slug that only shares a prefix (a, cli, 2026-09-15)\n");
    expect(readIntake(paths).map((i) => i.slug)).toEqual(["foo-2"]);
  });

  it("writes nothing for a slug that has no line, so a second sweep is harmless", () => {
    const paths = repoPaths(repo.root);
    const person = currentPerson(repo.root);
    capture(paths, { text: "Still waiting", person, source: "cli" });
    const before = readText(paths.intake);
    expect(removeFromIntake(paths, "never-captured")).toBe(false);
    expect(readText(paths.intake)).toBe(before);
    expect(removeFromIntake(paths, "still-waiting")).toBe(true);
    expect(removeFromIntake(paths, "still-waiting")).toBe(false);
  });

  it("adds detail under an existing intake item, after the detail already there", () => {
    const paths = repoPaths(repo.root);
    const person = currentPerson(repo.root);
    capture(paths, { text: "Login retries are not capped", person, source: "cli", detail: "seen on staging" });
    capture(paths, { text: "Something else", person, source: "cli" });
    const r = addIntakeDetail(paths, { slug: "login-retries-are-not-capped", text: "It is the web client only.\nThe modal keeps the loop alive.", person, source: "web" });
    expect(r.createdLine).toBe(false);
    expect(r.added).toEqual(["It is the web client only.", "The modal keeps the loop alive."]);
    const items = readIntake(paths);
    expect(items[0]?.detail).toEqual(["seen on staging", "It is the web client only.", expect.stringMatching(/^The modal keeps the loop alive\. \(test, web, \d{4}-\d{2}-\d{2}\)$/)]);
    expect(items[1]?.detail).toEqual([]);
  });

  it("writes an intake line to hold detail for a slug that has none, and refuses empty detail", () => {
    const paths = repoPaths(repo.root);
    const person = currentPerson(repo.root);
    const r = addIntakeDetail(paths, { slug: "from-the-backlog", title: "An item the old backlog held", text: "Here is what I meant.", person, source: "web" });
    expect(r.createdLine).toBe(true);
    const item = readIntake(paths).find((i) => i.slug === "from-the-backlog");
    expect(item?.text).toBe("An item the old backlog held");
    expect(item?.detail[0]).toMatch(/^Here is what I meant\. \(test, web, /);
    expect(() => addIntakeDetail(paths, { slug: "from-the-backlog", text: "  \n ", person, source: "web" })).toThrow(/nothing to add/);
  });
});

describe("resolveCaptureOrigin", () => {
  let repo: TempRepo;
  let paths: RepoPaths;
  beforeAll(() => {
    repo = makeTempRepo();
    paths = repoPaths(repo.root);
    ensureLayout(paths);
    seedOrigins(repo);
    capture(paths, { text: "An item that exists", person: currentPerson(repo.root), source: "cli" });
  });
  afterAll(() => repo.cleanup());

  it("accepts a file, a folder in each spelling, a space, non-ASCII letters and a symlink into the repo, tidied", () => {
    const cases: [string, CaptureOrigin][] = [
      ["src/serve.ts", { kind: "file", path: "src/serve.ts" }],
      ["src/lib", { kind: "folder", path: "src/lib" }],
      ["src/lib/", { kind: "folder", path: "src/lib" }],
      ["./src/lib", { kind: "folder", path: "src/lib" }],
      ["src/a b.ts", { kind: "file", path: "src/a b.ts" }],
      ["src/café ü/uni.ts", { kind: "file", path: "src/café ü/uni.ts" }],
      ["docs/inside", { kind: "file", path: "docs/inside" }],
    ];
    for (const [raw, want] of cases) expect(resolveCaptureOrigin(paths, { path: raw }), raw).toEqual(want);
  });

  it("refuses every path that is not an entity of the repo, with a sentence that names no absolute path, and writes nothing", () => {
    const before = readFileSync(paths.intake, "utf8");
    const refused: [string, RegExp][] = [
      ["", /repo itself is not an origin/],
      [".", /repo itself is not an origin/],
      ["./", /repo itself is not an origin/],
      [repo.root, /never absolute/],
      ["/etc/hosts", /never absolute/],
      ["src/../etc", /step outside/],
      ["src\\serve.ts", /backslash/],
      ["src/serve.ts\0", /control character/],
      ["src/serve\n.ts", /control character/],
      ["src/serve\t.ts", /control character/],
      // A trailing newline or tab is refused, not trimmed away: the check runs on the value as given.
      ["src/serve.ts\n", /control character/],
      ["\tsrc/serve.ts", /control character/],
      // C1 controls, the line and paragraph separators, and the zero-width marks are invisible inside backticks.
      ["src/serve\u0085.ts", /control character/],
      ["src/\u2028serve.ts", /control character/],
      ["src/\u2029serve.ts", /control character/],
      ["src/\u200bserve.ts", /control character/],
      ["src/\ufeffserve.ts", /control character/],
      ["src/zero\u200bwidth.ts", /control character/],
      ["src/`serve`.ts", /backtick/],
      ["src/[serve].ts", /square bracket/],
      ["src/serve|ts", /pipe/],
      [".git/HEAD", /not a file or folder in this repo/],
      [".reggie/.cache/x", /not a file or folder in this repo/],
      ["src/*.ts", /not a file or folder in this repo/],
      [":(exclude)src", /not a file or folder in this repo/],
      ["src/gone.ts", /listed by git but is not on disk/],
      ["src/never.ts", /not a file or folder in this repo/],
      ["docs/outside", /points outside the repo/],
    ];
    for (const [raw, why] of refused) {
      let message = "";
      try {
        resolveCaptureOrigin(paths, { path: raw });
      } catch (err) {
        message = err instanceof Error ? err.message : String(err);
      }
      expect(message, JSON.stringify(raw)).toMatch(why);
      expect(message, JSON.stringify(raw)).not.toContain(repo.root);
      expect(message, JSON.stringify(raw)).not.toMatch(/(^|[^`])\/(Users|private|var|tmp|etc)\//);
      expect(readFileSync(paths.intake, "utf8"), JSON.stringify(raw)).toBe(before);
    }
  });

  it("repeats at most two hundred characters of a refused path, and never an absolute one", () => {
    const long = `src/${"a".repeat(5000)}.ts`;
    let message = "";
    try {
      resolveCaptureOrigin(paths, { path: long });
    } catch (err) {
      message = err instanceof Error ? err.message : String(err);
    }
    expect(message).toMatch(/is not a file or folder in this repo/);
    expect(message).toContain("…");
    expect(message.length).toBeLessThan(300);
    expect(INVISIBLE_CHARS.test("src/plain.ts")).toBe(false);
  });

  it("resolves a launch's pack paths through the same door, deduplicated by what they resolved to and capped after that", () => {
    const nineSpellings = ["src/lib", "src/lib/", "./src/lib", "./src/lib/", "src/serve.ts", "./src/serve.ts", "src/serve.ts/", " src/lib ", "src/serve.ts"];
    expect(resolvePackPaths(paths, nineSpellings, 8)).toEqual(["src/lib", "src/serve.ts"]);
    expect(resolvePackPaths(paths, [], 8)).toEqual([]);
    expect(() => resolvePackPaths(paths, ["src/lib", "src/gone.ts"], 8)).toThrow(/listed by git but is not on disk/);
    expect(() => resolvePackPaths(paths, ["src/lib", " "], 8)).toThrow(/repo itself is not an origin/);
    expect(() => resolvePackPaths(paths, ["src/lib", "src/serve.ts", "src/a b.ts"], 2)).toThrow(/at most 2 paths/);
  });

  it("takes a symbol only with a file, as an identifier, and a task only alone, as a known slug", () => {
    expect(resolveCaptureOrigin(paths, { path: "src/serve.ts", symbol: "launchSession" })).toEqual({ kind: "symbol", path: "src/serve.ts", symbol: "launchSession" });
    expect(resolveCaptureOrigin(paths, { path: "./src/serve.ts", symbol: "$_ok9" })).toEqual({ kind: "symbol", path: "src/serve.ts", symbol: "$_ok9" });
    expect(resolveCaptureOrigin(paths, { task: "an-item-that-exists" })).toEqual({ kind: "task", task: "an-item-that-exists" });
    expect(resolveCaptureOrigin(paths, { task: "elsewhere" }, { knownTasks: new Set(["elsewhere"]) })).toEqual({ kind: "task", task: "elsewhere" });

    expect(() => resolveCaptureOrigin(paths, { symbol: "launchSession" })).toThrow(/needs the file that holds it/);
    expect(() => resolveCaptureOrigin(paths, { path: "src/lib", symbol: "launchSession" })).toThrow(/belongs to a file, not a folder/);
    for (const symbol of ["launch Session", "a::b", "<script>", "x".repeat(201), ""]) {
      expect(() => resolveCaptureOrigin(paths, { path: "src/serve.ts", symbol }), symbol).toThrow(/not a symbol name/);
    }
    expect(() => resolveCaptureOrigin(paths, { task: "an-item-that-exists", path: "src/lib" })).toThrow(/task or the path, not both/);
    expect(() => resolveCaptureOrigin(paths, { task: "Not A Slug" })).toThrow(/not a task slug/);
    expect(() => resolveCaptureOrigin(paths, { task: "../etc" })).toThrow(/not a task slug/);
    expect(() => resolveCaptureOrigin(paths, { task: "no-such-task" })).toThrow(/`no-such-task` is not a task in this repo/);
    expect(() => resolveCaptureOrigin(paths, {})).toThrow(/needs a path or a task/);
  });
});

describe("capture with an origin", () => {
  let repo: TempRepo;
  let paths: RepoPaths;
  beforeEach(() => {
    repo = makeTempRepo();
    paths = repoPaths(repo.root);
    ensureLayout(paths);
    seedOrigins(repo);
  });
  afterEach(() => repo.cleanup());

  it("writes one added detail line, last, in the four shapes, and leaves the intake line itself unchanged", () => {
    const person = currentPerson(repo.root);
    const plain = capture(paths, { text: "Retries are not capped", person, source: "web" });
    const file = capture(paths, { text: "Retries are not capped", person, source: "web", origin: { kind: "file", path: "src/serve.ts" } });
    const folder = capture(paths, { text: "Retries are not capped", person, source: "web", origin: { kind: "folder", path: "src/lib" } });
    const symbol = capture(paths, { text: "Retries are not capped", person, source: "web", origin: { kind: "symbol", path: "src/serve.ts", symbol: "launchSession" } });
    const task = capture(paths, { text: "Retries are not capped", person, source: "web", origin: { kind: "task", task: plain.slug } });
    expect(file.line).toBe(plain.line.replace(plain.slug, file.slug));
    const items = readIntake(paths);
    expect(items.map((i) => i.detail)).toEqual([
      [],
      ["Captured from the file `src/serve.ts`"],
      ["Captured from the folder `src/lib`"],
      ["Captured from `launchSession` in the file `src/serve.ts`"],
      [`Captured from the task \`${plain.slug}\``],
    ]);
    expect([file, folder, symbol, task].map((r) => r.slug)).toEqual(["retries-are-not-capped-2", "retries-are-not-capped-3", "retries-are-not-capped-4", "retries-are-not-capped-5"]);
    const text = readFileSync(paths.intake, "utf8");
    expect(text.split("\n").filter((l) => /^  > Captured from/.test(l))).toHaveLength(4);
    expect(originLine({ kind: "task", task: "x" })).toBe("Captured from the task `x`");
  });

  it("writes the person's detail first and the origin last, and every reader takes both", () => {
    const person = currentPerson(repo.root);
    const r = capture(paths, { text: "The cache is never cleared", person, source: "web", detail: "seen twice\non the board", origin: { kind: "file", path: "src/serve.ts" } });
    const item = parseIntake(readFileSync(paths.intake, "utf8")).find((i) => i.slug === r.slug);
    expect(item?.detail).toEqual(["seen twice", "on the board", "Captured from the file `src/serve.ts`"]);
    expect(readFileSync(paths.intake, "utf8")).toContain("  > on the board\n  > Captured from the file `src/serve.ts`\n");

    // Triage's scaffold copies the line and every detail line into the brief's Problem.
    const brief = scaffoldBrief(paths, { slug: r.slug, author: "test" });
    expect(brief.intakeRemoved).toBe(1);
    const problem = readFileSync(briefFile(paths, r.slug), "utf8");
    expect(problem).toContain("Captured from the file `src/serve.ts`");
    expect(readFileSync(paths.intake, "utf8")).not.toContain(r.slug);

    const again = capture(paths, { text: "Another with an origin", person, source: "cli", origin: { kind: "folder", path: "src/lib" } });
    expect(removeFromIntake(paths, again.slug)).toBe(true);
    expect(readFileSync(paths.intake, "utf8")).not.toContain("Captured from the folder");
  });
});

describe("a task origin in every state", () => {
  let fx: FixtureRepo;
  const extra = { groomed: "groomed-item", planned: "planned-item", done: "done-item" };
  beforeAll(() => {
    fx = makeFixtureRepo();
    const root = fx.repo.root;
    const person = currentPerson(root);
    // A brief somebody wrote into: groomed.
    scaffoldBrief(fx.paths, { slug: extra.groomed, title: "A groomed item", author: person.handle, area: "src/tiny", size: "small", priority: "P3" });
    const filled = readFileSync(briefFile(fx.paths, extra.groomed), "utf8")
      .replace(/^\(what is wrong or missing.*\)$/m, "Nobody can tell what the tiny area is for.")
      .replace(/^\(what makes this worth shaping.*\)$/m, "Because the tiny area is the one nobody reads.")
      .replace(/^- \(one bullet per file or directory.*\)$/m, "- src/tiny/ because it is small")
      .replace(/^- \(each question whose answer.*\)$/m, "- Is two really two?")
      .replace(/^- \(the nearby work a reader might confuse this with.*\)$/m, "- Anything in the big area");
    writeFileSync(briefFile(fx.paths, extra.groomed), filled, "utf8");
    // A plan that passes the contract, on main: planned.
    writeText(planFile(fx.paths, extra.planned), fullPlan(extra.planned, ["src/tiny/one.ts"]));
    // A packet approved on main: done.
    writeText(planFile(fx.paths, extra.done), fullPlan(extra.done, ["src/tiny/two.ts"]));
    scaffoldPacket(fx.paths, fx.config, { slug: extra.done, author: person.handle });
    decidePacket(fx.paths, extra.done, "approved", person.handle);
    fx.repo.commitAll("three more states");
  });
  afterAll(() => fx.repo.cleanup());

  it("names the origin task for each of the six states, mints the new slug from the text, and moves nothing", () => {
    const person = currentPerson(fx.repo.root);
    const byState = new Map(listTasks(fx.paths, fx.config, { includeDone: true }).map((t) => [t.state, t]));
    const origins = ["ungroomed", "groomed", "planned", "in-process", "awaiting-decision", "done"].map((s) => byState.get(s as never)!);
    expect(origins.map((t) => t?.slug)).toEqual([fx.slugs.ungroomed, extra.groomed, extra.planned, fx.slugs.inProcess, fx.slugs.awaiting, extra.done]);
    for (const origin of origins) {
      const known = new Set(listTasks(fx.paths, fx.config, { includeDone: true }).map((t) => t.slug));
      const resolved = resolveCaptureOrigin(fx.paths, { task: origin.slug }, { knownTasks: known });
      const r = capture(fx.paths, { text: `Idea from ${origin.state}`, person, source: "web", origin: resolved });
      expect(r.slug).toBe(`idea-from-${origin.state}`);
      const item = readIntake(fx.paths).find((i) => i.slug === r.slug);
      expect(item?.detail).toEqual([`Captured from the task \`${origin.slug}\``]);
    }
    const after = new Map(listTasks(fx.paths, fx.config, { includeDone: true }).map((t) => [t.slug, t]));
    for (const origin of origins) expect(after.get(origin.slug)?.state, origin.slug).toBe(origin.state);
    for (const origin of origins) expect(after.get(`idea-from-${origin.state}`)?.state).toBe("ungroomed");

    // Text equal to the origin's own title, slugifying to its own slug, mints `<origin>-2`.
    const same = capture(fx.paths, { text: "Split the big area into two packages", person, source: "web", origin: { kind: "task", task: fx.slugs.ungroomed } });
    expect(same.slug).toBe(`${fx.slugs.ungroomed}-2`);
    expect(readIntake(fx.paths).find((i) => i.slug === same.slug)?.detail).toEqual([`Captured from the task \`${fx.slugs.ungroomed}\``]);
    expect(listTasks(fx.paths, fx.config).find((t) => t.slug === fx.slugs.ungroomed)?.state).toBe("ungroomed");
  });
});

describe("reggie capture --path", () => {
  let repo: TempRepo;
  let paths: RepoPaths;
  beforeAll(() => {
    repo = makeTempRepo();
    paths = repoPaths(repo.root);
    ensureLayout(paths);
    // Before the seed, whose commit is the last one: committing afterwards would take the deleted
    // file out of the index, and the case below needs it indexed and gone from disk.
    addNote(paths, "src/lib/", { type: "how", author: "Test Person", text: "The lib folder holds the one helper." });
    seedOrigins(repo);
  });
  afterAll(() => repo.cleanup());

  function cli(args: string[]): { ok: boolean; stdout: string; stderr: string } {
    return run(TSX, [CLI, "--root", repo.root, ...args], { allowFailure: true, cwd: repo.root });
  }

  it("writes the folder and file origin lines with source cli, the detail first", () => {
    const folder = cli(["capture", "The lib folder is unread", "--path", "src/lib"]);
    expect(folder.ok, folder.stderr).toBe(true);
    expect(folder.stdout.trim()).toBe("Captured the-lib-folder-is-unread");
    const file = cli(["capture", "The server is unread", "--path", "src/serve.ts"]);
    expect(file.ok, file.stderr).toBe(true);
    const both = cli(["capture", "With detail too", "--detail", "d", "--path", "src/lib"]);
    expect(both.ok, both.stderr).toBe(true);
    const items = readIntake(paths);
    expect(items.map((i) => [i.slug, i.meta, i.detail])).toEqual([
      ["the-lib-folder-is-unread", expect.stringMatching(/^test, cli, \d{4}-\d{2}-\d{2}$/), ["Captured from the folder `src/lib`"]],
      ["the-server-is-unread", expect.stringMatching(/^test, cli, /), ["Captured from the file `src/serve.ts`"]],
      ["with-detail-too", expect.stringMatching(/^test, cli, /), ["d", "Captured from the folder `src/lib`"]],
    ]);
  });

  it("exits 1 with the resolver's sentence and writes nothing for a missing file, the repo itself and an empty path", () => {
    const before = readFileSync(paths.intake, "utf8");
    const cases: [string, RegExp][] = [
      ["src/gone.ts", /listed by git but is not on disk/],
      [".", /repo itself is not an origin/],
      ["", /repo itself is not an origin/],
    ];
    for (const [p, why] of cases) {
      const r = cli(["capture", "Should not land", "--path", p]);
      expect(r.ok, p).toBe(false);
      expect(r.stderr, p).toMatch(why);
      expect(r.stdout, p).toBe("");
    }
    expect(readFileSync(paths.intake, "utf8")).toBe(before);
  });
});

describe("discovered issues out of a packet", () => {
  let repo: TempRepo;
  let paths: RepoPaths;
  beforeEach(() => {
    repo = makeTempRepo("reggie-discovered-");
    paths = repoPaths(repo.root);
    ensureLayout(paths);
    repo.commitAll("layout");
  });
  afterEach(() => repo.cleanup());

  const packet = (issues: string, author = "pat"): string => ["---", "slug: demo", `author: ${author}`, "verdict: pending", "---", "# Completion", "", "## Deviations from plan", "- A bullet in another section is never read", "", "## Discovered issues", issues, "", "## Open risks", "- Nor is one after it", ""].join("\n");
  const decider = { name: "Dee Cider", email: "dee@example.com", handle: "dee", role: "maintainer" as const };

  it("reads top-level bullets, with the indented lines and nested bullets under each as its detail", () => {
    const issues = parseDiscoveredIssues(packet(["- The first issue, on one line", "* A second one, with a star", "  that wraps onto a second line", "", "    - and holds a nested bullet", " - [ ] A third, indented by one space and with a checkbox", "not a bullet, so it ends the third", "  an orphan line that belongs to nothing"].join("\n")));
    expect(issues).toEqual([
      { text: "The first issue, on one line", rest: [] },
      { text: "A second one, with a star", rest: ["that wraps onto a second line", "- and holds a nested bullet"] },
      { text: "A third, indented by one space and with a checkbox", rest: [] },
    ]);
    expect(parseDiscoveredIssues("# no such section\n- a bullet\n")).toEqual([]);
  });

  it("skips the scaffold's stand-in, a bullet that says none, and a bullet too short to say anything", () => {
    const skipped = ["- (unrelated problems found on the way, one bullet each, or \"none\")", "- none", "- None.", "- **None** found on the way", "- Nothing worth a task", "- n/a", "- N/A for this task", "- too short"].join("\n");
    expect(captureDiscoveredIssues(paths, { slug: "demo", packet: packet(skipped), decider })).toEqual([]);
    expect(readIntake(paths)).toEqual([]);
    // "Nonexistent files are served as 200" begins with the letters of none and is not one.
    const kept = captureDiscoveredIssues(paths, { slug: "demo", packet: packet("- Nonexistent files are answered with a 200"), decider });
    expect(kept.map((k) => k.slug)).toEqual(["nonexistent-files-are-answered-with-a-200"]);
  });

  it("does not capture what the queue already holds, by named slug, by a slug cut short or lengthened, by its own words as a slug, or by its text", () => {
    capture(paths, { text: "The board mislabels every conflict as a missing packet", person: decider, source: "cli" });
    capture(paths, { text: "Something entirely different", slug: "toast-hides-reason", person: decider, source: "cli" });
    writeText(planFile(paths, "a-task-that-was-already-triaged-into-a-folder"), fullPlan("a-task-that-was-already-triaged-into-a-folder"));
    const before = readText(paths.intake);
    const known = [
      "- Conflicts are mislabelled; this is `the-board-mislabels-every-conflict-as-a-missing-p` in the queue",
      "- The reason is hidden. Captured as toast-hides-reason",
      "- The reason is hidden (captured: `toast-hides-reason`)",
      "- Spelled out longer than the slug was cut: `the-board-mislabels-every-conflict-as-a-missing-packet-today`",
      "- Cut shorter than the slug: `the-board-mislabels-every-conflict`",
      "- The board mislabels every conflict as a missing packet",
      "- the board   mislabels every conflict as a missing packet.",
      "- Already a task folder: `a-task-that-was-already-triaged-into-a-folder`",
    ].join("\n");
    expect(captureDiscoveredIssues(paths, { slug: "demo", packet: packet(known), decider })).toEqual([]);
    expect(readText(paths.intake)).toBe(before);

    // A short backticked word never stands for a slug that merely begins with it, and a reworded duplicate is captured again: a duplicate is cheap, a loss is not.
    const fresh = captureDiscoveredIssues(paths, { slug: "demo", packet: packet(["- The `the` in the title is lowercased on the board card", "- The board gets every conflict wrong and blames a missing packet"].join("\n")), decider });
    expect(fresh.map((f) => f.slug)).toEqual(["the-the-in-the-title-is-lowercased-on-the-board", "the-board-gets-every-conflict-wrong-and-blames-a"]);
    // And the same packet a second time captures nothing: what was just written is part of the queue.
    expect(captureDiscoveredIssues(paths, { slug: "demo", packet: packet("- The `the` in the title is lowercased on the board card"), decider })).toEqual([]);
  });

  it("attributes an item to the claim's handle, else the packet's author, else the decider, and bounds what it writes", () => {
    const long = `- ${"A very long sentence about a problem. ".repeat(12)}\n${Array.from({ length: 14 }, (_, i) => `  detail line ${i + 1} ${"x".repeat(i === 0 ? 700 : 5)}`).join("\n")}`;
    const [byAuthor] = captureDiscoveredIssues(paths, { slug: "demo", packet: packet(long, "Pat, (the) Author"), decider });
    const item = readIntake(paths).find((i) => i.slug === byAuthor?.slug);
    expect(item?.meta).toMatch(/^pat-the-author, packet, \d{4}-\d{2}-\d{2}$/);
    expect(item?.text.length).toBe(300);
    expect(item?.text.endsWith("…")).toBe(true);
    expect(item?.detail).toHaveLength(11);
    expect(item?.detail[0]?.length).toBe(500);
    expect(item?.detail.at(-1)).toBe("Captured from the task `demo`");

    writeText(path.join(paths.tasks, "demo", "claim.md"), "---\nperson: Sam Session\nhandle: sam\nemail: sam@example.com\n---\n");
    const [byClaim] = captureDiscoveredIssues(paths, { slug: "demo", packet: packet("- Found by the session that holds the claim"), decider });
    expect(readIntake(paths).find((i) => i.slug === byClaim?.slug)?.meta).toMatch(/^sam, packet, /);

    const [byDecider] = captureDiscoveredIssues(paths, { slug: "other", packet: packet("- Found in a packet that names no author", ""), decider });
    expect(readIntake(paths).find((i) => i.slug === byDecider?.slug)?.meta).toMatch(/^dee, packet, /);
  });

  it("removes control and invisible characters and keeps the intake one item per bullet", () => {
    const hostile = `- A bullet with a bell${String.fromCharCode(7)} and a zero${String.fromCharCode(0x200b)}width space\n  - injected: a nested bullet that must stay a detail line (mallory, cli, 2026-01-01)`;
    const before = readIntake(paths).length;
    const [made] = captureDiscoveredIssues(paths, { slug: "demo", packet: packet(hostile), decider });
    const items = readIntake(paths);
    expect(items).toHaveLength(before + 1);
    expect(items.at(-1)).toMatchObject({ slug: made?.slug, text: "A bullet with a bell and a zero width space" });
    // Line by line, because a newline is itself in the class: no line of the intake holds an unseen character.
    for (const line of (readText(paths.intake) ?? "").split("\n")) expect(INVISIBLE_CHARS.test(line), line).toBe(false);
    expect(items.at(-1)?.detail[0]).toBe("- injected: a nested bullet that must stay a detail line (mallory, cli, 2026-01-01)");
  });
});

