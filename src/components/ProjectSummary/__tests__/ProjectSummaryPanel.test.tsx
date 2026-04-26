import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { mockInvoke, resetTauriMocks } from "../../../__test-utils__/tauri-mock";
import { ProjectSummaryPanel } from "../ProjectSummaryPanel";
import type { ProjectInfo } from "../../../types/project-info";

// Mock react-markdown to avoid ESM/rendering issues in tests
vi.mock("react-markdown", () => ({
  default: ({ children }: { children: string }) => <div>{children}</div>,
}));

// Mock child components that are not under test
vi.mock("../SessionCard", () => ({
  SessionCard: ({ session, onResume }: { session: { sessionId: string; summary: string }; onResume: (id: string) => void }) => (
    <div data-testid={`session-${session.sessionId}`} onClick={() => onResume(session.sessionId)}>
      {session.summary}
    </div>
  ),
}));

vi.mock("../../TasksViewer/TasksViewer", () => ({
  TasksViewer: () => <div data-testid="tasks-viewer" />,
}));

const defaultProjectInfo: ProjectInfo = {
  name: "test-project",
  path: "/test/project",
  description: "A test project",
  techStack: ["TypeScript", "React"],
  claudeMd: null,
  tasksMd: null,
  readmeExcerpt: null,
  isGitRepo: true,
  gitBranch: "main",
  lastCommit: "abc123",
};

function setupInvokeMock(
  projectInfo: ProjectInfo = defaultProjectInfo,
  sessions: unknown[] = []
) {
  mockInvoke.mockImplementation((cmd: string) => {
    if (cmd === "get_sessions_for_project") return Promise.resolve(sessions);
    if (cmd === "get_project_info") return Promise.resolve(projectInfo);
    if (cmd === "append_ungroomed_tasks") return Promise.resolve(null);
    return Promise.resolve(null);
  });
}

const defaultProps = {
  projectName: "test-project",
  projectPath: "/test/project",
  onResumeSession: vi.fn(),
  onNewSession: vi.fn(),
  onNewShell: vi.fn(),
};

