import type { Flow } from "./flows.js";
import type { ValueShape } from "./semantic-index.js";

function shapeText(shape: ValueShape | null): string {
  if (!shape) return "none found";
  const fields = shape.fields.map((field) => `${field.name}: ${field.explicitType?.text ?? "not declared"}`);
  if (fields.length) return `{ ${fields.join(", ")} }`;
  if (shape.reference) return shape.reference;
  return shape.kind;
}

/** Human CLI projection of the same semantic values consumed by the browser. */
export function flowTraceLines(flow: Flow): string[] {
  const lines = [
    `${flow.title}   ${flow.entry}`,
    `${flow.steps.length} step${flow.steps.length === 1 ? "" : "s"}, ${flow.depth} hop${flow.depth === 1 ? "" : "s"}${flow.truncated ? "" : ", complete"}`,
    "",
  ];
  flow.steps.forEach((step, index) => {
    const via = step.via ? ` via ${step.via}` : "";
    lines.push(`${String(index + 1).padStart(3)}. ${step.kind.padEnd(8)} ${step.label}${via}   ${step.source.file}:${step.source.line}${step.confidence === "heuristic" ? "  [heuristic]" : ""}`);
    lines.push(`     arguments: ${step.arguments.length ? step.arguments.map((argument) => argument.expression).join(", ") : "none"}`);
    if (step.requestPayload) lines.push(`     request payload: ${shapeText(step.requestPayload)}`);
    if (step.servicePayload) lines.push(`     service payload: ${shapeText(step.servicePayload)}`);
    lines.push(`     returns: ${step.returns.length ? step.returns.map((variant) => `${variant.expression || "implicit"} (${variant.explicitType?.text ?? "not declared"})`).join(" | ") : "none"}`);
  });
  if (flow.services.length > 0) lines.push("", `Reaches: ${flow.services.join(", ")}`);
  if (flow.truncated) {
    lines.push("");
    for (const drop of flow.dropped) {
      lines.push(drop.reason === "depth" ? `Not followed: ${drop.count} call${drop.count === 1 ? "" : "s"} at hop ${drop.hop} (the walk stops at ${drop.hop - 1} hops)` : `Dropped: ${drop.count} step${drop.count === 1 ? "" : "s"} at hop ${drop.hop} (${drop.reason})`);
    }
  }
  return lines;
}
