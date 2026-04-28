import { useState, useEffect, useCallback, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { RepoTaskSummary, HeadlessSession, TerminalTab } from "../../types/terminal";
import { RepoTaskRow } from "./RepoTaskRow";
import { groupByWorkspace } from "./groupByWorkspace";

interface ParallelizableTaskSlug {
  slug: string;
  tier: string | null;
  mode: string | null;
}

interface ParallelizableTasksResult {
  slugs: ParallelizableTaskSlug[];
  totalGroomed: number;
}

function parseTier(tier: string | null): { model: string | undefined; effort: string | undefined } {
  if (!tier) return { model: undefined, effort: undefined };
  const parts = tier.split(":");
  return {
    model: parts[0] || undefined,
    effort: parts[1] || undefined,
  };
}

/**
 * Map a task's `mode` to the workflow command and session-label prefix used to dispatch it.
 * Falls back to the code workflow for `code`, `design`, and any unrecognized/null mode.
 */
export function commandForMode(mode: string | null | undefined): {
  command: string;
  labelPrefix: string;
} {
  if (mode === "reggie-system") {
    return { command: "/reggie-system-change --yes", labelPrefix: "reggie-sys --" };
  }
  if (mode === "debug") {
    return { command: "/reggie-debug-workflow --yes", labelPrefix: "debug --" };
  }
  return { command: "/reggie-code-workflow --yes", labelPrefix: "code --" };
}

/**
 * Whether a session label belongs to one of the dispatched workflows
 * (code, reggie-system, or debug). Used to filter sessions per-repo and to
 * skip repos in batch start that already have a workflow session running.
 */
export function isWorkflowLabel(label: string): boolean {
  return (
    label.startsWith("code --") ||
    label.startsWith("reggie-sys --") ||
    label.startsWith("debug --")
  );
}

/** Per-domain caps applied client-side after the backend returns parallelizable slugs. */
const DOMAIN_CAPS = {
  code: 5,
  reggieSystem: 1,
  debug: 3,
} as const;

/**
 * Partition slugs by domain (code/design vs. reggie-system vs. debug) and apply per-domain caps.
 * Returns the concatenated slug list in dispatch order: code/design first, then reggie-system, then debug.
 */
function partitionAndCap(slugs: ParallelizableTaskSlug[]): ParallelizableTaskSlug[] {
  const codeDesign = slugs
    .filter((s) => !s.mode || s.mode === "code" || s.mode === "design")
    .slice(0, DOMAIN_CAPS.code);
  const reggieSystem = slugs.filter((s) => s.mode === "reggie-system").slice(0, DOMAIN_CAPS.reggieSystem);
  const debug = slugs.filter((s) => s.mode === "debug").slice(0, DOMAIN_CAPS.debug);
  return [...codeDesign, ...reggieSystem, ...debug];
}

interface CodeWorkflowTabProps {
  activeLevelPath: string | null;
  headlessSessions: HeadlessSession[];
  sessions: TerminalTab[];
  onLaunchHeadless: (projectPath: string, initialCommand: string, label: string, model?: string, effort?: string) => Promise<string | null>;
  onPromoteHeadless: (terminalId: string) => string | null;
  onPromoteSession: (tabId: string) => void;
  onRemoveHeadless: (terminalId: string) => void;
  onHideSession?: (tabId: string) => void;
  onKillSession?: (terminalId: string) => void;
  onTrashCompleted?: () => void;
  onKillPromotedSession?: (tabId: string) => void;
  onTrashSession?: (terminalId: string) => void;
  trackedRepos?: RepoTaskSummary[];
  reposLoading?: boolean;
  onRefreshRepos?: () => void;
}

export function CodeWorkflowTab({
  activeLevelPath,
  headlessSessions,
  sessions,
  onLaunchHeadless,
  onPromoteHeadless,
  onPromoteSession,
  onRemoveHeadless,
  onHideSession,
  onKillSession,
  onKillPromotedSession,
  onTrashCompleted,
  onTrashSession,
  trackedRepos,
  reposLoading,
  onRefreshRepos,
}: CodeWorkflowTabProps) {
  // Use tracked data from parent when available, fall back to local fetch
  const useTracked = trackedRepos !== undefined;

  const [localRepos, setLocalRepos] = useState<RepoTaskSummary[]>([]);
  const [localLoading, setLocalLoading] = useState(true);
  const [batchRunning, setBatchRunning] = useState(false);
  const [noTasksMessage, setNoTasksMessage] = useState<string | null>(null);
  const noTasksTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);

  const loadTasks = useCallback(() => {
    if (useTracked) return;
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

  const showNoTasksMessage = useCallback((repoName: string) => {
    if (noTasksTimerRef.current) clearTimeout(noTasksTimerRef.current);
    setNoTasksMessage(`No tasks available for ${repoName}`);
    noTasksTimerRef.current = setTimeout(() => {
      setNoTasksMessage(null);
      noTasksTimerRef.current = null;
    }, 4000);
  }, []);

  // Clean up timer on unmount
  useEffect(() => {
    return () => {
      if (noTasksTimerRef.current) clearTimeout(noTasksTimerRef.current);
    };
  }, []);

  const handleLaunchSession = useCallback(
    async (repoPath: string, repoName: string) => {
      // Use smart agent count to determine which tasks to start
      try {
        const result = await invoke<ParallelizableTasksResult>("get_parallelizable_tasks", {
          projectPath: repoPath,
        });
        if (result.slugs.length === 0) {
          showNoTasksMessage(repoName);
          return;
        }
        // Partition by domain (code/design, reggie-system, debug) and apply per-domain caps.
        const toLaunch = partitionAndCap(result.slugs);
        if (toLaunch.length === 0) {
          showNoTasksMessage(repoName);
          return;
        }
        for (const entry of toLaunch) {
          const { model, effort } = parseTier(entry.tier);
          const { command, labelPrefix } = commandForMode(entry.mode);
          await onLaunchHeadless(
            repoPath,
            `${command} ${entry.slug}`,
            `${labelPrefix} ${repoName}/${entry.slug}`,
            model,
            effort,
          );
        }
      } catch (err) {
        console.error("Failed to get parallelizable tasks:", err);
      }
    },
    [onLaunchHeadless, showNoTasksMessage]
  );

  const handleStartIndividualTask = useCallback(
    async (repoPath: string, repoName: string, slug: string, tier?: string, mode?: string | null) => {
      try {
        const { model, effort } = parseTier(tier ?? null);
        const { command, labelPrefix } = commandForMode(mode ?? null);
        await onLaunchHeadless(
          repoPath,
          `${command} ${slug}`,
          `${labelPrefix} ${repoName}/${slug}`,
          model,
          effort,
        );
      } catch (err) {
        console.error("Failed to start individual task:", err);
      }
    },
    [onLaunchHeadless]
  );

  // For [manual] tasks: launch headless with the manual-walkthrough command, then immediately
  // promote so the user sees the session on the Sessions tab. The label still uses the
  // "code -- <repo>/<slug>" prefix so the task de-dupes correctly against future scans.
  const handleWalkThroughTask = useCallback(
    async (repoPath: string, repoName: string, slug: string) => {
      try {
        const terminalId = await onLaunchHeadless(
          repoPath,
          `/reggie-manual-task ${slug}`,
          `code -- ${repoName}/${slug}`,
          undefined,
          undefined,
        );
        if (terminalId) {
          onPromoteHeadless(terminalId);
        }
      } catch (err) {
        console.error("Failed to launch walk-through task:", err);
      }
    },
    [onLaunchHeadless, onPromoteHeadless]
  );

  const handleBatchStart = useCallback(async () => {
    const reposWithTasks = repos.filter((r) => r.groomedCount + r.activeCount > 0);
    if (reposWithTasks.length === 0) return;

    setBatchRunning(true);
    for (const repo of reposWithTasks) {
      // Skip repos that already have a headless workflow session running for any domain
      // (code, reggie-system, or debug).
      const existingHeadless = headlessSessions.find(
        (s) => s.projectPath === repo.path && isWorkflowLabel(s.label) && !s.exited
      );
      if (existingHeadless) continue;

      // Skip repos that have a promoted (visible) workflow session still running.
      const existingPromoted = sessions.find(
        (s) =>
          s.projectPath === repo.path &&
          s.isHeadlessPromoted &&
          isWorkflowLabel(s.label) &&
          !s.dead &&
          !s.headlessCompleted
      );
      if (existingPromoted) continue;

      await handleLaunchSession(repo.path, repo.name);
    }
    setBatchRunning(false);
  }, [repos, headlessSessions, sessions, handleLaunchSession]);

  // Group repos by workspace
  const grouped = groupByWorkspace(repos);
  const totalGroomed = repos.reduce((sum, r) => sum + r.groomedCount + r.activeCount, 0);

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
          <span className="dashboard-tab-header-count">{totalGroomed} tasks</span>
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
            onClick={handleBatchStart}
            disabled={batchRunning || totalGroomed === 0}
            title="Launch /reggie-code-workflow for all repos with tasks using smart agent count"
          >
            {batchRunning ? "Launching..." : "Batch Start Coding"}
          </button>
        </div>
      </div>

      {noTasksMessage && (
        <div style={{ fontSize: "11px", color: "var(--text-muted)", padding: "6px 0" }}>{noTasksMessage}</div>
      )}

      <div className="dashboard-tab-list">
        {grouped.map((group) => (
          <div key={group.name} className="dashboard-tab-group">
            {group.isWorkspace && (
              <div className="dashboard-tab-group-header">
                <span className="dashboard-tab-group-name">{group.name}</span>
                <span className="dashboard-tab-group-count">
                  {group.repos.reduce((sum, r) => sum + r.groomedCount + r.activeCount, 0)} tasks
                </span>
              </div>
            )}
            {group.repos.map((repo) => {
              const repoSessions = headlessSessions.filter(
                (s) => s.projectPath === repo.path && isWorkflowLabel(s.label)
              );
              const repoTabs = sessions.filter(
                (s) => s.projectPath === repo.path
              );

              return (
                <RepoTaskRow
                  key={repo.path}
                  repo={repo}
                  mode="code"
                  headlessSessions={repoSessions}
                  repoTabs={repoTabs}
                  onLaunchSession={handleLaunchSession}
                  onOpenSession={onPromoteHeadless}
                  onHideSession={onHideSession}
                  onPromoteSession={onPromoteSession}
                  onDismissSession={onRemoveHeadless}
                  onKillSession={onKillSession}
                  onKillPromotedSession={onKillPromotedSession}
                  onTrashSession={onTrashSession}
                  onStartTask={handleStartIndividualTask}
                  onWalkThroughTask={handleWalkThroughTask}
                />
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
