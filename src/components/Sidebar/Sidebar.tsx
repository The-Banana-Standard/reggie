import { useState, useCallback } from "react";
import type { Project, AllProjectsFolder } from "../../types/project";
import type { Workspace } from "../../services/database-service";
import { ProjectList } from "./ProjectList";

interface ActiveLevel {
  type: "all-projects" | "workspace" | "repo";
  name: string;
  path: string;
}

interface SidebarProps {
  projects: Project[];
  workspaces: Workspace[];
  allProjectsFolder: AllProjectsFolder | null;
  selectedProject: Project | null;
  activeLevel: ActiveLevel | null;
  onAddProject: () => void;
  onAddWorkspace: () => void;
  onSetAllProjectsFolder: () => void;
  onRemoveAllProjectsFolder: () => void;
  onSelectProject: (project: Project) => void;
  onRemoveProject: (id: string) => void;
  onRemoveWorkspace: (id: string) => void;
  onGoHome: () => void;
  onSelectWorkspace: (ws: Workspace) => void;
  onSelectAllProjects: () => void;
}

export function Sidebar({
  projects,
  workspaces,
  allProjectsFolder,
  selectedProject,
  activeLevel,
  onAddProject,
  onAddWorkspace,
  onSetAllProjectsFolder,
  onRemoveAllProjectsFolder,
  onSelectProject,
  onRemoveProject,
  onRemoveWorkspace,
  onGoHome,
  onSelectWorkspace,
  onSelectAllProjects,
}: SidebarProps) {
  // Track collapsed state for workspace groups
  const [collapsedWorkspaces, setCollapsedWorkspaces] = useState<Set<string>>(new Set());

  const toggleWorkspaceCollapse = useCallback((wsId: string) => {
    setCollapsedWorkspaces((prev) => {
      const next = new Set(prev);
      if (next.has(wsId)) {
        next.delete(wsId);
      } else {
        next.add(wsId);
      }
      return next;
    });
  }, []);

  // Group projects by workspace
  const workspaceProjects = new Map<string, Project[]>();
  const standaloneProjects: Project[] = [];

  for (const p of projects) {
    if (p.workspace_path) {
      const existing = workspaceProjects.get(p.workspace_path) || [];
      existing.push(p);
      workspaceProjects.set(p.workspace_path, existing);
    } else {
      standaloneProjects.push(p);
    }
  }

  // Sort workspace projects alphabetically
  for (const [key, val] of workspaceProjects) {
    workspaceProjects.set(
      key,
      val.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }))
    );
  }

  const activePath = activeLevel?.type === "repo" ? activeLevel.path : null;
  const hasContent = workspaces.length > 0 || standaloneProjects.length > 0;

  return (
    <div className="sidebar">
      <div className="sidebar-header" onClick={allProjectsFolder ? onSelectAllProjects : onGoHome} style={{ cursor: "pointer" }}>
        <h2 className="sidebar-title">
          {allProjectsFolder ? allProjectsFolder.name : "Projects"}
        </h2>
      </div>

      <div className="sidebar-actions">
        {!allProjectsFolder ? (
          <>
            <button className="add-project-btn" onClick={onSetAllProjectsFolder}>
              <span className="add-icon">+</span>
              <span>Set Projects Folder</span>
            </button>
            <button className="add-project-btn add-single" onClick={onAddWorkspace}>
              <span className="add-icon">+</span>
              <span>Add Workspace</span>
            </button>
            <button className="add-project-btn add-single" onClick={onAddProject}>
              <span className="add-icon">+</span>
              <span>Add Project</span>
            </button>
          </>
        ) : (
          <button className="add-project-btn add-single" onClick={onAddProject}>
            <span className="add-icon">+</span>
            <span>Add Project</span>
          </button>
        )}
      </div>

      <div className="sidebar-scroll">
        {/* All Projects folder header when set */}
        {allProjectsFolder && (
          <div className={`all-projects-header${activeLevel?.type === "all-projects" ? " active" : ""}`} onClick={onSelectAllProjects} style={{ cursor: "pointer" }}>
            <span className="all-projects-icon">~</span>
            <span className="all-projects-path">{allProjectsFolder.path}</span>
            <button
              className="workspace-remove"
              onClick={onRemoveAllProjectsFolder}
              title="Remove projects folder"
            >
              x
            </button>
          </div>
        )}

        {/* Workspace groups */}
        {workspaces.map((ws) => {
          const wsProjects = workspaceProjects.get(ws.path) || [];
          if (wsProjects.length === 0) return null;
          const isCollapsed = collapsedWorkspaces.has(ws.id);
          return (
            <div key={ws.id} className="workspace-group">
              <div className={`workspace-header${activeLevel?.type === "workspace" && activeLevel.path === ws.path ? " active" : ""}`}>
                <span
                  className={`workspace-collapse ${isCollapsed ? "collapsed" : ""}`}
                  onClick={() => toggleWorkspaceCollapse(ws.id)}
                >
                  {isCollapsed ? ">" : "v"}
                </span>
                <span
                  className="workspace-icon"
                  onClick={() => { onSelectWorkspace(ws); toggleWorkspaceCollapse(ws.id); }}
                  style={{ cursor: "pointer" }}
                >
                  /
                </span>
                <span
                  className="workspace-name"
                  onClick={() => { onSelectWorkspace(ws); toggleWorkspaceCollapse(ws.id); }}
                  style={{ cursor: "pointer" }}
                >
                  {ws.name}
                </span>
                <span className="workspace-count">{wsProjects.length}</span>
                {!allProjectsFolder && (
                  <button
                    className="workspace-remove"
                    onClick={() => onRemoveWorkspace(ws.id)}
                    title="Remove workspace"
                  >
                    x
                  </button>
                )}
              </div>
              {!isCollapsed && (
                <ProjectList
                  projects={wsProjects}
                  selectedProject={selectedProject}
                  activePath={activePath}
                  onSelect={onSelectProject}
                  onRemove={onRemoveProject}
                />
              )}
            </div>
          );
        })}

        {/* Standalone repos */}
        {standaloneProjects.length > 0 && (
          <div className="workspace-group">
            {workspaces.length > 0 && (
              <div className="workspace-header">
                <span className="workspace-icon">#</span>
                <span className="workspace-name">Standalone</span>
                <span className="workspace-count">{standaloneProjects.length}</span>
              </div>
            )}
            <ProjectList
              projects={standaloneProjects}
              selectedProject={selectedProject}
              activePath={activePath}
              onSelect={onSelectProject}
              onRemove={onRemoveProject}
            />
          </div>
        )}

        {!hasContent && (
          <div className="project-list-empty">
            {allProjectsFolder
              ? "No projects found in this folder."
              : "Set a projects folder or add a workspace to get started."}
          </div>
        )}
      </div>
    </div>
  );
}
