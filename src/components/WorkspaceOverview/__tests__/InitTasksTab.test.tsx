import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { mockInvoke, resetTauriMocks } from "../../../__test-utils__/tauri-mock";
import { InitTasksTab } from "../InitTasksTab";
import type { RepoTaskSummary } from "../../../types/terminal";

beforeEach(() => {
  resetTauriMocks();
});

const defaultProps = {
  activeLevelPath: "/projects",
  headlessSessions: [],
  sessions: [],
  onSpawnVisibleHeadless: vi.fn().mockResolvedValue(null),
  onPromoteHeadless: vi.fn().mockReturnValue(null),
  onPromoteSession: vi.fn(),
  onRemoveHeadless: vi.fn(),
};

function makeRepo(overrides: Partial<RepoTaskSummary> = {}): RepoTaskSummary {
  return {
    name: "repo-a",
    path: "/projects/repo-a",
    workspaceName: null,
    ungroomedCount: 5,
    groomedCount: 0,
    activeCount: 0,
    ...overrides,
  };
}

describe("InitTasksTab tracked data consumption", () => {
  it("uses trackedRepos when provided and does not call invoke", async () => {
    const trackedRepos = [makeRepo()];

    render(
      <InitTasksTab
        {...defaultProps}
        trackedRepos={trackedRepos}
        reposLoading={false}
      />
    );

    expect(screen.getByText("5 ungroomed tasks")).toBeTruthy();
    expect(mockInvoke).not.toHaveBeenCalledWith(
      "scan_tasks_across_repos",
      expect.anything()
    );
  });

  it("shows loading state from reposLoading prop when tracked", () => {
    render(
      <InitTasksTab
        {...defaultProps}
        trackedRepos={[makeRepo()]}
        reposLoading={true}
      />
    );

    expect(screen.getByText("Scanning tasks across repos...")).toBeTruthy();
  });

  it("falls back to local fetch when trackedRepos is not provided", async () => {
    mockInvoke.mockResolvedValue([makeRepo()]);

    render(<InitTasksTab {...defaultProps} />);

    expect(mockInvoke).toHaveBeenCalledWith("scan_tasks_across_repos", {
      folderPath: "/projects",
    });
  });

  it("calls onRefreshRepos when refresh button is clicked with tracked data", async () => {
    const onRefreshRepos = vi.fn();

    render(
      <InitTasksTab
        {...defaultProps}
        trackedRepos={[makeRepo()]}
        reposLoading={false}
        onRefreshRepos={onRefreshRepos}
      />
    );

    fireEvent.click(screen.getByText("Refresh"));
    expect(onRefreshRepos).toHaveBeenCalledTimes(1);
    expect(mockInvoke).not.toHaveBeenCalled();
  });
});

describe("InitTasksTab Trash All Completed visibility", () => {
  it("shows Trash All Completed when promoted sessions have headlessCompleted", () => {
    const onTrashCompleted = vi.fn();
    const trackedRepos = [makeRepo()];
    const promotedSession = {
      id: "tab-1",
      terminalId: null,
      label: "init-tasks -- repo-a",
      isClaudeSession: true,
      projectPath: "/projects/repo-a",
      projectName: "repo-a",
      isHeadlessPromoted: true,
      headlessTerminalId: "ht-1",
      headlessCompleted: true,
      visible: true,
    };

    render(
      <InitTasksTab
        {...defaultProps}
        trackedRepos={trackedRepos}
        reposLoading={false}
        sessions={[promotedSession]}
        onTrashCompleted={onTrashCompleted}
      />
    );

    const trashBtn = screen.getByText("Trash All Completed");
    expect(trashBtn).toBeTruthy();
    fireEvent.click(trashBtn);
    expect(onTrashCompleted).toHaveBeenCalledTimes(1);
  });

  it("hides Trash All Completed when no sessions are completed", () => {
    const trackedRepos = [makeRepo()];

    render(
      <InitTasksTab
        {...defaultProps}
        trackedRepos={trackedRepos}
        reposLoading={false}
        onTrashCompleted={vi.fn()}
      />
    );

    expect(screen.queryByText("Trash All Completed")).toBeNull();
  });
});

