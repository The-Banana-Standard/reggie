import { beforeEach, describe, expect, it } from "vitest";
import {
  CALL_STOPLIST,
  SYMBOL_ENGINE,
  calls,
  clearSymbolCache,
  contentHash,
  extractSymbols,
  fileSymbols,
  maskCode,
  parseNamedImports,
  parseUseNames,
  symbolCacheStats,
  symbolLang,
  usedBy,
  withUsedBy,
  type CodeSymbol,
  type SymbolGraph,
} from "./symbols.js";

const byName = (symbols: CodeSymbol[]): Map<string, CodeSymbol> => new Map(symbols.map((s) => [s.name, s]));

const pick = (symbols: CodeSymbol[], name: string): CodeSymbol => {
  const s = symbols.find((x) => x.name === name);
  if (!s) throw new Error(`no symbol ${name} in ${symbols.map((x) => x.name).join(", ")}`);
  return s;
};

beforeEach(() => clearSymbolCache());

describe("TypeScript declarations", () => {
  const source = [
    "import { x } from './x.js';", // 1
    "", // 2
    "export function plain(a: number): number {", // 3
    "  return a + 1;", // 4
    "}", // 5
    "export async function fetchIt(): Promise<void> {}", // 6
    "export function* gen() { yield 1; }", // 7
    "export class Widget {", // 8
    "  method() { return 1; }", // 9
    "}", // 10
    "export abstract class Base {}", // 11
    "export const answer = 42;", // 12
    "export let counter = 0;", // 13
    "export var legacy = 'v';", // 14
    "export type Id = string;", // 15
    "export interface Shape {", // 16
    "  sides: number;", // 17
    "}", // 18
    "export enum Color { Red, Green }", // 19
    "export const enum Flags { A = 1 }", // 20
    "export declare function ambient(): void;", // 21
    "function helper() {", // 22
    "  function inner() {}", // 23
    "  return inner;", // 24
    "}", // 25
    "class Hidden {}", // 26
    "const notListed = 1;", // 27
  ].join("\n");

  it("extracts every kind with line, endLine and exported", () => {
    const symbols = extractSymbols("src/kinds.ts", source);
    const m = byName(symbols);
    expect(m.get("plain")).toMatchObject({ kind: "function", line: 3, endLine: 5, exported: true, confidence: "exact" });
    expect(m.get("fetchIt")).toMatchObject({ kind: "function", line: 6, endLine: 6, exported: true });
    expect(m.get("gen")).toMatchObject({ kind: "function", line: 7, endLine: 7, exported: true });
    expect(m.get("Widget")).toMatchObject({ kind: "class", line: 8, endLine: 10, exported: true });
    expect(m.get("Base")).toMatchObject({ kind: "class", line: 11, endLine: 11, exported: true });
    expect(m.get("answer")).toMatchObject({ kind: "const", line: 12, endLine: 12 });
    expect(m.get("counter")).toMatchObject({ kind: "let", line: 13, endLine: 13 });
    expect(m.get("legacy")).toMatchObject({ kind: "var", line: 14, endLine: 14 });
    expect(m.get("Id")).toMatchObject({ kind: "type", line: 15, endLine: 15 });
    expect(m.get("Shape")).toMatchObject({ kind: "interface", line: 16, endLine: 18 });
    expect(m.get("Color")).toMatchObject({ kind: "enum", line: 19, endLine: 19 });
    expect(m.get("Flags")).toMatchObject({ kind: "enum", line: 20, endLine: 20 });
    expect(m.get("ambient")).toMatchObject({ kind: "function", line: 21, endLine: 21, exported: true });
  });

  it("includes non-exported top-level functions and classes only", () => {
    const symbols = extractSymbols("src/kinds.ts", source);
    const m = byName(symbols);
    expect(m.get("helper")).toMatchObject({ kind: "function", line: 22, endLine: 25, exported: false });
    expect(m.get("Hidden")).toMatchObject({ kind: "class", line: 26, endLine: 26, exported: false });
    expect(m.has("inner")).toBe(false); // nested in a body
    expect(m.has("method")).toBe(false); // class member
    expect(m.has("notListed")).toBe(false); // non-exported const is not a symbol
    expect(m.has("x")).toBe(false); // an import is not a declaration
  });

  it("orders symbols by line and starts every usedBy empty", () => {
    const symbols = extractSymbols("src/kinds.ts", source);
    const lines = symbols.map((s) => s.line);
    expect(lines).toEqual([...lines].sort((a, b) => a - b));
    expect(symbols.every((s) => s.usedBy.length === 0)).toBe(true);
  });

  it("handles JavaScript, JSX and CommonJS exports", () => {
    const js = [
      "const React = require('react');", // 1
      "function Button({ label }) {", // 2
      "  return <button className=\"b\">{label} don't click</button>;", // 3
      "}", // 4
      "module.exports.Button = Button;", // 5
      "exports.make = (x) => x * 2;", // 6
      "module.exports.Model = class {};", // 7
      "module.exports.build = function () {", // 8
      "  return 1;", // 9
      "};", // 10
    ].join("\n");
    const symbols = extractSymbols("src/button.jsx", js);
    const m = byName(symbols);
    // `module.exports.Button = Button` exports the declaration itself: one row, now exported.
    expect(symbols.filter((s) => s.name === "Button")).toHaveLength(1);
    expect(m.get("Button")).toMatchObject({ kind: "function", line: 2, endLine: 4, exported: true });
    expect(m.get("make")).toMatchObject({ kind: "function", line: 6, endLine: 6, exported: true });
    expect(m.get("Model")).toMatchObject({ kind: "class", line: 7, endLine: 7, exported: true });
    expect(m.get("build")).toMatchObject({ kind: "function", line: 8, endLine: 10, exported: true });
  });
});

