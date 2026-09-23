import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanupOverview, formatRoute, parentRoute, parseRoute, renderConceptEntity, renderRouteEntity, renderSymbolEntity, renderValueTree, routeForNode } from "./app.js";
import { resetDom } from "./test/dom-fixture.js";

beforeEach(() => resetDom());

describe("browser router", () => {
  const routes = [
    [{ level: "workspace", query: {} }, "#/ws"],
    [{ level: "repo", repo: "personal site", query: {} }, "#/repo/personal%20site"],
    [{ level: "area", repo: "demo", id: "src/api", query: { lens: "heat" } }, "#/repo/demo/area/src/api?lens=heat"],
    [{ level: "file", repo: "demo", id: "functions/chat.js", query: { line: "42" } }, "#/repo/demo/file/functions/chat.js?line=42"],
    [{ level: "symbol", repo: "demo", id: "sym:functions/chat.js::onRequestPost", query: {} }, "#/repo/demo/symbol/sym:functions/chat.js::onRequestPost"],
    [{ level: "route", repo: "demo", id: "route:POST:/api/chat", query: {} }, "#/repo/demo/route/route:POST:/api/chat"],
    [{ level: "concept", repo: "demo", id: "concept:session-id", query: {} }, "#/repo/demo/concept/concept:session-id"],
    [{ level: "tasks", repo: "demo", query: {} }, "#/repo/demo/tasks"],
    [{ level: "task", repo: "demo", id: "make-chat-clear", query: {} }, "#/repo/demo/task/make-chat-clear"],
    [{ level: "services", repo: "demo", query: {} }, "#/repo/demo/services"],
    [{ level: "flows", repo: "demo", query: {} }, "#/repo/demo/flows"],
    [{ level: "flow", repo: "demo", id: "POST /api/chat", query: { depth: "3" } }, "#/repo/demo/flow/POST%20/api/chat?depth=3"],
  ];

  it.each(routes)("round-trips %s", (route, hash) => {
    expect(formatRoute(route)).toBe(hash);
    expect(parseRoute(hash)).toMatchObject(route);
  });

  it("keeps path separators readable while escaping route-breaking values", () => {
    const route = parseRoute("#/repo/my%20repo/file/src/a%23b.ts?lens=tests&diff=one%20two");
    expect(route).toMatchObject({ level: "file", repo: "my repo", id: "src/a#b.ts", query: { lens: "tests", diff: "one two" } });
  });

  it("maps graph entities to canonical entity routes", () => {
    expect(routeForNode("demo", "dir:src/api/", {})).toBe("#/repo/demo/area/src/api");
    expect(routeForNode("demo", "sym:functions/chat.js::onRequestPost", {})).toBe("#/repo/demo/symbol/sym:functions/chat.js::onRequestPost");
    expect(routeForNode("demo", "route:POST:/api/chat", {})).toBe("#/repo/demo/route/route:POST:/api/chat");
    expect(routeForNode("demo", "concept:session-id", {})).toBe("#/repo/demo/concept/concept:session-id");
    expect(routeForNode("demo", "svc:binding:AI", { service: "old" })).toBe("#/repo/demo/services?service=svc%3Abinding%3AAI");
    expect(parentRoute(parseRoute("#/repo/demo/symbol/sym%3Afunctions/chat.js%3A%3AonRequestPost"))).toEqual({ level: "file", repo: "demo", id: "functions/chat.js", query: {} });
  });
});

function knowledge(entity, extra = {}) {
  return {
    entity,
    fingerprint: "source-new",
    currentFingerprint: "source-old",
    revision: "knowledge-1",
    stale: false,
    retired: false,
    supersededBy: null,
    historyCount: 1,
    exists: true,
    notes: [],
    current: { summary: "Explains the entity.", parameters: [], fields: [], returns: [], callSites: [] },
    ...extra,
  };
}

