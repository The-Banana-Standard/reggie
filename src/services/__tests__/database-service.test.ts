import { describe, it, expect, vi, beforeEach } from "vitest";

interface BookmarksState {
  version: number;
  allProjectsFolder: { id: string; name: string; path: string; added_at: string } | null;
  workspaces: Array<{ id: string; name: string; path: string; added_at: string }>;
  projects: Array<{
    id: string;
    name: string;
    path: string;
    added_at: string;
    last_opened: string | null;
    workspace_path: string | null;
  }>;
}

let bookmarksState: BookmarksState;

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async (cmd: string, args?: { bookmarks?: BookmarksState }) => {
    if (cmd === "read_bookmarks") {
      // Return a deep clone so callers can mutate freely without poisoning state
      return JSON.parse(JSON.stringify(bookmarksState));
    }
    if (cmd === "write_bookmarks") {
      if (!args || !args.bookmarks) throw new Error("write_bookmarks requires bookmarks arg");
      bookmarksState = JSON.parse(JSON.stringify(args.bookmarks));
      return undefined;
    }
    throw new Error(`unmocked command: ${cmd}`);
  }),
}));

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
  bookmarksState = {
    version: 1,
    allProjectsFolder: null,
    workspaces: [],
    projects: [],
  };
});

describe("database-service", () => {
  // ── Projects ──

  describe("getAllProjects", () => {
    it("returns projects sorted by name (case-insensitive)", async () => {
      bookmarksState.projects = [
        { id: "p2", name: "banana", path: "/b", added_at: "2024-01-01", last_opened: null, workspace_path: null },
        { id: "p1", name: "Apple", path: "/a", added_at: "2024-01-01", last_opened: null, workspace_path: null },
        { id: "p3", name: "cherry", path: "/c", added_at: "2024-01-01", last_opened: null, workspace_path: null },
      ];

      const result = await getAllProjects();

      expect(result.map((p) => p.id)).toEqual(["p1", "p2", "p3"]);
    });

    it("returns empty array when no projects", async () => {
      const result = await getAllProjects();
      expect(result).toEqual([]);
    });
  });

  describe("addProject", () => {
    it("inserts project with workspace_path", async () => {
      await addProject("p1", "MyApp", "/path/to/app", "/workspace");

      expect(bookmarksState.projects).toHaveLength(1);
      expect(bookmarksState.projects[0]).toMatchObject({
        id: "p1",
        name: "MyApp",
        path: "/path/to/app",
        workspace_path: "/workspace",
        last_opened: null,
      });
      expect(bookmarksState.projects[0].added_at).toBeTruthy();
    });

    it("inserts project with null workspace_path when omitted", async () => {
      await addProject("p1", "MyApp", "/path/to/app");

      expect(bookmarksState.projects[0].workspace_path).toBeNull();
    });

    it("does not insert duplicate (same path)", async () => {
      await addProject("p1", "MyApp", "/path/to/app");
      await addProject("p2", "Other", "/path/to/app");

      expect(bookmarksState.projects).toHaveLength(1);
      expect(bookmarksState.projects[0].id).toBe("p1");
    });
  });

  describe("updateLastOpened", () => {
    it("updates last_opened for the given project id", async () => {
      bookmarksState.projects = [
        { id: "p1", name: "App", path: "/a", added_at: "2024-01-01", last_opened: null, workspace_path: null },
      ];

      await updateLastOpened("p1");

      expect(bookmarksState.projects[0].last_opened).toBeTruthy();
    });

    it("is a no-op when project id is unknown", async () => {
      await updateLastOpened("nope");
      expect(bookmarksState.projects).toEqual([]);
    });
  });

  describe("removeProject", () => {
    it("deletes the project by id", async () => {
      bookmarksState.projects = [
        { id: "p1", name: "App", path: "/a", added_at: "", last_opened: null, workspace_path: null },
        { id: "p2", name: "Other", path: "/b", added_at: "", last_opened: null, workspace_path: null },
      ];

      await removeProject("p1");

      expect(bookmarksState.projects.map((p) => p.id)).toEqual(["p2"]);
    });
  });

  // ── Workspaces ──

  describe("getAllWorkspaces", () => {
    it("returns workspaces sorted by added_at DESC", async () => {
      bookmarksState.workspaces = [
        { id: "w1", name: "older", path: "/old", added_at: "2024-01-01T00:00:00.000Z" },
        { id: "w2", name: "newer", path: "/new", added_at: "2024-06-01T00:00:00.000Z" },
      ];

      const result = await getAllWorkspaces();

      expect(result.map((w) => w.id)).toEqual(["w2", "w1"]);
    });
  });

  describe("addWorkspace", () => {
    it("inserts workspace", async () => {
      await addWorkspace("w1", "workspace", "/home/workspace");

      expect(bookmarksState.workspaces).toHaveLength(1);
      expect(bookmarksState.workspaces[0]).toMatchObject({
        id: "w1",
        name: "workspace",
        path: "/home/workspace",
      });
    });

    it("does not insert duplicate (same path)", async () => {
      await addWorkspace("w1", "workspace", "/home/workspace");
      await addWorkspace("w2", "other", "/home/workspace");

      expect(bookmarksState.workspaces).toHaveLength(1);
    });
  });

  describe("removeWorkspace", () => {
    it("deletes workspace and cascades to its projects", async () => {
      bookmarksState.workspaces = [
        { id: "w1", name: "ws", path: "/ws", added_at: "" },
        { id: "w2", name: "other", path: "/other", added_at: "" },
      ];
      bookmarksState.projects = [
        { id: "p1", name: "A", path: "/ws/a", added_at: "", last_opened: null, workspace_path: "/ws" },
        { id: "p2", name: "B", path: "/ws/b", added_at: "", last_opened: null, workspace_path: "/ws" },
        { id: "p3", name: "C", path: "/other/c", added_at: "", last_opened: null, workspace_path: "/other" },
      ];

      await removeWorkspace("w1");

      expect(bookmarksState.workspaces.map((w) => w.id)).toEqual(["w2"]);
      expect(bookmarksState.projects.map((p) => p.id)).toEqual(["p3"]);
    });

    it("does nothing if workspace not found", async () => {
      bookmarksState.workspaces = [
        { id: "w1", name: "ws", path: "/ws", added_at: "" },
      ];
      bookmarksState.projects = [
        { id: "p1", name: "A", path: "/ws/a", added_at: "", last_opened: null, workspace_path: "/ws" },
      ];

      await removeWorkspace("nonexistent");

      expect(bookmarksState.workspaces).toHaveLength(1);
      expect(bookmarksState.projects).toHaveLength(1);
    });
  });

  // ── All Projects Folder ──

  describe("getAllProjectsFolder", () => {
    it("returns null when no folder is set", async () => {
      const result = await getAllProjectsFolder();
      expect(result).toBeNull();
    });

    it("returns the folder when set", async () => {
      const folder = { id: "apf1", name: "Projects", path: "/home/Projects", added_at: "2024-01-01" };
      bookmarksState.allProjectsFolder = folder;

      const result = await getAllProjectsFolder();

      expect(result).toEqual(folder);
    });
  });

  describe("setAllProjectsFolder", () => {
    it("wipes existing data and sets the new folder", async () => {
      bookmarksState.workspaces = [{ id: "w1", name: "w", path: "/w", added_at: "" }];
      bookmarksState.projects = [
        { id: "p1", name: "p", path: "/p", added_at: "", last_opened: null, workspace_path: null },
      ];

      await setAllProjectsFolder("apf1", "Projects", "/home/Projects");

      expect(bookmarksState.allProjectsFolder).toMatchObject({
        id: "apf1",
        name: "Projects",
        path: "/home/Projects",
      });
      expect(bookmarksState.workspaces).toEqual([]);
      expect(bookmarksState.projects).toEqual([]);
    });
  });

  describe("removeAllProjectsFolder", () => {
    it("clears folder, workspaces, and projects", async () => {
      bookmarksState.allProjectsFolder = { id: "apf1", name: "P", path: "/P", added_at: "" };
      bookmarksState.workspaces = [{ id: "w1", name: "w", path: "/w", added_at: "" }];
      bookmarksState.projects = [
        { id: "p1", name: "p", path: "/p", added_at: "", last_opened: null, workspace_path: null },
      ];

      await removeAllProjectsFolder();

      expect(bookmarksState.allProjectsFolder).toBeNull();
      expect(bookmarksState.workspaces).toEqual([]);
      expect(bookmarksState.projects).toEqual([]);
    });
  });

  // ── Clear Projects and Workspaces ──

  describe("clearProjectsAndWorkspaces", () => {
    it("clears projects and workspaces but preserves the all-projects folder", async () => {
      const folder = { id: "apf1", name: "P", path: "/P", added_at: "" };
      bookmarksState.allProjectsFolder = folder;
      bookmarksState.workspaces = [{ id: "w1", name: "w", path: "/w", added_at: "" }];
      bookmarksState.projects = [
        { id: "p1", name: "p", path: "/p", added_at: "", last_opened: null, workspace_path: null },
      ];

      await clearProjectsAndWorkspaces();

      expect(bookmarksState.allProjectsFolder).toEqual(folder);
      expect(bookmarksState.workspaces).toEqual([]);
      expect(bookmarksState.projects).toEqual([]);
    });
  });
});
