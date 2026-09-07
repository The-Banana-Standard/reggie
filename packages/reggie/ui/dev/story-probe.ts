/**
 * Scratch probe (not part of the build): builds the real context for a repo and prints the
 * generated story so a human can judge the prose.
 *
 *   npx tsx ui/dev/story-probe.ts [repoRoot] [scope] [id]
 *
 * scope: repo (default) | area | file | task | explain
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { buildGraph } from "../../src/graph.js";
import { repoHistory } from "../../src/history.js";
import { repoPaths } from "../../src/paths.js";
import { loadConfig } from "../../src/people.js";
import { areaStory, buildStoryContext, explain, fileStory, repoStory, taskStory, type Story } from "../../src/story.js";

const root = path.resolve(process.argv[2] ?? process.cwd());
const scope = process.argv[3] ?? "repo";
const id = process.argv[4] ?? "";

const paths = repoPaths(root);
const config = loadConfig(paths);
const t0 = Date.now();
const graph = buildGraph(paths);
const history = repoHistory(root);
const ctx = buildStoryContext(paths, config, graph, history, {
  lens: "knowledge",
  readFile: (file) => {
    try {
      return readFileSync(path.join(root, file), "utf8");
    } catch {
      return null;
    }
  },
});
console.log(`# context built in ${Date.now() - t0} ms — repo ${ctx.repo}, branch ${ctx.branch}, ${graph.totalCodeFiles} code files\n`);

function show(story: Story | null): void {
  if (!story) {
    console.log("(no story: unknown id)");
    return;
  }
  console.log(`${story.title}${story.subtitle ? ` — ${story.subtitle}` : ""}`);
  console.log(`crumbs: ${story.crumbs.map((c) => `${c.label} (${c.route})`).join(" › ")}\n`);
  for (const s of story.sections) {
    console.log(`## ${s.heading}  [${s.id}]`);
    for (const p of s.paragraphs) {
      console.log(`  (${p.kind}) ${p.text.replace(/\n/g, "\n         ")}`);
      if (p.chips) console.log(`         chips: ${p.chips.map((c) => `${c.label}=${c.value}`).join(" · ")}`);
      console.log(`         refs: ${p.refs.join(", ")}`);
    }
    if (s.empty) console.log(`  (empty) ${s.empty.text}${s.empty.action ? `  → ${s.empty.action.label ?? ""} ${s.empty.action.command ?? ""}` : ""}`);
    console.log("");
  }
  console.log(`next: ${story.next.map((n) => `${n.label} (${n.route})`).join(", ")}`);
}

if (scope === "repo") show(repoStory(ctx));
else if (scope === "area") show(areaStory(ctx, id));
else if (scope === "file") show(fileStory(ctx, id));
else if (scope === "task") show(taskStory(ctx, id));
else if (scope === "explain") console.log(JSON.stringify(explain(ctx, id), null, 2));
else console.log(`unknown scope "${scope}"`);
