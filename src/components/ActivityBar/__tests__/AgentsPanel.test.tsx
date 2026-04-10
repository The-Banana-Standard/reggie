import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { mockInvoke, resetTauriMocks } from "../../../__test-utils__/tauri-mock";
import { AgentsPanel } from "../AgentsPanel";
import type { AgentInfo } from "../../../types/reggie";

const mockAgents: AgentInfo[] = [
  {
    name: "code-reviewer",
    description: "Reviews code for bugs and edge cases",
    model: "opus",
    tools: ["Glob", "Grep", "Read"],
    memory: "project",
    filePath: "/Users/test/.claude/agents/code-reviewer.md",
    isPipelineManager: false,
  },
  {
    name: "researcher",
    description: "Investigates topics and gathers evidence",
    model: "sonnet",
    tools: ["WebSearch", "Read"],
    memory: null,
    filePath: "/Users/test/.claude/agents/researcher.md",
    isPipelineManager: false,
  },
];

const mockHaikuAgent: AgentInfo = {
  name: "build-pipeline",
  description: "Manages the CI/CD build pipeline stages",
  model: "haiku",
  tools: ["Bash", "Read"],
  memory: null,
  filePath: "/Users/test/.claude/agents/build-pipeline.md",
  isPipelineManager: false,
};

const defaultProps = {
  onEditAgent: vi.fn(),
};

beforeEach(() => {
  resetTauriMocks();
  defaultProps.onEditAgent.mockClear();
});

