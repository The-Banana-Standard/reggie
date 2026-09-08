import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { run } from "./git.js";
import {
  appleScriptLiteral,
  launchCommand,
  launchSession,
  LAUNCH_MODES,
  LAUNCH_TIMEOUT_MS,
  LAUNCH_TOOLS,
  shellQuote,
  type LaunchMode,
  type LaunchTool,
} from "./launch.js";

const SLUG = "cap-login-retries";
const REPO = "/tmp/reggie-fixture-repo";

/** The prompt or slash command handed to the tool. */
function argument(plan: { argv: string[] }): string {
  return plan.argv[1] ?? "";
}

/** process.platform is a plain value property, so replacing it is the only way to stub it. */
const realPlatform = process.platform;
function setPlatform(value: string): void {
  Object.defineProperty(process, "platform", { value, configurable: true });
}

describe("launchCommand", () => {
  for (const tool of LAUNCH_TOOLS) {
    for (const mode of LAUNCH_MODES) {
      it(`${tool} / ${mode} runs the right binary on the slug, on one line`, () => {
        const plan = launchCommand({ repo: REPO, tool, mode, slugs: [SLUG] });
        expect(plan.argv).toHaveLength(2);
        expect(plan.argv[0]).toBe(tool);
        expect(argument(plan)).toContain(SLUG);
        expect(plan.command.startsWith(`${tool} `)).toBe(true);
        expect(plan.command).toContain(SLUG);
        expect(plan.command).not.toContain("\n");
        expect(plan.cwd).toBe(path.resolve(REPO));
        expect(plan.description).toContain(SLUG);
      });
    }
  }

  it("Claude Code drives triage, plan and implement through the project commands", () => {
    const call = (mode: LaunchMode) => argument(launchCommand({ repo: REPO, tool: "claude", mode, slugs: [SLUG] }));
    expect(call("triage")).toBe(`/reggie-triage ${SLUG}`);
    expect(call("plan")).toBe(`/reggie-plan ${SLUG}`);
    expect(call("implement")).toBe(`/reggie-execute ${SLUG}`);
  });

  it("Codex gets an inline prompt instead, pointing at the same reggie verbs", () => {
    for (const mode of LAUNCH_MODES) {
      const prompt = argument(launchCommand({ repo: REPO, tool: "codex", mode, slugs: [SLUG] }));
      expect(prompt.startsWith("/")).toBe(false);
      expect(prompt).toContain("reggie ");
    }
    expect(argument(launchCommand({ repo: REPO, tool: "codex", mode: "triage", slugs: [SLUG] }))).toContain("reggie triage");
    expect(argument(launchCommand({ repo: REPO, tool: "codex", mode: "plan", slugs: [SLUG] }))).toContain("reggie plan lint");
    expect(argument(launchCommand({ repo: REPO, tool: "codex", mode: "implement", slugs: [SLUG] }))).toContain("reggie claim");
  });

  it("every chat prompt reads the context pack and forbids editing", () => {
    for (const tool of LAUNCH_TOOLS) {
      const plan = launchCommand({ repo: REPO, tool, mode: "chat", slugs: [SLUG] });
      const prompt = argument(plan);
      expect(prompt).toContain(`reggie context ${SLUG}`);
      expect(prompt).toMatch(/do not edit any file/i);
      expect(prompt).toMatch(/do not write or update a plan/i);
      expect(prompt).toMatch(/do not start the work/i);
      expect(plan.description).toMatch(/read-only/i);
    }
  });

  it("triage takes several slugs at once; the other modes take one", () => {
    const slugs = [SLUG, "flaky-upload", "rename-the-store"];
    const claude = launchCommand({ repo: REPO, tool: "claude", mode: "triage", slugs });
    expect(argument(claude)).toBe(`/reggie-triage ${slugs.join(" ")}`);
    const codex = launchCommand({ repo: REPO, tool: "codex", mode: "triage", slugs });
    for (const slug of slugs) expect(argument(codex)).toContain(slug);
    expect(codex.description).toContain("3 tasks");
    for (const mode of ["chat", "plan", "implement"] as const) {
      expect(() => launchCommand({ repo: REPO, tool: "claude", mode, slugs })).toThrow(/takes one slug/);
    }
  });

  it("shaping is not planning: the triage prompt says so", () => {
    const prompt = argument(launchCommand({ repo: REPO, tool: "codex", mode: "triage", slugs: [SLUG] }));
    expect(prompt).toMatch(/shaping, not planning/i);
    expect(prompt).toContain("brief.md");
  });

  it("rejects a slug that is not a slug, before it reaches a command string", () => {
    const bad = ["../../etc/passwd", "two words", "Upper-Case", "-leading-dash", "semi;colon", "$(whoami)", "", "a".repeat(90)];
    for (const slug of bad) {
      expect(() => launchCommand({ repo: REPO, tool: "claude", mode: "plan", slugs: [slug] })).toThrow(/not a valid slug/);
    }
    expect(() => launchCommand({ repo: REPO, tool: "claude", mode: "triage", slugs: [SLUG, "no good"] })).toThrow(/not a valid slug/);
  });

  it("rejects an unknown tool, an unknown mode, no slug, and no repo", () => {
    expect(() => launchCommand({ repo: REPO, tool: "cursor" as LaunchTool, mode: "plan", slugs: [SLUG] })).toThrow(/not a tool/);
    expect(() => launchCommand({ repo: REPO, tool: "claude", mode: "refactor" as LaunchMode, slugs: [SLUG] })).toThrow(/not a launch mode/);
    expect(() => launchCommand({ repo: REPO, tool: "claude", mode: "plan", slugs: [] })).toThrow(/at least one slug/);
    expect(() => launchCommand({ repo: "  ", tool: "claude", mode: "plan", slugs: [SLUG] })).toThrow(/repository directory/);
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
    "semi; colon && ampersand | pipe > redirect",
    "trailing space ",
    "",
    "newline\nin the middle",
    "'",
    "''",
    "\\'",
  ];

  it("leaves ordinary words bare so commands stay readable", () => {
    expect(shellQuote("claude")).toBe("claude");
    expect(shellQuote("/reggie-plan")).toBe("/reggie-plan");
    expect(shellQuote("/Users/someone/code/reggie")).toBe("/Users/someone/code/reggie");
  });

  it("quotes anything else, and never leaves a shell metacharacter live", () => {
    for (const value of nasty) {
      const quoted = shellQuote(value);
      expect(quoted.startsWith("'")).toBe(true);
      expect(quoted.endsWith("'")).toBe(true);
    }
  });

  it.skipIf(process.platform === "win32")("round-trips through a real shell unchanged", () => {
    for (const value of nasty) {
      const r = run("sh", ["-c", `printf %s ${shellQuote(value)}`]);
      expect(r.stdout).toBe(value);
    }
  });

  it.skipIf(process.platform === "win32")("composes the cd-and-run line safely for an awkward repo path", () => {
    const awkward = mkdtempSync(path.join(os.tmpdir(), "reggie launch's "));
    try {
      const plan = launchCommand({ repo: awkward, tool: "codex", mode: "chat", slugs: [SLUG] });
      // Exactly the shape launchSession hands to Terminal, with printf standing in for the tool.
      const line = `cd ${shellQuote(plan.cwd)} && printf %s ${shellQuote(argument(plan))}`;
      const r = run("sh", ["-c", line]);
      expect(r.stdout).toBe(argument(plan));
      expect(run("sh", ["-c", `cd ${shellQuote(plan.cwd)} && pwd`]).stdout.trim()).toBe(awkward);
    } finally {
      rmSync(awkward, { recursive: true, force: true });
    }
  });
});

describe("appleScriptLiteral", () => {
  it("escapes backslashes and double quotes, and only those", () => {
    expect(appleScriptLiteral("plain")).toBe('"plain"');
    expect(appleScriptLiteral('say "hi"')).toBe('"say \\"hi\\""');
    expect(appleScriptLiteral("back\\slash")).toBe('"back\\\\slash"');
    expect(appleScriptLiteral("it's fine")).toBe('"it\'s fine"');
  });

  it("escapes a shell-quoted command line without disturbing its single quotes", () => {
    const line = `cd ${shellQuote("/tmp/My Repos/it's here")} && claude '/reggie-plan demo'`;
    const literal = appleScriptLiteral(line);
    expect(literal.startsWith('"')).toBe(true);
    expect(literal.endsWith('"')).toBe(true);
    expect(literal.slice(1, -1)).not.toContain('"');
    // AppleScript doubles the backslash in the shell's '\'' escape, so Terminal receives it whole.
    expect(literal).toContain("'\\\\''");
    // Undoing the AppleScript escaping must give back exactly the shell line.
    expect(literal.slice(1, -1).replace(/\\(.)/g, "$1")).toBe(line);
  });
});

describe("launchSession", () => {
  let dir: string;

  beforeAll(() => {
    dir = mkdtempSync(path.join(os.tmpdir(), "reggie-launch-"));
    writeFileSync(path.join(dir, "a-file"), "not a directory\n", "utf8");
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  // Every test here stubs the platform away from darwin first, so nothing can open a
  // Terminal window on the machine running the suite.
  beforeEach(() => setPlatform("linux"));
  afterEach(() => setPlatform(realPlatform));

  it("does not launch off macOS, and hands back the command with the reason", () => {
    const input = { repo: dir, tool: "claude" as const, mode: "plan" as const, slugs: [SLUG] };
    const r = launchSession(input);
    expect(r.launched).toBe(false);
    expect(r.command).toBe(launchCommand(input).command);
    expect(r.command).toContain(`/reggie-plan ${SLUG}`);
    expect(r.reason).toContain("macOS");
    expect(r.reason).toContain("linux");
    expect(r.reason).toContain(dir);
  });

  it("says the same on Windows", () => {
    setPlatform("win32");
    const r = launchSession({ repo: dir, tool: "codex", mode: "chat", slugs: [SLUG] });
    expect(r.launched).toBe(false);
    expect(r.reason).toContain("win32");
  });

  it("refuses a repo path that is missing or is not a directory", () => {
    expect(() => launchSession({ repo: path.join(dir, "a-file"), tool: "claude", mode: "chat", slugs: [SLUG] })).toThrow(/not a directory/);
    expect(() => launchSession({ repo: path.join(dir, "no-such-dir"), tool: "claude", mode: "chat", slugs: [SLUG] })).toThrow(/not a directory/);
  });

  it("validates before it does anything, whatever the platform", () => {
    expect(() => launchSession({ repo: dir, tool: "claude", mode: "plan", slugs: ["../escape"] })).toThrow(/not a valid slug/);
    expect(() => launchSession({ repo: dir, tool: "shell" as LaunchTool, mode: "plan", slugs: [SLUG] })).toThrow(/not a tool/);
  });
});

describe("launchSession timeout", () => {
  it("hands the command back when Terminal does not respond in time", () => {
    // A bounded wait is the whole point: the server is single-threaded, so an unanswered
    // macOS automation consent dialog would otherwise block every other request.
    expect(LAUNCH_TIMEOUT_MS).toBeGreaterThan(0);
    expect(LAUNCH_TIMEOUT_MS).toBeLessThanOrEqual(30_000);
  });

  it("run() reports a timeout instead of hanging or throwing under allowFailure", () => {
    const started = Date.now();
    const r = run("sleep", ["30"], { allowFailure: true, timeoutMs: 300 });
    expect(Date.now() - started).toBeLessThan(5_000);
    expect(r.timedOut).toBe(true);
    expect(r.ok).toBe(false);
  });

  it("run() throws a timeout message when failure is not allowed", () => {
    expect(() => run("sleep", ["30"], { timeoutMs: 300 })).toThrow(/timed out after 300ms/);
  });
});
