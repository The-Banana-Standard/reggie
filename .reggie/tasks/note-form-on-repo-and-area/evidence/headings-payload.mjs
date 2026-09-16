// Prints the real section HEADINGS (not ids) the server emits, per scope and lens, as JSON.
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import os from "node:os"; import path from "node:path"; import { execFileSync } from "node:child_process";
const DIST = process.env.DIST;
const { buildGraph } = await import(`${DIST}/graph.js`);
const { repoHistory } = await import(`${DIST}/history.js`);
const { repoPaths } = await import(`${DIST}/paths.js`);
const { loadConfig } = await import(`${DIST}/people.js`);
const { buildStoryContext, repoStory, areaStory, fileStory } = await import(`${DIST}/story.js`);
const g = (a, cwd) => execFileSync("git", a, { cwd, stdio: "pipe" });
const root = mkdtempSync(path.join(os.tmpdir(), "reggie-skel-"));
g(["init", "-q", "-b", "main"], root); g(["config", "user.name", "T"], root); g(["config", "user.email", "t@e.com"], root); g(["config", "commit.gpgsign", "false"], root);
for (const [f, c] of Object.entries({ "src/big/a01.ts": 'import { b } from "./a02.js";\nexport const a = () => b() + 1;\n', "src/big/a02.ts": "export const b = () => 2;\n", "README.md": "# x\n" })) {
  const full = path.join(root, f); mkdirSync(path.dirname(full), { recursive: true }); writeFileSync(full, c, "utf8");
}
g(["add", "-A"], root); g(["commit", "-q", "-m", "init"], root);
const ctxFor = (lens) => { const p = repoPaths(root); return buildStoryContext(p, loadConfig(p), buildGraph(p), repoHistory(root, { diskCache: false }), lens ? { lens } : {}); };
const out = {};
for (const lens of [null, "knowledge"]) {
  const c = ctxFor(lens); const k = lens ?? "default";
  out[`repo:${k}`] = repoStory(c).sections.map((s) => s.heading);
  out[`area:${k}`] = areaStory(c, "src/big").sections.map((s) => s.heading);
  out[`file:${k}`] = fileStory(c, "src/big/a02.ts").sections.map((s) => s.heading);
}
rmSync(root, { recursive: true, force: true });
console.log(JSON.stringify(out));
