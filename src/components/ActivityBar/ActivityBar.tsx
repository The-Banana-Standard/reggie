import { useCallback, useEffect, useRef, useState } from "react";
import { UsagePanel } from "./UsagePanel";
import { SkillsPanel } from "./SkillsPanel";
import { ResourcesPanel } from "./ResourcesPanel";
import { AgentsPanel } from "./AgentsPanel";
import { CommandsPanel } from "./CommandsPanel";
import { PipelinesPanel } from "./PipelinesPanel";
import { SettingsPanel } from "./SettingsPanel";

export type PanelId = "usage" | "skills" | "resources" | "agents" | "commands" | "pipelines" | "settings" | null;

type ThemeMode = "dark" | "light";

function getStoredTheme(): ThemeMode {
  try {
    const stored = localStorage.getItem("reggie-theme");
    if (stored === "light" || stored === "dark") return stored;
  } catch { /* SSR or storage unavailable */ }
  return "light";
}

function applyTheme(theme: ThemeMode): void {
  document.documentElement.dataset.theme = theme;
  try {
    localStorage.setItem("reggie-theme", theme);
  } catch { /* storage unavailable */ }
}

interface ActivityBarProps {
  projectPath: string | null;
  onRunSkill: (skillName: string) => void;
  onEditAgent: (filePath: string) => void;
  onRunCommand: (commandName: string) => void;
  onEditCommand: (filePath: string) => void;
  onRunPipeline: (pipelineName: string) => void;
  onEditPipeline: (filePath: string) => void;
  onThemeChange?: (theme: "dark" | "light") => void;
}

export function ActivityBar({ projectPath, onRunSkill, onEditAgent, onRunCommand, onEditCommand, onRunPipeline, onEditPipeline, onThemeChange }: ActivityBarProps) {
  const [activePanel, setActivePanel] = useState<PanelId>(null);
  const [skillsBrowseMode, setSkillsBrowseMode] = useState(false);
  const [theme, setTheme] = useState<ThemeMode>(getStoredTheme);
  const containerRef = useRef<HTMLDivElement>(null);

  const closePanel = useCallback(() => {
    setActivePanel(null);
    setSkillsBrowseMode(false);
  }, []);

  useEffect(() => {
    if (!activePanel) return;

    const handleMouseDown = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        closePanel();
      }
    };

    document.addEventListener("mousedown", handleMouseDown);
    return () => document.removeEventListener("mousedown", handleMouseDown);
  }, [activePanel, closePanel]);

  const toggle = (id: PanelId) => {
    setActivePanel((prev) => {
      if (prev === id) {
        setSkillsBrowseMode(false);
        return null;
      }
      if (id !== "skills") setSkillsBrowseMode(false);
      return id;
    });
  };

  const toggleTheme = useCallback(() => {
    setTheme((prev) => {
      const next: ThemeMode = prev === "dark" ? "light" : "dark";
      applyTheme(next);
      onThemeChange?.(next);
      return next;
    });
  }, [onThemeChange]);

  const isWide = activePanel === "skills" && skillsBrowseMode;
  const themeLabel = theme === "dark" ? "Switch to light mode" : "Switch to dark mode";

  return (
    <div ref={containerRef} className="activity-bar-container">
      {activePanel && (
        <div className={`activity-panel ${isWide ? "wide" : ""}`}>
          {activePanel === "usage" && <UsagePanel />}
          {activePanel === "skills" && (
            <SkillsPanel
              projectPath={projectPath}
              onRunSkill={onRunSkill}
              startOnBrowse={skillsBrowseMode}
              onBrowseModeChange={setSkillsBrowseMode}
            />
          )}
          {activePanel === "resources" && <ResourcesPanel />}
          {activePanel === "agents" && (
            <AgentsPanel onEditAgent={onEditAgent} />
          )}
          {activePanel === "commands" && (
            <CommandsPanel
              projectPath={projectPath}
              onExecuteCommand={onRunCommand}
              onEditCommand={onEditCommand}
            />
          )}
          {activePanel === "pipelines" && (
            <PipelinesPanel
              onExecutePipeline={onRunPipeline}
              onEditPipeline={onEditPipeline}
            />
          )}
          {activePanel === "settings" && <SettingsPanel />}
        </div>
      )}
      {/* Icon strip */}
      <div className="activity-bar">
        <button
          className={`activity-icon ${activePanel === "usage" ? "active" : ""}`}
          onClick={() => toggle("usage")}
          title="Usage Stats"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="12" width="4" height="9" rx="1" />
            <rect x="10" y="7" width="4" height="14" rx="1" />
            <rect x="17" y="3" width="4" height="18" rx="1" />
          </svg>
        </button>
        <button
          className={`activity-icon ${activePanel === "skills" ? "active" : ""}`}
          onClick={() => toggle("skills")}
          title="Skills & Commands"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
          </svg>
        </button>
        <button
          className={`activity-icon ${activePanel === "resources" ? "active" : ""}`}
          onClick={() => toggle("resources")}
          title="Resources & Learning"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" />
            <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />
          </svg>
        </button>
        <button
          className={`activity-icon ${activePanel === "agents" ? "active" : ""}`}
          onClick={() => toggle("agents")}
          title="Reggie Agents"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="11" width="18" height="10" rx="2" />
            <circle cx="9" cy="16" r="1" />
            <circle cx="15" cy="16" r="1" />
            <path d="M8 11V7a4 4 0 0 1 8 0v4" />
            <path d="M12 3v1" />
          </svg>
        </button>
        <button
          className={`activity-icon ${activePanel === "commands" ? "active" : ""}`}
          onClick={() => toggle("commands")}
          title="Commands"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="4 17 10 11 4 5" />
            <line x1="12" y1="19" x2="20" y2="19" />
          </svg>
        </button>
        <button
          className={`activity-icon ${activePanel === "pipelines" ? "active" : ""}`}
          onClick={() => toggle("pipelines")}
          title="Pipelines"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 6h18" />
            <path d="M3 12h18" />
            <path d="M3 18h18" />
            <circle cx="7" cy="6" r="1.5" fill="currentColor" />
            <circle cx="12" cy="12" r="1.5" fill="currentColor" />
            <circle cx="17" cy="18" r="1.5" fill="currentColor" />
          </svg>
        </button>
        <div className="activity-bar-spacer" />
        <button
          className={`activity-icon ${activePanel === "settings" ? "active" : ""}`}
          onClick={() => toggle("settings")}
          title="Settings"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
          </svg>
        </button>
        <button
          className="theme-toggle"
          onClick={toggleTheme}
          title={themeLabel}
          aria-label={themeLabel}
        >
          {theme === "dark" ? (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="5" />
              <line x1="12" y1="1" x2="12" y2="3" />
              <line x1="12" y1="21" x2="12" y2="23" />
              <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
              <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
              <line x1="1" y1="12" x2="3" y2="12" />
              <line x1="21" y1="12" x2="23" y2="12" />
              <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
              <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
            </svg>
          ) : (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
            </svg>
          )}
        </button>
      </div>
    </div>
  );
}