describe("default exports", () => {
  it("keeps the kind of a named default declaration and flags it as default", () => {
    const m = byName(extractSymbols("src/App.tsx", "export default function App() {\n  return null;\n}\n"));
    expect(m.get("App")).toMatchObject({ kind: "function", line: 1, endLine: 3, exported: true, isDefault: true });
    const c = byName(extractSymbols("src/C.ts", "export default class Store {}\n"));
    expect(c.get("Store")).toMatchObject({ kind: "class", exported: true, isDefault: true });
  });

  it("`export default <local>` exports the local declaration as the default, once", () => {
    const symbols = extractSymbols("src/App.tsx", "function App() {\n  return null;\n}\nexport default App;\n");
    expect(symbols).toHaveLength(1);
    expect(symbols[0]).toMatchObject({ name: "App", kind: "function", line: 1, endLine: 3, exported: true, isDefault: true });
  });

  it("reports `export default <identifier>` as kind default when nothing local declares it", () => {
    const symbols = extractSymbols("src/App.tsx", "const App = () => null;\nexport default App;\n");
    expect(symbols).toHaveLength(1);
    expect(symbols[0]).toMatchObject({ name: "App", kind: "default", line: 2, endLine: 2, exported: true, isDefault: true });
  });

  it("names anonymous defaults `default`", () => {
    for (const src of [
      "export default function () {\n  return 1;\n}\n",
      "export default class {}\n",
      "export default async () => 1;\n",
      "export default {\n  a: 1,\n};\n",
      "export default 42;\n",
      'export default "text";\n',
    ]) {
      const symbols = extractSymbols("src/anon.ts", src);
      expect(symbols).toHaveLength(1);
      expect(symbols[0]).toMatchObject({ name: "default", kind: "default", exported: true, isDefault: true, line: 1 });
    }
    expect(extractSymbols("src/anon.ts", "export default function () {\n  return 1;\n}\n")[0]?.endLine).toBe(3);
    expect(extractSymbols("src/anon.ts", "export default {\n  a: 1,\n};\n")[0]?.endLine).toBe(3);
  });
});

