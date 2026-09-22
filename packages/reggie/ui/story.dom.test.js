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
              text: "Calls [[#/repo/demo/symbol/functions/chat.js::onRequestPost|onRequestPost]] and prints <script>never run()</script>.",
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
    const link = container.querySelector('a[href="#/repo/demo/symbol/functions/chat.js::onRequestPost"]');
    expect(link?.textContent).toBe("onRequestPost");
    expect(container.querySelector("script")).toBeNull();
    expect(container.textContent).toContain("<script>never run()</script>");
    expect(container.querySelector('[data-para="what-1"]')?.dataset.refs).toBe("sym:functions/chat.js::onRequestPost");
    expect(container.querySelector("details.cmds")?.open).toBe(false);
    expect(Array.from(container.querySelectorAll(".cmd__code")).map((el) => el.textContent)).toEqual(["npm test", "npm run build"]);
    expect(tintForNode("sym:functions/chat.js::onRequestPost")).toBe(1);
    expect(container.querySelector('[data-para="what-1"]')?.classList.contains("is-tinted")).toBe(true);
  });
});
