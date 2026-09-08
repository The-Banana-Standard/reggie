/**
 * Scratch probe (not part of the build): runs `detectServices` against a real repo and prints
 * what it found, so a human can check every line against the file it cites.
 *
 *   npx tsx ui/dev/services-probe.ts [repoRoot]
 */
import path from "node:path";
import { buildGraph } from "../../src/graph.js";
import { repoPaths } from "../../src/paths.js";
import { detectServices, type ServiceNode } from "../../src/services.js";

const root = path.resolve(process.argv[2] ?? process.cwd());
const paths = repoPaths(root);
const t0 = Date.now();
const graph = buildGraph(paths);
const tGraph = Date.now() - t0;
const t1 = Date.now();
const index = detectServices(paths, graph);
const tDetect = Date.now() - t1;

const where = (n: ServiceNode) => (n.declaredAt ? `${n.declaredAt.file}:${n.declaredAt.line}` : "—");
const codeFiles = graph.nodes.filter((n) => n.kind === "file").length;
console.log(`# ${path.basename(root)} — ${codeFiles} code files; graph ${tGraph} ms, detectServices ${tDetect} ms`);
console.log(`# ${index.services.length} services, ${index.edges.length} edges, ${index.undeclared.length} undeclared, ${index.unused.length} unused\n`);

console.log("## services");
for (const s of index.services) {
  const flag = s.declared ? "declared" : "UNDECLARED";
  const parent = s.parent ? ` parent=${s.parent}` : "";
  console.log(`  ${s.kind.padEnd(15)} ${(s.binding ?? "-").padEnd(24)} ${s.name.padEnd(28)} ${flag.padEnd(11)} ${where(s).padEnd(34)} uses=${String(s.uses).padStart(3)} notes=${s.notes}${parent}`);
}

console.log("\n## undeclared (the headline)");
for (const s of index.undeclared) {
  const files = index.edges.filter((e) => e.service === s.id && !e.viaTest);
  const testFiles = index.edges.filter((e) => e.service === s.id && e.viaTest);
  console.log(`  ${s.kind} ${s.name} — ${s.uses} call sites in ${files.length} files (${testFiles.length} test files), documented at ${where(s)}`);
  for (const e of files.slice(0, 4)) console.log(`      ${e.op} ${e.file}:${e.sources.map((r) => r.line).slice(0, 6).join(",")}${e.count > 6 ? ` (+${e.count - 6})` : ""}`);
}

console.log("\n## unused (declared, nothing touches it)");
for (const s of index.unused) console.log(`  ${s.kind} ${s.binding ?? s.name} — declared ${where(s)}`);

console.log("\n## edges by service");
const byService = new Map<string, typeof index.edges>();
for (const e of index.edges) byService.set(e.service, [...(byService.get(e.service) ?? []), e]);
for (const [id, list] of byService) {
  const primary = list.filter((e) => !e.viaTest);
  console.log(`  ${id}  (${primary.length} files, ${list.length - primary.length} test files)`);
  for (const e of primary.slice(0, 8)) {
    console.log(`      ${e.op.padEnd(5)} ${e.confidence.padEnd(9)} ${e.file}:${e.sources.map((r) => r.line).slice(0, 5).join(",")}  x${e.count}`);
  }
}
