/**
 * Symbols (ui-spec §6.5): what a file declares, and who uses each declaration.
 *
 * TypeScript compiler extraction for JavaScript/TypeScript and the established
 * masked scanner for Rust. The compiler-backed side shares identities and spans
 * with the repository semantic index; the Rust side stays behind this legacy facade.
 *
 * `maskCode()` and the line scanner below now serve Rust plus legacy import/service
 * helpers only. JavaScript-family declaration and call discovery never falls back to
 * regular expressions. `usedBy` remains graph-backed for this compatibility facade.
 *
 * Pure apart from the content-hash cache; no I/O.
 */

import { createHash } from "node:crypto";
import type { RepoGraph } from "./graph.js";
import { analyzeSemanticSource, semanticDeclarations } from "./semantic-index.js";

/** Contract `Symbol.kind` (ui-api-contract.md, GET /api/file). */
export type SymbolKind =
  | "function"
  | "class"
  | "constructor"
  | "method"
  | "arrow"
  | "const"
  | "let"
  | "var"
  | "type"
  | "interface"
  | "enum"
  | "struct"
  | "trait"
  | "mod"
  | "static"
  | "reexport"
  | "default";

export type Confidence = "exact" | "heuristic";

export type SymbolEngine = "regex" | "typescript" | "tree-sitter";

/** The extractor behind `extractSymbols` (reported by GET /api/symbols as `engine`). */
export const SYMBOL_ENGINE: SymbolEngine = "typescript";

export interface SymbolUse {
  file: string;
  line?: number;
}

/** Contract `Symbol`. Named `CodeSymbol` here so it never shadows the global `Symbol`. */
export interface CodeSymbol {
  /** Stable repository identity shared by flows, routes, pages, and knowledge. */
  id?: string;
  name: string;
  qualifiedName?: string;
  parentSymbolId?: string | null;
  kind: SymbolKind;
  /** 1-based line of the declaration. */
  line: number;
  /** 1-based last line of the declaration span (inclusive). */
  endLine: number;
  exported: boolean;
  /** Rust only: the `fn` is preceded by `#[tauri::command]`. */
  tauriCommand?: boolean;
  /**
   * Additive to the contract: this symbol is the file's `export default`. Its importers
   * carry the name `default` on their edge, which `withUsedBy` matches as well.
   */
  isDefault?: boolean;
  usedBy: SymbolUse[];
  confidence: Confidence;
}

export interface NamedImports {
  /** Local binding names: `{ a, b as c }` → `['a','c']`; default → `'default'`; namespace → `'*'`. */
  names: string[];
  /** `import type …`, or every specifier carries an inline `type`. */
  isType: boolean;
}

/** ⧗ A call site inside a symbol's span, resolved by name (heuristic). */
export interface CallRef {
  id?: string;
  name: string;
  line: number;
  /** Stable symbol id where exact, or null when unresolved/dynamic/external. */
  target: string | null;
  confidence: Confidence;
}

/** The edge fields `usedBy` reads. `RepoGraph` satisfies this once graph.ts carries `names`. */
export interface NamedEdge {
  source: string;
  target: string;
  kind: string;
  names?: readonly string[] | undefined;
}

export interface SymbolGraph {
  edges: ReadonlyArray<NamedEdge>;
}

// ---------------------------------------------------------------------------
// Language detection
// ---------------------------------------------------------------------------

export type SymbolLang = "js" | "rust";

const JS_EXTS = new Set(["ts", "tsx", "mts", "cts", "js", "jsx", "mjs", "cjs"]);

/** `js` for TypeScript/JavaScript, `rust` for `.rs`, null for everything else. */
export function symbolLang(file: string): SymbolLang | null {
  const m = /\.([A-Za-z0-9]+)$/.exec(file);
  const ext = (m?.[1] ?? "").toLowerCase();
  if (ext === "rs") return "rust";
  return JS_EXTS.has(ext) ? "js" : null;
}

