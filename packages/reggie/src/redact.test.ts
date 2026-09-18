import { describe, expect, it } from "vitest";
import { SECRET_SHAPES as SHAPES } from "../test/transcript-fixture.js";
import { breakLinks, capText, cleanText, dropBlocks, flattenText, MAX_QUOTE_CHARS, redactText, WITHHELD } from "./redact.js";

const join = (...parts: string[]): string => parts.join("");

describe("redactText", () => {
  it.each(SHAPES)("withholds $name", ({ value }) => {
    const r = redactText(`Before it ${value} after it.`);
    expect(r.withheld).toBeGreaterThanOrEqual(1);
    expect(r.text).toContain(WITHHELD);
    // Not one distinctive piece of the value is left behind.
    for (const piece of value.split(/[\s=:/@.-]+/).filter((p) => p.length >= 8)) expect(r.text).not.toContain(piece);
    expect(r.text.startsWith("Before it ")).toBe(true);
  });

  it("takes the login, the query and the fragment off a URL, and counts it once", () => {
    const r = redactText(`See https://${join("user", ":", "pw123456")}@example.com/docs/page?key=${"k".repeat(12)}#part for more.`);
    expect(r.text).toBe("See https://example.com/docs/page for more.");
    expect(r.withheld).toBe(1);
  });

  it("takes the login off a URL whose password holds a slash or a query character, and a username out of a URL path", () => {
    // S9: a password with '/', '?' or '#' used to slip past the userinfo strip.
    expect(redactText(`db postgres://${join("dbuser", ":", "hun/ter2")}@db.example.com:5432/app`).text).toBe("db postgres://db.example.com:5432/app");
    expect(redactText(`db postgres://${join("dbuser", ":", "hun?ter2")}@db.example.com/app`).text).toBe("db postgres://db.example.com/app");
    // S8: a home path inside a URL's own path reveals a username.
    expect(redactText("open vscode://file/Users/alice/x.ts now").text).toBe("open vscode://file now");
    expect(redactText("hit http://localhost:3000/Users/alice today").text).toBe("hit http://localhost:3000 today");
  });

  it("leaves a plain URL alone and counts nothing", () => {
    expect(redactText("Read https://example.com/docs/page.")).toEqual({ text: "Read https://example.com/docs/page.", withheld: 0 });
  });

  it("withholds a file URL whole, because it is a local path", () => {
    const r = redactText("Opened file:///Users/someone/notes.txt today");
    expect(r.text).toBe(`Opened ${WITHHELD} today`);
  });

  it("does not withhold a 40-character lowercase hex string", () => {
    const sha = "0123456789abcdef0123456789abcdef01234567";
    expect(redactText(`The commit ${sha} landed.`)).toEqual({ text: `The commit ${sha} landed.`, withheld: 0 });
  });

  it("does not withhold the word token, or secret, used in a sentence without a value", () => {
    const text = "The token is refreshed daily and the secret to a good password policy is rotation.";
    expect(redactText(text)).toEqual({ text, withheld: 0 });
  });

  it("does not take a route, a relative path or a long hyphenated slug for a secret or a local path", () => {
    const text = "GET /api/journal reads packages/reggie/src/journal.ts for a-task-worktree-has-no-node-modules-so-nothing-runs.";
    expect(redactText(text)).toEqual({ text, withheld: 0 });
  });

  it("takes an unclosed PEM block to the end of the text", () => {
    const r = redactText(join("Here: -----BEGIN PRIVATE KEY-----\n", "MIIEinventedinvented\n", "and it never closes"));
    expect(r.text).toBe(`Here: ${WITHHELD}`);
  });

  it("counts every passage", () => {
    const r = redactText(`${SHAPES[0]?.value} and ${SHAPES[12]?.value} and ${SHAPES[14]?.value}`);
    expect(r.withheld).toBe(3);
  });
});

describe("dropBlocks", () => {
  it("removes fenced code and table rows whole, and an unclosed fence takes the rest", () => {
    expect(dropBlocks("keep\n```sh\nrm -rf something\n```\nalso keep\n| a | b |\n|---|---|\n| 1 | 2 |\nlast")).toBe("keep\nalso keep\nlast");
    expect(dropBlocks("keep\n~~~\nnever closed\nmore")).toBe("keep");
    expect(dropBlocks("a\n````\n```\nstill inside\n````\nb")).toBe("a\nb");
  });
});

