import { beforeEach, describe, expect, it } from "vitest";
import { formatRoute, parentRoute, parseRoute, routeForNode } from "./app.js";
import { resetDom } from "./test/dom-fixture.js";

beforeEach(() => resetDom());

describe("browser router", () => {
  const routes = [
    [{ level: "workspace", query: {} }, "#/ws"],
    [{ level: "repo", repo: "personal site", query: {} }, "#/repo/personal%20site"],
    [{ level: "area", repo: "demo", id: "src/api", query: { lens: "heat" } }, "#/repo/demo/area/src/api?lens=heat"],
    [{ level: "file", repo: "demo", id: "functions/chat.js", query: { line: "42" } }, "#/repo/demo/file/functions/chat.js?line=42"],
    [{ level: "symbol", repo: "demo", id: "functions/chat.js::onRequestPost", query: {} }, "#/repo/demo/symbol/functions/chat.js::onRequestPost"],
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

  it("maps graph entities to their current routes and preserves symbol compatibility", () => {
    expect(routeForNode("demo", "dir:src/api/", {})).toBe("#/repo/demo/area/src/api");
    expect(routeForNode("demo", "sym:functions/chat.js::onRequestPost", {})).toBe("#/repo/demo/symbol/functions/chat.js::onRequestPost");
    expect(routeForNode("demo", "svc:binding:AI", { service: "old" })).toBe("#/repo/demo/services?service=svc%3Abinding%3AAI");
    expect(parentRoute(parseRoute("#/repo/demo/symbol/functions/chat.js%3A%3AonRequestPost"))).toEqual({ level: "file", repo: "demo", id: "functions/chat.js", query: {} });
  });
});
