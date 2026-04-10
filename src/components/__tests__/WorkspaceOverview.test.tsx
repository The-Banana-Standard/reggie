import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { resetTauriMocks, mockInvoke } from "../../__test-utils__/tauri-mock";
import { WorkspaceOverview } from "../WorkspaceOverview/WorkspaceOverview";

// Mock ResizeObserver since jsdom doesn't provide it
let resizeObserverInstances: { callback: ResizeObserverCallback; targets: Element[]; disconnected: boolean }[] = [];

class MockResizeObserver {
  private callback: ResizeObserverCallback;
  private targets: Element[] = [];
  private instance: { callback: ResizeObserverCallback; targets: Element[]; disconnected: boolean };

  constructor(callback: ResizeObserverCallback) {
    this.callback = callback;
    this.targets = [];
    this.instance = { callback, targets: this.targets, disconnected: false };
    resizeObserverInstances.push(this.instance);
  }

  observe(target: Element) {
    this.targets.push(target);
  }

  unobserve(_target: Element) {
    // no-op for tests
  }

  disconnect() {
    this.instance.disconnected = true;
    this.targets.length = 0;
  }
}

vi.stubGlobal("ResizeObserver", MockResizeObserver);

beforeEach(() => {
  resetTauriMocks();
  resizeObserverInstances = [];
  // Mock invoke for get_project_info and get_claude_usage_stats
  mockInvoke.mockResolvedValue(null);
});

const defaultProps = {
  projects: [],
  allProjectsFolder: null,
  activeLevel: null,
  notes: "",
  onNotesChange: vi.fn(),
  textareaHeight: null,
  onTextareaHeightChange: vi.fn(),
  onStartWorkflow: vi.fn(),
  onRunSkill: vi.fn(),
  headlessSessions: [],
  sessions: [],
  onLaunchHeadless: vi.fn().mockResolvedValue(null),
  onSpawnVisibleHeadless: vi.fn().mockResolvedValue(null),
  onPromoteHeadless: vi.fn().mockReturnValue(null),
  onPromoteSession: vi.fn(),
  onRemoveHeadless: vi.fn(),
  onKillSession: vi.fn(),
  onTrashCompleted: vi.fn(),
  onTrashSession: vi.fn(),
};

