import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { mockInvoke, resetTauriMocks } from "../../../__test-utils__/tauri-mock";
import { CodeWorkflowTab, commandForMode, pickBacklogToLaunch, pickReggieSystemHolder } from "../CodeWorkflowTab";
import type { HeadlessSession, TerminalTab, RepoTaskSummary } from "../../../types/terminal";
import {
  loadPipelineBindings,
  __resetForTests as resetBindings,
} from "../../../lib/pipelineBindings";

beforeEach(() => {
  resetTauriMocks();
  resetBindings();
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

    await act(async () => {
      render(<CodeWorkflowTab {...defaultProps} />);
    });

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

    await act(async () => {
      fireEvent.click(screen.getByText("Refresh"));
    });
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

  it("shows Trash All Completed when promoted sessions have headlessCompleted", async () => {
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
    await act(async () => {
      fireEvent.click(trashBtn);
    });
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
      activeSlugs: [],
      backlogSlugs: [
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
    await act(async () => {
      fireEvent.click(screen.getByText("Start"));
    });

    await vi.waitFor(() => {
      expect(onLaunchHeadless).toHaveBeenCalledTimes(2);
    });

    expect(onLaunchHeadless).toHaveBeenCalledWith(
      "/projects/repo-a",
      "/reggie-code-workflow --yes task-a",
      "code -- repo-a/task-a",
      "opus",
      "high",
      true,
    );
    expect(onLaunchHeadless).toHaveBeenCalledWith(
      "/projects/repo-a",
      "/reggie-code-workflow --yes task-b",
      "code -- repo-a/task-b",
      "sonnet",
      "medium",
      true,
    );
  });

  it("passes undefined model and effort when tier is null", async () => {
    const onLaunchHeadless = vi.fn().mockResolvedValue("ht-2");
    const trackedRepos = [makeRepo({ groomedCount: 1 })];

    mockInvoke.mockResolvedValue({
      activeSlugs: [],
      backlogSlugs: [{ slug: "task-x", tier: null }],
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

    await act(async () => {
      fireEvent.click(screen.getByText("Start"));
    });

    await vi.waitFor(() => {
      expect(onLaunchHeadless).toHaveBeenCalledTimes(1);
    });

    expect(onLaunchHeadless).toHaveBeenCalledWith(
      "/projects/repo-a",
      "/reggie-code-workflow --yes task-x",
      "code -- repo-a/task-x",
      undefined,
      undefined,
      true,
    );
  });

  it("handles empty string tier as no model/effort", async () => {
    const onLaunchHeadless = vi.fn().mockResolvedValue("ht-empty");
    const trackedRepos = [makeRepo({ groomedCount: 1 })];

    mockInvoke.mockResolvedValue({
      activeSlugs: [],
      backlogSlugs: [{ slug: "task-e", tier: "" }],
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

    await act(async () => {
      fireEvent.click(screen.getByText("Start"));
    });

    await vi.waitFor(() => {
      expect(onLaunchHeadless).toHaveBeenCalledTimes(1);
    });

    expect(onLaunchHeadless).toHaveBeenCalledWith(
      "/projects/repo-a",
      "/reggie-code-workflow --yes task-e",
      "code -- repo-a/task-e",
      undefined,
      undefined,
      true,
    );
  });

  it("handles tier with only effort (colon-prefixed) as no model", async () => {
    const onLaunchHeadless = vi.fn().mockResolvedValue("ht-colon");
    const trackedRepos = [makeRepo({ groomedCount: 1 })];

    mockInvoke.mockResolvedValue({
      activeSlugs: [],
      backlogSlugs: [{ slug: "task-c", tier: ":high" }],
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

    await act(async () => {
      fireEvent.click(screen.getByText("Start"));
    });

    await vi.waitFor(() => {
      expect(onLaunchHeadless).toHaveBeenCalledTimes(1);
    });

    expect(onLaunchHeadless).toHaveBeenCalledWith(
      "/projects/repo-a",
      "/reggie-code-workflow --yes task-c",
      "code -- repo-a/task-c",
      undefined,
      "high",
      true,
    );
  });

  it("handles tier with only model and no effort", async () => {
    const onLaunchHeadless = vi.fn().mockResolvedValue("ht-3");
    const trackedRepos = [makeRepo({ groomedCount: 1 })];

    mockInvoke.mockResolvedValue({
      activeSlugs: [],
      backlogSlugs: [{ slug: "task-y", tier: "opus" }],
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

    await act(async () => {
      fireEvent.click(screen.getByText("Start"));
    });

    await vi.waitFor(() => {
      expect(onLaunchHeadless).toHaveBeenCalledTimes(1);
    });

    expect(onLaunchHeadless).toHaveBeenCalledWith(
      "/projects/repo-a",
      "/reggie-code-workflow --yes task-y",
      "code -- repo-a/task-y",
      "opus",
      undefined,
      true,
    );
  });
});

describe("CodeWorkflowTab reggie-prefix correctness", () => {
  it("uses reggie-prefixed command but unprefixed session label in handleLaunchSession", async () => {
    const onLaunchHeadless = vi.fn().mockResolvedValue("ht-prefix");
    const trackedRepos = [makeRepo({ name: "my-repo", path: "/projects/my-repo", groomedCount: 1 })];

    mockInvoke.mockResolvedValue({
      activeSlugs: [],
      backlogSlugs: [{ slug: "add-widget", tier: null }],
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

    await act(async () => {
      fireEvent.click(screen.getByText("Start"));
    });

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

    // Two separate act blocks: the expand click flushes its state update at act() end,
    // so querySelectorAll must run in a second act block to see the revealed items.
    await act(async () => {
      fireEvent.click(container.querySelector(".repo-task-row")!);
    });
    await act(async () => {
      const queuedItems = container.querySelectorAll(".repo-task-row-session.queued");
      fireEvent.click(queuedItems[0].querySelector("button")!);
    });

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
      activeSlugs: [],
      backlogSlugs: [],
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
    await act(async () => {
      fireEvent.click(screen.getByText("Start"));
    });

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
    await act(async () => {
      fireEvent.click(container.querySelector(".repo-task-row")!);
    });

    // Find the Start buttons inside queued task items (not the repo-level Start button)
    const queuedItems = container.querySelectorAll(".repo-task-row-session.queued");
    expect(queuedItems.length).toBeGreaterThanOrEqual(2);

    // Click the Start button for the first task (add-feature)
    const firstStartBtn = queuedItems[0].querySelector("button")!;
    expect(firstStartBtn.textContent).toBe("Start");
    await act(async () => {
      fireEvent.click(firstStartBtn);
    });

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
    await act(async () => {
      fireEvent.click(container.querySelector(".repo-task-row")!);
    });
    await act(async () => {
      const queuedItems = container.querySelectorAll(".repo-task-row-session.queued");
      const startBtn = queuedItems[0].querySelector("button")!;
      fireEvent.click(startBtn);
    });

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
    await act(async () => {
      fireEvent.click(container.querySelector(".repo-task-row")!);
    });
    await act(async () => {
      const queuedItems = container.querySelectorAll(".repo-task-row-session.queued");
      fireEvent.click(queuedItems[0].querySelector("button")!);
    });

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
  // The legacy test "skips repos that have a promoted code-workflow session
  // still running" was removed: that per-repo skip was the bug fixed by Phase
  // 3 of fix-cross-domain-dispatch. The new behavior — running sessions
  // *reduce* per-domain remaining slots but do not skip the repo entirely —
  // is covered by `handleLaunchSession remaining-slots math > subtracts
  // running per-domain (code) from remaining slots` (which routes through
  // Batch Start because the per-repo Start button is hidden when a session
  // exists on the row).

  it("partitions slugs by domain and applies per-domain caps", async () => {
    const onLaunchHeadless = vi.fn().mockResolvedValue("ht-x");
    const trackedRepos = [makeRepo({ groomedCount: 20 })];

    // Backend now returns all groomed slugs (no cap). Frontend caps:
    // code/design → 5, reggie-system → 1, debug → 3.
    const slugs = [
      ...Array.from({ length: 7 }, (_, i) => ({ slug: `code-${i}`, tier: null, mode: "code" })),
      ...Array.from({ length: 3 }, (_, i) => ({ slug: `design-${i}`, tier: null, mode: "design" })),
      ...Array.from({ length: 4 }, (_, i) => ({ slug: `rsys-${i}`, tier: null, mode: "reggie-system" })),
      ...Array.from({ length: 5 }, (_, i) => ({ slug: `dbg-${i}`, tier: null, mode: "debug" })),
    ];
    mockInvoke.mockResolvedValue({ activeSlugs: [], backlogSlugs: slugs, totalGroomed: slugs.length });

    render(
      <CodeWorkflowTab
        {...defaultProps}
        onLaunchHeadless={onLaunchHeadless}
        trackedRepos={trackedRepos}
        reposLoading={false}
      />
    );

    await act(async () => {
      fireEvent.click(screen.getByText("Start"));
    });

    // 5 code/design + 1 reggie-system + 3 debug = 9 launches
    await vi.waitFor(() => {
      expect(onLaunchHeadless).toHaveBeenCalledTimes(9);
    });

    const calls = onLaunchHeadless.mock.calls.map((c) => ({ command: c[1], label: c[2] }));
    const codeCalls = calls.filter((c) => c.command.startsWith("/reggie-code-workflow --yes"));
    const reggieCalls = calls.filter((c) => c.command.startsWith("/reggie-system-change --yes"));
    const debugCalls = calls.filter((c) => c.command.startsWith("/reggie-debug-workflow --yes"));
    expect(codeCalls).toHaveLength(5);
    expect(reggieCalls).toHaveLength(1);
    expect(debugCalls).toHaveLength(3);

    // Labels carry the right per-domain prefix.
    expect(codeCalls[0].label.startsWith("code -- repo-a/")).toBe(true);
    expect(reggieCalls[0].label.startsWith("reggie-sys -- repo-a/")).toBe(true);
    expect(debugCalls[0].label.startsWith("debug -- repo-a/")).toBe(true);
  });

  it("dispatches reggie-system slugs with /reggie-system-change --yes", async () => {
    const onLaunchHeadless = vi.fn().mockResolvedValue("ht-rsys");
    const trackedRepos = [makeRepo({ groomedCount: 1 })];
    mockInvoke.mockResolvedValue({
      activeSlugs: [],
      backlogSlugs: [{ slug: "rotate-keys", tier: null, mode: "reggie-system" }],
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

    await act(async () => {
      fireEvent.click(screen.getByText("Start"));
    });

    await vi.waitFor(() => {
      expect(onLaunchHeadless).toHaveBeenCalledTimes(1);
    });
    expect(onLaunchHeadless).toHaveBeenCalledWith(
      "/projects/repo-a",
      "/reggie-system-change --yes rotate-keys",
      "reggie-sys -- repo-a/rotate-keys",
      undefined,
      undefined,
      true,
    );
  });

  it("dispatches debug slugs with /reggie-debug-workflow --yes", async () => {
    const onLaunchHeadless = vi.fn().mockResolvedValue("ht-dbg");
    const trackedRepos = [makeRepo({ groomedCount: 1 })];
    mockInvoke.mockResolvedValue({
      activeSlugs: [],
      backlogSlugs: [{ slug: "fix-flaky", tier: null, mode: "debug" }],
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

    await act(async () => {
      fireEvent.click(screen.getByText("Start"));
    });

    await vi.waitFor(() => {
      expect(onLaunchHeadless).toHaveBeenCalledTimes(1);
    });
    expect(onLaunchHeadless).toHaveBeenCalledWith(
      "/projects/repo-a",
      "/reggie-debug-workflow --yes fix-flaky",
      "debug -- repo-a/fix-flaky",
      undefined,
      undefined,
      true,
    );
  });

  // The legacy test "batch start skips a repo whose existing running session
  // is reggie-sys or debug" was removed: that per-repo isWorkflowLabel skip
  // was the bug fixed by Phase 3. The new group-wide behavior — a running
  // reggie-sys session in repo A consumes the global slot so repo B's
  // [reggie-system] is deferred while repo B's code/debug still launch — is
  // covered by `handleBatchStart group-wide reggie-system > respects the
  // workspace-wide reggie-system cap of 1 across multiple repos` and by the
  // deferred-badge tests.

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
      activeSlugs: [],
      backlogSlugs: [{ slug: "task-new", tier: null }],
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
    await act(async () => {
      fireEvent.click(screen.getByText("Batch Start Coding"));
    });

    // Since the promoted session is dead, the repo should NOT be skipped
    expect(onLaunchHeadless).toHaveBeenCalledTimes(1);
  });

  it("treats slugs with null/missing mode as code workflow", async () => {
    // Backlog slugs whose `mode` is null (untagged tasks, or tasks where the
    // cross-reference fallback applied) must dispatch via /reggie-code-workflow.
    const onLaunchHeadless = vi.fn().mockResolvedValue("ht-null-mode");
    const trackedRepos = [makeRepo({ groomedCount: 1 })];
    mockInvoke.mockResolvedValue({
      activeSlugs: [],
      backlogSlugs: [{ slug: "active-1", tier: null, mode: null }],
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

    await act(async () => {
      fireEvent.click(screen.getByText("Start"));
    });

    await vi.waitFor(() => {
      expect(onLaunchHeadless).toHaveBeenCalledTimes(1);
    });
    expect(onLaunchHeadless).toHaveBeenCalledWith(
      "/projects/repo-a",
      "/reggie-code-workflow --yes active-1",
      "code -- repo-a/active-1",
      undefined,
      undefined,
      true,
    );
  });

  it("does not launch when partitionAndCap drops every slug (only unknown modes)", async () => {
    // partitionAndCap keeps only `null/code/design`, `reggie-system`, `debug` modes.
    // Slugs with any other mode (defensive case) are filtered from all three buckets,
    // leaving `toLaunch` empty — no launches should fire.
    const onLaunchHeadless = vi.fn().mockResolvedValue("ht-x");
    const trackedRepos = [makeRepo({ groomedCount: 1 })];
    mockInvoke.mockResolvedValue({
      activeSlugs: [],
      backlogSlugs: [{ slug: "weird", tier: null, mode: "unknown-mode" }],
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

    await act(async () => {
      fireEvent.click(screen.getByText("Start"));
    });

    expect(onLaunchHeadless).not.toHaveBeenCalled();
  });
});

describe("CodeWorkflowTab walk-through (manual) flow", () => {
  it("Walk through button on a manual task launches /reggie-manual-task and promotes the session", async () => {
    const onLaunchHeadless = vi.fn().mockResolvedValue("ht-manual-1");
    const onPromoteHeadless = vi.fn();
    const trackedRepos = [makeRepo({
      groomedCount: 1,
      groomedTasks: [
        { slug: "shave-yak", description: "Shave the yak", mode: "manual" },
      ],
    })];

    const { container } = render(
      <CodeWorkflowTab
        {...defaultProps}
        onLaunchHeadless={onLaunchHeadless}
        onPromoteHeadless={onPromoteHeadless}
        trackedRepos={trackedRepos}
        reposLoading={false}
      />
    );

    await act(async () => {
      fireEvent.click(container.querySelector(".repo-task-row")!);
    });
    await act(async () => {
      const queuedItems = container.querySelectorAll(".repo-task-row-session.queued");
      const btn = queuedItems[0].querySelector("button")!;
      expect(btn.textContent).toBe("Walk through");
      fireEvent.click(btn);
    });

    await vi.waitFor(() => {
      expect(onLaunchHeadless).toHaveBeenCalledTimes(1);
    });
    // Manual tasks dispatch via /reggie-manual-task (visible launch), with the standard
    // "code -- <repo>/<slug>" label so de-dupe scans still match the slug.
    expect(onLaunchHeadless).toHaveBeenCalledWith(
      "/projects/repo-a",
      "/reggie-manual-task shave-yak",
      "code -- repo-a/shave-yak",
      undefined,
      undefined,
    );
    // After launch returns a terminal id, the session is promoted so the user sees it
    // on the Sessions tab.
    expect(onPromoteHeadless).toHaveBeenCalledWith("ht-manual-1");
  });

  it("does not call onPromoteHeadless when onLaunchHeadless returns no terminalId", async () => {
    // Defensive: if launch fails or returns null, we must not crash trying to promote nothing.
    const onLaunchHeadless = vi.fn().mockResolvedValue(null);
    const onPromoteHeadless = vi.fn();
    const trackedRepos = [makeRepo({
      groomedCount: 1,
      groomedTasks: [
        { slug: "manual-x", description: "Manual X", mode: "manual" },
      ],
    })];

    const { container } = render(
      <CodeWorkflowTab
        {...defaultProps}
        onLaunchHeadless={onLaunchHeadless}
        onPromoteHeadless={onPromoteHeadless}
        trackedRepos={trackedRepos}
        reposLoading={false}
      />
    );

    await act(async () => {
      fireEvent.click(container.querySelector(".repo-task-row")!);
    });
    await act(async () => {
      const btn = container.querySelector(".repo-task-row-session.queued button")!;
      fireEvent.click(btn);
    });

    await vi.waitFor(() => {
      expect(onLaunchHeadless).toHaveBeenCalledTimes(1);
    });
    expect(onPromoteHeadless).not.toHaveBeenCalled();
  });
});

describe("commandForMode honours pipeline bindings cache", () => {
  it("uses the default code workflow when no binding is set", () => {
    expect(commandForMode("code")).toEqual({
      command: "/reggie-code-workflow --yes",
      labelPrefix: "code --",
    });
  });

  it("reggie-system is never bindable — always returns the hardcoded command", async () => {
    mockInvoke.mockResolvedValue({ code: "evil", debug: "evil", manual: "evil" });
    await loadPipelineBindings();
    // Even when other bindings are set, reggie-system stays hardcoded.
    expect(commandForMode("reggie-system")).toEqual({
      command: "/reggie-system-change --yes",
      labelPrefix: "reggie-sys --",
    });
  });

  it("uses the code binding when set, preserving the 'code --' label prefix", async () => {
    mockInvoke.mockResolvedValue({ code: "my-code-pipeline" });
    await loadPipelineBindings();
    expect(commandForMode("code")).toEqual({
      command: "/my-code-pipeline --yes",
      labelPrefix: "code --",
    });
  });

  it("uses the debug binding when set, preserving the 'debug --' label prefix", async () => {
    mockInvoke.mockResolvedValue({ debug: "my-debug-pipeline" });
    await loadPipelineBindings();
    expect(commandForMode("debug")).toEqual({
      command: "/my-debug-pipeline --yes",
      labelPrefix: "debug --",
    });
  });

  it("uses the manual binding when set (no --yes), with 'code --' label prefix", async () => {
    mockInvoke.mockResolvedValue({ manual: "my-manual-pipeline" });
    await loadPipelineBindings();
    expect(commandForMode("manual")).toEqual({
      command: "/my-manual-pipeline",
      labelPrefix: "code --",
    });
  });

  it("falls back to /reggie-manual-task for manual mode when no binding is set", () => {
    expect(commandForMode("manual")).toEqual({
      command: "/reggie-manual-task",
      labelPrefix: "code --",
    });
  });

  it("design and null/undefined modes route to the code binding", async () => {
    mockInvoke.mockResolvedValue({ code: "my-code-pipeline" });
    await loadPipelineBindings();
    expect(commandForMode("design").command).toBe("/my-code-pipeline --yes");
    expect(commandForMode(null).command).toBe("/my-code-pipeline --yes");
    expect(commandForMode(undefined).command).toBe("/my-code-pipeline --yes");
  });
});

describe("handleWalkThroughTask honours manual pipeline binding", () => {
  it("uses the manual binding via commandForMode when walk-through task is launched", async () => {
    // Set up a manual binding
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "get_pipeline_bindings") return Promise.resolve({ manual: "custom-manual" });
      if (cmd === "get_parallelizable_tasks") return Promise.resolve({ activeSlugs: [], backlogSlugs: [], totalGroomed: 0 });
      if (cmd === "scan_tasks_across_repos") return Promise.resolve([]);
      if (cmd === "get_install_status") return Promise.resolve({ version: "0", needsSetup: false });
      return Promise.resolve(undefined);
    });
    await loadPipelineBindings();

    // Verify commandForMode("manual") uses the binding
    const { command } = commandForMode("manual");
    expect(command).toBe("/custom-manual");
  });
});

describe("pickBacklogToLaunch", () => {
  it("caps per domain — code/design, reggie-system, debug", () => {
    const backlog = [
      { slug: "c1", tier: null, mode: "code" },
      { slug: "c2", tier: null, mode: "code" },
      { slug: "c3", tier: null, mode: "code" },
      { slug: "d1", tier: null, mode: "design" },
      { slug: "rs1", tier: null, mode: "reggie-system" },
      { slug: "rs2", tier: null, mode: "reggie-system" },
      { slug: "db1", tier: null, mode: "debug" },
      { slug: "db2", tier: null, mode: "debug" },
    ];
    const picked = pickBacklogToLaunch(backlog, { code: 2, reggieSystem: 1, debug: 1 });
    expect(picked).toHaveLength(4);
    // First two code/design slots, then 1 reggie-system, then 1 debug.
    expect(picked.map((s) => s.slug)).toEqual(["c1", "c2", "rs1", "db1"]);
  });

  it("zero remaining drops the whole domain", () => {
    const backlog = [
      { slug: "c1", tier: null, mode: "code" },
      { slug: "rs1", tier: null, mode: "reggie-system" },
      { slug: "db1", tier: null, mode: "debug" },
      { slug: "db2", tier: null, mode: "debug" },
    ];
    const picked = pickBacklogToLaunch(backlog, { code: 5, reggieSystem: 1, debug: 0 });
    expect(picked.map((s) => s.slug)).toEqual(["c1", "rs1"]);
  });

  it("excludes slugs present in activeSlugs (defensive consumer-side filter)", () => {
    const backlog = [
      { slug: "c1", tier: null, mode: "code" },
      { slug: "c2", tier: null, mode: "code" },
      { slug: "rs1", tier: null, mode: "reggie-system" },
    ];
    const activeSlugs = new Set(["c1"]);
    const picked = pickBacklogToLaunch(backlog, { code: 5, reggieSystem: 1, debug: 0 }, activeSlugs);
    expect(picked.map((s) => s.slug)).toEqual(["c2", "rs1"]);
  });

  it("empty activeSlugs is a no-op", () => {
    const backlog = [{ slug: "c1", tier: null, mode: "code" }];
    const picked = pickBacklogToLaunch(backlog, { code: 5, reggieSystem: 0, debug: 0 }, new Set());
    expect(picked.map((s) => s.slug)).toEqual(["c1"]);
  });

  it("activeSlugs is keyed by slug only — caller scopes per-repo (cross-repo slug shared by name OK)", () => {
    // Within a single call, all backlog entries belong to one repo. The same
    // slug name surfacing in another repo's call is a separate invocation
    // with its own activeSlugs set, so cross-repo dispatch is preserved.
    const backlog = [{ slug: "shared", tier: null, mode: "code" }];
    const pickedRepoA = pickBacklogToLaunch(backlog, { code: 5, reggieSystem: 0, debug: 0 }, new Set(["shared"]));
    const pickedRepoB = pickBacklogToLaunch(backlog, { code: 5, reggieSystem: 0, debug: 0 }, new Set());
    expect(pickedRepoA).toEqual([]);
    expect(pickedRepoB.map((s) => s.slug)).toEqual(["shared"]);
  });
});

describe("pickReggieSystemHolder", () => {
  const makeHeadless = (overrides: Partial<HeadlessSession>): HeadlessSession => ({
    terminalId: "t-default",
    projectPath: "/repos/default",
    projectName: "default",
    label: "reggie-sys -- default/some-slug",
    needsAttention: false,
    exited: false,
    exitCode: null,
    bufferSize: 0,
    completed: false,
    ...overrides,
  });

  const makeTab = (overrides: Partial<TerminalTab>): TerminalTab => ({
    id: "tab-default",
    terminalId: "t-default",
    label: "reggie-sys -- default/some-slug",
    isClaudeSession: true,
    projectPath: "/repos/default",
    isHeadlessPromoted: true,
    ...overrides,
  });

  it("returns null when no reggie-system sessions are running", () => {
    const tabs: TerminalTab[] = [
      makeTab({ terminalId: "t-1", label: "code -- foo/bar" }),
    ];
    expect(pickReggieSystemHolder([], tabs)).toBeNull();
  });

  it("ignores exited / completed headless sessions", () => {
    const headless: HeadlessSession[] = [
      makeHeadless({ terminalId: "t-1", projectPath: "/repos/alpha", exited: true }),
      makeHeadless({ terminalId: "t-2", projectPath: "/repos/beta", completed: true }),
    ];
    expect(pickReggieSystemHolder(headless, [])).toBeNull();
  });

  it("ignores dead / completed promoted tabs", () => {
    const tabs: TerminalTab[] = [
      makeTab({ terminalId: "t-1", projectPath: "/repos/alpha", dead: true }),
      makeTab({ terminalId: "t-2", projectPath: "/repos/beta", headlessCompleted: true }),
    ];
    expect(pickReggieSystemHolder([], tabs)).toBeNull();
  });

  it("ignores non-promoted terminal tabs", () => {
    const tabs: TerminalTab[] = [
      makeTab({ terminalId: "t-1", projectPath: "/repos/alpha", isHeadlessPromoted: false }),
    ];
    expect(pickReggieSystemHolder([], tabs)).toBeNull();
  });

  it("returns repo info for the lowest-terminalId reggie-system candidate", () => {
    const headless: HeadlessSession[] = [
      makeHeadless({ terminalId: "t-bbb", projectPath: "/repos/beta" }),
      makeHeadless({ terminalId: "t-aaa", projectPath: "/repos/alpha" }),
    ];
    const holder = pickReggieSystemHolder(headless, []);
    expect(holder).toEqual({ repoPath: "/repos/alpha", repoName: "alpha" });
  });

  it("is deterministic across input array order — mid-promotion duplicate yields the same holder", () => {
    // Two competing reggie-system sessions in different repos. During the
    // mid-promotion window, the same session can appear in both arrays.
    // The previous implementation returned different holders depending on
    // which array's iteration "won". Sorting by terminalId fixes this.
    const headlessA: HeadlessSession[] = [
      makeHeadless({ terminalId: "t-aaa", projectPath: "/repos/alpha" }),
    ];
    const tabsA: TerminalTab[] = [
      makeTab({ terminalId: "t-bbb", projectPath: "/repos/beta" }),
    ];
    const holderA = pickReggieSystemHolder(headlessA, tabsA);

    // Reverse: the "headless" winner moved into tabs first (promotion order swap).
    const headlessB: HeadlessSession[] = [
      makeHeadless({ terminalId: "t-bbb", projectPath: "/repos/beta" }),
    ];
    const tabsB: TerminalTab[] = [
      makeTab({ terminalId: "t-aaa", projectPath: "/repos/alpha" }),
    ];
    const holderB = pickReggieSystemHolder(headlessB, tabsB);

    expect(holderA).toEqual({ repoPath: "/repos/alpha", repoName: "alpha" });
    expect(holderB).toEqual(holderA);
  });

  it("skips promoted tabs with null terminalId (not yet spawned)", () => {
    const tabs: TerminalTab[] = [
      makeTab({ terminalId: null, projectPath: "/repos/alpha" }),
      makeTab({ terminalId: "t-zzz", projectPath: "/repos/beta" }),
    ];
    const holder = pickReggieSystemHolder([], tabs);
    expect(holder).toEqual({ repoPath: "/repos/beta", repoName: "beta" });
  });

  it("derives repoName from the trailing path segment (handles both / and \\ separators)", () => {
    const headless: HeadlessSession[] = [
      makeHeadless({ terminalId: "t-1", projectPath: "C:\\projects\\my-repo" }),
    ];
    const holder = pickReggieSystemHolder(headless, []);
    expect(holder).toEqual({ repoPath: "C:\\projects\\my-repo", repoName: "my-repo" });
  });
});

describe("CodeWorkflowTab handleLaunchSession remaining-slots math", () => {
  it("does not relaunch active slugs (only backlogSlugs feed the launch loop)", async () => {
    const onLaunchHeadless = vi.fn().mockResolvedValue("ht-no-relaunch");
    const trackedRepos = [makeRepo({ groomedCount: 1, activeCount: 1 })];

    // Active slug X is already running — backend reports it under activeSlugs,
    // not backlogSlugs. The frontend must never re-launch it.
    mockInvoke.mockResolvedValue({
      activeSlugs: [{ slug: "X", tier: null, mode: "code" }],
      backlogSlugs: [],
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

    await act(async () => {
      fireEvent.click(screen.getByText("Start"));
    });

    expect(onLaunchHeadless).not.toHaveBeenCalled();
  });

  it("subtracts running per-domain (code) from remaining slots", async () => {
    const onLaunchHeadless = vi.fn().mockResolvedValue("ht-cap");
    const trackedRepos = [makeRepo({ groomedCount: 6 })];

    // One running headless code session in this repo — should subtract 1 from
    // the code cap of 5 → only 4 launches expected from the backlog of 6.
    const headless: HeadlessSession = {
      terminalId: "ht-running-1",
      projectPath: "/projects/repo-a",
      projectName: "repo-a",
      label: "code -- repo-a/already-running",
      needsAttention: false,
      exited: false,
      exitCode: null,
      bufferSize: 0,
      completed: false,
    };

    mockInvoke.mockResolvedValue({
      activeSlugs: [],
      backlogSlugs: Array.from({ length: 6 }, (_, i) => ({
        slug: `code-${i}`,
        tier: null,
        mode: "code",
      })),
      totalGroomed: 6,
    });

    render(
      <CodeWorkflowTab
        {...defaultProps}
        onLaunchHeadless={onLaunchHeadless}
        trackedRepos={trackedRepos}
        reposLoading={false}
        headlessSessions={[headless]}
      />
    );

    // The repo row has a running session, so the per-repo "Start" button is hidden.
    // Use Batch Start to trigger the launch path instead — it invokes
    // `launchForRepo` for the same repo, exercising the same remaining-slots math.
    await act(async () => {
      fireEvent.click(screen.getByText("Batch Start Coding"));
    });

    expect(onLaunchHeadless).toHaveBeenCalledTimes(4);
  });
});

describe("CodeWorkflowTab handleBatchStart group-wide reggie-system", () => {
  it("respects the workspace-wide reggie-system cap of 1 across multiple repos", async () => {
    const onLaunchHeadless = vi.fn().mockResolvedValue("ht-batch-rsys");
    const trackedRepos = [
      makeRepo({ name: "repo-a", path: "/projects/repo-a", groomedCount: 1 }),
      makeRepo({ name: "repo-b", path: "/projects/repo-b", groomedCount: 1 }),
    ];

    // Both repos return one [reggie-system] backlog slug.
    mockInvoke.mockImplementation((cmd: string, args: { projectPath: string }) => {
      if (cmd === "get_parallelizable_tasks") {
        const slug = args.projectPath === "/projects/repo-a" ? "rs-a" : "rs-b";
        return Promise.resolve({
          activeSlugs: [],
          backlogSlugs: [{ slug, tier: null, mode: "reggie-system" }],
          totalGroomed: 1,
        });
      }
      return Promise.resolve(undefined);
    });

    render(
      <CodeWorkflowTab
        {...defaultProps}
        onLaunchHeadless={onLaunchHeadless}
        trackedRepos={trackedRepos}
        reposLoading={false}
      />
    );

    await act(async () => {
      fireEvent.click(screen.getByText("Batch Start Coding"));
    });

    // Gate on the actual condition: exactly one launch fires across both repos.
    // The second repo's [reggie-system] slug is dropped because the slot was
    // claimed by the first iteration's in-flight counter.
    expect(onLaunchHeadless).toHaveBeenCalledTimes(1);

    const reggieCalls = onLaunchHeadless.mock.calls.filter((c) =>
      String(c[2]).startsWith("reggie-sys --"),
    );
    expect(reggieCalls).toHaveLength(1);
  });
});

describe("CodeWorkflowTab reggie-system deferred badge", () => {
  it("renders 'deferred — slot held by <repo>' badge on a non-holder repo with a reggie-system task", () => {
    const trackedRepos = [
      makeRepo({
        name: "repo-a",
        path: "/projects/repo-a",
        groomedCount: 1,
        groomedTasks: [{ slug: "rotate-keys", description: "Rotate keys", mode: "reggie-system" }],
      }),
    ];

    // A running reggie-system session on a different repo holds the slot.
    const headless: HeadlessSession = {
      terminalId: "ht-rsys-holder",
      projectPath: "/projects/repo-other",
      projectName: "repo-other",
      label: "reggie-sys -- repo-other/some-task",
      needsAttention: false,
      exited: false,
      exitCode: null,
      bufferSize: 0,
      completed: false,
    };

    render(
      <CodeWorkflowTab
        {...defaultProps}
        trackedRepos={trackedRepos}
        reposLoading={false}
        headlessSessions={[headless]}
      />
    );

    expect(
      screen.getByText("1 reggie-system task deferred — slot held by repo-other"),
    ).toBeTruthy();
  });

  it("does not render the badge on the repo that holds the slot", () => {
    const trackedRepos = [
      makeRepo({
        name: "repo-a",
        path: "/projects/repo-a",
        groomedCount: 1,
        groomedTasks: [{ slug: "rotate-keys", description: "Rotate keys", mode: "reggie-system" }],
      }),
    ];

    // The holder is repo-a itself.
    const headless: HeadlessSession = {
      terminalId: "ht-rsys-holder",
      projectPath: "/projects/repo-a",
      projectName: "repo-a",
      label: "reggie-sys -- repo-a/already-running",
      needsAttention: false,
      exited: false,
      exitCode: null,
      bufferSize: 0,
      completed: false,
    };

    render(
      <CodeWorkflowTab
        {...defaultProps}
        trackedRepos={trackedRepos}
        reposLoading={false}
        headlessSessions={[headless]}
      />
    );

    expect(screen.queryByText(/reggie-system task deferred/)).toBeNull();
  });

  it("does not render the badge on a non-holder repo without a [reggie-system] backlog task", () => {
    const trackedRepos = [
      makeRepo({
        name: "repo-a",
        path: "/projects/repo-a",
        groomedCount: 1,
        groomedTasks: [{ slug: "feature-x", description: "Feature X", mode: "code" }],
      }),
    ];

    const headless: HeadlessSession = {
      terminalId: "ht-rsys-holder",
      projectPath: "/projects/repo-other",
      projectName: "repo-other",
      label: "reggie-sys -- repo-other/some-task",
      needsAttention: false,
      exited: false,
      exitCode: null,
      bufferSize: 0,
      completed: false,
    };

    render(
      <CodeWorkflowTab
        {...defaultProps}
        trackedRepos={trackedRepos}
        reposLoading={false}
        headlessSessions={[headless]}
      />
    );

    expect(screen.queryByText(/reggie-system task deferred/)).toBeNull();
  });
});

describe("CodeWorkflowTab auto-relaunch", () => {
  it("relaunches the same repo with the next backlog slug when a Start session completes", async () => {
    const onLaunchHeadless = vi.fn().mockResolvedValue("ht-rl-1");
    const trackedRepos = [makeRepo({ groomedCount: 2 })];

    let call = 0;
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "get_parallelizable_tasks") {
        call++;
        const slugs =
          call === 1
            ? [
                { slug: "code-1", tier: null, mode: "code" },
                { slug: "code-2", tier: null, mode: "code" },
              ]
            : [{ slug: "code-2", tier: null, mode: "code" }];
        return Promise.resolve({ activeSlugs: [], backlogSlugs: slugs, totalGroomed: slugs.length });
      }
      return Promise.resolve(undefined);
    });

    const { rerender } = render(
      <CodeWorkflowTab
        {...defaultProps}
        onLaunchHeadless={onLaunchHeadless}
        trackedRepos={trackedRepos}
        reposLoading={false}
      />
    );

    await act(async () => {
      fireEvent.click(screen.getByText("Start"));
    });

    await vi.waitFor(() => {
      expect(onLaunchHeadless).toHaveBeenCalledTimes(2);
    });
    expect(onLaunchHeadless).toHaveBeenNthCalledWith(
      1,
      "/projects/repo-a",
      "/reggie-code-workflow --yes code-1",
      "code -- repo-a/code-1",
      undefined,
      undefined,
      true,
    );

    const completedSession: HeadlessSession = {
      terminalId: "t1",
      projectPath: "/projects/repo-a",
      projectName: "repo-a",
      label: "code -- repo-a/code-1",
      needsAttention: false,
      exited: false,
      exitCode: null,
      bufferSize: 0,
      completed: true,
      autoRelaunch: true,
    };

    rerender(
      <CodeWorkflowTab
        {...defaultProps}
        onLaunchHeadless={onLaunchHeadless}
        trackedRepos={trackedRepos}
        reposLoading={false}
        headlessSessions={[completedSession]}
      />
    );

    await vi.waitFor(() => {
      expect(onLaunchHeadless).toHaveBeenCalledTimes(3);
    });
    const lastCall = onLaunchHeadless.mock.calls[onLaunchHeadless.mock.calls.length - 1];
    expect(lastCall[1]).toBe("/reggie-code-workflow --yes code-2");
    expect(lastCall[5]).toBe(true);
  });

  it("relaunches each repo independently after Batch Start completions", async () => {
    const onLaunchHeadless = vi.fn().mockResolvedValue("ht-rl-batch");
    const trackedRepos = [
      makeRepo({ name: "repo-a", path: "/projects/repo-a", groomedCount: 2 }),
      makeRepo({ name: "repo-b", path: "/projects/repo-b", groomedCount: 2 }),
    ];

    const callsByRepo: Record<string, number> = {};
    mockInvoke.mockImplementation((cmd: string, args: { projectPath: string }) => {
      if (cmd === "get_parallelizable_tasks") {
        callsByRepo[args.projectPath] = (callsByRepo[args.projectPath] ?? 0) + 1;
        const repoKey = args.projectPath === "/projects/repo-a" ? "a" : "b";
        const n = callsByRepo[args.projectPath];
        const slugs =
          n === 1
            ? [
                { slug: `${repoKey}-1`, tier: null, mode: "code" },
                { slug: `${repoKey}-2`, tier: null, mode: "code" },
              ]
            : [{ slug: `${repoKey}-2`, tier: null, mode: "code" }];
        return Promise.resolve({ activeSlugs: [], backlogSlugs: slugs, totalGroomed: slugs.length });
      }
      return Promise.resolve(undefined);
    });

    const { rerender } = render(
      <CodeWorkflowTab
        {...defaultProps}
        onLaunchHeadless={onLaunchHeadless}
        trackedRepos={trackedRepos}
        reposLoading={false}
      />
    );

    await act(async () => {
      fireEvent.click(screen.getByText("Batch Start Coding"));
    });

    expect(onLaunchHeadless).toHaveBeenCalledTimes(4);

    const completedA: HeadlessSession = {
      terminalId: "t-a",
      projectPath: "/projects/repo-a",
      projectName: "repo-a",
      label: "code -- repo-a/a-1",
      needsAttention: false,
      exited: false,
      exitCode: null,
      bufferSize: 0,
      completed: true,
      autoRelaunch: true,
    };
    const completedB: HeadlessSession = {
      terminalId: "t-b",
      projectPath: "/projects/repo-b",
      projectName: "repo-b",
      label: "code -- repo-b/b-1",
      needsAttention: false,
      exited: false,
      exitCode: null,
      bufferSize: 0,
      completed: true,
      autoRelaunch: true,
    };

    await act(async () => {
      rerender(
        <CodeWorkflowTab
          {...defaultProps}
          onLaunchHeadless={onLaunchHeadless}
          trackedRepos={trackedRepos}
          reposLoading={false}
          headlessSessions={[completedA, completedB]}
        />
      );
    });

    await vi.waitFor(() => {
      expect(onLaunchHeadless).toHaveBeenCalledTimes(6);
    });
    const relaunchPaths = onLaunchHeadless.mock.calls.slice(4).map((c) => c[0]).sort();
    expect(relaunchPaths).toEqual(["/projects/repo-a", "/projects/repo-b"]);
  });

  it("does not relaunch when an individual-task Start completes (autoRelaunch flag absent)", async () => {
    const onLaunchHeadless = vi.fn().mockResolvedValue("ht-ind");
    const trackedRepos = [makeRepo({
      groomedCount: 2,
      groomedTasks: [
        { slug: "add-feature", description: "Add feature" },
        { slug: "fix-bug", description: "Fix bug" },
      ],
    })];

    const { container, rerender } = render(
      <CodeWorkflowTab
        {...defaultProps}
        onLaunchHeadless={onLaunchHeadless}
        trackedRepos={trackedRepos}
        reposLoading={false}
      />
    );

    await act(async () => {
      fireEvent.click(container.querySelector(".repo-task-row")!);
    });
    await act(async () => {
      const queuedItems = container.querySelectorAll(".repo-task-row-session.queued");
      fireEvent.click(queuedItems[0].querySelector("button")!);
    });

    await vi.waitFor(() => {
      expect(onLaunchHeadless).toHaveBeenCalledTimes(1);
    });
    expect(onLaunchHeadless.mock.calls[0][5]).toBeUndefined();

    const completedSession: HeadlessSession = {
      terminalId: "t-ind",
      projectPath: "/projects/repo-a",
      projectName: "repo-a",
      label: "code -- repo-a/add-feature",
      needsAttention: false,
      exited: false,
      exitCode: null,
      bufferSize: 0,
      completed: true,
      autoRelaunch: false,
    };

    rerender(
      <CodeWorkflowTab
        {...defaultProps}
        onLaunchHeadless={onLaunchHeadless}
        trackedRepos={trackedRepos}
        reposLoading={false}
        headlessSessions={[completedSession]}
      />
    );

    await new Promise((r) => setTimeout(r, 30));
    expect(onLaunchHeadless).toHaveBeenCalledTimes(1);
  });

  it("does not relaunch when a session exits with failure (completed:false)", async () => {
    const onLaunchHeadless = vi.fn().mockResolvedValue("ht-fail");
    const trackedRepos = [makeRepo({ groomedCount: 2 })];

    mockInvoke.mockResolvedValue({
      activeSlugs: [],
      backlogSlugs: [{ slug: "code-1", tier: null, mode: "code" }],
      totalGroomed: 1,
    });

    const { rerender } = render(
      <CodeWorkflowTab
        {...defaultProps}
        onLaunchHeadless={onLaunchHeadless}
        trackedRepos={trackedRepos}
        reposLoading={false}
      />
    );

    await act(async () => {
      fireEvent.click(screen.getByText("Start"));
    });

    await vi.waitFor(() => {
      expect(onLaunchHeadless).toHaveBeenCalledTimes(1);
    });

    const failedSession: HeadlessSession = {
      terminalId: "t-fail",
      projectPath: "/projects/repo-a",
      projectName: "repo-a",
      label: "code -- repo-a/code-1",
      needsAttention: false,
      exited: true,
      exitCode: 1,
      bufferSize: 0,
      completed: false,
      autoRelaunch: true,
    };

    rerender(
      <CodeWorkflowTab
        {...defaultProps}
        onLaunchHeadless={onLaunchHeadless}
        trackedRepos={trackedRepos}
        reposLoading={false}
        headlessSessions={[failedSession]}
      />
    );

    await new Promise((r) => setTimeout(r, 30));
    expect(onLaunchHeadless).toHaveBeenCalledTimes(1);
  });

  it("terminates cleanly without a second launch when the backlog is exhausted on completion", async () => {
    const onLaunchHeadless = vi.fn().mockResolvedValue("ht-empty");
    const trackedRepos = [makeRepo({ groomedCount: 1 })];

    let call = 0;
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "get_parallelizable_tasks") {
        call++;
        if (call === 1) {
          return Promise.resolve({
            activeSlugs: [],
            backlogSlugs: [{ slug: "code-1", tier: null, mode: "code" }],
            totalGroomed: 1,
          });
        }
        return Promise.resolve({ activeSlugs: [], backlogSlugs: [], totalGroomed: 0 });
      }
      return Promise.resolve(undefined);
    });

    const { rerender } = render(
      <CodeWorkflowTab
        {...defaultProps}
        onLaunchHeadless={onLaunchHeadless}
        trackedRepos={trackedRepos}
        reposLoading={false}
      />
    );

    await act(async () => {
      fireEvent.click(screen.getByText("Start"));
    });

    await vi.waitFor(() => {
      expect(onLaunchHeadless).toHaveBeenCalledTimes(1);
    });

    const completedSession: HeadlessSession = {
      terminalId: "t-empty",
      projectPath: "/projects/repo-a",
      projectName: "repo-a",
      label: "code -- repo-a/code-1",
      needsAttention: false,
      exited: false,
      exitCode: null,
      bufferSize: 0,
      completed: true,
      autoRelaunch: true,
    };

    await act(async () => {
      rerender(
        <CodeWorkflowTab
          {...defaultProps}
          onLaunchHeadless={onLaunchHeadless}
          trackedRepos={trackedRepos}
          reposLoading={false}
          headlessSessions={[completedSession]}
        />
      );
    });

    await vi.waitFor(() => {
      expect(call).toBeGreaterThanOrEqual(2);
    });
    await new Promise((r) => setTimeout(r, 30));
    expect(onLaunchHeadless).toHaveBeenCalledTimes(1);
  });

  it("relaunches a deferred reggie-system task in another repo after the slot-holder completes", async () => {
    const onLaunchHeadless = vi.fn().mockResolvedValue("ht-rsys-rl");
    const trackedRepos = [
      makeRepo({ name: "repo-a", path: "/projects/repo-a", groomedCount: 1 }),
      makeRepo({ name: "repo-b", path: "/projects/repo-b", groomedCount: 1 }),
    ];

    const callsByRepo: Record<string, number> = {};
    mockInvoke.mockImplementation((cmd: string, args: { projectPath: string }) => {
      if (cmd === "get_parallelizable_tasks") {
        callsByRepo[args.projectPath] = (callsByRepo[args.projectPath] ?? 0) + 1;
        if (args.projectPath === "/projects/repo-a") {
          if (callsByRepo[args.projectPath] === 1) {
            return Promise.resolve({
              activeSlugs: [],
              backlogSlugs: [{ slug: "rs-a", tier: null, mode: "reggie-system" }],
              totalGroomed: 1,
            });
          }
          return Promise.resolve({ activeSlugs: [], backlogSlugs: [], totalGroomed: 0 });
        }
        return Promise.resolve({
          activeSlugs: [],
          backlogSlugs: [{ slug: "rs-b", tier: null, mode: "reggie-system" }],
          totalGroomed: 1,
        });
      }
      return Promise.resolve(undefined);
    });

    const { rerender } = render(
      <CodeWorkflowTab
        {...defaultProps}
        onLaunchHeadless={onLaunchHeadless}
        trackedRepos={trackedRepos}
        reposLoading={false}
      />
    );

    await act(async () => {
      fireEvent.click(screen.getByText("Batch Start Coding"));
    });

    await vi.waitFor(() => {
      expect(onLaunchHeadless).toHaveBeenCalledTimes(1);
    });
    expect(onLaunchHeadless.mock.calls[0][1]).toBe("/reggie-system-change --yes rs-a");

    const completedRsA: HeadlessSession = {
      terminalId: "t-rs-a",
      projectPath: "/projects/repo-a",
      projectName: "repo-a",
      label: "reggie-sys -- repo-a/rs-a",
      needsAttention: false,
      exited: false,
      exitCode: null,
      bufferSize: 0,
      completed: true,
      autoRelaunch: true,
    };

    await act(async () => {
      rerender(
        <CodeWorkflowTab
          {...defaultProps}
          onLaunchHeadless={onLaunchHeadless}
          trackedRepos={trackedRepos}
          reposLoading={false}
          headlessSessions={[completedRsA]}
        />
      );
    });

    await vi.waitFor(() => {
      expect(onLaunchHeadless).toHaveBeenCalledTimes(2);
    });
    const secondCall = onLaunchHeadless.mock.calls[1];
    expect(secondCall[0]).toBe("/projects/repo-b");
    expect(secondCall[1]).toBe("/reggie-system-change --yes rs-b");
  });

  it("does not double-relaunch when the same completed session is re-emitted", async () => {
    const onLaunchHeadless = vi.fn().mockResolvedValue("ht-idem");
    const trackedRepos = [makeRepo({ groomedCount: 2 })];

    let call = 0;
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "get_parallelizable_tasks") {
        call++;
        const slugs =
          call === 1
            ? [
                { slug: "code-1", tier: null, mode: "code" },
                { slug: "code-2", tier: null, mode: "code" },
              ]
            : [{ slug: "code-2", tier: null, mode: "code" }];
        return Promise.resolve({ activeSlugs: [], backlogSlugs: slugs, totalGroomed: slugs.length });
      }
      return Promise.resolve(undefined);
    });

    const { rerender } = render(
      <CodeWorkflowTab
        {...defaultProps}
        onLaunchHeadless={onLaunchHeadless}
        trackedRepos={trackedRepos}
        reposLoading={false}
      />
    );

    await act(async () => {
      fireEvent.click(screen.getByText("Start"));
    });

    await vi.waitFor(() => {
      expect(onLaunchHeadless).toHaveBeenCalledTimes(2);
    });

    const completedSession: HeadlessSession = {
      terminalId: "t-idem",
      projectPath: "/projects/repo-a",
      projectName: "repo-a",
      label: "code -- repo-a/code-1",
      needsAttention: false,
      exited: false,
      exitCode: null,
      bufferSize: 0,
      completed: true,
      autoRelaunch: true,
    };

    rerender(
      <CodeWorkflowTab
        {...defaultProps}
        onLaunchHeadless={onLaunchHeadless}
        trackedRepos={trackedRepos}
        reposLoading={false}
        headlessSessions={[completedSession]}
      />
    );

    await vi.waitFor(() => {
      expect(onLaunchHeadless).toHaveBeenCalledTimes(3);
    });

    rerender(
      <CodeWorkflowTab
        {...defaultProps}
        onLaunchHeadless={onLaunchHeadless}
        trackedRepos={trackedRepos}
        reposLoading={false}
        headlessSessions={[{ ...completedSession }]}
      />
    );

    await new Promise((r) => setTimeout(r, 30));
    expect(onLaunchHeadless).toHaveBeenCalledTimes(3);
  });

  it("does not double-dispatch reggie-system when fan-out runs to multiple peers (cap-of-1 holds)", async () => {
    const onLaunchHeadless = vi.fn().mockResolvedValue("ht-fanout");
    const trackedRepos = [
      makeRepo({ name: "repo-a", path: "/projects/repo-a", groomedCount: 1 }),
      makeRepo({ name: "repo-b", path: "/projects/repo-b", groomedCount: 1 }),
      makeRepo({ name: "repo-c", path: "/projects/repo-c", groomedCount: 1 }),
    ];

    // Each repo always returns its own reggie-system backlog slug. repo-a's
    // own relaunch finds an empty backlog (its one task just completed).
    const callsByRepo: Record<string, number> = {};
    mockInvoke.mockImplementation((cmd: string, args: { projectPath: string }) => {
      if (cmd === "get_parallelizable_tasks") {
        callsByRepo[args.projectPath] = (callsByRepo[args.projectPath] ?? 0) + 1;
        if (args.projectPath === "/projects/repo-a") {
          return Promise.resolve({ activeSlugs: [], backlogSlugs: [], totalGroomed: 0 });
        }
        const slug = args.projectPath === "/projects/repo-b" ? "rs-b" : "rs-c";
        return Promise.resolve({
          activeSlugs: [],
          backlogSlugs: [{ slug, tier: null, mode: "reggie-system" }],
          totalGroomed: 1,
        });
      }
      return Promise.resolve(undefined);
    });

    const { rerender } = render(
      <CodeWorkflowTab
        {...defaultProps}
        onLaunchHeadless={onLaunchHeadless}
        trackedRepos={trackedRepos}
        reposLoading={false}
      />
    );

    // Trigger the fan-out: repo-a's reggie-system session completes with autoRelaunch.
    const completedRsA: HeadlessSession = {
      terminalId: "t-rs-a",
      projectPath: "/projects/repo-a",
      projectName: "repo-a",
      label: "reggie-sys -- repo-a/rs-a",
      needsAttention: false,
      exited: false,
      exitCode: null,
      bufferSize: 0,
      completed: true,
      autoRelaunch: true,
    };

    await act(async () => {
      rerender(
        <CodeWorkflowTab
          {...defaultProps}
          onLaunchHeadless={onLaunchHeadless}
          trackedRepos={trackedRepos}
          reposLoading={false}
          headlessSessions={[completedRsA]}
        />
      );
    });

    // Wait for the fan-out to settle. repo-a relaunch (no backlog) + exactly
    // ONE peer claims the freed slot (cap-of-1 across the workspace).
    await vi.waitFor(() => {
      expect(onLaunchHeadless).toHaveBeenCalledTimes(1);
    });
    // Stability hold: ensure no second peer launches racing in.
    await new Promise((r) => setTimeout(r, 50));
    expect(onLaunchHeadless).toHaveBeenCalledTimes(1);

    const reggieCalls = onLaunchHeadless.mock.calls.filter((c) =>
      String(c[2]).startsWith("reggie-sys --"),
    );
    expect(reggieCalls).toHaveLength(1);
  });

  it("does not suppress a same-named slug in another repo via the recently-completed filter", async () => {
    const onLaunchHeadless = vi.fn().mockResolvedValue("ht-shared-slug");
    const trackedRepos = [
      makeRepo({
        name: "repo-a",
        path: "/projects/repo-a",
        groomedCount: 1,
        groomedTasks: [{ slug: "shared-slug", description: "Shared", mode: "code" }],
      }),
      makeRepo({
        name: "repo-b",
        path: "/projects/repo-b",
        groomedCount: 1,
        groomedTasks: [{ slug: "shared-slug", description: "Shared", mode: "code" }],
      }),
    ];

    // Both repos report "shared-slug" as backlog (mode: code).
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "get_parallelizable_tasks") {
        return Promise.resolve({
          activeSlugs: [],
          backlogSlugs: [{ slug: "shared-slug", tier: null, mode: "code" }],
          totalGroomed: 1,
        });
      }
      return Promise.resolve(undefined);
    });

    const { rerender } = render(
      <CodeWorkflowTab
        {...defaultProps}
        onLaunchHeadless={onLaunchHeadless}
        trackedRepos={trackedRepos}
        reposLoading={false}
      />
    );

    // repo-a's "shared-slug" session completes with autoRelaunch — this writes
    // `/projects/repo-a::shared-slug` into recentlyCompletedSlugsRef.
    const completedSession: HeadlessSession = {
      terminalId: "t-shared-a",
      projectPath: "/projects/repo-a",
      projectName: "repo-a",
      label: "code -- repo-a/shared-slug",
      needsAttention: false,
      exited: false,
      exitCode: null,
      bufferSize: 0,
      completed: true,
      autoRelaunch: true,
    };

    await act(async () => {
      rerender(
        <CodeWorkflowTab
          {...defaultProps}
          onLaunchHeadless={onLaunchHeadless}
          trackedRepos={trackedRepos}
          reposLoading={false}
          headlessSessions={[completedSession]}
        />
      );
    });

    // The auto-relaunch effect fires launchForRepo for repo-a. repo-a's filter
    // suppresses its own "shared-slug" (composite key match) and shows no-tasks.
    await new Promise((r) => setTimeout(r, 30));

    // Now click the per-repo Start button on repo-b. Composite keying means
    // repo-b's "shared-slug" is NOT suppressed (key would be `/projects/repo-b::shared-slug`).
    const startButtons = screen.getAllByText("Start");
    // Two repos — find repo-b's Start button. Both are still unblocked since
    // neither has running sessions (the completed one doesn't count).
    expect(startButtons.length).toBeGreaterThanOrEqual(1);

    const callsBefore = onLaunchHeadless.mock.calls.length;
    // Click the second Start button (repo-b appears after repo-a in render order).
    await act(async () => {
      fireEvent.click(startButtons[startButtons.length - 1]);
    });

    await vi.waitFor(() => {
      expect(onLaunchHeadless.mock.calls.length).toBeGreaterThan(callsBefore);
    });

    // Verify repo-b's shared-slug DID launch (was not suppressed by repo-a's entry).
    const repoBCall = onLaunchHeadless.mock.calls.find(
      (c) => c[0] === "/projects/repo-b" && String(c[1]).includes("shared-slug"),
    );
    expect(repoBCall).toBeTruthy();
  });
});
