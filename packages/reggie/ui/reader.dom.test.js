import { beforeEach, describe, expect, it } from "vitest";
import { createReader } from "./reader.js";
import { readerShell } from "./test/dom-fixture.js";

let container;

beforeEach(() => {
  container = readerShell();
});

describe("source reader DOM", () => {
  it("opens real source rows, marks symbols, moves the highlight, and closes cleanly", async () => {
    const reader = createReader(container, { root: "/repo", editorScheme: "vscode://file" });
    const file = {
      path: "src/chat.js",
      text: "export function chat() {\n  return 'ok';\n}\n",
      bytes: 43,
      truncated: false,
      symbols: [{ name: "chat", kind: "function", exported: true, line: 1, endLine: 3, usedBy: ["src/app.js"] }],
    };

    await reader.open("src/chat.js", { file, highlight: "chat" });

    expect(reader.current()).toMatchObject({ path: "src/chat.js", open: true, loaded: true });
    expect(container.hidden).toBe(false);
    expect(container.querySelectorAll(".reader__line")).toHaveLength(3);
    expect(container.querySelector('.reader__mark[data-line="1"]')?.getAttribute("aria-label")).toContain("chat");
    expect(Array.from(container.querySelectorAll(".reader__line.is-hl")).map((el) => el.dataset.line)).toEqual(["1", "2", "3"]);
    expect(reader.scrollTo(2)).toBe(true);
    expect(Array.from(container.querySelectorAll(".reader__line.is-hl")).map((el) => el.dataset.line)).toEqual(["2"]);
    expect(container.querySelector(".reader__editor")?.getAttribute("href")).toBe("vscode://file//repo/src/chat.js:2");

    reader.close();
    expect(reader.isOpen()).toBe(false);
    expect(container.hidden).toBe(true);
    expect(container.classList.contains("is-open")).toBe(false);
  });
});
