import { appendFileSync, lstatSync } from "node:fs";
import path from "node:path";
import { currentBranch, git } from "./git.js";
import { checksFile, evidenceRelDir, planFile, type RepoPaths } from "./paths.js";
import { parsePlan, planCriteria, type PlanCriterion } from "./plan.js";
import { ensureDir, readText } from "./util.js";

/*
 * Check records: what was verified, as data. One JSON object per line in
 * `.reggie/tasks/<slug>/checks.jsonl`, appended by `recordCheck`, which `reggie check` and the
 * `reggie_check` MCP tool both wrap. Only the task branch ever writes the file, so it is never a
 * file two writers share, and the latest line for a key wins by its position in the file, not by
 * its clock.
 *
 * The verb is a convenience and not a lock: anyone who can commit on the branch can write a line by
 * hand. What makes that harmless is the reader in `policy.ts`, which believes a record only as far
 * as it can verify it: the key must belong to a criterion of the plan on the base commit, every
 * evidence path must resolve on the branch tip, and `head` must be an ancestor of the tip with no
 * code changed since. `n` and `text` are for readers and are never trusted.
 */

export type CheckKind = "criterion" | "review";
export type CheckOutcome = "pass" | "fail";

export interface CheckRecord {
  v: 1;
  kind: CheckKind;
  /** `c:` and twelve hex characters (with `#2` for a duplicate) for a criterion, `r:<name>` for a review. */
  key: string;
  /** The criterion's number in the plan when it was recorded; 0 for a review. For readers only. */
  n: number;
  /** The criterion's first line when it was recorded; the review's name for a review. For readers only. */
  text: string;
  outcome: CheckOutcome;
  /** Repo-relative paths, each a file directly inside the task's evidence folder. */
  evidence: string[];
  /** One line. */
  note: string;
  person: string;
  tool: string;
  session: string;
  /** ISO instant. Shown to readers; never used to order records. */
  at: string;
  /** The commit the checkout was on. A pass is stale once code changes after it. */
  head: string;
}

/** A refusal of the verb. Nothing was written. */
export class CheckError extends Error {}

/** A line of the checks file is read only up to this many bytes; a longer one is not a record. */
export const MAX_CHECK_LINE_BYTES = 16 * 1024;
/** Lines past this many are not read, and the file is reported as unreadable from there on. */
export const MAX_CHECK_LINES = 5000;
const MAX_EVIDENCE_PER_RECORD = 50;
const MAX_PATH_CHARS = 500;
const MAX_NOTE_CHARS = 500;
const MAX_TEXT_CHARS = 1000;
const MAX_FIELD_CHARS = 200;

const CRITERION_KEY_RE = /^c:[0-9a-f]{12}(?:#[1-9][0-9]{0,3})?$/;
const REVIEW_NAME_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;
const REVIEW_KEY_RE = /^r:[a-z0-9][a-z0-9-]{0,63}$/;
const HEAD_RE = /^[0-9a-f]{40}$/;

/**
 * Characters that would sit unseen in a note, a page or a terminal: the C0 and C1 controls, the line
 * and paragraph separators, the zero-width and byte-order marks, and the bidirectional embeddings,
 * overrides and isolates, which can make a line read as something other than what it says.
 */
export const UNSAFE_TEXT_CHARS = /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2060-\u2069\ufeff]/g;

/** Free text as one safe line: line breaks become spaces, unseen characters go, whitespace collapses, and it is cut at `max`. */
export function cleanLine(value: string, max: number): string {
  const line = value.replace(/[\r\n\t\u2028\u2029]+/g, " ").replace(UNSAFE_TEXT_CHARS, "").replace(/\s+/g, " ").trim();
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}

export function isReviewName(name: string): boolean {
  return REVIEW_NAME_RE.test(name);
}

// ---------------------------------------------------------------------------
// The evidence path rule, shared by the verb (on disk) and the gate (on a commit)
// ---------------------------------------------------------------------------

export type EvidencePathResult = { ok: true; path: string; name: string } | { ok: false; why: string };

/**
 * A citation as the full repo-relative path of a file directly inside the task's evidence folder,
 * or the reason it cannot be one. Accepts a bare name, `evidence/<name>` and the full path. Nothing
 * here touches a disk or git: this is only what the words may say.
 */
