import { describe, it, expect, beforeEach } from "vitest";
import { mockInvoke, mockChannel, resetTauriMocks } from "../../__test-utils__/tauri-mock";
import {
  spawnHeadlessTerminal,
  getTerminalBuffer,
  attachTerminalChannel,
  writeToHeadlessTerminal,
  resizeHeadlessTerminal,
  closeHeadlessTerminal,
  getAllHeadlessStatuses,
} from "../terminal-service";

beforeEach(() => {
  resetTauriMocks();
});

describe("headless terminal service", () => {
  describe("spawnHeadlessTerminal", () => {
    it("invokes spawn_headless_terminal with correct args", async () => {
      mockInvoke.mockResolvedValue("headless-123");

      const result = await spawnHeadlessTerminal("/home/user/project", null);

      expect(result).toBe("headless-123");
      expect(mockInvoke).toHaveBeenCalledWith("spawn_headless_terminal", {
        projectPath: "/home/user/project",
        initialCommand: null,
        model: null,
        effort: null,
      });
    });

    it("passes initialCommand when provided", async () => {
      mockInvoke.mockResolvedValue("headless-456");

      await spawnHeadlessTerminal("/path", "run init");

      expect(mockInvoke).toHaveBeenCalledWith("spawn_headless_terminal", {
        projectPath: "/path",
        initialCommand: "run init",
        model: null,
        effort: null,
      });
    });
  });

  describe("getTerminalBuffer", () => {
    it("invokes get_terminal_buffer and returns buffer data", async () => {
      const bufferData = [72, 101, 108, 108, 111]; // "Hello"
      mockInvoke.mockResolvedValue(bufferData);

      const result = await getTerminalBuffer("headless-123");

      expect(result).toEqual(bufferData);
      expect(mockInvoke).toHaveBeenCalledWith("get_terminal_buffer", {
        terminalId: "headless-123",
      });
    });
  });

  describe("attachTerminalChannel", () => {
    it("invokes attach_terminal_channel with a channel and returns buffer", async () => {
      const mockBuffer = [72, 101, 108, 108, 111];
      mockInvoke.mockResolvedValue(mockBuffer);
      const onEvent = () => {};

      const result = await attachTerminalChannel("headless-123", onEvent);

      expect(mockInvoke).toHaveBeenCalledWith("attach_terminal_channel", {
        terminalId: "headless-123",
        onEvent: expect.any(Object),
      });
      expect(result).toEqual(mockBuffer);
    });

    it("sets channel onmessage to the callback", async () => {
      mockInvoke.mockResolvedValue([]);
      const onEvent = () => {};

      await attachTerminalChannel("headless-123", onEvent);

      const channelInstance = mockChannel.mock.results[0].value;
      expect(channelInstance.onmessage).toBe(onEvent);
    });
  });

  describe("writeToHeadlessTerminal", () => {
    it("invokes write_to_headless_terminal with correct args", async () => {
      mockInvoke.mockResolvedValue(undefined);

      await writeToHeadlessTerminal("headless-123", "some input\n");

      expect(mockInvoke).toHaveBeenCalledWith("write_to_headless_terminal", {
        terminalId: "headless-123",
        data: "some input\n",
      });
    });
  });

  describe("resizeHeadlessTerminal", () => {
    it("invokes resize_headless_terminal with correct args", async () => {
      mockInvoke.mockResolvedValue(undefined);

      await resizeHeadlessTerminal("headless-123", 40, 120);

      expect(mockInvoke).toHaveBeenCalledWith("resize_headless_terminal", {
        terminalId: "headless-123",
        rows: 40,
        cols: 120,
      });
    });
  });

  describe("closeHeadlessTerminal", () => {
    it("invokes close_headless_terminal with correct args", async () => {
      mockInvoke.mockResolvedValue(undefined);

      await closeHeadlessTerminal("headless-123");

      expect(mockInvoke).toHaveBeenCalledWith("close_headless_terminal", {
        terminalId: "headless-123",
      });
    });
  });

  describe("getAllHeadlessStatuses", () => {
    it("invokes get_all_headless_statuses and returns statuses", async () => {
      const statuses = [
        {
          terminalId: "t1",
          needsAttention: false,
          exited: false,
          exitCode: null,
          bufferSize: 500,
        },
        {
          terminalId: "t2",
          needsAttention: true,
          exited: false,
          exitCode: null,
          bufferSize: 1200,
        },
      ];
      mockInvoke.mockResolvedValue(statuses);

      const result = await getAllHeadlessStatuses();

      expect(result).toEqual(statuses);
      expect(mockInvoke).toHaveBeenCalledWith("get_all_headless_statuses");
    });

    it("returns empty array when no headless terminals exist", async () => {
      mockInvoke.mockResolvedValue([]);

      const result = await getAllHeadlessStatuses();

      expect(result).toEqual([]);
    });
  });
});
