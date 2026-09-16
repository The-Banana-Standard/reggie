import { rmSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { fullPlan, makeTempRepo, type TempRepo } from "../test/helpers.js";
import { capture, removeFromIntake } from "./capture.js";
import { claimTask } from "./claim.js";
import { git } from "./git.js";
import { onboard } from "./onboard.js";
import { decidePacket, scaffoldPacket } from "./packet.js";
import { briefFile, packetFile, planFile, repoPaths } from "./paths.js";
import { currentPerson, loadConfig } from "./people.js";
import {
  STATE_MACHINE,
  TASK_STATES,
  ageInDays,
  getTask,
  getTaskDetail,
  intakeDate,
  listTasks,
  parseIntake,
  parsePacketCriteria,
  parsePlanFileEntries,
  stateDefinition,
  taskPhase,
  type TaskDetail,
} from "./tasks.js";
import { scaffoldBrief } from "./triage.js";
import { readText, writeText } from "./util.js";

/** A brief that satisfies the brief contract, for the states that only need one to exist. */
function fullBrief(slug: string): string {
  return [
    "---",
    `slug: ${slug}`,
    "title: Cap login retries on web",
    "area: src/auth",
    "size: small",
    "risk: high",
    "priority: P1",
    "author: test",
    "created: 2026-09-08",
    "---",
    "# Cap login retries on web",
    "",
    "## Problem",
    "Web clients retry login forever when the server is down, so nobody can tell an outage from a broken page.",
    "",
    "## Why now",
    "The auth endpoint is near its rate limit and the next outage takes the login page with it.",
    "",
    "## Suspected area",
    "- src/auth/login.ts because the retry loop is written there",
    "- src/auth/ because the error surface is shared with signup",
    "",
    "## Open questions",
    "- Does the mobile client share this retry loop, which would widen the work to two platforms?",
    "",
    "## Not this",
    "- Server-side rate limiting, which is a separate task against the API gateway",
    "",
  ].join("\n");
}

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

    writeText(briefFile(paths, slug), fullBrief(slug));
    const groomed = getTask(paths, config, slug);
    expect(groomed.state).toBe("groomed");
    expect(groomed.phase).toBe("shape");

    writeText(planFile(paths, slug), fullPlan(slug));
    expect(getTask(paths, config, slug).state).toBe("planned");
    expect(getTask(paths, config, slug).reason).toContain("solo mode");

    repo.commitAll("brief and plan");
    const planned = getTask(paths, config, slug);
    expect(planned.state).toBe("planned");
    expect(planned.phase).toBe("plan");
    expect(planned.planOnDefault).toBe(true);

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

function must(detail: TaskDetail | null): TaskDetail {
  if (detail === null) throw new Error("expected a task detail");
  return detail;
}

describe("state machine and task detail", () => {
  let repo: TempRepo;
  beforeEach(() => {
    repo = makeTempRepo();
    repo.write("src/auth/login.ts", "export const a = 1;\n");
    repo.write("src/other.ts", "export const b = 1;\n");
    repo.commitAll("add code");
    onboard(repo.root);
    repo.commitAll("onboard");
  });
  afterEach(() => repo.cleanup());

  it("describes every state and transition in TASK_STATES order", () => {
    expect(STATE_MACHINE.states.map((s) => s.id)).toEqual(TASK_STATES);
    for (const s of STATE_MACHINE.states) {
      expect(s.label.length).toBeGreaterThan(0);
      expect(s.definition.length).toBeGreaterThan(0);
      expect(s.rule.length).toBeGreaterThan(0);
      expect(stateDefinition(s.id)).toBe(s.definition);
    }
    const ids = new Set<string>(TASK_STATES);
    for (const t of STATE_MACHINE.transitions) {
      expect(ids.has(t.from)).toBe(true);
      expect(ids.has(t.to)).toBe(true);
      expect(t.trigger.length).toBeGreaterThan(0);
      expect(t.who.length).toBeGreaterThan(0);
    }
    for (let i = 0; i < TASK_STATES.length - 1; i += 1) {
      const from = TASK_STATES[i];
      const to = TASK_STATES[i + 1];
      expect(STATE_MACHINE.transitions.some((t) => t.from === from && t.to === to)).toBe(true);
    }
    expect(STATE_MACHINE.transitions.some((t) => t.from === "awaiting-decision" && t.to === "in-process")).toBe(true);
    expect(STATE_MACHINE.transitions).toHaveLength(6);

    // The two arrows the four-phase model adds: triage writes the brief, planning writes the plan.
    const shape = STATE_MACHINE.transitions.find((t) => t.from === "ungroomed" && t.to === "groomed");
    expect(shape?.trigger).toContain("brief.md");
    const plan = STATE_MACHINE.transitions.find((t) => t.from === "groomed" && t.to === "planned");
    expect(plan?.trigger).toContain("plan contract");

    expect(TASK_STATES.map(taskPhase)).toEqual(["capture", "shape", "plan", "build", "review", "done"]);
    expect(JSON.stringify(STATE_MACHINE)).not.toContain("grooming");
  });

  it("computes ages from ISO dates and intake metadata", () => {
    const now = new Date("2026-09-07T12:00:00Z");
    expect(ageInDays(null, now)).toBeNull();
    expect(ageInDays(undefined, now)).toBeNull();
    expect(ageInDays("not a date", now)).toBeNull();
    expect(ageInDays("2026-09-07T01:00:00Z", now)).toBe(0);
    expect(ageInDays("2026-09-01T12:00:00+00:00", now)).toBe(6);
    expect(ageInDays("2026-08-31T13:00:00Z", now)).toBe(6);
    expect(ageInDays("2026-09-08", now)).toBe(0);
    const [item] = parseIntake("- fix-login: Login loops forever (jacob, cli, 2026-09-01)\n- bare: No metadata here\n");
    expect(intakeDate(item ?? null)).toBe("2026-09-01");
    expect(intakeDate(parseIntake("- bare: No metadata here\n")[0] ?? null)).toBeNull();
    expect(intakeDate(null)).toBeNull();
  });

  it("parses plan file operations and packet checklists", () => {
    const entries = parsePlanFileEntries([
      "- src/a.ts (MOD)",
      "- `src/b.ts` (new)",
      "- src/c.ts (DEL)",
      "- ./src/dir/",
      "- (list each file as path (NEW|MOD|DEL); Reggie computes blast radius from this list)",
      "not a bullet",
    ].join("\n"));
    expect(entries).toEqual([
      { path: "src/a.ts", op: "MOD" },
      { path: "src/b.ts", op: "NEW" },
      { path: "src/c.ts", op: "DEL" },
      { path: "src/dir/", op: null },
    ]);

    const criteria = parsePacketCriteria([
      "- [x] The first thing holds",
      "  evidence: (.reggie/tasks/demo/evidence/tests.txt)",
      "- [ ] The second thing holds",
      "  evidence: (path to the file that proves this)",
      "- The third thing was checked by hand",
      "  evidence: docs/notes.md, screenshots/one.png",
      "- [ ] (the plan had no criteria; state what was verified)",
    ].join("\n"));
    expect(criteria).toEqual([
      { text: "The first thing holds", pass: true, evidence: [".reggie/tasks/demo/evidence/tests.txt"] },
      { text: "The second thing holds", pass: false, evidence: [] },
      { text: "The third thing was checked by hand", pass: null, evidence: ["docs/notes.md", "screenshots/one.png"] },
    ]);
  });

  it("returns null for an unknown slug and throws on an unsafe one", () => {
    const paths = repoPaths(repo.root);
    const config = loadConfig(paths);
    expect(getTaskDetail(paths, config, "never-heard-of-it")).toBeNull();
    expect(() => getTaskDetail(paths, config, "../etc")).toThrow(/slug/);
    expect(() => getTaskDetail(paths, config, "Bad Slug")).toThrow(/slug/);
  });

  it("assembles plan, packet, claim, journal, and impact as a task moves", () => {
    const paths = repoPaths(repo.root);
    const config = loadConfig(paths);
    const person = currentPerson(repo.root);

    // Ungroomed: only the intake line exists, so nothing has been shaped yet.
    const slug = capture(paths, { text: "Cap login retries on web", person, source: "test" }).slug;
    let detail = must(getTaskDetail(paths, config, slug));
    expect(detail.task.state).toBe("ungroomed");
    expect(detail.task.phase).toBe("capture");
    expect(detail.task.reason).toContain("no brief");
    expect(detail.task.stateDefinition).toBe(stateDefinition("ungroomed"));
    expect(detail.task.age).toBe(0);
    expect(detail.task.planFiles).toEqual([]);
    expect(detail.task.changedFiles).toEqual([]);
    expect(detail.plan).toBeNull();
    expect(detail.packet).toBeNull();
    expect(detail.claim).toBeNull();
    expect(detail.journal).toEqual([]);
    expect(detail.impact).toEqual({ planned: [], actual: [], plannedButUntouched: [], touchedButUnplanned: [], downstream: [], collisions: [], riskRules: [] });
    expect(detail.contextRoute).toBe(`/api/context?slug=${slug}`);

    // Planned: a plan naming an existing file, a new file, and a folder.
    const plan = fullPlan(slug, ["src/auth/login.ts", "src/auth/new-file.ts", "src/auth/"])
      .replace("- src/auth/new-file.ts (MOD)", "- `src/auth/new-file.ts` (NEW)")
      .replace("- src/auth/ (MOD)", "- src/auth/");
    writeText(planFile(paths, slug), plan);
    repo.commitAll("plan");
    detail = must(getTaskDetail(paths, config, slug));
    expect(detail.task.state).toBe("planned");
    expect(detail.task.phase).toBe("plan");
    expect(detail.task.brief).toBeNull();
    expect(detail.brief).toBeNull();
    expect(detail.task.age).toBe(0);
    expect(detail.task.planFiles).toEqual(["src/auth/login.ts", "src/auth/new-file.ts", "src/auth/"]);
    expect(detail.plan?.meta.title).toBe("Cap login retries on web");
    expect(detail.plan?.meta.risk).toBe("low");
    expect(detail.plan?.sections["Problem"]).toContain("retry login forever");
    expect(Object.keys(detail.plan?.sections ?? {})).toContain("Bail conditions");
    expect(detail.plan?.criteria).toHaveLength(2);
    expect(detail.plan?.files).toEqual([
      { path: "src/auth/login.ts", op: "MOD", exists: true, nodeId: "src/auth/login.ts" },
      { path: "src/auth/new-file.ts", op: "NEW", exists: false, nodeId: "src/auth/new-file.ts" },
      { path: "src/auth/", op: null, exists: true, nodeId: "dir:src/auth/" },
    ]);
    expect(detail.impact.planned).toEqual(["src/auth/login.ts", "src/auth/new-file.ts", "src/auth/"]);
    expect(detail.impact.plannedButUntouched).toEqual(["src/auth/login.ts", "src/auth/new-file.ts", "src/auth/"]);
    expect(detail.impact.riskRules).toContainEqual({ level: "high", pattern: "login", file: "src/auth/login.ts" });
    expect(detail.impact.riskRules).toContainEqual({ level: "high", pattern: "auth", file: "src/auth/" });
    expect(detail.impact.riskRules.every((r) => r.level === "high")).toBe(true);
    expect(detail.impact.collisions).toEqual([]);

    // In process: a claim plus commits touching a planned file and an unplanned one.
    claimTask(paths, config, slug, { person });
    repo.write("src/auth/login.ts", "export const a = 2;\n");
    repo.write("src/other.ts", "export const b = 2;\n");
    repo.commitAll("implement");
    detail = must(getTaskDetail(paths, config, slug));
    expect(detail.task.state).toBe("in-process");
    expect(detail.task.age).toBe(0);
    expect(detail.claim?.person).toBe("Test Person");
    expect(detail.claim?.email).toBe("test@example.com");
    expect(detail.claim?.date).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(detail.task.changedFiles).toEqual(["src/auth/login.ts", "src/other.ts"]);
    expect(detail.impact.actual).toEqual(["src/auth/login.ts", "src/other.ts"]);
    expect(detail.impact.plannedButUntouched).toEqual(["src/auth/new-file.ts"]);
    expect(detail.impact.touchedButUnplanned).toEqual(["src/other.ts"]);
    expect(detail.impact.downstream).toEqual([]);
    expect(detail.journal.length).toBeGreaterThan(0);
    expect(detail.journal.every((e) => e.slug === slug)).toBe(true);
    expect(detail.journal.some((e) => e.stage === "claim")).toBe(true);
    const listed = listTasks(paths, config).find((t) => t.slug === slug);
    expect(listed?.stateDefinition).toBe(stateDefinition("in-process"));
    expect(listed?.planFiles).toEqual(detail.task.planFiles);
    expect(listed?.changedFiles).toEqual(["src/auth/login.ts", "src/other.ts"]);

    // Another active task planning the same file is a collision.
    writeText(planFile(paths, "other-login-work"), fullPlan("other-login-work", ["src/auth/login.ts"]));
    detail = must(getTaskDetail(paths, config, slug));
    expect(detail.impact.collisions).toContainEqual({ file: "src/auth/login.ts", slug: "other-login-work", owner: "test" });
    expect(detail.impact.collisions).toContainEqual({ file: "src/auth/", slug: "other-login-work", owner: "test" });
    expect(must(getTaskDetail(paths, config, "other-login-work")).impact.collisions).toEqual([{ file: "src/auth/login.ts", slug, owner: "Test Person" }]);

    // Awaiting decision: evidence on disk, a packet with the first criterion ticked, committed on the branch.
    writeText(path.join(repo.root, ".reggie", "tasks", slug, "evidence", "tests.txt"), "2 passed\n");
    scaffoldPacket(paths, config, { slug, author: person.handle });
    const packetPath = packetFile(paths, slug);
    writeText(packetPath, (readText(packetPath) ?? "").replace("- [ ] After three failed attempts", "- [x] After three failed attempts"));
    repo.commitAll("packet");
    detail = must(getTaskDetail(paths, config, slug));
    expect(detail.task.state).toBe("awaiting-decision");
    expect(detail.task.packetExists).toBe(true);
    expect(detail.packet?.verdict).toBe("pending");
    expect(detail.packet?.decidedBy).toBeNull();
    expect(detail.packet?.decidedAt).toBeNull();
    expect(detail.packet?.criteria.map((c) => c.pass)).toEqual([true, false]);
    expect(detail.packet?.criteria[0]?.text).toBe("After three failed attempts the client stops retrying and shows the offline message");
    expect(detail.packet?.criteria[0]?.evidence).toEqual([`.reggie/tasks/${slug}/evidence/tests.txt`]);
    expect(detail.packet?.criteria[1]?.evidence).toEqual([]);
    expect(detail.packet?.evidence).toEqual([`.reggie/tasks/${slug}/evidence/tests.txt`]);
    expect(Object.keys(detail.packet?.sections ?? {})).toEqual(expect.arrayContaining(["Acceptance criteria", "Evidence", "Changes", "Deviations from plan", "Open risks"]));
    expect(detail.impact.actual).toEqual(["src/auth/login.ts", "src/other.ts"]);

    // Needs work sends it back to in process; the packet keeps the verdict.
    decidePacket(paths, slug, "needs-work", person.handle, "the offline message is missing");
    repo.commitAll("needs work");
    detail = must(getTaskDetail(paths, config, slug));
    expect(detail.task.state).toBe("in-process");
    expect(detail.task.reason).toContain("needs-work");
    expect(detail.packet?.verdict).toBe("needs-work");
    expect(detail.packet?.decidedBy).toBe(person.handle);
    expect(detail.packet?.decidedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(detail.packet?.sections["Decision"]).toContain("needs-work by");

    // Approval on the branch alone keeps it waiting; merging to main makes it done.
    decidePacket(paths, slug, "approved", person.handle, "fixed");
    repo.commitAll("approve");
    expect(getTask(paths, config, slug).state).toBe("awaiting-decision");
    git(["switch", "main"], { cwd: repo.root });
    git(["merge", "-q", "--no-ff", "-m", "merge task", `task/${slug}`], { cwd: repo.root });
    git(["branch", "-D", `task/${slug}`], { cwd: repo.root });
    detail = must(getTaskDetail(paths, config, slug));
    expect(detail.task.state).toBe("done");
    expect(detail.task.stateDefinition).toBe(stateDefinition("done"));
    expect(detail.packet?.verdict).toBe("approved");
    expect(detail.claim).toBeNull();
    expect(detail.impact.actual).toEqual([]);
    expect(detail.impact.plannedButUntouched).toEqual(detail.impact.planned);
    expect(detail.plan?.files[1]).toEqual({ path: "src/auth/new-file.ts", op: "NEW", exists: false, nodeId: "src/auth/new-file.ts" });
  });

  it("reads a plan that only exists on the task branch and reports files that exist there", () => {
    const paths = repoPaths(repo.root);
    const config = loadConfig(paths);
    const person = currentPerson(repo.root);
    git(["switch", "-c", "task/branch-only", "main"], { cwd: repo.root });
    writeText(planFile(paths, "branch-only"), fullPlan("branch-only", ["src/auth/login.ts", "src/auth/fresh.ts"]).replace("- src/auth/fresh.ts (MOD)", "- src/auth/fresh.ts (NEW)"));
    repo.write("src/auth/fresh.ts", "export const fresh = true;\n");
    repo.commitAll("plan and file on the branch only");
    git(["switch", "main"], { cwd: repo.root });
    expect(person.handle.length).toBeGreaterThan(0);

    const detail = must(getTaskDetail(paths, config, "branch-only"));
    expect(detail.task.state).toBe("in-process");
    expect(detail.task.title).toBe("Cap login retries on web");
    expect(detail.task.planExists).toBe(false);
    expect(detail.task.planLintOk).toBe(true);
    expect(detail.plan?.files).toEqual([
      { path: "src/auth/login.ts", op: "MOD", exists: true, nodeId: "src/auth/login.ts" },
      { path: "src/auth/fresh.ts", op: "NEW", exists: true, nodeId: "src/auth/fresh.ts" },
    ]);
    expect(detail.impact.actual).toEqual(["src/auth/fresh.ts"]);
    expect(detail.impact.plannedButUntouched).toEqual(["src/auth/login.ts"]);
  });
});

describe("briefs shape a task before a plan does", () => {
  let repo: TempRepo;
  beforeEach(() => {
    repo = makeTempRepo();
    repo.write("src/auth/login.ts", "export const a = 1;\n");
    repo.commitAll("add login");
    onboard(repo.root);
    repo.commitAll("onboard");
  });
  afterEach(() => repo.cleanup());

  function captured(): { paths: ReturnType<typeof repoPaths>; config: ReturnType<typeof loadConfig>; slug: string } {
    const paths = repoPaths(repo.root);
    const config = loadConfig(paths);
    const person = currentPerson(repo.root);
    const slug = capture(paths, { text: "Cap login retries on web", person, source: "test" }).slug;
    return { paths, config, slug };
  }

  it("a brief alone makes an ungroomed item groomed", () => {
    const { paths, config, slug } = captured();
    const raw = getTask(paths, config, slug);
    expect(raw.state).toBe("ungroomed");
    expect(raw.phase).toBe("capture");
    expect(raw.brief).toBeNull();
    expect(raw.reason).toBe("intake item with no brief");

    writeText(briefFile(paths, slug), fullBrief(slug));
    const groomed = getTask(paths, config, slug);
    expect(groomed.state).toBe("groomed");
    expect(groomed.phase).toBe("shape");
    expect(groomed.stateDefinition).toBe(stateDefinition("groomed"));
    expect(groomed.reason).toBe("brief on disk; no plan yet");
    expect(groomed.brief).toEqual({
      exists: true,
      area: "src/auth",
      size: "small",
      priority: "P1",
      problem: "Web clients retry login forever when the server is down, so nobody can tell an outage from a broken page.",
    });
    // The brief carries the risk and the title until a plan settles them.
    expect(groomed.risk).toBe("high");
    expect(groomed.title).toBe("Cap login retries on web");
    expect(groomed.planExists).toBe(false);
    expect(groomed.planLintOk).toBeNull();
  });

  it("the scaffold triage writes leaves the task ungroomed, with a reason naming the draft", () => {
    const { paths, config, slug } = captured();
    scaffoldBrief(paths, { slug, author: "test" });
    const t = getTask(paths, config, slug);
    expect(t.state).toBe("ungroomed");
    expect(t.phase).toBe("capture");
    expect(t.reason).toBe("brief on disk is still triage's scaffold: placeholder text in Why now, Suspected area, Open questions, Not this");
    // The brief is really there; it is its emptiness that keeps the card where it is.
    expect(t.brief?.exists).toBe(true);
  });

  it("a brief written out but missing size and priority is groomed, with today's reason", () => {
    const { paths, config, slug } = captured();
    writeText(briefFile(paths, slug), fullBrief(slug).replace("size: small", "size: unset").replace("priority: P1", "priority: unset"));
    const t = getTask(paths, config, slug);
    expect(t.state).toBe("groomed");
    expect(t.reason).toBe("brief on disk; no plan yet");
  });

  it("a brief written out but with an empty Problem is ungroomed, naming the empty Problem", () => {
    const { paths, config, slug } = captured();
    writeText(
      briefFile(paths, slug),
      fullBrief(slug).replace("Web clients retry login forever when the server is down, so nobody can tell an outage from a broken page.", ""),
    );
    const t = getTask(paths, config, slug);
    expect(t.state).toBe("ungroomed");
    expect(t.reason).toBe("brief on disk is still triage's scaffold: the Problem section is empty");
  });

  it("dates a card with a brief and no branch from the brief's created, once the line is gone", () => {
    const { paths, config, slug } = captured();
    writeText(briefFile(paths, slug), fullBrief(slug));
    expect(removeFromIntake(paths, slug)).toBe(true);
    const t = getTask(paths, config, slug);
    expect(t.intake).toBeNull();
    expect(t.lastActivity).toBeNull();
    // fullBrief carries created: 2026-09-08, so the age is the whole days since that UTC midnight.
    expect(t.age).toBe(ageInDays("2026-09-08"));
    expect(t.age).not.toBeNull();
  });

  it("a brief committed to the default branch counts even when it is gone from disk", () => {
    const { paths, config, slug } = captured();
    writeText(briefFile(paths, slug), fullBrief(slug));
    repo.commitAll("brief");
    rmSync(briefFile(paths, slug));
    const groomed = getTask(paths, config, slug);
    expect(groomed.state).toBe("groomed");
    expect(groomed.reason).toBe("brief on main; no plan yet");
    expect(groomed.brief?.exists).toBe(true);
    expect(groomed.brief?.size).toBe("small");
  });

  it("a plan draft that fails the contract leaves a briefed task groomed, naming the draft", () => {
    const { paths, config, slug } = captured();
    writeText(briefFile(paths, slug), fullBrief(slug));
    writeText(planFile(paths, slug), fullPlan(slug).replace("risk: low", "risk: unset"));
    const t = getTask(paths, config, slug);
    expect(t.state).toBe("groomed");
    expect(t.phase).toBe("shape");
    expect(t.reason).toBe("plan draft on disk does not pass the contract yet; a plan is in progress");
    expect(t.planLintOk).toBe(false);
    expect(t.brief?.exists).toBe(true);
  });

  it("a plan/<slug> branch reads as groomed with a plan in progress", () => {
    const { paths, config, slug } = captured();
    writeText(briefFile(paths, slug), fullBrief(slug));
    repo.commitAll("brief");
    git(["switch", "-q", "-c", `plan/${slug}`], { cwd: repo.root });
    writeText(planFile(paths, slug), fullPlan(slug));
    repo.commitAll("draft the plan");
    git(["switch", "-q", "main"], { cwd: repo.root });

    const t = getTask(paths, config, slug);
    expect(t.state).toBe("groomed");
    expect(t.reason).toBe(`plan/${slug} exists; a plan is in progress`);
    expect(t.branch).toBe(`plan/${slug}`);
  });

  it("a plan that passes the contract makes it planned", () => {
    const { paths, config, slug } = captured();
    writeText(briefFile(paths, slug), fullBrief(slug));
    writeText(planFile(paths, slug), fullPlan(slug));
    const onDisk = getTask(paths, config, slug);
    expect(onDisk.state).toBe("planned");
    expect(onDisk.phase).toBe("plan");
    expect(onDisk.reason).toBe("plan on disk passes the contract; solo mode counts it as planned until committed");

    repo.commitAll("brief and plan");
    const merged = getTask(paths, config, slug);
    expect(merged.state).toBe("planned");
    expect(merged.reason).toBe("plan on main passes the contract");
    expect(merged.planOnDefault).toBe(true);
    expect(merged.brief?.exists).toBe(true);
    // The plan settles the risk, so its value wins over the brief's guess.
    expect(merged.risk).toBe("low");
  });

  it("a plan with no brief is still planned; a brief is not required retroactively", () => {
    const { paths, config, slug } = captured();
    writeText(planFile(paths, slug), fullPlan(slug));
    const onDisk = getTask(paths, config, slug);
    expect(onDisk.state).toBe("planned");
    expect(onDisk.brief).toBeNull();

    repo.commitAll("plan only");
    const merged = getTask(paths, config, slug);
    expect(merged.state).toBe("planned");
    expect(merged.phase).toBe("plan");
    expect(merged.brief).toBeNull();
    expect(merged.reason).toBe("plan on main passes the contract");
  });

  it("getTaskDetail parses the brief beside the plan", () => {
    const { paths, config, slug } = captured();
    writeText(briefFile(paths, slug), fullBrief(slug));
    writeText(planFile(paths, slug), fullPlan(slug));
    repo.commitAll("brief and plan");

    const detail = must(getTaskDetail(paths, config, slug));
    expect(detail.task.state).toBe("planned");
    expect(detail.brief?.meta.size).toBe("small");
    expect(detail.brief?.meta.priority).toBe("P1");
    expect(detail.brief?.meta.area).toBe("src/auth");
    expect(detail.brief?.sections["Why now"]).toContain("near its rate limit");
    expect(Object.keys(detail.brief?.sections ?? {})).toEqual(["Problem", "Why now", "Suspected area", "Open questions", "Not this"]);
    expect(detail.brief?.areas).toHaveLength(2);
    expect(detail.brief?.questions).toHaveLength(1);
    expect(detail.plan?.meta.risk).toBe("low");
  });

  it("sorts the board with the most advanced work first and done last", () => {
    const paths = repoPaths(repo.root);
    const config = loadConfig(paths);
    const person = currentPerson(repo.root);
    const shaped = capture(paths, { text: "Shape only this one", person, source: "test" }).slug;
    const raw = capture(paths, { text: "Nothing has touched this", person, source: "test" }).slug;
    const ready = capture(paths, { text: "Ready to build now", person, source: "test" }).slug;
    writeText(briefFile(paths, shaped), fullBrief(shaped));
    writeText(planFile(paths, ready), fullPlan(ready));

    const states = listTasks(paths, config).map((t) => [t.slug, t.state]);
    expect(states).toEqual([
      [ready, "planned"],
      [shaped, "groomed"],
      [raw, "ungroomed"],
    ]);
  });
});
