import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the db object returned by Database.load
const mockExecute = vi.fn();
const mockSelect = vi.fn();

vi.mock("@tauri-apps/plugin-sql", () => ({
  default: {
    load: vi.fn().mockResolvedValue({
      execute: (...args: unknown[]) => mockExecute(...args),
      select: (...args: unknown[]) => mockSelect(...args),
    }),
  },
}));

// Must import AFTER the mock so the module picks up the mocked Database
import {
  getAllProjects,
  addProject,
  updateLastOpened,
  removeProject,
  getAllWorkspaces,
  addWorkspace,
  removeWorkspace,
  getAllProjectsFolder,
  setAllProjectsFolder,
  removeAllProjectsFolder,
  clearProjectsAndWorkspaces,
} from "../database-service";

beforeEach(() => {
  mockExecute.mockReset().mockResolvedValue(undefined);
  mockSelect.mockReset().mockResolvedValue([]);
});

describe("database-service", () => {
  // ── Projects ──

  describe("getAllProjects", () => {
    it("returns projects sorted by name", async () => {
      const projects = [{ id: "p1", name: "Aaa", path: "/a", added_at: "", last_opened: null, workspace_path: null }];
      mockSelect.mockResolvedValue(projects);

      const result = await getAllProjects();

      expect(result).toEqual(projects);
      expect(mockSelect).toHaveBeenCalledWith(
        expect.stringContaining("SELECT * FROM projects")
      );
    });
  });

  describe("addProject", () => {
    it("inserts project with workspace_path", async () => {
      await addProject("p1", "MyApp", "/path/to/app", "/workspace");

      expect(mockExecute).toHaveBeenCalledWith(
        expect.stringContaining("INSERT OR IGNORE INTO projects"),
        ["p1", "MyApp", "/path/to/app", "/workspace"]
      );
    });

    it("inserts project with null workspace_path when omitted", async () => {
      await addProject("p1", "MyApp", "/path/to/app");

      expect(mockExecute).toHaveBeenCalledWith(
        expect.stringContaining("INSERT OR IGNORE INTO projects"),
        ["p1", "MyApp", "/path/to/app", null]
      );
    });
  });

  describe("updateLastOpened", () => {
    it("updates last_opened for the given project id", async () => {
      await updateLastOpened("p1");

      expect(mockExecute).toHaveBeenCalledWith(
        expect.stringContaining("UPDATE projects SET last_opened"),
        ["p1"]
      );
    });
  });

  describe("removeProject", () => {
    it("deletes the project by id", async () => {
      await removeProject("p1");

      expect(mockExecute).toHaveBeenCalledWith(
        expect.stringContaining("DELETE FROM projects WHERE id"),
        ["p1"]
      );
    });
  });

  // ── Workspaces ──

  describe("getAllWorkspaces", () => {
    it("returns workspaces sorted by added_at DESC", async () => {
      const workspaces = [{ id: "w1", name: "ws", path: "/ws", added_at: "" }];
      mockSelect.mockResolvedValue(workspaces);

      const result = await getAllWorkspaces();

      expect(result).toEqual(workspaces);
      expect(mockSelect).toHaveBeenCalledWith(
        expect.stringContaining("SELECT * FROM workspaces")
      );
    });
  });

  describe("addWorkspace", () => {
    it("inserts workspace", async () => {
      await addWorkspace("w1", "workspace", "/home/workspace");

      expect(mockExecute).toHaveBeenCalledWith(
        expect.stringContaining("INSERT OR IGNORE INTO workspaces"),
        ["w1", "workspace", "/home/workspace"]
      );
    });
  });

  describe("removeWorkspace", () => {
    it("deletes workspace and its projects", async () => {
      mockSelect.mockResolvedValue([{ id: "w1", name: "ws", path: "/ws", added_at: "" }]);

      await removeWorkspace("w1");

      // Should first select the workspace to get its path
      expect(mockSelect).toHaveBeenCalledWith(
        expect.stringContaining("SELECT * FROM workspaces WHERE id"),
        ["w1"]
      );
      // Then delete associated projects
      expect(mockExecute).toHaveBeenCalledWith(
        expect.stringContaining("DELETE FROM projects WHERE workspace_path"),
        ["/ws"]
      );
      // Then delete the workspace itself
      expect(mockExecute).toHaveBeenCalledWith(
        expect.stringContaining("DELETE FROM workspaces WHERE id"),
        ["w1"]
      );
    });

    it("does nothing if workspace not found", async () => {
      mockSelect.mockResolvedValue([]);

      await removeWorkspace("nonexistent");

      // select was called, but no execute for delete
      expect(mockSelect).toHaveBeenCalled();
      // Only the initial schema creation executes happened, no workspace/project deletes
      const deleteCalls = mockExecute.mock.calls.filter(
        (call) => typeof call[0] === "string" && call[0].includes("DELETE")
      );
      expect(deleteCalls).toHaveLength(0);
    });
  });

  // ── All Projects Folder ──

  describe("getAllProjectsFolder", () => {
    it("returns null when no folder is set", async () => {
      mockSelect.mockResolvedValue([]);

      const result = await getAllProjectsFolder();

      expect(result).toBeNull();
      expect(mockSelect).toHaveBeenCalledWith(
        expect.stringContaining("SELECT * FROM all_projects")
      );
    });

    it("returns the folder when set", async () => {
      const folder = { id: "apf1", name: "Projects", path: "/home/Projects", added_at: "" };
      mockSelect.mockResolvedValue([folder]);

      const result = await getAllProjectsFolder();

      expect(result).toEqual(folder);
    });
  });

  describe("setAllProjectsFolder", () => {
    it("clears existing and inserts new folder", async () => {
      await setAllProjectsFolder("apf1", "Projects", "/home/Projects");

      // Should delete first
      expect(mockExecute).toHaveBeenCalledWith(
        expect.stringContaining("DELETE FROM all_projects")
      );
      // Then insert
      expect(mockExecute).toHaveBeenCalledWith(
        expect.stringContaining("INSERT INTO all_projects"),
        ["apf1", "Projects", "/home/Projects"]
      );
    });
  });

  describe("removeAllProjectsFolder", () => {
    it("deletes folder, workspaces, and projects", async () => {
      await removeAllProjectsFolder();

      const deleteCalls = mockExecute.mock.calls.filter(
        (call) => typeof call[0] === "string" && call[0].includes("DELETE")
      );
      // Should delete from all_projects, workspaces, and projects
      expect(deleteCalls.length).toBe(3);
    });
  });

  // ── Clear Projects and Workspaces ──

  describe("clearProjectsAndWorkspaces", () => {
    it("deletes all projects and workspaces", async () => {
      await clearProjectsAndWorkspaces();

      expect(mockExecute).toHaveBeenCalledWith(
        expect.stringContaining("DELETE FROM projects")
      );
      expect(mockExecute).toHaveBeenCalledWith(
        expect.stringContaining("DELETE FROM workspaces")
      );
    });
  });

});


