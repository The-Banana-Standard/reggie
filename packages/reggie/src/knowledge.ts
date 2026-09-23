import { createHash, randomUUID } from "node:crypto";
import {
  closeSync,
  existsSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { currentBranch, defaultBranch, git, gitCommonDir } from "./git.js";
import { parseNoteFile, resolveNoteTarget, type NoteEntry, type NoteKind } from "./notes.js";
import type { RepoPaths } from "./paths.js";
import type { ReggieConfig } from "./people.js";
import { ensureDir, readText, relPosix, splitFrontMatter, upsertFrontMatter } from "./util.js";

export const CURRENT_START = "<!-- reggie:knowledge:current:start -->";
export const CURRENT_END = "<!-- reggie:knowledge:current:end -->";
const UPDATE_PREFIX = "<!-- reggie:knowledge:update:";
const UPDATE_SUFFIX = " -->";
const MAX_CURRENT_ITEMS = 500;
const MAX_TEXT = 4_000;
const LOCK_STALE_MS = 10 * 60 * 1_000;

export type KnowledgeKind = "repo" | "folder" | "file" | "symbol" | "route" | "concept" | "service" | "store" | "environment";
export type KnowledgeActor = "human" | "codex" | "claude" | "migration";

export interface KnowledgeDescription {
  /** Stable parameter, field, return-variant, or call-site identity. */
  id: string;
  description: string;
  /** Only a source-declared type. `null` means not declared. */
  explicitType: string | null;
}

/** The one replaceable block ordinary UI and agent narration consume. */
export interface KnowledgeCurrent {
  summary: string;
  parameters: KnowledgeDescription[];
  fields: KnowledgeDescription[];
  returns: KnowledgeDescription[];
  callSites: KnowledgeDescription[];
}

/** Immutable audit entry appended whenever current knowledge or lifecycle state changes. */
export interface KnowledgeUpdate {
  at: string;
  actor: KnowledgeActor;
  by: string;
  codeRevision: string;
  changedFields: string[];
  reason: string;
  priorRevision: string;
  revision: string;
}

export interface KnowledgeRecord {
  entity: string;
  kind: KnowledgeKind;
  file: string;
  current: KnowledgeCurrent | null;
  notes: NoteEntry[];
  history: KnowledgeUpdate[];
  fingerprint: string | null;
  currentFingerprint: string | null;
  stale: boolean;
  revision: string;
  retired: boolean;
  supersededBy: string | null;
}

export interface KnowledgeEdit {
  entity: string;
  expectedRevision: string;
  current: KnowledgeCurrent;
  fingerprint: string;
  actor: KnowledgeActor;
  by: string;
  codeRevision: string;
  reason: string;
}

export interface KnowledgeRetirement {
  entity: string;
  expectedRevision: string;
  retired: boolean;
  supersededBy: string | null;
  actor: KnowledgeActor;
  by: string;
  codeRevision: string;
  reason: string;
}

export interface KnowledgeCommitResult {
  commit: string;
  records: KnowledgeRecord[];
  files: string[];
}

interface PreparedWrite {
  file: string;
  content: string;
  entity: string;
  currentFingerprint: string | null;
}

function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function frontFields(content: string): Map<string, string> {
  const fields = new Map<string, string>();
  const { front } = splitFrontMatter(content);
  for (const line of (front ?? "").split("\n")) {
    const match = /^([a-z][a-z-]*):\s*(.*)$/.exec(line.trim());
    if (match?.[1]) fields.set(match[1], match[2] ?? "");
  }
  return fields;
}

function kindFor(entity: string, noteKind: NoteKind): KnowledgeKind {
  if (noteKind === "repo") return "repo";
  if (noteKind === "dir") return "folder";
  if (noteKind === "file") return "file";
  if (noteKind === "symbol") return "symbol";
  const prefix = entity.split(":", 1)[0] ?? "concept";
  if (prefix === "env" || prefix === "environment") return "environment";
  if (prefix === "route" || prefix === "concept" || prefix === "service" || prefix === "store") return prefix;
  return "concept";
}

function locateCurrent(content: string): { start: number; end: number; json: string } | null {
  const start = content.indexOf(CURRENT_START);
  if (start < 0) return null;
  const endMarker = content.indexOf(CURRENT_END, start + CURRENT_START.length);
  if (endMarker < 0) throw new Error("Knowledge current block has no closing marker.");
  const blockEnd = endMarker + CURRENT_END.length;
  let json = content.slice(start + CURRENT_START.length, endMarker).trim();
  const fenced = /^```json\s*\n([\s\S]*?)\n```$/.exec(json);
  if (fenced?.[1] !== undefined) json = fenced[1];
  return { start, end: blockEnd, json };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, allowed: readonly string[], label: string): void {
  const extras = Object.keys(value).filter((key) => !allowed.includes(key));
  if (extras.length > 0) throw new Error(`${label} has unsupported fields: ${extras.join(", ")}`);
}

function boundedString(value: unknown, label: string, allowEmpty = false): string {
  if (typeof value !== "string") throw new Error(`${label} must be text.`);
  const text = value.trim();
  if (!allowEmpty && !text) throw new Error(`${label} must not be empty.`);
  if (text.length > MAX_TEXT) throw new Error(`${label} exceeds ${MAX_TEXT} characters.`);
  return text;
}

function descriptions(value: unknown, label: string): KnowledgeDescription[] {
  if (!Array.isArray(value)) throw new Error(`${label} must be a list.`);
  if (value.length > MAX_CURRENT_ITEMS) throw new Error(`${label} exceeds ${MAX_CURRENT_ITEMS} items.`);
  const seen = new Set<string>();
  return value.map((item, index) => {
    if (!isObject(item)) throw new Error(`${label}[${index}] must be an object.`);
    exactKeys(item, ["id", "description", "explicitType"], `${label}[${index}]`);
    const id = boundedString(item.id, `${label}[${index}].id`);
    if (seen.has(id)) throw new Error(`${label} repeats id "${id}".`);
    seen.add(id);
    const explicitType = item.explicitType === null ? null : boundedString(item.explicitType, `${label}[${index}].explicitType`);
    return { id, description: boundedString(item.description, `${label}[${index}].description`), explicitType };
  });
}

/** Strict validation shared by human edits and both local-agent adapters. */
export function validateKnowledgeCurrent(value: unknown): KnowledgeCurrent {
  if (!isObject(value)) throw new Error("Knowledge current understanding must be an object.");
  exactKeys(value, ["summary", "parameters", "fields", "returns", "callSites"], "Knowledge current understanding");
  return {
    summary: boundedString(value.summary, "summary"),
    parameters: descriptions(value.parameters, "parameters"),
    fields: descriptions(value.fields, "fields"),
    returns: descriptions(value.returns, "returns"),
    callSites: descriptions(value.callSites, "callSites"),
  };
}

function decodeUpdates(content: string): KnowledgeUpdate[] {
  const updates: KnowledgeUpdate[] = [];
  const escaped = UPDATE_PREFIX.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`${escaped}([A-Za-z0-9_-]+)${UPDATE_SUFFIX}`, "g");
  for (const match of content.matchAll(re)) {
    try {
      const parsed = JSON.parse(Buffer.from(match[1] ?? "", "base64url").toString("utf8")) as unknown;
      if (!isObject(parsed)) continue;
      if (typeof parsed.at !== "string" || typeof parsed.actor !== "string" || typeof parsed.by !== "string" || typeof parsed.codeRevision !== "string" || !Array.isArray(parsed.changedFields) || typeof parsed.reason !== "string" || typeof parsed.priorRevision !== "string" || typeof parsed.revision !== "string") continue;
      if (!["human", "codex", "claude", "migration"].includes(parsed.actor)) continue;
      updates.push({
        at: parsed.at,
        actor: parsed.actor as KnowledgeActor,
        by: parsed.by,
        codeRevision: parsed.codeRevision,
        changedFields: parsed.changedFields.filter((field): field is string => typeof field === "string"),
        reason: parsed.reason,
        priorRevision: parsed.priorRevision,
        revision: parsed.revision,
      });
    } catch {
      // A malformed historical marker is ignored. It never becomes current narration.
    }
  }
  return updates;
}