export function evidencePath(slug: string, raw: string): EvidencePathResult {
  if (typeof raw !== "string" || raw.trim() === "") return { ok: false, why: "is empty" };
  if (raw.length > MAX_PATH_CHARS) return { ok: false, why: `is longer than ${MAX_PATH_CHARS} characters` };
  if (/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/.test(raw)) return { ok: false, why: "holds a control character or a line break" };
  if (raw.includes("\\")) return { ok: false, why: "holds a backslash; a path uses forward slashes" };
  const value = raw.trim().replace(/^(?:\.\/)+/, "");
  if (value.startsWith("/") || path.isAbsolute(value) || /^[A-Za-z]:/.test(value)) return { ok: false, why: "is an absolute path; evidence is cited relative to the repo" };
  if (value.split("/").includes("..")) return { ok: false, why: "holds a `..` segment" };
  const dir = evidenceRelDir(slug);
  let name: string;
  if (value.startsWith(dir)) name = value.slice(dir.length);
  else if (value.startsWith("evidence/")) name = value.slice("evidence/".length);
  else if (!value.includes("/")) name = value;
  else return { ok: false, why: `lies outside the task's evidence folder ${dir}` };
  if (name === "" || name === ".") return { ok: false, why: "names the evidence folder, not a file in it" };
  if (name.includes("/")) return { ok: false, why: `lies in a subfolder of the evidence folder; evidence files sit directly inside ${dir}` };
  if (name.startsWith("-")) return { ok: false, why: "has a name beginning with a dash, which a command would read as an option" };
  if (name.startsWith(":")) return { ok: false, why: "has a name beginning with a colon, which git reads as pathspec magic" };
  return { ok: true, path: `${dir}${name}`, name };
}

/** The same rule, then the file itself in a working tree: it must exist, be a regular file and not a link, and hold something. */
function evidenceOnDisk(root: string, slug: string, raw: string): string {
  const parsed = evidencePath(slug, raw);
  if (!parsed.ok) throw new CheckError(`evidence ${quote(raw)} ${parsed.why}.`);
  let st;
  try {
    st = lstatSync(path.join(root, parsed.path));
  } catch {
    throw new CheckError(`evidence ${quote(parsed.path)} does not exist. Save the command's output there first.`);
  }
  if (st.isSymbolicLink()) throw new CheckError(`evidence ${quote(parsed.path)} is a symbolic link; evidence is a regular file.`);
  if (st.isDirectory()) throw new CheckError(`evidence ${quote(parsed.path)} is a directory; evidence is a regular file.`);
  if (!st.isFile()) throw new CheckError(`evidence ${quote(parsed.path)} is not a regular file.`);
  if (st.size === 0) throw new CheckError(`evidence ${quote(parsed.path)} is empty. An empty file cannot be told from a redirect that failed; save the command and its exit status into it.`);
  return parsed.path;
}

/** A value as a refusal names it: cleaned, cut short, in backticks. */
function quote(value: string): string {
  return `\`${cleanLine(String(value), 120).replace(/`/g, "'")}\``;
}

// ---------------------------------------------------------------------------
// Choosing a criterion
// ---------------------------------------------------------------------------

/** The numbered criteria with their keys, as a refusal prints them. */
export function renderCriteriaList(criteria: readonly PlanCriterion[]): string {
  return criteria.map((c) => `  ${String(c.n).padStart(2)}. ${c.key}  ${cleanLine(c.text, 100)}`).join("\n");
}

/**
 * One criterion from a selector: its number, its key, or a leading label such as `AC12` when
 * exactly one criterion starts with it. `AC1` does not choose `AC12`: the label must end where the
 * selector does.
 */
export function selectCriterion(criteria: readonly PlanCriterion[], selector: string): PlanCriterion {
  const sel = selector.trim();
  const listing = `\nThe criteria of this plan:\n${renderCriteriaList(criteria)}`;
  if (sel === "") throw new CheckError(`name a criterion by its number, its key or its label.${listing}`);
  let hits: PlanCriterion[];
  if (/^\d+$/.test(sel)) hits = criteria.filter((c) => c.n === Number.parseInt(sel, 10));
  else if (sel.startsWith("c:")) hits = criteria.filter((c) => c.key === sel);
  else hits = criteria.filter((c) => c.text.startsWith(sel) && !/[A-Za-z0-9]/.test(c.text.charAt(sel.length)));
  if (hits.length === 1 && hits[0]) return hits[0];
  throw new CheckError(`${quote(sel)} matches ${hits.length === 0 ? "no criterion" : `${hits.length} criteria`} of this plan; name one by its number or its key.${listing}`);
}

// ---------------------------------------------------------------------------
// Writing a record
// ---------------------------------------------------------------------------

export interface CheckInput {
  slug: string;
  /** A criterion, by number, key or leading label. Exactly one of `criterion` and `review`. */
  criterion?: string;
  /** A review, by name: lowercase letters, digits and hyphens. */
  review?: string;
  outcome: string;
  evidence?: readonly string[];
  note?: string;
  /** The handle the record is attributed to. */
  person: string;
  tool: string;
  session: string;
  now?: Date;
}

export interface CheckResult {
  record: CheckRecord;
  /** The checks file the line was appended to. It is not committed; like a journal entry, that is the session's next commit. */
  file: string;
}

