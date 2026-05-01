import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { RepoTaskSummary, HeadlessSession, TerminalTab } from "../../types/terminal";
import { RepoTaskRow } from "./RepoTaskRow";
import { groupByWorkspace } from "./groupByWorkspace";
import { getCachedBindings, onBindingsChange } from "../../lib/pipelineBindings";
import { domainForLabel, isWorkflowLabel, slugFromLabel } from "./sessionLabels";

interface ParallelizableTaskSlug {
  slug: string;
  tier: string | null;
  mode: string | null;
}

interface ParallelizableTasksResult {
  activeSlugs: ParallelizableTaskSlug[];
  backlogSlugs: ParallelizableTaskSlug[];
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
  // reggie-system is never bindable — always uses the hardcoded command.
  if (mode === "reggie-system") {
    return { command: "/reggie-system-change --yes", labelPrefix: "reggie-sys --" };
  }
  const bindings = getCachedBindings();
  if (mode === "debug") {
    const command = bindings.debug ? `/${bindings.debug} --yes` : "/reggie-debug-workflow --yes";
    return { command, labelPrefix: "debug --" };
  }
  if (mode === "manual") {
    // Manual mode dispatch via commandForMode is a fallback path
    // (handleWalkThroughTask owns the primary manual flow). Label prefix
    // stays "code --" per the mode-driven label-prefix rule.
    const command = bindings.manual ? `/${bindings.manual}` : "/reggie-manual-task";
    return { command, labelPrefix: "code --" };
  }
  // code, design, null/undefined → code workflow
  const command = bindings.code ? `/${bindings.code} --yes` : "/reggie-code-workflow --yes";
  return { command, labelPrefix: "code --" };
}

// `isWorkflowLabel` and `domainForLabel` live in `./sessionLabels` — single source
// of truth shared with `RepoTaskRow.tsx`. Re-export here for any external consumers
// that imported `isWorkflowLabel` from this module historically.
export { isWorkflowLabel };

/** Per-domain caps applied client-side after the backend returns parallelizable slugs. */
const DOMAIN_CAPS = {
  code: 5,
  reggieSystem: 1,
  debug: 3,
} as const;

/**
 * Pick the slugs to launch from `backlog`, capped per-domain by `remaining` slots.
 *
 * Returns the concatenated list in dispatch order: code/design, then reggie-system, then debug.
 *
 * `activeSlugs` is a defensive consumer-side filter: any backlog entry whose slug is
 * already in the set is dropped before per-domain slicing. This makes the no-duplicate-
 * launch invariant explicit at the call site rather than inherited from the backend's
 * `activeSlugs`/`backlogSlugs` split — a regression in `get_parallelizable_tasks`
 * cannot re-introduce double launches as long as callers pass a correct active set.
 *
 * The set is keyed by slug only because `pickBacklogToLaunch` is invoked per-repo;
 * cross-repo slug collisions cannot occur within a single call's scope.
 */
export function pickBacklogToLaunch(
  backlog: ParallelizableTaskSlug[],
  remaining: { code: number; reggieSystem: number; debug: number },
  activeSlugs: Set<string> = new Set(),
): ParallelizableTaskSlug[] {
  const eligible = activeSlugs.size === 0
    ? backlog
    : backlog.filter((s) => !activeSlugs.has(s.slug));
  const codeDesign = eligible
    .filter((s) => !s.mode || s.mode === "code" || s.mode === "design")
    .slice(0, Math.max(0, remaining.code));
  const reggieSystem = eligible
    .filter((s) => s.mode === "reggie-system")
    .slice(0, Math.max(0, remaining.reggieSystem));
  const debug = eligible
    .filter((s) => s.mode === "debug")
    .slice(0, Math.max(0, remaining.debug));
  return [...codeDesign, ...reggieSystem, ...debug];
}

/**
 * Pick the repo currently holding the workspace-wide reggie-system slot.
 *
 * Iterates both running headless sessions and promoted-but-still-running terminal
 * tabs, sorts the candidates by `terminalId` ascending, and returns the first match's
 * `{ repoPath, repoName }`. Sorting by UUID makes the result deterministic across
 * renders even during the transient mid-promotion window when the same session
 * appears in both arrays — the previous "iterate headless first, then sessions"
 * approach gave a non-deterministic badge name depending on which array's iteration
 * resolved first. The order is stable, not chronological — that's all the badge needs.
 */
