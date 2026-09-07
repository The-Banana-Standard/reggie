import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { makeTempRepo, type TempRepo } from "../test/helpers.js";
import { ensureLayout } from "./layout.js";
import { addNote, findNotes, notesForPath, readNoteFile, resolveNoteTarget, staleEntries } from "./notes.js";
import { repoPaths } from "./paths.js";

describe("notes", () => {
  let repo: TempRepo;
  beforeEach(() => {
    repo = makeTempRepo();
    repo.write("src/auth/login.ts", "export const a = 1;\n");
    repo.commitAll("add login");
    ensureLayout(repoPaths(repo.root));
  });
  afterEach(() => repo.cleanup());

  it("resolves entity targets", () => {
    const paths = repoPaths(repo.root);
    expect(resolveNoteTarget(paths, "_repo").kind).toBe("repo");
    expect(resolveNoteTarget(paths, "src/auth/login.ts").file.endsWith("notes/src/auth/login.ts.md")).toBe(true);
    expect(resolveNoteTarget(paths, "src/auth/").file.endsWith("notes/src/auth/_dir.md")).toBe(true);
    expect(resolveNoteTarget(paths, "src/auth").kind).toBe("dir");
    const store = resolveNoteTarget(paths, "store:Users Collection");
    expect(store.kind).toBe("entity");
    expect(store.file.endsWith("notes/_entities/store/users-collection.md")).toBe(true);
  });

  it("adds entries and reads them back", () => {
    const paths = repoPaths(repo.root);
    addNote(paths, "src/auth/login.ts", { type: "gotcha", text: "Retries are capped client-side only.", author: "test", confidence: "high", sources: ["src/auth/login.ts:1"] });
    addNote(paths, "src/auth/login.ts", { type: "why", text: "Exists because the SDK has no retry policy.", author: "Claude via test" });
    const note = readNoteFile(paths, "src/auth/login.ts");
    expect(note).not.toBeNull();
    expect(note?.entries).toHaveLength(2);
    expect(note?.entries[0]?.type).toBe("gotcha");
    expect(note?.entries[0]?.sources).toEqual(["src/auth/login.ts:1"]);
    expect(note?.entries[1]?.author).toBe("Claude via test");
  });

  it("builds the read-before-edit chain", () => {
    const paths = repoPaths(repo.root);
    addNote(paths, "_repo", { type: "how", text: "Fixture repo for tests.", author: "test" });
    addNote(paths, "src/", { type: "how", text: "All source lives here.", author: "test" });
    addNote(paths, "src/auth/login.ts", { type: "gotcha", text: "Client-side cap.", author: "test" });
    const chain = notesForPath(paths, "src/auth/login.ts");
    expect(chain.map((n) => n.entity)).toEqual(["_repo", "src/", "src/auth/login.ts"]);
  });

  it("finds by substring and marks stale entries", () => {
    const paths = repoPaths(repo.root);
    addNote(paths, "src/auth/login.ts", { type: "how", text: "Old description.", author: "test", date: "2020-01-01" });
    expect(findNotes(paths, "auth")).toHaveLength(1);
    expect(findNotes(paths, "nothing-here")).toHaveLength(0);
    const stale = staleEntries(paths);
    expect(stale).toHaveLength(1);
    expect(stale[0]?.entity).toBe("src/auth/login.ts");
  });
});
