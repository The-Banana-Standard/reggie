import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { onboard } from "../src/onboard.js";
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
});