export function pickReggieSystemHolder(
  headlessSessions: HeadlessSession[],
  sessions: TerminalTab[],
): { repoPath: string; repoName: string } | null {
  const candidates: { terminalId: string; projectPath: string }[] = [];
  for (const s of headlessSessions) {
    if (s.exited || s.completed) continue;
    if (domainForLabel(s.label) !== "reggieSystem") continue;
    candidates.push({ terminalId: s.terminalId, projectPath: s.projectPath });
  }
  for (const s of sessions) {
    if (!s.isHeadlessPromoted) continue;
    if (s.dead || s.headlessCompleted) continue;
    if (s.terminalId === null) continue;
    if (domainForLabel(s.label) !== "reggieSystem") continue;
    candidates.push({ terminalId: s.terminalId, projectPath: s.projectPath });
  }
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => (a.terminalId < b.terminalId ? -1 : a.terminalId > b.terminalId ? 1 : 0));
  const winner = candidates[0];
  const repoName = winner.projectPath.split(/[/\\]/).pop() ?? "";
  return { repoPath: winner.projectPath, repoName };
}

/**
 * Count currently-running sessions per domain (code / reggie-system / debug).
 *
 * Counts both:
 *   - headless sessions where `!s.exited && !s.completed` (still running, not yet finished)
 *   - promoted sessions where `s.isHeadlessPromoted && !s.dead && !s.headlessCompleted`
 *
 * When `repoPath` is provided, filter to that repo. When undefined, count workspace-wide.
 *
 * Sessions whose label has no domain (e.g. `init-tasks --` or any custom label) are
 * ignored — they do not count toward any of the three domain caps.
 */
export function countRunningByDomain(
  headlessSessions: HeadlessSession[],
  sessions: TerminalTab[],
  repoPath?: string,
): { code: number; reggieSystem: number; debug: number } {
  const counts = { code: 0, reggieSystem: 0, debug: 0 };
  const matchesRepo = (path: string) => repoPath === undefined || path === repoPath;

  for (const s of headlessSessions) {
    if (s.exited || s.completed) continue;
    if (!matchesRepo(s.projectPath)) continue;
    const domain = domainForLabel(s.label);
    if (domain === "code") counts.code++;
    else if (domain === "reggieSystem") counts.reggieSystem++;
    else if (domain === "debug") counts.debug++;
  }
  for (const s of sessions) {
    if (!s.isHeadlessPromoted) continue;
    if (s.dead || s.headlessCompleted) continue;
    if (!matchesRepo(s.projectPath)) continue;
    const domain = domainForLabel(s.label);
    if (domain === "code") counts.code++;
    else if (domain === "reggieSystem") counts.reggieSystem++;
    else if (domain === "debug") counts.debug++;
  }
  return counts;
}

/**
 * Count currently-running reggie-system sessions across the entire workspace.
 *
 * Used for the group-wide reggie-system cap (1 across all repos) — reggie-system
 * tasks modify shared `~/.claude/`, so only one may run at a time regardless of
 * which repo it belongs to.
 */
export function countRunningReggieSystemAcrossWorkspace(
  headlessSessions: HeadlessSession[],
  sessions: TerminalTab[],
): number {
  return countRunningByDomain(headlessSessions, sessions).reggieSystem;
}

interface CodeWorkflowTabProps {
  activeLevelPath: string | null;
  headlessSessions: HeadlessSession[];
  sessions: TerminalTab[];
  onLaunchHeadless: (projectPath: string, initialCommand: string, label: string, model?: string, effort?: string, autoRelaunch?: boolean) => Promise<string | null>;
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
  const relaunchedTerminalIdsRef = useRef<Set<string>>(new Set());
  const recentlyCompletedSlugsRef = useRef<Map<string, number>>(new Map());

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