describe("re-exports", () => {
  it("lists `export { a, b as c } from` with the outward names", () => {
    const symbols = extractSymbols("src/index.ts", "export { a, b as c } from './x.js';\nexport type { T } from './t.js';\n");
    expect(symbols.map((s) => [s.name, s.kind, s.line, s.exported])).toEqual([
      ["a", "reexport", 1, true],
      ["c", "reexport", 1, true],
      ["T", "reexport", 2, true],
    ]);
  });

  it("handles star re-exports and multi-line lists", () => {
    const src = ["export * from './a.js';", "export * as ns from './b.js';", "export {", "  one,", "  two as deux,", "} from './c.js';"].join("\n");
    const symbols = extractSymbols("src/index.ts", src);
    expect(pick(symbols, "*")).toMatchObject({ kind: "reexport", line: 1, endLine: 1 });
    expect(pick(symbols, "ns")).toMatchObject({ kind: "reexport", line: 2, endLine: 2 });
    expect(pick(symbols, "one")).toMatchObject({ kind: "reexport", line: 3, endLine: 6 });
    expect(pick(symbols, "deux")).toMatchObject({ kind: "reexport", line: 3, endLine: 6 });
  });

  it("marks locals exported by a trailing `export { … }` instead of duplicating them", () => {
    const src = ["function login() {", "  return 1;", "}", "const token = 'x';", "export { login, token, login as signIn };"].join("\n");
    const symbols = extractSymbols("src/auth.ts", src);
    expect(pick(symbols, "login")).toMatchObject({ kind: "function", line: 1, endLine: 3, exported: true });
    expect(symbols.filter((s) => s.name === "login")).toHaveLength(1);
    expect(pick(symbols, "token")).toMatchObject({ kind: "reexport", line: 5, exported: true });
    expect(pick(symbols, "signIn")).toMatchObject({ kind: "reexport", line: 5, exported: true });
  });
});

describe("endLine", () => {
  it("ignores braces inside strings, comments, template literals and regex literals", () => {
    const src = [
      "export function tricky() {", // 1
      "  const a = '}';", // 2
      '  const b = "{{";', // 3
      "  // } not a brace", // 4
      "  /* } neither", // 5
      "     } */", // 6
      "  const c = `}${a}{${b ? `{` : '}'}`;", // 7
      "  const d = /[}]{2}/.test(a);", // 8
      "  return a + b + c + d;", // 9
      "}", // 10
      "export const after = 1;", // 11
    ].join("\n");
    const symbols = extractSymbols("src/t.ts", src);
    expect(pick(symbols, "tricky")).toMatchObject({ line: 1, endLine: 10 });
    expect(pick(symbols, "after")).toMatchObject({ line: 11, endLine: 11 });
  });

  it("does not stop at an object-literal return type or a typed const annotation", () => {
    const src = [
      "export function shape(): { a: number } {", // 1
      "  return { a: 1 };", // 2
      "}", // 3
      "export async function fetchAll(): Promise<{ ok: boolean }> {", // 4
      "  return { ok: true };", // 5
      "}", // 6
      "export const config: {", // 7
      "  port: number;", // 8
      "} = {", // 9
      "  port: 1,", // 10
      "};", // 11
    ].join("\n");
    const symbols = extractSymbols("src/t.ts", src);
    expect(pick(symbols, "shape")).toMatchObject({ line: 1, endLine: 3 });
    expect(pick(symbols, "fetchAll")).toMatchObject({ line: 4, endLine: 6 });
    expect(pick(symbols, "config")).toMatchObject({ line: 7, endLine: 11 });
  });

  it("spans arrow functions, call wrappers and arrays to their terminator", () => {
    const src = [
      "export const add = (a: number, b: number) => {", // 1
      "  return a + b;", // 2
      "};", // 3
      "export const memo = wrap(", // 4
      "  { deep: { x: 1 } },", // 5
      "  2,", // 6
      ");", // 7
      "export const list = [", // 8
      "  1,", // 9
      "  2,", // 10
      "];", // 11
      "export const one = 1", // 12
      "export const two = 2", // 13
    ].join("\n");
    const symbols = extractSymbols("src/t.ts", src);
    expect(pick(symbols, "add")).toMatchObject({ line: 1, endLine: 3 });
    expect(pick(symbols, "memo")).toMatchObject({ line: 4, endLine: 7 });
    expect(pick(symbols, "list")).toMatchObject({ line: 8, endLine: 11 });
    expect(pick(symbols, "one")).toMatchObject({ line: 12, endLine: 12 });
    expect(pick(symbols, "two")).toMatchObject({ line: 13, endLine: 13 });
  });

  it("falls back to the line before the next declaration, trailing blank lines trimmed", () => {
    const src = [
      "export type A = string", // 1
      "  | number", // 2
      "", // 3
      "/** doc for B */", // 4
      "export type B = { a: 1 }", // 5
      "", // 6
      "export const last = cond", // 7
      "  ? 1", // 8
      "  : 2", // 9
      "", // 10
    ].join("\n");
    const symbols = extractSymbols("src/t.ts", src);
    expect(pick(symbols, "A")).toMatchObject({ line: 1, endLine: 2 });
    expect(pick(symbols, "B")).toMatchObject({ line: 5, endLine: 5 });
    expect(pick(symbols, "last")).toMatchObject({ line: 7, endLine: 9 });
  });

  it("never puts endLine before line", () => {
    const symbols = extractSymbols("src/t.ts", "export const a = 1;\nexport const b = 2;");
    for (const s of symbols) expect(s.endLine).toBeGreaterThanOrEqual(s.line);
  });

  it("copes with CRLF line endings", () => {
    const symbols = extractSymbols("src/t.ts", "export function f() {\r\n  return 1;\r\n}\r\nexport const g = 2;\r\n");
    expect(pick(symbols, "f")).toMatchObject({ line: 1, endLine: 3 });
    expect(pick(symbols, "g")).toMatchObject({ line: 4, endLine: 4 });
  });
});

