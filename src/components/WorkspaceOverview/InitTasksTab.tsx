import { useState, useEffect, useCallback, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { RepoTaskSummary, HeadlessSession, TerminalTab } from "../../types/terminal";
import { RepoTaskRow } from "./RepoTaskRow";
import { groupByWorkspace } from "./groupByWorkspace";

interface InitTasksTabProps {
  activeLevelPath: string | null;
  headlessSessions: HeadlessSession[];
  sessions: TerminalTab[];
  onSpawnVisibleHeadless: (projectPath: string, initialCommand: string, label: string, model?: string, effort?: string) => Promise<string | null>;
  onPromoteHeadless: (terminalId: string) => string | null;
  onPromoteSession: (tabId: string) => void;
  onRemoveHeadless: (terminalId: string) => void;
  onHideSession?: (tabId: string) => void;
  onKillSession?: (terminalId: string) => void;
  onTrashCompleted?: () => void;
  onTrashSession?: (terminalId: string) => void;
  onKillPromotedSession?: (tabId: string) => void;
  trackedRepos?: RepoTaskSummary[];
  reposLoading?: boolean;
  onRefreshRepos?: () => void;
}

export function InitTasksTab({
  activeLevelPath,
  headlessSessions,
  sessions,
  onSpawnVisibleHeadless,
  onPromoteHeadless,
  onPromoteSession,
  onRemoveHeadless,
  onHideSession,
  onKillSession,
  onTrashCompleted,
  onTrashSession,
  onKillPromotedSession,
  trackedRepos,
  reposLoading,
  onRefreshRepos,
}: InitTasksTabProps) {
  // Use tracked data from parent when available, fall back to local fetch
  const useTracked = trackedRepos !== undefined;

  const [localRepos, setLocalRepos] = useState<RepoTaskSummary[]>([]);
  const [localLoading, setLocalLoading] = useState(true);
  const [batchRunning, setBatchRunning] = useState(false);
  const mountedRef = useRef(true);

  const loadTasks = useCallback(() => {
    if (useTracked) return; // Skip local fetch when using tracked data
    if (!activeLevelPath) {
      setLocalRepos([]);
      setLocalLoading(false);
      return;
    }
    setLocalLoading(true);
    invoke<RepoTaskSummary[]>("scan_tasks_across_repos", { folderPath: activeLevelPath })
      .then((result) => {
        if (mountedRef.current) {
          setLocalRepos(result);
          setLocalLoading(false);
        }
      })
      .catch((err) => {
        console.error("Failed to scan tasks:", err);
        if (mountedRef.current) {
          setLocalRepos([]);
          setLocalLoading(false);
        }
      });
  }, [activeLevelPath, useTracked]);

  useEffect(() => {
    if (useTracked) return;
    mountedRef.current = true;
    loadTasks();
    return () => { mountedRef.current = false; };
  }, [loadTasks, useTracked]);

  // Refresh on window focus (only when not using tracked data)
  const lastLoadRef = useRef(0);
  useEffect(() => {
    if (useTracked) return;
    const onFocus = () => {
      if (Date.now() - lastLoadRef.current > 15_000) {
        lastLoadRef.current = Date.now();
        loadTasks();
      }
    };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [loadTasks, useTracked]);

  const repos = useTracked ? trackedRepos : localRepos;
  const loading = useTracked ? (reposLoading ?? false) : localLoading;
  const handleRefresh = useTracked ? (onRefreshRepos ?? (() => {})) : loadTasks;

  const handleLaunchSession = useCallback(
    async (repoPath: string, repoName: string) => {
      await onSpawnVisibleHeadless(repoPath, "/reggie-init-tasks", `init-tasks -- ${repoName}`, "opus", "high");
    },
    [onSpawnVisibleHeadless]
  );

  const handleBatchInit = useCallback(async () => {
    const reposWithTasks = repos.filter((r) => r.ungroomedCount > 0);
    if (reposWithTasks.length === 0) return;

    setBatchRunning(true);
    for (const repo of reposWithTasks) {
      // Skip repos that already have a headless session
      const existingHeadless = headlessSessions.find(
        (s) => s.projectPath === repo.path && !s.exited
      );
      if (existingHeadless) continue;

      // Skip repos that already have a promoted init-tasks session
      const existingPromoted = sessions.find(
        (s) => s.isHeadlessPromoted && s.projectPath === repo.path && s.label.startsWith("init-tasks") && !s.dead
      );
      if (existingPromoted) continue;

      await onSpawnVisibleHeadless(repo.path, "/reggie-init-tasks", `init-tasks -- ${repo.name}`, "opus", "high");
    }
    setBatchRunning(false);
  }, [repos, headlessSessions, sessions, onSpawnVisibleHeadless]);

  // Group repos by workspace
  const grouped = groupByWorkspace(repos);
  const totalUngroomed = repos.reduce((sum, r) => sum + r.ungroomedCount, 0);

  if (loading) {
    return <div className="dashboard-tab-loading">Scanning tasks across repos...</div>;
  }

  if (repos.length === 0) {
    return (
      <div className="overview-tab-placeholder">
        <div className="overview-tab-placeholder-icon">&gt;_</div>
        <h2>No repos found</h2>
        <p>Set a projects folder to scan for repos with tasks.</p>
      </div>
    );
  }

  return (
    <div className="dashboard-tab-content">
      <div className="dashboard-tab-header">
        <div className="dashboard-tab-header-info">
          <span className="dashboard-tab-header-count">{totalUngroomed} ungroomed tasks</span>
          <span className="dashboard-tab-header-repos">{repos.length} repos</span>
        </div>
        <div className="dashboard-tab-header-actions">
          <button className="dashboard-tab-refresh-btn" onClick={handleRefresh} title="Refresh">
            Refresh
          </button>
          {onTrashCompleted && (headlessSessions.some((s) => s.completed) || sessions.some((s) => s.isHeadlessPromoted && s.headlessCompleted)) && (
            <button
              className="dashboard-tab-trash-btn"
              onClick={onTrashCompleted}
              title="Trash all completed sessions"
            >
              Trash All Completed
            </button>
          )}
          <button
            className="dashboard-tab-batch-btn"
            onClick={handleBatchInit}
            disabled={batchRunning || totalUngroomed === 0}
            title="Launch /reggie-init-tasks for all repos with ungroomed tasks"
          >
            {batchRunning ? "Launching..." : "Batch Init Tasks"}
          </button>
        </div>
      </div>

      <div className="dashboard-tab-list">
        {grouped.map((group) => (
          <div key={group.name} className="dashboard-tab-group">
            {group.isWorkspace && (
              <div className="dashboard-tab-group-header">
                <span className="dashboard-tab-group-name">{group.name}</span>
                <span className="dashboard-tab-group-count">
                  {group.repos.reduce((sum, r) => sum + r.ungroomedCount, 0)} ungroomed
                </span>
              </div>
            )}
            {group.repos.map((repo) => {
              const repoSessions = headlessSessions.filter(
                (s) => s.projectPath === repo.path && s.label.startsWith("init-tasks")
              );
              const repoTabs = sessions.filter(
                (s) => s.projectPath === repo.path
              );

              return (
                <RepoTaskRow
                  key={repo.path}
                  repo={repo}
                  mode="init"
                  headlessSessions={repoSessions}
                  repoTabs={repoTabs}
                  onLaunchSession={handleLaunchSession}
                  onOpenSession={onPromoteHeadless}
                  onHideSession={onHideSession}
                  onPromoteSession={onPromoteSession}
                  onDismissSession={onRemoveHeadless}
                  onKillSession={onKillSession}
                  onTrashSession={onTrashSession}
                  onKillPromotedSession={onKillPromotedSession}
                />
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
