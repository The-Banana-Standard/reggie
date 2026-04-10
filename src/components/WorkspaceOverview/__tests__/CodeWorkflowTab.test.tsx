import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { mockInvoke, resetTauriMocks } from "../../../__test-utils__/tauri-mock";
import { CodeWorkflowTab } from "../CodeWorkflowTab";
import type { RepoTaskSummary } from "../../../types/terminal";

beforeEach(() => {
  resetTauriMocks();
});

const defaultProps = {
  activeLevelPath: "/projects",
  headlessSessions: [],
  sessions: [],
  onLaunchHeadless: vi.fn().mockResolvedValue(null),
  onPromoteHeadless: vi.fn().mockReturnValue(null),
  onPromoteSession: vi.fn(),
  onRemoveHeadless: vi.fn(),
};

function makeRepo(overrides: Partial<RepoTaskSummary> = {}): RepoTaskSummary {
  return {
    name: "repo-a",
    path: "/projects/repo-a",
    workspaceName: null,
    ungroomedCount: 0,
    groomedCount: 3,
    activeCount: 0,
    ...overrides,
  };
}

describe("CodeWorkflowTab tracked data consumption", () => {
  it("uses trackedRepos when provided and does not call invoke", async () => {
    const trackedRepos = [makeRepo()];

    const { container } = render(
      <CodeWorkflowTab
        {...defaultProps}
        trackedRepos={trackedRepos}
        reposLoading={false}
      />
    );

    // Should render the repo data from tracked props (header count)
    const headerCount = container.querySelector(".dashboard-tab-header-count");
    expect(headerCount?.textContent).toBe("3 tasks");
    // Should NOT have called scan_tasks_across_repos
    expect(mockInvoke).not.toHaveBeenCalledWith(
      "scan_tasks_across_repos",
      expect.anything()
    );
  });

  it("shows loading state from reposLoading prop when tracked", () => {
    render(
      <CodeWorkflowTab
        {...defaultProps}
        trackedRepos={[makeRepo()]}
        reposLoading={true}
      />
    );

    expect(screen.getByText("Scanning tasks across repos...")).toBeTruthy();
  });

  it("falls back to local fetch when trackedRepos is not provided", async () => {
    mockInvoke.mockResolvedValue([makeRepo({ groomedCount: 7 })]);

    render(<CodeWorkflowTab {...defaultProps} />);

    // Should call invoke for scan
    expect(mockInvoke).toHaveBeenCalledWith("scan_tasks_across_repos", {
      folderPath: "/projects",
    });
  });

  it("calls onRefreshRepos when refresh button is clicked with tracked data", async () => {
    const onRefreshRepos = vi.fn();

    render(
      <CodeWorkflowTab
        {...defaultProps}
        trackedRepos={[makeRepo()]}
        reposLoading={false}
        onRefreshRepos={onRefreshRepos}
      />
    );

    fireEvent.click(screen.getByText("Refresh"));
    expect(onRefreshRepos).toHaveBeenCalledTimes(1);
    // Should NOT call invoke
    expect(mockInvoke).not.toHaveBeenCalled();
  });
});