/**
 * Append one record. Every refusal is a `CheckError` raised before anything is written: a criterion
 * that cannot be chosen, a slug with no plan, a checkout that is not on `task/<slug>` (records ride
 * the branch), an outcome that is neither pass nor fail, a criterion passed with no evidence, an
 * evidence path that is not a non-empty regular file directly inside the task's evidence folder, and
 * a pass while a tracked file outside `.reggie/` is modified, because a check proves committed code.
 * A fail is always recordable. Nothing is staged and nothing is committed.
 */
export function recordCheck(paths: RepoPaths, input: CheckInput): CheckResult {
  const root = paths.root;
  const slug = input.slug;
  const planText = readText(planFile(paths, slug));
  if (planText === null) throw new CheckError(`there is no plan for ${slug} in this checkout, so there are no criteria to check.`);
  const on = currentBranch(root);
  if (on !== `task/${slug}`) throw new CheckError(`this checkout is on ${on}, not task/${slug}. Check records ride the task branch; run this in the task's own checkout.`);
  if (input.outcome !== "pass" && input.outcome !== "fail") throw new CheckError(`the outcome must be pass or fail, not ${quote(input.outcome)}.`);
  const outcome: CheckOutcome = input.outcome;
  const hasCriterion = input.criterion !== undefined && input.criterion !== "";
  const hasReview = input.review !== undefined && input.review !== "";
  if (hasCriterion === hasReview) throw new CheckError("name one thing to record: a criterion, or a review with --review <name>.");

  let kind: CheckKind;
  let key: string;
  let n = 0;
  let text: string;
  if (hasReview) {
    const name = String(input.review);
    if (!isReviewName(name)) throw new CheckError(`${quote(name)} is not a review name: lowercase letters, digits and hyphens only, such as code-review.`);
    kind = "review";
    key = `r:${name}`;
    text = name;
  } else {
    const criteria = planCriteria(parsePlan(planText).sections.get("Acceptance criteria") ?? "");
    const selector = String(input.criterion).trim();
    const known = selector.startsWith("c:") && !criteria.some((c) => c.key === selector) ? latestRecords(readChecks(readText(checksFile(paths, slug)) ?? "").records).get(selector) : undefined;
    kind = "criterion";
    if (known && known.kind === "criterion") {
      // A key that is in the file and no longer in the plan can still be superseded by naming it.
      key = known.key;
      n = known.n;
      text = known.text;
    } else {
      const chosen = selectCriterion(criteria, selector);
      key = chosen.key;
      n = chosen.n;
      text = cleanLine(chosen.text, MAX_TEXT_CHARS);
    }
  }

  const cited = input.evidence ?? [];
  if (cited.length > MAX_EVIDENCE_PER_RECORD) throw new CheckError(`a record cites at most ${MAX_EVIDENCE_PER_RECORD} evidence files.`);
  if (kind === "criterion" && outcome === "pass" && cited.length === 0) {
    throw new CheckError("a criterion passes only with evidence: save what proves it under the task's evidence folder and cite it with --evidence <file>.");
  }
  const evidence = Array.from(new Set(cited.map((e) => evidenceOnDisk(root, slug, e))));
  if (outcome === "pass") {
    const modified = modifiedOutsideReggie(root);
    if (modified.length > 0) {
      throw new CheckError(`a pass proves committed code, and this checkout has uncommitted changes outside .reggie/ (${modified.slice(0, 5).map(quote).join(", ")}${modified.length > 5 ? ", …" : ""}). Commit them first, then record the check.`);
    }
  }
  const head = git(["rev-parse", "--verify", "HEAD"], { cwd: root, allowFailure: true }).stdout.trim();
  if (!HEAD_RE.test(head)) throw new CheckError("this checkout has no commit yet, so there is nothing a check could prove.");

  const record: CheckRecord = {
    v: 1,
    kind,
    key,
    n,
    text,
    outcome,
    evidence,
    note: cleanLine(input.note ?? "", MAX_NOTE_CHARS),
    person: cleanLine(input.person, MAX_FIELD_CHARS),
    tool: cleanLine(input.tool, MAX_FIELD_CHARS),
    session: cleanLine(input.session, MAX_FIELD_CHARS),
    at: (input.now ?? new Date()).toISOString(),
    head,
  };
  const file = checksFile(paths, slug);
  const existing = readText(file);
  ensureDir(path.dirname(file));
  // A file a person edited may lack its last newline; the new record must still start its own line.
  appendFileSync(file, `${existing !== null && existing !== "" && !existing.endsWith("\n") ? "\n" : ""}${JSON.stringify(record)}\n`, "utf8");
  return { record, file };
}

