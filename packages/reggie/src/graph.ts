import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { isIgnoredPath } from "./facts.js";
import { listRepoFiles } from "./git.js";
import { readNoteFile } from "./notes.js";
import { planFile, type RepoPaths } from "./paths.js";
import { parsePlan } from "./plan.js";
import { isSafeSlug, nowIso, readText } from "./util.js";

export type NodeKind = "file" | "task";

export interface GraphNode {
  id: string;
  kind: NodeKind;
  label: string;
  dir: string;
  lang: string;
  lines: number;
  noteCount: number;
  dirNoteCount: number;
  tasks: string[];
  inDegree: number;
  outDegree: number;
}

export interface GraphEdge {
  source: string;
  target: string;
  kind: "import" | "mod" | "touches";
}

export interface RepoGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
  dirs: string[];
  unresolved: number;
  generatedAt: string;
  languages: string[];
}

const CODE_EXT: Record<string, string> = {
  ts: "TypeScript",
  tsx: "TypeScript",
  mts: "TypeScript",
  cts: "TypeScript",
  js: "JavaScript",
  jsx: "JavaScript",
  mjs: "JavaScript",
  cjs: "JavaScript",
  rs: "Rust",
};

const JS_EXTS = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".d.ts"];
const MAX_NODES = 4000;

function extOf(file: string): string {
  return path.posix.extname(file).slice(1).toLowerCase();
}

/** Group by the first two path segments so a large repo clusters sensibly. */
export function dirKey(file: string): string {
  const parts = file.split("/");
  if (parts.length <= 1) return "(root)";
  return `${parts.slice(0, Math.min(2, parts.length - 1)).join("/")}/`;
}

function resolveJsImport(fromFile: string, spec: string, files: Set<string>): string | null {
  let target: string;
  if (spec.startsWith("./") || spec.startsWith("../")) {
    target = path.posix.normalize(path.posix.join(path.posix.dirname(fromFile), spec));
  } else if (spec.startsWith("@/")) {
    target = `src/${spec.slice(2)}`;
  } else if (spec.startsWith("~/")) {
    target = `src/${spec.slice(2)}`;
  } else {
    return null;
  }
  const candidates: string[] = [target];
  const stripped = target.replace(/\.(js|jsx|mjs|cjs)$/, "");
  if (stripped !== target) candidates.push(`${stripped}.ts`, `${stripped}.tsx`, `${stripped}.mts`);
  for (const ext of JS_EXTS) candidates.push(`${target}${ext}`);
  for (const ext of JS_EXTS) candidates.push(`${target}/index${ext}`);
  for (const c of candidates) if (files.has(c)) return c;
  return null;
}

function jsImports(content: string): string[] {
  const out: string[] = [];
  const patterns = [
    /(?:^|\n)\s*(?:import|export)\s+(?:type\s+)?(?:[^'";]*?\s+from\s+)?['"]([^'"\n]+)['"]/g,
    /import\(\s*['"]([^'"\n]+)['"]\s*\)/g,
    /require\(\s*['"]([^'"\n]+)['"]\s*\)/g,
  ];
  for (const re of patterns) {
    for (const m of content.matchAll(re)) if (m[1]) out.push(m[1]);
  }
  return out;
}

/** Nearest ancestor `src/` directory that sits beside a Cargo.toml, or the file's own dir. */
function crateRoot(file: string, files: Set<string>): string {
  const parts = file.split("/");
  for (let i = parts.length - 1; i >= 0; i -= 1) {
    if (parts[i] === "src") {
      const above = parts.slice(0, i).join("/");
      const cargo = above ? `${above}/Cargo.toml` : "Cargo.toml";
      if (files.has(cargo)) return parts.slice(0, i + 1).join("/");
    }
  }
  return path.posix.dirname(file);
}

function rustEdges(file: string, content: string, files: Set<string>): Array<{ target: string; kind: "mod" | "import" }> {
  const out: Array<{ target: string; kind: "mod" | "import" }> = [];
  const dir = path.posix.dirname(file);
  const base = path.posix.basename(file, ".rs");
  const ownDir = base === "mod" || base === "main" || base === "lib" ? dir : `${dir}/${base}`;
  for (const m of content.matchAll(/(?:^|\n)\s*(?:pub(?:\([^)]*\))?\s+)?mod\s+([A-Za-z_][A-Za-z0-9_]*)\s*;/g)) {
    const name = m[1] ?? "";
    for (const c of [`${ownDir}/${name}.rs`, `${ownDir}/${name}/mod.rs`, `${dir}/${name}.rs`, `${dir}/${name}/mod.rs`]) {
      if (files.has(c)) {
        out.push({ target: c, kind: "mod" });
        break;
      }
    }
  }
  const root = crateRoot(file, files);
  for (const m of content.matchAll(/(?:^|\n)\s*(?:pub(?:\([^)]*\))?\s+)?use\s+crate::([A-Za-z0-9_:]+)/g)) {
    const segs = (m[1] ?? "").split("::").filter(Boolean);
    for (let n = segs.length; n >= 1; n -= 1) {
      const rel = segs.slice(0, n).join("/");
      const hit = [`${root}/${rel}.rs`, `${root}/${rel}/mod.rs`].find((c) => files.has(c));
      if (hit) {
        if (hit !== file) out.push({ target: hit, kind: "import" });
        break;
      }
    }
  }
  return out;
}

