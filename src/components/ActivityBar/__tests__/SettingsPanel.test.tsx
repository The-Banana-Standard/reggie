import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
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

    // Click the confirm button inside the modal (second one with this label).
    const confirmButtons = screen.getAllByRole("button", {
      name: "Remove Reggie Files",
    });
    // The modal's confirm button is the last one rendered.
    fireEvent.click(confirmButtons[confirmButtons.length - 1]);

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

    const confirmButtons = screen.getAllByRole("button", {
      name: "Remove Reggie Files",
    });
    fireEvent.click(confirmButtons[confirmButtons.length - 1]);

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

    const confirmButtons = screen.getAllByRole("button", {
      name: "Remove Reggie Files",
    });
    fireEvent.click(confirmButtons[confirmButtons.length - 1]);

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

    const confirmButtons = screen.getAllByRole("button", {
      name: "Remove Reggie Files",
    });
    fireEvent.click(confirmButtons[confirmButtons.length - 1]);

    expect(await screen.findByText(/Failed:.*permission denied/)).toBeTruthy();
  });
});
