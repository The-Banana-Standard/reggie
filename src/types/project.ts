export interface Project {
  id: string;
  name: string;
  path: string;
  added_at: string;
  last_opened: string | null;
  workspace_path: string | null;
}

export interface DirectoryEntry {
  name: string;
  path: string;
  isGitRepo: boolean;
  hasClaudeMd: boolean;
}

export interface AllProjectsFolder {
  id: string;
  name: string;
  path: string;
  added_at: string;
}

export interface ScanResultEntry {
  name: string;
  path: string;
  isWorkspace: boolean;
  isGitRepo: boolean;
  hasClaudeMd: boolean;
  children: DirectoryEntry[];
}