describe("ProjectSummaryPanel", () => {
  beforeEach(() => {
    resetTauriMocks();
    vi.restoreAllMocks();
  });

  it("renders the Add Tasks section with textarea and button", async () => {
    setupInvokeMock();
    render(<ProjectSummaryPanel {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText("Add Tasks")).toBeTruthy();
    });

    expect(screen.getByPlaceholderText(/Add tasks \(one per line/)).toBeTruthy();
    expect(screen.getByText("Add to Ungroomed")).toBeTruthy();
  });

  it("disables the submit button when textarea is empty", async () => {
    setupInvokeMock();
    render(<ProjectSummaryPanel {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText("Add to Ungroomed")).toBeTruthy();
    });

    const button = screen.getByText("Add to Ungroomed");
    expect(button).toBeTruthy();
    expect((button as HTMLButtonElement).disabled).toBe(true);
  });

  it("enables the submit button when textarea has content", async () => {
    setupInvokeMock();
    render(<ProjectSummaryPanel {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText("Add to Ungroomed")).toBeTruthy();
    });

    const textarea = screen.getByPlaceholderText(/Add tasks \(one per line/);
    fireEvent.change(textarea, { target: { value: "- new task" } });

    const button = screen.getByText("Add to Ungroomed");
    expect((button as HTMLButtonElement).disabled).toBe(false);
  });

  it("calls invoke with correct command and args on submit", async () => {
    setupInvokeMock();
    render(<ProjectSummaryPanel {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText("Add to Ungroomed")).toBeTruthy();
    });

    const textarea = screen.getByPlaceholderText(/Add tasks \(one per line/);
    fireEvent.change(textarea, { target: { value: "- task one\n- task two" } });

    const button = screen.getByText("Add to Ungroomed");
    fireEvent.click(button);

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("append_ungroomed_tasks", {
        projectPath: "/test/project",
        tasks: [
          { description: "task one", attachments: [] },
          { description: "task two", attachments: [] },
        ],
      });
    });
  });

  it("clears textarea after successful submit", async () => {
    setupInvokeMock();
    render(<ProjectSummaryPanel {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText("Add to Ungroomed")).toBeTruthy();
    });

    const textarea = screen.getByPlaceholderText(/Add tasks \(one per line/) as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: "- my task" } });
    expect(textarea.value).toBe("- my task");

    const button = screen.getByText("Add to Ungroomed");
    fireEvent.click(button);

    await waitFor(() => {
      expect(textarea.value).toBe("");
    });
  });

  it("shows success indicator after successful submit", async () => {
    setupInvokeMock();
    render(<ProjectSummaryPanel {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText("Add to Ungroomed")).toBeTruthy();
    });

    const textarea = screen.getByPlaceholderText(/Add tasks \(one per line/);
    fireEvent.change(textarea, { target: { value: "a task" } });

    const button = screen.getByText("Add to Ungroomed");
    fireEvent.click(button);

    await waitFor(() => {
      expect(screen.getByText("Tasks added")).toBeTruthy();
    });
  });

  it("shows Adding... text while submitting", async () => {
    // Make append_ungroomed_tasks hang so we can observe the submitting state
    let resolveAppend: (() => void) | undefined;
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "get_sessions_for_project") return Promise.resolve([]);
      if (cmd === "get_project_info") return Promise.resolve(defaultProjectInfo);
      if (cmd === "append_ungroomed_tasks") {
        return new Promise<void>((resolve) => { resolveAppend = resolve; });
      }
      return Promise.resolve(null);
    });

    render(<ProjectSummaryPanel {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText("Add to Ungroomed")).toBeTruthy();
    });

    const textarea = screen.getByPlaceholderText(/Add tasks \(one per line/);
    fireEvent.change(textarea, { target: { value: "a task" } });

    const button = screen.getByText("Add to Ungroomed");
    fireEvent.click(button);

    await waitFor(() => {
      expect(screen.getByText("Adding...")).toBeTruthy();
    });

    // The button should be disabled while submitting
    expect((screen.getByText("Adding...") as HTMLButtonElement).disabled).toBe(true);

    // Resolve to clean up
    resolveAppend!();
    await waitFor(() => {
      expect(screen.getByText("Add to Ungroomed")).toBeTruthy();
    });
  });

  it("does not call invoke when input is only whitespace", async () => {
    setupInvokeMock();
    render(<ProjectSummaryPanel {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText("Add to Ungroomed")).toBeTruthy();
    });

    const textarea = screen.getByPlaceholderText(/Add tasks \(one per line/);
    fireEvent.change(textarea, { target: { value: "   \n  " } });

    // Button should still be disabled (trim check)
    const button = screen.getByText("Add to Ungroomed");
    expect((button as HTMLButtonElement).disabled).toBe(true);
  });

  it("disables textarea while submitting", async () => {
    let resolveAppend: (() => void) | undefined;
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "get_sessions_for_project") return Promise.resolve([]);
      if (cmd === "get_project_info") return Promise.resolve(defaultProjectInfo);
      if (cmd === "append_ungroomed_tasks") {
        return new Promise<void>((resolve) => { resolveAppend = resolve; });
      }
      return Promise.resolve(null);
    });

    render(<ProjectSummaryPanel {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText("Add to Ungroomed")).toBeTruthy();
    });

    const textarea = screen.getByPlaceholderText(/Add tasks \(one per line/) as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: "a task" } });
    fireEvent.click(screen.getByText("Add to Ungroomed"));

    await waitFor(() => {
      expect(textarea.disabled).toBe(true);
    });

    resolveAppend!();
    await waitFor(() => {
      expect(textarea.disabled).toBe(false);
    });
  });

  it("keeps textarea content and does not show success when submission fails", async () => {
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "get_sessions_for_project") return Promise.resolve([]);
      if (cmd === "get_project_info") return Promise.resolve(defaultProjectInfo);
      if (cmd === "append_ungroomed_tasks") return Promise.reject("write error");
      return Promise.resolve(null);
    });

    // Suppress console.error for expected error
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    render(<ProjectSummaryPanel {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText("Add to Ungroomed")).toBeTruthy();
    });

    const textarea = screen.getByPlaceholderText(/Add tasks \(one per line/) as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: "- my task" } });
    fireEvent.click(screen.getByText("Add to Ungroomed"));

    // Wait for the promise to reject and submitting state to clear
    await waitFor(() => {
      expect(screen.getByText("Add to Ungroomed")).toBeTruthy();
    });

    // Textarea should retain its value on failure
    expect(textarea.value).toBe("- my task");
    // "Tasks added" should NOT appear
    expect(screen.queryByText("Tasks added")).toBeNull();

    consoleSpy.mockRestore();
  });

  it("calls onTasksAdded callback after successful task submission", async () => {
    setupInvokeMock();
    const onTasksAdded = vi.fn();
    render(
      <ProjectSummaryPanel {...defaultProps} onTasksAdded={onTasksAdded} />
    );

    await waitFor(() => {
      expect(screen.getByText("Add to Ungroomed")).toBeTruthy();
    });

    const textarea = screen.getByPlaceholderText(/Add tasks \(one per line/);
    fireEvent.change(textarea, { target: { value: "- refresh test" } });

    const button = screen.getByText("Add to Ungroomed");
    fireEvent.click(button);

    await waitFor(() => {
      expect(onTasksAdded).toHaveBeenCalledTimes(1);
    });
  });

  it("does not call onTasksAdded when submission fails", async () => {
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "get_sessions_for_project") return Promise.resolve([]);
      if (cmd === "get_project_info") return Promise.resolve(defaultProjectInfo);
      if (cmd === "append_ungroomed_tasks") return Promise.reject("write error");
      return Promise.resolve(null);
    });

    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const onTasksAdded = vi.fn();
    render(
      <ProjectSummaryPanel {...defaultProps} onTasksAdded={onTasksAdded} />
    );

    await waitFor(() => {
      expect(screen.getByText("Add to Ungroomed")).toBeTruthy();
    });

    const textarea = screen.getByPlaceholderText(/Add tasks \(one per line/);
    fireEvent.change(textarea, { target: { value: "- failing task" } });
    fireEvent.click(screen.getByText("Add to Ungroomed"));

    // Wait for the promise to reject and submitting state to clear
    await waitFor(() => {
      expect(screen.getByText("Add to Ungroomed")).toBeTruthy();
    });

    expect(onTasksAdded).not.toHaveBeenCalled();

    consoleSpy.mockRestore();
  });

  it("reloads project data after successful task submission", async () => {
    setupInvokeMock();
    render(<ProjectSummaryPanel {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText("Add to Ungroomed")).toBeTruthy();
    });

    // Clear mock call counts after initial load
    mockInvoke.mockClear();
    setupInvokeMock();

    const textarea = screen.getByPlaceholderText(/Add tasks \(one per line/);
    fireEvent.change(textarea, { target: { value: "reload test task" } });

    const button = screen.getByText("Add to Ungroomed");
    fireEvent.click(button);

    await waitFor(() => {
      // After submit, loadProjectData should be called again (get_sessions_for_project + get_project_info)
      const calls = mockInvoke.mock.calls.map((c) => c[0]);
      expect(calls).toContain("append_ungroomed_tasks");
      expect(calls).toContain("get_sessions_for_project");
      expect(calls).toContain("get_project_info");
    });
  });
});

/**
 * Helper to get the DOM position of a section heading within the container.
 * Returns the index in the container's innerHTML string, or -1 if not found.
 */
function getSectionPosition(container: HTMLElement, headingText: string): number {
  const headings = container.querySelectorAll("h4");
  for (const h of headings) {
    if (h.textContent?.includes(headingText)) {
      // Use compareDocumentPosition to get a numeric ordering
      // But for simple position comparison, return the offset in innerHTML
      return Array.from(container.querySelectorAll("h4")).indexOf(h);
    }
  }
  return -1;
}