// ---------------------------------------------------------------------------
// Masking: strings and comments become spaces, newlines stay
// ---------------------------------------------------------------------------

const REGEX_PREFIX_CHARS = new Set("(,=:[!&|?{};+-*%<>~^".split(""));
const REGEX_PREFIX_WORDS = new Set([
  "return",
  "typeof",
  "case",
  "do",
  "else",
  "in",
  "of",
  "new",
  "delete",
  "void",
  "throw",
  "yield",
  "await",
  "instanceof",
]);

function isIdentChar(ch: string): boolean {
  return /[\w$]/.test(ch);
}

/**
 * Blank every string literal and comment in `src`, keeping length and newlines, so
 * regexes and brace counts see only code. JS: `//`, `/* *\/`, `'…'`, `"…"`, template
 * literals (with `${…}` kept as code), regex literals. Rust: `//`, nested `/* *\/`,
 * `"…"` (multi-line), raw `r#"…"#`, byte strings, char literals (lifetimes untouched).
 */
export function maskCode(src: string, lang: SymbolLang): string {
  const n = src.length;
  const out = src.split("");
  const at = (k: number): string => src.charAt(k);
  const blank = (from: number, to: number): void => {
    for (let k = from; k < to && k < n; k += 1) if (out[k] !== "\n") out[k] = " ";
  };
  const lineEnd = (k: number): number => {
    const e = src.indexOf("\n", k);
    return e === -1 ? n : e;
  };

  // --- JS helpers ---
  const quotedEnd = (i: number, q: string): number => {
    let j = i + 1;
    while (j < n) {
      const ch = at(j);
      if (ch === "\\") {
        j += 2;
        continue;
      }
      if (ch === "\n") return -1;
      if (ch === q) return j + 1;
      j += 1;
    }
    return -1;
  };
  const regexContext = (i: number): boolean => {
    let k = i - 1;
    while (k >= 0 && /\s/.test(out[k] ?? "")) k -= 1;
    if (k < 0) return true;
    const p = out[k] ?? "";
    if (REGEX_PREFIX_CHARS.has(p)) return true;
    if (!isIdentChar(p)) return false;
    let w = k;
    while (w >= 0 && isIdentChar(out[w] ?? "")) w -= 1;
    return REGEX_PREFIX_WORDS.has(out.slice(w + 1, k + 1).join(""));
  };
  const regexEnd = (i: number): number => {
    if (!regexContext(i)) return -1;
    let j = i + 1;
    let inClass = false;
    while (j < n) {
      const ch = at(j);
      if (ch === "\\") {
        j += 2;
        continue;
      }
      if (ch === "\n") return -1;
      if (ch === "[") inClass = true;
      else if (ch === "]") inClass = false;
      else if (ch === "/" && !inClass) {
        j += 1;
        while (/[a-z]/i.test(at(j))) j += 1;
        return j;
      }
      j += 1;
    }
    return -1;
  };

  let scanTemplate: (i: number) => number = () => n;

  /** Scan JS code from `start`; with `stopAtBrace`, return the index of the `}` closing a `${`. */
  const scanJs = (start: number, stopAtBrace: boolean): number => {
    let i = start;
    let depth = 0;
    while (i < n) {
      const c = at(i);
      const d = at(i + 1);
      if (c === "/" && d === "/") {
        const stop = lineEnd(i);
        blank(i, stop);
        i = stop;
        continue;
      }
      if (c === "/" && d === "*") {
        const end = src.indexOf("*/", i + 2);
        const stop = end === -1 ? n : end + 2;
        blank(i, stop);
        i = stop;
        continue;
      }
      if (c === '"' || c === "'") {
        const stop = quotedEnd(i, c);
        if (stop === -1) {
          // Unterminated on this line: JSX text ("don't") or a typo. Not a string.
          i += 1;
          continue;
        }
        blank(i, stop);
        i = stop;
        continue;
      }
      if (c === "`") {
        i = scanTemplate(i);
        continue;
      }
      if (c === "/") {
        const stop = regexEnd(i);
        if (stop !== -1) {
          blank(i, stop);
          i = stop;
          continue;
        }
        i += 1;
        continue;
      }
      if (stopAtBrace) {
        if (c === "{") depth += 1;
        else if (c === "}") {
          if (depth === 0) return i;
          depth -= 1;
        }
      }
      i += 1;
    }
    return n;
  };

  scanTemplate = (i: number): number => {
    blank(i, i + 1);
    let j = i + 1;
    while (j < n) {
      const ch = at(j);
      if (ch === "\\") {
        blank(j, j + 2);
        j += 2;
        continue;
      }
      if (ch === "`") {
        blank(j, j + 1);
        return j + 1;
      }
      if (ch === "$" && at(j + 1) === "{") {
        blank(j, j + 2);
        const close = scanJs(j + 2, true);
        if (close >= n) return n;
        blank(close, close + 1);
        j = close + 1;
        continue;
      }
      blank(j, j + 1);
      j += 1;
    }
    return n;
  };

  // --- Rust ---
  const scanRust = (): void => {
    let i = 0;
    while (i < n) {
      const c = at(i);
      const d = at(i + 1);
      if (c === "/" && d === "/") {
        const stop = lineEnd(i);
        blank(i, stop);
        i = stop;
        continue;
      }
      if (c === "/" && d === "*") {
        let depth = 1;
        let j = i + 2;
        while (j < n && depth > 0) {
          if (at(j) === "/" && at(j + 1) === "*") {
            depth += 1;
            j += 2;
          } else if (at(j) === "*" && at(j + 1) === "/") {
            depth -= 1;
            j += 2;
          } else j += 1;
        }
        blank(i, j);
        i = j;
        continue;
      }
      // Raw strings: r"…", r#"…"#, br"…" — only when `r` starts a token.
      if ((c === "r" || (c === "b" && d === "r")) && (i === 0 || !isIdentChar(at(i - 1)))) {
        let k = i + (c === "b" ? 2 : 1);
        let hashes = 0;
        while (at(k) === "#") {
          hashes += 1;
          k += 1;
        }
        if (at(k) === '"') {
          const closer = `"${"#".repeat(hashes)}`;
          const end = src.indexOf(closer, k + 1);
          const stop = end === -1 ? n : end + closer.length;
          blank(i, stop);
          i = stop;
          continue;
        }
      }
      if (c === '"') {
        let j = i + 1;
        while (j < n && at(j) !== '"') j += at(j) === "\\" ? 2 : 1;
        const stop = Math.min(n, j + 1);
        blank(i, stop);
        i = stop;
        continue;
      }
      if (c === "'") {
        if (d === "\\") {
          let j = i + 2;
          while (j < n && j < i + 12 && at(j) !== "'") j += 1;
          const stop = Math.min(n, j + 1);
          blank(i, stop);
          i = stop;
          continue;
        }
        if (d !== "" && d !== "\n" && at(i + 2) === "'") {
          blank(i, i + 3);
          i += 3;
          continue;
        }
        // A lifetime ('a): leave it.
      }
      i += 1;
    }
  };

  if (lang === "rust") scanRust();
  else scanJs(0, false);
  return out.join("");
}

