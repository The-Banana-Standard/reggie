import { describe, it, expect, beforeEach, vi } from "vitest";
import { act, render, screen, fireEvent, waitFor } from "@testing-library/react";
import { resetTauriMocks, mockInvoke } from "../../../__test-utils__/tauri-mock";
import { SettingsPanel } from "../SettingsPanel";

const fakeStatus = {
  version: "1.1.2",
  bundledVersion: "1.1.2",
  needsSetup: false,
  agentCount: 37,
  commandCount: 36,
  hookCount: 1,
  toolSearchConfigured: true,
};

const fakeReport = {
  filesRemoved: [
    "/Users/test/.claude/agents/reggie-architect.md",
    "/Users/test/.claude/commands/reggie-plan.md",
    "/Users/test/.claude/hooks/track-stats.sh",
  ],
  settingsHookRemoved: true,
  shellProfileRemoved: false,
  versionFileRemoved: true,
  overlaysPreserved: ["/Users/test/.claude/mcp-registry.local.yaml"],
};

/**
 * Route mount-time invoke calls (get_detailed_install_status,
 * get_shell_export_line) through a dispatcher so any test-time call can be
 * layered on top via mockResolvedValueOnce / mockRejectedValueOnce.
 */
function setupDefaultMocks() {
  mockInvoke.mockImplementation((cmd: string) => {
    switch (cmd) {
      case "get_detailed_install_status":
        return Promise.resolve(fakeStatus);
      case "get_shell_export_line":
        return Promise.resolve("export ENABLE_TOOL_SEARCH=auto:5");
      default:
        return Promise.reject(new Error(`Unexpected invoke: ${cmd}`));
    }
  });
}

beforeEach(() => {
  resetTauriMocks();
  setupDefaultMocks();
});

describe("SettingsPanel Danger Zone", () => {
  it("renders Danger Zone section and Remove Reggie Files button", async () => {
    render(<SettingsPanel />);

    expect(await screen.findByText("Danger Zone")).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Remove Reggie Files" })
    ).toBeTruthy();
  });

  it("opens modal when Remove Reggie Files button is clicked", async () => {
    render(<SettingsPanel />);

    const button = await screen.findByRole("button", {
      name: "Remove Reggie Files",
    });
    fireEvent.click(button);

    expect(await screen.findByText("Remove Reggie Files?")).toBeTruthy();
  });

  it("cancel closes modal without invoking uninstall_reggie_files", async () => {
    render(<SettingsPanel />);

    fireEvent.click(
      await screen.findByRole("button", { name: "Remove Reggie Files" })
    );
    expect(await screen.findByText("Remove Reggie Files?")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    await waitFor(() => {
      expect(screen.queryByText("Remove Reggie Files?")).toBeNull();
    });

    const uninstallCalls = mockInvoke.mock.calls.filter(
      (call) => call[0] === "uninstall_reggie_files"
    );
    expect(uninstallCalls.length).toBe(0);
  });

  it("confirm invokes uninstall_reggie_files with removeShellProfile=false by default", async () => {
    render(<SettingsPanel />);

    fireEvent.click(
      await screen.findByRole("button", { name: "Remove Reggie Files" })
    );
    await screen.findByText("Remove Reggie Files?");

    // Override the default dispatcher so uninstall_reggie_files resolves.
    mockInvoke.mockImplementationOnce((cmd: string) => {
      if (cmd === "uninstall_reggie_files") return Promise.resolve(fakeReport);
      return Promise.reject(new Error(`Unexpected invoke: ${cmd}`));
    });

    fireEvent.click(
      screen.getByRole("button", { name: /confirm remove reggie files/i })
    );

    await waitFor(() => {
      const uninstallCalls = mockInvoke.mock.calls.filter(
        (call) => call[0] === "uninstall_reggie_files"
      );
      expect(uninstallCalls.length).toBe(1);
      expect(uninstallCalls[0][1]).toEqual({ removeShellProfile: false });
    });
  });

  it("checkbox toggles removeShellProfile arg passed to invoke", async () => {
    render(<SettingsPanel />);

    fireEvent.click(
      await screen.findByRole("button", { name: "Remove Reggie Files" })
    );
    await screen.findByText("Remove Reggie Files?");

    const checkbox = screen.getByRole("checkbox") as HTMLInputElement;
    fireEvent.click(checkbox);
    expect(checkbox.checked).toBe(true);

    mockInvoke.mockImplementationOnce((cmd: string) => {
      if (cmd === "uninstall_reggie_files") return Promise.resolve(fakeReport);
      return Promise.reject(new Error(`Unexpected invoke: ${cmd}`));
    });

    fireEvent.click(
      screen.getByRole("button", { name: /confirm remove reggie files/i })
    );

    await waitFor(() => {
      const uninstallCalls = mockInvoke.mock.calls.filter(
        (call) => call[0] === "uninstall_reggie_files"
      );
      expect(uninstallCalls.length).toBe(1);
      expect(uninstallCalls[0][1]).toEqual({ removeShellProfile: true });
    });
  });

  it("displays success summary with file count after command resolves", async () => {
    render(<SettingsPanel />);

    fireEvent.click(
      await screen.findByRole("button", { name: "Remove Reggie Files" })
    );
    await screen.findByText("Remove Reggie Files?");

    mockInvoke.mockImplementationOnce((cmd: string) => {
      if (cmd === "uninstall_reggie_files") return Promise.resolve(fakeReport);
      return Promise.reject(new Error(`Unexpected invoke: ${cmd}`));
    });

    fireEvent.click(
      screen.getByRole("button", { name: /confirm remove reggie files/i })
    );

    expect(await screen.findByText(/Removed 3 files\./)).toBeTruthy();
    // Close button appears after success.
    expect(screen.getByRole("button", { name: "Close" })).toBeTruthy();
  });

  it("displays error state when uninstall_reggie_files rejects", async () => {
    render(<SettingsPanel />);

    fireEvent.click(
      await screen.findByRole("button", { name: "Remove Reggie Files" })
    );
    await screen.findByText("Remove Reggie Files?");

    mockInvoke.mockImplementationOnce((cmd: string) => {
      if (cmd === "uninstall_reggie_files")
        return Promise.reject(new Error("permission denied"));
      return Promise.reject(new Error(`Unexpected invoke: ${cmd}`));
    });

    fireEvent.click(
      screen.getByRole("button", { name: /confirm remove reggie files/i })
    );

    expect(await screen.findByText(/Failed:.*permission denied/)).toBeTruthy();
  });

  it("closes modal when Escape is pressed", async () => {
    render(<SettingsPanel />);

    fireEvent.click(
      await screen.findByRole("button", { name: "Remove Reggie Files" })
    );
    expect(await screen.findByText("Remove Reggie Files?")).toBeTruthy();

    fireEvent.keyDown(window, { key: "Escape" });

    await waitFor(() => {
      expect(screen.queryByText("Remove Reggie Files?")).toBeNull();
    });
  });

  it("closes modal when overlay background is clicked", async () => {
    render(<SettingsPanel />);

    fireEvent.click(
      await screen.findByRole("button", { name: "Remove Reggie Files" })
    );
    const dialog = await screen.findByRole("dialog");

    // Click the overlay itself (the dialog element).
    fireEvent.click(dialog);

    await waitFor(() => {
      expect(screen.queryByText("Remove Reggie Files?")).toBeNull();
    });
  });

  it("Escape does not close modal mid-uninstall", async () => {
    render(<SettingsPanel />);

    fireEvent.click(
      await screen.findByRole("button", { name: "Remove Reggie Files" })
    );
    await screen.findByText("Remove Reggie Files?");

    // Hold uninstall in flight so state stays "uninstalling".
    let resolveUninstall: ((v: unknown) => void) | undefined;
    mockInvoke.mockImplementationOnce(
      (cmd: string) =>
        new Promise((resolve, reject) => {
          if (cmd === "uninstall_reggie_files") {
            resolveUninstall = resolve;
          } else {
            reject(new Error(`Unexpected invoke: ${cmd}`));
          }
        })
    );

    fireEvent.click(
      screen.getByRole("button", { name: /confirm remove reggie files/i })
    );
    await screen.findByText("Removing...");

    fireEvent.keyDown(window, { key: "Escape" });

    expect(screen.getByText("Remove Reggie Files?")).toBeTruthy();

    // Cleanup so the pending promise doesn't leak.
    resolveUninstall?.(fakeReport);
  });
});

