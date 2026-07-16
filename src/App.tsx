import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { invoke } from "@tauri-apps/api/core";
import { checkClaudeCli, checkCodexCli, writeToTerminal, openInBrowser } from "./services/terminal-service";
import { AppLayout } from "./components/Layout/AppLayout";
import { Sidebar } from "./components/Sidebar/Sidebar";
import { WorkspaceOverview } from "./components/WorkspaceOverview/WorkspaceOverview";
import { commandForMode } from "./components/WorkspaceOverview/CodeWorkflowTab";
import { loadPipelineBindings, setAvailablePipelineNames } from "./lib/pipelineBindings";
import { ProjectSummaryPanel } from "./components/ProjectSummary/ProjectSummaryPanel";
import { TerminalTabBar } from "./components/Terminal/TerminalTabBar";
import { TerminalView } from "./components/Terminal/TerminalView";
import { HiddenSessionsList } from "./components/Terminal/HiddenSessionsList";
import { FirstLaunchSetup } from "./components/Setup/FirstLaunchSetup";
import { useProjects } from "./hooks/useProjects";
import { useTerminal, HOME_TAB_ID, SESSIONS_TAB_ID } from "./hooks/useTerminal";
import { useSessionTracking } from "./hooks/useSessionTracking";
import type { Project } from "./types/project";
import type { TaskPipeline } from "./types/task";
import type { Workspace } from "./services/database-service";