// ---------------------------------------------------------------------------
// Declaration scanning
// ---------------------------------------------------------------------------

interface Decl {
  name: string;
  kind: SymbolKind;
  line: number;
  /** Set when the span is already known (re-export lists); otherwise computed by `endLine`. */
  endLine: number | null;
  exported: boolean;
  tauriCommand: boolean;
  isDefault: boolean;
  /** Offset of the declaration line's start in the masked text. */
  offset: number;
}

// [pub[(…)]] [default] [const] [async] [unsafe] [extern] fn|struct|enum|trait|type|mod|const|static [mut] NAME
const RUST_DECL =
  /^\s*(pub(?:\([^)]*\))?\s+)?(?:default\s+)?(?:const\s+)?(?:async\s+)?(?:unsafe\s+)?(?:extern\s+)?(fn|struct|enum|trait|type|mod|const|static)\s+(?:mut\s+)?([A-Za-z_]\w*)/;
const RUST_ATTR_START = /^\s*#!?\[/;
const TAURI_COMMAND = /#\[\s*tauri::command\b/;

const RUST_KIND: Record<string, SymbolKind> = {
  fn: "function",
  struct: "struct",
  enum: "enum",
  trait: "trait",
  type: "type",
  mod: "mod",
  const: "const",
  static: "static",
};

