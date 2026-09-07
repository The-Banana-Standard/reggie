import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { fullPlan, makeTempRepo, type TempRepo } from "../test/helpers.js";
import { capture } from "./capture.js";
import { claimTask } from "./claim.js";
import { git } from "./git.js";
import { onboard } from "./onboard.js";
import { decidePacket, scaffoldPacket } from "./packet.js";
import { planFile, repoPaths } from "./paths.js";
import { currentPerson, loadConfig } from "./people.js";
import { getTask, listTasks, parseIntake } from "./tasks.js";
import { writeText } from "./util.js";

describe("task state from git", () => {
  let repo: TempRepo;
  beforeEach(() => {
    repo = makeTempRepo();
    repo.write("src/auth/login.ts", "export const a = 1;\n");
    repo.commitAll("add login");
    onboard(repo.root);
    repo.commitAll("onboard");
  });
  afterEach(() => repo.cleanup());

  it("parses intake lines with detail", () => {
    const items = parseIntake("# Intake\n\n- fix-login: Login loops forever (jacob, cli, 2026-09-06)\n  > seen on staging\n- other-thing: Something else (a, b, c)\n");
    expect(items).toHaveLength(2);
    expect(items[0]?.slug).toBe("fix-login");
    expect(items[0]?.detail).toEqual(["seen on staging"]);
  });

  it("walks a task through every state", () => {
    const paths = repoPaths(repo.root);
    const config = loadConfig(paths);
    const person = currentPerson(repo.root);

    const cap = capture(paths, { text: "Cap login retries on web", person, source: "test" });
    const slug = cap.slug;
    expect(getTask(paths, config, slug).state).toBe("ungroomed");

    writeText(planFile(paths, slug), fullPlan(slug));
    expect(getTask(paths, config, slug).state).toBe("groomed");
    expect(getTask(paths, config, slug).reason).toContain("solo mode");

    repo.commitAll("plan");
    const groomed = getTask(paths, config, slug);
    expect(groomed.state).toBe("groomed");
    expect(groomed.planOnDefault).toBe(true);

    const claim = claimTask(paths, config, slug, { person });
    expect(claim.branch).toBe(`task/${slug}`);
    repo.write("src/auth/login.ts", "export const a = 2;\n");
    repo.commitAll("implement");
    const inProcess = getTask(paths, config, slug);
    expect(inProcess.state).toBe("in-process");
    expect(inProcess.owner).toBe("Test Person");

    scaffoldPacket(paths, config, { slug, author: person.handle });
    repo.commitAll("packet");
    expect(getTask(paths, config, slug).state).toBe("awaiting-decision");

    decidePacket(paths, slug, "approved", person.handle, "looks good");
    repo.commitAll("decide");
    git(["switch", "main"], { cwd: repo.root });
    git(["merge", "-q", "--no-ff", "-m", "merge task", `task/${slug}`], { cwd: repo.root });
    git(["branch", "-D", `task/${slug}`], { cwd: repo.root });
    const done = getTask(paths, config, slug);
    expect(done.state).toBe("done");
    expect(listTasks(paths, config).find((t) => t.slug === slug)).toBeUndefined();
    expect(listTasks(paths, config, { includeDone: true }).find((t) => t.slug === slug)?.state).toBe("done");
  });

  it("refuses to take over another person's branch", () => {
    const paths = repoPaths(repo.root);
    const config = loadConfig(paths);
    git(["switch", "-c", "task/theirs"], { cwd: repo.root });
    git(["config", "user.email", "someone-else@example.com"], { cwd: repo.root });
    git(["config", "user.name", "Someone Else"], { cwd: repo.root });
    repo.write("x.txt", "x");
    repo.commitAll("their work");
    git(["switch", "main"], { cwd: repo.root });
    git(["config", "user.email", "test@example.com"], { cwd: repo.root });
    git(["config", "user.name", "Test Person"], { cwd: repo.root });
    const me = currentPerson(repo.root);
    expect(() => claimTask(paths, config, "theirs", { person: me })).toThrow(/Someone Else/);
    expect(path.basename(paths.tasks)).toBe("tasks");
  });
});
