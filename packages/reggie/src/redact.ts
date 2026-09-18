/*
 * What happens to text before it may be written into the journal, and so into git.
 *
 * Passes, in an order that matters. First the invisible characters go, so nothing hides a secret by
 * splitting it with a zero-width joiner. Then fenced code blocks and table rows are dropped whole,
 * because that is where pasted output lives. Then secret shapes, addresses and local paths are
 * replaced by a fixed word, on the text as it was written, before any marker is stripped: a flattener
 * that ran first would take the underscore out of a key prefix and the pattern would no longer know
 * it. Then the text is flattened to one line of plain prose, which is what makes forging impossible
 * rather than unlikely: a quotation that is one line and never begins a line of the file cannot be an
 * entry header, a trailer or a front-matter fence, whatever it says. The patterns run once more over
 * the flat line, and the result is cut to length.
 *
 * None of this is a guarantee, and the number of passages withheld says nothing about what was missed.
 * No pattern catches a secret spoken in prose ("the password is X"), a key with no known prefix and no
 * mixed case (a hex or UUID key), a value passed as a bare flag (`--password X`, `curl -u a:b`), a
 * phone number, an IP, an internal hostname, a client or a person's name, or a relative path holding a
 * username. Text is filtered by kind before it gets here (only an assistant's closing message is ever
 * eligible), which keeps most secrets out because they live in tool output, not in the assistant's own
 * prose; and by pattern here, which errs toward withholding. The real review point is that the verb
 * never commits, prints every character it wrote, and has a dry run.
 */

/** What every withheld passage becomes. One fixed word, so nothing about the passage survives. */
export const WITHHELD = "[withheld]";

/** The longest quotation an entry carries: about 45 seconds read aloud. */
export const MAX_QUOTE_CHARS = 800;

/**
 * The most raw text the redaction passes will look at. A closing message is only ever quoted up to
 * MAX_QUOTE_CHARS, so a longer one loses nothing in the output; the cap is what keeps a hostile
 * megabyte-long line (a commit subject in a hostile clone, say) from reaching the patterns at full
 * length and spending minutes there. Cut at a whitespace boundary so a token is not split into a
 * fragment.
 */
export const REDACT_INPUT_CAP = 32 * 1024;

export interface Redacted {
  text: string;
  /** How many passages were replaced. */
  withheld: number;
}

export interface CleanText extends Redacted {
  /** True when the text was longer than the limit and was cut. */
  cut: boolean;
}

/**
 * The characters removed before anything else looks at the text: NUL and the other C0 and C1 controls
 * (newline and tab kept, as whitespace), every format character (`\p{Cf}`: soft hyphen, the zero-width
 * spaces and joiners, the bidirectional controls, the deprecated tag characters, the byte-order mark),
 * the combining grapheme joiner, the variation selectors, the line and paragraph separators, and the
 * replacement character damaged UTF-8 decodes to. Removing them first rejoins a key split by an
 * invisible so the pattern can see it.
 */
const INVISIBLE = /[\p{Cc}\p{Cf}\u034F\u2028\u2029\uFE00-\uFE0F\uFFFD\u{E0100}-\u{E01EF}]/gu;

export function stripInvisible(text: string): string {
  return text.replace(INVISIBLE, (c) => (c === "\n" || c === "\t" ? c : ""));
}

/** Roots a local absolute path starts with. A bare leading slash is not enough: `/api/journal` is a route, not a path. */
const PATH_ROOTS = "Users|home|root|var|private|tmp|etc|opt|usr|mnt|srv|Volumes|Library|Applications|System|data|media|run/media|workspace|nix";

// One path character, and a bounded tail that continues across spaces only while each next word runs
// into a slash, so a folder name with spaces is taken whole but the prose after a path is left. Every
// quantifier is bounded, so no input can make the match backtrack for long.
const PATH_CHARS = `[^\\s"'\`)\\]>]`;
const PATH_TAIL = `${PATH_CHARS}{0,300}(?: (?:[^\\s/]{1,80} ){0,8}[^\\s/]{1,80}/${PATH_CHARS}{0,300}){0,30}`;

// The name in a name/value secret. A whole word only, so "author:" and "tokenizer:" are not names.
const SECRET_NAME = "pass(?:word|wd|phrase)?|pwd|secret|token|api[_ -]?key|apikey|credential|priv(?:ate)?[_ -]?key|access[_ -]?key|client[_ -]?secret|auth";

