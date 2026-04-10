import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { Sidebar } from "../Sidebar/Sidebar";
import type { Project } from "../../types/project";
import type { Workspace } from "../../services/database-service";

function makeWorkspace(overrides: Partial<Workspace> = {}): Workspace {
  return {
    id: "ws-1",
    name: "My Workspace",
    path: "/path/to/workspace",
    added_at: "2026-01-01",
    ...overrides,
  };
}

function makeProject(overrides: Partial<Project> = {}): Project {
  return {
    id: "proj-1",
    name: "my-project",
    path: "/path/to/workspace/my-project",
    added_at: "2026-01-01",
    last_opened: null,
    workspace_path: "/path/to/workspace",
    ...overrides,
  };
}

const noopFn = vi.fn();

const defaultProps = {
  projects: [] as Project[],
  workspaces: [] as Workspace[],
  allProjectsFolder: null,
  selectedProject: null,
  activeLevel: null as { type: "all-projects" | "workspace" | "repo"; name: string; path: string } | null,
  onAddProject: noopFn,
  onAddWorkspace: noopFn,
  onSetAllProjectsFolder: noopFn,
  onRemoveAllProjectsFolder: noopFn,
  onSelectProject: noopFn,
  onRemoveProject: noopFn,
  onRemoveWorkspace: noopFn,
  onGoHome: noopFn,
  onSelectWorkspace: noopFn,
  onSelectAllProjects: noopFn,
};

describe("Sidebar", () => {
  describe("empty workspace filtering", () => {
    it("does not render workspace groups with 0 projects", () => {
      const ws = makeWorkspace({ name: "Empty Workspace" });
      render(<Sidebar {...defaultProps} workspaces={[ws]} projects={[]} />);
      expect(screen.queryByText("Empty Workspace")).toBeNull();
    });

    it("renders workspace groups that have projects", () => {
      const ws = makeWorkspace({ name: "Active Workspace" });
      const proj = makeProject({ workspace_path: ws.path });
      render(<Sidebar {...defaultProps} workspaces={[ws]} projects={[proj]} />);
      expect(screen.getByText("Active Workspace")).toBeTruthy();
    });

    it("renders only non-empty workspaces when mixed", () => {
      const emptyWs = makeWorkspace({ id: "ws-empty", name: "Empty WS", path: "/empty" });
      const fullWs = makeWorkspace({ id: "ws-full", name: "Full WS", path: "/full" });
      const proj = makeProject({ workspace_path: "/full" });
      render(
        <Sidebar
          {...defaultProps}
          workspaces={[emptyWs, fullWs]}
          projects={[proj]}
        />
      );
      expect(screen.queryByText("Empty WS")).toBeNull();
      expect(screen.getByText("Full WS")).toBeTruthy();
    });
  });
});
