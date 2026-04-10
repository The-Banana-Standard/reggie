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

    expect(screen.getByPlaceholderText("Add tasks (one per line, or use - / * / 1. for lists)")).toBeTruthy();
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

    const textarea = screen.getByPlaceholderText("Add tasks (one per line, or use - / * / 1. for lists)");
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

    const textarea = screen.getByPlaceholderText("Add tasks (one per line, or use - / * / 1. for lists)");
    fireEvent.change(textarea, { target: { value: "- task one\n- task two" } });

    const button = screen.getByText("Add to Ungroomed");
    fireEvent.click(button);

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("append_ungroomed_tasks", {
        projectPath: "/test/project",
        tasks: ["task one", "task two"],
      });
    });
  });

  it("clears textarea after successful submit", async () => {
    setupInvokeMock();
    render(<ProjectSummaryPanel {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText("Add to Ungroomed")).toBeTruthy();
    });

    const textarea = screen.getByPlaceholderText("Add tasks (one per line, or use - / * / 1. for lists)") as HTMLTextAreaElement;
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

    const textarea = screen.getByPlaceholderText("Add tasks (one per line, or use - / * / 1. for lists)");
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

    const textarea = screen.getByPlaceholderText("Add tasks (one per line, or use - / * / 1. for lists)");
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

    const textarea = screen.getByPlaceholderText("Add tasks (one per line, or use - / * / 1. for lists)");
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

    const textarea = screen.getByPlaceholderText("Add tasks (one per line, or use - / * / 1. for lists)") as HTMLTextAreaElement;
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

    const textarea = screen.getByPlaceholderText("Add tasks (one per line, or use - / * / 1. for lists)") as HTMLTextAreaElement;
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

    const textarea = screen.getByPlaceholderText("Add tasks (one per line, or use - / * / 1. for lists)");
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

    const textarea = screen.getByPlaceholderText("Add tasks (one per line, or use - / * / 1. for lists)");
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

    const textarea = screen.getByPlaceholderText("Add tasks (one per line, or use - / * / 1. for lists)");
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
      "Add tasks (one per line, or use - / * / 1. for lists)"
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
      "Add tasks (one per line, or use - / * / 1. for lists)"
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
      "Add tasks (one per line, or use - / * / 1. for lists)"
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
      scriptPath: "/test/.forge/run.sh",
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
      scriptPath: "/test/.forge/run.sh",
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
