import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { resetTauriMocks } from "../../../__test-utils__/tauri-mock";
import { ActivityBar } from "../ActivityBar";

// Mock child panels so they don't render real content or invoke Tauri commands
vi.mock("../UsagePanel", () => ({
  UsagePanel: () => <div data-testid="usage-panel">UsagePanel</div>,
}));
vi.mock("../SkillsPanel", () => ({
  SkillsPanel: () => <div data-testid="skills-panel">SkillsPanel</div>,
}));
vi.mock("../ResourcesPanel", () => ({
  ResourcesPanel: () => <div data-testid="resources-panel">ResourcesPanel</div>,
}));
vi.mock("../AgentsPanel", () => ({
  AgentsPanel: () => <div data-testid="agents-panel">AgentsPanel</div>,
}));
vi.mock("../CommandsPanel", () => ({
  CommandsPanel: () => <div data-testid="commands-panel">CommandsPanel</div>,
}));
vi.mock("../PipelinesPanel", () => ({
  PipelinesPanel: () => <div data-testid="pipelines-panel">PipelinesPanel</div>,
}));

const defaultProps = {
  projectPath: "/home/user/project",
  onRunSkill: vi.fn(),
  onEditAgent: vi.fn(),
  onRunCommand: vi.fn(),
  onEditCommand: vi.fn(),
  onRunPipeline: vi.fn(),
  onEditPipeline: vi.fn(),
};

beforeEach(() => {
  resetTauriMocks();
  defaultProps.onRunSkill.mockClear();
  defaultProps.onEditAgent.mockClear();
  defaultProps.onRunCommand.mockClear();
  defaultProps.onEditCommand.mockClear();
  defaultProps.onRunPipeline.mockClear();
  defaultProps.onEditPipeline.mockClear();
  // Reset DOM and localStorage before each test
  delete document.documentElement.dataset.theme;
  localStorage.clear();
});

afterEach(() => {
  delete document.documentElement.dataset.theme;
  localStorage.clear();
});