describe("ProjectSummaryPanel section ordering", () => {
  beforeEach(() => {
    resetTauriMocks();
    vi.restoreAllMocks();
  });

  const fullProjectInfo: ProjectInfo = {
    ...defaultProjectInfo,
    tasksMd: "## Active\n\n### my-task\nDo something",
    claudeMd: "# Project CLAUDE.md\nSome instructions here",
    description: "A test project",
  };

  const sessionsData = [
    {
      sessionId: "s1",
      summary: "Session one",
      firstPrompt: null,
      messageCount: 5,
      modified: "2026-04-01",
      created: "2026-04-01",
      gitBranch: "main",
      projectPath: "/test/project",
    },
  ];

  it("renders TASKS.md before Add Tasks when all sections are present", async () => {
    setupInvokeMock(fullProjectInfo, sessionsData);
    const { container } = render(
      <ProjectSummaryPanel {...defaultProps} onStartTask={vi.fn()} />
    );

    await waitFor(() => {
      expect(screen.getByText("TASKS.md")).toBeTruthy();
    });

    const tasksMdPos = getSectionPosition(container, "TASKS.md");
    const addTasksPos = getSectionPosition(container, "Add Tasks");

    expect(tasksMdPos).toBeGreaterThanOrEqual(0);
    expect(addTasksPos).toBeGreaterThanOrEqual(0);
    expect(tasksMdPos).toBeLessThan(addTasksPos);
  });

  it("renders Add Tasks before Recent Sessions", async () => {
    setupInvokeMock(fullProjectInfo, sessionsData);
    const { container } = render(
      <ProjectSummaryPanel {...defaultProps} onStartTask={vi.fn()} />
    );

    await waitFor(() => {
      expect(screen.getByText("Add Tasks")).toBeTruthy();
    });

    const addTasksPos = getSectionPosition(container, "Add Tasks");
    const recentSessionsPos = getSectionPosition(container, "Recent Sessions");

    expect(addTasksPos).toBeGreaterThanOrEqual(0);
    expect(recentSessionsPos).toBeGreaterThanOrEqual(0);
    expect(addTasksPos).toBeLessThan(recentSessionsPos);
  });

  it("renders Recent Sessions before CLAUDE.md", async () => {
    setupInvokeMock(fullProjectInfo, sessionsData);
    const { container } = render(
      <ProjectSummaryPanel {...defaultProps} onStartTask={vi.fn()} />
    );

    await waitFor(() => {
      expect(screen.getByText("CLAUDE.md")).toBeTruthy();
    });

    const recentSessionsPos = getSectionPosition(container, "Recent Sessions");
    const claudeMdPos = getSectionPosition(container, "CLAUDE.md");

    expect(recentSessionsPos).toBeGreaterThanOrEqual(0);
    expect(claudeMdPos).toBeGreaterThanOrEqual(0);
    expect(recentSessionsPos).toBeLessThan(claudeMdPos);
  });

  it("renders all four section headings in correct order: TASKS.md, Add Tasks, Recent Sessions, CLAUDE.md", async () => {
    setupInvokeMock(fullProjectInfo, sessionsData);
    const { container } = render(
      <ProjectSummaryPanel {...defaultProps} onStartTask={vi.fn()} />
    );

    await waitFor(() => {
      expect(screen.getByText("CLAUDE.md")).toBeTruthy();
    });

    const headings = Array.from(container.querySelectorAll("h4"));
    const headingTexts = headings.map((h) => h.textContent?.replace(/\d+$/, "").trim());

    const tasksMdIdx = headingTexts.indexOf("TASKS.md");
    const addTasksIdx = headingTexts.indexOf("Add Tasks");
    const recentSessionsIdx = headingTexts.indexOf("Recent Sessions");
    const claudeMdIdx = headingTexts.indexOf("CLAUDE.md");

    expect(tasksMdIdx).toBeGreaterThanOrEqual(0);
    expect(addTasksIdx).toBeGreaterThanOrEqual(0);
    expect(recentSessionsIdx).toBeGreaterThanOrEqual(0);
    expect(claudeMdIdx).toBeGreaterThanOrEqual(0);

    // Verify strict ordering
    expect(tasksMdIdx).toBeLessThan(addTasksIdx);
    expect(addTasksIdx).toBeLessThan(recentSessionsIdx);
    expect(recentSessionsIdx).toBeLessThan(claudeMdIdx);
  });

  it("renders Add Tasks before Recent Sessions when tasksMd is null (TASKS.md section absent)", async () => {
    const noTasksMdInfo: ProjectInfo = {
      ...fullProjectInfo,
      tasksMd: null,
    };

    setupInvokeMock(noTasksMdInfo, sessionsData);
    const { container } = render(
      <ProjectSummaryPanel {...defaultProps} onStartTask={vi.fn()} />
    );

    await waitFor(() => {
      expect(screen.getByText("Add Tasks")).toBeTruthy();
    });

    // TASKS.md section should not be rendered
    expect(screen.queryByText("TASKS.md")).toBeNull();

    const headings = Array.from(container.querySelectorAll("h4"));
    const headingTexts = headings.map((h) => h.textContent?.replace(/\d+$/, "").trim());

    const addTasksIdx = headingTexts.indexOf("Add Tasks");
    const recentSessionsIdx = headingTexts.indexOf("Recent Sessions");

    expect(addTasksIdx).toBeGreaterThanOrEqual(0);
    expect(recentSessionsIdx).toBeGreaterThanOrEqual(0);
    expect(addTasksIdx).toBeLessThan(recentSessionsIdx);
  });
});

