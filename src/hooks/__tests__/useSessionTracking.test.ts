import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { mockInvoke, mockListen, resetTauriMocks } from "../../__test-utils__/tauri-mock";
import { useSessionTracking } from "../useSessionTracking";
import type { HeadlessSession, TerminalTab, RepoTaskSummary } from "../../types/terminal";

// --- Factories ---

function makeHeadlessSession(overrides: Partial<HeadlessSession> = {}): HeadlessSession {
  return {
    terminalId: "hs-1",
    projectPath: "/projects/repo-a",
    projectName: "repo-a",
    label: "code -- repo-a/task-1",
    needsAttention: false,
    exited: false,
    exitCode: null,
    bufferSize: 0,
    completed: false,
    ...overrides,
  };
}

function makeTerminalTab(overrides: Partial<TerminalTab> = {}): TerminalTab {
  return {
    id: "tab-1",
    terminalId: "term-1",
    label: "claude session",
    isClaudeSession: true,
    projectPath: "/projects/repo-a",
    projectName: "repo-a",
    ...overrides,
  };
}

function makeRepoTaskSummary(overrides: Partial<RepoTaskSummary> = {}): RepoTaskSummary {
  return {
    name: "repo-a",
    path: "/projects/repo-a",
    workspaceName: null,
    ungroomedCount: 0,
    groomedCount: 3,
    activeCount: 1,
    ...overrides,
  };
}

// --- Tests ---

/**
 * Count of `scan_tasks_across_repos` invoke calls.
 *
 * Use this instead of `mockInvoke.mock.calls.length` whenever you care about
 * how many times the hook *fetched task data*. The hook also invokes
 * `start_tasks_md_watch` / `stop_tasks_md_watch` as part of the watcher
 * lifecycle, and those calls would otherwise inflate the count and break
 * brittle assertions like `toHaveBeenCalledTimes(1)`.
 */
function scanCallCount(): number {
  return mockInvoke.mock.calls.filter((c) => c[0] === "scan_tasks_across_repos")
    .length;
}

beforeEach(() => {
  resetTauriMocks();
});