/** Read one record. Legacy note-only files become records with `current: null`. */
export function readKnowledge(paths: RepoPaths, entity: string, currentFingerprint: string | null = null): KnowledgeRecord | null {
  const target = resolveNoteTarget(paths, entity);
  const content = readText(target.file);
  if (content === null) return null;
  const note = parseNoteFile(target.file, content, { entity: target.entity, kind: target.kind });
  const fields = frontFields(content);
  const currentBlock = locateCurrent(content);
  let current: KnowledgeCurrent | null = null;
  if (currentBlock) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(currentBlock.json);
    } catch (error) {
      throw new Error(`Knowledge current block for ${note.entity} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
    }
    current = validateKnowledgeCurrent(parsed);
  }
  const fingerprint = fields.get("fingerprint") || null;
  const retired = fields.get("retired") === "true";
  const storedRevision = fields.get("knowledge-revision");
  const revision = storedRevision || `legacy-${digest(content).slice(0, 20)}`;
  return {
    entity: note.entity,
    kind: kindFor(note.entity, note.kind),
    file: target.file,
    current,
    notes: note.entries,
    history: decodeUpdates(content),
    fingerprint,
    currentFingerprint,
    stale: Boolean(current && fingerprint && currentFingerprint && fingerprint !== currentFingerprint),
    revision,
    retired,
    supersededBy: fields.get("superseded-by") || null,
  };
}

export function currentKnowledge(record: KnowledgeRecord | null): KnowledgeCurrent | null {
  return record && !record.retired ? record.current : null;
}

function baseContent(paths: RepoPaths, entity: string): { target: ReturnType<typeof resolveNoteTarget>; content: string; record: KnowledgeRecord | null } {
  const target = resolveNoteTarget(paths, entity);
  const content = readText(target.file) ?? `---\nentity: ${target.entity}\nkind: ${target.kind}\n---\n\n`;
  return { target, content, record: readKnowledge(paths, entity) };
}

function changedFields(previous: KnowledgeCurrent | null, next: KnowledgeCurrent): string[] {
  const keys: Array<keyof KnowledgeCurrent> = ["summary", "parameters", "fields", "returns", "callSites"];
  return keys.filter((key) => JSON.stringify(previous?.[key] ?? null) !== JSON.stringify(next[key]));
}

function replaceCurrent(content: string, current: KnowledgeCurrent): string {
  const block = `${CURRENT_START}\n\`\`\`json\n${JSON.stringify(current, null, 2)}\n\`\`\`\n${CURRENT_END}`;
  const located = locateCurrent(content);
  if (located) return `${content.slice(0, located.start)}${block}${content.slice(located.end)}`;
  const { front, body } = splitFrontMatter(content);
  const header = front === null ? "---\n---" : `---\n${front}\n---`;
  return `${header}\n\n${block}\n\n${body.replace(/^\n+/, "")}`;
}

function appendUpdate(content: string, update: KnowledgeUpdate): string {
  const encoded = Buffer.from(JSON.stringify(update), "utf8").toString("base64url");
  return `${content.trimEnd()}\n\n${UPDATE_PREFIX}${encoded}${UPDATE_SUFFIX}\n`;
}

function newRevision(entity: string, previous: string, current: KnowledgeCurrent | null, at: string, actor: string, lifecycle: string): string {
  return digest(JSON.stringify({ entity, previous, current, at, actor, lifecycle })).slice(0, 24);
}

function assertExpected(entity: string, record: KnowledgeRecord | null, expected: string): void {
  const actual = record?.revision ?? "missing";
  if (actual !== expected) throw new Error(`Knowledge revision conflict for ${entity}: expected ${expected}, current revision is ${actual}. Reload before saving.`);
}

function prepareEdit(paths: RepoPaths, input: KnowledgeEdit, now: Date): PreparedWrite {
  const { target, content, record } = baseContent(paths, input.entity);
  assertExpected(target.entity, record, input.expectedRevision);
  const current = validateKnowledgeCurrent(input.current);
  const at = now.toISOString();
  const revision = newRevision(target.entity, input.expectedRevision, current, at, input.actor, "active");
  const update: KnowledgeUpdate = {
    at,
    actor: input.actor,
    by: boundedString(input.by, "by"),
    codeRevision: boundedString(input.codeRevision, "codeRevision"),
    changedFields: changedFields(record?.current ?? null, current),
    reason: boundedString(input.reason, "reason"),
    priorRevision: input.expectedRevision,
    revision,
  };
  let next = replaceCurrent(content, current);
  next = upsertFrontMatter(next, {
    entity: target.entity,
    kind: target.kind,
    fingerprint: boundedString(input.fingerprint, "fingerprint"),
    "knowledge-revision": revision,
    retired: "false",
    "superseded-by": "",
  });
  next = appendUpdate(next, update);
  return { file: target.file, content: next, entity: target.entity, currentFingerprint: input.fingerprint };
}

function prepareRetirement(paths: RepoPaths, input: KnowledgeRetirement, now: Date): PreparedWrite {
  const { target, content, record } = baseContent(paths, input.entity);
  if (!record) throw new Error(`No knowledge exists for ${target.entity}.`);
  assertExpected(target.entity, record, input.expectedRevision);
  if (input.supersededBy) resolveNoteTarget(paths, input.supersededBy);
  const at = now.toISOString();
  const revision = newRevision(target.entity, input.expectedRevision, record.current, at, input.actor, input.retired ? `retired:${input.supersededBy ?? ""}` : "active");
  const update: KnowledgeUpdate = {
    at,
    actor: input.actor,
    by: boundedString(input.by, "by"),
    codeRevision: boundedString(input.codeRevision, "codeRevision"),
    changedFields: ["retired", "supersededBy"],
    reason: boundedString(input.reason, "reason"),
    priorRevision: input.expectedRevision,
    revision,
  };
  let next = upsertFrontMatter(content, {
    "knowledge-revision": revision,
    retired: input.retired ? "true" : "false",
    "superseded-by": input.supersededBy ?? "",
  });
  next = appendUpdate(next, update);
  return { file: target.file, content: next, entity: target.entity, currentFingerprint: record.currentFingerprint };
}

export function knowledgeLockFile(root: string): string {
  return path.join(gitCommonDir(root), "reggie-knowledge.lock");
}

interface KnowledgeLock {
  release(): void;
}

function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

function acquireKnowledgeLock(root: string): KnowledgeLock {
  const file = knowledgeLockFile(root);
  const token = randomUUID();
  const body = { token, pid: process.pid, at: new Date().toISOString() };
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const fd = openSync(file, "wx", 0o600);
      writeFileSync(fd, `${JSON.stringify(body)}\n`, "utf8");
      closeSync(fd);
      return {
        release: () => {
          try {
            const current = JSON.parse(readFileSync(file, "utf8")) as { token?: string };
            if (current.token === token) unlinkSync(file);
          } catch {
            // Never remove a lock we cannot prove belongs to this transaction.
          }
        },
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      let held: { pid?: number; at?: string } = {};
      try {
        held = JSON.parse(readFileSync(file, "utf8")) as { pid?: number; at?: string };
      } catch {
        // A creator may still be writing. Treat an unreadable fresh lock as live.
      }
      const age = held.at ? Date.now() - Date.parse(held.at) : 0;
      if ((held.pid && processAlive(held.pid) && age < LOCK_STALE_MS) || attempt > 0) {
        throw new Error(`Another knowledge write holds the repository lock${held.pid ? ` (pid ${held.pid})` : ""}. Try again after it finishes.`);
      }
      const aside = `${file}.${token}.stale`;
      try {
        renameSync(file, aside);
        rmSync(aside, { force: true });
      } catch {
        throw new Error("Another knowledge write changed the repository lock. Try again.");
      }
    }
  }
  throw new Error("Could not acquire the repository knowledge lock.");
}

