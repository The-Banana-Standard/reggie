import { describe, expect, it } from "vitest";
import { briefDraft, lintBrief, parseBrief, renderBriefTemplate } from "./brief.js";

/** A brief that satisfies the contract, so each test can break exactly one thing. */
function fullBrief(slug = "demo"): string {
  return [
    "---",
    `slug: ${slug}`,
    "title: Cap login retries on web",
    "area: src/auth",
    "size: small",
    "risk: high",
    "priority: P1",
    "author: test",
    "created: 2026-09-08",
    "---",
    "# Cap login retries on web",
    "",
    "## Problem",
    "Web clients retry login forever when the server is down, so support sees a flood of reports",
    "from people who cannot tell that the site is offline rather than broken.",
    "",
    "Support has raised it twice this month.",
    "",
    "## Why now",
    "The auth endpoint is already near its rate limit, and the next outage will take the login page down with it.",
    "",
    "## Suspected area",
    "- src/auth/login.ts because the retry loop is written there",
    "- src/auth/ because the error surface is shared with the signup form",
    "",
    "## Open questions",
    "- Does the mobile client share this retry loop, which would widen the change to two platforms?",
    "",
    "## Not this",
    "- Server-side rate limiting, which is a separate task against the API gateway",
    "",
  ].join("\n");
}

describe("brief contract", () => {
  it("template fails lint until placeholders are replaced", () => {
    const tpl = renderBriefTemplate({ slug: "demo", title: "Demo", author: "test" });
    const r = lintBrief(tpl);
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.includes("placeholder"))).toBe(true);
    expect(r.errors.some((e) => e.includes("size"))).toBe(true);
    expect(r.errors.some((e) => e.includes("priority"))).toBe(true);
  });

  it("a template prefilled by triage still needs its sections written", () => {
    const tpl = renderBriefTemplate({ slug: "demo", title: "Demo", author: "test", area: "src/auth", size: "small", priority: "P2", risk: "low" });
    const meta = parseBrief(tpl).meta;
    expect(meta).toMatchObject({ slug: "demo", title: "Demo", area: "src/auth", size: "small", risk: "low", priority: "P2", author: "test" });
    const r = lintBrief(tpl);
    expect(r.ok).toBe(false);
    expect(r.errors.every((e) => e.includes("placeholder"))).toBe(true);
    expect(r.errors).toHaveLength(5);
  });

  it("a complete brief passes", () => {
    const r = lintBrief(fullBrief());
    expect(r.errors).toEqual([]);
    expect(r.warnings).toEqual([]);
    expect(r.ok).toBe(true);
  });

  it("parses front matter, sections, and the derived lists", () => {
    const b = parseBrief(fullBrief("cap-login-retries"));
    expect(b.meta).toEqual({
      slug: "cap-login-retries",
      title: "Cap login retries on web",
      area: "src/auth",
      size: "small",
      risk: "high",
      priority: "P1",
      author: "test",
      created: "2026-09-08",
    });
    expect([...b.sections.keys()]).toEqual(["Problem", "Why now", "Suspected area", "Open questions", "Not this"]);
    expect(b.sections.get("Why now")).toContain("near its rate limit");
    expect(b.problem).toBe(
      "Web clients retry login forever when the server is down, so support sees a flood of reports from people who cannot tell that the site is offline rather than broken.",
    );
    expect(b.areas).toEqual([
      "src/auth/login.ts because the retry loop is written there",
      "src/auth/ because the error surface is shared with the signup form",
    ]);
    expect(b.questions).toHaveLength(1);
  });

  it("falls back to the H1 for the title and reads an unknown size or priority as unset", () => {
    const b = parseBrief("---\nslug: demo\nsize: huge\npriority: P9\n---\n# From the heading\n\n## Problem\nSomething.\n");
    expect(b.meta.title).toBe("From the heading");
    expect(b.meta.size).toBe("unset");
    expect(b.meta.priority).toBe("unset");
    expect(b.meta.risk).toBe("unset");
    expect(b.problem).toBe("Something.");
  });

  it("flags a missing slug", () => {
    const r = lintBrief(fullBrief().replace("slug: demo\n", ""));
    expect(r.ok).toBe(false);
    expect(r.errors).toContain("front matter: missing slug");
  });

  it("flags a missing title", () => {
    const r = lintBrief(fullBrief().replace("title: Cap login retries on web\n", "").replace("# Cap login retries on web\n", ""));
    expect(r.ok).toBe(false);
    expect(r.errors).toContain("front matter: missing title");
  });

  it("flags an unset size", () => {
    const r = lintBrief(fullBrief().replace("size: small", "size: unset"));
    expect(r.ok).toBe(false);
    expect(r.errors).toContain("front matter: size must be small, medium, or large");
  });

  it("flags an unset priority", () => {
    const r = lintBrief(fullBrief().replace("priority: P1", "priority: "));
    expect(r.ok).toBe(false);
    expect(r.errors).toContain("front matter: priority must be P1, P2, or P3");
  });

  it("flags a missing section", () => {
    const r = lintBrief(fullBrief().replace("## Not this", "## Something else"));
    expect(r.ok).toBe(false);
    expect(r.errors).toContain("missing section: ## Not this");
  });

  it("flags an empty section", () => {
    const r = lintBrief(fullBrief().replace("- Server-side rate limiting, which is a separate task against the API gateway\n", ""));
    expect(r.ok).toBe(false);
    expect(r.errors).toContain("empty section: ## Not this");
  });

  it("flags a placeholder left in one section", () => {
    const r = lintBrief(fullBrief().replace("The auth endpoint is already near its rate limit, and the next outage will take the login page down with it.", "(why this matters now)"));
    expect(r.ok).toBe(false);
    expect(r.errors).toEqual(["placeholder text still present in ## Why now"]);
  });

  it("flags an unresolved TBD or TODO", () => {
    const r = lintBrief(fullBrief().replace("Does the mobile client", "TBD: does the mobile client"));
    expect(r.ok).toBe(false);
    expect(r.errors).toContain("unresolved TBD/TODO in ## Open questions");
  });

  it("advises without blocking on unset risk, an empty area, and a thin problem", () => {
    const thin = fullBrief()
      .replace("risk: high", "risk: unset")
      .replace("area: src/auth", "area: ")
      .replace(
        "Web clients retry login forever when the server is down, so support sees a flood of reports\nfrom people who cannot tell that the site is offline rather than broken.\n\nSupport has raised it twice this month.",
        "Login retries.",
      );
    const r = lintBrief(thin);
    expect(r.ok).toBe(true);
    expect(r.errors).toEqual([]);
    expect(r.warnings.some((w) => w.includes("risk is unset"))).toBe(true);
    expect(r.warnings.some((w) => w.includes("area is empty"))).toBe(true);
    expect(r.warnings.some((w) => w.startsWith("Problem: too short"))).toBe(true);
  });

  it("advises when Suspected area names nothing", () => {
    const r = lintBrief(fullBrief().replace(
      "- src/auth/login.ts because the retry loop is written there\n- src/auth/ because the error surface is shared with the signup form",
      "Nothing obvious yet; the retry loop has not been located.",
    ));
    expect(r.ok).toBe(true);
    expect(r.warnings.some((w) => w.startsWith("Suspected area:"))).toBe(true);
  });
});

