import { ReactNode } from "react";
import { TitleBar } from "./TitleBar";
import { ActivityBar } from "../ActivityBar/ActivityBar";
import type { SessionSummary } from "../../hooks/useSessionTracking";

interface AppLayoutProps {
  sidebar: ReactNode;
  main: ReactNode;
  projectPath: string | null;
  onRunSkill: (skillName: string) => void;
  onEditAgent: (filePath: string) => void;
  onRunCommand: (commandName: string) => void;
  onEditCommand: (filePath: string) => void;
  onRunPipeline: (pipelineName: string) => void;
  onEditPipeline: (filePath: string) => void;
  onGoHome: () => void;
  sessionSummary?: SessionSummary;
  onThemeChange?: (theme: "dark" | "light") => void;
}

export function AppLayout({ sidebar, main, projectPath, onRunSkill, onEditAgent, onRunCommand, onEditCommand, onRunPipeline, onEditPipeline, onGoHome, sessionSummary, onThemeChange }: AppLayoutProps) {
  return (
    <div className="app-layout">
      <TitleBar onGoHome={onGoHome} summary={sessionSummary} />
      <div className="app-content">
        <aside className="app-sidebar">{sidebar}</aside>
        <main className="app-main">{main}</main>
        <ActivityBar
          projectPath={projectPath}
          onRunSkill={onRunSkill}
          onEditAgent={onEditAgent}
          onRunCommand={onRunCommand}
          onEditCommand={onEditCommand}
          onRunPipeline={onRunPipeline}
          onEditPipeline={onEditPipeline}
          onThemeChange={onThemeChange}
        />
      </div>
    </div>
  );
}
