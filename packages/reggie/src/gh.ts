import { commandExists, run } from "./git.js";

export interface PullRequest {
  number: number;
  url: string;
  state: "OPEN" | "MERGED" | "CLOSED";
  headRefName: string;
  title: string;
}

let cache: { root: string; prs: PullRequest[] | null } | null = null;

/** True when the gh CLI is installed and authenticated. */
export function ghAvailable(): boolean {
  if (!commandExists("gh")) return false;
  return run("gh", ["auth", "status"], { allowFailure: true }).ok;
}

/** Pull requests for the repo, or null when gh or a GitHub remote is unavailable. Cached per process. */
export function listPullRequests(root: string): PullRequest[] | null {
  if (cache && cache.root === root) return cache.prs;
  let prs: PullRequest[] | null = null;
  if (ghAvailable()) {
    const r = run("gh", ["pr", "list", "--state", "all", "--limit", "200", "--json", "number,url,state,headRefName,title"], { cwd: root, allowFailure: true });
    if (r.ok) {
      try {
        const parsed: unknown = JSON.parse(r.stdout);
        if (Array.isArray(parsed)) prs = parsed as PullRequest[];
      } catch {
        prs = null;
      }
    }
  }
  cache = { root, prs };
  return prs;
}

export function resetPullRequestCache(): void {
  cache = null;
}

export function pullRequestForBranch(root: string, branch: string): PullRequest | null {
  const prs = listPullRequests(root);
  if (!prs) return null;
  const open = prs.find((p) => p.headRefName === branch && p.state === "OPEN");
  if (open) return open;
  const merged = prs.find((p) => p.headRefName === branch && p.state === "MERGED");
  return merged ?? prs.find((p) => p.headRefName === branch) ?? null;
}

/** Open a pull request with gh. Returns the URL or throws. */
export function createPullRequest(root: string, opts: { title: string; bodyFile: string; base: string; head: string; draft?: boolean }): string {
  const args = ["pr", "create", "--title", opts.title, "--body-file", opts.bodyFile, "--base", opts.base, "--head", opts.head];
  if (opts.draft) args.push("--draft");
  const r = run("gh", args, { cwd: root });
  return r.stdout.trim();
}

export function createIssue(root: string, title: string, body: string): string {
  const r = run("gh", ["issue", "create", "--title", title, "--body", body], { cwd: root });
  return r.stdout.trim();
}
