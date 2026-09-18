import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeTempRepo, type TempRepo } from "../test/helpers.js";
import { ensureLayout } from "./layout.js";
import { repoPaths } from "./paths.js";

/**
 * The one resolver case a real disk cannot stage: `existsSync` says the entry is there and the next
 * call finds it gone (an entry removed between the listing and the check). Node's own error names
 * the absolute path, and that message must never become a 400 body, a CLI line or a tool error, so
 * `realpathSync` is stubbed for this file alone; every other capture test runs on the real fs.
 */
vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return { ...actual, default: actual, realpathSync: vi.fn(actual.realpathSync) };
});

const fs = await import("node:fs");
const { resolveCaptureOrigin } = await import("./capture.js");

describe("resolveCaptureOrigin when the entry vanishes between the listing and the check", () => {
  let repo: TempRepo;
  beforeEach(() => {
    repo = makeTempRepo();
    ensureLayout(repoPaths(repo.root));
    repo.write("src/serve.ts", "export const serve = 1;\n");
    repo.commitAll("code");
  });
  afterEach(() => {
    // `mockImplementationOnce` falls back to the real function after its one throw; only the call log is cleared.
    vi.mocked(fs.realpathSync).mockClear();
    repo.cleanup();
  });

  it("answers with its own sentence, not with Node's message and the absolute path", () => {
    const paths = repoPaths(repo.root);
    const node = Object.assign(new Error(`ENOENT: no such file or directory, lstat '${repo.root}/src/serve.ts'`), { code: "ENOENT" });
    vi.mocked(fs.realpathSync).mockImplementationOnce(() => {
      throw node;
    });
    let message = "";
    try {
      resolveCaptureOrigin(paths, { path: "src/serve.ts" });
    } catch (err) {
      message = err instanceof Error ? err.message : String(err);
    }
    expect(message).toBe("`src/serve.ts` is listed by git but is not on disk.");
    expect(message).not.toContain(repo.root);
    expect(message).not.toContain("ENOENT");
  });
});
