import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { defaultVoice, episodeKey, listEpisodes, makeEpisode, readEpisode, renderFeed } from "./episode.js";
import type { Narration } from "./narrate.js";

let root: string;
beforeAll(() => {
  root = mkdtempSync(path.join(os.tmpdir(), "reggie-episode-"));
});
afterAll(() => rmSync(root, { recursive: true, force: true }));

const narration: Narration = {
  title: "Cap login retries",
  script: "This is Reggie. Cap login retries. That is all.",
  sections: [],
  words: 10,
  seconds: 4,
};

describe("episodes", () => {
  it("keys an episode by scope and id in one safe file name", () => {
    expect(episodeKey("task", "cap-login-retries")).toBe("task--cap-login-retries");
    expect(episodeKey("file", "src/auth/login.ts")).toBe("file--src-auth-login-ts");
    expect(episodeKey("repo", "")).toBe("repo--root");
    expect(episodeKey("../x", "../../etc")).toBe("x--etc");
  });

  it("has no episode until one is made, and lists nothing", () => {
    expect(readEpisode(root, "task", "nothing")).toBeNull();
    expect(listEpisodes(root)).toEqual([]);
    expect(defaultVoice({})).toBe("Samantha");
    expect(defaultVoice({ REGGIE_VOICE: "Daniel" })).toBe("Daniel");
  });

  it.skipIf(process.platform !== "darwin")("speaks a script into an m4a with a sidecar, and the feed lists it", async () => {
    const e = await makeEpisode(root, { scope: "task", id: "cap-login-retries", narration });
    expect(e.file.endsWith("task--cap-login-retries.m4a")).toBe(true);
    expect(e.bytes).toBeGreaterThan(1000);
    expect(e.words).toBe(10);
    const again = readEpisode(root, "task", "cap-login-retries");
    expect(again?.madeAt).toBe(e.madeAt);
    expect(listEpisodes(root).map((x) => x.key)).toEqual(["task--cap-login-retries"]);
    const feed = renderFeed(root, "reggie", "http://127.0.0.1:4310");
    expect(feed).toContain("<title>Reggie · reggie</title>");
    expect(feed).toContain("<title>Cap login retries</title>");
    expect(feed).toContain('<enclosure url="http://127.0.0.1:4310/api/episode?scope=task&amp;id=cap-login-retries" length="' + e.bytes + '" type="audio/mp4"/>');
    expect(feed).toContain("<itunes:duration>0:04</itunes:duration>");
  }, 60_000);

  it.skipIf(process.platform === "darwin")("says what it needs off macOS", async () => {
    await expect(makeEpisode(root, { scope: "task", id: "x", narration })).rejects.toThrow(/macOS/);
  });
});
