import path from "node:path";
import YAML from "yaml";
import { gitUser } from "./git.js";
import type { RepoPaths } from "./paths.js";
import { readText, slugify, writeText } from "./util.js";

export type Role = "maintainer" | "contributor";
export type Mode = "solo" | "team";

export interface Person {
  name: string;
  email: string;
  handle: string;
  role: Role;
}

export interface PeopleFile {
  people: Person[];
}

export interface RiskRules {
  high: string[];
  medium: string[];
}

/**
 * Where the repo's own backlog lives, when it keeps one outside `.reggie/`. Reggie finds
 * `TASKS.md`, `HISTORY.md` and a plan folder on its own; these keys only exist to point it
 * somewhere else, or to switch a source off with `false`.
 */
export interface LegacyConfig {
  tasks?: string | false;
  history?: string | false;
  plans?: string | false;
  enabled?: boolean;
}

/**
 * One directory whose dependencies a claimed worktree needs, and the command that installs them
 * there. A list because a monorepo gets one entry, and one link, per installed package.
 */
export interface InstallEntry {
  /** Relative to the repo root; `.` for a single-package repo. Never absolute, never above the root. */
  dir: string;
  /** Run as an argument vector, split on whitespace. Never through a shell. */
  command: string;
}

/** The highest risk class that passes without a person; `none` means nothing does. */
export type PolicyClass = "none" | "low" | "medium" | "high";
export const POLICY_CLASSES: readonly PolicyClass[] = ["none", "low", "medium", "high"];

/**
 * The `policy` block: one class per packet kind and nothing finer. `completions` is what the policy
 * report judges a finished task against. `plans` is parsed and printed and nothing reads it yet: with
 * the solo default every class of plan is admitted, which is what the board already does.
 */
export interface PolicyConfig {
  plans: PolicyClass;
  completions: PolicyClass;
}

/** Where a policy key's value came from: the file, the mode's default because the key was absent, or the default because the value could not be read. */
export type PolicyKeySource = "file" | "default" | "unreadable";

export interface ReggieConfig {
  mode: Mode;
  defaultBranch?: string;
  mcpServerName: string;
  risk: RiskRules;
  legacy?: LegacyConfig;
  /** Absent when the repo has not said how it installs; claim then leaves a worktree exactly as git made it. */
  install?: InstallEntry[];
  policy: PolicyConfig;
  policySource: Record<keyof PolicyConfig, PolicyKeySource>;
}

/** What a mode means when the file says nothing: solo admits every plan and low-risk completions, team admits nothing. */
export function defaultPolicy(mode: Mode): PolicyConfig {
  return mode === "team" ? { plans: "none", completions: "none" } : { plans: "high", completions: "low" };
}

export const DEFAULT_RISK: RiskRules = {
  high: ["auth", "login", "session", "password", "payment", "billing", "schema", "migration", "secret", "token", "security", "rules"],
  medium: ["shared", "common", "core", "lib", "util", "api", "model", "store"],
};

export function handleFor(name: string, email: string): string {
  const first = name.trim().split(/\s+/)[0] ?? "";
  const local = email.split("@")[0] ?? "";
  return slugify(first || local || "someone", 24);
}

export function loadPeople(paths: RepoPaths): PeopleFile {
  const raw = readText(paths.people);
  if (!raw) return { people: [] };
  const parsed: unknown = YAML.parse(raw);
  const people: Person[] = [];
  if (parsed && typeof parsed === "object" && Array.isArray((parsed as { people?: unknown }).people)) {
    for (const item of (parsed as { people: unknown[] }).people) {
      if (!item || typeof item !== "object") continue;
      const p = item as Partial<Person>;
      const name = typeof p.name === "string" ? p.name : "";
      const email = typeof p.email === "string" ? p.email : "";
      if (!name && !email) continue;
      people.push({
        name,
        email,
        handle: typeof p.handle === "string" && p.handle ? p.handle : handleFor(name, email),
        role: p.role === "contributor" ? "contributor" : "maintainer",
      });
    }
  }
  return { people };
}

export function savePeople(paths: RepoPaths, file: PeopleFile): void {
  const header = "# People who work in this repo. Identity is the git author email.\n# Roles: maintainer (may approve), contributor.\n";
  writeText(paths.people, header + YAML.stringify({ people: file.people }));
}

/** The person running Reggie right now, from git config, falling back to the OS user. */
export function currentPerson(root: string, people?: PeopleFile): Person {
  const { name, email } = gitUser(root);
  const known = people?.people.find((p) => (email && p.email === email) || (name && p.name === name));
  if (known) return known;
  const fallbackName = name || process.env.USER || process.env.USERNAME || "someone";
  return { name: fallbackName, email, handle: handleFor(fallbackName, email), role: "maintainer" };
}

/** Make sure the current git user is listed. First person in becomes maintainer. */
export function ensureCurrentPerson(paths: RepoPaths): { person: Person; added: boolean } {
  const file = loadPeople(paths);
  const me = currentPerson(paths.root, file);
  const exists = file.people.some((p) => p.email === me.email && p.name === me.name);
  if (exists) return { person: me, added: false };
  file.people.push(me);
  savePeople(paths, file);
  return { person: me, added: true };
}

export function inferMode(people: PeopleFile): Mode {
  return people.people.length > 1 ? "team" : "solo";
}