/** Tracked files with uncommitted changes, staged or not, outside `.reggie/`. */
function modifiedOutsideReggie(root: string): string[] {
  const r = git(["status", "--porcelain", "-z", "--untracked-files=no"], { cwd: root, allowFailure: true });
  const fields = r.stdout.split("\0");
  const out: string[] = [];
  for (let i = 0; i < fields.length; i += 1) {
    const entry = fields[i] ?? "";
    if (entry.length < 4) continue;
    const status = entry.slice(0, 2);
    const file = entry.slice(3);
    // A rename or a copy is followed by the path it came from, as a field of its own.
    const from = /[RC]/.test(status) ? fields[(i += 1)] ?? "" : "";
    for (const p of [file, from]) if (p !== "" && !p.startsWith(".reggie/")) out.push(p);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Reading records
// ---------------------------------------------------------------------------

export interface BadCheckLine {
  /** 1-based line number in the checks file. */
  line: number;
  why: string;
}

export interface ChecksRead {
  /** The valid records, in file order. */
  records: CheckRecord[];
  /** Lines that are not records. Each one is a refusal for the policy: a file nobody can read fully proves nothing. */
  bad: BadCheckLine[];
}

const RECORD_KEYS = new Set(["v", "kind", "key", "n", "text", "outcome", "evidence", "note", "person", "tool", "session", "at", "head"]);

/**
 * Parse a checks file without ever throwing. A line is a record only when it is a JSON object of
 * version 1 holding exactly the known fields with the right types; anything else is counted by line
 * number. A record is rebuilt field by field from what was parsed, so nothing a line carries beyond
 * those fields, a `__proto__` key included, goes anywhere.
 */
export function readChecks(content: string): ChecksRead {
  const records: CheckRecord[] = [];
  const bad: BadCheckLine[] = [];
  const lines = content.replace(/\r\n/g, "\n").split("\n");
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? "";
    if (line.trim() === "") continue;
    if (i >= MAX_CHECK_LINES) {
      bad.push({ line: i + 1, why: `the file holds more than ${MAX_CHECK_LINES} lines; nothing from here on was read` });
      break;
    }
    const parsed = parseRecordLine(line);
    if (typeof parsed === "string") bad.push({ line: i + 1, why: parsed });
    else records.push(parsed);
  }
  return { records, bad };
}

function parseRecordLine(line: string): CheckRecord | string {
  if (Buffer.byteLength(line, "utf8") > MAX_CHECK_LINE_BYTES) return "longer than 16 KB";
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch {
    return "not JSON";
  }
  if (value === null || typeof value !== "object" || Array.isArray(value)) return "not a JSON object";
  const o = value as Record<string, unknown>;
  for (const k of Object.keys(o)) if (!RECORD_KEYS.has(k)) return `holds a field that is not part of a record (${cleanLine(k, 40)})`;
  const str = (k: string, max: number): string | null => (typeof o[k] === "string" && (o[k] as string).length <= max ? (o[k] as string) : null);
  if (o.v !== 1) return "not a version 1 record";
  if (o.kind !== "criterion" && o.kind !== "review") return "kind is neither criterion nor review";
  const key = str("key", 80);
  if (key === null || !(o.kind === "criterion" ? CRITERION_KEY_RE : REVIEW_KEY_RE).test(key)) return "key is not a criterion or review key";
  if (o.outcome !== "pass" && o.outcome !== "fail") return "outcome is neither pass nor fail";
  if (!Array.isArray(o.evidence) || o.evidence.length > MAX_EVIDENCE_PER_RECORD || !o.evidence.every((e) => typeof e === "string" && e.length <= MAX_PATH_CHARS)) return "evidence is not a list of paths";
  if (typeof o.n !== "number" || !Number.isInteger(o.n) || o.n < 0 || o.n > 100000) return "n is not a criterion number";
  const text = str("text", MAX_TEXT_CHARS);
  const note = str("note", MAX_NOTE_CHARS);
  const person = str("person", MAX_FIELD_CHARS);
  const tool = str("tool", MAX_FIELD_CHARS);
  const session = str("session", MAX_FIELD_CHARS);
  const at = str("at", 40);
  const head = str("head", 40);
  if (text === null || note === null || person === null || tool === null || session === null) return "a text field is missing, not a string, or too long";
  if (at === null || !Number.isFinite(Date.parse(at))) return "at is not an instant";
  if (head === null || !HEAD_RE.test(head)) return "head is not a 40-character commit id";
  return { v: 1, kind: o.kind, key, n: o.n, text, outcome: o.outcome, evidence: (o.evidence as string[]).slice(), note, person, tool, session, at, head };
}

/** The record that counts for each key: the last one in the file. A later fail supersedes a pass and a later pass a fail. */
export function latestRecords(records: readonly CheckRecord[]): Map<string, CheckRecord> {
  const latest = new Map<string, CheckRecord>();
  for (const r of records) latest.set(r.key, r);
  return latest;
}