function App() {
  const {
    projects,
    workspaces,
    allProjectsFolder,
    addProject,
    addWorkspace,
    setAllProjectsFolder,
    removeAllProjectsFolder,
    selectProject,
    removeProject,
    removeWorkspace,
  } = useProjects();

  const {
    tabs,
    activeTabId,
    setActiveTabId,
    addTab,
    openProjectTab,
    goHome,
    removeTab,
    killTab,
    promoteSession,
    setTerminalId,
    markTabDead,
    headlessSessions,
    addHeadlessSession,
    spawnVisibleHeadlessSession,
    promoteHeadlessSession,
    removeHeadlessSession,
    closeAllTabs,
    killAllTerminals,
    trashCompletedSessions,
    trashSession,
    visibleSessions,
    hiddenSessions,
    totalSessionCount,
  } = useTerminal();

  // First-launch setup modal
  const [showSetup, setShowSetup] = useState(false);

  // Populate the pipeline-bindings cache and register available pipeline names
  // at startup so commandForMode can validate bindings against installed pipelines.
  useEffect(() => {
    loadPipelineBindings();
    invoke<{ name: string }[]>("get_pipelines")
      .then((ps) => setAvailablePipelineNames(ps.map((p) => p.name)))
      .catch((err) => console.error("get_pipelines failed; pipeline binding validation disabled:", err));
  }, []);

  useEffect(() => {
    invoke<{ version: string; needsSetup: boolean }>("get_install_status")
      .then((status) => {
        if (status.needsSetup) {
          setShowSetup(true);
        }
      })
      .catch((err) => {
        console.error("Failed to check install status:", err);
      });
  }, []);

  const handleSetupComplete = useCallback(() => {
    setShowSetup(false);
  }, []);

  // Theme state — initialized from persisted value, updated via ActivityBar callback
  const [currentTheme, setCurrentTheme] = useState<"dark" | "light">(() => {
    try {
      const stored = localStorage.getItem("reggie-theme");
      if (stored === "light" || stored === "dark") return stored;
    } catch { /* storage unavailable */ }
    return "light";
  });

  const handleThemeChange = useCallback((theme: "dark" | "light") => {
    setCurrentTheme(theme);
  }, []);

  // Apply persisted theme on mount (before first paint settles)
  useEffect(() => {
    try {
      const stored = localStorage.getItem("reggie-theme");
      const theme = stored === "light" || stored === "dark" ? stored : "light";
      document.documentElement.dataset.theme = theme;
    } catch { /* storage unavailable */ }
  }, []);

  // Persisted task input across tab switches, keyed by project path
  const [taskInputByProject, setTaskInputByProject] = useState<Record<string, string>>({});

  // Track run-locally state per project path
  const [runLocallyState, setRunLocallyState] = useState<Record<string, "idle" | "starting" | "running">>({});
  const [runLocallyTerminals, setRunLocallyTerminals] = useState<Record<string, string>>({});
  const runLocallyTimerRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  // Claude CLI availability — default true to avoid false-blocking before check completes
  const [claudeCliAvailable, setClaudeCliAvailable] = useState<boolean | null>(true);
  const [codexCliAvailable, setCodexCliAvailable] = useState<boolean | null>(true);

  // Defer CLI check so it doesn't compete with initial data loading
  useEffect(() => {
    const timer = setTimeout(() => {
      checkClaudeCli()
        .then((status) => setClaudeCliAvailable(status.available))
        .catch((err) => console.error("Failed to check Claude CLI:", err));
      checkCodexCli()
        .then((status) => setCodexCliAvailable(status.available))
        .catch((err) => console.error("Failed to check Codex CLI:", err));
    }, 500);
    return () => clearTimeout(timer);
  }, []);

  // Drag-and-drop: write file paths into the active terminal
  const [isDragging, setIsDragging] = useState(false);
  const activeTerminalIdRef = useRef<string | null>(null);

  useEffect(() => {
    const activeTab = tabs.find((t) => t.id === activeTabId);
    activeTerminalIdRef.current = activeTab?.terminalId ?? null;
  }, [tabs, activeTabId]);

  useEffect(() => {
    const unlisten = getCurrentWindow().onDragDropEvent((event) => {
      if (event.payload.type === "enter" || event.payload.type === "over") {
        setIsDragging(true);
      } else if (event.payload.type === "leave") {
        setIsDragging(false);
      } else if (event.payload.type === "drop") {
        setIsDragging(false);
        const paths = event.payload.paths;
        const termId = activeTerminalIdRef.current;
        if (termId && paths.length > 0) {
          const pathStr = paths
            .map((p) => (p.includes(" ") ? `"${p}"` : p))
            .join(" ");
          writeToTerminal(termId, pathStr).catch(console.error);
        }
      }
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  // Brain dump notes — lifted from WorkspaceOverview so they persist across tab switches
  const [brainDumpNotes, setBrainDumpNotes] = useState("");
  // Brain dump textarea height — persists user resize across refocus/tab switches
  const [brainDumpHeight, setBrainDumpHeight] = useState<number | null>(null);

  // User-driven active level state (not auto-derived from tabs)
  type ActiveLevel = { type: "all-projects" | "workspace" | "repo"; name: string; path: string } | null;
  const [activeLevel, setActiveLevel] = useState<ActiveLevel>(null);

  // Initialize / reinitialize activeLevel when data sources change
  useEffect(() => {
    setActiveLevel((prev) => {
      // If user already picked something that still exists, keep it
      if (prev) {
        if (prev.type === "all-projects" && allProjectsFolder) return prev;
        if (prev.type === "workspace" && workspaces.some((ws) => ws.path === prev.path)) return prev;
        if (prev.type === "repo" && projects.some((p) => p.path === prev.path)) return prev;
      }
      // Otherwise derive a default
      if (allProjectsFolder) {
        return { type: "all-projects", name: allProjectsFolder.name, path: allProjectsFolder.path };
      }
      if (workspaces.length > 0) {
        return { type: "workspace", name: workspaces[0].name, path: workspaces[0].path };
      }
      if (projects.length > 0) {
        return { type: "repo", name: projects[0].name, path: projects[0].path };
      }
      return null;
    });
  }, [allProjectsFolder, workspaces, projects]);

  // Clear brain dump notes when the user switches activeLevel
  const activeLevelPath = activeLevel?.path ?? null;
  useEffect(() => {
    setBrainDumpNotes("");
    setBrainDumpHeight(null);
  }, [activeLevelPath]);

  // Derive terminal-only tabs early so useSessionTracking can consume them
  // Memoized to provide stable reference for polling interval dependencies
  const terminalTabs = useMemo(() => tabs.filter((t) => !t.isProjectOverview), [tabs]);

  // App-level session tracking — single source of truth for task counts and session status
  const { repos: trackedRepos, summary: sessionSummary, loading: reposLoading, refresh: refreshRepos } =
    useSessionTracking(headlessSessions, terminalTabs, activeLevelPath);

  // Convert TrackedRepo[] back to RepoTaskSummary[] for child components
  const trackedRepoSummaries = useMemo(() => trackedRepos.map((r) => ({
    name: r.repoName,
    path: r.repoPath,
    workspaceName: r.workspaceName,
    ungroomedCount: r.ungroomedTasks,
    groomedCount: r.groomedTasks,
    activeCount: r.activeTasks,
    ungroomedTasks: r.ungroomedTaskItems,
    groomedTasks: r.groomedTaskItems,
    activeTasks: r.activeTaskItems,
  })), [trackedRepos]);

  const handleSelectAllProjects = useCallback(() => {
    if (!allProjectsFolder) return;
    setActiveLevel({ type: "all-projects", name: allProjectsFolder.name, path: allProjectsFolder.path });
    goHome();
  }, [allProjectsFolder, goHome]);

  const handleSelectWorkspace = useCallback(
    (ws: Workspace) => {
      setActiveLevel({ type: "workspace", name: ws.name, path: ws.path });
      goHome();
    },
    [goHome]
  );

  const handleOpenProject = useCallback(
    (project: Project) => {
      setActiveLevel({ type: "repo", name: project.name, path: project.path });
      selectProject(project);
      openProjectTab(project.path);
    },
    [selectProject, openProjectTab]
  );

  const handleResumeSession = useCallback(
    (sessionId: string) => {
      const tab = tabs.find((t) => t.id === activeTabId);
      const path = tab?.projectPath;
      if (path) {
        addTab(path, true, sessionId);
        setActiveTabId(SESSIONS_TAB_ID);
        if (tab) removeTab(tab.id);
      }
    },
    [tabs, activeTabId, addTab, setActiveTabId, removeTab]
  );

  const handleNewSessionFromOverview = useCallback(() => {
    const tab = tabs.find((t) => t.id === activeTabId);
    const path = tab?.projectPath;
    if (path) {
      addTab(path, true);
      setActiveTabId(SESSIONS_TAB_ID);
      if (tab) removeTab(tab.id);
    }
  }, [tabs, activeTabId, addTab, setActiveTabId, removeTab]);

  const handleNewCodexFromOverview = useCallback(() => {
    const tab = tabs.find((t) => t.id === activeTabId);
    const path = tab?.projectPath;
    if (path) {
      addTab(path, "codex");
      setActiveTabId(SESSIONS_TAB_ID);
      if (tab) removeTab(tab.id);
    }
  }, [tabs, activeTabId, addTab, setActiveTabId, removeTab]);

  const handleNewShellFromOverview = useCallback(() => {
    const tab = tabs.find((t) => t.id === activeTabId);
    const path = tab?.projectPath;
    if (path) {
      addTab(path, false);
      setActiveTabId(SESSIONS_TAB_ID);
      if (tab) removeTab(tab.id);
    }
  }, [tabs, activeTabId, addTab, setActiveTabId, removeTab]);

  const getActiveProjectPath = useCallback(() => {
    if (activeTabId === HOME_TAB_ID || activeTabId === SESSIONS_TAB_ID) {
      return activeLevel?.path ?? null;
    }
    const activeTab = tabs.find((t) => t.id === activeTabId);
    if (activeTab && activeTab.projectPath) {
      return activeTab.projectPath;
    }
    return activeLevel?.path ?? null;
  }, [tabs, activeTabId, activeLevel]);

  const handleNewClaude = useCallback(() => {
    const path = getActiveProjectPath();
    if (path) {
      const tabId = addTab(path, true);
      setActiveTabId(SESSIONS_TAB_ID);
      return tabId;
    }
  }, [getActiveProjectPath, addTab, setActiveTabId]);

  const handleNewCodex = useCallback(() => {
    const path = getActiveProjectPath();
    if (path) {
      const tabId = addTab(path, "codex");
      setActiveTabId(SESSIONS_TAB_ID);
      return tabId;
    }
  }, [getActiveProjectPath, addTab, setActiveTabId]);

  const handleNewTerminal = useCallback(() => {
    const path = getActiveProjectPath();
    if (path) {
      const tabId = addTab(path, false);
      setActiveTabId(SESSIONS_TAB_ID);
      return tabId;
    }
  }, [getActiveProjectPath, addTab, setActiveTabId]);

  const handleRunSkill = useCallback(
    (skillName: string) => {
      const path = getActiveProjectPath();
      if (path) {
        addTab(path, true, undefined, `/${skillName}`);
        setActiveTabId(SESSIONS_TAB_ID);
      }
    },
    [getActiveProjectPath, addTab, setActiveTabId]
  );

  const handleEditAgent = useCallback(
    (filePath: string) => {
      // Will be wired to open the agent file in a terminal/editor later
      console.log("Edit agent:", filePath);
    },
    []
  );

  const handleEditCommand = useCallback(
    (filePath: string) => {
      // Will be wired to open the command file in a terminal/editor later
      console.log("Edit command:", filePath);
    },
    []
  );

  const handleStartTask = useCallback(
    (slug: string, mode: TaskPipeline | null) => {
      const tab = tabs.find((t) => t.id === activeTabId);
      const path = tab?.projectPath;
      if (!path) return;
      const cmd = `${commandForMode(mode).command} ${slug}`;
      addTab(path, true, undefined, cmd);
      setActiveTabId(SESSIONS_TAB_ID);
    },
    [tabs, activeTabId, addTab, setActiveTabId]
  );

  const handleRunLocally = useCallback((port: number, hasScript: boolean) => {
    const tab = tabs.find((t) => t.id === activeTabId);
    const path = tab?.projectPath;
    if (!path) return;

    setRunLocallyState((prev) => ({ ...prev, [path]: "starting" }));

    if (hasScript) {
      // Script exists: spawn shell that runs it with PORT env var
      const cmd = `PORT=${port} bash .reggie/run.sh`;
      const tabId = addTab(path, false, undefined, cmd);
      setRunLocallyTerminals((prev) => ({ ...prev, [path]: tabId }));
      setActiveTabId(SESSIONS_TAB_ID);
      // Keep project overview tab so user can navigate back to Stop button
      const timer = setTimeout(() => {
        setRunLocallyState((prev) => ({ ...prev, [path]: "running" }));
        openInBrowser(`http://localhost:${port}`).catch(console.error);
      }, 8000);
      runLocallyTimerRef.current[path] = timer;
    } else {
      // No script: spawn Claude session to create it
      const prompt = "Investigate this repo and create a .reggie/run.sh script that starts the dev server on a free port passed via $PORT. The script should check for a free port if $PORT is not set.";
      const tabId = addTab(path, true, undefined, prompt);
      setRunLocallyTerminals((prev) => ({ ...prev, [path]: tabId }));
      setActiveTabId(SESSIONS_TAB_ID);
      // Reset state since Claude will handle it
      setRunLocallyState((prev) => ({ ...prev, [path]: "idle" }));
    }
  }, [tabs, activeTabId, addTab, setActiveTabId]);

  const handleStopLocally = useCallback(() => {
    const tab = tabs.find((t) => t.id === activeTabId);
    const path = tab?.projectPath;
    if (!path) return;

    // Clear pending browser-open timer
    if (runLocallyTimerRef.current[path]) {
      clearTimeout(runLocallyTimerRef.current[path]);
      delete runLocallyTimerRef.current[path];
    }

    const terminalTabId = runLocallyTerminals[path];
    if (terminalTabId) {
      killTab(terminalTabId);
      setRunLocallyTerminals((prev) => {
        const next = { ...prev };
        delete next[path];
        return next;
      });
    }
    setRunLocallyState((prev) => ({ ...prev, [path]: "idle" }));
  }, [tabs, activeTabId, runLocallyTerminals, killTab]);

  // Reset run-locally state when the dev server terminal dies
  useEffect(() => {
    for (const [path, tabId] of Object.entries(runLocallyTerminals)) {
      const termTab = tabs.find((t) => t.id === tabId);
      if (!termTab || termTab.dead) {
        // Terminal was killed or exited — clean up
        if (runLocallyTimerRef.current[path]) {
          clearTimeout(runLocallyTimerRef.current[path]);
          delete runLocallyTimerRef.current[path];
        }
        setRunLocallyTerminals((prev) => {
          const next = { ...prev };
          delete next[path];
          return next;
        });
        setRunLocallyState((prev) => ({ ...prev, [path]: "idle" }));
      }
    }
  }, [tabs, runLocallyTerminals]);

  const activeProjectPath = tabs.find((t) => t.id === activeTabId)?.projectPath;
  const handleTaskInputChange = useCallback(
    (value: string) => {
      if (!activeProjectPath) return;
      setTaskInputByProject((prev) => ({ ...prev, [activeProjectPath]: value }));
    },
    [activeProjectPath]
  );

  const handleStartWorkflow = useCallback(
    (notes: string) => {
      if (!activeLevel) return;
      const command = activeLevel.type === "repo" ? "/reggie-init-tasks" : "/reggie-distribute-tasks";
      const initialPrompt = notes.trim() ? `${command}\n\n${notes}` : command;
      addTab(activeLevel.path, true, undefined, initialPrompt);
      setActiveTabId(SESSIONS_TAB_ID);
    },
    [activeLevel, addTab, setActiveTabId]
  );

  // Track which terminal card is expanded to full-page within the grid
  const [expandedTerminalId, setExpandedTerminalId] = useState<string | null>(null);
  const expandedTerminalIdRef = useRef<string | null>(null);
  expandedTerminalIdRef.current = expandedTerminalId;

  const hasContent = allProjectsFolder !== null || workspaces.length > 0 || projects.length > 0;
  const activeTab = tabs.find((t) => t.id === activeTabId);
  const isHomeActive = activeTabId === HOME_TAB_ID;
  const isSessionsActive = activeTabId === SESSIONS_TAB_ID;
  const isOverviewActive = activeTab?.isProjectOverview === true;

  const handleRemoveTab = useCallback((tabId: string) => {
    if (expandedTerminalIdRef.current === tabId) {
      setExpandedTerminalId(null);
    }
    removeTab(tabId);
  }, [removeTab]);

  const handleKillTab = useCallback((tabId: string) => {
    if (expandedTerminalIdRef.current === tabId) {
      setExpandedTerminalId(null);
    }
    killTab(tabId);
  }, [killTab]);

  const handleExpandTerminal = useCallback((tabId: string) => {
    setExpandedTerminalId(tabId);
  }, []);

  const handleMinimizeTerminal = useCallback(() => {
    setExpandedTerminalId(null);
  }, []);

  // Defer xterm.js DOM insertion until the user first visits the Sessions tab,
  // or when promoted headless sessions exist (so xterm is ready when user switches).
  const hasEverVisitedTerminalRef = useRef(false);
  if ((isSessionsActive && terminalTabs.length > 0) || terminalTabs.some((t) => t.isHeadlessPromoted)) {
    hasEverVisitedTerminalRef.current = true;
  }
  const shouldRenderTerminals = hasEverVisitedTerminalRef.current && terminalTabs.length > 0;

  // Smart grid class based on visible session count
  const visibleCount = visibleSessions.length;
  const gridClass = visibleCount === 1 ? "sessions-1"
    : visibleCount === 2 ? "sessions-2"
    : visibleCount === 3 ? "sessions-3"
    : "sessions-4-plus";

  const terminalPanelClasses = [
    "terminal-panels",
    isSessionsActive && "grid-mode",
    isSessionsActive && gridClass,
    !isSessionsActive && "offscreen",
  ].filter(Boolean).join(" ");

  return (
    <>
    {showSetup && <FirstLaunchSetup onComplete={handleSetupComplete} />}
    <AppLayout
      projectPath={activeTab ? activeTab.projectPath : null}
      onRunSkill={handleRunSkill}
      onEditAgent={handleEditAgent}
      onRunCommand={handleRunSkill}
      onEditCommand={handleEditCommand}
      onRunPipeline={handleRunSkill}
      onEditPipeline={handleEditCommand}
      onGoHome={goHome}
      sessionSummary={sessionSummary}
      onThemeChange={handleThemeChange}
      sidebar={
        <Sidebar
          projects={projects}
          workspaces={workspaces}
          allProjectsFolder={allProjectsFolder}
          selectedProject={null}
          activeLevel={activeLevel}
          onAddProject={addProject}
          onAddWorkspace={addWorkspace}
          onSetAllProjectsFolder={setAllProjectsFolder}
          onRemoveAllProjectsFolder={removeAllProjectsFolder}
          onSelectProject={handleOpenProject}
          onRemoveProject={removeProject}
          onRemoveWorkspace={removeWorkspace}
          onGoHome={goHome}
          onSelectWorkspace={handleSelectWorkspace}
          onSelectAllProjects={handleSelectAllProjects}
        />
      }
      main={
        <div className="main-content">
          {/* Tab bar */}
          <TerminalTabBar
            tabs={tabs}
            activeTabId={activeTabId}
            visibleSessionCount={visibleSessions.length}
            totalSessionCount={totalSessionCount}
            onSelectTab={setActiveTabId}
            onCloseTab={handleRemoveTab}
            onKillTab={handleKillTab}
            onNewTerminal={handleNewTerminal}
            onNewClaudeSession={handleNewClaude}
            onNewCodexSession={handleNewCodex}
            onCloseAllTabs={closeAllTabs}
            onKillAllTerminals={killAllTerminals}
          />

          {/* Home tab content */}
          {isHomeActive && hasContent && (
            <WorkspaceOverview
              projects={projects}
              activeLevel={activeLevel}
              notes={brainDumpNotes}
              onNotesChange={setBrainDumpNotes}
              textareaHeight={brainDumpHeight}
              onTextareaHeightChange={setBrainDumpHeight}
              onStartWorkflow={handleStartWorkflow}
              onRunSkill={handleRunSkill}
              headlessSessions={headlessSessions}
              sessions={terminalTabs}
              onLaunchHeadless={addHeadlessSession}
              onSpawnVisibleHeadless={spawnVisibleHeadlessSession}
              onPromoteHeadless={promoteHeadlessSession}
              onPromoteSession={promoteSession}
              onRemoveHeadless={removeHeadlessSession}
              onHideSession={removeTab}
              onKillSession={removeHeadlessSession}
              onTrashCompleted={trashCompletedSessions}
              onTrashSession={trashSession}
              onKillPromotedSession={killTab}
              trackedRepos={trackedRepoSummaries}
              reposLoading={reposLoading}
              onRefreshRepos={refreshRepos}
            />
          )}

          {isHomeActive && !hasContent && (
            <div className="no-project-selected">
              <div className="no-project-icon">&gt;_</div>
              <h2>Reggie</h2>
              <p>Set a projects folder or add a workspace to get started.</p>
            </div>
          )}

          {/* Project overview tab content */}
          {isOverviewActive && activeTab && (
            <ProjectSummaryPanel
              projectName={activeTab.projectName || activeTab.label}
              projectPath={activeTab.projectPath}
              onResumeSession={handleResumeSession}
              onNewClaudeSession={handleNewSessionFromOverview}
              onNewCodexSession={handleNewCodexFromOverview}
              onNewShell={handleNewShellFromOverview}
              onRunLocally={handleRunLocally}
              onStopLocally={handleStopLocally}
              runLocallyState={runLocallyState[activeTab.projectPath] ?? "idle"}
              onStartTask={handleStartTask}
              onTasksAdded={refreshRepos}
              taskInput={taskInputByProject[activeTab.projectPath] ?? ""}
              onTaskInputChange={handleTaskInputChange}
            />
          )}

          {/* Sessions tab — unified grid of all visible terminal sessions */}
          {shouldRenderTerminals && (
            <>
            <div className={terminalPanelClasses}>
              {terminalTabs.map((tab) => {
                const isTabVisible = isSessionsActive && tab.visible !== false;
                const isExpanded = isTabVisible && expandedTerminalId === tab.id;

                return (
                  <div
                    key={tab.id}
                    className={`session-grid-card${isExpanded ? " expanded" : ""}${tab.dead ? " dead" : ""}`}
                    style={tab.visible === false ? { display: "none" } : undefined}
                  >
                    {isTabVisible && (
                      <div className="session-grid-card-header">
                        <span
                          className={`session-grid-card-icon ${tab.isClaudeSession ? "claude" : tab.isCodexSession ? "codex" : "shell"}`}
                        >
                          {tab.isClaudeSession ? ">" : tab.isCodexSession ? "C" : "$"}
                        </span>
                        <span className="session-grid-card-label">{tab.label}</span>
                        <div className="session-grid-card-actions">
                          {isExpanded ? (
                            <button
                              className="session-grid-card-btn"
                              onClick={handleMinimizeTerminal}
                              title="Minimize"
                              aria-label="Minimize terminal"
                            >
                              &#x2013;
                            </button>
                          ) : (
                            <button
                              className="session-grid-card-btn expand-btn"
                              onClick={() => handleExpandTerminal(tab.id)}
                              title="Expand"
                              aria-label="Expand terminal"
                            >
                              &#x2922;
                            </button>
                          )}
                          <button
                            className="session-grid-card-kill"
                            onClick={() => handleKillTab(tab.id)}
                            title="Kill process"
                            aria-label="Kill terminal process"
                          >
                            &times;
                          </button>
                          <button
                            className="session-grid-card-btn close-btn"
                            onClick={() => handleRemoveTab(tab.id)}
                            title="Close (hide, keep running)"
                            aria-label="Close terminal (keeps running in background)"
                          >
                            x
                          </button>
                        </div>
                      </div>
                    )}
                    <TerminalView
                      tab={tab}
                      isVisible={isTabVisible}
                      expanded={isExpanded}
                      onTerminalSpawned={setTerminalId}
                      claudeCliAvailable={claudeCliAvailable ?? true}
                      codexCliAvailable={codexCliAvailable ?? true}
                      onTabDied={() => markTabDead(tab.id)}
                      isDragging={isTabVisible && isDragging}
                      currentTheme={currentTheme}
                    />
                  </div>
                );
              })}
            </div>
            {isSessionsActive && (
              <HiddenSessionsList
                hiddenSessions={hiddenSessions}
                onShow={promoteSession}
                onKill={handleKillTab}
              />
            )}
            </>
          )}
        </div>
      }
    />
    </>
  );
}

export default App;