/**
 * Read the `install` list, dropping anything that could not be run safely: an entry with no
 * command, and any dir that is absolute or climbs out of the repo, because that dir becomes a
 * path Reggie writes a symlink into and runs a command in.
 */
function parseInstall(items: readonly unknown[]): InstallEntry[] {
  const entries: InstallEntry[] = [];
  for (const item of items) {
    if (!item || typeof item !== "object") continue;
    const e = item as Record<string, unknown>;
    const command = typeof e.command === "string" ? e.command.trim() : "";
    if (!command) continue;
    const dir = (typeof e.dir === "string" ? e.dir.trim() : "") || ".";
    if (path.isAbsolute(dir) || dir.split(/[\\/]/).includes("..")) continue;
    entries.push({ dir, command });
  }
  return entries;
}

export function loadConfig(paths: RepoPaths): ReggieConfig {
  return parseConfig(readText(paths.config));
}

/**
 * A config from its text, so that a copy read out of a commit is parsed by the same code as the file
 * on disk. Null or empty text is the defaults. Throws what the YAML parser throws for text that is
 * not YAML; every key it does not know is ignored.
 */
export function parseConfig(raw: string | null): ReggieConfig {
  const base: ReggieConfig = { mode: "solo", mcpServerName: "reggie", risk: { ...DEFAULT_RISK }, policy: defaultPolicy("solo"), policySource: { plans: "default", completions: "default" } };
  if (!raw) return base;
  const parsed: unknown = YAML.parse(raw);
  if (!parsed || typeof parsed !== "object") return base;
  const c = parsed as Record<string, unknown>;
  if (c.mode === "team" || c.mode === "solo") base.mode = c.mode;
  // The defaults follow the mode, so the mode is settled first. A value that is not one of the four
  // classes (`yes`, `3`, a list) takes the default and is reported, never guessed at.
  base.policy = defaultPolicy(base.mode);
  if (c.policy !== undefined && c.policy !== null) {
    const p = (typeof c.policy === "object" && !Array.isArray(c.policy) ? c.policy : {}) as Record<string, unknown>;
    const whole = typeof c.policy !== "object" || Array.isArray(c.policy);
    for (const key of ["plans", "completions"] as const) {
      const value = p[key];
      if (typeof value === "string" && (POLICY_CLASSES as readonly string[]).includes(value)) {
        base.policy[key] = value as PolicyClass;
        base.policySource[key] = "file";
      } else if (value !== undefined || whole) base.policySource[key] = "unreadable";
    }
  }
  if (typeof c.defaultBranch === "string" && c.defaultBranch) base.defaultBranch = c.defaultBranch;
  if (typeof c.mcpServerName === "string" && c.mcpServerName) base.mcpServerName = c.mcpServerName;
  if (c.risk && typeof c.risk === "object") {
    const r = c.risk as Record<string, unknown>;
    if (Array.isArray(r.high)) base.risk.high = r.high.filter((x): x is string => typeof x === "string");
    if (Array.isArray(r.medium)) base.risk.medium = r.medium.filter((x): x is string => typeof x === "string");
  }
  if (Array.isArray(c.install)) base.install = parseInstall(c.install);
  if (c.legacy === false) base.legacy = { enabled: false };
  else if (c.legacy && typeof c.legacy === "object") {
    const l = c.legacy as Record<string, unknown>;
    const legacy: LegacyConfig = {};
    for (const key of ["tasks", "history", "plans"] as const) {
      if (l[key] === false) legacy[key] = false;
      else if (typeof l[key] === "string" && l[key]) legacy[key] = l[key] as string;
    }
    if (l.enabled === false) legacy.enabled = false;
    base.legacy = legacy;
  }
  return base;
}

export function saveConfig(paths: RepoPaths, config: ReggieConfig): void {
  const header = [
    "# Reggie configuration.",
    "# mode: solo (approvals implicit, no PR required for plans) or team (deciders by risk, PR by default).",
    "# risk: path or keyword patterns that raise a task's risk class when its files match.",
    "",
  ].join("\n");
  const body: Record<string, unknown> = { mode: config.mode, mcpServerName: config.mcpServerName, risk: config.risk };
  if (config.defaultBranch) body.defaultBranch = config.defaultBranch;
  if (config.install && config.install.length > 0) body.install = config.install;
  writeText(paths.config, header + YAML.stringify(body) + POLICY_COMMENT + YAML.stringify({ policy: config.policy }));
}

/** Written above the `policy` block of every config Reggie creates. */
export const POLICY_COMMENT = [
  "# policy: the highest risk class that passes without a person, one class per kind of packet.",
  "#   plans: for a plan. completions: for a finished task. Values: none, low, medium, high.",
  "# Reggie reads this block from the integration branch's committed copy, never from a task branch,",
  "# so a task cannot widen the policy it is judged by. In this version the verdict is a report",
  "# (`reggie check <slug>`) and nothing acts on it: a person still decides every task.",
  "",
].join("\n");

export function ensureConfig(paths: RepoPaths, mode: Mode): { config: ReggieConfig; created: boolean } {
  const existing = readText(paths.config);
  if (existing) return { config: loadConfig(paths), created: false };
  const config: ReggieConfig = { mode, mcpServerName: "reggie", risk: { ...DEFAULT_RISK }, policy: defaultPolicy(mode), policySource: { plans: "file", completions: "file" } };
  saveConfig(paths, config);
  return { config, created: true };
}
