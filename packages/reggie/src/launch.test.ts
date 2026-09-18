import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { makeTempRepo, type TempRepo } from "../test/helpers.js";
import { capture } from "./capture.js";
import { run } from "./git.js";
import {
  appleScriptLiteral,
  contextFileRel,
  launchCommand,
  launchLogFile,
  launchRecordFile,
  launchSession,
  LAUNCH_MODES,
  LAUNCH_TIMEOUT_MS,
  LAUNCH_TOOLS,
  MAX_LAUNCH_PATHS,
  MAX_NOTE_CHARS,
  MAX_PATH_CHARS,
  mintSession,
  readLaunches,
  recordLaunch,
  resolveGoal,
  shellQuote,
  writeContextFile,
  writeContextPacks,
  type LaunchMode,
  type LaunchTask,
  type LaunchTool,
} from "./launch.js";
import { ensureLayout } from "./layout.js";
import { addNote } from "./notes.js";
import { repoPaths } from "./paths.js";
import { currentPerson, loadConfig } from "./people.js";

const CLI = path.resolve("src/cli.ts");
const TSX = path.resolve("node_modules/.bin/tsx");

const SLUG = "cap-login-retries";
const REPO = "/tmp/reggie-fixture-repo";

const ungroomed: LaunchTask = { slug: SLUG, state: "ungroomed" };
const groomed: LaunchTask = { slug: SLUG, state: "groomed" };
const planned: LaunchTask = { slug: SLUG, state: "planned" };
const inProcess: LaunchTask = { slug: SLUG, state: "in-process" };
const awaiting: LaunchTask = { slug: SLUG, state: "awaiting-decision" };

/** The prompt handed to the tool: always the last argument. */
function prompt(plan: { argv: string[] }): string {
  return plan.argv[plan.argv.length - 1] ?? "";
}

/** process.platform is a plain value property, so replacing it is the only way to stub it. */
const realPlatform = process.platform;
function setPlatform(value: string): void {
  Object.defineProperty(process, "platform", { value, configurable: true });
}

describe("resolveGoal", () => {
  it("derives the goal from the task's state, so a button cannot pick the wrong prompt", () => {
    expect(resolveGoal("discuss", [ungroomed])).toBe("shape");
    expect(resolveGoal("discuss", [groomed])).toBe("plan");
    expect(resolveGoal("discuss", [planned])).toBe("discuss");
    expect(resolveGoal("discuss", [inProcess])).toBe("discuss");
    expect(resolveGoal("discuss", [awaiting])).toBe("discuss");
    expect(resolveGoal("build", [planned])).toBe("build");
    expect(resolveGoal("build", [inProcess])).toBe("build");
  });

  it("shapes several ungroomed tasks in one conversation and nothing else takes several", () => {
    const three = [ungroomed, { slug: "flaky-upload", state: "ungroomed" as const }, { slug: "rename-the-store", state: "ungroomed" as const }];
    expect(resolveGoal("discuss", three)).toBe("shape");
    expect(() => resolveGoal("discuss", [ungroomed, groomed])).toThrow(/one task unless every task is ungroomed/);
    expect(() => resolveGoal("build", [planned, inProcess])).toThrow(/build takes one task/);
  });

  it("refuses to build what has no plan, and says what to do instead", () => {
    expect(() => resolveGoal("build", [ungroomed])).toThrow(/Discuss it first/);
    expect(() => resolveGoal("build", [groomed])).toThrow(/no plan that passes the contract/);
    expect(() => resolveGoal("build", [awaiting])).toThrow(/nothing left to build/);
  });
});

