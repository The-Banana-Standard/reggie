import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { mockInvoke, resetTauriMocks } from "../../__test-utils__/tauri-mock";
import { useProjects } from "../useProjects";
import { open } from "@tauri-apps/plugin-dialog";

// Mock database-service
const mockGetAllProjects = vi.fn();
const mockAddProject = vi.fn();
const mockUpdateLastOpened = vi.fn();
const mockRemoveProject = vi.fn();
const mockGetAllWorkspaces = vi.fn();
const mockAddWorkspace = vi.fn();
const mockRemoveWorkspace = vi.fn();
const mockGetAllProjectsFolder = vi.fn();
const mockSetAllProjectsFolder = vi.fn();
const mockRemoveAllProjectsFolder = vi.fn();
const mockClearProjectsAndWorkspaces = vi.fn();

vi.mock("../../services/database-service", () => ({
  getAllProjects: (...args: unknown[]) => mockGetAllProjects(...args),
  addProject: (...args: unknown[]) => mockAddProject(...args),
  updateLastOpened: (...args: unknown[]) => mockUpdateLastOpened(...args),
  removeProject: (...args: unknown[]) => mockRemoveProject(...args),
  getAllWorkspaces: (...args: unknown[]) => mockGetAllWorkspaces(...args),
  addWorkspace: (...args: unknown[]) => mockAddWorkspace(...args),
  removeWorkspace: (...args: unknown[]) => mockRemoveWorkspace(...args),
  getAllProjectsFolder: (...args: unknown[]) => mockGetAllProjectsFolder(...args),
  setAllProjectsFolder: (...args: unknown[]) => mockSetAllProjectsFolder(...args),
  removeAllProjectsFolder: (...args: unknown[]) => mockRemoveAllProjectsFolder(...args),
  clearProjectsAndWorkspaces: (...args: unknown[]) => mockClearProjectsAndWorkspaces(...args),
}));

// Mock dialog
vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: vi.fn(),
}));

let uuidCounter = 0;