describe("CodeWorkflowTab totalGroomed includes activeCount", () => {
  it("header shows groomed + active count sum as total tasks", () => {
    const trackedRepos = [
      makeRepo({ groomedCount: 3, activeCount: 2 }),
      makeRepo({ name: "repo-b", path: "/projects/repo-b", groomedCount: 1, activeCount: 1 }),
    ];

    const { container } = render(
      <CodeWorkflowTab
        {...defaultProps}
        trackedRepos={trackedRepos}
        reposLoading={false}
      />
    );

    // totalGroomed = (3+2) + (1+1) = 7
    const headerCount = container.querySelector(".dashboard-tab-header-count");
    expect(headerCount?.textContent).toBe("7 tasks");
  });

  it("header shows 0 tasks when both groomed and active are 0", () => {
    const trackedRepos = [
      makeRepo({ groomedCount: 0, activeCount: 0 }),
    ];

    const { container } = render(
      <CodeWorkflowTab
        {...defaultProps}
        trackedRepos={trackedRepos}
        reposLoading={false}
      />
    );

    const headerCount = container.querySelector(".dashboard-tab-header-count");
    expect(headerCount?.textContent).toBe("0 tasks");
  });

  it("disables batch start button when totalGroomed is 0", () => {
    const trackedRepos = [
      makeRepo({ groomedCount: 0, activeCount: 0 }),
    ];

    render(
      <CodeWorkflowTab
        {...defaultProps}
        trackedRepos={trackedRepos}
        reposLoading={false}
      />
    );

    const batchBtn = screen.getByText("Batch Start Coding");
    expect(batchBtn.hasAttribute("disabled")).toBe(true);
  });

  it("enables batch start button when activeCount > 0 even if groomedCount is 0", () => {
    const trackedRepos = [
      makeRepo({ groomedCount: 0, activeCount: 2 }),
    ];

    render(
      <CodeWorkflowTab
        {...defaultProps}
        trackedRepos={trackedRepos}
        reposLoading={false}
      />
    );

    const batchBtn = screen.getByText("Batch Start Coding");
    expect(batchBtn.hasAttribute("disabled")).toBe(false);
  });

  it("shows Trash All Completed when promoted sessions have headlessCompleted", () => {
    const onTrashCompleted = vi.fn();
    const trackedRepos = [makeRepo()];
    const promotedSession = {
      id: "tab-1",
      terminalId: null,
      label: "code -- repo-a/task",
      isClaudeSession: true,
      projectPath: "/projects/repo-a",
      projectName: "repo-a",
      isHeadlessPromoted: true,
      headlessTerminalId: "ht-1",
      headlessCompleted: true,
      visible: true,
    };

    render(
      <CodeWorkflowTab
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
      <CodeWorkflowTab
        {...defaultProps}
        trackedRepos={trackedRepos}
        reposLoading={false}
        onTrashCompleted={vi.fn()}
      />
    );

    expect(screen.queryByText("Trash All Completed")).toBeNull();
  });

  it("threads onHideSession prop through to RepoTaskRow", () => {
    const onHideSession = vi.fn();
    const trackedRepos = [makeRepo()];

    render(
      <CodeWorkflowTab
        {...defaultProps}
        trackedRepos={trackedRepos}
        reposLoading={false}
        onHideSession={onHideSession}
      />
    );

    // Repo row should be rendered (the presence of onHideSession does not change rendering)
    expect(screen.getByText("repo-a")).toBeTruthy();
  });
});

