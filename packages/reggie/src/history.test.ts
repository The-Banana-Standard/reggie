import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { makeTempRepo, type TempRepo } from "../test/helpers.js";
import { git } from "./git.js";
import {
  ancestorKeys,
  clearHistoryCache,
  commitsPerDayFor,
  deriveHistory,
  historyCacheFile,
  historyFor,
  historyForFiles,
  historyKey,
  lastTouchedFor,
  MAX_DAY_SPAN,
  noHistory,
  parseNumstatLog,
  parseNumstatPath,
  recentFor,
  repoHistory,
  sinceToMs,
  taskFromSubject,
  taskFromTrailers,
  unquotePath,
} from "./history.js";
import { ensureGitignore, ensureLayout } from "./layout.js";
import { addNote, notesIndex, staleEntriesFor } from "./notes.js";
import { repoPaths } from "./paths.js";
import { savePeople } from "./people.js";

const NOW = new Date("2026-09-07T12:00:00Z");

/** Epoch ms of an ISO string, so assertions do not depend on whether git prints UTC as `Z` or `+00:00`. */
function at(iso: string | null | undefined): number | null {
  return iso ? Date.parse(iso) : null;
}

/** Run git with author and committer dates pinned, so `--since` and `%cI` are deterministic. */
function gitDated(root: string, date: string, args: string[]): void {
  const previous = process.env.GIT_COMMITTER_DATE;
  process.env.GIT_COMMITTER_DATE = date;
  try {
    git(args, { cwd: root });
  } finally {
    if (previous === undefined) delete process.env.GIT_COMMITTER_DATE;
    else process.env.GIT_COMMITTER_DATE = previous;
  }
}

/** Commit the working tree as a specific author on a specific date, with optional extra message paragraphs. */
function commitAs(root: string, author: string, date: string, subject: string, ...paragraphs: string[]): void {
  git(["add", "-A"], { cwd: root });
  const args = ["commit", "-q", "--allow-empty", `--author=${author}`, `--date=${date}`, "-m", subject];
  for (const p of paragraphs) args.push("-m", p);
  gitDated(root, date, args);
}