function lineStartsOf(text: string): number[] {
  const starts = [0];
  for (let k = 0; k < text.length; k += 1) if (text.charCodeAt(k) === 10) starts.push(k + 1);
  return starts;
}

/** 1-based line containing `offset`. */
function lineAt(starts: number[], offset: number): number {
  let lo = 0;
  let hi = starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if ((starts[mid] ?? 0) <= offset) lo = mid;
    else hi = mid - 1;
  }
  return lo + 1;
}

function countDelta(line: string, open: string, close: string): number {
  let d = 0;
  for (const ch of line) {
    if (ch === open) d += 1;
    else if (ch === close) d -= 1;
  }
  return d;
}

/** Was the `{` at `k` opened in type position (`: {`, `| {`, `& {`, `<{`, `extends {`)? */
function isTypeBrace(masked: string, k: number): boolean {
  let p = k - 1;
  while (p >= 0 && /\s/.test(masked.charAt(p))) p -= 1;
  if (p < 0) return false;
  const ch = masked.charAt(p);
  if (ch === ":" || ch === "|" || ch === "&" || ch === "<") return true;
  if (!isIdentChar(ch)) return false;
  let w = p;
  while (w >= 0 && isIdentChar(masked.charAt(w))) w -= 1;
  const word = masked.slice(w + 1, p + 1);
  return word === "extends" || word === "as" || word === "satisfies";
}

/**
 * Offset of the character that ends the statement starting at `from`: a `;` at nesting
 * zero, or the `}` closing a brace group opened at nesting zero outside type position.
 * -1 when nothing ends it before `limit`.
 */
function statementEnd(masked: string, from: number, limit: number): number {
  let nest = 0;
  let typeBrace = false;
  for (let k = from; k < limit; k += 1) {
    const ch = masked.charAt(k);
    if (ch === "{") {
      if (nest === 0) typeBrace = isTypeBrace(masked, k);
      nest += 1;
    } else if (ch === "(" || ch === "[") {
      nest += 1;
    } else if (ch === "}") {
      nest -= 1;
      if (nest < 0) return -1;
      if (nest === 0 && !typeBrace) return k;
    } else if (ch === ")" || ch === "]") {
      nest -= 1;
      if (nest < 0) return -1;
    } else if (ch === ";" && nest === 0) {
      return k;
    }
  }
  return -1;
}