describe("CodeWorkflowTab tier-to-model/effort threading", () => {
  it("passes parsed model and effort from tier to onLaunchHeadless", async () => {
    const onLaunchHeadless = vi.fn().mockResolvedValue("ht-1");
    const trackedRepos = [makeRepo({ groomedCount: 2 })];

    mockInvoke.mockResolvedValue({
      slugs: [
        { slug: "task-a", tier: "opus:high" },
        { slug: "task-b", tier: "sonnet:medium" },
      ],
      totalGroomed: 2,
    });

    render(
      <CodeWorkflowTab
        {...defaultProps}
        onLaunchHeadless={onLaunchHeadless}
        trackedRepos={trackedRepos}
        reposLoading={false}
      />
    );

    // Click the Start button on the repo row
    fireEvent.click(screen.getByText("Start"));

    await vi.waitFor(() => {
      expect(onLaunchHeadless).toHaveBeenCalledTimes(2);
    });

    expect(onLaunchHeadless).toHaveBeenCalledWith(
      "/projects/repo-a",
      "/reggie-code-workflow --yes task-a",
      "code -- repo-a/task-a",
      "opus",
      "high",
    );
    expect(onLaunchHeadless).toHaveBeenCalledWith(
      "/projects/repo-a",
      "/reggie-code-workflow --yes task-b",
      "code -- repo-a/task-b",
      "sonnet",
      "medium",
    );
  });

  it("passes undefined model and effort when tier is null", async () => {
    const onLaunchHeadless = vi.fn().mockResolvedValue("ht-2");
    const trackedRepos = [makeRepo({ groomedCount: 1 })];

    mockInvoke.mockResolvedValue({
      slugs: [{ slug: "task-x", tier: null }],
      totalGroomed: 1,
    });

    render(
      <CodeWorkflowTab
        {...defaultProps}
        onLaunchHeadless={onLaunchHeadless}
        trackedRepos={trackedRepos}
        reposLoading={false}
      />
    );

    fireEvent.click(screen.getByText("Start"));

    await vi.waitFor(() => {
      expect(onLaunchHeadless).toHaveBeenCalledTimes(1);
    });

    expect(onLaunchHeadless).toHaveBeenCalledWith(
      "/projects/repo-a",
      "/reggie-code-workflow --yes task-x",
      "code -- repo-a/task-x",
      undefined,
      undefined,
    );
  });

  it("handles empty string tier as no model/effort", async () => {
    const onLaunchHeadless = vi.fn().mockResolvedValue("ht-empty");
    const trackedRepos = [makeRepo({ groomedCount: 1 })];

    mockInvoke.mockResolvedValue({
      slugs: [{ slug: "task-e", tier: "" }],
      totalGroomed: 1,
    });

    render(
      <CodeWorkflowTab
        {...defaultProps}
        onLaunchHeadless={onLaunchHeadless}
        trackedRepos={trackedRepos}
        reposLoading={false}
      />
    );

    fireEvent.click(screen.getByText("Start"));

    await vi.waitFor(() => {
      expect(onLaunchHeadless).toHaveBeenCalledTimes(1);
    });

    expect(onLaunchHeadless).toHaveBeenCalledWith(
      "/projects/repo-a",
      "/reggie-code-workflow --yes task-e",
      "code -- repo-a/task-e",
      undefined,
      undefined,
    );
  });

  it("handles tier with only effort (colon-prefixed) as no model", async () => {
    const onLaunchHeadless = vi.fn().mockResolvedValue("ht-colon");
    const trackedRepos = [makeRepo({ groomedCount: 1 })];

    mockInvoke.mockResolvedValue({
      slugs: [{ slug: "task-c", tier: ":high" }],
      totalGroomed: 1,
    });

    render(
      <CodeWorkflowTab
        {...defaultProps}
        onLaunchHeadless={onLaunchHeadless}
        trackedRepos={trackedRepos}
        reposLoading={false}
      />
    );

    fireEvent.click(screen.getByText("Start"));

    await vi.waitFor(() => {
      expect(onLaunchHeadless).toHaveBeenCalledTimes(1);
    });

    expect(onLaunchHeadless).toHaveBeenCalledWith(
      "/projects/repo-a",
      "/reggie-code-workflow --yes task-c",
      "code -- repo-a/task-c",
      undefined,
      "high",
    );
  });

  it("handles tier with only model and no effort", async () => {
    const onLaunchHeadless = vi.fn().mockResolvedValue("ht-3");
    const trackedRepos = [makeRepo({ groomedCount: 1 })];

    mockInvoke.mockResolvedValue({
      slugs: [{ slug: "task-y", tier: "opus" }],
      totalGroomed: 1,
    });

    render(
      <CodeWorkflowTab
        {...defaultProps}
        onLaunchHeadless={onLaunchHeadless}
        trackedRepos={trackedRepos}
        reposLoading={false}
      />
    );

    fireEvent.click(screen.getByText("Start"));

    await vi.waitFor(() => {
      expect(onLaunchHeadless).toHaveBeenCalledTimes(1);
    });

    expect(onLaunchHeadless).toHaveBeenCalledWith(
      "/projects/repo-a",
      "/reggie-code-workflow --yes task-y",
      "code -- repo-a/task-y",
      "opus",
      undefined,
    );
  });
});

