import { useState, useEffect, useCallback, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { Project } from "../../types/project";
import type { ClaudeUsageStats } from "../../types/project-info";
import { formatTokens } from "../../types/project-info";
import type { TerminalTab, HeadlessSession, RepoTaskSummary } from "../../types/terminal";
import { InitTasksTab } from "./InitTasksTab";
import { CodeWorkflowTab } from "./CodeWorkflowTab";

type OverviewTab = "brain-dump" | "init-tasks" | "code-workflow";

interface WorkspaceOverviewProps {
  projects: Project[];
  activeLevel: { type: "all-projects" | "workspace" | "repo"; name: string; path: string } | null;
  notes: string;
  onNotesChange: (notes: string) => void;
  textareaHeight: number | null;
  onTextareaHeightChange: (height: number | null) => void;
  onStartWorkflow: (notes: string) => void;
  onRunSkill: (skillName: string) => void;
  headlessSessions: HeadlessSession[];
  sessions: TerminalTab[];
  onLaunchHeadless: (projectPath: string, initialCommand: string, label: string, model?: string, effort?: string, autoRelaunch?: boolean) => Promise<string | null>;
  onSpawnVisibleHeadless: (projectPath: string, initialCommand: string, label: string) => Promise<string | null>;
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

export function WorkspaceOverview({
  projects,
  activeLevel,
  notes,
  onNotesChange,
  textareaHeight,
  onTextareaHeightChange,
  onStartWorkflow,
  onRunSkill,
  headlessSessions,
  sessions,
  onLaunchHeadless,
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
}: WorkspaceOverviewProps) {
  const [usage, setUsage] = useState<ClaudeUsageStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<OverviewTab>("brain-dump");

  // Reset tab to brain-dump when activeLevel changes
  const activeLevelPath = activeLevel?.path ?? null;
  useEffect(() => {
    setActiveTab("brain-dump");
  }, [activeLevelPath]);

  const loadDashboard = useCallback(() => {
    setLoading(true);
    invoke<ClaudeUsageStats>("get_claude_usage_stats")
      .catch(() => null)
      .then((usageStats) => {
        setUsage(usageStats);
        setLoading(false);
      });
  }, []);

  // Defer usage stats fetch so it doesn't block initial render
  useEffect(() => {
    const timer = setTimeout(() => {
      loadDashboard();
    }, 300);
    return () => clearTimeout(timer);
  }, [loadDashboard]);

  // Refresh on window focus with debounce (skip if refreshed within 30s)
  const lastLoadRef = useRef(0);
  useEffect(() => {
    const onFocus = () => {
      if (Date.now() - lastLoadRef.current > 30_000) {
        lastLoadRef.current = Date.now();
        loadDashboard();
      }
    };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [loadDashboard]);

  const totalTokens = usage
    ? Object.values(usage.modelUsage).reduce(
        (sum, m) => sum + m.inputTokens + m.outputTokens + m.cacheReadInputTokens + m.cacheCreationInputTokens,
        0
      )
    : 0;

  // Today's activity (use local date, not UTC)
  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  const todayData = usage?.dailyActivity.find((d) => d.date === today);

  // Track textarea height via ResizeObserver so it persists across remounts
  const onTextareaHeightChangeRef = useRef(onTextareaHeightChange);
  onTextareaHeightChangeRef.current = onTextareaHeightChange;
  const observerRef = useRef<ResizeObserver | null>(null);

  const textareaCallbackRef = useCallback((node: HTMLTextAreaElement | null) => {
    // Disconnect previous observer
    if (observerRef.current) {
      observerRef.current.disconnect();
      observerRef.current = null;
    }
    if (!node) return;

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const height = entry.contentRect.height + (node.offsetHeight - node.clientHeight);
        onTextareaHeightChangeRef.current(height);
      }
    });
    observer.observe(node);
    observerRef.current = observer;
  }, []);

  const handleStartWorkflow = useCallback(() => {
    onStartWorkflow(notes);
  }, [notes, onStartWorkflow]);

  const commandName = activeLevel?.type === "repo" ? "/reggie-init-tasks" : "/reggie-distribute-tasks";
  const buttonLabel = activeLevel?.type === "repo"
    ? `Init Tasks (${commandName})`
    : `Distribute Tasks (${commandName})`;

  return (
    <div className="dashboard">
      {/* Content tab bar */}
      <div className="overview-tabs">
        <button
          className={`overview-tab${activeTab === "brain-dump" ? " active" : ""}`}
          onClick={() => setActiveTab("brain-dump")}
        >
          Brain Dump
        </button>
        <button
          className={`overview-tab${activeTab === "init-tasks" ? " active" : ""}`}
          onClick={() => setActiveTab("init-tasks")}
        >
          Init Tasks
        </button>
        <button
          className={`overview-tab${activeTab === "code-workflow" ? " active" : ""}`}
          onClick={() => setActiveTab("code-workflow")}
        >
          Code Workflow
        </button>
      </div>

      {/* Brain Dump tab */}
      {activeTab === "brain-dump" && (
        <>
          {/* Hero section */}
          <div className="dash-hero">
            <div className="dash-hero-left">
              <h1 className="dash-title">{activeLevel?.name || "Workspace"}</h1>
              <p className="dash-subtitle">{projects.length} projects</p>
            </div>
            <div className="dash-hero-actions">
              <button className="dash-agent-btn dash-agent-btn-secondary" onClick={() => onRunSkill("reggie-setup-workspace-docs")}>
                <div className="dash-agent-icon">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                    <polyline points="14 2 14 8 20 8" />
                    <line x1="16" y1="13" x2="8" y2="13" />
                    <line x1="16" y1="17" x2="8" y2="17" />
                    <polyline points="10 9 9 9 8 9" />
                  </svg>
                </div>
                <div className="dash-agent-text">
                  <span className="dash-agent-label">Setup Docs</span>
                  <span className="dash-agent-desc">Generate workspace documentation for task routing</span>
                </div>
              </button>
            </div>
          </div>

          {loading ? (
            <div className="dash-loading">Scanning projects...</div>
          ) : (
            <>
              {/* Quick stats row */}
              {usage && (
                <div className="dash-stats-row">
                  <div className="dash-stat-card">
                    <span className="dash-stat-value">{projects.length}</span>
                    <span className="dash-stat-label">Projects</span>
                  </div>
                  <div className="dash-stat-card">
                    <span className="dash-stat-value">{usage.totalSessions}</span>
                    <span className="dash-stat-label">Sessions</span>
                  </div>
                  <div className="dash-stat-card">
                    <span className="dash-stat-value">{usage.totalMessages.toLocaleString()}</span>
                    <span className="dash-stat-label">Messages</span>
                  </div>
                  <div className="dash-stat-card">
                    <span className="dash-stat-value">{formatTokens(totalTokens)}</span>
                    <span className="dash-stat-label">Tokens</span>
                  </div>
                  {todayData && (
                    <div className="dash-stat-card accent">
                      <span className="dash-stat-value">{todayData.messageCount}</span>
                      <span className="dash-stat-label">Today</span>
                    </div>
                  )}
                </div>
              )}

              {/* Workflow section */}
              <div className="workflow-section">
                {activeLevel && (
                  <div className="workflow-level">
                    <span className="workflow-level-type">
                      {activeLevel.type === "all-projects" ? "All Projects" : activeLevel.type === "workspace" ? "Workspace" : "Repo"}
                    </span>
                    <span className="workflow-level-name">{activeLevel.name}</span>
                  </div>
                )}

                <textarea
                  ref={textareaCallbackRef}
                  className="workflow-textarea"
                  placeholder="Write your notes, task descriptions, or instructions here..."
                  value={notes}
                  onChange={(e) => onNotesChange(e.target.value)}
                  rows={12}
                  style={textareaHeight != null ? { height: `${textareaHeight}px` } : undefined}
                />

                <div className="workflow-actions">
                  <button
                    className="workflow-btn workflow-btn-primary"
                    onClick={handleStartWorkflow}
                    disabled={!activeLevel}
                    title={activeLevel ? `Run ${commandName} at ${activeLevel.name}` : "Select a project or workspace first"}
                  >
                    {buttonLabel}
                  </button>
                </div>
              </div>
            </>
          )}
        </>
      )}

      {/* Init Tasks tab */}
      {activeTab === "init-tasks" && (
        <InitTasksTab
          activeLevelPath={activeLevel?.path ?? null}
          headlessSessions={headlessSessions}
          sessions={sessions}
          onSpawnVisibleHeadless={onSpawnVisibleHeadless}
          onPromoteHeadless={onPromoteHeadless}
          onPromoteSession={onPromoteSession}
          onRemoveHeadless={onRemoveHeadless}
          onHideSession={onHideSession}
          onKillSession={onKillSession}
          onTrashCompleted={onTrashCompleted}
          onTrashSession={onTrashSession}
          onKillPromotedSession={onKillPromotedSession}
          trackedRepos={trackedRepos}
          reposLoading={reposLoading}
          onRefreshRepos={onRefreshRepos}
        />
      )}

      {/* Code Workflow tab */}
      {activeTab === "code-workflow" && (
        <CodeWorkflowTab
          activeLevelPath={activeLevel?.path ?? null}
          headlessSessions={headlessSessions}
          sessions={sessions}
          onLaunchHeadless={onLaunchHeadless}
          onPromoteHeadless={onPromoteHeadless}
          onPromoteSession={onPromoteSession}
          onRemoveHeadless={onRemoveHeadless}
          onHideSession={onHideSession}
          onKillSession={onKillSession}
          onKillPromotedSession={onKillPromotedSession}
          onTrashCompleted={onTrashCompleted}
          onTrashSession={onTrashSession}
          trackedRepos={trackedRepos}
          reposLoading={reposLoading}
          onRefreshRepos={onRefreshRepos}
        />
      )}
    </div>
  );
}