describe("ActivityBar theme toggle", () => {
  it("renders theme toggle button with sun icon aria-label by default (dark mode)", () => {
    render(<ActivityBar {...defaultProps} />);

    const toggleBtn = screen.getByRole("button", { name: "Switch to light mode" });
    expect(toggleBtn).toBeTruthy();
  });

  it("toggle button has correct aria-label for dark mode (default)", () => {
    render(<ActivityBar {...defaultProps} />);

    const toggleBtn = screen.getByRole("button", { name: "Switch to light mode" });
    expect(toggleBtn.getAttribute("aria-label")).toBe("Switch to light mode");
  });

  it("clicking toggle switches from dark to light mode", () => {
    render(<ActivityBar {...defaultProps} />);

    const toggleBtn = screen.getByRole("button", { name: "Switch to light mode" });
    fireEvent.click(toggleBtn);

    // DOM attribute should be set to "light"
    expect(document.documentElement.dataset.theme).toBe("light");
    // localStorage should persist the choice
    expect(localStorage.getItem("reggie-theme")).toBe("light");
  });

  it("after switching to light mode, toggle shows moon icon aria-label", () => {
    render(<ActivityBar {...defaultProps} />);

    const toggleBtn = screen.getByRole("button", { name: "Switch to light mode" });
    fireEvent.click(toggleBtn);

    // After toggle, the button should now offer to switch back to dark
    const moonBtn = screen.getByRole("button", { name: "Switch to dark mode" });
    expect(moonBtn).toBeTruthy();
    expect(moonBtn.getAttribute("aria-label")).toBe("Switch to dark mode");
  });

  it("clicking toggle twice returns to dark mode", () => {
    render(<ActivityBar {...defaultProps} />);

    const toggleBtn = screen.getByRole("button", { name: "Switch to light mode" });

    // First click: dark -> light
    fireEvent.click(toggleBtn);
    expect(document.documentElement.dataset.theme).toBe("light");
    expect(localStorage.getItem("reggie-theme")).toBe("light");

    // Second click: light -> dark
    const moonBtn = screen.getByRole("button", { name: "Switch to dark mode" });
    fireEvent.click(moonBtn);

    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(localStorage.getItem("reggie-theme")).toBe("dark");

    // Button should be back to sun icon
    const sunBtn = screen.getByRole("button", { name: "Switch to light mode" });
    expect(sunBtn).toBeTruthy();
  });

  it("reads initial theme from localStorage (starts in light mode when stored)", () => {
    localStorage.setItem("reggie-theme", "light");

    render(<ActivityBar {...defaultProps} />);

    // Should start in light mode with moon icon
    const moonBtn = screen.getByRole("button", { name: "Switch to dark mode" });
    expect(moonBtn).toBeTruthy();
  });

  it("reads initial theme from localStorage (starts in dark mode when stored)", () => {
    localStorage.setItem("reggie-theme", "dark");

    render(<ActivityBar {...defaultProps} />);

    // Should start in dark mode with sun icon
    const sunBtn = screen.getByRole("button", { name: "Switch to light mode" });
    expect(sunBtn).toBeTruthy();
  });

  it("defaults to dark mode when localStorage has no theme stored", () => {
    // localStorage is already clear from beforeEach
    render(<ActivityBar {...defaultProps} />);

    const sunBtn = screen.getByRole("button", { name: "Switch to light mode" });
    expect(sunBtn).toBeTruthy();
  });

  it("defaults to dark mode when localStorage has an invalid value", () => {
    localStorage.setItem("reggie-theme", "sepia");

    render(<ActivityBar {...defaultProps} />);

    // Invalid value should fall back to dark mode
    const sunBtn = screen.getByRole("button", { name: "Switch to light mode" });
    expect(sunBtn).toBeTruthy();
  });

  it("toggle button has the theme-toggle CSS class", () => {
    const { container } = render(<ActivityBar {...defaultProps} />);

    const toggleBtn = container.querySelector(".theme-toggle");
    expect(toggleBtn).toBeTruthy();
  });

  it("does not affect panel toggle behavior", () => {
    render(<ActivityBar {...defaultProps} />);

    // Click theme toggle
    const themeBtn = screen.getByRole("button", { name: "Switch to light mode" });
    fireEvent.click(themeBtn);

    // Click a panel button (Usage Stats)
    const usageBtn = screen.getByTitle("Usage Stats");
    fireEvent.click(usageBtn);

    // Panel should open
    expect(screen.getByTestId("usage-panel")).toBeTruthy();

    // Theme should still be light
    expect(document.documentElement.dataset.theme).toBe("light");
  });

  it("handles localStorage.getItem throwing an error gracefully", () => {
    const getItemSpy = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("Storage unavailable");
    });

    // Should not throw, should default to dark
    render(<ActivityBar {...defaultProps} />);

    const sunBtn = screen.getByRole("button", { name: "Switch to light mode" });
    expect(sunBtn).toBeTruthy();

    getItemSpy.mockRestore();
  });

  it("handles localStorage.setItem throwing an error gracefully", () => {
    const setItemSpy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("Storage full");
    });

    render(<ActivityBar {...defaultProps} />);

    const toggleBtn = screen.getByRole("button", { name: "Switch to light mode" });

    // Should not throw even when localStorage.setItem fails
    expect(() => fireEvent.click(toggleBtn)).not.toThrow();

    // Theme should still toggle in-memory despite storage failure
    const moonBtn = screen.getByRole("button", { name: "Switch to dark mode" });
    expect(moonBtn).toBeTruthy();

    setItemSpy.mockRestore();
  });
});

