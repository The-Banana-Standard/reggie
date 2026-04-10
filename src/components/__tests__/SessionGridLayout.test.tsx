import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import * as fs from "node:fs";
import * as path from "node:path";
import type { TerminalTab } from "../../types/terminal";

/**
 * Minimal test component that replicates the session grid card rendering
 * logic from App.tsx (lines ~420-498: terminal-panels container with stable
 * card wrappers, offscreen/grid-mode classes, session-grid-card rendering
 * with conditional header based on isSessionsActive + tab.visible).
 *
 * Key change from old ternary pattern: every tab ALWAYS gets a
 * session-grid-card wrapper div. Hidden tabs get display:none. Headers
 * only render when the sessions tab is active AND the tab is visible.
 * This prevents React reconciliation from unmounting/remounting terminals.
 */
function SessionGridLayout({
  terminalTabs,
  isSessionsActive,
  expandedTerminalId,
  onExpand,
  onMinimize,
  onKill,
  onClose,
}: {
  terminalTabs: TerminalTab[];
  isSessionsActive: boolean;
  expandedTerminalId: string | null;
  onExpand: (tabId: string) => void;
  onMinimize: () => void;
  onKill: (tabId: string) => void;
  onClose: (tabId: string) => void;
}) {
  const visibleCount = terminalTabs.filter((t) => t.visible !== false).length;
  const gridClass = visibleCount === 1 ? "sessions-1"
    : visibleCount === 2 ? "sessions-2"
    : visibleCount === 3 ? "sessions-3"
    : "sessions-4-plus";

  const panelClasses = [
    "terminal-panels",
    isSessionsActive && "grid-mode",
    isSessionsActive && gridClass,
    !isSessionsActive && "offscreen",
  ].filter(Boolean).join(" ");

  return (
    <div
      className={panelClasses}
      data-testid="terminal-panels"
    >
      {terminalTabs.map((tab) => {
        const isTabVisible = isSessionsActive && tab.visible !== false;
        const isExpanded = expandedTerminalId === tab.id;

        return (
          <div
            key={tab.id}
            className={`session-grid-card${isExpanded ? " expanded" : ""}${tab.dead ? " dead" : ""}`}
            style={tab.visible === false ? { display: "none" } : undefined}
            data-testid={`grid-card-${tab.id}`}
          >
            {isTabVisible && (
              <div className="session-grid-card-header">
                <span className="session-grid-card-icon">
                  {tab.isClaudeSession ? ">" : "$"}
                </span>
                <span className="session-grid-card-label">{tab.label}</span>
                <div className="session-grid-card-actions">
                  {isExpanded ? (
                    <button
                      className="session-grid-card-btn"
                      onClick={onMinimize}
                      title="Minimize"
                      aria-label="Minimize terminal"
                    >
                      &#x2013;
                    </button>
                  ) : (
                    <button
                      className="session-grid-card-btn expand-btn"
                      onClick={() => onExpand(tab.id)}
                      title="Expand"
                      aria-label="Expand terminal"
                    >
                      &#x2922;
                    </button>
                  )}
                  <button
                    className="session-grid-card-kill"
                    onClick={() => onKill(tab.id)}
                    title="Kill process"
                    aria-label="Kill terminal process"
                  >
                    &times;
                  </button>
                  <button
                    className="session-grid-card-btn close-btn"
                    onClick={() => onClose(tab.id)}
                    title="Close (hide, keep running)"
                    aria-label="Close terminal (keeps running in background)"
                  >
                    x
                  </button>
                </div>
              </div>
            )}
            <div data-testid={`terminal-placeholder-${tab.id}`} />
          </div>
        );
      })}
    </div>
  );
}

const makeTab = (overrides: Partial<TerminalTab> & { id: string }): TerminalTab => ({
  terminalId: `term-${overrides.id}`,
  label: `Tab ${overrides.id}`,
  isClaudeSession: false,
  projectPath: `/home/user/project`,
  projectName: "project",
  ...overrides,
});

const defaultCallbacks = () => ({
  onExpand: vi.fn(),
  onMinimize: vi.fn(),
  onKill: vi.fn(),
  onClose: vi.fn(),
});

