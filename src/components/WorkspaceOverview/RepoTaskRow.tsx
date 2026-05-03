import { useState, useEffect, useCallback, useMemo } from "react";
import type { RepoTaskSummary, HeadlessSession, TerminalTab } from "../../types/terminal";
import { domainForLabel, isWorkflowLabel } from "./sessionLabels";

interface RepoTaskRowProps {
  repo: RepoTaskSummary;
  mode: "init" | "code";
  headlessSessions: HeadlessSession[];
  repoTabs?: TerminalTab[];
  onLaunchSession: (repoPath: string, repoName: string) => void;
  onOpenSession: (terminalId: string) => void;
  onHideSession?: (tabId: string) => void;
  onPromoteSession?: (tabId: string) => void;
  onDismissSession?: (terminalId: string) => void;
  onKillSession?: (terminalId: string) => void;
  onTrashSession?: (terminalId: string) => void;
  onKillPromotedSession?: (tabId: string) => void;
  /** Headless dispatch of a single backlog task. `mode` selects the workflow command. */
  onStartTask?: (
    repoPath: string,
    repoName: string,
    slug: string,
    tier?: string,
    mode?: string | null,
  ) => void;
  /** Visible dispatch of a `[manual]` task — launches `/reggie-manual-task` and promotes the session. */
  onWalkThroughTask?: (repoPath: string, repoName: string, slug: string) => void;
  /**
   * Whether this repo has a `[reggie-system]` backlog task that is currently blocked by
   * another repo holding the workspace-wide reggie-system slot. Renders a "deferred" badge.
   */
  reggieSystemDeferred?: boolean;
  /** Name of the repo currently holding the reggie-system slot. */
  reggieSystemHolderName?: string | null;
}

function extractSlug(label: string): string {
  // Labels look like "code -- repoName/slug" or "init-tasks -- repoName"
  const slashIndex = label.lastIndexOf("/");
  if (slashIndex !== -1) {
    return label.substring(slashIndex + 1);
  }
  // No slash -- use part after " -- " if present
  const dashIndex = label.indexOf(" -- ");
  if (dashIndex !== -1) {
    return label.substring(dashIndex + 4);
  }
  return label;
}