describe("Rust declarations", () => {
  const source = [
    "use std::collections::HashMap;", // 1
    "", // 2
    "pub mod commands;", // 3
    "mod private;", // 4
    "", // 5
    "/// A bookmark { with a brace in the doc }", // 6
    "#[derive(Debug, Clone)]", // 7
    "pub struct Bookmark {", // 8
    "    pub path: String,", // 9
    "}", // 10
    "pub(crate) struct Unit;", // 11
    "pub struct Tuple(u32);", // 12
    "pub enum Kind {", // 13
    "    A { x: u8 },", // 14
    "    B,", // 15
    "}", // 16
    "pub trait Store {", // 17
    "    fn load(&self) -> String;", // 18
    "}", // 19
    "pub type Map = HashMap<String, String>;", // 20
    "pub const LIMIT: usize = 10;", // 21
    "pub static mut COUNT: u32 = 0;", // 22
    "static NAME: &str = \"x } y\";", // 23
    "", // 24
    "#[tauri::command]", // 25
    "pub async fn greet(name: String) -> Result<String, String> {", // 26
    "    let raw = r#\"}\"#;", // 27
    "    let c = '}';", // 28
    "    /* nested /* } */ } */", // 29
    "    Ok(format!(\"hi {}\", name))", // 30
    "}", // 31
    "", // 32
    "#[tauri::command(rename_all = \"snake_case\")]", // 33
    "#[allow(dead_code)]", // 34
    "fn hidden_command() {}", // 35
    "", // 36
    "#[tauri::command(", // 37
    "    rename_all = \"camelCase\"", // 38
    ")]", // 39
    "pub fn multi_line_attr() {}", // 40
    "", // 41
    "impl Bookmark {", // 42
    "    pub fn new() -> Self { Self { path: String::new() } }", // 43
    "}", // 44
    "", // 45
    "pub fn helper<'a>(x: &'a str) -> &'a str { x }", // 46
    "const fn tiny() -> u8 { 1 }", // 47
    "pub unsafe fn danger() {}", // 48
    "", // 49
    "#[cfg(test)]", // 50
    "mod tests {", // 51
    "    #[test]", // 52
    "    fn it_works() {}", // 53
    "}", // 54
  ].join("\n");

  it("extracts pub and private items with the right kinds", () => {
    const symbols = extractSymbols("src-tauri/src/lib.rs", source);
    const m = byName(symbols);
    expect(m.get("commands")).toMatchObject({ kind: "mod", line: 3, endLine: 3, exported: true });
    expect(m.get("private")).toMatchObject({ kind: "mod", line: 4, endLine: 4, exported: false });
    expect(m.get("Bookmark")).toMatchObject({ kind: "struct", line: 8, endLine: 10, exported: true });
    expect(m.get("Unit")).toMatchObject({ kind: "struct", line: 11, endLine: 11, exported: true });
    expect(m.get("Tuple")).toMatchObject({ kind: "struct", line: 12, endLine: 12, exported: true });
    expect(m.get("Kind")).toMatchObject({ kind: "enum", line: 13, endLine: 16, exported: true });
    expect(m.get("Store")).toMatchObject({ kind: "trait", line: 17, endLine: 19, exported: true });
    expect(m.get("Map")).toMatchObject({ kind: "type", line: 20, endLine: 20, exported: true });
    expect(m.get("LIMIT")).toMatchObject({ kind: "const", line: 21, endLine: 21, exported: true });
    expect(m.get("COUNT")).toMatchObject({ kind: "static", line: 22, endLine: 22, exported: true });
    expect(m.get("NAME")).toMatchObject({ kind: "static", line: 23, endLine: 23, exported: false });
    expect(m.get("helper")).toMatchObject({ kind: "function", line: 46, endLine: 46, exported: true });
    expect(m.get("tiny")).toMatchObject({ kind: "function", line: 47, endLine: 47, exported: false });
    expect(m.get("danger")).toMatchObject({ kind: "function", line: 48, endLine: 48, exported: true });
    expect(m.get("tests")).toMatchObject({ kind: "mod", line: 51, endLine: 54, exported: false });
  });

  it("flags #[tauri::command] functions, including multi-line and stacked attributes", () => {
    const m = byName(extractSymbols("src-tauri/src/lib.rs", source));
    expect(m.get("greet")).toMatchObject({ kind: "function", line: 26, endLine: 31, exported: true, tauriCommand: true });
    expect(m.get("hidden_command")).toMatchObject({ line: 35, exported: false, tauriCommand: true });
    expect(m.get("multi_line_attr")).toMatchObject({ line: 40, endLine: 40, exported: true, tauriCommand: true });
    expect(m.get("helper")?.tauriCommand).toBeUndefined();
    expect(m.get("Bookmark")?.tauriCommand).toBeUndefined();
  });

  it("skips impl methods, trait items and test-module functions", () => {
    const m = byName(extractSymbols("src-tauri/src/lib.rs", source));
    expect(m.has("new")).toBe(false);
    expect(m.has("load")).toBe(false);
    expect(m.has("it_works")).toBe(false);
  });

  it("does not report a tauri command when other code sits between attribute and fn", () => {
    const src = "#[tauri::command]\npub fn a() {}\n\npub fn b() {}\n";
    const m = byName(extractSymbols("x.rs", src));
    expect(m.get("a")?.tauriCommand).toBe(true);
    expect(m.get("b")?.tauriCommand).toBeUndefined();
  });
});