function countLines(content: string): number {
  return content.length === 0 ? 0 : content.split("\n").length;
}

function noteCountFor(paths: RepoPaths, entity: string): number {
  const note = readNoteFile(paths, entity);
  return note ? note.entries.length : 0;
}

function taskTouches(paths: RepoPaths): Map<string, string[]> {
  const out = new Map<string, string[]>();
  if (!existsSync(paths.tasks)) return out;
  for (const slug of readdirSync(paths.tasks)) {
    if (!isSafeSlug(slug)) continue;
    const plan = readText(planFile(paths, slug));
    if (!plan) continue;
    out.set(slug, parsePlan(plan).files);
  }
  return out;
}

/**
 * The repo as a graph: code files as nodes, imports as edges, with notes and task plans overlaid.
 * TypeScript, JavaScript, and Rust are resolved; other languages appear as nodes without edges.
 */
export function buildGraph(paths: RepoPaths): RepoGraph {
  const root = paths.root;
  const all = listRepoFiles(root).filter((f) => !isIgnoredPath(f));
  const fileSet = new Set(all);
  const code = all.filter((f) => CODE_EXT[extOf(f)] !== undefined).slice(0, MAX_NODES);

  const nodes = new Map<string, GraphNode>();
  const edges: GraphEdge[] = [];
  const seenEdge = new Set<string>();
  let unresolved = 0;
  const dirNoteCache = new Map<string, number>();

  const dirNotes = (file: string): number => {
    const d = path.posix.dirname(file);
    if (d === ".") return 0;
    const key = `${d}/`;
    const cached = dirNoteCache.get(key);
    if (cached !== undefined) return cached;
    const n = noteCountFor(paths, key);
    dirNoteCache.set(key, n);
    return n;
  };

  for (const file of code) {
    let content = "";
    try {
      content = readFileSync(path.join(root, file), "utf8");
    } catch {
      continue;
    }
    nodes.set(file, {
      id: file,
      kind: "file",
      label: path.posix.basename(file),
      dir: dirKey(file),
      lang: CODE_EXT[extOf(file)] ?? "Other",
      lines: countLines(content),
      noteCount: noteCountFor(paths, file),
      dirNoteCount: dirNotes(file),
      tasks: [],
      inDegree: 0,
      outDegree: 0,
    });
    const add = (target: string, kind: GraphEdge["kind"]) => {
      if (target === file) return;
      const key = `${file}>${target}`;
      if (seenEdge.has(key)) return;
      seenEdge.add(key);
      edges.push({ source: file, target, kind });
    };
    const ext = extOf(file);
    if (ext === "rs") {
      for (const e of rustEdges(file, content, fileSet)) add(e.target, e.kind);
    } else {
      for (const spec of jsImports(content)) {
        const target = resolveJsImport(file, spec, fileSet);
        if (target) add(target, "import");
        else if (spec.startsWith(".")) unresolved += 1;
      }
    }
  }

  for (const [slug, files] of taskTouches(paths)) {
    const id = `task:${slug}`;
    nodes.set(id, {
      id,
      kind: "task",
      label: slug,
      dir: "(tasks)",
      lang: "task",
      lines: 0,
      noteCount: 0,
      dirNoteCount: 0,
      tasks: [],
      inDegree: 0,
      outDegree: 0,
    });
    for (const f of files) {
      const target = nodes.has(f) ? f : Array.from(nodes.keys()).find((k) => k.startsWith(`${f}/`)) ?? null;
      if (!target) continue;
      edges.push({ source: id, target, kind: "touches" });
      nodes.get(target)?.tasks.push(slug);
    }
  }

  const kept = edges.filter((e) => nodes.has(e.source) && nodes.has(e.target));
  for (const e of kept) {
    const s = nodes.get(e.source);
    const t = nodes.get(e.target);
    if (s) s.outDegree += 1;
    if (t) t.inDegree += 1;
  }

  const nodeList = Array.from(nodes.values());
  const dirs = Array.from(new Set(nodeList.map((n) => n.dir))).sort();
  const languages = Array.from(new Set(nodeList.map((n) => n.lang))).sort();
  return { nodes: nodeList, edges: kept, dirs, unresolved, generatedAt: nowIso(), languages };
}
