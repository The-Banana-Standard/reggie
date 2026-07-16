import { terminalIconForTab, terminalKindForTab } from "../../types/terminal";
import type { TerminalTab } from "../../types/terminal";

export function HiddenSessionsList({
  hiddenSessions,
  onShow,
  onKill,
}: {
  hiddenSessions: TerminalTab[];
  onShow: (tabId: string) => void;
  onKill: (tabId: string) => void;
}) {
  if (hiddenSessions.length === 0) return null;

  return (
    <div className="hidden-sessions-section">
      <div className="hidden-sessions-title">
        Hidden Sessions ({hiddenSessions.length})
      </div>
      <div className="hidden-sessions-list">
        {hiddenSessions.map((tab) => (
          <div key={tab.id} className="hidden-session-row">
            <span className={`hidden-session-icon ${terminalKindForTab(tab)}`}>
              {terminalIconForTab(tab)}
            </span>
            <span className="hidden-session-label">{tab.label}</span>
            <div className="hidden-session-actions">
              <button
                className="hidden-session-btn show-btn"
                onClick={() => onShow(tab.id)}
                title="Show session"
                aria-label="Show hidden session"
              >
                Show
              </button>
              <button
                className="hidden-session-btn kill-btn"
                onClick={() => onKill(tab.id)}
                title="Kill process"
                aria-label="Kill hidden session"
              >
                Kill
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
