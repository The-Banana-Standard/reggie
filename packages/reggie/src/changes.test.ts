import { existsSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { hostileGitConfig, makeDiffFixture, oddLine, XSS_LINE, type DiffFixture } from "../test/diff-fixture.js";
import { countLines, DIFF_MAX_CHANGED_LINES, diffRows, fileDiff, joinNumstat, listChanges, parseNumstatZ, parsePatch, parseRawZ, taskChanges, taskRange, type ChangeEntry, type ChangeRange, type DiffRow, type FileDiff } from "./changes.js";
import { blobAt, diffRangeArgs, diffRawRange, git, mergeBase, numstatRange, patchFor, resolveCommit } from "./git.js";
import { clearHistoryCache } from "./history.js";
import { listTasks, type TaskInfo } from "./tasks.js";

let fx: DiffFixture;
let tasks: Map<string, TaskInfo>;

beforeAll(() => {
  // The 60,000-line branch is exercised over HTTP in test/serve.test.ts, where paging is the point.
  fx = makeDiffFixture({ large: false });
  tasks = new Map(listTasks(fx.paths, fx.config, { includeDone: true }).map((t) => [t.slug, t]));
}, 120_000);

afterAll(() => {
  clearHistoryCache();
  fx?.repo.cleanup();
});

function task(slug: string): TaskInfo {
  const t = tasks.get(slug);
  if (!t) throw new Error(`the fixture has no task ${slug}`);
  return t;
}

function rangeOf(slug: string): ChangeRange {
  const r = taskRange(fx.repo.root, task(slug), "main");
  if (!r.ok) throw new Error(r.reason);
  return r.range;
}

/** One file of the file-level branch, as the route would answer it. */
function diffOf(file: string, slug = fx.slugs.cases, offset = 0): FileDiff {
  const range = rangeOf(slug);
  const entry = (listChanges(fx.repo.root, range) ?? []).find((e) => e.path === file);
  if (!entry) throw new Error(`${file} is not in the change list of ${slug}`);
  return fileDiff(fx.repo.root, slug, range, entry, offset);
}

function kinds(rows: readonly DiffRow[]): string {
  return rows.map((r) => r.kind).join(" ");
}

const SHA_A = "1234567890123456789012345678901234567890";

describe("git diff helpers", () => {
  it("throw before git is spawned when a revision is not a full commit id", () => {
    const fresh = path.join(os.tmpdir(), `reggie-diff-output-${process.pid}-${Date.now()}`);
    const head = resolveCommit(fx.repo.root, "main") ?? "";
    for (const bad of [`--output=${fresh}`, head.slice(0, 12), "main", "task/diff-cases", head.toUpperCase(), `${head} `, ""]) {
      expect(() => diffRawRange(fx.repo.root, bad, head), bad).toThrow(/full 40-character commit id/);
      expect(() => numstatRange(fx.repo.root, head, bad), bad).toThrow(/full 40-character commit id/);
      expect(() => patchFor(fx.repo.root, bad, head, ["src/keep.ts"]), bad).toThrow(/full 40-character commit id/);
      expect(() => mergeBase(fx.repo.root, bad, head), bad).toThrow(/full 40-character commit id/);
    }
    expect(existsSync(fresh)).toBe(false);
  });

  it("hand git pinned flags, revisions after --end-of-options and paths after --", () => {
    const b = SHA_A;
    const r = "a".repeat(40);
    const common = ["--literal-pathspecs", "-c", "core.quotePath=false", "-c", "diff.suppressBlankEmpty=false", "diff", "--no-color", "--no-ext-diff", "--no-textconv", "-M", "--diff-algorithm=myers"];
    expect(diffRangeArgs("raw", b, r)).toEqual([...common, "--raw", "-z", "--no-abbrev", "--end-of-options", b, r, "--"]);
    expect(diffRangeArgs("numstat", b, r)).toEqual([...common, "--numstat", "-z", "--end-of-options", b, r, "--"]);
    expect(diffRangeArgs("patch", b, r, ["-leading-dash.ts", ":(exclude)src"])).toEqual([
      ...common,
      "--patch",
      "--unified=3",
      "--inter-hunk-context=0",
      "--src-prefix=a/",
      "--dst-prefix=b/",
      "--end-of-options",
      b,
      r,
      "--",
      "-leading-dash.ts",
      ":(exclude)src",
    ]);
    for (const shape of ["raw", "numstat", "patch"] as const) {
      const args = diffRangeArgs(shape, b, r, ["x"]);
      expect(args.indexOf("--end-of-options")).toBeLessThan(args.indexOf(b));
      expect(args.indexOf(r)).toBeLessThan(args.lastIndexOf("--"));
      expect(args.lastIndexOf("--")).toBe(args.length - 2);
    }
  });

  it("answer null when git fails and an empty string when nothing changed, and never confuse the two", () => {
    const head = resolveCommit(fx.repo.root, "main") ?? "";
    expect(diffRawRange(fx.repo.root, head, SHA_A)).toBeNull();
    expect(numstatRange(fx.repo.root, SHA_A, head)).toBeNull();
    expect(patchFor(fx.repo.root, head, SHA_A, ["src/keep.ts"])).toBeNull();
    expect(diffRawRange(fx.repo.root, head, head)).toBe("");
    expect(numstatRange(fx.repo.root, head, head)).toBe("");
    expect(patchFor(fx.repo.root, head, head, ["src/keep.ts"])).toBe("");
    expect(() => patchFor(fx.repo.root, head, head, [])).toThrow(/at least one path/);
  });

  it("treat pathspec magic and globs as plain names", () => {
    const range = rangeOf(fx.slugs.cases);
    expect(patchFor(fx.repo.root, range.base, range.ref, [":(exclude)src"])).toBe("");
    expect(patchFor(fx.repo.root, range.base, range.ref, ["src/*.bin"])).toBe("");
    expect(patchFor(fx.repo.root, range.base, range.ref, [":(top)magic.ts"])).toContain(oddLine(":(top)magic.ts"));
  });

  it("resolve names to commits, and read a blob id by path without the path touching the revision", () => {
    expect(resolveCommit(fx.repo.root, "main")).toMatch(/^[0-9a-f]{40}$/);
    expect(resolveCommit(fx.repo.root, "task/nope")).toBeNull();
    expect(resolveCommit(fx.repo.root, "--output=/tmp/x")).toBeNull();
    const tip = resolveCommit(fx.repo.root, "task/diff-cases") ?? "";
    expect(blobAt(fx.repo.root, tip, "src/tab\there.ts")).toMatch(/^[0-9a-f]{40}$/);
    expect(blobAt(fx.repo.root, tip, ":(top)magic.ts")).toMatch(/^[0-9a-f]{40}$/);
    expect(blobAt(fx.repo.root, tip, "src/deleted.ts")).toBeNull();
    expect(blobAt(fx.repo.root, tip, "src")).toBeNull();
  });
});

describe("parseRawZ, parseNumstatZ and joinNumstat", () => {
  it("read a rename as two paths and a name holding an arrow as one", () => {
    const zero = "0".repeat(40);
    const raw = [`:100644 100644 ${"a".repeat(40)} ${"b".repeat(40)} R085`, "src/old.ts", "src/new.ts", `:000000 100644 ${zero} ${"c".repeat(40)} A`, "src/a => b.ts", `:100644 000000 ${"d".repeat(40)} ${zero} D`, ":(top)gone.ts", ""].join("\0");
    const entries = parseRawZ(raw);
    expect(entries.map((e) => [e.path, e.status, e.from ?? null, e.similarity ?? null])).toEqual([
      ["src/new.ts", "renamed", "src/old.ts", 85],
      ["src/a => b.ts", "added", null, null],
      [":(top)gone.ts", "deleted", null, null],
    ]);
    expect(entries[1]?.oldMode).toBeNull();
    expect(entries[1]?.oldBlob).toBeNull();
    expect(entries[2]?.newMode).toBeNull();
    expect(entries[2]?.newBlob).toBeNull();
  });

  it("split counts on the first two tabs only, and mark a binary file", () => {
    const stats = parseNumstatZ(["1\t0\tsrc/tab\there.ts", "-\t-\tsrc/blob.bin", "1\t1\t", "src/old.ts", "src/new.ts", "3\t2\tsrc/a => b.ts", ""].join("\0"));
    expect(stats).toEqual([
      { path: "src/tab\there.ts", added: 1, deleted: 0, binary: false },
      { path: "src/blob.bin", added: 0, deleted: 0, binary: true },
      { path: "src/new.ts", added: 1, deleted: 1, binary: false },
      { path: "src/a => b.ts", added: 3, deleted: 2, binary: false },
    ]);
  });

  it("join by the new path and sort by path whatever order git printed", () => {
    const e = (p: string): ChangeEntry => ({ path: p, status: "modified", oldMode: "100644", newMode: "100644", binary: false, added: 0, deleted: 0, oldBlob: null, newBlob: null });
    const joined = joinNumstat([e("z.ts"), e("a.ts")], [{ path: "a.ts", added: 4, deleted: 1, binary: false }]);
    expect(joined.map((x) => [x.path, x.added, x.deleted])).toEqual([
      ["a.ts", 4, 1],
      ["z.ts", 0, 0],
    ]);
  });
});

describe("parsePatch and diffRows", () => {
  // Measured on git 2.55 with the pinned flags; pasted, not reconstructed.
  const NONL_EDIT = ["diff --git a/src/nonl.txt b/src/nonl.txt", "index 2802503..15c57e8 100644", "--- a/src/nonl.txt", "+++ b/src/nonl.txt", "@@ -1 +1 @@", "-no newline at end", "\\ No newline at end of file", "+no newline at end, edited", "\\ No newline at end of file", ""].join("\n");
  const NONL_GAINED = ["diff --git a/src/gains-nonl.txt b/src/gains-nonl.txt", "index 9d0103b..4974d4c 100644", "--- a/src/gains-nonl.txt", "+++ b/src/gains-nonl.txt", "@@ -1 +1 @@", "-has newline", "+has newline", "\\ No newline at end of file", ""].join("\n");
  const PATCHY = [
    "diff --git a/patchy.md b/patchy.md",
    "index 8161b60..76552db 100644",
    "--- a/patchy.md",
    "+++ b/patchy.md",
    "@@ -1,6 +1,5 @@",
    " keep",
    "--- a/old.ts",
    " ++ b/new.ts",
    "-@ -1 +1 @@",
    "-diff --git a/x b/x",
    "+@@ -9,9 +9,9 @@ fake",
    "+\\ No newline at end of file",
    " keep2",
    "",
  ].join("\n");

  it("never makes the no-newline marker a row: it flags the row before it", () => {
    const edit = parsePatch(NONL_EDIT);
    expect(edit.malformed).toBe(false);
    expect(diffRows(edit.hunks, 1)).toEqual([
      { kind: "del", old: 1, text: "no newline at end", noeol: true },
      { kind: "add", new: 1, text: "no newline at end, edited", noeol: true },
    ]);
    const gained = parsePatch(NONL_GAINED);
    expect(diffRows(gained.hunks, 1)).toEqual([
      { kind: "del", old: 1, text: "has newline" },
      { kind: "add", new: 1, text: "has newline", noeol: true },
    ]);
  });

  it("keeps new-side numbers true after a marker in the middle of a hunk", () => {
    // The old side's last line is unterminated and the new side adds two lines after it.
    const patch = ["@@ -1,2 +1,4 @@", " first", "-last", "\\ No newline at end of file", "+last", "+third", "+fourth", ""].join("\n");
    const parsed = parsePatch(patch);
    expect(parsed.malformed).toBe(false);
    const rows = diffRows(parsed.hunks, 4);
    expect(rows.map((r) => [r.kind, "old" in r ? r.old : null, "new" in r ? r.new : null])).toEqual([
      ["ctx", 1, 1],
      ["del", 2, null],
      ["add", null, 2],
      ["add", null, 3],
      ["add", null, 4],
    ]);
    expect(rows.filter((r) => "noeol" in r && r.noeol).length).toBe(1);
  });

  it("reads hunks by the counts in the header, so content that imitates diff syntax stays content", () => {
    const parsed = parsePatch(PATCHY);
    expect(parsed.malformed).toBe(false);
    expect(parsed.hunks).toHaveLength(1);
    expect(diffRows(parsed.hunks, 5)).toEqual([
      { kind: "ctx", old: 1, new: 1, text: "keep" },
      { kind: "del", old: 2, text: "-- a/old.ts" },
      { kind: "ctx", old: 3, new: 2, text: "++ b/new.ts" },
      { kind: "del", old: 4, text: "@ -1 +1 @@" },
      { kind: "del", old: 5, text: "diff --git a/x b/x" },
      { kind: "add", new: 3, text: "@@ -9,9 +9,9 @@ fake" },
      { kind: "add", new: 4, text: "\\ No newline at end of file" },
      { kind: "ctx", old: 6, new: 5, text: "keep2" },
    ]);
  });

  it("reads the shapes a count of one or zero takes", () => {
    expect(diffRows(parsePatch("@@ -0,0 +1 @@\n+now filled\n").hunks, 1)).toEqual([{ kind: "add", new: 1, text: "now filled" }]);
    expect(diffRows(parsePatch("@@ -1 +0,0 @@\n-x\n").hunks, 0)).toEqual([{ kind: "del", old: 1, text: "x" }]);
    expect(diffRows(parsePatch("@@ -1,2 +0,0 @@\n-gone1\n-gone2\n").hunks, 0)).toEqual([
      { kind: "del", old: 1, text: "gone1" },
      { kind: "del", old: 2, text: "gone2" },
    ]);
    // An insertion with no context: the old start is the line before, not the first line.
    expect(diffRows(parsePatch("@@ -5,0 +6,2 @@\n+a\n+b\n").hunks, 10)).toEqual([
      { kind: "gap", count: 5, new: 1 },
      { kind: "add", new: 6, text: "a" },
      { kind: "add", new: 7, text: "b" },
      { kind: "gap", count: 3, new: 8 },
    ]);
    // A deletion with no context: the new start is the line before.
    expect(diffRows(parsePatch("@@ -3,2 +2,0 @@\n-a\n-b\n").hunks, 6)).toEqual([
      { kind: "gap", count: 2, new: 1 },
      { kind: "del", old: 3, text: "a" },
      { kind: "del", old: 4, text: "b" },
      { kind: "gap", count: 4, new: 3 },
    ]);
  });

  it("finds no hunk in a header-only patch", () => {
    for (const text of ["", "diff --git a/src/script.sh b/src/script.sh\nold mode 100644\nnew mode 100755\n", "diff --git a/e b/e\nnew file mode 100644\nindex 0000000..e69de29\n", "diff --git a/b b/b\nindex 1..2 100644\nBinary files a/b and b/b differ\n"]) {
      expect(parsePatch(text)).toEqual({ hunks: [], malformed: false });
    }
    expect(diffRows([], 12)).toEqual([]);
  });

  it("reads both sections of a type change", () => {
    const patch = ["diff --git a/f.txt b/f.txt", "deleted file mode 100644", "index 422c2b7..0000000", "--- a/f.txt", "+++ /dev/null", "@@ -1,2 +0,0 @@", "-a", "-b", "diff --git a/f.txt b/f.txt", "new file mode 120000", "index 0000000..4cbb553", "--- /dev/null", "+++ b/f.txt", "@@ -0,0 +1 @@", "+target.txt", "\\ No newline at end of file", ""].join("\n");
    const parsed = parsePatch(patch);
    expect(parsed.malformed).toBe(false);
    expect(diffRows(parsed.hunks, 1)).toEqual([
      { kind: "del", old: 1, text: "a" },
      { kind: "del", old: 2, text: "b" },
      { kind: "add", new: 1, text: "target.txt", noeol: true },
    ]);
  });

  it("drops a trailing carriage return and nothing else", () => {
    const parsed = parsePatch("@@ -1,2 +1,2 @@\n crlf one\r\n-crlf two\r\n+crlf \rtwo EDITED\r\n");
    expect(parsed.hunks[0]?.lines.map((l) => l.text)).toEqual(["crlf one", "crlf two", "crlf \rtwo EDITED"]);
  });

  it("takes an empty line inside a hunk for an empty context line", () => {
    const parsed = parsePatch("@@ -1,3 +1,3 @@\n a\n\n-b\n+c\n");
    expect(parsed.malformed).toBe(false);
    expect(parsed.hunks[0]?.lines.map((l) => l.kind)).toEqual(["ctx", "ctx", "del", "add"]);
  });

  it("says so when a hunk does not add up, rather than guessing", () => {
    expect(parsePatch("@@ -1,3 +1,3 @@\n a\n-b\n").malformed).toBe(true);
    expect(parsePatch("@@ -1 +1 @@\n-a\n+b\n+c\n@@ -9 +9 @@\n-x\n+y\n").malformed).toBe(false);
    expect(parsePatch("@@ -1,2 +1,2 @@\n a\ndiff --git a/x b/x\n").malformed).toBe(true);
    expect(parsePatch("@@ -1 +1 @@\n a\n a\n").hunks[0]?.lines).toHaveLength(1);
  });

  it("cuts a long row and flags it", () => {
    const rows = diffRows(parsePatch(`@@ -0,0 +1 @@\n+${"x".repeat(5000)}\n`).hunks, 1);
    expect(rows).toHaveLength(1);
    const row = rows[0];
    expect(row?.kind === "add" && row.text.length === 2000 && row.cut === true).toBe(true);
  });

  it("counts lines the way git does", () => {
    expect(countLines("")).toBe(0);
    expect(countLines("a")).toBe(1);
    expect(countLines("a\n")).toBe(1);
    expect(countLines("a\nb")).toBe(2);
    expect(countLines("a\r\nb\r\n")).toBe(2);
  });
});

describe("file-level cases", () => {
  it("lists every changed file of the branch once, records apart, with counts over the files only", () => {
    const changes = taskChanges(fx.repo.root, task(fx.slugs.cases), "main");
    expect(changes.available).toBe(true);
    expect(changes.range?.kind).toBe("branch");
    expect(changes.range?.commits).toBe(1);
    expect(changes.records.map((f) => f.path)).toEqual([`.reggie/tasks/${fx.slugs.cases}/evidence/tests.txt`]);
    expect(changes.files.every((f) => !f.path.startsWith(".reggie/"))).toBe(true);
    const paths = changes.files.map((f) => f.path);
    expect(new Set(paths).size).toBe(paths.length);
    for (const name of fx.oddNames) expect(paths, name).toContain(name);
    expect(paths).not.toContain("src/rename-pure.ts");
    expect(paths).not.toContain("src/rename-edit.ts");
    expect(changes.totals).toEqual({ files: changes.files.length, added: changes.files.reduce((n, f) => n + f.added, 0), deleted: changes.files.reduce((n, f) => n + f.deleted, 0) });
    expect("oldBlob" in (changes.files[0] ?? {})).toBe(false);
  });

  it("agrees with git's own numstat on every file it draws rows for", () => {
    const range = rangeOf(fx.slugs.cases);
    for (const entry of listChanges(fx.repo.root, range) ?? []) {
      const d = fileDiff(fx.repo.root, fx.slugs.cases, range, entry);
      expect(d.card?.kind, entry.path).not.toBe("unreadable");
      if (entry.binary) continue;
      expect(d.rows.filter((r) => r.kind === "add").length, entry.path).toBe(entry.added);
      expect(d.rows.filter((r) => r.kind === "del").length, entry.path).toBe(entry.deleted);
    }
  });

  it("a deleted file: a card, and one del row per removed line with old numbers and no new one", () => {
    const d = diffOf("src/deleted.ts");
    expect(d.status).toBe("deleted");
    expect(d.newMode).toBeNull();
    expect(d.card?.kind).toBe("deleted");
    expect(d.rows).toEqual([
      { kind: "del", old: 1, text: "gone1" },
      { kind: "del", old: 2, text: "gone2" },
    ]);
  });

  it("an added file: all add rows numbered from 1, no gap, and markup kept as text", () => {
    const d = diffOf("src/added.ts");
    expect(d.status).toBe("added");
    expect(d.oldMode).toBeNull();
    expect(d.card).toBeNull();
    expect(d.rows).toEqual([
      { kind: "add", new: 1, text: "new file" },
      { kind: "add", new: 2, text: XSS_LINE },
    ]);
  });

  it("a rename without edits: listed once under its new path, a card and no rows", () => {
    const d = diffOf("src/renamed-pure.ts");
    expect([d.status, d.from, d.similarity, d.added, d.deleted]).toEqual(["renamed", "src/rename-pure.ts", 100, 0, 0]);
    expect(d.card?.kind).toBe("renamed");
    expect(d.card?.text).toContain("src/rename-pure.ts");
    expect(d.rows).toEqual([]);
  });

  it("a rename with one edited line: one add, one del and context, never the whole file as added", () => {
    const d = diffOf("src/renamed-edit.ts");
    expect([d.status, d.from, d.added, d.deleted]).toEqual(["renamed", "src/rename-edit.ts", 1, 1]);
    expect(d.rows.filter((r) => r.kind === "add")).toEqual([{ kind: "add", new: 5, text: "E!" }]);
    expect(d.rows.filter((r) => r.kind === "del")).toEqual([{ kind: "del", old: 5, text: "e" }]);
    expect(kinds(d.rows)).toBe("gap ctx ctx ctx del add ctx ctx ctx gap");
    expect(d.rows[0]).toEqual({ kind: "gap", count: 1, new: 1 });
    expect(d.rows[d.rows.length - 1]).toEqual({ kind: "gap", count: 2, new: 9 });
  });

  it("a binary file: zero counts, both byte sizes, no rows; a new one has no old size", () => {
    const changed = diffOf("src/blob.bin");
    expect([changed.binary, changed.added, changed.deleted]).toEqual([true, 0, 0]);
    expect(changed.card).toMatchObject({ kind: "binary", oldSize: fx.sizes.blobBefore, newSize: fx.sizes.blobAfter });
    expect(changed.rows).toEqual([]);
    const added = diffOf("src/newblob.bin");
    expect(added.card).toMatchObject({ kind: "binary", oldSize: null, newSize: fx.sizes.newBlob });
    expect(added.rows).toEqual([]);
  });

  it("a mode-only change: both modes, a card, no rows; a symlink: its mode, a card, one row holding the target", () => {
    const mode = diffOf("src/script.sh");
    expect([mode.oldMode, mode.newMode]).toEqual(["100644", "100755"]);
    expect(mode.card?.kind).toBe("mode");
    expect(mode.rows).toEqual([]);
    const link = diffOf("src/link-to-target");
    expect(link.newMode).toBe("120000");
    expect(link.card?.kind).toBe("symlink");
    expect(link.rows).toEqual([{ kind: "add", new: 1, text: "target.txt", noeol: true }]);
  });

  it("the three empty-file cases", () => {
    const added = diffOf("src/added-empty.txt");
    expect(added.card?.kind).toBe("empty");
    expect(added.rows).toEqual([]);
    expect(diffOf("src/filled-then-empty.txt").rows).toEqual([{ kind: "del", old: 1, text: "x" }]);
    expect(diffOf("src/empty-then-filled.txt").rows).toEqual([{ kind: "add", new: 1, text: "now filled" }]);
  });

  it("the no-newline marker over a real file: two flagged rows, and none for a terminated line", () => {
    expect(diffOf("src/nonl.txt").rows).toEqual([
      { kind: "del", old: 1, text: "no newline at end", noeol: true },
      { kind: "add", new: 1, text: "no newline at end, edited", noeol: true },
    ]);
    expect(diffOf("src/gains-nonl.txt").rows).toEqual([
      { kind: "del", old: 1, text: "has newline" },
      { kind: "add", new: 1, text: "has newline", noeol: true },
    ]);
  });

  it("content that imitates diff syntax, read from git itself", () => {
    const d = diffOf("patchy.md");
    expect(d.rows.map((r) => [r.kind, "text" in r ? r.text : ""])).toEqual([
      ["ctx", "keep"],
      ["del", "-- a/old.ts"],
      ["ctx", "++ b/new.ts"],
      ["del", "@ -1 +1 @@"],
      ["del", "diff --git a/x b/x"],
      ["add", "@@ -9,9 +9,9 @@ fake"],
      ["add", "\\ No newline at end of file"],
      ["ctx", "keep2"],
    ]);
    expect(d.rows.some((r) => "noeol" in r && r.noeol)).toBe(false);
  });

  it("a CRLF file: no row text ends in a carriage return", () => {
    const d = diffOf("src/crlf.txt");
    expect(kinds(d.rows)).toBe("ctx del add");
    for (const r of d.rows) if ("text" in r) expect(r.text.endsWith("\r"), JSON.stringify(r.text)).toBe(false);
    expect(d.rows[2]).toEqual({ kind: "add", new: 2, text: "crlf two EDITED" });
  });

  it("several hunks a long way apart: a gap before, between and after, and numbers that match the file", () => {
    const d = diffOf("src/long.ts");
    expect(kinds(d.rows)).toBe(["gap", "ctx ctx ctx del add ctx ctx ctx", "gap", "ctx ctx ctx del add ctx ctx ctx", "gap", "ctx ctx ctx del add ctx ctx ctx", "gap"].join(" "));
    const gaps = d.rows.filter((r) => r.kind === "gap");
    expect(gaps).toEqual([
      { kind: "gap", count: 8, new: 1 },
      { kind: "gap", count: 82, new: 16 },
      { kind: "gap", count: 80, new: 105 },
      { kind: "gap", count: 9, new: 192 },
    ]);
    expect(d.rows.filter((r) => r.kind === "add").map((r) => [r.new, r.text])).toEqual([
      [12, "export const line12 = 1200;"],
      [101, "export const line101 = 10100;"],
      [188, "export const line188 = 18800;"],
    ]);
    const shown = d.rows.reduce((n, r) => n + (r.kind === "gap" ? r.count : r.kind === "del" ? 0 : 1), 0);
    expect(shown).toBe(200);
    expect([d.offset, d.totalRows, d.truncated]).toEqual([0, d.rows.length, false]);
  });

  it("each awkward name opens its own rows and nobody else's", () => {
    for (const name of fx.oddNames) {
      const d = diffOf(name);
      expect(d.path).toBe(name);
      const added = d.rows.filter((r) => r.kind === "add");
      expect(added.map((r) => r.text), name).toEqual([oddLine(name)]);
    }
  });

  it("does not read the patch of a file whose changed lines pass the cap, and says so", () => {
    const range = rangeOf(fx.slugs.cases);
    const entry = (listChanges(fx.repo.root, range) ?? []).find((e) => e.path === "src/added.ts");
    if (!entry) throw new Error("src/added.ts is not listed");
    // The count is git's own, from the list; a doctored one stands in for a file nobody wants in a fixture.
    const huge = fileDiff(fx.repo.root, fx.slugs.cases, range, { ...entry, added: DIFF_MAX_CHANGED_LINES, deleted: 1 });
    expect(huge.card?.kind).toBe("unreadable");
    expect(huge.card?.text).toContain("250,001 lines");
    expect([huge.rows, huge.totalRows, huge.truncated]).toEqual([[], 0, false]);
    expect(fileDiff(fx.repo.root, fx.slugs.cases, range, entry).card).toBeNull();
  });

  it("pages by offset and answers nothing past the end", () => {
    const all = diffOf("src/long.ts");
    const tail = diffOf("src/long.ts", fx.slugs.cases, 10);
    expect(tail.offset).toBe(10);
    expect(tail.rows).toEqual(all.rows.slice(10));
    expect(tail.totalRows).toBe(all.totalRows);
    const past = diffOf("src/long.ts", fx.slugs.cases, all.totalRows);
    expect([past.rows.length, past.truncated]).toEqual([0, false]);
  });
});

describe("hostile git config", () => {
  it("changes nothing about the list or the rows, and never runs the external diff program", () => {
    const own = makeDiffFixture({ large: false });
    try {
      const all = listTasks(own.paths, own.config, { includeDone: true });
      const snapshot = (): unknown =>
        all.map((t) => {
          const changes = taskChanges(own.repo.root, t, "main");
          const range = changes.range;
          const entries = range ? (listChanges(own.repo.root, range) ?? []) : [];
          // The merge commit's id differs per fixture build but not between the two readings of one repo.
          return { changes, diffs: range ? entries.map((e) => fileDiff(own.repo.root, t.slug, range, e)) : [] };
        });
      const before = snapshot();
      const marker = hostileGitConfig(own);
      // Proof the settings bite: an unpinned diff in this repo now runs the program, and is coloured without it.
      const unpinned = git(["diff", "main...task/diff-cases", "--", "src/keep.ts"], { cwd: own.repo.root, allowFailure: true });
      expect(unpinned.stdout).toContain("EXTERNAL-DIFF-RAN");
      expect(existsSync(marker)).toBe(true);
      expect(git(["diff", "--no-ext-diff", "main...task/diff-cases", "--", "src/keep.ts"], { cwd: own.repo.root }).stdout).toContain("\u001b[");
      rmSync(marker, { force: true });
      expect(existsSync(marker)).toBe(false);

      const after = snapshot();
      expect(after).toEqual(before);
      expect(existsSync(marker)).toBe(false);
    } finally {
      clearHistoryCache(own.repo.root);
      own.repo.cleanup();
    }
  }, 120_000);
});

describe("branch-level cases", () => {
  it("zero commits past the base: available, empty, and zero commits", () => {
    const c = taskChanges(fx.repo.root, task(fx.slugs.zeroAhead), "main");
    expect([c.available, c.files, c.records, c.range?.commits, c.range?.kind]).toEqual([true, [], [], 0, "branch"]);
  });

  it("only Reggie's own records: no files, the records listed, totals of zero", () => {
    const c = taskChanges(fx.repo.root, task(fx.slugs.recordsOnly), "main");
    expect(c.files).toEqual([]);
    expect(c.records.map((f) => f.path)).toEqual([`.reggie/tasks/${fx.slugs.recordsOnly}/claim.md`, `.reggie/tasks/${fx.slugs.recordsOnly}/evidence/tests.txt`]);
    expect(c.totals).toEqual({ files: 0, added: 0, deleted: 0 });
  });

  it("merged the base back in: only what the branch itself changed", () => {
    const c = taskChanges(fx.repo.root, task(fx.slugs.mergedBack), "main");
    expect(c.files.map((f) => [f.path, f.added, f.deleted])).toEqual([["src/a.ts", 2, 1]]);
    expect(c.records).toEqual([]);
    expect(c.range?.commits).toBe(3);
  });

  it("changed a line and changed it back: two commits and no net change", () => {
    const c = taskChanges(fx.repo.root, task(fx.slugs.netZero), "main");
    expect([c.available, c.files, c.records, c.range?.commits]).toEqual([true, [], [], 2]);
  });

  it("landed by a merge, branch gone: read from the merge against its first parent, verdict and all", () => {
    expect(resolveCommit(fx.repo.root, `task/${fx.slugs.landed}`)).toBeNull();
    const c = taskChanges(fx.repo.root, task(fx.slugs.landed), "main");
    expect(c.available).toBe(true);
    expect(c.range?.kind).toBe("merge");
    const parents = git(["rev-list", "--parents", "-n", "1", c.range?.ref ?? ""], { cwd: fx.repo.root }).stdout.trim().split(" ");
    expect(parents).toHaveLength(3);
    expect(c.range?.base).toBe(parents[1]);
    expect(c.files.map((f) => f.path)).toEqual(["src/a.ts", "src/landed-only.ts"]);
    expect(c.records.map((f) => f.path)).toContain(`.reggie/tasks/${fx.slugs.landed}/packet.md`);
    const packet = diffOf(`.reggie/tasks/${fx.slugs.landed}/packet.md`, fx.slugs.landed);
    expect(packet.rows.some((r) => r.kind === "add" && r.text === "verdict: approved")).toBe(true);
    expect(packet.rows.some((r) => "text" in r && r.text === "verdict: pending")).toBe(false);
  });

  it("the landing's rows and numbers survive the base moving on, and changedSince says which files moved", () => {
    const a = diffOf("src/a.ts", fx.slugs.landed);
    expect(a.rows).toEqual([
      { kind: "ctx", old: 1, new: 1, text: "one" },
      { kind: "del", old: 2, text: "two" },
      { kind: "add", new: 2, text: "two LANDED" },
      { kind: "ctx", old: 3, new: 3, text: "three" },
    ]);
    expect(a.changedSince).toBe(true);
    expect(diffOf("src/landed-only.ts", fx.slugs.landed).changedSince).toBe(false);
    expect(diffOf("src/keep.ts").changedSince).toBeNull();
  });

  it("says why there is nothing to read, in its own words", () => {
    const ff = taskChanges(fx.repo.root, task(fx.slugs.ffLanded), "main");
    expect([ff.available, ff.range]).toEqual([false, null]);
    expect(ff.reason).toMatch(/no merge commit on main landed it/);
    const none = taskChanges(fx.repo.root, task(fx.slugs.noBranch), "main");
    expect(none.available).toBe(false);
    expect(none.reason).toMatch(/There is no task branch yet/);
    const orphan = taskChanges(fx.repo.root, task(fx.slugs.orphan), "main");
    expect(orphan.available).toBe(false);
    expect(orphan.reason).toMatch(/shares no history with main/);
    for (const c of [ff, none, orphan]) {
      expect(c.reason).not.toContain("fatal:");
      expect(c.reason).not.toContain(fx.repo.root);
      expect([c.files, c.records, c.totals]).toEqual([[], [], { files: 0, added: 0, deleted: 0 }]);
    }
  });

  it("resolves nothing but the two names a safe slug builds", () => {
    const hostile = { slug: fx.slugs.cases, state: "in-process", branchRef: "main" };
    expect(taskRange(fx.repo.root, hostile, "main")).toMatchObject({ ok: false });
    expect(taskRange(fx.repo.root, { slug: "../x", state: "in-process", branchRef: null }, "main")).toMatchObject({ ok: false });
    expect(taskRange(fx.repo.root, task(fx.slugs.cases), "no-such-base")).toMatchObject({ ok: false });
  });
});
