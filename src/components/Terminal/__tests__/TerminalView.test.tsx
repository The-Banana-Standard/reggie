import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, act } from "@testing-library/react";
import type { TerminalTab } from "../../../types/terminal";

// ── Mock xterm.js ──
const mockFit = vi.fn();
const mockXtermWrite = vi.fn();
const mockXtermOpen = vi.fn();
const mockXtermDispose = vi.fn();
const mockLoadAddon = vi.fn();
const mockOnData = vi.fn();

// Each Terminal instance gets an `options` object so theme update tests
// can verify `xtermRef.current.options.theme = ...` assignments.
let latestMockXtermOptions: Record<string, unknown> = {};

vi.mock("@xterm/xterm", () => ({
  Terminal: vi.fn().mockImplementation(() => {
    latestMockXtermOptions = {};
    return {
      open: mockXtermOpen,
      write: mockXtermWrite,
      dispose: mockXtermDispose,
      loadAddon: mockLoadAddon,
      onData: mockOnData,
      rows: 24,
      cols: 80,
      options: latestMockXtermOptions,
    };
  }),
}));

vi.mock("@xterm/addon-fit", () => ({
  FitAddon: vi.fn().mockImplementation(() => ({
    fit: mockFit,
  })),
}));

vi.mock("@xterm/addon-web-links", () => ({
  WebLinksAddon: vi.fn(),
}));

// ── Mock terminal-service ──
const mockResizeTerminal = vi.fn(() => Promise.resolve());
const mockResizeHeadlessTerminal = vi.fn(() => Promise.resolve());
const mockSpawnTerminal = vi.fn(() => Promise.resolve("term-123"));

vi.mock("../../../services/terminal-service", () => ({
  spawnTerminal: (...args: unknown[]) => mockSpawnTerminal(...args),
  writeToTerminal: vi.fn(() => Promise.resolve()),
  resizeTerminal: (...args: unknown[]) => mockResizeTerminal(...args),
  attachTerminalChannel: vi.fn(() => Promise.resolve([])),
  writeToHeadlessTerminal: vi.fn(() => Promise.resolve()),
  resizeHeadlessTerminal: (...args: unknown[]) => mockResizeHeadlessTerminal(...args),
}));

// ── Mock Tauri ──
import "../../../__test-utils__/tauri-mock";

// ── Import component under test (after mocks) ──
import { TerminalView } from "../TerminalView";
import { Terminal } from "@xterm/xterm";

// ── RAF / setTimeout tracking ──
// We replace the browser scheduling APIs with manually-controlled fakes
// so we can inspect call counts and simulate frame/timer progression.

type RafCallback = (time: number) => void;

let rafCallbacks: Map<number, RafCallback>;
let rafIdCounter: number;
let timeoutCallbacks: Map<number, { fn: () => void; delay: number }>;
let timeoutIdCounter: number;

let originalRaf: typeof requestAnimationFrame;
let originalCancelRaf: typeof cancelAnimationFrame;
let originalSetTimeout: typeof setTimeout;
let originalClearTimeout: typeof clearTimeout;

function installSchedulingMocks() {
  rafCallbacks = new Map();
  rafIdCounter = 0;
  timeoutCallbacks = new Map();
  timeoutIdCounter = 0;

  originalRaf = globalThis.requestAnimationFrame;
  originalCancelRaf = globalThis.cancelAnimationFrame;
  originalSetTimeout = globalThis.setTimeout;
  originalClearTimeout = globalThis.clearTimeout;

  globalThis.requestAnimationFrame = vi.fn((cb: RafCallback) => {
    const id = ++rafIdCounter;
    rafCallbacks.set(id, cb);
    return id;
  }) as unknown as typeof requestAnimationFrame;

  globalThis.cancelAnimationFrame = vi.fn((id: number) => {
    rafCallbacks.delete(id);
  });

  globalThis.setTimeout = vi.fn((fn: () => void, delay?: number) => {
    const id = ++timeoutIdCounter;
    timeoutCallbacks.set(id, { fn, delay: delay ?? 0 });
    return id;
  }) as unknown as typeof setTimeout;

  globalThis.clearTimeout = vi.fn((id: number | undefined) => {
    if (id !== undefined) {
      timeoutCallbacks.delete(id);
    }
  }) as unknown as typeof clearTimeout;
}