function assertIntegrationCheckout(root: string, config: ReggieConfig): string {
  const integration = defaultBranch(root, config.defaultBranch);
  const branch = currentBranch(root);
  if (branch !== integration) throw new Error(`Knowledge writes must run from the configured integration checkout (${integration}); current branch is ${branch}.`);
  if (!/^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(branch) || branch.includes("..") || branch.endsWith("/")) throw new Error("The configured integration branch is not a safe Git ref.");
  return branch;
}

function dirtyTargets(root: string, files: string[]): string[] {
  if (files.length === 0) return [];
  const result = git(["status", "--porcelain=v1", "-z", "--untracked-files=all", "--", ...files], { cwd: root, allowFailure: true });
  return result.stdout.split("\0").filter(Boolean);
}

function writeAtomically(writes: PreparedWrite[]): { restore(): void; discard(): void } {
  const backups = new Map<string, string | null>();
  const temps: string[] = [];
  try {
    for (const write of writes) {
      backups.set(write.file, readText(write.file));
      ensureDir(path.dirname(write.file));
      const temp = path.join(path.dirname(write.file), `.${path.basename(write.file)}.${randomUUID()}.tmp`);
      writeFileSync(temp, write.content, { encoding: "utf8", mode: 0o600, flag: "wx" });
      temps.push(temp);
    }
    writes.forEach((write, index) => renameSync(temps[index] as string, write.file));
  } catch (error) {
    for (const temp of temps) rmSync(temp, { force: true });
    for (const [file, original] of backups) {
      if (original === null) rmSync(file, { force: true });
      else {
        const temp = `${file}.${randomUUID()}.tmp`;
        writeFileSync(temp, original, "utf8");
        renameSync(temp, file);
      }
    }
    throw error;
  }
  return {
    restore: () => {
      for (const [file, original] of backups) {
        if (original === null) rmSync(file, { force: true });
        else {
          const temp = `${file}.${randomUUID()}.tmp`;
          writeFileSync(temp, original, "utf8");
          renameSync(temp, file);
        }
      }
    },
    discard: () => undefined,
  };
}

