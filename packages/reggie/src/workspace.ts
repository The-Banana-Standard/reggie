import { existsSync, readdirSync, realpathSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { collectFacts, detectName, isIgnoredPath, type RepoFacts } from "./facts.js";
import { currentBranch, git, isRepo, listRepoFiles } from "./git.js";
import { readJournal, type JournalEntry } from "./journal.js";
import { allNoteFiles, staleEntriesFor, type NoteFile } from "./notes.js";
import { repoPaths, type RepoPaths } from "./paths.js";
import { loadConfig, type ReggieConfig } from "./people.js";
import { listTasks, TASK_STATES, type TaskInfo, type TaskState } from "./tasks.js";
import { readText } from "./util.js";

// ---------------------------------------------------------------------------
// Workspace discovery: the parent CLAUDE.md names the sibling repos.
// ---------------------------------------------------------------------------

export interface WorkspaceRepo {
  /** The `### <name>` heading in the workspace CLAUDE.md; also the route segment `#/repo/<name>`. */
  name: string;
  /** Absolute repo root. */
  path: string;
  /** The `**Path**` value as written (relative to the workspace dir). */
  rel: string;
  /** `**Purpose**` (or `**Description**`) when present. */
  description: string;
  /** `**Tech Stack**` when present. */
  techStack: string;
}

export interface SkippedRepo {
  name: string;
  path: string;
  reason: string;
}

export interface Workspace {
  /** First `# ` heading of the workspace CLAUDE.md, else the directory basename. */
  name: string;
  /** Absolute workspace directory. */
  root: string;
  /** Absolute path of the CLAUDE.md that was parsed. */
  file: string;
  /** Repos whose path exists and is inside a git work tree, in document order. */
  repos: WorkspaceRepo[];
  /** Listed repos that were dropped, with the reason, for CLI diagnostics. */
  skipped: SkippedRepo[];
}

export interface ParsedWorkspaceRepo {
  name: string;
  rel: string | null;
  description: string;
  techStack: string;
}

export interface ParsedWorkspaceDoc {
  name: string | null;
  /** True when a `## Repos` section exists (even if it lists nothing usable). */
  hasReposSection: boolean;
  repos: ParsedWorkspaceRepo[];
}

function stripInline(value: string): string {
  return value
    .trim()
    .replace(/^`(.*)`$/, "$1")
    .replace(/^"(.*)"$/, "$1")
    .replace(/^'(.*)'$/, "$1")
    .replace(/^\[([^\]]+)\]\([^)]*\)$/, "$1")
    .trim();
}

/**
 * Parse a workspace CLAUDE.md without touching the file system.
 * Name = first `# ` heading; repos = every `### <name>` block inside the `## Repos` section
 * with its `**Path**`, `**Purpose**` and `**Tech Stack**` lines. Fenced code blocks are ignored.
 */
export function parseWorkspaceDoc(content: string): ParsedWorkspaceDoc {
  const lines = content.replace(/\r\n/g, "\n").split("\n");
  let name: string | null = null;
  let hasReposSection = false;
  let inRepos = false;
  let inFence = false;
  let current: ParsedWorkspaceRepo | null = null;
  const repos: ParsedWorkspaceRepo[] = [];
  const fieldRe = /^\s*(?:[-*+]\s+)?\*\*([^*]+)\*\*\s*:\s*(.+?)\s*$/;

  for (const raw of lines) {
    const line = raw.replace(/\s+$/, "");
    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;

    const h1 = /^#\s+(.+)$/.exec(line);
    if (h1?.[1]) {
      if (name === null) name = stripInline(h1[1]);
      inRepos = false;
      current = null;
      continue;
    }
    const h2 = /^##\s+(.+)$/.exec(line);
    if (h2?.[1]) {
      inRepos = /^repos\b/i.test(stripInline(h2[1]));
      if (inRepos) hasReposSection = true;
      current = null;
      continue;
    }
    if (!inRepos) continue;

    const h3 = /^###\s+(.+)$/.exec(line);
    if (h3?.[1]) {
      current = { name: stripInline(h3[1]), rel: null, description: "", techStack: "" };
      repos.push(current);
      continue;
    }
    if (!current) continue;
    const field = fieldRe.exec(line);
    if (!field?.[1] || field[2] === undefined) continue;
    const key = field[1].trim().toLowerCase();
    const value = field[2];
    if (key === "path") current.rel = stripInline(value);
    else if (key === "purpose" || key === "description") current.description = value.trim();
    else if (key === "tech stack" || key === "stack") current.techStack = value.trim();
  }
  return { name, hasReposSection, repos };
}

