/**
 * The narration layer (ui-spec §6.6): plain English about a repo, an area, a file, a task or a
 * workspace, shaped exactly as `GET /api/story` and `GET /api/explain` in ui-api-contract.md.
 *
 * Everything here is pure and DOM-free. `buildStoryContext` is the one function that reaches for
 * the disk, and it does so only through the existing modules (`facts`, `notes`, `journal`,
 * `tasks`, `people`, `views`); the story functions themselves read nothing but the context they
 * are given, which is what lets the podcast composer reuse them later.
 *
 * House style, binding on every sentence written here:
 *  - numbers: 0 → "no", 1–9 → words ("two files"), 10 and up → digits;
 *  - dates: "6 Sep" in the current year, "6 Sep 2025" otherwise; ages: "2 days";
 *  - every paragraph carries `refs` (graph node ids) so the map can highlight what it names;
 *  - notes and journal entries are quoted verbatim, with their attribution in chips;
 *  - every entity named in a sentence is a `[[route|label]]` link built by `routeFor`, never a
 *    raw path;
 *  - a section with nothing to say carries the empty text from spec §2 / §4 rather than vanishing.
 */

import { collectFacts, type LanguageCount, type RepoFacts } from "./facts.js";
import { currentBranch } from "./git.js";
import { type GraphEdge, type GraphNode, type RepoGraph, ROOT_DIR_ID, jsImports } from "./graph.js";
import { historyFor, recentFor, type CommitInfo, type HistoryIndex } from "./history.js";
import { readJournal, type JournalEntry } from "./journal.js";
import { allNoteFiles, staleEntriesFor, type NoteEntry, type NoteFile, type NoteType, type StaleEntry } from "./notes.js";
import type { RepoPaths } from "./paths.js";
import { currentPerson, inferMode, loadPeople, type Mode, type PeopleFile, type ReggieConfig } from "./people.js";
import { isTestLike } from "./roles.js";
import type { ServiceIndex, ServiceKind, ServiceNode } from "./services.js";
import type { Flow, FlowDrop, FlowStep, Payload } from "./flows.js";
import { fileSymbols, type CodeSymbol } from "./symbols.js";
import { STATE_MACHINE, getTaskDetail, listTasks, stateDefinition, type StateMachine, type TaskBriefDetail, type TaskDetail, type TaskInfo, type TaskState } from "./tasks.js";
import { containerView, dirIdOf, dirPathOf, dirView, level1, resolveDirId, type Level1, type ViewGraph, type ViewNode } from "./views.js";
import { slugify } from "./util.js";
import type { WorkspaceSummary } from "./workspace.js";

// ---------------------------------------------------------------------------
// Contract types (ui-api-contract.md, `GET /api/story` and `GET /api/explain`)
// ---------------------------------------------------------------------------

export type Lens = "structure" | "knowledge" | "tests" | "heat" | "owners" | "tasks";
export type StoryScope = "repo" | "area" | "file" | "task" | "workspace";
export type ParagraphKind = "fact" | "note" | "journal" | "gap" | "commit" | "decision" | "list";
export type ChipTone = "ok" | "warn" | "bad" | "info" | "muted";
export type FormKind = "capture" | "note" | "journal";

export interface Crumb {
  label: string;
  route: string;
}

export interface Chip {
  label: string;
  value: string;
  tone?: ChipTone;
  tip?: string;
}

export interface ParagraphSource {
  entity?: string;
  file?: string;
  date?: string;
  author?: string;
  confidence?: string;
  type?: NoteType;
  stale?: boolean;
  codeChanged?: string;
  person?: string;
  tool?: string;
  stage?: string;
  slug?: string;
  sha?: string;
}

export interface Decision {
  slug: string;
  canDecide: boolean;
  deciders: string[];
}

export interface Paragraph {
  id: string;
  kind: ParagraphKind;
  /** Plain text with `[[route|label]]` inline links; `list` separates items with `\n`. */
  text: string;
  refs: string[];
  chips?: Chip[];
  source?: ParagraphSource;
  decision?: Decision;
}

export interface StoryAction {
  label: string;
  route?: string;
  command?: string;
  form?: FormKind;
}

export interface StoryEmpty {
  text: string;
  action?: StoryAction;
}

export interface StorySection {
  id: string;
  heading: string;
  paragraphs: Paragraph[];
  empty?: StoryEmpty;
}

export interface Story {
  scope: string;
  id: string;
  title: string;
  subtitle: string | null;
  crumbs: Crumb[];
  sections: StorySection[];
  next: Crumb[];
}

export interface ExplainSentence {
  text: string;
  refs: string[];
}

export interface Explain {
  id: string;
  title: string;
  kind: GraphNode["kind"];
  crumbs: Crumb[];
  route: string;
  /** Exactly four. */
  sentences: ExplainSentence[];
  actions: Crumb[];
}

// ---------------------------------------------------------------------------
// The empty texts, verbatim from ui-spec §2 and §4
// ---------------------------------------------------------------------------

/**
 * Every empty state the story can emit. The strings marked "spec" are quoted from the tables in
 * ui-spec §2 and §4 and must not be reworded; the rest are written in the same register for the
 * sections those tables do not cover.
 */
export const EMPTY_TEXT = {
  /** spec §2, repo/what */
  repoWhat: "Nobody has written what this repo is for. The first useful note says why it exists and how to run it.",
  /** spec §2, repo/starts */
  repoStarts: "No entry point was recognised. Reggie looks for main/index/cli/server files and package.json bin/main.",
  /** spec §2, repo/talks */
  repoTalks: "The areas do not import each other.",
  /** spec §2 and §4, tasks */
  tasks: "Nothing has been captured yet. A task starts as one line in intake; a plan makes it groomed; a `task/<slug>` branch means in process; an open PR means awaiting decision; a merge means done.",
  /** spec §2, repo/gaps */
  repoGaps: "Every area has a note and none is stale.",
  /** spec §2, repo/run */
  repoRun: "No build or test command was recognised.",
  /** spec §4, "Notes (any chain)" */
  notes: "No one has written about this area yet. The first useful note usually says why it exists and how to run it.",
  /** spec §4, file tests section */
  fileTests: "No test imports this file.",
  /** spec §2, workspace/connect */
  workspaceConnect: "No dependency between these repos was found in their manifests.",
  // Register-matched text for the sections the tables do not spell out.
  areaInside: "This folder holds no code files.",
  areaUses: "It imports nothing outside this folder.",
  areaUsedBy: "Nothing outside this folder imports it.",
  areaTests: "No test file imports anything in this folder.",
  areaPeople: "Git recorded no changes here in the last year.",
  areaTasks: "No plan names a file in this folder.",
  areaGaps: "Every file here has a note and none is stale.",
  fileExports: "No exported symbol was found in this file.",
  fileUsedBy: "Nothing imports this file.",
  fileUses: "It imports nothing else in this repo.",
  fileTasks: "No plan names this file.",
  fileHistory: "Git has no commits for this file in the last year.",
  fileAddNote: "Write what the next person should know about this file.",
  fileGaps: "This file has a note and none of the notes that apply is stale.",
  taskNoPlan: "No plan yet. Plan it in plan mode against the contract.",
  taskOwner: "Nobody has claimed this task.",
  taskRisk: "No risk rule fired.",
  taskPacket: "No completion packet yet. It is written when the work is done.",
  taskJournal: "Nothing was recorded for this task yet.",
  workspaceRepos: "No repo was found in the workspace CLAUDE.md.",
} as const;

/** "Nothing was recorded in the last 14 days." (spec §2 and §4; the window is the `days` query.) */
export function journalEmptyText(days: number): string {
  return `Nothing was recorded in the last ${days} days.`;
}

// ---------------------------------------------------------------------------
// Numbers, dates, ages
// ---------------------------------------------------------------------------

const NUMBER_WORDS = ["no", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine"] as const;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

/** 0 → "no", 1–9 → the word, 10 and up → digits (spec §6.6). Negatives clamp to "no". */
export function numberWord(n: number): string {
  const i = Math.max(0, Math.round(Number.isFinite(n) ? n : 0));
  return i < NUMBER_WORDS.length ? (NUMBER_WORDS[i] ?? String(i)) : String(i);
}

/** `countPhrase(2, "file")` → "two files"; `countPhrase(0, "note")` → "no notes". */
export function countPhrase(n: number, singular: string, plural = `${singular}s`): string {
  return `${numberWord(n)} ${n === 1 ? singular : plural}`;
}

/**
 * The tests clause, or nothing at all. Pass `aggregates.testedSource` — the count of source files
 * with an inbound test edge — and append the result after the source-file count the sentence has
 * just printed, as `, ${clause}`. Every site that says how well something is tested calls this one
 * function: the made-of paragraph, the area subtitle and the container Spotlight used to build the
 * clause three separate times and drifted from the graph together.
 *
 * Two properties the wording depends on. "Of them" always refers to the source files named
 * immediately before it, and `testedSource` only ever counts files whose role is source, so the
 * number can never exceed the one beside it. And a zero returns null rather than "none of them
 * tested": in a repo whose imports the graph cannot resolve, silence is honest and a stated zero
 * would be a fresh false claim.
 */
function testedClause(tested: number): string | null {
  return tested > 0 ? `${numberWord(tested)} of them tested` : null;
}

/** "6 Sep" in the current year, "6 Sep 2025" otherwise. Accepts ISO dates and timestamps. */
export function formatDate(value: string | null | undefined, now: Date = new Date()): string {
  if (!value) return "an unknown date";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value.trim());
  if (!m) return value.trim();
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  const label = `${day} ${MONTHS[month - 1] ?? ""}`.trim();
  return year === now.getFullYear() ? label : `${label} ${year}`;
}

/** "2 days", "1 day", "today"; ages stay in digits so they read as a measurement. */
export function formatAge(days: number | null | undefined): string {
  if (days === null || days === undefined || !Number.isFinite(days)) return "no recorded activity";
  const n = Math.max(0, Math.round(days));
  if (n === 0) return "today";
  return `${n} ${n === 1 ? "day" : "days"}`;
}

/** The first sentence of a block of prose, collapsed to one line. */
export function firstSentence(text: string | null | undefined, max = 220): string {
  const flat = (text ?? "").replace(/\s+/g, " ").trim();
  if (!flat) return "";
  const stop = /[.!?](\s|$)/.exec(flat);
  const cut = stop ? flat.slice(0, stop.index + 1) : flat;
  return cut.length > max ? `${cut.slice(0, max - 1).trimEnd()}…` : cut;
}

function pct(part: number, whole: number): number {
  if (whole <= 0) return 0;
  return Math.round((part / whole) * 100);
}

function uniqStrings(values: Iterable<string | null | undefined>): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const v of values) {
    if (!v || seen.has(v)) continue;
    seen.add(v);
    out.push(v);
  }
  return out;
}

/** "once", "twice", "three times", "41 times" — the number rule, read aloud. */
export function timesPhrase(n: number): string {
  if (n === 1) return "once";
  if (n === 2) return "twice";
  return `${numberWord(n)} times`;
}

/** Append "and N more" as the last item of a list, so the join reads "a, b and three more". */
function withMore(shown: readonly string[], total: number): string[] {
  const hidden = total - shown.length;
  return hidden > 0 ? [...shown, `${numberWord(hidden)} more`] : [...shown];
}

