import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { listRepoFiles } from "./git.js";
import { TEST_HINTS } from "./roles.js";
import { nowIso, uniq } from "./util.js";

export interface LanguageCount {
  language: string;
  files: number;
}

export interface CommandHint {
  label: string;
  command: string;
}

export interface DirCount {
  dir: string;
  files: number;
}

export interface RepoFacts {
  name: string;
  description: string;
  totalFiles: number;
  languages: LanguageCount[];
  manifests: string[];
  commands: CommandHint[];
  topLevel: DirCount[];
  entryPoints: string[];
  tests: { count: number; dirs: string[] };
  ci: string[];
  docs: string[];
  generatedAt: string;
}

const LANGUAGE_BY_EXT: Record<string, string> = {
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
  html: "HTML",
  css: "CSS",
  scss: "CSS",
  md: "Markdown",
  mdx: "Markdown",
  yaml: "YAML",
  yml: "YAML",
  toml: "TOML",
  json: "JSON",
};

const IGNORED_SEGMENTS = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  "target",
  ".worktree",
  ".reggie",
  ".claude",
  ".codex",
  "DerivedData",
  "Pods",
  ".next",
  "coverage",
  "vendor",
  ".gradle",
  ".idea",
  ".vscode",
  "__pycache__",
  ".venv",
  "venv",
]);

const MANIFEST_FILES = [
  "package.json",
  "Cargo.toml",
  "go.mod",
  "Package.swift",
  "build.gradle",
  "build.gradle.kts",
  "settings.gradle",
  "settings.gradle.kts",
  "pyproject.toml",
  "requirements.txt",
  "Gemfile",
  "pom.xml",
  "Makefile",
  "Dockerfile",
  "docker-compose.yml",
  "firebase.json",
  "wrangler.toml",
  "wrangler.jsonc",
  "vercel.json",
  "netlify.toml",
  "src-tauri/tauri.conf.json",
];


export function isIgnoredPath(file: string): boolean {
  return file.split("/").some((seg) => IGNORED_SEGMENTS.has(seg));
}

function isIgnored(file: string): boolean {
  return isIgnoredPath(file);
}

