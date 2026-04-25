import { invoke } from "@tauri-apps/api/core";
import type { Project, AllProjectsFolder } from "../types/project";

export interface Workspace {
  id: string;
  name: string;
  path: string;
  added_at: string;
}

interface Bookmarks {
  version: number;
  allProjectsFolder: AllProjectsFolder | null;
  workspaces: Workspace[];
  projects: Project[];
}

async function read(): Promise<Bookmarks> {
  return invoke<Bookmarks>("read_bookmarks");
}

async function write(bm: Bookmarks): Promise<void> {
  await invoke("write_bookmarks", { bookmarks: bm });
}

function nowIso(): string {
  return new Date().toISOString();
}

// ── Projects ──

export async function getAllProjects(): Promise<Project[]> {
  const bm = await read();
  return [...bm.projects].sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { sensitivity: "base" })
  );
}

export async function addProject(
  id: string,
  name: string,
  path: string,
  workspacePath?: string
): Promise<void> {
  const bm = await read();
  if (bm.projects.some((p) => p.path === path)) return; // INSERT OR IGNORE on path
  bm.projects.push({
    id,
    name,
    path,
    added_at: nowIso(),
    last_opened: null,
    workspace_path: workspacePath ?? null,
  });
  await write(bm);
}

export async function updateLastOpened(id: string): Promise<void> {
  const bm = await read();
  const p = bm.projects.find((p) => p.id === id);
  if (!p) return;
  p.last_opened = nowIso();
  await write(bm);
}

export async function removeProject(id: string): Promise<void> {
  const bm = await read();
  const next = bm.projects.filter((p) => p.id !== id);
  if (next.length === bm.projects.length) return;
  bm.projects = next;
  await write(bm);
}

// ── Workspaces ──

export async function getAllWorkspaces(): Promise<Workspace[]> {
  const bm = await read();
  // Original SQL: ORDER BY added_at DESC
  return [...bm.workspaces].sort((a, b) => b.added_at.localeCompare(a.added_at));
}

export async function addWorkspace(id: string, name: string, path: string): Promise<void> {
  const bm = await read();
  if (bm.workspaces.some((w) => w.path === path)) return;
  bm.workspaces.push({ id, name, path, added_at: nowIso() });
  await write(bm);
}

export async function removeWorkspace(id: string): Promise<void> {
  const bm = await read();
  const ws = bm.workspaces.find((w) => w.id === id);
  if (!ws) return;
  bm.projects = bm.projects.filter((p) => p.workspace_path !== ws.path);
  bm.workspaces = bm.workspaces.filter((w) => w.id !== id);
  await write(bm);
}

// ── All Projects Folder ──

export async function getAllProjectsFolder(): Promise<AllProjectsFolder | null> {
  const bm = await read();
  return bm.allProjectsFolder;
}

export async function setAllProjectsFolder(id: string, name: string, path: string): Promise<void> {
  // Original behavior: wipes all_projects, workspaces, projects then sets new folder
  const bm: Bookmarks = {
    version: 1,
    allProjectsFolder: { id, name, path, added_at: nowIso() },
    workspaces: [],
    projects: [],
  };
  await write(bm);
}

export async function removeAllProjectsFolder(): Promise<void> {
  const bm: Bookmarks = {
    version: 1,
    allProjectsFolder: null,
    workspaces: [],
    projects: [],
  };
  await write(bm);
}

export async function clearProjectsAndWorkspaces(): Promise<void> {
  const bm = await read();
  bm.projects = [];
  bm.workspaces = [];
  await write(bm);
}
