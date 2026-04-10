import { describe, it, expect } from "vitest";
import { groupByWorkspace } from "../groupByWorkspace";
import type { RepoTaskSummary } from "../../../types/terminal";

function makeRepo(overrides: Partial<RepoTaskSummary> = {}): RepoTaskSummary {
  return {
    name: "repo",
    path: "/path/repo",
    workspaceName: null,
    ungroomedCount: 0,
    groomedCount: 0,
    activeCount: 0,
    ...overrides,
  };
}

describe("groupByWorkspace", () => {
  it("returns empty array for empty input", () => {
    const result = groupByWorkspace([]);
    expect(result).toEqual([]);
  });

  it("groups repos with the same workspaceName together", () => {
    const repos = [
      makeRepo({ name: "a", workspaceName: "ws1" }),
      makeRepo({ name: "b", workspaceName: "ws1" }),
    ];
    const result = groupByWorkspace(repos);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("ws1");
    expect(result[0].isWorkspace).toBe(true);
    expect(result[0].repos).toHaveLength(2);
  });

  it("puts repos without workspaceName into a Standalone group", () => {
    const repos = [
      makeRepo({ name: "solo-1" }),
      makeRepo({ name: "solo-2" }),
    ];
    const result = groupByWorkspace(repos);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("Standalone");
    expect(result[0].repos).toHaveLength(2);
  });

  it("separates workspace repos from standalone repos", () => {
    const repos = [
      makeRepo({ name: "ws-repo", workspaceName: "my-ws" }),
      makeRepo({ name: "solo-repo" }),
    ];
    const result = groupByWorkspace(repos);
    expect(result).toHaveLength(2);

    const wsGroup = result.find((g) => g.name === "my-ws");
    expect(wsGroup).toBeTruthy();
    expect(wsGroup!.isWorkspace).toBe(true);
    expect(wsGroup!.repos).toHaveLength(1);

    const standaloneGroup = result.find((g) => g.name === "Standalone");
    expect(standaloneGroup).toBeTruthy();
    expect(standaloneGroup!.repos).toHaveLength(1);
  });

  it("creates separate groups for different workspaces", () => {
    const repos = [
      makeRepo({ name: "a", workspaceName: "ws-alpha" }),
      makeRepo({ name: "b", workspaceName: "ws-beta" }),
      makeRepo({ name: "c", workspaceName: "ws-alpha" }),
    ];
    const result = groupByWorkspace(repos);
    expect(result).toHaveLength(2);

    const alpha = result.find((g) => g.name === "ws-alpha");
    expect(alpha!.repos).toHaveLength(2);

    const beta = result.find((g) => g.name === "ws-beta");
    expect(beta!.repos).toHaveLength(1);
  });

  it("sets isWorkspace to false for a single standalone repo", () => {
    const repos = [makeRepo({ name: "lonely" })];
    const result = groupByWorkspace(repos);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("Standalone");
    expect(result[0].isWorkspace).toBe(false);
  });

  it("sets isWorkspace to true for multiple standalone repos", () => {
    const repos = [
      makeRepo({ name: "a" }),
      makeRepo({ name: "b" }),
    ];
    const result = groupByWorkspace(repos);
    expect(result[0].isWorkspace).toBe(true);
  });

  it("workspace groups always appear before standalone group", () => {
    const repos = [
      makeRepo({ name: "standalone-first" }),
      makeRepo({ name: "ws-repo", workspaceName: "workspace" }),
    ];
    const result = groupByWorkspace(repos);
    expect(result).toHaveLength(2);
    expect(result[0].name).toBe("workspace");
    expect(result[1].name).toBe("Standalone");
  });

  it("preserves all repo data in grouped output", () => {
    const repo = makeRepo({
      name: "my-project",
      path: "/home/user/my-project",
      workspaceName: "dev",
      ungroomedCount: 3,
      groomedCount: 5,
      activeCount: 1,
    });
    const result = groupByWorkspace([repo]);
    expect(result[0].repos[0]).toEqual(repo);
  });
});
