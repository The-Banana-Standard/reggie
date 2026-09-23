import { describe, expect, it } from "vitest";
import { buildDataConcepts, type ConceptEvidence, type ConceptOccurrence } from "./data-concepts.js";

function occurrence(id: string, name: string, file = "src/a.ts"): ConceptOccurrence {
  return { id, name, path: [name], kind: "binding", source: { file, line: 1 }, symbolId: null, explicitType: null, validationIds: [], routeIds: [] };
}

describe("data concepts", () => {
  it("joins only proof-bearing links and retains provenance", () => {
    const evidence: ConceptEvidence = {
      occurrences: [
        { ...occurrence("payload", "session_id"), explicitType: "string", validationIds: ["validation:1"], routeIds: ["route:POST:/api/chat"] },
        { ...occurrence("parameter", "rawSessionId", "src/session.ts"), kind: "parameter", symbolId: "sym:src/session.ts::resolveSessionId" },
        occurrence("unrelated", "session_id", "src/other.ts"),
      ],
      links: [{ from: "payload", to: "parameter", kind: "argument-parameter", source: { file: "src/a.ts", line: 4 }, transformation: null }],
    };
    const concepts = buildDataConcepts(evidence);
    expect(concepts).toHaveLength(1);
    expect(concepts[0]).toMatchObject({ aliases: ["rawSessionId", "session_id"], validationIds: ["validation:1"], routeIds: ["route:POST:/api/chat"], symbolIds: ["sym:src/session.ts::resolveSessionId"] });
    expect(concepts[0]?.occurrences.map((item) => item.id)).not.toContain("unrelated");
    expect(concepts[0]?.explicitTypes).toEqual([{ occurrenceId: "payload", type: "string" }]);
  });

  it("does not group equal spellings without evidence", () => {
    const concepts = buildDataConcepts({ occurrences: [occurrence("a", "token"), occurrence("b", "token", "src/b.ts")], links: [] });
    expect(concepts).toEqual([]);
  });

  it("keeps transformations on the concept", () => {
    const concepts = buildDataConcepts({
      occurrences: [occurrence("raw", "raw"), occurrence("clean", "clean")],
      links: [{ from: "raw", to: "clean", kind: "assignment", source: { file: "src/a.ts", line: 2 }, transformation: "raw.trim()" }],
    });
    expect(concepts[0]?.transformations).toEqual(["raw.trim()"]);
  });
});