/** "a", "a and b", "a, b and c" — never an Oxford comma, matching the story register. */
function joinPhrases(parts: readonly string[]): string {
  if (parts.length === 0) return "";
  if (parts.length === 1) return parts[0] ?? "";
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1] ?? ""}`;
}

// ---------------------------------------------------------------------------
// Routes and link markup
// ---------------------------------------------------------------------------

export type RouteQuery = Record<string, string | number | undefined>;

/** Hash-safe id encoding: `/`, `:` and `@` stay readable, everything else is escaped (mirrors `encodeId` in app.js). */
export function encodeRouteId(id: string): string {
  return encodeURIComponent(String(id)).replace(/%2F/gi, "/").replace(/%3A/gi, ":").replace(/%40/gi, "@");
}

function withQuery(path: string, query: RouteQuery): string {
  const parts: string[] = [];
  for (const [k, v] of Object.entries(query)) {
    if (v === undefined || v === "") continue;
    parts.push(`${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`);
  }
  return parts.length > 0 ? `${path}?${parts.join("&")}` : path;
}

/**
 * The one id → route map (spec §2). Every link in every sentence goes through this, so the story
 * and the map can never disagree about where an entity lives.
 *
 * `repo:<n>` → `#/repo/<n>`, `dir:./` → `#/repo/<repo>`, `dir:<p>/` → `…/area/<p>`, a bare path →
 * `…/file/<path>`, `task:<s>` → `…/task/<s>`, `person:<h>` → `…/person/<h>`, `sym:<f>::<n>` →
 * `…/symbol/<f>::<n>`. Ghost ids resolve to what they stand for; folds and entities land on the repo.
 */
export function routeFor(repo: string, nodeId: string, query: RouteQuery = {}): string {
  const id = String(nodeId ?? "").trim();
  const base = `#/repo/${encodeRouteId(repo)}`;
  if (id === "" || id === ROOT_DIR_ID || id === "dir:.") return withQuery(base, query);
  if (id.startsWith("ghost:")) return routeFor(repo, id.replace(/^ghost:(up|down):/, ""), query);
  if (id.startsWith("repo:")) return withQuery(`#/repo/${encodeRouteId(id.slice(5))}`, query);
  if (id.startsWith("dir:")) {
    const p = dirPathOf(id);
    if (p === "." || p === "") return withQuery(base, query);
    return withQuery(`${base}/area/${encodeRouteId(p)}`, query);
  }
  if (id.startsWith("svc:")) return withQuery(`${base}/services`, { ...query, service: id });
  if (id.startsWith("flow:")) return withQuery(`${base}/flow/${encodeRouteId(id.slice(5))}`, query);
  if (id.startsWith("resp:")) return withQuery(`${base}/flow/${encodeRouteId(id.slice(5))}`, query);
  if (id.startsWith("task:")) return withQuery(`${base}/task/${encodeRouteId(id.slice(5))}`, query);
  if (id.startsWith("person:")) return withQuery(`${base}/person/${encodeRouteId(id.slice(7))}`, query);
  if (id.startsWith("sym:")) {
    // A flow step names a symbol as `sym:<file>#<name>`; the graph names one as `sym:<file>::<name>`.
    const hash = id.indexOf("#");
    if (hash !== -1) return withQuery(`${base}/file/${encodeRouteId(id.slice(4, hash))}`, { ...query, symbol: id.slice(hash + 1) });
    return withQuery(`${base}/symbol/${encodeRouteId(id.slice(4))}`, query);
  }
  if (id.startsWith("fold:") || id.startsWith("entity:")) return withQuery(base, query);
  return withQuery(`${base}/file/${encodeRouteId(id)}`, query);
}

/** `#/repo/<r>/services` — the Services page (services-and-flows-spec.md §4). */
export function servicesRouteFor(repo: string): string {
  return `${routeFor(repo, ROOT_DIR_ID)}/services`;
}

/** `#/repo/<r>/flows` — the Data flow index. */
export function flowsRouteFor(repo: string): string {
  return `${routeFor(repo, ROOT_DIR_ID)}/flows`;
}

/** `#/repo/<r>/flow/<id>` — one traced flow. */
export function flowRouteFor(repo: string, id: string): string {
  return `${routeFor(repo, ROOT_DIR_ID)}/flow/${encodeRouteId(id)}`;
}

/** `[[` and `|` would break the markup, so labels are sanitised rather than escaped. */
function safeLabel(label: string): string {
  return String(label ?? "")
    .replace(/[[\]|]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** `[[<route>|<label>]]` for an arbitrary route. */
export function linkRoute(route: string, label: string): string {
  return `[[${route}|${safeLabel(label)}]]`;
}

/** `[[<route for nodeId>|<label>]]`; the label defaults to a readable form of the id. */
export function link(repo: string, nodeId: string, label?: string, query: RouteQuery = {}): string {
  return linkRoute(routeFor(repo, nodeId, query), label ?? defaultLabel(nodeId));
}

function defaultLabel(nodeId: string): string {
  const id = String(nodeId ?? "");
  if (id.startsWith("ghost:")) return defaultLabel(id.replace(/^ghost:(up|down):/, ""));
  if (id.startsWith("repo:")) return id.slice(5);
  if (id.startsWith("dir:")) return dirPathOf(id);
  if (id.startsWith("task:")) return id.slice(5);
  if (id.startsWith("person:")) return id.slice(7);
  if (id.startsWith("sym:")) return id.slice(id.lastIndexOf("::") + 2);
  if (id.startsWith("entity:")) return id.slice(7);
  return id;
}

/** The basename of a file id, for labels that should not repeat the whole path. */
function baseName(p: string): string {
  const clean = String(p ?? "").replace(/\/+$/, "");
  const cut = clean.lastIndexOf("/");
  return cut >= 0 ? clean.slice(cut + 1) : clean;
}

const LINK_RE = /\[\[([^\]|]+)\|([^\]|]+)\]\]/g;

/** Every `[[route|label]]` in a paragraph, in order. Used by the client and by the tests. */
export function parseLinks(text: string): { route: string; label: string }[] {
  const out: { route: string; label: string }[] = [];
  for (const m of String(text ?? "").matchAll(LINK_RE)) {
    out.push({ route: m[1] ?? "", label: m[2] ?? "" });
  }
  return out;
}

// ---------------------------------------------------------------------------
// The context
// ---------------------------------------------------------------------------

/** Lazily built, memoised projections of the graph. */
export interface StoryViews {
  level1(): Level1;
  container(): ViewGraph;
  dir(rootId: string): ViewGraph | null;
}

export interface StoryContext {
  /** Repo name as it appears in routes. */
  repo: string;
  branch: string;
  facts: RepoFacts;
  config: ReggieConfig;
  people: PeopleFile;
  mode: Mode;
  /** Handle of the person the server is acting as. */
  currentHandle: string;
  graph: RepoGraph;
  views: StoryViews;
  tasks: TaskInfo[];
  notes: NoteFile[];
  stale: StaleEntry[];
  journal: JournalEntry[];
  history: HistoryIndex;
  stateMachine: StateMachine;
  /** The lens in the query string; `knowledge` adds a Gaps section to area and file scopes. */
  lens: Lens;
  /** Journal window in days (14 or 60 per the contract). */
  days: number;
  now: Date;
  node(id: string): GraphNode | undefined;
  noteOf(entity: string): NoteFile | undefined;
  /** Plan, packet, claim and impact for a slug; null when the slug is unknown. */
  detailOf(slug: string): TaskDetail | null;
  /** Source of a repo-relative file, or null when the context was built without a reader. */
  readFile(file: string): string | null;
}

export interface BuildStoryContextOptions {
  repo?: string;
  branch?: string;
  facts?: RepoFacts;
  people?: PeopleFile;
  currentHandle?: string;
  tasks?: TaskInfo[];
  notes?: NoteFile[];
  stale?: StaleEntry[];
  journal?: JournalEntry[];
  lens?: Lens;
  days?: number;
  now?: Date;
  /**
   * Reads a repo-relative file. `story.ts` never touches `node:fs` itself, so the exports section
   * and the external-package chips stay empty until the server passes a reader in.
   */
  readFile?: (file: string) => string | null;
  /** Overrides the on-disk task detail lookup (tests pass a fixed map). */
  detailOf?: (slug: string) => TaskDetail | null;
}

/**
 * Assemble everything the story functions read. Called once per request by `serve.ts`, which
 * already holds a graph and a history index cached by HEAD sha and passes them straight through.
 */
export function buildStoryContext(paths: RepoPaths, config: ReggieConfig, graph: RepoGraph, history: HistoryIndex, opts: BuildStoryContextOptions = {}): StoryContext {
  const facts = opts.facts ?? collectFacts(paths.root);
  const people = opts.people ?? loadPeople(paths);
  const notes = opts.notes ?? allNoteFiles(paths);
  const days = opts.days ?? 14;
  const tasks =
    opts.tasks ??
    (() => {
      try {
        return listTasks(paths, config, { includeDone: true });
      } catch {
        return [] as TaskInfo[];
      }
    })();
  const journal = opts.journal ?? readJournal(paths, { days: Math.max(days, 60) });
  const stale = opts.stale ?? staleEntriesFor(paths, notes, history.lastTouched);

  const nodeIndex = new Map(graph.nodes.map((n) => [n.id, n]));
  const noteIndex = new Map<string, NoteFile>();
  for (const n of notes) if (!noteIndex.has(n.entity)) noteIndex.set(n.entity, n);

  let l1: Level1 | null = null;
  let container: ViewGraph | null = null;
  const dirCache = new Map<string, ViewGraph | null>();
  const views: StoryViews = {
    level1: () => (l1 ??= level1(graph)),
    container: () => (container ??= containerView(graph)),
    dir: (rootId: string) => {
      const key = dirIdOf(rootId);
      if (dirCache.has(key)) return dirCache.get(key) ?? null;
      const view = dirView(graph, key);
      dirCache.set(key, view);
      return view;
    },
  };

  const detailCache = new Map<string, TaskDetail | null>();
  const detailOf =
    opts.detailOf ??
    ((slug: string): TaskDetail | null => {
      if (detailCache.has(slug)) return detailCache.get(slug) ?? null;
      let detail: TaskDetail | null = null;
      try {
        detail = getTaskDetail(paths, config, slug);
      } catch {
        detail = null;
      }
      detailCache.set(slug, detail);
      return detail;
    });

  return {
    repo: opts.repo ?? facts.name,
    branch: opts.branch ?? currentBranch(paths.root),
    facts,
    config,
    people,
    mode: inferMode(people),
    currentHandle: opts.currentHandle ?? safeCurrentHandle(paths, people),
    graph,
    views,
    tasks,
    notes,
    stale,
    journal,
    history,
    stateMachine: STATE_MACHINE,
    lens: opts.lens ?? "structure",
    days,
    now: opts.now ?? new Date(),
    node: (id: string) => nodeIndex.get(id),
    noteOf: (entity: string) => noteIndex.get(entity),
    detailOf,
    readFile: opts.readFile ?? (() => null),
  };
}

function safeCurrentHandle(paths: RepoPaths, people: PeopleFile): string {
  try {
    return currentPerson(paths.root, people).handle;
  } catch {
    return people.people[0]?.handle ?? "someone";
  }
}

// ---------------------------------------------------------------------------
// Small builders
// ---------------------------------------------------------------------------

interface ParaExtra {
  chips?: Chip[];
  source?: ParagraphSource;
  decision?: Decision;
}

function para(id: string, kind: ParagraphKind, text: string, refs: readonly (string | null | undefined)[], extra: ParaExtra = {}): Paragraph {
  const p: Paragraph = { id, kind, text, refs: uniqStrings(refs) };
  if (extra.chips && extra.chips.length > 0) p.chips = extra.chips;
  if (extra.source) p.source = extra.source;
  if (extra.decision) p.decision = extra.decision;
  return p;
}

function section(id: string, heading: string, paragraphs: Paragraph[], empty?: StoryEmpty): StorySection {
  const s: StorySection = { id, heading, paragraphs };
  if (paragraphs.length === 0 && empty) s.empty = empty;
  return s;
}

function chip(label: string, value: string, tone?: ChipTone, tip?: string): Chip {
  const c: Chip = { label, value };
  if (tone) c.tone = tone;
  if (tip) c.tip = tip;
  return c;
}

const RISK_TONE: Record<string, ChipTone> = { low: "ok", medium: "warn", high: "bad", unset: "muted" };
const STATE_TONE: Record<TaskState, ChipTone> = {
  ungroomed: "muted",
  groomed: "info",
  planned: "info",
  "in-process": "info",
  "awaiting-decision": "warn",
  done: "ok",
};

function stateLabel(state: TaskState): string {
  return STATE_MACHINE.states.find((s) => s.id === state)?.label ?? state;
}

/** "in process", "awaiting decision" — the state as it reads mid-sentence. */
function stateWords(state: TaskState): string {
  return stateLabel(state).toLowerCase();
}

// ---------------------------------------------------------------------------
// Notes and journal as paragraphs
// ---------------------------------------------------------------------------

function staleKey(entity: string, entry: NoteEntry): string {
  return `${entity}|${entry.date}|${entry.type}`;
}

function staleMap(ctx: StoryContext): Map<string, string> {
  const out = new Map<string, string>();
  for (const s of ctx.stale) out.set(staleKey(s.entity, s.entry), s.codeChanged);
  return out;
}

/** `_repo`, then every ancestor folder note, then the entity's own note (spec §2, "Read these first"). */
function noteChain(ctx: StoryContext, entityPath: string, isDir: boolean): NoteFile[] {
  const clean = String(entityPath ?? "").replace(/^\.\//, "").replace(/\/+$/, "");
  const chain: NoteFile[] = [];
  const repo = ctx.noteOf("_repo");
  if (repo) chain.push(repo);
  const segments = clean.split("/").filter(Boolean);
  // Every folder above the entity itself: `src/big` → `src/`; `src/big/a01.ts` → `src/`, `src/big/`.
  for (let i = 1; i <= segments.length - 1; i += 1) {
    const dir = `${segments.slice(0, i).join("/")}/`;
    const note = ctx.noteOf(dir);
    if (note && !chain.includes(note)) chain.push(note);
  }
  const own = isDir ? ctx.noteOf(`${clean}/`) : ctx.noteOf(clean);
  if (own && !chain.includes(own)) chain.push(own);
  return chain;
}

/** The node a note entity points at, so a note paragraph can highlight it on the map. */
function noteNodeId(entity: string): string {
  if (entity === "_repo") return ROOT_DIR_ID;
  if (entity.includes(":")) return `entity:${entity}`;
  return entity.endsWith("/") ? `dir:${entity}` : entity;
}

function noteParagraphs(ctx: StoryContext, prefix: string, chain: readonly NoteFile[], extraRefs: readonly string[] = []): Paragraph[] {
  const stale = staleMap(ctx);
  const out: Paragraph[] = [];
  let n = 0;
  for (const note of chain) {
    for (const entry of note.entries) {
      n += 1;
      const codeChanged = stale.get(staleKey(note.entity, entry));
      const chips: Chip[] = [
        chip("Type", entry.type, undefined, `Type: ${entry.type}`),
        chip("Confidence", entry.confidence, entry.confidence === "high" ? "ok" : entry.confidence === "low" ? "warn" : "muted", `Confidence: ${entry.confidence}`),
        chip("Written by", entry.author, undefined, `Written by: ${entry.author}`),
        chip("Date", formatDate(entry.date, ctx.now), undefined, `Date: ${entry.date}`),
      ];
      if (codeChanged) {
        chips.push(chip("Possibly out of date", `written ${formatDate(entry.date, ctx.now)}, code changed ${formatDate(codeChanged, ctx.now)}`, "bad", "The entity changed in git after this entry was written."));
      }
      const source: ParagraphSource = {
        entity: note.entity,
        file: note.file,
        type: entry.type,
        confidence: entry.confidence,
        author: entry.author,
        date: entry.date,
      };
      if (codeChanged) {
        source.stale = true;
        source.codeChanged = codeChanged;
      }
      out.push(para(`${prefix}-${n}`, "note", entry.text.replace(/\s+/g, " ").trim(), [noteNodeId(note.entity), ...extraRefs, ...entry.sources.map(sourceNodeId)], { chips, source }));
    }
  }
  return out;
}

/** A `sources:` citation (`src/a.ts:12`, `src/dir/`) as a graph node id. */
function sourceNodeId(raw: string): string {
  const clean = String(raw ?? "").trim().replace(/^\.\//, "");
  const noLine = clean.replace(/:\d+(-\d+)?$/, "");
  if (!noLine) return "";
  return noLine.endsWith("/") ? `dir:${noLine}` : noLine;
}

function journalRefs(ctx: StoryContext, e: JournalEntry): string[] {
  const refs: string[] = [];
  if (e.slug) refs.push(`task:${e.slug}`);
  if (e.person) refs.push(`person:${e.person}`);
  for (const ev of e.evidence) {
    const id = sourceNodeId(ev);
    if (id && ctx.node(id)) refs.push(id);
  }
  return refs;
}

function journalParagraph(ctx: StoryContext, id: string, e: JournalEntry): Paragraph {
  const chips: Chip[] = [chip("Person", e.person, undefined, `Person: ${e.person}`), chip("Tool", e.tool, undefined, `Tool: ${e.tool}`)];
  if (e.stage) chips.push(chip("Stage", e.stage, undefined, `Pipeline stage: ${e.stage}`));
  if (e.slug) chips.push(chip("Task", e.slug, undefined, `Task: ${e.slug}`));
  chips.push(chip("Date", formatDate(e.date, ctx.now), undefined, `Date: ${e.date}`));
  const source: ParagraphSource = { person: e.person, tool: e.tool, date: e.date, file: e.file };
  if (e.stage) source.stage = e.stage;
  if (e.slug) source.slug = e.slug;
  return para(id, "journal", e.text.replace(/\s+/g, " ").trim(), journalRefs(ctx, e), { chips, source });
}

function commitParagraph(ctx: StoryContext, id: string, c: CommitInfo, refs: readonly string[]): Paragraph {
  const source: ParagraphSource = { sha: c.sha, author: c.handle || c.author, date: c.date };
  if (c.task) source.slug = c.task;
  return para(id, "commit", c.subject, [...refs, c.handle ? `person:${c.handle}` : null, c.task ? `task:${c.task}` : null], {
    chips: [chip("Date", formatDate(c.date, ctx.now), "muted", `Committed ${c.date}`), chip("By", c.handle || c.author, "muted")],
    source,
  });
}

// ---------------------------------------------------------------------------
// Graph helpers shared by the scopes
// ---------------------------------------------------------------------------

function isFile(ctx: StoryContext, id: string): boolean {
  return ctx.node(id)?.kind === "file";
}

/** Every file edge in or out of a file node, split by direction and channel. */
function fileEdges(ctx: StoryContext, fileId: string): { incoming: GraphEdge[]; outgoing: GraphEdge[] } {
  const incoming: GraphEdge[] = [];
  const outgoing: GraphEdge[] = [];
  for (const e of ctx.graph.edges) {
    if (e.kind === "touches" || e.kind === "annotates") continue;
    if (e.target === fileId && isFile(ctx, e.source)) incoming.push(e);
    if (e.source === fileId && isFile(ctx, e.target)) outgoing.push(e);
  }
  return { incoming, outgoing };
}

function areaLabelOf(ctx: StoryContext, areaId: string | null | undefined): string {
  if (!areaId) return "";
  const ref = ctx.views.container().areas.find((a) => a.id === areaId);
  return ref?.label ?? dirPathOf(areaId);
}

function areaOf(ctx: StoryContext, id: string): string | null {
  return ctx.views.level1().areaOf(id);
}

/** The dominant author of a history record, if git recorded one. */
function topAuthor(history: { authors: { handle: string; share: number }[] } | undefined): { handle: string; share: number } | null {
  const a = history?.authors[0];
  return a ? { handle: a.handle, share: a.share } : null;
}

function nodesUnder(ctx: StoryContext, dirId: string): GraphNode[] {
  const prefix = dirId === ROOT_DIR_ID ? "" : `${dirPathOf(dirId)}/`;
  return ctx.graph.nodes.filter((n) => n.kind === "file" && (prefix === "" || n.id.startsWith(prefix)));
}

// ---------------------------------------------------------------------------
// Crumbs
// ---------------------------------------------------------------------------

function repoCrumbs(ctx: StoryContext): Crumb[] {
  return [
    { label: "Workspace", route: "#/ws" },
    { label: ctx.repo, route: routeFor(ctx.repo, ROOT_DIR_ID) },
  ];
}

function pathCrumbs(ctx: StoryContext, entityPath: string, isDir: boolean): Crumb[] {
  const crumbs = repoCrumbs(ctx);
  const segments = String(entityPath ?? "").replace(/^\.\//, "").replace(/\/+$/, "").split("/").filter(Boolean);
  const last = segments.length - 1;
  segments.forEach((seg, i) => {
    const soFar = segments.slice(0, i + 1).join("/");
    if (i === last && !isDir) crumbs.push({ label: seg, route: routeFor(ctx.repo, soFar) });
    else crumbs.push({ label: seg, route: routeFor(ctx.repo, `dir:${soFar}/`) });
  });
  return crumbs;
}

// ---------------------------------------------------------------------------
// §2 Level 1: repoStory
// ---------------------------------------------------------------------------

/** The repo landing page: nine sections, question first (spec §2, Level 1). */
/**
 * What the repo story can say about the two derived pages. Passed in rather than derived here
 * so `story.ts` stays free of the detectors, and so a page with nothing on it is never linked.
 */
export interface RepoStoryOptions {
  services?: ServiceIndex;
  flows?: readonly { services: readonly string[] }[];
}

export function repoStory(ctx: StoryContext, opts: RepoStoryOptions = {}): Story {
  const sections: StorySection[] = [
    needsYouSection(ctx),
    whatSection(ctx),
    madeOfSection(ctx),
    startsSection(ctx),
    talksSection(ctx, opts),
    flightSection(ctx),
    recentSection(ctx),
    repoGapsSection(ctx),
    runSection(ctx),
  ];
  // No subtitle: the blurb is "About this repo", and the branch rides on its first paragraph as a chip.
  const subtitle = null;

  const areas = [...ctx.views.container().areas].sort((a, b) => b.source - a.source || a.label.localeCompare(b.label));
  const next: Crumb[] = areas.slice(0, 2).map((a) => ({ label: a.label, route: routeFor(ctx.repo, a.id) }));
  next.push({ label: "Task board", route: `${routeFor(ctx.repo, ROOT_DIR_ID)}/tasks` });

  return { scope: "repo", id: ctx.repo, title: ctx.repo, subtitle, crumbs: repoCrumbs(ctx), sections, next };
}

function decidersOf(ctx: StoryContext, task: TaskInfo): { deciders: string[]; canDecide: boolean } {
  const maintainers = ctx.people.people.filter((p) => p.role === "maintainer").map((p) => p.handle);
  if (ctx.mode === "team") {
    return { deciders: maintainers, canDecide: maintainers.includes(ctx.currentHandle) };
  }
  return { deciders: uniqStrings([task.owner, ctx.currentHandle]), canDecide: true };
}

function touchedBy(ctx: StoryContext, slug: string, limit = 5): string[] {
  const out: string[] = [];
  for (const e of ctx.graph.edges) {
    if (e.kind === "touches" && e.source === `task:${slug}`) out.push(e.target);
    if (out.length >= limit) break;
  }
  return out;
}

function needsYouSection(ctx: StoryContext): StorySection {
  const waiting = ctx.tasks.filter((t) => t.state === "awaiting-decision");
  const paragraphs = waiting.map((t, i) => {
    const detail = ctx.detailOf(t.slug);
    const problem = firstSentence(detail?.plan?.sections["Problem"]);
    const { deciders, canDecide } = decidersOf(ctx, t);
    const bits: string[] = [`${link(ctx.repo, `task:${t.slug}`, t.title || t.slug)} is waiting for a decision.`];
    if (problem) bits.push(problem);
    if (t.owner) bits.push(`Owner ${link(ctx.repo, `person:${t.owner}`, t.owner)}, ${formatAge(t.age)}.`);
    else bits.push(`Nobody is named as its owner; it has been waiting ${formatAge(t.age)}.`);
    if (!canDecide) bits.push(`Only ${joinPhrases(deciders.map((d) => link(ctx.repo, `person:${d}`, d)))} can approve it.`);
    const chips: Chip[] = [chip("Risk", t.risk, RISK_TONE[t.risk] ?? "muted", `Risk: ${t.risk}`), chip("Age", formatAge(t.age), "muted", "Days since the last activity on the task branch.")];
    return para(`needs-you-${i + 1}`, "decision", bits.join(" "), [`task:${t.slug}`, t.owner ? `person:${t.owner}` : null, ...touchedBy(ctx, t.slug)], {
      chips,
      decision: { slug: t.slug, canDecide, deciders },
    });
  });
  // Spec §2: the section is hidden when empty, so it carries no empty text.
  return section("needs-you", "Needs you", paragraphs);
}

function whatSection(ctx: StoryContext): StorySection {
  // The blurb is what a person wrote about the repo: the `why` entries of the `_repo` note, as prose.
  // The manifest description is only a stand-in for a repo nobody has described yet, so it is the
  // section's empty text rather than a paragraph, and every other kind of repo note (how, gotcha…)
  // is a card under "How to run it" (see runSection).
  const description = ctx.facts.description.replace(/\s+/g, " ").trim();
  const repoNote = ctx.noteOf("_repo");
  const why = repoNote ? noteParagraphs(ctx, "what-note", [{ ...repoNote, entries: repoNote.entries.filter((e) => e.type === "why") }], [`repo:${ctx.repo}`]) : [];
  const paragraphs: Paragraph[] = why.map((p, i) => {
    const stale = (p.chips ?? []).filter((c) => c.label === "Possibly out of date");
    const chips: Chip[] = i === 0 && ctx.branch ? [chip("Branch", ctx.branch, "muted", "The branch this page was read from."), ...stale] : stale;
    const prose: Paragraph = { ...p, kind: "fact" };
    if (chips.length) prose.chips = chips;
    else delete prose.chips;
    return prose;
  });
  return section("what", "About this repo", paragraphs, {
    text: description || EMPTY_TEXT.repoWhat,
    action: { label: "Add a note", form: "note", command: 'reggie note add _repo --type why "…"' },
  });
}

/**
 * Source files carrying a note **of their own**, per Level-1 area. `aggregates.documented` counts
 * inherited notes too, so one repo note would mark every file documented and no gap would ever be
 * reported; "N with a note" and the Gaps section both mean an own note.
 */
function ownNotedByArea(ctx: StoryContext): Map<string, number> {
  const l1 = ctx.views.level1();
  const out = new Map<string, number>();
  for (const n of ctx.graph.nodes) {
    if (n.kind !== "file" || n.role !== "source" || n.knowledge.own === 0) continue;
    const area = l1.areaOf(n.id);
    if (!area) continue;
    out.set(area, (out.get(area) ?? 0) + 1);
  }
  return out;
}

function areaKindWord(node: ViewNode | GraphNode | undefined): string {
  if (node?.manifest === "package.json") return "package";
  if (node?.manifest === "Cargo.toml") return "crate";
  return "area";
}

/**
 * How much of the repo the page beside it is a picture of, in one sentence.
 *
 * The made-of section is the page's literal answer to what the repo is made of, and every paragraph
 * under it is an inventory of the files the import graph could read. A repo Reggie read in full and
 * a repo it read a quarter of otherwise render identically, so the disclaimer goes first, where the
 * reader can discount the inventory before reading it.
 *
 * Both numbers come from `ViewCounts`, which lifts them from the graph, so this sentence and the map
 * footer beside it cannot disagree. `read` is the code files the graph read, `skipped` the code
 * files it never looked at by language (largest first), and `unresolved` the import lines that
 * pointed at no file. The word "unresolved" is not in the sentence on purpose: it is precise and it
 * is jargon, and the reader being addressed has not read the code.
 *
 * At most three languages are named, in the order given, and any remainder is folded into one
 * clause: naming is what makes the sentence useful and a long tail of one-file languages is what
 * would make it unreadable. When nothing was skipped the sentence makes the positive claim rather
 * than going silent, so the page never leaves the reader unable to tell a full read from no answer.
 */
export function coverageSentence(read: number, skipped: readonly LanguageCount[], unresolved: number): string | null {
  const total = read + skipped.reduce((sum, e) => sum + e.files, 0);
  // Nothing to be a picture of. The section's own empty paragraph already says the repo has no code
  // files Reggie recognises, and "Reggie read all no code files in this repo" beside it would be two
  // contradictory claims opening the section. Null, like `testedClause`, so the caller omits it.
  if (total === 0) return null;
  const named = skipped.slice(0, 3).map((e) => countPhrase(e.files, `${e.language} file`));
  const rest = skipped.slice(3);
  if (rest.length > 0) {
    const files = rest.reduce((sum, e) => sum + e.files, 0);
    named.push(`${countPhrase(files, "file")} in ${countPhrase(rest.length, "other language")}`);
  }
  // `countPhrase` for the all-read total so a one-file repo says "all one code file" and not "all
  // one code files"; "none of" rather than `numberWord(0)`'s "no", which reads as "read no of".
  const reading =
    skipped.length === 0
      ? `Reggie read all ${countPhrase(total, "code file")} in this repo`
      : `Reggie read ${read === 0 ? "none" : numberWord(read)} of this repo's ${numberWord(total)} code files, skipping ${joinPhrases(named)}`;
  // The comma before "and followed" only appears after a skipped list, so the all-clear sentence is
  // unchanged and the mixed case does not run the list into the verb that follows it.
  //
  // "written as a path" is load-bearing, not decoration. `unresolved` counts only specifiers that
  // start with a dot; `resolveJsImport` also resolves `@/` and `~/` aliases, and an alias that
  // resolves to nothing is dropped with no edge and no count. An unqualified "followed every import"
  // is therefore false for an alias-using repo — measured: a repo whose files all import through
  // `@/` renders zero unresolved over a map with zero edges. A universal claim has to say what it
  // ranges over; the count below is existential and needs no such scope. Closing the resolver gap is
  // captured as its own item and is deliberately not attempted here.
  const imports =
    unresolved === 0
      ? `${skipped.length > 0 ? "," : ""} and followed every import written as a path.`
      : `; ${countPhrase(unresolved, "import")} pointed at no file, so the map is missing those connections.`;
  return `${reading}${imports}`;
}

function madeOfSection(ctx: StoryContext): StorySection {
  const view = ctx.views.container();
  const byId = new Map(view.nodes.map((n) => [n.id, n]));
  const areas = [...view.areas].sort((a, b) => b.source - a.source || a.label.localeCompare(b.label));
  const noted = ownNotedByArea(ctx);
  const incoming = new Map<string, number>();
  for (const e of view.edges) incoming.set(e.target, (incoming.get(e.target) ?? 0) + (e.weight ?? 1));

  const paragraphs: Paragraph[] = [];
  const headline = areas.slice(0, 5);
  const rest = areas.slice(5);

  headline.forEach((ref, i) => {
    const node = byId.get(ref.id);
    const agg = node?.aggregates;
    const source = agg?.source ?? ref.source;
    // No `ref.files` fallback: `AreaRef` carries no tested count, so a node without aggregates
    // omits the clause rather than printing a number it does not have.
    const tested = testedClause(agg?.testedSource ?? 0);
    const documented = noted.get(ref.id) ?? 0;
    const commits30 = agg?.history?.commits30 ?? 0;
    const author = topAuthor(agg?.history);
    const lang = node?.lang ? `${node.lang} ` : "";
    const parts: string[] = [`${link(ctx.repo, ref.id, ref.label)} is a ${lang}${areaKindWord(node)}: ${linkRoute(routeFor(ctx.repo, ref.id, { lens: "structure" }), countPhrase(source, "source file"))}`];
    if (tested) parts.push(`, ${linkRoute(routeFor(ctx.repo, ref.id, { lens: "tests" }), tested)}`);
    parts.push(`, ${linkRoute(routeFor(ctx.repo, ref.id, { lens: "knowledge" }), documented === 0 ? "none with a note" : `${numberWord(documented)} with a note`)}`);
    if (commits30 > 0) parts.push(`, ${linkRoute(routeFor(ctx.repo, ref.id, { lens: "heat" }), `changed ${timesPhrase(commits30)}`)} in the last 30 days`);
    if (author) parts.push(`, mostly by ${link(ctx.repo, `person:${author.handle}`, author.handle)}`);
    let text = `${parts.join("")}.`;
    if ((incoming.get(ref.id) ?? 0) === 0) text += " It stands alone: nothing else in the repo imports it.";
    paragraphs.push(para(`made-of-${i + 1}`, "fact", text, [ref.id, author ? `person:${author.handle}` : null]));
  });

  if (rest.length > 0) {
    const lines = rest.map((ref) => {
      const agg = byId.get(ref.id)?.aggregates;
      const documented = noted.get(ref.id) ?? 0;
      return `${link(ctx.repo, ref.id, ref.label)} — ${countPhrase(agg?.source ?? ref.source, "source file")}, ${documented === 0 ? "no note" : `${numberWord(documented)} with a note`}`;
    });
    paragraphs.push(para(`made-of-${headline.length + 1}`, "list", lines.join("\n"), rest.map((r) => r.id)));
  }

  if (paragraphs.length === 0) {
    // Spec §2 says this section is never empty: say what little there is instead.
    const root = ctx.node(ROOT_DIR_ID);
    const agg = root?.aggregates;
    const text =
      (agg?.files ?? 0) === 0
        ? `${link(ctx.repo, ROOT_DIR_ID, ctx.repo)} has no code files that Reggie recognises yet.`
        : `Everything sits at the repo root: ${countPhrase(agg?.source ?? 0, "source file")} in ${link(ctx.repo, ROOT_DIR_ID, ctx.repo)}, with no folder large enough to be its own area.`;
    paragraphs.push(para("made-of-1", "fact", text, [ROOT_DIR_ID, `repo:${ctx.repo}`]));
  }
  // First, and with an id of its own: the area paragraphs keep their `made-of-1` upward numbering,
  // so nothing that reads a paragraph id shifts under this one. Unshifted after the empty-case
  // block above, so that block still sees only the area paragraphs when it asks whether there are
  // any — it means "no areas", not "no paragraphs".
  //
  // The refs carry the repo and every Level-1 area. The repo id alone is what the sentence is about,
  // but `map.resolveRef` cannot resolve a `repo:` id on a container map, and `observeReading` in
  // story.js calls `softHighlight` with whatever resolves — so a lone repo ref made scrolling into
  // this section clear the map's halo instead of lighting anything. The area ids are what a
  // repo-wide claim points at on a repo map.
  const c = view.counts;
  const coverage = coverageSentence(c.totalCodeFiles, c.skipped, c.unresolved);
  if (coverage) paragraphs.unshift(para("made-of-coverage", "fact", coverage, [`repo:${ctx.repo}`, ...areas.map((a) => a.id)]));
  return section("made-of", "What it is made of", paragraphs);
}

const ENTRY_PHRASE: Record<string, (linkText: string, count: number) => string> = {
  cli: (l, n) => `the command line starts in ${l} (${countPhrase(n, "command")})`,
  mcp: (l, n) => `agents reach the same code through ${l} (${countPhrase(n, "tool")})`,
  http: (l, n) => `the web view is served by ${l} (${countPhrase(n, "route")})`,
};

function startsSection(ctx: StoryContext): StorySection {
  const entries = ctx.graph.nodes.filter((n) => n.kind === "file" && n.entry);
  const paragraphs: Paragraph[] = [];

  const ipcServers = entries.filter((n) => n.entryKinds.some((k) => k.kind === "ipc-server"));
  const serverAreas = new Set(uniqStrings(ipcServers.map((n) => areaOf(ctx, n.id))));
  // The user-facing entry leads the sentence; the entry inside the IPC crate is the far end of it.
  const mains = entries
    .filter((n) => n.entryKinds.some((k) => k.kind === "main"))
    .sort((a, b) => Number(serverAreas.has(areaOf(ctx, a.id) ?? "")) - Number(serverAreas.has(areaOf(ctx, b.id) ?? "")) || a.id.localeCompare(b.id));
  const commandNames = new Set<string>();
  for (const e of ctx.graph.edges) if (e.kind === "ipc") for (const n of e.names ?? []) commandNames.add(n);

  if (mains.length > 0) {
    const first = mains[0];
    const linkText = first ? linkRoute(routeFor(ctx.repo, first.id, { dir: "down", depth: 2 }), baseName(first.path)) : "";
    const refs: string[] = mains.slice(0, 3).map((m) => m.id);
    let text = `A user action starts in ${linkText}`;
    if (mains.length > 1) text += ` (and in ${joinPhrases(mains.slice(1, 3).map((m) => linkRoute(routeFor(ctx.repo, m.id, { dir: "down", depth: 2 }), baseName(m.path))))})`;
    if (ipcServers.length > 0 && commandNames.size > 0) {
      const crateArea = areaOf(ctx, ipcServers[0]?.id ?? "");
      const crateLang = crateArea ? ctx.node(crateArea)?.lang || "native" : "native";
      const target = crateArea ? link(ctx.repo, crateArea, areaLabelOf(ctx, crateArea)) : link(ctx.repo, ipcServers[0]?.id ?? "", baseName(ipcServers[0]?.path ?? ""));
      text += ` and reaches the ${crateLang} side through ${countPhrase(commandNames.size, "Tauri command")} defined in ${target}`;
      if (crateArea) refs.push(crateArea);
      else if (ipcServers[0]) refs.push(ipcServers[0].id);
    }
    paragraphs.push(para("starts-1", "fact", `${text}.`, refs, { chips: [chip("Kind", "main", "info", "Entry kind: main — the file the runtime starts from.")] }));
  }

  const clauses: string[] = [];
  const otherRefs: string[] = [];
  for (const kind of ["cli", "mcp", "http"] as const) {
    const files = entries.filter((n) => n.entryKinds.some((k) => k.kind === kind));
    if (files.length === 0) continue;
    const file = files[0];
    if (!file) continue;
    const count = file.entryKinds.find((k) => k.kind === kind)?.count ?? 0;
    const phrase = ENTRY_PHRASE[kind];
    if (!phrase) continue;
    clauses.push(phrase(linkRoute(routeFor(ctx.repo, file.id, { dir: "down", depth: 2 }), baseName(file.path)), count));
    otherRefs.push(file.id);
  }
  if (clauses.length > 0) {
    const sentence = `${clauses.join("; ")}.`;
    paragraphs.push(para(`starts-${paragraphs.length + 1}`, "fact", `${sentence.charAt(0).toUpperCase()}${sentence.slice(1)}`, otherRefs));
  }

  return section("starts", "Where it starts", paragraphs, { text: EMPTY_TEXT.repoStarts });
}

function talksSection(ctx: StoryContext, opts: RepoStoryOptions = {}): StorySection {
  const view = ctx.views.container();
  const paragraphs: Paragraph[] = [];
  const ranked = [...view.edges].sort((a, b) => (b.weight ?? 1) - (a.weight ?? 1) || a.source.localeCompare(b.source));

  ranked.slice(0, 6).forEach((e, i) => {
    const from = link(ctx.repo, e.source, areaLabelOf(ctx, e.source));
    const to = link(ctx.repo, e.target, areaLabelOf(ctx, e.target));
    const weight = e.weight ?? 1;
    if (e.kind === "ipc") {
      const names = e.names ?? [];
      paragraphs.push(
        para(`talks-${i + 1}`, "fact", `${from} calls into ${to} through ${countPhrase(names.length || weight, "Tauri command")} (matched by name).`, [e.source, e.target], {
          chips: [chip("Confidence", "heuristic", "muted", "Matched by command name; it may include false matches.")],
        }),
      );
      return;
    }
    // `edge.top` is computed once in views.ts, in the same unit as `weight` (importing files, tests
    // included), so this parenthetical always sits inside the total and always matches the map's
    // tooltip for the same edge — both render the one field rather than counting for themselves.
    const top = e.top;
    let mostly = "";
    const refs = [e.source, e.target];
    if (top && top.files > 1) {
      mostly = `, mostly for ${link(ctx.repo, top.path, baseName(top.path))} (${top.files})`;
      refs.push(top.path);
    }
    paragraphs.push(para(`talks-${i + 1}`, "fact", `${from} leans on ${to} ${timesPhrase(weight)}${mostly}.`, refs));
  });

  view.cycles.slice(0, 3).forEach((scc, i) => {
    const labels = scc.map((id) => link(ctx.repo, id, areaLabelOf(ctx, id)));
    paragraphs.push(
      para(`talks-cycle-${i + 1}`, "fact", `${joinPhrases(labels)} depend on each other.`, scc, {
        chips: [chip("Cycle", "yes", "bad", "These areas import each other; a change ripples both ways.")],
      }),
    );
  });

  // The two derived pages, linked only when they have something on them: an empty page is a
  // worse answer than the empty text this section already carries.
  const services = opts.services;
  if (services && services.services.length > 0) {
    const undeclared = services.undeclared.length;
    const headline = undeclared > 0 ? ` ${numberWord(undeclared)} of them ${undeclared === 1 ? "is" : "are"} used in code and declared nowhere.` : " Every one of them is declared.";
    paragraphs.push(
      para(
        "talks-services",
        "fact",
        `Outside itself, this repo talks to ${countPhrase(services.services.length, "service")}: databases, namespaces, buckets and the APIs it calls.${headline} ${linkRoute(servicesRouteFor(ctx.repo), "Services")} lists them with the line that declares each one.`,
        [ROOT_DIR_ID, ...services.services.slice(0, 6).map((s) => s.id)],
      ),
    );
  }
  const flows = opts.flows;
  if (flows && flows.length > 0) {
    paragraphs.push(
      para(
        "talks-flows",
        "fact",
        `Data enters at ${countPhrase(flows.length, "entry point")}. ${linkRoute(flowsRouteFor(ctx.repo), "Data flow")} traces each one to the services it reaches, with the payload on every step.`,
        [ROOT_DIR_ID],
      ),
    );
  }

  return section("talks", "How the pieces talk", paragraphs, { text: EMPTY_TEXT.repoTalks });
}

const FLIGHT_ORDER: TaskState[] = ["in-process", "awaiting-decision", "planned", "groomed", "ungroomed"];

function taskLine(ctx: StoryContext, t: TaskInfo): string {
  const head = link(ctx.repo, `task:${t.slug}`, t.slug);
  const bits: string[] = [stateWords(t.state)];
  if (t.owner) bits.push(t.owner);
  if (t.state === "ungroomed" && !t.owner) {
    const captured = t.intake?.meta ? /\d{4}-\d{2}-\d{2}/.exec(t.intake.meta)?.[0] ?? null : null;
    if (captured) bits.push(`captured ${formatDate(captured, ctx.now)}`);
  } else if (t.age !== null) bits.push(formatAge(t.age));
  return `${head} (${bits.join(", ")}): ${t.title || t.slug}`;
}

function flightSection(ctx: StoryContext): StorySection {
  const paragraphs: Paragraph[] = [];
  let n = 0;
  for (const state of FLIGHT_ORDER) {
    const group = ctx.tasks.filter((t) => t.state === state);
    if (group.length === 0) continue;
    n += 1;
    paragraphs.push(
      para(`flight-${n}`, "list", group.map((t) => taskLine(ctx, t)).join("\n"), group.map((t) => `task:${t.slug}`), {
        chips: [chip("State", stateLabel(state), STATE_TONE[state], stateDefinition(state))],
      }),
    );
  }
  return section("flight", "What is in flight", paragraphs, {
    text: EMPTY_TEXT.tasks,
    action: { label: "Capture", form: "capture", command: 'reggie capture "…"' },
  });
}

function withinDays(dateIso: string | null | undefined, days: number, now: Date): boolean {
  if (!dateIso) return false;
  const t = Date.parse(dateIso.length <= 10 ? `${dateIso}T00:00:00` : dateIso);
  if (!Number.isFinite(t)) return false;
  return now.getTime() - t <= days * 24 * 60 * 60 * 1000 + 1000;
}

function recentSection(ctx: StoryContext): StorySection {
  const entries = ctx.journal.filter((e) => withinDays(e.date, ctx.days, ctx.now)).slice(0, 5);
  const paragraphs = entries.map((e, i) => journalParagraph(ctx, `recent-${i + 1}`, e));
  const commits = recentFor(ctx.history, "./")
    .filter((c) => withinDays(c.date, ctx.days, ctx.now))
    .slice(0, 3);
  commits.forEach((c, i) => paragraphs.push(commitParagraph(ctx, `recent-commit-${i + 1}`, c, [ROOT_DIR_ID])));
  const empty: StoryEmpty = { text: journalEmptyText(ctx.days) };
  if (ctx.days < 60) empty.action = { label: "Widen to 60 days" };
  return section("recent", "What happened recently", paragraphs, empty);
}

function staleParagraph(ctx: StoryContext, id: string, s: StaleEntry): Paragraph {
  const nodeId = noteNodeId(s.entity);
  const isDir = s.entity.endsWith("/");
  const what = isDir ? "folder" : "file";
  const text = `The note on ${linkRoute(routeFor(ctx.repo, nodeId, { lens: "knowledge" }), s.entity)} was written on ${formatDate(s.entry.date, ctx.now)} but the ${what} changed on ${formatDate(s.codeChanged, ctx.now)}; it may be out of date.`;
  return para(id, "gap", text, [nodeId], {
    source: { entity: s.entity, file: s.file, date: s.entry.date, stale: true, codeChanged: s.codeChanged, type: s.entry.type },
  });
}

function repoGapsSection(ctx: StoryContext): StorySection {
  const view = ctx.views.container();
  const byId = new Map(view.nodes.map((n) => [n.id, n]));
  const noted = ownNotedByArea(ctx);
  const paragraphs: Paragraph[] = [];
  const undocumented = [...view.areas]
    .filter((a) => {
      const agg = byId.get(a.id)?.aggregates;
      return (agg?.source ?? 0) > 0 && (noted.get(a.id) ?? 0) === 0;
    })
    .sort((a, b) => b.source - a.source)
    .slice(0, 3);
  undocumented.forEach((a, i) => {
    const agg = byId.get(a.id)?.aggregates;
    paragraphs.push(
      para(
        `gaps-${i + 1}`,
        "gap",
        `${linkRoute(routeFor(ctx.repo, a.id, { lens: "knowledge" }), a.label)} has ${countPhrase(agg?.source ?? a.source, "source file")} and none of them has a note.`,
        [a.id],
      ),
    );
  });
  ctx.stale.slice(0, 5).forEach((s, i) => paragraphs.push(staleParagraph(ctx, `gaps-stale-${i + 1}`, s)));
  return section("gaps", "What nobody has written down", paragraphs, { text: EMPTY_TEXT.repoGaps });
}

function runSection(ctx: StoryContext): StorySection {
  const commands = ctx.facts.commands;
  const paragraphs: Paragraph[] =
    commands.length === 0
      ? []
      : [para("run-1", "list", commands.map((c) => c.command).join("\n"), [ROOT_DIR_ID], { chips: commands.slice(0, 6).map((c) => chip("Command", c.label, "muted", c.command)) })];
  // Every repo note that is not the blurb (how, gotcha, verify…) is about running the thing.
  const repoNote = ctx.noteOf("_repo");
  if (repoNote) paragraphs.push(...noteParagraphs(ctx, "run-note", [{ ...repoNote, entries: repoNote.entries.filter((e) => e.type !== "why") }], [`repo:${ctx.repo}`]));
  return section("run", "How to run it", paragraphs, {
    text: EMPTY_TEXT.repoRun,
    action: { label: "Record what you ran", form: "journal", command: 'reggie journal "…"' },
  });
}

// ---------------------------------------------------------------------------
// §2 Level 2: areaStory
// ---------------------------------------------------------------------------

/** One folder: what to read, what is inside, who it talks to, who works here. Null when `id` is not a directory. */
export function areaStory(ctx: StoryContext, id: string): Story | null {
  const rootId = resolveDirId(ctx.graph, id);
  if (!rootId) return null;
  const node = ctx.node(rootId);
  if (!node) return null;
  const view = ctx.views.dir(rootId);
  const dirPath = dirPathOf(rootId);
  const agg = node.aggregates;

  const sections: StorySection[] = [
    areaReadFirst(ctx, rootId, dirPath),
    areaInside(ctx, rootId, view),
    areaGhosts(ctx, rootId, view, "down"),
    areaGhosts(ctx, rootId, view, "up"),
    areaTests(ctx, rootId),
    areaPeople(ctx, rootId),
    areaTasks(ctx, rootId),
    areaRecent(ctx, rootId, dirPath),
  ];
  if (ctx.lens === "knowledge") sections.push(areaGaps(ctx, rootId, dirPath));

  const source = agg?.source ?? 0;
  const tested = testedClause(agg?.testedSource ?? 0);
  const lang = node.lang ? `${node.lang} ` : "";
  const subtitle = `${lang}${areaKindWord(node)}, ${countPhrase(source, "source file")}${tested ? `, ${tested}` : ""}.`;

  const next: Crumb[] = [];
  const relied = mostReliedOn(ctx, rootId);
  if (relied) next.push({ label: baseName(relied.path), route: routeFor(ctx.repo, relied.id) });
  const parent = node.parent;
  if (parent) next.push({ label: parent === ROOT_DIR_ID ? ctx.repo : dirPathOf(parent), route: routeFor(ctx.repo, parent) });

  return {
    scope: "area",
    id: dirPath,
    title: dirPath === "." ? ctx.repo : dirPath,
    subtitle,
    crumbs: pathCrumbs(ctx, dirPath === "." ? "" : dirPath, true),
    sections,
    next,
  };
}

function areaReadFirst(ctx: StoryContext, rootId: string, dirPath: string): StorySection {
  const chain = noteChain(ctx, dirPath === "." ? "" : dirPath, true);
  const paragraphs = noteParagraphs(ctx, "rf", chain, [rootId]);
  const own = ctx.noteOf(dirPath === "." ? "_repo" : `${dirPath}/`);
  if (paragraphs.length > 0 && !own) {
    paragraphs.push(
      para(`rf-${paragraphs.length + 1}`, "gap", `No note is written on ${link(ctx.repo, rootId, dirPath)} itself; everything above is inherited from the repo and the folders around it.`, [rootId]),
    );
  }
  return section("read-first", "Read these first", paragraphs, {
    text: EMPTY_TEXT.notes,
    action: { label: "Add a note", form: "note", command: `reggie note add ${dirPath === "." ? "_repo" : `${dirPath}/`} --type why "…"` },
  });
}

function mostReliedOn(ctx: StoryContext, rootId: string): GraphNode | null {
  const files = nodesUnder(ctx, rootId).filter((n) => n.role === "source");
  const ranked = [...files].sort((a, b) => b.inDegree - a.inDegree || a.id.localeCompare(b.id));
  const top = ranked[0];
  return top && top.inDegree > 0 ? top : (ranked[0] ?? null);
}

function areaInside(ctx: StoryContext, rootId: string, view: ViewGraph | null): StorySection {
  const paragraphs: Paragraph[] = [];
  const relied = mostReliedOn(ctx, rootId);
  if (relied && relied.inDegree > 0) {
    paragraphs.push(
      para("inside-1", "fact", `${link(ctx.repo, relied.id, baseName(relied.path))} is the most relied-on file here: ${countPhrase(relied.inDegree, "other file")} use it.`, [relied.id]),
    );
  }
  const others = nodesUnder(ctx, rootId)
    .filter((n) => n.role === "source" && n.id !== relied?.id)
    .sort((a, b) => b.inDegree - a.inDegree || a.id.localeCompare(b.id))
    .slice(0, 5);
  if (others.length > 0) {
    const lines = others.map((n) => `${link(ctx.repo, n.id, baseName(n.path))} — ${countPhrase(n.inDegree, "file")} use it, ${countPhrase(n.lines, "line")}`);
    paragraphs.push(para(`inside-${paragraphs.length + 1}`, "list", lines.join("\n"), others.map((n) => n.id)));
  }
  const subAreas = (view?.nodes ?? []).filter((n) => n.kind === "dir" && !n.ghost && n.id !== rootId);
  if (subAreas.length > 0) {
    const lines = subAreas.map((n) => `${link(ctx.repo, n.id, dirPathOf(n.id))} holds ${countPhrase(n.aggregates?.source ?? 0, "source file")}`);
    paragraphs.push(para(`inside-${paragraphs.length + 1}`, "list", lines.join("\n"), subAreas.map((n) => n.id)));
  }
  return section("inside", "What is in here", paragraphs, { text: EMPTY_TEXT.areaInside });
}

/** "What it depends on" (`down` ghosts) and "What depends on it" (`up` ghosts) share one shape. */
function areaGhosts(ctx: StoryContext, rootId: string, view: ViewGraph | null, side: "up" | "down"): StorySection {
  const id = side === "down" ? "uses" : "used-by";
  const heading = side === "down" ? "What it depends on" : "What depends on it";
  const emptyText = side === "down" ? EMPTY_TEXT.areaUses : EMPTY_TEXT.areaUsedBy;
  const ghosts = (view?.nodes ?? []).filter((n) => n.ghost === true && n.side === side);
  const paragraphs: Paragraph[] = [];
  ghosts
    .map((g) => {
      const weight = (view?.edges ?? []).filter((e) => (side === "down" ? e.target === g.id : e.source === g.id)).reduce((sum, e) => sum + (e.weight ?? 1), 0);
      const files = Number(/·\s(\d+)\sfiles?\sused/.exec(g.label)?.[1] ?? 0);
      return { g, weight, files };
    })
    .sort((a, b) => b.weight - a.weight || a.g.id.localeCompare(b.g.id))
    .forEach(({ g, weight, files }, i) => {
      const base = g.id.replace(/^ghost:(up|down):/, "");
      const label = areaLabelOf(ctx, base) || dirPathOf(base);
      const verb = side === "down" ? "Uses" : "Used by";
      paragraphs.push(para(`${id}-${i + 1}`, "fact", `${verb} ${link(ctx.repo, base, label)} for ${countPhrase(files, "file")} (${countPhrase(weight, "import")}).`, [base, g.id, rootId]));
    });
  return section(id, heading, paragraphs, { text: emptyText });
}

function areaTests(ctx: StoryContext, rootId: string): StorySection {
  const node = ctx.node(rootId);
  const agg = node?.aggregates;
  const tests = agg?.tests ?? 0;
  const source = agg?.source ?? 0;
  const tested = agg?.testedSource ?? 0;
  const paragraphs: Paragraph[] = [];
  if (tests > 0 || tested > 0) {
    paragraphs.push(para("tests-1", "fact", `${countPhrase(tests, "test file")} ${tests === 1 ? "covers" : "cover"} ${numberWord(tested)} of ${numberWord(source)} source files.`, [rootId]));
    const untested = nodesUnder(ctx, rootId).filter((n) => n.role === "source" && n.testedBy.length === 0);
    if (untested.length > 0) {
      const shown = untested.slice(0, 5).map((n) => link(ctx.repo, n.id, baseName(n.path)));
      paragraphs.push(para("tests-2", "gap", `Untested: ${joinPhrases(withMore(shown, untested.length))}.`, untested.slice(0, 5).map((n) => n.id)));
    }
  }
  return section("tests", "Tests", paragraphs, { text: EMPTY_TEXT.areaTests, action: { label: "See the Tests lens", route: routeFor(ctx.repo, rootId, { lens: "tests" }) } });
}

function areaPeople(ctx: StoryContext, rootId: string): StorySection {
  const history = ctx.node(rootId)?.aggregates?.history ?? historyFor(ctx.history, dirPathOf(rootId) === "." ? "./" : `${dirPathOf(rootId)}/`);
  const authors = history?.authors ?? [];
  const paragraphs: Paragraph[] = [];
  if (authors.length > 0) {
    const top = authors[0];
    if (top) {
      let text = `${link(ctx.repo, `person:${top.handle}`, top.handle)} wrote ${pct(top.share, 1)}% of the lines changed in the last year.`;
      if ((history?.busFactor ?? 1) === 1) text += " One person holds this area.";
      else if (authors.length > 1) text += ` ${countPhrase(authors.length, "person", "people")} touched it: ${joinPhrases(authors.slice(1, 4).map((a) => link(ctx.repo, `person:${a.handle}`, a.handle)))} as well.`;
      paragraphs.push(para("people-1", "fact", text, [rootId, ...authors.slice(0, 4).map((a) => `person:${a.handle}`)]));
    }
  }
  return section("people", "Who works here", paragraphs, { text: EMPTY_TEXT.areaPeople });
}

function areaTasks(ctx: StoryContext, rootId: string): StorySection {
  const slugs = new Set(ctx.node(rootId)?.aggregates?.tasks ?? []);
  const tasks = ctx.tasks.filter((t) => slugs.has(t.slug));
  const paragraphs: Paragraph[] =
    tasks.length === 0 ? [] : [para("tasks-1", "list", tasks.map((t) => taskLine(ctx, t)).join("\n"), [rootId, ...tasks.map((t) => `task:${t.slug}`)])];
  return section("tasks", "Tasks that will touch this area", paragraphs, { text: EMPTY_TEXT.areaTasks });
}

function areaRecent(ctx: StoryContext, rootId: string, dirPath: string): StorySection {
  const prefix = dirPath === "." ? "" : `${dirPath}/`;
  const slugsHere = new Set(ctx.node(rootId)?.aggregates?.tasks ?? []);
  const entries = ctx.journal
    .filter((e) => withinDays(e.date, ctx.days, ctx.now))
    .filter((e) => (e.slug && slugsHere.has(e.slug)) || e.evidence.some((ev) => sourceNodeId(ev).startsWith(prefix)))
    .slice(0, 5);
  const paragraphs = entries.map((e, i) => journalParagraph(ctx, `recent-${i + 1}`, e));
  const commits = recentFor(ctx.history, prefix === "" ? "./" : prefix).slice(0, 5);
  commits.forEach((c, i) => paragraphs.push(commitParagraph(ctx, `recent-commit-${i + 1}`, c, [rootId])));
  const empty: StoryEmpty = { text: journalEmptyText(ctx.days) };
  if (ctx.days < 60) empty.action = { label: "Widen to 60 days" };
  return section("recent", "Recently", paragraphs, empty);
}

function areaGaps(ctx: StoryContext, rootId: string, dirPath: string): StorySection {
  const prefix = dirPath === "." ? "" : `${dirPath}/`;
  const paragraphs: Paragraph[] = [];
  const undocumented = nodesUnder(ctx, rootId).filter((n) => n.role === "source" && n.knowledge.own === 0);
  if (undocumented.length > 0) {
    const shown = undocumented.slice(0, 5);
    const named = withMore(shown.map((n) => link(ctx.repo, n.id, baseName(n.path))), undocumented.length);
    paragraphs.push(
      para("gaps-1", "gap", `${countPhrase(undocumented.length, "file")} here ${undocumented.length === 1 ? "has" : "have"} no note of its own: ${joinPhrases(named)}.`, shown.map((n) => n.id)),
    );
  }
  ctx.stale
    .filter((s) => s.entity.startsWith(prefix))
    .slice(0, 5)
    .forEach((s, i) => paragraphs.push(staleParagraph(ctx, `gaps-stale-${i + 1}`, s)));
  return section("gaps", "What nobody has written down", paragraphs, { text: EMPTY_TEXT.areaGaps });
}

// ---------------------------------------------------------------------------
// §2 Level 3: fileStory
// ---------------------------------------------------------------------------

/** One file: notes, exports, both sides of its imports, tests, tasks, history. Null when unknown. */
export function fileStory(ctx: StoryContext, id: string): Story | null {
  const fileId = String(id ?? "").replace(/^\.\//, "");
  const node = ctx.node(fileId);
  if (!node || node.kind !== "file") return null;
  const { incoming, outgoing } = fileEdges(ctx, fileId);
  const symbols = symbolsOf(ctx, fileId);

  const sections: StorySection[] = [
    fileReadFirst(ctx, node),
    fileExports(ctx, node, symbols),
    fileUsedBy(ctx, node, incoming),
    fileUses(ctx, node, outgoing),
    fileTests(ctx, node),
    fileTasks(ctx, node),
    fileHistory(ctx, node),
    fileAddNote(node),
  ];
  if (ctx.lens === "knowledge") sections.push(fileGaps(ctx, node));

  const area = areaOf(ctx, fileId) ?? node.area;
  const subtitle = `${node.lang || "Unknown"}, ${countPhrase(node.lines, "line")}${area ? `, in ${link(ctx.repo, area, areaLabelOf(ctx, area))}` : ""}.`;

  const next: Crumb[] = [];
  const topImporter = incoming[0];
  if (topImporter) next.push({ label: baseName(topImporter.source), route: routeFor(ctx.repo, topImporter.source) });
  if (area) next.push({ label: areaLabelOf(ctx, area), route: routeFor(ctx.repo, area) });

  return { scope: "file", id: fileId, title: baseName(node.path), subtitle, crumbs: pathCrumbs(ctx, fileId, false), sections, next };
}

function symbolsOf(ctx: StoryContext, fileId: string): CodeSymbol[] {
  const content = ctx.readFile(fileId);
  if (content === null) return [];
  try {
    return fileSymbols(ctx.graph, fileId, content);
  } catch {
    return [];
  }
}

function fileReadFirst(ctx: StoryContext, node: GraphNode): StorySection {
  const chain = noteChain(ctx, node.id, false);
  const paragraphs = noteParagraphs(ctx, "rf", chain, [node.id]);
  if (paragraphs.length > 0 && node.knowledge.own === 0) {
    paragraphs.push(
      para(
        `rf-${paragraphs.length + 1}`,
        "gap",
        `No note is written on ${link(ctx.repo, node.id, baseName(node.path))} itself; ${countPhrase(paragraphs.length, "entry", "entries")} above ${paragraphs.length === 1 ? "is" : "are"} inherited from the repo and the folders around it.`,
        [node.id],
      ),
    );
  }
  return section("read-first", "Read these first", paragraphs, {
    text: EMPTY_TEXT.notes,
    action: { label: "Add a note", form: "note", command: `reggie note add ${node.id} --type why "…"` },
  });
}

const MAX_LISTED_EXPORTS = 20;

function fileExports(ctx: StoryContext, node: GraphNode, symbols: readonly CodeSymbol[]): StorySection {
  // Most-used first, not declaration order: the cap otherwise buries the export everyone cares
  // about (graph.ts declares 20 types before buildGraph) under the type aliases at the top.
  const exported = symbols
    .filter((s) => s.exported)
    .slice()
    .sort((a, b) => b.usedBy.length - a.usedBy.length || a.line - b.line || a.name.localeCompare(b.name));
  const paragraphs: Paragraph[] = [];
  if (exported.length > 0) {
    const lines = exported
      .slice(0, MAX_LISTED_EXPORTS)
      .map((s) => `${link(ctx.repo, `sym:${node.id}::${s.name}`, s.name)} ${s.kind}, line ${s.line}, used by ${countPhrase(s.usedBy.length, "file")}`);
    paragraphs.push(para("exports-1", "list", lines.join("\n"), [node.id]));
    if (exported.length > MAX_LISTED_EXPORTS) {
      paragraphs.push(
        para("exports-2", "fact", `${numberWord(exported.length - MAX_LISTED_EXPORTS)} more exports are not listed here; these are the ones most files use.`, [node.id]),
      );
    }
  }
  return section("exports", "What it exports", paragraphs, { text: EMPTY_TEXT.fileExports });
}

/** Group file ids by their Level-1 area, keeping the order stable. */
function groupByArea(ctx: StoryContext, fileIds: readonly string[]): { area: string | null; files: string[] }[] {
  const groups = new Map<string, string[]>();
  for (const f of fileIds) {
    const key = areaOf(ctx, f) ?? "";
    const list = groups.get(key) ?? [];
    list.push(f);
    groups.set(key, list);
  }
  return [...groups.entries()]
    .sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))
    .map(([area, files]) => ({ area: area === "" ? null : area, files }));
}

function fileUsedBy(ctx: StoryContext, node: GraphNode, incoming: readonly GraphEdge[]): StorySection {
  const tests = uniqStrings(incoming.filter((e) => isTestLike(ctx.node(e.source)?.role ?? "source")).map((e) => e.source));
  const sources = uniqStrings(incoming.filter((e) => !isTestLike(ctx.node(e.source)?.role ?? "source")).map((e) => e.source));
  const paragraphs: Paragraph[] = [];
  groupByArea(ctx, sources).forEach((group, i) => {
    const shown = group.files.slice(0, 3).map((f) => link(ctx.repo, f, baseName(f)));
    const where = group.area ? ` in ${link(ctx.repo, group.area, areaLabelOf(ctx, group.area))}` : "";
    const among = shown.length > 0 ? `, among them ${joinPhrases(shown)}` : "";
    paragraphs.push(para(`used-by-${i + 1}`, "fact", `Used by ${countPhrase(group.files.length, "file")}${where}${among}.`, [node.id, group.area, ...group.files.slice(0, 3)]));
  });
  if (tests.length > 0) {
    paragraphs.push(
      para(`used-by-tests`, "fact", `${countPhrase(tests.length, "test")} import it: ${joinPhrases(tests.slice(0, 4).map((t) => link(ctx.repo, t, baseName(t))))}.`, [node.id, ...tests.slice(0, 4)]),
    );
  }
  return section("used-by", "Who uses it", paragraphs, { text: EMPTY_TEXT.fileUsedBy });
}

function externalPackages(ctx: StoryContext, node: GraphNode): string[] {
  const content = ctx.readFile(node.id);
  if (content === null) return [];
  if (!/\.(ts|tsx|js|jsx|mjs|cjs|mts|cts)$/.test(node.id)) return [];
  try {
    return uniqStrings(jsImports(content).map((r) => r.spec).filter((s) => !s.startsWith(".") && !s.startsWith("/"))).slice(0, 8);
  } catch {
    return [];
  }
}

function fileUses(ctx: StoryContext, node: GraphNode, outgoing: readonly GraphEdge[]): StorySection {
  const paragraphs: Paragraph[] = [];
  const byTarget = new Map<string, string[]>();
  for (const e of outgoing) byTarget.set(e.target, uniqStrings([...(byTarget.get(e.target) ?? []), ...(e.names ?? [])]));
  groupByArea(ctx, [...byTarget.keys()]).forEach((group, i) => {
    const parts = group.files.slice(0, 4).map((f) => {
      const names = byTarget.get(f) ?? [];
      const forNames = names.length > 0 ? ` for \`${names.slice(0, 4).join("`, `")}\`` : "";
      return `${link(ctx.repo, f, baseName(f))}${forNames}`;
    });
    const where = group.area ? ` in ${link(ctx.repo, group.area, areaLabelOf(ctx, group.area))}` : "";
    paragraphs.push(para(`uses-${i + 1}`, "fact", `Imports ${joinPhrases(withMore(parts, group.files.length))}${where}.`, [node.id, group.area, ...group.files.slice(0, 4)]));
  });
  const external = externalPackages(ctx, node);
  if (external.length > 0) {
    paragraphs.push(
      para(`uses-external`, "fact", `External packages: ${external.join(", ")}.`, [node.id], { chips: external.map((e) => chip("External", e, "muted", `External package: ${e}`)) }),
    );
  }
  return section("uses", "What it uses", paragraphs, { text: EMPTY_TEXT.fileUses });
}

function fileTests(ctx: StoryContext, node: GraphNode): StorySection {
  const paragraphs: Paragraph[] = [];
  if (node.testedBy.length > 0) {
    const links = node.testedBy.slice(0, 5).map((t) => link(ctx.repo, t, baseName(t)));
    paragraphs.push(para("tests-1", "fact", `${joinPhrases(links)} ${node.testedBy.length === 1 ? "imports" : "import"} this file.`, [node.id, ...node.testedBy.slice(0, 5)]));
  }
  return section("tests", "Tests", paragraphs, {
    text: EMPTY_TEXT.fileTests,
    action: { label: "See the Tests lens", route: routeFor(ctx.repo, node.id, { lens: "tests" }) },
  });
}

function fileTasks(ctx: StoryContext, node: GraphNode): StorySection {
  const tasks = ctx.tasks.filter((t) => node.tasks.includes(t.slug));
  const paragraphs: Paragraph[] =
    tasks.length === 0 ? [] : [para("tasks-1", "list", tasks.map((t) => taskLine(ctx, t)).join("\n"), [node.id, ...tasks.map((t) => `task:${t.slug}`)])];
  return section("tasks", "Tasks", paragraphs, { text: EMPTY_TEXT.fileTasks });
}

function fileHistory(ctx: StoryContext, node: GraphNode): StorySection {
  const history = node.history ?? historyFor(ctx.history, node.id);
  const paragraphs: Paragraph[] = [];
  // Counts are null on the "no git history" marker (history.ts `noHistory`); treat that as zero here.
  const commits365 = history?.commits365 ?? 0;
  const commits30 = history?.commits30 ?? 0;
  if (history && commits365 > 0) {
    const authors = history.authors;
    const top = authors[0];
    const who = top ? (authors.length === 1 ? `all by ${link(ctx.repo, `person:${top.handle}`, top.handle)}` : `mostly by ${link(ctx.repo, `person:${top.handle}`, top.handle)}`) : "by nobody Reggie can name";
    const window = commits30 > 0 ? `Changed ${timesPhrase(commits30)} in the last 30 days, ${who}.` : `No change in the last 30 days; ${countPhrase(commits365, "commit")} in the last year, ${who}.`;
    paragraphs.push(para("history-0", "fact", window, [node.id, top ? `person:${top.handle}` : null]));
    recentFor(ctx.history, node.id)
      .slice(0, 8)
      .forEach((c, i) => paragraphs.push(commitParagraph(ctx, `history-${i + 1}`, c, [node.id])));
  }
  return section("history", "History", paragraphs, { text: EMPTY_TEXT.fileHistory });
}

function fileAddNote(node: GraphNode): StorySection {
  return section("add-note", "Add a note", [], {
    text: EMPTY_TEXT.fileAddNote,
    action: { label: "Add note", form: "note", command: `reggie note add ${node.id} --type how "…"` },
  });
}

function fileGaps(ctx: StoryContext, node: GraphNode): StorySection {
  const paragraphs: Paragraph[] = [];
  if (node.knowledge.own === 0) {
    paragraphs.push(
      para(
        "gaps-1",
        "gap",
        `Nobody has written a note on ${linkRoute(routeFor(ctx.repo, node.id, { lens: "knowledge" }), baseName(node.path))}; it inherits ${countPhrase(node.knowledge.inherited, "entry", "entries")} from the folders above it.`,
        [node.id],
      ),
    );
  }
  const chainEntities = new Set(noteChain(ctx, node.id, false).map((n) => n.entity));
  ctx.stale
    .filter((s) => chainEntities.has(s.entity))
    .slice(0, 5)
    .forEach((s, i) => paragraphs.push(staleParagraph(ctx, `gaps-stale-${i + 1}`, s)));
  return section("gaps", "What nobody has written down", paragraphs, { text: EMPTY_TEXT.fileGaps });
}

// ---------------------------------------------------------------------------
// §3.7 taskStory
// ---------------------------------------------------------------------------

interface PlanSectionSpec {
  id: string;
  heading: string;
  /** The `##` heading the plan contract uses for this section. */
  plan: string;
  empty: string;
}

/** The plan-derived sections, in the contract's order (`problem, approach, …, verification, …`). */
const PLAN_SECTIONS: Record<string, PlanSectionSpec> = {
  problem: { id: "problem", heading: "Problem", plan: "Problem", empty: "The plan does not state the problem." },
  approach: { id: "approach", heading: "Approach", plan: "Approach", empty: "The plan does not state the approach." },
  verification: { id: "verification", heading: "Verification", plan: "Verification strategy", empty: "The plan does not say how the work will be verified." },
  assumptions: { id: "assumptions", heading: "Assumptions", plan: "Assumptions", empty: "The plan records no assumptions." },
  scope: { id: "scope", heading: "Out of scope", plan: "Out of scope", empty: "The plan draws no boundary around the work." },
  bail: { id: "bail", heading: "Bail conditions", plan: "Bail conditions", empty: "The plan names no bail condition." },
};

/** One task: the state and why, the plan as prose, the packet, and the journal for the slug. */
export function taskStory(ctx: StoryContext, slug: string): Story | null {
  const detail = ctx.detailOf(slug);
  const task = detail?.task ?? ctx.tasks.find((t) => t.slug === slug) ?? null;
  if (!task) return null;
  const plan = detail?.plan ?? null;
  const taskId = `task:${task.slug}`;

  const noPlanText = plan
    ? EMPTY_TEXT.taskNoPlan
    : `No plan yet. This task is ${stateWords(task.state)}: \`${task.intake?.text ?? task.title}\` captured by ${task.owner ?? ctx.currentHandle} on ${formatDate(intakeDateOf(task), ctx.now)}. Plan it in plan mode against the contract (\`reggie plan new ${task.slug}\`).`;

  /** A plan section, with the "no plan yet" story standing in when there is no plan at all. */
  const prose = (key: keyof typeof PLAN_SECTIONS): StorySection => {
    const spec = PLAN_SECTIONS[key];
    if (!spec) throw new Error(`unknown plan section ${String(key)}`);
    return taskProseSection(task, plan, spec, plan ? spec.empty : noPlanText);
  };

  // Section ids and order are fixed by ui-api-contract.md for a task with a plan. Without one,
  // the plan sections would each say "no plan yet" ten times over; a task that early is better
  // explained by what was written, where it probably lives, and what is still unclear.
  const sections: StorySection[] = plan
    ? [
        taskStateSection(ctx, task),
        taskOwnerSection(ctx, task, detail),
        prose("problem"),
        prose("approach"),
        taskFilesSection(ctx, task, detail),
        taskCriteriaSection(task, detail),
        prose("verification"),
        prose("assumptions"),
        prose("scope"),
        prose("bail"),
        taskRiskSection(ctx, task, detail),
        taskPacketSection(ctx, task, detail),
        taskJournalSection(ctx, task, detail),
      ]
    : [taskStateSection(ctx, task), ...(detail?.brief ? briefSections(ctx, task, detail.brief) : intakeSections(ctx, task)), taskJournalSection(ctx, task, detail)];

  const subtitle = `${stateLabel(task.state)} · ${stateDefinition(task.state)}`;
  const crumbs: Crumb[] = [...repoCrumbs(ctx), { label: "Tasks", route: `${routeFor(ctx.repo, ROOT_DIR_ID)}/tasks` }, { label: task.slug, route: routeFor(ctx.repo, taskId) }];
  const next: Crumb[] = [{ label: "Task board", route: `${routeFor(ctx.repo, ROOT_DIR_ID)}/tasks` }];
  const firstFile = plan?.files[0];
  if (firstFile) next.push({ label: baseName(firstFile.path), route: routeFor(ctx.repo, firstFile.nodeId) });

  return { scope: "task", id: task.slug, title: task.title || task.slug, subtitle, crumbs, sections, next };
}

// ---------------------------------------------------------------------------
// §3.7a A task before it has a plan: the intake story and the brief story
// ---------------------------------------------------------------------------

const STOP_WORDS = new Set([
  "the", "and", "for", "that", "this", "with", "from", "into", "when", "then", "than", "them", "they", "there", "their", "have", "has", "had", "not", "but", "are", "was", "were", "been", "being", "will", "would", "should", "could", "can", "cannot", "does", "did", "doing", "done", "make", "made", "need", "needs", "want", "wants", "like", "just", "also", "some", "more", "most", "very", "much", "many", "each", "every", "after", "before", "about", "over", "under", "again", "still", "once", "only", "same", "other", "such", "what", "which", "who", "whom", "whose", "where", "why", "how", "all", "any", "both", "few", "our", "your", "its", "his", "her", "out", "off", "own", "too", "now", "new", "old", "way", "thing", "things", "image", "figure", "please", "able", "better", "instead", "something", "anything", "everything", "nothing", "because", "since", "while", "until", "though", "although", "here", "these", "those", "being", "using", "used", "use", "get", "gets", "getting", "set", "sets", "add", "added", "adding", "fix", "fixed", "show", "shows", "showing", "shown",
]);

/** The words in a line worth matching against the code: lowercased, split on case and punctuation, stop words dropped. */
function tokensOf(text: string): string[] {
  const raw = String(text ?? "")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 3 && !STOP_WORDS.has(w) && !/^\d+$/.test(w));
  return uniqStrings(raw);
}

interface PlaceGuess {
  files: { node: GraphNode; hits: string[] }[];
  dirs: { node: GraphNode; hits: string[] }[];
}

/** Files and folders whose names carry the words in the line: the cheapest honest guess at where it lives. */
function guessPlaces(ctx: StoryContext, tokens: readonly string[]): PlaceGuess {
  const files: PlaceGuess["files"] = [];
  const dirs: PlaceGuess["dirs"] = [];
  if (tokens.length === 0) return { files, dirs };
  for (const node of ctx.graph.nodes) {
    if (node.kind !== "file" && node.kind !== "dir") continue;
    if (node.role === "test" || node.role === "fixture") continue;
    const p = node.path.toLowerCase();
    const base = p.slice(p.lastIndexOf("/") + 1).replace(/\.[a-z0-9]+$/, "");
    const hits = tokens.filter((t) => base.includes(t) || p.split("/").some((seg) => seg.replace(/\.[a-z0-9]+$/, "") === t));
    if (hits.length === 0) continue;
    (node.kind === "file" ? files : dirs).push({ node, hits });
  }
  const score = (x: { node: GraphNode; hits: string[] }) => x.hits.length * 10 + (x.node.kind === "file" ? Math.min(x.node.inDegree, 9) : 0);
  files.sort((a, b) => score(b) - score(a) || a.node.path.localeCompare(b.node.path));
  dirs.sort((a, b) => score(b) - score(a) || a.node.path.localeCompare(b.node.path));
  return { files: files.slice(0, 5), dirs: dirs.slice(0, 3) };
}

/** Notes whose text carries at least two of the words, or that sit on a guessed file or folder. */
function relatedNotes(ctx: StoryContext, tokens: readonly string[], places: PlaceGuess): NoteFile[] {
  const wanted = new Set([...places.files.map((f) => f.node.path), ...places.dirs.map((d) => d.node.path.replace(/\/?$/, "/"))]);
  const out: NoteFile[] = [];
  for (const note of ctx.notes) {
    if (note.entity === "_repo") continue;
    const onPlace = wanted.has(note.entity) || wanted.has(note.entity.replace(/\/?$/, "/"));
    const textual = note.entries.some((e) => tokens.filter((t) => e.text.toLowerCase().includes(t)).length >= 2);
    if (onPlace || textual) out.push(note);
    if (out.length >= 4) break;
  }
  return out;
}

/** Other tasks that share words with this one or touch the files it probably lives in. */
function similarTasks(ctx: StoryContext, task: TaskInfo, tokens: readonly string[], places: PlaceGuess): { task: TaskInfo; why: string }[] {
  const placePaths = new Set(places.files.map((f) => f.node.path));
  const out: { task: TaskInfo; why: string }[] = [];
  for (const other of ctx.tasks) {
    if (other.slug === task.slug) continue;
    const shared = tokensOf(other.title).filter((t) => tokens.includes(t));
    const touches = [...other.planFiles, ...other.changedFiles].filter((f) => placePaths.has(f));
    if (touches.length > 0) out.push({ task: other, why: `it touches ${joinPhrases(touches.slice(0, 2).map((f) => link(ctx.repo, f, baseName(f))))}` });
    else if (shared.length >= 2) out.push({ task: other, why: `its title shares the words ${joinPhrases(shared.slice(0, 3).map((w) => `"${w}"`))}` });
    if (out.length >= 3) break;
  }
  return out;
}

/** What was captured, where it probably lives, what is known there, what it resembles, what is unclear, what comes next. */
function intakeSections(ctx: StoryContext, task: TaskInfo): StorySection[] {
  const taskId = `task:${task.slug}`;
  const line = task.intake;
  const text = line?.text ?? task.legacy?.description ?? task.title ?? task.slug;
  const detailLines = line?.detail ?? [];
  const tokens = tokensOf([text, ...detailLines].join(" "));
  const places = guessPlaces(ctx, tokens);
  const notes = relatedNotes(ctx, tokens, places);
  const similar = similarTasks(ctx, task, tokens, places);
  const who = task.owner ?? ctx.currentHandle;
  const when = formatDate(intakeDateOf(task), ctx.now);

  const written: Paragraph[] = [
    para("written-1", "fact", `${who} wrote this down on ${when}, in one line: "${text.replace(/\s+/g, " ").trim()}"`, [taskId], { chips: [chip("Source", line?.meta?.split(",")[1]?.trim() || (task.legacy ? "backlog" : "intake"), "muted", "Where the line came from")] }),
  ];
  if (detailLines.length > 0) {
    written.push(para("written-2", "fact", detailLines.map((d) => d.trim()).filter(Boolean).join(" "), [taskId]));
  } else {
    written.push(para("written-3", "gap", "There is no detail under the line: no example, no screenshot, no sentence about who feels it. Everything below is guessed from those few words alone.", [taskId]));
  }

  const lives: Paragraph[] = [];
  if (places.files.length > 0 || places.dirs.length > 0) {
    const fileLinks = places.files.map((f) => {
      const area = areaOf(ctx, f.node.id);
      return `${link(ctx.repo, f.node.id, baseName(f.node.path))}${area ? ` in ${link(ctx.repo, area, areaLabelOf(ctx, area))}` : ""} (${joinPhrases(f.hits.map((h) => `"${h}"`))})`;
    });
    const dirLinks = places.dirs.map((d) => `${link(ctx.repo, d.node.id, d.node.path)} (${joinPhrases(d.hits.map((h) => `"${h}"`))})`);
    const refs = [taskId, ...places.files.map((f) => f.node.id), ...places.dirs.map((d) => d.node.id)];
    lives.push(
      para("lives-1", "gap", `Going only by the words in the line, it probably concerns ${joinPhrases([...fileLinks, ...dirLinks])}. That is a name match, not an understanding; a shaping session should confirm or correct it.`, refs, {
        chips: [chip("How", "words matched to file and folder names", "warn", "Reggie matched the words in the line against paths in the graph; nothing read the code.")],
      }),
    );
    const top = places.files[0];
    if (top && top.node.inDegree > 0) {
      lives.push(para("lives-2", "fact", `${link(ctx.repo, top.node.id, baseName(top.node.path))} is imported by ${countPhrase(top.node.inDegree, "other file")}, so a change there reaches further than the file itself.`, [taskId, top.node.id]));
    }
  }

  const known: Paragraph[] = notes.length > 0 ? noteParagraphs(ctx, "known", notes, [taskId]) : [];

  const resembles: Paragraph[] = similar.map((s, i) =>
    para(`resembles-${i + 1}`, "fact", `${link(ctx.repo, `task:${s.task.slug}`, s.task.title || s.task.slug)} (${stateWords(s.task.state)}) looks related: ${s.why}.`, [taskId, `task:${s.task.slug}`]),
  );

  const unclear: string[] = [];
  if (places.files.length === 0 && places.dirs.length === 0) unclear.push("Which part of the code this concerns: no file or folder name matches the words in the line.");
  else unclear.push("Whether the name match above is the right place, or only a place with a similar name.");
  if (detailLines.length === 0) unclear.push("Why it matters now, and who feels it: the line carries no detail.");
  unclear.push("What done looks like: nothing yet says how anyone would check that this is finished.");
  if (/\[image \d+\]/i.test(text)) unclear.push("What the attached image shows: Reggie cannot read images, so whatever it explains is not in this story.");

  const next: Paragraph[] = [
    para("next-1", "fact", `The next step is to shape it into a brief: a conversation that ends with the problem in plain English, where it probably lives, a size and a priority, and the questions still open. Shape it from the task board, or run \`reggie launch ${task.slug} --run\`. Add a sentence of your own first if any of the guesses above is wrong.`, [taskId]),
  ];

  return [
    section("written", "What was written", written),
    section("lives", "Where it probably lives", lives, { text: "Nothing in the code carries any of the words in the line, so Reggie cannot point at a place. Say where you think it is, in a sentence, and the shaping session starts there." }),
    section("known", "What is already known there", known, { text: "No note covers the places it probably lives, so whoever shapes it starts from the code alone." }),
    section("resembles", "What it resembles", resembles, { text: "No other task shares its words or its likely files." }),
    section("unclear", "What is unclear", [para("unclear-1", "list", unclear.join("\n"), [taskId])]),
    section("next", "What happens next", next),
  ];
}

/** The brief as a story: the ask, why now, where, what is open, what it is not, and what comes next. */
function briefSections(ctx: StoryContext, task: TaskInfo, brief: TaskBriefDetail): StorySection[] {
  const taskId = `task:${task.slug}`;
  const sec = (name: string): string => stripPlaceholders(brief.sections[name] ?? "");
  const problem = sec("Problem");
  const why = sec("Why now");
  const not = sec("Not this");
  const meta = brief.meta;
  const shaping: Chip[] = [];
  if (meta.priority !== "unset") shaping.push(chip("Priority", meta.priority, "info", "Priority set by triage"));
  if (meta.size !== "unset") shaping.push(chip("Size", meta.size, "muted", "Size guessed by triage"));
  if (meta.risk !== "unset") shaping.push(chip("Risk", meta.risk, RISK_TONE[meta.risk] ?? "muted", "Risk guessed by triage; the plan settles it"));
  if (meta.area) shaping.push(chip("Area", meta.area, "muted", "Where the work probably lands"));
  const ask: Paragraph[] = problem ? [para("ask-1", "fact", problem, [taskId], shaping.length ? { chips: shaping } : {})] : [];
  const whyNow: Paragraph[] = why ? [para("why-1", "fact", why, [taskId])] : [];
  const areas: Paragraph[] = brief.areas.map((a, i) => {
    const first = a.trim().split(/\s+/)[0]?.replace(/^[`"']+|[`"',:;]+$/g, "") ?? "";
    const node = first ? ctx.graph.nodes.find((n) => n.path === first || n.path === first.replace(/\/$/, "") || `${n.path}/` === first) : undefined;
    const rest = a.trim().slice(first.length).trim().replace(/^(because|:|-|—)\s*/i, "");
    const text = node ? `${link(ctx.repo, node.id, first)}${rest ? `, ${rest}` : ""}` : a.trim();
    return para(`area-${i + 1}`, "fact", text, [taskId, node?.id ?? null]);
  });
  const questions: Paragraph[] = brief.questions.length > 0 ? [para("questions-1", "list", brief.questions.join("\n"), [taskId])] : [];
  const notThis: Paragraph[] = not ? [para("not-1", "fact", not, [taskId])] : [];
  const next: Paragraph[] = [
    para("next-1", "fact", brief.questions.length > 0
      ? `${countPhrase(brief.questions.length, "question is", "questions are")} still open. Answer them here or in the planning session; then plan it in plan mode from the task board, or run \`reggie launch ${task.slug} --run\`.`
      : `Nothing is open. The next step is a plan: a conversation in plan mode that ends with acceptance criteria a reviewer can check and the evidence that will prove each one. Start it from the task board, or run \`reggie launch ${task.slug} --run\`.`, [taskId]),
  ];
  return [
    section("ask", "What is being asked for", ask, { text: "The brief's Problem section is still the scaffold placeholder. Shaping was started but never finished.", action: { label: "Shape it in a session", command: `reggie launch ${task.slug} --run` } }),
    section("why-now", "Why now", whyNow, { text: "The brief does not say why this is worth doing ahead of the rest." }),
    section("area", "Where it probably lives", areas, { text: "The brief names no file or folder." }),
    section("questions", "Open questions", questions, { text: "The brief leaves no question open." }),
    section("not-this", "What it is not", notThis, { text: "The brief does not draw a boundary around the work." }),
    section("next", "What happens next", next),
  ];
}

function intakeDateOf(task: TaskInfo): string | null {
  const meta = task.intake?.meta ?? "";
  return /\d{4}-\d{2}-\d{2}/.exec(meta)?.[0] ?? task.lastActivity ?? null;
}

function taskStateSection(ctx: StoryContext, task: TaskInfo): StorySection {
  const taskId = `task:${task.slug}`;
  const paragraphs: Paragraph[] = [
    para("state-1", "fact", `${link(ctx.repo, taskId, task.title || task.slug)} is ${stateWords(task.state)}. ${stateDefinition(task.state)}`, [taskId], {
      chips: [chip("State", stateLabel(task.state), STATE_TONE[task.state], stateDefinition(task.state)), chip("Age", formatAge(task.age), "muted", "Days since the last activity.")],
    }),
  ];
  if (task.reason) paragraphs.push(para("state-2", "fact", `Reggie read that state from git: ${task.reason}.`, [taskId]));
  return section("state", "State", paragraphs);
}

function taskOwnerSection(ctx: StoryContext, task: TaskInfo, detail: TaskDetail | null): StorySection {
  const taskId = `task:${task.slug}`;
  const claim = detail?.claim ?? null;
  const paragraphs: Paragraph[] = [];
  if (task.owner || claim) {
    const owner = claim?.person ?? task.owner ?? "";
    const bits = [`${link(ctx.repo, `person:${owner}`, owner)} holds this task`];
    if (claim) bits.push(`claimed on ${formatDate(claim.date, ctx.now)} from ${claim.machine} using ${claim.tool}`);
    if (task.branch) bits.push(`on branch \`${task.branch}\``);
    paragraphs.push(
      para("owner-1", "fact", `${bits.join(", ")}.`, [taskId, `person:${owner}`], {
        chips: claim ? [chip("Machine", claim.machine, "muted"), chip("Tool", claim.tool, "muted"), chip("Claimed", formatDate(claim.date, ctx.now), "muted", claim.date)] : [],
      }),
    );
  }
  return section("owner", "Owner", paragraphs, { text: EMPTY_TEXT.taskOwner, action: { command: `reggie claim ${task.slug}`, label: "Claim it" } });
}

function taskProseSection(task: TaskInfo, plan: TaskDetail["plan"], spec: { id: string; heading: string; plan: string }, emptyText: string): StorySection {
  const body = (plan?.sections[spec.plan] ?? "").trim();
  const taskId = `task:${task.slug}`;
  const paragraphs: Paragraph[] = [];
  if (body) {
    const bullets = body.split("\n").filter((l) => /^\s*-\s+\S/.test(l));
    if (bullets.length > 0 && bullets.length * 2 >= body.split("\n").filter((l) => l.trim()).length) {
      paragraphs.push(para(`${spec.id}-1`, "list", bullets.map((b) => b.replace(/^\s*-\s+/, "").trim()).join("\n"), [taskId]));
    } else {
      paragraphs.push(para(`${spec.id}-1`, "fact", body.replace(/\s+/g, " ").trim(), [taskId]));
    }
  }
  return section(spec.id, spec.heading, paragraphs, { text: emptyText });
}

const OP_TONE: Record<string, ChipTone> = { NEW: "ok", MOD: "info", DEL: "bad" };

function taskFilesSection(ctx: StoryContext, task: TaskInfo, detail: TaskDetail | null): StorySection {
  const taskId = `task:${task.slug}`;
  const files = detail?.plan?.files ?? [];
  const paragraphs: Paragraph[] = [];
  if (files.length > 0) {
    const lines = files.map((f) => {
      const area = areaOf(ctx, f.nodeId);
      const where = area ? ` in ${link(ctx.repo, area, areaLabelOf(ctx, area))}` : "";
      const op = f.op ? ` (${f.op})` : "";
      const missing = f.exists ? "" : " — not on disk yet";
      return `${link(ctx.repo, f.nodeId, f.path)}${op}${where}${missing}`;
    });
    paragraphs.push(para("files-1", "list", lines.join("\n"), [taskId, ...files.map((f) => f.nodeId)], { chips: uniqStrings(files.map((f) => f.op)).map((op) => chip("Change", op, OP_TONE[op] ?? "muted")) }));
  }
  const impact = detail?.impact;
  if (impact && impact.touchedButUnplanned.length > 0) {
    paragraphs.push(
      para("files-2", "gap", `The branch also changed ${countPhrase(impact.touchedButUnplanned.length, "file")} the plan does not name: ${joinPhrases(impact.touchedButUnplanned.slice(0, 4).map((f) => link(ctx.repo, f, baseName(f))))}.`, [taskId, ...impact.touchedButUnplanned.slice(0, 4)]),
    );
  }
  for (const [i, c] of (impact?.collisions ?? []).slice(0, 3).entries()) {
    const owner = c.owner ? `; ${link(ctx.repo, `person:${c.owner}`, c.owner)} owns both` : "";
    paragraphs.push(
      para(`files-collision-${i + 1}`, "gap", `This task and ${link(ctx.repo, `task:${c.slug}`, c.slug)} both touch ${link(ctx.repo, c.file, baseName(c.file))}${owner}.`, [taskId, `task:${c.slug}`, c.file], {
        chips: [chip("Collision", c.slug, "bad", "Two active tasks plan to change the same file.")],
      }),
    );
  }
  return section("files", "Files to touch", paragraphs, { text: detail?.plan ? "The plan names no file." : EMPTY_TEXT.taskNoPlan });
}

function taskCriteriaSection(task: TaskInfo, detail: TaskDetail | null): StorySection {
  const taskId = `task:${task.slug}`;
  const criteria = detail?.plan?.criteria ?? [];
  const packetCriteria = detail?.packet?.criteria ?? [];
  const paragraphs: Paragraph[] = [];
  if (criteria.length > 0) {
    const lines = criteria.map((text) => {
      const match = packetCriteria.find((p) => p.text.trim() === text.trim());
      const mark = match?.pass === true ? "[pass] " : match?.pass === false ? "[not yet] " : "";
      return `${mark}${text}`;
    });
    const passed = packetCriteria.filter((c) => c.pass === true).length;
    paragraphs.push(
      para("criteria-1", "list", lines.join("\n"), [taskId], {
        chips: packetCriteria.length > 0 ? [chip("Passing", `${passed} of ${packetCriteria.length}`, passed === packetCriteria.length ? "ok" : "warn", "Criteria the completion packet marks as passing.")] : [],
      }),
    );
  }
  return section("criteria", "Acceptance criteria", paragraphs, { text: detail?.plan ? "The plan lists no acceptance criterion." : EMPTY_TEXT.taskNoPlan });
}

function taskRiskSection(ctx: StoryContext, task: TaskInfo, detail: TaskDetail | null): StorySection {
  const taskId = `task:${task.slug}`;
  const rules = detail?.impact.riskRules ?? [];
  const paragraphs: Paragraph[] = [];
  if (task.risk !== "unset" || rules.length > 0) {
    const why = rules.length > 0 ? ` because ${joinPhrases(rules.slice(0, 3).map((r) => `a touched path contains \`${r.pattern}\` (${link(ctx.repo, r.file, baseName(r.file))})`))}` : "";
    paragraphs.push(
      para("risk-1", "fact", `Risk is ${task.risk === "unset" ? (rules[0]?.level ?? "unset") : task.risk}${why}.`, [taskId, ...rules.slice(0, 3).map((r) => r.file)], {
        chips: [chip("Risk", task.risk, RISK_TONE[task.risk] ?? "muted", `Risk: ${task.risk}`)],
      }),
    );
  }
  return section("risk", "Risk", paragraphs, { text: EMPTY_TEXT.taskRisk });
}

const VERDICT_TONE: Record<string, ChipTone> = { approved: "ok", "needs-work": "bad", pending: "warn" };

/** Packet headings the story renders as their own paragraphs, so the generic loop skips them. */
const PACKET_SECTIONS_SHOWN_ELSEWHERE = new Set(["Acceptance criteria", "Evidence"]);

/** Drop the `- (write something here)` scaffold lines; return "" when nothing real is left. */
function stripPlaceholders(body: string): string {
  const kept = body
    .split("\n")
    .filter((line) => line.trim() && !/^-?\s*\(.*\)\s*$/.test(line.trim()))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
  return kept;
}

function taskPacketSection(ctx: StoryContext, task: TaskInfo, detail: TaskDetail | null): StorySection {
  const taskId = `task:${task.slug}`;
  const packet = detail?.packet ?? null;
  const paragraphs: Paragraph[] = [];
  if (packet) {
    const verdict = packet.verdict ?? "pending";
    const who = packet.decidedBy ? ` ${link(ctx.repo, `person:${packet.decidedBy}`, packet.decidedBy)} decided it on ${formatDate(packet.decidedAt, ctx.now)}.` : " Nobody has decided it yet.";
    paragraphs.push(
      para("packet-1", "fact", `The completion packet reads ${verdict}.${who}`, [taskId, packet.decidedBy ? `person:${packet.decidedBy}` : null], {
        chips: [chip("Verdict", verdict, VERDICT_TONE[verdict] ?? "muted", `Packet verdict: ${verdict}`)],
      }),
    );
    for (const [heading, body] of Object.entries(packet.sections)) {
      // Criteria and evidence have their own paragraphs; scaffold placeholders say nothing.
      if (PACKET_SECTIONS_SHOWN_ELSEWHERE.has(heading)) continue;
      const flat = stripPlaceholders(body);
      if (!flat) continue;
      paragraphs.push(para(`packet-${heading.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`, "fact", `${heading}: ${flat}`, [taskId]));
    }
    if (packet.evidence.length > 0) {
      paragraphs.push(para("packet-evidence", "list", packet.evidence.join("\n"), [taskId], { chips: [chip("Evidence", String(packet.evidence.length), "muted", "Files saved under the task's evidence folder.")] }));
    }
  }
  return section("packet", "Completion packet", paragraphs, { text: EMPTY_TEXT.taskPacket, action: { label: "Write the packet", command: `reggie packet ${task.slug}` } });
}

function taskJournalSection(ctx: StoryContext, task: TaskInfo, detail: TaskDetail | null): StorySection {
  const entries = detail?.journal ?? ctx.journal.filter((e) => e.slug === task.slug);
  const paragraphs = entries.slice(0, 20).map((e, i) => journalParagraph(ctx, `journal-${i + 1}`, e));
  return section("journal", "Journal for this task", paragraphs, { text: EMPTY_TEXT.taskJournal, action: { label: "Record what you did", form: "journal", command: `reggie journal --slug ${task.slug} "…"` } });
}

// ---------------------------------------------------------------------------
// §2 Level 0: workspaceStory
// ---------------------------------------------------------------------------

const WORKSPACE_STATES: TaskState[] = ["ungroomed", "groomed", "planned", "in-process", "awaiting-decision", "done"];

/** The workspace landing page. Pure: everything comes from `workspaceSummary()`. */
export function workspaceStory(ws: WorkspaceSummary, now: Date = new Date()): Story {
  const needsYou: Paragraph[] = [];
  let n = 0;
  for (const repo of ws.repos) {
    for (const item of repo.needsYou) {
      n += 1;
      const owner = item.owner ? `${linkRoute(`#/repo/${encodeRouteId(repo.name)}/person/${encodeRouteId(item.owner)}`, item.owner)}, ` : "";
      needsYou.push(
        para(
          `needs-you-${n}`,
          "decision",
          `${linkRoute(`#/repo/${encodeRouteId(repo.name)}/task/${encodeRouteId(item.slug)}`, item.title || item.slug)} in ${linkRoute(`#/repo/${encodeRouteId(repo.name)}`, repo.name)} is waiting for a decision (${owner}${formatAge(item.age)}).`,
          [`task:${item.slug}`, `repo:${repo.name}`, item.owner ? `person:${item.owner}` : null],
          { chips: [chip("Age", formatAge(item.age), "muted")], decision: { slug: item.slug, canDecide: false, deciders: item.owner ? [item.owner] : [] } },
        ),
      );
    }
  }

  const repos: Paragraph[] = ws.repos.map((r, i) => {
    const counts = WORKSPACE_STATES.map((s) => ({ s, n: r.taskCounts[s] ?? 0 })).filter((c) => c.n > 0 && c.s !== "done");
    const taskWords = counts.length === 0 ? "No task is in flight." : `${joinPhrases(counts.map((c) => `${numberWord(c.n)} ${stateWords(c.s)}`))}.`;
    const coverage = pct(r.knowledge.noted + r.knowledge.inherited, r.knowledge.source);
    const last = r.lastJournal;
    const lastText = last ? ` Last recorded: "${firstSentence(last.text)}" (${last.person}, ${formatDate(last.date, now)}).` : " Nothing has been recorded in its journal yet.";
    const description = r.description ? ` is ${r.description.replace(/\s+$/, "").replace(/\.$/, "")}.` : " has no description in the workspace CLAUDE.md.";
    return para(
      `repos-${i + 1}`,
      "fact",
      `${linkRoute(`#/repo/${encodeRouteId(r.name)}`, r.name)}${description} ${r.primaryLanguage || "Mixed"}, ${countPhrase(r.codeFiles, "code file")}. ${taskWords} ${coverage}% of its source files have a note.${lastText}`,
      [`repo:${r.name}`],
      { chips: [chip("Branch", r.branch || "—", "muted"), chip("Documented", `${coverage}%`, coverage >= 60 ? "ok" : coverage >= 20 ? "warn" : "muted", "Share of source files with an own or inherited note.")] },
    );
  });

  const connect: Paragraph[] = ws.edges.map((e, i) => {
    const text =
      e.kind === "depends-on"
        ? `${linkRoute(`#/repo/${encodeRouteId(e.source)}`, e.source)} depends on ${linkRoute(`#/repo/${encodeRouteId(e.target)}`, e.target)} (package \`${e.via}\`).`
        : e.kind === "same-org"
          ? `${linkRoute(`#/repo/${encodeRouteId(e.source)}`, e.source)} and ${linkRoute(`#/repo/${encodeRouteId(e.target)}`, e.target)} share the GitHub org ${e.via}.`
          : `${linkRoute(`#/repo/${encodeRouteId(e.source)}`, e.source)} and ${linkRoute(`#/repo/${encodeRouteId(e.target)}`, e.target)} share ${e.via}.`;
    return para(`connect-${i + 1}`, "fact", text, [`repo:${e.source}`, `repo:${e.target}`], { chips: [chip("Link", e.kind, "muted", `Edge kind: ${e.kind}`)] });
  });

  return {
    scope: "workspace",
    id: ws.name,
    title: ws.name,
    subtitle: ws.single ? "One repo is being served. Start `reggie serve --workspace <dir>` to see sibling repos." : `${countPhrase(ws.repos.length, "repo")} in ${ws.root}.`,
    crumbs: [{ label: ws.name, route: "#/ws" }],
    sections: [
      section("needs-you", "Needs you", needsYou),
      section("repos", "Repos", repos, { text: EMPTY_TEXT.workspaceRepos }),
      section("connect", "How they connect", connect, { text: EMPTY_TEXT.workspaceConnect }),
    ],
    next: ws.repos.slice(0, 3).map((r) => ({ label: r.name, route: `#/repo/${encodeRouteId(r.name)}` })),
  };
}

// ---------------------------------------------------------------------------
// §3.3 explain: exactly four sentences
// ---------------------------------------------------------------------------

function sentence(text: string, refs: readonly (string | null | undefined)[]): ExplainSentence {
  return { text, refs: uniqStrings(refs) };
}

/**
 * The Spotlight card: what it is, who talks to it, who knows about it, what is happening to it.
 * Always four sentences, in that order, whatever the data looks like. Null for an unknown id.
 */
export function explain(ctx: StoryContext, id: string): Explain | null {
  const rawId = String(id ?? "").replace(/^ghost:(up|down):/, "");
  const node = ctx.node(rawId) ?? (rawId.startsWith("dir:") || rawId === ROOT_DIR_ID ? ctx.node(resolveDirId(ctx.graph, rawId) ?? "") : undefined);
  if (!node) return null;
  if (node.kind === "file") return explainFile(ctx, node);
  if (node.kind === "task") return explainTask(ctx, node);
  if (node.kind === "entity") return explainEntity(ctx, node);
  return explainContainer(ctx, node);
}

function explainActions(ctx: StoryContext, node: GraphNode, breaksFrom: string | null): Crumb[] {
  const route = routeFor(ctx.repo, node.id);
  const actions: Crumb[] = [{ label: "Go deeper", route }];
  if (breaksFrom) actions.push({ label: "Show what breaks if it changes", route: routeFor(ctx.repo, breaksFrom, { dir: "up", depth: 2 }) });
  actions.push({ label: "Add a note", route: `${route}#add-note` });
  return actions;
}

function explainCrumbs(ctx: StoryContext, node: GraphNode): Crumb[] {
  if (node.kind === "task") return [...repoCrumbs(ctx), { label: node.label, route: routeFor(ctx.repo, node.id) }];
  if (node.kind === "entity") return [...repoCrumbs(ctx), { label: node.label, route: routeFor(ctx.repo, node.id) }];
  if (node.kind === "repo" || node.id === ROOT_DIR_ID) return repoCrumbs(ctx);
  return pathCrumbs(ctx, node.path, node.kind === "dir");
}

function noteSentence(ctx: StoryContext, node: GraphNode, label: string): ExplainSentence {
  const stale = staleMap(ctx);
  const chain = node.kind === "file" ? noteChain(ctx, node.id, false) : noteChain(ctx, node.path === "" ? "" : dirPathOf(node.id), true);
  const own = node.knowledge.own;
  const staleHere = chain.flatMap((n) => n.entries.filter((e) => stale.has(staleKey(n.entity, e))).map((e) => ({ n, e })));
  const authors = uniqStrings(chain.flatMap((n) => n.entries.map((e) => e.author.replace(/\s*\(web\)$/, ""))));
  const inherited = node.knowledge.inherited;
  const lead = own > 0 ? `${label} carries ${countPhrase(own, "note entry", "note entries")} of its own` : `Nobody has written a note on ${label}`;
  const by = own > 0 && authors.length > 0 ? `, written by ${joinPhrases(authors.slice(0, 3))}` : "";
  const from = inherited > 0 ? `, and ${inherited === 1 ? "one entry applies" : `${numberWord(inherited)} entries apply`} from the repo and the folders above it` : own === 0 ? ", and nothing above it says anything either" : "";
  let text = `${lead}${by}${from}.`;
  if (staleHere.length > 0) {
    const first = staleHere[0];
    text += ` ${capitalise(countPhrase(staleHere.length, "entry", "entries"))} may be out of date${first ? ` (${first.n.entity}, written ${formatDate(first.e.date, ctx.now)})` : ""}.`;
  }
  return sentence(text, [node.id]);
}

function activitySentence(ctx: StoryContext, node: GraphNode, label: string): ExplainSentence {
  const history = node.history ?? node.aggregates?.history ?? historyFor(ctx.history, node.kind === "file" ? node.id : dirPathOf(node.id) === "." ? "./" : `${dirPathOf(node.id)}/`);
  const tasks = node.kind === "file" ? node.tasks : (node.aggregates?.tasks ?? []);
  const top = topAuthor(history ?? undefined);
  const parts: string[] = [];
  if (tasks.length > 0) parts.push(`${joinPhrases(tasks.slice(0, 3).map((s) => link(ctx.repo, `task:${s}`, s)))} ${tasks.length === 1 ? "plans" : "plan"} to touch ${label}`);
  else parts.push(`No task plans to touch ${label}`);
  const recentCommits = history?.commits30 ?? 0;
  if (history && recentCommits > 0) {
    parts.push(`it changed ${timesPhrase(recentCommits)} in the last 30 days${top ? `, last by ${link(ctx.repo, `person:${top.handle}`, top.handle)}` : ""}${history.lastTouched ? ` on ${formatDate(history.lastTouched, ctx.now)}` : ""}`);
  } else if (history?.lastTouched) {
    parts.push(`git last touched it on ${formatDate(history.lastTouched, ctx.now)}`);
  } else {
    parts.push("git recorded no change to it in the last year");
  }
  const journal = ctx.journal.find((e) => (e.slug && tasks.includes(e.slug)) || e.evidence.some((ev) => sourceNodeId(ev) === node.id));
  if (journal) parts.push(`the journal last said "${firstSentence(journal.text)}" (${journal.person}, ${formatDate(journal.date, ctx.now)})`);
  return sentence(`${parts.join("; ")}.`, [node.id, ...tasks.slice(0, 3).map((s) => `task:${s}`), top ? `person:${top.handle}` : null]);
}

function explainContainer(ctx: StoryContext, node: GraphNode): Explain {
  const isRepoNode = node.kind === "repo" || node.id === ROOT_DIR_ID;
  const label = isRepoNode ? link(ctx.repo, `repo:${ctx.repo}`, ctx.repo) : link(ctx.repo, node.id, dirPathOf(node.id));
  const agg = node.aggregates;
  const source = agg?.source ?? 0;
  const tested = testedClause(agg?.testedSource ?? 0);
  const lang = node.lang ? `${node.lang} ` : "";
  const what = sentence(
    `${label} is a ${lang}${isRepoNode ? "repo" : areaKindWord(node)} of ${countPhrase(source, "source file")}${tested ? `, ${tested}` : ""}, ${countPhrase(agg?.lines ?? node.lines, "line")} in all.`,
    [node.id],
  );

  const view = ctx.views.container();
  const areaId = isRepoNode ? null : (areaOf(ctx, node.id) ?? node.id);
  const inbound = areaId ? view.edges.filter((e) => e.target === areaId) : [];
  const outbound = areaId ? view.edges.filter((e) => e.source === areaId) : [];
  const talkParts: string[] = [];
  if (inbound.length > 0) {
    talkParts.push(`it is used by ${joinPhrases(inbound.slice(0, 3).map((e) => `${link(ctx.repo, e.source, areaLabelOf(ctx, e.source))} ${timesPhrase(e.weight ?? 1)}`))}`);
  } else talkParts.push("nothing else in the repo imports it");
  if (outbound.length > 0) {
    talkParts.push(`it imports from ${joinPhrases(outbound.slice(0, 3).map((e) => link(ctx.repo, e.target, areaLabelOf(ctx, e.target))))}`);
  } else talkParts.push("it imports nothing from the rest of the repo");
  const talks = sentence(`${capitalise(talkParts.join("; "))}.`, [node.id, ...inbound.slice(0, 3).map((e) => e.source), ...outbound.slice(0, 3).map((e) => e.target)]);

  const relied = mostReliedOn(ctx, node.id === ROOT_DIR_ID || node.kind === "repo" ? ROOT_DIR_ID : node.id);
  return {
    id: node.id,
    title: isRepoNode ? ctx.repo : dirPathOf(node.id),
    kind: node.kind,
    crumbs: explainCrumbs(ctx, node),
    route: routeFor(ctx.repo, node.id),
    sentences: [what, talks, noteSentence(ctx, node, label), activitySentence(ctx, node, label)],
    actions: explainActions(ctx, node, relied?.id ?? null),
  };
}

function capitalise(text: string): string {
  return `${text.charAt(0).toUpperCase()}${text.slice(1)}`;
}

function explainFile(ctx: StoryContext, node: GraphNode): Explain {
  const label = link(ctx.repo, node.id, baseName(node.path));
  const area = areaOf(ctx, node.id) ?? node.area;
  const what = sentence(
    `${label} is a ${node.lang || "plain"} file of ${countPhrase(node.lines, "line")}${area ? ` in ${link(ctx.repo, area, areaLabelOf(ctx, area))}` : ""}${node.entry ? `, and it is an entry point (${joinPhrases(node.entryKinds.map((k) => k.kind))})` : ""}.`,
    [node.id, area],
  );
  const { incoming, outgoing } = fileEdges(ctx, node.id);
  const importers = uniqStrings(incoming.map((e) => e.source));
  const imports = uniqStrings(outgoing.map((e) => e.target));
  const talks = sentence(
    `${importers.length === 0 ? "Nothing imports it" : `It is used by ${countPhrase(importers.length, "file")}, among them ${joinPhrases(importers.slice(0, 3).map((f) => link(ctx.repo, f, baseName(f))))}`}, and it ${imports.length === 0 ? "imports nothing else in the repo" : `imports ${countPhrase(imports.length, "file")}`}.`,
    [node.id, ...importers.slice(0, 3), ...imports.slice(0, 2)],
  );
  return {
    id: node.id,
    title: baseName(node.path),
    kind: node.kind,
    crumbs: explainCrumbs(ctx, node),
    route: routeFor(ctx.repo, node.id),
    sentences: [what, talks, noteSentence(ctx, node, label), activitySentence(ctx, node, label)],
    actions: explainActions(ctx, node, node.id),
  };
}

function explainTask(ctx: StoryContext, node: GraphNode): Explain {
  const slug = node.id.slice(5);
  const task = ctx.tasks.find((t) => t.slug === slug) ?? null;
  const state = (task?.state ?? node.state ?? "ungroomed") as TaskState;
  const label = link(ctx.repo, node.id, task?.title || node.label || slug);
  const what = sentence(`${label} is ${stateWords(state)}: ${stateDefinition(state)}`, [node.id]);

  const touched = ctx.graph.edges.filter((e) => e.kind === "touches" && e.source === node.id).map((e) => e.target);
  const areas = uniqStrings(touched.map((t) => areaOf(ctx, t)));
  const files = sentence(
    touched.length === 0
      ? "It names no file yet, so nothing on the map moves when it lands."
      : `It touches ${countPhrase(touched.length, "file")} — ${joinPhrases(touched.slice(0, 3).map((t) => link(ctx.repo, t, baseName(t))))} — ${areas.length === 0 ? "outside any area" : `in ${joinPhrases(areas.slice(0, 3).map((a) => link(ctx.repo, a, areaLabelOf(ctx, a))))}`}.`,
    [node.id, ...touched.slice(0, 3), ...areas.slice(0, 3)],
  );

  const noted = touched.filter((t) => (ctx.node(t)?.knowledge.own ?? 0) > 0);
  const notes = sentence(
    noted.length === 0
      ? `None of the files it touches has a note of its own, so whoever picks it up starts from the code.`
      : `${countPhrase(noted.length, "file")} it touches ${noted.length === 1 ? "has" : "have"} a note: ${joinPhrases(noted.slice(0, 3).map((t) => link(ctx.repo, t, baseName(t))))}.`,
    [node.id, ...noted.slice(0, 3)],
  );

  const entry = ctx.journal.find((e) => e.slug === slug);
  const activity = sentence(
    `${entry ? `The journal last said "${firstSentence(entry.text)}" (${entry.person}, ${formatDate(entry.date, ctx.now)})` : "Nothing has been recorded in the journal for it"}; ${task?.owner ? `${link(ctx.repo, `person:${task.owner}`, task.owner)} holds it` : "nobody holds it"} and it has been ${stateWords(state)} for ${formatAge(task?.age ?? node.age ?? null)}.`,
    [node.id, task?.owner ? `person:${task.owner}` : null],
  );

  return {
    id: node.id,
    title: task?.title || node.label || slug,
    kind: node.kind,
    crumbs: explainCrumbs(ctx, node),
    route: routeFor(ctx.repo, node.id),
    sentences: [what, files, notes, activity],
    actions: [
      { label: "Go deeper", route: routeFor(ctx.repo, node.id) },
      ...(touched[0] ? [{ label: "Show what breaks if it changes", route: routeFor(ctx.repo, touched[0], { dir: "up", depth: 2 }) }] : []),
      { label: "Add a note", route: `${routeFor(ctx.repo, node.id)}#add-note` },
    ],
  };
}

function explainEntity(ctx: StoryContext, node: GraphNode): Explain {
  const entity = node.id.slice(7);
  const kind = entity.split(":")[0] ?? "concept";
  const note = ctx.noteOf(entity);
  const entries = note?.entries ?? [];
  const annotated = ctx.graph.edges.filter((e) => e.kind === "annotates" && e.source === node.id).map((e) => e.target);
  const last = entries[entries.length - 1];
  return {
    id: node.id,
    title: node.label,
    kind: node.kind,
    crumbs: explainCrumbs(ctx, node),
    route: routeFor(ctx.repo, node.id),
    sentences: [
      sentence(`${node.label} is a ${kind} written up in the notes, with ${countPhrase(entries.length, "entry", "entries")}.`, [node.id]),
      sentence(
        annotated.length === 0
          ? "No entry cites a file, so nothing on the map is tied to it yet."
          : `Its entries cite ${joinPhrases(annotated.slice(0, 4).map((a) => link(ctx.repo, a, baseName(dirPathOf(a)))))}.`,
        [node.id, ...annotated.slice(0, 4)],
      ),
      sentence(entries.length === 0 ? "Nobody has written about it yet." : `Written by ${joinPhrases(uniqStrings(entries.map((e) => e.author)).slice(0, 3))}.`, [node.id]),
      sentence(last ? `The last entry was written on ${formatDate(last.date, ctx.now)}.` : "It has no dated entry.", [node.id]),
    ],
    actions: explainActions(ctx, node, annotated[0] ?? null),
  };
}

// ---------------------------------------------------------------------------
// Services and data flow (services-and-flows-spec.md §4)
// ---------------------------------------------------------------------------

/** How each service kind reads inside a sentence. */
const SERVICE_KIND_WORDS: Record<ServiceKind, string> = {
  database: "database",
  table: "table",
  kv: "KV namespace",
  bucket: "bucket",
  queue: "queue",
  "durable-object": "Durable Object",
  assets: "assets binding",
  api: "external API",
  var: "plain variable",
  secret: "secret",
  vectorize: "Vectorize index",
  ai: "AI binding",
  hyperdrive: "Hyperdrive binding",
  analytics: "analytics dataset",
};

export function serviceKindWord(kind: ServiceKind): string {
  return SERVICE_KIND_WORDS[kind] ?? "service";
}

/** The name a service goes by in prose: its binding when it has one, else its human name. */
function serviceName(node: ServiceNode): string {
  return node.binding ?? node.name;
}

function serviceLink(ctx: StoryContext, node: ServiceNode): string {
  return link(ctx.repo, node.id, serviceName(node));
}

/** The kind as its provider names it: Cloudflare calls a database D1 and a bucket R2. */
function providerKindWord(node: ServiceNode): string {
  const base = serviceKindWord(node.kind);
  if (node.provider === "cloudflare") {
    if (node.kind === "database") return `D1 ${base}`;
    if (node.kind === "bucket") return `R2 ${base}`;
    return base;
  }
  return node.provider ? `${node.provider} ${base}` : base;
}

/** "a" or "an", so a kind can be named without the sentence tripping over itself. */
function article(word: string): string {
  return /^[aeiou]/i.test(word) ? "an" : "a";
}

/** "the D1 database jacob-chat-logs", "a KV namespace", "an external API". */
function serviceDescription(node: ServiceNode): string {
  const kind = providerKindWord(node);
  const named = node.name && node.name !== serviceName(node) ? ` ${node.name}` : "";
  return named ? `the ${kind}${named}` : `${article(kind)} ${kind}`;
}

/** "three files read", "one file reads" — the count and its verb, agreeing. */
function filesVerb(n: number, verb: string): string {
  return `${countPhrase(n, "file")} ${n === 1 ? `${verb}s` : verb}`;
}

/**
 * Where the fact came from: a manifest *declares*, an example file only *documents*. The
 * difference is the whole point of the Needs-attention list, so the wording never blurs it.
 */
function serviceDeclaredPhrase(ctx: StoryContext, node: ServiceNode): string {
  const at = node.declaredAt;
  if (!at) return node.declared ? "It is declared, but the line was not recorded." : "No manifest declares it.";
  const where = `${link(ctx.repo, at.file, baseName(at.file))} at line ${at.line}`;
  return node.declared
    ? `It is declared in ${where}.`
    : `No manifest declares it; it is only documented in ${where}, which records the name and does not provision it.`;
}

/** Files on each side of one service, tests excluded — a test does not say what the product does. */
interface ServiceSides {
  readers: string[];
  writers: string[];
  touchers: string[];
  files: string[];
}

function serviceSides(index: ServiceIndex): Map<string, ServiceSides> {
  const out = new Map<string, ServiceSides>();
  for (const e of index.edges) {
    if (e.viaTest) continue;
    let hit = out.get(e.service);
    if (!hit) {
      hit = { readers: [], writers: [], touchers: [], files: [] };
      out.set(e.service, hit);
    }
    if (!hit.files.includes(e.file)) hit.files.push(e.file);
    const side = e.op === "read" ? hit.readers : e.op === "write" ? hit.writers : hit.touchers;
    if (!side.includes(e.file)) side.push(e.file);
  }
  for (const hit of out.values()) {
    hit.files.sort();
    hit.readers.sort();
    hit.writers.sort();
    hit.touchers.sort();
  }
  return out;
}

const NO_SIDES: ServiceSides = { readers: [], writers: [], touchers: [], files: [] };

/** "[[…|a.js]], [[…|b.js]] and two more" — files as links, never more than `shown` of them. */
function fileLinks(ctx: StoryContext, files: readonly string[], shown = 3): string {
  const links = files.slice(0, shown).map((f) => link(ctx.repo, f, baseName(f)));
  return joinPhrases(withMore(links, files.length));
}

/** The entity note written about a service, matched by binding or human name like `services.ts` does. */
function serviceNoteOf(ctx: StoryContext, node: ServiceNode): NoteFile | undefined {
  const wanted = new Set([node.binding, node.name].filter((v): v is string => Boolean(v)).map((v) => slugify(v, 80)));
  return ctx.notes.find((n) => n.kind === "entity" && wanted.has(slugify(n.entity.slice(n.entity.indexOf(":") + 1), 80)));
}

/** The Level-1 areas a set of files sits in. */
function areasOfFiles(ctx: StoryContext, files: readonly string[]): string[] {
  const l1 = ctx.views.level1();
  return uniqStrings(files.map((f) => l1.areaOf(f)));
}

/** Paragraphs per service in `talks-to` before the rest is summed up. */
const MAX_SERVICE_PARAGRAPHS = 24;
/** Services named inside one collapsed list paragraph. */
const MAX_LISTED_SERVICES = 12;

function needsAttentionSection(ctx: StoryContext, index: ServiceIndex, sides: Map<string, ServiceSides>): StorySection {
  const paragraphs: Paragraph[] = [];

  // 1. Undeclared secrets, most-read first: the single most valuable thing this page says.
  const secrets = index.undeclared.filter((s) => s.kind === "secret").sort((a, b) => b.uses - a.uses || a.name.localeCompare(b.name));
  secrets.forEach((node, i) => {
    const side = sides.get(node.id) ?? NO_SIDES;
    const bits = [
      `${serviceLink(ctx, node)} is read in ${countPhrase(node.uses, "place")} and no manifest declares it, so it is set outside this repo — a dashboard secret, or missing.`,
    ];
    if (node.declaredAt) bits.push(`It is documented in ${link(ctx.repo, node.declaredAt.file, baseName(node.declaredAt.file))} at line ${node.declaredAt.line}, which records the name and does not provision it.`);
    else bits.push("Nothing in the repo documents it.");
    if (side.files.length > 0) bits.push(`It is read from ${fileLinks(ctx, side.files)}.`);
    paragraphs.push(
      para(`needs-attention-secret-${i + 1}`, "gap", bits.join(" "), [node.id, ...side.files.slice(0, 5)], {
        chips: [
          chip("Undeclared", "yes", "bad", "The code reads this name; no manifest in the repo declares it."),
          chip("Call sites", String(node.uses), "muted", "Reads of this name outside tests."),
        ],
      }),
    );
  });

  // 2. Declared and never touched.
  index.unused.forEach((node, i) => {
    paragraphs.push(
      para(
        `needs-attention-unused-${i + 1}`,
        "gap",
        `${serviceLink(ctx, node)} is ${serviceDescription(node)}. ${serviceDeclaredPhrase(ctx, node)} No code outside tests touches it, so it is either dead or reached in a way Reggie cannot see.`,
        [node.id, node.declaredAt?.file],
        { chips: [chip("Unused", "yes", "warn", "Declared in a manifest; no call site was found.")] },
      ),
    );
  });

  // 3. Written from more than one area: two owners of one store, which is where surprises live.
  let n = 0;
  for (const node of index.services) {
    const side = sides.get(node.id) ?? NO_SIDES;
    if (side.writers.length < 2) continue;
    const areas = areasOfFiles(ctx, side.writers);
    if (areas.length < 2) continue;
    n += 1;
    const labels = areas.map((a) => link(ctx.repo, a, areaLabelOf(ctx, a)));
    paragraphs.push(
      para(
        `needs-attention-shared-${n}`,
        "gap",
        `${serviceLink(ctx, node)} is written from ${joinPhrases(labels)}. Two areas write to one ${serviceKindWord(node.kind)}, so a change to the shape in one can break the other: ${fileLinks(ctx, side.writers, 4)}.`,
        [node.id, ...areas, ...side.writers.slice(0, 5)],
        { chips: [chip("Writers", String(side.writers.length), "warn", "Files outside tests that write to this service.")] },
      ),
    );
  }

  return section("needs-attention", "Needs attention", paragraphs, {
    text: "Nothing needs attention: every name the code reads is declared, every declared binding is used, and no service is written from two areas.",
  });
}

function talksToSection(ctx: StoryContext, index: ServiceIndex, sides: Map<string, ServiceSides>): StorySection {
  const paragraphs: Paragraph[] = [];
  // Plain variables and secrets have sections of their own; this one is about the stores and
  // the APIs, which is what "talks to" means to a reader.
  const main = index.services.filter((s) => s.kind !== "var" && s.kind !== "secret");
  main.slice(0, MAX_SERVICE_PARAGRAPHS).forEach((node, i) => {
    const side = sides.get(node.id) ?? NO_SIDES;
    const bits = [`${serviceLink(ctx, node)} is ${serviceDescription(node)}.`, serviceDeclaredPhrase(ctx, node)];
    const parent = node.parent ? index.services.find((s) => s.id === node.parent) : undefined;
    if (parent) bits.push(`It lives in ${serviceLink(ctx, parent)}.`);
    const traffic: string[] = [];
    if (side.readers.length > 0) traffic.push(`${filesVerb(side.readers.length, "read")} it (${fileLinks(ctx, side.readers)})`);
    if (side.writers.length > 0) traffic.push(`${filesVerb(side.writers.length, "write")} to it (${fileLinks(ctx, side.writers)})`);
    if (side.touchers.length > 0 && side.readers.length === 0 && side.writers.length === 0) {
      traffic.push(`${filesVerb(side.touchers.length, "name")} it without an operation Reggie could classify (${fileLinks(ctx, side.touchers)})`);
    }
    bits.push(traffic.length > 0 ? `${capitalise(joinPhrases(traffic))}.` : "No code outside tests touches it.");
    const chips: Chip[] = [chip("Kind", node.kind, "muted", `Service kind: ${node.kind}`)];
    if (node.provider) chips.push(chip("Provider", node.provider, "info", `Provider: ${node.provider}`));
    if (!node.declared) chips.push(chip("Undeclared", "yes", "bad", "The code uses it; no manifest declares it."));
    paragraphs.push(para(`talks-to-${i + 1}`, "fact", bits.join(" "), [node.id, node.declaredAt?.file, ...side.files.slice(0, 5)], { chips }));
    const note = serviceNoteOf(ctx, node);
    if (note) paragraphs.push(...noteParagraphs(ctx, `talks-to-${i + 1}-note`, [note], [node.id]));
  });

  if (main.length > MAX_SERVICE_PARAGRAPHS) {
    const rest = main.slice(MAX_SERVICE_PARAGRAPHS);
    paragraphs.push(
      para("talks-to-rest", "list", `${countPhrase(rest.length, "other service")} on the map: ${joinPhrases(withMore(rest.slice(0, MAX_LISTED_SERVICES).map((s) => serviceLink(ctx, s)), rest.length))}.`, rest.map((s) => s.id)),
    );
  }

  const vars = index.services.filter((s) => s.kind === "var");
  if (vars.length > 0) {
    const names = withMore(vars.slice(0, MAX_LISTED_SERVICES).map((s) => serviceLink(ctx, s)), vars.length);
    const declared = vars.filter((s) => s.declared).length;
    paragraphs.push(
      para(
        "talks-to-vars",
        "list",
        `${countPhrase(vars.length, "plain variable")} ${vars.length === 1 ? "configures" : "configure"} the code rather than name a store: ${joinPhrases(names)}. ${declared === vars.length ? "Every one is declared." : `${numberWord(vars.length - declared)} of them ${vars.length - declared === 1 ? "is" : "are"} read from the environment with nothing in the repo declaring ${vars.length - declared === 1 ? "it" : "them"}.`}`,
        vars.map((s) => s.id),
      ),
    );
  }

  return section("talks-to", "What this repo talks to", paragraphs, {
    text: "No service was found. Reggie reads wrangler.toml, firebase.json, the SDK dependencies in package.json, `env.` and `process.env.` in the code, and literal fetch hosts.",
  });
}

function secretsSection(ctx: StoryContext, index: ServiceIndex, sides: Map<string, ServiceSides>): StorySection {
  const secrets = index.services.filter((s) => s.kind === "secret").sort((a, b) => b.uses - a.uses || a.name.localeCompare(b.name));
  const paragraphs = secrets.map((node, i) => {
    const side = sides.get(node.id) ?? NO_SIDES;
    const where = node.declared
      ? serviceDeclaredPhrase(ctx, node)
      : node.declaredAt
        ? `It comes from outside the repo. The name is written down in ${link(ctx.repo, node.declaredAt.file, baseName(node.declaredAt.file))} at line ${node.declaredAt.line}; the value is not.`
        : "It comes from outside the repo, and nothing here writes the name down.";
    const read = side.files.length > 0 ? ` It is read in ${countPhrase(node.uses, "place")}, from ${fileLinks(ctx, side.files)}.` : "";
    return para(`secrets-${i + 1}`, node.declared ? "fact" : "gap", `${serviceLink(ctx, node)} is a secret. ${where}${read}`, [node.id, node.declaredAt?.file, ...side.files.slice(0, 5)], {
      chips: [chip("Declared", node.declared ? "yes" : "no", node.declared ? "ok" : "bad", node.declared ? "A manifest declares it." : "Set outside this repo.")],
    });
  });
  return section("secrets", "Where the secrets come from", paragraphs, {
    text: "No credential-shaped name was found. A name ending in KEY, SECRET, TOKEN or PASSWORD that the code reads would appear here.",
  });
}

function notWiredSection(ctx: StoryContext, index: ServiceIndex): StorySection {
  const paragraphs = index.unused.map((node, i) =>
    para(
      `not-wired-${i + 1}`,
      "gap",
      `${serviceLink(ctx, node)} — ${serviceDescription(node)} — is declared and never used. ${serviceDeclaredPhrase(ctx, node)}`,
      [node.id, node.declaredAt?.file],
      { chips: [chip("Kind", node.kind, "muted", `Service kind: ${node.kind}`)] },
    ),
  );
  return section("not-wired", "What is not wired up", paragraphs, { text: "Every declared binding is used somewhere in the code." });
}

/**
 * The Services page (spec §4): what the repo talks to, in the order a reader needs it —
 * what is wrong first, then what is there, then the credentials, then the dead wiring.
 */
export function servicesStory(ctx: StoryContext, index: ServiceIndex): Story {
  const sides = serviceSides(index);
  const sections: StorySection[] = [
    needsAttentionSection(ctx, index, sides),
    talksToSection(ctx, index, sides),
    secretsSection(ctx, index, sides),
    notWiredSection(ctx, index),
  ];
  const undeclared = index.undeclared.length;
  const subtitle =
    undeclared === 0
      ? `${countPhrase(index.services.length, "service")}, every one of them declared.`
      : `${countPhrase(index.services.length, "service")}, ${numberWord(undeclared)} of them used in code and declared nowhere.`;

  return {
    scope: "services",
    id: ctx.repo,
    title: "What this repo talks to",
    subtitle,
    crumbs: [...repoCrumbs(ctx), { label: "Services", route: servicesRouteFor(ctx.repo) }],
    sections,
    next: [{ label: "Data flow", route: flowsRouteFor(ctx.repo) }],
  };
}

// --- one flow ---------------------------------------------------------------

/** A step's node id turned into the name a sentence can use. */
function flowNodeLabel(id: string): string {
  const value = String(id ?? "");
  if (value.startsWith("sym:")) {
    const hash = value.indexOf("#");
    return hash === -1 ? value.slice(4) : value.slice(hash + 1);
  }
  if (value.startsWith("resp:")) return "the response";
  if (value.startsWith("svc:")) return value.slice(value.lastIndexOf(":") + 1);
  return baseName(value);
}

/** The file a step's node lives in, or null for a service or the response. */
function flowNodeFile(id: string): string | null {
  const value = String(id ?? "");
  if (value.startsWith("svc:") || value.startsWith("resp:")) return null;
  if (value.startsWith("sym:")) {
    const hash = value.indexOf("#");
    return hash === -1 ? value.slice(4) : value.slice(4, hash);
  }
  return value || null;
}

/**
 * What a payload is, said without overstating it. An `exact` payload names the construct it
 * was read from; a `heuristic` one says the names came from the signature rather than the
 * data, which is the difference between knowing and guessing.
 */
function payloadPhrase(p: Payload | null): string | null {
  if (!p || p.fields.length === 0) return null;
  const fields = `{ ${p.fields.join(", ")} }`;
  return p.confidence === "heuristic"
    ? `${fields} — field names taken from the ${p.shape ?? "signature"}, not from the data`
    : `${fields}, read from ${p.shape ?? "a literal in the code"}`;
}

/** "What it sends is { a, b }, read from object literal." / "… is not derivable from the code." */
function payloadClause(p: Payload | null, lead: string): string {
  const phrase = payloadPhrase(p);
  return phrase ? `${lead} is ${phrase}.` : `${lead} is not derivable from the code.`;
}

/** "carrying { a, b }, read from request.json()" — the mid-sentence form. */
function carryingPhrase(p: Payload | null, verb = "carrying"): string {
  const phrase = payloadPhrase(p);
  return phrase ? `${verb} ${phrase}` : "and what it carries is not derivable from the code";
}

/** The service a step lands on, when §1 knows it. */
function flowServiceOf(services: readonly ServiceNode[] | undefined, id: string): ServiceNode | undefined {
  return services?.find((s) => s.id === id);
}

function flowStepParagraph(ctx: StoryContext, step: FlowStep, i: number, services: readonly ServiceNode[] | undefined): Paragraph {
  const number = `Step ${numberWord(i + 1)}.`;
  const from = `\`${flowNodeLabel(step.from)}\``;
  const toFile = flowNodeFile(step.to);
  const site = step.source.file;
  const at = `${link(ctx.repo, site, baseName(site))} at line ${step.source.line}`;
  // Where the callee lives, said once: the same file, or the other one plus the call site.
  const where = toFile === null || toFile === site ? `in ${at}` : `in ${link(ctx.repo, toFile, baseName(toFile))}, called from ${at}`;
  const chips: Chip[] = [];
  const bits: string[] = [number];

  if (i === 0) {
    bits.push(`The request arrives at \`${flowNodeLabel(step.to)}\` in ${at}, ${carryingPhrase(step.input)}.`);
    bits.push(step.output ? payloadClause(step.output, "The first thing it returns") : "What it returns is not derivable from the body alone; the response steps below say what it sends.");
  } else if (step.kind === "read" || step.kind === "write" || step.to.startsWith("svc:")) {
    const node = flowServiceOf(services, step.to);
    const what = node ? `, ${serviceDescription(node)},` : ", which no manifest declares,";
    const verb = step.kind === "read" ? "reads from" : step.kind === "write" ? "writes to" : "touches";
    const target = node ? serviceLink(ctx, node) : link(ctx.repo, step.to, flowNodeLabel(step.to));
    bits.push(`${from} ${verb} ${target}${what} calling \`${step.label}\` in ${at}.`);
    bits.push(payloadClause(step.input, "What it sends"));
    if (step.via) bits.push(`The binding arrived as the \`${step.via}\` parameter, resolved through one call site, so this operation is inferred rather than read off \`env\`.`);
  } else if (step.kind === "respond") {
    bits.push(`${from} answers with \`${step.label}\` in ${at}, ${carryingPhrase(step.output)}.`);
  } else if (step.kind === "import") {
    bits.push(`${from} enters the module ${toFile ? link(ctx.repo, toFile, baseName(toFile)) : flowNodeLabel(step.to)}, called from ${at}. No symbol of that name was found there, so what it does is not derivable.`);
  } else {
    bits.push(`${from} calls \`${step.label}\` ${where}, passing ${payloadPhrase(step.input) ?? "arguments the code does not name"}.`);
    bits.push(payloadClause(step.output, "What it returns"));
  }

  if (step.confidence === "heuristic") chips.push(chip("Confidence", "heuristic", "warn", "Resolved through a name, not a declaration."));
  const payload = step.input ?? step.output;
  if (payload) chips.push(chip("Payload", payload.confidence, payload.confidence === "exact" ? "ok" : "warn", payload.shape ? `Read from: ${payload.shape}` : "Payload shape"));
  else chips.push(chip("Payload", "not derivable", "muted", "Nothing in the code names what this step carries."));

  return para(`step-${i + 1}`, "fact", bits.join(" "), [step.from, step.to, step.source.file], {
    chips,
    source: { file: step.source.file, confidence: step.confidence },
  });
}

/**
 * "nine steps at hop one and nine at hop two went past what one hop may draw" — what a cap
 * actually cost, grouped by reason so the sentence never repeats itself. A `depth` drop names
 * the limit it hit, which is the depth the caller asked for and not always the ceiling.
 */
function dropPhrase(drops: readonly FlowDrop[]): string {
  const reasons: FlowDrop["reason"][] = ["hop-budget", "step-cap", "depth"];
  const clauses: string[] = [];
  for (const reason of reasons) {
    const group = drops.filter((d) => d.reason === reason);
    if (group.length === 0) continue;
    const noun = reason === "depth" ? "call" : "step";
    const parts = group.map((d, i) => (i === 0 ? `${countPhrase(d.count, noun)} at hop ${numberWord(d.hop)}` : `${numberWord(d.count)} at hop ${numberWord(d.hop)}`));
    const limit = (group[0]?.hop ?? 1) - 1;
    const tail =
      reason === "depth"
        ? `${group.length === 1 && group[0]?.count === 1 ? "was" : "were"} not followed, because the walk stops at ${countPhrase(limit, "hop")}`
        : reason === "hop-budget"
          ? "went past what one hop may draw"
          : "went past the total step budget";
    clauses.push(`${joinPhrases(parts)} ${tail}`);
  }
  return joinPhrases(clauses);
}

function flowGapsSection(ctx: StoryContext, flow: Flow): StorySection {
  const paragraphs: Paragraph[] = [];
  const missing = flow.steps.filter((s) => !s.input && !s.output);
  const guessed = flow.steps.filter((s) => s.input?.confidence === "heuristic" || s.output?.confidence === "heuristic");
  const inferred = flow.steps.filter((s) => s.via !== null);

  if (missing.length > 0 || guessed.length > 0) {
    const bits: string[] = [];
    if (missing.length > 0) {
      bits.push(
        `${capitalise(countPhrase(missing.length, "step"))} ${missing.length === 1 ? "carries" : "carry"} nothing this repo names: no object literal at the call site, no annotated parameter, no JSDoc, and no parameter list worth reading — so the payload is left empty rather than guessed (${fileLinks(ctx, uniqStrings(missing.map((s) => s.source.file)), 3)}).`,
      );
    }
    if (guessed.length > 0) {
      bits.push(
        `${capitalise(countPhrase(guessed.length, "step"))} ${guessed.length === 1 ? "shows" : "show"} field names taken from the callee's signature, not from the data that actually flows: the names are real, the values may be anything.`,
      );
    }
    paragraphs.push(para("not-derivable-1", "gap", bits.join(" "), uniqStrings([...missing, ...guessed].slice(0, 8).flatMap((s) => [s.from, s.to]))));
  }

  if (inferred.length > 0) {
    paragraphs.push(
      para(
        "not-derivable-inferred",
        "gap",
        `${capitalise(countPhrase(inferred.length, "operation"))} ${inferred.length === 1 ? "was" : "were"} found only by following a binding handed over as a parameter (${joinPhrases(uniqStrings(inferred.map((s) => `\`${s.via}\``)))}). One call site is not proof that every caller passes the same binding, so ${inferred.length === 1 ? "it is" : "they are"} marked inferred.`,
        uniqStrings(inferred.flatMap((s) => [s.from, s.to])),
      ),
    );
  }

  if (flow.truncated) {
    // The per-hop rule is only worth explaining when it is the rule that bit.
    const why = flow.dropped.some((d) => d.reason === "hop-budget")
      ? " Each hop may draw only its share of the step budget, so a wide entry point cannot spend what the deeper hops need: what is missing here is breadth, not depth."
      : "";
    paragraphs.push(para("not-derivable-truncated", "gap", `The walk stopped short: ${dropPhrase(flow.dropped)}.${why}`, [flow.entry]));
  }

  return section("not-derivable", "What could not be derived", paragraphs, {
    text: "Nothing is missing: every step's payload was read from a literal in the code, and no cap bit.",
  });
}

export interface FlowStoryOptions {
  /** Declared services from §1, so a step can name the store it lands on. */
  services?: readonly ServiceNode[];
}

/**
 * One flow, narrated step by step (spec §4). Each paragraph's refs are its own step's two
 * node ids, so reading the story walks the map.
 */
export function flowStory(ctx: StoryContext, flow: Flow, opts: FlowStoryOptions = {}): Story {
  const steps = flow.steps.map((step, i) => flowStepParagraph(ctx, step, i, opts.services));
  const reached = flow.services.map((id) => {
    const node = flowServiceOf(opts.services, id);
    return node ? serviceLink(ctx, node) : link(ctx.repo, id, flowNodeLabel(id));
  });
  const stepsSection = section("steps", "How the data moves", steps, {
    text: "Nothing was traced from this entry point: its body makes no call, no service operation and no response Reggie could resolve.",
  });
  const subtitle = `${countPhrase(flow.steps.length, "step")} over ${countPhrase(flow.depth, "hop")}, reaching ${flow.services.length > 0 ? joinPhrases(reached) : "no service"}.`;

  return {
    scope: "flow",
    id: flow.id,
    title: flow.title,
    subtitle,
    crumbs: [...repoCrumbs(ctx), { label: "Data flow", route: flowsRouteFor(ctx.repo) }, { label: flow.title, route: flowRouteFor(ctx.repo, flow.id) }],
    sections: [stepsSection, flowGapsSection(ctx, flow)],
    next: [{ label: "Services", route: servicesRouteFor(ctx.repo) }],
  };
}
