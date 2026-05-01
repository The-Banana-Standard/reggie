import { describe, it, expect } from "vitest";
import { domainForLabel, isWorkflowLabel, slugFromLabel } from "../sessionLabels";

describe("domainForLabel", () => {
  it("classifies code, reggie-system, and debug labels", () => {
    expect(domainForLabel("code -- repo/foo")).toBe("code");
    expect(domainForLabel("reggie-sys -- repo/foo")).toBe("reggieSystem");
    expect(domainForLabel("debug -- repo/foo")).toBe("debug");
  });

  it("returns null for non-workflow labels", () => {
    expect(domainForLabel("init-tasks -- repo/foo")).toBeNull();
    expect(domainForLabel("custom label")).toBeNull();
    expect(domainForLabel("")).toBeNull();
  });
});

describe("isWorkflowLabel", () => {
  it("matches the three workflow prefixes", () => {
    expect(isWorkflowLabel("code -- repo/foo")).toBe(true);
    expect(isWorkflowLabel("reggie-sys -- repo/foo")).toBe(true);
    expect(isWorkflowLabel("debug -- repo/foo")).toBe(true);
  });

  it("rejects non-workflow labels", () => {
    expect(isWorkflowLabel("init-tasks -- repo/foo")).toBe(false);
    expect(isWorkflowLabel("anything else")).toBe(false);
  });
});

describe("slugFromLabel", () => {
  it("extracts slug from each workflow prefix", () => {
    expect(slugFromLabel("code -- repo/fix-toggle")).toBe("fix-toggle");
    expect(slugFromLabel("reggie-sys -- repo/fix-debug-flow")).toBe("fix-debug-flow");
    expect(slugFromLabel("debug -- repo/investigate-crash")).toBe("investigate-crash");
  });

  it("returns null for non-workflow labels", () => {
    expect(slugFromLabel("init-tasks -- repo/something")).toBeNull();
    expect(slugFromLabel("plain label")).toBeNull();
    expect(slugFromLabel("")).toBeNull();
  });

  it("returns null for malformed workflow labels with no slash", () => {
    expect(slugFromLabel("code -- repo-only-no-slug")).toBeNull();
  });

  it("returns null when slug portion is empty or whitespace", () => {
    expect(slugFromLabel("code -- repo/")).toBeNull();
    expect(slugFromLabel("code -- repo/   ")).toBeNull();
  });

  it("uses the LAST slash so workspace-style paths still yield the slug", () => {
    expect(slugFromLabel("code -- workspace/sub/repo/my-slug")).toBe("my-slug");
  });
});