function expandHome(p: string): string {
  if (p === "~") return os.homedir();
  if (p.startsWith("~/")) return path.join(os.homedir(), p.slice(2));
  return p;
}

function realOrSelf(p: string): string {
  try {
    return realpathSync(p);
  } catch {
    return path.resolve(p);
  }
}

function samePath(a: string, b: string): boolean {
  return realOrSelf(a) === realOrSelf(b);
}

/**
 * Read `<dir>/CLAUDE.md` and return the workspace it describes, or null when the file is missing
 * or has no `## Repos` section. Only listed paths that exist and sit inside a git work tree are kept;
 * the rest are reported in `skipped`.
 */
export function discoverWorkspace(dir: string): Workspace | null {
  const root = path.resolve(dir);
  const file = path.join(root, "CLAUDE.md");
  const content = readText(file);
  if (content === null) return null;
  const doc = parseWorkspaceDoc(content);
  if (!doc.hasReposSection) return null;

  const repos: WorkspaceRepo[] = [];
  const skipped: SkippedRepo[] = [];
  const seenNames = new Set<string>();
  const seenRoots = new Set<string>();
  for (const parsed of doc.repos) {
    const name = parsed.name;
    if (!name) continue;
    if (parsed.rel === null) {
      skipped.push({ name, path: "", reason: "no **Path** line" });
      continue;
    }
    const abs = path.resolve(root, expandHome(parsed.rel));
    if (!existsSync(abs) || !statSync(abs).isDirectory()) {
      skipped.push({ name, path: abs, reason: "path does not exist" });
      continue;
    }
    if (!isRepo(abs)) {
      skipped.push({ name, path: abs, reason: "not a git repository" });
      continue;
    }
    if (seenNames.has(name)) {
      skipped.push({ name, path: abs, reason: "duplicate repo name" });
      continue;
    }
    const real = realOrSelf(abs);
    if (seenRoots.has(real)) {
      skipped.push({ name, path: abs, reason: "same directory as an earlier repo" });
      continue;
    }
    seenNames.add(name);
    seenRoots.add(real);
    repos.push({ name, path: abs, rel: parsed.rel, description: parsed.description, techStack: parsed.techStack });
  }
  return { name: doc.name ?? path.basename(root), root, file, repos, skipped };
}

/**
 * Workspace auto-detection for `reggie serve`: when `<root>/../CLAUDE.md` describes a workspace
 * whose `## Repos` section names this repo (by heading or by path), return that workspace.
 */
export function autoDetectWorkspace(root: string): Workspace | null {
  const abs = path.resolve(root);
  const parent = path.dirname(abs);
  if (parent === abs) return null;
  const ws = discoverWorkspace(parent);
  if (!ws) return null;
  const base = path.basename(abs);
  const named = ws.repos.some((r) => r.name === base || samePath(r.path, abs));
  return named ? ws : null;
}

// ---------------------------------------------------------------------------
// Per-repo context with lazy caches keyed by HEAD sha (optionally bounded by a TTL).
// ---------------------------------------------------------------------------