/** Fill in `endLine` for every declaration (spec §6.5: braces, else next declaration − 1). */
function resolveEndLines(decls: Decl[], masked: string, lines: string[], starts: number[]): CodeSymbol[] {
  decls.sort((a, b) => a.line - b.line || a.offset - b.offset);
  const out: CodeSymbol[] = [];
  for (let i = 0; i < decls.length; i += 1) {
    const d = decls[i];
    if (!d) continue;
    let endLine = d.endLine;
    if (endLine === null) {
      let next: Decl | undefined;
      for (let j = i + 1; j < decls.length; j += 1) {
        const cand = decls[j];
        if (cand && cand.line > d.line) {
          next = cand;
          break;
        }
      }
      const limit = next ? (starts[next.line - 1] ?? masked.length) : masked.length;
      const end = statementEnd(masked, d.offset, limit);
      if (end >= 0) endLine = lineAt(starts, end);
      else {
        endLine = next ? next.line - 1 : lines.length;
        while (endLine > d.line && /^\s*$/.test(lines[endLine - 1] ?? "")) endLine -= 1;
      }
    }
    const sym: CodeSymbol = {
      name: d.name,
      kind: d.kind,
      line: d.line,
      endLine: Math.max(d.line, endLine),
      exported: d.exported,
      usedBy: [],
      confidence: "exact",
    };
    if (d.tauriCommand) sym.tauriCommand = true;
    if (d.isDefault) sym.isDefault = true;
    out.push(sym);
  }
  return out;
}

function decl(partial: Pick<Decl, "name" | "kind" | "line" | "exported" | "offset"> & Partial<Decl>): Decl {
  return { endLine: null, tauriCommand: false, isDefault: false, ...partial };
}

