// Criterion 16: does the client's skeleton draw the same headings, in the same order, as the payload?
// ui/story.js imports ./app.js, which touches the DOM at module scope, so the two definitions that
// drive the skeleton are lifted out of the source text and evaluated on their own. Same shape the
// graph-coverage-published task used for footerFor.
import { readFileSync } from "node:fs";

const SRC = process.env.UI_STORY;
const src = readFileSync(SRC, "utf8");

function lift(name, startRe) {
  const i = src.search(startRe);
  if (i < 0) throw new Error(`could not find ${name}`);
  // Brace-match from the first { or [ after the match.
  let j = i;
  while (!"{[".includes(src[j])) j += 1;
  const open = src[j], close = open === "{" ? "}" : "]";
  let depth = 0, k = j;
  for (; k < src.length; k += 1) {
    if (src[k] === open) depth += 1;
    else if (src[k] === close) { depth -= 1; if (depth === 0) break; }
  }
  return src.slice(j, k + 1);
}

const HEADINGS = eval(`(${lift("HEADINGS", /^const HEADINGS = /m)})`);
const GAPS_HEADING = eval(`(${lift("GAPS_HEADING", /^const GAPS_HEADING = /m)})`);

// Verbatim from ui/story.js.
function sectionHeadingsFor(scope, lens) {
  const rows = HEADINGS[scope] ?? HEADINGS.repo;
  const out = rows.map(([, heading]) => heading);
  if (lens === "knowledge" && (scope === "area" || scope === "file")) out.push(GAPS_HEADING[1]);
  return out;
}

const payload = JSON.parse(process.env.PAYLOAD);
let bad = 0;
for (const scope of ["repo", "area", "file"]) {
  for (const lens of [null, "knowledge"]) {
    const skel = sectionHeadingsFor(scope, lens);
    const real = payload[`${scope}:${lens ?? "default"}`];
    const same = JSON.stringify(skel) === JSON.stringify(real);
    if (!same) bad += 1;
    console.log(`${scope} / ${lens ?? "default lens"}: ${same ? "MATCH" : "MISMATCH"}`);
    console.log(`  skeleton (sectionHeadingsFor): ${JSON.stringify(skel)}`);
    console.log(`  payload  (story headings)    : ${JSON.stringify(real)}`);
    if (!same) {
      const n = Math.max(skel.length, real.length);
      for (let i = 0; i < n; i += 1) if (skel[i] !== real[i]) console.log(`    [${i}] skeleton=${JSON.stringify(skel[i])} payload=${JSON.stringify(real[i])}`);
    }
  }
}
console.log(`\n${bad === 0 ? "RESULT: every scope and lens matches." : `RESULT: ${bad} mismatch(es).`}`);
