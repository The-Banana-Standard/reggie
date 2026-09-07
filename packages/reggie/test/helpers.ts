import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { git } from "../src/git.js";

export interface TempRepo {
  root: string;
  write(file: string, content: string): void;
  commitAll(message: string): void;
  cleanup(): void;
}

/** A throwaway git repo with a main branch and a configured user. */
export function makeTempRepo(prefix = "reggie-test-"): TempRepo {
  const root = mkdtempSync(path.join(os.tmpdir(), prefix));
  git(["init", "-q", "-b", "main"], { cwd: root });
  git(["config", "user.name", "Test Person"], { cwd: root });
  git(["config", "user.email", "test@example.com"], { cwd: root });
  git(["config", "commit.gpgsign", "false"], { cwd: root });
  const write = (file: string, content: string) => {
    const full = path.join(root, file);
    mkdirSync(path.dirname(full), { recursive: true });
    writeFileSync(full, content, "utf8");
  };
  const commitAll = (message: string) => {
    git(["add", "-A"], { cwd: root });
    git(["commit", "-q", "--allow-empty", "-m", message], { cwd: root });
  };
  write("README.md", "# fixture\n");
  commitAll("init");
  return {
    root,
    write,
    commitAll,
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
}

/** A plan that satisfies the contract. */
export function fullPlan(slug: string, files: string[] = ["src/auth/login.ts"]): string {
  return [
    "---",
    `slug: ${slug}`,
    `title: Cap login retries on web`,
    "risk: low",
    "deciders: []",
    "author: test",
    "created: 2026-09-06",
    "---",
    "# Cap login retries on web",
    "",
    "## Problem",
    "Web clients retry login forever when the server is down, which floods the auth endpoint.",
    "",
    "## Approach",
    "Add a retry counter in the client with a cap of three, then surface an error. Rejected: server-side rate limiting alone, because it does not fix the client loop.",
    "",
    "## Files to touch",
    ...files.map((f) => `- ${f} (MOD)`),
    "",
    "## Acceptance criteria",
    "- [ ] After three failed attempts the client stops retrying and shows the offline message",
    "- [ ] A unit test covers the cap and the message",
    "",
    "## Verification strategy",
    "- Run the auth unit tests and save the output to evidence/tests.txt",
    "- Manually simulate a server outage and screenshot the offline message to evidence/offline.png",
    "",
    "## Assumptions",
    "- Three attempts is the right cap; the alternative was five, rejected as too slow to fail",
    "",
    "## Out of scope",
    "- Server-side rate limiting",
    "",
    "## Bail conditions",
    "- If the retry loop lives in shared code used by mobile, stop and re-plan with the mobile owner",
    "",
  ].join("\n");
}
