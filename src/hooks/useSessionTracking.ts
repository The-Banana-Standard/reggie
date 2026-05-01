import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { RepoTaskSummary, HeadlessSession, TerminalTab, TaskItem } from "../types/terminal";

export interface TrackedSession {
  terminalId: string;
  label: string;
  agentNumber: number;
  status: "running" | "needs-attention" | "done";
  isHeadless: boolean;
}

export interface TrackedRepo {
  repoName: string;
  repoPath: string;
  workspaceName: string | null;
  activeTasks: number;
  groomedTasks: number;
  ungroomedTasks: number;
  ungroomedTaskItems: TaskItem[];
  groomedTaskItems: TaskItem[];
  activeTaskItems: TaskItem[];
  sessions: TrackedSession[];
}

export interface SessionSummary {
  totalRunning: number;
  totalNeedsAttention: number;
  totalDone: number;
  totalGroomed: number;
}

interface UseSessionTrackingResult {
  repos: TrackedRepo[];
  summary: SessionSummary;
  loading: boolean;
  refresh: () => void;
}

const POLL_INTERVAL_MS = 60_000;
const FOCUS_DEBOUNCE_MS = 15_000;

type SessionStatus = "running" | "needs-attention" | "done";

function deriveSessionStatus(session: HeadlessSession): SessionStatus {
  if (session.completed || session.exited) return "done";
  if (session.needsAttention) return "needs-attention";
  return "running";
}

function deriveTerminalTabStatus(tab: TerminalTab): SessionStatus {
  if (tab.dead) return "done";
  return "running";
}

/** Build TrackedSession[] from headless and visible sessions for a single repo path. */
function buildSessionsForRepo(
  repoHeadless: HeadlessSession[],
  repoVisible: TerminalTab[]
): TrackedSession[] {
  const sessions: TrackedSession[] = [];
  for (const hs of repoHeadless) {
    sessions.push({
      terminalId: hs.terminalId,
      label: hs.label,
      agentNumber: sessions.length + 1,
      status: deriveSessionStatus(hs),
      isHeadless: true,
    });
  }
  for (const tab of repoVisible) {
    // Skip if this visible tab was promoted from a headless session already counted
    if (tab.isHeadlessPromoted && tab.headlessTerminalId) {
      if (repoHeadless.some((hs) => hs.terminalId === tab.headlessTerminalId)) continue;
    }
    sessions.push({
      terminalId: tab.terminalId ?? tab.id,
      label: tab.label,
      agentNumber: sessions.length + 1,
      status: deriveTerminalTabStatus(tab),
      isHeadless: false,
    });
  }
  return sessions;
}

