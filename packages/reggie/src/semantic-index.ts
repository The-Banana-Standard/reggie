import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import type { RepoGraph } from "./graph.js";
import type { Role } from "./roles.js";
import { buildDataConcepts, type ConceptEvidence, type ConceptLink, type ConceptOccurrence, type DataConcept } from "./data-concepts.js";
import { applyConceptOverrides, readConceptOverrides } from "./concept-overrides.js";
import { analyzeReachability, codeRoleOf, type CodeRole, type ReachabilityResult } from "./reachability.js";

export interface SourceSpan {
  file: string;
  startLine: number;
  endLine: number;
  startOffset: number;
  endOffset: number;
}

export type DeclaredTypeSource = "typescript" | "jsdoc" | "referenced";

export interface DeclaredType {
  text: string;
  source: DeclaredTypeSource;
  declaration: SourceSpan;
}

export type ValueShapeKind = "object" | "array" | "tuple" | "union" | "reference" | "scalar" | "unknown";

export interface ValueField {
  name: string;
  path: string[];
  explicitType: DeclaredType | null;
  shape: ValueShape | null;
  optional: boolean;
  source: SourceSpan | null;
}

/** Recursive and intentionally uncapped: callers choose how much of it to render. */
export interface ValueShape {
  kind: ValueShapeKind;
  fields: ValueField[];
  elements: ValueShape[];
  variants: ValueShape[];
  reference: string | null;
}

export interface ParameterRecord {
  index: number;
  name: string | null;
  bindingPaths: string[][];
  optional: boolean;
  rest: boolean;
  defaultExpression: string | null;
  explicitType: DeclaredType | null;
  shape: ValueShape | null;
  source: SourceSpan;
}

export type SemanticSymbolKind = "function" | "arrow" | "class" | "constructor" | "method" | "variable" | "interface" | "type" | "enum" | "reexport";

export interface SymbolRecord {
  id: string;
  file: string;
  name: string;
  qualifiedName: string;
  parentSymbolId: string | null;
  kind: SemanticSymbolKind;
  variableKind: "const" | "let" | "var" | null;
  exported: boolean;
  defaultExport: boolean;
  async: boolean;
  generator: boolean;
  declaration: SourceSpan;
  documentedDeclaration: SourceSpan;
  parameters: ParameterRecord[];
  explicitReturnType: DeclaredType | null;
  returnVariants: ReturnVariant[];
  validationIds: string[];
  callerIds: string[];
  calleeIds: string[];
  fingerprint: string;
}

export type ArgumentCategory = "argument" | "request-payload" | "service-payload";

export interface ArgumentValue {
  index: number;
  parameterName: string | null;
  expression: string;
  category: ArgumentCategory;
  spread: boolean;
  explicitType: DeclaredType | null;
  shape: ValueShape | null;
  source: SourceSpan;
}

export type ReturnVariantKind = "return" | "http-response" | "implicit";

export interface ReturnVariant {
  id: string;
  symbolId: string;
  kind: ReturnVariantKind;
  expression: string;
  condition: string | null;
  status: string | null;
  explicitType: DeclaredType | null;
  shape: ValueShape | null;
  source: SourceSpan;
}

export type CallResolution = "exact" | "dynamic" | "external" | "unresolved";

export interface CallSite {
  id: string;
  callerId: string;
  calleeId: string | null;
  expression: string;
  calleeExpression: string;
  resolution: CallResolution;
  arguments: ArgumentValue[];
  source: SourceSpan;
  /** Lexical if-conditions, not a simulation of runtime branch selection. */
  condition?: string | null;
  /** Anonymous callback boundary; do not mistake this for synchronous execution by callerId. */
  callback?: SourceSpan | null;
}

export interface ClientTrigger {
  id: string;
  kind: "ui-event" | "react-effect";
  label: string;
  event: string;
  targetSymbolId: string | null;
  callSiteIds: string[];
  source: SourceSpan;
}

export type CallFindingKind = "dynamic-dispatch" | "unresolved-callback" | "external-call" | "unresolved-call";

export interface CallFinding {
  id: string;
  callSiteId: string;
  kind: CallFindingKind;
  expression: string;
  reason: string;
  source: SourceSpan;
}

export type ValidationKind = "guard" | "schema" | "assertion";

export interface ValidationRule {
  id: string;
  symbolId: string;
  kind: ValidationKind;
  expression: string;
  fieldPaths: string[][];
  source: SourceSpan;
}

export type RouteKind = "cloudflare" | "next" | "express" | "hono";

export interface ClientRouteCall {
  callSiteId: string;
  callerId: string;
  method: string;
  path: string;
  requestShape: ValueShape | null;
  source: SourceSpan;
}

export interface RouteRecord {
  id: string;
  kind: RouteKind;
  method: string;
  path: string;
  handlerSymbolId: string | null;
  middlewareSymbolIds: string[];
  clientCalls: ClientRouteCall[];
  requestShape: ValueShape | null;
  responseVariants: ReturnVariant[];
  source: SourceSpan;
}

export interface SemanticFileRecord {
  file: string;
  role: Role;
  codeRole: CodeRole;
  symbols: string[];
  fingerprint: string;
}

export interface SemanticIndex {
  files: SemanticFileRecord[];
  symbols: SymbolRecord[];
  calls: CallSite[];
  findings: CallFinding[];
  validations: ValidationRule[];
  routes: RouteRecord[];
  /** Compiler-derived grouping before repository-owned merge/split overrides. */
  staticConcepts: DataConcept[];
  concepts: DataConcept[];
  reachability: ReachabilityResult;
  generatedAt: string;
  clientTriggers?: ClientTrigger[];
}

export interface BuildSemanticIndexOptions {
  contents?: ReadonlyMap<string, string>;
  now?: Date;
}

interface Candidate {
  sourceFile: ts.SourceFile;
  file: string;
  node: ts.Node;
  declarationNode: ts.Node;
  functionLike: ts.FunctionLikeDeclaration | null;
  name: string;
  qualifiedName: string;
  parentQualifiedName: string | null;
  kind: SemanticSymbolKind;
  variableKind: "const" | "let" | "var" | null;
  exported: boolean;
  defaultExport: boolean;
}

interface FileContext {
  file: string;
  sourceFile: ts.SourceFile;
  role: Role;
  candidates: Candidate[];
}

interface BuildContext {
  root: string;
  checker: ts.TypeChecker;
  files: FileContext[];
  recordByNode: Map<ts.Node, SymbolRecord>;
  recordById: Map<string, SymbolRecord>;
  recordByQualified: Map<string, SymbolRecord>;
}

const JS_EXTENSIONS = new Set([".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs", ".mts", ".cts"]);
const HTTP_METHODS = new Set(["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS", "HEAD"]);
const REPO_FILE_BY_SOURCE = new WeakMap<ts.SourceFile, string>();

export function semanticSymbolId(file: string, qualifiedName: string): string {
  return `sym:${normalizePath(file)}::${qualifiedName}`;
}

export function routeRecordId(method: string, routePath: string): string {
  return `route:${method.toUpperCase()}:${routePath}`;
}

function normalizePath(file: string): string {
  let normalized = file.replace(/\\/g, "/");
  while (normalized.startsWith("./")) normalized = normalized.slice(2);
  return normalized;
}

function unique(values: Iterable<string>): string[] {
  return [...new Set(values)].sort((a, b) => a.localeCompare(b));
}

function textOf(node: ts.Node, sourceFile: ts.SourceFile): string {
  return node.getText(sourceFile).trim();
}

function lineOf(sourceFile: ts.SourceFile, offset: number): number {
  return sourceFile.getLineAndCharacterOfPosition(Math.max(0, Math.min(offset, sourceFile.text.length))).line + 1;
}

function spanOf(file: string, sourceFile: ts.SourceFile, start: number, end: number): SourceSpan {
  const safeStart = Math.max(0, Math.min(start, sourceFile.text.length));
  const safeEnd = Math.max(safeStart, Math.min(end, sourceFile.text.length));
  return {
    file,
    startLine: lineOf(sourceFile, safeStart),
    endLine: lineOf(sourceFile, Math.max(safeStart, safeEnd - 1)),
    startOffset: safeStart,
    endOffset: safeEnd,
  };
}

function nodeSpan(file: string, sourceFile: ts.SourceFile, node: ts.Node): SourceSpan {
  return spanOf(file, sourceFile, node.getStart(sourceFile), node.getEnd());
}

function documentedStart(node: ts.Node, sourceFile: ts.SourceFile): number {
  const start = node.getStart(sourceFile);
  const ranges = ts.getLeadingCommentRanges(sourceFile.text, node.getFullStart()) ?? [];
  const doc = [...ranges].reverse().find((range) => sourceFile.text.slice(range.pos, Math.min(range.pos + 3, range.end)) === "/**" && sourceFile.text.slice(range.end, start).trim() === "");
  return doc?.pos ?? start;
}

function hasModifier(node: ts.Node, kind: ts.SyntaxKind): boolean {
  return Boolean(ts.canHaveModifiers(node) && ts.getModifiers(node)?.some((modifier) => modifier.kind === kind));
}

function isExported(node: ts.Node): boolean {
  if (hasModifier(node, ts.SyntaxKind.ExportKeyword) || hasModifier(node, ts.SyntaxKind.DefaultKeyword)) return true;
  const parent = node.parent;
  return Boolean(parent?.parent && ts.isVariableStatement(parent.parent) && hasModifier(parent.parent, ts.SyntaxKind.ExportKeyword));
}

function propertyName(node: ts.PropertyName | ts.BindingName | undefined, sourceFile: ts.SourceFile): string | null {
  if (!node) return null;
  if (ts.isIdentifier(node) || ts.isPrivateIdentifier(node)) return node.text;
  if (ts.isStringLiteralLike(node) || ts.isNumericLiteral(node)) return node.text;
  if (ts.isComputedPropertyName(node)) return `[${textOf(node.expression, sourceFile)}]`;
  return null;
}

function bindingPaths(name: ts.BindingName, sourceFile: ts.SourceFile, prefix: string[] = []): string[][] {
  if (ts.isIdentifier(name)) return [[...prefix, name.text]];
  const out: string[][] = [];
  name.elements.forEach((element, index) => {
    if (ts.isOmittedExpression(element)) return;
    const segment = element.propertyName ? propertyName(element.propertyName, sourceFile) : ts.isIdentifier(element.name) ? element.name.text : String(index);
    out.push(...bindingPaths(element.name, sourceFile, [...prefix, segment ?? String(index)]));
  });
  return out;
}

function declarationName(node: ts.Node, sourceFile: ts.SourceFile): string | null {
  if (ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node) || ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node) || ts.isEnumDeclaration(node)) {
    return node.name?.text ?? (hasModifier(node, ts.SyntaxKind.DefaultKeyword) ? "default" : null);
  }
  if (ts.isMethodDeclaration(node) || ts.isGetAccessorDeclaration(node) || ts.isSetAccessorDeclaration(node) || ts.isPropertyDeclaration(node)) return propertyName(node.name, sourceFile);
  if (ts.isConstructorDeclaration(node)) return "constructor";
  if (ts.isVariableDeclaration(node)) return ts.isIdentifier(node.name) ? node.name.text : null;
  return null;
}

