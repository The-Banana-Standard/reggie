import { describe, expect, it } from "vitest";
import { fullPlan } from "../test/helpers.js";
import { DEFAULT_RISK } from "./people.js";
import { lintPlan, parsePlan, renderPlanTemplate, riskFromFiles, setPlanRisk } from "./plan.js";

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