describe("CodeWorkflowTab reggie-prefix correctness", () => {
  it("uses reggie-prefixed command but unprefixed session label in handleLaunchSession", async () => {
    const onLaunchHeadless = vi.fn().mockResolvedValue("ht-prefix");
    const trackedRepos = [makeRepo({ name: "my-repo", path: "/projects/my-repo", groomedCount: 1 })];

    mockInvoke.mockResolvedValue({
      slugs: [{ slug: "add-widget", tier: null }],
      totalGroomed: 1,
    });

    render(
      <CodeWorkflowTab
        {...defaultProps}
        onLaunchHeadless={onLaunchHeadless}
        trackedRepos={trackedRepos}
        reposLoading={false}
      />
    );

    fireEvent.click(screen.getByText("Start"));

    await vi.waitFor(() => {
      expect(onLaunchHeadless).toHaveBeenCalledTimes(1);
    });

    // Command argument should have the reggie- prefix
    const commandArg = onLaunchHeadless.mock.calls[0][1];
    expect(commandArg).toBe("/reggie-code-workflow --yes add-widget");

    // Label argument should NOT have the reggie- prefix
    const labelArg = onLaunchHeadless.mock.calls[0][2];
    expect(labelArg).toBe("code -- my-repo/add-widget");
    expect(labelArg).not.toContain("reggie-");
  });

  it("uses reggie-prefixed command but unprefixed label in handleStartIndividualTask", async () => {
    const onLaunchHeadless = vi.fn().mockResolvedValue("ht-ind-prefix");
    const trackedRepos = [makeRepo({
      name: "my-repo",
      path: "/projects/my-repo",
      groomedCount: 1,
      groomedTasks: [{ slug: "fix-layout", description: "Fix layout" }],
    })];

    const { container } = render(
      <CodeWorkflowTab
        {...defaultProps}
        onLaunchHeadless={onLaunchHeadless}
        trackedRepos={trackedRepos}
        reposLoading={false}
      />
    );

    // Expand the repo row to reveal task items
    fireEvent.click(container.querySelector(".repo-task-row")!);
    const queuedItems = container.querySelectorAll(".repo-task-row-session.queued");
    fireEvent.click(queuedItems[0].querySelector("button")!);

    await vi.waitFor(() => {
      expect(onLaunchHeadless).toHaveBeenCalledTimes(1);
    });

    // Command argument should have the reggie- prefix
    const commandArg = onLaunchHeadless.mock.calls[0][1];
    expect(commandArg).toBe("/reggie-code-workflow --yes fix-layout");

    // Label argument should NOT have the reggie- prefix
    const labelArg = onLaunchHeadless.mock.calls[0][2];
    expect(labelArg).toBe("code -- my-repo/fix-layout");
    expect(labelArg).not.toContain("reggie-");
  });

  it("batch button tooltip references the reggie-prefixed command", () => {
    const trackedRepos = [makeRepo({ groomedCount: 1 })];

    render(
      <CodeWorkflowTab
        {...defaultProps}
        trackedRepos={trackedRepos}
        reposLoading={false}
      />
    );

    const batchBtn = screen.getByText("Batch Start Coding");
    expect(batchBtn.getAttribute("title")).toBe(
      "Launch /reggie-code-workflow for all repos with tasks using smart agent count"
    );
  });
});