describe("WorkspaceOverview", () => {
  it("renders Setup Docs button", () => {
    render(<WorkspaceOverview {...defaultProps} />);

    expect(screen.getByText("Setup Docs")).toBeTruthy();
  });

  it("calls onRunSkill with reggie-setup-workspace-docs when Setup Docs is clicked", () => {
    const onRunSkill = vi.fn();
    render(<WorkspaceOverview {...defaultProps} onRunSkill={onRunSkill} />);

    fireEvent.click(screen.getByText("Setup Docs"));

    expect(onRunSkill).toHaveBeenCalledWith("reggie-setup-workspace-docs");
  });

  it("does not render Workspace Agent button (removed feature)", () => {
    render(<WorkspaceOverview {...defaultProps} />);

    expect(screen.queryByText("Workspace Agent")).toBeNull();
  });

  it("does not render GitHub & Skills button (removed feature)", () => {
    render(<WorkspaceOverview {...defaultProps} />);

    expect(screen.queryByText("GitHub & Skills")).toBeNull();
  });

  it("renders only Setup Docs as hero action button", () => {
    const { container } = render(<WorkspaceOverview {...defaultProps} />);

    const heroActions = container.querySelectorAll(".dash-hero-actions .dash-agent-btn");
    expect(heroActions).toHaveLength(1);
    expect(heroActions[0].textContent).toContain("Setup Docs");
  });

  it("shows activeLevel name as title when set", () => {
    const level = { type: "all-projects" as const, name: "MyProjects", path: "/home/user/Projects" };
    render(<WorkspaceOverview {...defaultProps} activeLevel={level} />);

    expect(screen.getByText("MyProjects")).toBeTruthy();
  });

  it("shows 'Workspace' as title when no allProjectsFolder", () => {
    render(<WorkspaceOverview {...defaultProps} />);

    expect(screen.getByText("Workspace")).toBeTruthy();
  });

  it("shows active level indicator when activeLevel is provided", async () => {
    const activeLevel = { type: "repo" as const, name: "my-repo", path: "/path/to/my-repo" };
    render(<WorkspaceOverview {...defaultProps} activeLevel={activeLevel} />);

    // Wait for loading to finish (invoke resolves with null)
    await waitFor(() => {
      expect(screen.getByText("Repo")).toBeTruthy();
    });
    expect(screen.getAllByText("my-repo").length).toBeGreaterThanOrEqual(1);
  });

  it("shows 'Init Tasks (/reggie-init-tasks)' for repo level", async () => {
    const activeLevel = { type: "repo" as const, name: "my-repo", path: "/path/to/my-repo" };
    render(<WorkspaceOverview {...defaultProps} activeLevel={activeLevel} />);

    await waitFor(() => {
      expect(screen.getByText("Init Tasks (/reggie-init-tasks)")).toBeTruthy();
    });
  });

  it("shows 'Distribute Tasks (/reggie-distribute-tasks)' for all-projects level", async () => {
    const activeLevel = { type: "all-projects" as const, name: "Projects", path: "/path/to/projects" };
    render(<WorkspaceOverview {...defaultProps} activeLevel={activeLevel} />);

    await waitFor(() => {
      expect(screen.getByText("Distribute Tasks (/reggie-distribute-tasks)")).toBeTruthy();
    });
  });

  it("shows 'Distribute Tasks (/reggie-distribute-tasks)' for workspace level", async () => {
    const activeLevel = { type: "workspace" as const, name: "My Workspace", path: "/path/to/workspace" };
    render(<WorkspaceOverview {...defaultProps} activeLevel={activeLevel} />);

    await waitFor(() => {
      expect(screen.getByText("Distribute Tasks (/reggie-distribute-tasks)")).toBeTruthy();
    });
  });

  it("workflow button title contains the reggie-prefixed command for repo level", async () => {
    const activeLevel = { type: "repo" as const, name: "my-repo", path: "/path/to/my-repo" };
    render(<WorkspaceOverview {...defaultProps} activeLevel={activeLevel} />);

    await waitFor(() => {
      const btn = screen.getByText("Init Tasks (/reggie-init-tasks)");
      expect(btn.getAttribute("title")).toBe("Run /reggie-init-tasks at my-repo");
    });
  });

  it("workflow button title contains the reggie-prefixed command for all-projects level", async () => {
    const activeLevel = { type: "all-projects" as const, name: "Projects", path: "/path/to/projects" };
    render(<WorkspaceOverview {...defaultProps} activeLevel={activeLevel} />);

    await waitFor(() => {
      const btn = screen.getByText("Distribute Tasks (/reggie-distribute-tasks)");
      expect(btn.getAttribute("title")).toBe("Run /reggie-distribute-tasks at Projects");
    });
  });

  describe("tab navigation", () => {
    it("renders 3 tab buttons", () => {
      render(<WorkspaceOverview {...defaultProps} />);

      expect(screen.getByText("Brain Dump")).toBeTruthy();
      expect(screen.getByText("Init Tasks")).toBeTruthy();
      expect(screen.getByText("Code Workflow")).toBeTruthy();
    });

    it("shows Brain Dump content by default", () => {
      render(<WorkspaceOverview {...defaultProps} />);

      // Brain Dump tab shows the hero section with the title
      expect(screen.getByText("Workspace")).toBeTruthy();
      // Init Tasks and Code Workflow tab content should not be visible
      expect(screen.queryByText("No repos found")).toBeNull();
    });

    it("shows Init Tasks tab content when Init Tasks tab is clicked", () => {
      render(<WorkspaceOverview {...defaultProps} />);

      fireEvent.click(screen.getByText("Init Tasks"));

      // Init Tasks tab renders its own content (no Brain Dump hero)
      expect(screen.queryByText("Setup Docs")).toBeNull();
      // Without an activeLevelPath, InitTasksTab shows the "No repos found" placeholder
      expect(screen.getByText("No repos found")).toBeTruthy();
    });

    it("shows Code Workflow tab content when Code Workflow tab is clicked", () => {
      render(<WorkspaceOverview {...defaultProps} />);

      fireEvent.click(screen.getByText("Code Workflow"));

      expect(screen.queryByText("Setup Docs")).toBeNull();
      // Without an activeLevelPath, CodeWorkflowTab shows the "No repos found" placeholder
      expect(screen.getByText("No repos found")).toBeTruthy();
    });

    it("restores Brain Dump content when clicking back from another tab", () => {
      render(<WorkspaceOverview {...defaultProps} />);

      fireEvent.click(screen.getByText("Init Tasks"));
      expect(screen.queryByText("Setup Docs")).toBeNull();

      fireEvent.click(screen.getByText("Brain Dump"));
      expect(screen.getByText("Setup Docs")).toBeTruthy();
      expect(screen.queryByText("No repos found")).toBeNull();
    });

    it("resets to Brain Dump tab when activeLevel changes", () => {
      const level1 = { type: "repo" as const, name: "repo-a", path: "/path/a" };
      const level2 = { type: "repo" as const, name: "repo-b", path: "/path/b" };

      const { rerender } = render(<WorkspaceOverview {...defaultProps} activeLevel={level1} />);

      // Navigate to Init Tasks tab
      fireEvent.click(screen.getByText("Init Tasks"));
      // Init Tasks tab content is rendered (Brain Dump hero is gone)
      expect(screen.queryByText("Setup Docs")).toBeNull();

      // Change activeLevel
      rerender(<WorkspaceOverview {...defaultProps} activeLevel={level2} />);

      // Should reset to Brain Dump tab -- hero content visible
      expect(screen.getByText("Setup Docs")).toBeTruthy();
      expect(screen.getByText("repo-b")).toBeTruthy();
    });
  });

  describe("notes textarea", () => {
    it("reflects notes prop value in textarea", async () => {
      const activeLevel = { type: "repo" as const, name: "my-repo", path: "/path/to/repo" };
      render(<WorkspaceOverview {...defaultProps} activeLevel={activeLevel} notes="my task notes" />);

      await waitFor(() => {
        const textarea = screen.getByPlaceholderText("Write your notes, task descriptions, or instructions here...");
        expect((textarea as HTMLTextAreaElement).value).toBe("my task notes");
      });
    });

    it("calls onNotesChange when textarea value changes", async () => {
      const onNotesChange = vi.fn();
      const activeLevel = { type: "repo" as const, name: "my-repo", path: "/path/to/repo" };
      render(<WorkspaceOverview {...defaultProps} activeLevel={activeLevel} onNotesChange={onNotesChange} />);

      await waitFor(() => {
        expect(screen.getByPlaceholderText("Write your notes, task descriptions, or instructions here...")).toBeTruthy();
      });

      const textarea = screen.getByPlaceholderText("Write your notes, task descriptions, or instructions here...");
      fireEvent.change(textarea, { target: { value: "updated notes" } });

      expect(onNotesChange).toHaveBeenCalledWith("updated notes");
    });

    it("passes notes to onStartWorkflow when workflow button is clicked", async () => {
      const onStartWorkflow = vi.fn();
      const activeLevel = { type: "repo" as const, name: "my-repo", path: "/path/to/repo" };
      render(
        <WorkspaceOverview
          {...defaultProps}
          activeLevel={activeLevel}
          notes="my workflow notes"
          onStartWorkflow={onStartWorkflow}
        />
      );

      await waitFor(() => {
        expect(screen.getByText("Init Tasks (/reggie-init-tasks)")).toBeTruthy();
      });

      fireEvent.click(screen.getByText("Init Tasks (/reggie-init-tasks)"));

      expect(onStartWorkflow).toHaveBeenCalledWith("my workflow notes");
    });
  });

  describe("textarea height persistence", () => {
    const textareaPlaceholder = "Write your notes, task descriptions, or instructions here...";

    async function waitForTextarea() {
      await waitFor(() => {
        expect(screen.getByPlaceholderText(textareaPlaceholder)).toBeTruthy();
      });
      return screen.getByPlaceholderText(textareaPlaceholder);
    }

    it("does not apply inline height style when textareaHeight is null", async () => {
      render(<WorkspaceOverview {...defaultProps} textareaHeight={null} />);

      const textarea = await waitForTextarea();
      expect(textarea.style.height).toBe("");
    });

    it("applies inline height style when textareaHeight is a number", async () => {
      render(<WorkspaceOverview {...defaultProps} textareaHeight={400} />);

      const textarea = await waitForTextarea();
      expect(textarea.style.height).toBe("400px");
    });

    it("updates inline height style when textareaHeight prop changes", async () => {
      const { rerender } = render(<WorkspaceOverview {...defaultProps} textareaHeight={null} />);
      let textarea = await waitForTextarea();
      expect(textarea.style.height).toBe("");

      rerender(<WorkspaceOverview {...defaultProps} textareaHeight={350} />);
      textarea = screen.getByPlaceholderText(textareaPlaceholder);
      expect(textarea.style.height).toBe("350px");

      rerender(<WorkspaceOverview {...defaultProps} textareaHeight={null} />);
      textarea = screen.getByPlaceholderText(textareaPlaceholder);
      expect(textarea.style.height).toBe("");
    });

    it("creates a ResizeObserver on the textarea", async () => {
      render(<WorkspaceOverview {...defaultProps} />);

      const textarea = await waitForTextarea();

      // Find the instance that observes the textarea
      const observerForTextarea = resizeObserverInstances.find(
        (inst) => inst.targets.includes(textarea)
      );
      expect(observerForTextarea).toBeTruthy();
    });

    it("calls onTextareaHeightChange when ResizeObserver fires", async () => {
      const onTextareaHeightChange = vi.fn();
      render(<WorkspaceOverview {...defaultProps} onTextareaHeightChange={onTextareaHeightChange} />);

      const textarea = await waitForTextarea();

      // Find the ResizeObserver instance that observes the textarea
      const observerForTextarea = resizeObserverInstances.find(
        (inst) => inst.targets.includes(textarea)
      );
      expect(observerForTextarea).toBeTruthy();

      // Simulate a resize by calling the observer callback
      // contentRect.height + (offsetHeight - clientHeight) = reported height
      // In jsdom offsetHeight and clientHeight are both 0, so height = contentRect.height
      const entry = {
        target: textarea,
        contentRect: { height: 500, width: 600 } as DOMRectReadOnly,
        borderBoxSize: [],
        contentBoxSize: [],
        devicePixelContentBoxSize: [],
      } as unknown as ResizeObserverEntry;

      observerForTextarea!.callback([entry], {} as ResizeObserver);

      expect(onTextareaHeightChange).toHaveBeenCalledWith(500);
    });

    it("disconnects ResizeObserver on unmount", async () => {
      const { unmount } = render(<WorkspaceOverview {...defaultProps} />);

      const textarea = await waitForTextarea();

      const observerForTextarea = resizeObserverInstances.find(
        (inst) => inst.targets.includes(textarea)
      );
      expect(observerForTextarea).toBeTruthy();
      expect(observerForTextarea!.disconnected).toBe(false);

      unmount();

      expect(observerForTextarea!.disconnected).toBe(true);
    });

    it("uses latest onTextareaHeightChange callback without recreating observer", async () => {
      const firstCallback = vi.fn();
      const secondCallback = vi.fn();

      const { rerender } = render(
        <WorkspaceOverview {...defaultProps} onTextareaHeightChange={firstCallback} />
      );

      const textarea = await waitForTextarea();

      // Count observers created so far for this textarea
      const observersBefore = resizeObserverInstances.filter(
        (inst) => inst.targets.includes(textarea)
      );
      expect(observersBefore).toHaveLength(1);

      // Rerender with a new callback
      rerender(<WorkspaceOverview {...defaultProps} onTextareaHeightChange={secondCallback} />);

      // No new observer should be created (callback ref is stable via useCallback([]))
      const observersAfter = resizeObserverInstances.filter(
        (inst) => inst.targets.includes(textarea)
      );
      expect(observersAfter).toHaveLength(1);

      // Fire the observer -- it should call the NEW callback, not the old one
      const entry = {
        target: textarea,
        contentRect: { height: 250, width: 600 } as DOMRectReadOnly,
        borderBoxSize: [],
        contentBoxSize: [],
        devicePixelContentBoxSize: [],
      } as unknown as ResizeObserverEntry;

      observersAfter[0].callback([entry], {} as ResizeObserver);

      expect(firstCallback).not.toHaveBeenCalled();
      expect(secondCallback).toHaveBeenCalledWith(250);
    });
  });
});
