import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { RepoTaskRow } from "../WorkspaceOverview/RepoTaskRow";
import type { HeadlessSession, RepoTaskSummary } from "../../types/terminal";

const makeRepo = (overrides?: Partial<RepoTaskSummary>): RepoTaskSummary => ({
  name: "my-repo",
  path: "/home/user/my-repo",
  workspaceName: null,
  ungroomedCount: 3,
  groomedCount: 2,
  activeCount: 0,
  ...overrides,
});

const makeSession = (overrides?: Partial<HeadlessSession>): HeadlessSession => ({
  terminalId: "ht-1",
  projectPath: "/home/user/my-repo",
  projectName: "my-repo",
  label: "init-tasks -- my-repo",
  needsAttention: false,
  exited: false,
  exitCode: null,
  bufferSize: 0,
  completed: false,
  ...overrides,
});

const defaultProps = {
  repo: makeRepo(),
  mode: "init" as const,
  headlessSessions: [] as HeadlessSession[],
  onLaunchSession: vi.fn(),
  onOpenSession: vi.fn(),
};

describe("RepoTaskRow", () => {
  describe("kill button visibility", () => {
    it("shows kill button for a running single session when onKillSession is provided", () => {
      const onKillSession = vi.fn();
      const { container } = render(
        <RepoTaskRow
          {...defaultProps}
          headlessSessions={[makeSession()]}
          onKillSession={onKillSession}
        />
      );

      // Single sessions are now expandable -- expand to see session controls
      fireEvent.click(container.querySelector(".repo-task-row")!);

      expect(screen.getByTitle("Kill process")).toBeTruthy();
    });

    it("does not show kill button for an exited single session", () => {
      const onKillSession = vi.fn();
      const { container } = render(
        <RepoTaskRow
          {...defaultProps}
          headlessSessions={[makeSession({ exited: true, exitCode: 0 })]}
          onKillSession={onKillSession}
        />
      );

      fireEvent.click(container.querySelector(".repo-task-row")!);

      expect(screen.queryByTitle("Kill process")).toBeNull();
    });

    it("does not show kill button when onKillSession is not provided", () => {
      const { container } = render(
        <RepoTaskRow
          {...defaultProps}
          headlessSessions={[makeSession()]}
        />
      );

      fireEvent.click(container.querySelector(".repo-task-row")!);

      expect(screen.queryByTitle("Kill process")).toBeNull();
    });

    it("does not show kill button when there are no sessions", () => {
      const onKillSession = vi.fn();
      render(
        <RepoTaskRow
          {...defaultProps}
          headlessSessions={[]}
          onKillSession={onKillSession}
        />
      );

      expect(screen.queryByTitle("Kill process")).toBeNull();
    });
  });

  describe("kill button interaction", () => {
    it("calls onKillSession with the session terminalId when clicked", () => {
      const onKillSession = vi.fn();
      const { container } = render(
        <RepoTaskRow
          {...defaultProps}
          headlessSessions={[makeSession({ terminalId: "ht-42" })]}
          onKillSession={onKillSession}
        />
      );

      fireEvent.click(container.querySelector(".repo-task-row")!);
      fireEvent.click(screen.getByTitle("Kill process"));

      expect(onKillSession).toHaveBeenCalledWith("ht-42");
      expect(onKillSession).toHaveBeenCalledTimes(1);
    });

    it("kill button click does not trigger row expand or open", () => {
      const onOpenSession = vi.fn();
      const onKillSession = vi.fn();
      const { container } = render(
        <RepoTaskRow
          {...defaultProps}
          headlessSessions={[makeSession()]}
          onOpenSession={onOpenSession}
          onKillSession={onKillSession}
        />
      );

      // Expand to access kill button
      fireEvent.click(container.querySelector(".repo-task-row")!);
      fireEvent.click(screen.getByTitle("Kill process"));

      expect(onOpenSession).not.toHaveBeenCalled();
    });
  });

  describe("multi-session expanded kill buttons", () => {
    it("shows kill buttons for running sessions in expanded view, not for exited", () => {
      const onKillSession = vi.fn();
      const sessions = [
        makeSession({ terminalId: "ht-1", label: "code -- my-repo/task-a" }),
        makeSession({ terminalId: "ht-2", label: "code -- my-repo/task-b", exited: true, exitCode: 0 }),
      ];
      const { container } = render(
        <RepoTaskRow
          {...defaultProps}
          headlessSessions={sessions}
          onKillSession={onKillSession}
        />
      );

      // Expand the row (multi-session rows are expandable)
      const row = container.querySelector(".repo-task-row.expandable");
      expect(row).toBeTruthy();
      fireEvent.click(row!);

      // In expanded view, only the running session should have a kill button
      const killButtons = screen.getAllByTitle("Kill process");
      expect(killButtons).toHaveLength(1);
    });

    it("calls onKillSession with correct terminalId from expanded session row", () => {
      const onKillSession = vi.fn();
      const sessions = [
        makeSession({ terminalId: "ht-1", label: "code -- my-repo/task-a" }),
        makeSession({ terminalId: "ht-2", label: "code -- my-repo/task-b" }),
      ];
      const { container } = render(
        <RepoTaskRow
          {...defaultProps}
          headlessSessions={sessions}
          onKillSession={onKillSession}
        />
      );

      // Expand the row
      fireEvent.click(container.querySelector(".repo-task-row.expandable")!);

      // Both sessions are running, so both should have kill buttons
      const killButtons = screen.getAllByTitle("Kill process");
      expect(killButtons).toHaveLength(2);

      // Click the second kill button
      fireEvent.click(killButtons[1]);
      expect(onKillSession).toHaveBeenCalledWith("ht-2");
    });
  });

  describe("single session status and buttons", () => {
    it("shows 'Running' status for a running session in expanded view", () => {
      const { container } = render(
        <RepoTaskRow
          {...defaultProps}
          headlessSessions={[makeSession()]}
        />
      );

      // Collapsed shows aggregate badge
      expect(screen.getByText("1 running")).toBeTruthy();

      // Expand to see per-session status
      fireEvent.click(container.querySelector(".repo-task-row")!);
      expect(screen.getByText("Running")).toBeTruthy();
    });

    it("shows 'Exited' status for an exited session in expanded view", () => {
      const { container } = render(
        <RepoTaskRow
          {...defaultProps}
          headlessSessions={[makeSession({ exited: true, exitCode: 0 })]}
        />
      );

      fireEvent.click(container.querySelector(".repo-task-row")!);
      expect(screen.getByText("Exited")).toBeTruthy();
    });

    it("shows 'Needs Attention' status for an attention session in expanded view", () => {
      const { container } = render(
        <RepoTaskRow
          {...defaultProps}
          headlessSessions={[makeSession({ needsAttention: true })]}
        />
      );

      fireEvent.click(container.querySelector(".repo-task-row")!);
      expect(screen.getByText("Needs Attention")).toBeTruthy();
    });

    it("shows Open button for running session and View button for exited session in expanded view", () => {
      const { container, rerender } = render(
        <RepoTaskRow
          {...defaultProps}
          headlessSessions={[makeSession()]}
        />
      );

      fireEvent.click(container.querySelector(".repo-task-row")!);
      expect(screen.getByText("Open")).toBeTruthy();
      expect(screen.queryByText("View")).toBeNull();

      rerender(
        <RepoTaskRow
          {...defaultProps}
          headlessSessions={[makeSession({ exited: true, exitCode: 0 })]}
        />
      );

      // After rerender with exited session, row is still expanded
      expect(screen.getByText("View")).toBeTruthy();
      expect(screen.queryByText("Open")).toBeNull();
    });

    it("shows Dismiss button for exited session when onDismissSession is provided", () => {
      const onDismissSession = vi.fn();
      const { container } = render(
        <RepoTaskRow
          {...defaultProps}
          headlessSessions={[makeSession({ exited: true, exitCode: 0 })]}
          onDismissSession={onDismissSession}
        />
      );

      fireEvent.click(container.querySelector(".repo-task-row")!);
      expect(screen.getByTitle("Dismiss completed session")).toBeTruthy();
    });

    it("does not show Dismiss button for running session", () => {
      const onDismissSession = vi.fn();
      const { container } = render(
        <RepoTaskRow
          {...defaultProps}
          headlessSessions={[makeSession()]}
          onDismissSession={onDismissSession}
        />
      );

      fireEvent.click(container.querySelector(".repo-task-row")!);
      expect(screen.queryByTitle("Dismiss completed session")).toBeNull();
    });
  });

  describe("no sessions", () => {
    it("shows launch button when tasks remain and no sessions", () => {
      render(<RepoTaskRow {...defaultProps} />);

      expect(screen.getByText("Init")).toBeTruthy();
    });

    it("shows Start button in code mode", () => {
      render(
        <RepoTaskRow
          {...defaultProps}
          mode="code"
        />
      );

      expect(screen.getByText("Start")).toBeTruthy();
    });

    it("shows Done status when count is 0 and no sessions", () => {
      render(
        <RepoTaskRow
          {...defaultProps}
          repo={makeRepo({ ungroomedCount: 0 })}
        />
      );

      expect(screen.getByText("Done")).toBeTruthy();
    });

    it("calls onLaunchSession with repo path and name when launch button clicked", () => {
      const onLaunchSession = vi.fn();
      render(
        <RepoTaskRow
          {...defaultProps}
          repo={makeRepo({ name: "test-repo", path: "/path/to/test-repo" })}
          onLaunchSession={onLaunchSession}
        />
      );

      fireEvent.click(screen.getByText("Init"));

      expect(onLaunchSession).toHaveBeenCalledWith("/path/to/test-repo", "test-repo");
    });
  });

  describe("completed sessions", () => {
    it("shows Completed badge for completed single session in expanded view", () => {
      const { container } = render(
        <RepoTaskRow
          {...defaultProps}
          headlessSessions={[makeSession({ completed: true })]}
        />
      );

      // Collapsed: aggregate badge
      expect(screen.getByText("1 completed")).toBeTruthy();

      // Expand to see per-session badge
      fireEvent.click(container.querySelector(".repo-task-row")!);
      const completedBadges = container.querySelectorAll(".session-completed-badge.small");
      expect(completedBadges).toHaveLength(1);
      // Should not show Running, Exited, or Needs Attention in expanded view
      expect(screen.queryByText("Running")).toBeNull();
      expect(screen.queryByText("Exited")).toBeNull();
      expect(screen.queryByText("Needs Attention")).toBeNull();
    });

    it("shows Trash button for completed single session when onTrashSession provided", () => {
      const onTrashSession = vi.fn();
      const { container } = render(
        <RepoTaskRow
          {...defaultProps}
          headlessSessions={[makeSession({ completed: true })]}
          onTrashSession={onTrashSession}
        />
      );

      fireEvent.click(container.querySelector(".repo-task-row")!);
      expect(screen.getByTitle("Trash completed session")).toBeTruthy();
    });

    it("does not show Trash button for non-completed sessions", () => {
      const onTrashSession = vi.fn();
      const { container } = render(
        <RepoTaskRow
          {...defaultProps}
          headlessSessions={[makeSession({ completed: false })]}
          onTrashSession={onTrashSession}
        />
      );

      fireEvent.click(container.querySelector(".repo-task-row")!);
      expect(screen.queryByTitle("Trash completed session")).toBeNull();
    });

    it("does not show Trash button when onTrashSession is not provided", () => {
      const { container } = render(
        <RepoTaskRow
          {...defaultProps}
          headlessSessions={[makeSession({ completed: true })]}
        />
      );

      fireEvent.click(container.querySelector(".repo-task-row")!);
      expect(screen.queryByTitle("Trash completed session")).toBeNull();
    });

    it("calls onTrashSession with terminalId when Trash button clicked", () => {
      const onTrashSession = vi.fn();
      const { container } = render(
        <RepoTaskRow
          {...defaultProps}
          headlessSessions={[makeSession({ terminalId: "ht-done", completed: true })]}
          onTrashSession={onTrashSession}
        />
      );

      fireEvent.click(container.querySelector(".repo-task-row")!);
      fireEvent.click(screen.getByTitle("Trash completed session"));

      expect(onTrashSession).toHaveBeenCalledWith("ht-done");
      expect(onTrashSession).toHaveBeenCalledTimes(1);
    });

    it("shows completed count in aggregate badges for multi-session", () => {
      const sessions = [
        makeSession({ terminalId: "term-1", label: "code -- repo/task-a", completed: false }),
        makeSession({ terminalId: "term-2", label: "code -- repo/task-b", completed: true }),
      ];
      render(
        <RepoTaskRow
          {...defaultProps}
          mode="code"
          headlessSessions={sessions}
        />
      );

      expect(screen.getByText("1 running")).toBeTruthy();
      expect(screen.getByText("1 completed")).toBeTruthy();
    });

    it("does not show Dismiss button for completed single session (only Trash)", () => {
      const onDismissSession = vi.fn();
      const onTrashSession = vi.fn();
      const { container } = render(
        <RepoTaskRow
          {...defaultProps}
          headlessSessions={[makeSession({ completed: true, exited: false })]}
          onDismissSession={onDismissSession}
          onTrashSession={onTrashSession}
        />
      );

      fireEvent.click(container.querySelector(".repo-task-row")!);

      // Trash should show, Dismiss should not
      expect(screen.getByTitle("Trash completed session")).toBeTruthy();
      expect(screen.queryByTitle("Dismiss completed session")).toBeNull();
    });

    it("shows Trash button for completed session in expanded multi-session view", () => {
      const onTrashSession = vi.fn();
      const sessions = [
        makeSession({ terminalId: "term-1", label: "code -- repo/task-a", completed: true }),
        makeSession({ terminalId: "term-2", label: "code -- repo/task-b", completed: false }),
      ];
      const { container } = render(
        <RepoTaskRow
          {...defaultProps}
          mode="code"
          headlessSessions={sessions}
          onTrashSession={onTrashSession}
        />
      );

      // Expand
      fireEvent.click(container.querySelector(".repo-task-row")!);

      // Only one Trash button -- for the completed session
      const trashButtons = screen.getAllByTitle("Trash completed session");
      expect(trashButtons).toHaveLength(1);
    });

    it("calls onTrashSession with correct terminalId from expanded session Trash button", () => {
      const onTrashSession = vi.fn();
      const sessions = [
        makeSession({ terminalId: "term-1", label: "code -- repo/task-a", completed: true }),
        makeSession({ terminalId: "term-2", label: "code -- repo/task-b", completed: true }),
      ];
      const { container } = render(
        <RepoTaskRow
          {...defaultProps}
          mode="code"
          headlessSessions={sessions}
          onTrashSession={onTrashSession}
        />
      );

      fireEvent.click(container.querySelector(".repo-task-row")!);

      const trashButtons = screen.getAllByTitle("Trash completed session");
      fireEvent.click(trashButtons[1]);
      expect(onTrashSession).toHaveBeenCalledWith("term-2");
    });

    it("shows View button for completed+exited single session", () => {
      const { container } = render(
        <RepoTaskRow
          {...defaultProps}
          headlessSessions={[makeSession({ completed: true, exited: true })]}
        />
      );

      fireEvent.click(container.querySelector(".repo-task-row")!);
      expect(screen.getByText("View")).toBeTruthy();
    });
  });
});
