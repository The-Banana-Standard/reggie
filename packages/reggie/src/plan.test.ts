import { describe, expect, it } from "vitest";
import { fullPlan } from "../test/helpers.js";
import { DEFAULT_RISK } from "./people.js";
import { lintPlan, parsePlan, planCriteria, renderPlanTemplate, riskFromFiles, setPlanRisk } from "./plan.js";

describe("plan contract", () => {
  it("template fails lint until placeholders are replaced", () => {
    const tpl = renderPlanTemplate({ slug: "demo", title: "Demo", author: "test" });
    const r = lintPlan(tpl);
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.includes("placeholder"))).toBe(true);
    expect(r.errors.some((e) => e.includes("risk"))).toBe(true);
  });

  it("a complete plan passes", () => {
    const r = lintPlan(fullPlan("demo"));
    expect(r.errors).toEqual([]);
    expect(r.ok).toBe(true);
  });

  it("parses criteria, files, and front matter", () => {
    const p = parsePlan(fullPlan("demo", ["src/a.ts", "src/b.ts"]));
    expect(p.meta.slug).toBe("demo");
    expect(p.meta.risk).toBe("low");
    expect(p.criteria).toHaveLength(2);
    expect(p.files).toEqual(["src/a.ts", "src/b.ts"]);
  });

  it("flags missing sections and TBD", () => {
    const broken = fullPlan("demo").replace("## Bail conditions", "## Something else").replace("Three attempts", "TBD attempts");
    const r = lintPlan(broken);
    expect(r.ok).toBe(false);
    expect(r.errors).toContain("missing section: ## Bail conditions");
    expect(r.errors.some((e) => e.includes("TBD"))).toBe(true);
  });

  it("warns when verification has fewer bullets than criteria", () => {
    const thin = fullPlan("demo").replace("- Manually simulate a server outage and screenshot the offline message to evidence/offline.png\n", "");
    const r = lintPlan(thin);
    expect(r.ok).toBe(true);
    expect(r.warnings.some((w) => w.includes("Verification strategy"))).toBe(true);
  });

  it("computes risk from file paths and rewrites the front matter", () => {
    expect(riskFromFiles(["src/auth/login.ts"], DEFAULT_RISK)).toBe("high");
    expect(riskFromFiles(["src/lib/util.ts"], DEFAULT_RISK)).toBe("medium");
    expect(riskFromFiles(["docs/readme.md"], DEFAULT_RISK)).toBe("low");
    const updated = setPlanRisk(fullPlan("demo"), "high");
    expect(parsePlan(updated).meta.risk).toBe("high");
  });
});

describe("criterion keys", () => {
  const section = [
    "- [ ] AC1 The first criterion, on one line",
    "- [x] AC2 The second criterion wraps",
    "  onto an indented second line",
    "",
    "  and a paragraph after a blank line",
    "- [ ] AC3 The third criterion",
    "  - with a nested bullet under it",
  ].join("\n");

  it("gives each criterion its number, its one-line text and a key of c: and twelve hex characters", () => {
    const criteria = planCriteria(section);
    expect(criteria.map((c) => [c.n, c.text])).toEqual([[1, "AC1 The first criterion, on one line"], [2, "AC2 The second criterion wraps"], [3, "AC3 The third criterion"]]);
    for (const c of criteria) expect(c.key).toMatch(/^c:[0-9a-f]{12}$/);
    expect(new Set(criteria.map((c) => c.key)).size).toBe(3);
  });

  it("keeps a key through reordering, renumbering, a ticked box and changed indentation", () => {
    const before = new Map(planCriteria(section).map((c) => [c.text, c.key]));
    const moved = [
      "- [x] AC3 The third criterion",
      "    - with a nested bullet under it",
      "- [ ] AC1 The first criterion, on one line",
      "- [ ] AC2 The second criterion wraps",
      "      onto an indented second line",
      "  and a paragraph after a blank line",
    ].join("\n");
    const after = planCriteria(moved);
    expect(after.map((c) => c.n)).toEqual([1, 2, 3]);
    for (const c of after) expect(c.key).toBe(before.get(c.text));
  });

  it("makes a new key when one word changes on the first line, and again when one changes on a continuation line", () => {
    const key = (text: string) => planCriteria(text)[1]?.key;
    const original = key(section);
    const firstLine = key(section.replace("second criterion wraps", "second criterion bends"));
    const continuation = key(section.replace("indented second line", "indented third line"));
    const afterBlank = key(section.replace("a paragraph after", "a sentence after"));
    expect(new Set([original, firstLine, continuation, afterBlank]).size).toBe(4);
    // The other criteria are untouched by an edit to this one.
    expect(planCriteria(section.replace("indented second line", "indented third line"))[0]?.key).toBe(planCriteria(section)[0]?.key);
  });

  it("tells identical criteria apart with #2 and #3, in the order they appear", () => {
    const twice = planCriteria(["- [ ] The same words, written three times", "- [ ] Another criterion between them", "- [ ] The same words, written three times", "- [ ] The same   words, written three times"].join("\n"));
    const first = twice[0]?.key ?? "";
    expect(twice.map((c) => c.key)).toEqual([first, twice[1]?.key, `${first}#2`, `${first}#3`]);
  });

  it("returns from parsePlan exactly the criteria the line filter it replaced returned", () => {
    const old = (content: string): string[] =>
      (parsePlan(content).sections.get("Acceptance criteria") ?? "")
        .split("\n")
        .map((l) => l.trim())
        .filter((l) => /^- \[[ xX]\]\s+/.test(l))
        .map((l) => l.replace(/^- \[[ xX]\]\s+/, "").trim());
    const awkward = fullPlan("demo").replace(
      "- [ ] A unit test covers the cap and the message",
      ["- [X] A unit test covers the cap and the message", "  wrapped onto a second line", "   - [ ] an indented checkbox, which the old reader also counted", "- [ ]", "- [ ]   ", "- not a checkbox at all", "* [ ] a star bullet is not a criterion"].join("\n"),
    );
    for (const content of [fullPlan("demo"), awkward, renderPlanTemplate({ slug: "t", title: "T", author: "a" }), "no front matter, no sections"]) {
      expect(parsePlan(content).criteria).toEqual(old(content));
    }
    expect(parsePlan(awkward).criteria).toHaveLength(3);
  });
});