describe("code entity pages", () => {
  const route = { level: "symbol", repo: "demo", id: "sym:src/chat.ts::chat", query: {} };

  beforeEach(() => resetDom('<div id="toasts"></div><main><div id="sections"></div></main>'));

  it("renders a symbol as its own page with parent, direct call, unresolved, return, and edit controls", () => {
    renderSymbolEntity(document.getElementById("sections"), {
      knowledge: knowledge(route.id),
      parameters: [{ index: 0, name: "payload", bindingPaths: [], explicitType: null, shape: null }],
      validations: [],
      returns: [{ id: "return:1", expression: "payload.session_id", explicitType: null, status: null, condition: null, shape: null }],
      callers: [{ symbol: { id: "sym:src/client.ts::send", qualifiedName: "send", file: "src/client.ts" }, callSites: [{ id: "call:1" }] }],
      callees: [{ symbol: { id: "sym:src/session.ts::resolve", qualifiedName: "resolve", file: "src/session.ts" }, callSites: [{ id: "call:2" }] }],
      unresolved: [{ finding: { expression: "callback()", reason: "Callback target is dynamic.", source: { file: "src/chat.ts" } } }],
    }, route);
    expect(document.querySelector('a[href="#/repo/demo/symbol/sym:src/client.ts::send"]')).toBeTruthy();
    expect(document.querySelector('a[href="#/repo/demo/symbol/sym:src/session.ts::resolve"]')).toBeTruthy();
    expect(document.getElementById("sections").textContent).toContain("Type: not declared");
    expect(document.getElementById("sections").textContent).toContain("Callback target is dynamic");
    expect(document.querySelector(".knowledge-editor").hidden).toBe(true);
    document.querySelector(".knowledge-panel .btn").click();
    expect(document.querySelector(".knowledge-editor").hidden).toBe(false);
    document.querySelector('.knowledge-editor textarea[name="summary"]').value = "Unsaved draft";
    document.querySelectorAll(".knowledge-editor button")[1].click();
    expect(document.querySelector(".entity-summary").textContent).toBe("Explains the entity.");
  });

  it("renders every request field recursively, including seven siblings, nested fields, missing types, validations, and concept links", () => {
    const scalar = { kind: "scalar", fields: [], elements: [], variants: [], reference: null };
    const fields = ["message", "history", "session_id", "model", "temperature", "max_tokens", "profile"].map((name) => ({ name, path: [name], explicitType: name === "message" ? { text: "string" } : null, optional: false, source: null, shape: name === "profile" ? { kind: "object", fields: [{ name: "flags", path: ["profile", "flags"], explicitType: null, optional: false, source: null, shape: { kind: "object", fields: [{ name: "active", path: ["profile", "flags", "active"], explicitType: { text: "boolean" }, optional: false, source: null, shape: scalar }], elements: [], variants: [], reference: null } }], elements: [], variants: [], reference: null } : scalar }));
    const tree = renderValueTree({ kind: "object", fields, elements: [], variants: [], reference: null }, {
      prefix: "request",
      repo: "demo",
      knowledge: knowledge("route:POST:/api/chat", { current: { summary: "Chat request.", parameters: [], fields: [{ id: "request:session_id", description: "The existing session ID.", explicitType: null }], returns: [], callSites: [] } }),
      validations: [{ kind: "guard", expression: "if (!payload.message)", fieldPaths: [["message"]] }],
      concepts: [{ id: "concept:session-id", canonicalName: "Session ID", occurrences: [{ name: "session_id", path: ["session_id"] }] }],
    });
    document.getElementById("sections").append(tree);
    expect(document.querySelectorAll(":scope > details, .value-tree > details").length).toBeGreaterThanOrEqual(7);
    expect(document.getElementById("sections").textContent).toContain("active");
    expect(document.getElementById("sections").textContent).toContain("The existing session ID.");
    expect(document.getElementById("sections").textContent).toContain("Validation: guard");
    expect(document.querySelector('a[href="#/repo/demo/concept/concept:session-id"]')).toBeTruthy();
  });

  it("renders dedicated route and concept pages with navigable references and override controls", () => {
    const container = document.getElementById("sections");
    renderRouteEntity(container, {
      route: { method: "POST", path: "/api/chat", kind: "cloudflare" },
      knowledge: knowledge("route:POST:/api/chat"), handler: { id: route.id, qualifiedName: "chat", file: "src/chat.ts" }, middleware: [], clients: [], requestShape: null, responses: [], validations: [], concepts: [{ id: "concept:session-id", canonicalName: "Session ID", occurrences: [] }], flows: [{ id: "flow:chat", title: "Chat" }], services: ["svc:binding:AI"],
    }, { ...route, level: "route", id: "route:POST:/api/chat" });
    expect(container.textContent).toContain("POST /api/chat");
    expect(container.querySelector('a[href="#/repo/demo/concept/concept:session-id"]')).toBeTruthy();
    expect(container.querySelector('a[href="#/repo/demo/flow/flow:chat"]')).toBeTruthy();

    renderConceptEntity(container, {
      requestedId: "concept:old-session", redirectedFrom: "concept:old-session",
      concept: { id: "concept:session-id", canonicalName: "Session ID", aliases: ["session_id"], occurrences: [{ id: "occ:1", name: "session_id", path: ["session_id"], explicitType: null, symbolId: route.id, source: { file: "src/chat.ts", startLine: 7 } }], transformations: [] },
      knowledge: knowledge("concept:session-id"), validations: [], routes: [{ id: "route:POST:/api/chat", method: "POST", path: "/api/chat" }], flows: [], symbols: [],
      override: { revision: "concepts-1", redirectFrom: ["concept:old-session"], mergedFrom: ["concept:old-session"], splitFrom: null, splitInto: [], history: [] },
    }, { ...route, level: "concept", id: "concept:old-session" });
    expect(container.textContent).toContain("Redirected from concept:old-session");
    expect(container.textContent).toContain("Type: not declared");
    expect(container.querySelector('a[href="#/repo/demo/route/route:POST:/api/chat"]')).toBeTruthy();
    expect(container.querySelectorAll(".concept-action")).toHaveLength(2);
  });

  it("keeps a conflicting inline-edit draft visible and offers an explicit reload", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: "Knowledge revision conflict: current is newer." }), { status: 409, headers: { "content-type": "application/json" } })));
    renderSymbolEntity(document.getElementById("sections"), { knowledge: knowledge(route.id), parameters: [], validations: [], returns: [], callers: [], callees: [], unresolved: [] }, route);
    document.querySelector(".knowledge-panel .btn").click();
    const form = document.querySelector(".knowledge-editor");
    form.querySelector('textarea[name="summary"]').value = "Keep this draft";
    form.querySelector('input[name="reason"]').value = "Clarify it.";
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(form.hidden).toBe(false);
    expect(form.querySelector('textarea[name="summary"]').value).toBe("Keep this draft");
    expect(form.querySelector(".form__error").textContent).toContain("still here");
    expect(Array.from(form.querySelectorAll("button")).find((button) => button.textContent === "Reload server version")?.hidden).toBe(false);
    vi.unstubAllGlobals();
  });
});