describe("maskCode", () => {
  it("keeps length and newlines while blanking strings and comments", () => {
    const src = "const a = 'x}'; // }\nconst b = `t${a}`; /* }\n */ const c = 1;";
    const masked = maskCode(src, "js");
    expect(masked.length).toBe(src.length);
    expect(masked.split("\n").length).toBe(src.split("\n").length);
    expect(masked).not.toContain("}"); // only braces inside literals/comments exist here… except the template expression's
    expect(masked).toContain("const c = 1");
  });

  it("keeps code inside template expressions", () => {
    const masked = maskCode("const s = `a ${fn({ x: 1 })} b`;", "js");
    expect(masked).toContain("fn({ x: 1 })");
    expect(masked).not.toContain("a ");
  });

  it("tells regex literals from division", () => {
    const src = "const r = /a{2}/g; const q = 4 / 2 / 1;";
    const masked = maskCode(src, "js");
    expect(masked).toBe(`const r = ${" ".repeat("/a{2}/g".length)}; const q = 4 / 2 / 1;`);
    expect(maskCode("return /[/]}/.test(s)", "js")).toBe(`return ${" ".repeat("/[/]}/".length)}.test(s)`);
    expect(maskCode("const half = total / 2;\nconst next = half / 3;", "js")).toBe("const half = total / 2;\nconst next = half / 3;");
  });

  it("leaves Rust lifetimes alone and blanks char and raw-string literals", () => {
    const masked = maskCode("fn f<'a>(x: &'a str) -> char { let c = '}'; let r = r##\"}\"##; 'x' }", "rust");
    expect(masked).toContain("fn f<'a>(x: &'a str) -> char {");
    expect(masked).not.toContain("'}'");
    expect(masked).not.toContain("r##");
    expect(masked.length).toBe(masked.length);
  });
});

