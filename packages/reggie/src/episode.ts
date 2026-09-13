import { execFile } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import type { Narration } from "./narrate.js";

const execFileAsync = promisify(execFile);

/**
 * Episodes: a narration turned into an audio file you can play in the page or subscribe to
 * from a podcast app. Audio is derived, so it lives under `.reggie/.cache/episodes/`, never
 * committed, and is rebuilt on request. macOS `say` plus `afconvert` make the file; elsewhere
 * the page falls back to the browser's own voice over the same script.
 */
export interface EpisodeMeta {
  key: string;
  scope: string;
  id: string;
  title: string;
  words: number;
  seconds: number;
  bytes: number;
  madeAt: string;
  voice: string;
}

export interface Episode extends EpisodeMeta {
  file: string;
}

/** The voice `say` uses; override with REGGIE_VOICE. */
export function defaultVoice(env: NodeJS.ProcessEnv = process.env): string {
  return env.REGGIE_VOICE || "Samantha";
}

/** `task:cap-login-retries` → `task--cap-login-retries`; slashes and dots become dashes so the key is one file name. */
export function episodeKey(scope: string, id: string): string {
  const safe = (s: string) => s.replace(/[^A-Za-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 120);
  return `${safe(scope)}--${safe(id) || "root"}`;
}

export function episodesDir(root: string): string {
  return path.join(root, ".reggie", ".cache", "episodes");
}

function audioFile(root: string, key: string): string {
  return path.join(episodesDir(root), `${key}.m4a`);
}

function metaFile(root: string, key: string): string {
  return path.join(episodesDir(root), `${key}.json`);
}

export function readEpisode(root: string, scope: string, id: string): Episode | null {
  const key = episodeKey(scope, id);
  const file = audioFile(root, key);
  const meta = metaFile(root, key);
  if (!existsSync(file) || !existsSync(meta)) return null;
  try {
    const parsed = JSON.parse(readFileSync(meta, "utf8")) as EpisodeMeta;
    return { ...parsed, file };
  } catch {
    return null;
  }
}

/** Every episode on disk, newest first, for the feed. */
export function listEpisodes(root: string): Episode[] {
  const dir = episodesDir(root);
  if (!existsSync(dir)) return [];
  const out: Episode[] = [];
  for (const name of readdirSync(dir)) {
    if (!name.endsWith(".json")) continue;
    const key = name.slice(0, -".json".length);
    const file = audioFile(root, key);
    if (!existsSync(file)) continue;
    try {
      out.push({ ...(JSON.parse(readFileSync(path.join(dir, name), "utf8")) as EpisodeMeta), file });
    } catch {
      // A half-written sidecar is not an episode.
    }
  }
  return out.sort((a, b) => b.madeAt.localeCompare(a.madeAt));
}

export interface MakeEpisodeInput {
  scope: string;
  id: string;
  narration: Narration;
  voice?: string;
}

/**
 * Speak the script into an AAC file. `say` writes AIFF; `afconvert` packs it as m4a, which every
 * podcast app and the `<audio>` element play. Both are async so the server keeps answering while
 * a two-minute script renders.
 */
export async function makeEpisode(root: string, input: MakeEpisodeInput): Promise<Episode> {
  if (process.platform !== "darwin") {
    throw new Error("making an audio episode needs macOS (it uses `say` and `afconvert`); the page can still read the script aloud with the browser's own voice.");
  }
  const key = episodeKey(input.scope, input.id);
  const dir = episodesDir(root);
  mkdirSync(dir, { recursive: true });
  const script = path.join(dir, `${key}.txt`);
  const aiff = path.join(dir, `${key}.aiff`);
  const m4a = audioFile(root, key);
  const voice = input.voice ?? defaultVoice();
  writeFileSync(script, input.narration.script, "utf8");
  try {
    await execFileAsync("say", ["-v", voice, "-f", script, "-o", aiff], { timeout: 180_000 });
    await execFileAsync("afconvert", ["-f", "m4af", "-d", "aac", "-q", "127", aiff, m4a], { timeout: 180_000 });
  } finally {
    rmSync(aiff, { force: true });
  }
  const meta: EpisodeMeta = {
    key,
    scope: input.scope,
    id: input.id,
    title: input.narration.title,
    words: input.narration.words,
    seconds: input.narration.seconds,
    bytes: statSync(m4a).size,
    madeAt: new Date().toISOString(),
    voice,
  };
  writeFileSync(metaFile(root, key), `${JSON.stringify(meta, null, 2)}\n`, "utf8");
  return { ...meta, file: m4a };
}

function xml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/**
 * A private RSS feed of every episode on disk. Podcast apps on this machine can subscribe to it
 * over loopback; reaching a phone needs the server on a reachable host, which is a separate
 * decision. `base` is the server origin, `repoQuery` the `?repo=` suffix when serving a workspace.
 */
export function renderFeed(root: string, repoName: string, base: string, repoQuery = ""): string {
  const episodes = listEpisodes(root);
  const items = episodes
    .map((e) => {
      const url = `${base}/api/episode?scope=${encodeURIComponent(e.scope)}&id=${encodeURIComponent(e.id)}${repoQuery}`;
      const minutes = Math.floor(e.seconds / 60);
      const secs = String(e.seconds % 60).padStart(2, "0");
      return [
        "    <item>",
        `      <title>${xml(e.title)}</title>`,
        `      <description>${xml(`Reggie on ${e.scope} ${e.id} in ${repoName}: ${e.words} words.`)}</description>`,
        `      <guid isPermaLink="false">${xml(`reggie:${repoName}:${e.key}:${e.madeAt}`)}</guid>`,
        `      <pubDate>${new Date(e.madeAt).toUTCString()}</pubDate>`,
        `      <enclosure url="${xml(url)}" length="${e.bytes}" type="audio/mp4"/>`,
        `      <itunes:duration>${minutes}:${secs}</itunes:duration>`,
        "    </item>",
      ].join("\n");
    })
    .join("\n");
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<rss version="2.0" xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd">',
    "  <channel>",
    `    <title>${xml(`Reggie · ${repoName}`)}</title>`,
    `    <link>${xml(base)}</link>`,
    `    <description>${xml(`What Reggie can say about ${repoName}: tasks, areas and files, narrated from the repository.`)}</description>`,
    "    <language>en</language>",
    items,
    "  </channel>",
    "</rss>",
    "",
  ].join("\n");
}