describe("task input persistence (external state)", () => {
  beforeEach(() => {
    resetTauriMocks();
    vi.restoreAllMocks();
    setupInvokeMock();
  });

  it("uses external taskInput when prop is provided", async () => {
    render(
      <ProjectSummaryPanel
        {...defaultProps}
        taskInput="some text"
        onTaskInputChange={vi.fn()}
      />
    );

    await waitFor(() => {
      expect(screen.getByText("Add Tasks")).toBeTruthy();
    });

    const textarea = screen.getByPlaceholderText(
      /Add tasks \(one per line/
    ) as HTMLTextAreaElement;
    expect(textarea.value).toBe("some text");
  });

  it("calls onTaskInputChange on textarea change", async () => {
    const onTaskInputChange = vi.fn();
    render(
      <ProjectSummaryPanel
        {...defaultProps}
        taskInput=""
        onTaskInputChange={onTaskInputChange}
      />
    );

    await waitFor(() => {
      expect(screen.getByText("Add Tasks")).toBeTruthy();
    });

    const textarea = screen.getByPlaceholderText(
      /Add tasks \(one per line/
    );
    fireEvent.change(textarea, { target: { value: "new task" } });

    expect(onTaskInputChange).toHaveBeenCalledWith("new task");
  });

  it("falls back to local state when taskInput prop is not provided", async () => {
    render(<ProjectSummaryPanel {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText("Add Tasks")).toBeTruthy();
    });

    const textarea = screen.getByPlaceholderText(
      /Add tasks \(one per line/
    ) as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: "local draft" } });

    expect(textarea.value).toBe("local draft");
  });

  it("clears external input on successful submit", async () => {
    const onTaskInputChange = vi.fn();
    render(
      <ProjectSummaryPanel
        {...defaultProps}
        taskInput="my task"
        onTaskInputChange={onTaskInputChange}
      />
    );

    await waitFor(() => {
      expect(screen.getByText("Add to Ungroomed")).toBeTruthy();
    });

    const button = screen.getByText("Add to Ungroomed");
    fireEvent.click(button);

    await waitFor(() => {
      expect(onTaskInputChange).toHaveBeenCalledWith("");
    });
  });

  it("does not clear external input on project path change", async () => {
    const onTaskInputChange = vi.fn();
    const { rerender } = render(
      <ProjectSummaryPanel
        {...defaultProps}
        projectPath="/project/alpha"
        taskInput="draft"
        onTaskInputChange={onTaskInputChange}
      />
    );

    await waitFor(() => {
      expect(screen.getByText("Add Tasks")).toBeTruthy();
    });

    // Clear mock so we can assert only calls from the rerender
    onTaskInputChange.mockClear();

    rerender(
      <ProjectSummaryPanel
        {...defaultProps}
        projectPath="/project/beta"
        taskInput="draft"
        onTaskInputChange={onTaskInputChange}
      />
    );

    // Wait for the effect to run (loading state change)
    await waitFor(() => {
      expect(screen.getByText("Loading project...")).toBeTruthy();
    });

    // onTaskInputChange should NOT have been called with "" — parent manages clearing
    expect(onTaskInputChange).not.toHaveBeenCalledWith("");
  });
});

describe("Run Locally button", () => {
  beforeEach(() => {
    resetTauriMocks();
    vi.restoreAllMocks();
  });

  function setupInvokeMockWithRunScript(
    projectInfo: ProjectInfo = defaultProjectInfo,
    sessions: unknown[] = [],
    runScriptResult: { exists: boolean; scriptPath: string; port: number } = {
      exists: true,
      scriptPath: "/test/.reggie/run.sh",
      port: 3001,
    }
  ) {
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "get_sessions_for_project") return Promise.resolve(sessions);
      if (cmd === "get_project_info") return Promise.resolve(projectInfo);
      if (cmd === "append_ungroomed_tasks") return Promise.resolve(null);
      if (cmd === "check_run_script") return Promise.resolve(runScriptResult);
      return Promise.resolve(null);
    });
  }

  it("renders Run Locally button when onRunLocally is provided", async () => {
    setupInvokeMockWithRunScript();
    render(
      <ProjectSummaryPanel {...defaultProps} onRunLocally={vi.fn()} />
    );

    await waitFor(() => {
      expect(screen.getByText(/Run Locally/)).toBeTruthy();
    });
  });

  it("does not render Run Locally button when onRunLocally is not provided", async () => {
    setupInvokeMock();
    render(<ProjectSummaryPanel {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText("Add Tasks")).toBeTruthy();
    });

    expect(screen.queryByText(/Run Locally/)).toBeNull();
  });

  it("shows Starting state when runLocallyState is starting", async () => {
    setupInvokeMockWithRunScript();
    render(
      <ProjectSummaryPanel
        {...defaultProps}
        onRunLocally={vi.fn()}
        runLocallyState="starting"
      />
    );

    await waitFor(() => {
      expect(screen.getByText("Starting...")).toBeTruthy();
    });

    const button = screen.getByText("Starting...");
    expect((button as HTMLButtonElement).disabled).toBe(true);
  });

  it("shows Stop button when runLocallyState is running", async () => {
    setupInvokeMockWithRunScript();
    render(
      <ProjectSummaryPanel
        {...defaultProps}
        onRunLocally={vi.fn()}
        onStopLocally={vi.fn()}
        runLocallyState="running"
      />
    );

    await waitFor(() => {
      expect(screen.getByText(/Stop/)).toBeTruthy();
    });
  });

  it("calls checkRunScript and onRunLocally on button click", async () => {
    setupInvokeMockWithRunScript();
    const onRunLocally = vi.fn();
    render(
      <ProjectSummaryPanel {...defaultProps} onRunLocally={onRunLocally} />
    );

    await waitFor(() => {
      expect(screen.getByText(/Run Locally/)).toBeTruthy();
    });

    fireEvent.click(screen.getByText(/Run Locally/));

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("check_run_script", {
        projectPath: "/test/project",
      });
    });

    await waitFor(() => {
      expect(onRunLocally).toHaveBeenCalledWith(3001, true);
    });
  });

  it("calls onStopLocally when Stop is clicked", async () => {
    setupInvokeMockWithRunScript();
    const onStopLocally = vi.fn();
    render(
      <ProjectSummaryPanel
        {...defaultProps}
        onRunLocally={vi.fn()}
        onStopLocally={onStopLocally}
        runLocallyState="running"
      />
    );

    await waitFor(() => {
      expect(screen.getByText(/Stop/)).toBeTruthy();
    });

    fireEvent.click(screen.getByText(/Stop/));

    expect(onStopLocally).toHaveBeenCalledTimes(1);
  });

  it("calls onRunLocally with exists=false when script is missing", async () => {
    setupInvokeMockWithRunScript(defaultProjectInfo, [], {
      exists: false,
      scriptPath: "/test/.reggie/run.sh",
      port: 4002,
    });
    const onRunLocally = vi.fn();
    render(
      <ProjectSummaryPanel {...defaultProps} onRunLocally={onRunLocally} />
    );

    await waitFor(() => {
      expect(screen.getByText(/Run Locally/)).toBeTruthy();
    });

    fireEvent.click(screen.getByText(/Run Locally/));

    await waitFor(() => {
      expect(onRunLocally).toHaveBeenCalledWith(4002, false);
    });
  });

  it("does not call onRunLocally when checkRunScript fails", async () => {
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "get_sessions_for_project") return Promise.resolve([]);
      if (cmd === "get_project_info") return Promise.resolve(defaultProjectInfo);
      if (cmd === "check_run_script") return Promise.reject("port allocation failed");
      return Promise.resolve(null);
    });

    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const onRunLocally = vi.fn();
    render(
      <ProjectSummaryPanel {...defaultProps} onRunLocally={onRunLocally} />
    );

    await waitFor(() => {
      expect(screen.getByText(/Run Locally/)).toBeTruthy();
    });

    fireEvent.click(screen.getByText(/Run Locally/));

    // Wait a tick for the rejected promise to settle
    await waitFor(() => {
      expect(consoleSpy).toHaveBeenCalled();
    });

    expect(onRunLocally).not.toHaveBeenCalled();
    consoleSpy.mockRestore();
  });

  it("does not render Run Locally button in starting state without onRunLocally", async () => {
    setupInvokeMock();
    render(
      <ProjectSummaryPanel {...defaultProps} runLocallyState="starting" />
    );

    await waitFor(() => {
      expect(screen.getByText("Add Tasks")).toBeTruthy();
    });

    expect(screen.queryByText("Starting...")).toBeNull();
  });

  it("does not render Stop button in running state without onRunLocally", async () => {
    setupInvokeMock();
    render(
      <ProjectSummaryPanel {...defaultProps} runLocallyState="running" />
    );

    await waitFor(() => {
      expect(screen.getByText("Add Tasks")).toBeTruthy();
    });

    expect(screen.queryByText(/Stop/)).toBeNull();
  });
});

