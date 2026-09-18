import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { checkBuild } from "../src/build-state.js";
import { run } from "../src/git.js";
import { createMcpServer, type McpServerOptions } from "../src/mcp.js";
import { onboard } from "../src/onboard.js";
import { checksFile, evidenceRelDir } from "../src/paths.js";
import { REPORT_PREAMBLE } from "../src/policy.js";
import { parseIntake } from "../src/tasks.js";
import { makeTempRepo, type TempRepo } from "./helpers.js";
import { makePolicyFixture, type PolicyFixture } from "./policy-fixture.js";

const CLI = path.resolve(__dirname, "..", "src", "cli.ts");
const TSX = path.resolve(__dirname, "..", "node_modules", ".bin", "tsx");

describe("mcp server", () => {
  let repo: TempRepo;
  let client: Client;
  beforeEach(async () => {
    repo = makeTempRepo();
    onboard(repo.root);
    repo.commitAll("onboard");
    const transport = new StdioClientTransport({ command: TSX, args: [CLI, "--root", repo.root, "mcp"], cwd: repo.root, stderr: "ignore" });
    client = new Client({ name: "reggie-test", version: "0.0.0" });
    await client.connect(transport);
  });
  afterEach(async () => {
    await client.close();
    repo.cleanup();
  });

  it("exposes the tools and captures through them", async () => {
    const tools = await client.listTools();
    const names = tools.tools.map((t) => t.name).sort();
    expect(names).toEqual(
      ["reggie_add_note", "reggie_capture", "reggie_check", "reggie_context", "reggie_find_notes", "reggie_journal", "reggie_lint_plan", "reggie_people", "reggie_plan_new", "reggie_task", "reggie_tasks"].sort(),
    );

    const captured = await client.callTool({ name: "reggie_capture", arguments: { text: "Something to do later" } });
    expect(JSON.stringify(captured.content)).toContain("something-to-do-later");

    const tasks = await client.callTool({ name: "reggie_tasks", arguments: {} });
    expect(JSON.stringify(tasks.content)).toContain("ungroomed");

    const note = await client.callTool({ name: "reggie_add_note", arguments: { entity: "_repo", type: "how", text: "This is a fixture repository used by tests." } });
    expect(JSON.stringify(note.content)).toContain("Added how note");

    const ctx = await client.callTool({ name: "reggie_context", arguments: { slug: "something-to-do-later" } });
    expect(JSON.stringify(ctx.content)).toContain("Context pack for something-to-do-later");

    const resources = await client.listResources();
    expect(resources.resources.map((r) => r.uri)).toContain("reggie://readme");
  });

  it("captures with the file or folder the idea came from, and refuses a path that is not one without writing", async () => {
    repo.write("src/lib/one.ts", "export const one = 1;\n");
    repo.commitAll("lib");
    const intake = path.join(repo.root, ".reggie", "intake.md");
    const folder = await client.callTool({ name: "reggie_capture", arguments: { text: "The lib folder needs a note", path: "src/lib" } });
    expect(folder.isError).toBeFalsy();
    expect(JSON.stringify(folder.content)).toContain("Captured as the-lib-folder-needs-a-note");
    const items = parseIntake(readFileSync(intake, "utf8"));
    const item = items.find((i) => i.slug === "the-lib-folder-needs-a-note");
    expect(item?.meta).toMatch(/^test, mcp, \d{4}-\d{2}-\d{2}$/);
    expect(item?.detail).toEqual(["Captured from the folder `src/lib`"]);

    const before = readFileSync(intake, "utf8");
    const refused = await client.callTool({ name: "reggie_capture", arguments: { text: "Must not be written", path: "../etc" } });
    expect(refused.isError).toBe(true);
    expect(JSON.stringify(refused.content)).toContain("a path may not step outside the repo");
    expect(readFileSync(intake, "utf8")).toBe(before);

    // The tool list is unchanged by the option, and no launch tool exists: launching opens a
    // terminal on the serving machine and is a human act.
    const names = (await client.listTools()).tools.map((t) => t.name);
    expect(names.some((n) => /launch/i.test(n))).toBe(false);
    expect(names).toHaveLength(11);
  });
});

