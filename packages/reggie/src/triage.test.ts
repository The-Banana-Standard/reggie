import { mkdirSync, readdirSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { makeTempRepo, type TempRepo } from "../test/helpers.js";
import { capture } from "./capture.js";
import { lintBrief, parseBrief } from "./brief.js";
import { onboard } from "./onboard.js";
import { briefFile, repoPaths } from "./paths.js";
import { currentPerson, loadConfig } from "./people.js";
import { listTasks, readIntake } from "./tasks.js";
import { scaffoldBrief } from "./triage.js";
import { readText, writeText } from "./util.js";

/** Every file under a directory with its hash, so "changed nothing" can be asserted literally. */
function fingerprint(dir: string): string[] {
  const out: string[] = [];
  const walk = (d: string, rel: string) => {
    for (const name of readdirSync(d).sort()) {
      const full = path.join(d, name);
      const here = rel ? `${rel}/${name}` : name;
      if (statSync(full).isDirectory()) walk(full, here);
      else out.push(`${here} ${createHash("sha256").update(readText(full) ?? "").digest("hex").slice(0, 16)}`);
    }
  };
  walk(dir, "");
  return out;
}

describe("triage", () => {
  let repo: TempRepo;
  beforeEach(() => {
    repo = makeTempRepo();
    repo.write("src/auth/login.ts", "export const a = 1;\n");
    repo.commitAll("add login");
    onboard(repo.root);
    repo.commitAll("onboard");
  });
  afterEach(() => repo.cleanup());

  function paths() {
    return repoPaths(repo.root);
  }
  function person() {
    return currentPerson(repo.root);
  }

  it("takes the intake line and its detail in the same call that writes the brief", () => {
    const p = paths();
    const slug = capture(p, { text: "Login retries are not capped", person: person(), source: "cli", detail: "seen on staging" }).slug;
    capture(p, { text: "Something else entirely", person: person(), source: "cli" });

    const r = scaffoldBrief(p, { slug, author: "test" });
    expect(r.created).toBe(true);
    expect(r.intakeRemoved).toBe(1);
    expect(readIntake(p).map((i) => i.slug)).toEqual(["something-else-entirely"]);
    const raw = readText(p.intake) ?? "";
    expect(raw).not.toContain(slug);
    expect(raw).not.toContain("seen on staging");
    // The words are not destroyed, only moved: the brief is where they live now.
    const brief = parseBrief(readText(r.file) ?? "");
    expect(brief.sections.get("Problem")).toContain("Login retries are not capped");
    expect(brief.sections.get("Problem")).toContain("seen on staging");
  });

  it("leaves the line in place when the write throws, so the two records are never both gone", () => {
    const p = paths();
    const slug = capture(p, { text: "Login retries are not capped", person: person(), source: "cli" }).slug;
    // A directory where the brief should go: the write fails and nothing after it runs.
    mkdirSync(briefFile(p, slug), { recursive: true });
    expect(() => scaffoldBrief(p, { slug, author: "test" })).toThrow();
    expect(readIntake(p).map((i) => i.slug)).toEqual([slug]);
  });

  it("removes no line when a brief is already there and force is not set", () => {
    const p = paths();
    const slug = capture(p, { text: "Login retries are not capped", person: person(), source: "cli" }).slug;
    scaffoldBrief(p, { slug, author: "test" });
    writeText(briefFile(p, slug), `${readText(briefFile(p, slug))}\nWritten by hand.\n`);
    const byHand = readText(briefFile(p, slug));
    capture(p, { slug, text: "Someone captured it a second time", person: person(), source: "cli" });
    const before = readText(p.intake);

    const again = scaffoldBrief(p, { slug, author: "test" });
    expect(again).toEqual({ slug, file: briefFile(p, slug), created: false, skipped: true, intakeRemoved: 0 });
    expect(readText(p.intake)).toBe(before);
    expect(readText(briefFile(p, slug))).toBe(byHand);
  });

  it("changes nothing at all when it runs a second time after the line is gone", () => {
    const p = paths();
    const slug = capture(p, { text: "Login retries are not capped", person: person(), source: "cli" }).slug;
    scaffoldBrief(p, { slug, author: "test" });
    const after = fingerprint(p.reggie);

    const second = scaffoldBrief(p, { slug, author: "test" });
    expect(second.skipped).toBe(true);
    expect(second.intakeRemoved).toBe(0);
    expect(fingerprint(p.reggie)).toEqual(after);
  });

  it("reads every line carrying the slug, because removal takes them all", () => {
    const p = paths();
    const slug = "cap-login-retries";
    // `capture` makes its own slugs unique, so a collision only arrives by hand — which the
    // intake header explicitly invites. Removal takes both lines either way, so both are read.
    writeText(
      p.intake,
      [
        "# Intake",
        "",
        `- ${slug}: Login retries are not capped (a, cli, 2026-09-15)`,
        "  > seen on staging",
        `- ${slug}: The retry modal keeps the loop alive (a, voice, 2026-09-15)`,
        "  > only on web",
        "",
      ].join("\n"),
    );
    expect(readIntake(p).filter((i) => i.slug === slug)).toHaveLength(2);

    const r = scaffoldBrief(p, { slug, author: "test" });
    expect(r.intakeRemoved).toBe(2);
    expect(readIntake(p).filter((i) => i.slug === slug)).toHaveLength(0);
    const problem = parseBrief(readText(r.file) ?? "").sections.get("Problem") ?? "";
    expect(problem).toContain("Login retries are not capped");
    expect(problem).toContain("seen on staging");
    expect(problem).toContain("The retry modal keeps the loop alive");
    expect(problem).toContain("only on web");
  });

  it("falls back to the brief's own title and Problem when force runs with no line left", () => {
    const p = paths();
    const slug = capture(p, { text: "Login retries are not capped", person: person(), source: "cli" }).slug;
    scaffoldBrief(p, { slug, author: "test" });
    expect(readIntake(p).map((i) => i.slug)).toEqual([]);
    const filled = (readText(briefFile(p, slug)) ?? "")
      .replace("title: Login retries are not capped", "title: Cap login retries on web")
      .replace("# Login retries are not capped", "# Cap login retries on web")
      .replace("Login retries are not capped", "Web clients retry login forever when the server is down, so nobody can tell an outage from a broken page.");
    writeText(briefFile(p, slug), filled);

    const forced = scaffoldBrief(p, { slug, author: "test", force: true });
    expect(forced.created).toBe(false);
    expect(forced.skipped).toBe(false);
    expect(forced.intakeRemoved).toBe(0);
    const rewritten = parseBrief(readText(forced.file) ?? "");
    expect(rewritten.meta.title).toBe("Cap login retries on web");
    expect(rewritten.problem).toBe("Web clients retry login forever when the server is down, so nobody can tell an outage from a broken page.");

    // An explicit title still wins over the brief's own.
    scaffoldBrief(p, { slug, author: "test", force: true, title: "Something the owner typed" });
    const retitled = parseBrief(readText(briefFile(p, slug)) ?? "");
    expect(retitled.meta.title).toBe("Something the owner typed");
    expect(retitled.problem).toBe("Web clients retry login forever when the server is down, so nobody can tell an outage from a broken page.");
  });

  it("keeps a slug on the board after its line is taken, because the brief's folder holds it", () => {
    const p = paths();
    const config = loadConfig(p);
    const slug = capture(p, { text: "Login retries are not capped", person: person(), source: "cli" }).slug;
    expect(listTasks(p, config).find((t) => t.slug === slug)?.state).toBe("ungroomed");

    scaffoldBrief(p, { slug, author: "test" });
    const t = listTasks(p, config).find((x) => x.slug === slug);
    expect(t).toBeDefined();
    expect(t?.intake).toBeNull();
    expect(t?.state).toBe("ungroomed");
    expect(t?.brief?.exists).toBe(true);
  });

  it("the --all filter skips an ungroomed task that already has a draft", () => {
    const p = paths();
    const config = loadConfig(p);
    const withDraft = capture(p, { text: "Already scaffolded once", person: person(), source: "cli" }).slug;
    const raw = capture(p, { text: "Still only a line", person: person(), source: "cli" }).slug;
    scaffoldBrief(p, { slug: withDraft, author: "test" });

    const ungroomed = listTasks(p, config).filter((t) => t.state === "ungroomed");
    expect(ungroomed.map((t) => t.slug).sort()).toEqual([withDraft, raw].sort());
    // The CLI's `--all` list is this filter; the drafts are named at the end instead.
    expect(ungroomed.filter((t) => !t.brief?.exists).map((t) => t.slug)).toEqual([raw]);
    expect(ungroomed.filter((t) => t.brief?.exists).map((t) => t.slug)).toEqual([withDraft]);
  });

  it("the scaffold it writes does not pass the brief contract, which is what keeps the card back", () => {
    const p = paths();
    const slug = capture(p, { text: "Login retries are not capped", person: person(), source: "cli" }).slug;
    const r = scaffoldBrief(p, { slug, author: "test" });
    expect(lintBrief(readText(r.file) ?? "").ok).toBe(false);
  });
});
