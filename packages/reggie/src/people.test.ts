import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { makeTempRepo, type TempRepo } from "../test/helpers.js";
import { run } from "./git.js";
import { repoPaths } from "./paths.js";
import { DEFAULT_RISK, defaultPolicy, ensureConfig, loadConfig, parseConfig, POLICY_COMMENT, saveConfig } from "./people.js";
import { readText, writeText } from "./util.js";

const CLI = path.resolve("src/cli.ts");
const TSX = path.resolve("node_modules/.bin/tsx");

const repos: TempRepo[] = [];
afterEach(() => {
  while (repos.length > 0) repos.pop()?.cleanup();
});

function repo(): TempRepo {
  const r = makeTempRepo("reggie-people-");
  repos.push(r);
  return r;
}

describe("the policy block in .reggie/config.yaml", () => {
  const rows: { name: string; text: string | null; policy: { plans: string; completions: string }; source: { plans: string; completions: string } }[] = [
    { name: "no config at all", text: null, policy: { plans: "high", completions: "low" }, source: { plans: "default", completions: "default" } },
    { name: "a solo config with no policy block", text: "mode: solo\n", policy: { plans: "high", completions: "low" }, source: { plans: "default", completions: "default" } },
    { name: "a team config with no policy block", text: "mode: team\n", policy: { plans: "none", completions: "none" }, source: { plans: "default", completions: "default" } },
    { name: "explicit values", text: "mode: solo\npolicy:\n  plans: medium\n  completions: none\n", policy: { plans: "medium", completions: "none" }, source: { plans: "file", completions: "file" } },
    { name: "explicit values in team mode", text: "mode: team\npolicy:\n  plans: low\n  completions: high\n", policy: { plans: "low", completions: "high" }, source: { plans: "file", completions: "file" } },
    { name: "one key given, one absent", text: "policy:\n  completions: medium\n", policy: { plans: "high", completions: "medium" }, source: { plans: "default", completions: "file" } },
    { name: "completions: yes", text: "policy:\n  plans: low\n  completions: yes\n", policy: { plans: "low", completions: "low" }, source: { plans: "file", completions: "unreadable" } },
    { name: "plans: 3", text: "policy:\n  plans: 3\n", policy: { plans: "high", completions: "low" }, source: { plans: "unreadable", completions: "default" } },
    { name: "a list where a class belongs", text: "policy:\n  completions:\n    - low\n    - medium\n", policy: { plans: "high", completions: "low" }, source: { plans: "default", completions: "unreadable" } },
    { name: "a wrong letter case", text: "policy:\n  completions: High\n", policy: { plans: "high", completions: "low" }, source: { plans: "default", completions: "unreadable" } },
    { name: "a policy that is not a block", text: "mode: team\npolicy: low\n", policy: { plans: "none", completions: "none" }, source: { plans: "unreadable", completions: "unreadable" } },
    { name: "an unreadable value in team mode falls to none, not to low", text: "mode: team\npolicy:\n  completions: true\n", policy: { plans: "none", completions: "none" }, source: { plans: "default", completions: "unreadable" } },
  ];
  it.each(rows)("reads $name", ({ text, policy, source }) => {
    const config = parseConfig(text);
    expect(config.policy).toEqual(policy);
    expect(config.policySource).toEqual(source);
  });

  it("keeps every other key as it was read before the block existed", () => {
    const config = parseConfig("mode: team\ndefaultBranch: trunk\nmcpServerName: r2\nrisk:\n  high: [vault]\n  medium: []\ninstall:\n  - dir: app\n    command: npm ci\nsomething-new: ignored\n");
    expect(config).toMatchObject({ mode: "team", defaultBranch: "trunk", mcpServerName: "r2", risk: { high: ["vault"], medium: [] }, install: [{ dir: "app", command: "npm ci" }] });
    // Text that is not YAML throws what the YAML parser throws, as loadConfig always has; the policy report catches it.
    expect(() => parseConfig("policy: [unclosed\n  x: : y\n")).toThrow();
    expect(parseConfig("just a sentence").mode).toBe("solo");
  });

  it("reads back what saveConfig wrote, comment included, and writes the block into every config Reggie creates", () => {
    const paths = repoPaths(repo().root);
    saveConfig(paths, { mode: "solo", mcpServerName: "reggie", risk: { ...DEFAULT_RISK }, policy: { plans: "medium", completions: "none" }, policySource: { plans: "file", completions: "file" } });
    const text = readText(paths.config) ?? "";
    expect(text).toContain(POLICY_COMMENT);
    expect(text).toMatch(/\npolicy:\n  plans: medium\n  completions: none\n$/);
    expect(POLICY_COMMENT).toMatch(/Values: none, low, medium, high/);
    expect(POLICY_COMMENT).toMatch(/from the integration branch's committed copy, never from a task branch/);
    expect(POLICY_COMMENT).toMatch(/In this version the verdict is a report/);
    const back = loadConfig(paths);
    expect(back.policy).toEqual({ plans: "medium", completions: "none" });
    expect(back.policySource).toEqual({ plans: "file", completions: "file" });

    const fresh = repoPaths(repo().root);
    expect(ensureConfig(fresh, "team").created).toBe(true);
    expect(loadConfig(fresh)).toMatchObject({ mode: "team", policy: defaultPolicy("team"), policySource: { plans: "file", completions: "file" } });
  });

  it("prints the policy, and whether each key came from the file or the default, in reggie people", () => {
    const r = repo();
    const paths = repoPaths(r.root);
    writeText(paths.config, "mode: solo\npolicy:\n  completions: medium\n  plans: sometimes\n");
    const out = run(TSX, [CLI, "--root", r.root, "people"], { cwd: r.root }).stdout;
    expect(out).toContain("mode: solo");
    expect(out).toContain("policy: plans high (the solo default; the value in .reggie/config.yaml could not be read), completions medium (from .reggie/config.yaml).");
    writeText(paths.config, "mode: team\n");
    expect(run(TSX, [CLI, "--root", r.root, "people"], { cwd: r.root }).stdout).toContain("policy: plans none (the team default), completions none (the team default).");
  });
});
