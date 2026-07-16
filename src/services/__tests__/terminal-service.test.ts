import { describe, it, expect, vi, beforeEach } from "vitest";
import { mockInvoke, mockChannel, resetTauriMocks } from "../../__test-utils__/tauri-mock";
import {
  spawnTerminal,
  writeToTerminal,
  resizeTerminal,
  closeTerminal,
  checkClaudeCli,
  checkCodexCli,
  spawnHeadlessTerminal,
} from "../terminal-service";

beforeEach(() => {
  resetTauriMocks();
});

describe("terminal-service", () => {
  describe("spawnTerminal", () => {
    it("invokes spawn_terminal with correct args", async () => {
      mockInvoke.mockResolvedValue("term-123");
      const onEvent = vi.fn();

      const result = await spawnTerminal(
        "/home/user/project",
        true,
        false,
        "session-1",
        onEvent
      );

      expect(result).toBe("term-123");
      expect(mockInvoke).toHaveBeenCalledWith("spawn_terminal", {
        projectPath: "/home/user/project",
        isClaudeSession: true,
        isCodexSession: false,
        sessionId: "session-1",
        initialCommand: null,
        systemPrompt: null,
        model: null,
        effort: null,
        onEvent: expect.any(Object),
      });
    });

    it("passes initialCommand and systemPrompt when provided", async () => {
      mockInvoke.mockResolvedValue("term-456");
      const onEvent = vi.fn();

      await spawnTerminal(
        "/path",
        false,
        false,
        null,
        onEvent,
        "echo hello",
        "You are helpful"
      );

      expect(mockInvoke).toHaveBeenCalledWith("spawn_terminal", {
        projectPath: "/path",
        isClaudeSession: false,
        isCodexSession: false,
        sessionId: null,
        initialCommand: "echo hello",
        systemPrompt: "You are helpful",
        model: null,
        effort: null,
        onEvent: expect.any(Object),
      });
    });

    it("passes model and effort when provided", async () => {
      mockInvoke.mockResolvedValue("term-model");
      const onEvent = vi.fn();

      await spawnTerminal(
        "/path",
        true,
        false,
        "s-1",
        onEvent,
        null,
        null,
        "opus",
        "high"
      );

      expect(mockInvoke).toHaveBeenCalledWith("spawn_terminal", {
        projectPath: "/path",
        isClaudeSession: true,
        isCodexSession: false,
        sessionId: "s-1",
        initialCommand: null,
        systemPrompt: null,
        model: "opus",
        effort: "high",
        onEvent: expect.any(Object),
      });
    });

    it("sets channel onmessage to the callback", async () => {
      mockInvoke.mockResolvedValue("term-789");
      const onEvent = vi.fn();

      await spawnTerminal("/path", false, false, null, onEvent);

      const channelInstance = mockChannel.mock.results[0].value;
      expect(channelInstance.onmessage).toBe(onEvent);
    });

    it("marks Codex sessions explicitly", async () => {
      mockInvoke.mockResolvedValue("codex-term");

      await spawnTerminal("/path", false, true, null, vi.fn());

      expect(mockInvoke).toHaveBeenCalledWith("spawn_terminal", expect.objectContaining({
        projectPath: "/path",
        isClaudeSession: false,
        isCodexSession: true,
      }));
    });
  });

  describe("writeToTerminal", () => {
    it("invokes write_to_terminal with correct args", async () => {
      mockInvoke.mockResolvedValue(undefined);
      await writeToTerminal("term-123", "hello\n");
      expect(mockInvoke).toHaveBeenCalledWith("write_to_terminal", {
        terminalId: "term-123",
        data: "hello\n",
      });
    });
  });

  describe("resizeTerminal", () => {
    it("invokes resize_terminal with correct args", async () => {
      mockInvoke.mockResolvedValue(undefined);
      await resizeTerminal("term-123", 24, 80);
      expect(mockInvoke).toHaveBeenCalledWith("resize_terminal", {
        terminalId: "term-123",
        rows: 24,
        cols: 80,
      });
    });
  });

  describe("closeTerminal", () => {
    it("invokes close_terminal with correct args", async () => {
      mockInvoke.mockResolvedValue(undefined);
      await closeTerminal("term-123");
      expect(mockInvoke).toHaveBeenCalledWith("close_terminal", {
        terminalId: "term-123",
      });
    });
  });

  describe("spawnHeadlessTerminal", () => {
    it("invokes spawn_headless_terminal with model and effort null by default", async () => {
      mockInvoke.mockResolvedValue("ht-1");

      const result = await spawnHeadlessTerminal("/path", "/init-tasks");

      expect(result).toBe("ht-1");
      expect(mockInvoke).toHaveBeenCalledWith("spawn_headless_terminal", {
        projectPath: "/path",
        initialCommand: "/init-tasks",
        model: null,
        effort: null,
      });
    });

    it("passes model and effort when provided", async () => {
      mockInvoke.mockResolvedValue("ht-2");

      await spawnHeadlessTerminal("/path", "/code-workflow", "sonnet", "medium");

      expect(mockInvoke).toHaveBeenCalledWith("spawn_headless_terminal", {
        projectPath: "/path",
        initialCommand: "/code-workflow",
        model: "sonnet",
        effort: "medium",
      });
    });
  });

  describe("checkClaudeCli", () => {
    it("invokes check_claude_cli and returns result", async () => {
      const expected = { available: true, path: "/usr/local/bin/claude" };
      mockInvoke.mockResolvedValue(expected);
      const result = await checkClaudeCli();
      expect(result).toEqual(expected);
      expect(mockInvoke).toHaveBeenCalledWith("check_claude_cli");
    });
  });

  describe("checkCodexCli", () => {
    it("invokes check_codex_cli and returns result", async () => {
      const expected = { available: true, path: "/opt/homebrew/bin/codex" };
      mockInvoke.mockResolvedValue(expected);
      const result = await checkCodexCli();
      expect(result).toEqual(expected);
      expect(mockInvoke).toHaveBeenCalledWith("check_codex_cli");
    });
  });
});
