import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { makeTempRepo, type TempRepo } from "../test/helpers.js";
import { addIntakeDetail, capture, removeFromIntake } from "./capture.js";
import { ensureLayout } from "./layout.js";
import { repoPaths } from "./paths.js";
import { currentPerson } from "./people.js";
import { readIntake } from "./tasks.js";

describe("capture", () => {
  let repo: TempRepo;
  beforeEach(() => {
    repo = makeTempRepo();
    ensureLayout(repoPaths(repo.root));
  });
  afterEach(() => repo.cleanup());

  it("derives unique slugs and keeps detail lines", () => {
    const paths = repoPaths(repo.root);
    const person = currentPerson(repo.root);
    const a = capture(paths, { text: "Login retries are not capped", person, source: "cli", detail: "seen on staging\nonly on web" });
    const b = capture(paths, { text: "Login retries are not capped", person, source: "voice" });
    expect(a.slug).toBe("login-retries-are-not-capped");
    expect(b.slug).toBe("login-retries-are-not-capped-2");
    const items = readIntake(paths);
    expect(items).toHaveLength(2);
    expect(items[0]?.detail).toEqual(["seen on staging", "only on web"]);
    expect(items[1]?.text).toBe("Login retries are not capped");
    expect(items[1]?.meta).toContain("test, voice,");
  });

  it("removes an item and its detail once planned", () => {
    const paths = repoPaths(repo.root);
    const person = currentPerson(repo.root);
    capture(paths, { text: "First thing", person, source: "cli", detail: "d1" });
    capture(paths, { text: "Second thing", person, source: "cli" });
    expect(removeFromIntake(paths, "first-thing")).toBe(true);
    const items = readIntake(paths);
    expect(items.map((i) => i.slug)).toEqual(["second-thing"]);
    expect(removeFromIntake(paths, "first-thing")).toBe(false);
  });

  it("adds detail under an existing intake item, after the detail already there", () => {
    const paths = repoPaths(repo.root);
    const person = currentPerson(repo.root);
    capture(paths, { text: "Login retries are not capped", person, source: "cli", detail: "seen on staging" });
    capture(paths, { text: "Something else", person, source: "cli" });
    const r = addIntakeDetail(paths, { slug: "login-retries-are-not-capped", text: "It is the web client only.\nThe modal keeps the loop alive.", person, source: "web" });
    expect(r.createdLine).toBe(false);
    expect(r.added).toEqual(["It is the web client only.", "The modal keeps the loop alive."]);
    const items = readIntake(paths);
    expect(items[0]?.detail).toEqual(["seen on staging", "It is the web client only.", expect.stringMatching(/^The modal keeps the loop alive\. \(test, web, \d{4}-\d{2}-\d{2}\)$/)]);
    expect(items[1]?.detail).toEqual([]);
  });

  it("writes an intake line to hold detail for a slug that has none, and refuses empty detail", () => {
    const paths = repoPaths(repo.root);
    const person = currentPerson(repo.root);
    const r = addIntakeDetail(paths, { slug: "from-the-backlog", title: "An item the old backlog held", text: "Here is what I meant.", person, source: "web" });
    expect(r.createdLine).toBe(true);
    const item = readIntake(paths).find((i) => i.slug === "from-the-backlog");
    expect(item?.text).toBe("An item the old backlog held");
    expect(item?.detail[0]).toMatch(/^Here is what I meant\. \(test, web, /);
    expect(() => addIntakeDetail(paths, { slug: "from-the-backlog", text: "  \n ", person, source: "web" })).toThrow(/nothing to add/);
  });
});