describe("ActivityBar click-outside-to-close", () => {
  it("closes open panel when clicking outside the container", () => {
    render(<ActivityBar {...defaultProps} />);
    fireEvent.click(screen.getByTitle("Usage Stats"));
    expect(screen.queryByTestId("usage-panel")).toBeTruthy();

    fireEvent.mouseDown(document.body);
    expect(screen.queryByTestId("usage-panel")).toBeNull();
  });

  it("keeps panel open when clicking inside the panel", () => {
    render(<ActivityBar {...defaultProps} />);
    fireEvent.click(screen.getByTitle("Usage Stats"));
    const panel = screen.getByTestId("usage-panel");
    expect(panel).toBeTruthy();

    fireEvent.mouseDown(panel);
    expect(screen.queryByTestId("usage-panel")).toBeTruthy();
  });

  it("keeps panel open when clicking on the icon strip", () => {
    render(<ActivityBar {...defaultProps} />);
    fireEvent.click(screen.getByTitle("Usage Stats"));
    expect(screen.queryByTestId("usage-panel")).toBeTruthy();

    // Mousedown on a different icon -- the outside handler should not fire
    // because the icon is inside containerRef. The toggle handler will switch panels.
    fireEvent.mouseDown(screen.getByTitle("Skills & Commands"));
    expect(screen.queryByTestId("usage-panel")).toBeTruthy();
  });

  it("does not error when mousedown fires with no panel open", () => {
    render(<ActivityBar {...defaultProps} />);
    // No panel is open, so the effect listener should not be attached.
    expect(() => {
      fireEvent.mouseDown(document.body);
    }).not.toThrow();
  });

  it("removes listener after panel is closed by toggle", () => {
    const addSpy = vi.spyOn(document, "addEventListener");
    const removeSpy = vi.spyOn(document, "removeEventListener");

    render(<ActivityBar {...defaultProps} />);

    // Open panel -- should add listener
    fireEvent.click(screen.getByTitle("Usage Stats"));
    const addCallCount = addSpy.mock.calls.filter(
      ([event]) => event === "mousedown"
    ).length;
    expect(addCallCount).toBeGreaterThanOrEqual(1);

    // Close panel via toggle -- should remove listener
    fireEvent.click(screen.getByTitle("Usage Stats"));
    const removeCallCount = removeSpy.mock.calls.filter(
      ([event]) => event === "mousedown"
    ).length;
    expect(removeCallCount).toBeGreaterThanOrEqual(1);

    addSpy.mockRestore();
    removeSpy.mockRestore();
  });

  it("closes panel on outside click after switching panels", () => {
    render(<ActivityBar {...defaultProps} />);
    // Open usage, then switch to resources
    fireEvent.click(screen.getByTitle("Usage Stats"));
    fireEvent.click(screen.getByTitle("Resources & Learning"));
    expect(screen.queryByTestId("resources-panel")).toBeTruthy();

    // Click outside should close the currently open panel
    fireEvent.mouseDown(document.body);
    expect(screen.queryByTestId("resources-panel")).toBeNull();
    expect(screen.queryByTestId("usage-panel")).toBeNull();
  });

  it("removes active class when panel is closed via outside click", () => {
    render(<ActivityBar {...defaultProps} />);
    const btn = screen.getByTitle("Usage Stats");
    fireEvent.click(btn);
    expect(btn.className).toContain("active");

    fireEvent.mouseDown(document.body);
    expect(btn.className).not.toContain("active");
  });
});

describe("ActivityBar onThemeChange callback", () => {
  it("calls onThemeChange with 'light' when toggling from dark to light", () => {
    const onThemeChange = vi.fn();
    render(<ActivityBar {...defaultProps} onThemeChange={onThemeChange} />);

    const toggleBtn = screen.getByRole("button", { name: "Switch to light mode" });
    fireEvent.click(toggleBtn);

    expect(onThemeChange).toHaveBeenCalledTimes(1);
    expect(onThemeChange).toHaveBeenCalledWith("light");
  });

  it("calls onThemeChange with 'dark' when toggling from light to dark", () => {
    const onThemeChange = vi.fn();
    localStorage.setItem("reggie-theme", "light");
    render(<ActivityBar {...defaultProps} onThemeChange={onThemeChange} />);

    const toggleBtn = screen.getByRole("button", { name: "Switch to dark mode" });
    fireEvent.click(toggleBtn);

    expect(onThemeChange).toHaveBeenCalledTimes(1);
    expect(onThemeChange).toHaveBeenCalledWith("dark");
  });

  it("calls onThemeChange on each toggle in sequence", () => {
    const onThemeChange = vi.fn();
    render(<ActivityBar {...defaultProps} onThemeChange={onThemeChange} />);

    // dark -> light
    fireEvent.click(screen.getByRole("button", { name: "Switch to light mode" }));
    expect(onThemeChange).toHaveBeenCalledWith("light");

    // light -> dark
    fireEvent.click(screen.getByRole("button", { name: "Switch to dark mode" }));
    expect(onThemeChange).toHaveBeenCalledWith("dark");

    expect(onThemeChange).toHaveBeenCalledTimes(2);
  });

  it("does not crash when onThemeChange is not provided", () => {
    // defaultProps does not include onThemeChange
    render(<ActivityBar {...defaultProps} />);

    const toggleBtn = screen.getByRole("button", { name: "Switch to light mode" });

    // Should toggle without error even without the callback
    expect(() => fireEvent.click(toggleBtn)).not.toThrow();

    // Theme should still toggle in the DOM
    expect(document.documentElement.dataset.theme).toBe("light");
  });
});