export interface CacheOptions {
  /** Invalidate when HEAD moves (default true). */
  sha?: boolean;
  /** Also invalidate after this many milliseconds, for state that changes without a commit. */
  ttlMs?: number;
}

interface CacheSlot {
  sha: string | null;
  at: number;
  value: unknown;
}

export interface RepoCtxInit {
  name: string;
  root: string;
  description?: string;
  techStack?: string;
  /** How long a HEAD sha lookup is reused before `git rev-parse` runs again (default 1000 ms). */
  shaTtlMs?: number;
}

export class RepoCtx {
  readonly name: string;
  readonly root: string;
  readonly paths: RepoPaths;
  readonly config: ReggieConfig;
  /** Description from the workspace CLAUDE.md; empty in single-repo mode. */
  readonly description: string;
  readonly techStack: string;
  private readonly shaTtlMs: number;
  private sha: { at: number; value: string } | null = null;
  private readonly cache = new Map<string, CacheSlot>();

  constructor(init: RepoCtxInit) {
    this.name = init.name;
    this.root = path.resolve(init.root);
    this.paths = repoPaths(this.root);
    this.config = loadConfig(this.paths);
    this.description = init.description ?? "";
    this.techStack = init.techStack ?? "";
    this.shaTtlMs = init.shaTtlMs ?? 1000;
  }

  /** `git rev-parse HEAD`, reused for `shaTtlMs`. Empty string in a repo without commits. */
  headSha(): string {
    const now = Date.now();
    if (this.sha && now - this.sha.at < this.shaTtlMs) return this.sha.value;
    const value = git(["rev-parse", "HEAD"], { cwd: this.root, allowFailure: true }).stdout.trim();
    this.sha = { at: now, value };
    return value;
  }

  /** Build once per key; rebuild when HEAD moves (and, with `ttlMs`, when the value is older than that). */
  cached<T>(key: string, build: () => T, opts: CacheOptions = {}): T {
    const useSha = opts.sha ?? true;
    const sha = useSha ? this.headSha() : null;
    const now = Date.now();
    const slot = this.cache.get(key);
    if (slot && (!useSha || slot.sha === sha) && (opts.ttlMs === undefined || now - slot.at < opts.ttlMs)) {
      return slot.value as T;
    }
    const value = build();
    this.cache.set(key, { sha, at: now, value });
    return value;
  }

  /** Whether `key` already holds a value built for the current HEAD (ignores any TTL). */
  isCached(key: string): boolean {
    const slot = this.cache.get(key);
    if (!slot) return false;
    return slot.sha === null || slot.sha === this.headSha();
  }

  /** Drop one cached value, or every cached value plus the remembered HEAD sha. */
  invalidate(key?: string): void {
    if (key === undefined) {
      this.cache.clear();
      this.sha = null;
    } else {
      this.cache.delete(key);
    }
  }
}

export interface RegistryOptions {
  shaTtlMs?: number;
}

/** The repos a server instance serves: one in single-repo mode, the workspace's repos otherwise. */
export class RepoRegistry {
  readonly workspace: Workspace | null;
  private readonly byName = new Map<string, RepoCtx>();

  constructor(repos: RepoCtx[], workspace: Workspace | null = null) {
    this.workspace = workspace;
    for (const repo of repos) {
      if (this.byName.has(repo.name)) throw new Error(`Duplicate repo name in registry: ${repo.name}`);
      this.byName.set(repo.name, repo);
    }
  }

  static fromWorkspace(ws: Workspace, opts: RegistryOptions = {}): RepoRegistry {
    const repos = ws.repos.map((r) => {
      const init: RepoCtxInit = { name: r.name, root: r.path, description: r.description, techStack: r.techStack };
      if (opts.shaTtlMs !== undefined) init.shaTtlMs = opts.shaTtlMs;
      return new RepoCtx(init);
    });
    return new RepoRegistry(repos, ws);
  }

