/**
 * Scratch probe (not part of the build): builds the real graph for a repo and prints what
 * `chooseAreas` picks at Level 1 plus the aggregated container edges.
 *
 *   npx tsx ui/dev/views-probe.ts [repoRoot] [dirToInspect]
 */
import { buildGraph } from "../../src/graph.js";
import { repoPaths } from "../../src/paths.js";
import { chooseAreas, containerView, dirView, impactView, level1 } from "../../src/views.js";

const root = process.argv[2] ?? process.cwd();
const inspect = process.argv[3] ?? null;
const t0 = Date.now();
const g = buildGraph(repoPaths(root));
console.log(`graph: ${g.nodes.length} nodes, ${g.edges.length} edges, ${g.totalCodeFiles} code files, ${Date.now() - t0} ms`);

const choice = chooseAreas(g, "dir:./");
console.log(`\nchooseAreas('dir:./') → ${choice.areas.length} areas, ${choice.loose.length} loose files`);
for (const a of choice.areas) {
  console.log(`  ${a.id.padEnd(34)} label=${JSON.stringify(a.label).padEnd(22)} source=${a.aggregates?.source} files=${a.aggregates?.files}${a.residual ? " residual" : ""}${a.manifest ? " manifest" : ""}`);
}
console.log(`  loose: ${choice.loose.slice(0, 12).join(", ")}${choice.loose.length > 12 ? ` … (+${choice.loose.length - 12})` : ""}`);
console.log("\nareaRefs:", JSON.stringify(level1(g).refs));

const cv = containerView(g);
console.log(`\ncontainerView: ${cv.nodes.length} nodes, ${cv.edges.length} edges, counts=${JSON.stringify(cv.counts)}, cycles=${JSON.stringify(cv.cycles)}`);
for (const e of [...cv.edges].sort((a, b) => (b.weight ?? 1) - (a.weight ?? 1)).slice(0, 12)) {
  console.log(`  ${e.kind.padEnd(7)} ${e.source} → ${e.target}  weight=${e.weight ?? 1}${e.names ? ` names=${e.names.length}` : ""}${e.via ? ` via=${e.via[0]?.source} → ${e.via[0]?.target} (${e.via[0]?.names.length})` : ""}`);
}

if (inspect) {
  const dv = dirView(g, inspect);
  if (!dv) console.log(`\ndirView(${inspect}) → null (unknown dir)`);
  else {
    console.log(`\ndirView(${dv.root}): counts=${JSON.stringify(dv.counts)} nodes=${dv.nodes.length} edges=${dv.edges.length}`);
    for (const n of dv.nodes) console.log(`  ${n.kind.padEnd(5)} ${n.id}${n.ghost ? ` [ghost ${n.side}] ${n.label}` : ""}${n.kind === "fold" ? ` ${n.label}` : ""}`);
    const dvAll = dirView(g, inspect, { all: true });
    console.log(`  all=1 → shown=${dvAll?.counts.shown} folded=${dvAll?.counts.folded}`);
    const dvTests = dirView(g, inspect, { tests: true });
    console.log(`  tests=1 → shown=${dvTests?.counts.shown} hiddenTests=${dvTests?.counts.hiddenTests}`);
  }
}

const busiest = g.nodes.filter((n) => n.kind === "file").sort((a, b) => b.inDegree - a.inDegree)[0];
if (busiest) {
  for (const depth of [1, 2] as const) {
    const iv = impactView(g, [busiest.id], { depth, direction: "both" });
    console.log(`\nimpactView(${busiest.id}, depth=${depth}): counts=${JSON.stringify(iv.counts)} nodes=${iv.nodes.length} edges=${iv.edges.length} folds=${iv.nodes.filter((n) => n.kind === "fold").length}`);
  }
}