function uninstallSchedulingMocks() {
  globalThis.requestAnimationFrame = originalRaf;
  globalThis.cancelAnimationFrame = originalCancelRaf;
  globalThis.setTimeout = originalSetTimeout;
  globalThis.clearTimeout = originalClearTimeout;
}

// jsdom returns null for offsetParent and 0×0 for getBoundingClientRect on
// elements not laid out by a real browser. Production code uses both via
// isContainerVisible() to guard fitAddon.fit() against the display:none
// percentage-string trap (see TerminalView.tsx). Stub both so test renders
// appear visible — the real visibility behavior is exercised by the manual
// repro at REVIEW-WITH-USER, which jsdom can't simulate anyway.
let originalOffsetParentDesc: PropertyDescriptor | undefined;
let originalGetBoundingClientRect: typeof HTMLElement.prototype.getBoundingClientRect;

function installVisibilityStubs() {
  originalOffsetParentDesc = Object.getOwnPropertyDescriptor(
    HTMLElement.prototype,
    "offsetParent"
  );
  Object.defineProperty(HTMLElement.prototype, "offsetParent", {
    configurable: true,
    get() {
      return document.body;
    },
  });
  originalGetBoundingClientRect = HTMLElement.prototype.getBoundingClientRect;
  HTMLElement.prototype.getBoundingClientRect = function () {
    return {
      width: 800,
      height: 600,
      top: 0,
      left: 0,
      right: 800,
      bottom: 600,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    } as DOMRect;
  };
}

function uninstallVisibilityStubs() {
  if (originalOffsetParentDesc) {
    Object.defineProperty(
      HTMLElement.prototype,
      "offsetParent",
      originalOffsetParentDesc
    );
  }
  HTMLElement.prototype.getBoundingClientRect = originalGetBoundingClientRect;
}

/** Flush all pending rAF callbacks (one round). */
function flushRafs() {
  const cbs = Array.from(rafCallbacks.entries());
  rafCallbacks.clear();
  for (const [, cb] of cbs) {
    cb(performance.now());
  }
}

/** Flush all pending setTimeout callbacks. */
function flushTimeouts() {
  const cbs = Array.from(timeoutCallbacks.entries());
  timeoutCallbacks.clear();
  for (const [, { fn }] of cbs) {
    fn();
  }
}

// ── Helpers ──

function makeTab(overrides: Partial<TerminalTab> = {}): TerminalTab {
  return {
    id: "tab-1",
    terminalId: null,
    label: "Shell session",
    isClaudeSession: false,
    projectPath: "/home/user/project",
    ...overrides,
  };
}

const defaultProps = {
  tab: makeTab(),
  isVisible: true,
  onTerminalSpawned: vi.fn(),
};

/**
 * Renders TerminalView with isVisible=true and waits for the init effect
 * to complete (spawns terminal, populates xtermRef/fitAddonRef/terminalIdRef).
 * Returns the rerender function for subsequent prop changes.
 */
async function renderAndInit(
  propOverrides: Partial<typeof defaultProps> = {}
) {
  const props = { ...defaultProps, ...propOverrides };

  // Reset scheduling mocks call counts AFTER any setup but before render
  vi.mocked(globalThis.requestAnimationFrame).mockClear();
  vi.mocked(globalThis.cancelAnimationFrame).mockClear();
  vi.mocked(globalThis.setTimeout).mockClear();
  vi.mocked(globalThis.clearTimeout).mockClear();

  const result = render(<TerminalView {...props} />);

  // The init effect calls requestAnimationFrame once for the initial fit.
  // Flush that so it doesn't interfere with our resize-effect assertions.
  flushRafs();

  // Wait for spawnTerminal promise to resolve (populates terminalIdRef)
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });

  // Clear scheduling mock call counts so tests start clean for the resize effect
  vi.mocked(globalThis.requestAnimationFrame).mockClear();
  vi.mocked(globalThis.cancelAnimationFrame).mockClear();
  vi.mocked(globalThis.setTimeout).mockClear();
  vi.mocked(globalThis.clearTimeout).mockClear();
  mockFit.mockClear();
  mockResizeTerminal.mockClear();
  mockResizeHeadlessTerminal.mockClear();

  return result;
}