describe("useSessionTracking", () => {
  describe("initial load", () => {
    it("calls scan_tasks_across_repos with the activeLevelPath", async () => {
      mockInvoke.mockResolvedValue([]);

      renderHook(() =>
        useSessionTracking([], [], "/projects")
      );

      expect(mockInvoke).toHaveBeenCalledWith("scan_tasks_across_repos", {
        folderPath: "/projects",
      });
    });

    it("does not fetch or invoke watcher IPC when activeLevelPath is null", () => {
      renderHook(() => useSessionTracking([], [], null));

      // No task scan, and the gated watcher must not invoke start/stop when
      // no watcher was ever started.
      expect(scanCallCount()).toBe(0);
      const watcherCalls = mockInvoke.mock.calls.filter(
        (c) => c[0] === "start_tasks_md_watch" || c[0] === "stop_tasks_md_watch"
      );
      expect(watcherCalls).toHaveLength(0);
    });

    it("invokes exactly 1 start + 1 stop across null → path → unmount", async () => {
      mockInvoke.mockImplementation((cmd: string) => {
        if (cmd === "scan_tasks_across_repos") return Promise.resolve([]);
        return Promise.resolve();
      });

      const { rerender, unmount } = renderHook(
        ({ path }: { path: string | null }) => useSessionTracking([], [], path),
        { initialProps: { path: null as string | null } }
      );

      // Transition null → path: should produce exactly 1 start, 0 stop.
      await act(async () => {
        rerender({ path: "/projects" });
      });

      await waitFor(() => {
        const startCalls = mockInvoke.mock.calls.filter(
          (c) => c[0] === "start_tasks_md_watch"
        );
        expect(startCalls).toHaveLength(1);
      });

      // Unmount: should produce exactly 1 stop.
      unmount();

      await waitFor(() => {
        const stopCalls = mockInvoke.mock.calls.filter(
          (c) => c[0] === "stop_tasks_md_watch"
        );
        expect(stopCalls).toHaveLength(1);
      });

      const startCalls = mockInvoke.mock.calls.filter(
        (c) => c[0] === "start_tasks_md_watch"
      );
      expect(startCalls).toHaveLength(1);
    });

    it("returns empty repos and zero summary when activeLevelPath is null", async () => {
      const { result } = renderHook(() => useSessionTracking([], [], null));

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current.repos).toEqual([]);
      expect(result.current.summary).toEqual({
        totalRunning: 0,
        totalNeedsAttention: 0,
        totalDone: 0,
        totalGroomed: 0,
      });
    });

    it("sets loading to false after fetch completes", async () => {
      mockInvoke.mockResolvedValue([makeRepoTaskSummary()]);

      const { result } = renderHook(() =>
        useSessionTracking([], [], "/projects")
      );

      expect(result.current.loading).toBe(true);

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });
    });

    it("sets loading to false and returns empty repos on fetch error", async () => {
      mockInvoke.mockRejectedValue(new Error("scan failed"));

      const { result } = renderHook(() =>
        useSessionTracking([], [], "/projects")
      );

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current.repos).toEqual([]);
    });
  });

  describe("merging task data with sessions", () => {
    it("returns repos with task counts from scan results", async () => {
      const repo = makeRepoTaskSummary({
        groomedCount: 5,
        ungroomedCount: 2,
        activeCount: 1,
      });
      mockInvoke.mockResolvedValue([repo]);

      const { result } = renderHook(() =>
        useSessionTracking([], [], "/projects")
      );

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current.repos).toHaveLength(1);
      expect(result.current.repos[0].groomedTasks).toBe(5);
      expect(result.current.repos[0].ungroomedTasks).toBe(2);
      expect(result.current.repos[0].activeTasks).toBe(1);
    });

    it("attaches headless sessions to matching repos", async () => {
      const repo = makeRepoTaskSummary({ path: "/projects/repo-a" });
      mockInvoke.mockResolvedValue([repo]);

      const hs = makeHeadlessSession({
        terminalId: "hs-1",
        projectPath: "/projects/repo-a",
        label: "code -- repo-a/slug",
      });

      const { result } = renderHook(() =>
        useSessionTracking([hs], [], "/projects")
      );

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current.repos[0].sessions).toHaveLength(1);
      expect(result.current.repos[0].sessions[0]).toEqual({
        terminalId: "hs-1",
        label: "code -- repo-a/slug",
        agentNumber: 1,
        status: "running",
        isHeadless: true,
      });
    });

    it("attaches visible Claude sessions to matching repos", async () => {
      const repo = makeRepoTaskSummary({ path: "/projects/repo-a" });
      mockInvoke.mockResolvedValue([repo]);

      const tab = makeTerminalTab({
        terminalId: "term-1",
        projectPath: "/projects/repo-a",
        isClaudeSession: true,
        label: "claude",
      });

      const { result } = renderHook(() =>
        useSessionTracking([], [tab], "/projects")
      );

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current.repos[0].sessions).toHaveLength(1);
      expect(result.current.repos[0].sessions[0].isHeadless).toBe(false);
      expect(result.current.repos[0].sessions[0].terminalId).toBe("term-1");
    });

    it("assigns sequential agent numbers across headless and visible sessions", async () => {
      const repo = makeRepoTaskSummary({ path: "/projects/repo-a" });
      mockInvoke.mockResolvedValue([repo]);

      const hs1 = makeHeadlessSession({
        terminalId: "hs-1",
        projectPath: "/projects/repo-a",
      });
      const hs2 = makeHeadlessSession({
        terminalId: "hs-2",
        projectPath: "/projects/repo-a",
      });
      const tab = makeTerminalTab({
        id: "tab-3",
        terminalId: "term-3",
        projectPath: "/projects/repo-a",
        isClaudeSession: true,
      });

      const { result } = renderHook(() =>
        useSessionTracking([hs1, hs2], [tab], "/projects")
      );

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      const sessions = result.current.repos[0].sessions;
      expect(sessions).toHaveLength(3);
      expect(sessions[0].agentNumber).toBe(1);
      expect(sessions[1].agentNumber).toBe(2);
      expect(sessions[2].agentNumber).toBe(3);
    });

    it("skips promoted headless tabs to avoid double-counting", async () => {
      const repo = makeRepoTaskSummary({ path: "/projects/repo-a" });
      mockInvoke.mockResolvedValue([repo]);

      const hs = makeHeadlessSession({
        terminalId: "hs-1",
        projectPath: "/projects/repo-a",
      });
      // This tab was promoted from hs-1
      const promotedTab = makeTerminalTab({
        id: "tab-promoted",
        terminalId: "term-promoted",
        projectPath: "/projects/repo-a",
        isClaudeSession: true,
        isHeadlessPromoted: true,
        headlessTerminalId: "hs-1",
      });

      const { result } = renderHook(() =>
        useSessionTracking([hs], [promotedTab], "/projects")
      );

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      // Only the headless session should appear, not the promoted tab
      expect(result.current.repos[0].sessions).toHaveLength(1);
      expect(result.current.repos[0].sessions[0].terminalId).toBe("hs-1");
    });

    it("falls back to tab.id when terminalId is null", async () => {
      const repo = makeRepoTaskSummary({ path: "/projects/repo-a" });
      mockInvoke.mockResolvedValue([repo]);

      const tab = makeTerminalTab({
        id: "fallback-id",
        terminalId: null,
        projectPath: "/projects/repo-a",
        isClaudeSession: true,
      });

      const { result } = renderHook(() =>
        useSessionTracking([], [tab], "/projects")
      );

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current.repos[0].sessions[0].terminalId).toBe("fallback-id");
    });

    it("ignores non-Claude terminal tabs", async () => {
      const repo = makeRepoTaskSummary({ path: "/projects/repo-a" });
      mockInvoke.mockResolvedValue([repo]);

      const shellTab = makeTerminalTab({
        projectPath: "/projects/repo-a",
        isClaudeSession: false,
      });

      const { result } = renderHook(() =>
        useSessionTracking([], [shellTab], "/projects")
      );

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current.repos[0].sessions).toHaveLength(0);
    });
  });

  describe("extra repos (sessions without TASKS.md)", () => {
    it("creates extra repos for headless sessions not in task scan results", async () => {
      mockInvoke.mockResolvedValue([]); // no repos from scan

      const hs = makeHeadlessSession({
        terminalId: "hs-extra",
        projectPath: "/projects/unknown-repo",
        projectName: "unknown-repo",
      });

      const { result } = renderHook(() =>
        useSessionTracking([hs], [], "/projects")
      );

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current.repos).toHaveLength(1);
      expect(result.current.repos[0].repoName).toBe("unknown-repo");
      expect(result.current.repos[0].groomedTasks).toBe(0);
      expect(result.current.repos[0].sessions).toHaveLength(1);
    });

    it("creates extra repos for visible Claude tabs not in task scan results", async () => {
      mockInvoke.mockResolvedValue([]);

      const tab = makeTerminalTab({
        projectPath: "/projects/extra",
        projectName: "extra",
        isClaudeSession: true,
      });

      const { result } = renderHook(() =>
        useSessionTracking([], [tab], "/projects")
      );

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current.repos).toHaveLength(1);
      expect(result.current.repos[0].repoName).toBe("extra");
    });

    it("groups multiple headless sessions under the same extra repo with sequential agent numbers", async () => {
      mockInvoke.mockResolvedValue([]);

      const hs1 = makeHeadlessSession({
        terminalId: "hs-e1",
        projectPath: "/projects/extra",
        projectName: "extra",
      });
      const hs2 = makeHeadlessSession({
        terminalId: "hs-e2",
        projectPath: "/projects/extra",
        projectName: "extra",
        needsAttention: true,
      });

      const { result } = renderHook(() =>
        useSessionTracking([hs1, hs2], [], "/projects")
      );

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current.repos).toHaveLength(1);
      expect(result.current.repos[0].sessions).toHaveLength(2);
      expect(result.current.repos[0].sessions[0].agentNumber).toBe(1);
      expect(result.current.repos[0].sessions[1].agentNumber).toBe(2);
    });

    it("excludes non-Claude tabs from extra repos", async () => {
      mockInvoke.mockResolvedValue([]);

      const shellTab = makeTerminalTab({
        projectPath: "/projects/extra",
        projectName: "extra",
        isClaudeSession: false,
      });

      const { result } = renderHook(() =>
        useSessionTracking([], [shellTab], "/projects")
      );

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current.repos).toHaveLength(0);
    });

    it("skips promoted headless tabs in extra repos", async () => {
      mockInvoke.mockResolvedValue([]);

      const promotedTab = makeTerminalTab({
        projectPath: "/projects/extra",
        projectName: "extra",
        isClaudeSession: true,
        isHeadlessPromoted: true,
        headlessTerminalId: "hs-gone",
      });

      const { result } = renderHook(() =>
        useSessionTracking([], [promotedTab], "/projects")
      );

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      // Promoted tabs are unconditionally skipped in the extra repos section
      expect(result.current.repos).toHaveLength(0);
    });

    it("appends extra repos after task repos in the output", async () => {
      const taskRepo = makeRepoTaskSummary({
        name: "task-repo",
        path: "/projects/task-repo",
      });
      mockInvoke.mockResolvedValue([taskRepo]);

      const hs = makeHeadlessSession({
        terminalId: "hs-extra",
        projectPath: "/projects/extra",
        projectName: "extra",
      });

      const { result } = renderHook(() =>
        useSessionTracking([hs], [], "/projects")
      );

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current.repos).toHaveLength(2);
      expect(result.current.repos[0].repoName).toBe("task-repo");
      expect(result.current.repos[1].repoName).toBe("extra");
    });
  });

  describe("session status derivation", () => {
    it("marks completed headless sessions as done", async () => {
      const repo = makeRepoTaskSummary({ path: "/projects/repo-a" });
      mockInvoke.mockResolvedValue([repo]);

      const hs = makeHeadlessSession({
        projectPath: "/projects/repo-a",
        completed: true,
      });

      const { result } = renderHook(() =>
        useSessionTracking([hs], [], "/projects")
      );

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current.repos[0].sessions[0].status).toBe("done");
    });

    it("marks exited headless sessions as done", async () => {
      const repo = makeRepoTaskSummary({ path: "/projects/repo-a" });
      mockInvoke.mockResolvedValue([repo]);

      const hs = makeHeadlessSession({
        projectPath: "/projects/repo-a",
        exited: true,
        exitCode: 0,
      });

      const { result } = renderHook(() =>
        useSessionTracking([hs], [], "/projects")
      );

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current.repos[0].sessions[0].status).toBe("done");
    });

    it("marks needsAttention headless sessions as needs-attention", async () => {
      const repo = makeRepoTaskSummary({ path: "/projects/repo-a" });
      mockInvoke.mockResolvedValue([repo]);

      const hs = makeHeadlessSession({
        projectPath: "/projects/repo-a",
        needsAttention: true,
      });

      const { result } = renderHook(() =>
        useSessionTracking([hs], [], "/projects")
      );

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current.repos[0].sessions[0].status).toBe("needs-attention");
    });

    it("marks active headless sessions as running", async () => {
      const repo = makeRepoTaskSummary({ path: "/projects/repo-a" });
      mockInvoke.mockResolvedValue([repo]);

      const hs = makeHeadlessSession({
        projectPath: "/projects/repo-a",
        needsAttention: false,
        exited: false,
        completed: false,
      });

      const { result } = renderHook(() =>
        useSessionTracking([hs], [], "/projects")
      );

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current.repos[0].sessions[0].status).toBe("running");
    });

    it("marks dead terminal tabs as done", async () => {
      const repo = makeRepoTaskSummary({ path: "/projects/repo-a" });
      mockInvoke.mockResolvedValue([repo]);

      const tab = makeTerminalTab({
        projectPath: "/projects/repo-a",
        isClaudeSession: true,
        dead: true,
      });

      const { result } = renderHook(() =>
        useSessionTracking([], [tab], "/projects")
      );

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current.repos[0].sessions[0].status).toBe("done");
    });

    it("marks live terminal tabs as running", async () => {
      const repo = makeRepoTaskSummary({ path: "/projects/repo-a" });
      mockInvoke.mockResolvedValue([repo]);

      const tab = makeTerminalTab({
        projectPath: "/projects/repo-a",
        isClaudeSession: true,
        dead: false,
      });

      const { result } = renderHook(() =>
        useSessionTracking([], [tab], "/projects")
      );

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current.repos[0].sessions[0].status).toBe("running");
    });

    it("prioritizes done over needs-attention (completed + needsAttention)", async () => {
      const repo = makeRepoTaskSummary({ path: "/projects/repo-a" });
      mockInvoke.mockResolvedValue([repo]);

      const hs = makeHeadlessSession({
        projectPath: "/projects/repo-a",
        completed: true,
        needsAttention: true,
      });

      const { result } = renderHook(() =>
        useSessionTracking([hs], [], "/projects")
      );

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current.repos[0].sessions[0].status).toBe("done");
    });
  });

  describe("summary computation", () => {
    it("computes correct summary counts", async () => {
      const repoA = makeRepoTaskSummary({
        path: "/projects/repo-a",
        groomedCount: 3,
      });
      const repoB = makeRepoTaskSummary({
        name: "repo-b",
        path: "/projects/repo-b",
        groomedCount: 2,
      });
      mockInvoke.mockResolvedValue([repoA, repoB]);

      const sessions: HeadlessSession[] = [
        makeHeadlessSession({ terminalId: "h1", projectPath: "/projects/repo-a" }), // running
        makeHeadlessSession({ terminalId: "h2", projectPath: "/projects/repo-a", needsAttention: true }), // needs-attention
        makeHeadlessSession({ terminalId: "h3", projectPath: "/projects/repo-b", completed: true }), // done
      ];

      const { result } = renderHook(() =>
        useSessionTracking(sessions, [], "/projects")
      );

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current.summary).toEqual({
        totalRunning: 1,
        totalNeedsAttention: 1,
        totalDone: 1,
        totalGroomed: 5,
      });
    });

    it("includes extra repo sessions in summary counts", async () => {
      mockInvoke.mockResolvedValue([]); // no task repos

      const hs = makeHeadlessSession({
        terminalId: "hs-extra",
        projectPath: "/projects/extra",
        projectName: "extra",
        needsAttention: true,
      });

      const { result } = renderHook(() =>
        useSessionTracking([hs], [], "/projects")
      );

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current.summary.totalNeedsAttention).toBe(1);
      expect(result.current.summary.totalGroomed).toBe(0);
    });

    it("does not double-count promoted headless session in summary", async () => {
      const repo = makeRepoTaskSummary({
        path: "/projects/repo-a",
        groomedCount: 3,
      });
      mockInvoke.mockResolvedValue([repo]);

      // Headless session running
      const hs = makeHeadlessSession({
        terminalId: "hs-1",
        projectPath: "/projects/repo-a",
      });
      // Promoted tab referencing the same headless session
      const promotedTab = makeTerminalTab({
        id: "tab-promoted",
        terminalId: null,
        projectPath: "/projects/repo-a",
        isClaudeSession: true,
        isHeadlessPromoted: true,
        headlessTerminalId: "hs-1",
      });

      const { result } = renderHook(() =>
        useSessionTracking([hs], [promotedTab], "/projects")
      );

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      // Should count the headless session once, not the promoted tab
      expect(result.current.summary.totalRunning).toBe(1);
      expect(result.current.summary.totalGroomed).toBe(3);
      // And only 1 session in repo, not 2
      expect(result.current.repos[0].sessions).toHaveLength(1);
      expect(result.current.repos[0].sessions[0].terminalId).toBe("hs-1");
      expect(result.current.repos[0].sessions[0].isHeadless).toBe(true);
    });

    it("counts non-promoted visible tab alongside headless sessions in summary", async () => {
      const repo = makeRepoTaskSummary({
        path: "/projects/repo-a",
        groomedCount: 2,
      });
      mockInvoke.mockResolvedValue([repo]);

      const hs = makeHeadlessSession({
        terminalId: "hs-1",
        projectPath: "/projects/repo-a",
        completed: true,
      });
      // A regular (non-promoted) Claude tab for the same repo
      const regularTab = makeTerminalTab({
        id: "tab-regular",
        terminalId: "term-regular",
        projectPath: "/projects/repo-a",
        isClaudeSession: true,
      });

      const { result } = renderHook(() =>
        useSessionTracking([hs], [regularTab], "/projects")
      );

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      // 1 headless (done) + 1 regular tab (running) = 2 sessions
      expect(result.current.repos[0].sessions).toHaveLength(2);
      expect(result.current.summary.totalDone).toBe(1);
      expect(result.current.summary.totalRunning).toBe(1);
    });

    it("returns zero summary when no sessions exist", async () => {
      mockInvoke.mockResolvedValue([
        makeRepoTaskSummary({ groomedCount: 0 }),
      ]);

      const { result } = renderHook(() =>
        useSessionTracking([], [], "/projects")
      );

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current.summary).toEqual({
        totalRunning: 0,
        totalNeedsAttention: 0,
        totalDone: 0,
        totalGroomed: 0,
      });
    });
  });

  describe("polling", () => {
    beforeEach(() => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("starts polling when active headless sessions exist", async () => {
      mockInvoke.mockResolvedValue([]);

      const activeSessions = [
        makeHeadlessSession({ exited: false }),
      ];

      renderHook(() =>
        useSessionTracking(activeSessions, [], "/projects")
      );

      await waitFor(() => {
        expect(scanCallCount()).toBe(1);
      });

      // Advance past poll interval
      await act(async () => {
        vi.advanceTimersByTime(60_000);
      });

      await waitFor(() => {
        expect(scanCallCount()).toBe(2);
      });
    });

    it("starts polling when active visible Claude sessions exist", async () => {
      mockInvoke.mockResolvedValue([]);

      const tabs = [
        makeTerminalTab({ isClaudeSession: true, dead: false }),
      ];

      renderHook(() =>
        useSessionTracking([], tabs, "/projects")
      );

      await waitFor(() => {
        expect(scanCallCount()).toBe(1);
      });

      await act(async () => {
        vi.advanceTimersByTime(60_000);
      });

      await waitFor(() => {
        expect(scanCallCount()).toBe(2);
      });
    });

    it("does not poll when all sessions are exited/dead", async () => {
      mockInvoke.mockResolvedValue([]);

      const sessions = [
        makeHeadlessSession({ exited: true }),
      ];
      const tabs = [
        makeTerminalTab({ isClaudeSession: true, dead: true }),
      ];

      renderHook(() =>
        useSessionTracking(sessions, tabs, "/projects")
      );

      await waitFor(() => {
        expect(scanCallCount()).toBe(1);
      });

      await act(async () => {
        vi.advanceTimersByTime(120_000);
      });

      // No additional scan calls (watcher invokes don't count).
      expect(scanCallCount()).toBe(1);
    });

    it("does not poll when activeLevelPath is null", async () => {
      const sessions = [makeHeadlessSession({ exited: false })];

      renderHook(() =>
        useSessionTracking(sessions, [], null)
      );

      expect(scanCallCount()).toBe(0);

      await act(async () => {
        vi.advanceTimersByTime(120_000);
      });

      expect(scanCallCount()).toBe(0);
    });
  });

  describe("window focus refresh", () => {
    beforeEach(() => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("refreshes on window focus", async () => {
      mockInvoke.mockResolvedValue([]);

      renderHook(() =>
        useSessionTracking([], [], "/projects")
      );

      await waitFor(() => {
        expect(scanCallCount()).toBe(1);
      });

      // Move time forward past debounce window (15s)
      vi.advanceTimersByTime(16_000);

      act(() => {
        window.dispatchEvent(new Event("focus"));
      });

      await waitFor(() => {
        expect(scanCallCount()).toBe(2);
      });
    });

    it("debounces rapid focus events", async () => {
      mockInvoke.mockResolvedValue([]);

      renderHook(() =>
        useSessionTracking([], [], "/projects")
      );

      await waitFor(() => {
        expect(scanCallCount()).toBe(1);
      });

      // Move past debounce
      vi.advanceTimersByTime(16_000);

      act(() => {
        window.dispatchEvent(new Event("focus"));
      });

      await waitFor(() => {
        expect(scanCallCount()).toBe(2);
      });

      // Fire focus again immediately (within debounce window)
      act(() => {
        window.dispatchEvent(new Event("focus"));
      });

      // Should not have scanned again
      expect(scanCallCount()).toBe(2);
    });
  });

  describe("stale response handling", () => {
    it("ignores stale responses when activeLevelPath changes", async () => {
      let resolveFirst: (v: RepoTaskSummary[]) => void;
      const firstCall = new Promise<RepoTaskSummary[]>((r) => { resolveFirst = r; });
      const secondResult = [makeRepoTaskSummary({ name: "repo-b", path: "/projects/repo-b" })];

      // Track scan calls separately because the watcher useEffect interleaves
      // start/stop_tasks_md_watch invokes between the two scans we care about.
      let scanCallSeq = 0;
      mockInvoke.mockImplementation((cmd: string) => {
        if (cmd === "scan_tasks_across_repos") {
          scanCallSeq++;
          return scanCallSeq === 1 ? firstCall : Promise.resolve(secondResult);
        }
        // Watcher commands and anything else: resolve with undefined.
        return Promise.resolve(undefined);
      });

      const { result, rerender } = renderHook(
        ({ path }: { path: string | null }) => useSessionTracking([], [], path),
        { initialProps: { path: "/projects-a" as string | null } }
      );

      // Change path before first call resolves
      rerender({ path: "/projects-b" });

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      // Resolve the stale first call
      await act(async () => {
        resolveFirst!([makeRepoTaskSummary({ name: "stale", path: "/stale" })]);
      });

      // Should show second result, not stale first
      expect(result.current.repos).toHaveLength(1);
      expect(result.current.repos[0].repoName).toBe("repo-b");
    });
  });

  describe("session-count-to-zero refresh", () => {
    it("triggers loadTasks when active session count transitions from >0 to 0", async () => {
      mockInvoke.mockResolvedValue([makeRepoTaskSummary()]);

      const activeSession = makeHeadlessSession({
        terminalId: "hs-active",
        projectPath: "/projects/repo-a",
        exited: false,
      });

      const { rerender } = renderHook(
        ({ sessions }: { sessions: HeadlessSession[] }) =>
          useSessionTracking(sessions, [], "/projects"),
        { initialProps: { sessions: [activeSession] } }
      );

      // Wait for initial load
      await waitFor(() => {
        expect(scanCallCount()).toBe(1);
      });

      // Now rerender with the session exited (transition from 1 active -> 0 active)
      const exitedSession = makeHeadlessSession({
        terminalId: "hs-active",
        projectPath: "/projects/repo-a",
        exited: true,
      });

      rerender({ sessions: [exitedSession] });

      // The transition from >0 to 0 should trigger another loadTasks call
      await waitFor(() => {
        expect(scanCallCount()).toBe(2);
      });
    });

    it("does not trigger extra loadTasks when active count stays at 0", async () => {
      mockInvoke.mockResolvedValue([makeRepoTaskSummary()]);

      const exitedSession = makeHeadlessSession({
        terminalId: "hs-done",
        projectPath: "/projects/repo-a",
        exited: true,
      });

      const { rerender } = renderHook(
        ({ sessions }: { sessions: HeadlessSession[] }) =>
          useSessionTracking(sessions, [], "/projects"),
        { initialProps: { sessions: [exitedSession] } }
      );

      // Wait for initial load
      await waitFor(() => {
        expect(scanCallCount()).toBe(1);
      });

      // Rerender with a different exited session (still 0 active -> 0 active)
      const anotherExitedSession = makeHeadlessSession({
        terminalId: "hs-done-2",
        projectPath: "/projects/repo-a",
        exited: true,
      });

      rerender({ sessions: [exitedSession, anotherExitedSession] });

      // Should NOT have triggered an additional loadTasks call
      // Give React a tick to process the rerender
      await waitFor(() => {
        expect(scanCallCount()).toBe(1);
      });
    });
  });

  describe("refresh callback", () => {
    it("exposes a refresh function that reloads tasks", async () => {
      mockInvoke.mockResolvedValue([makeRepoTaskSummary()]);

      const { result } = renderHook(() =>
        useSessionTracking([], [], "/projects")
      );

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(scanCallCount()).toBe(1);

      act(() => {
        result.current.refresh();
      });

      expect(scanCallCount()).toBe(2);
    });
  });

  describe("TASKS.md watcher integration", () => {
    /** Pull all invoke calls for a specific Tauri command name. */
    function callsFor(command: string): unknown[][] {
      return mockInvoke.mock.calls
        .filter((c) => c[0] === command)
        .map((c) => c.slice(1));
    }

    it("calls start_tasks_md_watch when activeLevelPath becomes non-null", async () => {
      mockInvoke.mockResolvedValue([]);

      renderHook(() => useSessionTracking([], [], "/projects/foo"));

      await waitFor(() => {
        expect(callsFor("start_tasks_md_watch").length).toBeGreaterThan(0);
      });

      const startCalls = callsFor("start_tasks_md_watch");
      expect(startCalls[0][0]).toEqual({ path: "/projects/foo" });
    });

    it("does NOT call start_tasks_md_watch when activeLevelPath is null", async () => {
      mockInvoke.mockResolvedValue([]);

      renderHook(() => useSessionTracking([], [], null));

      // Let any pending async effects flush
      await act(async () => {
        await Promise.resolve();
      });

      expect(callsFor("start_tasks_md_watch")).toHaveLength(0);
    });

    it("calls stop_tasks_md_watch then start_tasks_md_watch when activeLevelPath changes", async () => {
      mockInvoke.mockResolvedValue([]);

      const { rerender } = renderHook(
        ({ path }: { path: string | null }) => useSessionTracking([], [], path),
        { initialProps: { path: "/projects/foo" as string | null } }
      );

      await waitFor(() => {
        const startArgs = callsFor("start_tasks_md_watch").map((c) => c[0]);
        expect(startArgs).toContainEqual({ path: "/projects/foo" });
      });

      rerender({ path: "/projects/bar" });

      await waitFor(() => {
        const startArgs = callsFor("start_tasks_md_watch").map((c) => c[0]);
        expect(startArgs).toContainEqual({ path: "/projects/bar" });
      });

      // Verify ordering: in mock.calls, the stop for the old path must appear
      // before the start for the new path.
      const ordered = mockInvoke.mock.calls
        .map((c, idx) => ({ idx, command: c[0], args: c[1] }))
        .filter(
          (c) =>
            c.command === "stop_tasks_md_watch" ||
            (c.command === "start_tasks_md_watch" &&
              (c.args as { path: string } | undefined)?.path === "/projects/bar")
        );

      const firstStopIdx = ordered.findIndex(
        (c) => c.command === "stop_tasks_md_watch"
      );
      const startBarIdx = ordered.findIndex(
        (c) => c.command === "start_tasks_md_watch"
      );

      expect(firstStopIdx).toBeGreaterThanOrEqual(0);
      expect(startBarIdx).toBeGreaterThanOrEqual(0);
      expect(firstStopIdx).toBeLessThan(startBarIdx);
    });

    it("calls stop_tasks_md_watch on unmount", async () => {
      mockInvoke.mockResolvedValue([]);

      const { unmount } = renderHook(() =>
        useSessionTracking([], [], "/projects/foo")
      );

      await waitFor(() => {
        expect(callsFor("start_tasks_md_watch").length).toBeGreaterThan(0);
      });

      const stopCallsBefore = callsFor("stop_tasks_md_watch").length;

      unmount();

      await waitFor(() => {
        expect(callsFor("stop_tasks_md_watch").length).toBeGreaterThan(
          stopCallsBefore
        );
      });
    });

    it("subscribes to tasks-md-changed event with a handler", async () => {
      mockInvoke.mockResolvedValue([]);

      renderHook(() => useSessionTracking([], [], "/projects/foo"));

      await waitFor(() => {
        expect(mockListen).toHaveBeenCalled();
      });

      const tasksMdCalls = mockListen.mock.calls.filter(
        (c) => c[0] === "tasks-md-changed"
      );
      expect(tasksMdCalls.length).toBeGreaterThan(0);
      // Second arg must be a function (the event handler).
      expect(typeof tasksMdCalls[0][1]).toBe("function");
    });

    it("triggers loadTasks when the tasks-md-changed handler fires", async () => {
      mockInvoke.mockResolvedValue([]);

      renderHook(() => useSessionTracking([], [], "/projects/foo"));

      // Wait for the initial scan + listen registration.
      await waitFor(() => {
        expect(callsFor("scan_tasks_across_repos").length).toBeGreaterThan(0);
        expect(mockListen).toHaveBeenCalled();
      });

      const scanCallsBefore = callsFor("scan_tasks_across_repos").length;

      const handler = mockListen.mock.calls.find(
        (c) => c[0] === "tasks-md-changed"
      )?.[1] as ((event: unknown) => void) | undefined;
      expect(handler).toBeDefined();

      await act(async () => {
        handler!({ payload: null });
        await Promise.resolve();
      });

      await waitFor(() => {
        expect(callsFor("scan_tasks_across_repos").length).toBeGreaterThan(
          scanCallsBefore
        );
      });
    });

    it("uses latest activeLevelPath when handler fires after a path change (no stale closure)", async () => {
      // Regression guard: the listen handler is registered once per `loadTasks`
      // identity; `loadTasks` itself reads `activeLevelPath` via a ref. If that
      // ref were ever removed and the handler captured `activeLevelPath`
      // directly, this test would fail because the post-change handler would
      // scan the old path.
      mockInvoke.mockResolvedValue([]);

      const { rerender } = renderHook(
        ({ path }: { path: string | null }) => useSessionTracking([], [], path),
        { initialProps: { path: "/projects/old" as string | null } }
      );

      await waitFor(() => {
        expect(mockListen).toHaveBeenCalled();
      });

      // Capture the handler registered on initial mount.
      const handler = mockListen.mock.calls.find(
        (c) => c[0] === "tasks-md-changed"
      )?.[1] as ((event: unknown) => void) | undefined;
      expect(handler).toBeDefined();

      // Change path to a new value.
      rerender({ path: "/projects/new" });

      // Wait for the post-change scan to complete so we have a clean baseline.
      await waitFor(() => {
        const scans = mockInvoke.mock.calls.filter(
          (c) => c[0] === "scan_tasks_across_repos"
        );
        expect(
          scans.some(
            (c) => (c[1] as { folderPath: string }).folderPath === "/projects/new"
          )
        ).toBe(true);
      });

      // Snapshot scan calls before firing the watcher event.
      const scansBefore = mockInvoke.mock.calls.filter(
        (c) => c[0] === "scan_tasks_across_repos"
      ).length;

      // Fire the original handler (the one captured before the path change).
      // It must still scan the NEW path, not the OLD one.
      await act(async () => {
        handler!({ payload: null });
        await Promise.resolve();
      });

      await waitFor(() => {
        const scans = mockInvoke.mock.calls.filter(
          (c) => c[0] === "scan_tasks_across_repos"
        );
        expect(scans.length).toBeGreaterThan(scansBefore);
        // The scan triggered by the watcher event must use the latest path.
        const lastScan = scans[scans.length - 1];
        expect((lastScan[1] as { folderPath: string }).folderPath).toBe(
          "/projects/new"
        );
      });
    });

    it("invokes the listen() unsubscribe function on unmount", async () => {
      const unsubSpy = vi.fn();
      // For this test only, override mockListen to return our spy as the
      // unsubscribe function. (Default impl returns a no-op.)
      mockListen.mockImplementationOnce(() => Promise.resolve(unsubSpy));
      mockInvoke.mockResolvedValue([]);

      const { unmount } = renderHook(() =>
        useSessionTracking([], [], "/projects/foo")
      );

      await waitFor(() => {
        expect(mockListen).toHaveBeenCalled();
      });

      // Let the promise from listen() resolve so the hook captures unsubSpy.
      await act(async () => {
        await Promise.resolve();
      });

      unmount();

      expect(unsubSpy).toHaveBeenCalled();
    });
  });
});
