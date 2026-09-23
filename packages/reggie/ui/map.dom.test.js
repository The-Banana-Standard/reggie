import { describe, expect, it } from "vitest";
import { buildModel, valueForStep, valueShapeLabel } from "./map.js";

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

  it("builds typed flow labels and semantic value summaries without starting Cytoscape", () => {
    const scalar = { kind: "scalar", fields: [], elements: [], variants: [], reference: null };
    const requestPayload = {
      kind: "object",
      fields: ["message", "history", "session_id", "model", "temperature", "options"].map((name) => ({ name, path: [name], explicitType: null, optional: false, source: null, shape: scalar })),
      elements: [],
      variants: [],
      reference: null,
    };
    const nodes = [
      { id: "route:POST:/api/chat", kind: "endpoint", label: "POST /api/chat", path: "/api/chat", file: "functions/chat.js" },
      { id: "sym:functions/chat.js::onRequestPost", kind: "function", label: "onRequestPost", path: "functions/chat.js", file: "functions/chat.js" },
      { id: "sym:functions/chat.js::resolveSessionId", kind: "function", label: "resolveSessionId", path: "functions/chat.js", file: "functions/chat.js" },
      { id: "resp:post-api-chat", kind: "response", label: "Response", path: "response", file: null },
    ];
    const model = buildModel({
      level: "flow",
      flow: {
        id: "post-api-chat",
        title: "POST /api/chat",
        method: "POST",
        route: "/api/chat",
        entry: "sym:functions/chat.js::onRequestPost",
        entryNode: "route:POST:/api/chat",
        nodes,
        services: ["svc:api:openai"],
        steps: [
          { from: "route:POST:/api/chat", to: "sym:functions/chat.js::onRequestPost", kind: "call", label: "calls", confidence: "exact", requestPayload, servicePayload: null, arguments: [], returns: [] },
          { from: "sym:functions/chat.js::onRequestPost", to: "sym:functions/chat.js::resolveSessionId", kind: "call", label: "calls", confidence: "exact", requestPayload: null, servicePayload: null, arguments: [{ index: 0, expression: "payload.session_id", parameterName: "rawSessionId", explicitType: null, shape: null, category: "argument" }], returns: [] },
          { from: "sym:functions/chat.js::resolveSessionId", to: "resp:post-api-chat", kind: "respond", label: "returns", confidence: "exact", requestPayload: null, servicePayload: null, arguments: [], returns: [{ id: "return:1", expression: "rawSessionId", explicitType: null, status: null, condition: "rawSessionId", shape: null }, { id: "return:2", expression: "crypto.randomUUID()", explicitType: null, status: null, condition: null, shape: null }] },
        ],
      },
      services: [],
    });

    expect(model.nodes.map((node) => [node.id, node.label])).toEqual([
      ["route:POST:/api/chat", "ENDPOINT\nPOST /api/chat\n/api/chat"],
      ["sym:functions/chat.js::onRequestPost", "FUNCTION\nonRequestPost\nfunctions/chat.js"],
      ["sym:functions/chat.js::resolveSessionId", "FUNCTION\nresolveSessionId\nfunctions/chat.js"],
      ["resp:post-api-chat", "RESPONSE\nResponse\nresponse"],
    ]);
    expect(model.edges[0]).toMatchObject({ label: "6 fields", stepIndex: 1, valueEvidence: "structured" });
    expect(model.edges[1]).toMatchObject({ label: "payload.session_id", valueEvidence: "positional" });
    expect(model.edges[2]).toMatchObject({ label: "2 returns", valueEvidence: "structured" });
    expect(valueShapeLabel(requestPayload)).toBe("6 fields");
    expect(valueForStep(model.view.flow.steps[1])).toEqual({ label: "payload.session_id", names: ["payload.session_id"], evidence: "positional" });
  });

  it("keeps method, class, file, service, and response kinds explicit in node labels", () => {
    const typedNodes = [
      { id: "sym:src/store.ts::Store.save", kind: "method", label: "Store.save", path: "src/store.ts", file: "src/store.ts" },
      { id: "sym:src/store.ts::Store", kind: "class", label: "Store", path: "src/store.ts", file: "src/store.ts" },
      { id: "src/config.ts", kind: "file", label: "config.ts", path: "src/config.ts", file: "src/config.ts" },
      { id: "svc:kv:CACHE", kind: "service", label: "CACHE", path: "cache", file: null },
      { id: "resp:x", kind: "response", label: "Response", path: "response", file: null },
    ];
    const steps = typedNodes.slice(0, -1).map((node, index) => ({
      from: node.id,
      to: typedNodes[index + 1].id,
      kind: node.kind === "file" ? "write" : node.kind === "service" ? "respond" : "call",
      label: "continues",
      confidence: "exact",
      requestPayload: null,
      servicePayload: null,
      arguments: [],
      returns: [],
    }));
    const model = buildModel({ level: "flow", flow: { id: "x", entry: typedNodes[0].id, entryNode: typedNodes[0].id, route: null, method: null, nodes: typedNodes, steps, services: ["svc:kv:CACHE"] }, services: [{ id: "svc:kv:CACHE", kind: "kv", binding: "CACHE", name: "cache", declared: true }] });
    expect(model.nodes.map((node) => node.label)).toEqual([
      "METHOD\nStore.save\nsrc/store.ts",
      "CLASS\nStore\nsrc/store.ts",
      "FILE\nconfig.ts\nsrc/config.ts",
      "SERVICE\nCACHE\ncache",
      "RESPONSE\nResponse\nresponse",
    ]);
  });
});