function candidateKind(node: ts.Node, functionLike: ts.FunctionLikeDeclaration | null): SemanticSymbolKind | null {
  if (ts.isClassDeclaration(node) || ts.isClassExpression(node)) return "class";
  if (ts.isConstructorDeclaration(node)) return "constructor";
  if (ts.isMethodDeclaration(node) || ts.isGetAccessorDeclaration(node) || ts.isSetAccessorDeclaration(node)) return "method";
  if (ts.isInterfaceDeclaration(node)) return "interface";
  if (ts.isTypeAliasDeclaration(node)) return "type";
  if (ts.isEnumDeclaration(node)) return "enum";
  if (functionLike && ts.isArrowFunction(functionLike)) return "arrow";
  if (functionLike) return "function";
  if (ts.isVariableDeclaration(node)) return "variable";
  if (ts.isExportDeclaration(node) || ts.isExportAssignment(node)) return ts.isExportDeclaration(node) ? "reexport" : "variable";
  return null;
}

function variableKindOf(node: ts.Node): "const" | "let" | "var" | null {
  let current: ts.Node | undefined = node;
  while (current && !ts.isVariableDeclarationList(current)) current = current.parent;
  if (!current || !ts.isVariableDeclarationList(current)) return null;
  if (current.flags & ts.NodeFlags.Const) return "const";
  if (current.flags & ts.NodeFlags.Let) return "let";
  return "var";
}

function collectCandidates(sourceFile: ts.SourceFile, file: string): Candidate[] {
  const out: Candidate[] = [];
  const used = new Map<string, number>();
  const qualify = (scope: string | null, name: string): string => {
    const base = scope ? `${scope}.${name}` : name;
    const count = (used.get(base) ?? 0) + 1;
    used.set(base, count);
    return count === 1 ? base : `${base}~${count}`;
  };
  const add = (node: ts.Node, declarationNode: ts.Node, functionLike: ts.FunctionLikeDeclaration | null, name: string, scope: string | null, exported = isExported(declarationNode), defaultExport = hasModifier(declarationNode, ts.SyntaxKind.DefaultKeyword), kindOverride?: SemanticSymbolKind): Candidate => {
    const qualifiedName = qualify(scope, name);
    const kind = kindOverride ?? candidateKind(node, functionLike);
    if (!kind) throw new Error(`Unsupported semantic declaration ${ts.SyntaxKind[node.kind]}`);
    const candidate: Candidate = { sourceFile, file, node, declarationNode, functionLike, name, qualifiedName, parentQualifiedName: scope, kind, variableKind: variableKindOf(node), exported, defaultExport };
    out.push(candidate);
    return candidate;
  };

  const visit = (node: ts.Node, scope: string | null): void => {
    if (ts.isFunctionDeclaration(node)) {
      const name = declarationName(node, sourceFile);
      if (!name) return;
      const candidate = add(node, node, node, name, scope);
      node.parameters.forEach((parameter) => visit(parameter, candidate.qualifiedName));
      if (node.body) node.body.forEachChild((child) => visit(child, candidate.qualifiedName));
      return;
    }
    if (ts.isClassDeclaration(node)) {
      const name = declarationName(node, sourceFile);
      if (!name) return;
      const candidate = add(node, node, null, name, scope);
      for (const member of node.members) visit(member, candidate.qualifiedName);
      return;
    }
    if (ts.isConstructorDeclaration(node) || ts.isMethodDeclaration(node) || ts.isGetAccessorDeclaration(node) || ts.isSetAccessorDeclaration(node)) {
      const name = declarationName(node, sourceFile);
      if (!name) return;
      const candidate = add(node, node, node, name, scope, isExported(node.parent), false);
      node.parameters.forEach((parameter) => visit(parameter, candidate.qualifiedName));
      if (node.body) node.body.forEachChild((child) => visit(child, candidate.qualifiedName));
      return;
    }
    if (ts.isPropertyDeclaration(node) && node.initializer && (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer))) {
      const name = declarationName(node, sourceFile);
      if (!name) return;
      const candidate = add(node, node, node.initializer, name, scope, isExported(node.parent), false);
      node.initializer.parameters.forEach((parameter) => visit(parameter, candidate.qualifiedName));
      if (ts.isBlock(node.initializer.body)) node.initializer.body.forEachChild((child) => visit(child, candidate.qualifiedName));
      return;
    }
    if (ts.isVariableDeclaration(node)) {
      const name = declarationName(node, sourceFile);
      const init = node.initializer;
      if (name && init && (ts.isArrowFunction(init) || ts.isFunctionExpression(init))) {
        const candidate = add(node, node, init, name, scope);
        init.parameters.forEach((parameter) => visit(parameter, candidate.qualifiedName));
        if (ts.isBlock(init.body)) init.body.forEachChild((child) => visit(child, candidate.qualifiedName));
        return;
      }
      if (name && (isExported(node) || node.type)) add(node, node, null, name, scope);
      if (init) visit(init, scope);
      return;
    }
    if (ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node) || ts.isEnumDeclaration(node)) {
      const name = declarationName(node, sourceFile);
      if (name) add(node, node, null, name, scope);
      return;
    }
    if (ts.isExportDeclaration(node)) {
      if (!node.exportClause) add(node, node, null, "*", scope, true, false, "reexport");
      else if (ts.isNamedExports(node.exportClause)) {
        for (const element of node.exportClause.elements) {
          const localName = element.propertyName?.text ?? element.name.text;
          const local = !node.moduleSpecifier ? out.find((candidate) => candidate.parentQualifiedName === scope && candidate.name === localName) : undefined;
          if (local) local.exported = true;
          if (!local || element.name.text !== localName) add(element, node, null, element.name.text, scope, true, false, "reexport");
        }
      } else add(node.exportClause, node, null, node.exportClause.name.text, scope, true, false, "reexport");
      return;
    }
    if (ts.isExportAssignment(node)) {
      const expression = node.expression;
      if (ts.isArrowFunction(expression) || ts.isFunctionExpression(expression)) {
        const candidate = add(expression, node, expression, "default", scope, true, true);
        expression.parameters.forEach((parameter) => visit(parameter, candidate.qualifiedName));
        if (ts.isBlock(expression.body)) expression.body.forEachChild((child) => visit(child, candidate.qualifiedName));
      } else if (ts.isClassExpression(expression)) {
        const candidate = add(expression, node, null, expression.name?.text ?? "default", scope, true, true);
        for (const member of expression.members) visit(member, candidate.qualifiedName);
      }
      return;
    }
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
      const left = textOf(node.left, sourceFile);
      const match = /^(?:module\.exports|exports)\.([A-Za-z_$][\w$]*)$/.exec(left);
      if (match && (ts.isArrowFunction(node.right) || ts.isFunctionExpression(node.right) || ts.isClassExpression(node.right))) {
        const name = match[1] ?? "default";
        if (ts.isClassExpression(node.right)) {
          const candidate = add(node.right, node, null, name, scope, true, false);
          for (const member of node.right.members) visit(member, candidate.qualifiedName);
        } else {
          const candidate = add(node.right, node, node.right, name, scope, true, false);
          node.right.parameters.forEach((parameter) => visit(parameter, candidate.qualifiedName));
          if (ts.isBlock(node.right.body)) node.right.body.forEachChild((child) => visit(child, candidate.qualifiedName));
        }
        return;
      }
    }
    node.forEachChild((child) => visit(child, scope));
  };
  sourceFile.forEachChild((node) => visit(node, null));

  for (const statement of sourceFile.statements) {
    if (ts.isExportAssignment(statement) && ts.isIdentifier(statement.expression)) {
      const exportedName = statement.expression.text;
      const match = out.find((candidate) => candidate.parentQualifiedName === null && candidate.name === exportedName);
      if (match) {
        match.exported = true;
        match.defaultExport = true;
      } else add(statement, statement, null, exportedName, null, true, true, "variable");
    } else if (ts.isExportAssignment(statement) && !out.some((candidate) => candidate.declarationNode === statement)) {
      add(statement, statement, null, "default", null, true, true, "variable");
    }
    if (!ts.isExpressionStatement(statement) || !ts.isBinaryExpression(statement.expression)) continue;
    const expression = statement.expression;
    const left = textOf(expression.left, sourceFile);
    const match = /^(?:module\.exports|exports)\.([A-Za-z_$][\w$]*)$/.exec(left);
    if (!match || !ts.isIdentifier(expression.right)) continue;
    const localName = expression.right.text;
    const local = out.find((candidate) => candidate.parentQualifiedName === null && candidate.name === localName);
    if (local) local.exported = true;
  }
  return out.sort((a, b) => a.declarationNode.getStart(sourceFile) - b.declarationNode.getStart(sourceFile) || a.qualifiedName.localeCompare(b.qualifiedName));
}

function compilerOptions(root: string): ts.CompilerOptions {
  const configPath = ["tsconfig.json", "jsconfig.json"].map((name) => path.join(root, name)).find((file) => existsSync(file));
  let configured: ts.CompilerOptions = {};
  if (configPath) {
    const read = ts.readConfigFile(configPath, ts.sys.readFile);
    if (!read.error) configured = ts.parseJsonConfigFileContent(read.config, ts.sys, root).options;
  }
  return {
    ...configured,
    allowJs: true,
    checkJs: false,
    noEmit: true,
    target: configured.target ?? ts.ScriptTarget.ES2022,
    module: configured.module ?? ts.ModuleKind.NodeNext,
    moduleResolution: configured.moduleResolution ?? ts.ModuleResolutionKind.NodeNext,
    jsx: configured.jsx ?? ts.JsxEmit.Preserve,
    skipLibCheck: true,
  };
}

function createProgram(root: string, fileContents: ReadonlyMap<string, string>): ts.Program {
  const options = compilerOptions(root);
  const roots = [...fileContents.keys()].map((file) => path.resolve(root, file));
  const byAbsolute = new Map([...fileContents].map(([file, content]) => [path.resolve(root, file), content]));
  const host = ts.createCompilerHost(options, true);
  const originalRead = host.readFile.bind(host);
  const originalExists = host.fileExists.bind(host);
  host.fileExists = (fileName) => byAbsolute.has(path.resolve(fileName)) || originalExists(fileName);
  host.readFile = (fileName) => byAbsolute.get(path.resolve(fileName)) ?? originalRead(fileName);
  host.getSourceFile = (fileName, languageVersion) => {
    const text = host.readFile(fileName);
    const extension = path.extname(fileName).toLowerCase();
    const scriptKind = extension === ".tsx" ? ts.ScriptKind.TSX : extension === ".jsx" ? ts.ScriptKind.JSX : extension === ".js" || extension === ".mjs" || extension === ".cjs" ? ts.ScriptKind.JS : ts.ScriptKind.TS;
    return text === undefined ? undefined : ts.createSourceFile(fileName, text, languageVersion, true, scriptKind);
  };
  return ts.createProgram({ rootNames: roots, options, host });
}

function graphFiles(root: string, graph: RepoGraph, provided: ReadonlyMap<string, string> | undefined): { contents: Map<string, string>; roles: Map<string, Role> } {
  const contents = new Map<string, string>();
  const roles = new Map<string, Role>();
  for (const node of graph.nodes) {
    if (node.kind !== "file" || !JS_EXTENSIONS.has(path.extname(node.path).toLowerCase())) continue;
    const file = normalizePath(node.path);
    let content = provided?.get(file);
    if (content === undefined) {
      try {
        content = readFileSync(path.join(root, file), "utf8");
      } catch {
        continue;
      }
    }
    contents.set(file, content);
    roles.set(file, node.role);
  }
  return { contents, roles };
}

