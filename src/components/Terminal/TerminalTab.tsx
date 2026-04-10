interface TerminalTabProps {
  label: string;
  isActive: boolean;
  isClaudeSession: boolean;
  isHomePage?: boolean;
  isSessionsTab?: boolean;
  isProjectOverview?: boolean;
  isDead?: boolean;
  onClick: () => void;
  onClose: () => void;
  onKill?: () => void;
}

export function TerminalTab({
  label,
  isActive,
  isClaudeSession,
  isHomePage,
  isSessionsTab,
  isProjectOverview,
  isDead,
  onClick,
  onClose,
  onKill,
}: TerminalTabProps) {
  const typeClass = isHomePage ? "home" : isSessionsTab ? "sessions" : isProjectOverview ? "overview" : isClaudeSession ? "claude" : "shell";
  const icon = isHomePage ? "\u2302" : isSessionsTab ? "\u25A6" : isProjectOverview ? "\u2261" : isClaudeSession ? ">" : "$";

  return (
    <div
      className={`terminal-tab ${isActive ? "active" : ""} ${typeClass} ${isDead ? "dead" : ""}`}
      onClick={onClick}
    >
      <span className="terminal-tab-icon">{icon}</span>
      <span className="terminal-tab-label">{label}</span>
      {!isHomePage && !isSessionsTab && !isProjectOverview && onKill && (
        <button
          className="terminal-tab-kill"
          onClick={(e) => {
            e.stopPropagation();
            onKill();
          }}
          title="Kill process"
        >
          &times;
        </button>
      )}
      {!isHomePage && !isSessionsTab && (
        <button
          className="terminal-tab-close"
          onClick={(e) => {
            e.stopPropagation();
            onClose();
          }}
          title="Close tab"
        >
          x
        </button>
      )}
    </div>
  );
}