// ──────────────────────────────────────────────────────────────────────────
// Image attachment behavior: paste, drop, submit-with-attachments, reset.
// ──────────────────────────────────────────────────────────────────────────

/**
 * Build an image File whose `arrayBuffer()` resolves to the given bytes.
 * jsdom's File implementation may not provide arrayBuffer in older versions,
 * so we polyfill it explicitly.
 */
function makeImageFile(
  name: string,
  type: string,
  bytes: number[] = [1, 2, 3],
): File {
  const file = new File([new Uint8Array(bytes)], name, { type });
  Object.defineProperty(file, "arrayBuffer", {
    value: () => Promise.resolve(new Uint8Array(bytes).buffer),
    writable: true,
  });
  return file;
}

/**
 * Build a clipboardData object for `fireEvent.paste`. Items must each have
 * `kind`, `type`, and `getAsFile()` to satisfy the paste handler.
 */
function makeClipboardData(files: File[]) {
  return {
    items: files.map((f) => ({
      kind: "file",
      type: f.type,
      getAsFile: () => f,
    })),
    files,
    types: ["Files"],
  };
}

/**
 * Build a dataTransfer object for `fireEvent.drop` / `fireEvent.dragOver`.
 */
function makeDataTransfer(files: File[]) {
  return {
    files,
    items: files.map((f) => ({ kind: "file", type: f.type, getAsFile: () => f })),
    types: ["Files"],
  };
}

/**
 * Wire mockInvoke so that `save_attachment_image` resolves to a deterministic
 * shape and `append_ungroomed_tasks` resolves to null. Project-info and
 * sessions calls return safe defaults.
 */
function setupAttachmentInvokeMock() {
  mockInvoke.mockImplementation((cmd: string, args?: Record<string, unknown>) => {
    if (cmd === "get_sessions_for_project") return Promise.resolve([]);
    if (cmd === "get_project_info") return Promise.resolve(defaultProjectInfo);
    if (cmd === "append_ungroomed_tasks") return Promise.resolve(null);
    if (cmd === "save_attachment_image") {
      const dirName = (args?.dirName as string) ?? "task-stub";
      const ext = (args?.extension as string) ?? "png";
      // Deterministic per-call index by counting prior calls for this command.
      const priorCalls = mockInvoke.mock.calls.filter(
        (c) => c[0] === "save_attachment_image" && (c[1] as { dirName?: string })?.dirName === dirName,
      ).length;
      // The current call IS in mock.calls already by the time mockImplementation
      // runs in vitest; subtract 1 to make this 1-based by occurrence.
      const idx = priorCalls; // already includes the current call
      return Promise.resolve({
        labelIndex: idx,
        path: `.reggie/attachments/${dirName}/${idx}.${ext}`,
      });
    }
    return Promise.resolve(null);
  });
}