describe("InitTasksTab handleLaunchSession", () => {
  it("calls onSpawnVisibleHeadless when Init button is clicked", async () => {
    const onSpawnVisibleHeadless = vi.fn().mockResolvedValue("ht-1");
    const trackedRepos = [makeRepo({ name: "repo-a", path: "/projects/repo-a", ungroomedCount: 3 })];

    render(
      <InitTasksTab
        {...defaultProps}
        onSpawnVisibleHeadless={onSpawnVisibleHeadless}
        trackedRepos={trackedRepos}
        reposLoading={false}
      />
    );

    fireEvent.click(screen.getByText("Init"));
    expect(onSpawnVisibleHeadless).toHaveBeenCalledWith(
      "/projects/repo-a",
      "/reggie-init-tasks",
      "init-tasks -- repo-a",
      "opus",
      "high"
    );
  });

  it("does not call onLaunchHeadless (uses onSpawnVisibleHeadless instead)", async () => {
    // This test verifies the old callback pattern is NOT used.
    // The component should only use onSpawnVisibleHeadless, not any onLaunchHeadless prop.
    const onSpawnVisibleHeadless = vi.fn().mockResolvedValue("ht-1");
    const trackedRepos = [makeRepo({ ungroomedCount: 2 })];

    render(
      <InitTasksTab
        {...defaultProps}
        onSpawnVisibleHeadless={onSpawnVisibleHeadless}
        trackedRepos={trackedRepos}
        reposLoading={false}
      />
    );

    fireEvent.click(screen.getByText("Init"));
    // onSpawnVisibleHeadless should be called, confirming it uses the new API
    expect(onSpawnVisibleHeadless).toHaveBeenCalledTimes(1);
  });

  it("batch init calls onSpawnVisibleHeadless for each repo with ungroomed tasks", async () => {
    const onSpawnVisibleHeadless = vi.fn().mockResolvedValue("ht-x");
    const trackedRepos = [
      makeRepo({ name: "repo-a", path: "/projects/repo-a", ungroomedCount: 3 }),
      makeRepo({ name: "repo-b", path: "/projects/repo-b", ungroomedCount: 0 }),
      makeRepo({ name: "repo-c", path: "/projects/repo-c", ungroomedCount: 1 }),
    ];

    render(
      <InitTasksTab
        {...defaultProps}
        onSpawnVisibleHeadless={onSpawnVisibleHeadless}
        trackedRepos={trackedRepos}
        reposLoading={false}
      />
    );

    fireEvent.click(screen.getByText("Batch Init Tasks"));

    // Wait for the async batch operation
    await vi.waitFor(() => {
      expect(onSpawnVisibleHeadless).toHaveBeenCalledTimes(2);
    });

    expect(onSpawnVisibleHeadless).toHaveBeenCalledWith(
      "/projects/repo-a",
      "/reggie-init-tasks",
      "init-tasks -- repo-a",
      "opus",
      "high"
    );
    expect(onSpawnVisibleHeadless).toHaveBeenCalledWith(
      "/projects/repo-c",
      "/reggie-init-tasks",
      "init-tasks -- repo-c",
      "opus",
      "high"
    );
  });

  it("batch init skips repos with existing promoted sessions", async () => {
    const onSpawnVisibleHeadless = vi.fn().mockResolvedValue("ht-new");
    const trackedRepos = [
      makeRepo({ name: "repo-a", path: "/projects/repo-a", ungroomedCount: 3 }),
      makeRepo({ name: "repo-b", path: "/projects/repo-b", ungroomedCount: 2 }),
    ];

    const existingPromotedSession = {
      id: "tab-1",
      terminalId: null,
      label: "init-tasks -- repo-a",
      isClaudeSession: true,
      projectPath: "/projects/repo-a",
      projectName: "repo-a",
      isHeadlessPromoted: true,
      headlessTerminalId: "ht-existing",
      headlessCompleted: false,
      visible: true,
    };

    render(
      <InitTasksTab
        {...defaultProps}
        sessions={[existingPromotedSession]}
        onSpawnVisibleHeadless={onSpawnVisibleHeadless}
        trackedRepos={trackedRepos}
        reposLoading={false}
      />
    );

    fireEvent.click(screen.getByText("Batch Init Tasks"));

    await vi.waitFor(() => {
      expect(onSpawnVisibleHeadless).toHaveBeenCalledTimes(1);
    });

    // Should only spawn for repo-b since repo-a already has a promoted session
    expect(onSpawnVisibleHeadless).toHaveBeenCalledWith(
      "/projects/repo-b",
      "/reggie-init-tasks",
      "init-tasks -- repo-b",
      "opus",
      "high"
    );
  });

  it("batch init skips repos with existing headless sessions", async () => {
    const onSpawnVisibleHeadless = vi.fn().mockResolvedValue("ht-new");
    const trackedRepos = [
      makeRepo({ name: "repo-a", path: "/projects/repo-a", ungroomedCount: 3 }),
      makeRepo({ name: "repo-b", path: "/projects/repo-b", ungroomedCount: 2 }),
    ];

    const existingHeadless = {
      terminalId: "ht-existing",
      projectPath: "/projects/repo-a",
      projectName: "repo-a",
      label: "init-tasks -- repo-a",
      needsAttention: false,
      exited: false,
      exitCode: null,
      bufferSize: 0,
      completed: false,
    };

    render(
      <InitTasksTab
        {...defaultProps}
        headlessSessions={[existingHeadless]}
        onSpawnVisibleHeadless={onSpawnVisibleHeadless}
        trackedRepos={trackedRepos}
        reposLoading={false}
      />
    );

    fireEvent.click(screen.getByText("Batch Init Tasks"));

    await vi.waitFor(() => {
      expect(onSpawnVisibleHeadless).toHaveBeenCalledTimes(1);
    });

    // Should only spawn for repo-b since repo-a has an existing headless session
    expect(onSpawnVisibleHeadless).toHaveBeenCalledWith(
      "/projects/repo-b",
      "/reggie-init-tasks",
      "init-tasks -- repo-b",
      "opus",
      "high"
    );
  });

  it("batch button tooltip references the reggie-prefixed command", () => {
    const trackedRepos = [makeRepo({ ungroomedCount: 1 })];

    render(
      <InitTasksTab
        {...defaultProps}
        trackedRepos={trackedRepos}
        reposLoading={false}
      />
    );

    const batchBtn = screen.getByText("Batch Init Tasks");
    expect(batchBtn.getAttribute("title")).toBe(
      "Launch /reggie-init-tasks for all repos with ungroomed tasks"
    );
  });

  it("batch init does not skip repos with dead promoted sessions", async () => {
    const onSpawnVisibleHeadless = vi.fn().mockResolvedValue("ht-new");
    const trackedRepos = [
      makeRepo({ name: "repo-a", path: "/projects/repo-a", ungroomedCount: 3 }),
    ];

    const deadPromotedSession = {
      id: "tab-dead",
      terminalId: null,
      label: "init-tasks -- repo-a",
      isClaudeSession: true,
      projectPath: "/projects/repo-a",
      projectName: "repo-a",
      isHeadlessPromoted: true,
      headlessTerminalId: "ht-dead",
      headlessCompleted: true,
      visible: true,
      dead: true,
    };

    render(
      <InitTasksTab
        {...defaultProps}
        sessions={[deadPromotedSession]}
        onSpawnVisibleHeadless={onSpawnVisibleHeadless}
        trackedRepos={trackedRepos}
        reposLoading={false}
      />
    );

    fireEvent.click(screen.getByText("Batch Init Tasks"));

    await vi.waitFor(() => {
      expect(onSpawnVisibleHeadless).toHaveBeenCalledTimes(1);
    });

    // Dead promoted sessions should NOT block re-launching
    expect(onSpawnVisibleHeadless).toHaveBeenCalledWith(
      "/projects/repo-a",
      "/reggie-init-tasks",
      "init-tasks -- repo-a",
      "opus",
      "high"
    );
  });
});