describe("CodeWorkflowTab no-tasks feedback", () => {
  it("shows no-tasks message when get_parallelizable_tasks returns empty slugs", async () => {
    const onLaunchHeadless = vi.fn().mockResolvedValue("ht-none");
    const trackedRepos = [makeRepo({ groomedCount: 2 })];

    mockInvoke.mockResolvedValue({
      slugs: [],
      totalGroomed: 0,
    });

    render(
      <CodeWorkflowTab
        {...defaultProps}
        onLaunchHeadless={onLaunchHeadless}
        trackedRepos={trackedRepos}
        reposLoading={false}
      />
    );

    // Click Start on the repo row
    fireEvent.click(screen.getByText("Start"));

    // Should show the no-tasks feedback message
    await vi.waitFor(() => {
      expect(screen.getByText("No tasks available for repo-a")).toBeTruthy();
    });

    // Should NOT have called onLaunchHeadless since there are no slugs
    expect(onLaunchHeadless).not.toHaveBeenCalled();
  });
});

describe("CodeWorkflowTab individual task start (handleStartIndividualTask)", () => {
  it("calls onLaunchHeadless with correct command and label when a task Start button is clicked", async () => {
    const onLaunchHeadless = vi.fn().mockResolvedValue("ht-individual");
    const trackedRepos = [makeRepo({
      groomedCount: 2,
      groomedTasks: [
        { slug: "add-feature", description: "Add feature" },
        { slug: "fix-bug", description: "Fix bug" },
      ],
    })];

    const { container } = render(
      <CodeWorkflowTab
        {...defaultProps}
        onLaunchHeadless={onLaunchHeadless}
        trackedRepos={trackedRepos}
        reposLoading={false}
      />
    );

    // Expand the repo row to reveal task items
    fireEvent.click(container.querySelector(".repo-task-row")!);

    // Find the Start buttons inside queued task items (not the repo-level Start button)
    const queuedItems = container.querySelectorAll(".repo-task-row-session.queued");
    expect(queuedItems.length).toBeGreaterThanOrEqual(2);

    // Click the Start button for the first task (add-feature)
    const firstStartBtn = queuedItems[0].querySelector("button")!;
    expect(firstStartBtn.textContent).toBe("Start");
    fireEvent.click(firstStartBtn);

    await vi.waitFor(() => {
      expect(onLaunchHeadless).toHaveBeenCalledTimes(1);
    });

    expect(onLaunchHeadless).toHaveBeenCalledWith(
      "/projects/repo-a",
      "/reggie-code-workflow --yes add-feature",
      "code -- repo-a/add-feature",
      undefined,
      undefined,
    );
  });

  it("defaults to undefined model and effort when task items carry no tier data", async () => {
    // groomedTasks do not carry tier; RepoTaskRow calls onStartTask without a tier argument,
    // so handleStartIndividualTask receives tier=undefined -> parseTier returns both undefined.
    const onLaunchHeadless = vi.fn().mockResolvedValue("ht-tier");
    const trackedRepos = [makeRepo({
      groomedCount: 1,
      groomedTasks: [
        { slug: "task-x", description: "Task X" },
      ],
    })];

    const { container } = render(
      <CodeWorkflowTab
        {...defaultProps}
        onLaunchHeadless={onLaunchHeadless}
        trackedRepos={trackedRepos}
        reposLoading={false}
      />
    );

    // Expand and click the individual Start button
    fireEvent.click(container.querySelector(".repo-task-row")!);
    const queuedItems = container.querySelectorAll(".repo-task-row-session.queued");
    const startBtn = queuedItems[0].querySelector("button")!;
    fireEvent.click(startBtn);

    await vi.waitFor(() => {
      expect(onLaunchHeadless).toHaveBeenCalledTimes(1);
    });

    // Without tier on task items, model and effort should be undefined
    expect(onLaunchHeadless).toHaveBeenCalledWith(
      "/projects/repo-a",
      "/reggie-code-workflow --yes task-x",
      "code -- repo-a/task-x",
      undefined,
      undefined,
    );
  });

  it("does not trigger repo-level launch when clicking individual task Start button", async () => {
    const onLaunchHeadless = vi.fn().mockResolvedValue("ht-no-repo");
    const trackedRepos = [makeRepo({
      groomedCount: 1,
      groomedTasks: [
        { slug: "solo-task", description: "Solo task" },
      ],
    })];

    const { container } = render(
      <CodeWorkflowTab
        {...defaultProps}
        onLaunchHeadless={onLaunchHeadless}
        trackedRepos={trackedRepos}
        reposLoading={false}
      />
    );

    // Expand and click individual task Start
    fireEvent.click(container.querySelector(".repo-task-row")!);
    const queuedItems = container.querySelectorAll(".repo-task-row-session.queued");
    fireEvent.click(queuedItems[0].querySelector("button")!);

    await vi.waitFor(() => {
      expect(onLaunchHeadless).toHaveBeenCalledTimes(1);
    });

    // Should have been called with the individual task command, NOT via get_parallelizable_tasks
    expect(mockInvoke).not.toHaveBeenCalledWith("get_parallelizable_tasks", expect.anything());
    expect(onLaunchHeadless).toHaveBeenCalledWith(
      "/projects/repo-a",
      "/reggie-code-workflow --yes solo-task",
      "code -- repo-a/solo-task",
      undefined,
      undefined,
    );
  });
});