function readJson(file: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(readFileSync(file, "utf8"));
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** The repo's display name: package.json name when present, else the directory name. */
export function detectName(root: string): string {
  const pkgFile = path.join(root, "package.json");
  if (existsSync(pkgFile)) {
    const pkg = readJson(pkgFile);
    if (typeof pkg?.name === "string" && pkg.name) return pkg.name;
  }
  return path.basename(root);
}

/** Collect deterministic facts about a repository. No network, no model calls. */
export function collectFacts(root: string): RepoFacts {
  const all = listRepoFiles(root).filter((f) => !isIgnored(f));
  const langCounts = new Map<string, number>();
  const topCounts = new Map<string, number>();
  let testCount = 0;
  const testDirs = new Set<string>();

  for (const file of all) {
    const ext = path.extname(file).slice(1).toLowerCase();
    const lang = LANGUAGE_BY_EXT[ext];
    if (lang) langCounts.set(lang, (langCounts.get(lang) ?? 0) + 1);
    const top = file.includes("/") ? `${file.split("/")[0] ?? ""}/` : "(root)";
    topCounts.set(top, (topCounts.get(top) ?? 0) + 1);
    if (TEST_HINTS.some((re) => re.test(file))) {
      testCount += 1;
      const dir = path.posix.dirname(file);
      testDirs.add(dir.split("/").slice(0, 2).join("/"));
    }
  }

  const manifests = MANIFEST_FILES.filter((m) => existsSync(path.join(root, m)));
  const pkg = manifests.includes("package.json") ? readJson(path.join(root, "package.json")) : null;

  const name = typeof pkg?.name === "string" && pkg.name ? pkg.name : path.basename(root);
  const description = typeof pkg?.description === "string" ? pkg.description : "";

  const commands: CommandHint[] = [];
  if (pkg && pkg.scripts && typeof pkg.scripts === "object") {
    const scripts = pkg.scripts as Record<string, unknown>;
    const preferred = ["dev", "start", "build", "test", "lint", "typecheck", "check", "preview", "tauri"];
    for (const key of preferred) {
      if (typeof scripts[key] === "string") commands.push({ label: key, command: `npm run ${key}` });
    }
  }
  if (manifests.includes("Cargo.toml")) commands.push({ label: "build", command: "cargo build" }, { label: "test", command: "cargo test" });
  if (manifests.includes("go.mod")) commands.push({ label: "build", command: "go build ./..." }, { label: "test", command: "go test ./..." });
  if (manifests.includes("Package.swift")) commands.push({ label: "build", command: "swift build" }, { label: "test", command: "swift test" });
  if (manifests.some((m) => m.startsWith("build.gradle"))) commands.push({ label: "build", command: "./gradlew build" }, { label: "test", command: "./gradlew test" });
  if (manifests.includes("pyproject.toml") || manifests.includes("requirements.txt")) commands.push({ label: "test", command: "pytest" });
  if (manifests.includes("Makefile")) commands.push({ label: "make", command: "make" });
  if (all.some((f) => /\.xcodeproj\//.test(f) || /\.xcworkspace\//.test(f))) {
    commands.push({ label: "ios", command: "xcodebuild (open the .xcodeproj or .xcworkspace)" });
  }

  const entryPoints: string[] = [];
  if (pkg) {
    if (typeof pkg.main === "string") entryPoints.push(pkg.main);
    if (typeof pkg.bin === "string") entryPoints.push(pkg.bin);
    if (pkg.bin && typeof pkg.bin === "object") entryPoints.push(...Object.values(pkg.bin as Record<string, unknown>).filter((v): v is string => typeof v === "string"));
  }
  const entryPatterns = [
    /^src\/(index|main|app|cli|server)\.[cm]?[jt]sx?$/,
    /^(index|main|app|cli|server)\.[cm]?[jt]sx?$/,
    /^app\/(layout|page)\.[jt]sx$/,
    /^src\/app\/(layout|page)\.[jt]sx$/,
    /^pages\/_app\.[jt]sx$/,
    /^src\/main\.rs$/,
    /^src-tauri\/src\/main\.rs$/,
    /^main\.go$/,
    /^cmd\/[^/]+\/main\.go$/,
    /App\.swift$/,
    /^Sources\/[^/]+\/main\.swift$/,
    /AndroidManifest\.xml$/,
    /^(manage|main|app)\.py$/,
    /^functions\/(index|src\/index)\.[jt]s$/,
  ];
  for (const file of all) {
    if (entryPatterns.some((re) => re.test(file))) entryPoints.push(file);
  }

  const ci = all.filter((f) => f.startsWith(".github/workflows/")).map((f) => path.posix.basename(f));
  const docs = all.filter((f) => /^(README|CONTRIBUTING|CHANGELOG|SECURITY|ARCHITECTURE|CLAUDE|AGENTS)\.md$/i.test(f) || (f.startsWith("docs/") && f.endsWith(".md")));

  const languages = Array.from(langCounts.entries())
    .map(([language, files]) => ({ language, files }))
    .sort((a, b) => b.files - a.files);
  const topLevel = Array.from(topCounts.entries())
    .map(([dir, files]) => ({ dir, files }))
    .sort((a, b) => b.files - a.files);

  return {
    name,
    description,
    totalFiles: all.length,
    languages,
    manifests,
    commands,
    topLevel,
    entryPoints: uniq(entryPoints).slice(0, 12),
    tests: { count: testCount, dirs: Array.from(testDirs).sort().slice(0, 8) },
    ci,
    docs: docs.slice(0, 12),
    generatedAt: nowIso(),
  };
}

/** Short one-paragraph description for prompts and notes. */
export function summarizeFacts(f: RepoFacts): string {
  const langs = f.languages.slice(0, 4).map((l) => `${l.language} (${l.files})`).join(", ") || "no recognized languages";
  const cmds = f.commands.slice(0, 4).map((c) => c.command).join(", ") || "none detected";
  return `${f.name}: ${f.totalFiles} files; ${langs}; manifests: ${f.manifests.join(", ") || "none"}; commands: ${cmds}; tests: ${f.tests.count} files.`;
}