function fileContext(program: ts.Program, root: string, file: string, role: Role): FileContext | null {
  const sourceFile = program.getSourceFile(path.resolve(root, file));
  if (!sourceFile) return null;
  REPO_FILE_BY_SOURCE.set(sourceFile, file);
  return { file, sourceFile, role, candidates: collectCandidates(sourceFile, file) };
}

function emptyShape(kind: ValueShapeKind, reference: string | null = null): ValueShape {
  return { kind, fields: [], elements: [], variants: [], reference };
}

function declaredType(file: string, sourceFile: ts.SourceFile, typeNode: ts.TypeNode | undefined, source: DeclaredTypeSource = "typescript"): DeclaredType | null {
  if (!typeNode) return null;
  const text = ts.isJSDocTypeLiteral(typeNode) ? (typeNode.isArrayType ? "Array" : "Object") : textOf(typeNode, sourceFile);
  return { text, source, declaration: nodeSpan(file, sourceFile, typeNode) };
}

function jsdocParameterTypeNode(sourceFile: ts.SourceFile, parameter: ts.ParameterDeclaration): ts.TypeNode | null {
  const name = ts.isIdentifier(parameter.name) ? parameter.name.text : null;
  if (!name) return null;
  const tag = ts.getJSDocParameterTags(parameter).find((item) => item.name.getText(sourceFile) === name && item.typeExpression?.type);
  return tag?.typeExpression?.type ?? null;
}

function jsdocParameterType(file: string, sourceFile: ts.SourceFile, parameter: ts.ParameterDeclaration): DeclaredType | null {
  const typeNode = jsdocParameterTypeNode(sourceFile, parameter);
  return typeNode ? declaredType(file, sourceFile, typeNode, "jsdoc") : null;
}

function jsdocReturnType(file: string, sourceFile: ts.SourceFile, owner: ts.SignatureDeclaration): DeclaredType | null {
  const typeNode = ts.getJSDocReturnType(owner);
  return typeNode ? declaredType(file, sourceFile, typeNode, "jsdoc") : null;
}

function unwrappedTypeNode(node: ts.TypeNode): ts.TypeNode {
  let current = node;
  while (ts.isParenthesizedTypeNode(current)) current = current.type;
  return current;
}

function typeShape(typeNode: ts.TypeNode | undefined, sourceFile: ts.SourceFile, checker: ts.TypeChecker, seen = new Set<ts.Symbol>()): ValueShape | null {
  if (!typeNode) return null;
  const node = unwrappedTypeNode(typeNode);
  if (ts.isJSDocTypeLiteral(node)) {
    const shape = emptyShape(node.isArrayType ? "array" : "object");
    for (const tag of node.jsDocPropertyTags ?? []) {
      const parts = tag.name.getText(sourceFile).split(".").filter(Boolean);
      const name = parts.at(-1);
      if (!name) continue;
      const memberType = tag.typeExpression?.type;
      shape.fields.push({
        name,
        path: parts.length > 1 ? parts.slice(1) : [name],
        explicitType: memberType ? declaredType(normalizeSourceFile(sourceFile), sourceFile, memberType, "jsdoc") : null,
        shape: memberType ? typeShape(memberType, sourceFile, checker, new Set(seen)) : null,
        optional: Boolean(tag.isBracketed),
        source: nodeSpan(normalizeSourceFile(sourceFile), sourceFile, tag),
      });
    }
    return shape;
  }
  if (ts.isTypeLiteralNode(node)) {
    const shape = emptyShape("object");
    for (const member of node.members) {
      if (!ts.isPropertySignature(member) || !member.name) continue;
      const name = propertyName(member.name, sourceFile);
      if (!name) continue;
      shape.fields.push({
        name,
        path: [name],
        explicitType: declaredType(normalizeSourceFile(sourceFile), sourceFile, member.type),
        shape: typeShape(member.type, sourceFile, checker, new Set(seen)),
        optional: Boolean(member.questionToken),
        source: nodeSpan(normalizeSourceFile(sourceFile), sourceFile, member),
      });
    }
    return shape;
  }
  if (ts.isArrayTypeNode(node)) {
    const shape = emptyShape("array");
    const element = typeShape(node.elementType, sourceFile, checker, new Set(seen));
    if (element) shape.elements.push(element);
    return shape;
  }
  if (ts.isTupleTypeNode(node)) {
    const shape = emptyShape("tuple");
    for (const element of node.elements) {
      const value = typeShape(element, sourceFile, checker, new Set(seen));
      if (value) shape.elements.push(value);
    }
    return shape;
  }
  if (ts.isUnionTypeNode(node)) {
    const shape = emptyShape("union");
    for (const variant of node.types) {
      const value = typeShape(variant, sourceFile, checker, new Set(seen));
      if (value) shape.variants.push(value);
    }
    return shape;
  }
  if (ts.isTypeReferenceNode(node)) {
    const reference = textOf(node.typeName, sourceFile);
    if ((reference === "Promise" || reference === "Readonly" || reference === "Partial" || reference === "Required") && node.typeArguments?.[0]) {
      return typeShape(node.typeArguments[0], sourceFile, checker, seen);
    }
    const shape = emptyShape("reference", reference);
    let symbol = checker.getSymbolAtLocation(node.typeName);
    if (symbol && symbol.flags & ts.SymbolFlags.Alias) symbol = checker.getAliasedSymbol(symbol);
    if (!symbol || seen.has(symbol)) return shape;
    seen.add(symbol);
    for (const declaration of symbol.declarations ?? []) {
      if (ts.isInterfaceDeclaration(declaration)) {
        for (const member of declaration.members) {
          if (!ts.isPropertySignature(member) || !member.name) continue;
          const memberFile = declaration.getSourceFile();
          const name = propertyName(member.name, memberFile);
          if (!name) continue;
          shape.fields.push({
            name,
            path: [name],
            explicitType: declaredType(normalizeSourceFile(memberFile), memberFile, member.type, "referenced"),
            shape: typeShape(member.type, memberFile, checker, new Set(seen)),
            optional: Boolean(member.questionToken),
            source: nodeSpan(normalizeSourceFile(memberFile), memberFile, member),
          });
        }
        return shape;
      }
      if (ts.isTypeAliasDeclaration(declaration)) {
        const resolved = typeShape(declaration.type, declaration.getSourceFile(), checker, new Set(seen));
        if (resolved) {
          shape.fields = resolved.fields;
          shape.elements = resolved.elements;
          shape.variants = resolved.variants;
        }
        return shape;
      }
    }
    return shape;
  }
  if (
    node.kind === ts.SyntaxKind.StringKeyword ||
    node.kind === ts.SyntaxKind.NumberKeyword ||
    node.kind === ts.SyntaxKind.BooleanKeyword ||
    node.kind === ts.SyntaxKind.BigIntKeyword ||
    node.kind === ts.SyntaxKind.NullKeyword ||
    node.kind === ts.SyntaxKind.UndefinedKeyword ||
    ts.isLiteralTypeNode(node)
  ) {
    return emptyShape("scalar");
  }
  return emptyShape("unknown");
}

function normalizeSourceFile(sourceFile: ts.SourceFile): string {
  return REPO_FILE_BY_SOURCE.get(sourceFile) ?? normalizePath(sourceFile.fileName);
}

function mergeFields(target: ValueShape, fields: readonly ValueField[]): void {
  for (const field of fields) {
    const existing = target.fields.find((item) => item.name === field.name);
    if (!existing) {
      target.fields.push(field);
      continue;
    }
    if (!existing.shape && field.shape) existing.shape = field.shape;
    else if (existing.shape && field.shape && existing.shape.kind === "object" && field.shape.kind === "object") mergeFields(existing.shape, field.shape.fields);
    if (!existing.explicitType && field.explicitType) existing.explicitType = field.explicitType;
  }
}

function expressionShape(expression: ts.Expression | undefined, sourceFile: ts.SourceFile, checker: ts.TypeChecker, declared?: ts.TypeNode): ValueShape | null {
  if (declared) return typeShape(declared, sourceFile, checker);
  if (!expression) return null;
  let node = expression;
  while (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isTypeAssertionExpression(node) || ts.isSatisfiesExpression(node)) {
    if ((ts.isAsExpression(node) || ts.isTypeAssertionExpression(node) || ts.isSatisfiesExpression(node)) && node.type) return typeShape(node.type, sourceFile, checker);
    node = node.expression;
  }
  if (ts.isObjectLiteralExpression(node)) {
    const shape = emptyShape("object");
    for (const property of node.properties) {
      if (ts.isSpreadAssignment(property)) {
        shape.fields.push({ name: `...${textOf(property.expression, sourceFile)}`, path: [`...${textOf(property.expression, sourceFile)}`], explicitType: null, shape: null, optional: false, source: nodeSpan(normalizeSourceFile(sourceFile), sourceFile, property) });
        continue;
      }
      const name = propertyName(property.name, sourceFile);
      if (!name) continue;
      const value = ts.isPropertyAssignment(property) ? property.initializer : ts.isShorthandPropertyAssignment(property) ? property.name : undefined;
      shape.fields.push({
        name,
        path: [name],
        explicitType: null,
        shape: expressionShape(value, sourceFile, checker),
        optional: false,
        source: nodeSpan(normalizeSourceFile(sourceFile), sourceFile, property),
      });
    }
    return shape;
  }
  if (ts.isArrayLiteralExpression(node)) {
    const shape = emptyShape("array");
    for (const element of node.elements) {
      if (ts.isOmittedExpression(element)) continue;
      const value = expressionShape(element, sourceFile, checker);
      if (value) shape.elements.push(value);
    }
    return shape;
  }
  if (ts.isConditionalExpression(node)) {
    const shape = emptyShape("union");
    const yes = expressionShape(node.whenTrue, sourceFile, checker);
    const no = expressionShape(node.whenFalse, sourceFile, checker);
    if (yes) shape.variants.push(yes);
    if (no) shape.variants.push(no);
    return shape;
  }
  if (ts.isStringLiteralLike(node) || ts.isNumericLiteral(node) || node.kind === ts.SyntaxKind.TrueKeyword || node.kind === ts.SyntaxKind.FalseKeyword || node.kind === ts.SyntaxKind.NullKeyword) return emptyShape("scalar");
  return null;
}

function bindingShape(name: ts.BindingName, sourceFile: ts.SourceFile, checker: ts.TypeChecker): ValueShape | null {
  if (ts.isIdentifier(name)) return null;
  const shape = emptyShape(ts.isArrayBindingPattern(name) ? "array" : "object");
  name.elements.forEach((element, index) => {
    if (ts.isOmittedExpression(element)) return;
    const segment = element.propertyName ? propertyName(element.propertyName, sourceFile) : ts.isIdentifier(element.name) ? element.name.text : String(index);
    const child = bindingShape(element.name, sourceFile, checker);
    shape.fields.push({
      name: segment ?? String(index),
      path: [segment ?? String(index)],
      explicitType: null,
      shape: child,
      optional: Boolean(element.initializer),
      source: nodeSpan(normalizeSourceFile(sourceFile), sourceFile, element),
    });
  });
  return shape;
}