/** Commit only the supplied paths using an isolated index, preserving the user's real index byte-for-byte except for these newly committed paths. */
function commitOnly(root: string, branch: string, files: string[], message: string): string {
  const head = git(["rev-parse", "--verify", "HEAD"], { cwd: root }).stdout.trim();
  if (!/^[0-9a-f]{40}$/.test(head)) throw new Error("Cannot resolve HEAD before the knowledge commit.");
  const index = path.join(gitCommonDir(root), `reggie-knowledge-index-${process.pid}-${randomUUID()}`);
  const env = { GIT_INDEX_FILE: index };
  try {
    git(["read-tree", head], { cwd: root, env });
    git(["add", "--", ...files], { cwd: root, env });
    const tree = git(["write-tree"], { cwd: root, env }).stdout.trim();
    if (!/^[0-9a-f]{40}$/.test(tree)) throw new Error("Knowledge commit did not produce a Git tree.");
    const commit = git(["commit-tree", tree, "-p", head, "-m", message], { cwd: root, env }).stdout.trim();
    if (!/^[0-9a-f]{40}$/.test(commit)) throw new Error("Knowledge commit did not produce a commit.");
    git(["update-ref", `refs/heads/${branch}`, commit, head], { cwd: root });
    // The ordinary index may contain unrelated staged work. Refresh only the paths now committed.
    git(["reset", "-q", "HEAD", "--", ...files], { cwd: root });
    return commit;
  } finally {
    rmSync(index, { force: true });
    rmSync(`${index}.lock`, { force: true });
  }
}