const PATTERNS: RegExp[] = [
  // PEM blocks, four dashes or more, any label case, closed or not; an opening with no closing takes
  // up to a bounded run of following text.
  /-{4,}\s*BEGIN[\s\S]{0,6000}?-{4,}\s*END[^\n]{0,80}?-{4,}/gi,
  /-{4,}\s*BEGIN [A-Za-z0-9 ]{0,60}-{2,}[\s\S]{0,6000}/gi,
  // Provider key shapes, by prefix.
  /\bsk-[A-Za-z0-9_-]{16,}/g,
  /\b(?:sk|rk|pk)_(?:live|test)_[A-Za-z0-9]{10,}/g,
  /\bwhsec_[A-Za-z0-9]{20,}/g,
  /\bgh[pousr]_[A-Za-z0-9]{20,}/g,
  /\bgithub_pat_[A-Za-z0-9_]{20,}/g,
  /\bglpat-[A-Za-z0-9_-]{16,}/g,
  /\bhf_[A-Za-z0-9]{20,}/g,
  /\bnpm_[A-Za-z0-9]{30,}/g,
  /\bGOCSPX-[A-Za-z0-9_-]{16,}/g,
  /\bdop_v1_[a-f0-9]{40,}/g,
  /\bshpat_[a-f0-9]{20,}/g,
  /\bxox[a-z]-[A-Za-z0-9-]{10,}/g,
  /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g,
  /\bAIza[0-9A-Za-z_-]{30,}/g,
  /\bSG\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}/g,
  /\bSK[a-f0-9]{32}\b/g,
  /\bAGE-SECRET-KEY-1[A-Z0-9]{30,}/g,
  /\b\d{6,12}:AA[A-Za-z0-9_-]{20,}/g,
  // Slack and Discord webhook URLs carry their token in the path.
  /\bhttps:\/\/hooks\.slack\.com\/services\/[A-Za-z0-9_\/-]{16,}/g,
  /\bhttps:\/\/(?:ptb\.|canary\.)?discord(?:app)?\.com\/api\/webhooks\/[0-9]{5,}\/[A-Za-z0-9_-]{20,}/g,
  // Three base64url segments joined by dots, the first opening the way every JWT header does.
  /\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}/g,
  // Authorization headers. Case-insensitive; a Bearer or Basic value of sixteen characters or more,
  // so "Bearer authentication" in a sentence is left.
  /\b(?:Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{16,}/gi,
  // name=value or name: value (or a full-width colon), the name wrapped in any emphasis, quote or code
  // marks, and the value taken to the end of the line, quoted or not, so a passphrase with spaces or a
  // value with a comma is taken whole. The name is bounded, so no input backtracks here.
  new RegExp(`(?<![A-Za-z0-9])[*_\`"']{0,3}(?:${SECRET_NAME})[*_\`"'\\)]{0,3}\\s*(?:[:=]|：)[^\\n]{0,4000}`, "gi"),
  // Email addresses. Every quantifier bounded.
  /[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9-]{1,63}(?:\.[A-Za-z0-9-]{1,63}){0,10}\.[A-Za-z]{2,24}/g,
  // Home-relative, user-home, and absolute local paths, and a Windows drive or UNC path. The look-behind
  // forbids only an alphanumeric, an underscore, a dot, a tilde or a slash, so a path after a "-", a ":"
  // or a "=" (an include flag, a PATH entry, a --prefix) is still caught.
  new RegExp(`(?<![A-Za-z0-9._~/])~[A-Za-z0-9_.-]{0,40}/${PATH_TAIL}`, "g"),
  new RegExp(`(?<![A-Za-z0-9._~/])\\$HOME/${PATH_TAIL}`, "g"),
  new RegExp(`%USERPROFILE%[\\\\/]${PATH_TAIL}`, "g"),
  new RegExp(`(?<![A-Za-z0-9._~/])/(?:${PATH_ROOTS})/${PATH_TAIL}`, "g"),
  new RegExp(`\\b[A-Za-z]:[\\\\/](?:${PATH_ROOTS}|Documents|Desktop|Downloads)[\\\\/]${PATH_TAIL}`, "gi"),
  /\\\\[A-Za-z0-9._$-]{1,60}\\[^\s"'`)\]>]{1,300}/g,
  // The encoded project-folder name a Claude home uses, e.g. "-Users-alice-Desktop-…".
  /-(?:Users|home)-[A-Za-z0-9._-]{1,300}/g,
];

/** Base64-like runs long enough to be a key. Only a run that mixes cases and digits: a commit id is hex, and is left. */
const LONG_RUN = /[A-Za-z0-9+/=_-]{40,}/g;

const URL_RE = /\b([a-z][a-z0-9+.-]{0,20}):\/\/([^\s<>"'`)\]]{1,2000})/gi;

/**
 * A URL without its userinfo, query and fragment. Everything up to and including the last "@" before
 * the path is dropped, so a password holding a "/", "?", "#" or ")" cannot smuggle the login through.
 * Counts as withheld when it carried a login or a query.
 */
function stripUrls(text: string): Redacted {
  let withheld = 0;
  const out = text.replace(URL_RE, (all, scheme: string, rest: string) => {
    const trailing = /[.,;:!?]+$/.exec(rest)?.[0] ?? "";
    // A file URL is a local path with a scheme in front of it.
    if (scheme.toLowerCase() === "file") {
      withheld += 1;
      return `${WITHHELD}${trailing}`;
    }
    let body = trailing ? rest.slice(0, -trailing.length) : rest;
    let stripped = false;
    // Drop everything up to and including the last "@" whose remainder still looks like a host, so a
    // password that itself holds a "/", "?", "#" or ")" cannot smuggle the login past the first slash.
    const at = body.lastIndexOf("@");
    if (at >= 0 && /^[A-Za-z0-9._-]+(?::\d{1,5})?(?:[/?#]|$)/.test(body.slice(at + 1))) {
      body = body.slice(at + 1);
      stripped = true;
    }
    const cut = body.search(/[?#]/);
    if (cut >= 0) {
      if (body[cut] === "?") stripped = true;
      body = body.slice(0, cut);
    }
    // A local path in the URL's own path (vscode://file/Users/alice, http://host/Users/alice) reveals a
    // username the same way a bare path does; cut at the home-root segment.
    const home = new RegExp(`/(?:${PATH_ROOTS})/`).exec(body);
    if (home && home.index !== undefined) {
      body = body.slice(0, home.index);
      stripped = true;
    }
    // One URL is one passage, whatever it carried, so the count stays the number of things withheld.
    if (stripped) withheld += 1;
    const next = `${scheme}://${body}${trailing}`;
    return next === all ? all : next;
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

/**
 * Fenced code blocks and table rows, removed whole, and indented code blocks and `<pre>` too. A fence
 * is recognised under leading whitespace, block-quote markers and a list marker, so a fence nested in a
 * list item or a quote is dropped; an opening fence with no close takes the rest.
 */
export function dropBlocks(text: string): string {
  const kept: string[] = [];
  let fence: string | null = null;
  let inPre = false;
  let prevBlank = true;
  const fenceOf = (line: string): string | null => /^[\s>]*(?:(?:[-*+]|\d{1,3}[.)])\s+)?(`{3,}|~{3,})/.exec(line)?.[1] ?? null;
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  for (const line of lines) {
    if (inPre) {
      if (/<\/pre>/i.test(line)) inPre = false;
      continue;
    }
    const m = fenceOf(line);
    if (fence !== null) {
      if (m && m[0] === fence[0] && m.length >= fence.length) fence = null;
      continue;
    }
    if (m) {
      fence = m;
      prevBlank = false;
      continue;
    }
    if (/<pre[\s>]/i.test(line)) {
      if (!/<\/pre>/i.test(line)) inPre = true;
      continue;
    }
    // An indented code block: a line indented four spaces or a tab, when the line before it was blank.
    if (prevBlank && /^(?: {4,}|\t)/.test(line) && line.trim() !== "") continue;
    if (/^\s*\|/.test(line)) {
      prevBlank = false;
      continue;
    }
    kept.push(line);
    prevBlank = line.trim() === "";
  }
  return kept.join("\n");
}

/**
 * One line of plain prose. Invisible characters are already gone; here heading, list, quote and
 * emphasis markers and backticks go, a Markdown link keeps its label, a rule line goes, curly double
 * quotes become straight ones so the quotation cannot close the wrapper derive puts around it, and all
 * whitespace, newlines included, becomes single spaces.
 */
export function flattenText(text: string): string {
  const lines = stripInvisible(text)
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
    .replace(/!?\[([^\]\n]{0,400})\]\([^)\n]{0,400}\)/g, "$1")
    .replace(/[`*]/g, "")
    .replace(/(^|[^\p{L}\p{N}])_+(?=\S)/gu, "$1")
    .replace(/(?<=\S)_+(?=$|[^\p{L}\p{N}])/gu, "")
    .replace(/~~/g, "")
    .replace(/[“”]/g, '"')
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

/** The raw text cut to at most `REDACT_INPUT_CAP` characters at a whitespace boundary, so the passes are bounded. */
function boundInput(raw: string): string {
  if (raw.length <= REDACT_INPUT_CAP) return raw;
  const head = raw.slice(0, REDACT_INPUT_CAP);
  const space = head.lastIndexOf(" ");
  const nl = head.lastIndexOf("\n");
  const at = Math.max(space, nl);
  return at > REDACT_INPUT_CAP - 400 ? head.slice(0, at) : head;
}

/** Everything a passage goes through on its way to the journal: bounded, invisibles stripped, blocks dropped, redacted, flattened, redacted again, cut. */
export function cleanText(raw: string, max: number = MAX_QUOTE_CHARS): CleanText {
  const first = redactText(dropBlocks(stripInvisible(boundInput(raw))));
  const second = redactText(flattenText(first.text));
  // Last, because a withheld word standing right after a bracket would otherwise make a `[[` of its own.
  const capped = capText(breakLinks(second.text), max);
  return { text: capped.text, withheld: first.withheld + second.withheld, cut: capped.cut };
}
