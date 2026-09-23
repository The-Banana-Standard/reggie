import type { Role } from "./roles.js";

export type CodeRole = "production" | "test" | "script" | "migration" | "generated";

export interface ReachabilityFile {
  file: string;
  role: Role;
}

export interface ReachabilitySymbol {
  id: string;
  file: string;
}

export interface ReachabilityCall {
  caller: string;
  callee: string | null;
}

export interface ReachabilityImport {
  source: string;
  target: string;
}

export interface RoleReachability {
  roots: string[];
  reachableFiles: string[];
  reachableSymbols: string[];
  notReachableFiles: string[];
  notReachableSymbols: string[];
}

export interface ReachabilityResult {
  byRole: Record<CodeRole, RoleReachability>;
  noReferences: {
    files: string[];
    symbols: string[];
  };
  limitations: string[];
  deletionClaim: null;
}

export interface ReachabilityInput {
  files: ReachabilityFile[];
  symbols: ReachabilitySymbol[];
  calls: ReachabilityCall[];
  imports: ReachabilityImport[];
  roots: Partial<Record<CodeRole, string[]>>;
}

const CODE_ROLES: readonly CodeRole[] = ["production", "test", "script", "migration", "generated"];

export function codeRoleOf(file: string, role: Role): CodeRole {
  const normalized = file.replace(/\\/g, "/").toLowerCase();
  if (role === "generated") return "generated";
  if (role === "test" || role === "fixture") return "test";
  if (/(^|\/)(?:migrations?|prisma\/migrations?|database\/migrations?)(\/|$)/.test(normalized)) return "migration";
  if (/(^|\/)(?:scripts?|bin|tools)(\/|$)/.test(normalized) || /(?:^|\/)(?:seed|migrate|migration)[._-]/.test(normalized)) return "script";
  return "production";
}

function unique(values: Iterable<string>): string[] {
  return [...new Set(values)].sort((a, b) => a.localeCompare(b));
}

function fileNode(file: string): string {
  return `file:${file}`;
}

function rootNode(root: string, files: ReadonlySet<string>, symbols: ReadonlySet<string>): string | null {
  if (symbols.has(root)) return root;
  if (root.startsWith("file:") && files.has(root.slice(5))) return root;
  if (files.has(root)) return fileNode(root);
  return null;
}

/**
 * Reachability and reference counts are intentionally different facts. The walk follows
 * only known imports and resolved calls; its limitations are carried with every result.
 */
export function analyzeReachability(input: ReachabilityInput): ReachabilityResult {
  const fileSet = new Set(input.files.map((item) => item.file));
  const symbolSet = new Set(input.symbols.map((item) => item.id));
  const symbolFile = new Map(input.symbols.map((item) => [item.id, item.file]));
  const edges = new Map<string, Set<string>>();
  const addEdge = (from: string, to: string): void => {
    const list = edges.get(from) ?? new Set<string>();
    list.add(to);
    edges.set(from, list);
  };

  for (const item of input.imports) {
    if (!fileSet.has(item.source) || !fileSet.has(item.target)) continue;
    addEdge(fileNode(item.source), fileNode(item.target));
  }
  for (const call of input.calls) {
    if (!call.callee || !symbolSet.has(call.callee)) continue;
    const caller = symbolSet.has(call.caller) ? call.caller : rootNode(call.caller, fileSet, symbolSet);
    if (caller) addEdge(caller, call.callee);
  }
  for (const symbol of input.symbols) addEdge(symbol.id, fileNode(symbol.file));

  const candidates = new Map<CodeRole, string[]>();
  for (const role of CODE_ROLES) candidates.set(role, []);
  for (const item of input.files) candidates.get(codeRoleOf(item.file, item.role))?.push(item.file);

  const byRole = {} as Record<CodeRole, RoleReachability>;
  const allRootNodes = new Set<string>();
  for (const role of CODE_ROLES) {
    const declaredRoots = unique(input.roots[role] ?? []);
    const queue: string[] = [];
    for (const root of declaredRoots) {
      const node = rootNode(root, fileSet, symbolSet);
      if (!node) continue;
      allRootNodes.add(node);
      queue.push(node);
    }
    const visited = new Set<string>();
    while (queue.length > 0) {
      const current = queue.shift();
      if (!current || visited.has(current)) continue;
      visited.add(current);
      for (const next of edges.get(current) ?? []) if (!visited.has(next)) queue.push(next);
    }
    const reachableSymbols = unique([...visited].filter((id) => symbolSet.has(id)));
    const reachableFiles = unique([
      ...[...visited].filter((id) => id.startsWith("file:")).map((id) => id.slice(5)),
      ...reachableSymbols.map((id) => symbolFile.get(id)).filter((file): file is string => Boolean(file)),
    ]);
    const roleFiles = unique(candidates.get(role) ?? []);
    const roleSymbols = unique(input.symbols.filter((item) => codeRoleOf(item.file, input.files.find((file) => file.file === item.file)?.role ?? "source") === role).map((item) => item.id));
    const reachableFileSet = new Set(reachableFiles);
    const reachableSymbolSet = new Set(reachableSymbols);
    byRole[role] = {
      roots: declaredRoots,
      reachableFiles,
      reachableSymbols,
      notReachableFiles: roleFiles.filter((file) => !reachableFileSet.has(file)),
      notReachableSymbols: roleSymbols.filter((id) => !reachableSymbolSet.has(id)),
    };
  }

  const referencedFiles = new Set<string>();
  for (const item of input.imports) referencedFiles.add(item.target);
  for (const call of input.calls) {
    if (!call.callee) continue;
    const file = symbolFile.get(call.callee);
    if (file) referencedFiles.add(file);
  }
  const referencedSymbols = new Set(input.calls.map((call) => call.callee).filter((id): id is string => id !== null));
  const rootSymbols = new Set([...allRootNodes].filter((id) => symbolSet.has(id)));
  const rootFiles = new Set([
    ...[...allRootNodes].filter((id) => id.startsWith("file:")).map((id) => id.slice(5)),
    ...[...rootSymbols].map((id) => symbolFile.get(id)).filter((file): file is string => Boolean(file)),
  ]);

  return {
    byRole,
    noReferences: {
      files: unique(input.files.map((item) => item.file).filter((file) => !referencedFiles.has(file) && !rootFiles.has(file))),
      symbols: unique(input.symbols.map((item) => item.id).filter((id) => !referencedSymbols.has(id) && !rootSymbols.has(id))),
    },
    limitations: [
      "The walk follows statically resolved imports and direct calls only; dynamic imports, reflection, framework registration, string-based dispatch, and unsupported languages can hide real paths.",
      "A not-reachable result means no path was found from the known roots for that role. It does not mean the code is unused.",
      "A no-references result means the analyzer found no incoming static import or resolved call. It does not mean removal is safe.",
    ],
    deletionClaim: null,
  };
}
