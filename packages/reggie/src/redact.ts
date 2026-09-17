/*
 * What happens to text before it may be written into the journal, and so into git.
 *
 * Three passes, in an order that matters. Structure goes first: fenced code blocks and table rows are
 * dropped whole, because that is where pasted output lives. Then secret shapes, addresses and local
 * paths are replaced by a fixed word, on the text as it was written, before any marker is stripped: a
 * flattener that ran first would take the underscore out of a key prefix and the pattern would no
 * longer know it. Then the text is flattened to one line of plain prose, which is what makes forging
 * impossible rather than unlikely: a quotation that is one line and never begins a line of the file
 * cannot be an entry header, a trailer or a front-matter fence, whatever it says. The patterns run once
 * more over the flat line, and the result is cut to length.
 *
 * None of this is a guarantee. Text is filtered by kind before it gets here (only an assistant's
 * closing message is ever eligible) and by pattern here, and an assistant can still repeat something
 * private the owner said in words no pattern knows. The review point is that the verb never commits,
 * prints every character it wrote, and has a dry run.
 */

/** What every withheld passage becomes. One fixed word, so nothing about the passage survives. */
export const WITHHELD = "[withheld]";

/** The longest quotation an entry carries: about 45 seconds read aloud. */
export const MAX_QUOTE_CHARS = 800;

export interface Redacted {
  text: string;
  /** How many passages were replaced. */
  withheld: number;
}

export interface CleanText extends Redacted {
  /** True when the text was longer than the limit and was cut. */
  cut: boolean;
}

/** Roots a local absolute path starts with. A bare leading slash is not enough: `/api/journal` is a route, not a path. */
const PATH_ROOTS = "Users|home|root|var|private|tmp|etc|opt|usr|mnt|srv|Volumes|Library|Applications|System";

const PATH_CHARS = `[^\\s"'\`)\\]>]`;
const PATH_TAIL = `${PATH_CHARS}*(?: [^\\s"'\`)\\]>/]+/${PATH_CHARS}*)*`;

const PATTERNS: RegExp[] = [
  // PEM blocks, whole; an opening line with no closing one takes the rest of the text with it.
  /-----BEGIN [A-Z0-9 ]+-----[\s\S]*?-----END [A-Z0-9 ]+-----/g,
  /-----BEGIN [A-Z0-9 ]+-----[\s\S]*/g,
  // Provider key shapes.
  /\bsk-[A-Za-z0-9_-]{20,}/g,
  /\bgh[pousr]_[A-Za-z0-9]{20,}/g,
  /\bgithub_pat_[A-Za-z0-9_]{20,}/g,
  /\bxox[a-z]-[A-Za-z0-9-]{10,}/g,
  /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g,
  /\bAIza[0-9A-Za-z_-]{30,}/g,
  // Three base64url segments joined by dots, the first opening the way every JWT header does.
  /\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}/g,
  // The header word as HTTP writes it, and a value that holds a digit, so "Bearer authentication" in a sentence is left.
  /\bBearer\s+(?=[A-Za-z0-9._~+/=-]*[0-9])[A-Za-z0-9._~+/=-]{8,}/g,
  // name=value or name: value, where the name says what the value is. The word alone, in a sentence, is left.
  /\b[A-Za-z0-9_.-]*(?:secret|token|password|passwd|api[_ -]?key|credential)[A-Za-z0-9_.-]*\s*[=:]\s*(?:"[^"\n]*"|'[^'\n]*'|`[^`\n]*`|[^\s,;]+)/gi,
  /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g,
  // Home-relative and absolute local paths, and a Windows drive path. A folder name with a space in it
  // would end the match early and leave the rest of the path behind, so the match carries on across a
  // space whenever the next word runs straight into a slash. That can take a neighbouring relative
  // path with it, which is the direction to be wrong in.
  new RegExp(`(?<![A-Za-z0-9._~:/-])~/${PATH_TAIL}`, "g"),
  new RegExp(`(?<![A-Za-z0-9._~:/-])/(?:${PATH_ROOTS})/${PATH_TAIL}`, "g"),
  /\b[A-Za-z]:\\[^\s"'`)\]>]+/g,
];

/** Base64-like runs long enough to be a key. Only a run that mixes cases and digits: a commit id is hex, and is left. */
const LONG_RUN = /[A-Za-z0-9+/=_-]{40,}/g;

