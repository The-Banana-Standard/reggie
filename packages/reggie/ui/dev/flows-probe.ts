/**
 * Scratch probe: run the flow detector against a real repo and print what came out,
 * payload by payload. `npx tsx ui/dev/flows-probe.ts [repoPath] [flowIdSubstring]`.
 * Defaults to ~/Desktop/Projects/personal_website and the chat handler.
 */
import os from "node:os";
import path from "node:path";
import { buildGraph } from "../../src/graph.js";
import { repoPaths } from "../../src/paths.js";
import { detectFlows, traceFlow } from "../../src/flows.js";
import { detectServices } from "../../src/services.js";
import type { ValueShape } from "../../src/semantic-index.js";

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

const showShape = (shape: ValueShape | null): string => {
  if (!shape) return "null (not derived)";
  const fields = shape.fields.map((field) => `${field.name}${field.explicitType ? `: ${field.explicitType.text}` : ": not declared"}`);
  return `${shape.kind}${fields.length ? ` { ${fields.join(", ")} }` : ""}`;
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

flow.steps.forEach((s, i) => {
  console.log(`${String(i).padStart(2)}. [${s.kind}] ${s.label}`);
  console.log(`    ${s.from}`);
  console.log(` →  ${s.to}   (${s.source.file}:${s.source.line})`);
  console.log(`    arguments: ${s.arguments.map((argument) => argument.expression).join(", ") || "(none)"}`);
  if (s.requestPayload) console.log(`    request: ${showShape(s.requestPayload)}`);
  if (s.servicePayload) console.log(`    service: ${showShape(s.servicePayload)}`);
  console.log(`    returns: ${s.returns.map((variant) => variant.expression).join(" | ") || "(none)"}`);
});
console.log("\n=== NODES ===");
for (const node of flow.nodes) console.log(`${node.kind.toUpperCase().padEnd(9)} ${node.label} · ${node.path}`);