describe("history", () => {
  let repo: TempRepo;
  beforeEach(() => {
    clearHistoryCache();
    repo = makeTempRepo();
    // Pin the helper's init commit to a fixed date so nothing below depends on the wall clock.
    gitDated(repo.root, "2026-07-01T00:00:00Z", ["commit", "-q", "--amend", "--no-edit", "--author=Test Person <test@example.com>", "--date=2026-07-01T00:00:00Z"]);
    // Alice creates two files (10 + 3 lines) on a task branch commit with a Task trailer.
    repo.write("src/a.ts", Array.from({ length: 10 }, (_, i) => `export const a${i} = ${i};`).join("\n") + "\n");
    repo.write("src/b.ts", "export const b = 1;\nexport const b2 = 2;\nexport const b3 = 3;\n");
    commitAs(repo.root, "Alice Adams <alice@example.com>", "2026-08-01T10:00:00+02:00", "add a and b", "Task: login-cap");
    // Bob adds two lines to a.ts a month later.
    repo.write("src/a.ts", readFileSync(path.join(repo.root, "src/a.ts"), "utf8") + "export const extra = 1;\nexport const extra2 = 2;\n");
    commitAs(repo.root, "Bob Builder <bob@example.com>", "2026-09-01T09:00:00Z", "extend a | with pipe");
    // Alice renames b.ts to c.ts through a merge-style subject.
    git(["mv", "src/b.ts", "src/c.ts"], { cwd: repo.root });
    commitAs(repo.root, "Alice Adams <alice@example.com>", "2026-09-05T08:00:00Z", "Merge branch 'task/rename-b'");
  });
  afterEach(() => {
    clearHistoryCache();
    repo.cleanup();
  });

  it("attributes commits and lines per file to two authors and computes busFactor", () => {
    const index = repoHistory(repo.root, { now: NOW });
    expect(index.sha).toMatch(/^[0-9a-f]{40}$/);
    expect(index.totalCommits).toBe(4); // init + three above
    const a = historyFor(index, "src/a.ts");
    expect(a).not.toBeNull();
    expect(a?.commits365).toBe(2);
    expect(a?.commits30).toBe(1); // only Bob's 1 Sep commit is within 30 days of 7 Sep
    expect(a?.commits90).toBe(2);
    expect(a?.linesChanged).toBe(12);
    expect(at(a?.lastTouched)).toBe(at("2026-09-01T09:00:00Z"));
    expect(a?.authors.map((x) => x.email)).toEqual(["alice@example.com", "bob@example.com"]);
    expect(a?.authors[0]?.lines).toBe(10);
    expect(a?.authors[1]?.lines).toBe(2);
    expect(a?.authors[0]?.share).toBeCloseTo(10 / 12, 5);
    expect(a?.busFactor).toBe(1); // Bob holds 2/12 < 20%
    const c = historyFor(index, "src/c.ts");
    expect(c?.busFactor).toBe(1);
    expect(c?.authors).toHaveLength(1);
  });

  it("attributes a rename to the new path and keeps the old path's earlier history", () => {
    const index = repoHistory(repo.root, { now: NOW });
    const c = historyFor(index, "src/c.ts");
    expect(c?.commits365).toBe(1);
    expect(c?.linesChanged).toBe(0);
    expect(at(c?.lastTouched)).toBe(at("2026-09-05T08:00:00Z"));
    const b = historyFor(index, "src/b.ts");
    expect(b?.commits365).toBe(1);
    expect(b?.linesChanged).toBe(3);
    expect(recentFor(index, "src/c.ts")[0]?.task).toBe("rename-b");
  });

  it("rolls up directories without double counting and gives the repo every commit", () => {
    const index = repoHistory(repo.root, { now: NOW });
    const src = historyFor(index, "src/");
    expect(src?.commits365).toBe(3);
    expect(src?.commits30).toBe(2);
    expect(src?.linesChanged).toBe(15);
    expect(src?.authors.map((x) => x.name)).toEqual(["Alice Adams", "Bob Builder"]);
    expect(src?.authors[0]?.commits).toBe(2);
    expect(src?.busFactor).toBe(1);
    expect(historyFor(index, "src")).toEqual(src); // dir lookup without the slash
    const root = historyFor(index, "");
    expect(root?.commits365).toBe(4);
    expect(root?.linesChanged).toBe(16); // README init line included
    expect(historyFor(index, ".")).toEqual(root);
    expect(historyFor(index, "./")).toEqual(root);
    expect(historyFor(index, "nope/missing.ts")).toBeNull();
  });

  it("lists the last eight commits per path with task slugs from trailers and subjects", () => {
    const index = repoHistory(repo.root, { now: NOW });
    const recent = recentFor(index, "src/a.ts");
    expect(recent).toHaveLength(2);
    expect(recent[0]?.author).toBe("Bob Builder");
    expect(recent[0]?.subject).toBe("extend a | with pipe");
    expect(recent[0]?.task).toBeNull();
    expect(recent[1]?.task).toBe("login-cap");
    expect(recent[1]?.handle).toBe("alice");
    expect(recentFor(index, "")).toHaveLength(4);
    expect(index.commits[0]?.subject).toBe("Merge branch 'task/rename-b'");
  });

  it("counts commits per day as a dense series", () => {
    const index = repoHistory(repo.root, { now: NOW });
    const series = commitsPerDayFor(index, "src", 10, NOW);
    expect(series).toHaveLength(10);
    expect(series[series.length - 1]?.date).toBe("2026-09-07");
    expect(series.find((d) => d.date === "2026-09-05")?.count).toBe(1);
    expect(series.find((d) => d.date === "2026-09-01")?.count).toBe(1);
    expect(series.filter((d) => d.count > 0)).toHaveLength(2);
    const whole = commitsPerDayFor(index, "", 40, NOW);
    expect(whole.reduce((n, d) => n + d.count, 0)).toBe(3); // 1 Aug, 1 Sep, 5 Sep; the 1 Jul init commit is outside
    expect(commitsPerDayFor(index, "", 400, NOW).reduce((n, d) => n + d.count, 0)).toBe(4);
  });

  it("caps the dense day series so a caller cannot ask for an unbounded allocation", () => {
    const index = repoHistory(repo.root, { now: NOW });
    // The series is one object per day, so an unchecked `days` is an allocation the caller sizes.
    expect(commitsPerDayFor(index, "", 100_000_000, NOW)).toHaveLength(MAX_DAY_SPAN);
    expect(commitsPerDayFor(index, "", Number.NaN, NOW)).toHaveLength(30);
    expect(commitsPerDayFor(index, "", 0, NOW)).toHaveLength(1);
  });

  it("rolls history up over an arbitrary file set, counting each commit once", () => {
    const index = repoHistory(repo.root, { now: NOW });
    // "add a and b" touched both files: one commit, 13 lines — not the 3 commits a naive sum of the
    // two per-file records would report (a: 2 commits, b: 1).
    const pair = historyForFiles(index, ["src/a.ts", "src/b.ts"]);
    expect(pair?.commits365).toBe(2);
    expect(pair?.commits30).toBe(1);
    expect(pair?.linesChanged).toBe(15);
    expect(historyFor(index, "src/a.ts")?.commits365).toBe(2);
    expect(historyFor(index, "src/b.ts")?.commits365).toBe(1);
    // The whole of src/ as a file set must equal the directory roll-up byPath already holds.
    expect(historyForFiles(index, ["src/a.ts", "src/b.ts", "src/c.ts"])).toEqual(historyFor(index, "src/"));
    expect(historyForFiles(index, [])).toBeNull();
    expect(historyForFiles(index, ["nope/missing.ts"])).toBeNull();
  });

  it("marks a node git has never seen with null counts, not zeros", () => {
    // "no history" and "no commits in the window" are different facts and draw differently.
    expect(noHistory()).toEqual({ commits30: null, commits90: null, commits365: null, linesChanged: 0, lastTouched: null, authors: [], busFactor: 0 });
    expect(noHistory()).not.toBe(noHistory());
  });

  it("joins authors to people.yaml handles and falls back to handleFor", () => {
    const paths = repoPaths(repo.root);
    savePeople(paths, { people: [{ name: "Alice Adams", email: "alice@example.com", handle: "ali", role: "maintainer" }] });
    const index = repoHistory(repo.root, { now: NOW });
    const a = historyFor(index, "src/a.ts");
    expect(a?.authors.map((x) => x.handle)).toEqual(["ali", "bob"]);
    expect(recentFor(index, "src/a.ts")[1]?.handle).toBe("ali");
  });

  it("feeds staleness through the lastTouched map with no per-note git calls", () => {
    const paths = repoPaths(repo.root);
    ensureLayout(paths);
    addNote(paths, "src/a.ts", { type: "how", text: "Old.", author: "test", date: "2026-08-15" });
    addNote(paths, "src/a.ts", { type: "gotcha", text: "Fresh.", author: "test", date: "2026-09-02" });
    addNote(paths, "src/", { type: "why", text: "Folder note.", author: "test", date: "2026-09-03" });
    const index = repoHistory(repo.root, { now: NOW });
    expect(at(lastTouchedFor(index, "src/a.ts"))).toBe(at("2026-09-01T09:00:00Z"));
    expect(at(index.lastTouched.get("src/"))).toBe(at("2026-09-05T08:00:00Z"));
    const notes = Array.from(notesIndex(paths).values());
    expect(notesIndex(paths).get("src/")?.entries).toHaveLength(1);
    const viaMap = staleEntriesFor(paths, notes, index.lastTouched);
    expect(viaMap.map((s) => `${s.entity}|${s.entry.date}|${s.codeChanged}`).sort()).toEqual(["src/a.ts|2026-08-15|2026-09-01", "src/|2026-09-03|2026-09-05"]);
    const viaGit = staleEntriesFor(paths, notes);
    expect(viaGit.map((s) => `${s.entity}|${s.entry.date}`).sort()).toEqual(viaMap.map((s) => `${s.entity}|${s.entry.date}`).sort());
    // Fed a map that says nothing changed recently, the note is not stale and git is not consulted.
    expect(staleEntriesFor(paths, notes, new Map([["src/a.ts", "2026-08-01T00:00:00Z"], ["src/", "2026-08-01T00:00:00Z"]]))).toHaveLength(0);
  });

  it("caches on disk under .reggie/.cache keyed by HEAD sha and reuses it", () => {
    ensureLayout(repoPaths(repo.root));
    const first = repoHistory(repo.root, { now: NOW });
    const file = historyCacheFile(repo.root, first.sha);
    expect(existsSync(file)).toBe(true);
    const data = JSON.parse(readFileSync(file, "utf8")) as { sha: string; since: string; commits: { subject: string }[] };
    expect(data.sha).toBe(first.sha);
    expect(data.since).toBe("365.days");
    expect(data.commits).toHaveLength(4);
    // Same process: the in-memory copy answers.
    expect(repoHistory(repo.root, { now: NOW })).toBe(first);
    // New process (memory cleared): the disk file answers, proven by editing it.
    clearHistoryCache(repo.root);
    data.commits[0]!.subject = "from the cache file";
    writeFileSync(file, JSON.stringify(data), "utf8");
    const second = repoHistory(repo.root, { now: NOW });
    expect(second).not.toBe(first);
    expect(second.commits[0]?.subject).toBe("from the cache file");
    // A new commit changes HEAD: the old file is replaced by one for the new sha.
    repo.write("src/d.ts", "export const d = 1;\n");
    repo.commitAll("add d");
    const third = repoHistory(repo.root, { now: NOW });
    expect(third.sha).not.toBe(first.sha);
    expect(existsSync(historyCacheFile(repo.root, third.sha))).toBe(true);
    expect(existsSync(file)).toBe(false);
    expect(third.commits[0]?.subject).toBe("add d");
    // A corrupt file is ignored and rebuilt.
    clearHistoryCache(repo.root);
    writeFileSync(historyCacheFile(repo.root, third.sha), "{not json", "utf8");
    expect(repoHistory(repo.root, { now: NOW }).commits[0]?.subject).toBe("add d");
    expect(JSON.parse(readFileSync(historyCacheFile(repo.root, third.sha), "utf8")).sha).toBe(third.sha);
  });

  it("re-derives the day windows when the reference instant moves without re-reading git", () => {
    const now = repoHistory(repo.root, { now: NOW });
    expect(historyFor(now, "src/a.ts")?.commits30).toBe(1);
    const later = repoHistory(repo.root, { now: new Date("2026-10-15T00:00:00Z") });
    expect(historyFor(later, "src/a.ts")?.commits30).toBe(0);
    expect(historyFor(later, "src/a.ts")?.commits90).toBe(2);
    expect(later.sha).toBe(now.sha);
  });

  it("does not write a cache file into a repo that has not been onboarded", () => {
    const index = repoHistory(repo.root, { now: NOW });
    expect(index.totalCommits).toBe(4);
    expect(existsSync(path.join(repo.root, ".reggie"))).toBe(false);
  });

  it("returns an empty index for a repo without commits and skips the disk cache when asked", () => {
    const bare = makeTempRepo();
    try {
      git(["update-ref", "-d", "refs/heads/main"], { cwd: bare.root });
      const index = repoHistory(bare.root, { now: NOW });
      expect(index.sha).toBe("");
      expect(index.totalCommits).toBe(0);
      expect(historyFor(index, "")).toBeNull();
    } finally {
      bare.cleanup();
    }
    clearHistoryCache(repo.root);
    const index = repoHistory(repo.root, { now: NOW, diskCache: false, since: "2026-08-15" });
    expect(index.since).toBe("2026-08-15");
    expect(index.totalCommits).toBe(2); // 1 Sep and 5 Sep; 1 Jul (init) and 1 Aug are before the cutoff
    expect(historyFor(index, "src/a.ts")?.commits365).toBe(1);
    expect(existsSync(historyCacheFile(repo.root, index.sha))).toBe(false);
  });

  it("adds .reggie/.cache/ to .gitignore, also for repos onboarded before the cache existed", () => {
    ensureLayout(repoPaths(repo.root));
    const ignore = readFileSync(path.join(repo.root, ".gitignore"), "utf8");
    expect(ignore).toContain(".reggie/.cache/\n");
    expect(ensureGitignore(repo.root)).toBe(false);
    writeFileSync(path.join(repo.root, ".gitignore"), "# Reggie: derived caches only. Everything else in .reggie/ is committed.\n.reggie/graph/\n.reggie/**/*.tmp\n", "utf8");
    expect(ensureGitignore(repo.root)).toBe(true);
    const upgraded = readFileSync(path.join(repo.root, ".gitignore"), "utf8");
    expect(upgraded.split("\n").filter((l) => l === ".reggie/.cache/")).toHaveLength(1);
    expect(upgraded.split("\n").filter((l) => l.startsWith("# Reggie"))).toHaveLength(1);
    expect(git(["check-ignore", "-q", ".reggie/.cache/history-abc.json"], { cwd: repo.root, allowFailure: true }).ok).toBe(true);
  });
});

