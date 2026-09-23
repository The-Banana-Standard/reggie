import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { makeTempRepo, type TempRepo } from "../test/helpers.js";
import { flowTraceLines } from "./flow-output.js";
import { traceFlow } from "./flows.js";
import { buildGraph } from "./graph.js";
import { ensureLayout } from "./layout.js";
import { repoPaths } from "./paths.js";

const flowId = "functions-api-chat-js-onrequestpost";

describe("flows CLI", () => {
  let repo: TempRepo;

  beforeAll(() => {
    repo = makeTempRepo("reggie-cli-flow-");
    repo.write(
      "functions/api/chat.js",
      [
        "function resolveSessionId(rawSessionId) {",
        "  if (rawSessionId) return rawSessionId;",
        "  return crypto.randomUUID();",
        "}",
        "export async function onRequestPost({ request }) {",
        "  const payload = await request.json();",
        "  const sessionId = resolveSessionId(payload.session_id);",
        "  return Response.json({ message: payload.message, history: payload.history, sessionId, model: payload.model, temperature: payload.temperature, options: payload.options });",
        "}",
        "",
      ].join("\n"),
    );
    repo.commitAll("chat flow");
    ensureLayout(repoPaths(repo.root));
  });

  afterAll(() => repo.cleanup());

  function flow() {
    const paths = repoPaths(repo.root);
    return traceFlow(paths, buildGraph(paths), flowId);
  }

  it("prints real arguments, full request fields, return variants, and missing declarations", () => {
    const stdout = flowTraceLines(flow()).join("\n");
    expect(stdout).toContain("request payload: { session_id: not declared, message: not declared, history: not declared, model: not declared, temperature: not declared, options: not declared }");
    expect(stdout).toContain("arguments: payload.session_id");
    expect(stdout).toContain("rawSessionId (not declared)");
    expect(stdout).toContain("crypto.randomUUID() (not declared)");
    expect(stdout).not.toContain("{ rawSessionId }");
  });

  it("emits only the semantic flow contract as JSON", () => {
    const json = JSON.parse(JSON.stringify(flow()));
    expect(json.entryNode).toBe("route:POST:/api/chat");
    expect(json.nodes).toEqual(expect.arrayContaining([expect.objectContaining({ kind: "endpoint" }), expect.objectContaining({ kind: "function" }), expect.objectContaining({ kind: "response" })]));
    for (const step of json.steps) {
      expect(step).not.toHaveProperty("input");
      expect(step).not.toHaveProperty("output");
      expect(Array.isArray(step.arguments)).toBe(true);
      expect(Array.isArray(step.returns)).toBe(true);
    }
  });
});
