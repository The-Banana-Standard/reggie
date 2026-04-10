import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { TerminalTabBar } from "../Terminal/TerminalTabBar";
import type { TerminalTab } from "../../types/terminal";

const defaultProps = {
  tabs: [] as TerminalTab[],
  activeTabId: "home",
  visibleSessionCount: 0,
  totalSessionCount: 0,
  onSelectTab: vi.fn(),
  onCloseTab: vi.fn(),
  onKillTab: vi.fn(),
  onNewTerminal: vi.fn(),
  onNewClaudeSession: vi.fn(),
  onCloseAllTabs: vi.fn(),
  onKillAllTerminals: vi.fn(),
};

describe("TerminalTabBar", () => {
  it("renders Home tab", () => {
    render(<TerminalTabBar {...defaultProps} />);
    expect(screen.getByText("Home")).toBeTruthy();
  });

  it("does not render Sessions tab when visibleSessionCount is 0", () => {
    render(<TerminalTabBar {...defaultProps} />);
    expect(screen.queryByText(/Sessions/)).toBeNull();
  });

  it("renders Sessions tab with visible count when visibleSessionCount > 0", () => {
    render(
      <TerminalTabBar
        {...defaultProps}
        visibleSessionCount={3}
        totalSessionCount={5}
      />
    );
    expect(screen.getByText("Sessions (3)")).toBeTruthy();
  });

  it("displays visibleSessionCount in Sessions tab label, not totalSessionCount", () => {
    render(
      <TerminalTabBar
        {...defaultProps}
        visibleSessionCount={2}
        totalSessionCount={7}
      />
    );
    expect(screen.getByText("Sessions (2)")).toBeTruthy();
    expect(screen.queryByText("Sessions (7)")).toBeNull();
  });

  it("does not render Sessions tab when visibleSessionCount is 0 but totalSessionCount > 0", () => {
    render(
      <TerminalTabBar
        {...defaultProps}
        visibleSessionCount={0}
        totalSessionCount={4}
      />
    );
    expect(screen.queryByText(/Sessions/)).toBeNull();
  });

  it("calls onSelectTab with SESSIONS_TAB_ID when Sessions tab clicked", () => {
    const onSelectTab = vi.fn();
    render(
      <TerminalTabBar
        {...defaultProps}
        visibleSessionCount={2}
        totalSessionCount={2}
        onSelectTab={onSelectTab}
      />
    );
    fireEvent.click(screen.getByText("Sessions (2)"));
    expect(onSelectTab).toHaveBeenCalledWith("sessions");
  });

  it("calls onSelectTab with HOME_TAB_ID when Home tab clicked", () => {
    const onSelectTab = vi.fn();
    render(<TerminalTabBar {...defaultProps} onSelectTab={onSelectTab} />);
    fireEvent.click(screen.getByText("Home"));
    expect(onSelectTab).toHaveBeenCalledWith("home");
  });

  it("renders project overview tabs", () => {
    const tabs: TerminalTab[] = [
      {
        id: "tab-overview",
        terminalId: null,
        label: "my-project",
        isClaudeSession: false,
        isProjectOverview: true,
        projectPath: "/home/user/my-project",
        projectName: "my-project",
      },
    ];
    render(<TerminalTabBar {...defaultProps} tabs={tabs} />);
    expect(screen.getByText("my-project")).toBeTruthy();
  });

  it("does not render individual terminal tabs (only Sessions aggregate)", () => {
    const tabs: TerminalTab[] = [
      {
        id: "tab-1",
        terminalId: "term-1",
        label: "Terminal 1",
        isClaudeSession: true,
        projectPath: "/home/user/proj",
        projectName: "proj",
        visible: true,
      },
    ];
    render(
      <TerminalTabBar
        {...defaultProps}
        tabs={tabs}
        visibleSessionCount={1}
        totalSessionCount={1}
      />
    );
    // Individual terminal label should NOT appear -- only Sessions (N) tab
    expect(screen.queryByText("Terminal 1")).toBeNull();
    expect(screen.getByText("Sessions (1)")).toBeTruthy();
  });

  it("calls onNewClaudeSession when + Claude clicked", () => {
    const onNewClaudeSession = vi.fn();
    render(
      <TerminalTabBar {...defaultProps} onNewClaudeSession={onNewClaudeSession} />
    );
    fireEvent.click(screen.getByText("+ Claude"));
    expect(onNewClaudeSession).toHaveBeenCalled();
  });

  it("calls onNewTerminal when + Shell clicked", () => {
    const onNewTerminal = vi.fn();
    render(
      <TerminalTabBar {...defaultProps} onNewTerminal={onNewTerminal} />
    );
    fireEvent.click(screen.getByText("+ Shell"));
    expect(onNewTerminal).toHaveBeenCalled();
  });

  it("shows close-all button when visibleSessionCount > 0", () => {
    const { container } = render(
      <TerminalTabBar
        {...defaultProps}
        visibleSessionCount={2}
        totalSessionCount={2}
      />
    );
    expect(container.querySelector(".close-all-btn")).toBeTruthy();
  });

  it("hides close-all button when visibleSessionCount is 0", () => {
    const { container } = render(<TerminalTabBar {...defaultProps} />);
    expect(container.querySelector(".close-all-btn")).toBeNull();
  });

  it("hides close-all button when visibleSessionCount is 0 even with totalSessionCount > 0", () => {
    const { container } = render(
      <TerminalTabBar
        {...defaultProps}
        visibleSessionCount={0}
        totalSessionCount={3}
      />
    );
    expect(container.querySelector(".close-all-btn")).toBeNull();
  });

  it("shows kill-all button when visibleSessionCount > 0", () => {
    const { container } = render(
      <TerminalTabBar
        {...defaultProps}
        visibleSessionCount={1}
        totalSessionCount={1}
      />
    );
    expect(container.querySelector(".kill-all-btn")).toBeTruthy();
  });

  it("hides kill-all button when visibleSessionCount is 0", () => {
    const { container } = render(<TerminalTabBar {...defaultProps} />);
    expect(container.querySelector(".kill-all-btn")).toBeNull();
  });

  it("hides kill-all button when visibleSessionCount is 0 even with totalSessionCount > 0", () => {
    const { container } = render(
      <TerminalTabBar
        {...defaultProps}
        visibleSessionCount={0}
        totalSessionCount={5}
      />
    );
    expect(container.querySelector(".kill-all-btn")).toBeNull();
  });

  it("close-all confirm dialog references totalSessionCount, not visibleSessionCount", () => {
    const onCloseAllTabs = vi.fn();
    vi.spyOn(window, "confirm").mockReturnValue(true);
    render(
      <TerminalTabBar
        {...defaultProps}
        visibleSessionCount={2}
        totalSessionCount={5}
        onCloseAllTabs={onCloseAllTabs}
      />
    );
    fireEvent.click(screen.getByTitle("Hide all sessions"));
    expect(window.confirm).toHaveBeenCalledWith("Close 5 sessions? (Sessions will continue running in the background)");
    expect(onCloseAllTabs).toHaveBeenCalled();
    vi.restoreAllMocks();
  });

  it("does not call onCloseAllTabs when confirm is cancelled", () => {
    const onCloseAllTabs = vi.fn();
    vi.spyOn(window, "confirm").mockReturnValue(false);
    render(
      <TerminalTabBar
        {...defaultProps}
        visibleSessionCount={2}
        totalSessionCount={2}
        onCloseAllTabs={onCloseAllTabs}
      />
    );
    fireEvent.click(screen.getByTitle("Hide all sessions"));
    expect(onCloseAllTabs).not.toHaveBeenCalled();
    vi.restoreAllMocks();
  });

  it("kill-all confirm dialog references totalSessionCount, not visibleSessionCount", () => {
    const onKillAllTerminals = vi.fn();
    vi.spyOn(window, "confirm").mockReturnValue(true);
    render(
      <TerminalTabBar
        {...defaultProps}
        visibleSessionCount={1}
        totalSessionCount={4}
        onKillAllTerminals={onKillAllTerminals}
      />
    );
    fireEvent.click(screen.getByTitle("Kill all sessions"));
    expect(window.confirm).toHaveBeenCalledWith("Kill 4 sessions? This will terminate all processes.");
    expect(onKillAllTerminals).toHaveBeenCalled();
    vi.restoreAllMocks();
  });

  it("does not call onKillAllTerminals when confirm is cancelled", () => {
    const onKillAllTerminals = vi.fn();
    vi.spyOn(window, "confirm").mockReturnValue(false);
    render(
      <TerminalTabBar
        {...defaultProps}
        visibleSessionCount={2}
        totalSessionCount={2}
        onKillAllTerminals={onKillAllTerminals}
      />
    );
    fireEvent.click(screen.getByTitle("Kill all sessions"));
    expect(onKillAllTerminals).not.toHaveBeenCalled();
    vi.restoreAllMocks();
  });

  it("singular confirm message for 1 total session", () => {
    vi.spyOn(window, "confirm").mockReturnValue(false);
    render(
      <TerminalTabBar
        {...defaultProps}
        visibleSessionCount={1}
        totalSessionCount={1}
      />
    );
    fireEvent.click(screen.getByTitle("Hide all sessions"));
    expect(window.confirm).toHaveBeenCalledWith("Close 1 session? (Sessions will continue running in the background)");
    vi.restoreAllMocks();
  });

  it("does not show kill button on Home tab", () => {
    const { container } = render(<TerminalTabBar {...defaultProps} />);
    expect(container.querySelector(".terminal-tab-kill")).toBeNull();
  });

  it("marks Sessions tab as active when activeTabId is sessions", () => {
    const { container } = render(
      <TerminalTabBar
        {...defaultProps}
        activeTabId="sessions"
        visibleSessionCount={1}
        totalSessionCount={1}
      />
    );
    const sessionTab = container.querySelectorAll(".terminal-tab.active");
    expect(sessionTab).toHaveLength(1);
    expect(sessionTab[0].textContent).toContain("Sessions");
  });
});