const URL_RE = /\b([a-z][a-z0-9+.-]*):\/\/([^\s<>"'`)\]]+)/gi;

/** A URL without its userinfo, query and fragment. Counts as withheld when it carried a login or a query. */
function stripUrls(text: string): Redacted {
  let withheld = 0;
  const out = text.replace(URL_RE, (_all, scheme: string, rest: string) => {
    const trailing = /[.,;:!?]+$/.exec(rest)?.[0] ?? "";
    // A file URL is a local path with a scheme in front of it.
    if (scheme.toLowerCase() === "file") {
      withheld += 1;
      return `${WITHHELD}${trailing}`;
    }
    let body = trailing ? rest.slice(0, -trailing.length) : rest;
    const cutAt = body.search(/[?#]/);
    const hadQuery = cutAt >= 0 && body[cutAt] === "?";
    if (cutAt >= 0) body = body.slice(0, cutAt);
    const slash = body.indexOf("/");
    const authority = slash >= 0 ? body.slice(0, slash) : body;
    const at = authority.lastIndexOf("@");
    if (at >= 0) body = authority.slice(at + 1) + (slash >= 0 ? body.slice(slash) : "");
    if (at >= 0 || hadQuery) withheld += 1;
    return `${scheme}://${body}${trailing}`;
  });
  return { text: out, withheld };
}

/** Replace every secret shape, address and local path with the fixed word, and say how many there were. */
export function redactText(text: string): Redacted {
  const urls = stripUrls(text);
  let out = urls.text;
  let withheld = urls.withheld;
  const hide = (): string => {
    withheld += 1;
    return WITHHELD;
  };
  for (const re of PATTERNS) out = out.replace(re, hide);
  out = out.replace(LONG_RUN, (run) => (/[a-z]/.test(run) && /[A-Z]/.test(run) && /[0-9]/.test(run) ? hide() : run));
  return { text: out, withheld };
}

/** Fenced code blocks and table rows, removed whole. An opening fence with no closing one takes the rest. */
export function dropBlocks(text: string): string {
  const kept: string[] = [];
  let fence: string | null = null;
  for (const line of text.replace(/\r\n?/g, "\n").split("\n")) {
    const m = /^\s{0,3}(`{3,}|~{3,})/.exec(line);
    if (fence !== null) {
      if (m && m[1] && m[1][0] === fence[0] && m[1].length >= fence.length) fence = null;
      continue;
    }
    if (m && m[1]) {
      fence = m[1];
      continue;
    }
    if (/^\s*\|/.test(line)) continue;
    kept.push(line);
  }
  return kept.join("\n");
}

// NUL and the other C0 controls, DEL and the C1 controls, the zero-width and bidirectional controls,
// the line and paragraph separators, the byte-order mark, and the replacement character that damaged
// UTF-8 decodes to. Newline and tab are whitespace and are collapsed afterwards, not removed.
const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F\u061C\u200B-\u200F\u2028-\u202E\u2060-\u2069\uFEFF\uFFFD]/g;

/**
 * One line of plain prose. Heading, list, quote and emphasis markers and backticks go; a Markdown
 * link keeps its label; a rule line goes; control characters go; all whitespace, newlines included,
 * becomes single spaces.
 */
export function flattenText(text: string): string {
  const lines = text
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) =>
      line
        .replace(/^\s*(?:[-*_]\s*){3,}$/, "")
        .replace(/^\s*#{1,6}\s+/, "")
        .replace(/^\s*(?:>\s?)+/, "")
        .replace(/^\s*(?:[-*+]|\d{1,3}[.)])\s+(?:\[[ xX]\]\s+)?/, ""),
    );
  return lines
    .join(" ")
    .replace(/!?\[([^\]\n]*)\]\([^)\n]*\)/g, "$1")
    .replace(/[`*]/g, "")
    .replace(/(^|[^\p{L}\p{N}])_+(?=\S)/gu, "$1")
    .replace(/(?<=\S)_+(?=$|[^\p{L}\p{N}])/gu, "")
    .replace(/~~/g, "")
    .replace(CONTROL_CHARS, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * At most `max` characters, counted as code points so a character is never split. The cut falls after
 * the last sentence end inside the limit when there is one, else at the last space, and then the text
 * ends with an ellipsis so the reader can see it stops short.
 */
export function capText(text: string, max: number = MAX_QUOTE_CHARS): { text: string; cut: boolean } {
  const chars = Array.from(text);
  if (chars.length <= max) return { text, cut: false };
  // One character past the limit is looked at, so a sentence that ends exactly on the limit is seen to end.
  const probe = chars.slice(0, max + 1).join("");
  let end = -1;
  for (const m of probe.matchAll(/[.!?]["')\]”’]?(?=\s)/g)) {
    const stop = m.index + m[0].length;
    if (Array.from(probe.slice(0, stop)).length <= max) end = stop;
  }
  if (end > 0) return { text: probe.slice(0, end), cut: true };
  const room = chars.slice(0, max - 1).join("");
  const space = room.lastIndexOf(" ");
  return { text: `${(space > 0 ? room.slice(0, space) : room).trimEnd()}…`, cut: true };
}

/** `[[` and `]]` pulled apart, so nothing in the text can be read as the web view's `[[route|label]]` link. */
export function breakLinks(text: string): string {
  return text.replace(/\[(?=\[)/g, "[ ").replace(/\](?=\])/g, "] ");
}

/** Everything a passage goes through on its way to the journal: blocks dropped, redacted, flattened, redacted again, cut. */
export function cleanText(raw: string, max: number = MAX_QUOTE_CHARS): CleanText {
  const first = redactText(dropBlocks(raw));
  const second = redactText(flattenText(first.text));
  // Last, because a withheld word standing right after a bracket would otherwise make a `[[` of its own.
  const capped = capText(breakLinks(second.text), max);
  return { text: capped.text, withheld: first.withheld + second.withheld, cut: capped.cut };
}