describe("flattenText", () => {
  it("makes one line of plain prose out of Markdown", () => {
    const text = ["# Heading", "", "- a **bold** point", "- [ ] a _task_ with `code`", "> quoted", "1. first", "---", "See [the label](https://example.com/x) and snake_case_name."].join("\n");
    expect(flattenText(text)).toBe("Heading a bold point a task with code quoted first See the label and snake_case_name.");
  });

  it("removes control, zero-width and bidirectional characters, and the replacement character", () => {
    const hostile = [0x00, 0x07, 0x1b, 0x7f, 0x85, 0x200b, 0x200f, 0x202e, 0x2066, 0x2069, 0xfeff, 0xfffd].map((c) => String.fromCharCode(c)).join("x");
    expect(flattenText(`a${hostile}b`)).toBe(`a${"x".repeat(11)}b`);
    expect(flattenText(`one\ttwo${String.fromCharCode(0x2028)}three\r\nfour`)).toBe("one twothree four");
  });

  it("cannot leave a line that starts like an entry header, a heading or a trailer", () => {
    const flat = flattenText("### 10:00 · mallory · claude · other-slug · execute\n## Heading\nevidence: x.txt\nderived: session=none");
    expect(flat).not.toContain("\n");
    expect(flat.startsWith("10:00")).toBe(true);
  });
});

describe("breakLinks", () => {
  it("pulls [[ and ]] apart so the web view's link syntax cannot be forged", () => {
    expect(breakLinks("see [[task/other|label]] and [[[x]]]")).toBe("see [ [task/other|label] ] and [ [ [x] ] ]");
  });
});

describe("capText", () => {
  it("leaves a short message alone", () => {
    expect(capText("Short and done.", 800)).toEqual({ text: "Short and done.", cut: false });
  });

  it("cuts a long message after the last sentence end inside the limit", () => {
    const text = `${"First sentence here. ".repeat(60)}`.trim();
    const r = capText(text, MAX_QUOTE_CHARS);
    expect(r.cut).toBe(true);
    expect(Array.from(r.text).length).toBeLessThanOrEqual(MAX_QUOTE_CHARS);
    expect(r.text.endsWith("here.")).toBe(true);
  });

  it("cuts at a space and ends with an ellipsis when there is no sentence end", () => {
    const r = capText("word ".repeat(400).trim(), MAX_QUOTE_CHARS);
    expect(r.cut).toBe(true);
    expect(Array.from(r.text).length).toBeLessThanOrEqual(MAX_QUOTE_CHARS);
    expect(r.text.endsWith("word…")).toBe(true);
  });

  it("counts characters and not code units, and never splits one", () => {
    const clef = String.fromCodePoint(0x1d11e);
    const r = capText(clef.repeat(30), 10);
    expect(Array.from(r.text)).toHaveLength(10);
    expect(r.text).toBe(`${clef.repeat(9)}…`);
  });

  it("sees a sentence that ends exactly on the limit", () => {
    expect(capText("Ten chars. And more after it", 10)).toEqual({ text: "Ten chars.", cut: true });
  });
});

describe("cleanText", () => {
  it("redacts before it flattens, so a provider key wrapped in emphasis is still caught", () => {
    // The ghp key is caught by its prefix even inside bold; a flattener that ran first would have
    // removed the underscore and lost the prefix.
    const r = cleanText(`The key here is **${SHAPES[1]?.value}** and nothing else.`);
    expect(r.text).toBe("The key here is [withheld] and nothing else.");
    expect(r.withheld).toBe(1);
  });

  it("withholds a name=value secret to the end of the line, so the value and everything after it goes", () => {
    // Deliberately more than the old behaviour: a passphrase with spaces, or a value with a comma, is
    // taken whole. The cost, stated in the module and the docs, is that trailing prose on the line goes too.
    const r = cleanText(`We set \`${SHAPES[9]?.value}\` and moved on.`);
    expect(r.text).toBe("We set [withheld]");
    expect(r.text).not.toContain("inventedvalue123");
  });

  it("does not make a [[ out of a bracket and a withheld word", () => {
    const r = cleanText(`Wrote to [${SHAPES[12]?.value}] today`);
    expect(r.text).not.toContain("[[");
    expect(r.text).toContain("[ [withheld] ]");
  });

  it("drops what is inside a fence before anything else looks at it", () => {
    const r = cleanText(`Done.\n\`\`\`\n${SHAPES[0]?.value}\n\`\`\`\nAll good.`);
    expect(r).toEqual({ text: "Done. All good.", withheld: 0, cut: false });
  });
});

/*
 * The regression net for every redaction bypass the security review found (S1, S2, S3, S7, S8, S9).
 * Each `caught` case must leave none of its listed secrets in the cleaned text; each `limit` case is a
 * shape the redactor is documented not to catch, asserted here so a future change that starts catching
 * it is noticed. Every "secret" below is assembled at run time from invented parts, so no literal in
 * this file is, or looks to a scanner like, a real credential.
 */
const A = (n: number, seed = "Ab3dE6gH"): string => seed.repeat(Math.ceil(n / seed.length)).slice(0, n);
const HEX = (n: number): string => "0a1b2c3d".repeat(Math.ceil(n / 8)).slice(0, n);
const ZW = "\u200b";
const SHY = "\u00ad";
const WJ = "\u2060";
const VS = "\ufe0f";
const CGJ = "\u034f";
const gh = A(36);

