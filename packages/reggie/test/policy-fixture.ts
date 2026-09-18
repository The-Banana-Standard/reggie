import { appendFileSync, mkdirSync, realpathSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { recordCheck } from "../src/checks.js";
import { claimTask } from "../src/claim.js";
import { git } from "../src/git.js";
import { clearHistoryCache } from "../src/history.js";
import { onboard } from "../src/onboard.js";
import { scaffoldPacket } from "../src/packet.js";
import { evidenceDir, packetFile, packetRelPath, planFile, repoPaths, type RepoPaths } from "../src/paths.js";
import { currentPerson, loadConfig, loadPeople, type Person, type ReggieConfig } from "../src/people.js";
import { planCriteria, parsePlan, riskFromFiles } from "../src/plan.js";
import { readText, writeText } from "../src/util.js";
import { makeTempRepo, type TempRepo } from "./helpers.js";

/*
 * A throwaway repository in the state the policy judges: onboarded, a plan committed on the base, a
 * worktree claim, a code commit, saved evidence, a check recorded for every criterion through
 * `recordCheck`, and a filled packet, all committed on the task branch. Every test of the policy,
 * the gate on both doors and the captures starts from here and tampers with one thing; the browser
 * checks serve the same repositories.
 *
 * It refuses to build anywhere but under the OS temp directory: this code runs `git commit`, and a
 * test of the code that approves and merges work must not be able to reach a real checkout.
 */

export interface PolicyFixtureOptions {
  slug?: string;
  /** The plan's "Files to touch"; the code commit writes each of them. Default one low-risk file. */
  files?: string[];
  /** The plan's criteria, each the text after the checkbox; a multi-line string wraps onto indented lines. */
  criteria?: string[];
  /** Bullets for the packet's Discovered issues, written verbatim under the heading; default "- none". */
  discovered?: string;
  /** How far to build: `planned` stops before the claim, `claimed` after it, `built` after the code commit, `checked` after the records, `packet` (default) after the committed packet. */
  stage?: "planned" | "claimed" | "built" | "checked" | "packet";
  /** Extra files committed on the base before the plan, by repo-relative path. */
  baseFiles?: Record<string, string>;
  /** False claims in place and leaves the plan off the base: it is committed on the task branch only. */
  planOnBase?: boolean;
  /** Replaces the `policy:` block onboard wrote into the base's config: the keys given, or `null` for no block at all. */
  policy?: { plans?: string; completions?: string } | null;
  /** Replaces the base's `.reggie/config.yaml` whole. */
  configText?: string;
}

export interface PolicyFixture {
  repo: TempRepo;
  /** The integration checkout, on `main`. */
  root: string;
  /** The task's checkout: `.worktree/<slug>`, or `root` for an in-place claim. */
  worktree: string;
  paths: RepoPaths;
  wtPaths: RepoPaths;
  config: ReggieConfig;
  person: Person;
  slug: string;
  branch: string;
  /** Write a file in the task's checkout. */
  wt(file: string, content: string): void;
  /** Write a file in the integration checkout. */
  base(file: string, content: string): void;
  /** Commit everything in the task's checkout; returns the new tip. */
  commitWt(message: string): string;
  /** Commit everything in the integration checkout; returns the new tip. */
  commitBase(message: string): string;
  /** Record a passing check for every criterion, citing `tests.txt`. */
  checkAll(): void;
  /** Run `scaffoldPacket` in the task's checkout, fill every section, and return the packet's text. */
  writePacket(discovered?: string): string;
  cleanup(): void;
}

const DEFAULT_CRITERIA = ["AC1 The constant exported from the file equals two after the change", "AC2 A saved command output shows the new value printed by node"];

export function policyPlan(slug: string, files: string[], criteria: string[], risk: string): string {
  return [
    "---",
    `slug: ${slug}`,
    "title: Change the constant in one file",
    `risk: ${risk}`,
    "deciders: []",
    "author: test",
    "created: 2026-09-18",
    "---",
    "# Change the constant in one file",
    "",
    "## Problem",
    "The constant is one and it should be two, which the fixture owner noticed by reading the file.",
    "",
    "## Approach",
    "Edit the one line. Rejected: a config value, because nothing else reads it.",
    "",
    "## Files to touch",
    ...files.map((f) => `- ${f} (MOD)`),
    "",
    "## Acceptance criteria",
    ...criteria.map((c) => `- [ ] ${c.split("\n").join("\n  ")}`),
    "",
    "## Verification strategy",
    ...criteria.map((_, i) => `- Criterion ${i + 1}: run the command and save its output to evidence/tests.txt`),
    "",
    "## Assumptions",
    "- none",
    "",
    "## Out of scope",
    "- Every other file in the fixture",
    "",
    "## Bail conditions",
    "- If the constant is read by another module, stop and re-plan",
    "",
  ].join("\n");
}

/** The scaffold's stand-ins replaced by honest one-liners, so the packet passes its contract. */
export function fillPacket(content: string, discovered = "- none"): string {
  return content
    .replace(/^- \(none yet; put test output.*\)$/m, "- none")
    .replace(/^\(no commits ahead of .* yet\)$/m, "No commits ahead of the base yet.")
    .replace(/^- \(which review commands ran.*\)$/m, "- none ran: this is a fixture")
    .replace(/^- \(what was done differently from plan\.md.*\)$/m, "- none")
    .replace(/^- \(unrelated problems found on the way.*\)$/m, discovered)
    .replace(/^- \(what could still be wrong.*\)$/m, "- none known");
}

export function makePolicyFixture(opts: PolicyFixtureOptions = {}): PolicyFixture {
  const slug = opts.slug ?? "two-not-one";
  const files = opts.files ?? ["src/a.ts"];
  const criteria = opts.criteria ?? DEFAULT_CRITERIA;
  const stage = opts.stage ?? "packet";
  const planOnBase = opts.planOnBase !== false;

  const repo = makeTempRepo("reggie-policy-");
  const root = realpathSync(repo.root);
  const tmp = realpathSync(os.tmpdir());
  if (!root.startsWith(`${tmp}${path.sep}`)) throw new Error(`refusing to build a policy fixture in ${root}: not under the OS temp directory`);

  repo.write("src/a.ts", "export const a = 1;\n");
  repo.write("src/b.ts", "export const b = 2;\n");
  for (const [file, content] of Object.entries(opts.baseFiles ?? {})) repo.write(file, content);
  repo.commitAll("init: two files");
  onboard(root);
  appendFileSync(path.join(root, ".gitignore"), ".worktree/\n");
  const paths = repoPaths(root);
  if (opts.configText !== undefined) writeText(paths.config, opts.configText);
  if (opts.policy !== undefined) {
    // Onboard writes the block last, under its comment, so everything from that comment on is the block.
    const kept = (readText(paths.config) ?? "").split("\n# policy:")[0] ?? "";
    const keys = Object.entries(opts.policy ?? {}).map(([k, v]) => `  ${k}: ${v}\n`);
    writeText(paths.config, `${kept}${opts.policy === null ? "" : `\npolicy:\n${keys.join("")}`}`);
  }
  repo.commitAll("chore: onboard reggie");

  const config = loadConfig(paths);
  const plan = policyPlan(slug, files, criteria, riskFromFiles(files, config.risk));
  if (planOnBase) {
    writeText(planFile(paths, slug), plan);
    repo.commitAll(`plan: ${slug}`);
  }
  const person = currentPerson(root, loadPeople(paths));
  const claim = stage === "planned" ? null : claimTask(paths, config, slug, { worktree: planOnBase, person });
  const worktree = claim?.worktree ?? root;
  const wtPaths = repoPaths(worktree);

  const write = (dir: string) => (file: string, content: string) => {
    const full = path.join(dir, file);
    mkdirSync(path.dirname(full), { recursive: true });
    writeFileSync(full, content, "utf8");
  };
  const commit = (dir: string) => (message: string) => {
    git(["add", "-A"], { cwd: dir });
    git(["commit", "-q", "--allow-empty", "-m", message, "-m", `Task: ${slug}`], { cwd: dir });
    return git(["rev-parse", "HEAD"], { cwd: dir }).stdout.trim();
  };
  const fx: PolicyFixture = {
    repo,
    root,
    worktree,
    paths,
    wtPaths,
    config,
    person,
    slug,
    branch: `task/${slug}`,
    wt: write(worktree),
    base: write(root),
    commitWt: commit(worktree),
    commitBase: commit(root),
    checkAll: () => {
      const text = readText(planFile(wtPaths, slug)) ?? "";
      for (const c of planCriteria(parsePlan(text).sections.get("Acceptance criteria") ?? "")) {
        recordCheck(wtPaths, { slug, criterion: c.key, outcome: "pass", evidence: ["tests.txt"], person: person.handle, tool: "fixture", session: "fixture" });
      }
    },
    writePacket: (discovered) => {
      scaffoldPacket(wtPaths, config, { slug, author: person.handle });
      const filled = fillPacket(readText(packetFile(wtPaths, slug)) ?? "", discovered ?? opts.discovered);
      writeText(packetFile(wtPaths, slug), filled);
      return filled;
    },
    cleanup: () => {
      clearHistoryCache(root);
      repo.cleanup();
    },
  };

  if (!planOnBase) {
    fx.wt(path.relative(worktree, planFile(wtPaths, slug)), plan);
    fx.commitWt(`plan: ${slug}, on the task branch only`);
  }
  if (stage === "planned" || stage === "claimed") return fx;
  for (const f of files) fx.wt(f, `export const changed = ${JSON.stringify(f)};\n`);
  fx.commitWt("feat: two");
  if (stage === "built") return fx;
  fx.wt(path.relative(worktree, path.join(evidenceDir(wtPaths, slug), "tests.txt")), "2 passed, 0 failed\nexit 0\n");
  fx.checkAll();
  if (stage === "checked") return fx;
  fx.writePacket();
  fx.commitWt(`packet: ${slug}`);
  return fx;
}

/** `git rev-parse` of the two branches, the porcelain status of both checkouts and the verdicts: what a read-only call must leave as it was. */
export function policySnapshot(fx: PolicyFixture): Record<string, string> {
  const out = (cwd: string, args: string[]): string => git(args, { cwd, allowFailure: true }).stdout.trim();
  return {
    refs: out(fx.root, ["for-each-ref", "--format=%(refname) %(objectname)"]),
    baseStatus: out(fx.root, ["status", "--porcelain"]),
    worktreeStatus: fx.worktree === fx.root ? "" : out(fx.worktree, ["status", "--porcelain"]),
    index: out(fx.root, ["ls-files", "-s"]),
    verdictOnBranch: /^verdict: .*$/m.exec(out(fx.root, ["show", `${fx.branch}:${packetRelPath(fx.slug)}`]))?.[0] ?? "none",
    mergeHead: out(fx.root, ["rev-parse", "-q", "--verify", "MERGE_HEAD"]) || "none",
  };
}