describe("launchCommand", () => {
  for (const tool of LAUNCH_TOOLS) {
    for (const mode of LAUNCH_MODES) {
      it(`${tool} / ${mode} runs the right binary on the slug, on one line`, () => {
        const plan = launchCommand({ repo: REPO, tool, mode, tasks: [mode === "build" ? planned : groomed] });
        expect(plan.argv[0]).toBe(tool);
        expect(prompt(plan)).toContain(SLUG);
        expect(plan.command.startsWith(`${tool} `)).toBe(true);
        expect(plan.command).toContain(SLUG);
        expect(plan.command).not.toContain("\n");
        expect(plan.cwd).toBe(path.resolve(REPO));
        expect(plan.description).toContain(SLUG);
      });
    }
  }

  it("never fires a slash command: the prompt is the whole instruction, for both tools", () => {
    for (const tool of LAUNCH_TOOLS) {
      for (const task of [ungroomed, groomed, planned]) {
        const plan = launchCommand({ repo: REPO, tool, mode: task.state === "planned" ? "build" : "discuss", tasks: [task] });
        expect(prompt(plan).startsWith("/")).toBe(false);
        expect(plan.command).not.toContain("/reggie-");
      }
    }
  });

  it("opens Claude Code in plan mode for every discussion goal, and Codex read-only", () => {
    for (const task of [ungroomed, groomed, planned]) {
      const claude = launchCommand({ repo: REPO, tool: "claude", mode: "discuss", tasks: [task] });
      expect(claude.argv.slice(0, 3)).toEqual(["claude", "--permission-mode", "plan"]);
      const codex = launchCommand({ repo: REPO, tool: "codex", mode: "discuss", tasks: [task] });
      expect(codex.argv.slice(0, 3)).toEqual(["codex", "-s", "read-only"]);
    }
    const build = launchCommand({ repo: REPO, tool: "claude", mode: "build", tasks: [planned] });
    expect(build.argv).not.toContain("--permission-mode");
    expect(launchCommand({ repo: REPO, tool: "codex", mode: "build", tasks: [planned] }).argv.slice(0, 3)).toEqual(["codex", "-s", "workspace-write"]);
  });

  it("passes a minted session id to Claude and knows how to resume it", () => {
    const session = mintSession("claude");
    expect(session).toMatch(/^[0-9a-f-]{36}$/);
    const plan = launchCommand({ repo: REPO, tool: "claude", mode: "discuss", tasks: [groomed], session: session! });
    expect(plan.argv).toContain("--session-id");
    expect(plan.argv[plan.argv.indexOf("--session-id") + 1]).toBe(session);
    expect(plan.session).toBe(session);
    expect(plan.resume).toBe(`claude --resume ${session}`);
    expect(mintSession("codex")).toBeNull();
    const codex = launchCommand({ repo: REPO, tool: "codex", mode: "discuss", tasks: [groomed], session: "ignored" });
    expect(codex.session).toBeNull();
    expect(codex.argv).not.toContain("ignored");
    expect(codex.resume).toBe("codex resume --last");
  });

  it("appends the user's note verbatim, and bounds its length", () => {
    const note = "The modal must not close on outside click; that's the whole bug.";
    for (const tool of LAUNCH_TOOLS) {
      const plan = launchCommand({ repo: REPO, tool, mode: "discuss", tasks: [groomed], note });
      expect(prompt(plan)).toContain(`The user adds, in their own words: "${note}"`);
    }
    expect(prompt(launchCommand({ repo: REPO, tool: "claude", mode: "discuss", tasks: [groomed], note: "   " }))).not.toContain("The user adds");
    expect(() => launchCommand({ repo: REPO, tool: "claude", mode: "discuss", tasks: [groomed], note: "x".repeat(MAX_NOTE_CHARS + 1) })).toThrow(/longer than/);
  });

  it("points the session at the written context pack when there is one, else at the verb", () => {
    const withFile = launchCommand({ repo: REPO, tool: "claude", mode: "discuss", tasks: [groomed], contextFiles: [contextFileRel(SLUG)] });
    expect(prompt(withFile)).toContain(`Read \`.reggie/.cache/context/${SLUG}.md\` first`);
    expect(prompt(withFile)).not.toContain(`Run \`reggie context ${SLUG}\``);
    const without = launchCommand({ repo: REPO, tool: "claude", mode: "discuss", tasks: [groomed] });
    expect(prompt(without)).toContain(`Run \`reggie context ${SLUG}\` first`);
  });

  it("shaping says it is shaping, planning says plan mode and the contract, discussing forbids edits", () => {
    const shape = prompt(launchCommand({ repo: REPO, tool: "codex", mode: "discuss", tasks: [ungroomed] }));
    expect(shape).toMatch(/shaping, not planning/i);
    expect(shape).toContain("brief.md");
    expect(shape).toContain(`reggie triage ${SLUG}`);

    const plan = prompt(launchCommand({ repo: REPO, tool: "claude", mode: "discuss", tasks: [groomed] }));
    expect(plan).toContain("plan mode");
    expect(plan).toContain("Acceptance criteria");
    expect(plan).toContain(`reggie plan lint ${SLUG}`);
    expect(plan).toMatch(/do not start the implementation/i);

    const discuss = prompt(launchCommand({ repo: REPO, tool: "claude", mode: "discuss", tasks: [planned] }));
    expect(discuss).toMatch(/do not edit any file/i);
    expect(discuss).toMatch(/do not write or update a plan/i);
    expect(discuss).toMatch(/do not start the work/i);
    expect(launchCommand({ repo: REPO, tool: "claude", mode: "discuss", tasks: [planned] }).description).toMatch(/read-only/i);
  });

  it("a build knows it is already claimed, runs the review policy, and commits with a Task line in the body", () => {
    const claude = prompt(launchCommand({ repo: REPO, tool: "claude", mode: "build", tasks: [planned], branch: `task/${SLUG}` }));
    expect(claude).toContain(`worktree on branch \`task/${SLUG}\``);
    expect(claude).not.toContain("reggie claim");
    expect(claude).toContain("/code-review");
    expect(claude).toContain("/security-review");
    expect(claude).toContain(`a line \`Task: ${SLUG}\` in the commit message body`);
    expect(claude).not.toContain("trailer");
    expect(claude).toContain(`reggie packet ${SLUG}`);
    const codex = prompt(launchCommand({ repo: REPO, tool: "codex", mode: "build", tasks: [planned], branch: `task/${SLUG}` }));
    expect(codex).toContain("codex review");
    expect(codex).not.toContain("/code-review");
    const unclaimed = prompt(launchCommand({ repo: REPO, tool: "claude", mode: "build", tasks: [planned] }));
    expect(unclaimed).toContain(`reggie claim ${SLUG} --worktree`);
  });

  it("a build records checks as data, after the code they prove is committed, and knows what an approval captures", () => {
    for (const tool of LAUNCH_TOOLS) {
      const text = prompt(launchCommand({ repo: REPO, tool, mode: "build", tasks: [planned], branch: `task/${SLUG}` }));
      expect(text).toContain(`\`reggie check ${SLUG} <criterion> pass --evidence <file>\``);
      expect(text).toContain("`reggie_check` tool");
      expect(text).toContain("`--review <name>`");
      expect(text).toMatch(/Record a check after the code it proves is committed/);
      expect(text).toMatch(/a pass goes stale once anything outside `\.reggie\/` changes after it/);
      expect(text).toContain(`run \`reggie packet ${SLUG}\` again until it says the checklist is current`);
      expect(text).toContain(`\`reggie packet ${SLUG} --lint\``);
      expect(text).toMatch(/an approval captures the discovered issues you did not/);
      expect(text).toContain(`Read \`reggie check ${SLUG}\` for what a decider will see`);
      // Nothing is ticked by hand any more, and the session is never told to decide for itself.
      expect(text).not.toMatch(/tick/i);
      expect(text).toContain(`ask me to decide (\`reggie decide ${SLUG}\`)`);
    }
    // The other goals do not build, so they say nothing about checks.
    expect(prompt(launchCommand({ repo: REPO, tool: "claude", mode: "discuss", tasks: [planned] }))).not.toContain("reggie check");
  });

  it("every build prompt says to unlink the dependency link before changing a dependency", () => {
    for (const tool of LAUNCH_TOOLS) {
      const text = prompt(launchCommand({ repo: REPO, tool, mode: "build", tasks: [planned], branch: `task/${SLUG}` }));
      expect(text).toContain("unlink");
      expect(text).toMatch(/before you add or change any dependency/i);
      expect(text).toMatch(/`rm -r` through it would delete/i);
      // With nothing pending there is no first-command sentence to distract from the plan.
      expect(text).not.toMatch(/dependencies are not installed yet/i);
    }
  });

  it("names every pending install command and its directory before the instruction to execute the plan", () => {
    const setup = [
      { dir: "packages/reggie", command: "npm ci --legacy-peer-deps" },
      { dir: "tools/cli", command: "pnpm install" },
    ];
    const text = prompt(launchCommand({ repo: REPO, tool: "claude", mode: "build", tasks: [planned], branch: `task/${SLUG}`, setup }));
    for (const s of setup) {
      expect(text).toContain(s.command);
      expect(text).toContain(s.dir);
      expect(text.indexOf(s.command)).toBeLessThan(text.indexOf("Execute the plan"));
    }
    expect(text).toMatch(/dependencies are not installed yet/i);
  });

  it("lists several ungroomed slugs in one shaping prompt", () => {
    const tasks: LaunchTask[] = [ungroomed, { slug: "flaky-upload", state: "ungroomed" }, { slug: "rename-the-store", state: "ungroomed" }];
    const plan = launchCommand({ repo: REPO, tool: "claude", mode: "discuss", tasks });
    for (const t of tasks) expect(prompt(plan)).toContain(t.slug);
    expect(plan.description).toContain("3 tasks");
    expect(plan.goal).toBe("shape");
  });

  it("rejects a slug that is not a slug, before it reaches a command string", () => {
    const bad = ["../../etc/passwd", "two words", "Upper-Case", "-leading-dash", "semi;colon", "$(whoami)", "", "a".repeat(90)];
    for (const slug of bad) {
      expect(() => launchCommand({ repo: REPO, tool: "claude", mode: "discuss", tasks: [{ slug, state: "groomed" }] })).toThrow(/not a valid slug/);
    }
  });

  it("names the pack paths in every goal's prompt, right after the context clause", () => {
    const clause = "The pack was also built around `src/lib`: its notes, its recent commits and the tasks that touch it are in there, so start reading at that place.";
    const goals: [LaunchMode, LaunchTask][] = [
      ["discuss", ungroomed],
      ["discuss", groomed],
      ["discuss", planned],
      ["build", planned],
    ];
    for (const tool of LAUNCH_TOOLS) {
      for (const [mode, task] of goals) {
        const plan = launchCommand({ repo: REPO, tool, mode, tasks: [task], contextFiles: [contextFileRel(SLUG)], paths: ["src/lib"] });
        const text = prompt(plan);
        expect(text, `${tool} ${mode} ${task.state}`).toContain(clause);
        expect(text.indexOf(clause), `${tool} ${mode} ${task.state}`).toBeGreaterThan(text.indexOf(`.reggie/.cache/context/${SLUG}.md`));
        expect(plan.command).toContain("The pack was also built around");
      }
    }
    const two = prompt(launchCommand({ repo: REPO, tool: "claude", mode: "discuss", tasks: [groomed], paths: ["src/lib", "src/serve.ts"] }));
    expect(two).toContain("The pack was also built around `src/lib` and `src/serve.ts`: their notes, their recent commits and the tasks that touch them are in there, so start reading at those places.");
    const three = prompt(launchCommand({ repo: REPO, tool: "claude", mode: "discuss", tasks: [groomed], paths: ["a", "b", "c"] }));
    expect(three).toContain("around `a`, `b` and `c`:");
  });

  it("keeps a hostile path verbatim inside the prompt argument and single-quoted in the command", () => {
    const hostile = "src/it's a $(touch pwned) `tick` ; semi | pipe.ts";
    for (const tool of LAUNCH_TOOLS) {
      const plan = launchCommand({ repo: REPO, tool, mode: "discuss", tasks: [ungroomed], paths: [hostile] });
      // One element of argv holds the whole prompt, the path inside it exactly as given.
      expect(plan.argv.filter((a) => a.includes(hostile))).toHaveLength(1);
      expect(plan.argv[plan.argv.length - 1]).toContain(`\`${hostile}\``);
      // In the one-line command that element is one single-quoted word, `'` written as `'\''`.
      const quoted = shellQuote(plan.argv[plan.argv.length - 1] ?? "");
      expect(plan.command.endsWith(quoted)).toBe(true);
      expect(quoted.startsWith("'") && quoted.endsWith("'")).toBe(true);
      expect(quoted).toContain("it'\\''s a $(touch pwned) `tick` ; semi | pipe.ts");
      // And a real shell hands it back unchanged, so nothing in it ran.
      const r = run("sh", ["-c", `printf '%s' ${quoted}`], { allowFailure: true });
      expect(r.ok).toBe(true);
      expect(r.stdout).toBe(plan.argv[plan.argv.length - 1]);
    }
  });

  it("refuses an empty path, a control character, a ninth path and an over-long path before building anything", () => {
    const base = { repo: REPO, tool: "claude" as const, mode: "discuss" as const, tasks: [groomed] };
    expect(() => launchCommand({ ...base, paths: [""] })).toThrow(/cannot be empty/);
    expect(() => launchCommand({ ...base, paths: ["   "] })).toThrow(/cannot be empty/);
    expect(() => launchCommand({ ...base, paths: ["src/a\nb.ts"] })).toThrow(/control character/);
    expect(() => launchCommand({ ...base, paths: ["src/a\u0000b.ts"] })).toThrow(/control character/);
    expect(() => launchCommand({ ...base, paths: Array.from({ length: MAX_LAUNCH_PATHS + 1 }, (_, i) => `src/f${i}.ts`) })).toThrow(/at most 8 paths/);
    expect(() => launchCommand({ ...base, paths: [`src/${"x".repeat(MAX_PATH_CHARS)}.ts`] })).toThrow(/longer than 512/);
    expect(launchCommand({ ...base, paths: Array.from({ length: MAX_LAUNCH_PATHS }, (_, i) => `src/f${i}.ts`) }).goal).toBe("plan");
  });

  it("leaves every prompt byte-identical without paths", () => {
    for (const tool of LAUNCH_TOOLS) {
      for (const [mode, task] of [["discuss", ungroomed], ["discuss", groomed], ["discuss", planned], ["build", planned]] as [LaunchMode, LaunchTask][]) {
        const without = launchCommand({ repo: REPO, tool, mode, tasks: [task], contextFiles: [contextFileRel(SLUG)], note: "a note" });
        const empty = launchCommand({ repo: REPO, tool, mode, tasks: [task], contextFiles: [contextFileRel(SLUG)], note: "a note", paths: [] });
        expect(empty.argv).toEqual(without.argv);
        expect(empty.command).toBe(without.command);
        expect(prompt(without)).not.toContain("The pack was also built around");
      }
    }
  });

  it("rejects an unknown tool, an unknown mode, no task, and no repo", () => {
    expect(() => launchCommand({ repo: REPO, tool: "cursor" as LaunchTool, mode: "discuss", tasks: [groomed] })).toThrow(/not a tool/);
    expect(() => launchCommand({ repo: REPO, tool: "claude", mode: "plan" as LaunchMode, tasks: [groomed] })).toThrow(/not a launch mode/);
    expect(() => launchCommand({ repo: REPO, tool: "claude", mode: "discuss", tasks: [] })).toThrow(/at least one task/);
    expect(() => launchCommand({ repo: "  ", tool: "claude", mode: "discuss", tasks: [groomed] })).toThrow(/repository directory/);
  });
});