function rustSymbols(content: string): CodeSymbol[] {
  const masked = maskCode(content, "rust");
  const lines = masked.split("\n");
  const starts = lineStartsOf(masked);
  const decls: Decl[] = [];
  let depth = 0;
  let attrText = "";
  let attrDepth = 0;

  for (let li = 0; li < lines.length; li += 1) {
    const line = lines[li] ?? "";
    if (attrDepth > 0) {
      attrText += `${line}\n`;
      attrDepth = Math.max(0, attrDepth + countDelta(line, "[", "]"));
      continue;
    }
    if (line.trim() === "") continue; // blank or comment-only: attributes stay pending
    if (RUST_ATTR_START.test(line)) {
      attrText += `${line}\n`;
      attrDepth = Math.max(0, countDelta(line, "[", "]"));
      continue;
    }
    const topLevel = depth === 0 || !/^\s/.test(line);
    if (topLevel) {
      const m = RUST_DECL.exec(line);
      if (m) {
        decls.push(
          decl({
            name: m[3] ?? "",
            kind: RUST_KIND[m[2] ?? ""] ?? "function",
            line: li + 1,
            exported: Boolean(m[1]),
            tauriCommand: m[2] === "fn" && TAURI_COMMAND.test(attrText),
            offset: starts[li] ?? 0,
          }),
        );
      }
    }
    attrText = "";
    depth = Math.max(0, depth + countDelta(line, "{", "}"));
  }

  return resolveEndLines(decls, masked, lines, starts);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** sha1 hex of `content` — the cache key. */
export function contentHash(content: string): string {
  return createHash("sha1").update(content).digest("hex");
}

const cache = new Map<string, { hash: string; symbols: CodeSymbol[] }>();
let cacheHits = 0;
let cacheMisses = 0;

function copySymbols(symbols: CodeSymbol[]): CodeSymbol[] {
  return symbols.map((s) => ({ ...s, usedBy: s.usedBy.map((u) => ({ ...u })) }));
}

/**
 * The declarations in `file` (its repo-relative path chooses the language). Results are
 * cached per file by content sha1, so repeated calls with unchanged content do no parsing;
 * every call returns a fresh copy, safe to decorate. `usedBy` is empty here — see `withUsedBy`.
 */
export function extractSymbols(file: string, content: string): CodeSymbol[] {
  const lang = symbolLang(file);
  if (!lang) return [];
  const hash = contentHash(content);
  const hit = cache.get(file);
  if (hit && hit.hash === hash) {
    cacheHits += 1;
    return copySymbols(hit.symbols);
  }
  cacheMisses += 1;
  const symbols = lang === "rust" ? rustSymbols(content) : semanticDeclarations(file, content).map((record): CodeSymbol => {
    let kind: SymbolKind;
    if (record.kind === "variable") kind = record.defaultExport ? "default" : record.variableKind ?? "const";
    else if (record.kind === "arrow") kind = "arrow";
    else kind = record.kind;
    return {
      id: record.id,
      name: record.qualifiedName,
      qualifiedName: record.qualifiedName,
      parentSymbolId: record.parentSymbolId,
      kind,
      line: record.declaration.startLine,
      endLine: record.declaration.endLine,
      exported: record.exported,
      ...(record.defaultExport ? { isDefault: true } : {}),
      usedBy: [],
      confidence: "exact",
    };
  });
  cache.set(file, { hash, symbols });
  return copySymbols(symbols);
}

export function clearSymbolCache(): void {
  cache.clear();
  cacheHits = 0;
  cacheMisses = 0;
}

export function symbolCacheStats(): { size: number; hits: number; misses: number } {
  return { size: cache.size, hits: cacheHits, misses: cacheMisses };
}

/** Importers of `file` whose edge `names` include `name` (exact). Sorted by path, one entry per file. */
export function usedBy(graph: SymbolGraph | RepoGraph, file: string, name: string): SymbolUse[] {
  const edges: ReadonlyArray<NamedEdge> = graph.edges;
  const seen = new Set<string>();
  for (const e of edges) {
    if (e.target !== file || e.source === file || !e.names?.includes(name)) continue;
    seen.add(e.source);
  }
  return Array.from(seen)
    .sort()
    .map((f) => ({ file: f }));
}

/** The same symbols with `usedBy` filled from the graph; a default export also matches importers of `default`. */
export function withUsedBy(graph: SymbolGraph | RepoGraph, file: string, symbols: CodeSymbol[]): CodeSymbol[] {
  return symbols.map((s) => {
    const uses = usedBy(graph, file, s.name);
    if (s.isDefault && s.name !== "default") {
      const seen = new Set(uses.map((u) => u.file));
      for (const u of usedBy(graph, file, "default")) if (!seen.has(u.file)) uses.push(u);
      uses.sort((a, b) => a.file.localeCompare(b.file));
    }
    return { ...s, usedBy: uses };
  });
}

/** `extractSymbols` + `withUsedBy` in one call — what `/api/file` and `/api/symbols` want. */
export function fileSymbols(graph: SymbolGraph | RepoGraph, file: string, content: string): CodeSymbol[] {
  return withUsedBy(graph, file, extractSymbols(file, content));
}

// ---------------------------------------------------------------------------
// Named imports
// ---------------------------------------------------------------------------

/** Split on `sep` outside braces/parens/brackets. */
function splitTopLevel(text: string, sep: string): string[] {
  const out: string[] = [];
  let nest = 0;
  let cur = "";
  for (const ch of text) {
    if (ch === "{" || ch === "(" || ch === "[") nest += 1;
    else if (ch === "}" || ch === ")" || ch === "]") nest -= 1;
    if (ch === sep && nest === 0) {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

/** The local binding of one specifier: `b as c` → c, `b: c` → c, `a::b` → b, `*` → `*`. */
function localName(spec: string): string {
  const s = spec.trim();
  const as = /\s+as\s+([A-Za-z_$][\w$]*)\s*$/.exec(s);
  if (as) return as[1] ?? "";
  if (s.includes("::")) return s.slice(s.lastIndexOf("::") + 2).trim();
  const colon = /^[^:]+:\s*([A-Za-z_$][\w$]*)\s*$/.exec(s);
  if (colon) return colon[1] ?? "";
  return s;
}

interface Collected {
  names: string[];
  typed: number;
  total: number;
}

/** Names inside a brace list, recursing into nested Rust groups (`a::{b, c}`). */
function collectNames(inner: string, acc: Collected): void {
  for (const raw of splitTopLevel(inner, ",")) {
    let spec = raw.trim();
    if (!spec) continue;
    if (/^type\s+/.test(spec)) {
      acc.typed += 1;
      spec = spec.replace(/^type\s+/, "");
    }
    const open = spec.indexOf("{");
    if (open !== -1) {
      const close = spec.lastIndexOf("}");
      collectNames(spec.slice(open + 1, close === -1 ? spec.length : close), acc);
      continue;
    }
    acc.total += 1;
    const name = localName(spec);
    if (name) acc.names.push(name);
  }
}

/**
 * Names bound by an import clause — the part between `import` and `from` (a whole
 * statement is tolerated): `{ a, b as c }` → `['a','c']`, a default import → `['default']`,
 * `* as ns` → `['*']`. `isType` for `import type …` or when every specifier is `type`.
 * Also reads Rust brace groups (`{b, c as d}`, nested) and CommonJS destructuring (`{ a, b: c }`).
 */
export function parseNamedImports(clause: string): NamedImports {
  let text = clause.trim();
  text = text.replace(/^(?:import|export)\s+/, "");
  text = text.replace(/\s*\bfrom\s+['"][^'"]*['"]\s*;?\s*$/, "");
  text = text.replace(/;\s*$/, "");
  if (!text || text.startsWith("'") || text.startsWith('"')) return { names: [], isType: false };

  let isType = false;
  if (/^type\s+(?=[{*A-Za-z_$])/.test(text)) {
    isType = true;
    text = text.replace(/^type\s+/, "");
  }

  const acc: Collected = { names: [], typed: 0, total: 0 };
  for (const raw of splitTopLevel(text, ",")) {
    const part = raw.trim();
    if (!part) continue;
    if (part.startsWith("{")) {
      const close = part.lastIndexOf("}");
      collectNames(part.slice(1, close === -1 ? part.length : close), acc);
    } else if (part.startsWith("*")) {
      acc.total += 1;
      acc.names.push("*");
    } else if (/^[A-Za-z_$][\w$]*$/.test(part)) {
      acc.total += 1;
      acc.names.push("default");
    }
  }
  if (!isType && acc.total > 0 && acc.typed === acc.total) isType = true;
  return { names: Array.from(new Set(acc.names)), isType };
}

/**
 * Names bound by a Rust `use` path: `crate::a::b` → `['b']`, `crate::a::{b, c as d}` →
 * `['b','d']`, `crate::a::*` → `['*']`. A leading `use` and trailing `;` are tolerated.
 */
export function parseUseNames(usePath: string): string[] {
  const text = usePath
    .trim()
    .replace(/^(?:pub(?:\([^)]*\))?\s+)?use\s+/, "")
    .replace(/;\s*$/, "")
    .trim();
  if (!text) return [];
  const acc: Collected = { names: [], typed: 0, total: 0 };
  collectNames(text, acc);
  return Array.from(new Set(acc.names));
}

// ---------------------------------------------------------------------------
// Calls ⧗ STRETCH
// ---------------------------------------------------------------------------

/** Legacy stoplist retained for callers that display a conservative single-file view. */
export const CALL_STOPLIST: ReadonlySet<string> = new Set(["new", "run", "get", "set", "map", "filter", "then", "catch", "log"]);

/**
 * Calls from one symbol in a standalone file. Repository-wide callers should use the
 * semantic index so imported aliases and cross-file declarations can resolve as well.
 */
export function calls(file: string, content: string, symbol: CodeSymbol): CallRef[] {
  const analysis = analyzeSemanticSource(file, content);
  const id = symbol.id ?? semanticSymbolIdCompat(file, symbol.qualifiedName ?? symbol.name);
  return analysis.calls
    .filter((call) => call.callerId === id)
    .map((call) => ({
      id: call.id,
      name: call.calleeExpression,
      line: call.source.startLine,
      target: call.calleeId,
      confidence: call.resolution === "exact" ? "exact" : "heuristic",
    }));
}

function semanticSymbolIdCompat(file: string, name: string): string {
  return `sym:${file.replace(/\\/g, "/").replace(/^\.\//, "")}::${name}`;
}