describe("SessionGridLayout", () => {
  describe("panel CSS classes", () => {
    it("applies grid-mode class when isSessionsActive is true", () => {
      const tabs = [makeTab({ id: "t1" }), makeTab({ id: "t2" })];
      const { container } = render(
        <SessionGridLayout
          terminalTabs={tabs}
          isSessionsActive={true}
          expandedTerminalId={null}
          {...defaultCallbacks()}
        />
      );
      const panels = container.querySelector(".terminal-panels");
      expect(panels?.classList.contains("grid-mode")).toBe(true);
    });

    it("does not apply grid-mode class when isSessionsActive is false", () => {
      const tabs = [makeTab({ id: "t1" }), makeTab({ id: "t2" })];
      const { container } = render(
        <SessionGridLayout
          terminalTabs={tabs}
          isSessionsActive={false}
          expandedTerminalId={null}
          {...defaultCallbacks()}
        />
      );
      const panels = container.querySelector(".terminal-panels");
      expect(panels?.classList.contains("grid-mode")).toBe(false);
    });

    it("applies offscreen class when isSessionsActive is false", () => {
      const tabs = [makeTab({ id: "t1" })];
      const { container } = render(
        <SessionGridLayout
          terminalTabs={tabs}
          isSessionsActive={false}
          expandedTerminalId={null}
          {...defaultCallbacks()}
        />
      );
      const panels = container.querySelector(".terminal-panels");
      expect(panels?.classList.contains("offscreen")).toBe(true);
    });

    it("does not apply offscreen class when isSessionsActive is true", () => {
      const tabs = [makeTab({ id: "t1" })];
      const { container } = render(
        <SessionGridLayout
          terminalTabs={tabs}
          isSessionsActive={true}
          expandedTerminalId={null}
          {...defaultCallbacks()}
        />
      );
      const panels = container.querySelector(".terminal-panels");
      expect(panels?.classList.contains("offscreen")).toBe(false);
    });

    it("applies sessions-1 grid class when 1 visible tab", () => {
      const tabs = [makeTab({ id: "t1" })];
      const { container } = render(
        <SessionGridLayout
          terminalTabs={tabs}
          isSessionsActive={true}
          expandedTerminalId={null}
          {...defaultCallbacks()}
        />
      );
      const panels = container.querySelector(".terminal-panels");
      expect(panels?.classList.contains("sessions-1")).toBe(true);
    });

    it("applies sessions-2 grid class when 2 visible tabs", () => {
      const tabs = [makeTab({ id: "t1" }), makeTab({ id: "t2" })];
      const { container } = render(
        <SessionGridLayout
          terminalTabs={tabs}
          isSessionsActive={true}
          expandedTerminalId={null}
          {...defaultCallbacks()}
        />
      );
      const panels = container.querySelector(".terminal-panels");
      expect(panels?.classList.contains("sessions-2")).toBe(true);
    });

    it("applies sessions-3 grid class when 3 visible tabs", () => {
      const tabs = [makeTab({ id: "t1" }), makeTab({ id: "t2" }), makeTab({ id: "t3" })];
      const { container } = render(
        <SessionGridLayout
          terminalTabs={tabs}
          isSessionsActive={true}
          expandedTerminalId={null}
          {...defaultCallbacks()}
        />
      );
      const panels = container.querySelector(".terminal-panels");
      expect(panels?.classList.contains("sessions-3")).toBe(true);
    });

    it("applies sessions-4-plus grid class when 4+ visible tabs", () => {
      const tabs = Array.from({ length: 5 }, (_, i) => makeTab({ id: `t${i + 1}` }));
      const { container } = render(
        <SessionGridLayout
          terminalTabs={tabs}
          isSessionsActive={true}
          expandedTerminalId={null}
          {...defaultCallbacks()}
        />
      );
      const panels = container.querySelector(".terminal-panels");
      expect(panels?.classList.contains("sessions-4-plus")).toBe(true);
    });

    it("does not apply grid class when isSessionsActive is false", () => {
      const tabs = [makeTab({ id: "t1" }), makeTab({ id: "t2" })];
      const { container } = render(
        <SessionGridLayout
          terminalTabs={tabs}
          isSessionsActive={false}
          expandedTerminalId={null}
          {...defaultCallbacks()}
        />
      );
      const panels = container.querySelector(".terminal-panels");
      expect(panels?.classList.contains("sessions-2")).toBe(false);
      expect(panels?.classList.contains("sessions-1")).toBe(false);
    });

    it("counts only visible tabs for grid class (hidden tabs excluded)", () => {
      const tabs = [
        makeTab({ id: "t1" }),
        makeTab({ id: "t2", visible: false }),
        makeTab({ id: "t3" }),
      ];
      const { container } = render(
        <SessionGridLayout
          terminalTabs={tabs}
          isSessionsActive={true}
          expandedTerminalId={null}
          {...defaultCallbacks()}
        />
      );
      const panels = container.querySelector(".terminal-panels");
      // 2 visible tabs (t1 and t3), so sessions-2
      expect(panels?.classList.contains("sessions-2")).toBe(true);
    });
  });

  describe("stable card wrapper (session persistence)", () => {
    it("always renders session-grid-card for each tab regardless of isSessionsActive", () => {
      const tabs = [makeTab({ id: "t1" }), makeTab({ id: "t2" }), makeTab({ id: "t3" })];
      const { container } = render(
        <SessionGridLayout
          terminalTabs={tabs}
          isSessionsActive={false}
          expandedTerminalId={null}
          {...defaultCallbacks()}
        />
      );
      const cards = container.querySelectorAll(".session-grid-card");
      expect(cards).toHaveLength(3);
    });

    it("renders same number of cards when isSessionsActive is true", () => {
      const tabs = [makeTab({ id: "t1" }), makeTab({ id: "t2" }), makeTab({ id: "t3" })];
      const { container } = render(
        <SessionGridLayout
          terminalTabs={tabs}
          isSessionsActive={true}
          expandedTerminalId={null}
          {...defaultCallbacks()}
        />
      );
      const cards = container.querySelectorAll(".session-grid-card");
      expect(cards).toHaveLength(3);
    });

    it("terminal placeholder always exists inside card wrapper", () => {
      const tabs = [makeTab({ id: "t1" }), makeTab({ id: "t2" })];
      const { container } = render(
        <SessionGridLayout
          terminalTabs={tabs}
          isSessionsActive={false}
          expandedTerminalId={null}
          {...defaultCallbacks()}
        />
      );
      // Even when sessions tab is not active, placeholder divs exist
      expect(screen.getByTestId("terminal-placeholder-t1")).toBeTruthy();
      expect(screen.getByTestId("terminal-placeholder-t2")).toBeTruthy();
      // And they are inside the card wrappers
      const card1 = screen.getByTestId("grid-card-t1");
      expect(card1.querySelector("[data-testid='terminal-placeholder-t1']")).toBeTruthy();
    });

    it("card wrapper persists when switching isSessionsActive from true to false", () => {
      const tabs = [makeTab({ id: "t1" })];
      const { container, rerender } = render(
        <SessionGridLayout
          terminalTabs={tabs}
          isSessionsActive={true}
          expandedTerminalId={null}
          {...defaultCallbacks()}
        />
      );
      const cardBefore = screen.getByTestId("grid-card-t1");
      expect(cardBefore).toBeTruthy();

      rerender(
        <SessionGridLayout
          terminalTabs={tabs}
          isSessionsActive={false}
          expandedTerminalId={null}
          {...defaultCallbacks()}
        />
      );
      const cardAfter = screen.getByTestId("grid-card-t1");
      expect(cardAfter).toBeTruthy();
      // Same DOM element — React reused it because the tree structure is stable
      expect(cardBefore).toBe(cardAfter);
    });

    it("terminal placeholder persists across isSessionsActive toggle (same DOM node)", () => {
      const tabs = [makeTab({ id: "t1" })];
      const { rerender } = render(
        <SessionGridLayout
          terminalTabs={tabs}
          isSessionsActive={true}
          expandedTerminalId={null}
          {...defaultCallbacks()}
        />
      );
      const placeholderBefore = screen.getByTestId("terminal-placeholder-t1");

      rerender(
        <SessionGridLayout
          terminalTabs={tabs}
          isSessionsActive={false}
          expandedTerminalId={null}
          {...defaultCallbacks()}
        />
      );
      const placeholderAfter = screen.getByTestId("terminal-placeholder-t1");
      expect(placeholderBefore).toBe(placeholderAfter);
    });

    it("card wrapper persists across full round-trip: true -> false -> true", () => {
      const tabs = [makeTab({ id: "t1" })];
      const callbacks = defaultCallbacks();
      const { rerender } = render(
        <SessionGridLayout
          terminalTabs={tabs}
          isSessionsActive={true}
          expandedTerminalId={null}
          {...callbacks}
        />
      );
      const cardOriginal = screen.getByTestId("grid-card-t1");
      const placeholderOriginal = screen.getByTestId("terminal-placeholder-t1");

      // Switch away from sessions tab
      rerender(
        <SessionGridLayout
          terminalTabs={tabs}
          isSessionsActive={false}
          expandedTerminalId={null}
          {...callbacks}
        />
      );

      // Switch back to sessions tab
      rerender(
        <SessionGridLayout
          terminalTabs={tabs}
          isSessionsActive={true}
          expandedTerminalId={null}
          {...callbacks}
        />
      );
      const cardAfterRoundTrip = screen.getByTestId("grid-card-t1");
      const placeholderAfterRoundTrip = screen.getByTestId("terminal-placeholder-t1");

      // Same DOM nodes throughout — no unmount/remount
      expect(cardOriginal).toBe(cardAfterRoundTrip);
      expect(placeholderOriginal).toBe(placeholderAfterRoundTrip);
    });

    it("all tabs maintain DOM identity in a multi-tab scenario across toggle", () => {
      const tabs = [
        makeTab({ id: "t1", isClaudeSession: true }),
        makeTab({ id: "t2", isClaudeSession: false }),
        makeTab({ id: "t3", isClaudeSession: true }),
      ];
      const callbacks = defaultCallbacks();
      const { rerender } = render(
        <SessionGridLayout
          terminalTabs={tabs}
          isSessionsActive={true}
          expandedTerminalId={null}
          {...callbacks}
        />
      );
      const cardsBefore = {
        t1: screen.getByTestId("grid-card-t1"),
        t2: screen.getByTestId("grid-card-t2"),
        t3: screen.getByTestId("grid-card-t3"),
      };
      const placeholdersBefore = {
        t1: screen.getByTestId("terminal-placeholder-t1"),
        t2: screen.getByTestId("terminal-placeholder-t2"),
        t3: screen.getByTestId("terminal-placeholder-t3"),
      };

      rerender(
        <SessionGridLayout
          terminalTabs={tabs}
          isSessionsActive={false}
          expandedTerminalId={null}
          {...callbacks}
        />
      );

      expect(screen.getByTestId("grid-card-t1")).toBe(cardsBefore.t1);
      expect(screen.getByTestId("grid-card-t2")).toBe(cardsBefore.t2);
      expect(screen.getByTestId("grid-card-t3")).toBe(cardsBefore.t3);
      expect(screen.getByTestId("terminal-placeholder-t1")).toBe(placeholdersBefore.t1);
      expect(screen.getByTestId("terminal-placeholder-t2")).toBe(placeholdersBefore.t2);
      expect(screen.getByTestId("terminal-placeholder-t3")).toBe(placeholdersBefore.t3);
    });
  });

  describe("hidden tabs (visible: false)", () => {
    it("applies display:none style to hidden tabs", () => {
      const tabs = [makeTab({ id: "t1", visible: false })];
      render(
        <SessionGridLayout
          terminalTabs={tabs}
          isSessionsActive={true}
          expandedTerminalId={null}
          {...defaultCallbacks()}
        />
      );
      const card = screen.getByTestId("grid-card-t1");
      expect(card.style.display).toBe("none");
    });

    it("does not apply display:none to visible tabs", () => {
      const tabs = [makeTab({ id: "t1" })];
      render(
        <SessionGridLayout
          terminalTabs={tabs}
          isSessionsActive={true}
          expandedTerminalId={null}
          {...defaultCallbacks()}
        />
      );
      const card = screen.getByTestId("grid-card-t1");
      expect(card.style.display).toBe("");
    });

    it("does not apply display:none when visible is explicitly true", () => {
      const tabs = [makeTab({ id: "t1", visible: true })];
      render(
        <SessionGridLayout
          terminalTabs={tabs}
          isSessionsActive={true}
          expandedTerminalId={null}
          {...defaultCallbacks()}
        />
      );
      const card = screen.getByTestId("grid-card-t1");
      expect(card.style.display).toBe("");
    });

    it("does not render header for hidden tabs even when sessions tab is active", () => {
      const tabs = [makeTab({ id: "t1", visible: false, label: "Hidden Tab" })];
      const { container } = render(
        <SessionGridLayout
          terminalTabs={tabs}
          isSessionsActive={true}
          expandedTerminalId={null}
          {...defaultCallbacks()}
        />
      );
      // Card exists but header does not
      expect(screen.getByTestId("grid-card-t1")).toBeTruthy();
      expect(container.querySelector(".session-grid-card-header")).toBeNull();
    });

    it("still renders terminal placeholder for hidden tabs", () => {
      const tabs = [makeTab({ id: "t1", visible: false })];
      render(
        <SessionGridLayout
          terminalTabs={tabs}
          isSessionsActive={true}
          expandedTerminalId={null}
          {...defaultCallbacks()}
        />
      );
      expect(screen.getByTestId("terminal-placeholder-t1")).toBeTruthy();
    });

    it("renders mix of visible and hidden tabs correctly", () => {
      const tabs = [
        makeTab({ id: "t1", label: "Visible 1" }),
        makeTab({ id: "t2", visible: false, label: "Hidden" }),
        makeTab({ id: "t3", label: "Visible 2" }),
      ];
      const { container } = render(
        <SessionGridLayout
          terminalTabs={tabs}
          isSessionsActive={true}
          expandedTerminalId={null}
          {...defaultCallbacks()}
        />
      );
      // All 3 cards exist
      const cards = container.querySelectorAll(".session-grid-card");
      expect(cards).toHaveLength(3);

      // Only visible tabs have headers
      const headers = container.querySelectorAll(".session-grid-card-header");
      expect(headers).toHaveLength(2);

      // Hidden tab has display:none
      const hiddenCard = screen.getByTestId("grid-card-t2");
      expect(hiddenCard.style.display).toBe("none");

      // Visible tabs do not
      expect(screen.getByTestId("grid-card-t1").style.display).toBe("");
      expect(screen.getByTestId("grid-card-t3").style.display).toBe("");

      // All placeholders exist
      expect(screen.getByTestId("terminal-placeholder-t1")).toBeTruthy();
      expect(screen.getByTestId("terminal-placeholder-t2")).toBeTruthy();
      expect(screen.getByTestId("terminal-placeholder-t3")).toBeTruthy();
    });
  });

  describe("card header conditional rendering", () => {
    it("renders header when isSessionsActive is true and tab is visible", () => {
      const tabs = [makeTab({ id: "t1", label: "My Session" })];
      const { container } = render(
        <SessionGridLayout
          terminalTabs={tabs}
          isSessionsActive={true}
          expandedTerminalId={null}
          {...defaultCallbacks()}
        />
      );
      expect(container.querySelector(".session-grid-card-header")).toBeTruthy();
      expect(screen.getByText("My Session")).toBeTruthy();
    });

    it("does not render header when isSessionsActive is false", () => {
      const tabs = [makeTab({ id: "t1", label: "My Session" })];
      const { container } = render(
        <SessionGridLayout
          terminalTabs={tabs}
          isSessionsActive={false}
          expandedTerminalId={null}
          {...defaultCallbacks()}
        />
      );
      expect(container.querySelector(".session-grid-card-header")).toBeNull();
      expect(screen.queryByText("My Session")).toBeNull();
    });

    it("does not render header for hidden tab when isSessionsActive is true", () => {
      const tabs = [makeTab({ id: "t1", visible: false, label: "Hidden" })];
      const { container } = render(
        <SessionGridLayout
          terminalTabs={tabs}
          isSessionsActive={true}
          expandedTerminalId={null}
          {...defaultCallbacks()}
        />
      );
      expect(container.querySelector(".session-grid-card-header")).toBeNull();
    });

    it("no buttons are rendered when isSessionsActive is false", () => {
      const tabs = [makeTab({ id: "t1" })];
      render(
        <SessionGridLayout
          terminalTabs={tabs}
          isSessionsActive={false}
          expandedTerminalId={null}
          {...defaultCallbacks()}
        />
      );
      expect(screen.queryByLabelText("Expand terminal")).toBeNull();
      expect(screen.queryByLabelText("Kill terminal process")).toBeNull();
      expect(screen.queryByLabelText("Close terminal (keeps running in background)")).toBeNull();
    });
  });

  describe("card header icons", () => {
    it("shows > icon for Claude sessions", () => {
      const tabs = [makeTab({ id: "t1", isClaudeSession: true, label: "Claude Tab" })];
      const { container } = render(
        <SessionGridLayout
          terminalTabs={tabs}
          isSessionsActive={true}
          expandedTerminalId={null}
          {...defaultCallbacks()}
        />
      );
      const icon = container.querySelector(".session-grid-card-icon");
      expect(icon?.textContent).toBe(">");
    });

    it("shows $ icon for shell sessions", () => {
      const tabs = [makeTab({ id: "t1", isClaudeSession: false, label: "Shell Tab" })];
      const { container } = render(
        <SessionGridLayout
          terminalTabs={tabs}
          isSessionsActive={true}
          expandedTerminalId={null}
          {...defaultCallbacks()}
        />
      );
      const icon = container.querySelector(".session-grid-card-icon");
      expect(icon?.textContent).toBe("$");
    });
  });

  describe("card header label", () => {
    it("displays the tab label in the card header", () => {
      const tabs = [makeTab({ id: "t1", label: "My Project" })];
      render(
        <SessionGridLayout
          terminalTabs={tabs}
          isSessionsActive={true}
          expandedTerminalId={null}
          {...defaultCallbacks()}
        />
      );
      expect(screen.getByText("My Project")).toBeTruthy();
    });
  });

  describe("expand and minimize buttons", () => {
    it("shows expand button when card is not expanded", () => {
      const tabs = [makeTab({ id: "t1" })];
      render(
        <SessionGridLayout
          terminalTabs={tabs}
          isSessionsActive={true}
          expandedTerminalId={null}
          {...defaultCallbacks()}
        />
      );
      expect(screen.getByLabelText("Expand terminal")).toBeTruthy();
      expect(screen.queryByLabelText("Minimize terminal")).toBeNull();
    });

    it("shows minimize button when card is expanded", () => {
      const tabs = [makeTab({ id: "t1" })];
      render(
        <SessionGridLayout
          terminalTabs={tabs}
          isSessionsActive={true}
          expandedTerminalId="t1"
          {...defaultCallbacks()}
        />
      );
      expect(screen.getByLabelText("Minimize terminal")).toBeTruthy();
      expect(screen.queryByLabelText("Expand terminal")).toBeNull();
    });

    it("shows expand on non-expanded cards and minimize on expanded card", () => {
      const tabs = [makeTab({ id: "t1" }), makeTab({ id: "t2" }), makeTab({ id: "t3" })];
      render(
        <SessionGridLayout
          terminalTabs={tabs}
          isSessionsActive={true}
          expandedTerminalId="t2"
          {...defaultCallbacks()}
        />
      );
      const expandButtons = screen.getAllByLabelText("Expand terminal");
      const minimizeButtons = screen.getAllByLabelText("Minimize terminal");
      expect(expandButtons).toHaveLength(2);
      expect(minimizeButtons).toHaveLength(1);
    });
  });

  describe("expanded class", () => {
    it("applies expanded class to the expanded card", () => {
      const tabs = [makeTab({ id: "t1" }), makeTab({ id: "t2" })];
      render(
        <SessionGridLayout
          terminalTabs={tabs}
          isSessionsActive={true}
          expandedTerminalId="t1"
          {...defaultCallbacks()}
        />
      );
      const card1 = screen.getByTestId("grid-card-t1");
      const card2 = screen.getByTestId("grid-card-t2");
      expect(card1.classList.contains("expanded")).toBe(true);
      expect(card2.classList.contains("expanded")).toBe(false);
    });

    it("does not apply expanded class when no card is expanded", () => {
      const tabs = [makeTab({ id: "t1" }), makeTab({ id: "t2" })];
      const { container } = render(
        <SessionGridLayout
          terminalTabs={tabs}
          isSessionsActive={true}
          expandedTerminalId={null}
          {...defaultCallbacks()}
        />
      );
      const expandedCards = container.querySelectorAll(".session-grid-card.expanded");
      expect(expandedCards).toHaveLength(0);
    });

    it("does not apply expanded class when expandedTerminalId refers to a tab not in terminalTabs", () => {
      const tabs = [makeTab({ id: "t1" }), makeTab({ id: "t2" })];
      const { container } = render(
        <SessionGridLayout
          terminalTabs={tabs}
          isSessionsActive={true}
          expandedTerminalId="nonexistent-tab"
          {...defaultCallbacks()}
        />
      );
      const expandedCards = container.querySelectorAll(".session-grid-card.expanded");
      expect(expandedCards).toHaveLength(0);
    });

    it("card wrapper still exists when isSessionsActive is false even if expandedTerminalId is set", () => {
      const tabs = [makeTab({ id: "t1" }), makeTab({ id: "t2" })];
      const { container } = render(
        <SessionGridLayout
          terminalTabs={tabs}
          isSessionsActive={false}
          expandedTerminalId="t1"
          {...defaultCallbacks()}
        />
      );
      // Cards always exist now (stable wrapper)
      const cards = container.querySelectorAll(".session-grid-card");
      expect(cards).toHaveLength(2);
      // Expanded class still applies (it's based on expandedTerminalId, not isSessionsActive)
      const expandedCards = container.querySelectorAll(".session-grid-card.expanded");
      expect(expandedCards).toHaveLength(1);
    });
  });

  describe("dead tab class", () => {
    it("applies dead class to tabs with dead flag", () => {
      const tabs = [makeTab({ id: "t1", dead: true })];
      render(
        <SessionGridLayout
          terminalTabs={tabs}
          isSessionsActive={true}
          expandedTerminalId={null}
          {...defaultCallbacks()}
        />
      );
      const card = screen.getByTestId("grid-card-t1");
      expect(card.classList.contains("dead")).toBe(true);
    });

    it("does not apply dead class to tabs without dead flag", () => {
      const tabs = [makeTab({ id: "t1" })];
      render(
        <SessionGridLayout
          terminalTabs={tabs}
          isSessionsActive={true}
          expandedTerminalId={null}
          {...defaultCallbacks()}
        />
      );
      const card = screen.getByTestId("grid-card-t1");
      expect(card.classList.contains("dead")).toBe(false);
    });

    it("applies dead class to tabs with dead=false as falsy", () => {
      const tabs = [makeTab({ id: "t1", dead: false })];
      render(
        <SessionGridLayout
          terminalTabs={tabs}
          isSessionsActive={true}
          expandedTerminalId={null}
          {...defaultCallbacks()}
        />
      );
      const card = screen.getByTestId("grid-card-t1");
      expect(card.classList.contains("dead")).toBe(false);
    });

    it("combines expanded and dead classes correctly", () => {
      const tabs = [makeTab({ id: "t1", dead: true })];
      render(
        <SessionGridLayout
          terminalTabs={tabs}
          isSessionsActive={true}
          expandedTerminalId="t1"
          {...defaultCallbacks()}
        />
      );
      const card = screen.getByTestId("grid-card-t1");
      expect(card.classList.contains("dead")).toBe(true);
      expect(card.classList.contains("expanded")).toBe(true);
    });
  });

  describe("button callbacks", () => {
    it("calls onExpand with tab id when expand button clicked", () => {
      const callbacks = defaultCallbacks();
      const tabs = [makeTab({ id: "t1" }), makeTab({ id: "t2" })];
      render(
        <SessionGridLayout
          terminalTabs={tabs}
          isSessionsActive={true}
          expandedTerminalId={null}
          {...callbacks}
        />
      );
      const expandButtons = screen.getAllByLabelText("Expand terminal");
      fireEvent.click(expandButtons[1]);
      expect(callbacks.onExpand).toHaveBeenCalledWith("t2");
    });

    it("calls onMinimize when minimize button clicked", () => {
      const callbacks = defaultCallbacks();
      const tabs = [makeTab({ id: "t1" })];
      render(
        <SessionGridLayout
          terminalTabs={tabs}
          isSessionsActive={true}
          expandedTerminalId="t1"
          {...callbacks}
        />
      );
      fireEvent.click(screen.getByLabelText("Minimize terminal"));
      expect(callbacks.onMinimize).toHaveBeenCalled();
    });

    it("calls onKill with tab id when kill button clicked", () => {
      const callbacks = defaultCallbacks();
      const tabs = [makeTab({ id: "t1" })];
      render(
        <SessionGridLayout
          terminalTabs={tabs}
          isSessionsActive={true}
          expandedTerminalId={null}
          {...callbacks}
        />
      );
      fireEvent.click(screen.getByLabelText("Kill terminal process"));
      expect(callbacks.onKill).toHaveBeenCalledWith("t1");
    });

    it("calls onClose with tab id when close button clicked", () => {
      const callbacks = defaultCallbacks();
      const tabs = [makeTab({ id: "t1" })];
      render(
        <SessionGridLayout
          terminalTabs={tabs}
          isSessionsActive={true}
          expandedTerminalId={null}
          {...callbacks}
        />
      );
      fireEvent.click(screen.getByLabelText("Close terminal (keeps running in background)"));
      expect(callbacks.onClose).toHaveBeenCalledWith("t1");
    });

    it("kill and close buttons are present and functional on an expanded card", () => {
      const callbacks = defaultCallbacks();
      const tabs = [makeTab({ id: "t1" }), makeTab({ id: "t2" })];
      render(
        <SessionGridLayout
          terminalTabs={tabs}
          isSessionsActive={true}
          expandedTerminalId="t1"
          {...callbacks}
        />
      );
      const expandedCard = screen.getByTestId("grid-card-t1");
      expect(expandedCard.classList.contains("expanded")).toBe(true);

      // Verify kill and close buttons exist within the expanded card
      const killBtn = expandedCard.querySelector(".session-grid-card-kill") as HTMLElement;
      const closeBtn = expandedCard.querySelector(".close-btn") as HTMLElement;
      expect(killBtn).toBeTruthy();
      expect(closeBtn).toBeTruthy();

      // Verify they fire the correct callbacks
      fireEvent.click(killBtn);
      expect(callbacks.onKill).toHaveBeenCalledWith("t1");

      fireEvent.click(closeBtn);
      expect(callbacks.onClose).toHaveBeenCalledWith("t1");
    });
  });

  describe("mixed session types", () => {
    it("renders correct icons for mixed Claude and shell tabs", () => {
      const tabs = [
        makeTab({ id: "t1", isClaudeSession: true, label: "Claude 1" }),
        makeTab({ id: "t2", isClaudeSession: false, label: "Shell 1" }),
        makeTab({ id: "t3", isClaudeSession: true, label: "Claude 2" }),
      ];
      const { container } = render(
        <SessionGridLayout
          terminalTabs={tabs}
          isSessionsActive={true}
          expandedTerminalId={null}
          {...defaultCallbacks()}
        />
      );
      const icons = container.querySelectorAll(".session-grid-card-icon");
      expect(icons[0].textContent).toBe(">");
      expect(icons[1].textContent).toBe("$");
      expect(icons[2].textContent).toBe(">");
    });
  });

  describe("4+ tabs in grid", () => {
    it("renders all 4 session-grid-cards when given 4 tabs", () => {
      const tabs = [
        makeTab({ id: "t1" }),
        makeTab({ id: "t2" }),
        makeTab({ id: "t3" }),
        makeTab({ id: "t4" }),
      ];
      const { container } = render(
        <SessionGridLayout
          terminalTabs={tabs}
          isSessionsActive={true}
          expandedTerminalId={null}
          {...defaultCallbacks()}
        />
      );
      const cards = container.querySelectorAll(".session-grid-card");
      expect(cards).toHaveLength(4);
    });

    it("renders all 6 session-grid-cards when given 6 tabs", () => {
      const tabs = Array.from({ length: 6 }, (_, i) =>
        makeTab({ id: `t${i + 1}` })
      );
      const { container } = render(
        <SessionGridLayout
          terminalTabs={tabs}
          isSessionsActive={true}
          expandedTerminalId={null}
          {...defaultCallbacks()}
        />
      );
      const cards = container.querySelectorAll(".session-grid-card");
      expect(cards).toHaveLength(6);
    });
  });

  describe("empty state", () => {
    it("renders no grid cards when terminalTabs is empty", () => {
      const { container } = render(
        <SessionGridLayout
          terminalTabs={[]}
          isSessionsActive={true}
          expandedTerminalId={null}
          {...defaultCallbacks()}
        />
      );
      const cards = container.querySelectorAll(".session-grid-card");
      expect(cards).toHaveLength(0);
    });
  });

  describe("structural contract: App.tsx stable card wrapper", () => {
    // Read App.tsx source once for all contract tests
    const appSrc = fs.readFileSync(
      path.resolve(__dirname, "../../App.tsx"),
      "utf-8"
    );

    // Extract the terminalTabs.map(...) block from App.tsx
    const mapStartIndex = appSrc.indexOf("terminalTabs.map((tab)");
    const mapBlock = mapStartIndex !== -1 ? appSrc.slice(mapStartIndex, mapStartIndex + 3000) : "";

    it("App.tsx contains the terminalTabs.map block", () => {
      expect(mapStartIndex).not.toBe(-1);
    });

    it("App.tsx wraps every tab in a session-grid-card div (no bare TerminalView return)", () => {
      // The fix ensures every tab path returns a <div className="session-grid-card...">.
      // The old bug had a ternary returning either <div className="session-grid-card"> or bare <TerminalView>.
      // If someone reverts to the ternary, this block will contain a pattern like:
      //   `) : (\n  <TerminalView` (bare TerminalView as alternate branch)
      // We check that TerminalView is always inside session-grid-card, never a direct return.

      // There should be exactly one "return (" inside the map — a stable wrapper for all tabs
      const returnMatches = mapBlock.match(/return\s*\(/g);
      expect(returnMatches).toBeTruthy();
      expect(returnMatches!.length).toBe(1);
    });

    it("App.tsx does not use a ternary to switch between wrapper div and bare TerminalView", () => {
      // The old pattern: `? (<div className="session-grid-card">...) : (<TerminalView`
      // After fix: single return path with <div> wrapper always containing <TerminalView>
      const hasBareTerminalViewBranch = /\)\s*:\s*\(\s*<TerminalView/.test(mapBlock);
      expect(hasBareTerminalViewBranch).toBe(false);
    });

    it("App.tsx renders TerminalView inside session-grid-card wrapper", () => {
      // session-grid-card appears before TerminalView in the map block
      const cardIndex = mapBlock.indexOf("session-grid-card");
      const termViewIndex = mapBlock.indexOf("<TerminalView");
      expect(cardIndex).not.toBe(-1);
      expect(termViewIndex).not.toBe(-1);
      expect(cardIndex).toBeLessThan(termViewIndex);
    });

    it("App.tsx uses display:none for hidden tabs instead of omitting wrapper", () => {
      // The fix uses style={{ display: "none" }} for visible === false tabs
      expect(mapBlock).toContain('display: "none"');
    });
  });

  describe("button titles for accessibility", () => {
    it("expand button has correct title attribute", () => {
      const tabs = [makeTab({ id: "t1" })];
      render(
        <SessionGridLayout
          terminalTabs={tabs}
          isSessionsActive={true}
          expandedTerminalId={null}
          {...defaultCallbacks()}
        />
      );
      expect(screen.getByTitle("Expand")).toBeTruthy();
    });

    it("minimize button has correct title attribute", () => {
      const tabs = [makeTab({ id: "t1" })];
      render(
        <SessionGridLayout
          terminalTabs={tabs}
          isSessionsActive={true}
          expandedTerminalId="t1"
          {...defaultCallbacks()}
        />
      );
      expect(screen.getByTitle("Minimize")).toBeTruthy();
    });

    it("kill button has correct title attribute", () => {
      const tabs = [makeTab({ id: "t1" })];
      render(
        <SessionGridLayout
          terminalTabs={tabs}
          isSessionsActive={true}
          expandedTerminalId={null}
          {...defaultCallbacks()}
        />
      );
      expect(screen.getByTitle("Kill process")).toBeTruthy();
    });

    it("close button has correct title attribute", () => {
      const tabs = [makeTab({ id: "t1" })];
      render(
        <SessionGridLayout
          terminalTabs={tabs}
          isSessionsActive={true}
          expandedTerminalId={null}
          {...defaultCallbacks()}
        />
      );
      expect(screen.getByTitle("Close (hide, keep running)")).toBeTruthy();
    });
  });
});