describe("ProjectSummaryPanel: image paste", () => {
  beforeEach(() => {
    resetTauriMocks();
    vi.restoreAllMocks();
    setupAttachmentInvokeMock();
    // Make randomSuffix() deterministic so we can match on dirName.
    vi.spyOn(Math, "random").mockReturnValue(0.5);
  });

  it("inserts [Image 1] placeholder when a PNG is pasted", async () => {
    render(<ProjectSummaryPanel {...defaultProps} />);
    await waitFor(() => {
      expect(screen.getByText("Add to Ungroomed")).toBeTruthy();
    });
    const textarea = screen.getByPlaceholderText(/Add tasks \(one per line/) as HTMLTextAreaElement;
    const file = makeImageFile("shot.png", "image/png");

    fireEvent.paste(textarea, { clipboardData: makeClipboardData([file]) });

    await waitFor(() => {
      expect(textarea.value).toContain("[Image 1]");
    });
  });

  it("increments label counter across separate paste events", async () => {
    render(<ProjectSummaryPanel {...defaultProps} />);
    await waitFor(() => {
      expect(screen.getByText("Add to Ungroomed")).toBeTruthy();
    });
    const textarea = screen.getByPlaceholderText(/Add tasks \(one per line/) as HTMLTextAreaElement;

    fireEvent.paste(textarea, {
      clipboardData: makeClipboardData([makeImageFile("a.png", "image/png")]),
    });
    await waitFor(() => expect(textarea.value).toContain("[Image 1]"));

    fireEvent.paste(textarea, {
      clipboardData: makeClipboardData([makeImageFile("b.png", "image/png")]),
    });
    await waitFor(() => expect(textarea.value).toContain("[Image 2]"));
  });

  it("inserts both placeholders space-joined when two images are pasted at once", async () => {
    render(<ProjectSummaryPanel {...defaultProps} />);
    await waitFor(() => {
      expect(screen.getByText("Add to Ungroomed")).toBeTruthy();
    });
    const textarea = screen.getByPlaceholderText(/Add tasks \(one per line/) as HTMLTextAreaElement;

    fireEvent.paste(textarea, {
      clipboardData: makeClipboardData([
        makeImageFile("a.png", "image/png"),
        makeImageFile("b.jpg", "image/jpeg"),
      ]),
    });

    await waitFor(() => {
      expect(textarea.value).toContain("[Image 1]");
      expect(textarea.value).toContain("[Image 2]");
    });
    // Space-joined — no other punctuation between them.
    expect(textarea.value).toMatch(/\[Image 1\]\s+\[Image 2\]/);
  });

  it("shows a HEIC-specific error and does not insert a placeholder when HEIC is pasted", async () => {
    render(<ProjectSummaryPanel {...defaultProps} />);
    await waitFor(() => {
      expect(screen.getByText("Add to Ungroomed")).toBeTruthy();
    });
    const textarea = screen.getByPlaceholderText(/Add tasks \(one per line/) as HTMLTextAreaElement;

    fireEvent.paste(textarea, {
      clipboardData: makeClipboardData([makeImageFile("photo.heic", "image/heic")]),
    });

    await waitFor(() => {
      const alert = screen.getByRole("alert");
      expect(alert.textContent || "").toMatch(/HEIC/i);
    });
    expect(textarea.value).not.toContain("[Image");
  });

  it("shows a generic error for unsupported types like image/svg+xml", async () => {
    render(<ProjectSummaryPanel {...defaultProps} />);
    await waitFor(() => {
      expect(screen.getByText("Add to Ungroomed")).toBeTruthy();
    });
    const textarea = screen.getByPlaceholderText(/Add tasks \(one per line/) as HTMLTextAreaElement;

    fireEvent.paste(textarea, {
      clipboardData: makeClipboardData([makeImageFile("vector.svg", "image/svg+xml")]),
    });

    await waitFor(() => {
      const alert = screen.getByRole("alert");
      // The error text should NOT mention HEIC for this case.
      expect(alert.textContent || "").not.toMatch(/HEIC/i);
      expect(alert.textContent || "").toMatch(/[Uu]nsupported|PNG|JPG/);
    });
    expect(textarea.value).not.toContain("[Image");
  });

  it("inserts the PNG placeholder AND shows HEIC error for a mixed paste", async () => {
    render(<ProjectSummaryPanel {...defaultProps} />);
    await waitFor(() => {
      expect(screen.getByText("Add to Ungroomed")).toBeTruthy();
    });
    const textarea = screen.getByPlaceholderText(/Add tasks \(one per line/) as HTMLTextAreaElement;

    fireEvent.paste(textarea, {
      clipboardData: makeClipboardData([
        makeImageFile("good.png", "image/png"),
        makeImageFile("bad.heic", "image/heic"),
      ]),
    });

    await waitFor(() => {
      expect(textarea.value).toContain("[Image 1]");
    });
    const alert = await screen.findByRole("alert");
    expect(alert.textContent || "").toMatch(/HEIC/i);
  });

  it("auto-clears the paste error after the timeout window", async () => {
    // Use fake timers so the auto-clear setTimeout doesn't make this test wait
    // 4 seconds in real time. Note: fake timers must be set up BEFORE the
    // setTimeout call we want to control.
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      render(<ProjectSummaryPanel {...defaultProps} />);
      await waitFor(() => {
        expect(screen.getByText("Add to Ungroomed")).toBeTruthy();
      });
      const textarea = screen.getByPlaceholderText(/Add tasks \(one per line/) as HTMLTextAreaElement;

      fireEvent.paste(textarea, {
        clipboardData: makeClipboardData([makeImageFile("photo.heic", "image/heic")]),
      });

      // Wait for the alert to appear under shouldAdvanceTime fake timers.
      await waitFor(() => {
        expect(screen.queryByRole("alert")).not.toBeNull();
      });

      // Advance past the auto-clear window.
      await vi.advanceTimersByTimeAsync(5000);

      await waitFor(() => {
        expect(screen.queryByRole("alert")).toBeNull();
      });
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("ProjectSummaryPanel: image drop", () => {
  beforeEach(() => {
    resetTauriMocks();
    vi.restoreAllMocks();
    setupAttachmentInvokeMock();
    vi.spyOn(Math, "random").mockReturnValue(0.5);
  });

  it("inserts [Image 1] when a PNG file is dropped on the textarea", async () => {
    render(<ProjectSummaryPanel {...defaultProps} />);
    await waitFor(() => {
      expect(screen.getByText("Add to Ungroomed")).toBeTruthy();
    });
    const textarea = screen.getByPlaceholderText(/Add tasks \(one per line/) as HTMLTextAreaElement;
    const file = makeImageFile("dropped.png", "image/png");

    fireEvent.drop(textarea, { dataTransfer: makeDataTransfer([file]) });

    await waitFor(() => {
      expect(textarea.value).toContain("[Image 1]");
    });
  });

  it("calls preventDefault on drop with image files", async () => {
    render(<ProjectSummaryPanel {...defaultProps} />);
    await waitFor(() => {
      expect(screen.getByText("Add to Ungroomed")).toBeTruthy();
    });
    const textarea = screen.getByPlaceholderText(/Add tasks \(one per line/);
    const file = makeImageFile("d.png", "image/png");

    // fireEvent.drop returns whether default was NOT prevented; preventDefault → returns false.
    const notPrevented = fireEvent.drop(textarea, {
      dataTransfer: makeDataTransfer([file]),
    });
    expect(notPrevented).toBe(false);
  });

  it("calls preventDefault on dragOver when files are present", async () => {
    render(<ProjectSummaryPanel {...defaultProps} />);
    await waitFor(() => {
      expect(screen.getByText("Add to Ungroomed")).toBeTruthy();
    });
    const textarea = screen.getByPlaceholderText(/Add tasks \(one per line/);
    const notPrevented = fireEvent.dragOver(textarea, {
      dataTransfer: makeDataTransfer([makeImageFile("x.png", "image/png")]),
    });
    expect(notPrevented).toBe(false);
  });

  it("classifies a file by extension when its type field is empty", async () => {
    render(<ProjectSummaryPanel {...defaultProps} />);
    await waitFor(() => {
      expect(screen.getByText("Add to Ungroomed")).toBeTruthy();
    });
    const textarea = screen.getByPlaceholderText(/Add tasks \(one per line/) as HTMLTextAreaElement;
    // File with empty type but .png extension — the drop handler routes it via
    // the regex fallback, and classifyImageFile accepts it via filenameExt.
    const file = makeImageFile("noType.png", "");

    fireEvent.drop(textarea, { dataTransfer: makeDataTransfer([file]) });

    await waitFor(() => {
      expect(textarea.value).toContain("[Image 1]");
    });
  });
});

describe("ProjectSummaryPanel: submit with attachments", () => {
  beforeEach(() => {
    resetTauriMocks();
    vi.restoreAllMocks();
    setupAttachmentInvokeMock();
    vi.spyOn(Math, "random").mockReturnValue(0.5);
  });

  it("calls save_attachment_image once per image and append_ungroomed_tasks with the resolved path", async () => {
    render(<ProjectSummaryPanel {...defaultProps} />);
    await waitFor(() => {
      expect(screen.getByText("Add to Ungroomed")).toBeTruthy();
    });
    const textarea = screen.getByPlaceholderText(/Add tasks \(one per line/) as HTMLTextAreaElement;

    // Paste one image, then type the description in front of it.
    fireEvent.paste(textarea, {
      clipboardData: makeClipboardData([makeImageFile("a.png", "image/png")]),
    });
    await waitFor(() => expect(textarea.value).toContain("[Image 1]"));

    // Replace value to put the description first then the placeholder.
    fireEvent.change(textarea, { target: { value: "fix login [Image 1]" } });

    fireEvent.click(screen.getByText("Add to Ungroomed"));

    await waitFor(() => {
      const saveCalls = mockInvoke.mock.calls.filter((c) => c[0] === "save_attachment_image");
      expect(saveCalls).toHaveLength(1);
    });

    const saveCall = mockInvoke.mock.calls.find((c) => c[0] === "save_attachment_image")!;
    const saveArgs = saveCall[1] as {
      projectPath: string;
      dirName: string;
      extension: string;
      imageBytes: number[];
    };
    expect(saveArgs.projectPath).toBe("/test/project");
    expect(saveArgs.extension).toBe("png");
    // Slug is derived from the full description (incl. the [Image N] placeholder).
    expect(saveArgs.dirName).toMatch(/^fix-login-image-1-[a-z0-9]{6}$/);
    expect(Array.isArray(saveArgs.imageBytes)).toBe(true);

    // append_ungroomed_tasks payload should embed the resolved path.
    const appendCall = mockInvoke.mock.calls.find((c) => c[0] === "append_ungroomed_tasks")!;
    const appendArgs = appendCall[1] as {
      projectPath: string;
      tasks: { description: string; attachments: { label: string; path: string }[] }[];
    };
    expect(appendArgs.tasks).toHaveLength(1);
    expect(appendArgs.tasks[0].description).toBe("fix login [Image 1]");
    expect(appendArgs.tasks[0].attachments).toHaveLength(1);
    expect(appendArgs.tasks[0].attachments[0].label).toBe("Image 1");
    expect(appendArgs.tasks[0].attachments[0].path).toMatch(
      /^\.reggie\/attachments\/fix-login-image-1-[a-z0-9]{6}\/1\.png$/,
    );
  });

  it("uses a different dirName for each task line in a multi-task submit", async () => {
    render(<ProjectSummaryPanel {...defaultProps} />);
    await waitFor(() => {
      expect(screen.getByText("Add to Ungroomed")).toBeTruthy();
    });
    const textarea = screen.getByPlaceholderText(/Add tasks \(one per line/) as HTMLTextAreaElement;

    // Paste two images one at a time to assign Image 1 and Image 2.
    fireEvent.paste(textarea, {
      clipboardData: makeClipboardData([makeImageFile("a.png", "image/png")]),
    });
    await waitFor(() => expect(textarea.value).toContain("[Image 1]"));
    fireEvent.paste(textarea, {
      clipboardData: makeClipboardData([makeImageFile("b.png", "image/png")]),
    });
    await waitFor(() => expect(textarea.value).toContain("[Image 2]"));

    // Two list items, each with a different image label.
    fireEvent.change(textarea, {
      target: { value: "- task A [Image 1]\n- task B [Image 2]" },
    });
    fireEvent.click(screen.getByText("Add to Ungroomed"));

    await waitFor(() => {
      const saveCalls = mockInvoke.mock.calls.filter((c) => c[0] === "save_attachment_image");
      expect(saveCalls).toHaveLength(2);
    });

    const saveCalls = mockInvoke.mock.calls.filter((c) => c[0] === "save_attachment_image");
    const dirNames = saveCalls.map((c) => (c[1] as { dirName: string }).dirName);
    // Slug is derived from the full description (incl. the [Image N] placeholder).
    expect(dirNames[0]).toMatch(/^task-a-image-1-[a-z0-9]{6}$/);
    expect(dirNames[1]).toMatch(/^task-b-image-2-[a-z0-9]{6}$/);
    expect(dirNames[0]).not.toBe(dirNames[1]);
  });

  it("partitions images per task line based on their [Image N] references", async () => {
    render(<ProjectSummaryPanel {...defaultProps} />);
    await waitFor(() => {
      expect(screen.getByText("Add to Ungroomed")).toBeTruthy();
    });
    const textarea = screen.getByPlaceholderText(/Add tasks \(one per line/) as HTMLTextAreaElement;

    fireEvent.paste(textarea, {
      clipboardData: makeClipboardData([makeImageFile("a.png", "image/png")]),
    });
    await waitFor(() => expect(textarea.value).toContain("[Image 1]"));
    fireEvent.paste(textarea, {
      clipboardData: makeClipboardData([makeImageFile("b.png", "image/png")]),
    });
    await waitFor(() => expect(textarea.value).toContain("[Image 2]"));

    fireEvent.change(textarea, {
      target: { value: "- task A [Image 1]\n- task B [Image 2]" },
    });
    fireEvent.click(screen.getByText("Add to Ungroomed"));

    await waitFor(() => {
      const c = mockInvoke.mock.calls.find((c) => c[0] === "append_ungroomed_tasks");
      expect(c).toBeDefined();
    });

    const appendCall = mockInvoke.mock.calls.find((c) => c[0] === "append_ungroomed_tasks")!;
    const tasks = (appendCall[1] as { tasks: { description: string; attachments: { label: string }[] }[] }).tasks;
    expect(tasks).toHaveLength(2);
    expect(tasks[0].description).toBe("task A [Image 1]");
    expect(tasks[0].attachments.map((a) => a.label)).toEqual(["Image 1"]);
    expect(tasks[1].description).toBe("task B [Image 2]");
    expect(tasks[1].attachments.map((a) => a.label)).toEqual(["Image 2"]);
  });

  it("ignores literal [Image 99] tokens that were never staged from a paste", async () => {
    render(<ProjectSummaryPanel {...defaultProps} />);
    await waitFor(() => {
      expect(screen.getByText("Add to Ungroomed")).toBeTruthy();
    });
    const textarea = screen.getByPlaceholderText(/Add tasks \(one per line/) as HTMLTextAreaElement;

    fireEvent.change(textarea, { target: { value: "fake [Image 99]" } });
    fireEvent.click(screen.getByText("Add to Ungroomed"));

    await waitFor(() => {
      const c = mockInvoke.mock.calls.find((c) => c[0] === "append_ungroomed_tasks");
      expect(c).toBeDefined();
    });

    // No save_attachment_image should have fired because the label is unstaged.
    const saveCalls = mockInvoke.mock.calls.filter((c) => c[0] === "save_attachment_image");
    expect(saveCalls).toHaveLength(0);

    const appendCall = mockInvoke.mock.calls.find((c) => c[0] === "append_ungroomed_tasks")!;
    const tasks = (appendCall[1] as { tasks: { description: string; attachments: unknown[] }[] }).tasks;
    expect(tasks[0].description).toBe("fake [Image 99]");
    expect(tasks[0].attachments).toEqual([]);
  });

  it("calls only append_ungroomed_tasks (no save_attachment_image) when there are no attachments", async () => {
    render(<ProjectSummaryPanel {...defaultProps} />);
    await waitFor(() => {
      expect(screen.getByText("Add to Ungroomed")).toBeTruthy();
    });
    const textarea = screen.getByPlaceholderText(/Add tasks \(one per line/);
    fireEvent.change(textarea, { target: { value: "plain task" } });
    fireEvent.click(screen.getByText("Add to Ungroomed"));

    await waitFor(() => {
      const c = mockInvoke.mock.calls.find((c) => c[0] === "append_ungroomed_tasks");
      expect(c).toBeDefined();
    });

    const saveCalls = mockInvoke.mock.calls.filter((c) => c[0] === "save_attachment_image");
    expect(saveCalls).toHaveLength(0);
  });

  it("resets the counter to 1 and clears the imageMap after a successful submit", async () => {
    render(<ProjectSummaryPanel {...defaultProps} />);
    await waitFor(() => {
      expect(screen.getByText("Add to Ungroomed")).toBeTruthy();
    });
    const textarea = screen.getByPlaceholderText(/Add tasks \(one per line/) as HTMLTextAreaElement;

    fireEvent.paste(textarea, {
      clipboardData: makeClipboardData([makeImageFile("a.png", "image/png")]),
    });
    await waitFor(() => expect(textarea.value).toContain("[Image 1]"));

    fireEvent.change(textarea, { target: { value: "first [Image 1]" } });
    fireEvent.click(screen.getByText("Add to Ungroomed"));

    // Wait for clear.
    await waitFor(() => expect(textarea.value).toBe(""));

    // Paste again — counter should restart at 1.
    fireEvent.paste(textarea, {
      clipboardData: makeClipboardData([makeImageFile("b.png", "image/png")]),
    });
    await waitFor(() => expect(textarea.value).toContain("[Image 1]"));
    expect(textarea.value).not.toContain("[Image 2]");
  });
});

describe("ProjectSummaryPanel: state reset on project switch", () => {
  beforeEach(() => {
    resetTauriMocks();
    vi.restoreAllMocks();
    setupAttachmentInvokeMock();
    vi.spyOn(Math, "random").mockReturnValue(0.5);
  });

  it("resets counter to 1 when projectPath prop changes", async () => {
    const { rerender } = render(
      <ProjectSummaryPanel {...defaultProps} projectPath="/project/alpha" />,
    );
    await waitFor(() => {
      expect(screen.getByText("Add to Ungroomed")).toBeTruthy();
    });
    const textarea = screen.getByPlaceholderText(/Add tasks \(one per line/) as HTMLTextAreaElement;

    fireEvent.paste(textarea, {
      clipboardData: makeClipboardData([makeImageFile("a.png", "image/png")]),
    });
    await waitFor(() => expect(textarea.value).toContain("[Image 1]"));

    rerender(<ProjectSummaryPanel {...defaultProps} projectPath="/project/beta" />);
    await waitFor(() => {
      // After project switch, the panel re-loads and the textarea reappears.
      expect(screen.getByText("Add to Ungroomed")).toBeTruthy();
    });

    const newTextarea = screen.getByPlaceholderText(
      /Add tasks \(one per line/,
    ) as HTMLTextAreaElement;
    // Local state was cleared by the project-switch effect.
    expect(newTextarea.value).toBe("");

    fireEvent.paste(newTextarea, {
      clipboardData: makeClipboardData([makeImageFile("c.png", "image/png")]),
    });
    await waitFor(() => expect(newTextarea.value).toContain("[Image 1]"));
    // If the counter had leaked, this would be `[Image 2]`.
    expect(newTextarea.value).not.toContain("[Image 2]");
  });

  it("clears the paste-error timeout on unmount (no leak)", async () => {
    const { unmount } = render(<ProjectSummaryPanel {...defaultProps} />);
    await waitFor(() => {
      expect(screen.getByText("Add to Ungroomed")).toBeTruthy();
    });
    const textarea = screen.getByPlaceholderText(/Add tasks \(one per line/) as HTMLTextAreaElement;

    // Spy on global clearTimeout to confirm the cleanup effect fires it on unmount.
    const clearSpy = vi.spyOn(globalThis, "clearTimeout");

    // Trigger a paste error so the timeout is registered.
    fireEvent.paste(textarea, {
      clipboardData: makeClipboardData([makeImageFile("p.heic", "image/heic")]),
    });
    await waitFor(() => {
      expect(screen.queryByRole("alert")).not.toBeNull();
    });

    const callsBeforeUnmount = clearSpy.mock.calls.length;
    unmount();
    // The unmount cleanup effect should have invoked clearTimeout at least once.
    expect(clearSpy.mock.calls.length).toBeGreaterThan(callsBeforeUnmount);
  });
});