describe("briefDraft", () => {
  it("calls a bare scaffold a draft, naming the Problem and every other placeholder section", () => {
    // With no intake line to prefill from, the Problem is the hint too, so it is a placeholder
    // rather than an empty section: five of the five sections are untouched.
    const d = briefDraft(renderBriefTemplate({ slug: "demo", title: "demo", author: "test" }));
    expect(d.draft).toBe(true);
    expect(d.problem).toBeNull();
    expect(d.placeholders).toEqual(["Problem", "Why now", "Suspected area", "Open questions", "Not this"]);
    expect(d.reason).toBe("still triage's scaffold: placeholder text in Problem, Why now, Suspected area, Open questions, Not this");
  });

  it("calls a scaffold prefilled from an intake line a draft, naming only the placeholder sections", () => {
    const d = briefDraft(renderBriefTemplate({ slug: "demo", title: "Login loops forever", author: "test", problem: "Login loops forever when the server is down." }));
    expect(d.draft).toBe(true);
    expect(d.problem).toBeNull();
    expect(d.placeholders).toEqual(["Why now", "Suspected area", "Open questions", "Not this"]);
    expect(d.reason).toBe("still triage's scaffold: placeholder text in Why now, Suspected area, Open questions, Not this");
  });

  it("does not call a written brief a draft just because size and priority are unset", () => {
    const written = fullBrief().replace("size: small", "size: unset").replace("priority: P1", "priority: unset");
    const lint = lintBrief(written);
    expect(lint.ok).toBe(false);
    expect(lint.errors).toEqual([
      "front matter: size must be small, medium, or large",
      "front matter: priority must be P1, P2, or P3",
    ]);
    const d = briefDraft(written);
    expect(d.draft).toBe(false);
    expect(d.reason).toBe("");
    expect(d.placeholders).toEqual([]);
    expect(d.problem).toBeNull();
  });

  it("calls a brief with an empty Problem a draft, and one with no Problem heading at all", () => {
    const empty = fullBrief().replace(
      "Web clients retry login forever when the server is down, so support sees a flood of reports\nfrom people who cannot tell that the site is offline rather than broken.\n\nSupport has raised it twice this month.",
      "",
    );
    const d = briefDraft(empty);
    expect(d.draft).toBe(true);
    expect(d.problem).toBe("empty");
    expect(d.placeholders).toEqual([]);
    expect(d.reason).toBe("still triage's scaffold: the Problem section is empty");

    const gone = briefDraft(fullBrief().replace("## Problem", "## Background"));
    expect(gone.draft).toBe(true);
    expect(gone.problem).toBe("missing");
    expect(gone.reason).toBe("still triage's scaffold: the Problem section is missing");
  });

  it("passes a brief that satisfies the contract", () => {
    expect(lintBrief(fullBrief()).ok).toBe(true);
    expect(briefDraft(fullBrief())).toEqual({ draft: false, reason: "", placeholders: [], problem: null });
  });
});