describe("context files and launch records", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(path.join(os.tmpdir(), "reggie-launch-"));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("writes the pack under .reggie/.cache and returns the relative path the prompt uses", () => {
    const rel = writeContextFile(dir, SLUG, "# Context pack");
    expect(rel).toBe(`.reggie/.cache/context/${SLUG}.md`);
    expect(readFileSync(path.join(dir, rel), "utf8")).toBe("# Context pack\n");
    expect(() => contextFileRel("../x")).toThrow(/not a valid slug/);
  });

  it("records what a launch left behind, so the chat can be found again", () => {
    const rec = recordLaunch(dir, { slug: SLUG, tool: "claude", goal: "plan", session: "abc", resume: "claude --resume abc", cwd: dir });
    expect(rec.at).toMatch(/^\d{4}-/);
    const file = launchRecordFile(dir, SLUG);
    expect(JSON.parse(readFileSync(file, "utf8"))).toEqual(rec);
    expect(() => launchRecordFile(dir, "no good")).toThrow(/not a valid slug/);
  });

  it("keeps every launch for a slug in a log, while the single record still holds the latest", () => {
    const plan = recordLaunch(dir, { slug: SLUG, tool: "claude", goal: "plan", session: "11111111-1111-4111-8111-111111111111", resume: null, cwd: dir });
    const build = recordLaunch(dir, { slug: SLUG, tool: "claude", goal: "build", session: "22222222-2222-4222-8222-222222222222", resume: null, cwd: dir });
    recordLaunch(dir, { slug: "another-task", tool: "claude", goal: "plan", session: "33333333-3333-4333-8333-333333333333", resume: null, cwd: dir });
    expect(readLaunches(dir, SLUG)).toEqual([plan, build]);
    expect(JSON.parse(readFileSync(launchRecordFile(dir, SLUG), "utf8"))).toEqual(build);
    expect(readFileSync(launchLogFile(dir, SLUG), "utf8").trimEnd().split("\n")).toHaveLength(2);
    expect(() => launchLogFile(dir, "../x")).toThrow(/not a valid slug/);
  });

  it("skips a line of the log that does not parse, or is not a launch for this slug", () => {
    const first = recordLaunch(dir, { slug: SLUG, tool: "codex", goal: "build", session: null, resume: "codex resume --last", cwd: dir });
    appendFileSync(launchLogFile(dir, SLUG), '{"slug": "cap-retr\nnot json at all\n[]\n{"slug":"another-task","tool":"claude","goal":"plan","session":null,"resume":null,"cwd":"/x","at":"2026-09-15T10:00:00.000Z"}\n{"slug":"cap-retries","tool":"vim","goal":"plan","session":null,"resume":null,"cwd":"/x","at":"2026-09-15T10:00:00.000Z"}\n');
    const second = recordLaunch(dir, { slug: SLUG, tool: "claude", goal: "discuss", session: "44444444-4444-4444-8444-444444444444", resume: null, cwd: dir });
    expect(readLaunches(dir, SLUG)).toEqual([first, second]);
  });

  it("still reads a cache that holds only the old single record and no log", () => {
    const old = { slug: SLUG, tool: "claude", goal: "plan", session: "55555555-5555-4555-8555-555555555555", resume: null, cwd: dir, at: "2026-09-13T09:00:00.000Z" };
    mkdirSync(path.dirname(launchRecordFile(dir, SLUG)), { recursive: true });
    writeFileSync(launchRecordFile(dir, SLUG), `${JSON.stringify(old, null, 2)}\n`);
    expect(readLaunches(dir, SLUG)).toEqual([old]);
    // The next launch overwrites that single record, so it is carried into the log first.
    const next = recordLaunch(dir, { slug: SLUG, tool: "claude", goal: "build", session: "66666666-6666-4666-8666-666666666666", resume: null, cwd: dir });
    expect(readLaunches(dir, SLUG)).toEqual([old, next]);
    expect(readLaunches(dir, "never-launched")).toEqual([]);
  });
});