type Case = [name: string, input: string, ...secrets: string[]];

const caught: Case[] = [
  // S3 provider prefixes
  ["stripe sk_live", `Stripe key ${join("sk_live_", A(24))} is set`, join("sk_live_", A(24))],
  ["stripe rk_live", join("rk_live_", A(24)), join("rk_live_", A(24))],
  ["stripe whsec", join("whsec_", A(32)), join("whsec_", A(32))],
  ["gitlab glpat", join("glpat-", A(20)), join("glpat-", A(20))],
  ["huggingface hf_", join("hf_", A(34)), join("hf_", A(34))],
  ["google GOCSPX", join("GOCSPX-", A(28)), join("GOCSPX-", A(28))],
  ["digitalocean dop_v1 hex", join("dop_v1_", HEX(64)), HEX(64)],
  ["shopify shpat hex", join("shpat_", HEX(32)), HEX(32)],
  ["twilio SK hex", join("SK", HEX(32)), HEX(32)],
  ["telegram bot token", join("123456789:AA", "H", A(32)), join("AAH", A(32))],
  ["age secret key", join("AGE-SECRET-KEY-1", "QPZRY9X8GF2TVDW0S3JN54KHCE6MUA7L".repeat(2)), "QPZRY9X8GF2TVDW0S3JN54KHCE6MUA7L"],
  ["npm token lowercase and digits", join("npm_", "ab3de6gh".repeat(5).slice(0, 36)), "ab3de6gh".repeat(5).slice(0, 36)],
  ["sendgrid", join("SG.", A(22), ".", A(43)), A(43), A(22)],
  ["slack webhook url", `${join("https://hooks.slack.com/services/T00000000/B00000000/", A(24))} posts`, A(24)],
  ["discord webhook url", join("https://discord.com/api/webhooks/123456789012345678/", A(68)), A(68)],
  ["sk- short 19", join("sk-", A(19)), A(19)],
  // S3 headers
  ["Bearer with digit", "Authorization: Bearer abc123def456ghi789", "abc123def456ghi789"],
  ["Bearer no digit", "Authorization: Bearer abcdefghijklmnopqrstuvwx", "abcdefghijklmnopqrstuvwx"],
  ["lowercase bearer", "authorization: bearer abc123def456ghi789", "abc123def456ghi789"],
  ["Basic auth header", "Authorization: Basic dXNlcjpodW50ZXIy", "dXNlcjpodW50ZXIy"],
  // S3 name=value names and values
  ["DB_PASS upper", "export DB_PASS=hunter2", "hunter2"],
  ["db_pass lower", "db_pass=hunter2", "hunter2"],
  ["pwd", "pwd=hunter2", "hunter2"],
  ["Pwd in conn string", "Server=db;Uid=sa;Pwd=hunter2;", "hunter2"],
  ["passphrase", "passphrase: hunter2horse", "hunter2horse"],
  ["private_key", "private_key=hunter2horse", "hunter2horse"],
  ["access_key", "access_key=hunter2horse", "hunter2horse"],
  ["auth", "auth=hunter2horse", "hunter2horse"],
  ["client_secret", "client_secret=hunter2horse", "hunter2horse"],
  ["value after comma", "token=abc,def123secret", "def123secret"],
  ["unquoted value with spaces", "password: correct horse battery staple", "horse battery staple"],
  ["yaml quoted value with spaces", `password: "correct horse battery"`, "correct horse battery"],
  // S1 emphasis, quote and code around the name
  ["bold label **Password:** value", "**Password:** hunter2horse", "hunter2horse"],
  ["bold label **Token:** value", "**Token:** hunter2horse99", "hunter2horse99"],
  ["bold label - **API key:** value", "- **API key:** hunter2horse99", "hunter2horse99"],
  ["bold name **Password**: value", "**Password**: hunter2", "hunter2"],
  ["italic label *Password:* value", "*Password:* hunter2", "hunter2"],
  ["underscore label __Password:__ value", "__Password:__ hunter2", "hunter2"],
  ["code label `password:` value", "`password:` hunter2", "hunter2"],
  ["json style", `{"password": "hunter2", "api_key": "abc123xyz"}`, "hunter2", "abc123xyz"],
  ["python dict", `{'password': 'hunter2'}`, "hunter2"],
  // S2 fences and blocks
  ["fence nested in a list item", "1. Run this:\n    ```bash\n    export DB_PASS=hunter2\n    ```\ndone", "hunter2"],
  ["fence in a blockquote", "> ```\n> export DB_PASS=hunter2\n> ```\ndone", "hunter2"],
  ["indented code block", "text\n\n    export DB_PASS=hunter2\n\nmore", "hunter2"],
  ["html pre", "<pre>export DB_PASS=hunter2</pre>", "hunter2"],
  ["fence opened with tilde, closed with backtick", "~~~\nexport DB_PASS=hunter2\n```\nvisible", "hunter2"],
  ["fence close shorter than open", "````\nA\n```\nexport DB_PASS=hunter2\n````\nafter", "hunter2"],
  ["fence with info holding a backtick", "``` a`b\nexport DB_PASS=hunter2\n```\nafter", "hunter2"],
  // S7 secrets split by an invisible character
  ["ghp split by zero-width space", `ghp_${gh.slice(0, 10)}${ZW}${gh.slice(10)}`, gh, gh.slice(10)],
  ["ghp split by soft hyphen", `ghp_${gh.slice(0, 10)}${SHY}${gh.slice(10)}`, gh, gh.slice(10)],
  ["ghp split by word joiner", `ghp_${gh.slice(0, 10)}${WJ}${gh.slice(10)}`, gh, gh.slice(10)],
  ["ghp split by variation selector", `ghp_${gh.slice(0, 10)}${VS}${gh.slice(10)}`, gh, gh.slice(10)],
  ["ghp split by combining grapheme joiner", `ghp_${gh.slice(0, 10)}${CGJ}${gh.slice(10)}`, gh, gh.slice(10)],
  // S8 paths that reveal a username
  ["C:/Users forward slash", "C:/Users/alice/Documents/x.txt", "alice"],
  ["C:\\Users backslash", "C:\\Users\\alice\\Documents\\x.txt", "alice"],
  ["~user path", "~alice/Documents/x.txt", "alice"],
  ["$HOME path", "$HOME/Documents/private-x.txt", "private-x"],
  ["%USERPROFILE% path", "%USERPROFILE%\\alice\\x", "alice"],
  ["/data", "/data/alice/x", "alice"],
  ["/media", "/media/alice/usb/x", "alice"],
  ["/run/media", "/run/media/alice/usb", "alice"],
  ["/workspace", "/workspace/alice/app", "alice"],
  ["/nix", "/nix/store/abc-alice-thing", "alice"],
  ["UNC path", "\\\\fileserver\\share\\alice\\x.txt", "fileserver", "alice"],
  ["path after a colon in PATH", "PATH=/usr/bin:/Users/alice/bin", "alice"],
  ["path after equals", "--prefix=/Users/alice/x", "alice"],
  ["encoded project folder", "-Users-alice-Desktop-Projects-x", "alice"],
  ["path with a space in a folder name", "/Users/alice/My Secret Project/src/x.ts", "alice", "Secret"],
  // S9 URL userinfo with special characters
  ["conn string password with slash", "postgres://dbuser:hun/ter2@db.example.com:5432/app", "dbuser:hun", "hun/ter2"],
  ["conn string password with question mark", "postgres://dbuser:hun?ter2@db.example.com/app", "dbuser:hun"],
  ["vscode url with a username", "vscode://file/Users/alice/x.ts", "alice"],
  ["localhost url path with a username", "http://localhost:3000/Users/alice", "alice"],
];