describe("SettingsPanel reinstall auto-reset", () => {
  it("clears reinstall success message after ~2.5s", async () => {
    mockInvoke.mockImplementation((cmd: string) => {
      switch (cmd) {
        case "get_detailed_install_status":
          return Promise.resolve(fakeStatus);
        case "get_shell_export_line":
          return Promise.resolve("export ENABLE_TOOL_SEARCH=auto:5");
        case "force_reinstall":
          return Promise.resolve({
            installed: true,
            version: "1.1.2",
            needsSetup: false,
            message: "Reinstalled successfully",
          });
        default:
          return Promise.reject(new Error(`Unexpected invoke: ${cmd}`));
      }
    });

    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      render(<SettingsPanel />);
      const reinstallBtn = await screen.findByRole("button", {
        name: "Reinstall",
      });
      fireEvent.click(reinstallBtn);

      await screen.findByText("Reinstalled successfully");
      expect(
        screen.getByRole("button", { name: "Reinstalled" })
      ).toBeTruthy();

      await act(async () => {
        await vi.advanceTimersByTimeAsync(2600);
      });

      expect(screen.queryByText("Reinstalled successfully")).toBeNull();
      expect(screen.getByRole("button", { name: "Reinstall" })).toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
  });

  it("clears reinstall error message after ~2.5s", async () => {
    mockInvoke.mockImplementation((cmd: string) => {
      switch (cmd) {
        case "get_detailed_install_status":
          return Promise.resolve(fakeStatus);
        case "get_shell_export_line":
          return Promise.resolve("export ENABLE_TOOL_SEARCH=auto:5");
        case "force_reinstall":
          return Promise.reject(new Error("install blew up"));
        default:
          return Promise.reject(new Error(`Unexpected invoke: ${cmd}`));
      }
    });

    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      render(<SettingsPanel />);
      fireEvent.click(
        await screen.findByRole("button", { name: "Reinstall" })
      );

      await screen.findByText(/Failed:.*install blew up/);

      await act(async () => {
        await vi.advanceTimersByTimeAsync(2600);
      });

      expect(screen.queryByText(/Failed:/)).toBeNull();
      expect(screen.getByRole("button", { name: "Reinstall" })).toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
  });
});
