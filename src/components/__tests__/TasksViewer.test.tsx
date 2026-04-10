import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { TasksViewer } from "../TasksViewer/TasksViewer";

const SAMPLE_MD = `## Active Tasks

- [ ] in-progress: Currently working on this [P1] [code]

## Backlog

### Core Features

- [ ] auth-flow: Implement authentication [P1] [complex] [code] [planned]
- [ ] sidebar: Build sidebar component [P2] [simple] [design]

### Later Features

- [ ] future-thing: A future idea [P3]`;

describe("TasksViewer", () => {
  it("returns null for empty content", () => {
    const { container } = render(
      <TasksViewer tasksMd="" onStartTask={vi.fn()} />
    );
    expect(container.innerHTML).toBe("");
  });

  it("returns null for whitespace-only content", () => {
    const { container } = render(
      <TasksViewer tasksMd="   \n  " onStartTask={vi.fn()} />
    );
    expect(container.innerHTML).toBe("");
  });

  it("renders Active Tasks section title", () => {
    render(<TasksViewer tasksMd={SAMPLE_MD} onStartTask={vi.fn()} />);
    expect(screen.getByText("Active Tasks")).toBeTruthy();
  });

  it("renders Groomed section title", () => {
    render(<TasksViewer tasksMd={SAMPLE_MD} onStartTask={vi.fn()} />);
    expect(screen.getByText("Groomed")).toBeTruthy();
  });

  it("renders Ungroomed section title for unplanned tasks", () => {
    render(<TasksViewer tasksMd={SAMPLE_MD} onStartTask={vi.fn()} />);
    expect(screen.getByText("Ungroomed")).toBeTruthy();
  });

  it("renders Later Features section title", () => {
    render(<TasksViewer tasksMd={SAMPLE_MD} onStartTask={vi.fn()} />);
    expect(screen.getByText("Later Features")).toBeTruthy();
  });

  it("renders active task slug", () => {
    render(<TasksViewer tasksMd={SAMPLE_MD} onStartTask={vi.fn()} />);
    expect(screen.getByText("in-progress")).toBeTruthy();
  });

  it("renders groomed task slug from planned items", () => {
    render(<TasksViewer tasksMd={SAMPLE_MD} onStartTask={vi.fn()} />);
    expect(screen.getByText("auth-flow")).toBeTruthy();
  });

  it("renders ungroomed task slug from unplanned items", () => {
    render(<TasksViewer tasksMd={SAMPLE_MD} onStartTask={vi.fn()} />);
    expect(screen.getByText("sidebar")).toBeTruthy();
  });

  it("renders later features task slug", () => {
    render(<TasksViewer tasksMd={SAMPLE_MD} onStartTask={vi.fn()} />);
    expect(screen.getByText("future-thing")).toBeTruthy();
  });

  it("active tasks do not show Start button", () => {
    const activeOnlyMd = `## Active Tasks

- [ ] active-task: A task in progress [P1]`;

    render(<TasksViewer tasksMd={activeOnlyMd} onStartTask={vi.fn()} />);
    expect(screen.queryByText("Start")).toBeNull();
  });

  it("groomed tasks show Start button", () => {
    const groomedOnlyMd = `## Backlog

### Features

- [ ] my-task: A planned task [P1] [planned]`;

    render(<TasksViewer tasksMd={groomedOnlyMd} onStartTask={vi.fn()} />);
    expect(screen.getByText("Start")).toBeTruthy();
  });

  it("clicking Start on groomed task calls onStartTask with slug", () => {
    const onStartTask = vi.fn();
    const groomedOnlyMd = `## Backlog

### Features

- [ ] my-task: A planned task [P1] [planned]`;

    render(<TasksViewer tasksMd={groomedOnlyMd} onStartTask={onStartTask} />);
    fireEvent.click(screen.getByText("Start"));
    expect(onStartTask).toHaveBeenCalledWith("my-task");
  });

  it("ungroomed tasks do not show Start button", () => {
    const ungroomedOnlyMd = `## Backlog

### Features

- [ ] task-a: First task [P1]
- [ ] task-b: Second task [P2]`;

    render(<TasksViewer tasksMd={ungroomedOnlyMd} onStartTask={vi.fn()} />);
    expect(screen.queryByText("Start")).toBeNull();
  });

  it("later features do not show Start button", () => {
    const laterMd = `## Backlog

### Later Features

- [ ] future: A future thing [P3]`;

    render(<TasksViewer tasksMd={laterMd} onStartTask={vi.fn()} />);
    expect(screen.queryByText("Start")).toBeNull();
  });

  it("no checkboxes are rendered (checkboxes removed)", () => {
    render(<TasksViewer tasksMd={SAMPLE_MD} onStartTask={vi.fn()} />);
    expect(screen.queryByRole("checkbox")).toBeNull();
  });

  it("renders bare-dash items in Ungroomed section", () => {
    const bareDashMd = `## Backlog

### Ideas

- Add user notifications
- Fix the broken login flow`;

    render(<TasksViewer tasksMd={bareDashMd} onStartTask={vi.fn()} />);
    expect(screen.getByText("Ungroomed")).toBeTruthy();
    expect(screen.getByText("Add user notifications")).toBeTruthy();
    expect(screen.getByText("Fix the broken login flow")).toBeTruthy();
  });

  it("renders bare-dash items under Later Features in Later Features section", () => {
    const laterBareMd = `## Backlog

### Later Features

- Mobile app support
- AI-powered search`;

    render(<TasksViewer tasksMd={laterBareMd} onStartTask={vi.fn()} />);
    expect(screen.getByText("Later Features")).toBeTruthy();
    expect(screen.getByText("Mobile app support")).toBeTruthy();
    expect(screen.getByText("AI-powered search")).toBeTruthy();
  });

  it("renders subsection titles within groomed section", () => {
    const groomedMd = `## Backlog

### Core Features

- [ ] auth: Auth flow [P1] [planned]

### UI Polish

- [ ] theme: Dark theme [P2] [planned]`;

    render(<TasksViewer tasksMd={groomedMd} onStartTask={vi.fn()} />);
    expect(screen.getByText("Core Features")).toBeTruthy();
    expect(screen.getByText("UI Polish")).toBeTruthy();
  });

  it("renders only Later Features section when no other task types exist", () => {
    const laterOnlyMd = `## Backlog

### Later Features

- [ ] future: A future thing [P3]`;

    render(<TasksViewer tasksMd={laterOnlyMd} onStartTask={vi.fn()} />);
    expect(screen.getByText("Later Features")).toBeTruthy();
    expect(screen.queryByText("Groomed")).toBeNull();
    expect(screen.queryByText("Ungroomed")).toBeNull();
    expect(screen.queryByText("Active Tasks")).toBeNull();
  });

  it("renders only Ungroomed section when no other task types exist", () => {
    const ungroomedOnlyMd = `## Backlog

- Some raw idea
- Another thought`;

    render(<TasksViewer tasksMd={ungroomedOnlyMd} onStartTask={vi.fn()} />);
    expect(screen.getByText("Ungroomed")).toBeTruthy();
    expect(screen.queryByText("Groomed")).toBeNull();
    expect(screen.queryByText("Later Features")).toBeNull();
    expect(screen.queryByText("Active Tasks")).toBeNull();
  });

  it("does not render tasks-viewer container for content with no recognized sections", () => {
    const noTasksMd = `## Notes

This is just a notes section with no tasks.`;

    const { container } = render(
      <TasksViewer tasksMd={noTasksMd} onStartTask={vi.fn()} />
    );
    expect(container.innerHTML).toBe("");
  });
});
