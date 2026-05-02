import { describe, it, expect } from "vitest";
import { parseTasksMd } from "../task";

describe("parseTasksMd", () => {
  it("returns empty result for empty string", () => {
    const result = parseTasksMd("");
    expect(result.groomed).toEqual([]);
    expect(result.ungroomed).toEqual([]);
    expect(result.laterFeatures).toEqual([]);
    expect(result.active).toEqual([]);
  });

  it("returns empty result for whitespace-only content", () => {
    const result = parseTasksMd("   \n\n  ");
    expect(result.groomed).toEqual([]);
    expect(result.ungroomed).toEqual([]);
    expect(result.laterFeatures).toEqual([]);
    expect(result.active).toEqual([]);
  });

  it("parses a planned task into groomed with section grouping", () => {
    const md = `## Backlog

### Core Features

- [ ] auth-flow: Implement authentication [P1] [complex] [code] [planned]`;

    const result = parseTasksMd(md);
    expect(result.groomed).toHaveLength(1);
    expect(result.groomed[0].title).toBe("Core Features");

    const task = result.groomed[0].tasks[0];
    expect(task.slug).toBe("auth-flow");
    expect(task.description).toBe("Implement authentication");
    expect(task.priority).toBe("P1");
    expect(task.complexity).toBe("complex");
    expect(task.pipeline).toBe("code");
    expect(task.planned).toBe(true);
    expect(task.checked).toBe(false);
  });

  it("parses all 5 pipeline mode tags", () => {
    const md = `## Backlog

### Modes

- [ ] code-task: Code task [P1] [code] [planned]
- [ ] design-task: Design task [P1] [design] [planned]
- [ ] manual-task: Manual task [P1] [manual] [planned]
- [ ] sys-task: System task [P1] [reggie-system] [planned]
- [ ] debug-task: Debug task [P1] [debug] [planned]`;

    const result = parseTasksMd(md);
    const tasks = result.groomed[0].tasks;
    expect(tasks.map((t) => t.pipeline)).toEqual([
      "code",
      "design",
      "manual",
      "reggie-system",
      "debug",
    ]);
  });

  it("parses unplanned structured tasks into ungroomed", () => {
    const md = `## Backlog

### UI Work

- [ ] sidebar: Build sidebar component [P2] [simple] [code]
- [ ] theme: Add dark theme support [P3] [moderate] [design]`;

    const result = parseTasksMd(md);
    expect(result.groomed).toHaveLength(0);
    expect(result.ungroomed).toHaveLength(2);
    expect(result.ungroomed[0].slug).toBe("sidebar");
    expect(result.ungroomed[1].slug).toBe("theme");
  });

  it("splits planned and unplanned tasks within the same section", () => {
    const md = `## Backlog

### Features

- [ ] planned-one: A planned task [P1] [planned]
- [ ] unplanned-one: Not planned [P2]
- [ ] planned-two: Another planned task [P1] [planned]`;

    const result = parseTasksMd(md);
    expect(result.groomed).toHaveLength(1);
    expect(result.groomed[0].title).toBe("Features");
    expect(result.groomed[0].tasks).toHaveLength(2);
    expect(result.groomed[0].tasks[0].slug).toBe("planned-one");
    expect(result.groomed[0].tasks[1].slug).toBe("planned-two");
    expect(result.ungroomed).toHaveLength(1);
    expect(result.ungroomed[0].slug).toBe("unplanned-one");
  });

  it("parses active tasks section and filters checked rows (defense-in-depth)", () => {
    // Post-migration, `[x]` rows should never appear in TASKS.md, but if one
    // slips through (stale or hand-edited), the parser must drop it from
    // every output bucket so it doesn't render as pending work in the UI.
    const md = `## Active Tasks

- [x] login-fix: Fix login page redirect [P1] [simple] [code]
- [ ] dashboard: Build main dashboard [P2] [moderate] [code]`;

    const result = parseTasksMd(md);
    expect(result.active).toHaveLength(1);
    expect(result.active[0].slug).toBe("dashboard");
    expect(result.active[0].checked).toBe(false);
  });

  it("filters orphan [x] rows from groomed sections", () => {
    // Regression for the orphan-in-backlog case: a `[x]` line under a
    // groomed `### Section` must not appear in `result.groomed`.
    const md = `## Backlog

### Pipeline System Expansion
- [x] orphan-done: Stale completed row [P2] [planned]
- [ ] still-open: Open work [P1] [planned]`;

    const result = parseTasksMd(md);
    expect(result.groomed).toHaveLength(1);
    expect(result.groomed[0].tasks).toHaveLength(1);
    expect(result.groomed[0].tasks[0].slug).toBe("still-open");
  });

  it("filters checked rows from later-features and ungroomed buckets", () => {
    const md = `## Backlog

### Later Features
- [x] done-feature: Already shipped [P2] [planned]
- [ ] open-feature: Still planned [P2] [planned]

### Other
- [x] done-loose: Stale loose row
- [ ] open-loose: Open loose row`;

    const result = parseTasksMd(md);
    expect(result.laterFeatures.map((t) => t.slug)).toEqual(["open-feature"]);
    expect(result.ungroomed.map((t) => t.slug)).toEqual(["open-loose"]);
  });

  it("preserves files: continuation under a checked row's successor", () => {
    // Even though the `[x]` row itself is dropped, `lastTask` must still be
    // updated so a `files:` line that follows the NEXT (unchecked) task
    // attaches to that task — not to nothing.
    const md = `## Backlog

### Features
- [x] dropped: Stale [P1] [planned]
  files: src/old.ts (MOD)
- [ ] kept: Open [P1] [planned]
  files: src/new.ts (MOD)`;

    const result = parseTasksMd(md);
    expect(result.groomed[0].tasks).toHaveLength(1);
    expect(result.groomed[0].tasks[0].slug).toBe("kept");
    expect(result.groomed[0].tasks[0].filesLine).toBe("src/new.ts (MOD)");
  });

  it("parses task with dependencies and conflicts", () => {
    const md = `## Backlog

### Features

- [ ] deploy: Setup deployment pipeline [P2] [moderate] [code] [planned] [depends: api-layer, auth-flow] [conflicts: legacy-deploy]`;

    const result = parseTasksMd(md);
    const task = result.groomed[0].tasks[0];
    expect(task.depends).toEqual(["api-layer", "auth-flow"]);
    expect(task.conflicts).toEqual(["legacy-deploy"]);
  });

  it("parses task with files line", () => {
    const md = `## Backlog

### Features

- [ ] auth-flow: Implement authentication [P1] [complex] [code] [planned]
  files: src/auth.ts, src/middleware.ts`;

    const result = parseTasksMd(md);
    const task = result.groomed[0].tasks[0];
    expect(task.filesLine).toBe("src/auth.ts, src/middleware.ts");
  });

  it("resets files context after an empty line", () => {
    const md = `## Backlog

### Features

- [ ] first-task: First task [P1] [planned]
  files: src/first.ts

- [ ] second-task: Second task [P2] [planned]
  files: src/second.ts`;

    const result = parseTasksMd(md);
    const tasks = result.groomed[0].tasks;
    expect(tasks[0].filesLine).toBe("src/first.ts");
    expect(tasks[1].filesLine).toBe("src/second.ts");
  });

  it("recognizes uppercase [X] as checked and filters it out (defense-in-depth)", () => {
    // The line-level parser must accept `[X]` as a valid checked marker so the
    // defensive filter sees `task.checked = true` and drops it. If `[X]` parsed
    // as unchecked, the filter would miss it and an orphan would render.
    const md = `## Backlog

### Done

- [X] completed: This was done [P1] [planned]
- [ ] still-open: Open work [P1] [planned]`;

    const result = parseTasksMd(md);
    expect(result.groomed).toHaveLength(1);
    expect(result.groomed[0].tasks).toHaveLength(1);
    expect(result.groomed[0].tasks[0].slug).toBe("still-open");
  });

  it("returns null defaults for unplanned tasks without tags", () => {
    const md = `## Backlog

### Misc

- [ ] bare-task: A task with no metadata`;

    const result = parseTasksMd(md);
    const task = result.ungroomed[0];
    expect(task.slug).toBe("bare-task");
    expect(task.description).toBe("A task with no metadata");
    expect(task.priority).toBeNull();
    expect(task.complexity).toBeNull();
    expect(task.pipeline).toBeNull();
    expect(task.planned).toBe(false);
    expect(task.depends).toEqual([]);
    expect(task.conflicts).toEqual([]);
    expect(task.filesLine).toBeNull();
  });

  it("skips non-list lines but captures bare-dash and structured lines", () => {
    const md = `## Backlog

### Features

- [ ] valid-task: This is valid [P1]
This is not a task line
- [] missing-space: wrong format
- [ ] valid-two: Also valid [P2]`;

    const result = parseTasksMd(md);
    // valid-task and valid-two are structured tasks (unplanned -> ungroomed)
    // "[] missing-space: wrong format" is captured as a bare-dash item
    // "This is not a task line" is skipped (not a list item)
    expect(result.ungroomed).toHaveLength(3);
    expect(result.ungroomed[0].slug).toBe("valid-task");
    expect(result.ungroomed[1].slug).toBe("missing-space-wrong-format");
    expect(result.ungroomed[2].slug).toBe("valid-two");
  });

  it("parses mixed active and backlog sections", () => {
    const md = `## Active Tasks

- [ ] in-progress: Currently working on this [P1] [code]

## Backlog

### Next Up

- [ ] next-feature: Plan this next [P2] [design] [planned]`;

    const result = parseTasksMd(md);
    expect(result.active).toHaveLength(1);
    expect(result.active[0].slug).toBe("in-progress");
    expect(result.groomed).toHaveLength(1);
    expect(result.groomed[0].tasks[0].slug).toBe("next-feature");
  });

  it("puts tasks without ### heading into ungroomed (not Uncategorized section)", () => {
    const md = `## Backlog

- [ ] orphan-task: No section heading above [P1]`;

    const result = parseTasksMd(md);
    expect(result.ungroomed).toHaveLength(1);
    expect(result.ungroomed[0].slug).toBe("orphan-task");
  });

  it("stops parsing when a non-backlog non-active ## heading is encountered", () => {
    const md = `## Backlog

### Features

- [ ] task-a: A task [P1] [planned]

## Notes

- [ ] task-b: Should not be parsed`;

    const result = parseTasksMd(md);
    expect(result.groomed[0].tasks).toHaveLength(1);
    expect(result.active).toHaveLength(0);
  });

  it("handles heading with 'active' substring like 'Active Work'", () => {
    const md = `## Active Work

- [ ] wip-task: In progress [P1]`;

    const result = parseTasksMd(md);
    expect(result.active).toHaveLength(1);
    expect(result.active[0].slug).toBe("wip-task");
  });

  it("extracts description up to first bracket", () => {
    const md = `## Backlog

### Test

- [ ] slug: Description before tags [P2] [simple]`;

    const result = parseTasksMd(md);
    expect(result.ungroomed[0].description).toBe("Description before tags");
  });

  it("handles files line not attaching after empty line gap", () => {
    const md = `## Backlog

### Features

- [ ] task-one: First task [P1] [planned]

  files: src/orphan.ts`;

    const result = parseTasksMd(md);
    // Empty line resets lastTask, so files: should not attach
    expect(result.groomed[0].tasks[0].filesLine).toBeNull();
  });

  // New tests for bare-dash parsing

  it("parses bare-dash items as ungroomed tasks", () => {
    const md = `## Backlog

### Ideas

- Add user notifications
- Fix the broken login flow`;

    const result = parseTasksMd(md);
    expect(result.ungroomed).toHaveLength(2);
    expect(result.ungroomed[0].description).toBe("Add user notifications");
    expect(result.ungroomed[0].slug).toBe("add-user-notifications");
    expect(result.ungroomed[0].priority).toBeNull();
    expect(result.ungroomed[0].planned).toBe(false);
    expect(result.ungroomed[1].description).toBe("Fix the broken login flow");
    expect(result.ungroomed[1].slug).toBe("fix-the-broken-login-flow");
  });

  it("parses bare-dash items without ### heading as ungroomed", () => {
    const md = `## Backlog

- Some quick idea
- Another thought`;

    const result = parseTasksMd(md);
    expect(result.ungroomed).toHaveLength(2);
    expect(result.ungroomed[0].description).toBe("Some quick idea");
  });

  it("mixes structured and bare-dash items correctly", () => {
    const md = `## Backlog

### Features

- [ ] auth-flow: Implement authentication [P1] [planned]
- Add dark mode toggle
- [ ] sidebar: Build sidebar [P2]`;

    const result = parseTasksMd(md);
    expect(result.groomed).toHaveLength(1);
    expect(result.groomed[0].tasks).toHaveLength(1);
    expect(result.groomed[0].tasks[0].slug).toBe("auth-flow");
    expect(result.ungroomed).toHaveLength(2);
    expect(result.ungroomed[0].description).toBe("Add dark mode toggle");
    expect(result.ungroomed[1].slug).toBe("sidebar");
  });

  // New tests for Later Features

  it("parses items under ### Later Features into laterFeatures", () => {
    const md = `## Backlog

### Later Features

- [ ] v2-api: Build V2 API [P3] [complex] [code]
- Mobile app support`;

    const result = parseTasksMd(md);
    expect(result.laterFeatures).toHaveLength(2);
    expect(result.laterFeatures[0].slug).toBe("v2-api");
    expect(result.laterFeatures[0].description).toBe("Build V2 API");
    expect(result.laterFeatures[1].description).toBe("Mobile app support");
    expect(result.laterFeatures[1].slug).toBe("mobile-app-support");
    expect(result.groomed).toHaveLength(0);
    expect(result.ungroomed).toHaveLength(0);
  });

  it("handles Later Features heading case-insensitively", () => {
    const md = `## Backlog

### later features

- Future idea`;

    const result = parseTasksMd(md);
    expect(result.laterFeatures).toHaveLength(1);
    expect(result.laterFeatures[0].description).toBe("Future idea");
  });

  it("parses a full TASKS.md with all three sections", () => {
    const md = `## Active Tasks

- [ ] current-work: Doing this now [P1]

## Backlog

### Core

- [ ] feature-a: First feature [P1] [planned]
- [ ] feature-b: Second feature [P2]
- Some raw idea

### Later Features

- [ ] future-thing: Far out feature [P3]
- Another future thought`;

    const result = parseTasksMd(md);
    expect(result.active).toHaveLength(1);
    expect(result.groomed).toHaveLength(1);
    expect(result.groomed[0].title).toBe("Core");
    expect(result.groomed[0].tasks).toHaveLength(1);
    expect(result.groomed[0].tasks[0].slug).toBe("feature-a");
    expect(result.ungroomed).toHaveLength(2);
    expect(result.ungroomed[0].slug).toBe("feature-b");
    expect(result.ungroomed[1].description).toBe("Some raw idea");
    expect(result.laterFeatures).toHaveLength(2);
    expect(result.laterFeatures[0].slug).toBe("future-thing");
    expect(result.laterFeatures[1].description).toBe("Another future thought");
  });

  it("generates kebab-case slugs from bare-dash text", () => {
    const md = `## Backlog

- Add "fancy" UI components!!!
- fix: something with colons`;

    const result = parseTasksMd(md);
    expect(result.ungroomed[0].slug).toBe("add-fancy-ui-components");
    // "fix: something with colons" is a bare-dash item since it doesn't match
    // the structured format (no checkbox)
    expect(result.ungroomed[1].slug).toBe("fix-something-with-colons");
  });

  it("generates 'untitled' slug when bare-dash text is all special characters", () => {
    const md = `## Backlog

- !!!@@@###`;

    const result = parseTasksMd(md);
    expect(result.ungroomed).toHaveLength(1);
    expect(result.ungroomed[0].slug).toBe("untitled");
    expect(result.ungroomed[0].description).toBe("!!!@@@###");
  });

  it("truncates generated slugs to 60 characters", () => {
    const longText = "a]".repeat(1) + "word ".repeat(20); // produces slug > 60 chars
    const md = `## Backlog

- ${longText.trim()}`;

    const result = parseTasksMd(md);
    expect(result.ungroomed[0].slug.length).toBeLessThanOrEqual(60);
  });

  it("puts a planned task without ### heading into groomed with Uncategorized title", () => {
    const md = `## Backlog

- [ ] orphan-planned: A planned task with no section [P1] [planned]`;

    const result = parseTasksMd(md);
    expect(result.groomed).toHaveLength(1);
    expect(result.groomed[0].title).toBe("Uncategorized");
    expect(result.groomed[0].tasks[0].slug).toBe("orphan-planned");
    expect(result.ungroomed).toHaveLength(0);
  });

  it("creates multiple groomed sections from different ### headings", () => {
    const md = `## Backlog

### Auth

- [ ] login: Login flow [P1] [planned]

### Payments

- [ ] checkout: Checkout flow [P2] [planned]`;

    const result = parseTasksMd(md);
    expect(result.groomed).toHaveLength(2);
    expect(result.groomed[0].title).toBe("Auth");
    expect(result.groomed[0].tasks[0].slug).toBe("login");
    expect(result.groomed[1].title).toBe("Payments");
    expect(result.groomed[1].tasks[0].slug).toBe("checkout");
  });

  it("resets Later Features context when a new ### heading follows", () => {
    const md = `## Backlog

### Later Features

- [ ] future-api: Future API [P3]

### Next Sprint

- [ ] next-task: Next sprint task [P1] [planned]`;

    const result = parseTasksMd(md);
    expect(result.laterFeatures).toHaveLength(1);
    expect(result.laterFeatures[0].slug).toBe("future-api");
    expect(result.groomed).toHaveLength(1);
    expect(result.groomed[0].title).toBe("Next Sprint");
    expect(result.groomed[0].tasks[0].slug).toBe("next-task");
  });

  it("skips lone-dash lines without content", () => {
    // A line that is just "-" (no space or content) gets trimmed and
    // doesn't match any task pattern -- silently ignored
    const md = `## Backlog

### Ideas

-
- Valid idea`;

    const result = parseTasksMd(md);
    expect(result.ungroomed).toHaveLength(1);
    expect(result.ungroomed[0].description).toBe("Valid idea");
  });

  it("attaches files line to bare-dash tasks", () => {
    const md = `## Backlog

### Ideas

- Add notifications
  files: src/notify.ts`;

    const result = parseTasksMd(md);
    expect(result.ungroomed).toHaveLength(1);
    expect(result.ungroomed[0].filesLine).toBe("src/notify.ts");
  });
});