  /** Single-repo mode: the repo is named the way `collectFacts` names it (package.json name, else the directory). */
  static single(root: string, opts: RegistryOptions = {}): RepoRegistry {
    const init: RepoCtxInit = { name: detectName(root), root };
    if (opts.shaTtlMs !== undefined) init.shaTtlMs = opts.shaTtlMs;
    return new RepoRegistry([new RepoCtx(init)], null);
  }

  /** True when no workspace was discovered or given. */
  get single(): boolean {
    return this.workspace === null;
  }

  get repos(): RepoCtx[] {
    return Array.from(this.byName.values());
  }

  names(): string[] {
    return Array.from(this.byName.keys());
  }

  get(name: string): RepoCtx | undefined {
    return this.byName.get(name);
  }

  first(): RepoCtx {
    const first = this.byName.values().next();
    if (first.done) throw new Error("The registry holds no repos");
    return first.value;
  }

  /** The repo a `?repo=` query names, or the first repo when the query is absent; undefined when unknown. */
  resolve(name?: string | null): RepoCtx | undefined {
    if (name === undefined || name === null || name === "") return this.byName.size > 0 ? this.first() : undefined;
    return this.byName.get(name);
  }

  /** The `workspace` field of `/api/facts`. */
  info(): { name: string; repos: string[] } | null {
    if (!this.workspace) return null;
    return { name: this.workspace.name, repos: this.names() };
  }
}

// ---------------------------------------------------------------------------
// Code files, manifests and remotes: the raw material for the summary and the edges.
// ---------------------------------------------------------------------------

/** Programming-language extensions. Markup and data files (md, yaml, json, html, css, ...) are not code files. */
const CODE_LANGUAGES: Record<string, string> = {
  ts: "TypeScript",
  tsx: "TypeScript",
  mts: "TypeScript",
  cts: "TypeScript",
  js: "JavaScript",
  jsx: "JavaScript",
  mjs: "JavaScript",
  cjs: "JavaScript",
  rs: "Rust",
  go: "Go",
  swift: "Swift",
  kt: "Kotlin",
  kts: "Kotlin",
  java: "Java",
  py: "Python",
  rb: "Ruby",
  cs: "C#",
  c: "C",
  h: "C",
  cc: "C++",
  cpp: "C++",
  hpp: "C++",
  m: "Objective-C",
  mm: "Objective-C",
  sh: "Shell",
  bash: "Shell",
  zsh: "Shell",
  ps1: "PowerShell",
  sql: "SQL",
};

