import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { RepoTaskRow } from "../RepoTaskRow";
import type { RepoTaskSummary, HeadlessSession, TerminalTab } from "../../../types/terminal";

function makeRepo(overrides: Partial<RepoTaskSummary> = {}): RepoTaskSummary {
  return {
    name: "my-project",
    path: "/home/user/my-project",
    workspaceName: null,
    ungroomedCount: 3,
    groomedCount: 2,
    activeCount: 0,
    ...overrides,
  };
}

function makeSession(overrides: Partial<HeadlessSession> = {}): HeadlessSession {
  return {
    terminalId: "term-abc",
    projectPath: "/home/user/my-project",
    projectName: "my-project",
    label: "my-project",
    needsAttention: false,
    exited: false,
    exitCode: null,
    bufferSize: 100,
    completed: false,
    ...overrides,
  };
}

function makePromotedTab(overrides: Partial<TerminalTab> = {}): TerminalTab {
  return {
    id: "tab-promoted-1",
    terminalId: null,
    label: "init-tasks -- my-project",
    isClaudeSession: true,
    projectPath: "/home/user/my-project",
    projectName: "my-project",
    isHeadlessPromoted: true,
    headlessTerminalId: "ht-promoted-1",
    headlessCompleted: false,
    visible: true,
    ...overrides,
  };
}

const defaultProps = {
  onLaunchSession: vi.fn(),
  onOpenSession: vi.fn(),
};

