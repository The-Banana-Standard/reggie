import type { TerminalTab as TerminalTabType } from "../../types/terminal";
import { TerminalTab } from "./TerminalTab";
import { HOME_TAB_ID, SESSIONS_TAB_ID } from "../../hooks/useTerminal";

interface TerminalTabBarProps {
  tabs: TerminalTabType[];
  activeTabId: string | null;
  visibleSessionCount: number;
  totalSessionCount: number;
  onSelectTab: (id: string) => void;
  onCloseTab: (id: string) => void;
  onKillTab: (id: string) => void;
  onNewTerminal: () => void;
  onNewClaudeSession: () => void;
  onCloseAllTabs: () => void;
  onKillAllTerminals: () => void;
}

export function TerminalTabBar({
  tabs,
  activeTabId,
  visibleSessionCount,
  totalSessionCount,
  onSelectTab,
  onCloseTab,
  onKillTab,
  onNewTerminal,
  onNewClaudeSession,
  onCloseAllTabs,
  onKillAllTerminals,
}: TerminalTabBarProps) {
  const projectOverviewTabs = tabs.filter((t) => t.isProjectOverview);

  const handleCloseAll = () => {
    if (totalSessionCount === 0) return;
    const confirmed = window.confirm(`Close ${totalSessionCount} session${totalSessionCount === 1 ? "" : "s"}? (Sessions will continue running in the background)`);
    if (confirmed) onCloseAllTabs();
  };

  const handleKillAll = () => {
    if (totalSessionCount === 0) return;
    const confirmed = window.confirm(`Kill ${totalSessionCount} session${totalSessionCount === 1 ? "" : "s"}? This will terminate all processes.`);
    if (confirmed) onKillAllTerminals();
  };

  return (
    <div className="terminal-tab-bar">
      <div className="terminal-tabs">
        {/* Permanent Home tab */}
        <TerminalTab
          label="Home"
          isActive={activeTabId === HOME_TAB_ID}
          isClaudeSession={false}
          isHomePage={true}
          onClick={() => onSelectTab(HOME_TAB_ID)}
          onClose={() => {}}
        />
        {/* Sessions tab — auto-appears when visible sessions exist */}
        {visibleSessionCount > 0 && (
          <TerminalTab
            label={`Sessions (${visibleSessionCount})`}
            isActive={activeTabId === SESSIONS_TAB_ID}
            isClaudeSession={false}
            isSessionsTab={true}
            onClick={() => onSelectTab(SESSIONS_TAB_ID)}
            onClose={() => {}}
          />
        )}
        {/* Project overview tabs only */}
        {projectOverviewTabs.map((tab) => (
          <TerminalTab
            key={tab.id}
            label={tab.label}
            isActive={tab.id === activeTabId}
            isClaudeSession={tab.isClaudeSession}
            isProjectOverview={tab.isProjectOverview}
            onClick={() => onSelectTab(tab.id)}
            onClose={() => onCloseTab(tab.id)}
            onKill={() => onKillTab(tab.id)}
          />
        ))}
      </div>
      <div className="terminal-tab-actions">
        {visibleSessionCount > 0 && (<>
          <button
            className="tab-action-btn close-all-btn"
            onClick={handleCloseAll}
            title="Hide all sessions"
          >
            x
          </button>
          <button
            className="tab-action-btn kill-all-btn"
            onClick={handleKillAll}
            title="Kill all sessions"
          >
            Kill All
          </button>
        </>)}
        <button className="new-tab-btn" onClick={onNewClaudeSession} title="New Claude Session">
          + Claude
        </button>
        <button className="new-tab-btn shell" onClick={onNewTerminal} title="New Terminal">
          + Shell
        </button>
      </div>
    </div>
  );
}
