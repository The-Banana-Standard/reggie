/**
 * ui/dev/serve-idea-fixture.ts — serve a fixture workspace for the idea action, with Terminal stubbed.
 *
 *   IDEA_TERMINAL=ok   npx tsx ui/dev/serve-idea-fixture.ts --port 4465
 *   IDEA_TERMINAL=deny npx tsx ui/dev/serve-idea-fixture.ts --port 4465          (the default mode)
 *   IDEA_TERMINAL=hang npx tsx ui/dev/serve-idea-fixture.ts --port 4465 --host 0.0.0.0
 *
 * `POST /api/launch` is the one route that starts a process, and on macOS that means a Terminal
 * window. Nothing that exercises the idea action from a browser may open one, so the osascript call
 * is replaced here at the `child_process` level, before the server is imported, in one of three modes:
 *   ok    — exit 0 without opening anything (the `launched: true` branch, seen only through this stub)
 *   deny  — exit 1 with the "Not authorized to send Apple events to Terminal" error macOS gives when
 *           automation was refused (`launched: false`, the command comes back to copy)
 *   hang  — no answer for as long as the caller's timeout, then the kill spawnSync reports, so the
 *           8 s bound in launch.ts fires and the client's six-second hand-over is seen first
 * Every other spawn (git) runs for real. The stub logs each call to stderr.
 *
 * The workspace holds `fixture` (`makeFixtureRepo` plus a file with a space, one with non-ASCII
 * letters, a symlink into the repo and one out to /etc/hosts) and `bare` (a git repo with no
 * .reggie/ directory at all). `--single` serves the fixture alone; `--empty` serves a workspace whose
 * listing names no usable repo. Nothing is deleted on exit: the server outlives this script and the
 * temp directories are the machine's to reclaim.
 */
import cp from "node:child_process";
import { mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import os from "node:os";
import path from "node:path";

type Mode = "ok" | "deny" | "hang";
const mode = ((): Mode => {
  const m = process.env.IDEA_TERMINAL ?? "deny";
  if (m === "ok" || m === "deny" || m === "hang") return m;
  throw new Error(`IDEA_TERMINAL must be ok, deny or hang, got "${m}"`);
})();

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? String(process.argv[i + 1]) : fallback;
}
const port = Number.parseInt(arg("--port", "4465"), 10);
const host = arg("--host", "127.0.0.1");
const single = process.argv.includes("--single");
const empty = process.argv.includes("--empty");

// --- the stub, before anything imports the server ---------------------------------------------
const realSpawnSync = cp.spawnSync;
let calls = 0;
(cp as unknown as { spawnSync: unknown }).spawnSync = function stubbedSpawnSync(cmd: string, args?: readonly string[], opts?: { timeout?: number }): unknown {
  if (cmd !== "osascript") return realSpawnSync(cmd, args as string[], opts as never);
  calls += 1;
  const script = String(args?.[1] ?? "");
  process.stderr.write(`[osascript stub] call ${calls}, mode ${mode}: ${script.slice(0, 140)}${script.length > 140 ? "…" : ""}\n`);
  const base = { pid: 0, output: [] as string[], stdout: "", stderr: "" };
  if (mode === "ok") return { ...base, status: 0, signal: null };
  if (mode === "deny") return { ...base, status: 1, signal: null, stderr: "execution error: Not authorized to send Apple events to Terminal. (-1743)\n" };
  // hang: block the way an unanswered consent dialog blocks, then report the kill the timeout causes.
  const ms = opts?.timeout ?? 8000;
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
  const error = Object.assign(new Error("spawnSync osascript ETIMEDOUT"), { code: "ETIMEDOUT" });
  return { ...base, status: null, signal: "SIGTERM", error };
};
syncBuiltinESMExports();

const { startServer } = await import("../../src/serve.js");
const { makeFixtureRepo } = await import("../../test/fixtures.js");
const { makeTempRepo } = await import("../../test/helpers.js");
const { discoverWorkspace } = await import("../../src/workspace.js");

// --- the repos -----------------------------------------------------------------------------
const fx = makeFixtureRepo();
fx.repo.write("src/a b.ts", "export const ab = 1;\n");
fx.repo.write("src/café ü/uni.ts", "export const uni = 1;\n");
fx.repo.write("docs/README.md", "# docs\n");
symlinkSync("../src/types/shape.ts", path.join(fx.repo.root, "docs", "inside"));
symlinkSync("/etc/hosts", path.join(fx.repo.root, "docs", "outside"));
fx.repo.commitAll("origin shapes");

const bare = makeTempRepo("reggie-bare-");
bare.write("src/one.ts", "export const one = 1;\n");
bare.commitAll("code");

const wsDir = mkdtempSync(path.join(os.tmpdir(), "reggie-idea-ws-"));
const listing = empty
  ? ["### ghost", "- **Path**: ./does-not-exist", "- **Purpose**: A repo the listing names and the disk lacks", "- **Tech Stack**: none"]
  : [
      "### fixture",
      `- **Path**: ${fx.repo.root}`,
      "- **Purpose**: The fixture repo: notes on a folder and a file, three tasks, and the origin shapes",
      "- **Tech Stack**: TypeScript",
      "",
      "### bare",
      `- **Path**: ${bare.root}`,
      "- **Purpose**: A repo with no .reggie directory at all",
      "- **Tech Stack**: TypeScript",
    ];
writeFileSync(path.join(wsDir, "CLAUDE.md"), ["# Idea Workspace", "", "## Repos", "", ...listing, ""].join("\n"), "utf8");
const workspace = single ? null : discoverWorkspace(wsDir);

// --- the server ----------------------------------------------------------------------------
const server = await startServer(fx.paths, fx.config, { port, host, workspace });
const repo = "fixture"; // the package.json name, which is what single-repo mode calls it too
const base = `http://127.0.0.1:${server.port}`;
const q = server.key ? `?key=${encodeURIComponent(server.key)}` : "";
const { ungroomed, inProcess, awaiting } = fx.slugs;
process.stdout.write(
  [
    `mode:      ${mode} (IDEA_TERMINAL); osascript is stubbed, no Terminal window can open`,
    `fixture:   ${fx.repo.root}`,
    `bare:      ${bare.root}`,
    `workspace: ${single ? "(single-repo mode)" : wsDir}${empty ? " (empty listing)" : ""}`,
    `intake:    ${fx.paths.intake}`,
    `tasks:     ${ungroomed} (ungroomed), ${inProcess} (in process), ${awaiting} (awaiting decision)`,
    `serving:   ${base}${q}${server.addresses.length ? ` and ${server.addresses.map((a) => `http://${a}:${server.port}${q}`).join(", ")}` : ""}`,
    "pages:",
    ...(single ? [] : [`  ${base}/${q}#/ws`]),
    `  ${base}/${q}#/repo/${repo}`,
    `  ${base}/${q}#/repo/${repo}/area/src/big`,
    `  ${base}/${q}#/repo/${repo}/file/src/types/shape.ts`,
    `  ${base}/${q}#/repo/${repo}/symbol/src/types/shape.ts::emptyShape`,
    `  ${base}/${q}#/repo/${repo}/task/${ungroomed}`,
    `  ${base}/${q}#/repo/${repo}/tasks`,
    ...(single || empty ? [] : [`  ${base}/${q}#/repo/bare`]),
    "",
  ].join("\n"),
);