function parametersOf(candidate: Candidate, checker: ts.TypeChecker): ParameterRecord[] {
  const functionLike = candidate.functionLike;
  if (!functionLike) return [];
  return functionLike.parameters.map((parameter, index) => {
    const jsdocType = jsdocParameterTypeNode(candidate.sourceFile, parameter);
    const explicit = declaredType(candidate.file, candidate.sourceFile, parameter.type) ?? jsdocParameterType(candidate.file, candidate.sourceFile, parameter);
    const declaredShape = typeShape(parameter.type ?? jsdocType ?? undefined, candidate.sourceFile, checker);
    const destructuredShape = bindingShape(parameter.name, candidate.sourceFile, checker);
    if (declaredShape && destructuredShape && declaredShape.kind === "object") mergeFields(declaredShape, destructuredShape.fields);
    return {
      index,
      name: ts.isIdentifier(parameter.name) ? parameter.name.text : null,
      bindingPaths: bindingPaths(parameter.name, candidate.sourceFile),
      optional: Boolean(parameter.questionToken),
      rest: Boolean(parameter.dotDotDotToken),
      defaultExpression: parameter.initializer ? textOf(parameter.initializer, candidate.sourceFile) : null,
      explicitType: explicit,
      shape: declaredShape ?? destructuredShape,
      source: nodeSpan(candidate.file, candidate.sourceFile, parameter),
    };
  });
}

function returnTypeOf(candidate: Candidate): DeclaredType | null {
  const functionLike = candidate.functionLike;
  if (!functionLike) return null;
  return declaredType(candidate.file, candidate.sourceFile, functionLike.type) ?? jsdocReturnType(candidate.file, candidate.sourceFile, functionLike);
}

function returnShapeOf(candidate: Candidate, checker: ts.TypeChecker): ValueShape | null {
  const functionLike = candidate.functionLike;
  if (!functionLike) return null;
  return typeShape(functionLike.type ?? ts.getJSDocReturnType(functionLike) ?? undefined, candidate.sourceFile, checker);
}

function candidateFingerprint(candidate: Candidate): string {
  return createHash("sha256").update(candidate.sourceFile.text.slice(candidate.declarationNode.getStart(candidate.sourceFile), candidate.declarationNode.getEnd())).digest("hex");
}

function recordsFor(files: readonly FileContext[], checker: ts.TypeChecker): { records: SymbolRecord[]; byNode: Map<ts.Node, SymbolRecord> } {
  const records: SymbolRecord[] = [];
  const byNode = new Map<ts.Node, SymbolRecord>();
  for (const file of files) {
    const idByQualified = new Map(file.candidates.map((candidate) => [candidate.qualifiedName, semanticSymbolId(candidate.file, candidate.qualifiedName)]));
    for (const candidate of file.candidates) {
      const declaration = nodeSpan(candidate.file, candidate.sourceFile, candidate.declarationNode);
      const record: SymbolRecord = {
        id: semanticSymbolId(candidate.file, candidate.qualifiedName),
        file: candidate.file,
        name: candidate.name,
        qualifiedName: candidate.qualifiedName,
        parentSymbolId: candidate.parentQualifiedName ? idByQualified.get(candidate.parentQualifiedName) ?? null : null,
        kind: candidate.kind,
        variableKind: candidate.variableKind,
        exported: candidate.exported,
        defaultExport: candidate.defaultExport,
        async: Boolean(candidate.functionLike && hasModifier(candidate.functionLike, ts.SyntaxKind.AsyncKeyword)),
        generator: Boolean(candidate.functionLike && "asteriskToken" in candidate.functionLike && candidate.functionLike.asteriskToken),
        declaration,
        documentedDeclaration: spanOf(candidate.file, candidate.sourceFile, documentedStart(candidate.declarationNode, candidate.sourceFile), candidate.declarationNode.getEnd()),
        parameters: parametersOf(candidate, checker),
        explicitReturnType: returnTypeOf(candidate),
        returnVariants: [],
        validationIds: [],
        callerIds: [],
        calleeIds: [],
        fingerprint: candidateFingerprint(candidate),
      };
      records.push(record);
      byNode.set(candidate.node, record);
      byNode.set(candidate.declarationNode, record);
      if (candidate.functionLike) byNode.set(candidate.functionLike, record);
    }
  }
  records.sort((a, b) => a.file.localeCompare(b.file) || a.declaration.startOffset - b.declaration.startOffset || a.id.localeCompare(b.id));
  return { records, byNode };
}

function declarationRecord(symbol: ts.Symbol | undefined, checker: ts.TypeChecker, byNode: ReadonlyMap<ts.Node, SymbolRecord>): SymbolRecord | null {
  if (!symbol) return null;
  let resolved = symbol;
  if (resolved.flags & ts.SymbolFlags.Alias) {
    try {
      resolved = checker.getAliasedSymbol(resolved);
    } catch {
      return null;
    }
  }
  for (const declaration of resolved.declarations ?? []) {
    const direct = byNode.get(declaration);
    if (direct) return direct;
    if (!ts.isParameter(declaration) && !ts.isPropertySignature(declaration) && declaration.parent) {
      const parent = byNode.get(declaration.parent);
      if (parent) return parent;
    }
  }
  return null;
}

function symbolAtCall(call: ts.CallExpression | ts.NewExpression, checker: ts.TypeChecker): ts.Symbol | undefined {
  const expression = call.expression;
  if (ts.isPropertyAccessExpression(expression)) return checker.getSymbolAtLocation(expression.name) ?? checker.getSymbolAtLocation(expression);
  return checker.getSymbolAtLocation(expression);
}

function externalDeclaration(symbol: ts.Symbol | undefined, root: string): boolean {
  if (!symbol) return false;
  const declarations = symbol.declarations ?? [];
  if (declarations.length === 0) return false;
  return declarations.every((declaration) => {
    const fileName = path.resolve(declaration.getSourceFile().fileName);
    return !fileName.startsWith(`${path.resolve(root)}${path.sep}`) || fileName.includes(`${path.sep}node_modules${path.sep}`);
  });
}

function dynamicSymbol(symbol: ts.Symbol | undefined): boolean {
  return Boolean(symbol?.declarations?.some((declaration) => ts.isParameter(declaration) || ts.isPropertySignature(declaration) || ts.isMethodSignature(declaration)));
}

function explicitTypeForExpression(expression: ts.Expression, sourceFile: ts.SourceFile, checker: ts.TypeChecker): DeclaredType | null {
  let node = expression;
  while (ts.isParenthesizedExpression(node)) node = node.expression;
  if (ts.isAsExpression(node) || ts.isTypeAssertionExpression(node) || ts.isSatisfiesExpression(node)) return declaredType(normalizeSourceFile(sourceFile), sourceFile, node.type);
  if (!ts.isIdentifier(node) && !ts.isPropertyAccessExpression(node)) return null;
  let symbol = checker.getSymbolAtLocation(ts.isPropertyAccessExpression(node) ? node.name : node);
  if (symbol && symbol.flags & ts.SymbolFlags.Alias) symbol = checker.getAliasedSymbol(symbol);
  for (const declaration of symbol?.declarations ?? []) {
    if (ts.isVariableDeclaration(declaration) || ts.isParameter(declaration) || ts.isPropertyDeclaration(declaration) || ts.isPropertySignature(declaration)) {
      const typeNode = declaration.type;
      if (typeNode) return declaredType(normalizeSourceFile(declaration.getSourceFile()), declaration.getSourceFile(), typeNode, declaration.getSourceFile() === sourceFile ? "typescript" : "referenced");
    }
  }
  return null;
}

function callArguments(call: ts.CallExpression | ts.NewExpression, callee: SymbolRecord | null, sourceFile: ts.SourceFile, checker: ts.TypeChecker): ArgumentValue[] {
  return (call.arguments ?? []).map((argument, index) => {
    const expression = ts.isSpreadElement(argument) ? argument.expression : argument;
    const explicit = explicitTypeForExpression(expression, sourceFile, checker);
    return {
      index,
      parameterName: callee?.parameters[index]?.name ?? null,
      expression: textOf(expression, sourceFile),
      category: "argument",
      spread: ts.isSpreadElement(argument),
      explicitType: explicit,
      shape: expressionShape(expression, sourceFile, checker),
      source: nodeSpan(normalizeSourceFile(sourceFile), sourceFile, argument),
    };
  });
}

function collectCalls(ctx: BuildContext): { calls: CallSite[]; findings: CallFinding[] } {
  const calls: CallSite[] = [];
  const findings: CallFinding[] = [];
  const ordinalByCaller = new Map<string, number>();

  const walk = (node: ts.Node, owner: string, file: FileContext): void => {
    const record = ctx.recordByNode.get(node);
    let nextOwner = owner;
    if (record && (record.kind === "function" || record.kind === "arrow" || record.kind === "method" || record.kind === "constructor" || record.kind === "class")) nextOwner = record.id;

    if (ts.isCallExpression(node) || ts.isNewExpression(node)) {
      const symbol = symbolAtCall(node, ctx.checker);
      let callee = declarationRecord(symbol, ctx.checker, ctx.recordByNode);
      if (callee && ts.isNewExpression(node) && callee.kind === "class") callee = ctx.recordByQualified.get(`${callee.file}::${callee.qualifiedName}.constructor`) ?? callee;
      const resolution: CallResolution = callee ? "exact" : externalDeclaration(symbol, ctx.root) ? "external" : dynamicSymbol(symbol) ? "dynamic" : "unresolved";
      const ordinal = (ordinalByCaller.get(nextOwner) ?? 0) + 1;
      ordinalByCaller.set(nextOwner, ordinal);
      const id = `call:${nextOwner}:${ordinal}`;
      let boundary: ts.Node = node.parent;
      while (boundary.parent && !ts.isFunctionLike(boundary)) boundary = boundary.parent;
      const callback = ts.isFunctionLike(boundary) && !ctx.recordByNode.has(boundary)
        && !ctx.recordByNode.has(boundary.parent) ? nodeSpan(file.file, file.sourceFile, boundary) : null;
      const call: CallSite = {
        id,
        callerId: nextOwner,
        calleeId: callee?.id ?? null,
        expression: textOf(node, file.sourceFile),
        calleeExpression: textOf(node.expression, file.sourceFile),
        resolution,
        arguments: callArguments(node, callee, file.sourceFile, ctx.checker),
        source: nodeSpan(file.file, file.sourceFile, node),
        condition: ancestorCondition(node, boundary, file.sourceFile),
        callback,
      };
      calls.push(call);
      if (!callee) {
        const kind: CallFindingKind = resolution === "external" ? "external-call" : resolution === "dynamic" ? "dynamic-dispatch" : "unresolved-call";
        const reason = resolution === "external" ? "The declaration is outside the tracked first-party files." : resolution === "dynamic" ? "The target is supplied through a parameter or structural member and cannot be proven statically." : "The compiler could not connect this call to a tracked declaration.";
        findings.push({ id: `finding:${id}:${kind}`, callSiteId: id, kind, expression: call.calleeExpression, reason, source: call.source });
      }
      if ((node.arguments ?? []).some((argument) => ts.isArrowFunction(argument) || ts.isFunctionExpression(argument))) {
        findings.push({
          id: `finding:${id}:unresolved-callback`,
          callSiteId: id,
          kind: "unresolved-callback",
          expression: call.expression,
          reason: "An inline callback has no durable named symbol; calls inside it remain attributed to the enclosing symbol.",
          source: call.source,
        });
      }
    }
    node.forEachChild((child) => walk(child, nextOwner, file));
  };

  for (const file of ctx.files) walk(file.sourceFile, `file:${file.file}`, file);
  for (const call of calls) {
    if (!call.calleeId) continue;
    const callee = ctx.recordById.get(call.calleeId);
    const caller = ctx.recordById.get(call.callerId);
    if (callee) callee.callerIds = unique([...callee.callerIds, call.callerId]);
    if (caller) caller.calleeIds = unique([...caller.calleeIds, call.calleeId]);
  }
  return { calls, findings };
}