describe("CodeWorkflowTab batch start skipping promoted sessions", () => {
  it("skips repos that have a promoted code-workflow session still running", async () => {
    const onLaunchHeadless = vi.fn().mockResolvedValue("ht-batch");
    const trackedRepos = [makeRepo({ groomedCount: 3 })];

    // A promoted (visible) code-workflow session that is still running
    const promotedSession = {
      id: "tab-promoted-1",
      terminalId: null,
      label: "code -- repo-a/task-1",
      isClaudeSession: true,
      projectPath: "/projects/repo-a",
      projectName: "repo-a",
      isHeadlessPromoted: true,
      headlessTerminalId: "ht-original",
      headlessCompleted: false,
      dead: false,
      visible: true,
    };

    render(
      <CodeWorkflowTab
        {...defaultProps}
        onLaunchHeadless={onLaunchHeadless}
        trackedRepos={trackedRepos}
        reposLoading={false}
        sessions={[promotedSession]}
      />
    );

    // Click Batch Start Coding
    fireEvent.click(screen.getByText("Batch Start Coding"));

    // Wait a tick and verify onLaunchHeadless was NOT called
    // because the repo has a promoted session still running
    await vi.waitFor(() => {
      // Batch should have finished (batchRunning goes false, button text reverts)
      expect(screen.getByText("Batch Start Coding")).toBeTruthy();
    });

    expect(onLaunchHeadless).not.toHaveBeenCalled();
  });

  it("does not skip repos where the promoted session is dead", async () => {
    const onLaunchHeadless = vi.fn().mockResolvedValue("ht-batch-2");
    const trackedRepos = [makeRepo({ groomedCount: 2 })];

    // A promoted session that has died (dead: true) -- should NOT be skipped
    const deadPromotedSession = {
      id: "tab-promoted-dead",
      terminalId: null,
      label: "code -- repo-a/task-old",
      isClaudeSession: true,
      projectPath: "/projects/repo-a",
      projectName: "repo-a",
      isHeadlessPromoted: true,
      headlessTerminalId: "ht-dead",
      headlessCompleted: false,
      dead: true,
      visible: true,
    };

    mockInvoke.mockResolvedValue({
      slugs: [{ slug: "task-new", tier: null }],
      totalGroomed: 2,
    });

    render(
      <CodeWorkflowTab
        {...defaultProps}
        onLaunchHeadless={onLaunchHeadless}
        trackedRepos={trackedRepos}
        reposLoading={false}
        sessions={[deadPromotedSession]}
      />
    );

    // Click Batch Start Coding
    fireEvent.click(screen.getByText("Batch Start Coding"));

    // Since the promoted session is dead, the repo should NOT be skipped
    await vi.waitFor(() => {
      expect(onLaunchHeadless).toHaveBeenCalledTimes(1);
    });
  });
});