describe("TerminalView resize effect", () => {
  beforeEach(() => {
    installSchedulingMocks();
    installVisibilityStubs();
    mockFit.mockClear();
    mockXtermWrite.mockClear();
    mockXtermOpen.mockClear();
    mockXtermDispose.mockClear();
    mockLoadAddon.mockClear();
    mockOnData.mockClear();
    mockSpawnTerminal.mockClear();
    mockResizeTerminal.mockClear();
    mockResizeHeadlessTerminal.mockClear();
    defaultProps.onTerminalSpawned.mockClear();
  });

  afterEach(() => {
    uninstallSchedulingMocks();
    uninstallVisibilityStubs();
  });

  describe("double-rAF + setTimeout timing", () => {
    it("schedules outer rAF when isVisible is true and refs are populated", async () => {
      await renderAndInit();

      // Trigger the resize effect by toggling visibility
      // The init already happened with isVisible=true, so the resize effect
      // ran once. We cleared mocks after init, so now rerender to trigger it.
      const { rerender } = await renderAndInit();

      // Toggle off then on to re-trigger the effect
      rerender(<TerminalView {...defaultProps} isVisible={false} />);

      vi.mocked(globalThis.requestAnimationFrame).mockClear();
      vi.mocked(globalThis.setTimeout).mockClear();

      rerender(<TerminalView {...defaultProps} isVisible={true} />);

      // Outer rAF should be scheduled
      expect(globalThis.requestAnimationFrame).toHaveBeenCalledTimes(1);
    });

    it("schedules inner rAF when outer rAF fires", async () => {
      const { rerender } = await renderAndInit();

      rerender(<TerminalView {...defaultProps} isVisible={false} />);
      vi.mocked(globalThis.requestAnimationFrame).mockClear();
      rerender(<TerminalView {...defaultProps} isVisible={true} />);

      // One outer rAF registered
      expect(globalThis.requestAnimationFrame).toHaveBeenCalledTimes(1);

      // Flush the outer rAF -- should register the inner rAF
      flushRafs();
      expect(globalThis.requestAnimationFrame).toHaveBeenCalledTimes(2);
    });

    it("schedules setTimeout with 50ms delay when inner rAF fires", async () => {
      const { rerender } = await renderAndInit();

      rerender(<TerminalView {...defaultProps} isVisible={false} />);
      vi.mocked(globalThis.requestAnimationFrame).mockClear();
      vi.mocked(globalThis.setTimeout).mockClear();
      rerender(<TerminalView {...defaultProps} isVisible={true} />);

      // No timeout yet
      expect(globalThis.setTimeout).not.toHaveBeenCalled();

      // Flush outer rAF
      flushRafs();
      // Still no timeout (inner rAF registered but not fired)
      expect(globalThis.setTimeout).not.toHaveBeenCalled();

      // Flush inner rAF
      flushRafs();
      // Now setTimeout should be called with 50ms delay
      expect(globalThis.setTimeout).toHaveBeenCalledTimes(1);
      expect(globalThis.setTimeout).toHaveBeenCalledWith(expect.any(Function), 50);
    });

    it("calls fitAddon.fit() when the full chain completes", async () => {
      const { rerender } = await renderAndInit();

      rerender(<TerminalView {...defaultProps} isVisible={false} />);
      mockFit.mockClear();
      rerender(<TerminalView {...defaultProps} isVisible={true} />);

      // Flush outer rAF, then inner rAF, then timeout
      flushRafs(); // outer
      flushRafs(); // inner
      flushTimeouts(); // setTimeout

      expect(mockFit).toHaveBeenCalledTimes(1);
    });

    it("calls resizeTerminal with terminal dimensions after fit", async () => {
      const { rerender } = await renderAndInit();

      rerender(<TerminalView {...defaultProps} isVisible={false} />);
      mockResizeTerminal.mockClear();
      rerender(<TerminalView {...defaultProps} isVisible={true} />);

      flushRafs(); // outer
      flushRafs(); // inner
      flushTimeouts();

      expect(mockResizeTerminal).toHaveBeenCalledTimes(1);
      expect(mockResizeTerminal).toHaveBeenCalledWith("term-123", 24, 80);
    });

    it("does not call fit before timeout fires", async () => {
      const { rerender } = await renderAndInit();

      rerender(<TerminalView {...defaultProps} isVisible={false} />);
      mockFit.mockClear();
      rerender(<TerminalView {...defaultProps} isVisible={true} />);

      // After outer rAF only
      flushRafs();
      expect(mockFit).not.toHaveBeenCalled();

      // After inner rAF (timeout scheduled but not fired)
      flushRafs();
      expect(mockFit).not.toHaveBeenCalled();
    });
  });

  describe("cleanup on visibility change", () => {
    it("calls cancelAnimationFrame for outer rAF when isVisible becomes false", async () => {
      const { rerender } = await renderAndInit();

      rerender(<TerminalView {...defaultProps} isVisible={false} />);
      vi.mocked(globalThis.cancelAnimationFrame).mockClear();
      vi.mocked(globalThis.clearTimeout).mockClear();
      rerender(<TerminalView {...defaultProps} isVisible={true} />);

      // rAFs are pending, now toggle off
      vi.mocked(globalThis.cancelAnimationFrame).mockClear();
      rerender(<TerminalView {...defaultProps} isVisible={false} />);

      // Should cancel both rAF IDs (outer and inner, though inner may not have been assigned yet)
      expect(globalThis.cancelAnimationFrame).toHaveBeenCalled();
    });

    it("calls clearTimeout when cleanup runs", async () => {
      const { rerender } = await renderAndInit();

      rerender(<TerminalView {...defaultProps} isVisible={false} />);
      vi.mocked(globalThis.clearTimeout).mockClear();
      rerender(<TerminalView {...defaultProps} isVisible={true} />);

      // Advance past both rAFs to schedule the timeout
      flushRafs(); // outer
      flushRafs(); // inner

      vi.mocked(globalThis.clearTimeout).mockClear();
      rerender(<TerminalView {...defaultProps} isVisible={false} />);

      expect(globalThis.clearTimeout).toHaveBeenCalled();
    });

    it("cancels both rAFs and the timeout when cleanup runs after full chain is scheduled", async () => {
      const { rerender } = await renderAndInit();

      rerender(<TerminalView {...defaultProps} isVisible={false} />);
      vi.mocked(globalThis.cancelAnimationFrame).mockClear();
      vi.mocked(globalThis.clearTimeout).mockClear();
      rerender(<TerminalView {...defaultProps} isVisible={true} />);

      // Let the full chain schedule
      flushRafs(); // outer
      flushRafs(); // inner -- timeout now scheduled

      vi.mocked(globalThis.cancelAnimationFrame).mockClear();
      vi.mocked(globalThis.clearTimeout).mockClear();

      // Cleanup
      rerender(<TerminalView {...defaultProps} isVisible={false} />);

      expect(globalThis.cancelAnimationFrame).toHaveBeenCalledTimes(2);
      expect(globalThis.clearTimeout).toHaveBeenCalledTimes(1);
    });
  });

  describe("no-op when not visible", () => {
    it("does not schedule rAF when isVisible is false", async () => {
      // Render initially visible to populate refs
      const { rerender } = await renderAndInit();

      // Now go invisible
      rerender(<TerminalView {...defaultProps} isVisible={false} />);

      vi.mocked(globalThis.requestAnimationFrame).mockClear();

      // Re-render still invisible -- effect should not schedule anything
      rerender(
        <TerminalView {...defaultProps} isVisible={false} expanded={true} />
      );

      expect(globalThis.requestAnimationFrame).not.toHaveBeenCalled();
    });

    it("does not schedule setTimeout when isVisible is false", async () => {
      const { rerender } = await renderAndInit();
      rerender(<TerminalView {...defaultProps} isVisible={false} />);

      vi.mocked(globalThis.setTimeout).mockClear();
      rerender(
        <TerminalView {...defaultProps} isVisible={false} expanded={true} />
      );

      expect(globalThis.setTimeout).not.toHaveBeenCalled();
    });
  });

  describe("guard clause: refs not yet populated", () => {
    it("does not schedule rAF when rendered visible before spawn completes", () => {
      // Render with isVisible=true but DON'T await spawn resolution.
      // This means terminalIdRef is still null -- the guard should skip the resize effect.
      vi.mocked(globalThis.requestAnimationFrame).mockClear();

      render(<TerminalView {...defaultProps} isVisible={true} />);

      // The init effect schedules one rAF for the initial fit (line 94 in TerminalView).
      // The resize effect should NOT schedule an additional rAF because terminalIdRef is null.
      // Total rAF count should be exactly 1 (from init), not 2.
      expect(globalThis.requestAnimationFrame).toHaveBeenCalledTimes(1);
    });
  });

  describe("cancelled flag prevents stale execution", () => {
    it("does not call fit when cleanup clears the timeout before it fires", async () => {
      const { rerender } = await renderAndInit();

      rerender(<TerminalView {...defaultProps} isVisible={false} />);
      mockFit.mockClear();
      rerender(<TerminalView {...defaultProps} isVisible={true} />);

      // Advance through both rAFs, timeout is now scheduled
      flushRafs(); // outer
      flushRafs(); // inner

      // Cleanup runs (sets cancelled = true, clears timeout)
      rerender(<TerminalView {...defaultProps} isVisible={false} />);

      // flushTimeouts only runs callbacks still in the map -- cleanup removed them.
      // This verifies that clearTimeout was properly called by the cleanup function.
      flushTimeouts();

      expect(mockFit).not.toHaveBeenCalled();
    });

    it("does not call fit even if timeout callback is invoked after cancellation", async () => {
      const { rerender } = await renderAndInit();

      rerender(<TerminalView {...defaultProps} isVisible={false} />);
      mockFit.mockClear();
      rerender(<TerminalView {...defaultProps} isVisible={true} />);

      // Advance through both rAFs so the timeout is scheduled
      flushRafs(); // outer
      flushRafs(); // inner

      // Capture the timeout callback BEFORE cleanup removes it
      const capturedCallbacks = Array.from(timeoutCallbacks.values()).map(
        (entry) => entry.fn
      );
      expect(capturedCallbacks.length).toBe(1);

      // Now cleanup runs -- sets cancelled = true and clears timeout
      rerender(<TerminalView {...defaultProps} isVisible={false} />);

      // Manually invoke the captured callback (simulating a race where clearTimeout
      // doesn't prevent execution). The cancelled flag should guard against this.
      capturedCallbacks[0]();

      expect(mockFit).not.toHaveBeenCalled();
    });

    it("does not call resizeTerminal when cleanup runs before timeout fires", async () => {
      const { rerender } = await renderAndInit();

      rerender(<TerminalView {...defaultProps} isVisible={false} />);
      mockResizeTerminal.mockClear();
      rerender(<TerminalView {...defaultProps} isVisible={true} />);

      flushRafs(); // outer
      flushRafs(); // inner

      // Capture callback before cleanup
      const capturedCallbacks = Array.from(timeoutCallbacks.values()).map(
        (entry) => entry.fn
      );

      rerender(<TerminalView {...defaultProps} isVisible={false} />);

      // Invoke the captured callback despite cancellation
      capturedCallbacks[0]();

      expect(mockResizeTerminal).not.toHaveBeenCalled();
    });
  });

  describe("dependency triggers", () => {
    it("re-triggers the resize effect when expanded prop changes", async () => {
      const { rerender } = await renderAndInit();

      // Clear from init
      vi.mocked(globalThis.requestAnimationFrame).mockClear();

      // Change expanded while visible
      rerender(
        <TerminalView {...defaultProps} isVisible={true} expanded={true} />
      );

      expect(globalThis.requestAnimationFrame).toHaveBeenCalledTimes(1);
    });

    it("re-triggers when expanded toggles back", async () => {
      const { rerender } = await renderAndInit();

      rerender(
        <TerminalView {...defaultProps} isVisible={true} expanded={true} />
      );
      flushRafs(); // outer
      flushRafs(); // inner
      flushTimeouts();

      vi.mocked(globalThis.requestAnimationFrame).mockClear();
      mockFit.mockClear();

      rerender(
        <TerminalView {...defaultProps} isVisible={true} expanded={false} />
      );

      expect(globalThis.requestAnimationFrame).toHaveBeenCalledTimes(1);

      flushRafs(); // outer
      flushRafs(); // inner
      flushTimeouts();

      expect(mockFit).toHaveBeenCalledTimes(1);
    });

    it("uses resizeHeadlessTerminal for headless-promoted tabs", async () => {
      const headlessTab = makeTab({
        isHeadlessPromoted: true,
        headlessTerminalId: "headless-42",
      });

      const { rerender } = await renderAndInit({
        tab: headlessTab,
      });

      rerender(
        <TerminalView
          {...defaultProps}
          tab={headlessTab}
          isVisible={false}
        />
      );

      mockResizeHeadlessTerminal.mockClear();
      mockResizeTerminal.mockClear();

      rerender(
        <TerminalView
          {...defaultProps}
          tab={headlessTab}
          isVisible={true}
        />
      );

      flushRafs(); // outer
      flushRafs(); // inner
      flushTimeouts();

      expect(mockResizeHeadlessTerminal).toHaveBeenCalledTimes(1);
      expect(mockResizeHeadlessTerminal).toHaveBeenCalledWith("headless-42", 24, 80);
      expect(mockResizeTerminal).not.toHaveBeenCalled();
    });
  });

  describe("cleanup on unmount", () => {
    it("cancels pending rAFs and timeouts when component unmounts", async () => {
      const { rerender, unmount } = await renderAndInit();

      // Toggle visibility to trigger the resize effect with pending rAFs
      rerender(<TerminalView {...defaultProps} isVisible={false} />);
      vi.mocked(globalThis.cancelAnimationFrame).mockClear();
      vi.mocked(globalThis.clearTimeout).mockClear();
      rerender(<TerminalView {...defaultProps} isVisible={true} />);

      // Resize effect has scheduled outer rAF. Now unmount while it's pending.
      vi.mocked(globalThis.cancelAnimationFrame).mockClear();
      vi.mocked(globalThis.clearTimeout).mockClear();

      unmount();

      // Unmount should trigger cleanup of the resize effect
      expect(globalThis.cancelAnimationFrame).toHaveBeenCalled();
      expect(globalThis.clearTimeout).toHaveBeenCalled();
    });

    it("does not call fit after unmount even if rAF chain was in progress", async () => {
      const { rerender, unmount } = await renderAndInit();

      // Toggle visibility to trigger resize effect
      rerender(<TerminalView {...defaultProps} isVisible={false} />);
      mockFit.mockClear();
      rerender(<TerminalView {...defaultProps} isVisible={true} />);

      // Advance to inner rAF so timeout is scheduled
      flushRafs(); // outer
      flushRafs(); // inner

      mockFit.mockClear();
      unmount();

      // Even though timeout was scheduled, it was cleared by cleanup
      flushTimeouts();

      expect(mockFit).not.toHaveBeenCalled();
    });
  });
});

