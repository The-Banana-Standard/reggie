import { describe, it, expect } from "vitest";
import { parseTaskInput } from "../ProjectSummaryPanel";

describe("parseTaskInput", () => {
  it("returns empty array for empty string", () => {
    expect(parseTaskInput("")).toEqual([]);
  });

  it("returns empty array for whitespace-only input", () => {
    expect(parseTaskInput("   \n  \n   ")).toEqual([]);
  });

  it("returns single task for a single line without list prefix", () => {
    expect(parseTaskInput("fix the login bug")).toEqual(["fix the login bug"]);
  });

  it("strips prefix and returns single task for a single line with dash prefix", () => {
    expect(parseTaskInput("- fix the login bug")).toEqual(["fix the login bug"]);
  });

  it("strips prefix and returns single task for a single line with asterisk prefix", () => {
    expect(parseTaskInput("* add unit tests")).toEqual(["add unit tests"]);
  });

  it("strips prefix and returns single task for a single line with plus prefix", () => {
    expect(parseTaskInput("+ refactor auth module")).toEqual(["refactor auth module"]);
  });

  it("strips prefix and returns single task for a single numbered line", () => {
    expect(parseTaskInput("1. update readme")).toEqual(["update readme"]);
  });

  it("parses multiple dash-prefixed lines as separate tasks", () => {
    const input = "- task one\n- task two\n- task three";
    expect(parseTaskInput(input)).toEqual(["task one", "task two", "task three"]);
  });

  it("parses multiple asterisk-prefixed lines as separate tasks", () => {
    const input = "* alpha\n* beta";
    expect(parseTaskInput(input)).toEqual(["alpha", "beta"]);
  });

  it("parses mixed list prefixes as separate tasks", () => {
    const input = "- first task\n* second task\n1. third task\n+ fourth task";
    expect(parseTaskInput(input)).toEqual([
      "first task",
      "second task",
      "third task",
      "fourth task",
    ]);
  });

  it("ignores blank lines between list items", () => {
    const input = "- task one\n\n- task two\n  \n- task three";
    expect(parseTaskInput(input)).toEqual(["task one", "task two", "task three"]);
  });

  it("joins multi-line non-list input as a single task", () => {
    const input = "this is a long\ntask description\nspanning lines";
    expect(parseTaskInput(input)).toEqual(["this is a long task description spanning lines"]);
  });

  it("truncates single task to 200 characters", () => {
    const longInput = "a".repeat(250);
    const result = parseTaskInput(longInput);
    expect(result).toHaveLength(1);
    expect(result[0]).toHaveLength(200);
    expect(result[0]).toBe("a".repeat(200));
  });

  it("does not truncate single task at exactly 200 characters", () => {
    const input = "b".repeat(200);
    const result = parseTaskInput(input);
    expect(result).toHaveLength(1);
    expect(result[0]).toHaveLength(200);
  });

  it("does not truncate individual items in a multi-item list", () => {
    const longItem = "x".repeat(250);
    const input = `- ${longItem}\n- short`;
    const result = parseTaskInput(input);
    expect(result).toHaveLength(2);
    expect(result[0]).toHaveLength(250);
    expect(result[1]).toBe("short");
  });

  it("trims whitespace from each line", () => {
    const input = "  - task with spaces  \n  - another task  ";
    expect(parseTaskInput(input)).toEqual(["task with spaces", "another task"]);
  });

  it("skips blank lines between valid list items", () => {
    const input = "- first task\n\n\n- second task";
    expect(parseTaskInput(input)).toEqual(["first task", "second task"]);
  });

  it("handles numbered list with closing paren", () => {
    const input = "1) first\n2) second";
    // The regex uses \d+[.)] so both dot and paren should work
    expect(parseTaskInput(input)).toEqual(["first", "second"]);
  });

  it("handles multi-digit numbered lists", () => {
    const input = "10. tenth task\n11. eleventh task";
    expect(parseTaskInput(input)).toEqual(["tenth task", "eleventh task"]);
  });

  it("joins one list-prefixed line with non-list lines as single task", () => {
    // When only one line has a list prefix but there are other plain lines,
    // the input is treated as a single multi-line task (not a list)
    const input = "- some context\nmore detail here";
    expect(parseTaskInput(input)).toEqual(["- some context more detail here"]);
  });

  it("handles Windows-style CRLF line endings", () => {
    const input = "- task one\r\n- task two\r\n- task three";
    expect(parseTaskInput(input)).toEqual(["task one", "task two", "task three"]);
  });

  it("treats dash without space as plain text, not a list prefix", () => {
    // The regex requires a space after dash so "-task" is NOT a list item
    const input = "-task one\n-task two";
    expect(parseTaskInput(input)).toEqual(["-task one -task two"]);
  });
});