describe("RepoTaskRow", () => {
  describe("init mode", () => {
    it("displays repo name", () => {
      render(
        <RepoTaskRow
          repo={makeRepo({ name: "forge-reggie" })}
          mode="init"
          headlessSessions={[]}
          {...defaultProps}
        />
      );
      expect(screen.getByText("forge-reggie")).toBeTruthy();
    });

    it("displays ungroomed count in init mode", () => {
      render(
        <RepoTaskRow
          repo={makeRepo({ ungroomedCount: 5 })}
          mode="init"
          headlessSessions={[]}
          {...defaultProps}
        />
      );
      expect(screen.getByText("5 ungroomed")).toBeTruthy();
    });

    it("shows Init button when repo has ungroomed tasks and no session", () => {
      render(
        <RepoTaskRow
          repo={makeRepo({ ungroomedCount: 3 })}
          mode="init"
          headlessSessions={[]}
          {...defaultProps}
        />
      );
      expect(screen.getByText("Init")).toBeTruthy();
    });

    it("shows Done status when ungroomed count is 0", () => {
      render(
        <RepoTaskRow
          repo={makeRepo({ ungroomedCount: 0 })}
          mode="init"
          headlessSessions={[]}
          {...defaultProps}
        />
      );
      expect(screen.getByText("Done")).toBeTruthy();
      expect(screen.queryByText("Init")).toBeNull();
    });
  });

  describe("code mode", () => {
    it("displays groomed count in code mode", () => {
      render(
        <RepoTaskRow
          repo={makeRepo({ groomedCount: 7 })}
          mode="code"
          headlessSessions={[]}
          {...defaultProps}
        />
      );
      expect(screen.getByText("7 tasks")).toBeTruthy();
    });

    it("shows Start button when repo has groomed tasks and no session", () => {
      render(
        <RepoTaskRow
          repo={makeRepo({ groomedCount: 4 })}
          mode="code"
          headlessSessions={[]}
          {...defaultProps}
        />
      );
      expect(screen.getByText("Start")).toBeTruthy();
    });

    it("shows Done status when groomed count is 0", () => {
      render(
        <RepoTaskRow
          repo={makeRepo({ groomedCount: 0 })}
          mode="code"
          headlessSessions={[]}
          {...defaultProps}
        />
      );
      expect(screen.getByText("Done")).toBeTruthy();
      expect(screen.queryByText("Start")).toBeNull();
    });
  });

  describe("active count in code mode", () => {
    it("includes active count in total tasks count in code mode", () => {
      render(
        <RepoTaskRow
          repo={makeRepo({ groomedCount: 3, activeCount: 2 })}
          mode="code"
          headlessSessions={[]}
          {...defaultProps}
        />
      );
      // code mode count = groomedCount + activeCount = 3 + 2 = 5
      expect(screen.getByText("5 tasks")).toBeTruthy();
    });

    it("does not include active count in init mode count", () => {
      render(
        <RepoTaskRow
          repo={makeRepo({ ungroomedCount: 4, activeCount: 2 })}
          mode="init"
          headlessSessions={[]}
          {...defaultProps}
        />
      );
      // init mode count = ungroomedCount only = 4
      expect(screen.getByText("4 ungroomed")).toBeTruthy();
    });
  });

  describe("single headless session", () => {
    it("shows Running status when session is active (in expanded view)", () => {
      const { container } = render(
        <RepoTaskRow
          repo={makeRepo()}
          mode="init"
          headlessSessions={[makeSession()]}
          {...defaultProps}
        />
      );
      // Collapsed: aggregate badge
      expect(screen.getByText("1 running")).toBeTruthy();
      // Expand to see per-session status
      fireEvent.click(container.querySelector(".repo-task-row")!);
      expect(screen.getByText("Running")).toBeTruthy();
    });

    it("shows Open button when session is running (in expanded view)", () => {
      const { container } = render(
        <RepoTaskRow
          repo={makeRepo()}
          mode="init"
          headlessSessions={[makeSession()]}
          {...defaultProps}
        />
      );
      fireEvent.click(container.querySelector(".repo-task-row")!);
      expect(screen.getByText("Open")).toBeTruthy();
      expect(screen.queryByText("Init")).toBeNull();
    });

    it("shows Needs Attention status when session needs attention (in expanded view)", () => {
      const { container } = render(
        <RepoTaskRow
          repo={makeRepo()}
          mode="init"
          headlessSessions={[makeSession({ needsAttention: true })]}
          {...defaultProps}
        />
      );
      fireEvent.click(container.querySelector(".repo-task-row")!);
      expect(screen.getByText("Needs Attention")).toBeTruthy();
    });

    it("shows Exited status when session has exited (in expanded view)", () => {
      const { container } = render(
        <RepoTaskRow
          repo={makeRepo()}
          mode="init"
          headlessSessions={[makeSession({ exited: true })]}
          {...defaultProps}
        />
      );
      fireEvent.click(container.querySelector(".repo-task-row")!);
      expect(screen.getByText("Exited")).toBeTruthy();
    });

    it("shows View button when session has exited (in expanded view)", () => {
      const { container } = render(
        <RepoTaskRow
          repo={makeRepo()}
          mode="init"
          headlessSessions={[makeSession({ exited: true })]}
          {...defaultProps}
        />
      );
      fireEvent.click(container.querySelector(".repo-task-row")!);
      expect(screen.getByText("View")).toBeTruthy();
      expect(screen.queryByText("Open")).toBeNull();
    });

    it("adds attention class on container when session needs attention", () => {
      const { container } = render(
        <RepoTaskRow
          repo={makeRepo()}
          mode="init"
          headlessSessions={[makeSession({ needsAttention: true })]}
          {...defaultProps}
        />
      );
      const row = container.querySelector(".repo-task-row-container.attention");
      expect(row).toBeTruthy();
    });

    it("shows chevron for a single session (now expandable)", () => {
      const { container } = render(
        <RepoTaskRow
          repo={makeRepo()}
          mode="init"
          headlessSessions={[makeSession()]}
          {...defaultProps}
        />
      );
      expect(container.querySelector(".repo-task-row-chevron")).toBeTruthy();
    });

    it("has aria-expanded for a single session (now expandable)", () => {
      const { container } = render(
        <RepoTaskRow
          repo={makeRepo()}
          mode="init"
          headlessSessions={[makeSession()]}
          {...defaultProps}
        />
      );
      const row = container.querySelector(".repo-task-row");
      expect(row?.getAttribute("aria-expanded")).toBe("false");
    });
  });

  describe("multi-session (expandable)", () => {
    const twoSessions = [
      makeSession({ terminalId: "term-1", label: "code -- my-project/add-streak", needsAttention: false, exited: false }),
      makeSession({ terminalId: "term-2", label: "code -- my-project/fix-bug", needsAttention: true, exited: false }),
    ];

    it("shows aggregate badges for mixed session states", () => {
      render(
        <RepoTaskRow
          repo={makeRepo()}
          mode="code"
          headlessSessions={twoSessions}
          {...defaultProps}
        />
      );
      expect(screen.getByText("1 code running")).toBeTruthy();
      expect(screen.getByText("1 attention")).toBeTruthy();
    });

    it("shows aggregate badges with exited sessions", () => {
      const sessions = [
        makeSession({ terminalId: "term-1", exited: false, needsAttention: false }),
        makeSession({ terminalId: "term-2", exited: false, needsAttention: false }),
        makeSession({ terminalId: "term-3", exited: true }),
      ];
      render(
        <RepoTaskRow
          repo={makeRepo()}
          mode="code"
          headlessSessions={sessions}
          {...defaultProps}
        />
      );
      expect(screen.getByText("2 running")).toBeTruthy();
      expect(screen.getByText("1 exited")).toBeTruthy();
    });

    it("shows chevron for expandable rows", () => {
      const { container } = render(
        <RepoTaskRow
          repo={makeRepo()}
          mode="code"
          headlessSessions={twoSessions}
          {...defaultProps}
        />
      );
      expect(container.querySelector(".repo-task-row-chevron")).toBeTruthy();
    });

    it("has aria-expanded=false when collapsed", () => {
      const { container } = render(
        <RepoTaskRow
          repo={makeRepo()}
          mode="code"
          headlessSessions={twoSessions}
          {...defaultProps}
        />
      );
      const row = container.querySelector(".repo-task-row");
      expect(row?.getAttribute("aria-expanded")).toBe("false");
    });

    it("toggles expanded state on click", () => {
      const { container } = render(
        <RepoTaskRow
          repo={makeRepo()}
          mode="code"
          headlessSessions={twoSessions}
          {...defaultProps}
        />
      );
      const row = container.querySelector(".repo-task-row")!;
      expect(row.getAttribute("aria-expanded")).toBe("false");
      expect(container.querySelector(".repo-task-row-sessions")).toBeNull();

      fireEvent.click(row);
      expect(row.getAttribute("aria-expanded")).toBe("true");
      expect(container.querySelector(".repo-task-row-sessions")).toBeTruthy();

      fireEvent.click(row);
      expect(row.getAttribute("aria-expanded")).toBe("false");
      expect(container.querySelector(".repo-task-row-sessions")).toBeNull();
    });

    it("shows slug names extracted from labels when expanded", () => {
      const { container } = render(
        <RepoTaskRow
          repo={makeRepo()}
          mode="code"
          headlessSessions={twoSessions}
          {...defaultProps}
        />
      );
      const row = container.querySelector(".repo-task-row")!;
      fireEvent.click(row);

      expect(screen.getByText("add-streak")).toBeTruthy();
      expect(screen.getByText("fix-bug")).toBeTruthy();
    });

    it("extracts slug from label with no slash by using part after --", () => {
      const sessions = [
        makeSession({ terminalId: "term-1", label: "init-tasks -- alpha-repo" }),
        makeSession({ terminalId: "term-2", label: "init-tasks -- beta-repo" }),
      ];
      const { container } = render(
        <RepoTaskRow
          repo={makeRepo()}
          mode="init"
          headlessSessions={sessions}
          {...defaultProps}
        />
      );
      fireEvent.click(container.querySelector(".repo-task-row")!);

      expect(screen.getByText("alpha-repo")).toBeTruthy();
      expect(screen.getByText("beta-repo")).toBeTruthy();
    });

    it("shows Open button for running sessions in expanded view", () => {
      const sessions = [
        makeSession({ terminalId: "term-1", label: "code -- repo/task-a", exited: false }),
        makeSession({ terminalId: "term-2", label: "code -- repo/task-b", exited: false }),
      ];
      const { container } = render(
        <RepoTaskRow
          repo={makeRepo()}
          mode="code"
          headlessSessions={sessions}
          {...defaultProps}
        />
      );
      fireEvent.click(container.querySelector(".repo-task-row")!);

      const openButtons = screen.getAllByText("Open");
      expect(openButtons.length).toBe(2);
    });

    it("shows View button for exited sessions in expanded view", () => {
      const sessions = [
        makeSession({ terminalId: "term-1", label: "code -- repo/task-a", exited: true }),
        makeSession({ terminalId: "term-2", label: "code -- repo/task-b", exited: false }),
      ];
      const { container } = render(
        <RepoTaskRow
          repo={makeRepo()}
          mode="code"
          headlessSessions={sessions}
          {...defaultProps}
        />
      );
      fireEvent.click(container.querySelector(".repo-task-row")!);

      expect(screen.getByText("View")).toBeTruthy();
      expect(screen.getByText("Open")).toBeTruthy();
    });

    it("calls onOpenSession with correct terminal ID from expanded session Open button", () => {
      const onOpenSession = vi.fn();
      const sessions = [
        makeSession({ terminalId: "term-1", label: "code -- repo/task-a" }),
        makeSession({ terminalId: "term-2", label: "code -- repo/task-b" }),
      ];
      const { container } = render(
        <RepoTaskRow
          repo={makeRepo()}
          mode="code"
          headlessSessions={sessions}
          onLaunchSession={vi.fn()}
          onOpenSession={onOpenSession}
        />
      );
      fireEvent.click(container.querySelector(".repo-task-row")!);

      const openButtons = screen.getAllByText("Open");
      fireEvent.click(openButtons[1]);
      expect(onOpenSession).toHaveBeenCalledWith("term-2");
    });

    it("calls onOpenSession with correct terminal ID from expanded session View button", () => {
      const onOpenSession = vi.fn();
      const sessions = [
        makeSession({ terminalId: "term-1", label: "code -- repo/task-a", exited: true }),
        makeSession({ terminalId: "term-2", label: "code -- repo/task-b", exited: true }),
      ];
      const { container } = render(
        <RepoTaskRow
          repo={makeRepo()}
          mode="code"
          headlessSessions={sessions}
          onLaunchSession={vi.fn()}
          onOpenSession={onOpenSession}
        />
      );
      fireEvent.click(container.querySelector(".repo-task-row")!);

      const viewButtons = screen.getAllByText("View");
      fireEvent.click(viewButtons[0]);
      expect(onOpenSession).toHaveBeenCalledWith("term-1");
    });

    it("adds attention class on container when any session needs attention", () => {
      const sessions = [
        makeSession({ terminalId: "term-1", needsAttention: false }),
        makeSession({ terminalId: "term-2", needsAttention: true }),
      ];
      const { container } = render(
        <RepoTaskRow
          repo={makeRepo()}
          mode="code"
          headlessSessions={sessions}
          {...defaultProps}
        />
      );
      expect(container.querySelector(".repo-task-row-container.attention")).toBeTruthy();
    });

    it("does not add attention class when no sessions need attention", () => {
      const sessions = [
        makeSession({ terminalId: "term-1", needsAttention: false }),
        makeSession({ terminalId: "term-2", needsAttention: false }),
      ];
      const { container } = render(
        <RepoTaskRow
          repo={makeRepo()}
          mode="code"
          headlessSessions={sessions}
          {...defaultProps}
        />
      );
      expect(container.querySelector(".repo-task-row-container.attention")).toBeNull();
    });

    it("does not show inline Running/Open/View for multi-session rows", () => {
      render(
        <RepoTaskRow
          repo={makeRepo()}
          mode="code"
          headlessSessions={twoSessions}
          {...defaultProps}
        />
      );
      // No inline status text -- only aggregate badges
      expect(screen.queryByText("Running")).toBeNull();
      expect(screen.queryByText("Needs Attention")).toBeNull();
      // No inline buttons when collapsed
      expect(screen.queryByText("Open")).toBeNull();
      expect(screen.queryByText("View")).toBeNull();
    });

    it("shows status text for each session in expanded view", () => {
      const sessions = [
        makeSession({ terminalId: "term-1", label: "code -- repo/task-a", exited: false, needsAttention: false }),
        makeSession({ terminalId: "term-2", label: "code -- repo/task-b", exited: false, needsAttention: true }),
        makeSession({ terminalId: "term-3", label: "code -- repo/task-c", exited: true }),
      ];
      const { container } = render(
        <RepoTaskRow
          repo={makeRepo()}
          mode="code"
          headlessSessions={sessions}
          {...defaultProps}
        />
      );
      fireEvent.click(container.querySelector(".repo-task-row")!);

      expect(screen.getByText("Running")).toBeTruthy();
      expect(screen.getByText("Needs Attention")).toBeTruthy();
      expect(screen.getByText("Exited")).toBeTruthy();
    });

    it("expands via keyboard Enter key", () => {
      const { container } = render(
        <RepoTaskRow
          repo={makeRepo()}
          mode="code"
          headlessSessions={twoSessions}
          {...defaultProps}
        />
      );
      const row = container.querySelector(".repo-task-row")!;
      fireEvent.keyDown(row, { key: "Enter" });
      expect(row.getAttribute("aria-expanded")).toBe("true");
    });

    it("expands via keyboard Space key", () => {
      const { container } = render(
        <RepoTaskRow
          repo={makeRepo()}
          mode="code"
          headlessSessions={twoSessions}
          {...defaultProps}
        />
      );
      const row = container.querySelector(".repo-task-row")!;
      fireEvent.keyDown(row, { key: " " });
      expect(row.getAttribute("aria-expanded")).toBe("true");
    });
  });

  describe("dismiss sessions", () => {
    it("shows Dismiss button for single exited session when onDismissSession provided (in expanded view)", () => {
      const { container } = render(
        <RepoTaskRow
          repo={makeRepo()}
          mode="init"
          headlessSessions={[makeSession({ exited: true })]}
          {...defaultProps}
          onDismissSession={vi.fn()}
        />
      );
      fireEvent.click(container.querySelector(".repo-task-row")!);
      expect(screen.getByText("Dismiss")).toBeTruthy();
    });

    it("does not show Dismiss button for single exited session when onDismissSession not provided", () => {
      const { container } = render(
        <RepoTaskRow
          repo={makeRepo()}
          mode="init"
          headlessSessions={[makeSession({ exited: true })]}
          {...defaultProps}
        />
      );
      fireEvent.click(container.querySelector(".repo-task-row")!);
      expect(screen.queryByText("Dismiss")).toBeNull();
    });

    it("does not show Dismiss button for single running session", () => {
      const { container } = render(
        <RepoTaskRow
          repo={makeRepo()}
          mode="init"
          headlessSessions={[makeSession({ exited: false })]}
          {...defaultProps}
          onDismissSession={vi.fn()}
        />
      );
      fireEvent.click(container.querySelector(".repo-task-row")!);
      expect(screen.queryByText("Dismiss")).toBeNull();
    });

    it("calls onDismissSession with correct terminalId when single-session Dismiss clicked", () => {
      const onDismissSession = vi.fn();
      const { container } = render(
        <RepoTaskRow
          repo={makeRepo()}
          mode="init"
          headlessSessions={[makeSession({ terminalId: "term-exit-1", exited: true })]}
          onLaunchSession={vi.fn()}
          onOpenSession={vi.fn()}
          onDismissSession={onDismissSession}
        />
      );
      fireEvent.click(container.querySelector(".repo-task-row")!);
      fireEvent.click(screen.getByText("Dismiss"));
      expect(onDismissSession).toHaveBeenCalledWith("term-exit-1");
    });

    it("shows Dismiss All button for multi-session with exited sessions when onDismissSession provided", () => {
      const sessions = [
        makeSession({ terminalId: "term-1", exited: false }),
        makeSession({ terminalId: "term-2", exited: true }),
      ];
      render(
        <RepoTaskRow
          repo={makeRepo()}
          mode="code"
          headlessSessions={sessions}
          {...defaultProps}
          onDismissSession={vi.fn()}
        />
      );
      expect(screen.getByText("Dismiss All")).toBeTruthy();
    });

    it("does not show Dismiss All button for multi-session with no exited sessions", () => {
      const sessions = [
        makeSession({ terminalId: "term-1", exited: false }),
        makeSession({ terminalId: "term-2", exited: false }),
      ];
      render(
        <RepoTaskRow
          repo={makeRepo()}
          mode="code"
          headlessSessions={sessions}
          {...defaultProps}
          onDismissSession={vi.fn()}
        />
      );
      expect(screen.queryByText("Dismiss All")).toBeNull();
    });

    it("does not show Dismiss All button for multi-session without onDismissSession", () => {
      const sessions = [
        makeSession({ terminalId: "term-1", exited: false }),
        makeSession({ terminalId: "term-2", exited: true }),
      ];
      render(
        <RepoTaskRow
          repo={makeRepo()}
          mode="code"
          headlessSessions={sessions}
          {...defaultProps}
        />
      );
      expect(screen.queryByText("Dismiss All")).toBeNull();
    });

    it("calls onDismissSession for each exited session when Dismiss All clicked", () => {
      const onDismissSession = vi.fn();
      const sessions = [
        makeSession({ terminalId: "term-1", exited: false }),
        makeSession({ terminalId: "term-2", exited: true }),
        makeSession({ terminalId: "term-3", exited: true }),
      ];
      render(
        <RepoTaskRow
          repo={makeRepo()}
          mode="code"
          headlessSessions={sessions}
          onLaunchSession={vi.fn()}
          onOpenSession={vi.fn()}
          onDismissSession={onDismissSession}
        />
      );
      fireEvent.click(screen.getByText("Dismiss All"));
      expect(onDismissSession).toHaveBeenCalledTimes(2);
      expect(onDismissSession).toHaveBeenCalledWith("term-2");
      expect(onDismissSession).toHaveBeenCalledWith("term-3");
    });

    it("shows Dismiss button for exited session in expanded view", () => {
      const sessions = [
        makeSession({ terminalId: "term-1", label: "code -- repo/task-a", exited: true }),
        makeSession({ terminalId: "term-2", label: "code -- repo/task-b", exited: false }),
      ];
      const { container } = render(
        <RepoTaskRow
          repo={makeRepo()}
          mode="code"
          headlessSessions={sessions}
          {...defaultProps}
          onDismissSession={vi.fn()}
        />
      );
      fireEvent.click(container.querySelector(".repo-task-row")!);

      // Only one Dismiss button -- for the exited session
      const dismissButtons = screen.getAllByText("Dismiss");
      expect(dismissButtons.length).toBe(1);
    });

    it("does not show Dismiss button for running session in expanded view", () => {
      const sessions = [
        makeSession({ terminalId: "term-1", label: "code -- repo/task-a", exited: false }),
        makeSession({ terminalId: "term-2", label: "code -- repo/task-b", exited: false }),
      ];
      const { container } = render(
        <RepoTaskRow
          repo={makeRepo()}
          mode="code"
          headlessSessions={sessions}
          {...defaultProps}
          onDismissSession={vi.fn()}
        />
      );
      fireEvent.click(container.querySelector(".repo-task-row")!);

      expect(screen.queryByText("Dismiss")).toBeNull();
    });

    it("calls onDismissSession with correct terminalId when expanded row Dismiss clicked", () => {
      const onDismissSession = vi.fn();
      const sessions = [
        makeSession({ terminalId: "term-1", label: "code -- repo/task-a", exited: true }),
        makeSession({ terminalId: "term-2", label: "code -- repo/task-b", exited: true }),
      ];
      const { container } = render(
        <RepoTaskRow
          repo={makeRepo()}
          mode="code"
          headlessSessions={sessions}
          onLaunchSession={vi.fn()}
          onOpenSession={vi.fn()}
          onDismissSession={onDismissSession}
        />
      );
      fireEvent.click(container.querySelector(".repo-task-row")!);

      const dismissButtons = screen.getAllByText("Dismiss");
      fireEvent.click(dismissButtons[1]);
      expect(onDismissSession).toHaveBeenCalledWith("term-2");
    });
  });

  describe("completed sessions", () => {
    it("shows Completed badge instead of Running/Exited for single completed session (in expanded view)", () => {
      const { container } = render(
        <RepoTaskRow
          repo={makeRepo()}
          mode="code"
          headlessSessions={[makeSession({ completed: true })]}
          {...defaultProps}
        />
      );
      // Collapsed: aggregate badge
      expect(screen.getByText("1 completed")).toBeTruthy();
      // Expand
      fireEvent.click(container.querySelector(".repo-task-row")!);
      const completedBadges = container.querySelectorAll(".session-completed-badge.small");
      expect(completedBadges).toHaveLength(1);
      expect(screen.queryByText("Running")).toBeNull();
      expect(screen.queryByText("Exited")).toBeNull();
    });

    it("shows Trash button for completed session when onTrashSession provided (in expanded view)", () => {
      const { container } = render(
        <RepoTaskRow
          repo={makeRepo()}
          mode="code"
          headlessSessions={[makeSession({ completed: true })]}
          {...defaultProps}
          onTrashSession={vi.fn()}
        />
      );
      fireEvent.click(container.querySelector(".repo-task-row")!);
      expect(screen.getByTitle("Trash completed session")).toBeTruthy();
    });

    it("does not show Trash button when onTrashSession is not provided", () => {
      const { container } = render(
        <RepoTaskRow
          repo={makeRepo()}
          mode="code"
          headlessSessions={[makeSession({ completed: true })]}
          {...defaultProps}
        />
      );
      fireEvent.click(container.querySelector(".repo-task-row")!);
      expect(screen.queryByTitle("Trash completed session")).toBeNull();
    });

    it("calls onTrashSession with terminalId when Trash clicked (in expanded view)", () => {
      const onTrashSession = vi.fn();
      const { container } = render(
        <RepoTaskRow
          repo={makeRepo()}
          mode="code"
          headlessSessions={[makeSession({ terminalId: "ht-done", completed: true })]}
          onLaunchSession={vi.fn()}
          onOpenSession={vi.fn()}
          onTrashSession={onTrashSession}
        />
      );
      fireEvent.click(container.querySelector(".repo-task-row")!);
      fireEvent.click(screen.getByTitle("Trash completed session"));
      expect(onTrashSession).toHaveBeenCalledWith("ht-done");
    });

    it("does not show Dismiss button for completed session (uses Trash instead)", () => {
      const { container } = render(
        <RepoTaskRow
          repo={makeRepo()}
          mode="code"
          headlessSessions={[makeSession({ completed: true, exited: false })]}
          {...defaultProps}
          onDismissSession={vi.fn()}
          onTrashSession={vi.fn()}
        />
      );
      fireEvent.click(container.querySelector(".repo-task-row")!);
      expect(screen.getByTitle("Trash completed session")).toBeTruthy();
      expect(screen.queryByTitle("Dismiss completed session")).toBeNull();
    });

    it("shows completed count in aggregate badges for multi-session", () => {
      const sessions = [
        makeSession({ terminalId: "term-1", label: "code -- repo/task-a", completed: false }),
        makeSession({ terminalId: "term-2", label: "code -- repo/task-b", completed: true }),
        makeSession({ terminalId: "term-3", label: "code -- repo/task-c", completed: true }),
      ];
      render(
        <RepoTaskRow
          repo={makeRepo()}
          mode="code"
          headlessSessions={sessions}
          {...defaultProps}
        />
      );
      expect(screen.getByText("1 code running")).toBeTruthy();
      expect(screen.getByText("2 completed")).toBeTruthy();
    });

    it("shows Completed badge in expanded view for completed sessions", () => {
      const sessions = [
        makeSession({ terminalId: "term-1", label: "code -- repo/task-a", completed: true }),
        makeSession({ terminalId: "term-2", label: "code -- repo/task-b", completed: false }),
      ];
      const { container } = render(
        <RepoTaskRow
          repo={makeRepo()}
          mode="code"
          headlessSessions={sessions}
          {...defaultProps}
        />
      );
      fireEvent.click(container.querySelector(".repo-task-row")!);

      // The completed session should show "Completed" badge, the running one should show "Running"
      expect(screen.getByText("Running")).toBeTruthy();
      const completedBadges = container.querySelectorAll(".session-completed-badge.small");
      expect(completedBadges).toHaveLength(1);
    });

    it("shows View button for completed+exited session (in expanded view)", () => {
      const { container } = render(
        <RepoTaskRow
          repo={makeRepo()}
          mode="code"
          headlessSessions={[makeSession({ completed: true, exited: true })]}
          {...defaultProps}
        />
      );
      fireEvent.click(container.querySelector(".repo-task-row")!);
      expect(screen.getByText("View")).toBeTruthy();
    });

    it("does not show Kill button for completed session (in expanded view)", () => {
      const { container } = render(
        <RepoTaskRow
          repo={makeRepo()}
          mode="code"
          headlessSessions={[makeSession({ completed: true })]}
          {...defaultProps}
          onKillSession={vi.fn()}
        />
      );
      fireEvent.click(container.querySelector(".repo-task-row")!);
      // completed=true && !exited => kill button should NOT show (completed sessions excluded)
      expect(screen.queryByTitle("Kill process")).toBeNull();
    });
  });

  describe("callbacks", () => {
    it("calls onLaunchSession with repo path and name when Init clicked", () => {
      const onLaunchSession = vi.fn();
      render(
        <RepoTaskRow
          repo={makeRepo({ name: "proj", path: "/path/proj", ungroomedCount: 1 })}
          mode="init"
          headlessSessions={[]}
          onLaunchSession={onLaunchSession}
          onOpenSession={vi.fn()}
        />
      );
      fireEvent.click(screen.getByText("Init"));
      expect(onLaunchSession).toHaveBeenCalledWith("/path/proj", "proj");
    });

    it("calls onOpenSession with terminal id when Open clicked (in expanded view)", () => {
      const onOpenSession = vi.fn();
      const { container } = render(
        <RepoTaskRow
          repo={makeRepo()}
          mode="init"
          headlessSessions={[makeSession({ terminalId: "term-xyz" })]}
          onLaunchSession={vi.fn()}
          onOpenSession={onOpenSession}
        />
      );
      fireEvent.click(container.querySelector(".repo-task-row")!);
      fireEvent.click(screen.getByText("Open"));
      expect(onOpenSession).toHaveBeenCalledWith("term-xyz");
    });

    it("calls onOpenSession when View clicked on exited session (in expanded view)", () => {
      const onOpenSession = vi.fn();
      const { container } = render(
        <RepoTaskRow
          repo={makeRepo()}
          mode="init"
          headlessSessions={[makeSession({ terminalId: "term-done", exited: true })]}
          onLaunchSession={vi.fn()}
          onOpenSession={onOpenSession}
        />
      );
      fireEvent.click(container.querySelector(".repo-task-row")!);
      fireEvent.click(screen.getByText("View"));
      expect(onOpenSession).toHaveBeenCalledWith("term-done");
    });
  });

  describe("promoted sessions", () => {
    it("shows Hide button for promoted visible session in expanded view (init mode)", () => {
      const onHideSession = vi.fn();
      const promoted = makePromotedTab({ visible: true });
      const { container } = render(
        <RepoTaskRow
          repo={makeRepo()}
          mode="init"
          headlessSessions={[]}
          repoTabs={[promoted]}
          {...defaultProps}
          onHideSession={onHideSession}
        />
      );
      fireEvent.click(container.querySelector(".repo-task-row")!);
      expect(screen.getByText("Hide")).toBeTruthy();
    });

    it("calls onHideSession with tab id when Hide is clicked", () => {
      const onHideSession = vi.fn();
      const promoted = makePromotedTab({ id: "tab-hide-1", visible: true });
      const { container } = render(
        <RepoTaskRow
          repo={makeRepo()}
          mode="init"
          headlessSessions={[]}
          repoTabs={[promoted]}
          {...defaultProps}
          onHideSession={onHideSession}
        />
      );
      fireEvent.click(container.querySelector(".repo-task-row")!);
      fireEvent.click(screen.getByText("Hide"));
      expect(onHideSession).toHaveBeenCalledWith("tab-hide-1");
    });

    it("shows Open button for promoted hidden session in expanded view", () => {
      const onPromoteSession = vi.fn();
      const promoted = makePromotedTab({ visible: false });
      const { container } = render(
        <RepoTaskRow
          repo={makeRepo()}
          mode="init"
          headlessSessions={[]}
          repoTabs={[promoted]}
          {...defaultProps}
          onPromoteSession={onPromoteSession}
        />
      );
      fireEvent.click(container.querySelector(".repo-task-row")!);
      expect(screen.getByText("Open")).toBeTruthy();
    });

    it("calls onPromoteSession with tab id when Open is clicked on hidden promoted session", () => {
      const onPromoteSession = vi.fn();
      const promoted = makePromotedTab({ id: "tab-open-1", visible: false });
      const { container } = render(
        <RepoTaskRow
          repo={makeRepo()}
          mode="init"
          headlessSessions={[]}
          repoTabs={[promoted]}
          {...defaultProps}
          onPromoteSession={onPromoteSession}
        />
      );
      fireEvent.click(container.querySelector(".repo-task-row")!);
      fireEvent.click(screen.getByText("Open"));
      expect(onPromoteSession).toHaveBeenCalledWith("tab-open-1");
    });

    it("shows Kill button for promoted running session in expanded view", () => {
      const onKillPromotedSession = vi.fn();
      const promoted = makePromotedTab({ dead: false, headlessCompleted: false });
      const { container } = render(
        <RepoTaskRow
          repo={makeRepo()}
          mode="init"
          headlessSessions={[]}
          repoTabs={[promoted]}
          {...defaultProps}
          onKillPromotedSession={onKillPromotedSession}
        />
      );
      fireEvent.click(container.querySelector(".repo-task-row")!);
      expect(screen.getByTitle("Kill process")).toBeTruthy();
    });

    it("calls onKillPromotedSession with tab id when Kill is clicked", () => {
      const onKillPromotedSession = vi.fn();
      const promoted = makePromotedTab({ id: "tab-kill-1", dead: false, headlessCompleted: false });
      const { container } = render(
        <RepoTaskRow
          repo={makeRepo()}
          mode="init"
          headlessSessions={[]}
          repoTabs={[promoted]}
          {...defaultProps}
          onKillPromotedSession={onKillPromotedSession}
        />
      );
      fireEvent.click(container.querySelector(".repo-task-row")!);
      fireEvent.click(screen.getByTitle("Kill process"));
      expect(onKillPromotedSession).toHaveBeenCalledWith("tab-kill-1");
    });

    it("does not show Kill button for promoted completed session", () => {
      const onKillPromotedSession = vi.fn();
      const promoted = makePromotedTab({ headlessCompleted: true });
      const { container } = render(
        <RepoTaskRow
          repo={makeRepo()}
          mode="init"
          headlessSessions={[]}
          repoTabs={[promoted]}
          {...defaultProps}
          onKillPromotedSession={onKillPromotedSession}
        />
      );
      fireEvent.click(container.querySelector(".repo-task-row")!);
      expect(screen.queryByTitle("Kill process")).toBeNull();
    });

    it("does not show Kill button for promoted dead session", () => {
      const onKillPromotedSession = vi.fn();
      const promoted = makePromotedTab({ dead: true });
      const { container } = render(
        <RepoTaskRow
          repo={makeRepo()}
          mode="init"
          headlessSessions={[]}
          repoTabs={[promoted]}
          {...defaultProps}
          onKillPromotedSession={onKillPromotedSession}
        />
      );
      fireEvent.click(container.querySelector(".repo-task-row")!);
      expect(screen.queryByTitle("Kill process")).toBeNull();
    });

    it("shows Trash button for completed promoted session when onKillPromotedSession provided", () => {
      const onKillPromotedSession = vi.fn();
      const promoted = makePromotedTab({ headlessCompleted: true });
      const { container } = render(
        <RepoTaskRow
          repo={makeRepo()}
          mode="init"
          headlessSessions={[]}
          repoTabs={[promoted]}
          {...defaultProps}
          onKillPromotedSession={onKillPromotedSession}
        />
      );
      fireEvent.click(container.querySelector(".repo-task-row")!);
      expect(screen.getByTitle("Trash completed session")).toBeTruthy();
    });

    it("shows Trash button for dead promoted session when onKillPromotedSession provided", () => {
      const onKillPromotedSession = vi.fn();
      const promoted = makePromotedTab({ dead: true });
      const { container } = render(
        <RepoTaskRow
          repo={makeRepo()}
          mode="init"
          headlessSessions={[]}
          repoTabs={[promoted]}
          {...defaultProps}
          onKillPromotedSession={onKillPromotedSession}
        />
      );
      fireEvent.click(container.querySelector(".repo-task-row")!);
      expect(screen.getByTitle("Trash completed session")).toBeTruthy();
    });

    it("does not show Trash button for completed promoted session when onKillPromotedSession not provided", () => {
      const promoted = makePromotedTab({ headlessCompleted: true });
      const { container } = render(
        <RepoTaskRow
          repo={makeRepo()}
          mode="init"
          headlessSessions={[]}
          repoTabs={[promoted]}
          {...defaultProps}
        />
      );
      fireEvent.click(container.querySelector(".repo-task-row")!);
      expect(screen.queryByTitle("Trash completed session")).toBeNull();
    });

    it("calls onKillPromotedSession with tab id when Trash is clicked on completed promoted session", () => {
      const onKillPromotedSession = vi.fn();
      const promoted = makePromotedTab({ id: "tab-trash-1", headlessCompleted: true });
      const { container } = render(
        <RepoTaskRow
          repo={makeRepo()}
          mode="init"
          headlessSessions={[]}
          repoTabs={[promoted]}
          {...defaultProps}
          onKillPromotedSession={onKillPromotedSession}
        />
      );
      fireEvent.click(container.querySelector(".repo-task-row")!);
      fireEvent.click(screen.getByTitle("Trash completed session"));
      expect(onKillPromotedSession).toHaveBeenCalledWith("tab-trash-1");
    });

    it("shows Trash not Kill for completed promoted session (mutually exclusive)", () => {
      const onKillPromotedSession = vi.fn();
      const promoted = makePromotedTab({ headlessCompleted: true });
      const { container } = render(
        <RepoTaskRow
          repo={makeRepo()}
          mode="init"
          headlessSessions={[]}
          repoTabs={[promoted]}
          {...defaultProps}
          onKillPromotedSession={onKillPromotedSession}
        />
      );
      fireEvent.click(container.querySelector(".repo-task-row")!);
      expect(screen.getByTitle("Trash completed session")).toBeTruthy();
      expect(screen.queryByTitle("Kill process")).toBeNull();
    });

    it("counts promoted running sessions in aggregate badge", () => {
      const promoted = makePromotedTab({ dead: false, headlessCompleted: false });
      render(
        <RepoTaskRow
          repo={makeRepo()}
          mode="init"
          headlessSessions={[]}
          repoTabs={[promoted]}
          {...defaultProps}
        />
      );
      expect(screen.getByText("1 running")).toBeTruthy();
    });

    it("counts promoted completed sessions in aggregate badge", () => {
      const promoted = makePromotedTab({ headlessCompleted: true });
      render(
        <RepoTaskRow
          repo={makeRepo()}
          mode="init"
          headlessSessions={[]}
          repoTabs={[promoted]}
          {...defaultProps}
        />
      );
      expect(screen.getByText("1 completed")).toBeTruthy();
    });

    it("makes row expandable when only promoted sessions exist (no headless)", () => {
      const promoted = makePromotedTab();
      const { container } = render(
        <RepoTaskRow
          repo={makeRepo()}
          mode="init"
          headlessSessions={[]}
          repoTabs={[promoted]}
          {...defaultProps}
        />
      );
      expect(container.querySelector(".repo-task-row-chevron")).toBeTruthy();
      expect(container.querySelector(".repo-task-row")?.getAttribute("aria-expanded")).toBe("false");
    });

    it("does not show promoted sessions that do not match the mode prefix", () => {
      // In init mode, only "init-tasks" prefixed sessions should appear
      const codePromoted = makePromotedTab({ label: "code -- my-project/fix-bug" });
      render(
        <RepoTaskRow
          repo={makeRepo()}
          mode="init"
          headlessSessions={[]}
          repoTabs={[codePromoted]}
          {...defaultProps}
        />
      );
      // No sessions should match, so row should NOT be expandable
      expect(screen.queryByText("1 running")).toBeNull();
    });

    it("shows promoted sessions alongside headless sessions in aggregate", () => {
      const promoted = makePromotedTab({ dead: false, headlessCompleted: false });
      const headless = makeSession({ terminalId: "ht-bg-1", label: "init-tasks -- my-project" });
      render(
        <RepoTaskRow
          repo={makeRepo()}
          mode="init"
          headlessSessions={[headless]}
          repoTabs={[promoted]}
          {...defaultProps}
        />
      );
      expect(screen.getByText("2 running")).toBeTruthy();
    });

    it("shows in focus badge when promoted session is visible", () => {
      const promoted = makePromotedTab({ visible: true });
      render(
        <RepoTaskRow
          repo={makeRepo()}
          mode="init"
          headlessSessions={[]}
          repoTabs={[promoted]}
          {...defaultProps}
        />
      );
      expect(screen.getByText("in focus")).toBeTruthy();
    });

    it("does not show in focus badge when promoted session is hidden", () => {
      const promoted = makePromotedTab({ visible: false });
      render(
        <RepoTaskRow
          repo={makeRepo()}
          mode="init"
          headlessSessions={[]}
          repoTabs={[promoted]}
          {...defaultProps}
        />
      );
      expect(screen.queryByText("in focus")).toBeNull();
    });

    it("shows Completed badge for promoted dead session in expanded view", () => {
      const promoted = makePromotedTab({ dead: true, headlessCompleted: true });
      const { container } = render(
        <RepoTaskRow
          repo={makeRepo()}
          mode="init"
          headlessSessions={[]}
          repoTabs={[promoted]}
          {...defaultProps}
        />
      );
      fireEvent.click(container.querySelector(".repo-task-row")!);
      const completedBadges = container.querySelectorAll(".session-completed-badge.small");
      expect(completedBadges).toHaveLength(1);
      // Should not show Running text
      expect(screen.queryByText("Running")).toBeNull();
    });

    it("shows slug extracted from promoted session label in expanded view", () => {
      const promoted = makePromotedTab({ label: "init-tasks -- alpha-repo" });
      const { container } = render(
        <RepoTaskRow
          repo={makeRepo()}
          mode="init"
          headlessSessions={[]}
          repoTabs={[promoted]}
          {...defaultProps}
        />
      );
      fireEvent.click(container.querySelector(".repo-task-row")!);
      // The slug is extracted from the label using extractSlug ("init-tasks -- alpha-repo" -> "alpha-repo")
      const slugEl = container.querySelector(".repo-task-row-session-slug");
      expect(slugEl).toBeTruthy();
      expect(slugEl!.textContent).toBe("alpha-repo");
    });

    it("handleOpenSession promotes hidden tab instead of calling onOpenSession for matching headless ID", () => {
      const onOpenSession = vi.fn();
      const onPromoteSession = vi.fn();
      // A headless session whose terminalId matches a hidden promoted tab
      const headless = makeSession({ terminalId: "ht-hidden-1", label: "init-tasks -- my-project" });
      const hiddenTab = makePromotedTab({
        id: "tab-hidden-1",
        headlessTerminalId: "ht-hidden-1",
        visible: false,
      });
      const { container } = render(
        <RepoTaskRow
          repo={makeRepo()}
          mode="init"
          headlessSessions={[headless]}
          repoTabs={[hiddenTab]}
          onLaunchSession={vi.fn()}
          onOpenSession={onOpenSession}
          onPromoteSession={onPromoteSession}
        />
      );
      fireEvent.click(container.querySelector(".repo-task-row")!);
      // Click the Open button on the headless session row
      const openButtons = screen.getAllByText("Open");
      // The headless session Open button triggers handleOpenSession
      // Find the one in the headless session section (second section after promoted)
      fireEvent.click(openButtons[openButtons.length - 1]);
      // Should call onPromoteSession for the hidden tab, NOT onOpenSession
      expect(onPromoteSession).toHaveBeenCalledWith("tab-hidden-1");
      expect(onOpenSession).not.toHaveBeenCalled();
    });

    it("handleOpenSession falls back to onOpenSession when no hidden tab matches", () => {
      const onOpenSession = vi.fn();
      const onPromoteSession = vi.fn();
      const headless = makeSession({ terminalId: "ht-no-match", label: "init-tasks -- my-project" });
      const { container } = render(
        <RepoTaskRow
          repo={makeRepo()}
          mode="init"
          headlessSessions={[headless]}
          repoTabs={[]}
          onLaunchSession={vi.fn()}
          onOpenSession={onOpenSession}
          onPromoteSession={onPromoteSession}
        />
      );
      fireEvent.click(container.querySelector(".repo-task-row")!);
      fireEvent.click(screen.getByText("Open"));
      expect(onOpenSession).toHaveBeenCalledWith("ht-no-match");
      expect(onPromoteSession).not.toHaveBeenCalled();
    });
  });

  describe("task items", () => {
    it("makes row expandable when ungroomed tasks exist but no sessions", () => {
      const { container } = render(
        <RepoTaskRow
          repo={makeRepo({
            ungroomedTasks: [{ slug: "fix-bug", description: "Fix the bug" }],
          })}
          mode="init"
          headlessSessions={[]}
          {...defaultProps}
        />
      );
      expect(container.querySelector(".repo-task-row-chevron")).toBeTruthy();
      expect(container.querySelector(".repo-task-row")?.getAttribute("aria-expanded")).toBe("false");
    });

    it("shows task items when expanded", () => {
      const { container } = render(
        <RepoTaskRow
          repo={makeRepo({
            ungroomedTasks: [{ slug: "fix-bug", description: "Fix the bug" }],
          })}
          mode="init"
          headlessSessions={[]}
          {...defaultProps}
        />
      );
      fireEvent.click(container.querySelector(".repo-task-row")!);
      expect(screen.getByText("fix-bug: Fix the bug")).toBeTruthy();
    });

    it("displays formal task as slug: description", () => {
      const { container } = render(
        <RepoTaskRow
          repo={makeRepo({
            ungroomedTasks: [{ slug: "add-feature", description: "Add the new feature" }],
          })}
          mode="init"
          headlessSessions={[]}
          {...defaultProps}
        />
      );
      fireEvent.click(container.querySelector(".repo-task-row")!);
      expect(screen.getByText("add-feature: Add the new feature")).toBeTruthy();
    });

    it("displays informal task as raw description without colon prefix", () => {
      const { container } = render(
        <RepoTaskRow
          repo={makeRepo({
            ungroomedTasks: [{ slug: "", description: "some raw brain dump text" }],
          })}
          mode="init"
          headlessSessions={[]}
          {...defaultProps}
        />
      );
      fireEvent.click(container.querySelector(".repo-task-row")!);
      expect(screen.getByText("some raw brain dump text")).toBeTruthy();
      // Ensure no colon prefix appears (slug is empty, so no ":" should be rendered)
      expect(screen.queryByText(": some raw brain dump text")).toBeNull();
    });

    it("renders task items with no action buttons", () => {
      const { container } = render(
        <RepoTaskRow
          repo={makeRepo({
            ungroomedTasks: [
              { slug: "fix-bug", description: "Fix the bug" },
              { slug: "", description: "brain dump idea" },
            ],
          })}
          mode="init"
          headlessSessions={[]}
          {...defaultProps}
        />
      );
      fireEvent.click(container.querySelector(".repo-task-row")!);
      // Task items use class "queued" -- select those elements
      const queuedItems = container.querySelectorAll(".repo-task-row-session.queued");
      expect(queuedItems).toHaveLength(2);
      // Verify no action buttons exist within task item rows
      for (const item of queuedItems) {
        expect(item.querySelector(".repo-task-row-session-actions")).toBeNull();
        expect(item.querySelector("button")).toBeNull();
      }
    });

    it("renders task items after sessions in DOM order", () => {
      const { container } = render(
        <RepoTaskRow
          repo={makeRepo({
            ungroomedTasks: [{ slug: "queued-task", description: "Waiting in queue" }],
          })}
          mode="init"
          headlessSessions={[makeSession({ terminalId: "term-1", label: "init-tasks -- my-project" })]}
          {...defaultProps}
        />
      );
      fireEvent.click(container.querySelector(".repo-task-row")!);
      // All session-level rows (both active sessions and task items)
      const allRows = container.querySelectorAll(".repo-task-row-session");
      expect(allRows.length).toBeGreaterThanOrEqual(2);
      // The last row should be the queued task item
      const lastRow = allRows[allRows.length - 1];
      expect(lastRow.classList.contains("queued")).toBe(true);
      expect(lastRow.textContent).toContain("queued-task: Waiting in queue");
      // The first row should NOT be a queued task
      expect(allRows[0].classList.contains("queued")).toBe(false);
    });

    it("shows groomed tasks in code mode with slug only", () => {
      const { container } = render(
        <RepoTaskRow
          repo={makeRepo({
            groomedTasks: [{ slug: "refactor-api", description: "Refactor the API layer" }],
          })}
          mode="code"
          headlessSessions={[]}
          {...defaultProps}
        />
      );
      fireEvent.click(container.querySelector(".repo-task-row")!);
      // Code mode displays just the slug, not "slug: description"
      expect(screen.getByText("refactor-api")).toBeTruthy();
      expect(screen.queryByText("refactor-api: Refactor the API layer")).toBeNull();
    });

    it("does not show ungroomed tasks in code mode", () => {
      const { container } = render(
        <RepoTaskRow
          repo={makeRepo({
            ungroomedTasks: [{ slug: "fix-bug", description: "Fix the bug" }],
            groomedTasks: [],
          })}
          mode="code"
          headlessSessions={[]}
          {...defaultProps}
        />
      );
      // With no groomed tasks and no sessions, row should not be expandable
      expect(container.querySelector(".repo-task-row-chevron")).toBeNull();
    });

    it("does not make row expandable with empty task arrays and no sessions", () => {
      const { container } = render(
        <RepoTaskRow
          repo={makeRepo({
            ungroomedTasks: [],
          })}
          mode="init"
          headlessSessions={[]}
          {...defaultProps}
        />
      );
      expect(container.querySelector(".repo-task-row-chevron")).toBeNull();
      expect(container.querySelector(".repo-task-row")?.getAttribute("aria-expanded")).toBeNull();
    });

    it("collapses when tasks become empty via useEffect", () => {
      const { container, rerender } = render(
        <RepoTaskRow
          repo={makeRepo({
            ungroomedTasks: [{ slug: "fix-bug", description: "Fix the bug" }],
          })}
          mode="init"
          headlessSessions={[]}
          {...defaultProps}
        />
      );
      // Expand the row
      fireEvent.click(container.querySelector(".repo-task-row")!);
      expect(container.querySelector(".repo-task-row")?.getAttribute("aria-expanded")).toBe("true");

      // Re-render with empty tasks -- should collapse
      rerender(
        <RepoTaskRow
          repo={makeRepo({
            ungroomedTasks: [],
          })}
          mode="init"
          headlessSessions={[]}
          {...defaultProps}
        />
      );
      // Row should no longer be expanded (useEffect sets expanded=false when !isExpandable)
      expect(container.querySelector(".repo-task-row")?.getAttribute("aria-expanded")).toBeNull();
      expect(container.querySelector(".repo-task-row-chevron")).toBeNull();
    });

    describe("groomed task deduplication", () => {
      it("filters out groomed tasks with matching headless session slugs", () => {
        const { container } = render(
          <RepoTaskRow
            repo={makeRepo({
              groomedTasks: [{ slug: "fix-bug", description: "Fix the bug" }],
            })}
            mode="code"
            headlessSessions={[
              makeSession({ terminalId: "ht-1", label: "code -- my-project/fix-bug" }),
            ]}
            {...defaultProps}
          />
        );
        // Row has a session so it is expandable
        fireEvent.click(container.querySelector(".repo-task-row")!);
        // The groomed task should be filtered out because "fix-bug" matches the session slug
        const queuedItems = container.querySelectorAll(".repo-task-row-session.queued");
        expect(queuedItems).toHaveLength(0);
      });

      it("filters out groomed tasks with matching promoted session slugs", () => {
        const { container } = render(
          <RepoTaskRow
            repo={makeRepo({
              groomedTasks: [{ slug: "fix-bug", description: "Fix the bug" }],
            })}
            mode="code"
            headlessSessions={[]}
            repoTabs={[
              makePromotedTab({
                id: "tab-promoted-code",
                label: "code -- my-project/fix-bug",
                headlessTerminalId: "ht-promoted-code",
              }),
            ]}
            {...defaultProps}
          />
        );
        fireEvent.click(container.querySelector(".repo-task-row")!);
        // The groomed task should be filtered out because "fix-bug" matches the promoted session slug
        const queuedItems = container.querySelectorAll(".repo-task-row-session.queued");
        expect(queuedItems).toHaveLength(0);
      });

      it("shows groomed tasks that do not match any session slug", () => {
        const { container } = render(
          <RepoTaskRow
            repo={makeRepo({
              groomedTasks: [{ slug: "add-feature", description: "Add new feature" }],
            })}
            mode="code"
            headlessSessions={[
              makeSession({ terminalId: "ht-1", label: "code -- my-project/different-slug" }),
            ]}
            {...defaultProps}
          />
        );
        fireEvent.click(container.querySelector(".repo-task-row")!);
        // "add-feature" does not match "different-slug", so it should appear
        expect(screen.getByText("add-feature")).toBeTruthy();
        const queuedItems = container.querySelectorAll(".repo-task-row-session.queued");
        expect(queuedItems).toHaveLength(1);
      });

      it("filters matching tasks and keeps non-matching tasks", () => {
        const { container } = render(
          <RepoTaskRow
            repo={makeRepo({
              groomedTasks: [
                { slug: "fix-bug", description: "Fix the bug" },
                { slug: "add-feature", description: "Add new feature" },
                { slug: "refactor-api", description: "Refactor API" },
              ],
            })}
            mode="code"
            headlessSessions={[
              makeSession({ terminalId: "ht-1", label: "code -- my-project/fix-bug" }),
            ]}
            {...defaultProps}
          />
        );
        fireEvent.click(container.querySelector(".repo-task-row")!);
        // "fix-bug" is filtered out, "add-feature" and "refactor-api" remain
        const queuedItems = container.querySelectorAll(".repo-task-row-session.queued");
        expect(queuedItems).toHaveLength(2);
        expect(screen.getByText("add-feature")).toBeTruthy();
        expect(screen.getByText("refactor-api")).toBeTruthy();
        // "fix-bug" still appears in the session row (as extracted slug), but not in queued items
        for (const item of queuedItems) {
          expect(item.textContent).not.toContain("fix-bug");
        }
      });

      it("shows just slug in code mode (not slug: description)", () => {
        const { container } = render(
          <RepoTaskRow
            repo={makeRepo({
              groomedTasks: [{ slug: "refactor-api", description: "Refactor the API" }],
            })}
            mode="code"
            headlessSessions={[]}
            {...defaultProps}
          />
        );
        fireEvent.click(container.querySelector(".repo-task-row")!);
        // Code mode renders just the slug
        expect(screen.getByText("refactor-api")).toBeTruthy();
        expect(screen.queryByText("refactor-api: Refactor the API")).toBeNull();
      });

      it("shows description when slug is empty in code mode", () => {
        const { container } = render(
          <RepoTaskRow
            repo={makeRepo({
              groomedTasks: [{ slug: "", description: "some task without slug" }],
            })}
            mode="code"
            headlessSessions={[]}
            {...defaultProps}
          />
        );
        fireEvent.click(container.querySelector(".repo-task-row")!);
        // When slug is empty, code mode falls back to description
        expect(screen.getByText("some task without slug")).toBeTruthy();
      });

      it("shows slug: description format in init mode", () => {
        const { container } = render(
          <RepoTaskRow
            repo={makeRepo({
              ungroomedTasks: [{ slug: "my-slug", description: "My Description" }],
            })}
            mode="init"
            headlessSessions={[]}
            {...defaultProps}
          />
        );
        fireEvent.click(container.querySelector(".repo-task-row")!);
        // Init mode renders "slug: description"
        expect(screen.getByText("my-slug: My Description")).toBeTruthy();
      });

      it("deduplicates using both promoted and headless sessions simultaneously", () => {
        const { container } = render(
          <RepoTaskRow
            repo={makeRepo({
              groomedTasks: [
                { slug: "task-a", description: "Task A" },
                { slug: "task-b", description: "Task B" },
                { slug: "task-c", description: "Task C" },
              ],
            })}
            mode="code"
            headlessSessions={[
              makeSession({ terminalId: "ht-1", label: "code -- my-project/task-a" }),
            ]}
            repoTabs={[
              makePromotedTab({
                id: "tab-promoted-b",
                label: "code -- my-project/task-b",
                headlessTerminalId: "ht-promoted-b",
              }),
            ]}
            {...defaultProps}
          />
        );
        fireEvent.click(container.querySelector(".repo-task-row")!);
        // "task-a" matched by headless session, "task-b" matched by promoted session
        // Only "task-c" should remain as a queued task item
        const queuedItems = container.querySelectorAll(".repo-task-row-session.queued");
        expect(queuedItems).toHaveLength(1);
        expect(screen.getByText("task-c")).toBeTruthy();
        // Verify the filtered slugs do not appear as queued items
        // (they may appear as session rows, so check specifically within queued items)
        for (const item of queuedItems) {
          expect(item.textContent).not.toContain("task-a");
          expect(item.textContent).not.toContain("task-b");
        }
      });

      it("does not deduplicate in init mode even if session slugs match", () => {
        const { container } = render(
          <RepoTaskRow
            repo={makeRepo({
              ungroomedTasks: [
                { slug: "fix-bug", description: "Fix the bug" },
                { slug: "other-task", description: "Other task" },
              ],
            })}
            mode="init"
            headlessSessions={[
              makeSession({ terminalId: "ht-1", label: "init-tasks -- my-project/fix-bug" }),
            ]}
            {...defaultProps}
          />
        );
        fireEvent.click(container.querySelector(".repo-task-row")!);
        // Init mode returns ungroomedTasks directly without filtering
        const queuedItems = container.querySelectorAll(".repo-task-row-session.queued");
        expect(queuedItems).toHaveLength(2);
        expect(screen.getByText("fix-bug: Fix the bug")).toBeTruthy();
        expect(screen.getByText("other-task: Other task")).toBeTruthy();
      });
    });
  });

  describe("onStartTask (individual task start button)", () => {
    it("renders Start button for code mode tasks with slugs when onStartTask is provided", () => {
      const onStartTask = vi.fn();
      const { container } = render(
        <RepoTaskRow
          repo={makeRepo({
            groomedCount: 2,
            groomedTasks: [
              { slug: "add-feature", description: "Add feature" },
              { slug: "fix-bug", description: "Fix bug" },
            ],
          })}
          mode="code"
          headlessSessions={[]}
          {...defaultProps}
          onStartTask={onStartTask}
        />
      );
      // Expand the row to reveal task items
      fireEvent.click(container.querySelector(".repo-task-row")!);

      // Each queued task item should have a Start button
      const queuedItems = container.querySelectorAll(".repo-task-row-session.queued");
      expect(queuedItems).toHaveLength(2);
      for (const item of queuedItems) {
        const btn = item.querySelector("button");
        expect(btn).toBeTruthy();
        expect(btn!.textContent).toBe("Start");
      }
    });

    it("does not render Start button in init mode even when onStartTask is provided", () => {
      const onStartTask = vi.fn();
      const { container } = render(
        <RepoTaskRow
          repo={makeRepo({
            ungroomedCount: 2,
            ungroomedTasks: [
              { slug: "task-a", description: "Task A" },
              { slug: "task-b", description: "Task B" },
            ],
          })}
          mode="init"
          headlessSessions={[]}
          {...defaultProps}
          onStartTask={onStartTask}
        />
      );
      // Expand the row
      fireEvent.click(container.querySelector(".repo-task-row")!);

      // Init button may appear in the row header, but no per-task Start buttons in the expanded items
      const queuedItems = container.querySelectorAll(".repo-task-row-session.queued");
      expect(queuedItems.length).toBeGreaterThan(0);
      for (const item of queuedItems) {
        const buttons = item.querySelectorAll("button");
        for (const btn of buttons) {
          expect(btn.textContent).not.toBe("Start");
        }
      }
    });

    it("does not render Start button when onStartTask is not provided", () => {
      const { container } = render(
        <RepoTaskRow
          repo={makeRepo({
            groomedCount: 2,
            groomedTasks: [
              { slug: "add-feature", description: "Add feature" },
              { slug: "fix-bug", description: "Fix bug" },
            ],
          })}
          mode="code"
          headlessSessions={[]}
          {...defaultProps}
          // onStartTask is NOT provided
        />
      );
      // Expand the row
      fireEvent.click(container.querySelector(".repo-task-row")!);

      const queuedItems = container.querySelectorAll(".repo-task-row-session.queued");
      expect(queuedItems.length).toBeGreaterThan(0);
      for (const item of queuedItems) {
        const buttons = item.querySelectorAll("button");
        expect(buttons).toHaveLength(0);
      }
    });

    it("does not render Start button for tasks without slugs", () => {
      const onStartTask = vi.fn();
      const { container } = render(
        <RepoTaskRow
          repo={makeRepo({
            groomedCount: 2,
            groomedTasks: [
              { slug: "", description: "A task without slug" },
              { slug: "has-slug", description: "A task with slug" },
            ],
          })}
          mode="code"
          headlessSessions={[]}
          {...defaultProps}
          onStartTask={onStartTask}
        />
      );
      // Expand the row
      fireEvent.click(container.querySelector(".repo-task-row")!);

      const queuedItems = container.querySelectorAll(".repo-task-row-session.queued");
      expect(queuedItems).toHaveLength(2);

      // First item (empty slug): no Start button
      const firstItemButtons = queuedItems[0].querySelectorAll("button");
      expect(firstItemButtons).toHaveLength(0);

      // Second item (has slug): has Start button
      const secondItemButtons = queuedItems[1].querySelectorAll("button");
      expect(secondItemButtons).toHaveLength(1);
      expect(secondItemButtons[0].textContent).toBe("Start");
    });

    it("calls onStartTask with correct arguments when Start button is clicked", () => {
      const onStartTask = vi.fn();
      const { container } = render(
        <RepoTaskRow
          repo={makeRepo({
            name: "my-project",
            path: "/home/user/my-project",
            groomedCount: 1,
            groomedTasks: [
              { slug: "add-feature", description: "Add feature" },
            ],
          })}
          mode="code"
          headlessSessions={[]}
          {...defaultProps}
          onStartTask={onStartTask}
        />
      );
      // Expand the row
      fireEvent.click(container.querySelector(".repo-task-row")!);

      const queuedItems = container.querySelectorAll(".repo-task-row-session.queued");
      expect(queuedItems).toHaveLength(1);

      const startBtn = queuedItems[0].querySelector("button")!;
      expect(startBtn.textContent).toBe("Start");
      fireEvent.click(startBtn);

      expect(onStartTask).toHaveBeenCalledTimes(1);
      // Signature now includes (tier, mode); both are undefined/null when the task has no [code]/[debug]/etc tag.
      expect(onStartTask).toHaveBeenCalledWith(
        "/home/user/my-project",
        "my-project",
        "add-feature",
        undefined,
        null,
      );
    });
  });

  describe("per-task action buttons by mode", () => {
    it("renders 'Walk through' button for [manual] tasks and calls onWalkThroughTask", () => {
      const onWalkThroughTask = vi.fn();
      const onStartTask = vi.fn();
      const { container } = render(
        <RepoTaskRow
          repo={makeRepo({
            groomedCount: 1,
            groomedTasks: [
              { slug: "shave-yak", description: "Shave the yak", mode: "manual" },
            ],
          })}
          mode="code"
          headlessSessions={[]}
          {...defaultProps}
          onStartTask={onStartTask}
          onWalkThroughTask={onWalkThroughTask}
        />
      );
      fireEvent.click(container.querySelector(".repo-task-row")!);
      const btn = container.querySelector(".repo-task-row-session.queued button")!;
      expect(btn.textContent).toBe("Walk through");
      fireEvent.click(btn);
      expect(onWalkThroughTask).toHaveBeenCalledTimes(1);
      expect(onWalkThroughTask).toHaveBeenCalledWith(
        "/home/user/my-project",
        "my-project",
        "shave-yak",
      );
      expect(onStartTask).not.toHaveBeenCalled();
    });

    it("renders 'Debug' button for [debug] tasks and calls onStartTask with mode=debug", () => {
      const onStartTask = vi.fn();
      const { container } = render(
        <RepoTaskRow
          repo={makeRepo({
            groomedCount: 1,
            groomedTasks: [
              { slug: "fix-flaky", description: "Fix flaky test", mode: "debug" },
            ],
          })}
          mode="code"
          headlessSessions={[]}
          {...defaultProps}
          onStartTask={onStartTask}
        />
      );
      fireEvent.click(container.querySelector(".repo-task-row")!);
      const btn = container.querySelector(".repo-task-row-session.queued button")!;
      expect(btn.textContent).toBe("Debug");
      fireEvent.click(btn);
      expect(onStartTask).toHaveBeenCalledWith(
        "/home/user/my-project",
        "my-project",
        "fix-flaky",
        undefined,
        "debug",
      );
    });

    it("renders 'Start' button for [reggie-system] tasks and calls onStartTask with mode=reggie-system", () => {
      const onStartTask = vi.fn();
      const { container } = render(
        <RepoTaskRow
          repo={makeRepo({
            groomedCount: 1,
            groomedTasks: [
              { slug: "rotate-keys", description: "Rotate keys", mode: "reggie-system" },
            ],
          })}
          mode="code"
          headlessSessions={[]}
          {...defaultProps}
          onStartTask={onStartTask}
        />
      );
      fireEvent.click(container.querySelector(".repo-task-row")!);
      const btn = container.querySelector(".repo-task-row-session.queued button")!;
      expect(btn.textContent).toBe("Start");
      fireEvent.click(btn);
      expect(onStartTask).toHaveBeenCalledWith(
        "/home/user/my-project",
        "my-project",
        "rotate-keys",
        undefined,
        "reggie-system",
      );
    });

    it("renders 'Start' button for [code] tasks and calls onStartTask with mode=code", () => {
      const onStartTask = vi.fn();
      const { container } = render(
        <RepoTaskRow
          repo={makeRepo({
            groomedCount: 1,
            groomedTasks: [
              { slug: "add-thing", description: "Add thing", mode: "code" },
            ],
          })}
          mode="code"
          headlessSessions={[]}
          {...defaultProps}
          onStartTask={onStartTask}
        />
      );
      fireEvent.click(container.querySelector(".repo-task-row")!);
      const btn = container.querySelector(".repo-task-row-session.queued button")!;
      expect(btn.textContent).toBe("Start");
      fireEvent.click(btn);
      expect(onStartTask).toHaveBeenCalledWith(
        "/home/user/my-project",
        "my-project",
        "add-thing",
        undefined,
        "code",
      );
    });

    it("does not render Walk-through button for manual task when onWalkThroughTask is missing", () => {
      const { container } = render(
        <RepoTaskRow
          repo={makeRepo({
            groomedCount: 1,
            groomedTasks: [
              { slug: "manual-only", description: "Manual only", mode: "manual" },
            ],
          })}
          mode="code"
          headlessSessions={[]}
          {...defaultProps}
          onStartTask={vi.fn()}
        />
      );
      fireEvent.click(container.querySelector(".repo-task-row")!);
      const queued = container.querySelectorAll(".repo-task-row-session.queued");
      expect(queued).toHaveLength(1);
      expect(queued[0].querySelector("button")).toBeNull();
    });
  });

  describe("per-domain aggregate badges", () => {
    it("counts code, reggie-sys, and debug running sessions separately", () => {
      const sessions = [
        makeSession({ terminalId: "t1", label: "code -- my-project/task-a" }),
        makeSession({ terminalId: "t2", label: "code -- my-project/task-b" }),
        makeSession({ terminalId: "t3", label: "reggie-sys -- my-project/task-c" }),
        makeSession({ terminalId: "t4", label: "debug -- my-project/task-d" }),
        makeSession({ terminalId: "t5", label: "debug -- my-project/task-e" }),
        makeSession({ terminalId: "t6", label: "debug -- my-project/task-f" }),
        makeSession({ terminalId: "t7", label: "code -- my-project/task-g", completed: true }),
      ];
      render(
        <RepoTaskRow
          repo={makeRepo()}
          mode="code"
          headlessSessions={sessions}
          {...defaultProps}
        />
      );
      expect(screen.getByText("2 code running")).toBeTruthy();
      expect(screen.getByText("1 reggie-sys running")).toBeTruthy();
      expect(screen.getByText("3 debug running")).toBeTruthy();
      expect(screen.getByText("1 completed")).toBeTruthy();
    });

    it("does not render a per-domain badge when the count is zero", () => {
      const sessions = [
        makeSession({ terminalId: "t1", label: "code -- my-project/task-a" }),
      ];
      render(
        <RepoTaskRow
          repo={makeRepo()}
          mode="code"
          headlessSessions={sessions}
          {...defaultProps}
        />
      );
      expect(screen.getByText("1 code running")).toBeTruthy();
      expect(screen.queryByText(/reggie-sys running/)).toBeNull();
      expect(screen.queryByText(/debug running/)).toBeNull();
    });

    it("init mode keeps a flat 'N running' badge (no per-domain split)", () => {
      // In init mode session labels are "init-tasks --" and the badge stays flat.
      const sessions = [
        makeSession({ terminalId: "t1", label: "init-tasks -- my-project" }),
        makeSession({ terminalId: "t2", label: "init-tasks -- my-project" }),
      ];
      render(
        <RepoTaskRow
          repo={makeRepo({ ungroomedCount: 5 })}
          mode="init"
          headlessSessions={sessions}
          {...defaultProps}
        />
      );
      expect(screen.getByText("2 running")).toBeTruthy();
      expect(screen.queryByText(/code running/)).toBeNull();
      expect(screen.queryByText(/reggie-sys running/)).toBeNull();
      expect(screen.queryByText(/debug running/)).toBeNull();
    });

    it("counts promoted reggie-sys and debug tabs in their per-domain badges", () => {
      // Promoted (visible) tabs with reggie-sys and debug labels must surface in the
      // per-domain badges via the generalized promotedSessions filter (isWorkflowLabel),
      // not just the unpromoted headless sessions list.
      const promoted = [
        makePromotedTab({
          id: "tab-rsys",
          label: "reggie-sys -- my-project/rotate-keys",
          headlessTerminalId: "ht-rsys",
        }),
        makePromotedTab({
          id: "tab-dbg",
          label: "debug -- my-project/fix-flaky",
          headlessTerminalId: "ht-dbg",
        }),
      ];
      render(
        <RepoTaskRow
          repo={makeRepo()}
          mode="code"
          headlessSessions={[]}
          repoTabs={promoted}
          {...defaultProps}
        />
      );
      expect(screen.getByText("1 reggie-sys running")).toBeTruthy();
      expect(screen.getByText("1 debug running")).toBeTruthy();
      expect(screen.queryByText(/code running/)).toBeNull();
    });

    it("counts dead promoted tabs as completed regardless of label domain", () => {
      const promoted = [
        makePromotedTab({
          id: "tab-rsys-dead",
          label: "reggie-sys -- my-project/rotate-keys",
          headlessTerminalId: "ht-rsys-dead",
          dead: true,
        }),
      ];
      render(
        <RepoTaskRow
          repo={makeRepo()}
          mode="code"
          headlessSessions={[]}
          repoTabs={promoted}
          {...defaultProps}
        />
      );
      expect(screen.getByText("1 completed")).toBeTruthy();
      expect(screen.queryByText(/reggie-sys running/)).toBeNull();
    });
  });

  describe("reggie-system deferred badge", () => {
    it("renders deferred badge with the holder repo name", () => {
      render(
        <RepoTaskRow
          repo={makeRepo({
            groomedCount: 1,
            groomedTasks: [
              { slug: "rotate-keys", description: "Rotate keys", mode: "reggie-system" },
            ],
          })}
          mode="code"
          headlessSessions={[]}
          {...defaultProps}
          reggieSystemDeferred={true}
          reggieSystemHolderName="repo-a"
        />
      );
      expect(
        screen.getByText("1 reggie-system task deferred — slot held by repo-a"),
      ).toBeTruthy();
    });

    it("does not render the deferred badge when reggieSystemDeferred is false", () => {
      render(
        <RepoTaskRow
          repo={makeRepo({
            groomedCount: 1,
            groomedTasks: [
              { slug: "rotate-keys", description: "Rotate keys", mode: "reggie-system" },
            ],
          })}
          mode="code"
          headlessSessions={[]}
          {...defaultProps}
          reggieSystemDeferred={false}
          reggieSystemHolderName={null}
        />
      );
      expect(screen.queryByText(/reggie-system task deferred/)).toBeNull();
    });
  });
});