  /**
   * Launch backlog tasks for a single repo, capped per-domain by remaining slots.
   *
   * `reggieSystemRemainingOverride` is used by Batch Start to thread a global
   * (workspace-wide) reggie-system slot allocation that accounts for in-flight
   * launches earlier in the same batch iteration. When undefined, we compute
   * a fresh global value from the current `headlessSessions` + `sessions` snapshot.
   *
   * Returns `{ reggieSystemLaunched }` so Batch Start can advance its in-flight
   * counter between iterations.
   */
  const launchForRepo = useCallback(
    async (
      repoPath: string,
      repoName: string,
      reggieSystemRemainingOverride?: number,
    ): Promise<{ reggieSystemLaunched: number }> => {
      try {
        const result = await invoke<ParallelizableTasksResult>("get_parallelizable_tasks", {
          projectPath: repoPath,
        });
        if (result.activeSlugs.length === 0 && result.backlogSlugs.length === 0) {
          showNoTasksMessage(repoName);
          return { reggieSystemLaunched: 0 };
        }

        // Defense-in-depth filter against the race where TASKS.md re-scan happens
        // before the backend's meta-commit lands. Drop slugs we just relaunched off of.
        // Keyed by `${repoPath}::${slug}` so a same-named slug in another repo isn't suppressed.
        const now = Date.now();
        for (const [key, ts] of recentlyCompletedSlugsRef.current) {
          if (now - ts > 5000) recentlyCompletedSlugsRef.current.delete(key);
        }
        const filteredBacklog = result.backlogSlugs.filter(
          (s) => !recentlyCompletedSlugsRef.current.has(`${repoPath}::${s.slug}`),
        );

        // Per-domain remaining slots: cap minus currently-running per repo for code/debug,
        // cap minus currently-running across the whole workspace for reggie-system.
        // Active slugs never reach the launch loop — backend splits them into
        // `activeSlugs` precisely so the frontend can count them as already-running and
        // never re-dispatch them.
        const runningPerRepo = countRunningByDomain(headlessSessions, sessions, repoPath);
        const reggieSystemRemaining =
          reggieSystemRemainingOverride !== undefined
            ? reggieSystemRemainingOverride
            : Math.max(
                0,
                DOMAIN_CAPS.reggieSystem -
                  countRunningReggieSystemAcrossWorkspace(headlessSessions, sessions),
              );
        const remaining = {
          code: Math.max(0, DOMAIN_CAPS.code - runningPerRepo.code),
          reggieSystem: reggieSystemRemaining,
          debug: Math.max(0, DOMAIN_CAPS.debug - runningPerRepo.debug),
        };

        // Defensive slug filter: build the set of slugs already running for this
        // repo across both headless sessions and promoted terminal tabs. Passed
        // to `pickBacklogToLaunch` so a backend regression in `activeSlugs`/
        // `backlogSlugs` partitioning cannot re-introduce duplicate launches.
        const activeSlugs = new Set<string>();
        for (const s of headlessSessions) {
          if (s.exited || s.completed) continue;
          if (s.projectPath !== repoPath) continue;
          const slug = slugFromLabel(s.label);
          if (slug) activeSlugs.add(slug);
        }
        for (const s of sessions) {
          if (!s.isHeadlessPromoted) continue;
          if (s.dead || s.headlessCompleted) continue;
          if (s.projectPath !== repoPath) continue;
          const slug = slugFromLabel(s.label);
          if (slug) activeSlugs.add(slug);
        }

        const toLaunch = pickBacklogToLaunch(filteredBacklog, remaining, activeSlugs);
        if (toLaunch.length === 0) {
          showNoTasksMessage(repoName);
          return { reggieSystemLaunched: 0 };
        }

        let reggieSystemLaunched = 0;
        for (const entry of toLaunch) {
          const { model, effort } = parseTier(entry.tier);
          const { command, labelPrefix } = commandForMode(entry.mode);
          await onLaunchHeadless(
            repoPath,
            `${command} ${entry.slug}`,
            `${labelPrefix} ${repoName}/${entry.slug}`,
            model,
            effort,
            true,
          );
          if (entry.mode === "reggie-system") reggieSystemLaunched++;
        }
        return { reggieSystemLaunched };
      } catch (err) {
        console.error("Failed to get parallelizable tasks:", err);
        return { reggieSystemLaunched: 0 };
      }
    },
    [onLaunchHeadless, showNoTasksMessage, headlessSessions, sessions]
  );

  const handleLaunchSession = useCallback(
    async (repoPath: string, repoName: string) => {
      await launchForRepo(repoPath, repoName);
    },
    [launchForRepo]
  );

