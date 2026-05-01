import { vi } from "vitest";

/**
 * Shared mock for @tauri-apps/api/core.
 *
 * Usage in test files:
 *   import { mockInvoke } from "../../__test-utils__/tauri-mock";
 *   // mockInvoke is already wired as the invoke mock
 *   // Call mockInvoke.mockResolvedValue(...) etc. in your tests
 */
export const mockInvoke = vi.fn();
export const mockChannel = vi.fn().mockImplementation(() => ({
  onmessage: null as unknown,
}));
export const mockListen = vi.fn(() => Promise.resolve(() => {}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => mockInvoke(...args),
  Channel: mockChannel,
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: mockListen,
}));

/**
 * Call this in beforeEach to reset the mock state.
 *
 * After reset, `mockInvoke` resolves to `undefined` by default. This matters
 * because production code chains `.catch(...)` on the returned promise (e.g.
 * useSessionTracking's watcher cleanup), and a bare `vi.fn()` without an
 * implementation returns `undefined`, which would throw "Cannot read
 * properties of undefined (reading 'catch')". Tests that need a specific
 * return value still call `mockInvoke.mockResolvedValue(...)` and override
 * the default.
 */
export function resetTauriMocks() {
  mockInvoke.mockReset();
  mockInvoke.mockResolvedValue(undefined);
  mockChannel.mockClear();
  mockListen.mockClear();
  mockListen.mockImplementation(() => Promise.resolve(() => {}));
}