describe("writeContextPacks and reggie launch --path", () => {
  let repo: TempRepo;
  let slug: string;
  beforeAll(() => {
    repo = makeTempRepo("reggie-launch-path-");
    const paths = repoPaths(repo.root);
    ensureLayout(paths);
    repo.write("src/serve.ts", "export const serve = 1;\n");
    repo.write("src/lib/one.ts", "export const one = 1;\n");
    addNote(paths, "src/lib/", { type: "how", author: "Test Person", text: "The lib folder holds the one helper." });
    addNote(paths, "src/serve.ts", { type: "why", author: "Test Person", text: "The server exists to be launched at." });
    repo.commitAll("code and notes");
    slug = capture(paths, { text: "An idea about the lib", person: currentPerson(repo.root), source: "cli" }).slug;
    repo.commitAll("intake");
  });
  afterAll(() => repo.cleanup());

  function cli(args: string[]): { ok: boolean; stdout: string; stderr: string } {
    return run(TSX, [CLI, "--root", repo.root, ...args], { allowFailure: true, cwd: repo.root });
  }

  it("builds each task's pack around the paths it was given, in the directory it was told", () => {
    const paths = repoPaths(repo.root);
    const cwd = mkdtempSync(path.join(os.tmpdir(), "reggie-packs-"));
    try {
      const files = writeContextPacks(paths, loadConfig(paths), cwd, [{ slug, state: "ungroomed" }], ["src/lib", "src/serve.ts"]);
      expect(files).toEqual([contextFileRel(slug)]);
      const pack = readFileSync(path.join(cwd, files[0] ?? ""), "utf8");
      expect(pack).toContain(`# Context pack for ${slug}`);
      expect(pack).toContain("## Files in scope\n- src/lib\n- src/serve.ts\n");
      expect(pack).toContain("The lib folder holds the one helper.");
      expect(pack).toContain("The server exists to be launched at.");
      const bare = writeContextPacks(paths, loadConfig(paths), cwd, [{ slug, state: "ungroomed" }]);
      expect(readFileSync(path.join(cwd, bare[0] ?? ""), "utf8")).not.toContain("## Files in scope");
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("prints a command whose prompt names both paths, and exits 1 before printing one for a path that is not there", () => {
    const r = cli(["launch", slug, "--path", "src/lib", "--path", "src/serve.ts"]);
    expect(r.ok, r.stderr).toBe(true);
    expect(r.stdout).toContain("The pack was also built around `src/lib` and `src/serve.ts`");
    expect(r.stdout).toContain("claude --permission-mode plan");
    const tidy = cli(["launch", slug, "--path", "./src/lib/"]);
    expect(tidy.ok, tidy.stderr).toBe(true);
    expect(tidy.stdout).toContain("built around `src/lib`:");

    const gone = cli(["launch", slug, "--path", "src/gone.ts"]);
    expect(gone.ok).toBe(false);
    expect(gone.stderr).toContain("`src/gone.ts` is not a file or folder in this repo");
    expect(gone.stdout).toBe("");
    const outside = cli(["launch", slug, "--path", "../etc"]);
    expect(outside.ok).toBe(false);
    expect(outside.stderr).toMatch(/step outside/);
    expect(outside.stdout).toBe("");
  });
});

describe("shellQuote", () => {
  const nasty = [
    "/Users/someone/My Repos/reggie",
    "/tmp/it's here",
    'say "hello" now',
    "back\\slash\\path",
    "mixed 'quotes' and \"quotes\" and \\ backslashes",
    "$(rm -rf /) `whoami` ${HOME}",
    "semi;colon && and || or | pipe > redirect",
    "unicode — café ☕",
    "",
  ];

  it("round-trips every nasty string through a real shell unchanged", () => {
    for (const value of nasty) {
      const r = run("sh", ["-c", `printf '%s' ${shellQuote(value)}`], { allowFailure: true });
      expect(r.ok, value).toBe(true);
      expect(r.stdout).toBe(value);
    }
  });

  it("leaves plain words bare so commands stay readable", () => {
    expect(shellQuote("claude")).toBe("claude");
    expect(shellQuote("/usr/local/bin/codex")).toBe("/usr/local/bin/codex");
    expect(shellQuote("--permission-mode")).toBe("--permission-mode");
  });

  it("quotes anything else, including the empty string", () => {
    expect(shellQuote("")).toBe("''");
    expect(shellQuote("a b")).toBe("'a b'");
    expect(shellQuote("it's")).toBe("'it'\\''s'");
  });
});

describe("appleScriptLiteral", () => {
  it("escapes backslashes and double quotes, and only those", () => {
    expect(appleScriptLiteral('cd "/x" && echo \\')).toBe('"cd \\"/x\\" && echo \\\\"');
    expect(appleScriptLiteral("plain")).toBe('"plain"');
    expect(appleScriptLiteral("it's")).toBe('"it\'s"');
  });

  it("round-trips the shell line through osascript on macOS", () => {
    if (process.platform !== "darwin") return;
    const line = `cd ${shellQuote("/tmp/it's here")} && claude ${shellQuote('say "hi"')}`;
    const r = run("osascript", ["-e", `return ${appleScriptLiteral(line)}`], { allowFailure: true });
    expect(r.ok).toBe(true);
    expect(r.stdout.trim()).toBe(line);
  });
});

describe("launchSession", () => {
  let dir: string;
  beforeAll(() => {
    dir = mkdtempSync(path.join(os.tmpdir(), "reggie-launch-"));
    writeFileSync(path.join(dir, "marker"), "");
  });
  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
    setPlatform(realPlatform);
  });
  afterEach(() => setPlatform(realPlatform));

  it("refuses a directory that does not exist", () => {
    expect(() => launchSession({ repo: path.join(dir, "nope"), tool: "claude", mode: "discuss", tasks: [groomed] })).toThrow(/not a directory/);
  });

  it("hands the command back unlaunched off macOS, with the goal and the session alongside", () => {
    setPlatform("linux");
    const r = launchSession({ repo: dir, tool: "claude", mode: "discuss", tasks: [groomed], session: "abc" });
    expect(r.launched).toBe(false);
    expect(r.reason).toContain("linux");
    expect(r.command.startsWith("claude --permission-mode plan --session-id abc ")).toBe(true);
    expect(r.goal).toBe("plan");
    expect(r.session).toBe("abc");
    expect(r.cwd).toBe(dir);
  });

  it("bounds the wait on Terminal", () => {
    expect(LAUNCH_TIMEOUT_MS).toBeGreaterThan(0);
    expect(LAUNCH_TIMEOUT_MS).toBeLessThanOrEqual(15_000);
  });
});