const TEST_HINTS = [/(^|\/)__tests__\//, /(^|\/)tests?\//, /\.test\.[cm]?[jt]sx?$/, /\.spec\.[cm]?[jt]sx?$/, /_test\.go$/, /Tests?\.swift$/, /Test\.kt$/, /test_.*\.py$/, /_test\.py$/];

export interface CodeFile {
  path: string;
  lang: string;
  test: boolean;
}

export interface CodeInventory {
  files: CodeFile[];
  /** Languages by file count, descending, ties alphabetical. */
  languages: { language: string; files: number }[];
}

/** Every tracked (or untracked, not ignored) code file in a repo, with its language and whether it is a test. */
export function codeInventory(root: string): CodeInventory {
  const files: CodeFile[] = [];
  const counts = new Map<string, number>();
  for (const file of listRepoFiles(root)) {
    if (isIgnoredPath(file)) continue;
    const ext = path.posix.extname(file).slice(1).toLowerCase();
    const lang = CODE_LANGUAGES[ext];
    if (!lang) continue;
    files.push({ path: file, lang, test: TEST_HINTS.some((re) => re.test(file)) });
    counts.set(lang, (counts.get(lang) ?? 0) + 1);
  }
  const languages = Array.from(counts.entries())
    .map(([language, n]) => ({ language, files: n }))
    .sort((a, b) => b.files - a.files || a.language.localeCompare(b.language));
  return { files, languages };
}

export interface CargoInfo {
  packageName: string | null;
  libName: string | null;
  dependencies: string[];
  members: string[];
}

/**
 * A small TOML reader for the parts of Cargo.toml that matter here: `[package] name`, `[lib] name`,
 * the keys of `[dependencies]` (honouring `package = "real-name"` renames and `[dependencies.x]` tables),
 * and `[workspace] members`.
 */
export function parseCargoToml(content: string): CargoInfo {
  const info: CargoInfo = { packageName: null, libName: null, dependencies: [], members: [] };
  let section = "";
  let membersBuffer: string | null = null;
  const deps = new Set<string>();
  const strip = (v: string) => v.trim().replace(/^"(.*)"$/, "$1").replace(/^'(.*)'$/, "$1");

  for (const raw of content.replace(/\r\n/g, "\n").split("\n")) {
    const line = raw.replace(/#.*$/, "").trim();
    if (!line) continue;
    if (membersBuffer !== null) {
      membersBuffer += ` ${line}`;
      if (line.includes("]")) {
        for (const m of membersBuffer.matchAll(/["']([^"']+)["']/g)) if (m[1]) info.members.push(m[1]);
        membersBuffer = null;
      }
      continue;
    }
    const header = /^\[\[?([^\]]+)\]\]?$/.exec(line);
    if (header?.[1]) {
      section = header[1].trim();
      const table = /^dependencies\.(.+)$/.exec(section);
      if (table?.[1]) {
        deps.add(strip(table[1]));
        section = `dependencies.${strip(table[1])}`;
      }
      continue;
    }
    const kv = /^([A-Za-z0-9_.-]+|"[^"]+")\s*=\s*(.*)$/.exec(line);
    if (!kv?.[1] || kv[2] === undefined) continue;
    const key = strip(kv[1]);
    const value = kv[2].trim();
    if (section === "package" && key === "name") info.packageName = strip(value);
    else if (section === "lib" && key === "name") info.libName = strip(value);
    else if (section === "workspace" && key === "members") {
      if (value.includes("]")) {
        for (const m of value.matchAll(/["']([^"']+)["']/g)) if (m[1]) info.members.push(m[1]);
      } else {
        membersBuffer = value;
      }
    } else if (section === "dependencies") {
      const rename = /package\s*=\s*"([^"]+)"/.exec(value);
      deps.add(rename?.[1] ?? key);
    } else if (section.startsWith("dependencies.") && key === "package") {
      deps.delete(section.slice("dependencies.".length));
      deps.add(strip(value));
    }
  }
  info.dependencies = Array.from(deps);
  return info;
}

