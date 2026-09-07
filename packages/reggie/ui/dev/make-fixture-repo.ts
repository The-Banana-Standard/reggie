/**
 * ui/dev/make-fixture-repo.ts — build the test fixture repo somewhere durable and print its path.
 *
 *   npx tsx ui/dev/make-fixture-repo.ts
 *   cd "<the printed root>" && <this package>/node_modules/.bin/tsx <this package>/src/cli.ts serve --port 4461
 *
 * `reggie serve` reads the repo from the working directory, so serve it by cd-ing into the printed root.
 *
 * `makeFixtureRepo()` (test/fixtures.ts) makes a temp git repo with a 45-file area, a 2-file area, a
 * Rust crate with a `#[tauri::command]` and an `invoke()` call site, notes (one stale), a journal and
 * three tasks (ungroomed / in-process / awaiting-decision) whose two plans collide on one file — the
 * data the board, the task page and the blast radius need and this repo has none of.
 *
 * The repo is NOT deleted on exit: that is the point, the server outlives this script. It lives under
 * the OS temp directory, so the machine reclaims it on its own.
 */
import { makeFixtureRepo } from "../../test/fixtures.js";

const quiet = process.argv.includes("--quiet");
const fixture = makeFixtureRepo();

if (quiet) {
  process.stdout.write(`${fixture.repo.root}\n`);
} else {
  const { inProcess, awaiting, ungroomed } = fixture.slugs;
  process.stdout.write(
    [
      `root:    ${fixture.repo.root}`,
      `tasks:   ${ungroomed} (ungroomed), ${inProcess} (in process), ${awaiting} (awaiting decision)`,
      `serve:   (cd "${fixture.repo.root}" && ${process.cwd()}/node_modules/.bin/tsx ${process.cwd()}/src/cli.ts serve --port 4461)`,
      "",
    ].join("\n"),
  );
}