describe("AgentsPanel", () => {
  it("renders loading state initially", () => {
    // Never resolve the invoke so the component stays in loading state
    mockInvoke.mockReturnValue(new Promise(() => {}));
    render(<AgentsPanel {...defaultProps} />);
    expect(screen.getByText("Loading agents...")).toBeTruthy();
  });

  it("renders agents after loading", async () => {
    mockInvoke.mockResolvedValue(mockAgents);
    render(<AgentsPanel {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText("Code Reviewer")).toBeTruthy();
    });
    expect(screen.getByText("Researcher")).toBeTruthy();
    // Shows the agent count in the title
    expect(screen.getByText("Agents (2)")).toBeTruthy();
  });

  it("renders empty state when no agents returned", async () => {
    mockInvoke.mockResolvedValue([]);
    render(<AgentsPanel {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText("Install Reggie to see agents")).toBeTruthy();
    });
  });

  it("filters agents by name via search input", async () => {
    mockInvoke.mockResolvedValue(mockAgents);
    render(<AgentsPanel {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText("Code Reviewer")).toBeTruthy();
    });

    const input = screen.getByPlaceholderText("Filter agents...");
    fireEvent.change(input, { target: { value: "code" } });

    expect(screen.getByText("Code Reviewer")).toBeTruthy();
    expect(screen.queryByText("Researcher")).toBeNull();
  });

  it("filters agents by description", async () => {
    mockInvoke.mockResolvedValue(mockAgents);
    render(<AgentsPanel {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText("Researcher")).toBeTruthy();
    });

    const input = screen.getByPlaceholderText("Filter agents...");
    fireEvent.change(input, { target: { value: "investigates" } });

    expect(screen.getByText("Researcher")).toBeTruthy();
    expect(screen.queryByText("Code Reviewer")).toBeNull();
  });

  it("shows 'No agents found' when filter matches nothing", async () => {
    mockInvoke.mockResolvedValue(mockAgents);
    render(<AgentsPanel {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText("Code Reviewer")).toBeTruthy();
    });

    const input = screen.getByPlaceholderText("Filter agents...");
    fireEvent.change(input, { target: { value: "zzzznonexistent" } });

    expect(screen.getByText("No agents found")).toBeTruthy();
  });

  it("shows model badge with correct CSS class for opus", async () => {
    mockInvoke.mockResolvedValue([mockAgents[0]]);
    const { container } = render(<AgentsPanel {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText("Code Reviewer")).toBeTruthy();
    });

    const badge = container.querySelector(".agent-model-badge.opus");
    expect(badge).toBeTruthy();
    expect(badge!.textContent).toBe("opus");
  });

  it("shows model badge with correct CSS class for sonnet", async () => {
    mockInvoke.mockResolvedValue([mockAgents[1]]);
    const { container } = render(<AgentsPanel {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText("Researcher")).toBeTruthy();
    });

    const badge = container.querySelector(".agent-model-badge.sonnet");
    expect(badge).toBeTruthy();
    expect(badge!.textContent).toBe("sonnet");
  });

  it("shows model badge with correct CSS class for haiku", async () => {
    mockInvoke.mockResolvedValue([mockHaikuAgent]);
    const { container } = render(<AgentsPanel {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText("Build Pipeline")).toBeTruthy();
    });

    const badge = container.querySelector(".agent-model-badge.haiku");
    expect(badge).toBeTruthy();
    expect(badge!.textContent).toBe("haiku");
  });

  it("expands description on card click", async () => {
    mockInvoke.mockResolvedValue([mockAgents[0]]);
    const { container } = render(<AgentsPanel {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText("Code Reviewer")).toBeTruthy();
    });

    // Before click: description element should not have "expanded" class
    const descBefore = container.querySelector(".agent-desc");
    expect(descBefore?.className).toBe("agent-desc");

    // Click the card to expand
    const card = container.querySelector(".agent-card")!;
    fireEvent.click(card);

    // After click: description element should have "expanded" class
    const descAfter = container.querySelector(".agent-desc.expanded");
    expect(descAfter).toBeTruthy();
  });

  it("shows tool pills when card is expanded", async () => {
    mockInvoke.mockResolvedValue([mockAgents[0]]);
    const { container } = render(<AgentsPanel {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText("Code Reviewer")).toBeTruthy();
    });

    // Before expand: no tool pills visible
    expect(screen.queryByText("Glob")).toBeNull();
    expect(screen.queryByText("Grep")).toBeNull();

    // Click to expand
    const card = container.querySelector(".agent-card")!;
    fireEvent.click(card);

    // After expand: tool pills visible
    expect(screen.getByText("Glob")).toBeTruthy();
    expect(screen.getByText("Grep")).toBeTruthy();
    expect(screen.getByText("Read")).toBeTruthy();
  });

  it("collapses description on second card click", async () => {
    mockInvoke.mockResolvedValue([mockAgents[0]]);
    const { container } = render(<AgentsPanel {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText("Code Reviewer")).toBeTruthy();
    });

    const card = container.querySelector(".agent-card")!;

    // Click to expand
    fireEvent.click(card);
    expect(container.querySelector(".agent-desc.expanded")).toBeTruthy();

    // Click again to collapse
    fireEvent.click(card);
    expect(container.querySelector(".agent-desc.expanded")).toBeNull();
  });

  it("calls onEditAgent with correct filePath when edit button clicked", async () => {
    mockInvoke.mockResolvedValue([mockAgents[0]]);
    const { container } = render(<AgentsPanel {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText("Code Reviewer")).toBeTruthy();
    });

    const editBtn = container.querySelector(".agent-edit-btn")!;
    fireEvent.click(editBtn);

    expect(defaultProps.onEditAgent).toHaveBeenCalledTimes(1);
    expect(defaultProps.onEditAgent).toHaveBeenCalledWith(
      "/Users/test/.claude/agents/code-reviewer.md"
    );
  });

  it("edit button click does not toggle card expansion", async () => {
    mockInvoke.mockResolvedValue([mockAgents[0]]);
    const { container } = render(<AgentsPanel {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText("Code Reviewer")).toBeTruthy();
    });

    // Click edit button (should not expand the card due to stopPropagation)
    const editBtn = container.querySelector(".agent-edit-btn")!;
    fireEvent.click(editBtn);

    expect(container.querySelector(".agent-desc.expanded")).toBeNull();
  });

  it("handles invoke error gracefully by showing empty state", async () => {
    mockInvoke.mockRejectedValue(new Error("Failed to read agents"));
    render(<AgentsPanel {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText("Install Reggie to see agents")).toBeTruthy();
    });
  });

  it("does not show model badge when agent has no model", async () => {
    const agentNoModel: AgentInfo = {
      name: "simple-agent",
      description: "Agent without a model",
      model: null,
      tools: [],
      memory: null,
      filePath: "/Users/test/.claude/agents/simple-agent.md",
      isPipelineManager: false,
    };
    mockInvoke.mockResolvedValue([agentNoModel]);
    const { container } = render(<AgentsPanel {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText("Simple Agent")).toBeTruthy();
    });

    const badge = container.querySelector(".agent-model-badge");
    expect(badge).toBeNull();
  });

  it("does not show tool pills when agent has empty tools array and is expanded", async () => {
    const agentNoTools: AgentInfo = {
      name: "minimal-agent",
      description: "Agent with no tools",
      model: "sonnet",
      tools: [],
      memory: null,
      filePath: "/Users/test/.claude/agents/minimal-agent.md",
      isPipelineManager: false,
    };
    mockInvoke.mockResolvedValue([agentNoTools]);
    const { container } = render(<AgentsPanel {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText("Minimal Agent")).toBeTruthy();
    });

    // Expand the card
    const card = container.querySelector(".agent-card")!;
    fireEvent.click(card);

    // No tool pills container should appear
    const toolsDiv = container.querySelector(".agent-tools");
    expect(toolsDiv).toBeNull();
  });

  it("formats multi-word hyphenated agent names correctly", async () => {
    const agentWithLongName: AgentInfo = {
      name: "senior-code-reviewer",
      description: "A senior level code reviewer",
      model: "opus",
      tools: [],
      memory: null,
      filePath: "/Users/test/.claude/agents/senior-code-reviewer.md",
      isPipelineManager: false,
    };
    mockInvoke.mockResolvedValue([agentWithLongName]);
    render(<AgentsPanel {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText("Senior Code Reviewer")).toBeTruthy();
    });
  });

  it("invokes get_agents command on mount", async () => {
    mockInvoke.mockResolvedValue([]);
    render(<AgentsPanel {...defaultProps} />);

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("get_agents");
    });
  });

  it("filter is case-insensitive", async () => {
    mockInvoke.mockResolvedValue(mockAgents);
    render(<AgentsPanel {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText("Code Reviewer")).toBeTruthy();
    });

    const input = screen.getByPlaceholderText("Filter agents...");
    fireEvent.change(input, { target: { value: "CODE" } });

    expect(screen.getByText("Code Reviewer")).toBeTruthy();
    expect(screen.queryByText("Researcher")).toBeNull();
  });

  it("clearing filter shows all agents again", async () => {
    mockInvoke.mockResolvedValue(mockAgents);
    render(<AgentsPanel {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText("Code Reviewer")).toBeTruthy();
    });

    const input = screen.getByPlaceholderText("Filter agents...");

    // Filter to show only one
    fireEvent.change(input, { target: { value: "code" } });
    expect(screen.queryByText("Researcher")).toBeNull();

    // Clear filter
    fireEvent.change(input, { target: { value: "" } });
    expect(screen.getByText("Code Reviewer")).toBeTruthy();
    expect(screen.getByText("Researcher")).toBeTruthy();
  });

  it("shows agent count in title based on total agents, not filtered count", async () => {
    mockInvoke.mockResolvedValue(mockAgents);
    render(<AgentsPanel {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText("Agents (2)")).toBeTruthy();
    });

    // Filter down to 1 agent -- title should still show total count
    const input = screen.getByPlaceholderText("Filter agents...");
    fireEvent.change(input, { target: { value: "code" } });

    expect(screen.getByText("Agents (2)")).toBeTruthy();
  });

  it("expanding one card does not affect other cards", async () => {
    mockInvoke.mockResolvedValue(mockAgents);
    const { container } = render(<AgentsPanel {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText("Code Reviewer")).toBeTruthy();
    });

    const cards = container.querySelectorAll(".agent-card");
    expect(cards.length).toBe(2);

    // Expand first card only
    fireEvent.click(cards[0]);

    const expandedDescs = container.querySelectorAll(".agent-desc.expanded");
    expect(expandedDescs.length).toBe(1);
  });

  it("shows description text in collapsed state", async () => {
    mockInvoke.mockResolvedValue([mockAgents[0]]);
    render(<AgentsPanel {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText("Code Reviewer")).toBeTruthy();
    });

    // Description should be rendered even when collapsed
    expect(
      screen.getByText("Reviews code for bugs and edge cases")
    ).toBeTruthy();
  });

  it("does not call onEditAgent when card body is clicked", async () => {
    mockInvoke.mockResolvedValue([mockAgents[0]]);
    const { container } = render(<AgentsPanel {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText("Code Reviewer")).toBeTruthy();
    });

    // Click the card (not the edit button)
    const card = container.querySelector(".agent-card")!;
    fireEvent.click(card);

    expect(defaultProps.onEditAgent).not.toHaveBeenCalled();
  });
});