/** Only native JSX events and imported React effects are labelled as triggers. */
function collectClientTriggers(ctx: BuildContext, calls: readonly CallSite[]): ClientTrigger[] {
  const triggers: ClientTrigger[] = [];
  for (const file of ctx.files) {
    const add = (node: ts.Node, expression: ts.Expression, kind: ClientTrigger["kind"], event: string, label: string): void => {
      const inline = ts.isArrowFunction(expression) || ts.isFunctionExpression(expression);
      const target = inline ? null : recordForExpression(expression, ctx);
      const source = nodeSpan(file.file, file.sourceFile, node);
      const callSiteIds = inline ? calls.filter((call) => call.source.file === file.file && call.callback?.startOffset === expression.getStart(file.sourceFile)).map((call) => call.id) : [];
      if (target || callSiteIds.length) triggers.push({ id: `client:${file.file}:${source.startOffset}`, kind, event, label, targetSymbolId: target?.id ?? null, callSiteIds, source });
    };
    const visit = (node: ts.Node): void => {
      if (ts.isJsxAttribute(node) && /^on[A-Z]/.test(node.name.getText(file.sourceFile)) && node.initializer && ts.isJsxExpression(node.initializer) && node.initializer.expression) {
        const opening = node.parent.parent;
        if (ts.isJsxOpeningElement(opening) || ts.isJsxSelfClosingElement(opening)) {
          const tag = opening.tagName.getText(file.sourceFile);
          if (/^[a-z][a-z0-9-]*$/.test(tag)) {
            const event = node.name.getText(file.sourceFile);
            const aria = opening.attributes.properties.find((attribute): attribute is ts.JsxAttribute => ts.isJsxAttribute(attribute) && attribute.name.getText(file.sourceFile) === "aria-label");
            const name = aria?.initializer && ts.isStringLiteral(aria.initializer) ? aria.initializer.text : tag;
            const verb = event === "onSubmit" ? "Submit" : event === "onClick" ? "Click" : event.slice(2);
            add(node, node.initializer.expression, "ui-event", event, `${verb} ${name}`);
          }
        }
      }
      if (ts.isCallExpression(node) && node.arguments[0]) {
        const expr = node.expression;
        const symbol = ctx.checker.getSymbolAtLocation(ts.isPropertyAccessExpression(expr) ? expr.expression : expr);
        const imported = symbol?.declarations?.some((declaration) => {
          let ancestor: ts.Node | undefined = declaration;
          while (ancestor && !ts.isImportDeclaration(ancestor)) ancestor = ancestor.parent;
          if (!ancestor || !ts.isStringLiteral(ancestor.moduleSpecifier) || ancestor.moduleSpecifier.text !== "react") return false;
          const name = ts.isImportSpecifier(declaration) ? (ts.isIdentifier(expr) ? (declaration.propertyName ?? declaration.name).text : "") : ts.isPropertyAccessExpression(expr) ? expr.name.text : "";
          return name === "useEffect" || name === "useLayoutEffect";
        });
        if (imported) add(node, node.arguments[0], "react-effect", "effect", "React effect");
      }
      node.forEachChild(visit);
    };
    file.sourceFile.forEachChild(visit);
  }
  return triggers;
}

function responseDetails(expression: ts.Expression, sourceFile: ts.SourceFile, checker: ts.TypeChecker): { kind: ReturnVariantKind; shape: ValueShape | null; status: string | null } {
  let call: ts.CallExpression | ts.NewExpression | null = null;
  if (ts.isCallExpression(expression) || ts.isNewExpression(expression)) call = expression;
  if (!call) return { kind: "return", shape: expressionShape(expression, sourceFile, checker), status: null };
  const callee = textOf(call.expression, sourceFile).replace(/\s+/g, "");
  const http = /^(?:Response|[A-Za-z_$][\w$]*)\.(?:json|redirect)$/.test(callee) || (ts.isNewExpression(call) && callee === "Response");
  if (!http) return { kind: "return", shape: expressionShape(expression, sourceFile, checker), status: null };
  const args = call.arguments ?? [];
  let payload = args[0];
  if (payload && ts.isCallExpression(payload) && textOf(payload.expression, sourceFile).replace(/\s+/g, "") === "JSON.stringify") payload = payload.arguments[0];
  let status: string | null = callee === "Response.redirect" ? "redirect" : null;
  const options = args[1];
  if (options && ts.isObjectLiteralExpression(options)) {
    const property = options.properties.find((item): item is ts.PropertyAssignment => ts.isPropertyAssignment(item) && propertyName(item.name, sourceFile) === "status");
    if (property) status = textOf(property.initializer, sourceFile);
  } else if (options) status = textOf(options, sourceFile);
  return { kind: "http-response", shape: expressionShape(payload, sourceFile, checker), status };
}

function ancestorCondition(node: ts.Node, boundary: ts.Node, sourceFile: ts.SourceFile): string | null {
  const conditions: string[] = [];
  let current: ts.Node | undefined = node.parent;
  while (current && current !== boundary) {
    if (ts.isIfStatement(current)) {
      const inElse = current.elseStatement && node.pos >= current.elseStatement.pos && node.end <= current.elseStatement.end;
      const inThen = node.pos >= current.thenStatement.pos && node.end <= current.thenStatement.end;
      if (inElse || inThen) conditions.push(inElse ? `not (${textOf(current.expression, sourceFile)})` : textOf(current.expression, sourceFile));
    }
    current = current.parent;
  }
  return conditions.length > 0 ? conditions.reverse().join(" and ") : null;
}

function collectReturns(ctx: BuildContext): ReturnVariant[] {
  const out: ReturnVariant[] = [];
  for (const file of ctx.files) {
    for (const candidate of file.candidates) {
      const record = ctx.recordById.get(semanticSymbolId(candidate.file, candidate.qualifiedName));
      const functionLike = candidate.functionLike;
      if (!record || !functionLike) continue;
      const declaredReturnShape = returnShapeOf(candidate, ctx.checker);
      let ordinal = 0;
      const push = (kind: ReturnVariantKind, expression: ts.Expression | null, sourceNode: ts.Node, condition: string | null): void => {
        ordinal += 1;
        const details = expression ? responseDetails(expression, file.sourceFile, ctx.checker) : { kind, shape: null, status: null };
        out.push({
          id: `return:${record.id}:${ordinal}`,
          symbolId: record.id,
          kind: expression ? details.kind : kind,
          expression: expression ? textOf(expression, file.sourceFile) : "undefined",
          condition,
          status: expression ? details.status : null,
          explicitType: record.explicitReturnType,
          shape: expression ? details.shape ?? declaredReturnShape : declaredReturnShape,
          source: nodeSpan(file.file, file.sourceFile, sourceNode),
        });
      };
      if (ts.isArrowFunction(functionLike) && !ts.isBlock(functionLike.body)) push("implicit", functionLike.body, functionLike.body, null);
      else if (functionLike.body) {
        const visit = (node: ts.Node): void => {
          if (node !== functionLike.body && ctx.recordByNode.has(node)) return;
          if (ts.isReturnStatement(node)) {
            push("return", node.expression ?? null, node, ancestorCondition(node, functionLike.body ?? functionLike, file.sourceFile));
            return;
          }
          node.forEachChild(visit);
        };
        functionLike.body.forEachChild(visit);
      }
      const variants = out.filter((item) => item.symbolId === record.id);
      record.returnVariants = variants;
    }
  }
  return out;
}

function accessPath(expression: ts.Expression, sourceFile: ts.SourceFile): string[] | null {
  if (ts.isIdentifier(expression)) return [expression.text];
  if (ts.isPropertyAccessExpression(expression)) {
    const base = accessPath(expression.expression, sourceFile);
    return base ? [...base, expression.name.text] : null;
  }
  if (ts.isElementAccessExpression(expression) && expression.argumentExpression && ts.isStringLiteralLike(expression.argumentExpression)) {
    const base = accessPath(expression.expression, sourceFile);
    return base ? [...base, expression.argumentExpression.text] : null;
  }
  return null;
}

function pathsIn(node: ts.Node, sourceFile: ts.SourceFile): string[][] {
  const paths: string[][] = [];
  const visit = (child: ts.Node): void => {
    if (ts.isPropertyAccessExpression(child) || ts.isElementAccessExpression(child)) {
      const pathValue = accessPath(child, sourceFile);
      if (pathValue && pathValue.length > 1) paths.push(pathValue);
    }
    child.forEachChild(visit);
  };
  visit(node);
  return paths.filter((value, index) => !paths.some((other, otherIndex) => otherIndex !== index && other.length > value.length && value.every((segment, i) => other[i] === segment)));
}

function collectValidations(ctx: BuildContext): ValidationRule[] {
  const out: ValidationRule[] = [];
  for (const file of ctx.files) {
    for (const candidate of file.candidates) {
      const record = ctx.recordById.get(semanticSymbolId(candidate.file, candidate.qualifiedName));
      const body = candidate.functionLike?.body;
      if (!record || !body) continue;
      let ordinal = 0;
      const add = (kind: ValidationKind, node: ts.Node, expression: ts.Node): void => {
        ordinal += 1;
        const id = `validation:${record.id}:${ordinal}`;
        out.push({ id, symbolId: record.id, kind, expression: textOf(expression, file.sourceFile), fieldPaths: pathsIn(expression, file.sourceFile), source: nodeSpan(file.file, file.sourceFile, node) });
        record.validationIds.push(id);
      };
      const visit = (node: ts.Node): void => {
        if (node !== body && ctx.recordByNode.has(node)) return;
        if (ts.isIfStatement(node)) add("guard", node.expression, node.expression);
        if (ts.isCallExpression(node)) {
          const name = textOf(node.expression, file.sourceFile);
          if (/(?:^|\.)(?:parse|safeParse|validate|assert|check)$/.test(name)) add(/assert/.test(name) ? "assertion" : "schema", node, node);
        }
        node.forEachChild(visit);
      };
      body.forEachChild(visit);
    }
  }
  return out;
}

function routeSegment(segment: string): string | null {
  if (/^\(.*\)$/.test(segment)) return null;
  if (/^\[\[.*\]\]$/.test(segment)) return "*";
  const dynamic = /^\[(\.\.\.)?(.+)\]$/.exec(segment);
  return dynamic ? (dynamic[1] ? "*" : `:${dynamic[2] ?? ""}`) : segment;
}