describe("history parsing", () => {
  it("parses the numstat log with pipes in subjects, merges, binaries, and both rename forms", () => {
    const text = [
      "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa|Ann|ann@x.io|2026-09-06T10:00:00+00:00|Merge branch 'task/feat-x'|",
      "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb|Ann|ann@x.io|2026-09-05T10:00:00+00:00|subject | with pipe|feat-y;other",
      "",
      "3\t1\tsrc/lib/{one.ts => two.ts}",
      "0\t0\tsrc/lib/{ => deep}/three.ts",
      "-\t-\tassets/logo.png",
      "2\t0\told.ts => new.ts",
      "1\t0\t\"src/caf\\303\\251.ts\"",
      "cccccccccccccccccccccccccccccccccccccccc|Bo|bo@x.io|2026-09-04T10:00:00+00:00|plain|",
      "",
      "5\t5\tREADME.md",
      "",
    ].join("\n");
    const commits = parseNumstatLog(text);
    expect(commits).toHaveLength(3);
    expect(commits[0]?.files).toEqual([]);
    expect(commits[0]?.task).toBe("feat-x");
    expect(commits[1]?.subject).toBe("subject | with pipe");
    expect(commits[1]?.task).toBe("feat-y");
    expect(commits[1]?.files).toEqual([
      { path: "src/lib/two.ts", added: 3, deleted: 1, from: "src/lib/one.ts" },
      { path: "src/lib/deep/three.ts", added: 0, deleted: 0, from: "src/lib/three.ts" },
      { path: "assets/logo.png", added: 0, deleted: 0 },
      { path: "new.ts", added: 2, deleted: 0, from: "old.ts" },
      { path: "src/café.ts", added: 1, deleted: 0 },
    ]);
    expect(commits[2]?.files).toEqual([{ path: "README.md", added: 5, deleted: 5 }]);
  });

  it("derives per-path and per-directory numbers from parsed commits", () => {
    const commits = parseNumstatLog(
      [
        "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa|Ann|ann@x.io|2026-09-06T10:00:00+00:00|two files|",
        "",
        "10\t0\tsrc/a.ts",
        "10\t0\tsrc/b.ts",
        "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb|Bo|bo@x.io|2026-06-01T10:00:00+00:00|one file|",
        "",
        "4\t0\tsrc/a.ts",
        "cccccccccccccccccccccccccccccccccccccccc|Cy|cy@x.io|2025-01-01T10:00:00+00:00|too old|",
        "",
        "100\t0\tsrc/a.ts",
      ].join("\n"),
    );
    const index = deriveHistory(commits, { sha: "x", since: "365.days", now: NOW, people: { people: [] }, generatedAt: NOW.toISOString() });
    expect(index.totalCommits).toBe(2); // the 2025 commit is outside the since window
    const src = historyFor(index, "src/");
    expect(src?.commits365).toBe(2);
    expect(src?.commits30).toBe(1);
    expect(src?.commits90).toBe(1);
    expect(src?.linesChanged).toBe(24);
    expect(src?.authors.map((a) => [a.handle, a.commits, a.lines])).toEqual([["ann", 1, 20], ["bo", 1, 4]]);
    expect(src?.busFactor).toBe(1);
    const a = historyFor(index, "src/a.ts");
    expect(a?.authors.map((x) => x.share)).toEqual([10 / 14, 4 / 14]);
    expect(a?.busFactor).toBe(2);
    expect(recentFor(index, "src/b.ts").map((c) => c.sha)).toEqual(["aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"]);
    expect(historyFor(index, "./")?.commits365).toBe(2);
  });

  it("keeps only eight recent commits per path", () => {
    const lines: string[] = [];
    for (let i = 0; i < 12; i += 1) {
      const sha = String(i).padStart(40, "0");
      lines.push(`${sha}|Ann|ann@x.io|2026-09-0${(i % 6) + 1}T10:00:00+00:00|c${i}|`, "", "1\t0\tsrc/a.ts");
    }
    const index = deriveHistory(parseNumstatLog(lines.join("\n")), { sha: "x", since: "365.days", now: NOW, people: { people: [] }, generatedAt: "" });
    expect(recentFor(index, "src/a.ts")).toHaveLength(8);
    expect(recentFor(index, "src/a.ts")[0]?.subject).toBe("c0");
    expect(historyFor(index, "src/a.ts")?.commits365).toBe(12);
    expect(historyFor(index, "src/a.ts")?.lastTouched).toBe("2026-09-06T10:00:00+00:00");
  });

  it("helpers: keys, ancestors, task slugs, since, quoting", () => {
    expect(historyKey("")).toBe("./");
    expect(historyKey("./src/a.ts")).toBe("src/a.ts");
    expect(historyKey("src\\lib\\")).toBe("src/lib/");
    expect(ancestorKeys("src/lib/a.ts")).toEqual(["src/lib/", "src/", "./"]);
    expect(ancestorKeys("a.ts")).toEqual(["./"]);
    expect(taskFromTrailers(" ; Login-Cap ;x")).toBe("login-cap");
    expect(taskFromTrailers("")).toBeNull();
    expect(taskFromSubject("Merge pull request #5 from org/task/fix-it")).toBe("fix-it");
    expect(taskFromSubject("task/fix-it: tidy")).toBe("fix-it");
    expect(taskFromSubject("multitask/no")).toBeNull();
    expect(taskFromSubject("no branch here")).toBeNull();
    expect(sinceToMs("365.days", NOW.getTime())).toBe(NOW.getTime() - 365 * 86_400_000);
    expect(sinceToMs("30 days", NOW.getTime())).toBe(NOW.getTime() - 30 * 86_400_000);
    expect(sinceToMs("2026-01-01", NOW.getTime())).toBe(Date.parse("2026-01-01"));
    expect(sinceToMs("last tuesday", NOW.getTime())).toBeNull();
    expect(unquotePath('"a\\tb\\"c\\\\d"')).toBe('a\tb"c\\d');
    expect(unquotePath("plain.ts")).toBe("plain.ts");
    expect(parseNumstatPath("src/{a => b}/x.ts")).toEqual({ path: "src/b/x.ts", from: "src/a/x.ts" });
    expect(parseNumstatPath("{a => }/x.ts")).toEqual({ path: "x.ts", from: "a/x.ts" });
  });
});
