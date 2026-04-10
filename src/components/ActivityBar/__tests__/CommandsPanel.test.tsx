import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { mockInvoke, resetTauriMocks } from "../../../__test-utils__/tauri-mock";
import { CommandsPanel } from "../CommandsPanel";
import type { CommandInfo } from "../../../types/reggie";

const mockCommands: CommandInfo[] = [
  {
    name: "init-tasks",
    description: "Initialize tasks for a project",
    commandType: "utility",
    source: "global",
    filePath: "/Users/test/.claude/commands/init-tasks.md",
  },
  {
    name: "code-workflow",
    description: "Run the code workflow pipeline stage",
    commandType: "stage",
    source: "global",
    filePath: "/Users/test/.claude/commands/code-workflow.md",
  },
];

const mockCommandNoDescription: CommandInfo = {
  name: "quick-fix",
  description: "",
  commandType: "utility",
  source: "global",
  filePath: "/Users/test/.claude/commands/quick-fix.md",
};

const defaultProps = {
  projectPath: null,
  onExecuteCommand: vi.fn(),
  onEditCommand: vi.fn(),
};

beforeEach(() => {
  resetTauriMocks();
  defaultProps.onExecuteCommand.mockClear();
  defaultProps.onEditCommand.mockClear();
});

describe("CommandsPanel", () => {
  it("renders loading state initially", () => {
    mockInvoke.mockReturnValue(new Promise(() => {}));
    render(<CommandsPanel {...defaultProps} />);
    expect(screen.getByText("Loading commands...")).toBeTruthy();
  });

  it("renders empty state when no commands found", async () => {
    mockInvoke.mockResolvedValue([]);
    render(<CommandsPanel {...defaultProps} />);

    await waitFor(() => {
      expect(
        screen.getByText("No commands found in ~/.claude/commands/")
      ).toBeTruthy();
    });
  });

  it("renders commands list with formatted names after loading", async () => {
    mockInvoke.mockResolvedValue(mockCommands);
    render(<CommandsPanel {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText("Init Tasks")).toBeTruthy();
    });
    expect(screen.getByText("Code Workflow")).toBeTruthy();
  });

  it("displays command count in title", async () => {
    mockInvoke.mockResolvedValue(mockCommands);
    render(<CommandsPanel {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText("Commands (2)")).toBeTruthy();
    });
  });

  it("shows command count based on total, not filtered count", async () => {
    mockInvoke.mockResolvedValue(mockCommands);
    render(<CommandsPanel {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText("Commands (2)")).toBeTruthy();
    });

    const input = screen.getByPlaceholderText("Filter commands...");
    fireEvent.change(input, { target: { value: "init" } });

    // Title still shows total count
    expect(screen.getByText("Commands (2)")).toBeTruthy();
  });

  it("filters commands by name", async () => {
    mockInvoke.mockResolvedValue(mockCommands);
    render(<CommandsPanel {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText("Init Tasks")).toBeTruthy();
    });

    const input = screen.getByPlaceholderText("Filter commands...");
    fireEvent.change(input, { target: { value: "init" } });

    expect(screen.getByText("Init Tasks")).toBeTruthy();
    expect(screen.queryByText("Code Workflow")).toBeNull();
  });

  it("filters commands by description", async () => {
    mockInvoke.mockResolvedValue(mockCommands);
    render(<CommandsPanel {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText("Code Workflow")).toBeTruthy();
    });

    const input = screen.getByPlaceholderText("Filter commands...");
    fireEvent.change(input, { target: { value: "pipeline" } });

    expect(screen.getByText("Code Workflow")).toBeTruthy();
    expect(screen.queryByText("Init Tasks")).toBeNull();
  });

  it("filter is case-insensitive", async () => {
    mockInvoke.mockResolvedValue(mockCommands);
    render(<CommandsPanel {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText("Init Tasks")).toBeTruthy();
    });

    const input = screen.getByPlaceholderText("Filter commands...");
    fireEvent.change(input, { target: { value: "INIT" } });

    expect(screen.getByText("Init Tasks")).toBeTruthy();
    expect(screen.queryByText("Code Workflow")).toBeNull();
  });

  it("clearing filter shows all commands again", async () => {
    mockInvoke.mockResolvedValue(mockCommands);
    render(<CommandsPanel {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText("Init Tasks")).toBeTruthy();
    });

    const input = screen.getByPlaceholderText("Filter commands...");

    // Filter to show only one
    fireEvent.change(input, { target: { value: "init" } });
    expect(screen.queryByText("Code Workflow")).toBeNull();

    // Clear filter
    fireEvent.change(input, { target: { value: "" } });
    expect(screen.getByText("Init Tasks")).toBeTruthy();
    expect(screen.getByText("Code Workflow")).toBeTruthy();
  });

  it("shows 'No commands found' when filter matches nothing", async () => {
    mockInvoke.mockResolvedValue(mockCommands);
    render(<CommandsPanel {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText("Init Tasks")).toBeTruthy();
    });

    const input = screen.getByPlaceholderText("Filter commands...");
    fireEvent.change(input, { target: { value: "zzzznonexistent" } });

    expect(screen.getByText("No commands found")).toBeTruthy();
  });

  it("renders utility type badge with correct CSS class", async () => {
    mockInvoke.mockResolvedValue([mockCommands[0]]);
    const { container } = render(<CommandsPanel {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText("Init Tasks")).toBeTruthy();
    });

    const badge = container.querySelector(".command-type-badge.utility");
    expect(badge).toBeTruthy();
    expect(badge!.textContent).toBe("utility");
  });

  it("renders stage type badge with correct CSS class", async () => {
    mockInvoke.mockResolvedValue([mockCommands[1]]);
    const { container } = render(<CommandsPanel {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText("Code Workflow")).toBeTruthy();
    });

    const badge = container.querySelector(".command-type-badge.stage");
    expect(badge).toBeTruthy();
    expect(badge!.textContent).toBe("stage");
  });

  it("calls onExecuteCommand with command name when execute button clicked", async () => {
    mockInvoke.mockResolvedValue([mockCommands[0]]);
    render(<CommandsPanel {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText("Init Tasks")).toBeTruthy();
    });

    const executeBtn = screen.getByLabelText("Execute init-tasks command");
    fireEvent.click(executeBtn);

    expect(defaultProps.onExecuteCommand).toHaveBeenCalledTimes(1);
    expect(defaultProps.onExecuteCommand).toHaveBeenCalledWith("init-tasks");
  });

  it("calls onEditCommand with file path when edit button clicked", async () => {
    mockInvoke.mockResolvedValue([mockCommands[0]]);
    render(<CommandsPanel {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText("Init Tasks")).toBeTruthy();
    });

    const editBtn = screen.getByLabelText("Edit init-tasks command file");
    fireEvent.click(editBtn);

    expect(defaultProps.onEditCommand).toHaveBeenCalledTimes(1);
    expect(defaultProps.onEditCommand).toHaveBeenCalledWith(
      "/Users/test/.claude/commands/init-tasks.md"
    );
  });

  it("execute button click only calls onExecuteCommand, not onEditCommand", async () => {
    mockInvoke.mockResolvedValue([mockCommands[0]]);
    render(<CommandsPanel {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText("Init Tasks")).toBeTruthy();
    });

    const executeBtn = screen.getByLabelText("Execute init-tasks command");
    fireEvent.click(executeBtn);

    expect(defaultProps.onExecuteCommand).toHaveBeenCalledTimes(1);
    expect(defaultProps.onEditCommand).not.toHaveBeenCalled();
  });

  it("edit button click only calls onEditCommand, not onExecuteCommand", async () => {
    mockInvoke.mockResolvedValue([mockCommands[0]]);
    render(<CommandsPanel {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText("Init Tasks")).toBeTruthy();
    });

    const editBtn = screen.getByLabelText("Edit init-tasks command file");
    fireEvent.click(editBtn);

    expect(defaultProps.onEditCommand).toHaveBeenCalledTimes(1);
    expect(defaultProps.onExecuteCommand).not.toHaveBeenCalled();
  });

  it("handles invoke error gracefully by showing empty state", async () => {
    mockInvoke.mockRejectedValue(new Error("Failed to read commands"));
    render(<CommandsPanel {...defaultProps} />);

    await waitFor(() => {
      expect(
        screen.getByText("No commands found in ~/.claude/commands/")
      ).toBeTruthy();
    });
  });

  it("does not render description when command has empty description", async () => {
    mockInvoke.mockResolvedValue([mockCommandNoDescription]);
    const { container } = render(<CommandsPanel {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText("Quick Fix")).toBeTruthy();
    });

    const descElement = container.querySelector(".command-desc");
    expect(descElement).toBeNull();
  });

  it("formats kebab-case names to Title Case", async () => {
    const multiWordCommand: CommandInfo = {
      name: "run-full-test-suite",
      description: "Run all tests",
      commandType: "utility",
      source: "global",
      filePath: "/Users/test/.claude/commands/run-full-test-suite.md",
    };
    mockInvoke.mockResolvedValue([multiWordCommand]);
    render(<CommandsPanel {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText("Run Full Test Suite")).toBeTruthy();
    });
  });

  it("invokes get_commands on mount with projectPath", async () => {
    mockInvoke.mockResolvedValue([]);
    render(<CommandsPanel {...defaultProps} />);

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("get_commands", { projectPath: null });
    });
  });

  it("renders descriptions for commands that have them", async () => {
    mockInvoke.mockResolvedValue([mockCommands[0]]);
    render(<CommandsPanel {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText("Init Tasks")).toBeTruthy();
    });

    expect(
      screen.getByText("Initialize tasks for a project")
    ).toBeTruthy();
  });

  it("renders both execute and edit buttons for each command", async () => {
    mockInvoke.mockResolvedValue(mockCommands);
    render(<CommandsPanel {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText("Init Tasks")).toBeTruthy();
    });

    // Each command should have both buttons
    expect(screen.getByLabelText("Execute init-tasks command")).toBeTruthy();
    expect(screen.getByLabelText("Edit init-tasks command file")).toBeTruthy();
    expect(screen.getByLabelText("Execute code-workflow command")).toBeTruthy();
    expect(screen.getByLabelText("Edit code-workflow command file")).toBeTruthy();
  });

  it("treats unknown command type as utility badge class", async () => {
    const unknownTypeCommand: CommandInfo = {
      name: "custom-cmd",
      description: "A custom command",
      commandType: "custom",
      source: "global",
      filePath: "/Users/test/.claude/commands/custom-cmd.md",
    };
    mockInvoke.mockResolvedValue([unknownTypeCommand]);
    const { container } = render(<CommandsPanel {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText("Custom Cmd")).toBeTruthy();
    });

    const badge = container.querySelector(".command-type-badge.utility");
    expect(badge).toBeTruthy();
    expect(badge!.textContent).toBe("custom");
  });

  // ── Source grouping tests ──

  it("shows Project group when project-source commands exist", async () => {
    const mixedCommands: CommandInfo[] = [
      {
        name: "proj-lint",
        description: "Lint this project",
        commandType: "utility",
        source: "project",
        filePath: "/tmp/proj/.claude/commands/proj-lint.md",
      },
      ...mockCommands,
    ];
    mockInvoke.mockResolvedValue(mixedCommands);
    render(<CommandsPanel {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText("Proj Lint")).toBeTruthy();
    });

    expect(screen.getByText("Project")).toBeTruthy();
    expect(screen.getByText("Global")).toBeTruthy();
  });

  it("hides Project group when no project-source commands exist", async () => {
    mockInvoke.mockResolvedValue(mockCommands);
    render(<CommandsPanel {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText("Init Tasks")).toBeTruthy();
    });

    expect(screen.queryByText("Project")).toBeNull();
    expect(screen.getByText("Global")).toBeTruthy();
  });

  it("displays global command count in the Global group label", async () => {
    mockInvoke.mockResolvedValue(mockCommands);
    render(<CommandsPanel {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText("Init Tasks")).toBeTruthy();
    });

    // The Global group label shows the count of global commands
    expect(screen.getByText("2")).toBeTruthy();
  });

  it("passes projectPath string to invoke when provided", async () => {
    mockInvoke.mockResolvedValue([]);
    render(
      <CommandsPanel
        projectPath="/some/project/path"
        onExecuteCommand={vi.fn()}
        onEditCommand={vi.fn()}
      />
    );

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("get_commands", {
        projectPath: "/some/project/path",
      });
    });
  });

  it("separates project commands into their own group above global", async () => {
    const mixed: CommandInfo[] = [
      {
        name: "alpha-global",
        description: "Global command",
        commandType: "utility",
        source: "global",
        filePath: "/Users/test/.claude/commands/alpha-global.md",
      },
      {
        name: "beta-project",
        description: "Project command",
        commandType: "utility",
        source: "project",
        filePath: "/tmp/proj/.claude/commands/beta-project.md",
      },
    ];
    mockInvoke.mockResolvedValue(mixed);
    const { container } = render(<CommandsPanel {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText("Alpha Global")).toBeTruthy();
    });

    // Both groups rendered
    expect(screen.getByText("Project")).toBeTruthy();
    expect(screen.getByText("Global")).toBeTruthy();

    // Project group appears before Global group in the DOM
    const groupLabels = container.querySelectorAll(".commands-group-label");
    expect(groupLabels.length).toBe(2);
    expect(groupLabels[0].textContent).toContain("Project");
    expect(groupLabels[1].textContent).toContain("Global");
  });

  it("filter applies across both project and global groups", async () => {
    const mixed: CommandInfo[] = [
      {
        name: "lint-project",
        description: "Project linter",
        commandType: "utility",
        source: "project",
        filePath: "/tmp/proj/.claude/commands/lint-project.md",
      },
      {
        name: "lint-global",
        description: "Global linter",
        commandType: "utility",
        source: "global",
        filePath: "/Users/test/.claude/commands/lint-global.md",
      },
      {
        name: "deploy",
        description: "Deploy the app",
        commandType: "utility",
        source: "global",
        filePath: "/Users/test/.claude/commands/deploy.md",
      },
    ];
    mockInvoke.mockResolvedValue(mixed);
    render(<CommandsPanel {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText("Lint Project")).toBeTruthy();
    });

    const input = screen.getByPlaceholderText("Filter commands...");
    fireEvent.change(input, { target: { value: "lint" } });

    // Both lint commands visible
    expect(screen.getByText("Lint Project")).toBeTruthy();
    expect(screen.getByText("Lint Global")).toBeTruthy();
    // Non-matching command hidden
    expect(screen.queryByText("Deploy")).toBeNull();
  });
});