export function useSessionTracking(
  headlessSessions: HeadlessSession[],
  terminalTabs: TerminalTab[],
  activeLevelPath: string | null
): UseSessionTrackingResult {
  const [taskRepos, setTaskRepos] = useState<RepoTaskSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const mountedRef = useRef(true);
  const requestIdRef = useRef(0);
  const lastFocusLoadRef = useRef(0);
  const prevActiveSessionCountRef = useRef(0);

  // Mirror activeLevelPath in ref for use in loadTasks callback (stale closure avoidance)
  const activeLevelPathRef = useRef(activeLevelPath);
  activeLevelPathRef.current = activeLevelPath;

  const loadTasks = useCallback(() => {
    const path = activeLevelPathRef.current;
    if (!path) {
      setTaskRepos([]);
      setLoading(false);
      return;
    }
    const id = ++requestIdRef.current;
    setLoading(true);
    invoke<RepoTaskSummary[]>("scan_tasks_across_repos", { folderPath: path })
      .then((result) => {
        if (mountedRef.current && requestIdRef.current === id) {
          setTaskRepos(result);
          setLoading(false);
        }
      })
      .catch((err) => {
        console.error("Failed to scan tasks:", err);
        if (mountedRef.current && requestIdRef.current === id) {
          setTaskRepos([]);
          setLoading(false);
        }
      });
  }, []);

  // Unmount guard (separate from path-change effects)
  useEffect(() => {
    return () => { mountedRef.current = false; };
  }, []);

  // Load when activeLevelPath changes
  useEffect(() => {
    loadTasks();
  }, [activeLevelPath, loadTasks]);

  // Start/stop the Rust filesystem watcher for TASKS.md as activeLevelPath changes.
  // When the path changes, stop any existing watcher then start one rooted at the
  // new path. Errors are logged but non-fatal — the existing poll/focus refresh
  // triggers remain as fallbacks.
  useEffect(() => {
    let cancelled = false;

    (async () => {
      // Best-effort stop of any prior watcher.
      try {
        await invoke("stop_tasks_md_watch");
      } catch (err) {
        console.warn("stop_tasks_md_watch failed (non-fatal):", err);
      }

      if (cancelled || !activeLevelPath) return;

      try {
        await invoke("start_tasks_md_watch", { path: activeLevelPath });
      } catch (err) {
        console.warn("start_tasks_md_watch failed (non-fatal):", err);
      }
    })();

    return () => {
      cancelled = true;
      // Cleanup: stop the watcher when the path changes or hook unmounts.
      invoke("stop_tasks_md_watch").catch((err) => {
        console.warn("stop_tasks_md_watch cleanup failed (non-fatal):", err);
      });
    };
  }, [activeLevelPath]);

  // Subscribe to `tasks-md-changed` events from the Rust watcher and refresh
  // tasks when fired. The Rust side already debounces events at 300ms (the
  // canonical coalescer), so no additional TS-side debounce is needed —
  // stacking another debounce here would push end-to-end latency over budget.
  useEffect(() => {
    let unlisten: (() => void) | null = null;
    let cancelled = false;

    listen("tasks-md-changed", () => {
      loadTasks();
    })
      .then((fn) => {
        if (cancelled) {
          fn();
        } else {
          unlisten = fn;
        }
      })
      .catch((err) => {
        console.warn("listen(tasks-md-changed) failed (non-fatal):", err);
      });

    return () => {
      cancelled = true;
      if (unlisten) unlisten();
    };
  }, [loadTasks]);

  // Periodic polling while sessions are active
  useEffect(() => {
    const hasActiveSessions = headlessSessions.some((s) => !s.exited) ||
      terminalTabs.some((t) => t.isClaudeSession && !t.dead);

    if (!hasActiveSessions || !activeLevelPath) return;

    const intervalId = setInterval(() => {
      loadTasks();
    }, POLL_INTERVAL_MS);

    return () => clearInterval(intervalId);
  }, [headlessSessions, terminalTabs, activeLevelPath, loadTasks]);

  // Refresh tasks when all active sessions end (transition from >0 to 0)
  useEffect(() => {
    const activeCount = headlessSessions.filter((s) => !s.exited).length +
      terminalTabs.filter((t) => t.isClaudeSession && !t.dead).length;
    const prevCount = prevActiveSessionCountRef.current;
    prevActiveSessionCountRef.current = activeCount;

    if (prevCount > 0 && activeCount === 0) {
      loadTasks();
    }
  }, [headlessSessions, terminalTabs, loadTasks]);

  // Refresh on window focus with debounce
  useEffect(() => {
    const onFocus = () => {
      if (Date.now() - lastFocusLoadRef.current > FOCUS_DEBOUNCE_MS) {
        lastFocusLoadRef.current = Date.now();
        loadTasks();
      }
    };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [loadTasks]);

  // Merge task data with session data (memoized to avoid recomputation on unrelated renders)
  const { allRepos, summary } = useMemo(() => {
    const claudeTabs = terminalTabs.filter((t) => t.isClaudeSession);
    const repoPathsInTasks = new Set(taskRepos.map((r) => r.path));

    // Repos from task scan
    const repos: TrackedRepo[] = taskRepos.map((repo) => ({
      repoName: repo.name,
      repoPath: repo.path,
      workspaceName: repo.workspaceName,
      activeTasks: repo.activeCount,
      groomedTasks: repo.groomedCount,
      ungroomedTasks: repo.ungroomedCount,
      ungroomedTaskItems: repo.ungroomedTasks ?? [],
      groomedTaskItems: repo.groomedTasks ?? [],
      activeTaskItems: repo.activeTasks ?? [],
      sessions: buildSessionsForRepo(
        headlessSessions.filter((s) => s.projectPath === repo.path),
        claudeTabs.filter((t) => t.projectPath === repo.path)
      ),
    }));

    // Extra repos with sessions but no TASKS.md
    const extraRepoMap = new Map<string, TrackedRepo>();
    for (const hs of headlessSessions) {
      if (repoPathsInTasks.has(hs.projectPath)) continue;
      if (!extraRepoMap.has(hs.projectPath)) {
        extraRepoMap.set(hs.projectPath, {
          repoName: hs.projectName,
          repoPath: hs.projectPath,
          workspaceName: null,
          activeTasks: 0, groomedTasks: 0, ungroomedTasks: 0, ungroomedTaskItems: [], groomedTaskItems: [], activeTaskItems: [],
          sessions: [],
        });
      }
    }
    for (const tab of claudeTabs) {
      if (repoPathsInTasks.has(tab.projectPath)) continue;
      if (tab.isHeadlessPromoted && tab.headlessTerminalId) continue;
      if (!extraRepoMap.has(tab.projectPath)) {
        extraRepoMap.set(tab.projectPath, {
          repoName: tab.projectName ?? tab.label,
          repoPath: tab.projectPath,
          workspaceName: null,
          activeTasks: 0, groomedTasks: 0, ungroomedTasks: 0, ungroomedTaskItems: [], groomedTaskItems: [], activeTaskItems: [],
          sessions: [],
        });
      }
    }
    // Build sessions for each extra repo
    for (const [path, repo] of extraRepoMap) {
      repo.sessions = buildSessionsForRepo(
        headlessSessions.filter((s) => s.projectPath === path),
        claudeTabs.filter((t) => t.projectPath === path)
      );
    }

    const merged = [...repos, ...extraRepoMap.values()];

    // Compute summary
    const sum: SessionSummary = { totalRunning: 0, totalNeedsAttention: 0, totalDone: 0, totalGroomed: 0 };
    for (const repo of merged) {
      sum.totalGroomed += repo.groomedTasks;
      for (const session of repo.sessions) {
        if (session.status === "running") sum.totalRunning++;
        else if (session.status === "needs-attention") sum.totalNeedsAttention++;
        else if (session.status === "done") sum.totalDone++;
      }
    }

    return { allRepos: merged, summary: sum };
  }, [taskRepos, headlessSessions, terminalTabs]);

  return { repos: allRepos, summary, loading, refresh: loadTasks };
}
