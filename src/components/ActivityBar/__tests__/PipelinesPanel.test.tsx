import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { mockInvoke, resetTauriMocks } from "../../../__test-utils__/tauri-mock";
import { PipelinesPanel } from "../PipelinesPanel";
import type { PipelineInfo } from "../../../types/reggie";
import { __resetForTests as resetBindings } from "../../../lib/pipelineBindings";

const mockPipelines: PipelineInfo[] = [
  {
    name: "code-workflow",
    description: "Run the full code workflow pipeline",
    commandFilePath: "/Users/test/.claude/commands/code-workflow.md",
    managerName: "pipeline-manager",
    managerFilePath: "/Users/test/.claude/agents/pipeline-manager.md",
  },
  {
    name: "init-tasks",
    description: "Initialize and groom project tasks",
    commandFilePath: "/Users/test/.claude/commands/init-tasks.md",
    managerName: null,
    managerFilePath: null,
  },
];

const mockPipelineNoDescription: PipelineInfo = {
  name: "quick-deploy",
  description: "",
  commandFilePath: "/Users/test/.claude/commands/quick-deploy.md",
  managerName: "deploy-manager",
  managerFilePath: "/Users/test/.claude/agents/deploy-manager.md",
};

const defaultProps = {
  onExecutePipeline: vi.fn(),
  onEditPipeline: vi.fn(),
};

beforeEach(() => {
  resetTauriMocks();
  resetBindings();
  defaultProps.onExecutePipeline.mockClear();
  defaultProps.onEditPipeline.mockClear();
});