describe("mcp server on a stale build", () => {
  let repo: TempRepo;
  let pkg: string;
  let client: Client;

  /** A fake package root with one source and one built file, stamped in seconds from the epoch. */
  function fakePackage(srcAt: number, distAt: number): string {
    const root = mkdtempSync(path.join(os.tmpdir(), "reggie-pkg-"));
    for (const [rel, at] of [["src/cli.ts", srcAt], ["dist/cli.js", distAt]] as const) {
      const file = path.join(root, rel);
      mkdirSync(path.dirname(file), { recursive: true });
      writeFileSync(file, "x\n", "utf8");
      utimesSync(file, at, at);
    }
    return root;
  }

  function journalFiles(): string[] {
    const dir = path.join(repo.root, ".reggie", "journal");
    return existsSync(dir) ? readdirSync(dir, { recursive: true }).map(String) : [];
  }

  async function connect(buildCheck: McpServerOptions["buildCheck"]): Promise<void> {
    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
    await createMcpServer(repo.root, { buildCheck }).connect(serverSide);
    client = new Client({ name: "reggie-test", version: "0.0.0" });
    await client.connect(clientSide);
  }

  beforeEach(() => {
    repo = makeTempRepo();
    onboard(repo.root);
    repo.commitAll("onboard");
  });
  afterEach(async () => {
    await client.close();
    repo.cleanup();
    rmSync(pkg, { recursive: true, force: true });
  });

  it("refuses every tool call with an error naming the build, and writes nothing", async () => {
    pkg = fakePackage(1_000_600, 1_000_000);
    const url = pathToFileURL(path.join(pkg, "dist", "cli.js")).href;
    await connect(() => checkBuild(url, {}));
    const before = journalFiles();

    const tasks = await client.callTool({ name: "reggie_tasks", arguments: {} });
    expect(tasks.isError).toBe(true);
    expect(JSON.stringify(tasks.content)).toContain("npm run build");

    const journal = await client.callTool({ name: "reggie_journal", arguments: { text: "This entry must not be written." } });
    expect(journal.isError).toBe(true);
    expect(JSON.stringify(journal.content)).toContain("npm run build");
    expect(journalFiles()).toEqual(before);
  });

  it("tells the session to restart when dist was rebuilt after the server loaded it", async () => {
    pkg = fakePackage(1_000_300, 1_000_600);
    const url = pathToFileURL(path.join(pkg, "dist", "cli.js")).href;
    await connect(() => checkBuild(url, {}, { builtAt: 1_000_000_000 }));

    const tasks = await client.callTool({ name: "reggie_tasks", arguments: {} });
    expect(tasks.isError).toBe(true);
    expect(JSON.stringify(tasks.content)).toMatch(/restart the MCP server/);
  });

  it("runs tools normally when the escape hatch is set", async () => {
    pkg = fakePackage(1_000_600, 1_000_000);
    const url = pathToFileURL(path.join(pkg, "dist", "cli.js")).href;
    await connect(() => checkBuild(url, { REGGIE_ALLOW_STALE: "1" }));

    const tasks = await client.callTool({ name: "reggie_tasks", arguments: {} });
    expect(tasks.isError).toBeFalsy();
  });
});

