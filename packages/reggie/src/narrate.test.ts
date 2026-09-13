import { describe, expect, it } from "vitest";
import { narrate, spokenPath, spokenText } from "./narrate.js";
import type { Story } from "./story.js";

const story: Story = {
  scope: "task",
  id: "cap-login-retries",
  title: "Cap login retries",
  subtitle: "Ungroomed · Captured, not yet shaped",
  crumbs: [],
  next: [],
  sections: [
    {
      id: "written",
      heading: "What was written",
      paragraphs: [{ id: "w1", kind: "fact", text: 'jacob wrote this down on 6 Sep, in one line: "Cap login retries"', refs: ["task:cap-login-retries"] }],
    },
    {
      id: "lives",
      heading: "Where it probably lives",
      paragraphs: [
        { id: "l1", kind: "gap", text: "Going only by the words in the line, it probably concerns [[#/repo/x/file/src%2Fauth%2Flogin.ts|login.ts]] in [[#/repo/x/area/src%2Fauth|src/auth]]. That is a name match, not an understanding.", refs: [] },
      ],
    },
    {
      id: "known",
      heading: "What is already known there",
      paragraphs: [{ id: "k1", kind: "note", text: "The retry loop is in `login.ts`.", refs: [], source: { author: "jacob", date: "2026-09-01", stale: true } }],
    },
    {
      id: "unclear",
      heading: "What is unclear",
      paragraphs: [{ id: "u1", kind: "list", text: "Why it matters now.\nWhat done looks like.\nWhether src/auth/login.ts is the right place.", refs: [] }],
    },
    { id: "resembles", heading: "What it resembles", paragraphs: [], empty: { text: "No other task shares its words." } },
    { id: "journal", heading: "Journal", paragraphs: [{ id: "j1", kind: "journal", text: "Claimed the task.", refs: [], source: { person: "jacob", tool: "claude" } }] },
  ],
};

describe("narrate", () => {
  it("flattens links, backticks and paths into something a voice can say", () => {
    expect(spokenText("see [[#/x|login.ts]] and `reggie plan`")).toBe("see login.ts and reggie plan");
    expect(spokenPath("src/big/a01.ts")).toBe("a01 dot ts, in src, big");
    expect(spokenPath("src/big/")).toBe("big, in src");
    expect(spokenPath("README.md")).toBe("README dot md");
  });

  it("speaks every section with its heading, reads lists as a sequence, and says why an empty section is empty", () => {
    const n = narrate(story, { repo: "reggie" });
    expect(n.title).toBe("Cap login retries");
    expect(n.script.startsWith("This is Reggie, on reggie, on the task Cap login retries.")).toBe(true);
    expect(n.script).toContain("Ungroomed, Captured, not yet shaped.");
    expect(n.sections.map((s) => s.id)).toEqual(["written", "lives", "known", "unclear", "resembles", "journal"]);
    expect(n.sections[1]?.text).toContain("it probably concerns login dot ts in auth, in src. That is a name match");
    expect(n.sections[2]?.text).toBe("A note by jacob on 2026-09-01 says: The retry loop is in login dot ts. The code has changed since it was written, so it may be out of date.");
    expect(n.sections[3]?.text).toBe("First, why it matters now. Next, what done looks like. And last, whether login dot ts, in src, auth is the right place.");
    expect(n.sections[4]?.text).toBe("No other task shares its words.");
    expect(n.sections[5]?.text).toBe("jacob, working in claude, wrote: Claimed the task.");
    expect(n.script).toContain("What was written. jacob wrote this down");
    expect(n.script.endsWith("That is everything Reggie can say about Cap login retries from the repository today.")).toBe(true);
    expect(n.words).toBeGreaterThan(60);
    expect(n.seconds).toBe(Math.round((n.words / 150) * 60));
  });

  it("can leave the headings out", () => {
    const n = narrate(story, { headings: false });
    expect(n.script).not.toContain("What was written.");
    expect(n.script).toContain("jacob wrote this down");
  });
});
