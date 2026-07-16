import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useTerminal, HOME_TAB_ID, SESSIONS_TAB_ID } from "../useTerminal";
import { closeTerminal, closeHeadlessTerminal, spawnHeadlessTerminal } from "../../services/terminal-service";

// Mock terminal-service
vi.mock("../../services/terminal-service", () => ({
  closeTerminal: vi.fn(() => Promise.resolve()),
  closeHeadlessTerminal: vi.fn(() => Promise.resolve()),
  spawnHeadlessTerminal: vi.fn(() => Promise.resolve("headless-term-1")),
}));

// Capture the listen callback so we can simulate Tauri events in tests
let listenCallback: ((event: { payload: unknown }) => void) | null = null;
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn((_eventName: string, cb: (event: { payload: unknown }) => void) => {
    listenCallback = cb;
    return Promise.resolve(() => { listenCallback = null; });
  }),
}));

// Spy on crypto.randomUUID instead of replacing the entire object
let uuidCounter = 0;

beforeEach(() => {
  uuidCounter = 0;
  listenCallback = null;
  vi.spyOn(crypto, "randomUUID").mockImplementation(() => `uuid-${++uuidCounter}` as `${string}-${string}-${string}-${string}-${string}`);
  vi.mocked(closeTerminal).mockClear();
  vi.mocked(closeHeadlessTerminal).mockClear();
  vi.mocked(spawnHeadlessTerminal).mockClear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("useTerminal", () => {
  it("starts with empty tabs and HOME active", () => {
    const { result } = renderHook(() => useTerminal());
    expect(result.current.tabs).toEqual([]);
    expect(result.current.activeTabId).toBe(HOME_TAB_ID);
  });

  it("addTab creates tab with correct fields", () => {
    const { result } = renderHook(() => useTerminal());

    act(() => {
      result.current.addTab("/home/user/myproject", true);
    });

    expect(result.current.tabs).toHaveLength(1);
    const tab = result.current.tabs[0];
    expect(tab.label).toBe("myproject");
    expect(tab.projectPath).toBe("/home/user/myproject");
    expect(tab.isClaudeSession).toBe(true);
    expect(tab.terminalId).toBeNull();
    expect(tab.projectName).toBe("myproject");
  });

  it("addTab creates a distinct Codex session kind", () => {
    const { result } = renderHook(() => useTerminal());

    act(() => {
      result.current.addTab("/home/user/myproject", "codex");
    });

    const tab = result.current.tabs[0];
    expect(tab.isClaudeSession).toBe(false);
    expect(tab.isCodexSession).toBe(true);
  });

  it("numbers duplicate labels independently for Claude, Codex, and shell", () => {
    const { result } = renderHook(() => useTerminal());

    act(() => { result.current.addTab("/home/user/myproject", true); });
    act(() => { result.current.addTab("/home/user/myproject", "codex"); });
    act(() => { result.current.addTab("/home/user/myproject", false); });

    expect(result.current.tabs.map((tab) => tab.label)).toEqual([
      "myproject",
      "myproject",
      "myproject",
    ]);
  });

  it("addTab adds numeric suffix for duplicates", () => {
    const { result } = renderHook(() => useTerminal());

    act(() => {
      result.current.addTab("/home/user/myproject", true);
    });
    act(() => {
      result.current.addTab("/home/user/myproject", true);
    });

    expect(result.current.tabs[0].label).toBe("myproject");
    expect(result.current.tabs[1].label).toBe("myproject 2");
  });

  it("addTab does not change activeTabId", () => {
    const { result } = renderHook(() => useTerminal());

    act(() => {
      result.current.addTab("/home/user/proj", false);
    });

    expect(result.current.activeTabId).toBe(HOME_TAB_ID);
  });

  it("addTab with initialPrompt uses project name as label", () => {
    const { result } = renderHook(() => useTerminal());

    act(() => {
      result.current.addTab("/home/user/myproject", true, undefined, "help me fix this");
    });

    expect(result.current.tabs[0].label).toBe("myproject");
    expect(result.current.tabs[0].initialPrompt).toBe("help me fix this");
  });

  it("addTab with slash-command initialPrompt uses command as label", () => {
    const { result } = renderHook(() => useTerminal());

    act(() => {
      result.current.addTab("/home/user/myproject", true, undefined, "/review-pr");
    });

    expect(result.current.tabs[0].label).toBe("/review-pr \u2014 myproject");
  });

  it("addTab stores model and effort on the tab", () => {
    const { result } = renderHook(() => useTerminal());

    act(() => {
      result.current.addTab("/home/user/proj", true, undefined, undefined, "opus", "high");
    });

    const tab = result.current.tabs[0];
    expect(tab.model).toBe("opus");
    expect(tab.effort).toBe("high");
  });

  it("addTab defaults model and effort to undefined when not provided", () => {
    const { result } = renderHook(() => useTerminal());

    act(() => {
      result.current.addTab("/home/user/proj", true);
    });

    const tab = result.current.tabs[0];
    expect(tab.model).toBeUndefined();
    expect(tab.effort).toBeUndefined();
  });

  it("addHeadlessSession passes model and effort to spawnHeadlessTerminal", async () => {
    vi.mocked(spawnHeadlessTerminal).mockResolvedValueOnce("ht-model-1");
    const { result } = renderHook(() => useTerminal());

    await act(async () => {
      await result.current.addHeadlessSession("/proj", "claude", "Test", "sonnet", "medium");
    });

    expect(spawnHeadlessTerminal).toHaveBeenCalledWith("/proj", "claude", "sonnet", "medium");
  });

  it("addHeadlessSession omits model and effort when not provided", async () => {
    vi.mocked(spawnHeadlessTerminal).mockResolvedValueOnce("ht-no-model");
    const { result } = renderHook(() => useTerminal());

    await act(async () => {
      await result.current.addHeadlessSession("/proj", "claude", "Test");
    });

    expect(spawnHeadlessTerminal).toHaveBeenCalledWith("/proj", "claude", undefined, undefined);
  });

  it("removeTab demotes active tab to hidden without changing activeTabId", async () => {
    const { result } = renderHook(() => useTerminal());

    let tabId: string = "";
    act(() => {
      tabId = result.current.addTab("/home/user/proj", false);
    });
    act(() => {
      result.current.setActiveTabId(tabId);
    });
    expect(result.current.activeTabId).toBe(tabId);

    await act(async () => {
      await result.current.removeTab(tabId);
    });

    // Tab is demoted (hidden), not removed; activeTabId is NOT changed by removeTab
    expect(result.current.tabs).toHaveLength(1);
    expect(result.current.tabs[0].visible).toBe(false);
    expect(result.current.activeTabId).toBe(tabId);
  });

  it("removeTab demotes tab to hidden instead of killing", async () => {
    const { result } = renderHook(() => useTerminal());

    let tabId: string = "";
    act(() => {
      tabId = result.current.addTab("/home/user/proj", true);
    });
    act(() => {
      result.current.setTerminalId(tabId, "term-99");
    });

    await act(async () => {
      await result.current.removeTab(tabId);
    });

    // Tab should still exist with visible: false, not removed
    expect(result.current.tabs).toHaveLength(1);
    expect(result.current.tabs[0].visible).toBe(false);
    expect(result.current.tabs[0].terminalId).toBe("term-99");
    // closeTerminal should NOT be called -- session is demoted, not killed
    expect(closeTerminal).not.toHaveBeenCalled();
  });

  it("removeTab on HOME does nothing", async () => {
    const { result } = renderHook(() => useTerminal());

    act(() => {
      result.current.addTab("/home/user/proj", false);
    });
    const tabsBefore = result.current.tabs.length;

    await act(async () => {
      await result.current.removeTab(HOME_TAB_ID);
    });

    expect(result.current.tabs).toHaveLength(tabsBefore);
  });

  it("markTabDead sets dead flag on correct tab", () => {
    const { result } = renderHook(() => useTerminal());

    let tabId: string = "";
    act(() => {
      tabId = result.current.addTab("/home/user/proj", true);
    });

    act(() => {
      result.current.markTabDead(tabId);
    });

    expect(result.current.tabs[0].dead).toBe(true);
  });

  it("setTerminalId links terminal to tab", () => {
    const { result } = renderHook(() => useTerminal());

    let tabId: string = "";
    act(() => {
      tabId = result.current.addTab("/home/user/proj", true);
    });

    act(() => {
      result.current.setTerminalId(tabId, "term-42");
    });

    expect(result.current.tabs[0].terminalId).toBe("term-42");
  });

  it("openProjectTab creates new overview tab", () => {
    const { result } = renderHook(() => useTerminal());

    act(() => {
      result.current.openProjectTab("/home/user/proj");
    });

    expect(result.current.tabs).toHaveLength(1);
    const tab = result.current.tabs[0];
    expect(tab.isProjectOverview).toBe(true);
    expect(tab.projectPath).toBe("/home/user/proj");
    expect(tab.label).toBe("proj");
  });

  it("openProjectTab reuses existing overview", () => {
    const { result } = renderHook(() => useTerminal());

    act(() => {
      result.current.openProjectTab("/home/user/proj");
    });
    expect(result.current.tabs).toHaveLength(1);

    act(() => {
      result.current.openProjectTab("/home/user/proj");
    });
    // Should still be 1 tab, not 2
    expect(result.current.tabs).toHaveLength(1);
  });

  it("goHome sets activeTabId to HOME", () => {
    const { result } = renderHook(() => useTerminal());

    // Navigate away from home first
    act(() => {
      result.current.openProjectTab("/home/user/proj");
    });
    expect(result.current.activeTabId).not.toBe(HOME_TAB_ID);

    act(() => {
      result.current.goHome();
    });
    expect(result.current.activeTabId).toBe(HOME_TAB_ID);
  });

  it("closeAllTabs demotes all non-overview terminal tabs to hidden", async () => {
    const { result } = renderHook(() => useTerminal());

    act(() => { result.current.addTab("/proj1", true); });
    act(() => { result.current.addTab("/proj2", false); });
    act(() => { result.current.setTerminalId(result.current.tabs[0].id, "term-1"); });
    act(() => { result.current.setTerminalId(result.current.tabs[1].id, "term-2"); });
    expect(result.current.tabs).toHaveLength(2);

    act(() => {
      result.current.closeAllTabs();
    });

    // Tabs still exist but are hidden (demoted), not removed
    expect(result.current.tabs).toHaveLength(2);
    expect(result.current.tabs[0].visible).toBe(false);
    expect(result.current.tabs[1].visible).toBe(false);
    expect(result.current.activeTabId).toBe(HOME_TAB_ID);
    // closeTerminal should NOT be called -- sessions are demoted, not killed
    expect(closeTerminal).not.toHaveBeenCalled();
  });

  it("closeAllTabs preserves project overview tabs and only demotes terminal tabs", () => {
    const { result } = renderHook(() => useTerminal());

    act(() => { result.current.openProjectTab("/proj1"); });
    act(() => { result.current.addTab("/proj2", true); });
    expect(result.current.tabs).toHaveLength(2);

    act(() => {
      result.current.closeAllTabs();
    });

    // Both tabs still exist: overview is untouched, terminal tab is demoted
    expect(result.current.tabs).toHaveLength(2);
    const overview = result.current.tabs.find((t) => t.isProjectOverview);
    const terminal = result.current.tabs.find((t) => !t.isProjectOverview);
    expect(overview).toBeTruthy();
    expect(terminal!.visible).toBe(false);
  });

  it("closeAllTabs hides promoted headless tabs without killing them", async () => {
    const { result } = renderHook(() => useTerminal());

    // Add a headless session then promote it
    await act(async () => {
      await result.current.addHeadlessSession("/proj1", "claude", "Test Session");
    });
    expect(result.current.headlessSessions).toHaveLength(1);

    act(() => {
      result.current.promoteHeadlessSession("headless-term-1");
    });
    expect(result.current.tabs).toHaveLength(1);
    expect(result.current.tabs[0].isHeadlessPromoted).toBe(true);
    // Headless session persists after promotion (source of truth for status)
    expect(result.current.headlessSessions).toHaveLength(1);

    act(() => {
      result.current.closeAllTabs();
    });

    // Tab still exists but is hidden (demoted to invisible, not killed)
    expect(result.current.tabs).toHaveLength(1);
    expect(result.current.tabs[0].visible).toBe(false);
    expect(closeHeadlessTerminal).not.toHaveBeenCalled();
  });

  it("killAllTerminals kills all visible and headless terminals", async () => {
    const { result } = renderHook(() => useTerminal());

    act(() => { result.current.addTab("/proj1", true); });
    act(() => { result.current.setTerminalId(result.current.tabs[0].id, "term-1"); });

    await act(async () => {
      await result.current.addHeadlessSession("/proj2", "claude", "BG Session");
    });
    expect(result.current.headlessSessions).toHaveLength(1);

    await act(async () => {
      await result.current.killAllTerminals();
    });

    expect(result.current.tabs).toHaveLength(0);
    expect(result.current.headlessSessions).toHaveLength(0);
    expect(result.current.activeTabId).toBe(HOME_TAB_ID);
    expect(closeTerminal).toHaveBeenCalledWith("term-1");
    expect(closeHeadlessTerminal).toHaveBeenCalledWith("headless-term-1");
  });

  it("killAllTerminals kills promoted headless tabs via headless close", async () => {
    const { result } = renderHook(() => useTerminal());

    await act(async () => {
      await result.current.addHeadlessSession("/proj1", "claude", "Test");
    });
    act(() => {
      result.current.promoteHeadlessSession("headless-term-1");
    });
    expect(result.current.tabs).toHaveLength(1);

    await act(async () => {
      await result.current.killAllTerminals();
    });

    expect(result.current.tabs).toHaveLength(0);
    expect(result.current.headlessSessions).toHaveLength(0);
    expect(closeHeadlessTerminal).toHaveBeenCalledWith("headless-term-1");
  });

  it("killTab removes tab and calls closeTerminal", async () => {
    const { result } = renderHook(() => useTerminal());

    let tabId: string = "";
    act(() => {
      tabId = result.current.addTab("/home/user/proj", true);
    });
    // Manually select the tab since addTab no longer auto-switches
    act(() => {
      result.current.setActiveTabId(tabId);
    });
    act(() => {
      result.current.setTerminalId(tabId, "term-77");
    });

    await act(async () => {
      await result.current.killTab(tabId);
    });

    expect(closeTerminal).toHaveBeenCalledWith("term-77");
    expect(result.current.tabs).toHaveLength(0);
    expect(result.current.activeTabId).toBe(HOME_TAB_ID);
  });

  it("killTab on HOME does nothing", async () => {
    const { result } = renderHook(() => useTerminal());

    act(() => {
      result.current.addTab("/home/user/proj", false);
    });
    const tabsBefore = result.current.tabs.length;

    await act(async () => {
      await result.current.killTab(HOME_TAB_ID);
    });

    expect(result.current.tabs).toHaveLength(tabsBefore);
    expect(closeTerminal).not.toHaveBeenCalled();
  });

  it("killTab on tab without terminalId does not call closeTerminal", async () => {
    const { result } = renderHook(() => useTerminal());

    let tabId: string = "";
    act(() => {
      tabId = result.current.addTab("/home/user/proj", true);
    });
    // Do NOT set a terminalId -- tab.terminalId stays null

    await act(async () => {
      await result.current.killTab(tabId);
    });

    expect(closeTerminal).not.toHaveBeenCalled();
    expect(closeHeadlessTerminal).not.toHaveBeenCalled();
    expect(result.current.tabs).toHaveLength(0);
  });

  it("killTab on non-active tab does not change activeTabId", async () => {
    const { result } = renderHook(() => useTerminal());

    let tab1Id: string = "";
    let tab2Id: string = "";
    act(() => {
      tab1Id = result.current.addTab("/home/user/proj1", true);
    });
    act(() => {
      tab2Id = result.current.addTab("/home/user/proj2", true);
    });
    // Manually select tab2 (addTab no longer auto-switches)
    act(() => {
      result.current.setActiveTabId(tab2Id);
    });
    expect(result.current.activeTabId).toBe(tab2Id);

    act(() => {
      result.current.setTerminalId(tab1Id, "term-10");
    });

    await act(async () => {
      await result.current.killTab(tab1Id);
    });

    // Active tab should remain tab2, not switch to HOME
    expect(result.current.activeTabId).toBe(tab2Id);
    expect(result.current.tabs).toHaveLength(1);
    expect(result.current.tabs[0].id).toBe(tab2Id);
    expect(closeTerminal).toHaveBeenCalledWith("term-10");
  });

  it("killTab on nonexistent tabId does nothing", async () => {
    const { result } = renderHook(() => useTerminal());

    act(() => {
      result.current.addTab("/home/user/proj", true);
    });
    const tabsBefore = result.current.tabs.length;

    await act(async () => {
      await result.current.killTab("nonexistent-id");
    });

    expect(result.current.tabs).toHaveLength(tabsBefore);
    expect(closeTerminal).not.toHaveBeenCalled();
    expect(closeHeadlessTerminal).not.toHaveBeenCalled();
  });

  describe("addHeadlessSession completed field", () => {
    it("initializes completed as false", async () => {
      const { result } = renderHook(() => useTerminal());

      await act(async () => {
        await result.current.addHeadlessSession("/proj", "claude", "Test");
      });

      expect(result.current.headlessSessions).toHaveLength(1);
      expect(result.current.headlessSessions[0].completed).toBe(false);
    });
  });

  describe("trashCompletedSessions", () => {
    it("does not remove any sessions when none are completed", async () => {
      const { result } = renderHook(() => useTerminal());

      vi.mocked(spawnHeadlessTerminal)
        .mockResolvedValueOnce("ht-1")
        .mockResolvedValueOnce("ht-2");

      await act(async () => {
        await result.current.addHeadlessSession("/proj1", "claude", "Session 1");
      });
      await act(async () => {
        await result.current.addHeadlessSession("/proj2", "claude", "Session 2");
      });

      expect(result.current.headlessSessions).toHaveLength(2);

      act(() => {
        result.current.trashCompletedSessions();
      });

      expect(result.current.headlessSessions).toHaveLength(2);
      expect(closeHeadlessTerminal).not.toHaveBeenCalled();
    });

    it("removes completed sessions and calls closeHeadlessTerminal for each", async () => {
      vi.useFakeTimers();
      const { result } = renderHook(() => useTerminal());

      vi.mocked(spawnHeadlessTerminal)
        .mockResolvedValueOnce("ht-1")
        .mockResolvedValueOnce("ht-2")
        .mockResolvedValueOnce("ht-3");

      await act(async () => {
        await result.current.addHeadlessSession("/proj1", "claude", "Session 1");
      });
      await act(async () => {
        await result.current.addHeadlessSession("/proj2", "claude", "Session 2");
      });
      await act(async () => {
        await result.current.addHeadlessSession("/proj3", "claude", "Session 3");
      });

      // Advance past the 1s deferral to register the listen callback
      await act(async () => { vi.advanceTimersByTime(1100); });
      vi.useRealTimers();

      expect(listenCallback).not.toBeNull();

      // Mark ht-1 and ht-3 as completed
      act(() => {
        listenCallback!({ payload: { terminalId: "ht-1", needsAttention: false, exited: false, exitCode: null, bufferSize: 100, completed: true } });
      });
      act(() => {
        listenCallback!({ payload: { terminalId: "ht-3", needsAttention: false, exited: false, exitCode: null, bufferSize: 200, completed: true } });
      });

      expect(result.current.headlessSessions.find((s) => s.terminalId === "ht-1")?.completed).toBe(true);
      expect(result.current.headlessSessions.find((s) => s.terminalId === "ht-2")?.completed).toBe(false);
      expect(result.current.headlessSessions.find((s) => s.terminalId === "ht-3")?.completed).toBe(true);

      act(() => {
        result.current.trashCompletedSessions();
      });

      // Only ht-2 should remain
      expect(result.current.headlessSessions).toHaveLength(1);
      expect(result.current.headlessSessions[0].terminalId).toBe("ht-2");
      expect(closeHeadlessTerminal).toHaveBeenCalledWith("ht-1");
      expect(closeHeadlessTerminal).toHaveBeenCalledWith("ht-3");
      expect(closeHeadlessTerminal).not.toHaveBeenCalledWith("ht-2");
    });

    it("removes promoted tabs referencing completed headless sessions", async () => {
      vi.useFakeTimers();
      const { result } = renderHook(() => useTerminal());

      vi.mocked(spawnHeadlessTerminal)
        .mockResolvedValueOnce("ht-1")
        .mockResolvedValueOnce("ht-2");

      await act(async () => {
        await result.current.addHeadlessSession("/proj1", "claude", "Session 1");
      });
      await act(async () => {
        await result.current.addHeadlessSession("/proj2", "claude", "Session 2");
      });

      // Advance past the 1s deferral to register the listen callback
      await act(async () => { vi.advanceTimersByTime(1100); });
      vi.useRealTimers();

      // Mark ht-1 as completed via event
      act(() => {
        listenCallback!({ payload: { terminalId: "ht-1", needsAttention: false, exited: false, exitCode: null, bufferSize: 100, completed: true } });
      });

      // Promote ht-1 to a visible tab (headless entry persists as source of truth)
      act(() => {
        result.current.promoteHeadlessSession("ht-1");
      });
      expect(result.current.tabs).toHaveLength(1);
      expect(result.current.tabs[0].isHeadlessPromoted).toBe(true);
      expect(result.current.tabs[0].headlessTerminalId).toBe("ht-1");
      // Both headless sessions persist (ht-1 is promoted but stays in array)
      expect(result.current.headlessSessions).toHaveLength(2);

      // trashCompletedSessions finds ht-1 as completed and removes both
      // the headless entry and the promoted tab
      act(() => {
        result.current.trashCompletedSessions();
      });

      // ht-2 is not completed, so it stays. ht-1 and its promoted tab are removed.
      expect(result.current.headlessSessions).toHaveLength(1);
      expect(result.current.headlessSessions[0].terminalId).toBe("ht-2");
      expect(result.current.tabs).toHaveLength(0);
      expect(closeHeadlessTerminal).toHaveBeenCalledWith("ht-1");
    });

    it("removes completed tabs spawned via spawnVisibleHeadlessSession (not in headlessSessions)", async () => {
      vi.useFakeTimers();
      const { result } = renderHook(() => useTerminal());

      vi.mocked(spawnHeadlessTerminal).mockResolvedValueOnce("ht-visible-1");

      // Spawn via spawnVisibleHeadlessSession — bypasses headlessSessions
      await act(async () => {
        await result.current.spawnVisibleHeadlessSession("/proj", "claude", "Visible Session");
      });

      expect(result.current.tabs).toHaveLength(1);
      expect(result.current.tabs[0].isHeadlessPromoted).toBe(true);
      expect(result.current.tabs[0].headlessTerminalId).toBe("ht-visible-1");
      // NOT in headlessSessions
      expect(result.current.headlessSessions).toHaveLength(0);

      // Advance past the 1s deferral to register the listen callback
      await act(async () => { vi.advanceTimersByTime(1100); });
      vi.useRealTimers();

      // Mark as completed via event
      act(() => {
        listenCallback!({ payload: { terminalId: "ht-visible-1", needsAttention: false, exited: false, exitCode: null, bufferSize: 100, completed: true } });
      });

      expect(result.current.tabs[0].headlessCompleted).toBe(true);

      act(() => {
        result.current.trashCompletedSessions();
      });

      // Tab should be removed and PTY closed
      expect(result.current.tabs).toHaveLength(0);
      expect(closeHeadlessTerminal).toHaveBeenCalledWith("ht-visible-1");
    });

    it("does not double-close sessions that exist in both headlessSessions and as promoted tabs", async () => {
      vi.useFakeTimers();
      const { result } = renderHook(() => useTerminal());

      vi.mocked(spawnHeadlessTerminal)
        .mockResolvedValueOnce("ht-1")
        .mockResolvedValueOnce("ht-visible-1");

      // One via addHeadlessSession (tracked in headlessSessions)
      await act(async () => {
        await result.current.addHeadlessSession("/proj1", "claude", "Headless");
      });
      // One via spawnVisibleHeadlessSession (NOT in headlessSessions)
      await act(async () => {
        await result.current.spawnVisibleHeadlessSession("/proj2", "claude", "Visible");
      });

      await act(async () => { vi.advanceTimersByTime(1100); });
      vi.useRealTimers();

      // Mark both as completed
      act(() => {
        listenCallback!({ payload: { terminalId: "ht-1", needsAttention: false, exited: false, exitCode: null, bufferSize: 100, completed: true } });
      });
      act(() => {
        listenCallback!({ payload: { terminalId: "ht-visible-1", needsAttention: false, exited: false, exitCode: null, bufferSize: 100, completed: true } });
      });

      // Promote ht-1 to a tab
      act(() => {
        result.current.promoteHeadlessSession("ht-1");
      });

      vi.mocked(closeHeadlessTerminal).mockClear();

      act(() => {
        result.current.trashCompletedSessions();
      });

      // ht-1 closed once (from headlessSessions path), ht-visible-1 closed once (from promoted-only path)
      expect(closeHeadlessTerminal).toHaveBeenCalledWith("ht-1");
      expect(closeHeadlessTerminal).toHaveBeenCalledWith("ht-visible-1");
      expect(closeHeadlessTerminal).toHaveBeenCalledTimes(2);
      expect(result.current.tabs).toHaveLength(0);
      expect(result.current.headlessSessions).toHaveLength(0);
    });
  });

  describe("headless-terminal-status event updates completed field", () => {
    it("updates completed to true when status event has completed=true", async () => {
      vi.useFakeTimers();
      const { result } = renderHook(() => useTerminal());

      await act(async () => {
        await result.current.addHeadlessSession("/proj", "claude", "Test");
      });
      expect(result.current.headlessSessions[0].completed).toBe(false);

      // Advance past the 1s deferral to register the listener
      await act(async () => { vi.advanceTimersByTime(1100); });
      vi.useRealTimers();

      act(() => {
        listenCallback!({
          payload: {
            terminalId: "headless-term-1",
            needsAttention: false,
            exited: false,
            exitCode: null,
            bufferSize: 500,
            completed: true,
          },
        });
      });

      expect(result.current.headlessSessions[0].completed).toBe(true);
      expect(result.current.headlessSessions[0].bufferSize).toBe(500);
    });

    it("does not set completed when status event has completed=false (failed marker)", async () => {
      vi.useFakeTimers();
      const { result } = renderHook(() => useTerminal());

      await act(async () => {
        await result.current.addHeadlessSession("/proj", "claude", "Test");
      });

      await act(async () => { vi.advanceTimersByTime(1100); });
      vi.useRealTimers();

      act(() => {
        listenCallback!({
          payload: {
            terminalId: "headless-term-1",
            needsAttention: false,
            exited: false,
            exitCode: null,
            bufferSize: 300,
            completed: false,
          },
        });
      });

      expect(result.current.headlessSessions[0].completed).toBe(false);
    });
  });

  describe("trashSession", () => {
    it("removes a single session and calls closeHeadlessTerminal", async () => {
      const { result } = renderHook(() => useTerminal());

      await act(async () => {
        await result.current.addHeadlessSession("/proj", "claude", "Test");
      });
      expect(result.current.headlessSessions).toHaveLength(1);

      act(() => {
        result.current.trashSession("headless-term-1");
      });

      expect(result.current.headlessSessions).toHaveLength(0);
      expect(closeHeadlessTerminal).toHaveBeenCalledWith("headless-term-1");
    });

    it("removes promoted tab referencing the trashed terminal", async () => {
      const { result } = renderHook(() => useTerminal());

      await act(async () => {
        await result.current.addHeadlessSession("/proj", "claude", "Test");
      });

      // Promote the headless session to a visible tab
      act(() => {
        result.current.promoteHeadlessSession("headless-term-1");
      });
      expect(result.current.tabs).toHaveLength(1);
      expect(result.current.tabs[0].isHeadlessPromoted).toBe(true);
      expect(result.current.tabs[0].headlessTerminalId).toBe("headless-term-1");

      // Headless session persists after promotion (source of truth for status)
      expect(result.current.headlessSessions).toHaveLength(1);

      // trashSession should remove both the headless entry and the promoted tab
      act(() => {
        result.current.trashSession("headless-term-1");
      });

      expect(result.current.tabs).toHaveLength(0);
      expect(result.current.headlessSessions).toHaveLength(0);
      expect(closeHeadlessTerminal).toHaveBeenCalledWith("headless-term-1");
    });

    it("does not affect other sessions when trashing one", async () => {
      const { result } = renderHook(() => useTerminal());

      vi.mocked(spawnHeadlessTerminal)
        .mockResolvedValueOnce("ht-1")
        .mockResolvedValueOnce("ht-2");

      await act(async () => {
        await result.current.addHeadlessSession("/proj1", "claude", "Session 1");
      });
      await act(async () => {
        await result.current.addHeadlessSession("/proj2", "claude", "Session 2");
      });
      expect(result.current.headlessSessions).toHaveLength(2);

      act(() => {
        result.current.trashSession("ht-1");
      });

      expect(result.current.headlessSessions).toHaveLength(1);
      expect(result.current.headlessSessions[0].terminalId).toBe("ht-2");
      expect(closeHeadlessTerminal).toHaveBeenCalledWith("ht-1");
    });

    it("does nothing when terminalId does not match any session or tab", async () => {
      const { result } = renderHook(() => useTerminal());

      await act(async () => {
        await result.current.addHeadlessSession("/proj", "claude", "Test");
      });
      expect(result.current.headlessSessions).toHaveLength(1);

      act(() => {
        result.current.trashSession("nonexistent-id");
      });

      // Session should remain unaffected
      expect(result.current.headlessSessions).toHaveLength(1);
      expect(result.current.headlessSessions[0].terminalId).toBe("headless-term-1");
      // closeHeadlessTerminal is still called (fire-and-forget, no guard)
      expect(closeHeadlessTerminal).toHaveBeenCalledWith("nonexistent-id");
    });

    it("switches active tab to HOME when trashed session tab was active", async () => {
      const { result } = renderHook(() => useTerminal());

      await act(async () => {
        await result.current.addHeadlessSession("/proj", "claude", "Test");
      });

      // Promote and manually make it the active tab
      let promotedTabId: string | null = null;
      act(() => {
        promotedTabId = result.current.promoteHeadlessSession("headless-term-1");
      });
      act(() => {
        result.current.setActiveTabId(promotedTabId!);
      });
      expect(result.current.activeTabId).toBe(result.current.tabs[0].id);

      act(() => {
        result.current.trashSession("headless-term-1");
      });

      expect(result.current.tabs).toHaveLength(0);
      expect(result.current.activeTabId).toBe(HOME_TAB_ID);
    });
  });

  describe("promoteSession", () => {
    it("sets visible to true on a hidden tab", async () => {
      const { result } = renderHook(() => useTerminal());

      let tabId: string = "";
      act(() => {
        tabId = result.current.addTab("/home/user/proj", true);
      });
      await act(async () => {
        await result.current.removeTab(tabId);
      });
      expect(result.current.tabs[0].visible).toBe(false);

      act(() => {
        result.current.promoteSession(tabId);
      });

      expect(result.current.tabs[0].visible).toBe(true);
    });

    it("does not change activeTabId", async () => {
      const { result } = renderHook(() => useTerminal());

      let tabId: string = "";
      act(() => {
        tabId = result.current.addTab("/home/user/proj", true);
      });
      await act(async () => {
        await result.current.removeTab(tabId);
      });

      act(() => {
        result.current.promoteSession(tabId);
      });

      expect(result.current.activeTabId).toBe(HOME_TAB_ID);
    });

    it("is a no-op on an already visible tab", () => {
      const { result } = renderHook(() => useTerminal());

      let tabId: string = "";
      act(() => {
        tabId = result.current.addTab("/home/user/proj", true);
      });
      expect(result.current.tabs[0].visible).toBe(true);

      act(() => {
        result.current.promoteSession(tabId);
      });

      expect(result.current.tabs[0].visible).toBe(true);
    });
  });

  describe("derived session values", () => {
    it("visibleSessions filters tabs with visible !== false", async () => {
      const { result } = renderHook(() => useTerminal());

      act(() => { result.current.addTab("/proj1", true); });
      act(() => { result.current.addTab("/proj2", false); });

      expect(result.current.visibleSessions).toHaveLength(2);

      const tabId = result.current.tabs[0].id;
      await act(async () => {
        await result.current.removeTab(tabId);
      });

      expect(result.current.visibleSessions).toHaveLength(1);
      expect(result.current.visibleSessions[0].id).toBe(result.current.tabs[1].id);
    });

    it("hiddenSessions filters tabs with visible === false", async () => {
      const { result } = renderHook(() => useTerminal());

      act(() => { result.current.addTab("/proj1", true); });
      act(() => { result.current.addTab("/proj2", false); });

      expect(result.current.hiddenSessions).toHaveLength(0);

      const tabId = result.current.tabs[0].id;
      await act(async () => {
        await result.current.removeTab(tabId);
      });

      expect(result.current.hiddenSessions).toHaveLength(1);
      expect(result.current.hiddenSessions[0].id).toBe(tabId);
    });

    it("visibleSessions excludes project overview tabs", () => {
      const { result } = renderHook(() => useTerminal());

      act(() => { result.current.openProjectTab("/proj1"); });
      act(() => { result.current.addTab("/proj2", true); });

      expect(result.current.visibleSessions).toHaveLength(1);
      expect(result.current.visibleSessions[0].isClaudeSession).toBe(true);
    });

    it("totalSessionCount includes terminal tabs and headless sessions", async () => {
      const { result } = renderHook(() => useTerminal());

      expect(result.current.totalSessionCount).toBe(0);

      act(() => { result.current.addTab("/proj1", true); });
      expect(result.current.totalSessionCount).toBe(1);

      await act(async () => {
        await result.current.addHeadlessSession("/proj2", "claude", "BG");
      });
      expect(result.current.totalSessionCount).toBe(2);
    });

    it("totalSessionCount excludes project overview tabs", () => {
      const { result } = renderHook(() => useTerminal());

      act(() => { result.current.openProjectTab("/proj1"); });
      expect(result.current.totalSessionCount).toBe(0);

      act(() => { result.current.addTab("/proj2", true); });
      expect(result.current.totalSessionCount).toBe(1);
    });

});

  it("SESSIONS_TAB_ID is exported as 'sessions'", () => {
    expect(SESSIONS_TAB_ID).toBe("sessions");
  });

  it("addTab sets visible to true by default", () => {
    const { result } = renderHook(() => useTerminal());

    act(() => {
      result.current.addTab("/home/user/proj", true);
    });

    expect(result.current.tabs[0].visible).toBe(true);
  });

  it("removeTab on project overview tab removes it entirely", async () => {
    const { result } = renderHook(() => useTerminal());

    act(() => {
      result.current.openProjectTab("/home/user/proj");
    });
    const tabId = result.current.tabs[0].id;

    await act(async () => {
      await result.current.removeTab(tabId);
    });

    expect(result.current.tabs).toHaveLength(0);
  });

  it("killTab on promoted headless tab calls closeHeadlessTerminal", async () => {
    const { result } = renderHook(() => useTerminal());

    // Add a headless session first, then promote it
    await act(async () => {
      await result.current.addHeadlessSession("/home/user/proj", "/init-tasks", "init");
    });

    expect(result.current.headlessSessions).toHaveLength(1);
    const terminalId = result.current.headlessSessions[0].terminalId;

    let tabId: string | null = null;
    act(() => {
      tabId = result.current.promoteHeadlessSession(terminalId);
    });

    expect(tabId).not.toBeNull();
    expect(result.current.tabs).toHaveLength(1);
    const tab = result.current.tabs[0];
    expect(tab.isHeadlessPromoted).toBe(true);
    expect(tab.headlessTerminalId).toBe(terminalId);

    await act(async () => {
      await result.current.killTab(tabId!);
    });

    expect(closeHeadlessTerminal).toHaveBeenCalledWith(terminalId);
    expect(closeTerminal).not.toHaveBeenCalled();
    expect(result.current.tabs).toHaveLength(0);
  });

  describe("promotedHeadlessIds tracking", () => {
    it("promotedHeadlessIds starts empty", () => {
      const { result } = renderHook(() => useTerminal());
      expect(result.current.promotedHeadlessIds.size).toBe(0);
    });

    it("adds terminalId to promotedHeadlessIds when promoting a headless session", async () => {
      const { result } = renderHook(() => useTerminal());

      await act(async () => {
        await result.current.addHeadlessSession("/proj", "claude", "Test");
      });

      act(() => {
        result.current.promoteHeadlessSession("headless-term-1");
      });

      expect(result.current.promotedHeadlessIds.has("headless-term-1")).toBe(true);
      expect(result.current.promotedHeadlessIds.size).toBe(1);
    });

    it("headless session persists in headlessSessions after promotion", async () => {
      const { result } = renderHook(() => useTerminal());

      await act(async () => {
        await result.current.addHeadlessSession("/proj", "claude", "Test");
      });
      expect(result.current.headlessSessions).toHaveLength(1);

      act(() => {
        result.current.promoteHeadlessSession("headless-term-1");
      });

      // Headless session is NOT removed -- it persists as source of truth for status
      expect(result.current.headlessSessions).toHaveLength(1);
      expect(result.current.headlessSessions[0].terminalId).toBe("headless-term-1");
      // And a tab was created
      expect(result.current.tabs).toHaveLength(1);
      expect(result.current.tabs[0].isHeadlessPromoted).toBe(true);
    });

    it("killTab on promoted headless removes from both headlessSessions and promotedHeadlessIds", async () => {
      const { result } = renderHook(() => useTerminal());

      await act(async () => {
        await result.current.addHeadlessSession("/proj", "claude", "Test");
      });

      let tabId: string | null = null;
      act(() => {
        tabId = result.current.promoteHeadlessSession("headless-term-1");
      });

      expect(result.current.promotedHeadlessIds.has("headless-term-1")).toBe(true);
      expect(result.current.headlessSessions).toHaveLength(1);

      await act(async () => {
        await result.current.killTab(tabId!);
      });

      expect(result.current.tabs).toHaveLength(0);
      expect(result.current.headlessSessions).toHaveLength(0);
      expect(result.current.promotedHeadlessIds.has("headless-term-1")).toBe(false);
      expect(result.current.promotedHeadlessIds.size).toBe(0);
    });

    it("removeHeadlessSession cleans up promotedHeadlessIds", async () => {
      const { result } = renderHook(() => useTerminal());

      await act(async () => {
        await result.current.addHeadlessSession("/proj", "claude", "Test");
      });

      act(() => {
        result.current.promoteHeadlessSession("headless-term-1");
      });
      expect(result.current.promotedHeadlessIds.has("headless-term-1")).toBe(true);

      await act(async () => {
        await result.current.removeHeadlessSession("headless-term-1");
      });

      expect(result.current.promotedHeadlessIds.has("headless-term-1")).toBe(false);
      expect(result.current.promotedHeadlessIds.size).toBe(0);
      // Also removes the promoted tab
      expect(result.current.tabs).toHaveLength(0);
      expect(result.current.headlessSessions).toHaveLength(0);
    });

    it("killAllTerminals resets promotedHeadlessIds to empty", async () => {
      const { result } = renderHook(() => useTerminal());

      vi.mocked(spawnHeadlessTerminal)
        .mockResolvedValueOnce("ht-1")
        .mockResolvedValueOnce("ht-2");

      await act(async () => {
        await result.current.addHeadlessSession("/proj1", "claude", "Test 1");
      });
      await act(async () => {
        await result.current.addHeadlessSession("/proj2", "claude", "Test 2");
      });

      act(() => {
        result.current.promoteHeadlessSession("ht-1");
      });
      act(() => {
        result.current.promoteHeadlessSession("ht-2");
      });

      expect(result.current.promotedHeadlessIds.size).toBe(2);

      await act(async () => {
        await result.current.killAllTerminals();
      });

      expect(result.current.promotedHeadlessIds.size).toBe(0);
      expect(result.current.tabs).toHaveLength(0);
      expect(result.current.headlessSessions).toHaveLength(0);
    });

    it("trashCompletedSessions cleans up promotedHeadlessIds for completed sessions", async () => {
      vi.useFakeTimers();
      const { result } = renderHook(() => useTerminal());

      vi.mocked(spawnHeadlessTerminal)
        .mockResolvedValueOnce("ht-1")
        .mockResolvedValueOnce("ht-2");

      await act(async () => {
        await result.current.addHeadlessSession("/proj1", "claude", "Session 1");
      });
      await act(async () => {
        await result.current.addHeadlessSession("/proj2", "claude", "Session 2");
      });

      // Advance past the 1s deferral to register the listen callback
      await act(async () => { vi.advanceTimersByTime(1100); });
      vi.useRealTimers();

      // Mark ht-1 as completed
      act(() => {
        listenCallback!({ payload: { terminalId: "ht-1", needsAttention: false, exited: false, exitCode: null, bufferSize: 100, completed: true } });
      });

      // Promote both
      act(() => {
        result.current.promoteHeadlessSession("ht-1");
      });
      act(() => {
        result.current.promoteHeadlessSession("ht-2");
      });

      expect(result.current.promotedHeadlessIds.size).toBe(2);

      act(() => {
        result.current.trashCompletedSessions();
      });

      // ht-1 was completed, so it should be removed from promotedHeadlessIds
      // ht-2 is still active, so it stays
      expect(result.current.promotedHeadlessIds.has("ht-1")).toBe(false);
      expect(result.current.promotedHeadlessIds.has("ht-2")).toBe(true);
      expect(result.current.promotedHeadlessIds.size).toBe(1);
    });

    it("trashSession cleans up promotedHeadlessIds for the trashed session", async () => {
      const { result } = renderHook(() => useTerminal());

      await act(async () => {
        await result.current.addHeadlessSession("/proj", "claude", "Test");
      });

      act(() => {
        result.current.promoteHeadlessSession("headless-term-1");
      });
      expect(result.current.promotedHeadlessIds.has("headless-term-1")).toBe(true);

      act(() => {
        result.current.trashSession("headless-term-1");
      });

      expect(result.current.promotedHeadlessIds.has("headless-term-1")).toBe(false);
      expect(result.current.promotedHeadlessIds.size).toBe(0);
    });
  });

  describe("totalSessionCount de-duplication for promoted headless", () => {
    it("does not double-count a promoted headless session", async () => {
      const { result } = renderHook(() => useTerminal());

      await act(async () => {
        await result.current.addHeadlessSession("/proj", "claude", "Test");
      });
      expect(result.current.totalSessionCount).toBe(1);

      act(() => {
        result.current.promoteHeadlessSession("headless-term-1");
      });

      // headlessSessions has 1 entry, tabs has 1 entry, but promotedHeadlessIds has 1
      // so totalSessionCount should be 1 (not 2)
      expect(result.current.totalSessionCount).toBe(1);
    });

    it("totalSessionCount is correct with mix of regular tabs, headless, and promoted", async () => {
      const { result } = renderHook(() => useTerminal());

      // 1 regular tab
      act(() => {
        result.current.addTab("/proj1", true);
      });
      expect(result.current.totalSessionCount).toBe(1);

      // 1 headless session
      await act(async () => {
        await result.current.addHeadlessSession("/proj2", "claude", "BG");
      });
      expect(result.current.totalSessionCount).toBe(2);

      // Promote the headless session -- should still be 2 total, not 3
      act(() => {
        result.current.promoteHeadlessSession("headless-term-1");
      });
      expect(result.current.totalSessionCount).toBe(2);
    });

    it("totalSessionCount decreases correctly when promoted headless is killed", async () => {
      const { result } = renderHook(() => useTerminal());

      await act(async () => {
        await result.current.addHeadlessSession("/proj", "claude", "Test");
      });

      let tabId: string | null = null;
      act(() => {
        tabId = result.current.promoteHeadlessSession("headless-term-1");
      });
      expect(result.current.totalSessionCount).toBe(1);

      await act(async () => {
        await result.current.killTab(tabId!);
      });

      expect(result.current.totalSessionCount).toBe(0);
    });
  });

  describe("re-promote already-promoted headless session", () => {
    it("reuses existing tab instead of creating a new one", async () => {
      const { result } = renderHook(() => useTerminal());

      await act(async () => {
        await result.current.addHeadlessSession("/proj", "claude", "Test");
      });

      // First promote
      let firstTabId: string | null = null;
      act(() => {
        firstTabId = result.current.promoteHeadlessSession("headless-term-1");
      });
      expect(result.current.tabs).toHaveLength(1);
      expect(result.current.tabs[0].id).toBe(firstTabId);

      // Hide the promoted tab
      await act(async () => {
        await result.current.removeTab(firstTabId!);
      });
      expect(result.current.tabs[0].visible).toBe(false);

      // Re-promote: should reuse the existing tab, not create a new one
      let secondTabId: string | null = null;
      act(() => {
        secondTabId = result.current.promoteHeadlessSession("headless-term-1");
      });

      expect(result.current.tabs).toHaveLength(1);
      expect(secondTabId).toBe(firstTabId);
      expect(result.current.tabs[0].visible).toBe(true);
    });

    it("re-promote does not add duplicate entry to promotedHeadlessIds", async () => {
      const { result } = renderHook(() => useTerminal());

      await act(async () => {
        await result.current.addHeadlessSession("/proj", "claude", "Test");
      });

      act(() => {
        result.current.promoteHeadlessSession("headless-term-1");
      });
      expect(result.current.promotedHeadlessIds.size).toBe(1);

      // Hide
      await act(async () => {
        await result.current.removeTab(result.current.tabs[0].id);
      });

      // Re-promote
      act(() => {
        result.current.promoteHeadlessSession("headless-term-1");
      });

      // Still only 1 entry in the Set (Set naturally prevents duplicates, but verify)
      expect(result.current.promotedHeadlessIds.size).toBe(1);
      expect(result.current.promotedHeadlessIds.has("headless-term-1")).toBe(true);
    });

    it("totalSessionCount stays correct through promote-hide-re-promote cycle", async () => {
      const { result } = renderHook(() => useTerminal());

      await act(async () => {
        await result.current.addHeadlessSession("/proj", "claude", "Test");
      });
      expect(result.current.totalSessionCount).toBe(1);

      // Promote
      let tabId: string | null = null;
      act(() => {
        tabId = result.current.promoteHeadlessSession("headless-term-1");
      });
      expect(result.current.totalSessionCount).toBe(1);

      // Hide (removeTab)
      await act(async () => {
        await result.current.removeTab(tabId!);
      });
      // Tab is hidden but still exists, headless still exists, promoted id still tracked
      expect(result.current.totalSessionCount).toBe(1);

      // Re-promote
      act(() => {
        result.current.promoteHeadlessSession("headless-term-1");
      });
      expect(result.current.totalSessionCount).toBe(1);
    });
  });

  describe("full lifecycle: spawn -> promote -> hide -> re-promote -> kill", () => {
    it("maintains correct state at each lifecycle step", async () => {
      const { result } = renderHook(() => useTerminal());

      // Step 1: Spawn headless
      await act(async () => {
        await result.current.addHeadlessSession("/proj", "claude", "Lifecycle Test");
      });
      expect(result.current.headlessSessions).toHaveLength(1);
      expect(result.current.tabs).toHaveLength(0);
      expect(result.current.promotedHeadlessIds.size).toBe(0);
      expect(result.current.totalSessionCount).toBe(1);

      // Step 2: Promote to visible
      let tabId: string | null = null;
      act(() => {
        tabId = result.current.promoteHeadlessSession("headless-term-1");
      });
      expect(result.current.headlessSessions).toHaveLength(1);
      expect(result.current.tabs).toHaveLength(1);
      expect(result.current.tabs[0].visible).toBe(true);
      expect(result.current.tabs[0].isHeadlessPromoted).toBe(true);
      expect(result.current.promotedHeadlessIds.size).toBe(1);
      expect(result.current.totalSessionCount).toBe(1);

      // Step 3: Hide (removeTab demotes to invisible)
      await act(async () => {
        await result.current.removeTab(tabId!);
      });
      expect(result.current.headlessSessions).toHaveLength(1);
      expect(result.current.tabs).toHaveLength(1);
      expect(result.current.tabs[0].visible).toBe(false);
      expect(result.current.promotedHeadlessIds.size).toBe(1);
      expect(result.current.totalSessionCount).toBe(1);

      // Step 4: Re-promote (reuses existing tab)
      let reusedTabId: string | null = null;
      act(() => {
        reusedTabId = result.current.promoteHeadlessSession("headless-term-1");
      });
      expect(reusedTabId).toBe(tabId);
      expect(result.current.tabs).toHaveLength(1);
      expect(result.current.tabs[0].visible).toBe(true);
      expect(result.current.promotedHeadlessIds.size).toBe(1);
      expect(result.current.totalSessionCount).toBe(1);

      // Step 5: Kill
      await act(async () => {
        await result.current.killTab(tabId!);
      });
      expect(result.current.tabs).toHaveLength(0);
      expect(result.current.headlessSessions).toHaveLength(0);
      expect(result.current.promotedHeadlessIds.size).toBe(0);
      expect(result.current.totalSessionCount).toBe(0);
      expect(closeHeadlessTerminal).toHaveBeenCalledWith("headless-term-1");
    });
  });

  describe("spawnVisibleHeadlessSession", () => {
    it("creates a tab with isHeadlessPromoted, visible, and headlessTerminalId", async () => {
      vi.mocked(spawnHeadlessTerminal).mockResolvedValueOnce("vis-ht-1");
      const { result } = renderHook(() => useTerminal());

      await act(async () => {
        await result.current.spawnVisibleHeadlessSession(
          "/home/user/proj",
          "/init-tasks",
          "init-tasks -- proj"
        );
      });

      expect(result.current.tabs).toHaveLength(1);
      const tab = result.current.tabs[0];
      expect(tab.isHeadlessPromoted).toBe(true);
      expect(tab.visible).toBe(true);
      expect(tab.headlessTerminalId).toBe("vis-ht-1");
      expect(tab.isClaudeSession).toBe(true);
      expect(tab.projectPath).toBe("/home/user/proj");
      expect(tab.projectName).toBe("proj");
      expect(tab.label).toBe("init-tasks -- proj");
      expect(tab.headlessCompleted).toBe(false);
      expect(tab.terminalId).toBeNull();
    });

    it("passes model and effort to spawnHeadlessTerminal", async () => {
      vi.mocked(spawnHeadlessTerminal).mockResolvedValueOnce("vis-ht-model");
      const { result } = renderHook(() => useTerminal());

      await act(async () => {
        await result.current.spawnVisibleHeadlessSession(
          "/home/user/proj",
          "/code-workflow --yes task-a",
          "code -- proj/task-a",
          "opus",
          "high"
        );
      });

      expect(spawnHeadlessTerminal).toHaveBeenCalledWith(
        "/home/user/proj",
        "/code-workflow --yes task-a",
        "opus",
        "high"
      );
    });

    it("does not add to headlessSessions", async () => {
      vi.mocked(spawnHeadlessTerminal).mockResolvedValueOnce("vis-ht-2");
      const { result } = renderHook(() => useTerminal());

      await act(async () => {
        await result.current.spawnVisibleHeadlessSession(
          "/home/user/proj",
          "/init-tasks",
          "init-tasks -- proj"
        );
      });

      expect(result.current.headlessSessions).toHaveLength(0);
      expect(result.current.tabs).toHaveLength(1);
    });

    it("returns the terminalId on success", async () => {
      vi.mocked(spawnHeadlessTerminal).mockResolvedValueOnce("vis-ht-3");
      const { result } = renderHook(() => useTerminal());

      let returnedId: string | null = null;
      await act(async () => {
        returnedId = await result.current.spawnVisibleHeadlessSession(
          "/home/user/proj",
          "/init-tasks",
          "init-tasks -- proj"
        );
      });

      expect(returnedId).toBe("vis-ht-3");
    });

    it("returns null on spawn failure", async () => {
      vi.mocked(spawnHeadlessTerminal).mockRejectedValueOnce(new Error("spawn failed"));
      const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      const { result } = renderHook(() => useTerminal());

      let returnedId: string | null = "not-null";
      await act(async () => {
        returnedId = await result.current.spawnVisibleHeadlessSession(
          "/home/user/proj",
          "/init-tasks",
          "init-tasks -- proj"
        );
      });

      expect(returnedId).toBeNull();
      expect(result.current.tabs).toHaveLength(0);
      expect(result.current.headlessSessions).toHaveLength(0);
      consoleErrorSpy.mockRestore();
    });

    it("calls spawnHeadlessTerminal with correct arguments", async () => {
      vi.mocked(spawnHeadlessTerminal).mockResolvedValueOnce("vis-ht-4");
      const { result } = renderHook(() => useTerminal());

      await act(async () => {
        await result.current.spawnVisibleHeadlessSession(
          "/home/user/my-project",
          "/init-tasks",
          "init-tasks -- my-project"
        );
      });

      expect(spawnHeadlessTerminal).toHaveBeenCalledWith("/home/user/my-project", "/init-tasks", undefined, undefined);
    });

    it("passes model and effort to spawnHeadlessTerminal", async () => {
      vi.mocked(spawnHeadlessTerminal).mockResolvedValueOnce("vis-ht-5");
      const { result } = renderHook(() => useTerminal());

      await act(async () => {
        await result.current.spawnVisibleHeadlessSession(
          "/home/user/my-project",
          "/init-tasks",
          "init-tasks -- my-project",
          "opus",
          "high"
        );
      });

      expect(spawnHeadlessTerminal).toHaveBeenCalledWith("/home/user/my-project", "/init-tasks", "opus", "high");
    });
  });

  describe("headless status listener updates promoted tabs", () => {
    it("updates headlessCompleted on promoted tab when status event has completed=true", async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      vi.mocked(spawnHeadlessTerminal)
        .mockResolvedValueOnce("headless-term-1")
        .mockResolvedValueOnce("headless-term-2");
      const { result } = renderHook(() => useTerminal());

      await act(async () => {
        await result.current.addHeadlessSession("/proj", "claude", "Session 1");
      });
      await act(async () => {
        await result.current.addHeadlessSession("/proj", "claude", "Session 2");
      });

      expect(result.current.headlessSessions).toHaveLength(2);

      // Advance past the 1s deferral to register the listen callback
      await act(async () => { vi.advanceTimersByTime(1100); });
      vi.useRealTimers();

      // Mark headless-term-1 as completed via listen event
      act(() => {
        listenCallback!({
          payload: {
            terminalId: "headless-term-1",
            needsAttention: false,
            exited: false,
            exitCode: null,
            bufferSize: 100,
            completed: true,
          },
        });
      });

      // Promote both
      act(() => {
        result.current.promoteHeadlessSession("headless-term-1");
      });
      act(() => {
        result.current.promoteHeadlessSession("headless-term-2");
      });

      expect(result.current.promotedHeadlessIds.size).toBe(2);

      act(() => {
        result.current.trashCompletedSessions();
      });

      // headless-term-1 was completed, so it should be removed from promotedHeadlessIds
      // headless-term-2 is still active, so it stays
      expect(result.current.promotedHeadlessIds.has("headless-term-1")).toBe(false);
      expect(result.current.promotedHeadlessIds.has("headless-term-2")).toBe(true);
      expect(result.current.promotedHeadlessIds.size).toBe(1);
    });

    it("trashSession cleans up promotedHeadlessIds for the trashed session", async () => {
      const { result } = renderHook(() => useTerminal());

      await act(async () => {
        await result.current.addHeadlessSession("/proj", "claude", "Test");
      });

      act(() => {
        result.current.promoteHeadlessSession("headless-term-1");
      });
      expect(result.current.promotedHeadlessIds.has("headless-term-1")).toBe(true);

      act(() => {
        result.current.trashSession("headless-term-1");
      });

      expect(result.current.promotedHeadlessIds.has("headless-term-1")).toBe(false);
      expect(result.current.promotedHeadlessIds.size).toBe(0);
    });
  });

  describe("totalSessionCount de-duplication for promoted headless", () => {
    it("does not double-count a promoted headless session", async () => {
      const { result } = renderHook(() => useTerminal());

      await act(async () => {
        await result.current.addHeadlessSession("/proj", "claude", "Test");
      });
      expect(result.current.totalSessionCount).toBe(1);

      act(() => {
        result.current.promoteHeadlessSession("headless-term-1");
      });

      // headlessSessions has 1 entry, tabs has 1 entry, but promotedHeadlessIds has 1
      // so totalSessionCount should be 1 (not 2)
      expect(result.current.totalSessionCount).toBe(1);
    });

    it("totalSessionCount is correct with mix of regular tabs, headless, and promoted", async () => {
      const { result } = renderHook(() => useTerminal());

      // 1 regular tab
      act(() => {
        result.current.addTab("/proj1", true);
      });
      expect(result.current.totalSessionCount).toBe(1);

      // 1 headless session
      await act(async () => {
        await result.current.addHeadlessSession("/proj2", "claude", "BG");
      });
      expect(result.current.totalSessionCount).toBe(2);

      // Promote the headless session -- should still be 2 total, not 3
      act(() => {
        result.current.promoteHeadlessSession("headless-term-1");
      });
      expect(result.current.totalSessionCount).toBe(2);
    });

    it("totalSessionCount decreases correctly when promoted headless is killed", async () => {
      const { result } = renderHook(() => useTerminal());

      await act(async () => {
        await result.current.addHeadlessSession("/proj", "claude", "Test");
      });

      let tabId: string | null = null;
      act(() => {
        tabId = result.current.promoteHeadlessSession("headless-term-1");
      });
      expect(result.current.totalSessionCount).toBe(1);

      await act(async () => {
        await result.current.killTab(tabId!);
      });

      expect(result.current.totalSessionCount).toBe(0);
    });
  });

  describe("re-promote already-promoted headless session", () => {
    it("reuses existing tab instead of creating a new one", async () => {
      const { result } = renderHook(() => useTerminal());

      await act(async () => {
        await result.current.addHeadlessSession("/proj", "claude", "Test");
      });

      // First promote
      let firstTabId: string | null = null;
      act(() => {
        firstTabId = result.current.promoteHeadlessSession("headless-term-1");
      });
      expect(result.current.tabs).toHaveLength(1);
      expect(result.current.tabs[0].id).toBe(firstTabId);

      // Hide the promoted tab
      await act(async () => {
        await result.current.removeTab(firstTabId!);
      });
      expect(result.current.tabs[0].visible).toBe(false);

      // Re-promote: should reuse the existing tab, not create a new one
      let secondTabId: string | null = null;
      act(() => {
        secondTabId = result.current.promoteHeadlessSession("headless-term-1");
      });

      expect(result.current.tabs).toHaveLength(1);
      expect(secondTabId).toBe(firstTabId);
      expect(result.current.tabs[0].visible).toBe(true);
    });

    it("re-promote does not add duplicate entry to promotedHeadlessIds", async () => {
      const { result } = renderHook(() => useTerminal());

      await act(async () => {
        await result.current.addHeadlessSession("/proj", "claude", "Test");
      });

      act(() => {
        result.current.promoteHeadlessSession("headless-term-1");
      });
      expect(result.current.promotedHeadlessIds.size).toBe(1);

      // Hide
      await act(async () => {
        await result.current.removeTab(result.current.tabs[0].id);
      });

      // Re-promote
      act(() => {
        result.current.promoteHeadlessSession("headless-term-1");
      });

      // Still only 1 entry in the Set (Set naturally prevents duplicates, but verify)
      expect(result.current.promotedHeadlessIds.size).toBe(1);
      expect(result.current.promotedHeadlessIds.has("headless-term-1")).toBe(true);
    });

    it("totalSessionCount stays correct through promote-hide-re-promote cycle", async () => {
      const { result } = renderHook(() => useTerminal());

      await act(async () => {
        await result.current.addHeadlessSession("/proj", "claude", "Test");
      });
      expect(result.current.totalSessionCount).toBe(1);

      // Promote
      let tabId: string | null = null;
      act(() => {
        tabId = result.current.promoteHeadlessSession("headless-term-1");
      });
      expect(result.current.totalSessionCount).toBe(1);

      // Hide (removeTab)
      await act(async () => {
        await result.current.removeTab(tabId!);
      });
      // Tab is hidden but still exists, headless still exists, promoted id still tracked
      expect(result.current.totalSessionCount).toBe(1);

      // Re-promote
      act(() => {
        result.current.promoteHeadlessSession("headless-term-1");
      });
      expect(result.current.totalSessionCount).toBe(1);
    });
  });

  describe("full lifecycle: spawn -> promote -> hide -> re-promote -> kill", () => {
    it("maintains correct state at each lifecycle step", async () => {
      const { result } = renderHook(() => useTerminal());

      // Step 1: Spawn headless
      await act(async () => {
        await result.current.addHeadlessSession("/proj", "claude", "Lifecycle Test");
      });
      expect(result.current.headlessSessions).toHaveLength(1);
      expect(result.current.tabs).toHaveLength(0);
      expect(result.current.promotedHeadlessIds.size).toBe(0);
      expect(result.current.totalSessionCount).toBe(1);

      // Step 2: Promote to visible
      let tabId: string | null = null;
      act(() => {
        tabId = result.current.promoteHeadlessSession("headless-term-1");
      });
      expect(result.current.headlessSessions).toHaveLength(1);
      expect(result.current.tabs).toHaveLength(1);
      expect(result.current.tabs[0].visible).toBe(true);
      expect(result.current.tabs[0].isHeadlessPromoted).toBe(true);
      expect(result.current.promotedHeadlessIds.size).toBe(1);
      expect(result.current.totalSessionCount).toBe(1);

      // Step 3: Hide (removeTab demotes to invisible)
      await act(async () => {
        await result.current.removeTab(tabId!);
      });
      expect(result.current.headlessSessions).toHaveLength(1);
      expect(result.current.tabs).toHaveLength(1);
      expect(result.current.tabs[0].visible).toBe(false);
      expect(result.current.promotedHeadlessIds.size).toBe(1);
      expect(result.current.totalSessionCount).toBe(1);

      // Step 4: Re-promote (reuses existing tab)
      let reusedTabId: string | null = null;
      act(() => {
        reusedTabId = result.current.promoteHeadlessSession("headless-term-1");
      });
      expect(reusedTabId).toBe(tabId);
      expect(result.current.tabs).toHaveLength(1);
      expect(result.current.tabs[0].visible).toBe(true);
      expect(result.current.promotedHeadlessIds.size).toBe(1);
      expect(result.current.totalSessionCount).toBe(1);

      // Step 5: Kill
      await act(async () => {
        await result.current.killTab(tabId!);
      });
      expect(result.current.tabs).toHaveLength(0);
      expect(result.current.headlessSessions).toHaveLength(0);
      expect(result.current.promotedHeadlessIds.size).toBe(0);
      expect(result.current.totalSessionCount).toBe(0);
      expect(closeHeadlessTerminal).toHaveBeenCalledWith("headless-term-1");
    });
  });

  describe("spawnVisibleHeadlessSession status updates", () => {
    it("updates headlessCompleted on promoted tab from status event", async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      vi.mocked(spawnHeadlessTerminal).mockResolvedValueOnce("vis-ht-10");
      const { result } = renderHook(() => useTerminal());

      await act(async () => {
        await result.current.spawnVisibleHeadlessSession(
          "/home/user/proj",
          "/init-tasks",
          "init-tasks -- proj"
        );
      });

      // Advance past the 1s deferral to register the listen callback
      await act(async () => { vi.advanceTimersByTime(1100); });
      vi.useRealTimers();

      expect(listenCallback).not.toBeNull();

      act(() => {
        listenCallback!({
          payload: {
            terminalId: "vis-ht-10",
            needsAttention: false,
            exited: false,
            exitCode: null,
            bufferSize: 500,
            completed: true,
          },
        });
      });

      expect(result.current.tabs[0].headlessCompleted).toBe(true);
    });

    it("updates dead on promoted tab when status event has exited=true", async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      vi.mocked(spawnHeadlessTerminal).mockResolvedValueOnce("vis-ht-11");
      const { result } = renderHook(() => useTerminal());

      await act(async () => {
        await result.current.spawnVisibleHeadlessSession(
          "/home/user/proj",
          "/init-tasks",
          "init-tasks -- proj"
        );
      });

      // Advance past the 1s deferral
      await act(async () => { vi.advanceTimersByTime(1100); });
      vi.useRealTimers();

      act(() => {
        listenCallback!({
          payload: {
            terminalId: "vis-ht-11",
            needsAttention: false,
            exited: true,
            exitCode: 0,
            bufferSize: 300,
            completed: false,
          },
        });
      });

      expect(result.current.tabs[0].dead).toBe(true);
    });

    it("does not update tabs that do not match the headlessTerminalId", async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      vi.mocked(spawnHeadlessTerminal).mockResolvedValueOnce("vis-ht-12");
      const { result } = renderHook(() => useTerminal());

      await act(async () => {
        await result.current.spawnVisibleHeadlessSession(
          "/home/user/proj",
          "/init-tasks",
          "init-tasks -- proj"
        );
      });

      await act(async () => { vi.advanceTimersByTime(1100); });
      vi.useRealTimers();

      act(() => {
        listenCallback!({
          payload: {
            terminalId: "different-terminal",
            needsAttention: false,
            exited: true,
            exitCode: 1,
            bufferSize: 0,
            completed: true,
          },
        });
      });

      expect(result.current.tabs[0].headlessCompleted).toBe(false);
      expect(result.current.tabs[0].dead).toBeUndefined();
    });
  });

  describe("spawnVisibleHeadlessSession lifecycle", () => {
    it("killTab on spawnVisibleHeadlessSession tab calls closeHeadlessTerminal", async () => {
      vi.mocked(spawnHeadlessTerminal).mockResolvedValueOnce("vis-ht-kill-1");
      const { result } = renderHook(() => useTerminal());

      await act(async () => {
        await result.current.spawnVisibleHeadlessSession(
          "/home/user/proj",
          "/init-tasks",
          "init-tasks -- proj"
        );
      });

      const tabId = result.current.tabs[0].id;

      await act(async () => {
        await result.current.killTab(tabId);
      });

      expect(closeHeadlessTerminal).toHaveBeenCalledWith("vis-ht-kill-1");
      expect(closeTerminal).not.toHaveBeenCalled();
      expect(result.current.tabs).toHaveLength(0);
    });

    it("closeAllTabs hides spawnVisibleHeadlessSession tab without killing", async () => {
      vi.mocked(spawnHeadlessTerminal).mockResolvedValueOnce("vis-ht-close-1");
      const { result } = renderHook(() => useTerminal());

      await act(async () => {
        await result.current.spawnVisibleHeadlessSession(
          "/home/user/proj",
          "/init-tasks",
          "init-tasks -- proj"
        );
      });

      expect(result.current.tabs).toHaveLength(1);
      expect(result.current.tabs[0].visible).toBe(true);

      act(() => {
        result.current.closeAllTabs();
      });

      expect(result.current.tabs).toHaveLength(1);
      expect(result.current.tabs[0].visible).toBe(false);
      expect(closeHeadlessTerminal).not.toHaveBeenCalled();
      expect(closeTerminal).not.toHaveBeenCalled();
    });

    it("killAllTerminals kills spawnVisibleHeadlessSession tab via headless close", async () => {
      vi.mocked(spawnHeadlessTerminal).mockResolvedValueOnce("vis-ht-killall-1");
      const { result } = renderHook(() => useTerminal());

      await act(async () => {
        await result.current.spawnVisibleHeadlessSession(
          "/home/user/proj",
          "/init-tasks",
          "init-tasks -- proj"
        );
      });

      expect(result.current.tabs).toHaveLength(1);

      await act(async () => {
        await result.current.killAllTerminals();
      });

      expect(result.current.tabs).toHaveLength(0);
      expect(closeHeadlessTerminal).toHaveBeenCalledWith("vis-ht-killall-1");
      expect(closeTerminal).not.toHaveBeenCalled();
    });

    it("removeTab demotes spawnVisibleHeadlessSession tab to hidden", async () => {
      vi.mocked(spawnHeadlessTerminal).mockResolvedValueOnce("vis-ht-demote-1");
      const { result } = renderHook(() => useTerminal());

      await act(async () => {
        await result.current.spawnVisibleHeadlessSession(
          "/home/user/proj",
          "/init-tasks",
          "init-tasks -- proj"
        );
      });

      const tabId = result.current.tabs[0].id;

      await act(async () => {
        await result.current.removeTab(tabId);
      });

      expect(result.current.tabs).toHaveLength(1);
      expect(result.current.tabs[0].visible).toBe(false);
      expect(closeHeadlessTerminal).not.toHaveBeenCalled();
    });

    it("promoteSession re-shows a hidden spawnVisibleHeadlessSession tab", async () => {
      vi.mocked(spawnHeadlessTerminal).mockResolvedValueOnce("vis-ht-promote-1");
      const { result } = renderHook(() => useTerminal());

      await act(async () => {
        await result.current.spawnVisibleHeadlessSession(
          "/home/user/proj",
          "/init-tasks",
          "init-tasks -- proj"
        );
      });

      const tabId = result.current.tabs[0].id;

      // Demote
      await act(async () => {
        await result.current.removeTab(tabId);
      });
      expect(result.current.tabs[0].visible).toBe(false);

      // Promote back
      act(() => {
        result.current.promoteSession(tabId);
      });
      expect(result.current.tabs[0].visible).toBe(true);
    });
  });
});