function joinRoute(segments: readonly string[]): string {
  const kept = segments.map(routeSegment).filter((segment): segment is string => Boolean(segment));
  return kept.length === 0 ? "/" : `/${kept.join("/")}`;
}

function cloudflarePath(file: string): string | null {
  const normalized = normalizePath(file);
  if (!normalized.startsWith("functions/")) return null;
  const relative = normalized.slice("functions/".length).replace(/\.[^.\/]+$/, "");
  const segments = relative.split("/");
  if (segments.at(-1) === "index") segments.pop();
  return joinRoute(segments);
}

function nextPath(file: string): string | null {
  const normalized = normalizePath(file);
  const appMatch = /^(?:src\/)?app\/(.*)\/(?:route|page)\.[^.]+$/.exec(normalized);
  if (appMatch) return joinRoute((appMatch[1] ?? "").split("/"));
  const rootPage = /^(?:src\/)?app\/(?:route|page)\.[^.]+$/.exec(normalized);
  if (rootPage) return "/";
  const pageMatch = /^(?:src\/)?pages\/(.*)\.[^.]+$/.exec(normalized);
  if (!pageMatch) return null;
  const segments = (pageMatch[1] ?? "").split("/");
  if (segments.at(-1) === "index") segments.pop();
  return joinRoute(segments);
}

function staticStringFromSymbol(symbol: ts.Symbol, checker: ts.TypeChecker, seen: ReadonlySet<ts.Symbol>): string | null {
  if (symbol.flags & ts.SymbolFlags.Alias) symbol = checker.getAliasedSymbol(symbol);
  if (seen.has(symbol)) return null;
  const nextSeen = new Set(seen).add(symbol);
  const values = new Set<string>();
  for (const declaration of symbol.declarations ?? (symbol.valueDeclaration ? [symbol.valueDeclaration] : [])) {
    if (ts.isShorthandPropertyAssignment(declaration)) {
      const valueSymbol = checker.getShorthandAssignmentValueSymbol(declaration);
      const value = valueSymbol ? staticStringFromSymbol(valueSymbol, checker, nextSeen) : null;
      if (value !== null) values.add(value);
      continue;
    }
    let initializer: ts.Expression | undefined;
    if (ts.isVariableDeclaration(declaration)) {
      const declarationList = declaration.parent;
      if (!ts.isVariableDeclarationList(declarationList) || !(declarationList.flags & ts.NodeFlags.Const)) continue;
      initializer = declaration.initializer;
    } else if (ts.isPropertyAssignment(declaration) || ts.isPropertyDeclaration(declaration) || ts.isEnumMember(declaration) || ts.isBindingElement(declaration)) {
      initializer = declaration.initializer;
    }
    const value = staticString(initializer, checker, nextSeen);
    if (value !== null) values.add(value);
  }
  return values.size === 1 ? [...values][0] ?? null : null;
}

function staticString(expression: ts.Expression | undefined, checker?: ts.TypeChecker, seen: ReadonlySet<ts.Symbol> = new Set()): string | null {
  if (!expression) return null;
  if (ts.isStringLiteralLike(expression) || ts.isNoSubstitutionTemplateLiteral(expression)) return expression.text;
  if (ts.isParenthesizedExpression(expression) || ts.isAsExpression(expression) || ts.isTypeAssertionExpression(expression) || ts.isNonNullExpression(expression) || ts.isSatisfiesExpression(expression)) {
    return staticString(expression.expression, checker, seen);
  }
  if (ts.isTemplateExpression(expression)) {
    let value = expression.head.text;
    for (const span of expression.templateSpans) {
      const part = staticString(span.expression, checker, seen);
      if (part === null) return null;
      value += part + span.literal.text;
    }
    return value;
  }
  if (ts.isBinaryExpression(expression) && expression.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    const left = staticString(expression.left, checker, seen);
    const right = staticString(expression.right, checker, seen);
    return left === null || right === null ? null : left + right;
  }
  if (!checker) return null;
  let symbol: ts.Symbol | undefined;
  if (ts.isPropertyAccessExpression(expression)) symbol = checker.getSymbolAtLocation(expression.name);
  else if (ts.isElementAccessExpression(expression)) {
    const key = staticString(expression.argumentExpression, checker, seen);
    if (key !== null) symbol = checker.getTypeAtLocation(expression.expression).getProperty(key);
  } else symbol = checker.getSymbolAtLocation(expression);
  if (!symbol) return null;
  return staticStringFromSymbol(symbol, checker, seen);
}

function recordForExpression(expression: ts.Expression, ctx: BuildContext): SymbolRecord | null {
  let symbol = ctx.checker.getSymbolAtLocation(ts.isPropertyAccessExpression(expression) ? expression.name : expression);
  if (symbol && symbol.flags & ts.SymbolFlags.Alias) symbol = ctx.checker.getAliasedSymbol(symbol);
  return declarationRecord(symbol, ctx.checker, ctx.recordByNode);
}

function pathShape(paths: readonly string[][]): ValueShape | null {
  if (paths.length === 0) return null;
  const root = emptyShape("object");
  for (const fullPath of paths) {
    let shape = root;
    fullPath.forEach((segment, index) => {
      let field = shape.fields.find((item) => item.name === segment);
      if (!field) {
        field = { name: segment, path: fullPath.slice(0, index + 1), explicitType: null, shape: index < fullPath.length - 1 ? emptyShape("object") : null, optional: false, source: null };
        shape.fields.push(field);
      }
      if (index < fullPath.length - 1) {
        if (!field.shape || field.shape.kind !== "object") field.shape = emptyShape("object");
        shape = field.shape;
      }
    });
  }
  return root;
}

function isRequestBodyExpression(expression: ts.Expression, sourceFile: ts.SourceFile): boolean {
  let node = expression;
  while (ts.isAwaitExpression(node) || ts.isParenthesizedExpression(node)) node = node.expression;
  if (ts.isPropertyAccessExpression(node)) return /(?:^|\.)(?:body|data)$/.test(textOf(node, sourceFile));
  return ts.isCallExpression(node) && /(?:^|\.)(?:json|body)$/.test(textOf(node.expression, sourceFile));
}

function requestShapeFor(candidate: Candidate, ctx: BuildContext): ValueShape | null {
  const body = candidate.functionLike?.body;
  if (!body) return null;
  const shape = emptyShape("object");
  let found = false;
  const payloadBindings = new Map<string, ValueShape | null>();
  const visitBindings = (node: ts.Node): void => {
    if (node !== body && ctx.recordByNode.has(node)) return;
    if (ts.isVariableDeclaration(node) && node.initializer && isRequestBodyExpression(node.initializer, candidate.sourceFile)) {
      const explicit = node.type ? typeShape(node.type, candidate.sourceFile, ctx.checker) : null;
      if (ts.isIdentifier(node.name)) payloadBindings.set(node.name.text, explicit);
      else {
        const destructured = bindingShape(node.name, candidate.sourceFile, ctx.checker);
        if (destructured) {
          mergeFields(shape, destructured.fields);
          found = true;
        }
      }
      if (explicit?.fields.length) {
        mergeFields(shape, explicit.fields);
        found = true;
      }
    }
    if (
      ts.isBinaryExpression(node)
      && node.operatorToken.kind === ts.SyntaxKind.EqualsToken
      && ts.isIdentifier(node.left)
      && isRequestBodyExpression(node.right, candidate.sourceFile)
    ) {
      payloadBindings.set(node.left.text, null);
    }
    node.forEachChild(visitBindings);
  };
  body.forEachChild(visitBindings);
  for (const [binding, explicit] of payloadBindings) {
    const paths: string[][] = [];
    const visitUses = (node: ts.Node): void => {
      if (node !== body && ctx.recordByNode.has(node)) return;
      if (ts.isVariableDeclaration(node) && !ts.isIdentifier(node.name) && node.initializer && ts.isIdentifier(node.initializer) && node.initializer.text === binding) {
        for (const leaf of bindingLeaves(node.name, candidate.sourceFile)) paths.push(leaf.path);
      }
      if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) {
        const full = accessPath(node, candidate.sourceFile);
        if (full?.[0] === binding && full.length > 1) paths.push(full.slice(1));
      }
      node.forEachChild(visitUses);
    };
    body.forEachChild(visitUses);
    const accessed = pathShape(paths);
    if (explicit?.fields.length) mergeFields(shape, explicit.fields);
    if (accessed?.fields.length) mergeFields(shape, accessed.fields);
    if (explicit?.fields.length || accessed?.fields.length) found = true;
  }
  return found ? shape : null;
}

function methodFromOptions(expression: ts.Expression | undefined, sourceFile: ts.SourceFile, checker: ts.TypeChecker): string {
  if (!expression || !ts.isObjectLiteralExpression(expression)) return "GET";
  const property = expression.properties.find((item): item is ts.PropertyAssignment => ts.isPropertyAssignment(item) && propertyName(item.name, sourceFile) === "method");
  return staticString(property?.initializer, checker)?.toUpperCase() ?? "GET";
}

function bodyShapeFromOptions(expression: ts.Expression | undefined, sourceFile: ts.SourceFile, checker: ts.TypeChecker): ValueShape | null {
  if (!expression || !ts.isObjectLiteralExpression(expression)) return null;
  const property = expression.properties.find((item): item is ts.PropertyAssignment => ts.isPropertyAssignment(item) && propertyName(item.name, sourceFile) === "body");
  if (!property) return null;
  let body = property.initializer;
  if (ts.isCallExpression(body) && textOf(body.expression, sourceFile).replace(/\s+/g, "") === "JSON.stringify" && body.arguments[0]) body = body.arguments[0];
  return expressionShape(body, sourceFile, checker);
}

