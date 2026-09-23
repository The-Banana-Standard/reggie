import { describe, expect, it } from "vitest";
import { analyzeReachability, codeRoleOf } from "./reachability.js";

describe("role-aware reachability", () => {
  it("classifies special roles without changing the graph's file role contract", () => {
    expect(codeRoleOf("test/a.test.ts", "test")).toBe("test");
    expect(codeRoleOf("scripts/reindex.ts", "source")).toBe("script");
    expect(codeRoleOf("migrations/001.ts", "source")).toBe("migration");
    expect(codeRoleOf("src/schema.gen.ts", "generated")).toBe("generated");
    expect(codeRoleOf("src/app.ts", "source")).toBe("production");
  });

  it("walks each root set and keeps no-reference evidence separate", () => {
    const result = analyzeReachability({
      files: [
        { file: "src/app.ts", role: "source" },
        { file: "src/lib.ts", role: "source" },
        { file: "src/dead.ts", role: "source" },
        { file: "test/app.test.ts", role: "test" },
        { file: "scripts/job.ts", role: "source" },
      ],
      symbols: [
        { id: "sym:src/app.ts::main", file: "src/app.ts" },
        { id: "sym:src/lib.ts::work", file: "src/lib.ts" },
        { id: "sym:src/dead.ts::dead", file: "src/dead.ts" },
      ],
      imports: [{ source: "src/app.ts", target: "src/lib.ts" }],
      calls: [{ caller: "sym:src/app.ts::main", callee: "sym:src/lib.ts::work" }],
      roots: { production: ["sym:src/app.ts::main"], test: ["test/app.test.ts"], script: ["scripts/job.ts"] },
    });
    expect(result.byRole.production.reachableFiles).toEqual(["src/app.ts", "src/lib.ts"]);
    expect(result.byRole.production.notReachableFiles).toEqual(["src/dead.ts"]);
    expect(result.noReferences.files).toContain("src/dead.ts");
    expect(result.noReferences.symbols).toContain("sym:src/dead.ts::dead");
    expect(result.noReferences.files).not.toContain("src/app.ts");
    expect(result.deletionClaim).toBeNull();
    expect(result.limitations).toHaveLength(3);
  });
});
