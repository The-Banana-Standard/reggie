/**
 * ui/dev/make-diff-fixture.ts — a fixture repo for looking at the reader's diff mode in a browser.
 *
 *   npx tsx ui/dev/make-diff-fixture.ts            # prints the root, the tasks and the pages worth opening
 *   npx tsx ui/dev/make-diff-fixture.ts --quiet    # prints only the root
 *   npx tsx ui/dev/make-diff-fixture.ts --small    # without the 60,000-line branch
 *
 * `makeDiffFixture()` (test/diff-fixture.ts) is the repo the change routes are tested against: one
 * in-process task whose branch holds every awkward file at once (deleted, added, renamed, binary,
 * mode only, symlink, empty, no trailing newline, CRLF, seven hostile names, content that imitates
 * diff syntax, a line of markup that must stay text), and one small task per branch-level case. The
 * tests read its payloads; this script is for the half no test reads, which is how the rows are drawn.
 *
 * Serve it by cd-ing into the printed root — `reggie serve` reads the repo from the working
 * directory. The repo lives under the OS temp directory and is never deleted here, because the
 * server has to outlive this process.
 */
import { makeDiffFixture } from "../../test/diff-fixture.js";

const quiet = process.argv.includes("--quiet");
const fixture = makeDiffFixture({ large: !process.argv.includes("--small") });
const root = fixture.repo.root;

if (quiet) {
  process.stdout.write(`${root}\n`);
} else {
  const s = fixture.slugs;
  const name = root.split("/").pop();
  const page = (slug: string, file: string): string => `#/repo/${name}/file/${file.split("/").map(encodeURIComponent).join("/")}?diff=${slug}`;
  process.stdout.write(
    [
      `root:    ${root}`,
      `serve:   (cd "${root}" && ${process.cwd()}/node_modules/.bin/tsx ${process.cwd()}/src/cli.ts serve --port 4471)`,
      "",
      `tasks:   ${s.cases} (in process, every file-level case), ${s.awaiting} (awaiting decision), ${s.landed} (done, read through its merge)`,
      `         ${s.zeroAhead}, ${s.recordsOnly}, ${s.mergedBack}, ${s.netZero}, ${s.large}, ${s.ffLanded}, ${s.noBranch}, ${s.orphan}`,
      "",
      "pages:",
      `  several hunks and gaps   ${page(s.cases, "src/long.ts")}`,
      `  added, markup as text    ${page(s.cases, "src/added.ts")}`,
      `  deleted                  ${page(s.cases, "src/deleted.ts")}`,
      `  binary                   ${page(s.cases, "src/blob.bin")}`,
      `  mode only                ${page(s.cases, "src/script.sh")}`,
      `  renamed                  ${page(s.cases, "src/renamed-pure.ts")}`,
      `  paged (60,000 rows)      ${page(s.large, "src/big.ts")}`,
      `  landed, base moved on    ${page(s.landed, "src/a.ts")}`,
      `  one of Reggie's records  ${page(s.landed, `.reggie/tasks/${s.landed}/packet.md`)}`,
      `  net-zero task page       #/repo/${name}/task/${s.netZero}`,
      "",
    ].join("\n"),
  );
}