function collectRoutes(ctx: BuildContext, calls: readonly CallSite[]): RouteRecord[] {
  const routes: RouteRecord[] = [];
  const routeByKey = new Map<string, RouteRecord>();
  const addRoute = (record: RouteRecord): void => {
    const key = `${record.method}:${record.path}`;
    const existing = routeByKey.get(key);
    if (!existing) {
      routeByKey.set(key, record);
      routes.push(record);
      return;
    }
    if (!existing.handlerSymbolId && record.handlerSymbolId) existing.handlerSymbolId = record.handlerSymbolId;
    existing.middlewareSymbolIds = unique([...existing.middlewareSymbolIds, ...record.middlewareSymbolIds]);
    existing.responseVariants = [...existing.responseVariants, ...record.responseVariants].filter((item, index, all) => all.findIndex((other) => other.id === item.id) === index);
    if (!existing.requestShape && record.requestShape) existing.requestShape = record.requestShape;
  };

  for (const file of ctx.files) {
    for (const candidate of file.candidates) {
      if (candidate.parentQualifiedName !== null) continue;
      const symbol = ctx.recordById.get(semanticSymbolId(file.file, candidate.qualifiedName));
      if (!symbol || !candidate.functionLike) continue;
      const cloudflare = cloudflarePath(file.file);
      const cloudflareMethod = candidate.name === "onRequest" ? "ANY" : /^onRequest([A-Z][A-Za-z]*)$/.exec(candidate.name)?.[1]?.toUpperCase();
      if (cloudflare && cloudflareMethod && (cloudflareMethod === "ANY" || HTTP_METHODS.has(cloudflareMethod))) {
        addRoute({ id: routeRecordId(cloudflareMethod, cloudflare), kind: "cloudflare", method: cloudflareMethod, path: cloudflare, handlerSymbolId: symbol.id, middlewareSymbolIds: [], clientCalls: [], requestShape: requestShapeFor(candidate, ctx), responseVariants: symbol.returnVariants.filter((item) => item.kind === "http-response"), source: symbol.declaration });
      }
      const next = nextPath(file.file);
      if (next && HTTP_METHODS.has(candidate.name.toUpperCase())) {
        const method = candidate.name.toUpperCase();
        addRoute({ id: routeRecordId(method, next), kind: "next", method, path: next, handlerSymbolId: symbol.id, middlewareSymbolIds: [], clientCalls: [], requestShape: requestShapeFor(candidate, ctx), responseVariants: symbol.returnVariants.filter((item) => item.kind === "http-response"), source: symbol.declaration });
      }
    }

    const visit = (node: ts.Node): void => {
      if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
        const method = node.expression.name.text.toUpperCase();
        const routePath = staticString(node.arguments[0], ctx.checker);
        if (HTTP_METHODS.has(method) && routePath) {
          const handlers = node.arguments.slice(1).map((argument) => recordForExpression(argument, ctx)).filter((item): item is SymbolRecord => item !== null);
          const handler = handlers.at(-1) ?? null;
          const middleware = handlers.slice(0, -1);
          const sourceText = file.sourceFile.text.slice(0, Math.min(file.sourceFile.text.length, 2000));
          const kind: RouteKind = /\bHono\b/.test(sourceText) ? "hono" : "express";
          const handlerCandidate = handler
            ? ctx.files.flatMap((item) => item.candidates).find((candidate) => semanticSymbolId(candidate.file, candidate.qualifiedName) === handler.id)
            : undefined;
          addRoute({
            id: routeRecordId(method, routePath),
            kind,
            method,
            path: routePath,
            handlerSymbolId: handler?.id ?? null,
            middlewareSymbolIds: middleware.map((item) => item.id),
            clientCalls: [],
            requestShape: handlerCandidate ? requestShapeFor(handlerCandidate, ctx) : null,
            responseVariants: handler?.returnVariants.filter((item) => item.kind === "http-response") ?? [],
            source: nodeSpan(file.file, file.sourceFile, node),
          });
        }
      }
      node.forEachChild(visit);
    };
    file.sourceFile.forEachChild(visit);
  }

  const callByStart = new Map(calls.map((call) => [`${call.source.file}:${call.source.startOffset}`, call]));
  for (const file of ctx.files) {
    const visit = (node: ts.Node): void => {
      if (ts.isCallExpression(node) && textOf(node.expression, file.sourceFile) === "fetch") {
        const routePath = staticString(node.arguments[0], ctx.checker);
        if (routePath) {
          const method = methodFromOptions(node.arguments[1], file.sourceFile, ctx.checker);
          const call = callByStart.get(`${file.file}:${node.getStart(file.sourceFile)}`);
          const route = routeByKey.get(`${method}:${routePath}`) ?? [...routeByKey.values()].find((item) => item.path === routePath);
          if (call && route) {
            route.clientCalls.push({ callSiteId: call.id, callerId: call.callerId, method, path: routePath, requestShape: bodyShapeFromOptions(node.arguments[1], file.sourceFile, ctx.checker), source: call.source });
          }
        }
      }
      node.forEachChild(visit);
    };
    file.sourceFile.forEachChild(visit);
  }
  for (const route of routes) route.clientCalls.sort((a, b) => a.source.file.localeCompare(b.source.file) || a.source.startLine - b.source.startLine);
  return routes.sort((a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method));
}

interface BindingLeaf {
  identifier: ts.Identifier;
  path: string[];
}

function bindingLeaves(name: ts.BindingName, sourceFile: ts.SourceFile, prefix: string[] = []): BindingLeaf[] {
  if (ts.isIdentifier(name)) return [{ identifier: name, path: prefix.length > 0 ? prefix : [name.text] }];
  const out: BindingLeaf[] = [];
  name.elements.forEach((element, index) => {
    if (ts.isOmittedExpression(element)) return;
    const segment = element.propertyName ? propertyName(element.propertyName, sourceFile) : ts.isIdentifier(element.name) ? element.name.text : String(index);
    out.push(...bindingLeaves(element.name, sourceFile, [...prefix, segment ?? String(index)]));
  });
  return out;
}

function ownerRecord(node: ts.Node, ctx: BuildContext, file: string): string {
  let current: ts.Node | undefined = node;
  while (current) {
    const record = ctx.recordByNode.get(current);
    if (record && (record.kind === "function" || record.kind === "arrow" || record.kind === "method" || record.kind === "constructor")) return record.id;
    if (ts.isSourceFile(current)) break;
    current = current.parent;
  }
  return `file:${file}`;
}

function collectConceptEvidence(ctx: BuildContext, calls: readonly CallSite[], returns: readonly ReturnVariant[], validations: readonly ValidationRule[], routes: readonly RouteRecord[]): ConceptEvidence {
  const occurrences: ConceptOccurrence[] = [];
  const links: ConceptLink[] = [];
  const occurrenceById = new Map<string, ConceptOccurrence>();
  const occurrenceBySymbol = new Map<ts.Symbol, string>();
  const parameterOccurrence = new Map<string, string>();
  const returnOccurrence = new Map<string, string>();
  const routeIdsBySymbol = new Map<string, string[]>();
  for (const route of routes) {
    if (!route.handlerSymbolId) continue;
    routeIdsBySymbol.set(route.handlerSymbolId, unique([...(routeIdsBySymbol.get(route.handlerSymbolId) ?? []), route.id]));
  }

  const addOccurrence = (occurrence: ConceptOccurrence): string => {
    const existing = occurrenceById.get(occurrence.id);
    if (existing) return existing.id;
    occurrenceById.set(occurrence.id, occurrence);
    occurrences.push(occurrence);
    return occurrence.id;
  };
  const symbolForIdentifier = (identifier: ts.Identifier): ts.Symbol | undefined => {
    let symbol = ctx.checker.getSymbolAtLocation(identifier);
    if (symbol && symbol.flags & ts.SymbolFlags.Alias) symbol = ctx.checker.getAliasedSymbol(symbol);
    return symbol;
  };

  for (const file of ctx.files) {
    for (const candidate of file.candidates) {
      const record = ctx.recordById.get(semanticSymbolId(file.file, candidate.qualifiedName));
      const functionLike = candidate.functionLike;
      if (!record || !functionLike) continue;
      functionLike.parameters.forEach((parameter, index) => {
        const param = record.parameters[index];
        for (const leaf of bindingLeaves(parameter.name, file.sourceFile)) {
          const pathValue = ts.isIdentifier(parameter.name) ? [leaf.identifier.text] : leaf.path;
          const id = `occ:${record.id}:parameter:${index}:${pathValue.join(".")}`;
          addOccurrence({
            id,
            name: leaf.identifier.text,
            path: pathValue,
            kind: "parameter",
            source: { file: file.file, line: lineOf(file.sourceFile, leaf.identifier.getStart(file.sourceFile)), endLine: lineOf(file.sourceFile, leaf.identifier.getEnd() - 1) },
            symbolId: record.id,
            explicitType: param?.explicitType?.text ?? null,
            validationIds: [],
            routeIds: routeIdsBySymbol.get(record.id) ?? [],
          });
          const symbol = symbolForIdentifier(leaf.identifier);
          if (symbol) occurrenceBySymbol.set(symbol, id);
          if (!parameterOccurrence.has(`${record.id}:${index}`)) parameterOccurrence.set(`${record.id}:${index}`, id);
        }
      });
    }

    const visitVariables = (node: ts.Node): void => {
      if (ts.isVariableDeclaration(node)) {
        const owner = ownerRecord(node, ctx, file.file);
        for (const leaf of bindingLeaves(node.name, file.sourceFile)) {
          const id = `occ:${owner}:binding:${leaf.identifier.text}:${lineOf(file.sourceFile, leaf.identifier.getStart(file.sourceFile))}`;
          addOccurrence({
            id,
            name: leaf.identifier.text,
            path: leaf.path,
            kind: leaf.path.length > 1 ? "field" : "binding",
            source: { file: file.file, line: lineOf(file.sourceFile, leaf.identifier.getStart(file.sourceFile)), endLine: lineOf(file.sourceFile, leaf.identifier.getEnd() - 1) },
            symbolId: owner.startsWith("sym:") ? owner : null,
            explicitType: node.type ? textOf(node.type, file.sourceFile) : null,
            validationIds: [],
            routeIds: owner.startsWith("sym:") ? routeIdsBySymbol.get(owner) ?? [] : [],
          });
          const symbol = symbolForIdentifier(leaf.identifier);
          if (symbol) occurrenceBySymbol.set(symbol, id);
        }
      }
      node.forEachChild(visitVariables);
    };
    file.sourceFile.forEachChild(visitVariables);
  }

  for (const variant of returns) {
    const id = `occ:${variant.id}`;
    returnOccurrence.set(variant.id, id);
    addOccurrence({
      id,
      name: "return",
      path: ["return"],
      kind: variant.kind === "http-response" ? "response" : "return",
      source: { file: variant.source.file, line: variant.source.startLine, endLine: variant.source.endLine },
      symbolId: variant.symbolId,
      explicitType: variant.explicitType?.text ?? null,
      validationIds: [],
      routeIds: routeIdsBySymbol.get(variant.symbolId) ?? [],
    });
  }

  const expressionOccurrence = (expression: ts.Expression, owner: string, file: FileContext): string | null => {
    let node = expression;
    while (ts.isParenthesizedExpression(node) || ts.isAwaitExpression(node) || ts.isAsExpression(node) || ts.isTypeAssertionExpression(node) || ts.isSatisfiesExpression(node)) node = node.expression;
    if (ts.isIdentifier(node)) {
      const symbol = symbolForIdentifier(node);
      const known = symbol ? occurrenceBySymbol.get(symbol) : undefined;
      if (known) return known;
      const id = `occ:${owner}:reference:${node.text}:${lineOf(file.sourceFile, node.getStart(file.sourceFile))}`;
      return addOccurrence({ id, name: node.text, path: [node.text], kind: "binding", source: { file: file.file, line: lineOf(file.sourceFile, node.getStart(file.sourceFile)) }, symbolId: owner.startsWith("sym:") ? owner : null, explicitType: explicitTypeForExpression(node, file.sourceFile, ctx.checker)?.text ?? null, validationIds: [], routeIds: owner.startsWith("sym:") ? routeIdsBySymbol.get(owner) ?? [] : [] });
    }
    const pathValue = accessPath(node, file.sourceFile);
    if (pathValue && pathValue.length > 1) {
      const root = ts.isIdentifier(node) ? node : (() => {
        let current: ts.Expression = node;
        while (ts.isPropertyAccessExpression(current) || ts.isElementAccessExpression(current)) current = current.expression;
        return ts.isIdentifier(current) ? current : null;
      })();
      const rootSymbol = root ? symbolForIdentifier(root) : undefined;
      const rootOccurrence = rootSymbol ? occurrenceBySymbol.get(rootSymbol) : undefined;
      const base = rootOccurrence ?? `${owner}:${pathValue[0]}`;
      const id = `occ:${base}:field:${pathValue.slice(1).join(".")}`;
      return addOccurrence({ id, name: pathValue.at(-1) ?? pathValue[0] ?? "field", path: pathValue, kind: "field", source: { file: file.file, line: lineOf(file.sourceFile, node.getStart(file.sourceFile)) }, symbolId: owner.startsWith("sym:") ? owner : null, explicitType: explicitTypeForExpression(node, file.sourceFile, ctx.checker)?.text ?? null, validationIds: [], routeIds: owner.startsWith("sym:") ? routeIdsBySymbol.get(owner) ?? [] : [] });
    }
    return null;
  };
  const fieldOccurrence = (base: ts.Expression, fieldPath: string[], owner: string, file: FileContext): string | null => {
    const baseOccurrence = expressionOccurrence(base, owner, file);
    const basePath = accessPath(base, file.sourceFile) ?? [textOf(base, file.sourceFile)];
    const id = `occ:${baseOccurrence ?? `${owner}:${basePath.join(".")}`}:field:${fieldPath.join(".")}`;
    return addOccurrence({
      id,
      name: fieldPath.at(-1) ?? basePath.at(-1) ?? "field",
      path: [...basePath, ...fieldPath],
      kind: "field",
      source: { file: file.file, line: lineOf(file.sourceFile, base.getStart(file.sourceFile)) },
      symbolId: owner.startsWith("sym:") ? owner : null,
      explicitType: null,
      validationIds: [],
      routeIds: owner.startsWith("sym:") ? routeIdsBySymbol.get(owner) ?? [] : [],
    });
  };

  const callByStart = new Map(calls.map((call) => [`${call.source.file}:${call.source.startOffset}`, call]));
  const returnByStart = new Map(returns.map((variant) => [`${variant.source.file}:${variant.source.startOffset}`, variant]));
  const sourceFor = (file: FileContext, node: ts.Node): { file: string; line: number } => ({ file: file.file, line: lineOf(file.sourceFile, node.getStart(file.sourceFile)) });
  const addLink = (from: string | null, to: string | null, kind: ConceptLink["kind"], file: FileContext, node: ts.Node, transformation: string | null = null): void => {
    if (!from || !to || from === to) return;
    links.push({ from, to, kind, source: sourceFor(file, node), transformation });
  };

  for (const file of ctx.files) {
    const visit = (node: ts.Node): void => {
      const owner = ownerRecord(node, ctx, file.file);
      if (ts.isVariableDeclaration(node) && node.initializer) {
        const targets = bindingLeaves(node.name, file.sourceFile).map((leaf) => {
          const symbol = symbolForIdentifier(leaf.identifier);
          return { leaf, occurrence: symbol ? occurrenceBySymbol.get(symbol) ?? null : null };
        });
        if (!ts.isIdentifier(node.name)) {
          for (const target of targets) {
            const source = fieldOccurrence(node.initializer, target.leaf.path, owner, file);
            addLink(source, target.occurrence, "destructure", file, node);
          }
        } else if (ts.isCallExpression(node.initializer) || ts.isNewExpression(node.initializer)) {
          const call = callByStart.get(`${file.file}:${node.initializer.getStart(file.sourceFile)}`);
          if (call?.calleeId) {
            for (const variant of returns.filter((item) => item.symbolId === call.calleeId)) addLink(returnOccurrence.get(variant.id) ?? null, targets[0]?.occurrence ?? null, "return-assignment", file, node);
          }
        } else {
          addLink(expressionOccurrence(node.initializer, owner, file), targets[0]?.occurrence ?? null, "assignment", file, node);
        }
      }
      if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken && ts.isExpression(node.left) && ts.isExpression(node.right)) {
        addLink(expressionOccurrence(node.right, owner, file), expressionOccurrence(node.left, owner, file), "assignment", file, node);
      }
      if (ts.isCallExpression(node) || ts.isNewExpression(node)) {
        const call = callByStart.get(`${file.file}:${node.getStart(file.sourceFile)}`);
        if (call?.calleeId) {
          (node.arguments ?? []).forEach((argument, index) => {
            const expression = ts.isSpreadElement(argument) ? argument.expression : argument;
            let source = expressionOccurrence(expression, owner, file);
            if (!source) {
              const argumentRecord = call.arguments[index];
              const name = argumentRecord?.parameterName ?? `argument${index + 1}`;
              source = addOccurrence({
                id: `occ:${call.id}:argument:${index}`,
                name,
                path: [name],
                kind: "binding",
                source: { file: file.file, line: lineOf(file.sourceFile, argument.getStart(file.sourceFile)) },
                symbolId: owner.startsWith("sym:") ? owner : null,
                explicitType: argumentRecord?.explicitType?.text ?? null,
                validationIds: [],
                routeIds: owner.startsWith("sym:") ? routeIdsBySymbol.get(owner) ?? [] : [],
              });
            }
            addLink(source, parameterOccurrence.get(`${call.calleeId}:${index}`) ?? null, "argument-parameter", file, argument);
          });
        }
      }
      if (ts.isReturnStatement(node) && node.expression) {
        const variant = returnByStart.get(`${file.file}:${node.getStart(file.sourceFile)}`);
        if (variant) addLink(expressionOccurrence(node.expression, owner, file), returnOccurrence.get(variant.id) ?? null, "return-assignment", file, node);
      }
      node.forEachChild(visit);
    };
    file.sourceFile.forEachChild(visit);
  }

  for (const validation of validations) {
    for (const occurrence of occurrences) {
      if (occurrence.symbolId !== validation.symbolId) continue;
      if (validation.fieldPaths.some((pathValue) => occurrence.path.at(-1) === pathValue.at(-1))) occurrence.validationIds = unique([...occurrence.validationIds, validation.id]);
    }
  }
  return { occurrences, links };
}

