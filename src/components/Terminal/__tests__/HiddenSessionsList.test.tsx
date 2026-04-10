import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { HiddenSessionsList } from "../HiddenSessionsList";
import type { TerminalTab } from "../../../types/terminal";

function makeTab(overrides: Partial<TerminalTab> = {}): TerminalTab {
  return {
    id: "tab-1",
    terminalId: "term-1",
    label: "Shell session",
    isClaudeSession: false,
    projectPath: "/home/user/project",
    visible: false,
    ...overrides,
  };
}

describe("HiddenSessionsList", () => {
  it("returns null when hiddenSessions is empty", () => {
    const { container } = render(
      <HiddenSessionsList hiddenSessions={[]} onShow={vi.fn()} onKill={vi.fn()} />
    );
    expect(container.querySelector(".hidden-sessions-section")).toBeNull();
  });

  it("renders section header with session count", () => {
    const sessions = [
      makeTab({ id: "tab-1", label: "Session 1" }),
      makeTab({ id: "tab-2", label: "Session 2" }),
    ];
    render(
      <HiddenSessionsList hiddenSessions={sessions} onShow={vi.fn()} onKill={vi.fn()} />
    );
    expect(screen.getByText("Hidden Sessions (2)")).toBeTruthy();
  });

  it("renders a row for each hidden session", () => {
    const sessions = [
      makeTab({ id: "tab-1", label: "Session A" }),
      makeTab({ id: "tab-2", label: "Session B" }),
      makeTab({ id: "tab-3", label: "Session C" }),
    ];
    const { container } = render(
      <HiddenSessionsList hiddenSessions={sessions} onShow={vi.fn()} onKill={vi.fn()} />
    );
    const rows = container.querySelectorAll(".hidden-session-row");
    expect(rows).toHaveLength(3);
  });

  it("shows > icon for Claude sessions", () => {
    const sessions = [makeTab({ id: "tab-1", isClaudeSession: true, label: "Claude" })];
    const { container } = render(
      <HiddenSessionsList hiddenSessions={sessions} onShow={vi.fn()} onKill={vi.fn()} />
    );
    const icon = container.querySelector(".hidden-session-icon");
    expect(icon?.textContent).toBe(">");
  });

  it("shows $ icon for shell sessions", () => {
    const sessions = [makeTab({ id: "tab-1", isClaudeSession: false, label: "Shell" })];
    const { container } = render(
      <HiddenSessionsList hiddenSessions={sessions} onShow={vi.fn()} onKill={vi.fn()} />
    );
    const icon = container.querySelector(".hidden-session-icon");
    expect(icon?.textContent).toBe("$");
  });

  it("displays session label text", () => {
    const sessions = [makeTab({ id: "tab-1", label: "my-project: Claude" })];
    render(
      <HiddenSessionsList hiddenSessions={sessions} onShow={vi.fn()} onKill={vi.fn()} />
    );
    expect(screen.getByText("my-project: Claude")).toBeTruthy();
  });

  it("calls onShow with correct tab id when Show button is clicked", () => {
    const onShow = vi.fn();
    const sessions = [makeTab({ id: "tab-abc", label: "Session" })];
    render(
      <HiddenSessionsList hiddenSessions={sessions} onShow={onShow} onKill={vi.fn()} />
    );
    fireEvent.click(screen.getByText("Show"));
    expect(onShow).toHaveBeenCalledWith("tab-abc");
    expect(onShow).toHaveBeenCalledTimes(1);
  });

  it("calls onKill with correct tab id when Kill button is clicked", () => {
    const onKill = vi.fn();
    const sessions = [makeTab({ id: "tab-xyz", label: "Session" })];
    render(
      <HiddenSessionsList hiddenSessions={sessions} onShow={vi.fn()} onKill={onKill} />
    );
    fireEvent.click(screen.getByText("Kill"));
    expect(onKill).toHaveBeenCalledWith("tab-xyz");
    expect(onKill).toHaveBeenCalledTimes(1);
  });

  it("calls onShow with the correct id for each row in a multi-session list", () => {
    const onShow = vi.fn();
    const sessions = [
      makeTab({ id: "tab-1", label: "First" }),
      makeTab({ id: "tab-2", label: "Second" }),
    ];
    render(
      <HiddenSessionsList hiddenSessions={sessions} onShow={onShow} onKill={vi.fn()} />
    );
    const showButtons = screen.getAllByText("Show");
    fireEvent.click(showButtons[1]);
    expect(onShow).toHaveBeenCalledWith("tab-2");
  });

  it("calls onKill with the correct id for each row in a multi-session list", () => {
    const onKill = vi.fn();
    const sessions = [
      makeTab({ id: "tab-1", label: "First" }),
      makeTab({ id: "tab-2", label: "Second" }),
    ];
    render(
      <HiddenSessionsList hiddenSessions={sessions} onShow={vi.fn()} onKill={onKill} />
    );
    const killButtons = screen.getAllByText("Kill");
    fireEvent.click(killButtons[0]);
    expect(onKill).toHaveBeenCalledWith("tab-1");
  });

  it("renders both Show and Kill buttons with correct aria-labels", () => {
    const sessions = [makeTab({ id: "tab-1", label: "Session" })];
    render(
      <HiddenSessionsList hiddenSessions={sessions} onShow={vi.fn()} onKill={vi.fn()} />
    );
    expect(screen.getByLabelText("Show hidden session")).toBeTruthy();
    expect(screen.getByLabelText("Kill hidden session")).toBeTruthy();
  });

  it("updates header count when sessions list changes", () => {
    const sessions1 = [makeTab({ id: "tab-1", label: "S1" })];
    const { rerender } = render(
      <HiddenSessionsList hiddenSessions={sessions1} onShow={vi.fn()} onKill={vi.fn()} />
    );
    expect(screen.getByText("Hidden Sessions (1)")).toBeTruthy();

    const sessions2 = [
      makeTab({ id: "tab-1", label: "S1" }),
      makeTab({ id: "tab-2", label: "S2" }),
      makeTab({ id: "tab-3", label: "S3" }),
    ];
    rerender(
      <HiddenSessionsList hiddenSessions={sessions2} onShow={vi.fn()} onKill={vi.fn()} />
    );
    expect(screen.getByText("Hidden Sessions (3)")).toBeTruthy();
  });

  it("renders mixed Claude and shell sessions with correct icons", () => {
    const sessions = [
      makeTab({ id: "tab-1", isClaudeSession: true, label: "Claude 1" }),
      makeTab({ id: "tab-2", isClaudeSession: false, label: "Shell 1" }),
      makeTab({ id: "tab-3", isClaudeSession: true, label: "Claude 2" }),
    ];
    const { container } = render(
      <HiddenSessionsList hiddenSessions={sessions} onShow={vi.fn()} onKill={vi.fn()} />
    );
    const icons = container.querySelectorAll(".hidden-session-icon");
    expect(icons[0].textContent).toBe(">");
    expect(icons[1].textContent).toBe("$");
    expect(icons[2].textContent).toBe(">");
  });

  it("returns null after re-rendering with an empty list", () => {
    const sessions = [makeTab({ id: "tab-1", label: "Session" })];
    const { container, rerender } = render(
      <HiddenSessionsList hiddenSessions={sessions} onShow={vi.fn()} onKill={vi.fn()} />
    );
    expect(container.querySelector(".hidden-sessions-section")).toBeTruthy();

    rerender(
      <HiddenSessionsList hiddenSessions={[]} onShow={vi.fn()} onKill={vi.fn()} />
    );
    expect(container.querySelector(".hidden-sessions-section")).toBeNull();
  });

  it("clicking Show does not trigger onKill", () => {
    const onShow = vi.fn();
    const onKill = vi.fn();
    const sessions = [makeTab({ id: "tab-1", label: "Session" })];
    render(
      <HiddenSessionsList hiddenSessions={sessions} onShow={onShow} onKill={onKill} />
    );
    fireEvent.click(screen.getByText("Show"));
    expect(onShow).toHaveBeenCalledTimes(1);
    expect(onKill).not.toHaveBeenCalled();
  });

  it("clicking Kill does not trigger onShow", () => {
    const onShow = vi.fn();
    const onKill = vi.fn();
    const sessions = [makeTab({ id: "tab-1", label: "Session" })];
    render(
      <HiddenSessionsList hiddenSessions={sessions} onShow={onShow} onKill={onKill} />
    );
    fireEvent.click(screen.getByText("Kill"));
    expect(onKill).toHaveBeenCalledTimes(1);
    expect(onShow).not.toHaveBeenCalled();
  });
});
