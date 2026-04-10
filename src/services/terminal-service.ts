import { invoke, Channel } from "@tauri-apps/api/core";
import type { TerminalEvent, HeadlessTerminalStatus } from "../types/terminal";

export async function spawnTerminal(
  projectPath: string,
  isClaudeSession: boolean,
  sessionId: string | null,
  onEvent: (event: TerminalEvent) => void,
  initialCommand?: string | null,
  systemPrompt?: string | null,
  model?: string | null,
  effort?: string | null,
): Promise<string> {
  const channel = new Channel<TerminalEvent>();
  channel.onmessage = onEvent;

  const terminalId = await invoke<string>("spawn_terminal", {
    projectPath,
    isClaudeSession,
    sessionId,
    initialCommand: initialCommand || null,
    systemPrompt: systemPrompt || null,
    model: model || null,
    effort: effort || null,
    onEvent: channel,
  });

  return terminalId;
}

export async function writeToTerminal(
  terminalId: string,
  data: string
): Promise<void> {
  await invoke("write_to_terminal", { terminalId, data });
}

export async function resizeTerminal(
  terminalId: string,
  rows: number,
  cols: number
): Promise<void> {
  await invoke("resize_terminal", { terminalId, rows, cols });
}

export async function closeTerminal(terminalId: string): Promise<void> {
  await invoke("close_terminal", { terminalId });
}

export async function checkClaudeCli(): Promise<{ available: boolean; path: string | null }> {
  return await invoke<{ available: boolean; path: string | null }>("check_claude_cli");
}

// ── Headless terminal commands ──

export async function spawnHeadlessTerminal(
  projectPath: string,
  initialCommand: string | null,
  model?: string | null,
  effort?: string | null,
): Promise<string> {
  return await invoke<string>("spawn_headless_terminal", {
    projectPath,
    initialCommand,
    model: model || null,
    effort: effort || null,
  });
}

export async function getTerminalBuffer(
  terminalId: string,
): Promise<number[]> {
  return await invoke<number[]>("get_terminal_buffer", { terminalId });
}

export async function attachTerminalChannel(
  terminalId: string,
  onEvent: (event: TerminalEvent) => void,
): Promise<number[]> {
  const channel = new Channel<TerminalEvent>();
  channel.onmessage = onEvent;
  return await invoke<number[]>("attach_terminal_channel", { terminalId, onEvent: channel });
}

export async function writeToHeadlessTerminal(
  terminalId: string,
  data: string,
): Promise<void> {
  await invoke("write_to_headless_terminal", { terminalId, data });
}

export async function resizeHeadlessTerminal(
  terminalId: string,
  rows: number,
  cols: number,
): Promise<void> {
  await invoke("resize_headless_terminal", { terminalId, rows, cols });
}

export async function closeHeadlessTerminal(
  terminalId: string,
): Promise<void> {
  await invoke("close_headless_terminal", { terminalId });
}

export async function getAllHeadlessStatuses(): Promise<HeadlessTerminalStatus[]> {
  return await invoke<HeadlessTerminalStatus[]>("get_all_headless_statuses");
}

// ── Run Locally commands ──

export interface RunScriptInfo {
  exists: boolean;
  scriptPath: string;
  port: number;
}

export async function checkRunScript(projectPath: string): Promise<RunScriptInfo> {
  return await invoke<RunScriptInfo>("check_run_script", { projectPath });
}

export async function openInBrowser(url: string): Promise<void> {
  await invoke("open_in_browser", { url });
}