function commitWrites(paths: RepoPaths, config: ReggieConfig, writes: PreparedWrite[], message: string): KnowledgeCommitResult {
  if (writes.length === 0) throw new Error("A knowledge write needs at least one record.");
  const entities = new Set<string>();
  for (const write of writes) {
    if (entities.has(write.entity)) throw new Error(`Knowledge batch repeats ${write.entity}.`);
    entities.add(write.entity);
  }
  const branch = assertIntegrationCheckout(paths.root, config);
  const lock = acquireKnowledgeLock(paths.root);
  let files: string[] = [];
  try {
    files = writes.map((write) => relPosix(paths.root, write.file));
    const dirty = dirtyTargets(paths.root, files);
    if (dirty.length > 0) throw new Error(`Knowledge targets already have uncommitted changes: ${dirty.join("; ")}. Commit or discard them before saving.`);
    const atomic = writeAtomically(writes);
    let commit: string;
    try {
      commit = commitOnly(paths.root, branch, files, message);
      atomic.discard();
    } catch (error) {
      atomic.restore();
      throw error;
    }
    const records = writes.map((write) => {
      const record = readKnowledge(paths, write.entity, write.currentFingerprint);
      if (!record) throw new Error(`Committed knowledge for ${write.entity} could not be read back.`);
      return record;
    });
    return { commit, records, files };
  } finally {
    lock.release();
  }
}

/** One inline edit, one knowledge-only commit. */
export function saveKnowledge(paths: RepoPaths, config: ReggieConfig, edit: KnowledgeEdit, options: { now?: Date } = {}): KnowledgeCommitResult {
  const write = prepareEdit(paths, edit, options.now ?? new Date());
  return commitWrites(paths, config, [write], `knowledge: update ${write.entity}`);
}

/** One validated batch, one knowledge-only commit. */
export function saveKnowledgeBatch(paths: RepoPaths, config: ReggieConfig, edits: KnowledgeEdit[], options: { now?: Date; message?: string } = {}): KnowledgeCommitResult {
  const now = options.now ?? new Date();
  const writes = edits.map((edit) => prepareEdit(paths, edit, now));
  return commitWrites(paths, config, writes, options.message ?? `knowledge: refresh ${writes.length} entities`);
}

/** Retirement and restoration preserve current text and append lifecycle history. */
export function setKnowledgeRetired(paths: RepoPaths, config: ReggieConfig, input: KnowledgeRetirement, options: { now?: Date } = {}): KnowledgeCommitResult {
  const write = prepareRetirement(paths, input, options.now ?? new Date());
  return commitWrites(paths, config, [write], `knowledge: ${input.retired ? "retire" : "restore"} ${write.entity}`);
}

/** Hash arbitrary proof-bearing entity evidence into a stable invalidation fingerprint. */
export function evidenceFingerprint(value: unknown): string {
  return digest(typeof value === "string" ? value : JSON.stringify(value));
}
