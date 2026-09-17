import { appendFileSync, chmodSync, mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { git } from "../src/git.js";
import { clearHistoryCache } from "../src/history.js";
import { landTask } from "../src/land.js";
import { ensureLayout } from "../src/layout.js";
import { packetFile, planFile, repoPaths, type RepoPaths } from "../src/paths.js";
import { currentPerson, loadConfig, loadPeople, type ReggieConfig } from "../src/people.js";
import { writeText } from "../src/util.js";
import { fullPlan, makeTempRepo, type TempRepo } from "./helpers.js";

/*
 * One throwaway repo for everything that reads a task's change. `diff-cases` is an in-process task
 * whose single branch carries every file-level case git's output makes awkward; each other slug is one
 * branch-level case. Every shape here was first measured by hand on git 2.55, and the comments say
 * what git prints for it, because that output is what the parser and the row builder are tested against.
 */

export interface DiffFixture {
  repo: TempRepo;
  paths: RepoPaths;
  config: ReggieConfig;
  slugs: {
    /** In process; every file-level case on one branch. */
    cases: string;
    /** Awaiting decision: a branch with one changed file and a pending packet. */
    awaiting: string;
    /** A task branch with no commit past the base. */
    zeroAhead: string;
    /** A task branch that only added files under `.reggie/`. */
    recordsOnly: string;
    /** A task branch that merged the base back in; the base's own file must not be listed. */
    mergedBack: string;
    /** Two commits that cancel out. */
    netZero: string;
    /** A 60,000-line file and a 5 MB single-line file. Absent when built with `large: false`. */
    large: string;
    /** Done: landed by `landTask`, branch released, and the base has since changed one of its two files. */
    landed: string;
    /** Done: landed by fast-forward, so there is no merge commit and no branch. */
    ffLanded: string;
    /** Planned: a plan on the base and no branch. */
    noBranch: string;
    /** A task branch that shares no history with the base. */
    orphan: string;
  };
  /** Byte lengths of the binary blobs, as written. */
  sizes: { blobBefore: number; blobAfter: number; newBlob: number };
  /** The seven awkward names, exactly as committed, each holding one added line naming itself. */
  oddNames: string[];
  /** Lines in the large file, and the length of the single-line file. */
  large: { lines: number; oneLineChars: number };
}

export const ODD_NAMES = ["src/with space.ts", 'src/quo"te.ts', "src/tab\there.ts", "src/café ü.ts", "-leading-dash.ts", "src/a => b.ts", ":(top)magic.ts"];

/** The line an odd-named file holds, so a test can tell that a route answered with that file's rows and nobody else's. */
export function oddLine(name: string): string {
  return `// this is ${name}`;
}

export const LARGE_LINES = 60_000;
export const ONE_LINE_CHARS = 5_000_000;
export const XSS_LINE = 'export const html = "<img src=x onerror=alert(1)>";';

const BLOB_BEFORE = Buffer.from([0, 1, 2, 98, 105, 110, 97, 114, 121, 0]);
const BLOB_AFTER = Buffer.from([0, 1, 3, 98, 105, 110, 97, 114, 121, 50, 0, 0]);
const NEW_BLOB = Buffer.from([0, 110, 101, 119, 0]);

function numbered(n: number, change: (i: number) => string | null = () => null): string {
  const lines: string[] = [];
  for (let i = 1; i <= n; i += 1) lines.push(change(i) ?? (i % 10 === 0 ? "" : `export const line${i} = ${i};`));
  return `${lines.join("\n")}\n`;
}

function packet(slug: string, verdict: "pending" | "approved"): string {
  return ["---", `slug: ${slug}`, `title: ${slug}`, "risk: low", "author: test", "date: 2026-09-17", `branch: task/${slug}`, "base: main", `verdict: ${verdict}`, "decided_by:", "decided_at:", "---", `# Completion: ${slug}`, "", "## Acceptance criteria", "- [x] It works", "  evidence: evidence/tests.txt", ""].join("\n");
}

export function makeDiffFixture(opts: { large?: boolean } = {}): DiffFixture {
  const repo = makeTempRepo("reggie-diff-");
  const root = repo.root;
  const paths = repoPaths(root);
  const run = (...args: string[]): void => void git(args, { cwd: root });
  const bytes = (file: string, content: Buffer | string): void => {
    const full = path.join(root, file);
    mkdirSync(path.dirname(full), { recursive: true });
    writeFileSync(full, content);
  };
  const commit = (subject: string, slug?: string): void => {
    run("add", "-A");
    run("-c", "commit.gpgsign=false", "commit", "-q", "--allow-empty", "-m", subject, ...(slug ? ["-m", `Task: ${slug}`] : []));
  };
  const branch = (slug: string): void => run("checkout", "-q", "-b", `task/${slug}`);
  const toMain = (): void => run("checkout", "-q", "main");

  // A developer's global autocrlf would turn the CRLF file into LF on the way in.
  run("config", "core.autocrlf", "false");
  ensureLayout(paths);
  appendFileSync(path.join(root, ".gitignore"), ".worktree/\n.reggie/.cache/\n");

  const slugs = {
    cases: "diff-cases",
    awaiting: "awaiting-review",
    zeroAhead: "zero-ahead",
    recordsOnly: "records-only",
    mergedBack: "merged-back",
    netZero: "net-zero",
    large: "large-change",
    landed: "landed-task",
    ffLanded: "ff-landed",
    noBranch: "no-branch",
    orphan: "orphan-branch",
  };

  // --- the base ---------------------------------------------------------------
  bytes("src/keep.ts", "line1\nline2\nline3\nline4\nline5\n");
  bytes("src/untouched.ts", "export const untouched = true;\n");
  bytes("src/long.ts", numbered(200));
  bytes("src/deleted.ts", "gone1\ngone2\n");
  bytes("src/rename-pure.ts", "a\nb\nc\nd\ne\nf\ng\nh\n");
  bytes("src/rename-edit.ts", "a\nb\nc\nd\ne\nf\ng\nh\ni\nj\n");
  bytes("src/blob.bin", BLOB_BEFORE);
  bytes("src/script.sh", "#!/bin/sh\necho hi\n");
  bytes("src/nonl.txt", "no newline at end");
  bytes("src/gains-nonl.txt", "has newline\n");
  bytes("src/empty-then-filled.txt", "");
  bytes("src/filled-then-empty.txt", "x\n");
  bytes("src/crlf.txt", "crlf one\r\ncrlf two\r\n");
  bytes("src/target.txt", "target\n");
  bytes("src/with space.ts", "space\n");
  bytes("patchy.md", "keep\n-- a/old.ts\n++ b/new.ts\n@ -1 +1 @@\ndiff --git a/x b/x\nkeep2\n");
  bytes("src/a.ts", "one\ntwo\nthree\n");
  bytes("src/b.ts", "alpha\nbeta\n");
  writeText(planFile(paths, slugs.cases), fullPlan(slugs.cases, ["src/keep.ts", "src/untouched.ts"]));
  writeText(planFile(paths, slugs.noBranch), fullPlan(slugs.noBranch, ["src/a.ts"]));
  writeText(planFile(paths, slugs.landed), fullPlan(slugs.landed, ["src/a.ts"]));
  commit("base: every file the cases start from");

  // --- zero commits past the base: the range is empty and git exits 0 --------
  run("branch", `task/${slugs.zeroAhead}`);

  // --- every file-level case on one branch --------------------------------------
  branch(slugs.cases);
  bytes("src/keep.ts", "line1\nline2 changed\nline3\nline4\nline5\nline6\n");
  // Three hunks a long way apart, so the rows hold a leading gap, two middle gaps and a tail gap.
  bytes("src/long.ts", numbered(200, (i) => (i === 12 ? "export const line12 = 1200;" : i === 101 ? "export const line101 = 10100;" : i === 188 ? "export const line188 = 18800;" : null)));
  run("rm", "-q", "src/deleted.ts"); // `deleted file mode`, `+++ /dev/null`, one hunk `@@ -1,2 +0,0 @@`
  bytes("src/added.ts", `new file\n${XSS_LINE}\n`); // `new file mode`, `--- /dev/null`, `@@ -0,0 +1,2 @@`
  run("mv", "src/rename-pure.ts", "src/renamed-pure.ts"); // `similarity index 100%`, no hunk, numstat 0 0
  run("mv", "src/rename-edit.ts", "src/renamed-edit.ts"); // asked for by its new path alone, git says all ten lines are new
  bytes("src/renamed-edit.ts", "a\nb\nc\nd\nE!\nf\ng\nh\ni\nj\n");
  bytes("src/blob.bin", BLOB_AFTER); // `Binary files a/… and b/… differ`, numstat `- -`
  bytes("src/newblob.bin", NEW_BLOB); // `Binary files /dev/null and b/… differ`
  chmodSync(path.join(root, "src/script.sh"), 0o755); // `old mode 100644`, `new mode 100755`, nothing else
  bytes("src/nonl.txt", "no newline at end, edited"); // the marker twice in one hunk
  bytes("src/gains-nonl.txt", "has newline"); // the marker once, on the new side
  bytes("src/empty-then-filled.txt", "now filled\n"); // `@@ -0,0 +1 @@`
  bytes("src/filled-then-empty.txt", ""); // `@@ -1 +0,0 @@`
  bytes("src/added-empty.txt", ""); // a header with `new file mode` and `index`, and no `---`, `+++` or hunk
  bytes("src/crlf.txt", "crlf one\r\ncrlf two EDITED\r\n"); // every patch line ends in a carriage return
  symlinkSync("target.txt", path.join(root, "src/link-to-target")); // mode 120000; its one line is the target, unterminated
  // A deleted line that prints as `--- a/old.ts`, and added lines that read as a hunk header and as the marker.
  bytes("patchy.md", "keep\n++ b/new.ts\n@@ -9,9 +9,9 @@ fake\n\\ No newline at end of file\nkeep2\n");
  for (const name of ODD_NAMES) bytes(name, name === "src/with space.ts" ? `space\n${oddLine(name)}\n` : `${oddLine(name)}\n`);
  bytes(`.reggie/tasks/${slugs.cases}/evidence/tests.txt`, "12 passed\n");
  commit("feat: every awkward file at once", slugs.cases);
  toMain();

  // --- awaiting decision: one changed file, and the packet a reviewer reads ----------------
  branch(slugs.awaiting);
  bytes("src/b.ts", "alpha\nbeta\ngamma\n");
  writeText(packetFile(paths, slugs.awaiting), packet(slugs.awaiting, "pending"));
  commit("feat: a third letter", slugs.awaiting);
  toMain();

  // --- only Reggie's own records ---------------------------------------------------
  branch(slugs.recordsOnly);
  bytes(`.reggie/tasks/${slugs.recordsOnly}/claim.md`, "claim\n");
  bytes(`.reggie/tasks/${slugs.recordsOnly}/evidence/tests.txt`, "proof\n");
  commit(`meta: claim ${slugs.recordsOnly}`, slugs.recordsOnly);
  toMain();

  // --- merged the base back in: the branch edits a.ts, main edits b.ts, the branch merges main ----
  branch(slugs.mergedBack);
  bytes("src/a.ts", "one\ntwo CHANGED ON BRANCH\nthree\n");
  commit("feat: branch edit", slugs.mergedBack);
  toMain();
  bytes("src/b.ts", "alpha\nbeta CHANGED ON MAIN\n");
  commit("main moves on");
  run("checkout", "-q", `task/${slugs.mergedBack}`);
  run("-c", "commit.gpgsign=false", "merge", "-q", "--no-ff", "-m", `Merge main into task/${slugs.mergedBack}`, "main");
  bytes("src/a.ts", "one\ntwo CHANGED ON BRANCH\nthree\nfour\n");
  commit("feat: second branch edit", slugs.mergedBack);
  toMain();

  // --- changed a line and changed it back: two commits ahead, an empty diff -----------
  branch(slugs.netZero);
  bytes("src/a.ts", "one\nTEMP\nthree\n");
  commit("try something", slugs.netZero);
  bytes("src/a.ts", "one\ntwo\nthree\n");
  commit("undo it");
  toMain();

  // --- a very large patch: one 60,000-line hunk, and 5 MB on a single line --------------
  if (opts.large !== false) {
    branch(slugs.large);
    const big: string[] = [];
    for (let i = 1; i <= LARGE_LINES; i += 1) big.push(`const v${i} = ${i};`);
    bytes("src/big.ts", `${big.join("\n")}\n`);
    bytes("src/oneline.txt", "x".repeat(ONE_LINE_CHARS));
    commit("feat: big add", slugs.large);
    toMain();
  }

  // --- unrelated history: `fatal: … no merge base`, exit 128 --------------------------------
  run("checkout", "-q", "--orphan", `task/${slugs.orphan}`);
  run("rm", "-rfq", ".");
  bytes("orphan.txt", "orphan\n");
  commit("orphan root", slugs.orphan);
  run("checkout", "-q", "-f", "main");

  // --- done by fast-forward: an approved packet on main, no merge commit, no branch -----------
  branch(slugs.ffLanded);
  bytes("src/ff.ts", "ff\n");
  writeText(packetFile(paths, slugs.ffLanded), packet(slugs.ffLanded, "approved"));
  commit("feat: ff work", slugs.ffLanded);
  toMain();
  run("merge", "-q", "--ff-only", `task/${slugs.ffLanded}`);
  run("branch", "-q", "-D", `task/${slugs.ffLanded}`);

  // --- done the way Reggie lands it: the verdict is written inside the merge, the branch released,
  //     and then the base changes one of the two landed files again ---------------------------------
  branch(slugs.landed);
  bytes("src/a.ts", "one\ntwo LANDED\nthree\n");
  bytes("src/landed-only.ts", "export const landed = 1;\n");
  writeText(packetFile(paths, slugs.landed), packet(slugs.landed, "pending"));
  commit("feat: landed work", slugs.landed);
  toMain();
  const config = loadConfig(paths);
  landTask(paths, config, slugs.landed, { person: currentPerson(root, loadPeople(paths)), tool: "fixture" });
  bytes("src/a.ts", "zero\none\ntwo LANDED\nthree\nlater on main\n");
  commit("later main commit");
  clearHistoryCache(root);

  return {
    repo,
    paths,
    config,
    slugs,
    sizes: { blobBefore: BLOB_BEFORE.length, blobAfter: BLOB_AFTER.length, newBlob: NEW_BLOB.length },
    oddNames: ODD_NAMES,
    large: { lines: LARGE_LINES, oneLineChars: ONE_LINE_CHARS },
  };
}

/**
 * Write the settings a developer's own git config could hold into the fixture's `.git/config`: colour
 * forced on, prefixes dropped, no context, renames off, blank context lines stripped, another
 * algorithm, and an external diff program that writes a marker file if it is ever run. Returns the
 * marker's path; it must never exist.
 */
export function hostileGitConfig(fx: DiffFixture): string {
  const marker = path.join(fx.repo.root, ".git", "external-diff-ran");
  const program = path.join(fx.repo.root, ".git", "external-diff.sh");
  writeFileSync(program, `#!/bin/sh\necho ran > "${marker}"\necho EXTERNAL-DIFF-RAN\n`);
  chmodSync(program, 0o755);
  const set = (key: string, value: string): void => void git(["config", key, value], { cwd: fx.repo.root });
  set("color.ui", "always");
  set("color.diff", "always");
  set("diff.noprefix", "true");
  set("diff.context", "0");
  set("diff.renames", "false");
  set("diff.external", program);
  set("diff.suppressBlankEmpty", "true");
  set("diff.algorithm", "patience");
  set("diff.interHunkContext", "50");
  set("core.quotePath", "true");
  return marker;
}
