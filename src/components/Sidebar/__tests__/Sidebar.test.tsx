import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { Sidebar } from "../Sidebar";
import type { Project, AllProjectsFolder } from "../../../types/project";
import type { Workspace } from "../../../services/database-service";

const makeProject = (overrides: Partial<Project> = {}): Project => ({
  id: "p1",
  name: "repo-a",
  path: "/home/Projects/ws/repo-a",
  added_at: "",
  last_opened: null,
  workspace_path: null,
  ...overrides,
});

const defaultProps = {
  projects: [] as Project[],
  workspaces: [] as Workspace[],
  allProjectsFolder: null as AllProjectsFolder | null,
  selectedProject: null as Project | null,
  activeLevel: null as { type: "all-projects" | "workspace" | "repo"; name: string; path: string } | null,
  onAddProject: vi.fn(),
  onAddWorkspace: vi.fn(),
  onSetAllProjectsFolder: vi.fn(),
  onRemoveAllProjectsFolder: vi.fn(),
  onSelectProject: vi.fn(),
  onRemoveProject: vi.fn(),
  onRemoveWorkspace: vi.fn(),
  onGoHome: vi.fn(),
  onSelectWorkspace: vi.fn(),
  onSelectAllProjects: vi.fn(),
};

describe("Sidebar", () => {
  it("renders 3-level tree: folder header, workspace groups, and repos", () => {
    const folder: AllProjectsFolder = { id: "apf1", name: "Projects", path: "/home/Projects", added_at: "" };
    const ws: Workspace = { id: "w1", name: "my-workspace", path: "/home/Projects/my-workspace", added_at: "" };
    const projects: Project[] = [
      makeProject({ id: "p1", name: "repo-a", path: "/home/Projects/my-workspace/repo-a", workspace_path: "/home/Projects/my-workspace" }),
      makeProject({ id: "p2", name: "repo-b", path: "/home/Projects/my-workspace/repo-b", workspace_path: "/home/Projects/my-workspace" }),
      makeProject({ id: "p3", name: "standalone", path: "/home/Projects/standalone", workspace_path: null }),
    ];

    render(
      <Sidebar
        {...defaultProps}
        allProjectsFolder={folder}
        workspaces={[ws]}
        projects={projects}
      />
    );

    expect(screen.getByText("Projects")).toBeTruthy();
    expect(screen.getByText("my-workspace")).toBeTruthy();
    expect(screen.getByText("repo-a")).toBeTruthy();
    expect(screen.getByText("repo-b")).toBeTruthy();
    expect(screen.getByText("Standalone")).toBeTruthy();
    expect(screen.getByText("standalone")).toBeTruthy();
  });

  it("collapsing a workspace hides its projects", () => {
    const folder: AllProjectsFolder = { id: "apf1", name: "Projects", path: "/home/Projects", added_at: "" };
    const ws: Workspace = { id: "w1", name: "my-workspace", path: "/home/Projects/my-workspace", added_at: "" };
    const projects: Project[] = [
      makeProject({ id: "p1", name: "repo-a", path: "/home/Projects/my-workspace/repo-a", workspace_path: "/home/Projects/my-workspace" }),
    ];

    render(
      <Sidebar
        {...defaultProps}
        allProjectsFolder={folder}
        workspaces={[ws]}
        projects={projects}
      />
    );

    expect(screen.getByText("repo-a")).toBeTruthy();
    fireEvent.click(screen.getByText("my-workspace"));
    expect(screen.queryByText("repo-a")).toBeNull();
  });

  it("standalone repos appear at the bottom when workspaces exist", () => {
    const ws: Workspace = { id: "w1", name: "ws", path: "/ws", added_at: "" };
    const projects: Project[] = [
      makeProject({ id: "p1", name: "ws-repo", path: "/ws/ws-repo", workspace_path: "/ws" }),
      makeProject({ id: "p2", name: "standalone-repo", path: "/standalone-repo", workspace_path: null }),
    ];

    render(
      <Sidebar
        {...defaultProps}
        workspaces={[ws]}
        projects={projects}
      />
    );

    expect(screen.getByText("Standalone")).toBeTruthy();
    expect(screen.getByText("standalone-repo")).toBeTruthy();
  });

  it("shows empty message when no folder and no content", () => {
    render(<Sidebar {...defaultProps} />);
    expect(screen.getByText(/Set a projects folder or add a workspace/)).toBeTruthy();
  });

  it("shows Set Projects Folder button when no folder is set", () => {
    render(<Sidebar {...defaultProps} />);
    expect(screen.getByText("Set Projects Folder")).toBeTruthy();
  });

  it("hides workspace remove button when allProjectsFolder is set", () => {
    const folder: AllProjectsFolder = { id: "apf1", name: "Projects", path: "/home/Projects", added_at: "" };
    const ws: Workspace = { id: "w1", name: "ws", path: "/home/Projects/ws", added_at: "" };

    render(
      <Sidebar
        {...defaultProps}
        allProjectsFolder={folder}
        workspaces={[ws]}
        projects={[]}
      />
    );

    expect(screen.queryByTitle("Remove workspace")).toBeNull();
    expect(screen.getByTitle("Remove projects folder")).toBeTruthy();
  });

  it("clicking a project calls onSelectProject with the project", () => {
    const project = makeProject({ id: "p1", name: "my-app" });
    const onSelectProject = vi.fn();

    render(
      <Sidebar
        {...defaultProps}
        projects={[project]}
        onSelectProject={onSelectProject}
      />
    );

    fireEvent.click(screen.getByText("my-app"));
    expect(onSelectProject).toHaveBeenCalledWith(project);
  });

  it("displays workspace project count", () => {
    const folder: AllProjectsFolder = { id: "apf1", name: "Projects", path: "/home/Projects", added_at: "" };
    const ws: Workspace = { id: "w1", name: "my-workspace", path: "/home/Projects/my-workspace", added_at: "" };
    const projects: Project[] = [
      makeProject({ id: "p1", name: "repo-a", workspace_path: "/home/Projects/my-workspace" }),
      makeProject({ id: "p2", name: "repo-b", workspace_path: "/home/Projects/my-workspace" }),
    ];

    render(
      <Sidebar
        {...defaultProps}
        allProjectsFolder={folder}
        workspaces={[ws]}
        projects={projects}
      />
    );

    // The count "2" should appear next to the workspace name
    expect(screen.getByText("2")).toBeTruthy();
  });

  it("shows allProjectsFolder name as sidebar title when set", () => {
    const folder: AllProjectsFolder = { id: "apf1", name: "MyWorkDir", path: "/home/MyWorkDir", added_at: "" };

    render(
      <Sidebar
        {...defaultProps}
        allProjectsFolder={folder}
      />
    );

    expect(screen.getByText("MyWorkDir")).toBeTruthy();
  });

  it("shows default 'Projects' title when no folder is set", () => {
    render(<Sidebar {...defaultProps} />);

    expect(screen.getByText("Projects")).toBeTruthy();
  });

  it("shows 'No projects found' message when folder set but no content", () => {
    const folder: AllProjectsFolder = { id: "apf1", name: "Projects", path: "/home/Projects", added_at: "" };

    render(
      <Sidebar
        {...defaultProps}
        allProjectsFolder={folder}
        workspaces={[]}
        projects={[]}
      />
    );

    expect(screen.getByText("No projects found in this folder.")).toBeTruthy();
  });

  it("re-expanding a collapsed workspace shows its projects again", () => {
    const folder: AllProjectsFolder = { id: "apf1", name: "Projects", path: "/home/Projects", added_at: "" };
    const ws: Workspace = { id: "w1", name: "my-workspace", path: "/home/Projects/my-workspace", added_at: "" };
    const projects: Project[] = [
      makeProject({ id: "p1", name: "repo-a", workspace_path: "/home/Projects/my-workspace" }),
    ];

    render(
      <Sidebar
        {...defaultProps}
        allProjectsFolder={folder}
        workspaces={[ws]}
        projects={projects}
      />
    );

    // Collapse
    fireEvent.click(screen.getByText("my-workspace"));
    expect(screen.queryByText("repo-a")).toBeNull();

    // Re-expand
    fireEvent.click(screen.getByText("my-workspace"));
    expect(screen.getByText("repo-a")).toBeTruthy();
  });

  it("hides 'Set Projects Folder' and 'Add Workspace' buttons when folder is set", () => {
    const folder: AllProjectsFolder = { id: "apf1", name: "Projects", path: "/home/Projects", added_at: "" };

    render(
      <Sidebar
        {...defaultProps}
        allProjectsFolder={folder}
      />
    );

    expect(screen.queryByText("Set Projects Folder")).toBeNull();
    expect(screen.queryByText("Add Workspace")).toBeNull();
    // "Add Project" should still be visible
    expect(screen.getByText("Add Project")).toBeTruthy();
  });

  it("shows all action buttons when no folder is set", () => {
    render(<Sidebar {...defaultProps} />);

    expect(screen.getByText("Set Projects Folder")).toBeTruthy();
    expect(screen.getByText("Add Workspace")).toBeTruthy();
    expect(screen.getByText("Add Project")).toBeTruthy();
  });

  it("clicking remove project button calls onRemoveProject with project id", () => {
    const project = makeProject({ id: "p99", name: "to-remove" });
    const onRemoveProject = vi.fn();

    render(
      <Sidebar
        {...defaultProps}
        projects={[project]}
        onRemoveProject={onRemoveProject}
      />
    );

    fireEvent.click(screen.getByTitle("Remove project"));
    expect(onRemoveProject).toHaveBeenCalledWith("p99");
  });

  it("does not show Standalone section when no workspaces exist", () => {
    const projects: Project[] = [
      makeProject({ id: "p1", name: "lone-project", workspace_path: null }),
    ];

    render(
      <Sidebar
        {...defaultProps}
        workspaces={[]}
        projects={projects}
      />
    );

    // Project should be visible, but "Standalone" header should not
    expect(screen.getByText("lone-project")).toBeTruthy();
    expect(screen.queryByText("Standalone")).toBeNull();
  });

  it("shows the allProjectsFolder path in the header", () => {
    const folder: AllProjectsFolder = { id: "apf1", name: "Projects", path: "/home/user/Projects", added_at: "" };

    render(
      <Sidebar
        {...defaultProps}
        allProjectsFolder={folder}
      />
    );

    expect(screen.getByText("/home/user/Projects")).toBeTruthy();
  });

  describe("active level highlighting", () => {
    const folder: AllProjectsFolder = { id: "apf1", name: "Projects", path: "/home/Projects", added_at: "" };
    const ws1: Workspace = { id: "w1", name: "my-workspace", path: "/home/Projects/my-workspace", added_at: "" };
    const ws2: Workspace = { id: "w2", name: "other-workspace", path: "/home/Projects/other-workspace", added_at: "" };
    const repoA = makeProject({ id: "p1", name: "repo-a", path: "/home/Projects/my-workspace/repo-a", workspace_path: "/home/Projects/my-workspace" });
    const repoB = makeProject({ id: "p2", name: "repo-b", path: "/home/Projects/my-workspace/repo-b", workspace_path: "/home/Projects/my-workspace" });
    const standalone = makeProject({ id: "p3", name: "standalone-repo", path: "/home/Projects/standalone-repo", workspace_path: null });

    it("all-projects header gets .active class when activeLevel type is all-projects", () => {
      const { container } = render(
        <Sidebar
          {...defaultProps}
          allProjectsFolder={folder}
          workspaces={[ws1]}
          projects={[repoA]}
          activeLevel={{ type: "all-projects", name: "Projects", path: "/home/Projects" }}
        />
      );

      const header = container.querySelector(".all-projects-header");
      expect(header).not.toBeNull();
      expect(header!.classList.contains("active")).toBe(true);
    });

    it("all-projects header does not get .active class when activeLevel is null", () => {
      const { container } = render(
        <Sidebar
          {...defaultProps}
          allProjectsFolder={folder}
          workspaces={[ws1]}
          projects={[repoA]}
          activeLevel={null}
        />
      );

      const header = container.querySelector(".all-projects-header");
      expect(header).not.toBeNull();
      expect(header!.classList.contains("active")).toBe(false);
    });

    it("all-projects header does not get .active class when activeLevel type is workspace", () => {
      const { container } = render(
        <Sidebar
          {...defaultProps}
          allProjectsFolder={folder}
          workspaces={[ws1]}
          projects={[repoA]}
          activeLevel={{ type: "workspace", name: "my-workspace", path: "/home/Projects/my-workspace" }}
        />
      );

      const header = container.querySelector(".all-projects-header");
      expect(header).not.toBeNull();
      expect(header!.classList.contains("active")).toBe(false);
    });

    it("workspace header gets .active class when activeLevel type is workspace and path matches", () => {
      const { container } = render(
        <Sidebar
          {...defaultProps}
          allProjectsFolder={folder}
          workspaces={[ws1]}
          projects={[repoA]}
          activeLevel={{ type: "workspace", name: "my-workspace", path: "/home/Projects/my-workspace" }}
        />
      );

      const headers = container.querySelectorAll(".workspace-header");
      const wsHeader = Array.from(headers).find((h) => h.querySelector(".workspace-name")?.textContent === "my-workspace");
      expect(wsHeader).not.toBeNull();
      expect(wsHeader!.classList.contains("active")).toBe(true);
    });

    it("workspace header does not get .active class when path does not match", () => {
      const repoC = makeProject({ id: "p4", name: "repo-c", path: "/home/Projects/other-workspace/repo-c", workspace_path: "/home/Projects/other-workspace" });

      const { container } = render(
        <Sidebar
          {...defaultProps}
          allProjectsFolder={folder}
          workspaces={[ws1, ws2]}
          projects={[repoA, repoC]}
          activeLevel={{ type: "workspace", name: "my-workspace", path: "/home/Projects/my-workspace" }}
        />
      );

      const headers = container.querySelectorAll(".workspace-header");
      const otherHeader = Array.from(headers).find((h) => h.querySelector(".workspace-name")?.textContent === "other-workspace");
      expect(otherHeader).not.toBeNull();
      expect(otherHeader!.classList.contains("active")).toBe(false);
    });

    it("project item gets .selected class when activeLevel type is repo and path matches", () => {
      const { container } = render(
        <Sidebar
          {...defaultProps}
          allProjectsFolder={folder}
          workspaces={[ws1]}
          projects={[repoA, repoB]}
          activeLevel={{ type: "repo", name: "repo-a", path: "/home/Projects/my-workspace/repo-a" }}
        />
      );

      const items = container.querySelectorAll(".project-item");
      const repoAItem = Array.from(items).find((el) => el.querySelector(".project-item-name")?.textContent === "repo-a");
      const repoBItem = Array.from(items).find((el) => el.querySelector(".project-item-name")?.textContent === "repo-b");
      expect(repoAItem).not.toBeNull();
      expect(repoBItem).not.toBeNull();
      expect(repoAItem!.classList.contains("selected")).toBe(true);
      expect(repoBItem!.classList.contains("selected")).toBe(false);
    });

    it("project item uses selectedProject fallback when activeLevel is null", () => {
      const { container } = render(
        <Sidebar
          {...defaultProps}
          allProjectsFolder={folder}
          workspaces={[ws1]}
          projects={[repoA, repoB]}
          selectedProject={repoB}
          activeLevel={null}
        />
      );

      const items = container.querySelectorAll(".project-item");
      const repoAItem = Array.from(items).find((el) => el.querySelector(".project-item-name")?.textContent === "repo-a");
      const repoBItem = Array.from(items).find((el) => el.querySelector(".project-item-name")?.textContent === "repo-b");
      expect(repoAItem).not.toBeNull();
      expect(repoBItem).not.toBeNull();
      expect(repoAItem!.classList.contains("selected")).toBe(false);
      expect(repoBItem!.classList.contains("selected")).toBe(true);
    });

    it("only one level is highlighted at a time - workspace active does not select its projects via activePath", () => {
      const { container } = render(
        <Sidebar
          {...defaultProps}
          allProjectsFolder={folder}
          workspaces={[ws1]}
          projects={[repoA, repoB]}
          activeLevel={{ type: "workspace", name: "my-workspace", path: "/home/Projects/my-workspace" }}
        />
      );

      // Workspace header should be active
      const headers = container.querySelectorAll(".workspace-header");
      const wsHeader = Array.from(headers).find((h) => h.querySelector(".workspace-name")?.textContent === "my-workspace");
      expect(wsHeader).not.toBeNull();
      expect(wsHeader!.classList.contains("active")).toBe(true);

      // activePath is null when type is "workspace", so no project is selected via path matching
      const items = container.querySelectorAll(".project-item.selected");
      expect(items.length).toBe(0);
    });

    it("selectedProject fallback still applies when workspace is active", () => {
      const { container } = render(
        <Sidebar
          {...defaultProps}
          allProjectsFolder={folder}
          workspaces={[ws1]}
          projects={[repoA, repoB]}
          selectedProject={repoA}
          activeLevel={{ type: "workspace", name: "my-workspace", path: "/home/Projects/my-workspace" }}
        />
      );

      // Workspace header should be active
      const headers = container.querySelectorAll(".workspace-header");
      const wsHeader = Array.from(headers).find((h) => h.querySelector(".workspace-name")?.textContent === "my-workspace");
      expect(wsHeader).not.toBeNull();
      expect(wsHeader!.classList.contains("active")).toBe(true);

      // selectedProject fallback kicks in because activePath is null
      const items = container.querySelectorAll(".project-item.selected");
      expect(items.length).toBe(1);
      const selectedItem = items[0].querySelector(".project-item-name");
      expect(selectedItem?.textContent).toBe("repo-a");
    });

    it("standalone project item gets .selected class when activeLevel type is repo and path matches", () => {
      const { container } = render(
        <Sidebar
          {...defaultProps}
          allProjectsFolder={folder}
          workspaces={[ws1]}
          projects={[repoA, standalone]}
          activeLevel={{ type: "repo", name: "standalone-repo", path: "/home/Projects/standalone-repo" }}
        />
      );

      const items = container.querySelectorAll(".project-item");
      const standaloneItem = Array.from(items).find((el) => el.querySelector(".project-item-name")?.textContent === "standalone-repo");
      const repoAItem = Array.from(items).find((el) => el.querySelector(".project-item-name")?.textContent === "repo-a");
      expect(standaloneItem).not.toBeNull();
      expect(repoAItem).not.toBeNull();
      expect(standaloneItem!.classList.contains("selected")).toBe(true);
      expect(repoAItem!.classList.contains("selected")).toBe(false);
    });

    it("all-projects active does not highlight workspace headers or project items via activePath", () => {
      const { container } = render(
        <Sidebar
          {...defaultProps}
          allProjectsFolder={folder}
          workspaces={[ws1]}
          projects={[repoA]}
          activeLevel={{ type: "all-projects", name: "Projects", path: "/home/Projects" }}
        />
      );

      // All-projects header should be active
      const apHeader = container.querySelector(".all-projects-header");
      expect(apHeader).not.toBeNull();
      expect(apHeader!.classList.contains("active")).toBe(true);

      // Workspace headers should not be active
      const wsHeaders = container.querySelectorAll(".workspace-header.active");
      expect(wsHeaders.length).toBe(0);

      // No project items selected via activePath (activePath is null when type is "all-projects")
      // and no selectedProject was passed, so nothing is selected
      const selectedItems = container.querySelectorAll(".project-item.selected");
      expect(selectedItems.length).toBe(0);
    });

    it("activePath overrides selectedProject when both are provided", () => {
      const { container } = render(
        <Sidebar
          {...defaultProps}
          allProjectsFolder={folder}
          workspaces={[ws1]}
          projects={[repoA, repoB]}
          selectedProject={repoB}
          activeLevel={{ type: "repo", name: "repo-a", path: "/home/Projects/my-workspace/repo-a" }}
        />
      );

      // activePath points to repo-a, selectedProject points to repo-b
      // activePath should win
      const items = container.querySelectorAll(".project-item");
      const repoAItem = Array.from(items).find((el) => el.querySelector(".project-item-name")?.textContent === "repo-a");
      const repoBItem = Array.from(items).find((el) => el.querySelector(".project-item-name")?.textContent === "repo-b");
      expect(repoAItem).not.toBeNull();
      expect(repoBItem).not.toBeNull();
      expect(repoAItem!.classList.contains("selected")).toBe(true);
      expect(repoBItem!.classList.contains("selected")).toBe(false);
    });

    it("repo-level activeLevel does not activate workspace headers", () => {
      const { container } = render(
        <Sidebar
          {...defaultProps}
          allProjectsFolder={folder}
          workspaces={[ws1]}
          projects={[repoA]}
          activeLevel={{ type: "repo", name: "repo-a", path: "/home/Projects/my-workspace/repo-a" }}
        />
      );

      // Workspace header should NOT be active when activeLevel type is "repo"
      const wsHeaders = container.querySelectorAll(".workspace-header.active");
      expect(wsHeaders.length).toBe(0);

      // All-projects header should NOT be active
      const apHeader = container.querySelector(".all-projects-header");
      expect(apHeader).not.toBeNull();
      expect(apHeader!.classList.contains("active")).toBe(false);

      // But the repo itself should be selected
      const items = container.querySelectorAll(".project-item.selected");
      expect(items.length).toBe(1);
    });

    it("highlighting works in legacy 2-level mode without allProjectsFolder", () => {
      const { container } = render(
        <Sidebar
          {...defaultProps}
          allProjectsFolder={null}
          workspaces={[ws1]}
          projects={[repoA, repoB]}
          activeLevel={{ type: "repo", name: "repo-a", path: "/home/Projects/my-workspace/repo-a" }}
        />
      );

      // No all-projects header should exist
      const apHeader = container.querySelector(".all-projects-header");
      expect(apHeader).toBeNull();

      // Workspace header should still render but not be active (activeLevel type is "repo")
      const wsHeaders = container.querySelectorAll(".workspace-header");
      expect(wsHeaders.length).toBe(1);
      expect(wsHeaders[0].classList.contains("active")).toBe(false);

      // Project should be selected
      const items = container.querySelectorAll(".project-item.selected");
      expect(items.length).toBe(1);
      const selectedName = items[0].querySelector(".project-item-name");
      expect(selectedName?.textContent).toBe("repo-a");
    });
  });
});