function buildContext(root: string, contents: ReadonlyMap<string, string>, roles: ReadonlyMap<string, Role>): BuildContext {
  const program = createProgram(root, contents);
  const checker = program.getTypeChecker();
  const files = [...contents.keys()]
    .sort((a, b) => a.localeCompare(b))
    .map((file) => fileContext(program, root, file, roles.get(file) ?? "source"))
    .filter((file): file is FileContext => file !== null);
  const built = recordsFor(files, checker);
  const recordById = new Map(built.records.map((record) => [record.id, record]));
  const recordByQualified = new Map(built.records.map((record) => [`${record.file}::${record.qualifiedName}`, record]));
  return { root, checker, files, recordByNode: built.byNode, recordById, recordByQualified };
}

/** Parse one file with the same compiler-backed declaration and call model as the repository index. */
export function analyzeSemanticSource(file: string, content: string): { symbols: SymbolRecord[]; calls: CallSite[]; findings: CallFinding[] } {
  const normalized = normalizePath(file);
  const contents = new Map([[normalized, content]]);
  const roles = new Map<string, Role>([[normalized, "source"]]);
  const root = process.cwd();
  const ctx = buildContext(root, contents, roles);
  collectReturns(ctx);
  const calls = collectCalls(ctx);
  return {
    symbols: [...ctx.recordById.values()].sort((a, b) => a.declaration.startOffset - b.declaration.startOffset || a.id.localeCompare(b.id)),
    calls: calls.calls,
    findings: calls.findings,
  };
}

/** Parse one file's declarations without exposing the repository builder. */
export function semanticDeclarations(file: string, content: string): SymbolRecord[] {
  return analyzeSemanticSource(file, content).symbols;
}

function reachabilityRoots(graph: RepoGraph, files: readonly SemanticFileRecord[], symbols: readonly SymbolRecord[], routes: readonly RouteRecord[]): Partial<Record<CodeRole, string[]>> {
  const roots: Partial<Record<CodeRole, string[]>> = { production: [], test: [], script: [], migration: [], generated: [] };
  const fileByPath = new Map(files.map((file) => [file.file, file]));
  for (const route of routes) if (route.handlerSymbolId) roots.production?.push(route.handlerSymbolId);
  for (const node of graph.nodes) {
    if (node.kind !== "file") continue;
    const file = fileByPath.get(node.path);
    if (!file) continue;
    if (file.codeRole === "test" || file.codeRole === "script" || file.codeRole === "migration" || file.codeRole === "generated") {
      roots[file.codeRole]?.push(file.file);
      // These roles are invoked by runners and frameworks outside the ordinary import
      // graph. Their exported declarations are therefore role roots, not dead leaves.
      for (const symbol of symbols) if (symbol.file === file.file && symbol.exported) roots[file.codeRole]?.push(symbol.id);
    }
    if (file.codeRole === "production" && node.entry) {
      roots.production?.push(file.file);
      for (const symbol of symbols) if (symbol.file === file.file && symbol.exported) roots.production?.push(symbol.id);
    }
  }
  for (const role of Object.keys(roots) as CodeRole[]) roots[role] = unique(roots[role] ?? []);
  return roots;
}

/** Build the durable JavaScript/TypeScript code-intelligence model for one tracked repository. */
export function buildSemanticIndex(paths: { root: string; concepts?: string }, graph: RepoGraph, options: BuildSemanticIndexOptions = {}): SemanticIndex {
  const scanned = graphFiles(paths.root, graph, options.contents);
  const ctx = buildContext(paths.root, scanned.contents, scanned.roles);
  const symbols = [...ctx.recordById.values()];
  const callResult = collectCalls(ctx);
  const returns = collectReturns(ctx);
  const validations = collectValidations(ctx);
  const routes = collectRoutes(ctx, callResult.calls);
  const conceptEvidence = collectConceptEvidence(ctx, callResult.calls, returns, validations, routes);
  const staticConcepts = buildDataConcepts(conceptEvidence);
  const concepts = paths.concepts ? applyConceptOverrides(staticConcepts, readConceptOverrides({ concepts: paths.concepts })).concepts : staticConcepts;
  const files: SemanticFileRecord[] = ctx.files.map((file) => ({
    file: file.file,
    role: file.role,
    codeRole: codeRoleOf(file.file, file.role),
    symbols: symbols.filter((symbol) => symbol.file === file.file).map((symbol) => symbol.id),
    fingerprint: createHash("sha256").update(file.sourceFile.text).digest("hex"),
  }));
  const imports = graph.edges
    .filter((edge) => (edge.kind === "import" || edge.kind === "tests") && scanned.contents.has(edge.source) && scanned.contents.has(edge.target))
    .map((edge) => ({ source: edge.source, target: edge.target }));
  const reachability = analyzeReachability({
    files: files.map((file) => ({ file: file.file, role: file.role })),
    symbols: symbols.map((symbol) => ({ id: symbol.id, file: symbol.file })),
    calls: callResult.calls.map((call) => ({ caller: call.callerId, callee: call.calleeId })),
    imports,
    roots: reachabilityRoots(graph, files, symbols, routes),
  });
  return {
    files: files.sort((a, b) => a.file.localeCompare(b.file)),
    symbols,
    calls: callResult.calls,
    findings: callResult.findings,
    validations,
    routes,
    staticConcepts,
    concepts,
    reachability,
    generatedAt: (options.now ?? new Date()).toISOString(),
    clientTriggers: collectClientTriggers(ctx, callResult.calls),
  };
}
