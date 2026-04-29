import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { TaskCard } from "../TasksViewer/TaskCard";
import type { TaskItem } from "../../types/task";

function makeTask(overrides: Partial<TaskItem> = {}): TaskItem {
  return {
    slug: "auth-flow",
    description: "Implement authentication",
    priority: "P1",
    complexity: "complex",
    pipeline: "code",
    depends: [],
    conflicts: [],
    planned: false,
    checked: false,
    filesLine: null,
    ...overrides,
  };
}

describe("TaskCard", () => {
  it("renders slug and description", () => {
    render(
      <TaskCard
        task={makeTask()}
        onStart={vi.fn()}
        interactive={true}
      />
    );
    expect(screen.getByText("auth-flow")).toBeTruthy();
    expect(screen.getByText("Implement authentication")).toBeTruthy();
  });

  it("shows priority badge", () => {
    render(
      <TaskCard
        task={makeTask({ priority: "P2" })}
        onStart={vi.fn()}
        interactive={true}
      />
    );
    expect(screen.getByText("P2")).toBeTruthy();
  });

  it("shows complexity badge", () => {
    render(
      <TaskCard
        task={makeTask({ complexity: "moderate" })}
        onStart={vi.fn()}
        interactive={true}
      />
    );
    expect(screen.getByText("moderate")).toBeTruthy();
  });

  it("shows pipeline badge", () => {
    render(
      <TaskCard
        task={makeTask({ pipeline: "design" })}
        onStart={vi.fn()}
        interactive={true}
      />
    );
    expect(screen.getByText("design")).toBeTruthy();
  });

  it("shows planned badge when planned is true", () => {
    render(
      <TaskCard
        task={makeTask({ planned: true })}
        onStart={vi.fn()}
        interactive={true}
      />
    );
    expect(screen.getByText("planned")).toBeTruthy();
  });

  it("does not show planned badge when planned is false", () => {
    render(
      <TaskCard
        task={makeTask({ planned: false })}
        onStart={vi.fn()}
        interactive={true}
      />
    );
    expect(screen.queryByText("planned")).toBeNull();
  });

  it("shows Start button when interactive and not checked", () => {
    render(
      <TaskCard
        task={makeTask()}
        onStart={vi.fn()}
        interactive={true}
      />
    );
    expect(screen.getByText("Start")).toBeTruthy();
  });

  it("does not render checkbox (checkboxes removed)", () => {
    render(
      <TaskCard
        task={makeTask()}
        onStart={vi.fn()}
        interactive={true}
      />
    );
    expect(screen.queryByRole("checkbox")).toBeNull();
  });

  it("hides Start button when not interactive", () => {
    render(
      <TaskCard
        task={makeTask()}
        onStart={vi.fn()}
        interactive={false}
      />
    );
    expect(screen.queryByText("Start")).toBeNull();
  });

  it("hides Start button when task is checked", () => {
    render(
      <TaskCard
        task={makeTask({ checked: true })}
        onStart={vi.fn()}
        interactive={true}
      />
    );
    expect(screen.queryByText("Start")).toBeNull();
  });

  it("calls onStart with slug and mode when Start button is clicked", () => {
    const onStart = vi.fn();
    render(
      <TaskCard
        task={makeTask({ slug: "my-task", pipeline: "code" })}
        onStart={onStart}
        interactive={true}
      />
    );
    fireEvent.click(screen.getByText("Start"));
    expect(onStart).toHaveBeenCalledWith("my-task", "code");
  });

  it("renders 'Walk through' button for manual mode", () => {
    render(
      <TaskCard
        task={makeTask({ pipeline: "manual" })}
        onStart={vi.fn()}
        interactive={true}
      />
    );
    expect(screen.getByText("Walk through")).toBeTruthy();
    expect(screen.queryByText("Start")).toBeNull();
  });

  it("renders 'Debug' button for debug mode", () => {
    render(
      <TaskCard
        task={makeTask({ pipeline: "debug" })}
        onStart={vi.fn()}
        interactive={true}
      />
    );
    expect(screen.getByText("Debug")).toBeTruthy();
  });

  it("renders 'Start' button for reggie-system mode", () => {
    render(
      <TaskCard
        task={makeTask({ pipeline: "reggie-system" })}
        onStart={vi.fn()}
        interactive={true}
      />
    );
    expect(screen.getByText("Start")).toBeTruthy();
  });

  it("renders 'Start' button for null/code/design modes", () => {
    const { rerender } = render(
      <TaskCard
        task={makeTask({ pipeline: null })}
        onStart={vi.fn()}
        interactive={true}
      />
    );
    expect(screen.getByText("Start")).toBeTruthy();

    rerender(
      <TaskCard
        task={makeTask({ pipeline: "design" })}
        onStart={vi.fn()}
        interactive={true}
      />
    );
    expect(screen.getByText("Start")).toBeTruthy();
  });

  it("renders mode badge for all 5 modes", () => {
    const modes = ["code", "design", "manual", "reggie-system", "debug"] as const;
    for (const mode of modes) {
      const { unmount } = render(
        <TaskCard
          task={makeTask({ pipeline: mode })}
          onStart={vi.fn()}
          interactive={true}
        />
      );
      expect(screen.getByText(mode)).toBeTruthy();
      unmount();
    }
  });

  it("passes manual mode through to onStart callback", () => {
    const onStart = vi.fn();
    render(
      <TaskCard
        task={makeTask({ slug: "manual-task", pipeline: "manual" })}
        onStart={onStart}
        interactive={true}
      />
    );
    fireEvent.click(screen.getByText("Walk through"));
    expect(onStart).toHaveBeenCalledWith("manual-task", "manual");
  });

  it("shows dependency relations", () => {
    render(
      <TaskCard
        task={makeTask({ depends: ["api-layer", "db-setup"] })}
        onStart={vi.fn()}
        interactive={true}
      />
    );
    expect(screen.getByText("depends: api-layer, db-setup")).toBeTruthy();
  });

  it("shows conflict relations", () => {
    render(
      <TaskCard
        task={makeTask({ conflicts: ["legacy-auth"] })}
        onStart={vi.fn()}
        interactive={true}
      />
    );
    expect(screen.getByText("conflicts: legacy-auth")).toBeTruthy();
  });

  it("does not render relations section when no depends or conflicts", () => {
    const { container } = render(
      <TaskCard
        task={makeTask({ depends: [], conflicts: [] })}
        onStart={vi.fn()}
        interactive={true}
      />
    );
    expect(container.querySelector(".task-card-relations")).toBeNull();
  });

  it("applies task-card-done class when checked", () => {
    const { container } = render(
      <TaskCard
        task={makeTask({ checked: true })}
        onStart={vi.fn()}
        interactive={true}
      />
    );
    expect(container.querySelector(".task-card-done")).not.toBeNull();
  });

  it("renders filesLine when present", () => {
    render(
      <TaskCard
        task={makeTask({ filesLine: "src/auth.ts, src/login.ts" })}
        onStart={vi.fn()}
        interactive={true}
      />
    );
    expect(screen.getByText("src/auth.ts, src/login.ts")).toBeTruthy();
  });

  it("does not render files section when filesLine is null", () => {
    const { container } = render(
      <TaskCard
        task={makeTask({ filesLine: null })}
        onStart={vi.fn()}
        interactive={true}
      />
    );
    expect(container.querySelector(".task-card-files")).toBeNull();
  });
});