describe("data-flow cleanup overview", () => {
  beforeEach(() => resetDom('<main><div id="sections"></div></main>'));

  it("groups both evidence kinds by code role and states the analyzer limitation", () => {
    const card = cleanupOverview({
      byRole: {
        production: {
          reachableFiles: ["src/live.ts"],
          notReachableFiles: ["src/old.ts"],
          reachableSymbols: ["sym:src/live.ts::live"],
          notReachableSymbols: ["sym:src/old.ts::unused"],
        },
        test: {
          reachableFiles: [],
          notReachableFiles: ["test/old.test.ts"],
          reachableSymbols: [],
          notReachableSymbols: [],
        },
      },
      noReferences: {
        files: ["src/old.ts", "test/old.test.ts"],
        symbols: ["sym:src/old.ts::unused"],
      },
      limitations: ["Dynamic imports and runtime callbacks may hide references."],
    }, "demo");
    document.getElementById("sections").append(card);

    expect(card.textContent).toContain("Possible cleanup");
    expect(card.textContent).toContain("Production · 2 not reachable · 2 with no references");
    expect(card.textContent).toContain("Tests · 1 not reachable · 1 with no references");
    expect(card.textContent).toContain("Neither result proves that removal is safe");
    expect(card.textContent).toContain("Dynamic imports and runtime callbacks may hide references");
    expect(card.querySelector('a[href="#/repo/demo/symbol/sym:src/old.ts::unused"]')).toBeTruthy();
    expect(card.querySelector('a[href="#/repo/demo/file/src/old.ts"]')).toBeTruthy();
  });
});