describe("parseNamedImports", () => {
  it("returns local names for named, default and namespace imports", () => {
    expect(parseNamedImports("{ a, b as c }")).toEqual({ names: ["a", "c"], isType: false });
    expect(parseNamedImports("React")).toEqual({ names: ["default"], isType: false });
    expect(parseNamedImports("* as ns")).toEqual({ names: ["*"], isType: false });
    expect(parseNamedImports("React, { useState as us, type FC }")).toEqual({ names: ["default", "us", "FC"], isType: false });
    expect(parseNamedImports("Def, * as ns")).toEqual({ names: ["default", "*"], isType: false });
  });

  it("detects type-only imports", () => {
    expect(parseNamedImports("type { A, B }")).toEqual({ names: ["A", "B"], isType: true });
    expect(parseNamedImports("type Foo")).toEqual({ names: ["default"], isType: true });
    expect(parseNamedImports("{ type A, type B as C }")).toEqual({ names: ["A", "C"], isType: true });
    expect(parseNamedImports("{ type A, b }")).toEqual({ names: ["A", "b"], isType: false });
  });

  it("tolerates whole statements, side-effect imports and empty clauses", () => {
    expect(parseNamedImports("import { x, y } from './z.js';")).toEqual({ names: ["x", "y"], isType: false });
    expect(parseNamedImports("import type { T } from './t.js'")).toEqual({ names: ["T"], isType: true });
    expect(parseNamedImports("export { a as b } from './c.js';")).toEqual({ names: ["b"], isType: false });
    expect(parseNamedImports("import './side.js';")).toEqual({ names: [], isType: false });
    expect(parseNamedImports("")).toEqual({ names: [], isType: false });
    expect(parseNamedImports("{ }")).toEqual({ names: [], isType: false });
  });

  it("reads Rust brace groups (nested) and CommonJS destructuring", () => {
    expect(parseNamedImports("{b, c as d}")).toEqual({ names: ["b", "d"], isType: false });
    expect(parseNamedImports("{a::{b, c}, d, e::*}")).toEqual({ names: ["b", "c", "d", "*"], isType: false });
    expect(parseNamedImports("{ a, b: c }")).toEqual({ names: ["a", "c"], isType: false });
  });

  it("dedupes names", () => {
    expect(parseNamedImports("{ a, a }").names).toEqual(["a"]);
  });
});

describe("parseUseNames", () => {
  it("returns the bound names of a use path", () => {
    expect(parseUseNames("crate::a::b")).toEqual(["b"]);
    expect(parseUseNames("use crate::a::{b, c as d};")).toEqual(["b", "d"]);
    expect(parseUseNames("pub use reggie_lib::run;")).toEqual(["run"]);
    expect(parseUseNames("crate::a::*")).toEqual(["*"]);
    expect(parseUseNames("crate::a::{self, b}")).toEqual(["self", "b"]);
    expect(parseUseNames("")).toEqual([]);
  });
});