/** Shapes the redactor is documented not to catch. If one starts being caught, this test tells us to update the docs. */
const limits: Case[] = [
  ["a secret spoken in prose", "the password is hunter2", "hunter2"],
  ["a value passed as a flag", "mysql --password hunter2 -u root", "hunter2"],
  ["curl basic auth", "curl -u alice:hunter2 https://example.com", "hunter2"],
  ["a hex key with no prefix", `secret material ${HEX(64)} here`, HEX(64)],
  ["a uuid key", "the key 3f2b8c1e-9a4d-4e7f-b6a1-0c9d8e7f6a5b", "3f2b8c1e-9a4d-4e7f-b6a1-0c9d8e7f6a5b"],
  ["a relative path holding a username", "../../alice/secret-repo/x.ts", "alice"],
  ["a path glued to a compiler flag", "-I/Users/alice/include", "alice"],
  ["a phone number", "call +1 (415) 555-0134", "555-0134"],
  ["an internal hostname", "ssh build01.corp.internal", "build01.corp.internal"],
  ["a token split by a real newline", `ghp_${gh.slice(0, 10)}\n${gh.slice(10)}`, gh.slice(10)],
];

describe("the bypass regression net", () => {
  it.each(caught)("catches %s", (_name, input, ...secrets) => {
    const r = cleanText(input);
    for (const s of secrets) expect(r.text, r.text).not.toContain(s);
  });

  it.each(limits)("is documented not to catch %s", (_name, input, secret) => {
    // Not an aspiration: a plain record of the boundary the owner is told about.
    expect(cleanText(input).text).toContain(secret ?? "");
  });
});
