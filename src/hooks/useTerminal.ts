import { useState, useCallback, useRef, useEffect, useMemo } from "react";
import type { TerminalTab, HeadlessSession, HeadlessTerminalStatus } from "../types/terminal";
import { closeTerminal, spawnHeadlessTerminal, closeHeadlessTerminal } from "../services/terminal-service";
import { listen } from "@tauri-apps/api/event";

export const HOME_TAB_ID = "home";
export const SESSIONS_TAB_ID = "sessions";

export function useTerminal() {
  const [tabs, setTabs] = useState<TerminalTab[]>([]);
  const tabsRef = useRef(tabs);
  tabsRef.current = tabs;
  const [activeTabId, setActiveTabId] = useState<string | null>(HOME_TAB_ID);
  const [headlessSessions, setHeadlessSessions] = useState<HeadlessSession[]>([]);
  const headlessSessionsRef = useRef(headlessSessions);
  headlessSessionsRef.current = headlessSessions;
  const [promotedHeadlessIds, setPromotedHeadlessIds] = useState<Set<string>>(new Set());

  const removePromotedId = useCallback((id: string) => {
    setPromotedHeadlessIds((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  }, []);

  // Listen to headless terminal status events from Rust.
  // Deferred 1s since no headless sessions exist during startup.
  // If auto-restore of headless sessions is ever added, remove the deferral.
  useEffect(() => {
    let cancelled = false;
    let unlistenPromise: Promise<() => void> | null = null;

    const timer = setTimeout(() => {
      if (cancelled) return;
      unlistenPromise = listen<HeadlessTerminalStatus>("headless-terminal-status", (event) => {
        const status = event.payload;
        setHeadlessSessions((prev) =>
          prev.map((s) =>
            s.terminalId === status.terminalId
              ? {
                  ...s,
                  needsAttention: status.needsAttention,
                  exited: status.exited,
                  exitCode: status.exitCode,
                  bufferSize: status.bufferSize,
                  completed: status.completed,
                }
              : s
          )
        );
        // Also update promoted tabs that reference this headless terminal
        setTabs((prev) => {
          const hasMatch = prev.some(
            (t) => t.isHeadlessPromoted && t.headlessTerminalId === status.terminalId
          );
          if (!hasMatch) return prev;
          return prev.map((t) =>
            t.isHeadlessPromoted && t.headlessTerminalId === status.terminalId
              ? {
                  ...t,
                  headlessCompleted: status.completed,
                  dead: status.exited,
                }
              : t
          );
        });
      });
    }, 1000);

    return () => {
      cancelled = true;
      clearTimeout(timer);
      unlistenPromise?.then((fn) => fn());
    };
  }, []);

  const addTab = useCallback(
    (projectPath: string, isClaudeSession: boolean, sessionId?: string, initialPrompt?: string, model?: string, effort?: string) => {
      const id = crypto.randomUUID();
      const projectName = projectPath.split(/[/\\]/).pop() || projectPath;
      const isSlashCommand = initialPrompt?.startsWith("/");
      const label = initialPrompt
        ? isSlashCommand
          ? `${initialPrompt.split("\n")[0]} \u2014 ${projectName}`
          : projectName
        : projectName;

      setTabs((prev) => {
        // Count existing tabs for the same project + type to add a suffix
        const sameCount = prev.filter(
          (t) => t.projectName === projectName && t.isClaudeSession === isClaudeSession
        ).length;
        const finalLabel = sameCount > 0 ? `${label} ${sameCount + 1}` : label;

        const newTab: TerminalTab = {
          id,
          terminalId: null,
          label: finalLabel,
          isClaudeSession,
          sessionId,
          projectPath,
          projectName,
          initialPrompt,
          model,
          effort,
          visible: true,
        };
        return [...prev, newTab];
      });
      return id;
    },
    []
  );

  const openProjectTab = useCallback(
    (projectPath: string) => {
      setTabs((prev) => {
        const existing = prev.find(
          (t) => t.isProjectOverview && t.projectPath === projectPath
        );
        if (existing) {
          setActiveTabId(existing.id);
          return prev;
        }

        const id = crypto.randomUUID();
        const projectName = projectPath.split(/[/\\]/).pop() || projectPath;
        const newTab: TerminalTab = {
          id,
          terminalId: null,
          label: projectName,
          isClaudeSession: false,
          isProjectOverview: true,
          projectPath,
          projectName,
        };
        setActiveTabId(id);
        return [...prev, newTab];
      });
    },
    []
  );

  const goHome = useCallback(() => {
    setActiveTabId(HOME_TAB_ID);
  }, []);

  const detachTab = useCallback((tabId: string) => {
    setTabs((prev) => prev.filter((t) => t.id !== tabId));
    setActiveTabId((currentActive) =>
      currentActive === tabId ? HOME_TAB_ID : currentActive
    );
  }, []);

  // Close = demote to headless (hide from Sessions tab, keep PTY alive)
  const removeTab = useCallback(
    async (tabId: string) => {
      if (tabId === HOME_TAB_ID) return;

      const tab = tabsRef.current.find((t) => t.id === tabId);
      if (!tab || tab.isProjectOverview) {
        // Project overview tabs just get removed
        detachTab(tabId);
        return;
      }

      // Demote: set visible to false instead of killing
      setTabs((prev) =>
        prev.map((t) => (t.id === tabId ? { ...t, visible: false } : t))
      );
    },
    [detachTab]
  );

  // Kill = terminate process and remove session entirely
  const killTab = useCallback(
    async (tabId: string) => {
      if (tabId === HOME_TAB_ID) return;

      const tab = tabsRef.current.find((t) => t.id === tabId);
      if (!tab) return;

      // For promoted headless tabs, close via closeHeadlessTerminal and clean up headless entry
      if (tab.isHeadlessPromoted && tab.headlessTerminalId) {
        closeHeadlessTerminal(tab.headlessTerminalId).catch(() => {});
        setHeadlessSessions((prev) => prev.filter((s) => s.terminalId !== tab.headlessTerminalId));
        removePromotedId(tab.headlessTerminalId);
      } else if (tab.terminalId) {
        closeTerminal(tab.terminalId).catch(() => {});
      }

      detachTab(tabId);
    },
    [detachTab, removePromotedId]
  );

  // Promote: set visible to true on an existing hidden session
  const promoteSession = useCallback(
    (tabId: string) => {
      setTabs((prev) =>
        prev.map((t) => (t.id === tabId ? { ...t, visible: true } : t))
      );
    },
    []
  );

  const setTerminalId = useCallback((tabId: string, terminalId: string) => {
    setTabs((prev) =>
      prev.map((t) => (t.id === tabId ? { ...t, terminalId } : t))
    );
  }, []);

  const markTabDead = useCallback((tabId: string) => {
    setTabs((prev) =>
      prev.map((t) => (t.id === tabId ? { ...t, dead: true } : t))
    );
  }, []);

  const addHeadlessSession = useCallback(
    async (projectPath: string, initialCommand: string, label: string, model?: string, effort?: string) => {
      try {
        const terminalId = await spawnHeadlessTerminal(projectPath, initialCommand, model, effort);
        const projectName = projectPath.split(/[/\\]/).pop() || projectPath;
        const session: HeadlessSession = {
          terminalId,
          projectPath,
          projectName,
          label,
          needsAttention: false,
          exited: false,
          exitCode: null,
          bufferSize: 0,
          completed: false,
        };
        setHeadlessSessions((prev) => [...prev, session]);
        return terminalId;
      } catch (err) {
        console.error("Failed to spawn headless terminal:", err);
        return null;
      }
    },
    []
  );

  // Spawn a headless terminal and immediately create a visible tab for it.
  // This bypasses the headlessSessions state entirely, avoiding the race condition
  // where promoteHeadlessSession can't find the session because the ref hasn't
  // updated yet due to React 18 batched state updates.
  const spawnVisibleHeadlessSession = useCallback(
    async (projectPath: string, initialCommand: string, label: string, model?: string, effort?: string): Promise<string | null> => {
      try {
        const terminalId = await spawnHeadlessTerminal(projectPath, initialCommand, model, effort);
        const projectName = projectPath.split(/[/\\]/).pop() || projectPath;
        const tabId = crypto.randomUUID();
        const newTab: TerminalTab = {
          id: tabId,
          terminalId: null,
          label,
          isClaudeSession: true,
          projectPath,
          projectName,
          isHeadlessPromoted: true,
          headlessTerminalId: terminalId,
          headlessCompleted: false,
          visible: true,
        };
        setTabs((prev) => [...prev, newTab]);
        return terminalId;
      } catch (err) {
        console.error("Failed to spawn visible headless terminal:", err);
        return null;
      }
    },
    []
  );

  const promoteHeadlessSession = useCallback(
    (terminalId: string) => {
      const session = headlessSessionsRef.current.find((s) => s.terminalId === terminalId);
      if (!session) return null;

      // If already promoted and has a visible tab, just make it visible again
      const existingTab = tabsRef.current.find(
        (t) => t.isHeadlessPromoted && t.headlessTerminalId === terminalId
      );
      if (existingTab) {
        setTabs((prev) =>
          prev.map((t) => (t.id === existingTab.id ? { ...t, visible: true } : t))
        );
        return existingTab.id;
      }

      const tabId = crypto.randomUUID();
      const newTab: TerminalTab = {
        id: tabId,
        terminalId: null,
        label: session.label,
        isClaudeSession: true,
        projectPath: session.projectPath,
        projectName: session.projectName,
        isHeadlessPromoted: true,
        headlessTerminalId: terminalId,
        headlessCompleted: session.completed,
        visible: true,
      };

      setTabs((prev) => [...prev, newTab]);
      setPromotedHeadlessIds((prev) => new Set(prev).add(terminalId));

      return tabId;
    },
    []
  );

  const removeHeadlessSession = useCallback(
    async (terminalId: string) => {
      setHeadlessSessions((prev) => prev.filter((s) => s.terminalId !== terminalId));
      removePromotedId(terminalId);
      // Also remove any promoted tab referencing this headless session
      const tab = tabsRef.current.find(
        (t) => t.isHeadlessPromoted && t.headlessTerminalId === terminalId
      );
      if (tab) {
        setTabs((prev) => prev.filter((t) => t.id !== tab.id));
      }
      closeHeadlessTerminal(terminalId).catch(() => {});
    },
    [removePromotedId]
  );

  const trashCompletedSessions = useCallback(() => {
    const currentHeadless = headlessSessionsRef.current;
    const completed = currentHeadless.filter((s) => s.completed);
    for (const session of completed) {
      closeHeadlessTerminal(session.terminalId).catch(() => {});
    }
    // Also remove promoted tabs that reference completed headless sessions
    const currentTabs = tabsRef.current;
    const completedTermIds = new Set(completed.map((s) => s.terminalId));
    const promotedToRemove = currentTabs.filter(
      (t) => t.isHeadlessPromoted && t.headlessTerminalId && completedTermIds.has(t.headlessTerminalId)
    );
    for (const tab of promotedToRemove) {
      detachTab(tab.id);
    }
    // Handle promoted tabs spawned via spawnVisibleHeadlessSession (not in headlessSessions)
    const promotedOnlyCompleted = currentTabs.filter(
      (t) => t.isHeadlessPromoted && t.headlessCompleted && t.headlessTerminalId && !completedTermIds.has(t.headlessTerminalId)
    );
    for (const tab of promotedOnlyCompleted) {
      closeHeadlessTerminal(tab.headlessTerminalId!).catch(() => {});
      detachTab(tab.id);
    }
    setHeadlessSessions((prev) => prev.filter((s) => !s.completed));
    setPromotedHeadlessIds((prev) => {
      const next = new Set(prev);
      for (const id of completedTermIds) {
        next.delete(id);
      }
      return next;
    });
  }, [detachTab]);

  const trashSession = useCallback((terminalId: string) => {
    closeHeadlessTerminal(terminalId).catch(() => {});
    setHeadlessSessions((prev) => prev.filter((s) => s.terminalId !== terminalId));
    removePromotedId(terminalId);
    // Remove promoted tab if it references this terminal
    const tab = tabsRef.current.find(
      (t) => t.isHeadlessPromoted && t.headlessTerminalId === terminalId
    );
    if (tab) detachTab(tab.id);
  }, [detachTab, removePromotedId]);

  // Close all = demote all visible sessions to hidden
  const closeAllTabs = useCallback(
    () => {
      setTabs((prev) =>
        prev.map((t) => {
          if (t.isProjectOverview) return t;
          if (t.visible !== false) return { ...t, visible: false };
          return t;
        })
      );
      setActiveTabId(HOME_TAB_ID);
    },
    []
  );

  // Kill all = terminate all sessions (visible, hidden, and headless)
  const killAllTerminals = useCallback(
    () => {
      const currentTabs = tabsRef.current;
      const currentHeadless = headlessSessionsRef.current;
      // Kill all terminal tabs
      for (const tab of currentTabs) {
        if (tab.isProjectOverview) continue;
        if (tab.isHeadlessPromoted) {
          // Promoted tabs that bypassed headlessSessions (spawnVisibleHeadlessSession)
          if (tab.headlessTerminalId) {
            closeHeadlessTerminal(tab.headlessTerminalId).catch(() => {});
          }
          continue;
        }
        if (tab.terminalId) {
          closeTerminal(tab.terminalId).catch(() => {});
        }
      }
      // Kill all headless sessions
      for (const session of currentHeadless) {
        closeHeadlessTerminal(session.terminalId).catch(() => {});
      }
      setTabs((prev) => prev.filter((t) => t.isProjectOverview));
      setHeadlessSessions([]);
      setPromotedHeadlessIds(new Set());
      setActiveTabId(HOME_TAB_ID);
    },
    []
  );

  const terminalTabs = useMemo(() => tabs.filter((t) => !t.isProjectOverview), [tabs]);
  const visibleSessions = useMemo(() => terminalTabs.filter((t) => t.visible !== false), [terminalTabs]);
  const hiddenSessions = useMemo(() => terminalTabs.filter((t) => t.visible === false), [terminalTabs]);
  const totalSessionCount = terminalTabs.length + headlessSessions.length - promotedHeadlessIds.size;

  return {
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
    promotedHeadlessIds,
  };
}