describe("usedBy", () => {
  const graph: SymbolGraph = {
    edges: [
      { source: "src/serve.ts", target: "src/graph.ts", kind: "import", names: ["buildGraph", "RepoGraph"] },
      { source: "src/cli.ts", target: "src/graph.ts", kind: "import", names: ["buildGraph"] },
      { source: "src/graph.test.ts", target: "src/graph.ts", kind: "tests", names: ["buildGraph", "dirKey"] },
      { source: "src/other.ts", target: "src/graph.ts", kind: "import", names: ["buildGraphs"] },
      { source: "src/legacy.ts", target: "src/graph.ts", kind: "import" },
      { source: "src/main.tsx", target: "src/App.tsx", kind: "import", names: ["default"] },
      { source: "src/App.tsx", target: "src/App.tsx", kind: "import", names: ["App"] },
      { source: "src/hooks/useGit.ts", target: "src-tauri/src/commands/git.rs", kind: "ipc", names: ["get_git_log"] },
      { source: "task:x", target: "src/graph.ts", kind: "touches" },
    ],
  };

  it("lists importers whose edge names include the symbol, exactly", () => {
    expect(usedBy(graph, "src/graph.ts", "buildGraph")).toEqual([{ file: "src/cli.ts" }, { file: "src/graph.test.ts" }, { file: "src/serve.ts" }]);
    expect(usedBy(graph, "src/graph.ts", "RepoGraph")).toEqual([{ file: "src/serve.ts" }]);
    expect(usedBy(graph, "src/graph.ts", "dirKey")).toEqual([{ file: "src/graph.test.ts" }]);
    expect(usedBy(graph, "src/graph.ts", "nope")).toEqual([]);
    expect(usedBy(graph, "src/missing.ts", "buildGraph")).toEqual([]);
  });

  it("follows IPC command names to the Rust file", () => {
    expect(usedBy(graph, "src-tauri/src/commands/git.rs", "get_git_log")).toEqual([{ file: "src/hooks/useGit.ts" }]);
  });

  it("ignores self-edges", () => {
    expect(usedBy(graph, "src/App.tsx", "App")).toEqual([]);
  });

  it("withUsedBy fills every symbol and matches `default` for default exports", () => {
    const symbols = extractSymbols("src/App.tsx", "export default function App() {}\nexport const helper = 1;\n");
    const filled = withUsedBy(graph, "src/App.tsx", symbols);
    expect(pick(filled, "App").usedBy).toEqual([{ file: "src/main.tsx" }]);
    expect(pick(filled, "helper").usedBy).toEqual([]);
    expect(pick(symbols, "App").usedBy).toEqual([]); // input untouched
  });

  it("fileSymbols combines extraction and usage", () => {
    const content = "export function buildGraph() {}\nexport interface RepoGraph { n: number }\n";
    const symbols = fileSymbols(graph, "src/graph.ts", content);
    expect(pick(symbols, "buildGraph").usedBy.map((u) => u.file)).toEqual(["src/cli.ts", "src/graph.test.ts", "src/serve.ts"]);
    expect(pick(symbols, "RepoGraph").usedBy).toEqual([{ file: "src/serve.ts" }]);
  });
});

describe("cache", () => {
  it("hashes content with sha1", () => {
    expect(contentHash("abc")).toBe("a9993e364706816aba3e25717850c26c9cd0d89d");
  });

  it("serves repeated content from the cache and re-parses on change", () => {
    extractSymbols("a.ts", "export const a = 1;");
    extractSymbols("a.ts", "export const a = 1;");
    expect(symbolCacheStats()).toEqual({ size: 1, hits: 1, misses: 1 });
    const changed = extractSymbols("a.ts", "export const b = 2;");
    expect(changed.map((s) => s.name)).toEqual(["b"]);
    expect(symbolCacheStats()).toEqual({ size: 1, hits: 1, misses: 2 });
    extractSymbols("b.ts", "export const c = 3;");
    expect(symbolCacheStats().size).toBe(2);
  });

  it("returns independent copies", () => {
    const first = extractSymbols("a.ts", "export const a = 1;");
    first[0]!.usedBy.push({ file: "mutated.ts" });
    first[0]!.name = "renamed";
    const second = extractSymbols("a.ts", "export const a = 1;");
    expect(second[0]).toMatchObject({ name: "a", usedBy: [] });
  });

  it("does not cache or parse non-code files", () => {
    expect(extractSymbols("README.md", "export const a = 1;")).toEqual([]);
    expect(extractSymbols("data.json", "{}")).toEqual([]);
    expect(symbolCacheStats().size).toBe(0);
  });
});

describe("misc", () => {
  it("detects the language from the extension", () => {
    expect(symbolLang("a.ts")).toBe("js");
    expect(symbolLang("a.d.ts")).toBe("js");
    expect(symbolLang("A.TSX")).toBe("js");
    expect(symbolLang("a.mjs")).toBe("js");
    expect(symbolLang("a.rs")).toBe("rust");
    expect(symbolLang("a.py")).toBeNull();
    expect(symbolLang("Makefile")).toBeNull();
  });

  it("reports the regex engine and a stub for calls()", () => {
    expect(SYMBOL_ENGINE).toBe("regex");
    const sym = extractSymbols("a.ts", "export function f() { g(); }")[0]!;
    expect(calls("a.ts", "export function f() { g(); }", sym)).toEqual([]);
    expect(CALL_STOPLIST.has("map")).toBe(true);
  });

  it("returns nothing for empty content", () => {
    expect(extractSymbols("a.ts", "")).toEqual([]);
    expect(extractSymbols("a.rs", "")).toEqual([]);
  });
});
