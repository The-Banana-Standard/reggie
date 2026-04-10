import Database from "@tauri-apps/plugin-sql";
import type { Project, AllProjectsFolder } from "../types/project";

let dbPromise: Promise<Awaited<ReturnType<typeof Database.load>>> | null = null;

async function getDb() {
  if (!dbPromise) {
    dbPromise = initDb();
  }
  return dbPromise;
}

async function initDb() {
  const db = await Database.load("sqlite:forge.db");
  await db.execute(`
      CREATE TABLE IF NOT EXISTS projects (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        path TEXT NOT NULL UNIQUE,
        added_at TEXT NOT NULL DEFAULT (datetime('now')),
        last_opened TEXT,
        workspace_path TEXT
      )
    `);
    await db.execute(`
      CREATE TABLE IF NOT EXISTS workspaces (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        path TEXT NOT NULL UNIQUE,
        added_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `);
    await db.execute(`
      CREATE TABLE IF NOT EXISTS all_projects (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        path TEXT NOT NULL UNIQUE,
        added_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `);

    // Migration: if there are existing workspaces but no all_projects entry,
    // create one from the first workspace's parent directory
    await migrateToAllProjects(db);

  return db;
}

async function migrateToAllProjects(db: Awaited<ReturnType<typeof Database.load>>) {
  const existing = await db.select<AllProjectsFolder[]>("SELECT * FROM all_projects LIMIT 1");
  if (existing.length > 0) {
    return; // Already migrated
  }

  const workspaces = await db.select<Workspace[]>("SELECT * FROM workspaces ORDER BY added_at ASC LIMIT 1");
  if (workspaces.length === 0) {
    return; // No data to migrate
  }

  // Use the first workspace's parent directory as the All Projects folder
  const ws = workspaces[0];
  const parentPath = ws.path.split(/[/\\]/).slice(0, -1).join("/");
  if (parentPath) {
    const name = parentPath.split(/[/\\]/).pop() || "Projects";
    const id = crypto.randomUUID();
    await db.execute(
      "INSERT OR IGNORE INTO all_projects (id, name, path) VALUES ($1, $2, $3)",
      [id, name, parentPath]
    );
  }
}

// ── Projects ──

export async function getAllProjects(): Promise<Project[]> {
  const d = await getDb();
  return await d.select<Project[]>(
    "SELECT * FROM projects ORDER BY name COLLATE NOCASE ASC"
  );
}

export async function addProject(
  id: string,
  name: string,
  path: string,
  workspacePath?: string
): Promise<void> {
  const d = await getDb();
  await d.execute(
    "INSERT OR IGNORE INTO projects (id, name, path, workspace_path) VALUES ($1, $2, $3, $4)",
    [id, name, path, workspacePath || null]
  );
}

export async function updateLastOpened(id: string): Promise<void> {
  const d = await getDb();
  await d.execute(
    "UPDATE projects SET last_opened = datetime('now') WHERE id = $1",
    [id]
  );
}

export async function removeProject(id: string): Promise<void> {
  const d = await getDb();
  await d.execute("DELETE FROM projects WHERE id = $1", [id]);
}

// ── Workspaces ──

export interface Workspace {
  id: string;
  name: string;
  path: string;
  added_at: string;
}

export async function getAllWorkspaces(): Promise<Workspace[]> {
  const d = await getDb();
  return await d.select<Workspace[]>(
    "SELECT * FROM workspaces ORDER BY added_at DESC"
  );
}

export async function addWorkspace(id: string, name: string, path: string): Promise<void> {
  const d = await getDb();
  await d.execute(
    "INSERT OR IGNORE INTO workspaces (id, name, path) VALUES ($1, $2, $3)",
    [id, name, path]
  );
}

export async function removeWorkspace(id: string): Promise<void> {
  const d = await getDb();
  const ws = await d.select<Workspace[]>("SELECT * FROM workspaces WHERE id = $1", [id]);
  if (ws.length > 0) {
    await d.execute("DELETE FROM projects WHERE workspace_path = $1", [ws[0].path]);
    await d.execute("DELETE FROM workspaces WHERE id = $1", [id]);
  }
}

// ── All Projects Folder ──

export async function getAllProjectsFolder(): Promise<AllProjectsFolder | null> {
  const d = await getDb();
  const rows = await d.select<AllProjectsFolder[]>("SELECT * FROM all_projects LIMIT 1");
  return rows.length > 0 ? rows[0] : null;
}

export async function setAllProjectsFolder(id: string, name: string, path: string): Promise<void> {
  const d = await getDb();
  // Clear all existing data before setting new folder
  await d.execute("DELETE FROM all_projects");
  await d.execute("DELETE FROM workspaces");
  await d.execute("DELETE FROM projects");
  await d.execute(
    "INSERT INTO all_projects (id, name, path) VALUES ($1, $2, $3)",
    [id, name, path]
  );
}

export async function removeAllProjectsFolder(): Promise<void> {
  const d = await getDb();
  await d.execute("DELETE FROM all_projects");
  // Also clear workspaces and projects since they lived under the folder
  await d.execute("DELETE FROM workspaces");
  await d.execute("DELETE FROM projects");
}

export async function clearProjectsAndWorkspaces(): Promise<void> {
  const d = await getDb();
  await d.execute("DELETE FROM projects");
  await d.execute("DELETE FROM workspaces");
}

