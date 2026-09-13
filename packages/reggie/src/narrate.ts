import type { Paragraph, Story, StorySection } from "./story.js";

/**
 * A story, spoken. The story column is already written in listener register (no paths or slugs
 * in the prose, links carrying the entities), so narration is mostly a matter of flattening:
 * links to their labels, lists to sentences, chips and sources to a short spoken aside, and
 * empty sections to the one sentence that says why they are empty. One function for every
 * scope, so anything the page can show can also be heard.
 */
export interface NarrationSection {
  id: string;
  heading: string;
  text: string;
}

export interface Narration {
  title: string;
  /** The whole script, ready for a voice: intro, sections, outro. */
  script: string;
  sections: NarrationSection[];
  words: number;
  /** A rough duration at a spoken pace, in seconds. */
  seconds: number;
}

/** Spoken words per minute, for the duration estimate. */
const WORDS_PER_MINUTE = 150;

/** `[[route|label]]` → `label`; backticks dropped; a trailing `|extra` inside a link ignored. */
export function spokenText(text: string): string {
  return String(text ?? "")
    .replace(/\[\[([^\]|]+)\|([^\]|]+)(?:\|[^\]]+)?\]\]/g, "$2")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/\s*·\s*/g, ", ")
    .replace(/\s+/g, " ")
    .trim();
}

/** A file or folder path, said so a listener can follow it: `src/big/a01.ts` → "a01 dot ts, in src, big". */
export function spokenPath(p: string): string {
  const clean = p.replace(/\/+$/, "");
  const parts = clean.split("/").filter(Boolean);
  const last = parts.pop() ?? clean;
  const name = last.replace(/\.([a-z0-9]+)$/i, " dot $1");
  return parts.length > 0 ? `${name}, in ${parts.join(", ")}` : name;
}

/** Sentences end with a full stop, so the voice pauses where the reader's eye would. */
function sentence(text: string): string {
  const t = text.trim();
  if (!t) return "";
  return /[.!?…]$/.test(t) ? t : `${t}.`;
}

/** A path has a slash; a bare file name has one of the extensions the graph knows. A sentence's own full stop is never part of either. */
const PATH_RE = /(?<![\w/.])((?:[\w.-]+\/)+[\w-]+(?:\.[A-Za-z0-9]+)*)\/?(?![\w/])/g;
const FILE_RE = /(?<![\w/.])([\w-]+\.(?:ts|tsx|js|jsx|mjs|cjs|rs|swift|kt|kts|go|py|md|json|yaml|yml|toml|css|html|sh|sql))(?![\w/])(?!\.\w)/g;

/** Paths and file names left in prose are spoken as such; everything else is spoken as written. */
function spokenProse(text: string): string {
  return spokenText(text)
    .replace(PATH_RE, (m) => spokenPath(m))
    .replace(FILE_RE, (m) => m.replace(/\.([A-Za-z0-9]+)$/, " dot $1"));
}

function spokenParagraph(p: Paragraph): string {
  const body = spokenProse(p.text);
  switch (p.kind) {
    case "list": {
      const items = body
        .split(/\s*(?:\n|(?<=\.) (?=[A-Z]))\s*/)
        .map((s) => s.trim())
        .filter(Boolean);
      // The text arrived with newlines collapsed by spokenProse; split on the original instead.
      const raw = spokenText(p.text).split("\n").map((s) => spokenProse(s).trim()).filter(Boolean);
      const list = raw.length > 1 ? raw : items;
      if (list.length === 0) return "";
      if (list.length === 1) return sentence(list[0] ?? "");
      return list.map((item, i) => sentence(`${i === 0 ? "First" : i === list.length - 1 ? "And last" : "Next"}, ${lowerFirst(item)}`)).join(" ");
    }
    case "note": {
      const s = p.source;
      const who = s?.author ? ` by ${spokenText(s.author)}` : "";
      const when = s?.date ? ` on ${s.date}` : "";
      const stale = s?.stale ? " The code has changed since it was written, so it may be out of date." : "";
      return `${sentence(`A note${who}${when} says: ${body}`)}${stale}`;
    }
    case "journal": {
      const s = p.source;
      const who = s?.person ? spokenText(s.person) : "someone";
      const tool = s?.tool && s.tool !== "human" ? `, working in ${s.tool},` : "";
      return sentence(`${who}${tool} wrote: ${body}`);
    }
    case "commit":
      return sentence(`A commit says: ${body}`);
    case "decision":
      return sentence(body);
    case "gap":
      return sentence(body);
    default:
      return sentence(body);
  }
}

function lowerFirst(s: string): string {
  return s.length > 0 && /^[A-Z][a-z]/.test(s) ? s[0]!.toLowerCase() + s.slice(1) : s;
}

function spokenSection(sec: StorySection): NarrationSection | null {
  const parts = sec.paragraphs.map(spokenParagraph).filter(Boolean);
  if (parts.length === 0) {
    const why = sec.empty?.text ? sentence(spokenProse(sec.empty.text)) : "";
    if (!why) return null;
    return { id: sec.id, heading: sec.heading, text: why };
  }
  return { id: sec.id, heading: sec.heading, text: parts.join(" ") };
}

export interface NarrateOptions {
  /** Say the section headings before their text. Default true. */
  headings?: boolean;
  /** The name to say for the repo or product, for the intro. */
  repo?: string;
}

export function narrate(story: Story, opts: NarrateOptions = {}): Narration {
  const headings = opts.headings ?? true;
  const sections = story.sections.map(spokenSection).filter((s): s is NarrationSection => s !== null);
  const title = spokenText(story.title);
  const subtitle = story.subtitle ? sentence(spokenProse(story.subtitle)) : "";
  // A task's subtitle is its state, which the first section says again in full; say it once.
  const repeated = subtitle !== "" && sections.some((s) => s.text.includes(subtitle.replace(/^[^,]*, /, "").replace(/\.$/, "")));
  const intro = [sentence(`This is Reggie${opts.repo ? `, on ${opts.repo}` : ""}, on ${storyKindWord(story.scope)} ${title}`), repeated ? "" : subtitle].filter(Boolean).join(" ");
  const body = sections.map((s) => (headings ? `${sentence(s.heading)} ${s.text}` : s.text)).join("\n\n");
  const outro = sentence(`That is everything Reggie can say about ${title} from the repository today`);
  const script = [intro, body, outro].filter(Boolean).join("\n\n");
  const words = script.split(/\s+/).filter(Boolean).length;
  return { title, script, sections, words, seconds: Math.round((words / WORDS_PER_MINUTE) * 60) };
}

function storyKindWord(scope: string): string {
  switch (scope) {
    case "task":
      return "the task";
    case "area":
      return "the area";
    case "file":
      return "the file";
    case "repo":
      return "the repository";
    case "workspace":
      return "the workspace";
    case "services":
      return "the services of";
    case "flow":
      return "the data flow";
    default:
      return "";
  }
}
