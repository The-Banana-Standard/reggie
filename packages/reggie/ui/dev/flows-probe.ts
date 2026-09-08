/**
 * Scratch probe: run the flow detector against a real repo and print what came out,
 * payload by payload. `npx tsx ui/dev/flows-probe.ts [repoPath] [flowIdSubstring]`.
 * Defaults to ~/Desktop/Projects/personal_website and the chat handler.
 */
import os from "node:os";
import path from "node:path";
import { buildGraph } from "../../src/graph.js";
import { repoPaths } from "../../src/paths.js";
import { detectFlows, traceFlow, type Payload } from "../../src/flows.js";
import { detectServices } from "../../src/services.js";

const root = process.argv[2] ?? path.join(os.homedir(), "Desktop/Projects/personal_website");
const want = process.argv[3] ?? "chat";

const paths = repoPaths(root);
const t0 = Date.now();
const graph = buildGraph(paths);
const graphMs = Date.now() - t0;
const svc = detectServices(paths, graph);
const t1 = Date.now();
const index = detectFlows(paths, graph, { services: svc.services });
const flowsMs = Date.now() - t1;

console.log(`repo ${root}`);
console.log(`graph ${graphMs}ms, flows ${flowsMs}ms, ${index.entries.length} entries\n`);

console.log("=== ENTRY POINTS ===");
for (const e of index.entries) {
  const f = index.flows.find((x) => x.id === e.id);
  console.log(
    `${(e.kind + "        ").slice(0, 12)} ${(e.method ?? "-").padEnd(5)} ${(e.route ?? "-").padEnd(28)} ${e.file}:${e.source.line} ` +
      `#${e.symbol}  steps=${f?.steps ?? "?"} depth=${f?.depth ?? "?"}${f?.truncated ? " TRUNCATED" : ""}` +
      (f?.services.length ? `  → ${f.services.join(", ")}` : ""),
  );
}

const show = (p: Payload | null): string => {
  if (!p) return "null (not derivable)";
  const at = p.source ? ` @ ${p.source.file}:${p.source.line}` : "";
  return `${p.confidence.toUpperCase()} [${p.shape}] { ${p.fields.join(", ")} }${at}`;
};

const target = index.entries.find((e) => e.id.includes(want) || e.route?.includes(want));
if (!target) {
  console.log(`\nno entry matching "${want}"`);
  process.exit(0);
}
const flow = traceFlow(paths, graph, target.id, { services: svc.services });
console.log(`\n=== FLOW ${flow.title} (${flow.id}) ===`);
console.log(`steps=${flow.steps.length} depth=${flow.depth} truncated=${flow.truncated}`);
console.log(`services: ${flow.services.join(", ") || "(none)"}\n`);

let exact = 0;
let heuristic = 0;
let none = 0;
flow.steps.forEach((s, i) => {
  console.log(`${String(i).padStart(2)}. [${s.kind}] ${s.label}`);
  console.log(`    ${s.from}`);
  console.log(` →  ${s.to}   (${s.source.file}:${s.source.line})`);
  console.log(`    in : ${show(s.input)}`);
  console.log(`    out: ${show(s.output)}`);
  for (const p of [s.input, s.output]) {
    if (!p) none += 1;
    else if (p.confidence === "exact") exact += 1;
    else heuristic += 1;
  }
});
const total = exact + heuristic + none;
console.log(`\npayload slots (input+output over ${flow.steps.length} steps): ${total}`);
console.log(`  exact     ${exact} (${((exact / total) * 100).toFixed(0)}%)`);
console.log(`  heuristic ${heuristic} (${((heuristic / total) * 100).toFixed(0)}%)`);
console.log(`  null      ${none} (${((none / total) * 100).toFixed(0)}%)`);