  // Auto-relaunch: when a session originally launched with autoRelaunch:true completes
  // successfully, kick off a fresh launchForRepo for the same repo. Idempotent on
  // terminalId via relaunchedTerminalIdsRef so a session only ever triggers one relaunch.
  useEffect(() => {
    void (async () => {
      for (const session of headlessSessions) {
        if (!session.completed || !session.autoRelaunch) continue;
        if (relaunchedTerminalIdsRef.current.has(session.terminalId)) continue;
        relaunchedTerminalIdsRef.current.add(session.terminalId);
        const slug = session.label.split("/").pop();
        if (slug) recentlyCompletedSlugsRef.current.set(`${session.projectPath}::${slug}`, Date.now());

        const ownResult = await launchForRepo(session.projectPath, session.projectName);

        // reggie-system has a workspace-wide cap of 1. The just-completed session
        // freed the slot — fan out to peers sequentially with a threaded in-flight
        // counter so two peers can't race into the same slot from parallel calls.
        if (domainForLabel(session.label) === "reggieSystem") {
          let inFlight = ownResult.reggieSystemLaunched;
          for (const other of repos) {
            if (other.path === session.projectPath) continue;
            const remaining = Math.max(0, DOMAIN_CAPS.reggieSystem - inFlight);
            if (remaining === 0) break;
            const { reggieSystemLaunched } = await launchForRepo(other.path, other.name, remaining);
            inFlight += reggieSystemLaunched;
          }
        }
      }
    })();
  }, [headlessSessions, launchForRepo, repos]);

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
        const { command } = commandForMode("manual");
        const terminalId = await onLaunchHeadless(
          repoPath,
          `${command} ${slug}`,
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
    // Snapshot reggie-system running once before the loop. We then track
    // in-flight launches with a local counter, because React's batched
    // state updates may not flush between `await` points — relying on
    // `headlessSessions` re-snapshots within the loop would let two repos
    // both observe "0 running" and double-launch the workspace-wide slot.
    const reggieSystemGlobalRunning = countRunningReggieSystemAcrossWorkspace(
      headlessSessions,
      sessions,
    );
    let inFlightReggieSystem = 0;

    for (const repo of reposWithTasks) {
      // No per-repo skip here: cross-domain dispatch must work even when the repo
      // already has a workflow session running for one domain (e.g. an active
      // [code] session must not block the [reggie-system] backlog task from this
      // repo, and must not block the [debug] backlog tasks). Per-domain remaining
      // slots in `launchForRepo` enforce the right thing.
      const reggieSystemRemainingOverride = Math.max(
        0,
        DOMAIN_CAPS.reggieSystem - reggieSystemGlobalRunning - inFlightReggieSystem,
      );
      const { reggieSystemLaunched } = await launchForRepo(
        repo.path,
        repo.name,
        reggieSystemRemainingOverride,
      );
      inFlightReggieSystem += reggieSystemLaunched;
    }
    setBatchRunning(false);
  }, [repos, headlessSessions, sessions, launchForRepo]);

  // Identify the repo that currently holds the workspace-wide reggie-system slot.
  // Other repos with a `[reggie-system]` task in their backlog will show a
  // "deferred — slot held by <repo>" badge.
  const reggieSystemHolder = useMemo<{ repoPath: string; repoName: string } | null>(
    () => pickReggieSystemHolder(headlessSessions, sessions),
    [headlessSessions, sessions],
  );

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
      <BindingsStatusStrip />
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

              // A repo's reggie-system task is "deferred" when another repo currently holds
              // the workspace-wide slot. We only show the badge when this repo actually has
              // a [reggie-system] task in its backlog, otherwise the message is meaningless.
              const hasReggieSystemBacklog = (repo.groomedTasks ?? []).some(
                (t) => t.mode === "reggie-system",
              );
              const reggieSystemDeferred =
                reggieSystemHolder !== null &&
                reggieSystemHolder.repoPath !== repo.path &&
                hasReggieSystemBacklog;
              const reggieSystemHolderName = reggieSystemDeferred
                ? reggieSystemHolder!.repoName
                : null;

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
                  reggieSystemDeferred={reggieSystemDeferred}
                  reggieSystemHolderName={reggieSystemHolderName}
                />
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Small read-only strip showing the active pipeline bindings for each mode.
 * Reggie-system is omitted because it is not bindable.
 */
function BindingsStatusStrip() {
  // Re-render on any cache change; read the validated view directly so the
  // strip reflects the effective dispatch command, not the raw (possibly
  // uninstalled) binding name.
  const [, setTick] = useState(0);
  useEffect(() => onBindingsChange(() => setTick((n) => n + 1)), []);
  const bindings = getCachedBindings();
  const code = bindings.code ?? "reggie-code-workflow";
  const debug = bindings.debug ?? "reggie-debug-workflow";
  const manual = bindings.manual ?? "reggie-manual-task";
  return (
    <div
      className="pipeline-bindings-strip"
      style={{
        fontSize: "11px",
        color: "var(--text-muted)",
        padding: "4px 0",
        lineHeight: 1.4,
      }}
    >
      <span>Code: {code} · Debug: {debug} · Manual: {manual}</span>
      <div style={{ opacity: 0.75 }}>configure in Pipelines panel</div>
    </div>
  );
}

