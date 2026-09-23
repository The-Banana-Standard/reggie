import { describe, expect, it } from "vitest";
import { buildModel, payloadClause, payloadLabel } from "./map.js";

describe("map model", () => {
  it("builds stable repository nodes and import edges", () => {
    const model = buildModel({
      level: "container",
      root: "dir:./",
      areas: [{ id: "src", label: "src", path: "src", files: 2, source: 2 }],
      nodes: [
        { id: "dir:src/", kind: "dir", label: "src", path: "src", area: "src", aggregates: { files: 2, source: 2 } },
        { id: "src/app.js", kind: "file", path: "src/app.js", area: "src", role: "source", inDegree: 0, outDegree: 1 },
        { id: "src/chat.js", kind: "file", path: "src/chat.js", area: "src", role: "source", inDegree: 1, outDegree: 0 },
      ],
      edges: [{ source: "src/app.js", target: "src/chat.js", kind: "import", weight: 2, names: ["chat"] }],
      counts: { files: 2 },
    });

    expect(model.level).toBe("container");
    expect(model.nodes.map((node) => node.id)).toEqual(["dir:src/", "src/app.js", "src/chat.js"]);
    expect(model.nodeById.get("src/chat.js")).toMatchObject({ kind: "file", path: "src/chat.js", role: "source" });
    expect(model.edges).toEqual([expect.objectContaining({ id: "src/app.js->src/chat.js:import", source: "src/app.js", target: "src/chat.js", label: "2", names: ["chat"] })]);
  });

  it("centres a file with its incoming and outgoing neighbors", () => {
    const model = buildModel({
      level: "impact",
      root: "src/chat.js",
      center: "src/chat.js",
      centers: ["src/chat.js"],
      nodes: [
        { id: "src/client.js", kind: "file", path: "src/client.js", side: "up" },
        { id: "src/chat.js", kind: "file", path: "src/chat.js", center: true, side: "center" },
        { id: "src/store.js", kind: "file", path: "src/store.js", side: "down" },
      ],
      edges: [
        { source: "src/client.js", target: "src/chat.js", kind: "import" },
        { source: "src/chat.js", target: "src/store.js", kind: "import" },
      ],
      counts: {},
    });

    expect(model.nodeById.get("src/chat.js")).toMatchObject({ center: true, side: "center" });
    expect(model.edges.map((edge) => [edge.source, edge.target])).toEqual([
      ["src/chat.js", "src/store.js"],
      ["src/client.js", "src/chat.js"],
    ]);
  });

  it("lays out a selected symbol between callers and callees with full symbol labels", () => {
    const model = buildModel({
      level: "call",
      center: "sym:src/chat.ts::chat",
      nodes: [
        { id: "sym:src/client.ts::send", kind: "symbol", label: "send\nclient.ts", path: "src/client.ts", side: "up", hop: 1 },
        { id: "sym:src/chat.ts::chat", kind: "symbol", label: "chat\nchat.ts", path: "src/chat.ts", side: "center", center: true, hop: 0 },
        { id: "sym:src/session.ts::resolve", kind: "symbol", label: "resolve\nsession.ts", path: "src/session.ts", side: "down", hop: 1 },
      ],
      edges: [
        { source: "sym:src/client.ts::send", target: "sym:src/chat.ts::chat", kind: "calls" },
        { source: "sym:src/chat.ts::chat", target: "sym:src/session.ts::resolve", kind: "calls" },
      ],
    }, { level: "call" });
    expect(model.layout.rankDir).toBe("LR");
    expect(model.nodeById.get("sym:src/chat.ts::chat")).toMatchObject({ center: true, kind: "symbol", label: "chat\nchat.ts", w: expect.any(Number), h: 58 });
    expect(model.edges.map((edge) => [edge.source, edge.target])).toEqual([
      ["sym:src/chat.ts::chat", "sym:src/session.ts::resolve"],
      ["sym:src/client.ts::send", "sym:src/chat.ts::chat"],
    ]);
  });

  it("builds flow labels and payload summaries without starting Cytoscape", () => {
    const input = { fields: ["message", "session_id"], shape: "request body", confidence: "exact", source: { file: "functions/chat.js", line: 20 } };
    const model = buildModel({
      level: "flow",
      flow: {
        id: "post-api-chat",
        title: "POST /api/chat",
        method: "POST",
        route: "/api/chat",
        entry: "sym:functions/chat.js::onRequestPost",
        services: ["svc:api:openai"],
        steps: [
          { from: "sym:functions/chat.js::onRequestPost", to: "sym:functions/chat.js::resolveSessionId", kind: "call", label: "calls", confidence: "exact", input },
          { from: "sym:functions/chat.js::resolveSessionId", to: "resp:post-api-chat", kind: "respond", label: "returns", confidence: "exact", input: null },
        ],
      },
      services: [],
    });

    expect(model.nodes.map((node) => [node.id, node.label])).toEqual([
      ["sym:functions/chat.js::onRequestPost", "onRequestPost\nchat.js"],
      ["sym:functions/chat.js::resolveSessionId", "resolveSessionId\nchat.js"],
      ["resp:post-api-chat", "Response"],
    ]);
    expect(model.edges[0]).toMatchObject({ label: "{ message, session_id }", stepIndex: 1, payload: "exact" });
    expect(payloadLabel({ ...input, fields: ["one", "two", "three", "four", "five", "six"] })).toBe("6 fields");
    expect(payloadClause(input)).toBe("{ message, session_id } — read from request body (functions/chat.js:20)");
  });
});
