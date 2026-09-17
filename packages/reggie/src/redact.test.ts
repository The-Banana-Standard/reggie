import { describe, expect, it } from "vitest";
import { SECRET_SHAPES as SHAPES } from "../test/transcript-fixture.js";
import { breakLinks, capText, cleanText, dropBlocks, flattenText, MAX_QUOTE_CHARS, redactText, WITHHELD } from "./redact.js";

const join = (...parts: string[]): string => parts.join("");

describe("redactText", () => {
  it.each(SHAPES)("withholds $name", ({ value }) => {
    const r = redactText(`Before it ${value} after it.`);
    expect(r.withheld).toBeGreaterThanOrEqual(1);
    expect(r.text).toContain(WITHHELD);
    // Not one distinctive piece of the value is left behind.
    for (const piece of value.split(/[\s=:/@.-]+/).filter((p) => p.length >= 8)) expect(r.text).not.toContain(piece);
    expect(r.text.startsWith("Before it ")).toBe(true);
  });

  it("takes the login, the query and the fragment off a URL, and counts it once", () => {
    const r = redactText(`See https://${join("user", ":", "pw123456")}@example.com/docs/page?key=${"k".repeat(12)}#part for more.`);
    expect(r.text).toBe("See https://example.com/docs/page for more.");
    expect(r.withheld).toBe(1);
  });

  it("leaves a plain URL alone and counts nothing", () => {
    expect(redactText("Read https://example.com/docs/page.")).toEqual({ text: "Read https://example.com/docs/page.", withheld: 0 });
  });

  it("withholds a file URL whole, because it is a local path", () => {
    const r = redactText("Opened file:///Users/someone/notes.txt today");
    expect(r.text).toBe(`Opened ${WITHHELD} today`);
  });

  it("does not withhold a 40-character lowercase hex string", () => {
    const sha = "0123456789abcdef0123456789abcdef01234567";
    expect(redactText(`The commit ${sha} landed.`)).toEqual({ text: `The commit ${sha} landed.`, withheld: 0 });
  });

  it("does not withhold the word token, or secret, used in a sentence without a value", () => {
    const text = "The token is refreshed daily and the secret to a good password policy is rotation.";
    expect(redactText(text)).toEqual({ text, withheld: 0 });
  });

  it("does not take a route, a relative path or a long hyphenated slug for a secret or a local path", () => {
    const text = "GET /api/journal reads packages/reggie/src/journal.ts for a-task-worktree-has-no-node-modules-so-nothing-runs.";
    expect(redactText(text)).toEqual({ text, withheld: 0 });
  });

  it("takes an unclosed PEM block to the end of the text", () => {
    const r = redactText(join("Here: -----BEGIN PRIVATE KEY-----\n", "MIIEinventedinvented\n", "and it never closes"));
    expect(r.text).toBe(`Here: ${WITHHELD}`);
  });

  it("counts every passage", () => {
    const r = redactText(`${SHAPES[0]?.value} and ${SHAPES[12]?.value} and ${SHAPES[14]?.value}`);
    expect(r.withheld).toBe(3);
  });
});

describe("dropBlocks", () => {
  it("removes fenced code and table rows whole, and an unclosed fence takes the rest", () => {
    expect(dropBlocks("keep\n```sh\nrm -rf something\n```\nalso keep\n| a | b |\n|---|---|\n| 1 | 2 |\nlast")).toBe("keep\nalso keep\nlast");
    expect(dropBlocks("keep\n~~~\nnever closed\nmore")).toBe("keep");
    expect(dropBlocks("a\n````\n```\nstill inside\n````\nb")).toBe("a\nb");
  });
});

describe("flattenText", () => {
  it("makes one line of plain prose out of Markdown", () => {
    const text = ["# Heading", "", "- a **bold** point", "- [ ] a _task_ with `code`", "> quoted", "1. first", "---", "See [the label](https://example.com/x) and snake_case_name."].join("\n");
    expect(flattenText(text)).toBe("Heading a bold point a task with code quoted first See the label and snake_case_name.");
  });

  it("removes control, zero-width and bidirectional characters, and the replacement character", () => {
    const hostile = [0x00, 0x07, 0x1b, 0x7f, 0x85, 0x200b, 0x200f, 0x202e, 0x2066, 0x2069, 0xfeff, 0xfffd].map((c) => String.fromCharCode(c)).join("x");
    expect(flattenText(`a${hostile}b`)).toBe(`a${"x".repeat(11)}b`);
    expect(flattenText(`one\ttwo${String.fromCharCode(0x2028)}three\r\nfour`)).toBe("one twothree four");
  });

  it("cannot leave a line that starts like an entry header, a heading or a trailer", () => {
    const flat = flattenText("### 10:00 · mallory · claude · other-slug · execute\n## Heading\nevidence: x.txt\nderived: session=none");
    expect(flat).not.toContain("\n");
    expect(flat.startsWith("10:00")).toBe(true);
  });
});

describe("breakLinks", () => {
  it("pulls [[ and ]] apart so the web view's link syntax cannot be forged", () => {
    expect(breakLinks("see [[task/other|label]] and [[[x]]]")).toBe("see [ [task/other|label] ] and [ [ [x] ] ]");
  });
});

describe("capText", () => {
  it("leaves a short message alone", () => {
    expect(capText("Short and done.", 800)).toEqual({ text: "Short and done.", cut: false });
  });

  it("cuts a long message after the last sentence end inside the limit", () => {
    const text = `${"First sentence here. ".repeat(60)}`.trim();
    const r = capText(text, MAX_QUOTE_CHARS);
    expect(r.cut).toBe(true);
    expect(Array.from(r.text).length).toBeLessThanOrEqual(MAX_QUOTE_CHARS);
    expect(r.text.endsWith("here.")).toBe(true);
  });

  it("cuts at a space and ends with an ellipsis when there is no sentence end", () => {
    const r = capText("word ".repeat(400).trim(), MAX_QUOTE_CHARS);
    expect(r.cut).toBe(true);
    expect(Array.from(r.text).length).toBeLessThanOrEqual(MAX_QUOTE_CHARS);
    expect(r.text.endsWith("word…")).toBe(true);
  });

  it("counts characters and not code units, and never splits one", () => {
    const clef = String.fromCodePoint(0x1d11e);
    const r = capText(clef.repeat(30), 10);
    expect(Array.from(r.text)).toHaveLength(10);
    expect(r.text).toBe(`${clef.repeat(9)}…`);
  });

  it("sees a sentence that ends exactly on the limit", () => {
    expect(capText("Ten chars. And more after it", 10)).toEqual({ text: "Ten chars.", cut: true });
  });
});

describe("cleanText", () => {
  it("redacts before it flattens, so Markdown around a secret cannot hide it", () => {
    const r = cleanText(`The key is \`${SHAPES[9]?.value}\` and **${SHAPES[1]?.value}**.`);
    expect(r.withheld).toBe(2);
    expect(r.text).toBe(`The key is ${WITHHELD} and ${WITHHELD}.`);
  });

  it("does not make a [[ out of a bracket and a withheld word", () => {
    const r = cleanText(`Wrote to [${SHAPES[12]?.value}] today`);
    expect(r.text).not.toContain("[[");
    expect(r.text).toContain("[ [withheld] ]");
  });

  it("drops what is inside a fence before anything else looks at it", () => {
    const r = cleanText(`Done.\n\`\`\`\n${SHAPES[0]?.value}\n\`\`\`\nAll good.`);
    expect(r).toEqual({ text: "Done. All good.", withheld: 0, cut: false });
  });
});