describe("TerminalView theme-aware terminal creation", () => {
  const MockedTerminal = vi.mocked(Terminal);

  beforeEach(() => {
    installSchedulingMocks();
    mockFit.mockClear();
    mockXtermWrite.mockClear();
    mockXtermOpen.mockClear();
    mockXtermDispose.mockClear();
    mockLoadAddon.mockClear();
    mockOnData.mockClear();
    mockSpawnTerminal.mockClear();
    mockResizeTerminal.mockClear();
    mockResizeHeadlessTerminal.mockClear();
    defaultProps.onTerminalSpawned.mockClear();
    MockedTerminal.mockClear();
    // Reset DOM theme
    delete document.documentElement.dataset.theme;
  });

  afterEach(() => {
    uninstallSchedulingMocks();
    delete document.documentElement.dataset.theme;
  });

  it("creates terminal with light theme when data-theme is not set", () => {
    // No theme set on document -- defaults to light
    render(<TerminalView {...defaultProps} isVisible={true} />);

    expect(MockedTerminal).toHaveBeenCalledTimes(1);
    const constructorArgs = MockedTerminal.mock.calls[0][0];
    expect(constructorArgs.theme.background).toBe("#fefdf2");
    expect(constructorArgs.theme.foreground).toBe("#1a1a1a");
    expect(constructorArgs.theme.cursor).toBe("#05c250");
  });

  it("creates terminal with dark theme when data-theme is 'dark'", () => {
    document.documentElement.dataset.theme = "dark";

    render(<TerminalView {...defaultProps} isVisible={true} />);

    expect(MockedTerminal).toHaveBeenCalledTimes(1);
    const constructorArgs = MockedTerminal.mock.calls[0][0];
    expect(constructorArgs.theme.background).toBe("#0D0D0D");
    expect(constructorArgs.theme.foreground).toBe("#E0E0E0");
  });

  it("creates terminal with light theme when data-theme is 'light'", () => {
    document.documentElement.dataset.theme = "light";

    render(<TerminalView {...defaultProps} isVisible={true} />);

    expect(MockedTerminal).toHaveBeenCalledTimes(1);
    const constructorArgs = MockedTerminal.mock.calls[0][0];
    expect(constructorArgs.theme.background).toBe("#fefdf2");
    expect(constructorArgs.theme.foreground).toBe("#1a1a1a");
    expect(constructorArgs.theme.cursor).toBe("#05c250");
  });

  it("light theme has distinct selection and color palette from dark theme", () => {
    document.documentElement.dataset.theme = "light";

    render(<TerminalView {...defaultProps} isVisible={true} />);

    const constructorArgs = MockedTerminal.mock.calls[0][0];
    expect(constructorArgs.theme.selectionBackground).toBe("#05c25040");
    expect(constructorArgs.theme.cursorAccent).toBe("#fefdf2");
    expect(constructorArgs.theme.green).toBe("#047d34");
  });
});