export function RepoTaskRow({
  repo,
  mode,
  headlessSessions,
  repoTabs,
  onLaunchSession,
  onOpenSession,
  onHideSession,
  onPromoteSession,
  onDismissSession,
  onKillSession,
  onTrashSession,
  onKillPromotedSession,
  onStartTask,
  onWalkThroughTask,
  reggieSystemDeferred = false,
  reggieSystemHolderName = null,
}: RepoTaskRowProps) {
  const [expanded, setExpanded] = useState(false);

  const count = mode === "init" ? repo.ungroomedCount : repo.groomedCount + repo.activeCount;
  const isDone = count === 0;

  // Promoted sessions: tabs that were promoted from headless and match this mode.
  // In code mode we accept any workflow domain (code, reggie-sys, debug). In init mode we
  // still match only the "init-tasks" prefix.
  const promotedSessions = useMemo(() => {
    if (!repoTabs) return [];
    if (mode === "init") {
      return repoTabs.filter(
        (s) => s.isHeadlessPromoted && s.label.startsWith("init-tasks"),
      );
    }
    return repoTabs.filter(
      (s) => s.isHeadlessPromoted && isWorkflowLabel(s.label),
    );
  }, [repoTabs, mode]);

  // Filter out headless sessions that have been promoted to avoid duplicate rows
  const promotedTerminalIds = useMemo(() => {
    return new Set(promotedSessions.map((s) => s.headlessTerminalId).filter(Boolean));
  }, [promotedSessions]);

  const unpromotedHeadlessSessions = useMemo(() => {
    return headlessSessions.filter((s) => !promotedTerminalIds.has(s.terminalId));
  }, [headlessSessions, promotedTerminalIds]);

  // Task items for expansion (init mode shows ungroomed, code mode shows groomed + active)
  // In code mode, filter out tasks that already have a matching session (any status)
  const taskItems = useMemo(() => {
    if (mode === "init") return repo.ungroomedTasks ?? [];
    const groomed = repo.groomedTasks ?? [];
    const active = repo.activeTasks ?? [];
    const combined = [...active, ...groomed];
    if (combined.length === 0) return combined;
    // Collect all session slugs to deduplicate against
    const sessionSlugs = new Set<string>();
    for (const s of promotedSessions) {
      sessionSlugs.add(extractSlug(s.label));
    }
    for (const s of unpromotedHeadlessSessions) {
      sessionSlugs.add(extractSlug(s.label));
    }
    if (sessionSlugs.size === 0) return combined;
    return combined.filter((item) => !sessionSlugs.has(item.slug));
  }, [mode, repo.ungroomedTasks, repo.groomedTasks, repo.activeTasks, promotedSessions, unpromotedHeadlessSessions]);

  const hasSessions = unpromotedHeadlessSessions.length > 0 || promotedSessions.length > 0;
  const isExpandable = unpromotedHeadlessSessions.length > 0 || promotedSessions.length > 0 || taskItems.length > 0;

  // Check if any sessions for this repo are visible on the Sessions tab
  const inFocusCount = useMemo(() => {
    if (!repoTabs) return 0;
    return repoTabs.filter((s) => s.visible !== false).length;
  }, [repoTabs]);

  const aggregate = useMemo(() => {
    // Per-domain running counts (code/design, reggie-system, debug). Other status
    // counts (attention/exited/completed) stay flat — domain-splitting them adds
    // little signal for the user and clutters the badge row.
    let runningCode = 0;
    let runningReggieSystem = 0;
    let runningDebug = 0;
    let runningOther = 0;
    let attention = 0;
    let exited = 0;
    let completed = 0;

    const tallyRunning = (label: string) => {
      const domain = domainForLabel(label);
      if (domain === "code") runningCode++;
      else if (domain === "reggieSystem") runningReggieSystem++;
      else if (domain === "debug") runningDebug++;
      else runningOther++;
    };

    for (const s of unpromotedHeadlessSessions) {
      if (s.completed) {
        completed++;
      } else if (s.exited) {
        exited++;
      } else if (s.needsAttention) {
        attention++;
      } else {
        tallyRunning(s.label);
      }
    }
    // Count promoted sessions as running (they are live terminal views)
    for (const s of promotedSessions) {
      if (s.dead || s.headlessCompleted) {
        completed++;
      } else {
        tallyRunning(s.label);
      }
    }
    const running = runningCode + runningReggieSystem + runningDebug + runningOther;
    return {
      running,
      runningCode,
      runningReggieSystem,
      runningDebug,
      runningOther,
      attention,
      exited,
      completed,
    };
  }, [unpromotedHeadlessSessions, promotedSessions]);

  const handleDismissAll = useCallback(() => {
    if (!onDismissSession) return;
    for (const s of unpromotedHeadlessSessions) {
      if (s.exited) {
        onDismissSession(s.terminalId);
      }
    }
  }, [unpromotedHeadlessSessions, onDismissSession]);

  const handleLaunch = useCallback(() => {
    onLaunchSession(repo.path, repo.name);
  }, [repo.path, repo.name, onLaunchSession]);

  useEffect(() => {
    if (!isExpandable) setExpanded(false);
  }, [isExpandable]);

  const handleToggleExpand = useCallback(() => {
    if (isExpandable) {
      setExpanded((prev) => !prev);
    }
  }, [isExpandable]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      handleToggleExpand();
    }
  }, [handleToggleExpand]);

  // Aggregate status label for collapsed state (when sessions exist).
  // Running is split per-domain so users can see "2 code running, 1 reggie-sys running, 3 debug running"
  // at a glance. Non-running statuses stay flat.
  const aggregateBadges = useMemo(() => {
    if (!hasSessions) return null;
    const parts: { key: string; label: string; className: string }[] = [];
    // For init mode (where labels carry no workflow prefix) and any sessions whose label
    // isn't workflow-prefixed, fall back to a flat "N running" badge.
    if (mode === "init") {
      if (aggregate.running > 0) {
        parts.push({ key: "running", label: `${aggregate.running} running`, className: "running" });
      }
    } else {
      if (aggregate.runningCode > 0) {
        parts.push({
          key: "running-code",
          label: `${aggregate.runningCode} code running`,
          className: "running",
        });
      }
      if (aggregate.runningReggieSystem > 0) {
        parts.push({
          key: "running-reggie-sys",
          label: `${aggregate.runningReggieSystem} reggie-sys running`,
          className: "running",
        });
      }
      if (aggregate.runningDebug > 0) {
        parts.push({
          key: "running-debug",
          label: `${aggregate.runningDebug} debug running`,
          className: "running",
        });
      }
      if (aggregate.runningOther > 0) {
        parts.push({
          key: "running-other",
          label: `${aggregate.runningOther} running`,
          className: "running",
        });
      }
    }
    if (aggregate.attention > 0) {
      parts.push({ key: "attention", label: `${aggregate.attention} attention`, className: "attention" });
    }
    if (aggregate.completed > 0) {
      parts.push({ key: "completed", label: `${aggregate.completed} completed`, className: "completed" });
    }
    if (aggregate.exited > 0) {
      parts.push({ key: "exited", label: `${aggregate.exited} exited`, className: "exited" });
    }
    return parts;
  }, [hasSessions, aggregate, mode]);

  const getPromotedTab = useCallback((terminalId: string): TerminalTab | undefined => {
    if (!repoTabs) return undefined;
    return repoTabs.find(
      (s) => s.headlessTerminalId === terminalId
    );
  }, [repoTabs]);

  const handleOpenSession = useCallback((terminalId: string) => {
    // Check if this terminalId has a promoted tab that's hidden
    const promotedTab = getPromotedTab(terminalId);
    if (promotedTab && promotedTab.visible === false && onPromoteSession) {
      onPromoteSession(promotedTab.id);
      return;
    }
    // Fall back to promoting from headless
    onOpenSession(terminalId);
  }, [getPromotedTab, onPromoteSession, onOpenSession]);

  const handleHideSession = useCallback((terminalId: string) => {
    const promotedTab = getPromotedTab(terminalId);
    if (promotedTab && onHideSession) {
      onHideSession(promotedTab.id);
    }
  }, [getPromotedTab, onHideSession]);

  // Pick the action button for a task item based on its mode tag:
  //   manual        -> "Walk through" (visible launch via onWalkThroughTask)
  //   debug         -> "Debug"        (headless via onStartTask)
  //   reggie-system -> "Start"        (headless via onStartTask)
  //   code/design/— -> "Start"        (headless via onStartTask)
  function renderTaskItemActions(item: typeof taskItems[number]) {
    if (!item.slug) return null;
    const itemMode = item.mode ?? null;
    if (itemMode === "manual") {
      if (!onWalkThroughTask) return null;
      return (
        <div className="repo-task-row-session-actions">
          <button
            className="repo-task-row-btn"
            onClick={() => onWalkThroughTask(repo.path, repo.name, item.slug)}
          >
            Walk through
          </button>
        </div>
      );
    }
    if (!onStartTask) return null;
    return (
      <div className="repo-task-row-session-actions">
        <button
          className="repo-task-row-btn"
          onClick={() => onStartTask(repo.path, repo.name, item.slug, undefined, itemMode)}
        >
          {itemMode === "debug" ? "Debug" : "Start"}
        </button>
      </div>
    );
  }

  return (
    <div className={`repo-task-row-container${aggregate.attention > 0 ? " attention" : ""}`}>
      <div
        className={`repo-task-row${isExpandable ? " expandable" : ""}${expanded ? " expanded" : ""}`}
        onClick={isExpandable ? handleToggleExpand : undefined}
        role={isExpandable ? "button" : undefined}
        tabIndex={isExpandable ? 0 : undefined}
        aria-expanded={isExpandable ? expanded : undefined}
        onKeyDown={isExpandable ? handleKeyDown : undefined}
      >
        <div className="repo-task-row-info">
          {isExpandable && (
            <span className={`repo-task-row-chevron${expanded ? " expanded" : ""}`}>
              &#9656;
            </span>
          )}
          <span className="repo-task-row-name">{repo.name}</span>
          <span className="repo-task-row-count">
            {count} {mode === "init" ? "ungroomed" : "tasks"}
          </span>
          {inFocusCount > 0 && (
            <span className="repo-task-row-in-focus">in focus</span>
          )}
        </div>

        <div className="repo-task-row-actions">
          {/* Multi-session aggregate badges (collapsed or expanded) */}
          {((isExpandable && aggregateBadges) || (reggieSystemDeferred && reggieSystemHolderName)) && (
            <div className="repo-task-row-aggregate">
              {isExpandable &&
                aggregateBadges &&
                aggregateBadges.map((badge) => (
                  <span key={badge.key} className={`repo-task-row-aggregate-badge ${badge.className}`}>
                    {badge.className === "running" && <span className="repo-task-row-status-dot" />}
                    {badge.className === "attention" && <span className="repo-task-row-status-pulse" />}
                    {badge.label}
                  </span>
                ))}
              {reggieSystemDeferred && reggieSystemHolderName && (
                <span
                  className="repo-task-row-aggregate-badge deferred"
                  style={{ color: "var(--text-muted)" }}
                >
                  {`1 reggie-system task deferred — slot held by ${reggieSystemHolderName}`}
                </span>
              )}
            </div>
          )}

          {/* Dismiss All button for multi-session rows with exited sessions */}
          {isExpandable && aggregate.exited > 0 && onDismissSession && (
            <button
              className="repo-task-row-btn dismiss"
              onClick={(e) => { e.stopPropagation(); handleDismissAll(); }}
              title="Dismiss all completed sessions"
            >
              Dismiss All
            </button>
          )}

          {/* No-session status */}
          {!hasSessions && isDone && (
            <span className="repo-task-row-status done">Done</span>
          )}

          {/* No sessions and not done: show launch button */}
          {!hasSessions && !isDone && (
            <button className="repo-task-row-btn" onClick={handleLaunch}>
              {mode === "init" ? "Init" : "Start"}
            </button>
          )}
        </div>
      </div>

      {/* Expanded: show individual session rows */}
      {expanded && isExpandable && (
        <div className="repo-task-row-sessions">
          {/* Promoted sessions (visible xterm views) */}
          {promotedSessions.map((tab) => {
            const slug = extractSlug(tab.label);
            const isVisible = tab.visible !== false;
            const isDead = tab.dead || tab.headlessCompleted;
            const statusClass = isDead ? "completed" : "running";
            const statusText = isDead ? "Completed" : "Running";

            return (
              <div key={tab.id} className="repo-task-row-session">
                <div className="repo-task-row-session-info">
                  {isDead ? (
                    <span className="session-completed-badge small">Completed</span>
                  ) : (
                    <span className={`repo-task-row-session-status ${statusClass}`}>
                      <span className="repo-task-row-status-dot" />
                    </span>
                  )}
                  <span className="repo-task-row-session-slug">{slug}</span>
                  {!isDead && (
                    <span className={`repo-task-row-session-label ${statusClass}`}>{statusText}</span>
                  )}
                </div>
                <div className="repo-task-row-session-actions">
                  {isVisible && onHideSession ? (
                    <button
                      className="repo-task-row-btn open"
                      onClick={() => onHideSession(tab.id)}
                    >
                      Hide
                    </button>
                  ) : !isVisible && onPromoteSession ? (
                    <button
                      className="repo-task-row-btn open"
                      onClick={() => onPromoteSession(tab.id)}
                    >
                      Open
                    </button>
                  ) : null}
                  {!isDead && onKillPromotedSession && (
                    <button
                      className="repo-task-row-btn kill"
                      onClick={() => onKillPromotedSession(tab.id)}
                      title="Kill process"
                    >
                      Kill
                    </button>
                  )}
                  {isDead && onKillPromotedSession && (
                    <button
                      className="repo-task-row-btn dismiss"
                      onClick={() => onKillPromotedSession(tab.id)}
                      title="Trash completed session"
                    >
                      Trash
                    </button>
                  )}
                </div>
              </div>
            );
          })}
          {/* Headless sessions (background only, excluding promoted) */}
          {unpromotedHeadlessSessions.map((session) => {
            const slug = extractSlug(session.label);
            const statusClass = session.completed ? "completed" : session.exited ? "exited" : session.needsAttention ? "attention" : "running";
            const statusText = session.completed ? "Completed" : session.exited ? "Exited" : session.needsAttention ? "Needs Attention" : "Running";
            const promotedTab = getPromotedTab(session.terminalId);
            const isViewed = promotedTab !== undefined && promotedTab.visible !== false;

            return (
              <div key={session.terminalId} className={`repo-task-row-session${session.needsAttention ? " attention" : ""}`}>
                <div className="repo-task-row-session-info">
                  {session.completed ? (
                    <span className="session-completed-badge small">Completed</span>
                  ) : (
                    <span className={`repo-task-row-session-status ${statusClass}`}>
                      {statusClass === "running" && <span className="repo-task-row-status-dot" />}
                      {statusClass === "attention" && <span className="repo-task-row-status-pulse" />}
                    </span>
                  )}
                  <span className="repo-task-row-session-slug">{slug}</span>
                  {!session.completed && (
                    <span className={`repo-task-row-session-label ${statusClass}`}>{statusText}</span>
                  )}
                </div>
                <div className="repo-task-row-session-actions">
                  {isViewed ? (
                    <button
                      className="repo-task-row-btn hide"
                      onClick={() => handleHideSession(session.terminalId)}
                    >
                      Hide
                    </button>
                  ) : (
                    <button
                      className="repo-task-row-btn open"
                      onClick={() => handleOpenSession(session.terminalId)}
                    >
                      {session.exited || session.completed ? "View" : "Open"}
                    </button>
                  )}
                  {!session.exited && !session.completed && onKillSession && (
                    <button
                      className="repo-task-row-btn kill"
                      onClick={() => onKillSession(session.terminalId)}
                      title="Kill process"
                    >
                      Kill
                    </button>
                  )}
                  {session.completed && onTrashSession && (
                    <button
                      className="repo-task-row-btn dismiss"
                      onClick={() => onTrashSession(session.terminalId)}
                      title="Trash completed session"
                    >
                      Trash
                    </button>
                  )}
                  {session.exited && !session.completed && onDismissSession && (
                    <button
                      className="repo-task-row-btn dismiss"
                      onClick={() => onDismissSession(session.terminalId)}
                      title="Dismiss completed session"
                    >
                      Dismiss
                    </button>
                  )}
                </div>
              </div>
            );
          })}
          {/* Task items (ungroomed in init mode, groomed in code mode) */}
          {taskItems.map((item, index) => (
            <div key={`task-${item.slug || index}-${item.description}`} className="repo-task-row-session queued">
              <div className="repo-task-row-session-info">
                <span className="repo-task-row-session-slug">
                  {mode === "code"
                    ? (item.slug || item.description)
                    : (item.slug ? `${item.slug}: ${item.description}` : item.description)}
                </span>
              </div>
              {mode === "code" && renderTaskItemActions(item)}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