describe("PipelinesPanel", () => {
  it("renders loading state initially", () => {
    mockInvoke.mockReturnValue(new Promise(() => {}));
    render(<PipelinesPanel {...defaultProps} />);
    expect(screen.getByText("Loading pipelines...")).toBeTruthy();
  });

  it("renders empty state when no pipelines found", async () => {
    mockInvoke.mockResolvedValue([]);
    render(<PipelinesPanel {...defaultProps} />);

    await waitFor(() => {
      expect(
        screen.getByText("No pipeline commands found in ~/.claude/commands/")
      ).toBeTruthy();
    });
  });

  it("renders pipelines list with formatted names after loading", async () => {
    mockInvoke.mockResolvedValue(mockPipelines);
    render(<PipelinesPanel {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText("Code Workflow")).toBeTruthy();
    });
    expect(screen.getByText("Init Tasks")).toBeTruthy();
  });

  it("displays pipeline count in title", async () => {
    mockInvoke.mockResolvedValue(mockPipelines);
    render(<PipelinesPanel {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText("Pipelines (2)")).toBeTruthy();
    });
  });

  it("shows pipeline count based on total, not filtered count", async () => {
    mockInvoke.mockResolvedValue(mockPipelines);
    render(<PipelinesPanel {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText("Pipelines (2)")).toBeTruthy();
    });

    const input = screen.getByPlaceholderText("Filter pipelines...");
    fireEvent.change(input, { target: { value: "code" } });

    // Title still shows total count
    expect(screen.getByText("Pipelines (2)")).toBeTruthy();
  });

  it("filters pipelines by name", async () => {
    mockInvoke.mockResolvedValue(mockPipelines);
    render(<PipelinesPanel {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText("Code Workflow")).toBeTruthy();
    });

    const input = screen.getByPlaceholderText("Filter pipelines...");
    fireEvent.change(input, { target: { value: "code" } });

    expect(screen.getByText("Code Workflow")).toBeTruthy();
    expect(screen.queryByText("Init Tasks")).toBeNull();
  });

  it("filters pipelines by description", async () => {
    mockInvoke.mockResolvedValue(mockPipelines);
    render(<PipelinesPanel {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText("Code Workflow")).toBeTruthy();
    });

    const input = screen.getByPlaceholderText("Filter pipelines...");
    fireEvent.change(input, { target: { value: "groom" } });

    expect(screen.getByText("Init Tasks")).toBeTruthy();
    expect(screen.queryByText("Code Workflow")).toBeNull();
  });

  it("filter is case-insensitive", async () => {
    mockInvoke.mockResolvedValue(mockPipelines);
    render(<PipelinesPanel {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText("Code Workflow")).toBeTruthy();
    });

    const input = screen.getByPlaceholderText("Filter pipelines...");
    fireEvent.change(input, { target: { value: "CODE" } });

    expect(screen.getByText("Code Workflow")).toBeTruthy();
    expect(screen.queryByText("Init Tasks")).toBeNull();
  });

  it("clearing filter shows all pipelines again", async () => {
    mockInvoke.mockResolvedValue(mockPipelines);
    render(<PipelinesPanel {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText("Code Workflow")).toBeTruthy();
    });

    const input = screen.getByPlaceholderText("Filter pipelines...");

    // Filter to show only one
    fireEvent.change(input, { target: { value: "code" } });
    expect(screen.queryByText("Init Tasks")).toBeNull();

    // Clear filter
    fireEvent.change(input, { target: { value: "" } });
    expect(screen.getByText("Code Workflow")).toBeTruthy();
    expect(screen.getByText("Init Tasks")).toBeTruthy();
  });

  it("shows 'No pipelines found' when filter matches nothing", async () => {
    mockInvoke.mockResolvedValue(mockPipelines);
    render(<PipelinesPanel {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText("Code Workflow")).toBeTruthy();
    });

    const input = screen.getByPlaceholderText("Filter pipelines...");
    fireEvent.change(input, { target: { value: "zzzznonexistent" } });

    expect(screen.getByText("No pipelines found")).toBeTruthy();
  });

  it("calls onExecutePipeline with pipeline name when execute button clicked", async () => {
    mockInvoke.mockResolvedValue([mockPipelines[0]]);
    render(<PipelinesPanel {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText("Code Workflow")).toBeTruthy();
    });

    const executeBtn = screen.getByLabelText("Execute code-workflow pipeline");
    fireEvent.click(executeBtn);

    expect(defaultProps.onExecutePipeline).toHaveBeenCalledTimes(1);
    expect(defaultProps.onExecutePipeline).toHaveBeenCalledWith("code-workflow");
  });

  it("calls onEditPipeline with commandFilePath when edit command button clicked", async () => {
    mockInvoke.mockResolvedValue([mockPipelines[0]]);
    render(<PipelinesPanel {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText("Code Workflow")).toBeTruthy();
    });

    const editBtn = screen.getByLabelText("Edit code-workflow command file");
    fireEvent.click(editBtn);

    expect(defaultProps.onEditPipeline).toHaveBeenCalledTimes(1);
    expect(defaultProps.onEditPipeline).toHaveBeenCalledWith(
      "/Users/test/.claude/commands/code-workflow.md"
    );
  });

  it("calls onEditPipeline with managerFilePath when edit manager button clicked", async () => {
    mockInvoke.mockResolvedValue([mockPipelines[0]]);
    render(<PipelinesPanel {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText("Code Workflow")).toBeTruthy();
    });

    const editManagerBtn = screen.getByLabelText("Edit pipeline-manager agent file");
    fireEvent.click(editManagerBtn);

    expect(defaultProps.onEditPipeline).toHaveBeenCalledTimes(1);
    expect(defaultProps.onEditPipeline).toHaveBeenCalledWith(
      "/Users/test/.claude/agents/pipeline-manager.md"
    );
  });

  it("shows manager row when managerName exists", async () => {
    mockInvoke.mockResolvedValue([mockPipelines[0]]);
    render(<PipelinesPanel {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText("Code Workflow")).toBeTruthy();
    });

    expect(screen.getByText("Manager:")).toBeTruthy();
    expect(screen.getByText("Pipeline Manager")).toBeTruthy();
  });

  it("hides manager row when managerName is null", async () => {
    mockInvoke.mockResolvedValue([mockPipelines[1]]);
    render(<PipelinesPanel {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText("Init Tasks")).toBeTruthy();
    });

    expect(screen.queryByText("Manager:")).toBeNull();
  });

  it("handles invoke error gracefully by showing empty state", async () => {
    mockInvoke.mockRejectedValue(new Error("Failed to read pipelines"));
    render(<PipelinesPanel {...defaultProps} />);

    await waitFor(() => {
      expect(
        screen.getByText("No pipeline commands found in ~/.claude/commands/")
      ).toBeTruthy();
    });
  });

  it("formats kebab-case names to Title Case", async () => {
    const multiWordPipeline: PipelineInfo = {
      name: "run-full-test-suite",
      description: "Runs all tests",
      commandFilePath: "/Users/test/.claude/commands/run-full-test-suite.md",
      managerName: null,
      managerFilePath: null,
    };
    mockInvoke.mockResolvedValue([multiWordPipeline]);
    render(<PipelinesPanel {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText("Run Full Test Suite")).toBeTruthy();
    });
  });

  it("invokes get_pipelines on mount", async () => {
    mockInvoke.mockResolvedValue([]);
    render(<PipelinesPanel {...defaultProps} />);

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("get_pipelines");
    });
  });

  it("does not render description when pipeline has empty description", async () => {
    mockInvoke.mockResolvedValue([mockPipelineNoDescription]);
    const { container } = render(<PipelinesPanel {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText("Quick Deploy")).toBeTruthy();
    });

    const descElement = container.querySelector(".pipeline-desc");
    expect(descElement).toBeNull();
  });

  it("execute button click only calls onExecutePipeline, not onEditPipeline", async () => {
    mockInvoke.mockResolvedValue([mockPipelines[0]]);
    render(<PipelinesPanel {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText("Code Workflow")).toBeTruthy();
    });

    const executeBtn = screen.getByLabelText("Execute code-workflow pipeline");
    fireEvent.click(executeBtn);

    expect(defaultProps.onExecutePipeline).toHaveBeenCalledTimes(1);
    expect(defaultProps.onEditPipeline).not.toHaveBeenCalled();
  });

  it("edit command button click only calls onEditPipeline, not onExecutePipeline", async () => {
    mockInvoke.mockResolvedValue([mockPipelines[0]]);
    render(<PipelinesPanel {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText("Code Workflow")).toBeTruthy();
    });

    const editBtn = screen.getByLabelText("Edit code-workflow command file");
    fireEvent.click(editBtn);

    expect(defaultProps.onEditPipeline).toHaveBeenCalledTimes(1);
    expect(defaultProps.onExecutePipeline).not.toHaveBeenCalled();
  });

  it("renders both execute and edit buttons for each pipeline", async () => {
    mockInvoke.mockResolvedValue(mockPipelines);
    render(<PipelinesPanel {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText("Code Workflow")).toBeTruthy();
    });

    expect(screen.getByLabelText("Execute code-workflow pipeline")).toBeTruthy();
    expect(screen.getByLabelText("Edit code-workflow command file")).toBeTruthy();
    expect(screen.getByLabelText("Execute init-tasks pipeline")).toBeTruthy();
    expect(screen.getByLabelText("Edit init-tasks command file")).toBeTruthy();
  });

  it("renders descriptions for pipelines that have them", async () => {
    mockInvoke.mockResolvedValue([mockPipelines[0]]);
    render(<PipelinesPanel {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText("Code Workflow")).toBeTruthy();
    });

    expect(
      screen.getByText("Run the full code workflow pipeline")
    ).toBeTruthy();
  });

  it("formats manager name from kebab-case to Title Case", async () => {
    mockInvoke.mockResolvedValue([mockPipelines[0]]);
    render(<PipelinesPanel {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText("Code Workflow")).toBeTruthy();
    });

    // managerName is "pipeline-manager", should display as "Pipeline Manager"
    expect(screen.getByText("Pipeline Manager")).toBeTruthy();
  });

  describe("pipeline bindings UI", () => {
    it("renders bind buttons for Code, Debug, and Manual modes (reggie-system is not bindable)", async () => {
      mockInvoke.mockResolvedValue([mockPipelines[0]]);
      render(<PipelinesPanel {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByText("Code Workflow")).toBeTruthy();
      });

      expect(screen.getByLabelText("Bind code-workflow to Code mode")).toBeTruthy();
      expect(screen.getByLabelText("Bind code-workflow to Debug mode")).toBeTruthy();
      expect(screen.getByLabelText("Bind code-workflow to Manual mode")).toBeTruthy();
      // No reggie-system bind option.
      expect(screen.queryByLabelText(/reggie-system mode/i)).toBeNull();
    });

    it("clicking a bind button invokes set_pipeline_binding with the correct mode and pipelineName", async () => {
      mockInvoke.mockImplementation((cmd: string) => {
        if (cmd === "get_pipelines") return Promise.resolve([mockPipelines[0]]);
        if (cmd === "get_pipeline_bindings") return Promise.resolve({ code: "code-workflow" });
        return Promise.resolve(undefined);
      });
      render(<PipelinesPanel {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByText("Code Workflow")).toBeTruthy();
      });

      fireEvent.click(screen.getByLabelText("Bind code-workflow to Debug mode"));

      await waitFor(() => {
        expect(mockInvoke).toHaveBeenCalledWith("set_pipeline_binding", {
          mode: "debug",
          pipelineName: "code-workflow",
        });
      });
    });

    it("clicking a bind button on an already-bound mode invokes clear_pipeline_binding (toggle off)", async () => {
      mockInvoke.mockImplementation((cmd: string) => {
        if (cmd === "get_pipelines") return Promise.resolve([mockPipelines[0]]);
        if (cmd === "get_pipeline_bindings") return Promise.resolve({ code: "code-workflow" });
        if (cmd === "set_pipeline_binding") return Promise.resolve(undefined);
        if (cmd === "clear_pipeline_binding") return Promise.resolve(undefined);
        return Promise.resolve(undefined);
      });
      render(<PipelinesPanel {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByText("Code Workflow")).toBeTruthy();
      });

      // Bind first so the cache has { code: "code-workflow" }.
      fireEvent.click(screen.getByLabelText("Bind code-workflow to Code mode"));
      await waitFor(() => {
        const badge = screen.queryByLabelText("Default for modes");
        expect(badge).toBeTruthy();
        expect(badge?.textContent).toContain("Code");
      });

      // Click again on Code mode → toggle off.
      fireEvent.click(screen.getByLabelText("Bind code-workflow to Code mode"));

      await waitFor(() => {
        expect(mockInvoke).toHaveBeenCalledWith("clear_pipeline_binding", { mode: "code" });
      });
    });

    it("renders a 'Default: <mode>' badge when the pipeline is bound", async () => {
      mockInvoke.mockImplementation((cmd: string) => {
        if (cmd === "get_pipelines") return Promise.resolve([mockPipelines[0]]);
        if (cmd === "get_pipeline_bindings") return Promise.resolve({ code: "code-workflow", debug: "code-workflow" });
        if (cmd === "set_pipeline_binding") return Promise.resolve(undefined);
        return Promise.resolve(undefined);
      });
      render(<PipelinesPanel {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByText("Code Workflow")).toBeTruthy();
      });

      // Bind to populate cache (synthetically — clicking surfaces it via the canonical reload).
      fireEvent.click(screen.getByLabelText("Bind code-workflow to Code mode"));

      await waitFor(() => {
        const badge = screen.getByLabelText("Default for modes");
        expect(badge.textContent).toContain("Code");
        expect(badge.textContent).toContain("Debug");
      });
    });

    it("shows a 'not found, using default' warning when a bound pipeline is missing from the loaded list", async () => {
      // Load pipelines list that does NOT include "ghost-workflow", but the
      // backend reports a binding pointing at it.
      mockInvoke.mockImplementation((cmd: string) => {
        if (cmd === "get_pipelines") return Promise.resolve([mockPipelines[0]]);
        if (cmd === "get_pipeline_bindings") return Promise.resolve({ code: "ghost-workflow" });
        if (cmd === "set_pipeline_binding") return Promise.resolve(undefined);
        return Promise.resolve(undefined);
      });

      render(<PipelinesPanel {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByText("Code Workflow")).toBeTruthy();
      });

      // Trigger a binding refresh by clicking a bind button — this causes the
      // hook to read the (mocked) get_pipeline_bindings result that includes
      // the ghost binding. Use the init-tasks pipeline name to keep things
      // distinct from the ghost.
      fireEvent.click(screen.getByLabelText("Bind code-workflow to Manual mode"));

      // After the refresh, the ghost binding is in the cache.
      await waitFor(() => {
        expect(
          screen.getByText("Bound pipeline 'ghost-workflow' not found, using default"),
        ).toBeTruthy();
      });
    });
  });

  it("shows manager row with edit button but no description when pipeline has no description and has manager", async () => {
    mockInvoke.mockResolvedValue([mockPipelineNoDescription]);
    const { container } = render(<PipelinesPanel {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText("Quick Deploy")).toBeTruthy();
    });

    // No description rendered
    expect(container.querySelector(".pipeline-desc")).toBeNull();

    // Manager row is present
    expect(screen.getByText("Manager:")).toBeTruthy();
    expect(screen.getByText("Deploy Manager")).toBeTruthy();
    expect(screen.getByLabelText("Edit deploy-manager agent file")).toBeTruthy();
  });
});
