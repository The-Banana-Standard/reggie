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

  it("shows a documented declaration at original line numbers and pages the complete parent file", async () => {
    const requests = [];
    const pages = {
      1: { path: "src/chat.ts", startLine: 1, endLine: 500, totalLines: 701, text: Array.from({ length: 500 }, (_, index) => `line ${index + 1}`).join("\n"), revision: "rev-1", hasBefore: false, hasAfter: true },
      501: { path: "src/chat.ts", startLine: 501, endLine: 701, totalLines: 701, text: Array.from({ length: 201 }, (_, index) => `line ${index + 501}`).join("\n"), revision: "rev-1", hasBefore: true, hasAfter: false },
    };
    const reader = createReader(container, {
      fetchJson: async (url) => {
        requests.push(url);
        const start = Number(new URL(url, "http://local").searchParams.get("startLine"));
        return pages[start];
      },
    });
    const declaration = { path: "src/chat.ts", startLine: 40, endLine: 44, totalLines: 701, text: "/** Handles chat. */\n@logged\nexport function chat() {\n  return 'ok';\n}", revision: "rev-1", hasBefore: true, hasAfter: true };
    await reader.open("src/chat.ts", { source: declaration });
    expect(reader.current()).toMatchObject({ mode: "symbol", path: "src/chat.ts" });
    expect(Array.from(container.querySelectorAll(".reader__line")).map((row) => row.dataset.line)).toEqual(["40", "41", "42", "43", "44"]);
    expect(container.textContent).toContain("/** Handles chat. */");
    expect(container.querySelector(".reader__full")?.textContent).toBe("Show full file");

    container.querySelector(".reader__full").click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(reader.current().mode).toBe("full");
    expect(container.querySelectorAll(".reader__line")).toHaveLength(500);
    expect(container.querySelector(".reader__source-more")?.textContent).toContain("201");
    container.querySelector(".reader__source-more").click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(container.querySelectorAll(".reader__line")).toHaveLength(701);
    expect(container.querySelector('.reader__line[data-line="701"]')?.textContent).toContain("line 701");
    expect(requests[1]).toContain("startLine=501");
    expect(requests[1]).toContain("revision=rev-1");

    container.querySelector(".reader__full").click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(reader.current().mode).toBe("symbol");
    expect(container.querySelectorAll(".reader__line")).toHaveLength(5);
  });

  it("replaces a declaration when another symbol in the same parent file opens", async () => {
    const reader = createReader(container);
    const first = { path: "src/chat.ts", startLine: 10, endLine: 12, totalLines: 40, text: "function first() {\n  return 1;\n}", revision: "rev-1", hasBefore: true, hasAfter: true };
    const second = { path: "src/chat.ts", startLine: 25, endLine: 27, totalLines: 40, text: "function second() {\n  return 2;\n}", revision: "rev-1", hasBefore: true, hasAfter: true };

    await reader.open("src/chat.ts", { source: first });
    await reader.open("src/chat.ts", { source: second });

    expect(Array.from(container.querySelectorAll(".reader__line")).map((row) => row.dataset.line)).toEqual(["25", "26", "27"]);
    expect(container.textContent).toContain("function second()");
    expect(container.textContent).not.toContain("function first()");
  });
});
