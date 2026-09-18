import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { checkBuild } from "../src/build-state.js";
import { createMcpServer, type McpServerOptions } from "../src/mcp.js";
import { onboard } from "../src/onboard.js";
import { parseIntake } from "../src/tasks.js";
import { makeTempRepo, type TempRepo } from "./helpers.js";

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
      ["reggie_add_note", "reggie_capture", "reggie_context", "reggie_find_notes", "reggie_journal", "reggie_lint_plan", "reggie_people", "reggie_plan_new", "reggie_task", "reggie_tasks"].sort(),
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
    expect(names).toHaveLength(10);
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
