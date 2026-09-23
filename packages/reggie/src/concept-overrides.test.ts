import { readFileSync, writeFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { makeTempRepo, type TempRepo } from "../test/helpers.js";
import type { DataConcept } from "./data-concepts.js";
import { applyConceptOverrides, mergeConcepts, readConceptOverrides, splitConcept } from "./concept-overrides.js";
import { git } from "./git.js";
import { ensureLayout } from "./layout.js";
import { repoPaths, type RepoPaths } from "./paths.js";
import { parseConfig, type ReggieConfig } from "./people.js";

function concepts(): DataConcept[] {
  const occurrence = (id: string, name: string, line: number) => ({
    id,
    name,
    path: [name],
    kind: "argument" as const,
    explicitType: null,
    symbolId: `sym:src/data.ts::${name}`,
    callSiteId: null,
    routeIds: [],
    validationIds: [],
    source: { file: "src/data.ts", startLine: line, endLine: line, startOffset: line * 10, endOffset: line * 10 + 5 },
  });
  const base = (id: string, canonicalName: string, members: ReturnType<typeof occurrence>[]): DataConcept => ({
    id,
    canonicalName,
    aliases: [canonicalName],
    occurrences: members,
    links: [],
    explicitTypes: [],
    validationIds: [],
    transformations: [],
    routeIds: [],
    symbolIds: members.map((member) => member.symbolId),
  });
  return [
    base("concept:session-id", "Session ID", [occurrence("occ:a", "session_id", 1), occurrence("occ:b", "rawSessionId", 2)]),
    base("concept:conversation-id", "Conversation ID", [occurrence("occ:c", "conversationId", 3)]),
  ];
}

describe("manual data concept overrides", () => {
  let repo: TempRepo;
  let paths: RepoPaths;
  let config: ReggieConfig;

  beforeEach(() => {
    repo = makeTempRepo("reggie-concepts-");
    paths = repoPaths(repo.root);
    ensureLayout(paths);
    repo.write("src/data.ts", "export const data = true;\n");
    repo.commitAll("onboard concept fixture");
    config = parseConfig("mode: solo\ndefaultBranch: main\n");
  });

  afterEach(() => repo.cleanup());

  it("splits before merging, keeps redirects and histories, and commits one override file per action", () => {
    const split = splitConcept(paths, config, concepts(), {
      expectedRevision: "missing",
      sourceId: "concept:session-id",
      targetId: "concept:raw-session-id",
      canonicalName: "Raw session ID",
      occurrenceIds: ["occ:b"],
      by: "Test Person",
      reason: "The raw request value is distinct from the resolved ID.",
    }, { now: new Date("2026-09-23T02:00:00Z") });
    expect(split.applied.concepts.find((item) => item.id === "concept:raw-session-id")?.occurrences.map((item) => item.id)).toEqual(["occ:b"]);
    expect(git(["show", "--format=", "--name-only", split.commit], { cwd: repo.root }).stdout.trim()).toBe(".reggie/concepts.json");

    const merge = mergeConcepts(paths, config, concepts(), {
      expectedRevision: split.file.revision,
      targetId: "concept:session-id",
      sourceIds: ["concept:conversation-id"],
      canonicalName: "Session identity",
      by: "Test Person",
      reason: "The application treats these as one identity.",
    }, { now: new Date("2026-09-23T02:01:00Z") });
    expect(merge.applied.redirects["concept:conversation-id"]).toBe("concept:session-id");
    expect(merge.applied.concepts.find((item) => item.id === "concept:session-id")?.occurrences.map((item) => item.id)).toEqual(["occ:a", "occ:c"]);
    expect(merge.applied.concepts.find((item) => item.id === "concept:raw-session-id")?.occurrences.map((item) => item.id)).toEqual(["occ:b"]);
    expect(merge.file.history.map((item) => item.action)).toEqual(["split", "merge"]);
  });

  it("rejects a split that cannot be replayed before an earlier merge", () => {
    const merged = mergeConcepts(paths, config, concepts(), {
      expectedRevision: "missing",
      targetId: "concept:session-id",
      sourceIds: ["concept:conversation-id"],
      by: "Test Person",
      reason: "Combine the identities before refining them.",
    }, { now: new Date("2026-09-23T02:00:00Z") });
    expect(() => splitConcept(paths, config, concepts(), {
      expectedRevision: merged.file.revision,
      sourceId: "concept:session-id",
      targetId: "concept:conversation-handle",
      canonicalName: "Conversation handle",
      occurrenceIds: ["occ:c"],
      by: "Test Person",
      reason: "The merged occurrence is a distinct external handle.",
    }, { now: new Date("2026-09-23T02:01:00Z") })).toThrow(/cannot be applied before the existing merges/);
  });

  it("rejects stale revisions, invalid occurrences, task checkouts, and dirty override targets", () => {
    expect(() => splitConcept(paths, config, concepts(), {
      expectedRevision: "stale",
      sourceId: "concept:session-id",
      targetId: "concept:new",
      canonicalName: "New",
      occurrenceIds: ["occ:b"],
      by: "Test",
      reason: "Test conflict.",
    })).toThrow(/revision conflict/);
    expect(() => splitConcept(paths, config, concepts(), {
      expectedRevision: "missing",
      sourceId: "concept:session-id",
      targetId: "concept:new",
      canonicalName: "New",
      occurrenceIds: ["occ:missing"],
      by: "Test",
      reason: "Test membership.",
    })).toThrow(/does not belong/);

    git(["switch", "-q", "-c", "task/wrong"], { cwd: repo.root });
    expect(() => mergeConcepts(paths, config, concepts(), {
      expectedRevision: "missing",
      targetId: "concept:session-id",
      sourceIds: ["concept:conversation-id"],
      by: "Test",
      reason: "Test checkout guard.",
    })).toThrow(/configured integration checkout/);
    git(["switch", "-q", "main"], { cwd: repo.root });
    writeFileSync(paths.concepts, readFileSync(paths.concepts, "utf8").replace("\"missing\"", "\"dirty\""), "utf8");
    expect(() => mergeConcepts(paths, config, concepts(), {
      expectedRevision: "dirty",
      targetId: "concept:session-id",
      sourceIds: ["concept:conversation-id"],
      by: "Test",
      reason: "Test dirty target guard.",
    })).toThrow(/uncommitted changes/);
  });

  it("preserves unrelated staged and unstaged changes in an isolated concept-only commit", () => {
    repo.write("staged.txt", "before\n");
    repo.write("unstaged.txt", "before\n");
    repo.commitAll("add unrelated fixture files");
    repo.write("staged.txt", "staged\n");
    git(["add", "staged.txt"], { cwd: repo.root });
    repo.write("unstaged.txt", "unstaged\n");
    const staged = git(["diff", "--cached", "--binary"], { cwd: repo.root }).stdout;
    const result = mergeConcepts(paths, config, concepts(), {
      expectedRevision: readConceptOverrides(paths).revision,
      targetId: "concept:session-id",
      sourceIds: ["concept:conversation-id"],
      by: "Test Person",
      reason: "Exercise isolated publication.",
    });
    expect(git(["diff", "--cached", "--binary"], { cwd: repo.root }).stdout).toBe(staged);
    expect(readFileSync(`${repo.root}/unstaged.txt`, "utf8")).toBe("unstaged\n");
    expect(git(["show", "--format=", "--name-only", result.commit], { cwd: repo.root }).stdout.trim()).toBe(".reggie/concepts.json");
  });

  it("ignores impossible historical overrides instead of deleting static concepts", () => {
    const file = readConceptOverrides(paths);
    file.splits.push({ sourceId: "concept:missing", targetId: "concept:child", canonicalName: "Child", occurrenceIds: ["occ:nope"], at: "now", by: "Test", reason: "Old invalid record." });
    expect(applyConceptOverrides(concepts(), file).concepts.map((item) => item.id)).toEqual(["concept:conversation-id", "concept:session-id"]);
  });
});