function readJson(file: string): Record<string, unknown> | null {
  const text = readText(file);
  if (text === null) return null;
  try {
    const parsed: unknown = JSON.parse(text);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function keysOf(value: unknown): string[] {
  return value && typeof value === "object" && !Array.isArray(value) ? Object.keys(value as Record<string, unknown>) : [];
}

/** Expand `packages/*`-style workspace globs (one level) and literal member dirs into existing directories. */
function memberDirs(root: string, patterns: string[]): string[] {
  const out: string[] = [];
  for (const pattern of patterns) {
    const clean = pattern.replace(/\\/g, "/").replace(/\/+$/, "");
    if (clean.includes("..") || clean.startsWith("/")) continue;
    if (clean.endsWith("/*")) {
      const dir = path.join(root, clean.slice(0, -2));
      if (!existsSync(dir)) continue;
      for (const name of readdirSync(dir).sort()) {
        if (name.startsWith(".") || name === "node_modules") continue;
        const full = path.join(dir, name);
        if (statSync(full).isDirectory()) out.push(full);
      }
    } else if (!clean.includes("*")) {
      const full = path.join(root, clean);
      if (existsSync(full) && statSync(full).isDirectory()) out.push(full);
    }
  }
  return out;
}

export interface ManifestInfo {
  /** Package and crate names this repo publishes (root manifests plus one level of workspace members). */
  provides: string[];
  /** Dependency names this repo declares (package.json dependencies + devDependencies, Cargo.toml [dependencies]). */
  dependsOn: string[];
}

function manifestsIn(dir: string): { provides: string[]; dependsOn: string[]; members: string[] } {
  const provides: string[] = [];
  const dependsOn: string[] = [];
  const members: string[] = [];
  const pkg = readJson(path.join(dir, "package.json"));
  if (pkg) {
    if (typeof pkg.name === "string" && pkg.name) provides.push(pkg.name);
    dependsOn.push(...keysOf(pkg.dependencies), ...keysOf(pkg.devDependencies));
    if (Array.isArray(pkg.workspaces)) members.push(...pkg.workspaces.filter((w): w is string => typeof w === "string"));
    else if (pkg.workspaces && typeof pkg.workspaces === "object") {
      const packages = (pkg.workspaces as Record<string, unknown>).packages;
      if (Array.isArray(packages)) members.push(...packages.filter((w): w is string => typeof w === "string"));
    }
  }
  const cargoText = readText(path.join(dir, "Cargo.toml"));
  if (cargoText !== null) {
    const cargo = parseCargoToml(cargoText);
    if (cargo.packageName) provides.push(cargo.packageName);
    if (cargo.libName) provides.push(cargo.libName);
    dependsOn.push(...cargo.dependencies);
    members.push(...cargo.members);
  }
  return { provides, dependsOn, members };
}

/** Names a repo provides and depends on, from its root manifests and their direct workspace members. */
export function manifestInfo(root: string): ManifestInfo {
  const top = manifestsIn(root);
  const provides = new Set(top.provides);
  const dependsOn = new Set(top.dependsOn);
  for (const dir of memberDirs(root, top.members)) {
    if (samePath(dir, root)) continue;
    const member = manifestsIn(dir);
    for (const n of member.provides) provides.add(n);
    for (const n of member.dependsOn) dependsOn.add(n);
  }
  return { provides: Array.from(provides), dependsOn: Array.from(dependsOn) };
}

export interface RemoteOrigin {
  host: string;
  org: string;
  repo: string;
}

/** Parse `git@github.com:org/repo.git`, `ssh://git@host/org/repo.git` and `https://host/org/repo(.git)`. */
export function parseRemoteUrl(url: string): RemoteOrigin | null {
  const trimmed = url.trim();
  if (!trimmed) return null;
  let host: string;
  let rest: string;
  const scheme = /^[a-z][a-z0-9+.-]*:\/\/(?:[^@/]+@)?([^/:]+)(?::\d+)?\/(.+)$/i.exec(trimmed);
  const scp = /^(?:[^@/]+@)?([^/:]+):(.+)$/.exec(trimmed);
  if (scheme?.[1] && scheme[2]) {
    host = scheme[1];
    rest = scheme[2];
  } else if (scp?.[1] && scp[2] && !/^[a-z]:[\\/]/i.test(trimmed)) {
    host = scp[1];
    rest = scp[2];
  } else {
    return null;
  }
  const parts = rest.replace(/\/+$/, "").split("/").filter(Boolean);
  if (parts.length < 2) return null;
  const repo = (parts[parts.length - 1] ?? "").replace(/\.git$/, "");
  const org = parts[parts.length - 2] ?? "";
  if (!org || !repo) return null;
  return { host: host.toLowerCase(), org, repo };
}

/** The org behind `git remote get-url origin`, or null without a parsable origin. */
export function remoteOrigin(root: string): RemoteOrigin | null {
  const r = git(["remote", "get-url", "origin"], { cwd: root, allowFailure: true });
  return r.ok ? parseRemoteUrl(r.stdout) : null;
}

// ---------------------------------------------------------------------------
// The /api/workspace payload.
// ---------------------------------------------------------------------------

export interface KnowledgeCoverage {
  /** Non-test code files. */
  source: number;
  /** Source files with a note of their own. */
  noted: number;
  /** Source files without their own note that inherit one from an ancestor folder note or the repo note. */
  inherited: number;
  /** Note entries whose file or folder changed in git after the entry was written. */
  stale: number;
}

export interface NeedsYouItem {
  slug: string;
  title: string;
  owner: string | null;
  age: number | null;
}

export interface WorkspaceRepoSummary {
  name: string;
  path: string;
  description: string;
  primaryLanguage: string;
  codeFiles: number;
  branch: string;
  taskCounts: Record<TaskState, number>;
  knowledge: KnowledgeCoverage;
  lastJournal: JournalEntry | null;
  entryPoints: string[];
  needsYou: NeedsYouItem[];
}

export type WorkspaceEdgeKind = "depends-on" | "same-org" | "shares-service";

export interface WorkspaceEdge {
  source: string;
  target: string;
  kind: WorkspaceEdgeKind;
  /** The package or crate name for depends-on; the org for same-org. */
  via: string;
}

export interface WorkspaceSummary {
  name: string;
  root: string;
  single: boolean;
  repos: WorkspaceRepoSummary[];
  edges: WorkspaceEdge[];
}

const DAY_MS = 24 * 60 * 60 * 1000;

function daysSince(iso: string | null | undefined, now: number): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  return Math.max(0, Math.floor((now - t) / DAY_MS));
}

/** Days since a task's last activity, falling back to the date in its intake metadata. */
export function taskAge(task: TaskInfo, now: number = Date.now()): number | null {
  const fromActivity = daysSince(task.lastActivity, now);
  if (fromActivity !== null) return fromActivity;
  const meta = task.intake?.meta ?? "";
  const date = /\d{4}-\d{2}-\d{2}/.exec(meta)?.[0];
  return daysSince(date, now);
}

export interface CoverageOptions {
  /**
   * Count the repo note (`notes/_repo.md`) as inherited coverage for every source file. Off by default:
   * onboarding writes a placeholder repo note, which would mark every onboarded repo as fully documented.
   */
  repoNoteInherits?: boolean;
}

/** Coverage of source files by notes: own, inherited (an ancestor folder note; optionally the repo note), and stale entries. */
export function knowledgeCoverage(paths: RepoPaths, files: CodeFile[], notes: NoteFile[], opts: CoverageOptions = {}): KnowledgeCoverage {
  const own = new Set<string>();
  const dirs = new Set<string>();
  let repoNoted = false;
  for (const note of notes) {
    if (note.entries.length === 0) continue;
    if (note.kind === "file") own.add(note.entity.replace(/^\.\//, ""));
    else if (note.kind === "dir") dirs.add(note.entity.replace(/^\.\//, "").replace(/\/+$/, ""));
    else if (note.kind === "repo" && opts.repoNoteInherits) repoNoted = true;
  }
  let source = 0;
  let noted = 0;
  let inherited = 0;
  for (const file of files) {
    if (file.test) continue;
    source += 1;
    if (own.has(file.path)) {
      noted += 1;
      continue;
    }
    if (repoNoted) {
      inherited += 1;
      continue;
    }
    const segments = file.path.split("/");
    for (let i = 1; i < segments.length; i += 1) {
      if (dirs.has(segments.slice(0, i).join("/"))) {
        inherited += 1;
        break;
      }
    }
  }
  const stale = staleEntriesFor(paths, notes).length;
  return { source, noted, inherited, stale };
}

function emptyTaskCounts(): Record<TaskState, number> {
  const counts = {} as Record<TaskState, number>;
  for (const state of TASK_STATES) counts[state] = 0;
  return counts;
}

/** Summarize one repo. Facts and the code inventory are cached by HEAD sha; tasks, notes and journal also expire after 10 s. */
export function repoSummary(ctx: RepoCtx, now: number = Date.now()): WorkspaceRepoSummary {
  const facts = ctx.cached<RepoFacts>("facts", () => collectFacts(ctx.root));
  const code = ctx.cached<CodeInventory>("code-inventory", () => codeInventory(ctx.root));
  const tasks = ctx.cached<TaskInfo[]>("tasks", () => listTasks(ctx.paths, ctx.config, { includeDone: true }), { ttlMs: 10_000 });
  const knowledge = ctx.cached<KnowledgeCoverage>("knowledge", () => knowledgeCoverage(ctx.paths, code.files, allNoteFiles(ctx.paths)), { ttlMs: 10_000 });
  const lastJournal = ctx.cached<JournalEntry | null>("last-journal", () => readJournal(ctx.paths, { days: 36_500, limit: 1 })[0] ?? null, { ttlMs: 10_000 });
  const branch = ctx.cached<string>("branch", () => currentBranch(ctx.root), { ttlMs: 10_000 });

  const taskCounts = emptyTaskCounts();
  for (const t of tasks) taskCounts[t.state] += 1;
  const needsYou = tasks
    .filter((t) => t.state === "awaiting-decision")
    .map((t) => ({ slug: t.slug, title: t.title, owner: t.owner, age: taskAge(t, now) }));

  return {
    name: ctx.name,
    path: ctx.root,
    description: ctx.description || facts.description,
    primaryLanguage: code.languages[0]?.language ?? "",
    codeFiles: code.files.length,
    branch,
    taskCounts,
    knowledge,
    lastJournal,
    entryPoints: facts.entryPoints,
    needsYou,
  };
}

/**
 * Cross-repo edges: `depends-on` when a repo declares a dependency whose name a sibling provides
 * (`via` = the package or crate names, comma-joined), `same-org` when two repos' origin remotes share
 * a host and org (`via` = the org). `shares-service` is not produced yet.
 */
export function workspaceEdges(registry: RepoRegistry): WorkspaceEdge[] {
  const repos = registry.repos.map((ctx) => ({
    ctx,
    manifest: ctx.cached<ManifestInfo>("manifest-info", () => manifestInfo(ctx.root)),
    origin: ctx.cached<RemoteOrigin | null>("remote-origin", () => remoteOrigin(ctx.root), { ttlMs: 10_000 }),
  }));
  const edges: WorkspaceEdge[] = [];
  for (const a of repos) {
    for (const b of repos) {
      if (a === b) continue;
      const provided = new Set(b.manifest.provides);
      const via = a.manifest.dependsOn.filter((dep) => provided.has(dep)).sort();
      if (via.length > 0) edges.push({ source: a.ctx.name, target: b.ctx.name, kind: "depends-on", via: via.join(", ") });
    }
  }
  for (let i = 0; i < repos.length; i += 1) {
    const a = repos[i];
    if (!a?.origin) continue;
    for (let j = i + 1; j < repos.length; j += 1) {
      const b = repos[j];
      if (!b?.origin) continue;
      if (a.origin.host === b.origin.host && a.origin.org.toLowerCase() === b.origin.org.toLowerCase()) {
        edges.push({ source: a.ctx.name, target: b.ctx.name, kind: "same-org", via: a.origin.org });
      }
    }
  }
  return edges;
}

/** The `/api/workspace` payload. Single-repo mode yields `single: true`, one repo and no edges. */
export function workspaceSummary(registry: RepoRegistry, now: number = Date.now()): WorkspaceSummary {
  const repos = registry.repos.map((ctx) => repoSummary(ctx, now));
  const first = registry.repos[0];
  return {
    name: registry.workspace?.name ?? first?.name ?? "",
    root: registry.workspace?.root ?? first?.root ?? "",
    single: registry.single,
    repos,
    edges: registry.single ? [] : workspaceEdges(registry),
  };
}