beforeEach(() => {
  uuidCounter = 0;
  vi.spyOn(crypto, "randomUUID").mockImplementation(() => `uuid-${++uuidCounter}` as `${string}-${string}-${string}-${string}-${string}`);
  resetTauriMocks();
  mockGetAllProjects.mockReset().mockResolvedValue([]);
  mockAddProject.mockReset().mockResolvedValue(undefined);
  mockUpdateLastOpened.mockReset().mockResolvedValue(undefined);
  mockRemoveProject.mockReset().mockResolvedValue(undefined);
  mockGetAllWorkspaces.mockReset().mockResolvedValue([]);
  mockAddWorkspace.mockReset().mockResolvedValue(undefined);
  mockRemoveWorkspace.mockReset().mockResolvedValue(undefined);
  mockGetAllProjectsFolder.mockReset().mockResolvedValue(null);
  mockSetAllProjectsFolder.mockReset().mockResolvedValue(undefined);
  mockRemoveAllProjectsFolder.mockReset().mockResolvedValue(undefined);
  mockClearProjectsAndWorkspaces.mockReset().mockResolvedValue(undefined);
  mockInvoke.mockResolvedValue([]); // scan commands return empty
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("useProjects", () => {
  it("loads projects and workspaces on mount", async () => {
    const projects = [{ id: "p1", name: "MyApp", path: "/proj", added_at: "", last_opened: null, workspace_path: null }];
    mockGetAllProjects.mockResolvedValue(projects);
    mockGetAllWorkspaces.mockResolvedValue([]);

    const { result } = renderHook(() => useProjects());

    await waitFor(() => {
      expect(result.current.projects).toEqual(projects);
    });
  });

  it("starts with no selected project", async () => {
    const { result } = renderHook(() => useProjects());

    await waitFor(() => {
      expect(result.current.projects).toBeDefined();
    });

    expect(result.current.selectedProject).toBeNull();
  });

  it("starts with null allProjectsFolder", async () => {
    const { result } = renderHook(() => useProjects());

    await waitFor(() => {
      expect(result.current.projects).toBeDefined();
    });

    expect(result.current.allProjectsFolder).toBeNull();
  });

  it("selectProject sets selectedProject and updates last_opened", async () => {
    const project = { id: "p1", name: "MyApp", path: "/proj", added_at: "", last_opened: null, workspace_path: null };
    mockGetAllProjects.mockResolvedValue([project]);

    const { result } = renderHook(() => useProjects());

    await waitFor(() => {
      expect(result.current.projects.length).toBe(1);
    });

    await act(async () => {
      await result.current.selectProject(project);
    });

    expect(result.current.selectedProject).toEqual(project);
    expect(mockUpdateLastOpened).toHaveBeenCalledWith("p1");
  });

  it("removeProject calls service and reloads", async () => {
    const { result } = renderHook(() => useProjects());

    await waitFor(() => {
      expect(result.current.projects).toBeDefined();
    });

    await act(async () => {
      await result.current.removeProject("p1");
    });

    expect(mockRemoveProject).toHaveBeenCalledWith("p1");
    // Should reload (getAllProjects called again)
    expect(mockGetAllProjects.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it("removeProject clears selectedProject if it was the removed one", async () => {
    const project = { id: "p1", name: "MyApp", path: "/proj", added_at: "", last_opened: null, workspace_path: null };
    mockGetAllProjects.mockResolvedValue([project]);

    const { result } = renderHook(() => useProjects());

    await waitFor(() => {
      expect(result.current.projects.length).toBe(1);
    });

    await act(async () => {
      await result.current.selectProject(project);
    });

    await act(async () => {
      await result.current.removeProject("p1");
    });

    expect(result.current.selectedProject).toBeNull();
  });

  it("removeWorkspace calls service and reloads", async () => {
    const { result } = renderHook(() => useProjects());

    await waitFor(() => {
      expect(result.current.projects).toBeDefined();
    });

    await act(async () => {
      await result.current.removeWorkspace("w1");
    });

    expect(mockRemoveWorkspace).toHaveBeenCalledWith("w1");
  });

  it("syncs workspaces on mount by calling scan_workspace in legacy mode", async () => {
    const workspace = { id: "w1", name: "workspace", path: "/home/user/workspace", added_at: "" };
    mockGetAllWorkspaces.mockResolvedValue([workspace]);
    mockGetAllProjectsFolder.mockResolvedValue(null); // legacy mode
    mockInvoke.mockResolvedValue([
      { name: "proj-a", path: "/home/user/workspace/proj-a", is_git_repo: true, has_claude_md: false },
    ]);

    const { result } = renderHook(() => useProjects());

    await waitFor(() => {
      expect(result.current.projects).toBeDefined();
    });

    expect(mockInvoke).toHaveBeenCalledWith("scan_workspace", {
      workspacePath: "/home/user/workspace",
    });
    expect(mockAddProject).toHaveBeenCalledWith(
      "uuid-1",
      "proj-a",
      "/home/user/workspace/proj-a",
      "/home/user/workspace"
    );
  });

  it("syncs all projects folder on mount by calling scan_all_projects", async () => {
    const folder = { id: "apf1", name: "Projects", path: "/home/user/Projects", added_at: "" };
    mockGetAllProjectsFolder.mockResolvedValue(folder);
    mockInvoke.mockResolvedValue([
      {
        name: "my-workspace",
        path: "/home/user/Projects/my-workspace",
        isWorkspace: true,
        isGitRepo: false,
        hasClaudeMd: false,
        children: [
          { name: "repo-a", path: "/home/user/Projects/my-workspace/repo-a", isGitRepo: true, hasClaudeMd: false },
        ],
      },
      {
        name: "standalone-repo",
        path: "/home/user/Projects/standalone-repo",
        isWorkspace: false,
        isGitRepo: true,
        hasClaudeMd: true,
        children: [],
      },
    ]);

    const { result } = renderHook(() => useProjects());

    await waitFor(() => {
      expect(result.current.projects).toBeDefined();
    });

    expect(mockInvoke).toHaveBeenCalledWith("scan_all_projects", {
      folderPath: "/home/user/Projects",
    });
    // Workspace should be added
    expect(mockAddWorkspace).toHaveBeenCalledWith(
      "uuid-1",
      "my-workspace",
      "/home/user/Projects/my-workspace"
    );
    // Repo under workspace should be added with workspace_path
    expect(mockAddProject).toHaveBeenCalledWith(
      "uuid-2",
      "repo-a",
      "/home/user/Projects/my-workspace/repo-a",
      "/home/user/Projects/my-workspace"
    );
    // Standalone repo should be added without workspace_path
    expect(mockAddProject).toHaveBeenCalledWith(
      "uuid-3",
      "standalone-repo",
      "/home/user/Projects/standalone-repo"
    );
  });

  it("removeAllProjectsFolder clears all state", async () => {
    const folder = { id: "apf1", name: "Projects", path: "/home/user/Projects", added_at: "" };
    mockGetAllProjectsFolder.mockResolvedValue(folder);
    mockInvoke.mockResolvedValue([]); // empty scan

    const { result } = renderHook(() => useProjects());

    await waitFor(() => {
      expect(result.current.allProjectsFolder).toEqual(folder);
    });

    await act(async () => {
      await result.current.removeAllProjectsFolder();
    });

    expect(mockRemoveAllProjectsFolder).toHaveBeenCalled();
    expect(result.current.allProjectsFolder).toBeNull();
    expect(result.current.projects).toEqual([]);
    expect(result.current.workspaces).toEqual([]);
  });

  it("removeAllProjectsFolder also clears selectedProject", async () => {
    const folder = { id: "apf1", name: "Projects", path: "/home/user/Projects", added_at: "" };
    const project = { id: "p1", name: "MyApp", path: "/home/user/Projects/MyApp", added_at: "", last_opened: null, workspace_path: null };
    mockGetAllProjectsFolder.mockResolvedValue(folder);
    mockGetAllProjects.mockResolvedValue([project]);
    mockInvoke.mockResolvedValue([]);

    const { result } = renderHook(() => useProjects());

    await waitFor(() => {
      expect(result.current.projects.length).toBe(1);
    });

    await act(async () => {
      await result.current.selectProject(project);
    });

    expect(result.current.selectedProject).toEqual(project);

    await act(async () => {
      await result.current.removeAllProjectsFolder();
    });

    expect(result.current.selectedProject).toBeNull();
  });

  it("handles scan_all_projects returning empty results gracefully", async () => {
    const folder = { id: "apf1", name: "Empty", path: "/home/user/Empty", added_at: "" };
    mockGetAllProjectsFolder.mockResolvedValue(folder);
    mockInvoke.mockResolvedValue([]); // empty scan

    const { result } = renderHook(() => useProjects());

    await waitFor(() => {
      expect(result.current.allProjectsFolder).toEqual(folder);
    });

    // No workspaces or projects should be added
    expect(mockAddWorkspace).not.toHaveBeenCalled();
    expect(mockAddProject).not.toHaveBeenCalled();
  });

  it("handles scan_all_projects failure gracefully", async () => {
    const folder = { id: "apf1", name: "Projects", path: "/home/user/Projects", added_at: "" };
    mockGetAllProjectsFolder.mockResolvedValue(folder);
    mockInvoke.mockRejectedValue(new Error("Permission denied"));

    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const { result } = renderHook(() => useProjects());

    await waitFor(() => {
      expect(result.current.allProjectsFolder).toEqual(folder);
    });

    // Should not crash; should log the error
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      "Failed to sync all projects folder:",
      expect.any(Error)
    );

    consoleErrorSpy.mockRestore();
  });

  it("populateFromScanResults creates workspaces and projects correctly for multiple workspaces", async () => {
    const folder = { id: "apf1", name: "Projects", path: "/home/user/Projects", added_at: "" };
    mockGetAllProjectsFolder.mockResolvedValue(folder);
    mockInvoke.mockResolvedValue([
      {
        name: "workspace-a",
        path: "/home/user/Projects/workspace-a",
        isWorkspace: true,
        isGitRepo: false,
        hasClaudeMd: false,
        children: [
          { name: "repo-1", path: "/home/user/Projects/workspace-a/repo-1", isGitRepo: true, hasClaudeMd: false },
        ],
      },
      {
        name: "workspace-b",
        path: "/home/user/Projects/workspace-b",
        isWorkspace: true,
        isGitRepo: false,
        hasClaudeMd: false,
        children: [
          { name: "repo-2", path: "/home/user/Projects/workspace-b/repo-2", isGitRepo: true, hasClaudeMd: true },
          { name: "repo-3", path: "/home/user/Projects/workspace-b/repo-3", isGitRepo: true, hasClaudeMd: false },
        ],
      },
    ]);

    renderHook(() => useProjects());

    await waitFor(() => {
      expect(mockAddWorkspace).toHaveBeenCalledTimes(2);
    });

    // Two workspaces
    expect(mockAddWorkspace).toHaveBeenCalledWith("uuid-1", "workspace-a", "/home/user/Projects/workspace-a");
    expect(mockAddWorkspace).toHaveBeenCalledWith("uuid-3", "workspace-b", "/home/user/Projects/workspace-b");

    // Three child repos total
    expect(mockAddProject).toHaveBeenCalledTimes(3);
    expect(mockAddProject).toHaveBeenCalledWith("uuid-2", "repo-1", "/home/user/Projects/workspace-a/repo-1", "/home/user/Projects/workspace-a");
    expect(mockAddProject).toHaveBeenCalledWith("uuid-4", "repo-2", "/home/user/Projects/workspace-b/repo-2", "/home/user/Projects/workspace-b");
    expect(mockAddProject).toHaveBeenCalledWith("uuid-5", "repo-3", "/home/user/Projects/workspace-b/repo-3", "/home/user/Projects/workspace-b");
  });

  it("removeProject does not clear selectedProject if a different project was removed", async () => {
    const projectA = { id: "p1", name: "AppA", path: "/a", added_at: "", last_opened: null, workspace_path: null };
    const projectB = { id: "p2", name: "AppB", path: "/b", added_at: "", last_opened: null, workspace_path: null };
    mockGetAllProjects.mockResolvedValue([projectA, projectB]);

    const { result } = renderHook(() => useProjects());

    await waitFor(() => {
      expect(result.current.projects.length).toBe(2);
    });

    await act(async () => {
      await result.current.selectProject(projectA);
    });

    await act(async () => {
      await result.current.removeProject("p2");
    });

    // Selected project should still be projectA since we removed projectB
    expect(result.current.selectedProject).toEqual(projectA);
  });

  it("addProject assigns workspace_path when project path is inside a workspace", async () => {
    const workspace = { id: "w1", name: "my-workspace", path: "/home/user/my-workspace", added_at: "" };
    mockGetAllWorkspaces.mockResolvedValue([workspace]);
    vi.mocked(open).mockResolvedValue("/home/user/my-workspace/my-repo");

    const { result } = renderHook(() => useProjects());

    await waitFor(() => {
      expect(result.current.workspaces).toEqual([workspace]);
    });

    // Clear mock calls from mount sync so we only see addProject from handleAddProject
    mockAddProject.mockClear();

    await act(async () => {
      await result.current.addProject();
    });

    expect(mockAddProject).toHaveBeenCalledWith(
      expect.any(String),
      "my-repo",
      "/home/user/my-workspace/my-repo",
      "/home/user/my-workspace"
    );
  });

  it("addProject adds as standalone when project path is outside any workspace", async () => {
    const workspace = { id: "w1", name: "my-workspace", path: "/home/user/my-workspace", added_at: "" };
    mockGetAllWorkspaces.mockResolvedValue([workspace]);
    vi.mocked(open).mockResolvedValue("/home/user/other-folder/standalone-repo");

    const { result } = renderHook(() => useProjects());

    await waitFor(() => {
      expect(result.current.workspaces).toEqual([workspace]);
    });

    mockAddProject.mockClear();

    await act(async () => {
      await result.current.addProject();
    });

    expect(mockAddProject).toHaveBeenCalledWith(
      expect.any(String),
      "standalone-repo",
      "/home/user/other-folder/standalone-repo",
      undefined
    );
  });

  it("addProject does not false-match similar path prefixes", async () => {
    const workspace = { id: "w1", name: "work", path: "/home/user/work", added_at: "" };
    mockGetAllWorkspaces.mockResolvedValue([workspace]);
    // "/home/user/worker/repo" starts with "/home/user/work" but NOT "/home/user/work/"
    vi.mocked(open).mockResolvedValue("/home/user/worker/repo");

    const { result } = renderHook(() => useProjects());

    await waitFor(() => {
      expect(result.current.workspaces).toEqual([workspace]);
    });

    mockAddProject.mockClear();

    await act(async () => {
      await result.current.addProject();
    });

    expect(mockAddProject).toHaveBeenCalledWith(
      expect.any(String),
      "repo",
      "/home/user/worker/repo",
      undefined
    );
  });

  it("addProject works when workspaces have trailing slashes", async () => {
    const workspace = { id: "w1", name: "my-workspace", path: "/home/user/my-workspace/", added_at: "" };
    mockGetAllWorkspaces.mockResolvedValue([workspace]);
    vi.mocked(open).mockResolvedValue("/home/user/my-workspace/nested-repo");

    const { result } = renderHook(() => useProjects());

    await waitFor(() => {
      expect(result.current.workspaces).toEqual([workspace]);
    });

    mockAddProject.mockClear();

    await act(async () => {
      await result.current.addProject();
    });

    expect(mockAddProject).toHaveBeenCalledWith(
      expect.any(String),
      "nested-repo",
      "/home/user/my-workspace/nested-repo",
      "/home/user/my-workspace/"
    );
  });

  it("addProject matches the correct workspace when multiple workspaces exist", async () => {
    const wsA = { id: "w1", name: "workspace-a", path: "/home/user/workspace-a", added_at: "" };
    const wsB = { id: "w2", name: "workspace-b", path: "/home/user/workspace-b", added_at: "" };
    mockGetAllWorkspaces.mockResolvedValue([wsA, wsB]);
    vi.mocked(open).mockResolvedValue("/home/user/workspace-b/my-repo");

    const { result } = renderHook(() => useProjects());

    await waitFor(() => {
      expect(result.current.workspaces).toHaveLength(2);
    });

    mockAddProject.mockClear();

    await act(async () => {
      await result.current.addProject();
    });

    expect(mockAddProject).toHaveBeenCalledWith(
      expect.any(String),
      "my-repo",
      "/home/user/workspace-b/my-repo",
      "/home/user/workspace-b"
    );
  });

  it("addProject does nothing when dialog is cancelled", async () => {
    const workspace = { id: "w1", name: "my-workspace", path: "/home/user/my-workspace", added_at: "" };
    mockGetAllWorkspaces.mockResolvedValue([workspace]);
    vi.mocked(open).mockResolvedValue(null);

    const { result } = renderHook(() => useProjects());

    await waitFor(() => {
      expect(result.current.workspaces).toEqual([workspace]);
    });

    mockAddProject.mockClear();

    await act(async () => {
      await result.current.addProject();
    });

    expect(mockAddProject).not.toHaveBeenCalled();
  });
});
