// Throwaway probe over the built dist of THIS worktree. Builds purpose-built repos and prints what
// repoStory / areaStory / fileStory actually emit. Nothing is added to the repo.
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

const DIST = process.env.DIST;
const { buildGraph } = await import(`${DIST}/graph.js`);
const { repoHistory } = await import(`${DIST}/history.js`);
const { repoPaths } = await import(`${DIST}/paths.js`);
const { loadConfig } = await import(`${DIST}/people.js`);
const { addNote } = await import(`${DIST}/notes.js`);
const { buildStoryContext, repoStory, areaStory, fileStory } = await import(`${DIST}/story.js`);

function git(args, cwd) { execFileSync("git", args, { cwd, stdio: "pipe" }); }

function makeRepo(prefix, files, notes = []) {
  const root = mkdtempSync(path.join(os.tmpdir(), prefix));
  git(["init", "-q", "-b", "main"], root);
  git(["config", "user.name", "Test Person"], root);
  git(["config", "user.email", "test@example.com"], root);
  git(["config", "commit.gpgsign", "false"], root);
  for (const [f, c] of Object.entries(files)) {
    const full = path.join(root, f);
    mkdirSync(path.dirname(full), { recursive: true });
    writeFileSync(full, c, "utf8");
  }
  git(["add", "-A"], root);
  git(["commit", "-q", "--allow-empty", "-m", "init"], root);
  const paths = repoPaths(root);
  for (const n of notes) addNote(paths, n.entity, { type: n.type, text: n.text, author: "test", confidence: "high" });
  return { root, paths };
}

function ctxFor(root, lens) {
  const paths = repoPaths(root);
  return buildStoryContext(paths, loadConfig(paths), buildGraph(paths), repoHistory(root, { diskCache: false }), lens ? { lens } : {});
}

const ids = (s) => s.sections.map((x) => x.id);
const sec = (s, id) => s.sections.find((x) => x.id === id);
const noteActions = (s) => s.sections.filter((x) => x.empty?.action?.form === "note").map((x) => x.id);
function show(label, s) {
  if (!s) { console.log(`${label}: (null)`); return; }
  const a = sec(s, "add-note");
  console.log(`${label}`);
  console.log(`  section ids : ${ids(s).join(", ")}`);
  console.log(`  last id     : ${ids(s).at(-1)}`);
  console.log(`  add-note    : ${a ? `heading=${JSON.stringify(a.heading)} paragraphs=${a.paragraphs.length} form=${a.empty?.action?.form}` : "MISSING"}`);
  if (a) {
    console.log(`  empty.text  : ${JSON.stringify(a.empty?.text)}`);
    console.log(`  hint        : ${JSON.stringify(a.empty?.action?.command)}`);
  }
  console.log(`  note forms  : [${noteActions(s).join(", ")}]  (sections whose empty action is a note form)`);
}

const SRC = {
  "src/big/a01.ts": 'import { b } from "./a02.js";\nexport const a = () => b() + 1;\n',
  "src/big/a02.ts": "export const b = () => 2;\n",
  "README.md": "# probe\n",
};

const cleanups = [];
function run(title, files, notes, areaPath) {
  const { root } = makeRepo("reggie-probe-", files, notes);
  cleanups.push(root);
  console.log("\n" + "=".repeat(78));
  console.log(title);
  console.log("=".repeat(78));
  for (const lens of [null, "knowledge"]) {
    const c = ctxFor(root, lens);
    const tag = lens ? " [lens=knowledge]" : " [default lens]";
    show("repo" + tag, repoStory(c));
    if (areaPath !== null) show(`area ${areaPath}` + tag, areaStory(c, areaPath));
    const f = fileStory(c, "src/big/a02.ts");
    show("file src/big/a02.ts" + tag, f);
  }
  // Extra reads that only make sense in the default lens.
  const c = ctxFor(root, null);
  if (areaPath !== null) {
    const a = areaStory(c, areaPath);
    const rf = a && sec(a, "read-first");
    console.log(`  read-first paragraphs: ${rf ? rf.paragraphs.length : "-"}`);
    if (rf) for (const p of rf.paragraphs) console.log(`    [${p.kind}] ${p.text.slice(0, 160)}`);
    console.log(`  read-first empty form: ${rf?.empty?.action?.form ?? "(none — section is filled)"}`);
  }
  const w = sec(repoStory(c), "what");
  console.log(`  repo 'what' paragraphs: ${w.paragraphs.length}, empty form: ${w.empty?.action?.form ?? "(none — section is filled)"}`);
  // The repo root reached as an area page.
  const rootArea = areaStory(c, ".");
  if (rootArea) {
    console.log(`  areaStory(ctx, ".") -> id=${JSON.stringify(rootArea.id)} title=${JSON.stringify(rootArea.title)}`);
    console.log(`     add-note hint: ${JSON.stringify(sec(rootArea, "add-note")?.empty?.action?.command)}`);
    console.log(`     read-first hint: ${JSON.stringify(sec(rootArea, "read-first")?.empty?.action?.command)}`);
  } else console.log(`  areaStory(ctx, ".") -> (null)`);
}

run("CASE 1 — a repo with no notes at all", SRC, [], "src/big");
run("CASE 2 — the state `reggie onboard` leaves: one `_repo` note with a `why` entry", SRC,
    [{ entity: "_repo", type: "why", text: "This repo exists to probe the add-note section." }], "src/big");
run("CASE 3 — `_repo` note plus the folder's own note", SRC,
    [{ entity: "_repo", type: "why", text: "This repo exists to probe the add-note section." },
     { entity: "src/big/", type: "why", text: "The big folder holds the chained files." }], "src/big");
run("CASE 4 — only the folder's own note, no `_repo` note", SRC,
    [{ entity: "src/big/", type: "why", text: "The big folder holds the chained files." }], "src/big");
run("CASE 5 — a `_repo` note of `how` entries and no `why`", SRC,
    [{ entity: "_repo", type: "how", text: "Run npm test." }], "src/big");
run("CASE 6 — a repo with no code files, so no area pages", { "README.md": "# readme only\n" }, [], null);

// Case 6 needs its area question answered explicitly.
{
  const { root } = makeRepo("reggie-probe-noc-", { "README.md": "# readme only\n" }, []);
  cleanups.push(root);
  const c = ctxFor(root, null);
  console.log("\nCASE 6 — areaStory for every path in a repo with no code files:");
  for (const p of [".", "src", "src/big", "doc"]) console.log(`  areaStory(ctx, ${JSON.stringify(p)}) -> ${areaStory(c, p) ? "a story" : "null"}`);
}

for (const r of cleanups) rmSync(r, { recursive: true, force: true });