describe("the reggie_check tool", () => {
  let fx: PolicyFixture;
  let client: Client;
  const saved = { tool: process.env.REGGIE_TOOL, session: process.env.REGGIE_SESSION };

  function records(): Record<string, unknown>[] {
    const file = checksFile(fx.wtPaths, fx.slug);
    return existsSync(file) ? readFileSync(file, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)) : [];
  }

  async function connect(buildCheck?: McpServerOptions["buildCheck"]): Promise<void> {
    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
    await createMcpServer(fx.worktree, buildCheck ? { buildCheck } : {}).connect(serverSide);
    client = new Client({ name: "reggie-test", version: "0.0.0" });
    await client.connect(clientSide);
  }

  beforeEach(() => {
    // Both doors read who is writing from the environment; pinned, so the two records can be compared field by field.
    process.env.REGGIE_TOOL = "vitest";
    process.env.REGGIE_SESSION = "same-session";
    fx = makePolicyFixture({ stage: "built" });
    fx.wt(`${evidenceRelDir(fx.slug)}tests.txt`, "2 passed\nexit 0\n");
  });
  afterEach(async () => {
    await client?.close();
    fx.cleanup();
    for (const [key, value] of [["REGGIE_TOOL", saved.tool], ["REGGIE_SESSION", saved.session]] as const) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it("writes a record of the same shape as the CLI for the same input, and holds no tool that decides", async () => {
    await connect();
    const viaCli = run(TSX, [CLI, "--root", fx.worktree, "check", fx.slug, "AC1", "pass", "--evidence", "tests.txt", "--note", "the same input"], { cwd: fx.worktree, allowFailure: true });
    expect(viaCli.ok, viaCli.stderr).toBe(true);
    const viaTool = await client.callTool({ name: "reggie_check", arguments: { slug: fx.slug, criterion: "AC1", outcome: "pass", evidence: ["tests.txt"], note: "the same input" } });
    expect(viaTool.isError).toBeFalsy();
    expect(JSON.stringify(viaTool.content)).toMatch(/Recorded pass for criterion 1 \(c:[0-9a-f]{12}\)/);

    const [fromCli, fromTool] = records();
    expect(records()).toHaveLength(2);
    expect(Object.keys(fromTool ?? {})).toEqual(Object.keys(fromCli ?? {}));
    for (const key of Object.keys(fromCli ?? {})) if (key !== "at") expect(fromTool?.[key], key).toEqual(fromCli?.[key]);
    expect(fromTool).toMatchObject({ tool: "vitest", session: "same-session", person: fx.person.handle });

    const names = (await client.listTools()).tools.map((t) => t.name);
    expect(names).toContain("reggie_check");
    expect(names.some((n) => /decide/i.test(n))).toBe(false);
  });

  it("returns the verb's own sentence as a tool error for a refusal, writing nothing, and records a review", async () => {
    await connect();
    for (const [args, says] of [
      [{ slug: fx.slug, criterion: "9", outcome: "pass", evidence: ["tests.txt"] }, /matches no criterion of this plan/],
      [{ slug: fx.slug, criterion: "1", outcome: "pass" }, /a criterion passes only with evidence/],
      [{ slug: fx.slug, criterion: "1", outcome: "pass", evidence: ["../plan.md"] }, /holds a `\.\.` segment/],
      [{ slug: fx.slug, criterion: "1", outcome: "maybe" }, /the outcome must be pass or fail/],
      [{ slug: fx.slug, criterion: "1" }, /the outcome must be pass or fail/],
    ] as const) {
      const refused = await client.callTool({ name: "reggie_check", arguments: args });
      expect(refused.isError, JSON.stringify(args)).toBe(true);
      expect(JSON.stringify(refused.content)).toMatch(says);
    }
    expect(records()).toEqual([]);

    const review = await client.callTool({ name: "reggie_check", arguments: { slug: fx.slug, review: "security-review", outcome: "fail", note: "one finding open" } });
    expect(review.isError).toBeFalsy();
    expect(records()).toMatchObject([{ kind: "review", key: "r:security-review", outcome: "fail" }]);
  });

  it("returns the policy report, which says it is a report, when called with no outcome", async () => {
    await connect();
    const report = await client.callTool({ name: "reggie_check", arguments: { slug: fx.slug } });
    expect(report.isError).toBeFalsy();
    const body = (report.content as { text: string }[])[0]?.text ?? "";
    expect(body.split("\n")[0]).toBe(REPORT_PREAMBLE);
    expect(body).toContain("verdict: not evaluated: task/two-not-one has no packet yet.");
    expect(records()).toEqual([]);
  });

  it("is registered through the stale-build wrapper: on a stale build it refuses, naming the build, and writes nothing", async () => {
    const pkg = mkdtempSync(path.join(os.tmpdir(), "reggie-pkg-"));
    try {
      for (const [rel, at] of [["src/cli.ts", 1_000_600], ["dist/cli.js", 1_000_000]] as const) {
        mkdirSync(path.dirname(path.join(pkg, rel)), { recursive: true });
        writeFileSync(path.join(pkg, rel), "x\n", "utf8");
        utimesSync(path.join(pkg, rel), at, at);
      }
      const url = pathToFileURL(path.join(pkg, "dist", "cli.js")).href;
      await connect(() => checkBuild(url, {}));
      const refused = await client.callTool({ name: "reggie_check", arguments: { slug: fx.slug, criterion: "1", outcome: "pass", evidence: ["tests.txt"] } });
      expect(refused.isError).toBe(true);
      expect(JSON.stringify(refused.content)).toContain("npm run build");
      expect(records()).toEqual([]);
    } finally {
      rmSync(pkg, { recursive: true, force: true });
    }
  });
});