describe("TerminalView reactive theme switching", () => {
  const MockedTerminal = vi.mocked(Terminal);

  beforeEach(() => {
    installSchedulingMocks();
    mockFit.mockClear();
    mockXtermWrite.mockClear();
    mockXtermOpen.mockClear();
    mockXtermDispose.mockClear();
    mockLoadAddon.mockClear();
    mockOnData.mockClear();
    mockSpawnTerminal.mockClear();
    mockResizeTerminal.mockClear();
    mockResizeHeadlessTerminal.mockClear();
    defaultProps.onTerminalSpawned.mockClear();
    MockedTerminal.mockClear();
    delete document.documentElement.dataset.theme;
  });

  afterEach(() => {
    uninstallSchedulingMocks();
    delete document.documentElement.dataset.theme;
  });

  it("does not apply theme on initial mount even when currentTheme is provided (themeInitializedRef skips first effect run)", async () => {
    // Render with an explicit currentTheme so the guard on line 234
    // (if xtermRef.current && currentTheme) would pass — the only thing
    // preventing application is themeInitializedRef being false on mount.
    const onTerminalSpawned = vi.fn();
    const tab = makeTab();

    // We can't use renderAndInit here because it doesn't accept currentTheme.
    // Reset scheduling mocks before render.
    vi.mocked(globalThis.requestAnimationFrame).mockClear();
    vi.mocked(globalThis.setTimeout).mockClear();

    render(
      <TerminalView
        {...defaultProps}
        tab={tab}
        isVisible={true}
        onTerminalSpawned={onTerminalSpawned}
        currentTheme="dark"
      />
    );

    // Flush the init effect's rAF
    flushRafs();

    // Wait for spawnTerminal promise
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    // The reactive theme effect fired on mount with currentTheme="dark".
    // themeInitializedRef was false, so it should skip application.
    // Without the guard, options.theme would be set to darkTheme.
    expect(latestMockXtermOptions.theme).toBeUndefined();
  });

  it("applies dark theme on the first prop change after mount", async () => {
    const { rerender } = await renderAndInit({
      tab: makeTab(),
      isVisible: true,
      onTerminalSpawned: vi.fn(),
    });

    // Mount already happened (themeInitializedRef = true).
    // Changing currentTheme from undefined to "dark" triggers the effect,
    // which now passes the guard and applies darkTheme.
    rerender(<TerminalView {...defaultProps} isVisible={true} currentTheme="dark" />);

    expect(latestMockXtermOptions.theme).toBeDefined();
    expect((latestMockXtermOptions.theme as Record<string, string>).background).toBe("#0D0D0D");
    expect((latestMockXtermOptions.theme as Record<string, string>).foreground).toBe("#E0E0E0");
    expect((latestMockXtermOptions.theme as Record<string, string>).cursor).toBe("#FF6B00");
  });

  it("applies light theme when currentTheme changes to 'light'", async () => {
    const { rerender } = await renderAndInit({
      tab: makeTab(),
      isVisible: true,
      onTerminalSpawned: vi.fn(),
    });

    // First change triggers effect past guard, applies light theme
    rerender(<TerminalView {...defaultProps} isVisible={true} currentTheme="light" />);

    expect(latestMockXtermOptions.theme).toBeDefined();
    expect((latestMockXtermOptions.theme as Record<string, string>).background).toBe("#fefdf2");
    expect((latestMockXtermOptions.theme as Record<string, string>).foreground).toBe("#1a1a1a");
    expect((latestMockXtermOptions.theme as Record<string, string>).cursor).toBe("#05c250");
  });

  it("switches from dark to light theme on prop change", async () => {
    const { rerender } = await renderAndInit({
      tab: makeTab(),
      isVisible: true,
      onTerminalSpawned: vi.fn(),
    });

    rerender(<TerminalView {...defaultProps} isVisible={true} currentTheme="dark" />);
    expect((latestMockXtermOptions.theme as Record<string, string>).background).toBe("#0D0D0D");

    rerender(<TerminalView {...defaultProps} isVisible={true} currentTheme="light" />);
    expect((latestMockXtermOptions.theme as Record<string, string>).background).toBe("#fefdf2");
    expect((latestMockXtermOptions.theme as Record<string, string>).cursor).toBe("#05c250");
  });

  it("does not crash when xtermRef is null and currentTheme changes", () => {
    // Render with isVisible=false so the init effect never runs (xtermRef stays null)
    const { rerender } = render(
      <TerminalView {...defaultProps} isVisible={false} currentTheme="dark" />
    );

    // Change theme while xterm has not been initialized -- should not throw
    expect(() => {
      rerender(<TerminalView {...defaultProps} isVisible={false} currentTheme="light" />);
    }).not.toThrow();
  });

  it("applies theme correctly after multiple rapid toggles", async () => {
    const { rerender } = await renderAndInit({
      tab: makeTab(),
      isVisible: true,
      onTerminalSpawned: vi.fn(),
    });

    // Skip first effect
    rerender(<TerminalView {...defaultProps} isVisible={true} currentTheme="dark" />);

    // Rapid toggles
    rerender(<TerminalView {...defaultProps} isVisible={true} currentTheme="light" />);
    rerender(<TerminalView {...defaultProps} isVisible={true} currentTheme="dark" />);
    rerender(<TerminalView {...defaultProps} isVisible={true} currentTheme="light" />);

    // Final state should be light theme
    expect(latestMockXtermOptions.theme).toBeDefined();
    expect((latestMockXtermOptions.theme as Record<string, string>).background).toBe("#fefdf2");
  });

  it("does not apply theme when currentTheme is undefined", async () => {
    const { rerender } = await renderAndInit({
      tab: makeTab(),
      isVisible: true,
      onTerminalSpawned: vi.fn(),
    });

    // Skip initial effect
    rerender(<TerminalView {...defaultProps} isVisible={true} currentTheme="dark" />);

    // Change to light (applies)
    rerender(<TerminalView {...defaultProps} isVisible={true} currentTheme="light" />);
    expect(latestMockXtermOptions.theme).toBeDefined();

    // Reset to track next assignment
    latestMockXtermOptions = {};
    // Switching back to undefined prop means no theme passed
    // The effect's guard: if (xtermRef.current && currentTheme) prevents application
    rerender(<TerminalView {...defaultProps} isVisible={true} currentTheme={undefined} />);

    // The guard `currentTheme` is falsy so nothing is assigned
    expect(latestMockXtermOptions.theme).toBeUndefined();
  });
});
