import type { RepoTaskSummary } from "../../types/terminal";

export interface RepoGroup {
  name: string;
  isWorkspace: boolean;
  repos: RepoTaskSummary[];
}

export function groupByWorkspace(repos: RepoTaskSummary[]): RepoGroup[] {
  const workspaceMap = new Map<string, RepoTaskSummary[]>();
  const standalone: RepoTaskSummary[] = [];

  for (const repo of repos) {
    if (repo.workspaceName) {
      const existing = workspaceMap.get(repo.workspaceName);
      if (existing) {
        existing.push(repo);
      } else {
        workspaceMap.set(repo.workspaceName, [repo]);
      }
    } else {
      standalone.push(repo);
    }
  }

  const groups: RepoGroup[] = [];

  for (const [name, wsRepos] of workspaceMap) {
    groups.push({ name, isWorkspace: true, repos: wsRepos });
  }

  if (standalone.length > 0) {
    groups.push({ name: "Standalone", isWorkspace: standalone.length > 1, repos: standalone });
  }

  return groups;
}
