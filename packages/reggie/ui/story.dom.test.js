import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderStory, tintForNode } from "./story.js";
import { resetDom } from "./test/dom-fixture.js";

beforeEach(() => resetDom('<main><div id="story"></div></main>'));

describe("story DOM", () => {
  it("renders the production section, link, detail, reference, and text contracts", () => {
    const map = { on: vi.fn(() => vi.fn()), highlight: vi.fn(), clearHighlight: vi.fn() };
    const story = {
      scope: "repo",
      subtitle: "A repository story",
      sections: [
        {
          id: "what",
          heading: "About this repo",
          paragraphs: [
            {
              id: "what-1",
              kind: "fact",
              text: "Calls [[#/repo/demo/symbol/sym:functions/chat.js::onRequestPost|onRequestPost]] and prints <script>never run()</script>.",
              refs: ["sym:functions/chat.js::onRequestPost"],
            },
          ],
        },
        { id: "run", heading: "How to run it", paragraphs: [{ id: "run-1", kind: "fact", text: "npm test\nnpm run build", refs: ["repo:demo"] }] },
      ],
    };

    const container = document.getElementById("story");
    renderStory(container, story, { repo: "demo", route: { level: "repo", repo: "demo" }, map });

    expect(Array.from(container.querySelectorAll("h2")).map((el) => el.textContent.trim())).toEqual(["About this repo", "How to run it"]);
    const link = container.querySelector('a[href="#/repo/demo/symbol/sym:functions/chat.js::onRequestPost"]');
    expect(link?.textContent).toBe("onRequestPost");
    expect(container.querySelector("script")).toBeNull();
    expect(container.textContent).toContain("<script>never run()</script>");
    expect(container.querySelector('[data-para="what-1"]')?.dataset.refs).toBe("sym:functions/chat.js::onRequestPost");
    expect(container.querySelector("details.cmds")?.open).toBe(false);
    expect(Array.from(container.querySelectorAll(".cmd__code")).map((el) => el.textContent)).toEqual(["npm test", "npm run build"]);
    expect(tintForNode("sym:functions/chat.js::onRequestPost")).toBe(1);
    expect(container.querySelector('[data-para="what-1"]')?.classList.contains("is-tinted")).toBe(true);
  });

  it("renders a numbered flow step with navigable technical links and complete expandable values", () => {
    const scalar = { kind: "scalar", fields: [], elements: [], variants: [], reference: null };
    const requestShape = {
      kind: "object",
      fields: ["message", "history", "session_id", "model", "temperature", "options"].map((name) => ({
        name,
        path: [name],
        explicitType: name === "message" ? { text: "string" } : null,
        optional: false,
        source: { file: "functions/api/chat.js", startLine: 9 },
        shape: name === "options"
          ? { kind: "object", fields: [{ name: "stream", path: ["options", "stream"], explicitType: { text: "boolean" }, optional: false, source: { file: "functions/api/chat.js", startLine: 9 }, shape: scalar }], elements: [], variants: [], reference: null }
          : scalar,
      })),
      elements: [],
      variants: [],
      reference: null,
    };
    const knowledge = {
      exists: true,
      stale: false,
      current: { summary: "Handles an incoming chat request.", parameters: [], fields: [], returns: [], callSites: [] },
    };
    const story = {
      scope: "flow",
      subtitle: "A semantic flow",
      sections: [{
        id: "steps",
        heading: "How the data moves",
        paragraphs: [{
          id: "step-1",
          kind: "flow-step",
          text: "The endpoint hands the request to onRequestPost.",
          refs: ["route:POST:/api/chat", "sym:functions/api/chat.js::onRequestPost"],
          flowStep: {
            number: 1,
            summary: "The endpoint hands the request to onRequestPost.",
            technical: "[[#/repo/demo/route/route:POST:/api/chat|POST /api/chat]] routes the request to [[#/repo/demo/symbol/sym:functions/api/chat.js::onRequestPost|onRequestPost]] in [[#/repo/demo/file/functions/api/chat.js|chat.js]].",
            calleeId: "sym:functions/api/chat.js::onRequestPost",
            calleeLabel: "onRequestPost",
            calleeSummary: "Handles an incoming chat request.",
            calleeStale: true,
            inputs: [{ label: "Request payload", arguments: [], shape: requestShape, prefix: "request", knowledge }],
            returns: [
              { id: "return:1", expression: "rawSessionId", explicitType: null, status: null, condition: "rawSessionId", shape: null },
              { id: "return:2", expression: "crypto.randomUUID()", explicitType: null, status: null, condition: null, shape: null },
            ],
            declaredReturnType: null,
            returnKnowledge: knowledge,
            validations: [{ kind: "guard", expression: "if (!payload.message)", fieldPaths: [["message"]] }],
            concepts: [{ id: "concept:session-id", canonicalName: "Session ID", occurrences: [{ name: "session_id", path: ["session_id"], source: { file: "functions/api/chat.js", line: 9 } }] }],
          },
        }],
      }],
    };
    const container = document.getElementById("story");
    renderStory(container, story, { repo: "demo", route: { level: "flow", repo: "demo" }, map: null });

    expect(container.querySelector(".flow-step__number")?.textContent).toBe("Step 1");
    expect(container.querySelector(".flow-step__summary")?.textContent).toContain("hands the request");
    expect(container.querySelector('a[href="#/repo/demo/symbol/sym:functions/api/chat.js::onRequestPost"]')).toBeTruthy();
    expect(container.querySelector('a[href="#/repo/demo/file/functions/api/chat.js"]')).toBeTruthy();
    expect(Array.from(container.querySelectorAll(".flow-step__detail > summary")).map((node) => node.textContent)).toEqual(expect.arrayContaining(["What onRequestPost doesSummary: stale", "Inputs", "Returns"]));
    expect(container.querySelector('[data-input-kind="Request payload"]')).toBeTruthy();
    for (const name of ["message", "history", "session_id", "model", "temperature", "options", "stream"]) expect(container.textContent).toContain(name);
    expect(container.textContent).toContain("Type: not declared");
    expect(container.textContent).toContain("crypto.randomUUID()");
    expect(container.querySelector('a[href="#/repo/demo/concept/concept:session-id"]')).toBeTruthy();
  });
});
